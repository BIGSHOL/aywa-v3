// 2.0 화면 — 수업보고서 관리 저장 시험(v2-lesson-reports-save.mjs · Docker 복사본 · 전부 트랜잭션째 되돌림 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-lesson-reports-save.mjs
// ① 대응표 = 2.0 서버 함수 이름 그대로 · 거절 목록과 겹치지 않음 ② 1차 저장(회수 · 멈춤 복구 · 원아 연결 · 프롬프트 · 통계 보기 기억 · 보고서 설정)
// ③ 저장하는 사람 · 입력 모양 · 발송 요청은 Docker queued까지만 · 나머지 바깥 작업은 그 자리에서 거절.
// 시험 학생 = is_test(학원삼 · 학원이).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const RA = 'features/report-admin/server/';
const VIA = '3.0 연습 복사본';
const NET = `select case when to_regclass('net.http_request_queue') is null then -1 else (select count(*)::int from net.http_request_queue) end n`;

let ctx = null;
async function setup() {
  if (ctx) return ctx;
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { studentsBase } = await import('./v2-students-common.mjs');
  const S = await import('./v2-lesson-reports-save.mjs');
  const { runV2Server } = await import('./v2-server-runner.mjs');
  let editors;
  await db.begin('read only', async (sql) => { editors = await S.readLessonEditors(await studentsBase({ sql, tenantId: t, importV2 })); });
  const master = editors[0];
  // 시험 보고서: 학원삼(is_test) 미발송 수학 보고서 · 발송된(success) 시험 보고서 하나.
  const [unsent] = await db`select r.id::text id, r.class_id::text class_id, r.student_id::text student_id from public.lesson_reports r join public.students s on s.id = r.student_id
    where r.tenant_id=${t} and s.is_test and r.classnote_status is null and r.revoked_at is null and r.subject='math' and r.class_id is not null order by r.report_date desc limit 1`;
  const [sent] = await db`select r.id::text id from public.lesson_reports r join public.students s on s.id = r.student_id
    where r.tenant_id=${t} and s.is_test and r.classnote_status='success' and r.revoked_at is null order by r.report_date desc limit 1`;
  const [{ n: net }] = await db.unsafe(NET);
  // 시험 전용: 고른 사람으로 · 쓰기 트랜잭션 · 끝나면 되돌림(probes = 같은 트랜잭션에서 읽은 뒤).
  const run = (steps, probes = [], allowRefs = false) => runV2Server({ steps, probes, allowRefs, actorId: master.id, tenantId: t, mode: 'write', rollback: true });
  ctx = { t, importV2, S, editors, master, unsent, sent, net, run };
  return ctx;
}

test('대응표 = 2.0 서버 함수 이름 그대로(그 파일이 내보내는 async 함수) · 진입점 거절 목록과 겹치지 않음 · 보고서 설정은 학원 설정 저장 그대로', async () => {
  const { LR_WRITES, LR_READS, lessonReportsActions } = await import('./v2-lesson-reports-save.mjs');
  for (const [module, names] of [...Object.entries(LR_WRITES), ...Object.entries(LR_READS)]) {
    const code = lf(await src(module));
    for (const n of names) assert.match(code, new RegExp(`export async function ${n}\\(`), `${module}#${n}`);
  }
  const entry = lf(await here('./v2-host/src/lesson-reports.tsx'));
  const refuse = entry.slice(entry.indexOf('const REFUSE'), entry.indexOf('for (const [module, names] of Object.entries(REFUSE))'));
  for (const name of Object.keys(lessonReportsActions)) assert.ok(!refuse.includes(`"${name}"`), `${name}이 거절 목록에도 있다`);
  for (const n of ['saveReportStatsMode', 'saveOwnerSection', 'requestReportRecall', 'savePrompt']) {
    assert.ok(n in lessonReportsActions, n);
    assert.ok(!entry.includes(`"${n}", async () => ({ ok: false`), `${n}을 진입점이 거절한다`);
  }
  for (const n of ['sendClassnoteForUnsent', 'retryClassnote']) {
    assert.ok(n in lessonReportsActions, `${n}을 Docker 대기열에 연결`);
    assert.ok(!refuse.includes(`"${n}"`), `${n} 거절 금지`);
    assert.match(entry, /for \(const \[module, names\] of QUEUE_ACTIONS\)/);
  }
  for (const n of ['sendClassNotice', 'sendClassWideNotice', 'previewClassNotice']) assert.ok(n in lessonReportsActions, `${n}을 Docker에 연결`);
  for (const n of Object.values(LR_READS).flat()) assert.ok(n in lessonReportsActions, `${n}을 원본 읽기로 연결`);
  assert.match(entry, /연습 복사본이라 실제로 보내지지 않습니다 — 발송 대기로만 남습니다/);
  // 직접 발송·공지·답글 등은 아직 받지 않는다(진입점이 그 자리에서 거절).
  assert.ok('saveAdminReport' in lessonReportsActions);
  for (const n of ['saveAndQueueAdminReport', 'sendBulkAdminReports', 'editQueuedNotice', 'deleteQueuedNotice', 'requestParentReply', 'requestParentReaction'])
    { assert.ok(refuse.includes(`"${n}"`), n); assert.ok(!(n in lessonReportsActions), n); }
  assert.match(entry, /"requestClassnoteBoardSync", async \(\) => \(\{ ok: false, error: VIEW_ONLY \}\)/);
  assert.match(entry, /"testPrompt", async \(\) =>/);
});

