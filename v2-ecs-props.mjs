// 2.0 화면 · 강사 시트(ECS) — 2.0 page.tsx(서버 부품)가 클라이언트 부품에 넘기는 props를 Docker 복사본에서 같은 모양으로.
//  · 반 목록 = 2.0 `getSheetLanding`(features/class-sheets/server/queries.ts)의 반환 그대로 → EcsLandingList·EcsTrackFilter·EcsTeacherFilter
//  · 주간 시트 = 2.0 `getClassSheetWeek`의 `ClassSheetWeekData` 그대로 → SheetClient(+ classOptions = 그 주 반 목록, textbookOptions)
//  · 월간 = 2.0 `getClassSheetMonth`의 `ClassSheetMonthData` + `getMonthPlanChrome` 그대로 → MonthClient
// 조회는 서버 전용 모듈(supabase·server-only)이라 불러올 수 없어서 같은 표·칸·조건을 SQL로 옮기고, 판정·조립은 2.0 순수 함수(importV2)를 그대로 쓴다.
// 2.0과 다른 것(이유):
//  · 보는 사람 = 3.0 띠에서 고른 직원(로그인이 없다). 그 사람의 권한·강사 스코프·보기 설정(users.ui_prefs.ecs)으로 2.0과 같이 판정한다.
//  · 10분 넘게 안 본 화면의 필터 되돌리기(freshRawUiPrefs — 브라우저 쿠키 기록)는 없다 — 저장된 필터를 그대로 읽는다.
//  · 수업 나누기(0351a)는 2.0에서 꺼 둔 기능이고 복사본에 행이 없다 — 나눔 없이 조립한다(verify가 0행을 잠근다).
//  · 자유 글(출결 사유·학생 특이사항·메모)의 연락처는 3.0 전 화면처럼 가린다(가린 칸은 저장이 덮지 않는다).
import { DAY, assistantClassIds, classAccess, copyDay, delegatedClassIds, isoAt, isoDay, readClassNameAsOf, readNames, roomOf, shown, teacherScopeOf } from './v2-ecs-core.mjs';

/** 2.0 `ecsVisibleClassFilter(weekMonday)` — 스코프가 없으면 전체(null). */
export async function visibleClassFilter(sql, t, R, viewer, weekMonday, today) {
  const scope = await teacherScopeOf(sql, t, viewer);
  if (!scope) return { classIds: null, hasScopeAnyWeek: true };
  const [week, any, delegated] = await Promise.all([assistantClassIds(sql, t, R, scope.teacherId, weekMonday), assistantClassIds(sql, t, R, scope.teacherId), delegatedClassIds(sql, t, R, scope.teacherId, today)]);
  return { classIds: [...new Set([...scope.classIds, ...week, ...delegated])], hasScopeAnyWeek: new Set([...scope.classIds, ...any, ...delegated]).size > 0 };
}

