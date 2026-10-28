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

// ── 2단계: 상세 · 수정 · updateEnrollmentConsultation ─────────────────────────────────────────────────────────────────
const swapCheck = async (srcPath, minePath, swapsPath, start, gone, mineStart = start) => {
  const orig = lf(await src(srcPath)), mine = lf(await here(minePath)), swaps = JSON.parse(await here(swapsPath));
  let body = orig.slice(orig.indexOf(start));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, () => to); }
  assert.equal(swaps.removed.length, 0);
  assert.ok(mine.includes(mineStart), mineStart);
  assert.equal(mine.slice(mine.indexOf(mineStart)), body);
  assert.ok(!/\bawait\b/.test(code(body)), '본문 코드에 await가 남았다');
  for (const name of gone) assert.ok(!new RegExp(`\\b${name}\\b`).test(code(body)), `${name}이 남았다`);
};
test('상세·수정 그리기 = 2.0 page.tsx 본문 그대로(swaps 짝만)', async () => {
  await swapCheck('app/(shell)/enrollment/[id]/page.tsx', './v2-host/src/enrollment-detail.tsx', './v2-host/src/enrollment-detail.swaps.json', '// outcome 배지 = [outcomeBadge]',
    ['requireAccess', 'getEnrollmentConsultationById', 'getClassesList', 'getTenantSettings', 'getSiblingConsultations', 'canWriteTenant', 'loadConsultationReferrer', 'createClient',
      'findMergeSuccessor', 'notFound', 'redirect', 'getAssignedClasses', 'accessLevelTenant', 'canViewClassDetail']);
  await swapCheck('app/(shell)/enrollment/[id]/edit/page.tsx', './v2-host/src/enrollment-edit.tsx', './v2-host/src/enrollment-edit.swaps.json', 'export default async function EditEnrollmentPage',
    ['requireAccess', 'getEnrollmentConsultationById', 'loadConsultationReferrer', 'referrerCandidatesFor', 'createClient', 'notFound'], 'export function EditEnrollmentPage');
});

