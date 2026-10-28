// 2.0 강사 시트 · 수학 반 월간(app/(shell)/mcs/[classId]/month/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회와
// 가공(교재 3개월 창·계획)은 /api/v2/mcs?v2path=/mcs/<반>/month(Docker 복사본, v2-mcs-month.mjs)가 하고 여기서는 page.tsx 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 호출 두 자리뿐(mcs-month.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-screen-mcs.mjs가 글자를 대조한다.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import type { MathMonthResult } from "@/features/math-sheets/server/month-queries";
import { countRosterPhases, rosterExtraParts } from "@/features/math-sheets/lib/roster";
import { LearningOverview } from "@/features/math-sheets/components/learning-overview";
import type { LearningData } from "@/features/math-sheets/lib/learning-plan";
import { MathTextbookProvider } from "@/features/math-sheets/components/math-textbook-context";
import type { BookWindow } from "@/features/textbooks/book-window";
import type { StudentBookPlans } from "@/features/textbooks/book-plans";
import type { MathClassTextbooks } from "@/features/textbooks/server/math-assignment-queries";
import type { SchoolExamRow } from "@/features/textbooks/server/school-exam-queries";

/** /api/v2/mcs?v2path=/mcs/<반>/month — page.tsx의 조회·가공 결과(이름 그대로). */
export type McsMonthData = {
  res: MathMonthResult;
  options: { id: string; name: string }[];
  learning: LearningData;
  canResetGoals: boolean;
  textbooks: Omit<MathClassTextbooks, "sources"> | null;
  targets: { status: "ok" | "missing-table" | "failed" } | null;
  schoolExams: { status: "ok" | "missing-table" | "failed"; rows: SchoolExamRow[] } | null;
  windows: Record<string, BookWindow>;
  plans: Record<string, StudentBookPlans>;
};

/** page.tsx `McsMonthPage`의 그리기 — classId · student · initialQuery는 주소에서, 나머지는 서버 결과에서. */
export function McsMonthPage({ d, classId, student, initialQuery }: { d: McsMonthData; classId: string; student: string | undefined; initialQuery: string }) {
  const { res, options } = d;
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="수학 강사 시트 · 월간" description="반별 월간 진도" />
        <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-6 text-sm">
          <p className="text-text-dim">{res.error}</p>
          <Link href="/mcs" className="text-primary font-bold underline-offset-2 hover:underline">
            반 목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { data } = res;
  // 집중 보기에서 과거 날짜로 이동해도 보고서가 최근 30건에서 잘리지 않게 한다.
  // 같은 반 학생 전환은 이미 조회한 자료를 사용한다.
  // 셋 다 시트 조회(게이트 통과) 뒤의 독립 조회 — 함께 받는다(B4).
  // 교재 배정은 시트 게이트(`getMathSheetMonth` 안 `requireMcsClassAccess`)를 이미 지난 반만 읽는다.
  const { learning, canResetGoals, textbooks, targets, schoolExams } = d;
  // 🔴 줄 수를 "학생 N명"이라 적지 않는다 — 행에는 이 달 중 나간 사람과 아직 안 들어온 사람이
  //    섞여 있다(카드와 **같은 함수**로 센다).
  const counts = countRosterPhases(data.students.map((s) => s.rosterPhase));
  // 카드 툴팁과 **같은 문구**로 적는다(각자 지으면 같은 수를 다른 이름으로 부른다).
  const extraLabel = rosterExtraParts(counts);
  // 필터 밖의 반으로 바로 들어와도 드롭다운이 "지금 보는 반"을 잃지 않게 맨 앞에 끼운다(ECS 월간과 같은 규약).
  const classOptions = options.some((o) => o.id === classId)
    ? options
    : [{ id: classId, name: data.className }, ...options];
  // 교재 전체 목표(원장 2026-10-20 "중3 11월말까지 3개월당 2권 · 내신기간 제외") + 지금 3개월 창.
  // 수업일은 목표 계획과 **같은 함수**로 센다. 재료(주문·보고서)는 서버에 남기고 결과만 내려보낸다.
  const { windows, plans } = d;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title={`수학 강사 시트 · 월간 — ${data.className}`}
          description={[
            data.monthLabel,
            `수업 ${data.days.length}일`,
            `학생 ${counts.on}명`,
            ...extraLabel,
          ].join(" · ")}
        />
      </div>
      <div className="min-h-0 flex-1">
        <MathTextbookProvider
          value={{
            classId,
            status: textbooks?.status ?? "failed",
            classBook: textbooks?.classBook ?? null,
            byStudent: textbooks?.byStudent ?? {},
            choices: textbooks?.choices ?? [],
            now: textbooks?.now ?? {},
            windows,
            plans,
            targetStatus: targets?.status ?? "failed",
            schoolExams: { status: schoolExams?.status ?? "failed", rows: schoolExams?.rows ?? [] },
            // 배정 쓰기 = 목표 쓰기와 같은 게이트(서버 액션이 같은 함수로 다시 본다).
            canWrite: data.canEdit,
          }}
        >
        <LearningOverview
          // 달·반이 바뀌면 클라 상태(보기·목표 편집 큐)를 새로 세운다 — 옛 달의 목표가 남으면
          // 새 달 화면에 남의 값이 잠깐 비친다.
          key={`${classId}:${data.month}:${student ?? ""}`}
          data={data}
          learning={learning}
          initialStudentId={student}
          initialQuery={initialQuery}
          classOptions={classOptions}
          canResetGoals={canResetGoals}
        />
        </MathTextbookProvider>
      </div>
    </div>
  );
}
