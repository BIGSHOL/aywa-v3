// 2.0 화면 · 수업보고서 관리 — '반 공지' 면(?tab=classnote&section=notice) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: `Promise.all([getNoticeClassOptions(), listClassNotices(), listClassWideNotices()])` → noticeClasses · noticeRows · classWide
// (실패는 빈 값 — 2.0 `?? []`). 공지 행은 복사본의 공지 큐 행(결과 · 보고서 링크) 그대로.
import { noticeClassOptions, classNotices, classWideNotices } from './v2-lesson-reports-classnote-reads.mjs';

export async function loadFace(ctx) {
  const can = ctx.gates.canReports;
  const [cls, notices, wide] = await Promise.all([noticeClassOptions(ctx.base, can), classNotices(ctx.base, can), classWideNotices(ctx.base, can)]);
  return { tabData: {
    noticeClasses: cls.classes ?? [],
    noticeRows: notices.rows ?? [],
    classWide: { rows: wide.rows ?? [], boardClassIds: wide.boardClassIds ?? [] },
  } };
}
