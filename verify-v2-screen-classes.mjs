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
  assert.deepEqual(Object.keys(C.screen.params).sort(), ['movable', 'v2path', ...keys].sort(), '2.0 열쇠 + 하위 주소(v2path) + 배정 창 후보 읽기(movable)');
  for (const ok of ['/classes', '/classes/new', '/classes/e4a2c026-8992-4211-a5fe-b9e93be8a0f3', '/classes/e4a2c026-8992-4211-a5fe-b9e93be8a0f3/edit']) assert.ok(C.screen.params.v2path.test(ok), ok);
  for (const no of ['/students/x', '/classes/new/edit', '/classes/x', '/classes/']) assert.ok(!C.screen.params.v2path.test(no), no);
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

await check('반 수정·새 반 그리기 = 2.0 [id]/edit · new page.tsx 본문 그대로(서버 호출 자리만 classes-form.swaps.json 짝)', async () => {
  const lf = s => s.replace(/\r\n/g, '\n');
  const mine = lf(await here('./v2-host/src/classes-form.tsx')), swaps = JSON.parse(await here('./v2-host/src/classes-form.swaps.json'));
  const edit = lf(await src('app/(shell)/classes/[id]/edit/page.tsx')), fresh = lf(await src('app/(shell)/classes/new/page.tsx'));
  let e = edit.slice(edit.indexOf('  if (!klass) notFound();\n'), edit.lastIndexOf('\n}'));
  for (const [from, to] of swaps.edit) { assert.equal(e.split(from).length, 2, from); e = e.replace(from, to); }
  let n = fresh.slice(fresh.indexOf('  const subjectOptions = '), fresh.lastIndexOf('\n}'));
  for (const [from, to] of swaps.new) { assert.equal(n.split(from).length, 2, from); n = n.replace(from, to); }
  assert.ok(mine.includes(e), '반 수정 본문'); assert.ok(mine.includes(n), '새 반 본문');
  assert.doesNotMatch(mine, /\bawait\b|getCurrentUser|createClient|supabase\./, '서버 호출이 남지 않는다');
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

  await check('반 수정·새 반 자료 = 2.0 조회 — 강의실 선택지(보관된 강의실은 이 반에 배정된 것만) · 담임 후보 · 없는 반은 열지 않는다', async () => {
    const [archivedHolder] = await q1`select c.id::text id, c.classroom_id::text room from public.classes c join public.classrooms r on r.id=c.classroom_id
      where c.tenant_id=${tenantId} and r.archived_at is not null limit 1`;
    const [open] = await q1`select count(*)::int n from public.classrooms where tenant_id=${tenantId} and archived_at is null`;
    const fresh = await load({ v2path: '/classes/new' });
    assert.equal(fresh.classrooms.length, open.n, '새 반 = 보관 안 된 강의실만');
    assert.deepEqual(Object.keys(fresh).sort(), ['classrooms', 'editors', 'settings', 'teachers'], '2.0 Promise.all 셋 + 저장하는 사람');
    const any = archivedHolder ?? (await q1`select id::text id, classroom_id::text room from public.classes where tenant_id=${tenantId} and classroom_id is not null limit 1`)[0];
    const edit = await load({ v2path: `/classes/${any.id}/edit` });
    assert.ok(edit.classrooms.some(r => r.id === any.room), '이 반의 강의실은 보관됐어도 선택지에 남는다');
    assert.equal(edit.classrooms.length, open.n + (archivedHolder ? 1 : 0));
    assert.equal(edit.klass.id, any.id); assert.deepEqual(edit.teachers, fresh.teachers);
    assert.deepEqual(await load({ v2path: '/classes/00000000-0000-0000-0000-000000000000/edit' }), { notFound: true });
  });

  await check('저장(2단계) — 반 만들기·고치기 = 2.0 createClass · updateClass 이름·문구·반환 모양 · 교시 줄 · 감사로그(class_create · class_update changes) · 바깥 요청 0 (되돌림)', async () => {
    const A = C.screen.actions, M = 'features/classes/server/actions.ts', ROLL = new Error('rollback');
    const text = await src('features/classes/server/actions.ts');
    for (const n of ['createClass', 'updateClass']) assert.ok(text.includes(`export async function ${n}(`), n);
    assert.throws(() => A.createClass.validate({ module: 'x.ts', args: [null, { $formData: [] }] }), e => e.status === 400, '다른 파일 이름으로는 못 부른다');
    const tx = async fn => { let out; try { await db.begin(async sql => { out = await fn(sql); throw ROLL; }); } catch (e) { if (e !== ROLL) throw e; } return out; };
    const call = (sql, name, actor, fields) => A[name].run({ sql, body: A[name].validate({ module: M, actor, args: [null, { $formData: fields }] }), tenantId, importV2 });
    const actor = base.editors[0].id, CLS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3';
    const [teacher] = await q1`select id::text id from public.users where tenant_id=${tenantId} and status::text='active' and system_role::text='teacher' limit 1`;
    assert.ok(!base.editors.some(e => e.id === teacher.id), '강사는 저장하는 사람 목록에 없다');
    assert.deepEqual(await tx(sql => call(sql, 'createClass', teacher.id, [['className', '연습 시험 반'], ['subject', 'math']])), { error: '학원 전체 반 설정은 관리자만 할 수 있습니다' });
    assert.deepEqual(await tx(sql => call(sql, 'createClass', actor, [['className', ' '], ['subject', 'math']])), { fieldErrors: { className: '반 이름은 필수입니다' } });
    const [other] = await q1`select id::text id, class_name from public.classes where tenant_id=${tenantId} and is_active and closed_at is null and subject='math' and id <> ${CLS} limit 1`;
    const dup = await tx(sql => call(sql, 'createClass', actor, [['className', other.class_name], ['subject', 'math']]));
    assert.deepEqual([dup.nameConflict?.status, dup.nameConflict?.holderId, dup.fieldErrors?.className], ['operating', other.id, '같은 과목에 중복되는 반 이름이 있습니다. (운영 중인 반)']);
    const made = await tx(async sql => {
      const queued = async () => (await sql`select count(*)::int c from net.http_request_queue`)[0].c, q0 = await queued();
      const res = await call(sql, 'createClass', actor, [['className', '연습 시험 반 X'], ['subject', 'math'], ['schedule_day_0', 'sat'], ['schedule_start_0', '09:00'], ['schedule_end_0', '10:00']]);
      const id = res.redirectTo?.split('/').pop();
      return { res, slots: await sql`select day_of_week::text d, start_time::text s, valid_from::text f from public.class_schedules where class_id=${id}`,
        log: (await sql`select actor_id::text a, target_label, metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='class_create'`)[0], extra: (await queued()) - q0 };
    });
    assert.equal(made.res.ok, true); assert.match(made.res.redirectTo, /^\/classes\/[0-9a-f-]{36}$/); assert.deepEqual(made.res.overlaps.length >= 0, true);
    assert.deepEqual([...made.slots], [{ d: 'sat', s: '09:00:00', f: today }], '교시 = 오늘부터 무기한');
    assert.deepEqual([made.log.a, made.log.target_label, made.log.metadata.via, made.log.metadata.schedules], [actor, '연습 시험 반 X', '3.0 연습 복사본', 1]);
    assert.equal(made.extra, 0, '바깥 요청 대기열이 늘지 않는다');
    // 반 고치기 — 지금 교시를 그대로 보내면 교시 줄·감사로그가 그대로(2.0: 바뀐 것이 없으면 기록 없음).
    const edit = await load({ v2path: `/classes/${CLS}/edit` }), k = edit.klass, live = k.scheduleSlots.filter(x => !x.validTo || x.validTo >= today);
    const form = [['id', k.id], ['className', k.className], ['subject', k.subject], ['teacherId', k.teacherId ?? ''], ['classroomId', k.classroomId ?? ''], ['notes', k.notes ?? ''],
      ['bgColor', k.bgColor ?? ''], ...live.flatMap((x, i) => [[`custom_day_${i}`, x.dayOfWeek], [`custom_start_${i}`, x.startTime], [`custom_end_${i}`, x.endTime], [`custom_teacher_${i}`, x.teacherId ?? ''], [`custom_classroom_${i}`, x.classroomId ?? '']])];
    const same = await tx(async sql => ({ res: await call(sql, 'updateClass', actor, form),
      n: (await sql`select count(*)::int n from public.class_schedules where class_id=${CLS}`)[0].n,
      logs: (await sql`select count(*)::int n from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='class_update'`)[0].n }));
    assert.deepEqual([same.res.ok, same.res.redirectTo, same.n, same.logs], [true, `/classes/${CLS}`, k.scheduleSlots.length, 0]);
    const [t2] = await q1`select id::text id, display_name from public.users where tenant_id=${tenantId} and status::text='active' and system_role::text='teacher' and id is distinct from ${k.teacherId} limit 1`;
    const moved = await tx(async sql => ({ res: await call(sql, 'updateClass', actor, form.map(([n, v]) => (n === 'teacherId' ? [n, t2.id] : [n, v]))),
      log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='class_update'`)[0]?.metadata }));
    assert.equal(moved.res.ok, true);
    assert.deepEqual([moved.log.changed, moved.log.changes[0].to, moved.log.newTeacherId, moved.log.effectiveDate, moved.log.via], [['담임'], t2.display_name, t2.id, today, '3.0 연습 복사본']);
    const renamed = await tx(sql => call(sql, 'updateClass', actor, form.map(([n, v]) => (n === 'className' ? [n, other.class_name] : [n, v]))));
    assert.equal(renamed.nameConflict?.holderId, other.id, '고치기도 같은 과목 같은 이름은 막는다');
    assert.deepEqual(await tx(sql => call(sql, 'updateClass', actor, form.map(([n, v]) => (n === 'id' ? [n, '00000000-0000-0000-0000-000000000000'] : [n, v])))), { error: '반을 찾을 수 없습니다' });
    const [after] = await q1`select class_name, teacher_id::text t, (select count(*)::int from public.class_schedules where class_id=${CLS}) n from public.classes where id=${CLS}`;
    assert.deepEqual([after.class_name, after.t, after.n], [k.className, k.teacherId, k.scheduleSlots.length], '시험 뒤 복사본은 그대로');
  });

  await check('저장(2단계) — 반 상세 학생 줄: 학생 배정(createEnrollment) · 겹친 배정 안내 · *LAB 토글 · 예약 취소 · 배정 창 후보(GET) · 시간표에서 옮긴 셋(같은 함수) (되돌림)', async () => {
    const A = C.screen.actions, ROLL = new Error('rollback');
    for (const [n, file] of [['createEnrollment', 'features/enrollments/server/actions.ts'], ['setEnrollmentLabSeparate', 'features/enrollments/server/lab-separate-actions.ts'],
      ['rescheduleEnrollment', 'features/enrollments/server/scheduled-actions.ts'], ['cancelScheduledEnrollment', 'features/enrollments/server/scheduled-actions.ts'],
      ['moveEnrollmentsBatch', 'features/enrollments/server/actions.ts'], ['updateEnrollmentsAttendanceBatch', 'features/enrollments/server/actions.ts'],
      ['endSingleEnrollment', 'features/students/server/actions.ts']]) {
      assert.ok((await src(file)).includes(`export async function ${n}(`), `${file} → ${n}`);
      assert.throws(() => A[n].validate({ module: 'features/other.ts', args: [] }), e => e.status === 400, n);
    }
    const tx = async fn => { let out; try { await db.begin(async sql => { out = await fn(sql); throw ROLL; }); } catch (e) { if (e !== ROLL) throw e; } return out; };
    const run = (sql, name, module, actor, args) => A[name].run({ sql, body: A[name].validate({ module, actor, args }), tenantId, importV2 });
    const EM = 'features/enrollments/server/actions.ts', form = o => ({ $formData: Object.entries(o) });
    const STU = '6219e442-aa57-455f-a5bc-834b222d9e1c', CLS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3', TO = '50d2ece7-6514-4474-8cfc-dd8983d15c18';
    const actor = base.editors[0].id;
    const [teacher] = await q1`select id::text id from public.users where tenant_id=${tenantId} and status::text='active' and system_role::text='teacher' limit 1`;
    assert.deepEqual(await tx(sql => run(sql, 'createEnrollment', EM, teacher.id, [null, form({ studentId: STU, classId: TO })])), { error: '반 배정 권한이 없습니다 — 강사 계정은 열람 전용입니다' });
    assert.deepEqual(await tx(sql => run(sql, 'createEnrollment', EM, actor, [null, form({ classId: TO })])), { error: '학생을 선택해주세요' });
    const dup = await tx(sql => run(sql, 'createEnrollment', EM, actor, [null, form({ studentId: STU, classId: CLS })]));
    assert.match(dup.error, /^이미 이 반에 배정되어 있습니다 \(\d{4}-\d{2}-\d{2}부터\)\. 같은 반에 기간이 겹치는 배정은 만들 수 없습니다/, '겹친 수강을 문장으로');
    const made = await tx(async sql => {
      const res = await run(sql, 'createEnrollment', EM, actor, [null, form({ studentId: STU, classId: TO, startDate: today })]);
      return { res, row: (await sql`select class_id::text c, start_date::text s, end_date, attendance_days from public.enrollments where id=${res.enrollmentId ?? null}`)[0],
        log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_assign'`)[0]?.metadata,
        notes: await sql`select title from public.notifications where tenant_id=${tenantId} and created_at >= now() and link=${`/classes/${TO}`}` };
    });
    assert.match(made.res.enrollmentId ?? '', /^[0-9a-f-]{36}$/);
    assert.deepEqual([made.row.c, made.row.s, made.row.end_date, made.row.attendance_days], [TO, today, null, []]);
    assert.deepEqual([made.log.studentId, made.log.classId, made.log.startDate, made.log.via], [STU, TO, today, '3.0 연습 복사본']);
    // *LAB 토글 — 수학 반은 켤 수 없다(2.0 문구) · 끄기는 된다(감사로그).
    const [enr] = await q1`select id::text id from public.enrollments where student_id=${STU} and class_id=${CLS} and end_date is null limit 1`;
    const LM = 'features/enrollments/server/lab-separate-actions.ts';
    assert.deepEqual(await tx(sql => run(sql, 'setEnrollmentLabSeparate', LM, actor, [enr.id, true])), { error: '따로 수업(*LAB) 배정은 EiE 반에서만 할 수 있습니다' });
    const off = await tx(async sql => ({ res: await run(sql, 'setEnrollmentLabSeparate', LM, actor, [enr.id, false]),
      log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_lab_separate'`)[0]?.metadata }));
    assert.deepEqual([off.res, off.log.on, off.log.classId], [{ ok: true }, false, CLS]);
    // 예약 취소 — 내일 시작하는 배정을 만들고 같은 트랜잭션에서 취소(DB 함수 change_scheduled_enrollment, 사용자 역할).
    const SM = 'features/enrollments/server/scheduled-actions.ts', tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const canceled = await tx(async sql => {
      const res = await run(sql, 'createEnrollment', EM, actor, [null, form({ studentId: STU, classId: TO, startDate: tomorrow })]);
      const c = await run(sql, 'cancelScheduledEnrollment', SM, actor, [{ enrollmentId: res.enrollmentId }]);
      return { c, left: (await sql`select count(*)::int n from public.enrollments where id=${res.enrollmentId}`)[0].n,
        log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() and action='enrollment_schedule_cancel'`)[0]?.metadata };
    });
    assert.deepEqual([canceled.c, canceled.left, canceled.log?.canceled?.date, canceled.log?.via], [{ ok: true }, 0, tomorrow, '3.0 연습 복사본']);
    assert.deepEqual(await tx(sql => run(sql, 'rescheduleEnrollment', SM, actor, [{ enrollmentId: enr.id, date: '2020-01-01' }])), { error: '적용일은 내일 이후여야 합니다' });
    // 배정 창 후보(GET) — 2.0 listMovableEnrollments 모양.
    const movable = await load({ movable: STU });
    assert.equal(movable.ok, true); assert.ok(movable.items.some(i => i.enrollmentId === enr.id && i.classId === CLS), '지금 다니는 반이 후보');
    // 시간표에서 옮긴 셋 — 같은 함수(요일 편집 한 건으로 확인).
    const days = await tx(sql => run(sql, 'updateEnrollmentsAttendanceBatch', EM, actor, [[{ enrollmentId: enr.id, days: ['mon'] }]]));
    assert.deepEqual(days, { count: 1 });
    const [after] = await q1`select count(*)::int n from public.enrollments where student_id=${STU} and class_id=${TO}`;
    assert.equal(after.n, 0, '시험 뒤 복사본은 그대로');
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
  assert.match(js, /\[data-v2h-actor\]`\)/, '저장하는 사람 고르기는 이 화면 안의 선택만 본다');
  // 화면에 보이는 글자(주석 뺀 코드)에 '2.0'·개발자용 말이 없다(원장 10-28).
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(저장하는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/, /hostOk === null \? '([^']*)'/, /frame\.title = '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
});

console.log(`v2 classes: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
