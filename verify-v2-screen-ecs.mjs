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
  for (const [k, v] of [['read', 'dayPlan'], ['read', 'compare'], ['read', 'slotChoices'], ['read', 'textbookPlans'], ['read', 'assignable'], ['class', U], ['slot', '17:15'], ['slot', '17:15:00']]) assert.ok(ok(k, v), `${k}=${v}`);
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
    assert.throws(() => a.validate({ module: a.module, actor, args: Array.from({ length: a.arity + 1 }, (_, i) => i) }), /입력 값/, `${name}: 인자가 많다`);
    assert.deepEqual(a.validate({ module: a.module, actor, args: [{ x: 1 }] }), { actor, args: [{ x: 1 }] });
  }
  const names = Object.keys(screen.actions);
  for (const n of ['flushSheetPatches', 'createPlanLine', 'movePlanLine', 'deletePlanLine', 'copyWeekFromPrevious', 'copySlotFromPrevious', 'upsertGoal', 'upsertStudentMark', 'saveMemo',
    'setSlotShouting', 'removeMakeupAttendee', 'markPresentIfAbsent', 'clearPresentAttendance', 'setAttendanceCell', 'commitSheetEdits', 'saveMonthPlanCells', 'saveMonthMemo', 'getEcsDayPlan', 'getSlotPlanCompare',
    'updateStudentEnglishName', 'searchMakeupStudents', 'fetchMakeupAbsences', 'noteMakeupAgainstAbsence', 'setLessonShift', 'undoLessonShift']) assert.ok(names.includes(n), n);
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

test('호스트 진입점: 읽기 둘은 GET(쓰기 기록 밖) · 반환 모양이 다른 2.0 함수 넷은 2.0 실패 모양 — 모두 2.0에 있는 "use server" 함수', async () => {
  const entry = await here('v2-host/src/ecs.tsx');
  const handlers = [...entry.matchAll(/registerHostHandler\('([^']+)', '(\w+)'/g)].map(m => [m[1], m[2]]);
  const fallbacks = [...entry.matchAll(/registerHostFallback\('([^']+)', '(\w+)', ([^\n]+)\);/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(handlers, [['features/class-sheets/server/day-plan.ts', 'getEcsDayPlan'], ['features/textbooks/server/compare-actions.ts', 'getSlotPlanCompare'],
    ...['loadClassSlotChoices', 'loadClassTextbookPlans', 'loadAssignableTextbooks'].map(n => ['features/textbooks/server/plan-actions.ts', n])]);
  for (const [module, name] of [...handlers, ...fallbacks]) {
    const text = await src(module);
    assert.match(text, /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/, `${module}: "use server"`);
    assert.match(text, new RegExp(`export async function ${name}\\(`), `${module}에 ${name}`);
  }
  // 읽기 둘은 같은 화면의 GET 매개변수로만(저장 경로 POST 아님).
  for (const k of ['read', 'class', 'slot']) assert.ok(screen.params[k], `GET 칸 ${k}`);
  assert.ok(/fetch\(`\/api\/v2\/ecs\?\$\{q\}`/.test(entry) && !/method: 'POST'/.test(entry));
  // 2.0 실패 모양 — 반환 타입 그대로(배열 · { options, hiddenBySubject } · { options, failed }).
  const types = { searchMakeupStudents: /\): Promise<\{ id: string; name: string; label: string;[^\n]*\}\[\]>/, fetchMakeupAbsences: /\): Promise<MakeupAbsenceList>/, fetchMakeupHostClasses: /\): Promise<\{ options: MakeupHostClass\[\]; failed\?: boolean/,
    setAttendanceBulk: /\): Promise<BulkCellResult>/ };
  assert.deepEqual(fallbacks.map(f => f[1]).sort(), Object.keys(types).sort());
  for (const [module, name, value] of fallbacks) {
    const text = (await src(module)).replace(/\r\n/g, '\n'), i = text.indexOf(`export async function ${name}(`);
    assert.match(text.slice(i, text.indexOf(' {\n', text.indexOf('): Promise<', i))), types[name], `${name}: 2.0 반환 타입`);
    if (name === 'setAttendanceBulk') assert.equal(value, '(error: string) => ({ error })', `${name}: 2.0 실패 갈래 { error } — 거절 문구를 싣는다`);
    else assert.ok(/^\(\) => /.test(value), `${name}: 부를 때마다 새 값`);
  }
  assert.match((await src('features/attendance/server/actions.ts')).replace(/\r\n/g, '\n'), /export type BulkCellResult =[\s\S]*?\n {2}\| \{ error: string \};/, 'BulkCellResult의 실패 갈래 = { error }');
  assert.ok(!('setAttendanceBulk' in screen.actions), "일괄 출석은 이 화면이 받지 않는다(호스트가 2.0 실패 모양으로 거절 — 오늘 면 요약 카드의 '전원 출석')");
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

test('보강: 옮긴 pickAbsenceNoteTarget이 2.0 원문(absence-cell.ts)과 같고 2.0 순서(이 줄 → 빈 칸 → 최신)로 고른다', async () => {
  const ts = (await import('typescript')).default;
  const body = (text, name) => { const t = text.replace(/\r\n/g, '\n'), i = t.indexOf(`function ${name}(`); return t.slice(i, t.indexOf('\n}\n', i) + 2); };
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/'/g, '"');
  const mine = await here('./v2-ecs-makeup.mjs'), orig = await src('features/attendance/server/absence-cell.ts');
  assert.equal(norm(body(mine, 'pickAbsenceNoteTarget')), norm(body(orig, 'pickAbsenceNoteTarget')));
  const re = text => /const MADE_UP_RE = (\/.+\/);/.exec(text)?.[1];
  assert.equal(re(mine), re(orig), 'MADE_UP_RE');
  const { pickAbsenceNoteTarget, makeupRules } = await import('./v2-ecs-makeup.mjs');
  await makeupRules(importV2); // hasMemoLine = 2.0 함수(불러온 것)
  const rows = [{ id: 'c', note: '10/1 보강 예정' }, { id: 'b', note: null }, { id: 'a', note: '10/27 보강 예정' }];
  assert.equal(pickAbsenceNoteTarget(rows, '10/27 보강 예정').id, 'a', '이미 그 줄이 있는 칸');
  assert.equal(pickAbsenceNoteTarget(rows, '10/30 보강 예정').id, 'b', '아직 보강이 안 적힌 칸');
  assert.equal(pickAbsenceNoteTarget([], 'x'), null);
});

