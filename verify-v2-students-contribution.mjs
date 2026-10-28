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
import { originalListFunction, originalRecentFunction } from './v2-students-contribution-list.mjs';

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
  assert.equal(data.tab.data.live.studentId, student.id);
  assert.deepEqual(data.tab.data.live.sections.map((section) => section.key),
    ['classes', 'consultations', 'memos', 'family', 'reservations', 'makeups']);
  assert.ok(['ready', 'empty', 'stale', 'unavailable'].includes(data.tab.data.summary?.state));
});
test('기여도 월별 점수 본문 = 2.0 본문 그대로', async () => {
  const root = new URL('../../', import.meta.url);
  const original = (await readFile(new URL('src/features/student-contribution/components/student-panel.tsx', root), 'utf8')).replace(/\r\n/g, '\n');
  const host = (await readFile(new URL('experiments/owner-concept/v2-host/src/students-tab-contribution.tsx', root), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(host.slice(host.lastIndexOf('  if (!data)')), original.slice(original.indexOf('  if (!data)')));
});
test('기여도 목록은 2.0 목록 본문과 Docker 집계 함수를 쓰며 바깥 요청이 없다', async () => {
  const { text: original } = await originalListFunction();
  for (const piece of ['getContributionDirectory()', 'getContributionSnapshot()', 'cachedContributionTotals(', 'cachedEnrolledMonths(',
    'students.map((s) => ({ ...s, enrolledMonths:']) assert.ok(original.includes(piece), piece);
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  const [queueBefore] = await db`select count(*)::int n from net.http_request_queue`;
  const data = await db.begin('read only', (sql) => buildStudentDetail({ sql, tenantId, id: student.id,
    sp: { tab: 'contribution', contribution: 'list' }, importV2 }));
  const list = data.tab.data.list;
  assert.equal(list.ready, true);
  assert.equal(list.gate.tenantId, tenantId);
  assert.ok(list.rows.length > 0);
  assert.ok(list.rows.every((row) => row.id && row.total?.studentId === row.id));
  const item = list.rows.find((row) => row.total);
  const { normalizeStoredRaws } = await importV2('features/student-contribution/model/normalize-raws.ts');
  const { shiftMonth } = await importV2('lib/date-kst.ts');
  const [stored] = await db`select raws, recent from public.student_contribution_totals(${tenantId}, ${[item.id]}::uuid[],
    ${shiftMonth(list.month, -11)})`;
  assert.deepEqual(item.total.raws, normalizeStoredRaws(stored.raws));
  assert.deepEqual(item.total.recent, normalizeStoredRaws(stored.recent));
  assert.equal((await db`select count(*)::int n from net.http_request_queue`)[0].n, queueBefore.n);
});
test('기간별 증감과 미확인 항목은 2.0 함수의 Docker 읽기 경로로 열린다', async () => {
  const { text } = await originalRecentFunction();
  for (const piece of ['schema.safeParse(input)', 'getContributionScoreRoster()', 'getContributionSnapshot()',
    'cachedContributionTotals(', 'snapshot.revision']) assert.ok(text.includes(piece), piece);
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  const detail = await db.begin('read only', (sql) => buildStudentDetail({ sql, tenantId, id: student.id,
    sp: { tab: 'contribution', contribution: 'list' }, importV2 }));
  const list = detail.tab.data.list;
  const load = (kind, extra = {}) => db.begin('read only', (sql) => screen.load({ sql, tenantId, importV2,
    params: { v2path: `/students/${student.id}`, contributionRead: kind, ...extra } }));
  const recent = await load('recent', { period: '3', month: list.month,
    refreshedAt: list.refreshedAt ?? '', revision: String(list.revision) });
  assert.ok(Array.isArray(recent.result.rows), recent.result.error);
  assert.ok(recent.result.rows.every((row) => row.studentId && row.recent));
  const pending = await load('pending');
  assert.ok(pending.result === null || (Array.isArray(pending.result.details) && pending.result.computedAt));
});
test('학생 기록 연결의 월별·현재 관점을 원본 Docker 읽기 함수로 받는다', async () => {
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  const load = (extra) => db.begin('read only', (sql) => buildStudentDetail({ sql, tenantId, id: student.id,
    sp: { tab: 'contribution', contribution: 'ontology', ...extra }, importV2 }));
  const monthly = await load({ month: '2026-10' });
  assert.equal(monthly.tab.data.ontologyMode, 'monthly');
  assert.equal(monthly.tab.data.ontology.month, '2026-10');
  assert.ok(Object.keys(monthly.tab.data.ontology.views).length > 0);
  const current = await load({ view: 'current' });
  assert.equal(current.tab.data.ontologyMode, 'current');
  assert.equal(current.tab.data.currentScope.state, 'ready');
  assert.equal(current.tab.data.currentScope.request.kind, 'academy');
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
test('학습·소통 연결은 펼칠 때만 Docker 원본 함수를 읽는다', async () => {
  const [student] = await db`select id::text id from public.students where tenant_id=${tenantId}
    and status='enrolled' and not coalesce(is_test,false) order by id limit 1`;
  const load = (kind) => db.begin('read only', (sql) => screen.load({ sql, tenantId, importV2,
    params: { v2path: `/students/${student.id}`, contributionRead: kind } }));
  const learning = await load('learning'), communication = await load('communication');
  assert.equal(learning.result.sections.length, 7);
  assert.equal(communication.result.sections.length, 4);
  assert.ok(learning.result.sections.every((s) => s.items.every((item) => item.evidence.every((e) => e.studentId))));
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
