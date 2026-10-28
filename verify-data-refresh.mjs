// 저장 뒤 자료 갱신(data-refresh.mjs, AX-H2) — DB 없이(가짜 작업 스레드·가짜 복사본). 실제 복사본으로 도는 시험은 verify-data-refresh-live.mjs.
// 모아서 한 번 · 한 번에 하나(도는 중 저장 → 한 번 더) · 실패하면 옛 자료(몇 번만 다시) · 복사본이 바뀌면 멈춤 · 한 틱에 바꿔 끼우기
// (첫 화면 자료 → 기록 저장소 → 비서 → 업무 흐름 reloadSource) · 2.0 저장 고리는 커밋된 저장만 · 기록 조회·비서가 갈아 끼운 것을 쓴다.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createDataHolder, createDataRefresh, createRefreshScheduler, decodeRecords, encodeData, encodeRecords, RefreshError } from './data-refresh.mjs';
import { currentWorkspaceStore, useWorkspaceStore } from './workspace-store.mjs';
import { handleWorkspaceRecords } from './domain-http.mjs';
import { createV2ScreenRoute } from './v2-screens.mjs';
import { buildAssistantContext } from './claude-bridge-context.mjs';
import { call, db as fixture, startRoute } from './verify-claude-helpers.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms)), quiet = () => {};
const errors = [], check = async (name, fn) => { try { await fn(); console.log(`ok  ${name}`); } catch (e) { errors.push(name); console.log(`FAIL ${name}: ${e.stack || e.message}`); } };
const store = tag => ({ asOf: '2026-10-27', families: new Map([['students', { title: '원생', facets: [], records: [{ id: `s-${tag}`, label: `학생 ${tag}`, detail: '', status: '', date: '', fields: [], facetIds: [] }] }]]) });
const encoded = (tag, recTag = tag) => encodeData({ meta: { tag } }, store(recTag));
const EXPECT = { importedAt: '2026-10-27T05:34:06.534Z', asOf: '2026-10-27' };
// 작업 스레드가 보내는 모양(data-refresh-worker.mjs) 그대로.
const own = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const out = (tag, extra = {}) => {
  const recTag = extra.recTag ?? tag, e = encoded(tag, recTag);
  const { recTag: _, ...rest } = extra;
  return { ok: true, meta: { ...EXPECT }, json: own(e.json), snapshotHash: e.snapshotHash, recordsHash: e.recordsHash, records: { bytes: own(e.records.bytes), ends: e.records.ends, asOf: e.records.asOf },
    source: { identity: { tag } }, flowError: null, assistant: { context: { tag }, area: [{ id: `ws:${tag}`, label: tag }] }, timings: { total: 5, snapshot: 3, flow: 1 }, postedAt: Date.now(), ...rest };
};

