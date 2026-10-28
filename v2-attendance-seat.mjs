// 2.0 화면 · 출석부 — 자리(랩실·JJ실) 출석부 메뉴(`/attendance/seat/<자리>`)의 조회. v2-screen-attendance.mjs가 v2path로 부른다.
// 2.0 `src/app/(shell)/attendance/seat/[seat]/page.tsx`가 부품(SeatAllDay·SeatJjAllDay·SeatBoard)에 넘기는 값을 같은 이름·모양으로 만든다.
//  · 조회 = 2.0 서버 모듈(features/attendance/seat/server/*)의 표·칸·조건을 SQL로 그대로 — `getSeatDay`(queries.ts) ·
//    `getSeatPeriodChoices`(period-choice.ts) · `getSeatPlacementsForDay`(placements.ts) · `loadDaySlots`(next-destination-day.ts) ·
//    `attachJjMarks(ForPeriods)`(jj-marks.ts) · `loadSeatJjPlansForPeriods`(jj-plan.ts) · `loadLabSplitInputs`(lab-split.ts) ·
//    `getTextbookOptions`(textbooks/server/queries.ts). 판정·접기는 2.0 순수 함수를 importV2로 그대로(seat.ts · period-choice.ts ·
//    next-destination.ts · student-classes.ts · destination-room.ts · lab-split.ts · prev-period.ts · jj-fields.ts · plan-line.ts …).
//  · 2.0은 표가 없으면(마이그레이션 전) 조회 오류를 '아직 켜지지 않음'으로 접는다. 여기는 한 트랜잭션 안이라 오류가 나면 뒤 조회가
//    모두 죽으므로, 표·칸이 있는지를 **먼저 물어** 같은 갈래로 접는다(hasTable·hasColumn).
//  · 보는 사람 = 3.0 띠에서 고른 자리 저장 가능자(2.0 `gateSeatWrite`: 자리 메뉴 쓰기 권한 ∪ 그 자리 당번 · 보호 계정 제외).
//    "지금"은 복사본 기준 시각(백업 시각의 KST) — 날짜(오늘)와 기본 교시가 3.0 다른 화면과 같은 때를 본다.
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';

export const SEAT_MODULES = {
  seat: 'features/attendance/seat/seat.ts', choice: 'features/attendance/seat/period-choice.ts', next: 'features/attendance/seat/next-destination.ts',
  stuClasses: 'features/attendance/seat/student-classes.ts', destRoom: 'features/attendance/seat/destination-room.ts', labSplit: 'features/attendance/seat/lab-split.ts',
  prev: 'features/attendance/seat/prev-period.ts', jj: 'features/attendance/seat/jj-fields.ts', placement: 'features/attendance/seat/placement.ts',
  duty: 'features/attendance/seat/duty.ts', planLine: 'features/class-sheets/lib/plan-line.ts', week: 'features/timetable/lib/week.ts',
  englishTrack: 'features/classes/english-track.ts',
  // 월간(`/attendance/seat/<자리>/month`) — getSeatMonthly가 쓰는 순수 규칙.
  monthly: 'features/attendance/seat/monthly.ts', monthlyBuild: 'features/attendance/seat/monthly-build.ts', monthlyPrefs: 'features/attendance/seat/monthly-prefs.ts',
  ttPeriods: 'features/timetable/lib/periods.ts', periodMatch: 'features/timetable/lib/period-match.ts',
};
let seatRules = null;
/** 자리 쪽 2.0 순수 모듈 — 실패하면 다음 요청에서 다시. */
export function loadSeatRules(importV2) {
  seatRules ??= Promise.all(Object.entries(SEAT_MODULES).map(async ([k, p]) => [k, await importV2(p)]))
    .then(Object.fromEntries).catch(error => { seatRules = null; throw error; });
  return seatRules;
}

// ── PORTED: 2.0 원문 그대로(불러올 수 없는 자리). 바꾸면 verify-v2-screen-attendance.mjs가 원문과 비교해 잡는다. ──
/** features/owner/skill-areas.ts — settings-types.ts가 부품(.tsx)을 불러 importV2로 못 읽는다. */
export const DEFAULT_ENGLISH_SKILL_AREAS = [
  { key: "vocab", label: "Vocab", color: "blue" },
  { key: "listening", label: "Listening", color: "purple" },
  { key: "reading", label: "Reading", color: "green" },
  { key: "grammar", label: "Grammar", color: "amber" },
  { key: "writing", label: "Writing", color: "rose" },
  { key: "speaking", label: "Speaking", color: "gold" },
];
export function resolveSkillAreas(subject) {
  if (!subject) return [];
  const stored = subject.skillAreas ?? [];
  if (stored.length > 0) return stored;
  if (subject.key === "english") return [...DEFAULT_ENGLISH_SKILL_AREAS];
  return [];
}
/** app/(shell)/attendance/seat/[seat]/page.tsx `shiftDate` · `dateLabel`. */
export function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function dateLabel(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}
// ── PORTED 끝 ──

let clock = null;
/** 복사본 기준 "지금"(백업 시각의 KST) — 날짜와 "HH:MM"(2.0 `kstNowHm` 자리). */
export async function copyClock() {
  if (!clock) {
    const { directory } = await activeBackup();
    const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
    const kst = new Date(new Date(m.capturedAt).getTime() + 9 * 3600000).toISOString();
    clock = { day: kst.slice(0, 10), hm: kst.slice(11, 16) };
  }
  return clock;
}

/** 표·칸이 있는가 — 2.0이 조회 오류(42P01·42703)로 아는 '아직 적용 안 됨'을 트랜잭션을 죽이지 않고 미리 안다. */
const hasTable = async (sql, name) => (await sql`select to_regclass(${`public.${name}`}) is not null ok`)[0].ok;
const hasColumn = async (sql, table, column) => (await sql`select exists (select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) ok`)[0].ok;

