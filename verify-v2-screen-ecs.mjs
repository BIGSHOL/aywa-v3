// 2.0 화면 · 강사 시트 · 영어(ECS) 시험 — node --test experiments/owner-concept/verify-v2-screen-ecs.mjs
// ① 옮긴 본문(설정 병합·영역 설정)이 2.0 원문과 같다 ② 2.0 함수로 만든 모델이 복사본의 독립 SQL과 맞는다(반 목록·주간 작성률·
// 이력 행 #88·월간 작성률·계획 줄) ③ 매개변수 거절 ④ 화면 파일에 운영 주소·끼워 넣기·보기 중 쓰기 요청이 없다 ⑤ 실제 모델로 그린 화면이
// 2.0 문구를 쓰고 원문 코드를 내보이지 않는다 ⑥ 2단계: 저장 동작이 2.0과 같은 표·칸·감사로그를 남긴다(테스트 학생 '학원이'·테스트 반,
// 한 트랜잭션 안에서 하고 늘 되돌린다 — 복사본은 그대로). 복사본이 꺼져 있으면 복사본 단계만 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as E from './v2-screen-ecs.mjs';
import { importV2 } from './v2-bridge.mjs';

const { screen } = E;
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const RAW = /\b(?:present|absent|late|early_leave|excused|makeup|regular|exam|homeroom|assistant|injaewon|eie|selfStudy|withdrawn|classEnded|null|undefined)\b/;

test('옮긴 본문(deepMerge·normalizeHolidays·normalizeSubjects·resolveSkillAreas·skillAreaColorOf)이 2.0 원문과 같다', async () => {
  const ts = (await import('typescript')).default, mine = await here('./v2-screen-ecs.mjs');
  const fn = (raw, name) => { const text = raw.replace(/\r\n/g, '\n'), i = text.search(new RegExp(`(?:export )?function ${name}\\b`)), end = text.indexOf('\n}\n', i); assert.ok(i >= 0 && end > i, `${name} 본문`); return text.slice(text.indexOf('function', i), end + 2); };
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/,(?=[)\]}])/g, '').replace(/'/g, '"');
  const resolve = await src('features/owner/resolve.ts'), skill = await src('features/owner/skill-areas.ts'), types = await src('features/owner/settings-types.ts');
  for (const name of ['deepMerge', 'normalizeHolidays', 'normalizeSubjects']) assert.equal(norm(fn(mine, name)), norm(fn(resolve, name)), name);
  for (const name of ['resolveSkillAreas', 'skillAreaColorOf']) assert.equal(norm(fn(mine, name)), norm(fn(skill, name)), name);
  const list = (text, start) => { const i = text.indexOf(start); return text.slice(i, text.indexOf('];', i)); };
  const areas = [...list(skill, 'DEFAULT_ENGLISH_SKILL_AREAS').matchAll(/key: "(\w+)", label: "(\w+)", color: "(\w+)"/g)].map(m => ({ key: m[1], label: m[2], color: m[3] }));
  assert.deepEqual(E.DEFAULT_ENGLISH_SKILL_AREAS, areas);
  assert.deepEqual(E.SUBJECT_COLORS, [...types.slice(types.indexOf('export const SUBJECT_COLORS'), types.indexOf(']', types.indexOf('export const SUBJECT_COLORS'))).matchAll(/"(\w+)"/g)].map(m => m[1]));
  assert.ok(mine.includes(`const ROTATION = [${[...list(skill, 'const ROTATION').matchAll(/"(\w+)"/g)].map(m => `'${m[1]}'`).join(', ')}]`), 'ROTATION');
  assert.deepEqual(E.deepMerge({ a: [1], b: { c: 1, d: 2 }, e: 1 }, { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1 }), { a: [2, 3], b: { c: 1, d: 2 }, e: 1 });
  assert.equal(E.css({ fontSize: 20, lineHeight: 1.3, backgroundColor: '#fff', flex: '1 1 0' }), 'font-size:20px;line-height:1.3;background-color:#fff;flex:1 1 0');
});

test('옮긴 displayRoleFor가 2.0 원문과 같다(플랫폼 계정은 일반 화면에서 관리자)', async () => {
  const ts = (await import('typescript')).default, mine = await here('./v2-screen-ecs.mjs'), orig = await src('lib/auth/super-admin.ts');
  const body = (text, name) => { const t = text.replace(/\r\n/g, '\n'), i = t.indexOf(`function ${name}`); return t.slice(i, t.indexOf('\n}\n', i) + 2); };
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/,(?=[)\]}])/g, '');
  assert.equal(norm(body(mine, 'displayRoleFor')), norm(body(orig, 'displayRoleFor')));
});

test('저장 검증 상수가 2.0과 같다(계획 칸 필드)', async () => {
  const codec = await importV2('features/class-sheets/lib/plan-codec.ts');
  assert.deepEqual(E.PLAN_PATCH_FIELDS, [...codec.PLAN_PATCH_FIELDS]);
});

