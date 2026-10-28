// 2.0 화면 — 수납관리 · 환불 요청서(refunds-face.tsx · refunds/new · refunds/[id])의 조회와 저장을 Docker 복사본에서 같은 결과로.
//  · 조회 = features/billing/server/refund-queries.ts getRefundRequests · getRefundRequestById · getRefundStudentOptions · getRefundPrefillSource
//  · 저장 = refund-actions.ts saveRefundRequest · deleteRefundRequest · 읽기 둘(loadRefundStudentOptions · loadRefundPrefill)은 화면 GET으로
// 🔴 환불 요청서는 restricted 문서다(계좌·환불금액 · 0072a restrictive RLS = 사무실 역할만). 그래서 **모든 읽기·쓰기를 보는 사람의 신분 +
//    authenticated 역할(asViewer)로** 한다 — 2.0 사용자 클라이언트와 같은 정책이 막는다(복사본 관리자 접속으로 읽지 않는다).
//    자동입력의 주소도 고른 한 명만(2.0 그대로). 감사로그에 계좌·주소는 넣지 않는다(2.0 refundAuditFields 원문 실행). 시험 출력에 서식 값을 찍지 않는다.
import { pureFrom } from './v2-billing-pure.mjs';
import { audit, formOf, asViewer, billingAction, canWriteBilling, badRequest, UUID_RE } from './v2-billing-common.mjs';

