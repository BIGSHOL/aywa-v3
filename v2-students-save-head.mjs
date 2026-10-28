// 2.0 화면 — 원생 저장(2단계) 중 머리·폼: features/students/server/actions.ts의 createStudent · updateStudent(형제 포함) · deleteStudent ·
// changeStudentStatus · cancelScheduledWithdrawal · endStudentEnrollments · setStudentEnrollmentHolds · clearDupSuspect와
// sibling-actions.ts loadSiblingOptions(형제 칸 고르기 목록 — 2.0도 서버 액션이라 같은 저장 경로로 받는다 · 읽기만)를 Docker 복사본에.
// 판정 순서·문구·반환 모양(StudentFormState · ChangeStatusState · { ok, error })·감사로그(action 이름 2.0 그대로 + metadata.via) 2.0 그대로.
// · 저장하는 사람 = 학생 관리 '전체'(v2-students-common.mjs readStudentEditors — 2.0 canManageStudentRecords). 세부 권한(원생 상태 =
//   canManageStudentStatus · 영구 삭제 = 관리 도구 쓰기)은 그 사람의 2.0 권한표(userPermMatrix)로 다시 본다.
// · 쓰기는 2.0처럼 사용자 역할(authenticated) + 그 사람 신분(request.jwt.claims)으로 — RLS·보호 트리거가 2.0처럼 본다. 신분 설정은 저장점을
//   풀어도 트랜잭션 끝까지 남으므로 저장이 끝나면 원래 값으로 되돌린다.
// · 2.0이 쓰는 서버 전용 조회(seatBlockReason · completeSchoolKind · resolveUniqueStudentNameFor · enrollment-sync)는 같은 표·같은 조건 SQL로,
//   판정은 2.0 순수 함수(importV2) 그대로. 마지막 반 판정(lastCourseViaReport)·감사로그·사용자 역할 쓰기는 시간표 저장 모듈 것을 그대로 쓴다.
// 🔴 바깥 호출은 하지 않는다: pushIjwProfiles(인재원 프로필 보내기 · updateStudent 뒤) · recordMathWithdrawalToSheet(구글 시트 · endStudentEnrollments 뒤)
//   · revalidatePath(호스트가 저장 뒤 다시 읽는다).
import { V2Error } from './v2-screens.mjs';
import { audit, asAuthenticated, lastCourseViaReport, loadExtra, endEnrollmentById } from './v2-timetable-save.mjs';
import { studentsBase, readStudentEditors } from './v2-students-common.mjs';
import { userPermMatrix } from './v2-onescreen-roster.mjs';

const ACTIONS_FILE = 'features/students/server/actions.ts', SIBLING_FILE = 'features/students/server/sibling-actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

let rulesP = null;
function rules(importV2) {
  rulesP ??= (async () => {
    const mods = { types: 'features/withdrawals/types.ts', reason: 'features/withdrawals/reason-detail.ts', plan: 'features/students/withdrawal-plan.ts',
      via: 'features/withdrawals/via-report.ts', suffix: 'features/students/name-suffix.ts', merged: 'features/students/status/merged.ts',
      school: 'features/schools/school-name.ts', access: 'features/students/status-access.ts', siblings: 'features/students/siblings.ts',
      license: 'lib/license/rule.ts', dk: 'lib/date-kst.ts', dbErr: 'lib/supabase/db-error.ts' };
    return Object.fromEntries(await Promise.all(Object.entries(mods).map(async ([k, p]) => [k, await importV2(p)])));
  })().catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

// ── 2.0 인자 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → FormData. 학생 폼은 칸이 많고 형제 칸이 id 목록(JSON)이라 상한을 넉넉히. */
function formArg(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 120) throw bad();
  const fd = new FormData();
  for (const pair of v.$formData) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || pair[0].length > 60 || pair[1].length > 20000) throw bad();
    fd.append(pair[0], pair[1]);
  }
  return fd;
}
/** useActionState(action) — (이전 상태, FormData). 이전 상태는 쓰지 않는다. */
const formArgs = (args) => { if (args.length !== 2) throw bad(); return [null, formArg(args[1])]; };
/** clearDupSuspect(studentId) · loadSiblingOptions(studentId) — 글자 하나. */
const idArgs = (args) => { if (args.length !== 1 || typeof args[0] !== 'string' || args[0].length > 80) throw bad(); return [args[0]]; };

// ── 저장하는 사람 · 신분 ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * 고른 사람의 2.0 권한 — 학생 관리 '전체'(저장하는 사람 목록)가 아니면 null. 원생 상태 권한(canManageStudentStatusNow)과 메뉴 단계(level)도 함께.
 * (3.0엔 로그인이 없어 강사 뷰·지점 보기 같은 읽기 전용 갈래가 없다.)
 */
