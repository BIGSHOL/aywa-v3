// 2.0 화면 — 강사 시트 · 수학(MCS) 저장: 반 월간 화면이 부르는 2.0 서버 액션을 Docker 복사본에.
//  · math-sheets/server/actions.ts setMyMcsFontSize · learning-actions.ts saveMathLearningGoals · setMathClassLearningTrack · resetMathLearningGoals
//  · learning-revision-actions.ts loadMathLearningGoalRevision(읽기 — 화면 GET `revision`) · reviseMathLearningGoal
//  · textbooks/server/math-assignment-actions.ts saveMathTextbookAssignment · math-book-target-actions.ts saveMathBookTarget · school-exam-actions.ts saveSchoolExamPeriods
// 판정 순서·문구·반환 모양·감사로그 이름은 2.0 그대로. 게이트 = 2.0 requireMcsClassAccess(v2-mcs-core mcsClassAccess)를 '저장하는 사람'(= 보는 사람)으로.
// 2.0은 이 저장을 전부 서비스 키(RLS 우회)로 한다 — 복사본 접속도 RLS를 안 타니 같은 결이고, 모든 쿼리에 tenant_id를 직접 건다.
// ⚠️ 옛 칸 저장(upsertStudentGoal · copyGoalsFromPreviousMonth · commitMathGoalEdits)은 2.0의 어느 화면에서도 안 부른다(month-client 미사용) — 옮기지 않는다.
import { z } from 'zod';
import { V2Error } from './v2-screens.mjs';
import { audit } from './v2-timetable-save.mjs';
import { UUID, loadRules, readSettings, readViewers, mcsClassAccess } from './v2-mcs-core.mjs';
import { ISO, loadMonthRules, mathSheetMonth, mathLearningData } from './v2-mcs-month.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

let saveRules = null;
function loadSaveRules(importV2) {
  saveRules ??= (async () => {
    const [comparison, revision, bookSeq, assign, font] = await Promise.all([
      'features/math-sheets/lib/learning-goal-comparison.ts', 'features/math-sheets/lib/learning-revision.ts', 'features/textbooks/book-sequence.ts',
      'features/textbooks/math-assignment.ts', 'features/math-sheets/font-size.ts',
    ].map(p => importV2(p)));
    return { comparison, revision, bookSeq, assign, font };
  })().catch(error => { saveRules = null; throw error; });
  return saveRules;
}

/** 저장점 안에서 쓴다 — 실패하면 그 줄만 되돌리고 2.0 supabase 오류 모양({ code })으로 돌려준다(2.0이 고르는 문구가 같게). */
const write = async (sql, fn) => { try { return { data: await sql.savepoint(fn), error: null }; } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '' } }; } };
/** 2.0 requireMcsClassAccess의 첫 줄(로그인) — 3.0엔 로그인이 없어 '저장하는 사람'이 MCS를 볼 수 있는 직원이 아니면 같은 문구. */
const NO_USER = { ok: false, error: '로그인이 필요합니다' };

// ── learning-actions.ts — 원문 그대로의 입력 모양 ───────────────────────────────────────────────────────────────────────
const inputSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  studyGrade: z.string().trim().min(1).max(60),
  endStudyGrade: z.string().trim().min(1).max(60).optional(),
  startBlock: z.string().min(1).max(500),
  endBlock: z.string().min(1).max(500),
  startDate: z.string(),
  endDate: z.string(),
  textbook: z.string().trim().max(500).nullable(),
  track: z.enum(["regular", "supplement"]).default("regular"),
  blockCount: z.number().int().positive().nullable().optional(),
  milestones: z.array(z.object({
    studyGrade: z.string().min(1).max(60), endBlock: z.string().min(1).max(500),
    endDate: z.string(), blockCount: z.number().int().positive(),
  })).max(100).optional(),
  mode: z.enum(["create", "extend"]).default("create"),
  updatedAt: z.string().optional(),
  revision: z.object({ effectiveDate: z.string(), anchor: z.object({ grade: z.string(), lesson: z.string() }).nullable(),
    lockedStops: z.number().int().nonnegative(), pastDays: z.array(z.object({ date: z.string(), topic: z.object({ grade: z.string(), lesson: z.string() }).nullable() })).max(4000) }).nullable().optional(),
});

