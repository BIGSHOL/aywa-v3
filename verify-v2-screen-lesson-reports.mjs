// 2.0 화면 — 수업보고서 관리 뼈대 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-screen-lesson-reports.mjs
// ① 주소 열쇠 = 2.0 page.tsx가 읽는 sp 칸 + 면 판정의 section(호스트 진입점·3.0 감싸개도 같은 열쇠) ② 면 고르기 = 2.0 resolveLessonReportTab
// ③ 그리기 = 2.0 page.tsx 본문 그대로(서버 호출 자리만 swaps.json 짝) ④ 권한 칸 = 원장(모두 열림) ⑤ 작성률 = 독립 SQL
// ⑥ 화면 글자에 '2.0'·개발자용 말이 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { screen, KEYS } from './v2-screen-lesson-reports.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const PAGE = 'app/(shell)/lesson-reports/page.tsx';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

test('주소 열쇠 = 2.0 page.tsx의 sp 칸 + section(resolveLessonReportTab) · 호스트 진입점 · 3.0 감싸개도 같은 열쇠', async () => {
  const page = lf(await src(PAGE)), faces = lf(await src('features/report-admin/lesson-report-faces.ts'));
  const used = new Set([...page.matchAll(/\bsp\.(\w+)/g)].map((m) => m[1]));
  assert.match(faces, /sp\.section/);
  assert.deepEqual([...KEYS].sort(), [...new Set([...used, 'section'])].sort());
  // + 면 안 부품의 다시 읽기(list · cnread · days · promptHistory · testReports) + 통계 열쇠(v2-lesson-reports-stats.mjs STATS_KEYS).
  const { STATS_KEYS } = await import('./v2-lesson-reports-stats.mjs');
  assert.deepEqual(Object.keys(screen.params).sort(), ['v2path', 'viewer', ...KEYS, 'list', 'cnread', 'days', 'promptHistory', 'testReports', ...STATS_KEYS].sort());
  assert.equal(screen.paramMax.list, 2000);
  const entry = await here('./v2-host/src/lesson-reports.tsx'), wrap = await here('./v2-screen-lesson-reports.js');
  const arr = (re, s) => JSON.parse(re.exec(s)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.deepEqual(arr(/const KEYS = (\[[^\]]*\])/, entry), [...KEYS]);
  // 감싸개는 통계 기간 열쇠도 3.0 주소에 남긴다(/lesson-reports/stats?grain=…).
  assert.deepEqual(arr(/const KEEP = (\[[^\]]*\])/, wrap).sort(), [...new Set(['v2path', ...KEYS, ...STATS_KEYS])].sort());
  for (const ok of ['/lesson-reports', '/lesson-reports/stats']) assert.ok(screen.params.v2path.test(ok), ok);
  for (const no of ['/lesson-reports/', '/lesson-reports/video-homework', '/students']) assert.ok(!screen.params.v2path.test(no), no);
  assert.ok(screen.params.rmonth.test('2026-09') && !screen.params.rmonth.test('2026-9'));
});

test('그리기 = 2.0 page.tsx 본문 그대로(서버 호출 자리만 lesson-reports-page.swaps.json 짝 · 짝마다 한 번 · await 없음)', async () => {
  const orig = lf(await src(PAGE)), mine = lf(await here('./v2-host/src/lesson-reports-page.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/lesson-reports-page.swaps.json'));
  let body = orig.slice(orig.indexOf('export default async function LessonReportsPage('));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, to); }
  assert.equal(mine.slice(mine.indexOf('export function LessonReportsPage(')), body);
  assert.ok(!/\bawait\b/.test(body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')), '본문 코드에 await가 남았다');
});

test('면 고르기 = 2.0 resolveLessonReportTab · 권한 칸 = 원장 · 면 모듈이 없는 면은 faceMissing · 통계 열림', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const faces = await importV2('features/report-admin/lesson-report-faces.ts'), gate = await importV2('features/owner/classnote-gate.ts');
  await db.begin('read only', async (sql) => {
    const first = await screen.load({ sql, params: {}, tenantId: t, importV2 });
    assert.equal(first.viewer.systemRole, 'master');
    for (const k of ['canReportSettings', 'canAiMent', 'canEditReportSettings', 'canEditAiMent', 'canSendReports', 'canReports']) assert.equal(first.gates[k], true, k);
    const [lic] = await sql`select is_active from public.tenant_licenses where tenant_id=${t} and feature='ai_analysis'`;
    if (!lic) assert.equal(first.aiOn, true, '라이선스 행이 없으면 허용');
    const opts = { canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: gate.classnoteModuleOn(first.settings),
      aiOn: first.aiOn, replyOn: gate.classnoteReplyMode(first.settings) !== 'off', canReports: true };
    for (const sp of [{}, { tab: 'classnote' }, { tab: 'classnote', section: 'boards' }, { tab: 'classnote', section: 'parent_replies' }, { tab: 'list' },
      { tab: 'report' }, { tab: 'ai_ment' }, { tab: 'writing' }, { tab: 'nope' }]) {
      const want = faces.resolveLessonReportTab(sp, opts);
      const d = sp.tab === 'writing' || !sp.tab ? null : await screen.load({ sql, params: sp, tenantId: t, importV2 });
      if (d) {
        assert.equal(d.tab, want, JSON.stringify(sp));
        assert.equal(!!d.faceMissing, !existsSync(new URL(`./v2-lesson-reports-face-${want}.mjs`, import.meta.url)), `${want} 면 모듈`);
      }
    }
    assert.equal(first.tab, faces.resolveLessonReportTab({}, opts));
    const stats = await screen.load({ sql, params: { v2path: '/lesson-reports/stats' }, tenantId: t, importV2 });
    assert.equal(stats.page, 'stats');
  });
});

