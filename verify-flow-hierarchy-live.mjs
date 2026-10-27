// Live checks of the issue hierarchy against the verified local copy (read-only) and, optionally, a
// running dev server. No AI calls here (a temp store with AI off); the server's own queue is only read.
// Run: node experiments/owner-concept/verify-flow-hierarchy-live.mjs [--http=http://127.0.0.1:4315]
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSnapshot } from './snapshot.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { loadFlowSource } from './flow-source.mjs';
import { createFlowService } from './flow-service.mjs';

const arg = name => process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const HTTP = arg('http') ? (arg('http').split('=')[1] || 'http://127.0.0.1:4315') : null;
const CASE = 'src-sig-attendance-attendance-repeat-absence';
const results = [];
const check = (name, fn) => Promise.resolve().then(fn).then(() => results.push(['ok', name]), e => { results.push(['FAIL', name, e.message]); });
const read = async fn => { const db = await openFullDatabase(); try { return await db.begin('isolation level repeatable read read only', fn); } finally { await db.end(); } };
const fingerprint = () => read(async sql => { const [ro] = await sql`show transaction_read_only`; const [r] = await sql`select (select md5(string_agg(id::text||status::text||session_date::text, ',' order by id)) from public.attendance_records where tenant_id=${tenantId}) att, (select md5(string_agg(id::text||coalesce(teacher_id::text,''), ',' order by id)) from public.classes where tenant_id=${tenantId}) cls, (select md5(string_agg(id::text||status::text, ',' order by id)) from public.students where tenant_id=${tenantId}) stu`; return { readOnly: ro.transaction_read_only, ...r }; });

const snapshot = await loadSnapshot();
const before = await fingerprint();
const source = await loadFlowSource({ workspaces: snapshot.workspaces, capturedAt: snapshot.meta.importedAt, asOf: snapshot.meta.asOf });
const svc = await createFlowService({ source, dir: await mkdtemp(join(tmpdir(), 'flow-hier-live-')), ai: { route: async () => null, analyze: async () => null, status: () => ({ providers: [] }) }, lock: false, hierarchy: { providers: null } });
const tree = svc.hierarchy(CASE);
const walk = (n, out = []) => { out.push(n); n.children.forEach(c => walk(c, out)); return out; };
const all = walk(tree.root), records = all.filter(n => n.level === 'student').flatMap(n => n.records);
const { asOf } = source.identity, monthStart = `${asOf.slice(0, 7)}-01`;

