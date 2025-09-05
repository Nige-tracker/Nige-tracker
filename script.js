// Hansard viewer: load once, filter client-side, and build non-404 links.

const RESULTS = document.getElementById("results");
const SEARCH = document.getElementById("searchBox");
const BTN = document.getElementById("searchBtn");

// 1) Load a recent slice of proceedings (broad, reliable JSON endpoint)
async function loadRecent() {
  RESULTS.innerHTML = "<p>Loading…</p>";
  const url = new URL("https://lda.data.parliament.uk/proceedings.json");
  url.searchParams.set("_pageSize", "50");
  url.searchParams.set("_sort", "-date"); // newest first

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.result?.items || [];
    window.__HANSARD_ITEMS__ = items;
    render(items);
  } catch (err) {
    RESULTS.innerHTML = `<p>Error loading feed: ${err.message}</p>`;
  }
}

// 2) Client-side filter by title/topic/link
function filterItems(query) {
  const items = window.__HANSARD_ITEMS__ || [];
  const q = (query || "").trim().toLowerCase();
  if (!q) return items;
  return items.filter(it => {
    const title = (it.title || it.label || "").toLowerCase();
    const topic = (it?.topic?.prefLabel || "").toLowerCase();
    const link  = (it.externalLocation || it._about || "").toLowerCase();
    return title.includes(q) || topic.includes(q) || link.includes(q);
  });
}

// 3) Build a safe link that shouldn’t 404
function bestLink(it) {
  const ext = it?.externalLocation;
  if (ext && /^https?:\/\//i.test(ext)) return ext;

  // Fall back: send the user to Hansard Search by title + date (very robust)
  const title = it?.title || it?.label || "";
  const date = it?.date ? new Date(it.date) : null;

  // Hansard search query
  const params = new URLSearchParams();
  const q = title ? title : "Hansard";
  params.set("searchTerm", q);

  // If we have a date, narrow to that day (improves relevance)
  if (date && !isNaN(date)) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;
    params.set("startDate", iso);
    params.set("endDate", iso);
  }

  return `https://hansard.parliament.uk/search?${params.toString()}`;
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleString();
  } catch { return d || ""; }
}

function render(items) {
  if (!items.length) {
    RESULTS.innerHTML = "<p>No results found.</p>";
    return;
  }
  RESULTS.innerHTML = "";
  items.forEach(it => {
    const title = it.title || it.label || "Untitled";
    const date  = it.date ? formatDate(it.date) : "";
    const where = it.sectionTitle || it.hansardHeading || it.where || "";
    const link  = bestLink(it);

    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <h3>${title}</h3>
      <p>${[date, where].filter(Boolean).join(" • ")}</p>
      <a href="${link}" target="_blank" rel="noreferrer">${link}</a>
    `;
    RESULTS.appendChild(div);
  });
}

// Wire up the search box to client-side filtering
BTN.addEventListener("click", () => render(filterItems(SEARCH.value)));
SEARCH.addEventListener("keydown", (e) => {
  if (e.key === "Enter") render(filterItems(SEARCH.value));
});

// Initial load
loadRecent();
