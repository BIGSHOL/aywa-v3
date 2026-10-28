// Offline checks for the flow engine (no DB, no network, temp dirs only).
// Run: node --test experiments/owner-concept/verify-flow-engine.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { IDS, fixtureSource, gatedAI, send, service } from './verify-flow-engine-fixture.mjs';
import { openStore, emptyState, namespaceDir } from './flow-store.mjs';
import { buildContext, createFlowAI, pseudonymize } from './flow-decision.mjs';
import { decisionView } from './flow-view.mjs';
import { validateContext } from './decision-questions.mjs';
import { createFlowRoute } from './flow-http.mjs';
import { CLOSE_REASON, TASK_KINDS } from './flow-rules.mjs';

const fails = async (p, status, code) => { await assert.rejects(p, e => e.status === status && e.code === code, `${status} ${code}`); };
const caseOf = (svc, id) => svc.view().cases.find(c => c.id === id);
const stepOf = (c, key) => c.steps.find(s => s.key === key);

test('seeds every source task 1:1 with real assignees, fact closures and queue fallback — once', async () => {
  const { svc, dir } = await service();
  let v = svc.view();
  assert.equal(svc.seeded, 5); assert.equal(v.casesTotal, 5);
  const open = caseOf(svc, 'src-task-t-open'), done = caseOf(svc, 'src-task-t-done'), orphan = caseOf(svc, 'src-task-t-orphan');
  assert.deepEqual([open.state, open.closure, open.origin, open.steps[0].assigneeIds], ['open', 'fact', 'snapshot', [IDS.desk]]);
  assert.deepEqual([done.state, done.factClosed, done.closedReason], ['done', true, CLOSE_REASON.desk_settled]);
  assert.equal(open.doneRule, TASK_KINDS.attendance_absent_desk.doneRule);
  assert.deepEqual([orphan.steps[0].assigneeIds, orphan.steps[0].queue], [[], 'manager'], 'assignee outside the actor list goes to the manager queue');
  assert.match(orphan.steps[0].unassignedReason, /관리자 대기열/);
  const sig = caseOf(svc, 'src-sig-attendance-attendance-repeat-absence');
  assert.deepEqual(sig.steps.map(s => s.assigneeIds).sort(), [[IDS.t1], [IDS.t2]], 'signal records are split by their FK owner (homeroom)');
  assert.equal(caseOf(svc, 'src-sig-billing-billing-remaining').steps[0].queue, 'manager', 'no accountant role → manager queue');
  assert(v.events.every(e => e.origin === 'snapshot'));
  assert.equal(v.metrics.managerQueue, 2); assert.equal(v.metrics.cases.snapshot.done, 1);
  await svc.close();
  const again = await service({ dir });
  assert.equal(again.svc.seeded, 0); assert.equal(again.svc.view().casesTotal, 5); assert.equal(again.svc.view().eventsTotal, v.eventsTotal);
  await again.svc.close();
});

