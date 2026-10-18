// Small, rule-based clean-ups applied after the Gemini run so the page never
// over-promises or shows internal names. The raw AI records are left untouched.

const TOOL_WORDS = {
  get_contact: 'the contact card',
  get_history: 'past emails',
  get_goal: 'this piece of work',
  search_knowledge: 'the price list and FAQ',
};

export function plainLookups(toolCalls = []) {
  const names = [...new Set(toolCalls.map((c) => TOOL_WORDS[c.name] || 'a record'))];
  if (!names.length) return 'nothing';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function tidyResult(result) {
  for (const g of result.goals) {
    // A draft that says something is attached must show the "attach before sending" reminder.
    const d = g.draft;
    if (d && !d.attachment) {
      const texts = [d.body, ...(d.question?.options || []).map((o) => o.body)];
      const said = texts.map((t) => (t || '').match(/attached (?:is|are) (?:the |our |an |a )?((?:[A-Za-z0-9-]+ ){0,3}(?:PDF|file|document|quote|NDA|contract|invoice|agreement)s?)\b/i)).find(Boolean);
      if (said) d.attachment = said[1].trim();
      else if (texts.some((t) => /\battached\b/i.test(t || ''))) d.attachment = 'the file mentioned in the draft';
    }
    // A meeting whose time is not agreed yet: its future dates are only tentative.
    if (g.kind === 'meeting' && g.stage === 'Proposed') {
      for (const s of g.plan || []) {
        if (!s.done && s.start > 0 && s.date_kind === 'from_email') {
          s.date_kind = 'estimated';
          s.note = s.note || 'Tentative until a time is agreed.';
        }
      }
    }
    // Plain words where the page explains the AI steps.
    for (const r of g.runs || []) {
      if (r.step === 'prepare') {
        const decision = /One decision is yours/.test(r.summary || '') ? ' One decision is yours to make.' : '';
        r.summary = `Looked up ${plainLookups(r.tool_calls)}.${decision}`;
      }
    }
    if (d?.based_on) {
      d.based_on = d.based_on.map((b) => b.replace(/\bgoal\s+w\d+\b/gi, 'this piece of work').replace(/\s+(deal|work|issue)\s+goal\b/gi, ' $1').replace(/\bgoal\b/gi, 'work item'));
    }
  }
  return result;
}
