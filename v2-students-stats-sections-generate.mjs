// 2.0 sections.tsx는 async Server Component다. 같은 본문을 브라우저 호스트에서
// 사용하기 위해, 서버에서 이미 기다려 받은 Promise 자리만 동기 값으로 바꾼다.
import { readFile, writeFile } from 'node:fs/promises';

const original = new URL('../../src/app/(shell)/students/stats/_components/sections.tsx', import.meta.url);
const target = new URL('./v2-host/src/students-stats-sections.tsx', import.meta.url);
let source = (await readFile(original, 'utf8')).replaceAll('\r\n', '\n');
const replace = (a, b) => {
  if (!source.includes(a)) throw new Error(`2.0 통계 구역 원본이 달라졌습니다: ${a.slice(0, 70)}`);
  source = source.replace(a, b);
};
replace('type Ctx = { stats: StudentStats; parts: StudentStatsParts; settings:',
  'type ReadyParts = { [K in keyof StudentStatsParts]: Awaited<StudentStatsParts[K]> };\nexport type ReadyStats = Omit<StudentStats, "trustFrom" | "parts"> & { trustFrom: string | null; parts: ReadyParts | null };\ntype Ctx = { stats: ReadyStats; parts: ReadyParts; settings:');
replace('async function trendContext', 'function trendContext');
replace('const [trend, trustFrom] = await Promise.all([parts.trend, stats.trustFrom]);', 'const trend = parts.trend, trustFrom = stats.trustFrom;');
replace('async function historyMonths({ parts, scopeLabel }: Ctx): Promise<HistoryMonth[]>', 'function historyMonths({ parts, scopeLabel }: Ctx): HistoryMonth[]');
replace('const history = await parts.history;', 'const history = parts.history;');
replace('export async function TrendSection', 'export function TrendSection');
replace('const [{ trend, bounds, countFrom, clipNote }, months] = await Promise.all([trendContext(props), historyMonths(props)]);',
  'const { trend, bounds, countFrom, clipNote } = trendContext(props), months = historyMonths(props);');
replace('export async function CourseSection', 'export function CourseSection');
replace('const [courses, ctx] = await Promise.all([parts.courses, trendContext(props)]);', 'const courses = parts.courses, ctx = trendContext(props);');
replace('export async function FirstClassSection', 'export function FirstClassSection');
replace('const firstClass = await parts.firstClass;', 'const firstClass = parts.firstClass;');
replace('export async function FlowSection', 'export function FlowSection');
replace('const [flow, ctx, months] = await Promise.all([parts.flow, trendContext(props), historyMonths(props)]);',
  'const flow = parts.flow, ctx = trendContext(props), months = historyMonths(props);');
replace('export async function HistorySection', 'export function HistorySection');
replace('const history = await parts.history;', 'const history = parts.history;');
for (const name of ['stat-card', 'trend-board', 'course-board', 'flow-board', 'history-board', 'first-class-board']) {
  replace(`from "./${name}"`, `from "@/app/(shell)/students/stats/_components/${name}"`);
}
source = '// GENERATED from the 2.0 sections.tsx by v2-students-stats-sections-generate.mjs.\n' + source;
if (process.argv.includes('--check')) {
  const saved = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n');
  if (saved !== source) throw new Error('원생 통계 구역이 2.0 원본에서 벗어났습니다');
  console.log('원생 통계 구역 2.0 본문 대조 통과');
} else await writeFile(target, source);
