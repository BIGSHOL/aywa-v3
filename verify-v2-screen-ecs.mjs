// 2.0 화면 · 강사 시트 · 영어(ECS) 시험 — node --test experiments/owner-concept/verify-v2-screen-ecs.mjs
// ① 옮긴 본문(설정 병합·영역 설정)이 2.0 원문과 같다 ② load가 2.0 page.tsx의 props 모양(ClassSheetWeekData · ClassSheetMonthData ·
// getSheetLanding 반환 · SheetLandingCard)을 2.0 타입 그대로 낸다 ③ actions가 2.0 서버 액션과 1:1(같은 모듈·같은 이름 · "use server")
// ④ 2.0 함수로 만든 값이 복사본의 독립 SQL과 맞는다(반 목록·주간 작성률·교시 #88·월간 계획 줄) ⑤ 3.0 쪽 화면 파일은 iframe 껍데기뿐
// ⑥ 저장이 2.0과 같은 표·칸·감사로그를 남긴다(테스트 학생 '학원이'·테스트 반, 한 트랜잭션 안에서 하고 늘 되돌린다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import * as C from './v2-ecs-core.mjs';
import { screen } from './v2-screen-ecs.mjs';
import { importV2 } from './v2-bridge.mjs';

const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }

test('옮긴 본문(deepMerge·normalizeHolidays·normalizeSubjects·resolveSkillAreas·skillAreaLabelOf)이 2.0 원문과 같다', async () => {
  const ts = (await import('typescript')).default, mine = await here('./v2-ecs-core.mjs');
  const fn = (raw, name) => { const text = raw.replace(/\r\n/g, '\n'), i = text.search(new RegExp(`(?:export )?function ${name}\\b`)), end = text.indexOf('\n}\n', i); assert.ok(i >= 0 && end > i, `${name} 본문`); return text.slice(text.indexOf('function', i), end + 2); };
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/,(?=[)\]}])/g, '').replace(/'/g, '"');
  const resolve = await src('features/owner/resolve.ts'), skill = await src('features/owner/skill-areas.ts');
  for (const name of ['deepMerge', 'normalizeHolidays', 'normalizeSubjects']) assert.equal(norm(fn(mine, name)), norm(fn(resolve, name)), name);
  for (const name of ['resolveSkillAreas', 'skillAreaLabelOf']) assert.equal(norm(fn(mine, name)), norm(fn(skill, name)), name);
  const list = text => { const i = text.indexOf('DEFAULT_ENGLISH_SKILL_AREAS'); return text.slice(i, text.indexOf('];', i)); };
  assert.deepEqual(C.DEFAULT_ENGLISH_SKILL_AREAS, [...list(skill).matchAll(/key: "(\w+)", label: "(\w+)", color: "(\w+)"/g)].map(m => ({ key: m[1], label: m[2], color: m[3] })));
  assert.deepEqual(C.deepMerge({ a: [1], b: { c: 1, d: 2 }, e: 1 }, { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1 }), { a: [2, 3], b: { c: 1, d: 2 }, e: 1 });
});

test('2.0 모듈을 한 객체로 펼쳐도 같은 이름에 다른 값이 없다(불러온 함수가 서로 덮이지 않는다)', async () => {
  const seen = new Map();
  for (const p of C.MODULES) for (const [k, v] of Object.entries(await importV2(p))) { if (seen.has(k)) assert.equal(seen.get(k)[1], v, `${k}: ${seen.get(k)[0]} ↔ ${p}`); seen.set(k, [p, v]); }
});

test('매개변수: 2.0 주소(v2path)·2.0 쿼리·보는 사람만, 모양이 아니면 거절', () => {
  const P = screen.params, ok = (k, v) => P[k].test(v), U = 'e175fd4d-a655-409a-905e-71850ab1b848';
  assert.deepEqual(Object.keys(P).sort(), ['class', 'date', 'day', 'mode', 'month', 'period', 'read', 'readonly', 'slot', 'v2path', 'view', 'viewer', 'week']);
  for (const [k, v] of [['read', 'dayPlan'], ['read', 'compare'], ['class', U], ['slot', '17:15'], ['slot', '17:15:00']]) assert.ok(ok(k, v), `${k}=${v}`);
  for (const [k, v] of [['read', 'flushSheetPatches'], ['class', 'x'], ['slot', '7:15'], ['slot', '17:15:00.1']]) assert.ok(!ok(k, v), `${k}=${v} 거절`);
  for (const v of ['/ecs', `/ecs/${U}`, `/ecs/${U}/month`, '/ecs/goals', '/ecs/plan-gap']) assert.ok(ok('v2path', v), v);
  for (const v of ['/ecs/x', '/timetable', `/ecs/${U}/month/x`, `/ecs/${U}?week=1`, 'ecs']) assert.ok(!ok('v2path', v), `${v} 거절`);
  for (const [k, v] of [['view', 'week'], ['view', 'today'], ['view', 'mp'], ['week', '2026-10-26'], ['month', '2026-10'], ['period', 'session'], ['mode', 'cards'], ['readonly', '1'], ['viewer', U]]) assert.ok(ok(k, v), `${k}=${v}`);
  for (const [k, v] of [['view', 'admin'], ['week', '2026-10-26T00'], ['month', '2026-1'], ['period', 'year'], ['readonly', 'true'], ['viewer', 'me']]) assert.ok(!ok(k, v), `${k}=${v} 거절`);
});

