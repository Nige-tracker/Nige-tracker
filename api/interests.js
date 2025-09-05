// /api/interests.js
export const config = { runtime: 'edge' };

// ---------- helpers ----------
function parseNumber(n) {
  if (n === null || n === undefined || n === '') return null;
  const cleaned = String(n).replace(/[£,]/g, '').trim();
  const asNum = Number(cleaned);
  return Number.isFinite(asNum) ? asNum : null;
}

function toISO(d) {
  if (!d) return null;
  // Datasette often returns YYYY-MM-DD; ensure full ISO for consistent client parsing/sorting
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d;
}

// Map a raw Datasette row -> unified shape your UI expects
function mapRow(r) {
  return {
    id:
      r.register_entry_id ??
      `${r.person_id || r.member_id || r.mp_id || 'unknown'}-${r.entry_date || r.received_date || r.date || 'nodate'}-${r.payer || r.donor || 'nopayer'}`,
    personId: r.person_id ?? r.member_id ?? r.mp_id ?? null,
    name: r.member_name ?? r.name ?? null,
    constituency: r.constituency ?? null,
    category: r.category ?? r.category_name ?? null,
    subcategory: r.subcategory ?? null,
    payer: r.payer ?? r.donor ?? r.source ?? null,
    amount: parseNumber(r.amount ?? r.value ?? r.received_value ?? r.donation_value),
    amountLabel: r.amount ?? r.value ?? null, // keep raw label if you show the original
    receivedDate: toISO(r.received_date ?? r.date_received ?? r.entry_date ?? r.date),
    registeredDate: toISO(r.registered_date ?? r.date_registered ?? r.parsed_date),
    purpose: r.purpose ?? r.description ?? r.details ?? null,
    link: r.link ?? r.source_url ?? r.register_url ?? null,
    _raw: r, // keep raw for debugging
  };
}

function buildSQL({ start, end, payer, category, minAmount, maxAmount, personId, memberId }) {
  const where = [];
  if (start) where.push('date(received_date) >= date(:start)');
  if (end) where.push('date(received_date) <= date(:end)');
  if (payer) where.push('(payer LIKE :payer OR donor LIKE :payer)');
  if (category) where.push('(category = :category OR category_name = :category)');
  if (personId) where.push('(person_id = :personId)');
  if (memberId) where.push('(member_id = :memberId OR mp_id = :memberId)');
  if (minAmount) where.push('CAST(REPLACE(REPLACE(IFNULL(amount, value), ",", ""), "£", "") AS REAL) >= :minAmount');
  if (maxAmount) where.push('CAST(REPLACE(REPLACE(IFNULL(amount, value), ",", ""), "£", "") AS REAL) <= :maxAmount');

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // IMPORTANT: Change `register_interests` below if your Datasette uses a different table/view name.
  return `
    SELECT
      register_entry_id,
      person_id,
      member_id,
      mp_id,
      member_name,
      constituency,
      category,
      category_name,
      subcategory,
      payer,
      donor,
      source,
      amount,
      value,
      received_value,
      donation_value,
      received_date,
      date_received,
      entry_date,
      date,
      registered_date,
      date_registered,
      parsed_date,
      purpose,
      description,
      details,
      link,
      source_url,
      register_url
    FROM register_interests
    ${whereSQL}
    ORDER BY date(received_date) DESC NULLS LAST, date_registered DESC NULLS LAST
    LIMIT :limit
    OFFSET :offset
  `;
}

// ---------- handler ----------
export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);

    // New param names
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const payer = searchParams.get('payer');
    const category = searchParams.get('category');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    // Person/member filters (support new and legacy)
    const personId = searchParams.get('personId') || searchParams.get('PersonId');
    const mem
