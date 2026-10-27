// Builds report.json + report.md from saved runs (no network, no AI calls).
//   node decision-eval-report.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CASES } from './decision-eval-cases.mjs';
import { EVAL_DIR } from './decision-eval-budget.mjs';
import { summarize, latency, costSensitivity } from './decision-eval-metrics.mjs';
import { claudeRoute } from './decision-eval.mjs';
import { JEV_PRICE_USD_PER_MTOK, PRICE_SOURCE } from './decision-jev.mjs';
import { BUDGETS } from './decision-eval-budget.mjs';

const read = async name => { try { return JSON.parse(await readFile(join(EVAL_DIR, name), 'utf8')); } catch { return null; } };
const byId = Object.fromEntries(CASES.map(k => [k.id, k]));
const pct = v => (v === null || v === undefined ? '—' : `${(100 * v).toFixed(1)}%`);
const usd = v => (v === null || v === undefined ? '—' : `$${v.toFixed(6)}`);
const jevSignals = r => r.signals && { action: r.signals.actionNeeded.probability >= 0.5, area: r.area.value, manager: r.signals.managerReview.probability >= 0.5, safety: r.signals.safetyConcern.probability >= 0.5 };

export async function buildReport() {
  const [test, dev, rerun, swap, claude, draft, ledger, probe, draftP2, deadlineProbe] = await Promise.all(['run-jev-test.json', 'run-jev-dev.json', 'run-jev-dev-rerun.json', 'run-swap.json', 'run-claude.json', 'run-draft.json', 'ledger.json', 'model-probe.json', 'run-draft-owner-draft-p2.json', 'run-probe-deadline.json'].map(read));
  if (!test) throw new Error('run-jev-test.json missing');
  const jevRows = test.rows.map(r => ({ k: byId[r.id], result: r.result, signals: jevSignals(r.result) }));
  const jev = summarize(jevRows);
  const tokens = test.rows.map(r => r.result.usage?.inputTokens).filter(Number.isFinite);
  const jevModel = [...new Set(test.rows.map(r => r.result.model))];
  const jevUsdPerRecord = tokens.reduce((a, b) => a + b, 0) / tokens.length * JEV_PRICE_USD_PER_MTOK[jevModel[0]] / 1e6;

  let base = null;
  if (claude) {
    const results = Object.assign({}, ...claude.batches.map(b => b.validation?.byId ?? {}));
    const rows = Object.values(results).map(r => { const k = byId[r.id]; return { k, result: claudeRoute(k, r), signals: { action: r.action_needed, area: r.work_area, manager: r.manager_review, safety: r.safety_concern } }; });
    const batchMeta = claude.batches.map(b => ({ records: b.ids.length, ok: b.ok, valid: b.validation?.ok ?? false, wallMs: b.wallMs, apiMs: b.meta?.apiMs, startupMs: b.meta ? b.wallMs - b.meta.apiMs : null, apiEquivalentUsd: b.meta?.apiEquivalentUsd, usage: b.meta?.usage, models: b.meta?.models }));
    const s = claude.single;
    base = { auth: claude.auth, model: [...new Set(claude.batches.flatMap(b => b.meta?.models ?? []))], effort: claude.effort, summary: summarize(rows), batches: batchMeta,
      single: { id: s.ids[0], ok: s.ok, valid: s.validation?.ok ?? false, wallMs: s.wallMs, apiMs: s.meta?.apiMs, startupMs: s.meta ? s.wallMs - s.meta.apiMs : null, apiEquivalentUsd: s.meta?.apiEquivalentUsd, usage: s.meta?.usage },
      agreement: rows.map(r => ({ id: r.k.id, jevRoute: test.rows.find(x => x.id === r.k.id).result.route, claudeRoute: r.result.route, jevArea: test.rows.find(x => x.id === r.k.id).result.area?.value, claudeArea: r.signals.area })) };
  }
  const claudeDraftUsd = draft?.draft?.apiEquivalentUsd ?? null;
  const report = {
    generatedAt: new Date().toISOString(), freeze: test.freeze, versions: test.rows[0].result.versions, ledger: ledger && { jev: ledger.jev.length, claude: ledger.claude.length },
    modelProbe: probe, jev: { model: jevModel, cases: jevRows.length, summary: jev,
      latency: { wallMs: latency(test.rows.map(r => r.wallMs)), transportMs: latency(test.rows.map(r => r.result.jevElapsedMs)), firstCallWallMs: test.rows[0].wallMs, sequentialTotalMs: test.totalWallMs },
      tokens: { inputTotal: tokens.reduce((a, b) => a + b, 0), inputPerRecord: latency(tokens), listUsdPerRecord: jevUsdPerRecord, priceSource: PRICE_SOURCE } },
    swap: swap && swap.rows.map(r => ({ id: r.id, area: r.result.area?.value, route: r.result.route, sameAreaAsTest: r.result.area?.value === test.rows.find(x => x.id === r.id).result.area?.value, sameRouteAsTest: r.result.route === test.rows.find(x => x.id === r.id).result.route })),
    claude: base, draft, draftP2, deadlineProbe,
    sensitivity: claudeDraftUsd === null ? null : { formula: 'usdPerRecord = jevUsdPerRecord + escalationFraction x claudeDraftUsd (Claude API-equivalent list price; subscription marginal bill not measured)', jevUsdPerRecord, claudeDraftUsd,
      table: costSensitivity({ jevUsdPerRecord, claudeUsdPerDraft: claudeDraftUsd, fractions: [jev.escalationFraction, 0.1, 0.25, 0.5, 1] }) },
    dev: { q1r1: dev && dev.rows.map(r => ({ id: r.id, route: r.result.route, ideal: byId[r.id].label.ideal })), q2r2Rerun: rerun && rerun.rows.map(r => ({ id: r.id, route: r.result.route, ideal: byId[r.id].label.ideal, urgency: r.result.signals?.urgency.value })) },
  };
  await writeFile(join(EVAL_DIR, 'report.json'), `${JSON.stringify(report, null, 1)}\n`, 'utf8');
  await writeFile(join(EVAL_DIR, 'report.md'), markdown(report, test), 'utf8');
  return report;
}

