// 2.0 화면 — 직원 평가 시험 (Docker 복사본 · 네트워크·AI 없음). 🔴 출력에 점수·금액을 남기지 않는다(단언 실패 메시지에도 값 대신 개수·id만).
//   node --test experiments/owner-concept/verify-v2-screen-class-review.mjs
// ① 그리기 = 2.0 page.tsx 여섯 + portfolio-face.tsx 본문 그대로(서버 호출 자리만 swaps 짝 — 글자 대조)
// ② 게이트 = 2.0 그대로: 포트폴리오 면은 원장 역할만 · 못 지나면 그 조회를 하지 않는다 · 실명 열람이 없으면 이름을 보내지 않는다 · 목록·종합은 코멘트·총평을 보내지 않는다
// ③ 목록·상세·채점·새 평가·문항 세트·종합 = 독립 SQL(평가지 · 세트) · 읽기 서버 액션(비교 · 직접 입력 · 만족도)은 GET
// ④ 저장 = 2.0 함수 그대로(새 평가 → 평가자 교체 → 채점 → 총평 · 삭제 · 문항 세트 저장·삭제 · 지금 집계 · 마감한 달 직접 입력 거절) — 러너 되돌림 트랜잭션 안에서
//    표·감사로그 확인 → 남은 행 0 · 쓰기 뒤 역할·claims 원래대로 · 마감한 달은 그대로(DB 트리거도 거절) · 바깥 요청 큐 증가 0
// ⑤ 계정 보기 설정은 보내지 않는다 · 매개변수 거절 · 화면 글자 · 껍데기 주소 actor 규칙.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen, READS, WRITES, runWrite } from './v2-screen-class-review.mjs';
import { hideNames, listRow } from './v2-class-review-load.mjs';
import { runV2Server, stopV2Server } from './v2-server-runner.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const CR = 'features/class-review/server/actions.ts', TP = 'features/teacher-portfolio/server/';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
after(async () => { await stopV2Server(); await db?.end(); });

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (params) => run((sql) => screen.load({ sql, params, tenantId: t, importV2 }));
  var people = await load({ v2path: '/class-review/new' });
  var editors = people.editors;
  var master = editors.find((e) => e.role === '원장'), admin = editors.find((e) => e.role !== '원장');
}

// ── ① 그리기 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGES = [
  ['page.tsx', 'class-review-page.tsx', '/**\n * 수업 평가 체크리스트(참관) 목록', ['requireAccess', 'getReviewPrivileges', 'listClassReviews', 'getTenantSettings', 'getMyClassReviewFilter', 'getReviewViewer', 'myScoreSlot', 'observerLimitOf']],
  ['_components/portfolio/portfolio-face.tsx', 'class-review-portfolio.tsx', '/**\n * 직원 평가 > 직원 포트폴리오 면.', ['getPortfolioView', 'canWriteTenant', 'readMyUiPrefs']],
  ['[id]/page.tsx', 'class-review-detail.tsx', '/**\n * 참관 상세', ['requireAccess', 'getClassReview', 'getTenantSettings', 'getReviewPrivileges', 'canWriteTenant', 'getReviewViewer', 'getStaffOptions', 'observerColumns', 'myScoreSlot', 'observerLimitOf', 'notFound']],
  ['[id]/score/page.tsx', 'class-review-score.tsx', '/**\n * 채점 전용 페이지', ['requireAccess', 'getClassReview', 'getReviewViewer', 'myScoreSlot', 'notFound', 'redirect']],
  ['new/page.tsx', 'class-review-new.tsx', '/**\n * 새 평가 건', ['requireAccess', 'getReviewViewer', 'getStaffOptions', 'getTenantSettings', 'getChecklistTemplates', 'redirect']],
  ['template/page.tsx', 'class-review-template.tsx', '/**\n * 문항 세트 관리', ['requireAccess', 'getReviewPrivileges', 'getChecklistTemplates', 'redirect']],
  ['board/page.tsx', 'class-review-board.tsx', '/**\n * 종합 보기', ['requireAccess', 'getReviewPrivileges', 'listClassReviews', 'getTenantSettings', 'redirect']],
];
test('그리기 = 2.0 page.tsx 여섯 + portfolio-face.tsx 본문 그대로 — 서버 호출 자리만 swaps 짝(짝마다 한 번) · 서버 함수가 남지 않는다', async () => {
  for (const [file, mine, start, gone] of PAGES) {
    const orig = lf(await src(`app/(shell)/class-review/${file}`)), host = lf(await here(`./v2-host/src/${mine}`));
    const swaps = JSON.parse(await here(`./v2-host/src/${mine.replace('.tsx', '.swaps.json')}`));
    assert.ok(orig.includes(start), `${file}: 시작`);
    let body = orig.slice(orig.indexOf(start));
    for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, `${file}: ${from.slice(0, 50)}`); body = body.replace(from, () => to); }
    assert.equal(swaps.removed.length, 0);
    assert.equal(host.slice(host.indexOf(start)), body, `${mine}: 본문이 2.0과 다르다`);
    assert.ok(!/\bawait\b/.test(code(body)), `${mine}: await가 남았다`);
    for (const name of gone) assert.ok(!new RegExp(`\\b${name}\\(`).test(code(body)), `${mine}: ${name} 호출이 남았다`);
    // 브라우저 묶음에 서버 전용 모듈을 싣지 않는다 — 서버 모듈은 타입만.
    for (const m of host.match(/^import (?!type ).*from "(@\/features\/[^"]*\/server\/[^"]*)";$/gm) ?? []) assert.fail(`${mine}: 서버 모듈 import ${m}`);
  }
});

