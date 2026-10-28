// Offline tests for the exit insight (INSIGHT-EXITS.md) — no DB, no network: fixture rows + 2.0's own rules (v2-bridge).
// node --test experiments/owner-concept/verify-exit-insight.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadV2 } from './v2-bridge.mjs';
import { decompose, monthlyBilling } from './exit-billing.mjs';
import { buildExitIndex } from './exit-index.mjs';
import { buildCaseFile, makeMasker } from './exit-cases.mjs';
import * as AI from './exit-ai.mjs';
import { createExitInsight, openInsightStore } from './exit-runtime.mjs';
import { createExitRoute } from './exit-http.mjs';

const v2 = await loadV2();
const line = (kind, amount, description, discount = 0) => ({ kind, amount, description, discount });
const inv = (id, student_id, period, items, discount = 0, status = 'paid') => ({ id, student_id, period, status, category: 'tuition', gross: items.reduce((n, i) => n + i.amount, 0), discount, line_items: items });
const S = (id, extra = {}) => ({ id, name: `학생${id}`, english_name: null, nickname: null, parent_name: null, school: '칠성중', grade: '중2', status: 'enrolled', enrolled_at: '2026-01-05', withdrawn_at: null, withdrawal_metadata: null, is_test: false, notes: null, ...extra });
function fixture() {
  return {
    identity: { tenantId: 't-test', tenantSlug: 'cs', capturedAt: '2026-10-27T05:34:00.000Z' },
    students: [S('s1', { status: 'withdrawn', withdrawn_at: '2026-07-20', withdrawal_metadata: { reason: 'dissatisfaction', detail: 'teacher_left', memo: '학생s1 어머님이 선생님 퇴사로 그만둔다고 하심 010-1234-5678' } }),
      S('s2', { status: 'withdrawn', withdrawn_at: '2026-08-17', withdrawal_metadata: { reason: 'other', memo: '데이터 정리 일괄 퇴원' } }),
      S('s3'), S('s4', { enrolled_at: '2026-08-01' }), S('s5', { is_test: true }),
      S('s6', { status: 'withdrawn', withdrawn_at: '2026-07-28', withdrawal_metadata: { reason: null, memo: null } }),
      S('s7', { status: 'withdrawn', withdrawn_at: '2026-07-10', withdrawal_metadata: { reason: 'other', memo: '수강 반 없음 일괄 퇴원 처리 (2026-07-10)' } }),
      S('s8', { status: 'on_hold' })],
    phones: [], links: [], terms: [], transitions: [], reports: [], archives: [], grades: [], consultations: [], evaluationConfig: null, subjects: [{ key: 'math', label: '수학' }],
    users: [{ id: 't1', display_name: '김선생', english_name: null, status: 'inactive' }, { id: 't2', display_name: '박선생', english_name: null, status: 'active' }],
    classes: [{ id: 'c1', class_name: '중2 수학 A', subject: 'math', english_track: null, teacher_id: 't1', is_active: false, closed_at: '2026-07-21', report_optout: false, is_makeup_pool: false, is_special: false },
      { id: 'c2', class_name: '중2 수학 B', subject: 'math', english_track: null, teacher_id: 't2', is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false, is_special: false }],
    schedules: [{ id: 'h1', class_id: 'c1', day_of_week: 'mon', start_time: '15:00:00', end_time: '16:00:00', teacher_id: 't1', slot_teacher_label: null, lab_separate: false, valid_from: '2026-03-01', valid_to: '2026-07-21' },
      { id: 'h2', class_id: 'c2', day_of_week: 'tue', start_time: '15:00:00', end_time: '16:00:00', teacher_id: 't2', slot_teacher_label: null, lab_separate: false, valid_from: '2026-03-01', valid_to: null }],
    enrollments: [{ id: 'e1', student_id: 's1', class_id: 'c1', start_date: '2026-03-02', end_date: '2026-07-20', on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null },
      { id: 'e2', student_id: 's2', class_id: 'c2', start_date: '2026-03-02', end_date: '2026-07-03', on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null },
      { id: 'e3', student_id: 's3', class_id: 'c2', start_date: '2026-03-02', end_date: null, on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null },
      { id: 'e4', student_id: 's4', class_id: 'c2', start_date: '2026-08-03', end_date: null, on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null },
      { id: 'e6', student_id: 's6', class_id: 'c2', start_date: '2026-03-02', end_date: '2026-07-28', on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null },
      { id: 'e8', student_id: 's8', class_id: 'c2', start_date: '2026-03-02', end_date: null, on_hold: true, attendance_days: null, is_transferred: false, is_transferred_in: false, withdrawal_reason: null }],
    attendance: [{ id: 'a1', student_id: 's1', class_id: 'c1', d: '2026-07-06', status: 'present' }, { id: 'a2', student_id: 's1', class_id: 'c1', d: '2026-07-13', status: 'absent' }, { id: 'a3', student_id: 's2', class_id: 'c2', d: '2026-06-09', status: 'present' }],
    invoices: [inv('i1', 's1', '2026-06', [line('수업', 300000, '중2 수학 A')]), inv('i2', 's1', '2026-07', [line('수업', 300000, '중2 수학 A')]),
      inv('i3', 's2', '2026-06', [line('수업', 250000, '중2 수학 B')]),
      inv('i4', 's3', '2026-06', [line('수업', 300000, '중2 수학 B')]), inv('i5', 's3', '2026-07', [line('수업', 300000, '중2 수학 B'), line('수업', 200000, '[특강] 여름 집중'), line('교재', 15000, '교재')], 10000),
      inv('i6', 's3', '2026-08', [line('수업', 300000, '중2 수학 B', 30000), line('차량비', 20000, '스쿨버스비')], 45000),
      inv('i7', 's4', '2026-08', [line('수업', 250000, '중2 수학 B')]), inv('i8', 's5', '2026-07', [line('수업', 999000, '시험')]),
      inv('i9', 's6', '2026-06', [line('수업', 280000, '중2 수학 B')]), inv('i10', 's6', '2026-07', [line('수업', 280000, '중2 수학 B')]),
      inv('i11', 's8', '2026-07', [line('수업', 200000, '중2 수학 B')]), inv('i12', 's3', '2026-05', [line('수업', 999, 'x')], 5000)],
  };
}
const ix = src => buildExitIndex(src, v2, { asOf: '2026-10-27' });

