// 2.0 회의록 목록(app/(shell)/meetings/page.tsx)의 조립 — 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회(getMeetingsPage)는
// /api/v2/meetings(Docker 복사본 · v2-screen-meetings.mjs가 2.0 함수를 그대로 돌린다)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 자리뿐이다(meetings-page.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-meetings.mjs가 2.0 본문에
// 같은 짝을 대어 이 파일과 글자를 대조한다.
import type { CSSProperties } from "react";
import { Mic, RefreshCw } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { toneColor } from "@/lib/design/semantic-color";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { PageHeader } from "@/components/page-header";
import { PhotoCard } from "@/components/atoms/photo-card";
import { FilterSelect } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { MeetingListResult, MeetingProcessingStatus, MeetingRow } from "@/features/meetings/server/queries";
import type { MeetingRangeKey as RangeKey, MeetingStatusKey as StatusKey } from "@/features/meetings/list-filter";
import { NewMeetingTrigger } from "@/app/(shell)/meetings/_new-meeting-trigger";
import { Pagination } from "@/components/pagination";

/** /api/v2/meetings — 2.0 page가 서버에서 받던 값(getMeetingsPage 결과 그대로). */
export type MeetingsListData = { result: MeetingListResult };

const PAGE_SIZE = 50;

/**
 * 색은 의미색 캐논(src/lib/design/semantic-color.ts) — 대기=caution → 처리중=info → 완료=positive /
 * 실패=critical. 한 줄에 하나만 뜨는 순차 상태라 '전사 중'과 '분석 중'은 같은 info로 둔다
 * (v4 이전엔 분석 중만 primary 네이비였는데, 같은 "처리 중"이 단계마다 다른 색일 이유가 없다).
 */
const STATUS_META: Record<MeetingProcessingStatus, { label: string; color: PillColor } | null> = {
  idle: null,
  uploaded: { label: "대기", color: toneColor("caution") },
  transcribing: { label: "전사 중", color: toneColor("info") },
  analyzing: { label: "분석 중", color: toneColor("info") },
  completed: { label: "완료", color: toneColor("positive") },
  failed: { label: "실패", color: toneColor("critical") },
};

