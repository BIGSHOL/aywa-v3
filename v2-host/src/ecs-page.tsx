// 2.0 `src/app/(shell)/ecs/**/page.tsx`(서버 부품)의 화면 조립을 브라우저에서 — 같은 2.0 부품·같은 2.0 함수·같은 문구 키.
// 서버가 하던 조회만 /api/v2/ecs(복사본)의 props로 바꾸고, 머리글·툴바·본문 배치는 page.tsx 순서 그대로 옮겼다.
//  · EcsLandingPage = ecs/page.tsx 주간 면 · EcsSheetPage = [classId]/page.tsx · EcsMonthPage = [classId]/month/page.tsx
//  · 아직 옮기지 않은 면(오늘 · JJ실 · 반 계획 보기 · 계획 대비 현황)은 같은 머리글·면 탭 아래에 '아직'이라고 정직하게 말한다.
// 2.0 page.tsx에 있는데 여기 없는 것: 오늘 출석 미입력 스트립·내 할 일 줄(오늘 면 전용 서버 부품), ModuleBoundary(영어 강사 시트 모듈이 켜진 학원만 이 화면이 있다).
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/page-header';
import { BigStat } from '@/components/atoms/big-stat';
import { Toolbar, ToolbarButton } from '@/components/toolbar';
import { addDays, formatKoreanDate, monthLabel, shiftMonth } from '@/lib/date-kst';
import { PeriodNav } from '@/components/period-nav';
import { TONE_SOFT, TONE_TEXT } from '@/lib/design/semantic-color';
import { matchRate, VERDICT_TONE, type CompareTally, type CellVerdict } from '@/features/textbooks/plan-compare';
import { teacherNameFor } from '@/features/teacher-view/teacher-name';
import { mondayOf } from '@/features/timetable/lib/week';
import { countGoalCells, GOAL_STATE_DOT } from '@/features/class-sheets/lib/goals-board';
import { monthDay } from '@/features/timetable/scheduled-import';
import { WeekNav } from '@/app/(shell)/timetable/_components/week-nav';
import { ENGLISH_TRACK_FILTER_LABEL } from '@/features/classes/english-track';
import { sheetDateLabelEn, sheetMonthLabel, sheetT, sheetTf, sheetWeekLabel, type SheetDictKey, type SheetLang } from '@/features/teacher-view/i18n';
import { SheetClient } from '@/features/class-sheets/components/sheet-client';
import { MonthClient } from '@/features/class-sheets/components/month-client';
import { SheetWidthGate } from '@/features/class-sheets/components/sheet-width-gate';
import { TextbookOptionsProvider, type TextbookOptionItem } from '@/features/textbooks/textbook-options-context';
import { EcsLandingList } from '@/app/(shell)/ecs/_components/landing-list';
import { EcsTeacherFilter } from '@/app/(shell)/ecs/_components/teacher-filter';
import { EcsTrackFilter } from '@/app/(shell)/ecs/_components/track-filter';
import { EcsFaceTabs } from '@/app/(shell)/ecs/_components/today-nav';
import { GoalsPeriodBar } from '@/app/(shell)/ecs/goals/_components/goals-period-bar';
import { GoalsRoleSwitch } from '@/app/(shell)/ecs/goals/_components/goals-role-switch';
import { GoalsTable } from '@/app/(shell)/ecs/goals/_components/goals-table';
import { EcsSeatDayFace } from '@/features/class-sheets/components/seat-day-face';

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

type GoalsTableProps = ComponentProps<typeof GoalsTable>;
/** 2.0 `getGoalsBoard`의 반환(goals-board.ts) — 부품 props에서 거꾸로 읽는다(서버 모듈이라 타입도 불러오지 않는다). */
export type GoalsData = {
  res: Fail | {
    ok: true; date: string; weekMonday: string; weekLabel: string; monthStart: string; today: string; role: GoalsTableProps['role']; canEdit: boolean;
    view: ComponentProps<typeof GoalsPeriodBar>['view']; areas: GoalsTableProps['areas']; rows: GoalsTableProps['rows'];
  };
  names: GoalsTableProps['teacherNames'];
};

