// Live checks for model.workspaces against the local DB copy (read-only, no Claude call, no network).
//   OWNER_CONCEPT_INVENTORY=<feature-inventory.json> node experiments/owner-concept/verify-domain-snapshot.mjs
// Default inventory path = experiments/owner-concept/catalog/feature-inventory.json (after the catalog merge).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from './snapshot.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { AUDIT_ONLY, FAMILY_IDS, workspaceRecords } from './domain-snapshot.mjs';
import { EVIDENCE } from './domain-snapshot-core.mjs';
import { REASON_LABEL, SYSTEM_BULK_WITHDRAWAL_DATES } from './domain-snapshot-students2.mjs';
import { ROLE_LABEL } from './domain-snapshot-people.mjs';
import { handleWorkspaceRecords, queryRecords, searchRecords } from './domain-http.mjs';
import { buildAssistantContext, contextText, ISSUE_FAMILY } from './claude-bridge-context.mjs';

const done = [];
const check = (name, fn) => { fn(); done.push(name); };
const repo = new URL('../../', import.meta.url);
const inventoryPath = process.env.OWNER_CONCEPT_INVENTORY || fileURLToPath(new URL('./catalog/feature-inventory.json', import.meta.url));
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const snapshot = await loadSnapshot();
const ws = snapshot.workspaces, F = ws.families, store = workspaceRecords(), asOf = snapshot.meta.asOf, month = snapshot.meta.month;
const metric = (id, label) => F[id].metrics.find(m => m.label === label)?.value;

check('inventory families are all mapped, audit-only = not-applicable, owner families are never hidden', () => {
  assert.deepEqual([...inventory.families.map(f => f.id)].sort(), [...FAMILY_IDS].sort());
  for (const f of inventory.families) {
    if (f.ownerScope === 'audit-only') assert.equal(F[f.id].dataState, 'not-applicable', f.id);
    else assert.notEqual(F[f.id].dataState, 'not-applicable', f.id);
  }
  for (const id of AUDIT_ONLY) assert.equal(inventory.families.find(f => f.id === id).ownerScope, 'audit-only', id);
});

check('base read model is unchanged; evidence stays out of snapshot.js', () => {
  assert.deepEqual(Object.keys(snapshot).sort(), ['admissionChannels', 'admissions', 'approvals', 'assets', 'assetCount', 'attendance', 'boardings', 'calendar', 'channels', 'checkins', 'classes', 'communication', 'daily', 'documents', 'finance', 'invoices', 'learning', 'legacyHistory', 'makeup', 'messages', 'meta', 'months', 'runs', 'staff', 'students', 'supplies', 'tasks', 'textbooks', 'trend', 'vehicles', 'workspaces'].sort());
  const json = JSON.stringify(ws);
  assert(json.length < 400_000, `workspaces payload ${json.length}`);
  for (const f of Object.values(F)) { assert(f.records.length <= 12); assert.equal(f.totalRecords, (f[EVIDENCE] || []).length); assert.equal(store.families.get(f.id).records.length, f.totalRecords); }
});

check('same facts as the base model and the AX issues', () => {
  const bills = snapshot.invoices.filter(i => i.period === month), open = bills.filter(i => i.remaining > 0);
  assert.equal(metric('billing', '이번 달 청구액'), bills.reduce((n, i) => n + i.total, 0));
  assert.equal(metric('billing', '이번 달 수납'), bills.reduce((n, i) => n + i.paid, 0));
  assert.equal(metric('billing', '이번 달 남은 금액'), 329000); assert.equal(open.length, 14);
  assert.equal(F.billing.signals[0].recordIds.length, 14);
  assert.equal(metric('billing', '이번 달 할인 전 금액') - metric('billing', '이번 달 할인') - metric('billing', '이번 달 수납'), 329000, 'unpaid = gross − discount − paid');
  assert.equal(metric('students', '재원'), snapshot.students.filter(s => s.status === 'enrolled').length);
  assert.equal(metric('attendance', '이번 달 출결 칸'), snapshot.attendance.statuses.reduce((n, s) => n + s.count, 0));
  assert.equal(metric('attendance', '이번 달 결석'), snapshot.attendance.statuses.find(s => s.label === 'absent').count);
  const leads = snapshot.admissions.filter(a => a.date.startsWith(month));
  assert.equal(metric('enrollment', '이번 달 접수'), leads.length);
  const unfinished = leads.filter(a => ['scheduled', 'consulted', 'ai_done'].includes(a.outcome));
  const completedOnBoard = new Set(F.enrollment[EVIDENCE].filter(r => r.status === '등록 완료').map(r => r.id));
  assert.equal(metric('enrollment', '이번 달 접수 중 상담·검토 단계'), unfinished.filter(a => !completedOnBoard.has(a.id)).length);
  assert.deepEqual(new Set(F.enrollment.signals.find(s => s.id === 'enrollment-followup')?.recordIds || []), new Set(unfinished.filter(a => !completedOnBoard.has(a.id)).map(a => a.id)));
  assert.equal(metric('tasks-notifications', '지난 업무'), snapshot.tasks.filter(t => t.status === 'open' && t.due && t.due < asOf).length);
  assert.equal(metric('textbook-requests', '요청·주문 단계'), snapshot.textbooks.filter(t => ['requested', 'ordered'].includes(t.status)).length);
  assert.equal(metric('approvals', '결재 대기'), snapshot.approvals.filter(a => a.status === 'pending').length);
  assert.equal(metric('classes', '운영 중인 반'), snapshot.classes.length);
  assert.equal(metric('staff', '현재 재직'), snapshot.staff.length);
  assert.equal(metric('payroll', '급여명세서'), snapshot.finance.payslips.length);
  assert.equal(metric('lesson-reports', '이번 달 보고서'), snapshot.communication.reports);
  assert.equal(metric('enrollment', '이번 달 접수 중 등록'), snapshot.trend.find(t => t.month === month).registered);
});

