// modules/interests.js
import {
  fmtDate,
  el,
  escapeHtml,
  parseAllGBP,
  inLastDays,
  monthKey,
  extractSource
} from "./util.js";

// Calls your same-origin Vercel proxy at /api/interests
export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  const header = el(`
    <div class="card" style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div>
        <div class="title">Declared payments in the last 12 months</div>
        <div class="meta"><span id="int-total">£0</span></div>
      </div>
      <canvas id="int-chart" width="560" height="120" style="max-width:100%;flex:1 1 320px;border:1px solid #e5e5e5;border-radius:8px"></canvas>
    </div>
  `);

  const listWrap = el(`<div></div>`);

  try {
    // Build URL to your Vercel function
    const url = new URL(`/api/interests`, window.location.origin);
    url.searchParams.set("MemberId", String(memberId));
    url.searchParams.set("Take", "100"); // big enough page; we sort client-side

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

    // --- Normalize entries: extract source + amounts (incl. child lines) ---
    const normalized = [];

    for (const it of items) {
      const category =
        it?.category?.name || it?.categoryName || it?.category || "Other";

      const when =
        it?.registrationDate ||
        it?.publishedDate ||
        it?.registeredSince ||
        it?.registeredInterestCreated ||
        null;

      const text = it?.summary || it?.description || it?.registeredInterest || "";

      // 1) Prefer labelled source in main narrative
      let source = extractSource(text);

      // 2) Scan children for better labelled payer + extra amounts
      const children = Array.isArray(it?.childInterests || it?.children)
        ? (it.childInterests || it.children)
        : [];

      let amounts = parseAllGBP(text);

      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        const childSrc = extractSource(cText);
        if (!source && childSrc) source = childSrc; // prefer labelled child source if main was blank
        amounts = amounts.concat(parseAllGBP(cText)); // collect child £ tokens
      }

      // 3) Fallback heuristic for source if still blank
      if (!source) {
        const firstChunk = (text || "").split(/\n+/)[0]?.split(/[-–—]|,|;/)[0]?.trim() || "";
        if (firstChunk && firstChunk.length > 3) source = firstChunk;
      }

      // Single representative amount for the card = largest £ token found
      const amount = amounts.length ? Math.max(...amounts) : null;

      // Clean body: drop bare "Payment received" lines (since we show amount separately)
      const visibleText = (text || "")
        .split(/\n+/)
        .filter(line => !/^payment received/i.test(line.trim()))
        .join("\n")
        .trim();

      normalized.push({ category, when, source, amount, text: visibleText });
    }

    // --- Totals + monthly chart (last 12 months, only entries with a £ amount) ---
    const paymentsLastYear = normalized.filter(n =>
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

    // --- Render header (plain total + simple bars) ---
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent = "£" + Math.round(total).toLocaleString();

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

      // axes
      ctx.strokeStyle = "#ddd";
      ctx.beginPath();
      ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
      ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad);
      ctx.stroke();

      // bars
      ctx.fillStyle = "#6aa6ff";
      months.forEach((k, i) => {
        const v = vals[i];
        const h = (v / max) * (chartH - 2);
        const x = pad + i * (barW + gap) + gap / 2;
        const y = H - pad - h;
        ctx.fillRect(x, y, barW, h);
      });

      // y-axis label (max)
      ctx.fillStyle = "#666";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("£" + Math.round(max).toLocaleString(), pad + 4, pad + 12);
    } catch { /* non-fatal */ }

    // --- Render item cards (date • category • SOURCE • Amount) ---
    const frag = document.createDocumentFragment();
    normalized
      .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
      .forEach(n => {
        const src = n.source ? escapeHtml(n.source) : "Source not specified";
        const amountStr =
          (typeof n.amount === "number" && !isNaN(n.amount))
            ? "£" + n.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : "£—";
        const body = n.text ? `<div>${escapeHtml(n.text)}</div>` : "";

        const card = el(`
          <article class="card">
            <div class="meta">${[fmtDate(n.when), n.category].filter(Boolean).join(" • ")}</div>
            <div class="title">${src}</div>
            ${body}
            <div class="meta">Amount: ${amountStr}</div>
          </article>
        `);
        frag.appendChild(card);
      });

    listWrap.innerHTML = "";
    listWrap.appendChild(frag);
    root.appendChild(listWrap);

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load interests: ${escapeHtml(err.message)}</div>`;
  }
}
