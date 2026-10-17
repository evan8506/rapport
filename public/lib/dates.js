// Dates in the demo are stored as day offsets from "now" so the board looks the same
// whenever it is opened. Email bodies carry {{d:+N}} markers that become real dates.

const DAY = 86400000;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dateAt(offsetDays, now = new Date()) {
  return new Date(startOfDay(now).getTime() + Math.round(offsetDays) * DAY);
}

export function fmtDay(offsetDays, now = new Date()) {
  return dateAt(offsetDays, now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtShort(offsetDays, now = new Date()) {
  return dateAt(offsetDays, now).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fmtRange(start, end, now = new Date()) {
  if (end === undefined || end === null || Math.round(end) === Math.round(start)) return fmtShort(start, now);
  return `${fmtShort(start, now)} – ${fmtShort(end, now)}`;
}

const MARK = /\{\{d:([+-]?\d+)\}\}/g;

export function renderDates(text, now = new Date()) {
  return String(text ?? '').replace(MARK, (_, n) => fmtDay(Number(n), now));
}

// Offset in whole days from `now` to an ISO date (yyyy-mm-dd). Used when Gemini returns dates.
export function offsetOf(isoDate, now = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(now).getTime()) / DAY);
}