test('작성률(월간) = 독립 SQL — 날짜 칸 · 강사×날짜 작성 학생 수(count) · 영어 행 강사', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  await db.begin('read only', async (sql) => {
    // 복사본 날짜의 지난달 — 오늘·미래 칸이 섞이지 않는 달.
    const { copyClock } = await import('./v2-onescreen-roster.mjs');
    const today = (await copyClock()).day, d0 = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d0.setUTCMonth(d0.getUTCMonth() - 1);
    const month = d0.toISOString().slice(0, 7);
    const d = await screen.load({ sql, params: { tab: 'writing', rmonth: month }, tenantId: t, importV2 });
    const v = d.tabData.rates;
    assert.equal(d.tab, 'writing'); assert.deepEqual(v.range, { kind: 'month', month });
    const [{ n }] = await sql`select extract(day from (date_trunc('month', ${`${month}-01`}::date) + interval '1 month - 1 day'))::int n`;
    assert.equal(v.dates.length, n); assert.equal(v.dates[0], `${month}-01`);
    // 작성 칸(count) = 그날 그 강사가 쓴 보고서의 학생 수(테스트 학생 · 미발송 반 보고서 제외 · 반 없는 보고서는 센다).
    const counts = await sql`select r.teacher_name teacher, r.report_date::text date, count(distinct r.student_id)::int n
      from public.lesson_reports r join public.students s on s.id = r.student_id
      left join public.classes c on c.id = r.class_id
      where r.tenant_id=${t} and r.report_date >= ${v.dates[0]} and r.report_date <= ${v.dates[v.dates.length - 1]}
        and not coalesce(s.is_test, false) and not coalesce(c.report_optout, false) and r.teacher_name is not null
      group by 1, 2`;
    const want = new Map(counts.map((c) => [`${c.teacher}|${c.date}`, c.n]));
    const aywa = v.rates.filter((r) => r.source === 'aywa');
    assert.ok(aywa.length > 0, '수학 강사 행');
    let checked = 0;
    for (const r of aywa) for (const cell of r.daily) { assert.equal(cell.count, want.get(`${r.teacher}|${cell.date}`) ?? 0, `${r.teacher} ${cell.date}`); checked += cell.count; }
    assert.ok(checked > 0, '작성 기록이 있는 달');
    // 영어 행 강사 = 활성 · 미발송 아닌 영어 반의 담임.
    const eng = new Set((await sql`select distinct u.display_name from public.classes c join public.users u on u.id = c.teacher_id
      where c.tenant_id=${t} and c.subject='english' and c.is_active and not c.report_optout`).map((r) => r.display_name));
    for (const r of v.rates.filter((x) => x.source === 'classnote')) assert.ok(eng.has(r.teacher), r.teacher);
    // 오늘이 범위 밖 = 오늘 칸 없음.
    for (const r of aywa) { assert.equal(r.todayPending, null); assert.equal(r.todayTarget, 0); }
  });
});

