// Decision evaluation runner (local dev). Every real call is reserved in the ledger first.
//   node decision-eval.mjs --jev dev|test         sequential Jev, one record per call (7 questions, one state)
//   node decision-eval.mjs --swap T01,T02,...      same records with work_area options reversed
//   node decision-eval.mjs --claude-baseline       2 batch calls (16 records each) + 1 single-record call
//   node decision-eval.mjs --claude-draft T13      1 draftWithClaude on a saved Jev test result
// Key: OWNER_CONCEPT_TYPESAFE_KEY_FILE (absolute) or TYPESAFE_API_KEY. Never printed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDecisionEngine } from './decision-engine.mjs';
import { QUESTIONS, reversedAreaQuestions, validateContext } from './decision-questions.mjs';
import { THRESHOLDS, applyPolicy } from './decision-policy.mjs';
import { loadTypesafeKey } from './decision-key.mjs';
import { CASES, contextOf } from './decision-eval-cases.mjs';
import { createLedger, EVAL_DIR } from './decision-eval-budget.mjs';
import { BASELINE_SCHEMA, BASELINE_SYSTEM_PROMPT, buildBaselineInput, validateBaseline, claudeAnswers } from './decision-eval-claude.mjs';
import { claudeArgs, createCliRunner, prepareRuntimeDir, DEFAULT_RUNTIME } from './decision-claude-cli.mjs';
import { draftWithClaude } from './decision-claude.mjs';

export const FREEZE = createHash('sha256').update(JSON.stringify({ QUESTIONS, THRESHOLDS })).digest('hex').slice(0, 16);
const ledger = createLedger();
const save = async (name, data) => { await mkdir(EVAL_DIR, { recursive: true }); await writeFile(join(EVAL_DIR, name), `${JSON.stringify(data, null, 1)}\n`, 'utf8'); };
const load = async name => JSON.parse(await readFile(join(EVAL_DIR, name), 'utf8'));
const byId = id => { const k = CASES.find(x => x.id === id); if (!k) throw new Error(`unknown case ${id}`); return k; };

async function keyProvider() {
  const loaded = await loadTypesafeKey();
  if (!loaded) throw new Error('no TypeSafe key configured');
  return loaded.apiKey;
}

async function runJev(cases, { questions = QUESTIONS, label }) {
  const engine = createDecisionEngine({ keyProvider, questions, concurrency: 1, timeoutMs: 15_000 });
  const rows = [];
  for (const k of cases) {
    const done = await ledger.reserve('jev', `${label} ${k.id}`);
    const t0 = performance.now();
    const result = await engine.evaluateDecision(contextOf(k));
    const wallMs = Math.round(performance.now() - t0);
    await done(result.signals ? 'ok' : `review:${result.reasons[0]?.code}`);
    rows.push({ id: k.id, wallMs, result });
    process.stdout.write(`${k.id} ${result.route} ${result.area?.value ?? '-'} ${wallMs}ms in=${result.usage?.inputTokens ?? '-'}\n`);
  }
  return { rows, stats: engine.stats() };
}

async function claudeRunner(schema, systemPrompt, maxBudgetUsd) {
  const cwd = await prepareRuntimeDir(process.env.OWNER_CONCEPT_CLAUDE_RUNTIME || DEFAULT_RUNTIME);
  return createCliRunner({ cwd, timeoutMs: 240_000, args: claudeArgs({ schema, systemPrompt, model: 'sonnet', effort: 'low', maxBudgetUsd }) });
}

async function claudeCall(runner, input, purpose) {
  const done = await ledger.reserve('claude', purpose);
  const t0 = performance.now();
  try {
    const r = await runner.ask({ input });
    await done('ok');
    return { ok: true, wallMs: Math.round(performance.now() - t0), output: r.output, meta: r.meta };
  } catch (error) {
    await done(`error:${error?.code}`);
    return { ok: false, wallMs: Math.round(performance.now() - t0), error: error?.code ?? 'unknown' };
  }
}

