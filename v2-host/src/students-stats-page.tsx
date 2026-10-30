// 2.0 students/stats/page.tsx의 본문. 서버 로더와 카드별 Promise는
// /api/v2/students?v2path=/students/stats에서 원본 함수를 실행해 기다린 값이다.
import { PageHeader } from '@/components/page-header';
import { BackToListButton } from '@/app/(shell)/consultations/_components/back-to-list-button';
import { StatCard } from '@/app/(shell)/students/stats/_components/stat-card';
import { SubjectSwitch } from '@/app/(shell)/students/stats/_components/subject-switch';
import { StatsWidthGate } from '@/app/(shell)/students/stats/_components/stats-width-gate';
import { FIRST_CLASS_KEYS } from '@/features/students/stats/first-class-trend';
import { TREND_KEYS, viewFromParam } from '@/features/students/stats/model';
import {
  TrendSection, CourseSection, FirstClassSection, FlowSection,
  type ReadyStats,
} from './students-stats-sections';

export type StudentStatsData = {
  stats: ReadyStats;
  settings: { operations: { subjects: { key: string; label: string; color?: string }[] } };
};

export function StudentsStatsPage({ data, sp }: { data: StudentStatsData; sp: Record<string, string> }) {
  const { stats, settings } = data;
  const view = viewFromParam(sp.view) ?? stats.prefs.view;
  const scope = stats.scope;
  const description = scope ? `그동안의 재원생 흐름과 달마다 있었던 등록·퇴원 · ${scope.label} 기준` : '그동안의 재원생 흐름과 달마다 있었던 등록·퇴원';
  const boardKey = `${view}|${scope?.active ?? scope?.label ?? 'all'}`;
  const parts = stats.parts;
  const ctx = parts ? { stats, parts, settings: settings as never, scopeLabel: scope?.label ?? null } : null;
  const periodKeys = [...Object.values(FIRST_CLASS_KEYS), ...Object.values(TREND_KEYS)];
  const keepAll = Object.fromEntries([...periodKeys, 'view', 'subject'].map((k) => [k, sp[k]]));

  return <div className="@container/panel space-y-4 compact-chrome:space-y-3">
    <PageHeader title="원생 통계" description={description} embedLabel="원생 통계" />
    <div className="flex flex-wrap items-center gap-2 px-1">
      <BackToListButton href="/students" />
      {scope?.active && scope.choices.length > 1 ? <SubjectSwitch choices={scope.choices} active={scope.active} view={sp.view}
        keep={Object.fromEntries(periodKeys.map((k) => [k, sp[k]]))} /> : null}
    </div>
    {stats.teacherScoped ? <StatCard id="trend" title="원생 통계" note="강사 화면">
      <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 원생 통계를 보이지 않습니다. 담당 학생 기준 통계는 아직 준비되지 않았습니다.</p>
    </StatCard> : stats.scopeEmpty || !ctx ? <StatCard id="trend" title="원생 통계" note="담당 과목">
      <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
    </StatCard> : <StatsWidthGate>
      <TrendSection {...ctx} view={view} boardKey={boardKey} keep={keepAll} />
      <CourseSection {...ctx} boardKey={boardKey} />
      <FirstClassSection {...ctx} keep={keepAll} />
      <FlowSection {...ctx} boardKey={boardKey} />
    </StatsWidthGate>}
  </div>;
}
