// 2.0 화면 — 수납관리 공용: 규칙(2.0 순수 함수) · 학원 설정 · 보는 사람(수납 · 강사 정산 권한) · 동기화 시각.
// 3.0엔 로그인이 없다 — 2.0 수납관리는 사람마다 다르다(수납 권한 = 면 전체 · 급여 열람 = 강사 정산 면 · 쓰기/엑셀 넣기 = 수준).
// 그래서 '보는 사람'을 고르고(교재목록·MCS와 같은 방식 · 운영자 계정 제외 · 원장 먼저), 그 사람의 권한 표로 2.0과 같은 게이트를 낸다.
// 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { loadRules as loadMcsRules, readSettings, UUID } from './v2-mcs-core.mjs';
import { V2Error } from './v2-screens.mjs';
import { deepMerge } from './v2-screen-timetable.mjs';

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
      billing: level('billing'), payroll: level('payroll_settings'), owner: level('owner'),
      // 지출결의서 쓰기 범위(2.0 expenseWriteScope) — 수납 쓰기 = 전건, 아니면 지출결의서 쓰기 = 본인 것만.
      expenseRequests: level('expense_requests') };
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

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
/** 학원 설정의 이름·로고(profile)·입금 계좌(billing) — 2.0 getTenantSettings(resolveSettings)와 같은 병합(이름이 비면 지점 이름).
 *  🔴 계좌는 2.0이 수납 권한 화면(교재 요청서 미리보기)에 그대로 내는 학원 입금 계좌다 — 시험·로그에 찍지 않는다. */
export async function readBranding(sql, t, R) {
  const [[row], [tenant]] = await Promise.all([sql`select data from public.tenant_settings where tenant_id=${t}`, sql`select name from public.tenants where id=${t}`]);
  const stored = row?.data ?? null, base = R.preset.baseSettingsFor(R.preset.presetOfStored(stored));
  const profile = deepMerge(base.profile, plain(stored) ? stored.profile : undefined), billing = deepMerge(base.billing, plain(stored) ? stored.billing : undefined);
  return { profile: { ...profile, name: profile.name || tenant?.name || '' }, billing };
}

// ── 저장 도구 ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const VIA = '3.0 연습 복사본';
export const UUID_RE = UUID;
export const badRequest = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/** 2.0 logAction — 감사로그(actor = 보는 사람 · metadata.via = 연습 복사본). */
export const audit = (sql, t, actor, action, targetType, metadata, targetLabel = null) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, ${targetType ?? null}, ${targetLabel ?? null}, ${sql.json({ ...(metadata ?? {}), via: VIA })})`;
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → get · getAll(2.0 FormData와 같은 읽기). */
export function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 500) throw badRequest();
  const pairs = v.$formData.map(p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 100 || p[1].length > 5000) throw badRequest(); return p; });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null, getAll: k => pairs.filter(p => p[0] === k).map(p => p[1]) };
}
/**
 * 2.0 사용자 클라이언트 = 그 사람의 신분(JWT claims) + authenticated 역할 — RLS·보호 트리거가 2.0처럼 본다.
 * 실패하면 저장점째 되돌아가고 supabase 오류 모양({ code, message, details, hint })으로 돌려준다.
 * set_config(…, true)는 저장점을 '풀어도' 트랜잭션 끝까지 남는다 — 끝나면 원래 신분으로 되돌린다(교재 요청 화면의 같은 함정).
 */
export async function asViewer(sql, actor, fn) {
  try {
    return { data: await sql.savepoint(async s => {
      const [{ prev }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev`;
      await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
      await s`set local role authenticated`;
      const out = await fn(s);
      await s`reset role`;
      await s`select set_config('request.jwt.claims', ${prev}, true)`;
      return out;
    }), error: null };
  } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null, constraint: e?.constraint_name ?? null } }; }
}
/**
 * 2.0 서버 액션 하나 = actions 한 줄. raw = 호스트 shim 본문 { module, actor, args } — module · 인자 수가 2.0과 같아야 받는다.
 * run(ctx, actor, args) — actor = 고른 사람(수납관리를 볼 수 있는 직원이 아니면 null → 2.0 '로그인이 필요합니다' 자리).
 */
export function billingAction(module, arity, run, check = () => {}) {
  return {
    validate: raw => {
      if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length !== arity || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw badRequest();
      check(raw.args);
      return { actor: raw.actor ?? null, args: raw.args };
    },
    run: async ({ sql, body, tenantId: t, importV2 }) => {
      const R = await loadBillingRules(importV2), env = await readSettings(sql, t, R), viewers = await readBillingViewers(sql, t, R, env);
      return run({ sql, t, R, env, importV2 }, viewers.find(v => v.id === body.actor) ?? null, body.args);
    },
  };
}
export const canWriteBilling = actor => !!actor && (actor.billing === 'full' || actor.billing === 'scoped');

/** 2.0 page.tsx resolveTab — 모르는 값은 수납. */
const TABS = new Set(['textbooks', 'expenses', 'calculator', 'refunds', 'sessions', 'verify', 'payroll']);
export const resolveBillingTab = tab => (TABS.has(tab) ? tab : 'billing');
