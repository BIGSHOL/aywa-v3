// 2.0 화면 · 수업보고서 관리 — '회수' 면(?tab=recall) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: getReportFilterOptions().then((filterOptions) => ({ recallOptions: filterOptions })) — 조회 = v2-lesson-reports-reads.mjs.
// 면 안 부품(RecallFace)의 학생 이름 검색은 2.0 listReports — 화면 GET 열쇠 `list`(readList). 회수 실행(recall-actions)은 저장이라 다음 단계. · 읽기 전용.
import { readCtx, reportFilterOptions } from './v2-lesson-reports-reads.mjs';

export async function loadFace(ctx) {
  return { tabData: { recallOptions: await reportFilterOptions(readCtx(ctx)) } };
}
