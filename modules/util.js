export const fmtDate = (d) => {
  try { return new Date(d).toLocaleString(); } catch { return d || ""; }
};

export const el = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
};

export const escapeHtml = (s="") =>
  s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// --- money + date helpers (replace old versions) ---
export function parseAllGBP(text = "") {
  // Finds ALL £ amounts like £26,817.60 or £500 or 1,200 (with or without £).
  // We prefer tokens that start with £, but will also accept plain numbers with thousands.
  const out = [];
  const rx = /£\s*([0-9][0-9,]*)(?:\.(\d{2}))?/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const whole = m[1].replace(/,/g, "");
    const dec = m[2] ? parseInt(m[2], 10) : 0;
    out.push(parseInt(whole, 10) + dec / 100);
  }
  return out;
}

export function parseLargestGBP(text = "") {
  const all = parseAllGBP(text);
  return all.length ? Math.max(...all) : null;
}

export function inLastDays(dateStr, days = 365) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  const now = new Date();
  const diff = (now - d) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

export function monthKey(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; // YYYY-MM
}

export function extractSource(text = "") {
  if (!text) return "";

  // 1) Normalise
  const t = String(text).replace(/\s+/g, " ").trim();

  // 2) Look for explicit labelled fields first (like TheyWorkForYou / ParlParse)
  //    Covers: Name of donor/company/employer/sponsor; plural forms; "Donor:"; "From:"; "Payer:"
  const patterns = [
    /\bname of donors?\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?donor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of compan(?:y|ies)\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?company\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bemployer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bsponsor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bdonor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bfrom\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bpayer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
  ];

  for (const rx of patterns) {
    const m = rx.exec(t);
    if (m && m[1]) return cleanName(m[1]);
  }

  // 3) Fallback heuristic: first clause that looks like an organisation/person
  //    Prefer chunks containing typical org tokens (Ltd, LLP, PLC, Limited, Foundation, University)
  const clause = t.split(/[-–—]|,|;/)[0]?.trim() || "";
  if (/\b(ltd|llp|plc|limited|foundation|university|trust|cic|inc\.?|gmbh|s\.?a\.?s?\.?)\b/i.test(clause)) {
    return cleanName(clause);
  }

  return "";
}

// Helper to tidy trailing refs/parentheticals
function cleanName(s) {
  return String(s)
    .replace(/\s*\(.*?\)\s*$/g, "")    // drop trailing (…)
    .replace(/\s*-\s*$/g, "")          // trailing dash
    .replace(/\s+/g, " ")              // spaces
    .trim();
}
