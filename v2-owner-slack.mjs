// 학원 설정 연동/슬랙: 2.0 getSlackCardState의 게이트·조회와 외부 호출 없는 저장.
import { readFile } from 'node:fs/promises';
import { V2Error } from './v2-screens.mjs';
import { audit } from './v2-timetable-save.mjs';
import { UUID } from './v2-mcs-core.mjs';

const MODULE = 'features/slack/server/connection-actions.ts';
const missing = '슬랙 연동 표가 아직 DB에 없습니다(0297a·0298a 적용 필요)';
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;
let labelsPromise;
const labels = () => labelsPromise ??= readFile(new URL('./v2-host/src/owner-audit-actions.json', import.meta.url), 'utf8').then(JSON.parse);

/** 2.0 getSlackCardState. 토큰 원문과 외부 계정 식별자는 서버에서만 읽고 브라우저에는 가린 값만 낸다. */
export async function loadOwnerSlack(sql, t, actor, importV2) {
  if (!actor || actor.level('integration_settings') === 'none') return { kind: 'readonly' };
  try {
    const [[conn], rows, staff, healthRows, catalog, ruleFns, format] = await Promise.all([
      sql`select bot_token, team_name, status, dnd_enabled, dnd_start::text dnd_start, dnd_end::text dnd_end,
        weekend_quiet, digest_at::text digest_at, ${ISO(sql, 'last_dispatch_at')} last_dispatch_at, last_error_code
        from public.slack_connections where tenant_id=${t} limit 1`,
      sql`select id::text id, name, enabled, source, type_keys, targets, template, mention_recipients, ping,
        actor_ids, exclude_actor_ids, timing, digest_at::text digest_at, honor_dnd, version
        from public.slack_rules where tenant_id=${t} order by sort_order, created_at`,
      sql`select id::text id, display_name name from public.users where tenant_id=${t} and status::text='active'
        and system_role::text <> 'student' order by display_name limit 500`,
      sql`select count(*) filter (where status='pending')::int pending,
        count(*) filter (where status='dead' and created_at >= now() - interval '48 hours')::int dead,
        count(*) filter (where status='dead' and created_at >= now() - interval '48 hours'
          and last_error_code in ('channel_not_found', 'not_in_channel', 'is_archived'))::int channel_fail,
        count(*) filter (where status='dead' and created_at >= now() - interval '48 hours'
          and last_error_code='not_linked')::int not_linked
        from public.slack_outbox where tenant_id=${t}`,
      importV2('features/slack/activity-catalog.ts'),
      importV2('features/slack/rules.ts'),
      importV2('features/slack/format.ts'),
    ]);
    const activityLabels = await labels();
    const keys = new Set(Object.keys(activityLabels));
    const rules = rows.map(d => ruleFns.sanitizeRule({
      id: d.id, name: d.name, enabled: d.enabled, source: d.source, typeKeys: d.type_keys, targets: d.targets,
      template: d.template, mentionRecipients: d.mention_recipients, ping: d.ping, actorIds: d.actor_ids,
      excludeActorIds: d.exclude_actor_ids, timing: d.timing, digestAt: d.digest_at, honorDnd: d.honor_dnd, version: d.version,
    }, keys)).filter(Boolean);
    const health = healthRows[0];
    return {
      kind: 'ready', connected: !!conn?.bot_token, maskedToken: format.maskSlackToken(conn?.bot_token ?? ''),
      teamName: conn?.team_name ?? '', broken: conn?.status === 'broken', lastDispatchAt: conn?.last_dispatch_at ?? null,
      lastErrorCode: conn?.last_error_code ?? null,
      schedule: { dndEnabled: conn?.dnd_enabled !== false, dndStart: ruleFns.normalizeTime(conn?.dnd_start) ?? '22:00',
        dndEnd: ruleFns.normalizeTime(conn?.dnd_end) ?? '08:00', weekendQuiet: conn?.weekend_quiet === true,
        digestAt: ruleFns.normalizeTime(conn?.digest_at) ?? '08:00' },
      rules, staff, activityOptions: catalog.buildActivityOptions(activityLabels),
      health: { pending: health.pending, channelFail: health.channel_fail, notLinked: health.not_linked,
        otherFail: Math.max(0, health.dead - health.channel_fail - health.not_linked) },
    };
  } catch (e) {
    return { kind: e?.code === '42P01' || e?.code === '42703' ? 'missing_table' : 'error' };
  }
}

async function slackGate(io, actor) {
  if (!actor) return { error: '로그인이 필요합니다' };
  const [lic] = await io.sql`select is_active, expires_at from public.tenant_licenses where tenant_id=${io.t} and feature='slack'`;
  if (!lic || lic.is_active !== true || (lic.expires_at && new Date(lic.expires_at) < new Date()))
    return { error: '이 지점은 슬랙 알림 연결이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요' };
  if (!['full', 'scoped'].includes(actor.level('integration_settings'))) return { error: '연동 설정을 변경할 권한이 없습니다' };
  return null;
}

async function saveSlackSchedule(io, actor, [input]) {
  const denied = await slackGate(io, actor); if (denied) return denied;
  if (!plain(input)) throw bad();
  const { normalizeTime } = await io.importV2('features/slack/rules.ts');
  const start = normalizeTime(input.dndStart), end = normalizeTime(input.dndEnd), digest = normalizeTime(input.digestAt);
  if (!start || !end || !digest) return { error: '시각은 00:00 ~ 23:59 형식으로 넣어 주세요' };
  let current;
  try { [current] = await io.sql`select bot_token from public.slack_connections where tenant_id=${io.t}`; }
  catch (e) { if (e.code === '42P01') return { error: missing }; throw e; }
  if (!current) return { error: '먼저 봇 토큰을 등록해 주세요' };
  if (!current.bot_token) return { error: '먼저 봇 토큰을 등록해 주세요' };
  await io.sql`update public.slack_connections set dnd_enabled=${input.dndEnabled === true}, dnd_start=${start}, dnd_end=${end},
    weekend_quiet=${input.weekendQuiet === true}, digest_at=${digest}, updated_by=${actor.id}, updated_at=now() where tenant_id=${io.t}`;
  await audit(io.sql, io.t, actor, 'slack_schedule_update', 'integration',
    { dndEnabled: input.dndEnabled === true, dndStart: start, dndEnd: end, weekendQuiet: input.weekendQuiet === true, digestAt: digest }, '슬랙 알림 연결');
  return { message: '발송 시간을 저장했습니다' };
}

async function disconnectSlack(io, actor) {
  const denied = await slackGate(io, actor); if (denied) return denied;
  await io.sql`update public.slack_connections set bot_token='', team_name='', updated_by=${actor.id}, updated_at=now() where tenant_id=${io.t}`;
  await audit(io.sql, io.t, actor, 'slack_connection_disconnect', 'integration', {}, '슬랙 알림 연결');
  return { message: '연결을 해제했습니다' };
}

export function slackActions(makeIo) {
  const wrap = (run, arity) => ({
    validate: raw => {
      if (!plain(raw) || raw.module !== MODULE || !Array.isArray(raw.args) || raw.args.length !== arity ||
        (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      return { actor: raw.actor ?? null, args: raw.args };
    },
    run: async ({ sql, body, tenantId, importV2 }) => {
      const io = await makeIo(sql, tenantId, importV2);
      io.importV2 = importV2;
      return run(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args);
    },
  });
  return { saveSlackSchedule: wrap(saveSlackSchedule, 1), disconnectSlack: wrap(disconnectSlack, 0) };
}
