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
  assert.deepEqual(Object.keys(screen.actions).sort(), ['cancelMakeupReservation', 'clearSeatPeriodChoices', 'commitSeatJjEdits', 'fillSeatPrevAbsent', 'fillSeatSlot', 'generateRecapSummary', 'getMakeupPeriodOptions',
    'moveSeatStudentPeriod', 'previewAbsenceIntake', 'pullSeatMemorizedWords', 'recordAbsenceIntake', 'recordFollowup', 'requestAttendanceInput', 'reserveMakeup', 'resetSeatPlacements', 'saveAttendanceCollapsed', 'saveAttendanceHideRetired', 'saveAttendancePeriodMode', 'saveAttendanceSort',
    'saveLiveSubjectFilter', 'saveSeatMonthlyCollapsed', 'searchAttendanceHubStudents', 'searchIntakeStudents', 'setAttendanceBulk', 'setAttendanceCell', 'setAttendanceRange', 'setSeatCell', 'setSeatJjField']);
});

test('허브 검색·결석 접수: 입력은 2.0 인자 모양만 받고(사람이 비어도 거절하지 않는다), 부품은 결과 모양을 그대로 읽는다', async () => {
  const HUB = 'features/attendance/server/hub-search-actions.ts', INTAKE = 'features/attendance/intake/server/actions.ts';
  assert.equal(screen.actions.searchIntakeStudents.validate({ module: INTAKE, actor: null, args: ['김'] }).actor, null);
  assert.throws(() => screen.actions.recordAbsenceIntake.validate({ module: INTAKE, actor: 'x', args: [{}] }), /입력 값/);
  assert.throws(() => screen.actions.recordAbsenceIntake.validate({ module: INTAKE, actor: CLASS, args: [{ exclude: 'k' }] }), /입력 값/);
  // 다른 2.0 모듈의 같은 이름·인자 넘침은 받지 않는다.
  assert.throws(() => screen.actions.searchIntakeStudents.validate({ module: HUB, args: ['김'] }), /입력 값/);
  assert.throws(() => screen.actions.searchAttendanceHubStudents.validate({ module: HUB, args: [{}, {}] }), /입력 값/);
  // 2.0 부품이 이 셋을 실제로 그렇게 읽는다(r.hits · setResults(r) · p.cells) — 공통 거절 모양이면 깨진다.
  const hubSrc = await src('app/(shell)/attendance/_components/hub-student-search.tsx'), intake = await src('app/(shell)/attendance/_components/absence-intake-dialog.tsx');
  assert.match(hubSrc, /searchAttendanceHubStudents\(\{ query: term, month \}\)\s*\.then\(\(r\) => \{[^}]*setResult\(r\)/);
  assert.match(intake, /setCells\(p\.cells\)/);
});

test('화면 파일에 운영 2.0 주소·끼워 넣기가 없고, 손그림 CSS는 지웠다', async () => {
  for (const f of ['v2-screen-attendance.js', 'v2-screen-attendance.mjs', 'v2-host/src/attendance.tsx', 'v2-host/src/attendance-page.tsx', 'v2-host/src/attendance-quick-page.tsx',
    'v2-host/src/attendance-live-page.tsx', 'v2-attendance-live.mjs', 'v2-attendance-seat-save.mjs']) {
    const text = await here(f);
    assert.doesNotMatch(text, /aywa\.co\.kr|vercel\.app|<iframe|https?:\/\/(?!127\.0\.0\.1)/i, f);
  }
  await assert.rejects(access(new URL('v2-screen-attendance.css', import.meta.url)), 'the hand-drawn stylesheet is gone');
  const js = await here('v2-screen-attendance.js');
  assert.doesNotMatch(js, /XMLHttpRequest|sendBeacon|method:\s*['"]POST/, 'the shell never writes');
  assert.deepEqual([...js.matchAll(/fetch\(([^,)]+)/g)].map(m => m[1]), ['HOST'], 'the shell only checks that the host page exists');
  // 호스트 진입점은 같은 출처 /api/v2/attendance만 읽는다.
  const entry = await here('v2-host/src/attendance.tsx');
  const reads = [...entry.matchAll(/fetch\(`([^`?$]+)/g)].map(m => m[1]);
  assert.ok(reads.length >= 1 && reads.every(u => u === '/api/v2/attendance'), JSON.stringify(reads));
  // 화면 폴링(2.0 poll-actions 두 함수)은 그 읽기 경로(GET ?poll=)로만 — 쓰기 경로(POST)를 타지 않는다.
  assert.match(entry, /registerHostHandler\('features\/attendance\/live\/server\/poll-actions\.ts', 'getLiveRecordedCount'/);
  assert.match(entry, /registerHostHandler\('features\/attendance\/recap\/server\/poll-actions\.ts', 'getRecapStatus'/);
  assert.doesNotMatch(entry, /method:\s*['"]POST/);
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
  for (const l of ['연습 화면', '실제 발송은 없습니다', '출석부를 여는 중…', 'data-v2-host-slot']) assert.ok(first.includes(l), l);
  assert.ok(!/2\.0|Docker|복사본/.test(first), '안내에 2.0·Docker·복사본 같은 말이 없다');
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
  // 주소의 actor=<직원 id>(업무 흐름 '처리 화면')가 고른 사람보다 먼저 이긴다 — 호스트로는 가지 않고 알림으로만 간다. 명단 밖 id는 무시.
  const A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222';
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-editors', screen: 'attendance', editors: [{ id: A1, name: '원장', role: '원장' }, { id: A2, name: '김그린', role: '관리자' }] } });
  ctx.location.hash = `#v2-attendance?v2path=/attendance/live&tab=desk&actor=${A2}`;
  def.render({ api, query: new URLSearchParams(`v2path=/attendance/live&tab=desk&actor=${A2}`) });
  same(posted.at(-1)[0], { type: 'v2-host-actor', id: A2 }); assert.equal(stored.get('v2-host-actor:attendance'), A2);
  assert.ok(!frame.src.includes('actor='), 'actor는 호스트 주소로 가지 않는다');
  ctx.location.hash = '#v2-attendance?actor=33333333-3333-4333-8333-333333333333';
  def.render({ api, query: new URLSearchParams('actor=33333333-3333-4333-8333-333333333333') });
  same(posted.at(-1)[0], { type: 'v2-host-actor', id: A2 }, '명단 밖 id는 무시하고 앞 사람 그대로');
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
  for (const k of [{ onlyIfEmpty: true }, { allowMakeup: true }, { ghostTransfer: true }]) assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, ...k })), e => e.code === 'not_in_copy', JSON.stringify(k));
  assert.throws(() => v(call('setAttendanceCell', A1, { ...cell, source: 'daily' })), /입력 값/, 'source is live or nothing');
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
    // 보강 예약이 걸린 칸의 이행·되돌림은 아래 '보강 예약 이행' 시험이 본다.
    // 바깥으로 나가려는 요청이 없다.
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits`;
  assert.equal(after[0].audits, before[0].audits, 'rolled back — the copy is unchanged');
});

test('저장(복사본, 되돌림): 보강 예약 이행 — 시수 자동값 · 두 번 들어와도 한 번만 · 지우면 되돌림 · 친 시수는 그대로 · 새 보강 체계 학원은 거절', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const MK = await import('./v2-attendance-makeup.mjs'), M = await MK.loadMakeupRules(importV2);
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), actors = await A.__test.actorsOf(sql, t, R, settings);
    assert.equal(MK.nativeMakeupsOn(M, settings), false, 'this copy runs the old reservation path (2.0 classifyLegacyReservations = legacy)');
    const [{ teacher_id: homeroom }] = await sql`select teacher_id from public.classes where id=${CLASS}`;
    const actor = actors.find(a => a.id === homeroom) ?? actors[0];
    const save = input => run(sql, 'setAttendanceCell', call('setAttendanceCell', actor.id, { ...cell, ...input }));
    const ABS = '2026-10-20', DAY = cell.sessionDate;
    assert.equal((await sql`select count(*)::int n from public.makeup_reservations where tenant_id=${t} and class_id=${CLASS} and student_id=${STUDENT} and makeup_date=${DAY}`)[0].n, 0, 'no other reservation on the cell');
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date in (${ABS}, ${DAY})`;
    const [resv] = await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status)
      values (${t}, ${STUDENT}, ${CLASS}, ${ABS}, ${DAY}, '16:20', '17:15', 'reserved') returning id::text id`;
    const rv = { id: resv.id, studentId: STUDENT, classId: CLASS, absenceDate: ABS, makeupDate: DAY, slotStart: '16:20', slotEnd: '17:15', periodLabel: null, note: null, status: 'reserved' };
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, note, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${ABS}, 'absent', ${M.resv.reservationAbsenceMemo(rv)}, ${actor.id})`;
    const resvRow = async () => ({ ...(await sql`select status, attendance_record_id::text rec, done_at is not null done from public.makeup_reservations where id=${resv.id}`)[0] });
    const mkRow = async () => (await sql`select id::text id, note, session_units::float8 units from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${DAY}`)[0];
    const absNote = async () => (await sql`select note from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${ABS}`)[0].note;
    const logs = action => sql`select actor_id::text actor_id, target_label, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'reservationId'=${resv.id} and metadata->>'via'='3.0 연습 복사본'`;
    const lineCount = (note, line) => (note ?? '').split(/\r?\n/).filter(l => l.trim() === line).length;
    const makeupLine = M.resv.reservationMakeupMemo(rv), plannedLine = M.resv.reservationAbsenceMemo(rv), doneLine = M.resv.reservationAbsenceDoneMemo(rv);
    // 기대 시수(독립 SQL) — 그날 그 반이 돌고 정규 수강생이면 정규(수업 분 → 수학 ceil(분/60)/2) + 보강(예약 55분 → 0.5).
    const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${DAY}T00:00:00Z`).getUTCDay()];
    const [{ m }] = await sql`select coalesce(sum(m), 0)::int m from (select start_time, max(extract(epoch from (end_time - start_time)) / 60) m from public.class_schedules
      where class_id=${CLASS} and day_of_week=${dow} and slot_teacher_label is null and valid_from<=${DAY} and (valid_to is null or valid_to>=${DAY}) group by start_time) x`;
    const [{ n: regular }] = await sql`select count(*)::int n from public.enrollments where class_id=${CLASS} and student_id=${STUDENT} and start_date<=${DAY} and (end_date is null or end_date>=${DAY})
      and not coalesce(on_hold, false) and not coalesce(is_transferred, false) and (attendance_days is null or cardinality(attendance_days)=0 or ${dow}=any(attendance_days::text[]))`;
    const expected = Math.round(((regular > 0 && m > 0 ? Math.ceil(m / 60) / 2 : 0) + Math.ceil(55 / 60) / 2) * 10) / 10;
    assert.ok(regular > 0 && m > 0, 'the test student attends the test class that day (regular + makeup)');

    // ① 새 칸 출석(시수 안 침) → done · 연결 · 보강 메모 한 줄 · 시수 자동값(화면 낙관값도 같은 값) · 결석 칸 '예정 → 완료' · 감사로그 한 줄.
    assert.deepEqual(await save({ status: 'present' }), { ok: true, autoUnits: expected });
    let mk = await mkRow();
    assert.equal(mk.units, expected);
    assert.deepEqual(await resvRow(), { status: 'done', rec: mk.id, done: true });
    assert.equal(lineCount(mk.note, makeupLine), 1);
    assert.deepEqual([lineCount(await absNote(), plannedLine), lineCount(await absNote(), doneLine)], [0, 1]);
    let done = await logs('makeup_reserve_done');
    assert.equal(done.length, 1);
    assert.deepEqual([done[0].actor_id, done[0].metadata.attendanceRecordId, done[0].metadata.status, done[0].metadata.autoUnits, done[0].metadata.absenceDate, done[0].metadata.makeupDate],
      [actor.id, mk.id, 'present', expected, ABS, DAY]);
    assert.match(done[0].target_label, /^학원이 · /);
    // ② 같은 칸을 다시 찍어도(지각 · 이미 done) 한 번만 — 감사로그·메모·시수 그대로.
    assert.deepEqual(await save({ status: 'late' }), { ok: true });
    mk = await mkRow();
    assert.deepEqual([mk.units, lineCount(mk.note, makeupLine), (await logs('makeup_reserve_done')).length], [expected, 1, 1]);
    // ③ 지우기 → 되돌림(reserved · 연결·완료 시각 해제 · 결석 칸 '완료 → 예정' · 감사로그).
    assert.deepEqual(await save({ status: null }), { ok: true });
    assert.deepEqual(await resvRow(), { status: 'reserved', rec: null, done: false });
    assert.deepEqual([lineCount(await absNote(), plannedLine), lineCount(await absNote(), doneLine)], [1, 0]);
    assert.equal((await logs('makeup_reserve_revert')).length, 1);
    // ④ 두 저장 경로가 같은 칸을 동시에 이행해도 한 번만(2.0 ① status 조건 + 0행이면 그만).
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${DAY}, 'present', ${actor.id})`;
    const ctx = { sql, t, R, M, settings, actor: { id: actor.id, name: actor.name } }, cells = [{ studentId: STUDENT, classId: CLASS, date: DAY, status: 'present', created: true }];
    const both = await Promise.all([MK.completeMakeupReservations(ctx, cells), MK.completeMakeupReservations(ctx, cells)]);
    assert.equal(both.filter(x => x.size > 0).length, 1, 'only one path set the units');
    assert.equal((await resvRow()).status, 'done');
    mk = await mkRow();
    assert.deepEqual([mk.units, lineCount(mk.note, makeupLine), (await logs('makeup_reserve_done')).length], [expected, 1, 2]);
    // ⑤ 결석으로 고침 → 되돌림(보강 칸 메모 줄도 지운다 · 시수는 그대로).
    await save({ status: 'absent' });
    mk = await mkRow();
    assert.deepEqual([(await resvRow()).status, lineCount(mk.note, makeupLine), (await logs('makeup_reserve_revert')).length], ['reserved', 0, 2]);
    // fail-soft — 이행이 깨져도(규칙 하나를 일부러 뺌) 저장 트랜잭션은 살아 있고 예약·출결은 그대로다(2.0은 로그만 남긴다).
    assert.equal((await MK.completeMakeupReservations({ ...ctx, R: { ...R, effective: undefined } }, cells)).size, 0);
    assert.deepEqual([(await resvRow()).status, (await sql`select status::text s from public.attendance_records where id=${mk.id}`)[0].s], ['reserved', 'absent']);
    // ⑥ 사람이 친 시수는 덮지 않는다(2.0 unitsExplicit) — 이행은 하되 그 숫자 그대로, 감사로그에 autoUnits 없음.
    await save({ status: 'present', units: '2' });
    mk = await mkRow();
    assert.deepEqual([(await resvRow()).status, mk.units], ['done', 2]);
    done = (await logs('makeup_reserve_done')).filter(x => x.metadata.status === 'present' && !('autoUnits' in x.metadata));
    assert.equal(done.length, 1);
    // ⑦ 새 보강 체계(보강관리 켜짐 · 정리 중)인 학원 — 그 연결 갈래를 옮기지 않아 보강 예약 칸은 쓰지 않는다(칸 · 교시 칸 · 일괄 모두, 바뀌는 것 없음).
    //    보강관리 설정은 2.0 설정 명령만 바꿀 수 있어(트리거 tg_guard_makeups_settings) 그 명령의 표식(makeup.ctx)을 이 트랜잭션에서만 잠깐 세운다.
    await save({ status: null });
    for (const mode of ['on', 'draining']) {
      await sql`select set_config('makeup.ctx', pg_current_xact_id()::text, true)`;
      await sql`update public.tenant_settings set data = jsonb_set(coalesce(data, '{}'::jsonb), '{makeups}', ${sql.json({ mode, allowAdditional: false, pilotSubjects: ['math'] })}) where tenant_id=${t}`;
      await sql`select set_config('makeup.ctx', '', true)`;
      assert.equal(MK.nativeMakeupsOn(M, await A.readSettings(sql, t, R)), true, mode);
      const refusal = async p => { try { await p; return null; } catch (e) { return [e.code, e.message]; } };
      const text = '보강 예약이 걸린 칸은 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.';
      assert.deepEqual(await refusal(save({ status: 'present' })), ['reservation_cell', text]);
      assert.deepEqual(await refusal(save({ status: 'present', slotStart: '16:20' })), ['reservation_cell', text]);
      assert.deepEqual(await refusal(run(sql, 'setAttendanceBulk', { module: ACTIONS, actor: actor.id, args: [{ sessionDate: DAY, status: 'present', cells: [{ studentId: STUDENT, classId: CLASS }] }] })), ['reservation_cell', text]);
      assert.equal(await mkRow(), undefined, `${mode}: nothing written`);
      assert.equal((await resvRow()).status, 'reserved');
    }
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
  assert.equal((await db`select data->'makeups'->>'mode' m from public.tenant_settings where tenant_id=(select tenant_id from public.classes where id=${CLASS})`)[0].m, 'off', 'setting restored');
});

test('보강 예약 창·취소: 입력은 2.0 인자 모양만 받고, 2.0 서버 전용 결석 칸 고르기를 옮긴 본문이 원문과 같은 답을 낸다', async () => {
  const Rv = await import('./v2-attendance-reserve.mjs'), MOD = Rv.RESERVE_MODULE;
  const v = (name, args, actor = CLASS) => screen.actions[name].validate({ module: MOD, actor, args });
  assert.throws(() => v('reserveMakeup', [{}], 'x'), /저장하는 사람을 먼저 고르세요/);
  assert.throws(() => screen.actions.reserveMakeup.validate({ module: ACTIONS, actor: CLASS, args: [{}] }), /입력 값/, 'another 2.0 module');
  assert.throws(() => v('getMakeupPeriodOptions', [CLASS, '2026-10-30', STUDENT, null, 'x']), /입력 값/, 'four arguments at most');
  assert.throws(() => v('getMakeupPeriodOptions', [CLASS, '2026-10-30', 'not-a-uuid']), /입력 값/);
  assert.throws(() => v('reserveMakeup', [{ studentId: STUDENT, classId: CLASS, periodIds: 'p1' }]), /입력 값/);
  assert.throws(() => v('reserveMakeup', [{ studentId: STUDENT, classId: CLASS, periodIds: Array(21).fill('p') }]), /입력 값/);
  assert.throws(() => v('reserveMakeup', [{ studentId: STUDENT, classId: CLASS, hostClassId: 'x' }]), /입력 값/);
  assert.throws(() => v('cancelMakeupReservation', [{ id: 5 }]), /입력 값/);
  assert.deepEqual(v('cancelMakeupReservation', [{ id: 'abc' }]), { actor: CLASS, id: 'abc' }, 'a non-uuid id is answered by run (2.0: not found)');
  const text = await src('features/attendance/server/absence-cell.ts');
  const O = original([extract(text, 'MADE_UP_RE'), extract(text, 'pickAbsenceNoteTarget')], ['pickAbsenceNoteTarget'],
    { hasMemoLine: (await importV2('features/onescreen/makeup-absence-link.ts')).hasMemoLine });
  const { hasMemoLine } = await importV2('features/onescreen/makeup-absence-link.ts');
  const cases = [[], [{ id: 'a', note: null }], [{ id: 'a', note: '10/5 보강 예정' }, { id: 'b', note: '병결' }], [{ id: 'a', note: '병결' }, { id: 'b', note: '병결\n10/30 보강 예정' }],
    [{ id: 'a', note: '10/5 보강 완료' }, { id: 'b', note: '9/1 보강 예정' }]];
  for (const rows of cases) same(Rv.PORTED.pickAbsenceNoteTarget(rows, '10/30 보강 예정', hasMemoLine), O.pickAbsenceNoteTarget(rows, '10/30 보강 예정'), JSON.stringify(rows));
});

test('저장(복사본, 되돌림): 보강 예약 창·취소 — 교시 선택지·기록할 반 · 예약 행 + 결석일 칸 · 취소 + 결석 칸 되돌리기가 2.0과 같은 행·감사로그', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.makeup_reservations) resv`;
  const Rv = await import('./v2-attendance-reserve.mjs'), MOD = Rv.RESERVE_MODULE, M = await (await import('./v2-attendance-makeup.mjs')).loadMakeupRules(importV2);
  const LV = await import('./v2-attendance-live.mjs');
  const TODAY = await A.copyDay(), addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const dowOf = d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];
  const nextWeekday = d => { let x = addDays(d, 1); while (['sat', 'sun'].includes(dowOf(x))) x = addDays(x, 1); return x; };
  const ABS = addDays(TODAY, -1), MK1 = nextWeekday(TODAY), MK2 = nextWeekday(MK1);
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), writers = await LV.attendanceWritersOf(sql, t, R, settings);
    const [{ teacher_id: homeroom, class_name: className }] = await sql`select teacher_id, class_name from public.classes where id=${CLASS}`;
    const full = writers.find(w => w.level === 'full' && w.id === homeroom) ?? writers.find(w => w.level === 'full'), teacher = writers.find(w => w.level === 'scoped');
    assert.ok(full && teacher, 'a full-access writer and a scoped teacher');
    const go = (name, args, who = full) => run(sql, name, { module: MOD, actor: who.id ?? who, args });
    assert.equal((await sql`select count(*)::int n from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT}`)[0].n, 0, 'no other reservation of the test student');
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date in (${ABS}, ${MK1}, ${MK2})`;
    const audits = action => sql`select actor_id::text actor_id, target_label, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'studentId'=${STUDENT} and metadata->>'via'='3.0 연습 복사본'`;
    const absRows = () => sql`select status::text status, note, session_units::float8 units, recorded_by::text recorded_by from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${ABS}`;
    const resvRows = () => sql`select id::text id, class_id::text class_id, absence_class_id::text absence_class_id, absence_date::text absence_date, makeup_date::text makeup_date,
      left(slot_start::text, 5) s, left(slot_end::text, 5) e, period_label, note, status, created_by::text created_by, report_mode from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT} order by makeup_date`;

    // ① 교시 선택지 — 평일 = 그 과목 평일 교시표(수학은 학원 설정 평일 교시표 그대로) · 기록할 반 후보 = 그날 다니는 같은 과목의 열린 반(결석난 반 먼저) · 쓰지 않는다.
    const auditsBefore = (await sql`select count(*)::int n from public.audit_logs`)[0].n;
    const opt = await go('getMakeupPeriodOptions', [CLASS, MK1, STUDENT, null]);
    const [{ wd }] = await sql`select data->'operations'->'weekdayPeriods' wd from public.tenant_settings where tenant_id=${t}`;
    assert.equal(opt.ok, true);
    assert.deepEqual(opt.options.map(o => [o.startTime, o.endTime]), wd.map(p => [p.startTime, p.endTime]), 'weekday options = the academy weekday period table');
    assert.deepEqual([opt.subjectLabel, opt.weekend, opt.autoUnits], [settings.operations.subjects.find(s => s.key === 'math')?.label, false, true]);
    const hosts = await sql`select c.id::text id, c.class_name from public.classes c where c.tenant_id=${t} and c.subject='math' and coalesce(c.is_active, true) and (c.closed_at is null or c.closed_at>=${MK1})
      and c.id in (select class_id from public.enrollments where student_id=${STUDENT} and (start_date is null or start_date<=${MK1}) and (end_date is null or end_date>=${MK1}) and not coalesce(on_hold, false) and not coalesce(is_transferred, false))`;
    assert.deepEqual(opt.hostChoices.map(h => h.classId).sort(), hosts.map(h => h.id).sort(), 'host choices = independent SQL');
    assert.deepEqual([opt.hostChoices[0], opt.hostClassId, opt.regularDay], [{ classId: CLASS, className, absenceClass: true }, CLASS, true]);
    assert.deepEqual(await go('getMakeupPeriodOptions', [CLASS, '2026-13-1', STUDENT, null]), { error: '날짜를 고르세요' });
    assert.deepEqual(await go('getMakeupPeriodOptions', [STUDENT, MK1]), { error: '반을 찾지 못했습니다' });
    assert.equal((await sql`select count(*)::int n from public.audit_logs`)[0].n, auditsBefore, 'options write nothing');

    // ② 거절 — 2.0 문장 그대로, 바뀌는 것 없음.
    const base = { studentId: STUDENT, classId: CLASS, absenceDate: ABS, makeupDate: MK1, periodIds: [opt.options[2].id, opt.options[3].id], note: ' 교재 챙기기 ', reportMode: 'merge' };
    const [outsider] = await sql`select id::text id from public.users where tenant_id=${t} and status='active' and not (id::text = any(${writers.map(w => w.id)}::text[])) limit 1`;
    assert.deepEqual(await go('reserveMakeup', [base], outsider), { error: '출석 관리 권한이 없습니다' });
    assert.deepEqual(await go('reserveMakeup', [{ ...base, makeupDate: addDays(TODAY, -2) }]), { error: M.resv.validateReservationDates({ absenceDate: ABS, makeupDate: addDays(TODAY, -2), today: TODAY }).error });
    assert.deepEqual(await go('reserveMakeup', [{ ...base, periodIds: [] }]), { error: '교시를 고르세요 — 학원설정 교시표에 있는 시간만 예약할 수 있습니다' });
    assert.deepEqual(await go('reserveMakeup', [{ ...base, periodIds: [opt.options[1].id, opt.options[3].id] }]), { error: '이어진 교시만 한 예약으로 잡을 수 있습니다 — 중간이 빈 선택은 나눠서 예약하세요' });
    assert.deepEqual(await go('reserveMakeup', [{ ...base, reportMode: null }]), { error: '그날은 이 학생의 정규 수업일입니다 — 보고서를 정규와 합칠지(합침) 따로 보낼지(분리) 고르세요' });
    assert.deepEqual(await go('reserveMakeup', [{ ...base, hostClassId: STUDENT }]), { error: '기록할 반을 다시 골라 주세요 — 보강일에 이 학생이 다니는 같은 과목 반만 고를 수 있습니다' });
    assert.deepEqual(await go('reserveMakeup', [base], teacher), { error: '담당 반이 아닙니다' }, 'a teacher not teaching the class on the absence day');
    assert.deepEqual([(await resvRows()).length, (await absRows()).length], [0, 0]);

    // ③ 예약 — 결석일 칸에 기록이 없으면 출석부 칸 저장으로 결석(시수 기본) + '보강 예정' 메모 · 예약 행 · makeup_reserve(absence created).
    const range = M.resv.contiguousPeriodRange(opt.options, base.periodIds, MK1), memo1 = M.resv.reservationAbsenceMemo({ makeupDate: MK1, absenceDate: ABS });
    const r1 = await go('reserveMakeup', [base]);
    assert.deepEqual(Object.keys(r1).sort(), ['absence', 'id', 'ok', 'span']);
    assert.deepEqual([r1.ok, r1.absence, r1.span], [true, 'created', `${MK1} ${range.label} · ${range.startTime}~${range.endTime}`]);
    assert.deepEqual((await resvRows()).map(x => ({ ...x })), [{ id: r1.id, class_id: CLASS, absence_class_id: null, absence_date: ABS, makeup_date: MK1, s: range.startTime, e: range.endTime,
      period_label: range.label, note: '교재 챙기기', status: 'reserved', created_by: full.id, report_mode: 'merge' }]);
    assert.deepEqual((await absRows()).map(x => ({ ...x })), [{ status: 'absent', note: memo1, units: null, recorded_by: full.id }]);
    assert.ok((await audits('attendance_cell')).some(x => x.metadata.date === ABS && x.metadata.status === 'absent' && x.metadata.created === true), 'absence went through the cell save');
    let [log] = await audits('makeup_reserve');
    assert.deepEqual([log.actor_id, log.target_label], [full.id, `학원이 · ${className}`]);
    assert.deepEqual(Object.fromEntries(Object.entries(log.metadata).filter(([k]) => k !== 'via')), { reservationId: r1.id, studentId: STUDENT, classId: CLASS, absenceDate: ABS, makeupDate: MK1,
      slotStart: range.startTime, slotEnd: range.endTime, periodLabel: range.label, periodCount: range.count, absence: 'created', reportMode: 'merge', hasNote: true });
    // 같은 날 같은 교시 = 유니크가 막는다(2.0 문장) — 결석 칸·감사로그 그대로.
    assert.deepEqual(await go('reserveMakeup', [base]), { error: '같은 날 같은 교시에 이미 이 학생의 보강 예약이 있습니다' });
    assert.deepEqual([(await resvRows()).length, (await audits('makeup_reserve')).length, (await absRows())[0].note], [1, 1, memo1]);

    // ④ 같은 결석에 다른 보강일 — 이미 결석이라 그 칸 메모에 한 줄만(absence noted).
    const memo2 = M.resv.reservationAbsenceMemo({ makeupDate: MK2, absenceDate: ABS });
    const r2 = await go('reserveMakeup', [{ ...base, makeupDate: MK2, periodIds: [opt.options[2].id], note: null }]);
    assert.deepEqual([r2.ok, r2.absence], [true, 'noted']);
    assert.deepEqual((await absRows()).map(x => [x.status, x.note]), [['absent', `${memo1}\n${memo2}`]]);
    assert.ok(!('hasNote' in (await audits('makeup_reserve')).find(x => x.metadata.reservationId === r2.id).metadata));

    // ⑤ 취소 — 강사(담당 아님) 거절 · 이행된 예약 거절 · 둘째 취소 = 그 줄만 빼고 칸은 남김 · 첫째 취소 = 예약이 만든 맨 칸이라 칸째 지움.
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r2.id }], teacher), { error: '담당 반이 아닙니다' });
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: 'abc' }]), { error: '예약을 찾지 못했습니다(이미 취소됐을 수 있습니다)' });
    await sql`update public.makeup_reservations set status='done' where id=${r2.id}`;
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r2.id }]), { error: '이미 이행된 예약은 취소할 수 없습니다 — 보강일 출결을 고치세요' });
    await sql`update public.makeup_reservations set status='reserved' where id=${r2.id}`;
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r2.id }]), { ok: true });
    assert.deepEqual([(await resvRows()).map(x => x.id), (await absRows()).map(x => [x.status, x.note])], [[r1.id], [['absent', memo1]]]);
    [log] = (await audits('makeup_reserve_cancel')).filter(x => x.metadata.reservationId === r2.id);
    assert.deepEqual([log.actor_id, log.target_label, log.metadata.memoCleared, log.metadata.absenceCleared, log.metadata.makeupDate], [full.id, `학원이 · ${className}`, true, undefined, MK2]);
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r1.id }]), { ok: true });
    assert.deepEqual([(await resvRows()).length, (await absRows()).length], [0, 0], 'the bare absence the reservation made is erased');
    [log] = (await audits('makeup_reserve_cancel')).filter(x => x.metadata.reservationId === r1.id);
    assert.deepEqual([log.metadata.memoCleared, log.metadata.absenceCleared], [true, true]);
    assert.ok((await audits('attendance_clear')).some(x => x.metadata.date === ABS), 'erased through the cell save');
    // 사람이 적은 사유가 있는 결석은 칸을 지우지 않고 줄만 뺀다.
    const r3 = await go('reserveMakeup', [base]);
    await sql`update public.attendance_records set note=${`병결\n${memo1}`} where class_id=${CLASS} and student_id=${STUDENT} and session_date=${ABS}`;
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r3.id }]), { ok: true });
    assert.deepEqual((await absRows()).map(x => [x.status, x.note]), [['absent', '병결']]);

    // ⑥ 온 날(출석)엔 예약하지 않는다(2.0 문장).
    await run(sql, 'setAttendanceCell', call('setAttendanceCell', full.id, { studentId: STUDENT, classId: CLASS, sessionDate: ABS, status: 'present' }));
    assert.deepEqual(await go('reserveMakeup', [base]), { error: `${ABS}은(는) 이미 '${R.cell.statusTextOf('present')}'으로 기록된 날입니다 — 결석으로 고친 뒤 예약하세요` });
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${ABS}`;

    // ⑦ 반쪽 상태 금지 — 결석 칸을 못 쓰면(강사 · 7일 지난 날) 예약도 남지 않는다.
    const OLD = addDays(TODAY, -10);
    await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, teacher_id) values (${t}, ${CLASS}, ${dowOf(OLD)}, '22:00', '22:40', '2026-09-01', ${teacher.id})`;
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${OLD}`;
    const half = await go('reserveMakeup', [{ ...base, absenceDate: OLD }], teacher);
    assert.deepEqual(half, { error: `결석일(${OLD}) 칸을 처리하지 못해 예약을 취소했습니다 — ${R.edit.attendanceLockMessage(OLD, TODAY)}` });
    assert.deepEqual([(await resvRows()).length, (await sql`select count(*)::int n from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${OLD}`)[0].n], [0, 0]);
    assert.ok(!(await audits('makeup_reserve')).some(x => x.metadata.absenceDate === OLD), 'no reserve audit for the rolled-back reservation');

    // ⑧ 새 보강 체계(보강관리 켜짐)인 학원 — 연결 확인을 옮기지 않아 예약·취소를 저장하지 않는다(바뀌는 것 없음).
    //    보강관리 설정은 2.0 설정 명령만 바꿀 수 있어(트리거) 그 명령의 표식(makeup.ctx)을 이 트랜잭션에서만 잠깐 세운다.
    const r4 = await go('reserveMakeup', [base]);
    await sql`select set_config('makeup.ctx', pg_current_xact_id()::text, true)`;
    await sql`update public.tenant_settings set data = jsonb_set(coalesce(data, '{}'::jsonb), '{makeups}', ${sql.json({ mode: 'on', allowAdditional: false, pilotSubjects: ['math'] })}) where tenant_id=${t}`;
    await sql`select set_config('makeup.ctx', '', true)`;
    const nativeText = '새 보강관리를 쓰는 학원의 보강 예약은 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.';
    assert.deepEqual(await go('reserveMakeup', [{ ...base, makeupDate: MK2 }]), { error: nativeText });
    assert.deepEqual(await go('cancelMakeupReservation', [{ id: r4.id }]), { error: nativeText });
    assert.deepEqual((await resvRows()).map(x => x.id), [r4.id]);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.makeup_reservations) resv`;
  assert.deepEqual([after[0].audits, after[0].resv], [before[0].audits, before[0].resv], 'rolled back — the copy is unchanged');
});

