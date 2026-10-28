// 2.0 원생상담 목록 행(app/(shell)/consultations/_components/consultation-list.tsx) 통째 — 바꾼 곳은 가져오기 두 줄뿐
// (followUpUrgency를 서버 전용 queries.ts가 아니라 같은 함수의 원본 follow-up-urgency.ts에서 · 같은 폴더 상대 경로를 '@/' 경로로). verify가 글자를 대조한다.
import { SheetClassName, SheetText } from "@/features/teacher-view/interface-label";
import type { CSSProperties } from "react";
import { Mic, Sparkles } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Pill } from "@/components/atoms/pill";
import { AutoPageSize } from "@/components/auto-page-size";
import { consultationPreview } from "@/features/consultations/summary-preview";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import type { StudentConsultationRow } from "@/features/consultations/server/queries";
import { relativeTimeKo } from "@/lib/relative-time";
import { CATEGORY_META, URGENCY_META } from "@/app/(shell)/consultations/_components/consultation-meta";

/** 행 높이(h-11 44px) + 헤어라인 1px — AutoPageSize가 이 값으로 행 수를 센다. 행 높이를 바꾸면 여기도. */
export const CONSULT_ROW_PX = 45;
/**
 * 한 단의 **최소** 폭(rem) — 목록 폭이 `2 × 이 값 + 단 간격(1rem)` = 72rem(1,152px) 이상이면 2단이 선다
 * (원장 2026-09-30 *"적당한 너비에서 2단, 좁으면 1단"*). 통계 패널이 옆에서 빠진(2026-10-01) 뒤로 목록이 화면 폭을 다 쓴다.
 * 35.5rem(568px) = 2단이 막 서는 폭에서도 글 열이 읽히는 바닥(실측: 이름 112 · 과목·상담사 84 · 반 116px). 34rem이면 이름·반이
 * 104·102px로 눌려 30행 중 24행이 잘렸다.
 */
const COLUMN_REM = 35.5;
/** 단 수 상한 — 원장 2026-09-30 *"상담을 2단으로 줄이고"*. 통계 패널이 통계 화면으로 옮겨 간(2026-10-01) 뒤에도 2단이 상한이다(넓은 창은 단이 넓어진다). */
export const CONSULT_MAX_COLS = 2;
/**
 * 오른쪽 폭 고정 열(카테고리 | 후속 | 녹음·AI | 시각)의 폭(rem) — 실측(Pretendard, 2026-09-30): 알약 두 글자 44.2 ·
 * 후속 알약 최대 71.6("기한 경과" — 2026-10-21 '지연'에서 바꾸며 3.75rem → 4.75rem) · "녹음 AI" 85.4 · "2026. 12. 31." 98.2
 * (제목 '카테고리' 55px는 칸 52px에서 양옆 1.5px씩 간격에 걸친다). 옛 3단 시절(20.25rem = 324px)보다 4px 넓다.
 * 🔴 바깥 행 그리드의 오른쪽 트랙은 **이 합 + 안쪽 간격**으로 여기서 함께 도출한다 — 둘을 따로 적었다가 안쪽이 12px 넘쳤다
 *    (적대적 리뷰 2026-09-03). 바꿀 땐 여기 하나만.
 * 🔑 **녹음·AI 열은 행이 41rem(656px) 이상일 때만 선다** — 그보다 좁은 단에서 이 92px를 글 열(이름·과목·반)에 돌려준다
 *    (656px 아래에서 이 열까지 세우면 이름·반이 110px 밑으로 눌린다). 표식이 있는 상담은 드물고(실측 1,903건 중 1건),
 *    열이 접힌 행에선 과목·상담사 칸의 **배지**로 선다(사라지지 않는다). 1,920px 창(옆 패널이 빠진 2026-10-01부터 풀 셸 단 ≈815px · 창 단 ≈941px — 패널 시절 실측 663·789px에 패널 폭을 더한 계산)에선 네 열이 다 선다.
 */
