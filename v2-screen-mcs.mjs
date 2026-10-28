// 2.0 화면 — 강사 시트 · 수학(MCS) (V2-SCREENS.md 대상 `mcs`). 그리기는 2.0의 실제 React 부품(v2-host/src/mcs*.tsx),
// 이 모듈은 2.0 page.tsx가 서버에서 하던 조회를 Docker 복사본에서 같은 결과로 만든다:
//  · /mcs(반별) = features/math-sheets/server/landing.ts getMathSheetLanding + 진도맵(시안) 버튼 자격(canPreviewProgressMap)
//  · /mcs/teachers(선생님별) = server/teacher-roster.ts getMathTeacherRoster
//  · /mcs/<반>/month(반 월간) = v2-mcs-month.mjs(getMathSheetMonth · getMathLearningData · 교재 · page.tsx의 교재 창·계획 가공)
// 사람마다 화면이 다르다(강사 = 담당 반만) — '보는 사람'(viewer)을 고르고 그 사람의 역할·권한 표로 범위를 낸다(v2-mcs-core).
import { UUID, loadRules, readSettings, readViewers, editorsOf, visibleClassFilter } from './v2-mcs-core.mjs';
import { mcsMonthPage } from './v2-mcs-month.mjs';
import { mathCatalogBooks, studentBookOrders, recentReportsByStudentClass, mathBookTargets, schoolExamPeriods } from './v2-math-textbooks.mjs';

const ID = 'mcs';

