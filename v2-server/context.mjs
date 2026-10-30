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

const DONE = Symbol('done');
/** 2.0의 React cache() 자리 — 읽기 동작(memo가 있는 동작) 안에서는 같은 인자로 한 번만 부른다. 인자는 React처럼 값 그대로(===) 비교한다.
 *  쓰기 동작은 저장 뒤 다시 읽어야 하니 매번 부른다(2.0 서버 액션에서도 cache()는 기억하지 않는다). */
export const requestCache = fn => (...args) => {
  const memo = callStore.getStore()?.memo; if (!memo) return fn(...args);
  let node = memo.get(fn); if (!node) memo.set(fn, node = new Map());
  for (const a of args) { let next = node.get(a); if (!next) node.set(a, next = new Map()); node = next; }
  if (!node.has(DONE)) node.set(DONE, fn(...args));
  return node.get(DONE);
};