function markdown(r, test) {
  const j = r.jev.summary, c = r.claude?.summary;
  const row = (name, f) => `| ${name} | ${f(j)} | ${c ? f(c) : '—'} |`;
  const pr = m => `P ${pct(m.precision)} · R ${pct(m.recall)} (n=${m.n}, FN ${m.fn})`;
  const lines = [
    '# Decision evaluation report', '', `Generated ${r.generatedAt}. Freeze ${r.freeze} · ${JSON.stringify(r.versions)}. Calls recorded: Jev ${r.ledger?.jev} · Claude ${r.ledger?.claude} (shared caps Jev ${BUDGETS.jev} / Claude ${BUDGETS.claude}: evaluation 60/4 + follow-up 2/1 + backend 2/1; incl. models GET, probes, dev, swap).`,
    `Jev model ${r.jev.model.join(', ')} · Claude ${r.claude?.model.join(', ') ?? '—'} (effort ${r.claude?.effort ?? '—'}, ${r.claude ? `${r.claude.auth.authMethod}/${r.claude.auth.subscriptionType}` : ''}). Synthetic held-out test set n=${r.jev.cases}: smoke evidence, not calibration.`, '',
    '| Metric (held-out test, same 32 records) | Jev + rules | Claude -p labels + same rules |', '|---|---|---|',
    row('Ideal route', s => pct(s.routeIdealRate)), row('Acceptable route', s => pct(s.routeAcceptableRate)),
    row('Missed required work (action=true → no_action)', s => s.criticalMisses.join(', ') || 'none'),
    row('Wrong automatic routes', s => s.wrongAutoRoutes.join(', ') || 'none'),
    row('Auto-route coverage of ideal-auto cases', s => pct(s.autoRouteCoverage)), row('Auto-route error rate', s => pct(s.autoRouteErrorRate)),
    row('Escalation fraction (manager/human/insufficient)', s => pct(s.escalationFraction)), row('Route counts', s => JSON.stringify(s.routes)),
    row('Action needed (p≥0.5 / bool)', s => pr(s.action)), row('Manager review', s => pr(s.manager)), row('Safety', s => pr(s.safety)),
    row('Area accuracy (action=true, labelled)', s => (s.areaAccuracy ? `${s.areaAccuracy.correct}/${s.areaAccuracy.n}` : '—')),
    row('Provider failures', s => s.failures.join(', ') || 'none'), '',
    '## Latency and cost', '',
    `- Jev, one record per call (7 questions, one state), sequential: wall p50 ${r.jev.latency.wallMs.p50} ms · p95 ${r.jev.latency.wallMs.p95} ms · max ${r.jev.latency.wallMs.max} ms (first call ${r.jev.latency.firstCallWallMs} ms incl. TLS); transport p50 ${r.jev.latency.transportMs.p50} ms; ${r.jev.cases} records in ${r.jev.latency.sequentialTotalMs} ms total.`,
    `- Jev input tokens/record p50 ${r.jev.tokens.inputPerRecord.p50} (total ${r.jev.tokens.inputTotal}); list-price estimate ${usd(r.jev.tokens.listUsdPerRecord)}/record (${r.jev.tokens.priceSource}; output free; not the internal-plan bill).`,
    ...(r.claude ? [
      ...r.claude.batches.map((b, i) => `- Claude batch ${i + 1}: ${b.records} records, wall ${b.wallMs} ms (API ${b.apiMs} ms, local startup ≈${b.startupMs} ms) → amortized ${Math.round(b.wallMs / b.records)} ms/record batch throughput, not per-record latency; CLI API-equivalent ${usd(b.apiEquivalentUsd)}; tokens ${JSON.stringify(b.usage)}.`),
      `- Claude single record (${r.claude.single.id}): wall ${r.claude.single.wallMs} ms (API ${r.claude.single.apiMs} ms, startup ≈${r.claude.single.startupMs} ms); API-equivalent ${usd(r.claude.single.apiEquivalentUsd)} (system prompt partly served from prompt cache: ${JSON.stringify(r.claude.single.usage)}).`] : []),
    ...(r.draft ? [`- draftWithClaude p1 (${r.draft.id}, route ${r.draft.route}): ${r.draft.draft.status}, ${r.draft.wallMs} ms, API-equivalent ${usd(r.draft.draft.apiEquivalentUsd)}, output ${r.draft.draft.usage?.outputTokens} tokens. Restated the urgency Choice confidence 0.79 as if it were a probability.`] : []),
    ...(r.draftP2 ? [`- draftWithClaude ${r.draftP2.draft.promptVersion} (${r.draftP2.id}, same saved result): ${r.draftP2.draft.status}, ${r.draftP2.wallMs} ms, API-equivalent ${usd(r.draftP2.draft.apiEquivalentUsd)}, output ${r.draftP2.draft.usage?.outputTokens} tokens, cache read ${r.draftP2.draft.usage?.cacheReadTokens}. Decimal/percent claims in draft: ${r.draftP2.draft.status === 'drafted' ? 'none (validator passed)' : r.draftP2.draft.reason}.`] : []),
    '', '## Cost sensitivity (list-price estimates only)', '', `${r.sensitivity?.formula ?? '—'}`, '', '| escalation fraction | USD/record | USD/1,000 records |', '|---|---|---|',
    ...(r.sensitivity?.table ?? []).map(t => `| ${pct(t.escalationFraction)} | ${usd(t.usdPerRecord)} | $${t.usdPer1000Records.toFixed(4)} |`), '',
    '## Follow-up live checks (task c59b2fc3e06b)', '',
    ...(r.deadlineProbe ? [`- Deadline probe P1 (not in the frozen set, text 학생A 내일 결석합니다., requestedActionDate ${r.deadlineProbe.result.deadline.date}): ${r.deadlineProbe.result.model} ${r.deadlineProbe.result.route}; model urgency label ${r.deadlineProbe.result.signals?.urgency.value} (Choice confidence ${r.deadlineProbe.result.signals?.urgency.confidence.toFixed(2)}, not accuracy) vs code deadline ${r.deadlineProbe.result.deadline.relation} -> ${r.deadlineProbe.result.deadline.urgency}; ${r.deadlineProbe.wallMs} ms, ${r.deadlineProbe.result.usage?.inputTokens} input tokens. One record: it shows the field works end to end, not that model date reading is reliable (dev D8 said no_deadline for 내일).`] : []),
    ...(r.draftP2 ? [`- Draft p2 explanation: ${r.draftP2.draft.explanation ?? '(none)'}`] : []), '',
    '## Option-order check (work_area options reversed)', '', ...(r.swap ?? []).map(s => `- ${s.id}: area ${s.area} (${s.sameAreaAsTest ? 'same' : 'DIFFERENT'}), route ${s.route} (${s.sameRouteAsTest ? 'same' : 'DIFFERENT'})`), '',
    '## Per-case (held-out test)', '', '| id | category | ideal | Jev route | action p | area (conf) | mgr p | safety p | ctx p | 2nd p | urgency | Claude route |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...test.rows.map(x => { const s = x.result.signals, a = r.claude?.agreement.find(y => y.id === x.id); const k = CASES.find(y => y.id === x.id);
      return `| ${x.id} | ${k.category} | ${k.label.ideal} | ${x.result.route} | ${s?.actionNeeded.probability ?? '—'} | ${x.result.area ? `${x.result.area.value} (${x.result.area.confidence.toFixed(2)})` : '—'} | ${s?.managerReview.probability ?? '—'} | ${s?.safetyConcern.probability ?? '—'} | ${s?.contextSufficient.probability ?? '—'} | ${s?.secondArea.probability ?? '—'} | ${s ? `${s.urgency.value} (${s.urgency.confidence.toFixed(2)})` : '—'} | ${a?.claudeRoute ?? '—'} |`; }), '',
    '## Dev set (not held-out)', '', `q1/r1: ${(r.dev.q1r1 ?? []).map(d => `${d.id} ${d.route}${d.route === d.ideal ? '' : ` (ideal ${d.ideal})`}`).join(' · ')}`,
    `q2/r2 rerun: ${(r.dev.q2r2Rerun ?? []).map(d => `${d.id} ${d.route} urgency ${d.urgency}`).join(' · ')}`, '',
  ];
  return `${lines.join('\n')}\n`;
}

buildReport().then(r => process.stdout.write(`report written: ideal ${pct(r.jev.summary.routeIdealRate)}, misses ${r.jev.summary.criticalMisses.length}\n`)).catch(e => { process.stderr.write(`failed: ${e.message}\n`); process.exitCode = 1; });
