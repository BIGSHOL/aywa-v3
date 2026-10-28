// 2.0 화면 · 선생님 원스크린 시험 — node --test experiments/owner-concept/verify-v2-screen-onescreen.mjs
// Server: the copy (read-only) checked against independent SQL; Client: the page drawn from a fixture (escaping, 2.0 labels,
// every input/save/send disabled). The copy part is skipped when the local database is not running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { screen } from './v2-screen-onescreen.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const RAW = /\b(?:queued|processing|success|failed|too_old|present|absent|late|early_leave|makeup|null|undefined)\b/;

test('params: only teacher (uuid), date (YYYY-MM-DD) and all=1', () => {
  assert.equal(screen.params.teacher.test('cd2c6232-d874-43d6-ae0e-11fc062634c0'), true);
  assert.equal(screen.params.teacher.test('x'), false);
  assert.equal(screen.params.date.test('2026-10-26'), true);
  assert.equal(screen.params.date.test('2026-10-26T00'), false);
  assert.equal(screen.params.all.test('1'), true);
  assert.equal(screen.params.all.test('0'), false);
});

test('copy: a teacher day — classes, rows, saved reports and labels follow 2.0', { skip: !db && 'local database not running' }, async () => {
  const { tenantId } = await import('./full-db.mjs'), { importV2 } = await import('./v2-bridge.mjs');
  const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
  const first = await load({});
  assert(first.teacher && first.date <= first.asOf, 'default teacher and a day not after the copy');
  const d = await load({ teacher: first.teacher.id, date: first.date });
  const rows = d.students.flatMap(s => s.subjects);
  assert(d.todayClasses.length > 0 && rows.length > 0);
  for (let i = 1; i < d.todayClasses.length; i += 1) assert((d.todayClasses[i - 1].startTime || '99') <= (d.todayClasses[i].startTime || '99'), 'classes in start-time order');
  // Independent SQL: that day's reports of those students in those classes — each one sits on exactly one row.
  const ids = d.todayClasses.map(c => c.id), sids = d.students.map(s => s.id);
  const [{ n }] = await db`select count(*)::int n from public.lesson_reports where tenant_id=${tenantId} and report_date=${d.date} and student_id = any(${sids}) and class_id = any(${ids})`;
  assert.equal(rows.filter(r => r.saved && r.classId).length, n, 'saved rows = reports of that day in those classes');
  const sched = await db`select distinct class_id from public.class_schedules where tenant_id=${tenantId} and class_id = any(${ids}) and day_of_week::text=${d.dow} and (valid_from is null or valid_from<=${d.date}) and (valid_to is null or valid_to>=${d.date})`;
  assert.equal(sched.length, ids.length, 'every class shown meets on that weekday');
  for (const r of rows) {
    assert(['sent', 'draft', 'todo', 'excluded'].includes(r.sendStatus));
    if (r.saved) assert.equal(r.sendStatus, 'sent');
    for (const label of [r.gate, r.report?.badge?.label, r.attendanceLabel].filter(Boolean)) assert(!RAW.test(label), `raw code in label: ${label}`);
    assert.match(r.preview.title, /^\d{4}년 \d{2}월 \d{2}일 /);
  }
  assert(Object.keys(d.history.days).every(k => k.startsWith(d.history.month)), 'month calendar stays in the month');
});

async function page(data, query = '') {
  const src = await readFile(new URL('./v2-screen-onescreen.js', import.meta.url), 'utf8');
  let def = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  vm.runInNewContext(src, { window: { V2Screens: { register: x => { def = x; }, esc } }, document: { addEventListener() {}, querySelector: () => null } });
  return def.render({ query: new URLSearchParams(query), load: () => ({ status: 'ready', data }), go() {}, refresh() {} });
}
const row = extra => ({ classId: 'c1', className: '중2 수학 A', subjectKey: 'math', subjectLabel: '수학', name: '수학', isSpecial: false, reportOptout: false, makeup: false, today: '일차방정식', textbook: '개념원리', homeworkToday: '20~24쪽',
  attitude: '좋음', homework: '90%', tests: { daily: { score: 9, max: 10 }, check: { score: null, max: 5 } }, draft: '오늘 잘 했습니다.', trendDraft: '', note: '', fromSession: false, attendanceRaw: 'present', attendanceLabel: '출석', attendanceUnits: 3,
  report: { status: 'success', badge: { label: 'ClassNote 발송 완료', short: '발송됨' }, readAt: null, views: 2 }, prev: { date: '2026-10-22', progress: '정수', examInfo: '일일 8/10' }, gate: '발송됨 — 재발송 불가', sendStatus: 'sent', saved: true,
  preview: { title: '2026년 10월 26일 수학 보고서', fields: { textbook: '개념원리', progress: '수학 일차방정식', homeworkToday: '20~24쪽', dailyTest: '10문제 중 9개 맞음', checkTest: '', homeworkScore: '90%', attitude: '좋음', notes: '오늘 잘 했습니다.' } }, ...extra });
