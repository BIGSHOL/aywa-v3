// 2.0 `src/app/(shell)/attendance/live/page.tsx`(오늘 출결 — 좌석표 · 확인 필요 · 어제 출결)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 변수 이름.
// page.tsx는 서버 부품(세션·DB)이라, 서버가 하던 조회(getLiveBoard · getDeskQueue · getCarryOverAbsences · getRangeRecap · getSavedRecapBrief ·
// loadLiveViewPrefs · getHolidayDayActivity)는 /api/v2/attendance?v2path=/attendance/live(v2-attendance-live.mjs)가 같은 값으로 내려 주고,
// 여기서는 page.tsx의 JSX를 그대로 그린다. 좌석표 보드의 연락처는 서버가 이미 지웠다(page.tsx `stripContacts`와 같은 자리 — 페이로드에 안 싣는다).
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { CalendarDays } from '@/components/icons/aywa-icon-compat';
import { HolidayActivityPanel } from '@/features/attendance/live/components/holiday-activity-panel';
import { buildSubjectMaps } from '@/features/owner/subjects';
import type { LiveBoard } from '@/features/attendance/live/types';
import { SeatingChart } from '@/features/attendance/live/components/seating-chart';
import { DeskView } from '@/app/(shell)/attendance/live/_components/desk-view';
import { RecapView } from '@/app/(shell)/attendance/live/_components/recap-view';
import { LiveDatePicker } from '@/app/(shell)/attendance/live/_components/live-date-picker';
import { LiveRefresher } from '@/app/(shell)/attendance/live/_components/live-refresher';
import { AbsenceIntakeButton } from '@/app/(shell)/attendance/_components/absence-intake-button';

/** /api/v2/attendance(오늘 출결)가 내려 주는 값 — 이름은 page.tsx의 지역 변수 그대로. */
export type LiveData = {
  page: 'live';
  date: string; today: string; tab: 'seating' | 'desk' | 'recap'; recapHref: string; isDesk: boolean; holiday: string | null; scopedToSelf: boolean;
  board: LiveBoard | null; canEdit: boolean;
  queue: ComponentProps<typeof DeskView>['queue'] | null; carryOver: ComponentProps<typeof DeskView>['carryOver'];
  recap: ComponentProps<typeof RecapView>['recap'] | null; recapAi: ComponentProps<typeof RecapView>['ai'];
  prefs: { subject: string }; holidayActivity: ComponentProps<typeof HolidayActivityPanel>['activity'];
  editors: { id: string; name: string; role: string }[]; viewer: string | null;
};

export function AttendanceLivePage({ data, subjects }: { data: LiveData; subjects: Parameters<typeof buildSubjectMaps>[0] }) {
  const { date, today, tab, recapHref, isDesk, holiday, board, queue, carryOver, recap, prefs } = data;
  const recapAi = data.recapAi, holidayActivity = data.holidayActivity;
  const pending = queue ? queue.counts.students + queue.counts.classes : 0;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="출결"
        title="오늘 출결"
        description={
          <LiveDatePicker
            date={date}
            today={today}
            tab={tab}
            hint={data.scopedToSelf ? '내 수업' : '전체'}
          />
        }
        embedLabel={<LiveDatePicker date={date} today={today} tab={tab} />}
        actions={isDesk ? <AbsenceIntakeButton today={today} /> : null}
      />

      {holiday && tab !== 'recap' ? (
        <>
          <EmptyState
            icon={CalendarDays}
            title={`${holiday} — 휴원일`}
            description="학원설정에 등록된 휴일이라 예정 명단과 확인 큐를 만들지 않습니다. 이 날 수업을 했다면 출결은 월별 출석부에서 입력합니다."
          />
          <HolidayActivityPanel
            activity={holidayActivity ?? null}
            date={date}
            labelOf={buildSubjectMaps(subjects).labelOf}
          />
        </>
      ) : (
        <>

          {isDesk && (
            <nav className="border-line flex gap-1 border-b" aria-label="보기 전환">
              <TabLink active={tab === 'seating'} href={`/attendance/live?date=${date}`} label="좌석표" />
              <TabLink active={tab === 'desk'} href={`/attendance/live?tab=desk&date=${date}`} label="확인 필요" count={pending ? String(pending) : undefined} alert={pending > 0} />
              <TabLink active={tab === 'recap'} href={recapHref} label="어제 출결" />
            </nav>
          )}

          {tab === 'recap' ? (
            recap ? (
              <RecapView
                recap={recap}
                isToday={date === today}
                ai={recapAi}
                initialSubject={prefs.subject}
              />
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="요약을 불러오지 못했습니다"
                description="잠시 후 다시 열어 주세요. 계속되면 관리자에게 문의해 주세요."
              />
            )
          ) : tab === 'desk' && queue ? (
            <DeskView
              queue={queue}
              date={date}
              canEdit={board?.canEdit ?? false}
              carryOver={carryOver}
              initialSubject={prefs.subject}
            />
          ) : board ? (
            <SeatingChart board={board} initialSubject={prefs.subject} />
          ) : null}

          {date === today && <LiveRefresher date={date} />}
        </>
      )}
    </div>
  );
}

// ── PORTED: 2.0 page.tsx `TabLink` 원문 그대로(서버 부품 파일 안의 지역 함수라 불러올 수 없다). verify가 원문과 비교한다. ──
function TabLink({
  active,
  href,
  label,
  count,
  alert,
}: {
  active: boolean;
  href: string;
  label: string;
  count?: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
        active ? "border-primary text-primary" : "text-text-dim hover:text-foreground border-transparent"
      }`}
    >
      {label}
      {count && (
        <span
          className={`num ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
            alert ? "bg-danger text-white" : "bg-bg-soft text-text-dim"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
// ── PORTED 끝 ──
