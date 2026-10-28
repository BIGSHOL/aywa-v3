// Flow engine core: role resolution, step progression, source seeding and the /api/flow
// view. State lives in flow-store.mjs; commands are in flow-commands.mjs.
import { CLOSE_REASON, EVENT_TYPES, ROLE_NAME, STEP_ROLE_LABEL, TASK_EVENT_LABEL, TASK_KINDS, TASK_STATE_LABEL } from './flow-rules.mjs';

const PREVIEW_OWNER = Object.freeze({ id: 'preview-owner', name: '원장 미리보기', role: 'owner', roleLabel: '원장(미리보기)', preview: true });
export const actorsOf = source => [...source.actors, PREVIEW_OWNER];
export const actorMap = source => new Map(actorsOf(source).map(a => [a.id, a]));
const keyOf = ref => typeof ref === 'string' ? ref : `${ref.type}:${ref.id}`;
export const entityRef = (source, key) => { const e = source.entities.get(keyOf(key)); return e ? { type: e.type, id: e.id, label: e.label, familyId: e.familyId, recordId: e.recordId } : null; };
export const relatedKeys = (source, key, types) => source.relations.filter(r => `${r.from.type}:${r.from.id}` === key && (!types || types.includes(r.type))).map(r => `${r.to.type}:${r.to.id}`);

/** Resolves a step role to actual people (code, not AI). No one → explicit manager queue. */
export function resolveRole(source, role, refs) {
  const actors = source.actors, ids = list => [...new Set(list.filter(id => actors.some(a => a.id === id)))];
  const queue = reason => ({ assigneeIds: [], queue: 'manager', reason });
  const classOf = key => { const e = source.entities.get(key); if (!e) return null; if (e.type === 'attendance') return e.classId ? `class:${e.classId}` : null; return relatedKeys(source, key, ['in_class'])[0] || null; };
  if (role === 'desk') { const desk = ids(actors.filter(a => a.desk).map(a => a.id)); return desk.length ? { assigneeIds: desk, queue: null, rule: '기존 결석 확인 담당(출결 알림을 켠 직원)', ruleSource: 'users.attendance_alert_optin' } : queue('출결 알림을 켠 직원이 없어 관리자 대기열'); }
  if (role === 'homeroom') { const t = ids(refs.map(classOf).filter(Boolean).map(c => source.entities.get(c)?.teacherId).filter(Boolean)); return t.length ? { assigneeIds: t, queue: null, rule: '해당 반의 담당 강사', ruleSource: 'classes.teacher_id' } : queue('담임을 찾지 못해 관리자 대기열'); }
  if (role === 'counselor') { const c = ids(refs.flatMap(k => relatedKeys(source, k, ['counselor', 'consultant'])).map(k => k.split(':')[1])); return c.length ? { assigneeIds: c, queue: null, rule: '상담을 맡은 사람', ruleSource: 'student_consultations.counselor_id' } : queue('상담 담당을 찾지 못해 관리자 대기열'); }
  if (role === 'billing') { const b = ids(actors.filter(a => a.systemRole === 'accountant').map(a => a.id)); return b.length ? { assigneeIds: b, queue: null, rule: '회계 담당 직원', ruleSource: 'users.role' } : queue('회계 역할 직원이 없어 관리자 대기열'); }
  if (role === 'owner') { const o = ids(actors.filter(a => a.role === 'owner').map(a => a.id)); return o.length ? { assigneeIds: o, queue: null, rule: '원장', ruleSource: 'users.role' } : queue('원장 계정이 없어 관리자 대기열'); }
  return { assigneeIds: [], queue: 'manager', rule: '관리자·원장 누구나' };
}

export function newEvent(state, { caseId, type, label, actorId = null, origin = 'dev', at, targetActorIds = [], stepId = null, decisionId = null, causeId = null, data = null }) {
  if (!EVENT_TYPES[type]) throw new Error(`unknown event type ${type}`);
  state.seq += 1;
  const event = { id: `evt-${state.seq}`, caseId, type, label: label || EVENT_TYPES[type].label, actorId, at: at || new Date().toISOString(), origin, targetActorIds, stepId, decisionId, causeId, data };
  state.events.push(event);
  if (caseId && state.cases[caseId]) state.cases[caseId].history.push(event.id);
  return event;
}

const DONE = new Set(['done']);
/** Recomputes state/currentStepId/assigneeIds from steps. */
export function refreshCase(c, at) {
  const active = c.steps.filter(s => s.status === 'ready' || s.status === 'working');
  c.currentStepId = active[0]?.id || null;
  c.assigneeIds = [...new Set(active.flatMap(s => s.assigneeIds))];
  if (c.closure === 'fact') c.state = c.factClosed ? 'done' : c.steps.some(s => s.status === 'working') ? 'working' : 'open';
  else if (c.steps.every(s => DONE.has(s.status))) c.state = 'done';
  else if (active.some(s => s.review)) c.state = 'review';
  else c.state = c.steps.some(s => s.status === 'working' || s.status === 'done') ? 'working' : 'open';
  c.updatedAt = at || c.updatedAt;
  return c;
}

