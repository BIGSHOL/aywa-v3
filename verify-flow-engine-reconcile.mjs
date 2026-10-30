// Offline checks for source reconciliation (AX-H1·H4·H5): flow-reconcile.mjs + reloadSource. No DB, temp dirs only.
// Runs with verify-flow-engine.mjs (imported there) or alone: node --test experiments/owner-concept/verify-flow-engine-reconcile.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { IDS, fixtureSource, send, service } from './verify-flow-engine-fixture.mjs';
import { CLOSE_REASON, FACT_SIGNALS, SIGNAL_DONE_RULE } from './flow-rules.mjs';
import { SIGNAL_RECORD_TABLE, TYPE_OF_TABLE, deskCloseResult, groupDeskTasks, signalWiring } from './flow-source.mjs';
import { importV2 } from './v2-bridge.mjs';
import { newEvent, signalOwner } from './flow-engine.mjs';
import { emptyState } from './flow-store.mjs';
import { signalStepRefs } from './flow-hierarchy.mjs';
import { coveredRefs } from './flow-reconcile.mjs';
import { reconcileSource } from './flow-reconcile.mjs';

const SIG = 'src-sig-attendance-attendance-repeat-absence', BILL = 'src-sig-billing-billing-remaining';
const changed = s => s.created + s.updated + s.closed + s.reopened;
const stored = (svc, id) => svc.store.state.cases[id];
const eventsOf = (svc, id) => stored(svc, id).history.map(e => svc.store.state.events.find(x => x.id === e));
const typesOf = (svc, id) => eventsOf(svc, id).map(e => e.type);
const stepOf = (svc, id, who) => stored(svc, id).steps.find(s => !s.retired && s.assigneeIds.includes(who));

test('같은 원생·날짜의 결석 업무에서 같은 반 교시는 한 근거, 다른 반은 별개 근거', () => {
  const base = { kind: 'attendance_absent_desk', subject_id: 's1', status: 'open', assignees: [IDS.desk] };
  const tasks = [{ ...base, id: 'a', cycle: '2026-10-21|15:00' }, { ...base, id: 'b', cycle: '2026-10-21|15:40' }, { ...base, id: 'c', cycle: '2026-10-22|15:00' }];
  const days = new Map([['s1|2026-10-21', [{ id: 'r1', class_id: 'class-a', slot: '15:00', teacher_id: IDS.t1 }, { id: 'r2', class_id: 'class-a', slot: '15:40', teacher_id: IDS.t2 }, { id: 'r4', class_id: 'class-b', slot: '15:40', teacher_id: IDS.t2 }]], ['s1|2026-10-22', [{ id: 'r3', class_id: 'class-a', slot: '15:00', teacher_id: IDS.t2 }]]]);
  const grouped = groupDeskTasks(tasks, days, new Map([['student:s1', { label: '김수민' }]]), d => d.slice(5).replace('-', '/'));
  assert.equal(grouped.length, 2);
  assert.deepEqual([grouped[0].title, grouped[0].recordKeys, grouped[0].assignees, grouped[0].mergedTaskIds], ['김수민 · 10/21 결석 — 학부모 확인', ['attendance:r1', 'attendance:r4'], [IDS.desk], ['b']]);
  assert.deepEqual(grouped[1].recordKeys, ['attendance:r3']);
});

test('기존 중복 업무의 확인 상태·기록을 보존하고 묶음으로 닫는다', async () => {
  const { svc } = await service();
  await svc.reloadSource(sourceWith({ tasks: { 't-done': { status: 'open', closeReason: null, closedAt: null } } }));
  await send(svc, { actorId: IDS.desk, kind: 'case.ack', caseId: 'src-task-t-done' });
  const src = sourceWith({ dropTasks: ['t-done'], tasks: { 't-open': { title: '홍길동 · 10/24 결석 2교시 — 학부모 확인', recordKeys: ['attendance:a1', 'attendance:a2'], studentKey: 'student:s1', groupDate: '2026-10-24', actionTaskId: 't-open', mergedTaskIds: ['t-done'], assigneeIds: [IDS.t1] } } });
  await svc.reloadSource(src);
  const main = stored(svc, 'src-task-t-open'), duplicate = stored(svc, 'src-task-t-done');
  assert.deepEqual([main.state, main.entityRefs.map(r => r.type), main.studentRef.id, main.linkedCaseIds], ['working', ['attendance', 'attendance'], 's1', ['src-task-t-done']]);
  assert.deepEqual([duplicate.state, duplicate.closedReason, duplicate.evidence.length, duplicate.mergedInto], ['done', '묶음으로 합침', 0, main.id]);
  assert(eventsOf(svc, duplicate.id).some(e => e.type === 'step.acknowledged'));
  const rev = svc.view().revision;
  await svc.reloadSource(src);
  assert.equal(svc.view().revision, rev);
  await svc.close();
});

