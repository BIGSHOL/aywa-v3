// evaluateDecision(context, { signal }) — decision-only routing adapter (server only).
// Never executes, sends or writes anything. Every runtime failure becomes an explicit
// review_needed result (no fake probabilities, nothing silently dropped). Jev answers
// are cached by content + question/rule/model version; the routing policy is re-applied
// on every call so the current candidate list (DB relationships) is always used.
import { createHash } from 'node:crypto';
import { callSystemOne, DEFAULT_JEV_MODEL, JEV_MODELS, estimateJevCostUsd, PRICE_SOURCE } from './decision-jev.mjs';
import { QUESTIONS, QUESTIONS_VERSION, validateContext, buildState, hasNoContent } from './decision-questions.mjs';
import { RULES_VERSION, THRESHOLDS, applyPolicy } from './decision-policy.mjs';
import { DEADLINE_RULES_VERSION, deriveDeadline } from './decision-deadline.mjs';

export const CONTRACT_VERSION = 'owner-decision/1';
const FAILURE_REASON = { timeout: 'jev_timeout', rate_limited: 'jev_rate_limited', overloaded: 'jev_overloaded', auth: 'jev_auth_failed', no_key: 'jev_not_configured',
  invalid_response: 'jev_invalid_answer', network: 'jev_unavailable', http_error: 'jev_unavailable', request_rejected: 'jev_request_rejected', too_large: 'context_too_large', config: 'jev_config', busy: 'adapter_busy' };
