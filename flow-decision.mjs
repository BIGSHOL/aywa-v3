// Bridge from flow cases to the AI worker's owner-decision/1 modules (decision-engine.mjs
// evaluateDecision · decision-claude.mjs draftWithClaude). The flow side builds a narrow,
// pseudonymous context; AI never sees names, contacts, ids or payroll, and never assigns.
// When the modules are absent or fail, work stays visible with a review reason (no fake AI).
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scrub } from './domain-snapshot-core.mjs';
import { actorMap, relatedKeys } from './flow-engine.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const AREA = { absence: 'attendance', billing: 'billing', consultation: 'counseling' };
const TASK_AREA = { attendance_absent_desk: 'attendance', video_upload_check: 'academic', video_unassigned: 'academic', unsent_report: 'academic', report_send_failed: 'academic', enrollment_followup: 'enrollment', withdrawal_step: 'counseling', followup_due: 'counseling', approval_turn: 'staff_hr', progress_anomaly: 'academic', help_question: 'operations' };
const FAMILY_AREA = { billing: 'billing', attendance: 'attendance', approvals: 'staff_hr', 'withdrawal-reports': 'counseling', inventory: 'operations', 'textbook-requests': 'academic', enrollment: 'enrollment', 'video-homework': 'academic', 'class-review': 'staff_hr', integrations: 'operations' };
// Financial and personnel matters always get a person's review, whatever the model says.
const ALWAYS_REVIEW = new Set(['billing', 'staff_hr']);
export const LIMITS = Object.freeze({ evaluatePerMinute: 12, draftsPer10Min: 3, jevTimeoutMs: 12_000, draftTimeoutMs: 90_000 });
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const kstDate = iso => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10) : null);

/** Pseudonymous context (owner-decision/1). Names become 학생A·담임 etc.; facts are computed here. */
export function buildContext(source, c, { today = kstToday() } = {}) {
  const key = c.scenarioKey || (c.entityRefs[0] ? `${c.entityRefs[0].type}:${c.entityRefs[0].id}` : null);
  const e = key ? source.entities.get(key) : null;
  const studentKey = c.entityRefs.find(r => r.type === 'student') ? `student:${c.entityRefs.find(r => r.type === 'student').id}` : null;
  const recordDate = [e?.date, (c.createdAt || '').slice(0, 10)].find(v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && v <= today) || today;
  const facts = {}, knownOpenWork = [];
  let text = '', sourceKind = 'system_event';
  if (c.scenario === 'absence') {
    sourceKind = 'staff_note';
    const count = [...source.entities.values()].filter(x => x.type === 'attendance' && x.studentId === e?.studentId).length;
    text = `담임 선생님이 학생A의 ${e?.date || recordDate} 수업 결석을 알렸습니다. 학부모 연락과 이후 수업 안내가 필요한지 판단해야 합니다.`;
    Object.assign(facts, { absence_date: e?.date || recordDate, absences_this_month: count, class_has_homeroom_teacher: !!source.entities.get(`class:${e?.classId}`)?.teacherId });
    knownOpenWork.push({ area: 'attendance', code: 'absence_recorded' });
  } else if (c.scenario === 'billing') {
    text = '학생A의 이번 달 수강료 청구에 남은 금액이 있어 수납 내역 확인이 요청되었습니다.';
    Object.assign(facts, { remaining_won: Math.round(e?.remaining || 0), invoice_period: e?.period || '' });
    knownOpenWork.push({ area: 'billing', code: 'invoice_balance_remaining' });
  } else if (c.scenario === 'consultation') {
    sourceKind = 'consultation_note';
    text = `학생A 상담(${e?.date || recordDate}) 이후 후속 연락이 요청되었습니다.`;
    Object.assign(facts, { consulted_on: e?.date || recordDate });
    knownOpenWork.push({ area: 'counseling', code: 'consultation_followup' });
  } else if (c.kind === 'source') {
    const area = TASK_AREA[c.taskKind] || FAMILY_AREA[c.familyId] || null;
    text = `학원 시스템이 확인할 일을 만들었습니다: ${pseudonymize(source, `${c.title}. ${c.summary || ''}`)}`.slice(0, 600);
    Object.assign(facts, { record_count: c.entityTotal || c.entityRefs.length, fact_closed_in_source: !!c.factClosed });
    if (area && !c.factClosed) knownOpenWork.push({ area, code: c.taskKind || c.signalId || 'source_fact' });
  } else {
    sourceKind = 'task_comment';
    text = `원장이 업무를 요청했습니다: ${pseudonymize(source, `${c.title}. ${c.summary}`)}`.slice(0, 1500);
  }
  // Candidates come from verified relations only; AI does not see them.
  const actors = actorMap(source), candidates = [], add = (id, role) => { const a = actors.get(id); if (a && !a.preview && a.assignable) { const x = candidates.find(y => y.staffId === id); if (x) x.roles.push(role); else candidates.push({ staffId: id, roles: [role] }); } };
  const classKeys = [e?.classId ? `class:${e.classId}` : null, ...(studentKey ? source.relations.filter(r => r.to.type === 'student' && `student:${r.to.id}` === studentKey && r.from.type === 'enrollment').flatMap(r => relatedKeys(source, `enrollment:${r.from.id}`, ['enrollment_in'])) : [])].filter(Boolean);
  const homeroom = source.entities.get(classKeys[0] || '')?.teacherId; if (homeroom) add(homeroom, 'homeroom_teacher');
  for (const k of classKeys.slice(1)) { const tId = source.entities.get(k)?.teacherId; if (tId && tId !== homeroom) add(tId, 'subject_teacher'); }
  for (const a of source.actors) { if (a.desk) add(a.id, 'desk'); if (a.role === 'manager') add(a.id, 'manager'); if (a.role === 'owner') add(a.id, 'owner'); if (a.systemRole === 'accountant') add(a.id, 'billing'); }
  // Trusted date fields only (never free text): absence date, invoice due date, the request's
  // due date, the source task's due time (KST). Outside today ±366 days it is left out.
  const requested = c.scenario === 'absence' ? e?.date : c.scenario === 'billing' ? e?.dueDate : c.kind === 'request' ? c.dueAt : c.kind === 'source' ? kstDate(c.dueAt) : null;
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(requested || '') && Math.abs(Date.parse(requested) - Date.parse(today)) <= 366 * 86400000 ? { requestedActionDate: requested } : {};
  return {
    recordId: c.id, source: sourceKind, today, recordDate, ...dated, text: scrub(text), thread: [], facts, knownOpenWork: knownOpenWork.slice(0, 5),
    links: { student: !!studentKey, class: classKeys.length > 0, invoice: c.entityRefs.some(r => r.type === 'invoice'), staff: candidates.length > 0 },
    candidates: candidates.slice(0, 20).map(x => ({ staffId: x.staffId, roles: [...new Set(x.roles)] })),
  };
}