async function whoIs(sql, t, importV2, actorId) {
  if (!actorId || !UUID.test(actorId)) return null;
  const base = await studentsBase({ sql, tenantId: t, importV2 });
  const editor = (await readStudentEditors(base)).find((e) => e.id === actorId);
  if (!editor) return null;
  const [u] = await sql`select system_role::text role from public.users where tenant_id=${t} and id=${actorId}`;
  const matrix = await userPermMatrix(base.sql, base.RR, base.settings, { id: actorId, system_role: u.role }, t, base.clock.at);
  const level = (menu) => base.RR.accessLevel(u.role, menu, matrix);
  const statusOk = level('students') === 'full'
    && base.X.statusAccess.canManageStudentStatus({ id: actorId, systemRole: u.role }, false, base.RR.studentStatusManagerIds(base.settings.permissions.specialAccess));
  return { actor: { id: editor.id, name: editor.name }, role: u.role, level, statusOk, settings: base.settings };
}

/** 그 사람 신분으로 fn을 돌리고 끝나면 신분 설정을 원래대로(저장점을 풀어도 트랜잭션 끝까지 남는 설정 — MCS 세션 발견). */
async function asActor(sql, actorId, fn) {
  const [{ prev }] = await sql`select current_setting('request.jwt.claims', true) prev`;
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId, role: 'authenticated' })}, true)`;
  try { return await fn(); } finally { await sql`select set_config('request.jwt.claims', ${prev ?? ''}, true)`; }
}

/** postgres.js 오류 → 2.0 supabase 오류 모양(explainDbError가 읽는 칸). */
const dbError = (e) => ({ code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null });
const dbWhy = (S, e, scope, fallback, op) => S.dbErr.explainDbError(dbError(e), { scope, fallback, op }).message;
/** studentSaveError — 이유 + 그 칸 표시(23505를 한 문장으로 뭉치지 않는다). */
function studentSaveError(S, e, scope, fallback) {
  const why = S.dbErr.explainDbError(dbError(e), { scope, fallback });
  return why.field ? { error: why.message, fieldErrors: { [why.field]: why.message } } : { error: why.message };
}
/** 사용자 역할로 쓰기 — 실패하면 그 오류를 던진다(호출부가 2.0 문구로 바꾼다). */
const write = (sql, fn) => asAuthenticated(sql, fn);

// ── actions.ts 위쪽: 폼 읽기 · 검증 ──────────────────────────────────────────────────────────────────────────────────
const STATUSES = ['prospect', 'consulted', 'enrolled', 'on_hold', 'withdrawn'];
const STUDENT_MANAGE_DENIED = '학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다';

/** 한국 전화번호 정규화(F5) — 2.0 normalizePhone 그대로. */
function normalizePhone(raw) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 && d.startsWith('10')) d = `0${d}`;
  if (d.length === 11 && d.startsWith('010')) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return raw;
}

function readForm(S, formData, schoolAliases) {
  const get = (k) => { const v = formData.get(k); return v == null ? '' : String(v).trim(); };
  const status = get('status'), gender = get('gender');
  return {
    name: get('name'), englishName: get('englishName') || null, classnoteName: get('classnoteName') || null, grade: get('grade') || null,
    school: S.school.canonicalSchoolName(get('school'), schoolAliases),
    studentCode: get('studentCode') || null, attendanceCode: get('attendanceCode') || null,
    gender: gender === 'male' || gender === 'female' ? gender : null,
    birthDate: get('birthDate') || null, nickname: get('nickname') || null, graduationYear: get('graduationYear') || null,
    address: get('address') || null, zipCode: get('zipCode') || null, addressDetail: get('addressDetail') || null, email: get('email') || null,
    studentPhone: normalizePhone(get('studentPhone') || null), homePhone: normalizePhone(get('homePhone') || null), otherPhone: normalizePhone(get('otherPhone') || null),
    parentName: get('parentName') || null, parentPhone: normalizePhone(get('parentPhone') || null), parentRelation: get('parentRelation') || null,
    status: STATUSES.includes(status) ? status : 'prospect',
    enrolledAt: get('enrolledAt') || null, withdrawnAt: get('withdrawnAt') || null, notes: get('notes') || null,
  };
}

function validate(input) {
  const errors = {};
  if (!input.name) errors.name = '이름은 필수입니다';
  if (input.parentPhone && !/^[\d\s\-+()]{8,}$/.test(input.parentPhone)) errors.parentPhone = '연락처 형식을 확인해주세요';
  if (input.status === 'withdrawn' && !input.withdrawnAt) errors.withdrawnAt = '퇴원일을 입력해주세요';
  return Object.keys(errors).length > 0 ? errors : null;
}

/** 폼에서 읽은 사유 → 새 퇴원 메타데이터(상담 기록은 빈 채로 시작). */
const freshWithdrawalMetadata = (r) => ({ reason: r.reason, ...(r.detail ? { detail: r.detail } : {}), memo: r.memo,
  consultation: { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false } });

// ── 서버 전용 2.0 함수(같은 표·같은 조건) ─────────────────────────────────────────────────────────────────────────────
/** lib/license/server.ts seatBlockReason — 재원생 좌석 한도. 조회 실패는 허용으로 둔다(2.0과 같다). */
async function seatBlockReason(sql, S, t, adding, exclude = []) {
  if (adding <= 0) return null;
  try {
    return await sql.savepoint(async (s) => {
      const [row] = await s`select is_active, max_seats from public.tenant_licenses where tenant_id=${t} and feature='student_seats'`;
      const limit = S.license.seatLimitOf(row ?? null);
      if (limit === null) return null;
      const ids = exclude.filter((id) => UUID.test(id));
      const [{ n }] = await s`select count(*)::int n from public.students where tenant_id=${t} and status='enrolled' and not (id = any(${ids}::uuid[]))`;
      return S.license.seatsExceeded(limit, n, adding) ? S.license.seatBlockedMessage(limit, n) : null;
    });
  } catch (e) {
    console.error(`[license] 좌석 판정 실패 — 허용으로 둔다 ${e?.code || ''}`);
    return null;
  }
}
/** features/schools/server/complete-kind.ts completeSchoolKind — 급이 빠진 학교를 학년으로 채운다(학교알리미에 있는 학교만). */
async function completeSchoolKind(sql, S, t, school, grade, aliases) {
  const candidate = S.school.schoolKindCandidate(school, grade);
  if (!candidate) return school;
  try {
    const rows = await sql.savepoint((s) => s`select name_key from public.school_enrollment_stats where tenant_id=${t} and name_key=${S.school.normalizeSchoolName(candidate)} limit 1`);
    return S.school.fillSchoolKind(school, grade, new Set(rows.map((r) => r.name_key)), aliases);
  } catch (e) {
    console.error(`[completeSchoolKind] ${e?.code || ''}`);
    return school;
  }
}
/** 지점의 학생 이름 전부(동명이인 접미사 판정 — resolveUniqueStudentNameFor · updateStudent의 taken). */
const studentNames = (sql, t) => sql`select id::text id, name from public.students where tenant_id=${t}`;

/** enrollment-sync.ts — 퇴원이 닫은 수강 다시 열기 · 열린 수강 대기 풀기 · 열린 수강 목록 · 수강 한 건 종료. 문구 = why(…, fallback). */
const SYNC_FALLBACK = '수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
async function reopenEnrollmentsClosedByWithdrawal(sql, S, studentId, withdrawnDate) {
  if (!withdrawnDate) return null;
  try { await write(sql, (s) => s`update public.enrollments set end_date=null, withdrawal_reason=null, withdrawal_detail=null, withdrawal_memo=null, on_hold=false
    where student_id=${studentId} and end_date=${withdrawnDate}::date`); return null; } catch (e) { return dbWhy(S, e, 'students.enrollmentSync.reopen', SYNC_FALLBACK); }
}
async function clearOnHoldForActiveEnrollments(sql, S, studentId) {
  try { await write(sql, (s) => s`update public.enrollments set on_hold=false where student_id=${studentId} and end_date is null`); return null; }
  catch (e) { return dbWhy(S, e, 'students.enrollmentSync.clearOnHold', SYNC_FALLBACK); }
}
async function listOpenEnrollments(sql, S, studentId) {
  try {
    const rows = await write(sql, (s) => s`select id::text id, class_id::text class_id, on_hold from public.enrollments where student_id=${studentId} and end_date is null limit 200`);
    return { error: null, rows: rows.map((r) => ({ id: r.id, classId: r.class_id ?? null, onHold: r.on_hold === true })) };
  } catch (e) { return { error: dbWhy(S, e, 'students.enrollmentSync.listOpen', SYNC_FALLBACK), rows: [] }; }
}
// endEnrollmentById = 시간표 저장의 같은 함수(v2-timetable-save.mjs — 2.0 enrollment-sync.ts 한 벌 · 같은 데이터는 같은 원본).

// ── createStudent ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function createStudent(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  if (!who) return { error: STUDENT_MANAGE_DENIED };
  const aliases = who.settings.operations.schoolSaveAliases;
  const input = readForm(S, formData, aliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };
  if (S.access.statusCreationNeedsPermission(input.status, input.withdrawnAt) && !who.statusOk) return { error: S.access.STUDENT_STATUS_DENIED };
  const createPlan = S.plan.planFormWithdrawal({ prevStatus: null, status: input.status, withdrawnAt: input.withdrawnAt, today: S.dk.kstToday() });
  if (createPlan.error) return { fieldErrors: { withdrawnAt: createPlan.error } };
  const createViaReport = S.via.formWithdrawalViaReport({ prevStatus: null, kind: createPlan.kind, withdrawnAt: createPlan.withdrawnAt });
  if (createViaReport) return { fieldErrors: { withdrawnAt: createViaReport } };
  let createMeta = null;
  if (S.plan.formWithdrawalNeedsReason({ prevStatus: null, kind: createPlan.kind })) {
    const picked = S.reason.readReasonForm(formData);
    if (picked.error !== undefined) return { error: picked.error };
    createMeta = freshWithdrawalMetadata(picked);
  }
  if (createPlan.status === 'enrolled') {
    const seat = await seatBlockReason(sql, S, t, 1);
    if (seat) return { error: seat };
  }
  input.school = await completeSchoolKind(sql, S, t, input.school, input.grade, aliases);
  const resolvedName = S.suffix.resolveUniqueStudentName(input.name, new Set((await studentNames(sql, t)).map((r) => (r.name ?? '').trim()).filter(Boolean)));
  let created;
  try {
    [created] = await write(sql, (s) => s`insert into public.students (tenant_id, name, english_name, classnote_name, grade, school, student_code, attendance_code, gender,
        birth_date, nickname, graduation_year, address, zip_code, address_detail, email, student_phone, home_phone, other_phone, parent_name, parent_phone,
        parent_relation, status, enrolled_at, withdrawn_at, withdrawal_metadata, notes)
      values (${t}, ${resolvedName.name}, ${input.englishName}, ${input.classnoteName}, ${input.grade}, ${input.school}, ${input.studentCode}, ${input.attendanceCode},
        ${input.gender}, ${input.birthDate}, ${input.nickname}, ${input.graduationYear}, ${input.address}, ${input.zipCode}, ${input.addressDetail}, ${input.email},
        ${input.studentPhone}, ${input.homePhone}, ${input.otherPhone}, ${input.parentName}, ${input.parentPhone}, ${input.parentRelation}, ${createPlan.status},
        ${input.enrolledAt}, ${createPlan.withdrawnAt}, ${createMeta ? s.json(createMeta) : null}, ${input.notes})
      returning id::text id`);
  } catch (e) { return studentSaveError(S, e, 'students.create', '학생을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  await audit(sql, t, who.actor, 'student_create', 'student',
    { studentId: created.id, ...(createMeta ? { reason: createMeta.reason, detail: createMeta.detail ?? null } : {}) }, resolvedName.name);
  return { ok: true, redirectTo: `/students/${created.id}`, nonce: Date.now(),
    notice: resolvedName.suffixed ? `이미 '${input.name}' 학생이 있어 '${resolvedName.name}'(으)로 등록했습니다.` : undefined };
}

// ── updateStudent ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function updateStudent(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  if (!who) return { error: STUDENT_MANAGE_DENIED };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '학생 ID가 누락되었습니다' };
  const aliases = who.settings.operations.schoolSaveAliases;
  const input = readForm(S, formData, aliases);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };
  input.school = await completeSchoolKind(sql, S, t, input.school, input.grade, aliases);
  const [cur] = UUID.test(id) ? await sql`select status::text status, withdrawal_metadata, withdrawn_at::text withdrawn_at, name, notes
    from public.students where tenant_id=${t} and id=${id}` : [];
  if (!cur) return { error: '학생을 찾을 수 없습니다' };
  const curWithdrawn = cur.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
  if (!formData.has('status')) input.status = cur.status;
  if (!formData.has('withdrawnAt')) input.withdrawnAt = curWithdrawn;
  const statusAccess = who.statusOk;
  if (!statusAccess && (input.status !== cur.status || input.withdrawnAt !== curWithdrawn)) return { error: S.access.STUDENT_STATUS_DENIED };
  const prevStatus = cur.status;
  if (input.status === 'enrolled' && prevStatus !== 'enrolled') {
    const seat = await seatBlockReason(sql, S, t, 1, [id]);
    if (seat) return { error: seat };
  }
  const today = S.dk.kstToday();
  const scheduledPrev = prevStatus !== 'withdrawn' && !!cur.withdrawn_at;
  const withdrawalPlan = statusAccess
    ? S.plan.planFormWithdrawal({ prevStatus: prevStatus ?? null, prevWithdrawnAt: cur.withdrawn_at ?? null, status: input.status, withdrawnAt: input.withdrawnAt, today })
    : { status: cur.status, withdrawnAt: curWithdrawn, kind: scheduledPrev ? 'schedule' : cur.status === 'withdrawn' ? 'withdraw' : 'none', error: undefined };
  if (withdrawalPlan.error) return { fieldErrors: { withdrawnAt: withdrawalPlan.error } };
  const viaReport = S.via.formWithdrawalViaReport({ prevStatus: prevStatus ?? null, prevWithdrawnAt: cur.withdrawn_at ?? null, kind: withdrawalPlan.kind,
    withdrawnAt: withdrawalPlan.withdrawnAt });
  if (viaReport) return { error: viaReport };
  const schedulingNow = statusAccess && withdrawalPlan.kind === 'schedule';
  const savedStatus = withdrawalPlan.status;
  let withdrawalMetadata = cur.withdrawal_metadata ?? null;
  if (schedulingNow) withdrawalMetadata = cur.withdrawal_metadata ?? S.types.DEFAULT_WITHDRAWAL_METADATA;
  else if (statusAccess && withdrawalPlan.kind === 'none') withdrawalMetadata = null;
  const savedWithdrawnAt = withdrawalPlan.withdrawnAt;
  const cancelledSchedule = statusAccess && scheduledPrev && withdrawalPlan.kind === 'none' ? curWithdrawn : null;

  const currentName = (cur.name ?? '').trim();
  let finalName = input.name, renamed = false;
  if (input.name.trim() !== currentName) {
    const taken = new Set((await studentNames(sql, t)).filter((r) => r.id !== id).map((r) => (r.name ?? '').trim()).filter(Boolean));
    const resolved = S.suffix.resolveUniqueStudentName(input.name, taken);
    finalName = resolved.name;
    renamed = resolved.suffixed;
  }
  const notes = S.merged.preserveMergeNote(cur.notes ?? null, input.notes, input.status === 'withdrawn');
  let changed;
  try {
    changed = await write(sql, (s) => s`update public.students set name=${finalName}, english_name=${input.englishName}, classnote_name=${input.classnoteName},
        grade=${input.grade}, school=${input.school}, student_code=${input.studentCode}, attendance_code=${input.attendanceCode}, gender=${input.gender},
        birth_date=${input.birthDate}, nickname=${input.nickname}, graduation_year=${input.graduationYear}, address=${input.address}, zip_code=${input.zipCode},
        address_detail=${input.addressDetail}, email=${input.email}, student_phone=${input.studentPhone}, home_phone=${input.homePhone}, other_phone=${input.otherPhone},
        parent_name=${input.parentName}, parent_phone=${input.parentPhone}, parent_relation=${input.parentRelation},
        ${statusAccess ? s`status=${savedStatus}, withdrawn_at=${savedWithdrawnAt}, withdrawal_metadata=${withdrawalMetadata === null ? null : s.json(withdrawalMetadata)},` : s``}
        enrolled_at=${input.enrolledAt}, notes=${notes}
      where id=${id} and status=${cur.status} and ${cur.withdrawn_at === null ? s`withdrawn_at is null` : s`withdrawn_at=${cur.withdrawn_at}::date`}
      returning id::text id`);
  } catch (e) { return studentSaveError(S, e, 'students.update', '학생 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!changed.length) return { error: '원생 상태가 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.' };
  // ⚠️ 2.0은 여기서 인재원 짝 학생의 프로필을 응답 뒤에 보낸다(pushIjwProfiles) — 바깥 호출이라 하지 않는다.
  if (savedStatus === 'enrolled' && prevStatus !== 'enrolled') {
    const withdrawnDate = prevStatus === 'withdrawn' && cur.withdrawn_at ? curWithdrawn : null;
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(sql, S, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };
    const holdErr = await clearOnHoldForActiveEnrollments(sql, S, id);
    if (holdErr) return { error: holdErr };
  } else if (savedStatus === 'on_hold' && prevStatus !== 'on_hold') {
    try { await write(sql, (s) => s`update public.enrollments set on_hold=true where student_id=${id} and end_date is null`); }
    catch (e) { return { error: dbWhy(S, e, 'students.update.holdEnrollments', '수강을 휴원으로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  }
  let siblingNotice = null;
  if (formData.has('siblingsField')) {
    const ids = (key) => {
      try {
        const v = JSON.parse(String(formData.get(key) ?? '[]'));
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()) : [];
      } catch { return []; }
    };
    try {
      const sib = await sql.savepoint((s) => saveStudentSiblings(s, S, { tenantId: t, userId: who.actor.id, studentId: id,
        final: ids('siblings'), initial: ids('siblingsInitial'), suggested: ids('siblingsSuggested') }));
      if (sib.added.length + sib.excluded.length + sib.removed.length > 0) {
        await audit(sql, t, who.actor, 'student_siblings_update', 'student', { studentId: id, added: sib.added, excluded: sib.excluded, removed: sib.removed }, finalName);
      }
    } catch (e) {
      console.error(`students.update.siblings ${e?.code || ''} ${e?.message || ''}`);
      siblingNotice = '원생 정보는 저장했습니다. 형제는 저장하지 못했습니다 — 학생 수정 화면에서 다시 지정해 주세요.';
    }
  }
  await audit(sql, t, who.actor, 'student_update', 'student',
    { studentId: id, statusFrom: prevStatus ?? null, statusTo: savedStatus, ...(cancelledSchedule ? { cancelledWithdrawal: cancelledSchedule } : {}) }, finalName);
  return { ok: true, redirectTo: `/students/${id}`, nonce: Date.now(),
    notice: [renamed ? `이미 '${input.name}' 학생이 있어 '${finalName}'(으)로 저장했습니다.` : null, siblingNotice].filter(Boolean).join('\n') || undefined };
}

/** server/siblings.ts saveStudentSiblings — 바뀐 짝만 쓴다(2.0은 관리자 클라이언트로 student_siblings를 쓴다 — 여기도 접속 계정 그대로). */
async function saveStudentSiblings(s, S, input) {
  const none = { added: [], excluded: [], removed: [] };
  const asked = [...new Set([...input.final, ...input.initial])].filter((id) => id && id !== input.studentId).slice(0, 200);
  const rows = asked.length ? await s`select id::text id, name from public.students where tenant_id=${input.tenantId} and id = any(${asked}::uuid[])` : [];
  const nameOf = new Map(rows.map((r) => [r.id, r.name ?? '']));
  const real = (ids) => ids.filter((id) => nameOf.has(id) && id !== input.studentId);
  const plan = S.siblings.planSiblingSave(real(input.final), real(input.initial), input.suggested);
  if (plan.set.length === 0 && plan.remove.length === 0) return none;
  const now = new Date().toISOString();
  for (const { other, linked } of plan.set) {
    const [a, b] = S.siblings.siblingPair(input.studentId, other);
    await s`insert into public.student_siblings (tenant_id, student_a, student_b, linked, updated_by, updated_at) values (${input.tenantId}, ${a}, ${b}, ${linked}, ${input.userId}, ${now})
      on conflict (student_a, student_b) do update set tenant_id=excluded.tenant_id, linked=excluded.linked, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
  }
  for (const other of plan.remove) {
    const [a, b] = S.siblings.siblingPair(input.studentId, other);
    await s`delete from public.student_siblings where tenant_id=${input.tenantId} and student_a=${a} and student_b=${b}`;
  }
  const names = (ids) => ids.map((id) => nameOf.get(id) ?? '');
  return { added: names(plan.set.filter((x) => x.linked).map((x) => x.other)), excluded: names(plan.set.filter((x) => !x.linked).map((x) => x.other)), removed: names(plan.remove) };
}