test('범위 채우기: 입력은 2.0 인자 모양만 받고, 빗금 칸 옮기기는 아직 받지 않는다(바뀌는 것 없음)', () => {
  const v = (args, actor = CLASS, module = ACTIONS) => screen.actions.setAttendanceRange.validate({ module, actor, args });
  const cellsOf = (...xs) => xs.map(d => ({ studentId: STUDENT, classId: CLASS, sessionDate: d }));
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'present' }], 'x'), /저장하는 사람을 먼저 고르세요/);
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'present' }], CLASS, PREFS), /입력 값/);
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'present' }, {}]), /입력 값/);
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'gone' }]), /잘못된 상태/);
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'present', units: 1 }]), /입력 값/);
  assert.throws(() => v([{ cells: cellsOf('2026-10-26'), status: 'present', scopeClassIds: 'x' }]), /입력 값/);
  assert.throws(() => v([{ cells: [{ ...cellsOf('2026-10-26')[0], ghost: true }], status: 'present' }]), e => e.code === 'not_in_copy' && /아직 지원하지 않는 저장/.test(e.message));
  assert.deepEqual(v([{ cells: cellsOf('2026-10-26'), status: null, units: '', quiet: true }]).status, null);
});

test('저장(복사본, 되돌림): 범위 채우기·지우기 — 새 칸·덮어쓰기·상태만·지우기(이력 행까지) · 강사 게이트 · 강사 보기 자리 행 보존 · 예약 이행이 2.0과 같은 행·감사로그', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const LV = await import('./v2-attendance-live.mjs');
  const TODAY = await A.copyDay(), addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const dowOf = d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];
  const D1 = addDays(TODAY, -2), D2 = addDays(TODAY, -1);
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), writers = await LV.attendanceWritersOf(sql, t, R, settings);
    const [{ teacher_id: homeroom }] = await sql`select teacher_id from public.classes where id=${CLASS}`;
    const full = writers.find(w => w.level === 'full' && w.id === homeroom) ?? writers.find(w => w.level === 'full'), teacher = writers.find(w => w.level === 'scoped' && w.id !== homeroom);
    assert.ok(full && teacher);
    const range = (who, input) => run(sql, 'setAttendanceRange', { module: ACTIONS, actor: who.id ?? who, args: [input] });
    const cellsOf = (...ds) => ds.map(d => ({ studentId: STUDENT, classId: CLASS, sessionDate: d }));
    const rows = d => sql`select id::text id, status::text status, session_units::float8 units, slot_start::text slot, seat_label, recorded_by::text by, recorded_via via from public.attendance_records
      where class_id=${CLASS} and student_id=${STUDENT} and session_date=${d} order by slot_start nulls first, recorded_at desc`;
    const audits = action => sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'via'='3.0 연습 복사본' and metadata->'studentIds' ? ${STUDENT}`;
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date in (${D1}, ${D2})`;
    // 기대 자동 시수(독립 SQL) — 그날 그 반 수업 분 → 수학 ceil(분/60)/2, 1이면 저장은 null.
    const autoOf = async d => {
      const [{ m }] = await sql`select coalesce(sum(m), 0)::int m from (select start_time, max(extract(epoch from (end_time - start_time)) / 60) m from public.class_schedules
        where class_id=${CLASS} and day_of_week=${dowOf(d)} and slot_teacher_label is null and valid_from<=${d} and (valid_to is null or valid_to>=${d}) group by start_time) x`;
      const u = m > 0 ? Math.ceil(m / 60) / 2 : null; return u === 1 ? null : u;
    };
    const [a1, a2] = [await autoOf(D1), await autoOf(D2)];

    // 거절 — 저장하는 사람 · 대상 없음 · 한도(2.0 문장).
    const [outsider] = await sql`select id::text id from public.users where tenant_id=${t} and status='active' and not (id::text = any(${writers.map(w => w.id)}::text[])) limit 1`;
    assert.deepEqual(await range(outsider, { cells: cellsOf(D1), status: 'present' }), { error: '출석 관리 권한이 없습니다' });
    assert.deepEqual(await range(full, { cells: [{ studentId: 'x', classId: CLASS, sessionDate: D1 }], status: 'present' }), { error: '기록할 대상이 없습니다' });
    const many = Array.from({ length: 301 }, (_, i) => ({ studentId: STUDENT, classId: CLASS, sessionDate: addDays('2025-01-01', i) }));
    assert.deepEqual(await range(full, { cells: many, status: 'present' }), { error: '한 번에 300칸까지만 채울 수 있습니다 — 범위를 좁혀 주세요' });

    // ① 새 칸 채우기(숫자 안 침) — 칸마다 그날 한 행 · 수학 자동 시수 · 같은 칸 두 번은 한 번 · 응답 autoUnits = 저장값.
    const first = await range(full, { cells: [...cellsOf(D1, D2), ...cellsOf(D1)], status: 'present', quiet: true });
    assert.deepEqual(first, { ok: true, applied: 2, blocked: 0, autoUnits: [{ studentId: STUDENT, classId: CLASS, sessionDate: D1, units: a1 }, { studentId: STUDENT, classId: CLASS, sessionDate: D2, units: a2 }] });
    for (const [d, u] of [[D1, a1], [D2, a2]]) assert.deepEqual((await rows(d)).map(r => [r.status, r.units, r.slot, r.by, r.via]), [['present', u, null, full.id, 'teacher']], d);
    let [log] = await audits('attendance_range');
    assert.deepEqual([log.actor_id, log.metadata.classId, log.metadata.dates, log.metadata.status, log.metadata.count, log.metadata.created, log.metadata.blocked, log.metadata.backdated],
      [full.id, CLASS, [D1, D2].sort(), 'present', 2, 2, 0, true]);
    // ② 덮어쓰기 + 시수 1.5(그날 합계) — 기존 행을 고치고(행이 안 는다) 바뀐 칸 수·전후 합을 적는다.
    assert.deepEqual(await range(desk(writers, homeroom), { cells: cellsOf(D1, D2), status: 'late', units: '1.5' }), { ok: true, applied: 2, blocked: 0 });
    for (const d of [D1, D2]) assert.deepEqual((await rows(d)).map(r => [r.status, r.units, r.via]), [['late', 1.5, 'desk']], d);
    log = (await audits('attendance_range')).find(x => x.metadata.status === 'late');
    // 시수가 실제로 바뀐 칸만(이미 1.5였던 칸은 빠진다 — 2.0 unitsAuditFields).
    const changedPrev = [a1 ?? 1, a2 ?? 1].filter(u => u !== 1.5);
    assert.deepEqual([log.metadata.units, log.metadata.unitsChangedCells, log.metadata.prevUnits, log.metadata.nextUnits, log.metadata.created],
      changedPrev.length > 0 ? [1.5, changedPrev.length, changedPrev.reduce((s, u) => s + u, 0), 1.5 * changedPrev.length, 0] : [1.5, undefined, undefined, undefined, 0]);
    // ③ 상태만(숫자 안 침) — 시수는 그대로 · 응답은 칸의 실제 합계(결석 = 0 → null).
    assert.deepEqual(await range(full, { cells: cellsOf(D1, D2), status: 'absent' }), { ok: true, applied: 2, blocked: 0,
      autoUnits: [{ studentId: STUDENT, classId: CLASS, sessionDate: D1, units: null }, { studentId: STUDENT, classId: CLASS, sessionDate: D2, units: null }] });
    assert.deepEqual((await rows(D1)).map(r => [r.status, r.units]), [['absent', 1.5]]);
    assert.deepEqual((await range(full, { cells: cellsOf(D1), status: 'present' })).autoUnits, [{ studentId: STUDENT, classId: CLASS, sessionDate: D1, units: 1.5 }]);
    // ④ 지우기 — 그 칸의 모든 행(정정 이력 포함) · 지운 행 수를 적는다.
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by, recorded_at) values (${t}, ${CLASS}, ${STUDENT}, ${D1}, 'absent', ${full.id}, now() - interval '1 day')`;
    assert.deepEqual(await range(full, { cells: cellsOf(D1, D2), status: null }), { ok: true, applied: 2, blocked: 0 });
    assert.deepEqual([(await rows(D1)).length, (await rows(D2)).length], [0, 0]);
    [log] = await audits('attendance_range_clear');
    assert.deepEqual([log.metadata.count, log.metadata.rows, log.metadata.classIds, log.metadata.dates], [2, 3, [CLASS], [D1, D2].sort()]);

    // ⑤ 강사(담당 반만) — 그날 담당 반(담임 ∪ 그날 유효한 교시 담당 — 2.0도 요일은 안 본다)의 칸만 · 7일 지난 칸은 그 칸만 건너뜀 · 남의 출석부 보기 거절 · 전부 걸리면 사유.
    assert.deepEqual(await range(teacher, { cells: cellsOf(D1, D2), status: 'present' }), { error: '담당 반 수강생이 아니어서 기록할 수 없습니다' });
    const old = addDays(TODAY, -9);
    assert.deepEqual(await range(teacher, { cells: cellsOf(old), status: 'present' }), { error: R.edit.attendanceLockMessage(old, TODAY) });
    assert.deepEqual(await range(teacher, { cells: cellsOf(D2), status: 'present', scopeTeacherId: full.id }), { error: R.scopedSplit.SCOPE_INVALID_MESSAGE });
    await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, teacher_id) values (${t}, ${CLASS}, ${dowOf(D2)}, '22:00', '22:40', '2026-09-01', ${teacher.id})`;
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${old}`;
    const mixed = await range(teacher, { cells: cellsOf(old, D2), status: 'present' });
    assert.deepEqual([mixed.ok, mixed.applied, mixed.blocked], [true, 1, 1]);
    assert.deepEqual([(await rows(old)).length, (await rows(D2)).map(r => [r.status, r.by, r.via])], [0, [['present', teacher.id, 'teacher']]]);
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date in (${D1}, ${D2})`;

    // ⑥ 강사 전체 보기(scopeTeacherId) — 그 달에 이 반을 안 맡은 선생님이면 거절 · 자리(랩실) 행은 채우기·지우기 모두 안 건드린다.
    const [stranger] = await sql`select id::text id from public.users where tenant_id=${t} and system_role='teacher' and status='active' and id not in (select coalesce(teacher_id,'00000000-0000-0000-0000-000000000000') from public.classes where id=${CLASS})
      and id not in (select teacher_id from public.class_schedules where class_id=${CLASS} and teacher_id is not null) limit 1`;
    assert.deepEqual(await range(full, { cells: cellsOf(D1), status: 'present', scopeTeacherId: stranger.id }), { error: R.scopedSplit.SCOPE_NOT_TAUGHT_MESSAGE });
    await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, slot_teacher_label) values (${t}, ${CLASS}, ${dowOf(D1)}, '21:00', '21:40', '2026-09-01', 'LAB')`;
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_by, recorded_via) values (${t}, ${CLASS}, ${STUDENT}, ${D1}, '21:00', 'late', 'LAB', ${full.id}, 'seat')`;
    const scoped = await range(full, { cells: cellsOf(D1), status: 'present', scopeTeacherId: homeroom });
    assert.equal(scoped.ok, true);
    const seatRow = async () => (await rows(D1)).find(r => r.seat_label === 'LAB');
    assert.deepEqual([(await seatRow()).status, (await seatRow()).via], ['late', 'seat'], 'the lab row keeps its status');
    assert.ok((await rows(D1)).some(r => r.seat_label === null && r.status === 'present'), 'the teacher gets an own row');
    assert.deepEqual(await range(full, { cells: cellsOf(D1), status: null, scopeTeacherId: homeroom }), { ok: true, applied: 1, blocked: 0 });
    assert.deepEqual((await rows(D1)).map(r => [r.seat_label, r.status]), [['LAB', 'late']], 'clearing in a teacher view leaves the lab row');
    log = (await audits('attendance_range_clear')).find(x => x.metadata.scopeTeacherId === homeroom);
    assert.equal(log.metadata.skippedSeatRows, 1);
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date in (${D1}, ${D2})`;

    // ⑦ 보강 예약 — 범위로 찍으면 이행, 범위로 지우면 되돌림(2.0 completeMakeupReservations).
    const [resv] = await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status)
      values (${t}, ${STUDENT}, ${CLASS}, ${addDays(TODAY, -6)}, ${D2}, '16:20', '17:15', 'reserved') returning id::text id`;
    const resvStatus = async () => (await sql`select status from public.makeup_reservations where id=${resv.id}`)[0].status;
    await range(full, { cells: cellsOf(D2), status: 'present' });
    assert.equal(await resvStatus(), 'done');
    await range(full, { cells: cellsOf(D2), status: null });
    assert.equal(await resvStatus(), 'reserved');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
});
/** 담임이 아닌 출결 전체 권한 직원(쓰는 문 'desk'). */
const desk = (writers, homeroom) => writers.find(w => w.level === 'full' && w.id !== homeroom && w.role !== 'master') ?? writers.find(w => w.level === 'full' && w.id !== homeroom);

