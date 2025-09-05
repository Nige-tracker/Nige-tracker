// modules/votes.js
// Parliament API client (keep as-is if you already have one)

export async function fetchDivisionVotes({ memberId, take = 50, skip = 0 } = {}) {
  if (!memberId) throw new Error('memberId required');
  const qs = new URLSearchParams({
    MemberId: String(memberId),
    Take: String(take),
    Skip: String(skip),
    SortOrder: 'DateDescending',
  });
  const url = `https://hansard-api.parliament.uk/Divisions/MemberVotes?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Votes API ${res.status}`);
  return res.json();
}
