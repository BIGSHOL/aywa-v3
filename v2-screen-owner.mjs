// 2.0 화면 — 학원 설정(V2-SCREENS.md 대상 `owner`). 그리기는 2.0의 실제 React 부품(v2-host/src/owner*.tsx),
// 이 모듈은 2.0 app/(shell)/owner/page.tsx가 return 앞에서 하던 판정·조회를 Docker 복사본에서 같은 결과로 만든다:
//  · 면 = features/owner/tabs.ts OWNER_FACES · face-access.ts ownerFaceMenu · fallbackOwnerFace(권한 없는 면이면 맡은 면으로) · 옛 주소 이동
//  · 설정 = resolve.ts resolveSettings(저장값 + 기본값) · 편집 원본(getTenantSettingsForEdit — 캐시 없이 · 섹션 순번 settingsRevOf) ·
//    운영 면 기준 token(operations-save.ts operationsFaceTokens) · 자리 PIN 가리기(seat-pin-view.ts) · 권한 기준 token(permissions-save.ts)
//  · 면별 조회 = 강의실 사용 현황(classroom-queries.ts) · 과목별 강사 라벨(timetable getTeacherLabelsBySubject) · 세션 기간(periods getPeriodDefsForEditor) ·
//    개인별 권한의 이름 · 직원 선택지(getPermissionStaffOptions — 운영자 계정 제외)
// 3.0엔 로그인이 없다 — '보는 사람'을 고르고(학원 설정의 어느 면이든 열 수 있는 재직 직원 · 운영자 계정 제외 · 원장 먼저) 그 사람의 권한 표로 2.0과 같게 낸다.
// 아직 그리지 않는 면(데이터 정리 · 감사로그 · 연동 · 팝업 · 대시보드 · 가져오기 · 강사평가 · 기여도)은 호스트가 '아직' 안내를 세운다(owner-server-face.tsx).
// 지점 화면에는 운영자(슈퍼관리자) 설정 면을 세우지 않는다(CLAUDE.md '지점과 슈퍼관리자 설정 분리') — 2.0 page.tsx도 세우지 않는다.
import { UUID, loadRules } from './v2-mcs-core.mjs';
import { ownerActions } from './v2-owner-save.mjs';
import { integrationsView, integrationActions } from './v2-owner-integrations.mjs';
import { listPopups, popupActions } from './v2-owner-popups.mjs';
import { loadOwnerAudit } from './v2-owner-audit.mjs';
import { loadOwnerData, ownerDataActions } from './v2-owner-data.mjs';

const ID = 'owner';
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;

let rulesPromise = null;
export function loadOwnerRules(importV2) {
  rulesPromise ??= (async () => {
    const [tabs, faceAccess, resolve, seatPin, opsSave, permSave, stamp, roleCatalog, preset, types, label, modules] = await Promise.all([
      'features/owner/tabs.ts', 'features/owner/face-access.ts', 'features/owner/resolve.ts', 'features/owner/seat-pin-view.ts', 'features/owner/server/operations-save.ts',
      'features/owner/server/permissions-save.ts', 'features/owner/settings-stamp.ts', 'lib/settings-role-catalog.ts', 'features/owner/preset.ts',
      'features/owner/settings-types.ts', 'features/timetable/lib/teacher-label.ts', 'lib/modules.ts',
    ].map(p => importV2(p)));
    return { tabs, faceAccess, resolve, seatPin, opsSave, permSave, stamp, roleCatalog, preset, types, label, modules };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 사람 · 권한 표 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const RANK = ['master', 'admin', 'manager'];
/** 보는 사람 = 학원 설정의 어느 면이든 열 수 있는 재직 직원(운영자 계정 제외 · 원장 먼저). 각 사람의 권한 표(역할 재정의 + 개인 예외)를 함께 싣는다. */
async function readOwnerViewers(sql, t, R, O, settings) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id));
  const base = R.perms.resolveMatrix(Array.isArray(settings.permissions.overrides) ? settings.permissions.overrides : []);
  const userOverrides = Array.isArray(settings.permissions.userOverrides) ? settings.permissions.userOverrides : [];
  const faceMenus = O.tabs.OWNER_FACES.map(f => O.faceAccess.ownerFaceMenu(f.key));
  return users.filter(u => !operators.has(u.id)).map(u => {
    const matrix = R.modules.capDisabledModules(R.perms.applyUserOverrides(base, u.id, u.role, userOverrides), settings.modules.disabled);
    return { id: u.id, name: u.display_name, systemRole: u.role, roleLabel: R.ROLE_LABEL[u.role] ?? '', matrix, level: menu => R.perms.accessLevel(u.role, menu, matrix) };
  }).filter(v => faceMenus.some(m => v.level(m) !== 'none'))
    .sort((a, b) => (RANK.includes(a.systemRole) ? RANK.indexOf(a.systemRole) : RANK.length) - (RANK.includes(b.systemRole) ? RANK.indexOf(b.systemRole) : RANK.length) || a.name.localeCompare(b.name, 'ko'));
}
const canWrite = level => level === 'full' || level === 'scoped';

