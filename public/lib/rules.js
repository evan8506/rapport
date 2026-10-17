// Deterministic rules shared by the browser and the seed-processing script.
// Gemini decides what an email means; these rules decide what is "stuck",
// which column a card sits in, and the relationship stage, so they never drift.

export const STAGES = {
  deal: ['Requested', 'Proposal sent', 'Negotiating', 'Agreed'],
  issue: ['Reported', 'Investigating', 'Fix proposed', 'Resolved'],
  question: ['Asked', 'Answered', 'Confirmed'],
  meeting: ['Proposed', 'Time agreed', 'Held'],
  document: ['Requested', 'Sent', 'Received'],
  other: ['Open', 'Done'],
};
export const KINDS = Object.keys(STAGES);

export const STUCK_AFTER_DAYS = 7;

// Internal relationship ids and the words shown on screen.
export const RELATIONSHIP_LABEL = {
  new: 'New',
  active: 'Ongoing',
  trusted: 'Close',
  cooling: 'Going quiet',
  dormant: 'Quiet',
};

export function isValidStage(kind, stage) {
  return Boolean(STAGES[kind]) && STAGES[kind].includes(stage);
}

// Stages only move forward. A proposed stage that is unknown or earlier is ignored.
export function advanceStage(kind, current, proposed) {
  const list = STAGES[kind];
  if (!list) throw new Error(`unknown kind: ${kind}`);
  const from = list.indexOf(current);
  const to = list.indexOf(proposed);
  if (to === -1) return current;
  if (from === -1) return proposed;
  return to > from ? proposed : current;
}

export function isFinalStage(kind, stage) {
  const list = STAGES[kind];
  return list[list.length - 1] === stage;
}

export function isStuck(goal) {
  return goal.status === 'open' && goal.turn === 'them' && goal.last_moved_days_ago > STUCK_AFTER_DAYS;
}

export function columnOf(goal) {
  if (goal.status === 'done') return 'done';
  return goal.turn === 'me' ? 'your_move' : 'waiting';
}

// Cards per column, in display order.
//  Your move: a card that moved in the last day and was not opened yet goes first,
//             then the one that has waited longest.
//  Waiting:   stuck cards first, then cards you just sent or nudged, then longest waiting.
//  Done:      most recently finished first.
export function arrangeBoard(goals, opened = new Set()) {
  const cols = { your_move: [], waiting: [], done: [] };
  for (const g of goals) cols[columnOf(g)].push(g);
  const fresh = (g) => g.last_moved_days_ago < 1 && !opened.has(g.id);
  cols.your_move.sort((a, b) => (fresh(b) - fresh(a)) || (b.last_moved_days_ago - a.last_moved_days_ago));
  cols.waiting.sort((a, b) => (isStuck(b) - isStuck(a)) || (Boolean(b.sent) - Boolean(a.sent)) || (b.last_moved_days_ago - a.last_moved_days_ago));
  cols.done.sort((a, b) => a.last_moved_days_ago - b.last_moved_days_ago);
  return cols;
}

