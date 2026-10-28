// 2.0 직원 평가 종합 보기(app/(shell)/class-review/board/page.tsx)의 조립 — 조회(getReviewPrivileges · listClassReviews)는 /api/v2/class-review?v2path=/class-review/board가
// 2.0 함수로 하고 본문은 **글자 그대로**(class-review-board.swaps.json 짝만). 실명 열람 자격이 없으면 서버가 목록으로(2.0 redirect).
import Link from "next/link";
import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { ReviewListRow } from "@/features/class-review/server/queries";
import { gradeOf, type ChecklistArea } from "@/features/class-review/checklist";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { BoardTable, type BoardGroup } from "@/app/(shell)/class-review/_components/board-table";
import { areaLegendLabel, stripLeadingCircledNumber } from "@/app/(shell)/class-review/area-legend";

/** /api/v2/class-review?v2path=/class-review/board — 2.0 page가 서버에서 받던 값. */
export type ClassReviewBoardData = { rows: ReviewListRow[]; areas: ChecklistArea[]; settings: { operations: { subjects: SubjectSetting[] } } };

/**
 * 종합 보기(원장 지시 2026-08-05) — "여러 결과지의 등급·점수를 한 화면에서".
 * 강사별로 묶어 건마다 영역 소계·총점·환산·등급을 한 표로 비교한다.
 * 열람 = 실명 열람 자격과 동일(원장 + class_review 개인 예외 인원 — "예외 인원도 보여야 함").
 */
export function ClassReviewBoardPage({ data }: { data: ClassReviewBoardData }) {
  const [{ rows, areas }, settings] = [{ rows: data.rows, areas: data.areas }, data.settings];
  const subjects = buildSubjectMaps(settings.operations.subjects);

  // 강사별 그룹 — 최근 참관일 내림차순, 그룹 안도 날짜 내림차순(listClassReviews가 이미 최신순).
  const byTeacher = new Map<string, BoardGroup>();
  for (const r of rows) {
    const key = r.header.teacherId || r.header.teacherName;
    const g = byTeacher.get(key) ?? {
      teacherName: r.header.teacherName || "—",
      avgPercent: null,
      avgGrade: null,
      rows: [],
    };
    g.rows.push({
      id: r.id,
      date: r.header.date,
      subjectLabel: r.header.subject ? subjects.labelOf(r.header.subject) : null,
      subjectColor: r.header.subject ? subjects.colorOf(r.header.subject) : null,
      submitted: `${r.submittedCount}/${r.observerSlots}`,
      incomplete: r.submittedCount < r.observerSlots,
      areaSubs: r.averages ? r.averages.areaSubtotals : null,
      total: r.averages ? r.averages.total : null,
      percent: r.averages ? r.averages.percent : null,
      grade: r.averages ? r.averages.grade : null,
    });
    byTeacher.set(key, g);
  }
  const groups = [...byTeacher.values()].map((g) => {
    const graded = g.rows.filter((r) => r.percent !== null);
    const avg = graded.length
      ? Math.round((graded.reduce((a, r) => a + (r.percent ?? 0), 0) / graded.length) * 10) / 10
      : null;
    return { ...g, avgPercent: avg, avgGrade: avg !== null ? gradeOf(avg) : null };
  });

  // 열 수 = 기본 세트와 실제 평가지들 중 가장 긴 영역 수(세트 복수화 — 세트마다 영역 수가 다를 수 있다).
  const maxAreaCount = Math.max(areas.length, ...rows.map((r) => r.averages?.areaSubtotals.length ?? 0));
  const areaHeads = Array.from({ length: maxAreaCount }, (_, i) => ({
    short: String.fromCharCode(0x2460 + i), // ①②③…
    // 표시만 벗긴다. 저장된 문항 제목(areas)은 그대로 둔다.
    title: stripLeadingCircledNumber(areas[i]?.title ?? "") || `영역 ${i + 1}`,
    max: areas[i] ? areas[i].items.length * 4 : 0,
  }));

  return (
    <div className="w-full min-w-0 space-y-5 p-6">
      <div>
        <Link
          href="/class-review"
          className="text-text-dim hover:text-primary mb-2 inline-flex items-center gap-1 text-xs font-medium transition"
        >
          <ArrowLeft className="size-3.5" /> 목록으로
        </Link>
        <PageHeader
          eyebrow="직원 평가"
          title="종합 보기"
          description="강사별 평가 결과(영역 소계·총점·환산·등급)를 한 화면에서 비교합니다."
          embedLabel="직원 평가 종합"
        />
      </div>

      {groups.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">아직 평가 건이 없습니다.</p>
        </div>
      ) : (
        <BoardTable groups={groups} areaHeads={areaHeads} />
      )}

      <p className="text-text-dim text-xs">
        영역 소계는 제출된 채점들의 문항 평균 기준 ·{" "}
        {areaHeads.map((h) => areaLegendLabel(h.short, h.title, h.max)).join(" · ")} — 다른 문항
        세트로 만든 평가지의 영역 구성은 각 건 상세에서 확인하세요.
      </p>
    </div>
  );
}