const readTrack = async (sql, t, classId) => {
  const [row] = await sql`select math_learning_track from public.classes where tenant_id=${t} and id=${classId}`;
  return row ? (row.math_learning_track === 'supplement' ? 'supplement' : 'regular') : null;
};

async function saveMathLearningGoals(io, actor, [input]) {
  const { sql, t, R, M, S, env } = io;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "학생과 전체 목표 입력값을 확인해 주세요." };
  const value = parsed.data, studentIds = [...new Set(value.studentIds)];
  if (value.mode === "create" && value.revision) return { ok: false, error: "남은 계획 수정 창에서 기존 목표를 변경해 주세요." };
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const base = { ...value, studentId: studentIds[0], textbook: value.textbook || null };
  const invalid = M.plan.learningGoalError(base);
  if (invalid) return { ok: false, error: invalid };
  const { classId } = gate.access;
  const classTrack = await readTrack(sql, t, classId);
  if (!classTrack) return { ok: false, error: "반의 수업 유형을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  if (value.track !== classTrack) return { ok: false, error: "반에 지정된 수업 유형과 목표 유형이 다릅니다. 새로고침해 주세요." };
  if (value.mode === "extend") {
    if (studentIds.length !== 1 || !value.updatedAt || !value.blockCount) return { ok: false, error: "확장할 학생의 기존 목표를 다시 불러와 주세요." };
    const [existing] = await sql`select study_grade, end_study_grade, start_block, end_block, start_date::text start_date, end_date::text end_date, block_count, milestones,
        ${ISO(sql, 'updated_at')} updated_at, plan_revision from public.math_learning_track_goals
      where tenant_id=${t} and class_id=${classId} and student_id=${studentIds[0]} and track=${classTrack} and start_date=${value.startDate}::date`.catch(() => []);
    if (!existing || existing.updated_at !== value.updatedAt) return { ok: false, error: "목표가 변경되었습니다. 새로고침 후 다시 확장해 주세요." };
    const oldStops = M.plan.goalMilestones(M.plan.normalizeLearningGoal({ studentId: studentIds[0], studyGrade: existing.study_grade,
      endStudyGrade: existing.end_study_grade ?? undefined, startBlock: existing.start_block, endBlock: existing.end_block, startDate: existing.start_date, endDate: existing.end_date,
      blockCount: existing.block_count, milestones: existing.milestones, textbook: null, track: classTrack, revision: existing.plan_revision ?? null }));
    if (S.comparison.learningGoalPlanKey({ ...base, revision: existing.plan_revision ?? null }) !== S.comparison.learningGoalPlanKey(base))
      return { ok: false, error: "기존 계획의 배분은 유지하고 다음 목표를 추가해 주세요." };
    const stops = value.milestones ?? [];
    const sameStop = (a, b) => a.studyGrade === b.studyGrade && a.endBlock === b.endBlock && a.endDate === b.endDate && a.blockCount === b.blockCount;
    if (value.studyGrade !== existing.study_grade || value.startBlock !== existing.start_block || stops.length !== oldStops.length + 1 || oldStops.some((stop, i) => !sameStop(stop, stops[i])))
      return { ok: false, error: "이전 목표 정거장은 유지하고 다음 목표를 추가해 주세요." };
  }
  const read = await write(sql, s => Promise.all([
    s`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules where tenant_id=${t} and class_id=${classId}`,
    s`select student_id::text student_id, start_date::text start_date, end_date::text end_date, is_transferred, attendance_days from public.enrollments where tenant_id=${t} and class_id=${classId} and student_id = any(${studentIds}::uuid[])`,
    s`select id::text id, withdrawn_at::text withdrawn_at from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])`,
  ]));
  if (read.error) return { ok: false, error: "수강 명단과 시간표를 확인하지 못했습니다. 다시 시도해 주세요." };
  const [schedules, enrollments, students] = read.data;
  const context = { schedules: schedules.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to })),
    holidays: env.holidays, spans: {} };
  for (const studentId of studentIds) {
    const student = students.find(s => s.id === studentId), windows = enrollments.filter(e => e.student_id === studentId);
    if (!student || !windows.length) return { ok: false, error: "이 반의 수강 학생에게만 목표를 설정할 수 있습니다." };
    context.spans[studentId] = windows.flatMap(e => R.roster.mathSpansOf([{ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true }], student.withdrawn_at)
      .map(span => ({ ...span, attendanceDays: e.attendance_days ?? null })));
    if (!M.plan.learningDays({ ...base, studentId }, context).length)
      return { ok: false, error: "선택한 학생의 목표 기간에 수업이 없습니다. 기간과 시간표를 확인해 주세요." };
  }
  if (value.track === "supplement" && !value.revision && (!value.blockCount || value.blockCount % 4 !== 0))
    return { ok: false, error: "복습 심화 목표는 월 4블록으로 설정해 주세요." };
  const standard = value.blockCount != null;
  const rows = studentIds.map(studentId => ({ tenant_id: t, class_id: classId, student_id: studentId, study_grade: value.studyGrade, start_block: value.startBlock, end_block: value.endBlock,
    start_date: value.startDate, end_date: value.endDate, textbook: value.textbook || null, updated_by: actor.id,
    ...(standard ? { track: value.track, block_count: value.blockCount, end_study_grade: value.endStudyGrade ?? value.studyGrade, milestones: sql.json(value.milestones ?? []),
      plan_revision: value.revision ? sql.json(value.revision) : null } : {}) }));
  const saved = value.mode === "extend"
    ? await write(sql, s => s`update public.math_learning_track_goals set ${s(rows[0])} where tenant_id=${t} and class_id=${classId} and student_id=${studentIds[0]}
        and track=${value.track} and start_date=${value.startDate}::date and ${ISO(s, 'updated_at')} = ${value.updatedAt} returning student_id`)
    : standard
      ? await write(sql, s => s`insert into public.math_learning_track_goals ${s(rows)}`)
      : await write(sql, s => s`insert into public.math_learning_goals ${s(rows)} on conflict (tenant_id, class_id, student_id) do update set
          study_grade=excluded.study_grade, start_block=excluded.start_block, end_block=excluded.end_block, start_date=excluded.start_date, end_date=excluded.end_date,
          textbook=excluded.textbook, updated_by=excluded.updated_by`);
  if (saved.error) return { ok: false, error: saved.error.code === "23505"
    ? "이미 목표가 설정되었습니다. 새로고침 후 목표 확장으로 다음 정거장을 추가해 주세요."
    : ["42P01", "PGRST205"].includes(saved.error.code)
    ? "전체 목표 저장 기능을 아직 사용할 수 없습니다. 관리자에게 알려 주세요."
    : "전체 목표를 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요." };
  if (value.mode === "extend" && !saved.data?.length) return { ok: false, error: "다른 곳에서 목표가 변경되었습니다. 새로고침 후 다시 시도해 주세요." };
  await audit(sql, t, actor, 'mcs_learning_goal_save', 'class', { classId, studentIds, studyGrade: value.studyGrade, endStudyGrade: value.endStudyGrade, milestones: value.milestones,
    startBlock: value.startBlock, endBlock: value.endBlock, startDate: value.startDate, endDate: value.endDate, textbook: value.textbook, track: value.track, blockCount: value.blockCount ?? null },
  gate.access.className);
  return { ok: true };
}