// ── 설정 읽기 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 저장값 + 학원 이름 + 마지막 저장 시각(2.0 loadTenantSettingsRaw · getSettingsMeta) — 이 화면은 편집 원본도 같은 읽기(캐시가 없다). */
async function readSettingsRow(sql, t) {
  const [[row], [tenant]] = await Promise.all([sql`select data, ${ISO(sql, 'updated_at')} updated_at from public.tenant_settings where tenant_id=${t}`, sql`select name from public.tenants where id=${t}`]);
  return { data: row?.data ?? null, updatedAt: row?.updated_at ?? null, name: tenant?.name ?? '' };
}

/** 2.0 isLaboratoryMenuAvailable — 배정 표에 그 메뉴가 없거나, 이 지점이 실험실을 켰으면. */
async function laboratoryAvailable(sql, t, menu) {
  const assigned = (await sql`select menu_key from public.lab_menu_assignments`.catch(() => null));
  if (assigned && !assigned.some(r => r.menu_key === menu)) return true;
  const [lic] = await sql`select is_active, expires_at::text expires_at from public.tenant_licenses where tenant_id=${t} and feature='laboratory'`.catch(() => []);
  return !!lic && lic.is_active === true && (!lic.expires_at || lic.expires_at >= new Date().toISOString());
}
/** 2.0 isFeatureLicensed — 행 없음 = 허용 · 끄거나 만료 = 차단 · 조회 실패 = 허용. */
async function featureLicensed(sql, t, feature) {
  const [lic] = await sql`select is_active, expires_at::text expires_at from public.tenant_licenses where tenant_id=${t} and feature=${feature}`.catch(() => [null]);
  if (!lic) return true;
  return lic.is_active !== false && (!lic.expires_at || lic.expires_at >= new Date().toISOString());
}

// ── 면별 조회 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** classroom-queries.ts getClassroomsWithUsage — 실효 강의실(배치 override ?? 반 기본값) · 살아 있는 배치만. */
async function classroomsWithUsage(sql, t, today) {
  const [rooms, classes, slots] = await Promise.all([
    sql`select id::text id, name, capacity, ${ISO(sql, 'archived_at')} archived_at from public.classrooms where tenant_id=${t} order by name`,
    sql`select id::text id, classroom_id::text classroom_id from public.classes where tenant_id=${t} and is_active`,
    sql`select s.class_id::text class_id, s.classroom_id::text classroom_id, s.valid_to::text valid_to from public.class_schedules s join public.classes c on c.id=s.class_id
      where s.tenant_id=${t} and c.is_active`,
  ]);
  const defaultRoomOf = new Map(classes.map(c => [c.id, c.classroom_id])), live = new Map(), using = new Map();
  for (const s of slots) {
    if (s.valid_to && s.valid_to < today) continue;
    const room = s.classroom_id ?? defaultRoomOf.get(s.class_id) ?? null;
    if (!room) continue;
    live.set(room, (live.get(room) ?? 0) + 1);
    (using.get(room) ?? using.set(room, new Set()).get(room)).add(s.class_id);
  }
  const stale = new Map();
  for (const c of classes) { const room = c.classroom_id; if (!room || using.get(room)?.has(c.id)) continue; stale.set(room, (stale.get(room) ?? 0) + 1); }
  return rooms.map(r => ({ id: r.id, name: r.name, capacity: r.capacity ?? null, archivedAt: r.archived_at ?? null, classCount: using.get(r.id)?.size ?? 0,
    staleDefaultCount: stale.get(r.id) ?? 0, slotCount: live.get(r.id) ?? 0 }));
}