// ── deleteStudent ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function deleteStudent(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  // 2.0 = canWriteTenant(관리 도구) — 학생 관리 '전체'가 아니면 저장하는 사람이 아니라 이 문구까지 오지 않는다(원장·위임받은 관리자만 통과).
  if (!who || !['full', 'scoped'].includes(who.level('admin'))) return { error: '영구 삭제 권한이 없습니다(관리 도구 권한 필요)' };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '학생 ID가 누락되었습니다' };
  if (!UUID.test(id)) return { error: '학생을 찾을 수 없거나 권한이 없습니다' };
  const [target] = await sql`select name from public.students where tenant_id=${t} and id=${id}`;
  const [{ n }] = await sql`select count(*)::int n from public.invoices where tenant_id=${t} and student_id=${id}`;
  if (n > 0) return { error: "청구(수납) 기록이 있어 영구 삭제할 수 없습니다. 그만둔 학생이면 '퇴원보고서'로 퇴원을 처리해 주세요." };
  let deleted;
  try { deleted = await write(sql, (s) => s`delete from public.students where id=${id} returning id`); }
  catch (e) { return { error: dbWhy(S, e, 'students.delete', '학생을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') }; }
  if (!deleted.length) return { error: '학생을 찾을 수 없거나 권한이 없습니다' };
  await audit(sql, t, who.actor, 'student_delete', 'student', { studentId: id, studentName: target?.name ?? null }, target?.name ?? null);
  return { ok: true };
}