// ── ② props 모양 = 2.0 타입 ─────────────────────────────────────────────────────────────────────────
/** 2.0 `export type X = { … }`의 맨 바깥 칸 — 필수/선택. */
function typeKeys(text, name) {
  const t = text.replace(/\r\n/g, '\n'), i = t.indexOf(`export type ${name} = {`); assert.ok(i >= 0, `${name} 타입`);
  let depth = 0, j = t.indexOf('{', i), body = '';
  for (; j < t.length; j++) { const ch = t[j]; if (ch === '{') depth++; if (ch === '}') { depth--; if (depth === 0) break; } if (depth >= 1) body += ch; }
  return keysAtTop(body.slice(1));
}
function keysAtTop(body) {
  const req = [], opt = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    const m = depth === 0 ? /^\s*(\w+)(\?)?:/.exec(line) : null;
    if (m && !/^\s*(?:\*|\/\/)/.test(line)) (m[2] ? opt : req).push(m[1]);
    for (const ch of line.replace(/\/\/.*$/, '').replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '')) { if ('{(<['.includes(ch)) depth++; else if ('})>]'.includes(ch)) depth--; }
  }
  return { req, opt };
}
const sameShape = (obj, { req, opt }, what) => {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined);
  for (const k of req) assert.ok(k in obj, `${what}: 2.0 칸 ${k}가 없다`);
  for (const k of keys) assert.ok(req.includes(k) || opt.includes(k), `${what}: 2.0에 없는 칸 ${k}`);
};

test('actions = 2.0 서버 액션과 1:1 — 같은 모듈("use server")의 같은 이름, 호스트 호출 모양만 받는다', async () => {
  for (const [name, a] of Object.entries(screen.actions)) {
    const text = await src(a.module);
    assert.match(text, /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/, `${a.module}: "use server"`);
    assert.match(text, new RegExp(`export async function ${name}\\(`), `${a.module}에 ${name}이 있다`);
    const actor = '09705ab8-05cf-48ab-8f06-d54a3d990b5c';
    assert.throws(() => a.validate({ module: 'features/other/server/actions.ts', actor, args: [] }), /입력 값/, `${name}: 다른 모듈`);
    assert.throws(() => a.validate({ module: a.module, args: [] }), /저장하는 사람/, `${name}: 사람 없음`);
    assert.throws(() => a.validate({ module: a.module, actor, args: [1, 2, 3] }), /입력 값/, `${name}: 인자가 많다`);
    assert.deepEqual(a.validate({ module: a.module, actor, args: [{ x: 1 }] }), { actor, args: [{ x: 1 }] });
  }
  const names = Object.keys(screen.actions);
  for (const n of ['flushSheetPatches', 'createPlanLine', 'movePlanLine', 'deletePlanLine', 'copyWeekFromPrevious', 'copySlotFromPrevious', 'upsertGoal', 'upsertStudentMark', 'saveMemo',
    'setSlotShouting', 'removeMakeupAttendee', 'markPresentIfAbsent', 'clearPresentAttendance', 'setAttendanceCell', 'commitSheetEdits', 'saveMonthPlanCells', 'saveMonthMemo', 'getEcsDayPlan', 'getSlotPlanCompare',
    'updateStudentEnglishName']) assert.ok(names.includes(n), n);
  // 2.0 ECS 서버 액션 파일의 setMyEcs* 열은 전부 잇는다(보기 설정은 그 사람 계정에).
  const sheetActions = await src('features/class-sheets/server/actions.ts');
  for (const m of sheetActions.matchAll(/export async function (setMyEcs\w+)\(/g)) assert.ok(names.includes(m[1]), m[1]);
  // 출석부(로그인 JJ실)가 같은 이름으로 쓰는 2.0 ECS_PLAN_API의 함수 — 모듈까지 2.0과 같다(그 화면 호스트가 같은 모듈 경로로 부른다).
  const planApi = await src('features/class-sheets/components/plan-api.ts');
  for (const n of ['flushSheetPatches', 'createPlanLine', 'movePlanLine', 'deletePlanLine', 'copySlotFromPrevious', 'commitSheetEdits', 'getSlotPlanCompare']) {
    assert.match(planApi, new RegExp(`\\b${n}\\(`), `ECS_PLAN_API가 ${n}을 부른다`);
    assert.ok(names.includes(n), `${n}: 출석부가 이어 쓸 이름`);
  }
  // 영어 이름 입력 검사 = 2.0 inputSchema 원문 그대로.
  const zodOf = text => { const t = text.replace(/\r\n/g, '\n'), i = t.indexOf('z.object({'); return t.slice(i, t.indexOf('\n});', i) + 4).replace(/\s+/g, ''); };
  assert.equal(zodOf(await here('./v2-ecs-save.mjs')), zodOf(await src('features/students/server/english-name.ts')), '영어 이름 inputSchema');
});

const TENANT = db ? (await import('./full-db.mjs')).tenantId : null;
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: TENANT, importV2 }));
const WEEK = '2026-10-26', INJAEWON = '5283fcb8-6feb-4b71-82d1-e9ace0b8904b', EIE = 'ec0a13c4-e78e-4f5e-88af-5b0ced8d5869', MATH = '50d2ece7-6514-4474-8cfc-dd8983d15c18';