/** timetable getTeacherLabelsBySubject — 활성 반 배치의 강사 라벨(배치 라벨 ?? 배치 강사 ?? 반 담임 · 영어 이름 지도로 해석)을 과목별로. */
async function teacherLabelsBySubject(sql, t, O) {
  const [names, rows] = await Promise.all([
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    sql`select s.slot_teacher_label, st.display_name slot_teacher_name, c.subject, ct.display_name class_teacher_name from public.class_schedules s
      join public.classes c on c.id=s.class_id left join public.users st on st.id=s.teacher_id left join public.users ct on ct.id=c.teacher_id
      where s.tenant_id=${t} and c.is_active`,
  ]);
  const labelMap = O.label.buildTeacherLabelMap(names.map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' })));
  const bySubject = new Map();
  for (const r of rows) {
    if (!r.subject) continue;
    const label = O.label.resolveSlotTeacherLabel(r.slot_teacher_label, r.slot_teacher_name ? { display_name: r.slot_teacher_name } : null, labelMap)
      ?? O.label.resolveTeacherLabel(r.class_teacher_name ?? null, labelMap);
    if (!label) continue;
    (bySubject.get(r.subject) ?? bySubject.set(r.subject, new Set()).get(r.subject)).add(label);
  }
  return Object.fromEntries([...bySubject].map(([s, set]) => [s, [...set].sort((a, b) => a.localeCompare(b, 'ko'))]));
}

/** periods getPeriodDefsForEditor(year) — 그 해 세션 정의(못 읽으면 빈 목록 = 달력월, 2.0과 같은 삼킴). */
async function periodDefsForEditor(sql, t, year) {
  try {
    const rows = await sql.savepoint(s => s`select id::text id, subject_key, class_id::text class_id, label_year, label_month, start_date::text start_date, end_date::text end_date
      from public.operating_periods where tenant_id=${t} and label_year=${year} order by subject_key asc, label_month asc`);
    return rows.map(r => ({ id: r.id, subjectKey: r.subject_key, classId: r.class_id, labelYear: r.label_year, labelMonth: r.label_month, startDate: r.start_date, endDate: r.end_date }));
  } catch { return []; }
}

/** platform-settings.ts permissionAccountIds — 개인별 메뉴 권한 + 개인별 기능 권한 칸에 이름이 오른 계정(깨진 줄은 건너뛴다). */
function permissionAccountIds(O, value) {
  const source = plain(value) ? value : {}, special = plain(source.specialAccess) ? source.specialAccess : {};
  const rowIds = rows => (Array.isArray(rows) ? rows.flatMap(row => (plain(row) && typeof row.userId === 'string' ? [row.userId] : [])) : []);
  const ids = list => (Array.isArray(list) ? list.filter(id => typeof id === 'string') : []);
  return [...rowIds(source.userOverrides), ...O.types.SPECIAL_ACCESS_ID_LISTS.flatMap(key => ids(special[key])), ...rowIds(special.staffSubjectScopes)];
}

// ── page.tsx 본문 ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function ownerPage({ sql, t, R, O, sp, viewers, viewer, settings, row, importV2 }) {
  // 옛 설정 탭은 권한 검사에 앞서 현재 주소로(2.0 redirect).
  const legacy = { report_mgmt: '/lesson-reports', report: '/lesson-reports?tab=report', ai_ment: '/lesson-reports?tab=ai_ment', sessions: '/owner?tab=subjects' }[sp.tab];
  if (legacy) return { redirect: legacy };
  const generic = O.preset.isGenericTenant(settings);
  const resolveTab = () => O.tabs.resolveOwnerTab(sp.tab === 'dup' ? 'data' : sp.tab);
  const requestedFace = sp.tab === 'modules' && generic ? 'modules' : resolveTab();
  if (requestedFace === 'makeups' && !(await laboratoryAvailable(sql, t, 'makeups'))) return { redirect: '/owner' };
  // 강사평가·기여도 면은 아직 그리지 않는다(이 연습 화면에선 면을 세우지 않는다).
  if (requestedFace === 'evaluation' || requestedFace === 'contribution') return { redirect: '/owner' };
  const menu = O.faceAccess.ownerFaceMenu(requestedFace);
  if (viewer.level(menu) === 'none') {
    const fallback = O.faceAccess.fallbackOwnerFace(requestedFace, { systemRole: viewer.systemRole, matrix: viewer.matrix, isMasterLevel: viewer.systemRole === 'master', isGeneric: generic });
    if (fallback) return { redirect: O.faceAccess.ownerFaceHref(fallback, false) };
    return { denied: true };
  }
  const canEditSettings = canWrite(viewer.level(menu));
  const allowedTabEntries = O.tabs.OWNER_FACES.map(face => [face.key, viewer.level(O.faceAccess.ownerFaceMenu(face.key)) !== 'none']);
  const isMaster = viewer.systemRole === 'master', canReadAudit = isMaster; // 운영자 계정은 보는 사람에서 빠져 있다
  const showMakeups = await laboratoryAvailable(sql, t, 'makeups');
  const tab = sp.tab === 'modules' && generic ? 'modules' : resolveTab();
  const showsOperations = tab === 'operations' || tab === 'subjects';
  const canEditOperations = showsOperations ? canWrite(viewer.level(O.roleCatalog.OWNER_SECTION_MENU.operations)) : false;
  const showsPermissions = tab === 'permissions' && isMaster;
  const needsFreshRead = (showsOperations && canEditOperations) || showsPermissions;
  // 편집 원본 = 이 화면이 방금 읽은 저장값(2.0 getTenantSettingsForEdit — 캐시 없음). 섹션 순번은 저장값에서.
  const editable = needsFreshRead ? { settings, versions: { operations: O.stamp.settingsRevOf(row.data?.operations), permissions: O.stamp.settingsRevOf(row.data?.permissions) } } : undefined;
  const operationsSource = settings.operations;
  const operationsTokens = editable && canEditOperations ? O.opsSave.operationsFaceTokens(editable.settings.operations) : undefined;
  const permissionsSource = showsPermissions ? editable?.settings.permissions : undefined;
  const today = R.dk.kstToday(), thisYear = Number(today.slice(0, 4)), yearParam = Number(sp.year);
  const sessionYear = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : thisYear;
  const permissionPeople = permissionsSource ? permissionAccountIds(O, permissionsSource) : [];
  const hiddenSettingKeys = [];
  if (showsPermissions && !(await featureLicensed(sql, t, 'ai_analysis'))) hiddenSettingKeys.push('ai_ment');
  if (settings.modules.disabled.includes('payroll')) hiddenSettingKeys.push('attendance_salary_settings', 'payroll_settings');
  const canManageData = tab === 'data' && canWrite(viewer.level('admin'));
  const canConfirmData = tab === 'data' && viewer.level('students') === 'full';
  const [classrooms, teacherLabels, periodDefs, names, staff, supers, audit, data] = await Promise.all([
    tab === 'operations' ? classroomsWithUsage(sql, t, today) : [],
    tab === 'subjects' ? teacherLabelsBySubject(sql, t, O) : {},
    tab === 'subjects' ? periodDefsForEditor(sql, t, sessionYear) : [],
    permissionPeople.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...new Set(permissionPeople)]}::uuid[])` : [],
    permissionsSource ? sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text <> 'inactive' and system_role::text <> 'student' order by display_name limit 1000` : [],
    permissionsSource ? sql`select id::text id from public.super_admins` : [],
    tab === 'audit' && canReadAudit ? loadOwnerAudit(viewer.id, t, sp, settings.operations.subjects) : null,
    tab === 'data' ? loadOwnerData(viewer.id, t, canManageData, canConfirmData) : null,
  ]);
  const operators = new Set(supers.map(s => s.id));
  // 🔴 설정 전체(자리 PIN · 권한 원본 …)를 브라우저에 보내지 않는다 — 2.0 page.tsx도 면마다 그 섹션만 부품에 넘긴다. 머리(학원 이름)·탭(preset · modules)은 늘, 나머지는 그 면일 때만.
  const settingsView = { preset: settings.preset, profile: tab === 'profile' ? settings.profile : { name: settings.profile.name }, modules: settings.modules,
    ...(tab === 'makeups' && canReadAudit ? { makeups: settings.makeups } : {}), ...(tab === 'billing' ? { billing: settings.billing } : {}),
    ...(tab === 'notifications' ? { notifications: settings.notifications } : {}), ...(tab === 'consultations' ? { consultations: settings.consultations } : {}),
    ...(tab === 'navigation' ? { navigation: settings.navigation } : {}), ...(showsPermissions ? { navigation: settings.navigation } : {}),
    // 연동 면 = 과목 라벨(시트 카드 제목)만.
    ...(tab === 'sheets' ? { operations: { subjects: settings.operations.subjects } } : {}) };
  return {
    settings: settingsView, meta: row.updatedAt ? { updatedAt: row.updatedAt } : null, tab, canEditSettings, allowedTabEntries, canReadAudit, isMaster, showMakeups,
    showEvaluation: false, showContribution: false, showsOperations, canEditOperations, settingsUnreadable: false,
    editableVersions: editable?.versions ?? null, operationsTokens,
    // 운영 섹션은 그 두 면(운영 체계 · 과목 운영)에만 — 저장할 수 없는 사람에겐 자리 PIN을 지운 값(2.0 operationsForViewer).
    operationsForClient: showsOperations ? O.seatPin.operationsForViewer(operationsSource, canEditOperations) : null, seatPin: O.seatPin.seatPinStatus(operationsSource),
    classrooms, canImportClassrooms: tab === 'operations' ? viewer.level('operations_settings') === 'full' : false,
    teacherLabelsBySubject: teacherLabels, periodDefs, sessionYear, holidayDates: operationsSource.holidays.map(h => h.date),
    permissionsSource, permissionsTok: permissionsSource ? O.permSave.permissionsToken(permissionsSource) : undefined,
    userOverrideNames: Object.fromEntries(names.map(u => [u.id, u.display_name ?? ''])),
    permissionStaff: staff.filter(u => !operators.has(u.id)).map(u => ({ id: u.id, name: u.display_name ?? '(이름 없음)', role: u.role })),
    hiddenPermissionIds: permissionPeople.filter(id => operators.has(id)).filter((id, i, a) => a.indexOf(id) === i),
    hiddenSettingKeys,
    // '탭 및 메뉴 구성' 편집기의 강사 메뉴 판정(navigationEditorGates)은 다음 단계 — 그때까지 강사뷰 편집기는 비어 보인다.
    navigationGates: null,
    integrations: tab === 'sheets' ? await integrationsView(sql, t, R, settings, viewer) : null,
    popups: tab === 'popups' ? await listPopups(sql, t, importV2) : null,
    audit, data,
  };
}

