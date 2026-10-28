// 2.0 화면 — 퇴원관리(목록 · 분석 카드 · 퇴원 상세) (V2-SCREENS.md `withdrawals`, 처리 화면 세션 R).
// 그리기는 2.0의 실제 React 부품(v2-host/src/withdrawals*.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 같은 결과로:
//  · 목록 = page.tsx가 서버에서 받던 재료 — getWithdrawnStudents · getSubjectEndedStudents({ withNotes }) · getTenantSettings ·
//    loadWithdrawalTrendPrefs · loadExitTeacherJudge(→ attributeTeachers · teacherNames). 같은 표·같은 조건을 SQL로, 판정·조립은
//    2.0 순수 함수(importV2) 그대로. 필터·카드·쪽 나누기는 호스트가 page.tsx와 같은 함수·같은 순서로 한다.
//  · 상세 = [studentId]/page.tsx — getWithdrawalDetail · loadStudentReportRecords · loadLinkedConsultations · 권한 판정 넷.
//  · 보는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 2.0 requireAccess('withdrawals')와 같은 메뉴 키(readPeople).
//  · 2.0은 사용자 클라이언트(RLS)로 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
//  · 저장 = 2.0 server/actions.ts 셋(updateWithdrawalReason · toggleConsultationStep · reactivateStudent) + trend-prefs-actions.ts
//    saveWithdrawalTrendPrefs + 수강 이력 날짜 칸(enrollments/server/actions.ts updateEnrollmentDates — 수업목록 저장을 그대로 씀).
//    학생·수강 쓰기는 2.0처럼 고른 사람의 신분(authenticated + jwt)으로 — RLS·원생 상태 가드가 2.0과 같게 본다.
//  · 담당 선생님 판정 재료(loadChurnSource · loadExitTeacherJudge)는 v2-timetable-exit.mjs와 같은 본문(그 파일이 내보내지 않아 옮겼다).
import { V2Error } from './v2-screens.mjs';
import { UUID, VIA, audit, readPeople, requireActor } from './v2-proc-people.mjs';
import { deepMerge, normalizeSubjects } from './v2-screen-timetable.mjs';
import { loadRules as reportRules } from './v2-screen-withdrawal-reports.mjs';
import { loadRules as classesRules } from './v2-screen-classes.mjs';
import { loadExtra, asAuthenticated } from './v2-timetable-save.mjs';
import { classesActions } from './v2-classes-save.mjs';

const ID = 'withdrawals', MENU = 'withdrawals';
const ACTIONS_MODULE = 'features/withdrawals/server/actions.ts', PREFS_MODULE = 'features/withdrawals/server/trend-prefs-actions.ts';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const at = p => importV2(p);
    const [win, rows, bulk, types, reasonDetail, subjectEnded, merged, breakdown, prefs, special, dk, modules, preset, subjects, reasonKey, teachers,
      churnModel, context, students, evalConfig, dates, license, consultSubject, boardStages, dateAccess] = await Promise.all([
      'features/withdrawals/window.ts', 'features/withdrawals/exit-rows.ts', 'features/withdrawals/system-bulk.ts', 'features/withdrawals/types.ts',
      'features/withdrawals/reason-detail.ts', 'features/withdrawals/subject-ended.ts', 'features/students/status/merged.ts', 'features/withdrawals/breakdown.ts',
      'features/withdrawals/trend-prefs.ts', 'features/classes/special-lecture.ts', 'lib/date-kst.ts', 'lib/modules.ts', 'features/owner/preset.ts',
      'features/owner/subjects.ts', 'features/withdrawals/reason-key.ts', 'features/withdrawals/exit-overlay-teachers.ts',
      'features/teacher-portfolio/model/churn-model.ts', 'features/teacher-portfolio/model/context.ts', 'features/teacher-portfolio/model/students.ts',
      'features/teacher-portfolio/evaluation/config.ts', 'features/teacher-portfolio/model/dates.ts', 'lib/license/rule.ts',
      'features/enrollment/consult-subject.ts', 'features/enrollment/board-stages.ts', 'features/enrollments/date-access.ts',
    ].map(at));
    return { win, rows, bulk, types, reasonDetail, subjectEnded, merged, breakdown, prefs, special, dk, modules, preset, subjects, reasonKey, teachers,
      churnModel, context, students, evalConfig, dates, license, consultSubject, boardStages, dateAccess };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const chunk100 = list => { const out = []; for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100)); return out; };
