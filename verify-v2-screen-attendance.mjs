// 2.0 화면 · 출석부 시험 — node --test experiments/owner-concept/verify-v2-screen-attendance.mjs
// ① 옮긴 본문(PORTED · 호스트 조립의 page.tsx 함수)이 2.0 원문과 같은 답을 낸다(원문 함수를 저장소 TypeScript로 바로 변환해 비교)
// ② load = 2.0 page.tsx가 부품에 넘기는 값 — 복사본의 독립 SQL과 맞는다(명단·칸 수·시수·#88 이력 행·강사 축·오늘 처리 현황)
// ③ 매개변수·저장 입력 거절 ④ 화면 파일에 운영 2.0 주소·끼워 넣기가 없고, 3.0 껍데기는 호스트 iframe만 연다
// ⑤ 저장(되돌리는 트랜잭션) — 2.0 setAttendanceCell·보기 설정 4종과 같은 행·감사로그. 복사본 부분은 로컬 DB가 꺼져 있으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
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
const strip = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/\s+/g, '').replace(/"/g, "'");

/** vm 안에서 만든 값은 원형(realm)이 달라 JSON으로 견준다. */
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const R = await A.loadRules(importV2);
const ACTIONS = 'features/attendance/server/actions.ts', PREFS = 'features/attendance/server/prefs-actions.ts';

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
  const mine = await here('v2-screen-attendance.mjs');
  for (const name of ['deepMerge', 'normalizeHolidays']) assert.equal(strip(extract(mine, name)), strip(extract(resolve, name)), `${name} body`);
});

