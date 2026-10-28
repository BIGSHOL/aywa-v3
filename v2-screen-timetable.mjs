// 2.0 화면 — 시간표 (V2-SCREENS.md · 원장 2026-10-28 *"바로가기를 만들지말고 새 페이지를 만들어 db는 docker로"*).
// 그리기는 2.0의 실제 React 부품이 한다(v2-host/ — 원장 10-28 *"시간표가 기존 2.0 뷰와 너무 다른데"*). 이 모듈은 2.0 page.tsx가
// 서버에서 받아 부품에 넘기던 **원자료**를 Docker 복사본에서 같은 모양으로 만든다:
//  · allSlots = 2.0 `getWeeklyScheduleWithStudents({ referenceDate, futureNames: true })`(features/timetable/server/queries.ts) —
//    표·칸·조건을 SQL로 그대로(서버 전용 모듈이라 불러올 수 없다), 판정은 2.0 순수 함수를 importV2로 그대로.
//  · settings = 2.0 `getTenantSettings()`의 operations·modules(resolveSettings의 같은 병합) · teacherColors = `getTeacherColorMap`
//    · teacherNicknames = `getTeacherNicknameMap` · labSeparateEnrollmentIds = `getLabSeparateEnrollmentIdSet` · seatPins = `getSeatPins`.
// 주·과목·보기 해석과 화면 조립은 호스트가 2.0 page.tsx와 같은 함수로 한다(v2-host/src/timetable-page.tsx).

const ID = 'timetable';
let rulesPromise = null;

/** 2.0 순수 모듈 — 한 번만 불러온다(실패하면 다음 요청에서 다시). */
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const at = p => importV2(p);
    const [week, grid, classGrid, periods, periodMatch, partition, integration, subjectDefault, kind, sort, moves, labels, lab, tone,
      moveNote, moveDate, split, order, emptyRows, hapban, rowSpan, seat, subjects, defaults, preset, modules, nameAsOf, teacherAsOf,
      special, track, eligibility, exitWindow, dateKst, schoolGrade, color, scheduledImport] = await Promise.all([
      'features/timetable/lib/week.ts', 'features/timetable/lib/grid.ts', 'features/timetable/lib/class-grid.ts',
      'features/timetable/lib/periods.ts', 'features/timetable/lib/period-match.ts', 'features/timetable/lib/weekday-partition.ts',
      'features/timetable/lib/integration-groups.ts', 'features/timetable/lib/subject-default.ts', 'features/timetable/lib/class-kind.ts',
      'features/timetable/lib/student-sort.ts', 'features/timetable/lib/scheduled-move.ts', 'features/timetable/lib/teacher-label.ts',
      'features/timetable/lib/lab-separate.ts', 'features/timetable/lib/student-tone.ts', 'features/timetable/lib/move-note.ts',
      'features/timetable/lib/move-date.ts', 'features/timetable/lib/split-attendance.ts', 'features/timetable/lib/teacher-order.ts',
      'features/timetable/lib/empty-period-rows.ts', 'features/timetable/lib/hapban.ts', 'features/timetable/lib/row-span.ts', 'features/attendance/seat/seat.ts',
      'features/owner/subjects.ts', 'features/owner/defaults.ts', 'features/owner/preset.ts', 'lib/modules.ts',
      'features/classes/class-name-as-of.ts', 'features/classes/teacher-as-of.ts', 'features/classes/special-lecture.ts',
      'features/classes/english-track.ts', 'features/enrollments/eligibility.ts', 'features/withdrawals/window.ts',
      'lib/date-kst.ts', 'lib/format/school-grade.ts', 'lib/color-utils.ts', 'features/timetable/scheduled-import.ts',
    ].map(at));
    return { ...week, ...grid, ...classGrid, ...periods, ...periodMatch, ...partition, ...integration, ...subjectDefault, ...kind, ...sort,
      ...moves, ...labels, ...lab, ...tone, ...moveNote, ...moveDate, ...split, ...order, ...emptyRows, ...hapban, ...rowSpan, MOVABLE_SEATS: seat.MOVABLE_SEATS, ...subjects,
      ...defaults, ...preset, ...modules, ...nameAsOf, ...teacherAsOf, ...special, ...track, ...eligibility, ...exitWindow, ...dateKst,
      ...schoolGrade, ...color, monthDay: scheduledImport.monthDay };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** features/owner/resolve.ts의 병합(운영·모듈 칸만 — 이 화면이 읽는 것). resolve.ts는 메뉴 모듈을 끌어와 불러올 수 없어 본문을 옮겼다(verify가 원문 대조). */