// ── changeStudentStatus · cancelScheduledWithdrawal ──────────────────────────────────────────────────────────────────
async function changeStudentStatus(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  if (!who?.statusOk) return { error: S.access.STUDENT_STATUS_DENIED };
  const id = String(formData.get('id') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const memo = String(formData.get('memo') ?? '').trim() || null;
  if (!id) return { error: '학생 ID가 누락되었습니다' };
  if (!['withdrawn', 'on_hold', 'enrolled'].includes(target)) return { error: '유효하지 않은 상태 전환입니다' };
  if (target === 'withdrawn') return { error: S.via.WITHDRAWAL_VIA_REPORT };
  if (target === 'enrolled') {
    const seat = await seatBlockReason(sql, S, t, 1, [id]);
    if (seat) return { error: seat };
  }
  if (!UUID.test(id)) return { error: '학생 ID가 누락되었습니다' };
  const writeStatusLog = () => audit(sql, t, who.actor, target === 'on_hold' ? 'student_hold' : 'student_restore', 'student', target === 'on_hold' ? { studentId: id, memo } : { studentId: id });
  if (target === 'on_hold') {
    try { await write(sql, (s) => s`update public.students set status='on_hold' where id=${id}`); }
    catch (e) { return { error: dbWhy(S, e, 'students.status.hold', '휴원 처리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
    await writeStatusLog();
    try { await write(sql, (s) => s`update public.enrollments set on_hold=true where student_id=${id} and end_date is null`); }
    catch (e) { return { error: dbWhy(S, e, 'students.status.hold.enrollments', '수강을 휴원으로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  } else {
    const [before] = await write(sql, (s) => s`select status::text status, withdrawn_at::text withdrawn_at from public.students where id=${id}`);
    const wasWithdrawn = before?.status === 'withdrawn';
    const withdrawnDate = wasWithdrawn && before?.withdrawn_at ? String(before.withdrawn_at).slice(0, 10) : null;
    try {
      await write(sql, (s) => (wasWithdrawn
        ? s`update public.students set status='enrolled', withdrawn_at=null, withdrawal_metadata=null where id=${id}`
        : s`update public.students set status='enrolled' where id=${id}`));
    } catch (e) { return { error: dbWhy(S, e, 'students.status.restore', '재원 복구를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
    await writeStatusLog();
    const reopenErr = await reopenEnrollmentsClosedByWithdrawal(sql, S, id, withdrawnDate);
    if (reopenErr) return { error: reopenErr };
    try { await write(sql, (s) => s`update public.enrollments set on_hold=false where student_id=${id} and end_date is null`); }
    catch (e) { return { error: dbWhy(S, e, 'students.status.restore.enrollments', '수강을 다시 열지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  }
  return { ok: true };
}

async function cancelScheduledWithdrawal(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  if (!who?.statusOk) return { error: S.access.STUDENT_STATUS_DENIED };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '학생 ID가 누락되었습니다' };
  if (!UUID.test(id)) return { error: '취소할 퇴원 예약이 없습니다. 화면을 새로고침해 주세요.' };
  const [cur] = await sql`select withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id=${id}`;
  let data;
  try {
    data = await write(sql, (s) => s`update public.students set withdrawn_at=null, withdrawal_metadata=null
      where id=${id} and status <> 'withdrawn' and withdrawn_at is not null returning id::text id, name`);
  } catch (e) { return { error: dbWhy(S, e, 'students.cancelScheduledWithdrawal', '퇴원 예약을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (!data.length) return { error: '취소할 퇴원 예약이 없습니다. 화면을 새로고침해 주세요.' };
  const before = cur?.withdrawn_at ? String(cur.withdrawn_at).slice(0, 10) : null;
  await audit(sql, t, who.actor, 'student_restore', 'student', { studentId: id, cancelledWithdrawal: before }, data[0]?.name ?? null);
  return { ok: true };
}

// ── endStudentEnrollments · setStudentEnrollmentHolds(상태 창의 부분 종료 · 부분 휴원) ───────────────────────────────────
async function endStudentEnrollments(ctx, [, formData]) {
  const { sql, t, S, X, who } = ctx;
  if (!who?.statusOk) return { error: S.access.STUDENT_STATUS_DENIED };
  const studentId = String(formData.get('studentId') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();
  const reasonStr = String(formData.get('reason') ?? '').trim();
  const detailStr = String(formData.get('detail') ?? '').trim() || null;
  const memo = String(formData.get('memo') ?? '').trim() || null;
  const picked = new Set(formData.getAll('enrollmentIds').map((v) => String(v).trim()).filter(Boolean));
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!date) return { error: '종료일을 입력해주세요' };
  if (!S.types.WITHDRAWAL_REASONS.includes(reasonStr)) return { error: '종료 사유를 선택해주세요' };
  const checked = S.reason.checkReasonInput({ reason: reasonStr, detail: detailStr, memo });
  if (checked.error !== undefined) return { error: checked.error };
  if (picked.size === 0) return { error: '종료할 수업을 1개 이상 선택해주세요' };
  if (!UUID.test(studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  const { error: listErr, rows: open } = await listOpenEnrollments(sql, S, studentId);
  if (listErr) return { error: '수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  const targets = open.filter((r) => picked.has(r.id));
  if (targets.length === 0) return { error: '종료할 수 있는 수강이 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
  const lastCourse = await lastCourseViaReport(sql, t, X, { studentId, enrollmentIds: targets.map((x) => x.id), date });
  if (lastCourse) return { error: lastCourse };
  for (const tg of targets) {
    const res = await endEnrollmentById(sql, t, X, tg.id, date, reasonStr, { detail: checked.detail, memo }, studentId);
    if (res.error) return { error: '수강을 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    await audit(sql, t, who.actor, 'enrollment_end', 'student', { studentId, classId: res.classId, date: res.endDate, reason: reasonStr, detail: checked.detail, memo,
      source: 'status_dialog', partial: targets.length < open.length });
  }
  // ⚠️ 2.0은 여기서 수학을 그만둔 학생을 구글 시트에 적는다(recordMathWithdrawalToSheet, 응답 뒤) — 바깥 호출이라 하지 않는다.
  return { ok: true };
}

async function setStudentEnrollmentHolds(ctx, [, formData]) {
  const { sql, t, S, who } = ctx;
  if (!who?.statusOk) return { error: S.access.STUDENT_STATUS_DENIED };
  const studentId = String(formData.get('studentId') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim() || S.dk.kstToday();
  const picked = new Set(formData.getAll('enrollmentIds').map((v) => String(v).trim()).filter(Boolean));
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!UUID.test(studentId)) return { error: '수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  const { error: listErr, rows: open } = await listOpenEnrollments(sql, S, studentId);
  if (listErr) return { error: '수강 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  const toHold = open.filter((r) => picked.has(r.id) && !r.onHold);
  const toResume = open.filter((r) => !picked.has(r.id) && r.onHold);
  const heldAfter = open.filter((r) => picked.has(r.id)).length;
  if (toHold.length === 0 && toResume.length === 0) return { ok: true };
  for (const r of toHold) {
    try { await write(sql, (s) => s`update public.enrollments set on_hold=true where id=${r.id}`); }
    catch (e) { return { error: dbWhy(S, e, 'students.enrollmentHolds.hold', '수강을 대기로 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
    await audit(sql, t, who.actor, 'enrollment_hold', 'student', { studentId, classId: r.classId, date, source: 'status_dialog', partial: heldAfter < open.length });
  }
  for (const r of toResume) {
    try { await write(sql, (s) => s`update public.enrollments set on_hold=false where id=${r.id}`); }
    catch (e) { return { error: dbWhy(S, e, 'students.enrollmentHolds.resume', '수강을 되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
    await audit(sql, t, who.actor, 'enrollment_resume', 'student', { studentId, classId: r.classId, date, source: 'status_dialog' });
  }
  return { ok: true };
}

// ── clearDupSuspect · loadSiblingOptions ─────────────────────────────────────────────────────────────────────────────
async function clearDupSuspect(ctx, [studentId]) {
  const { sql, t, S, who } = ctx;
  if (!who) return { error: STUDENT_MANAGE_DENIED };
  const id = String(studentId ?? '').trim();
  if (!id) return { error: '학생 ID가 누락되었습니다' };
  let cleared;
  try { cleared = UUID.test(id) ? await write(sql, (s) => s`update public.students set dup_suspect=false where id=${id} returning id`) : []; }
  catch (e) { return { error: dbWhy(S, e, 'students.clearDupSuspect', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') }; }
  if (!cleared.length) return { error: '표식을 내리지 못했습니다 — 이 학생 정보를 바꿀 수 없는 계정이거나 이미 없는 학생입니다' };
  await audit(sql, t, who.actor, 'student_dup_confirm', 'student', { studentId: id });
  return { ok: true };
}

/** 형제 칸 고르기 목록(읽기) — 자기 자신 · 시험용 · 중복 병합된 원생 · 이름 없는 원생 빼고 이름순. 권한 = 원생 정보 변경(학생 수정 저장과 같은 문). */
async function loadSiblingOptions(ctx, [studentId]) {
  const { sql, t, S, who } = ctx;
  if (!who) return { ok: false, error: '원생 정보 변경 권한이 없습니다' };
  try {
    const rows = await sql`select id::text id, name, school, grade, status::text status, notes, is_test from public.students where tenant_id=${t} order by name, id`;
    return { ok: true, options: rows.filter((r) => r.id !== studentId && !r.is_test && !S.merged.isMergedStudent(r.notes) && r.name?.trim())
      .map((r) => ({ value: r.id, label: (r.name ?? '').trim(), hint: S.siblings.siblingHint(r) })) };
  } catch (e) {
    console.error(`[students/siblings] 고르기 목록 조회 실패 ${e?.code || ''}`);
    return { ok: false, error: '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const ACTIONS = {
  createStudent: { module: ACTIONS_FILE, args: formArgs, run: createStudent },
  updateStudent: { module: ACTIONS_FILE, args: formArgs, run: updateStudent },
  deleteStudent: { module: ACTIONS_FILE, args: formArgs, run: deleteStudent },
  changeStudentStatus: { module: ACTIONS_FILE, args: formArgs, run: changeStudentStatus },
  cancelScheduledWithdrawal: { module: ACTIONS_FILE, args: formArgs, run: cancelScheduledWithdrawal },
  endStudentEnrollments: { module: ACTIONS_FILE, args: formArgs, run: endStudentEnrollments },
  setStudentEnrollmentHolds: { module: ACTIONS_FILE, args: formArgs, run: setStudentEnrollmentHolds },
  clearDupSuspect: { module: ACTIONS_FILE, args: idArgs, run: clearDupSuspect },
  loadSiblingOptions: { module: SIBLING_FILE, args: idArgs, run: loadSiblingOptions },
};

/** 공통 틀(v2-screens.mjs)의 actions — 2.0 함수 이름 그대로. 고른 사람의 신분으로 쓰고, 끝나면 신분 설정을 되돌린다. */
export const studentsHeadActions = Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, {
  validate: (raw) => {
    if (!plain(raw) || raw.module !== a.module || !Array.isArray(raw.args) || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
    return { actor: raw.actor ?? null, args: a.args(raw.args) };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    const [S, X] = await Promise.all([rules(importV2), loadExtra(importV2)]);
    const who = await whoIs(sql, t, importV2, body.actor);
    const ctx = { sql, t, S, X, who };
    return who ? asActor(sql, who.actor.id, () => a.run(ctx, body.args)) : a.run(ctx, body.args);
  },
}]));
