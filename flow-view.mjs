// GET /api/flow body (flow_contract v1.1). Read-only over the in-memory state; never calls AI.
import { actorsOf } from './flow-engine.mjs';

export const LIMITS = Object.freeze({ cases: 500, events: 200, entities: 3000, candidates: 100 });
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 }, STATE_ORDER = { review: 0, open: 1, working: 2, done: 3 };

// Judgment display (UX contract): status ok|pending|unavailable|error|skipped + Korean reason.
// The typed record stays in the store; reason codes travel as a separate technical field.
const REASON = {
  decision_module_unavailable: '자동 판정을 받지 못함', no_key: '자동 판정을 받지 못함', jev_not_configured: '자동 판정을 받지 못함', jev_key_error: '자동 판정을 받지 못함',
  local_rate_limit: '자동 판정을 받지 못함', adapter_busy: '자동 판정을 받지 못함', jev_auth_failed: '자동 판정을 받지 못함', jev_timeout: '판정 시간 초과',
  jev_rate_limited: '자동 판정을 받지 못함', jev_overloaded: '자동 판정을 받지 못함', jev_unavailable: '자동 판정을 받지 못함', jev_circuit_open: '자동 판정을 받지 못함',
  jev_invalid_answer: '자동 판정을 받지 못함', jev_request_rejected: '자동 판정을 받지 못함', jev_config: '자동 판정을 받지 못함', decision_call_failed: '자동 판정을 받지 못함',
  decision_interrupted: '판정이 중간에 멈춤', cancelled: '판정이 취소됨', uncertain_action: '할 일인지 확실하지 않음', uncertain_area: '업무 영역이 확실하지 않음',
  safety_signal: '안전·법적 확인이 필요해 보임', manager_review_signal: '관리자 확인이 필요해 보임', manager_review: '관리자 확인이 필요해 보임', insufficient_context: '판단할 정보가 부족함',
  area_unclear: '업무 영역을 알 수 없음', no_eligible_staff: '맡길 직원을 찾지 못함', no_eligible_manager: '맡길 관리자를 찾지 못함', no_action: '할 일이 없어 보임', no_open_task: '남은 할 일이 없음', no_content: '판단할 내용이 없음',
};
const UNAVAILABLE = new Set(['decision_module_unavailable', 'no_key', 'jev_not_configured', 'jev_key_error', 'local_rate_limit', 'adapter_busy']);
const FAILURE = code => UNAVAILABLE.has(code) || code.startsWith('jev_') || code.startsWith('invalid_context') || code === 'decision_call_failed' || code === 'decision_interrupted';
const ROUTE_LABEL = { auto_route: '정해진 담당자에게 바로 배정', no_action: '할 일 없음으로 판단', manager_review: '관리자 검토로 보냄', human_review: '사람이 판단하도록 보냄', insufficient_context: '정보가 부족해 사람이 되묻도록 보냄' };
const PROVIDER_LABEL = { typesafe: 'AI 판정', 'claude-cli': 'AI 설명 초안' };
/** Friendly model label; unknown raw ids are not shown. */
export function modelLabel(model) {
  const jev = /^jev-(\d+)\.(\d+)/.exec(model || ''); if (jev) return `Jev ${jev[1]}.${jev[2]}`;
  const cl = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model || '');
  return cl ? `Claude ${cl[1][0].toUpperCase()}${cl[1].slice(1)} ${cl[2]}${cl[3] ? `.${cl[3]}` : ''}` : null;
}
const DEADLINE_LABEL = { overdue: '기한 지남', today: '오늘', tomorrow: '내일', this_week: '7일 안', future: '8일 이후', unknown: '기한 모름' };
const DRAFT_STATE = { drafted: 'ok', busy: 'unavailable', unavailable: 'unavailable', cancelled: 'skipped', not_applicable: 'skipped' };
function friendlyDecision(r) {
  const codes = String(r.reason || '').split(',').filter(Boolean);
  let status = { decided: 'ok', review_needed: 'ok', unavailable: 'unavailable', error: 'error', cancelled: 'skipped' }[r.status] || 'error';
  if (status === 'ok' && codes.some(FAILURE)) status = codes.some(c => UNAVAILABLE.has(c)) ? 'unavailable' : 'error';
  const reason = codes.map(c => REASON[c] || (c.startsWith('invalid_context') ? '자동 판정을 받지 못함' : null)).find(Boolean) || (status === 'ok' ? ROUTE_LABEL[r.route] || '판정 완료' : '판정하지 못함');
  const d = r.draft;
  return {
    status, reason, route: r.route, routeLabel: ROUTE_LABEL[r.route] || null, area: r.area || null,
    provider: r.provider, providerLabel: PROVIDER_LABEL[r.provider] ?? null, model: r.model || null, modelLabel: modelLabel(r.model),
    probabilities: r.probabilities || null, elapsedMs: r.elapsedMs ?? null, usage: r.usage || null, at: r.at || null, claudeRecommended: !!r.claudeRecommended,
    // Code-computed from a trusted record date; the model's urgency stays in probabilities.urgency.
    deadline: r.deadline ? { ...r.deadline, label: DEADLINE_LABEL[r.deadline.relation] || null } : null,
    draft: !d ? null : d.status === 'drafted'
      ? { status: 'ok', explanation: d.explanation, nextAction: d.nextAction, missingInfo: d.missingInfo || [], routeConcern: d.routeConcern, modelLabel: modelLabel(d.model), elapsedMs: d.elapsedMs ?? null }
      : { status: DRAFT_STATE[d.status] || 'error' },
    codes,
  };
}
export function decisionView(c, inFlight) {
  if (c.pendingDecision) {
    const live = !!inFlight?.has(c.pendingDecision.id);
    return { status: live ? 'pending' : 'error', reason: live ? '판정 중' : '판정 결과가 남지 않아 다시 받아야 함', requestedAt: c.pendingDecision.at, previous: c.decision ? friendlyDecision(c.decision) : null, codes: live ? [] : ['decision_not_saved'] };
  }
  return c.decision ? friendlyDecision(c.decision) : null;
}
// The full record keys of a signal (sourceRecords) and what each report covered (coveredRefs) stay in the store for
// re-judging (flow-reconcile.mjs); the view carries counts only, so /api/flow does not grow with them.
const evidenceView = e => { if (!Array.isArray(e.coveredRefs)) return e; const { coveredRefs, ...rest } = e; return { ...rest, coveredCount: coveredRefs.length }; };
const caseView = (c, inFlight) => { const { pendingDecision, sourceRecords, ...rest } = c; return { ...rest, evidence: (c.evidence || []).map(evidenceView), decision: decisionView(c, inFlight), decisionPending: !!pendingDecision }; };

