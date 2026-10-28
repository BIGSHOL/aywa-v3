// next/cache 대체 — 브라우저 묶음에 서버 캐시는 없다(빌드 보고서가 이 모듈을 부른 파일을 적는다).
export const revalidatePath = () => {};
export const revalidateTag = () => {};
export const updateTag = () => {};
export const unstable_cache = <T extends (...a: never[]) => unknown>(fn: T) => fn;
export const unstable_noStore = () => {};