test('저장(복사본, 되돌림): 허브 학생 검색 · 결석 통보 접수 — 독립 SQL과 같은 결과 · 새 결석/건너뜀/메모만 · 두 번 해도 한 번 · 데스크 큐 처리 · 담당 강사 벨(행까지) · 바깥 요청 0', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.notifications) bells`;
  const LV = await import('./v2-attendance-live.mjs'), I = await (await import('./v2-attendance-intake.mjs')).loadIntakeRules(importV2);
  const HUB = 'features/attendance/server/hub-search-actions.ts', INTAKE = 'features/attendance/intake/server/actions.ts';
  const TODAY = await A.copyDay(), addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), writers = await LV.attendanceWritersOf(sql, t, R, settings);
    const [{ teacher_id: homeroom, class_name: className }] = await sql`select teacher_id, class_name from public.classes where id=${CLASS}`;
    const desk = writers.find(w => w.level === 'full' && w.id !== homeroom), teacher = writers.find(w => w.level === 'scoped');
    assert.ok(desk && teacher);
    const ask = (name, module, actor, ...args) => run(sql, name, { module, actor: actor?.id ?? null, args });

    // ① 허브 검색 — 그 달 기준일에 수강 중인 반(보는 사람이 볼 수 있는 반) · 이름 부분 일치. 독립 SQL과 같은 (학생·반).
    const month = TODAY.slice(0, 7), range = R.date.monthRange(month), asOf = R.hubSearch.hubEnrollmentAsOf(TODAY, range.from, range.to);
    const hub = await ask('searchAttendanceHubStudents', HUB, desk, { query: '학원이', month });
    const want = await sql`select e.student_id::text s, e.class_id::text c from public.enrollments e join public.students st on st.id=e.student_id join public.classes c on c.id=e.class_id
      where e.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at>=${range.from}) and not e.on_hold and e.start_date<=${asOf} and (e.end_date is null or e.end_date>=${asOf}) and st.name ilike '%학원이%'`;
    assert.deepEqual(hub.hits.map(h => `${h.studentId}|${h.classId}`).sort(), want.map(r => `${r.s}|${r.c}`).sort());
    assert.ok(hub.hits.some(h => h.studentId === STUDENT && h.classId === CLASS && h.className === className));
    assert.deepEqual([hub.limit, hub.truncated, typeof hub.where], [R.hubSearch.HUB_SEARCH_LIMIT, false, 'string']);
    const nobody = await ask('searchAttendanceHubStudents', HUB, null, { query: '학원이', month });
    assert.deepEqual([nobody.hits, nobody.where], [[], R.i18n.sheetTf('ko', 'att.search.scope.plain', { month: R.i18n.sheetMonthLabel(month, `${Number(month.slice(5, 7))}월`, 'ko') })]);

    // ② 접수 학생 검색 — 재원 + 살아 있는 수강(독립 SQL) · 사무실만 · 비면 사유 한 줄.
    const found = await ask('searchIntakeStudents', INTAKE, desk, '학원이');
    const live = await sql`select st.id::text id from public.students st where st.tenant_id=${t} and st.status='enrolled' and st.name ilike '%학원이%'
      and exists (select 1 from public.enrollments e where e.student_id=st.id and not e.on_hold and (e.end_date is null or e.end_date>=${TODAY}))`;
    assert.deepEqual(found.students.map(s => s.id).sort(), live.map(r => r.id).sort());
    assert.deepEqual(await ask('searchIntakeStudents', INTAKE, teacher, '학원이'), { students: [], note: null, truncated: false });
    assert.deepEqual((await ask('searchIntakeStudents', INTAKE, desk, '없는이름가나다')).note, I.intake.intakeSearchEmptyMessage('없는이름가나다', 'no_match'));

    // ③ 미리보기 — 사무실만 · 그 기간 이 반 칸(수학 = 그날 한 칸).
    const D1 = addDays(TODAY, 1), D3 = addDays(TODAY, 3), D2 = addDays(TODAY, 2);
    await sql`delete from public.attendance_records where student_id=${STUDENT} and session_date between ${D1} and ${D3}`;
    assert.deepEqual(await ask('previewAbsenceIntake', INTAKE, teacher, { studentId: STUDENT, from: D1, to: D3 }), { student: null, cells: [], error: '결석 접수 권한이 없습니다' });
    const pv = await ask('previewAbsenceIntake', INTAKE, desk, { studentId: STUDENT, from: D1, to: D3 });
    const mine = pv.cells.filter(c => c.classId === CLASS);
    assert.deepEqual([pv.error, pv.student.id, mine.map(c => c.date)], [null, STUDENT, [D1, D2, D3].filter(d => !(d in R.cal.buildHolidayMap(settings.operations.holidays)))]);
    assert.ok(mine.every(c => c.saveSlot === null && c.existing === null && c.key === I.intake.cellKey(c)));
    // ④ 접수 — D1 빈 칸 = 결석 + 사유 · D2 출석 = 건너뜀 · D3 결석 = 메모만. 다른 반 칸은 화면에서 뺐다(exclude).
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${D2}, 'present', ${homeroom})`;
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, note, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${D3}, 'absent', '병결', ${homeroom})`;
    const exclude = pv.cells.filter(c => c.classId !== CLASS).map(c => c.key), memo = I.intake.intakeMemo('감기');
    const rec = await ask('recordAbsenceIntake', INTAKE, desk, { studentId: STUDENT, from: D1, to: D3, reason: ' 감기 ', exclude });
    assert.deepEqual(rec, { ok: true, saved: 1, noted: 1, skipped: [{ className, date: D2, statusLabel: I.intake.attendanceStatusLabel('present') }], failed: [], queueMarkFailed: false });
    const day = d => sql`select status::text status, note, recorded_by::text by from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${d}`;
    assert.deepEqual((await day(D1)).map(r => ({ ...r })), [{ status: 'absent', note: memo, by: desk.id }]);
    assert.deepEqual((await day(D2)).map(r => r.status), ['present']);
    assert.deepEqual((await day(D3)).map(r => [r.status, r.note]), [['absent', `병결\n${memo}`]]);
    const fus = await sql`select session_date::text d, state, outcome, contacted_via, handled_by::text by from public.attendance_followups where tenant_id=${t} and student_id=${STUDENT} and session_date between ${D1} and ${D3} order by 1`;
    assert.deepEqual(fus.map(r => ({ ...r })), [D1, D3].map(d => ({ d, state: 'resolved', outcome: 'absent_today', contacted_via: 'phone', by: desk.id })));
    const bells = () => sql`select recipient_id::text r, title, link, actor_id::text a from public.notifications where tenant_id=${t} and type='attendance_absence_intake' and created_at >= now() - interval '1 minute'`;
    const b1 = await bells();
    assert.ok(b1.length > 0 && b1.every(b => b.a === desk.id && b.r !== desk.id && b.title.includes('학원이')), 'bells to the class teachers, not to the desk');
    assert.ok(b1.some(b => b.r === homeroom), 'the homeroom teacher hears it');
    // ⑤ 같은 접수를 다시 — 이미 메모가 있는 칸은 그대로 · 벨은 한 번(같은 접수 bucket).
    const again = await ask('recordAbsenceIntake', INTAKE, desk, { studentId: STUDENT, from: D1, to: D3, reason: '감기', exclude });
    assert.deepEqual([again.saved, again.noted, again.skipped.length, again.failed.length], [0, 0, 1, 0]);
    assert.deepEqual([(await day(D1)).map(r => r.note), (await day(D3)).map(r => r.note), (await bells()).length], [[memo], [`병결\n${memo}`], b1.length]);
    assert.deepEqual(await ask('recordAbsenceIntake', INTAKE, teacher, { studentId: STUDENT, from: D1, to: D3, reason: '감기' }), { error: '결석 접수 권한이 없습니다' });
    assert.deepEqual(await ask('recordAbsenceIntake', INTAKE, desk, { studentId: STUDENT, from: D1, to: D3, reason: '  ' }), { error: '사유를 입력해 주세요 — 이 문장이 출석부 메모가 됩니다' });
    // 바깥으로 나가는 요청 0(벨은 행까지만).
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.notifications) bells`;
  assert.deepEqual([after[0].audits, after[0].bells], [before[0].audits, before[0].bells], 'rolled back — the copy is unchanged');
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
  for (const v of ['/attendance/seat/lab/print', '/attendance/livex', '/attendance/live/x', '/attendance/seat/lab/month/x', '/timetable', '/attendance/seat/LAB']) assert.ok(!ok('v2path', v), v);
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
    // 보강 예약이 걸린 칸 — 2.0처럼 쓰고 나서 예약 이행(자리 새 행 · 일괄). 자리 칸 지우기는 2.0도 이행을 다시 보지 않는다(그대로 done).
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status) values (${t}, ${STUDENT}, ${CLASS}, '2026-10-20', ${TODAY}, '22:00', '22:40', 'reserved')`;
    const seatResv = async () => (await sql`select status, attendance_record_id::text rec from public.makeup_reservations where tenant_id=${t} and student_id=${STUDENT} and makeup_date=${TODAY}`)[0];
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'present' }), { ok: true, changed: 1 });
    let [lab] = await sql`select id::text id, note from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY} and slot_start=${SLOT}`;
    assert.deepEqual(await seatResv(), { status: 'done', rec: lab.id }); assert.match(lab.note ?? '', /결석분 보강/);
    await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: null });
    assert.equal((await seatResv()).status, 'done', '2.0 seat clear does not re-check the reservation');
    await sql`update public.makeup_reservations set status='reserved', attendance_record_id=null, done_at=null where tenant_id=${t} and student_id=${STUDENT} and makeup_date=${TODAY}`;
    assert.deepEqual(await act('fillSeatSlot', SEAT_ACTIONS_MOD, { seat: 'lab', date: TODAY, slotStart: SLOT, status: 'present' }), { ok: true, changed: 1 });
    [lab] = await sql`select id::text id from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY} and slot_start=${SLOT}`;
    assert.deepEqual(await seatResv(), { status: 'done', rec: lab.id }, 'fill completes the reservation too');
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    // 새 보강 체계(보강관리 켜짐)인 학원 — 그 연결 갈래가 없어 보강 예약 칸은 쓰지 않는다(칸 · 일괄, 바뀌는 것 없음).
    // 보강관리 설정은 2.0 설정 명령만 바꿀 수 있어(트리거) 그 명령의 표식(makeup.ctx)을 이 트랜잭션에서만 잠깐 세운다.
    await sql`update public.makeup_reservations set status='reserved', attendance_record_id=null, done_at=null where tenant_id=${t} and student_id=${STUDENT} and makeup_date=${TODAY}`;
    const setMakeupMode = async mode => {
      await sql`select set_config('makeup.ctx', pg_current_xact_id()::text, true)`;
      await sql`update public.tenant_settings set data = jsonb_set(coalesce(data, '{}'::jsonb), '{makeups}', ${sql.json({ mode, allowAdditional: false, pilotSubjects: ['math'] })}) where tenant_id=${t}`;
      await sql`select set_config('makeup.ctx', '', true)`;
    };
    await setMakeupMode('on');
    const seatRefusal = { error: '보강 예약이 걸린 칸은 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.' };
    assert.deepEqual(await act('setSeatCell', SEAT_ACTIONS_MOD, { ...cellOf('lab'), status: 'present' }), seatRefusal);
    assert.deepEqual(await act('fillSeatSlot', SEAT_ACTIONS_MOD, { seat: 'lab', date: TODAY, slotStart: SLOT, status: 'present' }), seatRefusal);
    assert.deepEqual([(await rows()).length, (await seatResv()).status], [0, 'reserved']);
    await setMakeupMode('off');
    // 바깥 연동(인재원 단어수)은 부르지 않는다 · 월간 접기 = 그 사람 ui_prefs.seatMonthly.
    assert.match((await run(sql, 'pullSeatMemorizedWords', { module: 'features/attendance/seat/server/memorized-actions.ts', actor: writer.id, args: [{ seat: 'jj', date: TODAY }] })).error, /인재원 단어수 가져오기는 연습 화면에서 부르지 않습니다/);
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

// ── 출결 모드(/attendance/quick) = 2.0 quick/page.tsx — getLiveBoard(오늘, selfOnly) · 학생 연락처 지움 · 휴원일이면 읽기 전용 패널 ──
const quickLoad = async (sql, viewer) => screen.load({ sql, params: { v2path: '/attendance/quick', ...(viewer ? { viewer } : {}) }, tenantId: (await import('./full-db.mjs')).tenantId, importV2 });
test('출결 모드: 호스트 조립이 2.0 quick/page.tsx와 같은 부품·같은 문구 키를 쓴다', async () => {
  const page = await src('app/(shell)/attendance/quick/page.tsx'), host = await here('v2-host/src/attendance-quick-page.tsx');
  for (const c of ['PageHeader', 'Button', 'EmbedLink', 'EmptyState', 'HolidayActivityPanel', 'QuickBoard']) {
    assert.match(page, new RegExp(`<${c}\\b`), `page.tsx draws ${c}`); assert.match(host, new RegExp(`<${c}\\b`), `host draws ${c}`);
  }
  const keys = [...new Set(page.match(/"quick\.[a-z.]+"/g))];
  assert.ok(keys.length >= 8);
  for (const key of keys) assert.ok(host.includes(key.replace(/"/g, "'")), `host uses ${key}`);
  assert.match(host, /<QuickBoard date=\{today\} classes=\{data\.classes\} canEdit=\{data\.canEdit\} \/>/);
  assert.doesNotMatch(host, /<table|<td\b|className="at-/, 'no hand-drawn board');
  assert.ok(screen.params.v2path.test('/attendance/quick') && !screen.params.v2path.test('/attendance/quick/x') && !screen.params.v2path.test('/attendance/quickx'));
});

test('복사본: 출결 모드 — 강사 본인 반만 · 반 카드 명단이 독립 SQL과 같다 · 학생 연락처 없음 · 자리 교시 빠짐', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const TODAY = await A.copyDay(), dow = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()];
  await db.begin('isolation level repeatable read read only', async sql => {
    // 오늘 정규 교시가 가장 많은 강사 둘(수학 하나 · 영어 하나).
    for (const subject of ['math', 'english']) {
      const [x] = await sql`select c.teacher_id::text id from public.classes c join public.class_schedules s on s.class_id=c.id where c.tenant_id=${t} and c.is_active and c.subject=${subject}
        and c.teacher_id is not null and s.day_of_week::text=${dow} and s.valid_from<=${TODAY} and (s.valid_to is null or s.valid_to>=${TODAY}) group by 1 order by count(*) desc, 1 limit 1`;
      const d = await quickLoad(sql, x.id);
      assert.deepEqual([d.page, d.view, d.date, d.viewer, d.lang], ['quick', 'board', TODAY, x.id, 'ko']);
      assert.ok(d.editors.some(e => e.id === x.id), 'teachers (scoped) are editors here');
      // 독립 SQL — 그 강사의 반(담임 · 그날 교시 담당 · 그날 위임) 중 오늘 자리 아닌 교시가 있는 반의 오늘 재원생.
      const slots = await sql`select s.class_id::text class_id, s.slot_teacher_label from public.class_schedules s join public.classes c on c.id=s.class_id
        where c.tenant_id=${t} and c.is_active and (c.closed_at is null or c.closed_at>=${TODAY}) and s.day_of_week::text=${dow} and s.valid_from<=${TODAY} and (s.valid_to is null or s.valid_to>=${TODAY})
          and (c.teacher_id=${x.id} or exists (select 1 from public.class_schedules s2 where s2.class_id=c.id and s2.teacher_id=${x.id} and s2.valid_from<=${TODAY} and (s2.valid_to is null or s2.valid_to>=${TODAY}))
            or exists (select 1 from public.class_delegations dl where dl.class_id=c.id and dl.delegate_user_id=${x.id} and dl.revoked_at is null and dl.from_date<=${TODAY} and dl.to_date>=${TODAY}))`;
      const regular = [...new Set(slots.filter(s => !R.tlabel.specialSlotLabel(s.slot_teacher_label)).map(s => s.class_id))];
      const pairs = regular.length ? await sql`select distinct e.class_id::text c, e.student_id::text s from public.enrollments e where e.class_id = any(${regular}::uuid[])
        and not e.on_hold and e.start_date<=${TODAY} and (e.end_date is null or e.end_date>${TODAY} or (e.end_date=${TODAY} and not coalesce(e.is_transferred,false)))
        and (e.attendance_days is null or cardinality(e.attendance_days)=0 or ${dow}=any(e.attendance_days::text[]))` : [];
      const mine = d.classes.flatMap(c => c.students.filter(s => !s.reservedMakeup && !s.splitMark).map(s => `${c.classId}|${s.studentId}`)).sort();
      assert.deepEqual([...new Set(mine)], [...new Set(pairs.map(p => `${p.c}|${p.s}`))].sort(), `${subject}: roster = enrollments active today`);
      assert.ok(d.classes.length > 0 && d.classes.every(c => !c.seatLabel), 'seat periods (LAB·JJ) are not in 출결 모드');
      assert.ok(d.classes.every(c => c.students.every(s => s.parentPhone === null && s.studentPhone === null)), 'phones stripped');
      assert.equal(d.canEdit, true);
      assert.doesNotMatch(JSON.stringify(d), /hourly_rate|monthly_base|\d{6}-[1-4]\d{6}/);
    }
    // 담당 수업이 없는 사람 = 빈 보드(2.0 EmptyState) · 강사 홈은 원스크린.
    const owner = (await quickLoad(sql)).editors[0];
    const o = await quickLoad(sql, owner.id);
    assert.deepEqual([o.view, o.classes.length, o.homeHref], ['board', 0, '/onescreen']);
  });
});

test('복사본(되돌림): 출결 모드 — 휴원일이면 명단 없이 그날 입력(내 반만)을 읽기 전용으로', { skip: !db && 'local database not running' }, async () => {
  const TODAY = await A.copyDay();
  await inRollback(async ({ sql, t }) => {
    await sql`update public.tenant_settings set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('operations', coalesce(data->'operations', '{}'::jsonb)
      || jsonb_build_object('holidays', coalesce(data->'operations'->'holidays', '[]'::jsonb) || ${sql.json([{ date: TODAY, name: '시험 휴원일' }])})) where tenant_id=${t}`;
    const [x] = await sql`select teacher_id::text id from public.classes where tenant_id=${t} and id=${CLASS}`;
    const d = await quickLoad(sql, x.id);
    assert.deepEqual([d.view, d.holiday, 'classes' in d], ['holiday', '시험 휴원일', false]);
    assert.equal(d.activity.officeScope, false, 'selfOnly — 내 반만');
    assert.ok(Array.isArray(d.activity.rows) && d.activity.date === TODAY);
  });
});

// ── 출결 모드 저장 = 2.0 setAttendanceCell(교시 지정 · source 'live' · 강사 게이트 · 데스크 게이트) + setAttendanceBulk ──
const ACT = 'features/attendance/server/actions.ts';
test('저장: 교시 지정·당일 출결 입력은 받고, 일괄 입력은 정해진 모양만 받는다', () => {
  const v = (name, input) => screen.actions[name].validate({ module: ACT, actor: CLASS, args: [input] });
  const c = { studentId: STUDENT, classId: CLASS, sessionDate: '2026-10-27', status: 'present' };
  const got = v('setAttendanceCell', { ...c, slotStart: '22:00', periodStart: '22:00', source: 'live' });
  assert.deepEqual([got.slotStart, got.periodStart, got.source], ['22:00', '22:00', 'live']);
  assert.equal(v('setAttendanceCell', c).slotStart, null);
  for (const bad of [{ slotStart: '2200' }, { periodStart: 9 }, { source: 'daily' }]) assert.throws(() => v('setAttendanceCell', { ...c, ...bad }), /입력 값/, JSON.stringify(bad));
  const bulk = { sessionDate: '2026-10-27', status: 'present', cells: [{ studentId: STUDENT, classId: CLASS }], fillEmptyOnly: true, slotStart: '22:00', source: 'live' };
  assert.deepEqual(v('setAttendanceBulk', bulk).cells, [{ studentId: STUDENT, classId: CLASS }]);
  for (const bad of [{ status: 'excused' }, { cells: [{ studentId: 'x', classId: CLASS }] }, { cells: 'x' }, { fillEmptyOnly: 'yes' }, { slotStart: '9' }, { source: 'daily' }, { sessionDate: '2026-10' }])
    assert.throws(() => v('setAttendanceBulk', { ...bulk, ...bad }), /입력 값|잘못된 상태/, JSON.stringify(bad));
});

test('저장(복사본, 되돌림): 출결 모드 — 교시 칸 쓰기·덮어쓰기·메모·지우기·승격, 강사 게이트, 데스크 게이트, 일괄(빈 칸만)이 2.0과 같은 행·감사로그', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const TODAY = await A.copyDay(), DOW = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()], SLOT = '22:00', CLASS2 = '50d2ece7-6514-4474-8cfc-dd8983d15c18';
  const L = await (await import('./v2-attendance-live.mjs')).loadLiveRules(importV2);
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), writers = await (await import('./v2-attendance-live.mjs')).attendanceWritersOf(sql, t, R, settings);
    const teacher = writers.find(w => w.level === 'scoped'), desk = writers.find(w => w.level === 'full' && w.role !== 'master');
    assert.ok(teacher && desk, 'a scoped teacher and a full-access desk member');
    // 그 강사를 테스트 반의 오늘 22:00 교시 담당으로(되돌리는 거래 안) — 담당 반 = 교시 담당(2.0 userTaughtClassSet).
    await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, teacher_id) values (${t}, ${CLASS}, ${DOW}, ${SLOT}, '22:40', '2026-10-01', ${teacher.id})`;
    await sql`delete from public.attendance_records where class_id = any(${[CLASS, CLASS2]}::uuid[]) and session_date=${TODAY}`;
    const cellAs = (actor, input) => run(sql, 'setAttendanceCell', { module: ACT, actor: actor.id, args: [{ studentId: STUDENT, classId: CLASS, sessionDate: TODAY, ...input }] });
    const live = { slotStart: SLOT, periodStart: SLOT, source: 'live' };
    const rows = () => sql`select status::text status, slot_start::text slot_start, recorded_via, recorded_by::text recorded_by, note from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY} order by slot_start nulls first`;
    const audits = action => sql`select metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'via'='3.0 연습 복사본' and metadata->>'date'=${TODAY}`;
    const refused = async p => { try { await p; return null; } catch (e) { return e.message; } };
    // 강사(담당 반만) — 교시 칸 새로 쓰기 → 그 교시 한 행 · 입력자 = 강사 · recorded_via teacher.
    // 새 칸 + 시수를 안 고른 저장 = 2.0도 실제 넣은 시수(autoUnits — 수학 자동 시수, 못 찾으면 null)를 돌려준다.
    const first = await cellAs(teacher, { status: 'present', ...live });
    assert.deepEqual(Object.keys(first).sort(), ['autoUnits', 'ok']); assert.equal(first.ok, true);
    assert.deepEqual((await rows()).map(r => ({ ...r })), [{ status: 'present', slot_start: '22:00:00', recorded_via: 'teacher', recorded_by: teacher.id, note: null }]);
    assert.equal((await sql`select session_units::float8 u from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`)[0].u, first.autoUnits);
    let [a] = await audits('attendance_cell');
    assert.deepEqual([a.metadata.slotStart, a.metadata.created, a.metadata.source, a.metadata.status], [SLOT, true, 'live', 'present']);
    // 덮어쓰기(같은 교시) · 메모만(그 교시 최신 행) · 지우기(그 교시만).
    await cellAs(teacher, { status: 'late', note: '버스', ...live });
    assert.deepEqual((await rows()).map(r => [r.status, r.note]), [['late', '버스']]);
    assert.ok((await audits('attendance_cell')).some(x => x.metadata.overwrote === true && x.metadata.prevStatus === 'present'));
    await cellAs(teacher, { status: null, note: '버스 늦음', noteOnly: true, slotStart: SLOT });
    assert.deepEqual((await rows()).map(r => [r.status, r.note]), [['late', '버스 늦음']]);
    [a] = await audits('attendance_note'); assert.deepEqual([a.metadata.slotStart, a.metadata.cleared], [SLOT, false]); assert.ok(!JSON.stringify(a.metadata).includes('버스'));
    await cellAs(teacher, { status: null, ...live });
    assert.equal((await rows()).length, 0);
    [a] = await audits('attendance_clear'); assert.deepEqual([a.metadata.slotStart, a.metadata.source], [SLOT, 'live']);
    // 승격 — 옛 '그날 전체' 행만 있으면 그 행을 이 교시로 옮겨 쓴다(행이 늘지 않는다 — 2.0 pickSaveTargets).
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, recorded_by) values (${t}, ${CLASS}, ${STUDENT}, ${TODAY}, null, 'present', ${desk.id})`;
    await cellAs(teacher, { status: 'absent', ...live });
    assert.deepEqual((await rows()).map(r => [r.status, r.slot_start]), [['absent', '22:00:00']]);
    // 강사 게이트 — 담당 아닌 반 · 7일 창 밖 · 수강생 아님(2.0 문구).
    assert.equal(await refused(run(sql, 'setAttendanceCell', { module: ACT, actor: teacher.id, args: [{ studentId: STUDENT, classId: CLASS2, sessionDate: TODAY, status: 'present', ...live }] })), '담당 반이 아닙니다');
    const old = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 9 * 86400000).toISOString().slice(0, 10);
    assert.equal(await refused(cellAs(teacher, { status: 'present', sessionDate: old, ...live })), R.edit.attendanceLockMessage(old, TODAY));
    const [other] = await sql`select id::text id from public.students where tenant_id=${t} and is_test and id <> ${STUDENT} and id not in (select student_id from public.enrollments where class_id=${CLASS}) limit 1`;
    assert.equal(await refused(run(sql, 'setAttendanceCell', { module: ACT, actor: teacher.id, args: [{ studentId: other.id, classId: CLASS, sessionDate: TODAY, status: 'present', ...live }] })), '이 반 수강생이 아닙니다');
    // 데스크 게이트 — 그 반을 안 가르치는 사람: 지우기 금지 · 이미 찍힌 칸 금지 · 시작 전 금지(복사본 시각 기준).
    assert.equal(await refused(cellAs(desk, { status: null, ...live })), L.mark.deskWriteDenied({ source: 'live', via: 'desk', currentStatus: 'present', nextStatus: null, phase: 'ended' }));
    assert.equal(await refused(cellAs(desk, { status: 'present', ...live })), L.mark.deskMarkDeniedReason('absent', 'ended'));
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    assert.match(await refused(cellAs(desk, { status: 'present', ...live })), /아직 수업 시작 전입니다/);
    // 일괄(빈 칸만) — 강사: 새로 쓴 칸만 applied · 두 번째는 0 · 담당 아닌 반 칸은 blocked.
    const bulkAs = (actor, cells) => run(sql, 'setAttendanceBulk', { module: ACT, actor: actor.id, args: [{ sessionDate: TODAY, status: 'present', cells, fillEmptyOnly: true, slotStart: SLOT, periodStart: SLOT, source: 'live' }] });
    const [stu2] = await sql`select student_id::text id from public.enrollments where class_id=${CLASS2} limit 1`;
    const res = await bulkAs(teacher, [{ studentId: STUDENT, classId: CLASS }, { studentId: stu2.id, classId: CLASS2 }]);
    assert.deepEqual(res, { ok: true, applied: [{ studentId: STUDENT, classId: CLASS, created: true }], blocked: 1 });
    assert.deepEqual((await rows()).map(r => [r.status, r.slot_start, r.recorded_via]), [['present', '22:00:00', 'teacher']]);
    [a] = await audits('attendance_bulk');
    assert.deepEqual([a.metadata.count, a.metadata.created, a.metadata.blocked, a.metadata.slotStart, a.metadata.fillEmptyOnly, a.metadata.source, a.metadata.classId], [1, 1, 1, SLOT, true, 'live', CLASS]);
    assert.deepEqual(await bulkAs(teacher, [{ studentId: STUDENT, classId: CLASS }]), { ok: true, applied: [], blocked: 1 });
    // 보강 예약이 걸린 칸 — 교시 칸·일괄 모두 쓰고 나서 예약 이행(2.0과 같다 — 교시 행은 예약 구간 안이면 이행한다).
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    const [qr] = await sql`insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status)
      values (${t}, ${STUDENT}, ${CLASS}, '2026-10-20', ${TODAY}, ${SLOT}, '22:40', 'reserved') returning id::text id`;
    const qStatus = async () => (await sql`select status from public.makeup_reservations where id=${qr.id}`)[0].status;
    assert.equal((await cellAs(teacher, { status: 'present', ...live })).ok, true);
    assert.equal(await qStatus(), 'done');
    await cellAs(teacher, { status: 'absent', ...live });
    assert.equal(await qStatus(), 'reserved', 'absent on the makeup day reverts');
    await sql`delete from public.attendance_records where class_id=${CLASS} and student_id=${STUDENT} and session_date=${TODAY}`;
    assert.equal((await bulkAs(teacher, [{ studentId: STUDENT, classId: CLASS }])).applied.length, 1);
    assert.equal(await qStatus(), 'done', 'bulk completes it');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
});

// ── 오늘 출결(/attendance/live) = 2.0 live/page.tsx — 좌석표 · 확인 필요(데스크 큐) · 어제 출결(요약) ──
const liveLoad = async (sql, params) => screen.load({ sql, params: { v2path: '/attendance/live', ...params }, tenantId: (await import('./full-db.mjs')).tenantId, importV2 });
test('오늘 출결: 호스트 조립이 2.0 live/page.tsx와 같은 부품을 그리고 TabLink는 원문 그대로다', async () => {
  const page = await src('app/(shell)/attendance/live/page.tsx'), host = await here('v2-host/src/attendance-live-page.tsx');
  for (const c of ['PageHeader', 'LiveDatePicker', 'AbsenceIntakeButton', 'EmptyState', 'HolidayActivityPanel', 'TabLink', 'RecapView', 'DeskView', 'SeatingChart', 'LiveRefresher']) {
    assert.match(page, new RegExp(`<${c}\\b`), `page.tsx draws ${c}`); assert.match(host, new RegExp(`<${c}\\b`), `host draws ${c}`);
  }
  assert.equal(strip(extract(host, 'TabLink')), strip(extract(page, 'TabLink')), 'TabLink body');
  for (const label of ['좌석표', '확인 필요', '어제 출결', '요약을 불러오지 못했습니다', '— 휴원일']) assert.ok(page.includes(label) && host.includes(label), label);
  const p = screen.params;
  assert.ok(p.v2path.test('/attendance/live') && p.tab.test('desk') && p.tab.test('recap') && !p.tab.test('x') && p.poll.test('live') && p.poll.test('recap') && !p.poll.test('y') && p.from.test('2026-10-24'));
  // 3.0 껍데기가 tab·from을 iframe으로 넘긴다(없으면 확인 필요·어제 출결 탭이 좌석표로 열린다).
  assert.match(await here('v2-screen-attendance.js'), /const KEEP = \[[^\]]*'tab', 'from'\]/);
});

test('복사본: 오늘 출결 — 데스크(전체 권한)는 세 탭 · 테스트 학생·연락처 없는 좌석표 · 큐는 신호 규칙대로 · 강사는 내 수업 좌석표만', { skip: !db && 'local database not running' }, async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const TODAY = await A.copyDay();
  const L = await (await import('./v2-attendance-live.mjs')).loadLiveRules(importV2);
  await db.begin('isolation level repeatable read read only', async sql => {
    const d = await liveLoad(sql, {});
    assert.deepEqual([d.page, d.date, d.today, d.tab, d.isDesk, d.scopedToSelf, d.holiday], ['live', TODAY, TODAY, 'seating', true, false, null]);
    const tests = new Set((await sql`select id::text id from public.students where tenant_id=${t} and is_test`).map(r => r.id));
    const cells = d.board.teachers.flatMap(x => x.slots.flatMap(s => s.students));
    assert.ok(cells.length > 100 && !cells.some(s => tests.has(s.studentId)), 'desk board excludes test students');
    assert.ok(d.board.teachers.every(x => x.teacherPhone === null) && cells.every(s => s.parentPhone === null && s.studentPhone === null), 'contacts stripped (page.tsx stripContacts)');
    assert.equal(d.board.totals.expected, cells.length);
    // 큐 — 시작 전·자리 교시 제외, 반 레인은 기록 없는 교시만, 학생 레인은 2.0 shouldQueueWithRequest를 지난 신호만(같은 보드에서 다시 센다).
    const slots = d.board.teachers.flatMap(x => x.slots).filter(s => s.phase !== 'before' && !R.tlabel.isSpecialSlotLabel(s.slotTeacherLabel));
    for (const c of d.queue.lanes.classes) assert.ok(slots.some(s => s.classId === c.classId && !s.hasAnyRecord), `${c.className} has no record`);
    assert.equal(d.queue.counts.classes + d.queue.counts.students + d.queue.counts.done >= d.queue.lanes.classes.length, true);
    const fu = (await sql`select count(*)::int n from public.attendance_followups where tenant_id=${t} and session_date=${TODAY}`)[0].n;
    assert.ok(d.queue.lanes.students.filter(s => s.followup).length <= fu, 'followups come from attendance_followups');
    // 강사(담당 반만)는 데스크가 아니다 — 좌석표만, 내 수업만, 테스트 학생도 그대로(2.0: 데스크 표면에서만 뺀다 — 여긴 selfOnly가 아니라 빠진다).
    const teacher = d.editors.find(e => e.role === '강사');
    const v = await liveLoad(sql, { viewer: teacher.id, tab: 'desk' });
    assert.deepEqual([v.isDesk, v.tab, v.queue, v.carryOver, v.scopedToSelf], [false, 'seating', null, null, true]);
    // 확인 필요 — 어제 남은 결석(조치 끝난·공결만 있는 학생 제외)이 독립 SQL과 같다.
    const desk = await liveLoad(sql, { tab: 'desk' });
    const prev = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const [x] = await sql`with eff as (select distinct on (student_id, class_id, coalesce(slot_start::text, '')) student_id, class_id, status::text status from public.attendance_records
        where tenant_id=${t} and session_date=${prev} order by student_id, class_id, coalesce(slot_start::text, ''), recorded_at desc, id desc),
      st as (select student_id, bool_or(status='absent') a, bool_and(status in ('absent','excused')) only_out from eff group by 1)
      select count(*)::int n from st where a and only_out and student_id not in (select student_id from public.attendance_followups where tenant_id=${t} and session_date=${prev} and state in ('resolved','dismissed'))`;
    assert.deepEqual(desk.carryOver, x.n > 0 ? { date: prev, count: x.n } : null);
    assert.equal(desk.tab, 'desk');
    // 어제 출결 — 기간(from~date)의 날마다 같은 보드 · 합계 = 그 날들 칸 수.
    const span = L.recapRange.recapDatesFor(TODAY);
    assert.equal(d.recapHref, `/attendance/live?tab=recap&from=${span[0]}&date=${span[span.length - 1]}`);
    const r = await liveLoad(sql, { tab: 'recap', from: span[0], date: span[span.length - 1] });
    assert.equal(r.recap.days.length, span.length);
    let expected = 0;
    for (const day of span) expected += (await liveLoad(sql, { date: day })).board?.totals.expected ?? 0;
    assert.equal(r.recap.totals.cells, expected, 'recap cells = the boards of those days');
    // 폴링 지문(2.0 getLiveRecordedCount) — 그날 기록 수 | 최근 입력 시각 | 최근 요청 시각.
    const poll = await liveLoad(sql, { poll: 'live', date: TODAY });
    const [{ n }] = await sql`select count(*)::int n from public.attendance_records where tenant_id=${t} and session_date=${TODAY}`;
    assert.equal(poll.page, 'poll'); assert.equal(poll.fingerprint.split('|')[0], String(n));
    assert.doesNotMatch(JSON.stringify([d, desk, r]), /hourly_rate|monthly_base/);
  });
});

test('복사본(되돌림): 오늘 출결 — 휴원일이면 좌석표·큐 없이 그날 입력(지점 전체)을 읽기 전용으로', { skip: !db && 'local database not running' }, async () => {
  const TODAY = await A.copyDay();
  await inRollback(async ({ sql, t }) => {
    await sql`update public.tenant_settings set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('operations', coalesce(data->'operations', '{}'::jsonb)
      || jsonb_build_object('holidays', coalesce(data->'operations'->'holidays', '[]'::jsonb) || ${sql.json([{ date: TODAY, name: '시험 휴원일' }])})) where tenant_id=${t}`;
    const d = await liveLoad(sql, {});
    assert.deepEqual([d.holiday, d.board, d.queue, d.holidayActivity.officeScope], ['시험 휴원일', null, null, true]);
  });
});

// ── 오늘 출결 저장 = 2.0 live/server/actions.ts(recordFollowup · requestAttendanceInput) · prefs-actions.ts(saveLiveSubjectFilter) ──
const LIVE_MOD = 'features/attendance/live/server/actions.ts', LIVE_PREFS_MOD = 'features/attendance/live/server/prefs-actions.ts';
test('저장: 오늘 출결 입력 검사는 복사본에 닿기 전에 거절한다', () => {
  const v = (name, module, input) => screen.actions[name].validate({ module, actor: CLASS, args: [input] });
  const f = { studentId: STUDENT, classId: CLASS, sessionDate: '2026-10-27', signal: 'absent', state: 'open' };
  assert.equal(v('recordFollowup', LIVE_MOD, f).input.state, 'open');
  for (const bad of [{ ...f, studentId: 'x' }, { ...f, note: 'x'.repeat(2001) }, { ...f, allowFuture: 'yes' }, 'x']) assert.throws(() => v('recordFollowup', LIVE_MOD, bad), /입력 값/);
  assert.throws(() => v('requestAttendanceInput', LIVE_MOD, { classId: 'x', sessionDate: '2026-10-27' }), /입력 값/);
  assert.throws(() => v('saveLiveSubjectFilter', LIVE_PREFS_MOD, 5), /입력 값/);
  assert.throws(() => v('recordFollowup', LIVE_PREFS_MOD, f), /입력 값/, 'another 2.0 module');
});

test('저장(복사본, 되돌림): 오늘 출결 — 확인 기록 upsert · 강사에게 출결 입력 요청(벨 행·한 번만) · 과목 필터가 2.0과 같은 행·감사로그', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  const TODAY = await A.copyDay(), DOW = R.cal.DOW_KEYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()], SLOT = '22:00';
  const Live = await import('./v2-attendance-live.mjs');
  await inRollback(async ({ sql, run, t }) => {
    const settings = await A.readSettings(sql, t, R), writers = await Live.attendanceWritersOf(sql, t, R, settings);
    const desk = writers.find(w => w.level === 'full' && w.role !== 'master'), teacher = writers.find(w => w.level === 'scoped');
    const act = (name, module, input, actor = desk) => run(sql, name, { module, actor: actor.id, args: [input] });
    const audits = action => sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${t} and action=${action} and metadata->>'via'='3.0 연습 복사본'`;
    // 확인 기록 — 같은 칸(학생·날짜·교시, 교시 없음 = 그날 전체) 두 번째는 갱신 · 매듭지으면 처리자·시각.
    const f = { studentId: STUDENT, classId: CLASS, sessionDate: TODAY, signal: 'absent' };
    await sql`delete from public.attendance_followups where student_id=${STUDENT} and session_date=${TODAY}`;
    const first = await act('recordFollowup', LIVE_MOD, { ...f, state: 'open', contactedVia: 'phone' });
    assert.equal(first.ok, true); assert.match(first.id, /^[0-9a-f-]{36}$/);
    await act('recordFollowup', LIVE_MOD, { ...f, state: 'resolved', outcome: 'sick', note: ' 열이 남 ', contactedVia: 'phone' });
    const rows = await sql`select id::text id, state, outcome, note, contacted_via, handled_by::text handled_by, slot_start from public.attendance_followups where student_id=${STUDENT} and session_date=${TODAY}`;
    assert.deepEqual(rows.map(r => [r.id, r.state, r.outcome, r.note, r.contacted_via, r.handled_by, r.slot_start]), [[first.id, 'resolved', 'sick', '열이 남', 'phone', desk.id, null]]);
    const fa = await audits('attendance_followup');
    assert.equal(fa.length, 2); assert.ok(fa.every(a => a.metadata.hasNote !== undefined && !JSON.stringify(a.metadata).includes('열이') && !('outcome' in a.metadata)), 'no note text or outcome in the audit');
    // 2.0 거절 — 미래 날짜 · 잘못된 신호 · 강사(담당 반만)의 담당 아닌 반.
    const future = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    assert.deepEqual(await act('recordFollowup', LIVE_MOD, { ...f, sessionDate: future, state: 'open' }), { error: '아직 지나지 않은 날짜입니다' });
    assert.deepEqual(await act('recordFollowup', LIVE_MOD, { ...f, signal: 'late', state: 'open' }), { error: '잘못된 신호입니다' });
    assert.deepEqual(await act('recordFollowup', LIVE_MOD, { ...f, state: 'open' }, teacher), { error: '담당 반이 아닙니다' });
    // 출결 입력 요청 — 받는 사람 = 그날 그 교시 담당 ∪ 담임 ∪ 그날 위임(나는 빼고). 같은 (반·날짜·교시)는 한 번만.
    await sql`insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, teacher_id) values (${t}, ${CLASS}, ${DOW}, ${SLOT}, '22:40', '2026-10-01', ${teacher.id})`;
    await sql`delete from public.notification_events where tenant_id=${t} and event_type='attendance_input_request' and subject_key=${CLASS}`;
    const [{ teacher_id: homeroom }] = await sql`select teacher_id::text teacher_id from public.classes where id=${CLASS}`;
    assert.deepEqual(await act('requestAttendanceInput', LIVE_MOD, { classId: CLASS, sessionDate: TODAY, slotStart: SLOT }), { ok: true, sent: true });
    const want = [...new Set([homeroom, teacher.id].filter(id => id && id !== desk.id))].sort();
    const bells = await sql`select recipient_id::text r, type, title, link, actor_id::text a from public.notifications where tenant_id=${t} and type='attendance_input_request' and actor_id=${desk.id} and created_at = now()`;
    assert.deepEqual(bells.map(b => b.r).sort(), want);
    assert.ok(bells.every(b => b.link === '/attendance/live' && b.title.includes(SLOT)));
    const [ra] = await audits('attendance_input_request'); assert.deepEqual([ra.metadata.recipients, [...ra.metadata.recipientIds].sort(), ra.metadata.slotStart], [want.length, want, SLOT]);
    assert.deepEqual(await act('requestAttendanceInput', LIVE_MOD, { classId: CLASS, sessionDate: TODAY, slotStart: SLOT }), { ok: true, sent: false }, 'dedup — no second bell');
    assert.equal((await sql`select count(*)::int n from public.notifications where tenant_id=${t} and type='attendance_input_request' and actor_id=${desk.id} and created_at = now()`)[0].n, want.length);
    assert.deepEqual(await act('requestAttendanceInput', LIVE_MOD, { classId: CLASS, sessionDate: TODAY }, teacher), { error: '출결 요청 권한이 없습니다' });
    // 화면 큐의 '요청함' 표식이 같은 기록을 읽는다(2.0 loadRequestMarks).
    assert.ok((await Live.readRequestMarks(sql, t, TODAY, 'attendance_input_request')).has(`${CLASS}|${SLOT}`));
    // 과목 필터 — 그 사람의 ui_prefs.attendanceLive만, 다른 화면 설정은 그대로.
    const [u0] = await sql`select ui_prefs from public.users where id=${desk.id}`;
    assert.deepEqual(await act('saveLiveSubjectFilter', LIVE_PREFS_MOD, 'math'), { ok: true });
    const [u1] = await sql`select ui_prefs from public.users where id=${desk.id}`;
    assert.equal(u1.ui_prefs.attendanceLive.subject, 'math');
    same({ ...u1.ui_prefs, attendanceLive: undefined }, { ...(u0.ui_prefs ?? {}), attendanceLive: undefined });
    const L = await Live.loadLiveRules(importV2);
    assert.equal((await Live.readLiveViewPrefs(sql, t, L, desk.id)).subject, 'math');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net);
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, 'rolled back — the copy is unchanged');
});

test.after(async () => { await db?.end(); });
