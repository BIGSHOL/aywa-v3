import { ContributionLink as Link } from "@/features/student-contribution/components/student-contribution-scope";
import { kstMonth, shiftMonth } from "@/lib/date-kst";
import type { getContributionStudent } from "@/features/student-contribution/server/student-query";
import { sumRaws, scoreRaws } from "@/features/student-contribution/model/calc";
import { contributionTrend, rawsBetween, scoreBetween } from "@/features/student-contribution/model/score-trend";
import { ScoreTrend } from "@/features/student-contribution/components/score-trend";
import { ScoreBreakdown } from "@/features/student-contribution/components/score-breakdown";
import { StudentDetailTabs } from "@/features/student-contribution/components/student-detail-tabs";
import { ContributionEvidence } from "@/features/student-contribution/components/contribution-evidence";
import { numberText, monthText, signedText } from "@/features/student-contribution/components/presentation";
import { StudentContributionScope } from "@/features/student-contribution/components/student-contribution-scope";
import { LiveSectionView } from "@/features/student-contribution/components/live-section-view";
import { LearningConnections, CommunicationConnections } from "@/features/student-contribution/components/learning-connections";
import { RecordSummary } from "@/features/student-contribution/components/record-summary";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { LiveConnections } from "@/features/students/ontology/live-contract";
import type { getStudentRecordSummary } from "@/features/student-contribution/server/summary-query";
import { MissingTab, useStudentTab } from "./students-shared";
import { ContributionHeader } from "./students-contribution-header";
import { OntologyExplorer } from "./students-contribution-ontology-explorer";
import { CurrentScopeExplorer } from "./students-contribution-current-explorer";
import { liveScopeRequest } from "@/features/students/ontology/live-scope";
import type { getContributionOntology } from "@/features/student-contribution/server/ontology-query";
import type { getCurrentOntologyScope } from "@/features/student-contribution/server/live-scope-query";
import type { getContributionList } from "@/features/student-contribution/server/queries";
import { ContributionList } from "./students-contribution-list";
import { ContributionReferrals } from "./students-contribution-referrals";

type ContributionData = Awaited<ReturnType<typeof getContributionStudent>>;
type ContributionTabData = { contribution?: ContributionData; live?: LiveConnections | null;
  summary?: Awaited<ReturnType<typeof getStudentRecordSummary>>;
  ontologyMode?: "monthly" | "current";
  ontology?: Awaited<ReturnType<typeof getContributionOntology>>;
  currentScope?: Awaited<ReturnType<typeof getCurrentOntologyScope>>;
  list?: Awaited<ReturnType<typeof getContributionList>>;
  referrals?: Parameters<typeof ContributionReferrals>[0]["data"] | null };

