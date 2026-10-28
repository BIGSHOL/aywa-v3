// 작업 스레드의 '지금 부르는 동작' — 트랜잭션(sql) · 보는 사람(actor) · 지점 · 응답 뒤 할 일(after) · 쿼리 줄(queue).
// 2.0 서버 함수는 요청마다 쿠키·세션에서 이 값을 읽는다 — 여기선 AsyncLocalStorage로 동작 하나에 묶는다.
import { AsyncLocalStorage } from 'node:async_hooks';

export const callStore = new AsyncLocalStorage();
export function currentCall() {
  const c = callStore.getStore();
  if (!c) throw new Error('2.0 서버 함수 밖에서 흉내 클라이언트를 불렀습니다');
  return c;
}
export const runInCall = (ctx, fn) => callStore.run({ queue: Promise.resolve(), after: [], ...ctx }, fn);
