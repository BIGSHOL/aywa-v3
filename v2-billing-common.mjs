// 2.0 화면 — 수납관리 공용: 규칙(2.0 순수 함수) · 학원 설정 · 보는 사람(수납 · 강사 정산 권한) · 동기화 시각.
// 3.0엔 로그인이 없다 — 2.0 수납관리는 사람마다 다르다(수납 권한 = 면 전체 · 급여 열람 = 강사 정산 면 · 쓰기/엑셀 넣기 = 수준).
// 그래서 '보는 사람'을 고르고(교재목록·MCS와 같은 방식 · 운영자 계정 제외 · 원장 먼저), 그 사람의 권한 표로 2.0과 같은 게이트를 낸다.
// 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { loadRules as loadMcsRules, readSettings } from './v2-mcs-core.mjs';

export { readSettings };

let rulesPromise = null;
/** 수납 화면이 쓰는 2.0 순수 함수(서버 전용이 아닌 모듈만) + MCS 공용 규칙(권한 표 · 역할 이름 · 모듈 · 날짜). */
export function loadBillingRules(importV2) {
  rulesPromise ??= (async () => {
    const [R, calc, lineItems] = await Promise.all([
      loadMcsRules(importV2),
      ...['features/billing/calc.ts', 'features/billing/invoice-line-items.ts'].map(p => importV2(p)),
    ]);
    return { ...R, calc, lineItems };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const RANK = ['master', 'admin', 'manager'];
/**
 * 볼 수 있는 사람 — 2.0 page.tsx `requireAccess(tab === "payroll" ? "payroll_settings" : "billing")`를 지나는 재직 직원
 * (수납 또는 강사 정산 권한이 '없음'이 아닌 사람 · 역할 재정의 + 개인 예외 + 꺼진 기능 캡). 운영자 계정은 뺀다. 수준은 메뉴마다 따로 싣는다.
 */
export async function readBillingViewers(sql, t, R, env) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id));
  const matrix = R.perms.resolveMatrix(Array.isArray(env.permissions.overrides) ? env.permissions.overrides : []);
  const userOverrides = Array.isArray(env.permissions.userOverrides) ? env.permissions.userOverrides : [];
  return users.filter(u => !operators.has(u.id)).map(u => {
    // 2.0 getUserPermMatrix 순서: 역할 재정의 → 개인 예외 → 꺼진 기능(모듈) 캡(급여 기능이 꺼진 학원은 강사 정산 '없음').
    const m = R.modules.capDisabledModules(R.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides), env.disabled), level = menu => R.perms.accessLevel(u.role, menu, m);
    return { id: u.id, name: u.display_name, systemRole: u.role, roleLabel: R.ROLE_LABEL[u.role] ?? '',
      billing: level('billing'), payroll: level('payroll_settings'), owner: level('owner') };
  }).filter(u => u.billing !== 'none' || u.payroll !== 'none')
    .sort((a, b) => (RANK.includes(a.systemRole) ? RANK.indexOf(a.systemRole) : RANK.length) - (RANK.includes(b.systemRole) ? RANK.indexOf(b.systemRole) : RANK.length) || a.name.localeCompare(b.name, 'ko'));
}
export const billingEditorsOf = viewers => viewers.map(v => ({ id: v.id, name: v.name, role: v.roleLabel }));

/** 2.0 getMakeeduSyncState(domain) — makeedu 모듈이 꺼진 학원은 null · 행이 없으면 null. */
export async function readSyncState(sql, t, R, env, domain) {
  if (!R.modules.isModuleEnabled(env.disabled, 'makeedu')) return null;
  const [row] = await sql`select to_json(synced_at)#>>'{}' synced_at, row_count, status, error from public.makeedu_sync_state where tenant_id=${t} and domain=${domain}`;
  if (!row) return null;
  return { syncedAt: row.synced_at, rowCount: row.row_count == null ? null : Number(row.row_count), status: row.status, issue: (row.error ?? null) || null };
}

/** 2.0 page.tsx resolveTab — 모르는 값은 수납. */
const TABS = new Set(['textbooks', 'expenses', 'calculator', 'refunds', 'sessions', 'verify', 'payroll']);
export const resolveBillingTab = tab => (TABS.has(tab) ? tab : 'billing');
