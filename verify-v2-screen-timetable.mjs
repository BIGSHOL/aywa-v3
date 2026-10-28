// 2.0 화면 — 시간표 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-timetable.mjs
// ① 원자료가 2.0 서버 함수의 모양 그대로인가(ScheduleSlot·StudentLine 칸) ② 이력 행(#88)·퇴원 줄 판정을 독립 SQL로 대조
// ③ 옮긴 설정 병합(resolve.ts)이 2.0 원문과 같은가 ④ 호스트가 2.0 부품을 고치지 않고 묶이는가(서버 전용 유입 0 · 운영 주소 0)
// ⑤ 3.0 쪽은 같은 출처 iframe 자리뿐(운영 2.0 주소·끼워 넣기·저장 요청 없음). 브라우저 확인 스크립트는 work/owner-concept/v2-timetable/.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as T from './v2-screen-timetable.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const R = await T.loadRules(importV2);

await check('옮긴 설정 병합(deepMerge·normalizeSubjects)이 2.0 resolve.ts 본문과 같다', async () => {
  const ts = (await import('typescript')).default;
  const resolve = await src('features/owner/resolve.ts'), mine = await here('./v2-screen-timetable.mjs');
  const fn = (raw, name) => { const text = raw.replace(/\r\n/g, '\n'), i = text.indexOf(`function ${name}`), end = text.indexOf('\n}\n', i); assert.ok(i >= 0 && end > i, `${name} 본문을 찾지 못함`); return text.slice(i, end + 2); };
  // 2.0 본문은 TypeScript로 타입만 걷어 내고, 둘 다 주석·공백·세미콜론을 뺀 글자로 비교한다(로직이 한 글자라도 다르면 실패).
  const norm = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '');
  for (const name of ['deepMerge', 'normalizeSubjects']) assert.equal(norm(fn(mine, name)), norm(fn(resolve, name)), name);
  assert.deepEqual(T.deepMerge({ a: [1], b: { c: 1, d: 2 }, e: 1 }, { a: [2, 3], b: { c: null, x: 9 }, e: null, z: 1 }), { a: [2, 3], b: { c: 1, d: 2 }, e: 1 });
});

