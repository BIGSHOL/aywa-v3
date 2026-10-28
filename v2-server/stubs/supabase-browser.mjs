// 2.0 브라우저 Supabase 클라이언트 — 서버 함수 안에서 부르면 흉내 밖이다.
import { UnsupportedShape } from '../postgrest.mjs';
export function createClient() { throw new UnsupportedShape('브라우저 Supabase 클라이언트'); }
