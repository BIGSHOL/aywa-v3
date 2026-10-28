// 직원관리(2.0 화면, 작업자 A 몫) 시험 — `node --test experiments/owner-concept/verify-v2-screen-staff.mjs`
// ① 주소 열쇠 = 2.0 page.tsx searchParams(서버 · 호스트 · 3.0 감싸개) ② 호스트 본문 = 2.0 원문 + swaps.json 짝(짝마다 한 번 · 서버 호출이 남지 않음)
// ③ 2.0 서버 전용 파일의 한 줄 판정·문구를 같은 글자로 옮겼는가 ④ 저장 이름 = 2.0 서버 함수(받거나 · 호스트에서 거절하거나)
// ⑤ 읽기(복사본) — 목록 · 상세 탭 · 운영자 표시 역할 · 🔴 restricted 칸이 권한 없는 보는 사람에게 없다
// ⑥ 저장(복사본, 트랜잭션 안에서 되돌림 — 시험 계정 '테스터') — 2.0과 같은 표·칸·감사로그 · 로그인 계정 거절 · 보호 계정 · 바깥 요청 0 · 행 수 원상
// ⑦ 작업자 B의 하위 경로가 이어진다 ⑧ 화면 글자에 개발자 말이 없다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen, LIST_KEYS, DETAIL_KEYS, buildStaff } from './v2-screen-staff.mjs';
import { staffActions, AUTH_REFUSED, STAFF_SCOPE_DENIED_MSG, SUPER_ADMIN_TARGET_DENIED_MSG, PROTECTED_ACCOUNT_DENIED_MSG } from './v2-staff-save.mjs';
import { isStaffSubPath } from './v2-staff-sub.mjs';

const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8').then(lf);
const here = p => readFile(new URL(p, import.meta.url), 'utf8').then(lf);
const lf = s => s.replace(/\r\n/g, '\n');
const keysOf = page => [...(/searchParams: Promise<\{([\s\S]*?)\}>/.exec(page)?.[1] ?? '').matchAll(/(\w+)\?: string/g)].map(m => m[1]);
const TESTER = '09705ab8-05cf-48ab-8f06-d54a3d990b5c';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

test('주소 열쇠 = 2.0 목록·상세 page.tsx searchParams — 서버 params · 호스트 진입점 · 3.0 감싸개가 같은 열쇠', async () => {
  assert.deepEqual(LIST_KEYS, keysOf(await src('app/(shell)/staff/page.tsx')));
  assert.deepEqual(DETAIL_KEYS, keysOf(await src('app/(shell)/staff/[id]/page.tsx')));
  for (const k of [...LIST_KEYS, ...DETAIL_KEYS, 'actor', 'v2path']) assert.ok(screen.params[k], k);
  const entry = await here('./v2-host/src/staff.tsx'), wrap = await here('./v2-screen-staff.js');
  const arr = (re, s) => JSON.parse(re.exec(s)[1].replace(/'/g, '"'));
  assert.deepEqual(arr(/const KEYS = (\[[^\]]*\])/, entry), LIST_KEYS);
  assert.deepEqual(arr(/const DETAIL_KEYS = (\[[^\]]*\])/, entry), DETAIL_KEYS);
  const keep = arr(/const KEEP = (\[[^\]]*\])/, wrap);
  for (const k of [...LIST_KEYS, ...DETAIL_KEYS, 'v2path', 'staff', 'edit']) assert.ok(keep.includes(k), `KEEP ${k}`);
});

test('호스트 본문 = 2.0 원문 + swaps.json 짝(짝마다 한 번) · 바꾼 본문에 서버 호출(await)이 남지 않는다', async () => {
  for (const file of ['staff-list', 'staff-detail', 'staff-tabs', 'staff-form']) {
    const mine = await here(`./v2-host/src/${file}.tsx`), swaps = JSON.parse(await here(`./v2-host/src/${file}.swaps.json`));
    for (const [key, { src: path, start, swaps: pairs }] of Object.entries(swaps)) {
      const orig = await src(path);
      let body = orig.slice(orig.indexOf(start));
      assert.ok(orig.includes(start), `${file}.${key} 시작 표식`);
      for (const [from, to] of pairs) { assert.equal(body.split(from).length, 2, `${file}.${key}: ${from.slice(0, 60)}`); body = body.replace(from, () => to); }
      const marker = `// ── ${path} `, at = mine.indexOf(marker);
      assert.ok(at >= 0, `${file}.${key} 구획`);
      const section = mine.slice(mine.indexOf('\n', at) + 1);
      assert.ok(section.startsWith(body.replace(/\n{3,}/g, '\n\n')), `${file}.${key} 본문이 2.0 원문 + 짝과 다르다`);
      const code = body.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
      assert.ok(!/\bawait\b/.test(code), `${file}.${key}: 본문에 await가 남았다`);
    }
  }
});

