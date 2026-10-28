// 2.0 원생 상세 '개요' 탭(app/(shell)/students/[id]/_tabs/overview-tab.tsx) — 그 탭의 Promise.all이 서버에서 읽던 값을 Docker 복사본에서 같은 결과로.
// · getStudentAttendanceStats(30일 · 칸마다 최신 정정 effectiveAttendanceRecords · (출석+지각) ÷ 기록 칸) · getStudentEnrollments(상세와 같은 함수) ·
//   getStudentUnifiedRows(통합 성적 — 성적 입력 + 수업보고서 일일·확인테스트 + 레벨테스트, getUnifiedGrades 학생 한 명) · getStudentInvoices(수납 권한이 있을 때만) ·
//   getStudentConsultationHistory · getStudentMemos · 학원 설정 · 화면 언어(원장 = 한국어 → 강사 영어 이름 표는 빈 표) · getStudentSiblings(공통 모듈).
// · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
// · 시각 칸은 PostgREST가 내는 글자 모양(to_json) 그대로 — 2.0 화면이 그 글자를 자르고 견준다.
// · 읽기 전용 · 바깥 호출 · AI 호출 없음(AI 케어는 저장된 결과만 — 학생 행에 실려 온다).
import { readStudentSiblings } from './v2-students-common.mjs';

const MODULES = { model: 'features/grades/unified/model.ts', link: 'features/grades/unified/server/consultation-link.ts', norm: 'features/grades/unified/server/normalize.ts',
  testScore: 'features/math-sheets/lib/test-score.ts', internal: 'features/consultations/internal-link.ts', eff: 'features/attendance/effective-records.ts',
  calc: 'lib/calc/attendance.ts', elig: 'features/enrollments/eligibility.ts', dk: 'lib/date-kst.ts' };
let rulesP = null;
export function overviewRules(load) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