/** 2.0 `toSeatStudent`(queries.ts). */
function toSeatStudent(s, rec) {
  return { id: s.id, name: s.name, school: s.school, grade: s.grade, status: rec?.status ?? null, recordedBy: rec?.recorder_name ?? null,
    fromSeat: !!rec?.seat_label, note: rec?.note ?? null, attitude: null, listeningLevel: null, memorizedWords: null, progressNote: null };
}

/** 2.0 `loadLabSplitInputs`(server/lab-split.ts) — `lookupLabSeparateIds` 'window' + 켠 수강(`loadFlaggedCells`). 칸이 없으면 null. */
async function readLabSplit(sql, t, R, S, classIds, date) {
  if (classIds.length === 0) return null;
  if (!(await hasColumn(sql, 'class_schedules', 'lab_separate')) || !(await hasColumn(sql, 'enrollments', 'lab_separate'))) return null;
  const [sep, rows] = await Promise.all([
    sql`select id::text id from public.class_schedules where tenant_id=${t} and lab_separate and valid_from<=${date} and (valid_to is null or valid_to>=${date})`,
    sql`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred
      from public.enrollments where tenant_id=${t} and lab_separate and class_id = any(${classIds}::uuid[]) and start_date<=${date} and (end_date is null or end_date>=${date})`,
  ]);
  const flagged = new Set();
  for (const r of rows) {
    if (!R.elig.isEnrollmentActiveOn({ startDate: r.start_date, endDate: r.end_date, onHold: r.on_hold === true, isTransferred: r.is_transferred === true }, date)) continue;
    flagged.add(S.labSplit.labSplitKey(r.class_id, r.student_id));
  }
  return { separateIds: new Set(sep.map(r => r.id)), flagged };
}

/** 2.0 `loadSeatDay`(server/queries.ts) — 로그인 화면 갈래(메모·입력자 이름 포함). */
export async function readSeatDay(sql, t, R, S, seat, date) {
  const dowKey = R.cal.DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const wantLabel = S.seat.SEAT_DB_LABEL[seat], hhmm = S.seat.hhmm;
  const rawSlots = await sql`select id::text id, class_id::text class_id, start_time::text start_time, end_time::text end_time, slot_teacher_label
    from public.class_schedules where tenant_id=${t} and day_of_week::text=${dowKey} and slot_teacher_label is not null and valid_from<=${date} and (valid_to is null or valid_to>=${date})`;
  const seatRows = rawSlots.filter(r => R.tlabel.specialSlotLabel(r.slot_teacher_label) === wantLabel);
  if (seatRows.length === 0) return { date, periods: [], rosterByPeriod: {}, slotsByClass: {}, markedSlotsByCell: {}, busyStartsByClass: {}, offSlotByCell: {} };
  const classIds = [...new Set(seatRows.map(r => r.class_id))];
  const [classes, enrollments, records, labSplit] = await Promise.all([
    sql`select id::text id, class_name, bg_color, text_color from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days::text[] attendance_days,
        s.id::text sid, s.name, s.school, s.grade
      from public.enrollments e join public.students s on s.id=e.student_id
      where e.tenant_id=${t} and e.class_id = any(${classIds}::uuid[]) and e.on_hold is not true and e.start_date<=${date} and (e.end_date is null or e.end_date>=${date})`,
    sql`select r.id::text id, r.class_id::text class_id, r.student_id::text student_id, r.session_date::text session_date, r.slot_start::text slot_start, r.status::text status,
        r.seat_label, r.recorded_at, r.note, u.display_name recorder_name
      from public.attendance_records r left join public.users u on u.id=r.recorded_by
      where r.tenant_id=${t} and r.class_id = any(${classIds}::uuid[]) and r.session_date=${date}`,
    wantLabel === R.tlabel.LAB_ROOM_LABEL ? readLabSplit(sql, t, R, S, classIds, date) : Promise.resolve(null),
  ]);
  const nameById = new Map(classes.map(c => [c.id, c.class_name]));
  const colorById = new Map(classes.map(c => [c.id, { bg: c.bg_color, text: c.text_color }]));
  const slots = seatRows.map(r => ({ classId: r.class_id, className: nameById.get(r.class_id) ?? '(이름 없는 반)', start: r.start_time, end: r.end_time }));
  const periods = S.seat.groupByStart(slots);
  const classDows = new Map();
  for (const r of seatRows) {
    const list = classDows.get(r.class_id) ?? [], i = R.cal.dowIndexOf(dowKey);
    if (i >= 0 && !list.includes(i)) list.push(i);
    classDows.set(r.class_id, list);
  }
  const todayIdx = R.cal.dowIndexOf(dowKey);
  const studentsByClass = new Map();
  for (const e of enrollments) {
    const s = { id: e.sid, name: e.name, school: e.school, grade: e.grade };
    if (!R.elig.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, date)) continue;
    const dows = R.cal.resolveAttendDows(e.attendance_days, classDows.get(e.class_id) ?? []);
    if (dows.length > 0 && !dows.includes(todayIdx)) continue;
    const list = studentsByClass.get(e.class_id) ?? [];
    if (!list.some(x => x.id === s.id)) list.push(s);
    studentsByClass.set(e.class_id, list);
  }
  const recs = records.map(r => ({ ...r, recorded_at: r.recorded_at instanceof Date ? r.recorded_at.toISOString() : r.recorded_at }));
  const effective = R.effective.effectiveAttendanceRecords(recs);
  const recByKey = new Map();
  for (const r of effective) recByKey.set(`${r.class_id}|${r.student_id}|${hhmm(r.slot_start)}`, r);
  const periodCountByClass = new Map();
  for (const p of periods) for (const s of p.slots) periodCountByClass.set(s.classId, (periodCountByClass.get(s.classId) ?? 0) + 1);
  const slotsByClass = {};
  for (const p of periods) for (const s of p.slots) { const list = (slotsByClass[s.classId] ??= []); if (!list.includes(p.start)) list.push(p.start); }
  const markedSlotsByCell = {};
  for (const r of effective) {
    const slot = hhmm(r.slot_start); if (!slot) continue;
    const list = (markedSlotsByCell[`${r.class_id}|${r.student_id}`] ??= []);
    if (!list.includes(slot)) list.push(slot);
  }
  const seatClassIdSet = new Set(classIds), busyStartsByClass = {};
  for (const r of rawSlots) {
    if (!seatClassIdSet.has(r.class_id)) continue;
    if (R.tlabel.specialSlotLabel(r.slot_teacher_label) === wantLabel) continue;
    const start = hhmm(r.start_time); if (!start) continue;
    const list = (busyStartsByClass[r.class_id] ??= []);
    if (!list.includes(start)) list.push(start);
  }
  const periodStartSet = new Set(periods.map(p => p.start)), offSlotByCell = {};
  for (const r of effective) {
    const slot = hhmm(r.slot_start);
    if (!slot || !periodStartSet.has(slot)) continue;
    if (R.tlabel.specialSlotLabel(r.seat_label) !== wantLabel) continue;
    if ((slotsByClass[r.class_id] ?? []).includes(slot)) continue;
    const base = (studentsByClass.get(r.class_id) ?? []).find(s => s.id === r.student_id);
    if (!base) continue;
    (offSlotByCell[`${r.class_id}|${r.student_id}`] ??= {})[slot] = toSeatStudent(base, r);
  }
  const dayLevelFallback = (classId, studentId) => {
    if (S.seat.isPayrollSeat(seat)) return undefined;
    if ((periodCountByClass.get(classId) ?? 0) !== 1) return undefined;
    const rec = recByKey.get(`${classId}|${studentId}|`);
    return rec && ['present', 'absent', 'late'].includes(rec.status) ? rec : undefined;
  };
  const rosterByPeriod = {};
  for (const p of periods) {
    rosterByPeriod[p.start] = p.slots.map(slot => ({
      classId: slot.classId, className: slot.className, end: hhmm(slot.end),
      bgColor: colorById.get(slot.classId)?.bg ?? null, textColor: colorById.get(slot.classId)?.text ?? null,
      students: (studentsByClass.get(slot.classId) ?? []).map(s => toSeatStudent(s, recByKey.get(`${slot.classId}|${s.id}|${p.start}`) ?? dayLevelFallback(slot.classId, s.id)))
        .sort((a, b) => (a.grade ?? '').localeCompare(b.grade ?? '', 'ko') || a.name.localeCompare(b.name, 'ko')),
    }));
  }
  const defaultSlotsByCell = labSplit ? S.labSplit.buildLabSplitDefaults({
    slots: seatRows.map(r => ({ classId: r.class_id, start: hhmm(r.start_time), separate: labSplit.separateIds.has(String(r.id)) })),
    studentsByClass: new Map([...studentsByClass].map(([classId, list]) => [classId, list.map(s => s.id)])),
    flagged: labSplit.flagged,
  }) : {};
  return { date, periods, rosterByPeriod, slotsByClass, markedSlotsByCell, busyStartsByClass, offSlotByCell, defaultSlotsByCell };
}

