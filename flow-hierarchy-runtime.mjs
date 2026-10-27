// Background AI queue for the issue hierarchy (FLOW-HIERARCHY.md). Results live in a separate
// overlay store (<flow store>/hierarchy-ai/state.json), keyed by stage + tier + exact pseudonymous
// input, so refresh/poll/restart never repeats a call and a changed record re-runs only its
// student, that teacher and the academy summary. view() is read-only: it never enqueues or calls.
import { join } from 'node:path';
import { openStore } from './flow-store.mjs';
import { ADAPTERS, adapterFor, buildHierarchy } from './flow-hierarchy.mjs';
import * as AI from './flow-hierarchy-ai.mjs';
import { TRANSIENT } from './flow-hierarchy-providers.mjs';
import { decorate } from './flow-hierarchy-view.mjs';

export const BUDGET = Object.freeze({ jevPerHour: 240, claudePerHour: 24, retryAfterMs: 10 * 60_000, maxAttempts: 2, keepResults: 3000 });
const HOUR = 3_600_000, LIMIT = { jev: AI.STAGES.student.concurrency, claude: AI.STAGES.teacher.concurrency };
const FINISHED = new Set(['reported', 'not_needed']);

export const openOverlay = ({ dir, identity, lock }) => openStore({ dir: join(dir, 'hierarchy-ai'), identity, lock });
const fresh = () => ({ revision: 0, updatedAt: null, results: {}, last: {}, ledger: { jev: [], claude: [] } });

