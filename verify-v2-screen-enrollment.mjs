// 2.0 화면 — 신규 콜&상담 시험 (Docker 복사본 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-screen-enrollment.mjs
// ① 그리기 = 2.0 page.tsx 본문 그대로(서버 호출 자리만 enrollment-page.swaps.json 짝 · 뺀 것은 계정 보기 설정 저장 하나 — 글자 대조)
// ② 칸반·목록 숫자 = 독립 SQL(기본 3개월 · 1년 · 달 · 접수일 · 상담사 · 단계 · 검색 · 쪽 · 머리 숫자 · 반 배정 수 · 전체 건수)
// ③ 매개변수 거절 · 화면 글자에 '2.0'·개발자용 말이 없다 · 껍데기에 운영 주소·쓰기 요청이 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen } from './v2-screen-enrollment.mjs';
import { PAGE_SIZE } from './v2-enrollment-list.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const START = '/** 상담 진행 단계';
/** 코드에서 주석을 뺀 글자(화면 글자 검사용). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (sql, params) => screen.load({ sql, params, tenantId: t, importV2 });
  /** 2.0 rangeStartIso와 독립 — KST 이번 달 1일에서 (N-1)달 전. */
  var since = (sql, months) => sql`((date_trunc('month', now() at time zone 'Asia/Seoul') - make_interval(months => ${months - 1})) at time zone 'Asia/Seoul')`;
  var ids = (rows) => rows.map((r) => r.id);
}

test('그리기 = 2.0 page.tsx 본문 그대로 — 서버 호출 자리만 swaps 짝(짝마다 한 번) · 뺀 것은 계정 보기 설정 저장 하나', async () => {
  const orig = lf(await src('app/(shell)/enrollment/page.tsx')), mine = lf(await here('./v2-host/src/enrollment-page.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/enrollment-page.swaps.json'));
  let body = orig.slice(orig.indexOf(START));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, () => to); }
  assert.equal(swaps.removed.length, 1);
  assert.match(swaps.removed[0], /<RememberPrefs /);
  for (const r of swaps.removed) { assert.equal(body.split(r).length, 2, r); body = body.replace(r, ''); }
  assert.equal(mine.slice(mine.indexOf(START)), body);
  assert.ok(!/\bawait\b/.test(code(body)), '본문 코드에 await가 남았다');
  for (const name of ['requireAccess', 'getEnrollmentConsultations', 'getEnrollmentConsultationsPage', 'getConsultationFilteredCounts', 'getConsultantOptions',
    'getConsultationMinYear', 'getConsultationTotalCount', 'getTenantSettings', 'getEnrollmentStats', 'getConsultationDistribution', 'getWithdrawalsInWindow',
    'loadOpsHistory', 'loadIntakeTrend', 'loadSchoolStatsPrefs', 'getStatsYears', 'readMyUiPrefs', 'IntakeQrSection', 'MakeeduPushSection', 'MakeeduSyncBadge', 'RememberPrefs'])
    assert.ok(!new RegExp(`\\b${name}\\b`).test(code(body)), `${name}이 남았다`);
});

test('칸반(기본 3개월) = 독립 SQL — 같은 상담 · 최신순 · 머리 숫자(전체·AI 완료·반 배정) · 전체 건수 · 상담사 선택지 · 가장 이른 해', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const d = await load(sql, {});
    assert.equal(d.page, 'list');
    const rows = await sql`select id::text id, outcome::text outcome from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 3)} order by consulted_at desc, id`;
    assert.ok(rows.length > 0, '시험하려면 최근 3개월 상담이 있어야 한다');
    assert.deepEqual(ids(d.kanbanItems), ids(rows));
    assert.equal(d.tablePage, null); assert.equal(d.headerCounts, null);
    const [{ n }] = await sql`select count(*)::int n from public.enrollment_consultations where tenant_id=${t}`;
    assert.equal(d.totalCount, n);
    const cons = await sql`select id::text id from public.users where tenant_id=${t} and status::text='active' and system_role::text in ('counselor','manager','admin','master','teacher') order by display_name`;
    assert.deepEqual(d.consultants.map((c) => c.id), ids(cons));
    const [{ y }] = await sql`select extract(year from min(consulted_at) at time zone 'Asia/Seoul')::int y from public.enrollment_consultations where tenant_id=${t}`;
    assert.equal(d.minYear, y);
    // AI 분석 유무 · 상담사 이름 · 녹음 · QR(독립 SQL)
    const facts = await sql`select c.id::text id, exists(select 1 from public.consultation_ai_analysis a where a.consultation_id=c.id) ai, u.display_name nm, c.audio_path is not null au, coalesce(c.from_public_intake,false) qr
      from public.enrollment_consultations c left join public.users u on u.id=c.consultant_id where c.tenant_id=${t} and c.consulted_at >= ${since(sql, 3)}`;
    const byId = new Map(facts.map((f) => [f.id, f]));
    for (const k of d.kanbanItems) {
      const f = byId.get(k.id);
      assert.equal(k.hasAiAnalysis, f.ai, k.id); assert.equal(k.consultantName, f.nm ?? null, k.id); assert.equal(k.hasAudio, f.au, k.id); assert.equal(k.fromPublicIntake, f.qr, k.id);
      assert.equal(k.personConsults.length === 0, k.personConsultCount === 1, k.id);
    }
  });
});

