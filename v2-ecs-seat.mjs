// 2.0 화면 · 강사 시트(ECS) — JJ실 면(/ecs?view=room). 2.0 `ecs/page.tsx`의 room 갈래가 `EcsSeatDayFace`에 넘기는 값 =
// `getEcsSeatDay("JJ", date)`(features/class-sheets/server/seat-day.ts)의 반환 그대로. 조립은 2.0 `assembleSeatPeriods`(seat-day-assemble.ts —
// server 폴더지만 순수 함수)를 그대로 부르고, 조회만 같은 표·칸·조건을 SQL로 옮겼다.
// 저장은 기존 동작 그대로(setAttendanceCell · clearPresentAttendance · upsertStudentMark · commitSheetEdits — v2-ecs-save.mjs).
// 2.0과 다른 것: 출결 사유·특이사항의 연락처는 3.0 전 화면처럼 가린다(가린 칸은 저장이 덮지 않는다 — 주간 시트와 같은 규약).
import { canWriteLevel, isoAt, jjManagedClassIds, readClassNameAsOf, shown } from './v2-ecs-core.mjs';
import { visibleClassFilter } from './v2-ecs-props.mjs';

/** 2.0 getTeachingClassIds(user, date).all — 담임 반 ∪ 그날 위임 반 ∪ 그날 JJ 보고서 담당 반. */
async function teachingClassIds(sql, t, R, env, userId, date) {
  const [own, delegated, jj] = await Promise.all([
    sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${userId}`,
    sql`select distinct class_id::text id from public.class_delegations where tenant_id=${t} and delegate_user_id=${userId} and revoked_at is null and from_date <= ${date} and to_date >= ${date}`,
    jjManagedClassIds(sql, t, R, env, userId, date),
  ]);
  return new Set([...own.map(r => r.id), ...delegated.map(r => r.id), ...jj]);
}

/** 2.0 getEcsSeatDay(seat, dateRaw) — 스코프가 있으면 그 반만, 없으면(사무실) 전 영어 반. */
export async function seatDayData(sql, t, R, env, viewer, seat, dateRaw, today) {
  const ecsLevel = viewer.levels.ecs;
  if (ecsLevel === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const date = dateRaw && R.YMD_RE.test(dateRaw) ? dateRaw : today;
  const dow = R.dowKeyOf(date);
  const [{ classIds: visibleIds }, sched, nameIndex] = await Promise.all([
    visibleClassFilter(sql, t, R, viewer, null, today),
    sql`select class_id::text class_id, start_time::text start_time, end_time::text end_time, slot_teacher_label from public.class_schedules
      where tenant_id=${t} and day_of_week::text=${dow} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date}) order by id`,
    readClassNameAsOf(sql, t, R, today),
  ]);
  const seatSched = sched.filter(s => R.isSeatLabel(s.slot_teacher_label, seat));
  const rawClassIds = [...new Set(seatSched.map(s => s.class_id))];
  const classRows = rawClassIds.length ? await sql`select id::text id, class_name, subject, is_active, closed_at::text closed_at from public.classes where tenant_id=${t} and id = any(${rawClassIds}::uuid[])` : [];
  const classById = new Map(classRows.map(c => [c.id, c])), scopeSet = visibleIds ? new Set(visibleIds) : null;
  const slots = [];
  for (const s of seatSched) {
    if (scopeSet && !scopeSet.has(s.class_id)) continue;
    const cls = classById.get(s.class_id);
    if (!cls || cls.subject !== 'english' || !cls.is_active) continue;
    if (cls.closed_at && cls.closed_at < date) continue;
    slots.push({ classId: s.class_id, className: R.resolveClassNameAsOf(nameIndex, s.class_id, date, cls.class_name)?.name ?? cls.class_name, startTime: s.start_time, endTime: s.end_time, slotTeacherLabel: s.slot_teacher_label });
  }
  const classIds = [...new Set(slots.map(s => s.classId))];
  const empty = { date, today, seat, periods: [], userId: viewer.id, tenantId: t, canWriteEcs: ecsLevel === 'full' || ecsLevel === 'scoped', fontSize: R.readEcsFontSize(viewer.uiPrefs) };
  if (classIds.length === 0) return { ok: true, data: empty };
  const [enrollRows, marksRaw, attRaw] = await Promise.all([
    sql`select e.class_id::text class_id, e.student_id::text student_id, e.attendance_days, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
        s.withdrawn_at::text withdrawn_at from public.enrollments e join public.students s on s.id=e.student_id
      where e.tenant_id=${t} and e.class_id = any(${classIds}::uuid[]) and e.start_date <= ${date} order by e.id`,
    sql`select class_id::text class_id, student_id::text student_id, slot_start::text slot_start, status, progress_note, score, listening_level, memorized_words from public.class_sheet_student_marks
      where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and mark_date=${date} order by id`,
    sql`select id::text id, class_id::text class_id, student_id::text student_id, status::text status, note, recorded_at, session_date::text session_date, slot_start::text slot_start, session_units::float8 session_units
      from public.attendance_records where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and session_date=${date} order by id`,
  ]);
  // PostgREST 임베드(students!inner(withdrawn_at))와 같은 모양 — 조립 함수가 그 칸을 읽는다.
  const enrollments = enrollRows.map(({ withdrawn_at, ...e }) => ({ ...e, students: { withdrawn_at: withdrawn_at ?? null } }));
  const marks = marksRaw.map(m => ({ ...m, progress_note: shown(m.progress_note ?? null) }));
  const attendance = attRaw.map(a => ({ ...a, note: shown(a.note ?? null), recorded_at: isoAt(a.recorded_at) }));
  const studentIds = [...new Set([...enrollments.map(e => e.student_id), ...marks.map(m => m.student_id), ...attendance.map(a => a.student_id)])];
  const studentRows = studentIds.length ? await sql`select id::text id, name, school, grade, english_name from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [];
  const attendanceWritable = canWriteLevel(viewer.levels.attendance) && (viewer.systemRole !== 'teacher' || R.isWithinAttendanceEditWindow(date, today));
  const teachingSet = attendanceWritable && viewer.levels.attendance === 'scoped' ? await teachingClassIds(sql, t, R, env, viewer.id, date) : null;
  const periodsConfig = R.settingsToPeriodsConfig(env.operations);
  return { ok: true, data: { ...empty, periods: R.assembleSeatPeriods({ date, dow, slots, enrollments, marksRaw: marks, attendanceRaw: attendance, studentRows, canWriteEcs: empty.canWriteEcs,
    attendanceWritable, teachingSet, periodTables: { weekday: R.tableToEntries(R.weekdayTableFor('english', periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) }, weekend: R.isWeekendDow(dow) }) } };
}
