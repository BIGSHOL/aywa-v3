// 2.0 화면 · 출석부 — 당일 출결 보드(`/attendance/quick` 출결 모드 · `/attendance/live` 오늘 출결이 함께 쓰는 적재). v2-screen-attendance.mjs가 v2path로 부른다.
// 2.0 features/attendance/live/server/*의 조회를 같은 표·칸·조건의 SQL로, 판정·접기는 2.0 순수 함수를 importV2로 그대로:
//  · load.ts `loadLiveSlots` → readLiveSlots — 그 요일·그 날짜에 살아 있는 배치(#88) × 그날 예정 명단(isEnrollmentActiveOn + enrollmentAttendsOnDay) ·
//    유효 출결(effectiveAttendanceRecords — 교시별/그날 전체 두 세대) · 보강 예약(0264a) · 수업 나누기(0351a, applySplitsToSlotRoster) ·
//    LAB 따로 수업(*LAB, labSplitSlotShows) · 강의실 이름(canonicalRoomName) · 저장 축(saveSlotFor) · 강사 귀속(taughtByForSlot).
//  · queries.ts `getLiveBoard` → readLiveBoard — 강사별로 묶기(groupIdentityOf·groupHeaderOf) · 국면(slotPhase)·띠(nowBandOf) · 내 수업(ownedByMe) · canEdit.
//  · scope.ts `liveTeacherClassIds` · write-policy.ts `userTaughtClassSet` · classes/server/delegation.ts `getTeachingClasses`·`getTeachingClassIds`
//    (담임 ∪ 그날 위임 ∪ JJ 담당 지정 ∪ 교시 담당).
//  · server/holiday-activity.ts `getHolidayDayActivity` → readHolidayDayActivity(휴원일 읽기 전용 패널).
// "지금"은 복사본 기준 시각(백업 시각의 KST — copyClock) — 국면·띠·오늘 판정이 3.0 다른 화면과 같은 때를 본다.
// 보는 사람 = 3.0 띠에서 고른 출결 권한 직원(2.0 로그인 사용자 자리). 2.0 `effectiveTeacherId`는 강사 계정이면 그 사람, 그 밖(관리자뷰)은 없음.
import { copyClock, readLabSplit } from './v2-attendance-seat.mjs';