// ── ② 게이트 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('보는 사람 = 직원 평가 메뉴가 열린 재직 직원 · 포트폴리오 면은 원장 역할만 — 못 지나면 직원 평가 면(포트폴리오 조회 없음)', { skip: SKIP }, async () => {
  assert.ok(master && admin, '원장 · 원장 아닌 사람이 다 있어야 시험한다');
  const m = await load({ tab: 'portfolio', actor: master.id });
  assert.equal(m.page, 'portfolio'); assert.equal(m.priv.seePortfolio, true); assert.equal(m.view?.state, 'ready'); assert.equal(m.canRefresh, true);
  assert.deepEqual(m.prefs, {}, '계정 보기 설정은 읽지 않는다');
  const a = await load({ tab: 'portfolio', actor: admin.id });
  assert.equal(a.page, 'list', '원장 아닌 사람은 2.0처럼 직원 평가 면'); assert.equal(a.priv.seePortfolio, false);
  assert.ok(!('view' in a), '포트폴리오 조회를 하지 않았다');
  // 읽기 서버 액션도 2.0 게이트 그대로.
  assert.deepEqual((await load({ read: 'loadPortfolioComparison', args: '["2026-10"]', actor: admin.id })).result, { ok: false, error: '직원 포트폴리오를 볼 권한이 없습니다' });
  assert.equal((await load({ read: 'loadPortfolioComparison', args: '["2026-10"]', actor: master.id })).result.ok, true);
  assert.equal((await load({ read: 'loadEvaluationEntries', args: JSON.stringify([master.id, '2026-10']), actor: admin.id })).result.ok, false);
  // 꺼진 지점 · 메뉴 밖 사람: 명단 밖 actor면 첫 사람(원장 먼저 — 공통 규칙).
  assert.equal((await load({ v2path: '/class-review/new', actor: '00000000-0000-4000-8000-000000000000' })).page, 'new');
});

test('업무 흐름 판정 id = 원본 월 근거의 선생님·만족도 창으로 진입 · 몫 없는 글과 권한 없는 사람은 분리', { skip: SKIP }, async () => {
  const [mapped] = await db`select j.id::text id, p.teacher_id::text teacher, p.month
    from public.teacher_satisfaction_judgments j join public.teacher_portfolio_months p on p.tenant_id=j.tenant_id and p.month=left(j.posted_on::text, 7)
      and p.payload @> jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', 'satisfaction', 'detail', jsonb_build_array(jsonb_build_object('source', '글', 'key', j.id::text)))))
    where j.tenant_id=${t} and j.state='pending' order by j.posted_on desc limit 1`;
  assert.ok(mapped, '선생님 근거에 연결된 대기 글이 있다');
  const focused = await load({ judgment: mapped.id, actor: master.id });
  assert.equal(focused.page, 'portfolio');
  assert.deepEqual(focused.focusJudgment, { id: mapped.id, month: mapped.month });
  assert.equal(focused.view.selected.id, mapped.teacher);
  assert.equal((await load({ judgment: mapped.id, actor: admin.id })).page, 'notFound', '포트폴리오 권한을 먼저 확인한다');
  assert.equal((await load({ judgment: '00000000-0000-4000-8000-000000000000', actor: master.id })).page, 'judgmentMissing');
  const [unassigned] = await db`select j.id::text id from public.teacher_satisfaction_judgments j where j.tenant_id=${t} and j.state='pending' and j.class_id is null limit 1`;
  if (unassigned) assert.equal((await load({ judgment: unassigned.id, actor: master.id })).page, 'judgmentUnassigned');
});

