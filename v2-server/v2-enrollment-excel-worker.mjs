// 신규 콜&상담 엑셀 가져오기: 2.0 공용 importer를 복사본 트랜잭션 안에서 실행한다.
// 전용 작업 스레드에서만 Next/Supabase 훅을 설치하며, 바깥 fetch는 막는다.
import { parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import { openFullDatabase } from '../full-db.mjs';

const SRC = new URL('../../../src/', import.meta.url);
const STUBS = new URL('./stubs/', import.meta.url);
register('./hooks.mjs', import.meta.url, { data: { src: SRC.href, stubs: STUBS.href } });
const { runInCall, callStore } = await import('./context.mjs');
const { UnsupportedShape } = await import('./postgrest.mjs');
globalThis.fetch = async url => { throw new UnsupportedShape(`바깥 요청(fetch ${String(url).slice(0, 60)})`); };

const db = await openFullDatabase();
const ROLL = new Error('excel-rollback');
async function actorOf(sql, tenantId, actorId) {
  const [u] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role
    from public.users where id::text=${actorId} and tenant_id=${tenantId} and status::text='active'`;
  return u ? { id: u.id, tenantId: u.tenant_id, email: u.email ?? '', displayName: u.display_name, jobTitle: u.job_title, systemRole: u.system_role } : null;
}
async function queued(sql) {
  const [{ present }] = await sql`select to_regclass('net.http_request_queue') is not null present`;
  return present ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
}
async function markAuditSource(sql, tenantId, actorId) {
  if (!actorId) return;
  const via = '3.0 연습 복사본';
  await sql`update public.audit_logs set metadata = case
    when metadata ? 'via' then (metadata - 'via') || jsonb_build_object('surface', coalesce(metadata->'surface', metadata->'via'), 'via', ${via}::text)
    else coalesce(metadata, '{}'::jsonb) || jsonb_build_object('via', ${via}::text) end
    where tenant_id=${tenantId} and actor_id=${actorId} and created_at=now() and metadata->>'via' is distinct from ${via}`;
}
async function perform(sql, call) {
  const actor = await actorOf(sql, call.tenantId, call.actorId);
  return runInCall({ sql, metaSql: db, actor, tenantId: call.tenantId }, async () => {
    const { loadImporter } = await import(new URL('features/excel-import/server/registry.ts', SRC).href);
    const { gateImport, runImport } = await import(new URL('features/excel-import/server/run.ts', SRC).href);
    const def = await loadImporter('enrollment-consultations');
    if (!def) throw new Error('신규 콜&상담 가져오기 설정이 없습니다');
    let out;
    if (call.operation === 'template') {
      const gate = await gateImport(def);
      if ('error' in gate) out = { kind: 'json', status: gate.status, body: { error: gate.error } };
      else {
        const { buildTemplate } = await import(new URL('features/excel-import/server/workbook.ts', SRC).href);
        const { kstToday } = await import(new URL('lib/date-kst.ts', SRC).href);
        const sheets = await def.template(gate);
        const wb = buildTemplate(def.title, sheets, def.guide);
        out = { kind: 'file', buf: new Uint8Array(await wb.xlsx.writeBuffer()), name: `${def.title}_서식_${kstToday()}.xlsx` };
      }
    } else {
      const fd = new FormData();
      fd.set('file', new File([call.bytes], call.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      fd.set('mode', call.mode);
      if (call.dryRun) fd.set('dryRun', '1');
      if (call.annotate) fd.set('annotate', '1');
      const result = await runImport(def, fd);
      out = result.kind === 'file' ? { kind: 'file', buf: new Uint8Array(result.buf), name: result.name }
        : { kind: 'json', body: result.body, status: result.status ?? 200 };
    }
    const store = callStore.getStore();
    while (store.after.length) await store.after.shift()();
    if (store.unsupported) throw store.unsupported;
    return out;
  });
}
async function handle(call) {
  if (call.operation === 'template') return db.begin('isolation level repeatable read read only', sql => perform(sql, call));
  let result = null;
  try {
    await db.begin(async sql => {
      await sql`set local statement_timeout = '60s'`;
      const before = await queued(sql);
      result = await perform(sql, call);
      await markAuditSource(sql, call.tenantId, call.actorId);
      if (await queued(sql) > before) throw Object.assign(new Error('outbound'), { code: 'outbound_blocked' });
      if (call.rollback) throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  return result;
}
parentPort.once('message', async (call) => {
  try { parentPort.postMessage({ ok: true, result: await handle(call) }); }
  catch (e) { parentPort.postMessage({ ok: false, code: e?.code ?? 'failed', message: String(e?.message ?? e).slice(0, 500) }); }
  finally { await db.end(); }
});