const db = await openFullDatabase();
try {
  await db.begin('isolation level repeatable read read only', async sql => {
    const count = async table => (await sql`select count(*)::int c from ${sql(`public.${table}`)} where tenant_id=${tenantId}`)[0].c;
    // Families whose evidence is the whole tenant table — an independent count must match.
    for (const [id, tables] of Object.entries({ onescreen: ['classnote_notices'], approvals: ['approval_documents'], documents: ['academy_documents'], calendar: ['calendar_events'], 'tasks-notifications': ['staff_tasks'], slack: ['slack_rules'], inventory: ['inventory_assets'], 'withdrawal-reports': ['withdrawal_reports', 'withdrawal_report_archives'], payroll: ['payslips'], 'class-sheets': ['class_sheet_plan_lines'], 'owner-settings': ['notice_popups', 'operating_periods', 'classrooms'] })) {
      let n = 0; for (const table of tables) n += await count(table);
      assert.equal(F[id].totalRecords, n, `${id} evidence = full ${tables.join('+')}`);
    }
    // 직원 평가 = 포트폴리오 전체 + 만족도 확인 대기 글(원장 10-28 '만족도를 확인하러 가고 싶은데' — 근거로 함께 실었다).
    const [{ c: pendingSatisfaction }] = await sql`select count(*)::int c from public.teacher_satisfaction_judgments where tenant_id=${tenantId} and state='pending'`;
    assert.equal(F['class-review'].totalRecords, await count('teacher_portfolio_months') + pendingSatisfaction, 'class-review evidence = portfolio + pending satisfaction');
    // 외부 연동 = 메이크에듀 동기화 전체 + 오류가 남은(켜진) 연동 — '연동 오류' 신호가 가리키는 근거(AX-H5).
    const [{ c: failingLinks }] = await sql`select count(*)::int c from public.user_integrations where tenant_id=${tenantId} and coalesce(sync_enabled,false) and last_error is not null`;
    assert.equal(F.integrations.totalRecords, await count('makeedu_sync_runs') + failingLinks, 'integrations evidence = makeedu runs + failing links');
    const sheet = F.integrations.signals.find(s => s.id === 'sheet-sync-error');
    if (failingLinks) assert.equal(sheet?.recordIds.length, failingLinks, 'the link-error signal points at every failing link');
    for (const r of (F.integrations[EVIDENCE] || []).filter(x => x.facetIds.includes('link-error'))) assert.deepEqual(r.fields.map(f => f.label), ['오류 기록'], 'link records carry only the error time beside name · status · summary');
    done.push('whole-table families match independent counts');

    // Every evidence id is a row of its source table in this tenant, and of no other tenant.
    const tables = new Set((await sql`select table_name from information_schema.tables where table_schema='public'`).map(r => r.table_name));
    for (const f of Object.values(F)) {
      const ids = (f[EVIDENCE] || []).map(r => r.id); if (!ids.length) continue;
      const sources = f.recordSource.split(','); for (const s of sources) assert(/^[a-z_]+$/.test(s) && tables.has(s), `${f.id} source ${s}`);
      const found = new Set(), foreign = [];
      for (const s of sources) {
        // 표마다 id 모양이 다르다(직원 평가 = 포트폴리오 '선생님:월' + 만족도 판정 id).
        const composite = s === 'teacher_portfolio_months', keyed = s === 'tenant_settings';
        const idExpr = composite ? sql`teacher_id::text||':'||month` : keyed ? sql`tenant_id::text` : sql`id::text`;
        for (const r of await sql`select ${idExpr} as id, tenant_id = ${tenantId} as own from ${sql(`public.${s}`)} where ${idExpr} = any(${ids})`) { if (r.own) found.add(r.id); else foreign.push(r.id); }
      }
      assert.equal(foreign.length, 0, `${f.id}: evidence from another tenant`);
      assert.equal(found.size, new Set(ids).size, `${f.id}: evidence ids not all found in ${f.recordSource}`);
    }
    done.push('evidence ids are tenant rows of their declared source (no other-tenant rows)');

    // No contact values, tokens or account numbers anywhere in snapshot.js workspaces or the record store.
    const secrets = (await sql`select v from (
      select parent_phone v from public.students union all select student_phone from public.students union all select home_phone from public.students
      union all select email from public.users union all select phone from public.users union all select parent_phone from public.enrollment_consultations
      union all select student_phone from public.enrollment_consultations union all select address from public.enrollment_consultations union all select account_number from public.expenses
      union all select token_hash from public.kiosk_devices union all select token from public.intake_tokens union all select token_hash from public.homework_video_links
      union all select token_hash from public.sync_agent_devices union all select driver_phone from public.shuttle_vehicles union all select login_email from public.parent_accounts
    ) x where v is not null and length(v) >= 8`).map(r => r.v)
      // Real contacts/tokens only: emails, 8+ digit numbers, long tokens/addresses (a name typed into a phone column is not a contact).
      .filter(v => /@/.test(v) || v.replace(/\D/g, '').length >= 8 || v.length >= 12);
    // Whole browser payload (base fields + workspaces) and the record store; UUIDs are removed before the
    // pattern scan because their hex groups can contain digit runs.
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const blob = (JSON.stringify(snapshot) + JSON.stringify([...store.families.values()].map(f => f.records))).replace(uuid, '');
    for (const v of new Set(secrets)) assert(!blob.includes(v), 'a contact/token/account value leaked');
    assert(!/(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/.test(blob), 'phone-like value'); assert(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(blob), 'email-like value');
    // Masking is value-only: masked base calendar titles keep their other words and every date/amount.
    const masked = snapshot.calendar.filter(e => e.title.includes('연락처 가림'));
    assert(masked.length > 0 && masked.every(e => e.title.replace(/연락처 가림/g, '').trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date)));
    done.push(`no contact/token/account values in snapshot.js or the record store (${secrets.length} known values; ${masked.length} calendar titles masked value-only)`);
  });
} finally { await db.end(); }

