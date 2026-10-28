"use client";
import { useMemo, useState } from "react";
import { ContributionLink as Link } from "@/features/student-contribution/components/student-contribution-scope";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { ExplorerKind } from "@/features/students/ontology/explorer";
import type { StudentFact } from "@/features/students/ontology/types";
import type { getContributionOntology } from "@/features/student-contribution/server/ontology-query";
import { ContributionHeader } from "./students-contribution-header";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ContributionMonthPicker } from "@/features/student-contribution/components/month-picker";
import { OntologyConnections } from "@/features/student-contribution/components/ontology-connections";
import { entityLabels } from "@/features/student-contribution/components/ontology-labels";
import { ListPager } from "@/features/student-contribution/components/list-pager";
import { OntologyViewMode } from "@/features/student-contribution/components/ontology-view-mode";
import { OntologyDirectory } from "@/features/student-contribution/components/ontology-directory";
import { Button } from "@/components/ui/button";
import { factLabels, monthText, numberText } from "@/features/student-contribution/components/presentation";
import { OntologyFilters } from "@/features/student-contribution/components/ontology-filters";
import { OntologyNavigation } from "@/features/student-contribution/components/ontology-navigation";
type Data = NonNullable<Awaited<ReturnType<typeof getContributionOntology>>>;
const EMPTY = { students: [] as string[], counts: {}, factCount: 0, tuitionWon: 0, unallocatedTuitionFacts: 0, related: [], studentCounts: {}, basis: { recorded: 0, rule: 0, ai: 0 }, recordedAt: "", parentEvents: { events: 0, familyEvents: 0, studentEvents: 0 } };
export function OntologyExplorer({ data, initialScope, studentId }: { data: Data; initialScope?: { kind: ExplorerKind; id: string }; studentId: string }) {
  const initialKind = initialScope?.kind ?? "academy";
  const [kind, setKind] = useState<ExplorerKind>(initialKind), [selectedId, setId] = useState(initialScope?.id ?? "");
  const id = kind === "academy" ? data.tenant : data.labels[kind].some((item) => item.id === selectedId) ? selectedId : "";
  const [recordKind, setRecordKind] = useState("all"), [page, setPage] = useState(1);
  const browsing = kind !== "academy" && !id;
  const result: Data["views"][string] = data.views[`${kind}:${id}`] ?? EMPTY;
  const choose = (next: ExplorerKind, target: string) => { setKind(next); setId(target); setRecordKind("all"); setPage(1); };
  const selected = data.labels[kind].find((item) => item.id === id)?.label ?? "대상을 선택해 주세요";
  const names = useMemo(() => new Map(data.labels.student.map((s) => [s.id, s])), [data.labels.student]);
  const directoryRows = useMemo(() => data.labels[kind].map((item) => ({ ...item, count: data.views[`${kind}:${item.id}`]?.factCount ?? 0 })), [data.labels, data.views, kind]);
  const rows = result.students.filter((student) => recordKind === "all" || (result.studentCounts[student]?.[recordKind as StudentFact["kind"]] ?? 0) > 0)
    .sort((a, b) => (names.get(a)?.label ?? "").localeCompare(names.get(b)?.label ?? ""));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 15)));
  const counts = Object.entries(result.counts) as [StudentFact["kind"], number][];
  const largest = Math.max(1, ...counts.map(([, n]) => n));
  return <OntologyNavigation><div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader studentId={studentId} title="학생 기록 연결" description="학생·반·강사·과목별로 같은 달의 기록과 근거를 살펴봅니다." active="ontology" canConfigure={data.canConfigure} actions={<ContributionMonthPicker month={data.month} scope={{ kind, id }} />} />
    <OntologyViewMode current={false} month={data.month} filters={data.filters} scope={{ kind, id }} />
    {data.parentEventNotice && <p role="status" className="rounded-lg bg-secondary px-4 py-3 text-sm">{data.parentEventNotice}</p>}
    <section className="rounded-xl border border-line">
      <div className="border-b border-line p-4"><OntologyFilters key={JSON.stringify(data.filters)} filters={data.filters} options={data.filterOptions} scope={{ kind, id }} /></div>
      <div className="flex flex-wrap items-center gap-4 border-b border-line p-4">
        <DragScrollArea hideBar pan={false} className="max-w-full rounded-lg bg-secondary"><div className="flex gap-1 p-1" aria-label="연결 관점">{Object.entries(entityLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={kind === key}
          onClick={() => choose(key as ExplorerKind, key === "academy" ? data.tenant : "")}
          className={`shrink-0 rounded-md px-4 py-2 text-sm focus-visible:outline-primary phone:px-3 ${kind === key ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-card"}`}>{label}</button>)}</div></DragScrollArea>
        {!browsing && kind !== "academy" && <><Button size="sm" variant="outline" onClick={() => choose(kind, "")}>{entityLabels[kind]} 목록으로</Button>
          <SearchableSelect ariaLabel={`${entityLabels[kind]} 선택`} value={id} onValueChange={(next) => choose(kind, next)} placeholder={`${entityLabels[kind]} 선택`} searchPlaceholder={`${entityLabels[kind]} 검색`}
            options={data.labels[kind].map((item) => ({ value: item.id, label: item.label, hint: "detail" in item ? item.detail as string : undefined, meta: `${numberText(data.views[`${kind}:${item.id}`]?.factCount ?? 0)}건` }))} className="min-w-0 w-full sm:w-auto sm:min-w-64 sm:flex-1" /></>}
        <span className="text-xs">{monthText(data.month)} 기록 기준</span>
      </div>
      {!browsing && <div className="grid grid-cols-[minmax(0,1.4fr)_1fr_1fr_1.3fr] divide-x divide-line phone:grid-cols-2 phone:divide-x-0">
        <div className="bg-primary-softer px-5 py-4"><p className="text-xs">{entityLabels[kind]} 관점</p><h2 className="mt-2 break-words text-lg font-bold">{selected}</h2></div>
        <div className="px-5 py-4"><p className="text-xs">이 달 기록이 연결된 학생</p><p className="mt-2 text-xl font-bold tabular-nums">{numberText(result.students.length)}<span className="ml-1 text-sm font-normal">명</span></p>{kind === "academy" && <p className="mt-1 text-xs">조회 조건에 맞는 {numberText(data.labels.student.length)}명 중</p>}</div>
        <div className="px-5 py-4"><p className="text-xs">중복을 뺀 기록</p><p className="mt-2 text-xl font-bold tabular-nums">{numberText(result.factCount)}<span className="ml-1 text-sm font-normal">건</span></p></div>
        <div className="px-5 py-4"><p className="text-xs">{kind === "teacher" || kind === "class" ? "반·강사별 수업료" : "확인된 수업료"}</p><p className="mt-2 text-xl font-bold tabular-nums phone:text-sm">{kind === "teacher" || kind === "class" ? <span className="text-base font-medium">반·강사별로 배분하지 않음</span> : <span className="whitespace-nowrap">{numberText(result.tuitionWon)}<span className="ml-1 text-sm font-normal">원</span></span>}</p></div>
      </div>}
    </section>
    {!data.historyReady && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">첫 집계가 완료되기 전에는 일부 기록만 표시됩니다.</p>}
    {!!data.identityIssues && <p role="status" className="rounded-lg bg-primary-softer px-4 py-3 text-sm">학생 병합 연결을 확인할 기록이 있어 일부 자료를 제외했습니다. 현재 합계는 확인된 연결만 포함합니다.</p>}
    {browsing && selectedId && <p role="status" className="text-sm">선택한 대상이 조회 조건에 없어 목록으로 돌아왔습니다. 조건을 바꾸거나 다른 대상을 선택해 주세요.</p>}
    {kind !== "academy" && <div hidden={!browsing}><OntologyDirectory key={`${kind}:${data.month}`} kind={kind}
      hideSearch={kind === "student"}
      rows={directoryRows}
      description={kind === "student" ? `조건에 맞는 학생입니다. 이름을 선택하면 ${monthText(data.month)}의 기록과 근거를 볼 수 있습니다. 이 달 기록이 없는 학생도 표시합니다.`
        : `조건에 맞는 학생의 ${monthText(data.month)} 기록에 연결된 ${entityLabels[kind]}입니다. 이름을 선택하면 기록과 근거를 볼 수 있습니다.`}
      measure={{ label: "이 달 연결 기록", unit: "건" }} onSelect={(next) => choose(kind, next)} /></div>}
    {!browsing && <>
    {kind === "teacher" && <p className="text-xs">시간표 기준 · 마감 당시 판정입니다. 실제 수업 담당 기록과 다를 수 있습니다.</p>}
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border border-line p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">어떤 기록이 연결되어 있나요?</h2><span className="text-xs">종류를 누르면 해당 기록이 있는 학생만 표시</span></div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 phone:grid-cols-1">{counts.map(([key, count]) => <button key={key} type="button" aria-pressed={recordKind === key} onClick={() => { setRecordKind(recordKind === key ? "all" : key); setPage(1); }}
            className={`rounded-lg p-3 text-left focus-visible:outline-primary ${recordKind === key ? "bg-primary-softer ring-1 ring-primary" : "hover:bg-secondary"}`}><span className="flex items-center justify-between gap-3 text-sm"><span>{factLabels[key]}</span><strong className="tabular-nums">{numberText(count)}건</strong></span><span className="mt-2 block h-1.5 rounded-full bg-secondary"><span className="block h-full rounded-full bg-primary" style={{ width: `${count / largest * 100}%` }} /></span></button>)}</div>
          {!counts.length && <p className="py-10 text-center text-sm">선택한 대상과 월에 연결된 기록이 없습니다. 다른 월이나 대상을 선택해 주세요.</p>}
          {result.parentEvents.studentEvents > 0 && <p className="mt-3 rounded-lg bg-primary-softer px-3 py-2 text-xs leading-relaxed">설명회 {numberText(result.parentEvents.events)}회 · 행사별 참석 가족 {numberText(result.parentEvents.familyEvents)}건 · 학생별 인정 {numberText(result.parentEvents.studentEvents)}건. 형제는 각각 실적으로 인정합니다.</p>}
          <p className="mt-4 border-t border-line pt-3 text-xs">기록 원본 {numberText(result.basis.recorded)}건 · 규칙에 따른 자동 판정 {numberText(result.basis.rule)}건 · AI 판정 {numberText(result.basis.ai)}건</p>
        </section>
        <section className="overflow-hidden rounded-xl border border-line"><div className="flex flex-wrap items-center justify-between gap-3 p-4"><h2 className="font-semibold">{kind === "student" ? "학생의 기록 근거" : "연결된 학생의 근거"}</h2></div>
          {recordKind !== "all" && <div className="flex items-center justify-between bg-primary-softer px-5 py-2 text-sm"><span>{factLabels[recordKind as StudentFact["kind"]]} 기록이 있는 학생</span><button type="button" onClick={() => { setRecordKind("all"); setPage(1); }} className="underline">전체 기록 보기</button></div>}
          <DragScrollArea hideBar pan={false}><table className="w-full min-w-120 table-fixed text-left text-sm"><colgroup><col className="w-[28%]" /><col className="w-[32%]" /><col className="w-[20%]" /><col className="w-[20%]" /></colgroup><thead className="bg-secondary"><tr><th scope="col" className="px-5 py-3 font-medium">학생</th><th scope="col" className="px-5 py-3 font-medium">학교·학년</th><th scope="col" className="px-5 py-3 text-right font-medium">연결 기록</th><th scope="col" className="px-5 py-3 text-right font-medium">근거</th></tr></thead>
            <tbody>{rows.slice((current - 1) * 15, current * 15).map((student) => <tr key={student} className="border-t border-line-faint hover:bg-primary-softer"><td className="px-5 py-3"><button type="button" onClick={() => choose("student", student)} className="font-semibold text-primary hover:underline">{names.get(student)?.label ?? "원생"}</button></td><td className="px-5 py-3">{names.get(student)?.detail || "—"}</td>
              <td className="px-5 py-3 text-right tabular-nums">{numberText(recordKind === "all" ? Object.values(result.studentCounts[student] ?? {}).reduce((a, b) => a + (b ?? 0), 0) : result.studentCounts[student]?.[recordKind as StudentFact["kind"]] ?? 0)}건</td>
              <td className="px-5 py-3 text-right"><Link href={`/student-contribution/${student}?month=${data.month}`} className="text-primary underline underline-offset-4">기록 보기</Link></td></tr>)}</tbody></table></DragScrollArea>
          {!rows.length && <p className="py-8 text-center text-sm">조건에 맞는 학생이 없습니다.</p>}
          <ListPager page={current} total={rows.length} pageSize={15} onChange={setPage} label="연결된 학생" unit="명" />
        </section>
      </div>
      <aside className="space-y-4"><OntologyConnections key={`${kind}:${id}:${data.month}`} links={result.related} labels={data.labels} selected={selected} currentKind={kind} onSelect={choose} />
        <div className="rounded-xl bg-secondary p-5 text-xs leading-relaxed"><h3 className="mb-2 text-sm font-semibold">이렇게 읽어 주세요</h3><p>같은 기록을 여러 관점에서 살펴봅니다. 학원 전체에서는 같은 기록을 한 번만 셉니다. 당시 확인된 수강·담당 관계를 사용합니다.</p><p className="mt-3">학생 기여도를 강사 평가 점수로 합산하지 않습니다. 여러 과목의 합계 금액은 과목별로 임의 배분하지 않습니다.</p>
          {result.unallocatedTuitionFacts > 0 && <p className="mt-3">어느 과목의 금액인지 확인되지 않은 수업료 기록 {numberText(result.unallocatedTuitionFacts)}건은 위 금액에 포함되지 않았습니다.</p>}
          {result.recordedAt && <p className="mt-3 border-t border-line pt-3">최근 근거 확인 {new Date(result.recordedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}</div></aside>
    </div></>}
  </div></OntologyNavigation>;
}