const one = v => (Array.isArray(v) ? (v[0] ?? null) : v);
const iso = col => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`;

/** 학원 설정 — 2.0 getTenantSettings → resolveSettings의 운영·모듈 칸(시간표·수업목록 화면과 같은 병합). */
function settingsOf(L, stored) {
  const base = L.preset.baseSettingsFor(L.preset.presetOfStored(stored));
  const operations = deepMerge(base.operations, plain(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, plain(stored) ? stored.modules : undefined);
  return { operations: { ...operations, subjects: normalizeSubjects(operations.subjects, base) }, modules: { disabled: L.modules.normalizeDisabledModules(mods.disabled) } };
}

// ── server/queries.ts getWithdrawnStudents ─────────────────────────────────────────────────────────────────────────────
/** parseMetadata — 사유가 없으면 통째로 null(2.0 그대로). */
function parseMetadata(L, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const reason = L.types.normalizeReason(raw.reason);
  if (!reason) return null;
  return {
    reason,
    ...(L.reasonDetail.detailFor(reason, typeof raw.detail === 'string' ? raw.detail : null) ? { detail: raw.detail } : {}),
    memo: raw.memo ?? null,
    consultation: { adminCalledParent: !!raw.consultation?.adminCalledParent, teacherCalledParent: !!raw.consultation?.teacherCalledParent, talkedWithStudent: !!raw.consultation?.talkedWithStudent },
  };
}
async function loadEndedEnrollments(sql, t, studentIds) {
  const out = [];
  for (const ids of chunk100(studentIds)) {
    out.push(...await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.withdrawal_reason, case when c.id is null then null else json_build_object('class_name', c.class_name, 'subject', c.subject, 'english_track', c.english_track) end "class"
      from public.enrollments e left join public.classes c on c.id = e.class_id
      where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) and e.end_date is not null order by e.id`);
  }
  return out;
}
const lastClassOf = row => { const k = row ? (one(row.class) ?? undefined) : undefined; return { className: k?.class_name ?? null, subject: k?.subject ?? null, englishTrack: k?.english_track ?? null, reason: row?.withdrawal_reason ?? null }; };

async function getWithdrawnStudents(sql, t, L) {
  const rows = await sql`select id::text id, name, school, grade, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, withdrawal_metadata, notes
    from public.students where tenant_id=${t} and status::text='withdrawn' order by withdrawn_at desc nulls first, id`;
  const students = rows.filter(s => !L.merged.isMergedStudent(s.notes));
  if (!students.length) return [];
  const ended = await loadEndedEnrollments(sql, t, students.map(s => s.id));
  const last = L.win.lastEndedByStudent(ended), byStudent = new Map();
  for (const e of ended) { const list = byStudent.get(e.student_id) ?? []; list.push({ endDate: e.end_date, subject: lastClassOf(e).subject }); byStudent.set(e.student_id, list); }
  return students.filter(s => !L.bulk.isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: last.has(s.id) })).map(s => {
    const lastRow = last.get(s.id), k = lastClassOf(lastRow), md = parseMetadata(L, s.withdrawal_metadata), hasEnrollmentHistory = !!lastRow;
    const rawMemo = s.withdrawal_metadata?.memo;
    return {
      id: s.id, name: s.name, school: s.school, grade: s.grade, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at,
      lastClassName: k.className, lastClassSubject: k.subject, lastClassEnglishTrack: k.englishTrack,
      withdrawalReason: md?.reason ? L.types.REASON_LABEL[md.reason] : k.reason, metadata: md, hasEnrollmentHistory,
      systemBulk: L.bulk.isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory }),
      exitSubjects: L.win.withdrawalSubjects(byStudent.get(s.id) ?? []),
      memoText: typeof rawMemo === 'string' && rawMemo.trim() ? rawMemo.trim() : null,
      cleanup: L.bulk.isCleanupExit(s.withdrawal_metadata),
    };
  });
}

// ── server/queries.ts getSubjectEndedStudents({ withNotes: true }) ─────────────────────────────────────────────────────
async function getSubjectEndedStudents(sql, t, L, today) {
  const students = await sql`select id::text id, name, school, grade, status::text status from public.students where tenant_id=${t} and status::text in ('enrolled','on_hold') order by id`;
  if (!students.length) return [];
  const enrollments = [];
  for (const ids of chunk100(students.map(s => s.id))) {
    enrollments.push(...await sql`select e.id::text id, e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.withdrawal_reason, e.withdrawal_detail, e.withdrawal_memo,
        case when c.id is null then null else json_build_object('subject', c.subject, 'class_name', c.class_name, 'english_track', c.english_track, 'is_special', c.is_special) end "class"
      from public.enrollments e left join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) order by e.id`);
  }
  const notes = new Map(enrollments.map(e => [e.id, e]));
  const bySt = new Map();
  for (const e of enrollments) {
    const k = one(e.class) ?? undefined;
    if (!k?.subject) continue;
    const arr = bySt.get(e.student_id) ?? [];
    arr.push({ id: e.id, classId: e.class_id, subject: k.subject, startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred ?? undefined,
      isSpecial: L.special.isSpecialLecture({ isSpecial: k.is_special, className: k.class_name }), className: k.class_name ?? null, englishTrack: k.english_track ?? null, reason: e.withdrawal_reason ?? null });
    bySt.set(e.student_id, arr);
  }
  const out = [];
  for (const s of students) {
    const all = bySt.get(s.id) ?? [], enr = all.filter(e => L.subjectEnded.countsForSubjectExit(e, today));
    const lastEndOf = subject => all.reduce((m, e) => (e.subject === subject && e.endDate && (!m || e.endDate > m) ? e.endDate : m), null);
    const { ended, active } = L.subjectEnded.getEndedSubjects(enr, today);
    if (!ended.length) continue;
    let lastEndedAt = null;
    for (const subject of ended) { const d = lastEndOf(subject); if (d && (!lastEndedAt || d > lastEndedAt)) lastEndedAt = d; }
    const endedDetail = ended.map(subject => {
      const best = L.win.pickLastEnded(enr.filter(e => e.subject === subject).map(e => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred })));
      const n = best ? notes.get(best.id) : undefined;
      return { subject, endedAt: lastEndOf(subject) ?? best?.endDate ?? null, className: best?.className ?? null, englishTrack: best?.englishTrack ?? null,
        reason: best?.reason ?? null, enrollmentId: best?.id, isTransferred: best?.isTransferred === true,
        detail: n ? L.reasonDetail.detailFor(best.reason, n.withdrawal_detail) : null, memo: n?.withdrawal_memo?.trim() || null };
    });
    out.push({ id: s.id, name: s.name, school: s.school, grade: s.grade, status: s.status, endedSubjects: ended, activeSubjects: active, lastEndedAt, endedDetail });
  }
  return out.sort((a, b) => (b.lastEndedAt ?? '').localeCompare(a.lastEndedAt ?? ''));
}

