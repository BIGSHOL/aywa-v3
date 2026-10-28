// 2.0 화면 · 강사 시트(ECS) — '+ 보강 학생 추가'(EcsMakeupAdder → MakeupAddFlow)가 부르는 2.0 서버 액션 셋.
// 칸을 여는 저장은 setAttendanceCell({ status:'makeup', allowMakeup:true, units, slotStart })(v2-ecs-save.mjs)이고, 여기는 그 앞뒤:
//   attendance/server/actions.ts           searchMakeupStudents(classId, query, onDate)        학생 찾기(퇴원 제외 20명) — 읽기만
//   attendance/server/makeup-actions.ts    fetchMakeupAbsences(studentId, makeupDate, anchor)  결석 후보(최근 1년 · 그 반 과목) — 읽기만
//   attendance/server/makeup-note-action.ts noteMakeupAgainstAbsence(input)                    보강 칸·결석 칸 메모 한 줄씩(시수 안 건드림) · attendance_makeup_link
// 판정·문구·메모 줄은 2.0 순수 함수(makeup-options.ts · makeup-absence-link.ts · effective-records.ts · school-grade.ts)를 importV2로 그대로 쓴다.
// 서버 전용 파일(absence-cell.ts `server-only`)에 있는 pickAbsenceNoteTarget만 원문 그대로 옮겼다(verify가 원문과 비교한다).
// 2.0과 다른 것(이유): '강사뷰' 판정(보강 기한 · 강사 과목 폴백) = 고른 사람이 선생님 역할인가(3.0엔 겸직 강사뷰 쿠키가 없다 — 보기 전체와 같은 규약).
// validate·run은 화면 상태에 기대지 않는다 — 출석부·원스크린 화면이 같은 이름으로 이어 쓸 수 있다.
import { DAY, UUID, canWriteLevel, isoAt } from './v2-ecs-core.mjs';
import { MODULE, audit, obj, serverFn, str, teachesOn } from './v2-ecs-save.mjs';

const MAKEUP_MODULE = { absences: 'features/attendance/server/makeup-actions.ts', note: 'features/attendance/server/makeup-note-action.ts' };
let rulesPromise = null, linkSync = null;
/** 보강 전용 2.0 순수 모듈 — 공용 R(v2-ecs-core MODULES)과 섞지 않고 따로 싣는다. */
export const makeupRules = importV2 => (rulesPromise ??= Promise.all(['features/attendance/makeup-options.ts', 'features/onescreen/makeup-absence-link.ts', 'lib/format/school-grade.ts', 'features/owner/subjects.ts']
  .map(p => importV2(p))).then(([options, link, school, subjects]) => { linkSync = link; return { ...options, ...link, schoolGradeLabel: school.schoolGradeLabel, buildSubjectMaps: subjects.buildSubjectMaps }; })
  .catch(error => { rulesPromise = null; throw error; }));
/** 2.0 makeup-absence-link.ts hasMemoLine 그대로(불러온 것) — 아래 옮긴 본문이 원문과 같은 이름으로 부른다. */
const hasMemoLine = (existing, line) => linkSync.hasMemoLine(existing, line);

// ── PORTED: features/attendance/server/absence-cell.ts(server-only라 불러올 수 없다) — 원문 그대로 ──
const MADE_UP_RE = /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/;
export function pickAbsenceNoteTarget(rows, memo) {
  return (
    rows.find((r) => hasMemoLine(r.note, memo)) ??
    rows.find((r) => !MADE_UP_RE.test(r.note ?? "")) ??
    rows[0] ??
    null
  );
}
// ── PORTED 끝 ──

