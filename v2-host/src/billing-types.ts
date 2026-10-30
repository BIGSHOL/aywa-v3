// 2.0 수납관리 호스트 — /api/v2/billing이 내는 면 자료의 모양(2.0 서버 조회 함수의 반환 타입 그대로 · v2-billing-*.mjs와 짝).
import type { StudentOption, TextbookOrderRow, TextbookStats } from "@/features/billing/server/textbook-queries";
import type { CatalogOption, CatalogRow } from "@/features/billing/server/catalog-queries";
import type { BillingSettings, TenantSettings } from "@/features/owner/settings-types";
import type { TuitionCatalogOption, TuitionCatalogRow } from "@/features/billing/tuition-catalog";
import type { QuoteDetail, QuoteListItem } from "@/features/billing/server/tuition-quote-queries";
import type { ExpenseRow, ExpenseSummary } from "@/features/billing/server/expense-queries";
import type { RefundListRow } from "@/features/billing/server/refund-queries";
import type { SessionTermsView } from "@/features/billing/session-terms/server/queries";
import type { getSessionVerificationView } from "@/features/billing/session-terms/server/verification-queries";
import type { SplitsSnapshotStatus } from "@/features/billing/session-terms/server/splits-queries";
import type { SeatShareSummary } from "@/features/attendance/server/seat-share-summary";
import type { getTeacherTuitionView } from "@/features/payroll/server/tuition-view";
import type { ClassSalaryRow } from "@/features/payroll/server/class-salary-queries";

/** textbooks-panel.tsx가 서버에서 받던 값 — getTextbookOrdersPage · getTextbookStats · getStudentOptions · getCatalogOptions · 학원 설정(이름 · 로고 · 계좌). */
export type TextbooksPanelData = {
  page: { rows: TextbookOrderRow[]; total: number };
  stats: TextbookStats;
  students: StudentOption[];
  catalog: CatalogOption[];
  settings: { profile: { name: string; logoUrl: string | null }; billing: BillingSettings };
};

/** catalog-panel.tsx — getCatalogPage · getCatalogStats. */
export type CatalogPanelData = { page: { rows: CatalogRow[]; total: number }; stats: { total: number; active: number } };

/** expenses-panel.tsx — getExpensesForMonth(이 달 전체) · getExpenseMonths + summarizeExpenses(이 달 전체 기준 — 2.0 함수 그대로). */
export type ExpensesPanelData = { rows: ExpenseRow[]; months: string[]; summary: ExpenseSummary };

/** refunds-face.tsx — getRefundRequests(전건 · 작성 최신순) · 수납 쓰기(새 환불 요청서 단추). */
export type RefundsFaceData = { all: RefundListRow[]; canWrite: boolean };

/** tuition-prices-panel.tsx — getTuitionCatalogPage · getTuitionCatalogStats · getTuitionCategoryOptions. */
export type TuitionPricesData = { page: { rows: TuitionCatalogRow[]; total: number }; stats: { total: number; active: number; unset: number }; categories: string[] };
/** saved-quotes-panel.tsx — getQuotesPage · getStudentOptions. */
export type SavedQuotesData = { page: { rows: QuoteListItem[]; total: number }; students: StudentOption[] };
/** calculator-panel.tsx — 내부탭(csub)이 고르는 쪽만 · settings = 화면이 읽는 학원 설정 칸(로고는 비움). */
export type CalculatorFaceData = {
  sub: string;
  settings: Pick<TenantSettings, "billing" | "operations" | "preset"> & { profile: { name: string; logoUrl: string | null }; modules: { disabled: TenantSettings["modules"]["disabled"] } };
  calculator: { catalog: TuitionCatalogOption[]; textbooks: CatalogOption[]; initial: QuoteDetail | null } | null;
  prices: TuitionPricesData | null;
  catalog: CatalogPanelData | null;
  quotes: SavedQuotesData | null;
};

/** session-terms-face.tsx · session-verification-face.tsx — 2.0 서버 함수(getSessionTermsView · loadSeatShareSummary | getSessionVerificationView · getTeacherSplitsStatus) 결과 그대로. */
export type SessionsFaceData = {
  panel: "confirm" | "verify";
  period: string;
  settings: Pick<TenantSettings, "operations">;
  confirm: { view: SessionTermsView; seatShare: SeatShareSummary | null } | null;
  verification: { view: Awaited<ReturnType<typeof getSessionVerificationView>>; savedSplits: SplitsSnapshotStatus | null } | null;
};

/** teacher-settlement-face.tsx — 2.0 canReadSalary · canManageSalary · getTeacherTuitionView · getClassSalaryRows · canViewPayslipNow 결과(열람 게이트를 못 지나면 view · classRows = null). */
export type PayrollFaceData = {
  period: string; canRead: boolean; canEdit: boolean; canPayslip: boolean; pending?: boolean;
  view: Awaited<ReturnType<typeof getTeacherTuitionView>> | null; classRows: ClassSalaryRow[] | null;
};

/** textbooks-face.tsx — 내부탭(목록 | 교재 단가표)이 고르는 쪽만 실린다. */
export type TextbooksFaceData = { list: TextbooksPanelData | null; catalog: CatalogPanelData | null };
