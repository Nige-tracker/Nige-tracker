// modules/parliament-interests-adapter.js

// --- helpers ---------------------------------------------------------------

function byName(fields = [], name) {
  return fields.find(f => f?.name === name)?.value ?? null;
}
function hasName(fields = [], name) {
  return fields.some(f => f?.name === name);
}
function toISO(dateOnly) {
  if (!dateOnly) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T00:00:00Z` : dateOnly;
}
function parseGBPToNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function formatGBP(n) {
  if (n == null) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n);
  } catch {
    return `£${n}`;
  }
}

// Extract first donor "Name" from Visits.Donors[].values[][] or similar nested shapes
function getFirstDonorName(fields = []) {
  const donorsField = fields.find(f => f?.name === 'Donors' && Array.isArray(f.values));
  if (!donorsField) return null;
  // values is an array of "donor entry arrays" – pick first entry, look for object with name "Name"
  const firstEntry = donorsField.values.find(Array.isArray);
  if (!firstEntry) return null;
  const nameObj = firstEntry.find(v => v?.name === 'Name');
  return nameObj?.value ?? null;
}

// Some entries put the payer into category-specific fields:
function derivePayer(fields = [], categoryName = '', summary = '', hasParent = false) {
  // Category 1/1.1 (Employment & ad hoc): often "PayerName" on parent; child payments may omit it.
  const payerFromEmployment = byName(fields, 'PayerName');
  if (payerFromEmployment) return payerFromEmployment;

  // Category 2 (Donations): "DonorName"
  const donorName = byName(fields, 'DonorName');
  if (donorName) return donorName;

  // Category 3 (Gifts/hospitality): also "DonorName"
  const giftDonor = byName(fields, 'DonorName');
  if (giftDonor) return giftDonor;

  // Category 4 (Visits outside the UK): nested "Donors" array with "Name"
  const visitDonor = getFirstDonorName(fields);
  if (visitDonor) return visitDonor;

  // If not found and summary contains a "Name - £amount" pattern (e.g. "BBC - £46.32")
  // avoid summaries that start with "Payment received on ..."
  if (summary && !/^Payment received on/i.test(summary)) {
    const namePart = summary.split(' - £')[0];
    if (namePart && /[A-Za-z]/.test(namePart)) return namePart.trim();
  }

  // If this is a child record (parentInterestId != null) and payer is missing,
  // it's very likely on the parent – we can show a neutral fallback.
  if (hasParent) return 'Payer in parent entry';

  return 'Source not specified';
}

// Choose the most sensible "received date" per category/entry
function deriveReceivedDate(fields = [], categoryName = '') {
  // Most ad hoc payments: "ReceivedDate"
  const received = byName(fields, 'ReceivedDate');
  if (received) return toISO(received);

  // Gifts/hospitality: "ReceivedDate" (or AcceptedDate if ReceivedDate is null)
  const accepted = byName(fields, 'AcceptedDate');
  if (accepted) return toISO(accepted);

  // Visits: "StartDate" is often the user-visible "when it happened"
  const startDate = byName(fields, 'StartDate');
  if (startDate) return toISO(startDate);

  // Fallback: null
  return null;
}

// Amount is nearly always the "Value" field; fallback to parsing summary (" - £x")
function deriveAmount(fields = [], summary = '') {
  const valueField = byName(fields, 'Value');
  const fromField = parseGBPToNumber(valueField);
  if (fromField != null) return fromField;

  const mm = summary && summary.match(/£([\d,]+(?:\.\d{1,2})?)/);
  if (mm) return parseGBPToNumber(mm[0]);
  return null;
}

// --- main mapper -----------------------------------------------------------

export function mapParliamentItem(it) {
  const fields = it?.fields || [];
  const categoryName = it?.category?.name || '';
  const hasParent = it?.parentInterestId != null;

  const amount = deriveAmount(fields, it?.summary || '');
  const payer = derivePayer(fields, categoryName, it?.summary || '', hasParent);
  const receivedDate = deriveReceivedDate(fields, categoryName);

  const out = {
    id: it?.id,
    personId: it?.member?.id ?? null,
    name: it?.member?.nameDisplayAs ?? null,
    constituency: it?.member?.memberFrom ?? null,

    category: categoryName || null,
    subcategory: it?.category?.number || null,

    payer,
    amount,
    amountPretty: amount != null ? formatGBP(amount) : null,

    receivedDate,
    registeredDate: it?.registrationDate ? toISO(it.registrationDate) : null,

    purpose:
      byName(fields, 'PaymentDescription') ||
      byName(fields, 'Purpose') ||
      null,

    link: (it?.links || []).find(l => l?.rel === 'self')?.href || null,

    // keep raw for debugging
    _raw: it,
  };

  return out;
}
