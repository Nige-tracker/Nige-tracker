// modules/interests.js
import { fmtDate, el, escapeHtml } from "./util.js";

// Use same-origin relative path (works on your Vercel deployment)
const INTERESTS_PROXY_BASE = ""; // leave empty to use relative /api path

export async function renderInterests(root, memberId) {
  root.innerHTML = `<div class="empty">Loading register entries…</div>`;

  // Build URL against your Vercel site (same-origin)
  const url = new URL(`/api/interests`, window.location.origin);
  url.searchParams.set("MemberId", String(memberId));
  url.searchParams.set("Take", "100");
  url.searchParams.set("SortOrder", "PublishedDateDesc");
  url.searchParams.set("ExpandChildInterests", "False");

  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();
    const items = data?.items || data?.value || [];
    if (!Array.isArray(items) || items.length === 0) {
      root.innerHTML = `<div class="empty">No entries returned for this member.</div>`;
      return;
    }

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
