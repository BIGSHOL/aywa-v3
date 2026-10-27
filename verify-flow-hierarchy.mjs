// Offline checks for the issue hierarchy and its AI queue (no DB, no network, temp dirs only).
// Run: node --test experiments/owner-concept/verify-flow-hierarchy.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { CASE, T, fakeProviders, hierarchyService, hierarchySource } from './verify-flow-hierarchy-fixture.mjs';
import { send } from './verify-flow-engine-fixture.mjs';
import { createFlowRoute } from './flow-http.mjs';
import { checkTexts, pseudonymizer, validateAcademy, validateTeacherBatch } from './flow-hierarchy-ai.mjs';
import { schoolGrade } from './flow-hierarchy.mjs';

const nodes = tree => { const out = []; const walk = n => { out.push(n); n.children.forEach(walk); }; walk(tree.root); return out; };
const nodeOf = (tree, id) => nodes(tree).find(n => n.id === id);
const studentIn = (tree, classId, sid) => nodeOf(tree, `class:${classId}/student:${sid}`);
const fails = async (p, status, code) => { await assert.rejects(p, e => e.status === status && e.code === code, `${status} ${code}`); };
const stepOf = (svc, owner) => svc.view().cases.find(c => c.id === CASE).steps.find(s => (owner ? s.assigneeIds.includes(owner) : s.queue === 'manager'));

test('graph: every record past the seed cap, distinct counts, shared students, explicit unknown buckets', async () => {
  const { svc } = await hierarchyService();
  const tree = svc.hierarchy(CASE), c = svc.view().cases.find(x => x.id === CASE);
  assert.deepEqual(tree.counts, { students: 28, classes: 5, teachers: 3, records: 89, unmappedRecords: 1 });
  assert.equal(c.steps.find(s => s.assigneeIds.includes(T.t1)).refs.length, 50, 'the seed keeps 50 refs for t1');
  const t1 = nodeOf(tree, `teacher:${T.t1}`);
  assert.deepEqual(t1.counts, { students: 21, classes: 2, teachers: 1, records: 63 }, 'all 63 t1 records recovered');
  assert.deepEqual(t1.stepIds, [stepOf(svc, T.t1).id]);
  assert.equal(nodes(tree).filter(n => n.level === 'student').reduce((s, n) => s + n.records.length, 0), 89, 'records listed once each');
  // s1 is absent in a t1 class and a t2 class: two nodes, one student at the root.
  assert.equal(studentIn(tree, 'c1', 's1').counts.records, 3); assert.equal(studentIn(tree, 'c3', 's1').counts.records, 1);
  assert.equal(studentIn(tree, 'c1', 's1').facts.absencesAllClasses, 4);
  assert.equal(t1.counts.students + nodeOf(tree, `teacher:${T.t2}`).counts.students + nodeOf(tree, `teacher:${T.gone}`).counts.students + nodeOf(tree, 'teacher:unknown').counts.students, 33, 'sum over teachers double-counts shared students; the root does not');
  const gone = nodeOf(tree, `teacher:${T.gone}`), unknown = nodeOf(tree, 'teacher:unknown');
  assert.deepEqual([gone.status, gone.facts.managerQueue, gone.stepIds], ['inactive', true, [stepOf(svc, null).id]]);
  assert.deepEqual([unknown.status, unknown.unassigned, unknown.entityRef], ['unknown', true, undefined]);
  assert.deepEqual(unknown.children.map(x => x.id).sort(), ['class:c5', 'class:unknown:teacher:unknown']);
  assert.equal(nodeOf(tree, 'class:unknown:teacher:unknown').unassigned, true);
  assert.deepEqual(tree.coverage.unknown, { teacherRecords: 12, classRecords: 3 });
  assert.equal(tree.coverage.complete, false, 'one signal id did not resolve'); assert.equal(tree.coverage.returnedRecords, 89); assert.equal(tree.coverage.totalRecords, 90);
  assert.equal(studentIn(tree, 'c1', 's1').detail, '경명여중1'); assert.equal(schoolGrade('Ing유치원', '7세'), 'Ing유치원 7세');
  const r = studentIn(tree, 'c1', 's1').records[0];
  assert.deepEqual(Object.keys(r).sort(), ['classId', 'date', 'familyId', 'id', 'recordId', 'status', 'statusLabel', 'teacherId']); assert.equal(r.statusLabel, '결석');
  assert.deepEqual(tree.basis.window, { from: '2026-10-01', to: '2026-10-27' }); assert.match(tree.basis.note2_0, /최근 14일/);
  await svc.close();
});

