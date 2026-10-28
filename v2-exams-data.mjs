// 2.0 통합 성적관리(UnifiedDashboard)의 서버 조회. 성적 병합·권한·목표·오늘 수학
// 판정은 원본 서버 함수 그대로. 화면의 필터·쪽 계산은 원본 순수 함수를 쓴다.
import { runV2Server } from './v2-server-runner.mjs';

const Q = 'features/grades/unified/server/queries.ts';
const ACCESS = 'features/grades/server/access.ts';
const SETTINGS = 'features/owner/server/queries.ts';
const GOALS = 'features/grades/server/goals.ts';
const STUDENTS = 'features/students/server/queries.ts';
const MATH = 'features/grades/unified/server/todays-math-marks.ts';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => {
  if (!value || !ISO.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const monthEnd = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
let pureP = null;
const pure = importV2 => (pureP ??= Promise.all([
  importV2('lib/date-kst.ts'), importV2('features/grades/unified/default-range.ts'),
  importV2('features/grades/unified/model.ts'), importV2('features/grades/unified/ledger-view.ts'),
]).then(([date, range, model, ledger]) => ({ date, range, model, ledger })).catch(e => { pureP = null; throw e; }));

export async function readExams({ tenantId, actorId, params, importV2 }) {
  const P = await pure(importV2), today = P.date.kstToday();
  const to = validDate(params.to) ? params.to : today;
  const proposedFrom = validDate(params.from) ? params.from : P.range.defaultRangeFrom(to);
  const from = proposedFrom <= to ? proposedFrom : to;
  const tab = ['overview', 'records', 'student', 'classes', 'cohorts', 'schedule'].includes(params.tab)
    ? params.tab : params.entry === '1' ? 'records' : 'overview';
  const month = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month : to.slice(0, 7);
  const fetchFrom = tab === 'schedule' && `${month}-01` < from ? `${month}-01` : from;
  const fetchTo = tab === 'schedule' && monthEnd(month) > to ? monthEnd(month) : to;
  const { results: [grades, canWrite, settings] } = await runV2Server({ tenantId, actorId, mode: 'read', steps: [
    { module: Q, fn: 'getUnifiedGrades', args: [fetchFrom, fetchTo] },
    { module: ACCESS, fn: 'gradeWriteError', args: [] },
    { module: SETTINGS, fn: 'getTenantSettings', args: [] },
  ] }, { timeoutMs: 120_000 });
  const data = grades.value, writeError = canWrite.value ?? null;
  const kind = params.kind ?? 'all', subject = params.subject ?? 'all', q = (params.q ?? '').trim();
  const showMissing = params.missing === '1';
  const isBlank = row => row.score == null && row.source !== 'level' && !row.rawScore;
  const allRows = P.model.withPreviousScores(data.records).filter(row =>
    (kind === 'all' || row.kind === kind) && (subject === 'all' || row.subject === subject) && (!q || row.name.includes(q)));
  const rows = allRows.filter(row => row.date >= from && row.date <= to).filter(row => showMissing || !isBlank(row));
  const ledgerView = P.ledger.parseLedgerView(params);
  const ledgerRows = tab === 'records' ? P.ledger.applyLedgerView(rows, ledgerView) : [];
  const page = Math.max(1, Math.min(Math.ceil(ledgerRows.length / 50) || 1, Number(params.page) || 1));
  const pageRows = tab === 'records' ? ledgerRows.slice((page - 1) * 50, page * 50) : [];
  const students = [...new Map(rows.map(row => [row.studentId, row])).values()];
  const selected = students.find(row => row.studentId === params.student);
  const studentRows = tab === 'student' && selected ? rows.filter(row => row.studentId === selected.studentId) : [];
  const { results: [goalViews, studentGoals, todaysMathKeys] } = await runV2Server({ tenantId, actorId, mode: 'read', steps: [
    { module: GOALS, fn: 'goalViewsForRows', args: [[...pageRows, ...studentRows]] },
    ...(selected && tab === 'student' ? [{ module: STUDENTS, fn: 'getStudentGradeGoals', args: [selected.studentId] }] : [{ module: GOALS, fn: 'goalViewsForRows', args: [[]] }]),
    { module: MATH, fn: 'loadTodaysMathMarks', args: [pageRows] },
  ] }, { timeoutMs: 120_000 });
  return { data, writeError, settings: settings.value, goalViews: goalViews.value ?? {},
    studentGoals: selected && tab === 'student' ? studentGoals.value ?? [] : [], todaysMathKeys: todaysMathKeys.value ?? [] };
}
