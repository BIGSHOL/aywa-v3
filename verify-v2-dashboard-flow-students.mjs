// 운영실 흐름(원생 쪽 확장 추세) 시험 — node --test experiments/owner-concept/verify-v2-dashboard-flow-students.mjs
// 카드와의 관계(재원생·강좌수 지난 달 점 = 같은 값 · 신규문의·신규 등록·퇴원·수업종료는 같은 창의 추세 점과 일치) ·
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
  var { weekWindows, addDays } = await import('./domain-snapshot-core.mjs');
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

test('카드와의 관계: 재원생·강좌수 지난 달 점 = 같은 값 · 신규문의와 신규 등록은 모든 주간 점이 확장 추세와 일치', { skip: SKIP }, async () => {
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
      assert.deepEqual(card, trend, `${id}: 카드 점 = 확장 추세의 같은 주간 점`);
    }
    // 퇴원·수업종료: 이번 달 점(장부 정리 퇴원 뺀 값) = 확장 추세 월별 마지막 창(1일 ~ 오늘).
    assert.equal(vals((await series(sql, 'exits', windowsFor('month', asOf))).total).at(-1), K.exits.points.at(-1).value, '퇴원·수업종료 이번 달');
  });
});

test('나뉘는 기준은 줄의 합 = 전체(일·주·월) · 겹치는 기준은 합 ≥ 전체 · 3개월 내 퇴원은 누적', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const partition = [['enrolled-students', 'mix'], ['exits', 'program'], ['intake', 'combo'], ['new-enrollments', 'combo']];
    // 강좌 과목별: EiE와 인재원 영어를 함께 듣는 학생은 2.0이 영어 강좌 하나로 세는데 두 줄에 하나씩 든다(겹침).
    const overlap = [['courses', 'subject'], ['enrolled-students', 'subject'], ['joins', 'subject'], ['withdrawn', 'subject'], ['intake', 'subject'], ['new-enrollments', 'subject']];
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

test('영어 = EiE · 인재원 영어(원장 10-28) — 다시 합치면 2.0 값 그대로 · 과목별 겹침 = 둘 다 듣는 수 · EiE 수강생 = 독립 SQL · 이름', { skip: SKIP }, async () => {
  await run(async (sql) => {
    for (const grain of ['day', 'month']) {
      const windows = windowsFor(grain, asOf);
      const mix = await series(sql, 'enrolled-students', windows, 'mix'), sub = await series(sql, 'enrolled-students', windows, 'subject');
      const m = Object.fromEntries(mix.rows.map((r) => [r.key, vals(r.points)])), s = Object.fromEntries(sub.rows.map((r) => [r.key, vals(r.points)]));
      assert.ok(m.eieOnly && s.eie, 'EiE 줄'); assert.equal(mix.rows.find((r) => r.key === 'eieOnly').label, 'EiE만');
      windows.forEach((w, i) => {
        if (m.englishOnly[i] === null) return;
        const sum = (ks) => ks.reduce((a, k) => a + m[k][i], 0);
        assert.equal(sum(Object.keys(m)), vals(mix.total)[i], `${grain} ${i} 수강 구성 합 = 재원생`);
        // 과목별: 인재원 영어 + EiE − (둘 다 듣는 학생) = 영어를 듣는 학생(= 수강 구성의 영어 계열 합)
        const englishAny = sum(['englishOnly', 'eieOnly', 'eieEnglish', 'englishMath', 'eieMath', 'eieEnglishMath']);
        assert.equal(s.english[i] + s.eie[i] - (m.eieEnglish[i] + m.eieEnglishMath[i]), englishAny, `${grain} ${i} 영어 합집합`);
        for (const k of Object.keys(m)) assert.ok(m[k][i] >= 0, `${grain} ${i} ${k} 음수`);
      });
    }
    const windows = windowsFor('month', asOf);
    const subjects = (await sql`select data->'operations'->'subjects' s from public.tenant_settings where tenant_id=${t}`)[0].s.map((x) => ({ key: x.key, label: x.label }));
    const P = await importV2('features/students/enrollment/program.ts');
    // 오늘 점(마지막 창)의 EiE 수강생 — 독립 SQL: 재원 · 종료일 없는 수강 · 휴원 아님 · 시작함 · EiE 반.
    const [{ n }] = await sql`select count(distinct e.student_id)::int n from public.enrollments e join public.classes c on c.id = e.class_id join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and s.status='enrolled' and e.end_date is null and not coalesce(e.on_hold,false) and e.start_date <= ${asOf}::date and c.english_track = 'eie'
        and coalesce(s.notes, '') !~ '^\\s*중복 병합:'`;
    const sub = Object.fromEntries((await series(sql, 'enrolled-students', windows, 'subject')).rows.map((r) => [r.key, vals(r.points)]));
    assert.equal(sub.eie.at(-1), n, '오늘 EiE 수강생 = 독립 SQL');
    assert.ok(P.programLabel('eie', subjects, true) === 'EiE');
  });
  // 등록 '동시 등록(두 과목 이상)'(원장 10-28) = Σ과목 줄(모름 포함) − 전체 − (세 묶음 이상 학생의 남는 몫) · 필터 'both' = 그 줄.
  await run(async (sql) => {
    // 세 묶음 이상(예: EiE + 인재원 영어 + 수학) 반을 다닌 적 있는 학생 — 없으면 Σ − 전체 = 동시 등록이 정확히, 있으면 그만큼 남는다(≥).
    const [{ n: three }] = await sql`select count(*)::int n from (select e.student_id from public.enrollments e join public.classes c on c.id = e.class_id
      where e.tenant_id=${t} and c.subject is not null group by e.student_id
      having count(distinct case when c.subject = 'english' and c.english_track = 'eie' then 'eie' when c.subject = 'english' then 'english' else c.subject end) >= 3) x`;
    for (const grain of ['week', 'month', 'year']) {
      const windows = windowsFor(grain, asOf), out = await series(sql, 'joins', windows, 'subject');
      const both = out.rows.find((r) => r.key === 'both');
      assert.equal(both?.label, '동시 등록(두 과목 이상)');
      const f = await series(sql, 'joins', windows, 'subject', { dim: 'subject', key: 'both' });
      assert.deepEqual(vals(f.total), vals(both.points), `${grain} 필터 = 그 줄`);
      out.total.forEach((p, i) => {
        if (!p) return;
        const sum = out.rows.filter((r) => r.key !== 'both').reduce((a, r) => a + (r.points[i]?.[0] ?? 0), 0);
        const extra = sum - p[0] - both.points[i][0];
        if (three === 0) assert.equal(extra, 0, `${grain} ${i} 동시 등록 = Σ − 전체`);
        else assert.ok(extra >= 0, `${grain} ${i} 동시 등록 ≤ Σ − 전체(세 묶음 학생 ${three}명)`);
      });
    }
  });
  // 그 밖의 기준도 EiE 줄 · 키 낱말 'eie' · 이름 'EiE'.
  await run(async (sql) => {
    for (const [id, by] of [['courses', 'subject'], ['joins', 'subject'], ['withdrawn', 'subject'], ['intake', 'subject']]) {
      const out = await series(sql, id, windowsFor('month', asOf), by), r = out.rows.find((x) => x.key === 'eie');
      assert.ok(r && r.label === 'EiE', `${id}: EiE 줄`);
      assert.equal(out.rows.find((x) => x.key === 'english')?.label, '인재원 영어', `${id}: 인재원 영어 줄`);
    }
  });
});

test("'자세히 보기' 목록(records) — 필터를 건 창마다 목록 길이 = 전체 값 · 줄 모양 · 필터 없으면 목록 없음", { skip: SKIP }, async () => {
  const { DASHBOARD_TREND_METRICS: ALL } = await import('./v2-dashboard-flow.mjs');
  const WITH = ['joins', 'withdrawn', 'intake', 'new-enrollments', 'exits', 'early-exits', 'recent-absent', 'level-tests', 'makeups'];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  await run(async (sql) => {
    for (const id of WITH) {
      const m = ALL.find((x) => x.id === id), dim = m.dims[0].id, windows = windowsFor('month', m.endsYesterday ? addDays(asOf, -1) : asOf);
      const plain = await m.series({ sql, asOf, tenantId: t, importV2, windows, by: dim, filter: null });
      assert.equal(plain.records, undefined, `${id}: 필터 없으면 목록 없음`);
      const row = plain.rows.find((r) => r.points.some((p) => p && p[0] > 0));
      assert.ok(row, `${id}: 값이 있는 줄`);
      const f = await m.series({ sql, asOf, tenantId: t, importV2, windows, by: dim, filter: { dim, key: row.key } });
      assert.equal(f.records.length, windows.length, `${id}: 창 수`);
      f.total.forEach((p, i) => {
        if (p === null) { assert.equal(f.records[i], null, `${id} ${i}: 기록 없음 창`); return; }
        assert.equal(f.records[i].length, p[0], `${id} ${i}: 목록 길이 = 전체`);
        const keys = f.records[i].map((r) => r.key);
        assert.ok(keys.every((k) => typeof k === 'string' && k), `${id} ${i}: 줄마다 key`);
        assert.equal(new Set(keys).size, keys.length, `${id} ${i}: 칸 안 key 중복 없음`);
        for (const r of f.records[i]) {
          assert.ok(!/\d{2,4}-?\d{3,4}-?\d{4}/.test(`${r.name} ${r.note ?? ''}`), `${id}: 연락처 노출 ${r.name}`);
          assert.ok(!/(^|[·\s])(math|english|eie|unknown|korean|science)([·\s]|$)/.test(r.note ?? ''), `${id}: 비고에 과목 키 원문 ${r.note}`);
          assert.ok(typeof r.id === 'string' && r.id && typeof r.name === 'string' && r.name, `${id}: id·이름`);
          if (r.date) assert.match(r.date, DAY, `${id}: 날짜`);
          if (r.sub !== undefined) assert.ok(r.sub && !/null|undefined/.test(r.sub), `${id}: 학교학년 ${r.sub}`);
          assert.ok(!('school' in r) && !('student' in r) && !('grade' in r), `${id}: 내부 칸이 새지 않는다`);
        }
      });
    }
  });
});

test('목록에 연락처가 새지 않는다(레벨테스트 = 모든 창 × 모든 줄 필터 · 나머지 = 월) · 같은 상담은 신규문의와 레벨테스트에서 같은 영어 키', { skip: SKIP }, async () => {
  const { DASHBOARD_TREND_METRICS: ALL } = await import('./v2-dashboard-flow.mjs');
  // 코드와 다른 넓은 꼴 — 점·빈칸 구분 · 앞자리 생략.
  const PHONES = [/\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/, /\d{3,4}[-.\s]\d{4}/];
  // 화면에 보이는 글자 칸만(id·key = UUID · date = 날짜는 숫자 꼴이라 뺀다).
  const leak = (r) => ['name', 'sub', 'note', 'dateLabel'].map((k) => r[k]).filter((v) => typeof v === 'string').some((v) => PHONES.some((re) => re.test(v)));
  const lt = ALL.find((x) => x.id === 'level-tests'), it = ALL.find((x) => x.id === 'intake');
  await run(async (sql) => {
    for (const grain of ['day', 'week', 'month', 'year']) {
      const windows = windowsFor(grain, addDays(asOf, -1)), plain = await lt.series({ sql, asOf, tenantId: t, importV2, windows, by: 'subject', filter: null });
      for (const row of plain.rows) {
        const f = await lt.series({ sql, asOf, tenantId: t, importV2, windows, by: 'subject', filter: { dim: 'subject', key: row.key } });
        for (const cell of f.records) for (const r of cell ?? []) assert.ok(!leak(r), `레벨테스트 ${grain} ${row.key}: ${JSON.stringify(r)}`);
      }
    }
    for (const id of ['joins', 'withdrawn', 'intake', 'new-enrollments', 'exits', 'early-exits', 'recent-absent', 'makeups']) {
      const m = ALL.find((x) => x.id === id), dim = m.dims[0].id, windows = windowsFor('month', m.endsYesterday ? addDays(asOf, -1) : asOf);
      for (const row of (await m.series({ sql, asOf, tenantId: t, importV2, windows, by: dim, filter: null })).rows) {
        const f = await m.series({ sql, asOf, tenantId: t, importV2, windows, by: dim, filter: { dim, key: row.key } });
        for (const cell of f.records) for (const r of cell ?? []) assert.ok(!leak(r), `${id} ${row.key}: ${JSON.stringify(r)}`);
      }
    }
    // 같은 상담 id → 같은 영어 키(EiE · 인재원 영어 · 구분 모름) — 연 창 줄 필터의 목록으로 상담마다 든 키를 모아 견준다.
    const ENG = ['eie', 'english', 'englishUnsplit'];
    const keysById = async (m, end) => {
      const windows = windowsFor('year', end), out = new Map();
      for (const key of ENG) {
        const f = await m.series({ sql, asOf, tenantId: t, importV2, windows, by: 'subject', filter: { dim: 'subject', key } });
        for (const cell of f.records) for (const r of cell ?? []) out.set(r.id, [...(out.get(r.id) ?? []), key]);
      }
      return out;
    };
    const [a, b] = [await keysById(it, asOf), await keysById(lt, addDays(asOf, -1))];
    let both = 0;
    for (const [id, keys] of b) if (a.has(id)) { both += 1; assert.deepEqual([...new Set(keys)].sort(), [...new Set(a.get(id))].sort(), `상담 ${id}`); }
    assert.ok(both > 0, '두 지표에 함께 든 상담이 있어야 시험이 된다');
  });
});

test.after(() => db?.end());
