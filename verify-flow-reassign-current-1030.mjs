import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { IDS, fixtureSource, send, service } from './verify-flow-engine-fixture.mjs';

const caseOf = (svc, id) => svc.view().cases.find(c => c.id === id);
async function withService(source, check) {
  const { svc, dir } = await service({ source });
  try { await check(svc); }
  finally {
    await svc.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.match(basename(dir), /^flow-test-/);
    await rm(dir, { recursive: true, force: true });
  }
}

test('원본의 참관 담당을 다른 직원으로 바꿔도 그 업무에 복원할 수 있다', async () => {
  await withService(fixtureSource(), async svc => {
    const id = 'src-task-t-open';
    assert.deepEqual(caseOf(svc, id).sourceAssigneeIds, [IDS.desk]);
    await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: id, payload: { assigneeIds: [IDS.t1] } });
    await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: id, payload: { assigneeIds: [IDS.desk] } });
    assert.deepEqual(caseOf(svc, id).steps[0].assigneeIds, [IDS.desk]);
    await assert.rejects(send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: 'src-task-t-orphan', payload: { assigneeIds: [IDS.desk] } }), error => error.code === 'assignee_not_allowed');
  });
});

test('원본 담당이 재직 명단에서 빠져도 그 업무의 원본 ID만 복원할 수 있다', async () => {
  const source = fixtureSource();
  source.actors = source.actors.filter(a => a.id !== IDS.desk);
  await withService(source, async svc => {
    const id = 'src-task-t-open';
    assert.deepEqual(caseOf(svc, id).sourceAssigneeIds, [IDS.desk]);
    await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: id, payload: { assigneeIds: [IDS.t1] } });
    await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: id, payload: { assigneeIds: [IDS.desk] } });
    assert.deepEqual(caseOf(svc, id).steps[0].assigneeIds, [IDS.desk]);
  });
});
