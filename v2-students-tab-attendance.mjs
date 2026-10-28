// 원생 상세 '출결' 탭 자료 — 2.0 attendance-tab.tsx(AttendanceTab)가 서버에서 읽던 값을 Docker 복사본에서 같은 결과로.
// · records = getStudentAttendanceFull — 학생 출결 전건(날짜 내림차순 · id 오름차순) → 2.0 effectiveAttendanceRecords(칸마다 최신 정정 한 줄)
//   + 그날 그 반 수업보고서 작성자(반이 적힌 보고서만 · 날짜·id 오름차순으로 먼저 온 이름).
// · enrollments = getStudentEnrollments(상세와 같은 조회) · upcoming = getStudentUpcomingReservations(오늘 = 복사본 날짜) ·
//   classRows = 예약의 반 이름(수강 목록에 없는 반일 수 있어 따로 — 실패하면 빈 목록).
// 수업 선택지(buildAttendanceClassOptions)는 2.0 탭 본문이 그대로 만든다(호스트). 읽기 전용.
import { readUpcomingReservations } from './v2-students-detail.mjs';

let modsP = null;
const mods = (load) => (modsP ??= load('features/attendance/effective-records.ts').catch((e) => { modsP = null; throw e; }));

/** getStudentAttendanceFull — 2.0 반환 모양(StudentAttendanceFull) 그대로. */
export async function readAttendanceFull(sql, t, id, E) {
  const rows = await sql`select a.id::text id, a.student_id::text student_id, a.session_date::text session_date, a.status::text status, a.note,
      a.class_id::text class_id, a.slot_start::text slot_start, a.seat_label, to_json(a.recorded_at)#>>'{}' recorded_at, c.class_name, c.subject
    from public.attendance_records a left join public.classes c on c.id = a.class_id and c.tenant_id = ${t}
    where a.tenant_id=${t} and a.student_id=${id} order by a.session_date desc, a.id asc`;
  // 보고서 작성자 — 2.0은 실패하면 빈 목록(.catch(() => [])).
  const reports = await sql.soft((sp) => sp`select report_date::text report_date, class_id::text class_id, teacher_name from public.lesson_reports
    where tenant_id=${t} and student_id=${id} and class_id is not null order by report_date asc, id asc`, []);
  const reporter = new Map();
  for (const rp of reports) {
    const name = rp.teacher_name?.trim();
    if (!name || !rp.class_id) continue;
    const key = `${rp.report_date}|${rp.class_id}`;
    if (!reporter.has(key)) reporter.set(key, name);
  }
  return E.effectiveAttendanceRecords(rows).map((r) => ({
    date: r.session_date, status: r.status, className: r.class_name ?? '?', classId: r.class_id, note: r.note, subject: r.subject ?? '',
    slotStart: r.slot_start, seatLabel: r.seat_label, reporter: reporter.get(`${r.session_date}|${r.class_id}`) ?? null,
  }));
}

export async function loadTab(ctx) {
  const { base, sql, t, id, today } = ctx;
  const E = await mods(ctx.importV2);
  // 차례대로(한 관문) — 2.0 Promise.all과 같은 값.
  const records = await readAttendanceFull(sql, t, id, E);
  const enrollments = await ctx.readStudentEnrollments(base, id);
  const upcoming = await readUpcomingReservations(base, id, today);
  const classIds = [...new Set(upcoming.map((r) => r.classId))];
  const classRows = classIds.length
    ? await sql.soft((sp) => sp`select id::text id, class_name from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`, [])
    : [];
  return { records, enrollments, upcoming, classRows: classRows.map((r) => ({ id: r.id, class_name: r.class_name })) };
}