test('호스트 조립(attendance-page.tsx)이 page.tsx의 달 이동·달 표기를 글자 그대로 쓴다', async () => {
  const page = await src('app/(shell)/attendance/page.tsx'), host = await here('v2-host/src/attendance-page.tsx');
  for (const name of ['shiftMonth', 'formatMonth']) assert.equal(strip(extract(host, name)), strip(extract(page, name)), `${name} body`);
  // page.tsx의 부품을 같은 이름으로 쓴다(손으로 그린 표·칸이 아니다).
  for (const c of ['AttendanceSearchProvider', 'AttendanceScopeProvider', 'GridProvider', 'FilterSelect', 'PeriodNav', 'PeriodModeToggle', 'HrefSelect', 'AttendanceSortSelect', 'CollapseAllChip',
    'AttendanceSearchToggle', 'ExcelMenu', 'HubStudentSearch', 'LiveStats', 'AttendanceHub', 'EmptyState', 'MatrixTable', 'AttendanceLegend', 'SubstituteCellsNote', 'HideRetiredToggle',
    'ClassMonthPrintButton', 'UnitsMasterButton', 'AbsenceIntakeButton', 'PayslipWindowButton']) {
    assert.match(page, new RegExp(`<${c}\\b`), `page.tsx draws ${c}`); assert.match(host, new RegExp(`<${c}\\b`), `host draws ${c}`);
  }
  assert.match(host, /buildGridSource\(allGroups, visibleDays, orderedRows\)/, 'grid source = 2.0 buildGridSource');
  assert.doesNotMatch(host, /<table|<td\b|className="at-/, 'no hand-drawn grid');
});

test('매개변수는 정해진 값만 받는다(나머지는 공통 틀이 400)', () => {
  const p = screen.params, ok = (k, v) => p[k].test(v);
  assert.ok(ok('month', '2026-10') && !ok('month', '2026-13') && !ok('month', '2026-1'));
  assert.ok(ok('teacher', 'cbac82ae-6ebc-4ec1-b6cc-5a71fc3bf038') && ok('teacher', 'seat:lab') && !ok('teacher', 'seat:') && !ok('teacher', "x' or 1=1"));
  assert.ok(ok('class', 'cbac82ae-6ebc-4ec1-b6cc-5a71fc3bf038') && !ok('class', 'all') && ok('viewer', 'cbac82ae-6ebc-4ec1-b6cc-5a71fc3bf038') && !ok('viewer', 'me'));
  assert.ok(ok('mode', 'teacher') && !ok('mode', 'Teacher') && ok('q', '김 수') && !ok('q', 'a\nb') && !ok('q', 'x'.repeat(81)));
  assert.ok(ok('subject', 'subject_1') && !ok('subject', 'Math'));
  assert.equal(screen.id, 'attendance'); assert.equal(screen.order, 4); assert.equal(screen.label, '출석부');
  assert.deepEqual(Object.keys(screen.actions).sort(), ['previewAbsenceIntake', 'recordAbsenceIntake', 'saveAttendanceCollapsed', 'saveAttendanceHideRetired', 'saveAttendancePeriodMode', 'saveAttendanceSort',
    'searchAttendanceHubStudents', 'searchIntakeStudents', 'setAttendanceCell']);
});

test('아직 옮기지 않은 조회 셋은 그 함수의 2.0 실패 모양으로 답한다(부품이 결과를 읽다 깨지지 않게 · 쓰기 없음)', async () => {
  const HUB = 'features/attendance/server/hub-search-actions.ts', INTAKE = 'features/attendance/intake/server/actions.ts';
  const ask = async (name, module, ...args) => { const a = screen.actions[name]; return a.run({ sql: null, body: a.validate({ module, actor: null, args }), tenantId: null, importV2 }); };
  const hub = await ask('searchAttendanceHubStudents', HUB, { query: '김', month: '2026-10' });
  assert.deepEqual(hub.hits, []); assert.equal(hub.limit, R.hubSearch.HUB_SEARCH_LIMIT); assert.equal(hub.truncated, false); assert.match(hub.error, /아직 없습니다/);
  const s = await ask('searchIntakeStudents', INTAKE, '김'); assert.deepEqual(s.students, []); assert.match(s.note, /아직 없습니다/);
  const p = await ask('previewAbsenceIntake', INTAKE, { studentId: STUDENT, from: '2026-10-27', to: '2026-10-27' }); assert.deepEqual([p.student, p.cells], [null, []]); assert.match(p.error, /아직 없습니다/);
  assert.match((await ask('recordAbsenceIntake', INTAKE, {})).error, /바뀐 것은 없습니다/);
  // 다른 2.0 모듈의 같은 이름·인자 넘침은 받지 않는다.
  assert.throws(() => screen.actions.searchIntakeStudents.validate({ module: HUB, args: ['김'] }), /입력 값/);
  assert.throws(() => screen.actions.searchAttendanceHubStudents.validate({ module: HUB, args: [{}, {}] }), /입력 값/);
  // 2.0 부품이 이 셋을 실제로 그렇게 읽는다(r.hits · setResults(r) · p.cells) — 공통 거절 모양이면 깨진다.
  const hubSrc = await src('app/(shell)/attendance/_components/hub-student-search.tsx'), intake = await src('app/(shell)/attendance/_components/absence-intake-dialog.tsx');
  assert.match(hubSrc, /searchAttendanceHubStudents\(\{ query: term, month \}\)\s*\.then\(\(r\) => \{[^}]*setResult\(r\)/);
  assert.match(intake, /setCells\(p\.cells\)/);
});

test('화면 파일에 운영 2.0 주소·끼워 넣기가 없고, 손그림 CSS는 지웠다', async () => {
  for (const f of ['v2-screen-attendance.js', 'v2-screen-attendance.mjs', 'v2-host/src/attendance.tsx', 'v2-host/src/attendance-page.tsx']) {
    const text = await here(f);
    assert.doesNotMatch(text, /aywa\.co\.kr|vercel\.app|<iframe|https?:\/\/(?!127\.0\.0\.1)/i, f);
  }
  await assert.rejects(access(new URL('v2-screen-attendance.css', import.meta.url)), 'the hand-drawn stylesheet is gone');
  const js = await here('v2-screen-attendance.js');
  assert.doesNotMatch(js, /XMLHttpRequest|sendBeacon|method:\s*['"]POST/, 'the shell never writes');
  assert.deepEqual([...js.matchAll(/fetch\(([^,)]+)/g)].map(m => m[1]), ['HOST'], 'the shell only checks that the host page exists');
  // 호스트 진입점은 같은 출처 /api/v2/attendance만 읽는다.
  const entry = await here('v2-host/src/attendance.tsx');
  assert.deepEqual([...entry.matchAll(/fetch\(`([^`?$]+)/g)].map(m => m[1]), ['/api/v2/attendance']);
});

test('3.0 껍데기: 호스트 iframe 하나를 자리 위에 겹치고, 이동·저장하는 사람을 주고받는다', async () => {
  const text = await here('v2-screen-attendance.js');
  let def = null, onMessage = null, onChange = null, frame = null, replaced = null, rendered = 0;
  const posted = [], fetches = [], stored = new Map(), actorSlot = { innerHTML: '' };
  const cw = { postMessage: (m, o) => posted.push([m, o]) };
  const slot = { style: {}, getBoundingClientRect: () => ({ top: 100, left: 20, width: 900, height: 600 }) };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const document = {
    createElement: () => (frame = { style: {}, dataset: {}, hidden: true, contentWindow: cw, src: '' }),
    body: { append() {} }, querySelector: sel => (sel.includes('[data-v2-host-slot]') ? slot : sel.includes('[data-v2h-actor-slot]') ? actorSlot : null),
  };
  const ctx = {
    window: { V2Screens: { register: x => { def = x; }, esc } }, document, innerHeight: 800, scrollX: 0, scrollY: 0,
    location: { origin: 'http://127.0.0.1:4332', hash: '#v2-attendance', replace: h => { replaced = h; } },
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; if (type === 'change') onChange = fn; },
    requestAnimationFrame: fn => fn(), MutationObserver: class { observe() {} },
    fetch: (url, init) => { fetches.push([url, init?.method]); return Promise.resolve({ ok: true }); },
    HTMLSelectElement: class { matches(s) { return s === '[data-att-actor]'; } }, URLSearchParams,
  };
  vm.runInNewContext(text, ctx);
  const api = { render: () => { rendered += 1; }, toast() {}, canOpenRecord: () => false };
  const first = def.render({ api, query: new URLSearchParams('month=2026-10&class=e4a2c026-8992-4211-a5fe-b9e93be8a0f3&foo=1') });
  for (const l of ['연습 복사본(Docker)', '복사본 — 실제 발송 없음', '출석부를 여는 중…', 'data-v2-host-slot']) assert.ok(first.includes(l), l);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(fetches, [['/v2-host/attendance.html', 'HEAD']]); assert.equal(rendered, 1, 're-rendered once the host answered');
  def.render({ api, query: new URLSearchParams('month=2026-10&class=e4a2c026-8992-4211-a5fe-b9e93be8a0f3&foo=1') });
  assert.equal(frame.src, '/v2-host/attendance.html?month=2026-10&class=e4a2c026-8992-4211-a5fe-b9e93be8a0f3', 'only the 2.0 query keys reach the host');
  assert.equal(frame.hidden, false); assert.equal(frame.style.position, 'absolute'); assert.equal(frame.style.top, '100px');
  // 호스트가 저장하는 사람 목록을 알리면 띠에 고르기가 서고(이름 이스케이프), 고른 사람을 호스트에 알린다.
  const editors = [{ id: 'a1', name: '<b>원장</b>', role: '원장' }, { id: 'a2', name: '김그린', role: '관리자' }];
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-editors', screen: 'attendance', editors } });
  assert.ok(actorSlot.innerHTML.includes('&lt;b&gt;원장&lt;/b&gt;') && !actorSlot.innerHTML.includes('<b>원장'), 'names escaped');
  same(posted.at(-1), [{ type: 'v2-host-actor', id: 'a1' }, ctx.location.origin]);
  const pick = Object.assign(new ctx.HTMLSelectElement(), { value: 'a2' });
  onChange({ target: pick });
  assert.equal(stored.get('v2-host-actor:attendance'), 'a2'); same(posted.at(-1)[0], { type: 'v2-host-actor', id: 'a2' });
  // 다른 화면의 알림·다른 출처는 무시하고, iframe 안 이동은 3.0 주소로 옮긴다(2.0 열쇠만).
  onMessage({ origin: 'http://evil.example', source: cw, data: { type: 'v2-host-nav', screen: 'attendance', query: 'month=2026-11' } }); assert.equal(replaced, null);
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-nav', screen: 'timetable', query: 'week=1' } }); assert.equal(replaced, null);
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-nav', screen: 'attendance', query: 'month=2026-11&mode=teacher&x=1' } });
  assert.equal(replaced, '#v2-attendance?month=2026-11&mode=teacher');
});

const T_KIM = 'bf52c6d2-5b44-41fc-8268-3248b7eda61b';
const STUDENT = '6219e442-aa57-455f-a5bc-834b222d9e1c', CLASS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3', ROLLBACK = Symbol('rollback');
const loadAs = async params => { const { tenantId: t } = await import('./full-db.mjs'); return db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: t, importV2 })); };
/** attendance-page.tsx가 읽는 값(AttendanceData) — 빠지면 2.0 부품이 undefined를 받는다. */
const PROPS = ['asOf', 'lang', 'month', 'currentMonth', 'host', 'editors', 'viewer', 'viewPrefs', 'seatPick', 'eieOn', 'subjectOptions', 'effectiveSubject', 'subjectValue', 'teacherOptions',
  'effectiveTeacher', 'teacherValue', 'retiredCount', 'classOptions', 'effectiveClassId', 'mode', 'matrixWindow', 'groups', 'orderedRows', 'visibleDays', 'showGroups', 'statsCount',
  'totalStudents', 'sheetEmpty', 'hubShown', 'notices', 'selectedClassLabel', 'searchSeed', 'attendanceScope', 'lockBefore', 'substituteCells', 'tools', 'hub'];

