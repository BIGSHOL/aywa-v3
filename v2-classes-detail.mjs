// 2.0 화면 — 반 상세(/classes/<id>) 조회. 2.0 page.tsx가 서버에서 부르던 함수들을 Docker 복사본에서 같은 결과로:
//  getClassDetail · getClassStudents · getClassAttendanceStats(30일) · getStudentsList({status:'enrolled'}) · getClassTeacherOptions ·
//  getClassDelegationList · getClassHistory · getScheduledClassChanges · getScheduledForClass · getClassLabSeparateEnrollmentIds.
// 표·칸·조건은 2.0 쿼리 그대로 SQL로, 판정(수강 단계 · 유효 출결 · 예약 분류)은 2.0 순수 함수(importV2) 그대로.
// 이력은 조회 결과만 같은 모양으로 넘기고 조립은 화면 묶음(classes-detail.tsx assembleClassHistory)이 한다 — 감사 상세 문구 함수가 화면 부품을 함께 불러와 서버에서 못 돌린다.
// 감사 동작 이름표(AUDIT_ACTIONS)는 서버 전용 파일(features/audit/server/log.ts)에 있어 그 파일의 글자에서 표만 읽는다(같은 원본).
// 화면 주인 = 원장 — 권한 칸은 2.0 판정 함수(메뉴 권한 표 · 날짜 편집 · 원생 상태)에 원장 역할을 넣어 계산한다.
// 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { readFile } from 'node:fs/promises';

let detailRules = null;
function loadDetailRules(importV2) {
  detailRules ??= (async () => {
    const [eligibility, effective, calc, dk, asOf, scheduled, due, english, dateAccess, statusAccess, statusPerm, perms, preset] = await Promise.all([
      'features/enrollments/eligibility.ts', 'features/attendance/effective-records.ts', 'lib/calc/attendance.ts', 'lib/date-kst.ts',
      'features/classes/teacher-as-of.ts', 'features/enrollments/scheduled-changes.ts',
      'features/timetable/due-class-updates.ts', 'features/classes/english-track.ts', 'features/enrollments/date-access.ts',
      'features/students/status-access.ts', 'features/owner/student-status-permissions.ts', 'lib/permissions.ts', 'features/owner/preset.ts',
    ].map(p => importV2(p)));
    return { eligibility, effective, calc, dk, asOf, scheduled, due, english, dateAccess, statusAccess, statusPerm, perms, preset,
      auditLabels: await readAuditLabels() };
  })().catch(error => { detailRules = null; throw error; });
  return detailRules;
}