check('no raw codes in UI text (facet labels, metric labels, record status)', () => {
  const code = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$|^[a-z][a-z0-9-]*:[a-z0-9_-]+$|^(?:math|english|science|korean|pending|approved|open|done|active|inactive|enrolled|withdrawn|success|failed|none|other)$/;
  const bad = [];
  for (const f of Object.values(F)) {
    for (const x of f.facets) if (code.test(x.label)) bad.push(`${f.id} facet ${x.label}`);
    for (const m of f.metrics) if (code.test(m.label)) bad.push(`${f.id} metric ${m.label}`);
    for (const r of f[EVIDENCE] || []) if (code.test(r.status)) { bad.push(`${f.id} status ${r.status}`); break; }
  }
  assert.deepEqual(bad, []);
});

check('dates: trends never pass asOf; only scheduled families carry future record dates', () => {
  const future = new Set(['calendar', 'makeups', 'class-sheets', 'owner-settings', 'tasks-notifications', 'billing', 'withdrawal-reports']);
  for (const f of Object.values(F)) for (const r of f[EVIDENCE] || []) if (r.date && !future.has(f.id)) assert(r.date <= asOf, `${f.id} ${r.date}`);
});

check('records endpoint: strict params, facet counts = filter results, search, paging', () => {
  assert.equal(queryRecords(store, 'nope', new URLSearchParams()).status, 404);
  for (const bad of ['x=1', 'pageSize=101', 'page=0', 'page=1&page=2', `q=${'a'.repeat(101)}`, 'facet=unknown']) assert.equal(queryRecords(store, 'billing', new URLSearchParams(bad)).status, 400, bad);
  for (const f of Object.values(F)) {
    const all = queryRecords(store, f.id, new URLSearchParams('pageSize=100')).body;
    assert.equal(all.total, f.totalRecords); assert.equal(all.filteredTotal, f.totalRecords);
    for (const x of f.facets) assert.equal(queryRecords(store, f.id, new URLSearchParams({ facet: x.id })).body.filteredTotal, x.count, `${f.id} ${x.id}`);
    if (f.records[0]) assert(queryRecords(store, f.id, new URLSearchParams({ q: f.records[0].label, pageSize: '100' })).body.filteredTotal >= 1);
  }
  const last = queryRecords(store, 'lesson-reports', new URLSearchParams({ page: '100000', pageSize: '100' })).body;
  assert.deepEqual(last.items, []); assert.equal(last.total, F['lesson-reports'].totalRecords);
  // ids= — 여러 건 한 번에: 단독으로만 · 요청 순서 · 없는 id 빼기 · 같은 id 한 번 · 최대 100개.
  const bills = store.families.get('billing').records, [a, b, c] = [bills[0].id, bills[1].id, bills[2].id];
  const many = queryRecords(store, 'billing', new URLSearchParams({ ids: [c, 'no-such-record', a, b, a].join(',') }));
  assert.equal(many.status, 200); assert.deepEqual(many.body.items.map(r => r.id), [c, a, b]); assert.equal(many.body.familyId, 'billing');
  assert.deepEqual(queryRecords(store, 'billing', new URLSearchParams({ ids: 'no-such-record' })).body.items, []);
  assert.deepEqual(queryRecords(store, 'billing', new URLSearchParams({ ids: a })).body.items.map(r => r.id), [a]);
  const hundred = bills.slice(0, 100).map(r => r.id);
  assert.equal(queryRecords(store, 'billing', new URLSearchParams({ ids: hundred.join(',') })).body.items.length, 100);
  for (const bad of ['ids=', `ids=${a},`, `ids=${a}&ids=${b}`, `ids=${a}&id=${b}`, `ids=${a}&q=x`, `ids=${a}&pageSize=5`, 'ids=a%20b', `ids=${[...hundred, bills[100].id].join(',')}`]) assert.equal(queryRecords(store, 'billing', new URLSearchParams(bad)).status, 400, bad);
  assert.equal(queryRecords(store, 'nope', new URLSearchParams({ ids: a })).status, 404);
  // 이름 칸에서 뺀 날짜도 화면 모양(M/D)으로 찾힌다.
  const absent = store.families.get('attendance').records.find(r => r.status === '결석');
  const shown = `${Number(absent.date.slice(5, 7))}/${Number(absent.date.slice(8, 10))}`;
  assert(queryRecords(store, 'attendance', new URLSearchParams({ q: `${absent.label} ${shown}`, pageSize: '100' })).body.items.some(r => r.id === absent.id), 'M/D search');
  // 통합 검색: 영역 이름 낱말은 기록이 다른 낱말을 맞혔을 때만 채운다("김소은 퇴원보고서") · 영역 이름 하나만으로는 맞지 않는다.
  const wr = store.families.get('withdrawal-reports').records[0];
  if (wr) assert(searchRecords(store, new URLSearchParams({ q: `${wr.label} 퇴원보고서` })).body.groups.some(g => g.familyId === 'withdrawal-reports'), 'family word fills in');
  assert(!searchRecords(store, new URLSearchParams({ q: '출석부' })).body.groups.some(g => g.familyId === 'attendance'), 'family word alone matches nothing');
});

