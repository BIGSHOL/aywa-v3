// Wires source + store + AI into the flow service used by flow-http.mjs.
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, namespaceDir, StoreError } from './flow-store.mjs';
import { changedCount, reconcileSource } from './flow-reconcile.mjs';
import { buildView, buildSummaryView } from './flow-view.mjs';
import { actorsOf, entityRef } from './flow-engine.mjs';
import { activeFlowSteps, flowFirstScreen } from './flow-case-flags.mjs';
import { failedDecision, recordDecision, runCommand } from './flow-commands.mjs';
import { createHierarchyRuntime, openOverlay } from './flow-hierarchy-runtime.mjs';
import { createHierarchyProviders } from './flow-hierarchy-providers.mjs';

/** Hierarchy AI providers: off unless OWNER_CONCEPT_HIERARCHY_AI=on (tests and other servers make no calls). */
function hierarchyProviders(option, env) {
  if (option && 'providers' in option) return { providers: option.providers, reason: option.providers ? null : 'AI 정리가 꺼져 있습니다.' };
  if (env.OWNER_CONCEPT_HIERARCHY_AI !== 'on' || env.NODE_ENV === 'production' || env.VERCEL) return { providers: null, reason: 'AI 정리가 꺼져 있습니다.' };
  try { return { providers: createHierarchyProviders({ env }), reason: null }; } catch (error) { console.error(`Hierarchy AI unavailable: ${error.code || 'error'}`); return { providers: null, reason: 'AI 정리 전송 설정에 오류가 있습니다.' }; }
}

const REPO = resolve(fileURLToPath(new URL('../../', import.meta.url)));
/** Default store dir: <data root>/../owner-flow/<worktree folder>/<tenant>-<capturedAt>. */
export function defaultStoreDir({ dataRoot, identity, env = process.env }) {
  if (env.OWNER_CONCEPT_FLOW_DIR) return resolve(env.OWNER_CONCEPT_FLOW_DIR);
  const root = resolve(fileURLToPath(dataRoot), '..', 'owner-flow');
  return namespaceDir({ root, namespace: env.OWNER_CONCEPT_FLOW_NAMESPACE || basename(REPO), tenantSlug: identity.tenantSlug, capturedAt: identity.capturedAt });
}

