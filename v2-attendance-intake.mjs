// 2.0 화면 · 출석부 — 허브 학생 검색 · 학부모 결석 통보 접수(같은 이름·인자·반환 모양·표·감사로그).
//   server/hub-search-actions.ts searchAttendanceHubStudents({ query, month }) — 강사를 고르기 전 "이 학생 누구 반이지"(읽기만 · 2.0 loadHubStudentSearch)
//   intake/server/actions.ts searchIntakeStudents(query) · previewAbsenceIntake({ studentId, from, to }) — 읽기만
//                            recordAbsenceIntake({ studentId, from, to, reason, exclude? }) — 칸마다 출석부 칸 저장(setAttendanceCell 자리) 그대로:
//                            빈 칸 = 결석 + 사유(빈 칸일 때만 — 2.0 onlyIfEmpty) · 이미 결석 = 메모만 · 출석·지각·조퇴·보강 = 건너뜀(사유)
//                            → 그날 데스크 확인 큐 '처리됨'(recordFollowup — attendance_followups · attendance_followup)
//                            → 담당 강사 벨(notification_events 중복 막기 + notifications 행 — 2.0 notifyTeachersOfIntake)
// 바깥으로 나가는 것은 없다: 2.0도 인앱 벨뿐이고(웹 푸시 없음), 벨 행 뒤 슬랙 발송기 깨우기(pokeSlack)는 부르지 않는다(벨 행·감사로그까지만).
// 게이트(2.0과 같다): 검색·미리보기·접수 = 출결 '전체'(사무실 — canManageTenant) · 허브 검색 = 출결을 볼 수 있는 사람.
// 2.0과 다른 점: 허브 검색의 강사 렌즈 = 고른 사람이 '담당 반만' 권한이면 그 사람(2.0 effectiveTeacherId — 3.0엔 겸직 강사뷰 쿠키가 없다) ·
//   화면 언어는 늘 한국어 · 칸 저장 거절(V2Error)은 그 칸의 실패로 돌려준다(2.0 { error }와 같은 자리).
import { randomUUID } from 'node:crypto';
import { V2Error } from './v2-screens.mjs';

const MODULES = { intake: 'features/attendance/intake/absence-intake.ts', alert: 'features/attendance/intake/intake-alert.ts', href: 'app/(shell)/attendance/_components/att-href.ts', link: 'features/onescreen/makeup-absence-link.ts' };
let rules = null;
export function loadIntakeRules(importV2) {
  rules ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch(e => { rules = null; throw e; });
  return rules;
}
export const HUB_MODULE = 'features/attendance/server/hub-search-actions.ts', INTAKE_MODULE = 'features/attendance/intake/server/actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INTAKE_EVENT_TYPE = 'attendance_absence_intake', KEEP_STATUSES = new Set(['present', 'late', 'early_leave', 'makeup']);
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/** 사람이 비어 있어도 거절하지 않는다 — 부품이 결과 모양(r.hits · p.cells)을 그대로 읽어서, 각 함수가 2.0 빈 결과로 답한다. */
function call(raw, module, arity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > arity) throw bad();
  if (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw bad();
  return { actor: raw.actor ?? null, args: raw.args };
}
const text = (v, max) => { if (v === undefined || v === null) return ''; if (typeof v !== 'string' || v.length > max) throw bad(); return v; };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const hubBody = raw => { const { actor, args: [i] } = call(raw, HUB_MODULE, 1); if (!isObj(i)) throw bad(); return { actor, query: text(i.query, 200), month: text(i.month, 20) }; };
export const intakeSearchBody = raw => { const { actor, args: [q] } = call(raw, INTAKE_MODULE, 1); return { actor, query: text(q, 200) }; };
export const previewBody = raw => { const { actor, args: [i] } = call(raw, INTAKE_MODULE, 1); if (!isObj(i)) throw bad(); return { actor, studentId: text(i.studentId, 64), from: text(i.from, 20), to: text(i.to, 20) }; };
export function recordBody(raw) {
  const { actor, args: [i] } = call(raw, INTAKE_MODULE, 1);
  if (!isObj(i)) throw bad();
  if (i.exclude !== undefined && (!Array.isArray(i.exclude) || i.exclude.length > 500 || i.exclude.some(k => typeof k !== 'string' || k.length > 200))) throw bad();
  return { actor, studentId: text(i.studentId, 64), from: text(i.from, 20), to: text(i.to, 20), reason: text(i.reason, 2000), exclude: i.exclude ?? [] };
}