test('내부 결석 묶기 사건만 지우고 사람의 확인 사건·인과 연결은 보존한다', () => {
  const source = fixtureSource(), state = emptyState(source.identity);
  reconcileSource(state, source, { mode: 'seed' });
  const id = 'src-task-t-open', before = state.cases[id].history.at(-1);
  const grouped = newEvent(state, { caseId: id, type: 'source.task_changed', label: '같은 날 결석 교시를 한 업무로 합침', origin: 'snapshot', causeId: before });
  const renamed = newEvent(state, { caseId: id, type: 'source.task_changed', label: '원본 업무 내용이 바뀜(제목)', data: { fields: ['title'] }, origin: 'snapshot', causeId: grouped.id });
  const human = newEvent(state, { caseId: id, type: 'step.acknowledged', label: '확인함', origin: 'dev', actorId: IDS.desk, causeId: renamed.id });
  const first = reconcileSource(state, source, { mode: 'apply' });
  assert.equal(first.cleaned, 2);
  assert.ok(state.cases[id].history.includes(human.id));
  assert.ok(!state.cases[id].history.includes(grouped.id) && !state.cases[id].history.includes(renamed.id));
  assert.equal(state.events.find(e => e.id === human.id).causeId, before);
  const second = reconcileSource(state, source, { mode: 'apply' });
  assert.equal(second.cleaned, 0);
});
/** Fixture source with edits: tasks by id, extra absences {id, student, class, at:'start'|'end'}, dropped absences, signal list. */
function sourceWith({ tasks = {}, drop = [], add = [], dropTasks = [], signals, families } = {}) {
  const src = fixtureSource();
  src.tasks = src.tasks.filter(t => !dropTasks.includes(t.id)).map(t => ({ ...t, ...(tasks[t.id] || {}) }));
  for (const a of add) {
    src.entities.set(`attendance:${a.id}`, { type: 'attendance', id: a.id, label: `${a.id} 결석`, familyId: 'attendance', recordId: a.id, date: '2026-10-26', studentId: a.student, classId: a.class });
    src.relations.push({ id: `rel-x-${a.id}`, type: 'about_student', from: { type: 'attendance', id: a.id }, to: { type: 'student', id: a.student }, source: 'attendance_records.student_id' });
    src.relations.push({ id: `rel-y-${a.id}`, type: 'in_class', from: { type: 'attendance', id: a.id }, to: { type: 'class', id: a.class }, source: 'attendance_records.class_id' });
  }
  const sig = src.signals.find(s => s.signal.id === 'attendance-repeat-absence');
  const ids = [...add.filter(a => a.at === 'start').map(a => a.id), ...sig.signal.recordIds, ...add.filter(a => a.at !== 'start').map(a => a.id)].filter(id => !drop.includes(id));
  sig.signal = { ...sig.signal, recordIds: ids, title: `결석 3회 이상 재원생 ${ids.length}명` }; sig.refs = ids.map(id => `attendance:${id}`);
  if (signals) src.signals = src.signals.filter(s => signals.includes(s.signal.id));
  if (families) src.signalFamilies = families;
  return src;
}

test('tasks: source close → done with its time and reason; reopen → open; same source twice = no write', async () => {
  const { svc } = await service();
  const closedAt = '2026-10-26T03:00:00Z';
  let r = await svc.reloadSource(sourceWith({ tasks: { 't-open': { status: 'done', closeReason: 'desk_settled', closedAt } } }));
  assert.deepEqual([r.closed, r.created, r.reopened], [1, 0, 0]);
  let c = stored(svc, 'src-task-t-open');
  assert.deepEqual([c.state, c.factClosed, c.sourceStatus, c.closedReason, c.closedAt, c.steps[0].status], ['done', true, 'done', CLOSE_REASON.desk_settled, closedAt, 'done']);
  const ev = eventsOf(svc, 'src-task-t-open').at(-1);
  assert.deepEqual([ev.type, ev.origin, ev.at], ['source.task_closed', 'snapshot', closedAt], 'closing event = the source time, marked as a source fact');
  const rev = svc.view().revision, again = await svc.reloadSource(sourceWith({ tasks: { 't-open': { status: 'done', closeReason: 'desk_settled', closedAt } } }));
  assert.deepEqual([changed(again), svc.view().revision], [0, rev], 'idempotent: nothing written the second time');
  r = await svc.reloadSource(sourceWith({ tasks: { 't-done': { status: 'open', closeReason: null, closedAt: null } } }));
  assert.equal(r.reopened, 2, 't-open reopens (source open again) and t-done reopens');
  c = stored(svc, 'src-task-t-done');
  assert.deepEqual([c.state, c.factClosed, c.closedReason, c.steps[0].status, typesOf(svc, c.id).at(-1)], ['open', false, null, 'ready', 'source.task_reopened']);
  await svc.close();
});

