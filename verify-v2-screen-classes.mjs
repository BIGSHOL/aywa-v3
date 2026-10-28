// 2.0 화면 — 수업목록 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-classes.mjs
// ① 조회 조건 = 2.0 page.tsx searchParams 그대로 ② 그리기 = 2.0 page.tsx 본문 그대로(일부러 뺀 두 요소만 다르다 — 글자 대조)
// ③ 숫자 = 독립 SQL과 같다(카드 넷 · 상태별 건수 · 줄마다 학생 수 · 요일·검색·정렬·담임 풀기) ④ 호스트가 2.0 부품을 고치지 않고 묶인다
// ⑤ 3.0 쪽은 같은 출처 iframe 자리와 안내 한 줄뿐. 브라우저 확인 스크립트는 work/owner-concept/v2-classes/.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as C from './v2-screen-classes.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const PAGE = 'app/(shell)/classes/page.tsx';

await check('조회 조건 = 2.0 page.tsx searchParams 열쇠 그대로 + 하위 주소 v2path(호스트 진입점·3.0 감싸개도 같은 열쇠)', async () => {
  const page = await src(PAGE), block = /searchParams: Promise<\{([\s\S]*?)\}>/.exec(page)?.[1] ?? '';
  const keys = [...block.matchAll(/(\w+)\?: string;/g)].map(m => m[1]);
  assert.ok(keys.length >= 9, '2.0 열쇠를 찾지 못함');
  assert.deepEqual(Object.keys(C.screen.params).sort(), ['v2path', ...keys].sort(), '2.0 열쇠 + 하위 주소(v2path)');
  assert.ok(C.screen.params.v2path.test('/classes') && C.screen.params.v2path.test('/classes/e4a2c026-8992-4211-a5fe-b9e93be8a0f3') && !C.screen.params.v2path.test('/students/x'));
  const entry = await here('./v2-host/src/classes.tsx'), wrap = await here('./v2-screen-classes.js');
  assert.deepEqual(JSON.parse(/const KEYS = (\[[^\]]*\])/.exec(entry)[1].replace(/'/g, '"')).sort(), [...keys].sort());
  assert.deepEqual(JSON.parse(/const KEEP = (\[[^\]]*\])/.exec(wrap)[1].replace(/'/g, '"')).sort(), ['v2path', ...keys].sort());
  assert.ok(C.screen.params.teacher.test('all') && !C.screen.params.teacher.test('x') && !C.screen.params.page.test('-1'));
});

await check('그리기 = 2.0 page.tsx 그대로 — 주소·머리 칸·본문(동기화 배지·계정 보기 설정 저장만 뺌) · 빈 상태·요일 칩·표·카드는 글자 그대로', async () => {
  const strip = s => s.replace(/\r\n/g, '\n').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const seg = (t, from, to) => { const i = t.indexOf(from), j = to ? t.indexOf(to, i) : t.length; assert.ok(i >= 0 && j > i, from); return t.slice(i, j); };
  const flat = s => s.replace(/\s+/g, '');
  const orig = strip(await src(PAGE)), mine = strip(await here('./v2-host/src/classes-list.tsx'));
  const removed = ['{prefsLoaded ? <RememberPrefs current={current} saved={prefsLoaded} save={saveClassListPrefs} /> : null}', '<MakeeduSyncBadge domain="classes" />'];
  let body = seg(orig, '  const listParams', 'type HeadCells');
  for (const r of removed) { assert.ok(body.includes(r), r); body = body.replace(r, ''); }
  assert.equal(flat(seg(mine, '  const listParams', 'type HeadCells')), flat(body));
  assert.equal(seg(mine, 'type HeadCells = {'), seg(orig, 'type HeadCells = {'));
});

await check('반 상세 그리기 = 2.0 [id]/page.tsx 본문 그대로(서버 호출 자리만 swaps.json 짝) · Card·Stat · 예약 변경 문구 · 이력 조립(getClassHistory 뒷부분)도 글자 그대로', async () => {
  const lf = s => s.replace(/\r\n/g, '\n');
  const mine = lf(await here('./v2-host/src/classes-detail.tsx')), swaps = JSON.parse(await here('./v2-host/src/classes-detail.swaps.json'));
  const page = lf(await src('app/(shell)/classes/[id]/page.tsx'));
  let body = page.slice(page.indexOf('  if (!klass) notFound();\n'), page.indexOf('\nfunction Card('));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, to); }
  assert.ok(mine.includes(body), '본문');
  assert.ok(mine.includes(page.slice(page.indexOf('\nfunction Card(') + 1).trimEnd()), 'Card · Stat');
  assert.ok(mine.includes(page.slice(page.indexOf('function todayIso(): string {'), page.indexOf('export default async function'))), 'todayIso');
  const sched = lf(await src('features/timetable/server/scheduled-class-change.ts'));
  assert.ok(mine.includes(sched.slice(sched.indexOf('export function scheduledClassChangeLabel(')).replace('export function', 'function').trimEnd()), 'scheduledClassChangeLabel');
  const hq = lf(await src('features/classes/server/history-queries.ts'));
  let hist = hq.slice(hq.indexOf('  const nameOf = new Map((nameRows.data'), hq.lastIndexOf('\n}'));
  for (const [from, to] of swaps.history) { assert.equal(hist.split(from).length, 2, from); hist = hist.replace(from, to); }
  assert.ok(mine.includes(hist), '이력 조립');
  assert.doesNotMatch(mine.slice(mine.indexOf('export function ClassDetailPage')), /\bawait\b|getCurrentUser|createClient|supabase\./, '서버 호출이 남지 않는다');
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => C.screen.load({ sql, params, tenantId, importV2 }));
try {
  const R = await C.loadRules(importV2), today = R.kstToday();
  const base = await load({}), all = await load({ status: 'all' });
  const allRows = [];
  for (let p = 1; p <= Math.ceil(all.total / all.pageSize); p++) allRows.push(...(p === 1 ? all : await load({ status: 'all', page: String(p) })).rows);
  const q1 = (strings, ...v) => db.begin('isolation level repeatable read read only', sql => sql(strings, ...v));

  await check('카드 넷 = 독립 SQL(보강 반 제외 · 운영 중 = 종강 아님 · 수강 등록 = 오늘 걸친 수강)', async () => {
    const [c] = await q1`select count(*)::int total, count(*) filter (where is_active and closed_at is null)::int active from public.classes where tenant_id=${tenantId} and is_makeup_pool is not true`;
    const [s] = await q1`select count(*)::int n from public.enrollments where tenant_id=${tenantId} and start_date <= ${today}::date and (end_date is null or end_date >= ${today}::date)`;
    assert.deepEqual(base.stats, { total: c.total, active: c.active, totalSeats: s.n });
    assert.equal(base.total, c.active, '기본 목록(운영) 건수 = 운영 중 카드');
    assert.equal(all.total, c.total, '상태 전체 목록 건수 = 전체 반 카드');
    for (const [status, cond] of [['ended', 'is_active and closed_at is not null'], ['retired', 'not is_active']]) {
      const [x] = await q1`select count(*)::int n from public.classes where tenant_id=${tenantId} and is_makeup_pool is not true and ${db.unsafe(cond)}`;
      assert.equal((await load({ status })).total, x.n, status);
    }
  });

  await check('줄마다 학생 수 = 오늘 명단(시작함 · 일반 종료는 종료일까지 · 반이동 종료일은 이미 새 반) — 독립 SQL', async () => {
    const counts = new Map((await q1`select class_id::text c, count(*)::int n from public.enrollments where tenant_id=${tenantId} and start_date <= ${today}::date
      and (end_date is null or (is_transferred and end_date > ${today}::date) or (not coalesce(is_transferred, false) and end_date >= ${today}::date)) group by class_id`).map(r => [r.c, r.n]));
    assert.equal(allRows.length, all.total);
    for (const r of allRows) assert.equal(r.studentCount, counts.get(r.id) ?? 0, r.className);
    assert.equal(new Set(allRows.map(r => r.id)).size, allRows.length, '쪽을 넘겨도 같은 반이 두 번 나오지 않는다');
  });

  await check('요일·검색·정렬·구분 — 고른 조건이 줄에 그대로 드러난다', async () => {
    const sat = await load({ status: 'all', days: 'sat' });
    assert.ok(sat.total > 0 && sat.rows.every(r => r.days.some(d => d.day === 'sat')), '토요일을 고르면 토요일 수업이 있는 반만');
    const term = '본원', hit = await load({ status: 'all', q: term });
    const [rooms, slotRooms] = await Promise.all([
      q1`select c.id::text id from public.classes c left join public.users u on u.id=c.teacher_id left join public.classrooms r on r.id=c.classroom_id
        where c.tenant_id=${tenantId} and c.is_makeup_pool is not true and (c.class_name ilike ${`%${term}%`} or u.display_name ilike ${`%${term}%`} or r.name ilike ${`%${term}%`})`,
      q1`select distinct s.class_id::text id from public.class_schedules s join public.classrooms r on r.id=s.classroom_id join public.classes c on c.id=s.class_id
        where s.tenant_id=${tenantId} and c.is_makeup_pool is not true and r.name ilike ${`%${term}%`}`,
    ]);
    assert.equal(hit.total, new Set([...rooms, ...slotRooms].map(r => r.id)).size, '검색 = 반 이름 · 담임 · 강의실(반 기본 + 교시별)');
    const byStudents = await load({ status: 'all', sort: 'students' });
    assert.ok(byStudents.rows.every((r, i, a) => i === 0 || a[i - 1].studentCount >= r.studentCount), '학생 많은 순');
    const special = await load({ status: 'all', kind: 'special' });
    assert.ok(special.total > 0 && special.rows.every(r => R.matchesClassKind('special', { isSpecial: r.isSpecial, className: r.className })), '특강만');
  });

  await check('필터 해석 = 2.0 page.tsx — 담임이 그 과목을 안 가르치면 담임을 풀고 링크에도 teacher=all · 담임 선택지는 배정 가능 ∪ 지금 담임', async () => {
    const english = base.teachers.find(x => x.subjects.length && !R.teacherTeaches(x.subjects, 'math'));
    assert.ok(english, '수학을 안 가르치는 담임이 있다');
    const r = await load({ subject: 'math', teacher: english.id });
    assert.deepEqual([r.resolved.subject, r.resolved.teacherId, r.resolved.teacherReset], ['math', 'all', true]);
    const holders = await q1`select distinct teacher_id::text id from public.classes where tenant_id=${tenantId} and is_active and teacher_id is not null`;
    const ids = new Set(base.teachers.map(x => x.id));
    for (const h of holders) assert.ok(ids.has(h.id), `지금 담임 ${h.id}`);
    assert.deepEqual(Object.keys(base.viewer), ['canManageClasses', 'scopedTeacherId']);
    assert.equal(base.lang, 'ko');
  });

  await check('반 상세 숫자 = 독립 SQL — 명단(끝나지 않은 수강 · 재원생 수는 시작한 것만) · 30일 출결(정정 줄은 최신 하나) · 배정 후보 · 예정 변동 · 없는 반', async () => {
    const [busy] = await q1`select metadata->>'classId' id from public.audit_logs where tenant_id=${tenantId} and target_type='class' and metadata->>'classId' is not null group by 1 order by count(*) desc limit 1`;
    const [sched] = await q1`select class_id::text id from public.enrollments where tenant_id=${tenantId} and start_date > ${today}::date group by 1 order by count(*) desc limit 1`;
    for (const id of [busy.id, sched.id]) {
      const d = await load({ v2path: `/classes/${id}` });
      const alive = await q1`select start_date::text s from public.enrollments where tenant_id=${tenantId} and class_id=${id}
        and (end_date is null or (is_transferred and end_date > ${today}::date) or (not coalesce(is_transferred, false) and end_date >= ${today}::date))`;
      assert.equal(d.students.length, alive.length, '명단 = 끝나지 않은 수강(예정 포함)');
      assert.equal(d.klass.studentCount, alive.filter(r => r.s <= today).length, '재원생 = 이미 시작한 수강');
      assert.equal(d.students.filter(s => s.phase === 'upcoming').length, d.klass.upcomingCount);
      const eff = await q1`select status::text st, count(*)::int n from (select distinct on (student_id, class_id, session_date, coalesce(slot_start::text, '')) status
          from public.attendance_records where tenant_id=${tenantId} and class_id=${id} and session_date >= ${today}::date - 30
          order by student_id, class_id, session_date, coalesce(slot_start::text, ''), recorded_at desc, id desc) x group by 1`;
      const n = st => eff.find(r => r.st === st)?.n ?? 0;
      assert.deepEqual([d.stats.total, d.stats.present, d.stats.absent, d.stats.late, d.stats.excused], [eff.reduce((a, r) => a + r.n, 0), n('present'), n('absent'), n('late'), n('excused')]);
      const [c] = await q1`select count(*)::int n from public.students where tenant_id=${tenantId} and status::text='enrolled'`;
      assert.equal(d.allEnrolledStudents.length, c.n, '배정 후보 = 재원 상태 학생 전부');
      assert.ok(d.historyParts.auditRows.every(l => /^\d{4}-\d{2}-\d{2}T/.test(l.created_at)), '감사 시각 = PostgREST 글자 모양');
      assert.ok(d.historyParts.enrollmentRows.every(r => r.students && typeof r.students.name === 'string'), '수강 이력 = students!inner(name) 모양');
      assert.deepEqual(Object.values(d.viewer), [{ allowed: true, classIds: null }, true, 'full', true, true, true, false], '원장 보기(JJ실 바로가기는 연동 설정 없음)');
    }
    const s = await load({ v2path: `/classes/${sched.id}` });
    assert.ok(s.scheduledRoster.some(c => c.kind === 'join' && c.date > today), '미래 시작 수강 = 예정 합류');
    assert.deepEqual(await load({ v2path: '/classes/00000000-0000-0000-0000-000000000000' }), { notFound: true });
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  // 4310이 내주는 dist/는 건드리지 않는다 — 시험용 폴더에 따로 짓는다.
  const outdir = path.join(os.tmpdir(), `v2-host-verify-classes-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('classes.js', dist), 'utf8'), html = await readFile(new URL('classes.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  assert.match(html, /<script type="module" src="classes\.js">/);
  const entry = await here('./v2-host/src/classes.tsx');
  assert.match(entry, /fetch\(`\/api\/v2\/classes\$\{key \? `\?\$\{key\}` : ''\}`/, '같은 출처 공통 틀로만 읽는다');
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-classes.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  // 화면에 보이는 글자(주석 뺀 코드)에 '2.0'·개발자용 말이 없다(원장 10-28).
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/, /hostOk === null \? '([^']*)'/, /frame\.title = '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
});

console.log(`v2 classes: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
