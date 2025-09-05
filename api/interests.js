// /api/interests.js
// Node.js Serverless version (NOT Edge) to avoid opaque Edge "internal error"
export const config = { runtime: 'nodejs18.x' }; // or 'nodejs20.x' if enabled

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

// replace your existing mapRow with this:
function mapRow(r) {
  // Find a source/payer string across common ParlParse/TWFY variants
  const payerStr =
    r.payer ??
    r.donor ??
    r.source ??
    r.payer_name ??
    r.organisation ??
    r.organization ??            // US spelling just in case
    r.company ??
    r.employer ??
    r.value_from ??
    r.from ??
    r.provider ??
    r.sponsor ??
    null;

  // Prefer any numeric-looking money field; keep a human label too
  const rawLabel =
    r.amount ??
    r.value ??
    r.received_value ??
    r.donation_value ??
    r.payment_value ??
    r.gross_value ??
    r.net_value ??
    null;

  // Numeric parse that tolerates "£" and commas
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    const num = Number(String(v).replace(/[£,\s]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const amountNum =
    parseNum(r.amount) ??
    parseNum(r.value) ??
    parseNum(r.received_value) ??
    parseNum(r.donation_value) ??
    parseNum(r.payment_value) ??
    parseNum(r.gross_value) ??
    parseNum(r.net_value) ??
    null;

  // Dates: prefer an explicit "received" date, fall back sensibly
  const toISO = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : (d || null));
  const received =
    r.received_date ?? r.date_received ?? r.date_of_payment ?? r.payment_date ?? r.entry_date ?? r.date ?? null;
  const registered =
    r.registered_date ?? r.date_registered ?? r.parsed_date ?? null;

  return {
    id:
      r.register_entry_id ??
      `${r.person_id || r.member_id || r.mp_id || 'x'}-${received || registered || 'x'}-${payerStr || 'x'}`,

    personId: r.person_id ?? r.member_id ?? r.mp_id ?? null,
    name: r.member_name ?? r.name ?? null,
    constituency: r.constituency ?? null,

    category: r.category ?? r.category_name ?? null,
    subcategory: r.subcategory ?? null,

    payer: payerStr,                 // <-- string for UI
    amount: amountNum,               // <-- numeric for charts
    amountLabel: rawLabel,           // <-- keep raw human label if you show it

    receivedDate: toISO(received),
    registeredDate: toISO(registered),

    purpose: r.purpose ?? r.description ?? r.details ?? r.nature ?? null,
    link: r.link ?? r.source_url ?? r.register_url ?? r.url ?? null,

    _raw: r,                         // keep raw row for debug
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

  // IMPORTANT: Change `register_interests` if your Datasette uses a different table/view.
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

// ---------- handler (Node.js style) ----------
export default async function handler(req, res) {
  // Support both Next/Vercel req.url and absolute construction
  const fullUrl =
    typeof req.url === 'string' && req.url.startsWith('http')
      ? req.url
      : `https://dummy${req.url || ''}`; // prefix to satisfy URL() when path-only
  const url = new URL(fullUrl);
  const searchParams = url.searchParams;
  const diag = searchParams.get('diag') === '1';

  try {
    // New param names
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const payer = searchParams.get('payer');
    const category = searchParams.get('category');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    // Person/member filters (new + legacy)
    const personId = searchParams.get('personId') || searchParams.get('PersonId');
    const memberId =
      searchParams.get('memberId') ||
      searchParams.get('MemberId') ||
      searchParams.get('mpId');

    // Pagination (new + legacy)
    const limitRaw = searchParams.get('limit') ?? searchParams.get('Take') ?? '100';
    const offsetRaw = searchParams.get('offset') ?? searchParams.get('Skip') ?? '0';
    const limit = Math.min(parseInt(limitRaw, 10) || 100, 500);
    const offset = parseInt(offsetRaw, 10) || 0;

    const BASE_URL = process.env.DATASETTE_BASE_URL; // e.g. https://parlparse.example.com
    const DB = process.env.DATASETTE_DB || 'parlparse';

    if (!BASE_URL) {
      return res.status(500).json({
        error: 'Missing DATASETTE_BASE_URL env var',
        hint: 'Set this in Vercel → Project → Settings → Environment Variables',
        diag: diag ? { haveBaseUrl: !!BASE_URL, db: DB } : undefined,
      });
    }

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

    const constructedUrl = dsURL.toString();

    const upstream = await fetch(constructedUrl, { headers });

    if (!upstream.ok) {
      const bodyText = await upstream.text();
      return res.status(502).json({
        error: 'Datasette error',
        status: upstream.status,
        detailSnippet: bodyText.slice(0, 500),
        ...(diag ? { constructedUrl } : {}),
      });
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

    const payload = {
      results: mapped,
      page: { limit, offset, nextOffset: hasMore ? offset + limit : null },
      filters: {
        start, end, payer, category,
        minAmount: minAmount ?? null, maxAmount: maxAmount ?? null,
        personId: personId ?? null, memberId: memberId ?? null
      },
      ...(diag ? {
        diag: {
          haveBaseUrl: !!BASE_URL,
          db: DB,
          constructedUrl,
          upstreamCount: Array.isArray(rows) ? rows.length : (rows?.length ?? null),
        }
      } : {})
    };

    // Cache headers (ok on Node)
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({
      error: err?.message || String(err),
      ...(diag ? { stack: err?.stack || null } : {}),
    });
  }
}

export default async function handler(req, res) {
  res.status(200).json({ ok: true, runtime: "node" });
}
