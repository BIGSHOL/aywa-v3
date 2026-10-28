"use client";
import { Fragment, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ContributionLink as Link } from "@/features/student-contribution/components/student-contribution-scope";
import { Button } from "@/components/ui/button";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { ReviewDisplayReport } from "@/features/student-contribution/model/review-display";
import { ReferralLink } from "@/features/student-contribution/components/referral-link";
import { ListPager } from "@/features/student-contribution/components/list-pager";
import { fieldClass, numberText, referralReason } from "@/features/student-contribution/components/presentation";
type Student = { id: string; name: string; school: string | null; grade: string | null };
const labels = { automatic: "자동 연결 조건 통과", review: "직접 확인 필요", unavailable: "소개자 정보 부족", linked: "연결 완료" };
export function ReferralReview({ report, students, canWrite }: {
  report: ReviewDisplayReport; students: Student[]; canWrite: boolean;
}) {
  const [filter, setFilter] = useState("pending"), [search, setSearch] = useState(""), [page, setPage] = useState(1), [opened, setOpened] = useState<string | null>(null);
  const names = new Map(students.map((s) => [s.id, s]));
  const candidateText = (ids: string[]) => ids.map((id) => names.get(id)?.name ?? "학생 이름 확인 필요").join(", ");
  const rows = report.rows.filter((r) => (filter === "pending" ? r.state === "automatic" || r.state === "review" : r.state === filter)
    && `${r.prospectName ?? ""} ${r.consultationDay ?? ""} ${candidateText(r.candidates)} ${r.evidence ?? ""}`.includes(search.trim()));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 15)));
  return <div className="space-y-5">
    <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-line phone:grid-cols-2">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); setOpened(null); }} className={`border-r border-line px-5 py-4 text-left last:border-r-0 focus-visible:outline-primary ${filter === key ? "bg-primary-softer" : "hover:bg-secondary"}`}><span className="block text-xs">{label}</span><strong className="mt-2 block text-xl tabular-nums">{numberText(report.counts[key as keyof typeof labels])}<span className="ml-1 text-sm font-normal">건</span></strong></button>)}</div>
    <section className="overflow-hidden rounded-xl border border-line"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
      <div className="flex flex-wrap gap-3"><input aria-label="소개 후보 검색" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); setOpened(null); }} placeholder="상담 대상·소개자·날짜 검색" className={`${fieldClass} min-w-0 w-72 max-w-full`} />
        <select aria-label="소개 확인 상태" className={fieldClass} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); setOpened(null); }}><option value="pending">확인할 소개 전체</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <p className="text-xs">{report.cutoff}까지 등록된 상담</p></div>
      <DragScrollArea hideBar pan={false}><table className="w-full min-w-200 table-fixed text-left text-sm phone:block phone:min-w-0"><colgroup className="phone:hidden"><col className="w-[22%]" /><col className="w-[18%]" /><col className="w-[17%]" /><col className="w-[25%]" /><col className="w-[18%]" /></colgroup><thead className="bg-secondary phone:hidden"><tr>{["상담 대상·날짜", "소개자 후보", "확인 상태", "확인할 내용", "상담·연결"].map((label, i) => <th scope="col" key={label} className={`px-4 py-3 font-medium ${i === 4 ? "text-right" : ""}`}>{label}</th>)}</tr></thead><tbody className="phone:block">
        {rows.slice((current - 1) * 15, current * 15).map((r) => <Fragment key={r.consultationId}><tr className="border-t border-line-faint align-top hover:bg-primary-softer phone:grid phone:grid-cols-2 phone:gap-x-2 phone:px-4 phone:py-3">
          <td className="break-words px-4 py-3 phone:col-span-2 phone:p-0"><span className="font-semibold">{r.prospectName || "상담 대상 확인 필요"}</span><span className="mt-1 block text-xs tabular-nums">{r.consultationDay || "상담일 확인 필요"}</span></td>
          <td className="break-words px-4 py-3 font-medium phone:px-0"><span className="hidden text-xs font-normal phone:block">소개자 후보</span>{candidateText(r.candidates) || "소개자 이름 확인 필요"}</td><td className="px-4 py-3 phone:px-0 phone:text-right"><span className={`inline-block rounded px-2 py-1 text-xs ${r.state === "automatic" ? "bg-primary-softer text-primary" : "bg-secondary"}`}>{labels[r.state]}</span></td>
          <td className="px-4 py-3 leading-relaxed phone:col-span-2 phone:p-0">{r.reasons.map(referralReason).join(" · ") || "이름·재원 시점·소개 문맥·충돌 여부 확인 완료"}</td><td className="px-4 py-3 text-right phone:col-span-2 phone:px-0 phone:pb-0"><Button type="button" size="sm" variant="outline" aria-expanded={opened === r.consultationId} onClick={() => setOpened(opened === r.consultationId ? null : r.consultationId)}>자세히 보기</Button></td>
        </tr>{opened === r.consultationId && <tr className="border-t border-line bg-primary-softer phone:block"><td colSpan={5} className="p-5 phone:block"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold">상담에서 확인한 소개 근거</p><p className="mt-2 leading-relaxed">{r.evidence || "추출된 소개 근거가 없습니다. 상담 원본을 확인해 주세요."}</p></div><Link href={`/enrollment/${r.consultationId}`} className="shrink-0 rounded-lg border border-line bg-card px-3 py-2 text-primary underline underline-offset-4">상담 원본 보기</Link></div>
          {canWrite && r.state !== "linked" && <div className="mt-4 border-t border-line pt-4"><ReferralLink consultationId={r.consultationId} options={r.candidates.flatMap((id) => { const s = names.get(id); return s ? [{ id, label: `${s.name} · ${schoolGradeLabel(s.school, s.grade)}` }] : []; })} /></div>}</td></tr>}</Fragment>)}
      </tbody></table></DragScrollArea>
      {!rows.length && <p className="py-12 text-center text-sm">조건에 맞는 소개 상담이 없습니다.</p>}
      <ListPager page={current} total={rows.length} pageSize={15} onChange={(next) => { setPage(next); setOpened(null); }} label="소개 확인" />
    </section>
    <p className="text-xs leading-relaxed">자동 연결 조건을 통과해도 실제 연결 전에는 점수에 반영되지 않습니다. 마지막 확인 {new Date(report.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
  </div>;
}