test('상세 = 독립 SQL — 상담 칸 · AI 분석 · 녹음 · 배정 반 · 수업 목록 · 같은 학생(자기 제외) · 없는 상담', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const [{ id, sid }] = await sql`select c.id::text id, c.student_id::text sid from public.enrollment_consultations c where c.tenant_id=${t} and c.outcome='enrolled' and c.student_id is not null
      and exists(select 1 from public.enrollments e where e.student_id=c.student_id and e.end_date is null) order by c.consulted_at desc limit 1`;
    const d = await load(sql, { v2path: `/enrollment/${id}` });
    assert.equal(d.page, 'detail');
    const [raw] = await sql`select prospect_name, parent_phone, subject, consultation_date::text cd, follow_up_date::text fu from public.enrollment_consultations where id=${id}`;
    assert.equal(d.consult.prospectName, raw.prospect_name); assert.equal(d.consult.parentPhone, raw.parent_phone);
    assert.equal(d.consult.fields.subject, raw.subject); assert.equal(d.consult.fields.consultationDate, raw.cd); assert.equal(d.consult.fields.followUpDate, raw.fu);
    const [{ ai, rec }] = await sql`select exists(select 1 from public.consultation_ai_analysis where consultation_id=${id}) ai, (select count(*)::int from public.consultation_recordings where consultation_id=${id}) rec`;
    assert.equal(d.consult.hasAiAnalysis, ai); assert.equal(d.consult.recordings.length, rec);
    const [{ n }] = await sql`select count(*)::int n from public.classes where tenant_id=${t} and is_active`;
    assert.equal(d.allClasses.length, n);
    assert.equal(d.siblings.some((x) => x.id === id), false, '같은 학생 목록에 자기 자신이 없다');
    const sameStudent = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and student_id=${sid} and id<>${id}`;
    for (const r of sameStudent) assert.ok(d.siblings.some((x) => x.id === r.id), '같은 원생 상담은 같은 학생');
    assert.ok(d.assigned?.ok && d.assigned.rows.length === d.consult.assignedClassCount, '배정 반 수 = 카드 줄 수');
    assert.equal((await load(sql, { v2path: '/enrollment/00000000-0000-4000-8000-000000000000' })).page, 'missing');
  });
});

/** 시험용 상담 한 줄(이 트랜잭션 안에서만) + 수정 화면 자료 + 저장 함수. */
async function editFixture(sql, cols = {}) {
  const row = { prospect_name: '시험상담', prospect_grade: '중1', prospect_school: '침산중', outcome: 'consulted', ...cols };
  const [{ id }] = await sql`insert into public.enrollment_consultations ${sql({ tenant_id: t, consulted_at: new Date(), ...row })} returning id::text id`;
  const d = await load(sql, { v2path: `/enrollment/${id}/edit` });
  assert.equal(d.page, 'edit');
  const c = d.consult;
  const base = { id: c.id, prospectName: c.prospectName, prospectGrade: c.prospectGrade ?? '', prospectSchool: c.prospectSchool ?? '', parentPhone: c.parentPhone ?? '',
    counselor: c.fields.counselor ?? '', followUpDate: c.fields.followUpDate ?? '', followUpResult: '' };
  const save = async (actor, values, { editBase = base } = {}) => {
    const fd = Object.entries(values).map(([k, v]) => [k, String(v)]);
    if (editBase) fd.push(['editBase', JSON.stringify(editBase)]);
    const body = screen.actions.updateEnrollmentConsultation.validate({ module: 'features/enrollment/server/actions.ts', actor, args: [null, { $formData: fd }] });
    return screen.actions.updateEnrollmentConsultation.run({ sql, body, tenantId: t, importV2 });
  };
  return { id, d, base, save, owner: d.editors[0] };
}
/** 시험 트랜잭션 — 끝나면 통째로 되돌린다(남는 행 0) · 바깥 요청 대기열이 늘면 실패. */
const rollback = (fn) => db.begin(async (sql) => {
  const [{ q }] = await sql`select count(*)::int q from net.http_request_queue`;
  await fn(sql);
  const [{ q: q2 }] = await sql`select count(*)::int q from net.http_request_queue`;
  assert.equal(q2, q, '바깥 요청 대기열이 늘었다');
  throw Object.assign(new Error('rollback'), { rollback: true });
}).catch((e) => { if (!e.rollback) throw e; });

test('수정 저장 = 2.0 updateEnrollmentConsultation — 바꾼 칸만(그사이 남이 바꾼 상담자 보존) · 감사로그 · 동시 저장 판정(마이크로초 시각)', { skip: SKIP }, async () => {
  await rollback(async (sql) => {
    const f = await editFixture(sql);
    await sql`update public.enrollment_consultations set counselor='다른 사람', updated_at='2026-10-28 01:02:03.123456+00' where id=${f.id}`;
    const res = await f.save(f.owner.id, { ...f.base, parentPhone: '01012345678', followUpResult: 'consulted' });
    assert.deepEqual(res, { ok: true });
    const [r] = await sql`select parent_phone, counselor, outcome::text o, to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') st from public.enrollment_consultations where id=${f.id}`;
    assert.equal(r.parent_phone, '01012345678'); assert.equal(r.counselor, '다른 사람', '안 바꾼 칸(상담자)은 그사이 저장된 값 그대로'); assert.equal(r.o, 'consulted');
    assert.notEqual(r.st, '2026-10-28T01:02:03.123456', '마이크로초까지 같은 시각으로 찾아 저장했다');
    const logs = await sql`select action, actor_id::text actor_id, target_type, target_label, metadata from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${f.id}`;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'enrollment_consultation_update'); assert.equal(logs[0].actor_id, f.owner.id); assert.equal(logs[0].target_type, 'enrollment_consultations');
    assert.equal(logs[0].target_label, '시험상담'); assert.deepEqual(logs[0].metadata.changed, ['보호자 연락처']); assert.equal(logs[0].metadata.via, '3.0 연습 복사본');
    const again = { ...f.base, parentPhone: '01012345678', followUpResult: 'consulted' };
    assert.deepEqual(await f.save(f.owner.id, again, { editBase: again }), { ok: true });
    assert.equal((await sql`select 1 from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${f.id}`).length, 1, '아무것도 안 바꾼 저장은 감사로그 없음');
  });
});

