import { readFile, writeFile } from 'node:fs/promises';

const original = new URL('../../src/app/(shell)/exams/view/page.tsx', import.meta.url);
const target = new URL('./v2-host/src/exams-view-page.tsx', import.meta.url);
let source = (await readFile(original, 'utf8')).replaceAll('\r\n', '\n');
const replace = (a, b) => { if (!source.includes(a)) throw new Error(`2.0 성적 확인 원본이 달라졌습니다: ${a.slice(0, 70)}`); source = source.replace(a, b); };
for (const line of [
  'import { requireAccess } from "@/lib/auth/require-access";\n',
  'import { getTenantSettings } from "@/features/owner/server/queries";\n',
  'import { getGradeOverview } from "@/features/grades/server/overview-queries";\n',
]) replace(line, '');
replace('from "../_components/view-switch"', 'from "@/app/(shell)/exams/_components/view-switch"');
replace('from "./_components/overview-table"', 'from "@/app/(shell)/exams/view/_components/overview-table"');
const start = source.indexOf('export const metadata ='), body = source.indexOf('  const one = (v: unknown)', start);
if (start < 0 || body < 0) throw new Error('2.0 성적 확인 함수 머리가 달라졌습니다');
source = source.slice(0, start) + 'export function ExamsViewPage({ sp, loaded }: { sp: Record<string, string>; loaded: ViewLoaded }) {\n' + source.slice(body);
replace('  const settings = await getTenantSettings();', '  const settings = loaded.settings;');
replace('  const overview = await getGradeOverview({ year, term, subject, classId });', '  const overview = loaded.overview;');
source = '// GENERATED from 2.0 exams/view/page.tsx by v2-exams-view-generate.mjs.\n'
  + 'import type { getTenantSettings } from "@/features/owner/server/queries";\n'
  + 'import type { getGradeOverview } from "@/features/grades/server/overview-queries";\n'
  + 'export type ViewLoaded = { settings: Awaited<ReturnType<typeof getTenantSettings>>; overview: Awaited<ReturnType<typeof getGradeOverview>> };\n'
  + source;
if (process.argv.includes('--check')) {
  const saved = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  if (saved !== source) throw new Error('성적 확인 화면이 2.0 원본에서 벗어났습니다');
  console.log('성적 확인 2.0 본문 대조 통과');
} else await writeFile(target, source);