test('absence: teacher event → desk contact → manager review (AI unavailable) → homeroom follow-up → closed, with a cause chain', async () => {
  const calls = [], { svc } = await service({ calls });
  const r = await send(svc, { actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  let c = caseOf(svc, r.caseId);
  assert.equal(c.scenarioKey, 'attendance:a1', 'teacher gets their own class absence');
  assert.deepEqual([stepOf(c, 'desk_contact').status, stepOf(c, 'desk_contact').assigneeIds], ['ready', [IDS.desk]]);
  assert.equal(c.decision.status, 'unavailable'); assert.equal(calls.length, 1, 'AI called once for the new event');
  await fails(send(svc, { actorId: IDS.t2, kind: 'case.report', caseId: c.id, payload: { note: '확인' } }), 403, 'not_assignee');
  await fails(send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: c.id, payload: { note: '' } }), 400, 'evidence_required');
  await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: c.id, payload: { note: '어머니 010-2222-3333 통화, 감기', outcome: 'done' } });
  c = caseOf(svc, c.id);
  assert.equal(c.state, 'review'); assert.equal(stepOf(c, 'manager_review').status, 'ready'); assert(!c.evidence[0].note.includes('010-2222-3333'));
  await fails(send(svc, { actorId: IDS.t1, kind: 'case.review', caseId: c.id, payload: { decision: 'accept' } }), 403, 'action_not_allowed');
  await send(svc, { actorId: IDS.manager, kind: 'case.review', caseId: c.id, payload: { decision: 'accept' } });
  c = caseOf(svc, c.id);
  assert.deepEqual(stepOf(c, 'teacher_followup').assigneeIds, [IDS.t1]);
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: c.id, payload: { note: '보강 일정 안내' } });
  c = caseOf(svc, c.id); const v = svc.view();
  assert.equal(c.state, 'done');
  const evs = c.history.map(id => v.events.find(e => e.id === id));
  assert.deepEqual(evs.map(e => e.type), ['absence.reported', 'decision.requested', 'step.routed', 'decision.recorded', 'step.reported', 'step.routed', 'step.reviewed', 'step.routed', 'step.reported', 'case.closed']);
  const routed = evs.find(e => e.type === 'step.routed');
  assert.deepEqual([routed.data.rule, routed.data.ruleSource], ['기존 결석 확인 담당(출결 알림을 켠 직원)', 'users.attendance_alert_optin'], 'why-assigned copy is business wording; provenance is a separate field');
  assert.deepEqual([stepOf(c, 'teacher_followup').rule, stepOf(c, 'teacher_followup').ruleSource], ['해당 반의 담당 강사', 'classes.teacher_id']);
  for (const x of svc.view().cases) for (const s of x.steps) assert(!/[a-z_]+\.[a-z_]+/.test(s.rule || ''), `rule copy has no table.column: ${s.rule}`);
  for (const e of evs.slice(1)) assert(e.causeId && c.history.includes(e.causeId), `${e.type} has a cause inside the case`);
  assert(evs.every(e => e.origin === 'dev'));
  assert.equal(v.metrics.cases.dev.done, 1); assert.equal(v.metrics.cases.snapshot.total, 5, 'dev work counted apart from copied facts');
  await svc.close();
});

test('confident AI skips the optional review; billing always gets a person', async () => {
  const { svc } = await service({ mode: 'auto' });
  const a = await send(svc, { actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: a.caseId, payload: { note: '통화 완료' } });
  const c = caseOf(svc, a.caseId);
  assert.equal(stepOf(c, 'manager_review').skipped, true); assert.equal(c.priority, 'high'); assert.equal(stepOf(c, 'teacher_followup').status, 'ready');
  const b = await send(svc, { actorId: IDS.manager, kind: 'event.simulate', payload: { scenario: 'billing' } });
  const bc = caseOf(svc, b.caseId);
  assert.deepEqual([stepOf(bc, 'staff_check').queue, stepOf(bc, 'decision').review], ['manager', true]);
  await send(svc, { actorId: IDS.manager, kind: 'case.ack', caseId: bc.id }); // manager claims the queue step
  assert.deepEqual(stepOf(caseOf(svc, bc.id), 'staff_check').assigneeIds, [IDS.manager]);
  await send(svc, { actorId: IDS.manager, kind: 'case.report', caseId: bc.id, payload: { note: '입금 내역 대조 완료' } });
  await send(svc, { actorId: IDS.owner, kind: 'case.review', caseId: bc.id, payload: { decision: 'accept', note: '안내 보류' } });
  assert.equal(caseOf(svc, bc.id).state, 'done');
  await svc.close();
});

test('AI failure keeps the work visible with a review reason (no fake judgment)', async () => {
  const { svc } = await service({ mode: 'throws' });
  const r = await send(svc, { actorId: IDS.t2, kind: 'event.simulate', payload: { scenario: 'consultation' } });
  const c = caseOf(svc, r.caseId);
  assert.deepEqual([c.decision.status, c.decision.reason, c.decision.codes, c.decision.probabilities, c.flags.needsReview], ['error', '자동 판정을 받지 못함', ['decision_call_failed'], null, true]);
  assert.deepEqual(stepOf(c, 'counselor_followup').assigneeIds, [IDS.t2], 'routing is code: the counselor of that consultation');
  await send(svc, { actorId: IDS.t2, kind: 'case.report', caseId: c.id, payload: { note: '학부모 통화' } });
  assert.equal(stepOf(caseOf(svc, c.id), 'manager_review').status, 'ready', 'a failed judgment forces the review step');
  const a = await send(svc, { actorId: IDS.manager, kind: 'case.analyze', caseId: c.id });
  assert.equal(caseOf(svc, a.caseId).decision.status, 'error');
  await svc.close();
});

