// 2.0 원생 상세(app/(shell)/students/[id]/page.tsx)의 조립 — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회·권한 판정은
// /api/v2/students?v2path=/students/<id>(Docker 복사본, v2-students-detail.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(students-detail.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-students.mjs가 2.0 본문에
// 같은 짝을 대어 이 파일과 글자를 대조한다. 탭(서버 컴포넌트)은 같은 이름의 호스트 부품(students-tab-<탭>.tsx)으로 바꿔 끼웠다 —
// 고른 탭의 자료는 서버가 함께 실어 보내고(data.tab) 탭 부품이 useStudentTab()으로 읽는다. kstToday = 복사본 날짜(students-shared.tsx).
// 화면 주인 = 원장 — 권한 칸은 서버가 2.0 판정 함수로 계산해 data.gates로 내려 준다.
import { SheetText } from "@/features/teacher-view/interface-label";
import { WindowLink } from "@/components/workspace/window-link";
import { notFound } from "next/navigation";
import { Pencil } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/back-link";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import { Pill } from "@/components/atoms/pill";
import { DupSuspectNotice } from "@/app/(shell)/students/[id]/_components/dup-suspect-notice";
import { StudentTabsNav, isStudentTabKey } from "@/app/(shell)/students/[id]/_components/tabs-nav";
import { ScheduledChangeBanner } from "@/components/scheduled-change-banner";
import { ScheduledChangeActions } from "@/components/scheduled-change-actions";
import { isInternalPath } from "@/lib/navigation";
import { StatusAction } from "@/app/(shell)/students/[id]/_components/status-action";
import { CancelScheduledWithdrawal } from "@/app/(shell)/students/[id]/_components/scheduled-withdrawal";
import { WithdrawalReportEntry, type ReportEntry } from "@/app/(shell)/students/[id]/_components/withdrawal-report-entry";
import { lastCourseGateApplies, viaReportMessage } from "@/features/withdrawals/via-report";
import { DeleteStudentButton } from "@/app/(shell)/students/[id]/_components/delete-student-button";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
import type { StudentDetail, StudentEnrollment } from "@/features/students/server/queries";
import type { ScheduledChange } from "@/features/enrollments/scheduled-changes";
import type { EnrollmentDateAccess } from "@/features/enrollments/date-access";
import { kstToday } from "./students-shared";
import { OverviewTab } from "./students-tab-overview";
import { ClassesTab } from "./students-tab-classes";
import { BillingTab } from "./students-tab-billing";
import { GradesTab } from "./students-tab-grades";
import { SrsTab } from "./students-tab-srs";
import { TodaysMathTab } from "./students-tab-todays-math";
import { ProgressTab } from "./students-tab-progress";
import { AttendanceTab } from "./students-tab-attendance";
import { ConsultationsTab } from "./students-tab-consultations";
import { MemosTab } from "./students-tab-memos";
import { TimelineTab } from "./students-tab-timeline";
import { StudentContributionView } from "./students-tab-contribution";
import { HomeworkVideosTab, HomeworkVideoLinks } from "./students-tab-homework-videos";

/** /api/v2/students?v2path=/students/<id> 응답 — page.tsx가 서버에서 받던 값 + 권한 칸 + 고른 탭의 자료. */
export type StudentDetailData = {
  student: StudentDetail;
  enrollments: StudentEnrollment[];
  scheduled: ScheduledChange[];
  upcomingMakeups: Parameters<typeof ScheduledChangeBanner>[0]["makeups"];
  reportInfo: { pending: { id: string; readable: boolean } | null; canRequest: boolean } | null;
  mathClasses?: { classes: { id: string; className: string }[]; isTest: boolean } | null;
  gates: {
    studentsLevel: string; canSeeBilling: boolean; canManageStatus: boolean; canDeleteStudent: boolean; dateAccess: EnrollmentDateAccess;
    canEditSchedule: boolean; canDeleteEnrollment: boolean; enrollmentAccess: boolean; canSeeEnrollment: boolean; canManageScheduled: boolean;
    canSeeWithdrawals: boolean; showContribution: boolean; showSrs: boolean; showTodaysMath: boolean;
  };
  today: string;
  lang: "ko";
  viewer: { id: string; name: string; systemRole: string; tenantId: string };
  settings: { operations: unknown; modules: { disabled: unknown } };
  tab: { key: string; data: unknown };
};

