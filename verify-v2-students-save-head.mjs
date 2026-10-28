// 2.0 화면 — 원생 저장(머리·폼) 시험 (Docker 복사본 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-students-save-head.mjs
// 저장은 쓰기 트랜잭션 안에서 실제로 돌리고 끝에 통째로 되돌린다(복사본에 남지 않는다). 시험 학생 = 테스트 학생 '학원이'·'학원삼'(is_test)과
// 시험이 만든 학생뿐. 각 함수: 2.0 이름·인자 모양 · 정상 저장의 표·감사로그(action · via) · 거절 문구(2.0 그대로) · 신분 설정 되돌림 · 바깥 요청 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentsHeadActions as A } from './v2-students-save-head.mjs';
import { screen } from './v2-screen-students.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const M = 'features/students/server/actions.ts';
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var ROLL = new Error('rollback');
  /** 쓰기 트랜잭션 하나 — fn이 끝나면 통째로 되돌린다. */
  var tx = async (fn) => { let out; try { await db.begin(async (sql) => { out = await fn(sql); throw ROLL; }); } catch (e) { if (e !== ROLL) throw e; } return out; };
  var form = (pairs) => ({ $formData: pairs });
  var call = (sql, name, actor, args) => A[name].run({ sql, body: A[name].validate({ module: name === 'loadSiblingOptions' ? 'features/students/server/sibling-actions.ts' : M, actor, args }), tenantId: t, importV2 });
  var logs = (sql, action) => sql`select actor_id::text actor, target_label, metadata from public.audit_logs where tenant_id=${t} and created_at >= now() and action=${action} order by created_at`;
  var queued = async (sql) => (await sql`select count(*)::int c from net.http_request_queue`)[0].c;
  var [owner] = await db`select u.id::text id, u.display_name name from public.users u where u.tenant_id=${t} and u.status::text='active' and u.system_role::text='master'
    and not exists(select 1 from public.super_admins sa where sa.id=u.id) order by u.display_name limit 1`;
  var [teacher] = await db`select id::text id from public.users where tenant_id=${t} and status::text='active' and system_role::text='teacher' limit 1`;
  var [hakwon] = await db`select id::text id, name, status::text status, school, grade from public.students where tenant_id=${t} and name='학원이' and is_test`;
  var [sam] = await db`select id::text id, name from public.students where tenant_id=${t} and name='학원삼' and is_test`;
  var V = await importV2('features/withdrawals/via-report.ts'), SA = await importV2('features/students/status-access.ts');
  var studentFields = (s, extra = []) => [['id', s.id], ['name', s.name], ['school', s.school ?? ''], ['grade', s.grade ?? ''], ...extra];
}

test('2.0 함수 이름·인자 모양 — 실제 2.0 파일에 있는 이름 · 다른 파일 이름·모양이면 400 · 화면이 actions로 싣는다', async () => {
  const text = await src(M), sib = await src('features/students/server/sibling-actions.ts');
  for (const n of Object.keys(A)) assert.ok((n === 'loadSiblingOptions' ? sib : text).includes(`export async function ${n}(`), n);
  assert.deepEqual(Object.keys(A).sort(), ['cancelScheduledWithdrawal', 'changeStudentStatus', 'clearDupSuspect', 'createStudent', 'deleteStudent', 'endStudentEnrollments',
    'loadSiblingOptions', 'setStudentEnrollmentHolds', 'updateStudent'].sort());
  assert.throws(() => A.createStudent.validate({ module: 'x.ts', args: [null, form([])] }), (e) => e.status === 400);
  assert.throws(() => A.createStudent.validate({ module: M, args: [null, { nope: 1 }] }), (e) => e.status === 400);
  assert.throws(() => A.clearDupSuspect.validate({ module: M, args: [1] }), (e) => e.status === 400);
  for (const n of Object.keys(A)) assert.equal(screen.actions?.[n], A[n], `화면이 ${n}을 싣는다`);
});