// ── 반 목록 — 2.0 getSheetLanding(weekParam) ─────────────────────────────────────────────────────────────
export async function landingData(sql, t, R, env, viewer, weekParam, today) {
  const level = viewer.levels.ecs;
  if (level === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const weekMonday = R.mondayOf(weekParam && DAY.test(weekParam) ? weekParam : today), weekSunday = R.shiftDays(weekMonday, 6);
  const base = { ok: true, weekMonday, weekLabel: R.weekLabel(weekMonday), today };
  if (env.skillAreas.length === 0) return { ...base, cards: [], emptyReason: 'not-configured', landingOrder: [], trackFilter: R.DEFAULT_ECS_ENGLISH_TRACK,
    trackCounts: { all: 0, eie: 0, injaewon: 0 }, teacherFilter: R.ECS_TEACHER_ALL, teacherOptions: [] };
  const allClasses = await sql`select id::text id, class_name, teacher_id::text teacher_id, english_track from public.classes
    where tenant_id=${t} and subject='english' and is_active and (closed_at is null or closed_at >= ${weekMonday}) order by class_name`;
  const prefs = viewer.uiPrefs;
  const landingOrder = R.readEcsLandingOrder(prefs);
  const trackFilter = R.isModuleEnabled(env.disabled, 'eie') ? R.readEcsEnglishTrack(prefs) : 'all';
  const storedTeacher = R.readEcsTeacher(prefs), allIds = allClasses.map(c => c.id);
  const scope = await teacherScopeOf(sql, t, viewer);
  const [{ classIds: visibleIds, hasScopeAnyWeek }, delegatedIds, teachers, nameIndex, schedules] = await Promise.all([
    visibleClassFilter(sql, t, R, viewer, weekMonday, today),
    delegatedClassIds(sql, t, R, scope?.teacherId ?? null, today),
    sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...new Set(allClasses.map(c => c.teacher_id).filter(Boolean))]}::uuid[])`,
    readClassNameAsOf(sql, t, R, today),
    allIds.length ? sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label
      from public.class_schedules where tenant_id=${t} and class_id = any(${allIds}::uuid[]) and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})` : [],
  ]);
  const scopeSet = visibleIds ? new Set(visibleIds) : null, delegatedSet = new Set(delegatedIds);
  const teacherName = new Map(teachers.map(u => [u.id, u.display_name]));
  const inScope = allClasses.filter(c => !scopeSet || scopeSet.has(c.id));
  const byClass = new Map(); for (const s of schedules) (byClass.get(s.class_id) ?? byClass.set(s.class_id, []).get(s.class_id)).push(s);
  const running = inScope.filter(c => R.hasLiveSlotInWeek(weekMonday, (byClass.get(c.id) ?? []).map(r => ({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }))));
  const trackCounts = { all: running.length, eie: R.keepEnglishTrack(running, 'eie').length, injaewon: R.keepEnglishTrack(running, 'injaewon').length };
  const tracked = R.keepEnglishTrack(running, trackFilter).map(c => ({ row: c, teacherId: c.teacher_id ?? null }));
  const teacherOptions = R.buildTeacherOptions(tracked, teacherName);
  const teacherFilter = R.resolveTeacherFilter(storedTeacher, teacherOptions);
  const classes = R.keepTeacher(tracked, teacherFilter).map(x => x.row), classIds = classes.map(c => c.id);
  const emptyOnlyThisWeek = inScope.length > 0 || (scopeSet !== null && hasScopeAnyWeek);
  if (!classIds.length) return { ...base, cards: [], trackFilter, landingOrder, trackCounts, teacherFilter, teacherOptions,
    emptyReason: running.length > 0 ? 'filtered' : emptyOnlyThisWeek ? 'no-week-classes' : scopeSet && allClasses.length > 0 ? 'no-scoped-classes' : 'no-classes' };
  const eieIds = classes.filter(c => R.readEnglishTrack({ english_track: c.english_track }) === 'eie').map(c => c.id);
  const [lines, flags] = await Promise.all([
    sql`select class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and plan_date between ${weekMonday} and ${weekSunday}`,
    eieIds.length ? sql`select class_id::text class_id, flag_date::text flag_date, slot_start::text slot_start from public.class_sheet_slot_flags
      where tenant_id=${t} and shouting and class_id = any(${eieIds}::uuid[]) and flag_date between ${weekMonday} and ${weekSunday}` : [],
  ]);
  const showSelfStudy = R.readEcsShowSelfStudy(prefs);
  const meaningful = new Map(), all = new Map(), shout = new Map();
  for (const l of lines) {
    const key = `${l.plan_date}|${R.normalizeSlotTime(l.slot_start)}`;
    (all.get(l.class_id) ?? all.set(l.class_id, new Set()).get(l.class_id)).add(key);
    if (R.isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.page_range, progress: l.progress, homework: l.homework })) (meaningful.get(l.class_id) ?? meaningful.set(l.class_id, new Set()).get(l.class_id)).add(key);
  }
  for (const f of flags) (shout.get(f.class_id) ?? shout.set(f.class_id, new Set()).get(f.class_id)).add(R.shoutingKey(f.flag_date.slice(0, 10), f.slot_start));
  const cards = classes.map(c => {
    const slotRows = (byClass.get(c.id) ?? []).map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, validFrom: s.valid_from, validTo: s.valid_to, slotTeacherLabel: s.slot_teacher_label }));
    const scheduled = R.scheduledSlotKeySet(weekMonday, slotRows, { includeSelfStudy: showSelfStudy, holidays: env.holidays });
    const holidayKeys = R.holidaySlotKeySet(weekMonday, slotRows, env.holidays, { includeSelfStudy: showSelfStudy });
    const mine = meaningful.get(c.id) ?? new Set(), every = all.get(c.id) ?? new Set(), counted = new Set(scheduled);
    for (const key of holidayKeys) if (mine.has(key)) counted.add(key);
    let filled = 0; for (const key of counted) if (mine.has(key)) filled += 1;
    const seatKeys = R.seatSlotKeySet(weekMonday, slotRows);
    let orphan = 0; for (const key of every) if (!scheduled.has(key) && !holidayKeys.has(key) && !seatKeys.has(key)) orphan += 1;
    const track = R.readEnglishTrack({ english_track: c.english_track });
    let shoutN = null;
    if (track === 'eie') { shoutN = 0; const keys = shout.get(c.id); if (keys) for (const key of counted) if (keys.has(key)) shoutN += 1; }
    const renamed = R.classNameForWeek(nameIndex, c.id, weekMonday, weekSunday, c.class_name, today);
    return { classId: c.id, className: renamed?.name ?? c.class_name, ...(renamed?.before ? { classNameBefore: renamed.before } : {}), ...(renamed?.upcoming ? { classNameUpcoming: renamed.upcoming } : {}),
      teacherId: c.teacher_id ?? null, teacherName: c.teacher_id ? (teacherName.get(c.teacher_id) ?? null) : null, englishTrack: track, totalSlots: counted.size, filledSlots: filled,
      orphanSlots: orphan, holidaySlots: holidayKeys.size, shoutingSlots: shoutN, delegated: delegatedSet.has(c.id) && c.teacher_id !== viewer.id };
  });
  return { ...base, cards, emptyReason: null, trackFilter, trackCounts, teacherFilter, teacherOptions, landingOrder };
}