export const LIVE_MODULES = {
  signals: 'features/attendance/live/signals.ts', slotAxis: 'features/attendance/live/slot-axis.ts', floors: 'features/attendance/live/seating-floors.ts',
  group: 'features/attendance/live/teacher-group.ts', nowBand: 'features/attendance/live/now-band.ts', quick: 'features/attendance/quick/board.ts',
  seating: 'features/attendance/live/seating.ts', splitAtt: 'features/class-splits/attendance.ts', splitRoster: 'features/attendance/live/split-roster.ts',
  mark: 'features/attendance/live/mark-state.ts', via: 'features/attendance/live/recorded-via.ts', labSplit: 'features/attendance/seat/lab-split.ts',
  makeupWrite: 'features/attendance/makeup-write.ts', makeupTypes: 'features/makeups/types.ts', homeRule: 'lib/auth/teacher-home-rule.ts',
};
let liveRules = null;
export function loadLiveRules(importV2) {
  liveRules ??= Promise.all(Object.entries(LIVE_MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch(e => { liveRules = null; throw e; });
  return liveRules;
}

const DOW_ENUM = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const minutesOf = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };

/** 2.0 `holidayNameOf`(server/holiday.ts) — 학원설정 휴일 목록만. */
export const holidayNameOf = (R, settings, date) => R.holidaySheet.holidayNameOn(R.cal.buildHolidayMap(settings.operations.holidays), date);

/** 2.0 `fetchActiveDelegations` — 그날 살아 있는 위임(취소 안 됨 · 기간 안). */
async function activeDelegations(sql, t, R, date) {
  const rows = await sql`select class_id::text class_id, delegate_user_id::text delegate_user_id, from_date::text from_date, to_date::text to_date, revoked_at
    from public.class_delegations where tenant_id=${t} and revoked_at is null and from_date<=${date} and to_date>=${date} limit 500`;
  return rows.filter(r => R.delegWin.isDelegationActiveOn({ fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }, date));
}
/** 2.0 `fetchJjManagedClassIds` — 학원 설정 'JJ 보고서 담당'으로 지정된 사람이면 그날 JJ실(자습실) 교시가 있는 반. */
async function jjManagedClassIds(sql, t, R, settings, userId, date) {
  if (!(settings.permissions?.specialAccess?.jjReportManagerIds ?? []).includes(userId)) return [];
  const dow = R.axis.axisDowOf(date);
  if (!dow) return [];
  const rows = await sql`select class_id::text class_id, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
    from public.class_schedules where tenant_id=${t} and day_of_week::text=${dow} and teacher_id is null and slot_teacher_label is not null order by id`;
  return [...new Set(rows.filter(r => { const s = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: r.valid_from, validTo: r.valid_to };
    return R.axis.isSeatSlot(s) && R.tlabel.specialSlotLabel(r.slot_teacher_label) === R.tlabel.SELF_STUDY_ROOM_LABEL && R.axis.slotLiveOn(s, date); }).map(r => r.class_id))];
}
/** 2.0 `getTeachingClassIds` — 담임 반(활성 여부 무관) ∪ 그날 위임받은 반 ∪ JJ 담당 반. */
async function teachingClassIds(sql, t, R, settings, userId, date) {
  const [own, active, jj] = await Promise.all([sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${userId}`, activeDelegations(sql, t, R, date), jjManagedClassIds(sql, t, R, settings, userId, date)]);
  const ownIds = own.map(c => c.id), ownSet = new Set(ownIds);
  return [...ownIds, ...[...new Set([...active.filter(r => r.delegate_user_id === userId).map(r => r.class_id), ...jj])].filter(id => !ownSet.has(id))];
}
/** 2.0 `getTeachingClasses`(strict)의 반 id — 담임 반(활성) ∪ 위임·JJ 담당 반(활성). */
async function teachingActiveClassIds(sql, t, R, settings, userId, date) {
  const [own, active, jj] = await Promise.all([sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${userId} and is_active order by id`, activeDelegations(sql, t, R, date), jjManagedClassIds(sql, t, R, settings, userId, date)]);
  const ownSet = new Set(own.map(c => c.id));
  const wanted = [...new Set([...active.filter(r => r.delegate_user_id === userId && !ownSet.has(r.class_id)).map(r => r.class_id), ...jj.filter(id => !ownSet.has(id))])];
  const rows = wanted.length ? await sql`select id::text id from public.classes where tenant_id=${t} and id = any(${wanted}::uuid[]) and is_active` : [];
  return [...own.map(c => c.id), ...rows.map(c => c.id)];
}
const slotTeacherClassIds = async (sql, t, userId, date) => (await sql`select distinct class_id::text class_id from public.class_schedules
  where tenant_id=${t} and teacher_id=${userId} and valid_from<=${date} and (valid_to is null or valid_to>=${date})`).map(r => r.class_id);

/** 2.0 `userTaughtClassSet`(write-policy.ts) — 담당 반 ∪ 그날 위임 ∪ JJ 담당 ∪ 그날 교시 담당. */
export async function readTaughtClassSet(sql, t, R, settings, userId, date) {
  const [teaching, slots] = await Promise.all([teachingClassIds(sql, t, R, settings, userId, date), slotTeacherClassIds(sql, t, userId, date)]);
  return new Set([...teaching, ...slots]);
}
/** 2.0 `liveTeacherClassIds`(scope.ts) — 요일로 거르지 않는다(보강 예약·기록이 있을 수 있다). */
export async function readLiveTeacherClassIds(sql, t, R, settings, teacherId, date) {
  if (!ISO.test(date)) return [];
  const [teaching, slots] = await Promise.all([teachingActiveClassIds(sql, t, R, settings, teacherId, date), slotTeacherClassIds(sql, t, teacherId, date)]);
  return [...new Set([...teaching, ...slots])];
}

