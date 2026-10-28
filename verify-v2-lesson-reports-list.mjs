// 2.0 화면 · 수업보고서 관리 — 목록 · 회수 면 + 보고서 통계 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-lesson-reports-list.mjs
// ① 통계 그리기 = 2.0 stats/page.tsx 본문 그대로(서버 자리만 lesson-reports-stats.swaps.json 짝) · 주소 열쇠 = 2.0 PERIOD_KEYS + subject
// ② 목록 첫 쪽 · 전체 수 · 필터 · 정렬 · 쪽 넘김 · 학생 검색 = 독립 SQL ③ 회수 면 = 같은 필터 옵션 ④ 통계 카드 · 추이 = 독립 SQL
// ⑤ 화면 글자에 '2.0'·개발자용 말이 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
test.after(async () => { await db?.end(); });

test('통계 그리기 = 2.0 stats/page.tsx 본문 그대로(짝마다 한 번 · await 없음) · 주소 열쇠 = PERIOD_KEYS + subject', async () => {
  const orig = lf(await src('app/(shell)/lesson-reports/stats/page.tsx')), mine = lf(await here('./v2-host/src/lesson-reports-stats.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/lesson-reports-stats.swaps.json'));
  let body = orig;
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, to); }
  const fn = 'export function ReportStatsPage(';
  assert.equal(mine.slice(mine.indexOf(fn)), body.slice(body.indexOf(fn)));
  for (const line of body.slice(0, body.indexOf('const one = ')).split('\n').filter(Boolean)) assert.ok(mine.includes(`${line}\n`), line);
  assert.ok(!/\bawait\b/.test(body.slice(body.indexOf(fn)).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')));
  const { STATS_KEYS } = await import('./v2-lesson-reports-stats.mjs');
  const period = lf(await src('features/stats/period.ts'));
  const pk = /export const PERIOD_KEYS: PeriodKeys = (\{[^}]*\})/.exec(period)[1];
  assert.deepEqual([...STATS_KEYS], [...Object.values(JSON.parse(pk.replace(/(\w+):/g, '"$1":'))), 'subject']);
  assert.deepEqual(JSON.parse(/const STATS_KEYS = (\[[^\]]*\])/.exec(mine)[1]), [...STATS_KEYS]);
  assert.match(orig, /one\(sp\.subject\)/);
});

test("화면 글자에 '2.0'·개발자용 말이 없다(주석 밖 문자열)", async () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n');
  for (const f of ['./v2-host/src/lesson-reports-stats.tsx', './v2-lesson-reports-reads.mjs', './v2-lesson-reports-stats.mjs', './v2-lesson-reports-face-list.mjs', './v2-lesson-reports-face-recall.mjs']) {
    const code = strip(lf(await here(f)));
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*?[가-힣](?:(?!\1)[^\\\n]|\\.)*?)\1/g)].map((m) => m[2]);
    for (const s of strings) assert.ok(!/2\.0|RPC|SQL|undefined|null|tenant|복사본/i.test(s) || /복사본에서 낸 값/.test(s), `${f}: ${s}`);
  }
});