const TRIPS_BREAKER = new Set(['timeout', 'rate_limited', 'overloaded', 'network', 'http_error', 'auth']);
class Busy extends Error { constructor() { super('busy'); this.code = 'busy'; } }
class Cancelled extends Error { constructor() { super('cancelled'); this.code = 'cancelled'; } }

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Cancelled());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function createDecisionEngine({ apiKey, keyProvider, model = process.env.OWNER_CONCEPT_JEV_MODEL || DEFAULT_JEV_MODEL, timeoutMs = 8_000,
  concurrency = 4, maxQueue = 64, cacheSize = 500, breakerThreshold = 3, breakerCooldownMs = 30_000, fetchImpl, questions = QUESTIONS,
  thresholds = THRESHOLDS, now = () => performance.now() } = {}) {
  if (!JEV_MODELS.includes(model)) throw new Error('Unsupported Jev model (versioned IDs only)');
  const cache = new Map(), inflight = new Map(), waiting = [];
  let active = 0, failures = 0, openUntil = 0;
  const totals = { evaluations: 0, jevCalls: 0, cacheHits: 0, failures: 0, inputTokens: 0, estimatedUsd: 0 };
  const versions = Object.freeze({ contract: CONTRACT_VERSION, questions: QUESTIONS_VERSION, rules: RULES_VERSION, deadline: DEADLINE_RULES_VERSION });

  const acquire = signal => new Promise((resolve, reject) => {
    if (active < concurrency) { active++; return resolve(); }
    if (waiting.length >= maxQueue) return reject(new Busy());
    const entry = { resolve: () => { signal?.removeEventListener('abort', onAbort); active++; resolve(); } };
    const onAbort = () => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(new Cancelled()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    waiting.push(entry);
  });
  const release = () => { active--; waiting.shift()?.resolve(); };

  // Identical in-flight requests share one HTTP call; it is aborted only when every caller has left.
  function shared(key, state, apiKeyValue, signal) {
    let entry = inflight.get(key);
    // An entry abandoned by all of its callers is already aborted; a new caller starts afresh.
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created = { controller, callers: 0 };
      created.promise = (async () => {
        await acquire(controller.signal);
        try { totals.jevCalls++; return await callSystemOne({ state, questions, apiKey: apiKeyValue, model, timeoutMs, signal: controller.signal, fetchImpl }); }
        finally { release(); }
      })().finally(() => { if (inflight.get(key) === created) inflight.delete(key); });
      created.promise.catch(() => {});
      inflight.set(key, created);
      entry = created;
    }
    entry.callers++;
    let left = false;
    const leave = () => { if (left) return; left = true; if (--entry.callers === 0) entry.controller.abort(); };
    signal?.addEventListener('abort', leave, { once: true });
    const owner = entry;
    const promise = abortable(entry.promise, signal).finally(() => { signal?.removeEventListener('abort', leave); if (!signal?.aborted) left = true; });
    // claim() is true for exactly one consumer per HTTP call; only that consumer accounts usage, cost and failures.
    return { promise, claim: () => (owner.claimed ? false : (owner.claimed = true)) };
  }

  /** Key lookup may do I/O; any failure is reported as a code, never with the provider's message. */
  async function resolveKey() {
    try {
      const value = keyProvider ? await keyProvider() : apiKey ?? process.env.TYPESAFE_API_KEY;
      return { value: typeof value === 'string' && value.trim() ? value.trim() : null };
    } catch { return { error: true }; }
  }

  async function evaluateDecision(context, { signal } = {}) {
    const started = now();
    totals.evaluations++;
    const recordId = typeof context?.recordId === 'string' && context.recordId.length <= 64 ? context.recordId : null;
    const base = { contract: CONTRACT_VERSION, recordId, provider: 'typesafe', model: null, versions, cache: { hit: false, shared: false, key: null },
      area: null, signals: null, deadline: null, assignees: [], usage: null, jevElapsedMs: null,
      cost: { estimatedUsd: 0, basis: `${PRICE_SOURCE}; estimate, not an invoice`, billedThisCall: false }, claude: { status: 'not_requested' } };
    const finish = fields => ({ ...base, ...fields, elapsedMs: Math.round(now() - started) });
    const review = (code, origin = 'adapter', route = 'human_review', claudeRecommended = true) =>
      finish({ status: 'review_needed', route, reasons: [{ code, origin }], claudeRecommended });
    if (signal?.aborted) return finish({ status: 'cancelled', route: 'human_review', reasons: [{ code: 'cancelled', origin: 'adapter' }], claudeRecommended: false });
    const checked = validateContext(context);
    // Invalid or unredacted input must not be forwarded to any AI, including Claude.
    if (!checked.ok) return finish({ status: 'review_needed', route: 'human_review', claudeRecommended: false, reasons: checked.issues.map(c => ({ code: `invalid_context:${c}`, origin: 'adapter' })) });
    const ctx = checked.value;
    // Code-derived from a trusted date; present on every later result (also Jev failures), never changes the route.
    base.deadline = deriveDeadline(ctx);
    if (hasNoContent(ctx)) return review('no_content', 'rule', 'insufficient_context', false);
    const state = buildState(ctx);
    const key = createHash('sha256').update(JSON.stringify({ versions, model, questions, state })).digest('hex');
    // via: 'call' = this consumer accounts the HTTP call; 'shared' = joined an identical in-flight call; 'cache'.
    const fromAnswers = (result, via) => {
      const { answers } = result;
      const decision = applyPolicy(answers, ctx, thresholds);
      const billed = via === 'call';
      const estimatedUsd = billed ? estimateJevCostUsd(result.model, result.usage.inputTokens) ?? 0 : 0;
      return finish({ ...decision, model: result.model, cache: { hit: via === 'cache', shared: via === 'shared', key }, usage: result.usage,
        jevElapsedMs: via === 'cache' ? null : result.elapsedMs, cost: { ...base.cost, estimatedUsd, billedThisCall: billed },
        area: { value: answers.work_area.choice, confidence: answers.work_area.confidence, probabilities: answers.work_area.probabilities, origin: 'jev' },
        signals: { origin: 'jev', actionNeeded: { probability: answers.action_needed.probability }, managerReview: { probability: answers.manager_review.probability },
          contextSufficient: { probability: answers.context_sufficient.probability }, secondArea: { probability: answers.second_area.probability },
          safetyConcern: { probability: answers.safety_concern.probability },
          urgency: { value: answers.urgency.choice, confidence: answers.urgency.confidence, probabilities: answers.urgency.probabilities } } });
    };
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); totals.cacheHits++; return fromAnswers(hit, 'cache'); }
    if (now() < openUntil) return review('jev_circuit_open');
    const resolved = await resolveKey();
    if (resolved.error) return review('jev_key_error');
    if (!resolved.value) return review('jev_not_configured');
    const cancelled = () => finish({ status: 'cancelled', route: 'human_review', reasons: [{ code: 'cancelled', origin: 'adapter' }], claudeRecommended: false });
    if (signal?.aborted) return cancelled();
    const call = shared(key, state, resolved.value, signal);
    let result;
    try { result = await call.promise; }
    catch (error) {
      if (error?.code === 'cancelled' || signal?.aborted) return cancelled();
      const owns = call.claim();
      const usage = error?.usage ?? null;
      const estimatedUsd = owns && usage ? estimateJevCostUsd(model, usage.inputTokens) ?? 0 : 0;
      if (owns) {
        totals.failures++;
        if (TRIPS_BREAKER.has(error?.code) && (++failures >= breakerThreshold || error.code === 'auth')) openUntil = now() + Math.max(breakerCooldownMs, error.retryAfterMs ?? 0);
        if (usage) { totals.inputTokens += usage.inputTokens ?? 0; totals.estimatedUsd += estimatedUsd; }
      }
      return { ...review(FAILURE_REASON[error?.code] ?? 'jev_unavailable'), usage, cache: { hit: false, shared: !owns, key },
        cost: { ...base.cost, estimatedUsd, billedThisCall: owns && !!usage } };
    }
    if (!call.claim()) return fromAnswers(result, 'shared');
    failures = 0;
    totals.inputTokens += result.usage.inputTokens ?? 0;
    totals.estimatedUsd += estimateJevCostUsd(result.model, result.usage.inputTokens) ?? 0;
    cache.set(key, result);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    return fromAnswers(result, 'call');
  }

  return {
    evaluateDecision, model, versions,
    stats: () => ({ ...totals, active, queued: waiting.length, cacheSize: cache.size, breakerOpen: now() < openUntil }),
    clearCache: () => cache.clear(),
  };
}

let defaultEngine = null;
/** Default engine: key from process.env.TYPESAFE_API_KEY at call time. */
export function evaluateDecision(context, options) {
  defaultEngine ??= createDecisionEngine();
  return defaultEngine.evaluateDecision(context, options);
}
