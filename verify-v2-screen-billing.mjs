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
import { STATS_KEYS } from './v2-billing-stats.mjs';
import { build } from './v2-host/build.mjs';

/** 화면으로 JSON에 실어 보낼 수 있는 값인가 — 객체·배열·원시값만(Map · Set · Date · 함수 없음). */
const plainDeep = v => (v === null || typeof v !== 'object' ? typeof v !== 'function'
  : Array.isArray(v) ? v.every(plainDeep) : Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(plainDeep));
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
  assert.deepEqual(Object.keys(M.screen.params).filter(k => !['viewer', 'v2path', 'invoice', 'ment', 'refundOptions', 'prefill', 'months', 'call', 'args', ...STATS_KEYS].includes(k)).sort(), [...keys].sort());
  const host = await here('./v2-host/src/billing.tsx'), shell = await here('./v2-screen-billing.js');
  const listOf = text => JSON.parse(`[${/KEYS = \[([^\]]+)\]|KEEP = \[([^\]]+)\]/.exec(text).slice(1).find(Boolean).replace(/'/g, '"')}]`);
  assert.deepEqual(listOf(host).sort(), ['v2path', 'invoice', ...keys, ...STATS_KEYS].sort());
  assert.deepEqual(listOf(shell).sort(), ['v2path', 'invoice', ...keys, ...STATS_KEYS].sort());
  // 수납 통계 열쇠 = 2.0 PERIOD_KEYS · EXPENSE_TREND_KEYS 값 그대로
  const per = await importV2('features/stats/period.ts'), ex = await importV2('features/billing/stats/expense-trend.ts');
  assert.deepEqual([...Object.values(per.PERIOD_KEYS), ...Object.values(ex.EXPENSE_TREND_KEYS)].sort(), [...STATS_KEYS].sort());
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
  assert.equal(page.split('<HostFaceNotReady />').length - 1, 0, '모든 면이 옮겨졌다');
  // 교재 면 = textbooks-face · textbooks-panel · catalog-panel 글자 그대로(billing-textbooks.swaps.json)
  const tb = JSON.parse(await here('./v2-host/src/billing-textbooks.swaps.json'));
  for (const [key, file, mineFile] of [['face', 'textbooks-face.tsx', 'billing-textbooks-face.tsx'], ['panel', 'textbooks-panel.tsx', 'billing-textbooks-panel.tsx'],
    ['catalog', 'catalog-panel.tsx', 'billing-catalog-panel.tsx'], ['expenses', 'expenses-panel.tsx', 'billing-expenses-panel.tsx'], ['rf.face', 'refunds-face.tsx', 'billing-refunds-face.tsx'],
    ['rf.newPage', '../refunds/new/page.tsx', 'billing-refund-new.tsx'], ['rf.viewPage', '../refunds/[id]/page.tsx', 'billing-refund-view.tsx'],
    ['cs.panel', 'calculator-panel.tsx', 'billing-calculator-panel.tsx'], ['cs.prices', 'tuition-prices-panel.tsx', 'billing-tuition-prices-panel.tsx'], ['cs.quotes', 'saved-quotes-panel.tsx', 'billing-saved-quotes-panel.tsx'],
    ['ss.terms', 'session-terms-face.tsx', 'billing-session-terms-face.tsx'], ['ss.verify', 'session-verification-face.tsx', 'billing-session-verification-face.tsx'],
    ['ps.face', 'teacher-settlement-face.tsx', 'billing-teacher-settlement-face.tsx'], ['st.page', '../stats/page.tsx', 'billing-stats-page.tsx']]) {
    const rf = JSON.parse(await here('./v2-host/src/billing-refunds.swaps.json'));
    const swaps = key === 'expenses' ? JSON.parse(await here('./v2-host/src/billing-expenses.swaps.json')).panel : key.startsWith('rf.') ? rf[key.slice(3)] : key.startsWith('cs.') ? JSON.parse(await here('./v2-host/src/billing-calculator.swaps.json'))[key.slice(3)]
      : key.startsWith('ss.') ? JSON.parse(await here('./v2-host/src/billing-sessions.swaps.json'))[key.slice(3)]
      : key.startsWith('ps.') ? JSON.parse(await here('./v2-host/src/billing-payroll.swaps.json'))[key.slice(3)]
      : key.startsWith('st.') ? JSON.parse(await here('./v2-host/src/billing-stats.swaps.json'))[key.slice(3)] : tb[key];
    const want = applySwaps(lf(await src(`app/(shell)/billing/_components/${file}`)), swaps, key), mine = lf(await here(`./v2-host/src/${mineFile}`));
    assert.ok(mine.endsWith(want), `${mineFile} = 2.0 ${file} + 짝`);
    assert.ok(mine.slice(0, mine.length - want.length).split('\n').filter(Boolean).every(l => l.startsWith('//')), `${mineFile} 앞에는 주석만`);
    assert.doesNotMatch(want.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'), /\bawait\b|getCurrentUser|getTenantSettings|resolveBrandingSrc|summarizeExpenses\(|requireAccess|getRefundRequests\(|getTuitionCatalog|getQuote|getSessionTermsView\(|loadSeatShareSummary\(|getSessionVerificationView\(|getTeacherSplitsStatus\(|getTeacherTuitionView\(|getClassSalaryRows\(|canReadSalary\(|canManageSalary\(|loadBillingStats\(|readPeriodParams\(/,`${mineFile}: 서버 호출이 남지 않는다`);
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
    assert.ok(!JSON.stringify(d).match(/hourly_rate|monthly_base|hourlyRate|monthlyBase|commission/i), '급여 열람 게이트 밖 = 급여 칸이 실리지 않는다');
    const p = await load({ tab: 'payroll' });
    assert.equal(p.billing, null, '강사 정산 면엔 수납 면 자료를 싣지 않는다');
    assert.equal(p.payroll.canRead, true, '원장 = 급여 열람 게이트를 지나 강사 정산 자료가 실린다(2.0과 같은 사람)');
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
    assert.equal(M.screen.params.invoice.test('x'), false);
    const odd = await load({ period: '2026-13' });
    assert.deepEqual(odd.billing.monthRows, []);
  });

  await check('업무 흐름 청구 id = 그 청구의 실제 월·정확한 행으로 진입 · 없는 id는 안내', async () => {
    const [invoice] = await db`select id::text id, period from public.invoices where tenant_id=${tenantId} and status <> 'void' order by period desc, id limit 1`;
    assert.ok(invoice, '시험할 청구가 있다');
    const d = await load({ invoice: invoice.id, period: '1999-01' });
    assert.equal(d.invoicePeriod, invoice.period);
    assert.ok(d.billing.monthRows.some((r) => r.id === invoice.id));
    const missing = await load({ invoice: '00000000-0000-4000-8000-000000000000' });
    assert.equal(missing.page, 'invoiceMissing');
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

  await check('환불 요청서 = 사용자 역할(RLS)로 읽은 전건(작성 최신순) = 독립 SQL · 상세 · 작성 화면 게이트(수납 쓰기) · 자동입력 읽기 둘(학생 · 고른 한 명) — 시험 출력에 서식 값 없음', async () => {
    const r = await load({ tab: 'refunds' });
    const ids = (await db`select id::text id from public.academy_documents where tenant_id=${tenantId} and form_type='refund_request' order by created_at desc`).map(x => x.id);
    assert.deepEqual(r.refunds.all.map(x => x.id), ids, '원장(사무실 역할)은 전건');
    assert.equal(r.refunds.canWrite, true);
    const type = lf(await src('features/billing/server/refund-queries.ts')), at = type.indexOf('export type RefundListRow = {'), block = type.slice(at, type.indexOf('};', at));
    if (ids.length) {
      assert.deepEqual(Object.keys(r.refunds.all[0]).sort(), [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]).sort());
      const v = await load({ v2path: `/billing/refunds/${ids[0]}` });
      assert.equal(v.page, 'refund'); assert.equal(v.refund.id, ids[0]); assert.equal(typeof v.refund.data.student, 'object');
    }
    assert.equal((await load({ v2path: '/billing/refunds/00000000-0000-0000-0000-000000000000' })).page, 'notFound');
    assert.equal((await load({ v2path: '/billing/refunds/new' })).page, 'refundNew');
    const opts = await load({ refundOptions: '1' });
    const [{ n }] = await db`select count(*)::int n from public.students where tenant_id=${tenantId}`;
    assert.equal(opts.options.length, n, '퇴원생 포함 전원');
    assert.ok(opts.options.every(o => !/^(active|withdrawn|on_hold|inactive)$/.test(o.statusLabel ?? '')), '상태는 한글 라벨');
    const [hak] = await db`select id::text id from public.students where tenant_id=${tenantId} and is_test and name like '학원이%' order by name limit 1`;
    const pre = await load({ prefill: hak.id, months: '3' });
    assert.equal(typeof pre.values, 'object'); assert.ok(Object.keys(pre.values).length > 0);
    assert.deepEqual(await load({ prefill: '00000000-0000-0000-0000-000000000000' }), { error: '학생 정보를 찾지 못했습니다' });
  });

  await check('환불 요청서 저장(되돌림) — 작성(restricted · 작성자) · 수정(완료일자 = 처리자 자동 기록 · 완료 전이 감사) · 지우기 — 문구·감사로그 2.0 그대로 · 감사로그에 계좌·주소 없음 · 바깥 요청 0', async () => {
    const actions = lf(await src('features/billing/server/refund-actions.ts')), mine = lf(await here('./v2-billing-refunds.mjs'));
    for (const m of actions.matchAll(/error: "([^"]+)"|action: "([a-z_]+)"/g)) assert.ok(mine.includes(m[1] ?? `'${m[2]}'`), m[1] ?? m[2]);
    const ROLL = new Error('rollback');
    const before = (await db`select count(*)::int n from public.academy_documents where tenant_id=${tenantId}`)[0].n;
    try {
      await db.begin(async sql => {
        const [{ q0 }] = await sql`select count(*)::int q0 from net.http_request_queue`;
        const fd = pairs => ({ $formData: Object.entries(pairs).map(([k, v]) => [k, String(v)]) });
        const act = (name, args) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: 'features/billing/server/refund-actions.ts', actor: base.viewer.id, args }), tenantId, importV2 }); };
        assert.deepEqual(await act('saveRefundRequest', [null, fd({ s_name: ' ' })]), { error: '학생 이름을 입력하세요' });
        const SECRET = '999-연습-계좌', ADDR = '연습시 연습구';
        const made = await act('saveRefundRequest', [null, fd({ s_name: '학원이', s_className: '연습반', r_totalAmount: '10,000', m_account: SECRET, s_address: ADDR })]);
        assert.equal(made.ok, true); assert.equal(made.redirectTo, `/billing/refunds/${made.id}`);
        const [doc] = await sql`select restricted, kind, category, uploaded_by::text uploaded_by, form_data from public.academy_documents where id=${made.id}`;
        assert.deepEqual([doc.restricted, doc.kind, doc.category, doc.uploaded_by], [true, 'form', 'billing', base.viewer.id]);
        const upd = await act('saveRefundRequest', [null, fd({ id: made.id, s_name: '학원이', s_className: '연습반', r_totalAmount: '10,000', res_completedDate: '2026-10-28', m_account: SECRET })]);
        assert.equal(upd.ok, true);
        const [after] = await sql`select form_data from public.academy_documents where id=${made.id}`;
        assert.deepEqual([after.form_data.result.completedBy, after.form_data.result.completedByName], [base.viewer.id, base.viewer.name], '처리자 = 저장한 사람(서버가 못박음)');
        assert.deepEqual(await act('deleteRefundRequest', [made.id]), { ok: true });
        assert.equal((await sql`select count(*)::int n from public.academy_documents where id=${made.id}`)[0].n, 0);
        const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual(logs.map(l => l.action).sort(), ['refund_request_create', 'refund_request_delete', 'refund_request_update']);
        assert.equal(logs.find(l => l.action === 'refund_request_update').metadata.completionChange, '완료');
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        assert.ok(!JSON.stringify(logs).includes(SECRET) && !JSON.stringify(logs).includes(ADDR), '감사로그에 계좌·주소 없음');
        const [{ q1 }] = await sql`select count(*)::int q1 from net.http_request_queue`;
        assert.equal(q1, q0, '바깥 요청 0');
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal((await db`select count(*)::int n from public.academy_documents where tenant_id=${tenantId}`)[0].n, before, '되돌린 뒤 남은 연습 행 0');
  });

  await check('수강료 계산기 면 = 내부탭 다섯 · 계산기(사용 중 단가 · 교재 단가표 · 견적 불러오기) · 수강료 단가(필터 · 카드 · 분류 선택지) · 저장된 청구서 = 독립 SQL', async () => {
    const calc = (await load({ tab: 'calculator' })).calculator;
    assert.equal(calc.sub, 'calculator'); assert.equal(calc.settings.profile.logoUrl, null);
    const [{ n: act }] = await db`select count(*)::int n from public.tuition_catalog where tenant_id=${tenantId} and is_active`;
    assert.equal(calc.calculator.catalog.length, act); assert.equal(calc.calculator.initial, null);
    const [q0] = await db`select id::text id from public.tuition_quotes where tenant_id=${tenantId} order by created_at desc limit 1`;
    if (q0) { const withQ = (await load({ tab: 'calculator', qid: q0.id })).calculator; assert.equal(withQ.calculator.initial.id, q0.id); }
    const p = (await load({ tab: 'calculator', csub: 'prices' })).calculator.prices;
    const [st] = await db`select count(*)::int total, count(*) filter (where is_active)::int active, count(*) filter (where is_active and pricing_mode is null)::int unset from public.tuition_catalog where tenant_id=${tenantId}`;
    assert.deepEqual(p.stats, { total: st.total, active: st.active, unset: st.unset }); assert.equal(p.page.total, st.total);
    const tc = await importV2('features/billing/tuition-catalog.ts');
    const cats = (await db`select category from public.tuition_catalog where tenant_id=${tenantId}`).map(r => r.category ?? '');
    assert.deepEqual(p.categories, tc.tuitionCategoryOptions(base.host.operations.subjects.map(s => s.label), cats));
    const first = p.categories[0];
    const [{ n: inCat }] = await db`select count(*)::int n from public.tuition_catalog where tenant_id=${tenantId} and category=${first}`;
    assert.equal((await load({ tab: 'calculator', csub: 'prices', cat: first })).calculator.prices.page.total, inCat);
    const qs = (await load({ tab: 'calculator', csub: 'quotes' })).calculator.quotes;
    const [{ n: qn }] = await db`select count(*)::int n from public.tuition_quotes where tenant_id=${tenantId}`;
    assert.equal(qs.page.total, qn); assert.equal(qs.students.length, base.billing.students.length);
    const type = lf(await src('features/billing/server/tuition-quote-queries.ts')), at = type.indexOf('export type QuoteListItem = {'), block = type.slice(at, type.indexOf('};', at));
    if (qs.page.rows.length) assert.deepEqual(Object.keys(qs.page.rows[0]).sort(), [...block.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map(m => m[1]).sort());
    assert.equal((await load({ tab: 'calculator', csub: 'catalog' })).calculator.catalog.stats.total, (await db`select count(*)::int n from public.textbook_catalog where tenant_id=${tenantId}`)[0].n);
  });

  await check('계산기 면 저장(되돌림) — 교재 단가표 4 · 수강료 단가 5 · 견적 저장(새로 · 고치기)·삭제 — 게이트 = 수납 전체 · 문구·감사로그 2.0 그대로 · 바깥 요청 0', async () => {
    for (const [file, mineFile] of [['catalog-actions.ts', 'v2-billing-calculator.mjs'], ['tuition-catalog-actions.ts', 'v2-billing-calculator.mjs'], ['tuition-quote-actions.ts', 'v2-billing-calculator.mjs']]) {
      const text = lf(await src(`features/billing/server/${file}`)), mine = lf(await here(`./${mineFile}`));
      for (const m of text.matchAll(/error: "([^"]+)"|action: "([a-z_]+)"/g)) assert.ok(mine.includes(m[1] ?? `'${m[2]}'`), `${file}: ${m[1] ?? m[2]}`);
    }
    const ROLL = new Error('rollback');
    const count = async s => (await s`select (select count(*) from public.textbook_catalog where tenant_id=${tenantId}) + (select count(*) from public.tuition_catalog where tenant_id=${tenantId})
      + (select count(*) from public.tuition_quotes where tenant_id=${tenantId}) n`)[0].n;
    const before = await count(db);
    try {
      await db.begin(async sql => {
        const [{ q0 }] = await sql`select count(*)::int q0 from net.http_request_queue`;
        const fd = pairs => ({ $formData: Object.entries(pairs).map(([k, v]) => [k, String(v)]) });
        const act = (module, name, args, actor = base.viewer.id) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: `features/billing/server/${module}`, actor, args }), tenantId, importV2 }); };
        const notFull = base.editors.find(e => e.role !== '원장') && (await load({ viewer: base.editors.find(e => e.role !== '원장').id })).access.manageBilling === false ? base.editors.find(e => e.role !== '원장') : null;
        if (notFull) assert.deepEqual(await act('catalog-actions.ts', 'createCatalogItem', [null, fd({ title: 'x' })], notFull.id), { error: '단가표 관리 권한이 없습니다' });
        // 교재 단가표
        assert.deepEqual(await act('catalog-actions.ts', 'createCatalogItem', [null, fd({ title: ' ' })]), { error: '교재명을 입력해주세요' });
        assert.deepEqual(await act('catalog-actions.ts', 'createCatalogItem', [null, fd({ title: '연습 단가 교재', price: '9000', gradeLevel: '중' })]), { ok: true });
        const [book] = await sql`select id::text id, price::float8 price, grade_level from public.textbook_catalog where tenant_id=${tenantId} and title='연습 단가 교재'`;
        assert.deepEqual([book.price, book.grade_level], [9000, '중']);
        assert.deepEqual(await act('catalog-actions.ts', 'updateCatalogItem', [null, fd({ id: book.id, title: '연습 단가 교재', price: '9500' })]), { ok: true });
        assert.deepEqual(await act('catalog-actions.ts', 'toggleCatalogActive', [null, fd({ id: book.id, next: 'false' })]), { ok: true });
        assert.equal((await sql`select is_active from public.textbook_catalog where id=${book.id}`)[0].is_active, false);
        assert.deepEqual(await act('catalog-actions.ts', 'deleteCatalogItem', [null, fd({ id: book.id })]), { ok: true });
        // 수강료 단가
        assert.deepEqual(await act('tuition-catalog-actions.ts', 'createTuitionItem', [null, fd({ name: '연습 단가', category: '수학', price: '30000', pricing_mode: 'per_session' })]), { ok: true });
        const [item] = await sql`select id::text id, pricing_mode from public.tuition_catalog where tenant_id=${tenantId} and name='연습 단가'`;
        assert.equal(item.pricing_mode, 'per_session');
        assert.deepEqual(await act('tuition-catalog-actions.ts', 'setTuitionPricingMode', [null, fd({ id: item.id, pricing_mode: '' })]), { ok: true });
        assert.equal((await sql`select pricing_mode from public.tuition_catalog where id=${item.id}`)[0].pricing_mode, null, '빈 값 = 미지정으로 되돌리기');
        assert.deepEqual(await act('tuition-catalog-actions.ts', 'updateTuitionItem', [null, fd({ id: item.id, name: '연습 단가', category: '수학', price: '32000', pricing_mode: 'monthly' })]), { ok: true });
        assert.deepEqual(await act('tuition-catalog-actions.ts', 'toggleTuitionActive', [null, fd({ id: item.id, next: 'false' })]), { ok: true });
        assert.deepEqual(await act('tuition-catalog-actions.ts', 'deleteTuitionItem', [null, fd({ id: item.id })]), { ok: true });
        // 견적
        assert.deepEqual(await act('tuition-quote-actions.ts', 'saveTuitionQuote', [null, fd({ studentName: '학원이', courses: '[]' })]), { error: '수강 과목을 1개 이상 추가해주세요' });
        const courses = JSON.stringify([{ name: '연습 수업', price: 30000, sessions: 4 }]);
        const made = await act('tuition-quote-actions.ts', 'saveTuitionQuote', [null, fd({ studentName: '학원이', courses, totalAmount: '120,000' })]);
        assert.equal(made.ok, true); assert.match(made.id, /^[0-9a-f-]{36}$/);
        const [qrow] = await sql`select total_amount::float8 t, courses from public.tuition_quotes where id=${made.id}`;
        assert.deepEqual([qrow.t, qrow.courses.length], [120000, 1]);
        assert.deepEqual(await act('tuition-quote-actions.ts', 'saveTuitionQuote', [null, fd({ quoteId: made.id, studentName: '학원이', courses, totalAmount: '100000' })]), { ok: true, id: made.id });
        assert.deepEqual(await act('tuition-quote-actions.ts', 'saveTuitionQuote', [null, fd({ quoteId: '00000000-0000-0000-0000-000000000000', studentName: '학원이', courses })]),
          { error: '저장할 견적을 찾지 못했습니다 — 목록에서 다시 열어주세요' });
        assert.deepEqual(await act('tuition-quote-actions.ts', 'deleteTuitionQuote', [null, fd({ id: made.id })]), { ok: true });
        const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual(logs.map(l => l.action).sort(), ['textbook_catalog_create', 'textbook_catalog_delete', 'textbook_catalog_toggle', 'textbook_catalog_update',
          'tuition_catalog_create', 'tuition_catalog_delete', 'tuition_catalog_pricing_mode', 'tuition_catalog_toggle', 'tuition_catalog_update',
          'tuition_quote_delete', 'tuition_quote_save', 'tuition_quote_save'].sort());
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        assert.deepEqual(logs.filter(l => l.action === 'tuition_quote_save').map(l => l.metadata.mode).sort(), ['create', 'update']);
        const [{ q1 }] = await sql`select count(*)::int q1 from net.http_request_queue`;
        assert.equal(q1, q0, '바깥 요청 0');
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal(await count(db), before, '되돌린 뒤 남은 연습 행 0');
  });

  await check('수납 면 저장(되돌림) — 청구서 만들기(검사 · 납부기한 = 학원 설정 · 같은 달 중복 거절) · 수동 청구서 완납(실청구 · 결제수단) · 취소(미납만 · 동기화분 거절) — 그 사이 바뀜 검사는 마이크로초까지 같은 글자 · 문구·감사로그 2.0 그대로 · 바깥 요청 0', async () => {
    for (const file of ['actions.ts', 'manual-invoice-actions.ts']) {
      const text = lf(await src(`features/billing/server/${file}`)), mine = lf(await here('./v2-billing-invoice-save.mjs'));
      for (const m of text.matchAll(/error: "([^"]+)"|action: "([a-z_]+)"|= "([^"]+)";\n/g)) assert.ok(mine.includes(m[1] ?? m[3] ?? `'${m[2]}'`), `${file}: ${m[1] ?? m[2] ?? m[3]}`);
    }
    const [hak] = await db`select id::text id from public.students where tenant_id=${tenantId} and is_test and name like '학원이%' order by name limit 1`;
    const synced = (await db`select id::text id, line_items from public.invoices where tenant_id=${tenantId} and status='unpaid' order by period desc limit 50`);
    const lines = await importV2('features/billing/invoice-lines.ts'), calc = await importV2('features/billing/tuition-calc.ts');
    const makeedu = synced.find(r => !lines.isManualInvoiceShape(r.line_items));
    const ROLL = new Error('rollback');
    const before = (await db`select count(*)::int n from public.invoices where tenant_id=${tenantId}`)[0].n;
    try {
      await db.begin(async sql => {
        const [{ q0 }] = await sql`select count(*)::int q0 from net.http_request_queue`;
        const fd = pairs => ({ $formData: Object.entries(pairs).map(([k, v]) => [k, String(v)]) });
        const act = (module, name, args) => { const a = M.screen.actions[name]; return a.run({ sql, body: a.validate({ module: `features/billing/server/${module}`, actor: base.viewer.id, args }), tenantId, importV2 }); };
        assert.deepEqual(await act('actions.ts', 'createInvoice', [null, fd({ studentId: '', period: '2030-1', amountTotal: '0', amountDiscount: '-5' })]),
          { fieldErrors: { studentId: '학생을 선택해주세요', period: '청구월 형식은 YYYY-MM 입니다', amountTotal: '청구액을 입력해주세요' } });
        assert.deepEqual(await act('actions.ts', 'createInvoice', [null, fd({ studentId: hak.id, period: '2030-01', amountTotal: '100', amountDiscount: '200' })]),
          { fieldErrors: { amountDiscount: '할인액이 청구액보다 클 수 없습니다' } });
        assert.deepEqual(await act('actions.ts', 'createInvoice', [null, fd({ studentId: hak.id, period: '2030-01', category: 'material', amountTotal: '50,000', amountDiscount: '5000' })]), { ok: true });
        const [inv] = await sql`select id::text id, status, category, due_date::text due, line_items, amount_total::float8 total from public.invoices where tenant_id=${tenantId} and student_id=${hak.id} and period='2030-01'`;
        const [{ data }] = await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
        assert.deepEqual([inv.status, inv.category, inv.total], ['unpaid', 'material', 50000]);
        assert.equal(inv.due, calc.resolveDueDate('2030-01', data?.billing?.dueDay ?? (await M.screen.load({ sql, params: { tab: 'calculator' }, tenantId, importV2 })).calculator.settings.billing.dueDay) || null);
        assert.ok(lines.isManualInvoiceShape(inv.line_items), '수동 청구서 모양');
        const dup = await act('actions.ts', 'createInvoice', [null, fd({ studentId: hak.id, period: '2030-01', amountTotal: '1000' })]);
        if (dup.error) assert.equal(dup.error, '이미 해당 학생의 이 달 청구서가 있습니다'); // 유니크 제약이 있는 학원만
        assert.deepEqual(await act('manual-invoice-actions.ts', 'markManualInvoicePaid', [inv.id, 'card']), { ok: true });
        const [paid] = await sql`select status, amount_paid::float8 paid, payment_method from public.invoices where id=${inv.id}`;
        assert.deepEqual([paid.status, paid.paid, paid.payment_method], ['paid', 45000, 'card'], '수납액 = 청구 − 할인');
        assert.deepEqual(await act('manual-invoice-actions.ts', 'markManualInvoicePaid', [inv.id, null]), { error: '이미 완납된 청구서입니다' });
        assert.deepEqual(await act('manual-invoice-actions.ts', 'voidManualInvoice', [inv.id]), { error: '수납 기록이 있는 청구서는 취소할 수 없습니다' });
        assert.deepEqual(await act('actions.ts', 'createInvoice', [null, fd({ studentId: hak.id, period: '2030-02', amountTotal: '1000' })]), { ok: true });
        const [inv2] = await sql`select id::text id from public.invoices where tenant_id=${tenantId} and student_id=${hak.id} and period='2030-02'`;
        assert.deepEqual(await act('manual-invoice-actions.ts', 'voidManualInvoice', [inv2.id]), { ok: true });
        assert.equal((await sql`select status from public.invoices where id=${inv2.id}`)[0].status, 'void');
        assert.deepEqual(await act('manual-invoice-actions.ts', 'voidManualInvoice', [inv2.id]), { error: '이미 취소된 청구서입니다' });
        if (makeedu) assert.deepEqual(await act('manual-invoice-actions.ts', 'voidManualInvoice', [makeedu.id]),
          { error: '메이크에듀에서 동기화된 청구서는 여기서 바꿀 수 없습니다 — 메이크에듀에서 고치면 다음 동기화에 반영됩니다' });
        assert.deepEqual(await act('manual-invoice-actions.ts', 'voidManualInvoice', ['x']), { error: '청구서를 찾을 수 없습니다' });
        const logs = await sql`select action, metadata from public.audit_logs where tenant_id=${tenantId} and created_at = now()`;
        assert.deepEqual(logs.map(l => l.action).sort(), (dup.ok ? ['invoice_create'] : []).concat(['invoice_create', 'invoice_create', 'invoice_manual_paid', 'invoice_manual_void']).sort());
        assert.ok(logs.every(l => l.metadata.via === '3.0 연습 복사본'));
        assert.deepEqual(logs.find(l => l.action === 'invoice_manual_paid').metadata, { invoiceId: inv.id, studentId: hak.id, period: '2030-01', statusFrom: 'unpaid', paidFrom: 0, paidTo: 45000, method: 'card', via: '3.0 연습 복사본' });
        const [{ q1 }] = await sql`select count(*)::int q1 from net.http_request_queue`;
        assert.equal(q1, q0, '바깥 요청 0');
        throw ROLL;
      });
    } catch (e) { if (e !== ROLL) throw e; }
    assert.equal((await db`select count(*)::int n from public.invoices where tenant_id=${tenantId}`)[0].n, before, '되돌린 뒤 남은 연습 청구서 0');
  });

  await check('공용 러너의 Supabase 흉내 = PostgREST처럼 — 1000행 절단 · range 페이징 · FK 이름 힌트 · 관계가 둘이면 PGRST201 · 없는 표 PGRST205 · 모르는 모양은 던짐 · 세션 = 보는 사람 RLS', async () => {
    const { runInCall } = await import('./v2-server/context.mjs');
    const P = await import('./v2-server/postgrest.mjs');
    await db.begin('isolation level repeatable read read only', async sql => {
      const owner = { id: base.viewer.id, tenantId, email: '', displayName: base.viewer.name, jobTitle: null, systemRole: 'master' };
      await runInCall({ sql, metaSql: db, actor: owner, tenantId }, async () => {
        const admin = P.adminClient(), user = P.sessionClient();
        const [{ n }] = await sql`select count(*)::int n from public.invoices where tenant_id=${tenantId}`;
        assert.ok(n > 1000, '절단 시험에는 1000행이 넘는 표가 필요');
        const all = await admin.from('invoices').select('id').eq('tenant_id', tenantId);
        assert.equal(all.data.length, 1000, 'range 없이 읽어도 1000행에서 잘린다(db-max-rows)');
        const big = await admin.from('invoices').select('id').eq('tenant_id', tenantId).order('id').range(0, 4999);
        assert.equal(big.data.length, 1000, 'range를 크게 줘도 1000행');
        const p2 = await admin.from('invoices').select('id').eq('tenant_id', tenantId).order('id').range(1000, 1999);
        const want = await sql`select id::text id from public.invoices where tenant_id=${tenantId} order by id offset 1000 limit 1000`;
        assert.deepEqual(p2.data.map(r => r.id), want.map(r => r.id), 'range = offset/limit');
        const head = await admin.from('invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
        assert.deepEqual([head.data, head.count], [null, n]);
        // 임베드 = FK · many-to-one 객체 · 이름 힌트
        const one = await admin.from('invoices').select('id, student:student_id ( id, name ), amount_total').eq('tenant_id', tenantId).order('id').limit(1).single();
        const [raw] = await sql`select i.id::text id, s.id::text sid, s.name, i.amount_total from public.invoices i join public.students s on s.id=i.student_id where i.tenant_id=${tenantId} order by i.id limit 1`;
        assert.deepEqual(one.data, { id: raw.id, student: { id: raw.sid, name: raw.name }, amount_total: Number(raw.amount_total) }, '숫자는 숫자(JSON)');
        const amb = await admin.from('lesson_reports').select('id, classes ( class_name )').limit(1);
        assert.equal(amb.error?.code, 'PGRST201', 'FK가 둘이면 이름 힌트 없이 못 고른다(2.0 #94)');
        const hinted = await admin.from('classes').select('id, teacher:teacher_id ( display_name )').eq('tenant_id', tenantId).limit(1);
        assert.equal(hinted.error, null);
        const missing = await admin.from('no_such_table_v2').select('id');
        assert.equal(missing.error?.code, 'PGRST205');
        const many = await admin.from('invoices').select('id').eq('tenant_id', tenantId).limit(2).single();
        assert.equal(many.error?.code, 'PGRST116');
        const none = await admin.from('invoices').select('id').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle();
        assert.deepEqual([none.data, none.error], [null, null]);
        // JSON 경로 = PostgREST처럼(`별칭:칸->열쇠` = json 값 · `->>` = 글자 · 별칭 없으면 이름 = 마지막 열쇠)
        const jp = await admin.from('student_history_monthly').select('month,general:data->tuitionPaidGeneral,data->>tuitionPaidEie').eq('tenant_id', tenantId).order('month').limit(400);
        const jw = await sql`select month::text, data->'tuitionPaidGeneral' g, data->>'tuitionPaidEie' e from public.student_history_monthly where tenant_id=${tenantId} order by month limit 400`;
        assert.ok(jw.length > 0 && jp.error === null);
        assert.deepEqual(jp.data, jw.map(r => ({ month: r.month, general: r.g, tuitionPaidEie: r.e })));
        // 거르기 칸의 JSON 경로(2.0 teacher-as-of-queries · churn-source: not('metadata->>newTeacherId', 'is', null) · or 'metadata->>newTeacherId.in.(…)')
        const tf = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('action', ['class_handover_apply', 'class_update']).not('metadata->>newTeacherId', 'is', null);
        const [{ n: tn }] = await sql`select count(*)::int n from public.audit_logs where tenant_id=${tenantId} and action in ('class_handover_apply','class_update') and metadata->>'newTeacherId' is not null`;
        assert.ok(tn > 0); assert.equal(tf.count, tn);
        // bool · 숫자 거르기 = 값 그대로(글자로 보내 서버가 바꾼다) — postgres.js에 맡기면 'true'가 거짓으로 가서 eq(is_active, true)가 비활성 행만 돌려줬다
        const [{ act, inact }] = await sql`select count(*) filter (where is_active)::int act, count(*) filter (where not is_active)::int inact from public.classes where tenant_id=${tenantId}`;
        assert.ok(act > 0 && inact > 0 && act !== inact, '활성·비활성 반이 둘 다 있어야 대조가 된다');
        for (const [label, b, want] of [
          ['eq true', admin.from('classes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true), act],
          ['eq false', admin.from('classes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', false), inact],
          ['or 글자', admin.from('classes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).or('is_active.eq.true'), act],
          ['in', admin.from('classes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('is_active', [true]), act],
          ['neq', admin.from('classes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).neq('is_active', true), inact],
        ]) assert.equal((await b).count, want, label);
        // or 묶음은 괄호로(다른 거르기와 and) — 괄호가 없으면 2.0 deleteSessionTerm의 지우기 하나가 57행에 걸렸다
        const [t1] = await sql`select id::text id, to_jsonb(updated_at) #>> '{}' u from public.invoice_session_terms where tenant_id=${tenantId} and allocation_amount > 0 limit 1`;
        const orc = await admin.from('invoice_session_terms').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('id', t1.id).or('allocation_amount.is.null,allocation_amount.eq.0');
        assert.equal(orc.count, 0, 'id 거르기 and (or 묶음)');
        // 시각 거르기 = 읽은 글자 그대로(마이크로초) — postgres.js가 밀리초로 자르면 2.0 낙관적 잠금(.eq("updated_at", 읽은 값))이 늘 '변경됨'
        const rd = await admin.from('invoice_session_terms').select('id, updated_at').eq('id', t1.id).single();
        assert.equal(rd.data.updated_at, t1.u);
        const lk = await admin.from('invoice_session_terms').select('id').eq('id', t1.id).eq('updated_at', rd.data.updated_at).maybeSingle();
        assert.equal(lk.data?.id, t1.id, '읽은 갱신 시각으로 다시 찾는다');
        await assert.rejects(async () => { await admin.from('invoices').select('id, ...students(name)').limit(1); }, e => e.code === 'V2_UNSUPPORTED', '흉내 밖 모양 — 던진다');
        // 2.0 코드가 제 catch로 삼켜도 그 동작에 표시가 남는다 — 작업 스레드가 동작 끝에 다시 던진다(worker.mjs).
        const { callStore } = await import('./v2-server/context.mjs');
        assert.equal(callStore.getStore().unsupported?.code, 'V2_UNSUPPORTED');
        callStore.getStore().unsupported = undefined;
        await assert.rejects(async () => { await admin.from('invoices').select('id').order('student.name').limit(1); }, e => e.code === 'V2_UNSUPPORTED');
        // 세션 클라이언트 = 보는 사람 RLS — 원장은 자기 지점 청구서만, 강사는 수납 정책에 막혀 0행(2.0과 같은 정책)
        const mine = await user.from('invoices').select('*', { count: 'exact', head: true });
        assert.equal(mine.count, n, '원장 = 그 지점 청구서 전부(tenant_id를 안 걸어도 RLS가 거른다)');
        const [teacher] = await sql`select id::text id from public.users where tenant_id=${tenantId} and system_role='teacher' and status='active' limit 1`;
        await runInCall({ sql, metaSql: db, actor: { ...owner, id: teacher.id, systemRole: 'teacher' }, tenantId }, async () => {
          const t = await P.sessionClient().from('invoices').select('*', { count: 'exact', head: true });
          assert.equal(t.count, 0, '강사 = 수납 정책에 막힘');
        });
        const [{ role }] = await sql`select current_user role`;
        assert.notEqual(role, 'authenticated', '쿼리 뒤 역할이 원래대로');
      });
    });
  });

  await check('공용 러너로 돌린 2.0 서버 함수 = 따로 쓴 SQL 결과 — getInvoicesForPeriod(fetchAllPaged · 임베드 · 정렬) · getTextbookOrdersPage(or ilike) · getAvailablePeriods(캐시 경로 = admin)', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const { results: [inv, tb, periods] } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'read', steps: [
      { module: 'features/billing/server/queries.ts', fn: 'getInvoicesForPeriod', args: [{ period: '2026-09', sort: 'name', desc: true }] },
      { module: 'features/billing/server/textbook-queries.ts', fn: 'getTextbookOrdersPage', args: [{ filter: 'pay', q: '수학' }, 1, 50] },
      { module: 'features/billing/server/queries.ts', fn: 'getAvailablePeriods', args: [] },
    ] });
    const mine = (await load({ period: '2026-09', sort: 'name', desc: '1' })).billing;
    assert.deepEqual(inv.value, mine.monthRows, '2.0 getInvoicesForPeriod = 수납 면 조회(손 이식) — 행·순서·값 모두');
    assert.deepEqual(periods.value, mine.periods);
    const t2 = (await load({ tab: 'textbooks', status: 'pay', q: '수학' })).textbooks.list.page;
    assert.deepEqual(tb.value, t2);
  });

  await check('회차 확정 = 2.0 getSessionTermsView 그대로 — 26.09 · 26.10 회차 행 · 확정액 · 저장 배분 · 보낸/받은 이월 · 실납 · 반 청구액 = 독립 SQL과 2.0 순수 함수 · 골든 표본(2026-07 강수정·이시우)', async () => {
    const mc = await importV2('features/billing/session-terms/money-carryover.ts');
    const ca = await importV2('features/billing/session-terms/class-amount.ts');
    const as = await importV2('features/billing/session-terms/allocation-state.ts');
    for (const period of ['2026-09', '2026-10', '2026-07']) {
      const d = (await load({ tab: 'sessions', period })).sessions;
      assert.equal(d.panel, 'confirm'); assert.equal(d.period, period);
      assert.ok(plainDeep(d), 'JSON으로 옮겨도 같은 값(Map · Set · Date 없음 — undefined 칸은 JSON에서 빠질 뿐)');
      const rows = d.confirm.view.rows.filter(r => r.termState === 'term');
      const terms = await db`select s.id::text id, s.invoice_id::text invoice_id, s.amount::float8 amount, s.confirmed_sessions::float8 cs, s.unit_price::float8 up, s.allocation_amount::float8 alloc,
          s.allocation_line_index li, s.allocation_carry_out::float8 cout, i.line_items from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id
        where s.tenant_id=${tenantId} and i.period=${period} and i.status <> 'void'`;
      assert.deepEqual(rows.map(r => r.id).sort(), terms.map(x => x.id).sort(), `${period} 회차 행 = 살아 있는 청구서의 회차 행 전부`);
      const byId = new Map(terms.map(x => [x.id, x]));
      const freeInvoices = new Set(terms.filter(x => x.li == null && (x.alloc ?? 0) > 0).map(x => x.invoice_id));
      for (const r of rows) {
        const x = byId.get(r.id);
        assert.deepEqual([r.amount, r.confirmedSessions, r.unitPrice, r.savedAllocationAmount ?? null], [x.amount, x.cs, x.up, x.alloc], `${period} ${r.id} 확정·배분`);
        // 반 청구액 = 2.0 classInvoiceAmount(반 이름, 청구 항목) · 전액 환불 = 0 · 자유 배분 청구서 = null(2.0 규칙)
        const want = r.refundState === 'full' ? 0 : freeInvoices.has(x.invoice_id) && (r.allocatedAmount ?? 0) > 0 ? null : ca.classInvoiceAmount(r.className ?? '', as.invoiceLineItems({ line_items: x.line_items }));
        if (r.refundState !== 'full' && freeInvoices.has(x.invoice_id)) assert.ok(r.classAmount === null || r.classAmount === want, `${r.id} 자유 배분`);
        else assert.equal(r.classAmount, want, `${period} ${r.id} 반 청구액`);
        // 실납 = 2.0 netAllocatedAmount — 이월이 없고 재확인 아님이면 배분액 그대로
        if (!r.carryOut && !(r.carryIns ?? []).length && !r.allocationStale && !r.refundedAllocation) assert.equal(mc.netAllocatedAmount(r), r.allocatedAmount ?? null);
      }
      const sumAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
      assert.equal(sumAmount, terms.reduce((s, x) => s + (x.amount ?? 0), 0), `${period} 확정액 합계`);
      const out = rows.reduce((s, r) => s + (r.carryOut?.amount ?? 0), 0), sqlOut = terms.reduce((s, x) => s + ((x.cout ?? 0) > 0 ? x.cout : 0), 0);
      assert.equal(out, sqlOut, `${period} 보낸 이월 합계`);
      const prev = (await importV2('lib/date-kst.ts')).shiftMonth(period, -1);
      const [{ sin }] = await db`select coalesce(sum(s.allocation_carry_out), 0)::float8 sin from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id
        where s.tenant_id=${tenantId} and i.period=${prev} and s.allocation_carry_out > 0`;
      assert.equal(d.confirm.view.rows.reduce((s, r) => s + (r.carryIns ?? []).reduce((a, c) => a + c.amount, 0), 0), sin, `${period} 받은 이월 합계 = 지난 달 보낸 이월`);
      assert.equal(d.confirm.view.carryFailed ?? false, false);
      if (period === '2026-09') assert.ok(sin > 0 && sumAmount > 0, '9월엔 확정액과 받은 이월이 있다(대조가 빈 값끼리가 아니다)');
    }
    // 골든마스터 [A] 표본 — 같은 청구서의 같은 반 줄이 2.0 시험의 고정값과 같다(복사본에 그 청구서가 남아 있는 줄만).
    const golden = JSON.parse(await src('features/billing/golden/fixtures/class-amount-cases.json'));
    const jul = (await load({ tab: 'sessions', period: '2026-07' })).sessions.confirm.view.rows;
    const pins = { 강수정: { 'BS2C': 192150, 'JJ1H': 85000 }, 이시우: { 'MS2B': 324000, '브릿지 B': 288000 } };
    let matched = 0;
    for (const g of golden) for (const r of jul.filter(x => x.invoiceId === g.invoiceId && x.className)) {
      const key = Object.keys(pins[g.student] ?? {}).find(k => r.className.includes(k));
      if (key && r.refundState !== 'full' && r.classAmount !== null) { assert.equal(r.classAmount, pins[g.student][key], `골든 ${g.student} ${key}`); matched++; }
    }
    assert.ok(matched >= 1, '골든 표본 줄을 하나 이상 대조했다');
  });

  await check('회차 확정 · 청구 시수 대조 패널 = 2.0 getSessionVerificationView · getTeacherSplitsStatus 그대로 — 줄 수 = 그 달 회차 줄 집합', async () => {
    const v = (await load({ tab: 'sessions', period: '2026-09', panel: 'verify' })).sessions;
    assert.equal(v.panel, 'verify'); assert.equal(v.confirm, null);
    assert.ok(Array.isArray(v.verification.view.rows) && v.verification.view.rows.length > 0);
    assert.deepEqual(Object.keys(v.verification.view).sort(), ['carryBlockedStudents', 'carryFailed', 'counts', 'rows']);
    assert.ok(plainDeep(v));
  });

  await check('회차 확정 저장(되돌림) = 2.0 서버 함수 그대로 — confirmSessionTerm(가상 줄 → 회차 행 · 확정액 = 시수 × 단가) · updateSessionTermNote · unconfirmSessionTerm · 감사로그 via · 바깥 요청 0 · 테스트 학생 줄만', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const S = 'features/billing/session-terms/server/';
    const testIds = (await db`select id::text id from public.students where tenant_id=${tenantId} and is_test`).map(r => r.id);
    // 테스트 학생 줄은 청구서가 없어 잠겨 있다(no_invoice) — 되돌리는 트랜잭션 안에서 2.0 createInvoice로 그 달 청구서를 먼저 만들면
    // 같은 줄이 '회차 없음'(가상 id = 2.0 virtualTermId)이 된다.
    const P = '2026-11', mr = await importV2('features/billing/session-terms/month-roster.ts');
    const vrow = (await load({ tab: 'sessions', period: P })).sessions.confirm.view.rows.find(r => testIds.includes(r.studentId) && r.studentName === '학원이' && r.classId);
    assert.ok(vrow && vrow.termState === 'no_invoice', '학원이의 11월 줄(청구서 없음)');
    vrow.id = mr.virtualTermId(vrow.studentId, vrow.classId);
    const termSql = { $sql: `select s.id::text from public.invoice_session_terms s join public.invoices i on i.id = s.invoice_id
      where s.tenant_id = $1 and i.student_id = $2 and s.class_id = $3 and i.period = $4 and i.status <> 'void' order by s.created_at desc limit 1`, params: [tenantId, vrow.studentId, vrow.classId, P] };
    const countTerms = async () => (await db`select count(*)::int n from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id where s.tenant_id=${tenantId} and i.student_id = any(${testIds}::uuid[])`)[0].n;
    const before = await countTerms(), [{ q0 }] = await db`select count(*)::int q0 from net.http_request_queue`;
    const { results, probes } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'write', rollback: true, allowRefs: true, steps: [
      { module: 'features/billing/server/actions.ts', fn: 'createInvoice', args: [null, { $formData: [['studentId', vrow.studentId], ['period', P], ['amountTotal', '100000']] }] },
      { module: `${S}actions.ts`, fn: 'confirmSessionTerm', args: [null, { $formData: [['id', vrow.id], ['period', P], ['sessions', '4'], ['unitPrice', '25,000']] }] },
      { module: `${S}note-actions.ts`, fn: 'updateSessionTermNote', args: [termSql, '  연습 메모 '] },
      { module: `${S}actions.ts`, fn: 'unconfirmSessionTerm', args: [null, { $formData: [['id', termSql]] }] },
    ], probes: [
      { text: `select s.confirmed_sessions, s.unit_price::float8 unit_price, s.amount, s.note from public.invoice_session_terms s join public.invoices i on i.id = s.invoice_id
        where s.tenant_id = $1 and i.student_id = $2 and s.class_id = $3 and i.period = $4 and i.status <> 'void'`, params: [tenantId, vrow.studentId, vrow.classId, P] },
      { text: `select action, metadata->>'via' via, (metadata->>'amount')::float8 amount from public.audit_logs where tenant_id = $1 and created_at = now() order by action`, params: [tenantId] },
      { text: `select count(*)::int n from net.http_request_queue` },
    ] });
    const [created, confirm, note, unconfirm] = results.map(r => r.value);
    assert.deepEqual(created, { ok: true }, '2.0 createInvoice');
    assert.equal(confirm.ok, true, JSON.stringify(confirm).slice(0, 200)); assert.equal(confirm.created, 1, '가상 줄 → 회차 행 하나');
    assert.equal(confirm.terms?.[0]?.amount ?? 100000, 100000, '확정액 = 4 × 25,000');
    assert.equal(note.note, '연습 메모', '메모 = 2.0 normalizeTermNote');
    assert.equal(unconfirm.ok, true);
    const [term] = probes[0];
    assert.deepEqual([term.confirmed_sessions, term.note], [null, '연습 메모'], '해제 뒤 확정 시수는 비고 메모는 남는다');
    const actions = probes[1].map(l => l.action);
    assert.ok(actions.includes('session_term_confirm'), actions.join(','));
    assert.equal(probes[1].find(l => l.action === 'session_term_confirm').amount, 100000);
    assert.ok(probes[1].every(l => l.via === '3.0 연습 복사본'));
    assert.equal(probes[2][0].n, q0, '바깥 요청 0');
    assert.equal(await countTerms(), before, '되돌린 뒤 테스트 학생 회차 행 그대로');
    // 화면 저장 통로(POST /api/v2/billing/<2.0 함수>) = 같은 함수 — 없는 대상은 2.0 거절 문구, 아무것도 바뀌지 않는다.
    const a = M.screen.actions.updateSessionTermNote;
    const r = await db.begin(async sql => a.run({ sql, body: a.validate({ module: `${S}note-actions.ts`, actor: base.viewer.id, args: ['virtual:x', '메모'] }), tenantId, importV2 }));
    assert.equal(typeof r.error, 'string');
    assert.throws(() => a.validate({ module: `${S}actions.ts`, actor: base.viewer.id, args: [] }), '모듈이 다르면 받지 않는다');
    // 시험 전용 참조({ $sql })는 화면 통로에서 켜지지 않는다 — 값 그대로 2.0 함수로 간다.
    const notesBefore = (await db`select count(*)::int n from public.audit_logs where tenant_id=${tenantId}`)[0].n;
    await assert.rejects(async () => { await db.begin(async sql => a.run({ sql, body: a.validate({ module: `${S}note-actions.ts`, actor: base.viewer.id, args: [{ $sql: 'select 1' }, 'x'] }), tenantId, importV2 })); },
      e => e.code === 'write_failed', '참조 자리는 실행되지 않고 2.0 함수가 받지 못하는 값이라 저장 실패(바뀐 것 없음)');
    assert.equal((await db`select count(*)::int n from public.audit_logs where tenant_id=${tenantId}`)[0].n, notesBefore);
  });

  await check('회차 확정 돈 규칙(되돌림 · 2.0 함수 그대로) — 같은 금액 재확정 = 배분 유지 · 이월이 실리면 받는 달 시수를 올리고 취소해도 내리지 않는다 · 26.09·26.10·26.11 학원 합계(확정액·배분·이월·실납)는 저장 전 = 독립 SQL · 저장 후 = 테스트 줄만 2.0이 정한 만큼 · 되돌린 뒤 = 저장 전', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const mc = await importV2('features/billing/session-terms/money-carryover.ts');
    const mr = await importV2('features/billing/session-terms/month-roster.ts');
    const S = 'features/billing/session-terms/server/';
    const [stu] = await db`select id::text id from public.students where tenant_id=${tenantId} and is_test and name='학원이'`;
    const [{ cls }] = await db`select e.class_id::text cls from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=${stu.id} and e.end_date is null and c.class_name like '학원이(테스트)%' limit 1`;
    const MONTHS = ['2026-09', '2026-10', '2026-11'];
    const V = p => ({ module: `${S}queries.ts`, fn: 'getSessionTermsView', args: [p, null, { lastMonth: true }] });
    const q = (col, p) => ({ $sql: `select ${col} from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id where s.tenant_id=$1 and i.student_id=$2 and s.class_id=$3 and i.period=$4 and i.status<>'void' limit 1`, params: [tenantId, stu.id, cls, p] });
    const term = p => q('s.id::text', p), confirmedAt = p => q(`to_char(s.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, p);
    const inv = (col, p) => ({ $sql: `select ${col} from public.invoices where tenant_id=$1 and student_id=$2 and period=$3 and status<>'void' order by created_at desc limit 1`, params: [tenantId, stu.id, p] });
    const fd = pairs => ({ $formData: pairs });
    const confirm = (id, p) => ({ module: `${S}actions.ts`, fn: 'confirmSessionTerm', args: [null, fd([['id', id], ['period', p], ['sessions', '4'], ['unitPrice', '25000']])] });
    const allocate = (p, amount) => ({ module: `${S}receipt-allocation-actions.ts`, fn: 'saveReceiptAllocation', args: [inv('id::text', p), inv('line_items', p), [{ termId: term(p), lineIndex: 0, amount, baseAmount: 100000, confirmedAt: confirmedAt(p) }]] });
    const invoice = (p, amount) => ({ module: 'features/billing/server/actions.ts', fn: 'createInvoice', args: [null, fd([['studentId', stu.id], ['period', p], ['amountTotal', String(amount)]])] });
    const carry = amount => ({ module: `${S}money-carryover-actions.ts`, fn: 'saveMoneyCarryover', args: [{ termId: term('2026-10'), amount, classId: amount ? cls : null, note: null, expectedAllocation: amount ? 125000 : null }] });
    // 테스트 학생 학원이의 10월·11월 줄은 청구서가 없다(no_invoice) — 그래서 이 시험이 만드는 것은 테스트 줄뿐이다.
    const pre = {}; for (const p of MONTHS) pre[p] = (await load({ tab: 'sessions', period: p })).sessions.confirm.view;
    for (const p of ['2026-10', '2026-11']) assert.equal(pre[p].rows.find(r => r.studentId === stu.id && r.classId === cls)?.termState, 'no_invoice', `${p} 학원이 줄 = 청구서 없음`);
    const steps = [
      ...MONTHS.map(V),                                                                       // 0-2 저장 전
      invoice('2026-10', 125000), confirm(mr.virtualTermId(stu.id, cls), '2026-10'), allocate('2026-10', 125000),  // 3-5
      V('2026-10'),                                                                           // 6
      confirm(term('2026-10'), '2026-10'), V('2026-10'),                                      // 7-8 같은 금액 재확정
      invoice('2026-11', 100000), confirm(mr.virtualTermId(stu.id, cls), '2026-11'), allocate('2026-11', 100000), V('2026-11'),  // 9-12
      carry(25000), V('2026-10'), V('2026-11'),                                               // 13-15 이월
      carry(0), V('2026-11'),                                                                 // 16-17 이월 취소
      ...MONTHS.map(V),                                                                       // 18-20 저장 후
    ];
    const [{ q0 }] = await db`select count(*)::int q0 from net.http_request_queue`;
    const { results, probes } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'write', rollback: true, allowRefs: true, steps, probes: [
      { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id = $1 and created_at = now() order by action`, params: [tenantId] },
      { text: `select count(*)::int n from net.http_request_queue` },
    ] });
    const val = i => results[i].value, mine = v => v.rows.find(r => r.studentId === stu.id && r.classId === cls), others = v => v.rows.filter(r => r.studentId !== stu.id);
    const total = v => { const rows = v.rows.filter(r => r.termState === 'term'); const sum = f => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
      return { amount: sum(r => r.amount), alloc: sum(r => r.allocatedAmount), out: sum(r => r.carryOut?.amount), inn: sum(r => (r.carryIns ?? []).reduce((a, c) => a + c.amount, 0)), net: sum(r => mc.netAllocatedAmount(r)) }; };
    // 저장 전 = 화면이 읽은 값(앞 시험에서 독립 SQL과 맞춘 그 조회) = 트랜잭션 안 2.0 조회 · 확정액·보낸 이월 합계 = 독립 SQL
    for (const [i, p] of MONTHS.entries()) {
      assert.deepEqual(val(i), pre[p], `${p} 저장 전 = 화면 조회`);
      const [sq] = await db`select coalesce(sum(s.amount), 0)::float8 amount, coalesce(sum(greatest(s.allocation_carry_out, 0)), 0)::float8 out from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id
        where s.tenant_id=${tenantId} and i.period=${p} and i.status <> 'void'`;
      assert.deepEqual([total(pre[p]).amount, total(pre[p]).out], [sq.amount, sq.out], `${p} 확정액 · 보낸 이월 합계 = 독립 SQL`);
    }
    for (const i of [4, 5, 7, 10, 11, 13, 16]) assert.equal(val(i)?.ok, true, `${steps[i].fn} ${JSON.stringify(val(i)).slice(0, 160)}`);
    // 규칙 ① 금액이 안 바뀌면 확정·배분을 풀지 않는다 — 같은 시수·단가로 다시 확정해도 배분 125,000 그대로 · 재확인 아님
    const a1 = mine(val(6)), a2 = mine(val(8));
    assert.deepEqual([a1.termState, a1.confirmedSessions, a1.amount, a1.allocatedAmount, a1.allocationStale], ['term', 4, 100000, 125000, false]);
    assert.deepEqual([a2.confirmedSessions, a2.amount, a2.allocatedAmount, a2.allocationStale], [4, 100000, 125000, false], '같은 금액 재확정 = 배분 유지');
    // 규칙 ② 이월이 실리면 받는 달 확정 시수를 올린다(planCarrySessionSync) — 4 → 5(25,000 ÷ 25,000) · 취소해도 내리지 않고 알리기만
    assert.deepEqual([mine(val(12)).confirmedSessions, mine(val(12)).amount], [4, 100000]);
    assert.match(val(13).notice ?? '', /4 → 5/);
    assert.equal(mine(val(14)).carryOut?.amount, 25000, '보내는 달 = 이월 25,000');
    assert.deepEqual([mine(val(15)).confirmedSessions, mine(val(15)).amount, mine(val(15)).carryIns.map(c => c.amount)], [5, 125000, [25000]], '받는 달 시수 4 → 5');
    assert.equal(typeof val(16).warning, 'string', '취소 = 덜 받음 알림');
    assert.deepEqual([mine(val(17)).confirmedSessions, mine(val(17)).carryIns ?? []], [5, []], '이월 취소해도 시수는 내리지 않는다');
    // 저장 후 = 테스트 줄만 바뀐다 — 다른 줄은 전부 같고, 합계 차이 = 테스트 줄의 값(2.0이 정한 만큼)
    for (const [k, p] of MONTHS.entries()) assert.deepEqual(others(val(18 + k)), others(pre[p]), `${p} 테스트 줄 밖은 그대로`);
    assert.deepEqual(val(18), pre['2026-09'], '9월은 통째로 그대로');
    const d = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] - b[k]]));
    assert.deepEqual(d(total(val(19)), total(pre['2026-10'])), { amount: 100000, alloc: 125000, out: 0, inn: 0, net: 125000 }, '10월 합계 차이 = 학원이 줄(이월 취소 뒤)');
    assert.deepEqual(d(total(val(14)), total(pre['2026-10'])), { amount: 100000, alloc: 125000, out: 25000, inn: 0, net: mc.netAllocatedAmount(mine(val(14))) }, '이월 중 10월 = 보낸 이월 25,000');
    assert.deepEqual(d(total(val(15)), total(pre['2026-11'])), { amount: 125000, alloc: 100000, out: 0, inn: 25000, net: mc.netAllocatedAmount(mine(val(15))) }, '이월 중 11월 = 받은 이월 25,000');
    assert.equal(mc.netAllocatedAmount(mine(val(15))), 125000, '11월 실납 = 배분 100,000 + 받은 이월 25,000');
    assert.deepEqual(d(total(val(20)), total(pre['2026-11'])), { amount: 125000, alloc: 100000, out: 0, inn: 0, net: 100000 }, '11월 합계 차이 = 학원이 줄(시수 5 유지)');
    // 감사로그 = 2.0 이름 · via · 바깥 요청 0
    const acts = new Set(probes[0].map(l => l.action));
    for (const a of ['invoice_create', 'session_term_confirm', 'session_term_receipt_allocate', 'session_term_money_carryover', 'session_term_money_carryover_cancel', 'session_term_carry_sync']) assert.ok(acts.has(a), `${a} — ${[...acts].join(',')}`);
    assert.ok(probes[0].every(l => l.via === '3.0 연습 복사본'));
    assert.equal(probes[1][0].n, q0, '바깥 요청 0');
    // 되돌린 뒤 = 저장 전 값
    for (const p of MONTHS) assert.deepEqual((await load({ tab: 'sessions', period: p })).sessions.confirm.view, pre[p], `${p} 되돌린 뒤 = 저장 전`);
  });

  await check('회차 확정 나머지 저장(되돌림 · 2.0 함수 그대로) — 자유 배분(청구액 넘으면 2.0 거절) · 금액이 바뀌면 재확인 · 선택 확정 · 반 해제 · 반 일괄 확정 · 시수 이월 · 계획 갱신 · 강사 분배 스냅샷 · 해제 · 지우기 · 월 회차·항목 합치기 = 2.0 거절 문구 · 감사로그 이름 · 다른 줄 그대로 · 되돌린 뒤 = 저장 전', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const mr = await importV2('features/billing/session-terms/month-roster.ts');
    const S = 'features/billing/session-terms/server/';
    const [stu] = await db`select id::text id from public.students where tenant_id=${tenantId} and is_test and name='학원이'`;
    const [{ cls }] = await db`select e.class_id::text cls from public.enrollments e join public.classes c on c.id=e.class_id where e.student_id=${stu.id} and e.end_date is null and c.class_name like '학원이(테스트)%' limit 1`;
    const V = p => ({ module: `${S}queries.ts`, fn: 'getSessionTermsView', args: [p, null, { lastMonth: true }] });
    const q = (col, p) => ({ $sql: `select ${col} from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id where s.tenant_id=$1 and i.student_id=$2 and s.class_id=$3 and i.period=$4 and i.status<>'void' limit 1`, params: [tenantId, stu.id, cls, p] });
    const term = p => q('s.id::text', p), cat = p => q(`to_char(s.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, p);
    const inv = (col, p) => ({ $sql: `select ${col} from public.invoices where tenant_id=$1 and student_id=$2 and period=$3 and status<>'void' order by created_at desc limit 1`, params: [tenantId, stu.id, p] });
    const fd = pairs => ({ $formData: pairs }), virt = mr.virtualTermId(stu.id, cls);
    const A = `${S}actions.ts`, R = `${S}receipt-allocation-actions.ts`;
    const free = amount => ({ module: R, fn: 'saveFreeReceiptAllocation', args: [inv('id::text', '2026-10'), inv('line_items', '2026-10'), [{ termId: term('2026-10'), amount, baseAmount: 100000, confirmedAt: cat('2026-10') }]] });
    const confirmOct = n => ({ module: A, fn: 'confirmSessionTerm', args: [null, fd([['id', term('2026-10')], ['period', '2026-10'], ['sessions', String(n)], ['unitPrice', '25000']])] });
    const steps = [
      V('2026-10'), V('2026-11'),                                                                                       // 0-1
      { module: 'features/billing/server/actions.ts', fn: 'createInvoice', args: [null, fd([['studentId', stu.id], ['period', '2026-10'], ['amountTotal', '125000']])] },
      { module: A, fn: 'confirmSessionTerm', args: [null, fd([['id', virt], ['period', '2026-10'], ['sessions', '4'], ['unitPrice', '25000']])] },
      { module: R, fn: 'saveReceiptAllocation', args: [inv('id::text', '2026-10'), inv('line_items', '2026-10'), [{ termId: term('2026-10'), lineIndex: 0, amount: 130000, baseAmount: 100000, confirmedAt: cat('2026-10') }]] }, // 4
      free(130000), free(110000), V('2026-10'),                                                                         // 5-7
      confirmOct(4), V('2026-10'), confirmOct(5), V('2026-10'),                                                         // 8-11
      { module: 'features/billing/server/actions.ts', fn: 'createInvoice', args: [null, fd([['studentId', stu.id], ['period', '2026-11'], ['amountTotal', '100000']])] }, // 12
      { module: `${S}selected-confirm-actions.ts`, fn: 'confirmSelectedTerms', args: ['2026-11', cls, [{ id: virt, sessions: 4, unitPrice: 25000, monthly: false }]] },
      { module: `${S}class-unconfirm-actions.ts`, fn: 'unconfirmClassTerms', args: ['2026-11', cls, [term('2026-11')]] },
      { module: A, fn: 'confirmClassTerms', args: ['2026-11', cls, 25000, 4, [term('2026-11')]] },                     // 15
      { module: A, fn: 'setSessionTermCarryover', args: [null, fd([['id', term('2026-11')], ['carryoverOut', '1'], ['note', '연습']])] },
      { module: `${S}monthly-sessions.ts`, fn: 'updateMonthlyTermSessions', args: [term('2026-11'), 4, q(`to_jsonb(s.confirmed_at) #>> '{}'`, '2026-11')] },
      { module: R, fn: 'mergeReceiptItems', args: [inv('id::text', '2026-11'), inv('line_items', '2026-11'), [0], '합산'] },
      { module: A, fn: 'refreshPlannedTerms', args: ['2026-11'] },                                                     // 19
      { module: `${S}splits-actions.ts`, fn: 'saveTeacherSplits', args: [null, fd([['period', '2026-11']])] },
      { module: A, fn: 'setSessionTermCarryover', args: [null, fd([['id', term('2026-11')], ['carryoverOut', '0'], ['note', '']])] },
      { module: A, fn: 'unconfirmSessionTerm', args: [null, fd([['id', term('2026-11')]])] },
      { module: `${S}delete-actions.ts`, fn: 'deleteSessionTerm', args: [term('2026-11'), '2026-11', q(`to_jsonb(s.updated_at) #>> '{}'`, '2026-11')] }, // 23
      V('2026-10'), V('2026-11'),                                                                                       // 24-25
    ];
    const [{ q0 }] = await db`select count(*)::int q0 from net.http_request_queue`;
    const { results, probes } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'write', rollback: true, allowRefs: true, steps, probes: [
      { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id = $1 and created_at = now()`, params: [tenantId] },
      { text: `select count(*)::int n from net.http_request_queue` },
      { text: `select count(*)::int n from public.invoice_session_terms s join public.invoices i on i.id=s.invoice_id where i.student_id = $1 and i.period = '2026-11' and s.class_id = $2`, params: [stu.id, cls] },
    ] });
    const val = i => results[i].value, mine = v => v.rows.find(r => r.studentId === stu.id && r.classId === cls), others = v => v.rows.filter(r => r.studentId !== stu.id);
    // 수납 배분 — 항목별은 합계가 청구액과 같아야(2.0 거절) · 자유 배분은 수업 청구액까지(넘으면 2.0 거절 · 덜 나누는 것은 된다)
    assert.deepEqual(val(4), { error: '반별 배분 합계가 할인 전 청구액과 일치해야 합니다' });
    assert.deepEqual(val(5), { error: '수업 청구액 125,000원보다 많이 나눌 수 없습니다 — 지금 130,000원' });
    assert.deepEqual(val(6), { ok: true });
    assert.deepEqual([mine(val(7)).allocatedAmount, mine(val(7)).allocationStale], [110000, false]);
    // 금액이 안 바뀌면 그대로 · 바뀌면 2.0이 정한 대로 — 자유 배분은 자동 재확정 대상이 아니라 '재확인'(배분 비움 · stale)
    assert.deepEqual([mine(val(9)).allocatedAmount, mine(val(9)).allocationStale], [110000, false], '같은 금액 재확정 = 자유 배분 유지');
    assert.deepEqual([mine(val(11)).amount, mine(val(11)).allocatedAmount, mine(val(11)).allocationStale], [125000, null, true], '금액이 바뀌면 재확인');
    // 나머지 저장 — 응답 모양 = 2.0
    assert.equal(val(13).confirmed, 1); assert.equal(val(13).skipped, 0);
    assert.equal(val(14).unconfirmed, 1);
    assert.equal(val(15).confirmed, 1);
    assert.deepEqual(val(16), { ok: true });
    assert.deepEqual(val(17), { error: '확정값이 변경되었습니다. 새로고침 후 다시 수정해 주세요' }, '월 정액 줄이 아니면 2.0이 고치지 않는다');
    assert.deepEqual(val(18), { error: '합산할 항목과 수납명을 확인해 주세요' }, '합칠 항목이 둘 이상이어야');
    assert.equal(val(19).ok, true); assert.equal(typeof val(19).refreshed, 'number');
    assert.equal(typeof val(20).saved, 'number'); assert.equal(val(20).error, undefined);
    assert.deepEqual(val(21), { ok: true }); assert.equal(val(22).ok, true);
    assert.deepEqual(val(23), { ok: true }, '이월을 취소하고 해제한 줄은 지워진다(낙관적 잠금 = 읽은 갱신 시각)');
    assert.equal(probes[2][0].n, 0, '지운 회차 행 없음');
    // 감사로그 = 2.0 이름 · via · 바깥 요청 0
    const acts = new Set(probes[0].map(l => l.action));
    for (const a of ['invoice_create', 'session_term_create', 'session_term_confirm', 'session_term_receipt_allocate_free', 'session_term_confirm_selected', 'session_term_unconfirm_class',
      'session_term_confirm_class', 'session_term_carryover', 'session_terms_refresh', 'session_splits_save', 'session_term_unconfirm', 'session_term_delete']) assert.ok(acts.has(a), `${a} — ${[...acts].join(',')}`);
    assert.ok(probes[0].every(l => l.via === '3.0 연습 복사본'));
    assert.equal(probes[1][0].n, q0, '바깥 요청 0');
    // 다른 줄 그대로 · 되돌린 뒤 = 저장 전
    assert.deepEqual(others(val(24)), others(val(0)), '10월 테스트 줄 밖 그대로');
    // 계획 갱신은 2.0에서도 한 달 전체 쓰기다 — 청구서는 있는데 회차 행이 없던 줄('missing')에 행을 만든다. 그 줄만 빼고 그대로, 그 줄은 회차 행이 됐는지.
    const key = r => `${r.studentId}:${r.classId}`, wasMissing = new Set(others(val(1)).filter(r => r.termState === 'missing').map(key));
    assert.deepEqual(others(val(25)).filter(r => !wasMissing.has(key(r))), others(val(1)).filter(r => !wasMissing.has(key(r))), '11월 테스트 줄 밖 그대로(계획 갱신이 만든 줄 빼고)');
    const preMissing = new Map(others(val(1)).filter(r => wasMissing.has(key(r))).map(r => [key(r), r]));
    const made = others(val(25)).filter(r => wasMissing.has(key(r)) && r.termState !== 'missing');
    assert.ok(made.length >= 1 && made.every(r => r.termState === 'term' && r.confirmedSessions == null && r.plannedSessions === preMissing.get(key(r)).plannedSessions), '계획 갱신 = 빠진 줄에 미확정 회차 행(계획 시수 그대로)');
    assert.ok(made.length <= val(19).refreshed, '만든 줄 수 ≤ 2.0 응답 refreshed');
    assert.deepEqual((await load({ tab: 'sessions', period: '2026-10' })).sessions.confirm.view, val(0), '10월 되돌린 뒤 = 저장 전');
    assert.deepEqual((await load({ tab: 'sessions', period: '2026-11' })).sessions.confirm.view, val(1), '11월 되돌린 뒤 = 저장 전');
  });

  await check('월 정액 시수·수납 항목 합치기(되돌림) = 테스트 학생에게 유효한 자료를 만든 뒤 2.0 저장 함수로 실제 변경 · 확정액 보존 · 감사로그 · 바깥 요청 0 · 잔여 행 0', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const S = 'features/billing/session-terms/server/';
    const [fixture] = await db`select s.id::text student_id, c.id::text class_id, c.teacher_id::text actor_id
      from public.students s cross join public.classes c join public.users u on u.id=c.teacher_id
      where s.tenant_id=${tenantId} and s.is_test and s.name='학원이' and s.status='enrolled'
        and c.tenant_id=${tenantId} and c.class_name='PL5' and c.subject='english' and c.english_track='eie'
        and c.is_active and u.status='active' and u.system_role='admin' limit 1`;
    const [multi] = await db`select i.id::text id, i.line_items from public.invoices i join public.students s on s.id=i.student_id
      where i.tenant_id=${tenantId} and s.is_test and s.name='테스트' and i.period='2026-11' and i.status<>'void' limit 1`;
    assert.ok(fixture && multi && Array.isArray(multi.line_items) && multi.line_items.length >= 3, '테스트 학생·월 정액 반·여러 청구 항목');
    const before = await db`select
      (select count(*)::int from public.enrollments where student_id=${fixture.student_id} and class_id=${fixture.class_id}) enrollments,
      (select count(*)::int from public.invoices where student_id=${fixture.student_id} and period='2026-11' and status<>'void') invoices,
      (select count(*)::int from public.invoice_session_terms t join public.invoices i on i.id=t.invoice_id where i.student_id=${fixture.student_id} and i.period='2026-11') terms,
      (select count(*)::int from net.http_request_queue) queued`;
    assert.deepEqual([before[0].enrollments, before[0].invoices, before[0].terms], [0, 0, 0]);
    const fd = pairs => ({ $formData: pairs });
    const monthlyTerm = col => ({ $sql: `select ${col} from public.invoice_session_terms t join public.invoices i on i.id=t.invoice_id
      where t.tenant_id=$1 and i.student_id=$2 and i.period='2026-11' and t.class_id=$3 and i.status<>'void' limit 1`, params: [tenantId, fixture.student_id, fixture.class_id] });
    const source = { $sql: 'select line_items from public.invoices where id=$1 and tenant_id=$2', params: [multi.id, tenantId] };
    const mr = await importV2('features/billing/session-terms/month-roster.ts');
    const { results, probes } = await runV2Server({ actorId: fixture.actor_id, tenantId, mode: 'write', rollback: true, allowRefs: true, steps: [
      { module: 'features/enrollments/server/actions.ts', fn: 'createEnrollment', args: [null, fd([['studentId', fixture.student_id], ['classId', fixture.class_id], ['startDate', '2026-11-01']])] },
      { module: 'features/billing/server/actions.ts', fn: 'createInvoice', args: [null, fd([['studentId', fixture.student_id], ['period', '2026-11'], ['amountTotal', '100000']])] },
      { module: `${S}actions.ts`, fn: 'confirmSessionTerm', args: [null, fd([['id', mr.virtualTermId(fixture.student_id, fixture.class_id)], ['period', '2026-11'], ['sessions', '4'], ['unitPrice', '25000']])] },
      { module: `${S}monthly-sessions.ts`, fn: 'updateMonthlyTermSessions', args: [monthlyTerm('t.id::text'), 5, monthlyTerm(`to_jsonb(t.confirmed_at) #>> '{}'`)] },
      { module: `${S}receipt-allocation-actions.ts`, fn: 'mergeReceiptItems', args: [multi.id, source, [0, 2], '연습 합산'] },
    ], probes: [
      { text: `select t.pricing_mode::text pricing_mode, t.confirmed_sessions::float8 confirmed_sessions, t.unit_price::float8 unit_price, t.amount::float8 amount
        from public.invoice_session_terms t join public.invoices i on i.id=t.invoice_id where i.student_id=$1 and i.period='2026-11' and t.class_id=$2`, params: [fixture.student_id, fixture.class_id] },
      { text: 'select line_items from public.invoices where id=$1', params: [multi.id] },
      { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and created_at=now()`, params: [tenantId] },
      { text: 'select count(*)::int n from net.http_request_queue' },
    ] });
    assert.ok(results[0].value?.enrollmentId, '2.0 반 배정');
    assert.deepEqual(results[1].value, { ok: true }, '2.0 테스트 청구서');
    const confirmed = results[2].value, changed = results[3].value, merged = results[4].value;
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed).slice(0, 200));
    assert.equal(confirmed.terms?.[0]?.pricingMode, 'monthly');
    assert.equal(changed.error, undefined, JSON.stringify(changed).slice(0, 200));
    assert.equal(changed.terms?.[0]?.confirmedSessions, 5);
    assert.deepEqual([changed.terms[0].amount, changed.terms[0].unitPrice], [confirmed.terms[0].amount, confirmed.terms[0].unitPrice], '월 시수만 바꾸고 확정액·단가는 보존');
    assert.deepEqual([probes[0][0].pricing_mode, probes[0][0].confirmed_sessions, probes[0][0].unit_price, probes[0][0].amount],
      ['monthly', 5, confirmed.terms[0].unitPrice, confirmed.terms[0].amount]);
    assert.equal(merged.committed, true, JSON.stringify(merged).slice(0, 200));
    assert.equal(merged.data?.source?.length, multi.line_items.length - 1, '청구 항목 둘을 한 항목으로 합침');
    assert.ok(JSON.stringify(merged.data.source).includes('연습 합산'));
    assert.equal(probes[1][0].line_items.length, multi.line_items.length - 1);
    assert.equal(probes[1][0].line_items.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), multi.line_items.reduce((sum, row) => sum + Number(row.amount ?? 0), 0), '청구 총액 보존');
    const actions = new Set(probes[2].map(r => r.action));
    for (const action of ['enrollment_assign', 'invoice_create', 'session_term_confirm', 'session_term_monthly_units']) assert.ok(actions.has(action), action);
    assert.ok(probes[2].every(r => r.via === '3.0 연습 복사본'));
    assert.equal(probes[3][0].n, before[0].queued, '바깥 요청 0');
    const after = await db`select
      (select count(*)::int from public.enrollments where student_id=${fixture.student_id} and class_id=${fixture.class_id}) enrollments,
      (select count(*)::int from public.invoices where student_id=${fixture.student_id} and period='2026-11' and status<>'void') invoices,
      (select count(*)::int from public.invoice_session_terms t join public.invoices i on i.id=t.invoice_id where i.student_id=${fixture.student_id} and i.period='2026-11') terms,
      (select count(*)::int from net.http_request_queue) queued`;
    assert.deepEqual(after, before, '시험이 만든 행·바깥 요청은 모두 되돌림');
    assert.deepEqual((await db`select line_items from public.invoices where id=${multi.id}`)[0].line_items, multi.line_items, '원래 테스트 청구 항목 보존');
  });

  await check('회차 확정 읽기 셋(배분 창 · 이월 선택지 · 지우기 미리보기) = 2.0 서버 함수를 화면 GET으로 — 쓰기 0 · 모르는 함수 거절', async () => {
    const sept = (await load({ tab: 'sessions', period: '2026-09' })).sessions.confirm.view.rows;
    const row = sept.find(r => r.termState === 'term' && r.invoiceId);
    const alloc = await load({ call: 'getReceiptAllocation', args: JSON.stringify([row.invoiceId]) });
    assert.ok(alloc.value && (alloc.value.data || alloc.value.error), '2.0 { data } | { error } 모양');
    const pre = await load({ call: 'getSessionTermDeletePreview', args: JSON.stringify([row.id, '2026-09']) });
    assert.ok(pre.value && ('preview' in pre.value || 'error' in pre.value));
    await assert.rejects(async () => { await load({ call: 'confirmSessionTerm', args: '[]' }); }, '읽기 목록 밖 함수');
  });

  await check('강사 정산 = 2.0 canReadSalary 게이트 · getTeacherTuitionView · getClassSalaryRows 그대로 — 급여 열람 게이트를 못 지나면 자료를 싣지 않는다 · 시험 출력에 금액 없음', async () => {
    const d = (await load({ tab: 'payroll', period: '2026-09' })).payroll;
    assert.equal(d.canRead, true, '원장 = 급여 열람');
    assert.ok(Array.isArray(d.view.rows) && d.view.rows.length > 0, '강사 줄');
    assert.ok(plainDeep(d));
    assert.equal(typeof d.view.total, 'number'); assert.ok(d.classRows.length > 0, '반별 급여 줄(2.0 getClassSalaryRows)');
    // 관리자(기본 표 = 급여 열람 없음) — 면이 수납으로 떨어지고 급여 자료는 실리지 않는다.
    const admin = base.editors.find(e => e.role === '관리자');
    const a = await load({ viewer: admin.id, tab: 'payroll' });
    assert.equal(a.payroll ?? null, null); assert.ok(!JSON.stringify(a).includes('hourly_rate') && !('payroll' in a && a.payroll));
    const P2 = await import('./v2-billing-payroll.mjs');
    const R = await importV2('features/billing/calc.ts');
    const direct = await P2.readPayrollFace(tenantId, { calc: R }, { id: admin.id }, { period: '2026-09' });
    assert.deepEqual(direct, { period: '2026-09', canRead: false, canEdit: false, view: null, classRows: null, canPayslip: false }, '2.0 canReadSalary가 거짓이면 조회 자체를 하지 않는다');
  });

  await check('강사 정산 저장(되돌림) = 2.0 saveClassSalary 그대로(테스트 반) · 급여 설정 권한이 없는 사람은 2.0 거절 문구 · 바깥 요청 0', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const [cls] = await db`select id::text id from public.classes where tenant_id=${tenantId} and class_name like '학원이(테스트)%' limit 1`;
    assert.ok(cls, '테스트 반');
    const fd = pairs => ({ $formData: Object.entries(pairs) });
    const beforeN = (await db`select count(*)::int n from public.class_salary_settings where tenant_id=${tenantId} and class_id=${cls.id}`)[0].n;
    const { results, probes } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'write', rollback: true, steps: [
      { module: 'features/payroll/server/class-salary-actions.ts', fn: 'saveClassSalary', args: [null, fd({ classId: cls.id, salaryGroup: '', commissionRate: '150' })] },
      { module: 'features/payroll/server/class-salary-actions.ts', fn: 'saveClassSalary', args: [null, fd({ classId: cls.id, salaryGroup: '', commissionRate: '45' })] },
    ], probes: [
      { text: 'select count(*)::int n from public.class_salary_settings where tenant_id = $1 and class_id = $2', params: [tenantId, cls.id] },
      { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id = $1 and created_at = now()`, params: [tenantId] },
    ] });
    assert.deepEqual(results[0].value, { error: '배분율은 0~100 사이여야 합니다' });
    assert.equal(results[1].value?.error, undefined, '저장됨');
    assert.equal(probes[0][0].n, 1, '그 반의 급여 설정 한 줄');
    assert.ok(probes[1].length >= 1 && probes[1].every(l => l.via === '3.0 연습 복사본'));
    assert.equal((await db`select count(*)::int n from public.class_salary_settings where tenant_id=${tenantId} and class_id=${cls.id}`)[0].n, beforeN, '되돌린 뒤 그대로');
    const admin = base.editors.find(e => e.role === '관리자');
    const { results: [denied] } = await runV2Server({ actorId: admin.id, tenantId, mode: 'write', rollback: true, steps: [
      { module: 'features/payroll/server/class-salary-actions.ts', fn: 'saveClassSalary', args: [null, fd({ classId: cls.id, commissionRate: '10' })] }] });
    assert.deepEqual(denied.value, { error: '급여 설정 변경 권한이 없습니다' });
  });

  await check('수납 통계(/billing/stats) = 2.0 loadBillingStats 그대로(인자 = 2.0 period 함수로 주소에서) — 지난 기록 = 원본 표 + 2.0 mergeTuitionHistory · 기간 열쇠가 인자로 간다 · 수납 권한이 없으면 싣지 않는다', async () => {
    const d = await load({ v2path: '/billing/stats' });
    assert.equal(d.page, 'stats'); assert.ok(plainDeep(d.stats));
    const s = d.stats;
    assert.equal(s.months.length, 12); assert.equal(s.months.at(-1), s.today.slice(0, 7), '마지막 달 = 이번 달');
    assert.deepEqual(s.rows.map(r => r.period), s.months, '달마다 요약 한 줄');
    assert.ok(s.expenses && Array.isArray(s.expenses.keys), '지출 추이');
    const T = await importV2('features/billing/stats/tuition-history.ts');
    const raw = await db`select month::text, source, data from public.student_history_monthly where tenant_id=${tenantId} order by month limit 400`;
    assert.deepEqual(s.tuition, T.mergeTuitionHistory(raw.map(r => ({ month: r.month.slice(0, 7), source: r.source, data: r.data }))), '지난 기록 = 원본 표');
    const d24 = (await load({ v2path: '/billing/stats', span: '24', ex: 'day' })).stats;
    assert.equal(d24.months.length, 24); assert.equal(d24.expensePeriod.grain, 'day', '지출 기간 열쇠(ex) = 2.0 EXPENSE_TREND_KEYS');
    for (const e of base.editors) {
      const v = await load({ viewer: e.id, v2path: '/billing/stats' });
      if (!v.access.billing) { assert.equal(v.page, 'noAccess'); assert.equal(v.stats, undefined); }
    }
  });

  await check('수납 통계 보기 모드 저장(되돌림) = 2.0 saveBillingStatsMode 그대로 — 계정 귀속 ui_prefs · 모르는 값은 2.0 거절', async () => {
    const { runV2Server } = await import('./v2-server-runner.mjs');
    const before = (await db`select ui_prefs::text p from public.users where id=${base.viewer.id}`)[0].p;
    const { results, probes } = await runV2Server({ actorId: base.viewer.id, tenantId, mode: 'write', rollback: true, steps: [
      { module: 'features/billing/stats/prefs-actions.ts', fn: 'saveBillingStatsMode', args: [{ mode: 'month24' }] },
      { module: 'features/billing/stats/prefs-actions.ts', fn: 'saveBillingStatsMode', args: [{ mode: 'day' }] },
    ], probes: [{ text: `select ui_prefs->'billingStats' p from public.users where id = $1`, params: [base.viewer.id] }] });
    assert.equal(results[0].value?.ok, true); assert.deepEqual(results[1].value, { ok: false, error: '알 수 없는 보기입니다' });
    assert.equal(JSON.stringify(probes[0][0].p).includes('month24'), true, '저장됨(트랜잭션 안)');
    assert.equal((await db`select ui_prefs::text p from public.users where id=${base.viewer.id}`)[0].p, before, '되돌린 뒤 그대로');
  });
} finally { await db.end(); await (await import('./v2-server-runner.mjs')).stopV2Server(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-billing-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('billing.js', dist), 'utf8'), html = await readFile(new URL('billing.html', dist), 'utf8');
  const hosts = [...new Set([...(js + html).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis|payssam|toss/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리 · 셸 계정 하나 · 총 청구액 기준 안내 — 운영 주소·외부 주소·저장 요청 없음', async () => {
  const js = await here('./v2-screen-billing.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  assert.match(js, /HOST = `\/v2-host\/\$\{ID\}\.html`/); assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  assert.match(js, /const ID = 'billing'/); assert.match(js, /S\.accountId\(\)/);
  assert.match(js, /‘총 청구액’ 기준:/);
  assert.doesNotMatch(js, /data-v2h-actor|currentActor|localStorage|v2h-note/);
  const shown = [/toast\?\.\('([^']*)'\)/, /frame\.title = '([^']*)'/, /const wait = ([^;]*);/]
    .map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  // 주석은 화면에 안 나간다 — 주석 줄 · 줄 끝 주석을 빼고 본다.
  const parts = (lf(await here('./v2-host/src/billing-host-parts.tsx')) + lf(await here('./v2-host/src/billing.tsx'))).split('\n')
    .filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const hostShown = [...parts.matchAll(/(?:text=\{?["'`]|>)([^<>{}"'`]*[가-힣][^<>{}"'`]*)/g)].map(m => m[1]).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트|슈퍼|총괄/i]) { assert.doesNotMatch(shown, bad, String(bad)); assert.doesNotMatch(hostShown, bad, `호스트 ${bad}`); }
});

await check('공용 러너 격리 — 모듈 훅은 작업 스레드에서만 register · 메인 스레드 파일엔 register가 없다 · 작업 스레드는 바깥 fetch를 막는다', async () => {
  const runner = await here('./v2-server-runner.mjs'), worker = await here('./v2-server/worker.mjs'), screen = await here('./v2-billing-sessions.mjs');
  assert.doesNotMatch(runner + screen, /\bregister\(/); assert.match(worker, /register\('\.\/hooks\.mjs'/);
  assert.match(worker, /globalThis\.fetch = async/);
  assert.match(runner, /new Worker\(new URL\('\.\/v2-server\/worker\.mjs'/);
});

console.log(`v2 billing: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
