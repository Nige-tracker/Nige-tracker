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

// --- money + text helpers ---
export function parseGBPFromText(text = "") {
  // Finds the first currency amount like £1,234.56 or 1,234
  const m = text.replace(/[, ]+/g, ",").match(/£?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.(\d{2}))?/);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "");
  const decimals = m[2] ? parseInt(m[2], 10) : 0;
  return parseInt(whole, 10) + (decimals / 100);
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
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`; // YYYY-MM
}
