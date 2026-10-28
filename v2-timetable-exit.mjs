// 2.0 화면 — 시간표 X(퇴원 겹침) 조회. 2.0 `loadExitOverlay`(features/withdrawals/server/exit-overlay-actions.ts)가 부르는 서버 조회를
// Docker 복사본에서 같은 표·같은 조건으로 읽고, 판정·조립은 2.0 순수 함수(importV2) 그대로 돌린다.
//  · getExitOverlay(exit-overlay.ts) = 기간 퇴원(server/window.ts getWithdrawalsInWindow) + 수강종료(server/queries.ts getSubjectEndedStudents
//    endedWithin) + 담당 선생님 판정(server/exit-teacher-judge.ts loadExitTeacherJudge ← teacher-portfolio/server/churn-source.ts loadChurnSource)
//    + 지금 휴원(server/exit-overlay-loaders.ts loadCurrentHolds · teacherNames).
//  · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
//  · 날짜 칸(date)은 ::text로 받아 PostgREST가 내던 'YYYY-MM-DD' 글자와 같게, 청크(100)·정렬도 2.0 조회 순서 그대로.
// 시간표 화면 읽기(GET /api/v2/timetable?exit=<과목>&anchor=<YYYY-MM>)가 부른다 — 화면 주인 = 원장 보기(2.0 showExitOverlay).

let modulesPromise = null;
function loadExitModules(importV2) {
  modulesPromise ??= (async () => {
    const at = p => importV2(p);
    const [win, rows, bulk, types, subjectEnded, merged, model, teachers, reasonKey, churnModel, context, students, evalConfig, dates, special, subjects, school, dk] = await Promise.all([
      'features/withdrawals/window.ts', 'features/withdrawals/exit-rows.ts', 'features/withdrawals/system-bulk.ts', 'features/withdrawals/types.ts',
      'features/withdrawals/subject-ended.ts', 'features/students/status/merged.ts', 'features/withdrawals/exit-overlay-model.ts',
      'features/withdrawals/exit-overlay-teachers.ts', 'features/withdrawals/reason-key.ts', 'features/teacher-portfolio/model/churn-model.ts',
      'features/teacher-portfolio/model/context.ts', 'features/teacher-portfolio/model/students.ts', 'features/teacher-portfolio/evaluation/config.ts',
      'features/teacher-portfolio/model/dates.ts', 'features/classes/special-lecture.ts', 'features/owner/subjects.ts', 'lib/format/school-grade.ts', 'lib/date-kst.ts',
    ].map(at));
    return { win, rows, bulk, types, subjectEnded, merged, model, teachers, reasonKey, churnModel, context, students, evalConfig, dates, special, subjects, school, dk };
  })().catch(error => { modulesPromise = null; throw error; });
  return modulesPromise;
}

const chunk100 = list => { const out = []; for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100)); return out; };
const one = v => (Array.isArray(v) ? (v[0] ?? null) : v);
/** PostgREST가 timestamptz를 내던 모양(UTC, +00:00) — kstDateOf가 같은 날짜를 읽게. */
const iso = col => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`;

// ── server/window.ts ────────────────────────────────────────────────────────────────────────────────────────────────────

/** loadEndedEnrollments — 학생들의 종료된 수강 전건(학생 100명 청크 × id 순). */
async function loadEndedEnrollments(sql, t, studentIds) {
  const out = [];
  for (const ids of chunk100(studentIds)) {
    const rows = await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.withdrawal_reason, case when c.id is null then null else json_build_object('class_name', c.class_name, 'subject', c.subject, 'english_track', c.english_track) end "class"
      from public.enrollments e left join public.classes c on c.id = e.class_id
      where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) and e.end_date is not null order by e.id`;
    out.push(...rows);
  }
  return out;
}
function lastClassOf(row) {
  const klass = row ? (one(row.class) ?? undefined) : undefined;
  return { className: klass?.class_name ?? null, subject: klass?.subject ?? null, englishTrack: klass?.english_track ?? null, reason: row?.withdrawal_reason ?? null };
}
function exitReasonOf(M, raw, lastReason) {
  const m = raw && typeof raw === 'object' ? raw : {};
  return { reason: M.types.normalizeReason(typeof m.reason === 'string' ? m.reason : null) ?? lastReason, memo: typeof m.memo === 'string' && m.memo.trim() ? m.memo.trim() : null };
}

