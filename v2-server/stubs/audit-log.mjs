// 2.0 features/audit/server/log.ts 자리 — 기록 함수 셋만 갈아 끼우고 나머지(AUDIT_ACTIONS · 라벨 · 조회)는 2.0 그대로 내보낸다.
//  · 같은 표·칸(audit_logs) · 같은 행위자 · metadata.via = '3.0 연습 복사본'
//  · 🔴 2.0의 pokeSlack(응답 뒤 슬랙 발송기 깨우기)은 부르지 않는다 — 바깥 발신 0.
//  · best-effort도 2.0 그대로(실패해도 본 작업을 막지 않는다).
import { currentCall } from '../context.mjs';
export * from '@/features/audit/server/log';

const VIA = '3.0 연습 복사본';
async function insert(row) {
  const { sql } = currentCall();
  try {
    await sql.savepoint(s => s`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${row.tenantId}, ${row.actorId}, ${row.actorName}, ${row.action}, ${row.targetType ?? null}, ${row.targetLabel ?? null}, ${s.json({ ...(row.metadata ?? {}), via: VIA })})`);
  } catch { /* 감사 기록 실패는 본 작업을 막지 않음(2.0 그대로) */ }
}
export async function logAction(args) {
  const a = currentCall().actor;
  if (!a) return;
  await insert({ tenantId: a.tenantId, actorId: a.id, actorName: a.displayName, ...args });
}
export async function logActionAs(actor, args) { await insert({ tenantId: actor.tenantId, actorId: null, actorName: actor.actorName, ...args }); }
export async function logActionAtDoor(door, args) {
  const a = currentCall().actor;
  if (a && a.tenantId === door.tenantId) return logAction(args);
  return logActionAs({ tenantId: door.tenantId, actorName: door.doorName }, args);
}
