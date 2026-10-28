// 운영실 흐름(원생 쪽 확장 추세) 시험 — node --test experiments/owner-concept/verify-v2-dashboard-flow-students.mjs
// 카드와의 관계(재원생·강좌수 지난 달 점 = 같은 값 · 신규문의·신규 등록·퇴원·수업종료는 지금 창 = 카드 마지막 점, 지난 창은 카드 ≤ 확장 추세) ·
// 나뉘는 기준이면 줄의 합 = 전체 · 등록·퇴원 월 값 = 운영실 '등록·퇴원 추이' 영역 값 · 퇴원·3개월 내 퇴원·신규문의가 독립 SQL과 같은지 ·
// 필터를 걸면 전체 = 그 줄이고 줄을 다시 가르는지 · 줄 키가 화면 필터 규칙을 지키고 이름에 원문 글자(연락처 등)가 없는지 · 카드 묶음이 DB 오류에도
// 트랜잭션을 살려 두는지를 본다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDENT_TREND_METRICS } from './v2-dashboard-flow-students.mjs';
import { studentStatusKpis } from './v2-student-kpis.mjs';
import { dashboardKpiCards, DASHBOARD_KPI_ORDER } from './v2-dashboard-flow.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock, queryGate } = await import('./v2-onescreen-roster.mjs');
  var { weekWindows } = await import('./domain-snapshot-core.mjs');
  var { windowsFor } = await import('./v2-screen-trend.mjs');
  var { loadOverviewSnapshot } = await import('./v2-dashboard-overview.mjs');
  var V = await importV2('features/withdrawals/system-bulk.ts');
  var clock = await copyClock(), asOf = clock.day;
  var M = Object.fromEntries(STUDENT_TREND_METRICS.map((m) => [m.id, m]));
  // 한 트랜잭션 안에서 여러 지표를 부른다(화면 load와 같은 조건).
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var series = (sql, id, windows, by = M[id].dims[0].id, filter = null) => M[id].series({ sql, asOf, tenantId: t, importV2, windows, by, filter });
  var vals = (arr) => arr.map((p) => (p ? p[0] : null));
  var has = (r) => r.points.some((p) => p && p[0] > 0);
  var MERGE = '^\\s*중복 병합:\\s*\\S+와 통합됨';
}

test('카드와의 관계: 재원생·강좌수 지난 달 점 = 같은 값 · 지금 창 = 카드 마지막 점 · 지난 창은 카드(같은 시각까지) ≤ 확장 추세(하루 끝까지)', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const k = await studentStatusKpis({ sql, asOf, tenantId: t, importV2 }), K = Object.fromEntries(k.kpis.map((x) => [x.id, x]));
    assert.deepEqual(k.kpis.map((x) => x.id), ['enrolled-students', 'courses', 'exits', 'intake', 'new-enrollments'], '카드 id = 지표 id');
    for (const id of ['enrolled-students', 'courses']) {
      const s = await series(sql, id, windowsFor('month', asOf));
      // 카드는 기록이 갖춰진 달부터 · 이번 달 점은 칸 값(2.0 '오늘 점 = 칸') — 지난 달 점끼리 같다.
      const months = K[id].points.slice(0, -1), tail = vals(s.total).filter((v) => v !== null).slice(0, -1);
      assert.deepEqual(tail, months.map((p) => p.value), id);
    }
    for (const id of ['intake', 'new-enrollments']) {
      const trend = vals((await series(sql, id, weekWindows(asOf, 8))).total), card = K[id].points.map((p) => p.value);
      assert.equal(trend.at(-1), card.at(-1), `${id}: 지금 창 = 카드 큰 숫자`);
      card.forEach((v, i) => { if (v !== null) assert(trend[i] !== null && v <= trend[i], `${id} ${i}: 카드 ${v} ≤ 확장 추세 ${trend[i]}`); });
    }
    // 퇴원·수업종료: 이번 달 점(장부 정리 퇴원 뺀 값) = 확장 추세 월별 마지막 창(1일 ~ 오늘).
    assert.equal(vals((await series(sql, 'exits', windowsFor('month', asOf))).total).at(-1), K.exits.points.at(-1).value, '퇴원·수업종료 이번 달');
  });
});

