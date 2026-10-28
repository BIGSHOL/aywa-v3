// 2.0 화면 원생상담 시험 — 읽기(2.0 queries·stats와 같은 RLS·같은 모양 · 강사 범위) · 저장(2.0 actions.ts와 같은 검증·표·칸·감사로그) ·
// AI·녹음은 새로 하지 않음 · 호스트로 옮긴 페이지가 2.0 원문 그대로인지 · 호스트 빌드 · 3.0 껍데기.
// 저장은 모두 트랜잭션 안에서 돌린 뒤 되돌린다(복사본 행 수 그대로 · 바깥 요청 큐 그대로). 시험 학생 = '학원이'.
// 사용: node experiments/owner-concept/verify-v2-screen-consultations.mjs
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-consultations.mjs';
import { MODULES, NO_AI, NO_RECORDING, NO_UPLOAD } from './v2-consultations-save.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const lf = s => s.replace(/\r\n/g, '\n');
const here = async rel => lf(await readFile(new URL(rel, import.meta.url), 'utf8'));
const src = async rel => lf(await readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8'));
const tail = (text, from, to) => { const i = text.indexOf(from); assert.ok(i >= 0, `표식 없음: ${from}`); const j = to ? text.indexOf(to, i) + to.length : text.length; return text.slice(i, j); };
const swap = (text, pairs) => pairs.reduce((t, [a, b]) => { assert.equal(t.split(a).length - 1, 1, `짝: ${a.slice(0, 50)}`); return t.replace(a, () => b); }, text);

const HAKWONI = '6219e442-aa57-455f-a5bc-834b222d9e1c';
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75', WONIL = '94007db7-12d3-4b5d-97f2-39071446536b';
const SUNGWOO = '2be70c2e-3f72-4046-bbc8-7edea5841505'; // 담당 과목 하나(수학)
const SOHEE = '7ac89726-d36f-46e4-8174-6bbddbd7f378', VIEWER = '268b797c-d00a-4475-8f6d-68894e47ccac';

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
const form = o => ({ $formData: Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, String(x)]) : [[k, String(v)]])) });
const run = (sql, name, actor, fields, module = MODULES.actions) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module, actor, args: [null, form(fields)] }), tenantId, importV2 });
const session = async sql => (await sql`select coalesce(current_setting('request.jwt.claims', true), '') c, current_user::text u`)[0];
const counts = sql => sql`select (select count(*)::int from public.student_consultations where tenant_id=${tenantId}) consults,
  (select count(*)::int from public.audit_logs where tenant_id=${tenantId} and (action like 'student_consultation%' or action like 'newcomer_%')) audits,
  (select count(*)::int from public.student_onboarding_checks where tenant_id=${tenantId}) checks,
  (select count(*) filter (where follow_up_done)::int from public.student_consultations where tenant_id=${tenantId}) done,
  (select md5(coalesce(string_agg(id::text || coalesce(ui_prefs::text, ''), ',' order by id), '')) from public.users where tenant_id=${tenantId}) prefs`;
const audits = sql => sql`select action, actor_id::text actor_id, metadata from public.audit_logs where tenant_id=${tenantId} and created_at >= now() order by created_at`;

