import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STAGES, advanceStage, isStuck, columnOf, arrangeBoard, relationshipStage, applySend, isValidStage } from '../public/lib/rules.js';
import { assemble } from '../scripts/lib/assemble.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const track = Object.fromEntries(seed.mails.map((m) => [m.id, m.expected]));
const built = assemble(seed, track);
const g = (id) => built.goals.find((x) => x.id === id);

test('stages only move forward and stay inside the fixed list', () => {
  assert.equal(advanceStage('deal', 'Negotiating', 'Proposal sent'), 'Negotiating');
  assert.equal(advanceStage('deal', 'Proposal sent', 'Negotiating'), 'Negotiating');
  assert.equal(advanceStage('deal', 'Proposal sent', 'Made up stage'), 'Proposal sent');
  assert.throws(() => advanceStage('banana', 'x', 'y'));
});

test('seed has six items, one of each kind, all stages valid', () => {
  assert.equal(built.goals.length, 6);
  assert.deepEqual(new Set(built.goals.map((x) => x.kind)), new Set(Object.keys(STAGES)));
  for (const x of built.goals) assert.ok(isValidStage(x.kind, x.stage), `${x.id}: ${x.stage}`);
});

test('seed board: your move 2, waiting 2 (one stuck), done 2', () => {
  const cols = arrangeBoard(built.goals);
  assert.deepEqual(cols.your_move.map((x) => x.id), ['q4', 'login']);
  assert.deepEqual(cols.waiting.map((x) => x.id), ['nda', 'kickoff']);
  assert.equal(cols.done.length, 2);
  assert.ok(isStuck(g('nda')));
  assert.equal(Math.floor(g('nda').last_moved_days_ago), 9);
  assert.ok(!isStuck(g('kickoff')));
});

test('a card opened once loses its "just moved" spot at the top', () => {
  const cols = arrangeBoard(built.goals, new Set(['q4']));
  assert.deepEqual(cols.your_move.map((x) => x.id), ['login', 'q4']);
});

test('every relationship stage appears, Jane is Close', () => {
  const stages = Object.fromEntries(built.people.map((p) => [p.id, p.stage]));
  assert.deepEqual(stages, seed.expected_relationships);
});

test('relationship rule: 90+ days silence is dormant', () => {
  assert.equal(relationshipStage([{ direction: 'in', days_ago: 120 }], []).stage, 'dormant');
});

test('send moves a your-move card to waiting without touching the original', () => {
  const before = g('login');
  const after = applySend({ ...before, draft: { mode: 'reply', next_stage: 'Fix proposed' } });
  assert.equal(columnOf(after), 'waiting');
  assert.equal(after.stage, 'Fix proposed');
  assert.equal(before.turn, 'me');
});

test('nudge on a stuck card clears the stuck mark and restarts the count', () => {
  const after = applySend({ ...g('nda'), draft: { mode: 'nudge' } });
  assert.equal(isStuck(after), false);
  assert.equal(after.last_moved_days_ago, 0);
  assert.equal(after.stage, 'Sent');
});

test('13 emails need no reply (automated mail and thank-you notes)', () => {
  assert.equal(built.no_reply_mail_ids.length, 13);
});
