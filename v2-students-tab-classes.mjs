// 2.0 원생 상세 '수업' 탭(app/(shell)/students/[id]/_tabs/classes-tab.tsx) — 그 탭이 서버에서 읽던 값을 Docker 복사본에서 같은 결과로.
// · getStudentClassesDetail(수강마다 반·담임·강의실 + 유효 교시 · 분리등원 · 따로 수업(*LAB) 가르기 · 교시 라벨·담당·강의실 = 2.0 buildClassSlots·groupSchedule) ·
//   getClassesList({ active: "active" })(배정·반 이동 후보 — 운영 중 반 · 오늘 명단 인원 · 요일·시작시각) · 학원 설정 ·
//   getPastClassTeachers(지난 수업의 그 시점 담임 — 담임 이력 → 보고서 → 강사 출결 → 새 반 배정 강사, 2.0 resolvePastClassTeacher 그대로).
// · 지난 수업 목록(past)은 탭 본문과 같은 판정(isEnrollmentEndedOn · 오늘 = 복사본 날짜)으로 여기서도 골라 담임을 되살린다 — 탭은 그 결과(pastTeacherList)를 받는다.
// · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다. 읽기 전용 · 바깥 호출 없음.

const MODULES = { slots: 'features/students/lib/class-slots.ts', periodsGroup: 'features/classes/schedule-periods.ts', periods: 'features/timetable/lib/periods.ts',
  label: 'features/timetable/lib/teacher-label.ts', elig: 'features/enrollments/eligibility.ts', asOf: 'features/classes/teacher-as-of.ts',
  past: 'features/students/lib/past-class-teacher.ts', dk: 'lib/date-kst.ts', special: 'features/classes/special-lecture.ts' };
let rulesP = null;
export function classesTabRules(load) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** 표시용 실패 삼키기(2.0 fail-soft 자리) — 저장점 안에서 읽고 실패하면 대체값. */
const soft = (base, fn, fallback) => base.sql.soft(fn, fallback);