test('복사본: 반별 보기 — 명단·칸 수·시수가 독립 SQL과 같다(#88 이력 행 · 정정 줄은 최신 하나)', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  // 영어 반(파생 없음) — 칸은 전부 수기 기록이다.
  const [eng] = await db`select c.id from public.classes c where c.tenant_id=${t} and c.is_active and c.subject='english' and exists (select 1 from public.attendance_records r where r.class_id=c.id and r.session_date between '2026-10-01' and '2026-10-31') order by c.class_name limit 1`;
  const d = await loadAs({ class: eng.id, month: '2026-10' });
  for (const k of PROPS) assert.ok(k in d, `prop ${k}`);
  // 날짜축 = 보는 사람의 설정(달 · 세션) — 2.0 page.tsx `viewPrefs.periodMode`. 아래 SQL은 그 창(window)으로 센다.
  const w = d.matrixWindow; assert.ok(w.start <= w.end && (w.kind === 'month' || d.viewPrefs.periodMode === 'session'));
  assert.equal(d.mode, 'class'); assert.equal(d.groups.length, 1); assert.equal(d.hub, null);
  const m = d.groups[0].matrix, ids = m.students.map(s => s.id);
  assert.deepEqual(m.classes, [], 'per-group class list is not shipped'); assert.ok(d.base.classes.length > 0);
  // 명단 = 그 달 겹치는 수강(휴원·이전 종료 제외) ∪ 수강행 없이 기록만 있는 학생 — 같은 조건의 독립 SQL.
  const roster = await db`select distinct s.id from public.enrollments e join public.students s on s.id=e.student_id
    where e.tenant_id=${t} and e.class_id=${eng.id} and e.start_date<=${w.end} and not e.on_hold and (e.end_date is null or e.end_date>=${w.start})`;
  const visitors = await db`select distinct r.student_id id from public.attendance_records r where r.tenant_id=${t} and r.class_id=${eng.id} and r.session_date between ${w.start} and ${w.end}
    and not exists (select 1 from public.enrollments e where e.class_id=${eng.id} and e.student_id=r.student_id and e.start_date<=${w.end})`;
  assert.deepEqual(new Set(ids), new Set([...roster, ...visitors].map(x => x.id)), 'roster = enrolled ∪ recorded-only visitors');
  // 칸 수·시수 = (학생, 날짜, 교시)별 최신 1건을 날짜로 접은 것 — 툴바 합계(LiveStats fallback)와 같다.
  const [x] = await db`with latest as (select distinct on (student_id, session_date, coalesce(slot_start::text,'')) student_id, session_date, status::text status, session_units
      from public.attendance_records where tenant_id=${t} and class_id=${eng.id} and student_id = any(${ids}::uuid[]) and session_date between ${w.start} and ${w.end}
      order by student_id, session_date, coalesce(slot_start::text,''), recorded_at desc, id desc)
    select count(distinct (student_id, session_date))::int cells, coalesce(sum(case when status in ('absent','excused') then 0 when session_units is null or session_units<=0 then 1 else session_units end),0)::float8 units from latest`;
  assert.equal(d.statsCount.recorded, x.cells, 'recorded cells'); assert.equal(Math.round(d.statsCount.units * 10), Math.round(x.units * 10), 'units');
  // #88 — 등원 요일(분리등원 없을 때)은 그 달과 겹치는 배치 행의 요일 합집합(끝난 배치는 빠진다).
  const dows = (await db`select distinct day_of_week::text d from public.class_schedules where tenant_id=${t} and class_id=${eng.id} and valid_from<=${w.end} and (valid_to is null or valid_to>=${w.start})`).map(r => R.cal.DOW_KEYS.indexOf(r.d)).sort();
  const plain = (await db`select s.id from public.enrollments e join public.students s on s.id=e.student_id where e.class_id=${eng.id} and (e.attendance_days is null or cardinality(e.attendance_days)=0) and not e.on_hold and (e.end_date is null or e.end_date>=${w.start}) and e.start_date<=${w.end}`).map(r => r.id);
  for (const s of m.students.filter(s => plain.includes(s.id))) assert.deepEqual([...s.attendDows].sort(), dows, `attend dows ${s.name}`);
  // 31칸 이상(세션은 31일을 넘길 수 있다 — 2.0 padTo31은 채우기만) · 창 안 날짜 · 정렬된 줄은 명단과 같은 학생.
  const real = d.visibleDays.filter(v => v.date);
  assert.equal(d.visibleDays.length, Math.max(31, real.length)); assert.ok(real.length > 0 && real.every(v => v.date >= w.start && v.date <= w.end));
  assert.deepEqual(new Set(d.orderedRows.map(r => r.studentId)), new Set(ids));
  // 표시 문자열(선택지·안내)에 원문 코드가 새지 않는다.
  const shown = JSON.stringify([...[d.subjectOptions, d.teacherOptions, d.classOptions].flatMap(list => list.flatMap(o => [o.label, o.hint])), d.notices, d.selectedClassLabel, d.groups.flatMap(g => [g.className, g.subjectLabel])].filter(v => v != null));
  assert.doesNotMatch(shown, /\b(present|absent|late|early_leave|excused|undefined|null|math|english)\b/);
});

