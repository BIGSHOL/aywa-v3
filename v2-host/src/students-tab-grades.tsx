// 2.0 원생 상세 '성적' 탭(app/(shell)/students/[id]/_tabs/grades-tab.tsx)의 조립 — async 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// 상세 load가 고른 탭으로 함께 실어 보내고(v2-students-tab-*.mjs loadTab → data.tab.data) 여기서는 탭 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 조회 자리뿐이다(students-tab-*.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-tabs-c.mjs가 2.0 본문에 같은 짝을 대어 대조한다.
// 2.0이 상대 경로로 부르던 부품은 같은 파일을 @/ 경로로 부른다.
import { SheetText } from "@/features/teacher-view/interface-label";
import type { StudentGradeRow, GradeGoalRow, GradeCommentRow, LevelTestRow } from "@/features/students/server/queries";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import { aggregateBy, KIND_LABEL, type UnifiedRow } from "@/features/grades/unified/model";
import { applyLedgerView, parseLedgerView } from "@/features/grades/unified/ledger-view";
import type { GoalView } from "@/features/grades/goals";
import { Pagination } from "@/components/pagination";
import { StudentGradeStats } from "@/app/(shell)/exams/_components/student-stats";
import { TrendChart } from "@/app/(shell)/exams/_components/trend-chart";
import { GradeForm } from "@/app/(shell)/students/[id]/_components/grade-form";
import { GoalsSection } from "@/app/(shell)/students/[id]/_components/goals-section";
import { GradeCommentsSection } from "@/app/(shell)/students/[id]/_components/grade-comments-section";
import { LevelTests } from "@/app/(shell)/students/[id]/_components/level-tests";
import { StudentGradeRecords } from "@/app/(shell)/students/[id]/_components/student-grade-records";
import { useStudentTab } from "./students-shared";

/**
 * 상세 load가 실어 보내는 이 탭의 자료(v2-students-tab-grades.mjs) — 2.0 Promise.all 여섯 값 그대로 + 줄마다의 목표 대비(goalViewsForRows).
 * 2.0은 보이는 쪽 줄만 목표를 계산하지만 화면은 줄 key로 찾으므로 서버가 전체 줄의 값을 한 번에 낸다.
 */
type GradesTabData = {
  rows: UnifiedRow[]; grades: StudentGradeRow[]; levelTests: LevelTestRow[]; settings: { operations: { subjects: SubjectSetting[] } };
  goals: GradeGoalRow[]; comments: GradeCommentRow[]; goalViews: Record<string, GoalView>;
};

// ── 2.0 탭 본문(글자 그대로 · 바뀐 곳은 swaps.json 짝뿐) ──
/**
 * 학생 상세 '성적' — 통합 성적관리와 **같은 기록·같은 계산**(원장 2026-09-24 *"꼼꼼히 배선해서 모든 면에서 일치"*).
 * 지표 4칸·추이는 통합 성적관리 '학생 추이'와 같은 부품이고, 목록엔 수업보고서 일일·확인테스트도 선다.
 * 입력은 여전히 이 탭의 폼(성적 입력 표 — 통합 성적관리와 같은 저장 경로 `writeGradeCells`).
 */
const PAGE_SIZE = 20;
/** 성적 목록 열 머리 필터·정렬·쪽 — 주소에 싣는 키(탭을 옮기면 탭 링크가 `?tab=`만 실어 저절로 풀린다). */
export const GRADES_QUERY_KEYS = ["subject", "kind", "sort", "dir", "fScore", "fDelta", "page"] as const;

export function GradesTab({ studentId, query, back, embed }: {
  studentId: string; query: Partial<Record<(typeof GRADES_QUERY_KEYS)[number], string>>; back: string | null; embed: boolean;
}) {
  const { rows, grades, levelTests, settings, goals, comments, goalViews: rowGoalViews } = useStudentTab<GradesTabData>();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectLabels = subjectLabelRecord(settings.operations.subjects);
  const notesById = Object.fromEntries(grades.map((g) => [g.id, g.notes]));
  const points = aggregateBy(rows, "academy")[0]?.points ?? [];

  // 목록 — 지표·추이는 **학생 전체**, 목록만 열 머리 필터·정렬·쪽(통합 성적관리 원장과 같은 판정 `applyLedgerView`).
  const subject = query.subject ?? "";
  const kind = query.kind ?? "";
  const view = parseLedgerView(query);
  const listed = applyLedgerView(rows.filter((r) => (!subject || r.subject === subject) && (!kind || r.kind === kind)), view);
  const totalPages = Math.max(1, Math.ceil(listed.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), totalPages);
  const pageRows = listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // 줄마다 목표 대비 — /exams 성적 현황과 같은 함수(원장 2026-09-24 "모든 면에서 일치").
  const goalViews = rowGoalViews;
  // 🔴 창(iframe) 안이면 링크가 embed=1을 싣는다([[#133]]) · back은 페이지가 검증한 내부 경로만 온다.
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: "grades", ...query, ...(back ? { back } : {}), ...(embed ? { embed: "1" } : {}), ...patch })) if (v) q.set(k, v);
    return `/students/${studentId}?${q.toString()}`;
  };
  const filterOptions = {
    subject, kind,
    subjects: [...new Set(rows.map((r) => r.subject))].map((s) => ({ value: s, label: subjectLabels[s] ?? s })).sort((a, b) => a.label.localeCompare(b.label, "ko")),
    kinds: (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).filter((k) => rows.some((r) => r.kind === k)).map((k) => ({ value: k, label: KIND_LABEL[k] })),
  };

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"성적 기록"} /></h2>
        <p className="text-muted-foreground num text-xs">{rows.length}<SheetText value={"건"} /></p>
      </header>

      {rows.length > 0 ? (
        <>
          <StudentGradeStats rows={rows} />
          {points.length >= 2 ? (
            <div className="bg-card border-border rounded-2xl border p-4">
              <p className="micro"><SheetText value={"성적 흐름 · 월별 평균 정답률"} /></p>
              <TrendChart points={points} />
            </div>
          ) : null}
        </>
      ) : null}

      {/* JJ실 학습(인재원)은 2026-09-21에 **'SRS 성적' 탭**으로 옮겼다(원장 지시: 일반 성적과 분리).
          이 탭에 다시 끌어오지 말 것 — 두 탭이 같은 구역을 그리면 기간 칩이 서로를 튕겨 낸다. */}
      <div className="border-border border-t pt-4">
        <GoalsSection studentId={studentId} goals={goals} />
      </div>

      <GradeForm studentId={studentId} subjectOptions={subjectMaps.options} />

      <StudentGradeRecords rows={pageRows} studentId={studentId} notesById={notesById} subjectLabel={subjectLabels}
        view={view} href={href} filters={filterOptions} goals={goalViews} />
      {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} total={listed.length} hrefForPage={(p) => href({ page: String(p) })} /> : null}

      {/* 성적 코멘트 · 레벨테스트 — 둘 다 짧은 목록이라 세로로만 쌓으면 넓은 창에서 오른쪽이 통째로 빈다.
          폭이 되면 나란히(auto-fit), 좁으면 접힘. 구분선은 두 줄이 겹치지 않게 그리드 바깥에 한 번만.
          (목표 섹션은 입력폼·성적표 위라 인접하지 않아 그대로 둔다 — 순서를 바꾸면 입력 흐름이 깨진다.) */}
      <div className="border-border grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-x-6 gap-y-4 border-t pt-4">
        <GradeCommentsSection studentId={studentId} comments={comments} />
        <LevelTests studentId={studentId} tests={levelTests} />
      </div>
    </div>
  );
}
