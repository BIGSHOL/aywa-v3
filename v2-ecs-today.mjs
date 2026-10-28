// 2.0 화면 · 강사 시트(ECS) — '오늘' 면(영어 전담 강사의 기본 첫 화면). 2.0 `ecs/page.tsx`의 face === "today" 갈래가 EcsTodayFace에 넘기는 props 그대로:
//   res          = getEcsToday(date)(features/class-sheets/server/today.ts) — 카드 순서는 applyTodayOrder(개인 순서)
//   mode         = 'sheet'(기본) | 'cards'
//   sheets       = 시트 모드에서 카드마다 getClassSheetWeek(반, weekMonday) = sheetWeekData 그대로 → 보이는 첫 교시(firstVisibleTodaySlot) → 개인 순서
//   myTeacherId  = effectiveTeacherId(선생님 역할이면 그 사람) · canReorder(다른 강사 뷰가 없어 늘 true) · textbookOptions = loadEcsTextbookOptions
// getEcsToday는 server-only라 불러올 수 없어 같은 표·칸·조건을 SQL로 옮기고, 판정·조립은 2.0 순수 함수(importV2)를 그대로 쓴다. 조립 본문은 원문 순서 그대로.
// 2.0과 다른 것(이유):
//  · 보는 사람 = 3.0 띠에서 고른 직원(로그인 없음) — 강사 스코프·권한·보기 설정(ui_prefs.ecs)은 그 사람 것. '다른 강사 뷰'가 없어 반 순서는 늘 본인 것.
//  · 출결 사유·학생 특이사항의 연락처는 3.0 전 화면처럼 가린다(가린 칸은 저장이 덮지 않는다 — 주간 시트와 같은 규약).
//  · 출결 기록 시각은 마이크로초까지 같은 꼴의 글자로 견준다(2.0은 PostgREST 글자 — 같은 순서, 꼬리 0을 지운 글자보다 오히려 고르다).
//  · 표가 없을 때 2.0이 오류를 삼키는 조회(보강 예약 · 수업 나누기 · Shouting · ClassNote 게시)는 읽기 전용 트랜잭션이 깨지지 않게 표가 있는지 먼저 묻는다.
//  · 저장은 이미 옮긴 액션 그대로(시트 모드 = 주간 시트와 같은 교시 칸). 요약 카드의 출결(출석·지각·결석 = 그날 전체 칸 setAttendanceCell, '전원 출석' = setAttendanceBulk)은
//    출석부 저장 본문을 함께 쓰고, '선택 안 함'(clearPresentAttendance)과 반 순서도 저장된다.
import { canWriteLevel, delegatedClassIds, isoAt, readClassNameAsOf, shown, teacherScopeOf } from './v2-ecs-core.mjs';
import { sheetWeekData, textbookOptions, visibleClassFilter } from './v2-ecs-props.mjs';
import { teachingClassIds } from './v2-ecs-seat.mjs';
import { myTasksStrip, todayAttendanceStrip } from './v2-ecs-strip.mjs';

/** class-splits/rules.ts · period.ts — period.ts가 addDays·dowOf를 다른 뜻으로 내보내 공용 묶음(R)에 펼치지 않고 따로 둔다. */
let splitRulesPromise = null;
const splitRules = importV2 => (splitRulesPromise ??= Promise.all([importV2('features/class-splits/rules.ts'), importV2('features/class-splits/period.ts')])
  .then(([rules, period]) => ({ isSplitDay: rules.isSplitDay, splitActiveOn: period.splitActiveOn, splitOverlapsRange: period.splitOverlapsRange }))
  .catch(error => { splitRulesPromise = null; throw error; }));