test('데스크 할 일은 실제 저장 결과를 닫힘 사유로 보이고 결과 정정도 따라간다', async () => {
  const { svc } = await service();
  const closedAt = '2026-10-28T13:55:14Z';
  for (const result of ['기타', '연락 안 됨', '해당 없음']) {
    const closeResult = `데스크 확인 기록: ${result}`;
    await svc.reloadSource(sourceWith({ tasks: { 't-open': { status: 'done', closeReason: 'desk_settled', closeResult, closedAt } } }));
    const c = stored(svc, 'src-task-t-open');
    assert.equal(c.state, 'done');
    assert.equal(c.closedReason, closeResult);
    assert.doesNotMatch(c.closedReason, /학부모 확인을 마침/);
  }
  await svc.close();
});

test('데스크 결과 문구는 2.0 결과표를 따르고 같은 교시 기록을 우선한다', async () => {
  const { OUTCOME_LABEL } = await importV2('features/attendance/live/queue.ts');
  const row = (slot, state, outcome) => ({ slot, state, outcome });
  assert.equal(deskCloseResult('2026-10-28|09:00', [row('', 'resolved', 'other'), row('09:00', 'resolved', 'no_answer')], OUTCOME_LABEL), '데스크 확인 기록: 연락 안 됨');
  assert.equal(deskCloseResult('2026-10-28|', [row('', 'dismissed', null), row('09:00', 'resolved', 'other')], OUTCOME_LABEL), '데스크 확인 기록: 해당 없음');
  assert.equal(deskCloseResult('2026-10-28|', [row('09:00', 'resolved', 'other'), row('10:00', 'resolved', 'no_answer')], OUTCOME_LABEL), '데스크 확인 기록: 기타 · 연락 안 됨');
  assert.equal(deskCloseResult('2026-10-28|', [row('', 'resolved', 'unknown')], OUTCOME_LABEL), '데스크 조치 기록으로 처리됨');
});

test('tasks: source assignee follows unless a person reassigned or confirmed the step; a vanished task closes', async () => {
  const { svc } = await service();
  await send(svc, { actorId: IDS.desk, kind: 'case.ack', caseId: 'src-task-t-open' });
  await svc.reloadSource(sourceWith({ tasks: { 't-orphan': { assigneeIds: [IDS.t1] }, 't-open': { assigneeIds: [IDS.t2] } } }));
  const o = stored(svc, 'src-task-t-orphan').steps[0];
  assert.deepEqual([o.assigneeIds, o.queue, o.ruleSource, typesOf(svc, 'src-task-t-orphan').at(-1)], [[IDS.t1], null, 'staff_task_assignees.user_id', 'source.task_reassigned']);
  assert.deepEqual(stored(svc, 'src-task-t-open').steps[0].assigneeIds, [IDS.desk], 'a confirmed (ack) step keeps its person');
  await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: 'src-task-t-orphan', payload: { assigneeIds: [IDS.t2] } });
  await svc.reloadSource(sourceWith({ tasks: { 't-orphan': { assigneeIds: [IDS.manager] }, 't-open': { assigneeIds: [IDS.t2] } } }));
  assert.deepEqual(stored(svc, 'src-task-t-orphan').steps[0].assigneeIds, [IDS.t2], 'a manager\'s reassignment is not overwritten');
  const gone = await svc.reloadSource(sourceWith({ dropTasks: ['t-orphan'], tasks: { 't-open': { assigneeIds: [IDS.t2] } } }));
  assert.equal(gone.closed, 1); assert.deepEqual([stored(svc, 'src-task-t-orphan').factClosed, stored(svc, 'src-task-t-orphan').closedReason], [true, '학원 업무 목록에서 이 업무를 찾을 수 없음']);
  const empty = sourceWith(); empty.tasks = [];
  const none = await svc.reloadSource(empty);
  assert.equal(stored(svc, 'src-task-t-open').factClosed, false, 'an empty task list closes nothing');
  assert.equal(none.closed, 0);
  await svc.close();
});