const QUERIES = 'features/billing/server/refund-queries.ts', ACTIONS = 'features/billing/server/refund-actions.ts';
let rulesPromise = null;
export function loadRefundRules(importV2) {
  rulesPromise ??= (async () => {
    const [req, pre, lines, sg, st] = await Promise.all(['features/billing/refund-request.ts', 'features/billing/refund-prefill.ts', 'features/billing/invoice-line-items.ts',
      'lib/format/school-grade.ts', 'features/students/status/status-labels.ts'].map(p => importV2(p)));
    const q = await pureFrom(QUERIES, ['authorNameOf', 'toPrefillLines'], { receiptHistoryLines: lines.receiptHistoryLines });
    const a = await pureFrom(ACTIONS, ['stampCompletion', 'refundAuditFields'], { refundTitle: req.refundTitle });
    return { req, pre, sg, st, q, a };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const DOC_COLS = sql => sql`d.id::text id, d.form_data, to_json(d.created_at)#>>'{}' created_at, to_json(d.updated_at)#>>'{}' updated_at, u.display_name`;
/** RLS 아래 읽기 — 못 읽으면(정책 · 오류) 2.0 `data ?? []`처럼 빈 목록. */
const rows = async (sql, actor, fn) => (actor ? (await asViewer(sql, actor, fn)).data ?? [] : []);

/** 2.0 getRefundRequests — 환불 요청서 전건(작성 최신순). */
export async function readRefundRequests(sql, actor, X) {
  const list = await rows(sql, actor, s => s`select ${DOC_COLS(s)} from public.academy_documents d left join public.users u on u.id = d.uploaded_by
    where d.form_type = ${X.req.REFUND_FORM_TYPE} order by d.created_at desc`);
  return list.map(r => {
    const d = X.req.normalizeRefund(r.form_data);
    return { id: r.id, name: d.student.name || '(이름 미입력)', className: d.student.className, requestDate: d.student.requestDate, completedDate: d.result.completedDate,
      totalAmount: d.refund.totalAmount, createdAt: r.created_at, updatedAt: r.updated_at, authorName: X.q.authorNameOf(r.display_name == null ? null : { display_name: r.display_name }) };
  });
}
/** 2.0 getRefundRequestById(id) — 없으면 null(→ notFound). */
export async function readRefundById(sql, actor, X, id) {
  if (!UUID_RE.test(id)) return null;
  const [r] = await rows(sql, actor, s => s`select ${DOC_COLS(s)} from public.academy_documents d left join public.users u on u.id = d.uploaded_by
    where d.id = ${id} and d.form_type = ${X.req.REFUND_FORM_TYPE}`);
  return r ? { id: r.id, data: X.req.normalizeRefund(r.form_data), createdAt: r.created_at, updatedAt: r.updated_at,
    authorName: X.q.authorNameOf(r.display_name == null ? null : { display_name: r.display_name }) } : null;
}

/** 2.0 loadRefundStudentOptions() — 수납 쓰기 게이트 · 퇴원생 포함 전원 이름순(학교학년 · 상태는 한글 라벨). */
export async function loadRefundStudentOptions(sql, actor, X) {
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납관리 권한이 없습니다' };
  const list = await rows(sql, actor, s => s`select id::text id, name, school, grade, status::text status from public.students order by name asc, id asc`);
  return { options: list.map(s => ({ id: s.id, name: s.name, schoolGrade: X.sg.schoolGradeLabel(s.school, s.grade), statusLabel: X.st.studentStatusLabel(s.status) })) };
}

/** 2.0 loadRefundPrefill(studentId, months) — 고른 한 명의 기본정보 · 수강 이력(시작일 최신순) · 청구/납부(오래된 달부터) → buildRefundPrefill. */
export async function loadRefundPrefill(sql, actor, X, studentId, months) {
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납관리 권한이 없습니다' };
  const safeMonths = X.pre.PAYMENT_MONTH_CHOICES.includes(months) ? months : X.pre.DEFAULT_PAYMENT_MONTHS;
  if (!UUID_RE.test(String(studentId ?? ''))) return { error: '학생 정보를 찾지 못했습니다' };
  const [[student], enrollments, invoices] = await Promise.all([
    rows(sql, actor, s => s`select name, school, grade, address from public.students where id=${studentId}`),
    rows(sql, actor, s => s`select c.class_name, t.display_name teacher_name, e.start_date::text start_date, e.end_date::text end_date from public.enrollments e
      left join public.classes c on c.id = e.class_id left join public.users t on t.id = c.teacher_id where e.student_id=${studentId} order by e.start_date desc, e.id`),
    rows(sql, actor, s => s`select period, status, amount_total, amount_paid, amount_discount, payment_method, to_json(paid_at)#>>'{}' paid_at, line_items
      from public.invoices where student_id=${studentId} order by period asc, id`),
  ]);
  if (!student) return { error: '학생 정보를 찾지 못했습니다' };
  const src = { name: student.name, school: student.school, grade: student.grade, address: student.address,
    enrollments: enrollments.map(e => ({ className: e.class_name ?? '?', teacherName: e.teacher_name ?? null, startDate: e.start_date, endDate: e.end_date })),
    invoices: invoices.map(i => ({ period: i.period, status: i.status, amountTotal: Number(i.amount_total), amountPaid: Number(i.amount_paid), amountDiscount: Number(i.amount_discount),
      paymentMethod: i.payment_method, paidAt: i.paid_at, lineItems: X.q.toPrefillLines(i.line_items) })) };
  return { values: X.pre.buildRefundPrefill(src, { months: safeMonths }) };
}

// ── 저장 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function saveRefundRequest({ sql, t, importV2 }, actor, [, formData]) {
  const fd = formOf(formData), X = await loadRefundRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납관리 권한이 없습니다' };
  const parsed = X.req.parseRefundForm(fd);
  if (!parsed.student.name) return { error: '학생 이름을 입력하세요' };
  const user = { id: actor.id, displayName: actor.name };
  const id = String(fd.get('id') ?? '').trim();
  if (id) {
    const existing = UUID_RE.test(id) ? (await rows(sql, actor, s => s`select form_data from public.academy_documents where id=${id} and form_type=${X.req.REFUND_FORM_TYPE}`))[0] : null;
    const prev = existing ? X.req.normalizeRefund(existing.form_data) : null;
    const data = X.a.stampCompletion(parsed, prev, user);
    const { error } = await asViewer(sql, actor, s => s`update public.academy_documents set ${s({ title: X.req.refundTitle(data), form_data: s.json(data), updated_at: new Date().toISOString() })}
      where id::text=${id} and form_type=${X.req.REFUND_FORM_TYPE}`);
    if (error) return { error: `저장 실패: ${error.message}` };
    const f = X.a.refundAuditFields(id, data, prev);
    await audit(sql, t, actor, 'refund_request_update', f.targetType, f.metadata, f.targetLabel);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/billing/refunds/${id}` };
  }
  const data = X.a.stampCompletion(parsed, null, user);
  const { data: made, error } = await asViewer(sql, actor, s => s`insert into public.academy_documents ${s({ tenant_id: t, title: X.req.refundTitle(data), category: 'billing', kind: 'form',
    form_type: X.req.REFUND_FORM_TYPE, form_data: s.json(data), restricted: true, description: '환불처리요청서 (웹 작성)', uploaded_by: actor.id })} returning id::text id`);
  const row = made?.[0];
  if (error || !row) return { error: `저장 실패: ${error?.message ?? 'unknown'}` };
  const f = X.a.refundAuditFields(row.id, data, null);
  await audit(sql, t, actor, 'refund_request_create', f.targetType, f.metadata, f.targetLabel);
  return { ok: true, id: row.id, nonce: Date.now(), redirectTo: `/billing/refunds/${row.id}` };
}

async function deleteRefundRequest({ sql, t, importV2 }, actor, [id]) {
  const X = await loadRefundRules(importV2);
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!canWriteBilling(actor)) return { error: '수납관리 권한이 없습니다' };
  const [before] = UUID_RE.test(id) ? await rows(sql, actor, s => s`select title, form_data from public.academy_documents where id=${id} and form_type=${X.req.REFUND_FORM_TYPE}`) : [];
  const { data: gone, error } = await asViewer(sql, actor, s => s`delete from public.academy_documents where id::text=${id} and form_type=${X.req.REFUND_FORM_TYPE} returning id`);
  if (error) return { error: `삭제 실패: ${error.message}` };
  if (gone?.length) {
    const d = before ? X.req.normalizeRefund(before.form_data) : null;
    await audit(sql, t, actor, 'refund_request_delete', 'refund_request', { documentId: id, studentName: d?.student.name || null, totalAmount: d?.refund.totalAmount || null,
      completedDate: d?.result.completedDate || null }, before?.title ?? null);
  }
  return { ok: true };
}

export const refundActions = {
  saveRefundRequest: billingAction(ACTIONS, 2, saveRefundRequest, args => formOf(args[1])),
  deleteRefundRequest: billingAction(ACTIONS, 1, deleteRefundRequest, args => { if (typeof args[0] !== 'string' || args[0].length > 64) throw badRequest(); }),
};