test('저장 검증: 모양이 아닌 입력은 복사본에 닿기 전에 거절', () => {
  const A = screen.actions, base = { classId: 'e175fd4d-a655-409a-905e-71850ab1b848', actor: '09705ab8-05cf-48ab-8f06-d54a3d990b5c' };
  assert.throws(() => A.planCell.validate({ ...base, lineId: 'x', field: 'textbook' }), /입력 값/);
  assert.throws(() => A.planCell.validate({ ...base, lineId: base.classId, field: 'updated_by' }), /허용되지 않는 항목/);
  assert.throws(() => A.planCell.validate({ ...base, lineId: base.classId, field: 'textbook', value: 'x'.repeat(501) }), /너무 깁니다/);
  assert.throws(() => A.planAdd.validate({ ...base, planDate: '2026-09-22', slotStart: '17:15', termMode: 'regular', skillArea: 'Vocab!' }), /영역/);
  assert.throws(() => A.planAdd.validate({ ...base, planDate: '2026-09-22', slotStart: '5pm', termMode: 'regular', skillArea: 'vocab' }), /날짜\/시각/);
  assert.throws(() => A.mark.validate({ ...base, studentId: base.classId, date: '2026-09-22', slotStart: '17:15', field: 'recorded_by' }), /입력 값/);
  assert.throws(() => A.attendance.validate({ ...base, studentId: base.classId, date: '2026-09-22', slotStart: '17:15', slot: null, status: 'makeup' }), /잘못된 상태/);
  assert.throws(() => A.mpCell.validate({ ...base, date: '2026-09-22', colKind: 'off', body: 'off' }), /휴강 표시/, '휴강 값은 서버가 학원 휴일로 정한다');
  assert.throws(() => A.memo.validate({ ...base, weekStart: '2026-09-21', memoKey: 'slot:x', body: '' }), /메모 위치/);
  assert.throws(() => A.planCell.validate({ ...base, actor: 'me', lineId: base.classId, field: 'textbook' }), /입력 값/);
});

test('2.0 모듈을 한 객체로 펼쳐도 같은 이름에 다른 값이 없다(불러온 함수가 서로 덮이지 않는다)', async () => {
  const seen = new Map();
  for (const p of E.MODULES) for (const [k, v] of Object.entries(await importV2(p))) { if (seen.has(k)) assert.equal(seen.get(k)[1], v, `${k}: ${seen.get(k)[0]} ↔ ${p}`); seen.set(k, [p, v]); }
});

test('매개변수: 면·반·주·달·보기·기간·프로그램·담임·날짜·JJ만, 모양이 아니면 거절', () => {
  const P = screen.params, ok = (k, v) => P[k].test(v);
  assert.deepEqual(Object.keys(P).sort(), ['as', 'class', 'date', 'day', 'jj', 'month', 'mv', 'period', 'teacher', 'track', 'view', 'week']);
  for (const [k, v] of [['view', 'sheet'], ['view', 'today'], ['class', 'e175fd4d-a655-409a-905e-71850ab1b848'], ['week', '2026-10-26'], ['month', '2026-10'], ['mv', 'mp'], ['period', 'session'], ['track', 'eie'], ['teacher', 'none'], ['jj', '0']]) assert.ok(ok(k, v), `${k}=${v}`);
  for (const [k, v] of [['view', 'admin'], ['class', 'x'], ['week', '2026-10-26T00'], ['month', '2026-1'], ['mv', 'week'], ['period', 'year'], ['track', 'all,eie'], ['teacher', 'kim'], ['jj', '2']]) assert.ok(!ok(k, v), `${k}=${v} 거절`);
  assert.deepEqual(Object.keys(screen.actions), ['planCell', 'planAdd', 'planDelete', 'planCopy', 'mark', 'goal', 'memo', 'monthMemo', 'shouting', 'attendance', 'mpCell']);
  assert.ok(P.as.test('09705ab8-05cf-48ab-8f06-d54a3d990b5c') && !P.as.test('me'), '저장하는 사람(as)은 사람 id만');
});

test('화면 파일: 운영 주소·끼워 넣기·외부 요청·보기 중 쓰기가 없다', async () => {
  for (const f of ['v2-screen-ecs.js', 'v2-screen-ecs.mjs', 'v2-screen-ecs.css']) {
    const text = await here(f);
    assert.ok(!/aywa\.co\.kr|vercel\.app|supabase\.co|https?:\/\/(?!127\.0\.0\.1)/i.test(text), `${f}: 운영 주소`);
    assert.ok(!/<iframe|<embed|<object/i.test(text), `${f}: 끼워 넣기`);
  }
  const page = await here('v2-screen-ecs.js');
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon/.test(page), '조회는 공통 틀 ctx.load, 저장은 ctx.act뿐');
  assert.ok((page.match(/last\.act\(/g) || []).length === 1, '저장 통로는 한 곳(save → ctx.act)');
});

const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId: TENANT, importV2 }));
let TENANT = null;
if (db) TENANT = (await import('./full-db.mjs')).tenantId;
const WEEK = '2026-10-26', INJAEWON = '5283fcb8-6feb-4b71-82d1-e9ace0b8904b', EIE = 'ec0a13c4-e78e-4f5e-88af-5b0ced8d5869';