const CHOICE_NOT_READY = '자리 교시 선택 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0255a 미적용).';
/** 2.0 `getSeatPeriodChoices`(server/period-choice.ts). */
export async function readSeatPeriodChoices(sql, t, R, S, seat, date) {
  if (!S.seat.MOVABLE_SEATS.includes(seat)) return { moves: [], pins: [], ready: true, reason: null };
  if (!(await hasTable(sql, 'seat_period_moves')) || !(await hasTable(sql, 'seat_period_pins'))) return { moves: [], pins: [], ready: false, reason: CHOICE_NOT_READY };
  const dow = R.cal.DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const [moves, pins] = await Promise.all([
    sql`select class_id::text class_id, student_id::text student_id, slot_start::text slot_start from public.seat_period_moves where tenant_id=${t} and seat=${seat} and session_date=${date}`,
    sql`select class_id::text class_id, student_id::text student_id, slot_start::text slot_start, effective_from::text effective_from from public.seat_period_pins where tenant_id=${t} and seat=${seat} and day_of_week::text=${dow}`,
  ]);
  return { moves: moves.map(r => ({ classId: r.class_id, studentId: r.student_id, slotStart: S.seat.hhmm(r.slot_start) })),
    pins: pins.map(r => ({ classId: r.class_id, studentId: r.student_id, slotStart: S.seat.hhmm(r.slot_start), effectiveFrom: r.effective_from })), ready: true, reason: null };
}
/** 2.0 `applySeatDayChoices`(server/period-choice.ts) — 같은 순수 함수로. */
export function applySeatDayChoices(S, day, load, date) {
  return S.choice.applySeatPeriodChoicesByPeriod(day.rosterByPeriod, {
    choices: S.choice.resolveSeatPeriodChoices({ moves: load.moves, pins: load.pins, date }),
    slotsByClass: day.slotsByClass, markedSlotsByCell: day.markedSlotsByCell, busyStartsByClass: day.busyStartsByClass,
    offSlotByCell: day.offSlotByCell, defaultSlotsByCell: day.defaultSlotsByCell, blank: S.choice.blankSeatCell,
  });
}

