import { fmtDate, el, escapeHtml, parseGBPFromText, inLastDays, monthKey } from "./util.js";

// We call your Vercel proxy (same-origin): /api/interests?MemberId=...
export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  // Create a header area where we’ll inject totals + chart
  const header = el(`
    <div class="card" style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div>
        <div class="title">Declared in the last 12 months</div>
        <div class="meta"><span id="int-total">£0</span></div>
      </div>
      <canvas id="int-chart" width="560" height="120" style="max-width:100%;flex:1 1 320px;border:1px solid #e5e5e5;border-radius:8px"></canvas>
    </div>
  `);

  const listWrap = el(`<div></div>`);

  try {
    // Fetch via your Vercel function
    const url = new URL(`/api/interests`, window.location.origin);
    url.searchParams.set("MemberId", String(memberId));
    url.searchParams.set("Take", "100"); // wide net; we’ll sort/render client-side

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      let detail = ""; try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();

    // Try common shapes: array in items or value
    const items = (data?.items && Array.isArray(data.items)) ? data.items
                 : (data?.value && Array.isArray(data.value)) ? data.value
                 : [];

    if (items.length === 0) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    // Normalize entries (flatten child interests; derive payer + amount heuristically)
    const normalized = [];
    for (const it of items) {
      // Prefer an obvious date field
      const when = it?.registrationDate || it?.publishedDate || it?.registeredSince || it?.registeredInterestCreated || null;

      // Raw description text (varies by category)
      const text = it?.summary || it?.description || it?.registeredInterest || "";

      // Category name
      const category = it?.category?.name || it?.categoryName || it?.category || "Other";

      // Payer/source heuristics:
      // - some feeds expose a structured "donor"/"sponsor"/"employer"; otherwise infer from text (first clause)
      let payer = it?.sponsor?.name || it?.donor?.name || it?.employer?.name || it?.company?.name || it?.source || null;
      if (!payer) {
        // Try to infer from text: up to first " - " or comma
        const t = (text || "").split(/[\-–—]|,/)[0].trim();
        if (t && t.length > 3) payer = t;
      }

      // Amount heuristics:
      // - try a structured amount (rare)
      // - else regex scan the text for a £ amount
      let amount = null;
      if (typeof it?.amount === "number") amount = it.amount;
      if (!amount) amount = parseGBPFromText(text);

      // Push main item
      normalized.push({ category, when, text, payer, amount });

      // If the API delivered child interests, flatten them too
      const children = it?.childInterests || it?.children || [];
      if (Array.isArray(children)) {
        for (const c of children) {
          const cWhen = c?.registrationDate || c?.publishedDate || c?.registeredSince || when;
          const cText = c?.summary || c?.description || c?.registeredInterest || "";
          const cPayer = c?.sponsor?.name || c?.donor?.name || c?.employer?.name || c?.company?.name || it?.sponsor?.name || payer;
          const cAmount = typeof c?.amount === "number" ? c.amount : parseGBPFromText(cText);
          normalized.push({ category, when: cWhen, text: cText, payer: cPayer, amount: cAmount });
        }
      }
    }

    // Sort newest first for display
    normalized.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

    // Compute totals for last 12 months (sum only entries with a detectable amount)
    const oneYear = normalized.filter(n => inLastDays(n.when, 365) && typeof n.amount === "number" && !isNaN(n.amount));
    const total = oneYear.reduce((acc, n) => acc + n.amount, 0);

    // By month buckets (for tiny bar chart)
    const months = [];  // last 12 months keys
    const start = new Date(); start.setMonth(start.getMonth() - 11); start.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    }
    const byMonth = Object.fromEntries(months.map(k => [k, 0]));
    for (const n of oneYear) {
      const k = monthKey(n.when);
      if (byMonth[k] != null) byMonth[k] += n.amount;
    }

    // Render header (total + chart)
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent = "£" + Math.round(total).toLocaleString();

    // Draw simple bars in canvas (no external libs)
    try {
      const canvas = document.getElementById("int-chart");
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0,0,W,H);
      const vals = months.map(k => byMonth[k]);
      const max = Math.max(1, ...vals);
      const pad = 24;
      const chartW = W - pad*2, chartH = H - pad*2;
      const barW = chartW / months.length * 0.7;
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
        const x = pad + i * (barW + gap) + gap/2;
        const y = H - pad - h;
        ctx.fillRect(x, y, barW, h);
      });

      // y-label (max)
      ctx.fillStyle = "#666";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("£" + Math.round(max).toLocaleString(), pad + 4, pad + 12);
    } catch { /* non-fatal */ }

    // Render the list
    const frag = document.createDocumentFragment();
    for (const n of normalized) {
      const amountStr = (typeof n.amount === "number" && !isNaN(n.amount)) ? "£" + Math.round(n.amount).toLocaleString() : "£—";
      const payerStr = n.payer ? escapeHtml(n.payer) : "Source not specified";
      frag.appendChild(el(`
        <article class="card">
          <div class="meta">${[fmtDate(n.when), n.category].filter(Boolean).join(" • ")}</div>
          <div class="title">${payerStr}</div>
          <div>${escapeHtml(n.text || "")}</div>
          <div class="row"><span class="badge">Amount: ${amountStr}</span></div>
        </article>
      `));
    }
    listWrap.innerHTML = "";
    listWrap.appendChild(frag);
    root.appendChild(listWrap);

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load interests: ${escapeHtml(err.message)}</div>`;
  }
}