check('signals: facet = the same record set as recordIds · at = latest record time, never past asOf', () => {
  const missing = [];
  for (const f of Object.values(F)) for (const s of f.signals) {
    if (s.at !== undefined) assert(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/.test(s.at) && s.at.slice(0, 10) <= asOf, `${f.id} ${s.id} at ${s.at}`);
    if (!s.recordIds.length) continue; // 기록 없이 서는 신호는 없어야 하지만(연동 오류도 이제 오류 연동 행을 가리킨다) 있으면 아래 단언이 아니라 업무 흐름 배선 검사가 잡는다
    if (!s.facet || s.at === undefined) missing.push(`${f.id} ${s.id}`);
    if (!s.facet) continue;
    const viaFacet = (f[EVIDENCE] || []).filter(r => r.facetIds.includes(s.facet)).map(r => r.id).sort();
    assert.deepEqual(viaFacet, [...s.recordIds].sort(), `${f.id} ${s.id} facet ${s.facet}`);
    assert.equal(queryRecords(store, f.id, new URLSearchParams({ facet: s.facet })).body.filteredTotal, s.recordIds.length, `${f.id} ${s.id} endpoint`);
  }
  assert.deepEqual(missing, [], 'every signal with records carries facet and at');
});

check('person records: the name cell is the person, no date repeated in it', () => {
  const one = id => (F[id][EVIDENCE] || [])[0];
  for (const id of ['attendance', 'makeups', 'lesson-reports', 'video-homework', 'withdrawal-reports', 'billing', 'textbook-requests', 'payroll']) {
    const r = one(id); if (!r) continue;
    assert(!/\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}/.test(r.label), `${id} label carries a date: ${r.label}`);
  }
  const students = new Set(snapshot.students.map(s => s.name));
  for (const id of ['attendance', 'makeups', 'lesson-reports', 'video-homework', 'billing']) { const r = one(id); if (r) assert(students.has(r.label), `${id} label is a student: ${r.label}`); }
  for (const r of (F.inventory[EVIDENCE] || [])) { const words = r.detail.split(' '); assert(words.length < 2 || words[0] !== words[1], `inventory detail repeats the maker: ${r.detail}`); }
});