test('복사본: 강사 전체 보기 — 반 목록이 강사 축(담임 ∪ 그 달 교시 담당 ∪ 이전 담임)과 같고, 칸은 그 강사 몫만', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await loadAs({ teacher: T_KIM, mode: 'teacher', month: '2026-10' });
  assert.equal(d.mode, 'teacher'); assert.equal(d.effectiveTeacher, T_KIM);
  assert.deepEqual(d.attendanceScope?.teacherId, T_KIM, 'saves are scoped to the teacher (2.0 attendanceScope)');
  const pool = (await db`select id from public.classes where tenant_id=${t} and is_makeup_pool`).map(r => r.id);
  const shown = d.groups.map(g => g.classId).filter(id => !pool.includes(id));
  assert.deepEqual(new Set(shown), new Set(d.attendanceScope.classIds));
  const axis = await db`select c.id from public.classes c where c.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at>='2026-10-01') and (c.teacher_id=${T_KIM}
      or exists (select 1 from public.class_schedules s where s.class_id=c.id and s.teacher_id=${T_KIM} and s.valid_from<='2026-10-31' and (s.valid_to is null or s.valid_to>='2026-10-01')))`;
  for (const id of shown) assert.ok(axis.some(a => a.id === id), 'every class shown is on the teacher axis');
  assert.ok(shown.length >= axis.length - 2, 'only classes taken over after the month may drop out');
  assert.ok(d.notices.some(n => n.key === 'scope' && n.parts.some(([, v]) => v.includes('이 선생님이 맡은 교시'))), 'scope notice');
  assert.equal(d.totalStudents, new Set(d.groups.filter(g => !pool.includes(g.classId)).flatMap(g => g.matrix.students.map(s => s.id))).size);
});

