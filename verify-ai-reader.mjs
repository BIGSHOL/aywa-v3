import assert from 'node:assert/strict';
import { createAiReader, ROW_LIMIT } from './ai-reader.mjs';

const reader = await createAiReader({ target: 'sandbox' });
let passed = 0;
async function check(name, test) {
  await test();
  passed++;
  console.log(`통과 ${passed}: ${name}`);
}
async function denied(sql, codes) {
  await assert.rejects(reader.query(sql), error => codes.includes(error.code));
}
try {
  await check('분석 뷰 목록', async () => {
    const schema = await reader.schema();
    assert.ok(schema.views.length >= 280);
    assert.ok(schema.views.some(v => v.table_name === 'students'));
  });
  await check('원본 급여·계좌 조회 거부', async () => {
    await denied('select total from public.payroll_records limit 1', ['permission']);
    await denied('select account_number from public.expenses limit 1', ['permission']);
    await denied('select account_number from ai_access.expenses limit 1', ['sql']);
  });
  await check('비밀 열 전수 차단과 토큰 사용량 보존', async () => {
    const blocked = await reader.query("select count(*)::int as n from information_schema.columns where table_schema='ai_access' and column_name ~* '(account_number|card_number|password|secret)' ");
    assert.equal(blocked.rows[0].values.n, 0);
    const usage = await reader.schema({ table: 'ai_usage_logs' });
    assert.ok(['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens'].every(name =>
      usage.views.some(x => x.column_name === name)));
  });
  await check('사람별 급여 반올림, 학생 청구 원 단위', async () => {
    const salary = await reader.query('select count(*)::int as n from ai_access.users where monthly_base % 100000 <> 0 or hourly_rate % 100000 <> 0');
    assert.equal(salary.rows[0].values.n, 0);
    const invoices = await reader.query('select count(*)::int as n from ai_access.invoices where amount_paid % 100000 <> 0');
    assert.ok(invoices.rows[0].values.n > 0);
  });
  await check('쓰기·DDL·위험 함수 거부', async () => {
    await denied("update public.students set name='x' where false", ['permission', 'query']);
    await denied('create table ai_access.probe (n int)', ['permission', 'query']);
    await denied("select net.http_post(url:='https://example.invalid')", ['permission', 'sql', 'query']);
  });
  await check('다중 문장 거부', async () => {
    await denied('select 1; select 2', ['sql', 'query']);
  });
  await check('200행 상한과 잘림 표시', async () => {
    const result = await reader.query('select generate_series(1,205) as n');
    assert.equal(result.rowCount, ROW_LIMIT);
    assert.equal(result.truncated, true);
    assert.equal(result.rows.at(-1).row, ROW_LIMIT);
  });
  await check('10초 조회 시간 제한', async () => {
    await denied('select pg_sleep(11)', ['timeout', 'query']);
  });
  await check('10월 매출·환불·지출 자료', async () => {
    const result = await reader.query("select r.bill_count, r.billed_won, r.paid_won, r.net_billed_won, r.retained_paid_won, r.refund_won, coalesce(sum(e.expense_won),0) as pending_expense_won from ai_access.revenue_month r left join ai_access.expense_category_month e on e.tenant_id=r.tenant_id and e.month=r.month and e.approval_status='pending' where r.tenant_id='becaa316-e636-42e9-9d09-08b133e0b094' and r.month='2026-10' group by r.bill_count,r.billed_won,r.paid_won,r.net_billed_won,r.retained_paid_won,r.refund_won");
    assert.equal(result.rowCount, 1);
    const row = result.rows[0].values;
    assert.equal(row.bill_count, '335');
    assert.equal(row.billed_won, '132586125');
    assert.equal(row.paid_won, '130269625');
    assert.equal(row.retained_paid_won, '129937625');
    assert.equal(row.refund_won, '1377500');
    console.log(`10월: 화면 청구 ${row.bill_count}건/${row.billed_won}원 · 수납 ${row.paid_won}원 · 환불 상태 제외 수납 ${row.retained_paid_won}원 · 처리된 환불 ${row.refund_won}원 · 승인 대기 지출 ${row.pending_expense_won}원`);
  });
  console.log(`AI 읽기 도구 시험 ${passed}/${passed}`);
} finally { await reader.close(); }
