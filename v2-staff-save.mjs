// 2.0 화면 — 직원관리 저장(V2-SCREENS.md `staff`, 처리 화면 세션 R · 작업자 A). 2.0 서버 함수와 같은 이름·인자·검증·표·칸·문구·감사로그를
// Docker 복사본 하나의 쓰기 트랜잭션에서:
//  · features/staff/server/actions.ts — createStaff · updateStaff · changeStaffRole · deactivateStaff · handoverAndDeactivate
//  · features/staff/server/account-actions.ts — resetStaffPassword · changeStaffEmail · deleteStaff · updateWorkSchedule
//  · features/staff/contract/server/contract-actions.ts — extendStaffContract · updateStaffContract · deleteStaffContract
//  · features/staff/intake/server/intake-token-actions.ts — ensureStaffIntakeToken · updateStaffIntakeToken
//  · features/staff/list/server/list-prefs.ts — saveStaffListPrefs
// 2.0이 세션 클라이언트(RLS)로 쓰는 자리는 고른 사람의 신분으로(asUserWrite), 관리 키로 쓰는 자리는 신분 없이 tenant_id를 명시해 쓴다.
// 🔴 바깥 호출은 하지 않는다 — Supabase 로그인 계정(auth.admin: 만들기·비밀번호·이메일·역할 동기화·삭제·로그인 차단)은 그 자리에서 거절한다.
//    단 2.0이 '로그인 계정이 없는 직원'(임포트분 #31)을 정상 경로로 다루는 자리(이메일 변경·삭제)는 복사본의 auth.users로 그 사실을 보고 DB만 쓴다.
//    퇴사 때의 로그인 차단(setStaffLoginBlocked)은 2.0도 실패를 삼키는 부수효과라 하지 않고 넘어간다(앱 쪽 벽은 상태값이 맡는다).
//    알림은 notifications 줄까지(슬랙 깨우기 pokeSlack은 바깥 전송이라 안 함).
import { randomUUID } from 'node:crypto';
import { V2Error } from './v2-screens.mjs';
import { UUID, audit, serverCall } from './v2-proc-people.mjs';
import { readStaffPeople, canSeeStaffMember, isFullShellRole, getActiveAssistSlotClasses } from './v2-staff-read.mjs';

const M_ACTIONS = 'features/staff/server/actions.ts', M_ACCOUNT = 'features/staff/server/account-actions.ts', M_CONTRACT = 'features/staff/contract/server/contract-actions.ts';
const M_INTAKE = 'features/staff/intake/server/intake-token-actions.ts', M_PREFS = 'features/staff/list/server/list-prefs.ts';

// 2.0 문구(서버 전용 파일에 있어 불러오지 못하는 상수 — verify가 2.0 원문에서 같은 글자를 찾는다).
export const STAFF_SCOPE_DENIED_MSG = '담당 과목 밖의 직원은 볼 수 없습니다';
export const SUPER_ADMIN_TARGET_DENIED_MSG = '이 계정을 변경할 권한이 없습니다';
export const PROTECTED_ACCOUNT_DENIED_MSG = '보호된 계정입니다 — 역할·상태는 여기서 바꿀 수 없습니다. 운영자에게 요청하세요.';
const EMAIL_TAKEN_MESSAGE = '이미 사용 중인 이메일입니다 — 로그인 이메일은 모든 지점을 통틀어 한 번만 쓸 수 있습니다. 다른 이메일로 등록해 주세요.';
// 연습 화면이 막는 바깥 호출(로그인 계정 관리) — 2.0이 그 호출에 실패했을 때 서는 자리에서 이 문구로 알린다.
export const AUTH_REFUSED = {
  create: '연습 화면에서는 로그인 계정을 새로 만들지 않습니다 — 바뀐 것은 없습니다',
  password: '연습 화면에서는 로그인 비밀번호를 바꾸지 않습니다 — 바뀐 것은 없습니다',
  email: '연습 화면에서는 로그인 계정의 이메일을 바꾸지 않습니다 — 바뀐 것은 없습니다',
  role: '연습 화면에서는 로그인 계정의 역할 정보를 바꾸지 않습니다 — 역할은 그대로입니다',
  delete: '연습 화면에서는 로그인 계정을 지우지 않습니다 — 직원 기록도 그대로입니다',
};