test('반 배정 수 = 연결 학생의 미종료 수강(상담 과목이 없으면 전 과목 · 있으면 2.0 consultClassKeys가 고른 과목) — 독립 SQL', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const d = await load(sql, { range: '1y' });
    const CS = await importV2('features/enrollment/consult-subject.ts');
    const { readPeople } = await import('./v2-proc-people.mjs');
    const subjects = (await readPeople(sql, t, importV2, 'enrollment')).settings.operations.subjects;
    const enr = await sql`select c.id::text id, k.subject from public.enrollment_consultations c join public.enrollments e on e.student_id=c.student_id
      join public.classes k on k.id=e.class_id where c.tenant_id=${t} and c.consulted_at >= ${since(sql, 12)} and (e.end_date is null or e.end_date >= (now() at time zone 'Asia/Seoul')::date)`;
    const by = new Map();
    for (const r of enr) (by.get(r.id) ?? by.set(r.id, []).get(r.id)).push(r.subject);
    let assigned = 0, nullSubject = 0;
    for (const k of d.kanbanItems) {
      const list = by.get(k.id) ?? [], row = (await sql`select subject from public.enrollment_consultations where id=${k.id}`)[0];
      const keys = CS.consultClassKeys(row.subject, subjects);
      const want = !k.studentId ? 0 : keys === null ? list.length : list.filter((s) => keys.includes(s)).length;
      assert.equal(k.assignedClassCount, want, `${k.id} ${row.subject}`);
      if (want > 0) assigned++; if (keys === null && list.length) nullSubject++;
    }
    assert.ok(assigned > 0, '반 배정 상담이 있어야 시험이 된다');
  });
});

