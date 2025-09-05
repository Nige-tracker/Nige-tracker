import { fmtDate, el, escapeHtml, parseAllGBP, parseLargestGBP, inLastDays, monthKey } from "./util.js";

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

    // --- Normalize entries ---
    const normalized = [];
    for (const it of items) {
      const category = it?.category?.name || it?.categoryName || it?.category || "Other";
      const when = it?.registrationDate || it?.publishedDate || it?.registeredSince || it?.registeredInterestCreated || null;
      const text = it?.summary || it?.description || it?.registeredInterest || "";

      // Try structured source first
      let source =
        it?.sponsor?.name || it?.donor?.name || it?.employer?.name || it?.company?.name || it?.source || "";

      // Heuristic: look for "from <name>" at the start of the text
      if (!source) {
        const m = /(?:^|[.;]\s*)from\s+([^,–—\-]+?)(?:,|\s+for\b|\s+-|$)/i.exec(text);
        if (m && m[1]) source = m[1].trim();
      }
      if (!source) source = ""; // will display "Source not specified"

      // Amounts: scan all £ in main text
      const mainAmts = parseAllGBP(text);

      // Also flatten child interests, capturing more amounts & potential sources
      const children = Array.isArray(it?.childInterests || it?.children) ? (it.childInterests || it.children) : [];
      const childEntries = [];
      for (const c of children) {
        const cText = c?.summary || c?.description || c?.registeredInterest || "";
        const cWhen = c?.registrationDate || c?.publishedDate || c?.registeredSince || when;
        const cSrc = c?.sponsor?.name || c?.donor?.name || c?.employer?.name || c?.company?.name || "";
        const cAmts = parseAllGBP(cText);
        childEntries.push({ text: cText, when: cWhen, source: cSrc, amounts: cAmts });
      }

      // Choose a representative amount for the card: prefer the largest single £ in the entry (including children)
      const allAmts = [...mainAmts, ...childEntries.flatMap(x => x.amounts)];
      const cardAmount = allAmts.length ? Math.max(...allAmts) : null;

      // Clean the visible body text: drop repeated bare "Payment received..." lines (we show amount separately)
      const visibleText = (text || "")
        .split(/\n+/)
        .filter(line => !/^payment received/i.test(line.trim()))
        .join("\n")
        .trim();

      normalized.push({
        category, when, source, amount: cardAmount, text: visibleText, childEntries
      });
    }

    // --- Compute last-12-month payments for totals/chart ---
    const paymentsLastYear = normalized.filter(n =>
      typeof n.amount === "number" && !isNaN(n.amount) && inLastDays(n.when, 365)
    );

    // Sum, bucket by month
    const total = paymentsLastYear.reduce((acc, n) => acc + n.amount, 0);
    const months = [];  // last 12 months YYYY-MM
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

    // --- Render header with total + chart ---
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
    } catch { /* ignore */ }

    // --- Render item cards: date • category • SOURCE • Amount ---
    const frag = document.createDocumentFragment();
    normalized
      .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
      .forEach(n => {
        const source = n.source ? escapeHtml(n.source) : "Source not specified";
        const amountStr = (typeof n.amount === "number" && !isNaN(n.amount))
          ? "£" + n.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : "£—";

        const body = n.text ? `<div>${escapeHtml(n.text)}</div>` : "";
        const card = el(`
          <article class="card">
            <div class="meta">${[fmtDate(n.when), n.category].filter(Boolean).join(" • ")}</div>
            <div class="title">${source}</div>
            ${body}
            <div class="row"><span class="badge">Amount: ${amountStr}</span></div>
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
