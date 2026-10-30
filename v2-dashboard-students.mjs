// 2.0 운영실 영역(1단계 · 원생) — 재원생 · 강좌수 · 퇴원&수업종료 · 등록 후 3개월 내 퇴원 · 신규문의 · 전일/이달 신규.
// 강사별 업무 집계는 직원 평가의 업무 현황 면으로 옮긴 뒤에도 호환 함수로 둔다.
// 2.0 server.ts의 영역 함수(students · courses · monthWithdrawals · monthEarlyExits · getIntakeOnDay · getEnrolledRecent · loadTeacherWork + withStaffTasks)를
// 같은 표·같은 조건의 SQL(지점 조건 `tenant_id`)과 2.0 순수 함수(importV2)로. 영역 값 모양 = 2.0 `OverviewData[영역]`.
// 운영실 조립(v2-dashboard-overview.mjs)이 영역마다 저장점 하나 안에서 `(ctx, sp)`로 부른다. 강사 스코프는 없다(보는 사람 = 원장).
import { queryGate } from './v2-onescreen-roster.mjs';
import { loadTeacherWork } from './v2-teacher-work.mjs';
import { paidTuition } from './v2-withdrawal-paid.mjs';

const MODULES = { comp: 'features/students/enrollment/enrolled-composition.ts', scomp: 'features/dashboard/overview/student-composition.ts',
  course: 'features/students/enrollment/course-count.ts', model: 'features/dashboard/overview/model.ts', win: 'features/withdrawals/window.ts',
  bulk: 'features/withdrawals/system-bulk.ts', merged: 'features/students/status/merged.ts', ended: 'features/withdrawals/subject-ended.ts',
  exitMonth: 'features/withdrawals/exit-month.ts',
  special: 'features/classes/special-lecture.ts', exits: 'features/dashboard/overview/monthly-exits.ts', early: 'features/withdrawals/early-exit.ts',
  types: 'features/withdrawals/types.ts', school: 'lib/format/school-grade.ts', kst: 'lib/date-kst.ts', bounds: 'features/enrollment/kst-bounds.ts',
  outcome: 'features/dashboard/overview/enrolled-outcome.ts', recent: 'features/dashboard/overview/enrolled-recent.ts', consult: 'features/enrollment/consult-subject.ts',
  subjects: 'features/owner/subjects.ts', tasks: 'features/staff-tasks/access.ts' };
let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 영역끼리 같은 재료는 한 번만(2.0도 한 번 읽어 나눠 쓴다) — 성공한 값만 기억한다(실패하면 다음 영역이 자기 저장점에서 다시 읽는다). */
async function shared(ctx, key, fn) {
  if (!ctx.memo.has(key)) ctx.memo.set(key, await fn());
  return ctx.memo.get(key);
}
const schoolGrade = (R, school, grade) => R.school.schoolGradeLabel(school, grade) || null;

// ── 재원생 · 강좌수 ────────────────────────────────────────────────────────────────────────────────────────────────────
/** PostgREST 줄 모양(`class`·`student` 객체) — 2.0 ActiveEnrollmentRow. */
const activeRow = (r) => ({ id: r.id, student_id: r.student_id, class_id: r.class_id, start_date: r.start_date, end_date: r.end_date ?? null, is_transferred: r.is_transferred ?? null,
  class: { subject: r.subject, english_track: r.english_track }, student: { status: 'enrolled' } });
