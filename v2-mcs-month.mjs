// 2.0 화면 — 강사 시트 · 수학 반 월간(/mcs/<반>/month) 조회. 2.0 page.tsx가 서버에서 부르던 함수들을 Docker 복사본에서 같은 결과로:
//  getMathSheetMonth(month-queries.ts — 학생 × 수업일 칸 · 기록 · 진도 레일 · 수강 표식) · getMathClassOptions · getMathLearningData(learning-queries.ts) ·
//  canResetMathLearningGoals · 교재(getMathClassTextbooks · getMathBookTargets · getRecentReportsAllClasses · getSchoolExamPeriods) ·
//  그리고 page.tsx가 서버에서 하던 가공(학생별 교재 3개월 창 · 계획 = buildStudentBookPlans)까지. 판정·조립은 2.0 순수 함수(importV2) 그대로.
// 게이트 = 2.0 requireMcsClassAccess(보는 사람으로 — v2-mcs-core mcsClassAccess). 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id.
import { mcsClassAccess, visibleClassFilter } from './v2-mcs-core.mjs';
import { mathClassTextbooks, mathBookTargets, recentReportsAllClasses, schoolExamPeriods, sentReport } from './v2-math-textbooks.mjs';

let monthRules = null;
export function loadMonthRules(importV2) {
  monthRules ??= (async () => {
    const [goalRail, lessonPos, goals, stall, span, curriculum, font, plan, history, classDates] = await Promise.all([
      'features/math-sheets/lib/goal-rail.ts', 'features/math-sheets/lib/lesson-position.ts', 'features/math-sheets/lib/student-goals.ts', 'features/math-sheets/lib/progress-stall.ts',
      'features/attendance/enrollment-span.ts', 'features/progress/curriculum-position.ts', 'features/math-sheets/font-size.ts', 'features/math-sheets/lib/learning-plan.ts',
      'features/math-sheets/lib/learning-history.ts', 'features/math-sheets/lib/learning-class-dates.ts',
    ].map(p => importV2(p)));
    return { goalRail, lessonPos, goals, stall, span, curriculum, font, plan, history, classDates };
  })().catch(error => { monthRules = null; throw error; });
  return monthRules;
}
/** timestamptz → PostgREST가 내던 글자(UTC ISO). */
export const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;
const PRIOR_WINDOW_DAYS = 45;

// ── server/lifecycle.ts mathLifecycleBadges — 이 달 들어온·나간·옮긴 표식(다른 반 수강까지 보고 '반 이동'을 가른다) ──────────────
async function mathLifecycleBadges(sql, t, R, M, { classId, range, spansByStudent, withdrawnByStudent }) {
  const out = new Map();
  for (const [sid, spans] of spansByStudent) { const badges = M.span.lifecycleBadgesInRange(range, spans, 'math'); if (badges.length > 0) out.set(sid, badges); }
  if (out.size === 0) return out;
  const ids = [...out.keys()], dates = [...out.values()].flat().map(b => b.date).sort();
  const from = R.dk.addDays(dates[0], -M.span.TRANSFER_GAP_DAYS), to = R.dk.addDays(dates[dates.length - 1], M.span.TRANSFER_GAP_DAYS);
  try {
    const rows = await sql.savepoint(s => s`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred,
        c.class_name, c.subject from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=${t}
      where e.tenant_id=${t} and e.class_id <> ${classId} and e.student_id = any(${ids}::uuid[]) and e.start_date <= ${to}::date and (e.end_date is null or e.end_date >= ${from}::date)`);
    const othersById = new Map();
    for (const r of rows) {
      const spans = R.roster.mathSpansOf([{ startDate: r.start_date ? r.start_date.slice(0, 10) : null, endDate: r.end_date ? r.end_date.slice(0, 10) : null, isTransferred: r.is_transferred === true }],
        withdrawnByStudent.get(r.student_id) ?? null);
      if (spans.length === 0) continue;
      (othersById.get(r.student_id) ?? othersById.set(r.student_id, []).get(r.student_id)).push({ classId: r.class_id, className: r.class_name, subject: r.subject ?? null, start: spans[0].start, end: spans[0].end });
    }
    for (const sid of ids) out.set(sid, M.span.lifecycleBadgesInRange(range, spansByStudent.get(sid) ?? [], 'math', othersById.get(sid) ?? []));
  } catch { /* 2.0도 실패하면 이 반 기준 표식만 남긴다 */ }
  return out;
}