const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
export function deepMerge(base, stored) {
  if (!isPlainObject(base)) {
    return stored === undefined || stored === null ? base : stored;
  }
  if (!isPlainObject(stored)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key];
    const s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out;
}
export function normalizeSubjects(arr, base) {
  const defaults = new Map(base.operations.subjects.map((s) => [s.key, s]));
  return arr.map((s) => {
    const d = defaults.get(s.key);
    if (!d) return s;
    const out = { ...s };
    if (out.weekdayPeriods === undefined && d.weekdayPeriods) out.weekdayPeriods = d.weekdayPeriods;
    if (out.teacherViewLines === undefined && d.teacherViewLines) out.teacherViewLines = d.teacherViewLines;
    if (out.teacherViewStep === undefined && d.teacherViewStep !== undefined) out.teacherViewStep = d.teacherViewStep;
    return out;
  });
}

const hex = v => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : null);
const hm = t => String(t ?? '').slice(0, 5);
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

/** 학원 설정 — 2.0 `getTenantSettings`→`resolveSettings`의 운영·모듈 칸. */
async function readSettings(sql, t, R) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const stored = row?.data ?? null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const operations = deepMerge(base.operations, isPlainObject(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, isPlainObject(stored) ? stored.modules : undefined);
  return { operations: { ...operations, subjects: normalizeSubjects(operations.subjects, base) }, disabledModules: R.normalizeDisabledModules(mods.disabled) };
}

/** 지난 주 담임 되살리기 — 2.0 `getTeacherAsOfIndex`(인계·담임 변경 감사로그 + 그 달 보고서 작성자). */
async function readTeacherAsOf(sql, t, R, today) {
  const since = R.historyWindowStart(today);
  const [logs, classRows, writers] = await Promise.all([
    sql`select metadata, target_label, to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at from public.audit_logs
        where tenant_id=${t} and action in ('class_handover_apply','class_update') and metadata->>'newTeacherId' is not null order by created_at`,
    sql`select id, class_name from public.classes where tenant_id=${t}`,
    sql`select class_id, to_char(report_date,'YYYY-MM') as month, trim(teacher_name) teacher_name, count(*)::int count from public.lesson_reports
        where tenant_id=${t} and class_id is not null and report_date >= ${since} and coalesce(trim(teacher_name),'') <> '' group by 1,2,3`,
  ]);
  const classIdByUniqueName = R.buildUniqueClassNameIndex(classRows.map(c => ({ id: c.id, name: c.class_name })));
  const ids = [...new Set(logs.map(l => l.metadata?.newTeacherId).filter(v => typeof v === 'string' && v))];
  const nameOf = new Map((ids.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : []).map(u => [u.id, u.display_name ?? '']));
  const transitions = logs.map(l => {
    const teacherId = l.metadata?.newTeacherId ?? null;
    return {
      classId: R.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName }) ?? '',
      date: R.kstDateOf(l.metadata?.effectiveDate) ?? R.kstDateOf(l.created_at) ?? '',
      teacherId, previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null,
      teacherName: teacherId ? (nameOf.get(teacherId) ?? null) : null,
    };
  }).filter(x => x.classId && x.teacherId && x.date);
  return R.buildTeacherAsOfIndex({ transitions, writers: writers.map(w => ({ classId: w.class_id, month: w.month, teacherName: w.teacher_name, count: w.count })), since });
}

/** 미래 주의 반 이름 — 2.0 `getClassNameAsOfIndex`(예약된 가져오기의 개명, 되돌린 것 제외). */
async function readClassNameAsOf(sql, t, R, today) {
  const rows = await sql`select id, reference_date::text reference_date, payload->'apply'->'classUpdates' updates from public.timetable_snapshots
      where tenant_id=${t} and reference_date > ${today} order by reference_date limit 50`;
  if (!rows.length) return new Map();
  const restored = new Set((await sql`select snapshot_id from public.timetable_import_logs where tenant_id=${t} and snapshot_id = any(${rows.map(r => r.id)}::uuid[]) and restored_at is not null`).map(l => l.snapshot_id));
  const renames = [];
  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    for (const u of Array.isArray(r.updates) ? r.updates : []) if (u?.classId && u.className) renames.push({ classId: u.classId, from: u.prevClassName ?? null, to: u.className, date: r.reference_date.slice(0, 10) });
  }
  return R.buildClassNameAsOfIndex(renames);
}

