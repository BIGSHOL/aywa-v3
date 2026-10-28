// 2.0 화면 영상 제출 현황 시험 — 읽기(2.0 ledger-queries.ts와 같은 재료 · Drive 주소 없음) · 관리자/강사 장부의 같은 칸 = 같은 판정 ·
// 저장 다섯 함수(2.0과 같은 검증·DB 함수·감사로그) · 배정 창 읽기 · 호스트 빌드 · 3.0 껍데기.
// 저장 시험은 시험 학생 '학원이'와 그 시험 반(수학)으로, 모두 트랜잭션 안에서 돌린 뒤 되돌린다(끝나면 복사본에 남는 행 0).
// 사용: node experiments/owner-concept/verify-v2-screen-video-homework.mjs
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen, loadRules } from './v2-screen-video-homework.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const here = rel => readFile(new URL(rel, import.meta.url), 'utf8');
const src = rel => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const VH = 'features/video-homework/server';
const MOD = { setVideoHomeworkRound: `${VH}/actions.ts`, cancelVideoHomework: `${VH}/cancel-homework.ts`, issueExtraVideoHomework: `${VH}/issue-actions.ts`,
  rejectHomeworkVideos: `${VH}/reject-videos.ts`, assignHomeworkVideo: `${VH}/video-assignment.ts` };
const STU = '6219e442-aa57-455f-a5bc-834b222d9e1c'; // 학원이(테스트 학생)
const CLS = 'e4a2c026-8992-4211-a5fe-b9e93be8a0f3'; // 학원이(테스트) — 수학 · 담임 원일
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75', SOHEE = '7ac89726-d36f-46e4-8174-6bbddbd7f378';

const db = await openFullDatabase();
const R = await loadRules(importV2);
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
const ROLL = new Error('rollback');
/** 쓰기 트랜잭션 하나에서 돌리고 늘 되돌린다 — 바깥 요청이 쌓였는지도 공통 틀처럼 본다. */
const tx = async fn => {
  let out;
  try {
    await db.begin(async sql => {
      const queue = async () => (await sql`select to_regclass('net.http_request_queue') is not null p`)[0].p ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
      const before = await queue();
      out = await fn(sql);
      assert.equal(await queue(), before, '바깥으로 나가는 요청이 쌓이지 않는다');
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  return out;
};
const run = (sql, name, actor, arg) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module: MOD[name], actor, args: [arg] }), tenantId, importV2 });
const counts = sql => sql`select (select count(*)::int from public.video_homework_marks where tenant_id=${tenantId}) marks,
  (select count(*)::int from public.video_homework_extra_issues where tenant_id=${tenantId}) extra,
  (select count(*)::int from public.video_homework_cancels where tenant_id=${tenantId}) cancels,
  (select count(*)::int from public.video_homework_rejections where tenant_id=${tenantId}) rejections,
  (select count(*)::int from public.student_homework_videos where tenant_id=${tenantId}) videos,
  (select count(*)::int from public.homework_video_assignments where tenant_id=${tenantId}) assignments,
  (select count(*)::int from public.audit_logs where tenant_id=${tenantId} and metadata->>'via' = '3.0 연습 복사본' and action like 'lesson_report_video_homework%') audits,
  (select count(*)::int from public.notifications where tenant_id=${tenantId}) notes`;

