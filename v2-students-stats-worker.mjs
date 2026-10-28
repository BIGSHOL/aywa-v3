// 원본 loadStudentStats는 카드별 Promise를 반환한다. 공용 러너의 결과 전송은
// Promise를 복제할 수 없으므로 같은 2.0 훅/읽기 트랜잭션 안에서 다 기다린다.
import { parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import { openFullDatabase } from './full-db.mjs';

const SRC = new URL('../../src/', import.meta.url);
const STUBS = new URL('./v2-server/stubs/', import.meta.url);
register('./v2-server/hooks.mjs', import.meta.url, { data: { src: SRC.href, stubs: STUBS.href } });
const { runInCall, callStore } = await import('./v2-server/context.mjs');
const { UnsupportedShape } = await import('./v2-server/postgrest.mjs');
globalThis.fetch = async url => { throw new UnsupportedShape(`바깥 요청(fetch ${String(url).slice(0, 60)})`); };
const db = await openFullDatabase();
const { loadStudentStats } = await import(new URL('features/students/stats/server/load.ts', SRC).href);
const { getTenantSettings } = await import(new URL('features/owner/server/queries.ts', SRC).href);

parentPort.on('message', async ({ id, tenantId, actorId, subject, firstParams, trendParams }) => {
  try {
    const result = await db.begin('isolation level repeatable read read only', async sql => {
      await sql`set local statement_timeout = '60s'`;
      const [actor] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role
        from public.users where id::text=${actorId} and tenant_id=${tenantId} and status::text='active'`;
      if (!actor) throw new Error('보는 사람을 확인하지 못했습니다');
      return runInCall({ sql, metaSql: db, actor: {
        id: actor.id, tenantId: actor.tenant_id, email: actor.email ?? '', displayName: actor.display_name,
        jobTitle: actor.job_title, systemRole: actor.system_role,
      }, tenantId }, async () => {
        const [stats, settings] = await Promise.all([loadStudentStats(subject, firstParams, trendParams), getTenantSettings()]);
        const trustFrom = await stats.trustFrom;
        const parts = stats.parts ? Object.fromEntries(await Promise.all(Object.entries(stats.parts).map(async ([key, promise]) => [key, await promise]))) : null;
        if (callStore.getStore().unsupported) throw callStore.getStore().unsupported;
        return { stats: { ...stats, trustFrom, parts }, settings };
      });
    });
    parentPort.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, code: e?.code === 'V2_UNSUPPORTED' ? 'unsupported' : 'failed', message: String(e?.message ?? e).slice(0, 500) });
  }
});
parentPort.postMessage({ ready: true });
