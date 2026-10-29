// 상담 카드의 원본 연결, 현재 단계, 2.0 저장 결과를 가짜 DB로 검증한다.
import assert from 'node:assert/strict';
import { createFlowCardConsultation } from './flow-card-consultation.mjs';

const ACTOR = '44626c09-22d9-445f-a350-b792d6afdf75';
const OTHER = '123e4567-e89b-42d3-a456-426614174000';
const TASK = 'ad26867d-2568-44ef-848e-77922eb2f892';
const CONSULT = '47b42a70-2ee0-4521-b626-e6bd34a39b22';
const CASE = 'src-task-' + TASK, STEP = CASE + '-s1';
const SIGNAL_CASE = 'src-sig-consultations-consultation-followup-overdue', SIGNAL_STEP = SIGNAL_CASE + '-s1';
const flow = { service: { store: { state: { revision: 7, cases: {
  [CASE]: { id: CASE, taskKind: 'followup_due', closure: 'fact', factClosed: false, state: 'open', sourceKey: 'task:' + TASK,
    steps: [{ id: STEP, status: 'ready', assigneeIds: [ACTOR] }], entityRefs: [{ type: 'consultation', id: CONSULT, label: '상담 기록' }] },
  [SIGNAL_CASE]: { id: SIGNAL_CASE, signalId: 'consultation-followup-overdue', closure: 'fact', state: 'open',
    sourceKey: 'signal:consultations:consultation-followup-overdue', steps: [{ id: SIGNAL_STEP, status: 'ready', assigneeIds: [], queue: 'manager' }],
    entityRefs: [{ type: 'consultation', id: CONSULT, label: '상담 기록' }] },
} } }, source: { identity: { asOf: '2026-10-27' }, actors: [{ id: ACTOR, role: 'owner' }, { id: OTHER, role: 'staff' }] } } };
let done = false, calls = 0, refused = false, lastRaw;
const sql = (parts, ...values) => {
  const q = parts.join('?');
  if (q.includes('from public.staff_tasks')) return Promise.resolve([{ kind: 'followup_due', status: 'open', consultation_id: CONSULT }]);
  if (q.includes('from public.student_consultations')) {
    const row = { id: CONSULT, student_id: OTHER, due: '2026-10-26', done };
    return Promise.resolve(q.includes('any(') ? values[1].includes(CONSULT) ? [row] : [] : [row]);
  }
  throw Error('unexpected SQL: ' + q);
};
const open = async () => ({ begin: (_mode, fn) => fn(sql), end: async () => {} });
const v2ScreenRoute = { performWrite: async ({ id, name, raw, beforeRun, afterRun }) => {
  assert.deepEqual([id, name], ['consultations', 'toggleConsultationFollowUp']);
  await beforeRun({ sql }); calls++; lastRaw = raw;
  if (refused) await afterRun({ sql, result: { error: '거절' } });
  done = true; await afterRun({ sql, result: undefined });
} };
const card = createFlowCardConsultation({ flow, v2ScreenRoute, open });
const input = { caseId: CASE, stepId: STEP, recordRef: 'consultation:' + CONSULT, expectedRevision: 7, actorId: ACTOR };

assert.equal((await card.records(CASE)).records[0].recordRef, input.recordRef);
assert.equal((await card.records(SIGNAL_CASE)).records[0].recordRef, input.recordRef);
for (const bad of [{ ...input, actorId: OTHER }, { ...input, expectedRevision: 6 }, { ...input, recordRef: 'consultation:' + OTHER }]) await assert.rejects(card.save(bad));
assert.equal(calls, 0);
refused = true;
await assert.rejects(card.save(input), e => e.code === 'save_refused');
assert.equal(done, false);
refused = false;
assert.deepEqual(await card.save(input), { saved: true, recordRef: input.recordRef, message: '원본 반영 확인 중' });
assert.deepEqual(lastRaw, { module: 'features/consultations/server/actions.ts', actor: ACTOR, args: [null, { $formData: [['id', CONSULT], ['done', 'true']] }] });
await assert.rejects(card.save(input), e => e.code === 'source_changed');
assert.equal(calls, 2);
console.log('flow card consultation: 8 checks passed');
