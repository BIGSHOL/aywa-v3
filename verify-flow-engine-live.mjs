// Flow engine on the real verified local copy (read-only) + guards of the running dev server.
// Run: node experiments/owner-concept/verify-flow-engine-live.mjs [--http=http://127.0.0.1:4312] [--ai]
// Store writes go to a temp dir only. --ai makes one actual Jev judgment (+ one Claude draft);
// it needs OWNER_CONCEPT_TYPESAFE_KEY_FILE (the decision-key.mjs one-line reader). Prints counts, never names.
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSnapshot } from './snapshot.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { loadFlowSource } from './flow-source.mjs';
import { createFlowService } from './flow-service.mjs';
import { buildContext, createFlowAI } from './flow-decision.mjs';

const arg = name => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const HTTP = arg('http') ? (arg('http').split('=')[1] || 'http://127.0.0.1:4312') : null, WITH_AI = !!arg('ai');
const results = [];
const check = (name, fn) => Promise.resolve().then(fn).then(() => results.push(['ok', name]), e => { results.push(['FAIL', name, e.message]); });
const offline = { route: async () => null, analyze: async () => null, status: () => ({ providers: [] }) };
const unavailable = await createFlowAI({ env: {}, modules: { engine: { createDecisionEngine: () => { throw new Error('off'); } } } }).catch(() => offline);

// Fingerprints of the source tables the engine reads; must not change.
async function fingerprint() {
  const db = await openFullDatabase();
  try {
    return await db.begin('isolation level repeatable read read only', async sql => {
      const [ro] = await sql`show transaction_read_only`;
      const [r] = await sql`select
        (select count(*)::int from public.staff_tasks where tenant_id=${tenantId}) tasks,
        (select md5(string_agg(id::text||status::text||coalesce(close_reason::text,'')||coalesce(closed_at::text,''), ',' order by id)) from public.staff_tasks where tenant_id=${tenantId}) tasks_md5,
        (select md5(string_agg(task_id::text||user_id::text, ',' order by task_id, user_id)) from public.staff_task_assignees where tenant_id=${tenantId}) assignees_md5,
        (select count(*)::int from public.staff_task_events where tenant_id=${tenantId}) task_events,
        (select count(*)::int from public.attendance_records where tenant_id=${tenantId}) attendance,
        (select coalesce(sum(amount_paid),0)::text from public.invoices where tenant_id=${tenantId}) paid,
        (select count(*)::int from public.student_consultations where tenant_id=${tenantId}) consultations`;
      return { readOnly: ro.transaction_read_only, ...r };
    });
  } finally { await db.end(); }
}

const snapshot = await loadSnapshot();
const before = await fingerprint();
const t0 = Date.now();
const source = await loadFlowSource({ workspaces: snapshot.workspaces, capturedAt: snapshot.meta.importedAt, asOf: snapshot.meta.asOf });
const loadMs = Date.now() - t0;