// ── server/month-queries.ts getMathSheetMonth ───────────────────────────────────────────────────────────────────────────
export async function mathSheetMonth(sql, t, R, M, env, viewer, classId, monthRaw) {
  const gate = await mcsClassAccess(sql, t, R, viewer, classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access, today = R.dk.kstToday(), month = R.classDays.normalizeMonth(monthRaw, R.dk.kstMonth()), { from, to } = R.dk.monthRange(month);
  const [schedRows, enrRows, reportRows, attRows, prefRows, teacherRows] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id=${classId}`,
    sql`select student_id::text student_id, start_date::text start_date, end_date::text end_date, is_transferred, attendance_days from public.enrollments where tenant_id=${t} and class_id=${classId}`,
    sql`select student_id::text student_id, report_date::text report_date, textbook, progress, homework_today, daily_test, check_test, exam_info, homework_score from public.lesson_reports
      where tenant_id=${t} and class_id=${classId} and report_date between ${from}::date and ${to}::date order by report_date, id`,
    sql`select student_id::text student_id, session_date::text session_date, status::text status from public.attendance_records where tenant_id=${t} and class_id=${classId}
      and session_date between ${from}::date and ${to}::date order by id`,
    sql`select ui_prefs from public.users where tenant_id=${t} and id=${viewer.id}`,
    access.teacherId ? sql`select display_name from public.users where tenant_id=${t} and id=${access.teacherId}` : [],
  ]);
  let goalRows = [], goalsStatus = 'ok';
  try { goalRows = await sql.savepoint(s => s`select student_id::text student_id, textbook, target_progress from public.math_month_goals where tenant_id=${t} and class_id=${classId} and period_start=${from}::date`); }
  catch (e) { goalsStatus = e?.code === '42P01' || /does not exist|could not find the table/i.test(e?.message ?? '') ? 'missing-table' : 'failed'; }
  const holidays = {};
  for (const [date, name] of Object.entries(env.holidays)) if (date >= from && date <= to) holidays[date] = name;
  const schedules = schedRows.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time ?? null, validFrom: r.valid_from ? r.valid_from.slice(0, 10) : null, validTo: r.valid_to ? r.valid_to.slice(0, 10) : null }));
  const days = R.classDays.classDaysOf(month, schedules), dayDates = days.map(d => d.date), daySet = new Set(dayDates);
  const goals = {};
  for (const row of goalRows) goals[row.student_id] = { textbook: row.textbook ?? null, targetProgress: row.target_progress ?? null };
  const enrByStudent = new Map();
  for (const e of enrRows) (enrByStudent.get(e.student_id) ?? enrByStudent.set(e.student_id, []).get(e.student_id)).push({ startDate: e.start_date ? e.start_date.slice(0, 10) : null,
    endDate: e.end_date ? e.end_date.slice(0, 10) : null, isTransferred: e.is_transferred === true });
  const studentIds = [...enrByStudent.keys()];
  const [students, priorRows] = studentIds.length ? await Promise.all([
    sql`select id::text id, name, school, grade, status::text status, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`,
    sql`select student_id::text student_id, report_date::text report_date, progress from public.lesson_reports where tenant_id=${t} and class_id=${classId} and student_id = any(${studentIds}::uuid[])
      and report_date >= ${R.dk.addDays(from, -PRIOR_WINDOW_DAYS)}::date and report_date < ${from}::date order by report_date, id`,
  ]) : [[], []];
  const studentById = new Map(students.map(s => [s.id, s])), priorByStudent = new Map();
  for (const r of priorRows) (priorByStudent.get(r.student_id) ?? priorByStudent.set(r.student_id, []).get(r.student_id)).push(r);
  const attByKey = new Map();
  for (const a of attRows) { const k = `${a.student_id}|${a.session_date.slice(0, 10)}`; (attByKey.get(k) ?? attByKey.set(k, []).get(k)).push(String(a.status)); }
  const recordByKey = new Map();
  for (const r of reportRows) { const date = r.report_date.slice(0, 10); if (daySet.has(date)) recordByKey.set(`${r.student_id}|${date}`, r); }
  const anchor = R.roster.rosterAnchorOf(month, today), lessonNameOf = p => (p == null ? null : (M.curriculum.describePosition(p)?.lesson ?? null));
  const rows = [], allStates = [], spansByStudent = new Map(), withdrawnByStudent = new Map();
  for (const sid of studentIds) {
    const info = studentById.get(sid);
    if (!info) continue;
    const enrollments = enrByStudent.get(sid) ?? [], withdrawnAt = info.withdrawn_at ? info.withdrawn_at.slice(0, 10) : null;
    if (!R.roster.isOnMathRosterAnyDay(enrollments, withdrawnAt, dayDates)) continue;
    spansByStudent.set(sid, R.roster.mathSpansOf(enrollments, withdrawnAt)); withdrawnByStudent.set(sid, withdrawnAt);
    const cells = {}, records = {};
    for (const date of dayDates) {
      const rec = recordByKey.get(`${sid}|${date}`);
      const state = R.cell.cellStateOf({ enrollments, withdrawnAt, date, attendance: R.cell.foldDayAttendance(attByKey.get(`${sid}|${date}`) ?? []), hasReport: Boolean(rec), today, holiday: R.holiday.isHolidayOn(holidays, date) });
      cells[date] = state; allStates.push(state);
      if (rec) records[date] = { textbook: rec.textbook ?? null, progress: rec.progress ?? null, homework: rec.homework_today ?? null, dailyTest: rec.daily_test ?? null, checkTest: rec.check_test ?? null,
        examInfo: rec.exam_info ?? null, homeworkScore: rec.homework_score ?? null, offGoal: M.goals.isOffGoalRecord({ studentId: sid, date, textbook: rec.textbook ?? null, progress: rec.progress ?? null }, goals) };
    }
    const grade = info.grade ? String(info.grade) : null, goalEnd = M.lessonPos.goalEndOf(goals[sid]?.targetProgress, grade)?.position ?? null;
    const points = [];
    for (const date of dayDates) { const rec = records[date]; if (!rec) continue; const p = M.lessonPos.dayPositionOf(rec.progress, grade); if (p) points.push({ date, position: p.position }); }
    let prior = null;
    for (const r of priorByStudent.get(sid) ?? []) { const p = M.lessonPos.dayPositionOf(r.progress, grade); if (p) prior = { position: p.position, date: r.report_date.slice(0, 10) }; }
    let rail = null;
    if (points.length > 0 || prior != null || goalEnd != null) {
      const built = M.goalRail.buildGoalRail({ startBefore: prior?.position ?? null, goalEnd, points, dayDates, today });
      rail = { rail: built, startDate: prior?.date ?? points.find(p => p.date <= today)?.date ?? null, startLesson: lessonNameOf(built.start), nowLesson: lessonNameOf(built.now),
        nowGrade: built.now == null ? null : (M.curriculum.describePosition(built.now)?.grade ?? null), planLesson: lessonNameOf(built.plan), endLesson: lessonNameOf(built.end) };
    }
    rows.push({ studentId: sid, name: String(info.name), school: info.school ? String(info.school) : null, grade, cells, records, rail,
      stalledDates: M.stall.stalledDatesOf(dayDates.filter(d => records[d]).map(d => ({ date: d, progress: records[d].progress })), M.stall.DEFAULT_STALL_RUN),
      rosterPhase: R.roster.rosterPhaseOf(enrollments, withdrawnAt, anchor, dayDates), badges: [] });
  }
  if (rows.length > 0) {
    const badgeMap = await mathLifecycleBadges(sql, t, R, M, { classId: access.classId, range: { first: from, last: to }, spansByStudent, withdrawnByStudent });
    for (const row of rows) row.badges = badgeMap.get(row.studentId) ?? [];
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const railSummary = { 'no-data': 0, 'no-goal': 0, 'goal-behind': 0, 'not-started': 0, done: 0, ahead: 0, on: 0, behind: 0 };
  for (const row of rows) { if (row.rosterPhase === 'ended') continue; railSummary[row.rail?.rail.status ?? 'no-data'] += 1; }
  const shownRecords = rows.flatMap(row => Object.entries(row.records).map(([date, rec]) => ({ studentId: row.studentId, date, textbook: rec.textbook, progress: rec.progress })));
  const offGoalByDate = M.goals.offGoalCountByDate(shownRecords, goals);
  const bookOptions = [];
  for (const rec of shownRecords) { const book = (rec.textbook ?? '').trim(); if (book && !bookOptions.includes(book)) bookOptions.push(book); }
  bookOptions.sort((a, b) => a.localeCompare(b, 'ko'));
  return { ok: true, data: {
    learningContext: { schedules, holidays: env.holidays,
      spans: Object.fromEntries(rows.map(student => [student.studentId, enrRows.filter(e => e.student_id === student.studentId)
        .flatMap(e => R.roster.mathSpansOf([{ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true }], withdrawnByStudent.get(student.studentId) ?? null)
          .map(span => ({ ...span, attendanceDays: e.attendance_days ?? null })))])) },
    classId: access.classId, className: access.className, month, monthLabel: R.dk.monthLabel(month), today, teacherName: teacherRows[0]?.display_name ?? null, days,
    students: rows, goals, offGoalByDate, bookOptions, fill: R.cell.tallyCells(allStates), railSummary, canEdit: access.canWrite, goalsStatus,
    elapsedDays: dayDates.filter(d => d <= today).length, holidays, fontSize: M.font.readMcsFontSize(prefRows[0]?.ui_prefs ?? null) } };
}

// ── server/landing.ts getMathClassOptions — 반 바꾸기 목록(그 달까지 운영한 수학 반 · 보는 사람 범위) ──────────────────────────
export async function mathClassOptions(sql, t, R, viewer, monthRaw) {
  if (viewer.level === 'none') return [];
  const month = R.classDays.normalizeMonth(monthRaw, R.dk.kstMonth()), { from } = R.dk.monthRange(month);
  const [all, filter] = await Promise.all([
    sql`select id::text id, class_name from public.classes where tenant_id=${t} and subject='math' and is_active and (closed_at is null or closed_at >= ${from}::date) order by class_name`,
    visibleClassFilter(sql, t, R, viewer, R.dk.kstToday()),
  ]);
  return (filter ? all.filter(c => filter(c.id)) : all).map(c => ({ id: c.id, name: c.class_name }));
}

// ── server/learning-queries.ts getMathLearningData(classId, monthData, { allRecords: true }) ────────────────────────────
export async function mathLearningData(sql, t, R, M, viewer, classId, monthData, options = {}) {
  const gate = await mcsClassAccess(sql, t, R, viewer, classId);
  const endOfMonth = R.dk.monthRange(monthData.month).to, referenceDate = endOfMonth < monthData.today ? endOfMonth : monthData.today;
  const result = { goals: {}, progress: {}, records: {}, status: 'ok', referenceDate, context: monthData.learningContext ?? { schedules: [], holidays: {}, spans: {} } };
  if (!gate.ok) return { ...result, status: 'failed' };
  const [cls] = await sql`select math_learning_track from public.classes where tenant_id=${t} and id=${classId}`;
  if (!cls) return { ...result, status: 'failed' };
  const track = cls.math_learning_track === 'supplement' ? 'supplement' : 'regular';
  result.track = track;
  let legacy, standard;
  try {
    legacy = await sql.savepoint(s => s`select id::text id, student_id::text student_id, study_grade, start_block, end_block, start_date::text start_date, end_date::text end_date, textbook
      from public.math_learning_goals where tenant_id=${t} and class_id=${classId}`);
    standard = await sql.savepoint(s => s`select id::text id, student_id::text student_id, study_grade, end_study_grade, start_block, end_block, start_date::text start_date, end_date::text end_date,
        textbook, track, block_count, milestones, ${ISO(s, 'updated_at')} updated_at, plan_revision
      from public.math_learning_track_goals where tenant_id=${t} and class_id=${classId} and track=${track} and start_date <= ${endOfMonth}::date order by start_date`);
  } catch (e) { return { ...result, status: e?.code === '42P01' ? 'missing-table' : 'failed' }; }
  const visibleIds = new Set(monthData.students.filter(s => !options.studentId || s.studentId === options.studentId).map(s => s.studentId));
  for (const row of [...legacy.map(row => ({ ...row, sourceTable: 'math_learning_goals', track: 'regular', block_count: null, end_study_grade: null, milestones: [], updated_at: undefined, plan_revision: null })),
    ...standard.map(row => ({ ...row, sourceTable: 'math_learning_track_goals' }))]) {
    if (!visibleIds.has(row.student_id) || row.track !== track) continue;
    const goal = { ...(row.id ? { source: { table: row.sourceTable, id: row.id } } : {}), studentId: row.student_id, studyGrade: row.study_grade, endStudyGrade: row.end_study_grade ?? undefined,
      startBlock: row.start_block, endBlock: row.end_block, startDate: row.start_date, endDate: row.end_date, textbook: row.textbook, track: row.track === 'supplement' ? 'supplement' : 'regular',
      blockCount: row.block_count, milestones: row.milestones, updatedAt: row.updated_at, revision: row.plan_revision ?? null };
    result.goals[goal.studentId] = M.plan.normalizeLearningGoal(goal);
  }
  if (!visibleIds.size) return result;
  const ids = [...visibleIds];
  try {
    const records = await sql.savepoint(s => s`select id::text id, student_id::text student_id, report_date::text report_date, progress, textbook, homework_today, ${ISO(s, 'classnote_sent_at')} classnote_sent_at
      from public.lesson_reports where tenant_id=${t} and class_id=${classId} and student_id = any(${ids}::uuid[]) and ${sentReport(s)} and revoked_at is null and report_date <= ${referenceDate}::date
      order by report_date, classnote_sent_at nulls first, id`);
    const students = await sql`select id::text id, enrolled_at::text enrolled_at from public.students where tenant_id=${t} and id = any(${ids}::uuid[])`;
    const enrollments = await sql`select student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date from public.enrollments
      where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by id`;
    const previousEnrollments = enrollments.filter(enrollment => {
      if (enrollment.class_id === classId || !enrollment.end_date) return false;
      const currentStart = enrollments.filter(item => item.student_id === enrollment.student_id && item.class_id === classId && item.start_date).map(item => item.start_date).sort()[0];
      return currentStart != null && enrollment.end_date <= currentStart;
    });
    const previousClassIds = [...new Set(previousEnrollments.map(item => item.class_id))];
    const previousRecords = previousClassIds.length ? await sql.savepoint(s => s`select r.id::text id, r.student_id::text student_id, r.class_id::text class_id, r.report_date::text report_date, r.progress,
        r.textbook, r.homework_today, ${ISO(s, 'r.classnote_sent_at')} classnote_sent_at from public.lesson_reports r join public.classes c on c.id=r.class_id
      where r.tenant_id=${t} and r.student_id = any(${ids}::uuid[]) and r.class_id = any(${previousClassIds}::uuid[]) and c.subject='math' and c.math_learning_track=${track}
        and ${sentReport(s)} and r.revoked_at is null and r.report_date <= ${referenceDate}::date order by r.report_date, r.classnote_sent_at nulls first, r.id`) : [];
    const asRecord = row => ({ ...(row.id ? { sourceId: row.id } : {}), date: row.report_date, progress: row.progress, textbook: row.textbook, homework: row.homework_today, sentAt: row.classnote_sent_at });
    const previousByStudent = new Map();
    for (const row of previousRecords) {
      if (!previousEnrollments.some(en => en.student_id === row.student_id && en.class_id === row.class_id && (!en.start_date || row.report_date >= en.start_date) && row.report_date <= en.end_date)) continue;
      (previousByStudent.get(row.student_id) ?? previousByStudent.set(row.student_id, []).get(row.student_id)).push(asRecord(row));
    }
    const byStudent = new Map();
    for (const row of records) (byStudent.get(row.student_id) ?? byStudent.set(row.student_id, []).get(row.student_id)).push(asRecord(row));
    for (const studentId of visibleIds) {
      const goal = result.goals[studentId];
      const firstEnrollment = enrollments.filter(item => item.student_id === studentId && item.start_date).map(item => item.start_date).sort()[0];
      const enrolledAt = students.find(student => student.id === studentId)?.enrolled_at ?? firstEnrollment ?? null;
      const currentRecords = (byStudent.get(studentId) ?? []).filter(record => !enrolledAt || record.date >= enrolledAt);
      const historyRecords = currentRecords.filter(record => !goal || goal.track !== 'supplement' || goal.revision || (record.date >= goal.startDate && record.date <= goal.endDate));
      if (goal) {
        result.progress[studentId] = M.plan.buildLearningProgress(goal, result.context, currentRecords, referenceDate, monthData.month, { includeAfterGoal: options.forRevision });
        result.progress[studentId].history = M.history.buildLearningHistory(goal, result.progress[studentId], [...(previousByStudent.get(studentId) ?? []), ...(byStudent.get(studentId) ?? [])], enrolledAt, referenceDate);
      }
      result.records[studentId] = (options.allRecords || options.forRevision
        ? currentRecords.filter(record => goal?.track !== 'supplement' || goal.revision || options.forRevision || record.date <= goal.endDate)
        : historyRecords.slice(-30)).reverse();
    }
  } catch { result.status = 'failed'; }
  return result;
}

/** 반 월간 화면 한 벌 — 2.0 mcs/[classId]/month/page.tsx의 서버 쪽(조회 + 교재 창·계획 가공)까지. 화면은 이 값을 받아 page.tsx JSX를 그대로 그린다. */
export async function mcsMonthPage({ sql, t, R, env, importV2, viewer, classId, month }) {
  const M = await loadMonthRules(importV2);
  const [res, options] = [await mathSheetMonth(sql, t, R, M, env, viewer, classId, month), await mathClassOptions(sql, t, R, viewer, month)];
  if (!res.ok) return { res, options };
  const data = res.data, studentIds = data.students.map(s => s.studentId);
  const learning = await mathLearningData(sql, t, R, M, viewer, classId, data, { allRecords: true });
  // 전체 목표 '초기화'(배정 취소) = 원장 이상급(2.0 canResetMathLearningGoals — 운영자 계정은 보는 사람에서 빠져 있다).
  const canResetGoals = viewer.systemRole === 'master';
  const textbooks = await mathClassTextbooks(sql, t, R, classId, studentIds);
  const targets = await mathBookTargets(sql, t, studentIds);
  const allReports = await recentReportsAllClasses(sql, t, R, studentIds);
  const schoolExams = await schoolExamPeriods(sql, t, R, data.students.map(s => s.school));
  // page.tsx — 교재 전체 목표 + 지금 3개월 창(수업일은 목표 계획과 같은 함수 learningClassDates).
  const windows = {}, plans = {};
  const { catalog, orders, reports } = textbooks.sources;
  for (const s of data.students) {
    const p = R.plans.buildStudentBookPlans({ orders: orders.get(s.studentId) ?? [], catalog, reports: (reports.get(s.studentId) ?? []).filter(r => r.date <= learning.referenceDate),
      allReports: allReports?.get(s.studentId) ?? [], grade: s.grade, targets: targets?.byStudent.get(s.studentId), examOverrides: schoolExams?.byKey.get(R.school.normalizeSchoolName(s.school)) ?? [],
      referenceDate: learning.referenceDate, classDates: (from, to) => M.classDates.learningClassDates(s.studentId, learning.context, from, to) });
    plans[s.studentId] = p;
    if (p.roadmaps[0]) windows[s.studentId] = p.roadmaps[0].window;
  }
  const { sources, ...textbookView } = textbooks;
  return { res, options, learning, canResetGoals, textbooks: textbookView, targets: { status: targets.status }, schoolExams: { status: schoolExams.status, rows: schoolExams.rows }, windows, plans };
}
