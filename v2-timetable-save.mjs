// 2.0 화면 — 시간표 저장(2단계, 원장 2026-10-28 *"일단은 docker. 연습용이므로 모두 docker"*).
// 호스트(v2-host)의 2.0 부품이 부르는 서버 함수("use server")를 같은 이름으로 받아 Docker 복사본에 2.0과 같은 표·칸으로 쓴다.
//  · 요청 = 공통 틀 POST /api/v2/timetable/<함수> · 본문 { module, actor, args } — module은 2.0 서버 함수 파일(src 기준),
//    args는 2.0 함수 인자 그대로(호스트 shims/server-action.ts가 보낸다).
//  · 사람 = 3.0엔 로그인이 없어 3.0 띠에서 고른 직원. 고를 수 있는 사람 = 2.0 canManageTenant(역할,'classes')와 같은 권한 표
//    (역할 기본 + 학원 설정 덮어쓰기 + 개인 예외)의 '전체' — 운영자 계정은 뺀다(출석부 화면과 같은 규약).
//    2.0이 사용자 클라이언트로 쓰는 줄은 그 사람의 신분(request.jwt.claims) + authenticated 역할로 쓴다(asAuthenticated) — 2.0 DB 함수·RLS·보호 트리거가 권한을 한 번 더 본다.
//    신분은 그 쓰기 안에서만 선다 — 2.0이 서비스 키로 하던 쓰기(감사로그·알림 등)가 이 사람으로 판정되지 않게.
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
    const [perms, roles, bulk, helpers, dbErrors, cm, dbError, reasonDetail, via, statusPerm, statusAccess, special, anchors] = await Promise.all([
      'lib/permissions.ts', 'lib/auth/role-hierarchy.ts', 'features/enrollments/bulk-transfer.ts',
      'features/enrollments/server/assign-helpers.ts', 'features/enrollments/db-errors.ts', 'features/timetable/lib/class-move.ts',
      'lib/supabase/db-error.ts', 'features/withdrawals/reason-detail.ts', 'features/withdrawals/via-report.ts',
      'features/owner/student-status-permissions.ts', 'features/students/status-access.ts', 'features/classes/special-lecture.ts',
      'features/timetable/lib/slot-anchors.ts',
    ].map(p => importV2(p)));
    return { perms, ROLE_LABEL: roles.ROLE_LABEL, transferDateError: bulk.transferDateError, DAY_ORDER: helpers.DAY_ORDER, toKoreanDbError: dbErrors.toKoreanDbError, cm, anchors,
      explainDbError: dbError.explainDbError, readReasonForm: reasonDetail.readReasonForm, via, studentStatusManagerIds: statusPerm.studentStatusManagerIds,
      canManageStudentStatus: statusAccess.canManageStudentStatus, STUDENT_STATUS_DENIED: statusAccess.STUDENT_STATUS_DENIED, special };
  })().catch(error => { extraPromise = null; throw error; });
  return extraPromise;
}

const RANK = ['master', 'admin', 'manager'];
/**
 * 저장할 수 있는 사람(editors) — 수업 관리 '전체'(2.0 canManageTenant(role,'classes')). 원장 먼저, 같은 역할은 이름순. 운영자 계정은 뺀다.
 * memoIds — 그중 메모 시트를 고칠 수 있는 사람(시간표 '전체'). statusIds — 그중 원생 상태(대기·퇴원)도 바꿀 수 있는 사람 = 2.0 canManageStudentStatusNow(원생 쓰기 '전체' + 원생 상태 변경 담당;
 * 담당 명단은 resolve.ts처럼 저장 원문의 specialAccess에서 studentStatusManagerIds로 읽는다).
 */
