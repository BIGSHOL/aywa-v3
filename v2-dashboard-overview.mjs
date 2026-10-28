// 2.0 운영실(대시보드) 스냅샷 — 2.0 `loadOverview`(src/features/dashboard/overview/server.ts)가 돌려주는 모양 그대로를 로컬 Docker 복사본에서.
// v2-host 운영실 화면(v2-host/src/dashboard.tsx)이 2.0 `<Overview initial={…}>`에 그대로 넘긴다(V2-SCREENS.md '그리는 방식 전환').
// · 보는 사람 = 복사본 지점의 원장 계정 하나(로그인이 없다 — 주소 `viewer`로 고르거나, 없으면 최근 30일 활동이 가장 많은 원장).
//   권한·배치·차트 설정이 그 사람의 것이다(2.0과 같다). 원장(master)만 받는다 — 과목 관리자 배치(과목별 값)는 옮기지 않았다.
//   고른 id가 원장이 아니거나 플랫폼 운영 계정이면 기본 원장으로 그린다(3.0 쪽 고르기 칸과 화면이 어긋나지 않게).
// · 차례 = 2.0 loadOverview: 권한표(getUserPermMatrix) → 메뉴(allowed) → 배치(resolveView) → 조회 계획(loadPlan) → 영역마다 조회 →
//   ClassNote 꺼짐이면 unread 제외 → 값 정리(shapeSections). 판정은 2.0 순수 함수(importV2), 조회는 같은 표·같은 조건의 SQL(지점 조건 `tenant_id`).
// · 영역마다 저장점 하나 — 2.0은 영역마다 따로 조회해 하나가 실패해도 그 카드만 '조회 실패'다. 복사본은 한 트랜잭션이라 저장점으로 가둔다.
// · '지금' = 복사본을 뜬 순간(2.0 `kstToday()`·`Date.now()` 자리). 카드의 '확인' 시각도 그 순간이다.
// · 2.0 영역 33개를 모두 옮겼다(AREAS). 배치에 없는 카드의 영역은 2.0처럼 조회하지 않는다 — 2.0 Panel은 영역 값이 없으면 카드를 그리지 않는다.
// · `full` = 2.0 loadOverview({ full: true })(학원 설정 '대시보드 관리' 미리보기 원본) — 배치를 안 걸고 메뉴 권한이 허락하는 영역을 모두 읽고 값 정리를 하지 않는다.
// · 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate, rules as rosterRules, resolveSettings, copyClock, userPermMatrix, HOST_LICENSES } from './v2-onescreen-roster.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';
import { STUDENT_AREAS } from './v2-dashboard-students.mjs';
import { TREND_AREAS } from './v2-dashboard-trends.mjs';
import { BILLING_AREAS } from './v2-dashboard-billing.mjs';
import { ADMISSIONS_AREAS } from './v2-dashboard-admissions.mjs';
import { ATTENDANCE_AREAS } from './v2-dashboard-attendance.mjs';

const MODULES = { view: 'features/dashboard/layout/view.ts', shape: 'features/dashboard/layout/shape.ts', assign: 'features/dashboard/layout/assignment.ts',
  chart: 'features/dashboard/overview/chart-prefs.ts', norm: 'features/dashboard/layout/normalize.ts', registry: 'features/dashboard/layout/registry.ts', types: 'features/dashboard/layout/types.ts' };
let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 영역 키(2.0 `Area`) → (ctx, sp) => 그 영역 값. */
const AREAS = { ...STUDENT_AREAS, ...TREND_AREAS, ...BILLING_AREAS, ...ADMISSIONS_AREAS, ...ATTENDANCE_AREAS };

/** 2.0 getTenantSettings — 설정 행을 못 읽으면 침산 기본값 + 지점 이름(v2-student-kpis.mjs와 같은 식). */
async function tenantSettings(sql, t, RR) {
  const [row, name] = await Promise.all([
    sql.soft(async (sp) => ({ data: (await sp`select data from public.tenant_settings where tenant_id=${t}`)[0]?.data ?? null }), { failed: true }),
    sql.soft(async (sp) => (await sp`select name from public.tenants where id=${t}`)[0]?.name ?? '', '')]);
  return resolveSettings(RR, row.failed ? {} : row.data, name);
}

/**
 * 보는 사람 — 재직 중인 원장(master) 가운데 `viewerId`, 없거나 맞지 않으면 복사본을 뜨기 전 30일 동안 감사로그 활동이 가장 많은 사람(같으면 이름 순).
 * 플랫폼 운영 계정(super_admins)은 고르지 않는다(2.0 지점 화면에서 그 계정은 관리자로 보인다 — 원장 첫 화면의 주인이 아니다).
 */
async function pickViewer(sql, t, viewerId, at) {
  const rows = await sql`select u.id::text id, u.display_name name, u.system_role::text role, u.subjects, u.ui_prefs,
      exists(select 1 from public.super_admins sa where sa.id = u.id) super,
      (select count(*)::int from public.audit_logs a where a.tenant_id=${t} and a.actor_id = u.id and a.created_at > ${new Date(at.getTime() - 30 * 86400000)} and a.created_at <= ${at}) recent
    from public.users u where u.tenant_id=${t} and u.status::text = 'active' and u.system_role::text = 'master' order by u.display_name, u.id`;
  const owners = rows.filter((r) => !r.super);
  return owners.find((r) => r.id === viewerId) ?? [...owners].sort((a, b) => b.recent - a.recent)[0] ?? null;
}

