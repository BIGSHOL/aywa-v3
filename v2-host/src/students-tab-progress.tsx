// 원생 상세 '진도' 탭 — 2.0 _tabs/progress-tab.tsx(ProgressTab)와 그 위 진도 분석 패널(features/progress/components/progress-panel.tsx —
// ProgressContainerPanel)은 서버 컴포넌트라 본문을 **글자 그대로** 옮겼다. 바꾼 곳은 서버 조회 자리뿐이다(students-tab-progress.swaps.json ·
// verify-v2-students-tabs-b.mjs가 대조). 자료는 상세와 함께 온다(v2-students-tab-progress.mjs loadTab → useStudentTab).
// 2.0 진도 탭의 날짜 조회는 GET 폼(문서 이동)이라 iframe 안에서 그대로 내보내면 이 화면 밖으로 나간다 — 맨 아래 ProgressTab 감싸개가
// 폼 제출과 맨 `<a>` 이동만 받아 같은 화면의 주소 이동(hostNavigate)으로 바꾼다(본문은 그대로).
import type { FormEvent, MouseEvent } from "react";
import { SheetText } from "@/features/teacher-view/interface-label";
import type { LessonReportRow } from "@/features/students/server/queries";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { EmbedAnchor, EmbedHiddenInput } from "@/components/embed-link";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { classnoteBadge } from "@/features/onescreen/classnote-badge";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { ReportOpenLink } from "@/app/(shell)/students/[id]/_tabs/report-open-link";
import { ProgressCell } from "@/app/(shell)/students/[id]/_tabs/progress-cell";
import { canResolveProgressAnomaly } from "@/features/progress/anomaly-gate";
import type { ProgressAnomaly, StudentProgressAnalytics, TrackAnalytics } from "@/features/progress/server/queries";
import { AnomalyResolveButton } from "@/features/progress/components/anomaly-resolve-button";
import type { Access } from "@/lib/permissions";
import type { TenantSettings } from "@/features/owner/settings-types";
import { hostNavigate } from "../shims/host-nav";
import { useStudentTab, isMissingTab, MissingTab } from "./students-shared";

/** 2.0 STUDENT_REPORTS_PAGE_SIZE(서버 전용 파일의 값 — 시험이 대조). */
const STUDENT_REPORTS_PAGE_SIZE = 10;

/** v2-students-tab-progress.mjs loadTab 반환. */
type ProgressTabData = {
  first: { rows: LessonReportRow[]; total: number };
  shown: { rows: LessonReportRow[]; total: number } | null;
  analytics: StudentProgressAnalytics;
  anomalyGate: { level: Access; owns: boolean };
  settings: Pick<TenantSettings, "operations" | "modules">;
};

// 진도 현황 패널 — 학생 상세 진도 탭 상단. 활성 컨테이너(현행/선행)별 현재위치·진도율·속도·또래 백분위·예측
// + 학생 단위 이상감지 카드. 데이터는 서버 쿼리(순수 analytics 산출). 진도 기록 없으면 안내문.

const TRACK_LABEL: Record<TrackAnalytics["track"], string> = { current: "현행 진도", ahead: "선행 진도" };
const MIN_POOL = 3; // 백분위 표본 최소치(미만이면 "표본 부족")

function fmtSpeed(n: number): string {
  return n > 0 ? `${n.toFixed(1)} 차시/수업일` : "표본 부족";
}

// 라벨은 알림 본문(events-core PROGRESS_ANOMALY_LABEL)과 같은 표현 — 벨에서 보고 온 사람이 같은 말을 봐야 한다.
function anomalyLabel(type: string): string {
  if (type === "jump_error") return "진도 점프";
  if (type === "overlap_error") return "선행·현행 겹침";
  return "진도 이상"; // 미지의 유형이라도 raw enum은 화면에 안 낸다
}

/** 감지 시각 — KST 날짜(전역 규약: 표시 타임존은 Asia/Seoul 고정). */
function fmtDetectedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/**
 * 한 건의 설명문 — 언제 · 어디서 어디로 · 몇 차시. 위치를 모르면 그 조각만 뺀다(없는 사실 안 지어냄).
 * `muted` = 확인 완료 목록용(전체를 흐리게, 강조 없음).
 */
