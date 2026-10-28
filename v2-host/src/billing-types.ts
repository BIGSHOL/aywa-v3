// 2.0 수납관리 호스트 — /api/v2/billing이 내는 면 자료의 모양(2.0 서버 조회 함수의 반환 타입 그대로 · v2-billing-*.mjs와 짝).
import type { StudentOption, TextbookOrderRow, TextbookStats } from "@/features/billing/server/textbook-queries";
import type { CatalogOption, CatalogRow } from "@/features/billing/server/catalog-queries";
import type { BillingSettings } from "@/features/owner/settings-types";
import type { ExpenseRow, ExpenseSummary } from "@/features/billing/server/expense-queries";

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

/** textbooks-face.tsx — 내부탭(목록 | 교재 단가표)이 고르는 쪽만 실린다. */
export type TextbooksFaceData = { list: TextbooksPanelData | null; catalog: CatalogPanelData | null };