test('signals: gone → cleared · back → reopened; a family that was not read closes nothing', async () => {
  const { svc } = await service();
  let r = await svc.reloadSource(sourceWith({ signals: ['attendance-repeat-absence'], families: ['attendance'] }));
  assert.equal(stored(svc, BILL).factClosed, undefined, 'billing family not read → not cleared'); assert.equal(r.closed, 0);
  r = await svc.reloadSource(sourceWith({ signals: ['attendance-repeat-absence'], families: ['attendance', 'billing'] }));
  let c = stored(svc, BILL);
  assert.deepEqual([r.closed, c.state, c.closedReason, c.steps[0].status, typesOf(svc, BILL).at(-1)], [1, 'done', '확인 대상에서 빠짐', 'done', 'source.signal_cleared']);
  r = await svc.reloadSource(fixtureSource());
  c = stored(svc, BILL);
  assert.deepEqual([r.reopened, c.state, c.factClosed, c.steps[0].status, typesOf(svc, BILL).at(-1)], [1, 'open', false, 'ready', 'source.signal_reopened']);
  await svc.close();
});

test('signals: records change → refs, steps per owner (renumbered in record order), retired owners, people kept, evidence follows', async () => {
  const { svc } = await service();
  const t2Step = stepOf(svc, SIG, IDS.t2).id;
  await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: SIG, payload: { stepId: t2Step, assigneeIds: [IDS.manager] } });
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '결석 사유 확인 중', outcome: 'needs_review' } });
  // A new c2 (t2) absence listed first: owner order becomes [t2, t1] → ids follow (the hierarchy numbers steps the same way).
  delete svc.store.state.cases[SIG].sourceRecords; // as stored before this change: counts only on the first re-read
  const r = await svc.reloadSource(sourceWith({ add: [{ id: 'a5', student: 's2', class: 'c2', at: 'start' }] }));
  let c = stored(svc, SIG);
  assert.equal(r.updated, 1);
  assert.deepEqual(c.steps.map(s => [s.id.slice(-2), s.assigneeIds[0], s.refs]), [['s1', IDS.manager, ['attendance:a5', 'attendance:a2']], ['s2', IDS.t1, ['attendance:a1']]], 'manager reassignment kept on the t2 records step');
  assert.equal(c.evidence[0].stepId, `${SIG}-s2`, 't1\'s report moved with t1\'s step');
  assert.deepEqual([c.entityTotal, c.title], [3, '결석 3회 이상 재원생 3명']);
  const ch = eventsOf(svc, SIG).at(-1);
  assert.deepEqual([ch.type, ch.data.from, ch.data.to, ch.data.added, ch.data.removed], ['source.signal_changed', 2, 3, undefined, undefined], 'first re-read of an old case reports counts only');
  const full = signalStepRefs(svc.source, c);
  assert.deepEqual([...full.keys()], [`${SIG}-s1`, `${SIG}-s2`]); assert.deepEqual(full.get(`${SIG}-s1`), ['attendance:a5', 'attendance:a2'], 'hierarchy step numbering agrees');
  // t1's records disappear → t1's step retires (kept for history, no refs); they come back → the same step returns.
  await svc.reloadSource(sourceWith({ add: [{ id: 'a5', student: 's2', class: 'c2', at: 'start' }], drop: ['a1'] }));
  c = stored(svc, SIG);
  const retired = c.steps.find(s => s.retired);
  assert.deepEqual([retired.id.slice(-2), retired.ownerKey, retired.refs, retired.status, c.evidence[0].stepId], ['r1', IDS.t1, [], 'done', retired.id]);
  assert.deepEqual(eventsOf(svc, SIG).at(-1).data, { from: 3, to: 2, added: 0, removed: 1, stepsAdded: 0, stepsRetired: 1 });
  await svc.reloadSource(sourceWith({ add: [{ id: 'a5', student: 's2', class: 'c2', at: 'start' }] }));
  c = stored(svc, SIG);
  assert.deepEqual([c.steps.filter(s => s.retired).length, stepOf(svc, SIG, IDS.t1).status, c.evidence[0].stepId], [0, 'ready', `${SIG}-s2`]);
  const view = svc.view().cases.find(x => x.id === SIG);
  assert(!('sourceRecords' in view), 'full record keys stay in the store');
  await svc.close();
});

