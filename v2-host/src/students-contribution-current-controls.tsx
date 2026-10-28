"use client";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { liveScopeHref, type LiveScopeData, type LiveScopeRequest } from "@/features/students/ontology/live-scope";
import type { ExplorerKind } from "@/features/students/ontology/explorer";
import { entityLabels } from "@/features/student-contribution/components/ontology-labels";
import { OntologyDirectory } from "@/features/student-contribution/components/ontology-directory";
import { useOntologyNavigation } from "@/features/student-contribution/components/ontology-navigation";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

export function CurrentScopeControls({ request, options }: { request: LiveScopeRequest; options: LiveScopeData["options"] }) {
  const params = useSearchParams(), { pending, navigate } = useOntologyNavigation();
  const browsing = request.kind !== "academy" && !request.id;
  const move = (next: LiveScopeRequest) => navigate(liveScopeHref(next, params.get("embed") === "1"));
  const choose = (kind: ExplorerKind, id: string) => move({ ...request, kind, id, page: 1 });
  return <div className="space-y-3" aria-busy={pending}>
    <div className="flex flex-wrap items-center gap-3">
      <DragScrollArea hideBar pan={false} className="max-w-full rounded-lg bg-secondary"><div className="flex gap-1 p-1" aria-label="현재 연결 관점">
        {Object.entries(entityLabels).map(([key, label]) => <Button key={key} size="sm" variant={request.kind === key ? "default" : "ghost"} disabled={pending}
          aria-pressed={request.kind === key} onClick={() => choose(key as ExplorerKind, key === "academy" ? options.find((o) => o.kind === key)?.id ?? "" : "")}>{label}</Button>)}
      </div></DragScrollArea>
      {!browsing && request.kind !== "academy" && <><Button size="sm" variant="outline" disabled={pending} onClick={() => choose(request.kind, "")}>{entityLabels[request.kind]} 목록으로</Button>
        <SearchableSelect ariaLabel={`${entityLabels[request.kind]} 현재 연결 선택`} value={request.id} onValueChange={(id) => choose(request.kind, id)}
          placeholder="대상을 선택해 주세요" searchPlaceholder="이름으로 찾기" className="min-w-0 w-full sm:w-auto sm:min-w-56 sm:flex-1"
          options={options.filter((o) => o.kind === request.kind).map((o) => ({ value: o.id, label: o.label, meta: `${o.students}명` }))} /></>}
      {pending && <span role="status" className="text-xs">연결을 불러오는 중…</span>}
    </div>
  </div>;
}

export function CurrentScopeDirectory({ request, options }: { request: LiveScopeRequest; options: (LiveScopeData["options"][number] & { detail?: string })[] }) {
  const params = useSearchParams(), { pending, navigate } = useOntologyNavigation();
  return <div aria-busy={pending}>
    {pending && <p role="status" className="mb-3 text-sm">연결을 불러오는 중…</p>}
    <OntologyDirectory kind={request.kind} rows={options.filter((o) => o.kind === request.kind).map((o) => ({ ...o, count: o.students }))}
      hideSearch={request.kind === "student"}
      description={`현재 수강으로 연결된 ${entityLabels[request.kind]} 목록입니다. 이름을 선택하면 수강 관계와 근거를 볼 수 있습니다.`}
      measure={request.kind === "student" ? undefined : { label: "연결된 학생", unit: "명" }}
      onSelect={(id) => navigate(liveScopeHref({ ...request, id, page: 1 }, params.get("embed") === "1"))} />
  </div>;
}

export function CurrentScopeRefresh() {
  const router = useRouter(), [pending, start] = useTransition();
  return <Button variant="outline" size="sm" disabled={pending} onClick={() => start(() => router.refresh())}>
    {pending ? "조회 중…" : "다시 조회"}
  </Button>;
}
