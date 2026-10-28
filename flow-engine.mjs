// Flow engine core: role resolution, step progression and the record-owner rule for source signals.
// Seeding and re-judging the source live in flow-reconcile.mjs; state in flow-store.mjs; commands in flow-commands.mjs.
import { EVENT_TYPES, ROLE_NAME, STEP_ROLE_LABEL } from './flow-rules.mjs';

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

/** Who owns one signal record (FK, code — not AI). Ids are sorted so the same people make the same step on every load. */
export function signalOwner(source, ref) {
  const e = source.entities.get(ref), none = reason => ({ assigneeIds: [], queue: 'manager', reason });
  if (!e) return none('근거 기록을 찾지 못해 관리자 대기열');
  const real = list => [...new Set((list || []).filter(id => source.actors.some(a => a.id === id)))].sort();
  const by = (list, rule, ruleSource) => { const r = real(list); return r.length ? { assigneeIds: r, queue: null, rule, ruleSource } : none('담당자가 재직 직원 목록에 없어 관리자 대기열'); };
  const related = types => relatedKeys(source, ref, types).map(k => k.split(':')[1]);
  if (e.type === 'attendance' || e.type === 'makeup') return by([source.entities.get(`class:${e.classId}`)?.teacherId], '해당 반의 담당 강사', 'classes.teacher_id');
  if (e.type === 'approval') return by(e.approvers, '결재 차례인 사람', 'approval_steps.approver_id');
  if (e.type === 'withdrawal_report') return by(e.managers, '승인할 관리자', 'withdrawal_reports.manager_ids');
  if (e.type === 'asset') return by([e.borrowerId], '빌려 간 사람', 'inventory_loans.borrower_user_id');
  if (e.type === 'video') return by([e.teacherId], '숙제를 낸 선생님', 'student_homework_videos.teacher_id');
  if (e.type === 'lead') return by(related(['consultant']), '상담자', 'enrollment_consultations.consultant_id');
  if (e.type === 'consultation') return by(related(['counselor']), '상담을 맡은 사람', 'student_consultations.counselor_id');
  if (e.type === 'report') return by(related(['written_by']), '보고서를 쓴 선생님', 'lesson_reports.created_by');
  if (e.type === 'notice') return by(related(['written_by']), '공지를 보낸 사람', 'classnote_notices.created_by');
  // 강사평가 판정은 그 강사에게 보내지 않는다 — 원장·관리자가 확인한다(만족도 판정에는 담당 열이 없다).
  if (e.type === 'satisfaction') return none('강사평가 만족도 판정은 관리자·원장이 확인해 관리자 대기열');
  if (e.type === 'integration' || e.type === 'sync_run') return none('연동 설정은 관리자·원장이 확인해 관리자 대기열');
  return none('이 기록에는 담당자 열이 없어 관리자 대기열');
}
/** Owner key of one signal record: the same people (sorted) or the manager queue. */
export const ownerKeyOf = resolved => resolved.assigneeIds.join(',') || 'queue';

export { ROLE_NAME, PREVIEW_OWNER };