test('graph errors are explicit; cohort mismatch is visible even when relationships are complete', async () => {
  const { svc } = await hierarchyService();
  assert.throws(() => svc.hierarchy('nope'), e => e.status === 404 && e.code === 'case_not_found');
  assert.throws(() => svc.hierarchy('src-sig-billing-billing-remaining'), e => e.status === 422 && e.code === 'hierarchy_unsupported');
  await svc.close();
  const empty = await hierarchyService({ source: hierarchySource({ noRefs: true }) });
  assert.throws(() => empty.svc.hierarchy(CASE), e => e.status === 422 && e.code === 'hierarchy_no_relationships');
  await empty.svc.close();
  const w = await hierarchyService({ source: hierarchySource({ withdrawn: true }) });
  const tree = w.svc.hierarchy(CASE);
  assert.equal(tree.coverage.cohortCheck.ok, false); assert.equal(tree.coverage.cohortCheck.notEnrolled, 1); assert.equal(tree.coverage.complete, false);
  assert.equal(tree.warnings[0].code, 'cohort_mismatch'); assert.match(tree.coverage.notes.join(' '), /재원 아닌 원생 1명/);
  await w.svc.close();
});

test('reports beyond the 50-ref cap are allowed for the reporting step only; scopes resolve per record by time', async () => {
  const { svc } = await hierarchyService();
  const t1Step = stepOf(svc, T.t1), t1Refs = nodes(svc.hierarchy(CASE)).filter(n => n.level === 'student' && n.id.startsWith('class:c1/')).flatMap(n => n.records.map(r => r.id));
  const beyond = t1Refs.find(id => !t1Step.refs.includes(id)), s2 = studentIn(svc.hierarchy(CASE), 'c1', 's2').records;
  assert(beyond, 'a t1 record past the stored 50');
  const report = (actorId, stepId, recordRefs, outcome = 'done') => send(svc, { actorId, kind: 'case.report', caseId: CASE, payload: { stepId, note: '확인했습니다', recordRefs, outcome } });
  await report(T.t1, t1Step.id, [beyond]);
  await fails(report(T.t1, t1Step.id, [studentIn(svc.hierarchy(CASE), 'c3', 's1').records[0].id]), 400, 'record_ref_not_allowed'); // t2's record
  await fails(report(T.t1, t1Step.id, ['invoice:i1']), 400, 'record_ref_not_allowed'); // unrelated record
  const s1 = studentIn(svc.hierarchy(CASE), 'c1', 's1').records;
  await report(T.t1, t1Step.id, [s1[0].id]);
  let tree = svc.hierarchy(CASE), n1 = studentIn(tree, 'c1', 's1');
  assert.deepEqual([n1.flow.state, n1.flow.coverage], ['partial', { covered: 1, total: 3 }], 'one record of three does not report the student');
  assert.equal(studentIn(tree, 'c3', 's1').flow.state, 'open', 'the same student in another teacher\'s class stays open');
  assert.equal(nodeOf(tree, 'class:c1').flow.state, 'partial');
  await report(T.t1, t1Step.id, undefined); // whole step, newer
  tree = svc.hierarchy(CASE);
  assert.deepEqual([studentIn(tree, 'c1', 's1').flow.state, studentIn(tree, 'c1', 's1').flow.scope], ['reported', 'step']);
  await report(T.t1, t1Step.id, [s2[0].id], 'needs_review'); // newer record report beats the older step report
  tree = svc.hierarchy(CASE);
  assert.equal(studentIn(tree, 'c1', 's2').flow.state, 'needs_review'); assert.equal(studentIn(tree, 'c1', 's3').flow.state, 'reported');
  await report(T.t1, t1Step.id, undefined); // and a newer step report beats it again
  assert.equal(studentIn(svc.hierarchy(CASE), 'c1', 's2').flow.state, 'reported');
  assert.equal(svc.hierarchy(CASE).root.facts.studentsByFlowState.mixed, 5, 's1~s5: reported in t1, open in t2');
  assert.equal(Object.values(nodeOf(svc.hierarchy(CASE), `teacher:${T.t1}`).flow.byState).reduce((a, b) => a + b, 0), 21, 'byState counts student nodes at every level');
  const many = t1Refs.slice(0, 60), more = [...t1Refs.slice(0, 60), t1Refs[60]];
  await report(T.t1, t1Step.id, many); // a hierarchy step accepts up to 60 of its own records
  await fails(report(T.t1, t1Step.id, more), 400, 'invalid_request');
  const billing = svc.view().cases.find(c => c.id === 'src-sig-billing-billing-remaining');
  await fails(send(svc, { actorId: T.manager, kind: 'case.report', caseId: billing.id, payload: { stepId: billing.steps[0].id, note: '확인', recordRefs: Array(21).fill('invoice:i1') } }), 400, 'invalid_request'); // other cases keep 20
  await svc.close();
});

