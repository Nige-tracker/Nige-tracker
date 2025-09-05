// /api/interests.js
export const config = { runtime: 'edge' };

function parseNumber(n) {
  if (n === null || n === undefined || n === '') return null;
  const cleaned = String(n).replace(/[£,]/g, '').trim();
  const asNum = Number(cleaned);
  return Number.isFinite(asNum) ? asNum : null;
}

function toISO(d) {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d;
}

function mapRow(r) {
  return {
    id: r.register_entry_id ?? `${r.person_id || r.member_id}-${r.entry_date || r.received_date || r.date || ''}-${r.payer || ''}`,
    personId: r.person_id ?? r.member_id ?? r.mp_id ?? null,
    name: r.member_name ?? r.name ?? null,
    constituency: r.constituency ?? null,
    category: r.category ?? r.category_name ?? null,
    subcategory: r.subcategory ?? null,
    payer: r.payer ?? r.donor ?? r.source ?? null,
    amount: parseNumber(r.amount ?? r.value ?? r.received_value ?? r.donation_value),
    amountLabel: r.amount ?? r.value ?? null,
    receivedDate: toISO(r.received_date ?? r.date_received ?? r.entry_date ?? r.date),
    registeredDate: toISO(r.registered_date ?? r.date_registered ?? r.parsed_date),
    purpose: r.purpose ?? r.description ?? r.details ?? null,
    link: r.link ?? r.source_url ?? r.register_url ?? null,
    _raw: r,
  };
}

function buildSQL({ start, end, payer, category, minAmount, maxAmount }) {
  const where = [];
  if (start) where.push('date(received_date) >= date(:start)');
  if (end) where.push('date(received_date) <= date(:end)');
  if (payer) where.push('(payer LIKE :payer OR donor LIKE :payer)');
  if (category) where.push('(category = :category OR category_name = :category)');
  if (minAmount) where.push('CAST(REPLACE(REPLACE(IFNULL(amount, value), ",", ""), "£", "") AS REAL) >= :minAmount');
  if (maxAmount) where.push('CAST(REPLACE(REPLACE(IFNULL(amount, value), ",", ""), "£", "") AS REAL) <= :maxAmount');

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // IMPORTANT: if your Datasette table/view name differs, change `register_interests` here.
  return `
    SELECT
      register_entry_id,
      person_id,
      member_id,
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

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);

    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const payer = searchParams.get('payer');
    const category = searchParams.get('category');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const sql = buildSQL({ start, end, payer, category, minAmount, maxAmount });

    const params = {
      start,
      end,
      payer: payer ? `%${payer}%` : undefined,
      category,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      limit,
      offset,
    };

    const BASE_URL = process.env.DATASETTE_BASE_URL;
    const DB = process.env.DATASETTE_DB || 'parlparse';
    if (!BASE_URL) {
      return new Response(JSON.stringify({ error: 'Missing DATASETTE_BASE_URL env var' }), { status: 500 });
    }

    const dsURL = new URL(`${BASE_URL}/${DB}.json`);
    dsURL.searchParams.set('sql', sql);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') dsURL.searchParams.set(`_params.${k}`, String(v));
    });
    dsURL.searchParams.set('_shape', 'objects');

    const headers = {};
    if (process.env.DATASETTE_TOKEN) headers.Authorization = `Bearer ${process.env.DATASETTE_TOKEN}`;

    const res = await fetch(dsURL.toString(), {
      headers,
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: 'Datasette error', status: res.status, detail: text }), { status: 502 });
    }

    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.rows || body;

    const seen = new Set();
    const mapped = [];
    for (const r of rows) {
      const m = mapRow(r);
      const key = m.id || JSON.stringify([m.personId, m.payer, m.receivedDate, m.amount]);
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push(m);
    }

    const hasMore = rows.length === limit;
    return new Response(
      JSON.stringify({
        results: mapped,
        page: { limit, offset, nextOffset: hasMore ? offset + limit : null },
        filters: { start, end, payer, category, minAmount: minAmount ?? null, maxAmount: maxAmount ?? null },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
}