/** 그 주 배치 — 2.0 `fetchSlots`. 이력 행(#88)은 요일 칸의 실제 날짜로 하나만 남긴다(slotLiveOnDate). */
async function readSlots(sql, t, R, ref, today) {
  const wk = R.weekBoundsOf(ref);
  const [nameRows, rows] = await Promise.all([
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    sql`select s.id::text id, s.day_of_week::text day_of_week, s.start_time::text start_time, s.end_time::text end_time, s.class_id::text class_id,
          s.slot_teacher_label, s.slot_room_label, s.classroom_id::text classroom_id, s.valid_from::text valid_from, s.valid_to::text valid_to,
          coalesce(s.lab_separate,false) lab_separate, st.display_name slot_teacher_name,
          c.class_name, c.subject, c.bg_color, c.text_color, c.closed_at::text closed_at, c.is_special, c.english_track,
          c.pending_teacher_id, c.pending_teacher_date::text pending_teacher_date, c.classroom_id::text class_room_id,
          ct.display_name class_teacher_name, pt.display_name pending_teacher_name, cr.name classroom_name
        from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active
        left join public.users st on st.id = s.teacher_id left join public.users ct on ct.id = c.teacher_id
        left join public.users pt on pt.id = c.pending_teacher_id left join public.classrooms cr on cr.id = c.classroom_id
        where s.tenant_id=${t} and s.valid_from <= ${wk.end} and (s.valid_to is null or s.valid_to >= ${wk.start})
        order by s.start_time, s.id`,
  ]);
  const labelMap = R.buildTeacherLabelMap(nameRows.map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' })));
  const visible = rows.filter(r => !(r.closed_at && r.closed_at < ref) && R.slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, ref));
  const [asOfIndex, nameIndex] = await Promise.all([
    R.weekSundayOf(ref) < today ? readTeacherAsOf(sql, t, R, today) : null,
    R.weekSundayOf(ref) >= today ? readClassNameAsOf(sql, t, R, today) : null,
  ]);
  const slots = visible.map(r => {
    const cellDate = R.dateOfDowInWeek(ref, r.day_of_week);
    const renamed = nameIndex && cellDate ? R.resolveClassNameAsOf(nameIndex, r.class_id, cellDate, r.class_name ?? null) : null;
    const asOf = asOfIndex && cellDate ? R.resolveTeacherAsOf(asOfIndex, r.class_id, cellDate) : null;
    return {
      id: r.id, classId: r.class_id,
      ...(renamed ? { className: renamed.name, classNameBefore: renamed.before, classNameChangeDate: renamed.date } : { className: r.class_name ?? '(삭제된 반)' }),
      subject: r.subject ?? '', dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time,
      teacherName: asOf ? R.resolveTeacherLabel(asOf.name, labelMap) : R.resolveTeacherLabel(r.class_teacher_name ?? null, labelMap),
      classroomName: r.classroom_name ?? null,
      slotTeacherLabel: R.resolveSlotTeacherLabel(r.slot_teacher_label, r.slot_teacher_name ? { display_name: r.slot_teacher_name } : null, labelMap),
      ...(R.isLabSeparateSlot(r.slot_teacher_label ?? null, r.lab_separate === true) ? { labSeparate: true } : {}),
      slotRoomLabel: r.slot_room_label ?? null, slotRoomId: r.classroom_id ?? null, classRoomId: r.class_room_id ?? null,
      classBgColor: r.bg_color ?? null, classTextColor: r.text_color ?? null,
      pendingHandover: r.pending_teacher_id ? { teacherName: R.resolveTeacherLabel(r.pending_teacher_name ?? null, labelMap), date: r.pending_teacher_date ?? null } : null,
      isSpecialLecture: R.isSpecialLecture({ isSpecial: r.is_special ?? null, className: r.class_name ?? null }),
      englishTrack: r.english_track ?? null,
    };
  });
  return { slots, labelMap };
}

