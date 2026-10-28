// 2.0 화면 — 원생목록 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-students-list.mjs
// ① 그리기 = 2.0 page.tsx 본문 그대로(서버 호출 자리만 students-list.swaps.json 짝 · 일부러 뺀 두 요소만 다르다 — 글자 대조)
// ② 숫자 = 독립 SQL(재원 총원·과목별 카드 · 상태별 건수 · 쪽 50명 · 검색(이름·학교·전화·메모 허용분·학부모) · 학년·과목(미수강 포함)·담임(여럿) 필터 ·
//    정렬 이름/학년(2.0 sortByGrade) · '미수강 제외' · 아직 시작 안 한 학생 감춤) ③ 화면 글자에 '2.0'·개발자용 말이 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStudentList, PAGE_SIZE } from './v2-students-list.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const START = '// 상태 — 디폴트(재원)는 파라미터가 없을 때다';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var today = (await copyClock()).day;
  var G = await importV2('features/students/grade-sort.ts');
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var list = (sql, sp) => buildStudentList({ sql, tenantId: t, importV2, sp });
  /** 아직 한 과목도 시작 안 한 재원생(독립 SQL) — 활성 수강(종료 없음 · 휴원 아님 · 반 있음)은 있는데 전부 오늘 뒤 시작. */
  var notStartedSql = (sql) => sql`select s.id::text id from public.students s where s.tenant_id=${t} and s.status='enrolled'
    and exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and e.end_date is null and e.on_hold=false)
    and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and e.end_date is null and e.on_hold=false
      and (e.start_date is null or e.start_date <= ${today}::date))`;
}

test('그리기 = 2.0 page.tsx 본문 그대로 — 서버 호출 자리만 swaps 짝(짝마다 한 번) · 뺀 것은 계정 보기 설정 저장과 동기화 배지 둘뿐', async () => {
  const orig = lf(await src('app/(shell)/students/page.tsx')), mine = lf(await here('./v2-host/src/students-list.tsx'));
  const swaps = JSON.parse(await here('./v2-host/src/students-list.swaps.json'));
  let body = orig.slice(orig.indexOf(START));
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, to); }
  assert.equal(swaps.removed.length, 2);
  assert.match(swaps.removed[0], /<RememberPrefs /); assert.match(swaps.removed[1], /<MakeeduSyncBadge /);
  for (const r of swaps.removed) { assert.equal(body.split(r).length, 2, r); body = body.replace(r, ''); }
  assert.equal(mine.slice(mine.indexOf(START)), body);
  // 바꾼 자리에 서버 호출이 남지 않는다(주석 뺀 코드에 await 없음 — 호스트는 동기 부품).
  assert.ok(!/\bawait\b/.test(body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')), '본문 코드에 await가 남았다');
  for (const name of ['requireAccess', 'getStudentsPage', 'getEnrolledStatCounts', 'getTenantSettings', 'restrictIdsFor', 'loadStudentListPrefs', 'MakeeduSyncBadge', 'RememberPrefs'])
    assert.ok(!new RegExp(`\\b${name}\\b`).test(body.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), `${name}이 남았다`);
});

test('재원 총원·과목별 카드 = 독립 SQL(아직 시작 안 한 학생 뺌 · 과목별 = 시작한 활성 수강의 학생) · 재원 목록 총계 = 카드 · 감춘 수 = 시작 안 한 학생', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const d = await list(sql, {});
    const notStarted = (await notStartedSql(sql)).map((r) => r.id);
    const [{ n }] = await sql`select count(*)::int n from public.students where tenant_id=${t} and status='enrolled' and id <> all(${notStarted}::uuid[])`;
    assert.equal(d.counts.enrolled, n, '재원 총원');
    const subj = await sql`select c.subject, count(distinct e.student_id)::int n from public.enrollments e join public.classes c on c.id=e.class_id join public.students s on s.id=e.student_id
      where e.tenant_id=${t} and s.status='enrolled' and e.end_date is null and e.on_hold=false and (e.start_date is null or e.start_date <= ${today}::date) and c.subject is not null and c.subject <> ''
      group by 1`;
    assert.deepEqual(d.counts.bySubject, Object.fromEntries(subj.map((r) => [r.subject, r.n])), '과목별');
    assert.equal(d.page.total, n, '재원 목록 총계 = 카드');
    assert.equal(d.page.hiddenNotStarted, notStarted.length);
    assert.equal(d.page.rows.length, Math.min(PAGE_SIZE, n));
    assert.ok(d.page.rows.every((r) => !notStarted.includes(r.id)));
    assert.equal(d.resolved.status, 'enrolled'); assert.equal(d.resolved.sort, 'grade');
  });
});

