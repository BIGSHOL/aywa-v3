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
  assert.deepEqual(Object.keys(screen.actions).sort(), ['clearSeatPeriodChoices', 'commitSeatJjEdits', 'fillSeatPrevAbsent', 'fillSeatSlot', 'moveSeatStudentPeriod', 'previewAbsenceIntake',
    'pullSeatMemorizedWords', 'recordAbsenceIntake', 'resetSeatPlacements', 'saveAttendanceCollapsed', 'saveAttendanceHideRetired', 'saveAttendancePeriodMode', 'saveAttendanceSort',
    'saveSeatMonthlyCollapsed', 'searchAttendanceHubStudents', 'searchIntakeStudents', 'setAttendanceCell', 'setSeatCell', 'setSeatJjField']);
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

// ── 자리(랩실·JJ실) 출석부 메뉴 — /attendance/seat/<자리>(하루) · …/month(월간) ──
const SEAT = await import('./v2-attendance-seat.mjs');
const S = await SEAT.loadSeatRules(importV2);
const seatLoad = params => loadAs(params);

test('자리: 옮긴 본문이 2.0 원문과 같다(영역 설정 기본값 · 날짜 이동 · 날짜 표기)', async () => {
  const skill = await src('features/owner/skill-areas.ts'), page = await src('app/(shell)/attendance/seat/[seat]/page.tsx'), mine = await here('v2-attendance-seat.mjs');
  for (const name of ['DEFAULT_ENGLISH_SKILL_AREAS', 'resolveSkillAreas']) assert.equal(strip(extract(mine, name)), strip(extract(skill, name)), `${name} body`);
  for (const name of ['shiftDate', 'dateLabel']) assert.equal(strip(extract(mine, name)), strip(extract(page, name)), `${name} body`);
  const O = original([extract(page, 'shiftDate'), extract(page, 'dateLabel')], ['shiftDate', 'dateLabel']);
  for (const [d, n] of [['2026-10-31', 1], ['2026-03-01', -1], ['2026-12-31', 1]]) assert.equal(SEAT.shiftDate(d, n), O.shiftDate(d, n));
  for (const d of ['2026-10-27', '2026-01-01']) assert.equal(SEAT.dateLabel(d), O.dateLabel(d));
  assert.deepEqual(SEAT.resolveSkillAreas({ key: 'english' }).map(a => a.key), ['vocab', 'listening', 'reading', 'grammar', 'writing', 'speaking']);
  assert.deepEqual(SEAT.resolveSkillAreas({ key: 'math' }), []); assert.deepEqual(SEAT.resolveSkillAreas({ key: 'english', skillAreas: [{ key: 'x', label: 'X' }] }), [{ key: 'x', label: 'X' }]);
});

test('자리: 하위 주소·날짜·교시 매개변수는 정해진 값만 받는다', () => {
  const ok = (k, v) => screen.params[k].test(v);
  for (const v of ['/attendance', '/attendance/seat', '/attendance/seat/lab', '/attendance/seat/jj/month']) assert.ok(ok('v2path', v), v);
  for (const v of ['/attendance/seat/lab/print', '/attendance/live', '/attendance/seat/lab/month/x', '/timetable', '/attendance/seat/LAB']) assert.ok(!ok('v2path', v), v);
  assert.ok(ok('date', '2026-10-27') && !ok('date', '2026-10-27x') && ok('start', '14:20') && ok('start', 'all') && !ok('start', '1420'));
});

test('자리 호스트 조립이 2.0 page.tsx(하루·월간)와 같은 부품을 그린다', async () => {
  const day = await src('app/(shell)/attendance/seat/[seat]/page.tsx'), month = await src('app/(shell)/attendance/seat/[seat]/month/page.tsx');
  const hostDay = await here('v2-host/src/attendance-seat-page.tsx'), hostMonth = await here('v2-host/src/attendance-seat-month.tsx');
  for (const c of ['TextbookOptionsProvider', 'PageHeader', 'Link', 'MemorizedPullButton', 'PeriodNav', 'EmptyState', 'SeatAllDay', 'SeatJjAllDay', 'SeatBoard']) {
    assert.match(day, new RegExp(`<${c}\\b`), `seat page draws ${c}`); assert.match(hostDay, new RegExp(`<${c}\\b`), `host draws ${c}`);
  }
  for (const c of ['SeatMonthlyCollapse', 'PageHeader', 'MonthlyPrintButton', 'PeriodNav', 'CollapseAllChip', 'MonthlySummary', 'MonthlyLegend', 'MonthlyTable', 'EmptyState']) {
    assert.match(month, new RegExp(`<${c}\\b`), `month page draws ${c}`); assert.match(hostMonth, new RegExp(`<${c}\\b`), `host draws ${c}`);
  }
  for (const text of ['출석부로', '월간', '이전 날', '다음 날', '눌러서 오늘로', '수업이 없습니다']) assert.ok(day.includes(text) && hostDay.includes(text), text);
  for (const text of ['하루', '이전 달', '다음 달', '눌러서 이번 달로', '아직 열지 않은 자리입니다']) assert.ok(month.includes(text) && hostMonth.includes(text), text);
});

