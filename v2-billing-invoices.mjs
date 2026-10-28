// 2.0 화면 — 수납관리 · 수납 면의 조회(features/billing/server/queries.ts · textbook-queries.ts getStudentOptions)를 Docker 복사본에서 같은 결과로.
// 이 모듈은 2.0 서버 함수의 반환 모양 그대로 돌려준다 — 그리기·필터·합계는 2.0 billing-content.tsx 본문(호스트)과 2.0 calc.ts가 한다.

/** 2.0 InvoiceRow 정렬 — getInvoicesForPeriod의 정렬 본문 그대로(이름은 한국어 순 · 상태는 미납 → 부분 → 완납 → 환불 → 무효, 같으면 청구액 큰 순). */
function sortInvoices(rows, sort, desc) {
  const dir = desc ? -1 : 1;
  rows.sort((a, b) => {
    switch (sort) {
      case 'name': return a.studentName.localeCompare(b.studentName, 'ko') * dir;
      case 'amount_total': return (a.amountTotal - b.amountTotal) * dir;
      case 'amount_paid': return (a.amountPaid - b.amountPaid) * dir;
      case 'amount_discount': return (a.amountDiscount - b.amountDiscount) * dir;
      case 'due_date': return ((a.dueDate ?? '').localeCompare(b.dueDate ?? '')) * dir;
      case 'status':
      default: {
        const order = ['unpaid', 'partial', 'paid', 'refunded', 'void'];
        const ai = order.indexOf(a.status), bi = order.indexOf(b.status);
        if (ai !== bi) return (ai - bi) * dir;
        return b.amountTotal - a.amountTotal;
      }
    }
  });
  return rows;
}

/**
 * 2.0 getInvoicesForPeriod({ period, sort, desc }) — 그 달 청구서 전부(무효 제외 · fetchAllPaged와 같은 id 순) → InvoiceRow.
 * 시각 칸은 PostgREST가 내던 글자(to_json) 그대로 · 날짜 칸은 'YYYY-MM-DD'. 검색(q)은 2.0도 이 함수에 넘기지 않는다(본문이 거른다).
 */
export async function readInvoicesForPeriod(sql, t, R, { period, sort = 'status', desc = false }) {
  const rows = await sql`select i.id::text id, i.period, i.category, i.amount_total, i.amount_paid, i.amount_discount, i.status, i.due_date::text due_date,
      to_json(i.paid_at)#>>'{}' paid_at, i.notes, i.line_items, i.payment_method, i.card_company, i.cash_receipt_number, i.points_used, i.discount_reason,
      i.billed_at::text billed_at, to_json(i.sync_added_at)#>>'{}' sync_added_at, to_json(i.updated_at)#>>'{}' updated_at,
      s.id::text student_id, s.name student_name, s.grade student_grade
    from public.invoices i left join public.students s on s.id = i.student_id and s.tenant_id = i.tenant_id
    where i.tenant_id=${t} and i.period=${period} and i.status <> 'void' order by i.id asc`;
  return sortInvoices(rows.map(r => ({
    id: r.id, studentId: r.student_id ?? '', studentName: r.student_name ?? '?', studentGrade: r.student_grade ?? null,
    period: r.period, category: r.category ?? 'tuition',
    amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount ?? 0),
    status: r.status, dueDate: r.due_date, paidAt: r.paid_at, notes: r.notes ?? null,
    lineItems: R.lineItems.normalizeInvoiceLineItems(r.line_items),
    paymentMethod: r.payment_method ?? null, cardCompany: r.card_company ?? null, cashReceiptNumber: r.cash_receipt_number ?? null,
    pointsUsed: Number(r.points_used ?? 0), discountReason: r.discount_reason ?? null, billedAt: r.billed_at ?? null,
    syncAddedAt: r.sync_added_at ?? null, updatedAt: r.updated_at ?? null,
  })), sort, desc);
}

/** 2.0 getAvailablePeriods — 0163a invoice_periods(청구월 distinct · 최신순, 무효 포함) + 이번 달이 없으면 맨 앞에. */
export async function readAvailablePeriods(sql, t, R) {
  const rows = await sql`select period from public.invoices where tenant_id=${t} group by period order by period desc`;
  const set = new Set(rows.map(r => r.period)), arr = [...set].sort((a, b) => b.localeCompare(a)), now = R.calc.currentPeriod();
  if (!set.has(now)) arr.unshift(now);
  return arr;
}

/** 2.0 getStudentOptions — 퇴원 아닌 학생 이름순(같으면 id 순). */
export async function readStudentOptions(sql, t) {
  const rows = await sql`select id::text id, name, grade from public.students where tenant_id=${t} and status::text <> 'withdrawn' order by name asc, id asc`;
  return rows.map(s => ({ id: s.id, name: s.name, grade: s.grade }));
}