test('상태별 건수 = 독립 SQL(전체·예비·휴원·퇴원 — 시작 안 한 학생은 재원에서만 감춘다) · 검색 중엔 기본 상태 = 전체 · 쪽 넘김', { skip: SKIP }, async () => {
  await run(async (sql) => {
    for (const status of ['all', 'consulted', 'on_hold', 'withdrawn']) {
      const d = await list(sql, { status });
      const [{ n }] = await sql`select count(*)::int n from public.students where tenant_id=${t} and (${status} = 'all' or status::text = ${status})`;
      assert.equal(d.page.total, n, status); assert.equal(d.page.hiddenNotStarted, 0);
    }
    const all = await list(sql, { status: 'all' });
    assert.ok(all.page.total > PAGE_SIZE, '쪽 넘김을 시험하려면 50명 넘게 있어야 한다');
    const p2 = await list(sql, { status: 'all', page: '2' });
    const ordered = G.sortByGrade(await sql`select id::text id, name, grade from public.students where tenant_id=${t} order by grade, name, id`, false);
    assert.deepEqual(all.page.rows.map((r) => r.id), ordered.slice(0, PAGE_SIZE).map((r) => r.id), '1쪽 = 학년순(2.0 sortByGrade)');
    assert.deepEqual(p2.page.rows.map((r) => r.id), ordered.slice(PAGE_SIZE, PAGE_SIZE * 2).map((r) => r.id), '2쪽');
    const q = await list(sql, { q: '김' });
    assert.equal(q.resolved.status, 'all', '검색 중 기본 상태 = 전체');
  });
});

test('검색 = 독립 SQL(기본: 이름·영어 이름·학교·학생·학부모 전화·학부모명 + 검색 허용 메모 + 연결된 콜&상담 학부모명 · 범위를 고르면 그 칸만)', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const ids = async (sp) => { const d = await list(sql, { status: 'all', ...sp }); assert.ok(d.page.total <= 500); return d.page.total; };
    const cnt = async (where) => (await sql`select count(*)::int n from public.students s where s.tenant_id=${t} and (${where})`)[0].n;
    const [{ school }] = await sql`select school from public.students where tenant_id=${t} and school is not null and school <> '' group by school order by count(*) desc limit 1`;
    const term = school.slice(0, 2);
    assert.equal(await ids({ q: term, field: 'school' }), await cnt(sql`s.school ilike ${`%${term}%`}`), '학교');
    const [{ phone }] = await sql`select right(parent_phone, 4) phone from public.students where tenant_id=${t} and parent_phone ~ '[0-9]{4}$' limit 1`;
    assert.equal(await ids({ q: phone, field: 'phone' }), await cnt(sql`(s.student_phone ilike ${`%${phone}%`} or s.parent_phone ilike ${`%${phone}%`})`), '전화');
    // 기본 검색 = 여섯 칸 + 검색 허용 메모 + 연결된 콜&상담 학부모명(합쳐 200명까지).
    const like = `%${term}%`;
    const extra = (await sql`select student_id::text id from public.student_memos where tenant_id=${t} and searchable and content ilike ${like}
      union select student_id::text from public.enrollment_consultations where tenant_id=${t} and student_id is not null and parent_name ilike ${like}`).map((r) => r.id);
    assert.ok(extra.length <= 200);
    assert.equal(await ids({ q: term }), await cnt(sql`(s.name ilike ${like} or s.english_name ilike ${like} or s.school ilike ${like} or s.student_phone ilike ${like}
      or s.parent_phone ilike ${like} or s.parent_name ilike ${like} or s.id = any(${extra}::uuid[]))`), '기본 검색');
    // 메모 검색 허용분만 — 끈 메모는 학생을 올리지 않는다.
    const [memo] = await sql`select m.student_id::text id, substr(m.content, 1, 6) part from public.student_memos m where m.tenant_id=${t} and m.searchable and length(m.content) >= 6
      and m.content !~ '[,()*%_]' limit 1`;
    if (memo) { const d = await list(sql, { status: 'all', q: memo.part }); assert.ok(d.page.rows.some((r) => r.id === memo.id) || d.page.total > PAGE_SIZE, '허용 메모로 찾는다'); }
    const [off] = await sql`select m.student_id::text id, m.content from public.student_memos m join public.students s on s.id=m.student_id where m.tenant_id=${t} and not m.searchable
      and length(m.content) >= 8 and m.content !~ '[,()*%_]' and not exists(select 1 from public.student_memos x where x.student_id=m.student_id and x.searchable) limit 1`;
    if (off) {
      const q = off.content.slice(0, 8), d = await list(sql, { status: 'all', q, field: 'memo' });
      assert.equal(d.page.total, await cnt(sql`s.notes ilike ${`%${q}%`}`), '범위 = 메모(학생 메모 칸)만 · 끈 메모는 안 탄다');
    }
  });
});

