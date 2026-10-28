// 2.0 원생 상세 '개요'·'수업' 탭 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-students-tabs-a.mjs
// ① 그리기 = 2.0 탭 파일 본문 그대로(서버 호출 자리만 swaps 짝 · 짝마다 한 번 · 본문 코드에 await 없음) · 감싸개가 같은 이름·props로 선다
// ② 숫자 = 독립 SQL(재원생·휴원생·퇴원생 — 30일 출결 · 수강 · 청구·미납 · 상담 · 특이사항 · 통합 성적 출처별 건수 · 수강 줄의 요일·담임 ·
//    배정 후보 반 수·오늘 명단 인원 · 지난 수업 담임 근거) ③ 화면 글자에 '2.0'·개발자용 말이 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const codeOnly = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

const TABS = [
  { tab: 'overview', file: 'app/(shell)/students/[id]/_tabs/overview-tab.tsx', start: 'const won = (n: number) => n.toLocaleString();', name: 'OverviewTab', body: 'OverviewTabBody' },
  { tab: 'classes', file: 'app/(shell)/students/[id]/_tabs/classes-tab.tsx', start: 'const DAY_CODE_LABEL: Record<string, string> = {', name: 'ClassesTab', body: 'ClassesTabBody' },
];

test('그리기 = 2.0 탭 본문 그대로(swaps 짝마다 한 번) · 감싸개 = 같은 이름의 export · 본문 코드에 await 없음', async () => {
  for (const x of TABS) {
    const orig = lf(await src(x.file)), mine = lf(await here(`./v2-host/src/students-tab-${x.tab}.tsx`));
    const swaps = JSON.parse(await here(`./v2-host/src/students-tab-${x.tab}.swaps.json`));
    let body = orig.slice(orig.indexOf(x.start));
    for (const [from, to] of swaps.body) { assert.equal(body.split(from).length, 2, `${x.tab}: ${from.slice(0, 50)}`); body = body.replace(from, to); }
    assert.ok(mine.indexOf(x.start) > 0, x.tab);
    assert.equal(mine.slice(mine.indexOf(x.start)), body, `${x.tab} 본문`);
    assert.ok(!/\bawait\b/.test(codeOnly(body)), `${x.tab}: 본문 코드에 await`);
    assert.match(mine, new RegExp(`export function ${x.name}\\(props`), `${x.tab}: 감싸개`);
    assert.match(mine, new RegExp(`<${x.body} \\{\\.\\.\\.props\\} />`), `${x.tab}: 감싸개가 본문을 그린다`);
    // 서버에서 Promise.all이 받던 이름 = 호스트가 자료에서 꺼내는 이름(v2-students-tab-<탭>.mjs loadTab의 열쇠).
    const names = /const \[([^\]]+)\] = await Promise\.all/.exec(orig)[1].split(',').map((s) => s.trim());
    const server = lf(await here(`./v2-students-tab-${x.tab}.mjs`)), block = server.slice(server.indexOf('export async function loadTab'));
    const returned = block.slice(block.indexOf('  return {'), block.indexOf('};', block.indexOf('  return {')));
    assert.ok(returned.length > 10, `${x.tab}: loadTab 반환을 찾지 못함`);
    for (const n of names) assert.ok(new RegExp(`\\b${n}\\b`).test(returned), `${x.tab}: loadTab이 ${n}을 싣는다`);
  }
});

test('화면 글자에 "2.0"·개발자용 말이 없다(주석 뺀 코드)', async () => {
  for (const x of TABS) {
    const code = codeOnly(lf(await here(`./v2-host/src/students-tab-${x.tab}.tsx`))).replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((s) => /[가-힣]/.test(s));
    for (const s of strings) assert.ok(!/2\.0|v2|복사본|Docker|API|tenant|함수/.test(s), `${x.tab}: ${s}`);
  }
});

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var { screen } = await import('./v2-screen-students.mjs');
  var today = (await copyClock()).day;
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (sql, id, tab) => screen.load({ sql, params: { v2path: `/students/${id}`, tab }, tenantId: t, importV2 }).then((d) => { assert.equal(d.tab.key, tab); return d.tab.data; });
  var addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  // 재원생(성적·청구·상담·특이사항이 다 있는 학생 먼저) · 휴원생 · 퇴원생 · 지난 수업이 있는 재원생.
  var picks = await db`(select id::text id, 'enrolled-rich' kind from public.students s where tenant_id=${t} and status='enrolled'
        and exists(select 1 from public.student_grades g where g.student_id=s.id) and exists(select 1 from public.invoices i where i.student_id=s.id)
        and exists(select 1 from public.student_consultations c where c.student_id=s.id) and exists(select 1 from public.student_memos m where m.student_id=s.id) limit 1)
    union all (select id::text, 'enrolled-reports' from public.students s where tenant_id=${t} and status='enrolled'
        and exists(select 1 from public.lesson_reports r where r.student_id=s.id and coalesce(r.daily_test,'') <> '') limit 1)
    union all (select id::text, 'on_hold' from public.students where tenant_id=${t} and status='on_hold' limit 1)
    union all (select id::text, 'withdrawn' from public.students s where tenant_id=${t} and status='withdrawn' and exists(select 1 from public.enrollments e where e.student_id=s.id) limit 1)
    union all (select s.id::text, 'past' from public.students s where tenant_id=${t} and status='enrolled'
        and exists(select 1 from public.enrollments e where e.student_id=s.id and e.end_date < ${today}::date) limit 1)`;
}