test('AX-H4 fact signal: reports close it without touching records; only a new record (or a corrected report) reopens it', async () => {
  assert(FACT_SIGNALS['attendance-repeat-absence']);
  const { svc } = await service(), total = svc.view().casesTotal;
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '보호자 통화, 보강 안내', outcome: 'done' } });
  let c = stored(svc, SIG);
  assert.deepEqual([stepOf(svc, SIG, IDS.t1).status, stepOf(svc, SIG, IDS.t1).handled, c.state, svc.view().casesTotal], ['done', true, 'open', total], 'no separate follow-up case');
  await send(svc, { actorId: IDS.t2, kind: 'case.report', caseId: SIG, payload: { note: '연락 안 됨', outcome: 'unreachable' } });
  assert.equal(stored(svc, SIG).state, 'open', "'연락 안 됨' is not handled");
  await send(svc, { actorId: IDS.t2, kind: 'case.report', caseId: SIG, payload: { note: '해당 없음(전학 예정)', outcome: 'not_needed' } });
  c = stored(svc, SIG);
  assert.deepEqual([c.state, c.factClosed, c.closedBy, typesOf(svc, SIG).at(-1), c.linkedCaseIds.length], ['done', true, 'handled', 'source.signal_handled', 0]);
  assert.deepEqual(c.evidence.map(e => e.coveredRefs), [['attendance:a1'], ['attendance:a2'], ['attendance:a2']]);
  const rev = svc.view().revision;
  assert.equal(changed(await svc.reloadSource(fixtureSource())), 0); assert.equal(svc.view().revision, rev, 'same facts → stays closed, no write');
  // A record leaves (corrected to present): still handled.
  assert.equal(changed(await svc.reloadSource(sourceWith({ add: [{ id: 'a3', student: 's1', class: 'c1' }], drop: ['a3'] }))), 0);
  // A new absence in t1's class reopens only t1's part.
  let r = await svc.reloadSource(sourceWith({ add: [{ id: 'a3', student: 's1', class: 'c1' }] }));
  c = stored(svc, SIG);
  assert.deepEqual([r.reopened, c.state, stepOf(svc, SIG, IDS.t1).status, stepOf(svc, SIG, IDS.t2).status], [1, 'open', 'ready', 'done']);
  assert.deepEqual(typesOf(svc, SIG).slice(-2), ['source.signal_changed', 'source.signal_reopened']);
  assert.equal(eventsOf(svc, SIG).at(-1).origin, 'snapshot');
  // Narrowed report (the student) covers both of s1's records → closed again; a corrected report reopens; '해당 없음' closes.
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '새 결석도 통화', recordRefs: ['student:s1'] } });
  assert.deepEqual([stored(svc, SIG).state, stored(svc, SIG).evidence.at(-1).coveredRefs], ['done', ['attendance:a1', 'attendance:a3']]);
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '보강 일정 다시 확인 필요', recordRefs: ['attendance:a3'], outcome: 'needs_review' } });
  assert.deepEqual([stored(svc, SIG).state, typesOf(svc, SIG).at(-1)], ['open', 'source.signal_reopened'], 'a newer narrower report beats the older one');
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '보강 확정', recordRefs: ['attendance:a3'] } });
  assert.equal(stored(svc, SIG).state, 'done');
  const view = svc.view().cases.find(x => x.id === SIG);
  assert(view.evidence.every(e => !('coveredRefs' in e) && Number.isInteger(e.coveredCount)), 'view carries counts only');
  await svc.close();
});

