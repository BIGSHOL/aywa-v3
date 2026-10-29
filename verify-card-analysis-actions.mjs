// 카드 분석에서 연 직접 요청: 출처 보존, 같은 확인 항목의 중복 방지, 대응 업무 수.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { IDS, send, service } from './verify-flow-engine-fixture.mjs';
import { CARD_FLOW_LINKS, flowFacts } from './card-analysis.mjs';

const { svc, dir } = await service();
let checks = 0;
try {
  const card = { metric: 'recent-absent', factIds: ['F-11111111', 'F-22222222'], refs: [{ type: 'student', id: 's1' }, { type: 'attendance', id: 'a1' }] };
  const payload = { title: '최근 결석 · 연락 결과 확인', body: '연락 결과를 확인해 주세요.\n근거\n- 이번 기간 결석 기록',
    assigneeIds: [IDS.t1], dueAt: '2026-10-28', channels: ['app'], recordRefs: ['student:s1', 'attendance:a1'],
    source: { kind: 'direct', label: '카드 분석 · 최근 결석', card } };
  const first = await send(svc, { actorId: IDS.owner, kind: 'request.create', payload });
  const created = svc.view().cases.find(c => c.id === first.caseId);
  assert.deepEqual(created.requestSource.card, card); assert.equal(created.title, payload.title); assert.equal(created.summary, payload.body); checks++;
  assert.deepEqual(created.entityRefs.map(r => `${r.type}:${r.id}`), payload.recordRefs); checks++;
  const again = await send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { ...payload, title: '다른 제목', source: { ...payload.source, card: { ...card, factIds: [...card.factIds].reverse() } } } });
  assert.equal(again.caseId, first.caseId); assert.equal(again.duplicate, true);
  assert.equal(svc.view().cases.filter(c => c.kind === 'request' && c.state !== 'done').length, 1); checks++;
  const next = await send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { ...payload, source: { ...payload.source, card: { ...card, factIds: ['F-33333333'] } } } });
  assert.notEqual(next.caseId, first.caseId); checks++;
  const cases = svc.view().cases, link = CARD_FLOW_LINKS['recent-absent'];
  const fact = flowFacts('recent-absent', cases, '2026-10-27')[0];
  const linked = new Set(fact.refs.map(r => r.id));
  const shown = cases.filter(c => c.state !== 'done' && linked.has(c.id) && (link.tasks.includes(c.taskKind) || link.signals.includes(c.signalId)));
  assert.equal(shown.length, fact.values.count); checks++;
  await assert.rejects(send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { ...payload, source: { ...payload.source, card: { ...card, refs: [{ type: 'student', id: '../bad' }] } } } }), e => e.status === 400); checks++;
  console.log(`카드 업무 출처·중복·연결 건수 ${checks}/${checks}`);
} finally {
  await svc.close();
  await rm(dir, { recursive: true, force: true });
}