/** 2.0 `getReservationsOn`(makeup-reservation-queries.ts) — 그날 그 반들의 '예약됨' 보강(toReservation 모양). */
export async function readReservationsOn(sql, t, date, classIds) {
  if (classIds.length === 0) return [];
  const rows = await sql`select id::text id, student_id::text student_id, class_id::text class_id, absence_date::text absence_date, makeup_date::text makeup_date, slot_start::text slot_start,
      slot_end::text slot_end, period_label, note, status, created_by::text created_by
    from public.makeup_reservations where tenant_id=${t} and makeup_date=${date} and status='reserved' and class_id = any(${classIds}::uuid[]) order by slot_start`;
  return rows.map(r => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: r.absence_date, makeupDate: r.makeup_date, slotStart: String(r.slot_start).slice(0, 5),
    slotEnd: String(r.slot_end).slice(0, 5), periodLabel: r.period_label ?? null, note: r.note ?? null, status: r.status === 'done' ? 'done' : 'reserved', createdBy: r.created_by ?? null }));
}
/** 2.0 `getSplitsOnDate`(class-splits/server/queries.ts) — 그날 살아 있는 나눔 + 양쪽 반 이름·담임. toSplit은 출석부 모듈 것(같은 원본). */
async function readSplitsOnDate(sql, t, R, toSplit, date, classIds) {
  if (classIds.length === 0) return { splits: [], classNames: new Map() };
  const rows = await sql`select id::text id, student_id::text student_id, source_class_id::text source_class_id, target_class_id::text target_class_id, day_of_week, start_time::text start_time,
      end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, period_kind, note
    from public.class_splits where tenant_id=${t} and (source_class_id = any(${classIds}::uuid[]) or target_class_id = any(${classIds}::uuid[])) and valid_from<=${date}`;
  const byId = new Map();
  for (const r of rows) { const s = toSplit(R, r); if (s && R.splitPeriod.splitOverlapsRange(s, date, date)) byId.set(s.id, s); }
  const splits = [...byId.values()].filter(s => R.splitPeriod.splitActiveOn(s, date));
  if (splits.length === 0) return { splits, classNames: new Map() };
  const ids = [...new Set(splits.flatMap(s => [s.sourceClassId, s.targetClassId]))];
  const cls = await sql`select c.id::text id, c.class_name, u.display_name from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t} and c.id = any(${ids}::uuid[])`;
  return { splits, classNames: new Map(cls.map(c => [c.id, { name: c.class_name, teacherName: c.display_name ?? null }])) };
}