async function setMathClassLearningTrack({ sql, t, R }, actor, [input]) {
  const parsed = z.object({ classId: z.string().uuid(), track: z.enum(["regular", "supplement"]) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "수업 유형을 확인해 주세요." };
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, parsed.data.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { data, error } = await write(sql, s => s`update public.classes set math_learning_track=${parsed.data.track} where tenant_id=${t} and id=${gate.access.classId} returning id`);
  if (error || !data?.length) return { ok: false, error: "수업 유형을 저장하지 못했습니다. 다시 시도해 주세요." };
  await audit(sql, t, actor, 'mcs_class_learning_track', 'class', parsed.data, gate.access.className);
  return { ok: true };
}

const resetSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).min(1).max(100),
  track: z.enum(["regular", "supplement"]).default("regular"),
  /** 지울 계획의 시작일(`YYYY-MM-01`). 표준 계획은 이 날짜까지 맞아야 한 칸만 지운다. */
  startDate: z.string(),
  /** 표준 학습 계획인가 — 저장과 같은 갈래로 표를 고른다(아니면 옛 `math_learning_goals`). */
  standard: z.boolean().default(true),
});

async function resetMathLearningGoals({ sql, t, R }, actor, [input]) {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "초기화할 대상을 확인해 주세요." };
  const value = parsed.data, studentIds = [...new Set(value.studentIds)];
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  // 2.0 canResetMathLearningGoals — 원장(운영자 계정은 저장하는 사람에서 빠져 있다).
  if (actor.systemRole !== 'master') return { ok: false, error: "전체 목표 초기화는 원장만 할 수 있습니다." };
  const { classId } = gate.access;
  const { data, error } = await write(sql, s => s`select public.reset_mcs_learning_goals(${t}::uuid, ${classId}::uuid, ${studentIds}::uuid[], ${value.track}, ${value.startDate}::date, ${value.standard}) removed`);
  if (error) return { ok: false, error: "전체 목표를 초기화하지 못했습니다. 다시 시도해 주세요." };
  const removed = data?.[0]?.removed;
  if (typeof removed !== "number" || !Number.isInteger(removed) || removed < 1) return { ok: false, error: "초기화할 전체 목표가 없습니다." };
  await audit(sql, t, actor, 'mcs_learning_goal_reset', 'class', { classId, studentIds, track: value.track, startDate: value.startDate, standard: value.standard, removed }, gate.access.className);
  return { ok: true, removed };
}