test('만족도 저장 = JSONB 포함 근거를 독립 SQL과 대조 · 원본 가점 반영은 시험 트랜잭션에서만', { skip: SKIP }, async () => {
  const id = '790d738f-4f86-4a1a-9952-78409ec1c39c';
  const [judgment] = await db`select posted_on::text posted, state::text state from public.teacher_satisfaction_judgments where tenant_id=${t} and id=${id}`;
  assert.ok(judgment && judgment.state === 'pending');
  const month = judgment.posted.slice(0, 7);
  const needle = { items: [{ id: 'satisfaction', detail: [{ source: '글', key: id }] }] };
  const direct = await db`select teacher_id::text teacher, closed_at is not null closed from public.teacher_portfolio_months
    where tenant_id=${t} and month=${month} and payload @> ${db.json(needle)}::jsonb`;
  assert.equal(direct.length, 1, '독립 SQL에서 이 글의 포트폴리오 몫은 한 선생님');
  const teacherId = direct[0].teacher;
  const focused = await load({ judgment: id, actor: master.id });
  assert.equal(focused.page, 'portfolio');
  assert.equal(focused.view.selected.id, teacherId, '진입 화면의 선생님 = 원본 근거의 선생님');
  assert.equal(focused.focusJudgment.month, month, '진입 화면의 달 = 글 날짜의 달');
  const { results: [owner] } = await runV2Server({ steps: [{ module: `${TP}satisfaction-guards.ts`, fn: 'ownsJudgment', args: [t, teacherId, id, month] }], tenantId: t, mode: 'read' });
  assert.deepEqual(owner.value, { closed: direct[0].closed }, '원본 .contains 결과 = 독립 SQL @> 결과');
  const { results: [wrongMonth] } = await runV2Server({ steps: [{ module: `${TP}satisfaction-guards.ts`, fn: 'ownsJudgment', args: [t, teacherId, id, '2026-09'] }], tenantId: t, mode: 'read' });
  assert.equal(wrongMonth.value, null, '다른 달은 열리지 않는다');
  const { results: [saved], probes } = await runWrite(t, master.id,
    [{ module: `${TP}satisfaction-actions.ts`, fn: 'decideJudgment', args: [id, 'plus', teacherId] }],
    { rollback: true, probes: [{ text: 'select state::text state from public.teacher_satisfaction_judgments where tenant_id=$1 and id=$2', params: [t, id] }] });
  assert.equal(saved.value?.ok, true, saved.value?.error);
  assert.equal(probes[0][0].state, 'applied');
  const [after] = await db`select state::text state from public.teacher_satisfaction_judgments where tenant_id=${t} and id=${id}`;
  assert.equal(after.state, 'pending', '시험 뒤 원래 상태');
});

test('2.0이 보내지 않던 것은 보내지 않는다 — 실명 열람이 없으면 이름 비움 · 목록·종합 행은 코멘트·총평·문항 스냅샷 없이', () => {
  const doc = { id: 'd', header: { teacherId: 't' }, evaluators: [{ id: 'a', name: '갑', kind: 'observer' }, { id: 't', name: '을', kind: 'self' }],
    submissions: { a: { scores: [3], comment: '비밀 코멘트', submittedAt: 'x', by: { id: 'a', name: '갑' } } }, finalReview: { text: '총평', updatedAt: 'y', by: { id: 'a', name: '갑' } } };
  const h = hideNames(doc);
  assert.deepEqual(h.evaluators.map((e) => e.name), ['', '']); assert.equal(h.submissions.a.by.name, ''); assert.equal(h.finalReview.by.name, '');
  assert.equal(h.submissions.a.comment, '비밀 코멘트', '상세는 코멘트를 그린다(이름만 익명)'); assert.equal(doc.evaluators[0].name, '갑', '원본은 그대로');
  const r = listRow({ ...doc, areas: [], templateName: 'x', submittedCount: 1, observerSlots: 2, averages: null }, false);
  assert.ok(!('finalReview' in r) && !('areas' in r) && !('comment' in r.submissions.a)); assert.equal(r.submissions.a.by.name, '');
  assert.equal(listRow({ ...doc, submittedCount: 1, observerSlots: 2, averages: null }, true).submissions.a.by.name, '갑');
});

