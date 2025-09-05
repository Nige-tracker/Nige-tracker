// modules/interests.js
import { mapParliamentItem } from './parliament-interests-adapter';

function safeDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB') : null;
}

export async function fetchInterests({ url = '/api/interests', params = {} } = {}) {
  // Build query string from params (supports both Parliament params like MemberId and your own)
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }

  const res = await fetch(`${url}?${qs.toString()}`);
  if (!res.ok) throw new Error(`Interests fetch failed ${res.status}`);
  const data = await res.json();

  let results = [];
  // Parliament shape → { items: [...] }
  if (Array.isArray(data.items)) {
    results = data.items.map(mapParliamentItem);
  }
  // Already-normalised shape → { results: [...] }
  else if (Array.isArray(data.results)) {
    results = data.results;
  }

  // light post-formatting for display convenience
  results = results.map(r => ({
    ...r,
    receivedPretty: safeDate(r.receivedDate),
    registeredPretty: safeDate(r.registeredDate),
  }));

  const page = data.page ?? {
    limit: data.take ?? results.length,
    offset: data.skip ?? 0,
    nextOffset: (data.skip ?? 0) + (data.take ?? results.length),
  };

  return { results, page };
}
