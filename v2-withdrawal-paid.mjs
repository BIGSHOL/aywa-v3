/** 퇴원·과목 수강종료 기간 판정에 쓰는 납부 청구. 2.0 loadPaidTuition과 같은 지점·상태·금액 조건이다. */
export async function paidTuition(sql, tenantId, studentIds, lastDate) {
  if (!studentIds.length || !lastDate) return new Map();
  const rows = await sql`select student_id::text student_id, period::text period, status::text status, category::text category, amount_paid, line_items
    from public.invoices where tenant_id=${tenantId} and student_id = any(${studentIds}::uuid[]) and category::text='tuition'
      and status::text not in ('void','refunded') and amount_paid > 0 and period <= ${lastDate.slice(0, 7)} order by id`;
  const byStudent = new Map();
  for (const row of rows) byStudent.set(row.student_id, [...(byStudent.get(row.student_id) ?? []), row]);
  return byStudent;
}
