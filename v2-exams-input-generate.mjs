// 학기별 입력 page.tsx의 JSX를 2.0에서 복사한다. JJ실은 외부 연동이라
// 복사본에 읽기 자료가 없고, 이 호스트에서는 Docker 성적 격자만 연다.
import { readFile, writeFile } from 'node:fs/promises';

const original = new URL('../../src/app/(shell)/exams/input/page.tsx', import.meta.url);
const target = new URL('./v2-host/src/exams-input-page.tsx', import.meta.url);
let source = (await readFile(original, 'utf8')).replaceAll('\r\n', '\n');
const scopeMessage = '담당 반 일부를 불러오지 못했습니다 — 목록에 없는 반이 있으면 잠시 후 새로고침해 주세요';
if (!(await readFile(new URL('../../src/features/grades/server/teacher-classes.ts', import.meta.url), 'utf8')).includes(`GRADE_SCOPE_PARTIAL_MESSAGE = "${scopeMessage}"`))
  throw new Error('2.0 반 범위 경고 문구가 달라졌습니다');
const replace = (a, b) => { if (!source.includes(a)) throw new Error(`2.0 입력 원본이 달라졌습니다: ${a.slice(0, 70)}`); source = source.replace(a, b); };
const cut = (from, to) => {
  const i = source.indexOf(from), j = source.indexOf(to, i + from.length);
  if (i < 0 || j < 0) throw new Error(`2.0 입력 원본 구간이 달라졌습니다: ${from.slice(0, 50)}`);
  source = source.slice(0, i) + source.slice(j);
};
for (const line of [
  'import { Suspense } from "react";\n',
  'import { requireAccess } from "@/lib/auth/require-access";\n',
  'import { JJ_STUDY_MAX_DAYS, ijwStudyDay, resolveJjRange, type JjRange } from "@/features/ijw/range";\n',
  'import { ijwConfigFor } from "@/features/ijw/server/client";\n',
  'import { getJjViewer } from "@/features/ijw/server/queries";\n',
  'import { getTenantSettings } from "@/features/owner/server/queries";\n',
  'import { gradeWriteError } from "@/features/grades/server/access";\n',
  'import { getGradeSheet } from "@/features/grades/server/queries";\n',
  'import { loadTodaysMathMonthly } from "@/features/grades/server/todays-math-monthly";\n',
  'import { GRADE_SCOPE_PARTIAL_MESSAGE } from "@/features/grades/server/teacher-classes";\n',
  'import { JjExamView } from "../_components/jj-exam-view";\n',
  'import { JjLinkSection } from "../_components/jj-link-section";\n',
  'import { JjSkeleton } from "../_components/jj-shared";\n',
  'import { JjStudyView } from "../_components/jj-study-view";\n',
]) replace(line, '');
replace('import { loadGradeSortPref, saveGradeSortPref } from "@/features/grades/server/list-prefs";',
  'import { saveGradeSortPref } from "@/features/grades/server/list-prefs";');
for (const name of ['excel-trigger', 'score-grid', 'sheet-meta-fields', 'view-switch'])
  replace(`from "../_components/${name}"`, `from "@/app/(shell)/exams/_components/${name}"`);
cut('export const metadata =', '/**\n * 성적관리');
cut('const JJ_VIEWS =', '  const one = (v: unknown)');
source = source.replace('  const one = (v: unknown)', 'export function ExamsInputPage({ sp, loaded }: { sp: Record<string, string>; loaded: InputLoaded }) {\n  const one = (v: unknown)');
cut('  const rawView = one(sp.view)', '  const subjects = buildSubjectMaps');
replace('  const subjects = buildSubjectMaps(settings.operations.subjects);', '  const settings = loaded.settings;\n  const subjects = buildSubjectMaps(settings.operations.subjects);');
cut('  const jjEnabled =', '  const buildHref =');
replace('  const buildHref =', '  const sheet = loaded.sheet, sortPref = loaded.sortPref, writeError = loaded.writeError;\n  const buildHref =');
replace('      view: jjMode ?? "",\n      jjClass: jjMode ? jjClass : "",\n      from: jjMode ? from : "",\n      to: jjMode ? to : "",\n', '');
cut('    // 영어가 아니면 JJ 보기가 없다.', '    const params = new URLSearchParams();');
cut('  const viewOptions: HrefSelectOption[] = [', '  // 오늘 수학 월말평가 결과');
replace('  const todaysMath = sheet && sheet.rows.length > 0 ? await loadTodaysMathMonthly(sel, sheet.rows.map((r) => r.studentId)) : null;',
  '  const todaysMath = loaded.todaysMath;');
replace('  const gridView = !jjMode && !!sheet && sheet.rows.length > 0;', '  const gridView = !!sheet && sheet.rows.length > 0;');
cut('        {jjAvailable ? (', '        <HrefSelect axisLabel="년도"');
replace('        {jjMode ? null : (\n          <>', '        <>');
replace('          </>\n        )}', '        </>');
cut('      {jjMode && viewer && jjRange ? (', '        <ScoreGrid');
replace('        <ScoreGrid', '      {sheet && sheet.rows.length > 0 ? (\n        <ScoreGrid');
replace(' * ⚠️ 인재원 연동 보기(JJ실 학습·단어시험, 2026-09-10)는 그대로 산다 — 데이터가 다른 화면이라\n *    \'보기\' 축으로 나란히 둔다(영어 + 연동 학원 + 영어 담당일 때만).',
  ' * 3.0 복사본에는 외부 인재원 연결 자료가 없어 성적 격자만 연다.');
replace('  // 가져가 그 안에서 스크롤하고 저장 바는 창 바닥에 붙는다. JJ 뷰·빈 화면은 종전대로 문서 흐름.',
  '  // 가져가 그 안에서 스크롤하고 저장 바는 창 바닥에 붙는다. 빈 화면은 문서 흐름.');
source = '// GENERATED from 2.0 exams/input/page.tsx by v2-exams-input-generate.mjs.\n'
  + `const GRADE_SCOPE_PARTIAL_MESSAGE = ${JSON.stringify(scopeMessage)};\n`
  + 'import type { getTenantSettings } from "@/features/owner/server/queries";\n'
  + 'import type { getGradeSheet } from "@/features/grades/server/queries";\n'
  + 'import type { loadGradeSortPref } from "@/features/grades/server/list-prefs";\n'
  + 'import type { loadTodaysMathMonthly } from "@/features/grades/server/todays-math-monthly";\n'
  + 'export type InputLoaded = { settings: Awaited<ReturnType<typeof getTenantSettings>>; sheet: Awaited<ReturnType<typeof getGradeSheet>> | null; sortPref: Awaited<ReturnType<typeof loadGradeSortPref>>; writeError: string | null; todaysMath: Awaited<ReturnType<typeof loadTodaysMathMonthly>> };\n'
  + source;
if (process.argv.includes('--check')) {
  const saved = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  if (saved !== source) throw new Error('성적 입력이 2.0 원본에서 벗어났습니다');
  console.log('성적 입력 2.0 본문 대조 통과');
} else await writeFile(target, source);
