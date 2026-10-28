// 2.0 화면 — 시간표 시험 (read-only, Docker 복사본 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-timetable.mjs
// ① 옮긴 본문(PORTED)이 2.0 원문과 같은지 ② 2.0 함수로 만든 모델이 복사본의 독립 SQL 판정과 맞는지(#88 이력 행·명단·퇴원 줄)
// ③ 격자 칸 합·병합·카드 칸이 깨지지 않는지 ④ 매개변수 거절 ⑤ 화면 파일에 운영 2.0 주소·끼워 넣기·쓰기 요청이 없는지.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as T from './v2-screen-timetable.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const R = await T.loadRules(importV2);

await check('옮긴 본문이 2.0 원문과 같다(묶음 표·설정 목록·격자 치수·카드 치수·묶음 색 순서)', async () => {
  const groups = await src('features/timetable/lib/weekday-groups.ts'), types = await src('features/owner/settings-types.ts');
  const tables = await src('app/(shell)/timetable/_components/weekday-group-tables.tsx'), rich = await src('app/(shell)/timetable/_components/rich-card-group.tsx');
  const body = /const PARTITIONS[^=]*=\s*(\{[\s\S]*?\n\});/.exec(groups)[1].replace(/"/g, "'").replace(/\s+/g, '');
  const mine = JSON.stringify(T.PARTITIONS).replace(/"([a-z-]+)":/g, (m, k) => (/^[a-z]+$/.test(k) ? `${k}:` : `'${k}':`)).replace(/"/g, "'");
  assert.equal(mine.replace(/,$/, ''), body.replace(/,\}$/, '}').replace(/\],\]/g, ']]'));
  assert.deepEqual(JSON.parse(/WEEKDAY_GROUPINGS = (\[[^\]]*\])/.exec(types)[1]), T.WEEKDAY_GROUPINGS);
  assert.deepEqual(JSON.parse(/SUBJECT_DEFAULT_VIEWS = (\[[^\]]*\])/.exec(types)[1]), T.SUBJECT_DEFAULT_VIEWS);
  for (const [k, v] of Object.entries({ PERIOD_COL_W: T.PERIOD_COL_W, DAY_COL_W: T.DAY_COL_W, TEACHER_HEAD_H: T.TEACHER_HEAD_H })) assert.match(tables, new RegExp(`const ${k} = ${v};`), k);
  for (const k of ['NAME_ROOM_H', 'TEACHER_H', 'DAYHEAD_H', 'PERIOD_H', 'STU_H', 'LABEL_W', 'CARD_W', 'SECTION_PAD']) assert.match(rich, new RegExp(`const ${k} = ${T.RICH[k]};`), k);
  const tints = [...tables.matchAll(/\{ tint: "bg-([a-z]+)-soft\/50" \}/g)].map(m => m[1]);
  assert.deepEqual(tints, ['blue', 'purple', 'primary', 'rose', 'amber']);
  assert.match(tables, /title: "주말", days: \["sat", "sun"\], tint: "bg-amber-soft\/50", merge: false/);
  assert.match(tables, /const teachers = Array\.from\(new Set\(slots\.map\(\(s\) => s\.teacherName \?\? "—"\)\)\);/);
  assert.match(tables, /return out\.sort\(\(a, b\) => a\.startTime\.localeCompare\(b\.startTime\)\);/);
});

