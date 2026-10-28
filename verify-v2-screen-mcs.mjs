// 2.0 화면 — 강사 시트 · 수학(MCS) 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-mcs.mjs
// ① 주소 열쇠 = 2.0 page.tsx searchParams + 하위 주소 + 보는 사람 ② 그리기 = 2.0 page.tsx 본문 그대로(글자 대조)
// ③ 보는 사람·범위 = 2.0 권한 표 · 강사는 담당 반만(독립 SQL) ④ 카드·선생님별 숫자의 성질 ⑤ 호스트 묶음 · 3.0 쪽 안내.
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as M from './v2-screen-mcs.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');

await check('주소 열쇠 = 2.0 반별 page.tsx(month) + 하위 주소(v2path: /mcs · /mcs/teachers · /mcs/<반>/month) + 보는 사람(viewer)', async () => {
  const page = await src('app/(shell)/mcs/page.tsx'), month = await src('app/(shell)/mcs/[classId]/month/page.tsx');
  assert.match(page, /searchParams: Promise<\{ month\?: string \}>/);
  // 반 월간이 서버에서 읽는 주소 값은 month 하나(student·그 밖 칸은 화면이 주소에서 직접 읽는다 — 호스트도 iframe 주소에서 넘긴다)
  assert.deepEqual([...month.matchAll(/typeof query\.(\w+) === "string"/g)].map(m => m[1]), ['month', 'student']);
  assert.match(month, /getMathSheetMonth\(classId, month \?\? null\)/);
  assert.deepEqual(Object.keys(M.screen.params).sort(), ['month', 'v2path', 'viewer']);
  for (const ok of ['/mcs', '/mcs/teachers', '/mcs/a600c53d-1fde-47c8-b533-65b5e580ccc0/month']) assert.ok(M.screen.params.v2path.test(ok), ok);
  for (const no of ['/mcs/x', '/classes', '/mcs/teachers/x', '/mcs/a600c53d-1fde-47c8-b533-65b5e580ccc0', '/mcs/x/month', '/mcs/a600c53d-1fde-47c8-b533-65b5e580ccc0/month/x'])
    assert.ok(!M.screen.params.v2path.test(no), no);
  assert.ok(M.screen.params.month.test('2026-10') && !M.screen.params.month.test('2026-1'));
});

await check('반 월간 그리기 = 2.0 mcs/[classId]/month/page.tsx 본문 그대로 — 바꾼 곳은 서버 호출 두 자리뿐(mcs-month.swaps.json)', async () => {
  const page = lf(await src('app/(shell)/mcs/[classId]/month/page.tsx')), mine = lf(await here('./v2-host/src/mcs-month.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/mcs-month.swaps.json'));
  assert.equal(swaps.length, 2);
  let body = page.slice(page.indexOf('  if (!res.ok) {'), page.lastIndexOf('\n}'));
  for (const [from, to] of swaps) { assert.equal(body.split(from).length, 2, '2.0 글자가 한 번 있다'); body = body.replace(from, to); }
  assert.ok(mine.includes(`  const { res, options } = d;\n${body}\n}`), '본문이 글자 그대로');
  // 바꾼 자리는 서버 호출(조회)과 서버 가공(교재 창·계획)만 — 그리기(JSX)는 손대지 않았다
  for (const [from, to] of swaps) { assert.doesNotMatch(from, /return \(|<[A-Z]/); assert.match(to, /^  const \{ [\w, ]+ \} = d;\n$/); }
  const code = mine.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); // 2.0 주석은 글자 그대로 남는다
  assert.doesNotMatch(code, /\bawait\b|getCurrentUser|requireMcsClassAccess/, '서버 호출이 남지 않는다');
});

