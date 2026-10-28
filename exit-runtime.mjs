// Exit insight service (INSIGHT-EXITS.md): code decomposition + case files + clusters for any two billing months, and a
// background AI queue for the scheduled pairs only. Results live in <flow store>/exit-insight/state.json keyed by the
// exact pseudonymous input, so a refresh, poll or restart never repeats a call. view() is read-only: it never calls AI.
import { join } from 'node:path';
import { openStore } from './flow-store.mjs';
import { buildExitIndex, addMonths } from './exit-index.mjs';
import { decompose, ITEM_GROUPS, REGULAR_BUCKETS, DEPARTED_KINDS, NEW_KINDS } from './exit-billing.mjs';
import { buildCaseFile, makeMasker } from './exit-cases.mjs';
import { buildClusters, KIND_LABEL } from './exit-clusters.mjs';
import * as AI from './exit-ai.mjs';
import { TRANSIENT } from './flow-hierarchy-providers.mjs';

export const BUDGET = Object.freeze({ jevPerHour: 240, claudePerHour: 24, retryAfterMs: 10 * 60_000, maxAttempts: 2 });
const HOUR = 3_600_000;
const fresh = () => ({ revision: 0, updatedAt: null, results: {}, ledger: { jev: [], claude: [] } });
export const modelLabel = m => { const x = /^claude-(sonnet|opus|haiku)-(\d+)-(\d+)/.exec(m || ''); return x ? `Claude ${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}` : /^jev-/.test(m || '') ? `Jev ${m.slice(4)}` : null; };
export const openInsightStore = ({ dir, identity, lock }) => openStore({ dir: join(dir, 'exit-insight'), identity, lock });

// The model writes particles for the pseudonym ("T-1a2b3c4d는"); after the local name goes in, the particle follows the name's
// last sound (김화영 → 은, 박선생 → 이, 중3 TP4G (~26.07.09) → 9 '구' → 가). Hangul by its final consonant, digits by their Korean
// reading, Latin letters by their spoken ending (l·m·n). Pseudonyms with no label (fact ids) drop with their particle.
const PAIRS = [['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'], ['으로', '로'], ['이며', '며'], ['이고', '고'], ['이나', '나'], ['이라', '라'], ['이다', '다'], ['이었', '였'], ['이에요', '예요']];
const PARTICLE = Object.fromEntries(PAIRS.flatMap(pair => pair.map(p => [p, pair])));
function lastSound(text) {
  const ch = String(text).replace(/[^0-9A-Za-z가-힣]+$/u, '').at(-1) || '';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) { const j = (code - 0xac00) % 28; return { final: j > 0, rieul: j === 8 }; }
  if (/\d/.test(ch)) return { final: '013678'.includes(ch), rieul: '178'.includes(ch) };
  // A Latin word is read as a word (TOP 탑, Jane 제인, Green 그린, Elsa 엘사); letters without a vowel are spelled (SKY, LT).
  const run = (String(text).replace(/[^0-9A-Za-z가-힣]+$/u, '').match(/[A-Za-z]+$/) || [''])[0].toLowerCase();
  if (run.length >= 3 && /[aeiou]/.test(run)) return /(?:[mnl]e|[ptkmnl]|ck|ng)$/.test(run) ? { final: true, rieul: /le?$/.test(run) } : { final: false, rieul: false };
  return { final: /[lmn]/i.test(ch), rieul: /l/i.test(ch) };
}
export function withParticle(name, particle) {
  const pair = PARTICLE[particle]; if (!pair) return name + particle;
  const { final, rieul } = lastSound(name);
  return name + (pair[0] === '으로' ? (final && !rieul ? '으로' : '로') : final ? pair[0] : pair[1]);
}
const TAGGED = new RegExp(`${AI.ID.source}(${Object.keys(PARTICLE).sort((a, b) => b.length - a.length).join('|')})?`, 'g');
/** Validated AI text → local labels with matching particles. Unknown pseudonyms stay as they are.
 *  `mark` wraps only the name the code put in (the particle stays outside) — the screen shows those names in bold. */
export const renderKorean = (text, labelOf, mark = x => x) => (typeof text === 'string' ? text.replace(TAGGED, (match, particle = '') => {
  const label = labelOf(match.slice(0, 10));
  if (label == null) return match;
  if (label === '') return '';
  return mark(label) + (particle ? withParticle(label, particle).slice(label.length) : '');
}) : text);
/** Names the code put into AI text are wrapped in ⟦ ⟧ for the screen (원장 10-28 "볼드나 밑줄 등의 서식도 적극적으로 활용"). */
export const NAME_MARK = x => `⟦${x}⟧`;

