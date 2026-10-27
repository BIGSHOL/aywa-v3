// Offline tests for the evaluation tooling: metrics, Claude-baseline validation, call budget.
// Run: node --test experiments/owner-concept/verify-decision-eval.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { percentile, binary, scoreCase, summarize, costSensitivity } from './decision-eval-metrics.mjs';
import { validateBaseline, claudeAnswers, buildBaselineInput } from './decision-eval-claude.mjs';
import { createLedger, BudgetExceeded } from './decision-eval-budget.mjs';
import { CASES, contextOf } from './decision-eval-cases.mjs';
import { validateContext } from './decision-questions.mjs';

const k = id => CASES.find(c => c.id === id);
const res = (route, area, extra = {}) => ({ route, area: area ? { value: area } : null, assignees: route === 'auto_route' ? [{ staffId: 's', role: 'desk' }] : [], signals: {}, status: 'decided', ...extra });

test('dataset: labels declared for every case, all contexts valid, placeholders only', () => {
  assert.equal(CASES.length, 40);
  assert.equal(new Set(CASES.map(c => c.id)).size, 40);
  for (const c of CASES) {
    assert.ok(validateContext(contextOf(c)).ok, c.id);
    assert.ok(c.label.ok.includes(c.label.ideal), c.id);
    assert.ok(!/\d{3}-\d{3,4}-\d{4}|@/.test(JSON.stringify(c.record)), c.id);
  }
});
test('metrics: nearest-rank percentiles and precision/recall', () => {
  assert.deepEqual([percentile([5, 1, 3, 2, 4], 50), percentile([5, 1, 3, 2, 4], 95), percentile([], 50)], [3, 5, null]);
  assert.deepEqual(binary([[true, true], [true, false], [false, true], [false, false]]), { tp: 1, fp: 1, fn: 1, tn: 1, n: 4, precision: 0.5, recall: 0.5 });
  assert.equal(binary([[false, false]]).precision, null);
});
test('metrics: a required task routed to no_action is a critical miss; wrong auto-routes are flagged', () => {
  assert.equal(scoreCase(k('T01'), res('no_action', 'none')).criticalMiss, true);
  assert.equal(scoreCase(k('T01'), res('human_review', 'attendance')).criticalMiss, false);
  assert.equal(scoreCase(k('T01'), res('auto_route', 'billing')).wrongAuto, true);       // wrong area
  assert.equal(scoreCase(k('T15'), res('auto_route', 'academic')).wrongAuto, true);      // nothing to do
  assert.equal(scoreCase(k('T12'), res('auto_route', 'billing')).wrongAuto, true);       // money needs a manager
  assert.equal(scoreCase(k('T29'), res('no_action', 'none')).ambiguousNoAction, true);
  const s = summarize([{ k: k('T01'), result: res('auto_route', 'attendance'), signals: { action: true, area: 'attendance', manager: false, safety: false } },
    { k: k('T15'), result: res('human_review', 'none'), signals: { action: true, area: 'none', manager: false, safety: false } }]);
  assert.deepEqual([s.autoRouteCoverage, s.escalationFraction, s.action.fp, s.routeIdealRate], [1, 0.5, 1, 0.5]);
});
test('cost sensitivity follows jev + fraction x claude', () => {
  const [row] = costSensitivity({ jevUsdPerRecord: 0.0001, claudeUsdPerDraft: 0.02, fractions: [0.25] });
  assert.ok(Math.abs(row.usdPerRecord - 0.0051) < 1e-12);
});
test('claude baseline: every id exactly once with valid fields; answers are 1/0 labels', () => {
  const good = id => ({ id, action_needed: true, work_area: 'attendance', urgency: 'today', manager_review: false, safety_concern: false, context_sufficient: true, second_area: false });
  assert.ok(validateBaseline({ results: [good('T01'), good('T02')] }, ['T01', 'T02']).ok);
  assert.deepEqual(validateBaseline({ results: [good('T01')] }, ['T01', 'T02']).problems, ['missing:T02']);
  assert.deepEqual(validateBaseline({ results: [good('T01'), good('T01'), good('X')] }, ['T01']).problems, ['duplicate:T01', 'unknown_id']);
  assert.deepEqual(validateBaseline({ results: [{ ...good('T01'), work_area: 'finance' }] }, ['T01']).problems, ['invalid:T01']);
  assert.deepEqual(validateBaseline({}, ['T01']).problems, ['results_missing']);
  const a = claudeAnswers(good('T01'));
  assert.deepEqual([a.action_needed.probability, a.second_area.probability, a.work_area.confidence, a.work_area.probabilities.billing], [1, 0, 1, 0]);
  const input = buildBaselineInput([k('T01')], contextOf, 'n1');
  assert.ok(input.startsWith('<<records-n1>>') && input.endsWith('<<end-n1>>') && !input.includes('syn-'));
  assert.throws(() => buildBaselineInput([{ ...k('T01'), record: { ...k('T01').record, text: '010-1234-5678' } }], contextOf), /invalid/);
});
test('budget: a call is recorded before sending and refused once the budget is spent', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'decision-ledger-')), 'ledger.json');
  const ledger = createLedger({ file, budgets: { jev: 2, claude: 0 } });
  const done = await ledger.reserve('jev', 'a');
  assert.equal(await createLedger({ file, budgets: { jev: 2, claude: 0 } }).used('jev'), 1); // persisted before the call
  await done('ok');
  await ledger.reserve('jev', 'b');
  await assert.rejects(ledger.reserve('jev', 'c'), BudgetExceeded);
  await assert.rejects(ledger.reserve('claude', 'd'), BudgetExceeded);
});
