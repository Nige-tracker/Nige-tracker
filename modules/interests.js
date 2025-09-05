// modules/interests.js
import { fmtDate, el, escapeHtml, inLastDays, monthKey } from "./util.js";

export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  // Header with total + mini chart
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
    // Hit our serverless function (rewired to TWFY dataset)
    const url = new URL(`/api/interests`, window.location.origin);
    url.searchParams.set("MemberId", String(memberId));
    url.searchParams.set("Take", "200");
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      let detail = ""; try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    if (!items.length) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    // ---- Totals + monthly chart (last 12 months, using structured amounts) ----
    const paymentsLastYear = items.filter(
      it => typeof it.amount === "number" && !isNaN(it.amount) && inLastDays(it.when, 365)
    );
    const total = paymentsLastYear.reduce((acc, it) => acc + it.amount, 0);

    const months = [];
    const start = new Date(); start.setMonth(start.getMonth() - 11); start.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const byMonth = Object.fromEntries(months.map(k => [k, 0]));
    for (const it of paymentsLastYear) {
      const k = monthKey(it.when);
      if (byMonth[k] != null) byMonth[k] += it.amount;
    }

    // Render header
    root.innerHTML = "";
    root.appendChild(header);
    document.getElementById("int-total").textContent =
      "£" + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Tiny bar chart
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

    // ---- Cards (use structured `source`, `amount`, `summary`) ----
    const frag = document.createDocumentFragment();
    items.forEach(it => {
      const meta = [it.when ? fmtDate(it.when) : "", it.category].filter(Boolean).join(" • ");
      const src = it.source || "Source not specified";
      const amountStr = (typeof it.amount === "number" && !isNaN(it.amount))
        ? "£" + it.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "£—";
      const body = it.summary ? `<div>${escapeHtml(it.summary)}</div>` : "";
      const link = it.link ? `<div class="meta"><a href="${escapeHtml(it.link)}" target="_blank" rel="noreferrer">Parliament record</a></div>` : "";

      const card = el(`
        <article class="card">
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="title">${escapeHtml(src)}</div>
          ${body}
          <div class="meta">Amount: ${amountStr}</div>
          ${link}
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
