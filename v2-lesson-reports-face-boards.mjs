// 2.0 화면 · 수업보고서 관리 — '반 구성' 면(?tab=classnote&section=boards) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: `getBoardRosterCheck().then((boardRoster) => ({ boardRoster }))` — 영어 반 명단 ↔ 반 보드 원아(동기화 사본).
// 원아 연결 권한(canLink) = 2.0 canWriteTenant(lesson_reports) = 이 화면의 canSendReports.
import { boardRosterCheck } from './v2-lesson-reports-classnote-reads.mjs';

export async function loadFace(ctx) {
  return { tabData: { boardRoster: await boardRosterCheck(ctx.base, ctx.gates.canSendReports) } };
}