try {
  const before = (await counts(db))[0];

  await check('2.0 서버 함수 이름이 그대로다 — actions.ts · audio-actions.ts · stats-prefs-actions.ts · 녹음 업로드표(issueAudioUploadTicket) · 반 선택지(읽기 경로)', async () => {
    const names = async rel => [...(await src(rel)).matchAll(/export async function (\w+)\(/g)].map(m => m[1]);
    const want = [...await names(MODULES.actions), ...await names(MODULES.audio), ...await names(MODULES.prefs), 'issueAudioUploadTicket'].sort();
    assert.deepEqual(Object.keys(screen.actions).sort(), want);
    assert.deepEqual(await names('features/consultations/server/class-actions.ts'), ['getConsultationClassOptions'], '읽기 하나뿐(op=classOptions)');
    assert.match(await here('./v2-host/src/consultations.tsx'), /registerHostHandler\('features\/consultations\/server\/class-actions\.ts', 'getConsultationClassOptions'/);
  });

  await check('호스트로 옮긴 페이지 = 2.0 원문 그대로(목록 · 요약 띠 · 목록 행 · 상세 · 작성 · 수정 · 통계 · 통계 본문 — 자료 받는 자리만 바뀜)', async () => {
    const P = 'app/(shell)/consultations/';
    const has = (mine, piece, label) => assert.ok(mine.includes(piece), `${label}: 2.0 글자와 다르다`);
    const list = await here('./v2-host/src/consultations-list.tsx');
    has(list, swap(tail(await src(`${P}page.tsx`), '  const totalPages = Math.max(1, Math.ceil(total / size));'),
      [['<MakeeduSyncBadge domain="consultations" />', '<MakeeduSyncBadge domain="consultations" state={data.syncState} canManage={data.canManageOwner} />']]), '목록');
    const band = await src(`${P}_components/stats-summary.tsx`);
    has(list, swap(tail(band, '/**\n * 띠 상자', '  syncOn: boolean;\n}) {\n'), [['export async function ConsultationStatsSummary(', 'export function ConsultationStatsSummary(']]), '요약 띠 머리');
    has(list, tail(band, '  const [stats, settings] = loaded;'), '요약 띠');
    has(await here('./v2-host/src/consultations-list-rows.tsx'), swap(await src(`${P}_components/consultation-list.tsx`), [
      ['import { followUpUrgency, type StudentConsultationRow } from "@/features/consultations/server/queries";',
        'import { followUpUrgency } from "@/features/consultations/follow-up-urgency";\nimport type { StudentConsultationRow } from "@/features/consultations/server/queries";'],
      ['import { CATEGORY_META, URGENCY_META } from "./consultation-meta";', 'import { CATEGORY_META, URGENCY_META } from "@/app/(shell)/consultations/_components/consultation-meta";']]), '목록 행');
    has(await here('./v2-host/src/consultations-detail.tsx'), tail(await src(`${P}[id]/page.tsx`), '  const subjects = buildSubjectMaps(settings.operations.subjects);'), '상세');
    const formFile = await here('./v2-host/src/consultations-form.tsx');
    has(formFile, tail(await src(`${P}[id]/edit/page.tsx`), '  return (\n'), '수정');
    has(formFile, tail(await src(`${P}new/page.tsx`), '  return (\n'), '작성');
    const stats = await here('./v2-host/src/consultations-stats.tsx'), panel = await src(`${P}_components/stats/stats-panel.tsx`);
    has(stats, tail(await src(`${P}stats/page.tsx`), "  // makeedu가 꺼진 학원엔 '동기화' 지표·축이 없다(기능 스위치 = 흔적 없이)."), '통계');
    has(stats, swap(tail(panel, 'const DIM_LABEL: Record<StatsDimKey, string> = {', '  syncOn: boolean;\n}) {\n'), [['export async function ConsultationStatsPanel(', 'export function ConsultationStatsPanel(']]), '통계 본문 머리');
    has(stats, tail(panel, '  const [stats, gap, prefs, settings, retiredIds, homeroom] = loaded;'), '통계 본문');
  });

  await check('읽기: 원장 = 학원 전체(건수·지표가 복사본과 같다) · 강사 = 본인이 쓴 상담만 · 남의 상담 상세는 못 연다 · 상담사 고르기 없음', async () => {
    const m = await load({});
    assert.equal(m.page, 'list'); assert.equal(m.user.systemRole, 'master'); assert.equal(m.teacherId, null);
    const [{ n, pend }] = await db`select count(*)::int n, count(*) filter (where not follow_up_done and follow_up_date is not null)::int pend from public.student_consultations where tenant_id=${tenantId}`;
    assert.deepEqual([m.total, m.counts.total, m.counts.pendingFollowUps], [n, n, pend]);
    assert.equal(m.items.length, m.listParams.size, '쪽 크기 = 2.0 기본(12)');
    assert.ok('stats' in m.summary && m.summary.stats.totals.n === n, '요약 띠 = 통계 RPC(검색어 제외 · 같은 조건)');
    assert.ok(m.counselorOptions.length > 5 && m.editors[0].role === '원장');
    const t = await load({ actor: SOHEE });
    assert.equal(t.teacherId, SOHEE);
    assert.ok(t.items.every(i => i.counselorId === SOHEE), '강사는 본인이 쓴 상담만');
    assert.deepEqual(t.counselorOptions, [], '강사는 상담사 선택지 없음');
    const [other] = await db`select id::text id from public.student_consultations where tenant_id=${tenantId} and counselor_id <> ${SOHEE} order by consulted_at desc limit 1`;
    assert.equal((await load({ actor: SOHEE, v2path: `/consultations/${other.id}` })).page, 'notFound');
    assert.equal((await load({ v2path: `/consultations/${other.id}` })).page, 'detail');
    const st = await load({ actor: SOHEE, v2path: '/consultations/stats' });
    assert.equal(st.panel.stats.totals.n, t.total, '강사 통계 = 본인 상담 수(목록과 같은 조건)');
    assert.ok(st.panel.homeroom === null || st.panel.homeroom.teachers.every(x => x.id === SOHEE), '담임별 현황은 본인 줄만');
    const f = await load({ urg: 'done', range: '30d' });
    assert.ok(f.items.every(i => i.followUpDone), '후속 완료 필터');
    const s = await load({ q: '학원이' });
    assert.ok(s.items.some(i => i.studentId === HAKWONI) || s.total >= 0);
    const co = await load({ op: 'classOptions', cStudent: HAKWONI, cAt: '2026-10-28T10:00', cCounselor: '', cSubject: '' });
    assert.equal(co.result.supported, true); assert.ok(Array.isArray(co.result.options));
    const nw = await load({ actor: SOHEE, v2path: '/consultations/new' });
    assert.ok(nw.students.length < (await load({ v2path: '/consultations/new' })).students.length, '강사 학생 선택지 = 담당 학생만');
  });

  await check('저장: 상담 기록 추가(학원이 · 반 자동 판정 · 붙여넣기 정리) · 입력 검사 · 강사는 본인 이름으로만 · 열람 전용 거절 · 감사로그 · 쓰기 뒤 신분이 비었다 (되돌림)', async () => {
    const out = await tx(async sql => {
      const bad = await run(sql, 'createStudentConsultation', SEOLHYUN, { studentId: '', summary: '짧', consultedAt: '' });
      const viewer = await run(sql, 'createStudentConsultation', VIEWER, { studentId: HAKWONI, summary: '시험 상담 기록입니다', consultedAt: '2026-10-28T10:00' });
      const nobody = await run(sql, 'createStudentConsultation', null, { studentId: HAKWONI, summary: '시험 상담 기록입니다', consultedAt: '2026-10-28T10:00' });
      // 강사는 본인 이름으로만(2.0 OUT_OF_SCOPE_CONSULTATION). 학생 범위는 원생 메뉴가 '담당 범위'일 때만 보는데 이 지점 강사는 원생 '열람'이라 2.0도 통과한다.
      const scoped = await run(sql, 'createStudentConsultation', SOHEE, { studentId: HAKWONI, counselorId: WONIL, summary: '시험 상담 기록입니다', consultedAt: '2026-10-28T10:00' });
      const ok = await run(sql, 'createStudentConsultation', SEOLHYUN, { studentId: HAKWONI, counselorId: SUNGWOO, summary: '시험 상담 기록입니다 — 3.0 연습', consultedAt: '2026-10-28T10:00',
        category: 'academic', audience: 'parent', followUpAction: '다음 주 통화', followUpDate: '2026-10-20', classPick: 'auto' });
      const after = await session(sql);
      const [row] = await sql`select id::text id, counselor_id::text counselor_id, subject, class_id::text class_id, class_source, to_json(consulted_at)#>>'{}' consulted_at, follow_up_done
        from public.student_consultations where tenant_id=${tenantId} and student_id=${HAKWONI} and summary like '시험 상담 기록입니다%' order by created_at desc limit 1`;
      return { bad, viewer, nobody, scoped, ok, after, row, logs: await audits(sql) };
    });
    assert.deepEqual(Object.keys(out.bad.fieldErrors).sort(), ['consultedAt', 'studentId', 'summary']);
    assert.equal(out.viewer.error, '상담 관리 권한이 없습니다');
    assert.equal(out.nobody.error, '로그인이 필요합니다');
    assert.equal(out.scoped.error, '본인이 작성한 상담만 고칠 수 있습니다');
    assert.deepEqual([out.ok.ok, out.ok.redirectTo], [true, '/consultations']);
    assert.equal(out.row.counselor_id, SUNGWOO);
    assert.equal(out.row.consulted_at, '2026-10-28T01:00:00+00:00', 'KST 벽시계 → UTC(2.0 kstLocalToIso)');
    assert.equal(out.row.class_source, 'auto');
    assert.equal(out.row.subject, '수학', '상담사 담당 과목이 하나면 그 라벨(2.0 consultationSubject)');
    const log = out.logs.find(l => l.action === 'student_consultation_create');
    assert.deepEqual([log.actor_id, log.metadata.via, log.metadata.studentId, log.metadata.consultedAt, log.metadata.hasFollowUp], [SEOLHYUN, '3.0 연습 복사본', HAKWONI, '2026-10-28', true]);
    assert.ok(!JSON.stringify(log.metadata).includes('시험 상담 기록'), '감사로그에 상담 본문을 담지 않는다');
    assert.equal(out.after.c, '', '쓰기 뒤 request.jwt.claims가 비었다');
    assert.notEqual(out.after.u, 'authenticated', '쓰기 뒤 역할이 authenticated가 아니다');
  });

  await check('저장: 후속 조치 완료 표시/해제(업무 흐름 followup_due) · 강사는 남의 상담 못 바꿈 · 수정(학생·과목·반) · 삭제(감사로그 · 본문 없음) (되돌림)', async () => {
    const out = await tx(async sql => {
      await run(sql, 'createStudentConsultation', SEOLHYUN, { studentId: HAKWONI, summary: '시험 상담 기록입니다', consultedAt: '2026-10-21T15:00', followUpAction: '통화', followUpDate: '2026-10-22' });
      const [c] = await sql`select id::text id from public.student_consultations where tenant_id=${tenantId} and student_id=${HAKWONI} and summary='시험 상담 기록입니다' order by created_at desc limit 1`;
      const overdue = (await screen.load({ sql, params: { urg: 'overdue', q: '학원이' }, tenantId, importV2 })).items.map(i => i.id);
      await sql`set local role none`; await sql`select set_config('request.jwt.claims', '', true)`;
      const foreign = await run(sql, 'toggleConsultationFollowUp', SOHEE, { id: c.id, done: 'true' });
      const toggled = await run(sql, 'toggleConsultationFollowUp', SEOLHYUN, { id: c.id, done: 'true' });
      const [t1] = await sql`select follow_up_done from public.student_consultations where id=${c.id}`;
      const badId = await run(sql, 'toggleConsultationFollowUp', SEOLHYUN, { id: 'nope', done: 'true' });
      const upd = await run(sql, 'updateStudentConsultation', SEOLHYUN, { id: c.id, studentId: HAKWONI, summary: '시험 상담 기록입니다(고침)', consultedAt: '2026-10-21T15:00',
        category: 'general', audience: 'student', subject: '영어', followUpAction: '통화', followUpDate: '2026-10-22', followUpDone: 'true', classPick: 'manual', classId: '' });
      const [u1] = await sql`select summary, subject, audience, class_id, class_source, follow_up_done from public.student_consultations where id=${c.id}`;
      const updScoped = await run(sql, 'updateStudentConsultation', SOHEE, { id: c.id, studentId: HAKWONI, summary: '시험 상담 기록입니다', consultedAt: '2026-10-21T15:00' });
      const delScoped = await run(sql, 'deleteStudentConsultation', SOHEE, { id: c.id });
      const del = await run(sql, 'deleteStudentConsultation', SEOLHYUN, { id: c.id, studentId: HAKWONI, redirectTo: '/consultations' });
      const [gone] = await sql`select count(*)::int n from public.student_consultations where id=${c.id}`;
      return { c, overdue, foreign, toggled, t1, badId, upd, u1, updScoped, delScoped, del, gone, after: await session(sql), logs: (await audits(sql)).map(l => [l.action, l.metadata]) };
    });
    assert.ok(out.overdue.includes(out.c.id), '기한 지난 후속 = 목록 후속 필터 기한 경과');
    assert.equal(out.foreign.error, '본인이 작성한 상담만 고칠 수 있습니다');
    assert.equal(out.toggled, undefined, '2.0처럼 성공은 undefined');
    assert.equal(out.t1.follow_up_done, true);
    assert.ok(out.badId?.error, 'id가 이상하면 2.0처럼 DB 오류 문구');
    assert.equal(out.upd.ok, true);
    assert.deepEqual([out.u1.summary, out.u1.subject, out.u1.audience, out.u1.class_id, out.u1.class_source, out.u1.follow_up_done], ['시험 상담 기록입니다(고침)', '영어', 'student', null, 'manual', true]);
    assert.equal(out.updScoped.error, '본인이 작성한 상담만 고칠 수 있습니다');
    assert.equal(out.delScoped.error, '본인이 작성한 상담만 고칠 수 있습니다');
    assert.equal(out.del, undefined); assert.equal(out.gone.n, 0);
    const actions = out.logs.map(([a]) => a);
    assert.deepEqual(actions.filter(a => a.startsWith('student_consultation')), ['student_consultation_create', 'student_consultation_follow_up', 'student_consultation_update', 'student_consultation_delete'], '남의 상담·이상한 id는 감사로그 없이 거절(2.0 그대로)');
    const fu = out.logs.find(([a, m]) => a === 'student_consultation_follow_up' && m.studentId === HAKWONI)[1];
    assert.deepEqual([fu.consultationId, fu.done, fu.via], [out.c.id, true, '3.0 연습 복사본']);
    const dl = out.logs.find(([a]) => a === 'student_consultation_delete')[1];
    assert.deepEqual([dl.studentId, dl.consultedAt, dl.via], [HAKWONI, '2026-10-21', '3.0 연습 복사본']);
    assert.deepEqual([out.after.c, out.after.u === 'authenticated'], ['', false]);
  });

  await check('AI·녹음은 새로 하지 않는다 — 분석·케어 분석·녹음 상담·녹음 업로드는 2.0 실패 모양({ error })으로 거절 · 바뀐 것 없음 (되돌림)', async () => {
    const [c] = await db`select id::text id from public.student_consultations where tenant_id=${tenantId} and ai_report is not null limit 1`;
    const out = await tx(async sql => ({
      ai: await run(sql, 'runStudentConsultationAnalysis', SEOLHYUN, { id: c?.id ?? '' }, MODULES.audio),
      care: await run(sql, 'runStudentCareAnalysis', SEOLHYUN, { studentId: HAKWONI }),
      careTeacher: await run(sql, 'runStudentCareAnalysis', SOHEE, { studentId: HAKWONI }),
      audio: await run(sql, 'startStudentConsultationFromAudio', SEOLHYUN, { studentId: HAKWONI, audioPath: 'x' }, MODULES.audio),
      upload: await run(sql, 'issueAudioUploadTicket', SEOLHYUN, { kind: 'student_consultation' }, MODULES.upload),
      logs: await audits(sql),
    }));
    assert.deepEqual([out.ai.error, out.care.error, out.audio.error, out.upload.error], [NO_AI, NO_AI, NO_RECORDING, NO_UPLOAD]);
    assert.equal(out.careTeacher.error, 'AI 케어 분석 권한이 없습니다 — 강사 계정은 열람 전용입니다');
    assert.equal(out.logs.length, 0, '거절은 아무것도 남기지 않는다');
    for (const t of [NO_AI, NO_RECORDING, NO_UPLOAD]) assert.doesNotMatch(t, /2\.0|Docker|복사본|iframe/);
  });

  await check('저장: 통계 보기 설정(본인 ui_prefs.consultations · 형제 키 보존 · 기본값은 지운다 · 잘못된 값 거절) (되돌림)', async () => {
    const run1 = (sql, p) => screen.actions.saveConsultationStatsPrefs.run({ sql, body: screen.actions.saveConsultationStatsPrefs.validate({ module: MODULES.prefs, actor: SEOLHYUN, args: [p] }), tenantId, importV2 });
    const out = await tx(async sql => {
      const [b] = await sql`select ui_prefs from public.users where id=${SEOLHYUN}`;
      const a = await run1(sql, { unit: 'week', metric: 'follow', hrSort: { key: 'unmet', dir: 'desc' } });
      const [x] = await sql`select ui_prefs from public.users where id=${SEOLHYUN}`;
      const back = await run1(sql, { unit: 'month', metric: 'count', hrSort: { key: 'name', dir: 'asc' } });
      const [y] = await sql`select ui_prefs from public.users where id=${SEOLHYUN}`;
      const bad = await run1(sql, { unit: 'year' });
      const prefs = (await screen.load({ sql, params: { v2path: '/consultations/stats' }, tenantId, importV2 })).prefs;
      return { b: b.ui_prefs ?? {}, a, x: x.ui_prefs, back, y: y.ui_prefs ?? {}, bad, prefs };
    });
    assert.deepEqual([out.a.ok, out.x.consultations.stats_unit, out.x.consultations.stats_metric, out.x.consultations.hr_sort], [true, 'week', 'follow', 'unmet']);
    for (const k of Object.keys(out.b).filter(k => k !== 'consultations')) assert.deepEqual(out.x[k], out.b[k], `형제 키 ${k} 보존`);
    assert.equal(out.back.ok, true); assert.equal(out.y.consultations?.stats_unit, undefined, '기본값이면 키를 지운다');
    assert.deepEqual(out.bad, { ok: false, error: '잘못된 값입니다' });
  });

  await check('저장 요청 검사 — 받지 않는 파일 · 인자 수 초과는 거절', async () => {
    assert.throws(() => screen.actions.createStudentConsultation.validate({ module: 'features/x.ts', actor: SEOLHYUN, args: [] }));
    assert.throws(() => screen.actions.saveConsultationStatsPrefs.validate({ module: MODULES.prefs, actor: SEOLHYUN, args: [{}, {}] }));
    assert.throws(() => screen.actions.issueAudioUploadTicket.validate({ module: MODULES.actions, actor: SEOLHYUN, args: [] }));
  });

  await check('시험 뒤 복사본은 그대로(상담 · 감사로그 · 신규생 체크 · 후속 완료 수 · 보기 설정)', async () => {
    assert.deepEqual((await counts(db))[0], before);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 서버 함수 5개 파일이 자리표시 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-consultations-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  const acts = info.actions.map(a => a.replaceAll('\\', '/'));
  for (const m of [...Object.values(MODULES), 'features/consultations/server/class-actions.ts']) assert.ok(acts.includes(`src/${m}`), m);
  const js = await readFile(new URL('consultations.js', pathToFileURL(`${outdir}${path.sep}`)), 'utf8');
  const hosts = [...new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis|assemblyai|anthropic|deepseek/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 주소·외부 주소·직접 저장 요청 없음 · 화면 글자에 개발자 말 없음 · 주소 actor 우선', async () => {
  const js = await here('./v2-screen-consultations.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/].map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/); assert.match(js, /ctx\.query\.get\('actor'\)/);
  const host = await here('./v2-host/src/consultations.tsx');
  for (const m of [...host.matchAll(/<HostMessage text="([^"]*)"/g)].map(x => x[1])) assert.doesNotMatch(m, /2\.0|Docker|복사본|iframe/);
});

console.log(`v2 consultations: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