test('decomposition adds up exactly (discounts, unsplit discounts, clamps) and excludes test students', () => {
  const src = fixture(), x = ix(src);
  for (const [a, b] of [['2026-06', '2026-07'], ['2026-07', '2026-08'], ['2026-06', '2026-08'], ['2026-05', '2026-08']]) {
    const d = decompose(x.monthly, a, b, { kindOf: sid => x.exitOf(sid)?.kind || 'other', isNew: sid => (x.studentById.get(sid)?.enrolled_at || '') >= `${a}-01`, subjectsOf: x.subjectsOf });
    assert.equal(d.check.exact, true, `${a}→${b}`);
    assert.equal(d.parts.reduce((n, p) => n + p.amount, 0), d.totals.delta);
  }
  const d = decompose(x.monthly, '2026-07', '2026-08', { kindOf: sid => x.exitOf(sid)?.kind || 'other', isNew: sid => (x.studentById.get(sid)?.enrolled_at || '') >= '2026-07-01', subjectsOf: x.subjectsOf });
  assert.deepEqual(d.totals, { from: 300000 + 505000 + 280000 + 200000, to: 275000 + 250000, delta: 525000 - 1285000 });
  assert.deepEqual(d.parts.map(p => [p.id, p.students, p.amount]), [['departed', 3, -780000], ['new', 1, 250000], ['retained', 1, -230000]]);
  // s3 (retained): July 505,000 = regular 300,000 + special 200,000 + textbook 15,000 − unsplit discount 10,000; August 275,000 = regular 270,000 + shuttle 20,000 − unsplit 15,000.
  const g = Object.fromEntries(Object.entries(d.parts[2].groups).map(([k, v]) => [k, v.amount]));
  assert.deepEqual({ special: g.special, textbook: g.textbook, shuttle: g.shuttle, other: g.other, same_down: g.same_down }, { special: -200000, textbook: -15000, shuttle: 20000, other: -5000, same_down: -30000 });
  assert.equal(d.parts[2].groups.special.estimateAmount, -200000, 'text-classified special amount is reported as an estimate');
  assert.equal(d.parts[0].groups.on_hold.students, 1);
  assert.equal(x.monthly.get('2026-07').has('s5'), false, 'test students are not billed students');
  assert.equal(x.monthly.get('2026-05').get('s3').total, 0, 'a discount above the amount clamps to zero (snapshot.mjs)');
});