test('다시 읽기 GET = 면 모듈 읽기 함수로(목록 · 큐 · 공지 둘 · 프롬프트 이력 · 미리보기 보고서) — 2.0 반환 모양', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  await db.begin('read only', async (sql) => {
    const load = (params) => screen.load({ sql, params, tenantId: t, importV2 });
    const list = await load({ list: JSON.stringify({ page: 0 }) });
    assert.equal(list.ok, true); assert.ok(Array.isArray(list.rows));
    assert.deepEqual(await load({ list: '{bad' }), { ok: false, error: '조회 조건을 읽지 못했습니다' });
    // 필터 값 검사 — 글자 칸에 배열 · 없는 날짜는 필터 없이 전부를 세지 않고 2.0 실패 문구로.
    const BAD = { ok: false, error: '입력한 값이 올바르지 않아 조회하지 못했습니다 — 각 칸의 형식을 확인하세요' };
    assert.deepEqual(await load({ list: JSON.stringify({ from: '2026-99-99' }) }), BAD);
    assert.deepEqual(await load({ list: JSON.stringify({ to: '2026-02-30' }) }), BAD);
    assert.deepEqual(await load({ list: JSON.stringify({ status: ['sent'] }) }), BAD);
    assert.deepEqual(await load({ list: JSON.stringify({ classId: ['00000000-0000-0000-0000-000000000000'] }) }),
      { ok: false, error: '반 필터 값이 올바르지 않습니다 — 뷰 설정에서 반을 다시 골라 주세요' });
    assert.equal((await load({ list: JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }) })).ok, true);
    // ?tab=video_homework = 2.0 첫 판정 — 면 조회 없이 영상 제출 현황 주소만.
    assert.deepEqual(await load({ tab: 'video_homework' }), { redirect: '/lesson-reports/video-homework' });
    const q = await load({ cnread: 'queue', days: '7' });
    assert.ok('cnread' in q && (q.cnread === null || typeof q.cnread === 'object'));
    for (const k of ['notices', 'classwide']) assert.equal(typeof (await load({ cnread: k })).cnread.ok, 'boolean', k);
    assert.equal(typeof (await load({ promptHistory: 'comment' })).ok, 'boolean');
    assert.equal(typeof (await load({ testReports: '1' })).ok, 'boolean');
    // 지금 동기화 버튼 상태(getClassnoteSyncStatus) = 독립 SQL — 반 보드가 있으면 보이고, 마지막 끝난 요청이 같다 · '지금' = 복사본을 뜬 시각.
    const sync = (await load({ cnread: 'sync' })).cnread, { copyClock } = await import('./v2-onescreen-roster.mjs');
    const [{ n }] = await sql`select count(*)::int n from public.classnote_class_boards where tenant_id=${t}`;
    const [fin] = await sql`select id::text id from public.classnote_sync_requests where tenant_id=${t} and status in ('done','failed') order by finished_at desc nulls last limit 1`;
    assert.equal(sync.available, n > 0); assert.equal(sync.nowMs, (await copyClock()).at.getTime());
    if (sync.available) assert.equal(sync.latest?.id ?? null, fin?.id ?? null);
  });
});

test('진입점 = 아직 옮기지 않은 읽기 넷은 읽기 안내로 · 동기화 요청(저장)은 보내지 않고 거절 — 쓰기 경로로 보내지 않는다(그 자리 처리)', async () => {
  const entry = lf(await here('./v2-host/src/lesson-reports.tsx'));
  for (const fn of ['getAdminComposeContext', 'getAdminSendClassOptions', 'getParentReplyContext', 'getNotificationReplyContext'])
    assert.ok(entry.includes(`, "${fn}", async () => NOT_YET_OPEN);`), fn);
  assert.match(entry, /const NOT_YET_OPEN = \{ ok: false, error: "연습 화면에서는 아직 열 수 없습니다" \}/);
  assert.match(entry, /"requestClassnoteBoardSync", async \(\) => \(\{ ok: false, error: VIEW_ONLY \}\)/);
  // 통계 보기 기억(saveReportStatsMode)은 이제 실제 저장 — 진입점이 거절하지 않는다(저장 시험 = verify-v2-lesson-reports-save.mjs).
  assert.ok(!entry.includes('"saveReportStatsMode", async () =>'));
  assert.match(entry, /"getClassnoteSyncStatus", async \(\) =>\s*\(\(await ask\(\{ cnread: "sync" \}\)\)/);
  // 영상 제출 현황 링크는 iframe 문서를 바꾸지 않고 3.0에 넘긴다 · 공유·인쇄 새 탭은 열지 않고 알린다 · 그리다 던진 것은 경계가 받는다.
  assert.match(entry, /const VIDEO_ROUTE = "\/lesson-reports\/video-homework"/);
  assert.match(entry, /window\.open = /);
  assert.ok(entry.includes('<Boundary key={`${path}?${search}`}><App /></Boundary>')); // 주소가 바뀌면 오류 안내를 걷는다
  const wrapper = lf(await here('./v2-screen-lesson-reports.js'));
  assert.match(wrapper, /d\.screen !== ID\) \{[\s\S]*?requested = null;[\s\S]*?S\.target\(d\.screen\)/, '다른 화면 알림 = 그 3.0 화면으로 · 자기 iframe은 다시 읽게');
});

test('화면 글자에 "2.0"·개발자용 말이 없다(주석 뺀 코드)', async () => {
  for (const f of ['./v2-screen-lesson-reports.js', './v2-host/src/lesson-reports.tsx']) {
    const code = lf(await here(f)).split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    for (const s of strings) assert.ok(!/2\.0|(^|[^\w-])v2([^\w-]|$)|복사본|Docker|API|tenant|함수/.test(s.replace(/<[^>]*>/g, ' ')), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