/** 저장이 쓰는 재료 — 보는 사람 목록(= 저장하는 사람)은 지금 저장된 권한 표로. */
async function ownerIo(sql, t, importV2) {
  const [R, O] = await Promise.all([loadRules(importV2), loadOwnerRules(importV2)]);
  const row = await readSettingsRow(sql, t), settings = O.resolve.resolveSettings(row.data, { name: row.name });
  return { sql, t, R, O, importV2, settings, permissionAccountIds, viewers: await readOwnerViewers(sql, t, R, O, settings) };
}

export const screen = {
  id: ID, label: '학원 설정', order: 20,
  // 저장 = 2.0 saveOwnerSection(v2-owner-save.mjs) — 저장하는 사람 = 보는 사람.
  actions: { ...ownerActions(ownerIo), ...integrationActions(ownerIo), ...popupActions(ownerIo), ...ownerDataActions(ownerIo) },
  params: { viewer: UUID, tab: /^[a-z_]{1,24}$/, year: /^\d{4}$/, sub: /^[a-zA-Z_]{1,24}$/, page: /^\d{1,4}$/,
    action: /^[a-z0-9_]{1,80}$/, q: /^[\s\S]{0,200}$/, from: /^\d{4}-\d{2}-\d{2}$/, to: /^\d{4}-\d{2}-\d{2}$/ },
  load: async ({ sql, params: sp, tenantId: t, importV2 }) => {
    const [R, O] = await Promise.all([loadRules(importV2), loadOwnerRules(importV2)]);
    const row = await readSettingsRow(sql, t);
    const settings = O.resolve.resolveSettings(row.data, { name: row.name });
    const viewers = await readOwnerViewers(sql, t, R, O, settings);
    const viewer = viewers.find(v => v.id === sp.viewer) ?? viewers[0] ?? null;
    const common = { editors: viewers.map(v => ({ id: v.id, name: v.name, role: v.roleLabel })), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      // OperationsProvider가 읽는 네 칸만(자리 PIN 등 운영 섹션 나머지는 싣지 않는다).
      host: { operations: { subjects: settings.operations.subjects, gradeLevels: settings.operations.gradeLevels, jobTitles: settings.operations.jobTitles,
        jobTitlesByDepartment: settings.operations.jobTitlesByDepartment }, disabledModules: settings.modules.disabled } };
    if (!viewer) return { ...common, route: 'none' };
    const page = await ownerPage({ sql, t, R, O, sp, viewers, viewer, settings, row, importV2 });
    if (page.redirect) return { ...common, route: 'redirect', redirect: page.redirect };
    if (page.denied) return { ...common, route: 'denied' };
    return { ...common, route: 'page', page };
  },
};
