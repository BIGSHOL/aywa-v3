// 원생 상세 '숙제 영상' 탭 — 2.0 _tabs/homework-videos-tab.tsx(HomeworkVideosTab)와 homework-video-links.tsx(HomeworkVideoLinks)는 서버 컴포넌트라
// 본문을 **글자 그대로** 옮겼다. 바꾼 곳은 서버 조회 자리와 재생 안내 한 줄뿐이다(students-tab-homework-videos.swaps.json · verify-v2-students-tabs-b.mjs가 대조).
// 두 부품은 같은 자료를 나눠 읽는다(v2-students-tab-homework-videos.mjs loadTab → useStudentTab). 연습 자료은 영상을 재생하지 않는다 —
// 서버가 Drive 파일 번호를 비워 보내 재생 단추가 서지 않는다(목록·상태·출처·업로드 기록은 그대로). 올리기 사이트 주소는 싣지 않는다.
import { SheetClassName, SheetText } from "@/features/teacher-view/interface-label";
import { subjectLabelRecord } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { HomeworkVideosView } from "@/app/(shell)/students/[id]/_tabs/homework-videos-view";
import { HomeworkUploadLog } from "@/app/(shell)/students/[id]/_tabs/homework-upload-log";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { HomeworkVideoLinkButtons } from "@/app/(shell)/students/[id]/_tabs/homework-video-link-buttons";
import type { HomeworkVideo } from "@/features/students/homework-videos";
import type { HomeworkUploadAttempt } from "@/features/students/homework-upload-log";
import { useStudentTab, isMissingTab, MissingTab } from "./students-shared";

type LinkRow = { classId: string; className: string; count: number; until: string | null };
/** v2-students-tab-homework-videos.mjs loadTab 반환. */
type HomeworkTabData = {
  videos: { ready: boolean; rows: HomeworkVideo[] };
  uploadLog: { ready: boolean; rows: HomeworkUploadAttempt[] };
  links: { rows: LinkRow[]; siteUrl: string | null } | null;
  settings: { operations: { subjects: SubjectSetting[] } };
};

export function HomeworkVideosTab({ studentId, videoId = null }: { studentId: string; videoId?: string | null }) {
  const data = useStudentTab<HomeworkTabData>();
  if (isMissingTab(data)) return <MissingTab />;
  const [result, settings, uploadLog] = [data.videos, data.settings, data.uploadLog];
  if (!result.ready) return <p className="text-sm"><SheetText value={"숙제 영상 보관 기능을 준비 중입니다."} /></p>;
  return <div className="space-y-6"><p className="text-text-dim text-sm">연습 자료에서는 영상을 재생하지 않습니다. 목록과 상태만 볼 수 있습니다.</p><HomeworkVideosView key={videoId ?? ""} rows={result.rows} subjectLabels={subjectLabelRecord(settings.operations.subjects)} initialVideoId={videoId} /><HomeworkUploadLog result={uploadLog} /></div>;
}

/**
 * 학생 상세 '숙제 영상' 탭 위 — **올리기 사이트 안내** + 이미 나간 링크 끊기.
 * 🔴 학생마다 제출 링크를 만드는 '제출 링크 복사'는 거뒀다(원장 2026-10-03 *"학생영상 개별링크는 더이상 생성하지않고 … 이제는 클래스노트
 *    업로드 혹은 /v 링크로만 업로드"*). 이미 나간 링크는 만든 날 + 7일에 저절로 끝나고, 그 전에 여기서 끊을 수 있다.
 * 🔴 쓸 수 없는 학원(ClassNote 기능 꺼짐·Drive 값·SQL 없음)에선 **아무것도 그리지 않는다**(흔적 없이). 조회가 실패해도
 *    탭 전체를 죽이지 않고 이 구역만 빠진다.
 */
export function HomeworkVideoLinks({ studentId }: { studentId: string }) {
  const data = useStudentTab<HomeworkTabData>();
  const loaded = isMissingTab(data) ? null : data.links;
  if (!loaded || (!loaded.rows.length && !loaded.siteUrl)) return null;
  const { rows, siteUrl } = loaded;
  return (
    <section aria-label="숙제 영상 올리기" className="border-line space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-bold"><SheetText value={"숙제 영상 올리기"} /></h3>
        {siteUrl ? (
          <p className="text-text-dim mt-1 text-sm break-keep">
            <SheetText value={"학생은 "} /><span className="text-foreground font-bold break-all">{siteUrl}</span> <SheetText value={"에서 휴대폰 뒷 4자리와 이름을 넣고, 원스크린에서 ‘영상 과제 있음’으로 낸 숙제를 골라 올립니다(선생님이 정한 마감까지 — 기본은 숙제가 나간 날로부터 "} />{SITE_HOMEWORK_DAYS}<SheetText value={"일 뒤, 10/1 숙제면 10/8까지 · ‘다음 수업’을 고르면 그 수업일까지). ClassNote에 올려도 됩니다."} /></p>
        ) : null}
        {rows.length ? (
          <p className="text-text-dim mt-1 text-sm break-keep">
            <SheetText value={"아래는 아직 쓸 수 있는 제출 링크입니다(학생이 사이트에서 연 링크 · 예전에 보낸 링크). 적힌 날까지 쓸 수 있고, 그 전에 끊을 수 있습니다. 학생마다 링크를 새로 만들지는 않습니다."} /></p>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="divide-line divide-y">
          {rows.map((row) => (
            <li key={row.classId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="min-w-0 flex-1 text-sm font-bold"><SheetClassName value={row.className} /></span>
              <HomeworkVideoLinkButtons studentId={studentId} classId={row.classId} classLabel={row.className} count={row.count} until={row.until} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