/** getWithdrawalsInWindow(from, to) — 운영실 '퇴원생'과 같은 모집단(병합·수업 기록 없는 장부 정리·창 밖 일괄 퇴원 제외). */
async function getWithdrawalsInWindow(sql, t, M, from, to) {
  const withdrawnRows = await sql`select id::text id, name, school, grade, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, notes, withdrawal_metadata
    from public.students where tenant_id=${t} and status::text='withdrawn' and withdrawn_at >= ${from}::date and withdrawn_at <= ${to}::date order by withdrawn_at desc, id`;
  const students = withdrawnRows.filter(s => !M.merged.isMergedStudent(s.notes));
  if (students.length === 0) return [];
  const ended = await loadEndedEnrollments(sql, t, students.map(s => s.id));
  const last = M.win.lastEndedByStudent(ended);
  const byStudent = new Map();
  for (const row of ended) { const list = byStudent.get(row.student_id) ?? []; list.push(row); byStudent.set(row.student_id, list); }
  return students.flatMap(s => {
    const row = last.get(s.id);
    if (M.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: !!row })) return [];
    const klass = lastClassOf(row);
    const history = byStudent.get(s.id) ?? [];
    const exitClasses = M.win.withdrawalSubjects(history.map(e => ({ endDate: e.end_date, subject: lastClassOf(e).subject }))).map(subject => {
      const rows = history.filter(e => lastClassOf(e).subject === subject);
      const lastSubject = lastClassOf(M.win.pickLastEnded(rows) ?? undefined);
      return {
        subject, englishTrack: lastSubject.englishTrack, className: lastSubject.className,
        endedTogether: M.win.endedTogether(rows).map(e => ({ enrollmentId: e.id, classId: e.class_id, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true })),
      };
    });
    const systemBulk = M.bulk.isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: !!row });
    if (!M.win.inWithdrawalWindow({ withdrawnAt: s.withdrawn_at, systemBulk }, from, to)) return [];
    return [{
      id: s.id, name: s.name, school: s.school, grade: s.grade, enrolledAt: s.enrolled_at ? s.enrolled_at.slice(0, 10) : null, withdrawnAt: (s.withdrawn_at ?? '').slice(0, 10),
      lastClassName: klass.className, lastClassSubject: klass.subject, lastClassEnglishTrack: klass.englishTrack, exitClasses,
      ...exitReasonOf(M, s.withdrawal_metadata, klass.reason), cleanup: M.bulk.isCleanupExit(s.withdrawal_metadata),
    }];
  });
}

// ── server/queries.ts getSubjectEndedStudents({ endedWithin }) ──────────────────────────────────────────────────────────

async function loadEndedWithinStudents(sql, t, within) {
  const endedRows = await sql`select student_id::text student_id from public.enrollments where tenant_id=${t} and end_date >= ${within.from}::date and end_date <= ${within.to}::date order by id`;
  const ids = [...new Set(endedRows.map(r => r.student_id))];
  const out = [];
  for (const chunk of chunk100(ids)) out.push(...await sql`select id::text id, name, school, grade, status::text status from public.students
    where tenant_id=${t} and id = any(${chunk}::uuid[]) and status::text in ('enrolled', 'on_hold') order by id`);
  return out;
}

