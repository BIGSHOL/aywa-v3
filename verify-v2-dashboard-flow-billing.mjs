// 확장 추세 '6개월 청구 · 수납' 지표 시험 — node --test experiments/owner-concept/verify-v2-dashboard-flow-billing.mjs
// ① 지표 모양(trend-metrics.mjs 형식) ② 창 규칙(월 = 그 청구월 · 연 = 그해 since 이후 청구월의 합 · 일·주 = 없음 — 화면의 실제 창으로)
// ③ 월 창 = 운영실 billing 영역(최근 6개월) 값 ④ 과목 줄의 합 = 전체(두 지표 · 모든 창) · 과목 필터 = 그 줄
// ⑤ 전체 값 = 시험 쪽에서 따로 적은 SQL(청구서 머리 · 무효 제외) ⑥ since = 수업료 청구가 있는 달의 1일. 복사본 DB가 없으면 ③~⑥은 건너뛴다. 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BILLING_TREND_METRICS, UNKNOWN_SUBJECT, billingMonthsOf } from './v2-dashboard-flow-billing.mjs';
import { BILLING_AREAS } from './v2-dashboard-billing.mjs';
import { windowsFor } from './v2-screen-trend.mjs';
import { importV2 } from './v2-bridge.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const shiftMonth = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const [AMOUNT, RATE] = ['billing-amount', 'billing-rate'].map((id) => BILLING_TREND_METRICS.find((m) => m.id === id));
/** 금액 비교 — 원 단위 합이라 보통 정확히 같지만, 소수 금액이 섞여도 더하는 차례로 깨지지 않게 1전 안쪽은 같다고 본다. */
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.01, `${label}: ${a} ≠ ${b}`);

test('지표 모양: 실청구액(원 · [금액, 1]) · 수납률(% · [수납, 실청구]) — 운영실 묶음 · 오르면 좋다 · 과목별 기준', () => {
  assert.deepEqual(BILLING_TREND_METRICS.map((m) => [m.id, m.unit, m.better, m.group]), [[AMOUNT.id, '원', 'up', '운영실'], [RATE.id, '%', 'up', '운영실']]);
  for (const m of BILLING_TREND_METRICS) {
    assert.ok(m.dims.length >= 1 && m.dims.every((d) => d.id && d.label), `${m.id} dims`);
    assert.deepEqual(m.dims.map((d) => d.id), ['subject']);
    assert.equal(typeof m.series, 'function');
    assert.deepEqual([...m.grains], ['month', 'year']);
  }
});