await check('매개변수는 주(week)만 받는다 — 나머지(과목·보기·구분…)는 호스트가 2.0처럼 같은 자료에서 다시 조립한다', () => {
  assert.deepEqual(Object.keys(T.screen.params), ['week']);
  assert.ok(T.screen.params.week.test('2026-10-26') && !T.screen.params.week.test('2026-1-1'));
  assert.equal(T.screen.actions, undefined, '1단계(보기)는 저장 동작이 없다');
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => T.screen.load({ sql, params, tenantId, importV2 }));
try {
  const now = await load({}), past = await load({ week: '2026-09-07' }), bad = await load({ week: '2026-02-31' });
  const queries = await src('features/timetable/server/queries.ts');
  const slotKeys = [...queries.slice(queries.indexOf('export type ScheduleSlot = {'), queries.indexOf('};', queries.indexOf('export type ScheduleSlot = {'))).matchAll(/^\s{2}(\w+)(\?)?:/gm)].map(m => [m[1], !!m[2]]);

  await check('원자료 모양 = 2.0 getWeeklyScheduleWithStudents(배치 칸 전부 · 명단은 반별로 한 번)', () => {
    assert.equal(now.week, R.thisMonday(R.kstToday())); assert.equal(now.referenceDate, R.getWeekReferenceDate(now.week, R.kstToday()));
    assert.equal(bad.week, now.week, '없는 날짜는 이번 주'); assert.equal(past.week, '2026-09-07');
    for (const s of now.allSlots) for (const [k, optional] of slotKeys) if (!optional) assert.ok(k in s, `배치 칸 ${k}`);
    for (const s of now.allSlots) assert.equal(s.studentCount, (now.rosters[s.classId] ?? []).filter(l => l.status === 'active').length);
    const lines = Object.values(now.rosters).flat();
    for (const l of lines) for (const k of ['name', 'grade', 'school', 'enrollmentId', 'studentId', 'status', 'enrollmentDate', 'attendanceDays']) assert.ok(k in l, `명단 칸 ${k}`);
    assert.ok(lines.some(l => l.latestReport), '최근 보고서(같은 RPC)');
    assert.ok(now.settings.operations.subjects.length > 0 && Array.isArray(now.settings.modules.disabled));
    assert.equal(now.viewer.canEdit, true); assert.equal(past.viewer.canEdit, false, '지난 주는 2.0처럼 편집 문이 닫힌다');
    for (const c of Object.values(now.teacherColors)) assert.match(c.bg, /^#[0-9a-f]{3,8}$/i);
  });

  await check('이력 행(#88): 그 주 배치는 요일 칸 날짜에 살아 있는 행만 — 독립 SQL과 배치 행이 같다', async () => {
    for (const d of [now, past]) {
      const start = d.week;
      const rows = await db.begin('isolation level repeatable read read only', sql => sql`
        with days(dow, n) as (values ('mon',0),('tue',1),('wed',2),('thu',3),('fri',4),('sat',5),('sun',6))
        select s.id::text id from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active join days on days.dow = s.day_of_week::text
        where s.tenant_id=${tenantId} and (c.closed_at is null or c.closed_at >= ${d.referenceDate})
          and s.valid_from <= ${start}::date + days.n and (s.valid_to is null or s.valid_to >= ${start}::date + days.n)`);
      assert.deepEqual(d.allSlots.map(s => s.id).sort(), rows.map(r => r.id).sort(), `${d.week} 배치 목록`);
    }
  });

  await check('퇴원 줄은 같은 과목 수강이 남지 않은 학생만 · 한 반에 한 학생은 한 줄', async () => {
    const subjectOf = new Map(now.allSlots.map(s => [s.classId, s.subject]));
    for (const [classId, list] of Object.entries(now.rosters)) assert.equal(new Set(list.map(l => l.studentId)).size, list.length, classId);
    const wd = Object.entries(now.rosters).flatMap(([classId, list]) => list.filter(l => l.status === 'withdrawn').map(l => ({ id: l.studentId, subject: subjectOf.get(classId) })));
    if (!wd.length) return;
    const alive = await db.begin('isolation level repeatable read read only', sql => sql`select distinct e.student_id::text id, c.subject from public.enrollments e join public.classes c on c.id=e.class_id
      join public.students s on s.id=e.student_id where e.tenant_id=${tenantId} and e.student_id = any(${wd.map(w => w.id)}::uuid[]) and e.start_date <= ${now.referenceDate}
      and (e.end_date is null or e.end_date > ${now.referenceDate}) and not (s.status::text='withdrawn' and s.withdrawn_at <= ${now.referenceDate})`);
    const aliveKey = new Set(alive.map(a => `${a.subject}:${a.id}`));
    assert.equal(wd.filter(w => aliveKey.has(`${w.subject}:${w.id}`)).length, 0);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 서버 액션은 자리표시 · 운영 주소·외부 호출 0', async () => {
  // 4310이 내주는 dist/는 건드리지 않는다 — 시험용 폴더에 따로 짓는다.
  const outdir = path.join(os.tmpdir(), `v2-host-verify-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  assert.ok(info.actions.some(a => a.includes('enrollments')), '2.0 서버 액션이 자리표시로 바뀐다');
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('timetable.js', dist), 'utf8'), html = await readFile(new URL('timetable.html', dist), 'utf8');
  assert.ok(!existsSync(new URL('meta.json', dist)), '파일 경로가 담긴 meta.json은 기본으로 쓰지 않는다');
  // 묶음 안의 http(s) 주소는 이름공간·문서 링크뿐이어야 한다 — 서비스 주소(운영 2.0·DB·발송처)는 하나도 없다.
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  assert.match(html, /<script type="module" src="timetable\.js">/); assert.ok(info.cssBytes > 100_000, '2.0 globals.css가 Tailwind로 컴파일된다');
  const css = await readFile(new URL('host.css', dist), 'utf8');
  for (const cls of ['.embed-main', '.border-collapse', '.compact-chrome\\:hidden']) assert.ok(css.includes(cls), `2.0 클래스 ${cls}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 2.0 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-timetable.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  const nav = await here('./v2-host/shims/host-nav.ts');
  assert.match(nav, /window\.location\.origin\)/, '부모에게는 같은 출처로만 알린다');
});

console.log(`v2 timetable: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