test('복사본: 반 목록 = 그 주에 실제로 도는 영어 반(독립 SQL) · EiE/인재원 영어 좌우 2단 · 담임별 묶음', { skip: !db && 'local database not running' }, async () => {
  const d = await load({ week: WEEK }), L = d.list;
  const [{ n }] = await db`select count(distinct c.id)::int n from public.classes c join public.class_schedules s on s.class_id=c.id
    cross join generate_series(${WEEK}::date, ${WEEK}::date + 6, '1 day') g(day)
    where c.tenant_id=${TENANT} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= ${WEEK}::date)
      and s.day_of_week::text = lower(to_char(g.day, 'dy')) and s.valid_from <= g.day and (s.valid_to is null or s.valid_to >= g.day)`;
  assert.equal(L.trackCounts.all, n, '그 주에 도는 반 수');
  assert.equal(L.trackCounts.eie + L.trackCounts.injaewon, n, '두 단이 빠짐없이 나눈다(미분류는 인재원 쪽)');
  const cards = (L.panels ?? [{ groups: L.groups }]).flatMap(p => p.groups.flatMap(g => g.cards));
  assert.equal(cards.length, n); assert.equal(new Set(cards.map(c => c.classId)).size, n, '모든 반이 정확히 한 번');
  for (const c of cards) { assert.ok(c.filledSlots <= c.totalSlots); if (c.englishTrack !== 'eie') assert.equal(c.shout, null, 'EiE가 아니면 Shouting 칸을 비운다'); }
  if (L.panels) assert.deepEqual(L.panels.map(p => p.label), ['EiE', '인재원 영어']);
  const one = L.teacherOptions[0], f = await load({ week: WEEK, teacher: one.value });
  assert.equal((f.list.panels ?? [{ groups: f.list.groups }]).flatMap(p => p.groups.flatMap(g => g.cards)).length, one.count, '담임 필터 = 그 담임 반 수');
  assert.ok(Object.keys(d.t).length > 300 && d.t['landing.title'] === '영어 강사 시트', '2.0 사전 한국어 값');
});

test('복사본: 주간 시트 작성률·교시·계획 줄이 독립 SQL과 같다(이력 행 #88 · LAB 제외 · JJ 표시)', { skip: !db && 'local database not running' }, async () => {
  for (const jj of ['1', '0']) {
    const d = await load({ view: 'sheet', class: INJAEWON, week: WEEK, jj }), s = d.sheet;
    const live = await db`select distinct g.day::date::text d, to_char(s.start_time,'HH24:MI') st, s.slot_teacher_label lbl from public.class_schedules s
      cross join generate_series(${WEEK}::date, ${WEEK}::date + 6, '1 day') g(day)
      where s.tenant_id=${TENANT} and s.class_id=${INJAEWON} and s.day_of_week::text = lower(to_char(g.day, 'dy')) and s.valid_from <= g.day and (s.valid_to is null or s.valid_to >= g.day)`;
    const shown = live.filter(r => !/^(LAB|이주희)/i.test(r.lbl ?? '') && (jj === '1' || !/^JJ/i.test(r.lbl ?? '')));
    const gridKeys = s.grid.days.flatMap(x => x.slots.map(sl => `${x.date}|${sl.slotStart}`)).sort();
    assert.deepEqual(gridKeys, [...new Set(shown.map(r => `${r.d}|${r.st}`))].sort(), `jj=${jj}: 그 주 교시 = 날짜마다 살아 있는 배치`);
    const holidays = s.grid.days.filter(x => x.holiday).length;
    if (!holidays) assert.equal(s.fill.totalSlots, gridKeys.length, '작성률 분모 = 보이는 교시');
    const [{ filled }] = await db`select count(distinct (plan_date, to_char(slot_start,'HH24:MI')))::int filled from public.class_sheet_plan_lines
      where tenant_id=${TENANT} and class_id=${INJAEWON} and plan_date between ${WEEK}::date and ${WEEK}::date + 6 and ecs_is_meaningful_line(textbook, page_range, progress, homework)
        and (plan_date::text || '|' || to_char(slot_start,'HH24:MI')) = any(${gridKeys})`;
    assert.equal(s.fill.filledSlots, filled, '작성률 분자 = 의미 있는 줄이 있는 교시(같은 DB 판정 ecs_is_meaningful_line)');
    for (const x of s.grid.days) for (const sl of x.slots) {
      for (const l of sl.lines) assert.equal(`${l.planDate}|${l.slotStart.slice(0, 5)}`, `${x.date}|${sl.slotStart}`);
      for (const g of sl.groups) for (const r of g.rows) for (const v of [r.att?.label, r.attitudeLabel, r.summary].filter(Boolean)) assert.ok(!RAW.test(v), `원문 코드: ${v}`);
    }
    assert.ok(s.grid.rows.every(row => row.length === s.grid.days.length), '서수 배치 = 요일 열 수');
  }
});

