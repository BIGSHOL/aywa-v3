// Synthetic flow source for verify-flow-engine.mjs (no DB). Shaped like loadFlowSource().
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlowService } from './flow-service.mjs';

export const IDS = { owner: 'u-owner', manager: 'u-manager', t1: 'u-t1', t2: 'u-t2', desk: 'u-desk', platform: 'u-platform' };
export function fixtureSource() {
  const entities = new Map(), relations = [];
  const put = (type, id, label, familyId, extra = {}) => entities.set(`${type}:${id}`, { type, id, label, familyId, recordId: id, ...extra });
  const link = (type, from, to, source) => relations.push({ id: `rel-${relations.length + 1}`, type, from: { type: from.split(':')[0], id: from.split(':')[1] }, to: { type: to.split(':')[0], id: to.split(':')[1] }, source });
  const actors = [
    { id: IDS.owner, name: '원장님', role: 'owner', roleLabel: '원장', systemRole: 'master', desk: false, assignable: true },
    { id: IDS.manager, name: '김관리', role: 'manager', roleLabel: '관리자', systemRole: 'admin', desk: false, assignable: true },
    { id: IDS.t1, name: '이담임', role: 'teacher', roleLabel: '강사', systemRole: 'teacher', desk: false, assignable: true },
    { id: IDS.t2, name: '박강사', role: 'teacher', roleLabel: '강사', systemRole: 'teacher', desk: false, assignable: true },
    { id: IDS.desk, name: '최데스크', role: 'staff', roleLabel: '참관', systemRole: 'viewer', desk: true, assignable: false },
  ];
  for (const a of actors) put('staff', a.id, a.name, 'staff');
  put('staff', IDS.platform, '운영지원', 'staff');
  put('student', 's1', '홍길동', 'students'); put('student', 's2', '김철수', 'students');
  put('class', 'c1', '중1 수학', 'classes', { teacherId: IDS.t1 }); link('homeroom', 'class:c1', `staff:${IDS.t1}`, 'classes.teacher_id');
  put('class', 'c2', '중1 영어', 'classes', { teacherId: IDS.t2 }); link('homeroom', 'class:c2', `staff:${IDS.t2}`, 'classes.teacher_id');
  put('enrollment', 'e1', '수강', 'classes'); link('enrollment_of', 'enrollment:e1', 'student:s1', 'enrollments.student_id'); link('enrollment_in', 'enrollment:e1', 'class:c1', 'enrollments.class_id');
  put('enrollment', 'e2', '수강', 'classes'); link('enrollment_of', 'enrollment:e2', 'student:s1', 'enrollments.student_id'); link('enrollment_in', 'enrollment:e2', 'class:c2', 'enrollments.class_id');
  put('attendance', 'a1', '2026-10-24 결석', 'attendance', { date: '2026-10-24', studentId: 's1', classId: 'c1' }); link('about_student', 'attendance:a1', 'student:s1', 'attendance_records.student_id'); link('in_class', 'attendance:a1', 'class:c1', 'attendance_records.class_id');
  put('attendance', 'a2', '2026-10-25 결석', 'attendance', { date: '2026-10-25', studentId: 's2', classId: 'c2' }); link('about_student', 'attendance:a2', 'student:s2', 'attendance_records.student_id'); link('in_class', 'attendance:a2', 'class:c2', 'attendance_records.class_id');
  put('invoice', 'i1', '홍길동 · 10월 청구', 'billing', { remaining: 20000, dueDate: '2026-10-31', period: '2026-10' }); link('billed_to', 'invoice:i1', 'student:s1', 'invoices.student_id');
  put('consultation', 'k1', '2026-10-20 상담', 'consultations', { date: '2026-10-20' }); link('about_student', 'consultation:k1', 'student:s2', 'student_consultations.student_id'); link('counselor', 'consultation:k1', `staff:${IDS.t2}`, 'student_consultations.counselor_id');
  for (const id of ['t-open', 't-done', 't-orphan']) put('task', id, '결석 확인 전화', 'attendance');
  link('assigned_to', 'task:t-open', `staff:${IDS.desk}`, 'staff_task_assignees.user_id'); link('about', 'task:t-open', 'student:s1', 'staff_tasks.subject_id');
  const tasks = [
    { id: 't-open', kind: 'attendance_absent_desk', status: 'open', closeReason: null, closedAt: null, title: '결석 확인 전화', detail: '홍길동 · 10-24 결석 — 학부모 확인', openedAt: '2026-10-24T08:00:00Z', dueAt: '2026-10-25T15:00:00Z', assigneeIds: [IDS.desk], subjectKey: 'student:s1', history: [{ id: '1', event: 'opened', actor: IDS.t1, at: '2026-10-24T08:00:00Z' }, { id: '2', event: 'assigned', actor: null, at: '2026-10-24T08:00:01Z' }] },
    { id: 't-done', kind: 'attendance_absent_desk', status: 'done', closeReason: 'desk_settled', closedAt: '2026-10-23T09:00:00Z', title: '결석 확인 전화', detail: '김철수 · 10-22 결석', openedAt: '2026-10-22T08:00:00Z', dueAt: '2026-10-23T15:00:00Z', assigneeIds: [IDS.desk], subjectKey: 'student:s2', history: [{ id: '3', event: 'opened', actor: null, at: '2026-10-22T08:00:00Z' }, { id: '4', event: 'done', actor: IDS.desk, at: '2026-10-23T09:00:00Z' }] },
    { id: 't-orphan', kind: 'enrollment_followup', status: 'open', closeReason: null, closedAt: null, title: '콜&상담 후속 조치', detail: '', openedAt: '2026-10-25T08:00:00Z', dueAt: null, assigneeIds: [IDS.platform], subjectKey: null, history: [] },
  ];
  const signals = [
    { familyId: 'attendance', signal: { id: 'attendance-repeat-absence', title: '결석 3회 이상 재원생 2명', summary: '이번 달 결석 3회 이상', priority: '확인 필요', source: '출석부', recordIds: ['a1', 'a2'], draft: { title: '결석 확인', body: '확인해 주세요' } }, refs: ['attendance:a1', 'attendance:a2'] },
    { familyId: 'billing', signal: { id: 'billing-remaining', title: '수납 확인 1건', summary: '남은 금액', priority: '확인 필요', source: '수납', recordIds: ['i1'], draft: { title: '수납 확인', body: '확인해 주세요' } }, refs: ['invoice:i1'] },
  ];
  return { identity: { tenantId: 'tenant-test', tenantSlug: 'cs', capturedAt: '2026-10-27T05:34:00.000Z', asOf: '2026-10-27' }, actors, entities, relations, tasks, signals, candidates: { absence: ['a1', 'a2'], billing: ['i1'], consultation: ['k1'] } };
}

