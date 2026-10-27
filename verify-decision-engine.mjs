// Offline tests: evaluateDecision engine (errors, cache, sharing, concurrency, breaker, cancel)
// and the Claude draft path with a fake runner / fake CLI. No network, no real Claude.
// Run: node --test experiments/owner-concept/verify-decision-engine.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecisionEngine } from './decision-engine.mjs';
import { reversedAreaQuestions } from './decision-questions.mjs';
import { draftWithClaude, buildDraftInput, DRAFT_SCHEMA, DRAFT_SYSTEM_PROMPT } from './decision-claude.mjs';
import { claudeArgs, childEnv, prepareRuntimeDir, createCliRunner } from './decision-claude-cli.mjs';
import { answersFor, baseContext, fakeJev } from './verify-decision-fixtures.mjs';

const KEY = 'ts-test-key-0123456789';
const engineWith = (fetchImpl, opts = {}) => createDecisionEngine({ apiKey: KEY, fetchImpl, ...opts });
const ctx = (patch = {}) => ({ ...baseContext(), ...patch });

test('engine: invalid, empty or keyless input never reaches Jev and is never dropped', async () => {
  const fetchImpl = fakeJev();
  const invalid = await engineWith(fetchImpl).evaluateDecision(ctx({ text: '010-1234-5678로 연락 주세요' }));
  assert.deepEqual([invalid.status, invalid.route, invalid.reasons[0].code, invalid.claudeRecommended], ['review_needed', 'human_review', 'invalid_context:unredacted_content', false]);
  const empty = await engineWith(fetchImpl).evaluateDecision(ctx({ text: '' }));
  assert.deepEqual([empty.route, empty.reasons[0]], ['insufficient_context', { code: 'no_content', origin: 'rule' }]);
  const keyless = await createDecisionEngine({ keyProvider: () => '', fetchImpl }).evaluateDecision(ctx());
  assert.equal(keyless.reasons[0].code, 'jev_not_configured');
  assert.equal(fetchImpl.calls, 0);
});
test('engine: success carries model, versions, origins, list-price estimate; no key in output', async () => {
  const r = await engineWith(fakeJev()).evaluateDecision(ctx());
  assert.deepEqual([r.status, r.route, r.model, r.provider], ['decided', 'auto_route', 'jev-1.14.0', 'typesafe']);
  assert.deepEqual([r.area.origin, r.signals.origin, r.assignees[0].origin], ['jev', 'jev', 'rule']);
  assert.equal(r.cost.estimatedUsd, (1000 * 0.042) / 1e6); assert.equal(r.cost.billedThisCall, true);
  assert.deepEqual(r.versions, { contract: 'owner-decision/1', questions: 'owner-decision-q2', rules: 'owner-decision-r2' });
  assert.ok(!JSON.stringify(r).includes(KEY));
});
test('engine: failures are explicit review_needed with no probabilities', async () => {
  for (const [status, code] of [[500, 'jev_unavailable'], [429, 'jev_rate_limited'], [529, 'jev_overloaded']]) {
    const r = await engineWith(fakeJev({ status })).evaluateDecision(ctx());
    assert.deepEqual([r.status, r.route, r.reasons[0].code, r.signals, r.area, r.claudeRecommended], ['review_needed', 'human_review', code, null, null, true]);
  }
  const bad = await engineWith(fakeJev({ answers: { action_needed: { type: 'noul', noul: 0.9 } } })).evaluateDecision(ctx());
  assert.equal(bad.reasons[0].code, 'jev_invalid_answer');
  assert.equal(bad.cost.billedThisCall, true); // tokens were consumed even though the answer was rejected
  const slow = await engineWith(fakeJev({ delayMs: 200 }), { timeoutMs: 20 }).evaluateDecision(ctx());
  assert.equal(slow.reasons[0].code, 'jev_timeout');
});
test('engine: cache by content+versions+model; policy re-applied to current candidates; LRU bound', async () => {
  const fetchImpl = fakeJev(), engine = engineWith(fetchImpl, { cacheSize: 2 });
  const first = await engine.evaluateDecision(ctx());
  const again = await engine.evaluateDecision(ctx({ candidates: [{ staffId: 'staff-other', roles: ['homeroom_teacher'] }] }));
  assert.equal(fetchImpl.calls, 1);
  assert.deepEqual([again.cache.hit, again.cost.estimatedUsd, again.cost.billedThisCall, again.jevElapsedMs], [true, 0, false, null]);
  assert.equal(again.assignees[0].staffId, 'staff-other');
  assert.equal(again.cache.key, first.cache.key);
  const reversed = await engineWith(fakeJev(), { questions: reversedAreaQuestions() }).evaluateDecision(ctx());
  const older = await engineWith(fakeJev(), { model: 'jev-1.13.0' }).evaluateDecision(ctx());
  assert.equal(new Set([first.cache.key, reversed.cache.key, older.cache.key]).size, 3);
  await engine.evaluateDecision(ctx({ text: '학생A 내일 결석합니다.' }));
  await engine.evaluateDecision(ctx({ text: '학생A 모레 결석합니다.' }));
  await engine.evaluateDecision(ctx());
  assert.equal(fetchImpl.calls, 4); // evicted, fetched again
  assert.throws(() => createDecisionEngine({ model: 'jev-latest' }), /versioned/);
});
test('engine: identical in-flight requests share one call; it is aborted only when every caller leaves', async () => {
  const fetchImpl = fakeJev({ delayMs: 80 }), engine = engineWith(fetchImpl);
  const a = new AbortController();
  const [r1, r2] = await Promise.all([engine.evaluateDecision(ctx(), { signal: a.signal }), (a.abort(), engine.evaluateDecision(ctx()))]);
  assert.deepEqual([r1.status, r2.status, fetchImpl.calls, fetchImpl.aborted], ['cancelled', 'decided', 1, 0]);
  const both = fakeJev({ delayMs: 80 }), e2 = engineWith(both), c1 = new AbortController(), c2 = new AbortController();
  const pending = [e2.evaluateDecision(ctx(), { signal: c1.signal }), e2.evaluateDecision(ctx(), { signal: c2.signal })];
  setTimeout(() => { c1.abort(); c2.abort(); }, 10);
  assert.deepEqual((await Promise.all(pending)).map(r => r.status), ['cancelled', 'cancelled']);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual([both.calls, both.aborted], [1, 1]);
  const pre = new AbortController(); pre.abort();
  assert.equal((await engineWith(both).evaluateDecision(ctx(), { signal: pre.signal })).status, 'cancelled');
});
test('engine: a shared call is accounted once (usage, cost, failures) with per-consumer provenance', async () => {
  const fetchImpl = fakeJev({ delayMs: 30 }), engine = engineWith(fetchImpl);
  const rs = await Promise.all([1, 2, 3].map(() => engine.evaluateDecision(ctx())));
  assert.equal(fetchImpl.calls, 1);
  assert.deepEqual(rs.map(r => r.cost.billedThisCall).sort(), [false, false, true]);
  assert.deepEqual(rs.map(r => r.cache.shared).sort(), [false, true, true]);
  assert.equal(rs.reduce((s, r) => s + r.cost.estimatedUsd, 0), (1000 * 0.042) / 1e6);
  assert.deepEqual([engine.stats().inputTokens, engine.stats().jevCalls], [1000, 1]);
  const bad = fakeJev({ delayMs: 30, answers: { action_needed: { type: 'noul', noul: 0.9 } } }), e2 = engineWith(bad);
  const fs = await Promise.all([1, 2].map(() => e2.evaluateDecision(ctx())));
  assert.deepEqual(fs.map(r => r.reasons[0].code), ['jev_invalid_answer', 'jev_invalid_answer']);
  assert.deepEqual([fs.filter(r => r.cost.billedThisCall).length, e2.stats().failures, e2.stats().inputTokens], [1, 1, 1000]);
});
test('engine: a throwing or async key provider never rejects or leaks its message', async () => {
  const fetchImpl = fakeJev();
  const thrown = await createDecisionEngine({ keyProvider: () => { throw new Error(`disk ${KEY}`); }, fetchImpl }).evaluateDecision(ctx());
  assert.deepEqual([thrown.status, thrown.reasons[0].code], ['review_needed', 'jev_key_error']);
  assert.ok(!JSON.stringify(thrown).includes(KEY) && !JSON.stringify(thrown).includes('disk'));
  const rejected = await createDecisionEngine({ keyProvider: async () => { throw new Error('io'); }, fetchImpl }).evaluateDecision(ctx());
  assert.equal(rejected.reasons[0].code, 'jev_key_error');
  const asyncKey = await createDecisionEngine({ keyProvider: async () => KEY, fetchImpl }).evaluateDecision(ctx());
  assert.equal(asyncKey.route, 'auto_route');
  assert.equal(fetchImpl.calls, 1);
});
test('engine: bounded concurrency and queue; overflow is review_needed, not dropped', async () => {
  const fetchImpl = fakeJev({ delayMs: 30 }), engine = engineWith(fetchImpl, { concurrency: 2 });
  await Promise.all([1, 2, 3, 4, 5].map(i => engine.evaluateDecision(ctx({ text: `학생A ${i}일 결석` }))));
  assert.deepEqual([fetchImpl.calls, fetchImpl.maxActive], [5, 2]);
  const tight = engineWith(fakeJev({ delayMs: 30 }), { concurrency: 1, maxQueue: 1 });
  const results = await Promise.all([1, 2, 3].map(i => tight.evaluateDecision(ctx({ text: `학생A ${i}일 결석` }))));
  assert.deepEqual(results.map(r => r.reasons[0].code).sort(), ['adapter_busy', 'auto_route_thresholds_met', 'auto_route_thresholds_met']);
});
test('engine: circuit opens after repeated service failures (immediately on auth) and skips calls', async () => {
  let t = 0;
  const fetchImpl = fakeJev({ status: 500 }), engine = engineWith(fetchImpl, { breakerThreshold: 3, now: () => t });
  for (let i = 0; i < 3; i++) await engine.evaluateDecision(ctx({ text: `학생A ${i}일 결석` }));
  const skipped = await engine.evaluateDecision(ctx({ text: '학생A 9일 결석' }));
  assert.deepEqual([skipped.reasons[0].code, fetchImpl.calls], ['jev_circuit_open', 3]);
  t = 31_000; await engine.evaluateDecision(ctx({ text: '학생A 8일 결석' }));
  assert.equal(fetchImpl.calls, 4); // half-open after cooldown
  const auth = fakeJev({ status: 401 }), e2 = engineWith(auth, { now: () => 0 });
  await e2.evaluateDecision(ctx());
  assert.equal((await e2.evaluateDecision(ctx({ text: '학생A 1일 결석' }))).reasons[0].code, 'jev_circuit_open');
  assert.equal(auth.calls, 1);
});