test('복사본: 주간 시트·월간·반 목록 props가 2.0 타입의 칸 그대로(ClassSheetWeekData · WeekGrid · ClassSheetMonthData · SheetLandingCard)', { skip: !db && 'local database not running' }, async () => {
  const queries = await src('features/class-sheets/server/queries.ts'), grid = await src('features/class-sheets/lib/grid.ts'), month = await src('features/class-sheets/server/month-queries.ts');
  const sheet = (await load({ v2path: `/ecs/${INJAEWON}`, week: WEEK })).sheet;
  assert.equal(sheet.res.ok, true);
  sameShape(sheet.res.data, typeKeys(queries, 'ClassSheetWeekData'), 'ClassSheetWeekData');
  sameShape(sheet.res.data.grid, typeKeys(grid, 'WeekGrid'), 'WeekGrid');
  for (const s of Object.values(sheet.res.data.students)) sameShape(s, typeKeys(queries, 'SheetStudentMeta'), 'SheetStudentMeta');
  for (const g of sheet.res.data.goals) sameShape(g, typeKeys(queries, 'SheetGoalDTO'), 'SheetGoalDTO');
  assert.ok(sheet.classOptions.some(o => o.id === INJAEWON) && sheet.userId && sheet.tenantId === TENANT && Array.isArray(sheet.textbookOptions));
  const m = (await load({ v2path: `/ecs/${EIE}/month`, month: '2026-10' })).month;
  assert.equal(m.res.ok, true);
  sameShape(m.res.data, typeKeys(month, 'ClassSheetMonthData'), 'ClassSheetMonthData');
  assert.ok(m.mpChrome && typeof m.mpChrome.periodRange === 'string' && m.mpChrome.texts, 'EiE 반은 계획서 껍데기(getMonthPlanChrome)');
  assert.equal(m.initialView, 'mp', 'EiE 반의 기본 = 계획(MP)');
  const l = (await load({ week: WEEK })).landing;
  assert.equal(l.res.ok, true);
  const landingRet = (() => { const i = queries.indexOf('export async function getSheetLanding('), j = queries.indexOf('ok: true;', i), k = queries.indexOf('}\n  | { ok: false', j); return keysAtTop(queries.slice(j, k).replace(/\r\n/g, '\n')); })();
  sameShape(l.res, { req: landingRet.req, opt: landingRet.opt }, 'getSheetLanding');
  for (const c of l.res.cards) sameShape(c, typeKeys(queries, 'SheetLandingCard'), 'SheetLandingCard');
});

