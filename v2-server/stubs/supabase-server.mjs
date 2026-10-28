// 2.0 lib/supabase/server.ts createClient() 자리 — 보는 사람 신분 + authenticated 역할의 흉내 클라이언트(RLS가 2.0처럼 본다).
import { sessionClient } from '../postgrest.mjs';
export const createClient = async () => sessionClient();