test('등록(createStudent) — 권한 · 이름 비움 · 정상 등록(감사로그 student_create · via) · 같은 이름이면 접미사 · 퇴원 예약 금지 · 바깥 요청 0 · 신분 되돌림', { skip: SKIP }, async () => {
  assert.deepEqual(await tx((sql) => call(sql, 'createStudent', teacher.id, [null, form([['name', '연습']])])), { error: '학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다' });
  assert.deepEqual(await tx((sql) => call(sql, 'createStudent', owner.id, [null, form([['name', ' ']])])), { fieldErrors: { name: '이름은 필수입니다' } });
  const made = await tx(async (sql) => {
    const [{ before }] = await sql`select current_setting('request.jwt.claims', true) before`;
    const q0 = await queued(sql);
    const res = await call(sql, 'createStudent', owner.id, [null, form([['name', '연습 시험 원생'], ['status', 'prospect'], ['parentPhone', '01012345678'], ['school', '일중'], ['grade', '중1']])]);
    const id = res.redirectTo?.split('/').pop();
    const [row] = await sql`select name, status::text status, parent_phone, school from public.students where id=${id}`;
    const [{ after }] = await sql`select current_setting('request.jwt.claims', true) after`;
    return { res, row, log: (await logs(sql, 'student_create'))[0], extra: (await queued(sql)) - q0, before, after };
  });
  assert.equal(made.res.ok, true); assert.match(made.res.redirectTo, /^\/students\/[0-9a-f-]{36}$/); assert.equal(made.res.notice, undefined);
  assert.deepEqual(made.row, { name: '연습 시험 원생', status: 'prospect', parent_phone: '010-1234-5678', school: '대구일중' }, '전화 정규화 · 학교 표기 강제(일중 → 대구일중)');
  assert.deepEqual([made.log.actor, made.log.target_label, made.log.metadata.via], [owner.id, '연습 시험 원생', '3.0 연습 복사본']);
  assert.equal(made.extra, 0, '바깥 요청 0'); assert.equal(made.after, made.before, '신분 설정을 되돌렸다');
  const dup = await tx((sql) => call(sql, 'createStudent', owner.id, [null, form([['name', '학원이'], ['status', 'prospect']])]));
  assert.equal(dup.ok, true); assert.match(dup.notice, /^이미 '학원이' 학생이 있어 '학원이[A-Z]'\(으\)로 등록했습니다\.$/);
  const far = '2099-01-01';
  const sched = await tx((sql) => call(sql, 'createStudent', owner.id, [null, form([['name', '연습 예약'], ['status', 'enrolled'], ['withdrawnAt', far]])]));
  assert.ok(sched.fieldErrors?.withdrawnAt, '새 원생에 퇴원 예약은 걸지 않는다(퇴원보고서로)');
});

test('수정(updateStudent) — 정상 저장(감사로그 statusFrom/To) · 상태 그대로 · 새 퇴원은 퇴원보고서로 · 형제 지정(student_siblings · 감사로그) · 없는 학생', { skip: SKIP }, async () => {
  const out = await tx(async (sql) => {
    const q0 = await queued(sql);
    const res = await call(sql, 'updateStudent', owner.id, [null, form(studentFields(hakwon, [['nickname', '연습 별명'], ['status', hakwon.status]]))]);
    const [row] = await sql`select nickname, status::text status from public.students where id=${hakwon.id}`;
    const hold = await call(sql, 'changeStudentStatus', owner.id, [null, form([['id', hakwon.id], ['target', 'on_hold']])]);
    return { res, row, log: (await logs(sql, 'student_update'))[0], hold, extra: (await queued(sql)) - q0 };
  });
  assert.deepEqual(out.hold, { ok: true }); assert.equal(out.extra, 0, '수정·상태 변경도 바깥 요청 0');
  assert.deepEqual([out.res.ok, out.res.redirectTo, out.res.notice], [true, `/students/${hakwon.id}`, undefined]);
  assert.deepEqual(out.row, { nickname: '연습 별명', status: hakwon.status });
  assert.deepEqual([out.log.actor, out.log.metadata.statusFrom, out.log.metadata.statusTo, out.log.metadata.via], [owner.id, hakwon.status, hakwon.status, '3.0 연습 복사본']);
  const quit = await tx((sql) => call(sql, 'updateStudent', owner.id, [null, form(studentFields(hakwon, [['status', 'withdrawn'], ['withdrawnAt', '2026-10-01']]))]));
  assert.deepEqual(quit, { error: V.WITHDRAWAL_VIA_REPORT }, '이 폼으로 새로 퇴원시키지 못한다');
  const sib = await tx(async (sql) => {
    const res = await call(sql, 'updateStudent', owner.id, [null, form(studentFields(hakwon, [['siblingsField', '1'], ['siblings', JSON.stringify([sam.id])], ['siblingsInitial', '[]'], ['siblingsSuggested', '[]']]))]);
    const pair = await sql`select linked from public.student_siblings where tenant_id=${t} and ((student_a=${hakwon.id} and student_b=${sam.id}) or (student_a=${sam.id} and student_b=${hakwon.id}))`;
    return { res, pair, log: (await logs(sql, 'student_siblings_update'))[0] };
  });
  assert.equal(sib.res.ok, true); assert.deepEqual(sib.pair.map((p) => p.linked), [true]); assert.deepEqual(sib.log.metadata.added, [sam.name]);
  assert.deepEqual(await tx((sql) => call(sql, 'updateStudent', owner.id, [null, form([['id', '00000000-0000-4000-8000-000000000000'], ['name', '없음']])])), { error: '학생을 찾을 수 없습니다' });
});