/** 2.0 `getSeatPlacementsForDay`(server/placements.ts). */
export async function readSeatPlacementsForDay(sql, t, S, seat, date) {
  if (!(await hasTable(sql, 'seat_placements'))) return { bySlot: {}, ready: false, reason: '자리 배치 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0254a 미적용).' };
  const rows = await sql`select slot_start::text slot_start, student_id::text student_id, from_class_id::text from_class_id, to_class_id::text to_class_id
    from public.seat_placements where tenant_id=${t} and seat=${seat} and session_date=${date} order by created_at, id`;
  const bySlot = {};
  for (const r of rows) (bySlot[S.seat.hhmm(r.slot_start)] ??= []).push({ studentId: r.student_id, fromClassId: r.from_class_id, toClassId: r.to_class_id });
  return { bySlot, ready: true, reason: null };
}

/** 2.0 `loadDaySlots`(server/next-destination-day.ts) — 그 학생들의 그날 전 과목 배치(다음 행선지·학생 축의 재료). */
async function readDaySlots(sql, t, R, S, studentIds, date, seatClassIds) {
  const dowKey = R.cal.DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()], todayIdx = R.cal.dowIndexOf(dowKey);
  const none = { live: [], slotsByClass: new Map(), classNames: new Map(), todayIdx };
  if (studentIds.length === 0) return none;
  const enrollments = await sql`select student_id::text student_id, class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days::text[] attendance_days
    from public.enrollments where tenant_id=${t} and student_id = any(${studentIds}::uuid[]) and on_hold is not true and start_date<=${date} and (end_date is null or end_date>=${date}) order by id`;
  const live = enrollments.filter(e => R.elig.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, date));
  const classIds = [...new Set(live.map(e => e.class_id))];
  if (classIds.length === 0) return none;
  const slotClassIds = [...new Set([...classIds, ...seatClassIds])];
  const [slots, rooms] = await Promise.all([
    sql`select s.class_id::text class_id, s.start_time::text start_time, s.end_time::text end_time, s.slot_room_label, s.slot_teacher_label, sr.name slot_room, c.class_name, cr.name class_room
      from public.class_schedules s left join public.classrooms sr on sr.id=s.classroom_id join public.classes c on c.id=s.class_id left join public.classrooms cr on cr.id=c.classroom_id
      where s.tenant_id=${t} and s.class_id = any(${slotClassIds}::uuid[]) and s.day_of_week::text=${dowKey} and s.valid_from<=${date} and (s.valid_to is null or s.valid_to>=${date}) order by s.id`,
    sql`select name from public.classrooms where tenant_id=${t}`,
  ]);
  const known = rooms.map(r => r.name).filter(Boolean);
  const slotsByClass = new Map(), classNames = new Map();
  for (const sl of slots) {
    if (sl.class_name) classNames.set(sl.class_id, sl.class_name);
    const seatLabel = R.tlabel.specialSlotLabel(sl.slot_teacher_label);
    const list = slotsByClass.get(sl.class_id) ?? [];
    list.push({ start: S.seat.hhmm(sl.start_time), end: sl.end_time ? S.seat.hhmm(sl.end_time) : null,
      room: S.destRoom.destinationRoomOf({ slotRoom: sl.slot_room ?? null, roomLabel: sl.slot_room_label, classRoom: sl.class_room ?? null, seatLabel }, known), seatLabel });
    slotsByClass.set(sl.class_id, list);
  }
  return { live: live.map(e => ({ studentId: e.student_id, classId: e.class_id, attendanceDays: e.attendance_days })), slotsByClass, classNames, todayIdx };
}
/** 2.0 `getSeatNextDestinationsBySlot`(server/next-destination.ts). */
export async function readSeatNextDestinations(sql, t, R, S, studentIds, date, afterStarts, stays) {
  const EMPTY = { startByStudent: {}, roomByStudent: {}, lastByStudent: {} };
  if (studentIds.length === 0 || afterStarts.length === 0) return { bySlot: Object.fromEntries(afterStarts.map(k => [S.seat.hhmm(k), EMPTY])), classesByStudent: {} };
  const loaded = await readDaySlots(sql, t, R, S, studentIds, date, stays?.classIds ?? []);
  return { bySlot: Object.fromEntries(afterStarts.map(raw => { const after = S.seat.hhmm(raw); return [after, S.next.foldNextDestination(loaded, after, stays)]; })),
    classesByStudent: stays ? S.stuClasses.seatStudentClassesOf(loaded, stays.seat) : {} };
}