// ── learning-revision-actions.ts ─────────────────────────────────────────────────────────────────────────────────────
const loadSchema = z.object({ classId: z.string().uuid(), studentId: z.string().uuid(), startDate: z.string(), track: z.enum(["regular", "supplement"]) });
const saveSchema = loadSchema.extend({ updatedAt: z.string().min(1), expectedCurrentBlock: z.string().nullable(),
  expectedCurrentDate: z.string().nullable(), textbook: z.string().trim().max(500).nullable(),
  milestones: z.array(z.object({ studyGrade: z.string().min(1).max(60), endBlock: z.string().min(1).max(500),
    endDate: z.string(), blockCount: z.number().int().positive().max(480) })).min(1).max(100) });

/** loadMathLearningGoalRevision — 읽기라 화면 GET(`revision`)도 이걸 부른다. */
export async function loadMathLearningGoalRevision({ sql, t, R, M, env }, actor, input) {
  const parsed = loadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "수정할 목표를 확인해 주세요." };
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, parsed.data.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const today = R.dk.kstToday();
  const month = await mathSheetMonth(sql, t, R, M, env, actor, parsed.data.classId, [today.slice(0, 7), parsed.data.startDate.slice(0, 7)].sort().at(-1));
  if (!month.ok) return { ok: false, error: month.error };
  const learning = await mathLearningData(sql, t, R, M, actor, parsed.data.classId, month.data, { studentId: parsed.data.studentId, forRevision: true });
  const goal = learning.goals[parsed.data.studentId], progress = learning.progress[parsed.data.studentId];
  if (learning.status !== "ok" || !goal || !progress || goal.startDate !== parsed.data.startDate)
    return { ok: false, error: "현재 목표와 진도를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  if (goal.track !== parsed.data.track) return { ok: false, error: "반의 수업 유형이 변경되었습니다. 새로고침 후 현재 목표를 확인해 주세요." };
  if (!goal.blockCount || !goal.updatedAt) return { ok: false, error: "이전 방식으로 저장한 목표는 전체 목표 설정에서 새 계획으로 등록해 주세요." };
  return { ok: true, data: { goal, progress, context: learning.context, today } };
}