test('복사본: 자리 하루(랩실) — 교시별 명단·출결이 독립 SQL과 같다(그날 유효한 배치 · 수강 규약 · 등원 요일 · 교시 키)', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const DAY = '2026-10-26';
  const d = await seatLoad({ v2path: '/attendance/seat/lab', date: DAY, start: 'all' });
  assert.equal(d.page, 'seatDay'); assert.equal(d.view, 'lab'); assert.equal(d.date, DAY); assert.equal(d.today, await A.copyDay());
  const dow = R.cal.DOW_KEYS[new Date(`${DAY}T00:00:00Z`).getUTCDay()];
  // 그날 유효한 자리(랩실) 배치 — 라벨 판정은 2.0 specialSlotLabel.
  const slots = (await db`select class_id::text class_id, start_time::text st, slot_teacher_label l from public.class_schedules where tenant_id=${t} and day_of_week::text=${dow} and slot_teacher_label is not null and valid_from<=${DAY} and (valid_to is null or valid_to>=${DAY})`)
    .filter(r => R.tlabel.specialSlotLabel(r.l) === S.seat.SEAT_DB_LABEL.lab);
  assert.deepEqual(d.props.periods.map(p => p.start), [...new Set(slots.map(s => s.st.slice(0, 5)))].sort(), 'periods = distinct seat slot starts');
  for (const p of d.props.periods) {
    assert.deepEqual(new Set(p.classIds), new Set(slots.filter(s => s.st.slice(0, 5) === p.start).map(s => s.class_id)), `classes at ${p.start}`);
    for (const roster of p.rosters) {
      // 명단 = 그날 유효한 수강(휴원 제외 · 반이동으로 그날 닫힌 수강 제외) ∩ 그 요일 등원.
      const want = await db`select distinct s.id::text id from public.enrollments e join public.students s on s.id=e.student_id
        where e.tenant_id=${t} and e.class_id=${roster.classId} and e.on_hold is not true and e.start_date<=${DAY}
          and (e.end_date is null or e.end_date>${DAY} or (e.end_date=${DAY} and not coalesce(e.is_transferred,false)))
          and (e.attendance_days is null or cardinality(e.attendance_days)=0 or ${dow}=any(e.attendance_days::text[]))`;
      assert.deepEqual(new Set(roster.students.map(s => s.id)), new Set(want.map(x => x.id)), `roster ${roster.className} ${p.start}`);
      // 출결 = 그 교시 키(반·학생·날짜·교시)의 최신 1건(랩실은 급여 자리라 그날 전체 행으로 메우지 않는다).
      const recs = await db`select distinct on (student_id) student_id::text sid, status::text status from public.attendance_records
        where tenant_id=${t} and class_id=${roster.classId} and session_date=${DAY} and slot_start::text like ${`${p.start}%`} order by student_id, recorded_at desc, id desc`;
      const bySid = new Map(recs.map(r => [r.sid, r.status]));
      for (const s of roster.students) assert.equal(s.status, ['present', 'absent', 'late'].includes(bySid.get(s.id)) ? bySid.get(s.id) : bySid.has(s.id) ? bySid.get(s.id) : null, `${s.name} ${p.start}`);
    }
  }
  assert.ok(d.props.periods.flatMap(p => p.rosters).some(r => r.students.length > 0), 'the day has students');
  // 지난 날짜 — 출결 쓰기 권한이 있는 사람이 보면 쓰기 가능(2.0 canEditPast).
  assert.equal(d.readOnly, false);
});