/** 그 주 명단 — 2.0 `getWeeklyScheduleWithStudents`의 재원·대기·퇴원·신입·전입·예약 이동 판정 그대로. */
async function readRosters(sql, t, R, slots, ref) {
  const weekEnd = R.weekEndOf(ref), newCutoff = R.shiftDays(ref, -30), recentCutoff = R.shiftDays(ref, -60), withdrawnFloor = R.recentExitWindow(ref).from;
  const classIds = [...new Set(slots.map(s => s.classId))];
  if (!classIds.length) return new Map();
  const rows = await sql`select e.id::text id, e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date,
        e.on_hold, e.is_transferred, e.is_transferred_in, e.attendance_days, s.name, s.grade, s.school, s.english_name, s.status::text status, s.withdrawn_at::text withdrawn_at
      from public.enrollments e left join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and e.class_id = any(${classIds}::uuid[]) and e.start_date <= ${weekEnd} and (e.end_date is null or e.end_date >= ${withdrawnFloor})
      order by e.id`;
  const toMove = r => ({ id: r.id, classId: r.class_id, studentId: r.student_id, startDate: r.start_date, endDate: r.end_date, isTransferred: r.is_transferred === true, isTransferredIn: r.is_transferred_in === true });
  const classNameById = new Map(slots.map(s => [s.classId, s.className]));
  let moves = R.pairScheduledMoves(rows.map(toMove), ref);
  const unmated = new Set([...moves.out.values(), ...moves.in.values()].filter(m => !m.otherClassId).map(m => m.on));
  const unmatedStudents = [...new Set(rows.filter(r => (r.is_transferred && r.end_date && unmated.has(r.end_date)) || (r.is_transferred_in && unmated.has(r.start_date))).map(r => r.student_id))];
  if (unmatedStudents.length) {
    const mates = await sql`select e.id::text id, e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.is_transferred_in, c.class_name from public.enrollments e left join public.classes c on c.id = e.class_id
        where e.tenant_id=${t} and e.student_id = any(${unmatedStudents}::uuid[]) order by e.id`;
    if (mates.length) {
      const byId = new Map(rows.map(r => [r.id, toMove(r)]));
      for (const m of mates) { if (!byId.has(m.id)) byId.set(m.id, toMove(m)); if (m.class_name && !classNameById.has(m.class_id)) classNameById.set(m.class_id, m.class_name); }
      moves = R.pairScheduledMoves([...byId.values()], ref);
    }
  }
  const side = (which, id) => { const hit = (which === 'out' ? moves.out : moves.in).get(id); return hit ? { on: hit.on, className: hit.otherClassId ? (classNameById.get(hit.otherClassId) ?? null) : null } : undefined; };
  const rank = st => (st === 'active' ? 0 : st === 'hold' ? 1 : 2), chosen = new Map();
  for (const r of rows) {
    if (!r.name) continue;
    const start = r.start_date, stuWithdraw = r.status === 'withdrawn' ? (r.withdrawn_at ?? null) : null;
    const effectiveEnd = [r.end_date, stuWithdraw].filter(Boolean).sort()[0] ?? null;
    const hasEnded = R.isEnrollmentEndedOn(r.end_date, ref, r.is_transferred ?? false) || (stuWithdraw != null && stuWithdraw <= ref);
    if (hasEnded && r.is_transferred) continue;
    if (hasEnded && effectiveEnd < withdrawnFloor) continue;
    const status = hasEnded ? 'withdrawn' : start > ref || r.on_hold ? 'hold' : 'active';
    const line = {
      name: r.name, grade: r.grade ?? null, school: r.school ?? null, enrollmentId: r.id, studentId: r.student_id, status,
      endDate: status === 'withdrawn' ? effectiveEnd : undefined,
      isTransferredIn: status !== 'withdrawn' && r.is_transferred_in === true && start >= newCutoff,
      isNew: status !== 'withdrawn' && start >= newCutoff && r.is_transferred_in !== true,
      isRecent: status !== 'withdrawn' && start >= recentCutoff && start < newCutoff && r.is_transferred_in !== true,
      enrollmentDate: start, attendanceDays: r.attendance_days ?? [], englishName: r.english_name ?? null,
      movingOut: status === 'withdrawn' ? undefined : side('out', r.id), movingIn: status === 'withdrawn' ? undefined : side('in', r.id),
    };
    const key = `${r.class_id}:${r.student_id}`, prev = chosen.get(key);
    if (!prev || rank(status) < rank(prev.status) || (rank(status) === rank(prev.status) && (line.enrollmentDate ?? '') > (prev.enrollmentDate ?? ''))) chosen.set(key, line);
  }
  // 퇴원 줄 = 그 과목 수강이 하나도 안 남은 학생만(2.0 2026-07-13 결정).
  const withdrawnEntries = [...chosen].filter(([, l]) => l.status === 'withdrawn');
  if (withdrawnEntries.length) {
    const ids = [...new Set(withdrawnEntries.map(([, l]) => l.studentId))];
    const alive = await sql`select e.student_id::text student_id, e.end_date::text end_date, e.is_transferred, c.subject, s.status::text status, s.withdrawn_at::text withdrawn_at
        from public.enrollments e left join public.classes c on c.id = e.class_id left join public.students s on s.id = e.student_id
        where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) and e.start_date <= ${ref} and (e.end_date is null or e.end_date >= ${ref})`;
    const subjectOf = new Map(slots.map(s => [s.classId, s.subject])), aliveSubj = new Set();
    for (const r of alive) {
      if (R.isEnrollmentEndedOn(r.end_date, ref, r.is_transferred ?? false)) continue;
      if (r.status === 'withdrawn' && r.withdrawn_at && r.withdrawn_at <= ref) continue;
      if (r.subject) aliveSubj.add(`${r.subject}:${r.student_id}`);
    }
    for (const [key, line] of withdrawnEntries) { const subj = subjectOf.get(key.slice(0, key.indexOf(':'))); if (subj && aliveSubj.has(`${subj}:${line.studentId}`)) chosen.delete(key); }
  }
  const byClass = new Map();
  for (const [key, line] of chosen) { const c = key.slice(0, key.indexOf(':')); (byClass.get(c) ?? byClass.set(c, []).get(c)).push(line); }
  for (const list of byClass.values()) list.sort(R.compareStudentLines);
  await attachLatestReports(sql, t, slots, byClass);
  return byClass;
}