test('AI queue: one Jev call per unique student, batched Claude, cached across GET and restart', async () => {
  const providers = fakeProviders();
  const { svc, dir } = await hierarchyService({ providers });
  await svc.hierarchyRuntime.idle();
  assert.equal(providers.calls.jev.length, 28, '28 unique students (s1~s5 shared by two classes) → 28 leaves');
  assert.equal(new Set(providers.calls.jev).size, 28);
  assert.deepEqual(providers.calls.claude.map(c => c.stage), ['teacher', 'teacher', 'academy'], 'teachers packed by size into 2 calls, then the academy');
  const tree = svc.hierarchy(CASE);
  assert.equal(tree.analysis.status, 'complete'); assert.equal(tree.analysis.failed, 0);
  const a = studentIn(tree, 'c1', 's1').ai, b = studentIn(tree, 'c3', 's1').ai;
  assert.deepEqual([a.status, a.priority, a.origin, a.modelLabel], ['ready', 'first', 'jev', 'Jev 1.14']); assert.deepEqual(a, b, 'shared leaf');
  const s6 = studentIn(tree, 'c1', 's6').ai;
  assert.deepEqual([s6.priority, s6.deprioritized, s6.status], ['routine', true, 'ready'], 'lowered priority stays visible');
  const t1 = nodeOf(tree, `teacher:${T.t1}`).ai;
  assert.equal(t1.status, 'ready'); assert.match(t1.summary, /원생\d+을 먼저/, 'pseudonyms rendered to local labels'); assert.doesNotMatch(t1.summary, /S-[0-9a-f]{8}/);
  assert(t1.evidenceIds.every(id => nodeOf(tree, id)), 'evidence ids are real tree nodes');
  assert.equal(nodeOf(tree, 'class:c1').ai.status, 'ready'); assert.match(nodeOf(tree, 'class:c1').ai.summary, /^원생\d+을 먼저/); assert.equal(nodeOf(tree, 'class:c1').ai.draft, true);
  assert.equal(tree.managerSummary.status, 'ready'); assert.match(tree.managerSummary.summary, /^이담임 묶음부터/); assert.equal(tree.managerSummary.facts.origin, 'code');
  for (let i = 0; i < 5; i += 1) svc.hierarchy(CASE);
  await svc.hierarchyRuntime.idle();
  assert.equal(providers.calls.jev.length + providers.calls.claude.length, 31, 'GET never calls');
  await svc.close();
  const again = fakeProviders(), restarted = await hierarchyService({ dir, providers: again });
  await restarted.svc.hierarchyRuntime.idle();
  assert.equal(again.calls.jev.length + again.calls.claude.length, 0, 'restart reuses the persisted results');
  assert.equal(restarted.svc.hierarchy(CASE).analysis.status, 'complete');
  await restarted.svc.close();
});

