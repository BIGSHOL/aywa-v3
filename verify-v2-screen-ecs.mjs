// 2.0 화면 · 강사 시트 · 영어(ECS) 시험 — node --test experiments/owner-concept/verify-v2-screen-ecs.mjs
// ① 옮긴 본문(설정 병합·영역 설정)이 2.0 원문과 같다 ② 2.0 함수로 만든 모델이 복사본의 독립 SQL과 맞는다(반 목록·주간 작성률·
// 이력 행 #88·월간 작성률·계획 줄) ③ 매개변수 거절 ④ 화면 파일에 운영 주소·끼워 넣기·보기 중 쓰기 요청이 없다 ⑤ 실제 모델로 그린 화면이
// 2.0 문구를 쓰고 원문 코드를 내보이지 않는다. 복사본이 꺼져 있으면 복사본 단계만 건너뛴다.
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

test('2.0 모듈을 한 객체로 펼쳐도 같은 이름에 다른 값이 없다(불러온 함수가 서로 덮이지 않는다)', async () => {
  const seen = new Map();
  for (const p of E.MODULES) for (const [k, v] of Object.entries(await importV2(p))) { if (seen.has(k)) assert.equal(seen.get(k)[1], v, `${k}: ${seen.get(k)[0]} ↔ ${p}`); seen.set(k, [p, v]); }
});

test('매개변수: 면·반·주·달·보기·기간·프로그램·담임·날짜·JJ만, 모양이 아니면 거절', () => {
  const P = screen.params, ok = (k, v) => P[k].test(v);
  assert.deepEqual(Object.keys(P).sort(), ['class', 'date', 'day', 'jj', 'month', 'mv', 'period', 'teacher', 'track', 'view', 'week']);
  for (const [k, v] of [['view', 'sheet'], ['view', 'today'], ['class', 'e175fd4d-a655-409a-905e-71850ab1b848'], ['week', '2026-10-26'], ['month', '2026-10'], ['mv', 'mp'], ['period', 'session'], ['track', 'eie'], ['teacher', 'none'], ['jj', '0']]) assert.ok(ok(k, v), `${k}=${v}`);
  for (const [k, v] of [['view', 'admin'], ['class', 'x'], ['week', '2026-10-26T00'], ['month', '2026-1'], ['mv', 'week'], ['period', 'year'], ['track', 'all,eie'], ['teacher', 'kim'], ['jj', '2']]) assert.ok(!ok(k, v), `${k}=${v} 거절`);
  assert.equal(screen.actions, undefined, '1단계(보기)는 저장 동작이 없다');
});

test('화면 파일: 운영 주소·끼워 넣기·외부 요청·보기 중 쓰기가 없다', async () => {
  for (const f of ['v2-screen-ecs.js', 'v2-screen-ecs.mjs', 'v2-screen-ecs.css']) {
    const text = await here(f);
    assert.ok(!/aywa\.co\.kr|vercel\.app|supabase\.co|https?:\/\/(?!127\.0\.0\.1)/i.test(text), `${f}: 운영 주소`);
    assert.ok(!/<iframe|<embed|<object/i.test(text), `${f}: 끼워 넣기`);
  }
  const page = await here('v2-screen-ecs.js');
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|\.act\(/.test(page), '보기 화면은 서버에 쓰지 않는다(조회는 공통 틀 ctx.load만)');
  assert.ok(!/class="ec-input[^"]*"(?![^>]*\b(?:readonly|disabled)\b)[^>]*>/.test(page), '입력 칸은 모두 읽기 전용');
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

async function page(data, query = '') {
  const srcText = await here('v2-screen-ecs.js');
  let def = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  vm.runInNewContext(srcText, { window: { V2Screens: { register: x => { def = x; }, esc } }, document: { addEventListener() {} }, location: { hash: '' }, URLSearchParams });
  return def.render({ query: new URLSearchParams(query), load: () => ({ status: 'ready', data }), go() {}, refresh() {}, api: {} });
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

test.after(async () => { await db?.end(); });