export async function readPeople(sql, t, R, X) {
  const [users, supers, [row]] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`,
    sql`select data from public.tenant_settings where tenant_id=${t}`,
  ]);
  const stored = plain(row?.data) ? row.data : null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const storedPermissions = plain(stored?.permissions) ? stored.permissions : undefined;
  const permissions = { ...base.permissions, ...(storedPermissions ?? {}) };
  const matrix = X.perms.resolveMatrix(Array.isArray(permissions.overrides) ? permissions.overrides : []);
  const userOverrides = Array.isArray(permissions.userOverrides) ? permissions.userOverrides : [];
  const operators = new Set(supers.map(s => s.id));
  const level = (u, menu) => X.perms.accessLevel(u.role, menu, X.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides));
  const managerIds = X.studentStatusManagerIds(storedPermissions?.specialAccess);
  const chosen = users.filter(u => !operators.has(u.id) && level(u, 'classes') === 'full');
  const editors = chosen
    .map(u => ({ id: u.id, name: u.display_name, role: X.ROLE_LABEL[u.role] ?? '', rank: RANK.includes(u.role) ? RANK.indexOf(u.role) : RANK.length }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ko'))
    .map(({ rank, ...u }) => u);
  const statusIds = new Set(chosen.filter(u => level(u, 'students') === 'full' && X.canManageStudentStatus({ id: u.id, systemRole: u.role }, false, managerIds)).map(u => u.id));
  // 메모 시트 편집 = 2.0 memoSheetAccess.canEdit(시간표 '전체').
  const memoIds = new Set(chosen.filter(u => level(u, 'timetable') === 'full').map(u => u.id));
  return { editors, statusIds, memoIds };
}
export const readEditors = async (sql, t, R, X) => (await readPeople(sql, t, R, X)).editors;

/** 고른 사람의 신분 — 트랜잭션에 맡겨 두기만 한다(v2.actor_claims). 실제로 서는 곳은 asAuthenticated 안(2.0 사용자 클라이언트 자리)뿐이다.
 *  ⚠️ request.jwt.claims에 바로 세우면 set_config(local)가 트랜잭션 끝까지 남아 2.0 서비스 키 자리의 쓰기(enrollments 보호 트리거 등)까지 이 사람으로 판정된다. */
const holdActor = (sql, actor) => sql`select set_config('v2.actor_claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;

/** 고른 사람으로 저장 — 저장 가능한 사람이 아니면 null(호출부가 2.0의 거절 문구를 돌려준다). 맞으면 그 사람의 신분을 맡겨 둔다(holdActor). */
async function actAs(sql, t, R, X, actorId) {
  const actor = actorId ? (await readEditors(sql, t, R, X)).find(e => e.id === actorId) : null;
  if (!actor) return null;
  await holdActor(sql, actor);
  return actor;
}

const audit = (sql, t, actor, action, targetType, metadata, targetLabel = null) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, ${targetType}, ${targetLabel}, ${sql.json({ ...metadata, via: VIA })})`;

/** 2.0이 사용자 클라이언트(PostgREST = authenticated 역할)로 직접 쓰는 줄 — 같은 역할·같은 신분으로 써서 RLS·보호 트리거·DB 함수가 2.0처럼 본다.
 *  (복사본 접속 계정은 수퍼유저라 그냥 쓰면 다 건너뛴다.) 신분 = 부른 쪽이 이미 세운 claims, 없으면 맡겨 둔 사람(actAs).
 *  끝나면 역할과 claims를 들어올 때 값으로 되돌린다(set_config local은 저장점을 풀어도 남는다). 실패하면 저장점째 되돌아가 둘 다 원래대로다. */
const asAuthenticated = (sql, fn) => sql.savepoint(async s => {
  const [{ prev, held }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev, coalesce(current_setting('v2.actor_claims', true), '') held`;
  if (!prev && held) await s`select set_config('request.jwt.claims', ${held}, true)`;
  await s`set local role authenticated`;
  const out = await fn(s);
  await s`reset role`;
  await s`select set_config('request.jwt.claims', ${prev}, true)`;
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
  if (optional(sourceClassId) !== undefined) throw new V2Error(400, 'unsupported', '단체 이동은 이 연습 자료에서 아직 저장하지 않습니다.');
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
  // 2.0 supabase.rpc(사용자 클라이언트) — 그 사람 신분 + authenticated 역할로.
  try { [{ r: data }] = await asAuthenticated(sql, s => s`select public.move_enrollments_batch(${s.json(p_moves)}::jsonb, ${eff}::date) r`); }
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

// ── 2.0 features/students/server/actions.ts — 명단에서 대기·퇴원으로 보내기 ─────────────────────────────────────────────
// 권한 = 2.0 canManageStudentStatusNow(원생 쓰기 '전체' + 원생 상태 변경 담당 — readPeople.canStatus). 수정은 고른 사람의 신분과
// authenticated 역할로 — 수강 보호 트리거(student_status_private.guard_enrollment)가 2.0처럼 권한을 한 번 더 본다.
// ⚠️ 2.0 endSingleEnrollment는 수학 수강을 끝내면 구글 시트에 적는다(recordMathWithdrawalToSheet, 응답 뒤) — 바깥 호출이라 부르지 않는다.

/** 2.0 인자의 FormData(호스트가 { $formData: [[이름, 글자]…] }로 보낸다) → 서버의 FormData. */
function formArg(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 50) throw bad();
  const fd = new FormData();
  for (const pair of v.$formData) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || pair[0].length > 40 || pair[1].length > 4000) throw bad();
    fd.append(pair[0], pair[1]);
  }
  return fd;
}
const formArgs = args => { if (args.length !== 2) throw bad(); return [null, formArg(args[1])]; };