async function reviseMathLearningGoal(io, actor, [input]) {
  const { sql, t, R, M, S } = io;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "목표 단원·날짜·구간별 블록 수를 확인해 주세요." };
  const value = parsed.data;
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, value.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const loaded = await loadMathLearningGoalRevision(io, actor, value);
  if (!loaded.ok) return loaded;
  const { goal: previous, progress, context, today } = loaded.data;
  if (previous.updatedAt !== value.updatedAt || progress.currentBlock !== value.expectedCurrentBlock || progress.currentDate !== value.expectedCurrentDate)
    return { ok: false, error: "목표 또는 현재 진도가 변경되었습니다. 창을 다시 열어 최신 계획을 확인해 주세요." };
  const revised = S.revision.reviseLearningGoal(previous, progress, value.milestones, value.textbook, today);
  if (!revised.ok) return revised;
  const goal = revised.goal, days = M.plan.learningDays(goal, context);
  if (!days.length && goal.milestones.some(stop => stop.endDate > today))
    return { ok: false, error: "남은 목표 구간에 수업이 없습니다. 완료 예정일·시간표·수강 기간을 확인해 주세요." };
  const { classId } = gate.access;
  const saved = await write(sql, s => s`update public.math_learning_track_goals set end_study_grade=${goal.endStudyGrade}, end_block=${goal.endBlock}, end_date=${goal.endDate}::date,
      block_count=${goal.blockCount}, milestones=${s.json(goal.milestones)}, textbook=${goal.textbook}, plan_revision=${goal.revision ? s.json(goal.revision) : null}, updated_by=${actor.id}
    where tenant_id=${t} and class_id=${classId} and student_id=${value.studentId} and track=${goal.track ?? "regular"} and start_date=${value.startDate}::date
      and ${ISO(s, 'updated_at')} = ${value.updatedAt} returning student_id`);
  if (saved.error) return { ok: false, error: "남은 계획을 저장하지 못했습니다. 입력한 내용을 유지했으니 다시 시도해 주세요." };
  if (!saved.data?.length) return { ok: false, error: "다른 곳에서 목표가 변경되었습니다. 창을 다시 열어 주세요." };
  await audit(sql, t, actor, 'mcs_learning_goal_revise', 'class', { classId, studentId: value.studentId, startDate: value.startDate, effectiveDate: today,
    previousUpdatedAt: value.updatedAt, milestones: goal.milestones, textbook: goal.textbook }, gate.access.className);
  return { ok: true };
}

// ── textbooks/server/math-assignment-actions.ts ──────────────────────────────────────────────────────────────────────
const assignSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  /** null = 이 자리의 배정 해제(학생이면 반 교재로 돌아간다). */
  textbookId: z.string().uuid().nullable(),
  /** "같은 교재가 이미 있습니다 → 변경" 을 사람이 누른 뒤에만 true. */
  confirmed: z.boolean().optional(),
});

const ASSIGN_NOT_READY = "수학 교재 배정 표가 아직 없습니다 — 마이그레이션(math_textbook_assignments)을 적용해 주세요";