const STATUSES = ['active', 'inactive', 'pending'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const shaped = e => ({ code: e?.code, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null });

/** FormData 모양({ $formData: [[이름, 글자] …] }) → get/has/getAll. */
function formOf(arg) {
  if (!arg || typeof arg !== 'object' || !Array.isArray(arg.$formData)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const entries = arg.$formData.filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
  return { get: k => entries.find(x => x[0] === k)?.[1] ?? null, has: k => entries.some(x => x[0] === k), getAll: k => entries.filter(x => x[0] === k).map(x => x[1]) };
}

/** 2.0 세션 클라이언트 쓰기 — 고른 사람의 신분 + authenticated 역할로 저장점 하나. 실패하면 그 저장점만 되돌리고 { error }. 끝나면 claims·역할을 되돌린다. */
async function asUserWrite(sql, u, fn) {
  try {
    return { data: await sql.savepoint(async sp => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u.id, role: 'authenticated' })}, true)`;
      await sp`set local role authenticated`;
      return fn(sp);
    }) };
  } catch (e) {
    if (e instanceof V2Error) throw e;
    return { error: shaped(e) };
  } finally {
    await sql`set local role none`;
    await sql`select set_config('request.jwt.claims', '', true)`;
  }
}
/** 관리 키 쓰기도 실패를 { error }로(2.0 supabase 응답 모양) — 트랜잭션은 살려 둔다. */
async function adminWrite(sql, fn) {
  try { return { data: await sql.savepoint(fn) }; }
  catch (e) { if (e instanceof V2Error) throw e; return { error: shaped(e) }; }
}
const authUserOf = async (sql, id) => (await sql`select id, last_sign_in_at from auth.users where id=${id}`)[0] ?? null;

async function notifyUsers(sql, items) {
  for (const i of items.filter(x => x.recipientId && x.recipientId !== x.actorId)) {
    await sql`insert into public.notifications (id, tenant_id, recipient_id, type, title, body, link, actor_id)
      values (${randomUUID()}, ${i.tenantId}, ${i.recipientId}, ${i.type}, ${i.title}, ${i.body ?? null}, ${i.link ?? null}, ${i.actorId ?? null})`;
  }
}

/** 공통 머리 — 사람 판정(2.0 getCurrentUser: 고를 수 있는 사람이 아니면 '로그인이 필요합니다'). */
async function ctxOf({ sql, body, tenantId: t, importV2 }) {
  const people = await readStaffPeople(sql, t, importV2);
  const actor = people.find(body.actor);
  return { sql, t, people, R: people.R, actor, settings: people.settings, args: body.args };
}
const A = (module, argCount, fn) => ({ validate: raw => serverCall(raw, [module], argCount), run: async ctx => { const c = await ctxOf(ctx); return fn(c); } });
const needActor = (c, msg = '로그인이 필요합니다') => (c.actor ? null : { error: msg });

/** refuseIfProtectedStaff — 보호 계정이면 시도를 감사로그에 남기고 거절 문구. */
async function refuseIfProtectedStaff(c, targetId, attempt, targetLabel) {
  const [row] = await c.sql`select 1 from public.super_admins where id=${targetId}`;
  if (!row) return null;
  await audit(c.sql, c.t, c.actor, 'staff_protected_refused', 'staff', targetLabel ?? null, { userId: targetId, attempt });
  return PROTECTED_ACCOUNT_DENIED_MSG;
}
/** isProtectedSuperAdminTarget — 대상이 운영자 계정이고 행위자는 아니면 막는다(로그인 자격 보호선). */
async function isProtectedSuperAdminTarget(c, actorId, targetId) {
  if (actorId === targetId) return false;
  const ids = new Set((await c.sql`select id::text id from public.super_admins where id = any(${[actorId, targetId]}::uuid[])`).map(r => r.id));
  return ids.has(targetId) && !ids.has(actorId);
}

// ── actions.ts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function readBaseForm(R, fd) {
  const get = k => { const v = fd.get(k); return v == null ? '' : String(v).trim(); };
  const subjectsRaw = get('subjects');
  const subjects = subjectsRaw ? subjectsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const bgRaw = get('bgColor'), bgColor = bgRaw && R.color.isHexColor(bgRaw) ? bgRaw : null;
  return {
    displayName: get('displayName'), email: get('email'), phone: get('phone') || null, hireDate: get('hireDate') || null, jobTitle: get('jobTitle') || null,
    englishName: get('englishName') || null, subjects, defaultClassroom: get('defaultClassroom') || null, memo: get('memo') || null,
    bgColor, textColor: bgColor ? R.color.readableTextColor(bgColor) : null,
    attendanceAlertOptin: get('attendanceAlertOptin') === 'on', seatLabDuty: get('seatLabDuty') === 'on', seatJjDuty: get('seatJjDuty') === 'on',
    shuttleDuty: get('shuttleDuty') === 'on', deskAttendanceOptin: get('deskAttendanceOptin') === 'on', teacherViewAccess: get('teacherViewAccess') === 'on',
    teacherViewLang: (v => (v === 'ko' || v === 'en' ? v : null))(get('teacherViewLang')),
  };
}
function validateBase(R, input) {
  const errors = {};
  if (!input.displayName) errors.displayName = '이름은 필수입니다';
  if (!input.email) errors.email = '이메일은 필수입니다';
  else if (!R.email.EMAIL_RE.test(input.email)) errors.email = '이메일 형식이 올바르지 않습니다';
  return Object.keys(errors).length > 0 ? errors : null;
}
function staffSaveError(c, error, scope) {
  const why = c.R.dbError.explainDbError(error, { scope, fallback: '직원 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  return why.field ? { error: why.message, fieldErrors: { [why.field]: why.message } } : { error: why.message };
}

async function createStaff(c) {
  const no = needActor(c); if (no) return no;
  const { R, sql, t, actor } = c, fd = formOf(c.args[1]);
  if (!c.people.canWrite(actor, 'staff')) return { error: '직원 추가 권한이 없습니다' };
  const input = readBaseForm(R, fd);
  const fieldErrors = validateBase(R, input);
  if (fieldErrors) return { fieldErrors };
  const password = String(fd.get('password') ?? '').trim();
  const newRole = String(fd.get('systemRole') ?? 'viewer');
  if (!Object.keys(R.roles.ROLE_HIERARCHY).includes(newRole)) return { error: '유효한 역할이 아닙니다' };
  if (R.roles.ROLE_HIERARCHY[actor.role] >= R.roles.ROLE_HIERARCHY[newRole]) return { error: `${newRole} 역할은 본인 권한으로 부여할 수 없습니다` };
  if (!password || password.length < 8) return { fieldErrors: { password: '임시 비밀번호는 8자 이상' } };
  const [dup] = await sql`select id from public.users where tenant_id=${t} and email ilike ${input.email} limit 1`;
  if (dup) return { fieldErrors: { email: '이미 이 이메일로 등록된 직원이 있습니다 (기존 직원을 수정하세요)' } };
  // 1) Supabase 로그인 계정 만들기(auth.admin.createUser) — 바깥 호출이라 여기서 멈춘다(2.0 'Auth 계정 생성 실패' 자리).
  return { error: AUTH_REFUSED.create };
}

async function updateStaff(c) {
  const no = needActor(c); if (no) return no;
  const { R, sql, t, actor } = c, fd = formOf(c.args[1]);
  if (!c.people.canWrite(actor, 'staff')) return { error: '직원 근무 설정 변경 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (!UUID.test(id) || !(await canSeeStaffMember(c.people, actor, id))) return UUID.test(id) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '대상 직원을 찾을 수 없습니다' };
  const input = readBaseForm(R, fd);
  const [target] = await sql`select tenant_id::text tenant_id, email, system_role::text system_role, display_name from public.users where id=${id}`;
  if (!target) return { error: '대상 직원을 찾을 수 없습니다' };
  if (target.tenant_id !== t) return { error: '다른 지점의 계정은 변경할 수 없습니다' };
  const emailChanged = fd.has('email') && input.email.toLowerCase() !== String(target.email ?? '').toLowerCase();
  const fieldErrors = validateBase(R, input) ?? {};
  if (!emailChanged) delete fieldErrors.email;
  if (!fd.has('displayName')) delete fieldErrors.displayName;
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  if (emailChanged) {
    if (!R.roles.canManageStaffMember(actor.role, target.system_role)) return { error: '본인보다 상위 권한 직원의 로그인 이메일은 변경할 수 없습니다' };
    if (await isProtectedSuperAdminTarget(c, actor.id, id)) return { error: SUPER_ADMIN_TARGET_DENIED_MSG };
    const authUser = await authUserOf(sql, id);
    const everSignedIn = !authUser || Boolean(authUser.last_sign_in_at);
    if (!R.email.canEditLoginEmail(String(target.email ?? ''), everSignedIn)) return { fieldErrors: { email: '이미 로그인한 계정의 이메일은 여기서 변경할 수 없습니다' } };
    const [dup] = await sql`select id from public.users where tenant_id=${t} and email ilike ${input.email} and id <> ${id} limit 1`;
    if (dup) return { fieldErrors: { email: '이미 이 이메일로 등록된 직원이 있습니다' } };
    if (await takenElsewhere(sql, input.email, id)) return { fieldErrors: { email: EMAIL_TAKEN_MESSAGE } };
    if (authUser) return { fieldErrors: { email: `로그인 이메일 변경 실패: ${AUTH_REFUSED.email}` } }; // auth.admin.updateUserById 자리
  }
  const staffPatch = {
    ...(fd.has('displayName') ? { display_name: input.displayName } : {}),
    ...(emailChanged ? { email: input.email } : {}),
    ...(fd.has('phone') ? { phone: input.phone } : {}),
    ...(fd.has('hireDate') ? { hire_date: input.hireDate } : {}),
    ...(fd.has('jobTitle') ? { job_title: input.jobTitle } : {}),
    english_name: input.englishName, subjects: input.subjects, default_classroom: input.defaultClassroom, memo: input.memo,
    bg_color: input.bgColor, text_color: input.textColor, attendance_alert_optin: input.attendanceAlertOptin,
  };
  const [prot] = await sql`select 1 from public.super_admins where id=${id}`;
  const canGrantTeacherView = actor.role === 'master' && !prot;
  if (canGrantTeacherView && input.teacherViewAccess && !isFullShellRole(target.system_role)) return { error: "강사·학생 역할에는 '강사뷰 접근'을 줄 수 없습니다 (관리자 계열 전용)" };
  const prev = await asUserWrite(sql, actor, async s => (await s`select teacher_view_lang, teacher_view_access from public.users where id=${id}`)[0] ?? null);
  const prevLang = fd.has('teacherViewLang') ? (prev.data ? (v => (v === 'ko' || v === 'en' ? v : null))(prev.data.teacher_view_lang) : undefined) : undefined;
  const prevTeacherView = canGrantTeacherView ? (prev.data ? prev.data.teacher_view_access === true : null) : null;
  const optional = {
    seat_lab_duty: input.seatLabDuty, seat_jj_duty: input.seatJjDuty, desk_attendance_optin: input.deskAttendanceOptin,
    ...(canGrantTeacherView && fd.has('teacherViewAccess') ? { teacher_view_access: input.teacherViewAccess } : {}),
    ...(prevLang !== undefined ? { teacher_view_lang: input.teacherViewLang } : {}),
    shuttle_duty: input.shuttleDuty,
  };
  const w = await asUserWrite(sql, actor, s => s`update public.users set ${s({ ...staffPatch, ...optional })} where id=${id}`);
  if (w.error) return staffSaveError(c, w.error, 'staff.update');
  if (canGrantTeacherView && fd.has('teacherViewAccess') && prevTeacherView !== null && prevTeacherView !== input.teacherViewAccess) {
    await audit(sql, t, actor, 'staff_teacher_view_access', 'user', target.display_name ?? null, { targetUserId: id, enabled: input.teacherViewAccess });
  }
  if (prevLang !== undefined && prevLang !== input.teacherViewLang) {
    await audit(sql, t, actor, 'staff_teacher_view_lang', 'user', target.display_name ?? null, { targetUserId: id, from: prevLang, to: input.teacherViewLang });
  }
  return { ok: true, redirectTo: '/staff', nonce: Date.now() };
}
/** isLoginEmailTakenElsewhere — 다른 지점 계정이 같은 로그인 이메일을 쓰는가(관리 키 · 대소문자 무시). */
async function takenElsewhere(sql, email, exceptUserId) {
  const want = email.trim().toLowerCase();
  if (!want || want.includes('*')) return false;
  const rows = await sql`select email from public.users where email ilike ${want.replace(/[\\%_]/g, ch => `\\${ch}`)} and id <> ${exceptUserId} limit 5`;
  return rows.some(r => (r.email ?? '').trim().toLowerCase() === want);
}

async function changeStaffRole(c) {
  const no = needActor(c); if (no) return no;
  const { R, sql, t, actor } = c, fd = formOf(c.args[1]);
  if (!c.people.canWrite(actor, 'staff')) return { error: '역할 변경 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim(), newRole = String(fd.get('newRole') ?? '');
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (!Object.keys(R.roles.ROLE_HIERARCHY).includes(newRole)) return { error: '유효한 역할이 아닙니다' };
  if (!UUID.test(id) || !(await canSeeStaffMember(c.people, actor, id))) return UUID.test(id) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '대상 직원을 찾을 수 없습니다' };
  const [target] = await sql`select tenant_id::text tenant_id, system_role::text system_role, display_name from public.users where id=${id}`;
  if (!target) return { error: '대상 직원을 찾을 수 없습니다' };
  if (target.tenant_id !== t) return { error: '다른 지점의 계정은 변경할 수 없습니다' };
  const protectedMsg = await refuseIfProtectedStaff(c, id, 'role', target.display_name);
  if (protectedMsg) return { error: protectedMsg };
  if (!R.roles.canAssignRole({ actor: actor.role, targetCurrent: target.system_role, newRole })) return { error: '이 역할 변경은 본인 권한으로 허용되지 않습니다' };
  // 2.0은 users를 바꾼 뒤 로그인 계정(auth.users app_metadata)을 맞추고, 실패하면 users를 되돌린다 — 그 동기화가 바깥 호출이라 바꾸기 전에 멈춘다(결과 = 2.0 실패와 같음).
  return { error: AUTH_REFUSED.role };
}

/** recordResignNote — 퇴사일을 계약 이력(note) 한 줄로. 같은 날짜 줄이 있으면 넘어간다. 실패해도 퇴사는 유효(best-effort). */
async function recordResignNote(c, userId, rawDate) {
  const date = rawDate.trim();
  if (!YMD.test(date)) return;
  await adminWrite(c.sql, async s => {
    const [dup] = await s`select id from public.staff_contracts where tenant_id=${c.t} and user_id=${userId} and kind='note' and start_date=${date} and terms ilike '퇴사%' limit 1`;
    if (dup) return;
    await s`insert into public.staff_contracts (tenant_id, user_id, seq, kind, start_date, terms, created_by) values (${c.t}, ${userId}, 0, 'note', ${date}, ${`퇴사 (${date})`}, ${c.actor.id})`;
  });
}
async function loadStatusTarget(c, id) {
  const [d] = await c.sql`select tenant_id::text tenant_id, system_role::text system_role, status::text status, display_name from public.users where id=${id}`;
  if (!d || d.tenant_id !== c.t) return { error: '대상 직원을 찾을 수 없습니다' };
  return { role: d.system_role, status: d.status ?? null, displayName: d.display_name ?? null };
}
/** 퇴사 뒤 남은 진행중 담임 반 수(세션 클라이언트 · head count). */
const homeroomCount = async (c, id) => (await asUserWrite(c.sql, c.actor, async s => (await s`select count(*)::int n from public.classes where tenant_id=${c.t} and teacher_id=${id} and is_active`)[0].n)).data ?? 0;

async function deactivateStaff(c) {
  const no = needActor(c); if (no) return no;
  const { R, sql, t, actor } = c, fd = formOf(c.args[1]);
  if (!c.people.canWrite(actor, 'staff')) return { error: '권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (id === actor.id) return { error: '본인 계정의 재직 상태는 바꿀 수 없습니다' };
  if (!UUID.test(id) || !(await canSeeStaffMember(c.people, actor, id))) return UUID.test(id) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '대상 직원을 찾을 수 없습니다' };
  const next = String(fd.get('next') ?? 'inactive');
  if (!STATUSES.includes(next)) return { error: '유효한 상태가 아닙니다' };
  const target = await loadStatusTarget(c, id);
  if ('error' in target) return target;
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원의 재직 상태를 바꿀 권한이 없습니다' };
  const protectedMsg = await refuseIfProtectedStaff(c, id, 'status', target.displayName);
  if (protectedMsg) return { error: protectedMsg };
  const w = await asUserWrite(sql, actor, s => s`update public.users set status=${next} where id=${id} returning id`);
  if (w.error) return { error: R.dbError.humanizeDbError(w.error.message) };
  if (!w.data.length) return { error: '직원 상태를 바꾸지 못했습니다 — 권한이 없거나 이미 삭제된 계정입니다' };
  await audit(sql, t, actor, 'staff_status_change', 'staff', target.displayName, { userId: id, from: target.status, to: next });
  // setStaffLoginBlocked(로그인 계정 막기·풀기) — 바깥 호출이라 하지 않는다(2.0도 실패를 삼키는 부수효과).
  if (next === 'inactive') await recordResignNote(c, id, String(fd.get('resignDate') ?? ''));
  let count = 0;
  if (next === 'inactive') count = await homeroomCount(c, id);
  return { ok: true, homeroomCount: count };
}

/** handover.ts moveLiveSlotTeacher — 옛 담임이 맡던 지금·앞 교시를 새 담임에게(지난 구간은 어제로 마감 행). 세션 클라이언트 쓰기. */
async function moveLiveSlotTeacher(s, R, { t, classIds, fromTeacherId, toTeacherId }) {
  if (!classIds.length) return { moved: 0 };
  const today = R.dateKst.kstToday(), yesterday = R.preserve.dayBefore(today);
  const targets = await s`select id::text id, class_id, day_of_week, start_time, end_time, valid_from::text valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group
    from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and teacher_id=${fromTeacherId} and (valid_to is null or valid_to >= ${today}::date)`;
  if (!targets.length) return { moved: 0 };
  const splittable = targets.filter(x => !x.valid_from || x.valid_from.slice(0, 10) < today);
  for (const x of splittable) {
    await s`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group)
      values (${t}, ${x.class_id}, ${x.day_of_week}, ${x.start_time}, ${x.end_time}, ${x.valid_from}, ${yesterday}, ${x.teacher_id}, ${x.classroom_id}, ${x.slot_teacher_label}, ${x.slot_room_label}, ${x.period_label}, ${x.merge_group})`;
  }
  const splitIds = splittable.map(x => x.id), rest = targets.filter(x => !splitIds.includes(x.id)).map(x => x.id);
  let moved = 0;
  if (splitIds.length) moved += (await s`update public.class_schedules set teacher_id=${toTeacherId}, valid_from=${today}::date where id = any(${splitIds}::uuid[]) returning id`).length;
  if (rest.length) moved += (await s`update public.class_schedules set teacher_id=${toTeacherId} where id = any(${rest}::uuid[]) returning id`).length;
  return { moved };
}

async function handoverAndDeactivate(c) {
  const no = needActor(c); if (no) return no;
  const { R, sql, t, actor } = c, fd = formOf(c.args[1]);
  if (!c.people.canWrite(actor, 'staff')) return { error: '권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (id === actor.id) return { error: '본인 계정의 재직 상태는 바꿀 수 없습니다' };
  if (!UUID.test(id) || !(await canSeeStaffMember(c.people, actor, id))) return UUID.test(id) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '대상 직원을 찾을 수 없습니다' };
  const target = await loadStatusTarget(c, id);
  if ('error' in target) return target;
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원의 재직 상태를 바꿀 권한이 없습니다' };
  const protectedMsg = await refuseIfProtectedStaff(c, id, 'status', target.displayName);
  if (protectedMsg) return { error: protectedMsg };
  const skip = String(fd.get('mode') ?? '') === 'skip';
  let movedClasses = 0, movedSlots = 0, newTeacherName;
  if (!skip) {
    const lvl = c.people.level(actor, 'classes');
    if (lvl !== 'full' && lvl !== 'scoped') return { error: '반 담임을 바꿀 권한이 없습니다 — ‘인계 없이 퇴사 처리’만 가능합니다' };
    const newTeacherId = String(fd.get('newTeacherId') ?? '').trim();
    if (!newTeacherId) return { error: '인계받을 강사를 선택해주세요' };
    if (newTeacherId === id) return { error: '퇴사하는 본인에게는 인계할 수 없습니다' };
    const today = R.dateKst.kstToday();
    const pre = await asUserWrite(sql, actor, async s => {
      const [nt] = UUID.test(newTeacherId) ? await s`select display_name, system_role::text system_role, status::text status from public.users where id=${newTeacherId}` : [];
      const own = await s`select id::text id from public.classes where tenant_id=${t} and teacher_id=${id} and is_active`;
      const assist = await getActiveAssistSlotClasses(s, t, id, today);
      return { nt: nt ?? null, own, assist };
    });
    if (pre.error) return { error: R.dbError.explainDbError(pre.error, { scope: 'staff.handover.read', fallback: '담당 반을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message };
    const nt = pre.data.nt;
    if (!nt || !R.perms.isAssignableTeacherRole(nt.system_role) || nt.status !== 'active') return { error: '유효한 강사가 아닙니다' };
    newTeacherName = nt.display_name ?? undefined;
    const owned = new Set(pre.data.own.map(x => x.id)), assistable = new Set(pre.data.assist.map(x => x.id));
    const selected = [...new Set(fd.getAll('classIds'))].filter(x => owned.has(x));
    const assist = [...new Set(fd.getAll('assistClassIds'))].filter(x => assistable.has(x));
    if (!selected.length && !assist.length) return { error: '인계할 반을 선택해주세요' };
    const slots = await asUserWrite(sql, actor, s => moveLiveSlotTeacher(s, R, { t, classIds: [...selected, ...assist], fromTeacherId: id, toTeacherId: newTeacherId }));
    if (slots.error) return { error: slots.error.message };
    const cls = await asUserWrite(sql, actor, async s => (selected.length ? (await s`update public.classes set teacher_id=${newTeacherId}, pending_teacher_id=null, pending_teacher_date=null, pending_teacher_reason=null
      where tenant_id=${t} and id = any(${selected}::uuid[]) and teacher_id=${id} returning id`).length : 0));
    if (cls.error) return { error: cls.error.message };
    movedClasses = cls.data; movedSlots = slots.data.moved;
    await audit(sql, t, actor, 'class_handover_bulk', 'staff', null, { userId: id, newTeacherId, classCount: movedClasses, slotCount: movedSlots, assistClassCount: assist.length });
    if (movedClasses > 0 || movedSlots > 0) {
      const what = [movedClasses > 0 ? `반 ${movedClasses}개의 새 담임` : null, assist.length > 0 ? '다른 반 교시 담당' : null].filter(Boolean).join(' · ');
      await notifyUsers(sql, [{ tenantId: t, recipientId: newTeacherId, type: 'teacher_handover', title: '담임 인수인계', body: `퇴사 처리에 따라 ${what}으로 지정되었습니다.`, link: '/classes', actorId: actor.id }]);
    }
  }
  const st = await asUserWrite(sql, actor, s => s`update public.users set status='inactive' where id=${id} returning id`);
  if (st.error) return { error: R.dbError.humanizeDbError(st.error.message) };
  if (!st.data.length) return { error: '담임은 넘겼지만 퇴사 처리는 하지 못했습니다 — 권한을 확인하세요' };
  await audit(sql, t, actor, 'staff_status_change', 'staff', target.displayName, { userId: id, from: target.status, to: 'inactive' });
  await recordResignNote(c, id, String(fd.get('resignDate') ?? ''));
  const count = await homeroomCount(c, id);
  return { ok: true, homeroomCount: count, movedClasses, movedSlots, newTeacherName };
}

// ── account-actions.ts ─────────────────────────────────────────────────────────────────────────────────────────────────
async function loadTarget(c, id, { credential } = { credential: true }) {
  if (!c.people.canWrite(c.actor, 'staff')) return { error: '직원 계정을 관리할 권한이 없습니다' };
  const [d] = UUID.test(id) ? await c.sql`select tenant_id::text tenant_id, system_role::text system_role, email, display_name from public.users where id=${id}` : [];
  if (!d) return { error: '대상 직원을 찾을 수 없습니다' };
  if (d.tenant_id !== c.t) return { error: '다른 지점의 계정은 변경할 수 없습니다' };
  if (!(await canSeeStaffMember(c.people, c.actor, id))) return { error: STAFF_SCOPE_DENIED_MSG };
  if (credential && (await isProtectedSuperAdminTarget(c, c.actor.id, id))) return { error: SUPER_ADMIN_TARGET_DENIED_MSG };
  return { role: d.system_role, email: d.email, tenantId: d.tenant_id, displayName: d.display_name ?? null };
}

async function resetStaffPassword(c) {
  const no = needActor(c); if (no) return no;
  const fd = formOf(c.args[1]), id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  const target = await loadTarget(c, id);
  if ('error' in target) return target;
  if (!c.R.roles.canManageStaffMember(c.actor.role, target.role)) return { error: '이 직원의 비밀번호를 재설정할 권한이 없습니다' };
  const mode = String(fd.get('mode') ?? 'temp');
  if (mode === 'custom' && String(fd.get('password') ?? '').trim().length < 8) return { error: '비밀번호는 8자 이상이어야 합니다' };
  // auth.admin.updateUserById(password) — 로그인 계정이 없는 직원은 2.0과 같은 안내, 있으면 바깥 호출이라 거절.
  if (!(await authUserOf(c.sql, id))) return { error: '이 직원은 로그인 계정이 없어 비밀번호를 설정할 수 없습니다. 먼저 로그인 계정을 만들어 주세요.' };
  return { error: AUTH_REFUSED.password };
}

/** applyStaffEmailChange(2.0 단일 구현) — 계정 관리 · 이력서 E-mail 두 창구. 로그인 계정이 있으면 바깥 호출이라 바꾸기 전에 거절. */
async function emailChangeCore(c, targetId, nextEmail, via) {
  if (!c.actor) return { error: '로그인이 필요합니다' };
  const { sql, t, actor, R } = c;
  const id = String(targetId ?? '').trim(), email = String(nextEmail ?? '').trim().toLowerCase();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (!R.email.EMAIL_RE.test(email)) return { error: '이메일 형식이 올바르지 않습니다' };
  const target = await loadTarget(c, id);
  if ('error' in target) return { error: target.error };
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원의 이메일을 변경할 권한이 없습니다' };
  if (target.email.toLowerCase() === email) return { ok: true, changed: false };
  const [dup] = await sql`select id from public.users where tenant_id=${t} and email ilike ${email} and id <> ${id} limit 1`;
  if (dup) return { error: '이미 사용 중인 이메일입니다' };
  if (await takenElsewhere(sql, email, id)) return { error: EMAIL_TAKEN_MESSAGE };
  // 로그인 계정이 있으면 auth.users 이메일도 바꿔야 한다(바깥 호출) — 바꾸기 전에 거절. 없는 직원(임포트분)은 2.0처럼 public만 바꾸고 끝낸다.
  if (await authUserOf(sql, id)) return { error: `로그인 계정 이메일 변경 실패 — ${AUTH_REFUSED.email}` };
  const w = await adminWrite(sql, s => s`update public.users set email=${email} where id=${id} and tenant_id=${t}`);
  if (w.error) return w.error.code === '23505' ? { error: '이미 사용 중인 이메일입니다' } : { error: R.dbError.explainDbError(w.error, { scope: 'staff.account.email', fallback: '이메일을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message };
  // 2.0 metadata.via(resume|account-card)를 door로 옮김 — via는 공통 연습 표시
  await audit(sql, t, actor, 'staff_email_change', 'staff', target.displayName ?? email, { from: target.email, to: email, door: via === 'resume' ? 'resume' : 'account-card', noAuthAccount: true });
  return { ok: true, changed: true };
}
async function changeStaffEmail(c) {
  const fd = formOf(c.args[1]);
  const r = await emailChangeCore(c, fd.get('id'), fd.get('email'), 'account-card');
  return 'error' in r ? { error: r.error } : { ok: true };
}

/** applyStaffNameChange(2.0 단일 구현 · 창구 = 이력서 성명) — 이름 + 옛 이름을 키로 쓰던 행(교재요청 소유자 · 옛 보고서 귀속 폴백) 이전. DB만(로그인 계정 무관). */
async function nameChangeCore(c, targetId, nextName, via) {
  if (!c.actor) return { error: '로그인이 필요합니다' };
  const { sql, t, actor, R } = c;
  const id = String(targetId ?? '').trim(), name = String(nextName ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (!name) return { error: '이름은 비울 수 없습니다' };
  const target = await loadTarget(c, id, { credential: false });
  if ('error' in target) return target;
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원의 이름을 변경할 권한이 없습니다' };
  const prevName = (target.displayName ?? '').trim();
  if (prevName === name) return { ok: true, changed: false };
  const [{ n }] = await sql`select count(*)::int n from public.users where tenant_id=${t} and display_name=${prevName} and id <> ${id}`;
  const ambiguous = n > 0;
  const w = await adminWrite(sql, s => s`update public.users set display_name=${name} where id=${id} and tenant_id=${t}`);
  if (w.error) return { error: R.dbError.explainDbError(w.error, { scope: 'staff.account.name', fallback: '이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message };
  let moved = 0, backfillError = null;
  if (prevName && !ambiguous) {
    const books = await adminWrite(sql, s => s`update public.textbook_orders set teacher_name=${name} where tenant_id=${t} and teacher_name=${prevName} returning id`);
    const reports = await adminWrite(sql, s => s`update public.lesson_reports set teacher_name=${name} where tenant_id=${t} and teacher_name=${prevName} and created_by is null returning id`);
    moved = (books.data?.length ?? 0) + (reports.data?.length ?? 0);
    backfillError = books.error?.message ?? reports.error?.message ?? null;
  }
  // 2.0 metadata.via(resume|account-card)를 door로 옮김 — via는 공통 연습 표시
  await audit(sql, t, actor, 'staff_name_change', 'staff', name, { from: prevName || null, to: name, door: via === 'account-card' ? 'account-card' : 'resume', movedRows: moved, ambiguous, ...(backfillError ? { backfillError } : {}) });
  return { ok: true, changed: true, ambiguous, moved, backfillError };
}

/**
 * 다른 모듈(작업자 B의 이력서 저장)이 같은 트랜잭션에서 부르는 2.0 단일 구현 — 2.0과 같은 인자·반환 모양.
 * ctx = 공통 틀 run 인자({ sql, tenantId, importV2 }) + actorId(저장하는 사람 — 직원관리 메뉴가 열린 재직 직원이어야 한다).
 */
export async function applyStaffEmailChange({ sql, tenantId, importV2, actorId }, targetId, nextEmail, via = 'account-card') {
  return emailChangeCore(await ctxOf({ sql, body: { actor: actorId, args: [] }, tenantId, importV2 }), targetId, nextEmail, via);
}
export async function applyStaffNameChange({ sql, tenantId, importV2, actorId }, targetId, nextName, via = 'resume') {
  return nameChangeCore(await ctxOf({ sql, body: { actor: actorId, args: [] }, tenantId, importV2 }), targetId, nextName, via);
}

async function deleteStaff(c) {
  const no = needActor(c); if (no) return no;
  const fd = formOf(c.args[1]), { sql, t, actor, R } = c, id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  if (id === actor.id) return { error: '본인 계정은 삭제할 수 없습니다' };
  const target = await loadTarget(c, id);
  if ('error' in target) return target;
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원을 삭제할 권한이 없습니다' };
  const protectedMsg = await refuseIfProtectedStaff(c, id, 'delete', target.displayName);
  if (protectedMsg) return { error: protectedMsg };
  const [{ n }] = await sql`select count(*)::int n from public.attendance_records where recorded_by=${id}`;
  if (n > 0) return { error: "출결 기록이 있어 완전 삭제할 수 없습니다. '퇴사(비활성)' 처리를 권장합니다." };
  // auth.admin.deleteUser — 로그인 계정이 있으면 바깥 호출이라 거절(2.0은 실패하면 public을 남긴다 = 같은 결과). 없으면 2.0처럼 건너뛰고 public 삭제.
  if (await authUserOf(sql, id)) return { error: AUTH_REFUSED.delete };
  const w = await adminWrite(sql, s => s`delete from public.users where id=${id} and tenant_id=${t}`);
  if (w.error) {
    const why = R.dbError.explainDbError(w.error, { scope: 'staff.delete.users', op: 'delete', fallback: '직원 기록을 지우지 못했습니다. 관리자에게 문의하세요.' });
    return { error: why.message };
  }
  await audit(sql, t, actor, 'staff_delete', 'staff', target.email, { role: target.role });
  return { ok: true, redirectTo: '/staff' }; // 2.0 redirect("/staff") — 호스트가 이 표식으로 목록으로 간다
}

async function updateWorkSchedule(c) {
  const no = needActor(c); if (no) return no;
  const fd = formOf(c.args[1]), { sql, t, actor, R } = c;
  if (!c.people.canWrite(actor, 'staff')) return { error: '근무 일정 편집 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '직원 ID가 누락되었습니다' };
  const target = await loadTarget(c, id, { credential: false });
  if ('error' in target) return target;
  if (!R.roles.canManageStaffMember(actor.role, target.role)) return { error: '이 직원의 근무 일정을 편집할 권한이 없습니다' };
  let parsed;
  try { parsed = JSON.parse(String(fd.get('schedule') ?? '{}')); } catch { return { error: '근무 일정 형식이 올바르지 않습니다' }; }
  const clean = R.workSchedule.sanitizeWorkSchedule(parsed), value = Object.keys(clean).length > 0 ? clean : null;
  const w = await adminWrite(sql, s => s`update public.users set work_schedule=${value === null ? null : s.json(value)} where id=${id} and tenant_id=${t}`);
  if (w.error) return { error: R.dbError.explainDbError(w.error, { scope: 'staff.account.workSchedule', fallback: '근무 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message };
  await audit(sql, t, actor, 'staff_work_schedule_update', 'staff', target.displayName ?? target.email, { userId: id, dayCount: Object.keys(clean).length });
  return { ok: true };
}

// ── contract-actions.ts ────────────────────────────────────────────────────────────────────────────────────────────────
async function contractHead(c) {
  const no = needActor(c); if (no) return no;
  if (!c.people.canWrite(c.actor, 'staff')) return { error: '계약을 변경할 권한이 없습니다' };
  return null;
}
async function extendStaffContract(c) {
  const head = await contractHead(c); if (head) return head;
  const fd = formOf(c.args[1]), { sql, t, actor, R } = c;
  const userId = String(fd.get('userId') ?? '').trim();
  if (userId && (!UUID.test(userId) || !(await canSeeStaffMember(c.people, actor, userId)))) return UUID.test(userId) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '직원을 찾을 수 없습니다' };
  const startDate = String(fd.get('startDate') ?? '').trim(), endDate = String(fd.get('endDate') ?? '').trim();
  const terms = String(fd.get('terms') ?? '').trim(), memo = String(fd.get('memo') ?? '').trim();
  if (!userId) return { error: '직원을 찾을 수 없습니다' };
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: '계약 기간을 모두 입력하세요' };
  if (endDate <= startDate) return { error: '종료일은 시작일보다 뒤여야 합니다' };
  const [target] = await sql`select id, display_name, tenant_id::text tenant_id from public.users where id=${userId}`;
  if (!target || target.tenant_id !== t) return { error: '직원을 찾을 수 없습니다' };
  const [last] = await sql`select seq from public.staff_contracts where tenant_id=${t} and user_id=${userId} and kind='contract' order by seq desc limit 1`;
  const seq = (last?.seq ?? 0) + 1;
  const w = await adminWrite(sql, s => s`insert into public.staff_contracts (tenant_id, user_id, seq, kind, start_date, end_date, terms, memo, created_by)
    values (${target.tenant_id}, ${userId}, ${seq}, 'contract', ${startDate}, ${endDate}, ${terms || null}, ${memo || null}, ${actor.id})`);
  if (w.error) return { error: R.dbError.humanizeDbError(w.error.message, '저장') };
  await audit(sql, t, actor, 'staff_contract_extend', 'user', target.display_name ?? null, { seq, startDate, endDate });
  return { ok: true, notice: `${seq}차 계약을 기입했습니다 (${startDate} ~ ${endDate})` };
}
async function updateStaffContract(c) {
  const head = await contractHead(c); if (head) return head;
  const fd = formOf(c.args[1]), { sql, t, actor, R } = c;
  const userId = String(fd.get('userId') ?? '').trim();
  if (userId && (!UUID.test(userId) || !(await canSeeStaffMember(c.people, actor, userId)))) return UUID.test(userId) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '수정할 계약을 찾을 수 없습니다' };
  const contractId = String(fd.get('contractId') ?? '').trim();
  const startDate = String(fd.get('startDate') ?? '').trim(), endDate = String(fd.get('endDate') ?? '').trim();
  const terms = String(fd.get('terms') ?? '').trim(), memo = String(fd.get('memo') ?? '').trim();
  if (!userId || !contractId) return { error: '수정할 계약을 찾을 수 없습니다' };
  const [row] = UUID.test(contractId) ? await sql`select id, kind, seq from public.staff_contracts where tenant_id=${t} and user_id=${userId} and id=${contractId}` : [];
  if (!row) return { error: '수정할 계약을 찾을 수 없습니다' };
  if (row.kind === 'contract') {
    if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: '계약 기간을 모두 입력하세요' };
    if (endDate <= startDate) return { error: '종료일은 시작일보다 뒤여야 합니다' };
  } else {
    if (startDate && !YMD.test(startDate)) return { error: '시작일 형식이 올바르지 않습니다' };
    if (endDate && !YMD.test(endDate)) return { error: '종료일 형식이 올바르지 않습니다' };
    if (startDate && endDate && endDate <= startDate) return { error: '종료일은 시작일보다 뒤여야 합니다' };
    if (!startDate && !terms) return { error: '날짜나 조건 중 하나는 있어야 합니다' };
  }
  const w = await adminWrite(sql, s => s`update public.staff_contracts set start_date=${startDate || null}, end_date=${endDate || null}, terms=${terms || null}, memo=${memo || null}
    where tenant_id=${t} and id=${contractId} returning id`);
  if (w.error) return { error: R.dbError.humanizeDbError(w.error.message, '수정') };
  if (!w.data.length) return { error: '이미 삭제된 계약입니다' };
  await audit(sql, t, actor, 'staff_contract_update', 'user', null, { contractId, kind: row.kind, seq: row.seq, startDate, endDate });
  return { ok: true, notice: '계약 내용을 수정했습니다' };
}
async function deleteStaffContract(c) {
  const head = await contractHead(c); if (head) return head;
  const fd = formOf(c.args[1]), { sql, t, actor, R } = c;
  const userId = String(fd.get('userId') ?? '').trim(), contractId = String(fd.get('contractId') ?? '').trim();
  if (!userId || !contractId) return { error: '삭제할 계약을 찾을 수 없습니다' };
  if (!UUID.test(userId) || !(await canSeeStaffMember(c.people, actor, userId))) return UUID.test(userId) ? { error: STAFF_SCOPE_DENIED_MSG } : { error: '이미 삭제된 계약입니다' };
  const [row] = UUID.test(contractId) ? await sql`select id, kind, seq from public.staff_contracts where tenant_id=${t} and user_id=${userId} and id=${contractId}` : [];
  if (!row) return { error: '이미 삭제된 계약입니다' };
  const w = await adminWrite(sql, s => s`delete from public.staff_contracts where tenant_id=${t} and id=${contractId} returning id`);
  if (w.error) return { error: R.dbError.humanizeDbError(w.error.message, '삭제') };
  if (!w.data.length) return { error: '이미 삭제된 계약입니다' };
  await audit(sql, t, actor, 'staff_contract_delete', 'user', null, { contractId, kind: row.kind, seq: row.seq });
  return { ok: true, notice: '삭제했습니다' };
}

// ── intake-token-actions.ts ────────────────────────────────────────────────────────────────────────────────────────────
function intakeGate(c) {
  if (!c.actor) return { error: '로그인이 필요합니다' };
  if (!c.people.canWrite(c.actor, 'staff')) return { error: '직원 등록 QR을 관리할 권한이 없습니다' };
  return null;
}
// 직원 등록 QR 토큰 만들기·갱신은 연습 화면에서 하지 않는다(메인 10-28) — 토큰 링크는 운영 등록 양식으로 열려, 연습 중 실제 등록이 운영 DB로
// 제출될 수 있다. 권한 문(2.0 intakeGate)은 그대로 먼저 지나고, 그 뒤 2.0 실패 모양({ error })으로 거절한다.
const INTAKE_REFUSED = '연습 화면에서는 직원 등록 QR을 만들지 않습니다';
async function ensureStaffIntakeToken(c) {
  const gate = intakeGate(c); if (gate) return gate;
  return { error: INTAKE_REFUSED };
}
async function updateStaffIntakeToken(c) {
  const gate = intakeGate(c); if (gate) return gate;
  return { error: INTAKE_REFUSED };
}

// ── list-prefs.ts ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function saveStaffListPrefs(c) {
  if (!c.actor) return { ok: false, error: '로그인이 필요합니다' };
  const { sql, t, actor, R } = c, [next, base] = c.args;
  if (!next || typeof next !== 'object' || Array.isArray(next)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const P = R.listPrefs;
  const [row] = await sql`select ui_prefs from public.users where id=${actor.id} and tenant_id=${t}`;
  const raw = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
  const stored = P.parseStaffListPrefs(raw.staff);
  const patch = base && typeof base === 'object' ? { ...next, ...P.mergeStaffView(P.pickStaffViewPrefs(stored), base, next) } : { ...next };
  const merged = P.parseStaffListPrefs({ ...stored, ...patch, rev: stored.rev + 1 });
  await sql`update public.users set ui_prefs=${sql.json({ ...raw, staff: merged })} where id=${actor.id} and tenant_id=${t}`;
  return { ok: true, view: P.pickStaffViewPrefs(merged) };
}

export const staffActions = {
  createStaff: A(M_ACTIONS, 2, createStaff),
  updateStaff: A(M_ACTIONS, 2, updateStaff),
  changeStaffRole: A(M_ACTIONS, 2, changeStaffRole),
  deactivateStaff: A(M_ACTIONS, 2, deactivateStaff),
  handoverAndDeactivate: A(M_ACTIONS, 2, handoverAndDeactivate),
  resetStaffPassword: A(M_ACCOUNT, 2, resetStaffPassword),
  changeStaffEmail: A(M_ACCOUNT, 2, changeStaffEmail),
  deleteStaff: A(M_ACCOUNT, 2, deleteStaff),
  updateWorkSchedule: A(M_ACCOUNT, 2, updateWorkSchedule),
  extendStaffContract: A(M_CONTRACT, 2, extendStaffContract),
  updateStaffContract: A(M_CONTRACT, 2, updateStaffContract),
  deleteStaffContract: A(M_CONTRACT, 2, deleteStaffContract),
  ensureStaffIntakeToken: A(M_INTAKE, 0, ensureStaffIntakeToken),
  updateStaffIntakeToken: A(M_INTAKE, 2, updateStaffIntakeToken),
  saveStaffListPrefs: A(M_PREFS, 2, saveStaffListPrefs),
};
