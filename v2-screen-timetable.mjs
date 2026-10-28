// 2.0 화면 — 시간표 (V2-SCREENS.md · 원장 2026-10-28 *"바로가기를 만들지말고 새 페이지를 만들어 db는 docker로"*).
// 2.0 `/timetable`(src/app/(shell)/timetable/page.tsx)이 보여 주는 것을 Docker 복사본에서 같은 규칙으로 다시 조립한다.
//  · 읽기 = 2.0 `getWeeklyScheduleWithStudents`(features/timetable/server/queries.ts)의 표·칸·조건을 SQL로 그대로.
//    서버 전용 모듈(supabase·server-only)이라 불러올 수 없어서 조회만 옮기고, 판정은 2.0 순수 함수를 importV2로 그대로 쓴다.
//  · 화면 조립 = 기본뷰 `weekday-group-tables.tsx`·통합뷰 `rich-card-group.tsx`의 계산(묶음·열·행·병합·카드)을 같은 함수로.
//    .tsx 안에만 있는 몇 줄(묶음 정의·강사 열·같은 반 합치기)과, 설정 타입 파일 때문에 못 불러오는 두 모듈
//    (weekday-groups.ts · view-default.ts)의 본문은 아래 PORTED에 옮겼다 — verify가 2.0 원문과 맞는지 잡는다.
// 화면은 이 모델을 그리기만 한다(v2-screen-timetable.js). 저장 자리는 1단계라 '복사본 보기 전용'으로 막는다.

const ID = 'timetable';
let rulesPromise = null;

/** 2.0 순수 모듈 — 한 번만 불러온다(실패하면 다음 요청에서 다시). */
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const at = p => importV2(p);
    const [week, grid, classGrid, periods, periodMatch, partition, integration, subjectDefault, kind, sort, moves, labels, lab, tone,
      moveNote, moveDate, split, order, emptyRows, hapban, rowSpan, subjects, defaults, preset, modules, nameAsOf, teacherAsOf,
      special, track, eligibility, exitWindow, dateKst, schoolGrade, color, scheduledImport] = await Promise.all([
      'features/timetable/lib/week.ts', 'features/timetable/lib/grid.ts', 'features/timetable/lib/class-grid.ts',
      'features/timetable/lib/periods.ts', 'features/timetable/lib/period-match.ts', 'features/timetable/lib/weekday-partition.ts',
      'features/timetable/lib/integration-groups.ts', 'features/timetable/lib/subject-default.ts', 'features/timetable/lib/class-kind.ts',
      'features/timetable/lib/student-sort.ts', 'features/timetable/lib/scheduled-move.ts', 'features/timetable/lib/teacher-label.ts',
      'features/timetable/lib/lab-separate.ts', 'features/timetable/lib/student-tone.ts', 'features/timetable/lib/move-note.ts',
      'features/timetable/lib/move-date.ts', 'features/timetable/lib/split-attendance.ts', 'features/timetable/lib/teacher-order.ts',
      'features/timetable/lib/empty-period-rows.ts', 'features/timetable/lib/hapban.ts', 'features/timetable/lib/row-span.ts',
      'features/owner/subjects.ts', 'features/owner/defaults.ts', 'features/owner/preset.ts', 'lib/modules.ts',
      'features/classes/class-name-as-of.ts', 'features/classes/teacher-as-of.ts', 'features/classes/special-lecture.ts',
      'features/classes/english-track.ts', 'features/enrollments/eligibility.ts', 'features/withdrawals/window.ts',
      'lib/date-kst.ts', 'lib/format/school-grade.ts', 'lib/color-utils.ts', 'features/timetable/scheduled-import.ts',
    ].map(at));
    return { ...week, ...grid, ...classGrid, ...periods, ...periodMatch, ...partition, ...integration, ...subjectDefault, ...kind, ...sort,
      ...moves, ...labels, ...lab, ...tone, ...moveNote, ...moveDate, ...split, ...order, ...emptyRows, ...hapban, ...rowSpan, ...subjects,
      ...defaults, ...preset, ...modules, ...nameAsOf, ...teacherAsOf, ...special, ...track, ...eligibility, ...exitWindow, ...dateKst,
      ...schoolGrade, ...color, monthDay: scheduledImport.monthDay };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── PORTED: 2.0 원문 그대로(불러올 수 없는 자리). 바꾸면 verify-v2-screen-timetable.mjs가 원문과 비교해 잡는다. ──
