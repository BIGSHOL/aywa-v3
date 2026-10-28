import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-owner.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const root = new URL('../../', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');
await check('숙제영상 드라이브 카드 = 2.0 본문, 계정·폴더 번호 비노출', async () => {
  const source = (await read('src/app/(shell)/owner/_components/video-drive-card.tsx')).replace(/\r\n/g, '\n');
  const host = (await read('experiments/owner-concept/v2-host/src/owner-video.tsx')).replace(/\r\n/g, '\n');
  const body = source.slice(source.indexOf('  return (\n    <section'), source.lastIndexOf('\n}')).replaceAll('setting.connectionId', 'setting.hasConnection');
  assert.ok(host.includes(body));
  assert.doesNotMatch(host, /getVideoDriveSettingsView\(/);
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
try {
  await check('숙제영상 드라이브 = ClassNote 탭에서만 저장된 상태 조회', async () => {
    const d = (await load({ tab: 'sheets', sub: 'video' })).page.integrations;
    assert.ok(d.available.includes('video'));
    assert.equal(d.video?.setting.accountReady, true);
    assert.equal(d.video?.setting.source, 'none');
    assert.equal(d.video?.oauthReady, false);
    assert.equal((await load({ tab: 'sheets', sub: 'slack' })).page.integrations.video, null);
    const payload = JSON.stringify(d.video);
    assert.doesNotMatch(payload, /rootId|root_folder_id|connectionId|connection_id|accessToken|refreshToken|oauth_client_id/);
  });
  await check('Google 로그인·폴더 확인 단추는 복사본에서 즉시 거절', async () => {
    const entry = await read('experiments/owner-concept/v2-host/src/owner.tsx');
    assert.match(entry, /registerHostHandler\('features\/video-submit\/server\/drive-settings-actions\.ts', 'saveVideoDriveSetting'/);
    const host = await read('experiments/owner-concept/v2-host/src/owner-video.tsx');
    assert.match(host, /ready: setting\.accountReady && view\.oauthReady/);
  });
} finally { await db.end(); }
console.log(`숙제영상 드라이브 ${done.length}/${done.length} 통과: ${done.join(' · ')}`);