export function StudentDetailPage({
  data,
  params,
  searchParams,
}: {
  data: StudentDetailData;
  params: { id: string };
  // jjFrom·jjTo = 성적 탭 인재원 학습 분석 기간(JJ실에서 들어오면 그 기간 그대로 — 2026-09-11).
  // page·from·to = 진도 탭 쪽·보고서 날짜 조회(원장 2026-09-18). 탭 링크가 `?tab=`만 싣기 때문에 탭을 옮기면 초기화된다.
  searchParams: {
    contribution?: string;
    month?: string;
    view?: string;
    entity?: string;
    status?: string;
    grade?: string;
    q?: string;
    tab?: string;
    // 숙제 영상 탭에서 미리 골라 둘 영상 id(영상 제출 현황의 ▶) — 이 학생의 영상이 아니면 뷰어가 무시한다.
    video?: string;
    back?: string;
    jjFrom?: string;
    jjTo?: string;
    page?: string;
    from?: string;
    to?: string;
    // 성적 탭 목록의 열 머리 필터·정렬·쪽(원장 2026-09-24) — 쪽 키 `page`는 진도 탭과 같은 이름(탭을 옮기면 초기화).
    subject?: string;
    kind?: string;
    sort?: string;
    dir?: string;
    fScore?: string;
    fDelta?: string;
    embed?: string;
  };
}) {
  const user = data.viewer;
  const lang = data.lang;
  const { id } = params;
  const sp = searchParams;
  const { tab: tabParam, back: backParam, jjFrom, jjTo, page: pageParam, from: fromParam, to: toParam } = sp;
  const requestedTab = isStudentTabKey(tabParam) ? tabParam : "overview";
  // 학생을 **어디서 열었는지** — 영구 삭제 뒤 돌아갈 자리다(원장 2026-09-09: 신규생 관리에서 삭제하면
  // 그 창이 원생목록으로 바뀌어 신규생 관리로 못 돌아갔다). 목록마다 링크에 `?back=<경로>`를 달면 된다.
  // 🔴 여기서 **서버가 검증**한다 — 값을 그대로 `location.replace`에 넘기므로 `//evil.com`·`https://…`
  //    같은 외부 주소가 들어오면 열린 리다이렉트가 된다. 앱 내부 절대경로 한 갈래만 통과시킨다.
  const backHref = isInternalPath(backParam) ? backParam : "/students";

  // '수납' 탭은 학생(students) 권한이 아니라 **수납(billing) 권한**으로 잠근다 — 학생 상세는 강사(scoped)·
  // 뷰어(readonly)도 열 수 있어서, 탭 하나가 billing=none 역할에게 청구·납입 금액을 통째로 노출하고 있었다.
  // 강제 URL(?tab=billing)도 개요로 되돌린다(UI 숨김은 게이트가 아니다 — gotchas #77).
  // DB에서도 0158a RLS가 같은 매트릭스로 막는다(권한 없으면 0행) — 여기서 되돌리는 이유는 그 경우
  // 화면이 "미납 0원"이라는 **거짓 요약**을 보여주기 때문.
  const canSeeBilling = data.gates.canSeeBilling;
  const showContribution = data.gates.showContribution;
  // 'SRS 성적'(인재원 단어 학습·시험) 탭은 **짝이 걸린 학생**에게만(원장 2026-09-21: 일반 성적과 분리).
  // 짝이 없으면 그 구역이 스스로 비어 **빈 탭**이 된다 — 탭 자체를 안 그리고, 강제 URL(?tab=srs)도 개요로
  // 되돌린다(화면에서 감추는 것만으로는 게이트가 아니다, [[#77]]). 인재원을 부르지 않는 가벼운 판정이다.
  const showSrs = data.gates.showSrs;
  // 오늘 수학 탭 = 지점 라이선스 + 지금 수학 반을 다니는 학생만(원장 2026-10-18 — 지난 수강·영어만 다니는 학생은 탭 없음).
  const mathClasses = data.gates.showTodaysMath ? data.mathClasses : undefined;
  const showTodaysMath = mathClasses !== undefined && (mathClasses === null || mathClasses.classes.length > 0);
  const tab =
    (requestedTab === "contribution" && !showContribution) || (requestedTab === "billing" && !canSeeBilling)
      ? "overview"
      : requestedTab === "srs" && !showSrs
        ? "overview"
        : requestedTab === "todays-math" && !showTodaysMath
          ? "overview"
          : requestedTab;

  const student = data.student;
  if (!student) {
    // 강사(scoped)는 담당 학생만 상세 열람(적대 리뷰 F9) — 차단이면 404 대신 이유를 말한다.
    // (없는 학생과 비담당 학생을 구분해 주진 않는다 — 존재 여부 자체도 담당 밖 정보다.)
    if (data.gates.studentsLevel === "scoped") {
      return (
        <div className="space-y-6">
          <BackLink href="/students" label="원생목록으로" />
          <div className="bg-card border-line rounded-2xl border p-6">
            <p className="text-foreground text-sm font-bold"><SheetText value={"담당 학생만 열람할 수 있어요"} /></p>
            <p className="text-text-dim mt-1 text-sm">
              <SheetText value={"이 학생은 내 반(담임·교시 담당·임시 위임) 수강생이 아니거나, 수강이 끝난 지 오래됐어요. 열람이 필요하면 데스크(관리자)에 요청해 주세요."} /></p>
          </div>
        </div>
      );
    }
    notFound();
  }

  const statusMeta = studentStatusMeta(student.status, lang);
  // 학생 기록 변경(상태 전환·수정·AI 케어·수강 종료) = 학생 full 권한만(master·admin·manager·counselor).
  // 🔴 강사(scoped)는 열람 전용 — 원장 지시 2026-08-18("강사들은 퇴원처리 막아, 수정도, AI 케어도. 읽기만").
  // 서버 게이트는 students/server/actions.ts canManageStudentRecords가 같은 판정(#77 — UI 숨김만으론 부족).
  const canManageStudent = data.gates.studentsLevel === "full";
  // 퇴원 다이얼로그가 "어느 수업을 종료할지" 고르게 하려면 활성 수강 목록이 필요하다(원장 2026-08-20:
  // 한 과목만 그만두는데 두 과목이 함께 종료돼 말싸움). **권한이 있을 때만** 조회한다 — 강사·뷰어에겐
  // 이 다이얼로그 자체가 없다. canManageStudent에 의존하므로 병렬화 대상이 아니다(B4는 독립 await 규칙).
  // ⚠️ 필터(end_date == null)는 서버가 실제로 닫는 기준(closeActiveEnrollmentsClamped)과 **같아야** 한다 —
  //    갈리면 화면이 보여준 목록과 실제로 닫히는 행이 어긋난다.
  const canManageStatus = data.gates.canManageStatus;
  const allEnrollments = canManageStatus ? data.enrollments : [];
  const openRows = allEnrollments.filter((e) => e.endDate == null);
  // 과목 하나를 끝내면 퇴원보고서로 가야 하는가(그 과목의 마지막 반 · 원장 2026-10-26) — 서버 게이트와 **같은 판정**(`viaReportMessage`)을
  // 오늘 날짜로 미리 돌린다. 창은 그 과목을 고르면 저장 대신 퇴원보고서로 안내한다(실제 날짜로는 서버가 다시 본다).
  const endGate = lastCourseGateApplies(student.status, student.withdrawnAt ?? null);
  const endRows = allEnrollments.map((e) => ({
    id: e.id, classId: e.classId, className: e.className, subject: e.subject,
    start: e.startDate, end: e.endDate, isTransferred: e.isTransferred, isSpecial: e.isSpecial,
  }));
  const subjectEndViaReport = (subject: string) =>
    endGate && viaReportMessage(endRows, openRows.filter((e) => e.subject === subject).map((e) => e.id), kstToday(), student.withdrawnAt ?? null) !== null;
  const openEnrollments = openRows.map((e) => ({
    id: e.id,
    className: e.className,
    subject: e.subject,
    teacherName: e.teacherName,
    // 휴원 탭이 **지금 대기인 수업**을 체크된 채로 열기 위한 값(2026-09-16 부분 휴원).
    onHold: e.onHold === true,
    endViaReport: subjectEndViaReport(e.subject),
  }));
  // 학생 영구 삭제 = 관리 도구(admin) 쓰기 권한(기본 master) — 파괴적이라 조임. 잘못 추가 정정용.
  const canDeleteStudent = data.gates.canDeleteStudent;
  const dateAccess = data.gates.dateAccess;
  // 분리등원 요일(스케줄) 더블클릭 편집 — 서버 `updateEnrollmentsAttendanceBatch`는 **관리자(full)만**.
  // ⚠️ 종전 `canWriteTenant`는 scoped(강사)도 통과시켜, 강사에게 편집 칸이 열리고 저장만 거절됐다(#77 반대 꼴).
  const canEditSchedule = data.gates.canEditSchedule;
  // 잘못 만든 **수업 이력 삭제** = 원장(owner 콘솔 full) + super_admin(원장 2026-08-20).
  // 🔴 super_admin은 새 게이트를 항상 통과한다(원장 2026-08-13). 서버 `deleteEnrollment`가 같은 판정을
  //    다시 하고 붙은 기록까지 검사한다 — 화면 조건은 게이트가 아니다(#77).
  const canDeleteEnrollment = data.gates.canDeleteEnrollment;
  // 입학 상담(등록상담) 상담탭 노출.
  // ① enrollment 접근권한(원장·상담사 등) → 카드 + '상세 보기' 링크 모두.
  // ② 권한 없어도 **강사가 본인 담당 학생**이면 카드는 노출(읽기) — 단 '상세 보기'(/enrollment/[id])는
  //    여전히 enrollment 게이트라 링크는 숨김. (강사는 담당 학생의 입학 배경만 열람, 관리 상세는 불가.)
  // ①②의 판정은 타임라인 이벤트와 **같은 게이트 함수**를 쓴다(#77 — 표면마다 다시 쓰면 한쪽만 조여진다).
  const enrollmentAccess = data.gates.enrollmentAccess;
  const canSeeEnrollment = data.gates.canSeeEnrollment;
  const canOpenEnrollmentDetail = enrollmentAccess;

  // 예정된 반 변경(합류·이동·종료 예정) — 탭 위 배너. 예약이 없으면 빈 배열이라 아무것도 안 그린다.
  // 🔴 **열람은 막지 않는다**(강사도 자기 담당 학생의 예정은 알아야 한다). 수정·취소 버튼만 게이트.
  // 🔴 그 게이트는 **서버 액션과 같은 축**이어야 한다 — `canManageTenant("classes")`(반 이동을 *만드는*
  //    것과 같은 게이트). 학생 권한(students full)으로 버튼을 열면 상담사에게 버튼은 보이는데 서버가
  //    거절한다(#77의 반대 꼴 — 화면과 게이트가 갈리면 어느 쪽이든 거짓말이 된다).
  // 앞으로 잡힌 **보강 예약**(0264a)도 같은 배너에 선다(원장 2026-09-14: *"여기서도 보강 정보 알 수 있으면
  // 더 좋을듯? 바로가기로 오는것이니까"*). 🔴 읽기 전용 — 수정·취소 버튼은 붙이지 않는다(고치는 자리는
  // 출석부 칸이다). 조회는 fail-soft라 0264a 미적용·실패면 줄이 없을 뿐 화면은 그대로다([[#95]]).
  // 퇴원은 퇴원보고서로만(원장 2026-10-23) — 재원·휴원(퇴원 예약 없음) 학생에게 '퇴원보고서' 입구를 세운다. 조회 실패는 입구만 접는다
  // (실제 거절은 서버 액션이 한다 — 입구는 길 안내다).
  const reportable = (student.status === "enrolled" || student.status === "on_hold") && !student.withdrawnAt;
  const [scheduled, canManageScheduled, upcomingMakeups, canSeeWithdrawals, reportInfo] = [
    data.scheduled,
    data.gates.canManageScheduled,
    data.upcomingMakeups,
    // 퇴원생이면 퇴원 기록(사유·사후 상담)으로 바로 가는 링크(감사 N6) — 퇴원관리를 못 여는 사람에겐 안 선다.
    data.gates.canSeeWithdrawals,
    reportable ? data.reportInfo : null,
  ];
  // 진행 중인 보고서를 열 수 없는 사람에게는 '진행 중' 글을 원생 상태를 다루는 사람에게만 보인다(참여자가 아닌 강사에게 새지 않게).
  const reportEntry: ReportEntry | null = reportInfo?.pending
    ? reportInfo.pending.readable
      ? { kind: "pending", href: `/withdrawal-reports/${reportInfo.pending.id}` }
      : canManageStatus
        ? { kind: "pending", href: null }
        : null
    : reportInfo?.canRequest
      ? { kind: "request", href: `/withdrawal-reports?request=${student.id}` }
      : reportable && canManageStatus
        ? { kind: "note" }
        : null;

  const scheduledWithdrawal =
    student.status !== "withdrawn" && student.withdrawnAt ? String(student.withdrawnAt).slice(0, 10) : null;

  return (
    <div className="space-y-6">
      <BackLink href="/students" label="원생목록으로" />

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <p className="eyebrow"><SheetText value={"학생"} /></p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-bold tracking-tight text-foreground text-3xl">{studentDisplayName(student.name, student.englishName, lang)}</h1>
            {student.dupSuspect ? <DupSuspectTag /> : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            {student.grade || student.school ? <span>{sheetSchoolGrade(student.school, student.grade, lang)}</span> : null}
            {student.studentCode ? (
              <span className="num"><SheetText value={"· 학번 "} />{student.studentCode}</span>
            ) : null}
          </div>
          {student.dupSuspect ? (
            <DupSuspectNotice studentId={student.id} canClear={canManageStudent} />
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* 상태 배지 = 목록·요약과 같은 단일 소스(studentStatusMeta) — 화면마다 색이 달라지지 않게.
              ⚠️ 크기는 Pill 기본을 그대로 쓴다. 처음엔 `className="px-2.5 py-1 text-xs"`를 얹었는데
              Pill이 tailwind-merge를 안 거쳐서 기본값(text-xs py-[3px])과 **충돌한 채 둘 다 남고**
              실제로는 기본값이 이겼다(계산값 11px/3px 실측) — 아무 효과 없는 거짓 클래스였다. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Pill color={statusMeta?.color ?? "neutral"}>{statusMeta?.label ?? student.status}</Pill>
            {/* 퇴원 예약(원장 2026-09-28 *"퇴원당일전까지 '재원'"*) — 상태는 재원·휴원 그대로, 그날 00:05에 퇴원 처리된다.
                표식 = 퇴원이 아닌데 퇴원일이 있다(`changeStudentStatus` 주석). */}
            {scheduledWithdrawal ? <Pill color="amber"><SheetText value={"퇴원 예정 "} />{scheduledWithdrawal}</Pill> : null}
          </div>
          {/* ⚠️ 감기게 둔다 — 이 줄엔 상태 변경·수정·AI·삭제가 함께 서고, 라벨에 목적어를 붙이면
              (수정 → 학생 수정) 좁은 화면에서 가로로 넘친다. 넘치는 대신 다음 줄로 내려간다. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* 강사(scoped)는 열람 전용 — 상태 변경·학생 수정·AI 케어 전부 비노출(위 canManageStudent 주석). */}
            {canManageStatus && scheduledWithdrawal ? (
              <CancelScheduledWithdrawal studentId={student.id} date={scheduledWithdrawal} />
            ) : null}
            {/* 예전 '퇴원 처리' 자리 — 퇴원은 퇴원보고서로만(강사 작성 요청 또는 강사 작성 없이 바로 처리). */}
            {reportEntry && reportEntry.kind !== "note" ? <WithdrawalReportEntry entry={reportEntry} /> : null}
            {canManageStatus ? (
              <StatusAction
                studentId={student.id}
                studentName={student.name}
                currentStatus={student.status}
                openEnrollments={openEnrollments}
                reportEntry={reportEntry}
                scheduledWithdrawal={scheduledWithdrawal}
              />
            ) : null}
            {/* ⚠️ "수정" 단독 금지 — 상담 탭을 열면 상담 카드마다 '수정'(그 상담 기록)이 함께 보인다.
                여기는 **학생 정보**를 연다. 반 상세('반 수정')와 같은 규칙. */}
            {canManageStudent ? (
              <Button variant="outline" render={<WindowLink href={`/students/${student.id}/edit`} title="학생 수정" />}>
                <Pencil className="size-3.5" />
                <SheetText value={"학생 수정"} /></Button>
            ) : null}
            {/* 🔴 'AI 케어 분석' 버튼은 **없앴다**(원장 2026-09-18 "삭제") — 되살리지 말 것.
                지난 분석 결과는 개요 탭 'AI 케어 인사이트'에 그대로 보인다(결과가 있을 때만 서는 패널). */}
            {canSeeWithdrawals ? (
              <WindowLink href={`/withdrawals/${student.id}`} title={student.name}>
                <span className="text-primary text-sm font-semibold hover:underline"><SheetText value={"퇴원 기록 보기"} /></span>
              </WindowLink>
            ) : null}
            {canDeleteStudent ? (
              <DeleteStudentButton studentId={student.id} studentName={student.name} backHref={backHref} />
            ) : null}
          </div>
        </div>
      </header>

      <StudentTabsNav
        showContribution={showContribution}
        studentId={student.id}
        active={tab}
        canSeeBilling={canSeeBilling}
        showSrs={showSrs}
        showTodaysMath={showTodaysMath}
      />

      {/* 개요·수업을 포함한 모든 탭의 첫 내용으로 예약 전부와 수정·취소를 보여준다. */}
      <ScheduledChangeBanner
        changes={scheduled}
        makeups={upcomingMakeups}
        today={kstToday()}
        subject="student"
        actions={
          canManageScheduled
            ? (c) => <ScheduledChangeActions change={c} today={kstToday()} />
            : undefined
        }
      />

      <section>
        {tab === "overview" ? (
          <>
            {requestedTab === "billing" && !canSeeBilling ? (
              <p className="text-text-dim mb-3 text-sm" role="status"><SheetText value={"수납 내역을 볼 권한이 없어 학생 개요를 표시합니다."} /></p>
            ) : null}
            <OverviewTab student={student} canSeeBilling={canSeeBilling} />
          </>
        ) : tab === "classes" ? (
          <ClassesTab
            student={student}
            canEnd={canManageStatus}
            canAssign={canManageStudent}
            dateAccess={dateAccess}
            canEditSchedule={canEditSchedule}
            canDeleteEnrollment={canDeleteEnrollment}
          />
        ) : tab === "grades" ? (
          <GradesTab studentId={student.id} back={isInternalPath(backParam) ? backParam : null} embed={sp.embed === "1"}
            query={{ subject: sp.subject, kind: sp.kind, sort: sp.sort, dir: sp.dir, fScore: sp.fScore, fDelta: sp.fDelta, page: pageParam }} />
        ) : tab === "srs" ? (
          <SrsTab studentId={student.id} jjFrom={jjFrom} jjTo={jjTo} />
        ) : tab === "todays-math" ? (
          <TodaysMathTab studentId={student.id} aywaMathClasses={mathClasses?.classes ?? null} isTestStudent={mathClasses?.isTest ?? false} />
        ) : tab === "progress" ? (
          <ProgressTab
            studentId={student.id}
            page={Math.max(1, Math.floor(Number(pageParam) || 1))}
            from={fromParam ?? null}
            to={toParam ?? null}
            // 쪽 링크가 다시 싣는 값이라 **검증된 내부 경로만** 넘긴다(위 backHref와 같은 판정).
            back={isInternalPath(backParam) ? backParam : null}
          />
        ) : tab === "homework-videos" ? (
          // 위 = 올리기 사이트 안내 + 남은 제출 링크 끊기(쓸 수 없는 학원에선 안 그린다) · 아래 = 보관된 영상 목록.
          <div className="space-y-6">
            <HomeworkVideoLinks studentId={student.id} />
            <HomeworkVideosTab studentId={student.id} videoId={typeof sp.video === "string" ? sp.video : null} />
          </div>
        ) : tab === "attendance" ? (
          <AttendanceTab studentId={student.id} />
        ) : tab === "consultations" ? (
          <ConsultationsTab
            studentId={student.id}
            canSeeEnrollment={canSeeEnrollment}
            canOpenEnrollmentDetail={canOpenEnrollmentDetail}
          />
        ) : tab === "memos" ? (
          <MemosTab studentId={student.id} />
        ) : tab === "billing" ? (
          <BillingTab studentId={student.id} />
        ) : tab === "contribution" && showContribution ? (
          <StudentContributionView studentId={student.id} params={sp} />
        ) : tab === "timeline" ? (
          <TimelineTab studentId={student.id} />
        ) : null}
      </section>
    </div>
  );
}