/** 표가 있는가 — 2.0이 오류를 삼키는 조회를 읽기 전용 트랜잭션에서 안전하게 건너뛰려고(없는 표를 읽으면 트랜잭션이 통째로 깨진다). */
async function presentTables(sql, names) {
  const rows = await sql`select n, to_regclass('public.' || n) is not null p from unnest(${names}::text[]) n`;
  return new Set(rows.filter(r => r.p).map(r => r.n));
}
/** 출결 기록 시각 — 마이크로초까지 같은 꼴(UTC). 2.0 today.ts가 이 글자를 바로 견준다(`r.recorded_at > prev.recorded_at`). */
const recordedAtText = sql => sql`to_char(recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** 2.0 getReservationsOn(date, classIds) — 그날 그 반들의 '예약됨' 보강(오늘 면은 반·학생만 쓴다). 표가 없거나 실패하면 빈 목록. */
async function reservationsOn(sql, t, date, classIds, tables) {
  if (classIds.length === 0 || !tables.has('makeup_reservations')) return [];
  return (await sql`select class_id::text class_id, student_id::text student_id from public.makeup_reservations
    where tenant_id=${t} and makeup_date=${date} and status='reserved' and class_id = any(${classIds}::uuid[]) order by slot_start`).map(r => ({ classId: r.class_id, studentId: r.student_id }));
}

/** 2.0 getSplitsOnDate(date, classIds) = getSplitsTouchingClasses(…, date, date) → splitActiveOn + 상대 반 이름·담임. 표가 없으면 빈 결과. */
async function splitsOnDate(sql, t, S, date, classIds, tables) {
  const ids = [...new Set(classIds.filter(Boolean))];
  if (ids.length === 0 || !tables.has('class_splits')) return { splits: [], classNames: new Map() };
  const rows = await sql`select id::text id, student_id::text student_id, source_class_id::text source_class_id, target_class_id::text target_class_id, day_of_week::text day_of_week,
      start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, period_kind::text period_kind, note
    from public.class_splits where tenant_id=${t} and (source_class_id = any(${ids}::uuid[]) or target_class_id = any(${ids}::uuid[])) and valid_from <= ${date}`;
  const byId = new Map();
  for (const r of rows) {
    // 2.0 toSplit — 요일이 아니면 버린다.
    if (!S.isSplitDay(r.day_of_week)) continue;
    const s = { id: r.id, studentId: r.student_id, sourceClassId: r.source_class_id, targetClassId: r.target_class_id, dayOfWeek: r.day_of_week,
      startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5), validFrom: String(r.valid_from).slice(0, 10), validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
      periodKind: r.period_kind === 'day' || r.period_kind === 'month' ? r.period_kind : 'forever', note: r.note ?? null };
    if (S.splitOverlapsRange(s, date, date)) byId.set(s.id, s);
  }
  const splits = [...byId.values()].filter(s => S.splitActiveOn(s, date));
  if (splits.length === 0) return { splits, classNames: new Map() };
  const names = await sql`select c.id::text id, c.class_name, u.display_name from public.classes c left join public.users u on u.id=c.teacher_id
    where c.tenant_id=${t} and c.id = any(${[...new Set(splits.flatMap(s => [s.sourceClassId, s.targetClassId]))]}::uuid[])`;
  return { splits, classNames: new Map(names.map(r => [r.id, { name: r.class_name, teacherName: r.display_name ?? null }])) };
}

/** 2.0 loadNativeParticipants({ session_date, limit: 500 }, { sharedRead: true }) → participantsOrLegacy. 보강 운영이 꺼져 있으면 RPC를 부르지 않는다(복사본 = 꺼짐).
 *  켜져 있으면 2.0 readParticipantPages처럼 쪽마다 RPC를 저장점 안에서 부른다(거절이 읽기 트랜잭션을 깨지 않게). 잘림·실패는 2.0처럼 던진다. */
async function nativeParticipantsOn(sql, R, env, date) {
  if (!R.featureLive(env.makeups.mode)) return [];
  const rpc = async payload => {
    try {
      const body = await sql.savepoint(sp => sp`select public.makeup_list_participants(${sp.json(payload)}) body`.then(r => r[0].body));
      const parsed = R.parseParticipantBody(body);
      return parsed.ok ? { status: 'ok', value: parsed.value } : { status: 'failed', error: parsed.error };
    } catch (e) {
      const error = { code: e?.code, message: e?.message, details: e?.detail };
      if (R.isParticipantPermissionDenied(error) || R.isModeOffError(error)) return { status: 'off' };
      if (R.isMissingMakeupRpc(error)) return { status: 'schema_missing' };
      return { status: 'failed', error: '보강 참여를 확인하지 못했습니다' };
    }
  };
  const participants = [], seen = new Set();
  let after = null;
  for (let page = 1; page <= 8; page += 1) {
    const payload = { session_date: date, limit: 500, ...(after ? { after } : { page: 1, page_size: 500 }) };
    const outcome = await rpc(payload);
    if (outcome.status === 'off' || outcome.status === 'schema_missing') return [];
    if (outcome.status === 'failed') throw new Error(outcome.error);
    const rows = outcome.value.participants;
    if (rows.length === 0) { if (page > 1) throw new Error('보강 참여 목록이 잘렸습니다'); return participants; }
    if (rows.some(row => seen.has(row.id))) throw new Error('보강 참여 목록이 잘렸습니다');
    for (const row of rows) { seen.add(row.id); participants.push(row); }
    const total = outcome.value.total;
    if (!outcome.value.truncated || (total !== null && participants.length >= total)) return participants;
    const next = outcome.value.nextAfter ?? R.participantCursor(rows[rows.length - 1]);
    if (after && R.sameParticipantCursor(after, next)) throw new Error('보강 참여 목록이 잘렸습니다');
    after = next;
  }
  throw new Error('보강 참여가 더 있습니다. 기간을 나눠 다시 조회해 주세요');
}

/** 2.0 userTaughtClassSet(supabase, user, date) — getTeachingClassIds(user, date).all ∪ 그날 살아 있는 교시 담당(요일 무관). */
async function taughtClassSet(sql, t, R, env, userId, date) {
  const [teaching, slots] = await Promise.all([
    teachingClassIds(sql, t, R, env, userId, date),
    sql`select class_id::text class_id from public.class_schedules where tenant_id=${t} and teacher_id=${userId} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date})`,
  ]);
  return new Set([...teaching, ...slots.map(r => r.class_id)]);
}

// ── 2.0 getEcsToday(dateParam) ───────────────────────────────────────────────────────────────────────────
export async function ecsTodayData(sql, t, R, env, viewer, dateParam, today, importV2) {
  const level = viewer.levels.ecs;
  if (level === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const canWrite = level === 'full' || level === 'scoped';
  const date = dateParam && R.YMD_RE.test(dateParam) ? dateParam : today;
  const dow = R.dowKeyOf(date);
  const eieOn = R.isModuleEnabled(env.disabled, 'eie'), classnoteOn = R.isModuleEnabled(env.disabled, 'classnote');
  const holidayName = R.holidayNameOn(env.holidays, date);
  const skillAreas = env.skillAreas;
  const done = (cards, hasAnyClass, fontSize, todayOrder) => ({ ok: true, date, today, weekMonday: R.mondayOf(date), cards, hasAnyClass, canWrite, skillAreas, userId: viewer.id, tenantId: t, fontSize, todayOrder, holidayName });
  if (skillAreas.length === 0) return done([], false, R.DEFAULT_ECS_FONT_SIZE, []);

  const [allClasses, nameIndex, scope] = await Promise.all([
    sql`select id::text id, class_name, teacher_id::text teacher_id, english_track from public.classes
      where tenant_id=${t} and subject='english' and is_active and (closed_at is null or closed_at >= ${date}) order by class_name`,
    readClassNameAsOf(sql, t, R, today),
    teacherScopeOf(sql, t, viewer),
  ]);
  const [{ classIds: visibleIds }, delegatedIds] = await Promise.all([
    visibleClassFilter(sql, t, R, viewer, null, today),
    delegatedClassIds(sql, t, R, scope?.teacherId ?? null, today),
  ]);
  const delegatedSet = new Set(delegatedIds);
  const scopeSet = visibleIds ? new Set(visibleIds) : null;
  const scoped = allClasses.filter(c => !scopeSet || scopeSet.has(c.id));
  const prefs = viewer.uiPrefs;
  const showSelfStudy = R.readEcsShowSelfStudy(prefs);
  const fontSize = R.readEcsFontSize(prefs);
  // '다른 강사 뷰'가 없다 — 순서는 늘 보는 사람(=본인) 것.
  const todayOrder = R.readEcsTodayOrder(prefs);
  if (scoped.length === 0) return done([], false, fontSize, todayOrder);
  const scopedIds = scoped.map(c => c.id);

  // ── 그 날짜에 살아 있는 배치만(#88) ──
  const schedules = await sql`select class_id::text class_id, start_time::text start_time, end_time::text end_time, slot_teacher_label, classroom_id::text classroom_id, slot_room_label
    from public.class_schedules where tenant_id=${t} and class_id = any(${scopedIds}::uuid[]) and day_of_week::text=${dow} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date})`;
  const slotsByClass = new Map();
  for (const s of schedules) {
    if (R.hiddenSeatOf(s.slot_teacher_label, showSelfStudy)) continue;
    const arr = slotsByClass.get(s.class_id) ?? [];
    arr.push(s);
    slotsByClass.set(s.class_id, arr);
  }
  const todayIds = scopedIds.filter(id => (slotsByClass.get(id)?.length ?? 0) > 0);
  if (todayIds.length === 0) return done([], true, fontSize, todayOrder);

  const S = await splitRules(importV2);
  const tables = await presentTables(sql, ['makeup_reservations', 'class_splits', 'class_sheet_slot_flags', 'classnote_class_posts', 'classnote_boards']);
  const roomIds = [...new Set(todayIds.flatMap(id => (slotsByClass.get(id) ?? []).map(s => s.classroom_id).filter(Boolean)))];
  const teacherIds = [...new Set(scoped.filter(c => todayIds.includes(c.id)).map(c => c.teacher_id).filter(Boolean))];
  // ── 계획·학생기록·수강·출결·강의실·담당자·ClassNote — 서로 독립이라 한 번에(B4) ──
  const [reservedToday, splitsToday, nativeToday, shoutingRows, planLines, marksRaw, enrollments, attendanceRaw, rooms, teachers, classnotePosts, classnoteBoards, boardSnapshot] = await Promise.all([
    reservationsOn(sql, t, date, todayIds, tables),
    splitsOnDate(sql, t, S, date, todayIds, tables),
    nativeParticipantsOn(sql, R, env, date),
    tables.has('class_sheet_slot_flags') ? sql`select class_id::text class_id, slot_start::text slot_start, shouting from public.class_sheet_slot_flags
      where tenant_id=${t} and flag_date=${date} and class_id = any(${todayIds}::uuid[])` : [],
    sql`select id::text id, class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, term_mode::text term_mode, line_no, skill_area, textbook, page_range, progress, homework, updated_at
      from public.class_sheet_plan_lines where tenant_id=${t} and class_id = any(${todayIds}::uuid[]) and plan_date=${date} order by id`,
    sql`select * from public.class_sheet_student_marks where tenant_id=${t} and class_id = any(${todayIds}::uuid[]) and mark_date=${date} order by id`,
    // PostgREST 임베드 students!inner(withdrawn_at) — 학생 행이 있는 수강만.
    sql`select e.class_id::text class_id, e.student_id::text student_id, e.attendance_days, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
        s.withdrawn_at::text withdrawn_at from public.enrollments e join public.students s on s.id=e.student_id
      where e.tenant_id=${t} and e.class_id = any(${todayIds}::uuid[]) and e.start_date <= ${date} and (e.end_date is null or e.end_date >= ${date}) order by e.id`,
    sql`select id::text id, class_id::text class_id, student_id::text student_id, status::text status, note, ${recordedAtText(sql)} recorded_at, session_date::text session_date, slot_start::text slot_start
      from public.attendance_records where tenant_id=${t} and class_id = any(${todayIds}::uuid[]) and session_date=${date} order by id`,
    roomIds.length ? sql`select id::text id, name from public.classrooms where tenant_id=${t} and id = any(${roomIds}::uuid[])` : [],
    teacherIds.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : [],
    tables.has('classnote_class_posts') ? sql`select board_name from public.classnote_class_posts where tenant_id=${t} and posted_on=${date}` : [],
    tables.has('classnote_class_posts') ? sql`select board_name from public.classnote_class_posts where tenant_id=${t} and posted_on >= ${R.addDays(today, -45)} order by board_name, posted_on` : [],
    tables.has('classnote_boards') ? sql`select board_id, board_name, child_count from public.classnote_boards where tenant_id=${t} order by board_id` : [],
  ]);
  const shoutingByClass = new Map();
  for (const r of shoutingRows) {
    if (!r.shouting) continue;
    const list = shoutingByClass.get(r.class_id) ?? [];
    list.push(R.shoutingKey(date, String(r.slot_start)).split('|')[1]);
    shoutingByClass.set(r.class_id, list);
  }
  const marks = marksRaw.map(m => ({ ...m, class_id: String(m.class_id), student_id: String(m.student_id), slot_start: String(m.slot_start), progress_note: shown(m.progress_note ?? null) }));
  const attendance = attendanceRaw.map(a => ({ ...a, note: shown(a.note ?? null) }));

  // 보강(수업외) = 그 반 수강행은 없는데 그날 출결·보강 예약·보강 참여가 있는 학생 — 반마다.
  const attMakeupIds = new Set();
  for (const classId of todayIds) {
    const enrolled = enrollments.filter(e => e.class_id === classId).map(e => e.student_id);
    const recorded = [
      ...attendance.filter(r => r.class_id === classId).map(r => r.student_id),
      ...reservedToday.filter(r => r.classId === classId).map(r => r.studentId),
      ...nativeToday.filter(r => r.classId === classId).map(r => r.studentId),
    ];
    for (const id of R.makeupStudentIds(recorded, enrolled)) attMakeupIds.add(id);
  }
  const studentIds = [...new Set([...enrollments.map(e => e.student_id), ...attMakeupIds, ...R.splitIncomingIds(todayIds, date, splitsToday.splits)])];
  const studentRows = studentIds.length ? await sql`select id::text id, name, english_name, school, grade from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [];

  // 보고서 상태 — 반의 정규 보고서 · 반 없는 영어 보강 보고서 · 어느 반에서 한 보강인지 남긴 보고서.
  const [reports, subjectReports, anchoredMakeupReports] = await Promise.all([
    sql`select student_id::text student_id, class_id::text class_id, classnote_status from public.lesson_reports where tenant_id=${t} and class_id = any(${todayIds}::uuid[]) and report_date=${date} order by id`,
    studentIds.length ? sql`select student_id::text student_id, classnote_status from public.lesson_reports where tenant_id=${t} and student_id = any(${studentIds}::uuid[])
      and class_id is null and subject='english' and report_date=${date} order by id` : [],
    sql`select student_id::text student_id, makeup_class_id::text makeup_class_id, classnote_status from public.lesson_reports where tenant_id=${t} and makeup_class_id = any(${todayIds}::uuid[])
      and makeup = true and report_date=${date} order by id`,
  ]);

  const roomName = new Map(rooms.map(r => [r.id, r.name]));
  const teacherName = new Map(teachers.map(u => [u.id, u.display_name]));
  const postedBoardKeys = new Set(classnotePosts.map(p => R.boardKey(p.board_name)));
  const recentBoardNames = new Set(classnoteBoards.map(b => b.board_name.trim()));
  const boardUniverse = boardSnapshot.length > 0
    ? boardSnapshot.filter(b => b.child_count !== 0 && recentBoardNames.has(b.board_name.trim())).map(b => ({ name: b.board_name, id: `board:${b.board_id}` }))
    : classnoteBoards.map(b => ({ name: b.board_name, id: b.board_name.trim() }));
  const boardsByKey = new Map();
  for (const b of boardUniverse) {
    const k = R.boardKey(b.name);
    const set = boardsByKey.get(k) ?? new Set();
    set.add(b.id);
    boardsByKey.set(k, set);
  }
  const classnoteStateOf = className => {
    const k = R.classKey(className);
    const boards = boardsByKey.get(k);
    if (!boards || boards.size >= 2) return 'untracked';
    return postedBoardKeys.has(k) ? 'posted' : 'pending';
  };
  const studentMeta = new Map(studentRows.map(s => [s.id, s]));
  const missingMakeup = [...new Set(anchoredMakeupReports.map(r => r.student_id))].filter(id => !studentMeta.has(id));
  if (missingMakeup.length > 0) {
    for (const s of await sql`select id::text id, name, english_name, school, grade from public.students where tenant_id=${t} and id = any(${missingMakeup}::uuid[])`) studentMeta.set(s.id, s);
  }
  const periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const periodTables = { weekday: R.tableToEntries(R.weekdayTableFor('english', periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const weekend = R.isWeekendDow(dow);

  // 출결 effective — 출석부·시트와 같은 축약 함수. (반|학생)별 가장 최근 행이 표시값, 취소용으로 전 행의 slot 원본을 함께.
  const effective = R.effectiveAttendanceRecords(attendance);
  const attByKey = new Map(), attSlotsByKey = new Map();
  for (const r of effective) {
    const key = `${r.class_id}|${r.student_id}`;
    const prev = attByKey.get(key);
    if (!prev || r.recorded_at > prev.recorded_at || (r.recorded_at === prev.recorded_at && r.id > prev.id)) attByKey.set(key, r);
    const slots = attSlotsByKey.get(key) ?? [];
    slots.push(r.slot_start ?? null);
    attSlotsByKey.set(key, slots);
  }
  const reportByKey = new Map();
  for (const r of reports) {
    const key = `${r.class_id}|${r.student_id}`;
    const prev = reportByKey.get(key);
    reportByKey.set(key, { written: true, sent: (prev?.sent ?? false) || r.classnote_status === 'success' });
  }
  const subjectReportByStudent = new Map();
  for (const r of subjectReports) {
    const prev = subjectReportByStudent.get(r.student_id);
    subjectReportByStudent.set(r.student_id, { written: true, sent: (prev?.sent ?? false) || r.classnote_status === 'success' });
  }

  const attendanceWritable = canWriteLevel(viewer.levels.attendance) && (viewer.systemRole !== 'teacher' || R.isWithinAttendanceEditWindow(date, today));
  const attendanceScoped = viewer.levels.attendance === 'scoped';
  const teachingSet = attendanceWritable && attendanceScoped ? await taughtClassSet(sql, t, R, env, viewer.id, date) : null;

  const marksByStudent = new Map();
  for (const m of marks) {
    const key = `${m.class_id}|${m.student_id}`;
    const slot = R.normalizeSlotTime(m.slot_start);
    const cur = marksByStudent.get(key) ?? {};
    cur[slot] = { status: m.status ?? null, progressNote: m.progress_note ?? null, score: m.score ?? null, listeningLevel: m.listening_level ?? null, memorizedWords: m.memorized_words ?? null };
    marksByStudent.set(key, cur);
  }
  const linesByKey = new Map();
  for (const l of planLines) {
    const key = `${l.class_id}|${R.normalizeSlotTime(l.slot_start)}`;
    const arr = linesByKey.get(key) ?? [];
    arr.push(l);
    linesByKey.set(key, arr);
  }
  const rowOf = (classId, id, extra) => {
    const meta = studentMeta.get(id);
    const att = attByKey.get(`${classId}|${id}`);
    return { studentId: id, name: meta?.name ?? '(이름 없음)', englishName: meta?.english_name ?? null, school: meta?.school ?? null, grade: meta?.grade ?? null,
      attendance: att?.status ?? null, attendanceNote: att?.note ?? null, attendanceSlots: attSlotsByKey.get(`${classId}|${id}`) ?? [], ...extra, marks: marksByStudent.get(`${classId}|${id}`) ?? {} };
  };

  const cards = todayIds.map(classId => {
    const cls = scoped.find(c => c.id === classId);
    const slotRows = (slotsByClass.get(classId) ?? []).slice().sort((a, b) => R.normalizeSlotTime(a.start_time).localeCompare(R.normalizeSlotTime(b.start_time)));
    const slots = slotRows.map(s => {
      const start = R.normalizeSlotTime(s.start_time);
      const end = s.end_time ? R.normalizeSlotTime(s.end_time) : null;
      const lines = (linesByKey.get(`${classId}|${start}`) ?? []).slice().sort((a, b) => a.line_no - b.line_no).map(l => ({
        id: l.id, planDate: l.plan_date, slotStart: start, termMode: l.term_mode, lineNo: l.line_no, skillArea: l.skill_area ?? null, textbook: l.textbook ?? null,
        pageRange: l.page_range ?? null, progress: l.progress ?? null, homework: l.homework ?? null, updatedAt: isoAt(l.updated_at), // CAS 열쇠 — 주간 시트·저장(v2-ecs-save lineDTO)과 같은 꼴
        filled: R.isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.page_range, progress: l.progress, homework: l.homework }),
      }));
      return {
        slotStart: start, slotEnd: end, teacherLabel: s.slot_teacher_label ?? null, periodLabel: R.resolvePeriodLabel(start, end, periodTables, weekend),
        roomLabel: R.canonicalRoomName(R.resolveRoomName({ slotClassroomName: s.classroom_id ? (roomName.get(s.classroom_id) ?? null) : null, slotRoomLabel: s.slot_room_label ?? null }), [...roomName.values()]),
        lines, form: R.rosterFormOf(s.slot_teacher_label),
      };
    });
    // 그 날 실제 수강 대상 — 출결 게이트와 같은 판정(기간·보류·전출·퇴원 + 분리등원 요일).
    const roster = enrollments
      .filter(e => e.class_id === classId && !((e.withdrawn_at ?? null) !== null && e.withdrawn_at < date)
        && R.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined }, date)
        && R.enrollmentAttendsOnDay(e.attendance_days, dow))
      .map(e => {
        const rep = reportByKey.get(`${classId}|${e.student_id}`), subjRep = subjectReportByStudent.get(e.student_id);
        return rowOf(classId, e.student_id, { reportWritten: (rep?.written ?? false) || (subjRep?.written ?? false), reportSent: (rep?.sent ?? false) || (subjRep?.sent ?? false), isMakeup: false });
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const enrolledIds = roster.map(s => s.studentId);
    const recordedIds = [
      ...attendance.filter(r => r.class_id === classId).map(r => r.student_id),
      ...reservedToday.filter(r => r.classId === classId).map(r => r.studentId),
      ...nativeToday.filter(r => r.classId === classId).map(r => r.studentId),
    ];
    const reportMakeupIds = anchoredMakeupReports.filter(r => r.makeup_class_id === classId).map(r => r.student_id);
    const makeupIds = [...new Set([...R.makeupStudentIds(recordedIds, enrolledIds), ...R.makeupStudentIds(reportMakeupIds, enrolledIds)])];
    const makeupRows = makeupIds.map(id => {
      const rep = reportByKey.get(`${classId}|${id}`), subjRep = subjectReportByStudent.get(id);
      const anchored = anchoredMakeupReports.find(r => r.student_id === id && r.makeup_class_id === classId);
      return rowOf(classId, id, { reportWritten: (rep?.written ?? false) || (subjRep?.written ?? false) || !!anchored,
        reportSent: (rep?.sent ?? false) || (subjRep?.sent ?? false) || anchored?.classnote_status === 'success', isMakeup: true });
    });
    const renamed = R.resolveClassNameAsOf(nameIndex, classId, date, cls.class_name);
    return {
      classId, className: renamed?.name ?? cls.class_name, ...(renamed ? { classNameBefore: renamed.before, classNameChangeDate: renamed.date } : {}),
      teacherName: cls.teacher_id ? (teacherName.get(cls.teacher_id) ?? null) : null,
      startsAt: slots[0]?.slotStart ?? '00:00', endsAt: slots.at(-1)?.slotEnd ?? null, slots,
      students: R.applySplitsToCard({
        classId, date, slots: slots.map(sl => ({ start: sl.slotStart, end: sl.slotEnd })), students: R.appendMakeupStudents(roster, makeupRows),
        splits: splitsToday.splits, names: splitsToday.classNames,
        hasRecord: sid => attByKey.has(`${classId}|${sid}`) || marksByStudent.has(`${classId}|${sid}`),
        makeRow: sid => { const rep = reportByKey.get(`${classId}|${sid}`); return rowOf(classId, sid, { reportWritten: rep?.written ?? false, reportSent: rep?.sent ?? false, isMakeup: false }); },
      }),
      fill: { total: slots.length, filled: slots.filter(s => s.lines.some(l => l.filled)).length },
      canMarkAttendance: attendanceWritable && (teachingSet === null || teachingSet.has(classId)),
      delegated: delegatedSet.has(classId) && cls.teacher_id !== viewer.id,
      // 보드 매칭 키는 DB 이름 그대로(classKey) — 미래 이름을 먹이면 그 반 보드를 못 찾는다.
      classnoteToday: classnoteOn && roster.length > 0 ? classnoteStateOf(cls.class_name) : 'untracked',
      isEie: eieOn && R.readEnglishTrack(cls) === 'eie',
      shoutingSlots: shoutingByClass.get(classId) ?? [],
      hiddenLines: planLines.filter(l => l.class_id === classId).length - slots.reduce((n, s) => n + s.lines.length, 0),
      hiddenMarks: marks.filter(m => m.class_id === classId && !slots.some(s => s.slotStart === R.normalizeSlotTime(m.slot_start))).length,
    };
  }).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className, 'ko'));

  return done(cards, true, fontSize, todayOrder);
}