test('복사본: 허브 — 오늘(복사본 기준일) 처리 현황 합계가 독립 SQL과 같다', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await loadAs({});
  assert.ok(d.hubShown && d.hub && d.groups.length === 0); assert.equal(d.asOf, await A.copyDay());
  assert.ok(d.hub.teachers.length > 0 && d.hub.teachers.every(x => typeof x.id === 'string' && typeof x.name === 'string'));
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

test('복사본: 저장하는 사람 = 출결 전체 권한 직원(보호 계정 제외) · 보는 사람의 보기 설정', { skip: !db && 'local database not running' }, async () => {
  const d = await loadAs({});
  const supers = (await db`select id::text id from public.super_admins`.catch(() => [])).map(r => r.id);
  assert.ok(d.editors.length > 0 && d.editors.every(e => e.name && e.role && !supers.includes(e.id)), 'editors carry a role label and skip protected accounts');
  assert.doesNotMatch(JSON.stringify(d.editors), /super_admin|슈퍼|master|admin\b/);
  // 원장 먼저(2.0 ROLE_HIERARCHY 순) — 호스트는 고른 사람이 없으면 첫 사람으로 저장한다.
  const rank = label => R.roles.ROLE_HIERARCHY[Object.keys(R.roles.ROLE_LABEL).find(k => R.roles.ROLE_LABEL[k] === label)];
  assert.ok(d.editors.every((e, i) => i === 0 || rank(d.editors[i - 1].role) <= rank(e.role)), 'editors ordered by role');
  const other = d.editors.find(e => e.id !== d.viewer);
  const v = await loadAs({ viewer: other.id });
  assert.equal(v.viewer, other.id);
  const [row] = await db`select ui_prefs from public.users where id=${other.id}`;
  same(v.viewPrefs, R.viewPrefs.parseAttendanceViewPrefs(row?.ui_prefs?.attendance));
  assert.equal((await loadAs({ viewer: STUDENT })).viewer, d.viewer, 'a non-editor viewer falls back');
  // 화면에 급여 칸 이름이 실리지 않는다.
  assert.doesNotMatch(JSON.stringify(v), /hourly_rate|monthly_base|hourlyRate|monthlyBase/);
});

// ── 2단계: 저장(2.0 "use server") — 테스트 학생 '학원이' · 테스트 반(원장의 시험용), 늘 되돌리는 트랜잭션 하나 안에서. ──
const call = (name, actor, ...args) => ({ module: name === 'setAttendanceCell' ? ACTIONS : PREFS, actor, args });
async function inRollback(fn) {
  const { tenantId } = await import('./full-db.mjs');
  const run = (sql, name, raw) => screen.actions[name].run({ sql, body: screen.actions[name].validate(raw), tenantId, importV2 });
  await db.begin(async sql => { await fn({ sql, run, t: tenantId }); throw ROLLBACK; }).catch(e => { if (e !== ROLLBACK) throw e; });
}
const cell = { studentId: STUDENT, classId: CLASS, sessionDate: '2026-10-26' };

test('저장: 입력 검사는 복사본에 닿기 전에 거절한다', () => {
  const v = raw => screen.actions.setAttendanceCell.validate(raw), A1 = CLASS;
  assert.throws(() => v(call('setAttendanceCell', 'x', cell)), /저장하는 사람을 먼저 고르세요/);
  assert.throws(() => v({ ...call('setAttendanceCell', A1, cell), module: PREFS }), /입력 값/, 'another 2.0 module');
  assert.throws(() => v(call('setAttendanceCell', A1, cell, {})), /입력 값/, 'one argument');
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, sessionDate: '2026-10-26T00' })), /입력 값/);
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, status: 'gone' })), /잘못된 상태/);
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, units: 5 })), /입력 값/);
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, scopeTeacherId: 'x' })), /입력 값/);
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, noteOnly: 'yes' })), /입력 값/);
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, note: 'x'.repeat(2001) })), /입력 값/);
  for (const k of [{ slotStart: '16:20' }, { source: 'daily' }, { onlyIfEmpty: true }, { allowMakeup: true }, { ghostTransfer: true }]) assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, ...k })), e => e.code === 'not_in_copy', JSON.stringify(k));
  assert.equal(v(call('setAttendanceCell', A1, cell)).status, null); assert.equal(v(call('setAttendanceCell', A1, { ...cell, note: null })).note, null);
  const p = (name, val) => screen.actions[name].validate(call(name, A1, val));
  assert.throws(() => p('saveAttendanceSort', 1), /입력 값/); assert.throws(() => p('saveAttendanceHideRetired', 'yes'), /입력 값/);
  assert.throws(() => p('saveAttendanceCollapsed', ['x'.repeat(65)]), /입력 값/); assert.throws(() => p('saveAttendancePeriodMode', null), /입력 값/);
  assert.throws(() => screen.actions.saveAttendanceSort.validate(call('setAttendanceCell', A1, 'name')), /입력 값/, 'prefs only from prefs-actions.ts');
});

