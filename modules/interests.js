import {
  fmtDate,
  el,
  escapeHtml,
  parseAllGBP,
  inLastDays,
  monthKey,
  extractSource
} from "./util.js";

// Same-origin Vercel proxy: /api/interests
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
    const url = new URL(`/api/interests`, window.location.origin);
    url.searchParams.set("MemberId", String(memberId));
    url.searchParams.set("Take", "100");

    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      let detail = ""; try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.value) ? data.value : []);
    if (!items.length) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    // --- Normalize entries, pulling source + amounts from narrative and children ---
    const normalized = [];
    for (const it of items) {
      const category = it?.category?.name || it?.categoryName || it?.category || "Other";
      const when = it?.registrationDate || it?.publishedDate || it?.registeredSince || it?.registeredInterestCreated || null;
      const text = it?.summary || it?.description || it?.registeredInterest || "";

      // Source: explicit structured fields are rarely present; extract from text
      let source = extractSource(text);

      // Amounts: scan all "£..." tokens in main text
      let amounts = parseAllGBP(text);

      // Children often contain separate "Payment received…" lines with the real amounts/source
      const children = Array.isArray(it?.childInterests || it?.children) ? (it.childInterests || it.children) : [];
      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        // Lift a better source if present in a child line
        if (!source) source = extractSource(cText);
        amounts = amounts.concat(parseAllGBP(cText));
      }

      // Representative amount for this card: pick the **largest** found
      const amount = amounts.length ? Math.max(...amounts) : null;

      // Clean visible body: drop bare "Payment received" lines so we don’t duplicate
      const visibleText = (text || "")
        .split(/\n+/)
        .filter(line => !/^payment received/i.test(line.trim()))
        .join("\n")
        .trim();

      normalized.push({ category, when, source, amount, text: visibleText });
    }

    // --- Totals + monthly chart for last 12 months (only entries with a £ amount) ---
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

    // --- Render header (plain total + bars) ---
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

      ctx.strokeStyle = "#ddd";
      ctx.beginPath();
      ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
      ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad);
      ctx.stroke();

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

    // --- Render item cards (plain amount text; no lozenge) ---
    const frag = document.createDocumentFragment();
    normalized
      .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
      .forEach(n => {
        const src = n.source ? escapeHtml(n.source) : "Source not specified";
        const amountStr = (typeof n.amount === "number" && !isNaN(n.amount))
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