export function isFresh(goal, opened = new Set()) {
  return columnOf(goal) === 'your_move' && goal.last_moved_days_ago < 1 && !opened.has(goal.id);
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// How long this person usually takes to answer us, in days (null if never).
export function usualReplyDays(personMails) {
  const byTime = [...personMails].sort((a, b) => b.days_ago - a.days_ago);
  const gaps = [];
  for (let i = 1; i < byTime.length; i++) {
    if (byTime[i - 1].direction === 'out' && byTime[i].direction === 'in') gaps.push(byTime[i - 1].days_ago - byTime[i].days_ago);
  }
  return median(gaps);
}

// Relationship stage by rule. Checked in this order; the first match wins.
//  dormant  no contact for more than 90 days
//  cooling  an open item is waiting on them and they have been silent for more than
//           7 days and more than twice their usual reply time, or no contact for 30+ days
//  trusted  2+ finished items, or 10+ emails both ways over 30+ days
//  new      first contact within 14 days, or 2 emails or fewer
//  active   everything else with contact in the last 30 days
export function relationshipStage(personMails, personGoals) {
  if (!personMails.length) return { stage: 'new', facts: { count: 0 } };
  const first = Math.max(...personMails.map((m) => m.days_ago));
  const last = Math.min(...personMails.map((m) => m.days_ago));
  const count = personMails.length;
  const both = personMails.some((m) => m.direction === 'in') && personMails.some((m) => m.direction === 'out');
  const done = personGoals.filter((g) => g.status === 'done').length;
  const usual = usualReplyDays(personMails);
  const waitingOnThem = personGoals.some((g) => g.status === 'open' && g.turn === 'them');
  const facts = { count, first, last, done, usual };

  if (last > 90) return { stage: 'dormant', facts };
  if (waitingOnThem && last > STUCK_AFTER_DAYS && (usual === null || last > 2 * usual)) return { stage: 'cooling', facts };
  if (last > 30) return { stage: 'cooling', facts };
  if (done >= 2 || (both && count >= 10 && first - last >= 30)) return { stage: 'trusted', facts };
  if (first <= 14 || count <= 2) return { stage: 'new', facts };
  return { stage: 'active', facts };
}

export function daysLabel(days) {
  if (days < 0.25) return 'just now';
  if (days < 1) return 'today';
  const n = Math.floor(days);
  return `${n} day${n === 1 ? '' : 's'}`;
}

export function spanLabel(days) {
  if (days < 14) {
    const n = Math.max(1, Math.round(days));
    return `${n} day${n === 1 ? '' : 's'}`;
  }
  const w = Math.round(days / 7);
  return `${w} weeks`;
}

// ---- plan (the schedule Rapport builds for each piece of work) ----

// Each step: { title, start, end?, owner: me|them|both, done, date_kind: from_email|estimated, note? }
// start/end are day offsets from today. Status is a rule, not an AI call:
//   done      the emails show it happened
//   overdue   not done and its date has passed
//   next      the earliest step that is not done and not overdue
//   upcoming  everything later
export function planView(plan = []) {
  const steps = [...plan]
    .map((s, i) => ({ ...s, i, end: s.end ?? s.start }))
    .sort((a, b) => a.start - b.start || a.i - b.i);
  let nextFound = false;
  return steps.map((s) => {
    let status;
    if (s.done) status = 'done';
    else if (Math.round(s.end) < 0) status = 'overdue';
    else if (!nextFound) { status = 'next'; nextFound = true; }
    else status = 'upcoming';
    return { ...s, status };
  });
}

export function nextStep(plan) {
  return planView(plan).find((s) => s.status === 'next') || null;
}

// ---- demo actions (pure: return a new goal, never mutate) ----

// Send on a "Your move" card: the reply goes out, the turn passes to them.
export function applySend(goal) {
  if (goal.status !== 'open') return goal;
  const draft = goal.draft || {};
  const nextStage = draft.next_stage ? advanceStage(goal.kind, goal.stage, draft.next_stage) : goal.stage;
  const mode = draft.mode || 'reply';
  // A reply finishes the step that was waiting on you today.
  const due = mode === 'reply' ? nextStep(goal.plan) : null;
  const plan = due && due.owner === 'me' && Math.round(due.start) <= 0
    ? goal.plan.map((s) => (s.title === due.title && s.start === due.start ? { ...s, done: true } : s))
    : goal.plan;
  return {
    ...goal,
    plan,
    stage: nextStage,
    turn: 'them',
    last_moved_days_ago: 0,
    stage_history: [...(goal.stage_history || []), { stage: nextStage, turn: 'them', days_ago: 0, by: mode === 'nudge' ? 'you (nudge)' : 'you' }],
    sent: true,
    draft: null,
  };
}