test('저장(복사본, 되돌림): 칸 입력·덮어쓰기·메모만·지우기가 2.0과 같은 행·감사로그를 남긴다', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), actors = await A.__test.actorsOf(sql, t, R, settings);
    const [{ teacher_id: homeroom }] = await sql`select teacher_id from public.classes where id=${CLASS}`;
    const actor = actors.find(a => a.id === homeroom) ?? actors[0], desk = actors.find(a => a.id !== homeroom && a.role !== 'master');
    assert.ok(actor && desk, 'two writers to compare recorded_via');
    const save = (who, input) => run(sql, 'setAttendanceCell', call('setAttendanceCell', who.id ?? who, { ...cell, ...input }));
    /** 격자 타이핑이 보내는 값 = 2.0 `commitBuffer`(grid-context가 setAttendanceCell에 그대로 넘긴다). */
    const typed = buf => R.typing.commitBuffer(buf);
    const rows = () => sql`select status::text status, session_units::float8 units, note, recorded_by, recorded_via, slot_start from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${cell.sessionDate}`;
    // 한 트랜잭션이라 감사로그 시각(now())이 모두 같다 — 순서가 아니라 내용으로 찾는다.
    const audits = action => sql`select actor_id, actor_name, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'studentId'=${STUDENT} and metadata->>'date'=${cell.sessionDate} and metadata->>'via'='3.0 연습 복사본'`;
    const one = async (action, pred) => { const list = (await audits(action)).filter(pred); assert.equal(list.length, 1, `${action}: exactly one matching line`); return list[0]; };
    // 지우고 시작(복사본에 그날 기록이 있을 수 있다) → 타이핑 '1' = 새 행 한 줄(출석 · 시수 기본 · 교시 없음 · 그 반 담임이 쓰면 'teacher').
    await save(actor, { status: null });
    assert.equal((await rows()).length, 0);
    assert.deepEqual(await save(actor, typed('1')), { ok: true });
    let [r] = await rows();
    assert.deepEqual({ ...r }, { status: 'present', units: null, note: null, recorded_by: actor.id, recorded_via: 'teacher', slot_start: null });
    let a = await one('attendance_cell', x => x.metadata.created === true && x.metadata.status === 'present' && !x.metadata.scopeTeacherId);
    assert.deepEqual([a.actor_id, a.actor_name, a.metadata.units], [actor.id, actor.name, null]);
    // 덮어쓰기 — 지각 + 시수 1.5, 이전 상태·시수가 감사로그에 남는다. 담임이 아닌 사람이 쓰면 'desk'.
    await save(desk, { status: 'late', units: '1.5' });
    [r] = await rows(); assert.deepEqual([r.status, r.units, r.recorded_by, r.recorded_via], ['late', 1.5, desk.id, 'desk']);
    a = await one('attendance_cell', x => x.metadata.status === 'late');
    assert.deepEqual([a.actor_id, a.metadata.overwrote, a.metadata.prevStatus, a.metadata.units, a.metadata.prevUnits, a.metadata.nextUnits], [desk.id, true, 'present', 1.5, 1, 1.5]);
    // 메모만 — 상태·시수·입력자는 그대로, 감사로그엔 본문 없이 '채웠다'만.
    await save(desk, { noteOnly: true, note: ' 병결 ' });
    [r] = await rows(); assert.deepEqual([r.status, r.units, r.note, r.recorded_by], ['late', 1.5, '병결', desk.id]);
    a = await one('attendance_note', () => true); assert.equal(a.metadata.cleared, false); assert.ok(!JSON.stringify(a.metadata).includes('병결'), 'no memo text in the audit line');
    // 타이핑 '0' = 결석(시수 기본으로), 메모는 그대로.
    await save(desk, typed('0'));
    [r] = await rows(); assert.deepEqual([r.status, r.units, r.note], ['absent', null, '병결']);
    // 지우기(Delete = status null) — 행이 사라지고 2.0 지우기 줄.
    await save(desk, { status: null });
    assert.equal((await rows()).length, 0); assert.equal((await audits('attendance_clear')).length, 2, 'two clears (start + this one)');
    // 기록 없는 칸의 메모만은 2.0 문장으로 거절.
    await assert.rejects(save(desk, { noteOnly: true, note: 'x' }), /먼저 출결을 입력하세요/);
    // 강사 보기(그 반을 맡은 강사) — 같은 칸을 그 강사 몫으로 쓴다(수학 반은 교시 담당이 없어 담임 몫 = 그날 한 행).
    await save(actor, { status: 'present', units: '', scopeTeacherId: homeroom });
    [r] = await rows(); assert.equal(r.status, 'present'); await one('attendance_cell', x => x.metadata.scopeTeacherId === homeroom && x.metadata.created === true);
    // 그 반을 안 맡은 강사의 보기에서 온 저장은 2.0 문장으로 거절.
    const [stranger] = await sql`select id from public.users where tenant_id=${t} and system_role='teacher' and status='active' and id not in (select coalesce(teacher_id,'00000000-0000-0000-0000-000000000000') from public.classes where id=${CLASS}) limit 1`;
    await assert.rejects(save(actor, { status: 'absent', scopeTeacherId: stranger.id }), e => e.code === 'scope_not_taught');
    // 출결 '전체' 권한이 아닌 사람(강사)은 저장할 수 없다.
    await assert.rejects(save(stranger.id, { status: 'present' }), e => e.status === 403);
    // 보강 예약이 걸린 칸 — 2.0은 예약 이행까지 바꾸므로 3.0은 저장하지 않는다(사유를 말한다).
    await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status) values (${t}, ${STUDENT}, ${CLASS}, '2026-10-20', ${cell.sessionDate}, '16:20', '17:15', 'reserved')`;
    await assert.rejects(save(actor, { status: 'present' }), e => e.code === 'reservation_cell');
    // 바깥으로 나가려는 요청이 없다.
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits`;
  assert.equal(after[0].audits, before[0].audits, 'rolled back — the copy is unchanged');
});