await check('source read in a read-only transaction', () => assert.equal(before.readOnly, 'on'));
await check('every 2.0 staff_task is loaded 1:1 with its real assignees', async () => {
  const db = await openFullDatabase();
  try {
    const rows = await db.begin('isolation level repeatable read read only', sql => sql`select k.id::text, k.status::text, (select array_agg(a.user_id::text order by a.user_id) from public.staff_task_assignees a where a.tenant_id=${tenantId} and a.task_id=k.id) assignees from public.staff_tasks k where k.tenant_id=${tenantId}`);
    assert.equal(source.tasks.length, rows.length);
    const by = new Map(source.tasks.map(t => [t.id, t]));
    for (const r of rows) { const t = by.get(r.id); assert(t, r.id); assert.equal(t.status, r.status); assert.deepEqual(t.assigneeIds, r.assignees || []); }
  } finally { await db.end(); }
});
await check('relations are verified foreign keys (re-read per relation type)', async () => {
  const db = await openFullDatabase();
  const pick = type => source.relations.filter(r => r.type === type);
  try {
    await db.begin('isolation level repeatable read read only', async sql => {
      const hm = pick('homeroom'), cls = await sql`select id::text, teacher_id::text from public.classes where tenant_id=${tenantId} and id = any(${hm.map(r => r.from.id)}::uuid[])`;
      const teacher = new Map(cls.map(c => [c.id, c.teacher_id]));
      for (const r of hm) assert.equal(teacher.get(r.from.id), r.to.id, 'classes.teacher_id');
      const en = pick('enrollment_of').slice(0, 300), ens = await sql`select id::text, student_id::text from public.enrollments where tenant_id=${tenantId} and id = any(${en.map(r => r.from.id)}::uuid[])`;
      const student = new Map(ens.map(e => [e.id, e.student_id]));
      for (const r of en) assert.equal(student.get(r.from.id), r.to.id, 'enrollments.student_id');
      const ab = pick('about_student').filter(r => r.from.type === 'attendance'), abs = await sql`select id::text, student_id::text from public.attendance_records where tenant_id=${tenantId} and id = any(${ab.map(r => r.from.id)}::uuid[])`;
      const absStudent = new Map(abs.map(a => [a.id, a.student_id]));
      for (const r of ab) assert.equal(absStudent.get(r.from.id), r.to.id, 'attendance_records.student_id');
      const co = pick('counselor'), cos = await sql`select id::text, counselor_id::text from public.student_consultations where tenant_id=${tenantId} and id = any(${co.map(r => r.from.id)}::uuid[])`;
      const counselor = new Map(cos.map(c => [c.id, c.counselor_id]));
      for (const r of co) assert.equal(counselor.get(r.from.id), r.to.id, 'student_consultations.counselor_id');
      const as = pick('assigned_to'), ass = await sql`select task_id::text, user_id::text from public.staff_task_assignees where tenant_id=${tenantId}`;
      const pairs = new Set(ass.map(a => `${a.task_id}:${a.user_id}`));
      for (const r of as) assert(pairs.has(`${r.from.id}:${r.to.id}`), 'staff_task_assignees');
    });
  } finally { await db.end(); }
  for (const r of source.relations) assert(/^[a-z_]+\.[a-z_]+$/.test(r.source), 'relation.source is table.column');
});
await check('actors are real active staff, no platform accounts, role labels mapped', async () => {
  const db = await openFullDatabase();
  try {
    const [n] = await db.begin('isolation level repeatable read read only', sql => sql`select count(*)::int n from public.users u where u.tenant_id=${tenantId} and u.status::text='active' and u.system_role::text in ('master','admin','manager','teacher','accountant','counselor','viewer') and not exists (select 1 from public.super_admins sa where sa.id=u.id)`);
    assert.equal(source.actors.length, n.n);
    const platform = await db.begin('isolation level repeatable read read only', sql => sql`select id::text from public.super_admins`);
    for (const p of platform) assert(!source.actors.some(a => a.id === p.id));
  } finally { await db.end(); }
  for (const a of source.actors) assert(a.roleLabel && ['owner', 'manager', 'teacher', 'staff'].includes(a.role));
});

const dir = await mkdtemp(join(tmpdir(), 'flow-live-'));
let svc = await createFlowService({ source, dir, ai: unavailable, lock: true, tenantName: snapshot.meta.tenant, waitMs: 3000 });
const v0 = svc.view(), open = source.tasks.filter(t => t.status === 'open').length;
const actors = source.actors, owner = actors.find(a => a.role === 'owner') || { id: 'preview-owner' }, manager = actors.find(a => a.role === 'manager');
let n = 0;
const send = body => svc.command({ commandId: `live-${Date.now().toString(36)}-${(n += 1)}`, expectedRevision: svc.view().revision, payload: {}, ...body });
const caseOf = id => svc.view().cases.find(c => c.id === id) || Object.values(svc.store.state.cases).find(c => c.id === id);
const stepOf = (c, key) => c.steps.find(s => s.key === key);

