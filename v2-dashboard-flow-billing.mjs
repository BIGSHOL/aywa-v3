// 확장 추세 지표 — 운영실 '6개월 청구 · 수납'(원장 10-28 "추세가 있는 운영실 위젯도 확장 추세로"). 형식 = trend-metrics.mjs 맨 위 주석.
// 계산은 운영실 billing 영역과 같은 함수다(v2-dashboard-billing.mjs `loadBillingMonths` = 2.0 loadBillingMonths → summarizeInvoices) — 월 창 값 = 카드 값.
// · 지표 둘 = 카드가 보여 주는 숫자: 실청구액(막대 — 청구 − 할인) · 수납률(머리 줄 — 수납 ÷ 실청구). 수납액은 수납률의 분자로 함께 실린다.
// · 창 규칙 — 청구는 청구월(period) 단위다. 2.0 수납 통계 화면도 달 단위만 둔다(billing/stats/load.ts "일별·구간은 이 화면에 없다 — 결제일이
//   대표 날짜 하나라 하루로 나누면 왜곡"). 그래서
//     월 창 = 그 청구월 하나(이번 달 창은 오늘까지지만 청구월은 통째 — 운영실 카드와 같은 값)
//     연 창 = 그해 1월부터 창 끝 달까지 청구월의 합(올해는 이번 달까지 — 이미 나간 다음 달 청구는 2.0 추이처럼 넣지 않는다)
//     일·주 창 = 청구월로 가를 수 없어 null('기록 없음') — 지표에 `grains: ['month', 'year']`를 달아 둔다(화면이 이 단위만 내도록 쓸 수 있다).
// · 과목별 = 2.0 청구 항목별 과목 판정(billing-subject.ts classifyInvoice → summarizeSubjectBilling — 운영실 과목 관리자 값과 같은 판정).
//   과목으로 못 가른 줄은 '과목 모름' 줄(키 `unknown`). 줄 금액은 청구서 줄의 합이라 2.0은 머리 합계와 조금 다를 수 있다고 적었다 —
//   복사본은 머리와 줄이 모두 같아 줄의 합 = 전체다(verify가 본다).
// · since = 청구가 지점을 덮기 시작한 달의 1일 — 2.0 record-coverage.ts와 같은 조건(최근 36개월 수업료 청구 건수 → coverageStartFromCounts).
//   그 전 달은 창에 넣지 않는다(연 창도 그 달부터 더한다).
// 2.0과 다른 점: 수납률 값 — 2.0 paymentRate는 100에서 자르고(수납 > 실청구여도 100) 미수가 남으면 100으로 적지 않는다(paymentRateDisplay).
//   추세 화면은 [수납, 실청구]를 그대로 나눠 소수 첫째 자리로 적는다. 복사본에서 학원 전체 창은 수납이 실청구를 넘지 않고, 과목 줄은
//   2026-07 '과목 모름'만 1만 원 넘는다(100.0%로 적힌다 — verify가 진단으로 적는다).
// 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate } from './v2-onescreen-roster.mjs';
import { loadBillingMonths } from './v2-dashboard-billing.mjs';
import { consts } from './v2-student-kpis.mjs';

const MODULES = { coverage: 'features/dashboard/overview/coverage-rules.ts', subject: 'features/dashboard/overview/billing-subject.ts', subjects: 'features/owner/subjects.ts' };
let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}

/** 과목으로 못 가른 청구 줄의 키 · 이름(2.0 billing-subject.ts '과목 모름'). */
export const UNKNOWN_SUBJECT = Object.freeze({ key: 'unknown', label: '과목 모름' });
const DIMS = Object.freeze([{ id: 'subject', label: '과목별' }]);
const lastDayOf = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * 창마다 그 창이 세는 청구월(오름차순) — 단위는 첫 창(가장 오래된 창은 잘리지 않은 온전한 창)의 모양으로 안다:
 * 하루면 일, 그해 1/1~12/31이면 연, 그달 1일~말일이면 월. 월·연 창 = 창의 첫 달~끝 달 가운데 `sinceMonth` 이후, 그 밖(일·주)과 남는 달이 없는 창 = null.
 */
export function billingMonthsOf(windows, sinceMonth, shiftMonth) {
  const first = windows[0];
  const grain = !first ? null : first.from === first.to ? 'day' : /-01-01$/.test(first.from) && first.to === `${first.from.slice(0, 4)}-12-31` ? 'year'
    : /-01$/.test(first.from) && first.to === lastDayOf(first.from.slice(0, 7)) ? 'month' : null;
  if (grain !== 'month' && grain !== 'year') return windows.map(() => null);
  return windows.map((w) => {
    const months = [];
    for (let m = w.from.slice(0, 7); m <= w.to.slice(0, 7); m = shiftMonth(m, 1)) if (!sinceMonth || m >= sinceMonth) months.push(m);
    return months.length ? months : null;
  });
}

