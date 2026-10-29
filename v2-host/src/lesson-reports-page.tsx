// 2.0 수업보고서 관리(app/(shell)/lesson-reports/page.tsx)의 조립 — 서버 컴포넌트라 서버가 하던 권한 판정·면 조회는
// /api/v2/lesson-reports?…(Docker 복사본, v2-screen-lesson-reports.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(lesson-reports-page.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-lesson-reports.mjs가 글자를 대조한다.
// 면 부품(발송 큐 · 작성률 · 반 구성 · 목록 · 회수 · 학부모 글 · 반 공지 · 직접 발송 · 보고서 설정 · AI 멘트)은 2.0 클라 부품 그대로.
// 화면 주인 = 원장 — 권한 칸은 서버가 2.0 판정 함수로 계산해 data.gates로 내려 준다. kstToday = 복사본 날짜(students-shared.tsx).
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { redirect, notFound } from "next/navigation";
import { ClassnoteQueueCard } from "@/app/(shell)/lesson-reports/_components/classnote-queue-card";
import { WritingRateCard } from "@/app/(shell)/lesson-reports/_components/writing-rate-card";
import { ReportList } from "@/app/(shell)/lesson-reports/_components/report-list";
import { RecallFace } from "@/app/(shell)/lesson-reports/_components/recall-face";
import { ParentRepliesFace } from "@/app/(shell)/lesson-reports/_components/parent-replies-face";
import { ComposeTab } from "@/app/(shell)/lesson-reports/_components/compose-tab";
import { NoticeFace } from "@/app/(shell)/lesson-reports/_components/notice-face";
import { BoardRosterCard } from "@/app/(shell)/lesson-reports/_components/board-roster-card";
import { ReportSection } from "@/app/(shell)/owner/_components/report-section";
import { AiMentSection } from "@/app/(shell)/owner/_components/ai-ment-section";
import { classnoteModuleOn, classnoteReplyMode } from "@/features/owner/classnote-gate";
import { classnoteReportFaces, isClassnoteReportTab, lessonReportFaces, resolveLessonReportTab } from "@/features/report-admin/lesson-report-faces";
import { kstToday } from "./students-shared";

