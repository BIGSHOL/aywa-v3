// 2.0 원생상담 목록(app/(shell)/consultations/page.tsx)과 목록 위 요약 띠(_components/stats-summary.tsx) — 둘 다 서버 컴포넌트라 그대로 불러올 수 없어서,
// 서버가 하던 조회는 /api/v2/consultations(Docker 복사본, v2-screen-consultations.mjs)가 하고, 여기서는 받은 값으로 목록과 최근 추세를 그린다.
// 바꾼 곳: 자료 받는 머리(requireAccess · 쿠키 · getTenantSettings · Promise.all → data) · 동기화 배지(서버 컴포넌트 → 같은 글자의 호스트판, 조회 값은 props) ·
// 요약 띠의 조회(getConsultationStats · getTenantSettings → 화면이 받은 값, SummaryData). 담임 상담의 별도 지연 조회는 후속 동기화 대상이다.
import { createContext, use } from "react";
import { SheetText } from "@/features/teacher-view/interface-label";
import { Suspense } from "react";
import { MessagesSquare, CalendarClock, BellRing, AlarmClock } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { PhotoCard } from "@/components/atoms/photo-card";
import { isModuleEnabled } from "@/lib/modules";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import type { ConsultationListFilters, StudentConsultationRow } from "@/features/consultations/server/queries";
import {
  CONSULT_DEFAULT_PAGE_SIZE,
  consultationsHref,
  consultationsStatsHref,
  type ConsultationListParams,
} from "@/features/consultations/list-href";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "@/app/(shell)/consultations/_components/new-consultation-trigger";
import { SearchToggle } from "@/components/search-toggle";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ConsultationFilters } from "@/app/(shell)/consultations/_components/consultation-filters";
import { EmbedLink } from "@/components/embed-link";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import type { MakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { buildKpiLines, fmt } from "@/features/consultations/stats-kpi";
import { changeText, recentWeekTrend } from "@/features/consultations/stats-recent";
import { statsScopeText } from "@/features/consultations/stats-scope";
import type { ConsultationStats, StatsMetric } from "@/features/consultations/stats-model";
import { ConsultationList } from "./consultations-list-rows";
import { MakeeduSyncBadge } from "./billing-sync-badge";

/** /api/v2/consultations — 2.0 page가 서버에서 받던 값. */
export type ConsultationsListData = {
  operations: { subjects: SubjectSetting[] };
  modules: { disabled: string[] };
  teacherId: string | null;
  listParams: ConsultationListParams;
  filters: ConsultationListFilters;
  items: StudentConsultationRow[];
  total: number;
  classSupported: boolean;
  counts: { total: number; lastWeek: number; pendingFollowUps: number; overdueFollowUps: number };
  counselorOptions: { id: string; name: string; retired: boolean }[];
  canImportExcel: boolean;
  summary: { stats: ConsultationStats } | { error: string };
  syncState: MakeeduSyncState | null;
  canManageOwner: boolean;
};
/** 요약 띠 자료 — 띠가 2.0처럼 같은 props(필터 · 범위)만 받고 그리게 화면 자료를 따로 싣는다. */
export const SummaryData = createContext<{ summary: ConsultationsListData["summary"]; operations: { subjects: SubjectSetting[] } } | null>(null);

const DEFAULT_PAGE_SIZE = CONSULT_DEFAULT_PAGE_SIZE;
const PAGE_SIZE_KEY = "consultations";

export function ConsultationsPage({ data }: { data: ConsultationsListData }) {
  const { range, cat, urg, who, subject, q, page, size } = data.listParams;
  const settings = { operations: data.operations, modules: data.modules };
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const filters = data.filters;
  const [{ rows: items, total, classSupported }, counts, counselorOptions, canImportExcel, teacherId] = [
    { rows: data.items, total: data.total, classSupported: data.classSupported }, data.counts, data.counselorOptions, data.canImportExcel, data.teacherId,
  ];
  const totalPages = Math.max(1, Math.ceil(total / size));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;
  const listParams: ConsultationListParams = { range, cat, urg, who, subject, q, size, page };
  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => consultationsHref({ ...listParams, page: p }, DEFAULT_PAGE_SIZE);
  // makeedu가 꺼진 학원엔 '동기화' 지표·축이 없다(기능 스위치 = 흔적 없이).
  const syncOn = isModuleEnabled(settings.modules.disabled, "makeedu");

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* 핵심 수치 — 지시서 §4 "1차 화면에 남길 것: 현재 상태 + 핵심 KPI". 필터와 무관한 학원 전체 값(아래 요약 띠는 필터를 따른다). */}
      <StatStrip>
        <BigStat label="전체 상담" value={totalAll} unit="건" tone="primary" icon={<MessagesSquare size={16} strokeWidth={1.8} />} />
        <BigStat label="최근 7일" value={lastWeek} unit="건" tone="blue" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat label="진행 중 후속" value={pendingFollowUps} unit="건" tone="gold" icon={<BellRing size={16} strokeWidth={1.8} />} />
        <BigStat
          label="기한 경과 후속"
          value={overdueFollowUps}
          unit="건"
          tone="danger"
          valueClass={overdueFollowUps > 0 ? "text-danger" : undefined}
          icon={<AlarmClock size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      {/* 목록 머리 — Primary는 '상담 추가' 하나, '통계 보기'는 텍스트 보조(같은 창 안 이동 — 필터 유지).
          필터는 축마다 라벨 하나(드롭다운) · 검색은 눌러야 나온다. 통계는 목록 옆 패널이 아니라 전용 화면(원장 2026-10-01). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          <SheetText value={"결과 "} /><span className="text-foreground font-bold">{total}</span><SheetText value={"건"} />{totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
        </p>
        {/* phone:basis-full — 폰에선 flex-1(basis 0)이 건수 옆 남는 74px에 이 묶음을 세워 드롭다운 5개가 한 줄에 하나씩
            세로로 쌓였다(2026-09-13 모바일 전수검사). 제 줄로 내려 전폭에서 감기게 한다(창 안은 종전 한 줄). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 phone:basis-full">
          <ConsultationFilters
            range={range}
            cat={cat}
            urg={urg}
            who={who}
            subject={subject}
            counselorOptions={counselorOptions}
            subjectOptions={subjects.options}
          />
          <SearchToggle placeholder="학생명·요약" defaultValue={q} />
          {/* 엑셀 가져오기(원생상담) — 검색과 같은 줄(원장 2026-09-29 통일). */}
          {canImportExcel ? <ExcelMenu importKind="student-consultations" /> : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <MakeeduSyncBadge domain="consultations" state={data.syncState} canManage={data.canManageOwner} />
          {/* 텍스트 보조 버튼(§10 — 상시 버튼은 Primary 하나 + 텍스트 하나). 같은 창 안 이동이라 창이면 embed를 싣는다([[#133]]). */}
          <EmbedLink
            href={consultationsStatsHref(listParams)}
            title="상담 통계 — 지금 필터 그대로"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary inline-flex items-center px-1 font-medium whitespace-nowrap hover:underline`}
          >
            <SheetText value={"통계 보기"} /></EmbedLink>
          <NewConsultationTrigger />
        </div>
      </div>

      {/* 한 줄 요약 띠 — 지금 걸린 필터를 따르는 핵심 수치(통계 화면과 같은 함수). 집계는 목록 첫 페인트를 막지 않는다(B7) —
          스켈레톤과 실표면이 같은 한 줄 높이라 늦게 와도 목록이 안 밀린다(stats-summary.tsx). */}
      <Suspense fallback={<StatsSummarySkeleton />}>
        <ConsultationStatsSummary
          filters={filters}
          listParams={listParams}
          whoLabel={counselorOptions.find((c) => c.id === who)?.name ?? null}
          teacherScoped={!!teacherId}
          syncOn={syncOn}
        />
      </Suspense>

      {/* 목록 — 화면 폭을 다 쓴다(넓으면 2단, 좁으면 1단 · consultation-list.tsx). 통계는 옆 패널이 아니라 '통계 보기' 전용 화면(원장 2026-10-01). */}
      <div data-autopage-root="">
        {total === 0 ? (
          <div className="mx-auto max-w-xl py-4">
            <PhotoCard
              src="/photos/consultations-hero.webp"
              alt=""
              caption="기록된 상담이 없습니다"
              sub="상담 추가로 첫 기록을 남겨 보세요"
              aspect="3/2"
              sizes="(max-width: 768px) 100vw, 576px"
            />
          </div>
        ) : (
          <>
            <ConsultationList items={items} size={size} pageSizeKey={PAGE_SIZE_KEY} classOn={classSupported} />
            <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 띠 상자 — 실표면·스켈레톤·오류 모두 **같은 한 줄 높이**(h-9). 띠는 목록보다 늦게 흘러오므로(B7) 도착해서 높이가 바뀌면
 * 목록이 밀리고, 창 높이로 행 수를 잰 AutoPageSize가 그만큼 어긋나 페이지에 스크롤이 생긴다(원장 *"스크롤이 따로 놀게"* 의 재발).
 * 그래서 줄을 바꾸지 않는다 — 좁은 폭에선 아래 SHOW_FROM 순서대로 지표를 덜 싣고, 기간·범위 문구는 말줄임(날짜 범위까지 전문은 마우스 오버).
 * '검색어 제외'만은 말줄임 밖 제자리에 따로 선다 — 목록 '결과 N건'과 띠 건수가 다른 이유라 잘리면 안 된다(적대 리뷰 2026-10-01).
 */
const BAND = "@container/band bg-bg-soft flex h-9 items-center gap-4 overflow-hidden rounded-lg px-3";

/**
 * 띠 폭(`@container/band`)에 따라 싣는 지표 — 앞 지표의 폭 합 + 기간·범위 최소 13rem이 들어가는 경계(Pretendard 16px 실측 근사:
 * 최근 4주 ≈160 · 후속 ≈132 · 녹음·AI ≈186 · 동기화 ≈132 · 반 미매핑 ≈116px, 간격 16px). 숨긴 지표는 '통계 보기'에 다 있다.
 */
const SHOW_FROM: Record<StatsMetric, string> = {
  count: "flex",
  perStudent: "hidden",
  follow: "hidden @min-[50rem]/band:flex",
  media: "hidden @min-[63rem]/band:flex",
  sync: "hidden @min-[72rem]/band:flex",
  class: "hidden @min-[80rem]/band:flex",
};

/** 요약 띠 자리 — 집계가 흘러오기 전에 같은 높이의 빈 띠를 먼저 세운다(B7 · 높이 = 실표면이라 도착해도 목록이 안 밀린다). */
export function StatsSummarySkeleton() {
  return <div aria-hidden="true" className="bg-bg-soft/40 h-9 animate-pulse rounded-lg" />;
}

/**
 * 목록 위 **한 줄 요약 띠**(원장 2026-10-01 — 통계 패널을 목록 옆에서 걷고 목록은 폭을 다 쓴다). 지금 걸린 기간·범위 필터를 그대로 따르고
 * 수치·문구는 통계 화면과 **같은 함수**(`getConsultationStats` · `buildKpiLines` · `statsScopeText`)로 만든다 — 같은 필터에서 두 표면의
 * 숫자가 갈리지 않는다. 검색어는 통계처럼 걸지 않는다('검색어 제외'). 자세한 건 툴바의 '통계 보기'(같은 동작을 두 곳에 두지 않는다).
 * 🔴 집계가 실패해도 **목록은 산다** — 여기서 던지지 않고 띠 자리에 한 줄만 알린다(같은 높이).
 */
export function ConsultationStatsSummary({
  listParams,
  whoLabel,
  teacherScoped,
  syncOn,
}: {
  filters: ConsultationListFilters;
  listParams: ConsultationListParams;
  whoLabel: string | null;
  teacherScoped: boolean;
  syncOn: boolean;
}) {
  const ctx = use(SummaryData);
  let loaded;
  if (ctx && "stats" in ctx.summary) loaded = [ctx.summary.stats, { operations: ctx.operations }] as const;
  else {
    const raw = ctx && "error" in ctx.summary ? ctx.summary.error : "";
    return (
      // 한 줄 말줄임 — 띠 높이(h-9)를 넘겨 접히면 위아래가 잘린다(좁은 폰).
      <p className={`${BAND} text-muted-foreground text-xs`} title={raw}>
        <span className="min-w-0 truncate">상담 요약을 불러오지 못했습니다 — 목록은 그대로 볼 수 있습니다.</span>
      </p>
    );
  }
  const [stats, settings] = loaded;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const { period, rangeText, scope, searchExcluded } = statsScopeText(stats, listParams, {
    teacherScoped,
    whoLabel,
    subjectLabel: listParams.subject ? subjects.labelOf(listParams.subject) : null,
  });
  const lines = buildKpiLines(stats, { syncOn, classOn: stats.full }).filter(
    (l) => !stats.full || (l.metric !== "count" && l.metric !== "perStudent"),
  );
  const trend = stats.full ? recentWeekTrend(stats.buckets.week, stats.today) : null;
  const change = trend ? changeText(trend.changePct) : null;
  return (
    <section aria-label="상담 통계 요약" className={BAND}>
      {/* 기간 이름 + 범위(좁으면 말줄임) — 날짜 범위까지 전문은 마우스 오버. */}
      <p className="text-muted-foreground min-w-0 truncate text-xs" title={`${period} · ${scope}`}>
        {rangeText} · {scope}
      </p>
      {searchExcluded ? (
        <span
          className="text-foreground -ml-2 shrink-0 text-xs font-medium whitespace-nowrap"
          title="검색어는 통계에 걸지 않습니다 — 위 '결과'와 건수가 다를 수 있습니다"
        >
          · 검색어 제외
        </span>
      ) : null}
      <ul className="flex shrink-0 items-baseline gap-4">
        {trend ? (
          <li className="flex items-baseline gap-1 text-sm whitespace-nowrap"
            title={`${md(trend.from)}~${md(trend.to)} · 직전 4주 ${fmt(trend.prior)}건 · 이번 주(진행 중) ${fmt(trend.thisWeek)}건 · 기간 필터와 무관하게 최근 주 기준(나머지 필터는 따른다)`}>
            <span className="font-medium">최근 4주</span>
            <span className="num text-foreground font-bold">{fmt(trend.recent)}건</span>
            {change ? <span className={`num text-xs ${trend.changePct !== null && trend.changePct < 0 ? "text-danger" : "text-muted-foreground"}`}>{change}</span> : null}
          </li>
        ) : null}
        {lines.map((l) => (
          <li key={l.metric} className={`${SHOW_FROM[l.metric]} items-baseline gap-1 text-sm whitespace-nowrap`} title={l.sub}>
            <span className="font-medium">{l.label}</span>
            <span className="num text-foreground font-bold">{l.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`;
