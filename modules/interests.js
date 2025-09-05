// api/interests.js
// Rewire Interests → TheyWorkForYou / ParlParse (Datasette)
// Returns a unified shape your frontend can render directly.

const DEFAULT_MEMBER = 5091; // Nigel Farage (MNIS id)
const DATASET_BASE =
  "https://data.mysociety.org/datasette/mysoc/parl_register_interests/commons_rmfi/latest";

async function j(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Upstream ${res.status}: ${await res.text().catch(()=>res.statusText)}`);
  return res.json();
}

// Query one table (filtered by mnis_id)
async function getTable(table, mnisId) {
  const u = new URL(`${DATASET_BASE}/${encodeURIComponent(table)}.json`);
  u.searchParams.set("_shape", "array");
  u.searchParams.set("_size", "max");
  u.searchParams.set("mnis_id", String(mnisId));
  return j(u.toString());
}

// Map rows from multiple tables → common item format
function normalize({ table, rows }) {
  const items = [];
  for (const r of rows) {
    const when =
      r.received_date ||
      r.registered ||
      r.published ||
      r.updated_1 ||
      r.updated_2 ||
      r.updated_3 ||
      null;

    const amount =
      typeof r.value === "number" ? r.value
      : typeof r["donors__value_1"] === "number" ? r["donors__value_1"]
      : null;

    const source =
      r.payer_name ||
      r.ultimate_payer_name ||
      r.donor_name ||
      r["donors__name_1"] ||
      r.donor_company_name ||
      "";

    const summary = r.summary || "";
    const category = r.category || table;
    const link = r.link || null;

    items.push({ when, amount, source, summary, category, link, table, raw: r });
  }
  return items;
}

export default async function handler(req, res) {
  try {
    const memberId = Number(req.query.MemberId || req.query.memberId || DEFAULT_MEMBER);
    const take = Math.max(1, Math.min(500, Number(req.query.Take || 100)));

    // Pull a few core categories; add more later if needed
    const [adHoc, ongoing, donations, visits] = await Promise.all([
      getTable("Category 1.1", memberId), // Employment & earnings — Ad hoc
      getTable("Category 1.2", memberId), // Employment & earnings — Ongoing paid employment
      getTable("Category 2",   memberId), // Donations and other support
      getTable("Category 4",   memberId), // Visits outside the UK
    ]);

    let items = []
      .concat(normalize({ table: "Employment and earnings — Ad hoc", rows: adHoc }))
      .concat(normalize({ table: "Employment and earnings — Ongoing", rows: ongoing }))
      .concat(normalize({ table: "Donations and other support", rows: donations }))
      .concat(normalize({ table: "Visits outside the UK", rows: visits }));

    items.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
    if (items.length > take) items = items.slice(0, take);

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ items, source: "mysociety/parlparse-datasette" });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
}
