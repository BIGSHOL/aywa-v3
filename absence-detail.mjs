import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { queryGate } from './v2-onescreen-roster.mjs';
import { cellAxes, homeroomHistory } from './v2-dashboard-attendance.mjs';
import { groupAbsenceSessions } from './absence-sessions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stateLabel = { open: '처리 대기', pending: '처리 대기', done: '처리 완료', completed: '처리 완료', resolved: '처리 완료', dismissed: '해당 없음', cancelled: '취소' };

export async function loadAbsenceDetail({ studentId, attendanceId, asOf }) {
  const db = await openFullDatabase();
  try {
    return await db.begin('read only', async sql => {
      if (attendanceId) {
        const [source] = await sql`select student_id::text id from public.attendance_records where tenant_id=${tenantId} and id=${attendanceId}`;
        if (!source) return null;
        studentId = source.id;
      }
      const [student] = await sql`select id::text id, name from public.students where tenant_id=${tenantId} and id=${studentId} and not coalesce(is_test,false)`;
      if (!student) return null;
      const monthStart = `${asOf.slice(0, 7)}-01`;
      const rows = await sql`select a.id::text id, a.student_id::text student_id, a.session_date::text session_date, a.class_id::text class_id, c.class_name "className",
          coalesce(sched.times, to_char(a.slot_start,'HH24:MI')) time,
          a.note memo, a.slot_start::text slot_start, a.taught_by::text taught_by, a.seat_label, a.recorded_via::text recorded_via
        from public.attendance_records a
        left join public.classes c on c.id=a.class_id and c.tenant_id=${tenantId}
        left join lateral (
          select string_agg(to_char(cs.start_time,'HH24:MI') || '~' || to_char(cs.end_time,'HH24:MI'), ', ' order by cs.start_time) times
          from public.class_schedules cs
          where cs.tenant_id=${tenantId} and cs.class_id=a.class_id
            and cs.day_of_week::text=lower(to_char(a.session_date,'Dy'))
            and (a.slot_start is null or cs.start_time=a.slot_start)
            and (cs.valid_from is null or cs.valid_from<=a.session_date)
            and (cs.valid_to is null or cs.valid_to>=a.session_date)
        ) sched on true
        where a.tenant_id=${tenantId} and a.student_id=${studentId} and a.session_date between ${monthStart} and ${asOf}
          and a.status='absent' and not exists (select 1 from public.attendance_records b where b.tenant_id=${tenantId} and b.supersedes_id=a.id)
        order by a.session_date desc, a.class_id, a.slot_start nulls last, a.id`;
      // 운영실 최근 결석과 같은 2.0 교시 담당 판정: 대신 보강 → 자리 → 유효 교시 → 그날 담임.
      const [axis, asOfTeacher, kst, intake, queue] = await Promise.all([
        importV2('features/attendance/teacher-axis.ts'), importV2('features/classes/teacher-as-of.ts'),
        importV2('lib/date-kst.ts'), importV2('features/attendance/intake/absence-intake.ts'), importV2('features/attendance/live/queue.ts'),
      ]);
      const rules = { axis, asOf: asOfTeacher, kst, intake };
      const history = rows.length ? await homeroomHistory(rules, queryGate(sql), tenantId) : null;
      const teachers = rows.length ? await cellAxes(rules, sql, tenantId, rows, history) : new Map();
      const followups = await sql`select class_id::text class_id, session_date::text date, slot_start::text slot, state::text state, outcome::text outcome, note
        from public.attendance_followups where tenant_id=${tenantId} and student_id=${studentId} and session_date between ${monthStart} and ${asOf}`;
      const combined = values => [...new Set(values.filter(Boolean))];
      return { student, month: asOf.slice(0, 7), rows: groupAbsenceSessions(rows).map(session => {
        const matched = followups.filter(f => f.class_id === session.classId && f.date === session.date
          && (!f.slot || session.cells.some(cell => !cell.slot_start || f.slot === cell.slot_start)));
        const teacherNames = combined(session.cells.map(cell => teachers.get(cell.id)?.label));
        const followupNames = combined(matched.map(f => [stateLabel[f.state] || '후속 기록', queue.OUTCOME_LABEL[f.outcome] || '', f.note].filter(Boolean).join(' · ')));
        return { id: session.id, date: session.date, classId: session.classId, className: session.className,
          time: combined(session.cells.map(cell => cell.time)).join(', '),
          teacher: teacherNames.join(' · ') || '담당 기록 없음',
          teacherSource: teachers.get(session.id)?.source || 'none',
          memo: combined(session.cells.map(cell => cell.memo)).join(' / '),
          followup: followupNames.join(' / ') || '후속 기록 없음' };
      }) };
    });
  } finally { await db.end(); }
}

export async function handleAbsenceDetail(req, res, headers, asOf) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/attendance-absences') return false;
  const send = (code, body) => { const bytes = Buffer.from(JSON.stringify(body)); res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, ...(code === 405 ? { Allow: 'GET, HEAD' } : {}) }); res.end(req.method === 'HEAD' ? undefined : bytes); };
  if (!['GET', 'HEAD'].includes(req.method)) { req.resume(); send(405, { error: 'method_not_allowed' }); return true; }
  const studentId = url.searchParams.get('student'), attendanceId = url.searchParams.get('attendance');
  if (Boolean(studentId) === Boolean(attendanceId) || (studentId && !UUID.test(studentId)) || (attendanceId && !UUID.test(attendanceId))) { send(400, { error: 'invalid_record' }); return true; }
  const data = await loadAbsenceDetail({ studentId, attendanceId, asOf });
  send(data ? 200 : 404, data || { error: 'not_found' });
  return true;
}