// ── 2.0 ecs/page.tsx face === "today" 갈래 — EcsTodayFace props ───────────────────────────────────────────────
export async function todayFaceData(sql, t, R, env, viewer, q, today, importV2) {
  const mode = q.mode === 'cards' ? 'cards' : 'sheet';
  // 2.0 effectiveTeacherId — 3.0엔 겸직 강사뷰 쿠키가 없어 선생님 역할이면 그 사람.
  const myTeacherId = viewer.systemRole === 'teacher' ? viewer.id : null;
  const [todayRes, options, attendanceStrip, tasksStrip] = await Promise.all([
    ecsTodayData(sql, t, R, env, viewer, q.date ?? null, today, importV2),
    textbookOptions(sql, t),
    !q.date || q.date === today ? todayAttendanceStrip(sql, t, viewer, today, importV2) : null,
    myTasksStrip(sql, t, viewer),
  ]);
  let sheets = null;
  if (mode === 'sheet' && todayRes.ok && todayRes.cards.length > 0) {
    const results = await Promise.all(todayRes.cards.map(c => sheetWeekData(sql, t, R, env, viewer, c.classId, todayRes.weekMonday)));
    const key = s => (s.res.ok ? (R.firstVisibleTodaySlot(s.res.data, { date: todayRes.date, myTeacherId }) ?? '99:99') : '99:99');
    sheets = results.map((res, i) => ({ classId: todayRes.cards[i].classId, className: todayRes.cards[i].className, res }))
      .sort((a, b) => key(a).localeCompare(key(b)) || a.className.localeCompare(b.className, 'ko'));
    sheets = R.applyTodayOrder(sheets, todayRes.todayOrder);
  }
  return { res: todayRes.ok ? { ...todayRes, cards: R.applyTodayOrder(todayRes.cards, todayRes.todayOrder) } : todayRes,
    mode, sheets, myTeacherId, canReorder: true, textbookOptions: options, attendanceStrip, tasksStrip };
}
