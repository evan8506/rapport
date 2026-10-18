import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativize } from '../scripts/lib/relative-dates.mjs';
import { renderDates } from '../public/lib/dates.js';

const RUN = '2026-10-18T10:00:00.000Z';

test('written dates become day markers counted from the run', () => {
  assert.equal(relativize('promised by October 15, start on Nov 2', RUN), 'promised by {{d:-3}}, start on {{d:+15}}');
  assert.equal(relativize('by Sunday, October 25th', RUN), 'by {{d:+7}}');
  assert.equal(relativize('on Oct. 28, 2026', RUN), 'on {{d:+10}}');
});

test('a month name without a day is left alone', () => {
  assert.equal(relativize('sign in October', RUN), 'sign in October');
  assert.equal(relativize('May I ask', RUN), 'May I ask');
});

test('opened a week later, the same text shows dates a week later', () => {
  const marked = relativize('promised by October 15', RUN);
  assert.equal(renderDates(marked, new Date(2026, 9, 25)), 'promised by Thu, Oct 22');
});