test('exit month: real withdrawals keep the date; bulk clean-ups are re-timed from billing/attendance; no activity → unknown', () => {
  const x = ix(fixture());
  assert.deepEqual([x.exitOf('s1').kind, x.exitOf('s1').date, x.exitOf('s1').estimated], ['withdrawn', '2026-07-20', false]);
  const s2 = x.exitOf('s2');
  assert.equal(s2.kind, 'cleanup'); assert.equal(s2.month, '2026-07', 'month after the last bill (2026-06)'); assert.equal(s2.estimated, true); assert.equal(s2.basis.rule, 'activity'); assert.equal(s2.ledgerDate, '2026-08-17');
  const s7 = x.exitOf('s7');
  assert.equal(s7.kind, 'cleanup'); assert.equal(s7.month, null, 'no bill, no attendance, no ended enrolment → no month'); assert.equal(s7.v2BookkeepingOnly, true, '2.0 isBookkeepingOnlyExit');
  assert.equal(x.exitOf('s8').kind, 'on_hold');
});

test('case file: reasons by 2.0 labels, teacher left and class closed, sources and exact record links, masked free text', () => {
  const src = fixture(), x = ix(src), mask = makeMasker(src), c = buildCaseFile(x, v2, 's1', { mask, at: '2026-08' });
  const kinds = c.facts.map(f => f.kind);
  for (const k of ['timing', 'reason', 'class', 'attendance', 'billing']) assert(kinds.includes(k), k);
  const reason = c.facts.find(f => f.kind === 'reason');
  assert.match(reason.text, /수업·강사 · 강사 퇴사/); assert.doesNotMatch(reason.text, /dissatisfaction|teacher_left/);
  assert.doesNotMatch(reason.free, /학생s1|010-1234-5678/, 'names and contacts are masked for AI');
  const cls = c.facts.find(f => f.kind === 'class');
  assert.match(cls.text, /김선생\(현재 재직 아님\)/); assert.match(cls.text, /반 폐강 2026-07-21/); assert.equal(cls.open, null, 'a closed class has no workspace record');
  assert.deepEqual(c.facts.find(f => f.kind === 'timing').open, { family: 'withdrawals', id: 's1' });
  for (const f of c.facts) { assert(f.source?.table, `${f.kind} has a source table`); if (f.claude) assert.doesNotMatch(f.claude, /\d/, 'Claude statements carry no digits'); }
  assert.equal(c.needsJev, true); assert.equal(c.cause.code, 'teacher_change'); assert.equal(c.cause.origin, 'record');
});

test('AI output check: ids inside the input, no digits, counts, months or guesses', () => {
  const built = { input: { 묶음: [{ id: 'G-aaaaaaaa', 사실: [{ id: 'F-11111111' }] }], 학생: [{ id: 'S-22222222' }] }, clusterIds: ['G-aaaaaaaa'], factsOf: new Map([['G-aaaaaaaa', new Set(['F-11111111'])]]) };
  const good = { clusters: [{ id: 'G-aaaaaaaa', chain: [{ text: 'T 선생님이 아니라 S-22222222 학생의 반이 폐강된 뒤 퇴원했습니다', factIds: ['F-11111111'] }], summary: '반 폐강 뒤 퇴원이 이어졌습니다', confidence: '분명' }], overall: { summary: '폐강이 퇴원과 이어졌습니다', reasons: [], checks: ['확인이 필요합니다'], clusterIds: ['G-aaaaaaaa'] } };
  const v = AI.validateCohort(good, built); assert.equal(v.ok, false, 'even one latin letter outside an id is a raw code'); assert.deepEqual(v.issues, ['raw_code']);
  good.clusters[0].chain[0].text = 'S-22222222 학생의 반이 폐강된 뒤 퇴원했습니다'; assert.equal(AI.validateCohort(good, built).ok, true);
  const bad = (patch, code) => { const o = structuredClone(good); patch(o); assert(AI.validateCohort(o, built).issues.includes(code), code); };
  bad(o => { o.clusters[0].summary = '학생 4명이 퇴원'; }, 'number_in_text');
  bad(o => { o.clusters[0].summary = '그 반 학생 전원이 퇴원'; }, 'count_word');
  bad(o => { o.clusters[0].summary = '세 명이 퇴원'; }, 'count_word');
  bad(o => { o.overall.summary = '칠월에 많이 줄었습니다'; }, 'month_word');
  bad(o => { o.overall.summary = '아마 성적 때문일 것 같습니다'; }, 'guess_word');
  bad(o => { o.overall.summary = 'S-99999999 학생'; }, 'unknown_id');
  bad(o => { o.clusters[0].chain[0].factIds = ['F-99999999']; }, 'fact_outside_cluster');
  bad(o => { o.clusters = []; }, 'cluster_set');
  // Not counts: '전부터'·'일부러' and the phrases '다시 한 번'·'한 번 더'; failing fragments are kept for diagnosis.
  const fine = structuredClone(good); fine.overall.summary = '담당 교체 전부터 결석이 있었고 일부러 다시 한 번 확인한 기록은 없습니다'; assert.equal(AI.validateCohort(fine, built).ok, true);
  const kept = structuredClone(good); kept.overall.summary = '그 반 학생 전원과 Jev 판정'; assert.deepEqual(AI.validateCohort(kept, built).samples, { count_word: ['생 전원과 '], raw_code: ['과 Jev 판'] });
});