test('slow AI runs outside the write queue: other staff actions commit meanwhile; the judgment settles later', async () => {
  const ai = gatedAI('auto'), { svc } = await service({ ai, waitMs: 20 });
  const sim = await send(svc, { actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  assert.equal(sim.decision, 'pending', 'response does not wait for a slow judgment');
  let c = caseOf(svc, sim.caseId);
  assert.deepEqual([c.decision.status, c.decisionPending, stepOf(c, 'desk_contact').status], ['pending', true, 'ready'], 'work is routed before the judgment');
  // Unrelated work commits while the judgment is still out.
  const rev = svc.view().revision;
  const f = await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: 'src-task-t-open', payload: { note: '학부모 확인' } });
  await send(svc, { actorId: IDS.manager, kind: 'case.ack', caseId: 'src-sig-billing-billing-remaining' });
  assert.equal(svc.view().revision, rev + 2); assert(f.caseId.startsWith('loc-'));
  const again = await send(svc, { actorId: IDS.manager, kind: 'case.analyze', caseId: sim.caseId });
  assert.deepEqual([again.duplicate, again.decision, again.revision], [true, 'pending', rev + 2], 'no second judgment while one is running');
  // The desk finishes before the judgment: the conservative default already routed the review.
  await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: sim.caseId, payload: { note: '통화 완료' } });
  ai.release(); await svc.settled();
  c = caseOf(svc, sim.caseId);
  assert.deepEqual([c.decision.status, c.decisionPending, ai.calls.length], ['ok', false, 1]);
  assert.equal(stepOf(c, 'manager_review').status, 'ready', 'a late confident judgment does not undo a routed review');
  const rec = svc.view().events.find(e => e.caseId === c.id && e.type === 'decision.recorded');
  assert.equal(rec.data.applied, false);
  assert.equal(svc.view().events.find(e => e.id === rec.causeId).type, 'decision.requested');
  const [simId] = Object.entries(svc.store.state.commands).find(([, e]) => e.result.caseId === sim.caseId && e.result.decision);
  const replay = await svc.command({ commandId: simId, expectedRevision: 0, actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  assert.deepEqual([replay.replayed, replay.decision, replay.eventIds.length > sim.eventIds.length], [true, 'ok', true], 'replay returns the settled result');
  // A judgment that arrives first relaxes the optional review.
  const b = await send(svc, { actorId: IDS.t2, kind: 'event.simulate', payload: { scenario: 'absence', recordRef: 'a2' } });
  ai.release(); await svc.settled();
  await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: b.caseId, payload: { note: '통화 완료' } });
  assert.equal(stepOf(caseOf(svc, b.caseId), 'manager_review').skipped, true);
  await svc.close();
});

