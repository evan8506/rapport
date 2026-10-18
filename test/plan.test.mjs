import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planView, nextStep, applySend } from '../public/lib/rules.js';
import { renderDates, fmtShort, offsetOf, fmtRange } from '../public/lib/dates.js';

const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const NOW = new Date(2026, 9, 17, 9, 30); // Sat Oct 17 2026, local time

test('dates in email bodies become real dates counted from today', () => {
  assert.equal(renderDates('sign by {{d:+7}} and start {{d:+15}}', NOW), 'sign by Sat, Oct 24 and start Sun, Nov 1');
  assert.equal(renderDates('expired {{d:-7}}', NOW), 'expired Sat, Oct 10');
  assert.equal(fmtShort(0, NOW), 'Oct 17');
  assert.equal(fmtRange(15, 29, NOW), 'Nov 1 – Nov 15');
  assert.equal(offsetOf('2026-10-24', NOW), 7);
});

test('every date marker in the seed is filled in, none left raw', () => {
  for (const m of seed.mails) assert.doesNotMatch(renderDates(m.body, NOW), /\{\{/);
});

test('plan status: done, date passed, next, planned', () => {
  const v = planView(seed.expected_plans.q4);
  const by = Object.fromEntries(v.map((s) => [s.title, s.status]));
  assert.equal(by['Quote requested'], 'done');
  assert.equal(by['Quote valid'], 'overdue');
  assert.equal(by['Reply on the 10% discount'], 'next');
  assert.equal(by['Contract signed'], 'upcoming');
  assert.equal(v.filter((s) => s.status === 'next').length, 1);
});

test('a promise from them that passed shows as date passed', () => {
  const v = planView(seed.expected_plans.nda);
  assert.equal(v.find((s) => s.title === 'Signed NDA back').status, 'overdue');
});

test('steps are shown in date order', () => {
  const v = planView(seed.expected_plans.login);
  const starts = v.map((s) => s.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('sending a reply ticks off the step that was yours today', () => {
  const goal = { status: 'open', kind: 'deal', stage: 'Negotiating', turn: 'me', plan: seed.expected_plans.q4, draft: { mode: 'reply' } };
  const after = applySend(goal);
  assert.equal(after.plan.find((s) => s.title === 'Reply on the 10% discount').done, true);
  assert.equal(nextStep(after.plan).title, 'Contract signed');
  assert.equal(goal.plan.find((s) => s.title === 'Reply on the 10% discount').done, false);
});

test('a nudge does not tick off anything', () => {
  const goal = { status: 'open', kind: 'document', stage: 'Sent', turn: 'them', plan: seed.expected_plans.nda, draft: { mode: 'nudge' } };
  assert.deepEqual(applySend(goal).plan, goal.plan);
});

test('my schedule groups open steps by when they happen and skips finished work', async () => {
  const { agenda } = await import('../public/lib/rules.js');
  const goals = Object.entries(seed.expected_plans).map(([id, plan]) => ({ id, plan, status: ['csv', 'billing'].includes(id) ? 'done' : 'open' }));
  const a = agenda(goals);
  const titles = (k) => a[k].map((s) => s.title);
  assert.deepEqual(titles('overdue'), ['Quote valid', 'Signed NDA back']);
  assert.ok(titles('today').includes('Reply on the 10% discount'));
  assert.ok(titles('this_week').includes('Contract signed'));
  assert.deepEqual(titles('next_week'), ['Four-week pilot']);
  assert.ok(titles('later').includes('Team starts on Fernway'));
  const all = Object.values(a).flat();
  assert.ok(all.every((s) => s.status !== 'done'));
  assert.ok(!all.some((s) => s.goal_id === 'csv'));
});

test('steps you can act on now land in Today with the card action', async () => {
  const { agenda } = await import('../public/lib/rules.js');
  const goals = [
    { id: 'a', status: 'open', turn: 'me', last_moved_days_ago: 0, plan: [{ title: 'Send status update', start: 1, owner: 'me', done: false }] },
    { id: 'b', status: 'open', turn: 'them', last_moved_days_ago: 9, plan: [{ title: 'Follow up on NDA', start: 1, owner: 'me', done: false }] },
    { id: 'c', status: 'open', turn: 'them', last_moved_days_ago: 1, plan: [{ title: 'Kickoff call', start: 1, owner: 'both', done: false }] },
  ];
  const a = agenda(goals);
  assert.deepEqual(a.today.map((s) => s.title).sort(), ['Follow up on NDA', 'Send status update']);
  assert.ok(a.today.every((s) => s.act_now));
  assert.deepEqual(a.this_week.map((s) => s.title), ['Kickoff call']);
});

test('a nudge on a stuck card ticks off your follow-up step', () => {
  const goal = { status: 'open', kind: 'document', stage: 'Sent', turn: 'them', last_moved_days_ago: 9,
    plan: [{ title: 'Signed NDA back', start: -3, owner: 'them', done: false }, { title: 'Follow up on NDA', start: 1, owner: 'me', done: false }],
    draft: { mode: 'nudge' } };
  const after = applySend(goal);
  assert.equal(after.plan[1].done, true);
  assert.equal(after.plan[0].done, false);
});

test('finished work shows nothing as next or late', () => {
  const v = planView([{ title: 'Done', start: -6, owner: 'me', done: true }, { title: 'Next invoice', start: 20, owner: 'me', done: false }, { title: 'Old', start: -2, owner: 'them', done: false }], { closed: true });
  assert.deepEqual(v.map((s) => s.status), ['done', 'upcoming', 'upcoming']);
});
