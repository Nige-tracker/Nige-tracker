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
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d;
}

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
    amountLabel: r.amount ?? r.value ?? null,
    receivedDate: toISO(r.received_date ?? r.date_received ?? r.entry_date ?? r.date),
    registeredDate: toISO(r.registered_date ?? r.date_registered ?? r.parsed_date),
    purpose: r.purpose ?? r.description ?? r.details ?? null,
    link: r.link ?? r.source_url ?? r.register_url ?? null,
    _raw: r,
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

  // TODO: If your Datasette uses a different table/view, change `register_interests` below.
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
  const url = new URL(req.url);
  const diag = url.searchParams.get('diag') === '1';

  try {
    const { searchParams } = url;

    // New param names
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const payer = searchParams.get('payer');
    const category = searchParams.get('category');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    // Person/member filters (support new and legacy)
    const personId = searchParams.get('personId') || searchParams.get('PersonId');
    const memberId =
      searchParams.get('memberId') ||
      searchParams.get('MemberId') ||
      searchParams.get('mpId');

    // Pagination: accept new and legacy names
    const limitRaw = searchParams.get('limit') ?? searchParams.get('Take') ?? '100';
    const offsetRaw = searchParams.get('offset') ?? searchParams.get('Skip') ?? '0';
    const limit = Math.min(parseInt(limitRaw, 10) || 100, 500);
    const offset = parseInt(offsetRaw, 10) || 0;

    // Datasette endpoint
    const BASE_URL = process.env.DATASETTE_BASE_URL;
    const DB = process.env.DATASETTE_DB || 'parlparse';

    // Early diagnostics
    if (!BASE_URL) {
      return new Response(
        JSON.stringify({
          error: 'Missing DATASETTE_BASE_URL env var',
          hint: 'Set this in Vercel → Project → Settings → Environment Variables',
          diag: { haveBaseUrl: !!BASE_URL, db: DB },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    // Build SQL + params
    const sql = buildSQL({ start, end, payer, category, minAmount, maxAmount, personId, memberId });
    const params = {
      start,
      end,
      payer: payer ? `%${payer}%` : undefined,
      category,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      personId,
      memberId,
      limit,
      offset,
    };

    const dsURL = new URL(`${BASE_URL}/${DB}.json`);
    dsURL.searchParams.set('sql', sql);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') dsURL.searchParams.set(`_params.${k}`, String(v));
    });
    dsURL.searchParams.set('_shape', 'objects');

    const headers = {};
    if (process.env.DATASETTE_TOKEN) headers.Authorization = `Bearer ${process.env.DATASETTE_TOKEN}`;

    // Optional: show constructed URL in diagnostics (WITHOUT secrets)
    const constructedUrl = dsURL.toString();

    const upstream = await fetch(constructedUrl, { headers, next: { revalidate: 60 } });

    if (!upstream.ok) {
      const bodyText = await upstream.text();
      const snippet = bodyText.slice(0, 500);
      const payload = {
        error: 'Datasette error',
        status: upstream.status,
        detailSnippet: snippet,
        ...(diag ? { constructedUrl } : {}),
      };
      return new Response(JSON.stringify(payload), { status: 502, headers: { 'content-type': 'application/json' } });
    }

    const data = await upstream.json();
    const rows = Array.isArray(data) ? data : data.rows || data;

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

    const out = {
      results: mapped,
      page: { limit, offset, nextOffset: hasMore ? offset + limit : null },
      filters: {
        start, end, payer, category,
        minAmount: minAmount ?? null, maxAmount: maxAmount ?? null,
        personId: personId ?? null, memberId: memberId ?? null
      },
    };

    if (diag) {
      out.diag = {
        haveBaseUrl: !!BASE_URL,
        db: DB,
        constructedUrl,
        upstreamCount: Array.isArray(rows) ? rows.length : (rows?.length ?? null),
      };
    }

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    const payload = { error: err.message || String(err) };
    if (diag) payload.stack = (err && err.stack) || null;
    return new Response(JSON.stringify(payload), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
