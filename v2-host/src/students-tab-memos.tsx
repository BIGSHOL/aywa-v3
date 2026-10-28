// 2.0 원생 상세 '특이사항' 탭(app/(shell)/students/[id]/_tabs/memos-tab.tsx)의 조립 — async 서버 컴포넌트라 그대로 불러올 수 없어서, 서버가 하던 조회는
// 상세 load가 고른 탭으로 함께 실어 보내고(v2-students-tab-*.mjs loadTab → data.tab.data) 여기서는 탭 본문을 **글자 그대로** 옮겼다.
// 바꾼 곳은 서버 조회 자리뿐이다(students-tab-*.swaps.json — [2.0 글자, 바꾼 글자] 짝) — verify-v2-students-tabs-c.mjs가 2.0 본문에 같은 짝을 대어 대조한다.
// 2.0이 상대 경로로 부르던 부품은 같은 파일을 @/ 경로로 부른다.
import { SheetText } from "@/features/teacher-view/interface-label";
import type { StudentMemoRow } from "@/features/students/server/queries";
import { MemoForm } from "@/app/(shell)/students/[id]/_components/memo-form";
import { MemoItem } from "@/app/(shell)/students/[id]/_components/memo-item";
import { useStudentTab } from "./students-shared";

/** 상세 load가 실어 보내는 이 탭의 자료(v2-students-tab-memos.mjs) — 2.0 getStudentMemos 그대로. */
type MemosTabData = { memos: StudentMemoRow[] };

// ── 2.0 탭 본문(글자 그대로 · 바뀐 곳은 swaps.json 짝뿐) ──
export function MemosTab({ studentId }: { studentId: string }) {
  const { memos } = useStudentTab<MemosTabData>();

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"특이사항"} /></h2>
        <p className="text-muted-foreground num text-xs">{memos.length}<SheetText value={"건"} /></p>
      </header>

      <MemoForm studentId={studentId} />

      {memos.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm"><SheetText value={"기록된 특이사항이 없습니다"} /></p>
      ) : (
        // 메모는 짧은 카드라 1열로만 쌓으면 넓은 창에서 한 건이 1900px 한 줄을 다 먹는다. auto-fit으로
        // 폭이 되는 만큼 열을 늘린다(1건이면 전폭 = 기존과 동일). items-start = 카드가 같은 행 최고
        // 높이로 늘어나지 않게(한 줄 메모가 긴 메모 높이만큼 부풀지 않음).
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-2">
          {memos.map((m) => (
            <MemoItem key={m.id} memo={m} studentId={studentId} />
          ))}
        </ul>
      )}
    </div>
  );
}
