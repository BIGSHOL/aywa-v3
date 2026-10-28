// 2.0 일별 출석부 page.tsx의 JSX. 서버 조회만 /api/v2/attendance로 옮긴다.
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { attendanceRate, attendedCount } from '@/lib/calc/attendance';
import { formatKoreanDateLong } from '@/lib/date-kst';
import { CheckCircle2, ChevronRight, ClipboardCheck, Pencil } from '@/components/icons/aywa-icon-compat';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import type { AttendanceRow } from '@/features/attendance/server/queries';
import { ATT_SOFT, ATT_SOFT_BORDER, type AttendanceStatusKey } from '@/features/attendance/status-color';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { AbsentStudentsView } from '@/app/(shell)/attendance/[date]/_components/absent-students-view';

export type DayListData = { page: 'dayList'; date: string; editors: { id: string; name: string; role: string }[]; viewer: string | null;
  host: { operations: { subjects: Parameters<typeof buildSubjectMaps>[0] } } } & (
  | { view: 'absent'; day: ComponentProps<typeof AbsentStudentsView>['day']; subjectLabel: Record<string, string> }
  | { view: 'records'; records: AttendanceRow[]; processing: { classId: string; className: string; subject: string; teacherName: string | null; expected: number; recorded: number; unprocessed: number; rate: number }[];
      holiday: string | null; saved: string | null; unlinked: string | null; linkError: string | null });

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
};

/**
 * 출결 표시 색 = [`status-color.ts`](src/features/attendance/status-color.ts) 단일 소스.
 * ⚠️ v4 이전엔 여기만 출석=primary(네이비)·조퇴=rose(장미)였다 — 월간 출석부(민트/파랑)를 보다
 *    이 화면으로 오면 같은 출결의 색이 통째로 바뀌었다.
 * 칩이 몇 개뿐이라 격자용 쨍한 원색(ATT_VIVID)이 아니라 -soft 틴트를 쓴다(색상은 같다).
 */
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  (Object.keys(ATT_SOFT) as AttendanceStatusKey[]).map((k) => [
    k,
    `${ATT_SOFT[k]} ${ATT_SOFT_BORDER[k]}`,
  ])
);

