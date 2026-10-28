// 2.0 화면 · 출석부 시험 — node --test experiments/owner-concept/verify-v2-screen-attendance.mjs
// ① 옮긴 본문(PORTED)이 2.0 원문과 같은 답을 낸다(원문 함수를 저장소 TypeScript로 바로 변환해 같은 입력으로 비교)
// ② 2.0 함수로 만든 모델이 복사본의 독립 SQL과 맞는다(명단·칸 수·시수·#88 이력 행·강사 축·오늘 처리 현황)
// ③ 매개변수 거절 ④ 화면 파일에 운영 2.0 주소·끼워 넣기·보기 중 쓰기 요청이 없다 ⑤ 화면이 fixture로 2.0 라벨·이스케이프를 지킨다.
// 복사본 부분은 로컬 DB가 꺼져 있으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as A from './v2-screen-attendance.mjs';
import { importV2 } from './v2-bridge.mjs';

const { screen } = A;
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
/** 2.0 원문에서 함수(또는 상수) 하나를 그대로 떼어 JS로 변환한다 — 옮긴 본문과 같은 답을 내는지 견줄 기준. */
function extract(text, name) {
  const file = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  for (const st of file.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st.getText(file).replace(/^export /, '');
    if (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => d.name.getText(file) === name)) return st.getText(file).replace(/^export /, '');
  }
  assert.fail(`${name} not found in 2.0 source`);
}
function original(snippets, names, globals = {}) {
  const js = ts.transpileModule(snippets.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const ctx = vm.createContext({ ...globals }); vm.runInContext(`${js}\n;globalThis.__out = { ${names.join(', ')} };`, ctx);
  return ctx.__out;
}

/** vm 안에서 만든 값은 원형(realm)이 달라 JSON으로 견준다. */
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const R = await A.loadRules(importV2);

test('옮긴 본문이 2.0 원문과 같은 답을 낸다(설정 병합·휴일·과목 · 날짜축 · 31칸 · 담당 강사 · 달 이동 · 역할)', async () => {
  const resolve = await src('features/owner/resolve.ts'), queries = await src('features/attendance/server/queries.ts'), page = await src('app/(shell)/attendance/page.tsx');
  const sessions = await src('features/attendance/server/subject-sessions.ts');
  const O = original([extract(resolve, 'isPlainObject'), extract(resolve, 'deepMerge'), extract(resolve, 'normalizeHolidays'), extract(resolve, 'normalizeSubjects'),
    extract(queries, 'DOW_LABEL'), extract(queries, 'buildPeriodDays'), extract(page, 'padTo31'), extract(page, 'classTeachers'), extract(page, 'shiftMonth'),
    extract(sessions, 'roleFor')], ['deepMerge', 'normalizeHolidays', 'normalizeSubjects', 'buildPeriodDays', 'padTo31', 'classTeachers', 'shiftMonth', 'roleFor'],
  { kstToday: () => '2026-10-07', resolveTeacherRole: R.role.resolveTeacherRole });
  const base = { a: [1], b: { c: 1, d: 2 }, e: 1, operations: { subjects: [{ key: 'math', weekdayPeriods: ['x'] }] } };
  const stored = { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1, operations: { subjects: [{ key: 'math' }, { key: 'zz' }] } };
  same(A.deepMerge(base, stored), O.deepMerge(base, stored));
  const hol = ['2026-10-03', { date: '2026-10-09', name: '한글날' }, { date: 5 }, null, { date: '2026-12-25' }];
  same(A.normalizeHolidays(hol), O.normalizeHolidays(hol));
  same(A.buildPeriodDays('2026-09-28', '2026-10-09', '2026-10-07'), O.buildPeriodDays('2026-09-28', '2026-10-09'));
  same(A.buildPeriodDays('2026-10-09', '2026-10-01', 'x'), O.buildPeriodDays('2026-10-09', '2026-10-01'));
  const feb = A.buildPeriodDays('2026-02-01', '2026-02-28', '2026-10-07');
  same(A.padTo31(feb), O.padTo31(feb)); assert.equal(A.padTo31(feb).length, 31);
  const cls = { teacherId: 't1', teacherName: '가', teacherActive: false, slotTeachers: [{ id: 't2', name: '나', active: true }, { id: 't1', name: 'x', active: true }], historicalTeachers: [{ id: 't3', name: '다', active: true }] };
  same(A.classTeachers(cls), O.classTeachers(cls));
  for (const [m, n] of [['2026-01', -1], ['2026-12', 1], ['2026-10', 0]]) assert.equal(A.shiftMonth(m, n), O.shiftMonth(m, n));
  const ses = new Map([['s1', new Map([['math', [{ teacherId: 't1', sessionsPerWeek: 2 }, { teacherId: 't2', sessionsPerWeek: 1 }]]])]]);
  for (const [sid, sub, tid] of [['s1', 'math', 't1'], ['s1', 'math', 't2'], ['s1', 'english', 't1'], ['s1', null, 't1'], ['s2', 'math', 't1']]) assert.equal(A.roleFor(R, ses, sid, sub, tid), O.roleFor(ses, sid, sub, tid));
  // 원문 본문 글자 비교(설정 병합 — 공백·타입만 지운 뒤 같은 줄).
  const strip = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/\s+/g, '');
  const mine = await here('v2-screen-attendance.mjs');
  for (const name of ['deepMerge', 'normalizeHolidays']) assert.equal(strip(extract(mine, name)), strip(extract(resolve, name)), `${name} body`);
});