/** Opens the next group when the previous ones are finished; conditional review steps are skipped unless flagged. */
export function advance(state, c, { actorId, at, causeId }) {
  const emitted = [];
  for (;;) {
    const pending = c.steps.filter(s => s.status !== 'done');
    if (!pending.length || pending.some(s => s.status === 'ready' || s.status === 'working')) break;
    const group = Math.min(...pending.map(s => s.group));
    const next = pending.filter(s => s.group === group);
    for (const s of next) {
      if (s.when === 'needsReview' && !c.flags?.needsReview) {
        s.status = 'done'; s.skipped = true;
        emitted.push(newEvent(state, { caseId: c.id, type: 'step.skipped', actorId, at, stepId: s.id, causeId, label: `${s.label} — 검토가 필요하지 않아 건너뜀` }));
      } else {
        s.status = 'ready';
        emitted.push(newEvent(state, { caseId: c.id, type: 'step.routed', actorId, at, stepId: s.id, causeId, targetActorIds: s.assigneeIds, label: `${s.label} → ${s.assigneeIds.length ? '담당 지정' : '관리자 대기열'}`, data: { rule: s.rule || null, ruleSource: s.ruleSource || null, queue: s.queue } }));
      }
    }
  }
  if (c.steps.every(s => s.status === 'done') && c.closure !== 'fact') emitted.push(newEvent(state, { caseId: c.id, type: 'case.closed', actorId, at, causeId: emitted.at(-1)?.id || causeId, targetActorIds: c.watchers || [] }));
  refreshCase(c, at);
  return emitted;
}

export const step = (id, def, resolved, group, extra = {}) => ({ id, key: def.key, label: def.label, role: def.role, roleLabel: STEP_ROLE_LABEL[def.role] || def.role, assigneeIds: resolved.assigneeIds, queue: resolved.queue, rule: resolved.rule || null, ruleSource: resolved.ruleSource || null, unassignedReason: resolved.reason || null, status: 'waiting', evidenceRequired: !!def.evidenceRequired, review: !!def.review, when: def.when || null, group, ...extra });

