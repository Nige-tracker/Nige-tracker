// modules/interests.js
import {
  fmtDate,
  el,
  escapeHtml,
  parseAllGBP,
  inLastDays,
  monthKey,
  normalizeNameKey
} from "./util.js";

/* -------- PAYER EXTRACTION (self-contained, no imports) -------- */
function extractSourcePlus(raw = "") {
  // Returns { source, why, matchedText }
  let source = "", why = "", matchedText = "";

  if (!raw) return { source, why, matchedText };

  const t = String(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1) Labelled fields (most reliable)
  const labelled = [
    ["name of donor", /\bname of donors?\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["name of donor (alt)", /\bname of (?:the\s*)?donor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["name of company", /\bname of (?:the\s*)?compan(?:y|ies)\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["name of employer", /\bname of (?:the\s*)?employer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["employer", /\bemployer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["company making payment", /\bcompany making (?:the )?payment\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["company providing benefit", /\bcompany providing (?:the )?benefit\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["name of organisation", /\bname of organis(?:ation|ation\(s\))\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["paying organisation", /\bpaying organis(?:ation|ation\(s\))\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["broadcaster", /\bname of broadcaster\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["sponsor", /\bsponsor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i],
    ["donor", /\bdonor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i]
  ];
  for (const [label, rx] of labelled) {
    const m = rx.exec(t);
    if (m && m[1]) return { source: cleanName(m[1]), why: `label:${label}`, matchedText: m[0] };
  }

  // 2) Line-start cues: "From X," / "By X,"
  let m = /^\s*from\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i.exec(t);
  if (m && m[1]) return { source: cleanName(m[1]), why: "line-start:from", matchedText: m[0] };
  m = /^\s*by\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i.exec(t);
  if (m && m[1]) return { source: cleanName(m[1]), why: "line-start:by", matchedText: m[0] };

  // 3) Anywhere in text: "from X,"
  m = /\bfrom\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i.exec(t);
  if (m && m[1]) return { source: cleanName(m[1]), why: "inline:from", matchedText: m[0] };

  // 4) Immediately before "payment received / received on / date received"
  m = /([A-Z][^.\n]{2,100}?)\s*[-–—,:]?\s*(?:payment\s+(?:of\s+)?received|date\s+received|received\s+on)\b/i.exec(t);
  if (m && m[1]) {
    const guess = cleanName(m[1]);
    if (isOrgLike(guess)) return { source: guess, why: "before:payment-received", matchedText: m[0] };
  }

  // 5) Fallback: org-like token anywhere
  const rxOrg = /\b([A-Z][A-Za-z0-9&().'’\- ]{2,80}?\s(?:Ltd|Limited|LLP|PLC|Group|Holdings?|Media|Broadcast(?:ing)?|Company|Foundation|University|Trust|CIC|Inc\.?|Corp\.?|GmbH|S\.?A\.?S?\.?))\b/gi;
  m = rxOrg.exec(t);
  if (m && m[1]) return { source: cleanName(m[1]), why: "org-like", matchedText: m[0] };

  return { source, why, matchedText };
}

function cleanName(s) {
  return String(s).replace(/\s*\(.*?\)\s*$/g, "").replace(/\s*-\s*$/g, "").replace(/\s+/g, " ").trim();
}
function isOrgLike(s) {
  return /\b(ltd|limited|llp|plc|group|holdings?|media|broadcast(ing)?|company|foundation|university|trust|cic|inc\.?|corp\.?|gmbh|s\.?a\.?s?\.?)\b/i.test(s);
}

/* ----------------------- UI / RENDERING ----------------------- */

const DEBUG = false; // set true to print a debug line under cards

export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  // Tabs
  const tabs = el(`
    <div class="card">
      <div class="row" style="gap:.5rem; flex-wrap:wrap">
        <button id="tabGrouped" class="btn">Grouped by payer</button>
        <button id="tabRaw" class="btn btn-outline">Raw entries</button>
      </div>
    </div>
  `);

  // Header (total + mini chart)
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
    // Fetch (same-origin Vercel proxy)
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

    // ---- Normalize entries: when, source, amounts, category ----
    const normalized = [];
    for (const it of items) {
      const when =
        it?.registrationDate ||
        it?.publishedDate ||
        it?.registeredSince ||
        it?.registeredInterestCreated ||
        null;

      const category = it?.category?.name || it?.categoryName || it?.category || "";

      const mainText = it?.summary || it?.description || it?.registeredInterest || "";

      const candidateTexts = [mainText];
      const children = Array.isArray(it?.childInterests || it?.children) ? (it.childInterests || it.children) : [];
      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        if (cText) candidateTexts.push(cText);
      }

      // Source: first hit across candidates
      let src = "", why = "", matched = "";
      for (const ct of candidateTexts) {
        const r = extractSourcePlus(ct);
        if (r.source) { src = r.source; why = r.why; matched = r.matchedText || ct.slice(0, 180); break; }
      }

      // Amounts: largest £ token across candidates
      let amounts = [];
      for (const ct of candidateTexts) amounts = amounts.concat(parseAllGBP(ct));
      const amount = amounts.length ? Math.max(...amounts) : null;

      // Grouping key (prefer name since ID is rarely exposed)
      const key = src ? `name:${normalizeNameKey(src)}` : "unknown";

      normalized.push({
        when, category, source: src, amount, key,
        _raw: it,
        _dbg: { why, matched }
      });
    }

    // ---- Totals + monthly chart (last 12 months) ----
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

    // ---- Group by payer ----
    const groups = new Map();
    for (const n of normalized) {
      const gKey = n.key;
      if (!groups.has(gKey)) groups.set(gKey, { source: n.source || "Unknown payer", entries: [], total: 0, key: gKey });
      const g = groups.get(gKey);
      g.entries.push(n);
      if (typeof n.amount === "number" && !isNaN(n.amount)) g.total += n.amount;
      if (!g.source && n.source) g.source = n.source;
    }

    // ---- Render header + tabs ----
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent =
      "£" + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Draw chart
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
      const list = Array.from(groups.values()).sort((a, b) => b.total - a.total);

      list.forEach(g => {
        g.entries.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
        const totalStr = "£" + g.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const itemsHtml = g.entries.map(en => {
          const meta = [fmtDate(en.when), en.category].filter(Boolean).join(" • ");
          const amountStr = (typeof en.amount === "number" && !isNaN(en.amount))
            ? "£" + en.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : "£—";
          const dbg = DEBUG
            ? `<div class="meta" style="opacity:.7">why: ${escapeHtml(en._dbg.why || "none")} • matched: “${escapeHtml((en._dbg.matched || "").toString())}”</div>`
            : "";
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
        const dbg = DEBUG
          ? `<div class="meta" style="opacity:.7">why: ${escapeHtml(n._dbg.why || "none")} • matched: “${escapeHtml((n._dbg.matched || "").toString())}”</div>`
          : "";
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
