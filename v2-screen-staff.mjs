// 2.0 화면 — 직원관리(V2-SCREENS.md `staff`, 처리 화면 세션 R). 진입점 주인 = 작업자 A, 하위 화면(연차 관리 · 급여명세서 · 이력서)은 작업자 B
// (v2-staff-sub.mjs — isStaffSubPath · staffSubLoad · staffSubActions · staffSubParams).
// 그리기는 2.0의 실제 React 부품(v2-host/src/staff.tsx). 이 모듈은 2.0 서버 page.tsx들이 부품에 넘기던 값을 Docker 복사본에서 같은 모양으로:
//  · /staff(목록 page.tsx) · /staff/<id>(상세 page.tsx — 기본정보·월간일정·수업이력·급여 설정·활동 로그 탭) · /staff/<id>/edit(근무 설정) · /staff/new(직원 등록)
//  · 읽기 = v2-staff-read.mjs · 저장 = v2-staff-save.mjs.
// 보는 사람 = 3.0 띠에서 고른 직원(GET ?actor= — 직원관리 메뉴가 열린 재직 직원). 누가 보느냐로 화면이 달라진다(쓰기 단추 · 계정 관리 · 급여 · 이력서 칸).
// 🔴 운영자 계정은 지점 화면에서 '관리자'로 보인다(2.0 displayRoleFor) — 운영자 명단은 응답에 싣지 않고, 서버가 표시 역할로 바꿔 내려 보낸다.
import { readStaffPeople, getStaffList, getStaffById, salaryGate, canViewResume, getResumeByStaffUser, basicInfoData, getStaffClasses,
  activityData, monthlyData, salaryData, salaryAdmin, protectionStatus, superAdminIds, listIntakeTokens, buildQrView, loadStaffListPrefs, isFullShellRole } from './v2-staff-read.mjs';
import { staffActions } from './v2-staff-save.mjs';
import { isStaffSubPath, staffSubLoad, staffSubActions, staffSubParams } from './v2-staff-sub.mjs';

const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DETAIL = new RegExp(`^/staff/(${UUID_BODY})$`, 'i'), EDIT = new RegExp(`^/staff/(${UUID_BODY})/edit$`, 'i');
/** 2.0 목록 page.tsx searchParams — 호스트 진입점과 같은 열쇠(verify가 2.0 원문과 대조). */
export const LIST_KEYS = ['invited', 'tab', 'role', 'status', 'subject', 'emp', 'q', 'sort', 'size', 'page'];
/** 2.0 상세 page.tsx searchParams. */
export const DETAIL_KEYS = ['tab', 'page', 'period'];
const TABS = ['info', 'monthly', 'classes', 'activity', 'salary'];

/** 2.0 super-admin.ts displayRoleFor — 운영자 계정(원장 역할)은 지점 화면에서 '관리자'. 그 파일은 세션을 읽어 불러올 수 없어 한 줄 판정을 같은 글자로. */
const displayRoleFor = (userId, realRole, ids) => (ids.has(userId) && realRole === 'master' ? 'admin' : realRole);

/** 학원 설정 중 화면이 읽는 칸만(연동 비밀값 등 나머지는 내려 보내지 않는다). */
function settingsFor(s, { assignmentOf } = {}) {
  return {
    preset: s.preset, modules: { disabled: s.modules.disabled }, operations: s.operations,
    permissions: { specialAccess: { leaveAdjusterIds: s.permissions?.specialAccess?.leaveAdjusterIds ?? [] } },
    ...(assignmentOf ? { dashboard: { assignments: (s.dashboard?.assignments ?? []).filter(a => a.userId === assignmentOf) } } : {}),
  };
}

async function load({ sql, params, tenantId: t, importV2 }) {
  const path = params.v2path ?? '/staff';
  if (isStaffSubPath(path)) return staffSubLoad({ sql, params, tenantId: t, importV2, path });
  const ctx = await readStaffPeople(sql, t, importV2), viewer = ctx.pick(params.actor);
  if (!viewer) return { notAllowed: true, editors: ctx.editorList };
  return buildStaff({ ctx, viewer, params, path, importV2 });
}

