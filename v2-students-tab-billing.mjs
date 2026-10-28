// 원생 상세 '수납' 탭(2.0 _tabs/billing-tab.tsx) — getStudentInvoices를 Docker 복사본에서 같은 표·같은 조건으로.
// 청구월(period) 내림차순 · 금액은 숫자(PostgREST JSON 숫자와 같게) · 항목 = line_items의 description(없으면 name)·amount.
// 2.0은 이 탭을 수납 권한이 있을 때만 세운다(page.tsx canSeeBilling) — 상세 load가 그 판정으로 탭을 고른다. 읽기 전용.

import { readStudentInvoices } from './v2-students-tab-overview.mjs';

// 조회는 개요 탭과 같은 원본(v2-students-tab-overview.mjs readStudentInvoices — 2.0 getStudentInvoices)을 쓴다.
export async function loadTab({ base, id }) {
  return { invoices: await readStudentInvoices(base, id) };
}
