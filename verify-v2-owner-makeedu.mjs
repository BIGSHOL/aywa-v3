import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-owner.mjs';

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
let passed = 0;
try {
  const base = await load({ tab: 'sheets', sub: 'makeedu' });
  assert.ok(base.page.integrations.available.includes('makeedu'));
  const d = base.page.integrations.makeedu;
  assert.ok(d && typeof d.status.enabled === 'boolean' && d.lock && Array.isArray(d.candidates));
  const [setting] = await db`select sync_enabled from public.user_integrations where tenant_id=${tenantId} and provider='makeedu'`;
  assert.equal(d.status.enabled, setting?.sync_enabled !== false);
  const [{ n }] = await db`select count(*)::int n from public.makeedu_sync_runs where tenant_id=${tenantId}`;
  assert.equal(d.total, n); assert.equal(d.runs.length, Math.min(8, n));
  assert.ok(d.runs.every(r => r.id && r.startedAt && r.status));
  passed++;
  const page2 = (await load({ tab: 'sheets', sub: 'makeedu', page: '2' })).page.integrations.makeedu;
  assert.equal(page2.page, 2); assert.ok(page2.runs.every(r => !d.runs.some(x => x.id === r.id)));
  assert.equal((await load({ tab: 'profile' })).page.integrations, null);
  passed++;
  const ROLL = new Error('rollback');
  try {
    await db.begin(async sql => {
      const a = screen.actions.setMakeeduSyncEnabled;
      const out = await a.run({ sql, body: a.validate({ module: 'features/integrations/server/actions.ts', actor: base.viewer.id, args: [false] }), tenantId, importV2 });
      assert.deepEqual(out, { enabled: false });
      const [saved] = await sql`select sync_enabled from public.user_integrations where tenant_id=${tenantId} and provider='makeedu'`;
      assert.equal(saved.sync_enabled, false);
      const logs = await sql`select action from public.audit_logs where tenant_id=${tenantId} and created_at=now() and action='integration_sync_toggle'`;
      assert.ok(logs.length > 0);
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  passed++;
  const [after] = await db`select sync_enabled from public.user_integrations where tenant_id=${tenantId} and provider='makeedu'`;
  assert.equal(after?.sync_enabled ?? null, setting?.sync_enabled ?? null);
} finally { await db.end(); }
console.log(`v2 owner makeedu: ${passed}/3 checks passed`);