/** 2.0 auditActionLabel = AUDIT_ACTIONS[action] ?? action — 표는 log.ts의 `export const AUDIT_ACTIONS = { … } as const;` 글자 그대로. */
async function readAuditLabels() {
  const text = (await readFile(new URL('../../src/features/audit/server/log.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const i = text.indexOf('export const AUDIT_ACTIONS = {'), j = text.indexOf('\n} as const;', i);
  if (i < 0 || j < 0) throw new Error('AUDIT_ACTIONS 표를 찾지 못했습니다');
  const ts = (await import('typescript')).default;
  const js = ts.transpileModule(`(${text.slice(i + 'export const AUDIT_ACTIONS = '.length, j + 2)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const table = new Function(`return ${js.trim().replace(/;$/, '')}`)();
  return Object.freeze({ ...table });
}

/** 실패해도 화면은 여는 조회(2.0 fail-soft) — 저장점 안에서 돌리고 실패면 null. 같은 연결의 다른 조회와 겹치지 않게 늘 혼자 부른다. */
const soft = (sql, fn) => sql.savepoint(fn).catch(() => null);

const CLASS_HISTORY_ACTIONS = ['class_update', 'class_period_enrollments', 'class_archive', 'class_unarchive', 'class_end_term', 'class_reopen_term',
  'class_schedule_move', 'class_handover_apply', 'class_handover_schedule', 'class_handover_cancel', 'class_handover_bulk', 'class_delegate',
  'class_delegate_revoke', 'classroom_auto_assign'];

/** getClassDetail(id) — 원장 보기라 canViewClassDetail은 늘 통과. 없거나 다른 지점이면 null. */
async function readClassDetail(sql, t, D, id, today) {
  const [c] = await sql`select c.id::text id, c.class_name, c.subject, c.is_active, c.closed_at::text closed_at, c.is_special, c.report_optout, c.english_track,
      c.notes, c.bg_color, c.teacher_id::text teacher_id, c.classroom_id::text classroom_id, c.pending_teacher_id::text pending_teacher_id,
      c.pending_teacher_date::text pending_teacher_date, c.pending_teacher_reason, u.display_name teacher_name, pu.display_name pending_teacher_name, r.name classroom_name
    from public.classes c left join public.users u on u.id=c.teacher_id left join public.users pu on pu.id=c.pending_teacher_id left join public.classrooms r on r.id=c.classroom_id
    where c.tenant_id=${t} and c.id=${id}`;
  if (!c) return null;
  const [schedules, enrollRows] = await Promise.all([
    sql`select id::text id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label
      from public.class_schedules where tenant_id=${t} and class_id=${id} order by day_of_week, start_time`,
    sql`select start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments
      where tenant_id=${t} and class_id=${id} and (end_date is null or end_date >= ${today}::date)`,
  ]);
  // loadLabSeparateIds({ kind: 'class' }) — 표식 칸이 없거나 실패하면 null(모름). 실패를 가두는 저장점은 다른 조회와 겹치지 않게 따로.
  const labIds = await soft(sql, s => s`select id::text id from public.class_schedules where tenant_id=${t} and class_id=${id} and lab_separate order by id`).then(rows => (rows ? new Set(rows.map(r => r.id)) : null));
  const phases = enrollRows.map(e => D.eligibility.enrollmentPhaseOn({ startDate: e.start_date, endDate: e.end_date ?? null, isTransferred: e.is_transferred ?? false }, today));
  return {
    id: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: c.teacher_name ?? null, classroomId: c.classroom_id,
    classroomName: c.classroom_name ?? null, isActive: c.is_active, closedAt: c.closed_at ?? null, isSpecial: c.is_special ?? false, reportOptout: c.report_optout ?? false,
    englishTrack: D.english.readEnglishTrack(c), notes: c.notes, bgColor: c.bg_color ?? null, pendingTeacherId: c.pending_teacher_id ?? null,
    pendingTeacherName: c.pending_teacher_name ?? null, pendingTeacherDate: c.pending_teacher_date ?? null, pendingTeacherReason: c.pending_teacher_reason ?? null,
    scheduleSlots: schedules.map(s => ({ id: s.id, dayOfWeek: s.day_of_week, startTime: s.start_time.slice(0, 5), endTime: s.end_time.slice(0, 5), validFrom: s.valid_from,
      validTo: s.valid_to, teacherId: s.teacher_id ?? null, classroomId: s.classroom_id ?? null, slotTeacherLabel: s.slot_teacher_label ?? null, labSeparate: labIds?.has(s.id) ?? false })),
    labSeparateKnown: labIds !== null,
    studentCount: phases.filter(p => p === 'active' || p === 'leaving').length,
    upcomingCount: phases.filter(p => p === 'upcoming').length,
  };
}

/** getClassStudents(classId) — 오늘 기준 아직 끝나지 않은 수강(예정 포함), 시작일 늦은 순. */
async function readClassStudents(sql, t, D, id, today) {
  const rows = await sql`select e.id::text id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.is_transferred_in, e.attendance_days,
      s.id::text student_id, s.name, s.english_name, s.grade, s.school
    from public.enrollments e join public.students s on s.id=e.student_id
    where e.tenant_id=${t} and e.class_id=${id} and (e.end_date is null or e.end_date >= ${today}::date) order by e.start_date desc`;
  return rows.flatMap(e => {
    const endDate = e.end_date ?? null, isTransferred = e.is_transferred ?? false;
    const phase = D.eligibility.enrollmentPhaseOn({ startDate: e.start_date, endDate, isTransferred }, today);
    if (phase === 'ended') return [];
    return [{ phase, enrollmentId: e.id, studentId: e.student_id, name: e.name, englishName: e.english_name ?? null, grade: e.grade, school: e.school,
      enrolledAt: e.start_date, endDate, isTransferred, isTransferredIn: !!e.is_transferred_in, onHold: e.on_hold, attendanceDays: e.attendance_days ?? [] }];
  });
}

/** getClassAttendanceStats(classId, 30) — 정정 줄은 최신 하나만(effectiveAttendanceRecords) · 출석률 = (출석+지각) ÷ 기록 칸. */
async function readAttendanceStats(sql, t, D, id, today, days = 30) {
  const since = D.dk.addDays(today, -days);
  const raw = await sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start,
      ${ISO(sql, 'recorded_at')} recorded_at, status::text status from public.attendance_records where tenant_id=${t} and class_id=${id} and session_date >= ${since}::date order by id`;
  const rows = D.effective.effectiveAttendanceRecords(raw);
  const count = s => rows.filter(r => r.status === s).length;
  const total = rows.length, present = count('present'), absent = count('absent'), late = count('late'), excused = count('excused');
  return { total, present, absent, late, excused, rate: D.calc.attendanceRate(D.calc.attendedCount({ present, late }), total) };
}

/** getStudentsList({ status: 'enrolled' }) — 배정 후보에 쓰는 칸만(이름·학년·학교). 2.0 기본 정렬 = 학년 · 이름 · id. */
const readEnrolledStudents = (sql, t) => sql`select id::text id, name, grade, school from public.students where tenant_id=${t} and status::text='enrolled' order by grade, name, id`;

/** getClassDelegationList(classId) — 아직 안 끝난 임시 위임(해제 안 됨 · to_date ≥ 오늘), 시작일 순 50개. */
async function readDelegations(sql, t, id, today) {
  const rows = await sql`select d.id::text id, d.delegate_user_id::text delegate_user_id, d.from_date::text from_date, d.to_date::text to_date, d.reason, d.created_at::text created_at, u.display_name
    from public.class_delegations d left join public.users u on u.id=d.delegate_user_id and u.tenant_id=${t}
    where d.tenant_id=${t} and d.class_id=${id} and d.revoked_at is null and d.to_date >= ${today}::date order by d.from_date limit 50`;
  return rows.map(r => ({ id: r.id, delegateUserId: r.delegate_user_id, delegateName: r.display_name ?? null, fromDate: r.from_date, toDate: r.to_date, reason: r.reason ?? null, createdAt: r.created_at }));
}

/**
 * getClassHistory(classId)의 조회 부분 — 결과를 2.0 조회와 같은 모양({ data } · 배열 · 실패면 null)으로 넘긴다.
 * 조립(배치 구간·감사 상세 문구·위임·수강·보고서 작성 기록 합치기)은 화면 묶음의 assembleClassHistory가 2.0 본문 그대로 한다
 * (감사 상세 문구 함수가 화면 부품을 함께 불러와 서버에서 못 돌린다). 날짜·시각 글자도 PostgREST가 주던 모양(UTC ISO)으로.
 */
async function readHistoryParts(sql, t, D, id, today, subjects) {
  const [klass] = await sql`select class_name from public.classes where tenant_id=${t} and id=${id}`;
  const className = klass?.class_name ?? '';
  const [slotRows, delegations, users, reports, rooms] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${id} order by valid_from desc, day_of_week`,
    sql`select delegate_user_id::text delegate_user_id, from_date::text from_date, to_date::text to_date, reason, ${ISO(sql, 'revoked_at')} revoked_at, ${ISO(sql, 'created_at')} created_at
      from public.class_delegations where tenant_id=${t} and class_id=${id} order by from_date desc`,
    sql`select id::text id, display_name from public.users where tenant_id=${t}`,
    sql`select report_date::text report_date, teacher_name from public.lesson_reports where tenant_id=${t} and class_id=${id}
      and report_date >= ${D.asOf.historyWindowStart(today)}::date order by report_date`,
    sql`select id::text id, name from public.classrooms where tenant_id=${t}`,
  ]);
  // 2.0에서 실패해도 null로 넘어가는 두 조회(감사로그 · 수강 이력) — 저장점은 하나씩.
  const auditRows = await soft(sql, s => s`select action, actor_name, metadata, ${ISO(s, 'created_at')} created_at from public.audit_logs
    where tenant_id=${t} and action = any(${CLASS_HISTORY_ACTIONS}) and target_type='class'
      and (metadata->>'classId' = ${id} ${className ? s`or (metadata->>'classId' is null and target_label = ${className})` : s``}) order by created_at desc`);
  const enrollmentRows = await soft(sql, s => s`select e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.is_transferred_in,
      json_build_object('name', st.name) students
    from public.enrollments e join public.students st on st.id=e.student_id where e.tenant_id=${t} and e.class_id=${id} order by e.start_date desc, e.id desc`);
  const auditLabels = Object.fromEntries([...new Set((auditRows ?? []).map(l => l.action))].filter(a => a in D.auditLabels).map(a => [a, D.auditLabels[a]]));
  return { slotRows: { data: [...slotRows] }, delegations: { data: [...delegations] }, nameRows: { data: [...users] }, reportRows: { data: [...reports] },
    roomRes: { data: [...rooms] }, auditRows: auditRows ? [...auditRows] : null, enrollmentRows: enrollmentRows ? [...enrollmentRows] : null, auditLabels, subjects };
}
/** timestamptz → PostgREST가 내던 글자(UTC ISO · null은 null). 날짜만 자르는 소비처가 세션 시간대에 흔들리지 않게. */
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;

/** getScheduledClassChanges(classId, current) — 시간표 가져오기가 미뤄 둔 반 자체 변경(담임·강의실·이름), 되돌린 예약 제외. */
async function readScheduledClassChanges(sql, t, D, current, today) {
  const rows = await sql`select id::text id, reference_date::text reference_date, payload->'apply'->'classUpdates' updates from public.timetable_snapshots
    where tenant_id=${t} and reference_date > ${today}::date order by reference_date`;
  if (!rows.length) return [];
  const restored = new Set((await sql`select snapshot_id::text snapshot_id from public.timetable_import_logs where tenant_id=${t}
    and snapshot_id = any(${rows.map(r => r.id)}::uuid[]) and restored_at is not null`).map(l => l.snapshot_id));
  const raw = [], needTeacher = new Set(), needRoom = new Set();
  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    const date = r.reference_date.slice(0, 10);
    for (const u of Array.isArray(r.updates) ? r.updates : []) {
      if (u?.classId !== current.id) continue;
      raw.push({ date, u });
      for (const x of [u.teacherId, u.prevTeacherId]) if (x) needTeacher.add(x);
      for (const x of [u.classroomId, u.prevClassroomId]) if (x) needRoom.add(x);
    }
  }
  if (!raw.length) return [];
  const [teachers, rooms] = await Promise.all([
    needTeacher.size ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...needTeacher]}::uuid[])` : [],
    needRoom.size ? sql`select id::text id, name from public.classrooms where tenant_id=${t} and id = any(${[...needRoom]}::uuid[])` : [],
  ]);
  const teacherName = new Map(teachers.map(x => [x.id, x.display_name])), roomName = new Map(rooms.map(x => [x.id, x.name]));
  const out = [];
  for (const { date, u } of raw) {
    if (u.teacherId && current.teacherId === (u.prevTeacherId ?? null)) out.push({ kind: 'teacher', effectiveDate: date, fromLabel: current.teacherId ? (teacherName.get(current.teacherId) ?? null) : null, toLabel: teacherName.get(u.teacherId) ?? null });
    if (u.classroomId && current.classroomId === (u.prevClassroomId ?? null)) out.push({ kind: 'classroom', effectiveDate: date, fromLabel: current.classroomId ? (roomName.get(current.classroomId) ?? null) : null, toLabel: roomName.get(u.classroomId) ?? null });
    if (D.due.shouldApplyName(u, current.className)) out.push({ kind: 'name', effectiveDate: date, fromLabel: u.prevClassName ?? current.className, toLabel: u.className ?? null });
  }
  return out;
}

/** getScheduledForClass(classId) — 예약된 명단 변동(미래 시작 · 미래 종료), 같은 학생의 다른 반 예약까지 읽어 짝을 맞춘다. */
async function readScheduledForClass(sql, t, D, id, today) {
  const pick = where => sql`select e.id::text id, e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date,
      e.is_transferred, e.is_transferred_in, c.class_name, s.name student_name
    from public.enrollments e left join public.classes c on c.id=e.class_id left join public.students s on s.id=e.student_id
    where e.tenant_id=${t} and ${where} and (e.start_date > ${today}::date or e.end_date > ${today}::date) order by e.id`;
  const toRows = data => data.map(r => ({ enrollmentId: r.id, classId: r.class_id, className: r.class_name ?? '?', studentId: r.student_id, studentName: r.student_name ?? '?',
    startDate: r.start_date, endDate: r.end_date ?? null, isTransferred: r.is_transferred ?? false, isTransferredIn: r.is_transferred_in ?? false }));
  const data = await pick(sql`e.class_id = ${id}`);
  if (!data.length) return [];
  const related = await pick(sql`e.student_id = any(${[...new Set(data.map(r => r.student_id))]}::uuid[])`);
  return D.scheduled.scheduledChangesForClass(D.scheduled.classifyScheduled(toRows(related), today), id);
}

/** 원장 보기의 권한 칸 — 2.0 판정 함수에 원장 역할을 넣는다(메뉴 권한 표는 학원 설정의 역할 재정의까지). */
async function viewerFor(sql, t, D) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const stored = row?.data && typeof row.data === 'object' ? row.data : null, base = D.preset.baseSettingsFor(D.preset.presetOfStored(stored));
  const permissions = { ...base.permissions, ...(stored?.permissions && typeof stored.permissions === 'object' ? stored.permissions : {}) };
  const matrix = D.perms.resolveMatrix(Array.isArray(permissions.overrides) ? permissions.overrides : []);
  const owner = { id: '', systemRole: 'master' }, level = menu => D.perms.accessLevel(owner.systemRole, menu, matrix);
  const menus = ['students', 'classes', 'withdrawals'].map(level);
  const dateAllowed = menus.some(l => l !== 'none') && D.dateAccess.canEditEnrollmentDates(owner, false, permissions.specialAccess?.enrollmentDateEditorIds);
  const classLevel = level('classes'), studentsFull = level('students') === 'full';
  return {
    dateAccess: dateAllowed ? { allowed: true, classIds: menus.some(l => l === 'full' || l === 'readonly') ? null : [] } : { allowed: false, classIds: [] },
    classesFull: classLevel === 'full', classLevel, canEditClass: classLevel === 'full', studentsFull,
    canManageStatus: studentsFull && D.statusAccess.canManageStudentStatus(owner, false, D.statusPerm.studentStatusManagerIds(permissions.specialAccess)),
    // 인재원 학습(JJ실) 바로가기 — 연동 설정(ijwConfigFor)이 연습 환경엔 없다.
    jjLink: false,
  };
}

/** 반 상세 한 벌 — page.tsx의 Promise.all 이름 그대로 + 권한 칸. 없는 반이면 { notFound: true }. */
export async function buildClassDetail({ sql, tenantId: t, id, importV2, readSettings, readTeacherOptions, buildSubjectMaps }) {
  const D = await loadDetailRules(importV2), today = D.dk.kstToday();
  const klass = await readClassDetail(sql, t, D, id, today);
  if (!klass) return { notFound: true };
  const [students, allEnrolledStudents, settings, teacherOptions, delegations, viewer] = await Promise.all([
    readClassStudents(sql, t, D, id, today),
    readEnrolledStudents(sql, t),
    readSettings(sql, t),
    readTeacherOptions(sql, t),
    readDelegations(sql, t, id, today),
    viewerFor(sql, t, D),
  ]);
  // 부가 패널(30일 출결) — 실패해도 반 상세는 연다(2.0 .catch → null).
  const stats = await soft(sql, s => readAttendanceStats(s, t, D, id, today));
  const historyParts = await readHistoryParts(sql, t, D, id, today, settings.operations.subjects);
  const [scheduledClass, scheduledRoster] = await Promise.all([
    readScheduledClassChanges(sql, t, D, { id, teacherId: klass.teacherId, classroomId: klass.classroomId, className: klass.className }, today),
    readScheduledForClass(sql, t, D, id, today),
  ]);
  // getClassLabSeparateEnrollmentIds — 칸이 없거나 실패하면 null(모름 → 토글을 세우지 않는다).
  const labSeparate = await soft(sql, s => s`select id::text id from public.enrollments where tenant_id=${t} and class_id=${id} and lab_separate`).then(r => (r ? r.map(x => x.id) : null));
  return { klass, students, stats, allEnrolledStudents: [...allEnrolledStudents], settings, teacherOptions, delegations, historyParts,
    scheduledClass, scheduledRoster, labSeparateIds: labSeparate, lang: 'ko', viewer };
}

/** getClassroomOptions({ keepForClassId }) — 보관 안 된 강의실 + (보관됐어도) 이 반에 배정된 강의실, 이름순. */
async function readClassroomOptions(sql, t, keepForClassId) {
  const [rows, keep] = await Promise.all([
    sql`select id::text id, name, capacity, archived_at from public.classrooms where tenant_id=${t} order by name`,
    keepForClassId ? sql`select classroom_id::text classroom_id from public.classes where tenant_id=${t} and id=${keepForClassId}` : [],
  ]);
  const keepId = keep[0]?.classroom_id ?? null;
  return rows.filter(r => r.archived_at == null || (keepId != null && r.id === keepId)).map(r => ({ id: r.id, name: r.name, capacity: r.capacity }));
}

/** 반 수정(/classes/<id>/edit) — 2.0 Promise.all 그대로. 없거나 고칠 수 없는 반(canWriteLoadedClass)이면 { notFound: true }. */
export async function buildClassEdit({ sql, tenantId: t, id, importV2, readSettings, readTeacherOptions }) {
  const D = await loadDetailRules(importV2), today = D.dk.kstToday();
  const [klass, teachers, classrooms, settings, viewer] = await Promise.all([
    readClassDetail(sql, t, D, id, today), readTeacherOptions(sql, t), readClassroomOptions(sql, t, id), readSettings(sql, t), viewerFor(sql, t, D),
  ]);
  if (!klass || !viewer.canEditClass) return { notFound: true };
  return { klass, teachers, classrooms, settings };
}

/** 새 반(/classes/new) — 2.0 Promise.all 그대로. */
export async function buildClassNew({ sql, tenantId: t, readSettings, readTeacherOptions }) {
  const [teachers, classrooms, settings] = await Promise.all([readTeacherOptions(sql, t), readClassroomOptions(sql, t), readSettings(sql, t)]);
  return { teachers, classrooms, settings };
}