test('2.0 서버 전용 파일의 한 줄 판정·상수·문구를 같은 글자로 옮겼다', async () => {
  assert.match(await src('lib/auth/view-as.ts'), /export function isFullShellRole\(role: SystemRole\): boolean \{\n  return role !== "teacher" && role !== "student";/);
  assert.match(await src('lib/auth/super-admin.ts'), /return superAdminIds\.has\(userId\) && realRole === "master" \? "admin" : realRole;/);
  assert.match(await here('./v2-host/src/staff-host-parts.tsx'), /return superAdminIds\.has\(userId\) && realRole === "master" \? "admin" : realRole;/);
  assert.match(await src('features/audit/server/activity-queries.ts'), /const PAGE_SIZE = 30;/);
  assert.match(await here('./v2-host/src/staff-host-parts.tsx'), /ACTIVITY_PAGE_SIZE = 30;/);
  assert.ok((await src('features/staff/department/server/subject-scope.ts')).includes(`"${STAFF_SCOPE_DENIED_MSG}"`));
  assert.ok((await src('lib/auth/super-admin.ts')).includes(`"${SUPER_ADMIN_TARGET_DENIED_MSG}"`));
  assert.ok((await src('lib/auth/protected-accounts.ts')).includes(`"${PROTECTED_ACCOUNT_DENIED_MSG}"`));
  const save = await here('./v2-staff-save.mjs'), emailErr = await src('lib/auth/auth-email-error.ts');
  assert.ok(emailErr.includes(/const EMAIL_TAKEN_MESSAGE = '([^']+)'/.exec(save)[1]));
});

test('저장 이름 = 2.0 서버 함수 — 이 화면이 받는 것 + 호스트가 바깥 호출이라 거절하는 것 + 아직 받지 않는 것(목록)', async () => {
  const names = async p => [...(await src(p)).matchAll(/^export async function (\w+)/gm)].map(m => m[1]);
  const mine = new Set(Object.keys(staffActions)), entry = await here('./v2-host/src/staff.tsx');
  const refusedInHost = name => new RegExp(`["']${name}["']`).test(entry);
  const NOT_YET = new Set(['saveStaffDashboardAssignment', 'applyStaffEmailChange', 'applyStaffNameChange']); // 대시보드 배정(학원 설정 저장) · 이력서 저장이 부르는 단일 구현(v2-staff-save.mjs가 함수로 내보낸다 — 아래 시험)
  for (const p of ['features/staff/server/actions.ts', 'features/staff/server/account-actions.ts', 'features/staff/contract/server/contract-actions.ts',
    'features/staff/intake/server/intake-token-actions.ts', 'features/staff/list/server/list-prefs.ts', 'features/staff/contract/server/contract-file-actions.ts',
    'features/staff/contract/server/contract-extract-actions.ts', 'features/staff/notion/server/notion-actions.ts', 'features/staff/server/dashboard-assignment.ts']) {
    for (const n of await names(p)) {
      if (n === 'loadStaffListPrefs') continue; // 읽기(load가 한다)
      assert.ok(mine.has(n) || refusedInHost(n) || NOT_YET.has(n), `${p} ${n}`);
    }
  }
  for (const n of mine) assert.ok(screen.actions[n], n);
});

test('읽기 — 목록 · 상세 5탭 · 근무 설정 · 등록 · 운영자 표시 역할 · 운영자 명단 비노출', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'); const { importV2 } = await import('./v2-bridge.mjs');
  await db.begin('isolation level repeatable read read only', async sql => {
    const L = await screen.load({ sql, params: {}, tenantId: t, importV2 });
    const [{ n }] = await sql`select count(*)::int n from public.users where tenant_id=${t} and system_role<>'student'`;
    assert.equal(L.rows.length, n, '원장은 직원 전원(퇴사자 포함 — 상태 필터는 화면이 건다)');
    assert.equal(L.editors[0].role, '원장');
    const supers = (await sql`select id::text id from public.super_admins`).map(r => r.id);
    for (const r of L.rows.filter(r => supers.includes(r.id))) assert.notEqual(r.systemRole, 'master', `${r.displayName} 표시 역할`);
    assert.ok(!('superAdminIds' in L));
    for (const tab of ['info', 'monthly', 'classes', 'activity']) {
      const d = await screen.load({ sql, params: { v2path: `/staff/${TESTER}`, tab }, tenantId: t, importV2 });
      assert.equal(d.tab, tab); assert.ok(d[tab] !== undefined, tab);
    }
    const s = await screen.load({ sql, params: { v2path: `/staff/${TESTER}`, tab: 'salary' }, tenantId: t, importV2 });
    assert.equal(s.tab, 'info', '프리랜서가 아니면 급여 설정 탭은 기본정보로(2.0 accessibleStaffTab)');
    const e = await screen.load({ sql, params: { v2path: `/staff/${TESTER}/edit` }, tenantId: t, importV2 });
    assert.equal(e.staff.id, TESTER); assert.equal(e.canGrantTeacherView, false, '강사 역할엔 강사뷰 접근을 줄 수 없다');
    assert.ok(!('hourlyRate' in e.staff));
    const nw = await screen.load({ sql, params: { v2path: '/staff/new' }, tenantId: t, importV2 });
    assert.ok(!nw.roleOptions.includes('master'));
    const missing = await screen.load({ sql, params: { v2path: '/staff/00000000-0000-4000-8000-000000000000' }, tenantId: t, importV2 });
    assert.equal(missing.notFound, true);
  });
});