type Sp = Record<string, string | undefined>;
/** /api/v2/lesson-reports 응답 — page.tsx가 서버에서 받던 값(권한 칸 · 학원 설정 · AI 라이선스 · 고른 면의 queue·tabData). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LessonReportsData = { viewer: any; gates: Record<"canReportSettings" | "canAiMent" | "canEditReportSettings" | "canEditAiMent" | "canSendReports" | "canReports", boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: any; aiOn: boolean; queue: any; tabData: any; tab: string; faceMissing?: boolean; today: string; teacherHome?: boolean };

export function LessonReportsPage({ data, searchParams }: { data: LessonReportsData; searchParams: Sp }) {
  const sp = searchParams;
  const viewer = data.viewer;
  const [canReportSettings, canAiMent, canEditReportSettings, canEditAiMent, canSendReports, canReports] = [
    data.gates.canReportSettings,
    data.gates.canAiMent,
    data.gates.canEditReportSettings,
    data.gates.canEditAiMent,
    data.gates.canSendReports, // 목록 탭 관리자 발송 열 노출(viewer는 열람만)
    data.gates.canReports,
  ];
  if (sp.tab === "video_homework") redirect("/lesson-reports/video-homework");
  // ClassNote 모듈 — 꺼진 학원은 발송 콘솔(큐·반 구성·반 공지·직접 발송·회수)을 세우지 않는다. 침산은 켜져 있어 종전과 같다.
  // 요청 캐시라 아래 면별 조회의 getTenantSettings와 같은 조회를 나눠 쓴다.
  const [tenantSettings, aiOn] = [data.settings, data.aiOn];
  const classnoteOn = classnoteModuleOn(tenantSettings);
  // 학부모 글 답글·공감 모드(학원 설정, 기본 끔 — 모듈이 꺼지면 끔). 끔이면 면도 조회도 없다.
  const replyMode = classnoteReplyMode(tenantSettings);
  const faceOptions = { canReportSettings, canAiMent, canSend: canSendReports, classnoteOn, aiOn, replyOn: replyMode !== "off", canReports };
  const tab = resolveLessonReportTab(sp, faceOptions);
  if (tab !== "report" && tab !== "ai_ment" && !canReports) notFound();

  const faces = lessonReportFaces(faceOptions);
  const classnoteFaces = classnoteReportFaces(faceOptions);
  const inClassnote = isClassnoteReportTab(tab);

  // 큐는 독립 탭에서만 조회·폴링한다. 다른 관리 면의 첫 화면을 차지하지 않는다.
  // 활성 탭의 자료 = 서버(v2-screen-lesson-reports.mjs)가 page.tsx와 같은 면만 읽어 보낸다.
  const [queue, tabData] = [data.queue, data.tabData];

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* 수제 헤더 → PageHeader 수렴(2026-07-19) — 창(embed)에선 컴팩트 1행으로 접힌다(제목은 창 타이틀바). */}
      <PageHeader
        eyebrow={data.teacherHome ? "선생님" : classnoteOn ? "발송 관리" : "보고서 관리"}
        title={data.teacherHome ? "학부모 글·답글" : "수업보고서"}
        description={
          data.teacherHome ? "내 원생과 내 반의 글을 확인합니다." : classnoteOn
            ? "발송 현황과 보고서 작성률을 확인합니다. 강사 작성은 원스크린에서 진행합니다."
            : "보고서 작성률과 목록을 확인합니다. 강사 작성은 원스크린에서 진행하고, 학부모에게는 보고서 링크를 보냅니다."
        }
      />

      {data.teacherHome ? null : <FaceTabs faces={faces} active={inClassnote ? "classnote" : tab} ariaLabel="수업보고서 면" />}
      {data.teacherHome || !inClassnote ? null : <FaceTabs faces={classnoteFaces} active={tab} ariaLabel="클래스노트 기능" level="secondary" />}

      {tab === "queue" ? (
        queue ? <ClassnoteQueueCard view={queue} /> :
          <p className="text-text-faint text-sm">발송 현황을 불러올 수 없습니다.</p>
      ) : null}

      {tab === "writing" ? (
        "rates" in tabData && tabData.rates ? (
          <WritingRateCard view={tabData.rates} />
        ) : (
          <p className="text-text-faint text-sm">작성률을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "boards" && "boardRoster" in tabData ? (
        tabData.boardRoster ? (
          <BoardRosterCard view={tabData.boardRoster} />
        ) : (
          <p className="text-text-faint text-sm">반 구성을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "list" && "filterOptions" in tabData && "initialList" in tabData ? (
        <ReportList
          // 🔴 **상태가 바뀌면 새로 마운트한다** — 클라 컴포넌트라 `useState(initial)`는 첫 마운트에만 돌고,
          //    같은 라우트에서 `?status=`만 바뀐 소프트 내비는 인스턴스를 그대로 둔다. key가 없으면 이미 목록
          //    탭을 보던 사람이 "미발송 N건"을 눌러도 **아무 일도 안 일어난 것처럼** 보인다(이번 제보의 원인과
          //    같은 종류의 침묵). 적대적 리뷰 2026-09-09에서 잡았다.
          key={sp.status ?? "all"}
          options={tabData.filterOptions}
          initial={tabData.initialList}
          canSend={canSendReports}
          classnoteOn={classnoteOn}
          todayYmd={kstToday()}
          // 🔴 클라 초기 state가 서버 첫 페인트와 **같은 필터**여야 한다 — 안 맞추면 열자마자 목록이 한 번 바뀐다.
          initialStatus={sp.status}
        />
      ) : null}

      {tab === "recall" && "recallOptions" in tabData ? (
        <RecallFace options={tabData.recallOptions} todayYmd={kstToday()} />
      ) : null}

      {tab === "parent_replies" && "parentThreads" in tabData ? (
        tabData.parentThreads ? (
          <ParentRepliesFace view={tabData.parentThreads} />
        ) : (
          <p className="text-text-faint text-sm">학부모 글을 불러올 수 없습니다.</p>
        )
      ) : null}

      {tab === "notice" && "noticeClasses" in tabData && "noticeRows" in tabData ? (
        <NoticeFace
          classes={tabData.noticeClasses}
          initial={tabData.noticeRows}
          canSend={canSendReports}
          classWide={"classWide" in tabData ? tabData.classWide : undefined}
        />
      ) : null}

      {tab === "compose" && "composeStudents" in tabData ? (
        <ComposeTab
          students={tabData.composeStudents}
          classes={tabData.composeClasses}
          sendEnabled={tabData.composeSendEnabled}
          showDailyTest={tabData.composeShowDailyTest}
          showCheckTest={tabData.composeShowCheckTest}
          showAttachments={tabData.composeShowAttachments}
        />
      ) : null}

      {tab === "report" && "reportSettings" in tabData ? (
        <ReportSection initial={tabData.reportSettings} canEdit={canEditReportSettings} teachers={tabData.teachers}
          staffNames={tabData.staffNames} videoClasses={tabData.videoClasses} classnoteOn={classnoteOn} />
      ) : null}

      {tab === "ai_ment" && "aiPrompts" in tabData ? (
        <AiMentSection initial={tabData.aiPrompts} styles={tabData.mentStyles} canEdit={canEditAiMent} />
      ) : null}
    </div>
  );
}