test('복사본(되돌림): 보강 추가 = 학생 찾기 → 결석 후보 → 보강 칸(allowMakeup) → 결석·보강 칸 메모(attendance_makeup_link) — 2.0 흐름 그대로', { skip: !db && 'local database not running' }, async () => {
  const MAKEUP_STU = '7831862b-0af4-46a8-b0ea-3e963880810f', day = '2026-10-27', absent = '2026-10-20';
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net,
    (select count(*)::int from public.attendance_records where student_id=${MAKEUP_STU}) rec`;
  await inRollback(async ({ sql, run }) => {
    assert.equal((await sql`select count(*)::int n from public.enrollments where class_id=${T_CLASS} and student_id=${MAKEUP_STU}`)[0].n, 0, '보강 학생은 이 반 수강생이 아니다');
    // 시험용으로만(되돌림): 테스트 반 수업을 기준일 주까지 · 결석 하나(10/20, 같은 반).
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, recorded_by, recorded_via) values (${TENANT}, ${T_CLASS}, ${MAKEUP_STU}, ${absent}, '17:15', 'absent', ${T_ACTOR}, 'teacher')`;
    // ① 학생 찾기 — 담당 반 강사만(남의 반이면 빈 배열) · 퇴원 제외 · 2.0 반환 칸.
    const found = await run(sql, 'searchMakeupStudents', T_ACTOR, T_CLASS, '학원이', day);
    const hit = found.find(s => s.id === MAKEUP_STU);
    assert.ok(hit, '학원이A'); assert.deepEqual(Object.keys(hit).sort(), ['englishName', 'grade', 'id', 'label', 'name', 'school']);
    assert.deepEqual(await run(sql, 'searchMakeupStudents', T_ACTOR, MATH, '학원이', day), [], '담당 반이 아니면 빈 배열');
    assert.deepEqual(await run(sql, 'searchMakeupStudents', T_ACTOR, T_CLASS, ' (,) ', day), []);
    // ② 결석 후보 — 그 반 과목의 결석(공결 포함, 1년), 2.0 MakeupAbsenceList 모양.
    const list = await run(sql, 'fetchMakeupAbsences', T_ACTOR, MAKEUP_STU, day, T_CLASS);
    assert.ok(Array.isArray(list.options) && typeof list.hiddenBySubject === 'number');
    assert.ok(list.options.some(o => o.date === absent && o.classId === T_CLASS), JSON.stringify(list).slice(0, 300));
    // ③ 보강 칸 — 수강생이 아니라 allowMakeup 없이는 거절, 켜면 그 교시 칸에 makeup.
    const cell = { classId: T_CLASS, studentId: MAKEUP_STU, sessionDate: day, slotStart: '17:15', status: 'makeup', units: '1' };
    assert.deepEqual(await run(sql, 'setAttendanceCell', T_ACTOR, cell), { error: '이 반 수강생이 아닙니다' });
    assert.equal((await run(sql, 'setAttendanceCell', T_ACTOR, { ...cell, allowMakeup: true })).ok, true);
    const [made] = await sql`select status::text status, slot_start::text slot, recorded_by::text by from public.attendance_records where class_id=${T_CLASS} and student_id=${MAKEUP_STU} and session_date=${day}`;
    assert.deepEqual({ ...made }, { status: 'makeup', slot: '17:15:00', by: T_ACTOR });
    // 유닛 직접 입력 — 기록이 있는 보강 칸은 allowMakeup 없이 고친다(hasRecord) · session_units · 감사에 전/후 시수.
    assert.equal((await run(sql, 'setAttendanceCell', T_ACTOR, { ...cell, units: '2' })).ok, true);
    assert.equal((await sql`select session_units::float8 u from public.attendance_records where class_id=${T_CLASS} and student_id=${MAKEUP_STU} and session_date=${day}`)[0].u, 2);
    const unitLog = (await sql`select metadata from public.audit_logs where tenant_id=${TENANT} and action='attendance_cell' and metadata->>'studentId'=${MAKEUP_STU} and metadata->>'via'='3.0 연습 복사본'`).map(r => r.metadata).find(m => m.units === 2);
    assert.ok(unitLog && unitLog.overwrote === true && 'prevUnits' in unitLog && 'nextUnits' in unitLog, JSON.stringify(unitLog));
    // ④ 메모 연결 — 결석 칸 "10/27 보강 예정" · 보강 칸 "10/20 결석분 보강" · 감사 한 줄, 두 번째는 alreadyLinked(감사 없음).
    const link = { studentId: MAKEUP_STU, makeupClassId: T_CLASS, makeupDate: day, absentClassId: T_CLASS, absentDate: absent };
    assert.deepEqual(await run(sql, 'noteMakeupAgainstAbsence', T_ACTOR, link), { ok: true, absenceNoted: true, alreadyLinked: false });
    const notes = Object.fromEntries((await sql`select session_date::text d, note from public.attendance_records where class_id=${T_CLASS} and student_id=${MAKEUP_STU}`).map(r => [r.d, r.note]));
    assert.deepEqual(notes, { [absent]: '10/27 보강 예정', [day]: '10/20 결석분 보강' });
    assert.deepEqual(await run(sql, 'noteMakeupAgainstAbsence', T_ACTOR, link), { ok: true, absenceNoted: true, alreadyLinked: true });
    const logs = await sql`select actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${TENANT} and action='attendance_makeup_link' and metadata->>'studentId'=${MAKEUP_STU} and metadata->>'via'='3.0 연습 복사본'`;
    assert.equal(logs.length, 1, '붙인 칸이 있을 때만 감사');
    assert.deepEqual([logs[0].actor_id, logs[0].metadata.memoOnly, logs[0].metadata.absenceNoted, logs[0].metadata.absentDate], [T_ACTOR, true, true, absent]);
    assert.deepEqual(await run(sql, 'noteMakeupAgainstAbsence', T_ACTOR, { ...link, absentDate: day }), { error: '결석한 날과 보강한 날이 같습니다' });
    // 강사 보강 기한(결석한 달의 다음 달 말일) — 8월 결석을 10월에 잇지 못한다.
    assert.match((await run(sql, 'noteMakeupAgainstAbsence', T_ACTOR, { ...link, absentDate: '2026-08-20' })).error, /보강/);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.attendance_records where student_id=${MAKEUP_STU}) rec`;
  assert.deepEqual([after[0].audits, after[0].rec], [before[0].audits, before[0].rec], '되돌렸다');
});

test('복사본: 반 계획 보기(/ecs/goals) = 2.0 GoalsBoardResult 칸 그대로 · 반 = 그 주에 도는 인재원 영어 반(독립 SQL, 반 목록과 같은 수) · 강사는 담당 반만', { skip: !db && 'local database not running' }, async () => {
  const gb = await src('features/class-sheets/server/goals-board.ts');
  const okKeys = (() => { const t = gb.replace(/\r\n/g, '\n'), i = t.indexOf('export type GoalsBoardResult'), j = t.indexOf('| {', i) + 3, k = t.indexOf('}\n  | { ok: false', j); return keysAtTop(t.slice(j, k)); })();
  const g = (await load({ v2path: '/ecs/goals', date: '2026-10-27' })).goals;
  assert.equal(g.res.ok, true); sameShape(g.res, okKeys, 'GoalsBoardResult');
  for (const r of g.res.rows) { sameShape(r, typeKeys(gb, 'GoalsBoardRow'), 'GoalsBoardRow'); for (const c of r.cells) sameShape(c, typeKeys(gb, 'GoalsBoardCell'), 'GoalsBoardCell'); }
  assert.deepEqual([g.res.date, g.res.weekMonday, g.res.monthStart], ['2026-10-27', '2026-10-26', '2026-10-01']);
  const landing = (await load({ week: '2026-10-26' })).landing.res;
  assert.equal(g.res.rows.length, landing.trackCounts.injaewon, "반 목록의 '인재원 영어 N'과 같은 반 수");
  const [{ n }] = await db`select count(distinct c.id)::int n from public.classes c join public.class_schedules s on s.class_id=c.id
    cross join generate_series('2026-10-26'::date, '2026-11-01'::date, '1 day') d(day)
    where c.tenant_id=${TENANT} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= '2026-10-26') and coalesce(c.english_track, '') <> 'eie'
      and s.day_of_week::text = lower(to_char(d.day, 'dy')) and s.valid_from <= d.day and (s.valid_to is null or s.valid_to >= d.day)`;
  assert.equal(g.res.rows.length, n, '그 주에 도는 인재원 영어 반(독립 SQL)');
  assert.equal(g.res.areas.length, 6); assert.ok(g.res.rows.every(r => r.cells.length === 6));
  // 주간 목표가 있는 칸의 상태 = 2.0 goalCellStateOf(독립: 같은 반·영역의 담임 주간 목표 행이 있으면 'none'이 아니면서 'weekEmpty'도 아니다).
  const weekGoals = new Set((await db`select class_id::text || '|' || skill_area k from public.class_sheet_goals where tenant_id=${TENANT} and scope='week' and role = any(${g.res.role === 'all' ? ['homeroom', 'assistant'] : [g.res.role]}::text[]) and period_start='2026-10-26'
    and (coalesce(btrim(textbook), '') <> '' or coalesce(btrim(target_progress), '') <> '')`).map(r => r.k));
  for (const r of g.res.rows) for (const c of r.cells) if (c.state === 'same' || c.state === 'diff') assert.ok(weekGoals.has(`${r.classId}|${c.area}`), `${r.className} ${c.area}`);
  const [t] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and c.subject='english' and c.is_active group by u.id order by count(*) desc limit 1`;
  const tg = (await load({ v2path: '/ecs/goals', date: '2026-10-27', viewer: t.id })).goals.res;
  assert.ok(tg.ok && tg.rows.length > 0 && tg.rows.length < g.res.rows.length, '강사는 담당 반만');
});

test('복사본(되돌림): 반 계획 보기 보기 설정(setMyEcsGoalsRole · setMyEcsGoalsView) = 그 사람 ui_prefs.ecs만 · 기본값이면 키를 지움', { skip: !db && 'local database not running' }, async () => {
  await inRollback(async ({ sql, run }) => {
    const prefs = async () => (await sql`select ui_prefs from public.users where id=${T_ACTOR}`)[0].ui_prefs ?? {};
    const p0 = await prefs();
    assert.deepEqual(await run(sql, 'setMyEcsGoalsRole', T_ACTOR, 'all'), { ok: true });
    assert.deepEqual(await run(sql, 'setMyEcsGoalsView', T_ACTOR, 'week'), { ok: true });
    const p1 = await prefs();
    assert.deepEqual([p1.ecs.goalsRole, p1.ecs.goalsView], ['all', 'week']);
    for (const k of Object.keys(p0).filter(k => k !== 'ecs')) assert.deepEqual(p1[k], p0[k], `형제 키 ${k}`);
    const g = (await sql.savepoint(s => screen.load({ sql: s, params: { v2path: '/ecs/goals', date: '2026-10-27', viewer: T_ACTOR }, tenantId: TENANT, importV2 }))).goals.res;
    assert.deepEqual([g.role, g.view], ['all', 'week'], '저장한 보기로 다시 그린다');
    assert.deepEqual(await run(sql, 'setMyEcsGoalsRole', T_ACTOR, 'boss'), { ok: false, error: '잘못된 값입니다' });
    await run(sql, 'setMyEcsGoalsRole', T_ACTOR, 'homeroom'); await run(sql, 'setMyEcsGoalsView', T_ACTOR, 'day');
    const p2 = await prefs();
    assert.ok(!('goalsRole' in (p2.ecs ?? {})) && !('goalsView' in (p2.ecs ?? {})), '기본값이면 키를 지운다');
  });
});