test('복사본: 자리 하루(JJ실) — 교시 하나 보기 = SeatBoard · JJ 칸은 영어 시트 JJ 폼과 같은 행 · 계획은 영어 시트 권한으로', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await seatLoad({ v2path: '/attendance/seat/jj' });
  assert.equal(d.view, 'board'); assert.equal(d.props.showAllChip, true); assert.ok(d.props.hrefFor.startsWith('/attendance/seat/jj?date='));
  const p = d.props;
  const marks = await db`select class_id::text c, student_id::text s, slot_start::text sl, listening_level, memorized_words from public.class_sheet_student_marks where tenant_id=${t} and mark_date=${d.date} and slot_start::text like ${`${p.activeStart}%`}`;
  const byKey = new Map(marks.map(m => [`${m.c}|${m.s}`, m]));
  for (const r of p.rosters) for (const s of r.students) {
    const m = byKey.get(`${r.classId}|${s.id}`);
    assert.equal(s.listeningLevel, m?.listening_level ?? null); assert.equal(s.memorizedWords, m?.memorized_words ?? null);
  }
  // 계획 = 그날 그 교시 계획 줄(영어 반) — 보는 사람이 영어 시트 '전체'라 편집 가능.
  if (p.plans) for (const [classId, plan] of Object.entries(p.plans.plans)) {
    const [{ n }] = await db`select count(*)::int n from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date=${d.date} and slot_start::text like ${`${p.activeStart}%`}`;
    assert.equal(plan.lines.length, n, `plan lines ${classId}`); assert.equal(plan.canEdit, true);
  }
  // 저장 가능자 = 자리 메뉴 쓰기 권한 ∪ 당번 · 보호 계정 제외 · 원장 먼저.
  const supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
  assert.ok(d.editors.length > 0 && d.editors.every(e => !supers.includes(e.id) && e.role));
});

test('복사본: 자리 월간 — 반 묶음은 그 기간에 자리 배치가 산 반 · 31칸 이상 · 접은 반은 보는 사람 설정', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const d = await seatLoad({ v2path: '/attendance/seat/lab/month', month: '2026-10' });
  assert.equal(d.page, 'seatMonth'); assert.equal(d.month, '2026-10');
  const w = d.view.window;
  const live = (await db`select distinct class_id::text c, slot_teacher_label l from public.class_schedules where tenant_id=${t} and slot_teacher_label is not null and valid_from<=${w.end} and (valid_to is null or valid_to>=${w.start})`)
    .filter(r => R.tlabel.specialSlotLabel(r.l) === S.seat.SEAT_DB_LABEL.lab).map(r => r.c);
  for (const g of d.view.groups) assert.ok(live.includes(g.classId), `group ${g.className} has a lab slot in the window`);
  assert.ok(d.view.days.length >= 31); assert.ok(d.view.days.filter(x => !x.placeholder).every(x => x.date >= w.start && x.date <= w.end));
  // 요약의 학생 수 = 반이 여럿인 학생도 한 번(2.0 buildSeatMonthly).
  assert.equal(d.view.summary.studentCount, new Set(d.view.groups.flatMap(g => g.students.map(x => x.id))).size);
  const [row] = await db`select ui_prefs from public.users where id=${d.viewer}`;
  same(d.collapsed, S.monthlyPrefs.parseSeatMonthlyPrefs(row?.ui_prefs?.seatMonthly).collapsed);
  assert.equal((await seatLoad({ v2path: '/attendance/seat/zz/month' })).page, 'notFound');
  assert.equal((await seatLoad({ v2path: '/attendance/seat' })).to, '/attendance/seat/lab', '2.0 redirects to the first usable seat');
});

