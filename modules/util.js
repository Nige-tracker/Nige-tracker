// modules/util.js
export const fmtDate = (d) => {
  try { return new Date(d).toLocaleString(); } catch { return d || ""; }
};

export const el = (html) => {
  const div = document.createElement("div");
  div.innerHTML = html.trim();
  return div.firstElementChild;
};

export const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

// --- money + date helpers ---
export function parseAllGBP(text = "") {
  // capture ALL tokens like £26,817.60, £500, £1,200
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

// --- robust payer/source extractor (covers register prose) ---
export function extractSource(raw = "") {
  if (!raw) return "";

  // Normalise whitespace and strip basic HTML tags
  let t = String(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1) Prefer explicit labels first (incl. plural variants)
  const patterns = [
    /\bname of donors?\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?donor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of compan(?:y|ies)\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?company\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bcompany making (?:the )?payment\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bcompany providing (?:the )?benefit\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bemployer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of employer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bsponsor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bdonor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    // Some entries literally start lines like "From GB News Limited, …" or "By XYZ Ltd, …"
    /^\s*from\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /^\s*by\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
  ];
  for (const rx of patterns) {
    const m = rx.exec(t);
    if (m && m[1]) return cleanName(m[1]);
  }

  // 2) If a line begins with "From <org>," later in the paragraph
  {
    const m = /\bfrom\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i.exec(t);
    if (m && m[1]) return cleanName(m[1]);
  }

  // 3) Fallback: first clause that looks like an org/person (Ltd, LLP, PLC etc.)
  const clause = t.split(/[-–—]|,|;/)[0]?.trim() || "";
  if (/\b(ltd|llp|plc|limited|foundation|university|trust|cic|inc\.?|gmbh|s\.?a\.?s?\.?)\b/i.test(clause)) {
    return cleanName(clause);
  }

  return "";
}

function cleanName(s) {
  return String(s)
    .replace(/\s*\(.*?\)\s*$/g, "") // drop trailing (…)
    .replace(/\s*-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