/** 고른 사람이 원생 상태를 바꿀 수 있으면 그 신분을 세운다(아니면 null → 2.0 STUDENT_STATUS_DENIED). */
async function statusActAs(sql, t, R, X, actorId) {
  if (!actorId) return null;
  const people = await readPeople(sql, t, R, X), actor = people.editors.find(e => e.id === actorId);
  if (!actor || !people.statusIds.has(actor.id)) return null;
  await holdActor(sql, actor);
  return actor;
}
const why = (X, e, scope, fallback) => X.explainDbError(dbError(e), { scope, fallback }).message;

/** via-report.ts loadEndRows — 학생의 수강 전부(과목 불문 · 끝난 것 포함) + 상태·퇴원일. 반 하나라도 못 읽으면 던진다. */
async function loadEndRows(sql, t, X, studentId) {
  const [[student], enrollments] = await Promise.all([
    sql`select status::text status, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id=${studentId}`,
    sql`select id::text id, class_id::text class_id, start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments where tenant_id=${t} and student_id=${studentId} order by id`,
  ]);
  if (!student) throw new Error('학생을 찾지 못했습니다');
  const classIds = [...new Set(enrollments.map(e => e.class_id))];
  const classes = classIds.length ? await sql`select id::text id, class_name, subject, is_special from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])` : [];
  const byId = new Map(classes.map(c => [c.id, c]));
  if (classIds.some(id => !byId.has(id))) throw new Error('수강 반 정보를 확인하지 못했습니다');
  return {
    status: String(student.status), withdrawnAt: student.withdrawn_at ?? null,
    rows: enrollments.map(e => { const c = byId.get(e.class_id); return { id: e.id, classId: e.class_id, className: c.class_name, subject: c.subject, start: e.start_date, end: e.end_date,
      isTransferred: e.is_transferred ?? undefined, isSpecial: X.special.isSpecialLecture({ isSpecial: c.is_special, className: c.class_name }) }; }),
  };
}

