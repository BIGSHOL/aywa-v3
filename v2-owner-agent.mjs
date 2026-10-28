// 2.0 연동 PC 카드의 상태·로그. Docker 복사본만 읽으며 설치 URL·연결 코드는 전달하지 않는다.
import { UUID } from './v2-mcs-core.mjs';

const modules = new Set(['all', 'app', 'classnote', 'makeedu', 'video', 'update']);
const levels = new Set(['all', 'warning', 'error']);
const iso = value => value == null ? null : new Date(value).toISOString();
const dateRange = value => {
  const day = value || new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+09:00`);
  if (!Number.isFinite(start.getTime()) || new Date(start.getTime() + 9 * 3600_000).toISOString().slice(0, 10) !== day) return null;
  return { day, start: start.toISOString(), end: new Date(start.getTime() + 86400_000).toISOString() };
};

export async function loadOwnerAgent(sql, tenantId, sp, settings) {
  const module = sp.agentModule ?? 'all', level = sp.agentLevel ?? 'all';
  const range = dateRange(sp.agentDate);
  if (!modules.has(module) || !levels.has(level) || !range || (sp.agentCursorId && (!UUID.test(sp.agentCursorId) || !Number.isFinite(Date.parse(sp.agentCursorAt ?? '')))))
    return { error: '로그 조회 조건을 확인해 주세요.' };
  const cursorAt = sp.agentCursorId ? sp.agentCursorAt : null, cursorId = sp.agentCursorId ?? null;
  const [devices, events, configuration] = await Promise.all([
    sql`select id::text id, name, version, last_seen_at, status, created_at, lease_until, revoke_requested_at from public.sync_agent_devices
      where tenant_id=${tenantId} and revoked_at is null order by created_at limit 1`,
    sql`select event_id::text event_id, occurred_at, received_at, kind, module, level, detail from public.sync_agent_events
      where tenant_id=${tenantId} and occurred_at>=${range.start}::timestamptz and occurred_at<${range.end}::timestamptz
      and (${module}='all' or module=${module}) and (${level}='all' or level=${level})
      and (${cursorAt}::timestamptz is null or (occurred_at,event_id)<(${cursorAt}::timestamptz,${cursorId}::uuid))
      order by occurred_at desc,event_id desc limit 101`,
    sql`select enabled,classnote_enabled,makeedu_enabled,updates_enabled,revision,cutover_at from public.sync_agent_settings where tenant_id=${tenantId}`,
  ]);
  const row = configuration[0];
  const visible = events.slice(0, 100).map(e => ({ ...e, occurred_at: iso(e.occurred_at), received_at: iso(e.received_at) }));
  return { data: {
    device: devices[0] ? { ...devices[0], last_seen_at: iso(devices[0].last_seen_at), created_at: iso(devices[0].created_at), lease_until: iso(devices[0].lease_until), revoke_requested_at: iso(devices[0].revoke_requested_at) } : null,
    events: visible, logDate: range.day, hasMore: events.length > 100,
    nextCursor: events.length > 100 ? { at: iso(events[99].occurred_at), id: events[99].event_id } : null,
    release: null,
    configuration: { revision: Number(row?.revision ?? 1), enabled: row?.enabled !== false,
      classnoteEnabled: row?.classnote_enabled !== false && !settings.modules.disabled.includes('classnote'),
      makeeduEnabled: row?.makeedu_enabled !== false && !settings.modules.disabled.includes('makeedu'),
      updatesEnabled: row?.updates_enabled !== false, cutoverReady: !!row?.cutover_at },
  } };
}