// ── getStudentAttendanceStats(studentId, days) ────────────────────────────────────────────────────────────────────────
/** 최근 `days`일 출결 — 창 시작 = KST 오늘(복사본 날짜) − days(그날 포함, 2.0 gte). 정정 행은 칸마다 최신 하나로 접는다. */
export async function readAttendanceStats(base, id, days = 30) {
  const R = await overviewRules(base.load);
  const startYmd = R.dk.addDays(base.today, -days);
  const data = await base.sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date,
      slot_start::text slot_start, status::text status, to_json(recorded_at)#>>'{}' recorded_at
    from public.attendance_records where tenant_id=${base.t} and student_id=${id} and session_date >= ${startYmd}::date`;
  const rows = R.eff.effectiveAttendanceRecords(data);
  const total = rows.length, present = rows.filter((r) => r.status === 'present').length, late = rows.filter((r) => r.status === 'late').length;
  return { total, present, absent: rows.filter((r) => r.status === 'absent').length, late, excused: rows.filter((r) => r.status === 'excused').length,
    rate: R.calc.attendanceRate(R.calc.attendedCount({ present, late }), total) };
}

// ── getStudentInvoices ─────────────────────────────────────────────────────────────────────────────────────────────────
/** 청구 — 청구월 내림차순(같은 달이면 id). 항목 내역은 line_items의 description(없으면 name)·amount. */
export async function readStudentInvoices(base, id) {
  const rows = await base.sql`select id::text id, period, category::text category, amount_total, amount_paid, amount_discount, status::text status,
      due_date::text due_date, to_json(paid_at)#>>'{}' paid_at, notes, line_items
    from public.invoices where tenant_id=${base.t} and student_id=${id} order by period desc, id`;
  return rows.map((r) => ({ id: r.id, period: r.period, category: r.category, amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid),
    amountDiscount: Number(r.amount_discount), status: r.status, dueDate: r.due_date, paidAt: r.paid_at, notes: r.notes,
    lineItems: Array.isArray(r.line_items) ? r.line_items.map((li) => ({ description: String(li?.description ?? li?.name ?? '').trim(), amount: Number(li?.amount ?? 0) })) : [] }));
}

// ── getStudentConsultationHistory ──────────────────────────────────────────────────────────────────────────────────────
/** 재원생 상담 — 상담일 내림차순 · 상담자 이름 · 요약은 내부 연결 표식을 뗀 글(visibleConsultationSummary). 원장 화면 = 강사 범위 없음. */
export async function readConsultationHistory(base, id) {
  const R = await overviewRules(base.load);
  const rows = await base.sql`select c.id::text id, to_json(c.consulted_at)#>>'{}' consulted_at, c.category::text category, c.subject, c.audience::text audience, c.summary,
      c.follow_up_action, c.follow_up_date::text follow_up_date, c.follow_up_done, u.display_name counselor_name
    from public.student_consultations c left join public.users u on u.id = c.counselor_id
    where c.tenant_id=${base.t} and c.student_id=${id} order by c.consulted_at desc, c.id`;
  return rows.map((r) => ({ id: r.id, consultedAt: r.consulted_at, category: r.category, subject: r.subject, audience: r.audience,
    summary: R.internal.visibleConsultationSummary(r.summary), followUpAction: r.follow_up_action, followUpDate: r.follow_up_date,
    followUpDone: r.follow_up_done, counselorName: r.counselor_name ?? null }));
}

// ── getStudentMemos ────────────────────────────────────────────────────────────────────────────────────────────────────
/** 특이사항 — 고정 먼저 · 최근 먼저 · 작성자 이름. 검색 허용 칸(0250a)이 없으면 허용으로 본다(2.0과 같다). */
export async function readStudentMemos(base, id) {
  const rows = await base.sql`select m.id::text id, m.category::text category, m.content, m.pinned, m.searchable, to_json(m.created_at)#>>'{}' created_at,
      m.created_by::text created_by, u.display_name author_name
    from public.student_memos m left join public.users u on u.id = m.created_by
    where m.tenant_id=${base.t} and m.student_id=${id} order by m.pinned desc, m.created_at desc, m.id`;
  return rows.map((r) => ({ id: r.id, category: r.category, content: r.content, pinned: r.pinned ?? false, searchable: r.searchable ?? true,
    createdAt: r.created_at, createdBy: r.created_by, createdByName: r.author_name ?? null }));
}

// ── getStudentUnifiedRows(getUnifiedGrades 학생 한 명 + withPreviousScores) ──────────────────────────────────────────────
const columnReady = async (base, table, column) =>
  (await base.sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) yes`)[0].yes;

/**
 * 학생 한 명의 통합 성적 기록(최신순 · 증감) — 성적 탭·개요 '최근 성적'이 같은 것을 읽는다.
 * 2.0 getUnifiedGrades(from='2000-01-01', to='2100-12-31', { studentId })를 원장 화면(강사 범위 없음)으로. 반 일정·담임은 이 학생 기록이 쓰는 반만 읽는다
 * (2.0은 학원 모든 반을 읽고 그중 이 학생이 다닌 반·보고서 반만 기록에 싣는다 — 결과는 같다).
 */