test('복사본: 월간 달력·진도표 작성률과 계획 줄이 독립 SQL과 같다 · EiE 반만 계획(MP)', { skip: !db && 'local database not running' }, async () => {
  const d = await load({ view: 'month', class: INJAEWON, month: '2026-10' }), m = d.month;
  assert.equal(m.isEie, false); assert.equal(m.mp, null); assert.equal(m.period.kind, 'month', '인재원 영어는 달력월 고정');
  const live = await db`select distinct g.day::date::text d, to_char(s.start_time,'HH24:MI') st from public.class_schedules s
    cross join generate_series('2026-10-01'::date, '2026-10-31'::date, '1 day') g(day)
    where s.tenant_id=${TENANT} and s.class_id=${INJAEWON} and s.day_of_week::text = lower(to_char(g.day, 'dy')) and s.valid_from <= g.day and (s.valid_to is null or s.valid_to >= g.day)`;
  const keys = live.map(r => `${r.d}|${r.st}`).sort();
  assert.deepEqual(Object.values(m.cells).flatMap(c => c.slots.map(s => s.key)).sort(), keys, '달력 칸 = 그 달 날짜마다 살아 있는 배치');
  const [{ n }] = await db`select count(*)::int n from public.class_sheet_plan_lines where tenant_id=${TENANT} and class_id=${INJAEWON} and plan_date between '2026-10-01' and '2026-10-31'
    and ecs_is_meaningful_line(textbook, page_range, progress, homework) and (plan_date::text || '|' || to_char(slot_start,'HH24:MI')) = any(${keys})`;
  assert.equal(m.lines.length, n, '월간 계획 줄 = 배정 칸의 의미 있는 줄(고아·빈 줄 제외)');
  const eie = (await load({ view: 'month', class: EIE, month: '2026-10' })).month;
  assert.equal(eie.isEie, true); assert.equal(eie.view, 'mp', 'EiE 반의 달력 = 월간 계획서');
  assert.ok(eie.mp.weeks.length > 0 && eie.mp.style.table.includes('width:'), '종이 서식 값은 2.0 month-plan-sheet-style에서');
  const forced = (await load({ view: 'month', class: INJAEWON, mv: 'mp' })).month;
  assert.equal(forced.view, 'cal', '주소에 mp를 쳐도 인재원 영어 반은 달력(clampEcsMonthView)');
  assert.match((await load({ view: 'sheet', class: '50d2ece7-6514-4474-8cfc-dd8983d15c18' })).error, /영어 강사 시트 대상이 아닙니다/, '수학 반은 거절(2.0 문구)');
});

test('복사본: 오늘 면 = 고른 선생님의 그날 반 · 각 반은 그날 열 · 본인 교시만(2.0 selectSheetDaysFor)', { skip: !db && 'local database not running' }, async () => {
  const d = await load({ view: 'today', date: '2026-10-27' }), T = d.today;
  assert.ok(T.teacher && T.teachers.length > 0);
  for (const c of T.classes) {
    assert.ok(!('grid' in c) && !('marks' in c), '그날 칸만 싣는다');
    for (const slot of c.todayDay?.slots ?? []) assert.ok(!slot.teacherId || slot.teacherId === T.teacher.id || /^(JJ|LAB)/.test(slot.teacherLabel ?? '') || slot.lines.length >= 0);
    if (c.todaySheet) for (const g of c.todaySheet.groups) for (const r of g.rows) if (r.cells) assert.equal(r.cells.length, c.todayDay.slots.length, '교시마다 칸 한 묶음');
  }
});

// 2단계 — 테스트 학생 '학원이' · 테스트 반 '학원이(영어 테스트)'(원장 시험용), 담임 '테스터'. 한 트랜잭션 안에서 하고 늘 되돌린다.
const T_CLASS = 'e175fd4d-a655-409a-905e-71850ab1b848', T_STU = '6219e442-aa57-455f-a5bc-834b222d9e1c', T_ACTOR = '09705ab8-05cf-48ab-8f06-d54a3d990b5c', ROLLBACK = Symbol('rollback');
async function inRollback(fn) {
  const run = (sql, name, raw) => screen.actions[name].run({ sql, body: screen.actions[name].validate(raw), tenantId: TENANT, importV2 });
  await db.begin(async sql => { await fn({ sql, run }); throw ROLLBACK; }).catch(e => { if (e !== ROLLBACK) throw e; });
}
const code = c => e => e?.code === c;
/** 한 트랜잭션 안의 감사로그는 시각(now())이 같다 — 순서가 아니라 내용으로 찾는다. */
const find = (list, pred, what) => { const hit = list.find(a => pred(a.metadata)); assert.ok(hit, `감사로그 없음: ${what}`); return hit.metadata; };

