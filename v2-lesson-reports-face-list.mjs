// 2.0 화면 · 수업보고서 관리 — '목록' 면(?tab=list · ?status= 알림·발송 큐 카드에서 곧장) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: Promise.all([getReportFilterOptions(), listReports(defaultReportFilters(kstToday(), sp.status))]) → { filterOptions, initialList }.
// 조회 둘 = v2-lesson-reports-reads.mjs(2.0 같은 표·같은 조건) · 기본 필터 = 2.0 defaultReportFilters(오늘 = 복사본 날짜) 그대로.
// 면 안 부품(ReportList)의 쪽 넘김·필터·정렬은 같은 listReports를 화면 GET 열쇠 `list`로 부른다(readList). · 읽기 전용.
import { listReports, readCtx, reportFilterOptions } from './v2-lesson-reports-reads.mjs';

export async function loadFace(ctx) {
  const F = await ctx.importV2('features/report-admin/report-filters.ts'), r = readCtx(ctx);
  const [filterOptions, firstPage] = await Promise.all([reportFilterOptions(r), listReports(r, F.defaultReportFilters(ctx.today, ctx.sp.status))]);
  return {
    tabData: {
      filterOptions,
      initialList: { rows: firstPage.rows ?? [], total: firstPage.total ?? 0, page: firstPage.page ?? 0, pageSize: firstPage.pageSize ?? 30 },
    },
  };
}