/** AI double: never network. `mode` decides what the "provider" says. */
export function fakeAI(mode = 'unavailable', calls = []) {
  const rec = (status, route, extra = {}) => ({ id: `dec-${calls.length}`, status, route, label: `판정: ${route}`, needsReview: extra.needsReview ?? true, priority: extra.priority ?? null, record: { id: `dec-${calls.length}`, provider: mode === 'unavailable' ? 'none' : 'typesafe', model: mode === 'unavailable' ? null : 'jev-1.14.0', status, route, reason: extra.reason || null, probabilities: null, elapsedMs: 1, usage: null } });
  const decide = c => { calls.push(c.id); if (mode === 'throws') throw new Error('boom'); if (mode === 'auto') return rec('decided', 'auto_route', { needsReview: false, priority: 'high' }); return rec('unavailable', 'human_review', { reason: 'decision_module_unavailable' }); };
  return { route: async c => decide(c), analyze: async c => decide(c), status: () => ({ providers: [{ id: 'jev', label: 'Jev 판정', status: mode === 'auto' ? 'ready' : 'unavailable' }] }) };
}

/** AI double whose answers wait until release() (slow provider outside the write queue). */
export function gatedAI(mode = 'auto') {
  const calls = [], inner = fakeAI(mode, calls), waiting = [];
  const wait = () => new Promise(r => waiting.push(r));
  return { calls, release: () => waiting.splice(0).forEach(r => r()), route: async (c, s) => { await wait(); return inner.route(c, s); }, analyze: async (c, s) => { await wait(); return inner.analyze(c, s); }, status: inner.status };
}

export async function service({ dir, mode, calls, ai, waitMs, source = fixtureSource(), lock = false } = {}) {
  const d = dir || await mkdtemp(join(tmpdir(), 'flow-test-'));
  return { dir: d, svc: await createFlowService({ source, dir: d, ai: ai || fakeAI(mode, calls), lock, waitMs, tenantName: '테스트 지점' }) };
}

let n = 0;
/** Sends a command with the current revision unless one is given. */
export const send = (svc, body) => svc.command({ commandId: `cmd-test-${(n += 1).toString().padStart(4, '0')}`, expectedRevision: svc.view().revision, payload: {}, ...body });