test('미수 청구는 청구별 보고로 닫고 새 청구에만 다시 열린다', async () => {
  assert(FACT_SIGNALS['billing-remaining']);
  const bills = ids => {
    const src = fixtureSource(), sg = src.signals.find(s => s.signal.id === 'billing-remaining');
    for (const id of ids.filter(id => id !== 'i1')) {
      src.entities.set(`invoice:${id}`, { type: 'invoice', id, label: `${id} 미수 청구`, familyId: 'billing', recordId: id, remaining: 20000 });
      src.relations.push({ id: `rel-${id}`, type: 'billed_to', from: { type: 'invoice', id }, to: { type: 'student', id: 's2' }, source: 'invoices.student_id' });
    }
    sg.signal.recordIds = ids; sg.refs = ids.map(id => `invoice:${id}`);
    return src;
  };
  const original = bills(['i1', 'i2']), beforeSource = JSON.stringify(original.signals.find(s => s.signal.id === 'billing-remaining'));
  const { svc } = await service({ source: original });
  assert.equal(svc.view().cases.find(c => c.id === BILL).factSignal, true);
  const legacy = structuredClone(svc.store.state); legacy.cases[BILL].doneRule = SIGNAL_DONE_RULE;
  assert.equal(reconcileSource(legacy, original, { mode: 'seed' }).updated, 1, 'restart seed migrates the old closure rule');
  assert.equal(legacy.cases[BILL].doneRule, FACT_SIGNALS['billing-remaining'].doneRule);
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: BILL, payload: { note: '첫 청구 학부모 안내', outcome: 'done', recordRefs: ['invoice:i1'] } });
  assert.deepEqual([stored(svc, BILL).state, stored(svc, BILL).evidence.at(-1).coveredRefs], ['open', ['invoice:i1']]);
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: BILL, payload: { note: '둘째 청구 확인 중', outcome: 'needs_review', recordRefs: ['invoice:i2'] } });
  assert.equal(stored(svc, BILL).state, 'open', '검토 필요는 처리 완료가 아니다');
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: BILL, payload: { note: '둘째 청구 학부모 안내', outcome: 'done', recordRefs: ['invoice:i2'] } });
  assert.deepEqual([stored(svc, BILL).state, stored(svc, BILL).closedBy, stored(svc, BILL).linkedCaseIds.length], ['done', 'handled', 0]);
  assert.equal(JSON.stringify(original.signals.find(s => s.signal.id === 'billing-remaining')), beforeSource, '보고가 청구 원본을 바꾸지 않는다');
  assert.equal(changed(await svc.reloadSource(bills(['i1', 'i2']))), 0, '같은 근거는 다시 열지 않는다');
  const added = await svc.reloadSource(bills(['i1', 'i2', 'i3']));
  assert.deepEqual([added.reopened, stored(svc, BILL).state, stored(svc, BILL).sourceRecords.length], [1, 'open', 3]);
  assert.equal(stored(svc, BILL).evidence.length, 3, '앞선 보고는 유지한다');
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: BILL, payload: { note: '새 청구 학부모 안내', outcome: 'done', recordRefs: ['invoice:i3'] } });
  assert.equal(stored(svc, BILL).state, 'done');
  await svc.close();
});

test('메이크에듀 실패 신호는 일부 처리 뒤 열리고 전부 처리 뒤 닫히며 새 실패로 다시 열린다', async () => {
  const makeSource = ids => {
    const src = fixtureSource();
    for (const id of ids) src.entities.set(`sync_run:${id}`, { type: 'sync_run', id, label: `동기화 실패 ${id}`, familyId: 'integrations', recordId: id });
    src.signals.push({ familyId: 'integrations', signal: { id: 'makeedu-sync-problem', title: `메이크에듀 동기화 실패 ${ids.length}건`, summary: '최근 실패 기록', priority: '확인 필요', source: '메이크에듀 실행 기록', recordIds: ids, draft: { title: '연동 확인', body: '실행 기록을 확인해 주세요.' } }, refs: ids.map(id => `sync_run:${id}`) });
    return src;
  };
  const first = makeSource(['sync1', 'sync2']);
  const { svc } = await service({ source: first });
  const id = 'src-sig-integrations-makeedu-sync-problem', original = JSON.stringify(first.signals.at(-1));
  assert.equal(stored(svc, id).state, 'open');
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: id, payload: { note: '첫 실행 확인', outcome: 'done', recordRefs: ['sync_run:sync1'] } });
  assert.equal(stored(svc, id).state, 'open', '한 근거만 처리하면 열린 상태');
  assert.equal(stored(svc, id).evidence.at(-1).coveredRefs.length, 1);
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: id, payload: { note: '둘째 실행은 조치 불필요', outcome: 'not_needed', recordRefs: ['sync_run:sync2'] } });
  assert.deepEqual([stored(svc, id).state, stored(svc, id).closedBy], ['done', 'handled']);
  assert.equal(JSON.stringify(first.signals.at(-1)), original, '보고는 실패 원본을 바꾸지 않는다');
  const reopened = await svc.reloadSource(makeSource(['sync1', 'sync2', 'sync3']));
  assert.equal(reopened.reopened, 1);
  assert.deepEqual([stored(svc, id).state, stored(svc, id).factClosed, stored(svc, id).sourceRecords.length], ['open', false, 3]);
  assert.equal(stored(svc, id).evidence.length, 2, '이전 보고는 그대로 남는다');
  await svc.close();
});