async function saveMathTextbookAssignment({ sql, t, R, S }, actor, [input]) {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "배정할 교재를 다시 골라 주세요." };
  const { classId, studentId, textbookId, confirmed } = parsed.data;
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const slotRes = await write(sql, s => s`select a.id::text id, a.student_id::text student_id, a.textbook_id::text textbook_id, b.title from public.math_textbook_assignments a
    left join public.textbooks b on b.id=a.textbook_id where a.tenant_id=${t} and a.class_id=${classId} and (a.student_id is null ${studentId ? s`or a.student_id=${studentId}` : s``})`);
  if (slotRes.error) return { ok: false, error: ["42P01", "PGRST205"].includes(slotRes.error.code) ? ASSIGN_NOT_READY : "배정 상태를 확인하지 못했습니다. 다시 시도해 주세요." };
  const other = await write(sql, s => Promise.all([
    textbookId ? s`select id::text id, title from public.textbooks where tenant_id=${t} and id=${textbookId} and subject='math' and is_active` : [],
    studentId ? s`select count(*)::int n from public.enrollments where tenant_id=${t} and class_id=${classId} and student_id=${studentId}` : [{ n: 1 }],
  ]));
  if (other.error) return { ok: false, error: "교재·수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  const slots = slotRes.data, [[book], [{ n }]] = other.data;
  if (textbookId && !book) return { ok: false, error: "교재목록에 없는 수학 교재입니다. 새로고침해 주세요." };
  if (!n) return { ok: false, error: "이 반을 수강한 학생이 아닙니다. 새로고침해 주세요." };
  const toBook = r => (r ? { textbookId: r.textbook_id, title: r.title ?? "" } : null);
  const classRow = slots.find(r => r.student_id === null), ownRow = studentId ? slots.find(r => r.student_id === studentId) : classRow;
  const conflict = S.assign.assignmentConflict({ scope: studentId ? "student" : "class", textbookId, classBook: toBook(classRow), studentBook: studentId ? toBook(ownRow) : null });
  if (conflict?.kind === "same-slot") return { ok: true, unchanged: true };
  if (conflict && !confirmed) return { ok: false, conflict };
  if (!textbookId) {
    if (!ownRow) return { ok: true, unchanged: true };
    const { error } = await write(sql, s => s`delete from public.math_textbook_assignments where tenant_id=${t} and id=${ownRow.id}`);
    if (error) return { ok: false, error: "배정을 해제하지 못했습니다. 다시 시도해 주세요." };
  } else if (ownRow) {
    const { error } = await write(sql, s => s`update public.math_textbook_assignments set textbook_id=${textbookId}, updated_by=${actor.id} where tenant_id=${t} and id=${ownRow.id}`);
    if (error) return { ok: false, error: "교재를 바꾸지 못했습니다. 다시 시도해 주세요." };
  } else {
    const { error } = await write(sql, s => s`insert into public.math_textbook_assignments (tenant_id, class_id, student_id, textbook_id, created_by, updated_by)
      values (${t}, ${classId}, ${studentId}, ${textbookId}, ${actor.id}, ${actor.id})`);
    if (error) return { ok: false, error: error.code === "23505" ? "방금 다른 사람이 배정했습니다. 새로고침 후 다시 확인해 주세요." : "교재를 배정하지 못했습니다. 다시 시도해 주세요." };
  }
  await audit(sql, t, actor, 'math_textbook_assign', 'class', { classId, studentId, from: ownRow?.title ?? null, to: book?.title ?? null }, gate.access.className);
  return { ok: true };
}

// ── textbooks/server/math-book-target-actions.ts ─────────────────────────────────────────────────────────────────────
const targetSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid(),
  series: z.string().min(1).max(40),
  /** null = 자동 목표로 되돌리기. */
  targetKey: z.string().min(1).max(80).nullable(),
});
const TARGET_NOT_READY = "목표 교재 저장 표가 아직 없습니다 — 마이그레이션(math_book_targets)을 적용해 주세요";