const ctxOf = async (sql) => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { studentsBase } = await import('./v2-students-common.mjs');
  const base = await studentsBase({ sql, tenantId: t, importV2 });
  return { t, importV2, base };
};
const monthRange = (today) => {
  const [y, m] = today.split('-').map(Number);
  return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`];
};

test('목록 면 첫 쪽 · 전체 수 · 필터 옵션 = 독립 SQL(이번 달 · 기본 정렬) · ?status=__unsent__ · 회수 면 = 같은 옵션', { skip: SKIP }, async () => {
  const { screen } = await import('./v2-screen-lesson-reports.mjs');
  await db.begin('read only', async (sql) => {
    const { t, importV2, base } = await ctxOf(sql);
    const [from, to] = monthRange(base.today);
    const d = await screen.load({ sql, params: { tab: 'list' }, tenantId: t, importV2 });
    assert.equal(d.tab, 'list'); assert.ok(!d.faceMissing);
    const ids = await sql`select id::text id from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to}
      order by report_date desc nulls last, classnote_sent_at desc nulls last, created_at desc nulls last, id desc limit 30`;
    const [{ n }] = await sql`select count(*)::int n from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to}`;
    const L = d.tabData.initialList;
    assert.ok(n > 0, '이번 달 보고서가 있어야 시험이 뜻이 있다');
    assert.deepEqual(L.rows.map((r) => r.id), ids.map((r) => r.id));
    assert.equal(L.total, n); assert.equal(L.page, 0); assert.equal(L.pageSize, 30);
    const [one] = await sql`select r.student_id::text sid, s.name, c.class_name from public.lesson_reports r left join public.students s on s.id = r.student_id
      left join public.classes c on c.id = r.class_id where r.id = ${L.rows[0].id}`;
    assert.equal(L.rows[0].studentName, one.name ?? '(학생)'); assert.equal(L.rows[0].className, one.class_name ?? null);
    assert.ok('rating' in L.rows[0], '원장은 평점 칸을 받는다(쓰기 권한)');
    // 필터 옵션 = 최근 60일 강사 · 과목 · 반 목록은 없다(반 목록 RPC 없음 → 2.0도 빈 목록)
    const since = new Date(Date.parse(`${base.today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
    const tch = await sql`select distinct teacher_name v from public.lesson_reports where tenant_id=${t} and report_date >= ${since} and teacher_name is not null`;
    const sub = await sql`select distinct subject v from public.lesson_reports where tenant_id=${t} and report_date >= ${since} and subject is not null`;
    assert.deepEqual(d.tabData.filterOptions.teachers, tch.map((r) => r.v).sort());
    assert.deepEqual(d.tabData.filterOptions.subjects, sub.map((r) => r.v).sort());
    const [{ fn }] = await sql`select to_regprocedure('public.lesson_report_class_options(date)') is not null fn`;
    assert.equal(fn, false); assert.deepEqual(d.tabData.filterOptions.classes, []);
    assert.equal(d.tabData.filterOptions.mentSourceReady, true);
    const u = await screen.load({ sql, params: { tab: 'list', status: '__unsent__' }, tenantId: t, importV2 });
    const [{ un }] = await sql`select count(*)::int un from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to}
      and classnote_status is null and (source is null or source <> 'edutrix_import')`;
    assert.equal(u.tabData.initialList.total, un);
    const r = await screen.load({ sql, params: { tab: 'recall' }, tenantId: t, importV2 });
    assert.equal(r.tab, 'recall'); assert.deepEqual(r.tabData, { recallOptions: d.tabData.filterOptions });
  });
});

test('목록 클라 조회(list 열쇠) = 독립 SQL — 강사 부분검색 · 과목 · 안읽음 · 반 정렬 · 둘째 쪽 · 학생 검색 · 평점 정렬 · 잘못된 값', { skip: SKIP }, async () => {
  const { readList } = await import('./v2-lesson-reports-reads.mjs');
  await db.begin('read only', async (sql) => {
    const { t, importV2, base } = await ctxOf(sql);
    const [from, to] = monthRange(base.today);
    const ask = (f) => readList({ sql, tenantId: t, importV2, list: JSON.stringify(f) });
    const [{ teacher_name: tn }] = await sql`select teacher_name from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to} and teacher_name is not null
      group by 1 order by count(*) desc limit 1`;
    const part = tn.slice(1);
    const a = await ask({ from, to, teacherName: part, subject: 'math', page: 1 });
    const [{ n: an }] = await sql`select count(*)::int n from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to}
      and teacher_name ilike ${`%${part}%`} and subject='math'`;
    const aIds = await sql`select id::text id from public.lesson_reports where tenant_id=${t} and report_date between ${from} and ${to}
      and teacher_name ilike ${`%${part}%`} and subject='math' order by report_date desc, classnote_sent_at desc nulls last, created_at desc, id desc limit 30 offset 30`;
    assert.equal(a.ok, true); assert.equal(a.total, an); assert.deepEqual(a.rows.map((r) => r.id), aIds.map((r) => r.id));
    const b = await ask({ from, to, read: 'unread', sort: 'class', dir: 'asc' });
    const bIds = await sql`select r.id::text id from public.lesson_reports r left join public.classes c on c.id = r.class_id where r.tenant_id=${t}
      and r.report_date between ${from} and ${to} and r.classnote_status='success' and r.classnote_read_at is null
      and (r.edutrix_share_token is not null or r.source is null or r.source <> 'edutrix_import')
      order by c.class_name asc nulls last, r.report_date desc, r.created_at desc, r.id desc`;
    assert.equal(b.total, bIds.length); assert.deepEqual(b.rows.map((r) => r.id), bIds.slice(0, 30).map((r) => r.id));
    const [{ name }] = await sql`select s.name from public.lesson_reports r join public.students s on s.id = r.student_id where r.tenant_id=${t}
      group by s.name order by count(*) desc limit 1`;
    const c = await ask({ student: name });
    const [{ n: cn }] = await sql`select count(*)::int n from public.lesson_reports r where r.tenant_id=${t}
      and r.student_id in (select id from public.students where tenant_id=${t} and name ilike ${`%${name}%`})`;
    assert.equal(c.total, cn); assert.ok(c.rows.every((r) => r.studentName.includes(name)));
    const [{ wide }] = await sql`select count(*)::int wide from public.students where tenant_id=${t} and name ilike '%김%'`;
    if (wide > 100) assert.deepEqual(await ask({ student: '김' }), { ok: false, error: '"김"에 해당하는 학생이 너무 많습니다 — 이름을 더 입력해 주세요' });
    assert.deepEqual(await ask({ student: '없는학생이름가나다' }), { ok: true, rows: [], total: 0, page: 0, pageSize: 30 });
    assert.deepEqual(await ask({ classId: 'x' }), { ok: false, error: '반 필터 값이 올바르지 않습니다 — 뷰 설정에서 반을 다시 골라 주세요' });
    assert.deepEqual(await ask({ mentSource: 'x' }), { ok: false, error: '멘트 작성 방식 필터 값이 올바르지 않습니다 — 뷰 설정에서 다시 골라 주세요' });
    assert.equal((await readList({ sql, tenantId: t, importV2, list: '{깨짐' })).ok, false);
    // 평점 정렬(낮은 점수부터 · 평점 없음은 뒤 · 같은 점수는 수업일 → 등록 → id 최신)
    const d = await ask({ from, to, sort: 'rating', dir: 'asc' });
    const dIds = await sql`select r.id::text id from public.lesson_reports r left join public.lesson_report_ratings g
        on g.report_id = r.id and g.tenant_id = r.tenant_id and g.rubric = 'v6-owner44' and g.points between 0 and 5
      where r.tenant_id=${t} and r.report_date between ${from} and ${to}
      order by (g.points is null), g.points asc, r.report_date desc, r.created_at desc, r.id desc limit 30`;
    assert.deepEqual(d.rows.map((r) => r.id), dIds.map((r) => r.id));
    assert.ok(d.rows[0].rating && typeof d.rows[0].rating.points === 'number');
  });
});