test('changed evidence re-runs only the affected student, teacher and academy; parents show stale while waiting', async () => {
  let open = null; const hold = new Promise(r => { open = r; });
  let gated = false; const providers = fakeProviders({ gate: async stage => { if (gated && stage === 'academy') await hold; } });
  const { svc } = await hierarchyService({ providers });
  await svc.hierarchyRuntime.idle();
  const before = { jev: providers.calls.jev.length, claude: providers.calls.claude.length };
  gated = true;
  await send(svc, { actorId: T.t2, kind: 'case.report', caseId: CASE, payload: { stepId: stepOf(svc, T.t2).id, note: '다섯 명 모두 통화했습니다', outcome: 'done' } });
  for (let i = 0; i < 300 && !providers.calls.claude.slice(before.claude).some(c => c.stage === 'academy'); i += 1) await new Promise(r => setTimeout(r, 10));
  let tree = svc.hierarchy(CASE);
  assert.equal(providers.calls.jev.length - before.jev, 5, 's1~s5 only (their follow-up state changed)');
  assert.equal(nodeOf(tree, `teacher:${T.t2}`).ai.status, 'skipped', 'every t2 student reported → no teacher call');
  assert.equal(studentIn(tree, 'c3', 's1').ai.status, 'ready', 'leaf re-judged as partly reported');
  assert.deepEqual([tree.managerSummary.status, tree.managerSummary.stale], ['running', true], 'previous summary shown as stale while the new one runs');
  assert.match(tree.managerSummary.summary, /^이담임 묶음부터/);
  open(); await svc.hierarchyRuntime.idle();
  tree = svc.hierarchy(CASE);
  assert.deepEqual(providers.calls.claude.slice(before.claude).map(c => c.stage), ['academy'], 't1 and the others kept their cached summaries');
  assert.deepEqual([tree.managerSummary.status, tree.managerSummary.stale], ['ready', false]);
  assert(tree.analysis.revision > 0 && tree.analysis.updatedAt);
  await svc.close();
});

test('uncertain leaves escalate their teacher; an invalid base answer escalates once; nothing fake on failure', async () => {
  const p1 = fakeProviders({ uncertainAt3: true });
  const a = await hierarchyService({ providers: p1 });
  await a.svc.hierarchyRuntime.idle();
  let tree = a.svc.hierarchy(CASE);
  assert.equal(studentIn(tree, 'c1', 's6').ai.status, 'review_needed', 'uncertain ordering → human-visible review');
  assert.equal(nodeOf(tree, `teacher:${T.t1}`).ai.effort, 'medium'); assert.equal(nodeOf(tree, `teacher:${T.t2}`).ai.effort, 'low');
  await a.svc.close();
  const p2 = fakeProviders({ teacherLow: 'invalid' });
  const b = await hierarchyService({ providers: p2 });
  await b.svc.hierarchyRuntime.idle();
  tree = b.svc.hierarchy(CASE);
  assert.deepEqual(p2.calls.claude.map(c => `${c.stage}:${c.effort}`), ['teacher:low', 'teacher:low', 'teacher:medium', 'teacher:medium', 'academy:low']);
  assert.deepEqual([nodeOf(tree, `teacher:${T.t1}`).ai.status, nodeOf(tree, `teacher:${T.t1}`).ai.tier], ['ready', 'escalated']);
  await b.svc.close();
  const p3 = fakeProviders({ jevError: 'no_key' });
  const c = await hierarchyService({ providers: p3 });
  await c.svc.hierarchyRuntime.idle();
  tree = c.svc.hierarchy(CASE);
  const leaf = studentIn(tree, 'c1', 's1').ai;
  assert.deepEqual([leaf.status, leaf.reason, leaf.priority], ['error', '판정 키가 설정되지 않음', undefined], 'no fake leaf');
  assert.equal(p3.calls.jev.length, 28, 'a final error is not retried');
  assert.equal(nodeOf(tree, `teacher:${T.t1}`).ai.partial, true, 'teacher summarized explicitly as partial');
  assert.equal(tree.analysis.status, 'partial');
  await c.svc.close();
});

