// modules/interests.js
function gbp(n) {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `£${n}`;
  }
}

function stabilise(item) {
  const payer = typeof item.payer === 'string' ? item.payer : (item.payer != null ? String(item.payer) : 'Source not specified');
  const amountPretty = item.amount != null ? gbp(item.amount) : null;

  return {
    ...item,
    payer,
    amountPretty,
    receivedPretty: item.receivedDate ? new Date(item.receivedDate).toLocaleDateString('en-GB') : null,
    registeredPretty: item.registeredDate ? new Date(item.registeredDate).toLocaleDateString('en-GB') : null,
  };
}

export async function fetchInterests({ personId, start, end, payer, category, limit = 100, offset = 0 } = {}) {
  const qs = new URLSearchParams();
  if (personId) qs.set('personId', String(personId));
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  if (payer) qs.set('payer', payer);
  if (category) qs.set('category', category);
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));

  const res = await fetch(`/api/interests?${qs.toString()}`);
  if (!res.ok) throw new Error(`Interests API ${res.status}`);
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results.map(stabilise) : [];
  return { results, page: data.page ?? { limit, offset, nextOffset: null } };
}