await check('옮긴 함수가 2.0과 같은 답을 낸다(요일 묶음·주말 판·기본 뷰·설정 병합·강사 열·같은 반 합치기)', () => {
  assert.deepEqual(T.resolveWeekdayGroups(R, 'mon-wed-fri'), [['mon', 'wed', 'fri'], ['tue', 'thu']]);
  assert.deepEqual(T.resolveWeekdayGroups(R, 'unknown'), T.PARTITIONS['mon-thu']);
  assert.deepEqual(T.resolveWeekdayGroups(R, 'c1', [{ id: 'c1', groups: [['mon', 'tue', 'wed', 'thu', 'fri', 'sat']] }]), R.parseWeekdayPartition([['mon', 'tue', 'wed', 'thu', 'fri', 'sat']]));
  assert.deepEqual(T.timetableBoards([['mon', 'sat'], ['tue']]), { weekdays: [['mon'], ['tue']], weekend: [['sat']] });
  assert.deepEqual(T.weekendBoardDays([['mon', 'sun'], ['tue']]), [['sat'], ['sun']]);
  assert.equal(T.weekendBoardDays([['mon']]), null);
  assert.equal(T.subjectDefaultView([{ key: 'english', defaultView: 'integrated' }], 'english'), 'integrated');
  assert.equal(T.subjectDefaultView([{ key: 'math', defaultView: 'rooms' }], 'math'), 'basic');
  assert.deepEqual(T.deepMerge({ a: [1], b: { c: 1, d: 2 }, e: 1 }, { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1 }), { a: [2, 3], b: { c: 1, d: 2 }, e: 1 });
  const s = (teacherName, dayOfWeek, classId, startTime, endTime = '17:00:00') => ({ teacherName, dayOfWeek, classId, startTime, endTime });
  const groups = T.buildGroups(R, [s('나', 'thu', 'a', '14:20:00'), s('가', 'mon', 'b', '14:20:00'), s(null, 'tue', 'c', '14:20:00')], T.buildWeekdayGroupDefs(R, [['mon', 'thu'], ['tue', 'fri']]));
  assert.deepEqual(groups.map(g => g.teachers.map(t => `${t.name}:${t.days.join('')}`)), [['가:mon', '나:thu'], ['—:tue']]);
  assert.deepEqual(T.mergeSlotsByClass([s('가', 'mon', 'a', '15:00:00', '16:00:00'), s('가', 'mon', 'a', '14:00:00', '15:00:00'), s('가', 'mon', 'b', '13:00:00')]).map(x => `${x.classId}${x.startTime}-${x.endTime}`), ['b13:00:00-17:00:00', 'a14:00:00-16:00:00']);
  assert.deepEqual(T.dayDateLabels('2026-10-26'), { mon: '10/26', tue: '10/27', wed: '10/28', thu: '10/29', fri: '10/30', sat: '10/31', sun: '11/1' });
});

