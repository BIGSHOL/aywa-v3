// 2.0 화면 · 원생 상세 탭 안 저장(2단계) — 2.0 서버 액션을 Docker 복사본에 같은 결과로(V2-SCREENS.md '2단계').
// · 수업 탭(배정 · 반 이동 · 등원 요일 · 수강 종료 · 시작·종료일 · 수강 이력 삭제) = 반 화면이 이미 옮긴 저장을 그대로 쓴다(v2-screen-classes.mjs actions —
//   같은 2.0 함수 · 같은 판정 · 같은 감사로그. 저장하는 사람 확인도 그쪽 규칙 = 수업 관리 '전체' — 2.0 게이트와 같은 축).
// · 특이사항(메모 4) · 성적(성적 추가·삭제 · 목표 · 평가 코멘트 · 레벨테스트) · 상담(삭제 · 후속 조치) · 진도 이상 확인 · 숙제 영상 링크 끊기 = 여기서 옮겼다:
//   features/students/server/actions.ts · consultations/server/actions.ts · progress/server/anomaly-actions.ts · video-submit/server/actions.ts.
//   판정 순서 · 문구 · 반환 모양 · 감사로그(action 이름 · metadata — 본문·점수는 담지 않는 2.0 규칙 그대로 + via) 2.0 그대로.
// · 쓰기는 2.0처럼 사용자 신분 · authenticated 역할로(RLS · 보호 트리거가 2.0처럼 본다) — 끝나면 역할과 신분을 들어올 때 값으로 되돌린다
//   (set_config local은 저장점을 풀어도 트랜잭션 끝까지 남는다). 감사로그 · 신규생 체크 해제는 2.0처럼 관리자 쓰기(admin client 자리).
// · 저장하는 사람 = v2-students-common.mjs readStudentEditors(학생 관리 '전체') — 각 저장은 그 사람의 2.0 권한(메뉴 수준)을 다시 본다.
// · 바깥 호출 없음. 영상 링크 끊기의 '쓸 수 있는가'(2.0 videoSubmitAvailability)는 Drive 연결을 묻는 자리라, 숙제 영상 탭 표시와 같은
//   기준(ClassNote 모듈 켜짐 + 링크 표 있음)으로 본다.
import { V2Error } from './v2-screens.mjs';
import { studentsBase, readStudentEditors } from './v2-students-common.mjs';
import { pgError } from './v2-onescreen-roster.mjs';
import { screen as classesScreen } from './v2-screen-classes.mjs';

const VIA = '3.0 연습 복사본';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const STUDENTS = 'features/students/server/actions.ts';
const CONSULTATIONS = 'features/consultations/server/actions.ts';

const MODULES = { term: 'features/grades/term.ts', slots: 'features/grades/exam-slots.ts', keep: 'features/grades/keep.ts', goals: 'features/grades/goals.ts',
  meta: 'features/students/detail/grades-meta.ts', anomaly: 'features/progress/anomaly-gate.ts', dbError: 'lib/supabase/db-error.ts', dk: 'lib/date-kst.ts',
  eligibility: 'features/enrollments/eligibility.ts', classnote: 'features/owner/classnote-gate.ts' };
let rulesP = null;
const rules = (importV2) => (rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries)
  .catch((e) => { rulesP = null; throw e; }));

// ── 2.0 FormData ─────────────────────────────────────────────────────────────────────────────────────────────────────
const FORM_MAX = 200;
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → 2.0이 읽는 get(없으면 null — 체크박스 꺼짐 = 칸 없음). */
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > FORM_MAX) throw bad();
  const pairs = v.$formData.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 100 || p[1].length > 20000) throw bad();
    return p;
  });
  return { get: (k) => pairs.find((p) => p[0] === k)?.[1] ?? null };
}
const formArgs = (args) => { if (args.length !== 2) throw bad(); return [formOf(args[1])]; };
const str = (f, k, d = '') => String(f.get(k) ?? d).trim();

// ── 저장하는 사람 · 신분 ─────────────────────────────────────────────────────────────────────────────────────────────────
/** 고른 사람(학생 관리 '전체' 목록 안)과 그 사람의 2.0 메뉴 수준(학원 설정의 역할 재정의 + 개인 예외). 목록 밖이면 거절. */
async function actorOf(base, actorId) {
  const editors = await readStudentEditors(base);
  const picked = actorId ? editors.find((e) => e.id === actorId) : null;
  if (!picked) throw new V2Error(403, 'actor_not_allowed', '저장하는 사람을 다시 골라 주세요. 학생 관리 권한이 있는 직원만 저장할 수 있습니다.');
  const [row] = await base.sql`select system_role::text role from public.users where tenant_id=${base.t} and id=${picked.id}`;
  const { RR, settings } = base;
  const matrix = RR.applyUserOverrides(RR.resolveMatrix(settings.permissions.overrides ?? []), picked.id, row.role, settings.permissions.userOverrides ?? []);
  return { id: picked.id, name: picked.name, systemRole: row.role, level: (menu) => RR.accessLevel(row.role, menu, matrix) };
}

