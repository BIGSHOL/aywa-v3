// 2.0 화면 · 수업보고서 관리 — 클래스노트 면 다섯 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-lesson-reports-classnote.mjs
// ① 발송 큐 = 독립 SQL(3일 창 ∪ 사람 조치 ∪ 기한 안 실패 · 상태별 수 · 기한 넘긴 건 · 연동 PC 접속 판정)
// ② 반 구성 = 독립 SQL(영어 활성 반 · 반마다 지금 재원생 · 보드 동기화 시각) ③ 반 공지 = 독립 SQL(최근 20건 · 대상 반 인원 · 반 보드 반)
// ④ 직접 발송 = 재원생 전원(학년 → 이름 순) · 학원 설정 칸 ⑤ 학부모 글 = 독립 SQL(14일 창 수 · 첫 쪽 100건 · 답글 수)
// ⑥ 바깥 호출 없음(모듈에 네트워크 호출이 없다) · 화면 글자에 '2.0'·개발자용 말이 없다 ⑦ 부품이 다시 읽는 값(cnread) = 면과 같은 모양.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen } from './v2-screen-lesson-reports.mjs';
import * as R from './v2-lesson-reports-classnote-reads.mjs';

const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const FILES = ['v2-lesson-reports-classnote-reads.mjs', ...['queue', 'boards', 'notice', 'compose', 'parent_replies'].map((f) => `v2-lesson-reports-face-${f}.mjs`)];

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