export async function createFlowService({ source, dir, ai, tenantName = '', lock = true, now = () => new Date().toISOString(), waitMs, hierarchy, env = process.env, reconcile: reconcileOption, log = m => console.log(m) }) {
  const store = await openStore({ dir, identity: source.identity, lock });
  // Re-judging stored source cases (flow-reconcile.mjs, AX-H1) is written only with OWNER_CONCEPT_FLOW_RECONCILE=apply
  // (or reconcile:'apply'). Otherwise the store gets what seedSource did (new cases + open signal wording) and the
  // re-judging is only previewed on a copy of the state (log + reconcilePreview) — nothing else is written.
  const apply = (reconcileOption ?? env.OWNER_CONCEPT_FLOW_RECONCILE) === 'apply';
  const write = (next, mode) => store.transact(async draft => {
    const summary = reconcileSource(draft, next, { at: next.loadedAt || now(), mode });
    if (!changedCount(summary)) return { next: null, result: summary };
    draft.revision += 1;
    return { next: draft, result: summary };
  });
  const preview = next => reconcileSource(structuredClone(store.state), next, { at: next.loadedAt || now() });
  const counts = s => `created ${s.created} · updated ${s.updated} · closed ${s.closed} · reopened ${s.reopened} · unchanged ${s.unchanged}`;
  const reconciled = await write(source, apply ? 'apply' : 'seed');
  const seeded = changedCount(reconciled);
  let reconcilePreview = apply ? null : preview(source);
  log(apply ? `Flow reconcile applied: ${counts(reconciled)}` : `Flow reconcile preview (not written; OWNER_CONCEPT_FLOW_RECONCILE=apply writes it): ${counts(reconcilePreview)}`);
  // A judgment still pending on disk belonged to a process that is gone: record it as interrupted
  // (visible, review kept). No case judgment is re-run on start (the hierarchy queue below is separate).
  const interrupted = await store.transact(async draft => {
    const list = Object.values(draft.cases).filter(c => c.pendingDecision);
    if (!list.length) return { next: null, result: 0 };
    for (const c of list) {
      const job = c.pendingDecision, entry = draft.commands[job.commandId];
      const ev = recordDecision(draft, c, job, failedDecision('decision_interrupted', '판정이 중단됨 — 사람 검토'), now());
      if (entry) entry.result = { ...entry.result, eventIds: [...entry.result.eventIds, ev.id], decision: 'error' };
    }
    draft.revision += 1;
    return { next: draft, result: list.length };
  });
  const jobs = new Map(); // judgments running outside the write queue, by request event id
  let overlay;
  try { overlay = await openOverlay({ dir, identity: source.identity, lock }); } catch (error) { await store.close(); throw error; }
  // Issue hierarchy (FLOW-HIERARCHY.md): GET reads the overlay only; the background queue starts here
  // (seeds the supported case once) and is nudged after every committed command.
  const { providers, reason } = hierarchyProviders(hierarchy, env);
  const runtime = createHierarchyRuntime({ getSource: () => source, getState: () => store.state, overlay, providers, disabledReason: reason, budget: hierarchy?.budget, clock: hierarchy?.clock, log: hierarchy?.log || (m => console.log(m)) });
  runtime.start();
  return {
    store, seeded, reconciled, interrupted, hierarchyRuntime: runtime, reconcileApplied: apply,
    get source() { return source; },
    /** What re-judging would change now, when it is not applied: { created, updated, closed, reopened, unchanged, changes }. */
    get reconcilePreview() { return reconcilePreview; },
    /**
     * AX-H2 contract: re-reads come in as a whole new source (loadFlowSource of the same copy). Under the store's write
     * queue the stored source cases are re-judged against it and saved; then it becomes the source every view, command
     * and the hierarchy use. Returns { created, updated, closed, reopened, unchanged, changes, revision }. The same
     * source twice changes nothing (no write, same revision). Another tenant or copy (capturedAt) is refused: the store
     * folder is keyed by the copy, so a reload never moves or resets it. Without OWNER_CONCEPT_FLOW_RECONCILE=apply
     * nothing is written and the source is not swapped: the result is the preview, with applied:false.
     */
    reloadSource: async next => {
      if (!next?.identity || next.identity.tenantId !== source.identity.tenantId || next.identity.capturedAt !== source.identity.capturedAt) throw new StoreError('flow_state_mismatch', '학원 기록의 지점이나 기준 시점이 달라 업무 갱신을 멈췄습니다.');
      if (!apply) { reconcilePreview = preview(next); log(`Flow reconcile preview on reload (not written): ${counts(reconcilePreview)}`); return { ...reconcilePreview, applied: false, revision: store.state.revision }; }
      const summary = await write(next, 'apply');
      source = next;
      runtime.notify();
      return { ...summary, applied: true, revision: store.state.revision };
    },
    view: (params = {}) => buildView(store.state, source, { aiStatus: ai.status(), tenantName, inFlight: jobs, ...params }),
    summary: () => buildSummaryView(store.state, source, { aiStatus: ai.status(), tenantName, inFlight: jobs }),
    teacherInbox: actorId => {
      const actor = actorsOf(source).find(a => a.id === actorId && a.role === 'teacher' && !a.preview);
      if (!actor) return null;
      const all = Object.values(store.state.cases);
      const rows = all.filter(c => activeFlowSteps(c).some(s => (s.assigneeIds || []).includes(actorId)))
        .map(c => ({ id: c.id, title: c.title, state: c.state, kind: c.kind || null }));
      const expected = flowFirstScreen(all, [actor], source.identity.asOf).inboxByActor[actorId];
      if (rows.length !== expected) throw new Error('teacher inbox count mismatch');
      return { rows, total: rows.length, revision: store.state.revision };
    },
    recordPage: (caseId, page) => {
      const c = store.state.cases[caseId];
      if (!c?.signalId) return null;
      const signal = source.signals.find(s => s.familyId === c.familyId && s.signal.id === c.signalId);
      if (!signal) return null;
      const refs = signal.refs.map(key => entityRef(source, key)).filter(Boolean), size = 50, pages = Math.max(1, Math.ceil(refs.length / size));
      if (page > pages) return null;
      return { caseId, page, pages, total: refs.length, refs: refs.slice((page - 1) * size, page * size) };
    },
    hierarchy: caseId => runtime.view(caseId),
    hierarchyTag: caseId => { runtime.check(caseId); return runtime.etag(caseId); },
    command: async body => { const result = await runCommand(store, () => source, body, { ai, now, jobs, waitMs }); runtime.notify(); return result; },
    /** Resolves when every judgment started so far has settled (tests, shutdown). */
    settled: () => Promise.all([...jobs.values()]),
    close: async () => { await runtime.close(); await overlay.close(); await store.close(); },
  };
}

/** Starts the service in the background; requests before it is ready get 503. */
export function startFlow(load) {
  let service = null, failure = null;
  const ready = load().then(s => { service = s; return s; }, error => { failure = error instanceof StoreError ? error : new StoreError('flow_unavailable', '업무 흐름을 준비하지 못했습니다.'); console.error(`Flow unavailable: ${failure.code}`); });
  return { ready, get service() { return service; }, get failure() { return failure; } };
}
