// 운영실 KPI 흐름(레벨테스트) 시험 — node --test experiments/owner-concept/verify-v2-dashboard-flow-admissions.mjs
// 창마다 레벨테스트 수를 2.0 조건(수기 일정 · 제목·태그의 레벨테스트 이름 · 취소·예약 차단·운영팀 중요일정 제외 · 일정 기간이 창과 겹침)을 시험 쪽에서 따로 적은
// SQL·계산과 대조하고, 전일 범위 창 = 운영실 일정 카드의 '전일 입테' 숫자, 과목별 줄과 전체의 관계, 카드 모양을 확인한다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { queryGate, rules, resolveSettings, copyClock } = await import('./v2-onescreen-roster.mjs');
  var { addDays, weekWindows } = await import('./domain-snapshot-core.mjs');
  var { windowsFor } = await import('./v2-screen-trend.mjs');
  var { ADMISSIONS_TREND_METRICS, admissionsKpiCards } = await import('./v2-dashboard-flow-admissions.mjs');
  var { ADMISSIONS_AREAS } = await import('./v2-dashboard-admissions.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), asOf = clock.day, yesterday = addDays(asOf, -1), metric = ADMISSIONS_TREND_METRICS[0];
  var series = (windows, filter = null) => ro((sql) => metric.series({ sql, asOf, tenantId: t, importV2, windows, by: 'subject', filter }));
  // 따로 적은 2.0 레벨테스트 판정(공백을 지운 제목·태그) — 기록 = 취소 포함 · 셈 = 취소 제외.
  var squash = (s) => (s ?? '').replace(/\s+/g, '');
  var events = (await db`select e.title, e.start_date::text s, e.end_date::text e, tg.name tag from public.calendar_events e
      left join public.calendar_tags tg on tg.id = e.tag_id where e.tenant_id=${t}`).map((r) => ({ title: squash(r.title), tag: squash(r.tag), s: r.s, e: r.e }));
  var recorded = events.filter((r) => !/예약(금지|차단)/.test(r.title) && !r.tag.includes('운영팀중요일정') && /레벨테스트|입학테스트|입테|레테/.test(`${r.title} ${r.tag}`));
  var tests = recorded.filter((r) => !r.title.includes('취소'));
  var since = recorded.reduce((m, r) => (!m || r.s < m ? r.s : m), null);
  var expected = (w) => (since && w.to >= since ? tests.filter((r) => r.s <= w.to && r.e >= w.from).length : null);
  var value = (p) => (p ? p[0] : null);
}

test('지표 모양: 운영실 묶음 · 건수 · 오르면 좋음 · 과목별 기준 · 어제까지 · 창마다 [값, 1]', { skip: SKIP }, () => {
  assert.deepEqual([metric.id, metric.label, metric.group, metric.unit, metric.better, metric.endsYesterday], ['level-tests', '레벨테스트', '운영실', '건', 'up', true]);
  assert(metric.dims.length >= 1 && metric.dims.every((d) => d.id && d.label));
  assert.equal(typeof metric.series, 'function');
});

test('일·주·월·연 창 전부: 창마다 값 = 따로 센 레벨테스트 수 · 기록이 시작되기 전 창 = 기록 없음 · since = 첫 레벨테스트 일정 날', { skip: SKIP }, async (tc) => {
  for (const grain of ['day', 'week', 'month', 'year']) {
    const windows = windowsFor(grain, yesterday), t0 = performance.now(), r = await series(windows);
    tc.diagnostic(`${grain} ${windows.length}창 ${Math.round(performance.now() - t0)}ms · 마지막 창 ${windows.at(-1).label} = ${value(r.total.at(-1))}`);
    assert.equal(r.since, since);
    assert.equal(r.total.length, windows.length);
    assert.deepEqual(r.total.map(value), windows.map(expected), grain);
    for (const p of r.total) if (p) assert.equal(p[1], 1);
    assert(windows.at(-1).to === yesterday, '창은 어제로 끝난다');
  }
  // 기록이 시작되기 전에 끝난 창은 0이 아니라 기록 없음, since를 품은 창부터 센다.
  const before = { from: addDays(since, -30), to: addDays(since, -1) }, around = { from: addDays(since, -3), to: addDays(since, 3) };
  const r = await series([before, around]);
  assert.deepEqual(r.total.map(value), [null, expected(around)]);
  assert(value(r.total[1]) >= 1, 'since 날의 레벨테스트가 든다');
});