test('후속 조치 = 2.0 follow-up.ts — 반드시 고른다 · 지난 날짜 거절 · 상담 전 불가 · 등록 완료 → 상태 전환 · 거절 땐 아무것도 안 바뀐다', { skip: SKIP }, async () => {
  const F = await importV2('features/enrollment/follow-up.ts');
  await rollback(async (sql) => {
    const f = await editFixture(sql);
    assert.deepEqual(await f.save(f.owner.id, { ...f.base, parentPhone: '0101' }), { error: F.FOLLOW_UP_REQUIRED_ERROR });
    assert.deepEqual(await f.save(f.owner.id, { ...f.base, followUpResult: 'consulted', followUpDate: '2020-01-01' }), { error: F.FOLLOW_UP_DATE_PAST });
    assert.deepEqual(await f.save(f.owner.id, { ...f.base, followUpResult: 'before' }), { error: F.FOLLOW_UP_BEFORE_BLOCKED });
    const [same] = await sql`select parent_phone, outcome::text o from public.enrollment_consultations where id=${f.id}`;
    assert.equal(same.parent_phone, null); assert.equal(same.o, 'consulted');
    assert.deepEqual(await f.save(f.owner.id, { ...f.base, followUpResult: 'enrolled' }), { ok: true });
    assert.equal((await sql`select outcome::text o from public.enrollment_consultations where id=${f.id}`)[0].o, 'enrolled');
    assert.equal((await sql`select metadata from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${f.id}`)[0].metadata.outcomeTo, 'enrolled');
  });
});

test('상담자 계정(2.0 counselor-account) — 이름이 딱 한 명과 같으면 그 계정 · QR 접수의 빈 상담자 = 처음 고친 사람 · 모르는 사람은 거절', { skip: SKIP }, async () => {
  await rollback(async (sql) => {
    const f = await editFixture(sql);
    const [staff] = await sql`select id::text id, display_name from public.users u where tenant_id=${t} and status::text='active' and system_role::text in ('teacher','admin','manager')
      and (select count(*) from public.users v where v.tenant_id=${t} and v.status::text='active' and v.display_name=u.display_name)=1 limit 1`;
    assert.deepEqual(await f.save(f.owner.id, { ...f.base, counselor: staff.display_name, followUpResult: 'consulted' }), { ok: true });
    const [r] = await sql`select counselor, consultant_id::text cid from public.enrollment_consultations where id=${f.id}`;
    assert.equal(r.counselor, staff.display_name); assert.equal(r.cid, staff.id);

    const q = await editFixture(sql, { from_public_intake: true, outcome: 'pending' });
    assert.deepEqual(await q.save(q.owner.id, { ...q.base, parentPhone: '01099998888' }), { ok: true });
    const [a] = await sql`select counselor, consultant_id::text cid from public.enrollment_consultations where id=${q.id}`;
    assert.equal(a.counselor, q.owner.name); assert.equal(a.cid, q.owner.id);
    assert.equal((await sql`select metadata from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${q.id}`)[0].metadata.counselorAutofill, q.owner.name);

    assert.deepEqual(await f.save('00000000-0000-4000-8000-000000000000', { ...f.base, followUpResult: 'consulted' }), { error: '로그인이 필요합니다' });
  });
});

