import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { cardInput, createCardInsight, openCardInsightStore, validateCardOutput, displayCardOutput } from './card-insight.mjs';
import { createCardInsightRoute } from './card-insight-http.mjs';

const identity = { tenantId: 'test-tenant', tenantSlug: 'test', capturedAt: '2026-10-29T00:00:00Z' };
const analysis = { metric: 'exits', records: [{ name: '홍길동' }], facts: [
  { id: 'F1', item: 1, kind: 'current', text: '지금 14명', values: { current: 14 } },
  { id: 'F2', item: 2, kind: 'increase', text: '담당 선생님 김철수 · 3명', values: { dimension: 'teacher', key: 'private-id', current: 3 } },
  { id: 'F3', item: 3, kind: 'cluster', text: '반 샛별반 5건 몰림', values: { field: 'className', name: '샛별반', count: 5 } },
] };
const built = cardInput(analysis), ids = built.facts.map(f => f.id);
const good = { summary: { text: '변화를 확인할 기록이 있습니다.', factIds: [ids[0]] }, watch: [{ text: '담당 선생님 기준의 변화가 있습니다.', factIds: [ids[1]] }], checks: [{ text: '반의 기록을 확인해 주세요.', factIds: [ids[2]] }] };
let n = 0;
assert(!JSON.stringify(built.facts).includes('홍길동') && !JSON.stringify(built.facts).includes('김철수') && !JSON.stringify(built.facts).includes('샛별반') && !JSON.stringify(built.facts).includes('private-id')); n++;
assert.equal(validateCardOutput(good, built.facts).ok, true); n++;
assert(validateCardOutput({ ...good, summary: { text: '14명이 늘었습니다.', factIds: [ids[0]] } }, built.facts).issues.includes('number_in_text')); n++;
assert.equal(validateCardOutput({ ...good, summary: { text: '확인이 필요합니다.', factIds: ['F-deadbeef'] } }, built.facts).ok, false); n++;
assert(validateCardOutput({ ...good, summary: { text: 'current 값 확인', factIds: [ids[0]] } }, built.facts).issues.includes('raw_code')); n++;
assert.equal(displayCardOutput({ ...good, summary: { text: `${ids[0]} 확인`, factIds: [ids[0]] } }, [{ id: ids[0], text: '지금 14명' }, ...built.facts.slice(1)]).summary.text, '지금 14명 확인'); n++;
const root = await mkdtemp(join(tmpdir(), 'card-insight-'));
try {
  const store = await openCardInsightStore({ dir: root, identity });
  let calls = 0, reserves = 0;
  const provider = { ask: async request => { calls++; assert.deepEqual(Object.keys(request.input), ['facts']); return { output: good, model: 'claude-sonnet-5-5' }; } };
  const service = createCardInsight({ store, provider, reserve: async () => { reserves++; return true; }, clock: () => Date.parse('2026-10-29T05:00:00Z') });
  assert.equal(service.view(analysis).status, 'empty'); n++;
  const route = createCardInsightRoute({ store: Promise.resolve(service), getAnalysis: async () => analysis });
  const http = createServer((req, res) => route.handle(req, res).catch(e => { res.statusCode = 500; res.end(e.message); }));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/insight/cards?metric=exits`);
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'empty'); assert.equal(calls, 0); n++;
  } finally { await new Promise(resolve => http.close(resolve)); }
  const made = await service.make(analysis);
  assert.equal(made.status, 'ready'); assert.equal(made.httpStatus, 200); assert.equal(calls, 1); assert.equal(reserves, 1); assert.equal(made.result.modelLabel, 'Claude Sonnet 5.5'); n++;
  await store.close();
  const again = await openCardInsightStore({ dir: root, identity });
  const loaded = createCardInsight({ store: again });
  assert.equal(loaded.view(analysis).status, 'ready'); assert.equal(calls, 1); n++;
  assert.equal(loaded.view({ ...analysis, facts: [{ ...analysis.facts[0], values: { current: 15 } }, ...analysis.facts.slice(1)] }).status, 'stale'); n++;
  assert.equal(loaded.view(analysis).result.summary.evidence[0], '지금 14명'); n++;
  await again.close();
  const badStore = await openCardInsightStore({ dir: join(root, 'bad'), identity });
  let badCalls = 0;
  const bad = createCardInsight({ store: badStore, provider: { ask: async () => { badCalls++; return { output: { ...good, summary: { text: '확인이 필요합니다.', factIds: ['F-deadbeef'] } } }; } }, reserve: async () => true });
  assert.equal((await bad.make(analysis)).status, 422); assert.equal(badCalls, 1); assert.equal(bad.view(analysis).status, 'empty'); n++;
  await badStore.close();
  const numberStore = await openCardInsightStore({ dir: join(root, 'number'), identity });
  let numberCalls = 0;
  const numeric = createCardInsight({ store: numberStore, provider: { ask: async () => { numberCalls++; return { output: { ...good, summary: { text: '14명이 늘었습니다.', factIds: [ids[0]] } } }; } }, reserve: async () => true });
  assert.equal((await numeric.make(analysis)).status, 422); assert.equal(numberCalls, 2); assert.equal(numeric.view(analysis).status, 'empty'); n++;
  await numberStore.close();
} finally { await rm(root, { recursive: true, force: true }); }
console.log(`card insight ${n}/${n}`);