test('나뉘는 기준은 줄의 합 = 전체(일·주·월) · 겹치는 기준은 합 ≥ 전체 · 3개월 내 퇴원은 누적', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const partition = [['enrolled-students', 'mix'], ['courses', 'subject'], ['exits', 'program'], ['intake', 'combo'], ['new-enrollments', 'combo']];
    const overlap = [['enrolled-students', 'subject'], ['joins', 'subject'], ['withdrawn', 'subject'], ['intake', 'subject'], ['new-enrollments', 'subject']];
    for (const grain of ['day', 'week', 'month']) {
      const windows = windowsFor(grain, asOf);
      for (const [id, by] of [...partition, ...overlap]) {
        const s = await series(sql, id, windows, by), exact = partition.some(([i, b]) => i === id && b === by);
        s.total.forEach((p, i) => {
          if (!p) return;
          const sum = s.rows.reduce((a, r) => a + (r.points[i]?.[0] ?? 0), 0);
          if (exact) assert.equal(sum, p[0], `${id}/${by} ${grain} ${windows[i].label}`); else assert(sum >= p[0], `${id}/${by} ${grain} ${windows[i].label}`);
        });
      }
      // 3개월 내 퇴원 기간별 = 2.0 누적(30 ⊂ 60 ⊂ 90일) — '3개월 이내' 줄 = 전체.
      const e = await series(sql, 'early-exits', windows, 'tenure'), r = Object.fromEntries(e.rows.map((x) => [x.key, vals(x.points)]));
      assert.deepEqual(r['3m'], vals(e.total), `3개월 이내 = 전체 ${grain}`);
      r['1m'].forEach((v, i) => { if (v !== null) assert(v <= r['2m'][i] && r['2m'][i] <= r['3m'][i], `누적 ${grain} ${i}`); });
    }
  });
});

test('등록·퇴원 월 값 = 운영실 등록·퇴원 추이 영역(6개월)', { skip: SKIP }, async () => {
  const snap = await run((sql) => loadOverviewSnapshot({ sql, tenantId: t, importV2 }));
  const changes = snap.initial.sections.changes.data;
  await run(async (sql) => {
    const windows = windowsFor('month', asOf).slice(-6);
    assert.deepEqual(windows.map((w) => w.from.slice(0, 7)), changes.map((r) => r.month));
    assert.deepEqual(vals((await series(sql, 'joins', windows)).total), changes.map((r) => r.enrolled), '등록');
    assert.deepEqual(vals((await series(sql, 'withdrawn', windows)).total), changes.map((r) => r.withdrawn), '퇴원');
  });
});

test('퇴원·3개월 내 퇴원 = 독립 SQL(병합 · 수업 기록 없는 장부 정리 · 시스템 정리 · 단체 장부 정리 제외 · 등록일부터 90일)', { skip: SKIP }, async () => {
  const windows = windowsFor('month', asOf).slice(-6);
  const st = await db`select s.id::text id, s.enrolled_at::text enrolled_at, s.withdrawn_at::text withdrawn_at, s.withdrawal_metadata md,
      exists(select 1 from public.enrollments e where e.tenant_id=${t} and e.student_id = s.id and e.end_date is not null) hist
    from public.students s where s.tenant_id=${t} and s.status = 'withdrawn' and s.withdrawn_at between ${windows[0].from} and ${asOf} and coalesce(s.notes, '') !~ ${MERGE}`;
  const kept = st.filter((r) => !V.isCleanupExit(r.md) && !(V.SYSTEM_BULK_WITHDRAWAL_DATES.includes(r.withdrawn_at.slice(0, 10)) && !r.hist));
  const days = (r) => (r.enrolled_at && r.enrolled_at.slice(0, 10) <= r.withdrawn_at.slice(0, 10)
    ? Math.round((Date.parse(`${r.withdrawn_at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${r.enrolled_at.slice(0, 10)}T00:00:00Z`)) / 86400000) : null);
  const inW = (r, w) => r.withdrawn_at.slice(0, 10) >= w.from && r.withdrawn_at.slice(0, 10) <= w.to;
  await run(async (sql) => {
    assert.deepEqual(vals((await series(sql, 'withdrawn', windows)).total), windows.map((w) => kept.filter((r) => inW(r, w)).length));
    assert.deepEqual(vals((await series(sql, 'early-exits', windows)).total), windows.map((w) => kept.filter((r) => inW(r, w) && days(r) !== null && days(r) <= 90).length));
  });
});