/** 행의 일시 칸 — `2026. 09. 04.`(고정 폭 열에 들어가는 짧은 꼴). 요일까지 붙은 긴 꼴은 마우스 오버(hoverTextOf). */
function formatHeldAt(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatHeldAtLong(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

/**
 * 오른쪽 폭 고정 열(상태 | 녹음 | 참석 | 작성자 | 일시)의 폭(rem) — 16px 라벨 기준: 알약 '전사 중' ≤64 · '녹음'+아이콘 ≈56 ·
 * '12명' ≈40 · 이름 세 글자 ≈52 · '2026. 12. 31.' ≈98(학생상담 실측값과 같은 글꼴). 바깥 행 그리드의 오른쪽 트랙은
 * **이 합 + 안쪽 간격**으로 여기서 함께 도출한다(따로 적으면 간격만큼 어긋난다 — 학생상담 리뷰 확정 결함).
 */
const RIGHT_COLS_REM = [4, 3.5, 3.5, 5.5, 6.5] as const;
const RIGHT_GAP_REM = 0.25; // = gap-1
const RIGHT_W_REM = RIGHT_COLS_REM.reduce<number>((a, b) => a + b, 0) + RIGHT_GAP_REM * (RIGHT_COLS_REM.length - 1);
const ROW_GRID_VARS = {
  "--right-w": `${RIGHT_W_REM}rem`,
  "--right-cols": RIGHT_COLS_REM.map((r) => `${r}rem`).join(" "),
} as CSSProperties;
/**
 * 행 격자: 제목 | (요약 — 행이 56rem 이상일 때만) | 오른쪽 고정 열. 학생상담과 달리 요약이 숨는 폭에서는 제목이 남는 폭을
 * **다 쓴다**(2트랙 격자로 바뀐다) — 빈 트랙을 남겨 두면 최소 창(760)에서 제목 옆이 비고 제목만 잘렸다.
 * 🔴 제목 행과 본문 행이 **같은 문자열**을 써야 라벨이 열 위에 정확히 선다.
 */
const ROW_COLS =
  "grid-cols-[minmax(0,1fr)_var(--right-w)] @4xl/row:grid-cols-[minmax(12rem,1fr)_minmax(0,1.2fr)_var(--right-w)]";
const RIGHT_START = "col-start-2 @4xl/row:col-start-3";

/**
 * 마우스 오버 전문 — 행에는 제목·상태·참석 수·작성자·일시만 남기고 요약·참석자 이름·긴 일시는 여기로(학생상담·등록상담 카드 규약).
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다 — 행을 열면 상세에 전부 있다.
 */
function hoverTextOf(m: MeetingRow): string {
  return [
    formatHeldAtLong(m.heldAt),
    m.attendees.length > 0 ? `참석 ${m.attendees.length}명: ${m.attendees.join(", ")}` : null,
    m.summaryFull ?? m.excerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

function MeetingItem({ m }: { m: MeetingRow }) {
  const badge = STATUS_META[m.processingStatus];
  const isLive = m.processingStatus === "transcribing" || m.processingStatus === "analyzing";
  return (
    // @container/row — 요약 열은 이 행이 56rem(896px) 이상일 때만 선다. 그보다 좁으면 제목·고정 열만.
    <li title={hoverTextOf(m)} className="@container/row border-line border-t">
      {/* aria-label을 달지 않는다 — 달면 보조기기엔 제목만 남고 배지·일시가 사라진다(학생상담 리뷰 확정 결함). */}
      <WindowLink
        href={`/meetings/${m.id}`}
        title={m.title}
        // 진행 중 행은 hover에도 틴트를 잃지 않는다(같은 축 유틸이 겹치면 CSS 순서가 이긴다 — [[#116]]).
        className={`grid h-11 ${ROW_COLS} items-center gap-3 px-2.5 transition ${
          isLive ? "bg-blue-soft/60 hover:bg-blue-soft" : "hover:bg-bg-soft"
        }`}
      >
        {/* 제목 18px 굵게 — 1차 핵심값. 수정중 배지만 옆에(상태·녹음은 오른쪽 열로 — 제목 칸에 같이 서면 제목을 민다). */}
        <p className="text-foreground flex min-w-0 items-center gap-2 text-base leading-none font-bold">
          <span className="min-w-0 truncate">{m.title}</span>
          <EditingBadge scope={`meeting:${m.id}`} />
        </p>
        {/* 요약 한 줄 — 2차 정보라 말줄임 허용(§1). 전문은 마우스 오버·상세. */}
        <p className="text-text-faint hidden min-w-0 truncate text-sm @4xl/row:block">{m.excerpt}</p>
        {/* 오른쪽은 **열**이다 — 상태 | 녹음 | 참석 | 작성자 | 일시, 칸 폭 고정이라 행마다 배지 유무가 달라도 같은 자리에.
            🔴 col-start — 요약 열이 숨는 폭(display:none)에서 이 블록이 둘째 트랙으로 자동 배치돼야 하므로 격자와 짝으로 바뀐다. */}
        <div className={`${RIGHT_START} grid grid-cols-(--right-cols) items-center justify-items-center gap-1`}>
          <span>
            {isLive ? (
              <Pill color={toneColor("info")} soft={false}>
                진행 중
              </Pill>
            ) : badge ? (
              <Pill color={badge.color}>{badge.label}</Pill>
            ) : null}
          </span>
          {/* 아이콘만으로 뜻을 전하지 않는다(§2) — 옆에 읽히는 글자. */}
          <span>
            {m.hasAudio ? (
              <span className="text-primary inline-flex items-center gap-0.5 text-sm font-bold whitespace-nowrap">
                <Mic className="size-4" />
                녹음
              </span>
            ) : null}
          </span>
          <span className="num text-text-dim text-sm whitespace-nowrap">
            {m.attendees.length > 0 ? `${m.attendees.length}명` : null}
          </span>
          <span className="text-text-dim w-full min-w-0 truncate text-center text-sm">{m.authorName ?? ""}</span>
          <span className="num text-text-dim justify-self-end text-sm whitespace-nowrap">{formatHeldAt(m.heldAt)}</span>
        </div>
      </WindowLink>
    </li>
  );
}

/** 드롭다운 항목 — 해제 항목('전체')은 FilterSelect가 맨 위에 스스로 세운다(축 이름은 `axisLabel`, `allLabel`에 넣지 말 것). */
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all">; label: string }[] = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "month", label: "이번 달" },
];

const STATUS_OPTIONS: { value: Exclude<StatusKey, "all">; label: string }[] = [
  { value: "completed", label: "완료" },
  { value: "processing", label: "처리 중" },
  { value: "failed", label: "실패" },
  { value: "idle", label: "수동" },
];

export function MeetingsPage({
  data,
  sp: searchParams,
}: {
  data: MeetingsListData;
  sp: { range?: RangeKey; status?: StatusKey; q?: string; page?: string };
}) {
  const sp = searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // 목록은 서버가 걸러 한 페이지만 준다(T6·N8) — 전사 원문 전체를 받지 않고, 검색은 제목·참석자·AI 요약·전사까지.
  const result = data.result;
  const rows = result.ok ? result.rows : [];
  const total = result.ok ? result.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const counts = result.ok ? result.counts : { all: 0, completed: 0, inProgress: 0 };

  // 필터 드롭다운(FilterSelect)은 page를 지워 자동 1페이지 리셋. pageHref만 p>1에서 page= 세팅 — URL 원값을 잇는다.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (sp.range) params.set("range", sp.range);
    if (sp.status) params.set("status", sp.status);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/meetings?${s}` : "/meetings";
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      <div className="compact-chrome:hidden">
        <PageHeader eyebrow="운영" title="회의록" />
      </div>

      {/* Stat strip — Editorial 문법 ②(BigStat 공용 아톰) */}
      <StatStrip>
        <BigStat label="전체 회의" value={counts.all} unit="건" tone="primary" icon={<Mic size={16} strokeWidth={1.8} />} />
        <BigStat label="AI 분석 완료" value={counts.completed} unit="건" tone="gold" icon={<MenuGlyph name="sparkle" size={22} />} />
        <BigStat label="처리 중" value={counts.inProgress} unit="건" tone="rose" icon={<RefreshCw size={16} strokeWidth={1.8} />} />
      </StatStrip>

      {/* 결과 줄 + 필터 — 지시서 §10: 필터는 축마다 라벨 하나(`기간: 최근 7일`처럼 축이 붙어 읽힌다) · 검색은 눌러야 나온다.
          옛 칩 두 묶음(기간 4·상태 5) + 상시 검색창은 걷었다. 최소 창(760)에서 결과 줄과 드롭다운 둘·검색이 한 줄에 선다
          (검색을 펼쳐도 ~640px). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          결과 <span className="text-foreground font-bold">{total}</span>건
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            paramName="range"
            value={range === "all" ? "" : range}
            options={RANGE_OPTIONS}
            axisLabel="기간"
            ariaLabel="기간 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <FilterSelect
            paramName="status"
            value={status === "all" ? "" : status}
            options={STATUS_OPTIONS}
            axisLabel="상태"
            ariaLabel="상태 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <SearchToggle placeholder="제목·참석자·내용" defaultValue={q} />
          <NewMeetingTrigger />
        </div>
      </div>

      {!result.ok ? (
        // 조회 실패를 "회의 없음"으로 보이지 않는다(T6) — 한글 요약 + 원문은 툴팁.
        <p className="bg-danger-soft text-danger rounded-xl px-4 py-3 text-sm" role="alert" title={result.raw}>
          회의록을 불러오지 못했습니다 — {result.error}
        </p>
      ) : total === 0 ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/meetings-hero.webp"
            alt=""
            caption="기록된 회의가 없습니다"
            sub="녹음을 올리면 전사와 AI 분석이 자동으로 정리됩니다"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : (
        <>
          {/* 목록 = 행(§11 — 카드로 싸지 않는다): 제목 | 요약(넓을 때만) | 상태·녹음·참석·작성자·일시 고정 열. 행 사이 헤어라인,
              행 전체가 상세 링크, 행 안 아이콘 버튼 없음. 옛 카드(아이콘 상자 + 2줄 요약 + 참석자 줄, 행당 ~130px)는 44px 행이 됐다.
              카드 안이라 hover 배경이 모서리를 넘지 않게 overflow-hidden(링은 box-shadow라 안 잘린다). */}
          <div className="bg-card shadow-card overflow-hidden rounded-2xl" style={ROW_GRID_VARS}>
            {/* 제목 행 — 아래 행과 같은 열 격자라 라벨이 열 위에 정확히 선다. 글 열(회의·요약)은 본문이 좌측이라 좌측,
                고정 열은 본문이 가운데라 가운데, 일시는 우측 끝(학생상담 "열정렬" 규약). */}
            <div className="@container/row">
              <div className={`text-text-dim grid h-9 ${ROW_COLS} items-center gap-3 px-2.5 text-sm font-bold`}>
                <span className="text-left">회의</span>
                <span className="hidden text-left @4xl/row:block">요약</span>
                <div
                  className={`${RIGHT_START} grid grid-cols-(--right-cols) items-center justify-items-center gap-1 whitespace-nowrap`}
                >
                  <span>상태</span>
                  <span>녹음</span>
                  <span>참석</span>
                  <span>작성자</span>
                  <span className="justify-self-end">일시</span>
                </div>
              </div>
            </div>
            <ul>
              {rows.map((m) => (
                <MeetingItem key={m.id} m={m} />
              ))}
            </ul>
          </div>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
