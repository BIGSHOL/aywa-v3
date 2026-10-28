// 2.0 `src/app/(shell)/attendance/seat/[seat]/month/page.tsx`(자리 월간 출석부)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 변수 이름.
// 서버가 하던 조회(`getSeatMonthly` · `loadSeatMonthlyPrefs`)는 /api/v2/attendance?v2path=/attendance/seat/<자리>/month(v2-attendance-seat.mjs)가 내려 준다.
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from '@/components/toolbar-controls';
import { PeriodNav } from '@/components/period-nav';
import { buildHolidayMap } from '@/features/attendance/calendar';
import type { SeatKey } from '@/features/attendance/seat/seat';
import type { SeatMonthlyView } from '@/features/attendance/seat/monthly-view';
import { CollapseAllChip } from '@/app/(shell)/attendance/_components/class-group';
import { SeatMonthlyCollapse } from '@/app/(shell)/attendance/seat/[seat]/month/_components/collapse-provider';
import { MonthlyLegend, MonthlySummary } from '@/app/(shell)/attendance/seat/[seat]/month/_components/monthly-summary';
import { MonthlyTable } from '@/app/(shell)/attendance/seat/[seat]/month/_components/monthly-table';
import { MonthlyPrintButton } from '@/app/(shell)/attendance/seat/[seat]/month/_components/print-button';

export type SeatMonthData = {
  page: 'seatMonth';
  seat: SeatKey; seatName: string; seatRoom: string; month: string; currentMonth: string; monthLabel: string; prevMonth: string; nextMonth: string;
  view: SeatMonthlyView; collapsed: string[];
  editors: { id: string; name: string; role: string }[]; viewer: string | null;
};

/** 2.0 month/page.tsx — 아직 열지 않은 자리(`parseUsableSeatKey` 밖) 안내. */
export function AttendanceSeatMonthClosed({ seatName }: { seatName: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader eyebrow="출석부" title={`${seatName} 월간`} description="아직 열지 않은 자리입니다"
        actions={<Link href="/attendance" className="border-line hover:bg-bg-soft rounded-full border px-2.5 py-0.5 text-xs">출석부로</Link>} />
      <EmptyState image="students" title={`${seatName} 월간 출석부는 아직 열지 않았습니다`}
        description="이 자리 수업은 지금 담임 시수로 잡혀 있습니다. 자리 시수로 옮길지 정한 뒤 열면 그때부터 집계합니다." />
    </div>
  );
}

/** `holidaySource` = 학원 설정 operations.holidays(2.0 page.tsx `buildHolidayMap(settings.operations.holidays)`). */
export function AttendanceSeatMonth({ data, holidaySource }: { data: SeatMonthData; holidaySource: Parameters<typeof buildHolidayMap>[0] }) {
  const d = data, seat = d.seat, month = d.month, view = d.view;
  const holidays = buildHolidayMap(holidaySource);
  const href = (m: string) => `/attendance/seat/${seat}/month?month=${m}`;
  return (
    <SeatMonthlyCollapse classIds={view.groups.map((g) => g.classId)} initial={d.collapsed}>
      <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
        <PageHeader
          eyebrow="출석부"
          title={`${d.seatName} ${d.seatRoom} 월간`}
          embedLabel={`${d.seatName} 월간 · ${d.monthLabel}`}
          description={view.window.label}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={`/attendance/seat/${seat}`} className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`}>하루</Link>
              <Link href="/attendance" className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`}>출석부로</Link>
              <MonthlyPrintButton seat={seat} month={month} title={`${d.seatName} ${d.monthLabel}`} />
              <PeriodNav
                label={d.monthLabel}
                prevHref={href(d.prevMonth)}
                nextHref={href(d.nextMonth)}
                currentHref={href(d.currentMonth)}
                relation={month === d.currentMonth ? 'current' : month < d.currentMonth ? 'past' : 'future'}
                prevAriaLabel="이전 달"
                nextAriaLabel="다음 달"
                currentTitle="눌러서 이번 달로"
              />
              {view.groups.length > 0 ? <CollapseAllChip classIds={view.groups.map((g) => g.classId)} /> : null}
            </div>
          }
        />
        <div className="bg-card shadow-card shrink-0 space-y-1.5 rounded-2xl px-4 py-2.5">
          <MonthlySummary summary={view.summary} minutesPerSlot={view.minutesPerSlot} />
          <MonthlyLegend />
        </div>
        {view.groups.length === 0 || view.summary.studentCount === 0 ? (
          <EmptyState image="students" title={`이 기간에 ${d.seatName} 수업이 없습니다`} description="달을 옮기거나 시간표에서 자리 배치를 확인하세요." />
        ) : (
          <div className="isolate min-h-0 flex-1">
            <MonthlyTable seat={seat} view={view} holidays={holidays} />
          </div>
        )}
      </div>
    </SeatMonthlyCollapse>
  );
}