// ── 허브 학생 검색(2.0 loadHubStudentSearch) ──
/** c = { sql, t, R, settings, today, actor(출결 쓰기 직원 · 없으면 null), h: { readClassAxis, readTransitions } }. */
export async function searchAttendanceHubStudents(c, b) {
  const { sql, t, R, today } = c, H = R.hubSearch, lang = 'ko';
  const month = /^\d{4}-\d{2}$/.test(b.month) ? b.month : today.slice(0, 7);
  const monthLabel = R.i18n.sheetMonthLabel(month, `${Number(month.slice(5, 7))}월`, lang);
  const empty = (where, error) => ({ hits: [], truncated: false, limit: H.HUB_SEARCH_LIMIT, where, ...(error ? { error } : {}) });
  if (!c.actor) return empty(R.i18n.sheetTf(lang, 'att.search.scope.plain', { month: monthLabel }));
  const viewerTeacherId = c.actor.level === 'scoped' ? c.actor.id : null;
  const where = R.i18n.sheetTf(lang, viewerTeacherId ? 'att.search.scope.mine' : 'att.search.scope.all', { month: monthLabel });
  const pattern = H.hubSearchPattern(b.query);
  if (!pattern) return empty(where);
  const range = R.date.monthRange(month), asOf = H.hubEnrollmentAsOf(today, range.from, range.to);
  const all = await c.h.readClassAxis(sql, t, R, range.from, range.to, await c.h.readTransitions(sql, t, R));
  const classes = viewerTeacherId ? all.filter(x => x.taughtBy.includes(viewerTeacherId)) : all;
  const classIds = classes.map(x => x.id);
  if (classIds.length === 0) return empty(where);
  // 2.0과 같이 반 100개씩 · 청크마다 상한 + 1(더 있다는 표시).
  const rows = [];
  for (let i = 0; i < classIds.length; i += 100) {
    rows.push(...await sql`select e.class_id::text class_id, e.student_id::text student_id, e.attendance_days::text[] attendance_days, s.id::text sid, s.name, s.school, s.grade
      from public.enrollments e join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and e.class_id = any(${classIds.slice(i, i + 100)}::uuid[]) and e.on_hold = false and e.start_date <= ${asOf} and (e.end_date is null or e.end_date >= ${asOf})
        and s.name ilike ${pattern} order by e.id limit ${H.HUB_SEARCH_LIMIT + 1}`);
  }
  const enrollments = rows.filter(r => r.sid && r.name).map(r => ({ classId: r.class_id, studentId: r.sid, studentName: r.name, school: r.school ?? null, grade: r.grade ?? null, attendanceDays: r.attendance_days ?? null }));
  const matched = [...new Set(enrollments.map(e => e.classId))], classDows = new Map();
  if (matched.length > 0) {
    const keys = new Map();
    for (const s of await sql`select class_id::text class_id, day_of_week::text day_of_week from public.class_schedules where tenant_id=${t} and class_id = any(${matched}::uuid[])
      and valid_from <= ${range.to} and (valid_to is null or valid_to >= ${range.from}) order by id`) (keys.get(s.class_id) ?? keys.set(s.class_id, []).get(s.class_id)).push(s.day_of_week);
    for (const [id, k] of keys) classDows.set(id, R.cal.dowsFromKeys(k));
  }
  const { hits, truncated } = H.buildHubHits({ query: b.query, enrollments, classes: classes.map(x => ({ id: x.id, className: x.className, subject: x.subject, teacherId: x.teacherId, teacherName: x.teacherName })),
    schoolGradeOf: (school, grade) => R.school.schoolGradeLabel(school, grade), classDows, viewerTeacherId, limit: H.HUB_SEARCH_LIMIT, more: rows.length > H.HUB_SEARCH_LIMIT });
  return { hits, truncated, limit: H.HUB_SEARCH_LIMIT, where };
}

