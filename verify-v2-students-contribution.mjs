// 원생 기여도 기본 면 — Docker 읽기만, 원본 점수·근거 자료와 같은 서버 함수.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { stopV2Server } from './v2-server-runner.mjs';
import { buildStudentDetail } from './v2-students-detail.mjs';
import { screen } from './v2-screen-students.mjs';
import { studentsBase } from './v2-students-common.mjs';

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
test('긍정 신호 변경은 원본 함수·선택 사용자·형식 검증으로만 받는다', () => {
  const action = screen.actions.changePositiveSignal;
  const [valid] = ['00000000-0000-0000-0000-000000000001'];
  assert.equal(action.validate({ module: 'features/student-contribution/server/actions.ts', actor: valid,
    args: [{ id: valid, operation: 'rejudge', reason: '원본 확인' }] }).input.operation, 'rejudge');
  assert.throws(() => action.validate({ module: 'features/student-contribution/server/actions.ts', actor: valid,
    args: [{ id: valid, operation: 'rejudge', reason: ' ' }] }));
  assert.throws(() => action.validate({ module: 'features/student-contribution/server/actions.ts', actor: valid,
    args: [{ id: valid, operation: 'delete', reason: '원본 확인' }] }));
});
test('긍정 신호 변경 원본 함수의 Docker 쓰기는 롤백되고 바깥 요청 줄을 늘리지 않는다', async (t) => {
  const [signal] = await db`select id::text id, rejudge_requested_at from public.student_positive_signals
    where tenant_id=${tenantId} order by id limit 1`;
  if (!signal) return t.skip('복사본에 긍정 신호 기록이 없음');
  const base = await db.begin('read only', (sql) => studentsBase({ sql, tenantId, importV2 }));
  const [before] = await db`select rejudge_requested_at from public.student_positive_signals where id=${signal.id}`;
  const [queueBefore] = await db`select count(*)::int n from net.http_request_queue`;
  const body = screen.actions.changePositiveSignal.validate({ module: 'features/student-contribution/server/actions.ts',
    actor: base.viewer.id, args: [{ id: signal.id, operation: 'rejudge', reason: 'Docker 롤백 확인' }] });
  const rollback = new Error('rollback');
  try {
    await db.begin(async (sql) => {
      const result = await screen.actions.changePositiveSignal.run({ sql, body, tenantId });
      assert.equal(result.ok, true, result.error);
      assert.equal((await sql`select count(*)::int n from net.http_request_queue`)[0].n, queueBefore.n);
      assert.equal((await sql`select count(*)::int n from public.audit_logs where tenant_id=${tenantId}
        and action='student_contribution_signal_rejudge' and metadata->>'id'=${signal.id}`)[0].n > 0, true);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  const [after] = await db`select rejudge_requested_at from public.student_positive_signals where id=${signal.id}`;
  const [queueAfter] = await db`select count(*)::int n from net.http_request_queue`;
  assert.deepEqual(after, before);
  assert.equal(queueAfter.n, queueBefore.n);
});
test.after(async () => { await stopV2Server(); await db.end(); });
