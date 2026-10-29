// 학부모 공감 원본 함수 연결 시험. 연동 PC 생존 표식은 시험 트랜잭션 안에서만 준비하고 전부 되돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MODULE = 'features/classnote-reply/server/reaction-actions.ts';
const NAMES = ['requestParentReaction', 'requestParentReactionRemove'];
const NET = `select case when to_regclass('net.http_request_queue') is null then -1 else (select count(*)::int from net.http_request_queue) end n`;

test('공감 요청·풀기 = 2.0 함수 그대로·거절 목록 밖·복사본 안내', async () => {
  const original = await readFile(new URL('../../src/features/classnote-reply/server/reaction-actions.ts', import.meta.url), 'utf8');
  const host = await readFile(new URL('./v2-host/src/lesson-reports.tsx', import.meta.url), 'utf8');
  const refused = host.slice(host.indexOf('const REFUSE'), host.indexOf('for (const [module, names] of Object.entries(REFUSE))'));
  const { LR_WRITES, lessonReportsActions } = await import('./v2-lesson-reports-save.mjs');
  assert.deepEqual(LR_WRITES[MODULE], NAMES);
  for (const name of NAMES) {
    assert.match(original, new RegExp(`export async function ${name}\\(`));
    assert.ok(name in lessonReportsActions);
    assert.ok(!refused.includes(`"${name}"`));
  }
  assert.match(host, /연습 복사본이라 실제로 보내지지 않습니다/);
});

test('공감 요청→대기 취소 = 원본 감사로그·바깥 요청 0, 워커 표식과 상태 모두 되돌림', async () => {
  const { openFullDatabase, tenantId } = await import('./full-db.mjs');
  const { runV2Server, stopV2Server } = await import('./v2-server-runner.mjs');
  const db = await openFullDatabase();
  try {
    const [actor] = await db`select id::text id from public.users where tenant_id=${tenantId} and system_role::text='master' and status::text='active' limit 1`;
    const [message] = await db`select id::text id from public.classnote_parent_messages where tenant_id=${tenantId}
      and class_name in ('[수학] 테스트반','(수학)학원이') and child_id=5268389 limit 1`;
    assert.ok(actor && message, '원장과 학원이 시험 글이 필요합니다');
    const [{ n: netBefore }] = await db.unsafe(NET);
    const [workerBefore] = await db`select last_seen::text last_seen from public.classnote_workers where tenant_id=${tenantId} limit 1`;
    const [reactionBefore] = await db`select status, reaction_type, unconfirmed, requested_at::text requested_at from public.classnote_parent_reactions where tenant_id=${tenantId} and message_id=${message.id}`;
    assert.ok(workerBefore && reactionBefore?.status === 'removed' && reactionBefore.unconfirmed === false,
      '시험 공감은 풀린 상태여야 한다');
    const input = { $sql: `with ready as (
      update public.classnote_workers set last_seen=now(),
        last_results=coalesce(last_results,'{}'::jsonb) || '{"postMode":true}'::jsonb ||
          jsonb_build_object('caps',coalesce(last_results->'caps','{}'::jsonb) || '{"parentReaction":true}'::jsonb)
      where tenant_id=$1 returning 1
    ) select jsonb_build_object('messageId',$2::text,'type','check') as input from ready`, params: [tenantId, message.id] };
    const result = await runV2Server({ tenantId, actorId: actor.id, mode: 'write', rollback: true, allowRefs: true,
      steps: [
        { module: MODULE, fn: NAMES[0], args: [input] },
        { module: MODULE, fn: NAMES[1], args: [{ messageId: message.id }] },
      ], probes: [
        { text: `select status, reaction_type from public.classnote_parent_reactions where tenant_id=$1 and message_id=$2`, params: [tenantId, message.id] },
        { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and actor_id=$2 and action in ('classnote_parent_reaction_request','classnote_parent_reaction_remove_request') and created_at=now()`, params: [tenantId, actor.id] },
        { text: NET },
      ] });
    assert.equal(result.results[0].value.ok, true, JSON.stringify(result.results[0].value));
    assert.equal(result.results[1].value.ok, true, JSON.stringify(result.results[1].value));
    assert.deepEqual([...result.probes[0]], [{ status: 'removed', reaction_type: 'check' }]);
    assert.deepEqual(result.probes[1].map((r) => r.action).sort(),
      ['classnote_parent_reaction_remove_request', 'classnote_parent_reaction_request']);
    assert.ok(result.probes[1].every((r) => r.via === '3.0 연습 복사본'));
    assert.equal(result.probes[2][0].n, netBefore);
    const [reactionAfter] = await db`select status, reaction_type, unconfirmed, requested_at::text requested_at from public.classnote_parent_reactions where tenant_id=${tenantId} and message_id=${message.id}`;
    const [workerAfter] = await db`select last_seen::text last_seen from public.classnote_workers where tenant_id=${tenantId} limit 1`;
    assert.deepEqual(reactionAfter, reactionBefore);
    assert.equal(workerAfter.last_seen, workerBefore.last_seen);
  } finally { await stopV2Server(); await db.end(); }
});
