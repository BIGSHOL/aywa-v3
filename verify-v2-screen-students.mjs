// 2.0 화면 — 원생목록 · 원생 상세 뼈대 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-screen-students.mjs
// ① 주소 열쇠 = 2.0 목록·상세 page.tsx searchParams 그대로(호스트 진입점·3.0 감싸개도 같은 열쇠) ② 탭 목록 = 2.0 STUDENT_TABS 차례
// ③ 상세 그리기 = 2.0 [id]/page.tsx 본문 그대로(서버 호출 자리만 swaps.json 짝) ④ 탭 고르기 = page.tsx 판정 ⑤ 머리 자료 = 독립 SQL
// ⑥ 화면 글자에 '2.0'·개발자용 말이 없다. 탭마다의 자료 시험은 verify-v2-students-<묶음>.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen, LIST_KEYS, DETAIL_KEYS } from './v2-screen-students.mjs';
import { TAB_KEYS, resolveTab } from './v2-students-detail.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const keysOf = (page) => [...(/searchParams: Promise<\{([\s\S]*?)\}>/.exec(page)?.[1] ?? '').matchAll(/^\s*(\w+)\?: string;/gm)].map((m) => m[1]);

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

test('주소 열쇠 = 2.0 목록·상세 page.tsx searchParams(상세의 embed는 창 표식이라 뺌) + v2path · viewer — 호스트 진입점·3.0 감싸개도 같은 열쇠', async () => {
  const list = keysOf(await src('app/(shell)/students/page.tsx')), detail = keysOf(await src('app/(shell)/students/[id]/page.tsx'));
  assert.deepEqual([...LIST_KEYS], list);
  assert.deepEqual([...DETAIL_KEYS], detail.filter((k) => k !== 'embed'));
  // + movable = 수업 탭 배정 창의 '반 이동' 후보 읽기(2.0 listMovableEnrollments — 반 화면과 같은 읽기).
  for (const key of new Set(['v2path', 'viewer', 'movable', 'course', 'classId', ...list, ...DETAIL_KEYS])) assert.ok(key in screen.params, `${key} 주소 열쇠`);
  const entry = await here('./v2-host/src/students.tsx'), wrap = await here('./v2-screen-students.js');
  const arr = (re, s) => JSON.parse(re.exec(s)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  assert.deepEqual(arr(/const KEYS = (\[[^\]]*\])/, entry), [...LIST_KEYS]);
  assert.deepEqual(arr(/const DETAIL_KEYS = (\[[^\]]*\])/, entry), [...DETAIL_KEYS]);
  for (const key of new Set(['v2path', ...list, ...DETAIL_KEYS, 'classId'])) assert.ok(arr(/const KEEP = (\[[^\]]*\])/, wrap).includes(key), `${key} 감싸개 주소 열쇠`);
  for (const ok of ['/students', '/students/new', '/students/e4a2c026-8992-4211-a5fe-b9e93be8a0f3', '/students/e4a2c026-8992-4211-a5fe-b9e93be8a0f3/edit']) assert.ok(screen.params.v2path.test(ok), ok);
  for (const no of ['/classes/x', '/students/new/edit', '/students/x', '/students/']) assert.ok(!screen.params.v2path.test(no), no);
  for (const no of ['//evil.com', 'https://x', '/\\x']) assert.ok(!screen.params.back.test(no), `back ${no}`);
  assert.ok(screen.params.from.test('dashboard') && screen.params.from.test('2026-10-01') && !screen.params.from.test('x'));
});