test('강사 자기 평가 = 본인 슬롯 한 장만 남고 타인 채점·평가자·총평은 빠진다', { skip: SKIP }, async () => {
  const [teacher] = await db`select id::text id from public.users where tenant_id=${t} and status::text='active' and system_role::text='teacher' limit 1`;
  assert.ok(teacher);
  const selfOnly = await importV2('features/class-review/self-only.ts');
  assert.equal(selfOnly.isSelfOnlyReviewer('teacher'), true);
  const doc = { id: 'd', header: { teacherId: teacher.id, observerMode: 'open', observerLimit: 3 },
    evaluators: [{ id: teacher.id, name: '본인', kind: 'self' }, { id: master.id, name: '관찰자', kind: 'observer' }],
    submissions: { self: { scores: [3], comment: '본인 기록' }, [master.id]: { scores: [4], comment: '타인 기록' } },
    finalReview: { text: '총평', by: { id: master.id, name: '관찰자' } } };
  const safe = selfOnly.redactForSelfOnly(doc);
  assert.deepEqual(Object.keys(safe.submissions), ['self']);
  assert.deepEqual(safe.evaluators.map((e) => e.kind), ['self']);
  assert.equal(safe.finalReview, undefined);
  assert.equal(safe.header.observerMode, 'assigned');
  const { results: [mine] } = await runV2Server({ steps: [{ module: 'features/class-review/server/queries.ts', fn: 'myScoreSlot', args: [safe, teacher.id] }], actorId: teacher.id, tenantId: t, mode: 'read' });
  assert.deepEqual(mine.value, { slot: 'self', submitted: true });
  const score = await here('./v2-host/src/class-review-score.tsx');
  assert.match(score, /mine\.slot === "self" \? "본인 평가" : "채점"/);
});

// ── ③ 보기 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('목록 = 독립 SQL(평가지 최신순 · 머리) · 내 채점 자리 · 정원 · 보기 필터 = 2.0 기본값', { skip: SKIP }, async () => {
  const d = await load({ actor: master.id });
  assert.equal(d.page, 'list');
  const rows = await db`select id::text id, form_data from public.academy_documents where tenant_id = ${t} and form_type = 'class_review' order by created_at desc limit 200`;
  assert.deepEqual(d.rows.map((r) => r.id), rows.map((r) => r.id));
  for (const r of d.rows) {
    const raw = rows.find((x) => x.id === r.id).form_data;
    assert.equal(r.header.teacherId, raw.header?.teacherId ?? ''); assert.equal(r.header.date, raw.header?.date ?? '');
    assert.ok(r.id in d.mine && Number.isInteger(d.limits[r.id]));
    for (const s of Object.values(r.submissions)) assert.ok(!('comment' in s));
  }
  assert.equal(d.myFilter, (await importV2('features/class-review/list-filter.ts')).normalizeClassReviewFilter(undefined));
});

test('상세 · 채점 · 새 평가 · 문항 세트 · 종합 = 독립 SQL · 없는 평가지 · 채점 자격 없으면 상세로', { skip: SKIP }, async () => {
  const list = await load({ actor: master.id });
  const seated = list.rows.find((r) => list.mine[r.id]), unseated = list.rows.find((r) => !list.mine[r.id]);
  const det = await load({ v2path: `/class-review/${seated.id}`, actor: master.id });
  assert.equal(det.page, 'detail'); assert.equal(det.found.doc.id, seated.id);
  const [raw] = await db`select form_data from public.academy_documents where id = ${seated.id}`;
  assert.deepEqual(det.found.doc.submissions, raw.form_data.submissions ?? {});
  assert.deepEqual(det.mine, list.mine[seated.id]); assert.equal(det.observerLimit, list.limits[seated.id]);
  if (det.found.doc.header.observerMode === 'open') assert.deepEqual(det.staffOptions, [], '선착순은 평가자 관리 명단 없음');
  const sc = await load({ v2path: `/class-review/${seated.id}/score`, actor: master.id });
  assert.equal(sc.page, 'score'); assert.deepEqual(sc.mine, list.mine[seated.id]);
  assert.deepEqual(Object.keys(sc.doc).sort(), ['header', 'id'], '채점 화면엔 다른 채점을 보내지 않는다');
  if (unseated) assert.deepEqual(await load({ v2path: `/class-review/${unseated.id}/score`, actor: master.id }).then((x) => ({ page: x.page, to: x.to })), { page: 'redirect', to: `/class-review/${unseated.id}` });
  assert.equal((await load({ v2path: '/class-review/00000000-0000-4000-8000-000000000000', actor: master.id })).page, 'missing');
  const sets = await db`select id::text id from public.academy_documents where tenant_id = ${t} and form_type = 'class_review_template' order by created_at limit 50`;
  const tpl = await load({ v2path: '/class-review/template', actor: master.id });
  assert.equal(tpl.page, 'template'); assert.deepEqual(tpl.templates.map((x) => x.id), sets.map((x) => x.id));
  const nw = await load({ v2path: '/class-review/new', actor: master.id });
  assert.deepEqual(nw.templates.map((x) => x.id), sets.map((x) => x.id)); assert.ok(nw.staff.length > 0);
  const bd = await load({ v2path: '/class-review/board', actor: master.id });
  assert.equal(bd.page, 'board'); assert.deepEqual(bd.rows.map((r) => r.id), list.rows.map((r) => r.id)); assert.ok(bd.areas.length > 0);
});

