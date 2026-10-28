// 2.0 화면 · 수업보고서 관리 — '발송 큐' 면(?tab=classnote · 기본 클래스노트 면) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: `queue = tab === "queue" && classnoteOn ? getClassnoteQueue(3) : null` · tabData = `{ rates: null }`.
// 값은 v2-lesson-reports-classnote-reads.mjs classnoteQueue(복사본의 보고서 발송 상태 · 연동 PC 상태 행) — ClassNote를 부르지 않는다.
import { classnoteQueue } from './v2-lesson-reports-classnote-reads.mjs';

export async function loadFace(ctx) {
  return { queue: ctx.classnoteOn ? await classnoteQueue(ctx.base, 3) : null, tabData: { rates: null } };
}
