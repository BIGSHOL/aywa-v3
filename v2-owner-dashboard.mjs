// 학원 설정 대시보드 배치 면: 2.0 편집기에 필요한 원장 미리보기·직원·역할 메뉴.
import { loadOverviewSnapshot } from './v2-dashboard-overview.mjs';

let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all([
    'features/dashboard/layout/members.ts',
    'features/dashboard/layout/role-menus.ts',
    'features/dashboard/layout/preview.ts',
  ].map(p => importV2(p))).then(([members, menus, preview]) => ({ members, menus, preview }))
    .catch(e => { rulesP = null; throw e; });
  return rulesP;
}

export async function loadOwnerDashboard({ sql, tenantId, importV2, viewerId, settings }) {
  const R = await rules(importV2);
  let members;
  try {
    const rows = await sql`select id::text id, display_name, system_role::text system_role, subjects, status::text status
      from public.users where tenant_id=${tenantId} and status::text='active' and system_role::text <> 'student' order by id`;
    const superIds = new Set((await sql`select id::text id from public.super_admins where id = any(${rows.map(r => r.id)}::uuid[])`).map(r => r.id));
    members = { people: R.members.dashboardMembers(rows, superIds, settings).filter(p => p.bundle !== 'super'), failed: false };
  } catch { members = { people: [], failed: true }; }
  return {
    viewerId,
    initial: settings.dashboard,
    roleMenus: R.menus.bundleMenus(settings),
    subjects: R.preview.subjectChoices(Object.fromEntries(settings.operations.subjects.map(s => [s.key, s.label]))),
    members,
  };
}

/** 원본 DashboardFace의 미리보기 Promise — 편집기 본문과 별도 GET에서 읽는다. */
export async function loadOwnerDashboardPreview({ sql, tenantId, importV2, viewerId }) {
  try { return (await loadOverviewSnapshot({ sql, tenantId, importV2, viewerId, full: true }))?.initial ?? null; }
  catch { return null; }
}

/** 원본 validateDashboardAssignments — 이 지점의 직원만, 중복 없이 받는다. */
export async function validateDashboardAssignments(sql, tenantId, assignments) {
  const ids = assignments.map(a => a.userId);
  if (new Set(ids).size !== ids.length) return '같은 직원의 배정이 두 번 들어 있습니다';
  if (!ids.length) return null;
  const valid = new Set((await sql`select id::text id from public.users where tenant_id=${tenantId} and system_role::text <> 'student' and id = any(${ids}::uuid[])`).map(r => r.id));
  return ids.some(id => !valid.has(id)) ? '현재 지점의 직원만 대시보드에 배정할 수 있습니다' : null;
}