/** 2.0 `fetchJjMarksOfDay` + `withMarks`(server/jj-marks.ts) — JJ 칸(영어 시트 JJ 폼과 같은 행). 표가 없으면 그대로. */
async function readJjMarks(sql, t, S, classIds, date) {
  const unique = [...new Set(classIds)];
  if (unique.length === 0 || !(await hasTable(sql, 'class_sheet_student_marks'))) return unique.length === 0 ? new Map() : null;
  const rows = await sql`select class_id::text class_id, student_id::text student_id, slot_start::text slot_start, status, progress_note, listening_level, memorized_words
    from public.class_sheet_student_marks where tenant_id=${t} and mark_date=${date} and class_id = any(${unique}::uuid[])`;
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.class_id}|${r.student_id}|${S.seat.hhmm(r.slot_start)}`, { attitude: r.status ?? null, listeningLevel: r.listening_level ?? null, memorizedWords: r.memorized_words ?? null, progressNote: r.progress_note ?? null });
  return byKey;
}
const withMarks = (S, rosters, byKey, slot) => rosters.map(roster => ({ ...roster, students: roster.students.map(s => {
  const mark = byKey.get(`${roster.classId}|${s.id}|${S.seat.hhmm(slot)}`);
  return { ...s, attitude: mark?.attitude ?? null, listeningLevel: mark?.listeningLevel ?? null, memorizedWords: mark?.memorizedWords ?? null, progressNote: mark?.progressNote ?? null };
}) }));
export async function attachJjMarksForPeriods(sql, t, S, rostersByStart, date) {
  const starts = Object.keys(rostersByStart);
  const byKey = await readJjMarks(sql, t, S, starts.flatMap(start => (rostersByStart[start] ?? []).map(r => r.classId)), date);
  return Object.fromEntries(starts.map(start => [start, byKey ? withMarks(S, rostersByStart[start] ?? [], byKey, start) : rostersByStart[start] ?? []]));
}

/**
 * 2.0 `loadSeatJjPlansForPeriods`(server/jj-plan.ts) — 반마다 `requireEcsClassAccess` 판정 뒤 그날 계획 줄(`class_sheet_plan_lines`).
 * 판정 = 보는 사람의 영어 시트(ecs) 권한(없으면 빈 값) · 영어 반 + 영역 설정이 있는 반만 · 쓰기 = 'full'|'scoped'.
 * ⚠️ 강사 계정(담당 반 범위·보조·위임 판정)은 옮기지 않았다 — 자리 저장 가능자에 강사 역할이 있으면 계획을 싣지 않는다(빈 값 = 2.0의 '권한 없음' 모양).
 */
export async function readSeatJjPlans(sql, t, R, S, settings, viewer, seat, periods, date) {
  if (!S.jj.seatHasJjFields(seat) || periods.length === 0 || !viewer || viewer.role === 'teacher') return {};
  const unique = [...new Set(periods.flatMap(p => p.classIds))];
  if (unique.length === 0) return {};
  const level = R.perms.accessLevel(viewer.role, 'ecs', R.perms.applyUserOverrides(R.perms.resolveMatrix(settings.permissions?.overrides ?? []), viewer.id, viewer.role, settings.permissions?.userOverrides ?? []));
  if (level === 'none') return {};
  const classes = await sql`select id::text id, class_name, subject, teacher_id::text teacher_id, english_track from public.classes where tenant_id=${t} and id = any(${unique}::uuid[])`;
  const allowed = new Map();
  for (const cls of classes) {
    const skillAreas = resolveSkillAreas(settings.operations.subjects.find(s => s.key === cls.subject));
    if (cls.subject !== 'english' || skillAreas.length === 0) continue;
    allowed.set(cls.id, { canWrite: level === 'full' || level === 'scoped', englishTrack: S.englishTrack.readEnglishTrack(cls), skillAreas });
  }
  if (allowed.size === 0 || !(await hasTable(sql, 'class_sheet_plan_lines'))) return {};
  // 2.0은 select("*") 그대로 planLineFromRow에 넘긴다 — 날짜·시각을 PostgREST처럼 글자로 받도록 jsonb로 읽는다.
  const rows = (await sql`select to_jsonb(l) r from public.class_sheet_plan_lines l where l.tenant_id=${t} and l.plan_date=${date} and l.class_id = any(${[...allowed.keys()]}::uuid[]) order by l.term_mode, l.line_no`).map(x => x.r);
  const byKey = new Map();
  for (const row of rows) { const key = `${S.seat.hhmm(row.slot_start)}|${row.class_id}`; (byKey.get(key) ?? byKey.set(key, []).get(key)).push(S.planLine.planLineFromRow(row)); }
  const out = {};
  for (const period of periods) {
    const slot = S.seat.hhmm(period.start), byClass = {};
    for (const classId of new Set(period.classIds)) {
      const access = allowed.get(classId); if (!access) continue;
      byClass[classId] = { classId, canEdit: access.canWrite, showExamTerm: access.englishTrack !== 'eie', skillAreas: access.skillAreas, lines: byKey.get(`${slot}|${classId}`) ?? [] };
    }
    out[period.start] = byClass;
  }
  return out;
}

/** 2.0 `getTextbookOptions`(textbooks/server/queries.ts, 상한 800) — 계획 교재 칸 제안. */
async function readTextbookOptions(sql, t, subject = 'english') {
  const rows = await sql`select title, page_time from public.textbooks where tenant_id=${t} and subject=${subject} order by title limit 800`;
  return rows.map(r => ({ title: r.title, pageTime: r.page_time ?? null }));
}

/** 자리 저장 가능자 — 2.0 `gateSeatWrite`의 로그인 갈래(자리 메뉴 쓰기 권한 ∪ 그 자리 당번 · 모듈 켜짐) · 보호 계정 제외 · 원장 먼저. */
export async function seatWritersOf(sql, t, R, S, settings, seat) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role, seat_lab_duty, seat_jj_duty from public.users where tenant_id=${t} and status='active' and display_name is not null order by display_name`,
    sql`select id::text id from public.super_admins`,
  ]);
  const operators = new Set(supers.map(s => s.id)), base = R.perms.resolveMatrix(settings.permissions?.overrides ?? []), uo = settings.permissions?.userOverrides ?? [];
  const moduleOn = R.modules.isModuleEnabled(settings.modules.disabled, 'seat_attendance');
  return users.filter(u => !operators.has(u.id)).map(u => {
    const matrix = R.perms.applyUserOverrides(base, u.id, u.role, uo);
    const duty = moduleOn && S.duty.dutyAllowsSeat({ lab: u.seat_lab_duty === true, jj: u.seat_jj_duty === true }, seat);
    return { id: u.id, name: u.display_name, role: u.role, menuWrite: R.perms.canWrite(u.role, 'seat_attendance', matrix), duty, pastWrite: R.perms.canWrite(u.role, 'attendance', matrix) };
  }).filter(u => u.menuWrite || u.duty)
    .sort((a, b) => (R.roles.ROLE_HIERARCHY[a.role] ?? 99) - (R.roles.ROLE_HIERARCHY[b.role] ?? 99) || a.name.localeCompare(b.name, 'ko'));
}