test('화면 쪽 옮긴 함수가 2.0과 같은 답을 낸다(검색·차수 표기·출석률)', async () => {
  const js = await here('v2-screen-attendance.js'), body = js.slice(js.indexOf('// ── PORTED'), js.indexOf('// ── PORTED 끝'));
  const ctx = vm.createContext({}); vm.runInContext(`${body}\n;globalThis.__out = { normalizeSearchText, matchesStudentSearch, formatUnitsWithSuffix, formatSessionUnits, rateDecimal };`, ctx);
  const P = ctx.__out;
  for (const [q, f] of [['김 수', ['김수아']], ['칠성중', ['x', '칠성중2']], ['', ['a']], ['ABC', ['abc']], ['없음', ['가', null]]]) assert.equal(P.matchesStudentSearch(q, f), R.search.matchesStudentSearch(q, f), `${q}`);
  for (const [u, s] of [[3, 'T'], [1.25, 'U'], [0, null], [482.5, 'U'], [2.04, null]]) assert.equal(P.formatUnitsWithSuffix(u, s), R.suffix.formatUnitsWithSuffix(u, s));
  for (const n of [1, 1.5, 0.5, 2, 12.25]) assert.equal(P.formatSessionUnits(n), R.units.formatSessionUnits(n));
  for (const c of [{ recorded: 0, present: 0, late: 0, absent: 0, makeup: 0, units: 0 }, { recorded: 352, present: 308, late: 2, absent: 31, makeup: 11, units: 1 }]) assert.equal(P.rateDecimal(c), R.totals.rateDecimal(c));
});

test('매개변수는 정해진 값만 받는다(나머지는 공통 틀이 400)', () => {
  const p = screen.params, ok = (k, v) => p[k].test(v);
  assert.ok(ok('month', '2026-10') && !ok('month', '2026-13') && !ok('month', '2026-1'));
  assert.ok(ok('teacher', 'cbac82ae-6ebc-4ec1-b6cc-5a71fc3bf038') && ok('teacher', 'seat:lab') && !ok('teacher', 'seat:') && !ok('teacher', "x' or 1=1"));
  assert.ok(ok('class', 'cbac82ae-6ebc-4ec1-b6cc-5a71fc3bf038') && !ok('class', 'all'));
  assert.ok(ok('mode', 'teacher') && !ok('mode', 'all') && ok('sort', 'role') && !ok('sort', 'x') && ok('period', 'month') && !ok('period', 'week') && ok('retired', 'show') && !ok('retired', 'hide'));
  assert.ok(ok('subject', 'subject_1') && !ok('subject', 'Math'));
  assert.equal(screen.id, 'attendance'); assert.equal(screen.order, 4); assert.equal(screen.label, '출석부');
});

