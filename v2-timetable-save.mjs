// 2.0 화면 — 시간표 저장(2단계, 원장 2026-10-28 *"일단은 docker. 연습용이므로 모두 docker"*).
// 호스트(v2-host)의 2.0 부품이 부르는 서버 함수("use server")를 같은 이름으로 받아 Docker 복사본에 2.0과 같은 표·칸으로 쓴다.
//  · 요청 = 공통 틀 POST /api/v2/timetable/<함수> · 본문 { module, actor, args } — module은 2.0 서버 함수 파일(src 기준),
//    args는 2.0 함수 인자 그대로(호스트 shims/server-action.ts가 보낸다).
//  · 사람 = 3.0엔 로그인이 없어 3.0 띠에서 고른 직원. 고를 수 있는 사람 = 2.0 canManageTenant(역할,'classes')와 같은 권한 표
//    (역할 기본 + 학원 설정 덮어쓰기 + 개인 예외)의 '전체' — 운영자 계정은 뺀다(출석부 화면과 같은 규약).
//    그 사람의 신분(request.jwt.claims)으로 쓴다 — 2.0 DB 함수가 권한을 한 번 더 본다.
//  · 반환 = 2.0 함수의 반환 모양 그대로({ results } · { error } · { count }) — 부품이 2.0과 똑같이 읽는다.
//  · 알림 = notifications 표 줄까지(2.0 notifyUsers). 슬랙 깨우기(pokeSlack)는 부르지 않는다(바깥 요청).
//  · 감사로그 = 2.0 logAction과 같은 칸 + metadata.via '3.0 연습 복사본'.
import { V2Error } from './v2-screens.mjs';

const VIA = '3.0 연습 복사본';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = v => { if (typeof v !== 'string' || !UUID.test(v)) throw bad(); return v; };
const optional = v => (v === undefined || v === null ? undefined : v);
const MAX_ITEMS = 500; // 한 번의 저장에 담을 수 있는 건수(요청 크기 상한과 같은 결 — 2.0 화면이 한 번에 내는 양보다 넉넉하다)

let extraPromise = null;
/** 저장에만 쓰는 2.0 순수 모듈 — 한 번만 불러온다. */
function loadExtra(importV2) {
  extraPromise ??= (async () => {
    const [perms, roles, bulk, helpers, dbErrors, cm] = await Promise.all([
      'lib/permissions.ts', 'lib/auth/role-hierarchy.ts', 'features/enrollments/bulk-transfer.ts',
      'features/enrollments/server/assign-helpers.ts', 'features/enrollments/db-errors.ts', 'features/timetable/lib/class-move.ts',
    ].map(p => importV2(p)));
    return { perms, ROLE_LABEL: roles.ROLE_LABEL, transferDateError: bulk.transferDateError, DAY_ORDER: helpers.DAY_ORDER, toKoreanDbError: dbErrors.toKoreanDbError, cm };
  })().catch(error => { extraPromise = null; throw error; });
  return extraPromise;
}