test('전일 범위 창 = 운영실 일정 카드의 \'전일 입테\' 숫자 = 따로 센 값', { skip: SKIP }, async () => {
  const [D, P] = await Promise.all([importV2('features/dashboard/overview/display.ts'), importV2('features/dashboard/overview/previous-day.ts')]);
  const prev = P.previousDayRange(asOf);
  // 앞 작업의 일정 카드를 같은 방식(저장점 · ctx)으로 불러 2.0 카드 숫자(levelTestsIn(줄, 전일 범위))를 만든다.
  const RR = await rules(importV2);
  const rows = await ro(async (tx) => {
    const sql = queryGate(tx), [[row], [{ name }]] = await Promise.all([tx`select data from public.tenant_settings where tenant_id=${t}`, tx`select name from public.tenants where id=${t}`]);
    const ctx = { t, today: asOf, clock, settings: resolveSettings(RR, row?.data ?? {}, name), allowed: ['students', 'classes', 'enrollment', 'calendar'], user: { id: null, role: 'master' },
      importV2, RR, memo: new Map() };
    return sql.soft((sp) => ADMISSIONS_AREAS.calendar(ctx, sp), (e) => { throw e; });
  });
  const card = D.levelTestsIn(rows, prev).length;
  const r = await series([prev]);
  assert.equal(value(r.total[0]), card);
  assert.equal(card, expected(prev));
});

test('과목별 줄: 줄마다 ≤ 전체 ≤ 줄의 합(두 과목 일정은 두 줄에) · 과목으로 좁힌 전체 = 그 과목 줄', { skip: SKIP }, async (tc) => {
  const windows = windowsFor('month', yesterday), r = await series(windows);
  assert(r.rows.length >= 1, '줄이 있어야 시험된다');
  windows.forEach((w, i) => {
    if (!r.total[i]) return assert(r.rows.every((row) => row.points[i] === null), `${w.label}: 기록 전 창은 줄도 기록 없음`);
    const sum = r.rows.reduce((n, row) => n + value(row.points[i]), 0);
    for (const row of r.rows) assert(value(row.points[i]) <= value(r.total[i]), `${w.label} ${row.label}`);
    assert(sum >= value(r.total[i]), `${w.label}: 줄의 합 ${sum} ≥ 전체 ${value(r.total[i])}`);
  });
  tc.diagnostic(`월 12창 줄: ${r.rows.map((row) => `${row.label} ${row.points.reduce((n, p) => n + value(p), 0)}`).join(' · ')} · 전체 ${r.total.reduce((n, p) => n + value(p), 0)}`);
  for (const row of r.rows.slice(0, 3)) {
    const f = await series(windows, { dim: 'subject', key: row.key });
    assert.deepEqual(f.total, row.points, `${row.label}로 좁힌 전체 = 그 줄`);
    assert(f.rows.some((x) => x.key === row.key), `${row.label}로 좁혀도 그 줄이 선다`);
  }
  const none = await series(windows, { dim: 'subject', key: 'no-such-subject' });
  assert(none.total.every((p) => p === null || p[0] === 0), '없는 과목으로 좁히면 0');
});

test('KPI 카드: 레벨테스트 하나 · 점 = 어제까지 7일 창 8개(따로 센 값) · 큰 숫자 = 마지막 점 · 지표와 같은 id · 문구에 기간·영문·2.0 없음 · 한 트랜잭션 한 번 계산', { skip: SKIP }, async () => {
  const windows = weekWindows(yesterday, 8);
  await ro(async (sql) => {
    const p = admissionsKpiCards({ sql, asOf, tenantId: t, importV2 });
    assert.equal(admissionsKpiCards({ sql, asOf, importV2 }), p, '같은 트랜잭션 · 지점 기본값도 같은 열쇠');
    const [card, ...rest] = await p;
    assert.equal(rest.length, 0);
    assert.deepEqual([card.kind, card.id, card.label, card.unit, card.period, card.better, card.span], ['kpi', metric.id, '레벨테스트', '건', 'week', 'up', '어제까지 7일']);
    assert.deepEqual(card.points.map((x) => [x.label, x.value]), windows.map((w) => [w.label, expected(w)]));
    assert.deepEqual([card.value, card.previous], [card.points.at(-1).value, card.points.at(-2).value]);
    for (const text of [card.label, card.span, card.basis]) { assert.doesNotMatch(text, /2\.0|[A-Za-z]/, text); assert(text.length > 0); }
    assert.doesNotMatch(card.label, /\d|전일|금일|주|월/, '이름에 기간이 박히지 않는다');
    // 주별 확장 추세의 마지막 8창 = 카드 점(같은 데이터는 같은 원본).
    const trend = await metric.series({ sql, asOf, tenantId: t, importV2, windows: windowsFor('week', yesterday), by: 'subject', filter: null });
    assert.deepEqual(trend.total.slice(-8).map(value), card.points.map((x) => x.value));
  });
});

test.after(() => db?.end());