test('개요 = 독립 SQL(30일 출결 · 수강 · 청구·미납 · 상담 · 특이사항 · 통합 성적 출처별 건수)', { skip: SKIP }, async () => {
  assert.ok(picks.length >= 4, '시험할 학생이 있어야 한다');
  await ro(async (sql) => {
    for (const { id, kind } of picks) {
      const d = await load(sql, id, 'overview');
      // 30일 출결 — 칸(학생·반·수업일·교시)마다 기록 시각이 가장 늦은 줄(같으면 id가 큰 줄).
      const [a] = await sql`with eff as (select distinct on (class_id, session_date, coalesce(slot_start::text, '')) status::text status from public.attendance_records
          where tenant_id=${t} and student_id=${id} and session_date >= ${addDays(today, -30)}::date order by class_id, session_date, coalesce(slot_start::text, ''), recorded_at desc, id desc)
        select count(*)::int total, count(*) filter (where status='present')::int present, count(*) filter (where status='absent')::int absent,
          count(*) filter (where status='late')::int late, count(*) filter (where status='excused')::int excused from eff`;
      for (const k of ['total', 'present', 'absent', 'late', 'excused']) assert.equal(d.attendance[k], a[k], `${kind} 출결 ${k}`);
      assert.equal(d.attendance.rate, a.total ? ((a.present + a.late) / a.total) * 100 : 0, `${kind} 출석률`);
      const [c] = await sql`select (select count(*)::int from public.enrollments where tenant_id=${t} and student_id=${id}) enr,
          (select count(*)::int from public.invoices where tenant_id=${t} and student_id=${id}) inv,
          (select count(*)::int from public.invoices where tenant_id=${t} and student_id=${id} and status::text in ('unpaid','partial')) unpaid,
          (select coalesce(sum(greatest(0, amount_total - amount_discount - amount_paid)), 0)::float8 from public.invoices where tenant_id=${t} and student_id=${id} and status::text in ('unpaid','partial')) outstanding,
          (select max(period) from public.invoices where tenant_id=${t} and student_id=${id}) last_period,
          (select count(*)::int from public.student_consultations where tenant_id=${t} and student_id=${id}) cons,
          (select count(*)::int from public.student_memos where tenant_id=${t} and student_id=${id}) memos,
          (select count(*)::int from public.student_grades where tenant_id=${t} and student_id=${id}) grades,
          (select count(*)::int from public.level_tests where tenant_id=${t} and student_id=${id} and tested_on >= '1999-07-05') levels`;
      assert.equal(d.enrollments.length, c.enr, `${kind} 수강`);
      assert.equal(d.invoices.length, c.inv, `${kind} 청구`);
      const unpaid = d.invoices.filter((i) => i.status === 'unpaid' || i.status === 'partial');
      assert.equal(unpaid.length, c.unpaid, `${kind} 미납 건수`);
      assert.equal(unpaid.reduce((s, i) => s + Math.max(0, i.amountTotal - i.amountDiscount - i.amountPaid), 0), c.outstanding, `${kind} 미납 금액`);
      if (c.inv) assert.equal(d.invoices[0].period, c.last_period, `${kind} 최근 청구월`);
      assert.equal(d.consultations.length, c.cons, `${kind} 상담`);
      assert.equal(d.memos.length, c.memos, `${kind} 특이사항`);
      assert.ok(d.memos.every((m, i) => i === 0 || !m.pinned || d.memos[i - 1].pinned), `${kind} 고정 특이사항이 먼저`);
      // 통합 성적 — 성적 입력 행은 과목을 아는 한 전부 · 레벨테스트도 · 수업보고서는 일일·확인테스트가 적힌 보고서에서만.
      assert.equal(d.grades.filter((g) => g.source === 'grade').length, c.grades, `${kind} 성적 입력`);
      assert.equal(d.grades.filter((g) => g.source === 'level').length, c.levels, `${kind} 레벨테스트`);
      const reportIds = new Set((await sql`select id::text id from public.lesson_reports where tenant_id=${t} and student_id=${id}
        and (coalesce(daily_test,'') <> '' or coalesce(check_test,'') <> '' or coalesce(exam_info,'') <> '')`).map((r) => r.id));
      for (const g of d.grades.filter((x) => x.source === 'report')) assert.ok(reportIds.has(g.sourceId), `${kind} 보고서 성적의 출처`);
      if (kind === 'enrolled-reports') assert.ok(d.grades.some((g) => g.source === 'report'), '수업보고서 일일테스트가 성적에 든다');
      for (let i = 1; i < d.grades.length; i += 1) assert.ok(d.grades[i - 1].date >= d.grades[i].date, `${kind} 최신순`);
      assert.equal(d.lang, 'ko'); assert.deepEqual(d.teacherNames, {});
    }
  });
});