async function saveMathBookTarget({ sql, t, R, S }, actor, [input]) {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "목표 교재를 다시 골라 주세요." };
  const { classId, studentId, series, targetKey } = parsed.data;
  if (targetKey && S.bookSeq.parseKey(targetKey)?.series !== series) return { ok: false, error: "목표 교재를 다시 골라 주세요." };
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const enr = await write(sql, s => s`select count(*)::int n from public.enrollments where tenant_id=${t} and class_id=${classId} and student_id=${studentId}`);
  if (enr.error) return { ok: false, error: "수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  if (!enr.data[0].n) return { ok: false, error: "이 반을 수강한 학생이 아닙니다. 새로고침해 주세요." };
  const res = targetKey
    ? await write(sql, s => s`insert into public.math_book_targets (tenant_id, student_id, series, target_key, updated_by) values (${t}, ${studentId}, ${series}, ${targetKey}, ${actor.id})
        on conflict (tenant_id, student_id, series) do update set target_key=excluded.target_key, updated_by=excluded.updated_by`)
    : await write(sql, s => s`delete from public.math_book_targets where tenant_id=${t} and student_id=${studentId} and series=${series}`);
  if (res.error) return { ok: false, error: ["42P01", "PGRST205"].includes(res.error.code) ? TARGET_NOT_READY : "목표 교재를 저장하지 못했습니다. 다시 시도해 주세요." };
  await audit(sql, t, actor, 'math_book_target', 'class', { classId, studentId, series, targetKey }, gate.access.className);
  return { ok: true };
}

// ── textbooks/server/school-exam-actions.ts ──────────────────────────────────────────────────────────────────────────
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const examSchema = z.object({
  classId: z.string().uuid(),
  school: z.string().min(1).max(60),
  schoolYear: z.number().int().min(2020).max(2100),
  rows: z.array(z.object({
    term: z.enum(["1-mid", "1-final", "2-mid", "2-final", "2-final-3"]),
    from: DATE.nullable(),
    to: DATE.nullable(),
  })).max(5).refine((rows) => new Set(rows.map((r) => r.term)).size === rows.length),
});
const EXAM_NOT_READY = "학교별 내신기간 표가 아직 없습니다 — 마이그레이션(school_exam_periods)을 적용해 주세요";

