// 2.0 화면 — 수납관리 · 지출 면(expenses-panel.tsx) + 지출결의서 상세(/billing/expenses/<id>)의 조회와 저장을 Docker 복사본에서 같은 결과로.
//  · 조회 = features/billing/server/expense-queries.ts getExpensesForMonth · getExpenseMonths · getExpenseById + summarizeExpenses(돈 집계)
//  · 저장 = expense-actions.ts createExpense · updateExpense · deleteExpense · toggleExpenseApproval · duplicateExpense · setExpenseReceiptType
// 행 정규화(mapExpenseRow)·집계(summarizeExpenses)·폼 읽기(parse · validate)는 2.0 서버 파일 안의 순수 함수라 그 선언을 **그대로** 실행한다(v2-billing-pure.mjs).
// 🔴 계좌번호/카드번호(account_number)는 2.0도 수납 권한 화면에 내는 칸이다 — 같은 게이트(보는 사람 = 수납 권한)로만 싣고, 감사로그·시험 출력에 찍지 않는다.
// 증빙 첨부 파일(파일 저장소)은 복사본 밖이라 받지 않는다(올리기·지우기·열기 = 아직 지원하지 않는 저장 · 지울 때 파일은 건드리지 않고 수만 2.0처럼 센다).
import { pureFrom } from './v2-billing-pure.mjs';
import { audit, formOf, asViewer, billingAction, canWriteBilling, UUID_RE } from './v2-billing-common.mjs';