/** 2.0 `loadLiveSlots`(load.ts). classIds 없으면 그날 열리는 전 활성 반(데스크). */
export async function readLiveSlots(ctx, date, classIds, opts = {}) {
  const { sql, t, R, S, L, settings, toSplit } = ctx;
  if (!ISO.test(date)) return [];
  if (holidayNameOf(R, settings, date)) return [];
  const dayEnum = DOW_ENUM[R.date.weekdayIndexOf(date)];
  if (classIds && classIds.length === 0) return [];
  const slots = await sql`select id::text id, class_id::text class_id, start_time::text start_time, end_time::text end_time, teacher_id::text teacher_id, period_label, slot_teacher_label,
      classroom_id::text classroom_id, slot_room_label
    from public.class_schedules where tenant_id=${t} and day_of_week::text=${dayEnum} and valid_from<=${date} and (valid_to is null or valid_to>=${date})
      ${classIds ? sql`and class_id = any(${classIds}::uuid[])` : sql``} order by id`;
  if (slots.length === 0) return [];
  const slotClassIds = [...new Set(slots.map(s => s.class_id))];
  const [classRows, enrollRows, recordRows, reservedRaw, testRows, labSplit, splitsToday] = await Promise.all([
    sql`select id::text id, class_name, subject, is_active, closed_at::text closed_at, teacher_id::text teacher_id, classroom_id::text classroom_id
      from public.classes where tenant_id=${t} and id = any(${slotClassIds}::uuid[]) and is_active`,
    sql`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days::text[] attendance_days
      from public.enrollments where tenant_id=${t} and class_id = any(${slotClassIds}::uuid[]) and start_date<=${date} order by student_id`,
    sql`select id::text id, class_id::text class_id, student_id::text student_id, session_date::text session_date, slot_start::text slot_start, status::text status,
        to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at, recorded_by::text recorded_by, note
      from public.attendance_records where tenant_id=${t} and session_date=${date} and class_id = any(${slotClassIds}::uuid[]) order by id`,
    readReservationsOn(sql, t, date, slotClassIds),
    opts.excludeTestStudents ? sql`select id::text id from public.students where tenant_id=${t} and is_test` : [],
    readLabSplit(sql, t, R, S, slotClassIds, date),
    readSplitsOnDate(sql, t, R, toSplit, date, slotClassIds),
  ]);
  const testStudentIds = new Set(testRows.map(r => r.id));
  const activeClasses = new Map(classRows.filter(c => !c.closed_at || c.closed_at >= date).map(c => [c.id, c]));
  if (activeClasses.size === 0) return [];
  const reservedToday = reservedRaw.filter(r => activeClasses.has(r.classId)).filter(r => !testStudentIds.has(r.studentId));
  const reservedBySlot = new Map();
  for (const r of reservedToday) {
    const key = `${r.classId}|${r.slotStart}`, m = reservedBySlot.get(key) ?? new Map();
    if (!m.has(r.studentId)) m.set(r.studentId, { absenceDate: r.absenceDate, periodLabel: r.periodLabel });
    reservedBySlot.set(key, m);
  }
  const splitDayByClass = new Map(), splitInByClass = new Map();
  {
    const splits = splitsToday.splits.filter(x => !testStudentIds.has(x.studentId));
    for (const classId of activeClasses.keys()) {
      const d = L.splitAtt.splitDayOf(classId, date, splits);
      if (d.incoming.length === 0 && d.outgoing.length === 0) continue;
      splitDayByClass.set(classId, d);
      if (d.incoming.length) splitInByClass.set(classId, new Set(d.incoming.map(v => v.studentId)));
    }
  }
  const expectedByClass = new Map();
  for (const e of enrollRows) {
    if (!activeClasses.has(e.class_id) || testStudentIds.has(e.student_id)) continue;
    if (!R.elig.isEnrollmentActiveOn({ startDate: e.start_date ?? '0000-01-01', endDate: e.end_date, onHold: e.on_hold ?? false, isTransferred: e.is_transferred === true }, date)
      || !R.elig.enrollmentAttendsOnDay(e.attendance_days, dayEnum)) continue;
    (expectedByClass.get(e.class_id) ?? expectedByClass.set(e.class_id, new Set()).get(e.class_id)).add(e.student_id);
  }
  const expectedInClass = (classId, studentId) => (expectedByClass.get(classId)?.has(studentId) ?? false) || (splitInByClass.get(classId)?.has(studentId) ?? false);
  const effective = R.effective.effectiveAttendanceRecords(recordRows).filter(r => expectedInClass(r.class_id, r.student_id));
  const bySlot = new Map(), byDay = new Map(), slotHasRecord = new Set(), dayHasRecord = new Set();
  for (const r of effective) {
    const hit = { status: r.status, note: r.note, recordedAt: r.recorded_at, recordedBy: r.recorded_by, slot: r.slot_start ? L.signals.hhmm(r.slot_start) : null };
    if (r.slot_start) { const slot = L.signals.hhmm(r.slot_start); bySlot.set(`${r.class_id}|${slot}|${r.student_id}`, hit); slotHasRecord.add(`${r.class_id}|${slot}`); }
    else { byDay.set(`${r.class_id}|${r.student_id}`, hit); dayHasRecord.add(r.class_id); }
  }
  const studentIds = [...new Set([...[...expectedByClass.values()].flatMap(s => [...s]), ...reservedToday.map(r => r.studentId), ...[...splitInByClass.values()].flatMap(x => [...x])])];
  const [students, rooms] = await Promise.all([
    studentIds.length ? sql`select id::text id, name, english_name, school, grade, parent_phone, student_phone from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [],
    sql`select id::text id, name from public.classrooms where tenant_id=${t} order by id`,
  ]);
  const studentById = new Map(students.map(s => [s.id, s])), roomNameById = new Map(rooms.map(r => [r.id, r.name])), roomNames = rooms.map(r => r.name);
  const labDayByClass = new Map();
  if (labSplit) for (const s of slots) {
    if (R.tlabel.specialSlotLabel(s.slot_teacher_label) !== R.tlabel.LAB_ROOM_LABEL) continue;
    const cur = labDayByClass.get(s.class_id) ?? { sep: false, normal: false };
    if (labSplit.separateIds.has(String(s.id))) cur.sep = true; else cur.normal = true;
    labDayByClass.set(s.class_id, cur);
  }
  const out = [];
  for (const slot of slots) {
    const klass = activeClasses.get(slot.class_id);
    if (!klass) continue;
    const special = R.tlabel.specialSlotLabel(slot.slot_teacher_label), start = L.signals.hhmm(slot.start_time);
    const reservedHere = reservedBySlot.get(`${slot.class_id}|${start}`);
    const split = L.splitRoster.applySplitsToSlotRoster({ expected: new Set([...(expectedByClass.get(slot.class_id) ?? []), ...(reservedHere?.keys() ?? [])]), slotStart: start,
      slotEnd: slot.end_time ? L.signals.hhmm(slot.end_time) : null, day: splitDayByClass.get(slot.class_id), hasSlotRecord: sid => bySlot.has(`${slot.class_id}|${start}|${sid}`),
      classInfo: id => splitsToday.classNames.get(id) });
    const expected = split.expected;
    const labDay = special === R.tlabel.LAB_ROOM_LABEL ? labDayByClass.get(slot.class_id) : undefined;
    if (labSplit && labDay?.sep) {
      const slotSeparate = labSplit.separateIds.has(String(slot.id));
      for (const sid of [...expected]) {
        if (reservedHere?.has(sid) || split.marks.get(sid)?.dir === 'in') continue;
        const flagged = labSplit.flagged.has(L.labSplit.labSplitKey(slot.class_id, sid));
        if (!L.labSplit.labSplitSlotShows({ slotSeparate, flagged, dayHasSeparate: true, dayHasNormal: labDay.normal })) expected.delete(sid);
      }
    }
    if (expected.size === 0) continue;
    const hasAnyRecord = slotHasRecord.has(`${slot.class_id}|${start}`) || dayHasRecord.has(slot.class_id);
    const rows = [];
    for (const sid of expected) {
      const meta = studentById.get(sid);
      if (!meta) continue;
      const hit = bySlot.get(`${slot.class_id}|${start}|${sid}`) ?? byDay.get(`${slot.class_id}|${sid}`) ?? null;
      const status = L.signals.resolveSlotStatus(hit?.status, null);
      rows.push({ studentId: sid, studentName: meta.name, englishName: meta.english_name ?? null, schoolGrade: R.school.schoolGradeLabel(meta.school, meta.grade) || null,
        parentPhone: meta.parent_phone, studentPhone: meta.student_phone, status, note: hit?.note ?? null, recordSlot: hit?.slot ?? null, recordedAt: hit?.recordedAt ?? null,
        recordedBy: hit?.recordedBy ?? null, recordedByName: null, signal: L.signals.classifySignal(status, hasAnyRecord),
        ...(reservedHere?.has(sid) ? { reservedMakeup: reservedHere.get(sid) } : {}), ...(split.marks.has(sid) ? { splitMark: split.marks.get(sid) } : {}) });
    }
    rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'ko'));
    out.push({ key: `${slot.class_id}@${start}`, classId: slot.class_id, className: klass.class_name, subject: klass.subject, slotStart: start, saveSlot: L.slotAxis.saveSlotFor(klass.subject, start),
      slotEnd: slot.end_time ? L.signals.hhmm(slot.end_time) : null, periodLabel: slot.period_label,
      teacherId: R.axis.taughtByForSlot({ homeroomTeacherId: klass.teacher_id, slot: { teacherId: slot.teacher_id, slotTeacherLabel: slot.slot_teacher_label } }).teacherId,
      slotTeacherLabel: slot.slot_teacher_label, teacherName: null,
      roomName: L.floors.canonicalRoomName(L.floors.resolveRoomName({ slotClassroomName: slot.classroom_id ? (roomNameById.get(slot.classroom_id) ?? null) : null, slotRoomLabel: slot.slot_room_label,
        classClassroomName: klass.classroom_id ? (roomNameById.get(klass.classroom_id) ?? null) : null }), roomNames) ?? (special === 'LAB' ? '랩실' : special === 'JJ' ? 'JJ실' : null),
      students: rows, hasAnyRecord, recordedCount: rows.filter(r => r.status != null).length });
  }
  out.sort((a, b) => (a.slotStart === b.slotStart ? a.className.localeCompare(b.className, 'ko') : a.slotStart < b.slotStart ? -1 : 1));
  return out;
}

/** 출결 메뉴 권한 수준(2.0 `accessLevelTenant(role, 'attendance')` — 역할 덮어쓰기 + 개인 예외). */
export function attendanceLevelOf(R, settings, user) {
  const base = R.perms.resolveMatrix(settings.permissions?.overrides ?? []);
  return R.perms.accessLevel(user.role, 'attendance', R.perms.applyUserOverrides(base, user.id, user.role, settings.permissions?.userOverrides ?? []));
}
/** 2.0 `effectiveTeacherId`(관리자뷰 기준 — 3.0엔 강사뷰 쿠키가 없다): 강사 계정이면 그 사람, 아니면 없음. */
const viewTeacherIdOf = user => (user.role === 'teacher' ? user.id : null);

/** 2.0 `getLiveBoard(date, selfOnly)`(queries.ts) — user = { id, role }(띠에서 고른 사람). */
export async function readLiveBoard(ctx, user, date, selfOnly = false) {
  const { sql, t, R, L, settings } = ctx;
  const { day: today, hm } = await copyClock();
  const empty = { date, isToday: date === today, teachers: [], scopedToSelf: false, canEdit: false, totals: { expected: 0, recorded: 0, slots: 0 } };
  if (!user) return empty;
  const level = attendanceLevelOf(R, settings, user);
  if (level === 'none') return empty;
  const viewTeacherId = viewTeacherIdOf(user), scopedTeacherId = level === 'scoped' || selfOnly ? (viewTeacherId ?? user.id) : viewTeacherId;
  let classIds;
  if (scopedTeacherId) {
    classIds = await readLiveTeacherClassIds(sql, t, R, settings, scopedTeacherId, date);
    if (classIds.length === 0) return { ...empty, scopedToSelf: true, canEdit: level === 'scoped' || level === 'full' };
  }
  const ownerAxisId = viewTeacherId ?? user.id;
  const [slots, taught] = await Promise.all([readLiveSlots(ctx, date, classIds, { excludeTestStudents: !selfOnly }), readTaughtClassSet(sql, t, R, settings, ownerAxisId, date)]);
  const isToday = date === today, nowMin = minutesOf(hm);
  const ids = [...new Set([...slots.map(s => s.teacherId).filter(Boolean), ...slots.flatMap(s => s.students.map(st => st.recordedBy)).filter(Boolean)])];
  const names = ids.length ? await sql`select id::text id, display_name, phone from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
  const nameById = new Map(names.map(r => [r.id, { name: r.display_name ?? '', phone: r.phone }]));
  const phaseOf = slot => { if (!isToday) return 'ended'; const s = L.signals.hhmmToMin(slot.slotStart); return s == null ? 'before' : L.signals.slotPhase(nowMin, s, L.signals.hhmmToMin(slot.slotEnd)); };
  const bandOf = slot => { if (!isToday) return 'past'; const s = L.signals.hhmmToMin(slot.slotStart); return s == null ? 'upcoming' : L.nowBand.nowBandOf(nowMin, s, L.signals.hhmmToMin(slot.slotEnd)); };
  const byTeacher = new Map();
  for (const slot of slots) {
    const identity = L.group.groupIdentityOf(slot), key = L.group.identityKey(identity);
    const withPhase = { ...slot, students: slot.students.map(st => (st.recordedBy ? { ...st, recordedByName: nameById.get(st.recordedBy)?.name || null } : st)),
      teacherName: slot.teacherId ? (nameById.get(slot.teacherId)?.name ?? null) : null, phase: phaseOf(slot), band: bandOf(slot), ownedByMe: taught.has(slot.classId) || slot.teacherId === ownerAxisId };
    (byTeacher.get(key) ?? byTeacher.set(key, { identity, list: [] }).get(key)).list.push(withPhase);
  }
  const teachers = [...byTeacher.values()].map(({ identity, list }) => {
    const expected = list.reduce((n, s) => n + s.students.length, 0), recorded = list.reduce((n, s) => n + s.recordedCount, 0);
    return { ...L.group.groupHeaderOf(identity, identity.teacherId ? nameById.get(identity.teacherId) : null), slots: list, expected, recorded };
  }).sort((a, b) => { const ra = a.expected === 0 ? 1 : a.recorded / a.expected, rb = b.expected === 0 ? 1 : b.recorded / b.expected; return ra !== rb ? ra - rb : a.teacherName.localeCompare(b.teacherName, 'ko'); });
  return { date, isToday, teachers, scopedToSelf: !!scopedTeacherId, canEdit: level === 'full' || (level === 'scoped' && R.edit.isWithinAttendanceEditWindow(date, today)),
    totals: { expected: teachers.reduce((n, x) => n + x.expected, 0), recorded: teachers.reduce((n, x) => n + x.recorded, 0), slots: slots.length } };
}

/** 2.0 `getHolidayDayActivity(date, selfOnly, subject)`(server/holiday-activity.ts) — 휴원일에 입력된 출결·보강 예약(읽기 전용). */
export async function readHolidayDayActivity(ctx, user, date, selfOnly = false, subject = null) {
  const { sql, t, R, settings } = ctx;
  const empty = office => ({ date, students: 0, classes: 0, cells: 0, reservations: 0, excludedTestCells: 0, rows: [], officeScope: office });
  if (!ISO.test(date) || !user) return empty(false);
  const level = attendanceLevelOf(R, settings, user);
  if (level === 'none') return empty(false);
  const viewTeacherId = viewTeacherIdOf(user), scopedTeacherId = level === 'scoped' || selfOnly ? (viewTeacherId ?? user.id) : viewTeacherId;
  const classIds = scopedTeacherId ? await readLiveTeacherClassIds(sql, t, R, settings, scopedTeacherId, date) : null;
  if (classIds && classIds.length === 0) return empty(false);
  const [records, reservations, tests] = await Promise.all([
    sql`select id::text id, class_id::text class_id, student_id::text student_id, session_date::text session_date, slot_start::text slot_start, status::text status,
        to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
      from public.attendance_records where tenant_id=${t} and session_date=${date} ${classIds ? sql`and class_id = any(${classIds}::uuid[])` : sql``} order by id`,
    classIds ? readReservationsOn(sql, t, date, classIds) : sql`select id::text id, student_id::text "studentId", class_id::text "classId", left(slot_start::text, 5) "slotStart", left(slot_end::text, 5) "slotEnd"
      from public.makeup_reservations where tenant_id=${t} and makeup_date=${date} and status='reserved' order by slot_start, id`,
    sql`select id::text id from public.students where tenant_id=${t} and is_test`,
  ]);
  const testStudentIds = new Set(tests.map(r => r.id));
  const shownRecords = records.filter(r => !testStudentIds.has(r.student_id)), shownReservations = reservations.filter(r => !testStudentIds.has(r.studentId));
  const wantedClassIds = [...new Set([...records.map(r => r.class_id), ...shownReservations.map(r => r.classId)])];
  const wantedStudentIds = [...new Set([...shownRecords.map(r => r.student_id), ...shownReservations.map(r => r.studentId)])];
  const [classRows, studentRows] = await Promise.all([
    wantedClassIds.length ? sql`select id::text id, class_name, subject from public.classes where tenant_id=${t} and id = any(${wantedClassIds}::uuid[])` : [],
    wantedStudentIds.length ? sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${wantedStudentIds}::uuid[])` : [],
  ]);
  const activity = R.holidayAct.foldHolidayActivity({ date, records, reservations: reservations.map(r => ({ id: r.id, classId: r.classId, studentId: r.studentId, slotStart: r.slotStart, slotEnd: r.slotEnd })),
    testStudentIds, classScope: classIds ? new Set(classIds) : null, subject, classById: new Map(classRows.map(c => [c.id, { className: c.class_name ?? '', subject: String(c.subject ?? '') }])),
    studentNameById: new Map(studentRows.filter(s => s.name).map(s => [s.id, s.name])) });
  return { ...activity, officeScope: !scopedTeacherId };
}

/** 출결을 쓸 수 있는 직원(2.0 `canWriteTenant(role, 'attendance')` = 전체 ∪ 담당 반만) — 보호 계정 제외 · 원장 먼저. */
export async function attendanceWritersOf(sql, t, R, settings) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status='active' and display_name is not null order by display_name`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id));
  return users.filter(u => !operators.has(u.id)).map(u => ({ id: u.id, name: u.display_name, role: u.role, level: attendanceLevelOf(R, settings, u) }))
    .filter(u => u.level === 'full' || u.level === 'scoped')
    .sort((a, b) => (R.roles.ROLE_HIERARCHY[a.role] ?? 99) - (R.roles.ROLE_HIERARCHY[b.role] ?? 99) || a.name.localeCompare(b.name, 'ko'));
}

/** 2.0 `teacherViewHome`(lib/auth/teacher-home.ts)의 관리자뷰 갈래 — 강사 계정이면 담당 반 과목으로(영어 전담 = ECS), 그 밖 = 원스크린. */
async function homeHrefOf(ctx, user) {
  const { sql, t, L } = ctx;
  if (user.role !== 'teacher') return L.homeRule.DEFAULT_TEACHER_HOME;
  const rows = await sql`select distinct subject from public.classes where tenant_id=${t} and teacher_id=${user.id} and is_active`;
  return L.homeRule.teacherHomeFromClassSubjects(rows.map(r => r.subject).filter(Boolean)) ?? L.homeRule.DEFAULT_TEACHER_HOME;
}

/**
 * 2.0 `src/app/(shell)/attendance/quick/page.tsx`의 값 — 오늘 고정(날짜 매개변수 없음) · 보드 = getLiveBoard(오늘, selfOnly) · 학생 연락처는 지운다.
 * 휴원일이면 명단 없이 그날 입력(읽기 전용 패널)만.
 */
export async function quickProps(ctx, params) {
  const { sql, t, R, L, settings } = ctx;
  const { day: today } = await copyClock();
  const editors = await attendanceWritersOf(sql, t, R, settings);
  const viewer = editors.find(e => e.id === params.viewer) ?? editors[0] ?? null;
  const base = { page: 'quick', date: today, lang: 'ko', homeHref: viewer ? await homeHrefOf(ctx, viewer) : L.homeRule.DEFAULT_TEACHER_HOME,
    editors: editors.map(e => ({ id: e.id, name: e.name, role: R.roles.ROLE_LABEL?.[e.role] ?? '' })), viewer: viewer?.id ?? null };
  const holiday = holidayNameOf(R, settings, today);
  if (holiday) return { ...base, view: 'holiday', holiday, activity: viewer ? await readHolidayDayActivity(ctx, viewer, today, true) : null };
  const board = await readLiveBoard(ctx, viewer, today, true);
  const classes = L.quick.quickClasses(board).map(c => ({ ...c, students: c.students.map(s => ({ ...s, parentPhone: null, studentPhone: null })) }));
  return { ...base, view: 'board', classes, canEdit: board.canEdit };
}