try {
  await check('내줄 모양: 같은 내용이면 개정 번호 그대로 · 바뀌면 +1 · 기록만 바뀌면 ETag 그대로 · script 끝에 개정 번호', async () => {
    const h = createDataHolder(encoded('a'));
    assert.equal(h.current.revision, 1); assert.match(h.current.etag, /^"[0-9a-f]{24}"$/);
    assert.equal(h.replace(encoded('a')), false); assert.equal(h.current.revision, 1);
    const etag = h.current.etag;
    assert.equal(h.replace(encoded('a', 'other')), true); assert.equal(h.current.revision, 2); assert.equal(h.current.etag, etag);
    assert.equal(h.replace(encoded('b')), true); assert.equal(h.current.revision, 3); assert.notEqual(h.current.etag, etag);
    assert.equal(h.current.script.toString(), `window.AcademySnapshot={"meta":{"tag":"b"}};window.AcademySnapshotRevision=${JSON.stringify({ revision: 3, etag: h.current.etag })};`);
    assert.equal(encodeData({ s: '</script>' }, null).json.toString(), '{"s":"\\u003c/script>"}');
  });

  await check('기록 묶음: 영역별 바이트로 묶고 풀면 같은 저장소 · 해시는 내용으로', async () => {
    const two = { asOf: '2026-10-27', families: new Map([...store('a').families, ['billing', { title: '수납', facets: [{ id: 'f', label: '분류' }], records: [{ id: 'b1', label: '청구 <1>', fields: [{ label: '금액', value: '10,000원' }] }] }]]) };
    const packed = encodeRecords(two);
    assert.equal(packed.ends.length, 2); assert.equal(packed.ends.at(-1), packed.bytes.length);
    const back = await decodeRecords({ bytes: own(packed.bytes), ends: packed.ends, asOf: packed.asOf });
    assert.deepEqual(back, two); assert(Object.isFrozen(back));
    assert.equal(encodeRecords(back).hash, packed.hash); assert.notEqual(encodeRecords(store('b')).hash, encodeRecords(store('a')).hash);
  });

  await check('모아서 한 번: 짧은 사이 저장 셋 → 마지막 저장 뒤 한 번', async () => {
    let runs = 0; const s = createRefreshScheduler({ run: async () => { runs += 1; }, debounceMs: 80, maxWaitMs: 2000, log: quiet });
    s.schedule(); await sleep(10); s.schedule(); await sleep(10); s.schedule();
    await sleep(30); assert.equal(runs, 0, '마지막 저장 뒤 모으는 시간 전에는 돌지 않는다'); assert.equal(s.status().pending, true);
    await sleep(120); await s.idle(); assert.equal(runs, 1); assert.equal(s.status().pending, false);
    await s.close();
  });

  await check('한 번에 하나: 도는 중 저장 여러 번 → 끝난 뒤 한 번 더(한 번만)', async () => {
    let runs = 0, active = 0, peak = 0;
    const s = createRefreshScheduler({ run: async () => { runs += 1; active += 1; peak = Math.max(peak, active); await sleep(120); active -= 1; }, debounceMs: 20, maxWaitMs: 2000, minGapMs: 0, log: quiet });
    s.schedule(); await sleep(60); assert.equal(s.status().refreshing, true);
    s.schedule(); s.schedule(); s.schedule();
    await sleep(360); await s.idle();
    assert.equal(runs, 2); assert.equal(peak, 1);
    await s.close();
  });

  await check('계속 저장해도 첫 저장 뒤 maxWaitMs 안에는 한 번 돈다', async () => {
    let runs = 0; const s = createRefreshScheduler({ run: async () => { runs += 1; }, debounceMs: 80, maxWaitMs: 150, log: quiet });
    for (let i = 0; i < 12; i += 1) { s.schedule(); await sleep(30); }
    assert(runs >= 1, `runs=${runs}`);
    await s.close();
  });

  await check('갱신 사이 쉬는 시간: 끝난 뒤 minGapMs 안에는 다시 돌지 않는다 · 예약 실행이 던져도 서버는 계속', async () => {
    const ends = [], starts = []; let n = 0;
    const s = createRefreshScheduler({ run: async () => { starts.push(Date.now()); await sleep(20); ends.push(Date.now()); }, debounceMs: 10, maxWaitMs: 1000, minGapMs: 200, log: () => { n += 1; if (n === 1) throw new Error('로그 실패'); } });
    s.schedule(); await sleep(60); s.schedule(); await sleep(100); assert.equal(starts.length, 1, '쉬는 시간 안');
    await sleep(250); await s.idle(); assert.equal(starts.length, 2); assert(starts[1] - ends[0] >= 190, `${starts[1] - ends[0]}ms`);
    await s.close();
    const r = createRefreshScheduler({ run: async () => { throw new Error('실패'); }, debounceMs: 5, retryMs: 10_000, log: () => { throw new Error('로그도 실패'); } });
    const errorLog = console.error; let caught = 0; console.error = () => { caught += 1; };
    try { r.schedule(); await sleep(60); await r.idle(); } finally { console.error = errorLog; }
    assert.equal(caught, 1, '처리 안 된 거부 대신 오류 출력');
    await r.close();
  });

  await check('실패하면 옛 자료 그대로 · 최대 3번 다시 · 그다음은 다음 저장 때', async () => {
    const data = createDataHolder(encoded('a')); let spawns = 0; const logs = [];
    const r = createDataRefresh({ data, expect: EXPECT, log: m => logs.push(m), spawn: async () => { spawns += 1; throw new RefreshError('snapshot_failed', 'DB 연결 실패'); }, scheduler: { debounceMs: 10, retryMs: 20, minGapMs: 0 } });
    r.schedule(); await sleep(400); await r.idle();
    assert.equal(spawns, 4); assert.equal(data.current.revision, 1); assert.equal(r.info().stale, true);
    assert.match(logs.at(-1), /자료 갱신 실패\(snapshot_failed · 연달아 4번\) — 옛 자료를 그대로 씁니다/);
    r.schedule(); await sleep(80); await r.idle(); assert.equal(spawns, 5, '새 저장이 오면 다시');
    await r.close();
  });

  await check('복사본이 바뀌면(복사 시각) 아무것도 바꾸지 않고 멈춘다 — 다시 하지 않는다', async () => {
    useWorkspaceStore(null);
    const data = createDataHolder(encoded('a')); let spawns = 0, used = 0, reloaded = 0;
    const r = createDataRefresh({ data, expect: EXPECT, log: quiet, assistant: { use: () => { used += 1; } }, flow: { service: { reloadSource: async () => { reloaded += 1; } } },
      spawn: async () => { spawns += 1; return out('b', { meta: { ...EXPECT, importedAt: '2026-11-01T00:00:00.000Z' } }); }, scheduler: { debounceMs: 10, retryMs: 20 } });
    r.schedule(); await sleep(150); await r.idle();
    assert.equal(spawns, 1); assert.equal(data.current.revision, 1); assert.equal(used, 0); assert.equal(reloaded, 0); assert.equal(currentWorkspaceStore(), null);
    assert.equal(r.status().lastError, 'copy_changed'); assert.equal(r.info().stale, true);
    r.schedule(); await sleep(60); await r.idle(); assert.equal(spawns, 1, '멈춘 뒤에는 작업 스레드를 띄우지 않는다');
    await r.close();
  });

  await check('지점 이름이 저장으로 바뀌어도(내용) 같은 복사본이면 그대로 갱신한다', async () => {
    const data = createDataHolder(encoded('a'));
    const r = createDataRefresh({ data, expect: EXPECT, log: quiet, spawn: async () => out('b', { meta: { ...EXPECT, tenant: '바뀐 이름' } }), scheduler: { debounceMs: 5 } });
    r.schedule(); await sleep(60); await r.idle(); await r.close();
    assert.equal(data.current.revision, 2); assert.equal(r.status().lastError, null);
  });

  await check('바뀌면 한 틱에: 첫 화면 자료(개정 +1)·기록 저장소·비서, 그 뒤 업무 흐름 reloadSource', async () => {
    const data = createDataHolder(encoded('a')), used = [], reloaded = [], logs = [], o = out('b');
    const r = createDataRefresh({ data, expect: EXPECT, log: m => logs.push(m), assistant: { use: x => used.push(x) },
      flow: { service: { reloadSource: async src => { reloaded.push(src); assert.equal(data.current.revision, 2, '흐름보다 첫 화면이 먼저'); assert.deepEqual(currentWorkspaceStore(), store('b')); return { created: 1, updated: 0, closed: 2, reopened: 0, unchanged: 5 }; } } },
      spawn: async ({ flow }) => { assert.equal(flow, true, '흐름이 있으면 흐름 원본도 만든다'); return o; }, scheduler: { debounceMs: 10 } });
    r.schedule(); await sleep(80); await r.idle();
    assert.equal(data.current.revision, 2); assert.equal(data.current.json.toString(), '{"meta":{"tag":"b"}}');
    assert.deepEqual(currentWorkspaceStore(), store('b')); assert.deepEqual(used, [o.assistant]); assert.equal(reloaded[0], o.source);
    assert.match(logs.at(-1), /^자료 갱신 r2\(바뀜: 첫 화면·기록\) \d+ms — 작업 스레드 5ms\(스냅숏 3ms · 흐름 원본 1ms\) · 전달 \d+ms · 기록 풀기 \d+ms · 업무 흐름 reloadSource \d+ms \{"created":1,"updated":0,"closed":2,"reopened":0,"unchanged":5\}$/);
    const info = r.info(); assert.equal(info.revision, 2); assert.equal(info.etag, data.current.etag); assert.equal(info.stale, false); assert.equal(info.asOf, EXPECT.asOf);
    await r.close();
  });

  await check('내용이 같으면 개정 번호·저장소·비서 그대로 — 업무 흐름은 그래도 맞춘다(멱등)', async () => {
    const data = createDataHolder(encoded('a')), sentinel = store('keep'); let used = 0, reloaded = 0;
    useWorkspaceStore(sentinel);
    const r = createDataRefresh({ data, expect: EXPECT, log: quiet, assistant: { use: () => { used += 1; } }, flow: { service: { reloadSource: async () => { reloaded += 1; return { unchanged: 9 }; } } }, spawn: async () => out('a'), scheduler: { debounceMs: 10 } });
    r.schedule(); await sleep(80); await r.idle();
    assert.equal(data.current.revision, 1); assert.equal(currentWorkspaceStore(), sentinel); assert.equal(used, 0); assert.equal(reloaded, 1);
    await r.close();
  });

  await check('기록만 바뀌면 저장소만 · 첫 화면만 바뀌면 비서만(바뀐 것만 갈아 끼운다)', async () => {
    const sentinel = store('keep'), used = [];
    useWorkspaceStore(sentinel);
    const d1 = createDataHolder(encoded('a')), r1 = createDataRefresh({ data: d1, expect: EXPECT, log: quiet, assistant: { use: x => used.push(x) }, spawn: async () => out('a', { recTag: 'z' }), scheduler: { debounceMs: 5 } });
    r1.schedule(); await sleep(60); await r1.idle(); await r1.close();
    assert.equal(d1.current.revision, 2); assert.deepEqual(currentWorkspaceStore(), store('z')); assert.equal(used.length, 0);
    useWorkspaceStore(sentinel);
    const d2 = createDataHolder(encoded('a')), r2 = createDataRefresh({ data: d2, expect: EXPECT, log: quiet, assistant: { use: x => used.push(x) }, spawn: async () => out('b', { recTag: 'a' }), scheduler: { debounceMs: 5 } });
    r2.schedule(); await sleep(60); await r2.idle(); await r2.close();
    assert.equal(d2.current.revision, 2); assert.equal(currentWorkspaceStore(), sentinel); assert.equal(used.length, 1);
  });

  await check('reloadSource가 아직 없으면 건너뛰고 로그만 · 흐름이 시작 중이면 기다린다 · 시작 실패면 흐름 없이', async () => {
    const logs = [], data = createDataHolder(encoded('a'));
    const r = createDataRefresh({ data, expect: EXPECT, log: m => logs.push(m), flow: { service: {} }, spawn: async () => out('b'), scheduler: { debounceMs: 10 } });
    r.schedule(); await sleep(60); await r.idle(); await r.close();
    assert.match(logs.at(-1), /업무 흐름 reloadSource 아직 없음 — 건너뜀$/); assert.equal(r.status().lastError, null);
    const flow = { service: null, ready: null }, reloaded = [];
    flow.ready = sleep(50).then(() => { flow.service = { reloadSource: async src => { reloaded.push(src); return {}; } }; return flow.service; });
    const flags = [], r2 = createDataRefresh({ data: createDataHolder(encoded('a')), expect: EXPECT, log: quiet, flow, spawn: async ({ flow: f }) => { flags.push(f); return out('c'); }, scheduler: { debounceMs: 5 } });
    r2.schedule(); await sleep(150); await r2.idle(); await r2.close();
    assert.deepEqual(flags, [true]); assert.equal(reloaded.length, 1);
    const logs3 = [], r3 = createDataRefresh({ data: createDataHolder(encoded('a')), expect: EXPECT, log: m => logs3.push(m), flow: { service: null, ready: Promise.resolve(undefined) }, spawn: async ({ flow: f }) => { flags.push(f); return out('d'); }, scheduler: { debounceMs: 5 } });
    r3.schedule(); await sleep(60); await r3.idle(); await r3.close();
    assert.deepEqual(flags, [true, false]); assert.match(logs3.at(-1), /업무 흐름 꺼짐$/);
  });

  await check('업무 흐름 원본만 실패: 첫 화면 쪽은 새 자료 · 흐름은 옛 원본 · 다시 시도 예약(횟수 제한)', async () => {
    const data = createDataHolder(encoded('a')), o = out('b', { flowError: 'flow_source_failed', source: null }); let reloaded = 0;
    const r = createDataRefresh({ data, expect: EXPECT, log: quiet, flow: { service: { reloadSource: async () => { reloaded += 1; } } }, spawn: async () => o, scheduler: { debounceMs: 10, retryMs: 5000 } });
    r.schedule(); await sleep(80); await r.idle();
    assert.equal(data.current.revision, 2); assert.deepEqual(currentWorkspaceStore(), store('b')); assert.equal(reloaded, 0);
    assert.equal(r.status().lastError, 'flow_source_failed'); assert.equal(r.status().pending, true, '다시 시도가 예약됨');
    await r.close();
  });

  await check('2.0 저장 고리: 커밋된 저장만 알린다 · 알림이 실패해도 저장 답은 그대로', async () => {
    const journal = pathToFileURL(join(tmpdir(), `v2-writes-refresh-${process.pid}.jsonl`)), seen = [];
    const fake = () => ({ async begin(mode, fn) { const run = typeof mode === 'function' ? mode : fn; return run(strings => Promise.resolve(/to_regclass/.test(strings.join('?')) ? [{ present: false }] : [])); }, async end() {} });
    const screens = Promise.resolve(new Map([['demo', { id: 'demo', label: '시험', load: async () => ({}), actions: {
      save: { validate: raw => raw, run: async () => ({ saved: true }) },
      refuse: { validate: raw => raw, run: async () => { throw Object.assign(new Error('dup'), { code: '23505' }); } },
      bad: { validate: () => { throw new Error('x'); }, run: async () => ({}) },
    } }]]));
    const errorLog = console.error; console.error = () => {};
    const route = createV2ScreenRoute({ screens, open: async () => fake(), journal, onWrite: w => { seen.push(w); throw new Error('알림 실패'); } });
    const server = createServer((req, res) => { const p = new URL(req.url, 'http://x').pathname; if (route.handles(p)) route.handle(req, res, p); else { res.writeHead(404); res.end(); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const post = action => fetch(`http://127.0.0.1:${server.address().port}/api/v2/demo/${action}`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' }).then(r => r.status);
    try {
      assert.equal(await post('save'), 200); assert.deepEqual(seen, [{ screen: 'demo', action: 'save' }]);
      assert.equal(await post('refuse'), 409); assert.equal(await post('bad'), 400); assert.equal(seen.length, 1);
    } finally { console.error = errorLog; server.close(); await rm(journal, { force: true }); }
  });

  await check('기록 조회는 지금 내주는 시점의 저장소 — 갈아 끼우면 바로', async () => {
    const server = createServer((req, res) => { if (!handleWorkspaceRecords(req, res, {})) { res.writeHead(404); res.end(); } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const get = id => fetch(`http://127.0.0.1:${server.address().port}/api/workspaces/students/records?id=${id}`).then(r => r.status);
    try {
      useWorkspaceStore(store('x')); assert.equal(await get('s-x'), 200); assert.equal(await get('s-y'), 404);
      useWorkspaceStore(store('y')); assert.equal(await get('s-y'), 200); assert.equal(await get('s-x'), 404);
    } finally { server.close(); }
  });

  await check('비서: 질문마다 그때의 컨텍스트 — 갈아 끼우면 다음 질문부터', async () => {
    const inputs = [];
    const runner = { checkAuth: async () => ({ authMethod: 'x', subscriptionType: 'y', apiProvider: 'z' }), ask: async ({ input }) => { inputs.push(typeof input === 'string' ? input : JSON.stringify(input)); return { output: { answer: '확인했습니다.', issueIds: [], suggestedTask: null }, meta: { ms: 1, models: [] } }; } };
    let ctx = buildAssistantContext(fixture());
    const s = await startRoute(runner, { context: () => ctx });
    const ask = () => call(s, { headers: { origin: s.origin, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '수납 상황 알려줘' }) });
    try {
      await ask(); assert.match(inputs[0], /기준일 2026-10-27/);
      const next = fixture(); next.meta = { ...next.meta, asOf: '2026-10-28' };
      ctx = buildAssistantContext(next);
      await ask(); assert.match(inputs[1], /기준일 2026-10-28/); assert.doesNotMatch(inputs[1], /기준일 2026-10-27/);
    } finally { await s.close(); }
  });
} finally { useWorkspaceStore(null); }

console.log(errors.length ? `\n${errors.length} failed` : '\nall passed');
process.exitCode = errors.length ? 1 : 0;