check('assistant context carries domain metrics but no personal names or payroll amounts', () => {
  const ctx = buildAssistantContext(snapshot), all = contextText(ctx, null);
  assert(all.includes('[업무 영역 집계]'));
  // Account names that are role words (e.g. a shared '관리자' login) are not personal names.
  const generic = new Set([...Object.values(ROLE_LABEL), '선생님', '직원', '사무실']);
  const names = new Set([...snapshot.students, ...snapshot.staff, ...snapshot.admissions].map(p => p.name).filter(n => typeof n === 'string' && n.trim().length >= 2 && !generic.has(n.trim())));
  assert.deepEqual([...names].filter(n => all.includes(n)), []);
  const short = f => f.title.split('(')[0].trim();
  for (const issue of Object.keys(ISSUE_FAMILY)) assert(contextText(ctx, issue).includes(short(F[ISSUE_FAMILY[issue]])));
  assert(!all.split('\n').find(l => l.startsWith(`- ${short(F.payroll)}:`)).includes('원'), 'payroll line has no amounts');
});

const src = p => readFile(new URL(p, repo), 'utf8');
const reasonSrc = await src('src/features/withdrawals/types.ts'), roleSrc = await src('src/lib/auth/role-hierarchy.ts'), bulkSrc = await src('src/features/withdrawals/system-bulk.ts');
for (const [k, v] of Object.entries(REASON_LABEL)) assert(reasonSrc.includes(`${k}: "${v}"`), `REASON_LABEL ${k}`);
for (const [k, v] of Object.entries(ROLE_LABEL)) assert(roleSrc.includes(`${k}: "${v}"`), `ROLE_LABEL ${k}`);
for (const d of SYSTEM_BULK_WITHDRAWAL_DATES) assert(bulkSrc.includes(`"${d}"`), `bulk date ${d}`);
done.push('copied 2.0 label tables (withdrawal reasons, roles, bulk dates) match their sources');

// Same handler serve-live.mjs mounts: GET/HEAD JSON, other methods 405.
const server = createServer((req, res) => { if (!handleWorkspaceRecords(req, res, { 'Cache-Control': 'no-store' })) { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const call = (method, path) => new Promise((resolve, reject) => { const q = request({ host: '127.0.0.1', port: server.address().port, method, path, agent: false }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: b })); }); q.on('error', reject); q.end(); });
const ok = await call('GET', '/api/workspaces/billing/records?facet=remaining&pageSize=5');
assert.equal(ok.status, 200); assert.match(ok.type, /application\/json/); assert.equal(JSON.parse(ok.body).items.length, 5);
const pair = store.families.get('billing').records.slice(0, 2).map(r => r.id);
const several = await call('GET', `/api/workspaces/billing/records?ids=${pair.reverse().join(',')}`);
assert.equal(several.status, 200); assert.deepEqual(JSON.parse(several.body).items.map(r => r.id), pair);
assert.equal((await call('POST', '/api/workspaces/billing/records')).status, 405);
assert.equal((await call('GET', '/api/workspaces/Billing/records')).status, 404);
server.close();
done.push('records HTTP handler: JSON for GET, 405 for POST');

console.log(`workspaces ok · ${FAMILY_IDS.length} families (${Object.values(F).filter(f => f.dataState === 'available').length} available, ${Object.values(F).filter(f => f.dataState === 'empty').length} empty, ${Object.values(F).filter(f => f.dataState === 'unavailable').length} unavailable, ${AUDIT_ONLY.length} not-applicable) · ${[...store.families.values()].reduce((n, f) => n + f.records.length, 0)} evidence records`);
for (const d of done) console.log(`  ✓ ${d}`);