// ── 결석 통보 접수 ──
const EMPTY_SEARCH = { students: [], note: null, truncated: false };
/** 2.0 `searchIntakeStudents` — 재원 + 살아 있는 수강 ≥ 1(미래 시작 포함) · 비면 왜 비었는지 한 줄. c = { sql, t, R, I, today, actor }. */
export async function searchIntakeStudents(c, b) {
  const { sql, t, R, I } = c;
  if (c.actor?.level !== 'full') return EMPTY_SEARCH;
  const term = I.intake.intakeSearchTerm(b.query);
  if (!term) return EMPTY_SEARCH;
  const pattern = `%${term}%`;
  const rows = await sql`select id::text id, name, grade, school from public.students where tenant_id=${t} and status='enrolled' and name ilike ${pattern} order by name limit ${I.intake.INTAKE_SEARCH_SCAN}`;
  const live = rows.length === 0 ? [] : await sql`select distinct student_id::text student_id from public.enrollments where tenant_id=${t} and student_id = any(${rows.map(s => s.id)}::uuid[])
    and on_hold = false and (end_date is null or end_date >= ${c.today})`;
  const liveIds = new Set(live.map(e => e.student_id)), eligible = rows.filter(s => liveIds.has(s.id));
  const students = eligible.slice(0, I.intake.INTAKE_SEARCH_LIMIT).map(s => ({ id: s.id, name: s.name, label: R.school.schoolGradeLabel(s.school ?? null, s.grade ?? null) }));
  if (students.length > 0) return { students, note: null, truncated: eligible.length > I.intake.INTAKE_SEARCH_LIMIT || rows.length >= I.intake.INTAKE_SEARCH_SCAN };
  let reason = 'not_teaching';
  if (rows.length === 0) {
    const [{ others, everyone }] = await sql`select count(*) filter (where status <> 'withdrawn')::int others, count(*)::int everyone from public.students where tenant_id=${t} and name ilike ${pattern}`;
    reason = others > 0 ? 'not_teaching' : everyone > 0 ? 'withdrawn' : 'no_match';
  }
  return { students: [], note: I.intake.intakeSearchEmptyMessage(term, reason), truncated: false };
}

