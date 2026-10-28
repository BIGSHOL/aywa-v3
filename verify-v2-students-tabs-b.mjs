// 원생 상세 '출결' · '진도' · '숙제 영상' 탭 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-students-tabs-b.mjs
// ① 그리기 = 2.0 탭 본문 그대로(서버 조회 자리만 students-tab-<탭>.swaps.json 짝 · 짝마다 한 번) — 진도 분석 패널(progress-panel.tsx)·링크 구역 포함
// ② 숫자 = 독립 SQL — 출결(칸마다 최신 정정 · 보고서 작성자 · 보강 예약) · 진도(쪽 · 날짜 조회 · 열람 수 · 끝 쪽 너머 · 이상 감지) · 영상(접기 · 업로드 기록 · 링크)
// ③ 화면 글자에 '2.0'·개발자용 말이 없다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = async (p) => (await readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const here = async (p) => (await readFile(new URL(p, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const T = 'app/(shell)/students/[id]/_tabs/';
const region = (text, from) => { const i = text.indexOf(from); assert.ok(i >= 0, `구간 시작: ${from}`); return text.slice(i); };
const apply = (body, pairs) => { for (const [a, b] of pairs) { assert.equal(body.split(a).length, 2, `짝이 한 번만 맞아야 한다: ${a.slice(0, 60)}`); body = body.replace(a, b); } return body; };
const code = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var { screen } = await import('./v2-screen-students.mjs');
  var clock = await copyClock(), today = clock.day;
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var tabOf = async (sql, id, tab, extra = {}) => { const d = await screen.load({ sql, params: { v2path: `/students/${id}`, tab, ...extra }, tenantId: t, importV2 }); assert.equal(d.tab.key, tab); return d.tab.data; };
}

test('그리기 = 2.0 탭 본문 그대로(출결 · 진도 + 진도 분석 패널 · 숙제 영상 + 링크 구역) — 서버 조회 자리만 swaps 짝', async () => {
  const sw = async (k) => JSON.parse(await here(`./v2-host/src/students-tab-${k}.swaps.json`));
  const att = await here('./v2-host/src/students-tab-attendance.tsx');
  assert.equal(att.slice(att.indexOf('/** 출결 탭 — ')), apply(region(await src(T + 'attendance-tab.tsx'), '/** 출결 탭 — '), (await sw('attendance')).tab));
  const pro = await here('./v2-host/src/students-tab-progress.tsx'), ps = await sw('progress');
  const panel = apply(region(await src('features/progress/components/progress-panel.tsx'), '// 진도 현황 패널'), ps.panel);
  const tab = apply(region(await src(T + 'progress-tab.tsx'), '// ijw StudentDetail ProgressTab 이식'), ps.tab);
  assert.equal(pro.slice(pro.indexOf('// 진도 현황 패널'), pro.indexOf('\n\n/**\n * 진도 탭 — 2.0 본문')), `${panel}\n${tab}`);
  const hw = await here('./v2-host/src/students-tab-homework-videos.tsx'), hs = await sw('homework-videos');
  assert.equal(hw.slice(hw.indexOf('export function HomeworkVideosTab(')),
    `${apply(region(await src(T + 'homework-videos-tab.tsx'), 'export async function HomeworkVideosTab('), hs.tab)}\n${apply(region(await src(T + 'homework-video-links.tsx'), "/**\n * 학생 상세 '숙제 영상' 탭 위"), hs.links)}`);
  // 바꾼 본문에 서버 조회(await)가 남지 않는다 · 쪽 크기 = 2.0 상수.
  for (const f of [att, pro, hw]) assert.ok(!/\bawait\b/.test(code(f)), '본문 코드에 await가 남았다');
  const size = Number(/export const STUDENT_REPORTS_PAGE_SIZE = (\d+);/.exec(await src('features/students/server/queries.ts'))[1]);
  assert.equal(Number(/const STUDENT_REPORTS_PAGE_SIZE = (\d+);/.exec(pro)[1]), size);
  assert.equal((await import('./v2-students-tab-progress.mjs')).PAGE_SIZE, size);
  // 진도 탭 감싸개 = 폼 제출·맨 <a>만 같은 화면 이동으로(Link가 막은 클릭은 지나간다 · 창 표식은 싣지 않는다).
  assert.match(pro, /export function ProgressTab\(props/); assert.match(pro, /e\.defaultPrevented/); assert.match(pro, /q\.delete\("embed"\)/);
});

test('출결 = 독립 SQL — 칸(학생·반·날짜·교시)마다 최신 정정 한 줄 · 보고서 작성자(반이 적힌 보고서 · 먼저 온 이름) · 보강 예약 · 반 이름', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const picks = await sql`(select student_id::text id from public.attendance_records where tenant_id=${t} group by student_id, class_id, session_date, coalesce(slot_start::text, '') having count(*) > 1 limit 1)
      union all (select student_id::text from public.makeup_reservations where tenant_id=${t} and status='reserved' and makeup_date >= ${today}::date limit 1)`;
    assert.ok(picks.length === 2, '정정 기록·보강 예약이 있는 학생이 있어야 한다');
    for (const { id } of picks) {
      const d = await tabOf(sql, id, 'attendance');
      const raw = await sql`select id::text id, class_id::text class_id, session_date::text d, coalesce(slot_start::text, '') slot, status::text status, recorded_at
        from public.attendance_records where tenant_id=${t} and student_id=${id}`;
      const latest = new Map();
      for (const r of raw) { const k = `${r.class_id}|${r.d}|${r.slot}`, p = latest.get(k); if (!p || r.recorded_at > p.recorded_at || (+r.recorded_at === +p.recorded_at && r.id > p.id)) latest.set(k, r); }
      assert.equal(d.records.length, latest.size, '칸 수');
      const got = new Map(d.records.map((r) => [`${r.classId}|${r.date}|${r.slotStart ?? ''}`, r]));
      for (const [k, r] of latest) assert.equal(got.get(k)?.status, r.status, `최신 정정 ${k}`);
      const reps = await sql`select report_date::text d, class_id::text c, teacher_name n from public.lesson_reports where tenant_id=${t} and student_id=${id} and class_id is not null order by report_date, id`;
      const first = new Map();
      for (const r of reps) { const n = r.n?.trim(); if (n && !first.has(`${r.d}|${r.c}`)) first.set(`${r.d}|${r.c}`, n); }
      for (const r of d.records) assert.equal(r.reporter, first.get(`${r.date}|${r.classId}`) ?? null, `작성자 ${r.date}`);
      const [{ n }] = await sql`select count(*)::int n from public.enrollments where tenant_id=${t} and student_id=${id}`;
      assert.equal(d.enrollments.length, n);
      const res = await sql`select r.id::text id, c.class_name from public.makeup_reservations r left join public.classes c on c.id=r.class_id
        where r.tenant_id=${t} and r.student_id=${id} and r.status='reserved' and r.makeup_date >= ${today}::date order by r.makeup_date, r.slot_start limit 50`;
      assert.deepEqual(d.upcoming.map((r) => r.id), res.map((r) => r.id));
      const names = new Map(d.classRows.map((r) => [r.id, r.class_name]));
      for (const r of d.upcoming) assert.equal(names.get(r.classId), res.find((x) => x.id === r.id).class_name);
    }
  });
});