/** via-report.ts lastCourseViaReport — 끝내면 이어지는 반이 없는(사실상 퇴원)·그 과목 마지막 반이면 퇴원보고서로 보내는 문구. 조회 실패는 통과시키지 않는다. */
async function lastCourseViaReport(sql, t, X, input) {
  try {
    return await sql.savepoint(async s => {
      let studentId = input.studentId || null;
      if (!studentId) {
        const first = input.enrollmentIds[0];
        if (!first || !UUID.test(first)) return null;
        studentId = (await s`select student_id::text student_id from public.enrollments where tenant_id=${t} and id=${first}`)[0]?.student_id ?? null;
        if (!studentId) return null;
      }
      if (!UUID.test(studentId)) throw new Error('학생 id');
      const { status, withdrawnAt, rows } = await loadEndRows(s, t, X, studentId);
      if (!X.via.lastCourseGateApplies(status, withdrawnAt)) return null;
      return X.via.viaReportMessage(rows, input.enrollmentIds, input.date, withdrawnAt);
    });
  } catch (e) {
    console.error(`withdrawals.viaReport.lastCourse: ${e?.code || ''} ${e?.message || ''}`);
    return '수강 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

/** enrollment-sync.ts endEnrollmentById — 수강 한 건 종료(미래 시작이면 시작일로 클램프 · 종료 사유·세부·메모). */
async function endEnrollmentById(sql, t, X, enrollmentId, date, reason, notes, expectedStudentId) {
  const FALLBACK = '수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (!UUID.test(enrollmentId)) return { error: '수강 기록을 찾을 수 없습니다' };
  const [enr] = await sql`select start_date::text start_date, class_id::text class_id, student_id::text student_id from public.enrollments where tenant_id=${t} and id=${enrollmentId}`;
  if (!enr || (expectedStudentId && enr.student_id !== expectedStudentId)) return { error: '수강 기록을 찾을 수 없습니다' };
  const endDate = String(enr.start_date) > date ? String(enr.start_date) : date;
  try {
    await asAuthenticated(sql, s => (notes
      ? s`update public.enrollments set end_date=${endDate}::date, withdrawal_reason=${reason}, withdrawal_detail=${notes.detail}, withdrawal_memo=${notes.memo} where id=${enrollmentId}`
      : s`update public.enrollments set end_date=${endDate}::date, withdrawal_reason=${reason} where id=${enrollmentId}`));
  } catch (e) { return { error: why(X, e, 'students.enrollmentSync.endOne', FALLBACK) }; }
  return { error: null, endDate, classId: enr.class_id ?? null, studentId: enr.student_id ?? null };
}

/** holdSingleEnrollment(_prev, formData) — 명단에서 대기로(이미 종료면 거절 · 이미 대기면 그대로 통과). */
async function holdSingleEnrollment(sql, t, R, X, actorId, [, fd]) {
  const actor = await statusActAs(sql, t, R, X, actorId);
  if (!actor) return { error: X.STUDENT_STATUS_DENIED };
  const enrollmentId = String(fd.get('enrollmentId') ?? '').trim(), studentId = String(fd.get('studentId') ?? '').trim();
  const date = String(fd.get('date') ?? '').trim() || R.kstToday();
  if (!enrollmentId) return { error: '수강 ID가 누락되었습니다' };
  const [row] = UUID.test(enrollmentId) ? await sql`select id::text id, class_id::text class_id, student_id::text student_id, end_date::text end_date, on_hold
    from public.enrollments where tenant_id=${t} and id=${enrollmentId}` : [];
  if (!row || (studentId && studentId !== row.student_id)) return { error: '수강 기록을 찾을 수 없습니다' };
  if (row.end_date) return { error: '이미 종료된 수강입니다' };
  if (!row.on_hold) {
    try { await asAuthenticated(sql, s => s`update public.enrollments set on_hold=true where id=${enrollmentId}`); }
    catch (e) { return { error: why(X, e, 'students.holdSingleEnrollment', '수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
    await audit(sql, t, actor, 'enrollment_hold', 'student', { studentId: row.student_id, classId: row.class_id, date, source: 'timetable_integrated_drag' });
  }
  return undefined;
}

/** endSingleEnrollment(_prev, formData) — 단일 수강 종료(사유 필수 · 마지막 반이면 퇴원보고서로). */
async function endSingleEnrollment(sql, t, R, X, actorId, [, fd]) {
  const actor = await statusActAs(sql, t, R, X, actorId);
  if (!actor) return { error: X.STUDENT_STATUS_DENIED };
  const enrollmentId = String(fd.get('enrollmentId') ?? '').trim(), studentId = String(fd.get('studentId') ?? '').trim();
  const date = String(fd.get('date') ?? '').trim() || R.kstToday();
  if (!enrollmentId) return { error: '수강 ID가 누락되었습니다' };
  const picked = X.readReasonForm(fd, '종료');
  if (picked.error !== undefined) return { error: picked.error };
  const reason = picked.reason;
  const lastCourse = await lastCourseViaReport(sql, t, X, { studentId: studentId || null, enrollmentIds: [enrollmentId], date });
  if (lastCourse) return { error: lastCourse };
  const res = await endEnrollmentById(sql, t, X, enrollmentId, date, reason, { detail: picked.detail, memo: picked.memo }, studentId || undefined);
  if (res.error) return { error: res.error };
  await audit(sql, t, actor, 'enrollment_end', 'student', { studentId: res.studentId || null, classId: res.classId ?? null, date: res.endDate, reason, detail: picked.detail, memo: picked.memo });
  return undefined;
}

// ── 2.0 features/timetable-memo/server/actions.ts saveMemoSheet ───────────────────────────────────────────────────────
// 영어 시간표 오른쪽 메모 시트 — 화면이 고칠 때마다 판 통째를 보낸다. 권한 = 2.0 memoSheetAccess(시간표 '전체' — readPeople.memoIds).
// version 비교로 덮어쓰기를 막고(다르면 최신 판을 돌려줌), 감사로그는 같은 사람이 10분 안에 또 저장하면 한 줄로 친다(2.0은 응답 뒤 after()).
// ⚠️ 공통 틀의 요청 상한(256KB)이 2.0 상한(4MB)보다 작다 — 그보다 큰 판은 '요청이 너무 큽니다'로 거절된다(복사본의 영어 판은 약 61KB).
const MEMO_TABLE_AUDIT = 'timetable_memo_sheet_save', MEMO_AUDIT_WINDOW_MS = 10 * 60 * 1000, MEMO_MAX_BYTES = 4 * 1024 * 1024;

function memoArgs(args) {
  const [input] = args;
  if (!plain(input) || typeof input.subject !== 'string' || input.subject.length > 40 || typeof input.baseVersion !== 'number') throw bad();
  return [{ subject: input.subject, packed: input.packed, baseVersion: input.baseVersion }];
}

/** store.ts loadMemoSheet — 저장한 적이 없으면 빈 판(version 0) · 모양이 틀린 행은 열지 않는다. */
async function loadMemoSheet(sql, t, R, subject) {
  const [row] = await sql`select doc, version, updated_at from public.timetable_memo_sheets where tenant_id=${t} and subject=${subject}`;
  if (!row) return { status: 'ok', packed: R.memo.packSheet(R.memo.emptyDoc()), version: 0, updatedAt: null };
  const parsed = R.memo.packedSheetSchema.safeParse(row.doc);
  if (!parsed.success) return { status: 'unavailable' };
  return { status: 'ok', packed: parsed.data, version: Number(row.version), updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null };
}
async function memoConflict(sql, t, R, subject) {
  const latest = await loadMemoSheet(sql, t, R, subject);
  if (latest.status !== 'ok') return { ok: false, error: '시트를 다시 불러오지 못했습니다. 새로고침해 주세요.' };
  return { ok: false, conflict: true, version: latest.version, packed: latest.packed, updatedAt: latest.updatedAt };
}

async function saveMemoSheet(sql, t, R, X, actorId, [input]) {
  if (!actorId) return { ok: false, error: '다시 로그인해 주세요' };
  if (!R.memo.isMemoSheetSubject(input.subject)) return { ok: false, error: '이 과목에는 시트가 없습니다' };
  const people = await readPeople(sql, t, R, X), actor = people.editors.find(e => e.id === actorId);
  if (!actor || !people.memoIds.has(actor.id)) return { ok: false, error: '시트를 고칠 권한이 없습니다' };
  const parsed = R.memo.packedSheetSchema.safeParse(input.packed);
  if (!parsed.success) return { ok: false, error: '저장할 수 없는 값이 있습니다. 마지막으로 고친 칸을 확인해 주세요.' };
  const doc = parsed.data;
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MEMO_MAX_BYTES) return { ok: false, error: '시트가 너무 큽니다. 쓰지 않는 행·열을 지워 주세요.' };
  const base = input.baseVersion;
  if (!Number.isInteger(base) || base < 0) return { ok: false, error: '잘못된 요청입니다' };
  const savedAt = new Date().toISOString(), fallback = '시트를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
  let version;
  if (base === 0) {
    try {
      await sql.savepoint(s => s`insert into public.timetable_memo_sheets (tenant_id, subject, version, doc, updated_at, updated_by)
        values (${t}, ${input.subject}, 1, ${s.json(doc)}, ${savedAt}, ${actor.id})`);
    } catch (e) {
      if (e?.code === '23505') return memoConflict(sql, t, R, input.subject);
      return { ok: false, error: X.explainDbError(dbError(e), { scope: 'timetableMemo.save.insert', fallback }).message };
    }
    version = 1;
  } else {
    let row;
    try {
      [row] = await sql.savepoint(s => s`update public.timetable_memo_sheets set doc=${s.json(doc)}, updated_at=${savedAt}, updated_by=${actor.id}, version=${base + 1}
        where tenant_id=${t} and subject=${input.subject} and version=${base} returning version`);
    } catch (e) { return { ok: false, error: X.explainDbError(dbError(e), { scope: 'timetableMemo.save.update', fallback }).message }; }
    if (!row) return memoConflict(sql, t, R, input.subject);
    version = Number(row.version);
  }
  const since = new Date(Date.now() - MEMO_AUDIT_WINDOW_MS).toISOString();
  const [recent] = await sql`select id from public.audit_logs where tenant_id=${t} and actor_id=${actor.id} and action=${MEMO_TABLE_AUDIT} and created_at >= ${since} limit 1`;
  if (!(recent && version > 1)) {
    await audit(sql, t, actor, MEMO_TABLE_AUDIT, 'timetable_memo_sheet', { subject: input.subject, version, rows: doc.rows, cols: doc.cols, cells: doc.cells.length }, '시간표 메모 시트');
  }
  return { ok: true, version, savedAt };
}

// ── 2.0 features/timetable/server/move-actions.ts ──────────────────────────────────────────────────────────────────────
// 반 블록(화면의 한 칸 = 배치 여러 줄)을 다른 요일·교시로 — 판정 순서·문구 2.0 그대로(b580f484f: 교시에 매달린 기록은
// SLOT_ANCHORS 표마다 제 날짜 칸으로 · 오늘 수업 교시는 오늘부터 못 옮김 · 분리등원 학생이 있으면 요일을 못 옮김).
const DAY_KEYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

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
export async function moveClassSlots(sql, t, R, X, actorId, [input], readers) {
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
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(toStart)) return { ok: false, error: '옮길 시각이 올바르지 않습니다' };
    if (!DAY_KEYS.has(m.toDay)) return { ok: false, error: '옮길 요일이 올바르지 않습니다' };
    const dur = X.cm.toMinutes(row.end_time) - X.cm.toMinutes(row.start_time);
    if (dur <= 0) return { ok: false, error: '수업 길이를 계산하지 못했습니다' };
    if (X.cm.toMinutes(toStart) + dur > 24 * 60) return { ok: false, error: '수업이 자정을 넘깁니다 — 더 이른 시각으로 옮겨 주세요' };
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

  // 오늘 수업이 있는 교시는 오늘부터 옮기지 않는다(열린 출석 화면이 옛 교시로 기록 — 2.0 #126).
  if (effective === today && windows.some(w => byId.get(w.slotId).day_of_week === weekdayOf(today))) {
    return { ok: false, error: `오늘 수업이 있는 교시는 오늘부터 옮길 수 없습니다 — 열려 있는 출석 화면이 옛 교시로 기록합니다. 적용일을 ${X.anchors.nextDay(today)} 이후로 정해 주세요` };
  }
  // 적용일 이후(그 배치가 끝나는 날까지) 그 교시에 매달린 기록 — 표마다 제 날짜 칸(2.0 SLOT_ANCHORS), 같은 요일만.
  const hits = new Map();
  for (const w of windows) {
    const row = byId.get(w.slotId), until = row.valid_to ? row.valid_to.slice(0, 10) : null;
    for (const a of X.anchors.SLOT_ANCHORS) {
      let found;
      try {
        found = await sql.savepoint(s => s`select ${s(a.dateColumn)}::text d from ${s('public.' + a.table)} where tenant_id=${t} and class_id=${row.class_id}
          and slot_start = ${row.start_time}::time and ${s(a.dateColumn)} >= ${effective}::date ${until ? s`and ${s(a.dateColumn)} <= ${until}::date` : s``}`);
      } catch (e) {
        console.error(`timetable.moveClassSlots.${a.table}: ${e?.code || ''} ${e?.message || ''}`);
        return { ok: false, error: '옮기기 전에 확인할 기록을 읽지 못해 중단했습니다. 잠시 후 다시 시도해 주세요' };
      }
      const dates = found.map(r => r.d.slice(0, 10)).filter(d => weekdayOf(d) === row.day_of_week);
      if (!dates.length) continue;
      const h = hits.get(a.label) ?? { label: a.label, count: 0, lastDate: '' };
      h.count += dates.length;
      h.lastDate = dates.reduce((m, d) => (d > m ? d : m), h.lastDate);
      hits.set(a.label, h);
    }
  }
  if (hits.size > 0) return { ok: false, error: X.anchors.slotAnchorBlockText([...hits.values()]) };
  // 분리등원(요일 지정) 학생이 있으면 요일을 옮기지 않는다(2.0 daySplitStudents).
  const dayChanges = windows.map(w => ({ from: byId.get(w.slotId).day_of_week, to: w.day })).filter(c => c.from !== c.to);
  if (dayChanges.length > 0) {
    const enr = await sql`select e.attendance_days, e.end_date::text end_date, coalesce(e.is_transferred, false) is_transferred, s.name
      from public.enrollments e left join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and e.class_id=${classId} and (e.end_date is null or e.end_date >= ${effective}::date)`;
    const names = X.anchors.daySplitStudents(enr.map(e => ({ name: e.name ?? '이름 없음', attendanceDays: e.attendance_days ?? null, endDate: e.end_date ?? null, isTransferred: e.is_transferred === true })), dayChanges, effective);
    if (names.length > 0) {
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}명` : '');
      return { ok: false, error: `요일을 정해 다니는 학생(분리등원 · ${shown})이 있는 반은 요일을 옮길 수 없습니다 — 옮기면 그 학생이 명단에서 빠지거나 다른 교시에 더해집니다. 같은 요일 안에서 시각만 옮겨 주세요` };
    }
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
  holdSingleEnrollment: { module: 'features/students/server/actions.ts', args: formArgs, run: holdSingleEnrollment },
  endSingleEnrollment: { module: 'features/students/server/actions.ts', args: formArgs, run: endSingleEnrollment },
  saveMemoSheet: { module: 'features/timetable-memo/server/actions.ts', args: memoArgs, run: saveMemoSheet },
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
// 다른 화면(수업목록)의 저장이 같은 신분·감사로그·사용자 역할 쓰기를 쓴다 — 규칙이 두 벌이 되지 않게.
export { actAs, audit, asAuthenticated, notifyClassAssignment, lastCourseViaReport, endEnrollmentById };