test('🔴 restricted — 급여·주민번호·계좌·이력서 원문이 권한 없는 보는 사람의 응답에 없다', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'); const { importV2 } = await import('./v2-bridge.mjs');
  const { readStaffPeople } = await import('./v2-staff-read.mjs');
  await db.begin('isolation level repeatable read read only', async sql => {
    const base = await readStaffPeople(sql, t, importV2);
    // 테스터(강사)에게 직원관리 '전체'를 개인 예외로 준 것처럼 — 원장이 아니라 남의 급여는 못 보고, 이력서는 RLS(restricted)가 막는다.
    const viewer = { id: TESTER, role: 'teacher', display_name: '테스터' };
    const opened = (u, m) => (u.id === TESTER ? m === 'staff' : base.canAccess(u, m));
    const ctx = { ...base, canAccess: opened, canWrite: opened, canManage: opened, staffScope: () => null };
    const [other] = await sql`select u.id::text id from public.users u join public.academy_documents d on d.staff_user_id=u.id and d.form_type='staff_resume'
      where u.tenant_id=${t} and u.system_role<>'student' and u.id<>${TESTER} and (u.hourly_rate > 0 or u.monthly_base > 0 or true) limit 1`;
    assert.ok(other, '이력서가 있는 다른 직원');
    const d = await buildStaff({ ctx, viewer, params: { tab: 'info' }, path: `/staff/${other.id}`, importV2 });
    assert.equal(d.canSeeSalary, false);
    assert.ok(!('hourlyRate' in d.staff) && !('monthlyBase' in d.staff), '급여 칸이 응답에 없다');
    const json = JSON.stringify(d);
    for (const k of ['hourly_rate', 'monthly_base', 'hourlyRate', 'monthlyBase', 'residentId', 'form_data', '"account"']) assert.ok(!json.includes(k), k);
    assert.equal(d.resume, null, '강사 신분이면 이력서 행은 RLS가 막는다');
    // 원장은 2.0처럼 급여 두 칸을 받는다(같은 탭).
    const master = base.editors.find(e => e.role === 'master');
    const m = await buildStaff({ ctx: base, viewer: master, params: { tab: 'info' }, path: `/staff/${other.id}`, importV2 });
    assert.ok('hourlyRate' in m.staff && 'monthlyBase' in m.staff);
    // 목록 응답엔 급여·이력서 원문이 없다(원장이어도).
    const L = await buildStaff({ ctx: base, viewer: master, params: {}, path: '/staff', importV2 });
    const lj = JSON.stringify(L);
    for (const k of ['hourly_rate', 'monthly_base', 'hourlyRate', 'residentId', 'form_data']) assert.ok(!lj.includes(k), `목록 ${k}`);
  });
});