test('삭제(deleteStudent) — 관리 도구 권한 · 청구 있는 학생 거절 · 시험이 만든 학생 삭제(감사로그 student_delete)', { skip: SKIP }, async () => {
  assert.deepEqual(await tx((sql) => call(sql, 'deleteStudent', teacher.id, [null, form([['id', hakwon.id]])])), { error: '영구 삭제 권한이 없습니다(관리 도구 권한 필요)' });
  const [billed] = await db`select s.id::text id from public.students s where s.tenant_id=${t} and exists(select 1 from public.invoices i where i.student_id=s.id) limit 1`;
  assert.deepEqual(await tx((sql) => call(sql, 'deleteStudent', owner.id, [null, form([['id', billed.id]])])),
    { error: "청구(수납) 기록이 있어 영구 삭제할 수 없습니다. 그만둔 학생이면 '퇴원보고서'로 퇴원을 처리해 주세요." });
  const gone = await tx(async (sql) => {
    const made = await call(sql, 'createStudent', owner.id, [null, form([['name', '연습 삭제 원생'], ['status', 'prospect']])]);
    const id = made.redirectTo.split('/').pop();
    const res = await call(sql, 'deleteStudent', owner.id, [null, form([['id', id]])]);
    return { res, left: (await sql`select count(*)::int n from public.students where id=${id}`)[0].n, log: (await logs(sql, 'student_delete'))[0] };
  });
  assert.deepEqual(gone.res, { ok: true }); assert.equal(gone.left, 0); assert.equal(gone.log.metadata.studentName, '연습 삭제 원생');
});

test('상태 변경(changeStudentStatus) — 퇴원은 퇴원보고서로 · 휴원(수강 대기 · 메모는 감사로그) · 재원 복구 · 권한 없는 사람', { skip: SKIP }, async () => {
  assert.deepEqual(await tx((sql) => call(sql, 'changeStudentStatus', teacher.id, [null, form([['id', hakwon.id], ['target', 'on_hold']])])), { error: SA.STUDENT_STATUS_DENIED });
  assert.deepEqual(await tx((sql) => call(sql, 'changeStudentStatus', owner.id, [null, form([['id', hakwon.id], ['target', 'withdrawn']])])), { error: V.WITHDRAWAL_VIA_REPORT });
  assert.deepEqual(await tx((sql) => call(sql, 'changeStudentStatus', owner.id, [null, form([['id', hakwon.id], ['target', 'nope']])])), { error: '유효하지 않은 상태 전환입니다' });
  const held = await tx(async (sql) => {
    const res = await call(sql, 'changeStudentStatus', owner.id, [null, form([['id', hakwon.id], ['target', 'on_hold'], ['memo', '연습 휴원']])]);
    const [s] = await sql`select status::text status from public.students where id=${hakwon.id}`;
    const open = await sql`select on_hold from public.enrollments where student_id=${hakwon.id} and end_date is null`;
    const back = await call(sql, 'changeStudentStatus', owner.id, [null, form([['id', hakwon.id], ['target', 'enrolled']])]);
    const [s2] = await sql`select status::text status from public.students where id=${hakwon.id}`;
    const open2 = await sql`select on_hold from public.enrollments where student_id=${hakwon.id} and end_date is null`;
    return { res, s, open, back, s2, open2, hold: (await logs(sql, 'student_hold'))[0], restore: (await logs(sql, 'student_restore'))[0] };
  });
  assert.deepEqual(held.res, { ok: true }); assert.equal(held.s.status, 'on_hold'); assert.ok(held.open.length > 0 && held.open.every((r) => r.on_hold));
  assert.equal(held.hold.metadata.memo, '연습 휴원');
  assert.deepEqual(held.back, { ok: true }); assert.equal(held.s2.status, 'enrolled'); assert.ok(held.open2.every((r) => !r.on_hold)); assert.ok(held.restore);
});

