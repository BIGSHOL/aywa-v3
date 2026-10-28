// 2.0 화면 · 원생 상세 탭 시험 — 성적 · 상담 · 특이사항 · 수납 · 타임라인 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-students-tabs-c.mjs
// ① 그리기 = 2.0 탭 본문 그대로(import 묶음 뒤 전부 · 서버 조회 자리만 students-tab-<탭>.swaps.json 짝 · 짝마다 한 번)
// ② 숫자 = 독립 SQL(성적 줄·성적 입력·레벨테스트·목표·평가 · 상담 건수·입학 상담 · 메모 건수·고정·검색 허용 · 청구 건수·합계 · 타임라인 종류별 건수·차례)
// ③ 화면 글자(호스트 머리·서버 모듈)에 '2.0'·개발자용 말이 없다. 기여도 탭은 아직 자리 파일(연습 화면에서 아직 열 수 없는 탭).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const MARKER = '// ── 2.0 탭 본문(글자 그대로 · 바뀐 곳은 swaps.json 짝뿐) ──\n';
const TABS = { memos: 'memos-tab.tsx', billing: 'billing-tab.tsx', timeline: 'timeline-tab.tsx', consultations: 'consultations-tab.tsx', grades: 'grades-tab.tsx' };

/** 2.0 파일에서 import 묶음(과 앞의 빈 줄)을 뺀 나머지. */
function bodyOf(text) {
  const lines = lf(text).split('\n');
  let i = 0, inImport = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (inImport) { if (/;\s*$/.test(l)) inImport = false; continue; }
    if (/^\s*$/.test(l)) continue;
    if (/^import\b/.test(l)) { if (!/;\s*$/.test(l)) inImport = true; continue; }
    break;
  }
  return lines.slice(i).join('\n');
}

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { screen } = await import('./v2-screen-students.mjs');
  var ro = (fn) => db.begin('read only', fn);
  var tabOf = async (sql, id, tab, extra = {}) => {
    const d = await screen.load({ sql, params: { v2path: `/students/${id}`, tab, ...extra }, tenantId: t, importV2 });
    assert.equal(d.tab.key, tab, `${tab} 탭이 골라져야 한다`);
    return d.tab.data;
  };
}

test('그리기 = 2.0 탭 본문 그대로(서버 조회 자리만 swaps.json 짝 · 짝마다 한 번 · 본문 코드에 await 없음)', async () => {
  for (const [key, file] of Object.entries(TABS)) {
    const orig = await src(`app/(shell)/students/[id]/_tabs/${file}`), mine = lf(await here(`./v2-host/src/students-tab-${key}.tsx`));
    const swaps = JSON.parse(await here(`./v2-host/src/students-tab-${key}.swaps.json`));
    let body = bodyOf(orig);
    assert.ok(swaps.body.length > 0, key);
    for (const [from, to] of swaps.body) { assert.equal(body.split(from).length, 2, `${key}: ${from}`); body = body.replace(from, to); }
    assert.ok(mine.includes(MARKER), `${key}: 본문 표식`);
    assert.equal(mine.slice(mine.indexOf(MARKER) + MARKER.length), body, key);
    const code = body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(!/\bawait\b/.test(code), `${key}: 본문 코드에 await가 남았다`);
    assert.ok(!/\basync function\b/.test(code), `${key}: 서버 컴포넌트(async)가 남았다`);
  }
});