await check('그리기 = 2.0 mcs/page.tsx · mcs/teachers/page.tsx 본문 그대로(조회 결과를 받는 자리 · CSS 모듈 이름만 다르다)', async () => {
  const mine = lf(await here('./v2-host/src/mcs-pages.tsx')).split('\n')
    .filter(l => !['  const styles = landingStyles;', 'const styles = landingStyles;', '  const styles = teacherStyles;'].includes(l)).join('\n');
  const land = lf(await src('app/(shell)/mcs/page.tsx')), teach = lf(await src('app/(shell)/mcs/teachers/page.tsx'));
  assert.ok(mine.includes(land.slice(land.indexOf('  if (!res.ok) return'))), '반별 본문 + Progress · WrittenSummary');
  assert.ok(mine.includes(teach.slice(teach.indexOf('  return (\n    <div className={styles.surface}>'))), '선생님별 본문 + Average · Row');
  const EMPTY = /const EMPTY_TEXT: Record<string, string> = \{[\s\S]*?\};/;
  assert.equal(EMPTY.exec(mine)[0], EMPTY.exec(land)[0], '빈 화면 문구 표');
  assert.doesNotMatch(mine, /\bawait\b|requireAccess|getCurrentUser/, '서버 호출이 남지 않는다');
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => M.screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({});
  const R = await M.loadRules(importV2), today = R.dk.kstToday();

  await check('보는 사람 = MCS 권한이 있는 재직 직원(운영자 계정 제외 · 원장 먼저) · 기본은 첫 사람 · 진도맵(시안)은 관리자 이상', async () => {
    const supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
    assert.ok(base.editors.length > 0 && !base.editors.some(e => supers.includes(e.id)));
    assert.equal(base.viewer.id, base.editors[0].id); assert.equal(base.editors[0].role, '원장');
    assert.equal(base.previewProgressMap, true, '원장은 진도맵(시안)을 본다');
    const teacher = base.editors.find(e => e.role === '강사');
    assert.equal((await load({ viewer: teacher.id })).previewProgressMap, false, '강사는 진도맵(시안)이 없다');
  });

  await check('강사 보기 = 담당 반만(담임 ∪ 이번 주 교시 담당 ∪ 위임) — 독립 SQL · 원장 보기 = 이 달에 도는 수학 반 전부', async () => {
    const teachers = base.editors.filter(e => e.role === '강사');
    let compared = 0;
    for (const tch of teachers) {
      const res = await load({ viewer: tch.id });
      const monday = R.week.mondayOf(today);
      const allowed = new Set((await db`select id::text id from public.classes where tenant_id=${tenantId} and teacher_id=${tch.id}
        union select class_id::text from public.class_schedules where tenant_id=${tenantId} and teacher_id=${tch.id}
          and (valid_to is null or valid_to >= ${monday}::date) and (valid_from is null or valid_from <= ${R.week.shiftDays(monday, 6)}::date)
        union select class_id::text from public.class_delegations where tenant_id=${tenantId} and delegate_user_id=${tch.id} and revoked_at is null
          and from_date <= ${R.dk.addDays(today, 7)}::date and to_date >= ${R.dk.addDays(today, -7)}::date`).map(r => r.id));
      const cards = res.landing.data.cards;
      assert.ok(cards.every(c => allowed.has(c.classId)), `${tch.name}: 담당 밖 반이 없다`);
      if (cards.length === 0) assert.ok(['no-scoped-classes', 'no-month-classes'].includes(res.landing.data.emptyReason));
      compared += cards.length;
    }
    assert.ok(compared > 0, '강사 보기에 반이 하나라도 있다');
    const cards = base.landing.data.cards;
    const [{ n }] = await db`select count(*)::int n from public.classes where tenant_id=${tenantId} and subject='math' and is_active
      and (closed_at is null or closed_at >= ${R.dk.monthRange(base.landing.data.month).from}::date)`;
    assert.ok(cards.length > 0 && cards.length <= n, '원장 보기 카드 ≤ 활성 수학 반(그 달 수업이 없는 반은 카드가 없다)');
    assert.equal(new Set(cards.map(c => c.classId)).size, cards.length);
  });

  await check('카드 숫자의 성질 — 작성 ≤ 대상 · 지난 수업일 ≤ 수업일 · 작성률 = 반올림(작성/대상) · 달을 바꾸면 그 달', async () => {
    for (const c of base.landing.data.cards) {
      assert.ok(c.written <= c.shown && c.elapsedDays <= c.dayCount && c.dayCount > 0, c.className);
      if (c.shown > 0) assert.equal(c.pct, Math.round(c.written / c.shown * 100), c.className);
    }
    const sep = await load({ month: '2026-09' });
    assert.deepEqual([sep.landing.data.month, sep.landing.data.monthLabel], ['2026-09', '2026년 9월']);
  });

  await check('선생님별 = 담당 반 학생 한 줄씩(퇴원·끝난 수강 제외) · 담임 미지정은 맨 뒤 · 교재 3개월 창은 2.0 buildStudentBookPlans', async () => {
    const res = await load({ v2path: '/mcs/teachers' });
    assert.equal(res.route, 'teachers'); assert.equal(res.teachers.ok, true);
    const groups = res.teachers.groups;
    assert.ok(groups.length > 0);
    const names = groups.map(g => g.teacherName), noHome = R.tracks.NO_HOMEROOM_LABEL;
    if (names.includes(noHome)) assert.equal(names.at(-1), noHome);
    for (const g of groups) {
      assert.equal(new Set(g.students.map(s => s.studentId)).size, g.students.length, `${g.teacherName}: 학생 한 번씩`);
      for (const s of g.students) if (s.window) assert.ok(s.window.total > 0 && (s.window.done == null || s.window.done <= s.window.total), s.name);
    }
    const ids = groups.flatMap(g => g.students.map(s => s.studentId));
    const gone = await db`select id::text id from public.students where tenant_id=${tenantId} and id = any(${ids}::uuid[]) and withdrawn_at is not null and withdrawn_at::date <= ${today}::date`;
    assert.equal(gone.length, 0, '퇴원한 학생은 없다');
  });

  // 반 월간 — 원장이 고르는 반 = 이 달 카드 중 학생이 가장 많은 반
  const monthOf = (viewer, classId, month) => load({ viewer, v2path: `/mcs/${classId}/month`, ...(month ? { month } : {}) });
  const cardOf = [...base.landing.data.cards].sort((a, b) => b.shown - a.shown)[0];

  await check('반 월간 게이트 = 2.0 requireMcsClassAccess 문구 — 없는 반 · 수학 아닌 반 · 강사의 담당 밖 반', async () => {
    const msg = async (viewer, classId) => (await monthOf(viewer, classId)).month.res;
    assert.deepEqual(await msg(base.viewer.id, '00000000-0000-0000-0000-000000000000'), { ok: false, error: '반을 찾을 수 없습니다' });
    const [eng] = await db`select id::text id from public.classes where tenant_id=${tenantId} and subject<>'math' limit 1`;
    assert.deepEqual(await msg(base.viewer.id, eng.id), { ok: false, error: '이 반은 수학 강사 시트 대상이 아닙니다' });
    const teacher = base.editors.find(e => e.role === '강사');
    const tLanding = await load({ viewer: teacher.id }), mine = new Set(tLanding.landing.data.cards.map(c => c.classId));
    const [outside] = await db`select id::text id from public.classes where tenant_id=${tenantId} and subject='math' and not (id = any(${[...mine]}::uuid[]))
      and coalesce(teacher_id::text, '') <> ${teacher.id} limit 1`;
    const denied = await msg(teacher.id, outside.id);
    // 담임 아님 · 위임 아님 · 이번 주 교시 담당이면 읽기만(2.0 그대로) — 그 밖은 거절
    if (!denied.ok) assert.equal(denied.error, '담당 반이 아닙니다'); else assert.equal(denied.data.canEdit, false);
  });

  await check('반 월간 = 그 반·그 달 — 수업일·학생 줄·채움 셈·교재 창이 서로 맞는다 · 반 바꾸기 목록 = 반별 카드와 같은 범위', async () => {
    const d = (await monthOf(base.viewer.id, cardOf.classId)).month;
    assert.equal(d.res.ok, true);
    const data = d.res.data;
    assert.deepEqual([data.classId, data.month], [cardOf.classId, base.landing.data.month]);
    assert.equal(data.days.length, cardOf.dayCount, '수업일 = 반별 카드의 수업일');
    const dates = data.days.map(x => x.date);
    assert.ok(dates.every((x, i) => i === 0 || dates[i - 1] < x) && dates.every(x => x.startsWith(data.month)));
    // 학생 줄 = 그 반 수강이 이 달 수업일 하루라도 걸친 학생(독립 SQL) — 2.0 isOnMathRosterAnyDay
    const enrolled = new Set((await db`select distinct student_id::text id from public.enrollments where tenant_id=${tenantId} and class_id=${cardOf.classId}
      and (start_date is null or start_date <= ${dates.at(-1)}::date) and (end_date is null or end_date >= ${dates[0]}::date)`).map(r => r.id));
    assert.ok(data.students.length > 0 && data.students.every(s => enrolled.has(s.studentId)), '학생은 그 반 수강생');
    for (const s of data.students) assert.deepEqual(Object.keys(s.cells).sort(), [...dates].sort(), `${s.name}: 칸 = 수업일`);
    const cells = data.students.flatMap(s => Object.entries(s.cells).map(([date, st]) => ({ st, rec: s.records[date] })));
    assert.ok(cells.filter(c => c.st === 'written').every(c => c.rec), '작성 칸에는 보고서가 있다');
    assert.equal(data.fill.written, cells.filter(c => c.st === 'written').length);
    // 같은 반·같은 달 = 반별 카드와 같은 숫자(작성 · 대상 · 작성률)
    assert.deepEqual([data.fill.written, data.fill.written + data.fill.unwritten, data.fill.pct], [cardOf.written, cardOf.shown, cardOf.pct]);
    for (const [sid, w] of Object.entries(d.windows)) assert.ok(data.students.some(s => s.studentId === sid) && w, '교재 창은 이 반 학생만');
    assert.deepEqual(Object.keys(d.plans).sort(), data.students.map(s => s.studentId).sort(), '교재 계획 = 학생마다');
    assert.equal(d.learning.status, 'ok'); assert.equal(d.canResetGoals, true, '원장은 전체 목표를 초기화할 수 있다');
    assert.equal(d.textbooks.sources, undefined, '교재 원자료(주문·보고서)는 화면에 내려가지 않는다');
    // 반 바꾸기 목록(원장) = 그 달까지 운영한 활성 수학 반 전부(독립 SQL) ⊇ 이 달 카드
    const active = (await db`select id::text id from public.classes where tenant_id=${tenantId} and subject='math' and is_active
      and (closed_at is null or closed_at >= ${R.dk.monthRange(data.month).from}::date)`).map(r => r.id);
    assert.deepEqual(d.options.map(o => o.id).sort(), active.sort());
    assert.ok(base.landing.data.cards.every(c => d.options.some(o => o.id === c.classId)));
    const sep = (await monthOf(base.viewer.id, cardOf.classId, '2026-09')).month.res.data;
    assert.deepEqual([sep.month, sep.monthLabel], ['2026-09', '2026년 9월']);
  });

  await check('반 월간 강사 보기 = 담당 반이면 열리고 초기화는 없다(원장만) · 반 바꾸기 목록 = 그 강사의 담당 범위', async () => {
    for (const tch of base.editors.filter(e => e.role === '강사')) {
      const tLanding = await load({ viewer: tch.id }), card = tLanding.landing.data.cards[0];
      if (!card) continue;
      const d = (await monthOf(tch.id, card.classId)).month;
      assert.equal(d.res.ok, true, `${tch.name}: 담당 반`); assert.equal(d.canResetGoals, false);
      const shown = new Set(tLanding.landing.data.cards.map(c => c.classId));
      assert.ok([...shown].every(id => d.options.some(o => o.id === id)), '이 달 카드 반은 모두 목록에 있다');
      return;
    }
    assert.fail('담당 반이 있는 강사가 없다');
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-mcs-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('mcs.js', dist), 'utf8'), html = await readFile(new URL('mcs.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  assert.match(html, /<script type="module" src="mcs\.js">/);
  // 2.0의 문서 이동(window.location.assign — 반 월간의 달·반 바꾸기)은 묶을 때 호스트 이동(__v2HostAssign)으로 바뀐다 — iframe이 3.0에 없는 2.0 주소를 읽지 않는다
  const all = (await Promise.all((await readdir(outdir)).filter(f => f.endsWith('.js')).map(f => readFile(path.join(outdir, f), 'utf8')))).join('\n');
  assert.doesNotMatch(all, /window\.location\.assign\(/);
  assert.match(js, /__v2HostAssign\(/); assert.match(all, /__v2HostAssign\s*=/);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 보는 사람 고르기 · 안내 한 줄 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-mcs.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  assert.match(js, /\[data-v2h-actor\]`\)/, '고르기는 이 화면 안의 선택만 본다');
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /frame\.title = '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
});

console.log(`v2 mcs: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