await check('seed = all tasks + workspace signals, fact closures match source, once', async () => {
  assert.equal(svc.seeded, source.tasks.length + source.signals.length);
  assert.equal(v0.metrics.cases.snapshot.done, source.tasks.length - open);
  assert.equal(v0.metrics.cases.snapshot.open, open + source.signals.length);
  for (const c of Object.values(svc.store.state.cases)) for (const s of c.steps) if (s.status !== 'done') assert(s.assigneeIds.length || s.queue === 'manager', `${c.id} unfinished step has a person or the manager queue`);
  await svc.close();
  svc = await createFlowService({ source, dir, ai: unavailable, lock: true, tenantName: snapshot.meta.tenant, waitMs: 3000 });
  assert.equal(svc.seeded, 0); assert.equal(svc.view().eventsTotal, v0.eventsTotal);
});

await check('absence: teacher event → desk contact → manager review → homeroom follow-up → closed', async () => {
  const teacher = actors.find(a => a.role === 'teacher' && source.candidates.absence.some(id => source.entities.get(`class:${source.entities.get(`attendance:${id}`)?.classId}`)?.teacherId === a.id));
  assert(teacher, 'a teacher with an absence this month');
  const r = await send({ actorId: teacher.id, kind: 'event.simulate', payload: { scenario: 'absence' } });
  let c = caseOf(r.caseId), desk = stepOf(c, 'desk_contact');
  assert.equal(source.entities.get(`class:${source.entities.get(c.scenarioKey).classId}`).teacherId, teacher.id);
  assert.deepEqual(desk.assigneeIds.sort(), actors.filter(a => a.desk).map(a => a.id).sort(), 'desk = accounts with the 2.0 attendance alert duty');
  assert.equal(c.decision.status, 'unavailable');
  await assert.rejects(send({ actorId: teacher.id, kind: 'case.review', caseId: c.id, payload: { decision: 'accept' } }), e => e.status === 403);
  await send({ actorId: desk.assigneeIds[0], kind: 'case.report', caseId: c.id, payload: { note: '학부모 통화 — 감기로 결석', outcome: 'done' } });
  c = caseOf(c.id); assert.equal(c.state, 'review');
  await send({ actorId: manager.id, kind: 'case.review', caseId: c.id, payload: { decision: 'accept' } });
  c = caseOf(c.id); assert.deepEqual(stepOf(c, 'teacher_followup').assigneeIds, [teacher.id]);
  await send({ actorId: teacher.id, kind: 'case.report', caseId: c.id, payload: { note: '다음 수업 보강 안내' } });
  c = caseOf(c.id); assert.equal(c.state, 'done');
  const evs = svc.view().events.filter(e => e.caseId === c.id);
  for (const e of evs.slice(1)) assert(e.causeId, `${e.type} has a cause`);
  assert(evs.every(e => e.origin === 'dev'));
});

await check('billing: staff check → manager/owner decision; always a person', async () => {
  const r = await send({ actorId: manager.id, kind: 'event.simulate', payload: { scenario: 'billing' } });
  let c = caseOf(r.caseId); const s = stepOf(c, 'staff_check');
  const who = s.assigneeIds[0] || manager.id;
  if (!s.assigneeIds.length) { assert.equal(s.queue, 'manager'); await send({ actorId: manager.id, kind: 'case.ack', caseId: c.id }); }
  await send({ actorId: who, kind: 'case.report', caseId: c.id, payload: { note: '입금 내역 대조 — 미납분 안내 필요' } });
  c = caseOf(c.id); assert.equal(stepOf(c, 'decision').status, 'ready');
  await send({ actorId: owner.id, kind: 'case.review', caseId: c.id, payload: { decision: 'accept', note: '다음 주 안내' } });
  assert.equal(caseOf(c.id).state, 'done');
});