test('a judgment pending at shutdown is recorded as interrupted on restart (no AI call on start)', async () => {
  const ai = gatedAI('auto'), { svc, dir } = await service({ ai, waitMs: 10 });
  const sim = await send(svc, { actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  await svc.close(); // the provider never answered
  const back = await service({ dir, mode: 'auto' });
  const c = caseOf(back.svc, sim.caseId);
  assert.equal(back.svc.interrupted, 1);
  assert.deepEqual([c.decision.status, c.decision.codes, c.flags.needsReview], ['error', ['decision_interrupted'], true]);
  const a = await send(back.svc, { actorId: IDS.manager, kind: 'case.analyze', caseId: sim.caseId });
  assert.equal(a.decision, 'ok', 'an explicit analyze can judge it again');
  ai.release(); await back.svc.close();
});

test('owner multi-assignee request: each person reports, manager reviews; return and reopen are recorded', async () => {
  const { svc } = await service();
  await fails(send(svc, { actorId: IDS.t1, kind: 'request.create', payload: { title: 'x', body: 'y', assigneeIds: [IDS.t2] } }), 403, 'action_not_allowed');
  await fails(send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { title: 'x', body: 'y', assigneeIds: [IDS.desk] } }), 400, 'assignee_not_allowed');
  await fails(send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { title: 'x', body: 'y', assigneeIds: ['preview-owner'] } }), 400, 'assignee_not_allowed');
  const r = await send(svc, { actorId: IDS.owner, kind: 'request.create', payload: { title: '교재 재고 확인', body: '다음 주 교재', assigneeIds: [IDS.t1, IDS.t2], recordRefs: ['class:c1'], channels: ['app', 'slack'], source: { kind: 'issue', issueIds: ['books'] } } });
  let c = caseOf(svc, r.caseId);
  assert.deepEqual(c.steps.filter(s => s.status === 'ready').map(s => s.assigneeIds[0]).sort(), [IDS.t1, IDS.t2].sort());
  await send(svc, { actorId: IDS.t1, kind: 'case.report', caseId: c.id, payload: { note: '확인 완료' } });
  assert.equal(caseOf(svc, c.id).state, 'working', 'review waits for every assignee');
  await send(svc, { actorId: IDS.t2, kind: 'case.report', caseId: c.id, payload: { note: '2권 부족' } });
  assert.equal(caseOf(svc, c.id).state, 'review');
  await fails(send(svc, { actorId: IDS.manager, kind: 'case.review', caseId: c.id, payload: { decision: 'return' } }), 400, 'evidence_required');
  await send(svc, { actorId: IDS.manager, kind: 'case.review', caseId: c.id, payload: { decision: 'return', note: '수량을 적어 주세요' } });
  c = caseOf(svc, c.id); assert.equal(c.steps.filter(s => s.status === 'ready').length, 2);
  for (const who of [IDS.t1, IDS.t2]) await send(svc, { actorId: who, kind: 'case.report', caseId: c.id, payload: { note: '수량 기재' } });
  await send(svc, { actorId: IDS.manager, kind: 'case.review', caseId: c.id, payload: { decision: 'accept' } });
  assert.equal(caseOf(svc, c.id).state, 'done');
  await send(svc, { actorId: IDS.owner, kind: 'case.reopen', caseId: c.id, payload: { note: '추가 확인' } });
  c = caseOf(svc, c.id); assert.equal(c.state, 'review');
  const types = svc.view().events.filter(e => e.caseId === c.id).map(e => e.type);
  for (const t of ['request.created', 'step.returned', 'case.closed', 'case.reopened']) assert(types.includes(t), t);
  await svc.close();
});

test('fact cases never close locally; reports become linked local follow-ups', async () => {
  const { svc } = await service();
  await fails(send(svc, { actorId: IDS.manager, kind: 'case.review', caseId: 'src-task-t-open', payload: { decision: 'accept' } }), 409, 'fact_case');
  const r = await send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: 'src-task-t-open', payload: { note: '학부모 확인', recordRefs: ['student:s1'] } });
  const src = caseOf(svc, 'src-task-t-open'), f = caseOf(svc, r.caseId);
  assert.equal(src.state, 'open'); assert.deepEqual(src.linkedCaseIds, [f.id]);
  assert.deepEqual([f.kind, f.state, f.closure, f.origin], ['request', 'done', 'manual', 'dev']);
  await fails(send(svc, { actorId: IDS.desk, kind: 'case.report', caseId: 'src-task-t-open', payload: { note: '근거', recordRefs: ['invoice:zzz'] } }), 400, 'record_ref_not_allowed');
  await fails(send(svc, { actorId: IDS.manager, kind: 'case.reopen', caseId: 'src-task-t-done', payload: { note: '다시' } }), 409, 'fact_case');
  await fails(send(svc, { actorId: IDS.t1, kind: 'case.ack', caseId: 'src-task-t-orphan' }), 403, 'not_assignee');
  await send(svc, { actorId: IDS.manager, kind: 'case.reassign', caseId: 'src-task-t-orphan', payload: { assigneeIds: [IDS.t1] } });
  assert.deepEqual(caseOf(svc, 'src-task-t-orphan').steps[0].assigneeIds, [IDS.t1], 'manager routes the queue item');
  await svc.close();
});

