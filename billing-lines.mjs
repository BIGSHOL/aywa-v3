// 2.0 수납 표와 같은 정규화·구형 청구서 폴백을 복사본 읽기 자료에도 적용한다.
import { importV2 } from './v2-bridge.mjs';
import { scrub } from './domain-snapshot-core.mjs';

let source;
export function loadBillingLines() {
  source ??= Promise.all([
    importV2('features/billing/invoice-line-items.ts'),
    importV2('features/billing/invoice-lines.ts'),
  ]).then(([items, lines]) => ({ normalize: items.normalizeInvoiceLineItems, display: lines.invoiceDisplayLines, kind: lines.invoiceKindLabel }));
  return source;
}

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0;
const optional = value => value === undefined || value === null ? null : finite(value);

export function projectBillingLines(invoice, tools) {
  const normalized = tools.normalize(invoice.line_items);
  const shown = tools.display({
    amountTotal: finite(invoice.amount_total), amountPaid: finite(invoice.amount_paid),
    amountDiscount: finite(invoice.amount_discount), status: String(invoice.status || ''),
    notes: invoice.notes || null, lineItems: normalized,
    paymentMethod: invoice.payment_method || null, pointsUsed: finite(invoice.points_used),
    paidAt: invoice.paid_at || null,
  });
  const project = line => ({
    description: scrub(line.description) || '', kind: scrub(tools.kind(line.kind)) || '기타',
    amount: finite(line.amount), discount: finite(line.discount), points: finite(line.points),
    paid: optional(line.paid), unpaid: optional(line.unpaid),
    sourceItems: Array.isArray(line.sourceItems) ? line.sourceItems.map(project) : [],
  });
  return shown.map(project);
}

export function billingName(lines) {
  const first = lines[0]?.description || '수납명 없음';
  return lines.length > 1 ? `${first} 외 ${lines.length - 1}항목` : first;
}
