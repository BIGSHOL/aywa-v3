// 반 보드 동기화 원본 요청 시험. 생존 PC 표식·요청 행은 시험 트랜잭션 안에서만 만들고 되돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MODULE = 'features/report-admin/server/classnote-sync-actions.ts';
const NET = `select case when to_regclass('net.http_request_queue') is null then -1 else (select count(*)::int from net.http_request_queue) end n`;

test('반 보드 동기화 = 2.0 원본 함수·복사본 안내·바깥 호출 없음', async () => {
  const original = await readFile(new URL('../../src/features/report-admin/server/classnote-sync-actions.ts', import.meta.url), 'utf8');
  const host = await readFile(new URL('./v2-host/src/lesson-reports.tsx', import.meta.url), 'utf8');
  const { LR_WRITES, lessonReportsActions } = await import('./v2-lesson-reports-save.mjs');
  assert.match(original, /export async function requestClassnoteBoardSync\(/);
  assert.ok(LR_WRITES[MODULE].includes('requestClassnoteBoardSync'));
  assert.ok('requestClassnoteBoardSync' in lessonReportsActions);
  assert.match(host, /registerHostHandler\(SYNC_MODULE, "requestClassnoteBoardSync"/);
  assert.match(host, /연습 복사본이라 실제 동기화는 실행되지 않습니다/);
  assert.doesNotMatch(original, /\bfetch\(|net\.http_request/);
});

test('원본 요청 = Docker pending·감사로그·바깥 요청 0, 워커 표식과 행 모두 되돌림', async () => {
  const { openFullDatabase, tenantId } = await import('./full-db.mjs');
  const { runV2Server, stopV2Server } = await import('./v2-server-runner.mjs');
  const db = await openFullDatabase();
  try {
    const [actor] = await db`select id::text id from public.users where tenant_id=${tenantId} and system_role::text='master' and status::text='active' limit 1`;
    assert.ok(actor, '시험할 원장이 필요합니다');
    const [activeBefore] = await db`select count(*)::int n from public.classnote_sync_requests where tenant_id=${tenantId} and status in ('pending','running')`;
    assert.equal(activeBefore.n, 0, '기존 동기화가 실행 중이면 시험할 수 없습니다');
    const [workerBefore] = await db`select last_seen::text last_seen from public.classnote_workers where tenant_id=${tenantId} limit 1`;
    assert.ok(workerBefore, '시험할 연동 PC 상태 행이 필요합니다');
    const [{ n: netBefore }] = await db.unsafe(NET);
    const input = { $sql: `with ready as (
      update public.classnote_workers set last_seen=now(),
        last_results=coalesce(last_results,'{}'::jsonb) || '{"postMode":true}'::jsonb ||
          jsonb_build_object('caps',coalesce(last_results->'caps','{}'::jsonb) || '{"syncRequests":true}'::jsonb)
      where tenant_id=$1 returning 1
    ) select jsonb_build_object('source','lesson_reports_queue') as input from ready`, params: [tenantId] };
    const result = await runV2Server({ tenantId, actorId: actor.id, mode: 'write', rollback: true, allowRefs: true,
      steps: [{ module: MODULE, fn: 'requestClassnoteBoardSync', args: [input] }], probes: [
        { text: `select status, scope->>'full' is_full from public.classnote_sync_requests where tenant_id=$1 and status='pending'`, params: [tenantId] },
        { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and actor_id=$2 and action='classnote_board_sync_request' and created_at=now()`, params: [tenantId, actor.id] },
        { text: NET },
      ] });
    assert.equal(result.results[0].value.ok, true, JSON.stringify(result.results[0].value));
    assert.equal(result.results[0].value.status?.active?.status, 'pending');
    assert.deepEqual([...result.probes[0]], [{ status: 'pending', is_full: 'true' }]);
    assert.deepEqual([...result.probes[1]], [{ action: 'classnote_board_sync_request', via: '3.0 연습 복사본' }]);
    assert.equal(result.probes[2][0].n, netBefore);
    const [activeAfter] = await db`select count(*)::int n from public.classnote_sync_requests where tenant_id=${tenantId} and status in ('pending','running')`;
    const [workerAfter] = await db`select last_seen::text last_seen from public.classnote_workers where tenant_id=${tenantId} limit 1`;
    assert.equal(activeAfter.n, 0);
    assert.equal(workerAfter.last_seen, workerBefore.last_seen);
  } finally { await stopV2Server(); await db.end(); }
});
