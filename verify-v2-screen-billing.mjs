// 2.0 화면 — 수납관리 시험 (Docker 복사본 읽기 · 저장은 되돌림 · 네트워크·AI 없음).
//   node experiments/owner-concept/verify-v2-screen-billing.mjs
// ① 주소 열쇠 = 2.0 page.tsx · 각 면이 읽는 칸 + 보는 사람 + 하위 주소 ② 그리기 = 2.0 page.tsx · billing-content.tsx · makeedu-sync-badge.tsx 글자 그대로
// ③ 보는 사람·게이트 = 2.0 권한 표(수납 · 급여 열람 · 쓰기 · 엑셀 넣기) ④ 수납 면 숫자 = 독립 SQL + 2.0 summarizeInvoices ⑤ 호스트 묶음 · 3.0 쪽 안내.
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import * as M from './v2-screen-billing.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const src = p => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = p => readFile(new URL(p, import.meta.url), 'utf8');
const lf = s => s.replace(/\r\n/g, '\n');
const applySwaps = (text, swaps, label) => {
  for (const [from, to] of swaps) { assert.equal(text.split(from).length, 2, `${label}: 짝이 원문에 한 번만 — ${from.slice(0, 60)}`); text = text.replace(from, () => to); }
  return text;
};

await check('주소 열쇠 = 2.0 page.tsx · 수납관리 부품이 읽는 칸(sp.*) 전부 + 보는 사람(viewer) + 하위 주소(v2path) — 호스트 · 3.0 껍데기도 같은 목록', async () => {
  const dir = new URL('../../src/app/(shell)/billing/_components/', import.meta.url), keys = new Set();
  for (const f of [...(await readdir(dir)).filter(n => n.endsWith('.tsx')).map(n => new URL(n, dir)), new URL('../../src/app/(shell)/billing/page.tsx', import.meta.url)])
    for (const m of (await readFile(f, 'utf8')).matchAll(/\bsp\.([a-zA-Z]+)/g)) keys.add(m[1]);
  assert.deepEqual(Object.keys(M.screen.params).filter(k => !['viewer', 'v2path', 'ment'].includes(k)).sort(), [...keys].sort());
  const host = await here('./v2-host/src/billing.tsx'), shell = await here('./v2-screen-billing.js');
  const listOf = text => JSON.parse(`[${/KEYS = \[([^\]]+)\]|KEEP = \[([^\]]+)\]/.exec(text).slice(1).find(Boolean).replace(/'/g, '"')}]`);
  assert.deepEqual(listOf(host).sort(), ['v2path', ...keys].sort());
  assert.deepEqual(listOf(shell).sort(), ['v2path', ...keys].sort());
});

