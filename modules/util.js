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
