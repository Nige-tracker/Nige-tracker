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

// --- payer/source extraction ---
export function extractSource(raw = "") {
  if (!raw) return "";
  let t = String(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1) Explicit labels (most reliable)
  const patterns = [
    /\bname of donors?\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?donor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of compan(?:y|ies)\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of (?:the\s*)?company\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bcompany making (?:the )?payment\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bcompany providing (?:the )?benefit\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bname of employer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bemployer\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bsponsor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /\bdonor\s*:\s*([^.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /^\s*from\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
    /^\s*by\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i,
  ];
  for (const rx of patterns) {
    const m = rx.exec(t);
    if (m && m[1]) return cleanName(m[1]);
  }

  // 2) If present anywhere: "from X,"
  {
    const m = /\bfrom\s+([^,.;\n]+?)(?:[,.;](?:\s|$)|$)/i.exec(t);
    if (m && m[1]) return cleanName(m[1]);
  }

  // 3) Phrase immediately before "payment received" often names payer (e.g., "GB News Limited - Payment received …")
  {
    const m = /([A-Z][^.\n]{2,100}?)\s*[-–—,:]?\s*(?:payment\s+(?:of\s+)?received|date\s+received|received\s+on)\b/i.exec(t);
    if (m && m[1]) {
      const guess = cleanName(m[1]);
      if (isOrgLike(guess)) return guess;
    }
  }

  // 4) Fallback: any org-like token anywhere in the text
  const fallback = findOrgLike(t);
  if (fallback) return fallback;

  return "";
}

function cleanName(s) {
  return String(s)
    .replace(/\s*\(.*?\)\s*$/g, "")
    .replace(/\s*-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isOrgLike(s) {
  return /\b(ltd|limited|llp|plc|group|holdings?|media|broadcast(ing)?|company|foundation|university|trust|cic|inc\.?|corp\.?|gmbh|s\.?a\.?s?\.?)\b/i.test(s);
}

// Scan for an org-like name anywhere in a sentence.
export function findOrgLike(text = "") {
  const rx = /\b([A-Z][A-Za-z0-9&().'’\- ]{2,80}?\s(?:Ltd|Limited|LLP|PLC|Group|Holdings?|Media|Broadcast(?:ing)?|Company|Foundation|University|Trust|CIC|Inc\.?|Corp\.?|GmbH|S\.?A\.?S?\.?))\b/gi;
  let m;
  const seen = new Set();
  while ((m = rx.exec(text)) !== null) {
    const name = cleanName(m[1]);
    if (name && !seen.has(name)) {
      seen.add(name);
      return name; // first reasonable hit
    }
  }
  return "";
}