test('성적: 줄 = 성적 입력 + 수업보고서 테스트 + 레벨테스트(독립 SQL) · 목록·목표·평가·레벨테스트 건수 · 줄의 반 담임 = 반의 담임', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const picks = await sql`(select student_id::text id from public.student_grades where tenant_id=${t} group by 1 order by count(*) desc limit 2)
      union (select student_id::text from public.lesson_reports where tenant_id=${t} and (daily_test is not null or check_test is not null) group by 1 order by count(*) desc limit 1)`;
    assert.ok(picks.length >= 2);
    for (const { id } of picks) {
      const d = await tabOf(sql, id, 'grades');
      const [{ g, lt, goals, gc }] = await sql`select (select count(*)::int from public.student_grades where tenant_id=${t} and student_id=${id}) g,
        (select count(*)::int from public.level_tests where tenant_id=${t} and student_id=${id}) lt,
        (select count(*)::int from public.grade_goals where tenant_id=${t} and student_id=${id}) goals,
        (select count(*)::int from public.grade_comments where tenant_id=${t} and student_id=${id}) gc`;
      assert.equal(d.grades.length, g, '성적 입력'); assert.equal(d.levelTests.length, lt, '레벨테스트'); assert.equal(d.goals.length, goals, '목표'); assert.equal(d.comments.length, gc, '평가');
      assert.equal(d.rows.filter((r) => r.source === 'grade').length, g, '통합 줄 = 성적 입력 전부');
      assert.equal(d.rows.filter((r) => r.source === 'level').length, lt, '통합 줄 = 레벨테스트 전부(2000-01-01부터 180일 앞까지)');
      // 수업보고서 줄 = 테스트 글이 있는 보고서에서만(일일·확인·시험 정보) · 같은 보고서에서 같은 종류는 한 줄.
      const reportIds = new Set((await sql`select id::text id from public.lesson_reports where tenant_id=${t} and student_id=${id}
        and (coalesce(daily_test, '') <> '' or coalesce(check_test, '') <> '' or coalesce(exam_info, '') <> '')`).map((r) => r.id));
      const rep = d.rows.filter((r) => r.source === 'report');
      for (const r of rep) assert.ok(reportIds.has(r.sourceId), `보고서 줄 ${r.key}`);
      assert.equal(new Set(rep.map((r) => r.key)).size, rep.length, '보고서 줄 key 겹침 없음');
      // 최신순 · 줄의 반 담임 = 그 반의 담임(users.display_name).
      for (let i = 1; i < d.rows.length; i++) assert.ok(d.rows[i - 1].date >= d.rows[i].date, '최신순');
      const teachers = new Map((await sql`select c.id::text id, u.display_name name from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t}`).map((r) => [r.id, r.name ?? null]));
      for (const r of d.rows) for (const c of r.classes) assert.equal(c.teacher, teachers.get(c.id), `${r.key} ${c.name}`);
      // 메모 = 성적 입력의 notes 그대로 · 설정 = 학원 설정 과목.
      const notes = new Map((await sql`select id::text id, notes from public.student_grades where tenant_id=${t} and student_id=${id}`).map((r) => [r.id, r.notes]));
      for (const x of d.grades) assert.equal(x.notes, notes.get(x.id));
      assert.ok(Array.isArray(d.settings.operations.subjects) && d.settings.operations.subjects.length > 0);
      assert.equal(typeof d.goalViews, 'object');
    }
  });
});

test('상담: 이력 = 학생상담 전부(상담일 최신순 · 내부 연결 표식 뗀 요약) · 입학 상담 = 그 학생의 콜&상담 전부(원장 = 권한 있음)', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const picks = await sql`(select student_id::text id from public.student_consultations where tenant_id=${t} group by 1 order by count(*) desc limit 1)
      union (select student_id::text from public.enrollment_consultations where tenant_id=${t} and student_id is not null group by 1 order by count(*) desc limit 1)`;
    for (const { id } of picks) {
      const d = await tabOf(sql, id, 'consultations');
      const sc = await sql`select id::text id from public.student_consultations where tenant_id=${t} and student_id=${id} order by consulted_at desc, id`;
      assert.deepEqual(d.consults.map((c) => c.id), sc.map((r) => r.id), '상담 이력 차례');
      for (const c of d.consults) assert.ok(!/\[EYWA-[A-Z]+:/.test(c.summary ?? ''), '내부 연결 표식이 화면에 남지 않는다');
      const ec = await sql`select id::text id from public.enrollment_consultations where tenant_id=${t} and student_id=${id} order by created_at desc, id`;
      assert.equal(d.enrollResult.status, 'ok');
      assert.deepEqual(d.enrollResult.rows.map((r) => r.id), ec.map((r) => r.id), '입학 상담');
      assert.ok(Array.isArray(d.settings.operations.subjects));
    }
  });
});

test('특이사항: 메모 건수 · 고정 먼저 · 검색 허용 · 작성자 이름', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const [{ id }] = await sql`select student_id::text id from public.student_memos where tenant_id=${t} group by 1 order by count(*) desc limit 1`;
    const d = await tabOf(sql, id, 'memos');
    const rows = await sql`select m.id::text id, m.pinned, coalesce(m.searchable, true) searchable, u.display_name name from public.student_memos m
      left join public.users u on u.id=m.created_by where m.tenant_id=${t} and m.student_id=${id} order by m.pinned desc, m.created_at desc, m.id`;
    assert.deepEqual(d.memos.map((m) => [m.id, m.pinned, m.searchable, m.createdByName]), rows.map((r) => [r.id, r.pinned ?? false, r.searchable, r.name ?? null]));
  });
});