const WINDOW_DAYS = 365, MAX_ROWS = 1000, EMPTY = () => ({ options: [], hiddenBySubject: 0 });
/** 2.0 getMakeupAbsenceOptions — 결석·공결 기록(정정 이력 그대로, 2.0과 같다) · 지금 수강 반 · 앵커 반 과목 · 과목 라벨. */
async function makeupAbsenceOptions(sql, t, R, M, env, studentId, makeupDate, anchorClassId, teacherSubjects, deadline) {
  if (!UUID.test(str(studentId)) || !DAY.test(str(makeupDate))) return EMPTY();
  const from = R.addDays(makeupDate, -WINDOW_DAYS), anchor = UUID.test(str(anchorClassId)) ? anchorClassId : null;
  const [rows, enrolls, [anchorRow]] = await Promise.all([
    sql`select a.class_id::text class_id, a.session_date::text session_date, a.note, a.slot_start::text slot_start, c.class_name, c.subject
      from public.attendance_records a left join public.classes c on c.id = a.class_id
      where a.tenant_id=${t} and a.student_id=${studentId} and a.status::text in ('absent', 'excused') and a.session_date >= ${from} and a.session_date <= ${makeupDate}
      order by a.session_date desc limit ${MAX_ROWS}`,
    sql`select class_id::text class_id from public.enrollments where tenant_id=${t} and student_id=${studentId} and end_date is null`,
    anchor ? sql`select subject from public.classes where tenant_id=${t} and id=${anchor}` : [],
  ]);
  const anchorSubject = anchorRow?.subject ?? null;
  const raw = rows.map(r => ({ classId: r.class_id, className: r.class_name ?? null, subject: r.subject ?? null, date: r.session_date, note: r.note ?? null, slotStart: r.slot_start ?? null }));
  const list = M.buildAbsenceOptions(raw, makeupDate, new Set(enrolls.map(e => e.class_id)), anchorSubject, teacherSubjects, { deadline });
  const labelKey = anchorSubject ?? ((teacherSubjects ?? []).length === 1 ? teacherSubjects[0] : null);
  const label = labelKey ? M.buildSubjectMaps(env.operations.subjects).labelOf(labelKey) : null;
  return { ...list, ...(label && label !== labelKey ? { subjectLabel: label } : {}) };
}