test('AX-H4 guards: a ref of another step covers nothing; a cleared fact case takes no report and keeps its state', async () => {
  const src = fixtureSource();
  assert.deepEqual(coveredRefs(src, ['attendance:a1'], [{ type: 'attendance', id: 'a2' }]), [], 'another step\'s record never widens to the whole step');
  assert.deepEqual(coveredRefs(src, ['attendance:a1'], [{ type: 'staff', id: IDS.t1 }]), ['attendance:a1'], 'a non-narrowing ref = the whole step (hierarchy step scope)');
  assert.deepEqual(coveredRefs(src, ['attendance:a1', 'attendance:a2'], [{ type: 'class', id: 'c2' }]), ['attendance:a2']);
  const { svc } = await service();
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '통화 완료' } });
  await svc.reloadSource(sourceWith({ signals: ['billing-remaining'], families: ['attendance', 'billing'] }));
  const before = JSON.stringify(stored(svc, SIG));
  assert.deepEqual([stored(svc, SIG).state, stored(svc, SIG).closedBy], ['done', 'source']);
  await assert.rejects(send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: SIG, payload: { note: '다시 보고', outcome: 'needs_review' } }), e => e.status === 409 && e.code === 'step_not_ready');
  assert.equal(JSON.stringify(stored(svc, SIG)), before);
  // Back with the same records: t1's part stays handled, t2's part is open again.
  await svc.reloadSource(fixtureSource());
  assert.deepEqual([stored(svc, SIG).state, stepOf(svc, SIG, IDS.t1).status, stepOf(svc, SIG, IDS.t2).status, typesOf(svc, SIG).at(-1)], ['open', 'done', 'ready', 'source.signal_reopened']);
  await svc.close();
});

test('reloadSource contract: refuses another copy; the store folder never moves; restart re-judges the same way', async () => {
  const { svc, dir } = await service();
  const other = fixtureSource(); other.identity = { ...other.identity, capturedAt: '2026-11-01T00:00:00.000Z' };
  await assert.rejects(svc.reloadSource(other), e => e.code === 'flow_state_mismatch');
  const r = await svc.reloadSource(sourceWith({ tasks: { 't-open': { status: 'cancelled', closeReason: 'not_absent', closedAt: '2026-10-26T01:00:00Z' } } }));
  assert.deepEqual(Object.keys(r).sort(), ['applied', 'changes', 'cleaned', 'closed', 'created', 'reopened', 'revision', 'unchanged', 'updated']); assert.equal(r.applied, true);
  assert.deepEqual(r.changes.map(x => [x.caseId, x.outcome, x.events]), [['src-task-t-open', 'closed', ['source.task_closed']]]);
  assert.equal(svc.store.dir, dir); assert.deepEqual((await readdir(dir)).filter(n => n.endsWith('.json')), ['state.json']);
  await svc.close();
  // Restarting on the original source (as the server does) re-judges stored cases: the cancelled task reopens.
  const back = await service({ dir });
  assert.deepEqual([back.svc.reconciled.reopened, stored(back.svc, 'src-task-t-open').state], [1, 'open']);
  await back.svc.close();
});

test('switch: without OWNER_CONCEPT_FLOW_RECONCILE=apply only new cases are written; re-judging is a preview, reload writes nothing', async () => {
  const closedAt = '2026-10-26T03:00:00Z', closing = sourceWith({ tasks: { 't-open': { status: 'done', closeReason: 'desk_settled', closedAt } } });
  const first = await service({ reconcile: 'seed' });
  assert.deepEqual([first.svc.seeded, first.svc.reconcileApplied], [5, false], 'a fresh store is seeded as before');
  const rev = first.svc.view().revision, before = JSON.stringify(first.svc.store.state);
  const r = await first.svc.reloadSource(closing);
  assert.deepEqual([r.applied, r.closed, r.revision, JSON.stringify(first.svc.store.state) === before, first.svc.source.tasks.find(t => t.id === 't-open').status], [false, 1, rev, true, 'open'], 'preview only: no write, source kept');
  assert.equal(first.svc.reconcilePreview.closed, 1);
  await first.svc.close();
  const back = await service({ dir: first.dir, source: closing, reconcile: 'seed' });
  assert.deepEqual([back.svc.seeded, stored(back.svc, 'src-task-t-open').state, back.svc.reconcilePreview.closed, back.svc.view().revision], [0, 'open', 1, rev], 'restart without apply: stored cases untouched, preview says what would close');
  await back.svc.close();
  const env = await service({ dir: first.dir, source: closing, reconcile: null }); // null = read OWNER_CONCEPT_FLOW_RECONCILE (unset here)
  assert.equal(stored(env.svc, 'src-task-t-open').state, 'open', 'no option + no env = not applied');
  await env.svc.close();
});