const RANK = ['master', 'admin', 'manager'];
/** 저장할 수 있는 사람 — 수업 관리 '전체'(2.0 canManageTenant(role,'classes')). 원장 먼저, 같은 역할은 이름순. */
export async function readEditors(sql, t, R, X) {
  const [users, supers, [row]] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`.catch(() => []),
    sql`select data from public.tenant_settings where tenant_id=${t}`,
  ]);
  const stored = plain(row?.data) ? row.data : null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const permissions = { ...base.permissions, ...(plain(stored?.permissions) ? stored.permissions : {}) };
  const matrix = X.perms.resolveMatrix(Array.isArray(permissions.overrides) ? permissions.overrides : []);
  const userOverrides = Array.isArray(permissions.userOverrides) ? permissions.userOverrides : [];
  const operators = new Set(supers.map(s => s.id));
  return users
    .filter(u => !operators.has(u.id) && X.perms.accessLevel(u.role, 'classes', X.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides)) === 'full')
    .map(u => ({ id: u.id, name: u.display_name, role: X.ROLE_LABEL[u.role] ?? '', rank: RANK.includes(u.role) ? RANK.indexOf(u.role) : RANK.length }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ko'))
    .map(({ rank, ...u }) => u);
}

/** 고른 사람으로 저장 — 저장 가능한 사람이 아니면 null(호출부가 2.0의 거절 문구를 돌려준다). 맞으면 그 사람의 신분을 세운다. */
async function actAs(sql, t, R, X, actorId) {
  const actor = actorId ? (await readEditors(sql, t, R, X)).find(e => e.id === actorId) : null;
  if (!actor) return null;
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  return actor;
}

const audit = (sql, t, actor, action, targetType, metadata, targetLabel = null) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, ${targetType}, ${targetLabel}, ${sql.json({ ...metadata, via: VIA })})`;

/** 2.0이 사용자 클라이언트(PostgREST = authenticated 역할)로 직접 쓰는 줄 — 같은 역할로 써서 RLS·보호 트리거가 2.0처럼 본다.
 *  (복사본 접속 계정은 수퍼유저라 그냥 쓰면 둘 다 건너뛴다.) 실패하면 저장점째 되돌아가 역할도 원래대로다. */
const asAuthenticated = (sql, fn) => sql.savepoint(async s => {
  await s`set local role authenticated`;
  const out = await fn(s);
  await s`reset role`;
  return out;
});

/** postgres.js 오류 → 2.0 supabase 오류 모양(toKoreanDbError가 읽는 칸). */
const dbError = e => ({ code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null });

/** 2.0 notifyClassAssignment + notifyUsers — 목적지 반 담임에게 반·담임마다 한 줄, 내 행동은 나에게 알리지 않는다. best-effort(실패해도 저장은 그대로). */
async function notifyClassAssignment(sql, t, actor, assignments, type) {
  if (!assignments.length) return;
  try {
    await sql.savepoint(async s => {
      const classIds = [...new Set(assignments.map(a => a.classId))], studentIds = [...new Set(assignments.map(a => a.studentId))];
      const [classes, students] = await Promise.all([
        s`select id::text id, class_name, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
        s`select id::text id, name from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`,
      ]);
      const classById = new Map(classes.map(c => [c.id, c])), nameById = new Map(students.map(x => [x.id, x.name])), by = new Map();
      for (const a of assignments) {
        const c = classById.get(a.classId), teacherId = c?.teacher_id;
        if (!teacherId) continue;
        const key = `${teacherId}::${a.classId}`;
        const entry = by.get(key) ?? { recipientId: teacherId, classId: a.classId, className: c?.class_name ?? '반', studentNames: [] };
        const nm = nameById.get(a.studentId);
        if (nm && !entry.studentNames.includes(nm)) entry.studentNames.push(nm);
        by.set(key, entry);
      }
      const verb = type === 'enrollment_transferred_in' ? '전입' : '배정', title = type === 'enrollment_transferred_in' ? '반 이동 전입' : '새 학생 배정';
      const rows = [...by.values()].filter(e => e.studentNames.length > 0 && e.recipientId !== actor.id).map(e => {
        const [first, ...rest] = e.studentNames, who = rest.length > 0 ? `${first} 외 ${rest.length}명` : first;
        return { recipient: e.recipientId, body: `${who} 학생이 ${e.className} 반에 ${verb}되었습니다.`, link: `/classes/${e.classId}` };
      });
      for (const r of rows) await s`insert into public.notifications (id, tenant_id, recipient_id, type, title, body, link, actor_id) values (gen_random_uuid(), ${t}, ${r.recipient}, ${type}, ${title}, ${r.body}, ${r.link}, ${actor.id})`;
    });
  } catch (e) { console.error(`timetable notify skipped: ${e?.code || ''} ${e?.message || ''}`); }
}

// ── 2.0 features/enrollments/server/actions.ts ─────────────────────────────────────────────────────────────────────────

/** moveEnrollmentsBatch(moves, effectiveDate?, sourceClassId?) — 시간표는 앞의 둘만 쓴다. 단체 이동(sourceClassId)은 반 상세 화면의 것이라 여기선 받지 않는다. */
function moveArgs(args) {
  const [moves, effectiveDate, sourceClassId] = args;
  if (optional(sourceClassId) !== undefined) throw new V2Error(400, 'unsupported', '단체 이동은 이 연습 화면에서 아직 저장하지 않습니다.');
  if (!Array.isArray(moves) || moves.length > MAX_ITEMS) throw bad();
  const eff = optional(effectiveDate);
  if (eff !== undefined && typeof eff !== 'string') throw bad();
  return [moves.map(m => {
    if (!plain(m)) throw bad();
    const out = { enrollmentId: uuid(m.enrollmentId), newClassId: uuid(m.newClassId) };
    if (optional(m.startDate) !== undefined) { if (typeof m.startDate !== 'string') throw bad(); out.startDate = m.startDate; }
    if (optional(m.attendanceDays) !== undefined) { if (!Array.isArray(m.attendanceDays) || m.attendanceDays.some(d => typeof d !== 'string')) throw bad(); out.attendanceDays = m.attendanceDays; }
    return out;
  }), eff];
}

async function moveEnrollmentsBatch(sql, t, R, X, actorId, [moves, effectiveDate]) {
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 이동은 관리자만 할 수 있습니다' };
  if (moves.length === 0) return { results: [] };
  const today = R.kstToday(), eff = effectiveDate?.trim() || today;
  const dateError = X.transferDateError(moves, eff, today);
  if (dateError) return { error: dateError };
  const p_moves = moves.map(m => ({ enrollmentId: m.enrollmentId, newClassId: m.newClassId, startDate: eff, attendanceDays: X.DAY_ORDER.filter(d => (m.attendanceDays ?? []).includes(d)) }));
  let data;
  try { [{ r: data }] = await sql.savepoint(s => s`select public.move_enrollments_batch(${s.json(p_moves)}::jsonb, ${eff}::date) r`); }
  catch (e) { return { error: X.toKoreanDbError(dbError(e), '반 이동을 저장하지 못했습니다', 'enrollments.moveBatch') }; }
  const results = Array.isArray(data) ? data : [];
  const okIds = new Set(results.filter(r => r.ok).map(r => r.enrollmentId)), okMoves = moves.filter(m => okIds.has(m.enrollmentId));
  if (okMoves.length > 0) {
    const enrRows = await sql`select id::text id, student_id::text student_id from public.enrollments where tenant_id=${t} and id = any(${okMoves.map(m => m.enrollmentId)}::uuid[])`;
    const studentByEnrollment = new Map(enrRows.map(e => [e.id, e.student_id]));
    const assignments = okMoves.map(m => ({ classId: m.newClassId, studentId: studentByEnrollment.get(m.enrollmentId) })).filter(a => !!a.studentId && !!a.classId);
    await notifyClassAssignment(sql, t, actor, assignments, 'enrollment_transferred_in');
    await audit(sql, t, actor, 'enrollment_move_batch', 'student', {
      count: okMoves.length, effectiveDate: eff,
      studentIds: [...new Set(okMoves.map(m => studentByEnrollment.get(m.enrollmentId)).filter(Boolean))],
      moves: okMoves.map(m => ({ enrollmentId: m.enrollmentId, newClassId: m.newClassId, studentId: studentByEnrollment.get(m.enrollmentId) ?? null })),
    });
  }
  return { results };
}

/** updateEnrollmentsAttendanceBatch(edits) — 같은 반 등원 요일 편집(분리등원). */
function daysArgs(args) {
  const [edits] = args;
  if (!Array.isArray(edits) || edits.length > MAX_ITEMS) throw bad();
  return [edits.map(e => {
    if (!plain(e) || typeof e.enrollmentId !== 'string' || e.enrollmentId.length > 64) throw bad();
    if (optional(e.days) !== undefined && (!Array.isArray(e.days) || e.days.some(d => typeof d !== 'string'))) throw bad();
    return { enrollmentId: e.enrollmentId, days: e.days ?? [] };
  })];
}

async function updateEnrollmentsAttendanceBatch(sql, t, R, X, actorId, [edits]) {
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '등원 요일 편집은 관리자만 할 수 있습니다' };
  if (edits.length === 0) return { count: 0 };
  const applied = [];
  // 2.0은 RLS로 이 지점 수강만 읽고 고친다 — 복사본 접속은 RLS를 안 타서 지점을 직접 건다.
  const editIds = [...new Set(edits.map(e => String(e?.enrollmentId ?? '').trim()).filter(id => UUID.test(id)))];
  const beforeById = new Map((editIds.length ? await sql`select e.id::text id, e.class_id::text class_id, e.attendance_days, c.class_name from public.enrollments e
      left join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.id = any(${editIds}::uuid[])` : []).map(r => [r.id, r]));
  const today = R.kstToday(), editClassIds = [...new Set([...beforeById.values()].map(r => r.class_id))];
  const live = editClassIds.length ? await sql`select class_id::text class_id, day_of_week from public.class_schedules where tenant_id=${t} and class_id = any(${editClassIds}::uuid[])
      and valid_from <= ${today} and (valid_to is null or valid_to >= ${today})` : [];
  const wholeDaysByClass = new Map(editClassIds.map(id => [id, X.DAY_ORDER.filter(d => live.some(r => r.class_id === id && r.day_of_week === d))]));
  const writeDaysLog = () => (applied.length === 0 ? null : audit(sql, t, actor, 'enrollment_days_update', 'student', {
    count: applied.length, studentIds: [...new Set(applied.map(a => a.studentId).filter(Boolean))], edits: applied.map(a => ({ ...a })),
  }));
  for (const e of edits) {
    const enrollmentId = String(e?.enrollmentId ?? '').trim();
    if (!enrollmentId) continue;
    const days = X.DAY_ORDER.filter(d => (e.days ?? []).includes(d));
    const before = beforeById.get(enrollmentId);
    if (!before) continue;
    const wholeDays = wholeDaysByClass.get(before.class_id) ?? null;
    const beforeDays = X.DAY_ORDER.filter(d => (before.attendance_days ?? []).includes(d));
    let row;
    try { [row] = await asAuthenticated(sql, s => s`update public.enrollments set attendance_days=${days}::text[] where tenant_id=${t} and id=${enrollmentId} returning student_id::text student_id`); }
    catch (err) {
      await writeDaysLog();
      return { error: X.toKoreanDbError(dbError(err), '등원 요일을 저장하지 못했습니다', 'enrollments.days'), count: applied.length };
    }
    if (row) {
      applied.push({ enrollmentId, days, studentId: row.student_id ?? null, classId: before.class_id, className: before.class_name ?? null, beforeDays,
        recordedAt: new Date().toISOString(), beforeEffectiveDays: beforeDays.length ? beforeDays : wholeDays, effectiveDays: days.length ? days : wholeDays });
      beforeById.set(enrollmentId, { ...before, attendance_days: days });
    }
  }
  await writeDaysLog();
  return { count: applied.length };
}

// ── 2.0 features/timetable/server/move-actions.ts ──────────────────────────────────────────────────────────────────────
// 반 블록(화면의 한 칸 = 배치 여러 줄)을 다른 요일·교시로 — 판정 순서·문구 2.0 그대로.
// ⚠️ 2.0은 '적용일 이후 그 교시로 찍힌 출결' 확인에서 attendance_records의 `date` 칸을 읽는데, 그 표의 날짜 칸은 `session_date`다
//    (복사본 실측 · class_schedule_move 감사로그 0건). 그래서 2.0에서는 앞 판정을 다 지나면 늘 여기서 '출결 기록을 확인하지
//    못해 중단했습니다'로 멈춘다 — 연습본도 같은 칸을 읽어 같은 자리·같은 문구로 멈춘다. 저장 본문은 옮겨 두었다
//    (2.0이 고쳐지면 dateColumn만 바꾼다 · verify가 session_date로 되돌림 시험을 한다).
const V2_ATTENDANCE_DATE_COLUMN = 'date';

function slotMoveArgs(args) {
  const [input] = args;
  if (!plain(input) || !Array.isArray(input.moves) || input.moves.length > 60) throw bad();
  const moves = input.moves.map(m => {
    if (!plain(m) || typeof m.toDay !== 'string' || m.toDay.length > 3 || typeof m.toStart !== 'string' || m.toStart.length > 8) throw bad();
    return { slotId: uuid(m.slotId), toDay: m.toDay, toStart: m.toStart };
  });
  const effectiveDate = optional(input.effectiveDate);
  if (effectiveDate !== undefined && (typeof effectiveDate !== 'string' || effectiveDate.length > 32)) throw bad();
  return [{ moves, effectiveDate }];
}

/** 2.0 getTeacherScheduleBlocks(subject, referenceDate) — 강사 비수업 블록(감독·회의·연차)을 가짜 슬롯 모양으로(판정 재료). */
async function teacherBlocks(sql, t, R, subject, ref, labelMap) {
  const rows = await sql`select id::text id, teacher_label, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, kind, label
    from public.teacher_schedule_blocks where tenant_id=${t} and subject=${subject} and valid_from <= ${ref}::date and (valid_to is null or valid_to >= ${ref}::date) order by id`;
  return rows.map(r => ({
    id: `block:${r.id}`, classId: '', className: R.resolveTeacherLabel(r.label, labelMap) ?? r.label, subject, dayOfWeek: r.day_of_week,
    startTime: r.start_time, endTime: r.end_time, teacherName: R.resolveTeacherLabel(r.teacher_label, labelMap), classroomName: null, studentCount: 0,
    slotTeacherLabel: R.resolveTeacherLabel(r.teacher_label, labelMap), slotRoomLabel: null, slotRoomId: null, classRoomId: null, classBgColor: null,
    classTextColor: null, pendingHandover: null, isSpecialLecture: false, englishTrack: null, blockKind: r.kind, students: [],
  }));
}

const weekdayOf = ymd => { const [y, m, d] = ymd.slice(0, 10).split('-').map(Number); return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? ''; };
const shiftDay = (ymd, delta) => { const [y, m, d] = ymd.split('-').map(Number), dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + delta)); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`; };

/** moveClassSlots({ moves, effectiveDate }) — readers.weekSlots = 2.0 getWeeklyScheduleWithStudents({ referenceDate }) 같은 모양. */
export async function moveClassSlots(sql, t, R, X, actorId, [input], readers, { dateColumn = V2_ATTENDANCE_DATE_COLUMN } = {}) {
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { ok: false, error: '시간표를 편집할 권한이 없습니다' };
  const moves = input.moves ?? [];
  if (moves.length === 0) return { ok: false, error: '옮길 배치가 없습니다' };
  if (new Set(moves.map(m => m.slotId)).size !== moves.length) return { ok: false, error: '같은 배치가 두 번 들어 있습니다' };
  const today = R.kstToday(), effective = (input.effectiveDate ?? today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { ok: false, error: '적용일이 올바르지 않습니다' };
  if (effective < today) return { ok: false, error: '지난 날짜로는 옮길 수 없습니다 — 오늘 이후로 정해 주세요' };

  const rows = await sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time,
      valid_from::text valid_from, valid_to::text valid_to, teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label,
      period_label, merge_group, coalesce(lab_separate, false) lab_separate
    from public.class_schedules where tenant_id=${t} and id = any(${moves.map(m => m.slotId)}::uuid[])`;
  const byId = new Map(rows.map(r => [r.id, r]));
  if (byId.size !== moves.length) return { ok: false, error: '옮길 배치를 찾지 못했습니다(이미 바뀌었을 수 있습니다). 화면을 새로 고쳐 주세요' };
  const classIds = new Set(rows.map(r => r.class_id));
  if (classIds.size !== 1) return { ok: false, error: '한 번에 한 반만 옮길 수 있습니다' };
  const classId = [...classIds][0];

  const windows = [];
  for (const m of moves) {
    const row = byId.get(m.slotId);
    if (row.valid_to && row.valid_to.slice(0, 10) < effective) return { ok: false, error: '이미 끝난 배치입니다 — 화면을 새로 고친 뒤 다시 시도해 주세요' };
    const from = row.valid_from ? row.valid_from.slice(0, 10) : null;
    if (from && from > effective) return { ok: false, error: `${from}부터 시작하도록 예약된 배치입니다 — 그 날짜 이후로 적용일을 정하거나 예약을 먼저 취소해 주세요` };
    const toStart = m.toStart.length === 5 ? `${m.toStart}:00` : m.toStart;
    if (!/^\d{2}:\d{2}:\d{2}$/.test(toStart)) return { ok: false, error: '옮길 시각이 올바르지 않습니다' };
    const dur = X.cm.toMinutes(row.end_time) - X.cm.toMinutes(row.start_time);
    if (dur <= 0) return { ok: false, error: '수업 길이를 계산하지 못했습니다' };
    windows.push({ slotId: m.slotId, day: m.toDay, start: toStart, end: X.cm.toTimeString(X.cm.toMinutes(toStart) + dur) });
  }
  if (windows.every(w => { const row = byId.get(w.slotId); return row.day_of_week === w.day && row.start_time.slice(0, 5) === w.start.slice(0, 5); })) return { ok: false, error: '같은 자리입니다' };

  // 서버가 다시 판정한다(#77) — 적용일 그 주의 전 과목 배치 + 강사 근무 블록, 화면과 같은 함수(moveBlockers).
  const week = await readers.weekSlots(sql, t, R, effective, today);
  const mine = week.slots.find(x => x.id === moves[0].slotId);
  if (!mine) return { ok: false, error: '옮길 배치를 시간표에서 찾지 못했습니다 — 화면을 새로 고친 뒤 다시 시도해 주세요' };
  const blocks = mine.subject ? await teacherBlocks(sql, t, R, mine.subject, effective, week.labelMap) : [];
  const lookup = X.cm.buildClassMoveLookup(X.cm.buildClassMoveIndex([...week.slots, ...blocks], [classId]));
  const byWeek = new Map(week.slots.map(x => [x.id, x]));
  const parts = moves.map(m => {
    const src = byWeek.get(m.slotId);
    return { slotId: m.slotId, rowOffset: 0, dayOffset: 0, durMin: 0, teacher: src ? X.cm.slotTeacherOf(src) : null, roomId: src ? X.cm.slotRoomIdOf(src) : null,
      roomTok: src ? X.cm.slotRoomTokOf(src) : '', roomName: src ? X.cm.slotRoomNameOf(src) : '', seat: src ? X.cm.isSeatSlot(src) : false };
  });
  const blockers = X.cm.moveBlockers({ slotId: mine.id, classId, parts }, windows, lookup);
  if (blockers.length > 0) return { ok: false, error: `그 자리로는 옮길 수 없습니다 — ${X.cm.blockersText(blockers)}` };

  // 적용일 이후 그 칸(같은 요일·시각)으로 이미 찍힌 출결 — 2.0이 읽는 칸 그대로(위 ⚠️).
  for (const w of windows) {
    const row = byId.get(w.slotId);
    let dates;
    try {
      dates = await sql.savepoint(s => s`select ${s(dateColumn)}::text d from public.attendance_records where tenant_id=${t} and class_id=${row.class_id}
        and ${s(dateColumn)} >= ${effective}::date and slot_start = ${row.start_time}::time order by ${s(dateColumn)}`);
    } catch { return { ok: false, error: '출결 기록을 확인하지 못해 중단했습니다' }; }
    const stuck = dates.filter(r => weekdayOf(r.d) === row.day_of_week).length;
    if (stuck > 0) return { ok: false, error: `적용일 이후에 이 교시로 찍힌 출결이 ${stuck}건 있습니다 — 그 기록을 먼저 정리한 뒤 옮겨 주세요` };
  }

  const [klass] = await sql`select class_name from public.classes where id=${classId} and tenant_id=${t}`;
  const cutoff = shiftDay(effective, -1);
  // 2.0은 트랜잭션 없이 넣고·마감하고 실패하면 일지로 되짚는다 — 여기선 저장점 하나가 같은 일을 한다(실패하면 통째로 되돌아간다).
  let stage = 'insert', newSlotIds;
  try {
    newSlotIds = await sql.savepoint(async s => {
      const ids = [];
      for (const w of windows) {
        const row = byId.get(w.slotId);
        stage = 'insert';
        const [created] = await s`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id,
            slot_teacher_label, slot_room_label, period_label, merge_group, lab_separate)
          values (${t}, ${row.class_id}, ${w.day}, ${w.start}::time, ${w.end}::time, ${effective}::date, ${row.valid_to}::date, ${row.teacher_id}, ${row.classroom_id},
            ${row.slot_teacher_label}, ${row.slot_room_label}, null, ${row.merge_group}, ${row.lab_separate}) returning id::text id`;
        ids.push(created.id);
        stage = 'close';
        const validFrom = row.valid_from ? row.valid_from.slice(0, 10) : null;
        if (validFrom && validFrom < effective) await s`update public.class_schedules set valid_to=${cutoff}::date where id=${row.id} and tenant_id=${t}`;
        else await s`delete from public.class_schedules where id=${row.id} and tenant_id=${t}`;
      }
      return ids;
    });
  } catch (e) {
    console.error(`timetable.moveClassSlots: ${e?.code || ''} ${e?.message || ''}`);
    return { ok: false, error: stage === 'insert' ? '새 배치를 넣지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요' : '옛 배치를 마감하지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요' };
  }
  await audit(sql, t, actor, 'class_schedule_move', 'class', {
    classId, effectiveDate: effective,
    moves: windows.map(w => { const row = byId.get(w.slotId); return { slotId: w.slotId, from: { day: row.day_of_week, start: row.start_time, end: row.end_time }, to: { day: w.day, start: w.start, end: w.end } }; }),
    newSlotIds,
  }, klass?.class_name ?? null);
  return { ok: true, moved: windows.length };
}

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const ENROLLMENTS = 'features/enrollments/server/actions.ts';
const ACTIONS = {
  moveEnrollmentsBatch: { module: ENROLLMENTS, args: moveArgs, run: moveEnrollmentsBatch },
  updateEnrollmentsAttendanceBatch: { module: ENROLLMENTS, args: daysArgs, run: updateEnrollmentsAttendanceBatch },
  moveClassSlots: { module: 'features/timetable/server/move-actions.ts', args: slotMoveArgs, run: moveClassSlots },
};

/** 공통 틀(v2-screens.mjs)의 actions — 2.0 함수 이름 그대로. rules = importV2 => 시간표 화면의 2.0 순수 모듈 묶음,
 *  readers = 시간표 화면 모듈의 조회(weekSlots — 서로 불러오면 고리가 생겨 넘겨받는다). */
export function timetableActions(rules, readers) {
  return Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, {
    validate: raw => {
      if (!plain(raw) || raw.module !== a.module || !Array.isArray(raw.args) || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      return { actor: raw.actor ?? null, args: a.args(raw.args) };
    },
    run: async ({ sql, body, tenantId, importV2 }) => {
      const [R, X] = await Promise.all([rules(importV2), loadExtra(importV2)]);
      return a.run(sql, tenantId, R, X, body.actor, body.args, readers);
    },
  }]));
}

export { loadExtra };
