// 2.0 원생 상세 '수업' 탭(app/(shell)/students/[id]/_tabs/classes-tab.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 탭이 서버에서 하던 조회
// (수강 줄 · 배정 후보 반 · 학원 설정 · 지난 수업의 그 시점 담임)는 상세 GET(v2-students-tab-classes.mjs loadTab)이 하고 여기서는 그 파일 본문(첫 상수부터
// 끝까지)을 **글자 그대로** 옮겼다. 바꾼 곳은 서버 호출 자리뿐이다(students-tab-classes.swaps.json) — verify-v2-students-tabs-a.mjs가 글자를 대조한다.
// 자료 = useStudentTab() · kstToday = 복사본 날짜(students-shared.tsx). 반 배정·반 이동·수강 종료·삭제·날짜·등원 요일 저장은 아직 연습 화면에서 받지 않는다
// (누르면 '아직 지원하지 않는 저장'으로 거절 — shims/server-action.ts).
import { SheetClassName, SheetText } from "@/features/teacher-view/interface-label";
import { CalendarDays } from "@/components/icons/aywa-icon-compat";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { Pill } from "@/components/atoms/pill";
import type { StudentClassRow, StudentDetail } from "@/features/students/server/queries";
import type { ClassListRow } from "@/features/classes/server/queries";
import { enrollmentAssignBlockReason, enrollmentLastDate, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { buildSubjectMaps, type SubjectMaps, type SubjectSetting } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { usedRowSubjectsOf } from "@/features/students/lib/week-grid-row-mode";
import type { AssignDialogClass } from "@/components/enrollment-assign-dialog";
import { StudentAssignAction } from "@/app/(shell)/students/[id]/_components/student-assign-action";
import { EndEnrollmentAction } from "@/features/enrollments/components/end-enrollment-action";
import { DeleteEnrollmentButton } from "@/app/(shell)/students/[id]/_components/delete-enrollment-button";
import { MoveEnrollmentButton, MoveEnrollmentProvider } from "@/app/(shell)/students/[id]/_components/move-enrollment-button";
import { EditableDateCell } from "@/features/enrollments/components/editable-date-cell";
import { canEditEnrollmentDateClass, type EnrollmentDateAccess } from "@/features/enrollments/date-access";
import { EditableAttendanceCell } from "@/features/enrollments/components/editable-attendance-cell";
import { WindowLink } from "@/components/workspace/window-link";
import { StudentWeekGrid } from "@/app/(shell)/students/[id]/_tabs/student-week-grid";
import type { PastTeacher } from "@/features/students/lib/past-class-teacher";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { kstToday, useStudentTab, isMissingTab, MissingTab } from "./students-shared";

/** 상세 GET이 실어 보내는 수업 자료(v2-students-tab-classes.mjs loadTab) — Promise.all 이름 그대로 + 지난 수업 담임([수강 id, 결과] 줄). */
type ClassesTabData = {
  rows: StudentClassRow[];
  allActiveClasses: ClassListRow[];
  settings: { operations: OperationsSettings & { subjects: SubjectSetting[] } };
  pastTeacherList: [string, PastTeacher][];
};

type ClassesTabProps = {
  student: StudentDetail;
  canEnd: boolean;
  canAssign?: boolean;
  dateAccess: EnrollmentDateAccess;
  canEditSchedule: boolean;
  canDeleteEnrollment: boolean;
};
/** 2.0 ClassesTab 자리(같은 이름·같은 props) — 자료가 오면 2.0 본문(ClassesTabBody)을 그린다. */
export function ClassesTab(props: ClassesTabProps) {
  const data = useStudentTab<ClassesTabData | { missing: true } | null>();
  return !data || isMissingTab(data) ? <MissingTab /> : <ClassesTabBody {...props} />;
}

const DAY_CODE_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const DAY_CODE_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 반 운영 요일(+시작시각) → "월·목 14:20 · 화 16:00"(같은 시각 요일 묶음). 반 옵션 힌트용. */
function formatClassSchedule(days: { day: string; start: string | null }[]): string {
  if (!days.length) return "";
  const byTime = new Map<string, string[]>();
  for (const d of [...days].sort((a, b) => DAY_CODE_ORDER.indexOf(a.day) - DAY_CODE_ORDER.indexOf(b.day))) {
    const t = d.start ? d.start.slice(0, 5) : "";
    (byTime.get(t) ?? byTime.set(t, []).get(t)!).push(DAY_CODE_LABEL[d.day] ?? d.day);
  }
  return [...byTime.entries()].map(([t, ds]) => `${ds.join("·")}${t ? ` ${t}` : ""}`).join(" · ");
}

// 요일 chip 색(ijw DAY_COLORS 대응 — aywa 토큰).
const DAY_CHIP: Record<string, string> = {
  "월": "bg-amber/15 text-amber",
  "화": "bg-rose/15 text-rose",
  "수": "bg-blue/15 text-blue",
  "목": "bg-primary/15 text-primary",
  "금": "bg-purple/15 text-purple",
  "토": "bg-danger/15 text-danger",
  "일": "bg-purple/15 text-purple",
};

/** 수업 탭(ijw CoursesTab 이식) — 수강 중/배정 예정/지난 3섹션 + 스케줄(요일+교시)·강사. */
function ClassesTabBody({
  student,
  canEnd,
  canAssign = false,
  dateAccess,
  canEditSchedule,
  canDeleteEnrollment,
}: {
  student: StudentDetail;
  canEnd: boolean;
  canAssign?: boolean;
  dateAccess: EnrollmentDateAccess;
  /** 분리등원 요일(스케줄 셀) 더블클릭 편집 노출 — canManageTenant("classes", 서버 액션과 같은 축). */
  canEditSchedule: boolean;
  /**
   * 잘못 만든 수업 이력 **삭제**(원장·super_admin) 노출 — 서버 `deleteEnrollment` 게이트와 같은 모양(#77).
   * ⚠️ '수강 종료'(canEnd)와 다른 축이다: 종료는 데스크 업무, 삭제는 원장 정정이다.
   */
  canDeleteEnrollment: boolean;
}) {
  const { rows, allActiveClasses, settings, pastTeacherList } = useStudentTab<ClassesTabData>();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  // 주간 격자의 행 구성 = 그 과목 시간표가 **처음 여는 뷰**의 규칙(학원설정 `subjects[].defaultView` 단일 소스).
  // 통합뷰 과목(영어)은 수업 있는 교시만 — 두 교시 체계가 섞인 15줄 표를 다 그리면 원본과 다른 모양이 된다.
  // 도출 규칙·실제 설정 픽스처·이 배선의 구조 가드 = week-grid-row-mode(.test).ts.
  const usedRowSubjects = usedRowSubjectsOf(settings.operations.subjects);

  const today = kstToday();
  const hasEnded = (r: StudentClassRow) => isEnrollmentEndedOn(r.endDate, today, r.isTransferred);
  const current = rows.filter((r) => !hasEnded(r) && r.startDate <= today);
  const scheduled = rows.filter((r) => !hasEnded(r) && r.startDate > today);
  /**
   * 지난 수업은 **최근 종료가 위**(원장 2026-09-07 *"지난 수업을 최근 종료한 수업이 상단에 오도록"*).
   * ⚠️ 종료일이 같으면 시작일이 늦은 쪽을 위로 — 같은 반을 두 번 다닌 줄(재등록)이 뒤집혀 보이지 않게.
   */
  const past = rows
    .filter((r) => hasEnded(r))
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? "") || b.startDate.localeCompare(a.startDate));
  /**
   * 종료일 당시 담임 이력 → 종료일 이전 보고서 → 수강 기간의 강사 출결 → 담당 변경이 없는 반의 배정 강사 순서.
   * 반이동 당일은 새 반의 수업이므로 이전 반은 전날까지만 조회한다. 근거가 없거나 동률이면 `—`로 둔다.
   * 추정한 이름에는 근거 날짜를 표시하며, 실제 담임 배정은 변경하지 않는다.
   */
  const pastTeachers = new Map(pastTeacherList);
  const pastRows = past.map((r) => {
    const at = pastTeachers.get(r.enrollmentId);
    return { ...r, teacherName: at?.name ?? null, teacherInferred: at?.inferred ?? false,
      teacherEvidence: at?.inferred ? at.source === "current"
        ? "담당 변경 기록이 없어 현재 반에 배정된 강사를 기준으로 추정했습니다"
        : `${at.date} ${at.source === "report" ? "수업보고서" : "출결"} 기록 기준으로 추정한 담당입니다` : undefined };
  });

  // 🔴 휴원·퇴원·상담 단계 학생에겐 '반 배정' 대신 **이유**를 보여준다 — 서버(createEnrollment)가
  //    같은 판정으로 거절하므로, 버튼만 감추면 "왜 못 하는지"를 알 수 없다(#77: 둘 다 필요).
  const assignBlockedReason = enrollmentAssignBlockReason(student.status);

  const activeClassIds = new Set(current.map((r) => r.classId));
  // 반별 기존 수강 기간(지난 것 포함) — 배정 다이얼로그가 DB GiST(같은 학생·같은 반 기간 겹침)를
  // **저장 전에** 감지해 알려주는 재료. 없으면 "배정 예정"인 반을 골라도 저장 순간에야 거부됐다
  // (2026-07-28 조현준 배정 실패 — 8/4부터 예정 배정된 반에 7/28 시작으로 다시 배정 시도).
  const periodsByClass = new Map<string, { start: string; end: string | null }[]>();
  for (const r of rows) {
    const list = periodsByClass.get(r.classId) ?? [];
    list.push({ start: r.startDate, end: r.endDate });
    periodsByClass.set(r.classId, list);
  }
  // 배정/이동 대상 = 현재 수강 중이 아닌 활성 반. 스케줄(요일·시각)·요일코드 포함.
  const candidateClasses: AssignDialogClass[] = allActiveClasses
    .filter((c) => !activeClassIds.has(c.id))
    .map((c) => ({
      id: c.id,
      className: c.className,
      subject: c.subject,
      teacherName: c.teacherName,
      studentCount: c.studentCount,
      days: c.days.map((d) => d.day),
      scheduleLabel: formatClassSchedule(c.days),
      existingPeriods: periodsByClass.get(c.id),
      isSpecial: c.isSpecial, // 반 이동 다이얼로그의 특강 기본 숨김(판정은 isSpecialLecture — 이름 폴백 포함)
    }));

  return (
    <MoveEnrollmentProvider>
    <div className="space-y-5">
      {/* 주간 시간표(읽기전용) — 수강 중 반의 과목별 교시 탭(행 구성 = 그 과목 시간표가 처음 여는 뷰의 규칙). 슬롯 없으면 null. */}
      <StudentWeekGrid rows={current} config={periodsConfig} usedRowSubjects={usedRowSubjects} />
      <Section
        title="수강 중인 수업"
        rows={current}
        kind="current"
        studentId={student.id}
        subjects={subjects}
        canEnd={canEnd}
        dateAccess={dateAccess}
        canEditSchedule={canEditSchedule}
        canDeleteEnrollment={canDeleteEnrollment}
        moveTargets={candidateClasses}
        moveStudent={{ id: student.id, name: student.name, grade: student.grade }}
        action={
          // 반 배정도 학생 기록 변경 — 강사(열람 전용)에겐 숨긴다. 서버 createEnrollment 게이트(full)와 한 쌍(#77).
          canAssign ? (
            <StudentAssignAction
              student={{ id: student.id, name: student.name, grade: student.grade }}
              classes={candidateClasses}
              blockedReason={assignBlockedReason}
            />
          ) : undefined
        }
        note="실제 학생이 등원하는 요일만 표기됩니다"
      />
      <Section title="배정 예정 수업" rows={scheduled} kind="scheduled" studentId={student.id} subjects={subjects} canEnd={canEnd} dateAccess={dateAccess} canEditSchedule={canEditSchedule} canDeleteEnrollment={canDeleteEnrollment} />
      <Section title="지난 수업" rows={pastRows} kind="past" studentId={student.id} subjects={subjects} canEnd={canEnd} dateAccess={dateAccess} canEditSchedule={canEditSchedule} canDeleteEnrollment={canDeleteEnrollment} />
    </div>
    </MoveEnrollmentProvider>
  );
}

