// Grades a processed result against the hand-made answer key in data/seed.json.
// Used after the Gemini run so the accuracy can be shown, not just claimed.

import { columnOf, isStuck } from '../../public/lib/rules.js';

export function score(seed, processed) {
  const expectedGoal = Object.fromEntries(seed.mails.map((m) => [m.id, m.expected?.goal ?? null]));
  const aiGoal = Object.fromEntries(processed.mails.map((m) => [m.id, m.goal_id ?? null]));

  // Map each AI work item to the answer-key item most of its emails belong to.
  const map = {};
  for (const g of processed.goals) {
    const votes = {};
    for (const id of g.mail_ids) { const k = expectedGoal[id]; if (k) votes[k] = (votes[k] || 0) + 1; }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    map[g.id] = best ? best[0] : null;
  }

  const mails = seed.mails.map((m) => ({ id: m.id, expected: expectedGoal[m.id], got: aiGoal[m.id] ? map[aiGoal[m.id]] : null }));
  const mailsRight = mails.filter((x) => x.expected === x.got).length;

  const items = seed.expected_goals.map((e) => {
    const g = processed.goals.find((x) => map[x.id] === e.key);
    if (!g) return { key: e.key, found: false };
    const col = columnOf(g);
    return {
      key: e.key,
      found: true,
      kind: g.kind === e.kind,
      column: col === e.column,
      stuck: Boolean(e.stuck) === isStuck(g),
    };
  });

  let datedTotal = 0;
  let datedFound = 0;
  for (const [key, steps] of Object.entries(seed.expected_plans || {})) {
    const g = processed.goals.find((x) => map[x.id] === key);
    for (const s of steps.filter((x) => x.date_kind === 'from_email')) {
      datedTotal++;
      if (g && (g.plan || []).some((p) => Math.abs(Math.round(p.start) - s.start) <= 1 || Math.abs(Math.round(p.end ?? p.start) - (s.end ?? s.start)) <= 1)) datedFound++;
    }
  }

  const checks = processed.goals.flatMap((g) => g.draft?.checks || []);
  return {
    generator: processed.generator,
    emails: { right: mailsRight, total: mails.length, wrong: mails.filter((x) => x.expected !== x.got).map((x) => x.id) },
    items: { found: items.filter((x) => x.found).length, total: items.length },
    kinds: { right: items.filter((x) => x.kind).length, total: items.length },
    columns: { right: items.filter((x) => x.column && x.stuck).length, total: items.length },
    dated_steps: { found: datedFound, total: datedTotal },
    draft_checks: { passed: checks.filter((c) => c.verdict === 'pass').length, failed: checks.filter((c) => c.verdict === 'fail').length, total: checks.length },
  };
}

export function scoreLine(s) {
  return `Checked against a hand-made answer key: ${s.emails.right} of ${s.emails.total} emails sorted right, ${s.items.found} of ${s.items.total} pieces of work found, ${s.dated_steps.found} of ${s.dated_steps.total} dated steps found.`;
}