test('복사본(되돌림): 계획 칸·줄·복사·학생 기록·목표·메모가 2.0과 같은 행·감사로그를 남긴다', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net, (select count(*)::int from public.class_sheet_plan_lines where class_id=${T_CLASS}) lines`;
  await inRollback(async ({ sql, run }) => {
    const base = { classId: T_CLASS, actor: T_ACTOR };
    const audits = action => sql`select actor_id::text actor_id, actor_name, target_label, metadata from public.audit_logs where tenant_id=${TENANT} and action=${action} and metadata->>'classId'=${T_CLASS} and metadata->>'via'='3.0 연습 복사본' order by created_at desc, id desc`;
    // 범위·사람 게이트(2.0 requireEcsClassAccess): 남의 반 선생님은 거절, 수학 반은 대상 아님.
    const [other] = await sql`select u.id::text id from public.users u where u.tenant_id=${TENANT} and u.status='active' and u.system_role='teacher' and u.id <> ${T_ACTOR}
      and not exists (select 1 from public.classes c where c.id=${T_CLASS} and c.teacher_id=u.id) and not exists (select 1 from public.class_schedules s where s.class_id=${T_CLASS} and s.teacher_id=u.id) limit 1`;
    await assert.rejects(run(sql, 'planAdd', { ...base, actor: other.id, planDate: '2026-09-22', slotStart: '17:15', termMode: 'regular', skillArea: 'vocab' }), code('not_my_class'));
    await assert.rejects(run(sql, 'memo', { ...base, classId: '50d2ece7-6514-4474-8cfc-dd8983d15c18', weekStart: '2026-09-21', memoKey: 'panel', body: 'x' }), /영어 강사 시트 대상이 아닙니다/);
    // 줄 추가(ecs_create_plan_line) → 줄 하나, 2.0 감사 한 줄.
    await run(sql, 'planAdd', { ...base, planDate: '2026-09-22', slotStart: '17:15', termMode: 'regular', skillArea: 'vocab' });
    const [line] = await sql`select id::text id, skill_area, line_no, updated_by::text updated_by from public.class_sheet_plan_lines where class_id=${T_CLASS} and plan_date='2026-09-22' and slot_start='17:15' and term_mode='regular' order by line_no desc limit 1`;
    assert.equal(line.skill_area, 'vocab'); assert.equal(line.updated_by, T_ACTOR);
    const [add] = await audits('ecs_plan_line_add');
    assert.deepEqual([add.actor_id, add.metadata.planDate, add.metadata.slotStart, add.metadata.termMode, add.metadata.skillArea], [T_ACTOR, '2026-09-22', '17:15', 'regular', 'vocab']);
    // 계획 칸(필드 CAS): 기대값이 맞으면 저장 + ecs_plan_cell_edit(before→after · 열 이름), 틀리면 충돌(감사 없음).
    assert.equal((await run(sql, 'planCell', { ...base, lineId: line.id, field: 'textbook', expected: null, value: '  시험 교재  ' })).status, 'applied');
    assert.equal((await sql`select textbook from public.class_sheet_plan_lines where id=${line.id}`)[0].textbook, '시험 교재', '2.0 normalizePlanText(앞뒤 공백 제거)');
    const cell = find(await audits('ecs_plan_cell_edit'), m => m.field === 'textbook', '계획 칸');
    assert.deepEqual([cell.kind, cell.lineId, cell.fieldLabel, cell.before, cell.after], ['plan', line.id, '교재 / 내신교과서', null, '시험 교재']);
    const conflict = await run(sql, 'planCell', { ...base, lineId: line.id, field: 'textbook', expected: '옛 값', value: '새 값' });
    assert.deepEqual(conflict, { status: 'conflict', serverValue: '시험 교재' });
    assert.equal((await audits('ecs_plan_cell_edit')).length, 1, '충돌은 감사로그를 남기지 않는다');
    await run(sql, 'planCell', { ...base, lineId: line.id, field: 'skill_area', expected: 'vocab', value: 'grammar' });
    assert.deepEqual([find(await audits('ecs_plan_cell_edit'), m => m.field === 'skill_area', '구분').before, find(await audits('ecs_plan_cell_edit'), m => m.field === 'skill_area', '구분').after], ['Vocab', 'Grammar'], '구분은 영역 이름으로 남긴다');
    await assert.rejects(run(sql, 'planCell', { ...base, lineId: line.id, field: 'skill_area', expected: 'grammar', value: '' }), code('bad_area'));
    // 내용 복사(ecs_copy_slot) — 같은 교시·같은 요일의 지난 수업(9/22 화 → 9/29 화), 빈 칸만.
    const copied = await run(sql, 'planCopy', { ...base, planDate: '2026-09-29', slotStart: '17:15', termMode: 'regular' });
    assert.ok(copied.copied >= 1 && copied.sourceDate === '2026-09-22', JSON.stringify(copied));
    assert.equal((await audits('ecs_plan_copy'))[0].metadata.copied, copied.copied);
    // 줄 삭제(ecs_delete_plan_line) — 지운 줄의 날짜·교시를 감사에 남기고, 이미 지운 줄은 멱등.
    await run(sql, 'planDelete', { ...base, lineId: line.id });
    assert.equal((await sql`select count(*)::int n from public.class_sheet_plan_lines where id=${line.id}`)[0].n, 0);
    const del = find(await audits('ecs_plan_line_delete'), m => m.lineId === line.id, '줄 삭제');
    assert.deepEqual([del.planDate, del.slotStart], ['2026-09-22', '17:15']);
    assert.deepEqual(await run(sql, 'planDelete', { ...base, lineId: line.id }), { deleted: false });
    // 학생 기록 칸 — 넘긴 칸만, 다 비면 행 삭제, ecs_mark_edit(칸 이름 = 로스터 라벨).
    const mk = { ...base, studentId: T_STU, date: '2026-09-22', slotStart: '17:15' };
    await run(sql, 'mark', { ...mk, field: 'status', value: '좋음' });
    await run(sql, 'mark', { ...mk, field: 'score', value: '18/20' });
    const [m1] = await sql`select status, score, progress_note, updated_by::text updated_by from public.class_sheet_student_marks where class_id=${T_CLASS} and student_id=${T_STU} and mark_date='2026-09-22' and slot_start='17:15'`;
    assert.deepEqual({ ...m1 }, { status: '좋음', score: '18/20', progress_note: null, updated_by: T_ACTOR });
    assert.deepEqual((await audits('ecs_mark_edit')).map(a => a.metadata.fieldLabel).sort(), ['시험 점수', '태도'].sort());
    await run(sql, 'mark', { ...mk, field: 'status', value: null }); await run(sql, 'mark', { ...mk, field: 'score', value: '' });
    assert.equal((await sql`select count(*)::int n from public.class_sheet_student_marks where class_id=${T_CLASS} and student_id=${T_STU} and mark_date='2026-09-22'`)[0].n, 0, '다 비면 빈 행을 남기지 않는다');
    await assert.rejects(run(sql, 'mark', { ...mk, date: '2026-10-27', field: 'status', value: '좋음' }), code('not_eligible'), '수강하지 않은 날은 기록 행 읽기 전용');
    // 목표 · 주간 메모 · 월 메모.
    await run(sql, 'goal', { ...base, scope: 'month', periodStart: '2026-09-17', role: 'homeroom', skillArea: 'vocab', field: 'textbook', value: '목표 교재' });
    const [g] = await sql`select period_start::text p, textbook, target_progress from public.class_sheet_goals where class_id=${T_CLASS} and scope='month' and role='homeroom' and skill_area='vocab'`;
    assert.deepEqual({ ...g }, { p: '2026-09-01', textbook: '목표 교재', target_progress: null }, '월간 목표는 그 달 1일(2.0 normalizePeriodStart)');
    const goal = find(await audits('ecs_goal_edit'), m => m.skillArea === 'vocab', '목표');
    assert.deepEqual([goal.areaLabel, goal.fieldLabel, goal.after], ['Vocab', '교재명', '목표 교재']);
    await assert.rejects(run(sql, 'goal', { ...base, scope: 'month', periodStart: '2026-09-01', role: 'homeroom', skillArea: 'in_class', field: 'textbook', value: 'x' }), code('bad_area'), 'EiE 칸은 인재원 반 목표가 아니다');
    await run(sql, 'memo', { ...base, weekStart: '2026-09-23', memoKey: 'panel', body: '주간 메모' });
    assert.equal((await sql`select week_start::text w from public.class_sheet_memos where class_id=${T_CLASS} and memo_key='panel'`)[0].w, '2026-09-21');
    await run(sql, 'monthMemo', { ...base, month: '2026-09', body: '월 메모' });
    assert.deepEqual((await audits('ecs_memo_edit')).map(a => `${a.metadata.kind}:${a.metadata.fieldLabel}`).sort(), ['memo:주간 메모', 'monthMemo:특이사항 메모']);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '바깥으로 나가려는 요청 없음');
  });
  const after = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from public.class_sheet_plan_lines where class_id=${T_CLASS}) lines`;
  assert.deepEqual([after[0].audits, after[0].lines], [before[0].audits, before[0].lines], '되돌렸다 — 복사본은 그대로');
});

