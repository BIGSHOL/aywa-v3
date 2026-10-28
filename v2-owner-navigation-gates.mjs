// navigationEditorGates(settings): 지점에서 닫힌 메뉴 · 강사 역할 메뉴 · 강사 개인 예외.
let sourcePromise;
const sources = importV2 => sourcePromise ??= Promise.all([
  importV2('lib/navigation.ts'), importV2('features/makeups/config.ts'),
  importV2('lib/laboratory/rule.ts'), importV2('features/student-contribution/model/access.ts'),
  importV2('features/owner/navigation-editor-source.ts'),
]).then(([nav, makeup, laboratory, contribution, editor]) => ({ nav, makeup, laboratory, contribution, editor }))
  .catch(e => { sourcePromise = null; throw e; });

export async function loadNavigationGates(sql, t, R, O, settings, importV2) {
  const M = await sources(importV2);
  const closed = await sql.savepoint(async s => {
    const allOpen = Object.fromEntries(R.perms.MENU_KEYS.map(menu => [menu,
      Object.fromEntries(R.perms.SYSTEM_ROLES.map(role => [role, 'full']))]));
    let capped = M.makeup.capMakeupMode(O.modules.capDisabledModules(allOpen, settings.modules.disabled),
      M.makeup.normalizeMakeupSettings(settings.makeups).mode);
    capped = M.contribution.capContributionMenu(capped, t);
    const [{ assignmentsTable }] = await s`select to_regclass('public.lab_menu_assignments') is not null "assignmentsTable"`;
    const assigned = assignmentsTable
      ? [...new Set((await s`select menu_key from public.lab_menu_assignments`).map(r => r.menu_key))].filter(k => M.laboratory.LAB_ELIGIBLE_KEYS.has(k))
      : M.laboratory.LAB_ELIGIBLE_MENUS.map(item => item.key);
    if (assigned.length) {
      const [lic] = await s`select is_active, expires_at::text expires_at from public.tenant_licenses where tenant_id=${t} and feature='laboratory'`;
      const on = !!lic && lic.is_active === true && (!lic.expires_at || lic.expires_at >= new Date().toISOString());
      capped = M.laboratory.capLaboratoryMenus(capped, assigned, on);
    }
    const [ai] = await s`select is_active, expires_at::text expires_at from public.tenant_licenses where tenant_id=${t} and feature='ai_analysis'`;
    if (ai && (ai.is_active === false || (ai.expires_at && ai.expires_at < new Date().toISOString())))
      capped = { ...capped, ai_ment: Object.fromEntries(R.perms.SYSTEM_ROLES.map(role => [role, 'none'])) };
    return R.perms.MENU_KEYS.filter(menu => R.perms.SYSTEM_ROLES.every(role => capped[menu][role] === 'none'));
  }).catch(() => []);
  const teacherOpen = M.nav.teacherMenuKeysFor('teacher', O.modules.capDisabledModules(R.perms.resolveMatrix(settings.permissions.overrides), settings.modules.disabled))
    .filter(menu => !closed.includes(menu));
  const overrides = settings.permissions.userOverrides;
  const ids = [...new Set(overrides.map(r => r.userId))];
  const users = ids.length ? await sql.savepoint(s => s`select id::text id, system_role::text role from public.users where tenant_id=${t} and id = any(${ids}::uuid[])`).catch(() => null) : [];
  const roleOf = users === null ? null : new Map(users.map(u => [u.id, u.role]));
  const teacherRows = roleOf === null ? overrides : overrides.filter(r => roleOf.get(r.userId) === 'teacher');
  return { closed, teacherOpen, teacherPersonal: M.editor.personallyOpenedMenus(teacherRows, closed) };
}
