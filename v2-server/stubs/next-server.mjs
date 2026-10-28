// next/server 자리 — after(fn)는 응답 뒤가 아니라 **같은 동작(트랜잭션) 안 끝에서** 기다려 돌린다(쓴 것이 바깥 요청을 남기면 러너가 통째로 되돌린다).
import { currentCall } from '../context.mjs';
import { UnsupportedShape } from '../postgrest.mjs';
export function after(task) { currentCall().after.push(task); }
export const connection = async () => {};
export class NextResponse { constructor() { throw new UnsupportedShape('NextResponse'); } }
export class NextRequest { constructor() { throw new UnsupportedShape('NextRequest'); } }
