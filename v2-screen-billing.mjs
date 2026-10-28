// 2.0 화면 — 수납관리(V2-SCREENS.md 대상 `billing`). 그리기는 2.0의 실제 React 부품(v2-host/src/billing*.tsx),
// 이 모듈은 2.0 app/(shell)/billing/page.tsx와 각 면(서버 컴포넌트)이 서버에서 하던 조회를 Docker 복사본에서 같은 결과로 만든다.
//  · page.tsx: 면 고르기(resolveTab) · 권한(requireAccess billing|payroll_settings · canReadSalary · canAccessTenant · canManageTenant) ·
//    회차 정산 모듈(session_billing) · 동기화 배지(MakeeduSyncBadge — getMakeeduSyncState + 학원 설정 열람 권한)
//  · 수납 면(billing-content.tsx): getInvoicesForPeriod · getAvailablePeriods · getStudentOptions · getMakeeduSyncState("invoices") · canWriteTenant
//  · 교재 면(textbooks-face.tsx): 목록(textbooks-panel.tsx) · 교재 단가표(catalog-panel.tsx) — v2-billing-textbooks.mjs
//  · 지출 면(expenses-panel.tsx) · 지출결의서 상세(expenses/[id]/page.tsx) — v2-billing-expenses.mjs
//  · 환불 요청서(refunds-face.tsx · refunds/new · refunds/[id]) — v2-billing-refunds.mjs(restricted 문서라 보는 사람 신분 + RLS로만)
//  · 수강료 계산기(calculator-panel.tsx · tuition-prices-panel.tsx · saved-quotes-panel.tsx · 교재 단가표는 catalog-panel 같은 것) — v2-billing-calculator.mjs
//  · 회차 확정(session-terms-face.tsx · session-verification-face.tsx) — v2-billing-sessions.mjs(2.0 서버 함수 그대로 · 공용 러너)
//  · 강사 정산(teacher-settlement-face.tsx) — v2-billing-payroll.mjs(2.0 서버 함수 그대로 · 급여 열람 게이트 = 2.0 canReadSalary)
// 사람마다 보이는 것이 다르다 — '보는 사람'을 고르고(운영자 계정 제외 · 원장 먼저) 그 사람의 권한 표로 2.0과 같게 낸다(v2-billing-common.mjs).
// 🔴 급여(강사 정산)는 급여 열람 게이트(payroll_settings · 급여 기능 켜짐)를 지난 사람에게만 싣는다.
//
// 2.0 서버 액션 ↔ actions 대응표(이름·인자·반환 = 2.0 그대로, 저장하는 사람 = 보는 사람):
//  features/billing/server/actions.ts                 createInvoice(_prev, fd) → CreateInvoiceState
//  features/billing/server/manual-invoice-actions.ts  markManualInvoicePaid(id, method?) · voidManualInvoice(id) → { ok?, error? }
//  features/billing/server/textbook-actions.ts        toggleTextbookCheck(_prev, fd{id, field, checked}) · createTextbookOrder(_prev, fd) ·
//                                                      updateTextbookOrder(_prev, fd{id,…}) · deleteTextbookOrder(_prev, fd{id}) → TextbookState
//  features/billing/server/expense-actions.ts         createExpense · updateExpense · deleteExpense · toggleExpenseApproval · duplicateExpense ·
//                                                      setExpenseReceiptType(_prev, fd) → ExpenseState (증빙 파일 올리기·열기·지우기 = 받지 않음)
//  features/billing/server/catalog-actions.ts         createCatalogItem · updateCatalogItem · deleteCatalogItem · toggleCatalogActive(_prev, fd) → { ok?, error? }
//  features/billing/server/tuition-catalog-actions.ts createTuitionItem · updateTuitionItem · deleteTuitionItem · setTuitionPricingMode · toggleTuitionActive
//  features/billing/server/tuition-quote-actions.ts   saveTuitionQuote(_prev, fd) → { ok, id } · deleteTuitionQuote(_prev, fd)
//  features/billing/session-terms/server/*.ts      회차 확정 저장 15개 = 2.0 서버 함수 그대로(공용 러너 write · v2-billing-sessions.mjs SESSION_WRITES) ·
//                                                      읽기 셋(getReceiptAllocation · getMoneyCarryoverOptions · getSessionTermDeletePreview) = GET ?call=&args=
//  features/billing/server/refund-actions.ts          saveRefundRequest(_prev, fd) → RefundActionState · deleteRefundRequest(id) → { ok?, error? } ·
//                                                      loadRefundStudentOptions() · loadRefundPrefill(studentId, months) = 읽기(GET ?refundOptions=1 · ?prefill=&months=)
//  features/billing/server/textbook-notice-actions.ts  saveMyTextbookMent(text) → { ok } · loadMyTextbookMent() = 읽기(GET ?ment=1 → { ment })
//
// 호스트에 붙일 때(v2-host/src/billing.tsx · billing-page.tsx · billing-sync-badge.tsx):
//  · Next 전용: next/link · next/navigation(redirect — verify 면 → 회차 확정의 대조 패널) — shims.
//  · 서버 컴포넌트를 옮긴 것: page.tsx 본문 · billing-content.tsx 본문 · makeedu-sync-badge.tsx(조회 두 줄만 props로).
//  · 서버 액션 모듈(부품이 부르는 것): features/billing/server/actions.ts(createInvoice) · manual-invoice-actions.ts(markManualInvoicePaid · voidManualInvoice) ·
//    textbook-actions.ts · textbook-notice-actions.ts(prepareTextbookNotice · sendTextbookNotice = 학부모 발송 — 받지 않는다) · catalog-actions.ts(단가표 — 다음 단계).
//  · 서버 컴포넌트를 옮긴 것(교재 면): textbooks-face.tsx · textbooks-panel.tsx · catalog-panel.tsx(billing-textbooks.swaps.json).
//  · 바깥 링크: 엑셀 내보내기 `/api/exports/billing` — 호스트 틀이 막는다(연습 화면 미지원).
import { UUID } from './v2-mcs-core.mjs';
import { loadBillingRules, readSettings, readBillingViewers, billingEditorsOf, readSyncState, resolveBillingTab } from './v2-billing-common.mjs';
import { readInvoicesForPeriod, readAvailablePeriods, readStudentOptions } from './v2-billing-invoices.mjs';
import { readTextbooksFace, loadMyTextbookMent, textbookFaceActions } from './v2-billing-textbooks.mjs';
import { readExpensesFace, readExpenseById, loadExpenseRules, expenseActions } from './v2-billing-expenses.mjs';
import { readCalculatorFace, calculatorActions } from './v2-billing-calculator.mjs';
import { invoiceActions } from './v2-billing-invoice-save.mjs';
import { readSessionsFace, sessionActions, readSessionCall } from './v2-billing-sessions.mjs';
import { readPayrollFace, payrollActions } from './v2-billing-payroll.mjs';
import { readRefundRequests, readRefundById, loadRefundRules, loadRefundStudentOptions, loadRefundPrefill, refundActions } from './v2-billing-refunds.mjs';