test('수업 = 독립 SQL(수강 줄 · 담임 · 지금 다니는 반의 요일 · 배정 후보 반 · 오늘 명단 인원 · 지난 수업 담임 근거)', { skip: SKIP }, async () => {
  const KO = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
  await ro(async (sql) => {
    for (const { id, kind } of picks) {
      const d = await load(sql, id, 'classes');
      const ens = await sql`select e.id::text id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, e.attendance_days::text[] att,
          c.class_name, u.display_name teacher from public.enrollments e left join public.classes c on c.id = e.class_id left join public.users u on u.id = c.teacher_id
        where e.tenant_id=${t} and e.student_id=${id}`;
      assert.deepEqual(d.rows.map((r) => r.enrollmentId).sort(), ens.map((e) => e.id).sort(), `${kind} 수강 줄`);
      for (const r of d.rows) {
        const e = ens.find((x) => x.id === r.enrollmentId);
        assert.equal(r.className, e.class_name ?? '?'); assert.equal(r.teacherName, e.teacher ?? null, `${kind} 담임`);
        const ended = e.end_date && (e.is_transferred ? e.end_date <= today : e.end_date < today);
        if (ended || e.start_date > today) continue;
        // 지금 다니는 반 — 스케줄 요일 = 오늘 유효한 교시의 요일(분리등원이면 그 요일만, 따로 수업 가르기 전 기준과 같거나 좁다).
        const live = (await sql`select distinct day_of_week::text d from public.class_schedules where tenant_id=${t} and class_id=${e.class_id}
          and valid_from <= ${today}::date and (valid_to is null or valid_to >= ${today}::date)`).map((x) => x.d);
        const want = new Set(live.filter((x) => !e.att?.length || e.att.includes(x)).map((x) => KO[x]));
        const shown = new Set(r.schedule.flatMap((g) => g.days));
        for (const day of shown) assert.ok(want.has(day), `${kind} ${r.className}: 보인 요일 ${day}는 오늘 유효한 교시`);
        assert.deepEqual([...r.classDays].sort(), [...new Set(live)].sort(), `${kind} ${r.className}: 반 운영 요일`);
      }
      const cls = await sql`select c.id::text id from public.classes c where c.tenant_id=${t} and c.is_active`;
      assert.equal(d.allActiveClasses.length, cls.length, `${kind} 배정 후보 = 운영 중 반`);
      const counts = new Map((await sql`select class_id::text class_id, count(*)::int n from public.enrollments where tenant_id=${t} and start_date <= ${today}::date
          and (end_date is null or end_date > ${today}::date or (end_date = ${today}::date and not coalesce(is_transferred, false))) group by 1`).map((r) => [r.class_id, r.n]));
      for (const c of d.allActiveClasses) assert.equal(c.studentCount, counts.get(c.id) ?? 0, `${kind} ${c.className} 인원`);
      // 지난 수업 담임 — 근거가 담임 이력이면 추정이 아니다 · 이름은 실제 계정 이름.
      const names = new Set((await sql`select display_name from public.users where tenant_id=${t}`).map((r) => r.display_name));
      for (const [enrollmentId, p] of d.pastTeacherList) {
        assert.ok(ens.some((e) => e.id === enrollmentId), '지난 수업의 수강');
        assert.equal(p.inferred, p.source !== 'assignment', `${kind} 추정 표시`);
        if (p.source !== 'report') assert.ok(names.has(p.name), `${kind} ${p.name}`);
      }
      if (kind === 'past') assert.ok(d.rows.some((r) => r.endDate && r.endDate < today), '지난 수업이 있다');
    }
  });
});

test.after(() => db?.end());