test('매개변수 거절 · 읽기 이름은 셋뿐', () => {
  const ok = (k, v) => screen.params[k].test(v);
  assert.ok(ok('v2path', '/class-review/board') && ok('v2path', '/class-review/0b6d5c1e-0000-4000-8000-000000000000/score') && !ok('v2path', '/class-review/x') && !ok('v2path', '/staff'));
  assert.ok(ok('tab', 'portfolio') && !ok('tab', 'all') && !ok('teacher', 'x') && ok('new', '1') && !ok('new', '2') && ok('judgment', '0b6d5c1e-0000-4000-8000-000000000000') && !ok('judgment', 'x'));
  assert.ok(ok('read', 'loadSatisfactionBoard') && !ok('read', 'refreshTeacherPortfolioNow') && !ok('read', 'getPortfolioView'));
  assert.deepEqual(Object.keys(READS).sort(), ['loadEvaluationEntries', 'loadPortfolioComparison', 'loadSatisfactionBoard']);
});

// ── ⑤ 바깥 · 화면 글자 ───────────────────────────────────────────────────────────────────────────────────────────────────
test('계정 보기 설정은 보내지 않는다 · 저장 이름은 2.0 export 그대로 · AI 판정 함수는 어디서도 부르지 않는다', async () => {
  const entry = await here('./v2-host/src/class-review.tsx');
  assert.match(entry, /registerHostHandler\(CR, 'setMyClassReviewFilter', noAccountPrefs\)/);
  assert.match(entry, /\['saveRuleBoxCollapsed', 'saveCompareSort'\]\) registerHostHandler\(`\$\{TP\}view-prefs-actions\.ts`, name, noAccountPrefs\)/);
  for (const [name, { module }] of Object.entries({ ...WRITES, ...READS })) assert.match(await src(module), new RegExp(`export async function ${name}\\(`), name);
  for (const name of ['setMyClassReviewFilter', 'saveRuleBoxCollapsed', 'saveCompareSort']) assert.ok(!(name in screen.actions));
  // 이 화면이 부르는 2.0 저장 함수의 모듈 어디에도 AI 판정(satisfaction-ai · satisfaction-judge 판정 실행)이 없다.
  for (const m of new Set(Object.values(WRITES).map((w) => w.module))) assert.ok(!/satisfaction-ai|judgeWithAi|generateJSON/.test(await src(m)), m);
  assert.ok(!/satisfaction-ai|judgeWithAi|generateJSON/.test(await src(`${TP}refresh.ts`)));
});