const ctx = async () => {
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { copyClock } = await import('./v2-onescreen-roster.mjs');
  return { t, importV2, clock: await copyClock() };
};
const open = (sql, t, importV2, section) => screen.load({ sql, params: { tab: 'classnote', ...(section ? { section } : {}) }, tenantId: t, importV2 });
const ymdMinus = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test('바깥 호출 없음 · 화면 글자에 개발용 말이 없다', async () => {
  for (const f of FILES) {
    const code = (await here(`./${f}`)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\bfetch\s*\(|node:https?|node:net|XMLHttpRequest|WebSocket/.test(code), `${f}: 네트워크 호출`);
    for (const [, s] of code.matchAll(/'([^'\n]*[가-힣][^'\n]*)'/g)) assert.ok(!/2\.0|복사본|Docker|SQL|v2|3\.0/.test(s), `${f}: "${s}"`);
  }
});

test('발송 큐 = 독립 SQL — 상태별 수 · 주의/진행 목록 · 기한 넘긴 건 · 연동 PC', { skip: SKIP }, async () => {
  const { t, importV2, clock } = await ctx();
  await db.begin('read only', async (sql) => {
    const d = await open(sql, t, importV2);
    assert.equal(d.tab, 'queue');
    assert.deepEqual(d.tabData, { rates: null });
    const q = d.queue, today = clock.day;
    assert.equal(q.todayKst, today);
    assert.equal(q.nowMs, clock.at.getTime());
    assert.equal(q.days, 3);
    assert.equal(q.since, ymdMinus(today, 3));
    // 발송 기한(오늘 포함 7일) 시작일 — 2.0 classnoteMinDate.
    const minDate = ymdMinus(today, 6);
    const rows = await sql`select distinct on (id) id::text id, classnote_status s from public.lesson_reports where tenant_id=${t} and (
        (report_date >= ${ymdMinus(today, 3)} and classnote_status is not null) or classnote_status in ('blocked_shared', 'name_conflict')
        or (classnote_status = 'failed' and report_date >= ${ymdMinus(minDate, 3)}))`;
    assert.equal(q.summary.total, rows.length);
    const n = (s) => rows.filter((r) => r.s === s).length;
    assert.equal(q.summary.success, n('success'));
    assert.equal(q.summary.failed, n('failed'));
    assert.equal(q.summary.nameConflict, n('name_conflict'));
    assert.equal(q.summary.blockedShared, n('blocked_shared'));
    assert.equal(q.summary.queued + q.summary.processing + q.summary.stuck, n('queued') + n('processing'));
    assert.ok(q.items.length <= 100 && q.pending.length <= 100);
    for (const i of [...q.items, ...q.pending]) assert.ok(rows.some((r) => r.id === i.id), i.id);
    const [{ c }] = await sql`select count(*)::int c from public.lesson_reports where tenant_id=${t} and classnote_status in ('failed', 'too_old')
      and report_date < ${minDate} and report_date >= ${ymdMinus(today, 30)}`;
    assert.equal(q.expiredUnsent, c);
    const wk = await sql`select hostname, last_seen from public.classnote_workers where tenant_id=${t} order by hostname`;
    assert.deepEqual(q.workers.map((w) => [w.hostname, w.online]).sort(),
      wk.map((w) => [w.hostname, Math.floor((clock.at.getTime() - w.last_seen.getTime()) / 60_000) < 3]).sort());
    // 미발송 가능 = 기한 안 · 큐에 안 오른 보고서의 부분집합.
    const [{ u }] = await sql`select count(*)::int u from public.lesson_reports where tenant_id=${t} and classnote_status is null and revoked_at is null
      and (source is null or source <> 'edutrix_import') and report_date >= ${minDate}`;
    assert.ok(q.unsentSendable !== null && q.unsentSendable <= u, `${q.unsentSendable} ≤ ${u}`);
    if (q.unsentSendable) assert.ok(q.unsentOldestDate >= minDate);
  });
});

test('반 구성 = 독립 SQL — 영어 활성 반 · 반마다 지금 재원생 · 동기화 시각', { skip: SKIP }, async () => {
  const { t, importV2, clock } = await ctx();
  await db.begin('read only', async (sql) => {
    const v = (await open(sql, t, importV2, 'boards')).tabData.boardRoster;
    assert.ok(v, '반 구성 값');
    assert.equal(v.canLink, true);
    const [{ m }] = await sql`select to_json(max(synced_at))#>>'{}' m from public.classnote_boards where tenant_id=${t}`;
    assert.equal(v.syncedAt, m);
    const classes = await sql`select id::text id from public.classes where tenant_id=${t} and subject='english' and is_active and report_optout = false`;
    assert.deepEqual(v.checks.map((c) => c.classId).sort(), classes.map((c) => c.id).sort());
    assert.equal(v.summary.classes, classes.length);
    for (let i = 1; i < v.checks.length; i += 1) assert.ok(v.checks[i - 1].problems >= v.checks[i].problems, '문제 많은 반 먼저');
    const roster = await sql`select e.class_id::text class_id, count(distinct s.id)::int n from public.enrollments e
      join public.classes c on c.id = e.class_id join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and c.subject='english' and c.is_active and c.report_optout = false and (e.end_date is null or e.end_date >= ${clock.day})
        and s.status::text = 'enrolled' and not s.is_test and coalesce(nullif(trim(s.classnote_name), ''), trim(s.name), '') <> '' group by 1`;
    const want = new Map(roster.map((r) => [r.class_id, r.n]));
    // 보드가 있는 반은 학생마다 판정 한 줄 — 지금 재원생 수와 같다.
    for (const c of v.checks.filter((x) => x.board)) assert.equal(c.students.length, want.get(c.classId) ?? 0, c.className);
  });
});

test('반 공지 = 독립 SQL — 최근 공지 20건 · 대상 반 인원 · 반 단체 공지 · 반 보드 반', { skip: SKIP }, async () => {
  const { t, importV2 } = await ctx();
  await db.begin('read only', async (sql) => {
    const d = (await open(sql, t, importV2, 'notice')).tabData;
    const notices = await sql`select id::text id, jsonb_array_length(case when jsonb_typeof(targets)='array' then targets else '[]' end)::int n
      from public.classnote_notices where tenant_id=${t} order by created_at desc limit 20`;
    assert.deepEqual(d.noticeRows.map((r) => [r.id, r.targetCount]), notices.map((r) => [r.id, r.n]));
    const wide = await sql`select id::text id from public.classnote_class_notices where tenant_id=${t} order by created_at desc limit 20`;
    assert.deepEqual(d.classWide.rows.map((r) => r.id), wide.map((r) => r.id));
    const boards = await sql`select class_id::text class_id from public.classnote_class_boards where tenant_id=${t}`;
    assert.deepEqual([...d.classWide.boardClassIds].sort(), boards.map((b) => b.class_id).sort());
    const [{ subjects }] = await sql`select coalesce(data#>'{report,classnoteSubjects}', '[]') subjects from public.tenant_settings where tenant_id=${t}`;
    const allowed = d.noticeClasses.length ? [...new Set(d.noticeClasses.map((c) => c.subject))] : [];
    if (Array.isArray(subjects) && subjects.length) for (const s of allowed) assert.ok(subjects.includes(s), s);
    const counts = await sql`select e.class_id::text class_id, count(*)::int n from public.enrollments e join public.classes c on c.id = e.class_id
      join public.students s on s.id = e.student_id
      where e.tenant_id=${t} and c.is_active and c.subject = any(${allowed}::text[]) and e.end_date is null group by 1`;
    assert.deepEqual(d.noticeClasses.map((c) => [c.id, c.studentCount]).sort(), counts.map((r) => [r.class_id, r.n]).sort());
  });
});

test('직접 발송 = 재원생 전원(학년 → 이름 순) · 학원 설정 칸 · 대상 반은 반 공지와 같은 목록', { skip: SKIP }, async () => {
  const { t, importV2 } = await ctx();
  await db.begin('read only', async (sql) => {
    const d = await open(sql, t, importV2, 'compose'), n = await open(sql, t, importV2, 'notice');
    const want = await sql`select id::text id from public.students where tenant_id=${t} and status::text='enrolled' order by grade, name, id`;
    assert.deepEqual(d.tabData.composeStudents.map((s) => s.id), want.map((s) => s.id));
    assert.deepEqual(Object.keys(d.tabData.composeStudents[0] ?? { id: 1, name: 1, school: 1, grade: 1 }).sort(), ['grade', 'id', 'name', 'school']);
    assert.deepEqual(d.tabData.composeClasses, n.tabData.noticeClasses);
    assert.equal(d.tabData.composeShowDailyTest, d.settings.report.showDailyTest);
    assert.equal(d.tabData.composeShowCheckTest, d.settings.report.showCheckTest);
    assert.equal(d.tabData.composeShowAttachments, d.settings.report.showAttachments);
    assert.equal(typeof d.tabData.composeSendEnabled, 'boolean');
  });
});

test('학부모 글·답글 = 독립 SQL — 14일 창 수 · 첫 쪽 100건(최신순) · 답글 수 · 둘째 쪽', { skip: SKIP }, async () => {
  const { t, importV2, clock } = await ctx();
  await db.begin('read only', async (sql) => {
    const v = (await open(sql, t, importV2, 'parent_replies')).tabData.parentThreads;
    assert.ok(v, '학부모 글 값');
    const since = new Date(clock.at.getTime() - 14 * 86_400_000);
    const [{ n }] = await sql`select count(*)::int n from public.classnote_parent_messages where tenant_id=${t} and posted_at >= ${since}`;
    assert.equal(v.total, n);
    assert.equal(v.days, 14);
    assert.equal(v.totalPages, Math.max(1, Math.ceil(n / 100)));
    const first = await sql`select id::text id, (select count(*)::int from public.classnote_parent_replies r where r.message_id = m.id and r.status <> 'deleted') replies
      from public.classnote_parent_messages m where tenant_id=${t} and posted_at >= ${since} order by posted_at desc, id desc limit 100`;
    assert.deepEqual(v.rows.map((r) => [r.messageId, r.replyCount]), first.map((r) => [r.id, r.replies]));
    for (const r of v.rows) assert.ok(r.content.length <= 201);
    if (v.totalPages > 1) {
      const p2 = await screen.load({ sql, params: { tab: 'classnote', section: 'parent_replies', page: '2' }, tenantId: t, importV2 });
      assert.equal(p2.tabData.parentThreads.page, 2);
      assert.ok(!p2.tabData.parentThreads.rows.some((r) => v.rows.some((x) => x.messageId === r.messageId)), '쪽끼리 겹치지 않는다');
    }
  });
});

test('부품이 다시 읽는 값(cnread) = 면과 같은 모양 · 권한 없으면 2.0 안내', { skip: SKIP }, async () => {
  const { t, importV2 } = await ctx();
  await db.begin('read only', async (sql) => {
    const page = await open(sql, t, importV2);
    const q3 = await R.readClassnote({ sql, tenantId: t, importV2, cnread: 'queue', days: '3' });
    assert.deepEqual(q3.value, page.queue);
    const q99 = await R.readClassnote({ sql, tenantId: t, importV2, cnread: 'queue', days: '99' });
    assert.equal(q99.value.days, 14);
    const n = await open(sql, t, importV2, 'notice');
    assert.deepEqual((await R.readClassnote({ sql, tenantId: t, importV2, cnread: 'notices' })).value.rows, n.tabData.noticeRows);
    const wide = (await R.readClassnote({ sql, tenantId: t, importV2, cnread: 'classwide' })).value;
    assert.deepEqual({ rows: wide.rows, boardClassIds: wide.boardClassIds }, n.tabData.classWide);
    assert.deepEqual(await R.readClassnote({ sql, tenantId: t, importV2, cnread: 'nope' }), { notFound: true });
    const { studentsBase } = await import('./v2-students-common.mjs');
    const base = await studentsBase({ sql, tenantId: t, importV2 });
    assert.deepEqual(await R.classNotices(base, false), { ok: false, error: '권한이 없습니다' });
  });
});

test.after(async () => { await db?.end(); });
