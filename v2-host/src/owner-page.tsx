// 2.0 학원 설정(app/(shell)/owner/page.tsx)의 그리기 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회·판정(면 권한 · 설정 · 운영/권한 편집 원본과
// 기준 token · 강의실 · 교시 · 직원 선택지 …)은 /api/v2/owner(Docker 복사본, v2-screen-owner.mjs)가 하고 여기서는 page.tsx의 facesFor · SELF_GATED_TABS · fmt와
// return 본문을 **글자 그대로** 옮겼다. 바꾼 곳 = 서버에서만 계산되는 값 세 자리(자리 PIN 상태 · 휴일 날짜 · 권한 token — 원본을 브라우저에 보내지 않는다)와
// 서버 컴포넌트 면(데이터 정리 · 감사로그 · 연동 · 팝업 · 대시보드 · 가져오기 · 강사평가 · 기여도) — owner-page.swaps.json, verify가 글자를 대조한다.
import { OWNER_FACES, type OwnerFaceDef, type OwnerFaceKey, type OwnerTab } from "@/features/owner/tabs";
import { isGenericTenant } from "@/features/owner/preset";
import { isModuleEnabled } from "@/lib/modules";
import type { TenantSettings, OperationsSettings, PermissionsSettings } from "@/features/owner/settings-types";
import type { SettingsRoleKey } from "@/lib/settings-role-catalog";
import { OwnerTabBar } from "@/app/(shell)/owner/_components/owner-tab-bar";
import { PageHeader } from "@/components/page-header";
import { PageMaximizeToolbar } from "@/components/page-maximize/page-maximize-toolbar";
import { ProfileSection } from "@/app/(shell)/owner/_components/profile-section";
import { OperationsSection } from "@/app/(shell)/owner/_components/operations-section";
import { SubjectsSection } from "@/app/(shell)/owner/_components/subjects-section";
import { BillingSection } from "@/app/(shell)/owner/_components/billing-section";
import { NotificationsSection } from "@/app/(shell)/owner/_components/notifications-section";
import { ConsultationsSection } from "@/app/(shell)/owner/_components/consultations-section";
import { PermissionsSection } from "@/app/(shell)/owner/_components/permissions-section";
import { NavigationSection } from "@/app/(shell)/owner/_components/navigation-section";
import { ModulesSection } from "@/app/(shell)/owner/_components/modules-section";
import { MakeupsSection } from "@/app/(shell)/owner/_components/makeups-section";
import { OwnerServerFace } from "./owner-server-face";
import { OwnerIntegrationsFace, type OwnerIntegrationsData } from "./owner-integrations";

type Sp = Record<string, string | undefined>;

/** /api/v2/owner — page.tsx가 return 앞에서 만든 값(이름 그대로). 원본 운영·권한 설정은 편집할 수 있는 사람에게만 실린다(2.0과 같다). */
export type OwnerPageData = {
  settings: TenantSettings;
  meta: { updatedAt: string | null } | null;
  tab: OwnerTab | "modules";
  canEditSettings: boolean;
  allowedTabEntries: [OwnerFaceKey, boolean][];
  canReadAudit: boolean;
  isMaster: boolean;
  showMakeups: boolean;
  showEvaluation: boolean;
  showContribution: boolean;
  showsOperations: boolean;
  canEditOperations: boolean;
  settingsUnreadable: boolean;
  editableVersions: { operations?: number; permissions?: number } | null;
  operationsTokens: { operations: string; subjects: string } | undefined;
  operationsForClient: OperationsSettings;
  seatPin: unknown;
  classrooms: never[];
  canImportClassrooms: boolean;
  teacherLabelsBySubject: Record<string, string[]>;
  periodDefs: never[];
  sessionYear: number;
  holidayDates: string[];
  permissionsSource: PermissionsSettings | undefined;
  permissionsTok: string | undefined;
  userOverrideNames: Record<string, string>;
  permissionStaff: never[];
  hiddenPermissionIds: string[];
  hiddenSettingKeys: SettingsRoleKey[];
  navigationGates: { teacherOpen: never[]; teacherPersonal?: never; closed?: never } | null;
  /** 연동 면(tab=sheets)일 때만 — 켜진 연동 탭 · 과목별 구글 시트 상태. */
  integrations: OwnerIntegrationsData | null;
};