function AnomalyLine({ a, muted }: { a: ProgressAnomaly; muted?: boolean }) {
  const move = a.from && a.to ? `${a.from.grade} ${a.from.lesson} → ${a.to.grade} ${a.to.lesson}` : null;
  return (
    <span className={`break-keep text-xs leading-snug ${muted ? "text-text-faint" : "text-text-dim"}`}>
      <span className={muted ? "" : "text-danger font-bold"}>{anomalyLabel(a.type)}</span>
      <span className="text-text-faint mx-1.5">·</span>
      <span className="num">{fmtDetectedAt(a.at)}</span>
      {move ? (
        <>
          <span className="text-text-faint mx-1.5">·</span>
          <span className={muted ? "" : "text-foreground"}>{move}</span>
        </>
      ) : null}
      {a.jumpSize != null && a.jumpSize > 0 ? (
        <span className="text-text-faint"> ({a.jumpSize}차시 건너뜀)</span>
      ) : null}
      {/* 확인 주체 — 사람이 누른 것(0151a)과 시스템 자동 확인(2026-08-20 같은 선생님 규칙)을 구분한다.
          자동 확인분에 "확인자 미상"이라고 적으면 누가 껐는지 영영 알 수 없는 기록처럼 보인다. */}
      {muted && a.resolvedAt ? (
        <span className="ml-1.5">
          — {a.autoResolvedLabel ?? `${a.resolvedByName ?? "확인자 미상"} 확인`} · {fmtDetectedAt(a.resolvedAt)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 이상 감지 카드 — 진도 이상 알림(벨)이 착지하는 화면. 유형만 던지지 말고 **무엇이 어떻게 이상한지**를
 * 적는다: 언제 · 어디서 어디로 · 몇 차시. 이게 있어야 어느 보고서의 진도를 고칠지 판단할 수 있다.
 * 각 줄에 "이상 없음" 버튼(0151a) — 진도 점프의 상당수는 정상(선행 시작·교재 건너뜀·반 이동)이라 끌 수
 * 있어야 한다. 끌 수 없는 경고는 결국 통째로 무시된다.
 */
function AnomalyCard({ anomalies, canResolve }: { anomalies: readonly ProgressAnomaly[]; canResolve: boolean }) {
  return (
    <div className="border-danger/25 bg-danger-soft/40 rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-danger rounded-pill px-2 py-0.5 text-xs font-bold text-white">진도 확인 필요</span>
        <p className="text-foreground text-sm font-bold">최근 이상 감지 {anomalies.length}건</p>
      </div>
      <ul className="mt-2 space-y-1.5">
        {anomalies.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AnomalyLine a={a} />
            {canResolve ? <AnomalyResolveButton eventId={a.id} resolved={false} /> : null}
          </li>
        ))}
      </ul>
      <p className="text-text-faint mt-2 text-xs leading-snug break-keep">
        진도 점프는 <b>같은 선생님이 쓴 직전 진도와 비교</b>합니다 — 담당이 다른 진도(부담임 등)와는
        비교하지 않으므로 경고하지 않습니다. 아래 수업 진도 표에서 해당 날짜의 진도 입력이 맞는지 확인해
        주세요. 선행을 시작했거나 교재를 건너뛴 경우라면 정상입니다 — <b>이상 없음</b>을 누르면 이 학생의
        진도 경고(원스크린 배지 포함)가 꺼집니다.
      </p>
    </div>
  );
}

/**
 * 확인 완료 목록 — 접어 두되 **지우지는 않는다**. 누가 언제 정상이라고 판단했는지가 남아야 나중에
 * 되짚을 수 있고, 오판이면 되돌릴 수 있어야 한다.
 */
function ResolvedAnomalies({ anomalies, canResolve }: { anomalies: readonly ProgressAnomaly[]; canResolve: boolean }) {
  return (
    <details className="border-line bg-bg-soft/40 rounded-2xl border px-4 py-2.5">
      <summary className="text-text-dim cursor-pointer text-xs">
        이상 없음으로 확인한 기록 <b className="text-foreground">{anomalies.length}</b>건
        <span className="text-text-faint ml-1.5">(사람이 확인한 것 + 같은 선생님 진도 기준 자동 확인)</span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {anomalies.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AnomalyLine a={a} muted />
            {canResolve ? <AnomalyResolveButton eventId={a.id} resolved /> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function TrackCard({ t }: { t: TrackAnalytics }) {
  const top = t.percentile != null && t.poolSize >= MIN_POOL ? Math.max(0, 100 - t.percentile) : null;
  return (
    // @container — 아래 본문 2열 분기는 **창 폭이 아니라 이 카드 폭** 기준. 트랙이 1개면 카드가 전폭이라
    // 창이 좁아도 2열이 되고, 2개면 반폭이라 넓은 창에서만 2열이 된다(트랙 수 × 창 폭 조합을 한 규칙으로).
    <div className="bg-card border-line shadow-card @container rounded-2xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-pill px-2 py-0.5 text-xs font-bold ${
              t.track === "ahead" ? "bg-amber-soft text-amber" : "bg-primary-soft text-primary"
            }`}
          >
            {TRACK_LABEL[t.track]}
          </span>
          {t.gradeScope ? <span className="text-text-faint text-xs">{t.gradeScope}</span> : null}
        </div>
        <span className="text-text-faint text-xs">{t.chapterCount}개 기록</span>
      </div>

      <div className="@2xl:grid @2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] @2xl:items-start @2xl:gap-x-5">
        {/* 현재 위치 */}
        {t.current ? (
          <div className="mb-3 @2xl:mb-0">
            <p className="text-text-faint text-xs">현재 위치</p>
            <p className="text-foreground text-base font-bold break-keep">
              {t.current.grade} · {t.current.lesson}
            </p>
            <p className="text-text-faint text-xs break-keep">{t.current.unit}</p>
            <div className="bg-bg-soft relative mt-1.5 h-1.5 w-full overflow-hidden rounded-pill">
              <div
                className="bg-primary absolute inset-y-0 left-0 rounded-pill"
                style={{ width: `${t.progressPct}%` }}
              />
            </div>
            <p className="text-text-faint mt-0.5 text-xs">전체 커리큘럼의 {t.progressPct}%</p>
          </div>
        ) : null}

        <div>
          {/* 지표 3셀 */}
          <div className="border-line grid grid-cols-3 divide-x rounded-md border text-center">
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">수업당 속도</p>
              <p className="text-foreground text-sm font-bold">{fmtSpeed(t.speedPerLessonDay)}</p>
            </div>
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">또래 대비</p>
              <p className="text-primary text-sm font-bold">{top != null ? `상위 ${top}%` : "표본 부족"}</p>
            </div>
            <div className="px-2 py-2">
              <p className="text-text-faint text-xs">90일 예측</p>
              <p className="text-foreground text-sm font-bold">
                {t.predictions.find((p) => p.days === 90)?.grade || "—"}
              </p>
            </div>
          </div>

          {/* 예측 상세 */}
          {t.predictions.length ? (
            <div className="text-text-dim mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {t.predictions.map((p) => (
                <span key={p.days}>
                  {p.days}일 후 <b className="text-foreground">{p.grade}</b> {p.lesson}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProgressContainerPanel({ studentId }: { studentId: string }) {
  const data = useStudentTab<ProgressTabData>().analytics;
  const open = data.anomalies.filter((a) => a.resolvedAt === null);
  const resolved = data.anomalies.filter((a) => a.resolvedAt !== null);
  // 버튼 노출 판정 = 서버 액션과 **같은 순수 게이트**(#77). 강사(scoped)는 담당 학생일 때만.
  const { level, owns } = useStudentTab<ProgressTabData>().anomalyGate;
  const canResolve = canResolveProgressAnomaly(level, owns);

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-foreground text-base font-bold">진도 분석</h2>
        <p className="text-text-faint text-xs">원스크린 진도 기록 기반 자동 산출</p>
      </header>
      {/* 이상 감지는 트랙 카드보다 위 — 진도 이상 알림을 타고 온 사람이 스크롤 없이 바로 본다. */}
      {open.length ? <AnomalyCard anomalies={open} canResolve={canResolve} /> : null}
      {resolved.length ? <ResolvedAnomalies anomalies={resolved} canResolve={canResolve} /> : null}
      {data.tracks.length === 0 ? (
        <div className="bg-card border-line text-text-faint rounded-2xl border p-6 text-center text-sm">
          아직 진도 기록이 없습니다. 원스크린에서 진도를 입력·저장하면 자동으로 분석됩니다.
        </div>
      ) : (
        // auto-fit — 트랙이 1개면 전폭(md:grid-cols-2는 빈 오른쪽 반을 예약해 낭비였다), 2개면 폭이 되는
        // 창에서만 나란히, 좁으면 접힘. 트랙 수를 세어 클래스를 분기하지 않아도 된다.
        // 하한 420px = 지표 3셀이 한 줄로 버티는 최소치(340이면 344px 카드가 나와 "29.5 차시/수업일"이 2줄).
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3">
          {data.tracks.map((t) => (
            <TrackCard key={t.track} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ijw StudentDetail ProgressTab 이식 — 최근 수업보고서 표(날짜·선생님·진도·시험·숙제).
// + P2a/P3 보강: ClassNote 발송 상태 · 학부모 링크(열람수/취소/만료) — "저장한 보고서 확인"을 여기서.
// 숙제 = 저장된 **수행률 값 그대로**(90% 등).
// 🔴 예전엔 `0보다 크면 완료`로 뭉갰다 — 50%도 '완료', 숫자가 아닌 '일부 미흡'도 NaN → '완료'였다.
//    이 표를 보고 직원이 사실과 반대로 판단한다(2026-08-03 수행률 퍼센트 전환과 함께 정리).
function homeworkMark(score: string | null): string {
  return score?.trim() || "—";
}

/**
 * ClassNote 발송 상태 → 짧은 라벨 + 색. null·미지의 값 = 미발송("—").
 *
 * 🔴 여기 **로컬 사본**이 있었는데(2026-08-18 제거) 회수 3종·링크 취소·과목 제외·결석/출결 미체크를
 * switch에서 빠뜨려 **전부 "—"로 삼켰다** — 학부모 게시글을 회수했는데 학생 상세에선 "안 보낸 것"처럼
 * 보였다는 뜻이다. 색 문제가 아니라 상태 은폐 버그였다. 이제
 * [`classnoteBadge`](src/features/onescreen/classnote-badge.ts) 정본 하나만 쓴다(좁은 칸이라
 * `short` 라벨). 상태가 늘면 정본만 고치면 여기도 따라온다.
 * ⚠️ import는 **순수 모듈**에서 — 이 파일은 서버 컴포넌트라 클라 컴포넌트(`components/report-card.tsx`,
 *    `useState` 사용)를 거치면 빌드가 깨진다(그래서 정본을 컴포넌트 밖으로 옮겼다).
 */
function classnoteCell(status: string | null): { label: string; cls: string } {
  const b = classnoteBadge(status);
  return b ? { label: b.short, cls: b.cls } : { label: "—", cls: "text-text-faint" };
}

/** 학부모 링크 상태 → 라벨 + 색. 활성이면 열람 수(0=미열람). */
function linkBadge(row: LessonReportRow): { label: string; cls: string } {
  if (row.linkStatus === "revoked") return { label: "취소됨", cls: "text-danger" };
  if (row.linkStatus === "expired") return { label: "만료", cls: "text-text-faint" };
  if (row.viewCount > 0) return { label: `${row.viewCount}회 열람`, cls: "text-foreground" };
  return { label: "미열람", cls: "text-text-dim" };
}

/**
 * 원생 상세 '진도' 탭 — 수업보고서 **전체**를 10건씩 쪽으로 넘기고, 보고서 날짜로 조회한다
 * (원장 2026-09-18 *"'최근 12'건이 아니고 전체 페이지네이션해서 10건씩 넘기도록 해. 날짜 조회 가능하도록 필터 기능도"*).
 *
 * 🔴 조회는 **GET 폼**(서버 렌더, 클라 상태 없음) — 창 안이면 `embed=1`을 함께 싣는다([[#133]]).
 * 🔴 쪽·날짜 주소 = `page`·`from`·`to`. 탭을 옮기면 탭 링크가 `?tab=`만 싣기 때문에 **저절로 초기화**된다.
 * ⚠️ 날짜를 바꿔 조회하면 1쪽으로 간다(폼이 `page`를 싣지 않는다 — 목록 표준의 page 리셋 규칙).
 */
function ProgressTabBody({
  studentId,
  page = 1,
  from = null,
  to = null,
  back = null,
}: {
  studentId: string;
  page?: number;
  from?: string | null;
  to?: string | null;
  /** 원생 상세의 '돌아가기' 주소 — 쪽을 넘겨도 잃지 않게 함께 싣는다. */
  back?: string | null;
}) {
  const data = useStudentTab<ProgressTabData>();
  if (isMissingTab(data)) return <MissingTab />;
  // 과목 라벨은 학원설정 단일 소스(하드코딩 금지). 보고서 조회와 독립이라 병렬(B4).
  const [first, settings] = [data.first, data.settings];
  const totalPages = Math.max(1, Math.ceil(first.total / STUDENT_REPORTS_PAGE_SIZE));
  // 끝 쪽 너머 주소(`page=99` · 조회로 건수가 줄었는데 옛 쪽 번호가 남은 링크)면 **마지막 쪽**을 보여 준다 —
  // 안 그러면 "N건"이라 적어 놓고 빈 표가 선다.
  const shownPage = Math.min(page, totalPages);
  const { rows: reports, total } =
    shownPage !== page ? data.shown! : first;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // ClassNote 기능이 꺼진 학원엔 발송 상태 열이 없다(2026-09-30 "꺼지면 흔적 없이").
  const classnoteOn = classnoteModuleOn(settings);
  const filtered = !!(from || to);
  const hrefWith = (opts: { p: number; keepDates: boolean }) => {
    const q = new URLSearchParams({ tab: "progress" });
    if (opts.keepDates && from) q.set("from", from);
    if (opts.keepDates && to) q.set("to", to);
    if (back) q.set("back", back);
    if (opts.p > 1) q.set("page", String(opts.p));
    return `/students/${studentId}?${q.toString()}`;
  };
  const hrefFor = (p: number) => hrefWith({ p, keepDates: true });

  return (
    <div className="space-y-6">
      {/* 진도 컨테이너 자동분석(3b) — 현행/선행 현재위치·속도·또래 백분위·예측·이상감지 */}
      <ProgressContainerPanel studentId={studentId} />

      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"수업 진도"} /></h2>
        {/* 날짜 조회 — 보고서 날짜 기준, 양 끝 포함. 비우면 전체. */}
        <form method="get" action={`/students/${studentId}`} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="progress" />
          {back ? <input type="hidden" name="back" value={back} /> : null}
          <EmbedHiddenInput />
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            aria-label="시작 날짜"
            className="border-border bg-card text-foreground num h-(--control-h-sm) rounded-lg border px-2 text-sm"
          />
          <span className="text-text-dim text-sm">~</span>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            aria-label="끝 날짜"
            className="border-border bg-card text-foreground num h-(--control-h-sm) rounded-lg border px-2 text-sm"
          />
          <Button type="submit" size="sm">
            <SheetText value={"날짜 보기"} /></Button>
          {filtered ? (
            <EmbedAnchor href={hrefWith({ p: 1, keepDates: false })} className="text-text-dim text-sm hover:underline">
              <SheetText value={"전체 보기"} /></EmbedAnchor>
          ) : null}
          <span className="text-muted-foreground num text-xs">
            <SheetText value={filtered ? "조회 " : "전체 "} />
            {total}<SheetText value={"건"} /></span>
        </form>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          <SheetText value={filtered ? "이 기간에 기록된 진도가 없습니다" : "기록된 진도가 없습니다"} />
        </p>
      ) : (
        <div className="bg-card border-border overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left"><SheetText value={"날짜"} /></th>
                {/* 🔴 과목 열은 2026-07-29 감사로 신설 — 없을 땐 영어 강사 화면에서 수학 진도 12줄이
                    그 학생의 '수업 진도'로 읽혔다(쿼리가 subject를 select조차 안 했다). */}
                <th className="micro px-4 py-2 text-left"><SheetText value={"과목"} /></th>
                <th className="micro px-4 py-2 text-left"><SheetText value={"선생님"} /></th>
                <th className="micro px-4 py-2 text-left"><SheetText value={"진도"} /></th>
                <th className="micro px-4 py-2 text-center"><SheetText value={"시험"} /></th>
                <th className="micro px-4 py-2 text-center"><SheetText value={"숙제"} /></th>
                {classnoteOn ? <th className="micro px-4 py-2 text-center">ClassNote</th> : null}
                <th className="micro px-4 py-2 text-center"><SheetText value={"학부모 링크"} /></th>
                {/* 실제 수업보고서 바로가기(원장 2026-09-18). 🔴 학부모 링크(`/r/…`)로 보내지 말 것 — 그 페이지는
                    워커 밖의 **모든 방문을 학부모 열람으로 적는다**(바로 옆 '학부모 링크' 열이 "1회 열람"으로 오염된다).
                    내부 문서(`/lesson_reports/[id]/print`)는 **같은 카드**(ParentReportCard)를 그리되 열람을 안 적고,
                    강사 게이트도 이 탭과 같은 함수(`canViewStudentDetail`)다. */}
                <th className="micro px-4 py-2 text-center"><SheetText value={"보고서"} /></th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {reports.map((r) => {
                const cn = classnoteCell(r.classnoteStatus);
                const link = linkBadge(r);
                return (
                  <tr key={r.id} className="hover:bg-bg-soft/30 align-top">
                    <td className="num text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{r.reportDate}</td>
                    <td className="text-text-dim px-4 py-2 text-xs whitespace-nowrap"><SheetText value={subjects.labelOf(r.subject)} /></td>
                    <td className="text-foreground px-4 py-2 text-xs whitespace-nowrap">{r.teacherName ?? "—"}</td>
                    <td className="text-foreground break-keep px-4 py-2 text-xs">{r.progress ? <ProgressCell text={r.progress} /> : "—"}</td>
                    <td className="num px-4 py-2 text-center text-xs whitespace-nowrap">{r.examInfo ?? "—"}</td>
                    <td className="px-4 py-2 text-center text-xs whitespace-nowrap">{homeworkMark(r.homeworkScore)}</td>
                    {classnoteOn ? (
                      <td className={`px-4 py-2 text-center text-xs font-bold whitespace-nowrap ${cn.cls}`}>
                        {cn.label}
                      </td>
                    ) : null}
                    <td className={`px-4 py-2 text-center text-xs whitespace-nowrap ${link.cls}`}>{link.label}</td>
                    <td className="px-4 py-2 text-center text-xs whitespace-nowrap">
                      <ReportOpenLink reportId={r.id} reportDate={r.reportDate} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={shownPage} totalPages={totalPages} total={total} hrefForPage={hrefFor} />
    </div>
  );
}


/**
 * 진도 탭 — 2.0 본문(ProgressTabBody)을 그대로 그리고, 그 안의 문서 이동(날짜 조회 GET 폼 · 맨 `<a>`)만 같은 화면의 주소 이동으로 바꾼다.
 * Link(쪽 넘김)는 이미 호스트 이동이라 건드리지 않는다(기본 동작을 막은 클릭은 지나간다). 창 표식(embed)은 싣지 않는다.
 */
export function ProgressTab(props: Parameters<typeof ProgressTabBody>[0]) {
  const go = (action: string, q: URLSearchParams) => { q.delete("embed"); const s = q.toString(); hostNavigate(s ? `${action}?${s}` : action); };
  const onSubmit = (e: FormEvent<HTMLDivElement>) => {
    const form = e.target as HTMLFormElement;
    const action = form.getAttribute("action") ?? "";
    if (form.method.toLowerCase() !== "get" || !action.startsWith("/")) return;
    e.preventDefault();
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v !== "") q.set(k, v);
    go(action, q);
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    const href = a?.getAttribute("href") ?? "";
    if (!a || a.target || !href.startsWith("/") || href.startsWith("//")) return;
    e.preventDefault();
    const u = new URL(href, "http://host.local/");
    go(u.pathname, new URLSearchParams(u.search));
  };
  return <div className="contents" onSubmit={onSubmit} onClick={onClick}><ProgressTabBody {...props} /></div>;
}