await check('owner multi-assignee request: every person reports, manager closes; return is recorded', async () => {
  const two = actors.filter(a => a.role === 'teacher' && a.assignable).slice(0, 2);
  await assert.rejects(send({ actorId: two[0].id, kind: 'request.create', payload: { title: 'x', body: 'y', assigneeIds: [two[1].id] } }), e => e.status === 403);
  const r = await send({ actorId: owner.id, kind: 'request.create', payload: { title: '교재 재고 확인', body: '다음 주 교재 수량 확인', assigneeIds: two.map(a => a.id) } });
  await send({ actorId: two[0].id, kind: 'case.report', caseId: r.caseId, payload: { note: '확인' } });
  assert.equal(caseOf(r.caseId).state, 'working');
  await send({ actorId: two[1].id, kind: 'case.report', caseId: r.caseId, payload: { note: '2권 부족' } });
  await send({ actorId: manager.id, kind: 'case.review', caseId: r.caseId, payload: { decision: 'return', note: '수량을 적어 주세요' } });
  for (const a of two) await send({ actorId: a.id, kind: 'case.report', caseId: r.caseId, payload: { note: '수량 기재' } });
  await send({ actorId: manager.id, kind: 'case.review', caseId: r.caseId, payload: { decision: 'accept' } });
  assert.equal(caseOf(r.caseId).state, 'done');
});

await check('source task report → linked local follow-up; source fact stays open; queue item reassigned', async () => {
  const task = source.tasks.find(t => t.status === 'open' && t.assigneeIds.some(id => actors.some(a => a.id === id)));
  const id = `src-task-${task.id}`, by = task.assigneeIds.find(x => actors.some(a => a.id === x));
  const r = await send({ actorId: by, kind: 'case.report', caseId: id, payload: { note: '처리 내용 기록' } });
  assert.equal(caseOf(id).state, 'open'); assert.deepEqual([caseOf(r.caseId).origin, caseOf(r.caseId).state], ['dev', 'done']);
  const queued = Object.values(svc.store.state.cases).find(c => c.state !== 'done' && c.steps.some(s => s.status === 'ready' && !s.assigneeIds.length && s.queue === 'manager'));
  assert(queued, 'a real manager-queue item');
  await send({ actorId: manager.id, kind: 'case.reassign', caseId: queued.id, payload: { assigneeIds: [manager.id] } });
  assert(caseOf(queued.id).steps.some(s => s.assigneeIds.includes(manager.id)));
});

await check('restart keeps the overlay; source tables unchanged', async () => {
  const rev = svc.view().revision, total = svc.view().casesTotal;
  await svc.close();
  svc = await createFlowService({ source, dir, ai: unavailable, lock: true, tenantName: snapshot.meta.tenant });
  assert.deepEqual([svc.view().revision, svc.view().casesTotal, svc.seeded], [rev, total, 0]);
  assert.deepEqual(await fingerprint(), before);
  assert.deepEqual((await readdir(dir)).sort(), ['hierarchy-ai', 'state.json', 'state.lock'], 'the flow state + the hierarchy overlay folder (FLOW-HIERARCHY.md), nothing else');
});