function fakeProviders({ invalid = false, unsure = false } = {}) {
  const calls = { jev: 0, claude: 0, tiers: [] };
  const answer = { main_cause: { type: 'choice', choice: 'teacher_change', confidence: unsure ? 0.2 : 0.7, probabilities: {} }, needs_person: { type: 'noul', probability: 0.2 } };
  return { calls, transport: 'cli',
    jev: { model: 'jev-1.14.0', status: async () => 'ready', decide: async () => { calls.jev += 1; return { answers: answer, model: 'jev-1.14.0' }; } },
    claude: { status: async () => 'ready', ask: async ({ input, effort }) => { calls.claude += 1; calls.tiers.push(effort);
      const out = { clusters: input.묶음.map(g => ({ id: g.id, chain: [{ text: invalid ? '학생 2명이 퇴원' : '담당 선생님이 바뀐 뒤 학생이 퇴원했습니다', factIds: g.사실.slice(0, 1).map(f => f.id) }], summary: '기록으로 이어지는 사실입니다', confidence: '일부 근거' })), overall: { summary: '선생님 변화와 퇴원이 이어집니다', reasons: [], checks: [], clusterIds: input.묶음.map(g => g.id) } };
      return { output: out, model: 'claude-sonnet-5-5', elapsedMs: 5 }; } } };
}
const MONTHS = ['2026-06', '2026-07', '2026-08'];
async function withStore(fn) { const dir = await mkdtemp(join(tmpdir(), 'exit-insight-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test('AI queue: Jev once per withdrawn student, Claude once per scheduled pair; GET and restart never call again', () => withStore(async dir => {
  const src = fixture(), p = fakeProviders();
  let overlay = await openInsightStore({ dir, identity: src.identity });
  let s = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay, providers: p });
  assert.deepEqual(s.scheduled, [['2026-07', '2026-08'], ['2026-06', '2026-08']]);
  assert.equal(p.calls.jev + p.calls.claude, 0, 'nothing runs before start');
  s.start(); await s.idle();
  assert.equal(p.calls.jev, 2, 's1 and s6 (s2 is a clean-up, s8 on hold) — each once for both pairs');
  assert.equal(p.calls.claude, 2);
  const v = s.view('2026-07', '2026-08');
  assert.equal(v.analysis.status, 'complete'); assert(v.clusters.some(c => c.ai?.chain.length)); assert.equal(v.overall.summary, '선생님 변화와 퇴원이 이어집니다');
  assert.equal(v.students.find(x => x.studentId === 's1').ai.label, '담당 교체·강사 퇴사');
  assert.equal(s.view('2026-06', '2026-07').analysis.status, 'not_scheduled');
  for (let i = 0; i < 3; i += 1) { s.view('2026-07', '2026-08'); s.index(); }
  assert.equal(p.calls.jev + p.calls.claude, 4, 'GET/index make no calls');
  await s.close(); await overlay.close();
  overlay = await openInsightStore({ dir, identity: src.identity });
  s = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay, providers: p }); s.start(); await s.idle();
  assert.equal(p.calls.jev + p.calls.claude, 4, 'restart reads the cache');
  assert.equal(s.view('2026-07', '2026-08').analysis.status, 'complete');
  await s.close(); await overlay.close();
}));

