import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createOwnerApiProvider, loadOwnerApiKey, ownerAiTransport } from './owner-ai-api.mjs';
import { createAssistantRoute } from './claude-bridge-http.mjs';
import { createCardInsightRoute } from './card-insight-http.mjs';
import { buildAssistantContext } from './claude-bridge-context.mjs';
import { CARD_SCHEMA } from './card-insight.mjs';
import { db, call } from './verify-claude-helpers.mjs';

const local = 'http://127.0.0.1:4310';
const lan = 'http://192.168.101.29:4310';
const answer = { headline: '기록을 확인했습니다.', keyFacts: [], points: [], checks: [], table: null, links: [], issueIds: [], suggestedTask: null, queries: [] };

test('접속 주소와 그룹 키 우선순위, 키 비노출', async () => {
  assert.equal(ownerAiTransport(local), 'subscription');
  assert.equal(ownerAiTransport('http://localhost:4310'), 'subscription');
  assert.equal(ownerAiTransport(lan), 'api');
  const dir = await mkdtemp(join(tmpdir(), 'owner-ai-key-'));
  try {
    const file = join(dir, '.env.local');
    await writeFile(file, 'ANTHROPIC_API_KEY=base-test-value\nANTHROPIC_API_KEY_BRIEFING=group-test-value\n');
    assert.equal(await loadOwnerApiKey({ envFile: file, env: {} }), 'group-test-value');
    await writeFile(file, 'ANTHROPIC_API_KEY=base-test-value\n');
    assert.equal(await loadOwnerApiKey({ envFile: file, env: {} }), 'base-test-value');
    await writeFile(file, 'OTHER=one\n');
    assert.equal(await loadOwnerApiKey({ envFile: file, env: {} }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('API 공급자: 같은 JSON 계약·조회 도구만, 키는 요청에 넣지 않음', async () => {
  const seen = [], queried = [], key = 'never-send-this-test-key';
  const card = { summary: { text: '기록을 확인해 주세요.', factIds: ['F-aabbccdd'] }, watch: [], checks: [] };
  const responses = [
    { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(card) }] },
    { model: 'claude-sonnet-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'schema', input: { table: 'students' } }] },
    { model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] },
  ];
  const provider = createOwnerApiProvider({ apiKey: key, client: { messages: { create: async (...args) => { seen.push(args); return responses.shift(); } } },
    readerFactory: async () => ({ schema: async args => { queried.push(args.table); return { views: [] }; }, query: async () => assert.fail('예상하지 않은 SQL'), close: async () => { queried.push('closed'); } }) });
  const cardResult = await provider.ask({ schema: CARD_SCHEMA, prompt: '근거만 작성', input: { facts: [] }, effort: 'low' });
  assert.deepEqual(cardResult.output, card);
  assert.equal(cardResult.model, 'claude-sonnet-5-5');
  const assistantResult = await provider.askAssistant({ input: '서버 검증 컨텍스트' });
  assert.deepEqual(assistantResult.output, answer);
  assert.deepEqual(queried, ['students', 'closed']);
  assert.equal(seen[0][0].tools, undefined);
  assert.deepEqual(seen[1][0].tools.map(x => x.name), ['schema', 'query']);
  assert.equal(seen[2][0].messages.at(-1).content[0].type, 'tool_result');
  assert.equal(seen[0][0].output_config.format.type, 'json_schema');
  assert(!JSON.stringify(seen).includes(key));
  const failing = createOwnerApiProvider({ apiKey: key, client: { messages: { create: async () => { throw new Error(`secret ${key}`); } } } });
  await assert.rejects(failing.ask({ schema: CARD_SCHEMA, prompt: 'test', input: {} }), error =>
    error.code === 'api_failed' && !error.message.includes(key));
});

test('비서와 카드 버튼은 같은 출처에서 로컬·랜 공급자를 가른다', async () => {
  const calls = [], origins = new Set([local, lan]);
  const runner = kind => ({ ask: async () => { calls.push(kind); return { output: answer, meta: { ms: 1, models: ['claude-sonnet-5-5'] } }; } });
  const ready = { require: async () => {} };
  const readerFactory = async () => ({ query: async () => assert.fail('예상하지 않은 SQL'), close: async () => {} });
  const route = createAssistantRoute({ context: buildAssistantContext(db()), runner: runner('subscription'), readiness: ready, origins, readerFactory,
    selectProvider: origin => ({ runner: runner(ownerAiTransport(origin)), readiness: ready }) });
  const server = createServer((req, res) => route.handle(req, res).catch(() => res.destroy()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const origin of [local, lan]) {
      const res = await call({ port }, { headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '운영 기록을 정리해 줘' }) });
      assert.equal(res.status, 200, res.text);
      assert(!res.text.includes('subscription') && !res.text.includes('api-key'));
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.deepEqual(calls, ['subscription', 'api']);

  const cardCalls = [];
  const cardRoute = createCardInsightRoute({ store: Promise.resolve({ viewFingerprint: () => ({ status: 'empty' }),
    make: async (_analysis, provider) => { cardCalls.push(provider); return { status: 200 }; } }),
  getAnalysis: async () => ({}), providerForOrigin: origin => ownerAiTransport(origin) });
  const cardServer = createServer((req, res) => cardRoute.handle(req, res).catch(() => res.destroy()));
  await new Promise(resolve => cardServer.listen(0, '127.0.0.1', resolve));
  try {
    for (const origin of [local, lan]) {
      const res = await call({ port: cardServer.address().port }, { path: '/api/insight/cards?metric=exits&grain=month',
        headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 200);
    }
  } finally { await new Promise(resolve => cardServer.close(resolve)); }
  assert.deepEqual(cardCalls, ['subscription', 'api']);
});
