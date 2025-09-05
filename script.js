async function fetchHansard(query = "") {
  const url = new URL("https://lda.data.parliament.uk/proceedingsdebates.json");
  url.searchParams.set("_pageSize", "10");
  url.searchParams.set("_sort", "-date");
  if (query) url.searchParams.set("_search", query);

  const res = await fetch(url);
  if (!res.ok) {
    document.getElementById("results").innerHTML =
      `<p>Error: ${res.status}</p>`;
    return;
  }
  const data = await res.json();
  const items = data?.result?.items || [];
  renderResults(items);
}

function renderResults(items) {
  const container = document.getElementById("results");
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = "<p>No results found.</p>";
    return;
  }
  items.forEach(it => {
    const div = document.createElement("div");
    div.className = "result";
    const title = it.title || it.label || "Untitled";
    const date = it.date || "";
    const link = it._about || "";
    div.innerHTML = `
      <h3>${title}</h3>
      <p>${date}</p>
      <a href="${link}" target="_blank">${link}</a>
    `;
    container.appendChild(div);
  });
}

document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchBox").value;
  fetchHansard(q);
});

// Initial load
fetchHansard();