async function getSubjectEndedStudents(sql, t, M, within, today) {
  const students = await loadEndedWithinStudents(sql, t, within);
  if (students.length === 0) return [];
  const enrollments = [];
  for (const ids of chunk100(students.map(s => s.id))) {
    enrollments.push(...await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.withdrawal_reason, case when c.id is null then null else json_build_object('subject', c.subject, 'class_name', c.class_name, 'english_track', c.english_track, 'is_special', c.is_special) end "class"
      from public.enrollments e left join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) order by e.id`);
  }
  const bySt = new Map();
  for (const e of enrollments) {
    const klass = one(e.class) ?? undefined, subject = klass?.subject;
    if (!subject) continue;
    const arr = bySt.get(e.student_id) ?? [];
    arr.push({ id: e.id, classId: e.class_id, subject, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred ?? undefined,
      isSpecial: M.special.isSpecialLecture({ isSpecial: klass?.is_special, className: klass?.class_name }), className: klass?.class_name ?? null,
      englishTrack: klass?.english_track ?? null, reason: e.withdrawal_reason ?? null });
    bySt.set(e.student_id, arr);
  }
  const rows = [];
  for (const s of students) {
    const all = bySt.get(s.id) ?? [];
    const enr = all.filter(e => M.subjectEnded.countsForSubjectExit(e, today));
    const lastEndOf = subject => all.reduce((m, e) => (e.subject === subject && e.endDate && (!m || e.endDate > m) ? e.endDate : m), null);
    const { ended, active } = M.subjectEnded.getEndedSubjects(enr, today);
    if (ended.length === 0) continue;
    let lastEndedAt = null;
    for (const subject of ended) { const d = lastEndOf(subject); if (d && (!lastEndedAt || d > lastEndedAt)) lastEndedAt = d; }
    const endedDetail = ended.map(subject => {
      const subjectRows = enr.filter(e => e.subject === subject).map(e => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred }));
      const best = M.win.pickLastEnded(subjectRows);
      return {
        subject, endedAt: lastEndOf(subject) ?? best?.endDate ?? null, className: best?.className ?? null, englishTrack: best?.englishTrack ?? null,
        reason: best?.reason ?? null, enrollmentId: best?.id, isTransferred: best?.isTransferred === true,
        endedTogether: M.win.endedTogether(subjectRows).map(e => ({ enrollmentId: e.id, classId: e.classId, startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred === true })),
      };
    });
    rows.push({ id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status, endedSubjects: ended, activeSubjects: active, lastEndedAt, endedDetail });
  }
  rows.sort((a, b) => (b.lastEndedAt ?? '').localeCompare(a.lastEndedAt ?? ''));
  return rows;
}

// ── teacher-portfolio/server/churn-source.ts loadChurnSource · withdrawals/server/exit-teacher-judge.ts ──────────────────

const CLASS_COLUMNS = sql => sql`id::text id, class_name, subject, english_track, teacher_id::text teacher_id, is_active, closed_at::text closed_at, report_optout, is_makeup_pool, is_special`;
const SCHEDULE_COLUMNS = sql => sql`id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, teacher_id::text teacher_id,
  slot_teacher_label, lab_separate, valid_from::text valid_from, valid_to::text valid_to`;
const ENROLLMENT_COLUMNS = sql => sql`id::text id, student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold,
  attendance_days, is_transferred, is_transferred_in, withdrawal_reason`;

async function loadChurnSource(sql, t, M, { from, end }) {
  const tableExists = async name => !!(await sql`select to_regclass(${`public.${name}`}) r`)[0].r;
  const [testRows, classes, liveSchedules, endedSchedules, enrollments, transitions, futureEnrollments, studentReasons, evaluation] = await Promise.all([
    sql`select id::text id, is_test, notes from public.students where tenant_id=${t} and (is_test = true or notes like ${`${M.merged.MERGE_NOTE_PREFIX}%`}) order by id`,
    sql`select ${CLASS_COLUMNS(sql)} from public.classes where tenant_id=${t} order by id`,
    sql`select ${SCHEDULE_COLUMNS(sql)} from public.class_schedules where tenant_id=${t} and valid_from <= ${end}::date and valid_to is null order by id`,
    sql`select ${SCHEDULE_COLUMNS(sql)} from public.class_schedules where tenant_id=${t} and valid_from <= ${end}::date and valid_to >= ${from}::date order by id`,
    sql`select ${ENROLLMENT_COLUMNS(sql)} from public.enrollments where tenant_id=${t} and start_date <= ${end}::date and (end_date is null or end_date >= ${from}::date) order by id`,
    sql`select target_label, ${sql.unsafe(iso('created_at'))} created_at, metadata->>'classId' class_id, metadata->>'newTeacherId' teacher_id,
        metadata->>'previousTeacherId' previous_teacher_id, metadata->>'effectiveDate' effective_date
      from public.audit_logs where tenant_id=${t} and action in ('class_handover_apply', 'class_update') and metadata->>'newTeacherId' is not null order by created_at, id`,
    sql`select ${ENROLLMENT_COLUMNS(sql)} from public.enrollments where tenant_id=${t} and start_date > ${end}::date and start_date <= ${M.dk.addDays(end, 31)}::date order by id`,
    sql`select id::text id, withdrawal_metadata->>'reason' reason, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and withdrawal_metadata is not null order by id`,
    // loadEvaluationConfig — 표가 없으면 기본 설정(2.0과 같은 폴백).
    tableExists('teacher_evaluation_settings').then(ok => (ok ? sql`select config from public.teacher_evaluation_settings where tenant_id=${t}` : [])),
  ]);
  const test = new Set(testRows.filter(s => s.is_test || M.merged.isMergedStudent(s.notes)).map(s => s.id));
  const real = rows => rows.filter(e => !test.has(e.student_id));
  const config = evaluation[0] ? M.evalConfig.resolveEvaluationConfig(evaluation[0].config) : M.evalConfig.DEFAULT_EVALUATION_CONFIG;
  const toTransitions = rows => rows.flatMap(x => {
    const date = x.effective_date?.slice(0, 10) || M.dates.kstDateOf(x.created_at);
    return x.teacher_id && date ? [{ class_id: x.class_id, target_label: x.target_label, teacher_id: x.teacher_id, previous_teacher_id: x.previous_teacher_id, date }] : [];
  });
  const byId = (...lists) => [...new Map(lists.flat().map(row => [row.id, row])).values()];
  return {
    from, end, classes, schedules: byId(liveSchedules, endedSchedules), enrollments: real(enrollments), transitions: toTransitions(transitions),
    futureEnrollments: real(futureEnrollments), studentReasons, options: config.metrics.churn.churn ?? M.evalConfig.DEFAULT_CHURN_OPTIONS,
  };
}

async function loadExitTeacherJudge(sql, t, M, range, clock) {
  const source = await loadChurnSource(sql, t, M, range);
  const owner = M.context.buildHomeroomOwner(source.classes, source.transitions);
  const tracking = M.students.buildStudentTracking({ from: source.from, end: source.end, classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner });
  const churn = M.churnModel.buildChurnModel({ source: tracking.churnSource, classes: source.classes, options: source.options, futureEnrollments: source.futureEnrollments, studentReasons: source.studentReasons });
  const months = new Map();
  const view = {
    get(m) {
      if (m > clock.thisMonth) return undefined;
      let v = months.get(m);
      if (!v) {
        const win = M.win.withdrawalMonthWindow(m, clock.today);
        const w = { start: win.from, end: win.to };
        const eligible = churn.eligibleSubjects(w);
        v = { eligible, detail: new Map([...eligible.keys()].map(id => [id, churn.exits(id, w)])) };
        months.set(m, v);
      }
      return v;
    },
  };
  const irregular = new Set(source.classes.filter(c => c.is_makeup_pool || M.special.isSpecialLecture({ isSpecial: c.is_special, className: c.class_name })).map(c => c.id));
  const classRefs = new Map(source.classes.map(c => [c.id, { closedAt: c.closed_at, regular: !irregular.has(c.id), subject: c.subject }]));
  const classOf = id => classRefs.get(id);
  const endedRows = new Map();
  for (const e of source.enrollments) {
    const subject = classOf(e.class_id)?.subject;
    if (!e.end_date || !subject) continue;
    const bySubject = endedRows.get(subject) ?? new Map();
    endedRows.set(subject, bySubject);
    bySubject.set(e.student_id, [...(bySubject.get(e.student_id) ?? []), { classId: e.class_id, startDate: e.start_date, endDate: e.end_date, reason: e.withdrawal_reason ?? null }]);
  }
  return {
    source, owner, irregular,
    endedOf(studentId, subject, date) {
      const ended = M.reasonKey.endedWithExit(endedRows.get(subject)?.get(studentId) ?? [], date, classOf, M.teachers.OVERLAY_LOOKBACK_DAYS);
      return { endMonth: M.teachers.churnMonthOf(ended, date, classOf), endReasons: ended.map(r => r.reason) };
    },
    teachersOf: (studentId, subject, month) => M.teachers.churnTeachersOf(view, studentId, subject, month),
    zeroIdsOf: (subject, month) => M.teachers.churnZeroIds(view, subject, month),
  };
}

// ── server/exit-overlay-loaders.ts ──────────────────────────────────────────────────────────────────────────────────────

async function loadCurrentHolds(sql, t, M, today) {
  const rows = await sql`select e.id::text id, e.student_id::text student_id, c.subject, c.class_name, c.teacher_id::text teacher_id, (c.id is not null) has_class,
      s.name, s.school, s.grade, s.status::text status, s.notes, (s.id is not null) has_student
    from public.enrollments e left join public.classes c on c.id = e.class_id left join public.students s on s.id = e.student_id
    where e.tenant_id=${t} and e.on_hold = true and e.start_date <= ${today}::date and (e.end_date is null or e.end_date >= ${today}::date) order by e.id`;
  const seen = new Set();
  return rows.flatMap(r => {
    if (!r.has_class || !r.subject || !r.has_student || M.merged.isMergedStudent(r.notes) || !['enrolled', 'on_hold'].includes(r.status)) return [];
    const k = `${r.student_id}|${r.subject}`;
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ key: k, subject: r.subject, name: r.name, schoolGrade: M.school.schoolGradeLabel(r.school, r.grade), className: r.class_name, teacherId: r.teacher_id }];
  });
}

async function teacherNames(sql, t, ids) {
  const out = new Map();
  for (const chunk of chunk100(ids)) {
    const rows = await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${chunk}::uuid[]) and system_role::text <> 'student'`;
    for (const r of rows) if (r.display_name) out.set(r.id, r.display_name);
  }
  return out;
}