test('학년·과목(미수강 포함)·담임(여럿)·미수강 제외 필터 = 독립 SQL', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const notStarted = (await notStartedSql(sql)).map((r) => r.id);
    const enrolledWhere = sql`s.tenant_id=${t} and s.status='enrolled' and s.id <> all(${notStarted}::uuid[])`;
    const cnt = async (where) => (await sql`select count(*)::int n from public.students s where ${enrolledWhere} and (${where})`)[0].n;
    // 학년 둘(합집합).
    const grades = (await sql`select grade from public.students where tenant_id=${t} and status='enrolled' and grade is not null group by grade order by count(*) desc limit 2`).map((r) => r.grade);
    assert.equal((await list(sql, { grade: grades.join(',') })).page.total, await cnt(sql`s.grade = any(${grades})`), '학년');
    // 과목 = 그 과목 반에 종료 안 된 · 휴원 아닌 수강이 있는 학생.
    const takes = (subjects) => sql`exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and e.end_date is null and e.on_hold=false and c.subject = any(${subjects}))`;
    assert.equal((await list(sql, { subject: 'math' })).page.total, await cnt(takes(['math'])), '수학');
    assert.equal((await list(sql, { subject: 'math,english' })).page.total, await cnt(takes(['math', 'english'])), '수학·영어');
    // 미수강 = 시작한 활성 수강이 하나도 없는 학생 · 과목과 함께면 합집합.
    const active = sql`exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and e.end_date is null and e.on_hold=false
      and (e.start_date is null or e.start_date <= ${today}::date))`;
    assert.equal((await list(sql, { subject: '__none__' })).page.total, await cnt(sql`not ${active}`), '미수강');
    assert.equal((await list(sql, { subject: 'math,__none__' })).page.total, await cnt(sql`${takes(['math'])} or not ${active}`), '수학 + 미수강');
    // 담임 여럿 = 그 강사들 반(종료 안 된 수강)의 학생 합집합.
    const teachers = (await sql`select c.teacher_id::text id from public.classes c join public.enrollments e on e.class_id=c.id where c.tenant_id=${t} and c.teacher_id is not null and e.end_date is null
      group by 1 order by count(*) desc limit 2`).map((r) => r.id);
    const teaches = (ids) => sql`exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=s.id and e.end_date is null and c.teacher_id = any(${ids}::uuid[]))`;
    assert.equal((await list(sql, { teacher: teachers[0] })).page.total, await cnt(teaches([teachers[0]])), '담임 한 명');
    assert.equal((await list(sql, { teacher: teachers.join(',') })).page.total, await cnt(teaches(teachers)), '담임 둘');
    // 미수강 제외(전체 상태) = 종료 안 된 수강이 있는 학생(휴원 수강도 수강 중).
    const [{ n }] = await sql`select count(*)::int n from public.students s where s.tenant_id=${t} and exists(select 1 from public.enrollments e where e.student_id=s.id and e.end_date is null)`;
    assert.equal((await list(sql, { status: 'all', noenr: '1' })).page.total, n, '미수강 제외');
    // 퇴원 목록에선 미수강 제외를 무시한다.
    const w = await list(sql, { status: 'withdrawn' }), wn = await list(sql, { status: 'withdrawn', noenr: '1' });
    assert.equal(wn.page.total, w.page.total);
  });
});

