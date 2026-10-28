// next/cache 자리 — 캐시 없이 매번 읽는다(복사본 연습 · 동작 하나 = 트랜잭션 하나라 같은 값을 다시 읽는다). 무효화는 할 일이 없다.
export const unstable_cache = fn => (...args) => fn(...args);
export const unstable_noStore = () => {};
export const revalidatePath = () => {};
export const revalidateTag = () => {};
export const updateTag = () => {};
export const refresh = () => {};
export const cacheLife = () => {};
export const cacheTag = () => {};
