// 업무 흐름에서 판정 글 하나를 열 때 2.0 포트폴리오의 만족도 관리 창을 같은 자료·저장 동작으로 띄운다.
import { useState } from 'react';
import type { PortfolioView } from '@/features/teacher-portfolio/server/queries';
import { SatisfactionDialog } from './class-review-satisfaction-dialog';

export type JudgmentFocusData = {
  view: PortfolioView | null;
  focusJudgment: { id: string; month: string };
};

export function JudgmentFocus({ data }: { data: JudgmentFocusData }) {
  const [open, setOpen] = useState(true);
  const view = data.view;
  if (!open || !view || view.state !== 'ready') return null;
  const selected = view.selected;
  const period = selected.periods.find((p) => p.month === data.focusJudgment.month);
  if (!period) return null;
  return <SatisfactionDialog open onClose={() => setOpen(false)} period={period} teacherId={selected.id} teacherName={selected.name}
    nameOfTeacher={(id) => view.teachers.find((teacher) => teacher.id === id)?.name || '다른 선생님'} focusId={data.focusJudgment.id} />;
}