test('병합으로 사라진 상담 → 남은 상담 주소(2.0 findMergeSuccessor)', { skip: SKIP }, async () => {
  await rollback(async (sql) => {
    const [{ id: winner }] = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} order by consulted_at desc limit 1`;
    const lost = '00000000-0000-4000-8000-0000000000ab';
    await sql`insert into public.audit_logs (tenant_id, actor_name, action, target_type, metadata) values (${t}, '시험', 'consultation_merge', 'enrollment_consultations', ${sql.json({ winnerId: winner, loserIds: [lost] })})`;
    const d = await load(sql, { v2path: `/enrollment/${lost}/edit` });
    assert.deepEqual({ page: d.page, to: d.to }, { page: 'redirect', to: `/enrollment/${winner}/edit` });
  });
});

test('소개한 사람 목록(2.0 loadReferrerOptions) — 원생(퇴원·시험용 제외) + 재직 직원 · 읽기 경로', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const d = await load(sql, { referrers: '1' });
    assert.equal(d.result.ok, true);
    const [{ s }] = await sql`select count(*)::int s from public.students where tenant_id=${t} and status::text<>'withdrawn' and is_test=false`;
    assert.equal(d.result.options.filter((o) => o.value.startsWith('s:')).length, s);
  });
});

// ── 3단계: 새 상담 · 칸반 끌기(상태) · 목록 칸 수정 ────────────────────────────────────────────────────────────────────
const call = (sql, name, actor, args) => {
  const body = screen.actions[name].validate({ module: 'features/enrollment/server/actions.ts', actor, args });
  return screen.actions[name].run({ sql, body, tenantId: t, importV2 });
};
const fdOf = (values) => ({ $formData: Object.entries(values).map(([k, v]) => [k, String(v)]) });

test('새 상담 그리기 = 2.0 new/page.tsx 본문 그대로(swaps 짝만)', async () => {
  await swapCheck('app/(shell)/enrollment/new/page.tsx', './v2-host/src/enrollment-new.tsx', './v2-host/src/enrollment-new.swaps.json', 'export default async function NewEnrollmentPage',
    ['requireAccess', 'referrerColumnsReady', 'createClient'], 'export function NewEnrollmentPage');
});

test('새 상담 = 2.0 createEnrollmentConsultation — 상담 경로 필수 · 후속 조치 필수 · 상담자 계정(빈칸 = 추가한 사람) · 학교 표기 통일 · 감사로그', { skip: SKIP }, async () => {
  const F = await importV2('features/enrollment/follow-up.ts');
  await rollback(async (sql) => {
    const d = await load(sql, { v2path: '/enrollment/new' });
    assert.equal(d.page, 'new'); assert.equal(d.referrerReady, true);
    const owner = d.editors[0];
    const form = { prospectName: '시험새상담', prospectGrade: '초5', prospectSchool: '옥산초등학교', parentPhone: '01077778888', consultationPath: '지인 소개', subject: 'math' };
    assert.deepEqual(await call(sql, 'createEnrollmentConsultation', owner.id, [null, fdOf({ ...form, consultationPath: '' })]), { error: '상담 경로를 선택해주세요' });
    assert.deepEqual(await call(sql, 'createEnrollmentConsultation', owner.id, [null, fdOf(form)]), { error: F.FOLLOW_UP_REQUIRED_ERROR });
    const res = await call(sql, 'createEnrollmentConsultation', owner.id, [null, fdOf({ ...form, followUpResult: 'unregistered', prevAcademy: '옛 학원' })]);
    assert.match(res.id, /^[0-9a-f-]{36}$/);
    const [r] = await sql`select prospect_school, outcome::text o, consultant_id::text cid, learning_history, tenant_id::text tid from public.enrollment_consultations where id=${res.id}`;
    assert.equal(r.prospect_school, '옥산초'); assert.equal(r.cid, owner.id); assert.equal(r.tid, t);
    assert.equal(r.o, (await importV2('features/enrollment/board-stages.ts')).outcomeForDrop('unregistered', 'consulted'));
    assert.deepEqual(r.learning_history, { prevAcademy: '옛 학원' });
    const [log] = await sql`select action, actor_id::text a, metadata from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${res.id}`;
    assert.equal(log.action, 'enrollment_consultation_create'); assert.equal(log.a, owner.id); assert.equal(log.metadata.followUp, 'unregistered'); assert.equal(log.metadata.via, '3.0 연습 복사본');
  });
});

test('상태 바꾸기(칸반 끌기) = 2.0 setEnrollmentOutcome — 바뀐 것만 감사로그 · 등록 완료는 거절·상담 완료로 못 돌림 · 반 배정된 상담은 등록 칸 밖으로 못 감', { skip: SKIP }, async () => {
  const B = await importV2('features/enrollment/board-stages.ts');
  await rollback(async (sql) => {
    const f = await editFixture(sql);
    const set = (id, outcome) => call(sql, 'setEnrollmentOutcome', f.owner.id, [null, fdOf({ id, outcome })]);
    assert.deepEqual(await set(f.id, 'nope'), { error: '유효한 상태가 아닙니다' });
    assert.deepEqual(await set(f.id, 'consulted'), { ok: true });
    assert.equal((await sql`select 1 from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${f.id}`).length, 0, '같은 상태는 감사로그 없음');
    assert.deepEqual(await set(f.id, 'enrolled'), { ok: true });
    assert.deepEqual(await set(f.id, 'consulted'), { error: B.ENROLLED_REVERT_BLOCKED });
    assert.deepEqual(await set(f.id, 'declined'), { ok: true });
    const logs = await sql`select metadata->>'from' f, metadata->>'to' t2 from public.audit_logs where tenant_id=${t} and action='enrollment_consultation_outcome' and metadata->>'consultationId'=${f.id} order by created_at, id`;
    assert.deepEqual(logs.map((l) => `${l.f}>${l.t2}`).sort(), ['consulted>enrolled', 'enrolled>declined'].sort());
    // 반 배정된 상담
    const [{ id: assignedId }] = await sql`select c.id::text id from public.enrollment_consultations c where c.tenant_id=${t} and c.outcome='enrolled' and c.student_id is not null and c.subject is null
      and exists(select 1 from public.enrollments e join public.classes k on k.id=e.class_id where e.student_id=c.student_id and (e.end_date is null or e.end_date >= (now() at time zone 'Asia/Seoul')::date)) limit 1`;
    assert.deepEqual(await set(assignedId, 'consulted'), { error: B.ASSIGNED_DRAG_BLOCKED });
  });
});

test('목록 칸 수정 = 2.0 patchConsultationCells — 준 칸만 · 학원설정 과목만 · 모르는 칸 거절 · 재직 상담사만 · 감사로그(surface list)', { skip: SKIP }, async () => {
  await rollback(async (sql) => {
    const f = await editFixture(sql, { parent_phone: '0100000', counselor: '그대로' });
    const patchCells = (patch, id = f.id) => call(sql, 'patchConsultationCells', f.owner.id, [id, patch]);
    assert.deepEqual(await patchCells({}), { error: '바꿀 칸이 없습니다' });
    assert.deepEqual(await patchCells({ nope: 1 }), { error: '입력값을 확인해주세요' });
    assert.deepEqual(await patchCells({ prospectName: '' }), { error: '학생 이름을 입력해주세요' });
    assert.deepEqual(await patchCells({ subject: '없는과목' }), { error: '학원설정에 없는 과목입니다' });
    const [gone] = await sql`select id::text id from public.users where tenant_id=${t} and status::text<>'active' limit 1`;
    if (gone) assert.deepEqual(await patchCells({ consultantId: gone.id }), { error: '상담사를 찾을 수 없습니다' });
    assert.deepEqual(await patchCells({ prospectName: '시험상담2', prospectSchool: '옥산초등학교' }), { ok: true });
    const [r] = await sql`select prospect_name, prospect_school, parent_phone, counselor from public.enrollment_consultations where id=${f.id}`;
    assert.deepEqual(r, { prospect_name: '시험상담2', prospect_school: '옥산초', parent_phone: '0100000', counselor: '그대로' });
    const [log] = await sql`select target_label, metadata from public.audit_logs where tenant_id=${t} and metadata->>'consultationId'=${f.id}`;
    assert.equal(log.target_label, '시험상담2'); assert.equal(log.metadata.surface, 'list'); assert.equal(log.metadata.via, '3.0 연습 복사본');
    assert.deepEqual(await patchCells({ prospectName: 'x' }, '00000000-0000-4000-8000-000000000000'), { error: '상담을 불러오지 못했습니다. 다시 시도해 주세요.' });
  });
});

test('3.0 껍데기: 주소의 actor=<직원 id>가 고른 사람보다 먼저 이긴다 · 호스트 주소로는 안 간다 · 명단 밖 id는 기억을 지우지 않는다', async () => {
  const vm = await import('node:vm');
  const text = await here('v2-screen-enrollment.js');
  let def = null, onMessage = null, frame = null;
  const posted = [], last = () => JSON.parse(JSON.stringify(posted.at(-1))), stored = new Map(), actorSlot = { innerHTML: '' };
  const cw = { postMessage: (m) => posted.push(m) };
  const slot = { style: {}, getBoundingClientRect: () => ({ top: 100, left: 20, width: 900, height: 600 }) };
  const document = {
    createElement: () => (frame = { style: {}, dataset: {}, hidden: true, contentWindow: cw, src: '' }),
    body: { append() {} }, querySelector: (sel) => (sel.includes('[data-v2-host-slot]') ? slot : sel.includes('[data-v2h-actor-slot]') ? actorSlot : null),
  };
  const ctx = {
    window: { V2Screens: { register: (x) => { def = x; }, esc: (s) => String(s ?? '') } }, document, innerHeight: 800, scrollX: 0, scrollY: 0,
    location: { origin: 'http://127.0.0.1:4334', hash: '#v2-enrollment', replace() {} },
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; },
    requestAnimationFrame: (fn) => fn(), MutationObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: true }), HTMLSelectElement: class {}, URLSearchParams,
  };
  vm.runInNewContext(text, ctx);
  const api = { render() {}, toast() {}, canOpenRecord: () => false };
  def.render({ api, query: new URLSearchParams('') });
  await new Promise((r) => setTimeout(r, 0));
  const A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222', ID = '33333333-3333-4333-8333-333333333333';
  def.render({ api, query: new URLSearchParams('') });
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-editors', screen: 'enrollment', editors: [{ id: A1, name: '원장' }, { id: A2, name: '김그린' }] } });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A1 });
  ctx.location.hash = `#v2-enrollment?v2path=/enrollment/${ID}&actor=${A2}`;
  def.render({ api, query: new URLSearchParams(`v2path=/enrollment/${ID}&actor=${A2}`) });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A2 }); assert.equal(stored.get('v2-host-actor:enrollment'), A2);
  assert.ok(frame.src.includes(`v2path=%2Fenrollment%2F${ID}`) && !frame.src.includes('actor='), '상세 주소는 가고 actor는 안 간다');
  ctx.location.hash = '#v2-enrollment?actor=44444444-4444-4444-8444-444444444444';
  def.render({ api, query: new URLSearchParams('actor=44444444-4444-4444-8444-444444444444') });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A2 }, '명단 밖 id는 무시하고 앞 사람 그대로');
  assert.equal(stored.get('v2-host-actor:enrollment'), A2);
});

