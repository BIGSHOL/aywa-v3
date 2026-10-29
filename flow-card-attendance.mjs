// 결석 확인 전화 업무 카드: 근거 결석 기록을 고른 뒤 2.0 recordFollowup을 공통 쓰기 경로로 실행한다.
import { openFullDatabase, tenantId } from './full-db.mjs';
import { sourceCardCase } from './flow-card-guard.mjs';
import { V2Error } from './v2-screens.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const STEP_ID = /^[A-Za-z0-9_-]{1,140}$/;
const OUTCOMES = new Set(['coming', 'absent_today', 'sick', 'already_here', 'no_answer', 'other']);
const VIAS = new Set(['phone', 'kakao', 'in_person', 'other']);
const MODULE = 'features/attendance/live/server/actions.ts';
const bad = (status, code, message) => new V2Error(status, code, message);
const own = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));

async function taskAndRecords(sql, taskId, lock = false) {
  const rows = lock
    ? await sql`select kind, status::text status, subject_id::text student_id, cycle from public.staff_tasks where tenant_id=${tenantId} and id=${taskId} for update`
    : await sql`select kind, status::text status, subject_id::text student_id, cycle from public.staff_tasks where tenant_id=${tenantId} and id=${taskId}`;
  const task = rows[0];
  if (!task || task.kind !== 'attendance_absent_desk' || task.status !== 'open' || !UUID.test(task.student_id || '')) throw bad(409, 'source_changed', '원본 결석 업무가 달라졌습니다. 새로 불러와 주세요.');
  const [date, slot = ''] = String(task.cycle || '').split('|');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (slot && !/^\d{2}:\d{2}$/.test(slot))) throw bad(409, 'source_changed', '원본 결석 업무를 확인하지 못했습니다.');
  const records = await sql`select a.id::text id, a.student_id::text student_id, a.class_id::text class_id,
      a.session_date::text session_date, to_char(a.slot_start, 'HH24:MI') slot_start, c.class_name
    from public.attendance_records a left join public.classes c on c.tenant_id=a.tenant_id and c.id=a.class_id
    where a.tenant_id=${tenantId} and a.student_id=${task.student_id} and a.session_date=${date}
      and a.status='absent' and (${slot}='' or a.slot_start is null or to_char(a.slot_start, 'HH24:MI')=${slot})
      and not exists (select 1 from public.attendance_records b where b.tenant_id=a.tenant_id and b.supersedes_id=a.id)
    order by a.slot_start nulls first, a.class_id, a.id`;
  return { task, records };
}

export function createFlowCardAttendance({ flow, v2ScreenRoute, open = openFullDatabase }) {
  return {
    async records(caseId) {
      if (!CASE_ID.test(caseId || '')) throw bad(400, 'invalid_request', '업무 번호를 확인해 주세요.');
      const { taskId } = sourceCardCase(flow.service, caseId, 'attendance_absent_desk');
      const db = await open();
      try {
        const records = await db.begin('isolation level repeatable read read only', async sql => (await taskAndRecords(sql, taskId)).records);
        return { caseId, records: records.map(r => ({ recordRef: `attendance:${r.id}`, className: r.class_name || '반 이름 없음', date: r.session_date, slotStart: r.slot_start || null })) };
      } finally { await db.end(); }
    },
    async save(raw) {
      const keys = ['caseId', 'stepId', 'recordRef', 'expectedRevision', 'actorId', 'state', 'outcome', 'contactedVia', 'note'];
      if (!own(raw, keys) || !CASE_ID.test(raw.caseId || '') || !STEP_ID.test(raw.stepId || '') || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 0
        || !/^attendance:[0-9a-f-]{36}$/i.test(raw.recordRef || '') || !UUID.test(raw.actorId || '')
        || !['resolved', 'dismissed'].includes(raw.state) || (raw.outcome != null && !OUTCOMES.has(raw.outcome))
        || (raw.contactedVia != null && !VIAS.has(raw.contactedVia)) || (raw.note != null && (typeof raw.note !== 'string' || raw.note.length > 2000))) throw bad(400, 'invalid_request', '결석 처리 내용을 확인해 주세요.');
      const { taskId } = sourceCardCase(flow.service, raw.caseId, 'attendance_absent_desk', raw.expectedRevision, raw.stepId, raw.actorId);
      const recordId = raw.recordRef.slice('attendance:'.length);
      const db = await open();
      let picked;
      try {
        picked = await db.begin('isolation level repeatable read read only', async sql => (await taskAndRecords(sql, taskId)).records.find(r => r.id === recordId));
      } finally { await db.end(); }
      if (!picked) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 결석 기록이 아닙니다. 새로 불러와 주세요.');
      const input = { studentId: picked.student_id, classId: picked.class_id, sessionDate: picked.session_date, slotStart: picked.slot_start || null, signal: 'absent', state: raw.state, outcome: raw.outcome || null, contactedVia: raw.contactedVia || null, note: raw.note || null };
      const result = await v2ScreenRoute.performWrite({
        id: 'attendance', name: 'recordFollowup',
        raw: { module: MODULE, actor: raw.actorId, args: [input] },
        beforeRun: async ({ sql }) => {
          sourceCardCase(flow.service, raw.caseId, 'attendance_absent_desk', raw.expectedRevision, raw.stepId, raw.actorId);
          const { records } = await taskAndRecords(sql, taskId, true);
          const fresh = records.find(r => r.id === recordId);
          if (!fresh || fresh.student_id !== input.studentId || fresh.class_id !== input.classId || fresh.session_date !== input.sessionDate || (fresh.slot_start || null) !== input.slotStart) throw bad(409, 'record_ref_not_allowed', '이 업무와 연결된 결석 기록이 달라졌습니다. 새로 불러와 주세요.');
        },
        afterRun: ({ result }) => {
          if (!result || result.ok !== true || !UUID.test(result.id || '')) throw bad(409, 'save_refused', typeof result?.error === 'string' && /[가-힣]/.test(result.error) ? result.error : '결석 처리 결과가 저장되지 않았습니다.');
        },
      });
      return { saved: true, recordRef: raw.recordRef, followupId: result.id, message: '원본 반영 확인 중' };
    },
  };
}
