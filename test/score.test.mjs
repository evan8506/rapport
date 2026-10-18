import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemble } from '../scripts/lib/assemble.mjs';
import { score } from '../scripts/lib/score.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const track = () => Object.fromEntries(seed.mails.map((m) => [m.id, { ...m.expected }]));

test('a perfect result scores full marks', () => {
  const s = score(seed, assemble(seed, track(), seed.expected_plans));
  assert.equal(s.emails.right, s.emails.total);
  assert.equal(s.items.found, 6);
  assert.equal(s.dated_steps.found, s.dated_steps.total);
});

test('an email put in the wrong work item is counted as wrong', () => {
  const t = track();
  t.m19 = { ...t.m19, goal: 'kickoff', kind: 'meeting', stage: 'Proposed', turn: 'me' };
  const s = score(seed, assemble(seed, t, seed.expected_plans));
  assert.equal(s.emails.right, s.emails.total - 1);
  assert.deepEqual(s.emails.wrong, ['m19']);
});

test('a missing dated step lowers the dated-step count', () => {
  const plans = structuredClone(seed.expected_plans);
  plans.q4 = plans.q4.filter((s) => s.title !== 'Contract signed');
  const s = score(seed, assemble(seed, track(), plans));
  assert.equal(s.dated_steps.found, s.dated_steps.total - 1);
});

test('newsletters filed as work count as wrong', () => {
  const t = track();
  t.n02 = { needs_reply: true, goal: 'q4', kind: 'deal', stage: 'Requested', turn: 'me' };
  const s = score(seed, assemble(seed, t, seed.expected_plans));
  assert.ok(s.emails.wrong.includes('n02'));
});
