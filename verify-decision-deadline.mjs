// Offline tests: trusted requestedActionDate -> deterministic deadline (never creates work).
// Run: node --test experiments/owner-concept/verify-decision-deadline.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeadline, relationOf, UNKNOWN_DEADLINE } from './decision-deadline.mjs';
import { validateContext, buildState } from './decision-questions.mjs';
import { createDecisionEngine } from './decision-engine.mjs';
import { answersFor, baseContext, fakeJev } from './verify-decision-fixtures.mjs';

const ctxOn = (today, requestedActionDate, patch = {}) => ({ ...baseContext(), today, recordDate: today, requestedActionDate, ...patch });
const deadline = (today, date) => deriveDeadline(validateContext(ctxOn(today, date)).value);

test('deadline: today, tomorrow across month, year and leap-day boundaries', () => {
  assert.deepEqual(deadline('2026-10-27', '2026-10-27'), { date: '2026-10-27', daysFromToday: 0, relation: 'today', urgency: 'today', source: 'requestedActionDate', origin: 'rule' });
  for (const [today, tomorrow] of [['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2027-02-28', '2027-03-01']]) {
    const d = deadline(today, tomorrow);
    assert.deepEqual([d.daysFromToday, d.relation, d.urgency], [1, 'tomorrow', 'today'], `${today} -> ${tomorrow}`);
  }
  assert.deepEqual([deadline('2026-12-30', '2027-01-06').relation, deadline('2026-12-30', '2027-01-07').relation], ['this_week', 'future']); // 7 vs 8 days, across the year
  assert.deepEqual([deadline('2026-11-01', '2026-10-31').relation, deadline('2026-11-01', '2026-10-31').urgency], ['overdue', 'today']);
  assert.deepEqual([relationOf(2), relationOf(7), relationOf(8), relationOf(-30)], ['this_week', 'this_week', 'future', 'overdue']);
});
test('deadline: unknown without a trusted date; impossible or far dates are rejected, not normalized', () => {
  assert.deepEqual(deriveDeadline(validateContext(baseContext()).value), UNKNOWN_DEADLINE);
  for (const bad of ['2026-02-30', '2026-13-01', '내일', '2026/10/28', 20261028]) {
    assert.deepEqual(validateContext(ctxOn('2026-10-27', bad)).issues, ['requested_action_date'], String(bad));
  }
  assert.ok(validateContext(ctxOn('2026-10-27', '2027-10-28')).ok); // 366 days
  assert.deepEqual(validateContext(ctxOn('2026-10-27', '2027-10-29')).issues, ['requested_action_date']);
  assert.ok(validateContext(ctxOn('2026-10-27', null)).ok);
});
test('deadline is code-only: not sent to Jev and absent dates never become one', () => {
  const state = buildState(validateContext(ctxOn('2026-10-27', '2026-10-28')).value);
  assert.ok(!JSON.stringify(state).includes('2026-10-28') && !JSON.stringify(state).includes('requestedActionDate'));
});
test('a date alone never creates work: completed or cancelled records stay no_action', async () => {
  const done = fakeJev({ answers: answersFor({ action: 0.03, area: 'none', areaP: 0.95, urgency: 'no_deadline' }) });
  const engine = createDecisionEngine({ apiKey: 'k', fetchImpl: done });
  for (const text of ['학생A 보강 수업 진행 완료. 출결 반영함.', '내일 결석한다고 했던 것 취소하고 정상 등원합니다.']) {
    const r = await engine.evaluateDecision(ctxOn('2026-10-27', '2026-10-28', { text }));
    assert.deepEqual([r.status, r.route, r.assignees, r.deadline.urgency], ['decided', 'no_action', [], 'today'], text);
  }
});
test('deadline survives Jev failure and never alters the routed result', async () => {
  const failed = await createDecisionEngine({ apiKey: 'k', fetchImpl: fakeJev({ status: 503 }) }).evaluateDecision(ctxOn('2026-10-27', '2026-10-27'));
  assert.deepEqual([failed.status, failed.signals, failed.deadline.relation], ['review_needed', null, 'today']);
  const engine = createDecisionEngine({ apiKey: 'k', fetchImpl: fakeJev() });
  const withDate = await engine.evaluateDecision(ctxOn('2026-10-27', '2026-11-30'));
  const without = await engine.evaluateDecision(ctxOn('2026-10-27', null));
  assert.deepEqual([withDate.route, withDate.assignees, withDate.cache.key], [without.route, without.assignees, without.cache.key]);
  assert.deepEqual([withDate.deadline.urgency, without.deadline.urgency, withDate.signals.urgency.value], ['future', 'unknown', 'this_week']);
  const invalid = await engine.evaluateDecision(ctxOn('2026-10-27', '2026-02-30'));
  assert.deepEqual([invalid.deadline, invalid.reasons[0].code], [null, 'invalid_context:requested_action_date']);
});