// ── 자리 저장(2.0 seat/server/*) — 테스트 반에 그 날 자리 교시를 하나 붙여(되돌리는 거래 안) 테스트 학생 '학원이'로만. ──
const SEAT_ACTIONS_MOD = 'features/attendance/seat/server/actions.ts', SEAT_MARKS_MOD = 'features/attendance/seat/server/mark-actions.ts';
test('저장(복사본, 되돌림): 자리 칸 출결·메모·지우기·남은 학생 일괄·JJ 칸이 2.0과 같은 행·감사로그를 남긴다', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const TODAY = await A.copyDay(), DOW = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()], SLOT = '22:00';
  await inRollback(async ({ sql, run, t }) => {
    for (const label of ['LAB', 'JJ']) await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, slot_teacher_label) values (${t}, ${CLASS}, ${DOW}, '22:00', '22:40', '2026-10-01', ${label})`;
    const settings = await A.readSettings(sql, t, R), [writer] = await SEAT.seatWritersOf(sql, t, R, S, settings, 'lab');
    const act = (name, module, input, actor = writer.id) => run(sql, name, { module, actor, args: [input] });
    const cellOf = seat => ({ seat, date: TODAY, slotStart: SLOT, classId: CLASS, studentId: STUDENT });
    const rows = () => sql`select status::text status, seat_label, recorded_via, slot_start::text slot_start, note, recorded_by::text recorded_by from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    const audits = action => sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'studentId'=${STUDENT} and metadata->>'via'='3.0 연습 복사본'`;
    const fills = action => sql`select metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'via'='3.0 연습 복사본' and metadata->'studentIds' ? ${STUDENT}`;
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    // 그 교시 명단에 테스트 학생이 선다(2.0 getSeatDay 규약).
    const day = await screen.load({ sql, params: { v2path: '/attendance/seat/lab', start: 'all', viewer: writer.id }, tenantId: t, importV2 });
    assert.ok(day.props.periods.find(p => p.start === SLOT)?.rosters.some(r => r.students.some(s => s.id === STUDENT)), 'test student on the lab roster at 22:00');
    // 랩실(급여 자리) — 새 행 = 자리 라벨 + recorded_via seat + 교시.
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'present' }), { ok: true, changed: 1 });
    let [r] = await rows(); assert.deepEqual({ ...r }, { status: 'present', seat_label: 'LAB', recorded_via: 'seat', slot_start: '22:00:00', note: null, recorded_by: writer.id });
    let [a] = await audits('seat_attendance_set'); assert.deepEqual([a.actor_id, a.metadata.status, a.metadata.rows, a.metadata.seat, a.metadata.slotStart, a.metadata.from], [writer.id, 'present', 1, 'lab', SLOT, 'menu']);
    // 같은 칸을 다시 쓰면 그 행을 고친다(행이 늘지 않는다).
    await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'late' });
    assert.deepEqual((await rows()).map(x => x.status), ['late']);
    // 메모만 — 상태 그대로, 감사로그엔 본문 없이.
    await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'late', noteOnly: true, note: ' 늦게 옴 ' });
    [r] = await rows(); assert.deepEqual([r.status, r.note], ['late', '늦게 옴']);
    [a] = await audits('seat_attendance_note'); assert.equal(a.metadata.cleared, false); assert.ok(!JSON.stringify(a.metadata).includes('늦게'));
    // 지우기 — 행이 사라지고 지우기 줄.
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: null }), { ok: true, changed: 1 });
    assert.equal((await rows()).length, 0); assert.equal((await audits('seat_attendance_clear')).length, 1);
    // 남은 학생 모두 출석 — 아직 안 찍힌 칸만, 두 번째는 0.
    assert.deepEqual(await act('fillSeatSlot', SEAT_ACTIONS_MOD, { seat: 'lab', date: TODAY, slotStart: SLOT, status: 'present' }), { ok: true, changed: 1 });
    assert.deepEqual((await rows()).map(x => [x.status, x.seat_label]), [['present', 'LAB']]);
    assert.deepEqual(await act('fillSeatSlot', SEAT_ACTIONS_MOD, { seat: 'lab', date: TODAY, slotStart: SLOT, status: 'present' }), { ok: true, changed: 0 });
    const [f] = await fills('seat_attendance_fill'); assert.deepEqual([f.metadata.count, f.metadata.skipped, f.metadata.status, f.metadata.classId], [1, 0, 'present', CLASS]);
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    // JJ실(비급여 자리) — 자리 라벨 없음 · 담임의 '그날 전체' 행이 있으면 그 행을 이 교시로 옮겨 쓴다(2.0 pickSaveTargets — 이중 계상 방지).
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${TODAY}, null, 'present', ${writer.id})`;
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('jj'), status: 'absent' }), { ok: true, changed: 1 });
    assert.deepEqual((await rows()).map(x => [x.status, x.seat_label, x.slot_start]), [['absent', null, '22:00:00']]);
    // JJ 칸 — 영어 시트 JJ 폼과 같은 행, 칸을 떠나면 한 줄(바뀐 칸만), 모두 비우면 행이 지워진다.
    const marks = () => sql`select listening_level, memorized_words, updated_by::text updated_by from public.class_sheet_student_marks where class_id=${CLASS} and student_id=${STUDENT} and mark_date=${TODAY} and slot_start='22:00'`;
    assert.deepEqual(await act('setSeatJjField', SEAT_MARKS_MOD, { ...cellOf('jj'), field: 'listeningLevel', value: ' 7 ' }), { ok: true });
    assert.deepEqual((await marks()).map(m => [m.listening_level, m.updated_by]), [['7', writer.id]]);
    const edit = { cell: { kind: 'seatJj', classId: CLASS, studentId: STUDENT, date: TODAY, slotStart: SLOT, field: 'listeningLevel' }, before: null };
    assert.deepEqual(await act('commitSeatJjEdits', SEAT_MARKS_MOD, { seat: 'jj', date: TODAY, slotStart: SLOT, edits: [edit] }), { ok: true });
    [a] = await audits('seat_jj_mark_edit'); assert.deepEqual([a.metadata.field, a.metadata.before, a.metadata.after, a.metadata.from], ['listeningLevel', null, '7', 'menu']);
    await act('setSeatJjField', SEAT_MARKS_MOD, { ...cellOf('jj'), field: 'listeningLevel', value: '' });
    assert.equal((await marks()).length, 0, 'all-empty mark row removed');
    // 2.0 거절 문구 — 명단 밖 학생 · 권한 없는 사람 · 랩실에 JJ 칸.
    const [other] = await sql`select id::text id from public.students where tenant_id=${t} and not is_test limit 1`;
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), studentId: other.id, status: 'present' }), { error: '이 교시 명단에 없는 학생입니다' });
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'present' }, STUDENT), { error: '자리 출석부 입력 권한이 없습니다' });
    assert.deepEqual(await act('setSeatJjField', SEAT_MARKS_MOD, { ...cellOf('lab'), field: 'listeningLevel', value: '1' }), { error: '이 자리에는 기록 칸이 없습니다' });
    // 보강 예약이 걸린 칸 — 2.0은 예약 이행까지 바꾸므로 쓰지 않고 사유를 말한다(칸 하나 · 일괄 모두).
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status) values (${t}, ${STUDENT}, ${CLASS}, '2026-10-20', ${TODAY}, '22:00', '22:40', 'reserved')`;
    assert.match((await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'present' })).error, /보강 예약이 걸린 칸/);
    assert.match((await act('fillSeatSlot', SEAT_ACTIONS_MOD, { seat: 'lab', date: TODAY, slotStart: SLOT, status: 'absent' })).error, /보강 예약이 걸린 칸/);
    assert.equal((await rows()).length, 0);
    // 바깥 연동(인재원 단어수)은 부르지 않는다 · 월간 접기 = 그 사람 ui_prefs.seatMonthly.
    assert.match((await run(sql, 'pullSeatMemorizedWords', { module: 'features/attendance/seat/server/memorized-actions.ts', actor: writer.id, args: [{ seat: 'jj', date: TODAY }] })).error, /바깥/);
    assert.deepEqual(await run(sql, 'saveSeatMonthlyCollapsed', { module: 'features/attendance/seat/server/monthly-prefs.ts', actor: writer.id, args: [[CLASS]] }), { ok: true });
    const [u] = await sql`select ui_prefs from public.users where id=${writer.id}`;
    same(u.ui_prefs.seatMonthly, S.monthlyPrefs.parseSeatMonthlyPrefs({ collapsed: [CLASS] }));
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
});

test('저장(복사본, 되돌림): 앞 교시 결석 → 이 교시도 결석(2.0 fillSeatPrevAbsent · seat_attendance_fill_prev)', { skip: !db && 'local database not running' }, async () => {
  const TODAY = await A.copyDay(), DOW = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()];
  await inRollback(async ({ sql, run, t }) => {
    for (const st of ['21:00', '22:00']) await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, slot_teacher_label) values (${t}, ${CLASS}, ${DOW}, ${st}, ${st.replace(':00', ':40')}, '2026-10-01', 'LAB')`;
    const settings = await A.readSettings(sql, t, R), [writer] = await SEAT.seatWritersOf(sql, t, R, S, settings, 'lab');
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    const act = (name, input) => run(sql, name, { module: SEAT_ACTIONS_MOD, actor: writer.id, args: [input] });
    await act('setSeatCell', { seat: 'lab', date: TODAY, slotStart: '21:00', classId: CLASS, studentId: STUDENT, status: 'absent' });
    // 화면의 'N명' 표식과 같은 함수(prevPeriodAbsences) — 22:00 교시에 이 학생이 후보로 선다.
    const d = await screen.load({ sql, params: { v2path: '/attendance/seat/lab', start: 'all', viewer: writer.id }, tenantId: t, importV2 });
    assert.equal(d.props.periods.find(p => p.start === '22:00').prevAbsentByCell[`${CLASS}|${STUDENT}`], '21:00');
    assert.deepEqual(await act('fillSeatPrevAbsent', { seat: 'lab', date: TODAY, slotStart: '22:00' }), { ok: true, changed: 1 });
    const recs = await sql`select slot_start::text s, status::text st from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY} order by slot_start`;
    assert.deepEqual(recs.map(r => [r.s, r.st]), [['21:00:00', 'absent'], ['22:00:00', 'absent']]);
    const [a] = await sql`select metadata from public.audit_logs where tenant_id=${t} and action='seat_attendance_fill_prev' and metadata->>'via'='3.0 연습 복사본' and metadata->'studentIds' ? ${STUDENT}`;
    assert.deepEqual([a.metadata.prevStarts, a.metadata.count, a.metadata.slotStart], [['21:00'], 1, '22:00']);
    assert.deepEqual(await act('fillSeatPrevAbsent', { seat: 'lab', date: TODAY, slotStart: '22:00' }), { ok: true, changed: 0 }, 'nothing left to fill');
  });
});