test('idempotent commands, revision conflicts, duplicate events and restart persistence', async () => {
  const { svc, dir } = await service();
  const body = { commandId: 'cmd-fixed-0001', expectedRevision: svc.view().revision, actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } };
  const first = await svc.command(body), events = svc.view().eventsTotal;
  const replay = await svc.command(body);
  assert.deepEqual([replay.replayed, replay.caseId, svc.view().eventsTotal], [true, first.caseId, events]);
  await fails(svc.command({ ...body, payload: { scenario: 'billing' } }), 409, 'command_conflict');
  await fails(svc.command({ ...body, commandId: 'cmd-stale-0001', expectedRevision: 0 }), 409, 'revision_conflict');
  const dup = await send(svc, { actorId: IDS.manager, kind: 'event.simulate', payload: { scenario: 'absence', recordRef: 'a1' } });
  assert.deepEqual([dup.duplicate, dup.caseId, dup.revision], [true, first.caseId, first.revision], 'same open event → same case, no new task');
  await fails(send(svc, { actorId: IDS.manager, kind: 'event.simulate', payload: { scenario: 'absence', recordRef: 'zz-not-real' } }), 400, 'record_ref_not_allowed');
  const rev = svc.view().revision, total = svc.view().casesTotal;
  await svc.close();
  const back = await service({ dir });
  assert.deepEqual([back.svc.view().revision, back.svc.view().casesTotal, back.svc.seeded], [rev, total, 0]);
  assert.equal((await back.svc.command(body)).replayed, true, 'command log survives restart');
  await back.svc.close();
});

test('store refuses another tenant/snapshot/schema, a live lock, and keeps state on failed commands', async () => {
  const src = fixtureSource(), dir = await mkdtemp(join(tmpdir(), 'flow-store-'));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ ...emptyState(src.identity), tenantId: 'other' }));
  await assert.rejects(openStore({ dir, identity: src.identity, lock: false }), e => e.code === 'flow_state_mismatch');
  await writeFile(join(dir, 'state.json'), JSON.stringify({ ...emptyState(src.identity), schemaVersion: 99 }));
  await assert.rejects(openStore({ dir, identity: src.identity, lock: false }), e => e.code === 'flow_state_mismatch');
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).schemaVersion, 99, 'nothing reset or deleted');
  const dir2 = await mkdtemp(join(tmpdir(), 'flow-lock-'));
  await writeFile(join(dir2, 'state.lock'), String(process.ppid));
  await assert.rejects(openStore({ dir: dir2, identity: src.identity }), e => e.code === 'store_locked');
  const store = await openStore({ dir: await mkdtemp(join(tmpdir(), 'flow-tx-')), identity: src.identity, lock: false });
  await assert.rejects(store.transact(async d => { d.revision = 5; throw new Error('mid-command failure'); }));
  assert.equal(store.state.revision, 0, 'failure does not advance');
});

test('lock: exclusive per store, stale lock recovered, failed open leaves no lock, close waits for the pending write', async () => {
  const src = fixtureSource(), dir = await mkdtemp(join(tmpdir(), 'flow-lock2-')), lockFile = join(dir, 'state.lock');
  const opened = await Promise.allSettled([openStore({ dir, identity: src.identity }), openStore({ dir, identity: src.identity })]);
  assert.deepEqual(opened.map(o => o.status).sort(), ['fulfilled', 'rejected'], 'two opens at once: exactly one wins');
  assert.equal(opened.find(o => o.status === 'rejected').reason.code, 'store_locked');
  const a = opened.find(o => o.status === 'fulfilled').value;
  const write = a.transact(async d => { await new Promise(r => setTimeout(r, 30)); d.revision = 7; return { next: d, result: 'ok' }; });
  await a.close();
  assert.equal(await write, 'ok');
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).revision, 7, 'close waited for the write');
  await assert.rejects(readFile(lockFile), e => e.code === 'ENOENT', 'own lock released');
  await assert.rejects(a.transact(async d => ({ next: d, result: 1 })), e => e.code === 'store_closed');
  await writeFile(lockFile, '');
  await assert.rejects(openStore({ dir, identity: src.identity }), e => e.code === 'store_locked', 'a fresh empty lock = another opener mid-create');
  await writeFile(lockFile, '999999999:dead-token');
  const b = await openStore({ dir, identity: src.identity });
  assert.equal(b.state.revision, 7, 'stale lock (dead pid) recovered; data intact');
  await writeFile(lockFile, `${process.pid}:someone-else`); // lock taken over by another owner
  await b.close();
  assert.equal(await readFile(lockFile, 'utf8'), `${process.pid}:someone-else`, 'close removes only its own lock');
  const bad = await mkdtemp(join(tmpdir(), 'flow-lock3-'));
  await writeFile(join(bad, 'state.json'), JSON.stringify({ ...emptyState(src.identity), tenantId: 'other' }));
  await assert.rejects(openStore({ dir: bad, identity: src.identity }), e => e.code === 'flow_state_mismatch');
  await assert.rejects(readFile(join(bad, 'state.lock')), e => e.code === 'ENOENT', 'failed validation releases the lock');
});

