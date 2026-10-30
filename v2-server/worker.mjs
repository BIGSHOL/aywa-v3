// v2-server-runner.mjs의 작업 스레드 — 2.0 서버 함수를 복사본에서 그대로 돌린다. 모듈 훅(hooks.mjs)은 **이 스레드에만** 건다.
// 메시지 하나 = 동작 하나 = 복사본 트랜잭션 하나:
//  · read  = repeatable read · read only · 2.0 cache()는 요청 단위로 한 번만 · 역할은 바뀔 때만 전환(강사 정산 왕복 6,959 → 1,214)
//  · write = 쓰기 트랜잭션 · 앞뒤로 net.http_request_queue를 세어 늘었으면 통째로 되돌린다(409 outbound_blocked와 같은 규칙) · after() 할 일까지 안에서
//  · rollback = 시험용 — 다 돌리고 probes(검사 SQL)를 읽은 뒤 되돌린다
// 바깥 요청(fetch)은 막는다 — 2.0 코드가 부르려 하면 흉내 밖 오류로 멈춘다.
import { parentPort } from 'node:worker_threads';
import { createRequire, register } from 'node:module';
import { openFullDatabase } from '../full-db.mjs';

const SRC = new URL('../../../src/', import.meta.url), STUBS = new URL('./stubs/', import.meta.url);
register('./hooks.mjs', import.meta.url, { data: { src: SRC.href, stubs: STUBS.href } });
const { runInCall, requestCache } = await import('./context.mjs');
// React cache()는 Next 밖에선 그냥 통과한다 — 2.0 코드가 불러오기 전에 요청 단위 기억으로 바꾼다.
createRequire(import.meta.url)('react').cache = requestCache;
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

// 2.0 서버 함수가 logAction 대신 DB 함수 안에서 감사로그를 직접 남길 때도 연습 저장의 출처를 붙인다.
// DB 함수의 저장점은 별도 xmin을 가지므로 현재 요청의 시각·행위자로 고른다.
async function markAuditSource(sql, tenantId, actorId) {
  if (!actorId) return;
  const via = '3.0 연습 복사본';
  await sql`update public.audit_logs set metadata = case
    when metadata ? 'via' then (metadata - 'via') || jsonb_build_object('surface', coalesce(metadata->'surface', metadata->'via'), 'via', ${via}::text)
    else coalesce(metadata, '{}'::jsonb) || jsonb_build_object('via', ${via}::text) end
    where tenant_id=${tenantId} and actor_id=${actorId} and created_at=now() and metadata->>'via' is distinct from ${via}`;
}

async function runSteps(sql, call) {
  const actor = await actorOf(sql, call.tenantId, call.actorId);
  // metaSql = 표 정보(FK · 칸 형식 · 함수 모양) 전용 — 트랜잭션 밖 연결(역할 전환과 섞이지 않게).
  // 읽기 동작 = 한 스냅숏 · 한 사람이라 같은 조회를 다시 할 필요가 없고(memo), 역할을 쿼리마다 되돌리지 않아도 된다(stickyRole).
  const readOnly = call.mode === 'read' ? { memo: new Map(), stickyRole: true } : {};
  return runInCall({ sql, metaSql: db, actor, tenantId: call.tenantId, ...readOnly }, async () => {
    const results = [];
    for (const step of call.steps) {
      const mod = await import(new URL(step.module, SRC).href);
      if (typeof mod[step.fn] !== 'function') throw new UnsupportedShape(`${step.module}에 ${step.fn} 함수가 없습니다`);
      // 시험 전용(allowRefs — 러너를 직접 부르는 시험만 켠다 · 화면 저장 경로는 켜지 않는다): { $sql } 자리 = 같은 트랜잭션에서 읽은 첫 값.
      // 앞 단계가 만든 행(가상 줄 확정으로 생긴 회차 행 id 등)을 다음 단계에 넘기려고. 켜지 않으면 그 모양은 그대로 2.0 함수로 간다(값 취급).
      // { $currentUser: true } = 그 요청의 사용자(2.0 getCurrentUser()와 같은 값 — canViewPayslipNow(user)처럼 사용자를 인자로 받는 함수용). 늘 켜져 있다(보는 사람 그 자체라 새로 여는 것이 없다).
      // 시험 전용 참조는 배열·객체 안(배분 행의 termId · 이월 입력의 termId 등)까지 푼다 — allowRefs가 꺼진 화면 경로는 맨 위 자리만(종전 그대로).
      const ref = async v => {
        if (v && typeof v === 'object' && v.$currentUser === true && Object.keys(v).length === 1)
          return actor ? { id: actor.id, tenantId: actor.tenantId, email: actor.email, displayName: actor.displayName, jobTitle: actor.jobTitle, systemRole: actor.systemRole } : null;
        if (!call.allowRefs || !v || typeof v !== 'object') return v;
        if (typeof v.$sql === 'string') return Object.values((await sql.unsafe(v.$sql, v.params ?? []))[0] ?? {})[0] ?? null;
        if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await ref(x)); return out; }
        if (Object.getPrototypeOf(v) === Object.prototype && !('$formData' in v)) { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await ref(x); return out; }
        return v;
      };
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
    const store = callStore.getStore(), after = store.after;
    while (after.length) await after.shift()();
    // 흉내 밖 모양을 2.0 코드가 제 catch로 삼켰어도(빈 값 · '못 불러옴') 결과를 내지 않는다 — 다른 화면을 조용히 보이지 않게.
    if (store.unsupported) throw store.unsupported;
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
        await markAuditSource(sql, call.tenantId, call.actorId);
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