export async function readStudentUnifiedRows(base, id) {
  const R = await overviewRules(base.load), t = base.t, sql = base.sql;
  const from = '2000-01-01', to = '2100-12-31';
  const lookback = R.norm.isoDaysBefore(from, 180), classAnchor = base.today;
  const [schemaReady, noExamReady] = [await columnReady(base, 'student_grades', 'exam_slot'), await columnReady(base, 'student_grades', 'no_exam')];
  const classRows = await sql`select id::text id, class_name, subject, teacher_id::text teacher_id from public.classes where tenant_id=${t} order by id`;
  const enrollments = await sql`select id::text id, student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date,
      attendance_days, is_transferred
    from public.enrollments where tenant_id=${t} and student_id=${id} and start_date <= ${classAnchor}::date and (end_date is null or end_date >= ${lookback}::date)
    order by id`;
  const gradeRows = await sql`select id::text id, student_id::text student_id, exam_name, subject, score::text score, max_score::text max_score, taken_on::text taken_on,
      ${schemaReady ? sql.frag`exam_slot, school_year, term` : sql.frag`null::text exam_slot, null::int school_year, null::int term`},
      ${noExamReady ? sql.frag`no_exam` : sql.frag`null::boolean no_exam`}
    from public.student_grades where tenant_id=${t} and student_id=${id} and taken_on <= ${to}::date order by id`;
  const reports = await sql`select id::text id, student_id::text student_id, class_id::text class_id, subject, report_date::text report_date, daily_test, check_test, exam_info
    from public.lesson_reports where tenant_id=${t} and student_id=${id} and report_date >= ${lookback}::date and report_date <= ${to}::date order by id`;
  const levels = await sql`select id::text id, student_id::text student_id, test_type::text test_type, subject, tested_on::text tested_on, level, subscores
    from public.level_tests where tenant_id=${t} and student_id=${id} and tested_on >= ${lookback}::date and tested_on <= ${to}::date order by id`;
  const usedClassIds = [...new Set([...enrollments.map((r) => r.class_id), ...reports.map((r) => r.class_id).filter(Boolean)])];
  const usedClasses = classRows.filter((c) => usedClassIds.includes(c.id));
  const teacherIds = [...new Set(usedClasses.map((c) => c.teacher_id).filter(Boolean))];
  const [schedules, students, consultations, teachers] = [
    usedClassIds.length ? await sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id = any(${usedClassIds}::uuid[]) and valid_from <= ${classAnchor}::date
        and (valid_to is null or valid_to >= ${lookback}::date) order by id` : [],
    await sql`select id::text id, name, school, grade from public.students where tenant_id=${t} and id=${id}`,
    await sql`select student_id::text student_id, subject, category::text category, to_json(consulted_at)#>>'{}' consulted_at, summary
      from public.student_consultations where tenant_id=${t} and student_id=${id} and category = 'academic' and summary ilike ${'%[EYWA-UNIFIED:%'} order by id`,
    teacherIds.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : [],
  ];
  const studentById = new Map(students.map((r) => [r.id, r])), teacherById = new Map(teachers.map((r) => [r.id, r.display_name]));
  const schedulesByClass = new Map();
  for (const row of schedules) {
    if (row.valid_from > classAnchor || (row.valid_to && row.valid_to < classAnchor)) continue;
    const days = schedulesByClass.get(row.class_id) ?? new Set();
    days.add(row.day_of_week);
    schedulesByClass.set(row.class_id, days);
  }
  const classById = new Map(classRows.map((row) => [row.id, { id: row.id, name: row.class_name, teacher: row.teacher_id ? teacherById.get(row.teacher_id) ?? null : null,
    days: schedulesByClass.get(row.id)?.size ?? 0 }]));
  const rawClassById = new Map(classRows.map((row) => [row.id, row]));
  const onRoster = (row, date) => R.elig.isEnrollmentOnRosterOn({ startDate: row.start_date, endDate: row.end_date, isTransferred: row.is_transferred ?? false }, date);
  const classesFor = (subject, date) => R.model.classOrder(enrollments.filter((row) => onRoster(row, date)).map((row) => {
    const cls = classById.get(row.class_id), raw = rawClassById.get(row.class_id);
    return cls && raw?.subject === subject ? { ...cls, days: row.attendance_days?.length || cls.days } : null;
  }).filter(Boolean));
  const subjectOnDate = (date) => {
    const subjects = new Set(enrollments.filter((row) => onRoster(row, date)).map((row) => rawClassById.get(row.class_id)?.subject).filter(Boolean));
    return subjects.size === 1 ? [...subjects][0] : null;
  };
  const linked = R.link.linkedConsultationDates(consultations);
  const baseOf = (studentId, subject, date) => {
    const student = studentById.get(studentId);
    if (!student) return null;
    const latestClasses = classesFor(subject, classAnchor), historicalClasses = classesFor(subject, date);
    return { studentId, name: student.name, school: student.school, grade: student.grade, subject, date,
      classes: latestClasses.length ? latestClasses : historicalClasses, trendClasses: historicalClasses,
      consultationDate: null, manualConsultationDate: null, editHref: `/students/${studentId}?tab=grades` };
  };
  const num = R.norm.numberOrNull, records = [];
  for (const row of gradeRows) {
    const context = baseOf(row.student_id, row.subject, row.taken_on);
    if (!context) continue;
    const key = `grade:${row.id}`;
    records.push({ ...context, key, source: 'grade', sourceId: row.id, kind: R.norm.gradeKind(row.exam_slot, row.exam_name),
      score: num(row.score), maxScore: num(row.max_score), rawScore: null,
      consultationDate: R.link.consultationDateFor(linked, row.student_id, row.subject, key),
      slot: row.exam_slot ?? undefined, schoolYear: row.school_year ?? undefined, term: row.term ?? undefined, noExam: row.no_exam === true,
      editHref: `/exams/input?year=${row.school_year ?? ''}&term=${row.term ?? ''}&subject=${encodeURIComponent(row.subject)}&slot=${row.exam_slot ?? ''}&date=${row.taken_on}` });
  }
  for (const report of reports) {
    const subject = report.subject || (report.class_id ? rawClassById.get(report.class_id)?.subject : subjectOnDate(report.report_date));
    if (!subject) continue;
    const found = baseOf(report.student_id, subject, report.report_date);
    if (!found) continue;
    const reportClass = report.class_id ? classById.get(report.class_id) : undefined;
    const context = reportClass ? { ...found, classes: [reportClass], trendClasses: [reportClass] } : found;
    for (const test of R.testScore.testScoresOf({ dailyTest: report.daily_test, checkTest: report.check_test, examInfo: report.exam_info })) {
      const key = `report:${report.id}:${test.kind}`;
      records.push({ ...context, key, source: 'report', sourceId: report.id, kind: test.kind === 'legacy' ? 'other' : test.kind, score: test.correct, maxScore: test.total,
        rawScore: test.raw, consultationDate: R.link.consultationDateFor(linked, report.student_id, subject, key), editHref: '/lesson-reports?tab=list' });
    }
  }
  for (const level of levels) {
    const context = baseOf(level.student_id, level.subject, level.tested_on);
    if (!context) continue;
    const key = `level:${level.id}`;
    records.push({ ...context, key, source: 'level', sourceId: level.id, kind: level.test_type === 'placement' ? 'admission' : 'other',
      score: num(level.subscores?.['총점']), maxScore: num(level.subscores?.['만점']), consultationDate: R.link.consultationDateFor(linked, level.student_id, level.subject, key),
      rawScore: [level.level, ...Object.entries(level.subscores ?? {}).filter(([name]) => name !== '총점' && name !== '만점').map(([name, value]) => `${name} ${value}`)].filter(Boolean).join(' · ') || null });
  }
  return R.model.withPreviousScores(records.filter((row) => row.studentId === id));
}

/** 개요 탭 자료 — overview-tab.tsx의 Promise.all 이름 그대로(호스트 탭이 같은 이름으로 꺼낸다). 차례대로(한 관문). */
export async function loadTab(ctx) {
  const { base, id, student, gates } = ctx;
  const attendance = await readAttendanceStats(base, id, 30);
  const enrollments = await ctx.readStudentEnrollments(base, id);
  const grades = await readStudentUnifiedRows(base, id);
  const invoices = gates.canSeeBilling ? await readStudentInvoices(base, id) : [];
  const consultations = await readConsultationHistory(base, id);
  const memos = await readStudentMemos(base, id);
  const siblings = await readStudentSiblings(base, student);
  return { attendance, enrollments, grades, invoices, consultations, memos, settings: { operations: base.settings.operations }, lang: base.lang, teacherNames: {}, siblings };
}
