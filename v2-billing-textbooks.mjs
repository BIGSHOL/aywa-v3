// 2.0 화면 — 수납관리 · 교재 면(textbooks-face.tsx: 목록 = textbooks-panel.tsx · 교재 단가표 = catalog-panel.tsx)의 조회와 저장을 Docker 복사본에서 같은 결과로.
//  · 조회 = features/billing/server/textbook-queries.ts getTextbookOrdersPage · getTextbookStats · getStudentOptions ·
//    catalog-queries.ts getCatalogOptions · getCatalogPage · getCatalogStats · 학원 설정(이름 · 로고 · 입금 계좌)
//  · 저장 = textbook-actions.ts toggleTextbookCheck · createTextbookOrder · updateTextbookOrder · deleteTextbookOrder(+ textbook-notice-handover.ts) ·
//    textbook-notice-actions.ts loadMyTextbookMent(읽기 = GET ment) · saveMyTextbookMent — 판정 · 문구 · 감사로그 2.0 그대로.
// 2.0은 이 면을 사용자 클라이언트(RLS)로 쓴다 — 쓰기는 같은 역할(authenticated)로 해서 정책·트리거가 2.0처럼 본다.
// 학원 로고(파일 저장소)·학부모 발송(ClassNote)·첨부 그림은 받지 않는다(로고 자리는 빈다 · 발송은 '아직 지원하지 않는 저장').
import { readStudentOptions } from './v2-billing-invoices.mjs';
import { readBranding, audit, formOf, asViewer, billingAction, canWriteBilling, badRequest } from './v2-billing-common.mjs';

