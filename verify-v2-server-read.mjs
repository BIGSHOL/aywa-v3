// 2.0 서버 함수의 읽기 빠른 길(요청 단위 기억 · 역할 유지)이 종전 길과 같은 결과를 내는지 본다 — 돈 계산이 달라지면 안 된다.
// 종전 길 = 쓰기 동작(기억 없음 · 쿼리마다 역할 전환) + 되돌림. 금액은 출력하지 않는다.
// 실행: node --test experiments/owner-concept/verify-v2-server-read.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const { tenantId } = await import('./full-db.mjs');
const { runV2Server, stopV2Server } = await import('./v2-server-runner.mjs');
const { runInCall } = await import('./v2-server/context.mjs');
const P = await import('./v2-server/postgrest.mjs');

const person = async role => { const [u] = await db`select id::text id, tenant_id::text tenant_id, email, display_name, job_title, system_role::text system_role from public.users
  where tenant_id=${tenantId} and system_role=${role} and status='active' and not exists (select 1 from public.super_admins sa where sa.id = users.id) order by id limit 1`;
  return { id: u.id, tenantId: u.tenant_id, email: u.email ?? '', displayName: u.display_name, jobTitle: u.job_title, systemRole: u.system_role }; };
const both = async (module, fn, args, actorId) => {
  const step = [{ module, fn, args }];
  const fast = await runV2Server({ steps: step, actorId, tenantId, mode: 'read' });
  const slow = await runV2Server({ steps: step, actorId, tenantId, mode: 'write', rollback: true });
  return [fast.results, slow.results];
};
after(async () => { await stopV2Server(); await db?.end({ timeout: 2 }); });

test('강사 정산: 읽기 빠른 길 = 종전 길(원장 · 금액까지 같다)', { skip: SKIP, timeout: 120000 }, async () => {
  const owner = await person('master');
  const started = Date.now(), fast = await runV2Server({ steps: [{ module: 'features/payroll/server/tuition-view.ts', fn: 'getTeacherTuitionView', args: ['2026-10'] }], actorId: owner.id, tenantId, mode: 'read' }), fastMs = Date.now() - started;
  const t0 = Date.now(), slow = await runV2Server({ steps: [{ module: 'features/payroll/server/tuition-view.ts', fn: 'getTeacherTuitionView', args: ['2026-10'] }], actorId: owner.id, tenantId, mode: 'write', rollback: true }), slowMs = Date.now() - t0;
  assert.ok(fast.results[0].value.rows.length > 0, '줄이 있어야 비교가 뜻있다');
  assert.deepEqual(fast.results, slow.results);
  console.log(`강사 ${fast.results[0].value.rows.length}명 · 빠른 길 ${(fastMs / 1000).toFixed(1)}초 · 종전 길 ${(slowMs / 1000).toFixed(1)}초`);
});

test('사용자 역할 조회(RLS): 빠른 길 = 종전 길(원장 · 강사)', { skip: SKIP, timeout: 60000 }, async () => {
  for (const role of ['master', 'teacher']) {
    const u = await person(role);
    const [fast, slow] = await both('features/consultations/server/queries.ts', 'getStudentConsultationCounts', [], u.id);
    assert.deepEqual(fast, slow, role);
  }
});

test('역할 유지: 사용자·관리자가 번갈아도 맞고, 쿼리가 실패해도 다음 쿼리의 역할이 그대로다', { skip: SKIP, timeout: 30000 }, async () => {
  const owner = await person('master'), teacher = await person('teacher');
  const [{ n }] = await db`select count(*)::int n from public.invoices where tenant_id=${tenantId}`;
  await db.begin('isolation level repeatable read read only', sql => runInCall({ sql, metaSql: db, actor: owner, tenantId, memo: new Map(), stickyRole: true }, async () => {
    const user = P.sessionClient(), admin = P.adminClient();
    assert.equal((await user.from('invoices').select('*', { count: 'exact', head: true })).count, n, '원장 = 그 지점 전부');
    assert.equal((await admin.from('invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)).count, n);
    const bad = await user.from('invoices').select('no_such_column').limit(1);
    assert.ok(bad.error, '없는 칸 = 오류 값');
    assert.equal((await user.from('invoices').select('*', { count: 'exact', head: true })).count, n, '실패 뒤에도 같은 역할');
  }));
  await db.begin('isolation level repeatable read read only', sql => runInCall({ sql, metaSql: db, actor: teacher, tenantId, memo: new Map(), stickyRole: true }, async () => {
    const user = P.sessionClient(), admin = P.adminClient();
    assert.equal((await user.from('invoices').select('*', { count: 'exact', head: true })).count, 0, '강사 = 수납 정책에 막힘');
    assert.equal((await admin.from('invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)).count, n, '관리자 쪽은 역할이 풀린다');
    assert.equal((await user.from('invoices').select('*', { count: 'exact', head: true })).count, 0, '다시 강사로 돌아온다');
  }));
});
