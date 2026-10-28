// 2.0 화면 퇴원관리 시험 — 읽기(2.0 queries.ts · page.tsx 재료와 같은 모양) · 저장(2.0 actions.ts 셋 + 보기 취향 + 수강 날짜) · 호스트 빌드 · 3.0 껍데기.
// 저장 시험은 시험 학생 '학원이'로 한다 — 트랜잭션 안에서 학원이를 퇴원 상태로 만든 뒤 저장하고, 모두 되돌린다(끝나면 복사본에 남는 행 0).
// 사용: node experiments/owner-concept/verify-v2-screen-withdrawals.mjs
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-withdrawals.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const here = rel => readFile(new URL(rel, import.meta.url), 'utf8');
const src = rel => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const ACTIONS = 'features/withdrawals/server/actions.ts', PREFS = 'features/withdrawals/server/trend-prefs-actions.ts', ENR = 'features/enrollments/server/actions.ts';
const STU = '6219e442-aa57-455f-a5bc-834b222d9e1c'; // 학원이(테스트 학생)
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75'; // 원장

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
const ROLL = new Error('rollback');
const tx = async fn => {
  let out;
  try {
    await db.begin(async sql => {
      const queue = async () => (await sql`select to_regclass('net.http_request_queue') is not null p`)[0].p ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
      const before = await queue();
      out = await fn(sql);
      assert.equal(await queue(), before, '바깥으로 나가는 요청이 쌓이지 않는다');
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  return out;
};
const form = obj => ({ $formData: Object.entries(obj).map(([k, v]) => [k, String(v)]) });
const run = (sql, name, actor, args, module = ACTIONS) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module, actor, args }), tenantId, importV2 });
const counts = sql => sql`select (select count(*)::int from public.audit_logs where tenant_id=${tenantId} and metadata->>'via' = '3.0 연습 복사본' and action in ('withdrawal_update','withdrawal_consultation_step','student_restore','enrollment_dates_update')) audits,
  (select status::text || coalesce(withdrawn_at::text,'') || coalesce(withdrawal_metadata::text,'') from public.students where id=${STU}) stu,
  (select string_agg(id::text || coalesce(end_date::text,'') || coalesce(withdrawal_reason,'') || on_hold::text, ',' order by id) from public.enrollments where student_id=${STU}) enr,
  (select coalesce(ui_prefs::text,'') from public.users where id=${SEOLHYUN}) prefs`;
/** 시험 준비 — 학원이를 오늘 날짜로 퇴원시킨다(사유 '기타' · 메모 · 상담 하나) · 시작한 수강은 오늘로 닫는다(사유 '기타'). 슈퍼유저 쓰기(가드 밖). */
async function withdrawStudent(sql) {
  const [{ d }] = await sql`select (now() at time zone 'Asia/Seoul')::date::text d`;
  await sql`update public.students set status='withdrawn', withdrawn_at=${d}::date,
    withdrawal_metadata=${sql.json({ reason: 'other', memo: '시험 메모', consultation: { adminCalledParent: false, teacherCalledParent: true, talkedWithStudent: false }, reportId: 'keep-me' })}
    where id=${STU}`;
  const closed = await sql`update public.enrollments set end_date=${d}::date, withdrawal_reason='기타' where student_id=${STU} and end_date is null and start_date <= ${d}::date returning id::text id`;
  return { today: d, closed: closed.map(r => r.id) };
}