// ── features/math-sheets/server/landing.ts getMathSheetLanding ────────────────────────────────────────────────────────
async function landingData(sql, t, R, env, viewer, monthRaw) {
  const month = R.classDays.normalizeMonth(monthRaw, R.dk.kstMonth()), today = R.dk.kstToday(), anchor = R.roster.rosterAnchorOf(month, today);
  const { from: monthStart, to: monthEnd } = R.dk.monthRange(month), monthLabel = R.dk.monthLabel(month);
  const [all, filter] = await Promise.all([
    sql`select id::text id, class_name, teacher_id::text teacher_id, is_special, math_learning_track from public.classes where tenant_id=${t} and subject='math' and is_active
      and (closed_at is null or closed_at >= ${monthStart}::date) order by class_name`,
    visibleClassFilter(sql, t, R, viewer, today),
  ]);
  if (all.length === 0) return { ok: true, data: { month, monthLabel, cards: [], emptyReason: 'no-classes', byTeacher: [] } };
  const scoped = filter ? all.filter(c => filter(c.id)) : all;
  if (scoped.length === 0) return { ok: true, data: { month, monthLabel, cards: [], emptyReason: 'no-scoped-classes', byTeacher: [] } };
  const classIds = scoped.map(c => c.id), classSet = new Set(classIds), teacherIds = [...new Set(scoped.map(c => c.teacher_id).filter(Boolean))];
  const [schedRows, enrRows, teacherRows, reportRows, attRows] = await Promise.all([
    sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} order by id`,
    sql`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments where tenant_id=${t} order by id`,
    teacherIds.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : [],
    sql`select class_id::text class_id, student_id::text student_id, report_date::text report_date from public.lesson_reports where tenant_id=${t} and class_id = any(${classIds}::uuid[])
      and report_date between ${monthStart}::date and ${monthEnd}::date order by id`,
    sql`select class_id::text class_id, student_id::text student_id, session_date::text session_date, status::text status from public.attendance_records where tenant_id=${t}
      and class_id = any(${classIds}::uuid[]) and session_date between ${monthStart}::date and ${monthEnd}::date order by id`,
  ]);
  const teacherName = new Map(teacherRows.map(x => [x.id, x.display_name ?? null]));
  const schedByClass = new Map();
  for (const r of schedRows) {
    if (!classSet.has(r.class_id)) continue;
    (schedByClass.get(r.class_id) ?? schedByClass.set(r.class_id, []).get(r.class_id)).push({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time ?? null,
      validFrom: r.valid_from ? r.valid_from.slice(0, 10) : null, validTo: r.valid_to ? r.valid_to.slice(0, 10) : null });
  }
  const enrByClass = new Map();
  for (const e of enrRows) {
    if (!classSet.has(e.class_id)) continue;
    const byStudent = enrByClass.get(e.class_id) ?? enrByClass.set(e.class_id, new Map()).get(e.class_id);
    (byStudent.get(e.student_id) ?? byStudent.set(e.student_id, []).get(e.student_id)).push({ startDate: e.start_date ? e.start_date.slice(0, 10) : null,
      endDate: e.end_date ? e.end_date.slice(0, 10) : null, isTransferred: e.is_transferred === true });
  }
  const rosterStudentIds = [...new Set([...enrByClass.values()].flatMap(m => [...m.keys()]))];
  const studentRows = rosterStudentIds.length ? await sql`select id::text id, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id = any(${rosterStudentIds}::uuid[])` : [];
  const withdrawnById = new Map(studentRows.map(r => [r.id, r.withdrawn_at ? r.withdrawn_at.slice(0, 10) : null]));
  const reportKeys = new Set(reportRows.map(r => `${r.class_id}|${r.report_date.slice(0, 10)}|${r.student_id}`));
  const attByKey = new Map();
  for (const a of attRows) { const k = `${a.class_id}|${a.session_date.slice(0, 10)}|${a.student_id}`; (attByKey.get(k) ?? attByKey.set(k, []).get(k)).push(String(a.status)); }
  const cards = [];
  for (const c of scoped) {
    const days = R.classDays.classDaysOf(month, schedByClass.get(c.id) ?? []);
    if (days.length === 0) continue;
    const byStudent = enrByClass.get(c.id) ?? new Map(), dayDates = days.map(d => d.date), phases = [], states = [];
    for (const [sid, list] of byStudent) {
      const withdrawnAt = withdrawnById.get(sid) ?? null;
      if (!R.roster.isOnMathRosterAnyDay(list, withdrawnAt, dayDates)) continue;
      phases.push(R.roster.rosterPhaseOf(list, withdrawnAt, anchor, dayDates));
      for (const day of days) states.push(R.cell.cellStateOf({ enrollments: list, withdrawnAt, date: day.date, attendance: R.cell.foldDayAttendance(attByKey.get(`${c.id}|${day.date}|${sid}`) ?? []),
        hasReport: reportKeys.has(`${c.id}|${day.date}|${sid}`), today, holiday: R.holiday.isHolidayOn(env.holidays, day.date) }));
    }
    const fill = R.cell.tallyCells(states), counts = R.roster.countRosterPhases(phases);
    cards.push({ classId: c.id, className: c.class_name, teacherName: c.teacher_id ? (teacherName.get(c.teacher_id) ?? null) : null, dayCount: days.length,
      elapsedDays: days.filter(d => d.date <= today).length, studentCount: counts.on, extraCount: counts.extra, extraTitle: R.roster.rosterExtraTitle(counts),
      isSpecial: R.special.isSpecialLecture({ isSpecial: c.is_special === true, className: c.class_name }), written: fill.written, shown: fill.written + fill.unwritten, pct: fill.pct,
      learningTrack: c.math_learning_track === 'supplement' ? 'supplement' : 'regular' });
  }
  return { ok: true, data: { month, monthLabel, cards, emptyReason: cards.length === 0 ? 'no-month-classes' : null, byTeacher: R.tracks.groupMathCardsByTeacher(cards) } };
}

// ── features/math-sheets/server/teacher-roster.ts getMathTeacherRoster ─────────────────────────────────────────────────
async function teacherRosterData(sql, t, R, env, viewer) {
  const today = R.dk.kstToday();
  const [all, filter] = await Promise.all([
    sql`select id::text id, class_name, teacher_id::text teacher_id from public.classes where tenant_id=${t} and subject='math' and is_active
      and (closed_at is null or closed_at >= ${today}::date) order by class_name`,
    visibleClassFilter(sql, t, R, viewer, today),
  ]);
  const classes = all.filter(c => !filter || filter(c.id));
  if (classes.length === 0) return { ok: true, groups: [], today };
  const classIds = classes.map(c => c.id), teacherIds = [...new Set(classes.map(c => c.teacher_id).filter(Boolean))];
  try {
    const [enrRows, teachers] = await Promise.all([
      sql`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments
        where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and (end_date is null or end_date >= ${today}::date) order by id`,
      teacherIds.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : [],
    ]);
    const catalog = await mathCatalogBooks(sql, t);
    const current = enrRows.filter(e => (!e.start_date || e.start_date.slice(0, 10) <= today) && !R.eligibility.isEnrollmentEndedOn(e.end_date?.slice(0, 10), today, e.is_transferred === true));
    const studentIds = [...new Set(current.map(e => e.student_id))];
    const students = studentIds.length ? await sql`select id::text id, name, school, grade, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [];
    const orders = await studentBookOrders(sql, t, R, studentIds);
    const reports = await recentReportsByStudentClass(sql, t, R, studentIds, today);
    const targets = await mathBookTargets(sql, t, studentIds);
    const schoolExams = await schoolExamPeriods(sql, t, R, null);
    const studentById = new Map(students.filter(s => !s.withdrawn_at || s.withdrawn_at.slice(0, 10) > today).map(s => [s.id, s]));
    const teacherName = new Map(teachers.map(x => [x.id, x.display_name]));
    const classById = new Map(classes.map(c => [c.id, c]));
    const reportsByKey = new Map();
    for (const r of reports) { const k = `${r.student_id}|${r.class_id}`; (reportsByKey.get(k) ?? reportsByKey.set(k, []).get(k)).push({ date: r.report_date, textbook: r.textbook, progress: r.progress }); }
    const groups = new Map();
    for (const e of [...current].sort((a, b) => String(classById.get(a.class_id)?.class_name).localeCompare(String(classById.get(b.class_id)?.class_name), 'ko'))) {
      const cls = classById.get(e.class_id), s = studentById.get(e.student_id);
      if (!cls || !s) continue;
      const teacher = (cls.teacher_id && teacherName.get(cls.teacher_id)) || R.tracks.NO_HOMEROOM_LABEL;
      const rows = groups.get(teacher) ?? new Map();
      if (rows.has(s.id)) continue;
      const plans = R.plans.buildStudentBookPlans({ orders: orders?.get(s.id) ?? [], catalog: catalog ?? [], reports: reportsByKey.get(`${s.id}|${cls.id}`) ?? [], grade: s.grade,
        targets: targets.byStudent.get(s.id), examOverrides: schoolExams.byKey.get(R.school.normalizeSchoolName(s.school)) ?? [], referenceDate: today, today });
      const r = plans.roadmaps[0], w = r?.window;
      rows.set(s.id, { studentId: s.id, name: s.name, school: s.school, grade: s.grade, classId: cls.id, className: cls.class_name,
        window: w ? { name: w.books.map(b => b.title).join(' · '), done: w.done, total: w.total } : null, bookName: r?.position?.title ?? w?.books[0]?.title ?? null,
        status: r?.status ?? null, difference: r?.difference ?? null, bookCount: plans.roadmaps.length });
      groups.set(teacher, rows);
    }
    return { ok: true, today, groups: [...groups.entries()].map(([teacherName, rows]) => ({ teacherName, students: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')) }))
      .sort((a, b) => (a.teacherName === R.tracks.NO_HOMEROOM_LABEL ? 1 : b.teacherName === R.tracks.NO_HOMEROOM_LABEL ? -1 : a.teacherName.localeCompare(b.teacherName, 'ko'))) };
  } catch (e) {
    console.error(`math-sheets.getMathTeacherRoster: ${e?.code || ''} ${e?.message || ''}`);
    return { ok: false, error: '학생 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' };
  }
}

/** 2.0 하위 주소 — /mcs(반별) · /mcs/teachers(선생님별) · /mcs/<반>/month(반 월간). 진도맵(시안)은 다음 단계. */
const UUID_BODY = UUID.source.slice(1, -1);
const ROUTE = new RegExp(`^/mcs(?:/teachers|/${UUID_BODY}/month)?$`), MONTH = new RegExp(`^/mcs/(${UUID_BODY})/month$`);
export const screen = {
  id: ID, label: '강사 시트 · 수학', order: 7,
  params: { v2path: ROUTE, viewer: UUID, month: /^\d{4}-\d{2}$/ },
  load: async ({ sql, params: q, tenantId: t, importV2 }) => {
    const R = await loadRules(importV2), env = await readSettings(sql, t, R);
    const viewers = await readViewers(sql, t, R, env);
    const viewer = viewers.find(v => v.id === q.viewer) ?? viewers[0] ?? null;
    const common = { editors: editorsOf(viewers), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      host: { operations: env.operations, disabledModules: env.disabled } };
    if (!viewer) return { ...common, route: 'none' };
    if (q.v2path === '/mcs/teachers') return { ...common, route: 'teachers', teachers: await teacherRosterData(sql, t, R, env, viewer) };
    const month = MONTH.exec(q.v2path ?? '');
    if (month) return { ...common, route: 'month', month: await mcsMonthPage({ sql, t, R, env, importV2, viewer, classId: month[1], month: q.month ?? null }) };
    return { ...common, route: 'landing', landing: await landingData(sql, t, R, env, viewer, q.month ?? null),
      // 2.0 canPreviewProgressMap — 관리자 이상(운영자 계정은 보는 사람에서 빠져 있다).
      previewProgressMap: R.preview.canSeeProgressMapPreview(viewer.systemRole) };
  },
};
export { loadRules };