/** 2.0 `[classId]/page.tsx`의 반 전환 옵션 — 랜딩 목록(같은 스코프·필터) + 목록에 없으면 지금 반을 맨 앞에. */
export const classOptionsOf = (landing, classId, className) => {
  const listed = landing.ok ? landing.cards.map(c => ({ id: c.classId, name: c.className })) : [];
  return listed.some(o => o.id === classId) ? listed : [{ id: classId, name: className }, ...listed];
};

/** 2.0 `loadEcsTextbookOptions` → `getTextbookOptions(tenantId, 'english')` — 교재 마스터 이름순 800개. */
export async function textbookOptions(sql, t) {
  return (await sql`select title, page_time from public.textbooks where tenant_id=${t} and subject='english' order by title limit 800`).map(r => ({ title: r.title, pageTime: r.page_time ?? null }));
}

// ── 주간 시트 — 2.0 getClassSheetWeek(classId, weekParam, { readOnly }) ────────────────────────────────────
export async function sheetWeekData(sql, t, R, env, viewer, classId, weekParam, opts = {}) {
  const gate = await classAccess(sql, t, R, env, viewer, classId, opts);
  if (!gate.ok) return gate;
  const access = gate.access, today = await copyDay(), names = await readNames(sql, t, R);
  const weekMonday = R.mondayOf(weekParam && DAY.test(weekParam) ? weekParam : today), weekSunday = R.shiftDays(weekMonday, 6), monthStart = `${weekMonday.slice(0, 7)}-01`;
  const floor = R.withdrawnFloorOf(weekMonday), prefs = viewer.uiPrefs;
  const [delegatedIds, schedules, enrollments, planLines, goals, marks, attendance, memos, flags, nameIndex] = await Promise.all([
    delegatedClassIds(sql, t, R, access.scope?.teacherId ?? null, today),
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})`,
    sql`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, e.withdrawal_reason,
        s.name, s.school, s.grade, s.english_name, s.withdrawn_at::text withdrawn_at
      from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${t} and e.class_id=${classId}
        and e.start_date <= ${weekSunday} and (e.end_date is null or e.end_date >= ${floor})`,
    sql`select * from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date between ${weekMonday} and ${weekSunday} order by plan_date, slot_start, term_mode, line_no`,
    sql`select scope::text scope, period_start::text period_start, role::text role, skill_area, textbook, target_progress from public.class_sheet_goals
      where tenant_id=${t} and class_id=${classId} and ((scope='week' and period_start=${weekMonday}) or (scope='month' and period_start=${monthStart}))`,
    sql`select * from public.class_sheet_student_marks where tenant_id=${t} and class_id=${classId} and mark_date between ${weekMonday} and ${weekSunday}`,
    sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status, note,
        session_units::float8 session_units, recorded_at from public.attendance_records where tenant_id=${t} and class_id=${classId} and session_date between ${weekMonday} and ${weekSunday}`,
    sql`select memo_key, body from public.class_sheet_memos where tenant_id=${t} and class_id=${classId} and week_start=${weekMonday}`,
    sql`select flag_date::text flag_date, slot_start::text slot_start, shouting from public.class_sheet_slot_flags where tenant_id=${t} and class_id=${classId} and flag_date between ${weekMonday} and ${weekSunday}`,
    readClassNameAsOf(sql, t, R, today),
  ]);
  const planRows = planLines.map(l => ({ id: String(l.id), planDate: isoDay(l.plan_date), slotStart: String(l.slot_start), termMode: l.term_mode, skillArea: l.skill_area, lineNo: Number(l.line_no),
    textbook: l.textbook ?? null, pageRange: l.page_range ?? null, progress: l.progress ?? null, homework: l.homework ?? null, updatedAt: isoAt(l.updated_at) }));
  const markRows = marks.map(m => ({ studentId: String(m.student_id), markDate: isoDay(m.mark_date), slotStart: String(m.slot_start), status: m.status ?? null, progressNote: m.progress_note ?? null,
    score: m.score ?? null, listeningLevel: m.listening_level ?? null, memorizedWords: m.memorized_words ?? null }));
  const eff = R.effectiveAttendanceRecords(attendance.map(a => ({ ...a, recorded_at: isoAt(a.recorded_at), slot_start: a.slot_start ?? null, note: a.note ?? null, session_units: a.session_units ?? null })));
  // 종강·전출 판정 재료 — 이 반 수강이 끝난 학생의 같은 과목 다른 반 수강(이 주에 이미 시작한 것만).
  const elsewhereSpans = {}, moved = new Set();
  const ended = [...new Set(enrollments.filter(e => e.end_date).map(e => e.student_id))];
  if (ended.length) {
    const others = await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, c.class_name, c.subject
      from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=${t} and e.class_id <> ${classId} and e.student_id = any(${ended}::uuid[])
        and e.start_date <= ${weekSunday} and (e.end_date is null or e.end_date >= ${floor}) and c.subject = ${access.subject} order by e.id`;
    const notWithdrawn = new Set(enrollments.filter(e => !e.withdrawn_at).map(e => e.student_id));
    for (const o of others) {
      (elsewhereSpans[o.student_id] ??= []).push({ start: o.start_date, end: o.end_date, isTransferred: o.is_transferred ?? undefined, classId: o.class_id, className: o.class_name, subject: o.subject });
      if (o.end_date == null && notWithdrawn.has(o.student_id)) moved.add(o.student_id);
    }
  }
  const showSelfStudy = R.readEcsShowSelfStudy(prefs);
  const scheduleRows = schedules.map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, validFrom: s.valid_from, validTo: s.valid_to ?? null,
    teacherId: s.teacher_id ?? null, slotTeacherLabel: R.resolveTeacherLabel(s.slot_teacher_label ?? null, names.labelMap), slotRoomLabel: roomOf(R, names, s) }));
  const grid = R.buildWeekGrid({
    weekMonday, schedules: scheduleRows,
    enrollments: enrollments.map(e => ({ studentId: e.student_id, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined,
      attendanceDays: e.attendance_days, withdrawnAt: e.withdrawn_at ?? null, withdrawalReason: e.withdrawal_reason ?? null })),
    planLines: planRows, marks: markRows, attendance: eff.map(a => ({ studentId: a.student_id, sessionDate: a.session_date, status: a.status })),
    slotMemoKeys: memos.map(m => m.memo_key).filter(k => k.startsWith('slot:')), includeSelfStudy: showSelfStudy,
    activeElsewhereSameSubject: [...moved], subject: access.subject, elsewhereSpans, holidays: env.holidays,
  });
  const students = {};
  for (const e of enrollments) students[e.student_id] = { name: e.name, school: e.school, grade: e.grade, englishName: e.english_name };
  const rosterIds = new Set(); for (const d of grid.days) for (const s of d.slots) for (const r of s.roster) rosterIds.add(r.studentId);
  for (const a of grid.attendanceOnly) for (const id of a.studentIds) rosterIds.add(id);
  const missing = [...rosterIds].filter(id => !students[id]);
  if (missing.length) for (const s of await sql`select id::text id, name, school, grade, english_name from public.students where tenant_id=${t} and id = any(${missing}::uuid[])`) students[s.id] = { name: s.name, school: s.school, grade: s.grade, englishName: s.english_name };
  const teacherIds = new Set(); for (const d of grid.days) for (const s of d.slots) if (s.teacherId) teacherIds.add(s.teacherId);
  if (access.teacherId) teacherIds.add(access.teacherId);
  const teacherNames = Object.fromEntries((teacherIds.size ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...teacherIds]}::uuid[])` : []).filter(u => u.display_name).map(u => [u.id, u.display_name]));
  // 출결 칸 — 권한 + 담당 반(담임 ∪ 그날 위임 ∪ 그날 교시 담당, 2.0 userTaughtClassSet) + 강사 7일 창.
  const attLevel = viewer.levels.attendance, attendanceWrite = attLevel === 'full' || attLevel === 'scoped';
  let classOk = true;
  if (attendanceWrite && attLevel === 'scoped') {
    const [{ ok }] = await sql`select (exists (select 1 from public.classes where tenant_id=${t} and id=${classId} and teacher_id=${viewer.id})
        or exists (select 1 from public.class_delegations where tenant_id=${t} and class_id=${classId} and delegate_user_id=${viewer.id} and revoked_at is null and from_date <= ${today} and to_date >= ${today})
        or exists (select 1 from public.class_schedules where tenant_id=${t} and class_id=${classId} and teacher_id=${viewer.id} and valid_from <= ${today} and (valid_to is null or valid_to >= ${today}))) ok`;
    classOk = ok;
  }
  const canNoteAttendance = attendanceWrite && classOk;
  const canMarkAttendanceByDate = Object.fromEntries(R.weekDatesOf(weekMonday).map(d => [d, canNoteAttendance && (attLevel !== 'scoped' || R.isWithinAttendanceEditWindow(d, today))]));
  const periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const tables = { weekday: R.tableToEntries(R.weekdayTableFor('english', periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const periodLabelBySlot = {};
  for (const d of grid.days) for (const s of d.slots) { const l = R.resolvePeriodLabel(s.slotStart, s.slotEnd, tables, R.isWeekendDow(d.dow)); if (l) periodLabelBySlot[`${d.date}|${s.slotStart}`] = l; }
  const unitsByDate = R.scheduledUnitsByDate(weekMonday, scheduleRows, access.englishTrack === 'eie' ? 'periods' : 'hours');
  const firstSlotByDate = {}; for (const d of grid.days) { const f = d.slots[0]?.slotStart; if (f) firstSlotByDate[d.date] = R.normalizeSlotTime(f); }
  const attendanceByStudentDate = {};
  for (const a of eff) {
    const raw = a.slot_start ?? null, cell = raw ? R.normalizeSlotTime(raw) : (firstSlotByDate[a.session_date] ?? '');
    attendanceByStudentDate[`${a.student_id}|${a.session_date}|${cell}`] = { status: a.status, note: shown(a.note ?? null), units: a.session_units ?? null, slot: raw ? R.normalizeSlotTime(raw) : null };
  }
  const marksMap = {};
  for (const m of markRows) marksMap[`${m.studentId}|${m.markDate}|${R.normalizeSlotTime(m.slotStart)}`] = { status: m.status, progressNote: shown(m.progressNote), score: m.score, listeningLevel: m.listeningLevel, memorizedWords: m.memorizedWords };
  const renamed = R.classNameForWeek(nameIndex, classId, weekMonday, weekSunday, access.className, today);
  return { ok: true, data: {
    classId, className: renamed?.name ?? access.className, classNameBefore: renamed?.before, classNameUpcoming: renamed?.upcoming,
    weekMonday, weekLabel: R.weekLabel(weekMonday), weekRelation: R.weekRelation(weekMonday, today), today,
    canWrite: access.canWrite, canMarkAttendanceByDate, canNoteAttendance, skillAreas: access.skillAreas, goalAreas: R.goalAreasFor(access.englishTrack, access.skillAreas),
    grid, teacherNames, classTeacherName: access.teacherId ? (teacherNames[access.teacherId] ?? null) : null, students, attendanceByStudentDate, unitsByDate, marks: marksMap,
    goals: goals.map(g => ({ scope: g.scope, periodStart: g.period_start, role: g.role, skillArea: g.skill_area, textbook: g.textbook ?? null, targetProgress: g.target_progress ?? null })),
    monthStart, memos: Object.fromEntries(memos.map(m => [m.memo_key, shown(m.body)])), periodLabelBySlot, fill: R.sheetFillStats(grid), fontSize: R.readEcsFontSize(prefs),
    showSelfStudy, collapsedRosterGroups: R.readEcsCollapsedRosterGroups(prefs), isEie: access.englishTrack === 'eie' && env.eieOn,
    shoutingSlots: R.shoutingMapOf(flags), delegated: delegatedIds.includes(classId) && access.teacherId !== viewer.id,
  } };
}

// ── 월간 — 2.0 getClassSheetMonth(classId, month, { period, week }) + getMonthPlanChrome ─────────────────────────
/** 원래 월간계획 — 2.0 `getClassPlannedLines`(loadPlanMaterials → planCellsOf): 교재 배정에서 계산, 미루기 미반영. */
export async function plannedLines(sql, t, R, env, classId, from, to) {
  const empty = { byCell: {}, baselineByCell: {}, lessonIndex: {}, shiftByCell: {} };
  const plans = await sql`select id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode::text term_mode, start_date::text start_date, start_lesson_no, slot_picks
    from public.class_textbook_plans where tenant_id=${t} and is_active and class_id=${classId} order by created_at`;
  if (!plans.length) return empty;
  const bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [shifts, books, lessons, scheds] = await Promise.all([
    sql`select plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date <= ${to} order by id`,
    sql`select id::text id, title, page_time, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])`,
    sql`select textbook_id::text textbook_id, lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id = any(${bookIds}::uuid[]) order by textbook_id, lesson_no`,
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} order by day_of_week, start_time`,
  ]);
  const shiftMap = {}; for (const r of shifts) shiftMap[R.markerKeyOfRow(r)] = String(r.kind) === 'advance' ? 'advance' : 'skip';
  const bookMap = new Map(books.map(b => [b.id, { title: String(b.title), pageTime: b.page_time ?? null, skillArea: b.skill_area ?? null, sessionCount: Number(b.session_count ?? 0) }]));
  const lessonsByBook = new Map(); for (const l of lessons) { const m = lessonsByBook.get(l.textbook_id) ?? new Map(); m.set(Number(l.lesson_no), { progress: l.progress ?? null, homework: l.homework ?? null }); lessonsByBook.set(l.textbook_id, m); }
  const schedules = scheds.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, slotTeacherLabel: r.slot_teacher_label ?? null, slotRoomLabel: r.slot_room_label ?? null }));
  const common = { plans, books: bookMap, lessonsByBook, schedules, holidays: env.holidays, from, to };
  return { byCell: R.expandPlans({ ...common, shifts: shiftMap }), baselineByCell: R.expandPlans({ ...common, shifts: null }), lessonIndex: R.lessonIndexOf(plans, bookMap, lessonsByBook), shiftByCell: R.cellShiftSummary(shiftMap) };
}
/** 2.0 `loadRecentImports` — 그 반의 아직 안 되돌린 교재 배정 반영, 최신 5건(표가 없으면 빈 배열 — 읽기 전용 트랜잭션이라 먼저 묻는다). */
async function recentImports(sql, t, R, classId) {
  const [{ present }] = await sql`select to_regclass('public.class_plan_import_batches') is not null present`;
  if (!present) return [];
  return (await sql`select id::text id, created_at, row_count, rows from public.class_plan_import_batches where tenant_id=${t} and class_id=${classId} and undone_at is null order by created_at desc limit 5`)
    .map(r => { const { meta } = R.splitBatchRows(r.rows); return { id: r.id, at: isoAt(r.created_at), count: Number(r.row_count ?? 0), title: meta?.title ?? null, kind: R.historyKindOf(meta) }; });
}
async function periodDefsFor(sql, t, years) {
  return (await sql`select id::text id, class_id::text class_id, subject_key, label_year, label_month, start_date::text start_date, end_date::text end_date
      from public.operating_periods where tenant_id=${t} and label_year = any(${[...new Set(years)]}::int[])`)
    .map(d => ({ id: d.id, classId: d.class_id ?? null, subjectKey: d.subject_key, labelYear: d.label_year, labelMonth: d.label_month, startDate: d.start_date, endDate: d.end_date }));
}
export async function monthData(sql, t, R, env, viewer, classId, q) {
  const today = await copyDay(), names = await readNames(sql, t, R);
  const explicitMonth = q.month ? R.normalizeMonth(q.month, '') : '', yearOf = d => Number(d.slice(0, 4));
  const weekRaw = q.week && DAY.test(q.week) ? R.mondayOf(q.week) : null, fromWeek = weekRaw && Math.abs(yearOf(weekRaw) - yearOf(today)) <= 1 ? weekRaw : null;
  const years = [explicitMonth || today.slice(0, 7), today, fromWeek ?? today].flatMap(d => [yearOf(d) - 1, yearOf(d)]);
  const [gate, defs] = await Promise.all([classAccess(sql, t, R, env, viewer, classId), periodDefsFor(sql, t, years)]);
  if (!gate.ok) return gate;
  const access = gate.access, uiPrefs = viewer.uiPrefs, isEie = access.englishTrack === 'eie' && env.eieOn;
  const periodMode = isEie ? (R.normalizeEcsMonthPeriod(q.period) ?? R.readEcsMonthPeriod(uiPrefs)) : 'month';
  const sessionLabelFor = date => {
    const hits = defs.filter(d => d.subjectKey === access.subject && d.startDate <= date && date <= d.endDate).filter(d => d.classId === null || d.classId === classId)
      .sort((a, b) => (a.classId === b.classId ? 0 : a.classId ? -1 : 1));
    for (const d of hits) { const label = `${d.labelYear}-${String(d.labelMonth).padStart(2, '0')}`; const w = R.resolvePeriodWindow({ period: label, subjectKey: access.subject, classId, defs });
      if (w.kind === 'session' && w.start <= date && date <= w.end) return label; }
    return null;
  };
  const currentMonth = (periodMode === 'session' ? sessionLabelFor(today) : null) ?? today.slice(0, 7); // 2.0 kstMonth() — 복사본 기준일의 달
  const anchors = fromWeek ? [...(today >= fromWeek && today <= R.shiftDays(fromWeek, 6) ? [today] : []), R.shiftDays(fromWeek, 3)] : [];
  const weekMonth = periodMode === 'session' ? (anchors.map(sessionLabelFor).find(Boolean) ?? '') : '';
  const month = weekMonth || explicitMonth || currentMonth, bounds = R.monthRange(month);
  const win = R.resolvePeriodWindow({ period: month, subjectKey: access.subject, classId, defs, mode: periodMode, todayIso: today });
  const from = win.start || bounds.from, to = win.end || bounds.to, footerDate = R.mpFooterDate(month);
  const [schedules, lineRows, goalRows, mpRows, teacherRows, memoRows, planned, imports] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        classroom_id::text classroom_id, teacher_id::text teacher_id, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from <= ${to} and (valid_to is null or valid_to >= ${from})`,
    sql`select * from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date between ${from} and ${to} order by plan_date, slot_start, line_no, id`,
    sql`select role::text role, skill_area, textbook, target_progress from public.class_sheet_goals where tenant_id=${t} and class_id=${classId} and scope='month' and period_start=${bounds.from}`,
    isEie ? sql`select plan_date::text plan_date, col_kind::text col_kind, body from public.class_month_plan_cells where tenant_id=${t} and class_id=${classId}
      and plan_date between ${from < bounds.from ? from : bounds.from} and ${to > bounds.to ? to : bounds.to}` : null,
    access.teacherId ? sql`select display_name, english_name from public.users where tenant_id=${t} and id=${access.teacherId}` : [],
    sql`select body from public.class_sheet_month_memos where tenant_id=${t} and class_id=${classId} and month=${bounds.from}`,
    plannedLines(sql, t, R, env, classId, from, to),
    access.canWrite ? recentImports(sql, t, R, classId) : [],
  ]);
  const slotTeacherIds = [...new Set(schedules.map(r => r.teacher_id).filter(Boolean))];
  const slotTeacherNames = Object.fromEntries((slotTeacherIds.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${slotTeacherIds}::uuid[])` : [])
    .filter(u => u.display_name).map(u => [u.id, u.display_name]));
  const classTeacherName = teacherRows[0]?.display_name ?? null;
  const displayTeacherOf = r => R.resolveTeacherLabel(r.slot_teacher_label ?? null, names.labelMap) || (r.teacher_id ? (slotTeacherNames[r.teacher_id] ?? null) : null) || classTeacherName;
  const scheduleRows = schedules.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time ?? null, validFrom: r.valid_from ?? null, validTo: r.valid_to ?? null,
    slotTeacherLabel: displayTeacherOf(r), slotRoomLabel: roomOf(R, names, r) }));
  const slotsByDate = R.slotsByDateOf(R.rangeDates(from, to), scheduleRows), seatByKey = new Map();
  for (const [d, slots] of Object.entries(slotsByDate)) for (const s of slots) seatByKey.set(R.slotKey(d, s.slotStart), s.seat !== null);
  const lines = lineRows.map(row => { const dto = R.planLineFromRow({ ...row, id: String(row.id), plan_date: isoDay(row.plan_date), slot_start: String(row.slot_start), updated_at: isoAt(row.updated_at) });
    return { ...dto, seat: seatByKey.get(R.slotKey(dto.planDate, dto.slotStart)) ?? false }; })
    .filter(l => seatByKey.has(R.slotKey(l.planDate, l.slotStart))).filter(l => R.isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.pageRange, progress: l.progress, homework: l.homework }));
  const linesBySlot = {}; for (const l of lines) (linesBySlot[R.slotKey(l.planDate, l.slotStart)] ??= []).push(l);
  const goals = { homeroom: {}, assistant: {} };
  for (const g of goalRows) goals[g.role === 'assistant' ? 'assistant' : 'homeroom'][g.skill_area] = { textbook: g.textbook ?? null, targetProgress: g.target_progress ?? null };
  const periodsConfig = R.settingsToPeriodsConfig(env.operations), tables = { weekday: R.tableToEntries(R.weekdayTableFor(access.subject, periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const periodLabelBySlot = {};
  for (const [d, slots] of Object.entries(slotsByDate)) for (const s of slots) { const l = R.resolvePeriodLabel(s.slotStart, s.slotEnd, tables, R.isWeekendDow(R.dowKeyOf(d))); if (l) periodLabelBySlot[R.slotKey(d, s.slotStart)] = l; }
  const holidays = Object.fromEntries(Object.entries(env.holidays).filter(([d]) => d >= from && d <= to));
  const hasLines = (d, s) => (linesBySlot[R.slotKey(d, s)]?.length ?? 0) > 0;
  const mpCells = (mpRows ?? []).map(r => ({ planDate: r.plan_date.slice(0, 10), colKind: r.col_kind, body: typeof r.body === 'string' ? r.body : '' }))
    .filter(c => (c.colKind === 'footer' ? c.planDate === footerDate : c.planDate >= from && c.planDate <= to));
  const data = {
    classId, className: access.className, teacherId: access.teacherId, teacherName: classTeacherName, month, monthLabel: R.monthLabel(month), today,
    period: { mode: periodMode, kind: win.kind, start: from, end: to }, currentMonth, dows: R.activeDowsOf(Object.keys(slotsByDate)), weeks: R.rangeWeeks(from, to),
    slotsByDate, linesBySlot, plannedBySlot: planned.baselineByCell, lessonIndex: planned.lessonIndex, shiftBySlot: planned.shiftByCell, recentImports: imports, lines,
    periodLabelBySlot, goals, skillAreas: access.skillAreas, canEdit: access.canWrite, fill: R.monthFillStats(slotsByDate, hasLines, holidays), holidays,
    view: R.clampEcsMonthView(R.readEcsMonthView(uiPrefs), isEie), display: { cal: R.readEcsMonthDisplay(uiPrefs, 'cal'), rail: R.readEcsMonthDisplay(uiPrefs, 'rail'), mp: R.readEcsMonthDisplay(uiPrefs, 'mp') },
    isEie, mp: { cells: mpCells, status: isEie ? 'ok' : 'off' }, memo: { body: shown(memoRows[0]?.body ?? ''), status: 'ok' },
  };
  // 2.0 getMonthPlanChrome — EiE 반에서만(다른 반엔 MP 보기 자체가 없다). 강사 이름 = 담임의 영어 이름 → 표시 이름.
  const english = teacherRows[0]?.english_name?.trim(), display = teacherRows[0]?.display_name?.trim();
  const mpChrome = isEie ? { texts: R.resolveMonthPlanTexts(env.operations.subjects.find(s => s.key === R.MONTH_PLAN_SUBJECT_KEY)), teacherLabel: english || display || null,
    periodRange: R.mpPeriodRangeLabel(R.resolvePeriodWindow({ period: month, subjectKey: 'english', classId, defs })) } : null;
  return { ok: true, data, mpChrome };
}
