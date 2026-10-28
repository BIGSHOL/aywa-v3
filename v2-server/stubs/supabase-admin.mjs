// 2.0 lib/supabase/admin.ts 자리 — service role(RLS 우회) = 복사본 접속 그대로. 2.0 코드가 tenant_id를 직접 거는 것도 그대로다.
import { adminClient } from '../postgrest.mjs';
export const createAdminClient = () => adminClient();
export const createRawAdminClient = () => adminClient();