/** 2.0 OverviewSnapshot + 첫 그림의 막대/꺾은선(`loadDashboardChartKinds` — 보는 사람의 ui_prefs.dashboard). */
export async function loadOverviewSnapshot({ sql: tx, tenantId: t = COPY_TENANT, importV2, viewerId = null, full = false }) {
  const sql = queryGate(tx);
  const load = importV2 ?? (await import('./v2-bridge.mjs')).importV2;
  const [R, RR, clock] = await Promise.all([rules(load), rosterRules(load), copyClock()]);
  // 2.0 resolve.ts는 대시보드 설정을 normalizeDashboard로 다듬어 싣는다(판 번호가 다르거나 머리줄뿐인 배치 → 기본 배치).
  const raw = await tenantSettings(sql, t, RR), settings = { ...raw, dashboard: R.norm.normalizeDashboard(raw.dashboard) };
  const user = await pickViewer(sql, t, viewerId, clock.at);
  if (!user) return null;
  const matrix = await userPermMatrix(sql, RR, settings, { id: user.id, system_role: user.role }, t, clock.at);
  const allowed = RR.MENU_KEYS.filter((key) => RR.canAccess(user.role, key, matrix));
  const today = clock.day, at = clock.at.getTime();
  // 2.0 loadViewerBundle — 원장은 담당 과목을 읽지 않는다(관리자만) · 배정 기록이 있으면 그 기록.
  const assigned = R.assign.dashboardAssignmentOf({ id: user.id, systemRole: user.role, isSuperAdmin: user.super, subjects: [] },
    settings.dashboard.assignments?.find((a) => a.userId === user.id));
  if (assigned.bundle === 'subject') throw new Error('과목 관리자 배치는 아직 옮기지 않았습니다');
  const subjectLabels = RR.subjectLabelRecord(settings.operations.subjects);
  const view = R.view.resolveView({ stored: full ? R.types.EMPTY_DASHBOARD : settings.dashboard, bundle: assigned.bundle,
    subjectScoped: assigned.subjectScoped, menus: new Set(allowed), subjectLabels: [] });
  const needed = R.view.loadPlan(view, new Set(allowed));
  if (full) for (const area of Object.keys(R.registry.AREA_MENUS)) if (R.registry.AREA_MENUS[area].every((m) => allowed.includes(m))) needed.add(area);

  // 영역마다 저장점 하나(2.0 `add` — 실패한 영역만 비고, 그 실패는 다른 영역을 깨지 않는다). 영역끼리 같은 재료는 ctx.memo로 한 번만 읽는다.
  const ctx = { t, today, clock, settings, allowed, user, importV2: load, RR, memo: new Map() };
  const sections = {};
  for (const [area, fn] of Object.entries(AREAS)) {
    if (!needed.has(area)) continue; // 배치에 없는 카드의 영역(또는 메뉴 권한 밖) — 조회하지 않는다
    sections[area] = await sql.soft(async (sp) => ({ data: await fn(ctx, sp), at, error: false }), (error) => {
      console.error(`[v2 운영실/${area}]`, error?.message ?? error);
      return { data: null, at: null, error: true };
    });
  }
  if (!RR.isModuleEnabled(settings.modules.disabled, 'classnote')) delete sections.unread; // ClassNote 꺼짐 = 카드 없음
  const shaped = full ? sections : R.shape.shapeSections({ ...sections }, view, { groups: [], groupOf: () => null, slices: {} });
  // 2.0 (shell)/layout.tsx가 창(embed) 화면을 `<OperationsProvider>`로 감쌀 때 넘기는 값 — 라이선스는 행이 있는 것만(없으면 '허용').
  const licenseRows = await sql.soft((sp) => sp`select feature, is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses
    where tenant_id=${t} and feature = any(${HOST_LICENSES})`, []);
  const host = { operations: { subjects: settings.operations.subjects, gradeLevels: settings.operations.gradeLevels, jobTitles: settings.operations.jobTitles,
    jobTitlesByDepartment: settings.operations.jobTitlesByDepartment }, disabledModules: settings.modules.disabled,
    licenses: Object.fromEntries(licenseRows.map((r) => [r.feature, RR.licenseAllows({ is_active: r.is_active, expires_at: r.expires_at }, clock.at)])) };
  return {
    initial: {
      scope: `${t}:${user.id}:${user.role}:all:${view.rev}${full ? ':full' : ''}`,
      tenantId: t,
      academy: settings.profile.name,
      today,
      requestedAt: Date.now(),
      allowed,
      subjects: subjectLabels,
      ...(RR.isModuleEnabled(settings.modules.disabled, 'eie') ? {} : { eie: false }),
      view,
      sections: { ...shaped },
    },
    chartKinds: R.chart.parseChartKinds(user.ui_prefs?.dashboard),
    viewer: { id: user.id, name: user.name },
    host,
  };
}