test('화면 파일에 운영 2.0 주소·끼워 넣기·보기 중 쓰기 요청이 없다', async () => {
  for (const f of ['v2-screen-attendance.js', 'v2-screen-attendance.mjs', 'v2-screen-attendance.css']) {
    const text = await here(f);
    assert.doesNotMatch(text, /aywa\.co\.kr|vercel\.app|<iframe|https?:\/\/(?!127\.0\.0\.1)/i, f);
  }
  const js = await here('v2-screen-attendance.js');
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|method:\s*['"]POST/, 'the page reads only through ctx.load');
});

const T_KIM = 'bf52c6d2-5b44-41fc-8268-3248b7eda61b';
test('복사본: 반별 보기 — 명단·칸 수·시수가 독립 SQL과 같다(#88 이력 행 · 정정 줄은 최신 하나)', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: t, importV2 }));
  // 영어 반(파생 없음) — 칸은 전부 수기 기록이다.
  const [eng] = await db`select c.id from public.classes c where c.tenant_id=${t} and c.is_active and c.subject='english' and exists (select 1 from public.attendance_records r where r.class_id=c.id and r.session_date between '2026-10-01' and '2026-10-31') order by c.class_name limit 1`;
  const d = await load({ class: eng.id, period: 'month', month: '2026-10' });
  assert.equal(d.mode, 'class'); assert.equal(d.period.mode, 'month');
  const rows = d.grid.rows, ids = rows.map(r => r.studentId);
  // 명단 = 그 달 겹치는 수강(휴원·이전 종료 제외) ∪ 수강행 없이 기록만 있는 학생 — 같은 조건의 독립 SQL.
  const roster = await db`select distinct s.id from public.enrollments e join public.students s on s.id=e.student_id
    where e.tenant_id=${t} and e.class_id=${eng.id} and e.start_date<='2026-10-31' and not e.on_hold and (e.end_date is null or e.end_date>='2026-10-01')`;
  const visitors = await db`select distinct r.student_id id from public.attendance_records r where r.tenant_id=${t} and r.class_id=${eng.id} and r.session_date between '2026-10-01' and '2026-10-31'
    and not exists (select 1 from public.enrollments e where e.class_id=${eng.id} and e.student_id=r.student_id and e.start_date<='2026-10-31')`;
  assert.deepEqual(new Set(ids), new Set([...roster, ...visitors].map(x => x.id)), 'roster = enrolled ∪ recorded-only visitors');
  // 칸 수·시수 = (학생, 날짜, 교시)별 최신 1건을 날짜로 접은 것.
  const [x] = await db`with latest as (select distinct on (student_id, session_date, coalesce(slot_start::text,'')) student_id, session_date, status::text status, session_units
      from public.attendance_records where tenant_id=${t} and class_id=${eng.id} and student_id = any(${ids}::uuid[]) and session_date between '2026-10-01' and '2026-10-31'
      order by student_id, session_date, coalesce(slot_start::text,''), recorded_at desc, id desc)
    select count(distinct (student_id, session_date))::int cells, coalesce(sum(case when status in ('absent','excused') then 0 when session_units is null or session_units<=0 then 1 else session_units end),0)::float8 units from latest`;
  assert.equal(d.stats.recorded, x.cells, 'recorded cells'); assert.equal(Math.round(d.stats.units * 10), Math.round(x.units * 10), 'units');
  // #88 — 등원 요일(분리등원 없을 때)은 그 달과 겹치는 배치 행의 요일 합집합(끝난 배치는 빠진다).
  const dows = (await db`select distinct day_of_week::text d from public.class_schedules where tenant_id=${t} and class_id=${eng.id} and valid_from<='2026-10-31' and (valid_to is null or valid_to>='2026-10-01')`).map(r => R.cal.DOW_KEYS.indexOf(r.d)).sort();
  const plain = (await db`select s.id from public.enrollments e join public.students s on s.id=e.student_id where e.class_id=${eng.id} and (e.attendance_days is null or cardinality(e.attendance_days)=0) and not e.on_hold and (e.end_date is null or e.end_date>='2026-10-01') and e.start_date<='2026-10-31'`).map(r => r.id);
  for (const r of rows.filter(r => plain.includes(r.studentId))) assert.equal(r.attend, R.cal.formatDows(dows), `attend dows ${r.name}`);
  // 31칸 고정 · 그 달 날짜.
  assert.equal(d.grid.head.length, 31); assert.ok(d.grid.head.filter(h => !h.placeholder).every(h => h.date.startsWith('2026-10')));
  for (const r of rows) assert.equal(r.cells.length, 31);
  // 라벨에 원문 코드가 새지 않는다.
  for (const r of rows) for (const c of r.cells) for (const [k, v] of c?.tip?.r ?? []) assert.doesNotMatch(`${k}${v}`, /\b(present|absent|late|early_leave|makeup|excused|undefined|null)\b/);
});

test('복사본: 강사 전체 보기 — 반 목록이 강사 축(담임 ∪ 그 달 교시 담당 ∪ 이전 담임)과 같고, 칸은 그 강사 몫만', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: t, importV2 }));
  const d = await load({ teacher: T_KIM, mode: 'teacher', month: '2026-10' });
  assert.equal(d.mode, 'teacher'); assert.ok(d.grid.showGroups);
  const shown = d.grid.groups.filter(g => g.className !== '보강').map(g => g.classId);
  const axis = await db`select c.id from public.classes c where c.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at>='2026-10-01') and (c.teacher_id=${T_KIM}
      or exists (select 1 from public.class_schedules s where s.class_id=c.id and s.teacher_id=${T_KIM} and s.valid_from<='2026-10-31' and (s.valid_to is null or s.valid_to>='2026-10-01')))`;
  for (const id of shown) assert.ok(axis.some(a => a.id === id), 'every class shown is on the teacher axis');
  assert.ok(shown.length >= axis.length - 2, 'only classes taken over after the month may drop out');
  assert.ok(d.notices.some(n => n.some(([, v]) => v.includes('이 선생님이 맡은 교시'))), 'scope notice');
  assert.equal(d.stats.totalStudents, new Set(d.grid.groups.filter(g => g.className !== '보강').flatMap(g => g.rows.map(r => r.studentId))).size);
});