const RIGHT_CAT_REM = 3.25;
const RIGHT_FOLLOW_REM = 4.75;
const RIGHT_MARKS_REM = 5.5;
const RIGHT_TIME_REM = 6.25;
const RIGHT_GAP_REM = 0.25; // = gap-1
const RIGHT_NARROW = [RIGHT_CAT_REM, RIGHT_FOLLOW_REM, RIGHT_TIME_REM];
const RIGHT_FULL = [RIGHT_CAT_REM, RIGHT_FOLLOW_REM, RIGHT_MARKS_REM, RIGHT_TIME_REM];
const widthOf = (cols: readonly number[]) => cols.reduce((a, b) => a + b, 0) + RIGHT_GAP_REM * (cols.length - 1);
const tracksOf = (cols: readonly number[]) => cols.map((r) => `${r}rem`).join(" ");
/**
 * 왼쪽 글 열 — 글자 크기는 그대로 두고 **폭만** 옛 3단 시절 밀도로 되돌렸다(원장 2026-09-30: 1,920px 창에서 2단 + 통계 패널 — 패널은 2026-10-01 통계 화면으로 옮겨 갔고 단은 그만큼 넓어졌다).
 * 실측 자연 폭(Pretendard): 이름+학년 중앙 106 · 상위 10% 121 · 최대 124px / 과목·상담사 상위 10% 81 · 최대 137px /
 * 반 이름 중앙 112 · 상위 10% 126 · 최대 153px. 세 열이 남는 폭을 **그 비율(31 : 21 : 32)**로 나눠 갖는다 — 한 열이 먼저
 * 최대까지 차고 나머지가 굶는 일이 없다(`minmax(최소, Nfr)`). 과목·상담사는 거의 같은 길이("수학 · 이성우" 81px)라 최소가 곧
 * 그 폭(5.25rem = 84px)이다 — 좁은 단에선 이 칸이 먼저 84px를 갖고 이름·반이 나머지를 나눈다.
 * 넘치는 값은 말줄임 + 마우스 오버 전문(원장 *"긴 값은 말줄임 허용"*).
 * 최소 합 = 6.5 + 5.25 + 5.5 = 17.25rem → 좁은 행 최소 폭 = 17.25 + 오른쪽 14.75 + 간격 0.5×3 + 좌우 여백 0.75 = 34.25rem ≤ 한 단 35.5rem,
 * 보통 행 최소 폭 = 17.25 + 오른쪽 20.5 + 2.25 = 40rem ≤ 41rem(녹음·AI 열이 서는 폭).
 */
const NAME_MIN = "6.5rem";
const WHO_MIN = "5.25rem";
const CLASS_MIN = "5.5rem";
/** 요약 열이 서는 넓은 행(64rem 이상)에선 글 열을 실측 최대 폭에서 멈춘다 — 남는 폭은 요약 몫이다. */
const NAME_WIDE = `minmax(${NAME_MIN},7.75rem)`;
const WHO_WIDE = `minmax(${WHO_MIN},8.5rem)`;
const CLASS_WIDE = `minmax(${CLASS_MIN},9.75rem)`;
/**
 * 제목 행을 몇 벌 그려 두나 — 단마다 하나씩 서야 하는데 단 수는 폭이 정한다(CSS 다단, 상한 2). 제목 행은 다단과 **같은 식**으로
 * 단을 세는 격자에 두 벌을 넣고 첫 줄만 보이게 잘라 낸다. `auto-fit`이라 측정 전(첫 페인트)에도 빈 트랙이 접혀 목록과 단 폭이 같다.
 */
const LIST_HEADER_COPIES = CONSULT_MAX_COLS;
const COL_GRID = `repeat(var(--cols, auto-fit), minmax(min(${COLUMN_REM}rem, 100%), 1fr))`;
/**
 * 행 격자 세 벌 — 행(=단) 폭이 정한다(`@container/row`):
 *   좁음(<41rem)  이름 | 과목·상담사 | 반 | [카테고리·후속·시각]
 *   보통(41rem~)  이름 | 과목·상담사 | 반 | [카테고리·후속·녹음·AI·시각]
 *   넓음(64rem~)  이름 | 과목·상담사 | 반 | 요약 | [카테고리·후속·녹음·AI·시각]
 * 오른쪽 블록은 늘 **마지막 트랙**(`-col-end-1`)에 앉는다 — 요약·반 열이 없는 벌에서도 자리를 따로 세지 않는다.
 * 🔴 폰 두 줄 카드(`phone:`)는 이 벌들과 같은 속성을 다투므로 `!`로 이긴다(폭 656px 넘는 폰 가로·좁은 브라우저).
 */