const QUERIES = 'features/billing/server/expense-queries.ts', ACTIONS = 'features/billing/server/expense-actions.ts';
let rulesPromise = null;
/** 2.0 순수 함수 — 조회 파일의 정규화·집계 · 액션 파일의 폼 읽기·검사 · 상수(분류 · 결재 역할 · 증빙 유형). */
export function loadExpenseRules(importV2) {
  rulesPromise ??= (async () => {
    const [cur, dk] = await Promise.all([importV2('features/billing/currencies.ts'), importV2('lib/date-kst.ts')]);
    const q = await pureFrom(QUERIES, ['APPROVAL_ROLES', 'normalizeReceiptUrls', 'normalizeApprovalChecks', 'normalizeLineItems', 'mapExpenseRow', 'summarizeExpenses', 'monthRange'],
      { DEFAULT_CURRENCY: cur.DEFAULT_CURRENCY, roundMoney: cur.roundMoney });
    const a = await pureFrom(ACTIONS, ['RECEIPTS_BUCKET', 'RECEIPT_TYPES', 'UUID_RE', 'SAFE_FILE_RE', 'isTenantReceiptPath', 'parseReceipts', 'VALID_CATEGORIES', 'won', 'VALID_ROLES',
      'APPROVAL_ROLE_LABEL', 'parse', 'validate'], { DEFAULT_CURRENCY: cur.DEFAULT_CURRENCY, isValidCurrency: cur.isValidCurrency, roundMoney: cur.roundMoney });
    return { q, a, cur, dk };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 조회 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PostgREST가 내던 모양: 날짜 = 'YYYY-MM-DD' · 시각 = to_json 글자 · numeric = 숫자 · jsonb = 그대로.
const EXPENSE_COLS = sql => sql`id::text id, title, category, amount, currency, expense_date::text expense_date, to_json(created_at)#>>'{}' created_at, vendor, department, author,
  position, bank_name, account_number, approval_status, approval_checks, payment_method, memo, line_items, receipt_type, receipt_urls, created_by::text created_by`;

/** 2.0 getExpensesForMonth(period) — [그 달 1일, 다음 달 1일) · 지출일 최신순 → id. */
export async function readExpensesForMonth(sql, t, X, period) {
  const { start, end } = X.q.monthRange(period);
  const rows = await sql`select ${EXPENSE_COLS(sql)} from public.expenses where tenant_id=${t} and expense_date >= ${start}::date and expense_date < ${end}::date order by expense_date desc, id`;
  return rows.map(r => X.q.mapExpenseRow({ ...r, amount: r.amount == null ? r.amount : Number(r.amount) }));
}
/** 2.0 getExpenseMonths — 지출이 있는 달(최신순). */
export async function readExpenseMonths(sql, t) {
  const rows = await sql`select distinct to_char(expense_date, 'YYYY-MM') m from public.expenses where tenant_id=${t} and expense_date is not null`;
  return rows.map(r => r.m).sort().reverse();
}
/** 2.0 getExpenseById(id) — 없으면 null(→ notFound). */
export async function readExpenseById(sql, t, X, id) {
  const [r] = UUID_RE.test(id) ? await sql`select ${EXPENSE_COLS(sql)} from public.expenses where tenant_id=${t} and id=${id}` : [];
  return r ? X.q.mapExpenseRow({ ...r, amount: r.amount == null ? r.amount : Number(r.amount) }) : null;
}

/** 지출 면 자료 — expenses-panel.tsx가 서버에서 받던 값(이 달 전체 행 · 지출 달 목록) + 집계(2.0 summarizeExpenses, 이 달 전체 기준). */
export async function readExpensesFace(sql, t, importV2, sp) {
  const X = await loadExpenseRules(importV2);
  const period = sp.period ?? X.dk.kstMonth();
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const [rows, months] = await Promise.all([valid ? readExpensesForMonth(sql, t, X, period) : [], readExpenseMonths(sql, t)]);
  return { rows, months, summary: X.q.summarizeExpenses(rows, period) };
}

// ── 저장 — expense-actions.ts ──────────────────────────────────────────────────────────────────────────────────────
/** 2.0 expenseWriteScope — 수납 쓰기 = 'full'(전건 · 결재) · 지출결의서 쓰기 = 'own'(본인 것만) · 그 밖 null. */
const writeScope = actor => (canWriteBilling(actor) ? 'full' : actor && (actor.expenseRequests === 'full' || actor.expenseRequests === 'scoped') ? 'own' : null);
/** RLS 읽기 한 줄(2.0 사용자 클라이언트 .maybeSingle()) — { data, error }. */
const one = async (sql, actor, fn) => { const r = await asViewer(sql, actor, fn); return { data: r.data?.[0] ?? null, error: r.error }; };

async function guardOwnExpense(sql, X, actor, id) {
  const { data: row } = await one(sql, actor, s => s`select created_by::text created_by, approval_checks from public.expenses where id::text=${id}`);
  if (!row) return '지출을 찾을 수 없습니다';
  if (row.created_by !== actor.id) return '본인이 작성한 지출결의서만 수정할 수 있습니다';
  const checks = X.q.normalizeApprovalChecks(row.approval_checks);
  if (checks.director?.checked || checks.ceo?.checked) return '사무실 결재가 시작되어 수정할 수 없습니다 — 사무실에 문의하세요.';
  return null;
}
const json = (s, v) => (v == null ? null : s.json(v));

async function createExpense({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!writeScope(actor)) return { error: '지출결의서 작성 권한이 없습니다' };
  const f = X.a.parse(fd), invalid = X.a.validate(f);
  if (invalid) return invalid;
  const { data: created, error } = await one(sql, actor, s => s`insert into public.expenses ${s({ tenant_id: t, title: f.title, category: f.category, amount: f.amount, currency: f.currency,
    expense_date: f.expenseDate, vendor: f.vendor, department: f.department, author: f.author ?? actor.name, position: f.position, payment_method: f.paymentMethod, bank_name: f.bankName,
    account_number: f.accountNumber, memo: f.memo, line_items: json(s, f.lineItems), created_by: actor.id,
    approval_checks: s.json({ author: { checked: true, date: X.dk.kstToday() } }) })} returning id::text id`);
  if (error) return { error: error.message };
  // 🔴 계좌번호는 담지 않는다(2.0 그대로).
  await audit(sql, t, actor, 'expense_create', 'expense', { expenseId: created?.id ?? null, amount: f.amount, currency: f.currency, category: f.category, expenseDate: f.expenseDate }, f.title);
  return { ok: true };
}

async function updateExpense({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  const scope = writeScope(actor);
  if (!scope) return { error: '지출 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '지출 ID가 누락되었습니다' };
  if (scope === 'own') { const denied = await guardOwnExpense(sql, X, actor, id); if (denied) return { error: denied }; }
  const f = X.a.parse(fd), invalid = X.a.validate(f);
  if (invalid) return invalid;
  const { data: before } = await one(sql, actor, s => s`select title, amount, currency, category, expense_date::text expense_date from public.expenses where id::text=${id}`);
  const { error } = await asViewer(sql, actor, s => s`update public.expenses set ${s({ title: f.title, ...(f.author ? { author: f.author } : {}), category: f.category, amount: f.amount,
    currency: f.currency, expense_date: f.expenseDate, vendor: f.vendor, department: f.department, position: f.position, payment_method: f.paymentMethod, bank_name: f.bankName,
    account_number: f.accountNumber, memo: f.memo, line_items: json(s, f.lineItems), updated_at: new Date().toISOString() })} where id::text=${id}`);
  if (error) return { error: error.message };
  await audit(sql, t, actor, 'expense_update', 'expense', { expenseId: id, amount: f.amount, currency: f.currency, category: f.category, expenseDate: f.expenseDate,
    ...(before && Number(before.amount) !== f.amount ? { amountBefore: Number(before.amount) } : {}),
    ...(before && before.title !== f.title ? { titleBefore: before.title } : {}),
    ...(before && before.category !== f.category ? { categoryBefore: before.category } : {}),
    ...(before && before.expense_date !== f.expenseDate ? { expenseDateBefore: before.expense_date } : {}) }, f.title);
  return { ok: true };
}

async function deleteExpense({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  const scope = writeScope(actor);
  if (!scope) return { error: '지출 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '지출 ID가 누락되었습니다' };
  if (scope === 'own') { const denied = await guardOwnExpense(sql, X, actor, id); if (denied) return { error: denied }; }
  const { data: row } = await one(sql, actor, s => s`select receipt_urls, title, amount, currency, category, expense_date::text expense_date from public.expenses where id::text=${id}`);
  // 증빙 파일 = 파일 저장소(복사본 밖) — 지우지 않고 2.0처럼 수만 센다.
  const paths = X.a.parseReceipts(row?.receipt_urls).map(r => r.path).filter(p => X.a.isTenantReceiptPath(p, t, id));
  const { data: gone, error } = await asViewer(sql, actor, s => s`delete from public.expenses where id::text=${id} returning id`);
  if (error) return { error: error.message };
  if (gone?.length) await audit(sql, t, actor, 'expense_delete', 'expense', { expenseId: id, amount: Number(row?.amount ?? 0), currency: row?.currency ?? null,
    category: row?.category ?? null, expenseDate: row?.expense_date ?? null, receiptsRemoved: paths.length }, row?.title ?? null);
  return { ok: true };
}

async function toggleExpenseApproval({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '지출 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '지출 ID가 누락되었습니다' };
  const role = String(fd.get('role') ?? '').trim();
  if (!X.a.VALID_ROLES.has(role)) return { error: '잘못된 결재 역할입니다' };
  const checked = String(fd.get('checked') ?? '') === 'true';
  const { data: row, error: readErr } = await one(sql, actor, s => s`select approval_checks, title from public.expenses where id::text=${id}`);
  if (readErr) return { error: readErr.message };
  if (!row) return { error: '지출을 찾을 수 없습니다' };
  const base = X.q.normalizeApprovalChecks(row.approval_checks);
  base[role] = checked ? { checked: true, date: X.dk.kstToday() } : { checked: false };
  const approvalStatus = base.director?.checked && base.ceo?.checked ? 'approved' : 'pending';
  const { error } = await asViewer(sql, actor, s => s`update public.expenses set ${s({ approval_checks: s.json(base), approval_status: approvalStatus, updated_at: new Date().toISOString() })} where id::text=${id}`);
  if (error) return { error: error.message };
  await audit(sql, t, actor, 'expense_approval', 'expense', { expenseId: id, role, roleLabel: X.a.APPROVAL_ROLE_LABEL[role] ?? role, checked, direction: checked ? '승인' : '해제', approvalStatus }, row.title ?? null);
  return { ok: true };
}

async function duplicateExpense({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  const scope = writeScope(actor);
  if (!scope) return { error: '지출 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '지출 ID가 누락되었습니다' };
  const { data: src, error: readErr } = await one(sql, actor, s => s`select title, category, amount, currency, vendor, department, payment_method, bank_name, account_number, memo, line_items,
    created_by::text created_by from public.expenses where id::text=${id}`);
  if (readErr) return { error: readErr.message };
  if (!src) return { error: '원본 지출을 찾을 수 없습니다' };
  if (scope === 'own' && src.created_by !== actor.id) return { error: '본인이 작성한 지출결의서만 복제할 수 있습니다' };
  const today = X.dk.kstToday(), currency = src.currency ?? X.cur.DEFAULT_CURRENCY;
  const { data: created, error } = await one(sql, actor, s => s`insert into public.expenses ${s({ tenant_id: t, title: src.title, category: src.category, amount: src.amount, currency,
    expense_date: today, vendor: src.vendor, department: src.department, author: actor.name, position: null, payment_method: src.payment_method, bank_name: src.bank_name,
    account_number: src.account_number, memo: src.memo, line_items: json(s, src.line_items), created_by: actor.id, approval_status: 'pending',
    approval_checks: s.json({ author: { checked: true, date: today } }) })} returning id::text id`);
  if (error) return { error: error.message };
  await audit(sql, t, actor, 'expense_duplicate', 'expense', { expenseId: created?.id ?? null, sourceId: id, amount: Number(src.amount ?? 0), currency, category: src.category ?? null, expenseDate: today }, src.title ?? null);
  return { ok: true };
}

async function setExpenseReceiptType({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadExpenseRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  const scope = writeScope(actor);
  if (!scope) return { error: '지출 관리 권한이 없습니다' };
  const id = String(fd.get('id') ?? '').trim();
  if (!id) return { error: '지출 ID가 누락되었습니다' };
  if (scope === 'own') { const denied = await guardOwnExpense(sql, X, actor, id); if (denied) return { error: denied }; }
  const type = String(fd.get('receiptType') ?? '').trim();
  if (type && !X.a.RECEIPT_TYPES.has(type)) return { error: '잘못된 증빙 유형입니다' };
  const { error } = await asViewer(sql, actor, s => s`update public.expenses set ${s({ receipt_type: type || null, updated_at: new Date().toISOString() })} where id::text=${id}`);
  if (error) return { error: error.message };
  await audit(sql, t, actor, 'expense_receipt_type', 'expense', { expenseId: id, receiptType: type || null });
  return { ok: true };
}

const formArgs = args => formOf(args[1]);
export const expenseActions = Object.fromEntries([createExpense, updateExpense, deleteExpense, toggleExpenseApproval, duplicateExpense, setExpenseReceiptType]
  .map(fn => [fn.name, billingAction(ACTIONS, 2, fn, formArgs)]));