test('복사본: 허브 — 오늘(복사본 기준일) 처리 현황 합계가 독립 SQL과 같다', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: {}, tenantId: t, importV2 }));
  assert.ok(d.hub && !d.grid); assert.equal(d.asOf, await A.copyDay());
  const dow = R.cal.DOW_KEYS[new Date(`${d.asOf}T00:00:00Z`).getUTCDay()];
  // 오늘 수업 반(배치 유효 · 활성 · 종강 전)의 오늘 재원생(테스트 학생 제외) 중 오늘 기록이 있는 학생.
  const [x] = await db`with cls as (select distinct c.id from public.classes c join public.class_schedules s on s.class_id=c.id where c.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at>=${d.asOf})
      and s.day_of_week::text=${dow} and s.valid_from<=${d.asOf} and (s.valid_to is null or s.valid_to>=${d.asOf})),
    ex as (select distinct e.class_id, e.student_id from public.enrollments e join cls on cls.id=e.class_id join public.students st on st.id=e.student_id
      where not st.is_test and not e.on_hold and e.start_date<=${d.asOf} and (e.end_date is null or e.end_date>${d.asOf} or (e.end_date=${d.asOf} and not coalesce(e.is_transferred,false)))
      and (e.attendance_days is null or cardinality(e.attendance_days)=0 or ${dow}=any(e.attendance_days::text[])))
    select count(*)::int expected, count(*) filter (where exists (select 1 from public.attendance_records r where r.class_id=ex.class_id and r.student_id=ex.student_id and r.session_date=${d.asOf}))::int recorded from ex`;
  const processing = await db.begin('isolation level repeatable read read only', async sql => { const settings = await A.readSettings(sql, t, R); return A.__test.readProcessing(sql, t, R, settings, d.asOf); });
  assert.equal(processing.reduce((n, c) => n + c.expected, 0), x.expected, 'expected');
  assert.equal(processing.reduce((n, c) => n + c.recorded, 0), x.recorded, 'recorded');
});

async function page(data, query = '') {
  const text = await here('v2-screen-attendance.js');
  let def = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  vm.runInNewContext(text, { window: { V2Screens: { register: x => { def = x; }, esc } }, document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], body: { append() {} } }, queueMicrotask() {} });
  return def.render({ query: new URLSearchParams(query), load: () => ({ status: 'ready', data }), go() {}, refresh() {} });
}

test('화면: 2.0 라벨·표식이 그대로 서고 이름은 이스케이프된다', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: { teacher: T_KIM, mode: 'teacher', month: '2026-10' }, tenantId: t, importV2 }));
  d.grid.groups[1].rows[0].name = '<img src=x onerror=alert(1)>';
  const html = await page(d);
  assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'), 'student name escaped');
  for (const l of ['과목', '강사', '반', '기간', '보기', '정렬', '담당', '출석률', '결석', '지각', '칸 = 이 선생님 교시', '시수 기준', '범례', '등원요일', '학원 휴일', '미등원', '이름', '학교·학년', '수업 차수', '합계', '복사본 보기 전용']) assert.ok(html.includes(l), l);
  assert.match(html, /<td class="at-td"><div class="at-cell [^"]*bg-att-(present|absent)/, 'cells carry the 2.0 cell classes');
  const hub = await db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: {}, tenantId: t, importV2 }));
  const hubHtml = await page(hub);
  for (const l of ['출석부 요약', '출석부 열기', '랩실 · JJ실', '강사를 고르면 그 강사의 모든 반이 한 표로 열립니다']) assert.ok(hubHtml.includes(l), l);
  // 화면이 쓰는 2.0 칸 클래스는 모두 이 화면 CSS가 정의한다.
  const css = await here('v2-screen-attendance.css'), all = new Set([...d.grid.K, ...hub.filters.subjectOptions.map(() => '')].flatMap(k => k.split(/\s+/)).filter(Boolean));
  for (const cls of all) assert.ok(css.includes(`.${cls.replace(/[[\]#/]/g, m => `\\${m}`)}`) || ['ring-1', 'ring-inset', 'ring-line', 'outline-1', 'outline-dashed', '-outline-offset-2', 'outline-purple/60'].includes(cls), `css for ${cls}`);
});

test.after(async () => { await db?.end(); });
