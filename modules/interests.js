import { fmtDate, el, escapeHtml } from "./util.js";

/**
 * Register of Members' Financial Interests (RMFI)
 * API docs: developer.parliament.uk → Interests API
 * Key gotchas:
 *  - Param names are case-sensitive: MemberId, Take, SortOrder, ExpandChildInterests
 *  - Some combinations/values can 400; fall back to simpler query
 */
export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  async function fetchOnce(params) {
    const url = new URL("https://interests-api.parliament.uk/api/v1/Interests");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      // Try to read the error body (often includes why it 400'd)
      let detail = "";
      try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    return res.json();
  }

  try {
    // 1) Preferred: explicit paging + ordering
    let data;
    try {
      data = await fetchOnce({
        MemberId: memberId,
        Take: 100,
        SortOrder: "PublishedDateDesc",
        ExpandChildInterests: "False",
      });
    } catch (e) {
      // 2) Fallback: minimal params (some deployments are stricter)
      data = await fetchOnce({ MemberId: memberId, Take: 50 });
    }

    const items = data?.items || data?.value || [];
    if (!Array.isArray(items) || items.length === 0) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

    // Group by category name if present
    const groups = new Map();
    for (const it of items) {
      const cat = it?.category?.name || it?.categoryName || it?.category || "Other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(it);
    }

    const frag = document.createDocumentFragment();
    for (const [cat, list] of groups.entries()) {
      frag.appendChild(el(`<h3>${escapeHtml(cat)}</h3>`));
      list.forEach((it) => {
        const when =
          it?.registrationDate ||
          it?.publishedDate ||
          it?.registeredSince ||
          it?.registeredInterestCreated;
        const text =
          it?.summary ||
          it?.description ||
          it?.registeredInterest ||
          "";

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
