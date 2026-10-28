// 직원관리 하위 화면(작업자 B) 시험 — 연차 관리 · 급여명세서 · 이력서.
//  · 2.0 서버 함수 이름 · 호스트로 옮긴 페이지가 2.0 원문 그대로인지
//  · 연차 잔여가 전자결재(approvals load의 balance)와 같은 숫자인지(조정 전·후 둘 다)
//  · 게이트(연차 조정 지정 · 직원관리 메뉴 · 과목 범위) · restricted(이력서 내용)가 권한 없는 사람의 응답에 없는지
//  · 저장(연차 조정 추가·취소 · 이력서 작성·수정·삭제 · 사진 티켓 거절) = 같은 검증·표·감사로그 — 모두 트랜잭션 안에서 돌린 뒤 되돌린다.
// 사용: node experiments/owner-concept/verify-v2-staff-sub.mjs [--build]  (--build = 임시 폴더로 호스트 빌드까지)
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { staffSubLoad, staffSubActions, isStaffSubPath, staffSubParams } from './v2-staff-sub.mjs';
import { screen as approvals } from './v2-screen-approvals.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const lf = s => s.replace(/\r\n/g, '\n');
const here = async rel => lf(await readFile(new URL(rel, import.meta.url), 'utf8'));
const src = async rel => lf(await readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8'));
const LEAVE = 'features/leave/server/actions.ts', RESUME = 'features/staff/resume/server/resume-actions.ts';
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75', YEWON = '8bb70f71-a8c3-450c-9236-561e9b43ca4f', TESTER = '09705ab8-05cf-48ab-8f06-d54a3d990b5c';
const SOYUN = 'a2df25d8-6857-45de-b95e-57b22b829bd7', YUJIN = 'd3e9bcd1-f30e-4f5b-9e78-2ad509f1d06b'; // 엄소윤(연차 조정 지정 · 관리자) · 정유진(관리자 · 영어 범위)

const db = await openFullDatabase();
const load = (sql, p, params = {}) => staffSubLoad({ sql, params: { v2path: p, ...params }, tenantId, importV2, path: p });
const ro = fn => db.begin('isolation level repeatable read read only', fn);
const ROLL = new Error('rollback');
const tx = async fn => {
  let out;
  try {
    await db.begin(async sql => {
      const queue = async () => (await sql`select to_regclass('net.http_request_queue') is not null p`)[0].p ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
      const before = await queue();
      out = await fn(sql);
      assert.equal(await queue(), before, '바깥으로 나가는 요청이 쌓이지 않는다');
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  return out;
};
const form = o => ({ $formData: Object.entries(o).map(([k, v]) => [k, String(v)]) });
const act = (sql, name, module, actor, args) => staffSubActions[name].run({ sql, body: staffSubActions[name].validate({ module, actor, args }), tenantId, importV2 });
const leave = (sql, name, actor, fields) => act(sql, name, LEAVE, actor, [null, form(fields)]);
/** 이 시험 안에서만 직원관리·전자결재 메뉴를 개인별로 연다(학원 설정 permissions.userOverrides — 되돌림). */
async function grant(sql, list) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
  const data = row?.data ?? {}, perms = data.permissions ?? {};
  const userOverrides = [...(Array.isArray(perms.userOverrides) ? perms.userOverrides : []), ...list];
  await sql`update public.tenant_settings set data = ${sql.json({ ...data, permissions: { ...perms, userOverrides } })} where tenant_id=${tenantId}`;
}
const counts = sql => sql`select (select count(*)::int from public.leave_adjustments where tenant_id=${tenantId}) adj,
  (select count(*)::int from public.academy_documents where tenant_id=${tenantId}) docs,
  (select count(*)::int from public.audit_logs where tenant_id=${tenantId}) audits,
  (select md5(string_agg(id::text || coalesce(department,'') || coalesce(job_title,'') || coalesce(phone,''), ',' order by id)) from public.users where tenant_id=${tenantId}) users_sig,
  (select md5(data::text) from public.tenant_settings where tenant_id=${tenantId}) settings_sig`;
const myAudits = sql => sql`select action, actor_id::text actor_id, target_type, target_label, metadata from public.audit_logs
  where tenant_id=${tenantId} and created_at >= now() and metadata->>'via' = '3.0 연습 복사본' order by created_at`;
/** 전자결재 결재함의 '내 연차' — 같은 사람으로 본 approvals load의 balance. */
// approvals.load는 제 읽기 트랜잭션 안에서 신분을 그 사람으로 바꾼다(되돌리지 않음) — 쓰기 시험 트랜잭션 안에선 savepoint로 감싸고 되돌린다.
const approvalsBalance = async (sql, actor) => {
  try { return (await sql.savepoint(s => approvals.load({ sql: s, params: { actor }, tenantId, importV2 }))).balance; }
  finally { await sql`reset role`; await sql`select set_config('request.jwt.claims', '', true)`; }
};
const sameBalance = (row, bal, who) => {
  assert.ok(bal, `${who}: 전자결재 잔여가 있다`);
  for (const k of ['granted', 'used', 'pending', 'remaining', 'adjustment']) assert.equal(row[k], bal[k], `${who} ${k}: 연차 관리 ${row[k]} = 전자결재 ${bal[k]}`);
  assert.deepEqual(row.period, bal.period, `${who} 연차 구간`);
};

try {
  const before = (await counts(db))[0];

  await check('2.0 서버 함수 이름이 그대로다(연차 2 · 이력서 3)', async () => {
    const names = async (rel, re) => [...(await src(rel)).matchAll(re)].map(m => m[1]);
    const leaveNames = await names(LEAVE, /export async function (\w+)\(\s*_prev: LeaveActionState,\s*formData: FormData,?\s*\)/g);
    const resumeNames = await names(RESUME, /export async function (\w+)\(/g);
    assert.deepEqual([...leaveNames, ...resumeNames].sort(), Object.keys(staffSubActions).sort());
    assert.equal(Object.keys(staffSubActions).length, 5);
  });

  await check('경로 판정 · 주소 열쇠', async () => {
    for (const p of ['/staff/annual-leave', '/staff/payroll', `/staff/${YEWON}/payroll`, '/staff/resumes', '/staff/resumes/new', `/staff/resumes/${YEWON}`]) assert.ok(isStaffSubPath(p), p);
    for (const p of ['/staff', `/staff/${YEWON}`, '/staff/annual-leavex', '/staff/resumes/abc']) assert.ok(!isStaffSubPath(p), p);
    assert.ok(staffSubParams.staff.test(YEWON) && staffSubParams.edit.test('1') && !staffSubParams.edit.test('2'));
    const host = await here('./v2-host/src/staff-sub.tsx');
    assert.match(host, /annual-leave\|payroll\|resumes\(\?:\/new\|\/\$\{UUID\}\)\?\|\$\{UUID\}\/payroll/, '호스트 판정이 서버와 같은 경로');
  });

  await check('호스트로 옮긴 페이지 = 2.0 원문 그대로(자료 받는 부분만 바뀜)', async () => {
    const tail = (t, from) => t.slice(t.indexOf(from));
    assert.equal(tail(await here('./v2-host/src/staff-sub-annual-leave.tsx'), '  const adjusted'), tail(await src('app/(shell)/staff/annual-leave/page.tsx'), '  const adjusted'), '연차 관리');
    const mine = await here('./v2-host/src/staff-sub-resume.tsx');
    const view = tail(await src('app/(shell)/staff/resumes/[id]/page.tsx'), '  return (\n')
      .replace(/          photoUrls=\{await \(async \(\) => \{[\s\S]*?\}\)\(\)\}\n/, '          photoUrls={data.photoUrls}\n');
    const neu = tail(await src('app/(shell)/staff/resumes/new/page.tsx'), '  return (\n')
      .replace('assignableRoles={!staff ? assignableRoles(user.systemRole) : []}', 'assignableRoles={page.assignableRoles}');
    const viewMine = mine.slice(mine.indexOf('  return (\n'), mine.indexOf('\n\nexport function NewResumePage') + 1);
    assert.equal(viewMine, view, '이력서 보기');
    assert.equal(tail(mine.slice(mine.indexOf('export function NewResumePage')), '  return (\n'), neu, '이력서 작성');
  });

  await check('급여명세서 = 2.0처럼 급여 기능이 꺼진 지점은 직원관리로(급여 값은 응답에 없다)', () => ro(async sql => {
    for (const p of ['/staff/payroll', `/staff/${YEWON}/payroll`]) {
      const d = await load(sql, p, { actor: SEOLHYUN });
      assert.equal(d.redirect, '/staff', p);
      assert.ok(!/hourly|monthly_base|payroll_records|net_amount/i.test(JSON.stringify(d)), p);
    }
    assert.equal((await load(sql, '/staff/resumes', { actor: SEOLHYUN })).redirect, '/staff');
  }));

  await check('연차 관리 읽기 — 원장은 전 직원 · 잔여가 전자결재와 같은 숫자', () => tx(async sql => {
    await grant(sql, [{ userId: YEWON, menu: 'approvals', access: 'full' }, { userId: TESTER, menu: 'approvals', access: 'full' }]);
    const d = await load(sql, '/staff/annual-leave', { actor: SEOLHYUN });
    assert.ok(d.overview.rows.length > 10 && d.overview.tableReady && d.overview.usedRangeReady);
    assert.ok(!/hourly_rate|monthly_base|resident|account/i.test(JSON.stringify(d)), '연차 응답에 급여·주민번호·계좌 칸이 없다');
    for (const who of [YEWON, TESTER]) sameBalance(d.overview.rows.find(r => r.userId === who), await approvalsBalance(sql, who), who);
  }));

  await check('게이트 — 조정 지정이 없으면 직원관리로 · 지정된 관리자는 열림 · 과목 범위는 범위 안 직원만', () => tx(async sql => {
    await grant(sql, [{ userId: SOYUN, menu: 'staff', access: 'full' }, { userId: YUJIN, menu: 'staff', access: 'full' }]);
    assert.equal((await load(sql, '/staff/annual-leave', { actor: YUJIN })).redirect, '/staff', '지정 없는 관리자');
    const r = await leave(sql, 'addLeaveAdjustment', YUJIN, { userId: TESTER, mode: 'delta', days: '1', reason: '' });
    assert.equal(r.error, '연차를 조정할 권한이 없습니다');
    const s = await load(sql, '/staff/annual-leave', { actor: SOYUN });
    assert.ok(s.overview?.rows.length > 10, '지정된 관리자');
    // 정유진(영어 범위)을 조정 담당으로도 지정 — 범위 밖(수학) 직원은 표에도 없고 조정도 거절.
    const [row] = await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
    const data = row.data; data.permissions.specialAccess.leaveAdjusterIds = [...data.permissions.specialAccess.leaveAdjusterIds, YUJIN];
    await sql`update public.tenant_settings set data=${sql.json(data)} where tenant_id=${tenantId}`;
    const scoped = await load(sql, '/staff/annual-leave', { actor: YUJIN });
    const [math] = await sql`select id::text id from public.users where tenant_id=${tenantId} and status::text='active' and subjects = array['math'] limit 1`;
    assert.ok(scoped.overview.rows.length > 0 && !scoped.overview.rows.some(x => x.userId === math.id), '범위 밖 직원 없음');
    assert.equal((await leave(sql, 'addLeaveAdjustment', YUJIN, { userId: math.id, mode: 'delta', days: '1' })).error, '담당 과목 밖의 직원은 볼 수 없습니다');
  }));

  await check('연차 조정 추가·취소 — 2.0 검증 문구 · 표 · 감사로그 · 두 화면 잔여 같이 바뀜', () => tx(async sql => {
    await grant(sql, [{ userId: TESTER, menu: 'approvals', access: 'full' }, { userId: YEWON, menu: 'approvals', access: 'full' }]);
    const add = f => leave(sql, 'addLeaveAdjustment', SEOLHYUN, f);
    assert.equal((await add({ userId: 'x', days: '1' })).error, '대상 직원을 선택하세요');
    assert.equal((await add({ userId: TESTER, days: '' })).error, '일수를 입력하세요');
    assert.equal((await add({ userId: TESTER, days: '0.3' })).error, '연차는 0.25일(반반차) 단위로만 조정할 수 있습니다');
    assert.equal((await add({ userId: TESTER, days: '0' })).error, '0일은 조정이 아닙니다 — 늘릴 일수(+)나 줄일 일수(−)를 입력하세요');
    assert.equal((await add({ userId: TESTER, days: '1', usedEnd: '2026-01-01' })).error, '사용 시작일을 먼저 고르세요');
    assert.equal((await add({ userId: TESTER, days: '101' })).error, '한 번에 조정할 수 있는 일수는 100일까지입니다');
    const ye = (await load(sql, '/staff/annual-leave', { actor: SEOLHYUN })).overview.rows.find(r => r.userId === YEWON);
    if (ye.used + ye.pending > 0) assert.match((await add({ userId: YEWON, mode: 'total', days: String(Math.max(0, ye.used + ye.pending - 1)) })).error, /^이미 사용·결재중인 .+보다 적게 조정할 수 없습니다/);
    const r0 = (await load(sql, '/staff/annual-leave', { actor: SEOLHYUN })).overview.rows.find(r => r.userId === TESTER);
    assert.equal((await add({ userId: TESTER, mode: 'total', days: String(r0.granted) })).error, `이미 총 ${(await importV2('features/leave/request-days.ts')).formatLeaveDays(r0.granted)}입니다 — 바뀌는 값이 없습니다`);
    const ok = await add({ userId: TESTER, mode: 'delta', days: '-1.5', reason: '정산(시험)', usedStart: r0.period.start, usedEnd: r0.period.start });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match(ok.notice, /^테스터 연차 [−-]1\.5일 — 총 /);
    const r1 = (await load(sql, '/staff/annual-leave', { actor: SEOLHYUN })).overview.rows.find(r => r.userId === TESTER);
    assert.equal(r1.adjustment, r0.adjustment - 1.5); assert.equal(r1.granted, r0.granted - 1.5);
    assert.equal(r1.adjustments[0].createdByName, '설현'); assert.equal(r1.adjustments[0].usedStart, r0.period.start);
    sameBalance(r1, await approvalsBalance(sql, TESTER), '조정 뒤 테스터');
    const del = await leave(sql, 'deleteLeaveAdjustment', SEOLHYUN, { adjustmentId: r1.adjustments[0].id });
    assert.equal(del.ok, true); assert.match(del.notice, /^테스터 연차 조정 [−-]1\.5일을 취소했습니다$/);
    assert.equal((await leave(sql, 'deleteLeaveAdjustment', SEOLHYUN, { adjustmentId: r1.adjustments[0].id })).error, '이미 삭제된 조정입니다');
    sameBalance((await load(sql, '/staff/annual-leave', { actor: SEOLHYUN })).overview.rows.find(r => r.userId === TESTER), await approvalsBalance(sql, TESTER), '취소 뒤 테스터');
    const logs = await myAudits(sql);
    assert.deepEqual(logs.map(l => l.action), ['leave_adjust', 'leave_adjust_delete']);
    assert.equal(logs[0].target_label, '테스터'); assert.equal(logs[0].actor_id, SEOLHYUN); assert.equal(logs[0].metadata.days, -1.5);
    assert.equal(logs[0].metadata.before, r0.granted); assert.equal(logs[0].metadata.after, r0.granted - 1.5);
  }));

  await check('이력서 restricted — 열람 자격이 없는 사람의 응답엔 이력서 내용이 없다 · 수정·삭제도 거절', () => tx(async sql => {
    await grant(sql, [{ userId: YUJIN, menu: 'staff', access: 'full' }]);
    const [math] = await sql`select d.id::text id from public.academy_documents d join public.users u on u.id=d.staff_user_id
      where d.form_type='staff_resume' and u.subjects = array['math'] limit 1`;
    const d = await load(sql, `/staff/resumes/${math.id}`, { actor: YUJIN });
    assert.equal(d.canView, false);
    for (const k of ['data', 'photoUrls', 'staffUserId']) assert.ok(!(k in d), `응답에 ${k} 없음`);
    assert.ok(!/form_data|residentNo|account|salary/i.test(JSON.stringify(d)));
    assert.equal((await act(sql, 'deleteStaffResume', RESUME, YUJIN, [math.id])).error, '이력서는 직원관리 권한이 있는 계정과 본인만 열람·수정할 수 있습니다');
    assert.equal((await act(sql, 'saveStaffResume', RESUME, YUJIN, [null, form({ id: math.id, p_name: '바꿈' })])).error, '이력서는 직원관리 권한이 있는 계정과 본인만 열람·수정할 수 있습니다');
    const m = await load(sql, `/staff/resumes/${math.id}`, { actor: SEOLHYUN });
    assert.equal(m.canView, true); assert.ok(m.data?.personal && m.photoUrls.every(u => u === null), '원장은 열람(사진 주소는 만들지 않음)');
  }));

  await check('이력서 작성 → 수정 → 삭제 — 같은 표·경고 모양·감사로그 · 사진 티켓은 거절', () => tx(async sql => {
    const created = await act(sql, 'saveStaffResume', RESUME, SEOLHYUN, [null, form({ p_name: '시험 이력서', p_email: '', acct_register: '1', acct_role: 'teacher' })]);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.redirectTo, `/staff/resumes/${created.id}`);
    assert.match(created.warning, /^이력서는 저장됐지만 계정 생성에 실패했습니다 — /);
    const [row] = await sql`select restricted, kind, category, uploaded_by::text u, form_data->'personal'->>'name' n from public.academy_documents where id=${created.id}`;
    assert.deepEqual({ ...row }, { restricted: true, kind: 'form', category: 'hr', u: SEOLHYUN, n: '시험 이력서' });
    assert.equal((await act(sql, 'saveStaffResume', RESUME, SEOLHYUN, [null, form({ id: created.id, p_name: '' })])).error, '성명을 입력하세요');
    const edited = await act(sql, 'saveStaffResume', RESUME, SEOLHYUN, [null, form({ id: created.id, p_name: '시험 이력서2' })]);
    assert.equal(edited.ok, true);
    assert.equal((await sql`select form_data->'personal'->>'name' n from public.academy_documents where id=${created.id}`)[0].n, '시험 이력서2');
    const v = await load(sql, `/staff/resumes/${created.id}`, { actor: SEOLHYUN, edit: '1' });
    assert.equal(v.name, '시험 이력서2'); assert.equal(v.edit, '1');
    const photo = await act(sql, 'issueResumePhotoTicket', RESUME, SEOLHYUN, [null, form({ contentType: 'image/png', size: '100' })]);
    assert.ok(photo.error && !photo.ticket);
    assert.deepEqual(await act(sql, 'deleteStaffResume', RESUME, SEOLHYUN, [created.id]), { ok: true });
    assert.equal((await act(sql, 'deleteStaffResume', RESUME, SEOLHYUN, [created.id])).error, '이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다');
    const logs = await myAudits(sql);
    assert.deepEqual(logs.map(l => l.action), ['staff_resume_delete']);
    assert.equal(logs[0].target_label, '시험 이력서2'); assert.ok(!('form_data' in logs[0].metadata));
    // 작성 화면 — 직원 연결(?staff=)은 아는 정보로 미리 채우고 계정 옵션은 없다.
    const n = await load(sql, '/staff/resumes/new', { actor: SEOLHYUN, staff: TESTER });
    assert.equal(n.data.personal.name, '테스터'); assert.deepEqual(n.assignableRoles, []); assert.equal(n.staff.id, TESTER);
  }));

  await check('이력서 수정 — 성명은 직원 표시 이름까지 실제로 바뀌고(staff_name_change · door=resume) · 로그인 계정 있는 직원의 이메일은 거절 문구', () => tx(async sql => {
    // 로그인 계정이 있고 운영자 계정이 아닌 재직 직원에게 연결된 이력서 하나.
    const [r] = await sql`select d.id::text id, u.id::text uid, u.display_name, u.email from public.academy_documents d
      join public.users u on u.id = d.staff_user_id join auth.users a on a.id = u.id
      where d.form_type='staff_resume' and u.tenant_id=${tenantId} and u.status::text='active' and u.system_role::text <> 'master'
        and not exists (select 1 from public.super_admins s where s.id = u.id) order by d.created_at limit 1`;
    const v = await load(sql, `/staff/resumes/${r.id}`, { actor: SEOLHYUN });
    const base = { id: r.id, p_name: `${r.display_name}시험`, p_email: v.data.personal.email || '' };
    const renamed = await act(sql, 'saveStaffResume', RESUME, SEOLHYUN, [null, form(base)]);
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    assert.match(renamed.notice ?? '', new RegExp(`표시 이름을 '${r.display_name}시험'\\(으\\)로 바꿨습니다`));
    assert.equal((await sql`select display_name from public.users where id=${r.uid}`)[0].display_name, `${r.display_name}시험`);
    const [log] = await sql`select action, actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${tenantId} and action='staff_name_change' and created_at >= now()`;
    assert.ok(log, 'staff_name_change 감사로그'); assert.equal(log.actor_id, SEOLHYUN); assert.equal(log.metadata.door, 'resume', JSON.stringify(log.metadata)); assert.equal(log.metadata.via, '3.0 연습 복사본');
    const mailed = await act(sql, 'saveStaffResume', RESUME, SEOLHYUN, [null, form({ ...base, p_email: `staff-sub-test-${Date.now()}@example.invalid` })]);
    assert.equal(mailed.ok, true);
    assert.match(mailed.warning ?? '', /^이력서는 저장했지만 로그인 이메일은 바꾸지 못했습니다 — 로그인 계정 이메일 변경 실패 — 연습 화면에서는/);
    assert.equal((await sql`select email from public.users where id=${r.uid}`)[0].email, r.email, '로그인 이메일 그대로');
  }));

  if (process.argv.includes('--build')) await check('호스트 빌드(임시 폴더)', async () => {
    const { build } = await import('./v2-host/build.mjs');
    const outdir = path.join(os.tmpdir(), `v2-staff-sub-${process.pid}`);
    try { await build({ quiet: true, outdir }); const js = await readFile(path.join(outdir, 'staff.js'), 'utf8'); assert.ok(js.includes('features/staff/resume/server/resume-actions.ts') && js.includes('features/leave/server/actions.ts'), '하위 화면이 staff 묶음에 들어갔다'); }
    finally { await rm(outdir, { recursive: true, force: true }); }
  });

  const after = (await counts(db))[0];
  assert.deepEqual(after, before, '복사본 행 수·직원·설정이 처음과 같다');
  console.log(`통과 ${done.length}개\n - ${done.join('\n - ')}`);
} finally {
  await db.end();
}
