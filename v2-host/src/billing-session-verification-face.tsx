// 2.0 session-verification-face.tsx(app/(shell)/billing/_components/session-verification-face.tsx) — 서버 컴포넌트라 그대로 불러올 수 없어서, 조회는 /api/v2/billing(Docker 복사본)이
// **2.0 서버 함수를 그대로** 돌려(v2-billing-sessions.mjs · 공용 러너 v2-server-runner.mjs) 내고 여기서는 본문을 글자 그대로 옮겼다(billing-sessions.swaps.json).
import type { VerificationStatus } from "@/features/billing/session-terms/server/verification-queries";
import type { SessionsFaceData } from "./billing-types";
import { aggregateTeacherAllocations, hasAllocationSignal } from "@/features/billing/session-terms/allocation";
import { AllocationMoney } from "@/app/(shell)/billing/_components/allocation-money";
import { computeSplitRows, splitsFingerprint, totalSplits } from "@/features/billing/session-terms/splits";
import { SplitsSnapshotPanel } from "@/app/(shell)/billing/_components/splits-snapshot-panel";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { currentPeriod } from "@/features/billing/calc";
import { Pagination } from "@/components/pagination";
import Link from "next/link";
import { SearchToggle } from "@/components/search-toggle";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { BillingMonthNav } from "@/app/(shell)/billing/_components/billing-month-nav";
import { FaceNote } from "@/app/(shell)/billing/_components/face-note";
import { TERM_STATE_LABEL } from "@/features/billing/session-terms/month-roster";
import { tipProps } from "@/components/hover-tip/tip";

const PAGE_SIZE = 50;

/** 회차 행이 없는 줄(출석부엔 있는데 행이 없는 학생) — 미확정으로 서고 실 출석은 줄 집합이 센 시수. 문구는 `TERM_STATE_LABEL` 한 벌. */
const MISSING_TIP = tipProps({ title: TERM_STATE_LABEL.missing.label, lines: [TERM_STATE_LABEL.missing.tip, "실 출석은 그 달 출석부에 찍힌 시수입니다."] });

// 출석부와 같은 소수 한 자리 시수. 기존 일수 확정은 행별 안내와 함께 보존한다.
const fmtUnits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// diff 색: 일치=녹 / 부족=주황 / 초과=적 / 미확정=회색 (라이트 전용 Daylight).
const STATUS_META: Record<VerificationStatus, { label: string; cell: string; chip: string }> = {
  matched: { label: "일치", cell: "text-green", chip: "bg-green-soft text-green border-green/30" },
  short: { label: "부족", cell: "text-amber", chip: "bg-amber-soft text-amber border-amber/30" },
  over: { label: "초과", cell: "text-danger", chip: "bg-danger-soft text-danger border-danger/30" },
  unconfirmed: { label: "미확정", cell: "text-text-dim", chip: "bg-card text-text-dim border-line" },
  monthly: { label: "월 고정", cell: "text-primary", chip: "bg-primary-soft text-primary border-primary/30" },
};

// 검증 우선 정렬 — 불일치(초과·부족)를 맨 위로, 그다음 미확정, 마지막 일치.
const RANK: Record<VerificationStatus, number> = { over: 0, short: 0, unconfirmed: 1, matched: 2, monthly: 2 };

/**
 * 시수 검증 면 — 청구=N회 키스톤의 직접 소비자(로드맵 2단계). **쓰기 0**(조회 전용).
 * 분자=확정값만(N1) / diff는 점검 신호일 뿐 자동수정 없음(N2). 청구월≈달력월 근사(v1 한계).
 */