// ── getStudentClassesDetail ────────────────────────────────────────────────────────────────────────────────────────────
export async function readStudentClassesDetail(base, id) {
  const R = await classesTabRules(base.load), t = base.t, sql = base.sql;
  const ens = await sql`select e.id::text id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
      e.attendance_days::text[] attendance_days, c.class_name, c.subject, u.display_name teacher_name, cr.name classroom_name
    from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
      left join public.users u on u.id = c.teacher_id left join public.classrooms cr on cr.id = c.classroom_id
    where e.tenant_id=${t} and e.student_id=${id} order by e.start_date desc, e.id`;
  if (ens.length === 0) return [];
  const classIds = [...new Set(ens.map((e) => e.class_id))];
  const scheds = await sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time,
      valid_from::text valid_from, valid_to::text valid_to, slot_room_label, classroom_id::text classroom_id, teacher_id::text teacher_id, slot_teacher_label
    from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) order by id`;
  // 등록 강의실(보관 포함) — 실패하면 슬롯 라벨·반 기본 강의실로(2.0 .catch → []).
  const roomRows = await soft(base, (sp) => sp`select id::text id, name from public.classrooms where tenant_id=${t} order by id`, []);
  // getTeacherLabelMap — 닉네임 보유자(영어 이름이 있는 계정). 실패하면 원문 라벨(2.0 fail-soft).
  const nameRows = await soft(base, (sp) => sp`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`, []);
  const labelMap = R.label.buildTeacherLabelMap(nameRows.map((u) => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' })));
  // 따로 수업(*LAB) 재료 — 켠 교시 id · 이 원생의 켠 수강 id. 하나라도 모르면 null(안 가른다).
  const labSlotIds = await soft(base, async (sp) => new Set((await sp`select id::text id from public.class_schedules where tenant_id=${t} and lab_separate = true
      and class_id = any(${classIds}::uuid[]) order by id`).map((r) => r.id)), null);
  const labFlaggedEnrollments = await soft(base, async (sp) => new Set((await sp`select id::text id from public.enrollments where tenant_id=${t} and student_id=${id}
      and lab_separate = true`).map((r) => r.id)), null);
  const rooms = R.slots.roomBookOf(roomRows);
  const schedByClass = new Map();
  for (const s of scheds) {
    const arr = schedByClass.get(s.class_id) ?? [];
    arr.push({ day: s.day_of_week, startTime: String(s.start_time).slice(0, 5), endTime: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from ? s.valid_from.slice(0, 10) : null, validTo: s.valid_to ? s.valid_to.slice(0, 10) : null,
      roomId: s.classroom_id ?? null, roomLabel: s.slot_room_label ?? null, teacherId: s.teacher_id ?? null, teacherLabel: s.slot_teacher_label ?? null,
      ...(labSlotIds?.has(s.id) ? { labSeparate: true } : {}) });
    schedByClass.set(s.class_id, arr);
  }
  const slotTeacherIds = [...new Set(scheds.map((s) => s.teacher_id).filter(Boolean))];
  const slotTeacherNames = new Map();
  if (slotTeacherIds.length > 0) {
    const rows = await soft(base, (sp) => sp`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${slotTeacherIds}::uuid[])`, []);
    for (const u of rows) if (u.display_name) slotTeacherNames.set(u.id, u.display_name);
  }
  const periodsConfig = R.periods.settingsToPeriodsConfig(base.settings.operations);
  const today = base.today;
  return ens.map((e) => {
    const subject = e.subject ?? 'other';
    const attDays = Array.isArray(e.attendance_days) ? e.attendance_days : [];
    const attKo = attDays.map((d) => R.periods.enumDayToKo(d));
    const endYmd = R.elig.enrollmentLastDate(e.end_date ? e.end_date.slice(0, 10) : null, !!e.is_transferred);
    const refDate = endYmd && endYmd < today ? endYmd : today;
    const labFlagged = labSlotIds && labFlaggedEnrollments ? labFlaggedEnrollments.has(e.id) : null;
    const liveSlots = R.slots.liveScheduleRows(schedByClass.get(e.class_id) ?? [], refDate);
    const rawSlots = R.slots.filterLabSeparateRows(liveSlots, labFlagged);
    const classDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((d) => liveSlots.some((s) => s.day === d));
    const slots = R.slots.buildClassSlots(rawSlots, { subject, attendanceDaysKo: attKo, periodsConfig, classRoomName: e.classroom_name ?? null, rooms, labelMap,
      userNameById: slotTeacherNames });
    return { enrollmentId: e.id, classId: e.class_id, className: e.class_name ?? '?', subject, teacherName: e.teacher_name ?? null, startDate: e.start_date,
      endDate: e.end_date, isTransferred: !!e.is_transferred, onHold: e.on_hold, schedule: R.periodsGroup.groupSchedule(rawSlots, subject, attKo, periodsConfig),
      slots, attendanceDays: attDays, classDays };
  });
}

// ── getClassesList({ active: "active" }) ───────────────────────────────────────────────────────────────────────────────
const DOW_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** 반별 요일 → 가장 이른 시작시각(시각 없는 줄은 시각이 있는 줄에 진다) — 2.0 buildDaySlots. */
function buildDaySlots(scheds) {
  const byClass = new Map();
  for (const s of scheds) {
    const m = byClass.get(s.class_id) ?? new Map();
    const start = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = m.get(s.day_of_week);
    if (prev === undefined) m.set(s.day_of_week, start);
    else if (start !== null && (prev === null || start < prev)) m.set(s.day_of_week, start);
    byClass.set(s.class_id, m);
  }
  return byClass;
}
const sortedDaySlots = (m) => [...(m?.entries() ?? [])].sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0])).map(([day, start]) => ({ day, start }));

/** 운영 중 반 전부 — 반 이름순 · 오늘 명단 인원(isEnrollmentOnRosterOn) · 요일(유효 교시 우선, 없으면 지난 교시를 흐리게). */
export async function readActiveClassesList(base) {
  const R = await classesTabRules(base.load), t = base.t, sql = base.sql, today = base.today;
  const classes = await sql`select c.id::text id, c.class_name, c.subject, c.is_active, to_json(c.closed_at)#>>'{}' closed_at, c.is_special, c.notes, c.teacher_id::text teacher_id,
      u.display_name teacher_name, cr.name classroom_name
    from public.classes c left join public.users u on u.id = c.teacher_id left join public.classrooms cr on cr.id = c.classroom_id
    where c.tenant_id=${t} and c.is_active = true order by c.class_name, c.id`;
  if (classes.length === 0) return [];
  const classIds = classes.map((c) => c.id);
  const ens = await sql`select class_id::text class_id, start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments
    where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and (end_date is null or end_date >= ${today}::date)`;
  const counts = new Map();
  for (const e of ens) {
    if (!e.start_date || !R.elig.isEnrollmentOnRosterOn({ startDate: e.start_date, endDate: e.end_date ?? null, isTransferred: e.is_transferred ?? false }, today)) continue;
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }
  const scheds = await sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to
    from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) order by id`;
  const isLive = (r) => { const to = r.valid_to ? r.valid_to.slice(0, 10) : null; if (to && to < today) return false; const from = r.valid_from ? r.valid_from.slice(0, 10) : null; return !(from && from > today); };
  const live = buildDaySlots(scheds.filter(isLive)), any = buildDaySlots(scheds);
  return classes.map((c) => ({ id: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: c.teacher_name ?? null,
    classroomName: c.classroom_name ?? null, isActive: c.is_active, closedAt: c.closed_at ?? null, isSpecial: c.is_special ?? false, studentCount: counts.get(c.id) ?? 0,
    days: sortedDaySlots(live.get(c.id) ?? any.get(c.id)), daysStale: !live.get(c.id) && !!any.get(c.id), notes: c.notes ?? null }));
}