await check('source read in a read-only transaction', () => assert.equal(before.readOnly, 'on'));
await check('every signal record is in the tree once, nothing truncated (independent SQL cohort)', async () => {
  const rows = await read(sql => sql`with v as (select a.* from public.attendance_records a where a.tenant_id=${tenantId} and a.session_date between ${monthStart} and ${asOf} and not exists (select 1 from public.attendance_records b where b.tenant_id=${tenantId} and b.supersedes_id=a.id)),
    abs as (select v.id, v.student_id, v.class_id from v join public.students s on s.id=v.student_id and s.tenant_id=${tenantId} where v.status='absent' and s.status='enrolled' and not coalesce(s.is_test,false)),
    q as (select student_id from abs group by 1 having count(*) >= 3)
    select abs.id::text id, abs.student_id::text student, abs.class_id::text class, c.teacher_id::text teacher from abs join q using (student_id) left join public.classes c on c.id=abs.class_id and c.tenant_id=${tenantId}`);
  assert.equal(records.length, rows.length); assert.equal(new Set(records.map(r => r.recordId)).size, records.length);
  assert.deepEqual(records.map(r => r.recordId).sort(), rows.map(r => r.id).sort());
  assert.equal(tree.counts.students, new Set(rows.map(r => r.student)).size);
  assert.equal(tree.counts.records, rows.length); assert.equal(tree.counts.unmappedRecords, 0);
  const by = new Map(rows.map(r => [r.id, r]));
  for (const r of records) { const s = by.get(r.recordId); assert.equal(r.classId, s.class, 'class FK'); assert.equal(r.teacherId, s.teacher && source.entities.has(`staff:${s.teacher}`) ? s.teacher : null, 'teacher FK'); }
  console.log(`  cohort: ${tree.counts.students} students · ${tree.counts.records} records · ${tree.counts.classes} classes · ${tree.counts.teachers} teachers`);
});
await check('the tree is the qualifying cohort, not every absence this month', async () => {
  const [{ n }] = await read(sql => sql`select count(*)::int n from public.attendance_records a where a.tenant_id=${tenantId} and a.status='absent' and a.session_date between ${monthStart} and ${asOf} and not exists (select 1 from public.attendance_records b where b.tenant_id=${tenantId} and b.supersedes_id=a.id)`);
  assert(records.length < n, `${records.length} < ${n}`); assert.equal(tree.coverage.cohortCheck.ok, true); assert.equal(tree.coverage.complete, true);
  console.log(`  all absences this month ${n} · in cohort ${records.length}`);
});
await check('seed truncation recovered with the seed\'s own step identity', () => {
  const c = svc.view().cases.find(x => x.id === CASE);
  const stored = c.steps.reduce((n, s) => n + (s.refs || []).length, 0);
  assert(stored < records.length, `stored ${stored} < ${records.length}`);
  const stepOfRecord = new Map(all.filter(n => n.level === 'student').flatMap(n => n.records.map(r => [r.id, n.stepIds[0]])));
  for (const s of c.steps) for (const ref of s.refs || []) assert.equal(stepOfRecord.get(ref), s.id, ref);
  assert(all.filter(n => n.level === 'teacher').every(t => t.stepIds.length === 1 && c.steps.some(s => s.id === t.stepIds[0])));
});
await check('distinct counts: parents dedupe shared students; class/teacher nodes keep evidence links', () => {
  const teachers = tree.root.children;
  assert(teachers.reduce((n, t) => n + t.counts.students, 0) > tree.counts.students, 'some students are under two teachers');
  for (const n of all.filter(x => x.level !== 'student')) { const ids = new Set(walk(n).filter(x => x.level === 'student').map(x => x.entityRef.id)); assert.equal(n.counts.students, ids.size, n.id); assert(n.stepIds.length > 0, n.id); }
});
await check('original tables unchanged', async () => { const after = await fingerprint(); assert.deepEqual(after, before); });

if (HTTP) {
  const origin = new URL(HTTP).origin, get = (path, headers = {}) => fetch(`${HTTP}${path}`, { headers: { origin, 'sec-fetch-site': 'same-origin', ...headers } });
  await check(`HTTP ${HTTP}: tree, ETag/304, explicit errors, read-only`, async () => {
    const r = await get(`/api/flow/hierarchy?caseId=${CASE}`); assert.equal(r.status, 200);
    const body = await r.json(), tag = r.headers.get('etag');
    assert.deepEqual(body.counts, tree.counts); assert.equal(body.coverage.returnedRecords, tree.coverage.returnedRecords);
    assert.equal((await get(`/api/flow/hierarchy?caseId=${CASE}`, { 'if-none-match': tag })).status, 304);
    assert.equal((await get('/api/flow/hierarchy?caseId=nope')).status, 404);
    const task = (await (await get('/api/flow')).json()).cases.find(c => c.kind === 'source' && c.taskKind);
    if (task) assert.equal((await get(`/api/flow/hierarchy?caseId=${task.id}`)).status, 422);
    assert.equal((await fetch(`${HTTP}/api/flow/hierarchy?caseId=${CASE}`, { method: 'POST', headers: { origin } })).status, 405);
    console.log(`  analysis ${body.analysis.status} · completed ${body.analysis.completed} · pending ${body.analysis.pending} · failed ${body.analysis.failed} · manager ${body.managerSummary.status}`);
  });
}
await svc.close();
for (const r of results) console.log(r[0] === 'ok' ? `ok   ${r[1]}` : `FAIL ${r[1]}: ${r[2]}`);
console.log(`${results.filter(r => r[0] === 'ok').length}/${results.length}`);
process.exitCode = results.every(r => r[0] === 'ok') ? 0 : 1;