test('claude: args keep tools/MCP/sessions off; env drops every provider secret; run folder guarded', async () => {
  const args = claudeArgs({ schema: DRAFT_SCHEMA, systemPrompt: DRAFT_SYSTEM_PROMPT });
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--no-chrome']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(!args.includes('--bare') && !args.some(a => /bypass|dangerously/i.test(a)));
  assert.ok(DRAFT_SYSTEM_PROMPT.includes('팩트') && DRAFT_SYSTEM_PROMPT.includes('환각 금지') && DRAFT_SYSTEM_PROMPT.includes('추측 금지'));
  const env = childEnv({ USERPROFILE: 'C:\\Users\\x', ANTHROPIC_API_KEY: 'a', ANTHROPIC_BASE_URL: 'b', TYPESAFE_API_KEY: 't', CLAUDE_CONFIG_DIR: 'c', CLAUDE_CODE_USE_BEDROCK: '1', DATABASE_URL: 'd' }, 'win32');
  assert.deepEqual(Object.keys(env).filter(k => /ANTHROPIC|TYPESAFE|CONFIG_DIR|BEDROCK|DATABASE/.test(k)), []);
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  await assert.rejects(prepareRuntimeDir(join(repo, 'work', 'claude-run')), e => e.code === 'runtime_unsafe');
  const dir = await mkdtemp(join(tmpdir(), 'decision-rt-'));
  await mkdir(join(dir, '.claude'));
  await assert.rejects(prepareRuntimeDir(join(dir, 'run')), e => e.code === 'runtime_unsafe');
});
test('claude: draft only for recommended, validated context; output validated; origin visible', async () => {
  const engine = engineWith(fakeJev({ answers: answersFor({ manager: 0.8, area: 'billing' }) }));
  const decision = await engine.evaluateDecision(ctx({ text: '학생A 수강료 환불 가능한가요?' }));
  let asked = 0;
  const runner = output => ({ ask: async ({ input }) => { asked++; assert.ok(input.includes('<<기록-') && !input.includes('staff-manager')); return { output, meta: { models: ['claude-x'], apiEquivalentUsd: 0.01, usage: {}, durationMs: 1, apiMs: 1 } }; } });
  const ok = await draftWithClaude(ctx({ text: '학생A 수강료 환불 가능한가요?' }), decision, { runner: runner({ explanation: '환불은 관리자 확인이 필요합니다.', nextAction: { title: '환불 문의 확인', body: '관리자 검토' }, missingInfo: [], routeConcern: 'none' }) });
  assert.deepEqual([ok.status, ok.origin, ok.model], ['drafted', 'claude-cli', 'claude-x']);
  assert.equal((await draftWithClaude(ctx(), decision, { runner: runner({ explanation: '', nextAction: null, missingInfo: [], routeConcern: 'x' }) })).status, 'invalid_output');
  const auto = await engineWith(fakeJev()).evaluateDecision(ctx());
  assert.equal((await draftWithClaude(ctx(), auto, { runner: runner({}) })).status, 'not_applicable');
  assert.equal((await draftWithClaude(ctx({ text: 'a@b.co' }), decision, { runner: runner({}) })).reason, 'invalid_context');
  const failing = { ask: async () => { throw Object.assign(new Error('x'), { code: 'timeout' }); } };
  assert.equal((await draftWithClaude(ctx(), decision, { runner: failing })).status, 'timeout');
  assert.equal(asked, 2);
  assert.ok(buildDraftInput({ ...ctx(), thread: [], facts: {}, links: {}, knownOpenWork: [] }, decision, 'n1').startsWith('<<기록-n1>>'));
});
test('claude cli: subscription check gates calls; stdin-only input; timeout kills the process', async () => {
  const fake = fileURLToPath(new URL('./verify-decision-fake-cli.mjs', import.meta.url));
  const cwd = await mkdtemp(join(tmpdir(), 'decision-cli-'));
  const args = claudeArgs({ schema: DRAFT_SCHEMA, systemPrompt: DRAFT_SYSTEM_PROMPT });
  const runner = createCliRunner({ command: process.execPath, prefixArgs: [fake], cwd, args, env: childEnv({ ...process.env, ANTHROPIC_API_KEY: 'leak' }), timeoutMs: 400 });
  const r = await runner.ask({ input: '질문 본문' });
  assert.deepEqual([r.output.envHasProviderSecrets, r.output.argsHadBare, r.output.stdinBytes > 0, r.meta.apiEquivalentUsd], [false, false, true, 0.0123]);
  await assert.rejects(runner.ask({ input: 'MODE:hang' }), e => e.code === 'timeout');
  await assert.rejects(runner.ask({ input: 'MODE:bad' }), e => e.code === 'invalid_output');
  const apiLogin = createCliRunner({ command: process.execPath, prefixArgs: [fake, '--fake-auth=api'], cwd, args, env: childEnv(), timeoutMs: 400 });
  await assert.rejects(apiLogin.ask({ input: '질문' }), e => e.code === 'subscription_required');
});
