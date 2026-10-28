// 2.0 화면 — 수납관리(V2-SCREENS.md 대상 `billing`). 그리기는 2.0의 실제 React 부품(v2-host/src/billing*.tsx),
// 이 모듈은 2.0 app/(shell)/billing/page.tsx와 각 면(서버 컴포넌트)이 서버에서 하던 조회를 Docker 복사본에서 같은 결과로 만든다.
//  · page.tsx: 면 고르기(resolveTab) · 권한(requireAccess billing|payroll_settings · canReadSalary · canAccessTenant · canManageTenant) ·
//    회차 정산 모듈(session_billing) · 동기화 배지(MakeeduSyncBadge — getMakeeduSyncState + 학원 설정 열람 권한)
//  · 수납 면(billing-content.tsx): getInvoicesForPeriod · getAvailablePeriods · getStudentOptions · getMakeeduSyncState("invoices") · canWriteTenant
//  · 교재 면(textbooks-face.tsx): 목록(textbooks-panel.tsx) · 교재 단가표(catalog-panel.tsx) — v2-billing-textbooks.mjs
//  · 다른 면(지출 · 수강료 계산기 · 회차 확정 · 환불 요청서 · 강사 정산)은 다음 단계 — 지금은 '아직 지원하지 않는 기능'.
// 사람마다 보이는 것이 다르다 — '보는 사람'을 고르고(운영자 계정 제외 · 원장 먼저) 그 사람의 권한 표로 2.0과 같게 낸다(v2-billing-common.mjs).
// 🔴 급여(강사 정산)는 급여 열람 게이트(payroll_settings · 급여 기능 켜짐)를 지난 사람에게만 싣는다.
//
// 2.0 서버 액션 ↔ actions 대응표(이름·인자·반환 = 2.0 그대로, 저장하는 사람 = 보는 사람):
//  features/billing/server/textbook-actions.ts        toggleTextbookCheck(_prev, fd{id, field, checked}) · createTextbookOrder(_prev, fd) ·
//                                                      updateTextbookOrder(_prev, fd{id,…}) · deleteTextbookOrder(_prev, fd{id}) → TextbookState
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
};

export const screen = {
  id: ID, label: '수납관리', order: 9,
  params: PARAMS,
  actions: { ...textbookFaceActions },
  load: async ({ sql, params: sp, tenantId: t, importV2 }) => {
    const R = await loadBillingRules(importV2);
    const env = await readSettings(sql, t, R), viewers = await readBillingViewers(sql, t, R, env);
    const viewer = viewers.find(v => v.id === sp.viewer) ?? viewers[0] ?? null;
    if (sp.ment) return { ment: await loadMyTextbookMent(sql, t, importV2, viewer) };
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
    const tab = resolveBillingTab(sp.tab), sessionOn = R.modules.isModuleEnabled(env.disabled, 'session_billing');
    const effectiveTab = (tab === 'payroll' && !access.readSalary) || (!sessionOn && ['sessions', 'verify', 'payroll'].includes(tab)) ? 'billing' : tab;
    const denied = !(tab === 'payroll' ? access.payrollMenu : access.billing) || (effectiveTab !== 'payroll' && !access.billing);
    if (denied) return { ...common, route: 'page', access, sync: {}, billing: null, textbooks: null };
    // 동기화 배지(수납 · 교재 면만) — 면이 고르는 도메인.
    const domain = effectiveTab === 'billing' ? 'invoices' : effectiveTab === 'textbooks' ? 'textbook_checks' : null;
    const sync = domain ? { [domain]: await readSyncState(sql, t, R, env, domain) } : {};
    let billing = null, textbooks = null;
    if (effectiveTab === 'billing') {
      // billing-content.tsx — period = sp.period ?? 이번 달(2.0 currentPeriod) · sort = sp.sort ?? 'status' · desc = sp.desc === '1'.
      const period = sp.period ?? R.calc.currentPeriod();
      const [monthRows, periods, students] = await Promise.all([
        PERIOD.test(period) ? readInvoicesForPeriod(sql, t, R, { period, sort: sp.sort ?? 'status', desc: sp.desc === '1' }) : [],
        readAvailablePeriods(sql, t, R), readStudentOptions(sql, t),
      ]);
      billing = { monthRows, periods, students, syncState: sync.invoices ?? null, canWriteBilling: access.writeBilling };
    } else if (effectiveTab === 'textbooks') textbooks = await readTextbooksFace(sql, t, R, importV2, sp);
    return { ...common, route: 'page', access, sync, billing, textbooks };
  },
};