/** Claude labels through the SAME routing policy (results shaped like DecisionResult for scoring). */
export function claudeRoute(k, r) {
  const ctx = validateContext(contextOf(k)).value;
  const answers = claudeAnswers(r);
  const decision = applyPolicy(answers, ctx);
  return { ...decision, area: { value: r.work_area, origin: 'claude-cli' }, signals: { origin: 'claude-cli', labels: r } };
}

async function main([mode, arg]) {
  if (mode === '--jev') {
    const [split, only] = arg.split(':');
    const cases = CASES.filter(k => k.split === split && (!only || only.split(',').includes(k.id)));
    if (!cases.length) throw new Error('split must be dev or test');
    const t0 = Date.now(), { rows, stats } = await runJev(cases, { label: `jev:${arg}` });
    await save(`run-jev-${split}${only ? '-rerun' : ''}.json`, { split, only: only ?? null, freeze: FREEZE, startedAt: new Date(t0).toISOString(), totalWallMs: Date.now() - t0, stats, rows });
  } else if (mode === '--swap') {
    const cases = arg.split(',').map(byId);
    const { rows, stats } = await runJev(cases, { questions: reversedAreaQuestions(), label: 'swap' });
    await save('run-swap.json', { freeze: FREEZE, at: new Date().toISOString(), stats, rows });
  } else if (mode === '--claude-baseline') {
    const test = CASES.filter(k => k.split === 'test');
    const runner = await claudeRunner(BASELINE_SCHEMA, BASELINE_SYSTEM_PROMPT, 1.5);
    const auth = await runner.checkSubscription();
    const batches = [test.slice(0, 16), test.slice(16)];
    const out = { freeze: FREEZE, at: new Date().toISOString(), auth, model: 'sonnet', effort: 'low', batches: [], single: null };
    for (const [i, cases] of batches.entries()) {
      const call = await claudeCall(runner, buildBaselineInput(cases, contextOf), `baseline batch ${i + 1} (${cases.length} records)`);
      out.batches.push({ ids: cases.map(k => k.id), ...call, validation: call.ok ? validateBaseline(call.output, cases.map(k => k.id)) : null });
      process.stdout.write(`batch ${i + 1}: ${call.ok ? 'ok' : call.error} ${call.wallMs}ms\n`);
    }
    const one = byId(arg || 'T09');
    const call = await claudeCall(runner, buildBaselineInput([one], contextOf), `baseline single ${one.id}`);
    out.single = { ids: [one.id], ...call, validation: call.ok ? validateBaseline(call.output, [one.id]) : null };
    process.stdout.write(`single ${one.id}: ${call.ok ? 'ok' : call.error} ${call.wallMs}ms\n`);
    await save('run-claude.json', out);
  } else if (mode === '--claude-draft') {
    const k = byId(arg);
    const saved = (await load('run-jev-test.json')).rows.find(r => r.id === k.id);
    const runner = await claudeRunner((await import('./decision-claude.mjs')).DRAFT_SCHEMA, (await import('./decision-claude.mjs')).DRAFT_SYSTEM_PROMPT, 0.5);
    const done = await ledger.reserve('claude', `draftWithClaude ${k.id}`);
    const t0 = performance.now();
    const draft = await draftWithClaude(contextOf(k), saved.result, { runner, force: true });
    await done(draft.status);
    await save('run-draft.json', { at: new Date().toISOString(), id: k.id, route: saved.result.route, wallMs: Math.round(performance.now() - t0), draft });
    process.stdout.write(`draft ${k.id}: ${draft.status} ${draft.elapsedMs}ms\n`);
  } else throw new Error('usage: --jev dev|test | --swap ids | --claude-baseline [singleId] | --claude-draft id');
  process.stdout.write(`${JSON.stringify(await ledger.snapshot())}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { process.stderr.write(`failed: ${e.message}\n`); process.exitCode = 1; });
}