export function AttendanceDayList({ data }: { data: DayListData }) {
  const date = data.date;
  if (data.view === 'absent') return <AbsentStudentsView date={date} day={data.day} subjectLabel={data.subjectLabel} />;
  const { records, processing, holiday, saved, unlinked, linkError } = data;
  const subjectMaps = buildSubjectMaps(data.host.operations.subjects);

  // 처리 현황 집계 — 미처리 반·완료율(오늘 출결 누락 추적).
  const pendingClasses = processing.filter((p) => p.unprocessed > 0);
  const totalExpected = processing.reduce((s, p) => s + p.expected, 0);
  const totalRecorded = processing.reduce((s, p) => s + Math.min(p.recorded, p.expected), 0);
  const overallRate = totalExpected > 0 ? Math.round((totalRecorded / totalExpected) * 100) : 100;

  const groups = new Map<string, { className: string; subject: string; rows: AttendanceRow[] }>();
  for (const r of records) {
    if (!groups.has(r.classId)) {
      groups.set(r.classId, { className: r.className, subject: r.subject, rows: [] });
    }
    groups.get(r.classId)!.rows.push(r);
  }

  const total = records.length;
  const present = records.filter((r) => r.status === "present").length;
  const absent = records.filter((r) => r.status === "absent").length;
  const late = records.filter((r) => r.status === "late").length;
  const rate = attendanceRate(attendedCount({ present, late }), total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="출석부"
        description={`${formatKoreanDateLong(date)} · 반별 출결 입력`}
      />

      {saved ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="border-primary/30 bg-primary/5 text-primary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <CheckCircle2 className="size-4" />
            <span className="num">{saved}</span>건 저장됨
          </p>
          {/* 결석분 연결 실패 — 저장은 됐고 **메모만** 못 붙었다는 사실을 그대로 알린다(조용히 넘기면
              "연결한 줄 알았는데 아니었다"가 된다). 대개는 아직 결석 기록이 없는 선보강이다. */}
          {unlinked ? (
            <p className="border-amber/30 bg-amber/5 text-amber inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm break-keep">
              보강 <span className="num">{unlinked}</span>건은 그날 결석 기록이 없어 메모를 남기지 않았습니다
              (아직 결석 전이면 정상입니다)
            </p>
          ) : null}
          {/* 🔴 권한·기간·오류는 **원문 그대로** 알린다 — "결석을 못 찾았다"로 뭉치면 강사가 엉뚱한 곳을 본다. */}
          {linkError ? (
            <p className="border-danger/30 bg-danger/5 text-danger inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm break-keep">
              결석분 연결 실패 — {linkError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 휴원일 — 처리 현황(예정 인원·완료율·'완료')을 그리지 않는다. 입력된 기록은 아래 목록에 그대로 남는다. */}
      {holiday ? (
        <p className="border-line bg-bg-soft text-text-dim rounded-xl border px-4 py-3 text-sm break-keep" data-holiday-notice="">
          <span className="text-foreground font-bold">{holiday} — 휴원일</span>
          {" · "}학원설정에 등록된 휴일이라 예정 명단과 완료율을 만들지 않습니다.
          {records.length > 0 ? " 아래는 이 날 실제로 입력된 기록입니다." : ""}
        </p>
      ) : null}

      {/* 처리 현황 — 오늘 어느 반이 출결 미입력인지 추적(예정 학생 vs 기록). ijw DailyAttendance 이식. */}
      {processing.length > 0 ? (
        <section className="bg-card border-line space-y-4 rounded-2xl border p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow">처리 현황</p>
              <h2 className="text-foreground mt-0.5 text-base font-bold">오늘 출결 입력 추적</h2>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-text-dim">
                완료율{" "}
                <span className={`num font-bold ${overallRate >= 100 ? "text-primary" : "text-foreground"}`}>
                  {overallRate}%
                </span>
              </span>
              <span className="text-text-dim/40">·</span>
              <span className="text-text-dim">
                미처리 반{" "}
                <span className={`num font-bold ${pendingClasses.length > 0 ? "text-danger" : "text-primary"}`}>
                  {pendingClasses.length}
                </span>
                /{processing.length}
              </span>
            </div>
          </header>
          <ul className="divide-border divide-y">
            {processing.map((p) => (
              <li key={p.classId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.className}
                    <span className="text-text-dim ml-1.5 text-xs font-normal">
                      {subjectMaps.labelOf(p.subject)}
                      {p.teacherName ? ` · ${p.teacherName}` : ""}
                    </span>
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="bg-bg-soft h-1.5 w-32 overflow-hidden rounded-full">
                      <span
                        className={`block h-full ${p.unprocessed === 0 ? "bg-primary" : "bg-amber"}`}
                        style={{ width: `${p.rate}%` }}
                      />
                    </div>
                    <span className="text-text-faint num text-xs">
                      {p.recorded}/{p.expected}
                    </span>
                  </div>
                </div>
                {p.unprocessed > 0 ? (
                  <span className="text-danger bg-danger/10 border-danger/20 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium">
                    미처리 {p.unprocessed}
                  </span>
                ) : (
                  <span className="text-green shrink-0 text-xs">완료</span>
                )}
                <Link
                  href={`/attendance/${date}/${p.classId}`}
                  className="text-text-dim hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs"
                >
                  <Pencil className="size-3" />
                  입력
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {records.length === 0 && processing.length === 0 ? (
        <EmptyState
          image="attendance"
          icon={ClipboardCheck}
          title="이 날짜의 출석 기록이 없습니다"
          description={
            holiday
              ? "휴원일이라 예정 명단을 만들지 않았고, 입력된 출결도 없습니다. 이 날 수업을 했다면 월별 출석부에서 입력해 주세요."
              : "이 날짜에 예정된 수업이 없습니다. 다른 날짜를 선택해 주세요."
          }
        />
      ) : records.length === 0 ? null : (
        <>
          <div className="bg-card border-line grid grid-cols-2 gap-4 rounded-2xl border p-5 sm:grid-cols-4">
            <Summary label="전체" value={total} unit="건" />
            <Summary label="출석" value={present} unit="건" highlight="text-green" suffix={`${rate.toFixed(1)}%`} />
            <Summary label="결석" value={absent} unit="건" highlight="text-danger" />
            <Summary label="지각" value={late} unit="건" highlight="text-amber" />
          </div>

          {/* 반별로 접어 둔다(기본 접힘) — 117반/하루가 평면으로 쏟아지지 않게. 접힌 채로도
              결석·지각 칩으로 어느 반에 이상이 있는지 한눈에. 네이티브 <details>라 JS 0. */}
          <div className="space-y-3">
            {Array.from(groups.entries()).map(([classId, group]) => {
              const gAbsent = group.rows.filter((r) => r.status === "absent").length;
              const gLate = group.rows.filter((r) => r.status === "late").length;
              return (
                <details key={classId} className="bg-card border-line group overflow-hidden rounded-2xl border">
                  <summary className="hover:bg-bg-soft/40 flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <h3 className="text-sm font-bold">{group.className}</h3>
                      <p className="text-text-dim num text-xs">
                        {subjectMaps.labelOf(group.subject)} · {group.rows.length}명
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {gAbsent > 0 ? (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR.absent}`}>
                          결석 {gAbsent}
                        </span>
                      ) : null}
                      {gLate > 0 ? (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR.late}`}>
                          지각 {gLate}
                        </span>
                      ) : null}
                      {gAbsent === 0 && gLate === 0 ? (
                        <span className="text-green text-xs">전원 출석</span>
                      ) : null}
                      <ChevronRight className="text-text-faint size-3 transition group-open:rotate-90" />
                    </div>
                  </summary>
                  <div className="border-line border-t">
                    <div className="border-line flex justify-end border-b px-5 py-2">
                      <Link
                        href={`/attendance/${date}/${classId}`}
                        className="text-text-dim hover:text-foreground inline-flex items-center gap-1.5 text-xs"
                      >
                        <Pencil className="size-3" />
                        출석 입력
                      </Link>
                    </div>
                    <ul className="divide-border divide-y">
                      {group.rows.map((row) => (
                        <li key={row.id} className="flex items-center justify-between px-5 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium">{row.studentName}</span>
                            {row.studentGrade ? (
                              <span className="text-text-dim text-xs">{row.studentGrade}</span>
                            ) : null}
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                              STATUS_COLOR[row.status] ?? "bg-bg-soft text-text-dim border-line"
                            }`}
                          >
                            {STATUS_LABEL[row.status] ?? row.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  unit,
  highlight,
  suffix,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-bold ${highlight ?? ""}`}>
        {value}
        <span className="text-text-dim ml-0.5 text-xs font-normal">{unit}</span>
        {suffix ? <span className="text-text-dim ml-2 text-xs font-normal">{suffix}</span> : null}
      </p>
    </div>
  );
}