const fixture = () => ({ asOf: '2026-10-27', date: '2026-10-26', dateLabel: '2026년 10월 26일 (월)', dow: 'mon', teachers: [{ id: 't1', name: '김<b>선생', active: true, classes: 2 }], teacher: { id: 't1', name: '김<b>선생' },
  todayClasses: [{ id: 'c1', name: '중2 수학 A', startTime: '16:00', count: 2, delegated: false }], noClassesToday: false, showingAll: false,
  students: [{ id: 's1', name: '<img src=x onerror=alert(1)>', schoolGrade: '칠성중2', mark: '출석', subjects: [row()] }, { id: 's2', name: '이학생', schoolGrade: '칠성중2', mark: '결석', subjects: [row({ saved: false, report: null, sendStatus: 'todo', gate: '결석 — 발송 제외', attendanceRaw: 'absent', attendanceLabel: '결석' })] }],
  settings: { academyName: '인재원', showDailyTest: true, showCheckTest: true, show: { showTextbook: true, showProgress: true, showHomeworkToday: true, showDailyTest: true, showCheckTest: true, showHomework: true, showAttitude: true, showParentNote: true, showTrendNote: true, showAcademyName: true } },
  history: { month: '2026-10', weeks: [[null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']], days: { '2026-10-02': { total: 3, sent: 2, target: 3, problem: 1, actionable: 0, pending: 0 } } } });

test('page: 2.0 labels in every view, names escaped, inputs/saves/sends disabled', async () => {
  const card = await page(fixture());
  assert(!card.includes('<img src=x') && card.includes('&lt;img src=x'), 'student name escaped');
  assert(!card.includes('김<b>선생') && card.includes('김&lt;b&gt;선생'), 'teacher name escaped');
  for (const l of ['보는 선생님', '눌러서 오늘로', '작성 1', '미작성 1', '학부모 화면 미리보기', 'today 보고서', '학생 정보', '오늘 수업', '평가', '학부모 전달 내용', '이전 10/22', 'ClassNote 발송 완료', '복사본 보기 전용']) assert(card.includes(l), l);
  for (const b of ['ClassNote 발송', '자동작성', '가져오기']) assert(new RegExp(`<button[^>]*disabled[^>]*>${b}</button>`).test(card), `${b} disabled`);
  const grid = await page(fixture(), 'view=grid');
  for (const l of ['학생 · 반', '타임', '진도(오늘)', '일일', '확인', '태도', '과제 수행률', '교재명 · 보강 · 과제', '학부모 문구', '발송 · 편집', '발송가능 0', '결석 — 발송 제외']) assert(grid.includes(l), l);
  assert(/<input type="checkbox" disabled/.test(grid));
  const status = await page(fixture(), 'view=status');
  for (const l of ['미작성 1', '발송완료 1', '학부모 열람 0', '아직 안 보낸 1 / 전체 2']) assert(status.includes(l), l);
  const history = await page(fixture(), 'view=history');
  for (const l of ['작성 3건 · 학부모 발송 2/3', '학부모 발송 2 / 작성 3건', '실패 1']) assert(history.includes(l), l);
  const filtered = await page(fixture(), 'write=todo');
  assert(filtered.includes('이학생') && !filtered.includes('&lt;img src=x'), 'write filter keeps only the not-written student');
});

test.after(async () => { await db?.end(); });
