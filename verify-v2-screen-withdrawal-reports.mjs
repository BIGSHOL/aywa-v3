// 2.0 화면 퇴원보고서 시험 — 읽기(2.0 queries.ts와 같은 모양) · 저장 네 함수(2.0 actions.ts와 같은 검증·DB 함수·감사로그) · 호스트 빌드 · 3.0 껍데기.
// 저장 시험은 시험 학생 '학원이'와 이미 있는 보고서로 하고, 모두 트랜잭션 안에서 돌린 뒤 되돌린다(끝나면 복사본에 남는 행 0).
// 사용: node experiments/owner-concept/verify-v2-screen-withdrawal-reports.mjs
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-withdrawal-reports.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const here = rel => readFile(new URL(rel, import.meta.url), 'utf8');
const src = rel => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const MODULE = 'features/withdrawal-reports/server/actions.ts', ARCHIVE_MODULE = 'features/withdrawal-reports/server/archive-actions.ts';
const STU = '6219e442-aa57-455f-a5bc-834b222d9e1c'; // 학원이(테스트 학생)
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75', WONIL = '94007db7-12d3-4b5d-97f2-39071446536b', YUJIN = 'd3e9bcd1-f30e-4f5b-9e78-2ad509f1d06b', SOHEE = '7ac89726-d36f-46e4-8174-6bbddbd7f378';

const db = await openFullDatabase();
// 셸은 늘 현재 계정을 넘긴다(계정이 없으면 자료를 내리지 않는다) — 시험의 기본 보는 사람은 원장.
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params: { actor: SEOLHYUN, ...params }, tenantId, importV2 }));
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
const run = (sql, name, actor, args, module = MODULE) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module, actor, args }), tenantId, importV2 });
const counts = sql => sql`select (select count(*)::int from public.withdrawal_reports where tenant_id=${tenantId}) reports,
  (select count(*)::int from public.withdrawal_report_events where tenant_id=${tenantId}) events,
  (select count(*)::int from public.audit_logs where tenant_id=${tenantId} and metadata->>'via' = '3.0 연습 복사본' and action like 'withdrawal_report%') audits,
  (select count(*)::int from public.notifications where tenant_id=${tenantId}) notes,
  (select status::text from public.students where id=${STU}) stu`;

