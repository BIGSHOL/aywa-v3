// 공용 도구 — 2.0 서버 함수를 그대로 실행한다(V2-SCREENS.md '공용 도구: v2-server-runner' · 메인 결정 10-28 안 A · 주인 = 팀장 세션).
// 언제: 조립·산식이 커서 SQL로 손 이식하면 2.0과 어긋날 위험이 큰 화면(수납 회차 확정 · 강사 정산 …). 순수 함수만 필요하면 importV2로 충분하다.
// 어떻게: 전용 작업 스레드(v2-server/worker.mjs) 하나에서만 모듈 훅을 걸어 2.0 src/의 서버 모듈을 불러 쓴다 — 4310 메인 스레드는 메시지로 부르기만 한다.
//  · Supabase = 흉내(v2-server/postgrest.mjs — PostgREST 모양 · 1000행 절단 · FK 힌트 · 오류 모양 · 모르는 모양은 던짐)
//  · 신분 = 보는 사람(actorId) + authenticated(세션 클라이언트) · 관리자 클라이언트 = 복사본 접속 · getCurrentUser = 보는 사람
//  · 감사로그 = 2.0 표 그대로 + metadata.via '3.0 연습 복사본' · 슬랙 깨우기 · fetch = 없음
//  · 동작 하나 = 복사본 트랜잭션 하나(읽기 = read only · 쓰기 = 바깥 요청 큐가 늘면 되돌림 · rollback = 시험용)
// 사용: await runV2Server({ steps: [{ module: 'features/…/queries.ts', fn: 'getX', args: [...] }], actorId, tenantId, mode: 'read' })
//       → { results: [{ value } | { redirect } | { notFound }], probes? } · 실패하면 V2ServerError(code = unsupported | outbound_blocked | failed | worker)
import { Worker } from 'node:worker_threads';

export class V2ServerError extends Error { constructor(code, message) { super(message); this.code = code; } }
let worker = null, ready = null, seq = 0;
const pending = new Map();

function start() {
  worker = new Worker(new URL('./v2-server/worker.mjs', import.meta.url));
  ready = new Promise((resolve, reject) => {
    worker.once('error', reject);
    const onReady = m => { if (m?.ready) { worker.off('message', onReady); resolve(); } };
    worker.on('message', onReady);
  });
  worker.on('message', m => {
    if (m?.ready) return;
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    if (!pending.size) worker?.unref();
    if (m.ok) p.resolve({ results: m.results, probes: m.probes }); else p.reject(new V2ServerError(m.code, m.message));
  });
  const fail = e => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new V2ServerError('worker', e?.message || '2.0 서버 실행 스레드가 멈췄습니다')); }
    pending.clear(); worker = null; ready = null;
  };
  worker.on('error', fail);
  worker.on('exit', code => fail(new Error(`작업 스레드가 끝났습니다(${code})`)));
}

/** 2.0 서버 함수 실행. call = { steps, actorId, tenantId, mode: 'read' | 'write', rollback?, probes?: [{ text, params }] }. */
export async function runV2Server(call, { timeoutMs = 90_000 } = {}) {
  if (!Array.isArray(call?.steps) || !call.steps.length || !call.tenantId || !['read', 'write'].includes(call.mode)) throw new V2ServerError('failed', '잘못된 실행 요청');
  for (const s of call.steps) if (!/^(features|lib)\/[a-z0-9/_.-]+\.ts$/.test(s.module) || s.module.includes('..') || !/^[A-Za-z_$][\w$]*$/.test(s.fn)) throw new V2ServerError('failed', `잘못된 2.0 모듈 ${s.module}#${s.fn}`);
  if (!worker) start();
  await ready;
  worker.ref();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new V2ServerError('failed', '2.0 서버 함수가 제때 끝나지 않았습니다')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, call });
  });
}
/** 한 단계짜리 읽기 — 값만. */
export async function readV2(module, fn, args, { actorId, tenantId }) {
  const { results: [r] } = await runV2Server({ steps: [{ module, fn, args }], actorId, tenantId, mode: 'read' });
  return r;
}
export async function stopV2Server() { const w = worker; worker = null; ready = null; if (w) await w.terminate(); }