function Section({
  title,
  rows,
  kind,
  studentId,
  subjects,
  canEnd,
  dateAccess,
  canEditSchedule,
  canDeleteEnrollment,
  moveTargets,
  moveStudent,
  action,
  note,
}: {
  title: string;
  /**
   * ⚠️ 지난 수업 줄은 `teacherName`이 **그 시점 담임**으로 갈아끼워져 오고, 그 값이 보고서 작성자로
   *    추정한 것이면 `teacherInferred`가 붙는다(위 `pastRows` 주석). 다른 섹션은 현재 담임 그대로다.
   */
  rows: (StudentClassRow & { teacherInferred?: boolean; teacherEvidence?: string })[];
  kind: "current" | "scheduled" | "past";
  studentId: string;
  subjects: SubjectMaps;
  canEnd: boolean;
  dateAccess: EnrollmentDateAccess;
  canEditSchedule: boolean;
  canDeleteEnrollment: boolean;
  /** 반 이동 대상 후보(수강 중 섹션에서만) — 있으면 행에 '반 이동' 버튼. */
  moveTargets?: AssignDialogClass[];
  /** 반 이동 다이얼로그 헤더용 학생 정보. */
  moveStudent?: { id: string; name: string; grade: string | null };
  action?: React.ReactNode;
  note?: string;
}) {
  // 수강 종료/반 이동 컬럼: 쓰기 권한 + 비-지난 섹션에서만. 셀 버튼은 재원중(end_date==null)에만 —
  // 이미 종료일이 있는 행엔 버튼을 숨겨 "종료된 행 재클릭 시 팝업 반복" 버그를 막는다.
  const showEndCol = canEnd && kind !== "past";
  const showMoveCol = canEditSchedule && kind === "current" && !!moveTargets && !!moveStudent;
  // 🔴 삭제(원장 정정)는 **세 구획 전부**에 선다 — 잘못 만든 이력은 대개 '지난 수업'(시작=종료)에 있다.
  //    그래서 액션 열은 '수강 종료'가 없는 구획에서도 열려야 한다.
  const showActionCol = showEndCol || showMoveCol || canDeleteEnrollment;
  return (
    <section className="bg-card border-border rounded-2xl border">
      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">
            {title} <span className="text-muted-foreground num font-normal">({rows.length})</span>
          </h2>
          {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
        </div>
        {action}
      </header>
      {rows.length === 0 ? (
        <div className="text-muted-foreground px-5 py-8 text-center text-sm"><SheetText value={"해당 수업이 없습니다"} /></div>
      ) : (
        <DragScrollArea>
          <table className="w-full min-w-[720px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead className="border-border text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"과목"} /></th>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"수업명"} /></th>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"강사"} /></th>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"스케줄"} /></th>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"시작"} /></th>
                <th className="px-4 py-2 text-left font-medium"><SheetText value={"종료"} /></th>
                {showActionCol ? <th className="px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr key={r.enrollmentId} className="hover:bg-bg-soft/40">
                  <td className="px-4 py-2.5">
                    <Pill color={subjects.colorOf(r.subject)}><SheetText value={subjects.labelOf(r.subject)} /></Pill>
                  </td>
                  {/* 수업명은 길면 **잘라내고 hover 툴팁**으로 보여준다(원장 2026-07-23) — 반 이름이 길어지면
                      (특강·병합반) 표가 옆으로 밀려 다른 열이 화면 밖으로 나갔다. `title`이 이미 전체 이름을
                      담고 있어 잘라도 정보 손실이 없다.
                      ⚠️ 표에 `[&_td]:whitespace-nowrap`이 걸려 있어 td만으론 안 잘린다 — 잘림은
                      **block + max-width**를 가진 안쪽 요소에 걸어야 먹는다. */}
                  <td className="text-foreground max-w-[200px] px-4 py-2.5 font-medium">
                    <WindowLink
                      href={`/classes/${r.classId}`}
                      title={r.className}
                      className="hover:text-primary block overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
                    >
                      <SheetClassName value={r.className} />
                    </WindowLink>
                  </td>
                  {/* 🔴 **글자는 이름만**(원장 2026-09-07 *"괄호 추정 표기 제거해 그냥 이름만"*). 종전엔 그 꼬리표를
                      덧붙였는데, 지난 수업 줄 대부분이 보고서 작성자 근거라 표가 온통 그 꼬리표였다.
                      ⚠️ 근거 등급 자체는 **없애지 않았다** — 마우스를 올리면 무엇으로 되살린 이름인지 말한다
                      (작성자는 담임이 아니다, [[#93]]). 이 구분을 데이터에서까지 지우지는 말 것. */}
                  <td
                    className="text-text-dim px-4 py-2.5 text-xs"
                    // 🔴 **지난 수업 줄에만** 근거를 말한다 — 현재·예정 줄의 이름은 되살린 값이 아니라
                    //    그냥 지금 담임이라, 같은 툴팁을 붙이면 "인수인계 기록에 남은 이름"이 거짓이 된다
                    //    (실브라우저 확인 2026-09-07에 잡음).
                    title={
                      kind !== "past" || !r.teacherName
                        ? undefined
                        : r.teacherInferred
                          ? r.teacherEvidence
                          : "인수인계 기록에 남은 이름입니다"
                    }
                  >
                    {r.teacherName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {canEditSchedule ? (
                      <EditableAttendanceCell enrollmentId={r.enrollmentId} classDays={r.classDays} attendanceDays={r.attendanceDays}>
                        <ScheduleCell schedule={r.schedule} />
                      </EditableAttendanceCell>
                    ) : (
                      <ScheduleCell schedule={r.schedule} />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {canEditEnrollmentDateClass(dateAccess, r.classId) ? (
                      <EditableDateCell enrollmentId={r.enrollmentId} field="start" value={r.startDate} />
                    ) : (
                      <span className="text-text-dim num">{r.startDate}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {canEditEnrollmentDateClass(dateAccess, r.classId) ? (
                      <EditableDateCell enrollmentId={r.enrollmentId} field="end" value={r.endDate} isTransferred={r.isTransferred} />
                    ) : kind === "scheduled" ? (
                      <span className="text-text-faint">—</span>
                    ) : r.endDate ? (
                      <span className="text-amber num font-medium">~{enrollmentLastDate(r.endDate, r.isTransferred)}</span>
                    ) : (
                      /* 재원중 = positive(green) — 학생 상태 배지와 같은 뜻·같은 색. */
                      <span className="text-green font-medium"><SheetText value={"재원중"} /></span>
                    )}
                    {r.onHold ? <span className="text-amber ml-1"><SheetText value={"(휴원)"} /></span> : null}
                  </td>
                  {showActionCol ? (
                    <td className="px-2 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {(showEndCol || showMoveCol) && r.endDate == null ? (
                          <>
                            {showMoveCol && moveTargets && moveStudent ? (
                              <MoveEnrollmentButton
                                enrollmentId={r.enrollmentId}
                                student={moveStudent}
                                currentClassName={r.className}
                                currentClassId={r.classId}
                                currentSubject={r.subject}
                                classes={moveTargets}
                              />
                            ) : null}
                            {showEndCol ? <EndEnrollmentAction
                              enrollmentId={r.enrollmentId}
                              studentId={studentId}
                              className={r.className}
                              currentEndDate={r.endDate}
                              startDate={r.startDate}
                            /> : null}
                          </>
                        ) : null}
                        {canDeleteEnrollment ? (
                          <DeleteEnrollmentButton
                            enrollmentId={r.enrollmentId}
                            className={r.className}
                            periodLabel={r.endDate ? `${r.startDate} ~ ${enrollmentLastDate(r.endDate, r.isTransferred)}` : `${r.startDate}부터`}
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </DragScrollArea>
      )}
    </section>
  );
}

function ScheduleCell({ schedule }: { schedule: StudentClassRow["schedule"] }) {
  if (schedule.length === 0) {
    return (
      <span className="text-text-faint inline-flex items-center gap-1 text-xs italic">
        <CalendarDays className="size-3" /> <SheetText value={"시간 미정"} /></span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {schedule.map((g, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="flex gap-0.5">
            {g.days.map((d) => (
              <span
                key={d}
                className={`inline-flex size-5 items-center justify-center rounded-sm text-xs font-bold ${DAY_CHIP[d] ?? "bg-bg-soft text-text-dim"}`}
              >
                {d}
              </span>
            ))}
          </span>
          <span className="text-text-dim text-xs">{g.label}</span>
          {i < schedule.length - 1 ? <span className="text-text-faint">/</span> : null}
        </span>
      ))}
    </div>
  );
}