/** Replaces every known person label (students, staff, leads) in free text with neutral placeholders. */
export function pseudonymize(source, text) {
  let out = scrub(text || '');
  const names = [...source.entities.values()].filter(e => ['student', 'staff', 'lead'].includes(e.type) && e.label && e.label.length >= 2).map(e => [e.label, e.type === 'staff' ? '직원' : '학생']).sort((a, b) => b[0].length - a[0].length);
  for (const [name, mask] of names) if (out.includes(name)) out = out.split(name).join(mask);
  return out;
}

// DecisionResult → flow decision record + routing effects (code, not AI).
function toRecord(result, { area, draft, reason }) {
  const routeLabel = { auto_route: '정해진 담당자에게 바로 배정', no_action: '할 일 없음으로 판단', manager_review: '관리자 검토로 보냄', human_review: '사람이 판단하도록 보냄', insufficient_context: '정보가 부족해 사람이 되묻도록 보냄' };
  const id = `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!result) return { id, status: 'unavailable', route: 'human_review', label: '판정 사용 불가 — 사람 검토', needsReview: true, record: { id, provider: 'none', model: null, status: 'unavailable', reason: reason || 'decision_module_unavailable', route: 'human_review', probabilities: null, elapsedMs: 0, usage: null, at: new Date().toISOString() } };
  const p = result.signals || null;
  const needsReview = result.status !== 'decided' || result.route !== 'auto_route' || ALWAYS_REVIEW.has(area) || ALWAYS_REVIEW.has(result.area?.value) || (area && result.area?.value && result.area.value !== area);
  // A known code deadline (from a trusted date) outranks the model's urgency guess.
  const due = result.deadline && result.deadline.urgency !== 'unknown' ? result.deadline : null;
  const priority = due ? { today: 'high', this_week: 'normal', future: 'low' }[due.urgency] || null
    : p?.urgency?.value === 'today' ? 'high' : p?.urgency?.value === 'no_deadline' ? 'low' : p ? 'normal' : null;
  return {
    id, status: result.status, route: result.route, label: routeLabel[result.route] ? `판정: ${routeLabel[result.route]}` : '판정 기록', needsReview, priority,
    record: { id, provider: result.provider || 'typesafe', model: result.model, status: result.status, route: result.route, reason: (result.reasons || []).map(r => r.code).join(',') || null, area: result.area?.value || null,
      probabilities: p ? { actionNeeded: p.actionNeeded?.probability ?? null, managerReview: p.managerReview?.probability ?? null, safetyConcern: p.safetyConcern?.probability ?? null, urgency: p.urgency?.value ?? null } : null,
      suggestedAssigneeIds: (result.assignees || []).map(a => a.staffId), claudeRecommended: !!result.claudeRecommended, elapsedMs: result.elapsedMs ?? null, usage: result.usage || null, cost: result.cost || null, cache: result.cache || null, versions: result.versions || null, at: new Date().toISOString(),
      deadline: result.deadline ? { date: result.deadline.date, daysFromToday: result.deadline.daysFromToday, relation: result.deadline.relation, urgency: result.deadline.urgency, origin: result.deadline.origin } : null,
      draft: draft ? { status: draft.status, explanation: draft.explanation, nextAction: draft.nextAction, missingInfo: draft.missingInfo, routeConcern: draft.routeConcern, model: draft.model, elapsedMs: draft.elapsedMs } : null },
  };
}

/** Loads the decision modules (same directory, or OWNER_CONCEPT_DECISION_DIR for integration runs). */
export async function createFlowAI({ env = process.env, dir = env.OWNER_CONCEPT_DECISION_DIR || HERE, modules } = {}) {
  let engine = null, draftFn = null, loadReason = null, keySource = null;
  try {
    const m = modules || { engine: await import(pathToFileURL(join(dir, 'decision-engine.mjs')).href), claude: await import(pathToFileURL(join(dir, 'decision-claude.mjs')).href).catch(() => null), key: await import(pathToFileURL(join(dir, 'decision-key.mjs')).href).catch(() => null) };
    const key = m.key?.loadTypesafeKey ? await m.key.loadTypesafeKey({ env }) : null;
    keySource = key?.source || null;
    engine = m.engine.createDecisionEngine({ keyProvider: () => key?.apiKey ?? env.TYPESAFE_API_KEY });
    draftFn = m.claude?.draftWithClaude || null;
  } catch { loadReason = 'decision_module_unavailable'; }
  const stamps = { evaluate: [], draft: [] };
  const allow = (kind, max, windowMs) => { const t = Date.now(); stamps[kind] = stamps[kind].filter(x => t - x < windowMs); if (stamps[kind].length >= max) return false; stamps[kind].push(t); return true; };
  async function evaluate(c, source, area, { draft = false } = {}) {
    if (!engine) return toRecord(null, { area, reason: loadReason });
    if (!allow('evaluate', LIMITS.evaluatePerMinute, 60_000)) return toRecord(null, { area, reason: 'local_rate_limit' });
    const context = buildContext(source, c);
    // Runs outside the store's write queue (flow-commands settleDecision), so a slow draft blocks no one.
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), LIMITS.jevTimeoutMs);
    let result;
    try { result = await engine.evaluateDecision(context, { signal: controller.signal }); } catch { return toRecord(null, { area, reason: 'decision_call_failed' }); } finally { clearTimeout(timer); }
    let drafted = null;
    if (draft && draftFn && allow('draft', LIMITS.draftsPer10Min, 600_000)) {
      const dc = new AbortController(), dt = setTimeout(() => dc.abort(), LIMITS.draftTimeoutMs);
      drafted = await draftFn(context, result, { signal: dc.signal, force: true }).catch(() => ({ status: 'unavailable' })).finally(() => clearTimeout(dt));
    } else if (draft) drafted = { status: draftFn ? 'busy' : 'unavailable' };
    return toRecord(result, { area, draft: drafted });
  }
  return {
    route: (c, source) => evaluate(c, source, AREA[c.scenario]),
    analyze: (c, source, opts) => evaluate(c, source, AREA[c.scenario] || TASK_AREA[c.taskKind] || FAMILY_AREA[c.familyId] || null, opts),
    status: () => ({ providers: [
      { id: 'jev', label: 'AI 판정', status: engine ? (keySource || env.TYPESAFE_API_KEY ? 'ready' : 'unavailable') : 'unavailable', ...(engine ? (keySource || env.TYPESAFE_API_KEY ? {} : { reason: '판정 키가 설정되지 않음' }) : { reason: '판정 모듈이 연결되지 않음' }) },
      { id: 'claude-cli', label: 'AI 설명 초안', status: draftFn ? 'ready' : 'unavailable', ...(draftFn ? {} : { reason: '초안 모듈이 연결되지 않음' }) },
    ] }),
  };
}
