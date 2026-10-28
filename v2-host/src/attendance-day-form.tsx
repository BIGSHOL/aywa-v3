// 2.0 일별 입력 page.tsx의 JSX. 서버 조회만 /api/v2/attendance로 옮긴다.
import type { ComponentProps } from 'react';
import { formatKoreanDateLong } from '@/lib/date-kst';
import { BackLink } from '@/components/back-link';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { AttendanceInputForm } from '@/app/(shell)/attendance/[date]/[classId]/input-form';

export type DayFormData = { page: 'dayForm'; date: string; classId: string; klass: { className: string; subject: string; teacherName: string | null };
  rows: ComponentProps<typeof AttendanceInputForm>['rows']; autoUnits: number | null; locked: boolean;
  editors: { id: string; name: string; role: string }[]; viewer: string | null;
  host: { operations: { subjects: Parameters<typeof buildSubjectMaps>[0] } } };

export function AttendanceDayForm({ data }: { data: DayFormData }) {
  const { date, classId, klass, rows, locked, autoUnits } = data;
  const subjectMaps = buildSubjectMaps(data.host.operations.subjects);
  return (
    <div className="w-full min-w-0 space-y-6">
      <BackLink href={`/attendance/${date}`} label={`${formatKoreanDateLong(date)}로`} />

      <header className="border-line space-y-1 border-b pb-5">
        <p className="eyebrow">{formatKoreanDateLong(date)}</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{klass.className}</h1>
        <p className="text-text-dim text-sm">
          {subjectMaps.labelOf(klass.subject)}
          {klass.teacherName ? ` · 담임 ${klass.teacherName}` : ""} · 재원생{" "}
          {/* 보강(수업외) 행은 이 반 수강생이 아니라 '재원생' 수에 넣지 않는다 — 넣으면 명단 규모가 부풀어 보인다. */}
          <span className="num">{rows.filter((r) => !r.isMakeup).length}</span>명
        </p>
      </header>

      {locked ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-2xl border px-4 py-2.5 text-sm break-keep">
          {locked}
        </p>
      ) : null}
      <AttendanceInputForm classId={classId} date={date} rows={rows} locked={!!locked} autoUnits={autoUnits} />
    </div>
  );
}
