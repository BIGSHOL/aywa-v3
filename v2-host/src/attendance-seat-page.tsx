// 2.0 `src/app/(shell)/attendance/seat/[seat]/page.tsx`(자리 출석부 — 랩실·JJ실 하루 한 장)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 변수 이름.
// page.tsx는 서버 부품(세션·DB)이라 그대로 불러올 수 없어서, 서버가 하던 조회·판정은 /api/v2/attendance?v2path=/attendance/seat/<자리>
// (v2-attendance-seat.mjs)가 page.tsx와 같은 값으로 내려 주고, 여기서는 page.tsx의 JSX를 그 값으로 그대로 그린다.
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from '@/components/toolbar-controls';
import { PeriodNav } from '@/components/period-nav';
import { TextbookOptionsProvider } from '@/features/textbooks/textbook-options-context';
import type { SeatKey } from '@/features/attendance/seat/seat';
import { SeatBoard } from '@/app/(shell)/attendance/seat/[seat]/_components/seat-board';
import { SeatAllDay } from '@/app/(shell)/attendance/seat/[seat]/_components/seat-all-day';
import { SeatJjAllDay } from '@/app/(shell)/attendance/seat/[seat]/_components/seat-jj-all-day';
import { MemorizedPullButton } from '@/app/(shell)/attendance/seat/[seat]/_components/memorized-pull-button';

/** /api/v2/attendance(자리 하루)가 내려 주는 값 — 이름은 page.tsx의 지역 변수 그대로. props는 고른 부품에 넘기는 값 그대로. */
export type SeatDayData = {
  page: 'seatDay';
  seat: SeatKey; seatName: string; seatRoom: string; date: string; today: string; dateLabel: string; prevDate: string; nextDate: string;
  usableSeats: { key: SeatKey; name: string }[]; readOnly: boolean; ijwReady: boolean;
  textbookOptions: ComponentProps<typeof TextbookOptionsProvider>['options'];
  editors: { id: string; name: string; role: string }[]; viewer: string | null;
} & (
  | { view: 'empty'; props: null }
  | { view: 'lab'; props: ComponentProps<typeof SeatAllDay> }
  | { view: 'jjAll'; props: ComponentProps<typeof SeatJjAllDay> }
  | { view: 'board'; props: ComponentProps<typeof SeatBoard> }
);

export function AttendanceSeatPage({ data }: { data: SeatDayData }) {
  const d = data, seat = d.seat, date = d.date, today = d.today, readOnly = d.readOnly;
  const href = (q: { date?: string; start?: string }) => {
    const sp = new URLSearchParams();
    sp.set('date', q.date ?? date);
    if (q.start) sp.set('start', q.start);
    return `/attendance/seat/${seat}?${sp.toString()}`;
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TextbookOptionsProvider options={d.textbookOptions}>
      <PageHeader
        eyebrow="출석부"
        title={`${d.seatName} ${d.seatRoom}`}
        embedLabel={d.seatName}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href="/attendance" className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} mr-1`}>
              출석부로
            </Link>
            <Link href={`/attendance/seat/${seat}/month?month=${date.slice(0, 7)}`} className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} mr-1`}>
              월간
            </Link>
            {d.usableSeats.length > 1 ? (
              <div className={`${TOOLBAR_SEG_BOX} mr-1`}>
                {d.usableSeats.map((k) => (
                  <Link key={k.key} href={`/attendance/seat/${k.key}?date=${date}`}
                    className={`${TOOLBAR_SEG_ITEM} ${k.key === seat ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}>
                    {k.name}
                  </Link>
                ))}
              </div>
            ) : null}
            {seat === 'jj' && !readOnly && d.ijwReady ? <MemorizedPullButton seat={seat} date={date} /> : null}
            <PeriodNav
              label={d.dateLabel}
              prevHref={href({ date: d.prevDate, start: undefined })}
              nextHref={href({ date: d.nextDate, start: undefined })}
              currentHref={href({ date: today, start: undefined })}
              relation={date === today ? 'current' : date < today ? 'past' : 'future'}
              prevAriaLabel="이전 날"
              nextAriaLabel="다음 날"
              currentTitle="눌러서 오늘로"
              labelWidth={140}
            />
          </div>
        }
      />
      {d.view === 'empty' ? (
        <EmptyState image="students" title={`이 날은 ${d.seatName} 수업이 없습니다`} description="날짜를 옮기거나 시간표에서 자리 배치를 확인하세요." />
      ) : d.view === 'lab' ? (
        <SeatAllDay key={`${seat}|${date}`} {...d.props} />
      ) : d.view === 'jjAll' ? (
        <SeatJjAllDay key={`${seat}|${date}`} {...d.props} />
      ) : (
        <SeatBoard key={`${seat}|${date}|${d.props.activeStart}`} {...d.props} />
      )}
      </TextbookOptionsProvider>
    </div>
  );
}