const ROW_GRID = "grid-cols-(--row-s) @min-[41rem]/row:grid-cols-(--row-m) @5xl/row:grid-cols-(--row-l)";
const RIGHT_GRID = "grid-cols-(--right-s) @min-[41rem]/row:grid-cols-(--right-m)";

function rowGridVars(classOn: boolean): CSSProperties {
  // 반 칸(0318a)이 없으면 그 열을 통째로 뺀다([[#95]] — '—'만 늘어선 열은 "매핑이 고장 났다"로 읽힌다).
  const text = classOn
    ? `minmax(${NAME_MIN},31fr) minmax(${WHO_MIN},21fr) minmax(${CLASS_MIN},32fr)`
    : `minmax(${NAME_MIN},31fr) minmax(${WHO_MIN},21fr)`;
  const wide = classOn ? `${NAME_WIDE} ${WHO_WIDE} ${CLASS_WIDE}` : `${NAME_WIDE} ${WHO_WIDE}`;
  return {
    "--row-s": `${text} ${widthOf(RIGHT_NARROW)}rem`,
    "--row-m": `${text} ${widthOf(RIGHT_FULL)}rem`,
    "--row-l": `${wide} minmax(0,1fr) ${widthOf(RIGHT_FULL)}rem`,
    "--right-s": tracksOf(RIGHT_NARROW),
    "--right-m": tracksOf(RIGHT_FULL),
  } as CSSProperties;
}

/**
 * 마우스 오버 전문 — 행에는 이름·학년·배지·시각만 남기고(원장 *"기본은 그냥 칸반"*) 요약·상담사·후속은 여기로
 * (등록상담 카드와 같은 규약: [column-cards.tsx](../../enrollment/_components/column-cards.tsx)).
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다 — 행을 열면 상세에 전부 있으므로 폰에서도 한 번의 탭으로 닿는다.
 */