export const MAKEUP_ACTIONS = {
  /** searchMakeupStudents(classId, query, onDate) — 2.0 반환 = 학생 배열(권한·담당 반이 아니면 빈 배열). */
  searchMakeupStudents: serverFn(MODULE.attendance, 3, async ({ sql, t, R, env, importV2, user, today }, classId, query, onDate) => {
    if (!canWriteLevel(user.levels.attendance)) return [];
    const q = String(query ?? '').trim().replace(/[,()]/g, ' ').trim();
    if (!q || !classId) return [];
    const when = typeof onDate === 'string' && DAY.test(onDate) ? onDate : today;
    if (user.levels.attendance === 'scoped' && !(UUID.test(str(classId)) && await teachesOn(sql, t, user.id, classId, when, { R, env }))) return [];
    const M = await makeupRules(importV2), like = `%${q}%`;
    const rows = await sql`select id::text id, name, english_name, grade, school from public.students
      where tenant_id=${t} and status::text <> 'withdrawn' and (name ilike ${like} or english_name ilike ${like}) order by name limit 20`;
    return rows.map(s => ({ id: s.id, name: s.name, englishName: s.english_name ?? null, school: s.school ?? null, grade: s.grade ?? null, label: M.schoolGradeLabel(s.school ?? null, s.grade ?? null) }));
  }),
  /** fetchMakeupAbsences(studentId, makeupDate, anchorClassId) — 2.0 반환 = MakeupAbsenceList(권한이 없으면 빈 목록). */
  fetchMakeupAbsences: serverFn(MAKEUP_MODULE.absences, 3, async ({ sql, t, R, env, importV2, user }, studentId, makeupDate, anchorClassId) => {
    if (!canWriteLevel(user.levels.attendance)) return EMPTY();
    const M = await makeupRules(importV2), teacher = user.systemRole === 'teacher';
    // 앵커가 없을 때만 강사 과목(그 사람이 담임인 반의 과목 — 2.0 getTeacherScope.subjects)으로 좁힌다.
    const teacherSubjects = anchorClassId || !teacher ? null
      : [...new Set((await sql`select subject from public.classes where tenant_id=${t} and teacher_id=${user.id}`).map(r => r.subject).filter(Boolean))];
    return makeupAbsenceOptions(sql, t, R, M, env, studentId, makeupDate, anchorClassId ?? null, teacherSubjects, teacher);
  }),
  /** noteMakeupAgainstAbsence(input) — 2.0 반환 = { ok, absenceNoted, alreadyLinked } | { error }. */
  noteMakeupAgainstAbsence: serverFn(MAKEUP_MODULE.note, 1, async ({ sql, t, R, env, importV2, user, today }, raw) => {
    if (!canWriteLevel(user.levels.attendance)) return { error: '출석 관리 권한이 없습니다' };
    const { studentId, makeupClassId, makeupDate, absentClassId, absentDate } = obj(raw);
    if (!studentId || !makeupClassId || !absentClassId) return { error: '필수 값이 누락되었습니다' };
    if (!DAY.test(str(makeupDate)) || !DAY.test(str(absentDate))) return { error: '잘못된 날짜입니다' };
    if (absentDate === makeupDate) return { error: '결석한 날과 보강한 날이 같습니다' };
    if (![studentId, makeupClassId, absentClassId].every(v => UUID.test(str(v)))) return { error: '필수 값이 누락되었습니다' };
    const M = await makeupRules(importV2);
    // 보강 기한(결석한 달의 다음 달 말일) — 강사뷰만(2.0 makeupDeadlineError).
    if (!M.isWithinMakeupDeadline(absentDate, makeupDate) && user.systemRole === 'teacher') return { error: M.makeupDeadlineMessage(absentDate) };
    if (user.levels.attendance === 'scoped') {
      if (!R.isWithinAttendanceEditWindow(makeupDate, today)) return { error: R.attendanceLockMessage(makeupDate, today) };
      if (!(await teachesOn(sql, t, user.id, makeupClassId, makeupDate, { R, env }))) {
        // 대신 보강 — 그 학생이 그날 다니는(휴원·반이동 당일 제외) 운영 중인 반이면 받는다(2.0 loadMakeupAnchorCandidates · enrolled).
        const enr = await sql`select e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.on_hold from public.enrollments e join public.classes c on c.id=e.class_id
          where e.tenant_id=${t} and e.student_id=${studentId} and e.class_id=${makeupClassId} and c.is_active`;
        if (!enr.some(e => !e.on_hold && (!e.start_date || e.start_date <= makeupDate) && !R.isEnrollmentEndedOn(e.end_date ?? null, makeupDate, !!e.is_transferred))) return { error: '담당 반이 아닙니다' };
      }
    }
    const [[makeupCell], absentAll] = await Promise.all([
      sql`select id::text id, status::text status, note from public.attendance_records where tenant_id=${t} and class_id=${makeupClassId} and student_id=${studentId} and session_date=${makeupDate} order by recorded_at desc limit 1`,
      sql`select id::text id, note, status::text status, slot_start::text slot_start, recorded_at, student_id::text student_id, class_id::text class_id, session_date::text session_date
        from public.attendance_records where tenant_id=${t} and class_id=${absentClassId} and student_id=${studentId} and session_date=${absentDate}`,
    ]);
    // 2.0 fetchAbsenceCells — 정정 이력을 접은 뒤 결석·공결만, 최근 기록 먼저.
    const live = R.effectiveAttendanceRecords(absentAll.map(r => ({ ...r, recorded_at: isoAt(r.recorded_at) })));
    const absentRows = live.filter(r => r.status === 'absent' || r.status === 'excused')
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id.localeCompare(a.id))).map(r => ({ id: r.id, note: r.note ?? null }));
    const memoOnMakeup = M.makeupMemo(absentDate, makeupDate), alreadyLinked = M.hasMemoLine(makeupCell?.note, memoOnMakeup);
    const memoOnAbsence = M.absenceMemo(makeupDate, absentDate), absentTarget = pickAbsenceNoteTarget(absentRows, memoOnAbsence);
    let writes = 0;
    if (absentTarget && !M.hasMemoLine(absentTarget.note, memoOnAbsence)) { await sql`update public.attendance_records set note=${M.appendMemo(absentTarget.note, memoOnAbsence)} where tenant_id=${t} and id=${absentTarget.id}`; writes++; }
    if (makeupCell?.id && !alreadyLinked) { await sql`update public.attendance_records set note=${M.appendMemo(makeupCell.note, memoOnMakeup)} where tenant_id=${t} and id=${makeupCell.id}`; writes++; }
    if (writes > 0) await audit(sql, t, user, 'attendance_makeup_link', 'attendance', null, { studentId, classId: makeupClassId, ...(absentClassId !== makeupClassId ? { absentClassId } : {}),
      absentDate, makeupDate, memoOnly: true, absenceNoted: !!absentTarget, ...(alreadyLinked ? { alreadyLinked: true } : {}) });
    return { ok: true, absenceNoted: !!absentTarget, alreadyLinked };
  }),
};
