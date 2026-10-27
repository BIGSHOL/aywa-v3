// Offline tests: key lookup, Jev transport/response boundary, context validation, routing policy.
// No network, no Claude. Run: node --test experiments/owner-concept/verify-decision.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEnvValue, loadTypesafeKey, redactSecret } from './decision-key.mjs';
import { callSystemOne, parseSystemOneResponse, JEV_ENDPOINT, JevCallError } from './decision-jev.mjs';
import { QUESTIONS, validateContext, buildState } from './decision-questions.mjs';
import { applyPolicy, THRESHOLDS } from './decision-policy.mjs';
import { answersFor, baseContext, jsonResponse } from './verify-decision-fixtures.mjs';

const KEY = 'ts-test-key-0123456789';

test('key: parses exactly one TYPESAFE_API_KEY line, quotes, export prefix, last wins', () => {
  const env = 'ANTHROPIC_API_KEY=sk-ant-x\nexport TYPESAFE_API_KEY="first"\nTYPESAFE_API_KEY_MENT=other\nTYPESAFE_API_KEY=last # comment\n';
  assert.equal(extractEnvValue(env), 'last');
  assert.equal(extractEnvValue('TYPESAFE_API_KEY=\n'), null);
  assert.equal(extractEnvValue('X=1\nANTHROPIC_API_KEY=a'), null);
});
test('key: env wins; file path must be absolute; only the one key is returned', async () => {
  assert.deepEqual(await loadTypesafeKey({ env: { TYPESAFE_API_KEY: ' k1 ' } }), { apiKey: 'k1', source: 'env' });
  assert.equal(await loadTypesafeKey({ env: {} }), null);
  await assert.rejects(loadTypesafeKey({ env: {}, secretFile: 'relative/.env' }), /absolute/);
  const dir = await mkdtemp(join(tmpdir(), 'decision-key-'));
  await writeFile(join(dir, '.env'), 'ANTHROPIC_API_KEY=never\nTYPESAFE_API_KEY=from-file\nDB_PASSWORD=never\n');
  const loaded = await loadTypesafeKey({ env: {}, secretFile: join(dir, '.env') });
  assert.deepEqual(Object.keys(loaded).sort(), ['apiKey', 'source']);
  assert.equal(loaded.apiKey, 'from-file');
  assert.equal(redactSecret(`x ${KEY} y`, KEY), 'x [redacted] y');
});