/** 보는 사람이 정해진 뒤의 조립 — 시험이 '권한이 좁은 보는 사람'을 넣어 볼 수 있게 떼어 둔다. */
export async function buildStaff({ ctx, viewer, params, path, importV2 }) {
  const { R, settings, sql, t } = ctx, editors = ctx.editorList;
  const user = { id: viewer.id, systemRole: viewer.role, tenantId: t, displayName: viewer.display_name };
  const base = { editors, user, operations: settings.operations, modules: { disabled: settings.modules.disabled } };
  const canManage = ctx.canWrite(viewer, 'staff');

  if (path === '/staff') {
    const [prefs, rows, supers, tokens] = await Promise.all([
      loadStaffListPrefs(ctx, viewer), getStaffList(ctx, viewer), superAdminIds(sql), canManage ? listIntakeTokens(sql, t) : [],
    ]);
    return {
      ...base, list: true, prefs,
      // 표시 역할을 서버에서 입혀 보낸다(운영자 명단은 내려 보내지 않는다 — 화면의 displayRoleFor는 빈 명단으로 같은 결과).
      rows: rows.map(r => ({ ...r, systemRole: displayRoleFor(r.id, r.systemRole, supers) })),
      settings: settingsFor(settings), canManage, isSuperAdmin: false, canImport: ctx.canManage(viewer, 'staff'),
      qrTokens: await Promise.all(tokens.map(tok => buildQrView(R, tok))),
    };
  }
  if (path === '/staff/new') {
    if (!canManage) return { ...base, redirect: '/staff' };
    return { ...base, roleOptions: R.roles.assignableRoles(viewer.role), jobTitles: settings.operations.jobTitles, canGrantTeacherView: viewer.role === 'master' };
  }
  const edit = EDIT.exec(path);
  if (edit) {
    if (!canManage) return { ...base, redirect: '/staff' };
    const staff = await getStaffById(ctx, viewer, edit[1]);
    if (!staff) return { ...base, notFound: true };
    const supers = await superAdminIds(sql);
    const canAssignDashboard = viewer.role === 'master';
    const canAssignTarget = canAssignDashboard && (await protectionStatus(sql, staff.id)) === 'clear';
    const canGrantTeacherView = canAssignTarget && isFullShellRole(staff.systemRole);
    const { hourlyRate: _h, monthlyBase: _m, ...shown } = staff; // 근무 설정 폼은 급여를 쓰지 않는다
    return { ...base, staff: { ...shown, systemRole: displayRoleFor(staff.id, staff.systemRole, supers) }, settings: settingsFor(settings, { assignmentOf: staff.id }),
      canAssignTarget, canGrantTeacherView };
  }
  const detail = DETAIL.exec(path);
  if (!detail) return { ...base, unknown: true };
  const staff = await getStaffById(ctx, viewer, detail[1]);
  if (!staff) return { ...base, notFound: true };
  const supers = await superAdminIds(sql);
  const displayRole = displayRoleFor(staff.id, staff.systemRole, supers);
  const showSalarySettings = R.employment.hasFreelancePart(staff.employmentType) && salaryAdmin(ctx, viewer);
  // 2.0 tabs-nav.tsx isStaffTabKey · accessibleStaffTab(활동 로그 = 직원관리 쓰기 · 급여 설정 = 위 판정, 아니면 기본정보).
  const tabRaw = TABS.includes(params.tab) ? params.tab : 'info';
  const tab = (tabRaw === 'activity' && !canManage) || (tabRaw === 'salary' && !showSalarySettings) ? 'info' : tabRaw;
  const canManageThis = canManage && R.roles.canManageStaffMember(viewer.role, staff.systemRole); // 판정은 실제 역할로
  const roleOptions = canManageThis ? R.roles.assignableRoles(viewer.role) : [];
  const canSeeSalary = viewer.role === 'master' || viewer.id === staff.id;
  const resumeAccess = tab === 'info' && (await canViewResume(ctx, viewer, staff.id));
  const resume = resumeAccess ? await getResumeByStaffUser(ctx, viewer, staff.id) : null;
  const resumeCanWrite = resumeAccess && canManage;
  // 증명사진 = 바깥 저장소(Storage) 서명 주소 — 만들지 않는다(사진 자리는 비어 보인다).
  const resumePhotoUrls = resume ? resume.data.photos.map(() => null) : [];
  const activityPage = Math.max(1, Number(params.page) || 1);
  const tabData = tab === 'info' ? { info: await basicInfoData(ctx, viewer, staff, { canManageThis }) }
    : tab === 'monthly' ? { monthly: await monthlyData(ctx, viewer, staff.id) }
    : tab === 'classes' ? { classes: await getStaffClasses(ctx, viewer, staff.id) }
    : tab === 'salary' ? { salary: await salaryData(ctx, viewer, staff.id, params.period, importV2) }
    : { activity: await activityData(ctx, viewer, staff.id, activityPage) };
  return {
    ...base, staff: { ...salaryGate(staff, canSeeSalary), systemRole: displayRole }, settings: settingsFor(settings), tab, activityPage,
    canManage, showSalarySettings, canManageThis, roleOptions, canSeeSalary, resumeAccess, resume, resumeCanWrite, resumePhotoUrls, ...tabData,
  };
}

const ownKeys = Object.keys(staffActions);
const actions = { ...staffSubActions, ...staffActions };
for (const k of Object.keys(staffSubActions)) if (ownKeys.includes(k)) console.error(`직원관리 저장 이름이 겹칩니다: ${k}`);

export const screen = {
  id: 'staff', label: '직원관리', order: 44,
  params: {
    ...staffSubParams,
    actor: new RegExp(`^${UUID_BODY}$`, 'i'),
    v2path: /^\/staff(?:\/[A-Za-z0-9-]{1,40}){0,3}$/,
    invited: /^[^\s]{1,200}$/, tab: /^[a-z]{1,12}$/, role: /^[a-z]{1,12}$/, status: /^[a-z]{1,12}$/, subject: /^[\w-]{1,40}$/,
    emp: /^[\p{L}\p{N} ]{1,20}$/u, q: /^[\s\S]{0,100}$/, sort: /^[a-z]{1,12}$/, size: /^\d{1,3}$/, page: /^\d{1,5}$/, period: /^\d{4}-\d{2}$/,
  },
  actions,
  load,
};