test('수납: 청구 건수 · 청구월 내림차순 · 청구·납부·할인 합계 · 항목', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const [{ id }] = await sql`select student_id::text id from public.invoices where tenant_id=${t} group by 1 order by count(*) desc limit 1`;
    const d = await tabOf(sql, id, 'billing');
    const [s] = await sql`select count(*)::int n, sum(amount_total)::float8 total, sum(amount_paid)::float8 paid, sum(amount_discount)::float8 discount
      from public.invoices where tenant_id=${t} and student_id=${id}`;
    assert.equal(d.invoices.length, s.n);
    const sum = (k) => d.invoices.reduce((a, r) => a + r[k], 0);
    assert.equal(sum('amountTotal'), s.total); assert.equal(sum('amountPaid'), s.paid); assert.equal(sum('amountDiscount'), s.discount);
    for (let i = 1; i < d.invoices.length; i++) assert.ok(d.invoices[i - 1].period >= d.invoices[i].period, '청구월 내림차순');
    for (const r of d.invoices) for (const li of r.lineItems) assert.ok(typeof li.description === 'string' && Number.isFinite(li.amount));
  });
});

test('타임라인: 종류별 건수 = 독립 SQL(상담 · 특이사항 · 성적 · 교재 · 입학 상담 · 재원 시작·퇴원) · 수강 이력 사건이 선다 · 최신순', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const picks = await sql`(select (changed->>'student_id') id from public.activity_log where tenant_id=${t} and table_name='enrollments' and op='DELETE' and changed->>'student_id' is not null limit 1)
      union (select student_id::text from public.textbook_orders where tenant_id=${t} and student_id is not null group by 1 order by count(*) desc limit 1)
      union (select id::text from public.students where tenant_id=${t} and status='withdrawn' and withdrawn_at is not null limit 1)`;
    assert.ok(picks.length >= 2);
    for (const { id } of picks) {
      const d = await tabOf(sql, id, 'timeline');
      const count = (kind) => d.events.filter((e) => e.kind === kind).length;
      const [c] = await sql`select (select count(*)::int from public.student_consultations where tenant_id=${t} and student_id=${id}) consultation,
        (select count(*)::int from public.student_memos where tenant_id=${t} and student_id=${id}) memo,
        (select count(*)::int from public.student_grades where tenant_id=${t} and student_id=${id}) grade,
        (select count(*)::int from public.textbook_orders where tenant_id=${t} and student_id=${id}) textbook,
        (select count(*)::int from public.enrollment_consultations where tenant_id=${t} and student_id=${id}) enrollment_consultation,
        (select count(*)::int from public.enrollments where tenant_id=${t} and student_id=${id}) enrollments`;
      for (const k of ['consultation', 'memo', 'grade', 'textbook', 'enrollment_consultation']) assert.equal(count(k), c[k], `${id} ${k}`);
      const [s] = await sql`select enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, coalesce(notes, '') ~ ${'^\\s*중복 병합:\\s*\\S+와 통합됨'} merged
        from public.students where tenant_id=${t} and id=${id}`;
      assert.equal(count('status_change'), (s.enrolled_at ? 1 : 0) + (s.withdrawn_at && !s.merged ? 1 : 0), '재원 시작·퇴원');
      if (c.enrollments > 0) assert.ok(count('enrollment_start') > 0, '수강 시작 사건');
      for (let i = 1; i < d.events.length; i++) assert.ok(d.events[i - 1].date >= d.events[i].date, '최신순');
    }
    // 삭제된 수강이 있는 학생이면 '수강 이력 삭제' 사건이 선다(변경 로그 activity_log를 읽었다).
    const [del] = await sql`select (changed->>'student_id') id from public.activity_log where tenant_id=${t} and table_name='enrollments' and op='DELETE' and changed->>'student_id' is not null limit 1`;
    if (del) assert.ok((await tabOf(sql, del.id, 'timeline')).events.some((e) => e.kind === 'enrollment_delete'), '수강 이력 삭제 사건');
  });
});

test('화면 글자(호스트 머리 · 서버 모듈)에 "2.0"·개발자용 말이 없다(주석 뺀 코드 · 원장 10-28)', async () => {
  const files = [...Object.keys(TABS).map((k) => `./v2-host/src/students-tab-${k}.tsx`), ...Object.keys(TABS).map((k) => `./v2-students-tab-${k}.mjs`)];
  for (const f of files) {
    let code = lf(await here(f));
    if (code.includes(MARKER)) code = code.slice(0, code.indexOf(MARKER)); // 본문은 2.0 글자 그대로라 대상 밖
    code = code.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    for (const s of strings) assert.ok(!/2\.0|v2|복사본|Docker|API|tenant|함수/.test(s), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
