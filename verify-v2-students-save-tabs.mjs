// 원생 상세 탭 안 저장 시험 — node --test experiments/owner-concept/verify-v2-students-save-tabs.mjs
// 저장 경로와 같게 쓰기 트랜잭션 안에서 저장(validate → run)을 돌리고, 표 · 감사로그 · 바깥 요청 줄(net.http_request_queue)을 본 뒤
// 트랜잭션째 되돌린다(복사본에 흔적 없음). 대상 = 테스트 학생 '학원이'(is_test)와 시험 안에서 만든 행뿐. 복사본 DB가 없으면 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { studentsTabActions as A } from './v2-students-save-tabs.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

class Rollback extends Error {}
if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { studentsBase, readStudentEditors } = await import('./v2-students-common.mjs');
  var { screen } = await import('./v2-screen-students.mjs');
  var [{ id: SID }] = await db`select id::text id from public.students where tenant_id=${t} and name = '학원이' and is_test`;
  var OWNER = await db.begin('read only', async (sql) => (await readStudentEditors(await studentsBase({ sql, tenantId: t, importV2 })))[0]);
  var STUDENTS = 'features/students/server/actions.ts', CONSULT = 'features/consultations/server/actions.ts';
  const form = (o) => ({ $formData: Object.entries(o).map(([k, v]) => [k, String(v)]) });
  /** 한 트랜잭션 안에서 fn(sql, call) — call(name, args, module) = 저장 한 번(공통 틀과 같은 validate → run) · 끝나면 되돌린다. */
  var inTx = async (fn) => {
    try {
      await db.begin(async (sql) => {
        const queue = async () => Number((await sql`select count(*)::int n from net.http_request_queue`.catch(() => [{ n: 0 }]))[0].n);
        const before = await queue();
        const call = async (name, args, module = STUDENTS, actor = OWNER.id) => A[name].run({ sql, body: A[name].validate({ module, actor, args }), tenantId: t, importV2 });
        await fn(sql, call, form);
        assert.equal(await queue(), before, '바깥으로 보내는 요청이 생기지 않는다');
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
  };
  var audits = (sql, action) => sql`select metadata, actor_id::text actor_id, target_type, target_label from public.audit_logs where tenant_id=${t} and action = ${action}
    and '3.0 연습 복사본' in (metadata->>'via', metadata->>'practice') order by created_at desc, id desc`;
}

test('연결: 원생 화면이 탭 저장을 싣는다 · 수업 탭 저장 여섯은 반 화면 저장 그대로 · 모르는 모듈·사람은 거절', { skip: SKIP }, async () => {
  const { screen: classes } = await import('./v2-screen-classes.mjs');
  for (const n of ['createEnrollment', 'updateEnrollmentDates', 'deleteEnrollment', 'moveEnrollmentsBatch', 'updateEnrollmentsAttendanceBatch', 'endSingleEnrollment']) assert.equal(A[n], classes.actions[n], n);
  for (const n of Object.keys(A)) assert.equal(screen.actions?.[n], A[n], `화면 정의에 ${n}`);
  assert.throws(() => A.createStudentMemo.validate({ module: 'features/x.ts', actor: OWNER.id, args: [null, { $formData: [] }] }), /입력 값/);
  await inTx(async (sql, call, form) => {
    await assert.rejects(call('createStudentMemo', [null, form({ studentId: SID, content: 'x' })], STUDENTS, '00000000-0000-4000-8000-000000000000'), /이 계정은 이 화면에서 저장할 수 없습니다 · 계정 전환/);
    // 수업 탭 저장 = 반 화면 규칙(수업 관리 '전체' — 2.0 게이트와 같은 축). 그 권한이 없는 사람이면 2.0 거절 문구 그대로(메인 10-28).
    const [teacher] = await sql`select id::text id from public.users where tenant_id=${t} and status::text='active' and system_role::text='teacher' order by id limit 1`;
    const [klass] = await sql`select id::text id from public.classes where tenant_id=${t} and is_active order by id limit 1`;
    const out = await call('createEnrollment', [null, form({ studentId: SID, classId: klass.id, startDate: '2026-10-27' })], 'features/enrollments/server/actions.ts', teacher.id);
    assert.deepEqual(out, { error: '반 배정 권한이 없습니다 — 강사 계정은 열람 전용입니다' });
  });
});

test('특이사항: 추가(검색 허용) · 고치기 · 고정 · 지우기 = 표 · 감사로그(본문 없음) · 빈 내용 거절 문구', { skip: SKIP }, async () => {
  await inTx(async (sql, call, form) => {
    assert.deepEqual(await call('createStudentMemo', [null, form({ studentId: SID, category: 'general', content: '' })]), { error: '특이사항 내용을 입력해주세요' });
    assert.deepEqual(await call('createStudentMemo', [null, form({ studentId: SID, category: 'parent', content: '시험 메모', searchable: 'on' })]), { ok: true });
    const [m] = await sql`select id::text id, category, content, searchable, pinned, created_by::text created_by from public.student_memos where student_id=${SID} and content='시험 메모'`;
    assert.deepEqual({ ...m, id: undefined }, { id: undefined, category: 'parent', content: '시험 메모', searchable: true, pinned: false, created_by: OWNER.id });
    assert.deepEqual((await audits(sql, 'student_memo_create'))[0].metadata, { studentId: SID, category: 'parent', searchable: true, via: '3.0 연습 복사본' });
    assert.deepEqual(await call('updateStudentMemo', [null, form({ id: m.id, studentId: SID, category: 'general', content: '고친 메모' })]), { ok: true });
    const [u] = await sql`select category, content, searchable from public.student_memos where id=${m.id}`;
    assert.deepEqual(u, { category: 'general', content: '고친 메모', searchable: false }, '체크박스 꺼짐 = 검색 허용 끔');
    assert.equal(await call('toggleStudentMemoPin', [null, form({ id: m.id, studentId: SID, pinned: 'true' })]), undefined);
    assert.equal((await sql`select pinned from public.student_memos where id=${m.id}`)[0].pinned, true);
    assert.equal(await call('deleteStudentMemo', [null, form({ id: m.id, studentId: SID })]), undefined);
    assert.equal((await sql`select count(*)::int n from public.student_memos where id=${m.id}`)[0].n, 0);
    for (const a of ['student_memo_update', 'student_memo_pin', 'student_memo_delete']) {
      const [x] = await audits(sql, a);
      assert.equal(x.metadata.memoId, m.id, a); assert.equal(x.actor_id, OWNER.id); assert.ok(!JSON.stringify(x.metadata).includes('메모'), `${a}: 본문을 담지 않는다`);
    }
  });
});

test('성적: 추가 = 같은 칸 upsert(점수·메모) · 학기 밖·점수 없음 거절 · 지우기 / 레벨테스트 · 목표(같은 칸 거절) · 평가 코멘트', { skip: SKIP }, async () => {
  await inTx(async (sql, call, form) => {
    const base = { studentId: SID, subject: 'math', year: '2026', term: '2', slot: 'final', maxScore: '100' };
    assert.deepEqual(await call('createStudentGrade', [null, form({ ...base, takenOn: '2026-12-01', score: '' })]), { error: '점수를 입력해주세요' });
    assert.match((await call('createStudentGrade', [null, form({ ...base, takenOn: '2026-03-01', score: '90' })])).error, /학기\(.*\) 밖입니다/);
    assert.equal(await call('createStudentGrade', [null, form({ ...base, takenOn: '2026-12-01', score: '90', notes: '첫 메모' })]), undefined);
    assert.equal(await call('createStudentGrade', [null, form({ ...base, takenOn: '2026-12-02', score: '95', notes: '둘째 메모' })]), undefined);
    const rows = await sql`select id::text id, score::float score, notes, taken_on::text taken_on, exam_name, created_by::text created_by from public.student_grades
      where student_id=${SID} and subject='math' and school_year=2026 and term=2 and exam_slot='final'`;
    assert.equal(rows.length, 1, '같은 칸은 한 줄(upsert)');
    assert.deepEqual({ score: rows[0].score, notes: rows[0].notes, taken_on: rows[0].taken_on, created_by: rows[0].created_by }, { score: 95, notes: '둘째 메모', taken_on: '2026-12-02', created_by: OWNER.id });
    // 한 트랜잭션 안의 두 저장은 시각이 같다 — 둘째 저장의 기록을 날짜로 찾는다.
    const created = (await audits(sql, 'student_grade_create')).map((x) => x.metadata);
    assert.equal(created.length, 2);
    assert.deepEqual(created.find((m) => m.date === '2026-12-02'), { studentId: SID, subject: 'math', year: 2026, term: 2, slot: 'final', date: '2026-12-02', via: '3.0 연습 복사본' });
    assert.equal(await call('deleteStudentGrade', [null, form({ id: rows[0].id, studentId: SID })]), undefined);
    assert.deepEqual((await audits(sql, 'student_grade_delete'))[0].metadata, { gradeId: rows[0].id, studentId: SID, subject: 'math', date: '2026-12-02', via: '3.0 연습 복사본' });

    assert.equal(await call('createStudentLevelTest', [null, form({ studentId: SID, testType: 'promotion', subject: 'english', testedOn: '2026-10-01', level: 'B', sub_어휘: '7', sub_문법: 'x' })]), undefined);
    const [lt] = await sql`select id::text id, test_type, level, subscores from public.level_tests where student_id=${SID} and tested_on='2026-10-01' and subject='english'`;
    assert.deepEqual({ ...lt, id: undefined }, { id: undefined, test_type: 'promotion', level: 'B', subscores: { 어휘: 7 } }, '숫자가 아닌 세부점수는 뺀다');
    assert.equal(await call('deleteStudentLevelTest', [null, form({ id: lt.id, studentId: SID })]), undefined);
    assert.equal((await audits(sql, 'student_level_test_delete'))[0].metadata.testType, 'promotion');

    const goal = { studentId: SID, subject: 'math', year: '2026', term: '2', slot: 'final', targetScore: '90', maxScore: '100', reason: '이유' };
    assert.deepEqual(await call('createStudentGoal', [null, form({ ...goal, targetScore: '120' })]), { error: '목표 점수는 0 이상 만점 이하로 입력해주세요' });
    assert.deepEqual(await call('createStudentGoal', [null, form(goal)]), { ok: true });
    assert.deepEqual(await call('createStudentGoal', [null, form(goal)]), { error: '이 시험의 목표가 이미 있습니다 — 기존 목표를 지우고 다시 추가하세요' });
    const [g] = await sql`select id::text id, target_score::float target, exam_name from public.grade_goals where student_id=${SID} and school_year=2026 and term=2 and exam_slot='final' and subject='math'`;
    assert.equal(g.target, 90);
    assert.equal(await call('deleteStudentGoal', [null, form({ id: g.id, studentId: SID })]), undefined);

    assert.deepEqual(await call('createStudentGradeComment', [null, form({ studentId: SID, category: 'nope', content: 'x' })]), { error: '유효한 카테고리가 아닙니다' });
    const category = 'strength'; // 2.0 COMMENT_CATEGORIES 첫 키
    assert.deepEqual(await call('createStudentGradeComment', [null, form({ studentId: SID, category, subject: 'all', content: '코멘트', period: '2026-10', sharedWithParent: 'on' })]), { ok: true });
    const [cm] = await sql`select id::text id, subject, shared_with_parent from public.grade_comments where student_id=${SID} and content='코멘트'`;
    assert.deepEqual({ subject: cm.subject, shared: cm.shared_with_parent }, { subject: null, shared: true }, "과목 'all' = 없음");
    assert.deepEqual(await call('updateStudentGradeComment', [null, form({ id: cm.id, studentId: SID, category, content: '바꾼 코멘트', period: '2026-10' })]), { ok: true });
    assert.equal((await sql`select shared_with_parent from public.grade_comments where id=${cm.id}`)[0].shared_with_parent, false);
    assert.equal(await call('deleteStudentGradeComment', [null, form({ id: cm.id, studentId: SID })]), undefined);
    assert.ok(!JSON.stringify((await audits(sql, 'student_grade_comment_create'))[0].metadata).includes('코멘트'), '본문을 담지 않는다');
  });
});

test('상담: 후속 조치 토글 · 삭제(신규생 체크 해제 · newcomer_uncheck) · 진도 이상 확인·되돌리기 · 영상 링크 끊기', { skip: SKIP }, async () => {
  await inTx(async (sql, call, form) => {
    const [{ id: cid }] = await sql`insert into public.student_consultations (tenant_id, student_id, counselor_id, consulted_at, category, summary, follow_up_action, follow_up_done)
      values (${t}, ${SID}, ${OWNER.id}, now(), 'general', '시험 상담', '전화', false) returning id::text id`;
    assert.equal(await call('toggleConsultationFollowUp', [null, form({ id: cid, done: 'true' })], CONSULT), undefined);
    assert.equal((await sql`select follow_up_done from public.student_consultations where id=${cid}`)[0].follow_up_done, true);
    assert.deepEqual((await audits(sql, 'student_consultation_follow_up'))[0].metadata, { consultationId: cid, studentId: SID, done: true, via: '3.0 연습 복사본' });
    const [chk] = await sql`insert into public.student_onboarding_checks (tenant_id, student_id, subject, item_key, done_on, done_by, consultation_id)
      values (${t}, ${SID}, 'math', 'v3_test_item', current_date, ${OWNER.id}, ${cid}) returning id::text id`.catch(() => [null]);
    assert.equal(await call('deleteStudentConsultation', [null, form({ id: cid, studentId: SID })], CONSULT), undefined);
    assert.equal((await sql`select count(*)::int n from public.student_consultations where id=${cid}`)[0].n, 0);
    const [d] = await audits(sql, 'student_consultation_delete');
    assert.equal(d.metadata.consultationId, cid); assert.equal(d.metadata.hasFollowUp, true); assert.equal(d.target_type, 'student_consultation');
    if (chk) {
      const [after] = await sql`select done_on, done_by, consultation_id from public.student_onboarding_checks where id=${chk.id}`;
      assert.deepEqual(after, { done_on: null, done_by: null, consultation_id: null }, '이 상담으로 한 체크를 푼다');
      const un = (await audits(sql, 'newcomer_uncheck'))[0].metadata;
      assert.equal(un.consultationId, cid);
      // 2.0이 남기는 via('consultation' — 감사 표시 '원생상담으로')는 그대로, 연습 표시는 practice에.
      assert.equal(un.via, 'consultation'); assert.equal(un.practice, '3.0 연습 복사본');
    }

    const [{ id: eid }] = await sql`insert into public.progress_events (tenant_id, student_id, event_type) values (${t}, ${SID}, 'jump_error') returning id::text id`;
    assert.deepEqual(await call('setProgressAnomalyResolved', [eid, true], 'features/progress/server/anomaly-actions.ts'), { ok: true });
    assert.equal((await sql`select resolved_by::text b from public.progress_events where id=${eid}`)[0].b, OWNER.id);
    assert.deepEqual(await call('setProgressAnomalyResolved', [eid, false], 'features/progress/server/anomaly-actions.ts'), { ok: true });
    assert.deepEqual(await sql`select resolved_at, resolved_by from public.progress_events where id=${eid}`.then((r) => r[0]), { resolved_at: null, resolved_by: null });
    const [{ id: other }] = await sql`insert into public.progress_events (tenant_id, student_id, event_type) values (${t}, ${SID}, 'forward') returning id::text id`;
    assert.deepEqual(await call('setProgressAnomalyResolved', [other, true], 'features/progress/server/anomaly-actions.ts'), { ok: false, error: '확인 대상이 아닌 기록입니다' });

    const enr = await sql`select class_id::text class_id from public.enrollments where tenant_id=${t} and student_id=${SID} and end_date is null limit 1`;
    const VS = 'features/video-submit/server/actions.ts';
    if (enr.length) {
      const r = await call('revokeVideoSubmitLinks', [SID, enr[0].class_id], VS);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal((await sql`select count(*)::int n from public.homework_video_links where student_id=${SID} and class_id=${enr[0].class_id} and revoked_at is null and expires_at > now()`)[0].n, 0);
      assert.equal((await audits(sql, 'lesson_report_video_link_revoke'))[0].metadata.revoked, r.revoked);
    }
    assert.deepEqual(await call('revokeVideoSubmitLinks', [SID, '00000000-0000-4000-8000-000000000000'], VS), { ok: false, error: '지금 다니는 반이 아닙니다.' });
  });
});

test('되돌림: 시험이 끝나면 학원이의 메모·성적·목표·코멘트·감사로그가 시험 전과 같다', { skip: SKIP }, async () => {
  const snap = () => db`select (select count(*)::int from public.student_memos where student_id=${SID}) memos, (select count(*)::int from public.student_grades where student_id=${SID}) grades,
    (select count(*)::int from public.grade_goals where student_id=${SID}) goals, (select count(*)::int from public.grade_comments where student_id=${SID}) comments,
    (select count(*)::int from public.audit_logs where tenant_id=${t} and metadata->>'via' = '3.0 연습 복사본' and metadata->>'studentId' = ${SID}) audits`;
  const before = await snap();
  await inTx(async (sql, call, form) => { await call('createStudentMemo', [null, form({ studentId: SID, content: '되돌림 시험' })]); });
  assert.deepEqual(await snap(), before);
});

test.after(() => db?.end());