try {
  const before = (await counts(db))[0];

  await check('2.0 서버 함수 이름·인자가 그대로다(다섯 저장 + 배정 창 읽기)', async () => {
    const sig = { setVideoHomeworkRound: 'setVideoHomeworkRound(input: {', cancelVideoHomework: 'cancelVideoHomework(input: { classId: string; studentId: string; homeworkDate: string })',
      issueExtraVideoHomework: 'issueExtraVideoHomework(input: Input)', rejectHomeworkVideos: 'rejectHomeworkVideos(input: { classId: string; studentId: string; homeworkDate: string })',
      assignHomeworkVideo: 'assignHomeworkVideo(input: { classId: string; studentId: string; videoId: string; homeworkDate: string | null; excluded: boolean; revision: number; reason: string })' };
    for (const [name, s] of Object.entries(sig)) assert.ok((await src(MOD[name])).includes(`export async function ${s}`), name);
    assert.ok((await src(`${VH}/video-assignment.ts`)).includes('export async function getVideoAssignmentOptions(input: { classId: string; studentId: string; fromDate: string; toDate: string })'));
    assert.deepEqual(Object.keys(screen.actions).sort(), Object.keys(MOD).sort());
  });

  let admin;
  await check('읽기: 관리자 장부 — 원장이 먼저 · 기간 기본 = 이달 1일~오늘 · 강사 필터 재료 · 면 탭 · Drive 주소를 화면에 보내지 않는다', async () => {
    admin = await load({});
    assert.equal(admin.view, 'admin'); assert.equal(admin.viewer.role, 'master'); assert.equal(admin.editors[0].role, '원장');
    const today = R.kstToday();
    assert.deepEqual([admin.fromDate, admin.toDate], [`${today.slice(0, 7)}-01`, today]);
    assert.ok(admin.ledger.rows.length > 0 && admin.ledger.marks.length > 0, '장부에 줄과 기록이 있다');
    assert.ok(admin.issuers.issues.length > 0 && admin.issuers.names.length > 0);
    assert.equal(admin.faces.canSend, true);
    const text = JSON.stringify(admin);
    assert.doesNotMatch(text, /drive\.google|googleapis/, 'Drive 미리보기·썸네일 주소가 없다');
    assert.ok(admin.ledger.videos.every(v => !('playback' in v) || v.playback === null), '재생 칸은 빼거나 null');
    // 회차 판정 재료는 그대로 — 재생 가능한 영상(칸을 뺀 것)은 회차에 붙는다(rounds.ts의 playback !== null).
    assert.ok(admin.ledger.videos.some(v => !('playback' in v)), '재생 가능한 영상이 판정에 남는다');
  });

  await check('읽기: 과거 기간 · 화면 밖 매개변수는 공통 틀이 막는다', async () => {
    const past = await load({ from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual([past.fromDate, past.toDate], ['2026-09-01', '2026-09-30']);
    assert.ok(past.ledger.rows.length > 0);
    assert.ok(screen.params.from.test('2026-09-01') && !screen.params.status.test('bad') && !screen.params.view.test('admin'));
  });

  // 강사 — 이번 달 내가 낸 숙제가 가장 많은 강사.
  const [{ id: TEACHER }] = await db`select u.id::text id from public.lesson_reports r join public.users u on u.id = r.created_by
    where r.tenant_id=${tenantId} and r.video_homework and r.report_date >= ${admin.fromDate}::date and u.system_role = 'teacher' and u.status = 'active'
    group by u.id order by count(*) desc limit 1`;
  let mine;
  await check('읽기: 강사 \'내가 낸\'(view=mine) — 보는 사람 = 강사 · 내 숙제 · 담임 반 · 관리자 계열은 관리자 장부로 되돌림', async () => {
    mine = await load({ view: 'mine', actor: TEACHER });
    assert.equal(mine.view, 'mine'); assert.equal(mine.viewer.id, TEACHER);
    assert.ok(mine.editors.length > 0 && mine.editors.every(e => e.role === '강사'));
    assert.ok(mine.own.length > 0);
    const [{ n }] = await db`select count(distinct (class_id, student_id, report_date))::int n from public.lesson_reports where tenant_id=${tenantId} and created_by=${TEACHER}
      and video_homework and class_id is not null and report_date between ${mine.fromDate}::date and ${mine.toDate}::date`;
    assert.ok(mine.own.length >= n, '내가 쓴 영상 과제 있음 보고서는 전부 내 숙제');
    const owned = new Set(mine.owned), ownPairs = new Set(mine.own.map(r => R.ledgerPairKey(r)));
    assert.ok(mine.ledger.rows.every(r => ownPairs.has(R.ledgerPairKey(r)) || owned.has(r.classId)), '장부 줄은 내 숙제 줄이거나 내 담임 반');
    assert.deepEqual(await load({ view: 'mine', actor: SEOLHYUN }), { redirectAdmin: true });
    assert.equal(mine.issuers, undefined, '강사 화면엔 강사 필터 재료가 없다');
  });

  await check('관리자 장부와 강사 장부의 같은 칸 = 같은 판정(전체로 짝을 지은 뒤 내 칸만)', async () => {
    const policy = admin.policy, keep = new Set(mine.own.map(r => R.ownRoundKey(r, r.date)));
    const roundsOf = (data, keepSet) => {
      const rows = data.ledger.rows.map(r => ({ ...r, tracked: R.isVideoHomeworkEnabled(policy, { classId: r.classId, subjectKey: r.subject, grade: r.grade }) }));
      const all = R.buildLedgerRounds({ rows, marks: data.ledger.marks, videos: data.ledger.videos, fromDate: data.fromDate, toDate: data.toDate });
      return keepSet ? R.keepLedgerRounds(all, keepSet) : all;
    };
    const a = roundsOf(admin), m = roundsOf(mine, keep);
    let compared = 0;
    for (const [pair, list] of m) for (const round of list) {
      const twin = (a.get(pair) ?? []).find(x => x.key === round.key);
      assert.ok(twin, `관리자 장부에도 같은 칸 ${pair} ${round.key}`);
      assert.deepEqual([round.status, round.videoId ?? null, round.homeworkDate], [twin.status, twin.videoId ?? null, twin.homeworkDate], `${pair} ${round.key}`);
      compared++;
    }
    assert.ok(compared > 0, '비교한 칸이 있다');
  });

  // ── 저장(학원이) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // 시험 반은 매일 수업이라 오늘 숙제는 다음 수업(내일) 전이다 — 따로 내기 창이 열려 있다(지난 수업은 2.0처럼 '다음 수업이 지나' 거절).
  const DAY = R.kstToday();
  await check('저장: 학원이 한 바퀴 — 숙제 출제(검증·감사로그) → 칸 완료 → 미확인(숙제는 남는다) → 남이 낸 칸은 강사가 못 고친다 → 숙제 취소(DB 함수) (되돌림)', async () => {
    const out = await tx(async sql => {
      const notTeaching = await run(sql, 'issueExtraVideoHomework', SOHEE, { classId: CLS, studentId: STU, date: DAY });
      const future = await run(sql, 'issueExtraVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, date: '2099-01-01' });
      const issue = await run(sql, 'issueExtraVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, date: DAY });
      const again = await run(sql, 'issueExtraVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, date: DAY });
      const [extra] = await sql`select teacher_id::text teacher_id, issued_by::text issued_by, kept from public.video_homework_extra_issues where student_id=${STU} and homework_date=${DAY}::date`;
      const done = await run(sql, 'setVideoHomeworkRound', SEOLHYUN, { classId: CLS, studentId: STU, roundKey: `h:${DAY}`, status: 'submitted', submittedDate: DAY });
      const [mark] = await sql`select check_date::text check_date, status, submitted_date::text submitted_date from public.video_homework_marks where student_id=${STU} and homework_date=${DAY}::date`;
      const otherTeacher = await run(sql, 'setVideoHomeworkRound', SOHEE, { classId: CLS, studentId: STU, roundKey: `h:${DAY}`, status: 'missing' });
      const cancelDone = await run(sql, 'cancelVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, homeworkDate: DAY });
      const cleared = await run(sql, 'setVideoHomeworkRound', SEOLHYUN, { classId: CLS, studentId: STU, roundKey: `h:${DAY}`, status: null });
      const marksLeft = (await sql`select count(*)::int n from public.video_homework_marks where student_id=${STU}`)[0].n;
      const cancel = await run(sql, 'cancelVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, homeworkDate: DAY });
      const left = (await sql`select count(*)::int n from public.video_homework_extra_issues where student_id=${STU}`)[0].n;
      const cancels = (await sql`select count(*)::int n from public.video_homework_cancels where student_id=${STU} and homework_date=${DAY}::date`)[0].n;
      const logs = await sql`select action, actor_id::text actor_id, target_label, metadata from public.audit_logs where tenant_id=${tenantId} and action like 'lesson_report_video_homework%' and created_at >= now() order by id`;
      return { notTeaching, future, issue, again, extra, done, mark, otherTeacher, cancelDone, cleared, marksLeft, cancel, left, cancels, logs };
    });
    assert.equal(out.notTeaching.error, '담당 반만 수정할 수 있습니다.');
    assert.equal(out.future.error, '아직 수업하지 않은 날에는 영상 숙제를 낼 수 없습니다.');
    assert.equal(out.issue.ok, true, out.issue.error); assert.equal(out.issue.deadline, R.addDays(DAY, 7));
    assert.equal(out.again.error, '이미 영상 숙제가 나간 날입니다. 화면을 새로고침해 주세요.');
    assert.deepEqual([out.extra.issued_by, out.extra.kept], [SEOLHYUN, false]);
    assert.deepEqual(out.done, { ok: true });
    assert.deepEqual(out.mark, { check_date: R.addDays(DAY, 1), status: 'submitted', submitted_date: DAY }, '새 기록 자리 = 숙제일 다음 날');
    assert.equal(out.otherTeacher.error, '내가 낸 숙제만 기록할 수 있습니다.');
    assert.equal(out.cancelDone.error, '완료로 기록된 숙제는 취소할 수 없습니다. 기록을 미확인으로 되돌린 뒤 취소해 주세요.');
    assert.deepEqual(out.cleared, { ok: true, kept: true }, '따로 낸 숙제라 칸은 남는다');
    assert.equal(out.marksLeft, 0);
    assert.deepEqual(out.cancel, { ok: true }); assert.equal(out.left, 0); assert.equal(out.cancels, 1);
    // 한 트랜잭션이라 시각이 같다 — 순서 없이 본다.
    assert.deepEqual(out.logs.map(l => l.action).sort(), ['lesson_report_video_homework_cancel', 'lesson_report_video_homework_issue', 'lesson_report_video_homework_mark', 'lesson_report_video_homework_mark']);
    assert.ok(out.logs.every(l => l.actor_id === SEOLHYUN && l.metadata.via === '3.0 연습 복사본' && l.target_label?.startsWith('학원이')));
    assert.deepEqual(out.logs.filter(l => l.action === 'lesson_report_video_homework_mark').map(l => l.metadata.status).sort(), ['cleared', 'submitted']);
  });

  await check('저장: 영상 붙은 칸 — 배정 창 읽기(재생 주소 없음) → 영상 배정(DB 함수) → 반려(DB 반려 · 휴지통은 못 옮김으로 셈) (되돌림)', async () => {
    const out = await tx(async sql => {
      await run(sql, 'issueExtraVideoHomework', SEOLHYUN, { classId: CLS, studentId: STU, date: DAY });
      const [video] = await sql`insert into public.student_homework_videos (tenant_id, student_id, subject, posted_at, status, drive_file_id, bytes, md5, route, source, source_ref, uploaded_at)
        values (${tenantId}, ${STU}, 'math', now(), 'uploaded', 'TESTFILE_vh_0001', 1234, 'x', ${sql.json({ classId: CLS })}, 'drive', 'verify-video-homework', now()) returning id::text id`;
      const options = await screen.load({ sql, params: { read: 'assign', class: CLS, student: STU, from: DAY, to: R.kstToday(), actor: SEOLHYUN }, tenantId, importV2 });
      const picked = options.read.videos.find(v => v.id === video.id);
      const noReason = await run(sql, 'assignHomeworkVideo', SEOLHYUN, { classId: CLS, studentId: STU, videoId: video.id, homeworkDate: DAY, excluded: false, revision: picked.revision, reason: ' ' });
      const notMine = await run(sql, 'assignHomeworkVideo', SOHEE, { classId: CLS, studentId: STU, videoId: video.id, homeworkDate: DAY, excluded: false, revision: picked.revision, reason: '시험' });
      const assign = await run(sql, 'assignHomeworkVideo', SEOLHYUN, { classId: CLS, studentId: STU, videoId: video.id, homeworkDate: DAY, excluded: false, revision: picked.revision, reason: '시험' });
      const [route] = await sql`select route from public.homework_video_ledger_videos where id=${video.id}`;
      const reject = await run(sql, 'rejectHomeworkVideos', SEOLHYUN, { classId: CLS, studentId: STU, homeworkDate: DAY });
      const rejections = (await sql`select count(*)::int n from public.video_homework_rejections where student_id=${STU}`)[0].n;
      const log = (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and action='lesson_report_video_homework_reject' and created_at >= now()`)[0]?.metadata;
      return { options, picked, noReason, notMine, assign, route: route.route, reject, rejections, log };
    });
    assert.equal(out.options.read.ok, true); assert.ok(out.options.read.dates.includes(DAY));
    assert.ok(out.picked && out.picked.playback === null, '배정 창 영상에 재생 주소가 없다');
    assert.equal(out.noReason.error, '영상·숙제 날짜와 변경 사유를 확인해 주세요.');
    assert.equal(out.notMine.error, '본인 담임 반의 영상만 배정할 수 있습니다.');
    assert.deepEqual(out.assign, { ok: true }); assert.equal(out.route.homeworkDate, DAY);
    assert.equal(out.reject.ok, true, out.reject.error);
    assert.deepEqual([out.reject.rejected, out.reject.trashed, out.reject.trashFailed], [1, 0, 1], 'Drive를 부르지 않고 못 옮김으로 센다');
    assert.equal(out.rejections, 1); assert.equal(out.log.via, '3.0 연습 복사본');
  });

  await check('저장 요청 검사 — 받지 않는 파일·고르지 않은 사람·틀린 회차는 거절', async () => {
    assert.throws(() => screen.actions.cancelVideoHomework.validate({ module: MOD.setVideoHomeworkRound, actor: SEOLHYUN, args: [{}] }));
    assert.throws(() => screen.actions.setVideoHomeworkRound.validate({ module: MOD.setVideoHomeworkRound, actor: 'x', args: [] }));
    const r = await tx(async sql => ({ none: await run(sql, 'setVideoHomeworkRound', null, { classId: CLS, studentId: STU, roundKey: `h:${DAY}`, status: 'submitted' }),
      bad: await run(sql, 'setVideoHomeworkRound', SEOLHYUN, { classId: CLS, studentId: STU, roundKey: 'x:2026', status: 'submitted' }),
      missing: await run(sql, 'setVideoHomeworkRound', SEOLHYUN, { classId: CLS, studentId: STU, roundKey: `h:${DAY}`, status: 'submitted' }) }));
    assert.equal(r.none.error, '저장하는 사람을 골라 주세요.'); assert.equal(r.bad.error, '회차를 확인할 수 없습니다.');
    assert.equal(r.missing.error, '그날 이 학생에게 나간 영상 과제를 찾을 수 없습니다.');
  });

  await check('시험 뒤 복사본은 그대로(기록 · 따로 낸 숙제 · 취소 · 반려 · 영상 · 배정 · 감사로그 · 알림)', async () => {
    assert.deepEqual((await counts(db))[0], before);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-video-homework-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  assert.equal(info.entries['video-homework'].route, '/lesson-reports/video-homework');
  for (const m of Object.values(MOD)) assert.ok(info.actions.map(a => a.replaceAll('\\', '/')).includes(`src/${m}`), `${m}는 서버 함수 자리표시로`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('video-homework.js', dist), 'utf8');
  const hosts = [...new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 주소·외부 주소·직접 저장 요청 없음 · 화면 글자에 개발자 말 없음', async () => {
  const js = await here('./v2-screen-video-homework.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /<span>(화면)<\/span>/, /<option value="">([^<]*)</, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  const host = await here('./v2-host/src/video-homework.tsx');
  for (const m of host.matchAll(/toast\.info\('([^']*)'\)|text="([^"]*)"/g)) assert.doesNotMatch(m[1] ?? m[2], /2\.0|Docker|복사본|iframe|호스트/i);
});

console.log(`v2 video-homework: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
