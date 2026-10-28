// 2.0 화면 — 수업보고서 관리 저장 시험(v2-lesson-reports-save.mjs · Docker 복사본 · 전부 트랜잭션째 되돌림 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-lesson-reports-save.mjs
// ① 대응표 = 2.0 서버 함수 이름 그대로 · 거절 목록과 겹치지 않음 ② 1차 저장(회수 · 멈춤 복구 · 원아 연결 · 프롬프트 · 통계 보기 기억 · 보고서 설정)
// ③ 저장하는 사람 · 입력 모양 · 진입점(발송 요청 · 바깥으로 나가는 일은 그 자리에서 거절).
// 시험 학생 = is_test(학원삼 · 학원이).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const RA = 'features/report-admin/server/';
const VIA = '3.0 연습 복사본';
const NET = `select case when to_regclass('net.http_request_queue') is null then -1 else (select count(*)::int from net.http_request_queue) end n`;

let ctx = null;
async function setup() {
  if (ctx) return ctx;
  const { tenantId: t } = await import('./full-db.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { studentsBase } = await import('./v2-students-common.mjs');
  const S = await import('./v2-lesson-reports-save.mjs');
  const { runV2Server } = await import('./v2-server-runner.mjs');
  let editors;
  await db.begin('read only', async (sql) => { editors = await S.readLessonEditors(await studentsBase({ sql, tenantId: t, importV2 })); });
  const master = editors[0];
  // 시험 보고서: 학원삼(is_test) 미발송 수학 보고서 · 발송된(success) 시험 보고서 하나.
  const [unsent] = await db`select r.id::text id, r.class_id::text class_id, r.student_id::text student_id from public.lesson_reports r join public.students s on s.id = r.student_id
    where r.tenant_id=${t} and s.is_test and r.classnote_status is null and r.revoked_at is null and r.subject='math' and r.class_id is not null order by r.report_date desc limit 1`;
  const [sent] = await db`select r.id::text id from public.lesson_reports r join public.students s on s.id = r.student_id
    where r.tenant_id=${t} and s.is_test and r.classnote_status='success' and r.revoked_at is null order by r.report_date desc limit 1`;
  const [{ n: net }] = await db.unsafe(NET);
  // 시험 전용: 고른 사람으로 · 쓰기 트랜잭션 · 끝나면 되돌림(probes = 같은 트랜잭션에서 읽은 뒤).
  const run = (steps, probes = [], allowRefs = false) => runV2Server({ steps, probes, allowRefs, actorId: master.id, tenantId: t, mode: 'write', rollback: true });
  ctx = { t, importV2, S, editors, master, unsent, sent, net, run };
  return ctx;
}

test('대응표 = 2.0 서버 함수 이름 그대로(그 파일이 내보내는 async 함수) · 진입점 거절 목록과 겹치지 않음 · 보고서 설정은 학원 설정 저장 그대로', async () => {
  const { LR_WRITES, lessonReportsActions } = await import('./v2-lesson-reports-save.mjs');
  for (const [module, names] of Object.entries(LR_WRITES)) {
    const code = lf(await src(module));
    for (const n of names) assert.match(code, new RegExp(`export async function ${n}\\(`), `${module}#${n}`);
  }
  const entry = lf(await here('./v2-host/src/lesson-reports.tsx'));
  const refuse = entry.slice(entry.indexOf('const REFUSE'), entry.indexOf('for (const [module, names] of Object.entries(REFUSE))'));
  for (const name of Object.keys(lessonReportsActions)) assert.ok(!refuse.includes(`"${name}"`), `${name}이 거절 목록에도 있다`);
  for (const n of ['saveReportStatsMode', 'saveOwnerSection', 'requestReportRecall', 'savePrompt']) {
    assert.ok(n in lessonReportsActions, n);
    assert.ok(!entry.includes(`"${n}", async () => ({ ok: false`), `${n}을 진입점이 거절한다`);
  }
  // 바깥으로 나가는 일은 받지 않는다(진입점이 그 자리에서 거절).
  for (const n of ['sendClassnoteForUnsent', 'retryClassnote', 'saveAndQueueAdminReport', 'sendBulkAdminReports', 'sendClassNotice', 'sendClassWideNotice', 'editPostedNotice', 'cancelOnescreenNotice', 'requestParentReply', 'requestParentReaction'])
    { assert.ok(refuse.includes(`"${n}"`), n); assert.ok(!(n in lessonReportsActions), n); }
  assert.match(entry, /"requestClassnoteBoardSync", async \(\) => \(\{ ok: false, error: VIEW_ONLY \}\)/);
  assert.match(entry, /"testPrompt", async \(\) =>/);
});

test('저장하는 사람 = 보고서 관리 · 보고서 설정 · AI 멘트 중 하나라도 쓰기인 재직 직원(운영자 계정 제외 · 원장 먼저) · 목록 밖 = 로그인 없음', { skip: SKIP }, async () => {
  const { editors, master, t, importV2, S } = await setup();
  assert.equal(master.role, '원장');
  const supers = new Set((await db`select id::text id from public.super_admins`).map((r) => r.id));
  assert.ok(editors.every((e) => !supers.has(e.id)));
  // 퇴사·운영자 계정은 목록 밖.
  const inactive = new Set((await db`select id::text id from public.users where tenant_id=${t} and status::text <> 'active'`).map((r) => r.id));
  assert.ok(editors.every((e) => !inactive.has(e.id)));
  // 입력 모양 — 모듈이 다르면 · 인자 넷 넘으면 · 고른 사람이 uuid가 아니면 400.
  const a = S.lessonReportsActions.requestReportRecall;
  assert.throws(() => a.validate({ module: `${RA}actions.ts`, actor: master.id, args: [[]] }), /입력 값/);
  assert.throws(() => a.validate({ module: `${RA}recall-actions.ts`, actor: 'x', args: [[]] }), /입력 값/);
  assert.deepEqual(a.validate({ module: `${RA}recall-actions.ts`, actor: master.id, args: [['a']] }), { actor: master.id, args: [['a']] });
  // 보고서 설정 면 = 'report' 섹션만.
  const own = S.lessonReportsActions.saveOwnerSection, form = (section) => ({ $formData: [['section', section], ['data', '{}']] });
  assert.throws(() => own.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, form('profile')] }), /보고서 설정만/);
  assert.ok(own.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, form('report')] }));
  void importV2;
});

