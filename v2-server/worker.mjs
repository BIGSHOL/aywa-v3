// v2-server-runner.mjs의 작업 스레드 — 2.0 서버 함수를 복사본에서 그대로 돌린다. 모듈 훅(hooks.mjs)은 **이 스레드에만** 건다.
// 메시지 하나 = 동작 하나 = 복사본 트랜잭션 하나:
//  · read  = repeatable read · read only
//  · write = 쓰기 트랜잭션 · 앞뒤로 net.http_request_queue를 세어 늘었으면 통째로 되돌린다(409 outbound_blocked와 같은 규칙) · after() 할 일까지 안에서
//  · rollback = 시험용 — 다 돌리고 probes(검사 SQL)를 읽은 뒤 되돌린다
// 바깥 요청(fetch)은 막는다 — 2.0 코드가 부르려 하면 흉내 밖 오류로 멈춘다.
import { parentPort } from 'node:worker_threads';
import { register } from 'node:module';
import { openFullDatabase } from '../full-db.mjs';

const SRC = new URL('../../../src/', import.meta.url), STUBS = new URL('./stubs/', import.meta.url);
register('./hooks.mjs', import.meta.url, { data: { src: SRC.href, stubs: STUBS.href } });
const { runInCall } = await import('./context.mjs');
const { UnsupportedShape } = await import('./postgrest.mjs');
globalThis.fetch = async url => { throw new UnsupportedShape(`바깥 요청(fetch ${String(url).slice(0, 60)})`); };

const db = await openFullDatabase();
const ROLL = new Error('v2-rollback');
let writeChain = Promise.resolve();
const serialWrite = fn => { const p = writeChain.then(fn, fn); writeChain = p.catch(() => {}); return p; };

async function actorOf(sql, tenantId, actorId) {
  if (!actorId) return null;
  const [u] = await sql`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role from public.users
    where id::text=${actorId} and tenant_id=${tenantId} and status::text='active'`;
  return u ? { id: u.id, tenantId: u.tenant_id, email: u.email ?? '', displayName: u.display_name, jobTitle: u.job_title, systemRole: u.system_role } : null;
}
const queued = async sql => {
  const [{ present }] = await sql`select to_regclass('net.http_request_queue') is not null as present`;
  return present ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
};

async function runSteps(sql, call) {
  const actor = await actorOf(sql, call.tenantId, call.actorId);
  // metaSql = 표 정보(FK · 칸 형식 · 함수 모양) 전용 — 트랜잭션 밖 연결(역할 전환과 섞이지 않게).
  return runInCall({ sql, metaSql: db, actor, tenantId: call.tenantId }, async () => {
    const results = [];
    for (const step of call.steps) {
      const mod = await import(new URL(step.module, SRC).href);
      if (typeof mod[step.fn] !== 'function') throw new UnsupportedShape(`${step.module}에 ${step.fn} 함수가 없습니다`);
      // 시험 전용(allowRefs — 러너를 직접 부르는 시험만 켠다 · 화면 저장 경로는 켜지 않는다): { $sql } 자리 = 같은 트랜잭션에서 읽은 첫 값.
      // 앞 단계가 만든 행(가상 줄 확정으로 생긴 회차 행 id 등)을 다음 단계에 넘기려고. 켜지 않으면 그 모양은 그대로 2.0 함수로 간다(값 취급).
      const ref = async v => (call.allowRefs && v && typeof v === 'object' && typeof v.$sql === 'string' ? Object.values((await sql.unsafe(v.$sql, v.params ?? []))[0] ?? {})[0] ?? null : v);
      // 호스트 shim이 FormData를 { $formData: [[이름, 글자]…] }로 실어 보낸다 — 2.0 함수가 받던 FormData로 되돌린다.
      const args = [];
      for (const a of step.args ?? []) {
        if (!a || typeof a !== 'object' || !Array.isArray(a.$formData)) { args.push(await ref(a)); continue; }
        const fd = new FormData(); for (const [k, v] of a.$formData) fd.append(String(k), String(await ref(v))); args.push(fd);
      }
      try { results.push({ value: await mod[step.fn](...args) }); }
      catch (e) {
        if (e?.v2Redirect) results.push({ redirect: e.v2Redirect });
        else if (e?.v2NotFound) results.push({ notFound: true });
        else throw e;
      }
    }
    // after() 할 일 — 2.0은 응답 뒤에 돌지만 여기선 같은 트랜잭션 끝에서 기다린다(남긴 바깥 요청을 잡으려고).
    const { callStore } = await import('./context.mjs');
    const after = callStore.getStore().after;
    while (after.length) await after.shift()();
    return results;
  });
}

async function handle(call) {
  if (call.mode === 'read') {
    return db.begin('isolation level repeatable read read only', async sql => {
      await sql`set local statement_timeout = '60s'`;
      return { results: await runSteps(sql, call) };
    });
  }
  return serialWrite(async () => {
    let out = null;
    try {
      await db.begin(async sql => {
        await sql`set local statement_timeout = '60s'`;
        const before = await queued(sql);
        const results = await runSteps(sql, call);
        if (await queued(sql) > before) throw Object.assign(new Error('outbound'), { code: 'outbound_blocked' });
        const probes = [];
        for (const p of call.probes ?? []) probes.push(await sql.unsafe(p.text, p.params ?? []));
        out = { results, probes };
        if (call.rollback) throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    return out;
  });
}

parentPort.on('message', async ({ id, call }) => {
  try { parentPort.postMessage({ id, ok: true, ...(await handle(call)) }); }
  catch (e) {
    parentPort.postMessage({ id, ok: false, code: e?.code === 'V2_UNSUPPORTED' ? 'unsupported' : e?.code === 'outbound_blocked' ? 'outbound_blocked' : 'failed',
      message: String(e?.message ?? e).slice(0, 500), pgCode: e?.code ?? null });
  }
});
parentPort.postMessage({ ready: true });