/** 학생 정보 카드의 최근 진도·교재 — 2.0과 같은 RPC(0150a `timetable_latest_reports`) · 같은 반 먼저 · 특강은 학생 단위 폴백 없음. */
async function attachLatestReports(sql, t, slots, byClass) {
  const ids = [...new Set([...byClass.values()].flat().map(l => l.studentId))];
  if (!ids.length) return;
  const rep = (await Promise.all(chunks(ids, 300).map(c => sql`select bucket, student_id::text student_id, report_date::text report_date, progress, exam_info, homework_score, teacher_name, textbook
      from public.timetable_latest_reports(${c}::uuid[], ${t}::uuid)`))).flat();
  const byClassKey = new Map(), bySubject = new Map();
  for (const r of rep) {
    if (r.bucket.startsWith('class:')) byClassKey.set(`${r.student_id}::${r.bucket.slice(6)}`, r);
    else if (r.bucket.startsWith('subject:')) bySubject.set(`${r.student_id}::${r.bucket.slice(8)}`, r);
  }
  const special = new Set(slots.filter(s => s.isSpecialLecture).map(s => s.classId)), subjectOf = new Map(slots.map(s => [s.classId, s.subject]));
  for (const [classId, list] of byClass) for (const l of list) {
    const r = special.has(classId) ? byClassKey.get(`${l.studentId}::${classId}`) : (byClassKey.get(`${l.studentId}::${classId}`) ?? bySubject.get(`${l.studentId}::${subjectOf.get(classId) ?? ''}`));
    if (!r) continue;
    l.latestReport = { date: r.report_date, progress: r.progress, examInfo: r.exam_info, homeworkScore: r.homework_score, teacherName: r.teacher_name };
    const book = (r.textbook ?? '').trim(); if (book) l.latestTextbook = { name: book, date: r.report_date };
  }
}