test('보고서 통계 = 독립 SQL — 기본 12개월 · 월별 보고서 수 · 위 숫자 상자(숙제 · 미확인) · 일별 구간', { skip: SKIP }, async () => {
  const { screen } = await import('./v2-screen-lesson-reports.mjs');
  const { buildReportStats } = await import('./v2-lesson-reports-stats.mjs');
  await db.begin('read only', async (sql) => {
    const { t, importV2, base } = await ctxOf(sql);
    const s = await buildReportStats({ sql, tenantId: t, importV2, params: { span: '12' } });
    assert.equal(s.page, 'stats');
    const { stats } = s;
    assert.equal(stats.period.grain, 'month'); assert.equal(stats.period.months.length, 12);
    assert.equal(stats.period.months.at(-1), base.today.slice(0, 7));
    const tracked = stats.tracked;
    const inTracked = tracked.length ? sql`and subject = any(${tracked})` : sql``;
    const per = await sql`select to_char(report_date, 'YYYY-MM') m, count(*)::int n from public.lesson_reports where tenant_id=${t}
      and report_date between ${`${stats.period.months[0]}-01`} and ${base.today} ${inTracked} group by 1`;
    const byM = new Map(per.map((r) => [r.m, r.n]));
    assert.deepEqual(stats.trend.reports, stats.period.months.map((m) => byM.get(m) ?? 0));
    const since30 = new Date(Date.parse(`${base.today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const [{ n: un }] = await sql`select count(*)::int n from public.lesson_reports where tenant_id=${t} and classnote_status='success' and classnote_read_at is null
      and (edutrix_share_token is not null or source is null or source <> 'edutrix_import') and classnote_sent_at < ${new Date(base.clock.at.getTime() - 48 * 3_600_000)}
      and report_date >= ${since30} ${tracked.length ? sql`and subject = any(${tracked})` : sql``}`;
    if (stats.classnoteOn) assert.equal(stats.card.unread.reports, un); else assert.equal(stats.card.unread, null);
    const since7 = new Date(Date.parse(`${base.today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    const hw = await sql`select count(distinct student_id)::int n from public.lesson_reports where tenant_id=${t} and report_date between ${since7} and ${base.today}
      and student_id is not null ${tracked.length ? sql`and subject = any(${tracked})` : sql``}`;
    assert.ok(stats.card.homework && stats.card.homework.windowDays === 7 && stats.card.homework.students <= hw[0].n);
    const day = await buildReportStats({ sql, tenantId: t, importV2, params: { grain: 'day', from: since7, to: base.today } });
    assert.equal(day.stats.period.grain, 'day');
    const perDay = await sql`select report_date::text d, count(*)::int n from public.lesson_reports where tenant_id=${t} and report_date between ${since7} and ${base.today}
      ${tracked.length ? sql`and subject = any(${tracked})` : sql``} group by 1`;
    const byD = new Map(perDay.map((r) => [r.d, r.n]));
    assert.deepEqual(day.stats.trend.reports, day.stats.trend.keys.map((k) => byD.get(k) ?? 0));
    assert.ok(screen.params.v2path.test('/lesson-reports/stats'));
  });
});
