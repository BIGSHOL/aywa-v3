import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-owner.mjs';

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
let passed = 0;
try {
  const base = await load({ tab: 'sheets', sub: 'agent' });
  assert.equal(base.route, 'page'); assert.ok(base.page.integrations.available.includes('agent'));
  passed++;
  const d = await load({ tab: 'sheets', sub: 'agent', read: 'agent_dashboard', viewer: base.viewer.id });
  const agent = d.page.integrations.agent;
  assert.ok(agent?.data && !agent.error);
  const [device] = await db`select id::text id, name from public.sync_agent_devices where tenant_id=${tenantId} and revoked_at is null order by created_at limit 1`;
  assert.equal(agent.data.device?.id ?? null, device?.id ?? null);
  assert.equal(agent.data.device?.name ?? null, device?.name ?? null);
  assert.equal(agent.data.release, null, '운영 설치 URL은 브라우저로 내보내지 않는다');
  assert.doesNotMatch(JSON.stringify(agent), /token_hash|code_hash|installer_url/);
  passed++;
  const [worker] = await db`select hostname, last_seen from public.makeedu_sync_workers where tenant_id=${tenantId} order by last_seen desc limit 1`;
  assert.equal(base.page.integrations.agentWorkers[0]?.hostname ?? null, worker?.hostname ?? null);
  assert.equal(base.page.integrations.agentWorkers[0]?.online ?? null,
    worker ? base.page.integrations.agentNowMs - new Date(worker.last_seen).getTime() < 150_000 : null);
  passed++;
  const badViewer = await load({ tab: 'sheets', sub: 'agent', read: 'agent_dashboard', viewer: '00000000-0000-4000-8000-000000000001' });
  assert.equal(badViewer.route, 'denied');
  const badDate = await load({ tab: 'sheets', sub: 'agent', read: 'agent_dashboard', viewer: base.viewer.id, agentDate: '2026-99-99' });
  assert.equal(badDate.page.integrations.agent.error, '로그 조회 조건을 확인해 주세요.');
  passed++;
  const teacher = base.editors.find(e => e.role === '강사');
  if (teacher) {
    const limited = await load({ tab: 'sheets', sub: 'agent', read: 'agent_dashboard', viewer: teacher.id });
    assert.equal(limited.page?.integrations?.agent ?? null, null);
  }
  passed++;
  const source = (await readFile(new URL('../../src/app/(shell)/owner/_components/integrations-face.tsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const host = (await readFile(new URL('./v2-host/src/owner-integrations.tsx', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const swaps = JSON.parse(await readFile(new URL('./v2-host/src/owner-integrations.swaps.json', import.meta.url), 'utf8'));
  let body = source.slice(source.indexOf('  if (available.length === 0) {'), source.indexOf('\n}\n', source.indexOf('  return (\n    <div className="space-y-4">')) + 1);
  for (const [from, to] of swaps['integrations-face.tsx']) body = body.replace(from, to);
  assert.ok(host.includes(body), '연동 PC를 포함한 원본 연동 면과 호스트 본문 동등');
  passed++;
} finally { await db.end(); }
console.log(`v2 owner agent: ${passed}/6 checks passed`);