/** 2.0 사용자 클라이언트 자리 — 그 사람 신분 · authenticated 역할로 쓰고, 끝나면 들어올 때 값으로 되돌린다(실패하면 저장점째 되돌아간다). */
const asUser = (sql, actor, fn) => sql.savepoint(async (s) => {
  const [{ prev }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev`;
  await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  await s`set local role authenticated`;
  const out = await fn(s);
  await s`reset role`;
  await s`select set_config('request.jwt.claims', ${prev}, true)`;
  return out;
});
/** 2.0 쓰기 결과 — { data, error }(supabase 모양 · 오류는 PostgREST 오류 모양). 저장점 안에서 실패하면 그 저장점만 되돌린다. */
async function tryWrite(sql, actor, fn) {
  try { return { data: await asUser(sql, actor, fn), error: null }; } catch (e) { return { data: null, error: pgError(e) }; }
}
/** 2.0 logAction — 관리자 쓰기(신분과 무관) · metadata에 via. 2.0 metadata가 이미 via를 쓰면(newcomer_uncheck 'consultation' — 감사 표시가 읽는다)
 *  그 값을 두고 연습 표시는 practice에. */
const audit = (sql, t, actor, action, targetType, metadata, targetLabel = null) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, ${targetType}, ${targetLabel}, ${sql.json(metadata && 'via' in metadata ? { ...metadata, practice: VIA } : { ...metadata, via: VIA })})`;

const write = (lvl) => lvl === 'full' || lvl === 'scoped';
/** 2.0 dbWhy = explainDbError(...).message — 제약 이름·코드로 한국어 이유, 모르면 fallback. */
const dbWhy = (R, error, scope, fallback, op, constraints) => R.dbError.explainDbError(error, { scope, fallback, ...(op ? { op } : {}), ...(constraints ? { constraints } : {}) }).message;
/** 강사 범위 판정(studentScopeError · rowScopeError) — 저장하는 사람은 학생 관리 '전체'라 늘 통과(scoped 갈래가 없다). 행이 없으면 2.0처럼 그대로 진행. */

// ── 특이사항 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function createStudentMemo(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const studentId = str(f, 'studentId'), category = str(f, 'category') || 'general', content = str(f, 'content');
  const searchable = f.get('searchable') !== null;
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!content) return { error: '특이사항 내용을 입력해주세요' };
  const { error } = await tryWrite(c.sql, c.actor, (s) => s`insert into public.student_memos (tenant_id, student_id, category, content, searchable, created_by)
    values (${c.t}, ${studentId}, ${category}, ${content}, ${searchable}, ${c.actor.id})`);
  if (error) return { error: dbWhy(c.R, error, 'students.memo.create', '특이사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  await audit(c.sql, c.t, c.actor, 'student_memo_create', 'student', { studentId, category, searchable });
  return { ok: true };
}
async function deleteStudentMemo(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId');
  if (!id) return { error: '특이사항 ID가 누락되었습니다' };
  const { data: gone, error } = await tryWrite(c.sql, c.actor, (s) => s`delete from public.student_memos where id = ${id} returning student_id::text student_id`);
  if (error) return { error: dbWhy(c.R, error, 'students.memo.delete', '특이사항을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (gone?.length) await audit(c.sql, c.t, c.actor, 'student_memo_delete', 'student', { memoId: id, studentId: gone[0].student_id ?? (studentId || null) });
  return undefined;
}
async function updateStudentMemo(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId'), category = str(f, 'category') || 'general', content = str(f, 'content');
  const searchable = f.get('searchable') !== null;
  if (!id) return { error: '특이사항 ID가 누락되었습니다' };
  if (!content) return { error: '특이사항 내용을 입력해주세요' };
  const { data: saved, error } = await tryWrite(c.sql, c.actor, (s) => s`update public.student_memos set category = ${category}, content = ${content}, searchable = ${searchable},
    updated_at = ${new Date().toISOString()} where id = ${id} returning student_id::text student_id`);
  if (error) return { error: dbWhy(c.R, error, 'students.memo.update', '특이사항을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  if (saved?.length) await audit(c.sql, c.t, c.actor, 'student_memo_update', 'student', { memoId: id, studentId: saved[0].student_id ?? (studentId || null), category, searchable });
  return { ok: true };
}
async function toggleStudentMemoPin(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId'), pinned = str(f, 'pinned', 'false') === 'true';
  if (!id) return { error: '특이사항 ID가 누락되었습니다' };
  const { data: saved, error } = await tryWrite(c.sql, c.actor, (s) => s`update public.student_memos set pinned = ${pinned}, updated_at = ${new Date().toISOString()}
    where id = ${id} returning student_id::text student_id`);
  if (error) return { error: dbWhy(c.R, error, 'students.memo.pin', '특이사항 고정을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  if (saved?.length) await audit(c.sql, c.t, c.actor, 'student_memo_pin', 'student', { memoId: id, studentId: saved[0].student_id ?? (studentId || null), pinned });
  return undefined;
}

// ── 성적 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 columnExists — 그 컬럼이 없다는 오류(42703)만 미준비. */
const columnReady = (c, table, column) => c.gate.soft((sp) => sp.unsafe(`select ${column} from ${table} limit 1`).then(() => true), (e) => (e?.code === '42703' ? false : true));
/** 2.0 writeGradeCells — 학생 상세 폼의 한 칸(점수 + 메모). 0283a 축 · 0288a 월 축(없으면 월말평가만 막음) · upsert = 준 열만 갱신. */
async function writeGradeCell(c, axis, row) {
  const { slots } = c.R;
  const monthReady = await columnReady(c, 'public.student_grades', 'exam_month');
  const month = slots.gradeMonthOf(axis.slot, axis.date);
  if (!monthReady && slots.slotUsesMonth(axis.slot)) throw new Error(slots.GRADE_MONTH_NOT_READY);
  if (!c.R.keep.gradeCellKeeps(row)) throw new Error('성적 저장 실패: 남길 칸이 없습니다'); // 폼은 점수가 있어야 오므로 서지 않는 갈래
  const cols = { tenant_id: c.t, student_id: row.studentId, class_id: row.classId, subject: axis.subject, school_year: axis.year, term: axis.term, exam_slot: axis.slot,
    exam_name: slots.EXAM_SLOT_LABEL[axis.slot], score: row.score, max_score: axis.maxScore, taken_on: axis.date, ...(monthReady ? { exam_month: month } : {}),
    created_by: c.actor.id, notes: row.notes ?? null };
  const keys = Object.keys(cols), conflict = ['tenant_id', 'student_id', 'subject', 'school_year', 'term', 'exam_slot', ...(monthReady ? ['exam_month'] : [])];
  // PostgREST upsert(merge-duplicates) = 같은 칸이면 실은 열만 갱신(열 이름은 위 상수뿐).
  const { error } = await tryWrite(c.sql, c.actor, (s) => s`insert into public.student_grades ${s(cols)}
    on conflict (${s.unsafe(conflict.join(', '))}) do update set ${s.unsafe(keys.filter((k) => !conflict.includes(k)).map((k) => `${k} = excluded.${k}`).join(', '))}`);
  if (error) throw new Error(`성적 저장 실패: ${error.message}`);
}
async function createStudentGrade(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const { term: T, slots } = c.R;
  const studentId = str(f, 'studentId'), subject = str(f, 'subject'), scoreStr = str(f, 'score'), maxScoreStr = str(f, 'maxScore'), takenOn = str(f, 'takenOn');
  const notes = str(f, 'notes') || null;
  const fallback = T.defaultTermOf(c.today);
  const year = T.normalizeYear(f.get('year'), fallback.year), term = T.normalizeTerm(f.get('term'), fallback.term), slot = slots.normalizeExamSlot(subject, f.get('slot'));
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!subject) return { error: '과목을 선택해주세요' };
  if (!takenOn) return { error: '시험일을 입력해주세요' };
  const window = T.termWindow(year, term);
  if (takenOn < window.start || takenOn > window.end) return { error: `시험일이 그 학기(${window.start} ~ ${window.end}) 밖입니다` };
  if (!scoreStr) return { error: '점수를 입력해주세요' };
  const score = Number(scoreStr);
  if (!Number.isFinite(score)) return { error: '점수는 숫자로 입력해주세요' };
  const maxScore = maxScoreStr ? Number(maxScoreStr) : null;
  if (maxScoreStr && !Number.isFinite(maxScore)) return { error: '만점은 숫자로 입력해주세요' };
  if (!(await columnReady(c, 'public.student_grades', 'exam_slot'))) return { error: '성적 학기 구조(0283a)가 아직 적용되지 않아 저장할 수 없습니다' };
  try { await writeGradeCell(c, { subject, year, term, slot, date: takenOn, maxScore }, { studentId, classId: null, score, notes }); } catch (e) {
    return { error: e instanceof Error ? e.message : '성적을 저장하지 못했습니다' };
  }
  await audit(c.sql, c.t, c.actor, 'student_grade_create', 'student', { studentId, subject, year, term, slot, date: takenOn });
  return undefined;
}
async function deleteStudentGrade(c, f) {
  if (!write(c.actor.level('students'))) return { error: '성적 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId');
  if (!id) return { error: '성적 ID가 누락되었습니다' };
  const { data: gone, error } = await tryWrite(c.sql, c.actor, (s) => s`delete from public.student_grades where id = ${id}
    returning student_id::text student_id, subject, taken_on::text taken_on`);
  if (error) return { error: dbWhy(c.R, error, 'students.grade.delete', '성적을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (gone?.length) await audit(c.sql, c.t, c.actor, 'student_grade_delete', 'student', { gradeId: id, studentId: gone[0].student_id ?? (studentId || null), subject: gone[0].subject, date: gone[0].taken_on });
  return undefined;
}

const LEVEL_TEST_TYPES = ['placement', 'promotion', 'diagnostic'];
const LEVEL_SUBSCORE_KEYS = { math: ['계산', '이해', '추론', '문제해결'], english: ['어휘', '문법', '청해', '독해'] };
async function createStudentLevelTest(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const studentId = str(f, 'studentId'), testTypeRaw = str(f, 'testType', 'placement');
  const testType = LEVEL_TEST_TYPES.includes(testTypeRaw) ? testTypeRaw : 'placement';
  const subject = str(f, 'subject'), testedOn = str(f, 'testedOn'), level = str(f, 'level') || null, notes = str(f, 'notes') || null;
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!subject) return { error: '과목을 선택해주세요' };
  if (!testedOn) return { error: '시험일을 입력해주세요' };
  const subscores = {};
  for (const k of LEVEL_SUBSCORE_KEYS[subject] ?? []) { const v = str(f, `sub_${k}`); if (v !== '' && Number.isFinite(Number(v))) subscores[k] = Number(v); }
  const { error } = await tryWrite(c.sql, c.actor, (s) => s`insert into public.level_tests (tenant_id, student_id, test_type, subject, tested_on, level, subscores, notes, created_by)
    values (${c.t}, ${studentId}, ${testType}, ${subject}, ${testedOn}, ${level}, ${Object.keys(subscores).length ? s.json(subscores) : null}, ${notes}, ${c.actor.id})`);
  if (error) return { error: dbWhy(c.R, error, 'students.levelTest.create', '레벨테스트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  await audit(c.sql, c.t, c.actor, 'student_level_test_create', 'student', { studentId, subject, testType, date: testedOn });
  return undefined;
}
async function deleteStudentLevelTest(c, f) {
  if (!write(c.actor.level('students'))) return { error: '학생 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId');
  if (!id) return { error: '레벨테스트 ID가 누락되었습니다' };
  const { data: gone, error } = await tryWrite(c.sql, c.actor, (s) => s`delete from public.level_tests where id = ${id}
    returning student_id::text student_id, subject, test_type, tested_on::text tested_on`);
  if (error) return { error: dbWhy(c.R, error, 'students.levelTest.delete', '레벨테스트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (gone?.length) {
    const t = gone[0];
    await audit(c.sql, c.t, c.actor, 'student_level_test_delete', 'student', { levelTestId: id, studentId: t.student_id ?? (studentId || null), subject: t.subject, testType: t.test_type, date: t.tested_on });
  }
  return undefined;
}

const GOAL_DUPLICATE = '이 시험의 목표가 이미 있습니다 — 기존 목표를 지우고 다시 추가하세요';
const gradeWrite = (c) => (write(c.actor.level('students')) ? null : '성적 관리 권한이 없습니다');
async function createStudentGoal(c, f) {
  const denied = gradeWrite(c); if (denied) return { error: denied };
  const studentId = str(f, 'studentId'), targetStr = str(f, 'targetScore'), maxStr = str(f, 'maxScore'), reason = str(f, 'reason') || null;
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  const axis = c.R.goals.parseGoalAxis({ subject: String(f.get('subject') ?? ''), year: f.get('year'), term: f.get('term'), slot: f.get('slot'), month: f.get('month') });
  if (typeof axis === 'string') return { error: axis };
  const max = Number(maxStr);
  if (!maxStr || !Number.isFinite(max) || max < 1 || max > 1000) return { error: '만점은 1~1000 사이로 입력해주세요' };
  const target = Number(targetStr);
  if (!targetStr || !Number.isFinite(target) || target < 0 || target > max) return { error: '목표 점수는 0 이상 만점 이하로 입력해주세요' };
  if (!(await columnReady(c, 'public.grade_goals', 'school_year'))) return { error: '목표 구조(0291a)가 아직 적용되지 않아 목표를 저장할 수 없습니다' };
  const found = await tryWrite(c.sql, c.actor, (s) => s`select id from public.grade_goals where tenant_id=${c.t} and student_id=${studentId} and subject=${axis.subject}
    and school_year=${axis.year} and term=${axis.term} and exam_slot=${axis.slot} and exam_month is not distinct from ${axis.month} limit 1`);
  if (found.error) return { error: dbWhy(c.R, found.error, 'students.goal.create.read', '목표를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  if (found.data.length) return { error: GOAL_DUPLICATE };
  const { error } = await tryWrite(c.sql, c.actor, (s) => s`insert into public.grade_goals (tenant_id, student_id, exam_id, exam_name, subject, school_year, term, exam_slot, exam_month,
      target_score, max_score, reason, created_by)
    values (${c.t}, ${studentId}, null, ${c.R.goals.goalExamLabel(axis)}, ${axis.subject}, ${axis.year}, ${axis.term}, ${axis.slot}, ${axis.month}, ${target}, ${max}, ${reason}, ${c.actor.id})`);
  if (error) return { error: dbWhy(c.R, error, 'students.goal.create', '목표를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', null, { ux_grade_goals_cell: { message: GOAL_DUPLICATE } }) };
  await audit(c.sql, c.t, c.actor, 'student_goal_create', 'student', { studentId, subject: axis.subject, year: axis.year, term: axis.term, slot: axis.slot, month: axis.month });
  return { ok: true };
}
async function deleteStudentGoal(c, f) {
  const denied = gradeWrite(c); if (denied) return { error: denied };
  const id = str(f, 'id'), studentId = str(f, 'studentId');
  if (!id) return { error: '목표 ID가 누락되었습니다' };
  const { data: gone, error } = await tryWrite(c.sql, c.actor, (s) => s`delete from public.grade_goals where id = ${id} returning student_id::text student_id, subject`);
  if (error) return { error: dbWhy(c.R, error, 'students.goal.delete', '목표를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (gone?.length) await audit(c.sql, c.t, c.actor, 'student_goal_delete', 'student', { goalId: id, studentId: gone[0].student_id ?? (studentId || null), subject: gone[0].subject });
  return undefined;
}

function readCommentForm(c, f) {
  const subjectRaw = str(f, 'subject');
  return { category: str(f, 'category', 'general'), subject: subjectRaw && subjectRaw !== 'all' ? subjectRaw : null, content: str(f, 'content'),
    period: str(f, 'period') || c.R.meta.currentPeriod(), sharedWithParent: f.get('sharedWithParent') != null };
}
async function createStudentGradeComment(c, f) {
  const denied = gradeWrite(c); if (denied) return { error: denied };
  const studentId = str(f, 'studentId'), x = readCommentForm(c, f);
  if (!studentId) return { error: '학생 ID가 누락되었습니다' };
  if (!c.R.meta.isCommentCategory(x.category)) return { error: '유효한 카테고리가 아닙니다' };
  if (!x.content) return { error: '코멘트 내용을 입력해주세요' };
  const { error } = await tryWrite(c.sql, c.actor, (s) => s`insert into public.grade_comments (tenant_id, student_id, category, subject, content, period, shared_with_parent, author_id)
    values (${c.t}, ${studentId}, ${x.category}, ${x.subject}, ${x.content}, ${x.period}, ${x.sharedWithParent}, ${c.actor.id})`);
  if (error) return { error: dbWhy(c.R, error, 'students.gradeComment.create', '코멘트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  await audit(c.sql, c.t, c.actor, 'student_grade_comment_create', 'student', { studentId, category: x.category, subject: x.subject, period: x.period, sharedWithParent: x.sharedWithParent });
  return { ok: true };
}
async function updateStudentGradeComment(c, f) {
  const denied = gradeWrite(c); if (denied) return { error: denied };
  const id = str(f, 'id'), studentId = str(f, 'studentId'), x = readCommentForm(c, f);
  if (!id) return { error: '코멘트 ID가 누락되었습니다' };
  if (!c.R.meta.isCommentCategory(x.category)) return { error: '유효한 카테고리가 아닙니다' };
  if (!x.content) return { error: '코멘트 내용을 입력해주세요' };
  const { data: saved, error } = await tryWrite(c.sql, c.actor, (s) => s`update public.grade_comments set category = ${x.category}, subject = ${x.subject}, content = ${x.content},
    period = ${x.period}, shared_with_parent = ${x.sharedWithParent} where id = ${id} returning student_id::text student_id`);
  if (error) return { error: dbWhy(c.R, error, 'students.gradeComment.update', '코멘트를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') };
  if (saved?.length) await audit(c.sql, c.t, c.actor, 'student_grade_comment_update', 'student', { commentId: id, studentId: saved[0].student_id ?? (studentId || null),
    category: x.category, subject: x.subject, period: x.period, sharedWithParent: x.sharedWithParent });
  return { ok: true };
}
async function deleteStudentGradeComment(c, f) {
  const denied = gradeWrite(c); if (denied) return { error: denied };
  const id = str(f, 'id'), studentId = str(f, 'studentId');
  if (!id) return { error: '코멘트 ID가 누락되었습니다' };
  const { data: gone, error } = await tryWrite(c.sql, c.actor, (s) => s`delete from public.grade_comments where id = ${id}
    returning student_id::text student_id, category, subject, period`);
  if (error) return { error: dbWhy(c.R, error, 'students.gradeComment.delete', '코멘트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'delete') };
  if (gone?.length) {
    const x = gone[0];
    await audit(c.sql, c.t, c.actor, 'student_grade_comment_delete', 'student', { commentId: id, studentId: x.student_id ?? (studentId || null), category: x.category, subject: x.subject, period: x.period });
  }
  return undefined;
}

// ── 상담(consultations/server/actions.ts) ─────────────────────────────────────────────────────────────────────────────
const OUT_OF_SCOPE_CONSULTATION = '본인이 작성한 상담만 고칠 수 있습니다';
async function toggleConsultationFollowUp(c, f) {
  const lvl = c.actor.level('consultations');
  if (lvl !== 'full' && lvl !== 'scoped') return { error: '상담 관리 권한이 없습니다' };
  const id = str(f, 'id'), done = str(f, 'done', 'false') === 'true';
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const scopedId = lvl === 'scoped' ? c.actor.id : null;
  const { data, error } = await tryWrite(c.sql, c.actor, (s) => s`update public.student_consultations set follow_up_done = ${done}
    where id = ${id} ${scopedId ? s`and counselor_id = ${scopedId}` : s``} returning student_id::text student_id`);
  if (error) return { error: c.R.dbError.explainDbError(error, { scope: 'consultations.followUp', fallback: '후속조치를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message };
  const row = data?.[0] ?? null;
  if (scopedId && !row) return { error: OUT_OF_SCOPE_CONSULTATION };
  await audit(c.sql, c.t, c.actor, 'student_consultation_follow_up', 'student_consultation', { consultationId: id, studentId: row?.student_id ?? null, done });
  return undefined;
}
async function deleteStudentConsultation(c, f) {
  if (!write(c.actor.level('consultations'))) return { error: '상담 관리 권한이 없습니다' };
  const id = str(f, 'id'), studentId = str(f, 'studentId'), redirectTo = str(f, 'redirectTo');
  if (!id) return { error: '상담 ID가 누락되었습니다' };
  const read = await tryWrite(c.sql, c.actor, (s) => s`select student_id::text student_id, counselor_id::text counselor_id, to_json(consulted_at)#>>'{}' consulted_at,
    category, audience, follow_up_action, follow_up_done from public.student_consultations where id = ${id}`);
  const before = read.data?.[0] ?? null;
  const scopedId = c.actor.level('consultations') === 'scoped' ? c.actor.id : null;
  if (scopedId) {
    if (read.error) return { error: '상담을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    if (!before || before.counselor_id !== scopedId) return { error: OUT_OF_SCOPE_CONSULTATION };
  }
  // 2.0 prepareConsultationUnlink — 이 상담으로 한 신규생 체크를 지우기 전에 찾아 두고(관리자 읽기), 삭제가 성공한 뒤에 푼다.
  const linked = await c.gate.soft((sp) => sp`select id::text id, student_id::text student_id, subject, item_key, done_on::text done_on, done_by::text done_by
    from public.student_onboarding_checks where tenant_id=${c.t} and consultation_id=${id}`, (e) => (e?.code === '42703' || e?.code === '42P01' ? [] : null));
  if (!linked) return { error: '신규생 체크 연결을 확인하지 못했습니다 — 상담을 지우지 않았습니다' };
  const del = await tryWrite(c.sql, c.actor, (s) => s`delete from public.student_consultations where id = ${id} ${scopedId ? s`and counselor_id = ${scopedId}` : s``}`);
  if (del.error) return { error: c.R.dbError.explainDbError(del.error, { scope: 'consultations.delete', fallback: '상담을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', op: 'delete' }).message };
  // unlinkRows(afterDelete) — 읽은 그대로일 때만(FK는 이미 null) 완료일·처리자를 비운다. 실패는 2.0처럼 삼킨다(로그만).
  for (const r of linked) {
    const out = await c.gate.soft((sp) => sp`update public.student_onboarding_checks set done_on = null, done_by = null, consultation_id = null
      where tenant_id=${c.t} and id=${r.id} and consultation_id is null and done_on is not distinct from ${r.done_on}::date and done_by is not distinct from ${r.done_by}::uuid
      returning id`, null);
    if (out === null) { console.error('[consultation] newcomer unlink after delete 실패'); break; }
    if (r.done_on && out.length) await audit(c.sql, c.t, c.actor, 'newcomer_uncheck', 'student',
      { studentId: r.student_id, itemKey: r.item_key, doneOn: null, subject: r.subject, consultationId: id, via: 'consultation' });
  }
  await audit(c.sql, c.t, c.actor, 'student_consultation_delete', 'student_consultation', {
    consultationId: id, studentId: before?.student_id ?? (studentId || null), consultedAt: c.R.dk.kstDateOf(before?.consulted_at),
    category: before?.category ?? null, audience: before?.audience ?? null, hasFollowUp: !!before?.follow_up_action });
  // 2.0 redirect(redirectTo) — 호스트가 같은 화면 이동으로 받는다(학생 상세의 상담 탭은 redirectTo를 싣지 않는다).
  return redirectTo ? { redirectTo } : undefined;
}

// ── 진도 이상 확인 · 숙제 영상 링크 끊기 ───────────────────────────────────────────────────────────────────────────────
async function setProgressAnomalyResolved(c, [eventId, resolved]) {
  const read = await tryWrite(c.sql, c.actor, (s) => s`select id::text id, student_id::text student_id, event_type from public.progress_events where id = ${eventId}`);
  if (read.error) return { ok: false, error: read.error.message };
  const event = read.data[0];
  if (!event) return { ok: false, error: '기록을 찾을 수 없습니다' };
  if (!['jump_error', 'overlap_error'].includes(event.event_type)) return { ok: false, error: '확인 대상이 아닌 기록입니다' };
  const level = c.actor.level('students');
  // 강사 담당 판정(teacherOwnsStudent)은 scoped 갈래 — 저장하는 사람은 학생 관리 '전체'라 서지 않는다.
  if (!c.R.anomaly.canResolveProgressAnomaly(level, false)) return { ok: false, error: '권한이 없습니다' };
  const upd = await tryWrite(c.sql, c.actor, (s) => (resolved
    ? s`update public.progress_events set resolved_at = ${new Date().toISOString()}, resolved_by = ${c.actor.id} where id = ${eventId}`
    : s`update public.progress_events set resolved_at = null, resolved_by = null where id = ${eventId}`));
  if (upd.error) return { ok: false, error: upd.error.message };
  await audit(c.sql, c.t, c.actor, 'progress_anomaly_resolve', 'student', { eventId, studentId: event.student_id, eventType: event.event_type, resolved });
  return { ok: true };
}
async function revokeVideoSubmitLinks(c, [studentId, classId]) {
  // gate — 학생 관리 열람 · 그 학생 · 지금 다니는 반 · 제출 링크를 쓸 수 있는 지점(ClassNote 모듈 + 링크 표).
  if (c.actor.level('students') === 'none') return { ok: false, error: '이 학생의 링크를 다룰 수 없습니다.' };
  const [student] = await c.sql`select name from public.students where tenant_id=${c.t} and id=${studentId}`;
  if (!student) return { ok: false, error: '이 학생의 링크를 다룰 수 없습니다.' };
  const rows = await c.sql`select e.end_date::text end_date, e.is_transferred, c.class_name from public.enrollments e join public.classes c on c.id = e.class_id
    where e.tenant_id=${c.t} and e.student_id=${studentId} and e.class_id=${classId} order by e.start_date desc, e.id`;
  const enrollment = rows.find((e) => !c.R.eligibility.isEnrollmentEndedOn(e.end_date, c.today, e.is_transferred ?? false));
  if (!enrollment) return { ok: false, error: '지금 다니는 반이 아닙니다.' };
  const tableReady = await c.gate.soft((sp) => sp`select 1 from public.homework_video_links limit 1`.then(() => true), false);
  if (!c.R.classnote.classnoteModuleOn(c.base.settings) || !tableReady) return { ok: false, error: '지금은 제출 링크를 쓸 수 없습니다.' };
  // revokeSubmitLinks — 관리자 쓰기 · 아직 살아 있는 링크만.
  const now = new Date().toISOString();
  const done = await c.gate.soft((sp) => sp`update public.homework_video_links set revoked_at = ${now}, revoked_by = ${c.actor.id}
    where tenant_id=${c.t} and student_id=${studentId} and class_id=${classId} and revoked_at is null and expires_at > ${now} returning id`, null);
  if (done === null) return { ok: false, error: '링크를 끊지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  await audit(c.sql, c.t, c.actor, 'lesson_report_video_link_revoke', 'student', { studentId, classId, revoked: done.length }, `${student.name} · ${enrollment.class_name}`);
  return { ok: true, revoked: done.length };
}

// ── 액션 표 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const boolArg = (v) => { if (typeof v !== 'boolean') throw bad(); return v; };
const uuidArg = (v) => { if (typeof v !== 'string' || !UUID.test(v)) throw bad(); return v; };
const OWN = {
  createStudentMemo: { module: STUDENTS, args: formArgs, run: createStudentMemo },
  updateStudentMemo: { module: STUDENTS, args: formArgs, run: updateStudentMemo },
  deleteStudentMemo: { module: STUDENTS, args: formArgs, run: deleteStudentMemo },
  toggleStudentMemoPin: { module: STUDENTS, args: formArgs, run: toggleStudentMemoPin },
  createStudentGrade: { module: STUDENTS, args: formArgs, run: createStudentGrade },
  deleteStudentGrade: { module: STUDENTS, args: formArgs, run: deleteStudentGrade },
  createStudentLevelTest: { module: STUDENTS, args: formArgs, run: createStudentLevelTest },
  deleteStudentLevelTest: { module: STUDENTS, args: formArgs, run: deleteStudentLevelTest },
  createStudentGoal: { module: STUDENTS, args: formArgs, run: createStudentGoal },
  deleteStudentGoal: { module: STUDENTS, args: formArgs, run: deleteStudentGoal },
  createStudentGradeComment: { module: STUDENTS, args: formArgs, run: createStudentGradeComment },
  updateStudentGradeComment: { module: STUDENTS, args: formArgs, run: updateStudentGradeComment },
  deleteStudentGradeComment: { module: STUDENTS, args: formArgs, run: deleteStudentGradeComment },
  toggleConsultationFollowUp: { module: CONSULTATIONS, args: formArgs, run: toggleConsultationFollowUp },
  deleteStudentConsultation: { module: CONSULTATIONS, args: formArgs, run: deleteStudentConsultation },
  setProgressAnomalyResolved: { module: 'features/progress/server/anomaly-actions.ts', args: (a) => { if (a.length !== 2) throw bad(); return [uuidArg(a[0]), boolArg(a[1])]; }, run: setProgressAnomalyResolved },
  revokeVideoSubmitLinks: { module: 'features/video-submit/server/actions.ts', args: (a) => { if (a.length !== 2) throw bad(); return [uuidArg(a[0]), uuidArg(a[1])]; }, run: revokeVideoSubmitLinks },
};
/** 수업 탭 저장 — 반 화면 저장 그대로(같은 2.0 함수 · 같은 검증·판정·감사로그). */
const REUSED = ['createEnrollment', 'updateEnrollmentDates', 'deleteEnrollment', 'moveEnrollmentsBatch', 'updateEnrollmentsAttendanceBatch', 'endSingleEnrollment'];

export const studentsTabActions = {
  ...Object.fromEntries(Object.entries(OWN).map(([name, a]) => [name, {
    validate: (raw) => {
      if (!plain(raw) || raw.module !== a.module || !Array.isArray(raw.args) || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      return { actor: raw.actor ?? null, args: a.args(raw.args) };
    },
    run: async ({ sql: tx, body, tenantId, importV2 }) => {
      const base = await studentsBase({ sql: tx, tenantId, importV2 });
      const R = await rules(base.load);
      const actor = await actorOf(base, body.actor);
      // sql = 이 쓰기 트랜잭션(저장점 · 신분 전환) · gate = 실패를 삼키는 조회(2.0이 오류를 빈 값으로 받는 자리).
      const c = { base, sql: tx, gate: base.sql, t: tenantId, R, actor, today: base.today };
      return a.args === formArgs ? a.run(c, body.args[0]) : a.run(c, body.args);
    },
  }])),
  ...Object.fromEntries(REUSED.map((name) => {
    const a = classesScreen.actions?.[name];
    if (!a) throw new Error(`반 화면 저장에 ${name}이 없습니다`);
    return [name, a];
  })),
};
