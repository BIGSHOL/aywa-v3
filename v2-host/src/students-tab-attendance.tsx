// 원생 상세 '출결' 탭 — 2.0 _tabs/attendance-tab.tsx(서버 컴포넌트)의 본문을 **글자 그대로** 옮겼다. 바꾼 곳은 서버 조회 자리뿐이다
// (students-tab-attendance.swaps.json — [2.0 글자, 바꾼 글자] 짝 · verify-v2-students-tabs-b.mjs가 대조). 자료는 상세와 함께 온다
// (v2-students-tab-attendance.mjs loadTab → useStudentTab). kstToday = 복사본 날짜. 달력·리스트·필터·통계는 2.0 클라 부품(AttendanceView) 그대로.
import { SheetText } from "@/features/teacher-view/interface-label";
import { buildAttendanceClassOptions } from "@/features/students/detail/attendance-tab";
import { RESERVED_BADGE_CLASS, RESERVED_CELL_LABEL, reservationSpanLabel } from "@/features/attendance/makeup-reservation";
import { shortDate } from "@/features/onescreen/makeup-absence-link";
import { AttendanceView } from "@/app/(shell)/students/[id]/_tabs/attendance-view";
import type { StudentAttendanceFull, StudentEnrollment } from "@/features/students/server/queries";
import { kstToday, useStudentTab, isMissingTab, MissingTab } from "./students-shared";

/** v2-students-tab-attendance.mjs loadTab 반환 — 2.0 탭이 서버에서 받던 값. */
type AttendanceTabData = {
  records: StudentAttendanceFull[];
  enrollments: StudentEnrollment[];
  upcoming: (Parameters<typeof reservationSpanLabel>[0] & { id: string; classId: string; absenceDate: string; note: string | null })[];
  classRows: { id: string; class_name: string }[];
};

/** 출결 탭 — 전건을 받아 클라에서 월 달력/리스트·월 네비·과목/반 필터·통계. 위에 **앞으로의 보강 예약**(0264a)을 한 줄씩. */
export function AttendanceTab({ studentId }: { studentId: string }) {
  const data = useStudentTab<AttendanceTabData>();
  if (isMissingTab(data)) return <MissingTab />;
  const today = kstToday();
  const [records, enrollments, upcoming] = [
    data.records,
    data.enrollments,
    // fail-soft — 표가 없거나 실패하면 빈 목록(출결 탭은 종전 그대로).
    data.upcoming,
  ];
  const classes = buildAttendanceClassOptions(enrollments, today);
  // 예약의 반 이름 — 수강 목록에 없는 반(옛 반·수강 종료 뒤 보강)일 수 있어 따로 읽는다.
  let classNameById = new Map<string, string>();
  if (upcoming.length > 0) {
    const rows = data.classRows;
    classNameById = new Map(rows.map((r) => [r.id, r.class_name]));
  }

  return (
    <>
      {upcoming.length > 0 ? (
        <section className="border-line bg-card mb-3 rounded-2xl border px-4 py-3" aria-label="앞으로의 보강 예약">
          <h3 className="text-foreground text-sm font-bold">
            {RESERVED_CELL_LABEL}
            <span className="text-text-dim num ml-1.5 font-normal">{upcoming.length}<SheetText value={"건"} /></span>
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className={`rounded-full px-1.5 py-0.5 font-bold ${RESERVED_BADGE_CLASS}`}>
                  {reservationSpanLabel(r)}
                </span>
                <span className="text-foreground">{classNameById.get(r.classId) ?? "—"}</span>
                <span className="text-text-dim">{shortDate(r.absenceDate)} <SheetText value={"결석분"} /></span>
                {r.note ? <span className="text-text-dim break-keep">· {r.note}</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-text-faint mt-1.5 text-xs break-keep">
            <SheetText value={"보강일에 출석부에서 출결을 찍으면 예약은 자동으로 이행 처리됩니다. 취소는 출석부의 예약 칸에서."} /></p>
        </section>
      ) : null}
      <AttendanceView records={records} classes={classes} />
    </>
  );
}
