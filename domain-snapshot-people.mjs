// 직원·수납 영역 — 직원관리·급여·수납관리·교재 요청·지출결의서. 급여 금액·계약 조건·계좌는 싣지 않는다.
import { PRIORITY, family, field, latest, metric, monthlyTrend, record, signal, yymm } from './domain-snapshot-core.mjs';

// src/lib/auth/role-hierarchy.ts ROLE_LABEL과 같은 표.
export const ROLE_LABEL = { master: '원장', admin: '관리자', manager: '매니저', accountant: '회계', counselor: '상담사', teacher: '강사', viewer: '참관', student: '원생' };
// 2.0 청구 상태 원문(src/features/billing/status-color.ts).
const INVOICE = { paid: '납부완료', partial: '부분납부', unpaid: '미납', void: '무효', refunded: '환불' };
const BOOK = { requested: '요청', ordered: '주문', delivered: '전달', billed: '청구', paid: '납부 완료' };
const pre = (p, labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [`${p}:${k}`, v]));
const won = n => `${new Intl.NumberFormat('ko-KR').format(Math.round(n))}원`;

export async function peopleFamilies({ sql, t, asOf, month, monthStart }) {
  const out = {};
  // 직원관리 — 2.0 getStaffList와 같은 모집단: 지점 사용자 중 원생 계정 제외, 퇴사자 포함(기본 보기 = 재직).
  // 운영 지원 계정(super_admins)은 2.0 직원 목록처럼 '관리자'로 표시만 바꾼다(displayRoleFor) — 권한·집계 대상은 그대로.
  const users = await sql`select u.id, u.display_name, case when exists (select 1 from public.super_admins sa where sa.id=u.id) then 'admin' else u.system_role::text end role, u.status::text st, u.job_title, u.employment_type, u.hire_date::text hired from public.users u where u.tenant_id=${t} and u.system_role::text <> 'student' order by (u.status='active') desc, u.display_name`;
  const [sf] = await sql`select (select count(*)::int from public.staff_contracts c join public.users u on u.id=c.user_id and u.tenant_id=${t} where c.tenant_id=${t} and c.kind='contract' and u.status='active' and (c.start_date is null or c.start_date <= ${asOf}) and (c.end_date is null or c.end_date >= ${asOf})) contracts, (select count(*)::int from public.staff_contracts where tenant_id=${t}) contracts_all, (select count(*)::int from public.staff_attendance_days where tenant_id=${t} and work_date between ${monthStart} and ${asOf}) work_days, (select count(*)::int from public.staff_attendance_days where tenant_id=${t} and work_date between ${monthStart} and ${asOf} and coalesce(late_minutes,0) > 0) late_days, (select count(*)::int from public.staff_attendance_days where tenant_id=${t}) attendance_all, (select count(*)::int from public.leave_forms where tenant_id=${t}) leaves, (select count(*)::int from public.leave_forms where tenant_id=${t} and end_date >= ${asOf}) upcoming_leaves`;
  const active = users.filter(u => u.st === 'active');
  out.staff = family('staff', '직원관리(명부·계약·이력서·휴가·연차)', {
    summary: `이번 달 지각 기록 ${sf.late_days}건 · 아직 끝나지 않은 휴가 ${sf.upcoming_leaves}건.`,
    metrics: [metric('전체 명부', users.length, '명', '퇴사자 포함 · 원생 계정 제외'), metric('현재 재직', active.length, '명'), metric('유효한 계약', sf.contracts, '건', '재직 직원 기준'), metric('이번 달 출근 기록', sf.work_days, '건', '메이크에듀 출퇴근 기록'), metric('이번 달 지각 기록', sf.late_days, '건'), metric('전체 휴가 신청', sf.leaves, '건', `아직 끝나지 않은 휴가 ${sf.upcoming_leaves}건`)],
    trend: monthlyTrend('월별 직원 출근 기록', '건', await sql`select to_char(work_date,'YYYY-MM') as month, count(*)::int as value from public.staff_attendance_days where tenant_id=${t} and work_date <= ${asOf} group by 1`, asOf),
    evidence: users.map(u => record({ id: u.id, label: u.display_name, detail: u.job_title || '', date: u.hired, status: u.st === 'active' ? '재직' : '퇴사', fields: [field('역할', ROLE_LABEL[u.role] || '기타'), field('고용 형태', u.employment_type)], facets: [`status:${u.st}`, `role:${u.role}`, u.employment_type && `type:${u.employment_type}`] })),
    facetLabels: { 'status:active': '재직', 'status:inactive': '퇴사', ...pre('role', ROLE_LABEL), ...Object.fromEntries([...new Set(users.map(u => u.employment_type).filter(Boolean))].map(k => [`type:${k}`, k])) }, recordSource: 'users',
    sourceLabel: '직원 명부 · 계약 · 출퇴근 · 휴가', coverageNote: '목록은 직원 명부입니다(재직 먼저).',
    sources: [{ table: 'users', rows: users.length }, { table: 'staff_contracts', rows: sf.contracts_all }, { table: 'staff_attendance_days', rows: sf.attendance_all }, { table: 'leave_forms', rows: sf.leaves }],
  });

  // 급여 — 명세서 상태만. 금액은 원장 화면에서도 명세서 단위로만 열고, 여기엔 싣지 않는다.
  const slips = await sql`select p.id, u.display_name, p.period, p.status, to_char(p.issued_at at time zone 'Asia/Seoul','YYYY-MM-DD') issued from public.payslips p join public.users u on u.id=p.user_id and u.tenant_id=${t} where p.tenant_id=${t} order by p.period desc, u.display_name`;
  const [pr] = await sql`select (select count(*)::int from public.payroll_records where tenant_id=${t}) records, (select count(*)::int from public.salary_tiers where tenant_id=${t}) tiers`;
  out.payroll = family('payroll', '급여·명세서·강사 정산', {
    summary: slips[0]?.period ? `가장 최근 명세서 ${yymm(slips[0].period)}.` : '급여명세서가 없습니다.',
    metrics: [metric('급여명세서', slips.length, '건', '전체 기간'), metric('발급된 명세서', slips.filter(s => s.status === 'issued').length, '건'), metric('작성 중 명세서', slips.filter(s => s.status === 'draft').length, '건'), metric('급여 단가 구간', pr.tiers, '개'), metric('급여 지급 기록', pr.records, '건', '명세서 발급과 별개인 송금 기록')],
    evidence: slips.map(s => record({ id: s.id, label: s.display_name, detail: yymm(s.period), date: s.issued, status: s.status === 'issued' ? '발급 완료' : '작성 중', fields: [], facets: [`status:${s.status}`, `period:${s.period}`] })),
    facetLabels: { 'status:issued': '발급 완료', 'status:draft': '작성 중', ...Object.fromEntries([...new Set(slips.map(s => s.period))].map(p => [`period:${p}`, yymm(p)])) }, recordSource: 'payslips', detailLabel: '급여월', dateLabel: '발급일',
    sourceLabel: '급여명세서 · 단가 구간', coverageNote: '목록은 급여명세서입니다(최근 기간 순). 금액은 표시하지 않습니다.',
    sources: [{ table: 'payslips', rows: slips.length }, { table: 'payroll_records', rows: pr.records }, { table: 'salary_tiers', rows: pr.tiers }],
  });

  // 수납관리 — snapshot.mjs와 같은 계산: 청구액 = 할인 전 − 할인, 잔액 = 청구액 − 수납, 무효·환불 제외.
  const invoices = await sql`select i.id, s.name, i.period, i.status::text st, i.amount_total::float8 gross, coalesce(i.amount_discount,0)::float8 discount, coalesce(i.amount_paid,0)::float8 paid, i.due_date::text due, to_char(i.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') created from public.invoices i join public.students s on s.id=i.student_id and s.tenant_id=${t} where i.tenant_id=${t} and not coalesce(s.is_test,false) order by i.period desc, s.name`;
  const bills = invoices.map(i => { const valid = !['void', 'refunded'].includes(i.st), total = Math.max(0, i.gross - i.discount); return { ...i, valid, total, remaining: valid ? Math.max(0, total - i.paid) : 0 }; });
  const now = bills.filter(b => b.valid && b.period === month), open = now.filter(b => b.remaining > 0), sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
  // 미수납 신호의 발생 시각 = 남은 금액이 기한을 넘긴 날(기준일까지 온 납부 기한 중 가장 늦은 날) · 기한이 아직 안 왔으면 청구를 만든 날.
  const [bx] = await sql`select (select count(*)::int from public.academy_documents where tenant_id=${t} and form_type='refund_request') refund_docs, (select count(*)::int from public.invoice_session_terms st join public.invoices i on i.id=st.invoice_id and i.tenant_id=${t} where st.tenant_id=${t} and i.period=${month}) terms, (select count(*)::int from public.invoice_session_terms st join public.invoices i on i.id=st.invoice_id and i.tenant_id=${t} where st.tenant_id=${t} and i.period=${month} and st.confirmed_at is not null) confirmed, (select count(*)::int from public.tuition_quotes where tenant_id=${t}) quotes, (select coalesce(round(sum(amount)),0)::float8 from public.expenses where tenant_id=${t} and expense_date between ${monthStart} and ${asOf} and coalesce(currency,'KRW')='KRW') expenses, (select count(*)::int from public.expenses where tenant_id=${t} and expense_date between ${monthStart} and ${asOf} and coalesce(currency,'KRW')<>'KRW') foreign_expenses, (select count(*)::int from public.expenses where tenant_id=${t}) expenses_all, (select count(*)::int from public.invoice_session_terms where tenant_id=${t}) terms_all`;
  out.billing = family('billing', '수납관리(청구·교재·지출·계산기·회차 확정·환불·정산)', {
    summary: `이번 달 남은 금액 ${won(sum(now, 'remaining'))}(${open.length}건) · 이번 달 청구 ${now.length}건.`,
    metrics: [metric('이번 달 할인 전 금액', sum(now, 'gross'), '원'), metric('이번 달 할인', sum(now, 'discount'), '원', '미납으로 세지 않음'), metric('이번 달 청구액', sum(now, 'total'), '원', '할인 전 − 할인 · 무효·환불 제외'), metric('이번 달 수납', sum(now, 'paid'), '원', '기준일까지 누적'), metric('이번 달 남은 금액', sum(now, 'remaining'), '원', `${open.length}건`), metric('환불 처리된 청구', bills.filter(b => b.st === 'refunded').length, '건', `전체 기간 · 환불요청서 ${bx.refund_docs}건`), metric('이번 달 회차 확정', bx.confirmed, '건', `회차 줄 ${bx.terms}건 중`), metric('이번 달 지출', bx.expenses, '원', bx.foreign_expenses ? `원화만 · 외화 ${bx.foreign_expenses}건 별도` : '원화'), metric('저장된 수강료 견적', bx.quotes, '건')],
    trend: monthlyTrend('월별 청구액', '원', Object.entries(Object.groupBy(bills.filter(b => b.valid && b.period <= month), b => b.period)).map(([m, rows]) => ({ month: m, value: sum(rows, 'total') })), asOf),
    evidence: bills.map(b => record({ id: b.id, label: b.name, detail: b.period, date: b.due, status: INVOICE[b.st] || '기타', fields: [field('청구액', won(b.total)), field('수납', won(b.paid)), field('남은 금액', b.valid ? won(b.remaining) : null)], facets: [`status:${b.st}`, b.remaining > 0 && 'remaining', b.valid && b.period === month && 'this-month', open.includes(b) && 'this-month-remaining'] })),
    summaryRecords: [...bills.filter(b => b.period === month && b.remaining > 0), ...bills.filter(b => !(b.period === month && b.remaining > 0))].map(b => record({ id: b.id, label: b.name, detail: b.period, date: b.due, status: INVOICE[b.st] || '기타', fields: [field('청구액', won(b.total)), field('남은 금액', b.valid ? won(b.remaining) : null)], facets: [`status:${b.st}`] })),
    facetOrder: ['this-month', 'this-month-remaining', 'remaining', ...Object.keys(INVOICE).map(k => `status:${k}`)], facetLabels: { 'this-month': '이번 달 청구(무효·환불 제외)', 'this-month-remaining': '이번 달 청구 중 남은 금액 있음', remaining: '남은 금액 있음(모든 청구월)', ...pre('status', INVOICE) }, recordSource: 'invoices', detailLabel: '청구월', dateLabel: '납부 기한',
    signals: open.length ? [signal({ id: 'billing-remaining', title: `${yymm(month)} 청구 미수납 ${open.length}건 · ${won(sum(open, 'remaining'))}`, summary: `큰 금액 순: ${[...open].sort((a, b) => b.remaining - a.remaining).slice(0, 3).map(b => `${b.name} ${won(b.remaining)}`).join(' · ')}${open.length > 3 ? ` 외 ${open.length - 3}건` : ''}. 할인 반영 · 무효·환불 제외.`, priority: PRIORITY.check, source: '수납관리 · 청구·할인·수납 기록', recordIds: open.map(b => b.id), facet: 'this-month-remaining', at: latest(open.map(b => b.due).filter(d => d && d <= asOf)) || latest(open.map(b => b.created)), draft: { title: '수납 잔액 확인 및 후속 안내', body: '남은 금액이 있는 청구의 납부 내역을 먼저 대조하고, 안내가 필요한 경우 보호자에게 연락한 뒤 결과를 남겨 주세요.' } })] : [],
    sourceLabel: '청구·할인·수납 · 회차 확정 · 지출 · 견적', coverageNote: '목록은 모든 달의 청구입니다(무효·환불 포함). 수납액은 입금일이 아니라 청구월로 묶은 누적입니다.',
    sources: [{ table: 'invoices', rows: invoices.length }, { table: 'invoice_session_terms', rows: bx.terms_all }, { table: 'expenses', rows: bx.expenses_all }, { table: 'tuition_quotes', rows: bx.quotes }],
  });

  // 교재 요청 — 강사가 낸 교재 요청(대리 작성 포함, 소유자 = teacher_name).
  const orders = await sql`select o.id, o.book_name, coalesce(s.name, o.student_name) student, o.teacher_name, o.price::float8 price, o.status, o.request_date::text d, to_char(o.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') created from public.textbook_orders o left join public.students s on s.id=o.student_id and s.tenant_id=${t} where o.tenant_id=${t} and (o.student_id is null or not coalesce(s.is_test,false)) order by (o.status='requested') desc, o.request_date desc nulls last`;
  const [cat] = await sql`select count(*)::int c from public.textbook_catalog where tenant_id=${t}`;
  const waiting = orders.filter(o => ['requested', 'ordered'].includes(o.status));
  // 이름 칸 = 원생, 내용 = 교재('요청 선생님'과 같은 값을 내용에 다시 적지 않는다) · 신호 발생 시각 = 가장 늦은 요청일(없으면 만든 날).
  out['textbook-requests'] = family('textbook-requests', '교재 요청(강사)', {
    summary: `전체 교재 요청 ${orders.length}건.`,
    metrics: [metric('요청·주문 단계', waiting.length, '건', '전달 기한이 없어 지연 판정은 하지 않음'), metric('요청·주문 단계 금액', sum(waiting, 'price'), '원'), metric('이번 달 교재 요청', orders.filter(o => o.d >= monthStart && o.d <= asOf).length, '건'), metric('교재 단가표', cat.c, '항목')],
    trend: monthlyTrend('월별 교재 요청', '건', Object.entries(Object.groupBy(orders.filter(o => o.d && o.d <= asOf), o => o.d.slice(0, 7))).map(([m, rows]) => ({ month: m, value: rows.length })), asOf),
    evidence: orders.map(o => record({ id: o.id, label: o.student || o.book_name, detail: o.student ? o.book_name : '', date: o.d, status: BOOK[o.status] || '기타', fields: [field('요청 선생님', o.teacher_name), field('가격', o.price ? won(o.price) : null)], facets: [`status:${o.status}`, waiting.includes(o) && 'waiting'] })),
    facetLabels: { ...pre('status', BOOK), waiting: '요청·주문 단계' }, recordSource: 'textbook_orders', detailLabel: '교재', dateLabel: '요청일',
    signals: waiting.length ? [signal({ id: 'textbook-waiting', title: `요청·주문 단계 교재 ${waiting.length}건 · ${won(sum(waiting, 'price'))}`, summary: `요청 선생님: ${Object.entries(Object.groupBy(waiting, o => o.teacher_name || '선생님 모름')).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(' · ')}. 전달 기한이 없어 늦었는지는 판단하지 않습니다.`, priority: PRIORITY.progress, source: '교재 요청 · 주문·전달 상태', recordIds: waiting.map(o => o.id), facet: 'waiting', at: latest(waiting.map(o => (o.d && o.d <= asOf ? o.d : o.created))), draft: { title: '교재 주문 및 전달 확인', body: '요청·주문 단계인 교재의 주문 내역과 전달 여부를 확인하고, 미전달 사유가 있으면 알려 주세요.' } })] : [],
    sourceLabel: '교재 요청 · 교재 단가표', coverageNote: '목록은 교재 요청 전체입니다(요청 단계 먼저).',
    sources: [{ table: 'textbook_orders', rows: orders.length }, { table: 'textbook_catalog', rows: cat.c }],
  });

  // 지출결의서 — 강사가 직접 작성한 결의서(작성자 역할 = 강사). 사무실 지출은 수납관리 지출 면.
  const requests = await sql`select e.id, e.title, e.category, e.amount::float8 amount, coalesce(e.currency,'KRW') currency, e.expense_date::text d, e.approval_status, u.display_name author from public.expenses e join public.users u on u.id=e.created_by and u.tenant_id=${t} where e.tenant_id=${t} and u.system_role='teacher' order by e.expense_date desc`;
  out['expense-requests'] = family('expense-requests', '지출결의서(강사 제출)', {
    summary: requests.length ? '선생님이 직접 쓴 지출결의서입니다. 사무실 지출은 수납관리 지출에 있습니다.' : '선생님이 직접 쓴 지출결의서가 없습니다.',
    metrics: [metric('선생님 지출결의서', requests.length, '건', '전체 기간'), metric('원화 금액 합계', Math.round(sum(requests.filter(r => r.currency === 'KRW'), 'amount')), '원', requests.some(r => r.currency !== 'KRW') ? `외화 ${requests.filter(r => r.currency !== 'KRW').length}건 별도` : ''), metric('결재 완료', requests.filter(r => r.approval_status === 'approved').length, '건', '원장·대표 결재가 모두 끝난 결의서')],
    evidence: requests.map(r => record({ id: r.id, label: r.title, detail: r.category || '', date: r.d, status: r.approval_status === 'approved' ? '결재 완료' : '결재 진행 중', fields: [field('작성', r.author), field('금액', r.currency === 'KRW' ? won(r.amount) : `${r.amount} ${r.currency}`)], facets: [`approval:${r.approval_status === 'approved' ? 'approved' : 'pending'}`, r.category && `category:${r.category}`] })),
    facetLabels: { 'approval:approved': '결재 완료', 'approval:pending': '결재 진행 중', ...Object.fromEntries([...new Set(requests.map(r => r.category).filter(Boolean))].map(c => [`category:${c}`, c])) }, recordSource: 'expenses',
    sourceLabel: '지출결의서', coverageNote: '목록은 선생님이 쓴 지출결의서입니다(최근 지출일 순).',
    sources: [{ table: 'expenses', rows: requests.length }],
  });
  return out;
}