try {
  const before = (await counts(db))[0];

  await check('2.0 서버 함수 이름·인자가 그대로다(actions.ts · archive-actions.ts)', async () => {
    const a = await src(MODULE), b = await src(ARCHIVE_MODULE);
    for (const n of ['requestWithdrawalReport(input: unknown)', 'processWithdrawalDirectly(input: unknown)', 'changeWithdrawalReport(id: string, action: ReportAction, revision: number, input?: unknown)']) assert.ok(a.includes(`export async function ${n}`), n);
    assert.ok(b.includes('export async function mapArchive(input: unknown)'));
    assert.deepEqual(Object.keys(screen.actions).sort(), ['approveWithdrawalRefund', 'changeWithdrawalReport', 'mapArchive', 'processWithdrawalDirectly', 'requestWithdrawalReport']);
  });

  let list;
  await check('읽기: 원장 보기 = 전 보고서 · 작성 요청 창 학생(시험 학생 제외) · 원본 기록 · 바로 처리 가능', async () => {
    list = await load({});
    assert.equal(list.viewer.user.systemRole, 'master');
    assert.ok(list.editors.length > 5 && list.editors[0].role === '원장', '원장이 먼저');
    const [{ n }] = await db`select count(*)::int n from public.withdrawal_reports where tenant_id=${tenantId} and status not in ('completed','canceled')`;
    assert.equal(list.list.rows.filter(r => !['completed', 'canceled'].includes(r.status)).length, n, '진행 중 보고서 전부');
    assert.ok(!list.students.some(s => s.id === STU), '시험 학생은 요청 창에 없다(2.0 is_test 제외)');
    assert.ok(list.archives.length > 0 && 'reason_raw' in list.archives[0] && !('fields' in list.archives[0]), '원본은 목록 칸만');
    assert.equal(list.directReady, true);
    for (const r of list.list.rows) assert.ok(!('body' in r) && 'body_reason' in r, '목록엔 본문 대신 사유 칸');
  });

  await check('읽기: 보는 사람에 따라 — 강사는 자기 보고서만 · 관리자는 참여한 것 · 과목 범위', async () => {
    const t = await load({ actor: SOHEE });
    assert.equal(t.viewer.teacherId, SOHEE); assert.equal(t.shell, 'teacher'); assert.equal(t.viewer.request, false);
    assert.ok(t.list.rows.every(r => r.teacher_id === SOHEE));
    assert.deepEqual(t.students, [], '강사는 요청 창이 없다');
    assert.ok(t.archives.every(a => a.mapped_teacher_id === SOHEE));
    const m = await load({ actor: YUJIN });
    assert.ok(m.list.rows.every(r => [r.requested_by, r.teacher_id, ...(r.manager_ids ?? []), ...(r.director_ids ?? [])].includes(YUJIN)));
  });

  const [pending] = await db`select id::text id, revision, teacher_id::text teacher_id, manager_ids::text[] manager_ids, director_ids::text[] director_ids from public.withdrawal_reports
    where tenant_id=${tenantId} and status='manager_pending' order by created_at limit 1`;
  if (pending) await check('읽기: 보고서 상세 — 처리 이력 · 배정 변경 판정 · 상담기록 · 없는 보고서는 notFound', async () => {
    const d = await load({ v2path: `/withdrawal-reports/${pending.id}`, actor: pending.manager_ids[0] });
    assert.equal(d.record.report.id, pending.id);
    assert.ok(Array.isArray(d.record.events) && d.record.events.length > 0);
    assert.equal(typeof d.record.assignmentChanged, 'boolean');
    assert.ok(d.staff.length > 0);
    const other = await load({ v2path: `/withdrawal-reports/${pending.id}`, actor: (await db`select id::text id from public.users where tenant_id=${tenantId} and system_role='teacher' and status='active' and id <> ${pending.teacher_id} limit 1`)[0].id });
    assert.equal(other.notFound, true, '남의 보고서는 강사가 못 연다');
  });

  if (pending) await check('저장: 승인 차례 — 관리자 승인 → 원장 승인 대기(감사로그 · 처리 이력 · 알림) · 차례 아닌 사람은 DB가 거절 (되돌림)', async () => {
    const out = await tx(async sql => {
      const wrong = await run(sql, 'changeWithdrawalReport', SOHEE, [pending.id, 'approve', pending.revision]);
      const stale = await run(sql, 'changeWithdrawalReport', pending.manager_ids[0], [pending.id, 'approve', pending.revision + 9]);
      const ok = await run(sql, 'changeWithdrawalReport', pending.manager_ids[0], [pending.id, 'approve', pending.revision]);
      const [r] = await sql`select status::text status from public.withdrawal_reports where id=${pending.id}`;
      const [log] = await sql`select actor_id::text actor_id, target_type, metadata from public.audit_logs where tenant_id=${tenantId} and action='withdrawal_report_update' and created_at >= now()`;
      return { wrong, stale, ok, status: r.status, log };
    });
    assert.ok(out.wrong.error, '강사는 승인 못 한다');
    assert.match(out.stale.error ?? '', /변경되었습니다/, '낡은 revision은 DB가 거절(2.0 문구)');
    assert.deepEqual(out.ok, { ok: true, id: pending.id });
    assert.equal(out.status, pending.director_ids.length ? 'director_pending' : 'scheduled');
    assert.deepEqual([out.log.actor_id, out.log.target_type, out.log.metadata.operation, out.log.metadata.via], [pending.manager_ids[0], 'student', '승인', '3.0 연습 복사본']);
  });

  if (pending) await check('저장: 반려(사유 1~1,000자 · 2.0 검증) → 수정 요청 (되돌림)', async () => {
    const out = await tx(async sql => ({
      empty: await run(sql, 'changeWithdrawalReport', pending.manager_ids[0], [pending.id, 'reject', pending.revision, '  ']),
      ok: await run(sql, 'changeWithdrawalReport', pending.manager_ids[0], [pending.id, 'reject', pending.revision, '상담 내용을 보충해 주세요.']),
      r: (await sql`select status::text status, last_comment from public.withdrawal_reports where id=${pending.id}`)[0],
    }));
    assert.equal(out.empty.error, '반려 사유를 1~1,000자로 작성해 주세요.');
    assert.deepEqual([out.ok.ok, out.r.status, out.r.last_comment], [true, 'revision', '상담 내용을 보충해 주세요.']);
  });

  await check('저장: 학원이 한 바퀴 — 작성 요청 → 담임 제출(200자 검증) → 관리자 승인 = 오늘 처리일이라 바로 퇴원 · 수강 종료 (되돌림)', async () => {
    const [course] = await db`select e.id::text id from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=${STU} and e.end_date is null and c.teacher_id=${WONIL}`;
    const today = (await db`select (now() at time zone 'Asia/Seoul')::date::text d`)[0].d;
    const out = await tx(async sql => {
      const scope = await run(sql, 'requestWithdrawalReport', SOHEE, [{ studentId: STU, teacherIds: [WONIL], managerIds: [YUJIN], directorIds: [], subjects: ['math'], effectiveDate: today, note: '' }]);
      const req = await run(sql, 'requestWithdrawalReport', SEOLHYUN, [{ studentId: STU, teacherIds: [WONIL], managerIds: [YUJIN], enrollmentIds: [course.id], directorIds: [], subjects: ['math'], effectiveDate: today, note: '시험' }]);
      const dup = await run(sql, 'requestWithdrawalReport', SEOLHYUN, [{ studentId: STU, teacherIds: [WONIL], managerIds: [YUJIN], enrollmentIds: [course.id], directorIds: [], subjects: ['math'], effectiveDate: today, note: '' }]);
      const [r] = await sql`select revision from public.withdrawal_reports where id=${req.id}`;
      const body = { reason: 'other', detail: '', studentConsultation: '학생과 상담함', parentConsultation: '학부모와 상담함', teacherOpinion: '담임 의견', attendance: '', tuition: '', arrears: 'unknown', arrearsNote: '' };
      const short = await run(sql, 'changeWithdrawalReport', WONIL, [req.id, 'submit', r.revision, { ...body, detail: '짧음' }]);
      const notMine = await run(sql, 'changeWithdrawalReport', YUJIN, [req.id, 'submit', r.revision, { ...body, detail: '가'.repeat(200) }]);
      const submit = await run(sql, 'changeWithdrawalReport', WONIL, [req.id, 'submit', r.revision, { ...body, detail: '가'.repeat(200) }]);
      const [s] = await sql`select revision, status::text status, body from public.withdrawal_reports where id=${req.id}`;
      const approve = await run(sql, 'changeWithdrawalReport', YUJIN, [req.id, 'approve', s.revision]);
      const [done] = await sql`select status::text status from public.withdrawal_reports where id=${req.id}`;
      const [stu] = await sql`select status::text status, withdrawn_at::text w from public.students where id=${STU}`;
      const [enr] = await sql`select end_date::text e from public.enrollments where id=${course.id}`;
      const logs = await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and action='withdrawal_report_update' and created_at >= now() order by id`;
      return { scope, req, dup, short, notMine, submit, s, approve, done, stu, enr, logs };
    });
    assert.ok(out.scope.error, '강사는 작성 요청을 못 한다');
    assert.equal(out.req.ok, true);
    assert.match(out.dup.error ?? '', /진행 중인 보고서/, '진행 중이면 두 번째 요청은 거절');
    assert.equal(out.short.error, '퇴원 상세사유를 200자 이상 작성해 주세요.');
    assert.ok(out.notMine.error, '담임이 아니면 제출 못 한다');
    assert.equal(out.submit.ok, true); assert.equal(out.s.status, 'manager_pending');
    assert.ok(out.s.body.tuition && out.s.body.arrearsNote, '제출 때 수납 칸은 장부에서 다시 채운다(2.0 loadReportBilling)');
    assert.equal(out.approve.ok, true); assert.equal(out.done.status, 'completed');
    assert.deepEqual([out.stu.status, out.stu.w, out.enr.e], ['withdrawn', today, today], '마지막 승인이 같은 트랜잭션에서 퇴원·수강 종료');
    assert.deepEqual(out.logs.map(l => l.metadata.operation).sort(), ['보고서 제출', '승인', '작성 요청'].sort()); // 한 트랜잭션이라 시각이 같다 — 순서 없이
    const last = out.logs.find(l => l.metadata.operation === '승인').metadata;
    assert.deepEqual([last.result, last.endedClasses?.length, last.via], ['학생 퇴원', 1, '3.0 연습 복사본']);
  });

  await check('저장: 관리자 바로 처리(앞날짜 = 처리 예약) · 기타 사유는 메모 필수 · 원본 학생 연결/해제 (되돌림)', async () => {
    const [course] = await db`select e.id::text id from public.enrollments e where e.student_id=${STU} and e.end_date is null limit 1`;
    const future = (await db`select ((now() at time zone 'Asia/Seoul')::date + 7)::text d`)[0].d;
    const [arch] = await db`select id::text id, revision, mapped_student_id::text mapped_student_id from public.withdrawal_report_archives where tenant_id=${tenantId} and mapped_student_id is not null order by id limit 1`;
    const out = await tx(async sql => ({
      memo: await run(sql, 'processWithdrawalDirectly', SEOLHYUN, [{ studentId: STU, enrollmentIds: [course.id], effectiveDate: future, reason: 'other', memo: '' }]),
      teacher: await run(sql, 'processWithdrawalDirectly', SOHEE, [{ studentId: STU, enrollmentIds: [course.id], effectiveDate: future, reason: 'relocation', memo: '' }]),
      ok: await run(sql, 'processWithdrawalDirectly', SEOLHYUN, [{ studentId: STU, enrollmentIds: [course.id], effectiveDate: future, reason: 'relocation', memo: '시험' }]),
      st: (await sql`select status::text s from public.withdrawal_reports where tenant_id=${tenantId} and student_id=${STU} and status <> 'canceled' order by created_at desc limit 1`)[0]?.s,
      unmap: await run(sql, 'mapArchive', SEOLHYUN, [{ id: arch.id, studentId: null, revision: arch.revision }], ARCHIVE_MODULE),
      mapped: (await sql`select mapped_student_id from public.withdrawal_report_archives where id=${arch.id}`)[0].mapped_student_id,
      log: (await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and action='withdrawal_report_archive_map' and created_at >= now()`)[0]?.metadata,
    }));
    assert.ok(out.memo.error, '기타는 메모가 있어야 한다(2.0 checkReasonInput)');
    assert.ok(out.teacher.error, '강사는 바로 처리 못 한다');
    assert.equal(out.ok.ok, true); assert.equal(out.st, 'scheduled');
    assert.deepEqual([out.unmap, out.mapped, out.log.previousStudentId, out.log.via], [{ ok: true }, null, arch.mapped_student_id, '3.0 연습 복사본']);
  });

  await check('저장 요청 검사 — 받지 않는 파일·모르는 사람은 거절', async () => {
    assert.throws(() => screen.actions.mapArchive.validate({ module: MODULE, actor: SEOLHYUN, args: [{}] }));
    assert.throws(() => screen.actions.changeWithdrawalReport.validate({ module: MODULE, actor: 'x', args: [] }));
    const r = await tx(sql => run(sql, 'changeWithdrawalReport', null, ['00000000-0000-0000-0000-000000000000', 'approve', 1]));
    assert.equal(r.error, '이 화면에서는 보고서를 수정할 수 없습니다.');
  });

  await check('시험 뒤 복사본은 그대로(보고서 · 이력 · 감사로그 · 알림 · 학원이 상태)', async () => {
    assert.deepEqual((await counts(db))[0], before);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-withdrawal-reports-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  for (const m of ['src/features/withdrawal-reports/server/actions.ts', 'src/features/withdrawal-reports/server/archive-actions.ts']) assert.ok(info.actions.map(a => a.replaceAll('\\', '/')).includes(m), `${m}는 서버 함수 자리표시로`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('withdrawal-reports.js', dist), 'utf8');
  const hosts = [...new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 주소·외부 주소·직접 저장 요청 없음 · 화면 글자에 개발자 말 없음', async () => {
  const js = await here('./v2-screen-withdrawal-reports.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/].map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
});

console.log(`v2 withdrawal-reports: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