const ID = 'billing';
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const WORD = /^[a-z0-9_-]{1,40}$/;
/** 면들이 읽는 주소 열쇠(2.0 page.tsx · 각 면의 sp.*) — 지금 쓰지 않는 열쇠도 받아 둔다(주소가 400이 되지 않게). */
const PARAMS = {
  viewer: UUID, v2path: /^\/billing(?:\/[a-z0-9-]{1,40}){0,2}$/,
  tab: WORD, period: /^[0-9-]{1,10}$/, q: /^[^\u0000-\u001f]{0,100}$/, sort: WORD, desc: /^[01]$/, page: /^\d{1,4}$/,
  overdue: /^1$/, missing: /^1$/, subject: WORD, only: /^[a-z0-9_,-]{1,80}$/, allocation: WORD, confirmation: WORD, panel: WORD, status: WORD,
  active: WORD, cactive: WORD, cat: WORD, cpage: /^\d{1,4}$/, cpmode: WORD, csub: WORD, grade: /^[^\u0000-\u001f]{0,40}$/,
  hm: /^[0-9-]{1,10}$/, hy: /^\d{4}$/, qid: UUID, qpage: /^\d{1,4}$/, tsub: WORD,
  // 교재 다이얼로그가 열 때 읽는 2.0 loadMyTextbookMent(읽기라 GET) — 답은 { ment }.
  ment: /^1$/,
  // 환불 요청서 자동입력이 부르는 2.0 읽기 둘(loadRefundStudentOptions · loadRefundPrefill) — 읽기라 GET.
  refundOptions: /^1$/, prefill: UUID, months: /^(1|2|3|6|12|all)$/,
  // 회차 확정의 읽기 셋(배분 창 · 이월 선택지 · 지우기 미리보기) — 2.0 서버 함수 이름 · 인자(JSON 배열).
  call: /^[A-Za-z]{1,40}$/, args: /^[^\u0000-\u001f]{0,400}$/,
};