await check('매개변수는 정해진 값만 받는다(나머지는 공통 틀이 400)', () => {
  const p = T.screen.params, ok = (k, v) => p[k].test(v);
  assert.ok(ok('view', 'basic') && ok('view', 'integrated') && !ok('view', 'all') && !ok('week', '2026-1-1') && ok('week', '2026-10-26'));
  assert.ok(ok('kind', 'makeup') && !ok('kind', 'x') && ok('etrack', 'injaewon') && !ok('etrack', 'all;') && ok('students', 'hide') && !ok('subject', 'Math'));
  assert.equal(T.screen.id, 'timetable'); assert.equal(typeof T.screen.load, 'function'); assert.equal(T.screen.actions, undefined);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => T.screen.load({ sql, params, tenantId, importV2 }));
const cellsOf = d => d.basic.tables.flatMap(tb => tb.rows.flatMap(r => r.cells));
try {
  const math = await load({}), eng = await load({ subject: 'english' }), past = await load({ week: '2026-09-07' }), future = await load({ week: '2026-11-09' });

  await check('주·과목·뷰 해석이 2.0과 같다(이번 주 월요일 · 수학=기본뷰 · 영어=통합뷰 · 지난/다음 주 표시)', () => {
    assert.equal(math.week, R.thisMonday(R.kstToday())); assert.equal(math.referenceDate, R.getWeekReferenceDate(math.week, R.kstToday()));
    assert.equal(math.subject, 'math'); assert.equal(math.view, 'basic'); assert.ok(math.basic && !math.integrated);
    assert.equal(eng.view, 'integrated'); assert.ok(eng.integrated && !eng.basic); assert.equal(eng.trackApplies, true);
    assert.equal(past.relation, 'past'); assert.equal(future.relation, 'future'); assert.equal(past.week, '2026-09-07');
    assert.deepEqual(math.views.map(v => `${v.value}:${v.ready}`), ['basic:true', 'integrated:true', 'rooms:false']);
    assert.deepEqual(eng.views.map(v => v.value), ['basic', 'integrated', 'teacher', 'rooms']);
    assert.deepEqual(math.kinds.map(k => k.label), ['정규', '특강', '전체', '보강']);
  });

  await check('형식만 맞는 없는 날짜는 이번 주로 · 화면 style에 가는 색은 hex만', async () => {
    assert.equal((await load({ week: '2026-02-31' })).week, math.week);
    const heads = [...cellsOf(math).filter(c => c.content).flatMap(c => (c.content.kind === 'hapban' ? c.content.segments.map(x => x.head) : [c.content.cls.head])),
      ...eng.integrated.groups.flatMap(g => g.cards.map(k => k.head))];
    for (const h of heads) if (h.bg) { assert.match(h.bg, /^#[0-9a-f]{3,8}$/i); assert.match(h.fg, /^#[0-9a-f]{3,8}$/i); }
    for (const x of eng.integrated.groups.flatMap(g => g.cards.flatMap(k => k.grid.flat()))) if (x.cell?.bg) assert.match(x.cell.bg, /^#[0-9a-f]{3,8}$/i);
  });

  await check('이력 행(#88): 화면의 반은 그 요일 날짜에 살아 있는 배치가 있는 반과 똑같다 — 독립 SQL로 대조', async () => {
    for (const d of [math, past]) {
      const ref = d.referenceDate, start = d.week, sun = R.shiftDays(start, 6);
      const rows = await db.begin('isolation level repeatable read read only', sql => sql`
        with days(dow, n) as (values ('mon',0),('tue',1),('wed',2),('thu',3),('fri',4),('sat',5),('sun',6))
        select distinct c.id::text id from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active
        join days on days.dow = s.day_of_week::text
        where s.tenant_id=${tenantId} and c.subject='math' and not coalesce(c.is_special,false) and c.class_name not like '%특강%'
          and (c.closed_at is null or c.closed_at >= ${ref})
          and s.valid_from <= ${start}::date + days.n and (s.valid_to is null or s.valid_to >= ${start}::date + days.n)
          and ${start}::date + days.n <= ${sun}::date`);
      const shown = new Set(cellsOf(d).filter(c => c.content).flatMap(c => (c.content.kind === 'hapban' ? c.content.segments.map(x => x.classId) : [c.content.cls.classId])));
      assert.deepEqual([...shown].sort(), rows.map(r => r.id).sort(), `${d.week} 반 목록`);
    }
  });

  await check('명단 판정: 한 반에 한 학생은 한 줄 · 퇴원 줄은 같은 과목 수강이 남지 않은 학생만 · 상태·색 종류는 정해진 값', async () => {
    const lines = cellsOf(math).filter(c => c.content?.kind === 'class').flatMap(c => [...c.content.common, ...c.content.partial.flatMap(p => p.students), ...c.content.hold, ...c.content.withdrawn].map(s => ({ ...s, classId: c.content.cls.classId })));
    const seen = new Map();
    for (const l of lines) {
      assert.ok(['active', 'hold', 'withdrawn'].includes(l.st)); assert.ok(['', 'new', 'recent', 'transferIn', 'hold', 'withdrawn'].includes(l.tone), l.tone);
      if (l.st === 'withdrawn') assert.equal(l.tone, 'withdrawn');
      const k = `${l.classId}:${l.id}`, cell = seen.get(k); seen.set(k, l.st);
      if (cell) assert.equal(cell, l.st, '병합 칸이 같은 반 같은 학생을 두 번 그릴 때는 같은 상태여야 한다');
    }
    const wd = [...new Set(lines.filter(l => l.st === 'withdrawn').map(l => l.id))];
    if (wd.length) {
      const alive = await db.begin('isolation level repeatable read read only', sql => sql`select distinct e.student_id::text id from public.enrollments e join public.classes c on c.id=e.class_id
        join public.students s on s.id=e.student_id where e.tenant_id=${tenantId} and c.subject='math' and e.student_id = any(${wd}::uuid[]) and e.start_date <= ${math.referenceDate}
        and (e.end_date is null or e.end_date > ${math.referenceDate}) and not (s.status::text='withdrawn' and s.withdrawn_at <= ${math.referenceDate})`);
      assert.equal(alive.length, 0, `같은 과목 수강이 남은 퇴원 줄: ${alive.map(a => a.id).join(',')}`);
    }
    const counted = cellsOf(math).filter(c => c.content?.kind === 'class').every(c => c.content.cls.count === c.content.cls.counts.active);
    assert.ok(counted);
  });

  await check('기본뷰 격자: 행마다 칸(병합 포함) 합이 요일 열 수와 같고 머리 열과 맞는다', () => {
    for (const d of [math, past, future]) for (const tb of d.basic.tables) {
      const cols = tb.cols.length - 1;
      assert.equal(tb.dayHead.length, cols); assert.equal(tb.head.reduce((n, h) => n + h.span, 0), cols);
      const cover = tb.rows.map(() => new Array(cols).fill(0));
      tb.rows.forEach((r, ri) => { let ci = 0; for (const c of r.cells) { while (cover[ri][ci]) ci++; for (let a = 0; a < c.rowSpan; a++) for (let b = 0; b < c.colSpan; b++) cover[ri + a][ci + b]++; ci += c.colSpan; } });
      assert.ok(cover.every(row => row.every(n => n === 1)), `${d.week} ${tb.id} 칸이 비거나 겹친다`);
      const labelRows = tb.rows.reduce((n, r) => n + (r.label ? r.label.span : 0), 0);
      assert.equal(labelRows, tb.rows.length, '교시 라벨이 모든 행을 한 번씩 덮는다');
    }
  });

  await check('통합뷰 카드: 요일·교시 칸 수가 맞고, 강사 칸은 색이 있으며, 명단 구획 높이는 줄 수와 맞다', () => {
    for (const g of eng.integrated.groups) {
      assert.equal(g.activeH, g.rosterRows.active > 0 ? g.rosterRows.active * 26 + 8 : 0);
      for (const k of g.cards) {
        assert.ok(k.days.length >= 1); assert.equal(k.grid.length, g.rows.length); assert.ok(k.grid.every(row => row.length === k.days.length));
        for (const x of k.grid.flat()) if (x.cell && !x.cell.blank && !x.cell.lab) assert.ok(x.cell.bg || x.cell.color, '강사 칸 색');
        assert.equal(k.count, k.active.length);
      }
    }
    const classes = eng.integrated.groups.flatMap(g => g.cards.map(k => k.classId));
    assert.equal(new Set(classes).size, eng.classCount, '반마다 카드 하나');
  });

  await check('명단 접기·빈 교시 접기는 같은 반을 낮은 칸으로 그린다(명단 0줄 · 빈 교시 36px)', async () => {
    const hidden = await load({ students: 'hide', emptyperiods: 'collapse' });
    assert.equal(cellsOf(hidden).filter(c => c.content).length, cellsOf(math).filter(c => c.content).length);
    for (const tb of hidden.basic.tables) for (const r of tb.rows) assert.ok(r.height === 38 || r.height === 36, String(r.height));
  });

  await check('강사뷰·교실뷰·보강은 다음 단계 안내로 정직하게 서고, 특강 구분은 특강 반만', async () => {
    const t = await load({ subject: 'english', view: 'teacher' }), m = await load({ kind: 'makeup' }), sp = await load({ kind: 'special' });
    assert.equal(t.pending, 'teacher'); assert.equal(t.basic, null); assert.equal(m.pending, 'makeup');
    const spIds = new Set(cellsOf(sp).filter(c => c.content?.kind === 'class').map(c => c.content.cls.classId));
    const special = await db.begin('isolation level repeatable read read only', sql => sql`select id::text id from public.classes where tenant_id=${tenantId} and id = any(${[...spIds]}::uuid[]) and (is_special or class_name like '%특강%')`);
    assert.equal(special.length, spIds.size);
  });
} finally { await db.end(); }

await check('화면 파일: 운영 2.0 주소·끼워 넣기·저장 요청 없음, 저장 자리는 막혀 있다', async () => {
  const js = await here('./v2-screen-timetable.js'), css = await here('./v2-screen-timetable.css');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /<iframe/i, /fetch\(/, /XMLHttpRequest/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/);
  for (const label of ['엑셀 내보내기/가져오기', '그룹 설정', '시간표 편집기', '메모 시트']) assert.match(js, new RegExp(`blocked\\('${label}'\\)`), label);
  assert.match(js, /disabled title="\$\{esc\(BLOCKED\)\}"/);
});

console.log(`v2 timetable: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