/** 자리(랩실) 교시 고정 — 2.0 `getSeatPins`: 고정 줄 + 그 주 자리 배치(이름 표식의 재료, 판정은 호스트가 2.0 applySeatPinMarks로). */
async function readSeatPins(sql, t, R, ref) {
  if (!R.MOVABLE_SEATS.length) return { pins: [], live: null };
  const rows = await sql`select seat, day_of_week::text day_of_week, class_id::text class_id, student_id::text student_id, slot_start::text slot_start, effective_from::text effective_from
      from public.seat_period_pins where tenant_id=${t} and seat = any(${[...R.MOVABLE_SEATS]}) order by id`;
  const pins = rows.map(r => ({ seat: r.seat, dayOfWeek: r.day_of_week, classId: r.class_id, studentId: r.student_id, slotStart: hm(r.slot_start), effectiveFrom: String(r.effective_from).slice(0, 10) }));
  if (!pins.length) return { pins, live: null };
  const wk = R.weekBoundsOf(ref);
  const live = await sql`select day_of_week::text "dayOfWeek", start_time::text "startTime", end_time::text "endTime", slot_teacher_label "slotTeacherLabel", valid_from::text "validFrom", valid_to::text "validTo"
      from public.class_schedules where tenant_id=${t} and slot_teacher_label is not null and valid_from <= ${wk.end} and (valid_to is null or valid_to >= ${wk.start}) order by id`;
  return { pins, live: live.map(r => ({ ...r })) };
}

/** 한 주의 원자료 — 2.0 page.tsx의 Promise.all(배치+명단 · 설정 · 강사 색 · 자리 고정 · LAB 따로 수업)과 같은 재료. */
export async function buildTimetableData({ sql, params, tenantId: t, R }) {
  const today = R.kstToday(), thisWk = R.thisMonday(today);
  const week = params.week && R.isValidYmd(params.week) ? R.mondayOf(params.week) : thisWk, ref = R.getWeekReferenceDate(week, today);
  const [settings, { slots: raw }, labSep, colorRows, nickRows, seatPins] = await Promise.all([
    readSettings(sql, t, R), readSlots(sql, t, R, ref, today),
    sql`select id::text id from public.enrollments where tenant_id=${t} and lab_separate`,
    sql`select display_name, english_name, bg_color, text_color from public.users where tenant_id=${t} and bg_color is not null`,
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    readSeatPins(sql, t, R, ref),
  ]);
  const rosters = await readRosters(sql, t, R, raw, ref);
  // 명단은 반별로 한 번만 보낸다 — 호스트가 2.0과 같은 모양(배치마다 students·studentCount)으로 다시 붙인다(같은 반 배치는 같은 명단).
  const allSlots = raw.map(s => ({ ...s, studentCount: (rosters.get(s.classId) ?? []).filter(l => l.status === 'active').length }));
  const relation = R.weekRelation(week, today);
  const teacherColors = {};
  for (const u of colorRows) { if (!hex(u.bg_color)) continue; const c = { bg: hex(u.bg_color), text: hex(u.text_color) ?? '#121212' }; if (u.display_name) teacherColors[u.display_name] = c; if (u.english_name) teacherColors[u.english_name] = c; }
  return {
    today, thisWeek: thisWk, week, referenceDate: ref, allSlots, rosters: Object.fromEntries(rosters),
    settings: { operations: settings.operations, modules: { disabled: settings.disabledModules } },
    teacherColors, teacherNicknames: R.buildTeacherNicknameMap(nickRows.map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' }))),
    labSeparateEnrollmentIds: labSep.map(r => r.id), seatPins,
    // 원장(관리자 계열)이 보는 2.0 화면 — 편집 문은 2.0처럼 '지난 주가 아니면' 열린다(끌기·그룹 설정). 저장은 1단계라 호스트의
    // 서버 액션 자리표시가 '복사본 보기 전용'으로 거절한다(2단계에서 actions로 잇는다). 수업 나누기는 2.0에서도 꺼져 있다.
    viewer: { canEdit: relation !== 'past', canEditRoster: relation !== 'past', canSplit: false, staffSubjects: [], saves: 'blocked' },
  };
}

export const screen = {
  id: ID, label: '시간표', order: 2,
  params: { week: /^\d{4}-\d{2}-\d{2}$/ },
  load: async ({ sql, params, tenantId, importV2 }) => buildTimetableData({ sql, params, tenantId, R: await loadRules(importV2) }),
};
export { loadRules };