/** features/owner/settings-types.ts */
export const WEEKDAY_GROUPINGS = ['mon-thu', 'mon-tue', 'mon-wed-fri', 'mon-tue-seq', 'none'];
export const SUBJECT_DEFAULT_VIEWS = ['basic', 'integrated', 'teacher'];
/** features/timetable/lib/weekday-groups.ts */
export const PARTITIONS = {
  'mon-thu': [['mon', 'thu'], ['tue', 'fri'], ['wed']],
  'mon-tue': [['mon', 'tue'], ['thu', 'fri'], ['wed']],
  'mon-wed-fri': [['mon', 'wed', 'fri'], ['tue', 'thu']],
  'mon-tue-seq': [['mon', 'tue'], ['wed', 'thu'], ['fri']],
  none: [['mon'], ['tue'], ['wed'], ['thu'], ['fri']],
};
const isBuiltin = v => WEEKDAY_GROUPINGS.includes(v);
export function resolveWeekdayGroups(R, value, customs) {
  if (typeof value === 'string' && isBuiltin(value)) return PARTITIONS[value];
  const custom = typeof value === 'string' ? customs?.find(row => row.id === value) : undefined;
  const parsed = custom ? R.parseWeekdayPartition(custom.groups) : null;
  return parsed ?? PARTITIONS['mon-thu'];
}
export function sortDaysInGroup(days, group) {
  const rank = new Map(group.map((day, index) => [day, index]));
  return [...days].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
}
export function timetableBoards(groups) {
  const weekdays = [], weekend = [];
  for (const group of groups) {
    const days = group.filter(d => d !== 'sat' && d !== 'sun'), ends = group.filter(d => d === 'sat' || d === 'sun');
    if (days.length) weekdays.push(days);
    if (ends.length) weekend.push(ends);
  }
  return { weekdays, weekend: weekend.length ? weekend : null };
}
const WEEKEND_ORDER = ['sat', 'sun'];
export function weekendBoardDays(groups) {
  const weekend = timetableBoards(groups).weekend;
  if (!weekend) return null;
  const seen = new Set(weekend.flat()), filled = weekend.map(g => [...g]);
  for (const day of WEEKEND_ORDER) if (!seen.has(day)) filled.push([day]);
  return filled.sort((a, b) => WEEKEND_ORDER.indexOf(a[0]) - WEEKEND_ORDER.indexOf(b[0]));
}
/** features/timetable/lib/view-default.ts */
export function subjectDefaultView(subjects, key) {
  const raw = subjects?.find(s => s.key === key)?.defaultView;
  return SUBJECT_DEFAULT_VIEWS.includes(raw ?? '') ? raw : 'basic';
}
/** features/owner/resolve.ts — 운영(operations)·모듈 칸만(이 화면이 읽는 것). */
const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
export function deepMerge(base, stored) {
  if (!isPlainObject(base)) return stored === undefined || stored === null ? base : stored;
  if (!isPlainObject(stored)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key], s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out;
}
function normalizeSubjects(arr, base) {
  const defaults = new Map(base.operations.subjects.map(s => [s.key, s]));
  return arr.map(s => {
    const d = defaults.get(s.key); if (!d) return s;
    const out = { ...s };
    if (out.weekdayPeriods === undefined && d.weekdayPeriods) out.weekdayPeriods = d.weekdayPeriods;
    if (out.teacherViewLines === undefined && d.teacherViewLines) out.teacherViewLines = d.teacherViewLines;
    if (out.teacherViewStep === undefined && d.teacherViewStep !== undefined) out.teacherViewStep = d.teacherViewStep;
    return out;
  });
}
/** _components/weekday-group-tables.tsx 상수·계산 */
export const PERIOD_COL_W = 96, DAY_COL_W = 66, TEACHER_HEAD_H = 32;
const GROUP_TINTS = ['blue', 'purple', 'primary', 'rose', 'amber'];
export function buildWeekdayGroupDefs(R, groups) {
  return groups.map((days, i) => ({ title: days.map(d => R.DAY_LABEL[d] ?? d).join('/'), days, tint: GROUP_TINTS[i % GROUP_TINTS.length], merge: days.length >= 2 }));
}
const WEEKEND_GROUP = { title: '주말', days: ['sat', 'sun'], tint: 'amber', merge: false };
const DAY_OFFSET = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
export function dayDateLabels(weekMonday) {
  const [y, m, d] = weekMonday.split('-').map(Number), out = {};
  for (const day of Object.keys(DAY_OFFSET)) { const dt = new Date(Date.UTC(y, m - 1, d + DAY_OFFSET[day])); out[day] = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`; }
  return out;
}
export function buildGroups(R, slots, defs, order) {
  const teachers = Array.from(new Set(slots.map(s => s.teacherName ?? '—'))), out = [];
  for (const def of defs) {
    const daySet = new Set(def.days), cols = [];
    for (const t of R.sortTeachersByOrder(teachers, order?.[R.teacherGroupKey(def.days)])) {
      const days = sortDaysInGroup([...new Set(slots.filter(s => (s.teacherName ?? '—') === t && daySet.has(s.dayOfWeek)).map(s => s.dayOfWeek))], def.days);
      if (days.length) cols.push({ name: t, days });
    }
    if (cols.length) out.push({ ...def, teachers: cols });
  }
  return out;
}
export function mergeSlotsByClass(slots) {
  const byClass = new Map();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)).push(s);
  const out = [];
  for (const g of byClass.values()) {
    const first = g[0];
    out.push({ ...first, startTime: g.reduce((m, s) => (s.startTime < m ? s.startTime : m), first.startTime), endTime: g.reduce((m, s) => (s.endTime > m ? s.endTime : m), first.endTime) });
  }
  return out.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
/** _components/student-rows.tsx `metaLabel` */
const metaLabel = (R, school, grade) => { const sg = R.formatSchoolGrade(school, grade, { numberLast: true }); return sg === '-' ? '' : sg; };
/** _components/timetable-color.ts `timetableStudentTone`(색 강도 기본 = 쨍하게) — 줄 색의 종류만 넘긴다. */
const toneOf = s => (s.isTransferredIn ? 'transferIn' : s.isNew ? 'new' : s.isRecent ? 'recent' : '');
/** _components/rich-card-group.tsx 상수 */
export const RICH = { NAME_ROOM_H: 60, TEACHER_H: 24, DAYHEAD_H: 22, PERIOD_H: 32, STU_H: 26, LABEL_W: 104, CARD_W: 275, SECTION_PAD: 8 };
RICH.DAY_COL_W = RICH.CARD_W / 5;
const sectionH = rows => (rows > 0 ? rows * RICH.STU_H + RICH.SECTION_PAD : 0);
const abbrev = label => (label.length > 4 ? label.slice(0, 4) : label);
// ── PORTED 끝 ──

/** DB의 색 문자열은 hex만 화면 style로 보낸다(그 밖은 버리고 과목색으로). */
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

/** 화면에 보낼 학생 줄 — 이름·학교학년·색 종류·예약 이동·정보 카드(2.0 StudentRow·StudentInfoCard가 쓰는 칸). */
function studentOut(R, s, thisClassName, badge) {
  const saved = R.savedMoveView({ status: s.status, movingOut: s.movingOut, movingIn: s.movingIn, thisClassName });
  const days = s.attendanceDays ?? [];
  return {
    n: s.name, sg: metaLabel(R, s.school, s.grade), st: s.status ?? 'active', tone: s.status === 'withdrawn' || s.status === 'hold' ? s.status : toneOf(s),
    id: s.studentId ?? null, ...(badge ? { badge } : {}), ...(s.labSeparate ? { lab: true } : {}),
    ...(saved ? { move: { arrow: saved.side === 'out' ? '→' : '←', on: R.shortMoveDate(saved.on), title: saved.title } } : {}),
    card: {
      englishName: s.englishName ?? null, isNew: !!s.isNew, isTransferredIn: !!s.isTransferredIn, enrollmentDate: s.enrollmentDate ?? null,
      partial: days.length ? `${days.map(d => R.DAY_LABEL[d] ?? d).join('·')}만 등원` : null, endDate: s.status === 'withdrawn' ? (s.endDate ?? null) : null,
      sg: R.formatSchoolGrade(s.school, s.grade, { numberLast: true }), report: s.latestReport ?? null, textbook: s.latestTextbook?.name ?? null,
    },
    days,
  };
}

/** 반 머리 색 — 반 지정색이 먼저(2.0 class-cell), 없으면 과목색(색 강도 '쨍하게'). */
const headerOf = (R, subjects, slot) => { const bg = hex(slot.classBgColor); return bg ? { bg, fg: hex(slot.classTextColor) ?? R.readableTextColor(bg) } : { color: subjects.colorOf(slot.subject) }; };

function classOut(R, subjects, slot) {
  const active = slot.students.filter(s => (s.status ?? 'active') === 'active');
  return {
    classId: slot.classId, className: slot.className, room: slot.classroomName ?? '', head: headerOf(R, subjects, slot), count: active.length,
    counts: { active: active.length, hold: slot.students.filter(s => s.status === 'hold').length, withdrawn: slot.students.filter(s => s.status === 'withdrawn').length },
    teacher: slot.teacherName ?? null, schedule: `${hm(slot.startTime)}~${hm(slot.endTime)}`, subject: slot.subject,
    rename: slot.classNameBefore ? `${slot.classNameChangeDate ? R.monthDay(slot.classNameChangeDate) : ''}부터 ${slot.classNameBefore} → ${slot.className}${slot.classroomName ? ` · ${slot.classroomName}` : ''}` : null,
    handover: slot.pendingHandover ?? null,
  };
}

/** 기본뷰 한 칸 — 2.0 `SubSlotContent`/`ClassCell`/`HapbanCell`의 명단 구획(재원 공통·요일별·대기·퇴원). */
function cellContent(R, subjects, acc, coveringDays, subSlot) {
  const merged = mergeSlotsByClass(acc);
  const split = (list, daysOf) => {
    const all = s => { const ad = daysOf(s); return ad.length === 0 || coveringDays.every(d => ad.includes(d)); };
    const byDay = coveringDays.length >= 2 && list.some(s => !all(s));
    return { common: byDay ? list.filter(all) : list, partial: byDay ? coveringDays.map(day => ({ day: R.DAY_LABEL[day] ?? day, students: list.filter(s => !all(s) && daysOf(s).includes(day)) })) : [] };
  };
  if (merged.length >= 2) {
    const roster = R.buildHapbanRoster(merged), seg = new Map(merged.map(m => [m.classId, m.className]));
    const out = s => studentOut(R, s, seg.get(s.ownClassId) ?? '', s.label);
    const sp = split(roster.active, s => s.displayAttendanceDays ?? []);
    return { kind: 'hapban', subSlot, segments: merged.map((m, i) => ({ index: i + 1, ...classOut(R, subjects, m) })),
      common: sp.common.map(out), partial: sp.partial.map(p => ({ day: p.day, students: p.students.map(out) })), hold: roster.hold.map(out), withdrawn: roster.withdrawn.map(out),
      handover: merged.some(m => m.pendingHandover) };
  }
  const slot = merged[0], active = slot.students.filter(s => (s.status ?? 'active') === 'active');
  const out = s => studentOut(R, s, slot.className);
  const sp = split(active, s => s.attendanceDays ?? []);
  return { kind: 'class', subSlot, cls: classOut(R, subjects, slot), common: sp.common.map(out), partial: sp.partial.map(p => ({ day: p.day, students: p.students.map(out) })),
    hold: slot.students.filter(s => s.status === 'hold').map(out), withdrawn: slot.students.filter(s => s.status === 'withdrawn').map(out) };
}

/** 기본뷰 표 하나(평일 판 · 주말 판) — 2.0 `GroupTable`. */
function groupTable(R, subjects, { slots, subject, groups, weekend, rowHeight, config, dateOf, wideDays, collapseEmpty, hideStudents }) {
  const isMathFamily = !weekend && !R.isPerPeriodSubject(subject, config);
  const periodList = weekend ? R.subjectWeekendPeriods(config) : R.subjectWeekdayPeriods(subject, config);
  const matchPeriod = R.buildPeriodMatcher(periodList);
  const rowKeyOf = s => { const id = matchPeriod({ startTime: s.startTime, endTime: s.endTime }); return id ? `p-${id}` : `x-${hm(s.startTime)}`; };
  const toMin = x => { const [h, m] = hm(x).split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const rowMap = new Map();
  for (const p of periodList) rowMap.set(`p-${p.id}`, { key: `p-${p.id}`, label: R.periodListLabel(p), time: `${hm(p.startTime)}~${hm(p.endTime)}`, order: toMin(p.startTime) });
  for (const s of slots) { const st = hm(s.startTime); if (!matchPeriod({ startTime: s.startTime, endTime: s.endTime }) && !rowMap.has(`x-${st}`)) rowMap.set(`x-${st}`, { key: `x-${st}`, label: st, time: st, order: toMin(st) }); }
  const rows = [...rowMap.values()].sort((a, b) => a.order - b.order);
  const occupied = new Set(slots.map(rowKeyOf)), isCollapsed = key => collapseEmpty && !occupied.has(key);
  const cell = new Map();
  for (const s of slots) { const k = `${s.teacherName ?? '—'}::${s.dayOfWeek}::${rowKeyOf(s)}`; (cell.get(k) ?? cell.set(k, []).get(k)).push(s); }
  const pairs = [];
  if (isMathFamily) for (let ri = 0; ri + 1 < rows.length; ri++) {
    const a = /^p-(\d+)$/.exec(rows[ri].key)?.[1], b = /^p-(\d+)$/.exec(rows[ri + 1].key)?.[1];
    if (a && b && Number(a) % 2 === 1 && Number(b) === Number(a) + 1) pairs.push([ri, ri + 1]);
  }
  const EMPTY_H = R.EMPTY_PERIOD_ROW_H, rowH = key => (isCollapsed(key) ? EMPTY_H : rowHeight);
  const prepared = groups.map(g => ({ ...g, teachers: g.teachers.map(t => {
    const cellAt = (ri, ci) => cell.get(`${t.name}::${t.days[ci]}::${rows[ri].key}`) ?? [];
    const raw = R.computeBlocks(rows.length, t.days.length, (ri, ci) => R.cellClassKey(cellAt(ri, ci).map(s => s.classId)), g.merge);
    const { blocks, subSlots } = R.expandHalfPeriodBlocks({ blocks: raw, pairs, occupied: (ri, ci) => cellAt(ri, ci).length > 0 });
    return { ...t, cellAt, blocks, subSlots };
  }) }));
  const dayCols = groups.flatMap(g => g.teachers.flatMap(t => t.days));
  const head = groups.flatMap((g, gi) => g.teachers.map((t, ti) => ({ name: t.name, span: t.days.length, edge: gi > 0 && ti === 0 })));
  const dayHead = groups.flatMap((g, gi) => g.teachers.flatMap((t, ti) => t.days.map((d, ci) => ({ day: R.DAY_LABEL[d] ?? d, date: dateOf(d) ?? '', tint: g.tint, edge: gi > 0 && ti === 0 && ci === 0 }))));
  const HEADER_H = 60, HAPBAN_BADGE_H = 30;
  const outRows = rows.map((row, ri) => {
    const pid = /^p-(\d+)$/.exec(row.key)?.[1], mathN = isMathFamily && pid ? Number(pid) : null, next = rows[ri + 1];
    const nextPid = next ? /^p-(\d+)$/.exec(next.key)?.[1] : undefined, paired = mathN !== null && nextPid !== undefined && Number(nextPid) === mathN + 1;
    const labelCollapsed = paired ? isCollapsed(row.key) && isCollapsed(next.key) : isCollapsed(row.key);
    const labelText = mathN !== null ? `${Math.ceil(mathN / 2)}교시` : row.label;
    const timeText = mathN !== null ? `${row.time.split('~')[0]}~${(paired ? next : row).time.split('~')[1]}` : row.time;
    const label = mathN !== null && mathN % 2 === 0 ? null : { text: labelText, start: timeText.split('~')[0], end: timeText.includes('~') ? timeText.split('~')[1] : null, span: paired ? 2 : 1, collapsed: labelCollapsed, height: paired ? rowH(row.key) + rowH(next.key) : rowH(row.key) };
    const cells = [];
    prepared.forEach((g, gi) => g.teachers.forEach((t, ti) => t.days.forEach((d, ci) => {
      const block = t.blocks.get(`${ri}:${ci}`); if (!block) return;
      const acc = [];
      for (let rr = ri; rr < ri + block.rowSpan; rr++) for (let cc = ci; cc < ci + block.colSpan; cc++) acc.push(...t.cellAt(rr, cc));
      const edge = gi > 0 && ti === 0 && ci === 0, classIds = new Set(acc.map(x => x.classId));
      if (!acc.length) { cells.push({ rowSpan: block.rowSpan, colSpan: block.colSpan, edge, empty: true, height: isCollapsed(row.key) ? EMPTY_H - 12 : block.rowSpan * rowHeight - 16 }); return; }
      const minH = hideStudents ? HEADER_H + (classIds.size >= 2 ? HAPBAN_BADGE_H : 0) : 0;
      cells.push({ rowSpan: block.rowSpan, colSpan: block.colSpan, edge, height: Math.max(minH, block.rowSpan * rowHeight - 16),
        content: cellContent(R, subjects, acc, t.days.slice(ci, ci + block.colSpan), t.subSlots.get(`${ri}:${ci}`) ?? 'full') });
    })));
    return { key: row.key, height: rowH(row.key), label, cells };
  });
  return { id: weekend ? 'we' : 'wd', sticky: !weekend, cols: [PERIOD_COL_W, ...dayCols.map(d => (wideDays.has(d) ? DAY_COL_W * 2 : DAY_COL_W))], head, dayHead, rows: outRows };
}

/** 기본뷰 — 2.0 `WeekdayGroupTables`(평일 판 + 주말 판). */
function basicModel(R, subjects, { slots, config, week, dayGroups, collapseEmpty, hideStudents }) {
  const subject = slots[0]?.subject ?? 'math', dates = dayDateLabels(week), dateOf = d => dates[d];
  const rowHeight = R.periodRowFullHeight(hideStudents);
  const isWeekend = s => s.dayOfWeek === 'sat' || s.dayOfWeek === 'sun';
  const wdSlots = slots.filter(s => !isWeekend(s)), weSlots = slots.filter(isWeekend);
  const boards = timetableBoards(dayGroups), wdDefs = buildWeekdayGroupDefs(R, boards.weekdays);
  const wdWide = new Set(wdDefs.filter(g => g.days.length === 1).flatMap(g => g.days));
  const weDays = weekendBoardDays(dayGroups), weDefs = weDays ? buildWeekdayGroupDefs(R, weDays).map(g => ({ ...g, tint: 'amber' })) : [WEEKEND_GROUP];
  const weWide = new Set(weDays ? weDefs.filter(g => g.days.length === 1).flatMap(g => g.days) : ['sat', 'sun']);
  const wdGroups = buildGroups(R, wdSlots, wdDefs), weGroups = buildGroups(R, weSlots, weDefs);
  const base = { subject, rowHeight, config, dateOf, hideStudents };
  return { tables: [
    ...(wdGroups.length ? [groupTable(R, subjects, { ...base, slots: wdSlots, groups: wdGroups, weekend: false, wideDays: wdWide, collapseEmpty })] : []),
    ...(weGroups.length ? [groupTable(R, subjects, { ...base, slots: weSlots, groups: weGroups, weekend: true, wideDays: weWide, collapseEmpty: false })] : []),
  ] };
}

/** 통합뷰 — 2.0 `RichGridView`→`buildRichCardGroups`(반=열 카드 · 시작 교시 줄)·`ClassColumn`의 칸 계산. */
function integratedModel(R, subjects, { slots, config, customGroups, teacherColors, nicknames, hideStudents }) {
  const groups = R.buildRichCardGroups(slots, config, new Set(), customGroups);
  return { groups: groups.map(g => {
    const rr = hideStudents ? { active: 0, hold: 0, withdrawn: 0 } : g.rosterRows;
    const rows = R.visibleSpanRows(g.periodRows, g.rowPlan), moved = R.movedByTarget(g.rowPlan);
    const rowTime = new Map(g.periodRows.map(r => [r.order, r.time]));
    const cellOut = (card, order, day, rowT) => {
      const c = card.cells[`${order}:${day}`]; if (!c) return null;
      const startOf = x => (x ?? '').split('~')[0] ?? '';
      const offAxis = c.time && rowT && startOf(rowT) && startOf(rowT) !== startOf(c.time) ? c.time : null;
      if (c.isLab) {
        const separate = c.labSeparate === true && c.label === R.LAB_ROOM_LABEL;
        return { text: separate ? R.LAB_SEPARATE_LABEL : c.label, lab: c.label === R.LAB_ROOM_LABEL ? 'lab' : 'jj', separate, tip: separate ? (c.time ? `${R.LAB_SEPARATE_TIP} · ${c.time}` : R.LAB_SEPARATE_TIP) : [c.time ? `${c.label} · ${c.time}` : c.label, ...(c.notes ?? [])].join('\n'), offAxis };
      }
      if (!c.label) return { blank: true, tip: c.time || '' };
      const tc = teacherColors[c.label];
      return { text: abbrev(c.label), tip: [c.time ? `${c.label} · ${c.time}` : c.label, ...(c.notes ?? [])].join('\n'), offAxis, ...(tc ? { bg: tc.bg, fg: tc.text } : { color: R.teacherColor(c.label) }) };
    };
    return {
      key: g.key, label: g.label, rosterRows: rr, activeH: sectionH(rr.active), holdH: sectionH(rr.hold), wdH: sectionH(rr.withdrawn),
      rows: rows.map(p => ({ order: p.order, text: p.time || p.label })),
      cards: g.cards.map(card => {
        const days = R.padCardDays(card.days?.length ? card.days : g.days), cls = { className: card.className };
        const out = s => studentOut(R, s, cls.className);
        return {
          classId: card.classId, className: card.className, room: card.classroomLabel, teacher: card.teacherName, nick: card.teacherName ? (nicknames?.[card.teacherName] ?? null) : null,
          head: hex(card.bgColor) ? { bg: hex(card.bgColor), fg: hex(card.textColor) ?? '#121212' } : { soft: subjects.colorOf(card.subject) }, subject: card.subject,
          width: Math.max(3, days.length) * RICH.DAY_COL_W, days: days.map(d => ({ key: d, label: R.DAY_LABEL[d] ?? d, weekend: d === 'sat' || d === 'sun' })),
          grid: rows.map(p => days.map(d => ({ cell: cellOut(card, p.order, d, p.time),
            moved: (moved.get(p.order) ?? []).map(m => { const mc = card.cells[`${m.from}:${d}`]; if (!mc) return null; const paints = !!mc.isLab || !!mc.label;
              return { box: R.movedCellBox(m, RICH.PERIOD_H), paints, line: paints && !R.movedCellStartsOnRowLine(m), cell: cellOut(card, m.from, d, rowTime.get(m.from)) }; }).filter(Boolean) }))),
          count: card.activeCount, counts: { active: card.activeCount, hold: card.hold.length, withdrawn: card.withdrawn.length },
          active: card.active.map(out), hold: card.hold.map(out), withdrawn: card.withdrawn.map(out),
        };
      }),
    };
  }) };
}

/** 화면 한 장 — 2.0 page.tsx의 주·과목·구분·프로그램·뷰 해석과 같은 순서. */
export async function buildTimetable({ sql, params, tenantId: t, R }) {
  const today = R.kstToday(), thisWk = R.thisMonday(today);
  const week = params.week && R.isValidYmd(params.week) ? R.mondayOf(params.week) : thisWk, ref = R.getWeekReferenceDate(week, today);
  const kind = R.parseTimetableKind(params.kind);
  const [settings, { slots: allRaw }, labSepEnrollments, colorRows] = await Promise.all([
    readSettings(sql, t, R), readSlots(sql, t, R, ref, today),
    sql`select id::text id from public.enrollments where tenant_id=${t} and lab_separate`,
    sql`select display_name, english_name, bg_color, text_color from public.users where tenant_id=${t} and bg_color is not null`,
  ]);
  const rosters = await readRosters(sql, t, R, allRaw, ref);
  const allSlots = allRaw.map(s => { const roster = rosters.get(s.classId) ?? []; return { ...s, students: roster, studentCount: roster.filter(l => l.status === 'active').length }; });
  const ops = settings.operations, config = R.settingsToPeriodsConfig(ops), subjects = R.buildSubjectMaps(ops.subjects);
  const makeup = R.isMakeupKind(kind);
  const kindSlots = allSlots.filter(s => R.matchesTimetableKind(kind, s.isSpecialLecture));
  const available = makeup ? subjects.options.map(o => o.value) : subjects.options.map(o => o.value).filter(k => kindSlots.some(s => s.subject === k));
  const subject = R.resolveTimetableSubject(available, [], params.subject);
  const trackApplies = subject === 'english' && R.isModuleEnabled(settings.disabledModules, 'eie');
  const etrack = trackApplies ? R.normalizeEnglishTrackFilter(params.etrack ?? 'all') : 'all';
  const allowsTeacherView = k => k === 'english' || (ops.subjects.find(s => s.key === k)?.teacherViewLines?.length ?? 0) > 0;
  const defaultView = subjectDefaultView(ops.subjects, subject), teacherViewAllowed = allowsTeacherView(subject);
  const asked = params.view ?? defaultView, view = asked === 'teacher' && !teacherViewAllowed ? 'basic' : asked;
  const hideStudents = params.students === 'hide', collapseEmpty = params.emptyperiods === 'collapse';
  const labIds = new Set(labSepEnrollments.map(r => r.id));
  const slots = R.applyLabSeparateMarks(R.keepEnglishTrack(kindSlots.filter(s => s.subject === subject), etrack), labIds);
  const subjectRow = ops.subjects.find(s => s.key === subject);
  const teacherColors = {};
  for (const u of colorRows) { if (!hex(u.bg_color)) continue; const c = { bg: hex(u.bg_color), text: hex(u.text_color) ?? '#121212' }; if (u.display_name) teacherColors[u.display_name] = c; if (u.english_name) teacherColors[u.english_name] = c; }
  const nicknames = subject === 'english' ? R.buildTeacherNicknameMap((await sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`).map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' }))) : undefined;
  const ready = !makeup && (view === 'basic' || view === 'integrated');
  return {
    today, week, thisWeek: thisWk, referenceDate: ref, weekLabel: R.weekLabel(week), relation: R.weekRelation(week, today),
    prevWeek: R.addWeeks(week, -1), nextWeek: R.addWeeks(week, 1),
    subject, subjectLabel: subjects.labelOf(subject), subjects: available.map(k => ({ value: k, label: subjects.labelOf(k), defaultView: subjectDefaultView(ops.subjects, k), teacherView: allowsTeacherView(k) })),
    kind, kinds: R.TIMETABLE_KINDS.map(k => ({ value: k, label: R.TIMETABLE_KIND_LABEL[k] })),
    trackApplies, etrack, tracks: R.ENGLISH_TRACK_FILTERS.map(v => ({ value: v, label: R.ENGLISH_TRACK_FILTER_LABEL[v] })),
    view, defaultView, views: [{ value: 'basic', label: '기본뷰', ready: true }, { value: 'integrated', label: '통합뷰', ready: true },
      ...(teacherViewAllowed ? [{ value: 'teacher', label: '강사뷰', ready: false }] : []), { value: 'rooms', label: '교실뷰', ready: false }],
    hideStudents, collapseEmpty, classCount: new Set(slots.map(s => s.classId)).size, memoSheet: subject === 'english' && view === 'integrated',
    pending: makeup ? 'makeup' : ready ? null : view,
    basic: ready && view === 'basic' && slots.length ? basicModel(R, subjects, { slots, config, week, dayGroups: resolveWeekdayGroups(R, subjectRow?.weekdayGrouping, ops.weekdayGroupings), collapseEmpty, hideStudents }) : null,
    integrated: ready && view === 'integrated' && slots.length ? integratedModel(R, subjects, { slots, config, customGroups: R.resolveIntegrationGroups(subjectRow), teacherColors, nicknames, hideStudents }) : null,
    empty: ready && !slots.length ? (kind === 'special' ? { caption: '이 기간에 등록된 특강이 없습니다', sub: "반을 만들 때 '특강'을 켜면 여기에 표시됩니다 (운영 종료일이 지난 특강은 자동으로 내려갑니다)" } : { caption: '해당 과목의 시간표가 없습니다', sub: '가져오기 또는 편집으로 반을 배치해 보세요' }) : null,
  };
}

export const screen = {
  id: ID, label: '시간표', order: 2,
  params: { subject: /^[a-z][a-z0-9_]{0,30}$/, view: /^(basic|integrated|teacher|rooms)$/, kind: /^(regular|special|all|makeup)$/,
    week: /^\d{4}-\d{2}-\d{2}$/, etrack: /^(all|eie|injaewon)$/, students: /^(hide|show)$/, emptyperiods: /^(collapse|show)$/ },
  load: async ({ sql, params, tenantId, importV2 }) => buildTimetable({ sql, params, tenantId, R: await loadRules(importV2) }),
};
export { loadRules };
