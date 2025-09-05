import { fmtDate, el, escapeHtml } from "./util.js";

// Docs/params: /data/divisions.json/membervoting?queryParameters.memberId=...&queryParameters.take=...
// Ref: Commons Votes OpenAPI (paths: /data/divisions.{format}/membervoting) 
// https://commonsvotes-api.parliament.uk  (OpenAPI shows queryParameters.*) 
export async function renderVotes(root, memberId) {
  root.innerHTML = `<div class="empty">Loading voting record…</div>`;

  const url = new URL("https://commonsvotes-api.parliament.uk/data/divisions.json/membervoting");
  url.searchParams.set("queryParameters.memberId", String(memberId));
  url.searchParams.set("queryParameters.take", "50");   // latest 50 votes
  url.searchParams.set("queryParameters.skip", "0");

  try {
    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      root.innerHTML = `<div class="empty">No voting records returned.</div>`;
      return;
    }

    // Render summary & list
    const frag = document.createDocumentFragment();

    // Quick summary counts
    const aye = items.filter(r => r.MemberVotedAye === true).length;
    const noe = items.filter(r => r.MemberVotedAye === false && !r.MemberWasTeller).length;
    const teller = items.filter(r => r.MemberWasTeller).length;

    frag.appendChild(el(`
      <div class="card">
        <div class="row">
          <div class="badge">Total: ${items.length}</div>
          <div class="badge">Aye: ${aye}</div>
          <div class="badge">No: ${noe}</div>
          <div class="badge">Teller: ${teller}</div>
        </div>
      </div>
    `));

    // Each division
    items.forEach(rec => {
      const d = rec.PublishedDivision || {};
      const vote =
        rec.MemberWasTeller ? "Teller" :
        (rec.MemberVotedAye === true ? "Aye" :
         rec.MemberVotedAye === false ? "No" : "No vote recorded");

      const title = d.FriendlyTitle || d.Title || "Untitled division";
      const date = d.Date ? fmtDate(d.Date) : "";
      const number = d.Number != null ? `Division ${d.Number}` : "";
      const result = `Aye ${d.AyeCount ?? "?"} – No ${d.NoCount ?? "?"}`;

      // No stable public page per division is guaranteed; link to Parliament’s search with title+date.
      const params = new URLSearchParams({ searchTerm: title });
      if (d.Date) {
        const dt = new Date(d.Date);
        if (!isNaN(dt)) {
          const y = dt.getFullYear(), m = String(dt.getMonth()+1).padStart(2,"0"), dd = String(dt.getDate()).padStart(2,"0");
          params.set("startDate", `${y}-${m}-${dd}`);
          params.set("endDate", `${y}-${m}-${dd}`);
        }
      }
      const safeUrl = `https://hansard.parliament.uk/search?${params.toString()}`;

      frag.appendChild(el(`
        <article class="card">
          <div class="meta">${[date, number, result].filter(Boolean).join(" • ")}</div>
          <div class="title">${escapeHtml(title)}</div>
          <div class="row">
            <span class="badge">${vote}</span>
            <a href="${safeUrl}" target="_blank" rel="noreferrer">Open in Hansard</a>
          </div>
        </article>
      `));
    });

    root.innerHTML = "";
    root.appendChild(frag);

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load voting record: ${escapeHtml(err.message)}</div>`;
  }
}
