// 2.0 화면 — 수납관리 · 수납 면 저장(청구서 만들기 · 수동 청구서 완납/취소)을 Docker 복사본에서 같은 결과로.
//  · features/billing/server/actions.ts createInvoice(_prev, fd) — 학생·청구월·종류·금액·할인 → 수동 청구서(미납) · 납부기한 비면 학원 설정 dueDay
//  · manual-invoice-actions.ts markManualInvoicePaid(id, method?) · voidManualInvoice(id) — 수동 청구서만(메이크에듀 동기화분은 거절)
// 폼 읽기·분류 표(INVOICE_CATEGORIES · won)는 2.0 서버 파일 안의 순수 함수라 원문 그대로 실행한다. 쓰기는 사용자 역할(RLS)로.
// 🔴 '그 사이 바뀜' 검사(2.0 `.eq("updated_at", inv.updated_at)`) — postgres.js에 시각 문자열을 timestamptz로 넘기면 마이크로초가 잘려 늘 0행이 된다.
//    그래서 읽을 때 마이크로초까지 글자로 받고, 쓸 때 같은 글자와 비교한다.
import { pureFrom } from './v2-billing-pure.mjs';
import { readBranding, audit, formOf, asViewer, billingAction, canWriteBilling, badRequest } from './v2-billing-common.mjs';