/** 2.0 loadEnrolledRows — fetchEnrolledStudents(재원생 명단) + fetchActiveEnrolledEnrollments(종료일 없음 · 휴원 아님 · 반 필수 · 학생 재원). */
function enrolledRows(ctx, gate) {
  return shared(ctx, 'enrolledRows', async () => {
    const [students, rows] = await Promise.all([
      gate`select id::text id, grade, school from public.students where tenant_id=${ctx.t} and status = 'enrolled' order by id`,
      gate`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, c.subject, c.english_track
        from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${ctx.t} join public.students s on s.id = e.student_id and s.tenant_id = ${ctx.t}
        where e.tenant_id=${ctx.t} and e.end_date is null and e.on_hold = false and s.status = 'enrolled' order by e.id`]);
    return [students.map((s) => ({ ...s })), rows.map(activeRow)];
  });
}
/** 2.0 students() — 학원 전체 값(과목 관리자 값은 옮기지 않았다). 카드 숫자 = 재원 count − 아직 한 과목도 시작 안 한 학생. */
async function students(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, subjects = ctx.settings.operations.subjects;
  const [studentRows, rows] = await enrolledRows(ctx, gate);
  const notStarted = [...R.comp.notYetStartedStudentIds(rows, today)];
  const [{ n: enrolled }] = await gate`select count(*)::int n from public.students where tenant_id=${ctx.t} and status = 'enrolled' and id <> all(${notStarted}::uuid[])`;
  const composition = R.comp.composeEnrolled({ students: studentRows, rows, scope: null, subjects, today });
  const counts = R.comp.enrolledSubjectCounts(rows, null, today);
  const visible = composition.students;
  const programs = R.comp.summarizePrograms(visible.map((r) => r.id), composition.programs, composition.active);
  return {
    enrolled,
    subjects: Object.entries(counts.bySubject).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    levels: R.model.distribution(visible.map((r) => R.comp.schoolLevelLabel(r.grade))),
    schools: R.model.distribution(visible.map((r) => r.school)),
    schoolGroups: R.scomp.schoolsByLevel(visible, composition.programs, composition.active),
    concurrent: programs.both,
    subjectCombinations: counts.combinations,
    subjectStudents: counts.students,
    programs,
    gradeSplit: R.comp.gradeSplit(visible, composition.programs, ctx.settings.operations.gradeLevels),
    levelSplit: R.scomp.levelSubjectSplit(visible, composition.programs),
  };
}
/** 2.0 courses() — 같은 활성 수강 + 종료일이 오늘 이후로 적힌 수강(fetchEndingEnrolledEnrollments) · 학생·과목마다 한 번. */
async function courses(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp);
  const [[, open], ending] = await Promise.all([enrolledRows(ctx, gate),
    gate`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, c.subject, c.english_track
      from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${ctx.t} join public.students s on s.id = e.student_id and s.tenant_id = ${ctx.t}
      where e.tenant_id=${ctx.t} and e.end_date >= ${ctx.today} and e.on_hold = false and s.status = 'enrolled' order by e.id`]);
  return R.course.summarizeCourses({ rows: [...open, ...ending.map(activeRow)], scope: null, subjects: ctx.settings.operations.subjects, today: ctx.today });
}

