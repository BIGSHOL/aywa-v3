// 2.0 원생 상세 '상담' 탭(app/(shell)/students/[id]/_tabs/consultations-tab.tsx)의 조립 — async 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// 상세 load가 고른 탭으로 함께 실어 보내고(v2-students-tab-*.mjs loadTab → data.tab.data) 여기서는 탭 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 조회 자리뿐이다(students-tab-*.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-tabs-c.mjs가 2.0 본문에 같은 짝을 대어 대조한다.
// 2.0이 상대 경로로 부르던 부품은 같은 파일을 @/ 경로로 부른다.
import { SheetTeacherName, SheetText } from "@/features/teacher-view/interface-label";
import Link from "next/link";
import type { StudentConsultationRow, StudentEnrollmentConsultRow, StudentEnrollmentConsults } from "@/features/students/server/queries";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WindowLink } from "@/components/workspace/window-link";
import { NewConsultationLink } from "@/app/(shell)/consultations/_components/new-consultation-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ConsultationDeleteButton } from "@/app/(shell)/consultations/_components/consultation-delete-button";
import { FollowUpToggle } from "@/app/(shell)/consultations/_components/follow-up-toggle";
import { useStudentTab } from "./students-shared";

/** 상세 load가 실어 보내는 이 탭의 자료(v2-students-tab-consultations.mjs) — 2.0 Promise.all 세 값 그대로(입학 상담·설정은 권한이 있을 때만). */
type ConsultationsTabData = {
  consults: StudentConsultationRow[];
  enrollResult: StudentEnrollmentConsults | null;
  settings: { operations: { subjects: SubjectSetting[] } } | null;
};

// ── 2.0 탭 본문(글자 그대로 · 바뀐 곳은 swaps.json 짝뿐) ──
const CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  academic: "학습/성적",
  emotional: "정서/심리",
  career: "진로",
  social: "교우관계",
  other: "기타",
};

const AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};

// 등록상담 결과(입학 상담 outcome) — 고정 도메인 enum(운영 enum 아님). 알려진 값만 라벨, 미지정은 미표시.
// 🔴 여기 표가 등록상담 정본과 어긋나 있었다: enrolled를 "등록완료"라 불러 **수강등록 완료**로 읽혔고
//    (실데이터상 등록 결정 건의 절반 가까이는 반 배정이 없다), pending("첫 문의 접수")을 "보류"라 불러
//    뜻이 정반대였으며, scheduled·ai_done·no_show가 없어 그 상태 상담은 결과가 아예 안 보였다.
//    → 등록상담 정본(OUTCOME_PILL)과 같은 문자열로 통일. registered/hold/rejected는 enum에 없는 죽은 키라 제거.
const ENROLL_OUTCOME_LABEL: Record<string, string> = {
  pending: "대기",
  scheduled: "예약",
  consulted: "상담완료",
  ai_done: "AI 완료",
  enrolled: "재원생 등록 완료", // 원장 2026-09-18 — 등록상담 정본과 같은 문자열
  declined: "거절",
  no_show: "노쇼",
};

type Consult = StudentConsultationRow;

const CAP = 15;

