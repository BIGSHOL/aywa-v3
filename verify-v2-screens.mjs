// The 2.0 screens frame (v2-screens.mjs) without a database: a fake copy answers the SQL, so nothing is read or written for real.
// Checks the read route's guards and the write route's: same-origin JSON only, declared actions only, Korean refusals,
// one write at a time, and a write that queued an outbound HTTP request (pg_net) is rolled back.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createV2ScreenRoute, V2Error } from './v2-screens.mjs';

const journal = pathToFileURL(join(tmpdir(), `v2-writes-${process.pid}.jsonl`));
const state = { queue: 0, committed: [], open: 0, concurrent: 0, peak: 0 };
const fakeDb = () => ({
  async begin(mode, fn) {
    const run = typeof mode === 'function' ? mode : fn, pending = [], queue0 = state.queue;
    const sql = (strings, ...values) => {
      const text = strings.join('?');
      if (/to_regclass/.test(text)) return Promise.resolve([{ present: true }]);
      if (/http_request_queue/.test(text)) return Promise.resolve([{ n: state.queue }]);
      if (/^insert/i.test(text)) { pending.push(values); return Promise.resolve([]); }
      if (/^queue-http/.test(text)) { state.queue += 1; return Promise.resolve([]); }
      return Promise.resolve([{ readOnly: mode === 'isolation level repeatable read read only' }]);
    };
    state.concurrent += 1; state.peak = Math.max(state.peak, state.concurrent);
    try { const out = await run(sql); state.committed.push(...pending); return out; }
    catch (error) { state.queue = queue0; throw error; } // rollback: queued requests vanish with the transaction
    finally { state.concurrent -= 1; }
  },
  async end() { state.open -= 1; },
});
const open = async () => { state.open += 1; return fakeDb(); };
const tick = () => new Promise(r => setTimeout(r, 15));
const screens = Promise.resolve(new Map([
  ['demo', { id: 'demo', label: '시험', order: 1, params: { month: /^\d{4}-\d{2}$/ }, load: async ({ sql }) => (await sql`select 1`)[0],
    actions: {
      save: { validate: raw => { if (typeof raw.name !== 'string' || !raw.name) throw new V2Error(400, 'invalid_request', '이름을 적어 주세요.'); return { name: raw.name }; },
        run: async ({ sql, body }) => { await tick(); await sql`insert into x values (${body.name})`; return { saved: body.name }; } },
      sensitive: { validate: raw => raw, run: async ({ body }) => ({ ok: true, id: body.input.studentId, note: body.input.note }) },
      leak: { validate: raw => raw, run: async ({ sql }) => { await sql`insert into x values (${'leak'})`; await sql`queue-http`; return {}; } },
      dbRefuse: { validate: raw => raw, run: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "x_key"'), { code: '23505' }); } },
      crash: { validate: raw => raw, run: async () => { throw new Error('relation "secret_table" does not exist'); } },
      validationResult: { validate: raw => raw, run: async ({ body }) => ({ error: body.message }) },
      validationRefusal: { validate: raw => raw, run: async () => { throw new V2Error(400, 'invalid_request', 'Invalid UUID'); } },
    } }],
  ['view', { id: 'view', label: '보기', load: async () => ({}) }],
]));
const route = createV2ScreenRoute({ screens, open, journal });
const server = createServer((req, res) => { const path = new URL(req.url, 'http://x').pathname; if (route.handles(path)) route.handle(req, res, path); else { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, { method = 'GET', body, site = 'same-origin', type = 'application/json' } = {}) => {
  const headers = { ...(site ? { 'sec-fetch-site': site } : {}), ...(body !== undefined ? { 'content-type': type } : {}) };
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const errors = [], check = (name, fn) => fn().then(() => console.log(`ok  ${name}`), e => { errors.push(name); console.log(`FAIL ${name}: ${e.message}`); });
try {
  await check('list marks which screens save', async () => {
    const r = await call('/api/v2'); assert.equal(r.status, 200);
    assert.deepEqual(r.body.screens.map(s => [s.id, s.writable]), [['demo', true], ['view', false]]);
  });
  await check('read is a read-only transaction and checks params', async () => {
    assert.equal((await call('/api/v2/demo?month=2026-08')).body.readOnly, true);
    assert.equal((await call('/api/v2/demo?month=nope')).status, 400);
    assert.equal((await call('/api/v2/demo?other=1')).status, 400);
    // 2.0 부품이 붙이는 embed=1은 화면이 받겠다고 적지 않았으면 버린다(400 아님) — 다른 값과 함께여도
    assert.equal((await call('/api/v2/demo?embed=1&month=2026-08')).body.readOnly, true);
    assert.equal((await call('/api/v2/demo?embed=1&month=nope')).status, 400);
  });
  await check('write saves, answers the result and journals it', async () => {
    const r = await call('/api/v2/demo/save', { method: 'POST', body: { name: '홍길동' } });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, result: { saved: '홍길동' } });
    assert.deepEqual(state.committed.at(-1), ['홍길동']);
    const last = JSON.parse((await readFile(journal, 'utf8')).trim().split('\n').at(-1));
    assert.equal(last.ok, true); assert.equal(last.screen, 'demo'); assert.equal(last.action, 'save');
    assert.deepEqual(JSON.parse(last.body), { 항목_0: { 글자수: 3 } });
    assert.deepEqual(JSON.parse(last.result), { saved: { 글자수: 3 } });
  });
  await check('journal keeps record IDs and enum values but masks free text in objects and positional args', async () => {
    const studentId = '123e4567-e89b-42d3-a456-426614174000';
    const note = '가정 사정과 건강 정보';
    const r = await call('/api/v2/demo/sensitive', { method: 'POST', body: {
      actor: studentId, input: { studentId, sessionDate: '2026-10-29', signal: 'absent', state: 'resolved', note },
      args: [studentId, '연락 사유 원문'], secretSensitiveToken: '비밀',
    } });
    assert.equal(r.status, 200); assert.equal(r.body.result.note, note, 'screen result stays unchanged');
    const last = JSON.parse((await readFile(journal, 'utf8')).trim().split('\n').at(-1));
    assert.doesNotMatch(JSON.stringify(last), /가정 사정|건강 정보|연락 사유 원문|secretSensitiveToken|비밀/);
    assert.deepEqual(JSON.parse(last.body), {
      actor: studentId, input: { studentId, sessionDate: '2026-10-29', signal: 'absent', state: 'resolved', note: { 글자수: note.length } },
      args: [studentId, { 글자수: '연락 사유 원문'.length }], 항목_3: { 글자수: 2 },
    });
    assert.deepEqual(JSON.parse(last.result), { ok: true, id: studentId, note: { 글자수: note.length } });
  });
  await check('write refuses other sites, non-JSON, GET-only screens and unknown actions', async () => {
    assert.equal((await call('/api/v2/demo/save', { method: 'POST', body: { name: 'a' }, site: 'cross-site' })).status, 403);
    assert.equal((await call('/api/v2/demo/save', { method: 'POST', body: { name: 'a' }, site: null })).status, 403);
    assert.equal((await call('/api/v2/demo/save', { method: 'POST', body: 'name=a', type: 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await call('/api/v2/view/save', { method: 'POST', body: {} })).status, 404);
    assert.equal((await call('/api/v2/demo/toString', { method: 'POST', body: {} })).status, 404);
    assert.equal((await call('/api/v2/demo', { method: 'POST', body: {} })).status, 405);
    assert.equal((await call('/api/v2/demo', { method: 'DELETE' })).status, 405);
  });
  await check('validate refusals are the screen’s Korean words; broken JSON is a fixed message', async () => {
    const r = await call('/api/v2/demo/save', { method: 'POST', body: { name: '' } }); assert.equal(r.status, 400); assert.equal(r.body.message, '이름을 적어 주세요.');
    const j = await call('/api/v2/demo/save', { method: 'POST', body: '{broken' }); assert.equal(j.status, 400); assert.equal(j.body.message, '입력 값을 확인해 주세요.');
  });
  await check('a write that queues an outbound request is rolled back', async () => {
    const before = state.committed.length;
    const r = await call('/api/v2/demo/leak', { method: 'POST', body: {} });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'outbound_blocked');
    assert.equal(state.committed.length, before); assert.equal(state.queue, 0);
  });
  await check('database errors answer Korean, never the raw message', async () => {
    const d = await call('/api/v2/demo/dbRefuse', { method: 'POST', body: {} }); assert.equal(d.status, 409); assert.equal(d.body.message, '이미 같은 기록이 있어 저장하지 않았습니다.');
    const c = await call('/api/v2/demo/crash', { method: 'POST', body: {} }); assert.equal(c.status, 500); assert.doesNotMatch(c.body.message, /secret_table|relation/);
  });
  await check('known English validation errors answer Korean without changing other results', async () => {
    for (const message of ['Invalid UUID', 'Invalid input: expected UUID', 'Expected string, received number', 'Required']) {
      const r = await call('/api/v2/demo/validationResult', { method: 'POST', body: { message } });
      assert.deepEqual(r.body, { ok: true, result: { error: '입력 값을 확인해 주세요.' } });
    }
    const korean = await call('/api/v2/demo/validationResult', { method: 'POST', body: { message: '학생을 선택해 주세요.' } });
    assert.equal(korean.body.result.error, '학생을 선택해 주세요.');
    const refusal = await call('/api/v2/demo/validationRefusal', { method: 'POST', body: {} });
    assert.equal(refusal.status, 400); assert.equal(refusal.body.message, '입력 값을 확인해 주세요.');
  });
  await check('writes run one at a time and every connection is closed', async () => {
    state.peak = 0;
    const rs = await Promise.all(['가', '나', '다'].map(name => call('/api/v2/demo/save', { method: 'POST', body: { name } })));
    assert.deepEqual(rs.map(r => r.status), [200, 200, 200]); assert.equal(state.peak, 1); assert.equal(state.open, 0);
  });
} finally { server.close(); await rm(journal, { force: true }); }
if (errors.length) { console.log(`\n${errors.length} failed`); process.exit(1); }
console.log('\nv2 screens frame: all checks passed');