export function createHierarchyRuntime({ getSource, getState, overlay, providers = null, disabledReason = null, budget = BUDGET, clock = () => Date.now(), log = () => {} }) {
  const jobs = new Map(), queue = [], running = { jev: 0, claude: 0 }, abort = new AbortController();
  const starts = { jev: [...(overlay.state.hierarchy?.ledger?.jev || [])], claude: [...(overlay.state.hierarchy?.ledger?.claude || [])] };
  let version = 0, closed = false, wake = null, scheduled = false, writes = Promise.resolve();
  const boot = Math.random().toString(36).slice(2, 8);
  const data = () => overlay.state.hierarchy || fresh();
  const bump = () => { version += 1; };
  const caseIds = () => Object.values(getState().cases).filter(c => c.kind === 'source' && ADAPTERS[c.signalId]).map(c => c.id);
  const retryable = r => r?.status === 'error' && TRANSIENT.has(r.code) && (r.attempts || 1) < budget.maxAttempts;
  const due = r => !r || (retryable(r) && clock() >= r.retryAt);

  /** Pure plan of one case over the current flow state and stored results. */
  function plan(caseId) {
    const source = getSource(), { tree, index } = buildHierarchy(source, getState(), caseId);
    const alias = AI.pseudonymizer(`${source.identity.tenantId}|${caseId}`), d = data(), today = tree.basis.asOf;
    const look = key => ({ key, result: d.results[key] || null, job: jobs.get(key) || null });
    const byStudent = new Map();
    for (const n of index.nodes.values()) {
      if (n.level === 'student') { if (!byStudent.has(n.entityRef.id)) byStudent.set(n.entityRef.id, []); byStudent.get(n.entityRef.id).push(n); }
      alias(n.level === 'student' ? 'S' : n.level === 'class' ? 'C' : 'T', n.level === 'student' ? n.entityRef.id : n.id);
    }
    const leaves = new Map();
    for (const [sid, nodes] of byStudent) {
      const inp = AI.studentInput(nodes, { today, alias });
      leaves.set(sid, { sid, nodes, inp, last: d.last[`${caseId}|student:${sid}`] || null, ...(inp.skip ? { key: null, result: null, job: null } : look(AI.inputKey('student', 'jev', inp.state))) });
    }
    // A child with a retry still pending holds its parent (no second Claude call when it lands); final errors let the parent run as partial.
    const done = e => e.result?.status === 'ready' || (e.result?.status === 'error' && !e.job && !retryable(e.result));
    const settled = l => !!l.inp.skip || done(l);
    const leafOf = sid => (leaves.get(sid)?.result?.status === 'ready' ? leaves.get(sid).result.output : null);
    const shared = AI.sharedInput(tree), teachers = new Map();
    for (const tn of tree.root.children) {
      const sids = [...new Set(tn.children.flatMap(cn => cn.children.map(sn => sn.entityRef.id)))];
      const last = d.last[`${caseId}|${tn.id}`] || null, students = tn.children.reduce((n, cn) => n + cn.children.length, 0);
      if (tn.children.every(cn => cn.children.every(sn => FINISHED.has(sn.flow.state)))) { teachers.set(tn.id, { tn, skip: 'reported', last }); continue; }
      if (!sids.every(sid => settled(leaves.get(sid)))) { teachers.set(tn.id, { tn, waiting: true, last }); continue; }
      const part = AI.teacherInput(tn, { alias, leafOf });
      const partial = sids.some(sid => !leaves.get(sid).inp.skip && !leafOf(sid));
      const baseKey = AI.inputKey('teacher', 'base', part.input), base = d.results[baseKey];
      const tier = sids.some(sid => leafOf(sid)?.uncertain) || (base?.status === 'error' && base.code === 'invalid_output') ? 'escalated' : 'base';
      teachers.set(tn.id, { tn, part, partial, tier, students, last, ...look(tier === 'base' ? baseKey : AI.inputKey('teacher', 'escalated', part.input)) });
    }
    let academy = { waiting: true, last: d.last[`${caseId}|academy`] || null };
    const tl = [...teachers.values()];
    if (tl.every(t => t.skip || (t.part && done(t)))) {
      const stats = {}; for (const l of leaves.values()) { const k = l.inp.skip === 'reported' ? '보고 완료로 생략' : l.inp.skip ? '관리자 검토 요청' : !leafOf(l.sid) ? '판정 없음' : leafOf(l.sid).uncertain ? '사람 확인 필요' : AI.ORDER_LABEL[leafOf(l.sid).priority]; stats[k] = (stats[k] || 0) + 1; }
      const teacherResultOf = id => { const t = teachers.get(id); return t?.result?.status === 'ready' ? { ...t.result.output, partial: t.partial } : null; };
      const input = { ...shared, ...AI.academyInput(tree, { alias, teacherResultOf, leafStats: stats }) };
      const baseKey = AI.inputKey('academy', 'base', input), base = d.results[baseKey];
      const tier = base?.status === 'error' && base.code === 'invalid_output' ? 'escalated' : 'base';
      academy = { input, tier, partial: tl.some(t => t.result?.status === 'error') || [...leaves.values()].some(l => l.result?.status === 'error'), last: academy.last, ...look(tier === 'base' ? baseKey : AI.inputKey('academy', 'escalated', input)) };
    }
    return { caseId, tree, index, alias, leaves, teachers, academy, shared, results: d.results };
  }

  function enqueue(job) { for (const k of job.keys) jobs.set(k, job); queue.push(job); bump(); }
  function schedule(p) {
    for (const l of p.leaves.values()) if (l.key && !l.job && due(l.result)) enqueue({ provider: 'jev', stage: 'student', caseId: p.caseId, keys: [l.key], status: 'queued', marks: [[`student:${l.sid}`, l.key]], attempts: l.result?.attempts || 0, run: signal => runLeaf(l, signal) });
    // Teachers of one tier share a CLI call, packed by student nodes so one call stays bounded. They are packed only
    // once no leaf of the case is still queued or running, so batches form from the whole case, not by arrival order.
    if ([...p.leaves.values()].some(l => jobs.has(l.key))) return;
    for (const tier of ['base', 'escalated']) {
      const todo = [...p.teachers.values()].filter(t => t.part && t.tier === tier && !t.job && due(t.result)).sort((a, b) => b.students - a.students);
      const batches = [];
      for (const t of todo) { const b = batches.find(x => x.length < AI.STAGES.teacher.batchTeachers && x.reduce((n, y) => n + y.students, 0) + t.students <= AI.STAGES.teacher.batchStudents); if (b) b.push(t); else batches.push([t]); }
      for (const b of batches) enqueue({ provider: 'claude', stage: 'teacher', caseId: p.caseId, keys: b.map(t => t.key), status: 'queued', marks: b.map(t => [t.tn.id, t.key]), attempts: Math.max(0, ...b.map(t => t.result?.attempts || 0)), run: signal => runTeachers(b, tier, p.shared, signal) });
    }
    const a = p.academy;
    if (a.key && !a.job && due(a.result)) enqueue({ provider: 'claude', stage: 'academy', caseId: p.caseId, keys: [a.key], status: 'queued', marks: [['academy', a.key]], attempts: a.result?.attempts || 0, run: signal => runAcademy(a, signal) });
  }

  const ok = (output, r, extra = {}) => ({ status: 'ready', output, model: r.model || null, elapsedMs: r.elapsedMs ?? null, usage: r.usage || null, apiEquivalentUsd: r.apiEquivalentUsd ?? null, ...extra });
  async function runLeaf(l, signal) {
    const r = await providers.jev.decide({ state: l.inp.state, questions: AI.STUDENT_QUESTIONS, timeoutMs: AI.STAGES.student.timeoutMs }, { signal });
    return { [l.key]: ok(AI.leafResult(r.answers, l.inp), r, { stage: 'student', provider: 'jev', effort: null }) };
  }
  async function runTeachers(batch, tier, shared, signal) {
    const { model, effort } = AI.STAGES.teacher.tiers[tier];
    const r = await providers.claude.ask({ schema: AI.TEACHER_SCHEMA, prompt: AI.TEACHER_PROMPT, model, effort, timeoutMs: AI.STAGES.teacher.timeoutMs, input: { ...shared, 강사들: batch.map(t => t.part.input) } }, { signal });
    const verdict = AI.validateTeacherBatch(r.output, batch.map(t => t.part), shared), out = {};
    for (const t of batch) { const v = verdict.get(t.part.id); out[t.key] = v.ok ? ok(v.output, r, { stage: 'teacher', provider: 'claude-cli', tier, effort, partial: t.partial }) : { status: 'error', code: 'invalid_output', issues: v.issues, numbers: v.numbers, model: r.model || null, stage: 'teacher', tier, effort }; }
    return out;
  }
  async function runAcademy(a, signal) {
    const { model, effort } = AI.STAGES.academy.tiers[a.tier];
    const r = await providers.claude.ask({ schema: AI.ACADEMY_SCHEMA, prompt: AI.ACADEMY_PROMPT, model, effort, timeoutMs: AI.STAGES.academy.timeoutMs, input: a.input }, { signal });
    const v = AI.validateAcademy(r.output, a.input);
    return { [a.key]: v.ok ? ok(r.output, r, { stage: 'academy', provider: 'claude-cli', tier: a.tier, effort, partial: a.partial }) : { status: 'error', code: 'invalid_output', issues: v.issues, numbers: v.numbers, model: r.model || null, stage: 'academy', tier: a.tier, effort } };
  }

  const used = kind => { const t = clock(); starts[kind] = starts[kind].filter(x => t - x < HOUR); return starts[kind].length; };
  const allowed = kind => used(kind) < (kind === 'jev' ? budget.jevPerHour : budget.claudePerHour);
  function pump() {
    if (closed || !providers) return;
    for (const job of queue) {
      if (job.status !== 'queued' || running[job.provider] >= LIMIT[job.provider]) continue;
      if (!allowed(job.provider)) { if (job.blocked !== 'budget') { job.blocked = 'budget'; bump(); } continue; }
      job.status = 'running'; job.blocked = null; running[job.provider] += 1; starts[job.provider].push(clock()); bump();
      job.run(abort.signal).catch(error => Object.fromEntries(job.keys.map(k => [k, { status: 'error', code: error?.code || 'failed', stage: job.stage, attempts: job.attempts + 1, retryAt: TRANSIENT.has(error?.code) ? clock() + budget.retryAfterMs : null }])))
        .then(out => save(job, out)).catch(() => log('hierarchy_save_failed'))
        .finally(() => { running[job.provider] -= 1; queue.splice(queue.indexOf(job), 1); for (const k of job.keys) if (jobs.get(k) === job) jobs.delete(k); bump(); if (!closed) { pump(); reconcile(); } });
    }
    arm();
  }
  function save(job, out) {
    if (closed && abort.signal.aborted) return null;
    writes = overlay.transact(async draft => {
      const d = (draft.hierarchy ??= fresh()), at = new Date(clock()).toISOString();
      for (const [key, r] of Object.entries(out)) d.results[key] = { ...r, attempts: r.attempts || job.attempts + (r.status === 'error' ? 1 : 0), at };
      for (const [node, key] of job.marks) if (d.results[key]?.status === 'ready') d.last[`${job.caseId}|${node}`] = key;
      d.ledger = { jev: starts.jev.slice(-500), claude: starts.claude.slice(-500) };
      const keep = new Set(Object.values(d.last)), extra = Object.keys(d.results).length - budget.keepResults;
      if (extra > 0) Object.entries(d.results).filter(([k]) => !keep.has(k)).sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(0, extra).forEach(([k]) => delete d.results[k]);
      d.revision += 1; d.updatedAt = at;
      return { next: draft, result: null };
    });
    log(`hierarchy ${job.stage} ${Object.values(out).map(r => r.status === 'ready' ? 'ready' : r.code).join(',')}`);
    return writes;
  }
  function arm() {
    clearTimeout(wake); wake = null;
    const t = clock(), times = Object.values(data().results).filter(retryable).map(r => r.retryAt);
    for (const kind of ['jev', 'claude']) if (queue.some(j => j.provider === kind && j.blocked === 'budget') && starts[kind].length) times.push(starts[kind][0] + HOUR);
    const next = Math.min(...times.filter(x => x > t));
    if (Number.isFinite(next) && !closed) { wake = setTimeout(reconcile, Math.min(next - t + 50, HOUR)); wake.unref?.(); }
  }
  function reconcile() {
    if (closed || !providers || scheduled) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; if (closed) return; for (const id of caseIds()) { try { schedule(plan(id)); } catch (error) { log(`hierarchy_plan_failed ${error.code || 'error'}`); } } pump(); });
  }

  return {
    start: reconcile, notify: reconcile,
    /** Cheap resource check (404/422) before any conditional answer. */
    check: caseId => { adapterFor(getState(), caseId); },
    /** GET body (read-only; throws HierarchyError for unsupported/unknown cases). */
    view: caseId => decorate(plan(caseId), { jobs, enabled: !!providers, disabledReason, analysisRevision: data().revision, version, updatedAt: data().updatedAt, budget: { ...budget, jevUsedLastHour: used('jev'), claudeUsedLastHour: used('claude') }, transport: providers?.transport || null }),
    etag: caseId => `"h-${boot}-${getState().revision}-${data().revision}-${version}-${caseId}"`,
    stats: () => ({ queued: queue.filter(j => j.status === 'queued').length, running: { ...running }, version }),
    /** Resolves when nothing is queued or running (tests). */
    async idle() { for (;;) { await new Promise(r => setImmediate(r)); if (!scheduled && !queue.length) { await writes.catch(() => {}); return; } await new Promise(r => setTimeout(r, 5)); } },
    async close() { closed = true; clearTimeout(wake); abort.abort(); await writes.catch(() => {}); },
  };
}