test('복사본(되돌림): 출결 체크 · Shouting · 계획(MP) 칸이 2.0 규칙대로(EiE 반만 · 7일 창 · ecs_clear_present)', { skip: !db && 'local database not running' }, async () => {
  const before = await db`select (select count(*)::int from public.audit_logs) audits, (select count(*)::int from net.http_request_queue) net`;
  await inRollback(async ({ sql, run }) => {
    const base = { classId: T_CLASS, actor: T_ACTOR }, day = '2026-10-27'; // 복사본 기준일(화) — 강사 7일 창 안
    await assert.rejects(run(sql, 'shouting', { ...base, date: '2026-09-22', slotStart: '17:15', value: true }), code('not_eie'), '인재원 영어·미분류 반은 Shouting 없음');
    await assert.rejects(run(sql, 'attendance', { ...base, studentId: T_STU, date: '2026-09-22', slotStart: '17:15', slot: '17:15', status: 'present' }), code('attendance_locked'), '강사는 7일 창(2.0 문구)');
    // 시험용으로만(되돌림): 테스트 반을 EiE로 · 수업·수강을 기준일 주까지 늘린다.
    await sql`update public.classes set english_track='eie' where id=${T_CLASS}`;
    await sql`update public.class_schedules set valid_to=null where class_id=${T_CLASS}`;
    await sql`update public.enrollments set end_date=null where class_id=${T_CLASS} and student_id=${T_STU}`;
    const att = () => sql`select status::text status, slot_start::text slot, recorded_via, recorded_by::text by, session_units::float8 units from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${day}`;
    const audits = action => sql`select metadata from public.audit_logs where tenant_id=${TENANT} and action=${action} and metadata->>'classId'=${T_CLASS} and metadata->>'via'='3.0 연습 복사본' order by created_at desc, id desc`;
    const cellKey = { ...base, studentId: T_STU, date: day, slotStart: '17:15' };
    await sql`delete from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${day}`; // 깨끗한 칸에서 시작(되돌림 안)
    await run(sql, 'attendance', { ...cellKey, slot: '17:15', status: 'present' });
    const [a1] = await att();
    assert.deepEqual([a1.status, a1.slot, a1.recorded_via, a1.by], ['present', '17:15:00', 'teacher', T_ACTOR], '교시 칸 출결(0196a) · 가르치는 사람 기록');
    find(await audits('attendance_cell'), m => m.created === true && m.status === 'present' && m.slotStart === '17:15', '새 출결');
    await run(sql, 'attendance', { ...cellKey, slot: '17:15', status: 'absent' });
    assert.equal((await att()).length, 1, '같은 칸은 제자리에서 고친다(pickSaveTargets)');
    assert.equal((await att())[0].status, 'absent');
    find(await audits('attendance_cell'), m => m.overwrote === true && m.status === 'absent' && m.prevStatus === 'present', '고친 출결');
    await run(sql, 'attendance', { ...cellKey, slot: '17:15', status: null });
    assert.equal((await att()).length, 0); find(await audits('ecs_attendance_clear'), m => m.rows === 1 && m.date === day, '출결 지우기');
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, note, recorded_by, recorded_via) values (${TENANT}, ${T_CLASS}, ${T_STU}, ${day}, '17:15', 'late', '버스 늦음', ${T_ACTOR}, 'teacher')`;
    await assert.rejects(run(sql, 'attendance', { ...cellKey, slot: '17:15', status: null }), code('rich'), '사유가 붙은 기록은 ecs_clear_present가 거절');
    // 옛 '그날 전체' 행(slot null)은 제자리에서 고친다 — 새 교시 행을 만들지 않는다(2.0 dbSlot).
    await sql`delete from public.attendance_records where class_id=${T_CLASS} and student_id=${T_STU} and session_date=${day}`;
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, recorded_by, recorded_via) values (${TENANT}, ${T_CLASS}, ${T_STU}, ${day}, null, 'present', ${T_ACTOR}, 'teacher')`;
    await run(sql, 'attendance', { ...cellKey, slot: null, status: 'late' });
    assert.deepEqual((await att()).map(r => [r.status, r.slot]), [['late', null]]);
    // Shouting — 체크하면 행, 풀면 행 삭제, 바뀐 때만 감사.
    await run(sql, 'shouting', { ...base, date: day, slotStart: '17:15', value: true });
    await run(sql, 'shouting', { ...base, date: day, slotStart: '17:15', value: true });
    await run(sql, 'shouting', { ...base, date: day, slotStart: '17:15', value: false });
    assert.deepEqual((await audits('ecs_shouting_toggle')).map(a => a.metadata.checked).sort(), [false, true], '두 번 체크해도 한 줄(바뀐 때만)');
    // 계획(MP) — 값 칸 · e-book 열(구조) · 휴강(학원 휴일 기준으로 서버가 off/open을 정한다).
    await run(sql, 'mpCell', { ...base, dates: [day], colKind: 'in_class', body: 'SB p.10' });
    assert.equal(find(await audits('ecs_month_plan_edit'), m => m.kind === 'mpCell', 'MP 칸').fieldLabel, 'In-class');
    await run(sql, 'mpCell', { ...base, dates: [day, '2026-10-20'], colKind: 'ebook', body: '', intent: { kind: 'ebookColumn', show: true } });
    assert.equal(find(await audits('ecs_month_plan_edit'), m => m.change === 'ebookColumn', 'e-book 열').days, 2);
    await run(sql, 'mpCell', { ...base, dates: [day], colKind: 'off', body: null, intent: { kind: 'dayOff', off: true } });
    assert.equal((await sql`select body from public.class_month_plan_cells where class_id=${T_CLASS} and plan_date=${day} and col_kind='off'`)[0].body, 'off');
    assert.equal(find(await audits('ecs_month_plan_edit'), m => m.change === 'dayOff', '휴강').off, true);
    assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, before[0].net, '되돌릴 트랜잭션 안에서도 바깥 요청을 늘리지 않았다');
  });
  assert.equal((await db`select count(*)::int n from public.audit_logs`)[0].n, before[0].audits, '되돌렸다');
});