/** 2.0 computeRecordCoverage의 billingFrom — 최근 36개월(2.0 COVERAGE_WINDOW_MONTHS) 수업료 청구(무효·환불 제외)의 달마다 건수 → coverageStartFromCounts. */
async function billingSince(sql, t, R, asOf) {
  const C = R.coverage, thisMonth = asOf.slice(0, 7), windowStart = C.shiftMonth(thisMonth, -((await consts()).coverage - 1));
  const rows = await sql`select period, count(*)::int n from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded')
    and period >= ${windowStart} and period <= ${thisMonth} group by period`;
  const from = C.coverageStartFromCounts(new Map(rows.filter((r) => /^\d{4}-\d{2}$/.test(r.period ?? '')).map((r) => [r.period, r.n])), thisMonth);
  return from ? `${from}-01` : null;
}

// 같은 복사본·같은 달이면 같은 재료 — 두 지표·필터 전환이 다시 읽지 않게 기억한다(v2-screen-trend.mjs의 memo와 같은 규칙: 실패는 기억하지 않는다).
const memo = new Map();
const remember = (key, make) => {
  if (!memo.has(key)) { if (memo.size > 20) memo.delete(memo.keys().next().value); memo.set(key, make().catch((e) => { memo.delete(key); throw e; })); }
  return memo.get(key);
};

/**
 * 청구월마다 { collected, net } — 학원 전체(`academy` = 운영실 카드와 같은 청구서 머리 값)와 과목별(`bySubject` = 청구 줄의 과목 판정).
 * 과목 모름 줄도 2.0 summarizeSubjectBilling을 같이 거치게 키를 붙여 넘긴다(완납·부분납 판정이 같은 함수).
 */
async function billingMaterial(sql, t, importV2, R, months) {
  const { academy, classified } = await loadBillingMonths({ sql, tenantId: t, importV2, months, withSubjects: true });
  const fold = (s) => ({ collected: s.totalCollected, net: s.totalBilled - s.totalDiscount });
  const keyed = classified.map((inv) => ({ ...inv, lines: inv.lines.map((l) => (l.subject === null ? { ...l, subject: UNKNOWN_SUBJECT.key } : l)) }));
  const keys = [...new Set(keyed.flatMap((inv) => inv.lines.map((l) => l.subject)))];
  const bySubject = new Map(keys.map((key) => [key, new Map(R.subject.summarizeSubjectBilling(keyed, months, (s) => s === key).map((s) => [s.period, fold(s)]))]));
  return { academy: new Map(academy.map((s) => [s.period, fold(s)])), bySubject };
}

async function billingSeries({ sql, asOf, tenantId: t, importV2, windows, filter }, point) {
  const gate = queryGate(sql), R = await rules(importV2);
  const since = await billingSince(gate, t, R, asOf);
  const perWindow = billingMonthsOf(windows, since?.slice(0, 7) ?? null, R.coverage.shiftMonth);
  const months = [...new Set(perWindow.flat().filter(Boolean))].sort();
  const empty = { academy: new Map(), bySubject: new Map() };
  const data = months.length ? await remember(`${t}|${asOf}|${months.join(',')}`, () => billingMaterial(gate, t, importV2, R, months)) : empty;
  // 창 값 = 그 창 청구월의 합 → 지표의 [분자, 분모]. 셀 청구월이 없는 창은 null.
  const series = (byMonth) => perWindow.map((ms) => (ms ? point(ms.reduce((a, m) => {
    const v = byMonth.get(m) ?? { collected: 0, net: 0 };
    return { collected: a.collected + v.collected, net: a.net + v.net };
  }, { collected: 0, net: 0 })) : null));
  // 줄 = 과목(설정 차례 → 그 밖 키 → 과목 모름). 이름은 학원 설정 과목 이름(2.0 labelOf — 모르는 키는 옛 이름·키 그대로).
  const stored = (await gate`select data->'operations'->'subjects' s from public.tenant_settings where tenant_id=${t}`)[0]?.s;
  const subjects = Array.isArray(stored) ? stored : [], { labelOf } = R.subjects.buildSubjectMaps(subjects);
  const order = (k) => (k === UNKNOWN_SUBJECT.key ? 2e9 : subjects.findIndex((s) => s.key === k) + 1 || 1e9);
  const keys = [...data.bySubject.keys()].filter((k) => !filter || (filter.dim === 'subject' && k === filter.key)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const rows = keys.map((key) => ({ key, label: key === UNKNOWN_SUBJECT.key ? UNKNOWN_SUBJECT.label : labelOf(key), points: series(data.bySubject.get(key)) }));
  const total = filter?.dim === 'subject' ? series(data.bySubject.get(filter.key) ?? new Map()) : series(data.academy);
  return { ...(since ? { since } : {}), total, rows };
}

const metric = (id, label, unit, point) => Object.freeze({
  id, label, group: '운영실', unit, better: 'up', dims: DIMS, grains: Object.freeze(['month', 'year']),
  series: (args) => billingSeries(args, point),
});
/** 운영실 '6개월 청구 · 수납' 카드의 두 숫자 — 막대(실청구액 = 청구 − 할인, 점 [금액, 1]) · 머리 줄(수납률 = 수납 ÷ 실청구, 점 [수납, 실청구]). */
export const BILLING_TREND_METRICS = Object.freeze([
  metric('billing-amount', '실청구액', '원', (v) => [v.net, 1]),
  metric('billing-rate', '수납률', '%', (v) => [v.collected, v.net]),
]);