// 교시 이동·해제·배치 초기화(2.0 period-actions.ts · placement-actions.ts) — 출결은 한 줄도 안 바뀐다. 테스트 반 둘(학원이 · 학원삼)만.
const CLASS2 = '50d2ece7-6514-4474-8cfc-dd8983d15c18', SEAT_PERIODS_MOD = 'features/attendance/seat/server/period-actions.ts', SEAT_PLACE_MOD = 'features/attendance/seat/server/placement-actions.ts';
test('저장(복사본, 되돌림): 랩실 교시 이동·상시 고정·해제·배치 초기화가 2.0과 같은 행·감사로그를 남기고 출결은 그대로다', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const TODAY = await A.copyDay(), DOW = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()];
  await inRollback(async ({ sql, run, t }) => {
    for (const [cls, st] of [[CLASS, '21:00'], [CLASS, '22:00'], [CLASS2, '20:00'], [CLASS2, '22:00']])
      await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, slot_teacher_label) values (${t}, ${cls}, ${DOW}, ${st}, ${st.replace(':00', ':40')}, '2026-10-01', 'LAB')`;
    await sql`delete from public.attendance_records where class_id = any(${[CLASS, CLASS2]}::uuid[]) and session_date=${TODAY}`;
    const settings = await A.readSettings(sql, t, R), [writer] = await SEAT.seatWritersOf(sql, t, R, S, settings, 'lab');
    const marks = async () => (await sql`select count(*)::int n, coalesce(max(recorded_at)::text, '') at from public.attendance_records where tenant_id=${t} and session_date=${TODAY} and class_id = any(${[CLASS, CLASS2]}::uuid[])`)[0];
    const marksBefore = await marks();
    const move = (input, actor = writer.id) => run(sql, 'moveSeatStudentPeriod', { module: SEAT_PERIODS_MOD, actor, args: [{ seat: 'lab', date: TODAY, studentId: STUDENT, classId: CLASS, ...input }] });
    const audits = action => sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'via'='3.0 연습 복사본' and metadata->>'date'=${TODAY} order by created_at, id`;
    const dayView = async () => (await screen.load({ sql, params: { v2path: '/attendance/seat/lab', start: 'all', viewer: writer.id }, tenantId: t, importV2 })).props;
    const movesRows = () => sql`select slot_start::text s, moved_by::text by from public.seat_period_moves where tenant_id=${t} and seat='lab' and session_date=${TODAY} and student_id=${STUDENT}`;
    // 하루 두 번 도는 반의 교시 고르기(21:00 → 22:00 · 그 반의 자리 교시 = crossTime 아님).
    assert.deepEqual(await move({ fromSlot: '21:00', toSlot: '22:00' }), { ok: true, pinned: false });
    assert.deepEqual((await movesRows()).map(r => [r.s, r.by]), [['22:00:00', writer.id]]);
    let [a] = await audits('seat_period_move');
    assert.deepEqual([a.actor_id, a.metadata.fromSlot, a.metadata.toSlot, a.metadata.crossTime, a.metadata.classId, a.metadata.from], [writer.id, '21:00', '22:00', false, CLASS, 'menu']);
    let v = await dayView();
    same(v.choiceDay.moves, [{ classId: CLASS, studentId: STUDENT, slotStart: '22:00' }]);
    // 다른 시간(옆 반의 자리 교시 20:00 · 이 반엔 없는 교시 = crossTime) + 상시 고정 — 그날 줄은 제자리에서 고친다.
    assert.deepEqual(await move({ fromSlot: '22:00', toSlot: '20:00', pin: true }), { ok: true, pinned: true });
    assert.deepEqual((await sql`select day_of_week, slot_start::text s, effective_from::text f, pinned_by::text by from public.seat_period_pins where tenant_id=${t} and seat='lab' and student_id=${STUDENT}`).map(r => [r.day_of_week, r.s, r.f, r.by]), [[DOW, '20:00:00', TODAY, writer.id]]);
    assert.deepEqual((await movesRows()).map(r => r.s), ['20:00:00'], 'same day row updated in place');
    [a] = await audits('seat_period_pin');
    assert.deepEqual([a.metadata.crossTime, a.metadata.dayOfWeek, a.metadata.effectiveFrom, a.metadata.confirmOnly], [true, DOW, TODAY, undefined]);
    // 고정 확인만(창의 두 번째 호출 — 학생은 이미 20:00에 서 있다).
    assert.deepEqual(await move({ fromSlot: '22:00', toSlot: '20:00', pin: true }), { ok: true, pinned: true });
    // ⚠️ 한 거래 안이라 created_at이 같다 — 줄 순서에 기대지 않고 내용으로 고른다.
    assert.deepEqual((await audits('seat_period_pin')).map(x => x.metadata.confirmOnly ?? false).sort(), [false, true]);
    // 2.0 거절 문구 — 같은 교시 · 없는 교시 · 명단 밖 · JJ실 · 권한 없음 · 찍힌 학생.
    assert.deepEqual(await move({ fromSlot: '20:00', toSlot: '20:00' }), { error: S.choice.SEAT_PERIOD_SAME });
    assert.deepEqual(await move({ fromSlot: '20:00', toSlot: '23:00' }), { error: S.choice.SEAT_PERIOD_NO_SLOT });
    assert.deepEqual(await move({ fromSlot: '21:00', toSlot: '22:00' }), { error: '이 교시 명단에 없는 학생입니다' }, 'moved away from 21:00 already');
    assert.deepEqual(await run(sql, 'moveSeatStudentPeriod', { module: SEAT_PERIODS_MOD, actor: writer.id, args: [{ seat: 'jj', date: TODAY, studentId: STUDENT, classId: CLASS, fromSlot: '21:00', toSlot: '22:00' }] }), { error: 'JJ실은 자리 이동을 쓰지 않습니다' });
    assert.deepEqual(await move({ fromSlot: '20:00', toSlot: '22:00' }, STUDENT), { error: '자리 출석부 입력 권한이 없습니다' });
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${TODAY}, '20:00', 'present', 'LAB', ${writer.id})`;
    assert.deepEqual(await move({ fromSlot: '20:00', toSlot: '22:00' }), { error: S.placement.SEAT_MOVE_MARKED_ERROR });
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    // 해제 — 그날 이동 + 그 요일 고정을 함께(두 번째는 0 · 줄 없음).
    const clear = () => run(sql, 'clearSeatPeriodChoices', { module: SEAT_PERIODS_MOD, actor: writer.id, args: [{ seat: 'lab', date: TODAY, classId: CLASS }] });
    assert.deepEqual(await clear(), { ok: true, changed: 2 });
    [a] = await audits('seat_period_clear');
    assert.deepEqual([a.metadata.count, a.metadata.dayOfWeek, a.metadata.removedMoves, a.metadata.removedPins], [2, DOW, [{ studentId: STUDENT, slotStart: '20:00' }], [{ studentId: STUDENT, slotStart: '20:00' }]]);
    assert.deepEqual(await clear(), { ok: true, changed: 0 }); assert.equal((await audits('seat_period_clear')).length, 1);
    v = await dayView(); same([v.choiceDay.moves, v.choiceDay.pins], [[], []]);
    // 배치 초기화 — 22:00에 학원이를 옆 반(학원삼) 묶음에 옮겨 둔 줄(드래그로 새로 만드는 길은 2.0에 없다 — 이미 있는 줄).
    const place = () => sql`insert into public.seat_placements (tenant_id, seat, session_date, slot_start, student_id, from_class_id, to_class_id, moved_by) values (${t}, 'lab', ${TODAY}, '22:00', ${STUDENT}, ${CLASS}, ${CLASS2}, ${writer.id})`;
    const reset = classId => run(sql, 'resetSeatPlacements', { module: SEAT_PLACE_MOD, actor: writer.id, args: [{ seat: 'lab', date: TODAY, slotStart: '22:00', ...(classId ? { classId } : {}) }] });
    await place();
    same((await dayView()).periods.find(p => p.start === '22:00').placements, [{ studentId: STUDENT, fromClassId: CLASS, toClassId: CLASS2 }]);
    assert.deepEqual(await reset(CLASS), { ok: true, changed: 0 }, 'nobody was moved INTO the home class');
    assert.deepEqual(await reset(CLASS2), { ok: true, changed: 1 });
    [a] = await audits('seat_placement_reset');
    assert.deepEqual([a.metadata.scope, a.metadata.classId, a.metadata.slotStart, a.metadata.count, a.metadata.moves], ['class', CLASS2, '22:00', 1, [{ studentId: STUDENT, fromClassId: CLASS2, toClassId: CLASS }]]);
    await place();
    assert.deepEqual(await reset(), { ok: true, changed: 1 });
    const resets = (await audits('seat_placement_reset')).map(x => x.metadata), last = resets.find(m => m.scope === 'period');
    assert.deepEqual([resets.length, 'classId' in last, last.count], [2, false, 1]);
    assert.equal((await sql`select count(*)::int n from public.seat_placements where tenant_id=${t} and session_date=${TODAY}`)[0].n, 0);
    assert.deepEqual(await run(sql, 'resetSeatPlacements', { module: SEAT_PLACE_MOD, actor: writer.id, args: [{ seat: 'lab', date: TODAY, slotStart: '23:00' }] }), { error: '그 시각에는 이 자리 수업이 없습니다' });
    // 출결은 한 줄도 안 바뀌었다(2.0: 이 두 파일은 attendance_records에 쓰지 않는다) · 바깥 요청 없음.
    assert.deepEqual(await marks(), marksBefore);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
});

test('저장: 자리 액션 입력 검사는 복사본에 닿기 전에 거절한다', () => {
  const v = (name, module, input) => screen.actions[name].validate({ module, actor: CLASS, args: [input] });
  const base = { seat: 'lab', date: '2026-10-27', slotStart: '22:00', classId: CLASS, studentId: STUDENT };
  assert.equal(v('setSeatCell', SEAT_ACTIONS_MOD, base).input.seat, 'lab');
  for (const bad of [{ ...base, seat: 'LAB!' }, { ...base, date: '2026-10' }, { ...base, slotStart: '2200' }, { ...base, classId: 'x' }, { ...base, studentId: undefined }]) assert.throws(() => v('setSeatCell', SEAT_ACTIONS_MOD, bad), /입력 값/);
  assert.throws(() => v('setSeatCell', SEAT_MARKS_MOD, base), /입력 값/, 'another 2.0 module');
  assert.throws(() => screen.actions.saveSeatMonthlyCollapsed.validate({ module: 'features/attendance/seat/server/monthly-prefs.ts', actor: CLASS, args: ['x'] }), /입력 값/);
  const mv = { seat: 'lab', date: '2026-10-27', studentId: STUDENT, classId: CLASS, fromSlot: '21:00', toSlot: '22:00' };
  assert.equal(v('moveSeatStudentPeriod', SEAT_PERIODS_MOD, { ...mv, pin: true }).input.pin, true);
  for (const bad of [{ ...mv, toSlot: undefined }, { ...mv, fromSlot: '9:00' }, { ...mv, pin: 'yes' }, { ...mv, studentId: 'x' }]) assert.throws(() => v('moveSeatStudentPeriod', SEAT_PERIODS_MOD, bad), /입력 값/);
  assert.throws(() => v('clearSeatPeriodChoices', SEAT_PERIODS_MOD, { seat: 'lab', date: '2026-10-27' }), /입력 값/, 'classId required');
  assert.equal(v('resetSeatPlacements', SEAT_PLACE_MOD, { seat: 'lab', date: '2026-10-27', slotStart: '22:00' }).input.classId, undefined);
  assert.throws(() => v('resetSeatPlacements', SEAT_PLACE_MOD, { seat: 'lab', date: '2026-10-27' }), /입력 값/, 'slotStart required');
  assert.throws(() => v('resetSeatPlacements', SEAT_PERIODS_MOD, { seat: 'lab', date: '2026-10-27', slotStart: '22:00' }), /입력 값/, 'another 2.0 module');
});

test.after(async () => { await db?.end(); });