// ── 퇴원&수업종료 · 등록 후 3개월 내 퇴원 ─────────────────────────────────────────────────────────────────────────────
const lastClassOf = (row) => ({ className: row?.class?.class_name ?? null, subject: row?.class?.subject ?? null, englishTrack: row?.class?.english_track ?? null, reason: row?.withdrawal_reason ?? null });
/** 2.0 exitReasonOf — 메타데이터 사유(표기 흔들림 흡수), 없으면 마지막 종료 수강의 사유 원문 · 메모는 메타데이터에만. */
function exitReasonOf(R, raw, lastReason) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return { reason: R.types.normalizeReason(typeof m.reason === 'string' ? m.reason : null) ?? lastReason, memo: typeof m.memo === 'string' && m.memo.trim() ? m.memo.trim() : null };
}
/** 2.0 getWithdrawalsInWindow(이번 달 포함 6개월 첫날 ~ 오늘) — 퇴원 KPI·추이·3개월 내 퇴원이 같은 행을 나눠 쓴다(월별 증감 v2-dashboard-trends.mjs도). */
export function withdrawalRows(ctx, gate) {
  return shared(ctx, 'withdrawalRows', async () => {
    const R = await rules(ctx.importV2), from = `${R.model.monthKeys(ctx.today)[0]}-01`, to = ctx.today;
    const students = (await gate`select id::text id, name, school, grade, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, notes, withdrawal_metadata from public.students
      where tenant_id=${ctx.t} and status = 'withdrawn' and withdrawn_at >= ${from} and withdrawn_at <= ${to} order by withdrawn_at desc, id`).filter((s) => !R.merged.isMergedStudent(s.notes));
    if (!students.length) return [];
    const [endedRows, paid] = await Promise.all([gate`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred,
        e.withdrawal_reason, c.class_name, c.subject, c.english_track
      from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${ctx.t}
      where e.tenant_id=${ctx.t} and e.student_id = any(${students.map((s) => s.id)}::uuid[]) and e.end_date is not null order by e.id`,
      paidTuition(gate, ctx.t, students.map(s => s.id), to)]);
    const ended = endedRows.map((e) => ({ ...e, class: { class_name: e.class_name, subject: e.subject, english_track: e.english_track } }));
    const last = R.win.lastEndedByStudent(ended), byStudent = new Map();
    for (const row of ended) byStudent.set(row.student_id, [...(byStudent.get(row.student_id) ?? []), row]);
    return students.flatMap((s) => {
      const row = last.get(s.id);
      if (R.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: !!row })) return [];
      const klass = lastClassOf(row), history = byStudent.get(s.id) ?? [];
      const exitClasses = R.win.withdrawalSubjects(history.map((e) => ({ endDate: e.end_date, subject: lastClassOf(e).subject }))).map((subject) => {
        const rows = history.filter((e) => lastClassOf(e).subject === subject);
        const lastSubject = lastClassOf(R.win.pickLastEnded(rows) ?? undefined);
        return { subject, englishTrack: lastSubject.englishTrack, className: lastSubject.className, endedTogether: R.win.endedTogether(rows).map((e) => ({
          enrollmentId: e.id, classId: e.class_id, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true })) };
      });
      const systemBulk = R.bulk.isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: !!row });
      const exitDate = R.exitMonth.exitCountDate(s.withdrawn_at, R.exitMonth.paidTuitionMonths(paid.get(s.id) ?? []));
      if (!R.win.inWithdrawalWindow({ withdrawnAt: exitDate, systemBulk }, from, to)) return [];
      return [{ id: s.id, name: s.name, school: s.school, grade: s.grade, enrolledAt: s.enrolled_at ? s.enrolled_at.slice(0, 10) : null, withdrawnAt: (s.withdrawn_at ?? '').slice(0, 10), exitDate,
        lastClassName: klass.className, lastClassSubject: klass.subject, lastClassEnglishTrack: klass.englishTrack, exitClasses,
        ...exitReasonOf(R, s.withdrawal_metadata, klass.reason), cleanup: R.bulk.isCleanupExit(s.withdrawal_metadata) }];
    });
  });
}
/** 2.0 getSubjectEndedStudents() — 재원·휴원 학생이 그날 기준 한 과목 수강을 모두 끝낸 과목(운영실 칸이 쓰는 값만). */
async function subjectEndedStudents(ctx, gate) {
  const R = await rules(ctx.importV2), today = ctx.today;
  const [students, enrollments] = await Promise.all([
    gate`select id::text id, name, school, grade, status::text status from public.students where tenant_id=${ctx.t} and status in ('enrolled', 'on_hold') order by id`,
    gate`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.withdrawal_reason,
        c.subject, c.class_name, c.english_track, c.is_special
      from public.enrollments e join public.students s on s.id = e.student_id and s.tenant_id = ${ctx.t} and s.status in ('enrolled', 'on_hold')
      left join public.classes c on c.id = e.class_id and c.tenant_id = ${ctx.t} where e.tenant_id=${ctx.t} order by e.id`]);
  const bySt = new Map();
  for (const e of enrollments) {
    if (!e.subject) continue;
    bySt.set(e.student_id, [...(bySt.get(e.student_id) ?? []), { id: e.id, classId: e.class_id, subject: e.subject, startDate: e.start_date, endDate: e.end_date,
      isTransferred: e.is_transferred ?? undefined, isSpecial: R.special.isSpecialLecture({ isSpecial: e.is_special, className: e.class_name }),
      className: e.class_name ?? null, englishTrack: e.english_track ?? null, reason: e.withdrawal_reason ?? null }]);
  }
  const out = students.flatMap((s) => {
    const all = bySt.get(s.id) ?? [], enr = all.filter((e) => R.ended.countsForSubjectExit(e, today));
    const lastEndOf = (subject) => all.reduce((m, e) => (e.subject === subject && e.endDate && (!m || e.endDate > m) ? e.endDate : m), null);
    const { ended } = R.ended.getEndedSubjects(enr, today);
    if (!ended.length) return [];
    return [{ id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status, endedDetail: ended.map((subject) => {
      const best = R.win.pickLastEnded(enr.filter((e) => e.subject === subject).map((e) => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred })));
      const subjectRows = enr.filter(e => e.subject === subject).map(e => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred }));
      const endedAt = lastEndOf(subject) ?? best?.endDate ?? null;
      return { subject, endedAt, countAt: endedAt,
        runStart: R.exitMonth.subjectRunStart(all.filter(e => e.subject === subject), best?.startDate ?? null),
        endedTogether: R.win.endedTogether(subjectRows).map(e => ({ enrollmentId: e.id, classId: e.classId, startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred === true })),
        className: best?.className ?? null, englishTrack: best?.englishTrack ?? null, isTransferred: best?.isTransferred === true };
    }) }];
  });
  const paid = await paidTuition(gate, ctx.t, out.map(s => s.id), out.reduce((m, s) => s.endedDetail.reduce((d, e) => e.endedAt > d ? e.endedAt : d, m), ''));
  for (const s of out) {
    const bySubject = R.exitMonth.paidSubjectMonths(paid.get(s.id) ?? [], ctx.settings.operations.subjects);
    for (const d of s.endedDetail) if (d.endedAt) d.countAt = R.exitMonth.subjectExitCountDate(d.endedAt, d.subject, bySubject, ctx.settings.operations.subjects, d.runStart);
  }
  return out;
}
/** 2.0 monthWithdrawals — 이번 달 1일 ~ min(말일, 오늘)의 퇴원(과목마다 한 줄) + 과목 전체 종료. */
async function withdrawals(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, month = today.slice(0, 7), subjects = ctx.settings.operations.subjects;
  const win = R.win.withdrawalMonthWindow(month, today);
  const [rows, ended] = [await withdrawalRows(ctx, gate), await subjectEndedStudents(ctx, gate)];
  return {
    month,
    rows: R.exits.includeSubjectEnds(rows.filter((row) => R.win.inWithdrawalWindow({ withdrawnAt: row.exitDate, systemBulk: false }, win.from, win.to))
      .flatMap((row) => (row.exitClasses.length ? row.exitClasses : [{ subject: row.lastClassSubject, englishTrack: row.lastClassEnglishTrack, className: row.lastClassName }]).map((klass) => ({
        id: row.id, eventKey: `${row.id}|${klass.subject ?? 'unknown'}`, name: row.name, schoolGrade: schoolGrade(R, row.school, row.grade), withdrawnAt: row.withdrawnAt,
        className: klass.className ?? undefined, subject: klass.subject,
        program: R.win.withdrawalProgram({ lastClassSubject: klass.subject, lastClassEnglishTrack: klass.englishTrack }, subjects) }))),
    ended, win, subjects, (school, grade) => schoolGrade(R, school, grade)),
  };
}
/** 2.0 monthEarlyExits — 이번 달 퇴원 전부에 등록 후 일수 · 지난 달들은 이름 없이(추세선과 같이 단체 장부 정리 제외). */
async function earlyExits(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, month = today.slice(0, 7), months = R.model.monthKeys(today);
  const win = R.win.withdrawalMonthWindow(month, today), rows = await withdrawalRows(ctx, gate);
  const subjectsOf = (row) => (row.exitClasses.length ? row.exitClasses.map((c) => c.subject) : row.lastClassSubject ? [row.lastClassSubject] : []);
  const inMonth = (row) => R.win.inWithdrawalWindow({ withdrawnAt: row.exitDate, systemBulk: false }, win.from, win.to);
  return {
    month, months,
    rows: rows.filter(inMonth).map((row) => ({ id: row.id, name: row.name, schoolGrade: schoolGrade(R, row.school, row.grade), enrolledAt: row.enrolledAt,
      withdrawnAt: row.withdrawnAt, days: R.early.tenureDays(row.enrolledAt, row.withdrawnAt), subjects: subjectsOf(row) })),
    history: rows.filter((row) => !row.cleanup && row.exitDate < win.from && months.includes(row.exitDate.slice(0, 7)))
      .map((row) => ({ month: row.exitDate.slice(0, 7), days: R.early.tenureDays(row.enrolledAt, row.withdrawnAt), subjects: subjectsOf(row) })),
  };
}