test('AI queue: an invalid answer escalates once, then stays an error (no fake summary); disabled makes no calls', () => withStore(async dir => {
  const src = fixture(), p = fakeProviders({ invalid: true }), overlay = await openInsightStore({ dir, identity: src.identity });
  const s = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay, providers: p });
  s.start(); await s.idle();
  assert.deepEqual(p.calls.tiers, ['low', 'low', 'medium', 'medium'], 'each pair: base, then one escalation');
  const v = s.view('2026-07', '2026-08');
  assert.equal(v.analysis.status, 'error'); assert.equal(v.overall, null); assert(v.clusters.every(c => c.ai === null));
  assert.deepEqual(v.analysis.claude.issues, ['number_in_text']);
  await s.close(); await overlay.close();
  const o2 = await openInsightStore({ dir: join(dir, 'b'), identity: src.identity }), off = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay: o2, providers: null, disabledReason: '자동 분석이 꺼져 있음' });
  off.start(); await off.idle();
  assert.equal(off.view('2026-07', '2026-08').analysis.status, 'disabled'); await off.close(); await o2.close();
}));

test('AI queue: ambiguous Jev picks (a third or more need a person) call Claude at medium from the start', () => withStore(async dir => {
  const src = fixture(), p = fakeProviders({ unsure: true }), overlay = await openInsightStore({ dir, identity: src.identity });
  const s = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay, providers: p });
  s.start(); await s.idle();
  assert.deepEqual(p.calls.tiers, ['medium', 'medium']);
  const v = s.view('2026-07', '2026-08'); assert.equal(v.analysis.claude.tier, 'escalated'); assert.equal(v.students.find(x => x.studentId === 's1').ai.review, true);
  await s.close(); await overlay.close();
}));

test('HTTP: GET only, same-origin, exact params; 503 while starting', async () => {
  const src = fixture(), dir = await mkdtemp(join(tmpdir(), 'exit-http-')), overlay = await openInsightStore({ dir, identity: src.identity });
  const service = createExitInsight({ source: src, v2, asOf: '2026-10-27', months: MONTHS, overlay });
  const box = { service: null, failure: null }, route = createExitRoute({ insight: box });
  const server = createServer((req, res) => (route.handles(new URL(req.url, 'http://x').pathname) ? route.handle(req, res) : res.end()));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/api/insight/exits`;
  try {
    assert.equal((await fetch(url)).status, 503);
    box.service = service;
    const index = await (await fetch(url)).json(); assert.deepEqual(index.pairs.map(p => [p.from, p.to]), [['2026-07', '2026-08'], ['2026-06', '2026-08']]);
    const pair = await fetch(`${url}?from=2026-07&to=2026-08`); assert.equal(pair.status, 200); assert.equal((await pair.json()).check.exact, true);
    assert.equal((await fetch(`${url}?from=2026-08&to=2026-07`)).status, 400);
    assert.equal((await fetch(`${url}?from=2026-07`)).status, 400);
    assert.equal((await fetch(`${url}?from=2026-07&to=2026-08&x=1`)).status, 400);
    assert.equal((await fetch(`${url}?from=2025-01&to=2026-08`)).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  } finally { server.close(); await service.close(); await overlay.close(); await rm(dir, { recursive: true, force: true }); }
});

test('line groups: a class tied by 회차 확정 decides; otherwise kind, then text (estimate)', () => {
  const special = v2.isSpecialLecture, m = monthlyBilling([inv('x', 'a', '2026-07', [line('수업', 100, '정규'), line('수업', 50, '정규 이름이지만 특강 반')])], { eligible: () => true, terms: [{ invoice_id: 'x', line: 1, class_id: 'k' }], classById: new Map([['k', { class_name: '고등 수능특강', is_special: false }]]), isSpecialLecture: special });
  const s = m.get('2026-07').get('a'); assert.equal(s.groups.special, 50); assert.equal(s.text.special, 0, 'class-based, not an estimate'); assert.equal(s.groups.regular, 100);
});
