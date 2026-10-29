import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { activeFlowSteps } from './flow-case-flags.mjs';
import { IDS, send, service } from './verify-flow-engine-fixture.mjs';

const { dir, svc } = await service();
try {
  await send(svc, { actorId: IDS.owner, kind: 'request.create', payload: {
    title: '교재 재고 확인', body: '다음 주 교재를 확인해 주세요.', assigneeIds: [IDS.t1], channels: ['app'], source: { kind: 'direct' },
  } });
  const full = svc.view(), summary = svc.summary();
  assert.equal(summary.summary, true);
  assert.equal(summary.revision, full.revision);
  assert.equal(summary.casesTotal, full.casesTotal);
  assert.deepEqual(summary.firstScreen, full.firstScreen, 'summary and full use one count result');
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < Buffer.byteLength(JSON.stringify(full)));
  assert.ok(summary.cases.some(c => c.kind === 'request'), 'request cards remain on home');
  for (const c of summary.cases) assert.deepEqual(c, full.cases.find(x => x.id === c.id), `same case ${c.id}`);
  for (const state of ['open', 'working', 'review', 'done']) {
    assert.equal(summary.firstScreen.stages[state], full.cases.filter(c => c.origin !== 'dev' && c.state === state).length, `${state} stage`);
  }
  for (const actor of full.actors) {
    const expected = full.cases.filter(c => {
      const steps = activeFlowSteps(c);
      const mine = steps.some(s => (s.assigneeIds || []).includes(actor.id) || ['owner', 'manager'].includes(actor.role) && s.queue === 'manager' && !(s.assigneeIds || []).length);
      return mine || actor.role === 'manager' && c.caseFlags?.unassigned;
    }).length;
    assert.equal(summary.firstScreen.inboxByActor[actor.id], expected, `${actor.id} inbox`);
  }
  const ownerDecision = list => list.filter(c => activeFlowSteps(c).some(s => (s.assigneeIds || []).includes(IDS.owner))).length;
  assert.equal(ownerDecision(summary.cases), ownerDecision(full.cases), 'owner decision count');
  console.log(`PASS 요약/전체 화면 수치 일치 · ${Buffer.byteLength(JSON.stringify(full))} → ${Buffer.byteLength(JSON.stringify(summary))}바이트`);
} finally {
  await svc.close();
  const target = resolve(dir), root = resolve(tmpdir());
  if (!target.toLowerCase().startsWith((root + sep).toLowerCase()) || !basename(target).startsWith('flow-test-')) throw new Error('시험 폴더가 예상한 임시 경로가 아닙니다.');
  await rm(target, { recursive: true, force: true });
}
