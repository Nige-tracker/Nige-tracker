// modules/interests.js
import {
  fmtDate,
  el,
  escapeHtml,
  parseAllGBP,
  inLastDays,
  monthKey,
  // Use whichever extractor you currently have:
  extractSourcePlus as _extractSourcePlus, // if present
  extractSource as _extractSource,        // else this will be defined
  normalizeNameKey
} from "./util.js";

// Pick whichever extractor exists
const extractSourcePlus = typeof _extractSourcePlus === "function"
  ? _extractSourcePlus
  : (t) => ({ source: (typeof _extractSource === "function" ? _extractSource(t) : ""), why: "", matchedText: "" });

const DEBUG = false; // set true to print grouping keys under cards

export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  // Simple tab UI inside the Interests panel
  const tabs = el(`
    <div class="card">
      <div class="row" style="gap:.5rem; flex-wrap:wrap">
        <button id="tabGrouped" class="btn">Grouped by payer</button>
        <button id="tabRaw" class="btn btn-outline">Raw entries</button>
      </div>
    </div>
  `);

  const header = el(`
    <div class="card" style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div>
        <div class="title">Declared payments in the last 12 months</div>
        <div class="meta"><span id="int-total">£0.00</span></div>
      </div>
      <canvas id="int-chart" width="560" height="120" style="max-width:100%;flex:1 1 320px;border:1px solid #e5e5e5;border-radius:8px"></canvas>
    </div>
  `);

  const content = el(`<div></div>`);

  try {
    // Fetch via your same-origin Vercel proxy
    const url = new URL(`/api/interests`, window.location.origin);
    url.searchParams.set("MemberId", String(memberId));
    url.searchParams.set("Take", "100");
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      let detail = ""; try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();

    const items = Array.isArray(data?.items) ? data.items
                : Array.isArray(data?.value) ? data.value
                : [];

    if (!items.length) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    // ---- Normalize each entry: when, payer source, amounts (from main + children) ----
    const normalized = [];

    for (const it of items) {
      // best-effort timestamp
      const when =
        it?.registrationDate ||
        it?.publishedDate ||
        it?.registeredSince ||
        it?.registeredInterestCreated ||
        null;

      // narrative text (payer/amounts usually live here)
      const mainText = it?.summary || it?.description || it?.registeredInterest || "";

      // gather candidates (children often hold “Payment received…” lines)
      const candidateTexts = [mainText];
      const children = Array.isArray(it?.childInterests || it?.children) ? (it.childInterests || it.children) : [];
      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        if (cText) candidateTexts.push(cText);
      }

      // 1) payer/source: try debug extractor if available, else simple extract
      let source = "";
      let srcWhy = "";
      for (const ct of candidateTexts) {
        const { source: s, why } = extractSourcePlus(ct);
        if (s) { source = s; srcWhy = why; break; }
      }
      // 2) amounts: collect all £ tokens; card shows the largest
      let amounts = [];
      for (const ct of candidateTexts) amounts = amounts.concat(parseAllGBP(ct));
      const amount = amounts.length ? Math.max(...amounts) : null;

      // 3) category if present (for display)
      const category = it?.category?.name || it?.categoryName || it?.category || "";

      // 4) try to detect a stable payer ID if the API exposes one (field names vary)
      const payerId =
        it?.donor?.id ||
        it?.sponsor?.id ||
        it?.employer?.id ||
        it?.company?.id ||
        it?.organisation?.id ||
        it?.organization?.id ||
        it?.payer?.id ||
        null;

      // 5) computed grouping key: prefer explicit id; else normalized name
      const key = payerId ? `id:${payerId}` : (source ? `name:${normalizeNameKey(source)}` : "");

      normalized.push({
        when, source, amount, category, key,
        _raw: it,
        _srcWhy: srcWhy
      });
    }

    // ---- Compute totals + monthly chart from normalized entries ----
    const paymentsLastYear = normalized.filter(n =>
      typeof n.amount === "number" && !isNaN(n.amount) && inLastDays(n.when, 365)
    );
    const total = paymentsLastYear.reduce((acc, n) => acc + n.amount, 0);

    const months = [];
    const start = new Date(); start.setMonth(start.getMonth() - 11); start.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const byMonth = Object.fromEntries(months.map(k => [k, 0]));
    for (const n of paymentsLastYear) {
      const k = monthKey(n.when);
      if (byMonth[k] != null) byMonth[k] += n.amount;
    }

    // ---- Build grouped map (payer -> entries) ----
    const groups = new Map();
    for (const n of normalized) {
      // If neither id nor name available, skip grouping and drop to a “(unknown payer)” bucket
      const gKey = n.key || (n.source ? `name:${normalizeNameKey(n.source)}` : "unknown");
      if (!groups.has(gKey)) groups.set(gKey, { source: n.source || "Unknown payer", entries: [], total: 0 });
      const g = groups.get(gKey);
      g.entries.push(n);
      if (typeof n.amount === "number" && !isNaN(n.amount)) g.total += n.amount;
      // prefer a non-empty display name if one appears later
      if (!g.source && n.source) g.source = n.source;
    }

    // ---- Render header + tabs ----
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent =
      "£" + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Draw chart (same as before)
    try {
      const canvas = document.getElementById("int-chart");
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const vals = months.map(k => byMonth[k]);
      const max = Math.max(1, ...vals);
      const pad = 24;
      const chartW = W - pad * 2, chartH = H - pad * 2;
      const barW = (chartW / months.length) * 0.7;
      const gap = (chartW / months.length) - barW;
      ctx.strokeStyle = "#ddd";
      ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
      ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.stroke();
      ctx.fillStyle = "#6aa6ff";
      months.forEach((k, i) => {
        const v = vals[i];
        const h = (v / max) * (chartH - 2);
        const x = pad + i * (barW + gap) + gap / 2;
        const y = H - pad - h;
        ctx.fillRect(x, y, barW, h);
      });
      ctx.fillStyle = "#666";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("£" + Math.round(max).toLocaleString(), pad + 4, pad + 12);
    } catch {}

    // Tabs + content
    root.appendChild(tabs);
    root.appendChild(content);

    function renderGrouped() {
      const frag = document.createDocumentFragment();

      // sort groups by total desc
      const list = Array.from(groups.values()).sort((a, b) => b.total - a.total);

      list.forEach(g => {
        // entries newest first
        g.entries.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
        const totalStr = "£" + g.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const itemsHtml = g.entries.map(en => {
          const amountStr = (typeof en.amount === "number" && !isNaN(en.amount))
            ? "£" + en.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : "£—";
          const meta = [fmtDate(en.when), en.category].filter(Boolean).join(" • ");
          const dbg = DEBUG ? `<div class="meta" style="opacity:.7">key: ${escapeHtml(en.key || "")} • why: ${escapeHtml(en._srcWhy || "")}</div>` : "";
          return `
            <li>
              <div class="meta">${escapeHtml(meta)}</div>
              <div class="row" style="justify-content:space-between">
                <div>${escapeHtml(en.source || "Unknown payer")}</div>
                <div>${amountStr}</div>
              </div>
              ${dbg}
            </li>
          `;
        }).join("");

        const card = el(`
          <article class="card">
            <div class="title">${escapeHtml(g.source)}</div>
            <div class="meta">Total: ${totalStr}</div>
            <ul class="list">${itemsHtml}</ul>
          </article>
        `);
        frag.appendChild(card);
      });

      content.innerHTML = "";
      content.appendChild(frag);
    }

    function renderRaw() {
      const frag = document.createDocumentFragment();
      const entries = [...normalized].sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
      entries.forEach(n => {
        const meta = [fmtDate(n.when), n.category].filter(Boolean).join(" • ");
        const amountStr = (typeof n.amount === "number" && !isNaN(n.amount))
          ? "£" + n.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "£—";
        const dbg = DEBUG ? `<div class="meta" style="opacity:.7">key: ${escapeHtml(n.key || "")} • why: ${escapeHtml(n._srcWhy || "")}</div>` : "";
        const card = el(`
          <article class="card">
            <div class="meta">${escapeHtml(meta)}</div>
            <div class="title">${escapeHtml(n.source || "Source not specified")}</div>
            <div class="meta">Amount: ${amountStr}</div>
            ${dbg}
            <details style="margin-top:.5rem"><summary>Show raw JSON</summary>
              <pre style="white-space:pre-wrap; overflow:auto; background:#fafafa; border:1px solid #eee; border-radius:6px; padding:.75rem; margin-top:.5rem">${escapeHtml(JSON.stringify(n._raw, null, 2))}</pre>
            </details>
          </article>
        `);
        frag.appendChild(card);
      });
      content.innerHTML = "";
      content.appendChild(frag);
    }

    // Wire tabs
    const btnGrouped = tabs.querySelector("#tabGrouped");
    const btnRaw = tabs.querySelector("#tabRaw");
    function select(tab) {
      if (tab === "grouped") {
        btnGrouped.className = "btn";
        btnRaw.className = "btn btn-outline";
        renderGrouped();
      } else {
        btnGrouped.className = "btn btn-outline";
        btnRaw.className = "btn";
        renderRaw();
      }
    }
    btnGrouped.addEventListener("click", () => select("grouped"));
    btnRaw.addEventListener("click", () => select("raw"));

    // Default to grouped view
    select("grouped");

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load interests: ${escapeHtml(err.message)}</div>`;
  }
}
