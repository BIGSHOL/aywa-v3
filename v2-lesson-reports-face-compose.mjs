// 2.0 화면 · 수업보고서 관리 — '직접 발송' 면(?tab=classnote&section=compose) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: `Promise.all([getStudentsList({ status: "enrolled" }), getTenantSettings(), getNoticeClassOptions()])` → composeStudents(id · 이름 · 학교 · 학년) ·
// composeClasses · composeSendEnabled(classnoteSendOn) · composeShowDailyTest · composeShowCheckTest · composeShowAttachments(학원 설정 report).
import { enrolledStudents, noticeClassOptions, mods } from './v2-lesson-reports-classnote-reads.mjs';

export async function loadFace(ctx) {
  const { base, settings } = ctx;
  const [M, rows, cls] = await Promise.all([mods(ctx.importV2), enrolledStudents(base), noticeClassOptions(base, ctx.gates.canReports)]);
  return { tabData: {
    composeStudents: rows.map((s) => ({ id: s.id, name: s.name, school: s.school, grade: s.grade })),
    composeClasses: cls.classes ?? [],
    composeSendEnabled: M.gate.classnoteSendOn(settings),
    composeShowDailyTest: settings.report.showDailyTest,
    composeShowCheckTest: settings.report.showCheckTest,
    composeShowAttachments: settings.report.showAttachments,
  } };
}