test('저장(복사본, 되돌림): 보기 설정 4종 = 2.0 prefs-actions — 그 사람의 ui_prefs.attendance만, 다른 화면 설정은 그대로', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), [who] = await A.__test.actorsOf(sql, t, R, settings);
    const prefsOf = async () => (await sql`select ui_prefs from public.users where id=${who.id}`)[0].ui_prefs ?? {};
    const others = Object.fromEntries(Object.entries(await prefsOf()).filter(([k]) => k !== 'attendance'));
    assert.deepEqual(await run(sql, 'saveAttendanceSort', call('saveAttendanceSort', who.id, 'name')), { ok: true });
    await run(sql, 'saveAttendancePeriodMode', call('saveAttendancePeriodMode', who.id, 'session'));
    await run(sql, 'saveAttendanceHideRetired', call('saveAttendanceHideRetired', who.id, false));
    await run(sql, 'saveAttendanceCollapsed', call('saveAttendanceCollapsed', who.id, [CLASS, CLASS]));
    const after = await prefsOf();
    same(after.attendance, R.viewPrefs.parseAttendanceViewPrefs({ sort: R.sort.parseAttendanceSortKey('name'), periodMode: 'session', hideRetired: false, collapsed: [CLASS, CLASS] }));
    same(Object.fromEntries(Object.entries(after).filter(([k]) => k !== 'attendance')), others, 'other screens untouched');
    // 2.0 parse가 모르는 값은 2.0 기본값으로.
    await run(sql, 'saveAttendanceSort', call('saveAttendanceSort', who.id, 'nope'));
    assert.equal((await prefsOf()).attendance.sort, R.sort.parseAttendanceSortKey('nope'));
    // 고를 수 없는 사람은 거절.
    await assert.rejects(run(sql, 'saveAttendanceSort', call('saveAttendanceSort', STUDENT, 'name')), e => e.status === 403);
    // 다음 load는 그 사람의 설정으로 그린다.
    const d = await screen.load({ sql, params: { viewer: who.id }, tenantId: t, importV2 });
    assert.equal(d.viewPrefs.periodMode, 'session'); assert.equal(d.viewPrefs.hideRetired, false);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
});

test.after(async () => { await db?.end(); });