async function saveSchoolExamPeriods({ sql, t, R }, actor, [input]) {
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "날짜를 다시 확인해 주세요." };
  const { classId, school, schoolYear, rows } = parsed.data;
  const key = R.school.normalizeSchoolName(school);
  if (!key) return { ok: false, error: "학교를 다시 골라 주세요." };
  const yFrom = `${schoolYear}-03-01`, yTo = `${schoolYear + 1}-02-29`;
  for (const r of rows) {
    if (!!r.from !== !!r.to) return { ok: false, error: "시작일과 끝일을 함께 적거나 둘 다 비워 주세요." };
    if (r.from && r.to && (r.from > r.to || r.from < yFrom || r.to > yTo)) return { ok: false, error: `${schoolYear}학년도(3월~다음 해 2월) 안의 날짜로, 시작일이 끝일보다 앞서게 적어 주세요.` };
  }
  if (!actor) return NO_USER;
  const gate = await mcsClassAccess(sql, t, R, actor, classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  // 그 반 학생의 학교인지 — 지금 수강 중인 학생만(끝난 수강의 학교로는 못 고친다) · 오늘 = KST.
  const today = R.dk.kstToday();
  const enr = await write(sql, s => s`select student_id::text student_id from public.enrollments where tenant_id=${t} and class_id=${classId} and (end_date is null or end_date >= ${today}::date) limit 500`);
  if (enr.error) return { ok: false, error: "수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  const ids = [...new Set(enr.data.map(e => e.student_id))];
  const schoolRes = ids.length ? await write(sql, s => s`select school from public.students where tenant_id=${t} and id = any(${ids}::uuid[])`) : { data: [], error: null };
  if (schoolRes.error) return { ok: false, error: "학생 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  const schools = schoolRes.data;
  if (!schools.some(s => R.school.normalizeSchoolName(s.school) === key)) return { ok: false, error: "이 반 학생의 학교가 아닙니다. 새로고침해 주세요." };
  const keep = rows.filter(r => r.from && r.to), drop = rows.filter(r => !r.from && !r.to).map(r => r.term);
  if (keep.length) {
    const res = await write(sql, s => s`insert into public.school_exam_periods ${s(keep.map(r => ({ tenant_id: t, school_key: key, school_label: school.trim(), school_year: schoolYear, term: r.term,
      from_date: r.from, to_date: r.to, updated_by: actor.id })))} on conflict (tenant_id, school_key, school_year, term) do update set school_label=excluded.school_label,
      from_date=excluded.from_date, to_date=excluded.to_date, updated_by=excluded.updated_by`);
    if (res.error) return { ok: false, error: ["42P01", "PGRST205"].includes(res.error.code) ? EXAM_NOT_READY : "내신기간을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  if (drop.length) {
    const res = await write(sql, s => s`delete from public.school_exam_periods where tenant_id=${t} and school_key=${key} and school_year=${schoolYear} and term = any(${drop})`);
    if (res.error) return { ok: false, error: ["42P01", "PGRST205"].includes(res.error.code) ? EXAM_NOT_READY : "내신기간을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  await audit(sql, t, actor, 'school_exam_periods', 'class', { classId, school, schoolYear, rows }, gate.access.className);
  return { ok: true };
}

// ── math-sheets/server/actions.ts setMyMcsFontSize(ui_prefs.mcs 부분 병합) ──────────────────────────────────────────────
async function setMyMcsFontSize({ sql, t, S }, actor, [raw]) {
  if (!actor) return { ok: false, error: '로그인이 필요합니다' };
  const [row] = await sql`select ui_prefs from public.users where id=${actor.id} and tenant_id=${t}`;
  const raw0 = plain(row?.ui_prefs) ? row.ui_prefs : {}, ns = plain(raw0.mcs) ? { ...raw0.mcs } : {};
  ns.fontSize = S.font.parseMcsFontSize(raw);
  const { error } = await write(sql, s => s`update public.users set ui_prefs=${s.json({ ...raw0, mcs: ns })} where id=${actor.id} and tenant_id=${t}`);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const SHEETS = 'features/math-sheets/server/actions.ts', LEARNING = 'features/math-sheets/server/learning-actions.ts';
const ACTIONS = {
  setMyMcsFontSize: { module: SHEETS, run: setMyMcsFontSize },
  saveMathLearningGoals: { module: LEARNING, run: saveMathLearningGoals },
  setMathClassLearningTrack: { module: LEARNING, run: setMathClassLearningTrack },
  resetMathLearningGoals: { module: LEARNING, run: resetMathLearningGoals },
  reviseMathLearningGoal: { module: 'features/math-sheets/server/learning-revision-actions.ts', run: reviseMathLearningGoal },
  saveMathTextbookAssignment: { module: 'features/textbooks/server/math-assignment-actions.ts', run: saveMathTextbookAssignment },
  saveMathBookTarget: { module: 'features/textbooks/server/math-book-target-actions.ts', run: saveMathBookTarget },
  saveSchoolExamPeriods: { module: 'features/textbooks/server/school-exam-actions.ts', run: saveSchoolExamPeriods },
};

/** 저장하는 사람 = MCS를 볼 수 있는 재직 직원(보는 사람 목록과 같은 판정) — 아니면 null(각 함수가 2.0 첫 거절 문구로 답한다). */
export async function mcsIo(sql, t, importV2) {
  const [R, M, S] = await Promise.all([loadRules(importV2), loadMonthRules(importV2), loadSaveRules(importV2)]);
  const env = await readSettings(sql, t, R);
  return { sql, t, R, M, S, env, viewers: await readViewers(sql, t, R, env) };
}

export const mcsActions = Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, {
  validate: raw => {
    if (!plain(raw) || raw.module !== a.module || !Array.isArray(raw.args) || raw.args.length !== 1 || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
    return { actor: raw.actor ?? null, args: raw.args };
  },
  run: async ({ sql, body, tenantId, importV2 }) => {
    const io = await mcsIo(sql, tenantId, importV2);
    return a.run(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args);
  },
}]));
