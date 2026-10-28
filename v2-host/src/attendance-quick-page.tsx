// 2.0 `src/app/(shell)/attendance/quick/page.tsx`(출결 모드 — 오늘 고정 · 내 수업만)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 변수 이름.
// page.tsx는 서버 부품(세션·DB)이라, 서버가 하던 조회(getLiveBoard(오늘, selfOnly) · 휴원일 · getHolidayDayActivity)는
// /api/v2/attendance?v2path=/attendance/quick(v2-attendance-live.mjs)이 같은 값으로 내려 주고, 여기서는 page.tsx의 JSX를 그대로 그린다.
import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmbedLink } from '@/components/embed-link';
import { EmptyState } from '@/components/empty-state';
import { CalendarDays } from '@/components/icons/aywa-icon-compat';
import { formatKoreanDate } from '@/lib/date-kst';
import { HolidayActivityPanel } from '@/features/attendance/live/components/holiday-activity-panel';
import { buildSubjectMaps } from '@/features/owner/subjects';
import { classNameFor } from '@/features/teacher-view/class-name';
import { sheetDateLabel, sheetT, sheetTf, type SheetLang } from '@/features/teacher-view/i18n';
import { QuickBoard } from '@/features/attendance/quick/components/quick-board';

/** /api/v2/attendance(출결 모드)가 내려 주는 값 — 이름은 page.tsx의 지역 변수 그대로. */
export type QuickData = {
  page: 'quick';
  date: string; lang: SheetLang; homeHref: string;
  editors: { id: string; name: string; role: string }[]; viewer: string | null;
} & (
  | { view: 'board'; classes: ComponentProps<typeof QuickBoard>['classes']; canEdit: boolean }
  | { view: 'holiday'; holiday: string; activity: ComponentProps<typeof HolidayActivityPanel>['activity'] }
);

export function AttendanceQuickPage({ data, subjects }: { data: QuickData; subjects: Parameters<typeof buildSubjectMaps>[0] }) {
  const today = data.date, lang = data.lang, homeHref = data.homeHref;
  if (data.view === 'holiday') {
    const holiday = data.holiday, activity = data.activity;
    return (
      <div className="space-y-4">
        <Header date={today} lang={lang} homeHref={homeHref} />
        <EmptyState
          icon={CalendarDays}
          title={sheetTf(lang, 'quick.holiday.title', { name: holiday })}
          description={sheetT(lang, 'quick.holiday.desc')}
          action={
            <EmbedLink href={`/attendance?month=${today.slice(0, 7)}`} className="text-primary text-sm font-bold underline underline-offset-2">
              {sheetT(lang, 'quick.holiday.monthly')}
            </EmbedLink>
          }
        />
        <HolidayActivityPanel
          activity={activity}
          date={today}
          lang={lang}
          labelOf={buildSubjectMaps(subjects).labelOf}
          classNameOf={(name) => classNameFor(name, lang)}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Header date={today} lang={lang} homeHref={homeHref} />
      <QuickBoard date={today} classes={data.classes} canEdit={data.canEdit} />
    </div>
  );
}

function Header({ date, lang, homeHref }: { date: string; lang: SheetLang; homeHref: string }) {
  const label = sheetDateLabel(date, formatKoreanDate(date), lang);
  return (
    <PageHeader
      eyebrow={sheetT(lang, 'quick.eyebrow')}
      title={sheetT(lang, 'quick.title')}
      description={sheetTf(lang, 'quick.header.desc', { date: label })}
      embedLabel={sheetTf(lang, 'quick.embed', { date: label })}
      actions={<Button render={<EmbedLink href={homeHref} />}>{sheetT(lang, 'quick.exit')}</Button>}
    />
  );
}