test('화면 글자 — 2.0·내부 이름이 보이지 않는다 · 껍데기는 운영 주소·쓰기 요청이 없다', async () => {
  const shell = await here('./v2-screen-class-review.js'), entry = await here('./v2-host/src/class-review.tsx');
  const heads = await Promise.all(PAGES.map(([, f]) => here(`./v2-host/src/${f}`).then((s) => s.slice(0, s.indexOf('/**\n')))));
  for (const [name, text] of [['껍데기', shell], ['진입점', entry], ...heads.map((h, i) => [`조립${i}`, h])]) {
    const c = code(text);
    assert.ok(!/['"`][^'"`\n]*2\.0[^'"`\n]*['"`]/.test(c), `${name}: 화면 글자에 2.0`);
    for (const lit of c.match(/(['"`])(?:(?!\1)[^\n])*[가-힣](?:(?!\1)[^\n])*\1/g) ?? [])
      assert.ok(!/Docker|복사본|[a-z]+_[a-z_]+|\bget[A-Z]\w+|\bv2-|claude|deepseek/i.test(lit), `${name}: 내부 이름 ${lit}`);
  }
  assert.ok(!/https?:\/\//.test(code(shell)) && !/method:\s*['"]POST/.test(shell));
  // 진입점의 쓰기 요청은 redirect 하는 저장 셋(새 평가 · 문항 세트 저장 · 삭제)의 한 자리뿐 — 보기 경로엔 없다.
  assert.equal((entry.match(/method:\s*['"]POST/g) ?? []).length, 1);
  // 창 표식(embed=1)은 조회에 싣지 않는다 — 포트폴리오 강사 고르기(withEmbed)가 붙여 온다(실으면 400).
  assert.match(entry, /q\.delete\('embed'\);/);
});

test('3.0 껍데기: 주소의 actor가 고른 사람보다 먼저 이긴다 · 호스트 주소로는 안 간다 · 명단 밖 id는 무시 · 명단보다 먼저 와도 저장하는 사람으로 기억', async () => {
  const vm = await import('node:vm');
  const text = await here('v2-screen-class-review.js');
  let def = null, onMessage = null, frame = null;
  const posted = [], last = () => JSON.parse(JSON.stringify(posted.at(-1))), stored = new Map(), actorSlot = { innerHTML: '' };
  const cw = { postMessage: (m) => posted.push(m) };
  const slot = { style: {}, getBoundingClientRect: () => ({ top: 100, left: 20, width: 900, height: 600 }) };
  const document = {
    createElement: () => (frame = { style: {}, dataset: {}, hidden: true, contentWindow: cw, src: '' }),
    body: { append() {} }, querySelector: (sel) => (sel.includes('[data-v2-host-slot]') ? slot : sel.includes('[data-v2h-actor-slot]') ? actorSlot : null),
  };
  const A0 = '00000000-1111-4111-8111-111111111111', A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222', ID = '33333333-3333-4333-8333-333333333333';
  stored.set('v2-host-actor:class-review', A0);
  const ctx = {
    window: { V2Screens: { register: (x) => { def = x; }, esc: (s) => String(s ?? '') } }, document, innerHeight: 800, scrollX: 0, scrollY: 0,
    location: { origin: 'http://127.0.0.1:4335', hash: `#v2-class-review?v2path=/class-review/${ID}&actor=${A2}`, replace() {} },
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; },
    requestAnimationFrame: (fn) => fn(), MutationObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: true }), HTMLSelectElement: class {}, URLSearchParams,
  };
  vm.runInNewContext(text, ctx);
  const api = { render() {}, toast() {}, canOpenRecord: () => false };
  def.render({ api, query: new URLSearchParams(`v2path=/class-review/${ID}&actor=${A2}`) });
  await new Promise((r) => setTimeout(r, 0));
  def.render({ api, query: new URLSearchParams(`v2path=/class-review/${ID}&actor=${A2}`) });
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-editors', screen: 'class-review', editors: [{ id: A0, name: '원장' }, { id: A1, name: '김그린' }, { id: A2, name: '이하나' }] } });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A2 });
  assert.equal(stored.get('v2-host-actor:class-review'), A2);
  assert.ok(frame.src.includes(`v2path=%2Fclass-review%2F${ID}`) && !frame.src.includes('actor='));
  ctx.location.hash = '#v2-class-review?actor=44444444-4444-4444-8444-444444444444';
  def.render({ api, query: new URLSearchParams('actor=44444444-4444-4444-8444-444444444444') });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A2 }); assert.equal(stored.get('v2-host-actor:class-review'), A2);
});

// ── ④ 저장 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const fd = (o) => ({ $formData: Object.entries(o) });
const newestDoc = (kind) => ({ $sql: `select id::text from public.academy_documents where tenant_id = '${t}' and form_type = '${kind}' order by created_at desc, id limit 1` });
const who = { text: `select current_user u, coalesce(current_setting('request.jwt.claims', true), '') c` };

test('저장 검사(validate) — 2.0 모듈 · 인자 수 · FormData 모양 · 크기', () => {
  const v = (name, raw) => screen.actions[name].validate(raw);
  assert.ok(v('createClassReview', { module: CR, actor: null, args: [null, fd({ teacherId: 'x' })] }));
  assert.throws(() => v('createClassReview', { module: `${TP}actions.ts`, actor: null, args: [null, fd({})] }), '다른 모듈');
  assert.throws(() => v('createClassReview', { module: CR, actor: null, args: [null, { teacherId: 'x' }] }), 'FormData 모양 아님');
  assert.throws(() => v('refreshTeacherPortfolioNow', { module: `${TP}actions.ts`, actor: null, args: [1] }), '인자 수');
  assert.ok(v('decideJudgment', { module: `${TP}satisfaction-actions.ts`, actor: null, args: ['a', 'plus', 'b'] }));
  assert.throws(() => v('addSatisfactionClaim', { module: `${TP}satisfaction-actions.ts`, actor: null, args: ['x'.repeat(300 * 1024)] }), '너무 큼');
});

test('새 평가 → 평가자 교체 → 채점 → 총평 = 2.0 함수 그대로 · 감사로그 · 신분 원래대로 · 남은 행 0', { skip: SKIP }, async () => {
  const [teacher] = await db`select id::text id from public.users where tenant_id = ${t} and status::text = 'active' and system_role::text = 'teacher' order by display_name limit 1`;
  const other = editors.find((e) => e.id !== master.id && e.id !== admin.id) ?? editors.find((e) => e.id !== master.id);
  const [{ before }] = await db`select count(*)::int before from public.academy_documents where tenant_id = ${t} and form_type = 'class_review'`;
  const ref = newestDoc('class_review');
  const { results, probes } = await runWrite(t, master.id, [
    { module: CR, fn: 'createClassReview', args: [null, fd({ teacherId: teacher.id, subject: '', templateId: '', observerMode: 'assigned', observerCount: '2', observer1: admin.id, observer2: master.id })] },
    { module: CR, fn: 'replaceReviewObserver', args: [null, { $formData: [['docId', ref], ['oldObserverId', admin.id], ['newObserverId', other.id]] }] },
    { module: CR, fn: 'submitClassReviewScores', args: [null, { $formData: [['docId', ref], ...Array.from({ length: 30 }, (_, i) => [`q${i}`, '3']), ['comment', '시험 코멘트']] }] },
    { module: 'features/class-review/server/final-review-actions.ts', fn: 'saveFinalReview', args: [null, { $formData: [['docId', ref], ['finalReview', '시험 총평']] }] },
  ], { rollback: true, allowRefs: true, probes: [
    { text: `select id::text id, form_data, restricted, staff_user_id::text staff from public.academy_documents where id::text = (${ref.$sql})` },
    { text: `select action, actor_id::text actor, metadata from public.audit_logs where tenant_id = $1 and created_at = now() order by action`, params: [t] },
    who,
  ] });
  assert.ok(results[0].redirect?.startsWith('/class-review/'), '새 평가 = 그 평가지로 redirect');
  assert.equal(results[1].value?.ok, true); assert.equal(results[2].value?.ok, true); assert.equal(results[3].value?.ok, true);
  const [[doc], logs, [w]] = probes;
  assert.equal(results[0].redirect, `/class-review/${doc.id}`);
  assert.equal(doc.restricted, true); assert.equal(doc.staff, teacher.id);
  assert.deepEqual(doc.form_data.evaluators.filter((e) => e.kind === 'observer').map((e) => e.id), [other.id, master.id]);
  assert.equal(doc.form_data.submissions[master.id].comment, '시험 코멘트'); assert.equal(doc.form_data.finalReview.text, '시험 총평');
  assert.deepEqual(logs.map((l) => l.action), ['class_review_create', 'class_review_final_review', 'class_review_observer_replace', 'class_review_submit']);
  for (const l of logs) { assert.equal(l.actor, master.id); assert.equal(l.metadata.via, '3.0 연습 복사본'); }
  assert.deepEqual(w, { u: 'clone_admin', c: '' }, '쓰기 뒤 역할·claims 원래대로');
  const [{ n }] = await db`select count(*)::int n from public.academy_documents where tenant_id = ${t} and form_type = 'class_review'`;
  assert.equal(n, before, '남은 행 0');
});

test('삭제 · 문항 세트 저장(새 세트 redirect · 고치기)·삭제 = 2.0 그대로 · 원장 아닌 사람의 [지금 집계] 거절 · 남은 행 0', { skip: SKIP }, async () => {
  const [teacher] = await db`select id::text id from public.users where tenant_id = ${t} and status::text = 'active' and system_role::text = 'teacher' order by display_name limit 1`;
  const areas = JSON.stringify([{ key: 'a', title: '시험 영역', items: ['문항 하나'] }]);
  const [{ docs, sets }] = await db`select count(*) filter (where form_type = 'class_review')::int docs, count(*) filter (where form_type = 'class_review_template')::int sets from public.academy_documents where tenant_id = ${t}`;
  const { results, probes } = await runWrite(t, master.id, [
    { module: CR, fn: 'createClassReview', args: [null, fd({ teacherId: teacher.id, observerMode: 'open', observerCount: '1' })] },
    { module: CR, fn: 'deleteClassReview', args: [null, { $formData: [['docId', newestDoc('class_review')]] }] },
    { module: CR, fn: 'saveChecklistTemplate', args: [null, fd({ templateId: '', name: '시험 세트', areasJson: areas })] },
    { module: CR, fn: 'saveChecklistTemplate', args: [null, { $formData: [['templateId', newestDoc('class_review_template')], ['name', '시험 세트 고침'], ['areasJson', areas]] }] },
    { module: CR, fn: 'deleteChecklistTemplate', args: [null, { $formData: [['templateId', newestDoc('class_review_template')]] }] },
    { module: CR, fn: 'saveChecklistTemplate', args: [null, fd({ templateId: '', name: '깨진 세트', areasJson: '[{}]' })] },
  ], { rollback: true, allowRefs: true, probes: [
    { text: `select count(*) filter (where form_type = 'class_review')::int docs, count(*) filter (where form_type = 'class_review_template')::int sets from public.academy_documents where tenant_id = $1`, params: [t] },
    { text: `select action from public.audit_logs where tenant_id = $1 and created_at = now() order by action`, params: [t] },
  ] });
  assert.deepEqual(results[1].value, { ok: true, notice: '삭제했습니다' });
  assert.match(results[2].redirect ?? '', /^\/class-review\/template\?set=[0-9a-f-]{36}$/, '새 세트 = 그 세트로 redirect');
  assert.equal(results[3].value?.ok, true); assert.deepEqual(results[4], { redirect: '/class-review/template' });
  assert.match(results[5].value?.error ?? '', /문항 형식이 올바르지 않습니다/);
  assert.deepEqual(probes[0][0], { docs, sets }, '만든 것은 지워졌다');
  assert.deepEqual(probes[1].map((r) => r.action), ['class_review_create', 'class_review_delete', 'class_review_template_delete', 'class_review_template_save', 'class_review_template_save']);
  const { results: [refused] } = await runWrite(t, admin.id, [{ module: `${TP}actions.ts`, fn: 'refreshTeacherPortfolioNow', args: [] }], { rollback: true });
  assert.deepEqual(refused.value, { ok: false, error: '직원 포트폴리오를 집계할 권한이 없습니다' });
});

test('[지금 집계] = 2.0 refreshTeacherPortfolioNow — 마감한 달은 그대로 · 마감한 달 직접 입력 거절 · DB 트리거도 마감 행 수정 거절 · 바깥 요청 0', { skip: SKIP, timeout: 300_000 }, async () => {
  const closed = await db`select teacher_id::text tid, month from public.teacher_portfolio_months where tenant_id = ${t} and closed_at is not null order by teacher_id, month`;
  assert.ok(closed.length > 0, '시험하려면 마감한 달이 있어야 한다');
  const sig = `select md5(string_agg(teacher_id::text || month || coalesce(total::text, '') || payload::text || closed_at::text, ',' order by teacher_id, month)) h
    from public.teacher_portfolio_months where tenant_id = $1 and closed_at is not null and (teacher_id::text || month) = any($2)`;
  const keys = closed.map((c) => c.tid + c.month);
  const [{ h: before }] = await db.unsafe(sig, [t, keys]);
  const [{ present }] = await db`select to_regclass('net.http_request_queue') is not null present`;
  const queue = async () => (present ? (await db`select count(*)::int n from net.http_request_queue`)[0].n : 0);
  const q0 = await queue();
  const { results, probes } = await runWrite(t, master.id, [
    { module: `${TP}actions.ts`, fn: 'refreshTeacherPortfolioNow', args: [] },
    { module: `${TP}evaluation-actions.ts`, fn: 'saveEvaluationEntries', args: [closed[0].month, [{ teacherId: closed[0].tid, metricKey: 'punct', value: 1, note: null }]] },
  ], { rollback: true, probes: [{ text: sig, params: [t, keys] },
    { text: `select count(*)::int n from public.audit_logs where tenant_id = $1 and created_at = now() and action = 'teacher_portfolio_refresh'`, params: [t] }, who] });
  assert.equal(results[0].value?.ok, true, '집계가 끝났다');
  assert.deepEqual(results[1].value, { ok: false, error: '마감한 달이라 입력해도 점수가 바뀌지 않습니다' });
  assert.equal(probes[0][0].h, before, '마감한 달은 한 글자도 안 바뀌었다');
  assert.equal(probes[1][0].n, 1); assert.deepEqual(probes[2][0], { u: 'clone_admin', c: '' });
  assert.equal(await queue(), q0, '바깥 요청 큐 증가 0');
  // 0357a 트리거 — 마감한 행을 고치려 하면 DB가 거절한다(시험 트랜잭션 안에서만 시도 · 되돌림).
  await assert.rejects(db.begin(async (sql) => {
    await sql`update public.teacher_portfolio_months set computed_at = computed_at where tenant_id = ${t} and teacher_id = ${closed[0].tid} and month = ${closed[0].month}`;
  }), (e) => e.code === 'P0001' && /마감한 달의 점수는 바꿀 수 없습니다/.test(e.message));
  const [{ h: after2 }] = await db.unsafe(sig, [t, keys]);
  assert.equal(after2, before);
});