test('창 규칙: 월 창 = 그 청구월 하나 · 연 창 = 그해 1월~창 끝 달(이번 해는 이번 달까지) · since 전 달은 뺀다 · 일·주 창 = 없음', () => {
  const asOf = '2026-10-27';
  const months = billingMonthsOf(windowsFor('month', asOf), null, shiftMonth);
  assert.deepEqual(months, windowsFor('month', asOf).map((w) => [w.from.slice(0, 7)]));
  assert.deepEqual(months.at(-1), ['2026-10'], '이번 달 창(오늘까지)도 청구월 통째');
  const years = billingMonthsOf(windowsFor('year', asOf), '2025-03', shiftMonth);
  assert.equal(years[0], null, 'since 전 해 = 없음');
  assert.deepEqual(years[1], Array.from({ length: 10 }, (_, i) => `2025-${String(i + 3).padStart(2, '0')}`));
  assert.deepEqual(years[2], Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`), '올해 = 1월~이번 달(다음 달 청구는 넣지 않는다)');
  assert.deepEqual(billingMonthsOf(windowsFor('month', asOf), '2026-01', shiftMonth).slice(0, 3), [null, null, ['2026-01']]);
  for (const grain of ['day', 'week']) assert.ok(billingMonthsOf(windowsFor(grain, asOf), null, shiftMonth).every((m) => m === null), grain);
  // 이달 1일이 기준일이면 '오늘' 하루 창과 이번 달 창이 같은 모양이다 — 단위는 첫 창으로 가린다.
  assert.ok(billingMonthsOf(windowsFor('day', '2026-11-01'), null, shiftMonth).every((m) => m === null));
  assert.deepEqual(billingMonthsOf(windowsFor('month', '2026-11-01'), null, shiftMonth).at(-1), ['2026-11']);
});

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var asOf = (await copyClock()).day;
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var run = async (metric, grain, filter = null) => {
    const windows = windowsFor(grain, asOf), t0 = performance.now();
    const out = await ro((sql) => metric.series({ sql, asOf, tenantId: t, importV2, windows, by: 'subject', filter }));
    return { windows, out, ms: Math.round(performance.now() - t0) };
  };
  var month = { amount: await run(AMOUNT, 'month'), rate: await run(RATE, 'month') };
  var year = { amount: await run(AMOUNT, 'year'), rate: await run(RATE, 'year') };
}

test('월 창 = 운영실 billing 영역(최근 6개월): 실청구 = 청구 − 할인 · 수납률 점 = [수납, 실청구] · 값은 2.0 수납률과 같다', { skip: SKIP }, async (tc) => {
  tc.diagnostic(`기준일 ${asOf} · since ${month.amount.out.since} · 월 ${month.amount.ms}ms/${month.rate.ms}ms · 연 ${year.amount.ms}ms/${year.rate.ms}ms`);
  const area = await ro((sp) => BILLING_AREAS.billing({ t, today: asOf, importV2 }, sp));
  const { windows } = month.amount, idx = (period) => windows.findIndex((w) => w.from.slice(0, 7) === period);
  assert.equal(area.length, 6);
  for (const s of area) {
    const i = idx(s.period);
    assert.ok(i >= 0, `${s.period} 창`);
    if (s.period < month.amount.out.since.slice(0, 7)) continue; // since 전 달은 창에서 뺐다
    assert.deepEqual(month.amount.out.total[i], [s.totalBilled - s.totalDiscount, 1], `${s.period} 실청구`);
    assert.deepEqual(month.rate.out.total[i], [s.totalCollected, s.totalBilled - s.totalDiscount], `${s.period} 수납률 점`);
    const [num, den] = month.rate.out.total[i];
    if (num <= den) assert.ok(Math.abs((num / den) * 100 - s.paymentRate) < 1e-9, `${s.period} 수납률 ${s.paymentRate}`);
  }
  const over = [...month.rate.out.rows.flatMap((r) => r.points.map((p, i) => (p && p[0] > p[1] ? `${r.label} ${windows[i].label}` : null))),
    ...month.rate.out.total.map((p, i) => (p && p[0] > p[1] ? `전체 ${windows[i].label}` : null))].filter(Boolean);
  tc.diagnostic(`수납이 실청구를 넘는 창(2.0은 100에서 자른다): ${over.join(', ') || '없음'}`);
});

test('과목 줄의 합 = 전체(두 지표 · 월·연 모든 창) · 과목 모름 줄은 맨 뒤', { skip: SKIP }, () => {
  for (const [grain, pair] of Object.entries({ month, year })) for (const [name, { out }] of Object.entries(pair)) {
    assert.ok(out.rows.length >= 1, `${grain} ${name} 줄`);
    out.total.forEach((p, i) => {
      const pts = out.rows.map((r) => r.points[i]);
      if (!p) return assert.ok(pts.every((x) => x === null), `${grain} ${name} ${i}: 전체가 없으면 줄도 없다`);
      near(pts.reduce((s, x) => s + x[0], 0), p[0], `${grain} ${name} 창 ${i} 분자 합`);
      if (name === 'rate') near(pts.reduce((s, x) => s + x[1], 0), p[1], `${grain} ${name} 창 ${i} 분모 합`);
    });
    const unknown = out.rows.findIndex((r) => r.key === UNKNOWN_SUBJECT.key);
    if (unknown >= 0) assert.deepEqual([unknown, out.rows[unknown].label], [out.rows.length - 1, '과목 모름']);
    assert.ok(out.rows.every((r) => typeof r.label === 'string' && r.label.trim()), `${grain} ${name} 줄 이름`);
  }
});

test('과목 필터: 전체 = 그 과목 줄 · 줄은 그 과목 하나', { skip: SKIP }, async () => {
  const pick = month.rate.out.rows.find((r) => r.key !== UNKNOWN_SUBJECT.key) ?? month.rate.out.rows[0];
  const { out } = await run(RATE, 'month', { dim: 'subject', key: pick.key });
  assert.deepEqual(out.total, pick.points);
  assert.deepEqual(out.rows.map((r) => r.key), [pick.key]);
});

test('전체 값 = 독립 SQL(청구서 머리 · 무효 제외 · 청구월 합) — 월 창과 연 창', { skip: SKIP }, async () => {
  const since = month.amount.out.since.slice(0, 7);
  const rows = await db`select period, sum(amount_total - coalesce(amount_discount, 0))::float8 net, sum(amount_paid)::float8 paid from public.invoices
    where tenant_id=${t} and status::text <> 'void' and period ~ '^\\d{4}-\\d{2}$' and period >= ${since} and period <= ${asOf.slice(0, 7)} group by period`;
  const by = new Map(rows.map((r) => [r.period, r]));
  const sum = (from, to, k) => rows.filter((r) => r.period >= from && r.period <= to).reduce((s, r) => s + r[k], 0);
  month.amount.windows.forEach((w, i) => {
    const m = w.from.slice(0, 7), r = by.get(m);
    if (m < since) return assert.equal(month.amount.out.total[i], null, `${m} since 전`);
    near(month.amount.out.total[i][0], r?.net ?? 0, `${m} 실청구`); near(month.rate.out.total[i][0], r?.paid ?? 0, `${m} 수납`);
    near(month.rate.out.total[i][1], r?.net ?? 0, `${m} 수납률 분모`);
  });
  year.amount.windows.forEach((w, i) => {
    const from = w.from.slice(0, 7) < since ? since : w.from.slice(0, 7), to = w.to.slice(0, 7);
    if (to < since) return assert.equal(year.amount.out.total[i], null, `${w.label} since 전`);
    near(year.amount.out.total[i][0], sum(from, to, 'net'), `${w.label} 실청구`); near(year.rate.out.total[i][0], sum(from, to, 'paid'), `${w.label} 수납`);
    near(year.rate.out.total[i][1], sum(from, to, 'net'), `${w.label} 수납률 분모`);
  });
});

test('일·주 창은 청구월로 가를 수 없어 비운다(전체·줄 모두 없음)', { skip: SKIP }, async () => {
  for (const grain of ['day', 'week']) {
    const { out } = await run(AMOUNT, grain);
    assert.ok(out.total.every((p) => p === null), grain);
    assert.deepEqual(out.rows, []);
  }
});

test('since = 수업료 청구가 있는 달의 1일(2.0 기록 범위 창 36개월 안) · 창 길이는 2.0 원문 값', { skip: SKIP }, async () => {
  const since = month.amount.out.since;
  assert.match(since, /^\d{4}-\d{2}-01$/);
  assert.ok(since <= asOf);
  const window = Number(/export const COVERAGE_WINDOW_MONTHS = (\d+);/.exec(await readFile(new URL('../../src/features/dashboard/overview/record-coverage.ts', import.meta.url), 'utf8'))?.[1]);
  assert.ok(since.slice(0, 7) >= shiftMonth(asOf.slice(0, 7), -(window - 1)), '창 안');
  // 2.0 coverageStartFromCounts의 바닥(그달 3건 이상)을 시험 쪽에서 따로.
  const [{ n }] = await db`select count(*)::int n from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded') and period = ${since.slice(0, 7)}`;
  assert.ok(n >= 3, `${since.slice(0, 7)} 수업료 청구 ${n}건`);
  assert.equal(year.amount.out.since, since, '단위가 달라도 같은 since');
});

test.after(() => db?.end());