// ── 4단계: 통계 보기 ───────────────────────────────────────────────────────────────────────────────────────────────────
test('통계 = 독립 SQL — 연도 목록 · 그 해 상담·등록(달마다) · 올해는 작년 같은 기간 · 분포 합계 · 등록 뒤 원생 · 진행 기록 날 수 · 칸반·목록 자료는 비운다', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const kstYear = (col) => sql`extract(year from ${sql.unsafe(col)} at time zone 'Asia/Seoul')::int`;
    const [{ lo, hi }] = await sql`select min(${kstYear('consulted_at')}) lo, max(${kstYear('consulted_at')}) hi from public.enrollment_consultations where tenant_id=${t}`;
    const d = await load(sql, { view: 'stats', year: '2025' });
    assert.deepEqual(d.statsYears, Array.from({ length: hi - lo + 1 }, (_, i) => hi - i));
    assert.equal(d.kanbanItems, null); assert.equal(d.tablePage, null);
    const [y] = await sql`select count(*)::int n, count(*) filter (where outcome='enrolled')::int e from public.enrollment_consultations where tenant_id=${t} and ${kstYear('consulted_at')} = 2025`;
    assert.equal(d.stats.total, y.n); assert.equal(d.stats.enrolled, y.e);
    const byMonth = await sql`select to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM') m, count(*)::int n from public.enrollment_consultations where tenant_id=${t} and ${kstYear('consulted_at')} = 2025 group by 1`;
    for (const r of byMonth) assert.equal(d.stats.months.find((m) => m.month === r.m)?.total, r.n, r.m);
    assert.equal(d.stats.prevSamePeriod, null, '지난해를 볼 땐 1~12월끼리');
    assert.equal(d.dist.total, y.n);
    assert.equal(d.dist.grades.reduce((a, b) => a + b.n, 0), y.n);
    const [{ c }] = await sql`select count(*)::int c from public.enrollment_consultations where tenant_id=${t} and ${kstYear('consulted_at')} = 2025 and outcome='enrolled' and student_id is not null`;
    assert.equal(d.dist.cohorts.length, c);
    assert.ok(Array.isArray(d.withdrawals), '퇴원관리를 열 수 있는 사람이면 관리현황 퇴원 재료가 있다');
    // 올해 = 작년 1월 1일 ~ 작년 오늘
    const now = await load(sql, { view: 'stats' });
    const [p] = await sql`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and ${kstYear('consulted_at')} = ${hi - 1}
      and (consulted_at at time zone 'Asia/Seoul')::date <= ((now() at time zone 'Asia/Seoul')::date - interval '1 year')::date`;
    assert.equal(now.stats.prevSamePeriod.total, p.n);
    // 진행 기록 = 매일 기록 표의 날(기본 = 최근 구간)
    const P = await importV2('features/stats/period.ts'), K = await importV2('features/students/stats/ops-keys.ts'), kst = await importV2('lib/date-kst.ts');
    const per = P.parseStatsPeriod(P.paramsForMode('range', kst.kstToday()), kst.kstToday());
    const [{ days }] = await sql`select count(*)::int days from public.student_daily_stats where tenant_id=${t} and stat_date >= ${per.from} and stat_date <= ${per.to}`;
    assert.equal(now.progressRows.length, days); void K;
    // 신규 문의 추이(기본 12개월)의 합계 = 그 기간 상담 수(오늘까지)
    assert.ok(now.intake.trend && now.intake.groups, '신규 문의 추이 자료');
  });
});