const ACTIONS = 'features/billing/server/actions.ts', MANUAL = 'features/billing/server/manual-invoice-actions.ts';
let rulesPromise = null;
function loadInvoiceSaveRules(importV2) {
  rulesPromise ??= (async () => {
    const [calc, lines, dbError] = await Promise.all(['features/billing/tuition-calc.ts', 'features/billing/invoice-lines.ts', 'lib/supabase/db-error.ts'].map(p => importV2(p)));
    const a = await pureFrom(ACTIONS, ['INVOICE_CATEGORIES', 'PERIOD_RE', 'won']);
    return { calc, lines, dbError, a };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}
const US = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;

async function createInvoice({ sql, t, R, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadInvoiceSaveRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납 관리 권한이 없습니다' };
  const studentId = String(fd.get('studentId') ?? '').trim(), period = String(fd.get('period') ?? '').trim(), categoryRaw = String(fd.get('category') ?? 'tuition').trim();
  const amountTotal = X.a.won(fd.get('amountTotal')), amountDiscount = X.a.won(fd.get('amountDiscount'));
  let dueDate = String(fd.get('dueDate') ?? '').trim() || null;
  const notes = String(fd.get('notes') ?? '').trim() || null, billedAt = String(fd.get('billedAt') ?? '').trim() || null, discountReason = String(fd.get('discountReason') ?? '').trim() || null;
  const fieldErrors = {};
  if (!studentId) fieldErrors.studentId = '학생을 선택해주세요';
  if (!X.a.PERIOD_RE.test(period)) fieldErrors.period = '청구월 형식은 YYYY-MM 입니다';
  if (amountTotal <= 0) fieldErrors.amountTotal = '청구액을 입력해주세요';
  if (amountDiscount > amountTotal) fieldErrors.amountDiscount = '할인액이 청구액보다 클 수 없습니다';
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  const category = X.a.INVOICE_CATEGORIES[categoryRaw] ? categoryRaw : 'tuition';
  if (!dueDate) dueDate = X.calc.resolveDueDate(period, (await readBranding(sql, t, R)).billing.dueDay) || null;
  const lineItems = [{ kind: category, description: X.a.INVOICE_CATEGORIES[category], amount: amountTotal }];
  const { error } = await asViewer(sql, actor, s => s`insert into public.invoices ${s({ tenant_id: t, student_id: studentId, period, category, amount_total: amountTotal, amount_paid: 0,
    amount_discount: amountDiscount, status: 'unpaid', line_items: s.json(lineItems), due_date: dueDate, billed_at: billedAt, discount_reason: discountReason, notes })}`);
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) return { error: '이미 해당 학생의 이 달 청구서가 있습니다' };
    return { error: error.message };
  }
  await audit(sql, t, actor, 'invoice_create', 'invoice', { studentId, amountTotal }, `${period} · ${X.a.INVOICE_CATEGORIES[category]}`);
  return { ok: true };
}

/** 2.0 loadManualInvoice — 쓰기 게이트 · 청구서 · 수동 청구서 모양(메이크에듀 동기화분 거절). */
async function loadManualInvoice({ sql, t }, X, actor, invoiceId) {
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납 관리 권한이 없습니다' };
  if (typeof invoiceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return { error: '청구서를 찾을 수 없습니다' };
  const r = await asViewer(sql, actor, s => s`select id::text id, student_id::text student_id, period, status, amount_total, amount_discount, amount_paid, line_items, notes,
    ${US(s, 'updated_at')} updated_at from public.invoices where tenant_id=${t} and id::text=${invoiceId}`);
  if (r.error) return { error: X.dbError.humanizeDbError(r.error.message, '조회') };
  const inv = r.data?.[0];
  if (!inv) return { error: '청구서를 찾을 수 없습니다' };
  if (!X.lines.isManualInvoiceShape(inv.line_items)) return { error: '메이크에듀에서 동기화된 청구서는 여기서 바꿀 수 없습니다 — 메이크에듀에서 고치면 다음 동기화에 반영됩니다' };
  return { inv };
}

async function voidManualInvoice(io, actor, [invoiceId]) {
  const { sql, t, importV2 } = io, X = await loadInvoiceSaveRules(importV2), ctx = await loadManualInvoice(io, X, actor, invoiceId);
  if ('error' in ctx) return { error: ctx.error };
  const { inv } = ctx;
  if (inv.status !== 'unpaid') return { error: inv.status === 'void' ? '이미 취소된 청구서입니다' : '수납 기록이 있는 청구서는 취소할 수 없습니다' };
  const c = await asViewer(sql, actor, s => s`select count(*)::int n from public.invoice_session_terms where tenant_id=${t} and invoice_id=${inv.id}
    and (confirmed_sessions is not null or allocation_amount is not null)`);
  if (c.error) return { error: '회차 확정 연결을 확인하지 못했습니다. 다시 시도해 주세요' };
  if ((c.data?.[0]?.n ?? 0) > 0) return { error: '회차 확정·수납 배분이 걸린 청구서입니다 — 회차 확정 면에서 먼저 해제한 뒤 취소해 주세요' };
  const u = await asViewer(sql, actor, s => s`update public.invoices set status='void' where tenant_id=${t} and id=${inv.id} and status='unpaid'
    and ${US(s, 'updated_at')} = ${inv.updated_at} returning id`);
  if (u.error) return { error: X.dbError.humanizeDbError(u.error.message) };
  if (!u.data?.length) return { error: '그 사이 청구서가 바뀌었습니다 — 새로고침한 뒤 다시 시도해 주세요' };
  await audit(sql, t, actor, 'invoice_manual_void', 'invoice', { invoiceId: inv.id, studentId: inv.student_id, period: inv.period, statusFrom: inv.status,
    amountTotal: Number(inv.amount_total), amountDiscount: Number(inv.amount_discount) }, inv.period);
  return { ok: true };
}

async function markManualInvoicePaid(io, actor, [invoiceId, method]) {
  const { sql, t, importV2 } = io, X = await loadInvoiceSaveRules(importV2), ctx = await loadManualInvoice(io, X, actor, invoiceId);
  if ('error' in ctx) return { error: ctx.error };
  const { inv } = ctx;
  if (inv.status !== 'unpaid' && inv.status !== 'partial') return { error: inv.status === 'paid' ? '이미 완납된 청구서입니다' : '이 상태의 청구서는 완납 처리할 수 없습니다' };
  const paymentMethod = method && Object.hasOwn(X.lines.PAYMENT_METHOD_LABEL, method) ? method : null;
  const net = Math.max(0, Number(inv.amount_total) - Number(inv.amount_discount));
  const patch = { status: 'paid', amount_paid: net, paid_at: new Date().toISOString(), ...(paymentMethod ? { payment_method: paymentMethod } : {}) };
  const u = await asViewer(sql, actor, s => s`update public.invoices set ${s(patch)} where tenant_id=${t} and id=${inv.id} and status=${inv.status}
    and ${US(s, 'updated_at')} = ${inv.updated_at} returning id`);
  if (u.error) return { error: X.dbError.humanizeDbError(u.error.message) };
  if (!u.data?.length) return { error: '그 사이 청구서가 바뀌었습니다 — 새로고침한 뒤 다시 시도해 주세요' };
  await audit(sql, t, actor, 'invoice_manual_paid', 'invoice', { invoiceId: inv.id, studentId: inv.student_id, period: inv.period, statusFrom: inv.status,
    paidFrom: Number(inv.amount_paid), paidTo: net, method: paymentMethod }, inv.period);
  return { ok: true };
}

const idArg = args => { if (typeof args[0] !== 'string' || args[0].length > 64) throw badRequest(); };
export const invoiceActions = {
  createInvoice: billingAction(ACTIONS, 2, createInvoice, args => formOf(args[1])),
  voidManualInvoice: billingAction(MANUAL, 1, voidManualInvoice, idArg),
  // 2.0 markManualInvoicePaid(invoiceId, method?) — 결제수단은 빼고 부를 수도 있다(인자 1~2개).
  markManualInvoicePaid: (() => {
    const one = billingAction(MANUAL, 1, markManualInvoicePaid, idArg), two = billingAction(MANUAL, 2, markManualInvoicePaid, args => {
      idArg(args); if (args[1] != null && (typeof args[1] !== 'string' || args[1].length > 20)) throw badRequest(); });
    return { validate: raw => (Array.isArray(raw?.args) && raw.args.length === 2 ? two : one).validate(raw), run: two.run };
  })(),
};
