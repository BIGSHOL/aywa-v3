// 원생 기여도 기본 면 — 원본 점수·근거 조회와 원본 판정 함수의 Docker 롤백 검증.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { stopV2Server } from './v2-server-runner.mjs';
import { buildStudentDetail } from './v2-students-detail.mjs';
import { screen } from './v2-screen-students.mjs';
import { studentsBase } from './v2-students-common.mjs';
import { originalSignalFunction } from './v2-students-contribution-actions.mjs';

const db = await openFullDatabase();
test('기여도 기본 면 = 원본 월별 점수·근거 조회 · 다른 학생 자료 없음 · 읽기 전용', async () => {
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  assert.ok(student);
  const data = await db.begin('read only', (sql) => buildStudentDetail({ sql, tenantId, id: student.id,
    sp: { tab: 'contribution' }, importV2 }));
  assert.equal(data.tab.key, 'contribution');
  assert.equal(data.tab.data.contribution.student.id, student.id);
  assert.equal(data.tab.data.contribution.ready, true);
  assert.ok(data.tab.data.contribution.months.length > 0);
  assert.ok(data.tab.data.contribution.months.every((m) => m.studentId === undefined || m.studentId === student.id));
});
test('기여도 월별 점수 본문 = 2.0 본문 그대로', async () => {
  const root = new URL('../../', import.meta.url);
  const original = (await readFile(new URL('src/features/student-contribution/components/student-panel.tsx', root), 'utf8')).replace(/\r\n/g, '\n');
  const host = (await readFile(new URL('experiments/owner-concept/v2-host/src/students-tab-contribution.tsx', root), 'utf8')).replace(/\r\n/g, '\n');
  const expected = original.slice(original.indexOf('  if (!data)')).replace(
    '<Link href="/student-contribution" className="mt-5 inline-block text-sm text-primary underline">원생 기여도 목록으로</Link>',
    '<Link href="/students" className="mt-5 inline-block text-sm text-primary underline">원생 목록으로</Link>');
  assert.equal(host.slice(host.lastIndexOf('  if (!data)')), expected);
});
test('확장 근거 조회는 원본 함수를 Docker 읽기 경로로 호출한다', async () => {
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  const video = await db.begin('read only', (sql) => screen.load({ sql, tenantId, importV2,
    params: { v2path: `/students/${student.id}`, contributionRead: 'video', month: '2026-10' } }));
  assert.ok(video.result?.data, video.result?.error);
  const parent = await db.begin('read only', (sql) => screen.load({ sql, tenantId, importV2,
    params: { v2path: `/students/${student.id}`, contributionRead: 'parent', sourceId: '0'.repeat(64) } }));
  assert.equal(typeof parent.result.error, 'string');
});
test('긍정 신호 변경은 2.0 함수 AST의 열·감사 이름·낙관적 잠금 조건을 그대로 쓴다', async () => {
  const { text } = await originalSignalFunction();
  for (const required of ['.eq("judged_at", before.judged_at)', 'cancelled_at:', 'cancelled_by:', 'cancel_reason:',
    'rejudge_requested_at:', 'student_contribution_signal_cancel', 'student_contribution_signal_rejudge',
    'metadata: { id: value.id, studentId: before.student_id, before, reason: value.reason }']) assert.ok(text.includes(required), required);
  const action = screen.actions.changePositiveSignal;
  const [valid] = ['00000000-0000-0000-0000-000000000001'];
  assert.equal(action.validate({ module: 'features/student-contribution/server/actions.ts', actor: valid,
    args: [{ id: valid, operation: 'rejudge', reason: '원본 확인' }] }).input.operation, 'rejudge');
  assert.throws(() => action.validate({ module: 'features/student-contribution/server/actions.ts', actor: null,
    args: [{ id: valid, operation: 'rejudge', reason: '원본 확인' }] }));
});
test('원본 판정 취소·재판정은 같은 열과 감사로그를 쓰고 롤백되며 바깥 요청 0', async (t) => {
  const [signal] = await db`select id::text id, rejudge_requested_at, cancelled_at, cancelled_by::text cancelled_by, cancel_reason
    from public.student_positive_signals where tenant_id=${tenantId} and cancelled_at is null order by id limit 1`;
  if (!signal) return t.skip('복사본에 긍정 신호 기록이 없음');
  const base = await db.begin('read only', (sql) => studentsBase({ sql, tenantId, importV2 }));
  const [queueBefore] = await db`select count(*)::int n from net.http_request_queue`;
  const body = screen.actions.changePositiveSignal.validate({ module: 'features/student-contribution/server/actions.ts',
    actor: base.viewer.id, args: [{ id: signal.id, operation: 'rejudge', reason: 'Docker 롤백 확인' }] });
  const rollback = new Error('rollback');
  try {
    await db.begin(async (sql) => {
      const result = await screen.actions.changePositiveSignal.run({ sql, body, tenantId });
      assert.equal(result.ok, true, result.error);
      const cancelBody = screen.actions.changePositiveSignal.validate({ module: 'features/student-contribution/server/actions.ts',
        actor: base.viewer.id, args: [{ id: signal.id, operation: 'cancel', reason: 'Docker 롤백 확인' }] });
      const cancelled = await screen.actions.changePositiveSignal.run({ sql, body: cancelBody, tenantId });
      assert.equal(cancelled.ok, true, cancelled.error);
      const [changed] = await sql`select rejudge_requested_at, cancelled_at, cancelled_by::text cancelled_by, cancel_reason
        from public.student_positive_signals where id=${signal.id}`;
      assert.ok(changed.rejudge_requested_at);
      assert.ok(changed.cancelled_at);
      assert.equal(changed.cancelled_by, base.viewer.id);
      assert.equal(changed.cancel_reason, 'Docker 롤백 확인');
      assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, queueBefore.n);
      const audits = await sql`select action from public.audit_logs where tenant_id=${tenantId}
        and action in ('student_contribution_signal_rejudge', 'student_contribution_signal_cancel') and metadata->>'id'=${signal.id}`;
      assert.ok(audits.some((r) => r.action === 'student_contribution_signal_rejudge'));
      assert.ok(audits.some((r) => r.action === 'student_contribution_signal_cancel'));
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  const [after] = await db`select id::text id, rejudge_requested_at, cancelled_at, cancelled_by::text cancelled_by, cancel_reason
    from public.student_positive_signals where id=${signal.id}`;
  const [queueAfter] = await db`select count(*)::int n from net.http_request_queue`;
  assert.deepEqual(after, signal);
  assert.equal(queueAfter.n, queueBefore.n);
});
test.after(async () => { await stopV2Server(); await db.end(); });
