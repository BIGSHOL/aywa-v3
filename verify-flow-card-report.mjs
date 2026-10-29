// 보고서 카드의 원본 연결·2.0 발송 요청 결과 판정. 실제 DB나 바깥 발송을 사용하지 않는다.
import assert from 'node:assert/strict';
import { createFlowCardReport } from './flow-card-report.mjs';

const ACTOR = '268b797c-d00a-4475-8f6d-68894e47ccac';
const OTHER = '123e4567-e89b-42d3-a456-426614174000';
const TASK = 'ad26867d-2568-44ef-848e-77922eb2f892';
const REPORT = '47b42a70-2ee0-4521-b626-e6bd34a39b22';
const CASE = 'src-task-' + TASK, STEP = CASE + '-s1';
const flow = { service: { store: { state: { revision: 7, cases: { [CASE]: {
  id: CASE, taskKind: 'unsent_report', closure: 'fact', factClosed: false, state: 'open', sourceKey: 'task:' + TASK,
  entityRefs: [{ type: 'report', id: REPORT }], steps: [{ id: STEP, status: 'ready', assigneeIds: [ACTOR] }],
} } } }, source: { actors: [{ id: ACTOR, role: 'staff' }, { id: OTHER, role: 'staff' }] } } };
let queued = false, calls = 0, noQueue = null, lastRaw;
const sql = parts => {
  if (parts.join('?').includes('from public.staff_tasks')) return Promise.resolve([{ kind: 'unsent_report', task_status: queued ? 'done' : 'open', report_id: REPORT, classnote_status: queued ? 'queued' : null, revoked_at: null, source: 'native' }]);
  throw Error('unexpected SQL');
};
const open = async () => ({ begin: (_mode, fn) => fn(sql), end: async () => {} });
const v2ScreenRoute = { performWrite: async ({ id, name, raw, beforeRun }) => {
  assert.deepEqual([id, name], ['lesson-reports', 'sendClassnoteForUnsent']);
  await beforeRun({ sql }); calls++; lastRaw = raw;
  if (noQueue) return noQueue;
  queued = true; return { ok: true, queued: 1 };
} };
const card = createFlowCardReport({ flow, v2ScreenRoute, open });
const input = { caseId: CASE, stepId: STEP, recordRef: 'report:' + REPORT, expectedRevision: 7, actorId: ACTOR };

for (const bad of [{ ...input, actorId: OTHER }, { ...input, expectedRevision: 6 }, { ...input, recordRef: 'report:' + OTHER }]) await assert.rejects(card.save(bad));
assert.equal(calls, 0);
noQueue = { ok: false, error: '보고서 관리 권한이 없습니다' };
assert.deepEqual(await card.save(input), { saved: false, queued: 0, message: '보고서 관리 권한이 없습니다' });
noQueue = { ok: true, queued: 0, noClass: 1 };
assert.deepEqual(await card.save(input), { saved: false, queued: 0, message: '보낼 반과 원생의 ClassNote 연결을 확인해 주세요. 연결 전에는 발송 요청을 저장할 수 없습니다.' });
noQueue = null;
assert.deepEqual(await card.save(input), { saved: true, queued: 1, sourceClosed: true, message: '원본 반영 확인 중' });
assert.deepEqual(lastRaw, { module: 'features/report-admin/server/actions.ts', actor: ACTOR, args: [[REPORT]] });
await assert.rejects(card.save(input), e => e.code === 'source_changed');
assert.equal(calls, 3);
console.log('flow card report: 7 checks passed');
