// 2.0 교재목록(app/(shell)/textbooks/page.tsx)의 조립 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회(교재 목록 · 반 배정 · 수학 배정 ·
// 쓰기 자격)는 /api/v2/textbooks(Docker 복사본, v2-screen-textbooks.mjs)가 하고 여기서는 page.tsx의 조회 뒤 본문을 **글자 그대로** 옮겼다.
// verify-v2-screen-textbooks.mjs가 글자를 대조한다. 조회 앞부분(sp · tab · subject)은 2.0과 같은 함수로 주소에서 읽는다.
import { FaceTabs } from "@/components/face-tabs";
import { PageHeader } from "@/components/page-header";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { resolveTextbookSubject, resolveTextbookTab, textbookFaces, TEXTBOOK_SUBJECTS } from "@/features/textbooks/faces";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { MathAssignmentListRow } from "@/features/textbooks/server/math-assignment-queries";
import { MathPlansFace } from "@/app/(shell)/textbooks/_components/math-plans-face";
import type { ClassTextbookPlanRow, TextbookListItem, TextbookTableStatus } from "@/features/textbooks/types";
import type { TenantSettings } from "@/features/owner/settings-types";
import { BooksFace } from "@/app/(shell)/textbooks/_components/books-face";
import { NotReadyBanner } from "@/app/(shell)/textbooks/_components/not-ready-banner";
import { PlansFace } from "@/app/(shell)/textbooks/_components/plans-face";

type Sp = Record<string, string | undefined>;

/** /api/v2/textbooks — page.tsx의 조회 결과(이름 그대로). */
export type TextbooksPageData = {
  canWrite: boolean;
  canImport: boolean;
  focusTextbook: { id: string; subject: ReturnType<typeof resolveTextbookSubject> } | null;
  list: { status: TextbookTableStatus; rows: TextbookListItem[]; total: number | null; page: number; pageSize: number };
  plans: { status: TextbookTableStatus; rows: ClassTextbookPlanRow[] };
  mathPlans: { status: TextbookTableStatus; rows: MathAssignmentListRow[] } | null;
};

/** page.tsx `TextbooksPage`의 그리기 — sp는 주소에서, 나머지는 서버 결과에서. settings는 학원 설정의 운영 칸. */
export function TextbooksHostPage({ d, sp, settings }: { d: TextbooksPageData; sp: Sp; settings: Pick<TenantSettings, "operations"> }) {
  const tab = resolveTextbookTab(sp.tab);
  const subject = resolveTextbookSubject(sp.subject);
  const { canWrite, canImport, list, plans, mathPlans } = d;

  // 표 없음(missing-table)이 그냥 실패보다 먼저 — 원인을 말하는 문구가 뜬다.
  const status: TextbookTableStatus =
    list.status === "missing-table" || plans.status === "missing-table"
      ? "missing-table"
      : list.status === "failed" || plans.status === "failed"
        ? "failed"
        : "ok";
  // 🔴 잠금은 **면마다 제 조회 상태**로 판단한다 — 교재 목록 조회가 한 번 실패했다고 다른 면까지 잠그면
  //    고칠 수 있는 일을 못 하게 막는 셈이다(그 반대도 마찬가지).
  const editable = canWrite && list.status === "ok";

  // ECS 계획 줄의 '구분'과 **같은 목록**을 쓴다(학원설정 단일 소스) — 여기서 따로 적으면 시트와 갈린다.
  // 수학엔 영역 축이 없다(설정에 skillAreas가 없으면 빈 목록 → 화면이 '구분'을 감춘다).
  const subjectSetting = settings.operations.subjects.find((s) => s.key === subject);
  const skillAreas = resolveSkillAreas(subjectSetting);
  // 과목 전환 라벨은 학원설정 단일 소스(`labelOf`) — 코드에 '영어'·'수학'을 적지 않는다.
  const { labelOf } = buildSubjectMaps(settings.operations.subjects);
  const subjectOptions = TEXTBOOK_SUBJECTS.map((key) => ({ key, label: labelOf(key) }));

  return (
    <div className="flex min-h-full w-full flex-col gap-4 p-3 md:px-5 md:py-4">
      <PageHeader
        eyebrow="수업"
        title="교재목록"
        description={
          subject === "math"
            ? "교재 한 권 = 페이지/시간·차수. 수학 강사 시트에서 반 교재나 학생별 교재로 배정합니다."
            : "교재 한 권 = 구분·페이지/시간·차수. 차수별 진도·과제를 적어 두면 영어 강사 시트의 월간계획에 차수대로 뜹니다."
        }
        embedLabel="교재 · 차수별 진도·과제 · 반 배정"
      />
      <NotReadyBanner status={status} />
      {/* ⚠️ 배지는 **거르지 않았을 때만** 숫자를 단다 — 검색 중에 `교재 6`이 뜨면 전체가 6권인 줄 안다. */}
      <FaceTabs
        faces={textbookFaces({
          books: sp.q || sp.area ? null : list.total,
          plans:
            tab !== "plans"
              ? null
              : mathPlans
                ? mathPlans.status === "ok" ? mathPlans.rows.length : null
                : plans.status === "ok" ? plans.rows.length : null,
        }, subject)}
        active={tab}
        ariaLabel="교재목록 면 전환"
      />
      {tab === "plans" && mathPlans ? (
        <MathPlansFace status={mathPlans.status} rows={mathPlans.rows} />
      ) : tab === "plans" ? (
        <PlansFace rows={plans.rows} skillAreas={skillAreas} />
      ) : (
        <BooksFace
          rows={list.rows}
          total={list.total}
          page={list.page}
          pageSize={list.pageSize}
          skillAreas={skillAreas}
          subject={subject}
          subjectOptions={subjectOptions}
          canWrite={editable}
          canImport={canImport && list.status === "ok"}
        />
      )}
    </div>
  );
}
