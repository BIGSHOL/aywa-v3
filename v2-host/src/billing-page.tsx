// 2.0 수납관리(app/(shell)/billing/page.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 판정 자료(권한 · 동기화 시각 · 면 자료)는
// /api/v2/billing(Docker 복사본, v2-screen-billing.mjs)이 내고 여기서는 page.tsx를 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(billing-page.swaps.json "page" — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-billing.mjs가 대조한다.
// 빠진 것: 창 제목(generateMetadata — 호스트 창 제목은 HOST_TITLE) · 아직 옮기지 않은 면(교재 · 지출 · 계산기 · 회차 확정 · 환불 · 강사 정산)은 '아직 지원하지 않는 기능'.
import { isModuleEnabled } from "@/lib/modules";
import { BillingContent, type BillingFaceData } from "./billing-content";
import { TextbooksFace } from "./billing-textbooks-face";
import { ExpensesPanel } from "./billing-expenses-panel";
import { RefundsFace } from "./billing-refunds-face";
import { CalculatorPanel } from "./billing-calculator-panel";
import { SessionTermsFace } from "./billing-session-terms-face";
import type { CalculatorFaceData, ExpensesPanelData, RefundsFaceData, SessionsFaceData, TextbooksFaceData } from "./billing-types";
import { HostFaceNotReady, HostNoAccess, HostRedirect } from "./billing-host-parts";
import type { MakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { MakeeduSyncBadge } from "./billing-sync-badge";
import { legacyVerificationHref } from "@/features/billing/session-terms/panel-href";

type Sp = Record<string, string | undefined>;
type BillingTab = "billing" | "textbooks" | "expenses" | "calculator" | "refunds" | "sessions" | "verify" | "payroll";

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks"
    ? "textbooks"
    : sp.tab === "expenses"
      ? "expenses"
      : sp.tab === "calculator"
        ? "calculator"
        : sp.tab === "refunds"
          ? "refunds"
          : sp.tab === "sessions"
            ? "sessions"
            : sp.tab === "verify"
              ? "verify"
              : sp.tab === "payroll"
                ? "payroll"
                : "billing";
}

// 교재 단가표는 교재 면과 수강료 계산기 면의 "내부탭"으로 들어가 두 곳에서 쓰인다(최상위 면 아님).
const FACES: Face[] = [
  { key: "billing", label: "수납", href: "/billing" },
  { key: "textbooks", label: "교재", href: "/billing?tab=textbooks" },
  { key: "expenses", label: "지출", href: "/billing?tab=expenses" },
  { key: "calculator", label: "수강료 계산기", href: "/billing?tab=calculator" },
  { key: "sessions", label: "회차 확정", href: "/billing?tab=sessions" },
  { key: "refunds", label: "환불 요청서", href: "/billing?tab=refunds" },
];

/** 회차 정산 모듈에 속한 면 — 모듈이 꺼지면 세우지 않는다. */
const SESSION_FACE_KEYS: ReadonlySet<string> = new Set(["sessions", "verify", "payroll"]);

// 강사 정산(급여)은 원장 전용 면 — master에게만 탭 노출(급여 PII).
const PAYROLL_FACE: Face = { key: "payroll", label: "강사 정산", href: "/billing?tab=payroll" };

/** /api/v2/billing — page.tsx가 서버에서 읽던 권한·설정·면 자료. */
export type BillingPageData = {
  access: { billing: boolean; payrollMenu: boolean; readSalary: boolean; manageBilling: boolean; writeBilling: boolean; owner: boolean };
  host: { disabledModules: readonly import("@/lib/modules").ModuleId[] };
  sync: Partial<Record<"invoices" | "textbook_checks", MakeeduSyncState | null>>;
  billing: BillingFaceData | null;
  textbooks: TextbooksFaceData | null;
  expenses: ExpensesPanelData | null;
  refunds: RefundsFaceData | null;
  calculator: CalculatorFaceData | null;
  sessions: SessionsFaceData | null;
};