test('목록(쪽 50건) · 머리 숫자 = 독립 SQL — 1쪽·2쪽 · 1년 · 달 · 접수일 · 상담사 · 단계 · 검색', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const all = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)} order by consulted_at desc, id`;
    assert.ok(all.length > PAGE_SIZE, '쪽 넘김을 시험하려면 1년에 50건 넘게 있어야 한다');
    const p1 = await load(sql, { view: 'table', range: '1y' }), p2 = await load(sql, { view: 'table', range: '1y', page: '2' });
    assert.equal(p1.tablePage.total, all.length); assert.equal(p1.headerCounts.total, all.length);
    assert.deepEqual(ids(p1.tablePage.rows), ids(all).slice(0, PAGE_SIZE)); assert.deepEqual(ids(p2.tablePage.rows), ids(all).slice(PAGE_SIZE, PAGE_SIZE * 2));
    assert.equal(p1.kanbanItems, null);
    const [{ ai }] = await sql`select count(*)::int ai from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)} and outcome='ai_done'`;
    assert.equal(p1.headerCounts.aiDone, ai);
    const r0 = p1.tablePage.rows[0], [raw] = await sql`select subject, consultant_id::text consultant_id from public.enrollment_consultations where id=${r0.id}`;
    assert.equal(r0.subject, raw.subject); assert.equal(r0.consultantId, raw.consultant_id);
    assert.ok(!('personConsultCount' in r0), '목록은 N건 배지 재료를 싣지 않는다(2.0 ConsultationTableRow)');

    // 달(KST 경계) — 데이터가 있는 달 하나
    const [{ m }] = await sql`select to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM') m from public.enrollment_consultations where tenant_id=${t} order by consulted_at desc limit 1 offset 100`;
    const inMonth = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM')=${m} order by consulted_at desc, id`;
    assert.deepEqual(ids((await load(sql, { month: m })).kanbanItems), ids(inMonth), m);
    // 접수일(created_at KST) — 달보다 앞선다
    const [{ dday }] = await sql`select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') dday from public.enrollment_consultations where tenant_id=${t} order by created_at desc limit 1`;
    const onDay = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD')=${dday} order by consulted_at desc, id`;
    assert.deepEqual(ids((await load(sql, { received: dday, month: m })).kanbanItems), ids(onDay), dday);
    // 없는 날짜는 필터 없음(2.0 isValidYmd)
    assert.deepEqual(ids((await load(sql, { received: '2026-02-30' })).kanbanItems), ids(await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 3)} order by consulted_at desc, id`));
    // 상담사
    const [{ cid }] = await sql`select consultant_id::text cid from public.enrollment_consultations where tenant_id=${t} and consultant_id is not null and consulted_at >= ${since(sql, 12)} group by 1 order by count(*) desc limit 1`;
    assert.deepEqual(ids((await load(sql, { range: '1y', consultant: cid })).kanbanItems),
      ids(await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)} and consultant_id=${cid} order by consulted_at desc, id`));
    // 단계(2.0 board-stages 원값 묶음) — 4칸 전부
    const B = await importV2('features/enrollment/board-stages.ts');
    for (const st of B.BOARD_STAGES) {
      const want = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)} and outcome::text = any(${B.outcomesOfStage(st.key)}) order by consulted_at desc, id`;
      assert.deepEqual(ids((await load(sql, { range: '1y', outcome: st.key })).kanbanItems), ids(want), st.key);
    }
    // 검색 — 이름·전화·학교(부분 일치 · 괄호·쉼표는 빈칸으로)
    const [{ nm }] = await sql`select left(prospect_name, 1) nm from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)} limit 1`;
    const hit = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${since(sql, 12)}
      and (prospect_name ilike ${'%' + nm + '%'} or parent_phone ilike ${'%' + nm + '%'} or prospect_school ilike ${'%' + nm + '%'}) order by consulted_at desc, id`;
    assert.deepEqual(ids((await load(sql, { range: '1y', q: ` ${nm} ` })).kanbanItems), ids(hit));
  });
});

test('매개변수 거절 · 폴링은 건수만', { skip: SKIP }, async () => {
  const ok = (k, v) => screen.params[k].test(v);
  assert.ok(ok('view', 'stats') && !ok('view', 'board'));
  assert.ok(ok('v2path', '/enrollment/new') && ok('v2path', '/enrollment/0b6d5c1e-0000-4000-8000-000000000000/edit') && !ok('v2path', '/students'));
  assert.ok(!ok('page', '-1') && !ok('actor', 'x') && !ok('poll', 'all'));
  await run(async (sql) => {
    const d = await load(sql, { poll: 'count' });
    const [{ n }] = await sql`select count(*)::int n from public.enrollment_consultations where tenant_id=${t}`;
    assert.deepEqual(d, { page: 'poll', count: n });
    assert.equal((await load(sql, { v2path: '/enrollment/new' })).page !== 'list', true);
  });
});

test('화면 글자 — 2.0·내부 이름이 보이지 않는다 · 껍데기는 운영 주소·끼워 넣기·쓰기 요청이 없다', async () => {
  const shell = await here('./v2-screen-enrollment.js'), entry = await here('./v2-host/src/enrollment.tsx'), page = await here('./v2-host/src/enrollment-page.tsx');
  for (const [name, text] of [['껍데기', shell], ['진입점', entry], ['조립', page]]) {
    const c = code(text);
    assert.ok(!/['"`][^'"`\n]*2\.0[^'"`\n]*['"`]/.test(c), `${name}: 화면 글자에 2.0`);
    // 사람이 읽는 글자(한글이 든 문자열)에 내부 이름이 없다.
    for (const lit of c.match(/(['"`])(?:(?!\1)[^\n])*[가-힣](?:(?!\1)[^\n])*\1/g) ?? [])
      assert.ok(!/Docker|복사본|[a-z]+_[a-z_]+|\bget[A-Z]\w+|\bv2-/.test(lit), `${name}: 내부 이름 ${lit}`);
  }
  assert.ok(!/https?:\/\//.test(code(shell)), '껍데기에 바깥 주소');
  assert.ok(!/method:\s*['"]POST/.test(shell) && !/method:\s*['"]POST/.test(entry), '보기 경로에서 쓰기 요청');
});
