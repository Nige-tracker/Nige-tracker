import { fmtDate, el, escapeHtml } from "./util.js";

// Interests API supports MemberId, Take, SortOrder=PublishedDateDesc
// Ref: Interests API on the Developer Hub / Parliamentary blog announcement 
export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  const url = new URL("https://interests-api.parliament.uk/api/v1/Interests");
  url.searchParams.set("MemberId", String(memberId));
  url.searchParams.set("Take", "100");
  url.searchParams.set("SortOrder", "PublishedDateDesc");
  url.searchParams.set("ExpandChildInterests", "False");

  try {
    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const items = data?.items || data?.value || [];
    if (!Array.isArray(items) || items.length === 0) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // Basic grouping by category (if the field exists)
    const groups = new Map();
    for (const it of items) {
      const cat = it?.category?.name || it?.categoryName || it?.category || "Other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(it);
    }

    for (const [cat, list] of groups.entries()) {
      frag.appendChild(el(`<h3>${escapeHtml(cat)}</h3>`));
      list.forEach(it => {
        const when = it?.registrationDate || it?.registeredSince || it?.publishedDate || it?.registeredInterestCreated;
        const text = it?.summary || it?.description || it?.registeredInterest || "";
        frag.appendChild(el(`
          <article class="card">
            <div class="meta">${when ? fmtDate(when) : ""}</div>
            <div>${escapeHtml(text)}</div>
          </article>
        `));
      });
    }

    root.innerHTML = "";
    root.appendChild(frag);

  } catch (err) {
    root.innerHTML = `<div class="error">Couldn’t load interests: ${escapeHtml(err.message)}</div>`;
  }
}