await check('그리기 = 2.0 billing/page.tsx · billing-content.tsx · makeedu-sync-badge.tsx 글자 그대로(서버 호출 자리만 billing-page.swaps.json 짝 · 짝마다 한 번)', async () => {
  const swaps = JSON.parse(await here('./v2-host/src/billing-page.swaps.json'));
  for (const [key, file, mineFile] of [['page', 'app/(shell)/billing/page.tsx', 'billing-page.tsx'], ['content', 'app/(shell)/billing/_components/billing-content.tsx', 'billing-content.tsx'],
    ['badge', 'components/makeedu-sync-badge.tsx', 'billing-sync-badge.tsx']]) {
    const want = applySwaps(lf(await src(file)), swaps[key], key), mine = lf(await here(`./v2-host/src/${mineFile}`));
    assert.ok(mine.endsWith(want), `${mineFile} = 2.0 ${file} + 짝`);
    const head = mine.slice(0, mine.length - want.length);
    assert.ok(head.split('\n').filter(Boolean).every(l => l.startsWith('//')), `${mineFile} 앞에는 주석만`);
    const code = want.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /\bawait\b|requireAccess|getCurrentUser|getTenantSettings|getUserPermMatrix|canAccessTenant|canManageTenant|canReadSalary/, `${mineFile}: 서버 호출이 남지 않는다`);
  }
  // 아직 옮기지 않은 면은 자리표시 — 면 탭은 2.0 그대로.
  const page = lf(await here('./v2-host/src/billing-page.tsx'));
  assert.equal(page.split('<HostFaceNotReady />').length - 1, 4, '계산기 · 환불 · 회차 확정 · 강사 정산');
  // 교재 면 = textbooks-face · textbooks-panel · catalog-panel 글자 그대로(billing-textbooks.swaps.json)
  const tb = JSON.parse(await here('./v2-host/src/billing-textbooks.swaps.json'));
  for (const [key, file, mineFile] of [['face', 'textbooks-face.tsx', 'billing-textbooks-face.tsx'], ['panel', 'textbooks-panel.tsx', 'billing-textbooks-panel.tsx'],
    ['catalog', 'catalog-panel.tsx', 'billing-catalog-panel.tsx'], ['expenses', 'expenses-panel.tsx', 'billing-expenses-panel.tsx']]) {
    const swaps = key === 'expenses' ? JSON.parse(await here('./v2-host/src/billing-expenses.swaps.json')).panel : tb[key];
    const want = applySwaps(lf(await src(`app/(shell)/billing/_components/${file}`)), swaps, key), mine = lf(await here(`./v2-host/src/${mineFile}`));
    assert.ok(mine.endsWith(want), `${mineFile} = 2.0 ${file} + 짝`);
    assert.ok(mine.slice(0, mine.length - want.length).split('\n').filter(Boolean).every(l => l.startsWith('//')), `${mineFile} 앞에는 주석만`);
    assert.doesNotMatch(want.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'), /\bawait\b|getCurrentUser|getTenantSettings|resolveBrandingSrc|summarizeExpenses\(/, `${mineFile}: 서버 호출이 남지 않는다`);
  }
});

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => M.screen.load({ sql, params, tenantId, importV2 }));
try {
  const base = await load({});
  const R = await importV2('lib/permissions.ts');

  await check('보는 사람 = 수납 또는 강사 정산 권한이 있는 재직 직원(운영자 계정 제외 · 원장 먼저) · 게이트 = 2.0 권한 표 그대로', async () => {
    const supers = (await db`select id::text id from public.super_admins`).map(r => r.id);
    assert.ok(base.editors.length > 0 && !base.editors.some(e => supers.includes(e.id)));
    assert.equal(base.viewer.id, base.editors[0].id); assert.equal(base.editors[0].role, '원장');
    assert.deepEqual(base.access, { billing: true, payrollMenu: true, readSalary: true, manageBilling: true, writeBilling: true, owner: true });
    const users = await db`select id::text id, system_role::text role from public.users where tenant_id=${tenantId} and status::text='active' and display_name is not null`;
    const roleOf = new Map(users.map(u => [u.id, u.role]));
    // 역할 재정의 · 개인 예외가 없는 사람은 2.0 기본 표(MENU_ACCESS)와 같아야 한다.
    const [{ data }] = await db`select data from public.tenant_settings where tenant_id=${tenantId}`;
    const touched = new Set((data?.permissions?.userOverrides ?? []).map(o => o.userId ?? o.user_id));
    const overridden = new Set((data?.permissions?.overrides ?? []).map(o => o.role));
    for (const e of base.editors) {
      const role = roleOf.get(e.id);
      if (touched.has(e.id) || overridden.has(role)) continue;
      const lv = R.MENU_ACCESS.billing[role], pv = R.MENU_ACCESS.payroll_settings[role];
      assert.ok(lv !== 'none' || pv !== 'none', e.name);
      const d = await load({ viewer: e.id });
      assert.equal(d.access.billing, lv !== 'none', `${e.name} 수납`); assert.equal(d.access.writeBilling, lv === 'full' || lv === 'scoped', `${e.name} 쓰기`);
      assert.equal(d.access.manageBilling, lv === 'full', `${e.name} 엑셀 넣기`); assert.equal(d.access.payrollMenu, pv !== 'none', `${e.name} 강사 정산`);
    }
    // 권한이 없는 역할(강사)은 목록에 없다 — 2.0 requireAccess가 역할 홈으로 보낸다.
    for (const u of users.filter(x => x.role === 'teacher' && !touched.has(x.id))) assert.ok(!base.editors.some(e => e.id === u.id));
  });

  await check('강사 정산 면 = 급여 열람 게이트를 지난 사람만 — 못 지나면 수납 면으로(2.0 effectiveTab) · 회차 정산 기능이 켜진 학원은 회차 확정 면이 선다', async () => {
    const noSalary = base.editors.find(e => e.role !== '원장');
    const d = await load({ viewer: noSalary.id, tab: 'payroll' });
    assert.equal(d.access.readSalary, false, '관리자는 급여 열람 게이트를 못 지난다(기본 표)');
    assert.equal(d.access.payrollMenu, false);
    assert.equal(d.billing, null, '강사 정산 권한이 없으면 2.0 requireAccess가 막는다 — 자료를 싣지 않는다');
    const p = await load({ tab: 'payroll' });
    assert.equal(p.billing, null, '강사 정산 면 자료는 다음 단계(지금은 자리표시)');
    assert.ok(!JSON.stringify(p).match(/hourly_rate|monthly_base|hourlyRate|monthlyBase/), '급여 칸이 실리지 않는다');
    assert.ok(!base.host.disabledModules.includes('session_billing'), '침산 = 회차 정산 켜짐');
  });

  await check('수납 면 = 그 달 청구서(무효 제외) 전부 · 2.0 정렬 · 숫자 = 독립 SQL과 2.0 summarizeInvoices 둘 다', async () => {
    const calc = await importV2('features/billing/calc.ts');
    for (const [period, sort, desc] of [[calc.currentPeriod(), 'status', false], ['2026-09', 'name', true], ['2026-08', 'amount_total', false]]) {
      const d = period === calc.currentPeriod() && sort === 'status' ? base : await load({ period, sort, desc: desc ? '1' : '0' });
      const rows = d.billing.monthRows;
      const [s] = await db`select count(*)::int n, coalesce(sum(amount_total),0)::float8 billed, coalesce(sum(amount_paid),0)::float8 paid, coalesce(sum(amount_discount),0)::float8 disc,
          coalesce(sum(case when status in ('refunded','void','paid') then 0 else greatest(0, amount_total - coalesce(amount_discount,0) - amount_paid) end),0)::float8 outstanding,
          count(*) filter (where status='paid')::int paid_n, count(*) filter (where status='partial')::int partial_n
        from public.invoices where tenant_id=${tenantId} and period=${period} and status <> 'void'`;
      assert.equal(rows.length, s.n, `${period} 건수`);
      const sum = calc.summarizeInvoices(rows, period);
      assert.deepEqual([sum.totalBilled, sum.totalCollected, sum.totalDiscount, sum.outstanding, sum.paidCount, sum.partialCount], [s.billed, s.paid, s.disc, s.outstanding, s.paid_n, s.partial_n], `${period} 합계`);
      assert.ok(rows.every(r => r.status !== 'void'));
      // 정렬 = getInvoicesForPeriod 본문(같은 값은 id 순 유지)
      const want = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const dir = desc ? -1 : 1, order = ['unpaid', 'partial', 'paid', 'refunded', 'void'];
      want.sort((a, b) => sort === 'name' ? a.studentName.localeCompare(b.studentName, 'ko') * dir : sort === 'amount_total' ? (a.amountTotal - b.amountTotal) * dir
        : (order.indexOf(a.status) - order.indexOf(b.status)) * dir || b.amountTotal - a.amountTotal);
      assert.deepEqual(rows.map(r => r.id), want.map(r => r.id), `${period} ${sort} 정렬`);
    }
    // 행 모양 = 2.0 InvoiceRow(칸 이름 · 날짜는 'YYYY-MM-DD' · 시각은 PostgREST 글자 · 항목은 2.0 normalizeInvoiceLineItems)
    const type = lf(await src('features/billing/server/queries.ts')), block = type.slice(type.indexOf('export type InvoiceRow = {'), type.indexOf('};', type.indexOf('export type InvoiceRow = {')));
    const fields = [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]);
    const r0 = base.billing.monthRows[0];
    assert.deepEqual(Object.keys(r0).sort(), fields.sort());
    const [raw] = await db`select line_items, due_date::text due_s, to_json(updated_at)#>>'{}' upd from public.invoices where id=${r0.id}`;
    const li = await importV2('features/billing/invoice-line-items.ts');
    assert.deepEqual(r0.lineItems, li.normalizeInvoiceLineItems(raw.line_items));
    assert.equal(r0.dueDate, raw.due_s); assert.equal(r0.updatedAt, raw.upd);
  });

  await check('청구월 = 청구가 있는 달(무효 포함 · 최신순) + 이번 달 · 학생 선택지 = 퇴원 아닌 학생 이름순 · 동기화 시각 = invoices 도메인', async () => {
    const calc = await importV2('features/billing/calc.ts');
    const months = (await db`select distinct period from public.invoices where tenant_id=${tenantId} order by period desc`).map(r => r.period);
    const want = months.includes(calc.currentPeriod()) ? months : [calc.currentPeriod(), ...months];
    assert.deepEqual(base.billing.periods, want);
    const [{ n }] = await db`select count(*)::int n from public.students where tenant_id=${tenantId} and status::text <> 'withdrawn'`;
    assert.equal(base.billing.students.length, n);
    assert.deepEqual(Object.keys(base.billing.students[0]).sort(), ['grade', 'id', 'name']);
    const [st] = await db`select to_json(synced_at)#>>'{}' synced, status from public.makeedu_sync_state where tenant_id=${tenantId} and domain='invoices'`;
    assert.equal(base.billing.syncState.syncedAt, st.synced); assert.equal(base.billing.syncState.status, st.status);
    assert.deepEqual(base.sync, { invoices: base.billing.syncState });
    const tb = await load({ tab: 'textbooks' });
    assert.deepEqual(Object.keys(tb.sync), ['textbook_checks']); assert.equal(tb.billing, null);
  });

  await check('매개변수 거절 · 없는 달은 빈 표(2.0 eq(period)와 같다)', async () => {
    for (const [k, v] of [['viewer', 'x'], ['tab', 'A B'], ['desc', '2'], ['v2path', '/students/1'], ['hy', '26']]) assert.equal(M.screen.params[k].test(v), false, `${k}=${v}`);
    const odd = await load({ period: '2026-13' });
    assert.deepEqual(odd.billing.monthRows, []);
  });

  await check('교재 면(목록) = 교재신청 전부(체크 적은 것 → 신청일 최신) · 상태 필터 · 검색 · 쪽 · 카드 숫자 = 독립 SQL · 동기화 = textbook_checks', async () => {
    const d = await load({ tab: 'textbooks' }), L = d.textbooks.list;
    assert.equal(d.textbooks.catalog, null);
    const [s] = await db`select count(*)::int total, count(*) filter (where registered_at is null)::int need_reg, count(*) filter (where paid_at is null)::int need_pay,
        count(*) filter (where ordered_at is null)::int need_order, count(*) filter (where registered_at is not null and ordered_at is not null and paid_at is not null)::int done,
        coalesce(sum(price),0)::float8 amount, coalesce(sum(price) filter (where paid_at is null),0)::float8 unpaid from public.textbook_orders where tenant_id=${tenantId}`;
    assert.deepEqual([L.stats.total, L.stats.needReg, L.stats.needPay, L.stats.needOrder, L.stats.done, L.stats.totalAmount, L.stats.unpaidAmount],
      [s.total, s.need_reg, s.need_pay, s.need_order, s.done, s.amount, s.unpaid]);
    assert.equal(L.page.total, s.total); assert.equal(L.page.rows.length, Math.min(50, s.total));
    const cnt = r => (r.registered ? 1 : 0) + (r.paid ? 1 : 0) + (r.ordered ? 1 : 0);
    for (let i = 1; i < L.page.rows.length; i++) {
      const a = L.page.rows[i - 1], b = L.page.rows[i];
      assert.ok(cnt(a) < cnt(b) || (cnt(a) === cnt(b) && (a.requestDate ?? '') >= (b.requestDate ?? '')), `정렬 ${i}`);
    }
    const reg = await load({ tab: 'textbooks', status: 'reg' });
    assert.equal(reg.textbooks.list.page.total, s.need_reg); assert.ok(reg.textbooks.list.page.rows.every(r => !r.registered));
    const done = await load({ tab: 'textbooks', status: 'done' });
    assert.equal(done.textbooks.list.page.total, s.done);
    const [{ n: hit }] = await db`select count(*)::int n from public.textbook_orders where tenant_id=${tenantId} and (book_name ilike '%수학%' or student_name ilike '%수학%')`;
    assert.equal((await load({ tab: 'textbooks', q: '수학' })).textbooks.list.page.total, hit);
    assert.equal((await load({ tab: 'textbooks', q: '%' })).textbooks.list.page.total, s.total, '% 는 글자가 아니라 지워진다(2.0 sanitize)');
    // 행 모양 = 2.0 TextbookOrderRow · 학생 · 단가표 선택지 · 설정(로고는 비움)
    const type = lf(await src('features/billing/server/textbook-queries.ts')), at = type.indexOf('export type TextbookOrderRow = {'), block = type.slice(at, type.indexOf('};', at));
    assert.deepEqual(Object.keys(L.page.rows[0]).sort(), [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]).sort());
    const [{ n: cat }] = await db`select count(*)::int n from public.textbook_catalog where tenant_id=${tenantId} and is_active`;
    assert.equal(L.catalog.length, cat); assert.equal(L.students.length, base.billing.students.length);
    assert.equal(L.settings.profile.logoUrl, null); assert.ok(L.settings.profile.name.length > 0);
    assert.deepEqual(Object.keys(d.sync), ['textbook_checks']);
  });

  await check('교재 면(교재 단가표) = 이름순 50종씩 · 학년·상태 필터 · 카드(등록 · 사용 중) = 독립 SQL', async () => {
    const c = (await load({ tab: 'textbooks', tsub: 'catalog' })).textbooks.catalog;
    const [s] = await db`select count(*)::int total, count(*) filter (where is_active)::int active from public.textbook_catalog where tenant_id=${tenantId}`;
    assert.deepEqual(c.stats, { total: s.total, active: s.active }); assert.equal(c.page.total, s.total); assert.equal(c.page.rows.length, Math.min(50, s.total));
    const inactive = (await load({ tab: 'textbooks', tsub: 'catalog', active: 'inactive' })).textbooks.catalog;
    assert.equal(inactive.page.total, s.total - s.active); assert.ok(inactive.page.rows.every(r => !r.isActive));
    const [{ n: mid }] = await db`select count(*)::int n from public.textbook_catalog where tenant_id=${tenantId} and grade_level='중'`;
    assert.equal((await load({ tab: 'textbooks', tsub: 'catalog', grade: '중' })).textbooks.catalog.page.total, mid);
  });

  await check('교재 면 저장(되돌림) — 등록 · 체크(등록·주문·납부 · 해제 = 사람 소유 마커) · 수정(바뀐 칸만 감사) · 삭제 · 내 메시지 — 문구·감사로그 2.0 그대로 · 볼 수 없는 사람 거절 · 바깥 요청 0', async () => {
    const actions = lf(await src('features/billing/server/textbook-actions.ts')), mine = lf(await here('./v2-billing-textbooks.mjs'));
    for (const fn of ['createTextbookOrder', 'updateTextbookOrder', 'toggleTextbookCheck', 'deleteTextbookOrder']) {
      const at = actions.indexOf(`export async function ${fn}(`), end = actions.indexOf('\nexport async function', at + 10);
      for (const m of actions.slice(at, end < 0 ? undefined : end).matchAll(/error: "([^"]+)"|fallback: "([^"]+)"|action: "([a-z_]+)"/g))
        assert.ok(mine.includes(m[1] ?? m[2] ?? `'${m[3]}'`), `${fn}: ${m[1] ?? m[2] ?? m[3]}`);
    }
    const [hak] = await db`select id::text id, name from public.students where tenant_id=${tenantId} and is_test and name like '학원이%' order by name limit 1`;
    assert.ok(hak, '테스트 학생 학원이');
    const ROLL = new Error('rollback');
    const before = (await db`select count(*)::int n from public.textbook_orders where tenant_id=${tenantId}`)[0].n;
    try {
      await db.begin(async sql => {
        const [{ q0 }] = await sql`select count(*)::int q0 from net.http_request_queue`;
        const fd = pairs => ({ $formData: Object.entries(pairs).map(([k, v]) => [k, String(v)]) });
        const act = (name, args, actor = base.viewer.id, module = 'features/billing/server/textbook-actions.ts') => {
          const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module, actor, args }), tenantId, importV2 });
        };
        // 수납관리를 볼 수 없는 사람(강사)은 보는 사람 목록에 없다 — 2.0 '로그인이 필요합니다' 자리.
        const [teacher] = await sql`select id::text id from public.users where tenant_id=${tenantId} and system_role='teacher' and status='active' limit 1`;
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: '00000000-0000-0000-0000-000000000000', field: 'paid', checked: 'true' })], teacher.id), { error: '로그인이 필요합니다' });
        assert.deepEqual(await act('createTextbookOrder', [null, fd({ bookName: ' ' })]), { fieldErrors: { bookName: '교재명을 입력해주세요' } });
        const made = await act('createTextbookOrder', [null, fd({ bookName: '연습 교재 시험', studentId: hak.id, teacherName: '연습', price: '12,000', notes: ' 메모 ' })]);
        assert.equal(made.ok, true); assert.match(made.createdId, /^[0-9a-f-]{36}$/);
        const [row] = await sql`select student_name, price::float8 price, status, notes, created_by::text created_by, status_by_name, request_date::text rd from public.textbook_orders where id=${made.createdId}`;
        assert.deepEqual([row.student_name, row.price, row.status, row.notes, row.created_by, row.status_by_name], [hak.name, 12000, 'requested', '메모', base.viewer.id, base.viewer.name]);
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: made.createdId, field: 'nope', checked: 'true' })]), { error: '잘못된 체크 항목입니다' });
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: '00000000-0000-0000-0000-000000000000', field: 'paid', checked: 'true' })]), { error: '교재신청을 찾을 수 없습니다' });
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: made.createdId, field: 'ordered', checked: 'true' })]), { ok: true });
        let [st] = await sql`select status, ordered_at is not null o, check_dismissed_at from public.textbook_orders where id=${made.createdId}`;
        assert.deepEqual([st.status, st.o, st.check_dismissed_at], ['ordered', true, null]);
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: made.createdId, field: 'paid', checked: 'true' })]), { ok: true });
        [st] = await sql`select status from public.textbook_orders where id=${made.createdId}`; assert.equal(st.status, 'paid');
        assert.deepEqual(await act('toggleTextbookCheck', [null, fd({ id: made.createdId, field: 'paid', checked: 'false' })]), { ok: true });
        [st] = await sql`select status, paid_at, check_dismissed_at is not null dismissed from public.textbook_orders where id=${made.createdId}`;
        assert.deepEqual([st.status, st.paid_at, st.dismissed], ['ordered', null, true], '납부 해제 = 사람 소유 마커');
        assert.deepEqual(await act('updateTextbookOrder', [null, fd({ id: made.createdId, bookName: '연습 교재 시험', studentId: hak.id, teacherName: '연습', price: '15000', requestDate: row.rd, notes: '메모' })]), { ok: true });
        assert.deepEqual(await act('deleteTextbookOrder', [null, fd({ id: '00000000-0000-0000-0000-000000000000' })]),
          { error: '이 요청서를 지울 권한이 없습니다 — 요청서에 적힌 담당 선생님 이름이 본인과 다르면 관리자에게 요청해주세요.' });
        assert.deepEqual(await act('deleteTextbookOrder', [null, fd({ id: made.createdId })]), { ok: true });
        assert.equal((await sql`select count(*)::int n from public.textbook_orders where id=${made.createdId}`)[0].n, 0);
        const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now() order by created_at, id`;
        assert.deepEqual(logs.map(l => l.action).sort(), ['textbook_order_check', 'textbook_order_check', 'textbook_order_check', 'textbook_order_create', 'textbook_order_delete', 'textbook_order_update']);
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        const unpaid = logs.find(l => l.action === 'textbook_order_check' && l.metadata.field === 'paid' && l.metadata.checked === false);
        assert.deepEqual([unpaid.metadata.fieldLabel, unpaid.metadata.status], ['납부', 'ordered']);
        assert.deepEqual(logs.find(l => l.action === 'textbook_order_update').metadata.changes, [{ label: '금액', from: '12,000원', to: '15,000원' }], '수정은 바뀐 칸만');
        // 내 학부모 메시지 — 저장 → 읽기
        assert.deepEqual(await act('saveMyTextbookMent', ['  연습 메시지 '], base.viewer.id, 'features/billing/server/textbook-notice-actions.ts'), { ok: true });
        assert.equal((await M.screen.load({ sql, params: { ment: '1' }, tenantId, importV2 })).ment, '연습 메시지');
        const [{ q1 }] = await sql`select count(*)::int q1 from net.http_request_queue`;
        assert.equal(q1, q0, '바깥 요청 0');
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal((await db`select count(*)::int n from public.textbook_orders where tenant_id=${tenantId}`)[0].n, before, '되돌린 뒤 남은 연습 행 0');
  });

  await check('지출 면 = 그 달 지출 전부(지출일 최신 → id) · 집계 = 2.0 summarizeExpenses 원문 실행 = 독립 SQL(통화별 · 주 통화 분류별) · 지출 달 목록 · 결의서 상세', async () => {
    for (const period of ['2026-07', '2026-09']) {
      const e = (await load({ tab: 'expenses', period })).expenses;
      const raw = await db`select id::text id, currency, category, amount::float8 amount from public.expenses where tenant_id=${tenantId}
        and expense_date >= ${`${period}-01`}::date and expense_date < (${`${period}-01`}::date + interval '1 month') order by expense_date desc, id`;
      assert.deepEqual(e.rows.map(r => r.id), raw.map(r => r.id), `${period} 행 · 순서`);
      const byCur = await db`select coalesce(currency,'KRW') c, count(*)::int n, sum(amount)::float8 total from public.expenses where tenant_id=${tenantId}
        and expense_date >= ${`${period}-01`}::date and expense_date < (${`${period}-01`}::date + interval '1 month') group by 1 order by n desc, total desc, c`;
      assert.deepEqual(e.summary.byCurrency.map(c => [c.currency, c.count, Math.round(c.total * 100)]), byCur.map(c => [c.c, c.n, Math.round(c.total * 100)]), `${period} 통화별`);
      const primary = byCur[0]?.c ?? 'KRW';
      const cats = raw.filter(r => (r.currency || 'KRW') === primary).reduce((m, r) => m.set(r.category, (m.get(r.category) ?? 0) + r.amount), new Map());
      assert.deepEqual(e.summary.byCategory.map(c => [c.category, Math.round(c.amount)]), [...cats].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]), `${period} 분류별`);
      assert.equal(e.summary.count, raw.length);
    }
    const base = (await load({ tab: 'expenses' })).expenses;
    const months = (await db`select distinct to_char(expense_date,'YYYY-MM') m from public.expenses where tenant_id=${tenantId} and expense_date is not null order by 1 desc`).map(r => r.m);
    assert.deepEqual(base.months, months);
    // 행 모양 = 2.0 ExpenseRow
    const type = lf(await src('features/billing/server/expense-queries.ts')), at = type.indexOf('export type ExpenseRow = {'), block = type.slice(at, type.indexOf('};', at));
    const row = (await load({ tab: 'expenses', period: '2026-07' })).expenses.rows[0];
    assert.deepEqual(Object.keys(row).sort(), [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]).sort());
    const detail = await load({ v2path: `/billing/expenses/${row.id}` });
    assert.equal(detail.page, 'expense'); assert.deepEqual(detail.expense, row);
    assert.equal((await load({ v2path: '/billing/expenses/00000000-0000-0000-0000-000000000000' })).page, 'notFound');
  });

  await check('지출 저장(되돌림) — 등록(작성 결재 자동) · 결재(원장+대표 = 결재 완료 · 해제 방향) · 수정(바뀐 값만 이전값) · 복제 · 증빙 유형 · 삭제 — 문구·감사로그 2.0 그대로 · 감사로그에 계좌번호 없음 · 바깥 요청 0', async () => {
    const actions = lf(await src('features/billing/server/expense-actions.ts')), mine = lf(await here('./v2-billing-expenses.mjs'));
    for (const fn of ['createExpense', 'updateExpense', 'deleteExpense', 'toggleExpenseApproval', 'duplicateExpense', 'setExpenseReceiptType', 'guardOwnExpense']) {
      const at = actions.indexOf(`function ${fn}(`), end = actions.indexOf('\nexport async function', at + 10);
      for (const m of actions.slice(at, end < 0 ? undefined : end).matchAll(/error: "([^"]+)"|return "([^"]+)"|action: "([a-z_]+)"/g))
        assert.ok(mine.includes(m[1] ?? m[2] ?? `'${m[3]}'`), `${fn}: ${m[1] ?? m[2] ?? m[3]}`);
    }
    const ROLL = new Error('rollback');
    const before = (await db`select count(*)::int n from public.expenses where tenant_id=${tenantId}`)[0].n;
    try {
      await db.begin(async sql => {
        const [{ q0 }] = await sql`select count(*)::int q0 from net.http_request_queue`;
        const fd = pairs => ({ $formData: Object.entries(pairs).map(([k, v]) => [k, String(v)]) });
        const act = (name, args, actor = base.viewer.id) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: 'features/billing/server/expense-actions.ts', actor, args }), tenantId, importV2 }); };
        const TITLE = '연습 지출 시험';
        assert.deepEqual(await act('createExpense', [null, fd({ title: ' ', expenseDate: '2026-10-28' })]), { fieldErrors: { title: '항목명을 입력해주세요' } });
        assert.deepEqual(await act('createExpense', [null, fd({ title: TITLE, expenseDate: '' })]), { fieldErrors: { expenseDate: '지출일을 입력해주세요' } });
        const lines = JSON.stringify([{ description: '연습', quantity: 2, unitPrice: 1500, vat: false, total: 3000, vendor: '연습상회' }]);
        assert.deepEqual(await act('createExpense', [null, fd({ title: TITLE, category: '운영비', amount: '3,000', expenseDate: '2026-10-28', lineItems: lines, bankName: '연습은행', accountNumber: '000-0000' })]), { ok: true });
        const [made] = await sql`select id::text id, author, vendor, category, amount::float8 amount, currency, approval_checks, created_by::text created_by from public.expenses where tenant_id=${tenantId} and title=${TITLE}`;
        assert.deepEqual([made.author, made.vendor, made.category, made.amount, made.currency, made.created_by], [base.viewer.name, '연습상회', '운영비', 3000, 'KRW', base.viewer.id]);
        assert.equal(made.approval_checks.author.checked, true);
        for (const role of ['director', 'ceo']) assert.deepEqual(await act('toggleExpenseApproval', [null, fd({ id: made.id, role, checked: 'true' })]), { ok: true });
        assert.equal((await sql`select approval_status s from public.expenses where id=${made.id}`)[0].s, 'approved');
        assert.deepEqual(await act('toggleExpenseApproval', [null, fd({ id: made.id, role: 'ceo', checked: 'false' })]), { ok: true });
        assert.equal((await sql`select approval_status s from public.expenses where id=${made.id}`)[0].s, 'pending');
        assert.deepEqual(await act('toggleExpenseApproval', [null, fd({ id: made.id, role: 'boss', checked: 'true' })]), { error: '잘못된 결재 역할입니다' });
        assert.deepEqual(await act('updateExpense', [null, fd({ id: made.id, title: TITLE, category: '운영비', amount: '4500', expenseDate: '2026-10-28', lineItems: lines })]), { ok: true });
        assert.deepEqual(await act('setExpenseReceiptType', [null, fd({ id: made.id, receiptType: '영수증' })]), { ok: true });
        assert.deepEqual(await act('setExpenseReceiptType', [null, fd({ id: made.id, receiptType: '편지' })]), { error: '잘못된 증빙 유형입니다' });
        assert.deepEqual(await act('duplicateExpense', [null, fd({ id: made.id })]), { ok: true });
        const copies = await sql`select id::text id, amount::float8 amount, approval_status, expense_date::text d from public.expenses where tenant_id=${tenantId} and title=${TITLE} and id <> ${made.id}`;
        assert.equal(copies.length, 1); assert.deepEqual([copies[0].amount, copies[0].approval_status], [4500, 'pending']);
        for (const id of [made.id, copies[0].id]) assert.deepEqual(await act('deleteExpense', [null, fd({ id })]), { ok: true });
        assert.equal((await sql`select count(*)::int n from public.expenses where tenant_id=${tenantId} and title=${TITLE}`)[0].n, 0);
        const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual(logs.map(l => l.action).sort(), ['expense_approval', 'expense_approval', 'expense_approval', 'expense_create', 'expense_delete', 'expense_delete', 'expense_duplicate', 'expense_receipt_type', 'expense_update']);
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        assert.ok(!JSON.stringify(logs).includes('000-0000') && !JSON.stringify(logs).includes('연습은행'), '감사로그에 계좌 없음');
        assert.equal(logs.find(l => l.action === 'expense_update').metadata.amountBefore, 3000, '바뀐 값만 이전값');
        assert.deepEqual(logs.filter(l => l.action === 'expense_approval').map(l => l.metadata.direction).sort(), ['승인', '승인', '해제']);
        const [{ q1 }] = await sql`select count(*)::int q1 from net.http_request_queue`;
        assert.equal(q1, q0, '바깥 요청 0');
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal((await db`select count(*)::int n from public.expenses where tenant_id=${tenantId}`)[0].n, before, '되돌린 뒤 남은 연습 행 0');
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-billing-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('billing.js', dist), 'utf8'), html = await readFile(new URL('billing.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis|payssam|toss/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 보는 사람 고르기 · 안내 한 줄 — 운영 2.0 주소·외부 주소·저장 요청 없음 · 화면 문구에 내부 말 없음', async () => {
  const js = await here('./v2-screen-billing.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  assert.match(js, /const ID = 'billing'/); assert.match(js, /\[data-v2h-actor\]`\)/);
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /frame\.title = '([^']*)'/, /const wait = ([^;]*);/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  // 주석은 화면에 안 나간다 — 주석 줄 · 줄 끝 주석을 빼고 본다.
  const parts = (lf(await here('./v2-host/src/billing-host-parts.tsx')) + lf(await here('./v2-host/src/billing.tsx'))).split('\n')
    .filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const hostShown = [...parts.matchAll(/(?:text=\{?["'`]|>)([^<>{}"'`]*[가-힣][^<>{}"'`]*)/g)].map(m => m[1]).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트|슈퍼|총괄/i]) { assert.doesNotMatch(shown, bad, String(bad)); assert.doesNotMatch(hostShown, bad, `호스트 ${bad}`); }
});

console.log(`v2 billing: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
