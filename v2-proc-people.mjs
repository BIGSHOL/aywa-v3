// 처리 화면(R — 퇴원보고서 · 전자결재 · 영상 제출 현황 · 퇴원관리) 공용: 3.0엔 로그인이 없어 '보는·저장하는 사람'을 3.0 띠에서 고른다.
// 고를 수 있는 사람 = 그 메뉴를 열 수 있는 재직 직원(2.0 권한 표 = 역할 기본 + 학원 설정 덮어쓰기 + 개인 예외 · 운영자 계정 제외 —
// 시간표 저장의 readPeople과 같은 계산). 처리 화면은 '누가 보느냐'로 화면 자체가 달라진다(내 차례 결재 · 담임이 쓸 보고서 …) —
// 그래서 고른 사람은 저장(actor)뿐 아니라 조회(GET ?actor=)에도 쓴다. 고른 값이 없거나 목록 밖이면 첫 사람(원장 먼저).
// 감사로그 = 2.0 logAction과 같은 칸 + metadata.via '3.0 연습 복사본'(공통 규약).
import { V2Error } from './v2-screens.mjs';

export const VIA = '3.0 연습 복사본';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const RANK = ['master', 'admin', 'manager', 'teacher'];

let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [perms, roles, preset, subjects, scope, statusPerm, statusAccess, dbError] = await Promise.all([
      'lib/permissions.ts', 'lib/auth/role-hierarchy.ts', 'features/owner/preset.ts', 'features/owner/subjects.ts',
      'features/staff/department/subject-scope.ts', 'features/owner/student-status-permissions.ts', 'features/students/status-access.ts',
      'lib/supabase/db-error.ts',
    ].map(p => importV2(p)));
    return { perms, ROLE_LABEL: roles.ROLE_LABEL, preset, subjects, scope, statusPerm, statusAccess, dbError };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}
export { loadRules as loadPeopleRules };

/** 같은 깊이 병합 — 2.0 resolveSettings의 객체 병합(배열·원시는 교체). */
export function deepMerge(base, stored) {
  if (!plain(base) || !plain(stored)) return stored === undefined ? base : stored;
  const out = { ...base };
  for (const [k, v] of Object.entries(stored)) out[k] = plain(base[k]) && plain(v) ? deepMerge(base[k], v) : v;
  return out;
}

/** 학원 설정(저장 원문 + 기본값) — operations·permissions·modules 칸. */
export async function readSettings(sql, t, P) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const stored = plain(row?.data) ? row.data : null, base = P.preset.baseSettingsFor(P.preset.presetOfStored(stored));
  return { stored, base, operations: deepMerge(base.operations, stored?.operations), permissions: deepMerge(base.permissions, stored?.permissions) };
}

/**
 * 사람 목록과 판정 — people.level(u, menu) = 2.0 accessLevel(역할, 메뉴, 지점 매트릭스 + 개인 예외).
 * menu를 열 수 있는('none'이 아닌) 사람만 editors(고를 수 있는 사람)에 든다.
 */
export async function readPeople(sql, t, importV2, menu) {
  const P = await loadRules(importV2);
  const [users, supers, settings] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role, subjects from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`,
    readSettings(sql, t, P),
  ]);
  const storedPermissions = plain(settings.stored?.permissions) ? settings.stored.permissions : {};
  const permissions = { ...settings.base.permissions, ...storedPermissions };
  const matrix = P.perms.resolveMatrix(Array.isArray(permissions.overrides) ? permissions.overrides : []);
  const userOverrides = Array.isArray(permissions.userOverrides) ? permissions.userOverrides : [];
  const operators = new Set(supers.map(s => s.id));
  const level = (u, m) => P.perms.accessLevel(u.role, m, P.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides));
  const managerIds = P.statusPerm.studentStatusManagerIds(storedPermissions?.specialAccess);
  const staff = users.filter(u => !operators.has(u.id));
  const editors = staff.filter(u => level(u, menu) !== 'none')
    .map(u => ({ ...u, label: P.ROLE_LABEL[u.role] ?? '', rank: RANK.includes(u.role) ? RANK.indexOf(u.role) : RANK.length }))
    .sort((a, b) => a.rank - b.rank || a.display_name.localeCompare(b.display_name, 'ko'));
  return {
    P, settings, level, operators, users,
    editors,
    /** 3.0 띠에 보내는 모양 { id, name, role(라벨) }. */
    editorList: editors.map(e => ({ id: e.id, name: e.display_name, role: e.label })),
    /** 고른 사람(없거나 목록 밖이면 첫 사람). */
    pick: id => editors.find(e => e.id === id) ?? editors[0] ?? null,
    /** 2.0 canManageStudentStatusNow — 원생 쓰기 '전체' + 원생 상태 변경 담당. */
    canManageStatus: u => level(u, 'students') === 'full' && P.statusAccess.canManageStudentStatus({ id: u.id, systemRole: u.role }, false, managerIds),
    /** 2.0 getViewerStaffScope — 원장 역할엔 범위 없음. */
    staffScope: u => (u.role === 'master' ? null : P.scope.staffSubjectScopeOf(u.id, settings.permissions?.specialAccess?.staffSubjectScopes)),
  };
}

/** 저장 요청의 사람 — 목록에 없는 사람이면 거절(2.0의 '권한 없음'과 같은 자리). */
export function requireActor(people, actorId) {
  const actor = typeof actorId === 'string' ? people.editors.find(e => e.id === actorId) : null;
  if (!actor) throw new V2Error(403, 'actor_required', '저장하는 사람을 골라 주세요.');
  return actor;
}

export const audit = (sql, t, actor, action, targetType, targetLabel, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.display_name}, ${action}, ${targetType}, ${targetLabel ?? null}, ${sql.json({ ...(metadata ?? {}), via: VIA })})`;

/** 2.0 서버 함수 호출 본문 { module, actor, args } — module은 그 화면이 받는 2.0 파일이어야 한다. */
export function serverCall(raw, modules, argCount) {
  if (!plain(raw) || !modules.includes(raw.module) || !Array.isArray(raw.args) || raw.args.length > argCount) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  if (raw.actor !== null && raw.actor !== undefined && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  return { actor: raw.actor ?? null, args: raw.args };
}

/**
 * DB 함수 호출을 savepoint 안에서 — 2.0은 RPC 오류를 { error } 모양으로 돌려준다(throw 아님). 실패해도 트랜잭션을 살려 둬야
 * 그 모양을 돌려줄 수 있다. 오류 문구는 2.0 describeDbError 그대로.
 */
export async function rpcSoft(sql, P, fn, fallback) {
  try { return { data: await sql.savepoint(fn) }; }
  catch (error) {
    if (error instanceof V2Error) throw error;
    const shaped = { code: error?.code, message: error?.message ?? '', details: error?.detail ?? null, hint: error?.hint ?? null };
    return { error: shaped, message: P.dbError.describeDbError(shaped, { fallback }).message };
  }
}

/** 행 하나를 PostgREST와 같은 JSON으로(timestamptz = ISO+오프셋 · date = 'YYYY-MM-DD' · uuid = 글자). */
export const asJson = rows => rows.map(r => r.j);
