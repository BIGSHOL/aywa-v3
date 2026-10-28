// 직원관리 호스트 공용 조각 — /api/v2/staff가 돌려주는 모양(2.0 page.tsx가 서버에서 받던 값)과, 서버 전용 파일에 있어 화면이 불러오지 못하는
// 2.0 한 줄 판정·상수(같은 글자 — verify-v2-screen-staff.mjs가 2.0 원문과 대조한다).
import type { SystemRole } from "@/lib/permissions";
import type { StaffRow, StaffDetail, HomeroomClassRow, AssistClassRow, StaffClassRow } from "@/features/staff/server/queries";
import type { ContractRow } from "@/features/staff/contract/contract";
import type { ContractFileRow } from "@/features/staff/contract/server/contract-queries";
import type { ResumeDetail } from "@/features/staff/resume/server/resume-queries";
import type { MonthlyTasksResult } from "@/features/staff/notion/server/notion";
import type { AccessSession, LoginEventRow, ActivityRow } from "@/features/audit/server/activity-queries";
import type { AttendanceSalaryRates } from "@/features/attendance/salary-rates";
import type { StaffListPrefs } from "@/features/staff/list/list-prefs";
import type { StaffQrView } from "@/features/staff/intake/intake-view";
import type { TenantSettings } from "@/features/owner/settings-types";

/** 2.0 super-admin.ts `displayRoleFor` — 운영자 계정(원장 역할)은 지점 화면에서 '관리자'. 서버가 이미 표시 역할로 보내고 명단은 비어 온다. */
export function displayRoleFor(
  userId: string,
  realRole: SystemRole,
  superAdminIds: Set<string>,
): SystemRole {
  return superAdminIds.has(userId) && realRole === "master" ? "admin" : realRole;
}

/** 2.0 next/headers `cookies()` 자리 — 3.0에는 그 기기 쿠키(한 쪽 행 수)가 없다. 2.0이 쿠키를 못 읽을 때처럼 빈 값. */
export const HOST_COOKIES = { get: (_name: string): { value: string } | undefined => undefined };

/** 2.0 activity-queries.ts `ACTIVITY_PAGE_SIZE`(서버 전용 파일) — 같은 값. */
export const ACTIVITY_PAGE_SIZE = 30;

type HostSettings = Pick<TenantSettings, "preset" | "modules" | "operations"> & {
  permissions: { specialAccess: { leaveAdjusterIds: string[] } };
  dashboard?: { assignments?: TenantSettings["dashboard"]["assignments"] };
};
type HostUser = { id: string; systemRole: SystemRole; tenantId: string; displayName: string };
type Base = { editors: { id: string; name: string; role: string }[]; user: HostUser; operations: TenantSettings["operations"]; modules: { disabled: string[] } };

export type StaffListData = Base & {
  prefs: StaffListPrefs | null;
  rows: StaffRow[];
  settings: HostSettings;
  canManage: boolean;
  isSuperAdmin: boolean;
  canImport: boolean;
  qrTokens: StaffQrView[];
};
export type StaffInfoData = {
  settings: HostSettings;
  homeroomClasses: HomeroomClassRow[];
  contracts: ContractRow[];
  contractFiles: ContractFileRow[];
  handoverTeachers: { id: string; name: string; subjects: string[]; bgColor: string | null; textColor: string | null }[];
  assistClasses: AssistClassRow[];
  protection: "clear" | "protected" | "unknown";
};
export type StaffActivityData = { log: { rows: ActivityRow[]; total: number }; sessions: AccessSession[]; logins: LoginEventRow[] };
export type StaffSalaryData =
  | { month: string; unavailable: true }
  | { month: string; rates: AttendanceSalaryRates; canEdit: boolean; classes: { id: string; name: string }[]; mixed: boolean };
export type StaffDetailData = Base & {
  staff: StaffDetail;
  settings: HostSettings;
  canManage: boolean;
  showSalarySettings: boolean;
  canManageThis: boolean;
  resumeAccess: boolean;
  resume: ResumeDetail | null;
  resumeCanWrite: boolean;
  resumePhotoUrls: (string | null)[];
  info?: Omit<StaffInfoData, "settings">;
  monthly?: MonthlyTasksResult;
  classes?: StaffClassRow[];
  salary?: StaffSalaryData | null;
  activity?: StaffActivityData;
};
export type StaffEditData = Base & { staff: StaffDetail; settings: HostSettings & { dashboard: NonNullable<HostSettings["dashboard"]> }; canAssignTarget: boolean; canGrantTeacherView: boolean };
export type StaffNewData = Base & { roleOptions: SystemRole[]; jobTitles: string[]; canGrantTeacherView: boolean };