export const screen = {
  id: ID, label: '수납관리', order: 9,
  params: PARAMS,
  actions: { ...invoiceActions, ...textbookFaceActions, ...expenseActions, ...refundActions, ...calculatorActions, ...sessionActions, ...payrollActions },
  paramMax: { args: 400 },
  load: async ({ sql, params: sp, tenantId: t, importV2 }) => {
    const R = await loadBillingRules(importV2);
    const env = await readSettings(sql, t, R), viewers = await readBillingViewers(sql, t, R, env);
    const viewer = viewers.find(v => v.id === sp.viewer) ?? viewers[0] ?? null;
    if (sp.ment) return { ment: await loadMyTextbookMent(sql, t, importV2, viewer) };
    if (sp.call) return { value: await readSessionCall(sql, t, importV2, viewer, sp.call, sp.args) };
    if (sp.refundOptions) return loadRefundStudentOptions(sql, viewer, await loadRefundRules(importV2));
    if (sp.prefill) return loadRefundPrefill(sql, viewer, await loadRefundRules(importV2), sp.prefill, sp.months === 'all' ? null : Number(sp.months ?? 3));
    const common = { editors: billingEditorsOf(viewers), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      host: { operations: env.operations, disabledModules: env.disabled } };
    if (!viewer) return { ...common, route: 'none' };
    // page.tsx 게이트 — 화면(호스트)이 같은 순서로 판정한다(requireAccess · canReadSalary · canAccessTenant · canManageTenant).
    const access = {
      billing: viewer.billing !== 'none', payrollMenu: viewer.payroll !== 'none',
      // canReadSalary = 급여 기능 켜짐 + payroll_settings 접근(꺼진 기능은 위 캡에서 이미 '없음').
      readSalary: R.modules.isModuleEnabled(env.disabled, 'payroll') && viewer.payroll !== 'none',
      manageBilling: viewer.billing === 'full', writeBilling: viewer.billing === 'full' || viewer.billing === 'scoped',
      // MakeeduSyncBadge의 '연동 설정 열기' 링크 = 학원 설정 접근.
      owner: viewer.owner !== 'none',
    };
    // 하위 주소 — 지출결의서 상세(2.0 expenses/[id]/page.tsx: requireAccess('billing') → getExpenseById → 없으면 notFound).
    const expenseId = /^\/billing\/expenses\/([0-9a-f-]{36})$/.exec(sp.v2path ?? '')?.[1];
    if (expenseId) {
      if (!access.billing) return { ...common, route: 'page', access, page: 'noAccess' };
      const X = await loadExpenseRules(importV2), expense = await readExpenseById(sql, t, X, expenseId);
      return { ...common, route: 'page', access, page: expense ? 'expense' : 'notFound', expense };
    }
    // 하위 주소 — 환불 요청서 작성(refunds/new: 수납 쓰기가 아니면 목록으로) · 보기(refunds/[id]: 없으면 notFound).
    const refundPath = /^\/billing\/refunds\/(new|[0-9a-f-]{36})$/.exec(sp.v2path ?? '')?.[1];
    if (refundPath) {
      if (!access.billing) return { ...common, route: 'page', access, page: 'noAccess' };
      if (refundPath === 'new') return access.writeBilling ? { ...common, route: 'page', access, page: 'refundNew' } : { ...common, route: 'page', access, page: 'redirect', to: '/billing?tab=refunds' };
      const refund = await readRefundById(sql, viewer, await loadRefundRules(importV2), refundPath);
      return { ...common, route: 'page', access, page: refund ? 'refund' : 'notFound', refund, canWrite: access.writeBilling };
    }
    const tab = resolveBillingTab(sp.tab), sessionOn = R.modules.isModuleEnabled(env.disabled, 'session_billing');
    const effectiveTab = (tab === 'payroll' && !access.readSalary) || (!sessionOn && ['sessions', 'verify', 'payroll'].includes(tab)) ? 'billing' : tab;
    const denied = !(tab === 'payroll' ? access.payrollMenu : access.billing) || (effectiveTab !== 'payroll' && !access.billing);
    if (denied) return { ...common, route: 'page', access, sync: {}, billing: null, textbooks: null, expenses: null, refunds: null, calculator: null, sessions: null, payroll: null };
    // 동기화 배지(수납 · 교재 면만) — 면이 고르는 도메인.
    const domain = effectiveTab === 'billing' ? 'invoices' : effectiveTab === 'textbooks' ? 'textbook_checks' : null;
    const sync = domain ? { [domain]: await readSyncState(sql, t, R, env, domain) } : {};
    let billing = null, textbooks = null, expenses = null, refunds = null, calculator = null, sessions = null, payroll = null;
    if (effectiveTab === 'billing') {
      // billing-content.tsx — period = sp.period ?? 이번 달(2.0 currentPeriod) · sort = sp.sort ?? 'status' · desc = sp.desc === '1'.
      const period = sp.period ?? R.calc.currentPeriod();
      const [monthRows, periods, students] = await Promise.all([
        PERIOD.test(period) ? readInvoicesForPeriod(sql, t, R, { period, sort: sp.sort ?? 'status', desc: sp.desc === '1' }) : [],
        readAvailablePeriods(sql, t, R), readStudentOptions(sql, t),
      ]);
      billing = { monthRows, periods, students, syncState: sync.invoices ?? null, canWriteBilling: access.writeBilling };
    } else if (effectiveTab === 'textbooks') textbooks = await readTextbooksFace(sql, t, R, importV2, sp);
    else if (effectiveTab === 'expenses') expenses = await readExpensesFace(sql, t, importV2, sp);
    // refunds-face.tsx — 전건(작성 최신순) · 월·쪽은 화면이 2.0 본문으로 고른다 · canWrite = 수납 쓰기.
    else if (effectiveTab === 'refunds') refunds = { all: await readRefundRequests(sql, viewer, await loadRefundRules(importV2)), canWrite: access.writeBilling };
    else if (effectiveTab === 'calculator') calculator = await readCalculatorFace(sql, t, R, env, importV2, sp);
    // 회차 확정 = 2.0 서버 함수 그대로(공용 러너) — 확정·배분 | 청구 시수 대조.
    else if (effectiveTab === 'sessions') sessions = await readSessionsFace(t, R, env, viewer, sp);
    // 강사 정산 = 2.0 서버 함수 그대로(급여 열람 게이트를 못 지나면 자료 없음).
    else if (effectiveTab === 'payroll') payroll = await readPayrollFace(t, R, viewer, sp);
    return { ...common, route: 'page', access, sync, billing, textbooks, expenses, refunds, calculator, sessions, payroll };
  },
};
