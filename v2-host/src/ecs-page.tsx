// 2.0 `src/app/(shell)/ecs/**/page.tsx`(서버 부품)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 2.0 함수·같은 문구 키.
// 서버가 하던 조회만 /api/v2/ecs(복사본)의 props로 바꾸고, 머리글·툴바·본문 배치는 page.tsx 순서 그대로 옮겼다.
//  · EcsLandingPage = ecs/page.tsx 주간 면 · EcsSheetPage = [classId]/page.tsx · EcsMonthPage = [classId]/month/page.tsx
//  · 아직 옮기지 않은 면(오늘 · JJ실 · 반 계획 보기 · 계획 대비 현황)은 같은 머리글·면 탭 아래에 '아직'이라고 정직하게 말한다.
// 2.0 page.tsx에 있는데 여기 없는 것: 오늘 출석 미입력 스트립·내 할 일 줄(오늘 면 전용 서버 부품), ModuleBoundary(영어 강사 시트 모듈이 켜진 학원만 이 화면이 있다).
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/page-header';
import { ToolbarButton } from '@/components/toolbar';
import { addDays } from '@/lib/date-kst';
import { monthDay } from '@/features/timetable/scheduled-import';
import { WeekNav } from '@/app/(shell)/timetable/_components/week-nav';
import { ENGLISH_TRACK_FILTER_LABEL } from '@/features/classes/english-track';
import { sheetT, sheetWeekLabel, type SheetLang } from '@/features/teacher-view/i18n';
import { SheetClient } from '@/features/class-sheets/components/sheet-client';
import { MonthClient } from '@/features/class-sheets/components/month-client';
import { SheetWidthGate } from '@/features/class-sheets/components/sheet-width-gate';
import { TextbookOptionsProvider, type TextbookOptionItem } from '@/features/textbooks/textbook-options-context';
import { EcsLandingList } from '@/app/(shell)/ecs/_components/landing-list';
import { EcsTeacherFilter } from '@/app/(shell)/ecs/_components/teacher-filter';
import { EcsTrackFilter } from '@/app/(shell)/ecs/_components/track-filter';
import { EcsFaceTabs } from '@/app/(shell)/ecs/_components/today-nav';

type SheetProps = ComponentProps<typeof SheetClient>;
type MonthProps = ComponentProps<typeof MonthClient>;
type LandingProps = ComponentProps<typeof EcsLandingList>;
type Fail = { ok: false; error: string };
/** 2.0 `getSheetLanding`의 성공 모양(queries.ts) — 부품 props에서 거꾸로 읽는다(타입 파일은 서버 모듈이라 불러오지 않는다). */
export type LandingRes = Fail | {
  ok: true; weekMonday: string; weekLabel: string; today: string; cards: LandingProps['cards']; landingOrder: string[];
  emptyReason: 'not-configured' | 'no-scoped-classes' | 'no-classes' | 'filtered' | 'no-week-classes' | null;
  trackFilter: ComponentProps<typeof EcsTrackFilter>['value']; trackCounts: ComponentProps<typeof EcsTrackFilter>['counts'];
  teacherFilter: string; teacherOptions: ComponentProps<typeof EcsTeacherFilter>['options'];
};
export type LandingData = { res: LandingRes; eieOn: boolean; textbooksOn: boolean; canReorder: boolean; viewerTeacherId: string | null; viewerName: string | null };
export type SheetData = { res: Fail | { ok: true; data: SheetProps['data'] }; classOptions?: SheetProps['classOptions']; userId?: string; tenantId?: string; textbookOptions?: TextbookOptionItem[] };
export type MonthData = { res: Fail | { ok: true; data: MonthProps['data'] }; mpChrome?: MonthProps['mpChrome']; classOptions?: MonthProps['classOptions']; initialView?: MonthProps['initialView'];
  fromWeek?: string | null; textbooksOn?: boolean; textbookOptions?: TextbookOptionItem[] };

