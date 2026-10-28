import { ContributionLink as Link } from "@/features/student-contribution/components/student-contribution-scope";
import { Pagination } from "@/components/pagination";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { liveScopeHref } from "@/features/students/ontology/live-scope";
import { LIVE_RELATION_SCHEMA } from "@/features/students/ontology/live-relations";
import type { getCurrentOntologyScope } from "@/features/student-contribution/server/live-scope-query";
import { ContributionHeader } from "./students-contribution-header";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { CurrentScopeControls, CurrentScopeDirectory, CurrentScopeRefresh } from "./students-contribution-current-controls";
import { OntologyViewMode } from "@/features/student-contribution/components/ontology-view-mode";
import { entityLabels } from "@/features/student-contribution/components/ontology-labels";
import { OntologyFilters } from "@/features/student-contribution/components/ontology-filters";
import { OntologyNavigation } from "@/features/student-contribution/components/ontology-navigation";

type View = NonNullable<Awaited<ReturnType<typeof getCurrentOntologyScope>>>;
export function CurrentScopeExplorer({ view, embed, studentId }: { view: View; embed: boolean; studentId: string }) {
  const { data, request } = view;
  const browsing = request.kind !== "academy" && !request.id;
  const selected = data?.options.find((o) => o.kind === request.kind && o.id === request.id)?.label ?? "선택한 대상";
  return <OntologyNavigation><div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader studentId={studentId} title="학생 기록 연결" description="현재 수강과 담당 관계를 학생·반·강사·과목·학원 관점에서 확인합니다." active="ontology" canConfigure={view.canConfigure} />
    <OntologyViewMode current filters={request} scope={request} />
    {!data ? <div className="space-y-3 rounded-xl border border-line p-6" role="status">
      <h2 className="font-semibold">{view.state === "schema_missing" ? "현재 연결 조회 준비 중" : view.state === "forbidden" ? "현재 연결을 열람할 수 없습니다" : "현재 연결을 불러오지 못했습니다"}</h2>
      <p className="text-sm">{view.state === "schema_missing" ? "조회 설정이 준비되면 이곳에서 현재 수강 관계를 확인할 수 있습니다. 월별 기여도 근거는 계속 볼 수 있습니다." : "원본 기록은 그대로입니다. 열람 범위를 확인하거나 잠시 후 다시 시도해 주세요."}</p>
      <CurrentScopeRefresh />
    </div> : <>
      <section className="space-y-4 rounded-xl border border-line p-4">
        <OntologyFilters key={JSON.stringify(request)} filters={request} options={view.filterOptions} scope={request} />
        <CurrentScopeControls key={`${request.kind}:${request.id}:${request.search}`} request={request} options={data.options} />
        <div className="flex flex-wrap items-end justify-between gap-2">{!browsing && <h2 className="text-lg font-semibold">{selected}</h2>}<span className="text-xs tabular-nums">{data.asOf} 현재 수강이 연결된 학생 기준</span></div>
        {view.selectionMissing && <p role="status" className="text-sm">선택한 대상이 조회 조건에 없어 목록으로 돌아왔습니다. 조건을 바꾸거나 다른 대상을 선택해 주세요.</p>}
        {!browsing && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[["연결된 학생", data.total, "명"], ["수강 반", data.classCount, "개"], ["배정·위임된 강사", data.teacherCount, "명"], ["수강 과목", data.subjectCount, "개"]].map(([label, value, unit]) =>
            <div key={label} className="rounded-lg bg-secondary px-4 py-3"><p className="text-xs">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString("ko-KR")}<span className="ml-1 text-sm font-normal">{unit}</span></p></div>)}
        </div>
        <details className="text-xs leading-relaxed"><summary className="cursor-pointer">월별 기록의 학생 수와 다른 이유</summary><p className="mt-2">현재 유효한 수강 관계가 있는 학생만 셉니다. 월별 근거는 선택한 달의 기록이 있는 학생을 세므로 인원이 다를 수 있습니다. 여러 반에 연결된 학생도 한 번만 셉니다. 담당 배정은 실제 수업 실시나 강사 성과를 뜻하지 않습니다.</p></details></>}
        {(view.state === "partial" || data.unassignedClasses > 0) && <p role="status" className="rounded-lg bg-primary-softer p-3 text-sm">
          {view.state === "partial" ? "일부 학생·담당 연결은 확인이 필요합니다. 확인된 관계만 표시합니다. " : ""}
          {data.unassignedClasses > 0 ? `담당자가 배정되지 않은 반이 ${data.unassignedClasses}개 있습니다.` : ""}</p>}
      </section>
      {request.kind !== "academy" && <div hidden={!browsing}><CurrentScopeDirectory key={`${request.kind}:${request.status}:${request.grade}:${request.subject}:${request.search}`} request={request} options={data.options} /></div>}
      {!browsing && <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between gap-2 px-5 py-4"><h2 className="font-semibold">연결된 학생과 수강 근거</h2><span className="text-xs tabular-nums">{data.filteredTotal.toLocaleString("ko-KR")}명{request.search ? " 검색됨" : ""}</span></div>
          <DragScrollArea hideBar pan={false}><table className="w-full min-w-150 table-fixed text-sm text-left"><colgroup><col className="w-[22%]" /><col className="w-[26%]" /><col className="w-[52%]" /></colgroup>
            <thead className="bg-secondary"><tr>{["학생", "학교·학년", "수강·담당 연결"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{data.students.map((student) => <tr key={student.id} className="border-t border-line-faint align-top">
              <td className="px-5 py-4"><Link prefetch={false} href={`/student-contribution/${student.id}`} className="font-semibold text-primary hover:underline">{student.name}</Link></td>
              <td className="px-5 py-4">{schoolGradeLabel(student.school, student.grade) || "—"}</td>
              <td className="space-y-3 px-5 py-4">{student.classes.map((cls) => <div key={cls.id}><Link prefetch={false} href={liveScopeHref({ ...request, kind: "class", id: cls.id, page: 1 }, embed)} className="font-medium text-primary hover:underline">{cls.name}</Link>{cls.onHold && <span className="ml-2 text-xs">휴원</span>}
                <p className="mt-1 text-xs leading-relaxed">{([...new Set(cls.teachers.map((t) => `${LIVE_RELATION_SCHEMA[t.role].label} ${t.name}`))].join(" · ")) || "담당자 확인 필요"}</p>
                <details className="mt-1 text-xs"><summary className="cursor-pointer">수강 근거 {cls.enrollmentIds.length}건</summary><Link prefetch={false} href={`/students/${student.id}?tab=classes`} className="mt-2 inline-block text-primary underline">학생의 수강 원본 보기</Link></details>
              </div>)}</td>
            </tr>)}</tbody>
          </table></DragScrollArea>
          {!data.students.length && <p className="p-8 text-center text-sm">{request.search ? "검색 조건에 맞는 학생이 없습니다." : "이 대상에 현재 연결된 수강 기록이 없습니다."}</p>}
          <div className="border-t border-line px-4 py-4"><Pagination page={data.page} totalPages={Math.max(1, Math.ceil(data.filteredTotal / 20))} total={data.filteredTotal}
            hrefForPage={(page) => liveScopeHref({ ...request, page }, embed)} scroll={false} /></div>
        </section>
        <aside className="space-y-4">{(["class", "teacher", "subject"] as const).map((kind) => {
          const nodes = data.connections.filter((n) => n.kind === kind), largest = Math.max(1, ...nodes.map((n) => n.students));
          if (!nodes.length) return null;
          return <section key={kind} className="rounded-xl border border-line p-4"><h3 className="mb-3 font-semibold">함께 연결된 {entityLabels[kind]}</h3>
            <ul className="space-y-3">{nodes.slice(0, 6).map((node) => <li key={node.id}><Link prefetch={false} href={liveScopeHref({ ...request, kind, id: node.id, page: 1 }, embed)} className="flex items-start justify-between gap-3 text-sm text-primary hover:underline"><span>{node.label}</span><span className="shrink-0 tabular-nums">{node.students}명</span></Link><div aria-hidden="true" className="mt-2 h-1 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${node.students / largest * 100}%` }} /></div></li>)}</ul>
            {nodes.length > 6 && <p className="mt-3 text-xs">전체 {nodes.length}개 중 6개 · 위 대상 선택에서 모두 찾을 수 있습니다.</p>}
            <p className="mt-3 text-xs leading-relaxed">각 대상에 함께 연결된 학생 수입니다. 중복 수강이 있어 서로 더한 값은 전체 인원과 다를 수 있습니다.</p>
          </section>;
        })}</aside>
      </div>}
    </>}
  </div></OntologyNavigation>;
}