test('jev: pins endpoint/model/no-redirect/no-store; sends state; returns typed answers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return jsonResponse({ model: 'jev-1.14.0', answers: answersFor(), usage: { input_tokens: 900, output_tokens: 40 } }); };
  const r = await callSystemOne({ state: { a: 1 }, questions: QUESTIONS, apiKey: KEY, fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], JEV_ENDPOINT);
  assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].cache, 'no-store');
  assert.deepEqual(JSON.parse(calls[0][1].body).state, { a: 1 });
  assert.equal(JSON.parse(calls[0][1].body).model, 'jev-1.14.0');
  assert.equal(r.answers.action_needed.probability, 0.95);
  assert.equal(r.answers.work_area.choice, 'attendance');
  assert.equal(r.usage.inputTokens, 900);
});
test('jev: rejects aliases and unknown models before any request', async () => {
  let called = false;
  for (const model of ['jev-latest', 'jev-preview', 'gpt']) {
    await assert.rejects(callSystemOne({ state: 'x', questions: QUESTIONS, apiKey: KEY, model, fetchImpl: async () => { called = true; } }), e => e.code === 'config');
  }
  assert.equal(called, false);
});
test('jev: HTTP errors map to codes, never echo the body, never retry', async () => {
  for (const [status, code] of [[401, 'auth'], [429, 'rate_limited'], [529, 'overloaded'], [422, 'request_rejected'], [500, 'http_error']]) {
    let n = 0;
    const fetchImpl = async () => { n++; return new Response(`echo ${KEY} private 학생 text`, { status, headers: { 'retry-after': '7' } }); };
    const e = await callSystemOne({ state: 'x', questions: QUESTIONS, apiKey: KEY, fetchImpl }).catch(err => err);
    assert.equal(e.code, code); assert.equal(n, 1);
    assert.ok(!e.message.includes(KEY) && !e.message.includes('학생'));
    if (status === 429) assert.equal(e.retryAfterMs, 7000);
  }
});
test('jev: timeout vs caller cancel are distinguished; oversized input blocked before fetch', async () => {
  const hang = async (_u, init) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('private detail'))));
  assert.equal((await callSystemOne({ state: 'x', questions: QUESTIONS, apiKey: KEY, timeoutMs: 20, fetchImpl: hang }).catch(e => e)).code, 'timeout');
  const ac = new AbortController(); setTimeout(() => ac.abort(), 10);
  assert.equal((await callSystemOne({ state: 'x', questions: QUESTIONS, apiKey: KEY, signal: ac.signal, fetchImpl: hang }).catch(e => e)).code, 'cancelled');
  let called = false;
  const e = await callSystemOne({ state: '한'.repeat(60_000), questions: QUESTIONS, apiKey: KEY, fetchImpl: async () => { called = true; } }).catch(err => err);
  assert.equal(e.code, 'too_large'); assert.equal(called, false);
});
test('jev: response boundary rejects missing, invented, inconsistent answers and keeps usage', () => {
  const good = () => ({ model: 'jev-1.14.0', answers: answersFor(), usage: { input_tokens: 10, output_tokens: 1 } });
  assert.ok(parseSystemOneResponse(good(), QUESTIONS, 'jev-1.14.0'));
  const bad = [
    { ...good(), model: 'jev-1.13.0' },
    { ...good(), answers: { ...good().answers, second_area: undefined } },
    { ...good(), answers: { ...good().answers, action_needed: { type: 'noul', noul: 1.2 } } },
    { ...good(), answers: { ...good().answers, action_needed: { type: 'choice', choice: 'x' } } },
    { ...good(), answers: { ...good().answers, urgency: { type: 'choice', choice: 'invented', confidence: 0.9, probabilities: { today: 1, this_week: 0, no_deadline: 0 } } } },
    { ...good(), answers: { ...good().answers, urgency: { type: 'choice', choice: 'today', confidence: 0.9, probabilities: { today: 0.5, this_week: 0.1, no_deadline: 0.1 } } } },
    { ...good(), answers: { ...good().answers, urgency: { type: 'choice', choice: 'today', confidence: 0.9, probabilities: { today: 0.2, this_week: 0.7, no_deadline: 0.1 } } } },
  ];
  for (const raw of bad) {
    const e = (() => { try { parseSystemOneResponse(raw, QUESTIONS, 'jev-1.14.0'); } catch (err) { return err; } })();
    assert.ok(e instanceof JevCallError && e.code === 'invalid_response');
    assert.equal(e.usage.inputTokens, 10);
  }
});

test('context: rejects bad dates, future records, unknown roles, unredacted contacts', () => {
  assert.ok(validateContext(baseContext()).ok);
  const issues = patch => validateContext({ ...baseContext(), ...patch }).issues ?? [];
  assert.deepEqual(issues({ today: '2026-02-30' }), ['today']);
  assert.deepEqual(issues({ recordDate: '2026-10-28' }), ['record_date_in_future']);
  assert.deepEqual(issues({ recordDate: '2026-10-26', thread: [{ date: '2026-10-27', text: '나중 글' }] }), ['thread_after_record']);
  assert.deepEqual(issues({ candidates: [{ staffId: 's1', roles: ['admin'] }] }), ['candidates']);
  assert.deepEqual(issues({ knownOpenWork: [{ area: 'none', code: 'x' }] }), ['known_open_work']);
  for (const text of ['연락처 010-1234-5678 로 주세요', '주민 900101-1234567', 'mail a@b.co', '계좌 110-123-456789']) {
    assert.deepEqual(issues({ text }), ['unredacted_content']);
  }
  assert.deepEqual(issues({ facts: { guardian_phone: 1012345678901 } }), ['unredacted_content']);
  assert.ok(validateContext({ ...baseContext(), facts: { amount_won: 330000, overdue: true } }).ok);
  assert.deepEqual(validateContext('x').issues, ['context_not_object']);
});
test('state: no ids, no candidates, dates resolved by code', () => {
  const ctx = validateContext({ ...baseContext(), recordDate: '2026-10-26', thread: [{ date: '2026-10-20', text: '앞선 글' }] }).value;
  const state = buildState(ctx), json = JSON.stringify(state);
  assert.ok(!json.includes('rec-1') && !json.includes('staff-') && !json.includes('candidates'));
  assert.equal(state.record.written, 'yesterday');
  assert.equal(state.record.earlier_messages_in_same_thread[0].written, '7 days before today');
});