test('탭 = 2.0 tabs-nav.tsx STUDENT_TABS 차례 · 탭 고르기 = page.tsx 판정(권한 없는 수납 · 기여도 · SRS · 오늘 수학 → 개요)', async () => {
  const nav = await src('app/(shell)/students/[id]/_components/tabs-nav.tsx');
  assert.deepEqual([...TAB_KEYS], [...nav.matchAll(/\{ key: "([a-z-]+)", label:/g)].map((m) => m[1]));
  const all = { canSeeBilling: true, showContribution: true, showSrs: true, showTodaysMath: true };
  for (const k of TAB_KEYS) assert.equal(resolveTab(k, all), k);
  assert.equal(resolveTab(undefined, all), 'overview'); assert.equal(resolveTab('nope', all), 'overview');
  for (const [k, gate] of [['billing', 'canSeeBilling'], ['contribution', 'showContribution'], ['srs', 'showSrs'], ['todays-math', 'showTodaysMath']]) assert.equal(resolveTab(k, { ...all, [gate]: false }), 'overview', k);
  // 호스트 탭 부품 = 2.0 page.tsx가 그리는 탭 부품 이름 그대로(같은 props로 선다).
  const page = lf(await src('app/(shell)/students/[id]/page.tsx'));
  for (const [file, names] of [['overview', ['OverviewTab']], ['classes', ['ClassesTab']], ['billing', ['BillingTab']], ['grades', ['GradesTab']], ['srs', ['SrsTab']],
    ['todays-math', ['TodaysMathTab']], ['progress', ['ProgressTab']], ['attendance', ['AttendanceTab']], ['consultations', ['ConsultationsTab']], ['memos', ['MemosTab']],
    ['timeline', ['TimelineTab']], ['contribution', ['StudentContributionView']], ['homework-videos', ['HomeworkVideosTab', 'HomeworkVideoLinks']]]) {
    const host = await here(`./v2-host/src/students-tab-${file}.tsx`);
    for (const n of names) { assert.ok(page.includes(`<${n} `) || page.includes(`<${n}\n`), `2.0이 ${n}을 그린다`); assert.match(host, new RegExp(`export function ${n}\\(`), `${file}: ${n}`); }
  }
});

test('상세 그리기 = 2.0 [id]/page.tsx 본문 그대로(서버 호출 자리만 students-detail.swaps.json 짝 · 짝마다 한 번)', async () => {
  const orig = lf(await src('app/(shell)/students/[id]/page.tsx')), mine = lf(await here('./v2-host/src/students-detail.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/students-detail.swaps.json'));
  let body = orig.slice(orig.indexOf('export default async function StudentDetailPage('));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, to); }
  assert.equal(mine.slice(mine.indexOf('export function StudentDetailPage(')), body);
  // 바꾼 자리에 서버 호출이 남지 않는다(await 없음 — 호스트는 동기 부품).
  assert.ok(!/\bawait\b/.test(body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')), '본문 코드에 await가 남았다');
});

test('머리 자료 = 독립 SQL(학생 · 수강 · 보강 예약 · 진행 중 퇴원보고서) · 권한 칸 = 원장 · 없는 학생 = notFound', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { copyClock } = await import('./v2-onescreen-roster.mjs');
  const today = (await copyClock()).day;
  await db.begin('read only', async (sql) => {
    const picks = await sql`(select id::text id from public.students s where tenant_id=${t} and status='enrolled'
        and exists(select 1 from public.makeup_reservations r where r.student_id=s.id and r.status='reserved' and r.makeup_date >= ${today}::date) limit 1)
      union all (select id::text from public.students where tenant_id=${t} and status='withdrawn' limit 1)
      union all (select student_id::text from public.withdrawal_reports where tenant_id=${t} and status::text not in ('completed','canceled') limit 1)`;
    assert.ok(picks.length >= 2, '시험할 학생이 있어야 한다');
    for (const { id } of picks) {
      const d = await screen.load({ sql, params: { v2path: `/students/${id}` }, tenantId: t, importV2 });
      const [s] = await sql`select name, status::text status, withdrawn_at::text withdrawn_at, dup_suspect from public.students where tenant_id=${t} and id=${id}`;
      assert.equal(d.student.name, s.name); assert.equal(d.student.status, s.status); assert.equal(d.student.withdrawnAt, s.withdrawn_at); assert.equal(d.student.dupSuspect, s.dup_suspect === true);
      assert.equal(d.today, today); assert.equal(d.viewer.systemRole, 'master');
      // 원장 = 모든 칸이 열린다(학원 설정의 역할 재정의가 원장을 막지 않는 복사본).
      for (const k of ['canSeeBilling', 'canManageStatus', 'canDeleteStudent', 'canEditSchedule', 'canDeleteEnrollment', 'enrollmentAccess', 'canSeeEnrollment', 'canManageScheduled']) assert.equal(d.gates[k], true, k);
      assert.equal(d.gates.studentsLevel, 'full'); assert.equal(d.gates.canSeeWithdrawals, s.status === 'withdrawn');
      assert.equal(d.gates.showSrs, false); assert.equal(d.gates.showTodaysMath, false);
      const [{ n }] = await sql`select count(*)::int n from public.enrollments where tenant_id=${t} and student_id=${id}`;
      assert.equal(d.enrollments.length, n, '수강 = 학생의 모든 수강');
      const res = await sql`select id::text id from public.makeup_reservations where tenant_id=${t} and student_id=${id} and status='reserved' and makeup_date >= ${today}::date order by makeup_date, slot_start`;
      assert.deepEqual(d.upcomingMakeups.map((r) => r.id), res.map((r) => r.id), '보강 예약');
      const reports = await sql`select id::text id from public.withdrawal_reports where tenant_id=${t} and student_id=${id} and status::text not in ('completed','canceled') order by group_leader desc, created_at desc`;
      const reportable = (s.status === 'enrolled' || s.status === 'on_hold') && !s.withdrawn_at;
      if (reportable) assert.deepEqual(d.reportInfo, { pending: reports[0] ? { id: reports[0].id, readable: true } : null, canRequest: true });
      else assert.equal(d.reportInfo, null);
      assert.equal(d.tab.key, 'overview');
    }
    assert.deepEqual(await screen.load({ sql, params: { v2path: '/students/00000000-0000-4000-8000-000000000000' }, tenantId: t, importV2 }), { notFound: true });
  });
});