export function StudentContributionView({ studentId, params }: { studentId: string; params: Record<string, string | undefined> }) {
  const tab = useStudentTab<ContributionTabData>();
  if (params.contribution === "ontology") return <StudentContributionScope studentId={studentId} back={params.back}>
    {tab.ontologyMode === "current" ? tab.currentScope
      ? <CurrentScopeExplorer studentId={studentId} view={tab.currentScope} embed /> : <p>학생 기록 연결을 열람할 수 없습니다.</p>
      : tab.ontology ? <OntologyExplorer studentId={studentId} data={tab.ontology} initialScope={liveScopeRequest(params, tab.ontology.tenant)} />
        : <p>학생 기록 연결을 열람할 수 없습니다.</p>}
  </StudentContributionScope>;
  if (params.contribution === "list") return <StudentContributionScope studentId={studentId} back={params.back}>
    {tab.list ? <ContributionList studentId={studentId} data={{ ...tab.list, gate: { ...tab.list.gate, canWrite: false } }} />
      : <p>기여도 목록을 열람할 수 없습니다.</p>}
  </StudentContributionScope>;
  if (params.contribution === "referrals") return <StudentContributionScope studentId={studentId} back={params.back}>
    {tab.referrals ? <ContributionReferrals studentId={studentId} data={tab.referrals} />
      : <p>소개 확인 목록을 열람할 수 없습니다.</p>}
  </StudentContributionScope>;
  if (params.contribution && params.contribution !== "student") return <MissingTab />;
  const { contribution: data, live, summary } = tab;
  if (!data) return <p>기여도 기록을 열람할 수 없습니다.</p>;
  return <StudentContributionScope studentId={studentId} back={params.back}>
    <div className="w-full min-w-0 space-y-5 pb-6">
      <ContributionHeader studentId={studentId} title={`${data.student.name}의 기여도와 기록`} description="월별 점수와 계산 근거를 확인하세요." active="students" canConfigure={data.gate.canConfigure}
        actions={<Link href="/student-contribution" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted">전체 기여도 목록</Link>} />
      <ContributionStudentPanel studentId={studentId} month={params.month} data={data} />
      <details key={studentId} id={`current-connections-${studentId}`} tabIndex={-1} className="group rounded-xl border border-line" aria-label="현재 연결">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <span><span className="block font-semibold">현재 연결</span><span className="mt-1 block text-xs">현재 수강·담당자, 상담·메모와 최근 기록 요약</span></span>
          <span className="flex shrink-0 items-center gap-2 text-sm text-primary"><span className="group-open:hidden">펼치기</span><span className="hidden group-open:inline">접기</span><span className="group-open:rotate-180"><EyIcon name="chevronDown" size={16} /></span></span>
        </summary>
        <div className="space-y-4 border-t border-line p-4">
          {live ? <section className="space-y-3" aria-labelledby="current-connections-title">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="current-connections-title" className="font-semibold">현재 수강과 최근 기록</h2>
              <p className="mt-1 text-xs">지금 확인한 자료로, 월별 기여도와는 기준 시점이 다릅니다.</p></div><span className="text-xs tabular-nums">{live.asOf} 기준</span></div>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[["classes", "family"], ["consultations", "memos"], ["reservations", "makeups"]].map((keys) => <div key={keys[0]} className="min-w-0 space-y-4">
                {keys.map((key) => { const section = live.sections.find((item) => item.key === key);
                  return section && <LiveSectionView key={key} section={section} />; })}
              </div>)}
            </div>
            <LearningConnections key={`${studentId}:${live.checkedAt}`} studentId={studentId} />
            <CommunicationConnections key={`communication:${studentId}:${live.checkedAt}`} studentId={studentId} />
          </section> : <p className="rounded-xl border border-line p-5 text-sm">현재 연결을 보려면 해당 학생의 원본 열람 권한이 필요합니다.</p>}
          {summary && <section id={`record-summary-${studentId}`} tabIndex={-1} aria-label="저장된 요약" className="scroll-mt-4">
            <RecordSummary key={studentId} studentId={studentId} data={{ ...summary, canWrite: false }} />
          </section>}
        </div>
      </details>
    </div>
  </StudentContributionScope>;
}