if (WITH_AI) {
  // One actual judgment: Jev for the new absence event, then one explicit analyze with a Claude draft.
  await check('actual provider: Jev route + Claude draft on a pseudonymous context', async () => {
    const ai = await createFlowAI();
    assert.equal(ai.status().providers.find(p => p.id === 'jev').status, 'ready', 'Jev key configured');
    await svc.close();
    svc = await createFlowService({ source, dir, ai, lock: true, tenantName: snapshot.meta.tenant, waitMs: 120_000 });
    const teacher = actors.find(a => a.role === 'teacher' && source.candidates.absence.some(id => source.entities.get(`class:${source.entities.get(`attendance:${id}`)?.classId}`)?.teacherId === a.id));
    const recordRef = source.candidates.absence.filter(id => source.entities.get(`class:${source.entities.get(`attendance:${id}`)?.classId}`)?.teacherId === teacher.id)[1] || undefined;
    const r = await send({ actorId: teacher.id, kind: 'event.simulate', payload: { scenario: 'absence', ...(recordRef ? { recordRef } : {}) } });
    const raw = svc.store.state.cases[r.caseId], ctx = buildContext(source, raw), blob = JSON.stringify(ctx);
    for (const a of actors) assert(!blob.includes(a.name), 'no staff name in AI context');
    for (const ref of raw.entityRefs) if (ref.type === 'student') assert(!blob.includes(ref.label), 'no student name in AI context');
    const routed = caseOf(r.caseId).decision;
    const a = await send({ actorId: manager.id, kind: 'case.analyze', caseId: r.caseId, payload: { draft: true } });
    await svc.settled();
    const analyzed = caseOf(a.caseId).decision;
    console.log(JSON.stringify({ route: { status: routed.status, reason: routed.reason, route: routed.route, modelLabel: routed.modelLabel, probabilities: routed.probabilities, elapsedMs: routed.elapsedMs, codes: routed.codes },
      analyze: { status: analyzed.status, route: analyzed.route, elapsedMs: analyzed.elapsedMs, cache: svc.store.state.cases[r.caseId].decision.cache, draft: analyzed.draft && { status: analyzed.draft.status, modelLabel: analyzed.draft.modelLabel, elapsedMs: analyzed.draft.elapsedMs, explanationChars: analyzed.draft.explanation?.length ?? null } } }, null, 1));
    assert(['ok', 'error', 'unavailable'].includes(routed.status));
  });
}

if (HTTP) {
  const call = async (method, path, headers = {}, body) => { const r = await fetch(new URL(path, HTTP), { method, headers, body, redirect: 'manual' }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, type: r.headers.get('content-type') || '', json }; };
  await check(`HTTP ${HTTP}: flow view, guards, JSON 405s, nothing private served`, async () => {
    const view = await call('GET', '/api/flow');
    assert.equal(view.status, 200); assert.deepEqual([view.json.schemaVersion, view.json.mode], [1, 'local-preview']);
    assert(view.json.cases.length <= 500 && view.json.casesTotal >= view.json.cases.length);
    const json = { 'content-type': 'application/json' }, own = { ...json, origin: HTTP };
    assert.equal((await call('POST', '/api/flow/actions', json, '{}')).status, 403, 'no origin');
    assert.equal((await call('POST', '/api/flow/actions', { ...json, origin: 'http://evil.test' }, '{}')).status, 403, 'foreign origin');
    const invalid = await call('POST', '/api/flow/actions', own, '{"kind":"case.ack"}'); // rejected before the store
    assert.deepEqual([invalid.status, invalid.json.error], [400, 'invalid_request']);
    assert.equal((await call('GET', '/api/flow')).json.revision, view.json.revision, 'invalid POST did not change the store');
    const wr = await call('POST', '/api/workspaces/billing/records', own, '{}');
    assert.equal(wr.status, 405); assert.match(wr.type, /application\/json/);
    assert.equal((await call('GET', '/api/assistant')).status, 405, 'assistant endpoint still mounted');
    for (const p of ['/state.json', '/api/flow/state.json', '/owner-flow/', '/local.json', '/.env.local', '/flow-store.mjs', '/%2e%2e/local.json']) assert([403, 404].includes((await call('GET', p)).status), p);
  });
}

await svc.close();
const failed = results.filter(r => r[0] !== 'ok');
for (const r of results) console.log(r[0] === 'ok' ? `ok   ${r[1]}` : `FAIL ${r[1]} — ${r[2]}`);
console.log(JSON.stringify({ loadMs, actors: source.actors.length, entities: source.entities.size, relations: source.relations.length, tasks: source.tasks.length, openTasks: open, signals: source.signals.length, seeded: v0.casesTotal, events: v0.eventsTotal, managerQueue: v0.metrics.managerQueue }));
process.exitCode = failed.length ? 1 : 0;