test('AX-H5 wiring: every snapshot signal names its record table; gaps are reported, not hidden; owners per record type', async () => {
  const declared = new Set();
  for (const f of (await readdir(new URL('.', import.meta.url))).filter(n => /^domain-snapshot-.*\.mjs$/.test(n))) for (const m of (await readFile(new URL(f, import.meta.url), 'utf8')).matchAll(/signal\(\{ id: '([a-z0-9-]+)'/g)) declared.add(m[1]);
  declared.delete('tasks-overdue'); // the open staff_tasks themselves are source cases
  for (const id of declared) { assert(SIGNAL_RECORD_TABLE[id], `${id} has a record table`); assert(TYPE_OF_TABLE[SIGNAL_RECORD_TABLE[id]], `${id} table is an ontology type`); }
  assert.equal(SIGNAL_RECORD_TABLE['satisfaction-pending'], 'teacher_satisfaction_judgments', 'the second table of 직원 평가, not the first');
  const sig = (id, recordIds, refs, table = SIGNAL_RECORD_TABLE[id]) => ({ familyId: 'x', signal: { id, recordIds }, table, refs });
  assert.deepEqual(signalWiring([sig('a', ['1', '2'], ['t:1', 't:2'], 'invoices'), sig('b', ['1', '2'], ['t:1'], 'invoices'), sig('c', ['1'], [], 'invoices'), sig('d', ['1'], [], null), sig('sheet-sync-error', [], [])]).map(w => w.status), ['ok', 'partial', 'unlinked', 'unwired', 'no_record_ids']);
  const src = fixtureSource();
  src.entities.set('satisfaction:j1', { type: 'satisfaction', id: 'j1', label: '홍길동 · 10/20 학부모 글', familyId: 'class-review', recordId: 'j1', classId: 'c1' });
  src.entities.set('makeup:m1', { type: 'makeup', id: 'm1', label: '홍길동 · 10/28 보강 예약', familyId: 'makeups', recordId: 'm1', classId: 'c2' });
  assert.deepEqual([signalOwner(src, 'satisfaction:j1').queue, signalOwner(src, 'satisfaction:j1').assigneeIds], ['manager', []], 'a teacher is not sent their own evaluation');
  assert.deepEqual(signalOwner(src, 'makeup:m1').assigneeIds, [IDS.t2], 'makeup → that class teacher');
  // A signal whose records are not linked shows the gap on its step instead of a vague reason.
  src.signals.push({ familyId: 'class-review', signal: { id: 'satisfaction-pending', title: '만족도 확인 대기 1건', summary: 's', priority: '확인 필요', source: '강사평가', recordIds: ['j1'], draft: { title: 't', body: 'b' } }, table: 'teacher_satisfaction_judgments', refs: ['satisfaction:j1'] });
  src.signals.push({ familyId: 'integrations', signal: { id: 'sheet-sync-error', title: '연동 오류', summary: 's', priority: '확인 필요', source: '연동', recordIds: [], draft: { title: 't', body: 'b' } }, table: 'user_integrations', refs: [] });
  const { svc } = await service({ source: src });
  const sat = stored(svc, 'src-sig-class-review-satisfaction-pending'), sheet = stored(svc, 'src-sig-integrations-sheet-sync-error');
  assert.deepEqual([sat.entityRefs.map(r => r.id), sat.steps[0].refs], [['j1'], ['satisfaction:j1']], 'judgment records attached to the case');
  assert.equal(sheet.steps[0].unassignedReason, '이 신호에는 이어 줄 근거 기록이 없어 관리자 대기열', 'the gap is named on the step (no developer wording)');
  assert.deepEqual(signalWiring(src.signals.filter(s => s.table)).filter(w => w.status !== 'ok').map(w => [w.signalId, w.label]), [['sheet-sync-error', '근거 기록 번호 없음(배선 누락)']], 'the check names it a wiring gap');
  await svc.close();
});