/** Pairs analysed by AI: consecutive months of the screen range whose billing fell, and the first → last month of that range. */
export function scheduledPairs(ix, months) {
  const total = m => [...(ix.monthly.get(m)?.values() || [])].reduce((n, s) => n + s.total, 0), out = [];
  for (let i = 1; i < months.length; i += 1) if (total(months[i]) < total(months[i - 1])) out.push([months[i - 1], months[i]]);
  if (months.length > 2 && total(months.at(-1)) < total(months[0])) out.push([months[0], months.at(-1)]);
  return out;
}

export function createExitInsight({ source, v2, asOf, months, overlay, providers = null, disabledReason = null, budget = BUDGET, clock = () => Date.now(), log = () => {} }) {
  const ix = buildExitIndex(source, v2, { asOf }), mask = makeMasker(source), periods = [...ix.monthly.keys()].filter(m => m <= ix.thisMonth).sort();
  const scheduled = scheduledPairs(ix, months), isScheduled = (a, b) => scheduled.some(([x, y]) => x === a && y === b);
  const pairs = new Map(), jobs = new Map(), queue = [], running = { jev: 0, claude: 0 }, abort = new AbortController();
  const data = () => overlay.state.exitInsight || fresh();
  const starts = { jev: [...(data().ledger?.jev || [])], claude: [...(data().ledger?.claude || [])] };
  let closed = false, wake = null, scheduledTick = false, writes = Promise.resolve(), version = 0;
  const retryable = r => r?.status === 'error' && TRANSIENT.has(r.code) && (r.attempts || 1) < budget.maxAttempts, due = r => !r || (retryable(r) && clock() >= r.retryAt);
  const done = (key, r) => r?.status === 'ready' || (r?.status === 'error' && !jobs.has(key) && !retryable(r));

  function pair(from, to) {
    const id = `${from}|${to}`; if (pairs.has(id)) return pairs.get(id);
    const d = decompose(ix.monthly, from, to, { kindOf: sid => ix.exitOf(sid)?.kind || 'other', isNew: sid => (ix.studentById.get(sid)?.enrolled_at || '') >= `${from}-01`, subjectsOf: ix.subjectsOf, sessionsOf: ix.sessionsOf });
    const A = ix.monthly.get(from) || new Map(), amountOf = sid => -(A.get(sid)?.total || 0);
    const cases = d.parts[0].studentIds.map(sid => buildCaseFile(ix, v2, sid, { mask, at: to })).filter(Boolean);
    const p = { from, to, d, cases, clusters: buildClusters(cases, ix, { amountOf }), amountOf, alias: AI.pseudonymizer(`${source.identity?.tenantId || 'cs'}|exit|${from}|${to}`) };
    pairs.set(id, p); return p;
  }
  const leafKey = c => (c.needsJev ? AI.inputKey('student', 'jev', AI.studentState(c, asOf)) : null);
  const leafOf = c => { const r = leafKey(c) && data().results[leafKey(c)]; return r?.status === 'ready' ? r.output : null; };
  function cohortPlan(p) {
    const cases = p.cases.map(c => ({ ...c, ai: leafOf(c) }));
    const built = AI.cohortInput({ clusters: p.clusters, cases, departedAmount: p.d.parts[0].amount }, p.alias, mask);
    const base = AI.inputKey('cohort', 'base', built.input), b = data().results[base];
    // 'medium' from the start when the evidence is ambiguous (a third or more of the Jev picks need a person), else after an invalid low answer.
    const leaves = cases.filter(c => c.needsJev), ambiguous = leaves.length > 0 && leaves.filter(c => c.ai?.review).length * 3 >= leaves.length;
    // After an invalid medium answer: one repair try at medium that is told which of its phrases failed, then a final error.
    const failed = r => r?.status === 'error' && r.code === 'invalid_output', escalated = AI.inputKey('cohort', 'escalated', built.input), e = data().results[escalated];
    const tier = !(ambiguous || failed(b)) ? 'base' : failed(e) ? 'repair' : 'escalated', from = tier === 'repair' ? e : tier === 'escalated' && failed(b) ? b : null;
    const hint = from?.samples ? [...new Set(Object.values(from.samples).flat())].slice(0, 8) : [];
    return { built, tier, hint, key: tier === 'base' ? base : tier === 'escalated' ? escalated : AI.inputKey('cohort', 'repair', built.input) };
  }

  function schedule() {
    for (const [from, to] of scheduled) {
      const p = pair(from, to), leaves = p.cases.filter(c => c.needsJev);
      for (const c of leaves) { const key = leafKey(c); if (!jobs.has(key) && due(data().results[key])) enqueue({ provider: 'jev', key, run: signal => runLeaf(c, key, signal) }); }
      if (!leaves.every(c => done(leafKey(c), data().results[leafKey(c)]))) continue;
      const plan = cohortPlan(p); if (!plan.built.clusterIds.length) continue;
      if (!jobs.has(plan.key) && due(data().results[plan.key])) enqueue({ provider: 'claude', key: plan.key, run: signal => runCohort(plan, signal) });
    }
  }
  function enqueue(job) { job.status = 'queued'; jobs.set(job.key, job); queue.push(job); version += 1; }
  const ok = (output, r, extra) => ({ status: 'ready', output, model: r.model || null, elapsedMs: r.elapsedMs ?? null, usage: r.usage || null, apiEquivalentUsd: r.apiEquivalentUsd ?? null, ...extra });
  async function runLeaf(c, key, signal) {
    const r = await providers.jev.decide({ state: AI.studentState(c, asOf), questions: AI.JEV_QUESTIONS, timeoutMs: AI.STAGES.student.timeoutMs }, { signal });
    return ok(AI.leafResult(r.answers, c.cause.origin === 'record' ? c.cause.code : 'unknown'), r, { stage: 'student', provider: 'jev' });
  }
  async function runCohort(plan, signal) {
    const { model, effort } = AI.STAGES.cohort.tiers[plan.tier];
    const r = await providers.claude.ask({ schema: AI.COHORT_SCHEMA, prompt: plan.hint.length ? `${AI.COHORT_PROMPT}
${AI.repairNote(plan.hint)}` : AI.COHORT_PROMPT, model, effort, timeoutMs: AI.STAGES.cohort.timeoutMs, input: plan.built.input }, { signal });
    const v = AI.validateCohort(r.output, plan.built);
    return v.ok ? ok(r.output, r, { stage: 'cohort', provider: 'claude-cli', tier: plan.tier, effort }) : { status: 'error', code: 'invalid_output', issues: v.issues, numbers: v.numbers, samples: v.samples, model: r.model || null, stage: 'cohort', tier: plan.tier, effort };
  }
  const used = kind => { const t = clock(); starts[kind] = starts[kind].filter(x => t - x < HOUR); return starts[kind].length; };
  function pump() {
    if (closed || !providers) return;
    for (const job of queue) {
      if (job.status !== 'queued' || running[job.provider] >= (job.provider === 'jev' ? AI.STAGES.student.concurrency : 1)) continue;
      if (used(job.provider) >= (job.provider === 'jev' ? budget.jevPerHour : budget.claudePerHour)) { job.blocked = 'budget'; continue; }
      job.status = 'running'; job.blocked = null; running[job.provider] += 1; starts[job.provider].push(clock()); version += 1;
      const prev = data().results[job.key];
      job.run(abort.signal).catch(error => ({ status: 'error', code: error?.code || 'failed', retryAt: TRANSIENT.has(error?.code) ? clock() + budget.retryAfterMs : null }))
        .then(r => save(job, { ...r, attempts: (prev?.attempts || 0) + (r.status === 'error' ? 1 : 0) })).catch(() => log('exit_insight_save_failed'))
        .finally(() => { running[job.provider] -= 1; queue.splice(queue.indexOf(job), 1); jobs.delete(job.key); version += 1; if (!closed) reconcile(); });
    }
    arm();
  }
  function save(job, r) {
    if (closed && abort.signal.aborted) return null;
    writes = overlay.transact(async draft => {
      const d = (draft.exitInsight ??= fresh()), at = new Date(clock()).toISOString();
      d.results[job.key] = { ...r, at }; d.ledger = { jev: starts.jev.slice(-500), claude: starts.claude.slice(-500) }; d.revision += 1; d.updatedAt = at;
      return { next: draft, result: null };
    });
    log(`exit-insight ${job.provider} ${r.status === 'ready' ? 'ready' : r.code}`);
    return writes;
  }
  function arm() {
    clearTimeout(wake); wake = null;
    const t = clock(), times = Object.values(data().results).filter(retryable).map(r => r.retryAt);
    for (const kind of ['jev', 'claude']) if (queue.some(j => j.provider === kind && j.blocked === 'budget') && starts[kind].length) times.push(starts[kind][0] + HOUR);
    const next = Math.min(...times.filter(x => x > t));
    if (Number.isFinite(next) && !closed) { wake = setTimeout(reconcile, Math.min(next - t + 50, HOUR)); wake.unref?.(); }
  }
  function reconcile() { if (closed || !providers || scheduledTick) return; scheduledTick = true; setImmediate(() => { scheduledTick = false; if (closed) return; try { schedule(); } catch (e) { log(`exit_insight_plan_failed ${e.code || e.message}`); } pump(); }); }

  // ── read model ──
  const userName = id => ix.userById.get(id)?.display_name || '담당 미지정';
  function analysis(p) {
    if (!isScheduled(p.from, p.to)) return { status: 'not_scheduled', note: '자동 분석은 화면의 여섯 달 중 청구가 줄어든 연속한 두 달과 첫 달 → 마지막 달 비교만 합니다. 이 비교는 코드 집계만 보여 줍니다.' };
    const leaves = p.cases.filter(c => c.needsJev).map(c => ({ key: leafKey(c), r: data().results[leafKey(c)] }));
    const jev = { total: leaves.length, done: leaves.filter(l => l.r?.status === 'ready').length, failed: leaves.filter(l => l.r?.status === 'error' && !retryable(l.r)).length, pending: leaves.filter(l => !done(l.key, l.r)).length, review: leaves.filter(l => l.r?.output?.review).length };
    const plan = jev.pending ? null : cohortPlan(p), r = plan && data().results[plan.key], job = plan && jobs.get(plan.key);
    if (plan && !plan.built.clusterIds.length) return { status: 'complete', note: '설명할 원인 묶음이 없습니다(빠진 학생이 없거나 묶음 조건에 맞는 기록이 없음).', jev, claude: { status: 'skipped' }, output: null, plan };
    const claude = !plan ? { status: 'waiting' } : job ? { status: job.status === 'running' ? 'running' : 'queued', blocked: job.blocked || null } : r?.status === 'ready' ? { status: 'ready', model: r.model, modelLabel: modelLabel(r.model), tier: r.tier, effort: r.effort, at: r.at, elapsedMs: r.elapsedMs }
      : r?.status === 'error' ? { status: 'error', code: r.code, issues: r.issues || [], samples: r.samples || null, retryAt: retryable(r) ? r.retryAt : null } : { status: providers ? 'queued' : 'disabled' };
    const status = !providers && claude.status !== 'ready' ? 'disabled' : claude.status === 'ready' ? (jev.failed ? 'partial' : 'complete') : claude.status === 'error' && !claude.retryAt ? 'error' : jev.pending || ['queued', 'waiting'].includes(claude.status) ? 'queued' : 'running';
    return { status, disabledReason: providers ? null : disabledReason, jev, claude, output: claude.status === 'ready' ? r.output : null, plan };
  }
  function view(from, to) {
    const p = pair(from, to), a = analysis(p), labelOf = ref => { const id = p.alias.reverse(ref); if (!id) return null; if (ref[0] === 'S') return ix.studentById.get(id)?.name; if (ref[0] === 'T') return userName(id); if (ref[0] === 'C') return ix.classById.get(id)?.class_name; if (ref[0] === 'G') return p.clusters.find(c => c.id === id)?.label; return ''; };
    const render = t => renderKorean(t, labelOf, NAME_MARK).replace(/\s{2,}/g, ' ').trim(), factKey = ref => { const v = p.alias.reverse(ref); return v ? v.split('|').slice(1).join('|') || v : null; };
    const aiFor = cid => { const c = a.output?.clusters.find(x => p.alias.reverse(x.id) === cid); return c ? { summary: render(c.summary), confidence: c.confidence, chain: c.chain.map(s => ({ text: render(s.text), facts: s.factIds.map(f => ({ ref: p.alias.reverse(f)?.split('|')[0], key: factKey(f) })) })) } : null; };
    const clusterOf = new Map(); for (const c of p.clusters) for (const m of c.members) (clusterOf.get(m) ?? clusterOf.set(m, []).get(m)).push(c.id);
    const groups = part => Object.values(part.groups).filter(g => g.students || g.amount).map(g => ({ id: g.id, label: g.label, students: g.students, amount: g.amount, studentIds: g.studentIds, ...(g.estimateAmount != null ? { estimateAmount: g.estimateAmount } : {}), ...(g.sessionsChecked != null ? { sessionsChecked: g.sessionsChecked, fewerSessions: g.fewerSessions } : {}) }));
    return { schemaVersion: 1, from, to, asOf, policy: { version: AI.POLICY_VERSION, fingerprint: AI.policyFingerprint() },
      basis: { billing: '청구액은 할인 전 금액에서 할인을 뺀 값입니다. 무효·환불과 테스트 학생은 빼고(수납관리와 같은 계산), 그 달 유효한 청구가 있는 학생을 청구 대상으로 셉니다', subjects: '과목 수 = 그 달 정규 반 수강 기록(휴원·특강·보강 반 제외)', special: '특강·방학·교재 항목은 회차 확정으로 반이 이어진 줄이면 그 반으로, 아니면 청구 항목 설명 문구로 구분했습니다. 설명 문구로 구분한 금액은 추정입니다', teacher: '담당 선생님은 2.0 강사평가의 퇴원율 판정으로 정했습니다(퇴원관리 담당강사·시간표 X와 같은 계산)', cleanup: '일괄 정리 퇴원은 퇴원일 대신 마지막 청구·출석의 다음 달을 이탈 달로 추정했습니다' },
      totals: p.d.totals, check: p.d.check, parts: p.d.parts.map(x => ({ id: x.id, label: x.label, students: x.students, amount: x.amount, groups: groups(x) })),
      clusters: p.clusters.map(c => ({ id: c.id, kind: c.kind, kindLabel: KIND_LABEL[c.kind], label: c.label, members: c.members, amount: c.amount, teacherIds: c.teacherIds, classIds: c.classIds, facts: c.facts.map(f => ({ key: f.key, text: f.text, source: f.source || null, open: f.open || null, counts: f.counts || null })), ai: aiFor(c.id) })),
      overall: a.output ? { summary: render(a.output.overall.summary), reasons: a.output.overall.reasons.map(render), checks: a.output.overall.checks.map(render), clusterIds: a.output.overall.clusterIds.map(g => p.alias.reverse(g)).filter(Boolean) } : null,
      students: p.cases.map(c => { const ai = leafOf(c); return { studentId: c.studentId, name: c.name, label: c.label, kind: c.exit.kind, kindLabel: DEPARTED_KINDS[c.exit.kind] || DEPARTED_KINDS.other, exit: c.exit, amount: p.amountOf(c.studentId), cause: c.cause,
        ai: ai ? { cause: ai.cause, label: ai.causeLabel, confidence: ai.confidence, needsPerson: ai.needsPerson, conflict: !!ai.conflict, review: ai.review, model: 'jev-1.14.0', modelLabel: 'Jev 1.14.0' } : c.needsJev && isScheduled(from, to) && providers ? { status: data().results[leafKey(c)]?.status === 'error' ? 'error' : 'pending' } : null,
        clusterIds: clusterOf.get(c.studentId) || [], facts: c.facts.map(f => ({ key: f.key, kind: f.kind, label: f.label, text: f.text, date: f.date || null, estimate: !!f.estimate, source: f.source || null, open: f.open || null, ...(f.weeks ? { weeks: f.weeks } : {}) })) }; }),
      analysis: { status: a.status, note: a.note || null, disabledReason: a.disabledReason || null, jev: a.jev || null, claude: a.claude || null, budget: { ...budget, jevUsedLastHour: used('jev'), claudeUsedLastHour: used('claude') } },
      labels: { item: ITEM_GROUPS, regular: REGULAR_BUCKETS, departed: DEPARTED_KINDS, new: NEW_KINDS } };
  }
  const total = m => [...(ix.monthly.get(m)?.values() || [])].reduce((n, s) => n + s.total, 0);
  return {
    start: reconcile, periods, scheduled,
    index: () => ({ schemaVersion: 1, asOf, months, periods, totals: periods.map(m => ({ month: m, billed: total(m), students: ix.monthly.get(m)?.size || 0 })), pairs: scheduled.map(([f, t]) => ({ from: f, to: t, delta: total(t) - total(f), status: analysis(pair(f, t)).status })), defaultPair: scheduled.find(([f, t]) => addMonths(f, 1) === t && t === months.at(-1)) || scheduled[0] || null }),
    view, has: m => periods.includes(m), stats: () => ({ queued: queue.filter(j => j.status === 'queued').length, running: { ...running }, version }),
    async idle() { for (;;) { await new Promise(r => setImmediate(r)); if (!scheduledTick && !queue.length) { await writes.catch(() => {}); return; } await new Promise(r => setTimeout(r, 5)); } },
    async close() { closed = true; clearTimeout(wake); abort.abort(); await writes.catch(() => {}); },
  };
}
