// /modules/interests.js
function formatGBP(n) {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `£${n}`;
  }
}

function normaliseItem(item) {
  // Ensure we never hand the UI an object where a string is expected
  const source =
    item.payer ??
    item.name ??
    item._raw?.payer_name ??
    item._raw?.organisation ??
    item._raw?.company ??
    item._raw?.value_from ??
    item._raw?.from ??
    'Source not specified';

  // Prefer numeric amount; fall back to parsing any label we kept
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    const num = Number(String(v).replace(/[£,\s]/g, ''));
    return Number.isFinite(num) ? num : null;
  };

  const amountNumber =
    item.amount ??
    parseNum(item.amountLabel) ??
    parseNum(item._raw?.received_value) ??
    parseNum(item._raw?.value) ??
    null;

  return {
    ...item,
    payer: typeof source === 'string' ? source : String(source),
    amount: amountNumber,                      // number for charts/logic
    amountPretty: formatGBP(amountNumber),     // for display
  };
}

export async function fetchInterests(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const res = await fetch(`/api/interests?${qs.toString()}`);
  if (!res.ok) throw new Error(`Interests API error ${res.status}`);
  const data = await res.json();

  const results = Array.isArray(data.results) ? data.results.map(normaliseItem) : [];
  return { results, page: data.page ?? { limit: 0, offset: 0, nextOffset: null } };
}