try {
  const before = (await counts(db))[0];

  await check('2.0 서버 함수 이름·인자가 그대로다(actions.ts · trend-prefs-actions.ts · enrollments actions.ts)', async () => {
    const a = await src(ACTIONS), p = await src(PREFS), e = await src(ENR);
    for (const n of ['updateWithdrawalReason(\n  _prev: WithdrawalReasonState,\n  formData: FormData,', 'toggleConsultationStep(\n  _prev: ConsultationToggleState,\n  formData: FormData,', 'reactivateStudent(\n  _prev: ReactivateState,\n  formData: FormData,'])
      assert.ok(a.replaceAll('\r\n', '\n').includes(`export async function ${n}`), n);
    assert.ok(p.includes('export async function saveWithdrawalTrendPrefs(p: { showTotal?: boolean; kind?: string; axis?: string })'));
    assert.ok(e.includes('export async function updateEnrollmentDates('));
    assert.deepEqual(Object.keys(screen.actions).sort(), ['reactivateStudent', 'saveWithdrawalTrendPrefs', 'toggleConsultationStep', 'updateEnrollmentDates', 'updateWithdrawalReason']);
  });

  let list;
  await check('읽기: 목록 재료 — 퇴원(병합·수업 기록 없는 장부 정리 제외) · 수강종료 · 설정 · 추이 보기 · 판정은 따로(part=teacher)', async () => {
    list = await load({});
    assert.equal(list.viewer.role, 'master');
    assert.ok(list.editors.length > 3 && list.editors[0].role === '원장', '원장이 먼저');
    const [{ n }] = await db`select count(*)::int n from public.students where tenant_id=${tenantId} and status='withdrawn'`;
    assert.ok(list.withdrawn.length > 0 && list.withdrawn.length <= n, '퇴원 상태 학생만');
    const ids = new Set((await db`select id::text id from public.students where tenant_id=${tenantId} and status='withdrawn'`).map(r => r.id));
    assert.ok(list.withdrawn.every(w => ids.has(w.id)));
    assert.ok(list.subjectEnded.every(s => ['enrolled', 'on_hold'].includes(s.status) && s.endedSubjects.length > 0 && s.endedDetail.length === s.endedSubjects.length));
    assert.ok(list.settings.operations.subjects.length > 0 && Array.isArray(list.settings.modules.disabled));
    assert.deepEqual(Object.keys(list.trendPrefs).sort(), ['axis', 'kind', 'showTotal']);
    assert.equal(list.teacher, undefined, '목록 응답엔 판정이 없다(흘려받기)');
    const only = await load({ type: 'withdrawn' });
    assert.deepEqual(only.subjectEnded, [], "'퇴원만' 보기는 수강종료를 읽지 않는다(2.0 그대로)");
  });

  await check('읽기: 담당 판정 — 줄 × 과목 → 선생님 id · 이름 · 세는 법(퇴원율 설정)', async () => {
    const t = await load({ part: 'teacher' });
    assert.ok(t.teacher, '판정 성공');
    assert.ok(t.teacher.entries.length > 0);
    const keys = new Set([...list.withdrawn.map(w => w.id), ...list.subjectEnded.flatMap(s => s.endedDetail.map(d => `${s.id}|${d.subject}`))]);
    assert.ok(t.teacher.entries.every(([k]) => keys.has(k)), '판정 줄은 목록 줄');
    const ids = new Set(t.teacher.entries.flatMap(([, per]) => per.flatMap(([, list]) => list)));
    assert.ok([...ids].every(id => typeof t.teacher.names[id] === 'string'), '선생님마다 이름');
    assert.ok(Array.isArray(t.teacher.options.excludeReasons) && typeof t.teacher.options.countEnded === 'boolean');
  });

  const sample = list.withdrawn.find(w => w.metadata) ?? list.withdrawn[0];
  await check('읽기: 퇴원 상세 — 학생 · 수강 이력(담임) · 퇴원보고서 카드 · 콜&상담 카드 · 권한 판정 · 없는 학생은 notFound', async () => {
    const d = await load({ v2path: `/withdrawals/${sample.id}` });
    assert.equal(d.detail.id, sample.id);
    assert.equal(d.detail.studentStatus, 'withdrawn');
    const [{ n }] = await db`select count(*)::int n from public.enrollments where tenant_id=${tenantId} and student_id=${sample.id}`;
    assert.equal(d.detail.enrollmentHistory.length, n, '수강 이력 전부');
    assert.ok(['ok', 'hidden', 'error', 'not_ready'].includes(d.reportRecords.status) && ['ok', 'hidden', 'error', 'not_ready'].includes(d.consults.status));
    assert.equal(d.reportRecords.status, 'ok'); assert.equal(d.consults.status, 'ok');
    assert.deepEqual([d.canWrite, d.canReactivate, d.canOpenStudent, d.dateAccess.allowed], [true, true, true, true], '원장 = 모두 열림');
    const none = await load({ v2path: '/withdrawals/00000000-0000-4000-8000-000000000000' });
    assert.equal(none.notFound, true);
  });

  await check('저장: 퇴원 사유 — 유효 사유 · 기타는 메모 필수 · 함께 닫힌 수강 사유도 같이 · 다른 칸(상담·보고서 번호) 보존 · 감사로그 (되돌림)', async () => {
    const out = await tx(async sql => {
      const setup = await withdrawStudent(sql);
      const badReason = await run(sql, 'updateWithdrawalReason', SEOLHYUN, [null, form({ studentId: STU, reason: 'nope' })]);
      const noMemo = await run(sql, 'updateWithdrawalReason', SEOLHYUN, [null, form({ studentId: STU, reason: 'other', memo: '' })]);
      const ok = await run(sql, 'updateWithdrawalReason', SEOLHYUN, [null, form({ studentId: STU, reason: 'relocation', detail: '', memo: '이사함' })]);
      const [s] = await sql`select withdrawal_metadata m from public.students where id=${STU}`;
      const enr = await sql`select withdrawal_reason r from public.enrollments where id = any(${setup.closed}::uuid[])`;
      const [log] = await sql`select actor_id::text a, target_type, metadata from public.audit_logs where tenant_id=${tenantId} and action='withdrawal_update' and created_at >= now()`;
      return { setup, badReason, noMemo, ok, m: s.m, enr, log };
    });
    assert.equal(out.badReason.error, '유효한 퇴원 사유를 선택해주세요');
    assert.ok(out.noMemo.error, "'기타'는 메모가 있어야 한다(2.0 checkReasonInput)");
    assert.deepEqual(out.ok, { ok: true });
    assert.deepEqual([out.m.reason, out.m.memo, out.m.consultation.teacherCalledParent, out.m.reportId], ['relocation', '이사함', true, 'keep-me']);
    assert.ok(out.setup.closed.length === 0 || out.enr.every(r => r.r === 'relocation'), '퇴원일에 함께 닫힌 수강 사유도 바뀐다');
    assert.deepEqual([out.log.a, out.log.target_type, out.log.metadata.reason, out.log.metadata.enrollments, out.log.metadata.via], [SEOLHYUN, 'student', 'relocation', out.setup.closed.length, '3.0 연습 복사본']);
  });

  await check('저장: 상담 추적 — 단계 하나만 바꾸고 나머지 칸 보존 · 퇴원생 아니면 거절 · 감사로그 (되돌림)', async () => {
    const out = await tx(async sql => {
      const notWithdrawn = await run(sql, 'toggleConsultationStep', SEOLHYUN, [null, form({ studentId: STU, step: 'adminCalledParent', next: 'true' })]);
      await withdrawStudent(sql);
      const badStep = await run(sql, 'toggleConsultationStep', SEOLHYUN, [null, form({ studentId: STU, step: 'hack', next: 'true' })]);
      const ok = await run(sql, 'toggleConsultationStep', SEOLHYUN, [null, form({ studentId: STU, step: 'adminCalledParent', next: 'true' })]);
      const [s] = await sql`select withdrawal_metadata m from public.students where id=${STU}`;
      const [log] = await sql`select metadata from public.audit_logs where tenant_id=${tenantId} and action='withdrawal_consultation_step' and created_at >= now()`;
      return { notWithdrawn, badStep, ok, m: s.m, log };
    });
    assert.equal(out.notWithdrawn.error, '퇴원 상태가 아닙니다');
    assert.equal(out.badStep.error, '유효한 상담 단계가 아닙니다');
    assert.equal(out.ok, null, '2.0은 성공 때 undefined');
    assert.deepEqual([out.m.consultation.adminCalledParent, out.m.consultation.teacherCalledParent, out.m.memo, out.m.reportId], [true, true, '시험 메모', 'keep-me']);
    assert.deepEqual([out.log.metadata.step, out.log.metadata.done, out.log.metadata.via], ['adminCalledParent', true, '3.0 연습 복사본']);
  });

  await check('저장: 재원 복구 — 상태 재원 · 퇴원일·메타 비움 · 퇴원일에 닫힌 수강 다시 엶 · 감사로그 student_restore (되돌림)', async () => {
    const out = await tx(async sql => {
      const setup = await withdrawStudent(sql);
      const ok = await run(sql, 'reactivateStudent', SEOLHYUN, [null, form({ studentId: STU })]);
      const again = await run(sql, 'reactivateStudent', SEOLHYUN, [null, form({ studentId: STU })]);
      const [s] = await sql`select status::text status, withdrawn_at, withdrawal_metadata from public.students where id=${STU}`;
      const enr = await sql`select end_date, withdrawal_reason, on_hold from public.enrollments where id = any(${setup.closed}::uuid[])`;
      const [log] = await sql`select actor_id::text a, metadata from public.audit_logs where tenant_id=${tenantId} and action='student_restore' and created_at >= now()`;
      return { ok, again, s, enr, log };
    });
    assert.equal(out.ok, null);
    assert.equal(out.again.error, '퇴원 상태가 아닙니다. 화면을 새로고침해 주세요.');
    assert.deepEqual([out.s.status, out.s.withdrawn_at, out.s.withdrawal_metadata], ['enrolled', null, null]);
    assert.ok(out.enr.every(e => e.end_date === null && e.withdrawal_reason === null && e.on_hold === false), '퇴원이 닫은 수강은 다시 열린다');
    assert.deepEqual([out.log.a, out.log.metadata.studentId, out.log.metadata.via], [SEOLHYUN, STU, '3.0 연습 복사본']);
  });

  await check('저장: 보기 취향(분석 축 · 막대/꺾은선) — 본인 ui_prefs.withdrawals만 · 기본값은 지운다 · 다른 화면 설정 보존 (되돌림)', async () => {
    const out = await tx(async sql => {
      const bad = await run(sql, 'saveWithdrawalTrendPrefs', SEOLHYUN, [{ axis: 'x' }], PREFS);
      const set = await run(sql, 'saveWithdrawalTrendPrefs', SEOLHYUN, [{ axis: 'teacher', kind: 'line' }], PREFS);
      const [a] = await sql`select ui_prefs p from public.users where id=${SEOLHYUN}`;
      const reset = await run(sql, 'saveWithdrawalTrendPrefs', SEOLHYUN, [{ axis: 'subject', kind: 'bar' }], PREFS);
      const [b] = await sql`select ui_prefs p from public.users where id=${SEOLHYUN}`;
      const [orig] = await db`select ui_prefs p from public.users where id=${SEOLHYUN}`;
      return { bad, set, a: a.p, reset, b: b.p, orig: orig.p };
    });
    assert.deepEqual(out.bad, { ok: false, error: '잘못된 값입니다' });
    assert.deepEqual([out.set, out.reset], [{ ok: true }, { ok: true }]);
    assert.deepEqual(out.a.withdrawals, { ...(out.orig?.withdrawals ?? {}), breakdown_axis: 'teacher', trend_kind: 'line' });
    const { withdrawals: _w, ...others } = out.orig ?? {};
    const { withdrawals: rest, ...othersAfter } = out.b ?? {};
    assert.deepEqual(othersAfter, others, '다른 화면 설정은 그대로');
    assert.ok(!rest || (!('breakdown_axis' in rest) && !('trend_kind' in rest)), '기본값은 저장하지 않는다');
  });

  await check('저장: 수강 날짜 칸 — 수업목록과 같은 2.0 updateEnrollmentDates(검증 문구 그대로) (되돌림)', async () => {
    const [e] = await db`select id::text id from public.enrollments where student_id=${STU} order by start_date limit 1`;
    const out = await tx(async sql => ({
      field: await run(sql, 'updateEnrollmentDates', SEOLHYUN, [null, form({ enrollmentId: e.id, field: 'middle', value: '2026-01-01' })], ENR),
      missing: await run(sql, 'updateEnrollmentDates', SEOLHYUN, [null, form({ enrollmentId: '', field: 'start', value: '2026-01-01' })], ENR),
    }));
    assert.equal(out.field.error, '잘못된 필드입니다');
    assert.equal(out.missing.error, '수강 ID가 누락되었습니다');
  });

  await check('저장 요청 검사 — 받지 않는 파일·모르는 사람·잘못된 폼은 거절', async () => {
    assert.throws(() => screen.actions.updateWithdrawalReason.validate({ module: PREFS, actor: SEOLHYUN, args: [null, form({})] }));
    assert.throws(() => screen.actions.toggleConsultationStep.validate({ module: ACTIONS, actor: 'x', args: [null, form({})] }));
    assert.throws(() => screen.actions.reactivateStudent.validate({ module: ACTIONS, actor: SEOLHYUN, args: [null, { $formData: 'x' }] }));
    await assert.rejects(tx(sql => run(sql, 'reactivateStudent', '00000000-0000-4000-8000-000000000000', [null, form({ studentId: STU })])), /저장하는 사람/);
  });

  await check('시험 뒤 복사본은 그대로(감사로그 · 학원이 상태 · 수강 · 원장 보기 설정)', async () => {
    assert.deepEqual((await counts(db))[0], before);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 저장 함수는 자리표시 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-withdrawals-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  for (const m of [`src/${ACTIONS}`, `src/${PREFS}`, `src/${ENR}`]) assert.ok(info.actions.map(a => a.replaceAll('\\', '/')).includes(m), `${m}는 서버 함수 자리표시로`);
  const dist = pathToFileURL(`${outdir}${path.sep}`), js = await readFile(new URL('withdrawals.js', dist), 'utf8');
  const hosts = [...new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 주소·외부 주소·직접 저장 요청 없음 · 화면 글자에 개발자 말 없음', async () => {
  const js = await here('./v2-screen-withdrawals.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/].map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/);
  const host = await here('./v2-host/src/withdrawals.tsx');
  for (const m of [...host.matchAll(/HostMessage text="([^"]*)"/g)]) assert.doesNotMatch(m[1], /2\.0|Docker|복사본|iframe|호스트/i, m[1]);
});

console.log(`v2 withdrawals: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