test('복사본: 계획 대비 현황(/ecs/plan-gap) = 2.0 PlanGapResult 칸 그대로 · 배정 반 수(독립 SQL) · 원래 계획 칸 = 한 반 조회와 같다 · 칸 판정 = [계획 비교] 답', { skip: !db && 'local database not running' }, async () => {
  const pg = await src('features/textbooks/server/plan-gap.ts');
  const okKeys = (() => { const t = pg.replace(/\r\n/g, '\n'), i = t.indexOf('export type PlanGapResult'), j = t.indexOf('| {', i) + 3, k = t.indexOf('}\n  | { ok: false', j); return keysAtTop(t.slice(j, k)); })();
  assert.match(pg, /export const UNKNOWN_TEACHER = "__unknown__";/);
  assert.match(await here('v2-host/src/ecs-page.tsx'), /const UNKNOWN_TEACHER = '__unknown__';/);
  const g = (await load({ v2path: '/ecs/plan-gap', month: '2026-10' })).gap;
  assert.equal(g.res.ok, true); sameShape(g.res, okKeys, 'PlanGapResult');
  for (const row of g.res.teachers) { sameShape(row, typeKeys(pg, 'PlanGapTeacherRow'), 'PlanGapTeacherRow'); for (const c of row.classes) sameShape(c, typeKeys(pg, 'PlanGapClassRow'), 'PlanGapClassRow'); }
  const [{ n }] = await db`select count(distinct class_id)::int n from public.class_textbook_plans where tenant_id=${TENANT} and is_active`;
  assert.equal(g.res.classCount, n, '배정이 있는 반 수(원장 = 스코프 없음)');
  const sum = k => g.res.teachers.reduce((s, r) => s + r.tally[k], 0);
  for (const k of ['due', 'match', 'behind', 'ahead', 'differ', 'unwritten']) assert.equal(g.res.total[k], sum(k), `합계 ${k}`);
  // 여러 반 한 번에 읽은 재료(planMaterials)와 한 반 조회(plannedLines — 월간 화면이 쓰는 것)가 같은 원래 계획을 낸다.
  const { planMaterials, planCellsOf } = await import('./v2-ecs-gap.mjs'), { plannedLines } = await import('./v2-ecs-props.mjs');
  const R = await C.loadRules(importV2);
  await db.begin('isolation level repeatable read read only', async sql => {
    const env = await C.readSettings(sql, TENANT, R);
    const [{ class_id: cid }] = await sql`select class_id::text class_id from public.class_textbook_plans where tenant_id=${TENANT} and is_active group by class_id order by count(*) desc limit 1`;
    const many = planCellsOf(R, await planMaterials(sql, TENANT, R, env, null, '2026-10-31'), cid, '2026-10-01', '2026-10-31');
    const one = await plannedLines(sql, TENANT, R, env, cid, '2026-10-01', '2026-10-31');
    assert.deepEqual(Object.keys(many.baselineByCell).sort(), Object.keys(one.baselineByCell).sort(), '원래 계획 칸');
    assert.deepEqual(many.lessonIndex, one.lessonIndex);
    // 칸 하나의 판정 = getSlotPlanCompare(같은 compareCell)의 답.
    const [owner] = await sql`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
    const key = Object.keys(many.baselineByCell).sort().find(k => k <= '2026-10-27|99');
    if (key) {
      const [date, slot] = key.split('|');
      const cmp = await screen.load({ sql, params: { read: 'compare', class: cid, date, slot, viewer: owner.id }, tenantId: TENANT, importV2 });
      const row = g.res.teachers.flatMap(x => x.classes).filter(c => c.classId === cid);
      const miss = row.flatMap(c => c.misses).find(m => m.date === date && m.slotStart === slot);
      if (cmp.compare.verdict === 'match' || cmp.compare.verdict === 'upcoming' || cmp.compare.verdict === 'noPlan') assert.equal(miss, undefined, `${key}: 어긋남 목록에 없다`);
      else assert.deepEqual(miss && [miss.verdict, miss.lag], [cmp.compare.verdict, cmp.compare.lag], `${key}: 같은 판정`);
    }
  });
  // 강사는 볼 수 있는 반만(스코프) — 원장보다 적거나 같다.
  const [t] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and c.subject='english' and c.is_active group by u.id order by count(*) desc limit 1`;
  const tg = (await load({ v2path: '/ecs/plan-gap', month: '2026-10', viewer: t.id })).gap.res;
  assert.ok(tg.ok && tg.classCount <= g.res.classCount);
});

test('복사본: JJ실 면(?view=room) = 2.0 SeatDayData 칸 그대로 · 그 날 JJ 자리 교시가 있는 영어 반(독립 SQL) · 강사는 담당 반만', { skip: !db && 'local database not running' }, async () => {
  const types = await src('features/class-sheets/server/seat-day-types.ts'), R = await C.loadRules(importV2), day = '2026-10-27';
  const room = (await load({ view: 'room', date: day })).room.res;
  assert.equal(room.ok, true); sameShape(room.data, typeKeys(types, 'SeatDayData'), 'SeatDayData');
  for (const p of room.data.periods) { sameShape(p, typeKeys(types, 'SeatDayPeriod'), 'SeatDayPeriod'); for (const s of p.students) sameShape(s, typeKeys(types, 'SeatDayStudent'), 'SeatDayStudent'); }
  assert.ok(room.data.periods.length > 0, '10/27(화)은 JJ 교시가 있다');
  const live = await db`select s.class_id::text class_id, s.slot_teacher_label lbl, to_char(s.start_time, 'HH24:MI') st from public.class_schedules s join public.classes c on c.id=s.class_id
    where s.tenant_id=${TENANT} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= ${day}) and s.day_of_week::text = 'tue' and s.valid_from <= ${day} and (s.valid_to is null or s.valid_to >= ${day})`;
  const jj = live.filter(r => R.specialSlotLabel(r.lbl) === 'JJ');
  assert.deepEqual([...new Set(room.data.periods.map(p => p.slotStart))].sort(), [...new Set(jj.map(r => r.st))].sort(), 'JJ 타임 = 그 날 JJ 자리 교시 시작시각');
  const shownClasses = new Set(room.data.periods.flatMap(p => p.students.map(s => s.classId)));
  for (const id of shownClasses) assert.ok(jj.some(r => r.class_id === id), '학생은 JJ 교시가 있는 반에서만');
  assert.equal(room.data.canWriteEcs, true); assert.ok(room.data.periods.every(p => p.students.every(s => s.canMarkAttendance === s.eligible || !s.eligible)), '원장 = 7일 창 없음');
  const [t] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and c.subject='english' and c.is_active group by u.id order by count(*) desc limit 1`;
  const tr = (await load({ view: 'room', date: day, viewer: t.id })).room.res;
  const scope = (await import('./v2-ecs-props.mjs')).visibleClassFilter;
  await db.begin('isolation level repeatable read read only', async sql => {
    const env = await C.readSettings(sql, TENANT, R), viewer = (await C.readViewers(sql, TENANT, R, env)).find(v => v.id === t.id);
    const vis = new Set((await scope(sql, TENANT, R, viewer, null, day)).classIds);
    for (const p of tr.data.periods) for (const s of p.students) assert.ok(vis.has(s.classId), '강사는 볼 수 있는 반만');
  });
});

test('JJ 보고서 담당(학원 설정 specialAccess.jjReportManagerIds) — 그 날 JJ 자리 교시가 있는 반을 맡는다(2.0 getTeachingClassIds) · 출결 쓰기 게이트도 같은 갈래', { skip: !db && 'local database not running' }, async () => {
  const R = await C.loadRules(importV2), { teachesOn } = await import('./v2-ecs-save.mjs'), day = '2026-10-27';
  await db.begin('isolation level repeatable read read only', async sql => {
    const env = await C.readSettings(sql, TENANT, R), ids = env.permissions?.specialAccess?.jjReportManagerIds ?? [];
    assert.ok(ids.length > 0, '복사본에 JJ 담당이 있다');
    const managed = await C.jjManagedClassIds(sql, TENANT, R, env, ids[0], day);
    const [{ n }] = await sql`select count(distinct class_id)::int n from public.class_schedules where tenant_id=${TENANT} and day_of_week::text='tue' and teacher_id is null and slot_teacher_label is not null
      and valid_from <= ${day} and (valid_to is null or valid_to >= ${day}) and upper(btrim(slot_teacher_label)) like 'JJ%'`;
    assert.ok(managed.length > 0 && managed.length <= n, `${managed.length} / ${n}`);
    const [{ id: other }] = await sql`select id::text id from public.users where tenant_id=${TENANT} and status='active' and system_role='teacher' and not (id = any(${ids}::uuid[])) limit 1`;
    assert.deepEqual(await C.jjManagedClassIds(sql, TENANT, R, env, other, day), [], '명단에 없으면 []');
    const cid = managed[0], [{ own }] = await sql`select (exists (select 1 from public.classes where id=${cid} and teacher_id=${ids[0]}) or exists (select 1 from public.class_schedules where class_id=${cid} and teacher_id=${ids[0]})) own`;
    if (!own) {
      assert.equal(await teachesOn(sql, TENANT, ids[0], cid, day, { R, env }), true, 'JJ 담당 갈래로 그 반을 맡는다');
      assert.equal(await teachesOn(sql, TENANT, ids[0], cid, day, { R, env: { ...env, permissions: { ...env.permissions, specialAccess: {} } } }), false, '명단에서 빼면 못 맡는다');
    }
  });
});

test('복사본: 교재 배정 창의 읽기 셋(GET ?read=slotChoices · textbookPlans · assignable) = 2.0 반환 모양 · 독립 SQL과 같은 행', { skip: !db && 'local database not running' }, async () => {
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  const R = await C.loadRules(importV2), types = await src('features/textbooks/types.ts');
  // 교시 고르기 — 오늘 도는 (시각, 담당) 칩, LAB 제외, 시각 순.
  const sc = await load({ read: 'slotChoices', class: INJAEWON, viewer: owner.id });
  assert.equal(sc.ok, true);
  for (const r of sc.rows) sameShape(r, typeKeys(types, 'ClassSlotChoice'), 'ClassSlotChoice');
  const today = await C.copyDay();
  const live = await db`select distinct to_char(start_time, 'HH24:MI') || '|' || coalesce(slot_teacher_label, '') k, slot_teacher_label lbl from public.class_schedules
    where tenant_id=${TENANT} and class_id=${INJAEWON} and valid_from <= ${today} and (valid_to is null or valid_to >= ${today})`;
  assert.deepEqual(sc.rows.map(r => r.key).sort(), live.filter(r => R.specialSlotLabel(r.lbl) !== 'LAB').map(r => r.k).sort());
  assert.deepEqual(sc.rows.map(r => r.start), [...sc.rows.map(r => r.start)].sort(), '시각 순');
  assert.ok(sc.rows.every(r => r.picks.length === r.dows.length && r.picks.every(p => typeof p === 'string')));
  // 반의 배정 — 시작일 늦은 것 먼저, 2.0 ClassTextbookPlanRow 칸.
  const [{ class_id: cid, n }] = await db`select class_id::text class_id, count(*)::int n from public.class_textbook_plans where tenant_id=${TENANT} and is_active group by class_id order by count(*) desc limit 1`;
  const tp = await load({ read: 'textbookPlans', class: cid, viewer: owner.id });
  assert.equal(tp.ok, true); assert.equal(tp.rows.length, n);
  for (const r of tp.rows) sameShape(r, typeKeys(types, 'ClassTextbookPlanRow'), 'ClassTextbookPlanRow');
  assert.deepEqual(tp.rows.map(r => r.startDate), [...tp.rows.map(r => r.startDate)].sort().reverse());
  // 배정할 교재 — 영어 · 차수 ≥ 1 · 구분 있음.
  const as = await load({ read: 'assignable', viewer: owner.id });
  const [{ m }] = await db`select count(*)::int m from public.textbooks where tenant_id=${TENANT} and subject='english' and session_count >= 1 and skill_area is not null`;
  assert.equal(as.ok, true); assert.equal(as.rows.length, Math.min(m, 500));
  // 강사 — 남의 반이면 2.0 게이트 문구, 교재목록 메뉴 권한이 없으면 거절.
  assert.deepEqual(await load({ read: 'slotChoices', class: MATH, viewer: T_ACTOR }), { ok: false, error: '담당 반이 아닙니다' });
});

test('복사본(되돌림): 교재 배정 미리보기(previewTextbookFill) = 2.0 ApplyPreview 칸 · 실제 배정의 입력이면 그 배정의 원래 계획(expandPlans)과 같은 날짜·교시·차수 · 저장 없음', { skip: !db && 'local database not running' }, async () => {
  const types = await src('features/textbooks/types.ts'), R = await C.loadRules(importV2), { plannedLines } = await import('./v2-ecs-props.mjs');
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  // 그 반에 배정이 하나뿐인(같은 교재가 겹치지 않는) 고른-교시 배정.
  const [p] = await db`select p.id::text id, p.class_id::text class_id, p.textbook_id::text textbook_id, p.pace, p.term_mode, p.start_date::text start_date, p.start_lesson_no, p.slot_picks, b.title
    from public.class_textbook_plans p join public.textbooks b on b.id=p.textbook_id
    where p.tenant_id=${TENANT} and p.is_active and p.slot_picks is not null and array_length(p.slot_picks, 1) > 0
      and (select count(*) from public.class_textbook_plans q where q.class_id=p.class_id and q.is_active) = 1 order by p.created_at limit 1`;
  assert.ok(p, '비교할 배정');
  await inRollback(async ({ sql, run }) => {
    const before = await sql`select count(*)::int n from public.class_sheet_plan_lines where class_id=${p.class_id}`;
    const input = { classId: p.class_id, textbookId: p.textbook_id, slotPicks: p.slot_picks, pace: p.pace, termMode: p.term_mode, startDate: p.start_date, startLessonNo: p.start_lesson_no };
    const res = await run(sql, 'previewTextbookFill', owner.id, input);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    sameShape(res.preview, typeKeys(types, 'ApplyPreview'), 'ApplyPreview');
    for (const r of res.preview.rows) sameShape(r, typeKeys(types, 'ApplyPreviewRow'), 'ApplyPreviewRow');
    assert.equal(res.preview.textbookTitle, p.title);
    const today = await C.copyDay();
    assert.ok(res.preview.rows.every(r => (r.date < today) === (r.outcome === 'skip-past')), '지난 날짜 = skip-past');
    const last = res.preview.rows.at(-1)?.date ?? p.start_date, env = await C.readSettings(sql, TENANT, R);
    const base = await plannedLines(sql, TENANT, R, env, p.class_id, p.start_date, last);
    const fromPlan = Object.entries(base.baselineByCell).flatMap(([k, lines]) => lines.filter(l => l.title === p.title).map(l => `${k}|${l.lessonNo}`)).sort();
    assert.deepEqual(res.preview.rows.map(r => `${r.date}|${r.slotStart}|${r.lessonNo}`).sort(), fromPlan, '미리보기 = 그 배정의 원래 계획(두 2.0 함수가 같은 칸)');
    assert.deepEqual(await run(sql, 'previewTextbookFill', owner.id, { ...input, slotPicks: [] }), { ok: false, error: '교시를 하나 이상 골라 주세요' });
    assert.deepEqual(await run(sql, 'previewTextbookFill', owner.id, { ...input, startDate: 'x' }), { ok: false, error: '시작일을 골라 주세요' });
    assert.deepEqual(await run(sql, 'previewTextbookFill', T_ACTOR, input), { ok: false, error: '담당 반이 아닙니다' });
    assert.equal((await sql`select count(*)::int n from public.class_sheet_plan_lines where class_id=${p.class_id}`)[0].n, before[0].n, '저장 없음');
  });
});

test('복사본(되돌림): 교재 배정 기입(applyTextbookFill) = 배정 저장 + 미리보기가 말한 칸만 실제에 + 되돌리기 기록 + 2.0 감사로그 · 다시 누르면 배정 갱신·빈 칸 0', { skip: !db && 'local database not running' }, async () => {
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_textbook_plans) plans`;
  await inRollback(async ({ sql, run }) => {
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`; // 시험용(되돌림): 테스트 반 수업을 기준일 뒤로
    const R = await C.loadRules(importV2), env = await C.readSettings(sql, TENANT, R), viewer = (await C.readViewers(sql, TENANT, R, env)).find(v => v.id === owner.id), today = await C.copyDay();
    const { readSlotChoices } = await import('./v2-ecs-textbooks.mjs');
    const chips = await readSlotChoices({ sql, t: TENANT, R, env, user: viewer, today }, T_CLASS);
    const chip = chips.rows.find(c => !c.seat);
    const [book] = await sql`select id::text id, title from public.textbooks where tenant_id=${TENANT} and subject='english' and session_count between 3 and 40 and skill_area is not null
      and not exists (select 1 from public.class_textbook_plans p where p.class_id=${T_CLASS} and p.textbook_id=textbooks.id) order by title limit 1`;
    const input = { classId: T_CLASS, textbookId: book.id, slotPicks: chip.picks, pace: 'period', termMode: 'regular', startDate: today, startLessonNo: 1 };
    const pv = await run(sql, 'previewTextbookFill', owner.id, input);
    assert.equal(pv.ok, true);
    const want = pv.preview.rows.filter(r => r.outcome === 'add' || r.outcome === 'fill').length;
    const res = await run(sql, 'applyTextbookFill', owner.id, input);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
    assert.deepEqual(Object.keys(res).sort(), ['importError', 'ok', 'result', 'undoBatchId']);
    assert.equal(res.importError, null);
    assert.equal(res.result.added + res.result.filled, want, '미리보기가 말한 칸 수 = 실제로 넣은 칸 수');
    assert.equal(res.result.planned, pv.preview.rows.filter(r => r.date >= today).length);
    const [plan] = await sql`select id::text id, slot_picks, start_date::text start_date, created_by::text created_by from public.class_textbook_plans where class_id=${T_CLASS} and textbook_id=${book.id} and is_active`;
    assert.ok(plan && plan.start_date === today && plan.created_by === owner.id && plan.slot_picks.length === chip.picks.length);
    const [{ n }] = await sql`select count(*)::int n from public.class_sheet_plan_lines where class_id=${T_CLASS} and textbook=${book.title} and plan_date >= ${today}`;
    assert.ok(n >= want, `실제 줄 ${n} ≥ ${want}`);
    const [batch] = await sql`select rows, row_count from public.class_plan_import_batches where id=${res.undoBatchId}`;
    assert.ok(batch && batch.rows[0].kind === 'plan' && batch.rows[0].planId === plan.id, '되돌리기 기록에 배정');
    const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${TENANT} and action in ('textbook_plan_create', 'textbook_plan_apply', 'textbook_plan_update') and metadata->>'via'='3.0 연습 복사본'`;
    assert.deepEqual(logs.map(l => l.action).sort(), ['textbook_plan_apply', 'textbook_plan_create']);
    assert.equal(logs.find(l => l.action === 'textbook_plan_apply').metadata.planId, plan.id);
    const again = await run(sql, 'applyTextbookFill', owner.id, input);
    assert.equal(again.ok, true); assert.equal(again.result.added + again.result.filled, 0, '이미 적은 칸은 덮지 않는다');
    assert.equal((await sql`select count(*)::int n from public.class_textbook_plans where class_id=${T_CLASS} and textbook_id=${book.id} and is_active`)[0].n, 1, '겹치는 교시 = 같은 배정 갱신');
    assert.ok((await sql`select 1 from public.audit_logs where action='textbook_plan_update' and metadata->>'id'=${plan.id}`).length === 1);
    assert.deepEqual(await run(sql, 'applyTextbookFill', T_ACTOR, { ...input, classId: MATH }), { ok: false, error: '담당 반이 아닙니다' });
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_textbook_plans) plans`;
  assert.deepEqual([after[0].audits, after[0].plans], [before[0].audits, before[0].plans], '되돌렸다');
});

test('교재 지우기·되돌리기: 옮긴 검사 본문(validLine · validToken · validPlan)이 2.0 원문과 같다', async () => {
  const ts = (await import('typescript')).default;
  const body = (text, name) => { const t = text.replace(/\r\n/g, '\n'), i = t.search(new RegExp(`(?:export )?function ${name}\\(`)), end = t.indexOf('\n}\n', i); return t.slice(t.indexOf('function', i), end + 2); };
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/'/g, '"').replace(/\(\(?(l\.line_no|r\.start_lesson_no)\)?\)/g, '$1');
  const mine = await here('./v2-ecs-plan-undo.mjs'), core = await src('features/textbooks/server/shift-undo-core.ts'), del = await src('features/textbooks/server/plan-delete-actions.ts');
  for (const n of ['validLine', 'validToken']) assert.equal(norm(body(mine, n)), norm(body(core, n)), n);
  assert.equal(norm(body(mine, 'validPlan')), norm(body(del, 'validPlan')), 'validPlan');
});

test('복사본(되돌림): 기입 → [실행 취소](undoPlanImport) = 넣은 칸·배정이 사라짐 · 기입 → 배정 삭제(withLines) → 되돌리기(undoPlanDelete) = 배정·줄이 돌아옴 · 2.0 감사로그', { skip: !db && 'local database not running' }, async () => {
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_textbook_plans) plans`;
  await inRollback(async ({ sql, run }) => {
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    const R = await C.loadRules(importV2), env = await C.readSettings(sql, TENANT, R), viewer = (await C.readViewers(sql, TENANT, R, env)).find(v => v.id === owner.id), today = await C.copyDay();
    const { readSlotChoices } = await import('./v2-ecs-textbooks.mjs');
    const chip = (await readSlotChoices({ sql, t: TENANT, R, env, user: viewer, today }, T_CLASS)).rows.find(c => !c.seat);
    const [book] = await sql`select id::text id, title from public.textbooks where tenant_id=${TENANT} and subject='english' and session_count between 3 and 40 and skill_area is not null
      and not exists (select 1 from public.class_textbook_plans p where p.class_id=${T_CLASS} and p.textbook_id=textbooks.id) order by title limit 1`;
    const input = { classId: T_CLASS, textbookId: book.id, slotPicks: chip.picks, pace: 'period', termMode: 'regular', startDate: today, startLessonNo: 1 };
    const lines = async () => (await sql`select count(*)::int n from public.class_sheet_plan_lines where class_id=${T_CLASS} and textbook=${book.title}`)[0].n;
    const plans = async () => (await sql`select count(*)::int n from public.class_textbook_plans where class_id=${T_CLASS} and textbook_id=${book.id}`)[0].n;
    const l0 = await lines();
    // ① 기입 → 실행 취소
    const a1 = await run(sql, 'applyTextbookFill', owner.id, input);
    assert.ok(a1.ok && a1.undoBatchId && (await lines()) > l0);
    const u1 = await run(sql, 'undoPlanImport', owner.id, { classId: T_CLASS, batchId: a1.undoBatchId, latestOnly: true });
    assert.deepEqual(Object.keys(u1).sort(), ['batches', 'kept', 'ok', 'others', 'plansRemoved', 'restored']);
    assert.equal(u1.ok, true); assert.equal(u1.plansRemoved, 1); assert.equal(u1.batches, 1);
    assert.equal(await lines(), l0, '넣은 칸이 사라졌다'); assert.equal(await plans(), 0, '배정도 지웠다');
    assert.ok((await sql`select undone_at from public.class_plan_import_batches where id=${a1.undoBatchId}`)[0].undone_at, '되돌린 반영');
    assert.deepEqual(await run(sql, 'undoPlanImport', owner.id, { classId: T_CLASS, batchId: a1.undoBatchId }), { ok: false, error: '되돌릴 수 있는 반영이 아닙니다 — 이미 되돌렸거나 최근 5건 밖입니다' });
    // ② 기입 → 배정 삭제(진도 줄까지) → 되돌리기
    const a2 = await run(sql, 'applyTextbookFill', owner.id, input);
    const [plan] = await sql`select id::text id from public.class_textbook_plans where class_id=${T_CLASS} and textbook_id=${book.id} and is_active`;
    const n2 = await lines();
    const d = await run(sql, 'deleteClassTextbookPlan', owner.id, plan.id, { withLines: true });
    assert.equal(d.ok, true, JSON.stringify(d).slice(0, 200));
    assert.ok(d.cleared && d.cleared.lines > 0 && d.undo?.plan?.id === plan.id && d.undo.lines && d.historyId, JSON.stringify({ cleared: d.cleared, history: d.historyId }));
    assert.equal(await plans(), 0); assert.equal(await lines(), n2 - d.cleared.lines);
    const ud = await run(sql, 'undoPlanDelete', owner.id, { classId: T_CLASS, plan: d.undo.plan, lines: d.undo.lines, historyId: d.historyId });
    assert.deepEqual(ud, { ok: true, warning: undefined });
    assert.equal(await plans(), 1, '배정이 같은 id로 돌아옴'); assert.equal(await lines(), n2, '지운 줄이 돌아옴');
    assert.deepEqual(await run(sql, 'undoPlanDelete', owner.id, { classId: T_CLASS, plan: d.undo.plan, lines: d.undo.lines, historyId: d.historyId }), { ok: false, error: '이미 되돌렸습니다' });
    assert.deepEqual(await run(sql, 'undoPlanDelete', owner.id, { classId: T_CLASS, plan: { ...d.undo.plan, pace: 'x' } }), { ok: false, error: '되돌릴 기록이 올바르지 않습니다' });
    const acts = (await sql`select action from public.audit_logs where tenant_id=${TENANT} and metadata->>'via'='3.0 연습 복사본' and action like 'textbook_%'`).map(r => r.action).sort();
    for (const a of ['textbook_plan_apply', 'textbook_plan_create', 'textbook_plan_delete', 'textbook_plan_delete_undo', 'textbook_plan_import_undo']) assert.ok(acts.includes(a), a);
    assert.equal(a2.ok, true);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_textbook_plans) plans`;
  assert.deepEqual([after[0].audits, after[0].plans], [before[0].audits, before[0].plans], '되돌렸다');
});

test('복사본: 단어 수 가져오기(pullEcsMemorizedWords) = 바깥 연동이라 2.0 게이트 뒤 늘 거절 · 쓰기 없음', { skip: !db && 'local database not running' }, async () => {
  await inRollback(async ({ sql, run }) => {
    const n = async () => (await sql`select count(*)::int n from public.class_sheet_student_marks where class_id=${T_CLASS}`)[0].n, n0 = await n();
    assert.deepEqual(await run(sql, 'pullEcsMemorizedWords', T_ACTOR, { classId: T_CLASS, date: '2026-09-22', slotStart: '7:15' }), { ok: false, error: '잘못된 요청입니다(날짜/교시)' });
    assert.deepEqual(await run(sql, 'pullEcsMemorizedWords', T_ACTOR, { classId: MATH, date: '2026-09-22', slotStart: '17:15' }), { ok: false, error: '담당 반이 아닙니다' });
    const r = await run(sql, 'pullEcsMemorizedWords', T_ACTOR, { classId: T_CLASS, date: '2026-09-22', slotStart: '17:15' });
    assert.equal(r.ok, false); assert.match(r.error, /연습 화면에서 부르지 않습니다/);
    assert.equal(await n(), n0);
  });
});

// ── ⑦ 오늘 면 — 2.0 ecs/page.tsx face === "today"(getEcsToday + 시트 모드면 반마다 getClassSheetWeek → EcsTodayFace props) ──
const TODAY_DAY = '2026-10-27'; // 복사본 기준일(화)
const todayOkKeys = text => { const i = text.indexOf('export type EcsTodayResult'), j = text.indexOf('| {', i) + 3, k = text.indexOf('}\n  | { ok: false', j); return keysAtTop(text.slice(j, k)); };
const topEnglishTeacher = async () => (await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and c.subject='english' and c.is_active group by u.id order by count(*) desc limit 1`)[0].id;
/** 독립 SQL — 그 강사가 볼 수 있는 영어 반(담임 ∪ 교시 담당(전 기간) ∪ 기준일 ±7일 위임)의 그 날 살아 있는 배치(#88). */
const liveTodaySlots = (t, day) => db`select c.id::text class_id, c.teacher_id::text homeroom, to_char(s.start_time, 'HH24:MI') st, s.slot_teacher_label lbl, s.teacher_id::text slot_teacher
  from public.classes c join public.class_schedules s on s.class_id=c.id
  where c.tenant_id=${TENANT} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= ${day}::date)
    and (c.teacher_id=${t} or exists (select 1 from public.class_schedules a where a.class_id=c.id and a.teacher_id=${t})
      or exists (select 1 from public.class_delegations g where g.class_id=c.id and g.delegate_user_id=${t} and g.revoked_at is null and g.from_date <= ${TODAY_DAY}::date + 7 and g.to_date >= ${TODAY_DAY}::date - 7))
    and s.day_of_week::text = lower(to_char(${day}::date, 'dy')) and s.valid_from <= ${day}::date and (s.valid_to is null or s.valid_to >= ${day}::date)`;

test('복사본: 오늘 면(강사 · 시트 기본) = 2.0 EcsTodayFace props · EcsTodayResult · TodayClassCard · TodaySlot · TodayStudent · TodayPlanLine 칸 그대로 · 카드·교시·명단·출결·작성률 = 독립 SQL', { skip: !db && 'local database not running' }, async () => {
  const text = (await src('features/class-sheets/server/today.ts')).replace(/\r\n/g, '\n'), R = await C.loadRules(importV2), t = await topEnglishTeacher();
  const d = await load({ viewer: t, date: TODAY_DAY });
  assert.equal(d.route, 'today'); assert.equal(d.scoped, true, '선생님 = 강사 스코프 → 오늘 면이 기본');
  assert.deepEqual(Object.keys(d.today).sort(), ['canReorder', 'mode', 'myTeacherId', 'res', 'sheets', 'textbookOptions'], '2.0 EcsTodayFace props(scoped·lang은 화면 공통)');
  const { res } = d.today;
  assert.equal(res.ok, true); sameShape(res, todayOkKeys(text), 'EcsTodayResult');
  assert.deepEqual([res.date, res.today, res.weekMonday, d.today.mode, d.today.myTeacherId, d.today.canReorder], [TODAY_DAY, TODAY_DAY, '2026-10-26', 'sheet', t, true]);
  assert.ok(res.canWrite && res.hasAnyClass && res.userId === t && res.tenantId === TENANT && res.holidayName === null && Array.isArray(res.todayOrder));
  assert.ok(Array.isArray(d.today.textbookOptions) && d.today.textbookOptions.length > 0, '계획 칸 교재 제안(loadEcsTextbookOptions)');
  for (const c of res.cards) {
    sameShape(c, typeKeys(text, 'TodayClassCard'), 'TodayClassCard');
    for (const s of c.slots) { sameShape(s, typeKeys(text, 'TodaySlot'), 'TodaySlot'); for (const l of s.lines) sameShape(l, typeKeys(text, 'TodayPlanLine'), 'TodayPlanLine'); }
    for (const s of c.students) sameShape(s, typeKeys(text, 'TodayStudent'), 'TodayStudent');
  }
  // 카드 = 그 날 보이는 교시가 있는 반(자리 LAB·숨긴 JJ 제외 — 2.0 hiddenSeatOf) · 교시 = 그 날 살아 있는 배치(시각순).
  const [{ ui_prefs: prefs }] = await db`select ui_prefs from public.users where id=${t}`;
  const live = (await liveTodaySlots(t, TODAY_DAY)).filter(r => !R.hiddenSeatOf(r.lbl, R.readEcsShowSelfStudy(prefs)));
  const byClass = new Map(); for (const r of live) (byClass.get(r.class_id) ?? byClass.set(r.class_id, []).get(r.class_id)).push(r.st);
  assert.ok(res.cards.length > 1);
  assert.deepEqual(res.cards.map(c => c.classId).sort(), [...byClass.keys()].sort(), '카드 = 그 날 교시가 있는 볼 수 있는 반');
  for (const c of res.cards) {
    assert.deepEqual(c.slots.map(s => s.slotStart), byClass.get(c.classId).sort(), `${c.className}: 교시`);
    assert.deepEqual([c.startsAt, c.fill.total], [c.slots[0].slotStart, c.slots.length]);
  }
  const ids = res.cards.map(c => c.classId), keys = res.cards.flatMap(c => c.slots.map(s => `${c.classId}|${s.slotStart}`));
  const [{ filled }] = await db`select count(distinct (class_id, to_char(slot_start,'HH24:MI')))::int filled from public.class_sheet_plan_lines
    where tenant_id=${TENANT} and plan_date=${TODAY_DAY} and ecs_is_meaningful_line(textbook, page_range, progress, homework) and (class_id::text || '|' || to_char(slot_start,'HH24:MI')) = any(${keys})`;
  assert.equal(res.cards.reduce((n, c) => n + c.fill.filled, 0), filled, '작성률 분자 = 같은 DB 판정(ecs_is_meaningful_line)');
  // 명단 = 그 날 수강 대상(기간·보류·전출·퇴원 + 분리등원 요일 — 2.0 isEnrollmentActiveOn · enrollmentAttendsOnDay) · 보강 = 기록은 있는데 명단에 없는 학생.
  const enr = await db`select e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, s.withdrawn_at::text withdrawn_at
    from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${TENANT} and e.class_id = any(${ids}::uuid[]) and e.start_date <= ${TODAY_DAY} and (e.end_date is null or e.end_date >= ${TODAY_DAY})`;
  const att = await db`select class_id::text class_id, student_id::text student_id from public.attendance_records where tenant_id=${TENANT} and class_id = any(${ids}::uuid[]) and session_date=${TODAY_DAY}`;
  const anchored = await db`select makeup_class_id::text class_id, student_id::text student_id from public.lesson_reports where tenant_id=${TENANT} and makeup_class_id = any(${ids}::uuid[]) and makeup and report_date=${TODAY_DAY}`;
  const [{ resv }] = await db`select to_regclass('public.makeup_reservations') is not null resv`;
  const reserved = resv ? await db`select class_id::text class_id, student_id::text student_id from public.makeup_reservations where tenant_id=${TENANT} and class_id = any(${ids}::uuid[]) and makeup_date=${TODAY_DAY} and status='reserved'` : [];
  const hasAtt = new Set(att.map(r => `${r.class_id}|${r.student_id}`));
  for (const c of res.cards) {
    const roster = [...new Set(enr.filter(e => e.class_id === c.classId && !(e.withdrawn_at && e.withdrawn_at < TODAY_DAY)
      && R.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined }, TODAY_DAY)
      && R.enrollmentAttendsOnDay(e.attendance_days, 'tue')).map(e => e.student_id))];
    assert.deepEqual(c.students.filter(s => !s.isMakeup).map(s => s.studentId).sort(), roster.sort(), `${c.className}: 명단`);
    const recorded = [...att, ...anchored, ...reserved].filter(r => r.class_id === c.classId).map(r => r.student_id);
    assert.deepEqual(c.students.filter(s => s.isMakeup).map(s => s.studentId).sort(), [...new Set(recorded.filter(id => !roster.includes(id)))].sort(), `${c.className}: 보강 행`);
    for (const s of c.students) assert.equal(s.attendance !== null, hasAtt.has(`${c.classId}|${s.studentId}`), `${c.className} ${s.name}: 출결 표시 = 그 날 기록 유무`);
  }
  // 출결 잠금 = 2.0 게이트(출석 권한 · 선생님 7일 창 · 출석이 담당 범위면 담임 ∪ 그날 위임 ∪ JJ 담당 ∪ 그날 교시 담당) · 위임 표시 = 담임이 아닌 위임 반.
  await db.begin('isolation level repeatable read read only', async sql => {
    const env = await C.readSettings(sql, TENANT, R), viewer = (await C.readViewers(sql, TENANT, R, env)).find(v => v.id === t);
    const taught = new Set([
      ...(await sql`select id::text id from public.classes where tenant_id=${TENANT} and teacher_id=${t}
        union select class_id::text from public.class_delegations where tenant_id=${TENANT} and delegate_user_id=${t} and revoked_at is null and from_date <= ${TODAY_DAY} and to_date >= ${TODAY_DAY}
        union select class_id::text from public.class_schedules where tenant_id=${TENANT} and teacher_id=${t} and valid_from <= ${TODAY_DAY} and (valid_to is null or valid_to >= ${TODAY_DAY})`).map(r => r.id),
      ...await C.jjManagedClassIds(sql, TENANT, R, env, t, TODAY_DAY)]);
    const writable = C.canWriteLevel(viewer.levels.attendance) && R.isWithinAttendanceEditWindow(TODAY_DAY, TODAY_DAY);
    const deleg = new Set((await sql`select class_id::text id from public.class_delegations where tenant_id=${TENANT} and delegate_user_id=${t} and revoked_at is null
      and from_date <= ${TODAY_DAY}::date + 7 and to_date >= ${TODAY_DAY}::date - 7`).map(r => r.id));
    for (const c of res.cards) {
      assert.equal(c.canMarkAttendance, writable && (viewer.levels.attendance !== 'scoped' || taught.has(c.classId)), `${c.className}: 출결 잠금`);
      assert.equal(c.delegated, deleg.has(c.classId) && live.find(r => r.class_id === c.classId).homeroom !== t, `${c.className}: 위임 표시`);
    }
    assert.ok(res.cards.some(c => !c.canMarkAttendance) && res.cards.some(c => c.canMarkAttendance), '담당이 아닌 반은 출결이 잠기고 담당 반은 열린다(복사본 10/27)');
  });
  // 요약 카드 모드 = 같은 결과 · 반마다 시트는 만들지 않는다(2.0 mode === "sheet"일 때만 getClassSheetWeek).
  const cards = (await load({ viewer: t, date: TODAY_DAY, mode: 'cards' })).today;
  assert.equal(cards.mode, 'cards'); assert.equal(cards.sheets, null);
  assert.deepEqual(cards.res, res, '요약 카드도 같은 카드·같은 순서');
});

test('복사본: 오늘 면 시트 모드 = 반마다 2.0 ClassSheetWeekData(그 주) · 본인 교시만(2.0 selectSheetDaysFor — 교시 담당은 배치 FK 그대로) · 순서는 개인 순서가 이긴다', { skip: !db && 'local database not running' }, async () => {
  const queries = await src('features/class-sheets/server/queries.ts'), R = await C.loadRules(importV2), t = await topEnglishTeacher();
  const { res, sheets } = (await load({ viewer: t, date: TODAY_DAY })).today;
  assert.deepEqual(sheets.map(s => s.classId).sort(), res.cards.map(c => c.classId).sort(), '카드마다 시트 하나');
  for (const s of sheets) {
    assert.equal(s.res.ok, true, s.className); sameShape(s.res.data, typeKeys(queries, 'ClassSheetWeekData'), 'ClassSheetWeekData');
    assert.deepEqual([s.res.data.weekMonday, s.className], ['2026-10-26', res.cards.find(c => c.classId === s.classId).className]);
  }
  // 본인 교시 판정의 재료 = 그 날 배치 행의 교시 담당 FK(표시 라벨이 아니다 — today-own-slots 규칙 ③).
  const fk = new Map((await liveTodaySlots(t, TODAY_DAY)).map(r => [`${r.class_id}|${r.st}`, r.slot_teacher]));
  let hidden = 0;
  for (const s of sheets) {
    const day = s.res.data.grid.days.find(x => x.date === TODAY_DAY);
    for (const sl of day.slots) assert.equal(sl.teacherId ?? null, fk.get(`${s.classId}|${sl.slotStart}`) ?? null, `${s.className} ${sl.slotStart}: 교시 담당 FK`);
    const sel = R.selectSheetDaysFor(s.res.data, { variant: 'today', dayFilter: TODAY_DAY, myTeacherId: t });
    for (const h of sel.hiddenOwn) {
      const sl = day.slots.find(x => x.slotStart === h.slotStart);
      assert.ok(h.teacherId && h.teacherId !== t && !R.isSpecialSlotLabel(sl.teacherLabel) && sl.lines.length === 0, `${s.className} ${h.slotStart}: 숨긴 교시 = 남의 교시(자리·기록 없음)`);
      hidden++;
    }
    assert.equal(sel.todayDay.slots.length + sel.hiddenOwn.length, day.slots.length);
  }
  assert.ok(hidden > 0, '복사본 10/27 — 남이 맡은 교시를 실제로 숨긴다');
  // 개인 순서(ui_prefs.ecs.todayOrder)에 있는 반이 먼저, 그 순서대로 — 시트·요약 카드 둘 다(2.0 applyTodayOrder).
  const pos = new Map(res.todayOrder.map((id, i) => [id, i]));
  for (const list of [sheets.map(s => s.classId), res.cards.map(c => c.classId)]) {
    const ordered = list.filter(id => pos.has(id));
    assert.deepEqual(list.slice(0, ordered.length), ordered, '순서에 있는 반이 앞');
    assert.deepEqual(ordered, [...ordered].sort((a, b) => pos.get(a) - pos.get(b)), '저장한 순서대로');
  }
});

test('복사본: 오늘 면은 강사 스코프 전용 — 사무실은 ?view=today를 쳐도 주간 · 강사도 ?view=week면 주간 · ?view=today는 오늘 면', { skip: !db && 'local database not running' }, async () => {
  const t = await topEnglishTeacher();
  for (const p of [{}, { view: 'today' }, { view: 'today', date: TODAY_DAY, mode: 'cards' }]) {
    const office = await load(p);
    assert.deepEqual([office.route, office.scoped, office.today], ['landing', false, undefined], `사무실 ${JSON.stringify(p)}`);
  }
  const [admin] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='admin' and u.display_name is not null limit 1`;
  if (admin) { const a = await load({ viewer: admin.id, view: 'today' }); if (a.viewer?.id === admin.id) assert.equal(a.route, 'landing', '관리자도 스코프가 없으면 주간'); }
  assert.equal((await load({ viewer: t, view: 'week' })).route, 'landing');
  assert.equal((await load({ viewer: t, view: 'today' })).route, 'today');
  assert.equal((await load({ viewer: t, view: 'room' })).route, 'room', 'JJ실 면은 스코프와 무관');
});

test('복사본: 오늘 면 날짜 지정(테스트 반) = 그 날의 카드 · 휴일이면 이름만 알리고 카드는 그대로 · 수업 없는 날은 "반은 있는데 수업 없음" · 선생님 7일 창 밖이면 출결 잠금', { skip: !db && 'local database not running' }, async () => {
  const a = (await load({ viewer: T_ACTOR, date: '2026-09-17' })).today;
  assert.deepEqual([a.res.date, a.res.today, a.res.weekMonday, a.res.holidayName, a.myTeacherId], ['2026-09-17', TODAY_DAY, '2026-09-14', null, T_ACTOR]);
  assert.deepEqual(a.res.cards.map(c => c.classId), [T_CLASS]);
  const [card] = a.res.cards;
  assert.deepEqual(card.slots.map(s => [s.slotStart, s.slotEnd]), [['17:15', '18:10']]);
  assert.deepEqual(card.students.map(s => [s.studentId, s.name, s.isMakeup]), [[T_STU, '학원이', false]]);
  assert.equal(card.canMarkAttendance, false, '선생님은 7일 창 밖 날짜의 출결이 잠긴다(2.0 isWithinAttendanceEditWindow)');
  assert.deepEqual(a.sheets.map(s => [s.classId, s.res.ok, s.res.data.weekMonday]), [[T_CLASS, true, '2026-09-14']]);
  const [{ name }] = await db`select h->>'name' name from public.tenant_settings ts, jsonb_array_elements(ts.data->'operations'->'holidays') h where ts.tenant_id=${TENANT} and h->>'date'='2026-09-24'`;
  const hol = (await load({ viewer: T_ACTOR, date: '2026-09-24' })).today.res;
  assert.equal(hol.holidayName, name, '휴일 이름 = 학원 설정');
  assert.deepEqual(hol.cards.map(c => c.classId), [T_CLASS], '휴일이어도 카드·입력은 그대로');
  const none = (await load({ viewer: T_ACTOR })).today;
  assert.deepEqual([none.res.date, none.res.cards.length, none.res.hasAnyClass, none.sheets], [TODAY_DAY, 0, true, null], '반은 있는데 그 날 수업이 없다(빈 화면 문구가 원인별)');
});

test('복사본(되돌림): 오늘 면의 저장 = 주간 시트와 같은 액션(교시 칸 출결 · 학생 기록 · 지우기 · 반 순서)이 오늘 카드·시트에 그대로 · 요약 카드의 그날 전체 칸은 거절(쓰기 없음)', { skip: !db && 'local database not running' }, async () => {
  const R = await C.loadRules(importV2), t = await topEnglishTeacher();
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run }) => {
    const reload = params => sql.savepoint(s => screen.load({ sql: s, params, tenantId: TENANT, importV2 }));
    // 시험용으로만(되돌림): 테스트 반 수업·수강을 기준일까지 늘린다.
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    await sql`update public.enrollments set end_date=null where class_id=${T_CLASS} and student_id=${T_STU}`;
    await sql`delete from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${TODAY_DAY}`;
    await sql`delete from public.class_sheet_student_marks where class_id=${T_CLASS} and student_id=${T_STU} and mark_date=${TODAY_DAY}`;
    const stuOf = d => d.res.cards.find(c => c.classId === T_CLASS)?.students.find(s => s.studentId === T_STU);
    const d0 = (await reload({ viewer: T_ACTOR })).today;
    assert.equal(d0.res.cards.find(c => c.classId === T_CLASS).canMarkAttendance, true, '담임 · 7일 창 안');
    assert.equal(stuOf(d0).attendance, null);
    // 시트 모드(기본)의 출결 = 교시 칸(slotStart) · 학생 기록 = 교시별 — 주간 시트와 같은 액션.
    assert.equal((await run(sql, 'setAttendanceCell', T_ACTOR, { classId: T_CLASS, studentId: T_STU, sessionDate: TODAY_DAY, slotStart: '17:15', status: 'present' })).ok, true);
    assert.deepEqual(await run(sql, 'upsertStudentMark', T_ACTOR, { classId: T_CLASS, studentId: T_STU, markDate: TODAY_DAY, slotStart: '17:15', status: '좋음', progressNote: null }), { ok: true });
    const d1 = (await reload({ viewer: T_ACTOR })).today, s1 = stuOf(d1);
    assert.deepEqual([s1.attendance, s1.attendanceSlots, s1.marks['17:15']?.status], ['present', ['17:15:00'], '좋음'], '오늘 카드 = 방금 저장한 같은 행');
    const sheet = d1.sheets.find(s => s.classId === T_CLASS).res.data;
    assert.ok(Object.keys(sheet.attendanceByStudentDate).some(k => k.startsWith(`${T_STU}|${TODAY_DAY}`)) && Object.keys(sheet.marks).some(k => k.startsWith(`${T_STU}|${TODAY_DAY}`)), '오늘 시트도 같은 기록');
    // 요약 카드의 출결 드롭다운(그날 전체 칸 — slotStart 없음)은 연습 화면에서 받지 않는다 — 2.0 부품은 실패 모양으로 받고 칸을 되돌린다.
    const n = async () => (await sql`select count(*)::int n from public.attendance_records where class_id=${T_CLASS} and session_date=${TODAY_DAY}`)[0].n, n0 = await n();
    await assert.rejects(sql.savepoint(s => run(s, 'setAttendanceCell', T_ACTOR, { classId: T_CLASS, studentId: T_STU, sessionDate: TODAY_DAY, status: 'absent' })),
      e => e.status === 409 && /연습 화면에서 아직 지원하지 않습니다/.test(e.message));
    assert.equal(await n(), n0, '쓰기 없음');
    // '선택 안 함' = 화면이 보던 행의 교시 그대로(attendanceSlots — 2.0 TodayBoard clear).
    assert.deepEqual(await run(sql, 'clearPresentAttendance', T_ACTOR, { classId: T_CLASS, studentId: T_STU, date: TODAY_DAY, slot: s1.attendanceSlots[0] }), { ok: true, cleared: 1 });
    assert.equal(stuOf((await reload({ viewer: T_ACTOR })).today).attendance, null);
    // 반 순서(TodayOrderList → setMyEcsTodayOrder) — 그 사람 ui_prefs.ecs.todayOrder · 시트·요약 카드가 같은 순서로.
    await sql`update public.users set ui_prefs = ui_prefs #- '{ecs,todayOrder}' where id=${t}`;
    const a = (await reload({ viewer: t, date: TODAY_DAY })).today;
    assert.deepEqual(a.res.todayOrder, []);
    // 순서가 없으면 시트 = 보이는 첫 교시(2.0 firstVisibleTodaySlot) · 요약 카드 = 그 날 첫 교시(startsAt), 같으면 반 이름.
    const sorted = (list, key) => list.every((x, i) => i === 0 || key(list[i - 1]) < key(x) || (key(list[i - 1]) === key(x) && list[i - 1].className.localeCompare(x.className, 'ko') <= 0));
    assert.ok(sorted(a.sheets, s => R.firstVisibleTodaySlot(s.res.data, { date: TODAY_DAY, myTeacherId: t }) ?? '99:99'), '시트 = 보이는 첫 교시 순');
    assert.ok(sorted(a.res.cards, c => c.startsAt), '요약 카드 = 첫 교시 순');
    const want = a.sheets.map(s => s.classId).reverse();
    assert.deepEqual(await run(sql, 'setMyEcsTodayOrder', t, want), { ok: true });
    assert.deepEqual((await sql`select ui_prefs from public.users where id=${t}`)[0].ui_prefs.ecs.todayOrder, want);
    const b = (await reload({ viewer: t, date: TODAY_DAY })).today;
    assert.deepEqual([b.sheets.map(s => s.classId), b.res.cards.map(c => c.classId)], [want, want], '시트·요약 카드 = 저장한 순서');
    assert.deepEqual((await reload({ viewer: t, date: TODAY_DAY, mode: 'cards' })).today.res.cards.map(c => c.classId), want, '보기를 바꿔도 같은 순서');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, '되돌렸다');
});

// ── ⑧ 회차 미룸·당김 — 2.0 plan-actions.ts setLessonShift(shift-lines · shift-relay · shift-snapshot) ──
const shiftOkKeys = text => { const i = text.indexOf('export type LessonShiftResult'), j = text.indexOf('| {', i) + 3, k = text.indexOf('\n    }\n', j); return keysAtTop(text.slice(j, k)); };
const SHIFT_FAIL_KEYS = ['error', 'historyId', 'ok', 'undo'];

test('복사본(되돌림): 회차 미룸·당김(setLessonShift) — 배정이 안 지나가는 칸 = 같은 요일·교시끼리 한 주씩(2.0 planLessonShift: 미룸은 누른 칸이 빈다) + 칸 표식 순 횟수 · 2.0 LessonShiftResult 칸 · 미룸 → 되돌리기 = 원래대로 · 미룸 → 당김 = 원래대로 · 감사로그·히스토리 · 2.0 거절 문구', { skip: !db && 'local database not running' }, async () => {
  const text = (await src('features/textbooks/server/plan-actions.ts')).replace(/\r\n/g, '\n'), R = await C.loadRules(importV2), { validToken } = await import('./v2-ecs-plan-undo.mjs');
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_lesson_shifts) marks`;
  await inRollback(async ({ sql, run }) => {
    // 시험용으로만(되돌림): 테스트 반 수업을 기준일 뒤로 · 화요일 17:15 두 칸에 알아볼 진도.
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    await sql`update public.class_sheet_plan_lines set progress='A' where class_id=${T_CLASS} and plan_date='2026-10-13' and term_mode='regular'`;
    await sql`update public.class_sheet_plan_lines set progress='B' where class_id=${T_CLASS} and plan_date='2026-10-20' and term_mode='regular'`;
    const tue = async () => (await sql`select plan_date::text d, progress from public.class_sheet_plan_lines where class_id=${T_CLASS} and term_mode='regular' and slot_start='17:15'
      and plan_date >= '2026-10-13' and extract(isodow from plan_date) = 2 order by plan_date`).map(r => `${r.d}:${r.progress}`);
    const marks = async () => (await sql`select plan_date::text d, kind, lane from public.class_lesson_shifts where class_id=${T_CLASS} order by plan_date, lane`).map(r => `${r.d}:${r.kind}:${r.lane}`);
    const state = async () => (await sql`select plan_date::text d, to_char(slot_start,'HH24:MI') s, term_mode, line_no, skill_area, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where class_id=${T_CLASS} order by plan_date, slot_start, term_mode, line_no`).map(r => JSON.stringify(r));
    const shifts = async () => (await sql`select metadata from public.audit_logs where tenant_id=${TENANT} and action='textbook_lesson_shift' and metadata->>'via'='3.0 연습 복사본'`).map(a => a.metadata);
    const s0 = await state();
    assert.deepEqual([await tue(), await marks()], [['2026-10-13:A', '2026-10-20:B'], []]);
    const at = { classId: T_CLASS, date: '2026-10-13', slotStart: '17:15' };
    // 미룸 — 뒤 칸이 전부 한 주씩 뒤로, 누른 칸은 빈다 · 표식은 비어 있는 첫 칸(누른 칸)에 · 결과 = 2.0 칸.
    const r1 = await run(sql, 'setLessonShift', T_ACTOR, { ...at, kind: 'skip' });
    assert.equal(r1.ok, true, JSON.stringify(r1).slice(0, 200)); sameShape(r1, shiftOkKeys(text), 'LessonShiftResult');
    assert.deepEqual(await tue(), ['2026-10-20:A', '2026-10-27:B']);
    assert.deepEqual(await marks(), ['2026-10-13:skip:']);
    assert.deepEqual([r1.kind, r1.moved, r1.lines, r1.cells.map(c => `${c.date}|${c.slotStart}`)], ['skip', 2, [], ['2026-10-13|17:15']], '누른 칸(이제 빈 칸)을 화면이 갈아 끼운다');
    assert.ok(validToken(r1.undo, T_CLASS), '되돌리기 기록 = 2.0 validToken을 통과');
    assert.deepEqual(r1.undo.markers, [{ key: '2026-10-13|17:15', before: null, after: 'skip' }]);
    const [hist] = await sql`select rows, row_count, period_from::text period_from from public.class_plan_import_batches where id=${r1.historyId}`;
    assert.deepEqual([hist.rows[0].kind, hist.rows[0].shift, hist.rows[0].title, hist.period_from, hist.row_count], ['shift', 'skip', R.shiftTitleOf(r1.undo), '2026-10-13', r1.undo.removed.length + r1.undo.added.length + r1.undo.changed.length], '툴바 [되돌리기 ▾] 히스토리');
    assert.deepEqual(hist.rows[0].token, r1.undo);
    assert.deepEqual((await shifts()).map(m => [m.date, m.slot, m.kind, m.moved]), [['2026-10-13', '17:15', 'skip', 2]], '감사로그 textbook_lesson_shift');
    // 되돌리기 — 줄·표식이 미루기 전 그대로 · 두 번은 안 된다.
    assert.deepEqual(await run(sql, 'undoLessonShift', T_ACTOR, { classId: T_CLASS, token: r1.undo, historyId: r1.historyId }), { ok: true });
    assert.deepEqual([await state(), await marks()], [s0, []], '미룸 → 되돌리기 = 원래대로');
    assert.deepEqual(await run(sql, 'undoLessonShift', T_ACTOR, { classId: T_CLASS, token: r1.undo, historyId: r1.historyId }), { ok: false, error: '이미 되돌렸습니다' });
    // 미룸 → 당김 = 원래대로(반대 표식이 누른 칸에 있으면 지운다).
    assert.equal((await run(sql, 'setLessonShift', T_ACTOR, { ...at, kind: 'skip' })).ok, true);
    const r2 = await run(sql, 'setLessonShift', T_ACTOR, { ...at, kind: 'advance' });
    assert.deepEqual([r2.ok, r2.kind, r2.lines.map(l => l.progress)], [true, 'advance', ['A']]);
    assert.deepEqual([await state(), await marks()], [s0, []], '미룸 → 당김 = 원래대로');
    // 줄 하나(lineId) — 배정이 안 지나가면 그 줄과 같은 구분·교재명 줄만 한 주씩, 표식 없음.
    const [line] = await sql`select id::text id from public.class_sheet_plan_lines where class_id=${T_CLASS} and plan_date='2026-10-13' and slot_start='17:15' and term_mode='regular'`;
    const r3 = await run(sql, 'setLessonShift', T_ACTOR, { ...at, kind: 'skip', lineId: line.id });
    assert.deepEqual([r3.ok, await tue(), await marks()], [true, ['2026-10-20:A', '2026-10-27:B'], []]);
    // 옮길 줄이 없는 칸 = 표식만(moved 0) · kind null = 표식만 지운다(줄 그대로, 감사로그 없음).
    const r4 = await run(sql, 'setLessonShift', T_ACTOR, { classId: T_CLASS, date: '2026-10-31', slotStart: '11:00', kind: 'skip' });
    assert.deepEqual([r4.ok, r4.moved, await marks()], [true, 0, ['2026-10-31:skip:']]);
    const s4 = await state(), n4 = (await shifts()).length;
    assert.deepEqual(await run(sql, 'setLessonShift', T_ACTOR, { classId: T_CLASS, date: '2026-10-31', slotStart: '11:00', kind: null }), { ok: true, kind: null, moved: 0 });
    assert.deepEqual([await state(), await marks(), (await shifts()).length], [s4, [], n4]);
    // 2.0 거절 문구 — 쓰기 없음.
    const fails = [
      [{ ...at, date: '10/13', kind: 'skip' }, '날짜가 올바르지 않습니다'],
      [{ ...at, slotStart: '7:15', kind: 'skip' }, '교시가 올바르지 않습니다'],
      [{ ...at, kind: 'skip', lineId: 'x' }, '줄이 올바르지 않습니다'],
      [{ ...at, kind: 'skip', fill: true }, '계획만 있는 칸은 당김만 됩니다'],
      [{ ...at, classId: MATH, kind: 'skip' }, '담당 반이 아닙니다'],
      [{ classId: T_CLASS, date: '2026-10-10', slotStart: '11:00', kind: 'advance' }, '다음 주 진도가 없어 당겨올 내용이 없습니다'],
    ];
    const s5 = await state();
    for (const [input, error] of fails) {
      const r = await run(sql, 'setLessonShift', T_ACTOR, input);
      assert.deepEqual([r.ok, r.error], [false, error], JSON.stringify(input));
      for (const k of Object.keys(r).filter(k => r[k] !== undefined)) assert.ok(SHIFT_FAIL_KEYS.includes(k), `실패 칸 ${k}`);
    }
    assert.deepEqual([await state(), await marks()], [s5, []], '거절은 쓰기 없음');
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_lesson_shifts) marks`;
  assert.deepEqual([after[0].audits, after[0].marks], [before[0].audits, before[0].marks], '되돌렸다');
});

test('복사본(되돌림): 회차 미룸·당김 — 배정 교재가 지나가는 칸 = 교재 순서로(2.0 shiftAlongPlans): 실제 줄 = 표식을 반영한 2.0 일정(expandPlans) · 줄 하나 = 그 배정의 줄 표식 · 계획만 있는 칸의 당김 · 되돌리기 = 기입 직후 그대로', { skip: !db && 'local database not running' }, async () => {
  const [owner] = await db`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='master' and not exists (select 1 from public.super_admins s where s.id=u.id) order by u.display_name limit 1`;
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_textbook_plans) plans, (select count(*)::int from public.class_lesson_shifts) marks`;
  await inRollback(async ({ sql, run }) => {
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`; // 시험용(되돌림): 테스트 반 수업을 기준일 뒤로
    const R = await C.loadRules(importV2), env = await C.readSettings(sql, TENANT, R), viewer = (await C.readViewers(sql, TENANT, R, env)).find(v => v.id === owner.id), today = await C.copyDay();
    const { readSlotChoices } = await import('./v2-ecs-textbooks.mjs'), { plannedLines } = await import('./v2-ecs-props.mjs');
    const chip = (await readSlotChoices({ sql, t: TENANT, R, env, user: viewer, today }, T_CLASS)).rows.find(c => !c.seat && c.dows.length >= 3);
    // 차수마다 진도 글이 다른 교재 — 줄이 어느 차수인지 글로 알아볼 수 있게.
    const [book] = await sql`select b.id::text id, b.title from public.textbooks b where b.tenant_id=${TENANT} and b.subject='english' and b.session_count between 8 and 40 and b.skill_area is not null
      and (select count(distinct progress) from public.textbook_lessons l where l.textbook_id=b.id and coalesce(btrim(l.progress), '') <> '') = b.session_count
      and not exists (select 1 from public.class_textbook_plans p where p.class_id=${T_CLASS} and p.textbook_id=b.id) order by b.title limit 1`;
    assert.ok(chip && book, '고른 교시 · 교재');
    const fill = await run(sql, 'applyTextbookFill', owner.id, { classId: T_CLASS, textbookId: book.id, slotPicks: chip.picks, pace: 'period', termMode: 'regular', startDate: today, startLessonNo: 1 });
    assert.equal(fill.ok, true, JSON.stringify(fill).slice(0, 200));
    const [plan] = await sql`select id::text id from public.class_textbook_plans where class_id=${T_CLASS} and textbook_id=${book.id} and is_active`;
    const bookLines = async () => (await sql`select id::text id, plan_date::text d, to_char(slot_start,'HH24:MI') s, progress from public.class_sheet_plan_lines
      where class_id=${T_CLASS} and term_mode='regular' and textbook=${book.title} and plan_date >= ${today} order by plan_date, slot_start, line_no`);
    const shape = rows => rows.map(r => `${r.d}|${r.s}|${r.progress}`);
    const marks = async () => (await sql`select plan_date::text d, kind, lane, pos from public.class_lesson_shifts where class_id=${T_CLASS} order by plan_date, lane`).map(r => `${r.d}:${r.kind}:${r.lane}:${r.pos}`);
    /** 실제 그 교재 줄 = 표식(지금 DB)을 반영한 2.0 일정 — 누른 날부터. */
    const followsPlan = async from => {
      const actual = (await bookLines()).filter(r => r.d >= from);
      const pl = await plannedLines(sql, TENANT, R, env, T_CLASS, from, actual.at(-1).d);
      const planned = Object.entries(pl.byCell).flatMap(([k, ls]) => ls.filter(l => l.title === book.title).map(l => `${k}|${l.progress}`)).filter(k => k >= from).sort();
      assert.deepEqual(shape(actual).sort(), planned, '실제 줄 = 표식을 반영한 2.0 일정(expandPlans)');
    };
    const b0 = await bookLines();
    assert.ok(b0.length >= 8 && new Set(b0.map(r => R.dowKeyOf(r.d))).size >= 3, '여러 요일에 걸친 배정');
    const press = b0[1], at = { classId: T_CLASS, date: press.d, slotStart: press.s };
    // 교시 통째 미룸 — 차수가 요일을 건너 교재 순서로 한 칸씩 뒤로(같은 요일끼리가 아니다) · 그 주의 바뀐 칸도 함께 돌려준다.
    const r1 = await run(sql, 'setLessonShift', owner.id, { ...at, kind: 'skip' });
    assert.equal(r1.ok, true, JSON.stringify(r1).slice(0, 200));
    assert.deepEqual(shape((await bookLines()).filter(r => r.d >= press.d)).slice(0, 2).map(k => k.split('|')[2]), [press.progress, b0[2].progress].map(String), '누른 칸의 차수가 다음 수업일로');
    assert.equal((await bookLines()).find(r => r.d === press.d && r.s === press.s), undefined, '누른 칸은 빈다');
    assert.ok(r1.cells.some(c => c.date !== press.d && R.dowKeyOf(c.date) !== R.dowKeyOf(press.d) && c.lines.length > 0), '같은 주 다른 요일 칸도 갈아 끼운다');
    assert.deepEqual(await marks(), [`${press.d}:skip::0`], '교시 통째 = 칸 표식');
    await followsPlan(press.d);
    assert.deepEqual(await run(sql, 'undoLessonShift', owner.id, { classId: T_CLASS, token: r1.undo, historyId: r1.historyId }), { ok: true });
    assert.deepEqual([shape(await bookLines()), await marks()], [shape(b0), []], '되돌리기 = 기입 직후 그대로');
    // 줄 하나 — 그 배정(lane = 배정 id)의 줄 표식 · 같은 일정 규칙.
    const line = (await bookLines())[1];
    const r2 = await run(sql, 'setLessonShift', owner.id, { ...at, kind: 'skip', lineId: line.id });
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 200));
    assert.deepEqual(await marks(), [`${press.d}:skip:${plan.id}:1`], '줄 표식 = 그 배정 · 첫 자리');
    await followsPlan(press.d);
    // 계획만 있는 칸의 당김(fill) — 미룸을 걷어 뒤 수업이 올라와 채운다(아무 차수도 버리지 않는다).
    const r3 = await run(sql, 'setLessonShift', owner.id, { ...at, kind: 'advance', fill: true });
    assert.equal(r3.ok, true, JSON.stringify(r3).slice(0, 200));
    assert.deepEqual([shape(await bookLines()), await marks()], [shape(b0), []], '미룸 → 계획만 있는 칸의 당김 = 원래대로');
    const r4 = await run(sql, 'setLessonShift', owner.id, { ...at, kind: 'advance', fill: true });
    assert.deepEqual([r4.ok, r4.error, r4.undo], [false, '이 칸엔 이미 진도가 있습니다 — 새로고침 후 줄의 [당김]을 눌러 주세요', undefined], '진도가 있는 칸은 줄의 당김으로(바뀐 게 없어 되돌리기도 없다)');
    const logs = await sql`select metadata from public.audit_logs where tenant_id=${TENANT} and action='textbook_lesson_shift' and metadata->>'via'='3.0 연습 복사본'`;
    assert.deepEqual(logs.map(l => l.metadata.kind).sort(), ['advance', 'skip', 'skip']);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_textbook_plans) plans, (select count(*)::int from public.class_lesson_shifts) marks`;
  assert.deepEqual([after[0].audits, after[0].plans, after[0].marks], [before[0].audits, before[0].plans, before[0].marks], '되돌렸다');
});

test.after(async () => { await db?.end(); });
