/* Date handling and escaping.
 *
 * Medieval dates are frequently uncertain, and the schema encodes that rather
 * than smoothing it over. Everything here exists to READ that uncertainty without
 * silently upgrading it into false precision:
 *   "1066-10-14"      settled to the day
 *   "1156"            settled only to the year
 *   "1156-04/1156-12" an uncertainty WINDOW — the year is agreed, the month is not
 */

export const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/* Fractional year, for placing a date on the vertical axis.
 * "1066-10-14" -> 1066.78. A year-only date lands on the year boundary, which is
 * the honest reading of a year-only source. A window resolves to its EARLIEST
 * bound — the only end we can place without inventing a date. */
export function frac(date) {
  if (!date) return null;
  const s = String(date);
  if (s.includes('/')) {
    const r = s.match(/^(\d{4}(?:-\d{2}(?:-\d{2})?)?)\//);
    return r ? frac(r[1]) : null;
  }
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] : null, d = m[3] ? +m[3] : null;
  if (mo == null) return y;
  return y + (CUM[mo - 1] + (d ? d - 1 : 15)) / 365;
}

export const yearOf = (d) => (d ? +String(d).slice(0, 4) : null);

/* Human form. Each precision reads as the DIFFERENT claim it is, so a reader is never
 * shown a single settled date the sources don't actually agree on:
 *   circa   -> "c. 1003"
 *   range   -> "between 1379 and 1382"      (one moment, unknown where in a window)
 *   after   -> "after 1070"                 (bounded on one side only)
 *   before  -> "before 8 July 1332"
 */
export function fmtDate(date, precision) {
  if (!date) return 'unknown';
  const s = String(date);
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    return `between ${fmtDate(a)} and ${fmtDate(b)}`;
  }
  const parts = s.split('-');
  let out;
  if (parts.length === 1) out = parts[0];
  else if (parts.length === 2) out = `${MON[+parts[1] - 1]} ${parts[0]}`;
  else out = `${+parts[2]} ${MON[+parts[1] - 1]} ${parts[0]}`;

  if (precision === 'circa') return `c. ${out}`;
  if (precision === 'after') return `after ${out}`;
  if (precision === 'before') return `before ${out}`;
  return out;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* SVG <text> neither wraps nor ellipsises, so long titles must be cut to fit the
 * reserved label column or they run under the gloss panel. */
export const truncate = (s, n) =>
  (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