const at0 = (iso, fallback) => iso || fallback;
/** Seeds fact-closed source cases once per stable key (open 2.0 staff_tasks + workspace signals). */
export function seedSource(state, source) {
  let created = 0, reworded = 0;
  const seededAt = `${source.identity.capturedAt}`;
  for (const t of source.tasks) {
    const key = `task:${t.id}`; if (state.seededKeys[key]) continue;
    const id = `src-task-${t.id}`, kind = TASK_KINDS[t.kind] || { label: '할 일', familyId: 'tasks-notifications', doneRule: '' };
    const assigneeIds = t.assigneeIds.filter(a => source.actors.some(x => x.id === a));
    const resolved = assigneeIds.length ? { assigneeIds, queue: null, rule: '원래 할 일 담당', ruleSource: 'staff_task_assignees.user_id' } : { assigneeIds: [], queue: 'manager', reason: t.assigneeIds.length ? '배정된 사람이 재직 직원 목록에 없어 관리자 대기열' : '배정된 사람이 없어 관리자 대기열' };
    const refs = [`task:${t.id}`, ...(t.subjectKey ? [t.subjectKey] : [])].map(k => entityRef(source, k)).filter(Boolean);
    const closed = t.status && t.status !== 'open';
    state.cases[id] = { id, kind: 'source', scenario: null, familyId: kind.familyId, title: t.title || kind.label, summary: t.detail || kind.label, doneRule: kind.doneRule, taskKind: t.kind, sourceStatus: t.status || 'open', sourceStatusLabel: TASK_STATE_LABEL[t.status || 'open'], factClosed: closed, closedReason: closed ? CLOSE_REASON[t.closeReason] || TASK_STATE_LABEL[t.status] : null, closedAt: closed ? t.closedAt : null, priority: !closed && t.dueAt && t.dueAt < source.identity.capturedAt ? 'high' : 'normal', state: 'open', closure: 'fact', origin: 'snapshot', trigger: null, entityRefs: refs, steps: [step(`${id}-s1`, { key: 'source_task', label: kind.label, role: 'source', evidenceRequired: true }, resolved, 1, { status: closed ? 'done' : 'ready' })], currentStepId: null, assigneeIds: [], dueAt: t.dueAt, createdAt: at0(t.openedAt, seededAt), updatedAt: at0(t.closedAt || t.openedAt, seededAt), evidence: [], decision: null, history: [], linkedCaseIds: [], sourceKey: key, flags: {} };
    const c = state.cases[id];
    let cause = null;
    for (const h of t.history) cause = newEvent(state, { caseId: id, type: h.event === 'opened' ? 'source.task_opened' : 'source.task_event', label: TASK_EVENT_LABEL[h.event] || '할 일 변경', actorId: h.actor, origin: 'snapshot', at: h.at, causeId: cause?.id || null, targetActorIds: h.event === 'assigned' || h.event === 'opened' ? assigneeIds : [] });
    if (!cause) cause = newEvent(state, { caseId: id, type: 'source.task_opened', origin: 'snapshot', at: at0(t.openedAt, seededAt), targetActorIds: assigneeIds });
    c.trigger = { eventId: c.history[0], type: 'source.task_opened', label: kind.label, actorId: null, at: c.createdAt };
    refreshCase(c); state.seededKeys[key] = id; created += 1;
  }
  for (const sg of source.signals) {
    const key = `signal:${sg.familyId}:${sg.signal.id}`;
    // Already seeded: an open case follows the source's current wording (원장 10-28 '최근 결석 3회 이상' — 저장된 옛 문구가 남지 않게). History and state stay as they are.
    if (state.seededKeys[key]) { const c = state.cases[state.seededKeys[key]]; if (c && c.state !== 'done' && c.title !== sg.signal.title) { reworded += 1; for (const st of c.steps || []) if (st.key === 'source_check' && typeof st.label === 'string' && st.label.startsWith(c.title)) st.label = sg.signal.title + st.label.slice(c.title.length); c.title = sg.signal.title; c.summary = sg.signal.summary; } continue; }
    const id = `src-sig-${sg.familyId}-${sg.signal.id}`.replace(/[^a-z0-9-]/gi, '-');
    // One step per person who owns the referenced records (FK); records without an owner go to the manager queue.
    const owners = new Map();
    for (const ref of sg.refs) { const r = signalOwner(source, ref); const k = r.assigneeIds.join(',') || 'queue'; if (!owners.has(k)) owners.set(k, { resolved: r, refs: [] }); owners.get(k).refs.push(ref); }
    if (!owners.size) owners.set('queue', { resolved: { assigneeIds: [], queue: 'manager', reason: '근거 기록에 담당자가 없어 관리자 대기열' }, refs: [] });
    const steps = [...owners.values()].map((o, i) => step(`${id}-s${i + 1}`, { key: 'source_check', label: `${sg.signal.title}${o.refs.length ? ` · ${o.refs.length}건` : ''}`, role: 'source', evidenceRequired: true }, o.resolved, 1, { status: 'ready', refs: o.refs.slice(0, 50) }));
    state.cases[id] = { id, kind: 'source', scenario: null, familyId: sg.familyId, title: sg.signal.title, summary: sg.signal.summary, doneRule: '원본 기록이 바뀌면 닫힙니다.', signalId: sg.signal.id, priority: sg.signal.priority === '결정 필요' ? 'high' : 'normal', state: 'open', closure: 'fact', origin: 'snapshot', trigger: null, entityRefs: sg.refs.slice(0, 50).map(k => entityRef(source, k)).filter(Boolean), entityTotal: sg.refs.length, steps, currentStepId: null, assigneeIds: [], dueAt: null, createdAt: seededAt, updatedAt: seededAt, evidence: [], decision: null, history: [], linkedCaseIds: [], sourceKey: key, flags: {}, draft: sg.signal.draft };
    const e = newEvent(state, { caseId: id, type: 'source.signal', label: sg.signal.title, origin: 'snapshot', at: seededAt, targetActorIds: [...new Set(steps.flatMap(s => s.assigneeIds))], data: { source: sg.signal.source } });
    state.cases[id].trigger = { eventId: e.id, type: 'source.signal', label: sg.signal.title, actorId: null, at: seededAt };
    refreshCase(state.cases[id]); state.seededKeys[key] = id; created += 1;
  }
  return created + reworded; // reworded open cases are written too (the caller persists when this is > 0)
}

function signalOwner(source, ref) {
  const e = source.entities.get(ref), none = reason => ({ assigneeIds: [], queue: 'manager', reason });
  if (!e) return none('근거 기록을 찾지 못해 관리자 대기열');
  const real = list => [...new Set((list || []).filter(id => source.actors.some(a => a.id === id)))];
  const by = (list, rule, ruleSource) => { const r = real(list); return r.length ? { assigneeIds: r, queue: null, rule, ruleSource } : none('담당자가 재직 직원 목록에 없어 관리자 대기열'); };
  if (e.type === 'attendance') return by([source.entities.get(`class:${e.classId}`)?.teacherId], '해당 반의 담당 강사', 'classes.teacher_id');
  if (e.type === 'approval') return by(e.approvers, '결재 차례인 사람', 'approval_steps.approver_id');
  if (e.type === 'withdrawal_report') return by(e.managers, '승인할 관리자', 'withdrawal_reports.manager_ids');
  if (e.type === 'asset') return by([e.borrowerId], '빌려 간 사람', 'inventory_loans.borrower_user_id');
  if (e.type === 'video') return by([e.teacherId], '숙제를 낸 선생님', 'student_homework_videos.teacher_id');
  if (e.type === 'lead') return by(relatedKeys(source, ref, ['consultant']).map(k => k.split(':')[1]), '상담자', 'enrollment_consultations.consultant_id');
  return none('이 기록에는 담당자 열이 없어 관리자 대기열');
}

export { ROLE_NAME, PREVIEW_OWNER };