export function ConsultationsTab({
  studentId,
  canSeeEnrollment = false,
  canOpenEnrollmentDetail = false,
}: {
  studentId: string;
  /** 입학 상담 카드 노출 여부 — enrollment 권한 또는 담당 강사(본인 학생). */
  canSeeEnrollment?: boolean;
  /** 입학 상담 '상세 보기'(/enrollment/[id]) 링크 노출 — enrollment 권한 있을 때만(강사는 숨김). */
  canOpenEnrollmentDetail?: boolean;
}) {
  // 학생상담 이력 + (권한 있으면) 등록상담 + 과목 라벨용 설정을 병렬로.
  const { consults, enrollResult, settings } = useStudentTab<ConsultationsTabData>();
  // 조회 실패를 '입학 상담 없음'으로 위장하지 않는다 — 실패면 한 줄로 알린다(2026-10-23).
  const enrollConsults = enrollResult?.status === "ok" ? enrollResult.rows : [];
  const enrollFailed = !!enrollResult && enrollResult.status !== "ok";
  const subjects = settings ? buildSubjectMaps(settings.operations.subjects) : null;
  const visible = consults.slice(0, CAP);
  const rest = consults.slice(CAP);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold">
          <SheetText value={"상담 이력"} />{consults.length > 0 ? (
            <span className="text-muted-foreground num ml-2 text-xs font-normal">{consults.length}<SheetText value={"건"} /></span>
          ) : null}
        </h2>
        <NewConsultationLink studentId={studentId} className="text-chart-1 hover:underline text-xs">
          <SheetText value={"+ 새 상담 기록"} /></NewConsultationLink>
      </header>

      {/* 입학 상담(등록상담) — 아주 중요한 상담이라 상단 고정. 별도 테이블(enrollment_consultations).
          같은 학생이 QR로 여러 번(과목·시기별) 접수하면 모두 별건으로 누적되므로 건수를 명시. */}
      {enrollConsults.length > 0 ? (
        <div className="space-y-2">
          <p className="text-primary text-xs font-bold">
            <SheetText value={"입학 상담 "} /><span className="num">{enrollConsults.length}</span><SheetText value={"건"} /></p>
          <ul className="space-y-2">
          {enrollConsults.map((e) => (
            <EnrollmentConsultItem
              key={e.id}
              e={e}
              subjectLabel={subjects?.labelOf(e.subject ?? "") ?? null}
              canOpenDetail={canOpenEnrollmentDetail}
            />
          ))}
          </ul>
        </div>
      ) : null}
      {enrollFailed ? (
        <p role="alert" className="text-muted-foreground text-xs">
          <SheetText value={"입학 상담을 불러오지 못했습니다 — 새로고침해 주세요"} />
        </p>
      ) : null}

      {consults.length === 0 ? (
        enrollConsults.length === 0 && !enrollFailed ? (
          <p className="text-muted-foreground py-8 text-center text-sm"><SheetText value={"상담 기록이 없습니다"} /></p>
        ) : null
      ) : (
        <>
          <ul className="space-y-3">
            {visible.map((c) => (
              <ConsultItem key={c.id} c={c} studentId={studentId} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="group">
              <summary className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft mt-3 flex cursor-pointer list-none items-center justify-center gap-1 rounded-lg border py-2 text-center text-xs transition">
                <EyIcon name="chevronDown" size={12} aria-hidden="true" />
                {rest.length}<SheetText value={"건 더 보기"} /></summary>
              <ul className="mt-3 space-y-3">
                {rest.map((c) => (
                  <ConsultItem key={c.id} c={c} studentId={studentId} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function ConsultItem({ c, studentId }: { c: Consult; studentId: string }) {
  return (
    <li className="bg-card border-border space-y-2 rounded-2xl border px-4 py-3">
      <header className="flex flex-wrap items-baseline gap-3">
        <span className="num text-muted-foreground text-xs">
          {new Date(c.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
        </span>
        {c.category ? (
          <span className="bg-chart-1/10 text-chart-1 border-chart-1/20 rounded-full border px-1.5 py-0.5 text-xs font-medium">
            {CATEGORY_LABEL[c.category] ?? c.category}
          </span>
        ) : null}
        {c.audience ? (
          <span className="text-muted-foreground text-xs">
            {AUDIENCE_LABEL[c.audience] ?? c.audience}
          </span>
        ) : null}
        {c.counselorName ? (
          <span className="text-muted-foreground text-xs">· <SheetTeacherName value={c.counselorName} /></span>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/consultations/${c.id}/edit`}
            className="text-chart-1 text-xs hover:underline"
          >
            <SheetText value={"수정"} /></Link>
          <ConsultationDeleteButton id={c.id} studentId={studentId} label="" />
        </div>
      </header>
      <p className="text-foreground text-sm leading-relaxed">{c.summary}</p>
      {c.followUpAction ? (
        <div className="bg-bg-soft/40 rounded-sm px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground"><SheetText value={"후속 조치"} /></p>
            <FollowUpToggle id={c.id} done={!!c.followUpDone} />
          </div>
          <p className="text-foreground mt-0.5">{c.followUpAction}</p>
          {c.followUpDate ? (
            <p className="text-muted-foreground num mt-0.5"><SheetText value={"예정일: "} />{c.followUpDate}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** 입학 상담(등록상담) 고정 카드 — [입학 상담] 라벨 + 날짜·과목·결과 + 내용 요약 + 상세(플로팅 창) 링크. */
function EnrollmentConsultItem({
  e,
  subjectLabel,
  canOpenDetail,
}: {
  e: StudentEnrollmentConsultRow;
  subjectLabel: string | null;
  /** '상세 보기' 링크 노출 — 강사(담당 학생 열람)에겐 상세 페이지가 게이트라 숨김. */
  canOpenDetail: boolean;
}) {
  return (
    <li className="bg-primary/5 border-primary/20 space-y-2 rounded-2xl border px-4 py-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="bg-primary/10 text-primary border-primary/20 rounded-full border px-1.5 py-0.5 text-xs font-bold">
          <SheetText value={"입학 상담"} /></span>
        {e.date ? (
          <span className="num text-muted-foreground text-xs">
            {new Date(e.date).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
          </span>
        ) : null}
        {subjectLabel ? <span className="text-muted-foreground text-xs">· {subjectLabel}</span> : null}
        {e.outcome && ENROLL_OUTCOME_LABEL[e.outcome] ? (
          <span className="text-chart-2 text-xs">· {ENROLL_OUTCOME_LABEL[e.outcome]}</span>
        ) : null}
        {canOpenDetail ? (
          <WindowLink
            href={`/enrollment/${e.id}`}
            title="입학 상담 상세"
            className="text-chart-1 ml-auto text-xs hover:underline"
          >
            <SheetText value={"상세 보기"} /></WindowLink>
        ) : null}
      </header>
      {/* 상담 원문을 전문 노출(2줄 클램프 제거) — 등록상담은 대부분 원본 필드만 채워지고 AI분석은 희소. */}
      {e.request ? <EnrollField label="상담 내용" value={e.request} /> : null}
      {e.careerGoal ? <EnrollField label="진로·목표" value={e.careerGoal} /> : null}
      {e.followUp ? <EnrollField label="후속" value={e.followUp} /> : null}
      {!e.request && !e.careerGoal && !e.followUp ? (
        <p className="text-muted-foreground text-xs italic">
          <SheetText value={canOpenDetail
            ? "기본 정보만 있는 상담입니다 — 학부모 정보 등 전체는 ‘상세 보기’에서 확인하세요"
            : "기본 정보만 있는 상담입니다"} />
        </p>
      ) : null}
    </li>
  );
}

/** 입학 상담 카드 안 라벨+내용 블록 — 전문 노출(한글 어절 줄바꿈·줄바꿈 보존). */
function EnrollField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-0.5 text-xs font-medium">{label}</p>
      <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-wrap">{value}</p>
    </div>
  );
}