/** 2.0 ecs/page.tsx `ecsMathHint` — 담당 영어 반이 0개일 때 갈 곳(수학 강사 시트)을 적는다. */
const ecsMathHint = (lang: SheetLang) => (
  <>
    {sheetT(lang, 'landing.empty.noScoped.before')}{' '}
    <Link href="/mcs" className="text-primary font-bold underline underline-offset-2">{sheetT(lang, 'landing.empty.noScoped.link')}</Link>
    {sheetT(lang, 'landing.empty.noScoped.after')}
  </>
);

/** 2.0 ecs/page.tsx — 주간 면(반 목록). 원문 JSX 순서 그대로. */
export function EcsLandingPage({ landing, scoped, lang }: { landing: LandingData; scoped: boolean; lang: SheetLang }) {
  const res = landing.res;
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sheetT(lang, 'landing.eyebrow')} title={sheetT(lang, 'landing.title')} description={sheetT(lang, 'landing.desc')} />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const weekText = sheetWeekLabel(res.weekMonday, res.weekLabel, lang);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={sheetT(lang, 'landing.eyebrow')} title={sheetT(lang, 'landing.title')} description={`${sheetT(lang, 'landing.desc')} · ${weekText}`} embedLabel={`${sheetT(lang, 'landing.title')} · ${weekText}`} />
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <EcsFaceTabs face="week" showToday={scoped} lang={lang} />
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(monday) => `/ecs?view=week&week=${monday}`} />
        {landing.eieOn ? <EcsTrackFilter value={res.trackFilter} counts={res.trackCounts} /> : null}
        <EcsTeacherFilter value={res.teacherFilter} options={res.teacherOptions} totalCount={res.trackCounts[res.trackFilter]} />
        {res.trackCounts.injaewon > 0 ? (
          <ToolbarButton href={`/ecs/goals?date=${res.today >= res.weekMonday && res.today <= addDays(res.weekMonday, 6) ? res.today : res.weekMonday}`} className="ml-auto">
            {sheetT(lang, 'goals.title')}
          </ToolbarButton>
        ) : null}
        {landing.textbooksOn ? (
          <ToolbarButton href="/ecs/plan-gap" className={res.trackCounts.injaewon > 0 ? undefined : 'ml-auto'}>{sheetT(lang, 'gap.title')}</ToolbarButton>
        ) : null}
      </div>
      {res.cards.length === 0 ? (
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {res.emptyReason === 'filtered'
            ? `${sheetT(lang, 'landing.empty.filtered.prefix')} '${res.trackFilter === 'all' ? sheetT(lang, 'filter.all') : ENGLISH_TRACK_FILTER_LABEL[res.trackFilter]}'${sheetT(lang, 'landing.empty.filtered.suffix')}${res.trackCounts.all}${sheetT(lang, 'landing.empty.filtered.tail')}`
            : res.emptyReason === 'no-week-classes'
              ? sheetT(lang, 'landing.empty.noWeekClasses')
              : res.emptyReason === 'no-scoped-classes'
                ? ecsMathHint(lang)
                : res.emptyReason === 'not-configured'
                  ? sheetT(lang, 'landing.empty.notConfigured')
                  : sheetT(lang, 'landing.empty.none')}
        </p>
      ) : (
        <EcsLandingList cards={res.cards} weekMonday={res.weekMonday} lang={lang} viewerTeacherId={landing.viewerTeacherId} viewerName={landing.viewerName} landingOrder={res.landingOrder} canReorder={landing.canReorder} />
      )}
    </div>
  );
}

/** 2.0 [classId]/page.tsx·month/page.tsx의 실패 갈래 — 같은 머리글 + 사유 + 반 목록으로. */
function FailedSheet({ title, description, error }: { title: string; description: string; error: string }) {
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="수업 운영" title={title} description={description} />
      <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
        <p className="text-text-dim">{error}</p>
        <Link href="/ecs" className="text-primary font-bold underline-offset-2 hover:underline">반 목록으로</Link>
      </div>
    </div>
  );
}