test('발송 요청 = 일반 학생 미발송 보고서가 Docker queued · 미발송 할 일 처리됨(send_requested) · 바깥 요청 0 · 시험 뒤 전부 되돌림', { skip: SKIP }, async () => {
  const { t, run, net } = await setup();
  const [target] = await db`select r.id::text id, r.report_date::text report_date, task.id::text task_id, member.status member_status
    from public.lesson_reports r
    join public.students s on s.id=r.student_id
    join public.classes cls on cls.id=r.class_id and cls.is_active and not cls.report_optout and cls.subject in ('math','subject_1')
    join public.classnote_class_boards board on board.tenant_id=r.tenant_id and board.class_id=r.class_id
    join public.classnote_class_board_members member on member.tenant_id=r.tenant_id and member.class_id=r.class_id
      and member.student_id=r.student_id and member.status in ('ok','hold')
    join public.staff_tasks task on task.subject_id=r.id and task.tenant_id=r.tenant_id
      and task.kind='unsent_report' and task.status='open'
    where r.tenant_id=${t} and not coalesce(s.is_test,false) and r.classnote_status is null
      and r.revoked_at is null and (r.source is null or r.source <> 'edutrix_import')
      and nullif(trim(r.notes),'') is not null
      and not exists (select 1 from public.lesson_reports other where other.student_id=r.student_id
        and other.class_id=r.class_id and other.report_date=(now() at time zone 'Asia/Seoul')::date and other.id<>r.id)
    order by r.report_date desc limit 1`;
  assert.ok(target, '일반 학생의 최근 미발송 보고서와 열린 할 일이 필요합니다');
  // 오래된 복사본에서도 돌도록 날짜와 원아 상태를 시험 트랜잭션 안에서만 준비한다. 발송 함수는 2.0 원본 그대로 실행한다.
  const fixture = { $sql: `with fixed as (
    update public.classnote_class_board_members m set status='ok'
    where m.tenant_id=$1 and m.student_id=(select student_id from public.lesson_reports where id=$2)
      and m.class_id=(select class_id from public.lesson_reports where id=$2) and m.status='hold'
    returning m.id
  ), refreshed as (
    update public.lesson_reports r set report_date=(now() at time zone 'Asia/Seoul')::date
    where r.id=$2 and r.report_date < ((now() at time zone 'Asia/Seoul')::date - interval '6 days')::date
    returning r.id
  ) select $2::text id from (select count(*) from fixed) f cross join (select count(*) from refreshed) d`, params: [t, target.id] };
  const result = await run([{ module: `${RA}actions.ts`, fn: 'sendClassnoteForUnsent', args: [[fixture]] }], [
    { text: 'select classnote_status, classnote_queued_at is not null queued_at from public.lesson_reports where id=$1', params: [target.id] },
    { text: 'select status, close_reason from public.staff_tasks where id=$1', params: [target.task_id] },
    { text: NET },
  ], true);
  assert.equal(result.results[0].value.ok, true, JSON.stringify(result.results[0].value));
  assert.equal(result.results[0].value.queued, 1, '2.0 발송 게이트를 지나야 한다');
  assert.deepEqual([...result.probes[0]], [{ classnote_status: 'queued', queued_at: true }]);
  assert.deepEqual([...result.probes[1]], [{ status: 'done', close_reason: 'send_requested' }]);
  assert.equal(result.probes[2][0].n, net, 'pg_net 바깥 요청 큐 증가 0');
  assert.match(await here('./v2-server/worker.mjs'), /globalThis\.fetch = async url => \{ throw new UnsupportedShape/, '러너의 바깥 fetch 차단');
  const [after] = await db`select classnote_status, report_date::text report_date from public.lesson_reports where id=${target.id}`;
  const [afterTask] = await db`select status from public.staff_tasks where id=${target.task_id}`;
  const [afterMember] = await db`select status from public.classnote_class_board_members where tenant_id=${t}
    and student_id=(select student_id from public.lesson_reports where id=${target.id})
    and class_id=(select class_id from public.lesson_reports where id=${target.id}) limit 1`;
  assert.equal(after.classnote_status, null, '보고서 되돌림');
  assert.equal(after.report_date, target.report_date, '보고서 날짜 시험 준비도 되돌림');
  assert.equal(afterTask.status, 'open', '할 일 되돌림');
  assert.equal(afterMember.status, target.member_status, '원아 매칭 시험 준비도 되돌림');
});

test('동기화 보고서 다운로드 = 2.0 본문·파일 이름 그대로 · 내려받기 감사로그 · 바깥 요청 0 · 시험 뒤 되돌림', { skip: SKIP }, async () => {
  const { t, run, net } = await setup();
  const module = `${RA}classnote-sync-report-actions.ts`;
  const [{ n: beforeAudit }] = await db`select count(*)::int n from public.audit_logs
    where tenant_id=${t} and action='classnote_board_sync_report_export'`;
  const out = await run([{ module, fn: 'downloadClassnoteSyncReport', args: [] }], [
    { text: `select action, metadata->>'via' via from public.audit_logs
      where tenant_id=$1 and action='classnote_board_sync_report_export' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  const report = out.results[0].value;
  assert.equal(report.ok, true, JSON.stringify({ ok: report.ok, error: report.error }));
  assert.match(report.filename, /^ClassNote-동기화보고서-.*\.txt$/);
  assert.match(report.text, /동기화/);
  assert.ok(report.text.length > 100, '본문이 비어 있지 않다');
  assert.ok(out.probes[0].some((row) => row.action === 'classnote_board_sync_report_export' && row.via === VIA));
  assert.equal(out.probes[1][0].n, net, 'pg_net 큐 증가 0');
  const [{ n: afterAudit }] = await db`select count(*)::int n from public.audit_logs
    where tenant_id=${t} and action='classnote_board_sync_report_export'`;
  assert.equal(afterAudit, beforeAudit, '감사로그도 되돌림');
});

test('직접 발송·답글 읽기 넷 = 고른 사람의 2.0 함수 · 읽기 전용 · 외부 요청 0', { skip: SKIP }, async () => {
  const { t, S, editors, master, importV2, net } = await setup();
  const [student] = await db`select id::text id from public.students where tenant_id=${t} and status='enrolled'
    and not coalesce(is_test,false) limit 1`;
  const [message] = await db`select id::text id from public.classnote_parent_messages where tenant_id=${t}
    order by posted_at desc limit 1`;
  const [notification] = await db`select id::text id, recipient_id::text recipient_id from public.notifications
    where tenant_id=${t} and recipient_id = any(${editors.map((e) => e.id)}::uuid[])
      and type in ('classnote_parent_post','classnote_parent_comment') order by created_at desc limit 1`;
  assert.ok(student && message && notification, '원본 읽기 넷의 시험 자료');
  const cases = [
    [`${RA}compose-actions.ts`, 'getAdminComposeContext', [student.id], master.id, 'student'],
    [`${RA}compose-actions.ts`, 'getAdminSendClassOptions', [{ studentId: student.id, subject: 'math' }], master.id, 'candidates'],
    ['features/classnote-reply/server/reply-actions.ts', 'getParentReplyContext', [message.id], master.id, 'thread'],
    ['features/classnote-reply/server/notification-reply.ts', 'getNotificationReplyContext', [notification.id], notification.recipient_id, 'thread'],
  ];
  for (const [module, fn, args, actor, key] of cases) {
    const action = S.lessonReportsActions[fn];
    const body = action.validate({ module, actor, args });
    const result = await db.begin('read only', (sql) => action.run({ sql, body, tenantId: t, importV2 }));
    assert.equal(result.ok, true, `${fn}: ${result.error ?? ''}`);
    assert.ok(key in result, `${fn} 원본 반환 모양`);
  }
  const [{ n: afterNet }] = await db.unsafe(NET);
  assert.equal(afterNet, net, '읽기 중 pg_net 바깥 요청 큐 증가 0');
});

test('공지 미리보기와 원생별·반 단체 발송 = 2.0 함수 · Docker queued만 · 바깥 요청 0 · 시험 뒤 되돌림', { skip: SKIP }, async () => {
  const { t, S, master, importV2, run, net } = await setup();
  const [target] = await db`select c.id::text id from public.classes c
    join public.classnote_class_boards b on b.class_id=c.id and b.tenant_id=${t}
    join public.classnote_class_board_members m on m.class_id=c.id and m.tenant_id=${t} and m.status='ok'
    join public.enrollments e on e.class_id=c.id and e.student_id=m.student_id and e.end_date is null
    join public.students s on s.id=e.student_id and s.status='enrolled'
    where c.tenant_id=${t} and c.is_active and c.subject in ('math','subject_1') limit 1`;
  assert.ok(target, '공지 미리보기 대상인 활성 반과 확인된 반 원아');
  const module = `${RA}notice-actions.ts`;
  const input = { classIds: [target.id], body: '연습 공지 대기열 시험', individual: {}, test: false };
  const action = S.lessonReportsActions.previewClassNotice;
  const preview = await db.begin('read only', (sql) => action.run({ sql, body: action.validate({ module, actor: master.id, args: [input] }), tenantId: t, importV2 }));
  assert.equal(preview.ok, true, JSON.stringify({ ok: preview.ok, error: preview.error }));
  assert.ok(preview.preview.studentCount > 0, '대상 미리보기가 비어 있지 않다');
  const [{ n: beforeIndividual }] = await db`select count(*)::int n from public.classnote_notices where tenant_id=${t} and body=${input.body}`;
  const individual = await run([{ module, fn: 'sendClassNotice', args: [{ ...input, previewFingerprint: preview.preview.fingerprint }] }], [
    { text: 'select status, jsonb_array_length(targets)::int target_count from public.classnote_notices where tenant_id=$1 and body=$2 and created_at=now()', params: [t, input.body] },
    { text: `select metadata->>'via' via, metadata->>'source' source from public.audit_logs where tenant_id=$1 and action='classnote_notice_send' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  assert.equal(individual.results[0].value.ok, true, JSON.stringify(individual.results[0].value));
  assert.ok(individual.results[0].value.queued > 0, '원생별 공지 대기열에 오름');
  assert.deepEqual([...individual.probes[0]], [{ status: 'queued', target_count: individual.results[0].value.queued }]);
  assert.ok(individual.probes[1].some((row) => row.via === VIA && row.source === 'class'));
  assert.equal(individual.probes[2][0].n, net);
  const [{ n: afterIndividual }] = await db`select count(*)::int n from public.classnote_notices where tenant_id=${t} and body=${input.body}`;
  assert.equal(afterIndividual, beforeIndividual, '원생별 대기열과 감사로그 되돌림');

  const title = '연습 반 단체 공지 대기열 시험';
  const [{ n: beforeWide }] = await db`select count(*)::int n from public.classnote_class_notices where tenant_id=${t} and title=${title}`;
  const wide = await run([{ module: `${RA}class-notice-actions.ts`, fn: 'sendClassWideNotice', args: [{ classIds: [target.id], title, body: input.body, test: false }] }], [
    { text: 'select status, jsonb_array_length(targets)::int target_count from public.classnote_class_notices where tenant_id=$1 and title=$2 and created_at=now()', params: [t, title] },
    { text: `select metadata->>'via' via, metadata->>'source' source from public.audit_logs where tenant_id=$1 and action='classnote_notice_send' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  assert.equal(wide.results[0].value.ok, true, JSON.stringify(wide.results[0].value));
  assert.equal(wide.results[0].value.queued, 1);
  assert.deepEqual([...wide.probes[0]], [{ status: 'queued', target_count: 1 }]);
  assert.ok(wide.probes[1].some((row) => row.via === VIA && row.source === 'class_wide'));
  assert.equal(wide.probes[2][0].n, net);
  const [{ n: afterWide }] = await db`select count(*)::int n from public.classnote_class_notices where tenant_id=${t} and title=${title}`;
  assert.equal(afterWide, beforeWide, '반 단체 대기열과 감사로그 되돌림');
});

test('게시된 공지 수정·회수 = 2.0 요청 상태까지만 · 바깥 요청 0 · 시험 뒤 되돌림', { skip: SKIP }, async () => {
  const { t, run, net } = await setup();
  const [target] = await db`select id::text id, body, status from public.classnote_notices
    where tenant_id=${t} and status='success' and results is not null
      and results::text like '%"reports"%' and targets::text not like '%"attachments"%'
    order by created_at desc limit 1`;
  assert.ok(target, '게시글 정보가 있는 수정·회수 가능 공지');
  const module = 'features/onescreen/server/notice-actions.ts';
  const editBody = '연습 복사본 공지 수정 요청 시험';
  const edit = await run([{ module, fn: 'editPostedNotice', args: [target.id, editBody] }], [
    { text: 'select status, body from public.classnote_notices where id=$1', params: [target.id] },
    { text: `select metadata->>'via' via from public.audit_logs where tenant_id=$1 and action='classnote_notice_edit' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  assert.deepEqual(edit.results[0].value, { ok: true });
  assert.deepEqual([...edit.probes[0]], [{ status: 'edit_requested', body: editBody }]);
  assert.ok(edit.probes[1].some((row) => row.via === VIA));
  assert.equal(edit.probes[2][0].n, net);
  const [afterEdit] = await db`select status, body from public.classnote_notices where id=${target.id}`;
  assert.deepEqual({ ...afterEdit }, { status: target.status, body: target.body }, '수정 요청 되돌림');

  const revoke = await run([{ module, fn: 'cancelOnescreenNotice', args: [target.id] }], [
    { text: 'select status from public.classnote_notices where id=$1', params: [target.id] },
    { text: `select metadata->>'via' via from public.audit_logs where tenant_id=$1 and action='classnote_notice_revoke' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  assert.deepEqual(revoke.results[0].value, { ok: true });
  assert.deepEqual([...revoke.probes[0]], [{ status: 'revoke_requested' }]);
  assert.ok(revoke.probes[1].some((row) => row.via === VIA));
  assert.equal(revoke.probes[2][0].n, net);
  const [afterRevoke] = await db`select status from public.classnote_notices where id=${target.id}`;
  assert.equal(afterRevoke.status, target.status, '회수 요청 되돌림');
});

test('관리자 직접 작성 = 시험 학생 보고서 행만 저장 · 발송 상태 없음 · 바깥 요청 0 · 시험 뒤 되돌림', { skip: SKIP }, async () => {
  const { t, unsent, run, net } = await setup();
  assert.ok(unsent, '시험 학생 보고서');
  const reportDate = '2020-01-17', notes = '연습 복사본 직접 작성 시험';
  const input = { studentId: unsent.student_id, reportDate, subject: 'math',
    progress: '연습', examInfo: '', homeworkScore: '없음', notes };
  const before = await db`select id::text id, notes, source, classnote_status from public.lesson_reports
    where tenant_id=${t} and student_id=${unsent.student_id} and report_date=${reportDate} and class_id is null and subject='math'`;
  const saved = await run([{ module: `${RA}compose-actions.ts`, fn: 'saveAdminReport', args: [input] }], [
    { text: `select id::text id, notes, source, classnote_status from public.lesson_reports
      where tenant_id=$1 and student_id=$2 and report_date=$3 and class_id is null and subject='math'`, params: [t, unsent.student_id, reportDate] },
    { text: `select metadata->>'via' via from public.audit_logs where tenant_id=$1 and action='lesson_report_save' and created_at=now()`, params: [t] },
    { text: NET },
  ]);
  assert.equal(saved.results[0].value.ok, true, JSON.stringify(saved.results[0].value));
  assert.equal(saved.probes[0].length, 1);
  assert.equal(saved.probes[0][0].id, saved.results[0].value.id);
  assert.equal(saved.probes[0][0].notes, notes);
  assert.equal(saved.probes[0][0].source, 'admin');
  assert.equal(saved.probes[0][0].classnote_status, null, '발송하지 않는다');
  assert.ok(saved.probes[1].some((row) => row.via === VIA));
  assert.equal(saved.probes[2][0].n, net);
  const after = await db`select id::text id, notes, source, classnote_status from public.lesson_reports
    where tenant_id=${t} and student_id=${unsent.student_id} and report_date=${reportDate} and class_id is null and subject='math'`;
  assert.deepEqual([...after], [...before], '직접 작성 되돌림');
});

test('저장하는 사람 = 보고서 관리 · 보고서 설정 · AI 멘트 중 하나라도 쓰기인 재직 직원(운영자 계정 제외 · 원장 먼저) · 목록 밖 = 로그인 없음', { skip: SKIP }, async () => {
  const { editors, master, t, importV2, S } = await setup();
  assert.equal(master.role, '원장');
  const supers = new Set((await db`select id::text id from public.super_admins`).map((r) => r.id));
  assert.ok(editors.every((e) => !supers.has(e.id)));
  // 퇴사·운영자 계정은 목록 밖.
  const inactive = new Set((await db`select id::text id from public.users where tenant_id=${t} and status::text <> 'active'`).map((r) => r.id));
  assert.ok(editors.every((e) => !inactive.has(e.id)));
  // 입력 모양 — 모듈이 다르면 · 인자 넷 넘으면 · 고른 사람이 uuid가 아니면 400.
  const a = S.lessonReportsActions.requestReportRecall;
  assert.throws(() => a.validate({ module: `${RA}actions.ts`, actor: master.id, args: [[]] }), /입력 값/);
  assert.throws(() => a.validate({ module: `${RA}recall-actions.ts`, actor: 'x', args: [[]] }), /입력 값/);
  assert.deepEqual(a.validate({ module: `${RA}recall-actions.ts`, actor: master.id, args: [['a']] }), { actor: master.id, args: [['a']] });
  // 보고서 설정 면 = 'report' 섹션만.
  const own = S.lessonReportsActions.saveOwnerSection, form = (section) => ({ $formData: [['section', section], ['data', '{}']] });
  assert.throws(() => own.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, form('profile')] }), /보고서 설정만/);
  assert.ok(own.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, form('report')] }));
  void importV2;
});

test('1차 회수 = 2.0 requestReportRecall — 행이 recall_requested · 링크 즉시 끊김 · 감사로그 via · 바깥 요청 0', { skip: SKIP }, async () => {
  const { run, sent, t, net } = await setup();
  assert.ok(sent, '발송된 시험 보고서');
  const r = await run([{ module: `${RA}recall-actions.ts`, fn: 'requestReportRecall', args: [[sent.id]] }], [
    { text: `select classnote_status, revoked_at is not null revoked from public.lesson_reports where id=$1`, params: [sent.id] },
    { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and created_at = now() order by id`, params: [t] },
    { text: NET }]);
  assert.deepEqual(r.results[0].value, { ok: true, recalled: 1, skipped: 0, forbidden: 0 });
  assert.deepEqual([...r.probes[0]], [{ classnote_status: 'recall_requested', revoked: true }]);
  assert.ok(r.probes[1].some((l) => l.via === VIA), '감사로그 via');
  assert.equal(r.probes[2][0].n, net, 'pg_net 큐 증가 0');
  const [after] = await db`select classnote_status from public.lesson_reports where id=${sent.id}`;
  assert.equal(after.classnote_status, 'success', '되돌림');
});

test('1차 멈춤 복구 · 원아 연결 · 프롬프트 저장·되돌리기 · 통계 보기 기억 = 2.0 함수 그대로(테스트 학생 연결은 2.0이 거절)', { skip: SKIP }, async () => {
  const { run, unsent, master, t } = await setup();
  const reset = await run([{ module: `${RA}actions.ts`, fn: 'resetStuckClassnote', args: [] }]);
  assert.equal(reset.results[0].value.ok, true); assert.equal(typeof reset.results[0].value.reset, 'number');
  const [board] = await db`select board_id::int board_id from public.classnote_class_boards where tenant_id=${t} and class_id=${unsent.class_id}`;
  const link = await run([
    { module: `${RA}board-roster-actions.ts`, fn: 'linkClassnoteChild', args: [{ studentId: unsent.student_id, boardId: board?.board_id ?? 1, childId: 1 }] },
    { module: `${RA}board-roster-actions.ts`, fn: 'unlinkClassnoteChild', args: [{ studentId: unsent.student_id, boardId: board?.board_id ?? 1 }] }]);
  assert.deepEqual(link.results[0].value, { ok: false, error: '테스트 학생은 연결하지 않습니다' });
  assert.deepEqual(link.results[1].value, { ok: true });
  const P = 'features/onescreen/server/prompt-actions.ts';
  const pr = await run([{ module: P, fn: 'savePrompt', args: ['comment', '시험 프롬프트 {{facts}}'] }],
    [{ text: `select is_active, prompt_text from public.ai_prompt_overrides where tenant_id=$1 and prompt_type='comment' and created_at = now()`, params: [t] }]);
  assert.deepEqual(pr.results[0].value, { ok: true });
  assert.deepEqual([...pr.probes[0]], [{ is_active: true, prompt_text: '시험 프롬프트 {{facts}}' }]);
  const rp = await run([{ module: P, fn: 'savePrompt', args: ['comment', '시험 프롬프트 {{facts}}'] }, { module: P, fn: 'resetPrompt', args: ['comment'] }],
    [{ text: `select count(*)::int n from public.ai_prompt_overrides where tenant_id=$1 and prompt_type='comment' and is_active`, params: [t] }]);
  assert.deepEqual(rp.results[1].value, { ok: true }); assert.equal(rp.probes[0][0].n, 0, '되돌리면 활성 재정의 없음');
  const st = await run([{ module: 'features/lesson-reports/stats/prefs-actions.ts', fn: 'saveReportStatsMode', args: [{ mode: 'day' }] }],
    [{ text: `select ui_prefs->'reportStats' p from public.users where id=$1`, params: [master.id] }]);
  assert.deepEqual(st.results[0].value, { ok: true }); assert.deepEqual(st.probes[0][0].p, { mode: 'day' });
});

test('1차 보고서 설정 = 학원 설정 저장(saveOwnerSection) 그대로 — report 섹션만 · 다른 섹션 그대로 · 감사로그 via', { skip: SKIP }, async () => {
  const { t, importV2, S, master } = await setup();
  const ROLL = new Error('rollback');
  try {
    await db.begin(async (sql) => {
      const [{ data: before }] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
      const { screen } = await import('./v2-screen-lesson-reports.mjs');
      const d = await screen.load({ sql, params: { tab: 'report' }, tenantId: t, importV2 });
      const report = { ...d.tabData.reportSettings, writingExemptTeachers: [...(d.tabData.reportSettings.writingExemptTeachers ?? []), '시험강사'] };
      const a = S.lessonReportsActions.saveOwnerSection;
      const out = await a.run({ sql, body: a.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, { $formData: [['section', 'report'], ['data', JSON.stringify(report)]] }] }), tenantId: t, importV2 });
      assert.equal(out.ok, true, JSON.stringify(out));
      const [{ data: after }] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
      assert.ok(after.report.writingExemptTeachers.includes('시험강사'));
      for (const k of Object.keys(before).filter((k) => k !== 'report')) assert.deepEqual(after[k], before[k], `${k} 그대로`);
      const [log] = await sql`select metadata->>'via' via, metadata->>'section' section from public.audit_logs where tenant_id=${t} and created_at = now() and action='owner_settings_update'`;
      assert.deepEqual({ ...log }, { via: VIA, section: 'report' });
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
});

test('진입점 = 통계 화면도 저장하는 사람 목록을 받는다', async () => {
  assert.match(lf(await here('./v2-host/src/lesson-reports-stats.tsx')), /setHostEditors\(body\.editors\)/);
});

test.after(async () => { const { stopV2Server } = await import('./v2-server-runner.mjs'); await stopV2Server(); await db?.end(); });