export function SessionVerificationFace({
  data,
  period,
  subject,
  page,
  query,
  status,
  params = {},
}: {
  period?: string;
  subject?: string;
  page?: string;
  query?: string;
  status?: string;
  params?: Record<string, string | undefined>;
  data: SessionsFaceData;
}) {
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const [view, settings, savedSplits] = [data.verification!.view, data.settings, data.verification!.savedSplits];
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 분배 스냅샷 드리프트 대조용 — 과목 필터와 무관하게 그 달 전체(저장 단위와 동일 기준).
  // 지문은 강사 귀속까지 포함 — 합계가 상쇄되는 변경(강사 재배정)도 드리프트로 잡는다.
  const liveSplitRows = computeSplitRows(view.rows);
  const liveSplits = { ...totalSplits(liveSplitRows), fingerprint: splitsFingerprint(liveSplitRows) };

  const allRows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  const presentSubjects = [...new Set(allRows.map((r) => r.subject))].sort();
  const activeSubject = subject && presentSubjects.includes(subject) ? subject : null;
  const scoped = activeSubject ? allRows.filter((r) => r.subject === activeSubject) : allRows;

  const q = (query ?? "").trim().toLocaleLowerCase("ko");
  const activeStatus = status && Object.hasOwn(STATUS_META, status) ? status as VerificationStatus : null;
  const filtered = scoped.filter((row) => (!activeStatus || row.status === activeStatus)
    && (!q || `${row.studentName} ${row.className ?? ""}`.toLocaleLowerCase("ko").includes(q)));
  const sorted = [...filtered].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || a.studentName.localeCompare(b.studentName, "ko"),
  );
  const c = view.counts;
  // 그 달 출석 기록이 통째로 없으면(월중·미입력) 전 행 실=0이 되어 고장처럼 보임 → 명시적 안내.
  const noAttendanceYet = scoped.length > 0 && scoped.every((r) => r.actualConsumed === 0);

  // 강사별 분배(참고) — 현재 과목 필터가 적용된 행을 반 담당 강사(id) 단위로 집계(표시 전용, 저장 없음).
  // 전부 0(미확정·출석 0)인 강사 행은 노이즈라 제외 — 신호 있는 강사가 없으면 섹션 자체를 숨긴다.
  const allocations = aggregateTeacherAllocations(
    scoped.map((r) => ({
      className: r.className,
      teacherId: r.teacherId,
      teacherName: r.teacherName,
      confirmedSessions: r.confirmedSessions,
      unitPrice: r.unitPrice,
      amount: r.amount,
      allocatedAmount: r.allocatedAmount,
      actualConsumed: r.actualConsumed,
      pricingMode: r.pricingMode,
    })),
  ).filter(hasAllocationSignal);
  const allocTotal = allocations.reduce(
    (acc, t) => ({
      confirmedAmount: acc.confirmedAmount + t.confirmedAmount,
      actualAmount: acc.actualAmount + t.actualAmount,
      missingPriceRows: acc.missingPriceRows + t.missingPriceRows,
      pricedRows: acc.pricedRows + t.pricedRows,
      missingConfirmedRows: acc.missingConfirmedRows + t.missingConfirmedRows,
      confirmedPricedRows: acc.confirmedPricedRows + t.confirmedPricedRows,
    }),
    { confirmedAmount: 0, actualAmount: 0, missingPriceRows: 0, pricedRows: 0, missingConfirmedRows: 0, confirmedPricedRows: 0 },
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  const rows = sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  // 과목 필터를 보존한 채 월·page만 바꾸는 href.
  const hrefFor = (per: string, n = 1, clearDisplayFilters = false) => {
    const qs = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
    qs.set("tab", "sessions");
    qs.set("panel", "verify");
    qs.set("period", per);
    qs.delete("page");
    if (clearDisplayFilters) { qs.delete("q"); qs.delete("status"); }
    if (activeSubject) qs.set("subject", activeSubject);
    if (n > 1) qs.set("page", String(n));
    return `/billing?${qs.toString()}`;
  };
  const pageHref = (n: number) => hrefFor(p, n);

  return (
    <section className="space-y-4">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(옛 h-8 text-xs 화살표 링크 대체) · 과목 칩 줄 → `과목: 전체` 라벨 ·
          판정 집계(초과·부족·일치·미확정)는 읽기 전용 배지라 그대로 오른쪽에. 🔴 툴바 카드 껍데기 없음. */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={p} hrefFor={(per) => hrefFor(per)} ariaLabel="검증 월 선택" />
        {presentSubjects.length > 1 ? (
          <FilterSelect
            paramName="subject"
            value={activeSubject ?? ""}
            options={presentSubjects.map((sk) => ({ value: sk, label: subjects.labelOf(sk) }))}
            axisLabel="과목"
            ariaLabel="과목 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
        ) : null}
        <SearchToggle key={query} placeholder="학생·반 검색" defaultValue={query} />
        <FilterSelect paramName="status" value={activeStatus ?? ""} axisLabel="판정" ariaLabel="시수 판정 필터"
          options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
          className="w-auto" triggerClassName={TOOLBAR_SELECT} />
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-dim">월 전체</span>
          {(["over", "short", "matched", "monthly", "unconfirmed"] as VerificationStatus[]).map((s) => (
            <span key={s} className={`rounded-full border px-2 py-0.5 ${STATUS_META[s].chip}`}>
              {STATUS_META[s].label} <span className="num font-bold">{c[s]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 규칙 설명(N1/N2)은 지워선 안 되는 사실이라 접힌 2차로(§4). */}
      <FaceNote>
        <b>달력월 청구 시수 대조</b>입니다. 출석부 시수 마스터의 세션 기간과 다르며, *LAB 출결도 청구 소비에 포함합니다.{" "}
        <b>확정한 시수</b>(청구 기준)와 그 반의 <b>출석부 시수 합계</b>(출석·지각·조퇴·보강)를 대조합니다. 기존 일수 기준 확정은 재확정 전까지 같은 일수 기준으로 비교합니다.
        {" "}EiE 월 고정은 확정한 월 금액을 정산 기준으로 쓰며 출석 회차로 금액을 바꾸지 않습니다.
        차이는 <span className="text-amber">부족</span>(청구보다 적게 나옴)·<span className="text-danger">초과</span>(더
        나옴) 신호일 뿐, 어느 값도 자동으로 맞추지 않습니다. 회차를 고치려면{" "}
        <Link href={`/billing?tab=sessions&period=${p}`} className="text-primary underline-offset-2 hover:underline">
          회차 확정
        </Link>
        에서 조정하세요. (청구월은 달력월 기준으로 근사합니다.)
      </FaceNote>

      {view.rows.some((row) => row.allocationStale) ? <p role="alert" className="text-amber rounded-lg border border-amber/30 p-3 text-sm">수납 배분을 다시 확인할 학생이 있습니다. 회차 확정에서 그 학생 줄의 ‘배분’ 버튼으로 확인한 후 분배를 저장하세요. { [...new Set(view.rows.filter((row) => row.allocationStale).map((row) => row.studentName))].join(", ") }{ view.rows.some((row) => row.allocationStale && row.freeAllocationSaved) ? ` — 그중 ${[...new Set(view.rows.filter((row) => row.allocationStale && row.freeAllocationSaved).map((row) => row.studentName))].join(", ")}은(는) 관리자가 자유 배분으로 저장한 청구서라 관리자만 고칠 수 있습니다.` : "" }</p> : null}

      {noAttendanceYet ? (
        <div className="rounded-2xl border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
          이 달은 아직 출석 기록이 없어 실 출석이 모두 <b>0</b>으로 표시됩니다(월중이거나 출석부 미입력). 출석이 쌓이면 자동으로 대조됩니다.
        </div>
      ) : null}

      {scoped.length === 0 ? (
        <div className="border-border text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
          이 달의 회차 데이터가 없습니다. <b>회차 확정</b>에서 계획 회차를 생성·확정하면 여기서 실 출석과 대조됩니다.
        </div>
      ) : (
        <>
          {/* 강사별 분배(참고) — 반 담당 강사 단위 확정 금액 vs 실측 금액. 표시 전용 집계(쓰기 0, 저장 없음).
              신호(확정·출석) 있는 강사가 하나도 없으면 통째로 숨김(전부-0 행 노이즈 방지). */}
          {allocations.length > 0 ? (
          <section className="border-line rounded-2xl border">
            <header className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
              <h3 className="text-foreground text-sm font-bold">강사별 청구 금액 (참고)</h3>
              <p className="text-text-dim text-xs">
                반 담당 강사 기준 집계 — 표시 전용이며 어디에도 저장되지 않습니다. 단가 없는 행은 금액에서
                제외하고 개수로 표시합니다.
              </p>
            </header>
            <DragScrollArea>
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                    <th className="px-3 py-2 text-left">강사</th>
                    <th className="px-3 py-2 text-right">반</th>
                    <th className="px-3 py-2 text-right">확정 시수</th>
                    <th className="px-3 py-2 text-right">확정 금액</th>
                    <th className="px-3 py-2 text-right">실 시수</th>
                    <th className="px-3 py-2 text-right">실측 금액</th>
                    <th className="px-3 py-2 text-right">차액</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((t) => (
                    <tr key={t.teacherName} className="border-line/60 border-b last:border-0">
                      <td className="text-foreground px-3 py-2">
                        {t.teacherName}
                        {t.missingPriceRows > 0 ? (
                          <span
                            className="text-text-dim ml-1 text-xs"
                            title="단가가 없어 금액 집계에서 제외된 행"
                          >
                            (단가없음 {t.missingPriceRows})
                          </span>
                        ) : null}
                      </td>
                      <td className="num text-text-dim px-3 py-2 text-right">{t.classCount}</td>
                      <td className="num px-3 py-2 text-right">{t.confirmedSessions}</td>
                      <td className="num px-3 py-2 text-right"><AllocationMoney value={t.confirmedAmount} missingPriceRows={t.missingConfirmedRows} pricedRows={t.confirmedPricedRows} /></td>
                      <td className="num px-3 py-2 text-right">{fmtUnits(t.actualUnits)}</td>
                      <td className="num px-3 py-2 text-right"><AllocationMoney value={t.actualAmount} {...t} /></td>
                      <td className="num px-3 py-2 text-right font-bold">
                        <AllocationMoney value={t.diffAmount} {...t} difference />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-line bg-bg-soft/50 border-t text-xs">
                    <td className="text-text-dim px-3 py-2" colSpan={3}>
                      합계
                    </td>
                    <td className="num px-3 py-2 text-right font-bold"><AllocationMoney value={allocTotal.confirmedAmount} missingPriceRows={allocTotal.missingConfirmedRows} pricedRows={allocTotal.confirmedPricedRows} /></td>
                    <td />
                    <td className="num px-3 py-2 text-right font-bold"><AllocationMoney value={allocTotal.actualAmount} {...allocTotal} /></td>
                    <td className="num px-3 py-2 text-right font-bold">
                      <AllocationMoney value={allocTotal.actualAmount - allocTotal.confirmedAmount} {...allocTotal} difference />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </DragScrollArea>
          </section>
          ) : null}

          {/* 분배 스냅샷(2단계 b) — 확정 행의 강사 분배를 기간 단위로 저장(기록 전용, invoices 불변 N2).
              분배 표가 숨겨져도(신호 0) 저장 이력이 있으면 표시해 stale 스냅샷을 가시화한다.
              key=period: 월 이동 시 useActionState(저장 완료/에러 메시지)를 리셋(적대 리뷰 픽스). */}
          {savedSplits !== null || liveSplits.rowCount > 0 ? (
            <section className="border-line overflow-hidden rounded-2xl border">
              <SplitsSnapshotPanel key={p} period={p} live={liveSplits} saved={savedSplits} />
            </section>
          ) : null}

          {sorted.length === 0 ? (
            <div className="border-border text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm">
              조건에 맞는 학생이 없습니다.{" "}
              <Link href={hrefFor(p, 1, true)} className="text-primary underline">검색·판정 해제</Link>
            </div>
          ) : null}
          <DragScrollArea className="border-line rounded-2xl border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-line text-text-dim border-b text-sm [&_th]:font-bold">
                  <th className="px-3 py-2 text-left">학생</th>
                  <th className="px-3 py-2 text-left">반</th>
                  <th className="px-3 py-2 text-left">과목</th>
                  <th className="px-3 py-2 text-right">확정 시수</th>
                  <th className="px-3 py-2 text-right">실 출석</th>
                  <th className="px-3 py-2 text-right">차이</th>
                  <th className="px-3 py-2 text-left">판정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.id} className="border-line/60 border-b last:border-0">
                      <td className="px-3 py-2">
                        <span className="text-foreground">{r.studentName}</span>
                        {r.studentGrade ? <span className="text-text-dim ml-1 text-xs">{r.studentGrade}</span> : null}
                      </td>
                      <td className="text-text-dim px-3 py-2">{r.className ?? "—"}</td>
                      <td className="text-text-dim px-3 py-2">{r.subjectLabel}</td>
                      <td className="num px-3 py-2 text-right">
                        {r.confirmedSessions !== null ? (
                          <>{r.confirmedSessions}{r.pricingMode !== "monthly" && r.quantityBasis === "days" ? <span className="text-amber block text-xs">기존 일수 기준</span> : null}</>
                        ) : r.termState === "missing" ? (
                          <span className="text-amber cursor-help text-xs" {...MISSING_TIP}>
                            {TERM_STATE_LABEL.missing.label}
                          </span>
                        ) : (
                          <span className="text-text-dim" title="회차 확정 전 — 계획 회차는 참고">
                            {r.plannedSessions ?? "—"}
                            <span className="ml-0.5 text-xs">(계획)</span>
                          </span>
                        )}
                      </td>
                      <td className="num text-foreground px-3 py-2 text-right">{fmtUnits(r.actualConsumed)}</td>
                      <td className={`num px-3 py-2 text-right font-bold ${meta.cell}`}>
                        {r.diff === null ? "—" : r.diff > 0 ? `+${fmtUnits(r.diff)}` : fmtUnits(r.diff)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
          <Pagination page={curPage} totalPages={totalPages} total={sorted.length} hrefForPage={pageHref} />
        </>
      )}
    </section>
  );
}
