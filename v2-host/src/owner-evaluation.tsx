import { EvaluationEditor } from '@/app/(shell)/owner/_components/evaluation/evaluation-editor';
import type { EvaluationConfig } from '@/features/teacher-portfolio/evaluation/config';

export type OwnerEvaluationData = {
  initial: EvaluationConfig;
  tableMissing: boolean;
  readOnly: boolean;
  presets: { id: string; name: string; config: EvaluationConfig }[];
  presetsMissing: boolean;
  preview: { month: string; rows: { teacherId: string; name: string; raws: Record<string, number | null> }[] };
};

/** 서버 컴포넌트 EvaluationFace가 조회하던 여섯 값을 2.0 원본 편집기에 전달한다. */
export function OwnerEvaluationFace({ d }: { d: OwnerEvaluationData }) {
  return <div className="space-y-4">
    <p role="note" className="bg-card border-line text-text-dim rounded-xl border px-4 py-3 text-sm">연습 자료에서 설정과 구성을 저장할 수 있습니다. 월간 점수 다시 매기기는 아직 지원하지 않습니다.</p>
    <EvaluationEditor {...d} />
  </div>;
}