test('신규문의 = 독립 SQL(상담일 · 달마다 · 지금 달은 복사본을 뜬 순간까지) · 옮겨 넣은 옛 상담은 원래 상담일에 든다', { skip: SKIP }, async () => {
  const windows = windowsFor('month', asOf);
  const byMonth = new Map((await db`select to_char(consulted_at at time zone 'Asia/Seoul', 'YYYY-MM') m, count(*)::int n from public.enrollment_consultations
    where tenant_id=${t} and consulted_at < ${clock.at} group by 1`).map((r) => [r.m, r.n]));
  await run(async (sql) => {
    const s = await series(sql, 'intake', windows, 'combo');
    assert.deepEqual(vals(s.total), windows.map((w) => byMonth.get(w.from.slice(0, 7)) ?? 0));
    // 입력 시각으로 세면 옮겨 넣은 달(입력한 날)에 몰린다 — 상담일로 세면 그 달 값은 그 달에 상담한 것만.
    const [{ n: entered }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${t}
      and to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM') = '2026-08'`;
    const aug = windows.findIndex((w) => w.from.startsWith('2026-08'));
    if (aug >= 0 && entered > 1000) assert(s.total[aug][0] < entered / 10, `8월 상담일 ${s.total[aug][0]}건 ≪ 8월 입력 ${entered}건`);
  });
});

test('필터를 걸면 전체 = 그 줄 · 같은 기준이면 그 줄 하나 · 다른 기준이면 그 안에서 다시 가른다 · 기록 전 창은 null', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const windows = windowsFor('month', asOf);
    for (const [id, by] of [['enrolled-students', 'mix'], ['enrolled-students', 'subject'], ['courses', 'subject'], ['exits', 'program'], ['early-exits', 'tenure'],
      ['intake', 'combo'], ['new-enrollments', 'subject'], ['joins', 'subject'], ['withdrawn', 'subject']]) {
      const all = await series(sql, id, windows, by), row = all.rows.find(has);
      assert(row, `${id}/${by}: 값이 있는 줄이 있어야 시험이 된다`);
      const f = await series(sql, id, windows, by, { dim: by, key: row.key });
      assert.deepEqual(vals(f.total), vals(row.points), `${id} 필터 ${row.key}`);
      assert.deepEqual(f.rows.map((r) => [r.key, vals(r.points)]), [[row.key, vals(row.points)]], `${id} 필터 줄 = 그 줄 하나`);
    }
    // 다른 기준으로 다시 가르기 — 과목을 둘 이상 적은 조합이 있으면 그 조합, 없으면 한 과목 조합: 다시 가른 과목별 줄 = 그 조합의 과목들 · 각 줄 = 전체.
    const all = await series(sql, 'intake', windows, 'combo');
    const combo = all.rows.find((r) => r.key.includes('.') && has(r)) ?? all.rows.find((r) => r.key !== 'unknown' && has(r));
    const f = await series(sql, 'intake', windows, 'subject', { dim: 'combo', key: combo.key });
    assert.deepEqual(vals(f.total), vals(combo.points));
    assert.deepEqual(f.rows.filter(has).map((r) => r.key).sort(), combo.key.split('.').sort());
    for (const r of f.rows.filter(has)) assert.deepEqual(vals(r.points), vals(f.total), `조합 ${combo.key}의 ${r.key} 줄 = 전체`);
    const ne = await series(sql, 'new-enrollments', windows);
    ne.total.forEach((p, i) => { if (Date.parse(`${windows[i].from}T00:00:00+09:00`) < Date.parse(`${ne.since}T00:00:00+09:00`)) assert.equal(p, null); });
  });
});

test('줄 키는 화면 필터 규칙을 지키고 · 줄 이름에 원문 키·연락처가 없다', { skip: SKIP }, async () => {
  const KEY = /^[A-Za-z0-9:._|-]{1,100}$/, PHONE = /\d{2,4}-\d{3,4}-\d{4}/;
  await run(async (sql) => {
    for (const m of STUDENT_TREND_METRICS) for (const d of m.dims) for (const grain of ['month', 'year']) {
      const s = await series(sql, m.id, windowsFor(grain, asOf), d.id);
      for (const r of s.rows) {
        assert(KEY.test(r.key), `${m.id}/${d.id}: 키 ${r.key}`);
        assert(r.label && !PHONE.test(r.label) && !/^[a-z_]+$/.test(r.label), `${m.id}/${d.id}: 이름 ${r.label}`);
      }
    }
  });
});

