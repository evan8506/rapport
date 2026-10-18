// Gemini writes real dates ("October 15") into drafts and plans. The demo counts days
// from the moment it is opened, so those dates are turned back into {{d:N}} markers
// (N days from the processing run) and the page shows them as real dates again.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DOW = '(?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day|nesday|sday|urday)?,?\\s+)?';
const RE = new RegExp(`\\b${DOW}${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, 'g');

function monthIndex(name) {
  const n = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(n));
}

export function relativize(text, runDate) {
  if (typeof text !== 'string') return text;
  const base = new Date(runDate);
  base.setHours(0, 0, 0, 0);
  return text.replace(RE, (whole, mon, day, year) => {
    const mi = monthIndex(mon);
    const d = Number(day);
    if (mi < 0 || d < 1 || d > 31) return whole;
    let y = year ? Number(year) : base.getFullYear();
    let date = new Date(y, mi, d);
    // Without a year, pick the closest one (so "January 5" written in December means next year).
    if (!year) {
      const alt = [new Date(y - 1, mi, d), date, new Date(y + 1, mi, d)];
      date = alt.sort((a, b) => Math.abs(a - base) - Math.abs(b - base))[0];
    }
    const n = Math.round((date - base) / 86400000);
    return `{{d:${n >= 0 ? '+' : ''}${n}}}`;
  });
}

// Applies relativize to every text the page shows (not to the raw AI records).
export function relativizeResult(result, runDate) {
  const r = (s) => relativize(s, runDate);
  for (const g of result.goals) {
    g.moved_reason = r(g.moved_reason);
    for (const s of g.plan || []) { s.title = r(s.title); s.note = r(s.note); s.evidence = r(s.evidence); }
    const d = g.draft;
    if (d) {
      d.body = r(d.body);
      d.based_on = (d.based_on || []).map(r);
      d.unverified = (d.unverified || []).map(r);
      d.attachment = r(d.attachment);
      if (d.question) {
        d.question.text = r(d.question.text);
        for (const o of d.question.options) { o.label = r(o.label); o.body = r(o.body); }
      }
      for (const c of d.checks || []) c.evidence = r(c.evidence);
    }
  }
  for (const p of result.people) {
    p.stage_reason = r(p.stage_reason);
    for (const f of p.facts || []) { f.fact = r(f.fact); f.evidence = r(f.evidence); }
  }
  return result;
}