/** 2.0 [classId]/page.tsx — 반 주간 시트. */
export function EcsSheetPage({ sheet }: { sheet: SheetData }) {
  const { res } = sheet;
  if (!res.ok) return <FailedSheet title="영어 강사 시트" description="영어 반별 주간 수업계획서/출석부" error={res.error} />;
  const d = res.data;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`영어 강사 시트 — ${d.className}`}
          description={[d.weekLabel, `계획 ${d.fill.filledSlots}/${d.fill.totalSlots}교시`, d.classNameUpcoming ? `${monthDay(d.classNameUpcoming.date)}부터 ${d.className} → ${d.classNameUpcoming.name}` : null].filter(Boolean).join(' · ')}
        />
      </div>
      <SheetWidthGate>
        <TextbookOptionsProvider options={sheet.textbookOptions ?? []}>
          <SheetClient key={`${d.classId}:${d.weekMonday}:${d.showSelfStudy ? 'jj' : 'nojj'}`} data={d} classOptions={sheet.classOptions ?? []} userId={sheet.userId ?? ''} tenantId={sheet.tenantId ?? ''} />
        </TextbookOptionsProvider>
      </SheetWidthGate>
    </div>
  );
}

/** 2.0 [classId]/month/page.tsx — 월간(달력 · 진도표 · EiE 계획). */
export function EcsMonthPage({ month }: { month: MonthData }) {
  const { res } = month;
  if (!res.ok) return <FailedSheet title="영어 강사 시트 · 월간" description="반별 월간 진도" error={res.error} />;
  const d = res.data;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader eyebrow="수업 운영" title={`영어 강사 시트 · 월간 — ${d.className}`} description={`${d.monthLabel} · 계획 ${d.fill.filled}/${d.fill.total}교시`} />
      </div>
      <SheetWidthGate>
        <TextbookOptionsProvider options={month.textbookOptions ?? []}>
          <MonthClient key={`${d.classId}:${d.month}:${d.period.start}~${d.period.end}`} data={d} mpChrome={month.mpChrome ?? null} classOptions={month.classOptions ?? []}
            initialView={month.initialView ?? d.view} initialDisplay={d.display} fromWeek={month.fromWeek ?? null} textbooksOn={month.textbooksOn ?? false} />
        </TextbookOptionsProvider>
      </SheetWidthGate>
    </div>
  );
}

/** 아직 옮기지 않은 면 — 2.0과 같은 머리글·면 탭 아래 한 줄(빈 화면으로 두지 않는다). */
export function EcsNotYetPage({ route, scoped, lang }: { route: 'today' | 'room' | 'goals' | 'gap'; scoped: boolean; lang: SheetLang }) {
  const face = route === 'today' ? 'today' : route === 'room' ? 'room' : null;
  const title = route === 'goals' ? sheetT(lang, 'goals.title') : route === 'gap' ? sheetT(lang, 'gap.title') : sheetT(lang, 'landing.title');
  const what = route === 'today' ? "'오늘' 면" : route === 'room' ? "'JJ실' 면" : `'${title}'`;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={sheetT(lang, 'landing.eyebrow')} title={title} description={sheetT(lang, 'landing.desc')} />
      {face ? (
        <div className="flex flex-wrap items-center gap-3 px-1 py-1"><EcsFaceTabs face={face} showToday={scoped} lang={lang} /></div>
      ) : null}
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        {what}은(는) 이 연습 화면에 아직 옮기지 않았습니다. <Link href="/ecs?view=week" className="text-primary font-bold underline underline-offset-2">주간 반 목록</Link>에서 반을 열어 주간 시트·월간을 볼 수 있습니다.
      </p>
    </div>
  );
}