test('학생 수정·새 학생 그리기 = 2.0 edit · new page.tsx 본문 그대로(서버 호출 자리만 students-form.swaps.json 짝)', async () => {
  const mine = lf(await here('./v2-host/src/students-form.tsx')), swaps = JSON.parse(await here('./v2-host/src/students-form.swaps.json'));
  const cut = async (file, from, pairs) => {
    const orig = lf(await src(file));
    let body = orig.slice(orig.indexOf(from));
    for (const [a, b] of pairs) { assert.equal(body.split(a).length, 2, a); body = body.replace(a, b); }
    return body;
  };
  const edit = await cut('app/(shell)/students/[id]/edit/page.tsx', 'export default async function EditStudentPage(', swaps.edit);
  const neu = await cut('app/(shell)/students/new/page.tsx', 'export default async function NewStudentPage(', swaps.new);
  assert.equal(mine.slice(mine.indexOf('export function EditStudentPage(')), `${edit}\n${neu}`);
});

test('학생 수정 자료 = 학생 · 형제(자동 판정 · 짝 표) · 원장 권한 / 새 학생 = 학원 설정 학년', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  await db.begin('read only', async (sql) => {
    // 학부모 휴대폰 뒤 8자리가 같은 다른 학생이 있는 재원생 — 형제 자동 판정이 서야 한다.
    const [s] = await sql`select s.id::text id, s.name from public.students s where s.tenant_id=${t} and s.status='enrolled' and s.parent_phone is not null and not coalesce(s.is_test,false)
      and exists(select 1 from public.students o where o.tenant_id=${t} and o.id<>s.id and not coalesce(o.is_test,false)
        and right(regexp_replace(o.parent_phone, '[^0-9]', '', 'g'), 8) = right(regexp_replace(s.parent_phone, '[^0-9]', '', 'g'), 8)) order by s.name limit 1`;
    assert.ok(s, '형제 후보가 있는 학생');
    const d = await screen.load({ sql, params: { v2path: `/students/${s.id}/edit` }, tenantId: t, importV2 });
    assert.equal(d.student.name, s.name); assert.equal(d.studentsLevel, 'full'); assert.equal(d.canManageStatus, true);
    assert.equal(d.siblings.ready, true); assert.ok(d.siblings.siblings.length >= 1, '형제 자동 판정');
    for (const x of d.siblings.siblings) assert.ok(['phone', 'name', 'manual'].includes(x.basis), x.basis);
    const [{ levels }] = await sql`select data->'operations'->'gradeLevels' levels from public.tenant_settings where tenant_id=${t}`;
    const n = await screen.load({ sql, params: { v2path: '/students/new' }, tenantId: t, importV2 });
    if (Array.isArray(levels)) assert.deepEqual(n.settings.operations.gradeLevels, levels);
    assert.equal(n.canManageStatus, true);
    assert.deepEqual(await screen.load({ sql, params: { v2path: '/students/00000000-0000-4000-8000-000000000000/edit' }, tenantId: t, importV2 }), { notFound: true });
  });
});

test('화면 글자에 "2.0"·개발자용 말이 없다(주석 뺀 코드 · 원장 10-28)', async () => {
  const files = ['./v2-screen-students.js', './v2-host/src/students.tsx', './v2-host/src/students-shared.tsx'];
  for (const f of files) {
    const code = lf(await here(f)).split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    // 'v2'는 낱말일 때만(속성·클래스 이름 data-v2h-* · v2h-*는 화면 글자가 아니다).
    for (const s of strings) assert.ok(!/2\.0|(^|[^\w-])v2([^\w-]|$)|복사본|Docker|API|tenant|함수/.test(s.replace(/<[^>]*>/g, ' ')), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
