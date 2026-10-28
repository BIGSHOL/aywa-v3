// 저장 뒤 자료 갱신(data-refresh.mjs, AX-H2) — 실제 복사본으로 도는 격리 서버 시험. 4310은 건드리지 않는다:
// · 다른 포트(기본 4396) · 업무 흐름 저장소 = 빈 임시 폴더(OWNER_CONCEPT_FLOW_DIR — 같은 저장소를 두 서버가 열면 store_locked) ·
//   비서·AI(계층·이탈) 끔 · 외부 전송 없음.
// · 복사본에 쓰지 않는다. 2.0 저장 동작은 감사 기록·이력 행을 남겨 흔적 없이 되돌릴 수 없으므로, 갱신은 POST /api/data-revision(지금 다시
//   읽기)으로 부르고(실제 작업 스레드 · 실제 복사본 · 실제 업무 흐름), 열린 첫 화면이 새 자료로 다시 그려지는 것은 브라우저에서 개정 번호와
//   /snapshot.json 응답만 가로채 확인한다. 저장 고리(커밋된 저장 → 예약)는 verify-data-refresh.mjs가 가짜 복사본으로 본다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const port = Number(process.env.REFRESH_TEST_PORT || 4396);
if (port === 4310) throw new Error('4310은 실제 서버입니다 — 다른 포트로');
const base = `http://127.0.0.1:${port}`, repo = fileURLToPath(new URL('../../', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flowDir = await mkdtemp(join(tmpdir(), 'owner-flow-refresh-'));
const env = { ...process.env, NODE_ENV: 'development', OWNER_CONCEPT_PORT: String(port), OWNER_CONCEPT_FLOW_DIR: flowDir, OWNER_CONCEPT_ASSISTANT: 'off', OWNER_CONCEPT_HIERARCHY_AI: 'off', OWNER_CONCEPT_EXIT_AI: 'off', OWNER_CONCEPT_REFRESH_DEBOUNCE_MS: '300' };
delete env.OWNER_CONCEPT_TYPESAFE_KEY_FILE; delete env.OWNER_CONCEPT_DATA_REFRESH;
const nodeArgs = process.env.REFRESH_TEST_TRACE_GC ? ['--trace-gc'] : []; // 멈춤 진단용
const logs = [], child = spawn(process.execPath, [...nodeArgs, 'experiments/owner-concept/serve.mjs'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
const logAt = [], keep = prefix => d => { for (const l of String(d).split(/\r?\n/).filter(Boolean)) { logs.push(prefix + l); logAt.push(Date.now()); } };
child.stdout.on('data', keep('')); child.stderr.on('data', keep('ERR '));
const waitFor = async (check, label, ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { if (await check()) return; if (child.exitCode !== null) throw new Error(`서버가 끝남: ${logs.slice(-5).join(' | ')}`); } throw new Error(`시간 초과: ${label}`); };
const timed = async (path, init) => { const t = performance.now(); const r = await fetch(base + path, init); const body = Buffer.from(await r.arrayBuffer()); return { status: r.status, headers: r.headers, body, ms: performance.now() - t }; };
const info = async () => JSON.parse((await timed('/api/data-revision')).body);
const errors = [], check = async (name, fn) => { try { await fn(); console.log(`ok  ${name}`); } catch (e) { errors.push(name); console.log(`FAIL ${name}: ${e.stack || e.message}`); } };
let browser;
try {
  const t0 = Date.now();
  await waitFor(() => logs.some(l => l.startsWith(`Owner concept: ${base}`)), '서버 시작', 300_000);
  await waitFor(async () => (await fetch(`${base}/api/flow`)).status !== 503, '업무 흐름 준비', 180_000);
  console.log(`서버 준비 ${Math.round((Date.now() - t0) / 1000)}초 · ${logs.find(l => l.startsWith('Owner concept'))}`);

  let start;
  await check('개정 번호·/snapshot.js 끝의 번호·/snapshot.json ETag가 같은 자료를 가리킨다', async () => {
    start = await info();
    assert.equal(start.revision, 1); assert.match(start.etag, /^"[0-9a-f]{24}"$/); assert.equal(start.refreshing, false); assert.equal(start.stale, false);
    const js = await timed('/snapshot.js');
    assert(js.body.toString('utf8').endsWith(`;window.AcademySnapshotRevision=${JSON.stringify({ revision: 1, etag: start.etag })};`));
    const json = await timed('/snapshot.json');
    assert.equal(json.status, 200); assert.equal(json.headers.get('etag'), start.etag); assert.equal(json.headers.get('x-data-revision'), '1');
    assert(js.body.length < json.body.length * 0.65, `초기 스크립트 ${js.body.length}B / 전체 ${json.body.length}B`);
    assert(js.body.toString('utf8').includes('"detailDeferred":true'));
    assert.equal(JSON.parse(json.body).meta.asOf, start.asOf);
  });

  await check('다시 읽기는 같은 출처 JSON만(다른 사이트·폼 요청은 거절)', async () => {
    assert.equal((await timed('/api/data-revision', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' })).status, 403);
    assert.equal((await timed('/api/data-revision', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 403);
    assert.equal((await timed('/api/data-revision', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
  });

  await check('실제 복사본으로 다시 읽기: 작업 스레드에서 돌고, 그동안 요청은 바로 답한다 · 내용이 같으면 번호 그대로 · 업무 흐름 고리', async () => {
    const before = logs.length;
    const kick = await timed('/api/data-revision', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' });
    assert.equal(kick.status, 202); assert.equal(JSON.parse(kick.body).pending, true);
    const lat = { rev: [], js: [], v2: [] }, slow = []; let sawRunning = false; const tStart = Date.now();
    for (;;) {
      const [r, js, v2] = await Promise.all([timed('/api/data-revision'), timed('/snapshot.js', { method: 'HEAD' }), timed('/api/v2')]);
      lat.rev.push(r.ms); lat.js.push(js.ms); lat.v2.push(v2.ms);
      if (Math.max(r.ms, js.ms, v2.ms) >= 200) slow.push(`${((Date.now() - tStart) / 1000).toFixed(1)}초에 ${Math.round(Math.max(r.ms, js.ms, v2.ms))}ms`);
      assert.equal(r.status, 200); assert.equal(js.status, 200); assert.equal(v2.status, 200);
      const s = JSON.parse(r.body); if (s.refreshing) sawRunning = true;
      if (sawRunning && !s.refreshing && !s.pending) break;
      if (Date.now() - tStart > 240_000) throw new Error('갱신이 끝나지 않음');
      await sleep(150);
    }
    const max = a => Math.round(Math.max(...a)), p50 = a => Math.round([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]);
    console.log(`    갱신 ${Math.round((Date.now() - tStart) / 1000)}초 동안 요청 ${lat.rev.length}회씩 — 개정 번호 최대 ${max(lat.rev)}ms(중앙 ${p50(lat.rev)}) · snapshot.js 최대 ${max(lat.js)}ms · /api/v2 최대 ${max(lat.v2)}ms`);
    const after = await info();
    const at = logs.slice(before).findIndex(l => l.startsWith('자료 갱신')), line = at < 0 ? null : logs[before + at];
    if (slow.length) console.log(`    200ms 넘은 요청: ${slow.join(', ')} · 갱신 로그 ${at < 0 ? '-' : ((logAt[before + at] - tStart) / 1000).toFixed(1)}초`);
    if (process.env.REFRESH_TEST_TRACE_GC) console.log(logs.slice(before).filter(l => /Mark-Compact|Scavenge/.test(l)).filter(l => { const m = /([\d.]+) \/ [\d.]+ ms/.exec(l); return m && Number(m[1]) > 100; }).slice(0, 8).map(l => `    GC ${l.slice(0, 160)}`).join('\n'));
    console.log(`    서버 로그: ${line}`);
    assert(max(lat.rev) < 500 && max(lat.js) < 500 && max(lat.v2) < 500, '갱신 중에도 0.5초 안에 답해야 한다(서버 스레드 안에서 계산하던 때는 4.6초 멈췄다)');
    assert(line, '갱신 로그'); assert.doesNotMatch(line, /실패/);
    assert.match(line, /작업 스레드 \d+ms\(스냅숏 \d+ms · 흐름 원본 \d+ms\) · 전달 \d+ms( · 기록 풀기 \d+ms)? · 업무 흐름 (reloadSource \d+ms \{.*\}|reloadSource 아직 없음 — 건너뜀)$/);
    assert.equal(after.revision, 1, '저장이 없으면 내용이 같아 개정 번호를 올리지 않는다'); assert.equal(after.etag, start.etag); assert(after.checkedAt); assert.equal(after.stale, false);
  });

  await check('열린 첫 화면: 새 개정이면 같은 db 객체를 제자리에서 채워 다시 그린다 · 열린 창은 닫힐 때까지 미룬다 · 미리보기 기록·스크롤 유지 · 첫 화면 자료가 같으면 다시 받지 않는다', async () => {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 } }), pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    const detailUrls = [], bootUrls = [];
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path === '/snapshot.json') detailUrls.push(request.url()); if (path === '/snapshot.js') bootUrls.push(request.url()); });
    const poke = async () => { await sleep(2100); await page.evaluate(() => dispatchEvent(new Event('focus'))); }; // 화면은 2초에 한 번만 묻는다
    await page.goto(base); await page.waitForFunction(() => document.querySelector('#footer')?.textContent.includes(window.AcademySnapshot.meta.tenant));
    await page.waitForSelector('.fl-count');
    const homeFacts = () => page.evaluate(() => [...document.querySelectorAll('.ax-kpi-row .ws-kpi, .fl-count, .ax-change-cell')].map(node => node.textContent.replace(/\s+/g, ' ').trim()));
    const beforeDetail = await homeFacts();
    assert(beforeDetail.length >= 3, '핵심 KPI·원장 결정·업무 수가 첫 화면에 있다');
    await sleep(6000); // 옛 엿보기 사전 로드(1.5초 + idle 최장 4초)가 일어나도 잡는다.
    assert.equal(bootUrls.length, 1, '첫 화면은 /snapshot.js를 한 번만 받는다');
    assert.equal(page.frames().length, 1, '엿보기 iframe은 처리를 누를 때 만든다');
    assert.equal(detailUrls.length, 0, '첫 화면과 빈 엿보기는 상세 자료를 받지 않는다');
    assert.equal(await page.evaluate(() => window.AcademySnapshot.meta.detailDeferred), true, '첫 화면은 요약 자료로 시작');
    assert.equal(await page.evaluate(() => window.AcademySnapshot.students[0].lessons), undefined);
    await page.evaluate(() => { location.hash = '#students'; });
    await page.waitForFunction(() => !window.AcademySnapshot.meta.detailDeferred && Array.isArray(window.AcademySnapshot.students[0].lessons));
    assert.equal(detailUrls.length, 1, `상세 화면 첫 이동에서 한 번만 전체 자료를 읽는다: ${detailUrls.join(', ')}`);
    await page.evaluate(() => { location.hash = '#home'; });
    await page.waitForFunction(() => document.querySelector('#main .ax-fold'));
    assert.deepEqual(await homeFacts(), beforeDetail, '전체 자료를 받은 뒤에도 같은 지점·기준일의 KPI·결정 대기·업무 수가 같다');
    await page.locator('.fl-nav [data-fl="filter"][data-id="moving"]').click();
    await page.locator('#fl-board-list [data-fl="goto"]').first().click();
    await page.waitForFunction(() => { const frame = document.querySelector('.fl-peek[open] iframe'); return frame?.contentWindow?.location.hash && frame.contentWindow.location.hash !== '#peek'; });
    assert.equal(bootUrls.length, 2, '처리 화면을 처음 열 때 엿보기 문서가 자체 자료를 받는다');
    await page.locator('.fl-peek [data-peek="close"]').click();
    await page.waitForFunction(() => !document.querySelector('.fl-peek[open]'));
    const tenant = await page.evaluate(() => window.AcademySnapshot.meta.tenant);
    assert.deepEqual(await page.evaluate(() => window.AcademySnapshotRevision), { revision: 1, etag: start.etag });
    assert.equal(await page.evaluate(() => typeof window.V2Screens?.dataChanged), 'function');
    const real = JSON.parse((await timed('/snapshot.json')).body);
    let served = { revision: 2, etag: '"refresh-test-2"', tenant: '갱신 시험 지점' }, jsonCalls = 0;
    await page.route('**/api/data-revision', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: served.revision, etag: served.etag }) }));
    await page.route('**/snapshot.json', route => { jsonCalls += 1; route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Data-Revision': String(served.revision), ETag: served.etag }, body: JSON.stringify({ ...real, meta: { ...real.meta, tenant: served.tenant } }) }); });
    await page.evaluate(() => {
      window.__ref = window.AcademySnapshot; window.__ws = window.AcademySnapshot.workspaces; window.__revs = [];
      addEventListener('aywa:data-revision', e => window.__revs.push(e.detail.revision));
      window.AcademySnapshot.tasks.unshift({ id: 'local-refresh-test', title: '미리보기 업무', detail: '', status: 'open', kind: 'owner_review', opened: window.AcademySnapshot.meta.asOf, due: '', owners: ['원장'], local: true });
    });
    await page.keyboard.press('Control+k'); await page.waitForSelector('#modal[open]');
    await poke();
    await waitFor(() => jsonCalls === 1, '새 자료 받기', 10_000); await sleep(800);
    assert.equal(await page.evaluate(() => window.AcademySnapshot.meta.tenant), tenant, '창이 열린 동안은 바꾸지 않는다');
    assert(!(await page.textContent('#footer')).includes(served.tenant));
    await page.keyboard.press('Escape');
    await page.waitForFunction(t => document.querySelector('#footer')?.textContent.includes(t), served.tenant, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => ({ same: window.AcademySnapshot === window.__ref, ws: window.AcademySnapshot.workspaces === window.__ws, local: window.AcademySnapshot.tasks.some(t => t.id === 'local-refresh-test'), revs: window.__revs })), { same: true, ws: true, local: true, revs: [2] });
    // 스크롤 유지 — 창 없이 바로 적용되는 경우.
    const y = await page.evaluate(() => { const top = Math.max(0, Math.min(400, document.documentElement.scrollHeight - innerHeight - 10)); scrollTo(0, top); document.activeElement?.blur?.(); return Math.round(scrollY); });
    served = { revision: 3, etag: '"refresh-test-3"', tenant: '갱신 시험 지점 3' };
    await poke();
    await page.waitForFunction(t => document.querySelector('#footer')?.textContent.includes(t), served.tenant, { timeout: 5000 });
    assert(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2, `스크롤 ${y} 유지`);
    // 첫 화면 자료가 같은 개정(기록·2.0 화면만 바뀜) — 다시 받지 않고 알림만.
    served = { revision: 4, etag: '"refresh-test-3"', tenant: '쓰이면 안 됨' };
    await poke();
    await page.waitForFunction(() => window.__revs.includes(4), null, { timeout: 5000 });
    assert.equal(jsonCalls, 2); assert(!(await page.textContent('#footer')).includes('쓰이면 안 됨'));
    assert.deepEqual(pageErrors, []);
  });

  await check('업무 흐름 저장소는 임시 폴더 · 복사본 쓰기 0(2.0 저장 요청을 보내지 않았다)', async () => {
    assert((await readdir(flowDir)).includes('state.json'), '임시 흐름 저장소가 쓰였다');
    assert(!logs.some(l => /2\.0 screen .* failed|2\.0 write/.test(l)), '2.0 저장 경로가 돌지 않았다');
  });
} finally {
  await browser?.close();
  child.kill(); await new Promise(r => (child.exitCode !== null ? r() : child.once('exit', r)));
  await rm(flowDir, { recursive: true, force: true });
  const bad = logs.filter(l => l.startsWith('ERR ') && !/ExperimentalWarning|--trace-warnings/.test(l));
  if (bad.length) console.log(`서버 오류 출력:\n${bad.slice(0, 10).join('\n')}`);
}
console.log(errors.length ? `\n${errors.length} failed` : '\nall passed');
process.exitCode = errors.length ? 1 : 0;