// ── 신규문의 · 전일/이달 신규 ─────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getIntakeOnDay(오늘) — 그날(KST) 행이 생긴 콜&상담 · 최근 접수부터. */
async function intake(ctx, sp) {
  const R = await rules(ctx.importV2), { startIso, endIso } = R.bounds.kstDayBounds(ctx.today);
  const rows = await sp`select id::text id, prospect_name, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
    where tenant_id=${ctx.t} and created_at >= ${startIso} and created_at < ${endIso} order by created_at desc, id`;
  return rows.map((r) => ({ id: r.id, name: r.prospect_name?.trim() || '(이름 미상)', time: R.kst.kstTimeOf(r.created_at) }));
}
/** 2.0 listAssignedClassNames — 상담 과목 기준 배정 반(칸반 '반 배정 완료'와 같은 필터 · 같은 반 한 번 · 이름 순). */
async function assignedClassNames(R, gate, ctx, studentId, subject) {
  if (!studentId) return [];
  const keys = subject?.trim() ? R.consult.consultClassKeys(subject, ctx.settings.operations.subjects) : null;
  if (keys?.length === 0) return [];
  const rows = await gate`select c.class_name, c.subject from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${ctx.t}
    where e.tenant_id=${ctx.t} and e.student_id=${studentId} and (e.end_date is null or e.end_date >= ${ctx.today}) ${keys ? gate.frag`and c.subject = any(${[...keys]})` : gate.frag``}`;
  const seen = new Map();
  for (const k of rows) seen.set(`${k.subject ?? ''}|${k.class_name}`, { name: k.class_name, subject: k.subject ?? null });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
/** 2.0 getEnrolledRecent(오늘) — 전일 첫날(월요일엔 토요일)과 이번 달 1일 중 이른 날 ~ 오늘 끝에 '등록 완료'가 된 상담(상태 로그 · 반 배정). */
async function enrolledToday(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, t = ctx.t;
  const { startIso } = R.bounds.kstDayBounds(R.recent.enrolledRecentFrom(today)), { endIso } = R.bounds.kstDayBounds(today);
  const cols = gate.frag`id::text id, prospect_name, prospect_school, prospect_grade, subject, student_id::text student_id, outcome::text outcome`;
  const logs = await gate`select metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs where tenant_id=${t} and action = 'enrollment_consultation_outcome'
    and metadata->>'to' = 'enrolled' and created_at >= ${startIso} and created_at < ${endIso} order by created_at, id`;
  const movedAt = R.outcome.enrollmentEventTimes(logs);
  // 반 배정으로 '등록 완료' 칸에 선 상담(상태는 등록 완료가 아니다) — 창 안 반 배정 학생의 상담 + 창 안에 들어온 상담.
  const [moved, assignedInWindow, consultsInWindow] = await Promise.all([
    movedAt.size ? gate`select ${cols} from public.enrollment_consultations where tenant_id=${t} and id = any(${[...movedAt.keys()]}::uuid[])` : [],
    gate`select distinct student_id::text student_id from public.enrollments where tenant_id=${t} and created_at >= ${startIso} and created_at < ${endIso}`,
    gate`select ${cols}, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations where tenant_id=${t} and outcome::text <> 'enrolled'
      and student_id is not null and created_at >= ${startIso} and created_at < ${endIso} order by id`]);
  const ofStudents = assignedInWindow.length ? await gate`select ${cols}, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
    where tenant_id=${t} and outcome::text <> 'enrolled' and student_id = any(${assignedInWindow.map((r) => r.student_id)}::uuid[])` : [];
  const consults = new Map([...consultsInWindow, ...ofStudents].map((c) => [c.id, c]));
  const studentIds = [...new Set([...consults.values()].map((c) => c.student_id))];
  const enr = studentIds.length ? await gate`select e.student_id::text student_id, to_json(e.created_at)#>>'{}' created_at, e.end_date::text end_date, c.subject
    from public.enrollments e join public.classes c on c.id = e.class_id and c.tenant_id = ${t} where e.tenant_id=${t} and e.student_id = any(${studentIds}::uuid[]) order by e.id` : [];
  const byStudent = new Map();
  for (const e of enr) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), { subject: e.subject ?? null, createdAt: e.created_at, endDate: e.end_date }]);
  const classKeysOf = R.consult.consultClassKeysOf(ctx.settings.operations.subjects), lo = Date.parse(startIso), hi = Date.parse(endIso);
  const viaAssignment = [...consults.values()].flatMap((c) => {
    const at = R.recent.assignedEntryAt({ consultCreatedAt: c.created_at, classKeys: classKeysOf(c.subject), enrollments: byStudent.get(c.student_id) ?? [], today });
    return at && Date.parse(at) >= lo && Date.parse(at) < hi ? [{ row: c, at, viaAssignment: true }] : [];
  });
  const items = [...moved.filter((row) => row.outcome === 'enrolled').map((row) => ({ row, at: movedAt.get(row.id) ?? '', viaAssignment: false })), ...viaAssignment];
  const { labelOf } = R.subjects.buildSubjectMaps(ctx.settings.operations.subjects);
  const classes = [];
  for (const { row } of items) classes.push(await assignedClassNames(R, gate, ctx, row.student_id, row.subject || null));
  return items.map((item, i) => ({ ...item, classes: classes[i] }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.row.id.localeCompare(b.row.id))
    .map(({ row, at, viaAssignment: via, classes: list }) => ({ id: row.id, name: row.prospect_name?.trim() || '(이름 미상)',
      schoolGrade: schoolGrade(R, row.prospect_school, row.prospect_grade), date: R.kst.kstDateOf(at), time: R.kst.kstTimeOf(at),
      assigned: via || list.length > 0, classes: list.map((c) => ({ name: c.name, subject: c.subject ? labelOf(c.subject) : null })), subject: row.subject || null }));
}