/** 2.0 `loadIntakePreview` — 그 기간 그 학생의 수업 칸(휴원일 제외 · 교시 축 과목은 교시마다) + 지금 기록 + 담당 표기. */
async function loadIntakePreview(c, input) {
  const { sql, t, R, I, settings } = c, A = I.intake;
  const EMPTY = { student: null, cells: [], error: null };
  if (!input.studentId) return EMPTY;
  if (!A.isYmd(input.from) || !A.isYmd(input.to)) return { ...EMPTY, error: '날짜를 확인해 주세요' };
  if (input.to < input.from) return { ...EMPTY, error: '종료일이 시작일보다 빠릅니다' };
  const dates = A.expandDateRange(input.from, input.to);
  if (dates.length === 0) return { ...EMPTY, error: `한 번에 접수할 수 있는 기간은 최대 ${A.INTAKE_MAX_RANGE_DAYS}일입니다` };
  const from = dates[0], to = dates.at(-1);
  const [stuRows, enrollRows] = UUID.test(input.studentId) ? await Promise.all([
    sql`select id::text id, name, school, grade from public.students where tenant_id=${t} and id=${input.studentId}`,
    sql`select class_id::text class_id, start_date::text start_date, end_date::text end_date, is_transferred, on_hold, attendance_days::text[] attendance_days from public.enrollments
      where tenant_id=${t} and student_id=${input.studentId} and (start_date is null or start_date <= ${to}) and (end_date is null or end_date >= ${from})`,
  ]) : [[], []];
  const s = stuRows[0];
  if (!s) return { ...EMPTY, error: '학생을 찾을 수 없습니다' };
  const student = { id: s.id, name: s.name, label: R.school.schoolGradeLabel(s.school ?? null, s.grade ?? null) };
  const live = enrollRows.filter(e => !e.on_hold), classIds = [...new Set(live.map(e => e.class_id))];
  if (classIds.length === 0) return { student, cells: [], error: null };
  const [classRows, slotRows, recordRows] = await Promise.all([
    sql`select id::text id, class_name, subject, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to, teacher_id::text teacher_id, slot_teacher_label
      from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and valid_from <= ${to} and (valid_to is null or valid_to >= ${from}) order by id`,
    sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status, note,
        to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
      from public.attendance_records where tenant_id=${t} and student_id=${input.studentId} and class_id = any(${classIds}::uuid[]) and session_date between ${from} and ${to} order by id`,
  ]);
  const classById = new Map(classRows.map(x => [x.id, x]));
  const teacherIds = [...new Set([...classRows.map(x => x.teacher_id), ...slotRows.map(x => x.teacher_id)].filter(Boolean))];
  const teacherName = new Map((teacherIds.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : []).map(u => [u.id, u.display_name]));
  const enrollments = live.map(e => { const cls = classById.get(e.class_id); return { classId: e.class_id, className: cls?.class_name ?? '(반 미상)', subject: cls?.subject ?? null,
    startDate: e.start_date ?? null, endDate: e.end_date ?? null, isTransferred: e.is_transferred === true, attendanceDays: e.attendance_days ?? null }; });
  const slots = slotRows.map(x => ({ classId: x.class_id, dayOfWeek: x.day_of_week, startTime: x.start_time, validFrom: x.valid_from, validTo: x.valid_to }));
  const axisByClass = new Map();
  for (const x of slotRows) (axisByClass.get(x.class_id) ?? axisByClass.set(x.class_id, []).get(x.class_id)).push({ dayOfWeek: x.day_of_week, startTime: x.start_time, teacherId: x.teacher_id,
    slotTeacherLabel: x.slot_teacher_label, validFrom: x.valid_from ?? '', validTo: x.valid_to });
  const teacherLabelFor = (classId, date, slotStart) => {
    const axisSlots = axisByClass.get(classId) ?? [];
    const axis = R.axis.resolveTaughtBy({ homeroomTeacherId: classById.get(classId)?.teacher_id ?? null, slots: axisSlots, date, slotStart });
    const seatLabel = axis.source === 'seat' ? (axisSlots.find(x => x.dayOfWeek === R.axis.axisDowOf(date) && R.axis.slotLiveOn(x, date)
      && (slotStart == null || R.axis.normalizeAxisTime(x.startTime) === R.axis.normalizeAxisTime(slotStart)) && R.axis.isSeatSlot(x))?.slotTeacherLabel ?? null) : null;
    return A.intakeTeacherLabel({ source: axis.source, teacherName: axis.teacherId ? (teacherName.get(axis.teacherId) ?? null) : null, seatLabel });
  };
  const holidays = new Set(Object.keys(R.cal.buildHolidayMap(settings.operations.holidays)));
  const cells = A.buildAbsenceCells({ dates, enrollments, slots, holidays });
  if (cells.length > A.INTAKE_MAX_CELLS) return { student, cells: [], error: `대상이 ${cells.length}칸으로 너무 많습니다 — 기간을 나눠 접수해 주세요(최대 ${A.INTAKE_MAX_CELLS}칸)` };
  const byKey = new Map();
  for (const r of R.effective.effectiveAttendanceRecords(recordRows)) byKey.set(`${r.class_id}|${r.session_date}|${A.hhmm(r.slot_start)}`, { status: r.status, note: r.note, slotStart: A.hhmm(r.slot_start) || null });
  return { student, error: null, cells: cells.map(x => ({ ...x, key: A.cellKey(x), teacherLabel: teacherLabelFor(x.classId, x.date, x.saveSlot),
    existing: byKey.get(`${x.classId}|${x.date}|${x.saveSlot ?? ''}`) ?? byKey.get(`${x.classId}|${x.date}|`) ?? null })) };
}

/** 2.0 `previewAbsenceIntake`. */
export async function previewAbsenceIntake(c, b) {
  if (c.actor?.level !== 'full') return { student: null, cells: [], error: c.actor ? '결석 접수 권한이 없습니다' : '로그인이 필요합니다' };
  return loadIntakePreview(c, b);
}

/** 2.0 onlyIfEmpty — 그 칸(교시 · 그날 전체)의 저장 대상 행이 이미 있으면 그 상태(쓰지 않는다). */
async function existingStatus(c, cell, studentId) {
  const rows = await c.sql`select id::text id, slot_start::text slot_start, status::text status from public.attendance_records where tenant_id=${c.t} and class_id=${cell.classId}
    and student_id=${studentId} and session_date=${cell.date} order by recorded_at desc, id desc`;
  const { updateIds, promoteIds } = c.R.saveTargets.pickSaveTargets(rows, cell.saveSlot ?? null), ids = new Set([...updateIds, ...promoteIds]);
  return rows.find(r => ids.has(r.id))?.status ?? null;
}
/** 출석부 칸 저장을 2.0 반환 모양으로 — 거절(V2Error)은 { error }(그 칸 실패) · 그 저장의 부분 쓰기는 savepoint가 되돌린다. */
async function cellResult(c, body) {
  try { return await c.sql.savepoint(sp => c.cellIn(sp, { actor: c.actor.id, units: undefined, scopeTeacherId: null, source: undefined, noteOnly: false, ...body })); }
  catch (e) { if (e instanceof V2Error) return { error: e.message }; throw e; }
}

/** 2.0 `recordAbsenceIntake` — c = { sql, t, R, I, L, settings, today, actor, cellIn, followup }. */
export async function recordAbsenceIntake(c, b) {
  const { sql, t, I } = c, A = I.intake;
  if (!c.actor) return { error: '로그인이 필요합니다' };
  if (c.actor.level !== 'full') return { error: '결석 접수 권한이 없습니다' };
  const reason = b.reason.trim().slice(0, A.INTAKE_MAX_REASON);
  if (!reason) return { error: '사유를 입력해 주세요 — 이 문장이 출석부 메모가 됩니다' };
  const memoLine = A.intakeMemo(reason);
  // 화면이 준 칸 목록은 믿지 않는다 — 같은 규칙으로 다시 계산하고 화면은 '빼기'만.
  const preview = await loadIntakePreview(c, { studentId: b.studentId, from: b.from, to: b.to });
  if (preview.error) return { error: preview.error };
  const student = preview.student;
  if (!student) return { error: '학생을 찾을 수 없습니다' };
  const excluded = new Set(b.exclude), targets = preview.cells.filter(x => !excluded.has(x.key));
  if (targets.length === 0) return { error: '접수할 수업이 없습니다 — 그 기간에 이 학생 수업이 없습니다' };
  let saved = 0, noted = 0;
  const skipped = [], failed = [], written = [];
  for (const cell of targets) {
    const where = { className: cell.className, date: cell.date }, existing = cell.existing;
    if (existing && KEEP_STATUSES.has(existing.status)) { skipped.push({ ...where, statusLabel: A.attendanceStatusLabel(existing.status) }); continue; }
    if (existing?.status === 'absent') {
      if (I.link.hasMemoLine(existing.note, memoLine)) { written.push({ ...where, classId: cell.classId }); continue; }
      const res = await cellResult(c, { studentId: b.studentId, classId: cell.classId, sessionDate: cell.date, status: null, noteOnly: true, note: I.link.appendMemo(existing.note, memoLine),
        slotStart: existing.slotStart, periodStart: cell.periodStart ?? null });
      if ('error' in res) { failed.push({ ...where, message: res.error }); continue; }
      noted += 1; written.push({ ...where, classId: cell.classId }); continue;
    }
    // 빈 칸 — 결석 + 사유. 미리보기와 저장 사이에 생긴 기록은 덮지 않는다(2.0 onlyIfEmpty → 건너뜀).
    const now = await existingStatus(c, cell, b.studentId);
    if (now) { skipped.push({ ...where, statusLabel: A.attendanceStatusLabel(now) }); continue; }
    const res = await cellResult(c, { studentId: b.studentId, classId: cell.classId, sessionDate: cell.date, status: 'absent', note: memoLine, slotStart: cell.saveSlot ?? null, periodStart: cell.periodStart ?? null });
    if ('error' in res) { failed.push({ ...where, message: res.error }); continue; }
    saved += 1; written.push({ ...where, classId: cell.classId });
  }
  if (written.length === 0) return { ok: true, saved, noted, skipped, failed, queueMarkFailed: false };
  // 그날 데스크 확인 큐에서 '처리됨' — 날짜마다 한 건(교시 없음).
  const firstClassOfDate = new Map();
  for (const w of written) if (!firstClassOfDate.has(w.date)) firstClassOfDate.set(w.date, w.classId);
  let queueMarkFailed = false;
  for (const [date, classId] of firstClassOfDate) {
    const fu = await c.followup({ studentId: b.studentId, classId, sessionDate: date, slotStart: null, signal: 'absent', state: 'resolved', outcome: 'absent_today', contactedVia: 'phone', note: reason, allowFuture: true });
    if ('error' in fu) queueMarkFailed = true;
  }
  // 담당 강사 벨 — 2.0 notifyTeachersOfIntake(인앱 벨 행만). 실패해도 접수는 성사(savepoint).
  try { await c.sql.savepoint(sp => notifyTeachersOfIntake({ ...c, sql: sp }, { studentId: b.studentId, studentName: student.name, cells: written, reason })); }
  catch (e) { console.error('[v2-attendance] 결석 접수 벨 실패 — 접수는 그대로', e?.message ?? e); }
  return { ok: true, saved, noted, skipped, failed, queueMarkFailed };
}

/** 2.0 `notifyTeachersOfIntake` — 그 반들을 가르치는 사람(담임 ∪ 교시 담당, 본인 제외)마다 자기 반 링크 · 같은 접수는 한 번(dedup bucket). */
async function notifyTeachersOfIntake(c, input) {
  const { sql, t, I, actor } = c;
  if (input.cells.length === 0) return;
  const classIds = [...new Set(input.cells.map(x => x.classId))], dates = [...new Set(input.cells.map(x => x.date))].sort();
  const [klasses, slots] = await Promise.all([
    sql`select id::text id, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select class_id::text class_id, teacher_id::text teacher_id from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and teacher_id is not null`,
  ]);
  const byTeacher = new Map(), add = (teacherId, classId) => { if (!teacherId || !classId || teacherId === actor.id) return; (byTeacher.get(teacherId) ?? byTeacher.set(teacherId, new Set()).get(teacherId)).add(classId); };
  for (const k of klasses) add(k.teacher_id, k.id);
  for (const s of slots) add(s.teacher_id, s.class_id);
  if (byTeacher.size === 0) return;
  const bucket = `intake|${dates[0]}~${dates.at(-1)}|${input.cells.length}`;
  const fresh = await sql`insert into public.notification_events (tenant_id, event_type, subject_key, bucket, seeded) values (${t}, ${INTAKE_EVENT_TYPE}, ${input.studentId}, ${bucket}, false)
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing returning bucket`;
  if (!fresh.length) return;
  const month = dates[0].slice(0, 7);
  const rows = [...byTeacher.entries()].map(([recipientId, own]) => {
    const mine = input.cells.filter(x => own.has(x.classId)), cells = mine.length > 0 ? mine : input.cells;
    const { title, body } = I.alert.buildIntakeAlert({ studentName: input.studentName, dates: [...new Set(cells.map(x => x.date))].sort(), classNames: cells.map(x => x.className), reason: input.reason, byName: actor.name ?? null });
    return { id: randomUUID(), tenant_id: t, recipient_id: recipientId, type: INTAKE_EVENT_TYPE, title, body: body ?? null, link: I.href.attHref({ classId: cells[0]?.classId ?? null, month, mode: 'class' }), actor_id: actor.id };
  });
  await sql`insert into public.notifications ${sql(rows)}`;
}