export function buildView(state, source, { aiStatus, now = new Date().toISOString(), tenantName = '', casePage = 1, eventsBefore = null, inFlight = null } = {}) {
  const all = Object.values(state.cases).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueAt || '9').localeCompare(b.dueAt || '9') || b.updatedAt.localeCompare(a.updatedAt));
  const cases = all.slice((casePage - 1) * LIMITS.cases, casePage * LIMITS.cases);
  // assignable = may be chosen as an assignee (request.create / case.reassign); viewers and the preview owner may not.
  const actors = actorsOf(source).map(a => ({ id: a.id, name: a.name, role: a.role, roleLabel: a.roleLabel, ...(a.preview ? { preview: true } : {}), assignable: !a.preview && !!a.assignable, duties: a.desk ? ['desk'] : [] }));

  // Entities = what the returned cases point at, plus one hop of verified relations, plus actors.
  const keys = new Set(actors.filter(a => !a.preview).map(a => `staff:${a.id}`));
  for (const c of cases) { for (const r of c.entityRefs) keys.add(`${r.type}:${r.id}`); for (const s of c.steps) for (const k of s.refs || []) keys.add(k); }
  for (const r of source.relations) if (keys.has(`${r.from.type}:${r.from.id}`) && keys.size < LIMITS.entities) keys.add(`${r.to.type}:${r.to.id}`);
  const entities = [...keys].map(k => source.entities.get(k)).filter(Boolean).slice(0, LIMITS.entities).map(e => ({ type: e.type, id: e.id, label: e.label, familyId: e.familyId, recordId: e.recordId }));
  const present = new Set(entities.map(e => `${e.type}:${e.id}`));
  const relations = source.relations.filter(r => present.has(`${r.from.type}:${r.from.id}`) && present.has(`${r.to.type}:${r.to.id}`));

  // Supervision metrics: dev actions are counted apart from copied historical facts.
  const tally = list => ({ total: list.length, open: list.filter(c => c.state === 'open').length, working: list.filter(c => c.state === 'working').length, review: list.filter(c => c.state === 'review').length, done: list.filter(c => c.state === 'done').length });
  const byActor = {}, roleWaiting = new Map();
  let managerQueue = 0, unassigned = 0;
  for (const c of all) for (const s of c.steps) {
    if (s.status !== 'ready' && s.status !== 'working') continue;
    for (const id of s.assigneeIds) { byActor[id] ??= { ready: 0, working: 0, review: 0 }; byActor[id][s.review ? 'review' : s.status] += 1; }
    if (!s.assigneeIds.length) { managerQueue += 1; if (s.unassignedReason) unassigned += 1; }
    const role = s.queue && !s.assigneeIds.length ? 'manager-queue' : s.role;
    const w = roleWaiting.get(role) || { role, label: role === 'manager-queue' ? '관리자 대기열' : s.roleLabel, waiting: 0, oldestAt: null };
    w.waiting += 1; const since = c.updatedAt; if (!w.oldestAt || since < w.oldestAt) w.oldestAt = since; roleWaiting.set(role, w);
  }
  const open = all.filter(c => c.state !== 'done');
  const metrics = {
    cases: { ...tally(all), snapshot: tally(all.filter(c => c.origin === 'snapshot')), dev: tally(all.filter(c => c.origin === 'dev')) },
    managerQueue, unassigned, overdue: open.filter(c => c.dueAt && c.dueAt < now).length,
    byActor, bottlenecks: [...roleWaiting.values()].sort((a, b) => b.waiting - a.waiting).slice(0, 6),
    devActions: state.events.filter(e => e.origin === 'dev').length, snapshotEvents: state.events.filter(e => e.origin === 'snapshot').length,
  };
  // Scenario picker: the real records event.simulate accepts, with FK-verified fields only (labels are joined
  // by id on the client; no contacts). followup = the open local scenario already made from that record.
  const openScenario = new Map(all.filter(c => c.kind === 'scenario' && c.state !== 'done').map(c => [`${c.scenario}|${c.scenarioKey}`, { caseId: c.id, state: c.state }]));
  const picker = (scenario, type, fields) => (source.candidates?.[scenario] || []).slice(0, LIMITS.candidates).map(id => source.entities.get(`${type}:${id}`)).filter(Boolean)
    .map(e => ({ id: e.id, ...fields(e), followup: openScenario.get(`${scenario}|${type}:${e.id}`) || null }));
  const scenarioCandidates = {
    absence: picker('absence', 'attendance', e => ({ date: e.date, studentId: e.studentId, classId: e.classId && source.entities.has(`class:${e.classId}`) ? e.classId : null })),
    // remaining = billed − discount − paid (the discount is not unpaid).
    billing: picker('billing', 'invoice', e => ({ period: e.period ?? null, studentId: e.studentId ?? null, billed: e.billed ?? null, discount: e.discount ?? null, paid: e.paid ?? null, remaining: e.remaining, due: e.dueDate || null })),
    totals: { absence: source.candidates?.absence?.length || 0, billing: source.candidates?.billing?.length || 0 }, limit: LIMITS.candidates,
  };
  return {
    schemaVersion: 1, asOf: source.identity.asOf, revision: state.revision, mode: 'local-preview', scenarioCandidates,
    source: { tenant: tenantName, capturedAt: source.identity.capturedAt, asOf: source.identity.asOf, note: '원본은 기준일의 학원 기록이며, 이 화면에서 만든 처리·요청은 따로 남습니다.' },
    actors, entities, relations, cases: cases.map(c => caseView(c, inFlight)), casesTotal: all.length, casePage, casePageSize: LIMITS.cases, casePageCount: Math.max(1, Math.ceil(all.length / LIMITS.cases)),
    // Newest events (chronological); older ones via ?eventsBefore=<event number>.
    events: (eventsBefore ? state.events.filter(e => Number(e.id.slice(4)) < eventsBefore) : state.events).slice(-LIMITS.events), eventsTotal: state.events.length,
    metrics, aiStatus: aiStatus || { providers: [] },
  };
}