// ── teacher-portfolio/server/churn-source.ts · withdrawals/server/exit-teacher-judge.ts (v2-timetable-exit.mjs와 같은 본문) ──
const CLASS_COLUMNS = sql => sql`id::text id, class_name, subject, english_track, teacher_id::text teacher_id, is_active, closed_at::text closed_at, report_optout, is_makeup_pool, is_special`;
const SCHEDULE_COLUMNS = sql => sql`id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, teacher_id::text teacher_id,
  slot_teacher_label, lab_separate, valid_from::text valid_from, valid_to::text valid_to`;
const ENROLLMENT_COLUMNS = sql => sql`id::text id, student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold,
  attendance_days, is_transferred, is_transferred_in, withdrawal_reason`;
async function loadChurnSource(sql, t, L, { from, end }) {
  const tableExists = async name => !!(await sql`select to_regclass(${`public.${name}`}) r`)[0].r;
  const [testRows, classes, liveSchedules, endedSchedules, enrollments, transitions, futureEnrollments, studentReasons, evaluation] = await Promise.all([
    sql`select id::text id, is_test, notes from public.students where tenant_id=${t} and (is_test = true or notes like ${`${L.merged.MERGE_NOTE_PREFIX}%`}) order by id`,
    sql`select ${CLASS_COLUMNS(sql)} from public.classes where tenant_id=${t} order by id`,
    sql`select ${SCHEDULE_COLUMNS(sql)} from public.class_schedules where tenant_id=${t} and valid_from <= ${end}::date and valid_to is null order by id`,
    sql`select ${SCHEDULE_COLUMNS(sql)} from public.class_schedules where tenant_id=${t} and valid_from <= ${end}::date and valid_to >= ${from}::date order by id`,
    sql`select ${ENROLLMENT_COLUMNS(sql)} from public.enrollments where tenant_id=${t} and start_date <= ${end}::date and (end_date is null or end_date >= ${from}::date) order by id`,
    sql`select target_label, ${sql.unsafe(iso('created_at'))} created_at, metadata->>'classId' class_id, metadata->>'newTeacherId' teacher_id,
        metadata->>'previousTeacherId' previous_teacher_id, metadata->>'effectiveDate' effective_date
      from public.audit_logs where tenant_id=${t} and action in ('class_handover_apply', 'class_update') and metadata->>'newTeacherId' is not null order by created_at, id`,
    sql`select ${ENROLLMENT_COLUMNS(sql)} from public.enrollments where tenant_id=${t} and start_date > ${end}::date and start_date <= ${L.dk.addDays(end, 31)}::date order by id`,
    sql`select id::text id, withdrawal_metadata->>'reason' reason, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and withdrawal_metadata is not null order by id`,
    tableExists('teacher_evaluation_settings').then(ok => (ok ? sql`select config from public.teacher_evaluation_settings where tenant_id=${t}` : [])),
  ]);
  const test = new Set(testRows.filter(s => s.is_test || L.merged.isMergedStudent(s.notes)).map(s => s.id));
  const real = list => list.filter(e => !test.has(e.student_id));
  const config = evaluation[0] ? L.evalConfig.resolveEvaluationConfig(evaluation[0].config) : L.evalConfig.DEFAULT_EVALUATION_CONFIG;
  const toTransitions = list => list.flatMap(x => {
    const date = x.effective_date?.slice(0, 10) || L.dates.kstDateOf(x.created_at);
    return x.teacher_id && date ? [{ class_id: x.class_id, target_label: x.target_label, teacher_id: x.teacher_id, previous_teacher_id: x.previous_teacher_id, date }] : [];
  });
  const byId = (...lists) => [...new Map(lists.flat().map(row => [row.id, row])).values()];
  return { from, end, classes, schedules: byId(liveSchedules, endedSchedules), enrollments: real(enrollments), transitions: toTransitions(transitions),
    futureEnrollments: real(futureEnrollments), studentReasons, options: config.metrics.churn.churn ?? L.evalConfig.DEFAULT_CHURN_OPTIONS };
}
async function loadExitTeacherJudge(sql, t, L, range, clock) {
  const source = await loadChurnSource(sql, t, L, range);
  const owner = L.context.buildHomeroomOwner(source.classes, source.transitions);
  const tracking = L.students.buildStudentTracking({ from: source.from, end: source.end, classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner });
  const churn = L.churnModel.buildChurnModel({ source: tracking.churnSource, classes: source.classes, options: source.options, futureEnrollments: source.futureEnrollments, studentReasons: source.studentReasons });
  const months = new Map();
  const view = { get(m) {
    if (m > clock.thisMonth) return undefined;
    let v = months.get(m);
    if (!v) {
      const w0 = L.win.withdrawalMonthWindow(m, clock.today), w = { start: w0.from, end: w0.to }, eligible = churn.eligibleSubjects(w);
      v = { eligible, detail: new Map([...eligible.keys()].map(id => [id, churn.exits(id, w)])) };
      months.set(m, v);
    }
    return v;
  } };
  const irregular = new Set(source.classes.filter(c => c.is_makeup_pool || L.special.isSpecialLecture({ isSpecial: c.is_special, className: c.class_name })).map(c => c.id));
  const classRefs = new Map(source.classes.map(c => [c.id, { closedAt: c.closed_at, regular: !irregular.has(c.id), subject: c.subject }]));
  const classOf = id => classRefs.get(id), endedRows = new Map();
  for (const e of source.enrollments) {
    const subject = classOf(e.class_id)?.subject;
    if (!e.end_date || !subject) continue;
    const bySubject = endedRows.get(subject) ?? new Map();
    endedRows.set(subject, bySubject);
    bySubject.set(e.student_id, [...(bySubject.get(e.student_id) ?? []), { classId: e.class_id, startDate: e.start_date, endDate: e.end_date, reason: e.withdrawal_reason ?? null }]);
  }
  return {
    source,
    endedOf(studentId, subject, date) {
      const ended = L.reasonKey.endedWithExit(endedRows.get(subject)?.get(studentId) ?? [], date, classOf, L.teachers.OVERLAY_LOOKBACK_DAYS);
      return { endMonth: L.teachers.churnMonthOf(ended, date, classOf), endReasons: ended.map(r => r.reason) };
    },
    teachersOf: (studentId, subject, month) => L.teachers.churnTeachersOf(view, studentId, subject, month),
  };
}
/** teacherNames — 직원관리에 있는 사람만(학생 계정 제외 · 퇴사자 포함). */
async function teacherNames(sql, t, ids) {
  const out = {};
  for (const c of chunk100(ids)) for (const r of await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${c}::uuid[]) and system_role::text <> 'student'`) if (r.display_name) out[r.id] = r.display_name;
  return out;
}

// ── page.tsx 목록 ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function buildList(sql, t, L, u, settings, params) {
  const today = L.dk.kstToday(), thisMonth = L.dk.kstMonth();
  const type = L.rows.parseType(params.type), range = params.range ?? 'all';
  const monthKey = L.dk.isValidYm(params.month) ? params.month : thisMonth;
  const rangeWindow = L.rows.resolveRange(range, { today, month: L.win.withdrawalMonthWindow(monthKey, today), from: params.from, to: params.to });
  const judgeFloor = L.dk.shiftMonth(thisMonth, -26);
  const judgeFromMonth = rangeWindow.kind === 'all' ? judgeFloor : [judgeFloor, [rangeWindow.from.slice(0, 7), L.dk.shiftMonth(thisMonth, -11)].sort()[0]].sort()[1];
  const teacherPart = params.part === 'teacher';
  const [withdrawn, subjectEnded, [prefsRow]] = await Promise.all([
    getWithdrawnStudents(sql, t, L),
    type !== 'withdrawn' ? getSubjectEndedStudents(sql, t, L, today) : [],
    teacherPart ? [] : sql`select ui_prefs->'withdrawals' p from public.users where tenant_id=${t} and id=${u.id}`,
  ]);
  // 2.0은 담당 판정(무겁다)을 기다리지 않고 흘려받는다 — 여기도 목록 먼저, 판정은 같은 조건의 두 번째 요청(part=teacher)으로.
  if (!teacherPart) return { withdrawn, subjectEnded, settings, trendPrefs: L.prefs.parseWithdrawalTrendPrefs(prefsRow?.p), judgeFromMonth };
  // 담당 판정(loadExitTeacherJudge → attributeTeachers) — 2.0처럼 실패해도 화면은 산다(강사 카드 '못 불러옴' · 담당 칸 '—').
  let teacher = null;
  try {
    teacher = await sql.savepoint(async sp => {
      const judge = await loadExitTeacherJudge(sp, t, L, { from: L.dk.monthRange(L.dk.shiftMonth(judgeFromMonth, -5)).from, end: L.dk.monthRange(thisMonth).to }, { today, thisMonth });
      const all = L.rows.sortExitRows(L.rows.toExitRows(withdrawn, subjectEnded));
      const map = L.breakdown.attributeTeachers(all, judge, { from: `${judgeFromMonth}-01`, today });
      const entries = [...map].map(([key, per]) => [key, [...per]]);
      // 이름 = 칸에 선 선생님 + 고른 선생님(명단에 없어도 칩에 이름이 서게 — 2.0 namesFor).
      const ids = [...new Set([...entries.flatMap(([, per]) => per.flatMap(([, list]) => list)), ...(UUID.test(params.teacher ?? '') ? [params.teacher] : [])])];
      return { entries, names: await teacherNames(sp, t, ids), options: { excludeReasons: judge.source.options.excludeReasons, countEnded: judge.source.options.countEnded } };
    });
  } catch (e) { console.error(`withdrawals.teacherJudge: ${e?.code || ''} ${e?.message || ''}`); }
  return { teacher, judgeFromMonth };
}

// ── [studentId]/page.tsx 상세 ──────────────────────────────────────────────────────────────────────────────────────────
async function getWithdrawalDetail(sql, t, L, studentId) {
  const [[s], enrollments] = await Promise.all([
    sql`select id::text id, name, school, grade, status::text status, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, withdrawal_metadata,
      student_phone, parent_phone, parent_name from public.students where tenant_id=${t} and id=${studentId}`,
    sql`select e.id::text id, e.start_date::text start_date, e.end_date::text end_date, e.withdrawal_reason, c.id::text class_id, c.class_name, c.subject, u.display_name teacher_name
      from public.enrollments e left join public.classes c on c.id = e.class_id left join public.users u on u.id = c.teacher_id
      where e.tenant_id=${t} and e.student_id=${studentId} order by e.start_date desc, e.id`,
  ]);
  if (!s) return null;
  const history = enrollments.map(e => ({ id: e.id, classId: e.class_id ?? null, className: e.class_name ?? '?', subject: e.subject ?? '?', teacherName: e.teacher_name ?? null,
    startDate: e.start_date, endDate: e.end_date, reason: e.withdrawal_reason ?? null }));
  const lastEnded = history.find(h => h.endDate !== null), md = parseMetadata(L, s.withdrawal_metadata);
  return {
    id: s.id, name: s.name, school: s.school, grade: s.grade, enrolledAt: s.enrolled_at, withdrawnAt: s.withdrawn_at,
    lastClassName: lastEnded?.className ?? null, lastClassSubject: lastEnded?.subject ?? null,
    withdrawalReason: md?.reason ? L.types.REASON_LABEL[md.reason] : lastEnded?.reason ?? null, metadata: md,
    studentStatus: s.status ?? null, studentPhone: s.student_phone ?? null, parentPhone: s.parent_phone ?? null, parentName: s.parent_name ?? null,
    enrollmentHistory: history, hasEnrollmentHistory: history.length > 0,
    systemBulk: L.bulk.isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: history.length > 0 }),
  };
}
/** loadStudentReportRecords — 퇴원보고서 화면의 열람 규칙 그대로(reportViewer · canReadReport · canReadArchive). */
async function studentReportRecords(sql, t, people, u, studentId, importV2) {
  const level = people.level(u, 'withdrawal_reports');
  if (level === 'none') return { status: 'hidden' };
  const R = await reportRules(importV2);
  const teacherId = u.role === 'teacher' ? u.id : null, manage = !teacherId && R.canRequestReport(u.role), scope = people.staffScope(u);
  const canRead = r => (teacherId ? r.teacher_id === teacherId : u.role === 'master' || R.isParticipant(r, u.id));
  const [reports, archives] = await Promise.all([
    sql`select id::text id, student_id::text student_id, requested_by::text requested_by, teacher_id::text teacher_id, manager_id::text manager_id, director_id::text director_id,
        manager_ids::text[] manager_ids, director_ids::text[] director_ids, exit_kind::text exit_kind, subjects, effective_date::text effective_date, status::text status, group_id::text group_id, snapshot
      from public.withdrawal_reports where tenant_id=${t} and student_id=${studentId} ${teacherId ? sql`and teacher_id=${teacherId}` : sql``} order by created_at desc, id`,
    teacherId || manage ? sql`select id::text id, subject, exit_date::text exit_date, raw_exit_date, teacher_name, class_name, mapped_teacher_id::text mapped_teacher_id
        from public.withdrawal_report_archives where tenant_id=${t} and mapped_student_id=${studentId} ${teacherId ? sql`and mapped_teacher_id=${teacherId}` : sql``}
        order by exit_date desc nulls last, id` : [],
  ]);
  const canReadArchive = a => (teacherId ? a.mapped_teacher_id === teacherId : !scope || !a.subject || scope.includes(a.subject));
  return {
    status: 'ok', complete: u.role === 'master' && !teacherId && !scope,
    reports: reports.filter(canRead).map(r => ({ id: r.id, groupId: r.group_id ?? r.id, status: r.status, exitKind: r.exit_kind, subjects: r.subjects ?? [], effectiveDate: r.effective_date,
      teacherName: r.snapshot?.courses?.find(c => c.teacherId === r.teacher_id)?.teacherName ?? null, direct: R.isDirectReport(r) })),
    archives: archives.filter(canReadArchive).map(a => ({ id: a.id, subject: a.subject, exitDate: a.exit_date, rawExitDate: a.raw_exit_date, teacherName: a.teacher_name, className: a.class_name })),
  };
}
/** loadLinkedConsultations — 목적지(콜&상담) 권한 · 원생 상세 상담 탭과 같은 조회 · 칸반과 같은 상태(boardStatusOf + 배정 반 수). */
async function linkedConsultations(sql, t, L, people, u, studentId, subjects) {
  if (people.level(u, 'enrollment') === 'none') return { status: 'hidden' };
  // 날짜 = consulted_at ?? consultation_date ?? created_at — PostgREST가 내던 글자 모양(시각은 UTC '+00:00', 날짜는 'YYYY-MM-DD') 그대로.
  const rows = await sql`select id::text id, ${sql.unsafe(iso('consulted_at'))} consulted_at, consultation_date::text consultation_date, ${sql.unsafe(iso('created_at'))} created_at,
      subject, outcome::text outcome
    from public.enrollment_consultations where tenant_id=${t} and student_id=${studentId} order by created_at desc, id`;
  const today = L.dk.kstToday(), keysOf = L.consultSubject.consultClassKeysOf(subjects), counts = new Map();
  for (const s of [...new Set(rows.map(r => r.subject ?? ''))]) {
    const keys = keysOf(s || null);
    counts.set(s, keys?.length === 0 ? 0 : (await sql`select count(*)::int n from public.enrollments e join public.classes c on c.id = e.class_id
      where e.tenant_id=${t} and e.student_id=${studentId} and (e.end_date is null or e.end_date >= ${today}::date) ${keys ? sql`and c.subject = any(${[...keys]})` : sql``}`)[0].n);
  }
  const out = rows.map(r => ({ id: r.id, date: r.consulted_at ?? r.consultation_date ?? r.created_at ?? null, subject: r.subject,
    stage: L.boardStages.boardStatusOf({ outcome: r.outcome ?? '', assignedClassCount: counts.get(r.subject ?? '') ?? 0 }) }));
  out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { status: 'ok', rows: out };
}
async function buildDetail(sql, t, L, people, u, settings, studentId, importV2) {
  const [detail, reportRecords, consults] = await Promise.all([
    getWithdrawalDetail(sql, t, L, studentId),
    studentReportRecords(sql, t, people, u, studentId, importV2).catch(e => { console.error(`withdrawals.reportRecords: ${e?.message || ''}`); return { status: 'error' }; }),
    linkedConsultations(sql, t, L, people, u, studentId, settings.operations.subjects).catch(e => { console.error(`withdrawals.consults: ${e?.message || ''}`); return { status: 'error' }; }),
  ]);
  if (!detail) return { notFound: true };
  // getEnrollmentDateAccess — 원생·수업·퇴원 중 하나라도 열리고 원장이거나 '수강 날짜 수정' 지정 직원. 반 범위는 메뉴가 전체·열람이면 모든 반.
  const menus = ['students', 'classes', 'withdrawals'].map(m => people.level(u, m));
  const dateAllowed = menus.some(l => l !== 'none') && L.dateAccess.canEditEnrollmentDates({ id: u.id, systemRole: u.role }, false, people.settings.permissions?.specialAccess?.enrollmentDateEditorIds);
  const lv = people.level(u, MENU), canWrite = lv === 'full' || lv === 'scoped';
  return {
    detail, reportRecords, consults,
    dateAccess: dateAllowed ? { allowed: true, classIds: menus.some(l => l === 'full' || l === 'readonly') ? null : [] } : { allowed: false, classIds: [] },
    canWrite, canReactivate: canWrite && people.canManageStatus(u), canOpenStudent: people.level(u, 'students') !== 'none',
  };
}

const UUID_BODY = UUID.source.slice(1, -1);
const DETAIL = new RegExp(`^/withdrawals/(${UUID_BODY})$`, 'i');
async function load({ sql, params, tenantId: t, importV2 }) {
  const [L, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const u = people.pick(params.actor), editors = people.editorList;
  if (!u) return { notAllowed: true, editors };
  const settings = settingsOf(L, people.settings.stored);
  const d = DETAIL.exec(params.v2path ?? '');
  if (params.part === 'teacher') return d ? { notFound: true } : await buildList(sql, t, L, u, settings, params);
  const base = { editors, viewer: { id: u.id, role: u.role }, settings };
  if (d) return { ...base, ...await buildDetail(sql, t, L, people, u, settings, d[1].toLowerCase(), importV2) };
  return { ...base, ...await buildList(sql, t, L, u, settings, params) };
}

// ── 저장(2.0 server/actions.ts · trend-prefs-actions.ts) ───────────────────────────────────────────────────────────────
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → get. */
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 50) throw bad();
  const pairs = v.$formData.map(p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[1].length > 20000) throw bad(); return p; });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null };
}
function call(raw, module, shape) {
  if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args)) throw bad();
  if (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw bad();
  return { actor: raw.actor ?? null, args: shape(raw.args) };
}
const formArgs = args => { if (args.length !== 2) throw bad(); return [null, formOf(args[1])]; };

async function writer({ sql, body, tenantId: t, importV2 }) {
  const [L, people] = await Promise.all([loadRules(importV2), readPeople(sql, t, importV2, MENU)]);
  const actor = requireActor(people, body.actor);
  const lv = people.level(actor, MENU);
  return { L, people, actor, canWrite: lv === 'full' || lv === 'scoped', P: people.P };
}
/** 2.0 사용자 클라이언트 쓰기 — 고른 사람의 신분(jwt) + authenticated 역할로 저장점 하나. 실패하면 그 저장점만 되돌리고 오류 모양을 돌려준다. */
async function asUser(sql, actor, fn) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  try { return { data: await asAuthenticated(sql, fn) }; }
  catch (e) {
    if (e instanceof V2Error) throw e;
    return { error: { code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null } };
  }
}
const why = (P, error, step, studentId) => P.dbError.explainDbError(error, { scope: `students.enrollmentSync.${step}`, context: { studentId },
  fallback: '수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message;
const CONSULTATION_KEYS = ['adminCalledParent', 'teacherCalledParent', 'talkedWithStudent'];

const actions = {
  updateWithdrawalReason: {
    validate: raw => call(raw, ACTIONS_MODULE, formArgs),
    async run(ctx) {
      const { L, P, actor, canWrite } = await writer(ctx), { sql, tenantId: t } = ctx, formData = ctx.body.args[1];
      if (!canWrite) return { error: '퇴원 관리 권한이 없습니다' };
      const studentId = String(formData.get('studentId') ?? '').trim(), reasonStr = String(formData.get('reason') ?? '').trim();
      const detailStr = String(formData.get('detail') ?? '').trim() || null, memo = String(formData.get('memo') ?? '').trim() || null;
      if (!studentId) return { error: '학생 ID가 누락되었습니다' };
      if (!L.types.WITHDRAWAL_REASONS.includes(reasonStr)) return { error: '유효한 퇴원 사유를 선택해주세요' };
      const checked = L.reasonDetail.checkReasonInput({ reason: reasonStr, detail: detailStr, memo });
      if (checked.error !== undefined) return { error: checked.error };
      const [cur] = UUID.test(studentId) ? await sql`select withdrawal_metadata, status::text status, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id=${studentId}` : [];
      if (!cur) return { error: '학생을 찾을 수 없습니다' };
      if (cur.status !== 'withdrawn') return { error: '퇴원 상태가 아닙니다' };
      const existing = cur.withdrawal_metadata ?? L.types.DEFAULT_WITHDRAWAL_METADATA;
      const { detail: _old, ...rest } = existing;
      const next = { ...rest, reason: reasonStr, ...(checked.detail ? { detail: checked.detail } : {}), memo,
        consultation: { adminCalledParent: !!existing.consultation?.adminCalledParent, teacherCalledParent: !!existing.consultation?.teacherCalledParent, talkedWithStudent: !!existing.consultation?.talkedWithStudent } };
      // syncWithdrawalEnrollmentReasons — 학생보다 먼저(2.0 순서).
      let count = 0;
      const from = L.reasonKey.reasonKeyOf(existing.reason);
      if (cur.withdrawn_at && from && from !== L.reasonKey.reasonKeyOf(reasonStr)) {
        const read = await asUser(sql, actor, s => s`select id::text id, withdrawal_reason from public.enrollments where tenant_id=${t} and student_id=${studentId} and end_date=${cur.withdrawn_at}::date and is_transferred = false`);
        if (read.error) return { error: why(P, read.error, 'reasonSyncRead', studentId) };
        const ids = read.data.filter(r => L.reasonKey.reasonKeyOf(r.withdrawal_reason) === from).map(r => r.id);
        if (ids.length) {
          const up = await asUser(sql, actor, s => s`update public.enrollments set withdrawal_reason=${reasonStr} where tenant_id=${t} and id = any(${ids}::uuid[])`);
          if (up.error) return { error: why(P, up.error, 'reasonSync', studentId) };
          count = ids.length;
        }
      }
      const res = await asUser(sql, actor, s => s`update public.students set withdrawal_metadata=${s.json(next)} where tenant_id=${t} and id=${studentId}`);
      if (res.error) return { error: res.error.message };
      await audit(sql, t, actor, 'withdrawal_update', 'student', null, { studentId, reason: reasonStr, ...(checked.detail !== undefined ? { detail: checked.detail } : {}), enrollments: count });
      return { ok: true };
    },
  },
  toggleConsultationStep: {
    validate: raw => call(raw, ACTIONS_MODULE, formArgs),
    async run(ctx) {
      const { L, P, actor, canWrite } = await writer(ctx), { sql, tenantId: t } = ctx, formData = ctx.body.args[1];
      if (!canWrite) return { error: '퇴원 관리 권한이 없습니다' };
      const studentId = String(formData.get('studentId') ?? '').trim(), step = String(formData.get('step') ?? '').trim(), next = String(formData.get('next') ?? 'false') === 'true';
      if (!studentId) return { error: '학생 ID가 누락되었습니다' };
      if (!CONSULTATION_KEYS.includes(step)) return { error: '유효한 상담 단계가 아닙니다' };
      const [cur] = UUID.test(studentId) ? await sql`select withdrawal_metadata, status::text status from public.students where tenant_id=${t} and id=${studentId}` : [];
      if (!cur) return { error: '학생을 찾을 수 없습니다' };
      if (cur.status !== 'withdrawn') return { error: '퇴원 상태가 아닙니다' };
      const existing = cur.withdrawal_metadata ?? L.types.DEFAULT_WITHDRAWAL_METADATA;
      const updated = { ...existing, reason: existing.reason ?? 'other', memo: existing.memo ?? null,
        consultation: { adminCalledParent: !!existing.consultation?.adminCalledParent, teacherCalledParent: !!existing.consultation?.teacherCalledParent, talkedWithStudent: !!existing.consultation?.talkedWithStudent, [step]: next } };
      const res = await asUser(sql, actor, s => s`update public.students set withdrawal_metadata=${s.json(updated)} where tenant_id=${t} and id=${studentId}`);
      if (res.error) { P.dbError.logDbError?.(res.error, 'withdrawals.toggleConsultationStep'); return { error: '상담 추적을 저장하지 못했습니다' }; }
      await audit(sql, t, actor, 'withdrawal_consultation_step', 'student', null, { studentId, step, done: next });
      return null;
    },
  },
  reactivateStudent: {
    validate: raw => call(raw, ACTIONS_MODULE, formArgs),
    async run(ctx) {
      const { L, P, people, actor, canWrite } = await writer(ctx), { sql, tenantId: t } = ctx, formData = ctx.body.args[1];
      if (!canWrite) return { error: '퇴원 관리 권한이 없습니다' };
      if (!people.canManageStatus(actor)) return { error: people.P.statusAccess.STUDENT_STATUS_DENIED };
      if (people.level(actor, 'students') !== 'full') return { error: '재원 복구 권한이 없습니다 — 원생 정보 변경 권한이 필요합니다' };
      const studentId = String(formData.get('studentId') ?? '').trim();
      if (!studentId) return { error: '학생 ID가 누락되었습니다' };
      // seatBlockReason — 학생 좌석 라이선스(조회 실패는 허용으로 둔다, 2.0 그대로).
      try {
        const seat = await sql.savepoint(async s => {
          const [row] = await s`select is_active, max_seats from public.tenant_licenses where tenant_id=${t} and feature='student_seats'`;
          const limit = L.license.seatLimitOf(row ?? null);
          if (limit === null) return null;
          const exclude = UUID.test(studentId) ? [studentId] : [];
          const [{ n }] = await s`select count(*)::int n from public.students where tenant_id=${t} and status='enrolled' ${exclude.length ? s`and id <> all(${exclude}::uuid[])` : s``}`;
          return L.license.seatsExceeded(limit, n, 1) ? L.license.seatBlockedMessage(limit, n) : null;
        });
        if (seat) return { error: seat };
      } catch (e) { console.error(`[license] 좌석 판정 예외 — 허용으로 둔다 ${e?.message || ''}`); }
      const [cur] = UUID.test(studentId) ? await sql`select status::text status, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id=${studentId}` : [];
      if (cur?.status !== 'withdrawn') return { error: '퇴원 상태가 아닙니다. 화면을 새로고침해 주세요.' };
      const withdrawnDate = cur.withdrawn_at ? cur.withdrawn_at.slice(0, 10) : null;
      const up = await asUser(sql, actor, s => s`update public.students set status='enrolled', withdrawn_at=null, withdrawal_metadata=null where tenant_id=${t} and id=${studentId}`);
      if (up.error) { P.dbError.logDbError?.(up.error, 'withdrawals.reactivateStudent'); return { error: '재원 복구에 실패했습니다. 잠시 후 다시 시도해 주세요.' }; }
      if (withdrawnDate) {
        const reopen = await asUser(sql, actor, s => s`update public.enrollments set end_date=null, withdrawal_reason=null, withdrawal_detail=null, withdrawal_memo=null, on_hold=false
          where tenant_id=${t} and student_id=${studentId} and end_date=${withdrawnDate}::date`);
        if (reopen.error) return { error: why(P, reopen.error, 'reopen', studentId) };
      }
      const hold = await asUser(sql, actor, s => s`update public.enrollments set on_hold=false where tenant_id=${t} and student_id=${studentId} and end_date is null`);
      if (hold.error) return { error: why(P, hold.error, 'clearOnHold', studentId) };
      await audit(sql, t, actor, 'student_restore', 'student', null, { studentId });
      return null;
    },
  },
  saveWithdrawalTrendPrefs: {
    validate: raw => call(raw, PREFS_MODULE, args => { if (args.length !== 1 || !plain(args[0])) throw bad(); return args; }),
    async run(ctx) {
      const { actor } = await writer(ctx), { sql, tenantId: t } = ctx, p = ctx.body.args[0], patch = {};
      if (typeof p.showTotal === 'boolean') patch.trend_total = p.showTotal ? undefined : 'off';
      if (p.kind === 'bar' || p.kind === 'line') patch.trend_kind = p.kind === 'line' ? 'line' : undefined;
      if (['subject', 'teacher', 'grade', 'school'].includes(p.axis)) patch.breakdown_axis = p.axis === 'subject' ? undefined : p.axis;
      if (!Object.keys(patch).length) return { ok: false, error: '잘못된 값입니다' };
      // patchMyUiPrefs('withdrawals', patch) — 형제 키 보존 · undefined면 그 키를 지운다 · 남은 키가 0개면 칸째 지운다. 감사로그 없음(2.0 그대로).
      const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${actor.id}`;
      const raw = plain(row?.ui_prefs) ? row.ui_prefs : {}, scope = plain(raw.withdrawals) ? { ...raw.withdrawals } : {};
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete scope[k]; else scope[k] = v; }
      const merged = { ...raw };
      if (Object.keys(scope).length === 0) delete merged.withdrawals; else merged.withdrawals = scope;
      await sql`update public.users set ui_prefs=${sql.json(merged)} where tenant_id=${t} and id=${actor.id}`;
      return { ok: true };
    },
  },
  // 수강 이력 날짜 칸(EditableDateCell) — 수업목록 화면과 같은 저장(2.0 enrollments/server/actions.ts updateEnrollmentDates).
  updateEnrollmentDates: classesActions(classesRules, loadExtra, { readSettings: () => { throw new Error('unused'); } }).updateEnrollmentDates,
};

export const screen = {
  id: ID, label: '퇴원관리', order: 41,
  params: {
    actor: UUID, v2path: new RegExp(`^/withdrawals(?:/${UUID_BODY})?$`, 'i'),
    type: /^[a-z-]{1,20}$/, range: /^[a-z0-9]{1,8}$/, month: /^\d{4}-\d{2}$/, from: /^\d{4}-\d{2}-\d{2}$/, to: /^\d{4}-\d{2}-\d{2}$/,
    reason: /^[^\u0000-\u001f]{1,300}$/, detail: /^[^\u0000-\u001f]{1,300}$/, q: /^[^\u0000-\u001f]{0,100}$/, subject: /^[a-z0-9_]{1,40}$/, program: /^[a-z_]{1,20}$/,
    consult: /^[a-z]{1,10}$/, early: /^[a-z0-9]{1,10}$/, grade: /^[^\u0000-\u001f]{1,300}$/, school: /^[^\u0000-\u001f]{1,300}$/, teacher: /^[^\u0000-\u001f]{1,300}$/,
    axis: /^[a-z]{1,10}$/, page: /^\d{1,4}$/, size: /^\d{1,3}$/, part: /^teacher$/,
  },
  actions,
  load,
};
export { loadRules, VIA };