test('진도 = 독립 SQL — 10건 쪽(날짜·id 내림차순) · 날짜 조회(양 끝 포함 · 모양이 틀린 값 무시) · 열람 수 · 링크 상태 · 끝 쪽 너머 = 마지막 쪽 · 이상 감지(미확인 20 · 확인 8)', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const [{ id }] = await sql`select r.student_id::text id from public.lesson_reports r where r.tenant_id=${t} and exists(select 1 from public.share_link_views v where v.lesson_report_id=r.id)
      group by r.student_id having count(*) > 12 limit 1`;
    const all = await sql`select id::text id, report_date::text d, revoked_at is not null revoked from public.lesson_reports where tenant_id=${t} and student_id=${id} order by report_date desc, id desc`;
    const views = new Map((await sql`select lesson_report_id::text r, count(*)::int n from public.share_link_views where tenant_id=${t} group by 1`).map((v) => [v.r, v.n]));
    const p2 = await tabOf(sql, id, 'progress', { page: '2' });
    assert.equal(p2.first.total, all.length);
    assert.deepEqual(p2.first.rows.map((r) => r.id), all.slice(10, 20).map((r) => r.id), '2쪽');
    const expired = (d) => { const e = new Date(`${d}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + 90); return today > e.toISOString().slice(0, 10); };
    for (const r of p2.first.rows) {
      assert.equal(r.viewCount, views.get(r.id) ?? 0, `열람 ${r.id}`);
      const a = all.find((x) => x.id === r.id);
      assert.equal(r.linkStatus, a.revoked ? 'revoked' : expired(a.d) ? 'expired' : 'active');
    }
    const from = all[Math.min(5, all.length - 1)].d, to = all[1].d;
    const f = await tabOf(sql, id, 'progress', { from, to });
    const inRange = all.filter((r) => r.d >= from && r.d <= to);
    assert.equal(f.first.total, inRange.length); assert.deepEqual(f.first.rows.map((r) => r.id), inRange.slice(0, 10).map((r) => r.id));
    const last = Math.max(1, Math.ceil(all.length / 10)), far = await tabOf(sql, id, 'progress', { page: '99' });
    assert.equal(far.first.rows.length, 0); assert.deepEqual(far.shown.rows.map((r) => r.id), all.slice((last - 1) * 10, last * 10).map((r) => r.id), '끝 쪽 너머 = 마지막 쪽');
    assert.equal(p2.shown, null);
    // 이상 감지 — 이벤트가 있는 학생.
    const [ev] = await sql`select student_id::text id from public.progress_events where tenant_id=${t} and event_type in ('jump_error','overlap_error') limit 1`;
    if (ev) {
      const a = (await tabOf(sql, ev.id, 'progress')).analytics;
      const open = await sql`select id::text id from public.progress_events where tenant_id=${t} and student_id=${ev.id} and event_type in ('jump_error','overlap_error') and resolved_at is null order by created_at desc limit 20`;
      const done = await sql`select id::text id from public.progress_events where tenant_id=${t} and student_id=${ev.id} and event_type in ('jump_error','overlap_error') and resolved_at is not null order by created_at desc limit 8`;
      assert.deepEqual(a.anomalies.map((x) => x.id), [...open, ...done].map((x) => x.id));
      for (const x of a.anomalies) assert.ok(!/_error$/.test(x.from?.grade ?? '') && typeof x.at === 'string');
    }
    const act = await sql`select track from public.progress_containers where tenant_id=${t} and student_id=${id} and status='active'`;
    const tracks = (await tabOf(sql, id, 'progress')).analytics.tracks.map((x) => x.track);
    assert.deepEqual(tracks, ['current', 'ahead'].filter((k) => act.some((c) => c.track === k)), '활성 트랙(현행 먼저)');
  });
});

test('숙제 영상 = 독립 SQL — 영상 원장(같은 영상 두 줄 접기 · 재생 번호 비움) · 업로드 기록(최근 30일 · 30건) · 살아 있는 링크가 있는 지금 반 · 사이트 주소 없음', { skip: SKIP }, async () => {
  await run(async (sql) => {
    const [{ id }] = await sql`select l.student_id::text id from public.homework_video_link_uploads u join public.homework_video_links l on l.id=u.link_id
      where u.tenant_id=${t} order by u.created_at desc limit 1`;
    const d = await tabOf(sql, id, 'homework-videos');
    const rows = await sql`select id::text id, md5, bytes from public.homework_video_ledger_videos where tenant_id=${t} and student_id=${id}`;
    const keyed = new Set(rows.filter((r) => r.md5 && r.bytes != null).map((r) => `${r.md5}:${r.bytes}`));
    assert.equal(d.videos.ready, true);
    assert.equal(d.videos.rows.length, rows.filter((r) => !(r.md5 && r.bytes != null)).length + keyed.size, '접은 뒤 줄 수');
    assert.ok(d.videos.rows.every((r) => r.drive_file_id === null && !('md5' in r)), '재생 번호 비움 · md5는 화면으로 안 나감');
    const ups = await sql`select u.id::text id from public.homework_video_link_uploads u join public.homework_video_links l on l.id=u.link_id
      where u.tenant_id=${t} and l.student_id=${id} and u.created_at >= ${new Date(clock.at.getTime() - 30 * 86_400_000)} order by u.created_at desc limit 30`;
    assert.equal(d.uploadLog.ready, true); assert.deepEqual(d.uploadLog.rows.map((r) => r.id), ups.map((r) => r.id));
    if (d.links) {
      assert.equal(d.links.siteUrl, null);
      const live = new Set((await sql`select distinct class_id::text c from public.homework_video_links where tenant_id=${t} and student_id=${id} and revoked_at is null and expires_at > ${clock.at}`).map((r) => r.c));
      for (const r of d.links.rows) { assert.ok(live.has(r.classId), r.className); assert.ok(r.count >= 1); }
    }
  });
});

test('화면 글자에 "2.0"·개발자용 말이 없다(주석 뺀 코드)', async () => {
  for (const f of ['./v2-host/src/students-tab-attendance.tsx', './v2-host/src/students-tab-progress.tsx', './v2-host/src/students-tab-homework-videos.tsx']) {
    const c = code(await here(f)).replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...c.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    for (const s of strings) assert.ok(!/2\.0|v2|복사본|Docker|API|tenant|함수/.test(s), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