// ── server/exit-overlay.ts getExitOverlay · exit-overlay-actions.ts loadExitOverlay ─────────────────────────────────────

export const EXIT_OVERLAY_MAX_BACK = 24;

async function getExitOverlay(sql, t, M, operations, subject, anchor) {
  const today = M.dk.kstToday(), thisMonth = M.dk.kstMonth();
  const monthKeys = [anchor, M.dk.shiftMonth(anchor, -1), M.dk.shiftMonth(anchor, -2)];
  const windows = monthKeys.map(m => M.win.withdrawalMonthWindow(m, today));
  const from = windows[2].from, to = windows[0].to;
  const live = anchor === thisMonth;
  const [withdrawn, subjectEnded, judge, holdRows] = await Promise.all([
    getWithdrawalsInWindow(sql, t, M, from, to),
    getSubjectEndedStudents(sql, t, M, { from, to }, today),
    loadExitTeacherJudge(sql, t, M, { from: M.dk.monthRange(M.dk.shiftMonth(anchor, -7)).from, end: M.dk.monthRange(thisMonth).to }, { today, thisMonth }),
    live ? loadCurrentHolds(sql, t, M, today) : Promise.resolve([]),
  ]);
  const subjects = M.subjects.buildSubjectMaps(operations.subjects);
  const { source, owner, irregular } = judge;
  const endedOf = (studentId, date) => judge.endedOf(studentId, subject, date);
  const exits = [];
  for (const w of withdrawn) {
    if (M.bulk.isCleanupWithdrawal(w.memo)) continue;
    const c = w.exitClasses.find(x => x.subject === subject);
    if (!c) continue;
    const { endMonth, endReasons } = endedOf(w.id, w.withdrawnAt);
    exits.push({ row: { key: w.id, kind: 'withdrawn', name: w.name, schoolGrade: M.school.schoolGradeLabel(w.school, w.grade), date: w.withdrawnAt, reasonRaw: w.reason, memo: w.memo, endReasons }, studentId: w.id, endMonth });
  }
  for (const s of subjectEnded) {
    for (const d of s.endedDetail) {
      const date = d.endedAt?.slice(0, 10);
      if (d.subject !== subject || !date || date < from || date > to) continue;
      const { endMonth, endReasons } = endedOf(s.id, date);
      exits.push({
        row: { key: `${s.id}|${d.subject}`, kind: 'subject-ended', name: s.name, schoolGrade: M.school.schoolGradeLabel(s.school, s.grade), date, reasonRaw: d.reason, memo: null,
          keepSubjects: s.activeSubjects.map(k => subjects.labelOf(k)), endReasons },
        studentId: s.id, endMonth,
      });
    }
  }
  const rowTeacherIds = exits.map(e => judge.teachersOf(e.studentId, subject, e.endMonth));
  const zeroIds = monthKeys.map(m => judge.zeroIdsOf(subject, m));
  const subjectClasses = source.classes.filter(c => c.subject === subject)
    .map(c => ({ id: c.id, teacherId: c.teacher_id, active: c.is_active, closedOn: c.closed_at, special: irregular.has(c.id), src: c }));
  const currentIds = M.teachers.currentHomeroomIds(subjectClasses, (c, day) => owner(c.src, day), today);
  const holdsHere = holdRows.filter(h => h.subject === subject);
  const names = await teacherNames(sql, t, [...new Set([...rowTeacherIds.flat(), ...zeroIds.flat(), ...currentIds, ...holdsHere.flatMap(h => (h.teacherId ? [h.teacherId] : []))])]);
  const nameOf = id => (id ? (names.get(id) ?? null) : null);
  const withTeacher = exits.map((e, i) => ({ ...e.row, teachers: rowTeacherIds[i].flatMap(id => nameOf(id) ?? []), counted: rowTeacherIds[i].length > 0 }));
  const holds = holdsHere.map(h => ({ ...h, teacher: nameOf(h.teacherId) }));
  const months = monthKeys.map((month, i) => M.model.buildOverlayMonth({ month, today, exits: withTeacher, zeroTeachers: zeroIds[i].flatMap(id => nameOf(id) ?? []), holds: i === 0 && live ? holds : null, rules: source.options }));
  const others = [...withTeacher.flatMap(e => e.teachers), ...months.flatMap(m => m.zero), ...holds.flatMap(h => (h.teacher ? [h.teacher] : []))];
  const params = new URLSearchParams({ range: 'custom', from, to, subject });
  return {
    subjectLabel: subjects.labelOf(subject), anchor, months,
    tints: M.teachers.teacherTints(currentIds.flatMap(id => nameOf(id) ?? []), others),
    canNewer: anchor < thisMonth, canOlder: anchor > M.dk.shiftMonth(thisMonth, -EXIT_OVERLAY_MAX_BACK),
    withdrawalsHref: `/withdrawals?${params.toString()}`, rulesNote: M.model.exclusionNote(source.options),
  };
}

/** 2.0 loadExitOverlay({ subject, anchor }) — 화면 주인(원장)은 퇴원관리를 볼 수 있다(2.0 showExitOverlay와 같은 게이트를 지난 사람). */
export async function loadExitOverlay(sql, t, importV2, operations, input) {
  const M = await loadExitModules(importV2);
  if (!operations.subjects.some(s => s.key === input.subject)) return { ok: false, error: '과목을 찾을 수 없습니다' };
  const thisMonth = M.dk.kstMonth();
  const anchor = M.dk.isValidYm(input.anchor) ? input.anchor : thisMonth;
  if (anchor > thisMonth || anchor < M.dk.shiftMonth(thisMonth, -EXIT_OVERLAY_MAX_BACK)) return { ok: false, error: '볼 수 없는 달입니다' };
  try {
    return { ok: true, data: await getExitOverlay(sql, t, M, operations, input.subject, anchor) };
  } catch (e) {
    console.error(`withdrawals.exit-overlay: ${e?.code || ''} ${e?.message || ''}`);
    return { ok: false, error: '퇴원 목록을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.' };
  }
}
