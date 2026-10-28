// 보강관리 운영 설정: 2.0 configureMakeupSettings의 권한·스키마·실험실 검사와 makeup_command.
import { asAuthenticated } from './v2-timetable-save.mjs';

let rulesP = null;
async function rules(importV2) {
  rulesP ??= Promise.all([
    'features/makeups/config.ts', 'features/makeups/command-parse.ts', 'lib/supabase/db-error.ts',
  ].map(p => importV2(p))).then(([config, command, dbError]) => ({ config, command, dbError }))
    .catch(e => { rulesP = null; throw e; });
  return rulesP;
}

export async function configureOwnerMakeups(io, actor, input) {
  const { sql, t, importV2 } = io, R = await rules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (actor.systemRole !== 'master' || !(actor.level('owner') === 'full' || actor.level('owner') === 'scoped'))
    return { error: '보강관리 운영 설정을 변경할 권한이 없습니다' };
  const parsed = R.config.makeupSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: '보강관리 설정을 확인해 주세요' };
  if (parsed.data.mode !== 'off' && !(await io.makeupsAvailable())) return { error: '보강 운영을 사용할 수 없습니다' };
  if (parsed.data.allowAdditional) return { error: '추가 지도의 출결·수납 기준을 확정한 뒤 사용할 수 있습니다' };
  const commandId = crypto.randomUUID();
  const payload = { mode: parsed.data.mode, allow_additional: false, pilot_subjects: parsed.data.pilotSubjects };
  await sql`select set_config('v2.actor_claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  let data;
  try {
    [{ result: data }] = await asAuthenticated(sql, s => s`select public.makeup_command(
      ${commandId}::uuid, 'configure'::text, ${s.json(payload)}::jsonb, null::integer) result`);
  } catch (error) {
    const shaped = { code: error?.code, message: error?.message, details: error?.detail, hint: error?.hint };
    const info = R.dbError.describeDbError(shaped, { fallback: '보강관리 운영 설정을 저장하지 못했습니다' });
    return { error: info.kind === 'schema' ? '보강관리 DB 설정을 적용한 뒤 다시 저장해 주세요' : info.message };
  } finally { await sql`select set_config('v2.actor_claims', '', true)`; }
  const result = R.command.parseCommandSuccess(data);
  if (!result.ok || data.action !== 'configure') return { error: '설정 저장 결과를 확인하지 못했습니다. 새로고침 후 확인해 주세요.' };
  // DB 함수가 직접 만든 감사로그 한 줄에 연습 복사본 출처를 붙인다.
  await sql`update public.audit_logs set metadata=coalesce(metadata, '{}'::jsonb) || ${sql.json({ via: '3.0 연습 복사본' })}::jsonb
    where tenant_id=${t} and actor_id=${actor.id} and action='makeup_configure' and metadata->>'command_id'=${commandId}`;
  return { ok: true, nonce: Date.now() };
}