/**
 * 2.0 자리 출석부 page.tsx의 값 — `{ seat, date, …, view, props }`. view = 'empty' | 'lab'(SeatAllDay) | 'jjAll'(SeatJjAllDay) | 'board'(SeatBoard).
 * props는 그 부품에 넘기는 값 그대로(함수·JSX 제외). 머리 줄(PageHeader·PeriodNav·자리 전환·단어수 가져오기)도 page.tsx 값 그대로.
 */
export async function seatDayProps({ sql, t, R, S, settings, seat, params, viewerId }) {
  const { day: today, hm } = await copyClock();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date : today;
  const editors = await seatWritersOf(sql, t, R, S, settings, seat);
  const viewer = editors.find(e => e.id === viewerId) ?? editors[0] ?? null;
  const [day, periodChoiceLoad] = await Promise.all([readSeatDay(sql, t, R, S, seat, date), readSeatPeriodChoices(sql, t, R, S, seat, date)]);
  const rosterByPeriod = applySeatDayChoices(S, day, periodChoiceLoad, date);
  const startParam = params.start ?? null, viewAll = startParam === 'all';
  const fallbackIdx = S.seat.pickPeriodIndex(day.periods, date === today ? hm : '00:00');
  const idx = startParam && !viewAll ? day.periods.findIndex(p => p.start === startParam) : fallbackIdx;
  const period = day.periods[idx >= 0 ? idx : fallbackIdx] ?? null;
  const shown = viewAll ? day.periods : period ? [period] : [];
  // 지난 날짜 쓰기는 출결 쓰기 권한이 있는 사람만(2.0 `canWriteTenant(role, "attendance")`).
  const readOnly = !viewer || (date !== today && !viewer.pastWrite);
  const jjAll = viewAll && S.jj.seatHasJjFields(seat);
  const stays = S.next.seatStaysFor(seat, rosterByPeriod);
  const [rostersOne, plansByStart, jjRostersByStart, placementsDay, nextDay] = await Promise.all([
    period && !jjAll && S.jj.seatHasJjFields(seat) ? attachJjMarksForPeriods(sql, t, S, { [period.start]: rosterByPeriod[period.start] ?? [] }, date).then(r => r[period.start]) : Promise.resolve(period ? rosterByPeriod[period.start] ?? [] : []),
    period ? readSeatJjPlans(sql, t, R, S, settings, viewer, seat, jjAll ? day.periods.map(p => ({ start: p.start, classIds: p.slots.map(s => s.classId) })) : [{ start: period.start, classIds: period.slots.map(s => s.classId) }], date) : Promise.resolve({}),
    jjAll ? attachJjMarksForPeriods(sql, t, S, rosterByPeriod, date) : Promise.resolve(null),
    readSeatPlacementsForDay(sql, t, S, seat, date),
    readSeatNextDestinations(sql, t, R, S, [...new Set(shown.flatMap(p => (rosterByPeriod[p.start] ?? []).flatMap(r => r.students.map(s => s.id))))], date, shown.map(p => p.start), stays),
  ]);
  const plans = !jjAll && period ? plansByStart[period.start] ?? {} : {};
  const nextBySlot = nextDay.bySlot;
  const canMovePlacement = seat === 'lab' && !readOnly && placementsDay.ready;
  const canChoosePeriod = seat === 'lab' && !readOnly && periodChoiceLoad.ready;
  const periodChoices = S.choice.resolveSeatPeriodChoices({ moves: periodChoiceLoad.moves, pins: periodChoiceLoad.pins, date });
  const placementNotice = seat === 'lab' && !readOnly && !placementsDay.ready ? placementsDay.reason : null;
  const cells = period ? S.prev.seatDayCells(day.periods, rosterByPeriod) : null;
  const prevAbsentFor = (start, blocked) => (cells ? S.prev.prevPeriodAbsences(cells, start, blocked) : undefined);
  const hrefFor = `/attendance/seat/${seat}?date=${date}&start=`;
  const anyPlan = Object.keys(plans).length > 0 || Object.values(jjAll ? plansByStart : {}).some(byClass => Object.keys(byClass).length > 0);
  const textbookOptions = anyPlan ? await readTextbookOptions(sql, t) : [];
  const planMeta = viewer ? { tenantId: t, userId: viewer.id, weekMonday: S.week.mondayOf(date) } : null;
  const base = { seat, seatName: S.seat.SEAT_NAME[seat], seatRoom: S.seat.SEAT_ROOM[seat], date, today, dateLabel: dateLabel(date), prevDate: shiftDate(date, -1), nextDate: shiftDate(date, 1),
    usableSeats: S.seat.USABLE_SEAT_KEYS.map(k => ({ key: k, name: S.seat.SEAT_NAME[k] })), readOnly,
    // 인재원 단어수 가져오기 — 2.0은 연동 설정(IJW_*)이 이 학원이면 선다(이 복사본의 학원 = 침산 · 2.0 운영에선 켜져 있다 — ecs_memorized_pull 기록).
    // 누르면 바깥(인재원)을 부르는 일이라 이 연습 화면은 2.0 실패 모양으로 답한다(actions.pullSeatMemorizedWords).
    ijwReady: true, textbookOptions,
    editors: editors.map(e => ({ id: e.id, name: e.name, role: R.roles.ROLE_LABEL?.[e.role] ?? '' })), viewer: viewer?.id ?? null };
  if (day.periods.length === 0 || !period) return { ...base, view: 'empty', props: null };
  const slotOf = p => ({ prevAbsentByCell: prevAbsentFor(p.start, S.seat.ambiguousClassIds(p)), nextStartByStudent: nextBySlot[p.start]?.startByStudent, nextRoomByStudent: nextBySlot[p.start]?.roomByStudent,
    lastByStudent: nextBySlot[p.start]?.lastByStudent, placements: placementsDay.bySlot[p.start] ?? [] });
  if (seat === 'lab') return { ...base, view: 'lab', props: {
    seat, date, shownStart: viewAll ? null : period.start, showAll: true,
    choiceDay: { moves: periodChoiceLoad.moves, pins: periodChoiceLoad.pins, slotsByClass: day.slotsByClass, markedSlotsByCell: day.markedSlotsByCell, busyStartsByClass: day.busyStartsByClass,
      offSlotByCell: day.offSlotByCell, ...(day.defaultSlotsByCell ? { defaultSlotsByCell: day.defaultSlotsByCell } : {}), studentClasses: nextDay.classesByStudent },
    canMove: canChoosePeriod, readOnly, hrefFor, canMovePlacement, placementNotice,
    periods: day.periods.map(p => ({ start: p.start, ends: p.ends, classIds: p.slots.map(s => s.classId), rosters: day.rosterByPeriod[p.start] ?? [], ...slotOf(p) })) } };
  if (jjAll) return { ...base, view: 'jjAll', props: { seat, date, readOnly, hrefFor, planMeta,
    periods: day.periods.map(p => ({ start: p.start, classIds: p.slots.map(s => s.classId), rosters: jjRostersByStart?.[p.start] ?? rosterByPeriod[p.start] ?? [], ...slotOf(p), plans: plansByStart[p.start] ?? {} })) } };
  return { ...base, view: 'board', props: {
    seat, date, periods: day.periods.map(p => ({ start: p.start, ends: p.ends, classIds: p.slots.map(s => s.classId) })), showAllChip: true, activeStart: period.start,
    rosters: rostersOne, readOnly, hrefFor, prevAbsentByCell: prevAbsentFor(period.start, S.seat.ambiguousClassIds(period)),
    nextStartByStudent: nextBySlot[period.start]?.startByStudent, nextRoomByStudent: nextBySlot[period.start]?.roomByStudent, lastByStudent: nextBySlot[period.start]?.lastByStudent,
    placements: placementsDay.bySlot[period.start] ?? [], canMove: canMovePlacement, placementNotice, periodChoices, choicesApplied: true, canChoosePeriod,
    plans: Object.keys(plans).length > 0 && planMeta ? { plans, ...planMeta } : undefined } };
}