// ── getPastClassTeachers ───────────────────────────────────────────────────────────────────────────────────────────────
/** 담임 이력 색인 — 2.0 getHomeroomHistoryIndex(인수인계 적용·폼 담임 변경 감사로그 → 전이 → buildHomeroomHistoryIndex). 못 읽으면 접힌 표식(foldedReason). */
async function readHomeroomHistory(base, R) {
  const t = base.t;
  let incomplete = false;
  const failSoft = () => { incomplete = true; return []; };
  const logs = await base.sql.soft((sp) => sp`select metadata, target_label, to_json(created_at)#>>'{}' created_at from public.audit_logs
      where tenant_id=${t} and action = any(${['class_handover_apply', 'class_update']}) and metadata->>'newTeacherId' is not null order by created_at, id`, failSoft);
  const classRows = await base.sql.soft((sp) => sp`select id::text id, class_name from public.classes where tenant_id=${t} order by id`, failSoft);
  const classIdByUniqueName = R.asOf.buildUniqueClassNameIndex(classRows.map((c) => ({ id: c.id, name: c.class_name })));
  const teacherIds = [...new Set(logs.map((l) => l.metadata?.newTeacherId ?? null).filter((v) => typeof v === 'string' && v))];
  const nameOf = new Map();
  if (teacherIds.length) for (const u of await base.sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])`) nameOf.set(u.id, u.display_name ?? '');
  const transitions = logs.map((l) => {
    const teacherId = l.metadata?.newTeacherId ?? null;
    return { classId: R.asOf.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName }) ?? '',
      date: R.dk.kstDateOf(l.metadata?.effectiveDate) ?? R.dk.kstDateOf(l.created_at) ?? '', teacherId,
      previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null,
      teacherName: teacherId ? (nameOf.get(teacherId) ?? null) : null };
  }).filter((x) => !!x.classId && !!x.teacherId && !!x.date);
  return { index: R.asOf.buildHomeroomHistoryIndex(transitions), incomplete };
}

/** 지난 수업마다 그 시점 담임 — 2.0 getPastClassTeachers와 같은 차례·같은 판정(resolvePastClassTeacher). 반환 = [수강 id, 결과][]. */
export async function readPastClassTeachers(base, targets) {
  if (!targets.length) return [];
  const R = await classesTabRules(base.load), t = base.t, sql = base.sql;
  const classIds = [...new Set(targets.map((r) => r.classId))];
  const { index: history, incomplete } = await readHomeroomHistory(base, R);
  const classes = await sql`select id::text id, teacher_id::text teacher_id, to_json(created_at)#>>'{}' created_at from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`;
  const classById = new Map(classes.map((r) => [r.id, r])), current = new Map(classes.map((r) => [r.id, r.teacher_id]));
  const assignedIds = new Map(targets.map((x) => [x.enrollmentId, history.get(x.classId)?.length
    ? R.asOf.homeroomTeacherOnDate(history.get(x.classId), current.get(x.classId) ?? null, x.lastDate) : null]));
  const currentFallbackIds = new Map();
  if (!incomplete) for (const x of targets) {
    const klass = classById.get(x.classId);
    if (history.get(x.classId)?.length || !klass?.teacher_id || R.dk.kstDateOf(klass.created_at) !== x.startDate) continue;
    currentFallbackIds.set(x.enrollmentId, klass.teacher_id);
  }
  const ids = [...new Set([...assignedIds.values(), ...currentFallbackIds.values()].filter(Boolean))];
  const teachers = ids.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
  const names = new Map(teachers.map((u) => [u.id, u.display_name]));
  const missing = targets.filter((x) => !names.get(assignedIds.get(x.enrollmentId) ?? ''));
  let reports = [], attendance = [];
  if (missing.length) {
    const missingIds = [...new Set(missing.map((x) => x.classId))];
    const from = missing.reduce((d, x) => (x.startDate < d ? x.startDate : d), missing[0].startDate);
    const to = missing.reduce((d, x) => (x.lastDate > d ? x.lastDate : d), missing[0].lastDate);
    const reportRows = await sql`select class_id::text class_id, report_date::text report_date, teacher_name from public.lesson_reports
      where tenant_id=${t} and class_id = any(${missingIds}::uuid[]) and report_date <= ${to}::date and (makeup is null or makeup = false) and revoked_at is null order by id`;
    const attendanceRows = await sql`select a.class_id::text class_id, a.session_date::text session_date, u.display_name recorder_name
      from public.attendance_records a left join public.users u on u.id = a.recorded_by
      where a.tenant_id=${t} and a.class_id = any(${missingIds}::uuid[]) and a.session_date >= ${from}::date and a.session_date <= ${to}::date
        and a.recorded_via = 'teacher' and a.seat_label is null and a.status::text = any(${['present', 'late', 'early_leave']}) order by a.id`;
    reports = reportRows.map((r) => ({ classId: r.class_id, date: r.report_date, name: r.teacher_name ?? '' }));
    attendance = attendanceRows.map((r) => ({ classId: r.class_id, date: r.session_date, name: r.recorder_name ?? '' }));
  }
  const out = [];
  for (const x of targets) {
    const resolved = R.past.resolvePastClassTeacher(x, names.get(assignedIds.get(x.enrollmentId) ?? '') ?? null, reports, attendance,
      names.get(currentFallbackIds.get(x.enrollmentId) ?? '') ?? null);
    if (resolved) out.push([x.enrollmentId, resolved]);
  }
  return out;
}

/** 수업 탭 자료 — classes-tab.tsx의 Promise.all 이름 그대로 + 지난 수업 담임(탭 본문의 await getPastClassTeachers 자리). 차례대로(한 관문). */
export async function loadTab(ctx) {
  const { base, id } = ctx;
  const R = await classesTabRules(base.load);
  const rows = await readStudentClassesDetail(base, id);
  const allActiveClasses = await readActiveClassesList(base);
  // 탭 본문과 같은 판정 — 끝난 수강(오늘 = 복사본 날짜)의 마지막 날로 그 시점 담임을 되살린다.
  const past = rows.filter((r) => R.elig.isEnrollmentEndedOn(r.endDate, base.today, r.isTransferred));
  const pastTeacherList = await readPastClassTeachers(base, past.flatMap((r) => {
    const lastDate = R.elig.enrollmentLastDate(r.endDate, r.isTransferred);
    return lastDate ? [{ enrollmentId: r.enrollmentId, classId: r.classId, startDate: r.startDate, lastDate }] : [];
  }));
  return { rows, allActiveClasses, settings: { operations: base.settings.operations }, pastTeacherList };
}
