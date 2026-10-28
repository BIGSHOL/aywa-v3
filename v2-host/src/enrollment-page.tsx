// 2.0 신규 콜&상담(app/(shell)/enrollment/page.tsx — 칸반 · 목록 · 통계)의 조립 — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// /api/v2/enrollment(Docker 복사본, v2-enrollment-list.mjs · v2-enrollment-stats.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(enrollment-page.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-enrollment.mjs가 2.0 본문에
// 같은 짝을 대어 이 파일과 글자를 대조한다.
// ⚠️ 2.0과 다른 것(swaps.json): 공개 접수 QR(서버 컴포넌트 · 바깥에 나가는 공개 화면) = 누를 수 없는 단추 · makeedu 보내기(바깥 전송) = 단추째 없음 ·
//    makeedu 동기화 배지(서버 컴포넌트) 없음 · 계정 보기 설정 저장(RememberPrefs — 3.0엔 계정이 없어 주소로만) 없음.
import { Suspense } from "react";
import Link from "next/link";
import { Calculator, QrCode } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON,
} from "@/components/toolbar-controls";
import { NewConsultationWatcher } from "@/app/(shell)/enrollment/_components/new-consultation-watcher";
import { PhotoCard } from "@/components/atoms/photo-card";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import type { ConsultationListRow, ConsultationTableRow } from "@/features/enrollment/server/queries";
import { Pagination } from "@/components/pagination";
import { isValidYm, isValidYmd, kstToday } from "@/lib/date-kst";
import { parseRange, parseStatsPeriod, periodRange } from "@/features/enrollment/range";
import type { ConsultationDistribution, EnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { StatsView } from "@/app/(shell)/enrollment/_components/stats-view";
import { buildManagementExits } from "@/features/enrollment/management-sheet";
import type { SchoolStatsPrefs } from "@/features/enrollment/school-view-prefs";
import { IntakeTrendCard } from "@/app/(shell)/enrollment/_components/intake-trend-card";
import { OpsHistoryCard } from "@/app/(shell)/students/stats/_components/ops-history-card";
import { PROGRESS_KEYS } from "@/features/students/stats/ops-keys";
import { firstRecorded, opsSeries } from "@/features/students/stats/ops-series";
import type { OpsDaily } from "@/features/students/stats/ops-daily";
import type { ProgressCounts } from "@/features/dashboard/overview/consultation-progress";
import { INTAKE_TREND_KEYS, type IntakeTrend } from "@/features/enrollment/intake-trend";
import { hasPeriodParams, paramsForMode, parseStatsPeriod as parsePeriod, readPeriodParams } from "@/features/stats/period";
import type { EnrollmentView } from "@/app/(shell)/enrollment/_components/enrollment-query";
import { KanbanFilters } from "@/app/(shell)/enrollment/_components/kanban-filters";
import { NewEnrollmentTrigger } from "@/app/(shell)/enrollment/_components/new-enrollment-trigger";
import { EnrollmentKanban } from "@/app/(shell)/enrollment/_components/enrollment-kanban";
import { parseBoardStage } from "@/features/enrollment/board-stages";
import { EnrollmentTable } from "@/app/(shell)/enrollment/_components/enrollment-table";
import { MakeeduPushButton } from "@/app/(shell)/enrollment/_components/makeedu-push-button";
import { PROGRESS_DEFAULT_OFF, parseEnrollmentView, parseStatsSpan, savedEnrollmentView, savedIntakeChartKind, savedIntakeTrendMode, savedProgressTrendMode, savedProgressTrendOff, savedStatsSpan, type StatsSpanValue } from "@/features/enrollment/view-pref";
import { saveProgressTrendMode, saveProgressTrendOff } from "@/features/enrollment/server/view-pref-actions";

/** /api/v2/enrollment — 2.0 page가 서버에서 받던 값(보기에 맞는 것만 채워진다). */
export type EnrollmentListData = {
  canWriteEnrollment: boolean;
  canOpenCalculator: boolean;
  canImportExcel: boolean;
  canPushMakeedu: boolean;
  uiPrefs: Record<string, unknown>;
  kanbanItems: ConsultationListRow[] | null;
  tablePage: { rows: ConsultationTableRow[]; total: number } | null;
  headerCounts: { total: number; aiDone: number } | null;
  statsYears: number[];
  schoolPrefs: SchoolStatsPrefs | null;
  consultants: { id: string; name: string }[];
  minYear: number;
  totalCount: number | null;
  progressRows: OpsDaily[] | null;
  intake: { groups: Parameters<typeof IntakeTrendCard>[0]["groups"]; trend: IntakeTrend | null } | null;
  stats: EnrollmentStats | null;
  dist: ConsultationDistribution | null;
  withdrawals: { id: string; name: string; withdrawnAt: string }[] | null;
};

/** 상담 진행 단계 — 운영실 '상담 진행' 카드와 같은 이름·순서(`consult-progress.tsx` STEPS). */
const PROGRESS_STEPS: { key: keyof ProgressCounts; label: string }[] = [
  { key: "received", label: "접수" },
  { key: "consulted", label: "상담" },
  { key: "levelTest", label: "입테" },
  { key: "enrolled", label: "등록" },
  { key: "assigned", label: "반 배정" },
  { key: "started", label: "수업 시작" },
];
/** 단계 색 — 수업 시작은 초록(멈춘 상담 빨강과 갈리게 · 리뷰 2026-10-21). 순서 = `PROGRESS_STEPS`. */
const PROGRESS_COLORS = ["var(--color-primary)", "var(--color-blue)", "var(--color-amber)", "var(--color-purple)", "#9aa3ad", "var(--color-green)"];

// 전 목록 공통(표·카드) — 변경 시 학생·수납 등 다른 목록과 함께 바꿀 것.
const PAGE_SIZE = 50;

// 🔴 칸 정의는 [board-stages](@/features/enrollment/board-stages) 단일 소스로 옮겼다(원장 2026-09-01,
// 5칸 → 4칸). 칸 판정·드롭 대표값·카드 표식이 한 모듈에서 나오고 Vitest가 잠근다 — 여기 배열로
// 되돌리지 말 것(옛 5칸은 이 파일이 칸을, 카드 컴포넌트가 배지를 따로 정해 규칙이 두 벌이었다).

export function EnrollmentPage({
  data,
  sp: searchParams,
}: {
  data: EnrollmentListData;
  sp: {
    month?: string;
    consultant?: string;
    q?: string;
    outcome?: string;
    view?: string;
    page?: string;
    range?: string;
    year?: string;
    received?: string;
    trend?: string;
    trendMonth?: string;
    trendFrom?: string;
    trendTo?: string;
    trendSpan?: string;
    pg?: string;
    pgMonth?: string;
    pgFrom?: string;
    pgTo?: string;
    pgSpan?: string;
    from?: string;
  };
}) {
  const sp = searchParams;
  const {
    month,
    consultant,
    q,
    outcome,
    view: viewParam,
    page: pageParam,
    range: rangeParam,
    year: yearParam,
    received,
  } = sp;
  // 달·접수일은 **달력에 있는 값만** 필터로 쓴다 — 없는 날짜(2026-02-30)를 그대로 실으면 경계 계산이 터지거나(500)
  // PostgREST가 400을 낸다. 틀리면 필터 없음.
  const selectedMonth = isValidYm(month) ? month : null;
  // 접수일(운영실 KPI '신규문의' ↗) — 카드와 같은 KST 하루 경계로 created_at을 자른다.
  const receivedDay = isValidYmd(received) ? received : null;
  const selectedConsultant = consultant ?? null;
  // 상태 필터 = 칸반과 **같은 4단계**(원장 2026-09-01). 파라미터 이름은 `outcome` 그대로이고 값만
  // 칸 키다 — 옛 링크(`?outcome=ai_done`)는 그 값이 속한 칸으로 넓혀 받는다(parseBoardStage).
  const selectedStage = parseBoardStage(outcome);
  const searchQuery = q?.trim() || null;
  const page = Math.max(1, Number(pageParam) || 1);
  // 🔴 기본 = 최근 3개월. '전체'는 고를 수 없고 구간은 최대 1년(원장 2026-08-04) — 이관으로 3년치가
  // 쌓여 전건을 열면 칸반이 카드 2,197장이 된다. 알 수 없는 값이 와도 parseRange가 3개월로 되돌린다.
  const selectedRange = parseRange(rangeParam);
  const filter = {
    month: selectedMonth,
    range: selectedRange,
    consultantId: selectedConsultant,
    stage: selectedStage,
    q: searchQuery,
    received: receivedDay,
  };

  // 칸반 드래그(상태 변경) 가능 여부 — 권한 판정은 캐시된 매트릭스 재사용이라 추가 쿼리 0.
  // ⚠️ 이건 **화면을 줄이는 용도**일 뿐이고 진짜 게이트는 setEnrollmentOutcome 안에 있다([[#77]]).
  // 수강료 계산기 바로가기(감사 N14, 원장 2026-09-23) — 계산기는 수납관리의 한 면이라 **그 화면을 열 수 있는
  // 사람에게만** 링크를 세운다(권한은 바꾸지 않는다 — 못 여는 사람에게 링크를 주면 눌러도 거절된다).
  // 엑셀로 넣기 = 학원 전체를 바꾸는 일괄 작업 → full만(`canManageTenant`, 올리기 주소도 같은 판정 — [[#77]]).
  // makeedu 보내기(원장 2026-10-01) = 전송 액션과 **같은 게이트**(`canPushToMakeedu`) — 권한이 없거나 makeedu 모듈이
  // 꺼진 지점이면 버튼 자리째 없다(잠긴 대체 화면도 안 그린다).
  // 관리현황 '등록 후 퇴원'(원장 2026-10-22) = 퇴원 명단을 보여 주므로 퇴원관리를 열 수 있는 사람에게만(같은 게이트 — 못 열면 칸째 없다).
  const [canWriteEnrollment, canOpenCalculator, canImportExcel, canPushMakeedu, uiPrefs] = [data.canWriteEnrollment, data.canOpenCalculator, data.canImportExcel, data.canPushMakeedu, data.uiPrefs];
  // 보기 = 주소의 `view` → 계정에 남은 마지막 보기 → 칸반(원장 2026-10-19 *"마지막으로 본 뷰로 사람에게 귀속"*, view-pref.ts).
  // 고른 보기는 아래 RememberPrefs가 저장한다. 🔴 툴바 링크는 칸반도 `view=kanban`으로 적는다(enrollment-query.ts) —
  //    안 적으면 저장이 끝나기 전 다음 클릭이 옛 저장값으로 돌아간다.
  const savedView = savedEnrollmentView(uiPrefs);
  const view: EnrollmentView = parseEnrollmentView(viewParam) ?? savedView;
  // 통계 연도 = 주소의 `year` → 계정에 남은 여러 해 묶음(2·3개년) → 올해(검수 2026-10-22 — 아래 추이 카드처럼 기억한다).
  // 여기엔 "최대 1년" 상한이 없다(집계라 행을 안 가져온다 — 칸반·목록의 상한은 행 로딩 때문이라 여기와 무관).
  const savedSpan = savedStatsSpan(uiPrefs);
  const statsPeriod = parseStatsPeriod(yearParam ?? savedSpan ?? undefined, Number(kstToday().slice(0, 4)));
  // 단일 연도면 그 해, 기간 프리셋이면 null(라벨·비율 판정에 쓴다).
  const statsYear: number | null = statsPeriod.kind === "year" ? statsPeriod.year : null;
  // 저장할 묶음 — 통계 보기에서 주소로 연도를 고른 때만 바뀐다(다른 보기로 오가는 것은 저장값을 건드리지 않는다).
  const currentSpan: StatsSpanValue | null =
    view === "stats" && yearParam ? (statsPeriod.kind === "span" ? parseStatsSpan(`${statsPeriod.years}y`) : null) : savedSpan;
  // 신규 문의 추이(원장 2026-10-20) — 기간은 주소(`trend…`) → 계정에 남긴 보기 방식 → 월별 12개월. 연도 칩과 따로 논다.
  const today = kstToday();
  const intakeParams = readPeriodParams(sp, INTAKE_TREND_KEYS);
  const savedIntakeMode = savedIntakeTrendMode(uiPrefs);
  const intakePeriod = parsePeriod(
    hasPeriodParams(intakeParams) || !savedIntakeMode ? intakeParams : paramsForMode(savedIntakeMode, today),
    today,
  );
  // 상담 진행 기록(2026-10-21부터 쌓는 매일 기록 — 지금 상태만 남는 지표라 과거는 없다). 기간은 주소(`pg…`) → 저장된 방식 → **최근 구간(일별)**
  // (막 쌓이기 시작한 기록이라 월별은 점 하나 · '이번 달 일별'은 매달 1일에 하루 종일 빈다 — 리뷰 2026-10-21).
  const progressParams = readPeriodParams(sp, PROGRESS_KEYS);
  const savedProgressMode = savedProgressTrendMode(uiPrefs) ?? "range";
  const progressPeriod = parsePeriod(hasPeriodParams(progressParams) ? progressParams : paramsForMode(savedProgressMode, today), today);
  const progressHistory = view === "stats" ? data.progressRows : null;
  // 신규 문의 추이 — 연도 범위와 무관하니 위 조회들과 함께 먼저 띄운다(B4 · 리뷰 2026-10-21). 실패는 카드 안에서 '못 불러옴'으로.
  const intakePromise = view === "stats" ? data.intake : null;
  // 🔴 뷰마다 **가져오는 양이 다르다**. 목록은 한 페이지(50행)만 — 옛 시트 이관으로 2,251행이 되어
  // 전건 로드는 라운드트립 3회 + 배지 청크 20여 회로 불어난다(B2·B4). 칸반은 열별 집계가 필요해
  // 전건을 유지하되, 그래서 기간 필터 없이 열면 여전히 무겁다(별도 과제).
  const [kanbanItems, tablePage, headerCounts, statsYears, _unused, schoolPrefs, consultants, minYear, totalCount] =
    [
      view === "kanban" ? data.kanbanItems : null,
      view === "table" ? data.tablePage : null,
      view === "table" ? data.headerCounts : null,
      view === "stats" ? data.statsYears : [],
      null,
      view === "stats" ? data.schoolPrefs : null,
      data.consultants,
      data.minYear,
      data.totalCount,
    ] as const;
  // 연도 범위를 안 뒤에 통계를 조회한다(전체 기간이 어디부터인지 알아야 한다). 둘은 서로 독립이라 병렬.
  const available =
    statsYears.length > 0
      ? { from: Math.min(...statsYears), to: Math.max(...statsYears) }
      : { from: Number(kstToday().slice(0, 4)), to: Number(kstToday().slice(0, 4)) };
  const span = periodRange(statsPeriod, available);
  const [stats, dist, intake, withdrawals] =
    view === "stats"
      ? [data.stats, data.dist, intakePromise, data.withdrawals]
      : [null, null, null, null];
  const managementExits = dist && withdrawals ? buildManagementExits(dist.cohorts, withdrawals) : null;
  const progressRows = progressHistory;
  void _unused;

  const items = kanbanItems ?? [];

  // 상대시간 기준 시각 — 서버·클라 첫 렌더를 같은 기준으로 계산해 하이드레이션 불일치를 없앤다.
  // eslint-disable-next-line react-hooks/purity -- 동적 페이지, 요청당 1회 렌더(intake page 선례)
  const nowMs = Date.now();
  // 월 피커 기준 '이번 달' — KST로 서버에서 확정해 내려보낸다(클라가 자기 시계로 계산하면
  // 자정 근처·해외 접속에서 하이드레이션이 어긋나고 미래 달 비활성화 기준도 흔들린다).
  const todayMonth = kstToday().slice(0, 7);
  const aiDone = items.filter((i) => i.outcome === "ai_done").length;
  // "배정 완료" = 상담 → 수업 배정으로 학생이 생기고 수업이 1개 이상 붙은 진짜 완료(outcome 라벨과 별개).
  const assigned = items.filter((i) => i.assignedClassCount >= 1);

  const filterActive =
    !!selectedMonth || !!selectedConsultant || !!selectedStage || !!searchQuery || !!receivedDay;

  // 필터는 보존하고 page만 갈아끼운다. p===1이면 page= 자체를 안 넣어야 필터 변경 href와 모양이 같아진다
  // (필터·검색·월이동 href는 page를 안 넣으므로 자동으로 1페이지로 리셋된다 — 페이지네이션 표준).
  // 통계뷰 연도 링크 — 목록 필터(월·기간·검색)는 통계와 무관해 싣지 않는다(섞이면 "무엇을 보고 있는지"가 흐려진다).
  // 신규 문의 추이 기간·운영실 방문 표시(`from=dashboard`)는 연도와 따로 논다 — 연도를 바꿔도 그대로 싣는다(리뷰 2026-10-20).
  const yearHref = (v: string | number): string => {
    const q = new URLSearchParams({ view: "stats", year: String(v) });
    for (const k of [...Object.values(INTAKE_TREND_KEYS), ...Object.values(PROGRESS_KEYS), "from"]) {
      const raw = (sp as Record<string, string | string[] | undefined>)[k];
      const val = Array.isArray(raw) ? raw[0] : raw; // 같은 칸이 둘이면 첫 값(readPeriodParams와 같은 규칙)
      if (val) q.set(k, val);
    }
    return `/enrollment?${q.toString()}`;
  };

  const pageHref = (p: number): string => {
    const params = new URLSearchParams();
    if (selectedMonth) params.set("month", selectedMonth);
    if (selectedConsultant) params.set("consultant", selectedConsultant);
    if (selectedStage) params.set("outcome", selectedStage);
    if (searchQuery) params.set("q", searchQuery);
    // 기간은 검색어와 **독립**이다(else로 묶으면 검색 중에 기간이 사라져 3개월로 되돌아간다).
    // 특정 달을 보고 있을 때만 프리셋이 무의미해서 뺀다.
    if (!selectedMonth && selectedRange !== "3m") params.set("range", selectedRange);
    if (receivedDay) params.set("received", receivedDay);
    params.set("view", "table");
    if (p > 1) params.set("page", String(p));
    return `/enrollment?${params.toString()}`;
  };

  // 연도 칩(원장 2026-10-22 *"너무 위쪽에 있어서 아래쪽과 작동하는게 헷갈림. 해당 위치로 이동할것"*) — 머리글 툴바에서 빼서 이 칩이 바꾸는
  // 카드들(헤드라인·관리현황·월별…) 바로 위에 둔다(StatsView). 위 두 추이 카드는 카드 안 기간을 따로 쓴다.
  const statsYearChips =
    view === "stats" && statsYears.length > 0 ? (
      <div className="flex items-center gap-1.5">
        <span className="micro shrink-0">연도</span>
        <div className={TOOLBAR_SEG_BOX}>
          {/* 기간 프리셋 — 최대 3개년(원장 2026-08-05). '전체'는 없앴다: 해가 갈수록 구간이
              무한히 길어져 화면이 계속 빽빽해진다. 상한을 두면 눈금 압축(월→분기)과 맞물려
              몇 년이 지나도 같은 밀도로 읽힌다. */}
          {[2, 3].map((n) => (
            <Link
              scroll={false}
              key={`${n}y`}
              href={yearHref(`${n}y`)}
              className={`${TOOLBAR_SEG_ITEM} ${
                statsPeriod.kind === "span" && statsPeriod.years === n ? TOOLBAR_SEG_ON : TOOLBAR_SEG_OFF
              }`}
            >
              {n}개년
            </Link>
          ))}
          {statsYears.map((y) => (
            <Link
              scroll={false}
              key={y}
              href={yearHref(y)}
              className={`${TOOLBAR_SEG_ITEM} num ${y === statsYear ? TOOLBAR_SEG_ON : TOOLBAR_SEG_OFF}`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>
    ) : null;

  return (
    // 세로 간격 4(=16px) — 🔴 5(20px)였는데 원장이 *"창을 가장 크게 해도 하단에 스크롤"*을 지적했다.
    // 여백은 세 곳(이 간격 · 칸 머리 py · 카드 py)에서 함께 줄여야 한 칸이 창 안에 들어온다.
    // 목록(시트)뷰만 **창 높이를 채우는 flex 기둥** — 표가 남는 높이를 전부 가져가 안에서 스크롤하고 페이저는 창 바닥에
    // 붙는다(원장 2026-09-02 *"이 어색한 여백은 뭐야"* — 표 높이를 dvh 계산으로 박았더니 넓은 창에서 툴바가 한 줄로
    // 접힌 만큼이 표 아래 빈 띠로 남았다). 칸반·통계는 종전대로 문서 흐름(자기 높이·페이지 스크롤).
    <div className={view === "table" ? "flex h-full min-h-0 flex-col space-y-4" : "space-y-4"}>
      {/* Editorial 문법 ① — eyebrow→헤드라인 + 인라인 스탯 행(시간표 패턴: BigStat 카드 대신 밀도 우선).
          '등록 전환율'(outcome=enrolled 라벨 기반)은 실제 학생 미생성 건까지 세어 과대였음 →
          진짜 완료 지표인 '배정 완료(수업≥1)' 건수 유지(정직). */}
      {/* QR 접수가 들어오면 새로고침 없이 목록이 갱신된다(20초 건수 폴링). 알림 줄은 도착 후에만 렌더. */}
      <NewConsultationWatcher initialCount={totalCount ?? 0} />
      {/* 운영실 ↗로 온 방문(`from=dashboard`)은 보기를 저장하지 않는다 — 카드가 연 보기가 사람이 고른 마지막 보기를 덮지 않게(원생목록과 같은 규약). */}

      <PageHeader
        eyebrow="신규 콜&상담"
        title="신규 콜&상담"
        // 🔴 설명 문장은 뺐다(원장 2026-09-01 *"멘트 제거"*) — 매일 보는 화면에서 같은 문장이
        // 한 줄을 계속 먹는다. 숫자(전체·AI·배정)는 아래 툴바 검색창 왼쪽으로 옮겼다.
        actions={
          <>
            <Suspense
              fallback={
                <Button variant="ghost" disabled>
                  <QrCode className="size-4" />
                  공개 접수 QR
                </Button>
              }
            >
              <Button variant="ghost" disabled title="연습 화면에서는 아직 지원하지 않는 기능입니다">
                <QrCode className="size-4" />
                공개 접수 QR
              </Button>
            </Suspense>
            {/* makeedu 보내기 — 후보 조회는 Suspense로 첫 페인트에서 뗀다(B7). 누르면 연동 면과 같은 전송 카드가
                다이얼로그로 뜬다. 연동 면(/owner 연동 탭)의 카드는 그대로(실패 건 재전송). */}
            {canPushMakeedu ? (
              <Suspense fallback={<MakeeduPushButton candidates={null} />}>
                <MakeeduPushButton candidates={null} />
              </Suspense>
            ) : null}
            {canOpenCalculator ? (
              <Button
                variant="ghost"
                render={<WindowLink href="/billing?tab=calculator" title="수강료 계산기" />}
              >
                <Calculator className="size-4" />
                수강료 계산기
              </Button>
            ) : null}
            <NewEnrollmentTrigger />
          </>
        }
        // 🔴 통계뷰에선 이 줄을 아예 안 그린다. 통계뷰는 목록을 안 불러오므로 여기 숫자가 전부 0이
        // 되는데, 실제로는 2,197건이라 **화면이 거짓말을 한다**(2026-08-05 원장 스크린샷). 게다가
        // 통계뷰는 바로 아래에 자기 헤드라인 카드(상담·등록·전환율·결제액)를 갖고 있어 중복이기도 하다.
      />

      <KanbanFilters
        syncBadge={null}
        excel={canImportExcel ? <ExcelMenu importKind="enrollment-consultations" /> : null}
        stats={
          view === "stats" ? undefined : (
            // 🔴 헤더에 있던 숫자 줄 — 검색창 바로 왼쪽으로 옮겼다(원장 2026-09-01).
            // 통계뷰는 자기 헤드라인 카드가 같은 숫자를 갖고 있고 목록을 안 불러와 전부 0이 된다(안 그린다).
            <div className="flex items-baseline gap-x-3 whitespace-nowrap">
              <span className="text-xs">
                <b className="num text-foreground text-base font-bold">
                  {headerCounts ? headerCounts.total : items.length}
                </b>{" "}
                <span className="text-text-dim">{filterActive ? "필터 결과" : "전체"}</span>
              </span>
              <span className="text-xs">
                <b className="num text-gold text-base font-bold">
                  {headerCounts ? headerCounts.aiDone : aiDone}
                </b>{" "}
                <span className="text-text-dim">AI 분석 완료</span>
              </span>
              {/* '배정 완료'는 연결 학생의 수강까지 봐야 나오는 파생값이라 count 한 방으로 못 센다.
                  목록(페이지) 뷰에서 페이지 50행으로 세면 거짓말이 되므로 아예 안 띄운다(#89). */}
              {headerCounts ? null : (
                <span className="text-xs">
                  <b className="num text-primary text-base font-bold">{assigned.length}</b>{" "}
                  <span className="text-text-dim">배정 완료</span>
                </span>
              )}
            </div>
          )
        }
        selectedMonth={selectedMonth}
        selectedConsultant={selectedConsultant}
        selectedStage={selectedStage}
        searchQuery={searchQuery}
        view={view}
        consultants={consultants}
        selectedRange={selectedRange}
        todayMonth={todayMonth}
        minYear={minYear}
        receivedDay={view === "stats" ? null : receivedDay}
      />

      {/* 🔴 makeedu '보내기' 카드를 본문에 펼쳐 두지 않는다(원장 2026-09-01) — 매주 일요일 06:00(KST)에 동기화 PC
          워처가 같은 큐(makeedu_push_requests)로 자동 전송한다(scripts/_makeedu/weekly-push.cjs). 그 전에 골라
          보낼 건은 머리글 'makeedu 보내기' 버튼이 같은 카드를 다이얼로그로 연다(원장 2026-10-01). */}

      {/* 통계뷰는 빈 상태 사진 대신 자기 안에서 "집계할 상담이 없습니다"를 말한다(연도 선택을 남겨야 하므로). */}
      {view === "stats" && stats && dist && schoolPrefs ? (
        <>
        <IntakeTrendCard
          trend={intake?.trend ?? null}
          period={intakePeriod}
          today={today}
          groups={intake?.groups ?? {}}
          chartKind={savedIntakeChartKind(uiPrefs)}
          keep={{ view: "stats", year: yearParam, from: sp.from === "dashboard" ? "dashboard" : undefined, ...Object.fromEntries(Object.values(PROGRESS_KEYS).map((k) => [k, (sp as Record<string, string | undefined>)[k]])) }}
        />
        {progressRows ? (
          <OpsHistoryCard
            id="progress"
            title="상담 진행 기록"
            // 기호(⊃) 대신 말로 · 멈춘 상담은 창이 60일이라 접수(30일)보다 클 수 있다는 것을 적는다(검수 2026-10-22 — 화면에 '멈춘 21 > 접수 20').
            note="운영실 '상담 진행' 카드의 그날 값 · 접수~수업 시작 = 그날까지 최근 30일 접수 중 그 단계까지 간 건수 · 멈춘 상담 = 최근 60일 접수 중 결정 없이 멈춘 건수(기간이 달라 접수보다 많을 수 있습니다)"
            firstDate={firstRecorded(progressRows, (o) => !!o.consult)}
            period={progressPeriod}
            today={today}
            keys={PROGRESS_KEYS}
            keep={{ view: "stats", year: yearParam, from: sp.from === "dashboard" ? "dashboard" : undefined, ...Object.fromEntries(Object.values(INTAKE_TREND_KEYS).map((k) => [k, (sp as Record<string, string | undefined>)[k]])) }}
            charts={[
              {
                kind: "line",
                unit: "건",
                series: [
                  ...PROGRESS_STEPS.map((step, i) => ({
                    key: step.key as string,
                    name: step.label,
                    color: PROGRESS_COLORS[i % PROGRESS_COLORS.length]!,
                    values: opsSeries(progressRows, progressPeriod, (o) => o.consult?.counts[step.key]),
                    strong: i === 0,
                  })),
                  { key: "stalled", name: "멈춘 상담", color: "var(--color-danger)", values: opsSeries(progressRows, progressPeriod, (o) => o.consult?.stalled) },
                ],
              },
            ]}
            initialOff={savedProgressTrendOff(uiPrefs) ?? [...PROGRESS_DEFAULT_OFF]}
            onOff={saveProgressTrendOff}
            onMode={saveProgressTrendMode}
          />
        ) : null}
        <StatsView
          stats={stats}
          year={statsYear}
          periodText={span.from === span.to ? `${span.from}년` : `${span.from}~${span.to}년`}
          yearChips={statsYearChips}
          exits={managementExits}
          dist={dist}
          schoolPrefs={schoolPrefs}
        />
        </>
      ) : /* 빈 상태 판정은 rows.length이 아니라 total === 0 (2페이지가 비어 보이는 것과 진짜 0건은 다르다) */
      (view === "table" ? (headerCounts?.total ?? 0) === 0 : items.length === 0) ? (
        // 🔴 `w-full` 필수 — 목록뷰에선 바깥 틀이 세로 flex라 `mx-auto`만 두면 이 상자가 폭 0으로 접혀
        //    빈 안내가 안 보였다(칸반은 flex가 아니라 멀쩡 — 2026-09-22 빈 지점 점검).
        <div className="mx-auto w-full max-w-xl py-4">
          <PhotoCard
            src="/photos/enrollment-hero.webp"
            alt=""
            caption="진행 중인 상담이 없습니다"
            sub="QR 공개 접수 또는 신규 등록으로 첫 상담을 시작해 보세요"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : view === "table" && tablePage ? (
        <>
          {/* 시트형 표(원장 2026-09-02) — 필터·연월 피커는 칸반과 **같은 툴바**(위 KanbanFilters)이고 여기서
              바뀌는 건 본문뿐. '번호'는 페이지를 넘어 이어진다(1페이지 1~50 · 2페이지 51~).
              canWrite = 더블클릭 인라인 수정 노출(칸반 드래그와 같은 판정) — 게이트는 서버 액션이 다시 본다(#77).
              consultants = '상담사' 칸 선택지(툴바 상담사 필터와 같은 목록). */}
          <EnrollmentTable
            rows={tablePage.rows}
            nowMs={nowMs}
            startIndex={(page - 1) * PAGE_SIZE}
            canWrite={canWriteEnrollment}
            consultants={consultants}
          />
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(tablePage.total / PAGE_SIZE))}
            total={tablePage.total}
            hrefForPage={pageHref}
          />
        </>
      ) : (
        <EnrollmentKanban items={items} nowMs={nowMs} canWrite={canWriteEnrollment} />
      )}
    </div>
  );
}
