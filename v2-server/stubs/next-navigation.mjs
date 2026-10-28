// next/navigation 자리(서버) — redirect · notFound는 2.0처럼 던진다(러너가 { redirect } · { notFound }로 돌려준다).
export class V2Redirect extends Error { constructor(to) { super(`redirect ${to}`); this.v2Redirect = to; } }
export class V2NotFound extends Error { constructor() { super('notFound'); this.v2NotFound = true; } }
export function redirect(to) { throw new V2Redirect(to); }
export const permanentRedirect = redirect;
export function notFound() { throw new V2NotFound(); }
export function unstable_rethrow(e) { if (e?.v2Redirect || e?.v2NotFound) throw e; }
export const RedirectType = { push: 'push', replace: 'replace' };