test('등록·퇴원 계열 기록 시작 = 2.0 flowBounds(퇴원 기록 시작 · 기록 범위 중 늦은 달 · 수업종료는 첫 수강 종료 달도) · 한 과목 조합 = "…만"', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const { trustFrom } = await studentStatusKpis({ sql, asOf, tenantId: t, importV2 });
    const [{ out }] = await db`select to_char(min(withdrawn_at), 'YYYY-MM') out from public.students where tenant_id=${t} and status = 'withdrawn' and withdrawn_at is not null`;
    const [{ ended }] = await db`select to_char(min(end_date), 'YYYY-MM') ended from public.enrollments where tenant_id=${t} and end_date <= ${asOf}`;
    const later = (...m) => m.filter(Boolean).sort().at(-1);
    const expect = { joins: later(out, trustFrom), withdrawn: later(out, trustFrom), 'early-exits': later(out, trustFrom), exits: later(out, trustFrom, ended) };
    for (const grain of ['month', 'year']) {
      const windows = windowsFor(grain, asOf);
      for (const [id, from] of Object.entries(expect)) {
        const s = await series(sql, id, windows);
        assert.equal(s.since, `${from}-01`, `${id} 기록 시작`);
        windows.forEach((w, i) => { if (w.from < s.since) assert.equal(s.total[i], null, `${id} ${grain} ${w.label}: 기록 시작 전에 시작한 창`); else assert.notEqual(s.total[i], null); });
      }
    }
    const combos = (await series(sql, 'intake', windowsFor('month', asOf), 'combo')).rows;
    for (const r of combos) if (r.key !== 'unknown' && !r.key.includes('.')) assert.match(r.label, /만$/, `한 과목 조합 ${r.key}`);
  });
});

test('저장점이 끝난 묶음의 늦은 조회는 연결로 가지 않는다 — 여러 단계 갈래가 나란히 실패해도 트랜잭션이 산다', { skip: SKIP }, async () => {
  const { isolated } = await import('./v2-dashboard-isolate.mjs');
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  await run(async (sql) => {
    // 갈래 A는 첫 조회가 성공한 뒤 쉬었다가 실패하는 조회를 낸다 · 갈래 B가 그 사이 실패해 저장점이 되돌려진다 — A의 늦은 조회가 연결로 갔다면
    // 저장점 밖에서 실패해 바깥 트랜잭션이 깨진다(관문 없는 sql.savepoint로는 25P02). 묶음 코드처럼 queryGate를 거쳐 부른다.
    await assert.rejects(isolated(sql, (sp) => { const gate = queryGate(sp); return Promise.all([
      (async () => { await gate`select 1 as a`; await wait(300); await gate`select ${'x'}::int as b`; })(),
      (async () => { await wait(50); await gate`select ${'y'}::int`; })(),
    ]); }));
    await wait(500); // 늦은 갈래가 끝날 때까지
    assert.equal((await sql`select 1 as x`)[0].x, 1, '트랜잭션이 살아 있다');
    assert.equal(await isolated(sql, async (sp) => (await sp`select 2 as x`)[0].x), 2, '성공하면 값 그대로');
  });
});

test('카드 묶음은 DB 오류가 나도 트랜잭션을 살려 둔다(그 묶음 카드만 빠진다)', { skip: SKIP }, async () => {
  await run(async (sql) => {
    // 지점 id가 uuid가 아니면 조회가 DB 오류(22P02) — 저장점 밖이었다면 트랜잭션이 깨져 다음 조회가 25P02로 실패한다.
    const err = console.error; console.error = () => {};
    try { assert.deepEqual(await dashboardKpiCards({ sql, asOf, tenantId: 'not-a-tenant', importV2 }), []); } finally { console.error = err; }
    assert.equal((await sql`select 1 as x`)[0].x, 1, '트랜잭션이 살아 있다');
    assert.deepEqual((await dashboardKpiCards({ sql, asOf, tenantId: t, importV2 })).map((c) => c.id), [...DASHBOARD_KPI_ORDER]);
  });
});

test.after(() => db?.end());