function facesFor(canReadAudit: boolean, showModules: boolean, showMakeups: boolean, showEvaluation: boolean, showContribution: boolean): OwnerFaceDef[] {
  // 원장 위에게만 서는 면(감사로그 · 대시보드 관리 · 기능)은 위임 계정엔 세우지 않는다 — 주소로 와도 안내 문구(아래 본문).
  // '기능'(모듈 켜기·끄기) 면은 **새 학원(일반판)에만** 선다 — 침산 설정 화면은 이 면이 생기기 전과 같아야 한다(원장 2026-09-22).
  return OWNER_FACES.filter((f) => (!f.masterOnly || canReadAudit) && (!f.genericOnly || showModules) && (f.key !== "makeups" || showMakeups)
    && (f.key !== "evaluation" || showEvaluation) && (f.key !== "contribution" || showContribution));
}

const SELF_GATED_TABS: ReadonlySet<OwnerTab | "modules"> = new Set(["data", "import", "audit", "evaluation", "contribution"]);

function fmt(iso: string | null): string {
  if (!iso) return "아직 저장된 설정 없음 (기본값 사용 중)";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** page.tsx `OwnerSettingsPage`의 그리기 — sp(주소)와 서버 결과. */
export function OwnerHostPage({ d, sp }: { d: OwnerPageData; sp: Sp }) {
  const { settings, meta, tab, canEditSettings, canReadAudit, isMaster, showMakeups, showEvaluation, showContribution, showsOperations, canEditOperations, settingsUnreadable,
    operationsTokens, operationsForClient, seatPin, classrooms, canImportClassrooms, teacherLabelsBySubject, periodDefs, sessionYear, holidayDates, permissionsSource,
    permissionsTok, userOverrideNames, permissionStaff, hiddenPermissionIds, hiddenSettingKeys, navigationGates, integrations } = d;
  // 2.0 page.tsx와 같은 식 — 연동 면 makeedu 실행 이력 쪽(지금은 '아직')이 쓴다.
  const page = Math.max(1, Number(sp.page) || 1);
  const allowedTabs = new Map<OwnerFaceKey, boolean>(d.allowedTabEntries);
  const editable = d.editableVersions ? { versions: d.editableVersions } : undefined;
  return (
    <div data-maximize-toolbar-page="" className="w-full min-w-0 space-y-6">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바).
          '최근 저장' 메타는 actions 슬롯(우측) — 컴팩트 행에서도 유지된다. */}
      <div data-maximize-title-row="">
      <PageHeader
        eyebrow="학원 설정"
        title={`${settings.profile.name || "학원"} 설정`}
        description="학원에 관한 모든 설정과 관리 도구입니다. 여기서 바꾼 내용은 학원 전체에 적용됩니다. 원장과, 역할·권한에서 맡긴 계정만 바꿀 수 있고 역할·권한 면은 원장만 바꿉니다."
        // 창 컴팩트 행은 1행이 규칙 — 위 안내문(~110자)은 창 폭에서 2~3줄로 감겨 짧은 라벨로 대체(적대 리뷰).
        // ⚠️ 상단 바 브랜드는 `logoText`라 `profile.name`과 다를 수 있다 → 컴팩트 행에 학원명을 남긴다.
        embedLabel={`${settings.profile.name || "학원"} 설정 — 변경은 원장·위임 계정만`}
        actions={<p className="text-text-faint text-xs">최근 저장: {fmt(meta?.updatedAt ?? null)}</p>}
      />

      </div>
      <PageMaximizeToolbar>
        {/* 면이 많으면 범주 줄 + 그 범주의 면 줄, 적으면 종전처럼 한 줄(`ownerTabRows`). 주소는 면마다 `?tab=` 그대로다. */}
        <OwnerTabBar faces={facesFor(canReadAudit, isGenericTenant(settings), showMakeups, showEvaluation, showContribution).filter((face) => allowedTabs.get(face.key))} active={tab} />
      </PageMaximizeToolbar>

      {/* 운영 체계·과목 운영 면은 섹션 폼이 같은 안내를 직접 적는다(읽기 전용 폼) — 두 번 적지 않는다. */}
      {/* 자체 판정을 하는 면(SELF_GATED_TABS)은 설정 '읽기 전용' 안내도, 아래 fieldset 잠금도 받지 않는다. */}
      {!canEditSettings && !showsOperations && !SELF_GATED_TABS.has(tab) ? <p className="text-text-faint text-xs">읽기 전용입니다.</p> : null}
      <fieldset disabled={!canEditSettings} className="min-w-0 space-y-4 border-0 p-0">
      {tab === "profile" ? <ProfileSection initial={settings.profile} /> : null}
      {settingsUnreadable ? (
        <div className="bg-card border-line rounded-2xl border p-6">
          <p className="text-foreground text-sm font-bold">설정을 불러오지 못했습니다</p>
          <p className="text-text-dim mt-1 text-sm">저장된 값을 확인하지 못해 편집 화면을 열지 않았습니다. 잠시 뒤 새로고침해 주세요.</p>
        </div>
      ) : null}
      {tab === "operations" && !settingsUnreadable ? (
        <OperationsSection
          initial={operationsForClient}
          classrooms={classrooms}
          canImportClassrooms={canImportClassrooms}
          readOnly={!canEditOperations}
          seatPinStatus={seatPin}
          baselineToken={operationsTokens?.operations}
          baselineVersion={editable?.versions.operations}
        />
      ) : null}
      {/* 보강 운영 = 운영 설정과 다른 묶음(저장 경로 · 권한이 따로)이라 제 면에 둔다 — 운영 체계 면 아래에 저장 버튼이
          하나 더 서 있던 것을 옮겼다(원장 2026-10-06). 원장 위만 바꾼다(저장 액션 `configureMakeupSettings`와 같은 선). */}
      {tab === "makeups" ? (
        canReadAudit ? (
          <MakeupsSection initial={settings.makeups} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">보강 운영은 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              보강관리를 켜고 끄는 일은 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {tab === "subjects" && !settingsUnreadable ? (
        <SubjectsSection
          initial={operationsForClient}
          readOnly={!canEditOperations}
          teacherLabels={teacherLabelsBySubject}
          periodDefs={periodDefs}
          sessionYear={sessionYear}
          holidays={holidayDates}
          baselineToken={operationsTokens?.subjects}
          baselineVersion={editable?.versions.operations}
        />
      ) : null}
      {tab === "billing" ? (
        <BillingSection initial={settings.billing} showEie={isModuleEnabled(settings.modules.disabled, "eie")} />
      ) : null}
      {tab === "notifications" ? <NotificationsSection initial={settings.notifications} /> : null}
      {tab === "consultations" ? <ConsultationsSection initial={settings.consultations} /> : null}
      {tab === "permissions" ? (
        isMaster ? (
          // 못 읽었으면(permissionsSource 없음) 위의 '불러오지 못했습니다' 안내만 선다.
          permissionsSource ? (
            <PermissionsSection
              initial={permissionsSource}
              // 표의 줄 · 강사 내 메뉴 칸은 학원의 메뉴 구성(왼쪽 탭과 그 내부 메뉴) 차례로 선다.
              navigation={settings.navigation}
              userOverrideNames={userOverrideNames}
              staffOptions={permissionStaff}
              hiddenUserIds={hiddenPermissionIds}
              generic={isGenericTenant(settings)}
              hiddenSettingKeys={hiddenSettingKeys}
              baselineToken={permissionsTok}
              baselineVersion={editable?.versions.permissions}
            />
          ) : null
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">역할·권한은 원장만 변경할 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              위임받은 계정으로도 이 면(역할·권한)은 편집할 수 없어요 — 권한 자체를 바꾸는 일은 원장 계정 전용입니다.
              나머지 설정 면(프로필·운영 체계·과목·수납·알림)은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {/* 탭 및 메뉴 구성(관리자뷰·강사뷰) — 보기 설정이라 **권한(master 전용)과 달리 위임 계정도 편집**한다(saveOwnerSection이 owner 쓰기로 게이트).
          권한을 대체하지 않기 때문에 여기서 켜도 못 보던 화면이 열리지 않는다. */}
      {tab === "navigation" ? (
        <NavigationSection
          initial={settings.navigation}
          // 강사뷰 편집기에 세울 메뉴의 근거 = 이 학원의 **강사 역할** 권한(override + 지점에서 닫힌 메뉴) — 판정은 navigation-editor-gates.ts.
          teacherOpen={navigationGates?.teacherOpen ?? []}
          // 개인별 메뉴 권한으로 강사 계정에게 연 메뉴는 강사뷰 편집기에 남긴다 · 지점에서 아무도 못 여는 메뉴는 편집기에 세우지 않는다(원장 2026-10-14 "없는 메뉴").
          teacherPersonal={navigationGates?.teacherPersonal}
          closedMenus={navigationGates?.closed}
        />
      ) : null}
      {/* '기능' 면 = 원장·총괄만 편집(saveOwnerSection·0281a 트리거와 같은 선) — 위임 계정엔 저장이 실패할 폼 대신 안내.
          판정은 감사로그 면과 같은 식(원장 또는 총괄)이라 canReadAudit을 그대로 쓴다. */}
      {tab === "modules" ? (
        canReadAudit ? (
          <ModulesSection initial={settings.modules} />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">기능 켜기·끄기는 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              어떤 기능을 쓸지는 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {/* 대시보드 관리 = 원장·총괄만(saveOwnerSection이 같은 선을 서버에서 긋는다 — [[#77]]). 위임 계정엔 실데이터 미리보기 원본
          (원장 시점 전체 스냅샷)을 **읽지도 않는다** — 면을 감추는 게 아니라 조회 자체를 안 한다. */}
      {tab === "dashboard" ? (
        canReadAudit ? (
          <OwnerServerFace face="dashboard" />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">대시보드 관리는 원장만 바꿀 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              역할마다 운영실에 무엇을 보일지는 원장 계정에서 정합니다. 나머지 설정 면은 그대로 편집할 수 있습니다.
            </p>
          </div>
        )
      ) : null}
      {tab === "popups" ? <OwnerServerFace face="popups" /> : null}
      {/* 연동 = 켜진 연동만 내부 탭(슬랙 · makeedu · 구글 시트) — 원장 2026-09-28 "세로 스크롤이 너무 길어짐". */}
      {tab === "sheets" ? (
        <OwnerIntegrationsFace d={integrations!} settings={settings} sub={sp.sub} page={page} />
      ) : null}
      </fieldset>
      {/* 🔴 자체 판정을 하는 면은 위 fieldset **밖**에 둔다(SELF_GATED_TABS) — 그 fieldset은 학원 설정 쓰기 권한으로 잠기는데,
          이 면들의 버튼·입력은 다른 판정을 따른다. 안에 두면 권한이 있어도 잠긴다.
          · 데이터 정리: 버튼은 '관리자 도구' 권한(canManageData)으로 면이 직접 가린다.
          · 데이터 가져오기: 줄마다 그 메뉴의 전체 권한으로 버튼이 선다(올리기 주소도 같은 판정).
          · 감사로그: 고치는 것이 없다 — 조회 조건(기간·검색) 입력이 설정 읽기 전용 때문에 잠기면 안 된다.
          · 강사평가: 원장 게이트(직원 포트폴리오와 같은 문)를 지난 사람만 온다(위 redirect). 잠금은 면이 저장 액션과 같은 쓰기 판정으로 직접 한다. */}
      {tab === "evaluation" && showEvaluation ? <OwnerServerFace face="evaluation" /> : null}
      {tab === "contribution" && showContribution ? <OwnerServerFace face="contribution" /> : null}
      {tab === "data" ? (
        <div className="space-y-10">
          <OwnerServerFace face="data" />
        </div>
      ) : null}
      {tab === "import" ? <OwnerServerFace face="import" /> : null}
      {/* 🔴 주소를 직접 쳐도 열리지 않는다 — 면을 감추기만 하면 그건 게이트가 아니다([[#77]]).
          권한이 없으면 조회 자체를 안 한다(빈 표를 보여 주고 "기록 없음"이라 적으면 거짓말이 된다). */}
      {tab === "audit" ? (
        canReadAudit ? (
          <OwnerServerFace face="audit" />
        ) : (
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold">감사로그는 원장만 볼 수 있습니다</p>
            <p className="text-text-dim mt-1 text-sm">
              누가 무엇을 바꿨는지에는 급여·지출·환불처럼 민감한 기록이 함께 담겨 있어, 학원 설정을 위임받은
              계정으로도 열 수 없습니다. 나머지 관리 면(팝업 공지·데이터 정리·연동)은 그대로 쓸 수 있어요.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