test('저장 — 2.0 표·칸·감사로그 · 로그인 계정 거절 · 보호 계정 · 바깥 요청 0 · 되돌림 뒤 행 수 원상', { skip: SKIP }, async () => {
  const { tenantId: t } = await import('./full-db.mjs'); const { importV2 } = await import('./v2-bridge.mjs');
  const TABLES = ['users', 'staff_contracts', 'audit_logs', 'notifications', 'academy_documents', 'class_schedules', 'classes'];
  const counts = async sql => Object.fromEntries(await Promise.all(TABLES.map(async x => [x, (await sql.unsafe(`select count(*)::int n from public.${x}`))[0].n])));
  const before = await db.begin('read only', counts);
  const [{ q0 }] = await db`select count(*)::int q0 from net.http_request_queue`;
  const fd = o => ({ $formData: Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])) });
  const ROLLBACK = new Error('rollback');
  await assert.rejects(db.begin(async sql => {
    const [actor] = await sql`select id::text id, display_name from public.users where tenant_id=${t} and system_role='master' and status='active'
      and id not in (select id from public.super_admins) order by display_name limit 1`;
    const call = async (name, args, actorId = actor.id) => {
      const a = screen.actions[name];
      return a.run({ sql, body: a.validate({ module: moduleOf(name), actor: actorId, args }), tenantId: t, importV2 });
    };
    const q = async () => (await sql`select count(*)::int n from net.http_request_queue`)[0].n;
    const auditOf = async action => (await sql`select metadata from public.audit_logs where tenant_id=${t} and action=${action} and actor_id=${actor.id} order by created_at desc limit 1`)[0]?.metadata;

    // 근무 설정 — 폼에 없는 칸(이름·연락처·이메일)은 건드리지 않는다.
    const [prev] = await sql`select display_name, phone, email from public.users where id=${TESTER}`;
    const up = await call('updateStaff', [null, fd({ id: TESTER, memo: '연습 메모', subjects: 'english', englishName: 'Tess', bgColor: '#336699' })]);
    assert.equal(up.ok, true);
    const [after] = await sql`select display_name, phone, email, memo, english_name, bg_color, text_color from public.users where id=${TESTER}`;
    assert.deepEqual([after.display_name, after.phone, after.email], [prev.display_name, prev.phone, prev.email]);
    assert.equal(after.memo, '연습 메모'); assert.equal(after.english_name, 'Tess'); assert.equal(after.bg_color, '#336699'); assert.ok(after.text_color);

    // 계약 연장 · 수정 · 삭제(관리 키 · 감사로그 via)
    const ext = await call('extendStaffContract', [null, fd({ userId: TESTER, startDate: '2026-11-01', endDate: '2027-10-31', terms: '연습 조건' })]);
    assert.equal(ext.ok, true); assert.match(ext.notice, /차 계약을 기입했습니다/);
    const [row] = await sql`select id::text id, seq from public.staff_contracts where user_id=${TESTER} and terms='연습 조건'`;
    assert.equal((await auditOf('staff_contract_extend')).via, '3.0 연습 복사본');
    assert.deepEqual(await call('extendStaffContract', [null, fd({ userId: TESTER, startDate: '2026-11-01', endDate: '2026-10-01' })]), { error: '종료일은 시작일보다 뒤여야 합니다' });
    assert.equal((await call('updateStaffContract', [null, fd({ userId: TESTER, contractId: row.id, startDate: '2026-11-01', endDate: '2027-11-30', terms: '고친 조건' })])).ok, true);
    assert.equal((await call('deleteStaffContract', [null, fd({ userId: TESTER, contractId: row.id })])).ok, true);
    assert.deepEqual(await call('deleteStaffContract', [null, fd({ userId: TESTER, contractId: row.id })]), { error: '이미 삭제된 계약입니다' });

    // 로그인 계정이 걸린 일 — 바깥 호출이라 거절(바뀐 것 없음)
    assert.deepEqual(await call('changeStaffRole', [null, fd({ id: TESTER, newRole: 'manager' })]), { error: AUTH_REFUSED.role });
    assert.deepEqual(await call('resetStaffPassword', [null, fd({ id: TESTER, mode: 'temp' })]), { error: AUTH_REFUSED.password });
    assert.match((await call('changeStaffEmail', [null, fd({ id: TESTER, email: 'tester-practice@example.com' })])).error, /이메일 변경 실패/);
    assert.deepEqual(await call('createStaff', [null, fd({ displayName: '연습 직원', email: 'practice-new@example.com', password: 'abcdefgh1', systemRole: 'teacher' })]), { error: AUTH_REFUSED.create });
    assert.deepEqual(await call('createStaff', [null, fd({ displayName: '', email: 'x' })]), { fieldErrors: { displayName: '이름은 필수입니다', email: '이메일 형식이 올바르지 않습니다' } });
    const del = await call('deleteStaff', [null, fd({ id: TESTER })]);
    assert.ok(del.error === AUTH_REFUSED.delete || /출결 기록이 있어/.test(del.error), del.error);
    const [still] = await sql`select system_role::text r, email from public.users where id=${TESTER}`;
    assert.deepEqual([still.r, still.email], ['teacher', prev.email]);

    // 보호 계정 — 2.0 문구 + 시도 감사로그
    const [sup] = await sql`select s.id::text id from public.super_admins s join public.users u on u.id=s.id where u.tenant_id=${t} limit 1`;
    assert.deepEqual(await call('deactivateStaff', [null, fd({ id: sup.id, next: 'inactive' })]), { error: PROTECTED_ACCOUNT_DENIED_MSG });
    assert.equal((await auditOf('staff_protected_refused')).attempt, 'status');
    assert.deepEqual(await call('deactivateStaff', [null, fd({ id: actor.id, next: 'inactive' })]), { error: '본인 계정의 재직 상태는 바꿀 수 없습니다' });

    // 퇴사(인계 없이) — 상태 · 퇴사일 이력 줄 · 감사로그
    const off = await call('handoverAndDeactivate', [null, fd({ id: TESTER, mode: 'skip', resignDate: '2026-10-31' })]);
    assert.equal(off.ok, true);
    assert.equal((await sql`select status::text s from public.users where id=${TESTER}`)[0].s, 'inactive');
    assert.equal((await sql`select count(*)::int n from public.staff_contracts where user_id=${TESTER} and kind='note' and terms='퇴사 (2026-10-31)'`)[0].n, 1);
    assert.deepEqual({ ...(await auditOf('staff_status_change')), via: undefined }, { userId: TESTER, from: 'active', to: 'inactive', via: undefined });
    const back = await call('deactivateStaff', [null, fd({ id: TESTER, next: 'active' })]);
    assert.equal(back.ok, true);

    // 직원 등록 QR · 보기 설정(보는 사람 자신의 ui_prefs.staff만)
    const qr = await call('ensureStaffIntakeToken', []);
    assert.equal(qr.ok, true); assert.match(qr.view.qrSvg, /^<svg/);
    const rot = await call('updateStaffIntakeToken', [null, fd({ id: qr.view.id, action: 'rotate' })]);
    assert.equal(rot.ok, true); assert.notEqual(rot.view.url, qr.view.url);
    const pref = await call('saveStaffListPrefs', [{ tableScale: 120 }, null]);
    assert.equal(pref.ok, true); assert.equal(pref.view.tableScale, 120);
    assert.equal((await sql`select (ui_prefs->'staff'->>'tableScale')::int s from public.users where id=${actor.id}`)[0].s, 120);

    // 이력서 저장이 부르는 단일 구현(작업자 B가 import) — 이름은 DB만이라 바꾸고, 로그인 계정이 있는 직원의 이메일은 거절.
    const { applyStaffNameChange, applyStaffEmailChange } = await import('./v2-staff-save.mjs');
    const nm = await applyStaffNameChange({ sql, tenantId: t, importV2, actorId: actor.id }, TESTER, '테스터연습', 'resume');
    assert.equal(nm.ok, true); assert.equal(nm.changed, true);
    assert.equal((await sql`select display_name from public.users where id=${TESTER}`)[0].display_name, '테스터연습');
    assert.deepEqual([(await auditOf('staff_name_change')).door, (await auditOf('staff_name_change')).via], ['resume', '3.0 연습 복사본'], '2.0 via 값은 door에 · via는 공통 연습 표시');
    assert.match((await applyStaffEmailChange({ sql, tenantId: t, importV2, actorId: actor.id }, TESTER, 'other@example.com', 'resume')).error, /이메일 변경 실패/);
    // 고를 수 없는 사람(직원관리 메뉴 없음)은 '로그인이 필요합니다'(2.0 getCurrentUser 자리)
    assert.deepEqual(await call('updateStaff', [null, fd({ id: TESTER, memo: 'x' })], TESTER), { error: '로그인이 필요합니다' });
    assert.equal(await q(), q0, '바깥 요청 줄이 늘지 않는다');
    throw ROLLBACK;
  }), e => e === ROLLBACK);
  assert.deepEqual(await db.begin('read only', counts), before, '되돌린 뒤 행 수가 처음과 같다');
});

