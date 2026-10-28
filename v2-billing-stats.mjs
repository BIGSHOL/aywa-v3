// 2.0 화면 — 수납관리 · 수납 통계(/billing/stats · app/(shell)/billing/stats/page.tsx) — 2.0 서버 함수를 그대로(공용 러너).
//  · 게이트 = 2.0 requireAccess("billing") · 자료 = features/billing/stats/load.ts loadBillingStats(span | null, subject, 지출 기간)
//    — 인자는 2.0 page.tsx와 같은 함수로 주소에서(readPeriodParams · hasPeriodParams · monthSpanOf · EXPENSE_TREND_KEYS)
//  · 저장 = features/billing/stats/prefs-actions.ts(보기 모드 셋 — users.ui_prefs · 2.0 함수 그대로)
import { runV2Server } from './v2-server-runner.mjs';
import { v2ServerActions } from './v2-billing-sessions.mjs';

/** 수납 통계 화면이 읽는 주소 열쇠 — 2.0 PERIOD_KEYS + EXPENSE_TREND_KEYS(+ subject는 수납관리 열쇠에 이미 있다). */
export const STATS_KEYS = ['grain', 'month', 'from', 'to', 'span', 'ex', 'exMonth', 'exFrom', 'exTo', 'exSpan'];

let rulesPromise = null;
const loadStatsRules = importV2 => (rulesPromise ??= Promise.all([importV2('features/stats/period.ts'), importV2('features/billing/stats/expense-trend.ts')])
  .then(([period, expense]) => ({ period, expense })).catch(e => { rulesPromise = null; throw e; }));

export async function readBillingStats(t, importV2, viewer, sp) {
  const X = await loadStatsRules(importV2);
  const params = X.period.readPeriodParams(sp);
  const args = [X.period.hasPeriodParams(params) ? X.period.monthSpanOf(params.span) : null, typeof sp.subject === 'string' ? sp.subject : undefined,
    X.period.readPeriodParams(sp, X.expense.EXPENSE_TREND_KEYS)];
  const { results: [r] } = await runV2Server({ steps: [{ module: 'features/billing/stats/load.ts', fn: 'loadBillingStats', args }], actorId: viewer.id, tenantId: t, mode: 'read' });
  return r.value;
}

export const statsActions = v2ServerActions({ 'features/billing/stats/prefs-actions.ts': ['saveBillingStatsMode', 'saveExpenseStatsMode', 'saveTuitionHistoryView'] });