export function BillingPage({ d, sp }: { d: BillingPageData; sp: Sp }) {
  const tab = resolveTab(sp);
  if (!(tab === "payroll" ? d.access.payrollMenu : d.access.billing)) return <HostNoAccess />;
  if (tab === "verify") return <HostRedirect to={legacyVerificationHref(sp)} />;
  // 강사 정산 탭은 원장(master)·총괄(super_admin)에게만 노출(감사 D6 — 총괄은 게이트 자동 통과). 그 밖이 URL로 오면 수납 면으로 폴백.
  const isMaster = d.access.readSalary;
  const canBilling = d.access.billing;
  // 회차 정산 모듈(회차 확정·시수 검증·강사 정산) — 꺼진 학원(새 학원 기본)은 면을 세우지 않고 주소도 수납으로 떨군다.
  // 침산은 켜져 있어 종전과 같다(2026-09-22 방향 B).
  const sessionOn = isModuleEnabled(d.host.disabledModules, "session_billing");
  const baseFaces = [...(canBilling ? FACES : []), ...(isMaster ? [PAYROLL_FACE] : [])];
  const faces = sessionOn ? baseFaces : baseFaces.filter((f) => !SESSION_FACE_KEYS.has(f.key));
  const effectiveTab =
    (tab === "payroll" && !isMaster) || (!sessionOn && SESSION_FACE_KEYS.has(tab)) ? "billing" : tab;
  if (effectiveTab !== "payroll" && !canBilling) return <HostNoAccess />;
  // 엑셀 가져오기(원장 2026-09-29) — 수납 면 = 청구서, 지출 면 = 지출. 일괄 작업이라 billing **full**만(올리기 주소도 같은 판정).
  // 버튼은 각 면의 검색 줄(ExcelMenu — 내보내기와 한 버튼)에 선다.
  const importKind = effectiveTab === "billing" ? "invoices" : effectiveTab === "expenses" ? "expenses" : null;
  const canImport = importKind !== null && d.access.manageBilling;

  return (
    <div className="space-y-4 print:space-y-0">
      {/* 동기화 시각은 면 탭과 **같은 줄 오른쪽 끝**(원장 2026-10-15 *"동기화 6시간 우상단 이것 때문에 여백낭비 … 같은행으로 맞춰서 여백 최소화"*) —
          예전엔 배지가 제 줄을 따로 써서 탭 위가 한 줄 비었다. 좁으면 배지가 탭 아래 줄로 접힌다(flex-wrap).
          경고 상세는 배지 아래에 띄운다(`overlay`) — 흐름 안에서 펼치면 상자 폭만큼 배지 칸이 넓어져 탭 아래 줄로 넘어갔다(누른 배지가 자리를 옮김). */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="min-w-0 max-w-full self-start">
          <FaceTabs faces={faces} active={effectiveTab} ariaLabel="수납관리 면 전환" />
        </div>
        {effectiveTab === "billing" || effectiveTab === "textbooks" ? (
          <div className="ml-auto">
            {/* 교재 면의 기본 하위탭은 '교재신청'이고 그걸 갱신하는 도메인은 textbook_checks다.
                예전엔 catalog(= sync-all 임포터 목록에 없는 수동 도메인)를 가리켜 배지 날짜가 한 달째
                굳어 있었고, 옆의 '지금 동기화'를 눌러도 영원히 안 바뀌었다(고장난 것처럼 보임). */}
            <MakeeduSyncBadge domain={effectiveTab === "billing" ? "invoices" : "textbook_checks"} overlay state={d.sync[effectiveTab === "billing" ? "invoices" : "textbook_checks"] ?? null} canManage={d.access.owner} />
          </div>
        ) : null}
      </div>
      {effectiveTab === "textbooks" ? (
        <TextbooksFace sp={sp} data={d.textbooks!} />
      ) : effectiveTab === "expenses" ? (
        <ExpensesPanel sp={sp} canImport={canImport} data={d.expenses!} />
      ) : effectiveTab === "calculator" ? (
        <CalculatorPanel sp={sp} data={d.calculator!} />
      ) : effectiveTab === "refunds" ? (
        <RefundsFace sp={sp} data={d.refunds!} />
      ) : effectiveTab === "sessions" ? (
        <SessionTermsFace period={sp.period} subject={sp.subject} q={sp.q} page={sp.page} only={sp.only} allocation={sp.allocation} confirmation={sp.confirmation} panel={sp.panel} status={sp.status} params={sp} data={d.sessions!} />
      ) : effectiveTab === "payroll" ? (
        <HostFaceNotReady />
      ) : (
        <BillingContent sp={sp} canImport={canImport} data={d.billing!} />
      )}
    </div>
  );
}