// ── 월간(`/attendance/seat/<자리>/month`) = 2.0 `getSeatMonthly`(server/monthly-queries.ts) + month/page.tsx ──
/** 2.0 `periodLabelFn`(monthly-queries.ts) — 과목이 하나일 때만 교시 라벨(학원 설정 교시표). */
function periodLabelFn(S, subjects, operations) {
  if (subjects.length !== 1) return undefined;
  const items = S.ttPeriods.subjectWeekdayPeriods(subjects[0], S.ttPeriods.settingsToPeriodsConfig(operations));
  const match = S.periodMatch.buildPeriodMatcher(items);
  return (start, end) => { const id = match({ startTime: start, endTime: end }); const item = items.find(p => p.id === id); return item ? S.ttPeriods.periodSoloLabel(item) : start; };
}

/**
 * 2.0 `getSeatMonthly(seat, month)` — 자리 교시(±45일 배치 이력) · 그 반 수강 · 기록(정정 줄은 최신 하나) · 다른 반 수강 구간(반이동 표식) → `buildSeatMonthly`.
 * `defsOf(year)` = 세션 정의(0189a) 읽기 — 월별 출석부와 같은 조회(v2-screen-attendance.mjs `readPeriodDefs`).
 */
export async function readSeatMonthly(sql, t, R, S, settings, seat, month, today, defsOf) {
  const bounds = R.periods.monthBounds(month);
  const qStart = bounds ? R.date.addDays(bounds.start, -45) : `${month}-01`, qEnd = bounds ? R.date.addDays(bounds.end, 45) : `${month}-31`;
  const want = S.seat.SEAT_DB_LABEL[seat];
  const sepReady = await hasColumn(sql, 'class_schedules', 'lab_separate');
  const [rawSlots, sepRows] = await Promise.all([
    sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and slot_teacher_label is not null and valid_from<=${qEnd} and (valid_to is null or valid_to>=${qStart}) order by class_id, id`,
    sepReady ? sql`select id::text id from public.class_schedules where tenant_id=${t} and lab_separate and valid_from<=${qEnd} and (valid_to is null or valid_to>=${qStart})` : Promise.resolve(null),
  ]);
  const labSeparateSlotIds = sepRows ? new Set(sepRows.map(r => r.id)) : null;
  const seatRows = rawSlots.filter(r => R.tlabel.specialSlotLabel(r.slot_teacher_label) === want);
  const classIds = [...new Set(seatRows.map(r => r.class_id))];
  const classes = classIds.length ? await sql`select id::text id, class_name, subject from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])` : [];
  const subjects = [...new Set(classes.map(c => c.subject).filter(Boolean))];
  const mode = subjects.length === 1 ? 'session' : 'month', year = Number(month.slice(0, 4));
  const window = R.periods.resolvePeriodWindow({ period: month, subjectKey: subjects.length === 1 ? subjects[0] : null, mode, todayIso: today, defs: mode === 'month' || !Number.isFinite(year) ? [] : await defsOf(year) });
  const days = S.monthly.padDaysTo31(S.monthly.buildMonthDays(window.start, window.end, today));
  const slots = seatRows.map(r => ({ classId: r.class_id, dayOfWeek: r.day_of_week, start: S.seat.hhmm(r.start_time), end: S.seat.hhmm(r.end_time), validFrom: r.valid_from, validTo: r.valid_to,
    separate: labSeparateSlotIds ? labSeparateSlotIds.has(r.id) : undefined })).filter(s => days.some(d => !d.placeholder && S.monthly.isSlotLiveOnDate(s, d.date)));
  const liveClassIds = [...new Set(slots.map(s => s.classId))];
  const [enrollRows, recordRows, labFlaggedRows] = await Promise.all([
    liveClassIds.length ? sql`select e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.on_hold, e.attendance_days::text[] attendance_days, s.id::text sid, s.name, s.school, s.grade
      from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${t} and e.class_id = any(${liveClassIds}::uuid[]) and e.start_date<=${window.end} and (e.end_date is null or e.end_date>=${window.start}) order by e.id` : [],
    liveClassIds.length ? sql`select * from (select id::text id, class_id::text class_id, student_id::text student_id, session_date::text session_date, slot_start::text slot_start, status::text status, seat_label, session_units, recorded_at,
        ${sql.unsafe((await hasColumn(sql, 'attendance_records', 'taught_by')) ? 'taught_by::text' : 'null::text')} taught_by
      from public.attendance_records where tenant_id=${t} and class_id = any(${liveClassIds}::uuid[]) and session_date between ${window.start} and ${window.end}) r order by recorded_at desc, id desc` : [],
    (await hasColumn(sql, 'enrollments', 'lab_separate')) && liveClassIds.length ? sql`select class_id::text class_id, student_id::text student_id from public.enrollments where tenant_id=${t} and lab_separate and class_id = any(${liveClassIds}::uuid[])` : Promise.resolve(liveClassIds.length ? null : []),
  ]);
  const enrollments = enrollRows.map(e => ({ classId: e.class_id, studentId: e.sid, name: e.name, school: e.school, grade: e.grade, startDate: e.start_date, endDate: e.end_date,
    isTransferred: e.is_transferred === true, onHold: e.on_hold, attendanceDays: e.attendance_days }));
  const records = R.effective.effectiveAttendanceRecords(recordRows.map(r => ({ ...r, recorded_at: r.recorded_at instanceof Date ? r.recorded_at.toISOString() : r.recorded_at }))).map(r => {
    const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
    return { id: r.id, classId: r.class_id, studentId: r.student_id, date: r.session_date, slotStart: r.slot_start, status: r.status, taughtBy: r.taught_by ?? null, seatLabel: r.seat_label,
      sessionUnits: raw !== null && Number.isFinite(raw) ? raw : null };
  });
  const studentIds = [...new Set(enrollments.map(e => e.studentId))];
  const otherSpans = new Map();
  if (studentIds.length) {
    const from = R.date.addDays(window.start, -R.span.TRANSFER_GAP_DAYS), to = R.date.addDays(window.end, R.span.TRANSFER_GAP_DAYS);
    const rows = await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, c.class_name, c.subject, s.withdrawn_at::text withdrawn_at
      from public.enrollments e left join public.classes c on c.id=e.class_id left join public.students s on s.id=e.student_id
      where e.tenant_id=${t} and e.student_id = any(${studentIds}::uuid[]) and e.start_date<=${to} and (e.end_date is null or e.end_date>=${from}) order by e.id`;
    for (const r of rows) {
      const list = otherSpans.get(r.student_id) ?? [];
      list.push(R.span.clipToWithdrawal({ classId: r.class_id, className: r.class_name ?? '다른 반', subject: r.subject ?? null, start: r.start_date, end: r.end_date, isTransferred: r.is_transferred === true }, r.withdrawn_at));
      otherSpans.set(r.student_id, list);
    }
  }
  const labFlagged = labFlaggedRows ? new Set(labFlaggedRows.map(r => S.labSplit.labSplitKey(r.class_id, r.student_id))) : null;
  return S.monthlyBuild.buildSeatMonthly({ otherSpans, month, window, days, holidays: R.cal.buildHolidayMap(settings.operations.holidays), slots,
    classes: classes.map(c => ({ id: c.id, className: c.class_name, subject: c.subject })), enrollments, records, wantLabel: want,
    periodLabelOf: periodLabelFn(S, subjects, settings.operations), labFlagged: labSeparateSlotIds ? labFlagged : null });
}