// ── 강사별 업무 현황 ──────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 loadTeacherWork + withStaffTasks — 열린 할 일은 업무 처리 현황을 볼 수 있는 사람에게만(원장은 늘 본다) · '늦음' = 복사본을 뜬 순간 기준. */
async function teacherWork(ctx, sp) {
  const R = await rules(ctx.importV2);
  const work = await loadTeacherWork({ sql: sp, tenantId: ctx.t, today: ctx.today, scope: null, settings: ctx.settings, importV2: ctx.importV2 });
  const canMonitor = R.tasks.canMonitorStaffTasks({ id: ctx.user.id, systemRole: ctx.user.role },
    { isSuperAdmin: ctx.user.super, monitorIds: ctx.settings.permissions.specialAccess.staffTaskMonitorIds });
  if (!canMonitor) return work;
  // 2.0은 할 일 수를 못 읽으면 카드만 그대로 둔다(reportError) — 같은 저장점 안에서 실패를 가둔다.
  const gate = queryGate(sp), at = ctx.clock.at;
  const tasks = await gate.soft(async (s) => {
    const [byUser, [{ open, late }]] = await Promise.all([
      s`select a.user_id::text user_id, count(*)::int open_count, (count(*) filter (where t.due_at < ${at}))::int late_count from public.staff_tasks t
        join public.staff_task_assignees a on a.task_id = t.id where t.tenant_id=${ctx.t} and t.status = 'open' group by a.user_id`,
      s`select count(*)::int open, (count(*) filter (where due_at < ${at}))::int late from public.staff_tasks where tenant_id=${ctx.t} and status = 'open'`]);
    return { byUser: Object.fromEntries(byUser.map((r) => [r.user_id, { open: r.open_count, late: r.late_count }])), open, late };
  }, null);
  return tasks ? { ...work, tasks } : work;
}

/** 이 단계에서 옮긴 영역(2.0 `Area` 키). */
export const STUDENT_AREAS = { students, courses, withdrawals, earlyExits, intake, enrolledToday, teacherWork };