/** 2.0 ecs/goals/page.tsx — 반 계획 보기. 원문 JSX 순서 그대로. */
export function EcsGoalsPage({ goals, lang }: { goals: GoalsData; lang: SheetLang }) {
  const res = goals.res;
  const title = sheetT(lang, 'goals.title');
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sheetT(lang, 'landing.title')} title={title} />
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const weekText = sheetWeekLabel(res.weekMonday, res.weekLabel, lang);
  const monthText = sheetMonthLabel(res.monthStart.slice(0, 7), `${Number(res.monthStart.slice(5, 7))}월`, lang);
  const counts = countGoalCells(res.rows.flatMap((r) => r.cells.map((c) => c.state)));
  const cells = (n: number) => sheetTf(lang, 'goals.cells', { n });
  const dayLabel = (d: string) => (lang === 'en' ? sheetDateLabelEn(d) : formatKoreanDate(d));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={sheetT(lang, 'landing.title')} title={title} description={sheetT(lang, 'goals.desc')} embedLabel={`${title} · ${weekText}`} />
      <Toolbar>
        <ToolbarButton href={`/ecs?view=week&week=${res.weekMonday}`}>{sheetT(lang, 'goals.back')}</ToolbarButton>
        <GoalsPeriodBar
          view={res.view}
          date={res.date}
          isToday={res.date === res.today}
          navLabel={res.view === 'day' ? dayLabel(res.date) : weekText}
          prevHref={`/ecs/goals?date=${addDays(res.date, res.view === 'day' ? -1 : -7)}`}
          nextHref={`/ecs/goals?date=${addDays(res.date, res.view === 'day' ? 1 : 7)}`}
          relation={
            res.view === 'day'
              ? res.date === res.today ? 'current' : res.date < res.today ? 'past' : 'future'
              : res.weekMonday === mondayOf(res.today) ? 'current' : res.weekMonday < res.today ? 'past' : 'future'
          }
        />
        <GoalsRoleSwitch value={res.role} />
        <span className="text-sm">{sheetTf(lang, 'goals.caption', { month: monthText, week: weekText })}</span>
      </Toolbar>
      {res.areas.length === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{sheetT(lang, 'goals.noAreas')}</p>
      ) : res.rows.length === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{sheetT(lang, 'goals.empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <BigStat label={sheetT(lang, 'goals.stat.same')} value={cells(counts.same)} tone="green" valueClass="text-green" />
            <BigStat label={sheetT(lang, 'goals.stat.diff')} value={cells(counts.diff)} tone="amber" valueClass="text-amber" />
            <BigStat label={sheetT(lang, 'goals.stat.weekEmpty')} value={cells(counts.weekEmpty)} />
            <BigStat label={sheetT(lang, 'goals.stat.none')} value={cells(counts.none)} />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
            {(['same', 'diff', 'weekEmpty'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${GOAL_STATE_DOT[s]}`} aria-hidden />
                {sheetT(lang, s === 'same' ? 'goals.stat.same' : s === 'diff' ? 'goals.stat.diff' : 'goals.stat.weekEmpty')}
              </span>
            ))}
            {res.role === 'all' ? <span className="text-text-dim">{sheetT(lang, 'goals.legend.role')}</span> : null}
          </p>
          <GoalsTable rows={res.rows} areas={res.areas} weekMonday={res.weekMonday} monthStart={res.monthStart} date={res.date} lang={lang} role={res.role}
            showDay={res.view === 'day'} canEdit={res.canEdit} teacherNames={goals.names} />
        </>
      )}
    </div>
  );
}

/** 2.0 `getPlanGapBoard`의 반환(plan-gap.ts — 서버 전용이라 타입을 여기 같은 칸으로 적는다). */
type PlanGapCell = { date: string; slotStart: string; verdict: CellVerdict; lag: number };
type PlanGapClassRow = { classId: string; className: string; tally: CompareTally; misses: PlanGapCell[] };
export type GapData = {
  res: Fail | { ok: true; month: string; today: string; teachers: { teacher: string; tally: CompareTally; classes: PlanGapClassRow[] }[]; total: CompareTally; classCount: number };
  names: Record<string, string>;
};
/** 2.0 plan-gap.ts UNKNOWN_TEACHER — 서버 전용 모듈의 상수라 같은 값을 적는다(verify가 원문과 대조). */
const UNKNOWN_TEACHER = '__unknown__';

/** 2.0 ecs/plan-gap/page.tsx — 계획 대비 현황. 원문 JSX 순서 그대로(이 달 = 복사본 기준일의 달 — 2.0 kstMonth()와 같은 자리). */
export function EcsPlanGapPage({ gap, lang }: { gap: GapData; lang: SheetLang }) {
  const res = gap.res;
  const title = sheetT(lang, 'gap.title');
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sheetT(lang, 'landing.title')} title={title} />
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const cur = res.today.slice(0, 7);
  const monthText = sheetMonthLabel(res.month, monthLabel(res.month), lang);
  const t = (k: SheetDictKey) => sheetT(lang, k);
  const cells = (n: number) => sheetTf(lang, 'gap.cells', { n });
  const rate = matchRate(res.total);
  const avgLag = res.total.behind > 0 ? Math.round((res.total.lagSum / res.total.behind) * 10) / 10 : 0;
  const teacherLabel = (name: string) => (name === UNKNOWN_TEACHER ? t('gap.unknownTeacher') : (teacherNameFor(name, gap.names, lang) ?? name));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={sheetT(lang, 'landing.title')} title={title} description={t('gap.desc')} embedLabel={`${title} · ${monthText}`} />
      <Toolbar>
        <ToolbarButton href="/ecs">{t('goals.back')}</ToolbarButton>
        <PeriodNav
          label={monthText}
          prevHref={`/ecs/plan-gap?month=${shiftMonth(res.month, -1)}`}
          nextHref={`/ecs/plan-gap?month=${shiftMonth(res.month, 1)}`}
          currentHref="/ecs/plan-gap"
          relation={res.month === cur ? 'current' : res.month < cur ? 'past' : 'future'}
        />
      </Toolbar>
      {res.classCount === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{t('gap.empty')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BigStat label={t('gap.stat.rate')} value={rate === null ? '—' : `${rate}%`}
              sub={res.total.due === 0 ? t('gap.noDue') : sheetTf(lang, 'gap.stat.rate.sub', { n: res.total.due })} valueClass={TONE_TEXT.positive} />
            <BigStat label={t('gap.stat.behind')} value={cells(res.total.behind)}
              sub={res.total.behind > 0 ? sheetTf(lang, 'gap.stat.behind.sub', { n: avgLag }) : undefined} valueClass={TONE_TEXT.info} />
            <BigStat label={t('gap.stat.differ')} value={cells(res.total.differ)} valueClass={TONE_TEXT.critical} />
            <BigStat label={t('gap.stat.unwritten')} value={cells(res.total.unwritten)} valueClass={TONE_TEXT.caution} />
          </div>
          <div className="bg-card shadow-card overflow-x-auto rounded-2xl px-1">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-text-dim border-line border-b text-xs [&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold">
                  <th className="text-left!">{t('gap.col.teacher')}</th>
                  <th>{t('gap.col.due')}</th>
                  <th>{t('gap.col.match')}</th>
                  <th>{t('gap.col.behind')}</th>
                  <th>{t('gap.col.ahead')}</th>
                  <th>{t('gap.col.differ')}</th>
                  <th>{t('gap.col.unwritten')}</th>
                  <th>{t('gap.col.rate')}</th>
                </tr>
              </thead>
              {res.teachers.map((row) => (
                <tbody key={row.teacher} className="border-line border-b last:border-0">
                  <tr className="bg-bg-soft/60 font-bold">
                    <td className="px-3 py-2">{teacherLabel(row.teacher)}</td>
                    <GapTallyCells tally={row.tally} />
                  </tr>
                  {row.classes.map((c) => (
                    <GapClassRow key={c.classId} row={c} month={res.month} lang={lang} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** 2.0 plan-gap/page.tsx TallyCells. */
function GapTallyCells({ tally }: { tally: CompareTally }) {
  const rate = matchRate(tally);
  const num = (n: number, tone?: keyof typeof TONE_TEXT) => (
    <td className={`num px-3 py-2 text-center ${n > 0 && tone ? TONE_TEXT[tone] : n === 0 ? 'text-text-faint' : ''}`}>{n}</td>
  );
  return (
    <>
      {num(tally.due)}
      {num(tally.match, 'positive')}
      {num(tally.behind, 'info')}
      {num(tally.ahead, 'special')}
      {num(tally.differ, 'critical')}
      {num(tally.unwritten, 'caution')}
      <td className="num px-3 py-2 text-center">{rate === null ? '—' : `${rate}%`}</td>
    </>
  );
}

/** 2.0 plan-gap/page.tsx ClassRow. */
function GapClassRow({ row, month, lang }: { row: PlanGapClassRow; month: string; lang: SheetLang }) {
  const verdictText = (v: PlanGapCell) =>
    v.verdict === 'behind' ? sheetTf(lang, 'cmp.v.behind', { n: v.lag })
      : v.verdict === 'ahead' ? sheetTf(lang, 'cmp.v.ahead', { n: v.lag })
        : sheetT(lang, `cmp.v.${v.verdict}` as SheetDictKey);
  return (
    <>
      <tr className="border-line-faint border-t">
        <td className="px-3 py-2 pl-6">
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.className}</span>
            <Link href={`/ecs/${row.classId}/month?month=${month}`} className="text-primary text-xs font-bold underline underline-offset-2">{sheetT(lang, 'gap.openMonth')}</Link>
          </span>
        </td>
        <GapTallyCells tally={row.tally} />
      </tr>
      {row.misses.length > 0 ? (
        <tr>
          <td colSpan={8} className="px-3 pb-2 pl-6">
            <details>
              <summary className="text-text-dim cursor-pointer text-xs font-bold">{sheetTf(lang, 'gap.misses', { n: row.misses.length })}</summary>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {row.misses.map((m) => (
                  <li key={`${m.date}|${m.slotStart}`} className={`num rounded-full px-2 py-0.5 text-xs font-bold ${TONE_SOFT[VERDICT_TONE[m.verdict]]}`}>
                    {m.date.slice(5).replace('-', '/')} {m.slotStart} · {verdictText(m)}
                  </li>
                ))}
              </ul>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** 2.0 ecs/page.tsx room 갈래 — `<EcsSeatDayFace res={roomRes} showToday={scoped} />` 그대로(getEcsSeatDay("JJ") 결과). */
export type RoomData = { res: ComponentProps<typeof EcsSeatDayFace>["res"] };
export function EcsRoomPage({ room, scoped }: { room: RoomData; scoped: boolean }) {
  return <EcsSeatDayFace res={room.res} showToday={scoped} />;
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
        {what}은(는) 연습 화면에서 아직 지원하지 않습니다. <Link href="/ecs?view=week" className="text-primary font-bold underline underline-offset-2">주간 반 목록</Link>에서 반을 열어 주간 시트·월간을 볼 수 있습니다.
      </p>
    </div>
  );
}
