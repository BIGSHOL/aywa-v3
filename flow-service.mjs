// Wires source + store + AI into the flow service used by flow-http.mjs.
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, namespaceDir, StoreError } from './flow-store.mjs';
import { seedSource } from './flow-engine.mjs';
import { buildView } from './flow-view.mjs';
import { failedDecision, recordDecision, runCommand } from './flow-commands.mjs';

const REPO = resolve(fileURLToPath(new URL('../../', import.meta.url)));
/** Default store dir: <data root>/../owner-flow/<worktree folder>/<tenant>-<capturedAt>. */
export function defaultStoreDir({ dataRoot, identity, env = process.env }) {
  if (env.OWNER_CONCEPT_FLOW_DIR) return resolve(env.OWNER_CONCEPT_FLOW_DIR);
  const root = resolve(fileURLToPath(dataRoot), '..', 'owner-flow');
  return namespaceDir({ root, namespace: env.OWNER_CONCEPT_FLOW_NAMESPACE || basename(REPO), tenantSlug: identity.tenantSlug, capturedAt: identity.capturedAt });
}

export async function createFlowService({ source, dir, ai, tenantName = '', lock = true, now = () => new Date().toISOString(), waitMs }) {
  const store = await openStore({ dir, identity: source.identity, lock });
  // Seeding is idempotent per stable source key; it only writes when something new appears.
  const seeded = await store.transact(async draft => {
    const created = seedSource(draft, source);
    if (!created) return { next: null, result: 0 };
    draft.revision += 1;
    return { next: draft, result: created };
  });
  // A judgment still pending on disk belonged to a process that is gone: record it as interrupted
  // (visible, review kept). Nothing calls AI on start.
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
  return {
    store, seeded, interrupted,
    view: (params = {}) => buildView(store.state, source, { aiStatus: ai.status(), tenantName, inFlight: jobs, ...params }),
    command: body => runCommand(store, source, body, { ai, now, jobs, waitMs }),
    /** Resolves when every judgment started so far has settled (tests, shutdown). */
    settled: () => Promise.all([...jobs.values()]),
    close: () => store.close(),
  };
}

/** Starts the service in the background; requests before it is ready get 503. */
export function startFlow(load) {
  let service = null, failure = null;
  const ready = load().then(s => { service = s; return s; }, error => { failure = error instanceof StoreError ? error : new StoreError('flow_unavailable', '업무 흐름을 준비하지 못했습니다.'); console.error(`Flow unavailable: ${failure.code}`); });
  return { ready, get service() { return service; }, get failure() { return failure; } };
}