test('validators reject ungrounded numbers, raw codes, risk claims and evidence outside the input', () => {
  const alias = pseudonymizer('t'), s = alias('S', 's1'), cId = alias('C', 'class:c1'), tId = alias('T', 'teacher:t1');
  const part = { id: tId, classIds: [cId], citeable: new Set([cId, s]), input: { 강사: tId, 결석기록: 7, 반: [{ 반: cId, 원생: [{ 원생: s, 전체결석: 7 }] }] } };
  const good = { teachers: [{ id: tId, summary: `${s}을 먼저 확인합니다.`, reasons: [], suggestedAction: null, attention: 'routine', evidenceIds: [s], classes: [{ id: cId, summary: '먼저 확인할 원생이 있습니다.', evidenceIds: [] }] }] };
  assert.equal(validateTeacherBatch(good, [part], { 기준횟수: 3 }).get(tId).ok, true, 'digits inside pseudonyms are not numbers');
  const bad = (patch, issue) => { const o = structuredClone(good); Object.assign(o.teachers[0], patch); assert.deepEqual(validateTeacherBatch(o, [part], {}).get(tId).issues, [issue]); };
  bad({ summary: '결석 기록 7건입니다.' }, 'number_in_text'); // even a number that is in the input
  bad({ summary: `${alias('S', 's9')}을 먼저 봅니다.` }, 'unknown_id');
  bad({ summary: 'follow_up은 open입니다.' }, 'raw_code');
  bad({ summary: '이탈 가능성이 있습니다.' }, 'banned_claim');
  bad({ evidenceIds: [alias('S', 's9')] }, 'evidence_outside_input');
  bad({ classes: [] }, 'class_set');
  assert.deepEqual(validateTeacherBatch({ teachers: [] }, [part], {}).get(tId).issues, ['teacher_set']);
  assert.deepEqual(checkTexts(['기준 이상인 원생'], [{ 기준횟수: 3 }]), []);
  assert.deepEqual(validateAcademy({ manager: { summary: '전체를 봅니다.', reasons: [], suggestedAction: null, evidenceIds: ['T-00000000'] }, owner: { summary: '전체 89건', reasons: [], suggestedAction: null, evidenceIds: [] } }, { 전체: { 결석기록: 89 }, 강사별: [{ 강사: tId }] }).issues, ['evidence_outside_input', 'number_in_text']);
});

test('budget holds jobs visibly; disabled mode answers from cache only', async () => {
  const providers = fakeProviders();
  const { svc, dir } = await hierarchyService({ providers, budget: { jevPerHour: 3, claudePerHour: 0, retryAfterMs: 600000, maxAttempts: 2, keepResults: 3000 } });
  await new Promise(r => setTimeout(r, 50));
  const tree = svc.hierarchy(CASE);
  assert.equal(providers.calls.jev.length, 3); assert.equal(providers.calls.claude.length, 0);
  assert.equal(tree.analysis.status, 'running'); assert(nodes(tree).some(n => n.ai?.reason === '이 PC의 시간당 호출 한도로 대기'));
  await svc.close();
  const off = await hierarchyService({ dir, providers: null });
  const t2 = off.svc.hierarchy(CASE);
  assert.equal(t2.analysis.status, 'disabled'); assert.equal(studentIn(t2, 'c1', 's6').ai.status, 'not_started');
  assert.equal(nodes(t2).filter(n => n.level === 'student' && n.ai.status === 'ready').length > 0, true, 'results stored before stay readable');
  await off.svc.close();
});

test('HTTP: GET only, ETag/304, explicit errors, same guards', async () => {
  const { svc } = await hierarchyService({ providers: fakeProviders() });
  await svc.hierarchyRuntime.idle();
  const route = createFlowRoute({ flow: { service: svc }, origins: new Set(['http://127.0.0.1:1']), headers: {} });
  const server = createServer((req, res) => route.handle(req, res, new URL(req.url, 'http://x').pathname));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const call = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => { const r = request({ host: '127.0.0.1', port: server.address().port, path, method, headers }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null })); }); r.on('error', reject); r.end(); });
  const ok = await call(`/api/flow/hierarchy?caseId=${CASE}`);
  assert.equal(ok.status, 200); assert.equal(ok.body.schemaVersion, 1); assert(ok.headers.etag);
  assert.equal((await call(`/api/flow/hierarchy?caseId=${CASE}`, { headers: { 'if-none-match': ok.headers.etag } })).status, 304);
  assert.equal((await call('/api/flow/hierarchy?caseId=nope')).body.error, 'case_not_found');
  for (const [other, status] of [['nope', 404], ['src-sig-billing-billing-remaining', 422]]) assert.equal((await call(`/api/flow/hierarchy?caseId=${other}`, { headers: { 'if-none-match': ok.headers.etag } })).status, status, 'a valid tag never answers for another case');
  assert.equal((await call('/api/flow/hierarchy?caseId=src-sig-billing-billing-remaining')).status, 422);
  assert.equal((await call(`/api/flow/hierarchy?caseId=${CASE}&x=1`)).status, 400);
  assert.equal((await call('/api/flow/hierarchy')).status, 400);
  assert.equal((await call(`/api/flow/hierarchy?caseId=${CASE}`, { method: 'POST' })).status, 405);
  assert.equal((await call(`/api/flow/hierarchy?caseId=${CASE}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  server.close(); await svc.close();
});
