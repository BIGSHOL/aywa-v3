// 2.0 화면 — 강사 시트 · 수학(MCS) 공용: 규칙(2.0 순수 함수) · 학원 설정 · 보는 사람 · 담당 범위 · 반 게이트.
// 3.0엔 로그인이 없다 — MCS는 사람마다 화면이 다르다(강사는 담당 반만, 2.0 effectiveTeacherScope). 그래서 '보는 사람'을 고르고
// (ECS 화면과 같은 방식 · 운영자 계정 제외 · 원장 먼저), 그 사람의 역할·권한 표로 2.0과 같은 범위를 낸다. 저장하는 사람도 같은 사람이다.
// 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { deepMerge, normalizeSubjects } from './v2-screen-timetable.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = v => typeof v === 'object' && v !== null && !Array.isArray(v);

let rulesPromise = null;
export function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [classDays, roster, cell, tracks, calendar, holiday, special, dk, preview, plans, bookWindow, match, school, eligibility, week, perms, preset, modules, roles] = await Promise.all([
      'features/math-sheets/lib/class-days.ts', 'features/math-sheets/lib/roster.ts', 'features/math-sheets/lib/cell-state.ts', 'features/math-sheets/landing-tracks.ts',
      'features/attendance/calendar.ts', 'features/class-sheets/lib/holiday.ts', 'features/classes/special-lecture.ts', 'lib/date-kst.ts', 'features/math-progress-map/access.ts',
      'features/textbooks/book-plans.ts', 'features/textbooks/book-window.ts', 'features/textbooks/math-book-match.ts', 'features/schools/school-name.ts',
      'features/enrollments/eligibility.ts', 'features/timetable/lib/week.ts', 'lib/permissions.ts', 'features/owner/preset.ts', 'lib/modules.ts', 'lib/auth/role-hierarchy.ts',
    ].map(p => importV2(p)));
    return { classDays, roster, cell, tracks, calendar, holiday, special, dk, preview, plans, bookWindow, match, school, eligibility, week, perms, preset, modules, ROLE_LABEL: roles.ROLE_LABEL };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** 학원 설정 — 2.0 getTenantSettings → resolveSettings의 운영(휴일 포함)·모듈·권한 칸. */
export async function readSettings(sql, t, R) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const stored = row?.data ?? null, base = R.preset.baseSettingsFor(R.preset.presetOfStored(stored));
  const ops = deepMerge(base.operations, plain(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, plain(stored) ? stored.modules : undefined);
  const operations = { ...ops, subjects: normalizeSubjects(ops.subjects, base) };
  const permissions = { ...base.permissions, ...(plain(stored?.permissions) ? stored.permissions : {}) };
  return { operations, disabled: R.modules.normalizeDisabledModules(mods.disabled), permissions, holidays: R.calendar.buildHolidayMap(operations.holidays) };
}

const RANK = ['master', 'admin', 'manager'];
/** 볼 수 있는 사람 — MCS 권한이 '없음'이 아닌 재직 직원(2.0 requireAccess("mcs")와 같은 권한 표 · 역할 재정의 + 개인 예외). 운영자 계정은 뺀다. */
export async function readViewers(sql, t, R, env) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id));
  const matrix = R.perms.resolveMatrix(Array.isArray(env.permissions.overrides) ? env.permissions.overrides : []);
  const userOverrides = Array.isArray(env.permissions.userOverrides) ? env.permissions.userOverrides : [];
  return users.filter(u => !operators.has(u.id)).map(u => {
    const level = R.perms.accessLevel(u.role, 'mcs', R.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides));
    return { id: u.id, name: u.display_name, systemRole: u.role, roleLabel: R.ROLE_LABEL[u.role] ?? '', level };
  }).filter(u => u.level !== 'none')
    .sort((a, b) => (RANK.includes(a.systemRole) ? RANK.indexOf(a.systemRole) : RANK.length) - (RANK.includes(b.systemRole) ? RANK.indexOf(b.systemRole) : RANK.length) || a.name.localeCompare(b.name, 'ko'));
}
export const editorsOf = viewers => viewers.map(v => ({ id: v.id, name: v.name, role: v.roleLabel }));

/** 2.0 getDelegatedClassIdsInRange — 되돌리지 않은 임시 위임 중 [from, to]와 겹치는 반. */
async function delegatedClassIdsInRange(sql, t, teacherId, from, to) {
  const rows = await sql`select distinct class_id::text id from public.class_delegations where tenant_id=${t} and delegate_user_id=${teacherId} and revoked_at is null
    and from_date <= ${to}::date and to_date >= ${from}::date`;
  return rows.map(r => r.id);
}
/** 2.0 getTeacherReadScope — 담임 반 ∪ 이번 주에 실제로 도는 교시 담당 반 ∪ 이번 주에 걸친 위임 반(classes에 있는 것만). */
async function teacherReadScope(sql, t, R, teacherId, today) {
  const monday = R.week.mondayOf(today);
  const [own, slots, delegated] = await Promise.all([
    sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${teacherId}`,
    sql`select class_id::text class_id, day_of_week::text day_of_week, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules where tenant_id=${t} and teacher_id=${teacherId}`,
    delegatedClassIdsInRange(sql, t, teacherId, monday, R.week.shiftDays(monday, 6)),
  ]);
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const live = slots.filter(s => { const i = DAYS.indexOf(s.day_of_week); if (i < 0) return false; const d = R.week.shiftDays(monday, i);
    return (!s.valid_from || s.valid_from <= d) && (!s.valid_to || s.valid_to >= d); }).map(s => s.class_id);
  const ids = [...new Set([...own.map(c => c.id), ...live, ...delegated])];
  if (!ids.length) return [];
  return (await sql`select id::text id from public.classes where tenant_id=${t} and id = any(${ids}::uuid[])`).map(c => c.id);
}
/** 2.0 mcsVisibleClassFilter — 선생님 역할이면 읽기 범위 ∪ 오늘 ±7일 위임 반, 아니면 null(전체). */
export async function visibleClassFilter(sql, t, R, viewer, today) {
  if (viewer.systemRole !== 'teacher') return null;
  const [scope, delegated] = await Promise.all([teacherReadScope(sql, t, R, viewer.id, today),
    delegatedClassIdsInRange(sql, t, viewer.id, R.dk.addDays(today, -7), R.dk.addDays(today, 7))]);
  const allow = new Set([...scope, ...delegated]);
  return classId => allow.has(classId);
}
