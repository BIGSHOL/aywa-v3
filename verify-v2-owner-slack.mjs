import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-owner.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const root = new URL('../../', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');
await check('슬랙 카드 원본 본문과 서버 조회 경계', async () => {
  const source = (await read('src/app/(shell)/owner/_components/slack-card.tsx')).replace(/\r\n/g, '\n');
  const host = (await read('experiments/owner-concept/v2-host/src/owner-slack.tsx')).replace(/\r\n/g, '\n');
  assert.ok(host.includes(source.slice(source.indexOf('  if (state.kind === "off")'), source.lastIndexOf('\n}'))));
  assert.doesNotMatch(host, /getSlackCardState\(/);
  const preview = await read('experiments/owner-concept/v2-host/src/owner-slack-message-preview.tsx');
  assert.match(preview, /window\.location\.origin/);
  assert.doesNotMatch(preview, /https?:\/\//);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({ tab: 'sheets', sub: 'slack' });
  const state = base.page.integrations.slack;
  await check('슬랙 연결·규칙·직원·건수 조회, 토큰 비노출', async () => {
    assert.equal(state.kind, 'ready');
    assert.equal(state.connected, true);
    assert.match(state.maskedToken, /^xoxb-••••.{4}$/);
    assert.equal(state.rules.length, 4);
    assert.ok(state.staff.length > 0 && state.activityOptions.length > 0);
    assert.equal(JSON.stringify(state).includes('bot_token'), false);
    const [raw] = await db.begin('read only', sql => sql`select bot_token from public.slack_connections where tenant_id=${tenantId}`);
    assert.ok(raw.bot_token && !JSON.stringify(base).includes(raw.bot_token));
    assert.equal((await load({ tab: 'sheets', sub: 'video' })).page.integrations.slack, null);
  });
  await check('발송 시간 저장·연결 해제는 권한과 감사로그를 지키고 되돌림', async () => {
    const a = screen.actions;
    const call = (name, actor, args, sql) => a[name].run({ sql, body: a[name].validate({ module: 'features/slack/server/connection-actions.ts', actor, args }), tenantId, importV2 });
    const admin = base.editors.find(e => e.role === '관리자');
    const ROLL = new Error('rollback');
    try {
      await db.begin(async sql => {
        const before = (await sql`select bot_token, dnd_start::text dnd_start from public.slack_connections where tenant_id=${tenantId}`)[0];
        const schedule = { dndEnabled: false, dndStart: '21:30', dndEnd: '07:30', weekendQuiet: true, digestAt: '09:15' };
        assert.deepEqual(await call('saveSlackSchedule', null, [schedule], sql), { error: '로그인이 필요합니다' });
        if (admin) assert.deepEqual(await call('saveSlackSchedule', admin.id, [schedule], sql), { error: '연동 설정을 변경할 권한이 없습니다' });
        assert.deepEqual(await call('saveSlackSchedule', base.viewer.id, [{ ...schedule, dndStart: 'bad' }], sql), { error: '시각은 00:00 ~ 23:59 형식으로 넣어 주세요' });
        assert.deepEqual(await call('saveSlackSchedule', base.viewer.id, [schedule], sql), { message: '발송 시간을 저장했습니다' });
        assert.equal((await sql`select dnd_start::text dnd_start from public.slack_connections where tenant_id=${tenantId}`)[0].dnd_start, '21:30:00');
        assert.deepEqual(await call('disconnectSlack', base.viewer.id, [], sql), { message: '연결을 해제했습니다' });
        assert.equal((await sql`select bot_token from public.slack_connections where tenant_id=${tenantId}`)[0].bot_token, '');
        const logs = await sql`select action from public.audit_logs where tenant_id=${tenantId} and action in ('slack_schedule_update','slack_connection_disconnect') and created_at=now()`;
        assert.deepEqual(logs.map(x => x.action).sort(), ['slack_connection_disconnect', 'slack_schedule_update']);
        assert.ok(before.bot_token);
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal((await db.begin('read only', sql => sql`select dnd_start::text dnd_start from public.slack_connections where tenant_id=${tenantId}`))[0].dnd_start,
      state.schedule.dndStart + ':00');
  });
} finally { await db.end(); }
console.log(`슬랙 연동 ${done.length}/${done.length} 통과: ${done.join(' · ')}`);