/** 2.0 자리 월간 month/page.tsx의 값 — 보기(view) · 접은 반(그 사람의 ui_prefs.seatMonthly) · 머리 줄. */
export async function seatMonthProps({ sql, t, R, S, settings, seat, params, viewerId, defsOf }) {
  const { day: today } = await copyClock();
  const currentMonth = today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? '') ? params.month : currentMonth;
  const editors = await seatWritersOf(sql, t, R, S, settings, seat);
  const viewer = editors.find(e => e.id === viewerId) ?? editors[0] ?? null;
  const [view, prefRow] = await Promise.all([
    readSeatMonthly(sql, t, R, S, settings, seat, month, today, defsOf),
    viewer ? sql`select ui_prefs from public.users where tenant_id=${t} and id=${viewer.id}` : Promise.resolve([]),
  ]);
  const prefs = S.monthlyPrefs.parseSeatMonthlyPrefs(prefRow[0]?.ui_prefs?.seatMonthly);
  const [y, m] = month.split('-');
  return { seat, seatName: S.seat.SEAT_NAME[seat], seatRoom: S.seat.SEAT_ROOM[seat], month, currentMonth, monthLabel: `${y}년 ${Number(m)}월`,
    prevMonth: shiftMonthOf(month, -1), nextMonth: shiftMonthOf(month, 1), view, collapsed: prefs.collapsed,
    editors: editors.map(e => ({ id: e.id, name: e.name, role: R.roles.ROLE_LABEL?.[e.role] ?? '' })), viewer: viewer?.id ?? null };
}
/** month/page.tsx `shiftMonth`(월별 출석부 page.tsx와 같은 본문). */
function shiftMonthOf(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