const ctxOf = patch => validateContext({ ...baseContext(), ...patch }).value;
test('policy: auto_route only when thresholds, link and eligible candidates all hold; assignees from candidates only', () => {
  const r = applyPolicy(answersFor().parsed, ctxOf({}));
  assert.equal(r.route, 'auto_route'); assert.equal(r.status, 'decided');
  assert.deepEqual(r.assignees, [{ staffId: 'staff-homeroom', role: 'homeroom_teacher', origin: 'rule' }]);
  assert.equal(applyPolicy(answersFor().parsed, ctxOf({ links: {} })).reasons[0].code, 'missing_link');
  assert.equal(applyPolicy(answersFor().parsed, ctxOf({ candidates: [{ staffId: 'm', roles: ['manager'] }] })).reasons[0].code, 'no_eligible_staff');
});
test('policy: no_action is narrow and guarded by code facts, urgency, safety, manager signals', () => {
  const none = { action: 0.05, area: 'none' };
  assert.equal(applyPolicy(answersFor(none).parsed, ctxOf({})).route, 'no_action');
  assert.equal(applyPolicy(answersFor({ ...none, action: THRESHOLDS.actionNo + 0.01 }).parsed, ctxOf({})).reasons[0].code, 'uncertain_action');
  const guarded = applyPolicy(answersFor(none).parsed, ctxOf({ knownOpenWork: [{ area: 'billing', code: 'invoice_overdue' }] }));
  assert.equal(guarded.route, 'human_review'); assert.ok(guarded.reasons.some(x => x.code === 'known_open_work_guard'));
  assert.equal(applyPolicy(answersFor({ ...none, urgency: 'today' }).parsed, ctxOf({})).reasons[0].code, 'signals_conflict_no_action_vs_urgency');
  assert.equal(applyPolicy(answersFor({ ...none, safety: 0.4 }).parsed, ctxOf({})).route, 'manager_review');
  assert.equal(applyPolicy(answersFor({ ...none, area: 'billing', areaP: 0.9 }).parsed, ctxOf({})).route, 'human_review');
});
test('policy: money/personnel/multi-area/unclear never auto-route', () => {
  assert.equal(applyPolicy(answersFor({ area: 'billing', manager: 0.6 }).parsed, ctxOf({})).route, 'manager_review');
  const hr = applyPolicy(answersFor({ area: 'staff_hr', manager: 0.01 }).parsed, ctxOf({}));
  assert.equal(hr.route, 'manager_review'); assert.equal(hr.reasons[0].code, 'personnel_always_reviewed');
  assert.equal(applyPolicy(answersFor({ second: 0.8 }).parsed, ctxOf({})).reasons[0].code, 'multiple_areas');
  assert.equal(applyPolicy(answersFor({ area: 'unclear' }).parsed, ctxOf({})).route, 'insufficient_context');
  assert.equal(applyPolicy(answersFor({ context: 0.2 }).parsed, ctxOf({})).route, 'insufficient_context');
  assert.equal(applyPolicy(answersFor({ areaP: 0.45 }).parsed, ctxOf({})).reasons[0].code, 'uncertain_area');
  const noManager = applyPolicy(answersFor({ manager: 0.9 }).parsed, ctxOf({ candidates: [{ staffId: 't', roles: ['homeroom_teacher'] }] }));
  assert.deepEqual([noManager.route, noManager.reasons.at(-1).code], ['human_review', 'no_eligible_manager']);
});
test('policy r2: a manager signal outranks missing context, keeping the context reason visible', () => {
  const r = applyPolicy(answersFor({ area: 'billing', manager: 0.95, context: 0.25 }).parsed, ctxOf({}));
  assert.equal(r.route, 'manager_review');
  assert.deepEqual(r.reasons.map(x => x.code), ['manager_review_signal', 'context_insufficient']);
  assert.equal(applyPolicy(answersFor({ area: 'unclear', manager: 0.03, context: 0.01 }).parsed, ctxOf({})).route, 'insufficient_context');
});
