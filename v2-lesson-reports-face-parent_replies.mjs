// 2.0 화면 · 수업보고서 관리 — '학부모 글·답글' 면(?tab=classnote&section=parent_replies · ?page=) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: `listParentThreads({ mode: replyMode, user: viewer, page: sp.page }).then((parentThreads) => ({ parentThreads }), () => ({ parentThreads: null }))`
// — 조회 실패는 null(2.0 안내 문구가 선다). 글은 복사본의 학부모 글 사본 · 답글/공감 상태는 복사본의 요청 행.
import { parentThreads } from './v2-lesson-reports-classnote-reads.mjs';
import { teacherParentMessages } from './v2-screen-teacher-home.mjs';

export async function loadFace(ctx) {
  const scoped = ctx.sp.teacherHome === '1' && ctx.base.viewer.systemRole === 'teacher';
  const ids = scoped ? (await teacherParentMessages({ sql: ctx.sql, t: ctx.t, actor: { id: ctx.base.viewer.id },
    settings: ctx.settings, importV2: ctx.importV2, clock: ctx.base.clock, today: ctx.today })).rows.map(row => row.id) : null;
  const view = await parentThreads(ctx.base, { mode: ctx.replyMode, page: ctx.sp.page, scopedMessageIds: ids }).catch(() => null);
  return { tabData: { parentThreads: view } };
}
