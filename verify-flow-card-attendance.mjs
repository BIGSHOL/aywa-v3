// 카드 저장의 담당·revision·원본 근거 확인. 가짜 DB만 사용하며 실제 복사본은 쓰지 않는다.
import assert from 'node:assert/strict';
import { createFlowCardAttendance } from './flow-card-attendance.mjs';

const ACTOR = '268b797c-d00a-4475-8f6d-68894e47ccac';
const OTHER = '123e4567-e89b-42d3-a456-426614174000';
const TASK = 'ad26867d-2568-44ef-848e-77922eb2f892';
const RECORD = '47b42a70-2ee0-4521-b626-e6bd34a39b22';
const STUDENT = 'd2310fa0-9b42-4d53-a4a4-843421001908';
const CLASS = '347347bd-b925-48cf-a032-17c2b4359880';
const CASE = 'src-task-' + TASK, STEP = CASE + '-s1';
const state = { revision: 7, cases: { [CASE]: { id: CASE, taskKind: 'attendance_absent_desk', closure: 'fact', factClosed: false, state: 'open', sourceKey: 'task:' + TASK, steps: [{ id: STEP, status: 'ready', assigneeIds: [ACTOR] }] } } };
const flow = { service: { store: { state }, source: { actors: [{ id: ACTOR, role: 'staff' }, { id: OTHER, role: 'staff' }] } } };
let dbOpens = 0, writes = 0, changed = false, race = false, lastRaw = null;
const sql = (parts) => {
  const query = parts.join('?');
  if (query.includes('from public.staff_tasks')) return Promise.resolve([{ kind: 'attendance_absent_desk', status: 'open', student_id: STUDENT, cycle: '2026-10-29|15:00' }]);
  if (query.includes('from public.attendance_records a')) return Promise.resolve(changed ? [] : [{ id: RECORD, student_id: STUDENT, class_id: CLASS, session_date: '2026-10-29', slot_start: '15:00', class_name: '시험반' }]);
  throw Error('unexpected SQL');
};
const open = async () => { dbOpens++; return { begin: (_mode, fn) => fn(sql), end: async () => {} }; };
const v2ScreenRoute = { performWrite: async ({ id, name, raw, beforeRun, afterRun }) => {
  assert.deepEqual([id, name], ['attendance', 'recordFollowup']); lastRaw = raw;
  if (race) { changed = true; race = false; }
  await beforeRun({ sql, body: { input: raw.args[0] } });
  writes++;
  const result = { ok: true, id: RECORD }; await afterRun({ result }); return result;
} };
const card = createFlowCardAttendance({ flow, v2ScreenRoute, open });
const input = { caseId: CASE, stepId: STEP, recordRef: 'attendance:' + RECORD, expectedRevision: 7, actorId: ACTOR, state: 'resolved', outcome: 'no_answer', contactedVia: 'phone', note: '시험장 검증' };

const listed = await card.records(CASE);
assert.deepEqual(listed.records, [{ recordRef: input.recordRef, className: '시험반', date: '2026-10-29', slotStart: '15:00' }]);
assert.equal((await card.save(input)).saved, true);
assert.deepEqual(lastRaw.args[0], { studentId: STUDENT, classId: CLASS, sessionDate: '2026-10-29', slotStart: '15:00', signal: 'absent', state: 'resolved', outcome: 'no_answer', contactedVia: 'phone', note: '시험장 검증' });
assert.equal(writes, 1);

for (const bad of [{ ...input, actorId: OTHER }, { ...input, expectedRevision: 6 }, { ...input, recordRef: 'attendance:' + OTHER }, { ...input, classId: OTHER }]) {
  await assert.rejects(card.save(bad));
}
assert.equal(writes, 1, '권한·개정·근거 오류는 2.0 액션을 부르지 않음');
race = true;
await assert.rejects(card.save(input), e => e.code === 'record_ref_not_allowed');
assert.equal(writes, 1, '조회 뒤 원본이 달라져도 2.0 액션을 부르지 않음');
changed = true;
await assert.rejects(card.save(input), e => e.code === 'record_ref_not_allowed');
assert.equal(writes, 1);
assert.ok(dbOpens >= 3);
console.log('flow card attendance: 7 checks passed');