let rulesPromise = null;
function loadTextbookRules(importV2) {
  rulesPromise ??= (async () => {
    const [progress, auditRules, dbError, notice, dk] = await Promise.all(['features/billing/textbook-progress.ts', 'features/billing/textbook-audit.ts',
      'lib/supabase/db-error.ts', 'features/billing/textbook-notice.ts', 'lib/date-kst.ts'].map(p => importV2(p)));
    return { progress, audit: auditRules, dbError, notice, dk };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 조회 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TS = (sql, col) => sql`to_json(${sql(col)})#>>'{}'`; // PostgREST가 내던 시각 글자(복사본 시간대 = UTC)
const ORDER_COLS = sql => sql`id::text id, book_name, book_detail, student_id::text student_id, student_name, teacher_name, created_by::text created_by,
  classnote_notice_id::text classnote_notice_id, price, status, request_date::text request_date, notes, ${TS(sql, 'registered_at')} registered_at, ${TS(sql, 'ordered_at')} ordered_at,
  ${TS(sql, 'paid_at')} paid_at, status_by_name, ${TS(sql, 'status_at')} status_at, ${TS(sql, 'created_at')} created_at`;
/** 2.0 mapOrderRow. */
const mapOrderRow = r => ({ id: r.id, bookName: r.book_name, bookDetail: r.book_detail, studentId: r.student_id, studentName: r.student_name, teacherName: r.teacher_name,
  price: Number(r.price), status: r.status, requestDate: r.request_date, notes: r.notes, registered: !!r.registered_at, ordered: !!r.ordered_at, paid: !!r.paid_at,
  registeredAt: r.registered_at, orderedAt: r.ordered_at, paidAt: r.paid_at, statusByName: r.status_by_name, statusAt: r.status_at, createdAt: r.created_at,
  createdBy: r.created_by ?? null, classnoteNoticeId: r.classnote_notice_id ?? null });
const checkCount = r => (r.registered ? 1 : 0) + (r.paid ? 1 : 0) + (r.ordered ? 1 : 0);

/** 2.0 getTextbookOrdersPage({ filter, q }, page, 50) — 전건(검색은 교재명·학생 ilike) → 상태 필터 → 체크 개수 오름차순 → 신청일 최신순 → 쪽. */
export async function readTextbookOrdersPage(sql, t, X, { filter, q }, page = 1, pageSize = 50) {
  const term = q ? q.replace(/[%,()*\\]/g, ' ').trim() : '';
  const all = await sql`select ${ORDER_COLS(sql)} from public.textbook_orders where tenant_id=${t}
    ${term ? sql`and (book_name ilike ${`%${term}%`} or student_name ilike ${`%${term}%`})` : sql``} order by request_date desc nulls last, id`;
  let rows = all.map(mapOrderRow);
  if (filter === 'reg') rows = rows.filter(r => !r.registered);
  else if (filter === 'pay') rows = rows.filter(r => !r.paid);
  else if (filter === 'order') rows = rows.filter(r => !r.ordered);
  else if (filter === 'done') rows = rows.filter(X.progress.textbookOrderSettled);
  rows.sort((a, b) => checkCount(a) - checkCount(b) || (b.requestDate ?? '').localeCompare(a.requestDate ?? ''));
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length };
}

/** 2.0 getTextbookStats — 전체 신청 · 단계별 미완 · 완료 · 금액(납부 미완 합계). */
export async function readTextbookStats(sql, t) {
  const rows = await sql`select registered_at is not null reg, ordered_at is not null ord, paid_at is not null paid, price from public.textbook_orders where tenant_id=${t}`;
  let needReg = 0, needPay = 0, needOrder = 0, done = 0, totalAmount = 0, unpaidAmount = 0;
  for (const r of rows) {
    if (!r.reg) needReg++; if (!r.paid) needPay++; if (!r.ord) needOrder++; if (r.reg && r.ord && r.paid) done++;
    const p = Number(r.price); totalAmount += p; if (!r.paid) unpaidAmount += p;
  }
  return { total: rows.length, needReg, needPay, needOrder, done, totalAmount, unpaidAmount, pending: rows.length - done };
}

/** 2.0 getCatalogOptions — 사용 중 교재(교재검색 선택지) 이름순. */
export async function readCatalogOptions(sql, t) {
  const rows = await sql`select id::text id, title, book_detail, price from public.textbook_catalog where tenant_id=${t} and is_active order by title asc, id asc`;
  return rows.map(r => ({ id: r.id, title: r.title, bookDetail: r.book_detail, price: r.price == null ? 0 : Number(r.price) }));
}

/** 2.0 getCatalogPage({ q, gradeLevel, active }, page, 50) · getCatalogStats. */
export async function readCatalogPanel(sql, t, { q, grade, active, page }) {
  const term = q ? q.replace(/[%_,()]/g, ' ').trim() : '', from = (page - 1) * 50;
  const where = sql`tenant_id=${t} ${grade && grade !== 'all' ? sql`and grade_level=${grade}` : sql``}
    ${active === 'active' ? sql`and is_active` : active === 'inactive' ? sql`and not is_active` : sql``}
    ${term ? sql`and (title ilike ${`%${term}%`} or publisher ilike ${`%${term}%`})` : sql``}`;
  const [rows, [{ n }], [stats]] = await Promise.all([
    sql`select id::text id, title, book_detail, grade_level, subject, publisher, price, is_active, ${TS(sql, 'sync_added_at')} sync_added_at
      from public.textbook_catalog where ${where} order by title asc, id asc offset ${from} limit 50`,
    sql`select count(*)::int n from public.textbook_catalog where ${where}`,
    sql`select count(*)::int total, count(*) filter (where is_active)::int active from public.textbook_catalog where tenant_id=${t}`,
  ]);
  return {
    page: { rows: rows.map(r => ({ id: r.id, title: r.title, bookDetail: r.book_detail, gradeLevel: r.grade_level, subject: r.subject, publisher: r.publisher,
      price: r.price == null ? 0 : Number(r.price), isActive: r.is_active, syncAddedAt: r.sync_added_at ?? null })), total: n },
    stats: { total: stats.total, active: stats.active },
  };
}

/** 교재 면 자료 — textbooks-face.tsx의 내부탭(목록 | 교재 단가표)이 고르는 쪽만. */
export async function readTextbooksFace(sql, t, R, importV2, sp) {
  const page = Math.max(1, Number(sp.page) || 1);
  if (sp.tsub === 'catalog') return { catalog: await readCatalogPanel(sql, t, { q: sp.q ?? '', grade: sp.grade ?? 'all', active: sp.active ?? 'all', page }), list: null };
  const X = await loadTextbookRules(importV2);
  const [orders, stats, students, catalog, branding] = await Promise.all([
    readTextbookOrdersPage(sql, t, X, { filter: sp.status ?? 'all', q: sp.q ?? '' }, page, 50), readTextbookStats(sql, t), readStudentOptions(sql, t),
    readCatalogOptions(sql, t), readBranding(sql, t, R),
  ]);
  // 로고 = 파일 저장소(복사본 밖) — 2.0 resolveBrandingSrc 자리는 비운다(요청서 카드에 로고가 빠진다).
  return { list: { page: orders, stats, students, catalog, settings: { profile: { name: branding.profile.name, logoUrl: null }, billing: branding.billing } }, catalog: null };
}

/** 2.0 loadMyTextbookMent() — 저장값(없거나 빈 글이면 기본 문구, 옛 기본 문구는 지금 기본으로). 읽기라 화면 GET(ment). */
export async function loadMyTextbookMent(sql, t, importV2, actor) {
  const X = await loadTextbookRules(importV2);
  if (!actor) return X.notice.DEFAULT_TEXTBOOK_MENT;
  const [row] = await sql`select textbook_notice_ment from public.users where tenant_id=${t} and id=${actor.id}`;
  const v = row?.textbook_notice_ment ?? null;
  return X.notice.resolveTextbookMent(v && v.trim() ? v : null);
}

// ── 저장 — textbook-actions.ts ─────────────────────────────────────────────────────────────────────────────────────
const CHECK_COLS = { registered: 'registered_at', ordered: 'ordered_at', paid: 'paid_at' };
const DELETE_BLOCKED_MSG = '이 요청서를 지울 권한이 없습니다 — 요청서에 적힌 담당 선생님 이름이 본인과 다르면 관리자에게 요청해주세요.';
const snapshotOf = row => ({ studentName: row?.student_name ?? null, teacherName: row?.teacher_name ?? null, bookName: row?.book_name ?? null, bookDetail: row?.book_detail ?? null,
  price: row?.price == null ? null : Number(row.price), requestDate: row?.request_date ?? null, notes: row?.notes ?? null });
const AUDIT_COLS = sql => sql`student_id::text student_id, student_name, teacher_name, book_name, book_detail, price, request_date::text request_date, notes`;
const won = v => Math.max(0, Number(String(v ?? '0').replace(/[,\s]/g, '')) || 0);
const parse = f => ({ bookName: String(f.get('bookName') ?? '').trim(), bookDetail: String(f.get('bookDetail') ?? '').trim() || null, studentId: String(f.get('studentId') ?? '').trim() || null,
  teacherName: String(f.get('teacherName') ?? '').trim() || null, price: won(f.get('price')), requestDate: String(f.get('requestDate') ?? '').trim() || null, notes: String(f.get('notes') ?? '').trim() || null });
const explain = (X, error, scope, fallback, op) => X.dbError.explainDbError(error, { scope, fallback, ...(op ? { op } : {}) }).message;
/** RLS 읽기(2.0 사용자 클라이언트 .single()) — 못 읽으면 null. */
const readAs = async (sql, actor, fn) => (await asViewer(sql, actor, fn)).data?.[0] ?? null;

async function resolveStudentName(sql, actor, studentId) {
  if (!studentId) return null;
  const row = await readAs(sql, actor, s => s`select name from public.students where id::text=${studentId}`);
  return row?.name ?? null;
}

async function toggleTextbookCheck({ sql, t, importV2 }, actor, [, formData]) {
  const f = formOf(formData), X = await loadTextbookRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '교재 관리 권한이 없습니다' };
  const id = String(f.get('id') ?? '').trim(), field = String(f.get('field') ?? '').trim(), checked = String(f.get('checked') ?? '') === 'true';
  if (!id) return { error: '교재신청 ID가 누락되었습니다' };
  const col = Object.hasOwn(CHECK_COLS, field) ? CHECK_COLS[field] : null;
  if (!col) return { error: '잘못된 체크 항목입니다' };
  const row = await readAs(sql, actor, s => s`select registered_at, ordered_at, paid_at, ${AUDIT_COLS(s)} from public.textbook_orders where id::text=${id}`);
  if (!row) return { error: '교재신청을 찾을 수 없습니다' };
  const now = new Date().toISOString();
  const next = { registered_at: row.registered_at, ordered_at: row.ordered_at, paid_at: row.paid_at };
  next[col] = checked ? now : null;
  const status = next.paid_at ? 'paid' : next.ordered_at ? 'ordered' : 'requested';
  const patch = { [col]: next[col], status, status_at: now, status_by_name: actor.name, updated_at: now };
  // 등록/납부 해제 = 사람 소유 마커(0079a) — makeedu 자동 체크가 이 신청을 영구 제외(2.0 그대로).
  if (!checked && (col === 'registered_at' || col === 'paid_at')) patch.check_dismissed_at = now;
  const { error } = await asViewer(sql, actor, s => s`update public.textbook_orders set ${s(patch)} where id=${id}`);
  if (error) return { error: explain(X, error, 'billing.textbookOrder.check', '체크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const checkTarget = X.audit.textbookAuditTarget(snapshotOf(row));
  await audit(sql, t, actor, 'textbook_order_check', 'textbook_order',
    { orderId: id, target: checkTarget, field, fieldLabel: X.audit.TEXTBOOK_CHECK_LABEL[field] ?? field, checked, status }, checkTarget);
  return { ok: true };
}

async function createTextbookOrder({ sql, t, importV2 }, actor, [, formData]) {
  const f0 = formOf(formData), X = await loadTextbookRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '교재 관리 권한이 없습니다' };
  const f = parse(f0);
  if (!f.bookName) return { fieldErrors: { bookName: '교재명을 입력해주세요' } };
  const studentName = await resolveStudentName(sql, actor, f.studentId);
  const row = { tenant_id: t, created_by: actor.id, student_id: f.studentId, student_name: studentName, teacher_name: f.teacherName, book_name: f.bookName, book_detail: f.bookDetail,
    price: f.price, status: 'requested', request_date: f.requestDate ?? X.dk.kstToday(), status_at: new Date().toISOString(), status_by_name: actor.name, notes: f.notes };
  const { data, error } = await asViewer(sql, actor, s => s`insert into public.textbook_orders ${s(row)} returning id::text id`);
  if (error) return { error: explain(X, error, 'billing.textbookOrder.create', '교재 주문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const target = X.audit.textbookAuditTarget({ studentName, bookName: f.bookName });
  await audit(sql, t, actor, 'textbook_order_create', 'textbook_order', { orderId: data?.[0]?.id ?? null, target, price: f.price, surface: 'billing' }, target);
  return { ok: true, createdId: data?.[0]?.id ?? undefined };
}

async function updateTextbookOrder({ sql, t, importV2 }, actor, [, formData]) {
  const f0 = formOf(formData), X = await loadTextbookRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '교재 관리 권한이 없습니다' };
  const id = String(f0.get('id') ?? '').trim();
  if (!id) return { error: '교재신청 ID가 누락되었습니다' };
  const f = parse(f0);
  if (!f.bookName) return { fieldErrors: { bookName: '교재명을 입력해주세요' } };
  const studentName = await resolveStudentName(sql, actor, f.studentId);
  const before = snapshotOf(await readAs(sql, actor, s => s`select ${AUDIT_COLS(s)} from public.textbook_orders where id::text=${id}`));
  const { error } = await asViewer(sql, actor, s => s`update public.textbook_orders set ${s({ student_id: f.studentId, student_name: studentName, teacher_name: f.teacherName,
    book_name: f.bookName, book_detail: f.bookDetail, price: f.price, request_date: f.requestDate, notes: f.notes, updated_at: new Date().toISOString() })} where id::text=${id}`);
  if (error) return { error: explain(X, error, 'billing.textbookOrder.update', '교재 주문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  const changes = X.audit.diffTextbookOrder(before, { studentName, teacherName: f.teacherName, bookName: f.bookName, bookDetail: f.bookDetail, price: f.price, requestDate: f.requestDate, notes: f.notes });
  if (changes.length > 0) {
    const target = X.audit.textbookAuditTarget({ studentName, bookName: f.bookName });
    await audit(sql, t, actor, 'textbook_order_update', 'textbook_order', { orderId: id, target, changes, surface: 'billing' }, target);
  }
  return { ok: true };
}

async function deleteTextbookOrder({ sql, t, importV2 }, actor, [, formData]) {
  const f = formOf(formData), X = await loadTextbookRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '교재 관리 권한이 없습니다' };
  const id = String(f.get('id') ?? '').trim();
  if (!id) return { error: '교재신청 ID가 누락되었습니다' };
  const beforeRow = await readAs(sql, actor, s => s`select ${AUDIT_COLS(s)} from public.textbook_orders where id::text=${id}`);
  // RLS에 막힌 행은 에러 없이 0행 — 지운 행 수로 판정(2.0 그대로).
  const { data: gone, error } = await asViewer(sql, actor, s => s`delete from public.textbook_orders where id::text=${id}
    returning id::text id, student_id::text student_id, book_name, request_date::text request_date, classnote_notice_id::text classnote_notice_id`);
  if (error) return { error: explain(X, error, 'billing.textbookOrder.delete', '교재 주문을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (!gone?.length) return { error: DELETE_BLOCKED_MSG };
  // textbook-notice-handover.ts — 발송 연결은 같은 학생·교재·요청일의 남은(연결 없는) 행 중 가장 먼저 만든 것으로(admin · tenant 필터).
  const d = gone[0];
  let noticeMovedTo = null;
  if (d.classnote_notice_id && d.student_id && d.book_name && d.request_date) {
    const [heir] = await sql`select id::text id from public.textbook_orders where tenant_id=${t} and student_id=${d.student_id} and book_name=${d.book_name}
      and request_date=${d.request_date}::date and classnote_notice_id is null order by created_at asc limit 1`;
    if (heir) {
      const moved = await sql`update public.textbook_orders set classnote_notice_id=${d.classnote_notice_id} where id=${heir.id} and tenant_id=${t} and classnote_notice_id is null returning id`;
      if (moved.length) noticeMovedTo = heir.id;
    }
  }
  const before = snapshotOf(beforeRow), deletedTarget = X.audit.textbookAuditTarget(before);
  await audit(sql, t, actor, 'textbook_order_delete', 'textbook_order', { orderId: id, target: deletedTarget, price: Number(before.price ?? 0), surface: 'billing',
    noticeId: d.classnote_notice_id ?? null, noticeMovedTo }, deletedTarget);
  return { ok: true };
}

/** 2.0 saveMyTextbookMent(text) — 본인 행만 · 2000자 · 빈 글은 null(중간저장이라 실패해도 조용히 ok:false). */
async function saveMyTextbookMent({ sql, t }, actor, [text]) {
  if (!actor) return { ok: false };
  const value = String(text ?? '').trim().slice(0, 2000) || null;
  try { await sql.savepoint(s => s`update public.users set textbook_notice_ment=${value} where id=${actor.id} and tenant_id=${t}`); return { ok: true }; } catch { return { ok: false }; }
}

const ACTIONS_MODULE = 'features/billing/server/textbook-actions.ts', NOTICE_MODULE = 'features/billing/server/textbook-notice-actions.ts';
const formArgs = args => formOf(args[1]);
export const textbookFaceActions = {
  toggleTextbookCheck: billingAction(ACTIONS_MODULE, 2, toggleTextbookCheck, formArgs),
  createTextbookOrder: billingAction(ACTIONS_MODULE, 2, createTextbookOrder, formArgs),
  updateTextbookOrder: billingAction(ACTIONS_MODULE, 2, updateTextbookOrder, formArgs),
  deleteTextbookOrder: billingAction(ACTIONS_MODULE, 2, deleteTextbookOrder, formArgs),
  saveMyTextbookMent: billingAction(NOTICE_MODULE, 1, saveMyTextbookMent, args => { if (typeof args[0] !== 'string' || args[0].length > 5000) throw badRequest(); }),
};