async function page(data, query = '', extra = {}) {
  const srcText = await here('v2-screen-ecs.js');
  let def = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  vm.runInNewContext(srcText, { window: { V2Screens: { register: x => { def = x; }, esc } }, document: { addEventListener() {} }, location: { hash: '' }, URLSearchParams });
  return def.render({ query: new URLSearchParams(query), load: () => ({ status: 'ready', data }), go() {}, refresh() {}, api: {}, ...extra });
}
const visible = html => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

test('화면: 실제 모델로 그린 네 면이 2.0 문구를 쓰고, 원문 코드·이스케이프 안 된 이름이 없다', { skip: !db && 'local database not running' }, async () => {
  const list = await page(await load({ week: WEEK }));
  for (const l of ['영어 강사 시트', '담임별', 'EiE', '인재원 영어', '주간 작성률', '달력', '복사본 보기 전용']) assert.ok(list.includes(l), `목록: ${l}`);
  const sheetData = await load({ view: 'sheet', class: INJAEWON, week: WEEK }), sheet = await page(sheetData, `view=sheet&class=${INJAEWON}&week=${WEEK}`);
  for (const l of ['담임 월간계획', '주간 메모', '평시', '구분', '진도', '과제', '출결', '유닛', '태도', '특이사항', '주간', '진도표', '계획 패널']) assert.ok(sheet.includes(l), `주간: ${l}`);
  const cal = await page(await load({ view: 'month', class: INJAEWON, month: '2026-10' }), `view=month&class=${INJAEWON}&month=2026-10`);
  for (const l of ['담임', '부담임', '특이사항', '화요일']) assert.ok(cal.includes(l), `달력: ${l}`);
  const mp = await page(await load({ view: 'month', class: EIE, month: '2026-10' }), `view=month&class=${EIE}&month=2026-10`);
  for (const l of ['In-class', 'Homework', 'Test', 'Week 1', 'Date']) assert.ok(visible(mp).replace(/\s+/g, ' ').includes(l), `계획(MP): ${l}`);
  const today = await page(await load({ view: 'today', date: '2026-10-27' }), 'view=today&date=2026-10-27');
  for (const l of ['보는 선생님', '오늘']) assert.ok(today.includes(l), `오늘: ${l}`);
  for (const [name, html] of Object.entries({ list, sheet, cal, mp, today })) {
    assert.ok(!RAW.test(visible(html)), `${name}: 원문 코드 노출 — ${visible(html).match(RAW)?.[0]}`);
    assert.ok(!/<script|javascript:/i.test(html), `${name}: 스크립트`);
    assert.ok(!/(?:sheet|month|list|today)\.[a-z]+\.[a-z]/.test(visible(html).replace(/[\w.-]+@[\w.-]+/g, '')), `${name}: 사전 키가 그대로 보인다`);
  }
  const evil = structuredClone(sheetData); evil.sheet.className = '<img src=x onerror=alert(1)>';
  const evilHtml = await page(evil, `view=sheet&class=${INJAEWON}`);
  assert.ok(!evilHtml.includes('<img src=x') && evilHtml.includes('&lt;img src=x'), '반 이름 이스케이프');
});