test('store namespace accepts the root worktree name (v3.0.0) and rejects separators', () => {
  const id = { tenantSlug: 'cs', capturedAt: '2026-10-27T05:34:00.000Z' };
  assert(namespaceDir({ root: tmpdir(), namespace: 'v3.0.0', ...id }).endsWith(join('v3.0.0', 'cs-20261027053400')));
  assert(namespaceDir({ root: tmpdir(), namespace: 'ax-claude-dev', ...id }).includes('ax-claude-dev'));
  for (const bad of ['..', 'a..b', 'a/b', 'a\\b', '.hidden', 'trailing.', '']) assert.throws(() => namespaceDir({ root: tmpdir(), namespace: bad, ...id }), e => e.code === 'store_config', bad);
});

test('AI context is pseudonymous and bounded; candidates come from relations only', () => {
  const src = fixtureSource();
  const c = { id: 'loc-1', kind: 'scenario', scenario: 'absence', scenarioKey: 'attendance:a1', entityRefs: [{ type: 'attendance', id: 'a1' }, { type: 'student', id: 's1' }], createdAt: '2026-10-27T01:00:00Z', title: '결석 — 홍길동', summary: '' };
  const ctx = buildContext(src, c, { today: '2026-10-27' });
  const blob = JSON.stringify({ text: ctx.text, facts: ctx.facts });
  for (const name of ['홍길동', '이담임', '최데스크', 's1', 'a1']) assert(!blob.includes(name), name);
  assert.deepEqual(ctx.knownOpenWork, [{ area: 'attendance', code: 'absence_recorded' }]);
  assert.deepEqual(ctx.candidates.find(x => x.staffId === IDS.t1).roles, ['homeroom_teacher']);
  assert(ctx.candidates.some(x => x.staffId === IDS.t2 && x.roles.includes('subject_teacher')), 'teacher of another enrolled class');
  assert(!ctx.candidates.some(x => x.staffId === IDS.desk), 'non-assignable desk account is not an AI candidate');
  assert.equal(pseudonymize(src, '홍길동 학부모 010-1234-5678 이담임 선생님'), '학생 학부모 연락처 가림 직원 선생님');
});

test('trusted dates only → requestedActionDate; a code deadline outranks model urgency and is kept for display', async () => {
  const src = fixtureSource(), today = '2026-10-27';
  const ctxOf = c => buildContext(src, { entityRefs: [], createdAt: '2026-10-27T01:00:00Z', title: '', summary: '', ...c }, { today });
  const absence = ctxOf({ id: 'loc-1', kind: 'scenario', scenario: 'absence', scenarioKey: 'attendance:a1', entityRefs: [{ type: 'attendance', id: 'a1' }, { type: 'student', id: 's1' }] });
  const billing = ctxOf({ id: 'loc-2', kind: 'scenario', scenario: 'billing', scenarioKey: 'invoice:i1', entityRefs: [{ type: 'invoice', id: 'i1' }] });
  const request = ctxOf({ id: 'loc-3', kind: 'request', title: '내일까지 교재 확인', summary: '다음 주 월요일', dueAt: '2026-11-02' });
  const free = ctxOf({ id: 'loc-4', kind: 'request', title: '내일까지 교재 확인', summary: '오늘 꼭' });
  const far = ctxOf({ id: 'loc-5', kind: 'request', title: 'x', summary: 'y', dueAt: '2028-01-01' });
  const task = ctxOf({ id: 'src-task-t-open', kind: 'source', taskKind: 'attendance_absent_desk', dueAt: '2026-10-25T15:00:00Z', entityRefs: [{ type: 'student', id: 's1' }] });
  assert.deepEqual([absence.requestedActionDate, billing.requestedActionDate, request.requestedActionDate, task.requestedActionDate], ['2026-10-24', '2026-10-31', '2026-11-02', '2026-10-26'], 'absence date · invoice due date · request due · task due in KST');
  assert(!('requestedActionDate' in free) && !('requestedActionDate' in far), 'free text is never parsed; out-of-window dates are left out');
  for (const ctx of [absence, billing, request, task]) assert.equal(validateContext(ctx).ok, true, `context ${ctx.recordId} passes the AI module validator`);
  const seen = [];
  const deadline = { date: '2026-10-24', daysFromToday: -3, relation: 'overdue', urgency: 'today', source: 'requestedActionDate', origin: 'rule' };
  const ai = await createFlowAI({ env: {}, modules: { engine: { createDecisionEngine: () => ({ evaluateDecision: async ctx => { seen.push(ctx); return { contract: 'owner-decision/1', status: 'decided', route: 'auto_route', area: { value: 'attendance' }, signals: { actionNeeded: { probability: 0.9 }, urgency: { value: 'no_deadline' } }, deadline, reasons: [], assignees: [], model: 'jev-1.14.0' }; } }) } } });
  const d = await ai.route({ id: 'loc-1', kind: 'scenario', scenario: 'absence', scenarioKey: 'attendance:a1', entityRefs: [{ type: 'attendance', id: 'a1' }], createdAt: '2026-10-27T01:00:00Z' }, src);
  assert.equal(seen[0].requestedActionDate, '2026-10-24');
  assert.equal(d.priority, 'high', 'overdue absence → high even though the model said no deadline');
  const shown = decisionView({ decision: d.record }, null);
  assert.deepEqual([shown.deadline.relation, shown.deadline.label, shown.probabilities.urgency], ['overdue', '기한 지남', 'no_deadline']);
});

