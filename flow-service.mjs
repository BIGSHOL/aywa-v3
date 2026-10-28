// Wires source + store + AI into the flow service used by flow-http.mjs.
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, namespaceDir, StoreError } from './flow-store.mjs';
import { changedCount, reconcileSource } from './flow-reconcile.mjs';
import { buildView } from './flow-view.mjs';
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

export async function createFlowService({ source, dir, ai, tenantName = '', lock = true, now = () => new Date().toISOString(), waitMs, hierarchy, env = process.env }) {
  const store = await openStore({ dir, identity: source.identity, lock });
  // Seed + re-judge the stored source cases (flow-reconcile.mjs, AX-H1). Idempotent; writes only when something changed.
  const reconcile = next => store.transact(async draft => {
    const summary = reconcileSource(draft, next, { at: next.loadedAt || now() });
    if (!changedCount(summary)) return { next: null, result: summary };
    draft.revision += 1;
    return { next: draft, result: summary };
  });
  const reconciled = await reconcile(source);
  const seeded = changedCount(reconciled);
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
    store, seeded, reconciled, interrupted, hierarchyRuntime: runtime,
    get source() { return source; },
    /**
     * AX-H2 contract: re-reads come in as a whole new source (loadFlowSource of the same copy). Under the store's write
     * queue the stored source cases are re-judged against it and saved; then it becomes the source every view, command
     * and the hierarchy use. Returns { created, updated, closed, reopened, unchanged, changes, revision }. The same
     * source twice changes nothing (no write, same revision). Another tenant or copy (capturedAt) is refused: the store
     * folder is keyed by the copy, so a reload never moves or resets it.
     */
    reloadSource: async next => {
      if (!next?.identity || next.identity.tenantId !== source.identity.tenantId || next.identity.capturedAt !== source.identity.capturedAt) throw new StoreError('flow_state_mismatch', '다른 지점 또는 다른 복사본의 원본입니다. 섞지 않고 멈췄습니다.');
      const summary = await reconcile(next);
      source = next;
      runtime.notify();
      return { ...summary, revision: store.state.revision };
    },
    view: (params = {}) => buildView(store.state, source, { aiStatus: ai.status(), tenantName, inFlight: jobs, ...params }),
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
