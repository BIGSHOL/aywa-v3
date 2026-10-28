// 2.0 원생 상세 '타임라인' 탭(app/(shell)/students/[id]/_tabs/timeline-tab.tsx)의 조립 — async 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// 상세 load가 고른 탭으로 함께 실어 보내고(v2-students-tab-*.mjs loadTab → data.tab.data) 여기서는 탭 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 조회 자리뿐이다(students-tab-*.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-tabs-c.mjs가 2.0 본문에 같은 짝을 대어 대조한다.
// 2.0이 상대 경로로 부르던 부품은 같은 파일을 @/ 경로로 부른다.
import type { TimelineEvent } from "@/features/students/server/queries";
import { TimelineView } from "@/app/(shell)/students/[id]/_tabs/timeline-view";
import { useStudentTab } from "./students-shared";

/** 상세 load가 실어 보내는 이 탭의 자료(v2-students-tab-timeline.mjs) — 2.0 getStudentTimeline 그대로. */
type TimelineTabData = { events: TimelineEvent[] };

// ── 2.0 탭 본문(글자 그대로 · 바뀐 곳은 swaps.json 짝뿐) ──
export function TimelineTab({ studentId }: { studentId: string }) {
  // 한 학생분 전 이벤트(최신순)를 한 번에 가져와 클라가 월별로 페이지네이션(반응속도: 월 전환에 서버 왕복 없음).
  const { events } = useStudentTab<TimelineTabData>();
  return <TimelineView events={events} />;
}