test('정렬 = 이름(DB 순서 · 같은 이름은 id) · 학년(2.0 sortByGrade, 내림차순 포함) · 줄의 과목·담당 강사 = 활성 수강(휴원 제외 · 정렬)', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const notStarted = (await notStartedSql(sql)).map((r) => r.id);
    const base = await sql`select id::text id, name, grade from public.students where tenant_id=${t} and status='enrolled' and id <> all(${notStarted}::uuid[]) order by name, id`;
    assert.deepEqual((await list(sql, { sort: 'name' })).page.rows.map((r) => r.id), base.slice(0, PAGE_SIZE).map((r) => r.id), '이름순');
    const desc = await sql`select id::text id from public.students where tenant_id=${t} and status='enrolled' and id <> all(${notStarted}::uuid[]) order by name desc, id`;
    assert.deepEqual((await list(sql, { sort: 'name_desc' })).page.rows.map((r) => r.id), desc.slice(0, PAGE_SIZE).map((r) => r.id), '이름 역순');
    const byGradeDesc = G.sortByGrade(await sql`select id::text id, name, grade from public.students where tenant_id=${t} and status='enrolled' and id <> all(${notStarted}::uuid[]) order by grade, name, id`, true);
    assert.deepEqual((await list(sql, { sort: 'grade_desc' })).page.rows.map((r) => r.id), byGradeDesc.slice(0, PAGE_SIZE).map((r) => r.id), '학년 내림차순');
    const d = await list(sql, {});
    for (const r of d.page.rows.slice(0, 20)) {
      const ens = await sql`select c.subject, u.display_name from public.enrollments e left join public.classes c on c.id=e.class_id left join public.users u on u.id=c.teacher_id
        where e.student_id=${r.id} and e.end_date is null and e.on_hold=false`;
      assert.deepEqual(r.subjects, [...new Set(ens.map((e) => e.subject).filter(Boolean))].sort(), `${r.name} 과목`);
      assert.deepEqual(r.teacherNames, [...new Set(ens.map((e) => e.display_name).filter(Boolean))].sort(), `${r.name} 담당 강사`);
    }
  });
});

test('운영실 ↗ 집합(프로그램 · 재원생 구성) = 운영실과 같은 판정 · 목록은 그 집합 안에서만', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const d = await list(sql, { program: 'math' }), all = await list(sql, { status: 'all' });
    assert.ok(d.resolved.restricted > 0, '수학 프로그램 학생이 있어야 한다');
    assert.equal(d.page.total, d.resolved.restricted, '재원 목록 안에서 집합 그대로(집합이 재원생 기준이다)');
    assert.ok(d.page.rows.every((r) => r.subjects.includes('math') || r.subjects.some((s) => s.startsWith('subject_'))), '수학 계열을 듣는다');
    assert.ok(all.page.total >= d.page.total);
  });
});

test('화면 글자에 "2.0"·개발자용 말이 없다(호스트 목록 · 서버 모듈 — 주석 뺀 코드)', async () => {
  for (const f of ['./v2-host/src/students-list.tsx', './v2-students-list.mjs']) {
    const code = lf(await here(f)).split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    for (const s of strings) assert.ok(!/2\.0|v2|복사본|Docker|API|tenant|함수/.test(s), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