const MODULE_OF = Object.fromEntries([
  ...['createStaff', 'updateStaff', 'changeStaffRole', 'deactivateStaff', 'handoverAndDeactivate'].map(n => [n, 'features/staff/server/actions.ts']),
  ...['resetStaffPassword', 'changeStaffEmail', 'deleteStaff', 'updateWorkSchedule'].map(n => [n, 'features/staff/server/account-actions.ts']),
  ...['extendStaffContract', 'updateStaffContract', 'deleteStaffContract'].map(n => [n, 'features/staff/contract/server/contract-actions.ts']),
  ...['ensureStaffIntakeToken', 'updateStaffIntakeToken'].map(n => [n, 'features/staff/intake/server/intake-token-actions.ts']),
  ['saveStaffListPrefs', 'features/staff/list/server/list-prefs.ts'],
]);
function moduleOf(name) { return MODULE_OF[name]; }

test('작업자 B의 하위 경로가 진입점에서 이어진다', { skip: SKIP }, async () => {
  for (const p of ['/staff/annual-leave', '/staff/payroll', `/staff/${TESTER}/payroll`, '/staff/resumes']) assert.equal(isStaffSubPath(p), true, p);
  for (const p of ['/staff', `/staff/${TESTER}`, `/staff/${TESTER}/edit`, '/staff/new']) assert.equal(isStaffSubPath(p), false, p);
  const { tenantId: t } = await import('./full-db.mjs'); const { importV2 } = await import('./v2-bridge.mjs');
  await db.begin('isolation level repeatable read read only', async sql => {
    const d = await screen.load({ sql, params: { v2path: '/staff/annual-leave' }, tenantId: t, importV2 });
    assert.ok(d && typeof d === 'object' && !('list' in d), '하위 화면 자료는 B의 load가 만든다');
  });
});

test('화면 글자에 개발자 말이 없다(3.0 감싸개 안내 · 호스트 안내 문구)', async () => {
  const wrap = await here('./v2-screen-staff.js'), entry = await here('./v2-host/src/staff.tsx');
  const waitLine = /const wait = ([^\n]+)/.exec(wrap)[1];
  const visible = [/(<div class="v2h-note"[\s\S]*?<\/div>)/.exec(wrap)[1], ...[...waitLine.matchAll(/'([^']+)'/g)].map(m => m[1]), ...[...entry.matchAll(/text="([^"]+)"/g), ...entry.matchAll(/_REFUSED = "([^"]+)"/g)].map(m => m[1])];
  assert.ok(visible.length > 4);
  for (const s of visible) assert.ok(!/2\.0|Docker|docker|복사본|iframe|v2/.test(s.replace(/\$\{[^}]*\}/g, '').replace(/<[^>]*>/g, '')), s);
});

test.after(async () => { await db?.end(); });
