import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyResult, plainLookups } from '../scripts/lib/tidy.mjs';

const base = () => ({ goals: [{ kind: 'deal', stage: 'Negotiating', plan: [], runs: [], draft: { body: 'Hi Jane, attached is the updated quote PDF so you can sign by Friday.', based_on: ['Northwind Business Quote deal goal', 'goal w2'] } }] });

test('a draft that says "attached" gets the attach reminder with a short name', () => {
  const r = tidyResult(base());
  assert.equal(r.goals[0].draft.attachment, 'updated quote PDF');
});

test('internal names in "Based on" become plain words', () => {
  const r = tidyResult(base());
  assert.deepEqual(r.goals[0].draft.based_on, ['Northwind Business Quote deal', 'this piece of work']);
});

test('tool names become plain words', () => {
  assert.equal(plainLookups([{ name: 'get_contact' }, { name: 'search_knowledge' }, { name: 'get_contact' }]), 'the contact card and the price list and FAQ');
});

test('a meeting not agreed yet has only tentative future dates', () => {
  const r = tidyResult({ goals: [{ kind: 'meeting', stage: 'Proposed', runs: [], plan: [{ title: 'Kickoff call', start: 4, done: false, date_kind: 'from_email' }, { title: 'Asked', start: -4, done: true, date_kind: 'from_email' }] }] });
  assert.equal(r.goals[0].plan[0].date_kind, 'estimated');
  assert.equal(r.goals[0].plan[1].date_kind, 'from_email');
});
