// 2.0 UnifiedDashboard 서버 컴포넌트의 본문을 그대로 쓰되 서버 조회 자리만
// /api/v2/exams의 원본 함수 실행 결과로 바꾼다.
import { readFile, writeFile } from 'node:fs/promises';

const original = new URL('../../src/app/(shell)/exams/_components/unified-dashboard.tsx', import.meta.url);
const target = new URL('./v2-host/src/exams-page.tsx', import.meta.url);
let source = (await readFile(original, 'utf8')).replaceAll('\r\n', '\n');
const replace = (a, b) => {
  if (!source.includes(a)) throw new Error(`2.0 성적관리 원본이 달라졌습니다: ${a.slice(0, 75)}`);
  source = source.replace(a, b);
};
for (const line of [
  'import { gradeWriteError } from "@/features/grades/server/access";\n',
  'import { getTenantSettings } from "@/features/owner/server/queries";\n',
  'import { getUnifiedGrades } from "@/features/grades/unified/server/queries";\n',
  'import { loadTodaysMathMarks } from "@/features/grades/unified/server/todays-math-marks";\n',
  'import { goalViewsForRows } from "@/features/grades/server/goals";\n',
  'import { getStudentGradeGoals } from "@/features/students/server/queries";\n',
]) replace(line, '');
for (const name of ['unified-ledger', 'ledger-head', 'grade-entry-dialog', 'exams-toolbar', 'exam-calendar', 'overview-tab',
  'records-tab', 'student-tab', 'classes-tab', 'cohorts-tab', 'schedule-tab']) {
  replace(`from "./${name}"`, `from "@/app/(shell)/exams/_components/${name}"`);
}
replace('type Params = {', 'export type Params = {');
replace('function monthEnd(month: string): string {\n  const [y, m] = month.split("-").map(Number);\n  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);\n}\n', '');
replace('export async function UnifiedDashboard({ searchParams }: { searchParams: Params }) {',
  'export function ExamsDashboard({ searchParams, loaded }: { searchParams: Params; loaded: ExamsLoaded }) {');
replace('  const fetchFrom = tab === "schedule" && `${month}-01` < from ? `${month}-01` : from;\n  const fetchTo = tab === "schedule" && monthEnd(month) > to ? monthEnd(month) : to;\n', '');
replace('  const [data, writeError, settings] = await Promise.all([getUnifiedGrades(fetchFrom, fetchTo), gradeWriteError(), getTenantSettings()]);',
  '  const { data, writeError, settings, goalViews, studentGoals, todaysMathKeys } = loaded;');
const goalsStart = source.indexOf('  const [goalViews, studentGoals, todaysMathKeys] = await Promise.all([');
const goalsEnd = source.indexOf('\n  ]);', goalsStart);
if (goalsStart < 0 || goalsEnd < 0) throw new Error('2.0 성적 목표 조회 자리가 달라졌습니다');
source = source.slice(0, goalsStart) + source.slice(goalsEnd + '\n  ]);'.length);
source = '// GENERATED from 2.0 unified-dashboard.tsx by v2-exams-page-generate.mjs.\n'
  + 'import type { UnifiedData } from "@/features/grades/unified/server/queries";\n'
  + 'import type { getTenantSettings } from "@/features/owner/server/queries";\n'
  + 'import type { GradeGoalRow } from "@/features/students/server/queries";\n'
  + 'import type { GoalView } from "@/features/grades/goals";\n'
  + 'export type ExamsLoaded = { data: UnifiedData; writeError: string | null; settings: Awaited<ReturnType<typeof getTenantSettings>>; goalViews: Record<string, GoalView>; studentGoals: GradeGoalRow[]; todaysMathKeys: string[] };\n'
  + source;
if (process.argv.includes('--check')) {
  const saved = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  if (saved !== source) throw new Error('성적관리 화면이 2.0 원본에서 벗어났습니다');
  console.log('성적관리 2.0 본문 대조 통과');
} else await writeFile(target, source);