test('HTTP: GET view, strict POST guards, safe errors, store never served', async t => {
  const { svc } = await service();
  const origins = new Set(), route = createFlowRoute({ flow: { service: svc, failure: null }, origins, headers: { 'Cache-Control': 'no-store' } });
  const server = createServer((req, res) => { const p = new URL(req.url, 'http://x').pathname; if (route.handles(p)) route.handle(req, res, p); else { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => { server.close(); svc.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`; origins.add(origin);
  const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => { const q = request({ host: '127.0.0.1', port: server.address().port, method, path, agent: false, headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* text */ } resolve({ status: res.statusCode, json }); }); }); q.on('error', reject); q.end(body); });
  const ok = { origin, 'content-type': 'application/json' };
  const view = await call('GET', '/api/flow');
  assert.equal(view.status, 200); assert.deepEqual([view.json.schemaVersion, view.json.mode, view.json.casesTotal], [1, 'local-preview', 5]);
  const assignable = Object.fromEntries(view.json.actors.map(a => [a.id, a.assignable]));
  assert.deepEqual([assignable[IDS.t1], assignable[IDS.desk], assignable['preview-owner']], [true, false, false], 'actors carry assignable for the picker');
  assert.equal((await call('GET', '/api/flow?x=1')).status, 400);
  assert.equal((await call('GET', '/api/flow?casePage=2')).json.cases.length, 0);
  assert.equal((await call('POST', '/api/flow')).status, 405);
  assert.equal((await call('GET', '/api/flow/actions')).status, 405);
  const cmd = JSON.stringify({ commandId: 'http-cmd-0001', expectedRevision: view.json.revision, actorId: IDS.t1, kind: 'event.simulate', payload: { scenario: 'absence' } });
  for (const [headers, status] of [[{ 'content-type': 'application/json' }, 403], [{ ...ok, origin: 'http://evil.test' }, 403], [{ ...ok, 'sec-fetch-site': 'cross-site' }, 403], [{ ...ok, 'content-type': 'text/plain' }, 415]]) assert.equal((await call('POST', '/api/flow/actions', { headers, body: cmd })).status, status);
  assert.equal((await call('POST', '/api/flow/actions', { headers: ok, body: 'x'.repeat(20000) })).status, 413);
  assert.equal((await call('POST', '/api/flow/actions', { headers: ok, body: '{bad' })).json.error, 'invalid_request');
  const done = await call('POST', '/api/flow/actions', { headers: ok, body: cmd });
  assert.equal(done.status, 200); assert(done.json.caseId.startsWith('loc-'));
  const stale = await call('POST', '/api/flow/actions', { headers: ok, body: JSON.stringify({ ...JSON.parse(cmd), commandId: 'http-cmd-0002' }) });
  assert.deepEqual([stale.status, stale.json.error, typeof stale.json.revision], [409, 'revision_conflict', 'number']);
  for (const p of ['/api/flow/state.json', '/api/flow/../state.json', '/state.json']) assert.equal((await call('GET', p)).status, 404, p);
  const down = createFlowRoute({ flow: { service: null, failure: null }, origins });
  assert.equal(down.handles('/api/flow'), true);
});