function hoverTextOf(c: StudentConsultationRow, classOn: boolean): string | undefined {
  const who = [c.subject, c.counselorName ? `${c.counselorName} 상담` : null].filter(Boolean).join(" · ");
  const followUp =
    c.followUpAction || c.followUpDate
      ? `후속 조치: ${c.followUpAction ?? "—"}${c.followUpDate ? ` · 기한 ${c.followUpDate}` : ""}${c.followUpDone ? " · 완료" : ""}`
      : null;
  const marks = [c.hasAudio ? "녹음 있음" : null, c.hasAi ? "AI 분석됨" : null].filter(Boolean).join(" · ");
  return (
    [
      `${c.studentName}${c.studentGrade ? ` (${c.studentGrade})` : ""}`,
      who || null,
      classOn ? `반: ${c.className ?? "없음"}${c.classSource === "manual" ? "(직접 고름)" : ""}` : null,
      c.summary?.trim() || null,
      followUp,
      marks || null,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

/**
 * 원생상담 목록 — 행 = 표처럼 열이 선다: 이름(학년) | 과목 · 상담사 | 반 이름 | 요약(행이 넓을 때만) | 카테고리 | 후속 | 녹음·AI | 시각.
 * 행 사이는 헤어라인(§11 — 카드로 싸지 않는다), 행 전체가 상세 링크(§10 — 행 안 아이콘 버튼 금지, 삭제는 상세에).
 * 🔴 **단 수는 폭이 정한다**(CSS 다단, 한 단 최소 35.5rem · 상한 2단). 🔴 **행 수는 높이가 정한다**(AutoPageSize → ?size=N) —
 *    쪽 크기는 단 수와 무관하게 `한 단 행 수 × 2`라 단 경계를 넘나들어도 쪽이 튀지 않는다(원장 *"페이지당 건수는 단 수와 무관하게 일정"*).
 */
export function ConsultationList({
  items,
  size,
  pageSizeKey,
  classOn,
}: {
  items: StudentConsultationRow[];
  size: number;
  pageSizeKey: string;
  /** 0318a 반 칸이 있나 — 없으면 '반 이름' 열을 뺀다. */
  classOn: boolean;
}) {
  const vars = rowGridVars(classOn);
  return (
    // AutoPageSize가 루트다 — 제목·테두리 격자와 목록이 같은 `--cols`(채울 수 있는 단 수)를 읽어야 해서 한 상자 안에 둔다.
    <AutoPageSize
      size={size}
      rowPx={CONSULT_ROW_PX}
      storageKey={pageSizeKey}
      maxCols={CONSULT_MAX_COLS}
      pageCols={CONSULT_MAX_COLS}
      className="relative"
    >
      {/* 단마다 테두리 — 다단의 단은 요소가 아니라 테두리를 두를 수 없다. 제목 행과 같은 격자로 **단 크기의 빈 상자**를 뒤에 깔고
          그 위에 제목·목록을 얹는다. 링(shadow-card)은 상자 밖에 그려져 overflow에 잘리므로 여기만 border([[#114]]). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid auto-rows-[100%] gap-x-4 overflow-hidden"
        style={{ gridTemplateColumns: COL_GRID }}
      >
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} className="border-line rounded-lg border" />
        ))}
      </div>
      {/* 제목 행 — 아래 행과 같은 열 격자(행 격자 세 벌)라 글자가 열 위에 정확히 선다. 머리 라벨은 **그 열 본문과 같은 정렬**
          (표 규약 "제목도 같은 쪽"): 글 열(학생·과목·반 이름·요약)은 본문이 왼쪽이라 왼쪽, 칩 열(카테고리·후속·녹음·AI)은 가운데,
          시각은 오른쪽. 반 이름은 4~15자로 길이가 들쭉날쭉해 가운데로 모으면 줄마다 시작이 달라진다 → 이웃 글 열과 같이 왼쪽. */}
      <div
        className="relative grid h-9 auto-rows-[100%] gap-x-4 overflow-hidden phone:hidden"
        style={{ ...vars, gridTemplateColumns: COL_GRID }}
        data-list-header=""
      >
        {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
          <div key={i} aria-hidden={i > 0 ? "true" : undefined} className="@container/row">
            <div className={`text-text-dim grid h-full items-center gap-2 px-1.5 text-sm font-bold ${ROW_GRID}`}>
              <span className="truncate text-left"><SheetText value={"학생"} /></span>
              <span className="truncate text-left"><SheetText value={"과목 · 상담사"} /></span>
              {classOn ? <span className="truncate text-left"><SheetText value={"반 이름"} /></span> : null}
              <span className="hidden text-left @5xl/row:block"><SheetText value={"요약"} /></span>
              <div className={`-col-end-1 grid items-center justify-items-center gap-1 whitespace-nowrap ${RIGHT_GRID}`}>
                <span><SheetText value={"카테고리"} /></span>
                <span><SheetText value={"후속"} /></span>
                <span className="hidden @min-[41rem]/row:block"><SheetText value={"녹음·AI"} /></span>
                <span className="justify-self-end"><SheetText value={"시각"} /></span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <ul
        data-autopage-list=""
        className="gap-x-4 [&>li]:break-inside-avoid"
        // 🔴 `column-count`는 변수(상한 2) — 폭이 허락해도 3단이 서지 않는다. `column-fill`도 변수(기본 balance) — 상수 `auto`면
        //    높이가 없는 모든 순간이 1단이 된다(원장 제보 2026-09-09, AutoPageSize 주석).
        style={{
          ...vars,
          columnWidth: `${COLUMN_REM}rem`,
          columnCount: `var(--cols, ${CONSULT_MAX_COLS})`,
          // CSSProperties의 columnFill은 리터럴 유니온이라 변수를 못 받는다 — 값은 유효한 CSS다.
          columnFill: "var(--col-fill, balance)" as React.CSSProperties["columnFill"],
          height: "var(--list-h, auto)",
        }}
      >
        {items.map((c) => (
          <ConsultationRow key={c.id} c={c} classOn={classOn} />
        ))}
      </ul>
    </AutoPageSize>
  );
}

function ConsultationRow({ c, classOn }: { c: StudentConsultationRow; classOn: boolean }) {
  const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
  const catMeta = c.category ? CATEGORY_META[c.category] : null;
  const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
  const who = [c.subject, c.counselorName].filter(Boolean).join(" · ");
  const className = c.className ?? "—";
  // 녹음·AI 표식 — 아이콘만으로 뜻을 전하지 않는다(§2): 옆에 읽히는 글자를 둔다. 넓은 행은 제 열에, 좁은 행은 과목·상담사 칸의 배지로.
  const marks =
    c.hasAudio || c.hasAi ? (
      <>
        {c.hasAudio ? (
          <span className="text-primary inline-flex items-center gap-0.5 text-sm font-bold whitespace-nowrap">
            <Mic className="size-4" />
            <SheetText value={"녹음"} /></span>
        ) : null}
        {c.hasAi ? (
          <span className="text-gold inline-flex items-center gap-0.5 text-sm font-bold whitespace-nowrap">
            <Sparkles className="size-4" />
            AI
          </span>
        ) : null}
      </>
    ) : null;
  return (
    // @container/row — 이 행(=단)의 폭이 행 격자 세 벌(위 ROW_GRID 주석)을 고른다.
    <li title={hoverTextOf(c, classOn)} className="@container/row border-line border-t">
      {/* 폰(`phone:` = 최상위 프레임 <768px)은 두 줄 — [이름 | 과목·상담사(·반)] / [카테고리 · 후속 · 녹음·AI · 시각].
          🔴 `max-md:`가 아니다 — 이 창은 기본 크기가 760px(<768)이라 `max-md:`면 데스크톱 창이 폰 카드로 바뀐다. */}
      <WindowLink
        href={`/consultations/${c.id}`}
        title={c.studentName}
        className={`hover:bg-bg-soft grid h-11 items-center gap-2 rounded-lg px-1.5 transition ${ROW_GRID} phone:h-auto phone:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]! phone:gap-y-1 phone:py-1.5 ${
          isUrgent ? "bg-danger-soft" : ""
        }`}
      >
        {/* 이름 24px, 학년 18px — 1차 핵심값이라 이 칸엔 이름·학년만(배지가 같이 서면 이름을 민다). */}
        <p className="text-foreground min-w-0 truncate text-xl leading-none font-bold">
          {c.studentName}
          {c.studentGrade ? <span className="text-text-dim ml-1 text-base font-semibold">({c.studentGrade})</span> : null}
        </p>
        {/* 과목 · 상담사 — 동기화·수정중 배지는 여기(2차 정보 칸)에. 폰에선 반 이름도 여기 붙는다(반 열이 폰에서 숨는다). */}
        <p className="text-text-dim flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="min-w-0 truncate">
            {who}
            {classOn && c.className ? <span className="hidden phone:inline"> · <SheetClassName value={c.className} /></span> : null}
          </span>
          {c.syncAddedAt ? <MakeeduOriginTag /> : null}
          <EditingBadge scope={`student-consultation:${c.id}`} />
          {/* 녹음·AI 열이 접힌 좁은 행 — 표식이 사라지지 않게 여기(배지 자리)에 세운다. 폰은 아래 둘째 줄에 제 자리가 있다. */}
          {marks ? <span className="inline-flex shrink-0 items-center gap-1.5 @min-[41rem]/row:hidden phone:hidden">{marks}</span> : null}
        </p>
        {/* 반 이름 — 상담사가 가르치는 반(판정 한 벌: scripts/_makeedu/consultation-class.cjs). 못 정하면 '—'(추측 금지). */}
        {classOn ? (
          <p className={`min-w-0 truncate text-sm font-medium phone:hidden ${c.className ? "text-text-dim" : "text-muted-foreground"}`} title={c.className ?? "반 없음"}>
            {className}
          </p>
        ) : null}
        {/* 요약 한 줄 — 2차 정보라 말줄임 허용(§1). 전문은 마우스 오버·상세. */}
        <p className="text-text-faint hidden min-w-0 truncate text-sm @5xl/row:block" title={c.summary}>
          {consultationPreview(c.summary)}
        </p>
        {/* 오른쪽은 **열**이다 — 카테고리 | 후속 | 녹음·AI | 시각, 칸 폭 고정이라 행마다 배지 수가 달라도 같은 자리에 선다. */}
        <div
          className={`-col-end-1 grid items-center justify-items-center gap-1 ${RIGHT_GRID} phone:col-start-1 phone:grid-cols-[auto_auto_auto_minmax(0,1fr)]! phone:justify-items-start phone:gap-2`}
        >
          <span>{catMeta ? <Pill color={catMeta.color}>{catMeta.label}</Pill> : null}</span>
          <span>{urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}</span>
          {/* 좁은 단에선 이 열이 접히고(위 RIGHT 주석) 표식은 과목·상담사 칸의 배지로 간다. */}
          <span className="hidden items-center gap-1.5 @min-[41rem]/row:flex phone:flex!">{marks}</span>
          <span className="num text-text-dim justify-self-end text-sm whitespace-nowrap">{relativeTimeKo(c.consultedAt)}</span>
        </div>
      </WindowLink>
    </li>
  );
}
