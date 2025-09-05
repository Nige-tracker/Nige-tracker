// modules/interests.js
import {
  fmtDate,
  el,
  escapeHtml,
  parseAllGBP,
  inLastDays,
  monthKey,

} from "./util.js";

// Set to true if you want a tiny debug line about extraction decisions (not required now)
const DEBUG = false;

function renderKV(key, val) {
  // Pretty-print primitives, arrays, and small objects inline
  const k = escapeHtml(key);
  if (val === null) return `<div><strong>${k}:</strong> <em>null</em></div>`;
  if (val === undefined) return `<div><strong>${k}:</strong> <em>undefined</em></div>`;

  const t = typeof val;
  if (t === "string" || t === "number" || t === "boolean") {
    return `<div><strong>${k}:</strong> ${escapeHtml(String(val))}</div>`;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) return `<div><strong>${k}:</strong> []</div>`;
    // show array items concisely; objects are summarized
    const items = val.map((v, i) => {
      if (v && typeof v === "object") {
        const preview = JSON.stringify(v).slice(0, 200) + (JSON.stringify(v).length > 200 ? "…" : "");
        return `<li><code>[${i}]</code> ${escapeHtml(preview)}</li>`;
      }
      return `<li><code>[${i}]</code> ${escapeHtml(String(v))}</li>`;
    }).join("");
    return `<div><strong>${k}:</strong><ul class="list">${items}</ul></div>`;
  }

  // object — give a shallow key preview; full JSON is in the <details> below
  try {
    const keys = Object.keys(val);
    const preview = keys.slice(0, 8).map(k2 => `${k2}`).join(", ");
    return `<div><strong>${k}:</strong> { ${escapeHtml(preview)}${keys.length > 8 ? ", …" : ""} }</div>`;
  } catch {
    return `<div><strong>${k}:</strong> ${escapeHtml(String(val))}</div>`;
  }
}

export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  const header = el(`
    <div class="card" style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div>
        <div class="title">Declared payments in the last 12 months</div>
        <div class="meta"><span id="int-total">£0.00</span></div>
      </div>
      <canvas id="int-chart" width="560" height="120" style="max-width:100%;flex:1 1 320px;border:1px solid #e5e5e5;border-radius:8px"></canvas>
    </div>
  `);

  const listWrap = el(`<div></div>`);

  try {
    // Use your same-origin Vercel proxy
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

    // ---- Compute simple totals for chart (same as before) ----
    // detect date + £ amounts from text/children so totals still work
    const normalizedForTotals = [];
    for (const it of items) {
      const when =
        it?.registrationDate ||
        it?.publishedDate ||
        it?.registeredSince ||
        it?.registeredInterestCreated ||
        null;

      const mainText = it?.summary || it?.description || it?.registeredInterest || "";
      const candidateTexts = [mainText];

      const children = Array.isArray(it?.childInterests || it?.children) ? (it.childInterests || it.children) : [];
      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        if (cText) candidateTexts.push(cText);
      }

      let amounts = [];
      for (const ct of candidateTexts) amounts = amounts.concat(parseAllGBP(ct));
      const amount = amounts.length ? Math.max(...amounts) : null;

      normalizedForTotals.push({ when, amount });
    }

    const paymentsLastYear = normalizedForTotals.filter(n =>
      typeof n.amount === "number" && !isNaN(n.amount) && inLastDays(n.when, 365)
    );

    const total = paymentsLastYear.reduce((acc, n) => acc + n.amount, 0);

    // Prepare last 12 month buckets
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

    // ---- Render header (total + tiny bar chart) ----
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent =
      "£" + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    } catch { /* non-fatal */ }

    // ---- Render EVERY FIELD per item in a card ----
    const frag = document.createDocumentFragment();

    // sort newest first by best-effort date
    items.sort((a, b) => {
      const da = new Date(a?.registrationDate || a?.publishedDate || a?.registeredSince || a?.registeredInterestCreated || 0);
      const db = new Date(b?.registrationDate || b?.publishedDate || b?.registeredSince || b?.registeredInterestCreated || 0);
      return db - da;
    });

    for (const it of items) {
      const when =
        it?.registrationDate ||
        it?.publishedDate ||
        it?.registeredSince ||
        it?.registeredInterestCreated ||
        null;

      const category =
        it?.category?.name || it?.categoryName || it?.category || "Other";

      // Top summary line
      const meta = [when ? fmtDate(when) : "", category].filter(Boolean).join(" • ");

      // Key/Value dump for all top-level fields
      let kvHtml = "";
      for (const [k, v] of Object.entries(it)) {
        // Pretty-print values; stringify objects/arrays if needed
        const val =
          v && typeof v === "object"
            ? (Array.isArray(v) ? v : v) // handled in renderKV for preview; raw JSON shown below
            : v;
        kvHtml += renderKV(k, val);
      }

      // Raw JSON (expandable)
      const rawJson = `<details style="margin-top:.5rem"><summary>Show raw JSON</summary><pre style="white-space:pre-wrap; overflow:auto; background:#fafafa; border:1px solid #eee; border-radius:6px; padding:.75rem; margin-top:.5rem">${escapeHtml(JSON.stringify(it, null, 2))}</pre></details>`;

      const card = el(`
        <article class="card">
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="title">All fields</div>
          <div class="kv">${kvHtml}</div>
          ${rawJson}
          ${DEBUG ? `<div class="meta" style="opacity:.7">debug: item rendered with ${Object.keys(it).length} top-level keys</div>` : ""}
        </article>
      `);

      frag.appendChild(card);
    }

    listWrap.innerHTML = "";
    listWrap.appendChild(frag);
    root.appendChild(listWrap);

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load interests: ${escapeHtml(err.message)}</div>`;
  }
}