test('복사본: 반 목록 = 그 주에 실제로 도는 영어 반(독립 SQL) · 프로그램 개수 · 강사는 담당 반만', { skip: !db && 'local database not running' }, async () => {
  const d = await load({ week: WEEK }), L = d.landing.res;
  assert.equal(d.route, 'landing'); assert.equal(d.scoped, false, '원장 = 스코프 없음(주간 면)');
  const [{ n }] = await db`select count(distinct c.id)::int n from public.classes c join public.class_schedules s on s.class_id=c.id
    cross join generate_series(${WEEK}::date, ${WEEK}::date + 6, '1 day') g(day)
    where c.tenant_id=${TENANT} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= ${WEEK}::date)
      and s.day_of_week::text = lower(to_char(g.day, 'dy')) and s.valid_from <= g.day and (s.valid_to is null or s.valid_to >= g.day)`;
  assert.equal(L.trackCounts.all, n, '그 주에 도는 반 수'); assert.equal(L.trackCounts.eie + L.trackCounts.injaewon, n, '두 프로그램이 빠짐없이 나눈다');
  assert.equal(L.cards.length, n); assert.equal(new Set(L.cards.map(c => c.classId)).size, n);
  for (const c of L.cards) { assert.ok(c.filledSlots <= c.totalSlots); if (c.englishTrack !== 'eie') assert.equal(c.shoutingSlots, null, 'EiE가 아니면 Shouting은 null(0이 아니다)'); }
  // 강사(담임 반이 있는 선생님)로 보면 2.0처럼 '오늘' 면이 기본, 주간 면은 담당 반만.
  const [t] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and c.subject='english' and c.is_active group by u.id order by count(*) desc limit 1`;
  assert.equal((await load({ viewer: t.id })).route, 'today');
  const tw = (await load({ viewer: t.id, view: 'week', week: WEEK })).landing.res;
  const scope = new Set((await db`select id::text id from public.classes where tenant_id=${TENANT} and teacher_id=${t.id}`).map(r => r.id));
  const assist = new Set((await db`select distinct s.class_id::text id from public.class_schedules s join public.classes c on c.id=s.class_id where s.tenant_id=${TENANT} and s.teacher_id=${t.id} and c.subject='english'`).map(r => r.id));
  for (const c of tw.cards) assert.ok(scope.has(c.classId) || assist.has(c.classId), `${c.className}: 담당 반`);
  assert.ok(tw.cards.length > 0 && tw.cards.length < L.cards.length);
});

test('복사본: 주간 시트 교시·작성률이 독립 SQL과 같다(이력 행 #88 · LAB 제외) · 수업 나누기 0행 · 수학 반 거절', { skip: !db && 'local database not running' }, async () => {
  const s = (await load({ v2path: `/ecs/${INJAEWON}`, week: WEEK })).sheet.res.data;
  const live = await db`select distinct g.day::date::text d, to_char(s.start_time,'HH24:MI') st, s.slot_teacher_label lbl from public.class_schedules s
    cross join generate_series(${WEEK}::date, ${WEEK}::date + 6, '1 day') g(day)
    where s.tenant_id=${TENANT} and s.class_id=${INJAEWON} and s.day_of_week::text = lower(to_char(g.day, 'dy')) and s.valid_from <= g.day and (s.valid_to is null or s.valid_to >= g.day)`;
  const shown = live.filter(r => !/^(LAB|이주희)/i.test(r.lbl ?? '') && (s.showSelfStudy || !/^JJ/i.test(r.lbl ?? '')));
  const gridKeys = s.grid.days.flatMap(x => x.slots.map(sl => `${x.date}|${sl.slotStart}`)).sort();
  assert.deepEqual(gridKeys, [...new Set(shown.map(r => `${r.d}|${r.st}`))].sort(), '그 주 교시 = 날짜마다 살아 있는 배치');
  const [{ filled }] = await db`select count(distinct (plan_date, to_char(slot_start,'HH24:MI')))::int filled from public.class_sheet_plan_lines
    where tenant_id=${TENANT} and class_id=${INJAEWON} and plan_date between ${WEEK}::date and ${WEEK}::date + 6 and ecs_is_meaningful_line(textbook, page_range, progress, homework)
      and (plan_date::text || '|' || to_char(slot_start,'HH24:MI')) = any(${gridKeys})`;
  assert.equal(s.fill.filledSlots, filled, '작성률 분자 = 같은 DB 판정(ecs_is_meaningful_line)');
  assert.equal(s.canWrite, true); assert.ok(Object.values(s.canMarkAttendanceByDate).every(Boolean), '원장은 7일 창 없이 출결을 연다');
  assert.equal((await db`select count(*)::int n from public.class_splits where tenant_id=${TENANT}`)[0].n, 0, '수업 나누기 없음 — 나눔 없이 조립해도 2.0과 같다');
  const math = (await load({ v2path: `/ecs/${MATH}` })).sheet.res;
  assert.deepEqual(math, { ok: false, error: '이 반은 영어 강사 시트 대상이 아닙니다' }, '2.0 문구로 거절');
  const m = (await load({ v2path: `/ecs/${INJAEWON}/month`, month: '2026-10', view: 'mp' })).month;
  assert.equal(m.initialView, 'cal', '주소에 mp를 쳐도 인재원 영어 반은 달력(clampEcsMonthView)');
  const keys = Object.entries(m.res.data.slotsByDate).flatMap(([d, slots]) => slots.map(x => `${d}|${x.slotStart}`));
  const [{ n }] = await db`select count(*)::int n from public.class_sheet_plan_lines where tenant_id=${TENANT} and class_id=${INJAEWON} and plan_date between '2026-10-01' and '2026-10-31'
    and ecs_is_meaningful_line(textbook, page_range, progress, homework) and (plan_date::text || '|' || to_char(slot_start,'HH24:MI')) = any(${keys})`;
  assert.equal(m.res.data.lines.length, n, '월간 계획 줄 = 배정 칸의 의미 있는 줄');
});

test('3.0 쪽 화면 파일 = iframe 껍데기 · 손그림 CSS 없음 · 호스트 진입점 표식', async () => {
  const shell = await here('v2-screen-ecs.js');
  for (const f of ['v2-screen-ecs.js', 'v2-screen-ecs.mjs', 'v2-ecs-core.mjs', 'v2-ecs-props.mjs', 'v2-ecs-save.mjs', 'v2-host/src/ecs.tsx', 'v2-host/src/ecs-page.tsx']) {
    const text = await here(f);
    assert.ok(!/aywa\.co\.kr|vercel\.app|supabase\.co|https?:\/\/(?!127\.0\.0\.1|2\.0\.local)/i.test(text), `${f}: 운영 주소`);
  }
  assert.ok(shell.includes("HOST = `/v2-host/${ID}.html`") && /fetch\(HOST, \{ method: 'HEAD' \}\)/.test(shell), '호스트를 같은 출처 iframe으로');
  assert.equal((shell.match(/\bfetch\(/g) || []).length, 1, '3.0 쪽은 호스트가 있는지 묻기만 한다(조회·저장은 iframe 안 2.0 부품)');
  assert.ok(!/method: 'POST'|XMLHttpRequest|sendBeacon/.test(shell));
  assert.ok(shell.includes("'v2path'"), '2.0 하위 주소를 3.0 주소에 싣는다');
  await assert.rejects(access(new URL('v2-screen-ecs.css', import.meta.url)), '손그림 CSS는 지웠다');
  const entry = await here('v2-host/src/ecs.tsx');
  assert.match(entry, /export const HOST_TITLE = '강사 시트'/); assert.match(entry, /export const HOST_ROUTE = '\/ecs'/);
  // 하위 주소 = shim v2path 규칙 그대로 — 3.0 쪽에 /ecs/… 주소를 다시 여는 우회 코드가 없다.
  assert.ok(!/\/ecs\//.test(shell.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), '3.0 껍데기는 2.0 하위 주소를 직접 다루지 않는다');
});

test('호스트 진입점: 읽기 둘은 GET(쓰기 기록 밖) · 반환 모양이 다른 2.0 함수 셋은 2.0 실패 모양 — 모두 2.0에 있는 "use server" 함수', async () => {
  const entry = await here('v2-host/src/ecs.tsx');
  const handlers = [...entry.matchAll(/registerHostHandler\('([^']+)', '(\w+)'/g)].map(m => [m[1], m[2]]);
  const fallbacks = [...entry.matchAll(/registerHostFallback\('([^']+)', '(\w+)', ([^\n]+)\);/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(handlers, [['features/class-sheets/server/day-plan.ts', 'getEcsDayPlan'], ['features/textbooks/server/compare-actions.ts', 'getSlotPlanCompare']]);
  for (const [module, name] of [...handlers, ...fallbacks]) {
    const text = await src(module);
    assert.match(text, /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/, `${module}: "use server"`);
    assert.match(text, new RegExp(`export async function ${name}\\(`), `${module}에 ${name}`);
  }
  // 읽기 둘은 같은 화면의 GET 매개변수로만(저장 경로 POST 아님).
  for (const k of ['read', 'class', 'slot']) assert.ok(screen.params[k], `GET 칸 ${k}`);
  assert.ok(/fetch\(`\/api\/v2\/ecs\?\$\{q\}`/.test(entry) && !/method: 'POST'/.test(entry));
  // 2.0 실패 모양 — 반환 타입 그대로(배열 · { options, hiddenBySubject } · { options, failed }).
  const types = { searchMakeupStudents: /\): Promise<\{ id: string; name: string; label: string;[^\n]*\}\[\]>/, fetchMakeupAbsences: /\): Promise<MakeupAbsenceList>/, fetchMakeupHostClasses: /\): Promise<\{ options: MakeupHostClass\[\]; failed\?: boolean/ };
  assert.deepEqual(fallbacks.map(f => f[1]).sort(), Object.keys(types).sort());
  for (const [module, name, value] of fallbacks) {
    const text = (await src(module)).replace(/\r\n/g, '\n'), i = text.indexOf(`export async function ${name}(`);
    assert.match(text.slice(i, i + 600), types[name], `${name}: 2.0 반환 타입`);
    assert.ok(/^\(\) => /.test(value), `${name}: 부를 때마다 새 값`);
  }
  assert.match(await src('features/attendance/components/makeup-add-flow.tsx'), /EMPTY_ABSENCES: MakeupAbsenceList = \{ options: \[\], hiddenBySubject: 0 \}/, '빈 결석 목록 = 2.0 EMPTY_ABSENCES');
});

// ── ⑥ 저장 — 테스트 학생 '학원이' · 테스트 반 '학원이(영어 테스트)'(담임 '테스터'). 한 트랜잭션 안에서 하고 늘 되돌린다. ──
const T_CLASS = 'e175fd4d-a655-409a-905e-71850ab1b848', T_STU = '6219e442-aa57-455f-a5bc-834b222d9e1c', T_ACTOR = '09705ab8-05cf-48ab-8f06-d54a3d990b5c', ROLLBACK = Symbol('rollback');
async function inRollback(fn) {
  const run = (sql, name, actor, ...args) => { const a = screen.actions[name]; return a.run({ sql, body: a.validate({ module: a.module, actor, args }), tenantId: TENANT, importV2 }); };
  await db.begin(async sql => { await fn({ sql, run }); throw ROLLBACK; }).catch(e => { if (e !== ROLLBACK) throw e; });
}
/** 한 트랜잭션 안의 감사로그는 시각(now())이 같다 — 순서가 아니라 내용으로 찾는다. */
const find = (list, pred, what) => { const hit = list.find(a => pred(a.metadata)); assert.ok(hit, `감사로그 없음: ${what}`); return hit.metadata; };

test('복사본(되돌림): 계획 줄·칸(CAS)·복사·학생 기록·목표·메모 + 칸 편집 감사(commitSheetEdits)가 2.0과 같다', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_sheet_plan_lines where class_id=${T_CLASS}) lines`;
  await inRollback(async ({ sql, run }) => {
    const audits = action => sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${TENANT} and action=${action} and metadata->>'classId'=${T_CLASS} and metadata->>'via'='3.0 연습 복사본'`;
    const [other] = await sql`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and u.id <> ${T_ACTOR}
      and not exists (select 1 from public.classes c where c.id=${T_CLASS} and c.teacher_id=u.id) and not exists (select 1 from public.class_schedules s where s.class_id=${T_CLASS} and s.teacher_id=u.id)
      and not exists (select 1 from public.class_delegations d where d.class_id=${T_CLASS} and d.delegate_user_id=u.id) limit 1`;
    assert.deepEqual(await run(sql, 'createPlanLine', other.id, { classId: T_CLASS, planDate: '2026-09-22', slotStart: '17:15', termMode: 'regular', skillArea: 'vocab' }), { ok: false, error: '담당 반이 아닙니다' });
    // 2.0 게이트 순서 그대로 — 선생님은 남의 반이면 '담당 반'에서 먼저 멈추고, 원장은 반 과목에서 멈춘다.
    assert.deepEqual(await run(sql, 'saveMemo', T_ACTOR, { classId: MATH, weekStart: '2026-09-21', memoKey: 'week', body: 'x' }), { ok: false, error: '담당 반이 아닙니다' });
    const [owner] = await sql`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
    assert.deepEqual(await run(sql, 'saveMemo', owner.id, { classId: MATH, weekStart: '2026-09-21', memoKey: 'week', body: 'x' }), { ok: false, error: '이 반은 영어 강사 시트 대상이 아닙니다' });
    // 줄 추가 → { ok, lines } · ecs_plan_line_add
    const added = await run(sql, 'createPlanLine', T_ACTOR, { classId: T_CLASS, planDate: '2026-09-22', slotStart: '17:15', termMode: 'regular', skillArea: 'vocab' });
    assert.equal(added.ok, true); const line = added.lines.at(-1);
    assert.deepEqual([line.skillArea, line.planDate, line.slotStart.slice(0, 5), line.termMode], ['vocab', '2026-09-22', '17:15', 'regular']);
    assert.deepEqual(Object.keys(line).sort(), ['homework', 'id', 'lineNo', 'pageRange', 'planDate', 'progress', 'skillArea', 'slotStart', 'termMode', 'textbook', 'updatedAt'], '2.0 PlanLineDTO');
    const [add] = await audits('ecs_plan_line_add');
    assert.deepEqual([add.actor_id, add.metadata.planDate, add.metadata.slotStart, add.metadata.skillArea], [T_ACTOR, '2026-09-22', '17:15', 'vocab']);
    // 계획 칸 CAS(flushSheetPatches) — applied / conflict / gone, 감사는 칸을 떠날 때(commitSheetEdits, updated_by = 나일 때만).
    const patch = (field, expectedValue, newValue, rev = 1) => ({ lineId: line.id, field, expectedValue, newValue, saveKey: `${line.id}:${field}`, clientRev: rev });
    const r1 = await run(sql, 'flushSheetPatches', T_ACTOR, T_CLASS, [patch('textbook', null, '  시험 교재  ')]);
    assert.deepEqual(r1, { ok: true, results: [{ saveKey: `${line.id}:textbook`, status: 'applied', clientRev: 1 }] });
    assert.equal((await sql`select textbook from public.class_sheet_plan_lines where id=${line.id}`)[0].textbook, '시험 교재', '2.0 normalizePlanText');
    const r2 = await run(sql, 'flushSheetPatches', T_ACTOR, T_CLASS, [patch('textbook', '옛 값', '새 값', 2)]);
    assert.deepEqual(r2.results[0], { saveKey: `${line.id}:textbook`, status: 'conflict', clientRev: 2, serverValue: '시험 교재' });
    assert.equal((await audits('ecs_plan_cell_edit')).length, 0, '칸 저장 자체는 감사로그를 남기지 않는다(2.0 — 칸을 떠날 때 한 줄)');
    await run(sql, 'commitSheetEdits', T_ACTOR, { classId: T_CLASS, edits: [{ cell: { kind: 'plan', lineId: line.id, field: 'textbook' }, before: null }] });
    const cell = find(await audits('ecs_plan_cell_edit'), m => m.field === 'textbook', '계획 칸');
    assert.deepEqual([cell.kind, cell.fieldLabel, cell.before, cell.after], ['plan', '교재 / 내신교과서', null, '시험 교재']);
    // 내용 복사(지난 수업 9/22 화 → 9/29 화) · 줄 삭제(멱등)
    const copied = await run(sql, 'copySlotFromPrevious', T_ACTOR, { classId: T_CLASS, planDate: '2026-09-29', slotStart: '17:15', termMode: 'regular' });
    assert.ok(copied.ok && copied.copied >= 1 && copied.sourceLabel === '09-22(화)', JSON.stringify(copied));
    assert.equal((await audits('ecs_plan_copy'))[0].metadata.copied, copied.copied);
    const del = await run(sql, 'deletePlanLine', T_ACTOR, { classId: T_CLASS, lineId: line.id });
    assert.equal(del.ok, true); assert.equal((await sql`select count(*)::int n from public.class_sheet_plan_lines where id=${line.id}`)[0].n, 0);
    assert.deepEqual(await run(sql, 'deletePlanLine', T_ACTOR, { classId: T_CLASS, lineId: line.id }), { ok: true, lines: [] });
    // 학생 기록(upsertStudentMark) + 감사(commitSheetEdits mark) · 다 비면 행 삭제 · 수강하지 않은 날은 거절
    const mk = { classId: T_CLASS, studentId: T_STU, markDate: '2026-09-22', slotStart: '17:15' };
    assert.deepEqual(await run(sql, 'upsertStudentMark', T_ACTOR, { ...mk, status: '좋음', progressNote: null, score: '18/20' }), { ok: true });
    const [m1] = await sql`select status, score, progress_note, updated_by::text updated_by from public.class_sheet_student_marks where class_id=${T_CLASS} and student_id=${T_STU} and mark_date='2026-09-22' and slot_start='17:15'`;
    assert.deepEqual({ ...m1 }, { status: '좋음', score: '18/20', progress_note: null, updated_by: T_ACTOR });
    await run(sql, 'commitSheetEdits', T_ACTOR, { classId: T_CLASS, edits: [{ cell: { kind: 'mark', studentId: T_STU, date: '2026-09-22', slotStart: '17:15', field: 'score' }, before: null }] });
    assert.equal(find(await audits('ecs_mark_edit'), m => m.field === 'score', '학생 기록').fieldLabel, '시험 점수');
    await run(sql, 'upsertStudentMark', T_ACTOR, { ...mk, status: null, progressNote: null, score: '' });
    assert.equal((await sql`select count(*)::int n from public.class_sheet_student_marks where class_id=${T_CLASS} and student_id=${T_STU} and mark_date='2026-09-22'`)[0].n, 0, '다 비면 빈 행을 남기지 않는다');
    assert.deepEqual(await run(sql, 'upsertStudentMark', T_ACTOR, { ...mk, markDate: '2026-10-27', status: '좋음', progressNote: null }), { ok: false, error: '그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)' });
    // 목표(월간 = 그 달 1일) · 주간 메모(그 주 월요일) · 월 메모
    assert.deepEqual(await run(sql, 'upsertGoal', T_ACTOR, { classId: T_CLASS, scope: 'month', periodStart: '2026-09-17', role: 'homeroom', skillArea: 'vocab', textbook: '목표 교재', targetProgress: null }), { ok: true });
    assert.equal((await sql`select period_start::text p from public.class_sheet_goals where class_id=${T_CLASS} and scope='month' and role='homeroom' and skill_area='vocab'`)[0].p, '2026-09-01');
    assert.equal((await run(sql, 'upsertGoal', T_ACTOR, { classId: T_CLASS, scope: 'month', periodStart: '2026-09-01', role: 'homeroom', skillArea: 'in_class', textbook: 'x', targetProgress: null })).ok, false, 'EiE 칸은 인재원 반 목표가 아니다');
    await run(sql, 'saveMemo', T_ACTOR, { classId: T_CLASS, weekStart: '2026-09-23', memoKey: 'week', body: '주간 메모' });
    assert.equal((await sql`select week_start::text w from public.class_sheet_memos where class_id=${T_CLASS} and memo_key='week'`)[0].w, '2026-09-21');
    await run(sql, 'saveMonthMemo', T_ACTOR, { classId: T_CLASS, month: '2026-09', body: '월 메모' });
    await run(sql, 'commitSheetEdits', T_ACTOR, { classId: T_CLASS, edits: [{ cell: { kind: 'memo', weekStart: '2026-09-21', memoKey: 'week' }, before: null }, { cell: { kind: 'monthMemo', month: '2026-09' }, before: null },
      { cell: { kind: 'goal', scope: 'month', periodStart: '2026-09-01', role: 'homeroom', skillArea: 'vocab', field: 'textbook' }, before: null }] });
    assert.deepEqual((await audits('ecs_memo_edit')).map(a => a.metadata.kind).sort(), ['memo', 'monthMemo']);
    assert.equal(find(await audits('ecs_goal_edit'), m => m.skillArea === 'vocab', '목표').areaLabel, 'Vocab');
    // 보기 설정 — 그 사람 계정(ui_prefs.ecs)에만, 형제 키 보존, 감사 없음.
    const [p0] = await sql`select ui_prefs from public.users where id=${T_ACTOR}`;
    assert.deepEqual(await run(sql, 'setMyEcsFontSize', T_ACTOR, 'lg'), { ok: true });
    const [p1] = await sql`select ui_prefs from public.users where id=${T_ACTOR}`;
    assert.equal(p1.ui_prefs.ecs.fontSize, 'lg');
    for (const k of Object.keys(p0.ui_prefs ?? {}).filter(k => k !== 'ecs')) assert.deepEqual(p1.ui_prefs[k], p0.ui_prefs[k], `형제 키 ${k} 보존`);
    assert.equal((await run(sql, 'setMyEcsFontSize', T_ACTOR, 'huge')).ok, false);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥으로 나가려는 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_sheet_plan_lines where class_id=${T_CLASS}) lines`;
  assert.deepEqual([after[0].audits, after[0].lines], [before[0].audits, before[0].lines], '되돌렸다 — 복사본은 그대로');
});

test('복사본(되돌림): 출결(교시 칸 setAttendanceCell · clearPresentAttendance) · Shouting · 계획(MP)이 2.0 규칙대로', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run }) => {
    const day = '2026-10-27'; // 복사본 기준일(화) — 강사 7일 창 안
    assert.deepEqual(await run(sql, 'setSlotShouting', T_ACTOR, { classId: T_CLASS, date: '2026-09-22', slotStart: '17:15', value: true }), { ok: false, error: 'Shouting 체크는 EiE 반에서만 사용합니다' });
    const locked = await run(sql, 'setAttendanceCell', T_ACTOR, { classId: T_CLASS, studentId: T_STU, sessionDate: '2026-09-22', slotStart: '17:15', status: 'present' });
    assert.match(locked.error, /수정/, '강사는 7일 창(2.0 attendanceLockMessage)');
    // 시험용으로만(되돌림): 테스트 반을 EiE로 · 수업·수강을 기준일 주까지 늘린다.
    await sql`update public.classes set english_track='eie' where id=${T_CLASS}`;
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    await sql`update public.enrollments set end_date=null where class_id=${T_CLASS} and student_id=${T_STU}`;
    await sql`delete from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${day}`;
    const att = () => sql`select status::text status, slot_start::text slot, recorded_via, recorded_by::text by from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${day}`;
    const audits = action => sql`select metadata from public.audit_logs where tenant_id=${TENANT} and action=${action} and metadata->>'via'='3.0 연습 복사본' and (metadata->>'classId'=${T_CLASS})`;
    const cell = { classId: T_CLASS, studentId: T_STU, sessionDate: day, slotStart: '17:15' };
    const ok1 = await run(sql, 'setAttendanceCell', T_ACTOR, { ...cell, status: 'present' });
    assert.equal(ok1.ok, true);
    assert.deepEqual((await att()).map(r => [r.status, r.slot, r.recorded_via, r.by]), [['present', '17:15:00', 'teacher', T_ACTOR]], '교시 칸 출결 · 가르치는 사람 기록');
    find(await audits('attendance_cell'), m => m.created === true && m.slotStart === '17:15', '새 출결');
    await run(sql, 'setAttendanceCell', T_ACTOR, { ...cell, status: 'absent', note: '연락 없음' });
    assert.deepEqual((await att()).map(r => r.status), ['absent'], '같은 칸은 제자리에서(pickSaveTargets)');
    find(await audits('attendance_cell'), m => m.overwrote === true && m.prevStatus === 'present', '고친 출결');
    const blocked = await run(sql, 'clearPresentAttendance', T_ACTOR, { classId: T_CLASS, studentId: T_STU, date: day, slot: '17:15' });
    assert.equal(blocked.ok, false, '사유가 붙은 기록은 ecs_clear_present가 거절');
    await run(sql, 'setAttendanceCell', T_ACTOR, { ...cell, status: 'present', note: null });
    const cleared = await run(sql, 'clearPresentAttendance', T_ACTOR, { classId: T_CLASS, studentId: T_STU, date: day, slot: '17:15' });
    assert.deepEqual(cleared, { ok: true, cleared: 1 }); assert.equal((await att()).length, 0);
    find(await audits('ecs_attendance_clear'), m => m.rows === 1 && m.date === day, '출결 지우기');
    // Shouting — 두 번 체크해도 감사 한 줄(바뀐 때만), 풀면 행 삭제.
    for (const value of [true, true, false]) await run(sql, 'setSlotShouting', T_ACTOR, { classId: T_CLASS, date: day, slotStart: '17:15', value });
    assert.deepEqual((await audits('ecs_shouting_toggle')).map(a => a.metadata.checked).sort(), [false, true]);
    // 계획(MP) — 값 칸(감사는 commitSheetEdits) · e-book 열(구조 → 여기서 감사)
    assert.deepEqual(await run(sql, 'saveMonthPlanCells', T_ACTOR, { classId: T_CLASS, patches: [{ date: day, colKind: 'in_class', body: 'SB p.10' }] }), { ok: true });
    await run(sql, 'commitSheetEdits', T_ACTOR, { classId: T_CLASS, edits: [{ cell: { kind: 'mpCell', date: day, colKind: 'in_class' }, before: null }] });
    assert.equal(find(await audits('ecs_month_plan_edit'), m => m.kind === 'mpCell', 'MP 칸').fieldLabel, 'In-class');
    await run(sql, 'saveMonthPlanCells', T_ACTOR, { classId: T_CLASS, patches: [day, '2026-10-20'].map(date => ({ date, colKind: 'ebook', body: '' })), intent: { kind: 'ebookColumn', show: true } });
    assert.equal(find(await audits('ecs_month_plan_edit'), m => m.change === 'ebookColumn', 'e-book 열').days, 2);
    const day1 = await run(sql, 'getEcsDayPlan', T_ACTOR, { classId: T_CLASS, planDate: '2026-09-17' });
    assert.ok(day1.ok && day1.data.weekMonday === '2026-09-14' && day1.data.showExamTerm === false && Object.keys(day1.data.linesBySlot).length > 0, '그 날 계획 읽기(2.0 getEcsDayPlan)');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청을 늘리지 않았다');
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, '되돌렸다');
});

test('복사본: 읽기 서버 액션(GET ?read=) = 같은 2.0 함수의 반환 그대로 · 고른 사람 없으면 거절 · 2.0 게이트 문구', { skip: !db && 'local database not running' }, async () => {
  const compareTs = await src('features/textbooks/server/compare-actions.ts');
  const okKeys = (() => { const t = compareTs.replace(/\r\n/g, '\n'), i = t.indexOf('export type SlotCompareResult'), j = t.indexOf('| {', i) + 3, k = t.indexOf('}\n  | { ok: false', j); return keysAtTop(t.slice(j, k)); })();
  const day = await load({ read: 'dayPlan', class: T_CLASS, date: '2026-09-17', viewer: T_ACTOR });
  assert.ok(day.ok && day.data.weekMonday === '2026-09-14' && day.data.userId === T_ACTOR && Object.keys(day.data.linesBySlot).length > 0, 'getEcsDayPlan');
  let viaAction = null;
  await inRollback(async ({ sql, run }) => { viaAction = await run(sql, 'getEcsDayPlan', T_ACTOR, { classId: T_CLASS, planDate: '2026-09-17' }); });
  assert.deepEqual(day, viaAction, 'GET과 서버 액션이 같은 답');
  const cmp = await load({ read: 'compare', class: T_CLASS, date: '2026-09-22', slot: '17:15', viewer: T_ACTOR });
  assert.equal(cmp.ok, true); sameShape(cmp, okKeys, 'SlotCompareResult');
  assert.deepEqual(await load({ read: 'compare', class: T_CLASS, date: '2026-09-22', viewer: T_ACTOR }), { ok: false, error: '교시가 올바르지 않습니다' });
  assert.deepEqual(await load({ read: 'dayPlan', class: T_CLASS, date: '2026-09-17' }), { ok: false, error: '접근 권한이 없습니다' }, '고른 사람 없이 첫 사람으로 대신 읽지 않는다');
  assert.deepEqual(await load({ read: 'dayPlan', class: MATH, date: '2026-09-17', viewer: T_ACTOR }), { ok: false, error: '담당 반이 아닙니다' });
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  assert.deepEqual(await load({ read: 'dayPlan', date: '2026-09-17', viewer: owner.id }), { ok: false, error: '반을 찾을 수 없습니다' }, '반이 없으면 2.0 문구(500이 아니다)');
});

test('복사본(되돌림): 학생 영어 이름(updateStudentEnglishName) = 2.0 결과 키 · 같은 칸 · CAS · 지점 중복 · 담당 범위 · 감사로그', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select english_name from public.students where id=${T_STU}) name`;
  await inRollback(async ({ sql, run }) => {
    const [owner] = await sql`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
    const prev = before[0].name, call = (actor, input) => run(sql, 'updateStudentEnglishName', actor, input);
    assert.deepEqual(await call(T_ACTOR, { studentId: T_STU, englishName: 'Probe Kim', previousEnglishName: prev }), { ok: false, error: 'denied' }, '영어 이름 권한이 없는 강사');
    assert.deepEqual(await call(owner.id, { studentId: 'x', englishName: 'Probe Kim', previousEnglishName: prev }), { ok: false, error: 'invalid' });
    assert.deepEqual(await call(owner.id, { studentId: T_STU, englishName: 'A\u0001', previousEnglishName: prev }), { ok: false, error: 'invalid' });
    assert.deepEqual(await call(owner.id, { studentId: T_STU, englishName: 'Probe Kim', previousEnglishName: 'Not This' }), { ok: false, error: 'conflict' });
    const [taken] = await sql`select english_name from public.students where tenant_id=${TENANT} and id<>${T_STU} and english_name is not null and btrim(english_name) <> '' order by id limit 1`;
    assert.deepEqual(await call(owner.id, { studentId: T_STU, englishName: taken.english_name.trim().toUpperCase(), previousEnglishName: prev }), { ok: false, error: 'duplicate' }, '지점 안 같은 이름(대소문자 무시)');
    assert.deepEqual(await call(owner.id, { studentId: T_STU, englishName: '  Probe Kim  ', previousEnglishName: prev }), { ok: true, englishName: 'Probe Kim' });
    assert.equal((await sql`select english_name from public.students where id=${T_STU}`)[0].english_name, 'Probe Kim');
    const logs = await sql`select actor_id::text actor_id, target_type, target_label, metadata from public.audit_logs where tenant_id=${TENANT} and action='student_english_name_update' and metadata->>'studentId'=${T_STU}`;
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0].actor_id, logs[0].target_type, logs[0].target_label, logs[0].metadata.before, logs[0].metadata.after, logs[0].metadata.via], [owner.id, 'student', '학원이', prev, 'Probe Kim', '3.0 연습 복사본']);
    assert.deepEqual(await call(owner.id, { studentId: T_STU, englishName: 'Probe Kim', previousEnglishName: 'Probe Kim' }), { ok: true, englishName: 'Probe Kim' }, '같은 값 = 저장 없이 성공');
    assert.equal((await sql`select count(*)::int n from public.audit_logs where tenant_id=${TENANT} and action='student_english_name_update' and metadata->>'studentId'=${T_STU}`)[0].n, 1, '바뀐 때만 감사');
    // 개인 예외로 영어 이름 권한이 있는 선생님 — 담당 반 수강생이 아니면 denied(2.0 teacherClassScopeStrict).
    const R = await C.loadRules(importV2), env = await C.readSettings(sql, TENANT, R);
    const teachers = (await C.readViewers(sql, TENANT, R, env)).filter(v => v.systemRole === 'teacher' && C.canWriteLevel(v.levels.englishName));
    const [outsider] = await sql`select u.id::text id from public.users u where u.id = any(${teachers.map(v => v.id)}::uuid[]) and not exists (select 1 from public.enrollments e where e.student_id=${T_STU}
        and (e.class_id in (select id from public.classes where teacher_id=u.id) or e.class_id in (select class_id from public.class_schedules where teacher_id=u.id))) limit 1`;
    if (outsider) assert.deepEqual(await call(outsider.id, { studentId: T_STU, englishName: 'Other', previousEnglishName: 'Probe Kim' }), { ok: false, error: 'denied' }, '담당 범위 밖');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select english_name from public.students where id=${T_STU}) name`;
  assert.deepEqual([after[0].audits, after[0].name], [before[0].audits, before[0].name], '되돌렸다');
});

test.after(async () => { await db?.end(); });
