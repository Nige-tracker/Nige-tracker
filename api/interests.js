// api/interests.js
// Edge runtime proxy for TheyWorkForYou/ParlParse Datasette (Register of Interests)

export const config = { runtime: 'edge' };

// --- tiny utils ---
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const iso = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : (d || null));

// --- map a wide variety of ParlParse column names into one stable shape ---
function mapRow(r) {
  const payer =
    r.value_from ??
    r.payer ??
    r.donor ??
    r.source ??
    r.organisation ??
    r.company ??
    r.employer ??
    r.from ??
    null;

  const amountLabel =
    r.amount ??
    r.value ??
    r.received_value ??
    r.donation_value ??
    r.payment_value ??
    r.gross_value ??
    r.net_value ??
    null;

  const amount =
    num(r.amount) ??
    num(r.value) ??
    num(r.received_value) ??
    num(r.donation_value) ??
    num(r.payment_value) ??
    num(r.gross_value) ??
    num(r.net_value) ??
    null;

  const received =
    r.received ??
    r.received_date ??
    r.date_received ??
    r.date_of_payment ??
    r.payment_date ??
    r.entry_date ??
    r.date ??
    null;

  const registered =
    r.registered ??
    r.registered_date ??
    r.date_registered ??
    r.parsed_date ??
    null;

  return {
    id:
      r.register_entry_id ??
      r.id ??
      `${r.person_id || r.member_id || r.mp_id || 'x'}-${received || registered || 'x'}-${payer || 'x'}`,

    personId: r.person_id ?? r.member_id ?? r.mp_id ?? null,
    name: r.member_name ?? r.name ?? null,
    constituency: r.constituency ?? null,

    category: r.category ?? r.category_name ?? null,
    subcategory: r.subcategory ?? null,

    payer: payer || 'Source not specified',
    amount,
    amountLabel, // keep raw label if you need to show exact text
    receivedDate: iso(received),
    registeredDate: iso(registered),

    purpose: r.purpose ?? r.description ?? r.details ?? r.nature ?? null,
    link: r.link ?? r.source_url ?? r.register_url ?? r.url ?? null,

    _raw: r, // for debugging if needed
  };
}

function buildSQL({ start, end, payer, category, personId }) {
  const TABLE = process.env.TWFY_DATASETTE_TABLE_REGMEM || 'items';
  const where = [];
  if (start) where.push('date(date) >= date(:start)');
  if (end) where.push('date(date) <= date(:end)');
  if (payer) where.push("(json_extract(item,'$.value_from') LIKE :payer)");
  if (category) where.push('(category_id = :category)');
  if (personId) where.push('(person_id = :personId OR member_id = :personId)');

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return `
    SELECT
      -- stable identifiers
      record_id AS register_entry_id,
      person_id, member_id,
      date AS received_date,
      category_id,

      -- JSON fields pulled out of items.item
      json_extract(item,'$.value_from') AS value_from,
      json_extract(item,'$.value')      AS value,
      json_extract(item,'$.description') AS description,
      json_extract(item,'$.nature')     AS nature,
      json_extract(item,'$.link')       AS link

    FROM ${TABLE}
    ${whereSQL}
    ORDER BY date(received_date) DESC
    LIMIT :limit OFFSET :offset
  `;
}


export default async function handler(req) {
  try {
    const u = new URL(req.url);
    const p = u.searchParams;

    // Filters (friendly names)
    const start = p.get('start');   // 'YYYY-MM-DD'
    const end = p.get('end');       // 'YYYY-MM-DD'
    const payer = p.get('payer');   // substring
    const category = p.get('category'); // exact
    // Person: prefer personId; accept MemberId/mpId for compatibility
    const personId = p.get('personId') || p.get('PersonId') || p.get('MemberId') || p.get('mpId');

    const limit = Math.min(parseInt(p.get('limit') ?? p.get('Take') ?? '100', 10) || 100, 500);
    const offset = parseInt(p.get('offset') ?? p.get('Skip') ?? '0', 10) || 0;

    const BASE = process.env.TWFY_DATASETTE_BASE_URL;
    const DB = process.env.TWFY_DATASETTE_DB || 'parlparse';
    if (!BASE) {
      return new Response(JSON.stringify({ error: 'Missing TWFY_DATASETTE_BASE_URL' }), { status: 500 });
    }

    const sql = buildSQL({ start, end, payer, category, personId });

    const params = {
      start,
      end,
      payer: payer ? `%${payer}%` : undefined,
      category,
      personId,
      limit,
      offset,
    };

    const ds = new URL(`${BASE}/${DB}.json`);
    ds.searchParams.set('sql', sql);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') ds.searchParams.set(`_params.${k}`, String(v));
    });
    ds.searchParams.set('_shape', 'objects');

    const headers = {};
    if (process.env.TWFY_DATASETTE_TOKEN) headers.Authorization = `Bearer ${process.env.TWFY_DATASETTE_TOKEN}`;

    const r = await fetch(ds.toString(), { headers });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: 'Upstream Datasette', status: r.status, detail: t.slice(0, 400) }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const body = await r.json();
    const rows = Array.isArray(body) ? body : body.rows || body;

    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const m = mapRow(row);
      const key = m.id || JSON.stringify([m.personId, m.payer, m.receivedDate, m.amount]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    const hasMore = rows.length === limit;

    return new Response(JSON.stringify({
      results: out,
      page: { limit, offset, nextOffset: hasMore ? offset + limit : null },
      source: 'twfy-datasette',
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