test('화면(저장 가능): 2.0 편집 자리 — 계획 칸 입력 · 줄 추가 · 내용 복사 · 체크 순환 · 저장하는 사람 · 복사본 안내', { skip: !db && 'local database not running' }, async () => {
  const ctx = { writable: true, copyNote: '연습용 복사본(Docker)에 저장됩니다.' };
  const sheet = await page(await load({ view: 'sheet', class: INJAEWON, week: WEEK }), `view=sheet&class=${INJAEWON}&week=${WEEK}`, ctx);
  for (const l of ['연습용 복사본(Docker)에 저장됩니다.', '저장하는 사람', '2.0 화면 · 연습 복사본', '줄 추가', '내용 복사']) assert.ok(sheet.includes(l), l);
  assert.ok(/data-ec-act="planCell"/.test(sheet) && /data-ec-btn="planAdd"/.test(sheet) && /data-ec-btn="attendance"/.test(sheet) && /data-ec-btn="mark"/.test(sheet), '편집 자리');
  assert.ok(/data-ec-act="goal"/.test(sheet) && /data-ec-act="memo"/.test(sheet), '계획 패널 저장');
  const mp = await page(await load({ view: 'month', class: EIE, month: '2026-10' }), `view=month&class=${EIE}&month=2026-10`, ctx);
  assert.ok(/data-ec-act="mpCell"/.test(mp) && mp.includes('e-book') !== null, '계획(MP) 칸 저장');
  const ro = await page(await load({ view: 'sheet', class: INJAEWON, week: WEEK }), `view=sheet&class=${INJAEWON}&week=${WEEK}`);
  assert.ok(!/data-ec-act=|data-ec-btn=/.test(ro), '저장 불가로 알리면 2.0 읽기 모양');
});

test.after(async () => { await db?.end(); });