export function ContributionStudentPanel({ studentId, month, data }: { studentId: string; month?: string; data: ContributionData }) {
  if (!data) return <p>기여도 기록을 열람할 수 없습니다.</p>;
  if (!data.ready || !data.months.length) return <div className="w-full space-y-5">
    <div className="rounded-xl border border-line p-12 text-center"><p className="font-semibold">아직 집계된 기록이 없습니다.</p><p className="mt-2 text-sm">첫 집계가 끝나면 점수와 계산 근거가 표시됩니다.</p><Link href="/student-contribution" className="mt-5 inline-block text-sm text-primary underline">원생 기여도 목록으로</Link></div></div>;
  const config = data.settings.config, current = kstMonth(), since = shiftMonth(current, -11);
  const total = sumRaws(data.months.flatMap((m) => [m.raws, m.correction])), scored = scoreRaws(total, config);
  const selected = data.months.find((m) => m.month === month) ?? data.months.at(-1)!;
  const trend = contributionTrend(data.months, config, current), point = trend.find((p) => p.month === selected.month)!;
  const recent = scoreBetween(data.months, config, since, "9999-12").total;
  const through = rawsBetween(data.months, "0000-01", selected.month);
  const pending = data.months.at(-1)!.unavailable.length;
  const cells: [string, string, string][] = [["운영 기여", numberText(scored.operations), "소개 · 수업료 · 수강 기간"],
    ["학습·참여", numberText(scored.participation), "출결 · 영상 숙제 · 평가 · 긍정 신호"],
    ["최근 12개월", signedText(recent), `${monthText(since)}부터의 증감 · 이번 달 집계분 포함`]];
  return <div className="@container w-full min-w-0 space-y-5">
    <h2 className="sr-only">월별 기여도</h2>
    {(data.withheld > 0 || data.identityIssues > 0) && <p role="status" className="rounded-lg bg-primary-softer px-4 py-3 text-sm">현재 원문이나 학생 연결을 확인할 수 없는 근거는 표시하지 않습니다. 마감한 실적과 점수는 그대로 보존됩니다.</p>}
    {/* 좁으면 세 칸을 '이름 … 값' 한 줄씩(긴 값도 잘리지 않게), 넓으면 3열 → 누적과 한 줄 4칸. */}
    <section className="grid grid-cols-1 overflow-hidden rounded-xl border border-line @2xl:grid-cols-3 @4xl:grid-cols-[1.3fr_1fr_1fr_1fr]" aria-label="누적 기여도 요약">
      <div className="bg-primary px-5 py-4 text-primary-foreground @2xl:col-span-3 @4xl:col-span-1 @4xl:px-6 @4xl:py-5"><h3 className="text-sm font-medium">누적 기여도</h3><p className="mt-1 text-4xl font-bold tracking-tight tabular-nums @4xl:mt-2">{numberText(scored.total)}<span className="ml-2 text-base font-normal">점</span></p><p className="mt-2 text-xs @4xl:mt-3">현재 배점 기준 · 점수 상한 없음</p></div>
      {cells.map(([label, value, note], i) => <div key={label} className={`flex min-w-0 items-baseline justify-between gap-3 border-t border-line px-5 py-2.5 @2xl:block @2xl:py-4 @4xl:border-t-0 @4xl:px-6 @4xl:py-5 ${i ? "@2xl:border-l" : "@4xl:border-l"}`}>
        <h3 className="text-sm font-medium">{label}</h3><p className="whitespace-nowrap text-lg font-bold tabular-nums @2xl:mt-1 @2xl:text-xl @4xl:mt-2 @4xl:text-2xl">{value}<span className="ml-1 text-xs font-normal @4xl:text-sm">점</span></p><p className="mt-2 hidden text-xs @2xl:block">{note}</p></div>)}
    </section>
    <details className="rounded-lg border border-line px-4 py-3 text-xs leading-relaxed">
      <summary className="cursor-pointer font-medium">학습·참여 점수는 언제 반영되나요?</summary>
      <div className="mt-2 space-y-1.5">
        <p>주간 개근은 월요일~일요일의 예정된 수업에 모두 출석했을 때 인정합니다. 끝난 주부터 집계하며, 일요일이 속한 달에 한 번 반영합니다.</p>
        <p>영상 숙제는 배정된 숙제에 제출 영상이 하나 이상 확인되면 숙제당 1회 인정합니다. 같은 숙제에 영상이 여러 개여도 한 번만 계산하며, 월말까지 기다리지 않고 다음 집계에 반영합니다.</p>
        <p>2026년부터 확인 가능한 기록으로 계산합니다. 이전 월 단위 실적은 새 실적과 중복 계산하지 않으며, 마감한 달의 새 기준 실적은 이번 달 정정에서 확인할 수 있습니다.</p>
        <p>월말평가와 긍정 신호도 항목별로 한 달에 1회 인정하며, 점수는 현재 배점을 적용합니다.</p>
        <Link href={`/students/${studentId}?tab=homework-videos`} className="inline-block text-primary underline underline-offset-4">숙제 영상 확인</Link>
      </div>
    </details>
    <StudentDetailTabs evidenceNote={`${monthText(selected.month)}의 원수치·현재 배점·계산식과 근거 기록입니다. 달을 바꾸면 추이 탭의 선택도 같이 바뀝니다.`}
      summary={<>
        {!!pending && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{pending}개 항목은 확인하지 못한 자료가 있어 현재 확인된 실적만 반영했습니다. 가장 최근 달의 계산 근거에서 항목별 이유를 확인할 수 있습니다.</p>}
        <ScoreTrend key={studentId} points={trend} studentId={studentId} selectedMonth={selected.month} />
        <ScoreBreakdown raws={total} config={config} />
      </>}
      evidence={<ContributionEvidence selected={selected} months={data.months.map((m) => m.month)} through={through} point={point} config={config}
        withheld={data.withheld} signals={data.signals} canWrite={data.gate.canWrite} studentId={studentId} />} />
  </div>;
}