test('퇴원 예약 취소(cancelScheduledWithdrawal) — 예약 없으면 거절 · 예약을 걸어 둔 학생이면 지우고 감사로그(cancelledWithdrawal)', { skip: SKIP }, async () => {
  assert.deepEqual(await tx((sql) => call(sql, 'cancelScheduledWithdrawal', owner.id, [null, form([['id', hakwon.id]])])), { error: '취소할 퇴원 예약이 없습니다. 화면을 새로고침해 주세요.' });
  const out = await tx(async (sql) => {
    await sql`update public.students set withdrawn_at='2099-01-01' where id=${hakwon.id}`;
    const res = await call(sql, 'cancelScheduledWithdrawal', owner.id, [null, form([['id', hakwon.id]])]);
    const [s] = await sql`select withdrawn_at from public.students where id=${hakwon.id}`;
    return { res, s, log: (await logs(sql, 'student_restore'))[0] };
  });
  assert.deepEqual(out.res, { ok: true }); assert.equal(out.s.withdrawn_at, null); assert.equal(out.log.metadata.cancelledWithdrawal, '2099-01-01');
});

test('부분 종료·부분 휴원(endStudentEnrollments · setStudentEnrollmentHolds) — 사유·선택 검사 · 마지막 반이면 퇴원보고서로 · 대기 토글(감사로그)', { skip: SKIP }, async () => {
  const [open] = await db`select id::text id from public.enrollments where student_id=${hakwon.id} and end_date is null limit 1`;
  const base = [['studentId', hakwon.id], ['date', '2026-10-27']];
  assert.deepEqual(await tx((sql) => call(sql, 'endStudentEnrollments', owner.id, [null, form([...base, ['reason', 'nope'], ['enrollmentIds', open.id]])])), { error: '종료 사유를 선택해주세요' });
  assert.deepEqual(await tx((sql) => call(sql, 'endStudentEnrollments', owner.id, [null, form([...base, ['reason', 'relocation']])])), { error: '종료할 수업을 1개 이상 선택해주세요' });
  const last = await tx((sql) => call(sql, 'endStudentEnrollments', owner.id, [null, form([...base, ['reason', 'relocation'], ['enrollmentIds', open.id]])]));
  assert.equal(last.error, V.LAST_COURSE_VIA_REPORT, '하나 남은 반을 끝내면 사실상 퇴원 → 퇴원보고서로');
  const held = await tx(async (sql) => {
    const res = await call(sql, 'setStudentEnrollmentHolds', owner.id, [null, form([['studentId', hakwon.id], ['enrollmentIds', open.id]])]);
    const [r] = await sql`select on_hold from public.enrollments where id=${open.id}`;
    const again = await call(sql, 'setStudentEnrollmentHolds', owner.id, [null, form([['studentId', hakwon.id], ['enrollmentIds', open.id]])]);
    return { res, r, again, log: (await logs(sql, 'enrollment_hold'))[0], n: (await logs(sql, 'enrollment_hold')).length };
  });
  assert.deepEqual(held.res, { ok: true }); assert.equal(held.r.on_hold, true); assert.deepEqual(held.again, { ok: true }); assert.equal(held.n, 1, '바뀐 것이 없으면 기록하지 않는다');
  assert.deepEqual([held.log.metadata.source, held.log.metadata.partial], ['status_dialog', false]);
});

test('동명이인 해제(clearDupSuspect) · 형제 고르기 목록(loadSiblingOptions)', { skip: SKIP }, async () => {
  const out = await tx(async (sql) => {
    await sql`update public.students set dup_suspect=true where id=${hakwon.id}`;
    const res = await call(sql, 'clearDupSuspect', owner.id, [hakwon.id]);
    const [s] = await sql`select dup_suspect from public.students where id=${hakwon.id}`;
    return { res, s, log: (await logs(sql, 'student_dup_confirm'))[0] };
  });
  assert.deepEqual(out.res, { ok: true }); assert.equal(out.s.dup_suspect, false); assert.equal(out.log.metadata.studentId, hakwon.id);
  assert.deepEqual(await tx((sql) => call(sql, 'clearDupSuspect', teacher.id, [hakwon.id])), { error: '학생 정보 변경 권한이 없습니다 — 강사 계정은 열람 전용입니다' });
  const opts = await tx((sql) => call(sql, 'loadSiblingOptions', owner.id, [hakwon.id]));
  assert.equal(opts.ok, true);
  assert.ok(!opts.options.some((o) => o.value === hakwon.id || o.value === sam.id), '자기 자신 · 시험용 원생은 빠진다');
  const [{ n }] = await db`select count(*)::int n from public.students where tenant_id=${t} and not coalesce(is_test, false) and coalesce(trim(name), '') <> ''
    and coalesce(notes, '') !~ '^\\s*중복 병합:'`;
  assert.equal(opts.options.length, n, '고르기 목록 = 시험용·병합·이름 없음을 뺀 원생 전부');
  assert.deepEqual(await tx((sql) => call(sql, 'loadSiblingOptions', teacher.id, [hakwon.id])), { ok: false, error: '원생 정보 변경 권한이 없습니다' });
});

test.after(() => db?.end());