test('1차 회수 = 2.0 requestReportRecall — 행이 recall_requested · 링크 즉시 끊김 · 감사로그 via · 바깥 요청 0', { skip: SKIP }, async () => {
  const { run, sent, t, net } = await setup();
  assert.ok(sent, '발송된 시험 보고서');
  const r = await run([{ module: `${RA}recall-actions.ts`, fn: 'requestReportRecall', args: [[sent.id]] }], [
    { text: `select classnote_status, revoked_at is not null revoked from public.lesson_reports where id=$1`, params: [sent.id] },
    { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and created_at = now() order by id`, params: [t] },
    { text: NET }]);
  assert.deepEqual(r.results[0].value, { ok: true, recalled: 1, skipped: 0, forbidden: 0 });
  assert.deepEqual([...r.probes[0]], [{ classnote_status: 'recall_requested', revoked: true }]);
  assert.ok(r.probes[1].some((l) => l.via === VIA), '감사로그 via');
  assert.equal(r.probes[2][0].n, net, 'pg_net 큐 증가 0');
  const [after] = await db`select classnote_status from public.lesson_reports where id=${sent.id}`;
  assert.equal(after.classnote_status, 'success', '되돌림');
});

test('1차 멈춤 복구 · 원아 연결 · 프롬프트 저장·되돌리기 · 통계 보기 기억 = 2.0 함수 그대로(테스트 학생 연결은 2.0이 거절)', { skip: SKIP }, async () => {
  const { run, unsent, master, t } = await setup();
  const reset = await run([{ module: `${RA}actions.ts`, fn: 'resetStuckClassnote', args: [] }]);
  assert.equal(reset.results[0].value.ok, true); assert.equal(typeof reset.results[0].value.reset, 'number');
  const [board] = await db`select board_id::int board_id from public.classnote_class_boards where tenant_id=${t} and class_id=${unsent.class_id}`;
  const link = await run([
    { module: `${RA}board-roster-actions.ts`, fn: 'linkClassnoteChild', args: [{ studentId: unsent.student_id, boardId: board?.board_id ?? 1, childId: 1 }] },
    { module: `${RA}board-roster-actions.ts`, fn: 'unlinkClassnoteChild', args: [{ studentId: unsent.student_id, boardId: board?.board_id ?? 1 }] }]);
  assert.deepEqual(link.results[0].value, { ok: false, error: '테스트 학생은 연결하지 않습니다' });
  assert.deepEqual(link.results[1].value, { ok: true });
  const P = 'features/onescreen/server/prompt-actions.ts';
  const pr = await run([{ module: P, fn: 'savePrompt', args: ['comment', '시험 프롬프트 {{facts}}'] }],
    [{ text: `select is_active, prompt_text from public.ai_prompt_overrides where tenant_id=$1 and prompt_type='comment' and created_at = now()`, params: [t] }]);
  assert.deepEqual(pr.results[0].value, { ok: true });
  assert.deepEqual([...pr.probes[0]], [{ is_active: true, prompt_text: '시험 프롬프트 {{facts}}' }]);
  const rp = await run([{ module: P, fn: 'savePrompt', args: ['comment', '시험 프롬프트 {{facts}}'] }, { module: P, fn: 'resetPrompt', args: ['comment'] }],
    [{ text: `select count(*)::int n from public.ai_prompt_overrides where tenant_id=$1 and prompt_type='comment' and is_active`, params: [t] }]);
  assert.deepEqual(rp.results[1].value, { ok: true }); assert.equal(rp.probes[0][0].n, 0, '되돌리면 활성 재정의 없음');
  const st = await run([{ module: 'features/lesson-reports/stats/prefs-actions.ts', fn: 'saveReportStatsMode', args: [{ mode: 'day' }] }],
    [{ text: `select ui_prefs->'reportStats' p from public.users where id=$1`, params: [master.id] }]);
  assert.deepEqual(st.results[0].value, { ok: true }); assert.deepEqual(st.probes[0][0].p, { mode: 'day' });
});

test('1차 보고서 설정 = 학원 설정 저장(saveOwnerSection) 그대로 — report 섹션만 · 다른 섹션 그대로 · 감사로그 via', { skip: SKIP }, async () => {
  const { t, importV2, S, master } = await setup();
  const ROLL = new Error('rollback');
  try {
    await db.begin(async (sql) => {
      const [{ data: before }] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
      const { screen } = await import('./v2-screen-lesson-reports.mjs');
      const d = await screen.load({ sql, params: { tab: 'report' }, tenantId: t, importV2 });
      const report = { ...d.tabData.reportSettings, writingExemptTeachers: [...(d.tabData.reportSettings.writingExemptTeachers ?? []), '시험강사'] };
      const a = S.lessonReportsActions.saveOwnerSection;
      const out = await a.run({ sql, body: a.validate({ module: 'features/owner/server/actions.ts', actor: master.id, args: [null, { $formData: [['section', 'report'], ['data', JSON.stringify(report)]] }] }), tenantId: t, importV2 });
      assert.equal(out.ok, true, JSON.stringify(out));
      const [{ data: after }] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
      assert.ok(after.report.writingExemptTeachers.includes('시험강사'));
      for (const k of Object.keys(before).filter((k) => k !== 'report')) assert.deepEqual(after[k], before[k], `${k} 그대로`);
      const [log] = await sql`select metadata->>'via' via, metadata->>'section' section from public.audit_logs where tenant_id=${t} and created_at = now() and action='owner_settings_update'`;
      assert.deepEqual({ ...log }, { via: VIA, section: 'report' });
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
});

test('진입점 = 통계 화면도 저장하는 사람 목록을 받는다', async () => {
  assert.match(lf(await here('./v2-host/src/lesson-reports-stats.tsx')), /setHostEditors\(body\.editors\)/);
});

test.after(async () => { const { stopV2Server } = await import('./v2-server-runner.mjs'); await stopV2Server(); await db?.end(); });
