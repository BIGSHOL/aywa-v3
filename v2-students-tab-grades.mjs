// 원생 상세 '성적' 탭(2.0 _tabs/grades-tab.tsx) — 탭이 서버에서 읽던 여섯 가지를 Docker 복사본에서 같은 표·같은 조건·같은 조립으로.
// · rows = getStudentUnifiedRows(학생 한 명의 통합 성적 — unified/server/queries.ts getUnifiedGrades의 학생 갈래 + withPreviousScores):
//   성적 입력(student_grades) + 수업보고서 일일·확인테스트(lesson_reports) + 레벨테스트(level_tests)를 한 모양으로 · 반·담임은 그날 명단 판정.
//   원장 화면이라 강사 범위(내 반만) 갈래는 없다. '오늘'(classAnchor) = 복사본 날짜.
// · grades = getStudentGrades(메모) · levelTests = getStudentLevelTests · goals = getStudentGradeGoals(축 일치 → 이름 매칭 폴백) ·
//   comments = getStudentGradeComments · goalViews = goalViewsForRows — 2.0은 보이는 쪽 줄만 계산하지만 화면은 줄 key로 찾으므로 전체 줄을 한 번에 낸다.
// · 복사본에는 학기 축(0283a)·시험 월·시험 없음·목표 축(0291a) 칸이 모두 있다 — 2.0의 '칸 준비' 판정은 모두 '있음'으로 갈린다(시험이 확인).
// · 판정·라벨은 2.0 순수 함수 그대로(gradeKind · testScoresOf · isEnrollmentOnRosterOn · classOrder · withPreviousScores · goalCellKey · goalStatus …). 읽기 전용.

import { readStudentUnifiedRows } from './v2-students-tab-overview.mjs';

const MODULES = { goals: 'features/grades/goals.ts', slots: 'features/grades/exam-slots.ts', term: 'features/grades/term.ts' };
let rulesP = null;
const rules = (load) => (rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; }));

// 통합 성적 줄은 개요 탭 '최근 성적'과 같은 원본(v2-students-tab-overview.mjs readStudentUnifiedRows — 2.0 getStudentUnifiedRows)을 쓴다.
/** getStudentGrades — 모양 = 2.0 StudentGradeRow(점수는 숫자 · 학기 축은 판정을 지난 값만). */
export async function readStudentGrades(sql, t, id, R) {
  const rows = await sql`select id::text id, exam_name, subject, score::float8 score, max_score::float8 max_score, taken_on::text taken_on, notes, school_year, term, exam_slot
    from public.student_grades where tenant_id=${t} and student_id=${id} order by taken_on desc, id`;
  return rows.map((r) => ({ id: r.id, examName: r.exam_name, subject: r.subject, score: r.score == null ? null : Number(r.score), maxScore: r.max_score == null ? null : Number(r.max_score),
    takenOn: r.taken_on, notes: r.notes, schoolYear: r.school_year ?? null, term: R.term.isTerm(r.term) ? r.term : null, examSlot: R.slots.isExamSlot(r.exam_slot) ? r.exam_slot : null }));
}

/** getStudentLevelTests — 모양 = 2.0 LevelTestRow. */
export async function readLevelTests(sql, t, id) {
  const rows = await sql`select id::text id, test_type, subject, tested_on::text tested_on, level, subscores, notes from public.level_tests where tenant_id=${t} and student_id=${id}
    order by tested_on desc, id`;
  return rows.map((r) => ({ id: r.id, testType: r.test_type, subject: r.subject, testedOn: r.tested_on, level: r.level, subscores: r.subscores ?? null, notes: r.notes }));
}

/** grades/server/goals.ts loadGoals — 최신 먼저(목표 축이 판정을 지나야 축). */
async function loadGoals(sql, t, ids, R) {
  if (!ids.length) return [];
  const rows = await sql`select id::text id, student_id::text student_id, subject, exam_name, target_score::float8 target_score, max_score::float8 max_score, reason,
      to_json(created_at)#>>'{}' created_at, school_year, term, exam_slot, exam_month
    from public.grade_goals where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by id`;
  return rows.map((r) => {
    const term = Number(r.term);
    const axis = r.school_year != null && R.term.isTerm(term) && R.slots.isExamSlot(r.exam_slot) ? { year: r.school_year, term, slot: r.exam_slot, month: r.exam_month ?? 0 } : null;
    return { id: r.id, studentId: r.student_id, subject: r.subject, examName: r.exam_name, target: Number(r.target_score), max: r.max_score == null ? null : Number(r.max_score),
      reason: r.reason, createdAt: r.created_at, axis };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** getStudentGradeGoals — 목표 + 실제 점수 대비 상태(축 일치 · 옛 목표만 '시험명__과목' 이름 매칭). */
export async function readGradeGoals(sql, t, id, R) {
  const goals = await loadGoals(sql, t, [id], R);
  if (!goals.length) return [];
  const grades = await sql`select exam_name, subject, to_json(score)#>>'{}' score, to_json(max_score)#>>'{}' max_score, school_year, term, exam_slot, exam_month, no_exam
    from public.student_grades where tenant_id=${t} and student_id=${id}`;
  const byCell = new Map(), byName = new Map();
  for (const g of grades) {
    const cell = { score: g.score == null ? null : Number(g.score), max: g.max_score == null ? null : Number(g.max_score), noExam: g.no_exam === true };
    if (g.school_year != null && g.term != null && g.exam_slot) byCell.set(R.goals.goalCellKey({ subject: g.subject, year: g.school_year, term: g.term, slot: g.exam_slot, month: g.exam_month ?? 0 }), cell);
    byName.set(`${g.exam_name}__${g.subject}`, cell);
  }
  return goals.map((g) => {
    const cellKey = g.axis ? R.goals.goalCellKey({ subject: g.subject, ...g.axis }) : null;
    const cell = (cellKey ? byCell.get(cellKey) : byName.get(`${g.examName}__${g.subject}`)) ?? null;
    const status = R.goals.goalStatus({ target: g.target, max: g.max }, cell);
    return { id: g.id, examId: null, examName: g.axis ? R.goals.goalExamLabel(g.axis) : g.examName, subject: g.subject, targetScore: g.target, maxScore: g.max,
      reason: g.reason, createdAt: g.createdAt, actualScore: cell?.score ?? null, actualMaxScore: cell?.max ?? null,
      achieved: status === 'achieved' ? true : status === 'missed' ? false : null, status, cellKey };
  });
}

/** getStudentGradeComments — 최신 먼저 · 작성자 이름. */
export async function readGradeComments(sql, t, id) {
  const rows = await sql`select c.id::text id, c.category, c.subject, c.content, c.period, c.shared_with_parent, to_json(c.created_at)#>>'{}' created_at, u.display_name author
    from public.grade_comments c left join public.users u on u.id = c.author_id and u.tenant_id = ${t}
    where c.tenant_id=${t} and c.student_id=${id} order by c.created_at desc, c.id`;
  return rows.map((r) => ({ id: r.id, category: r.category, subject: r.subject, content: r.content, period: r.period, sharedWithParent: r.shared_with_parent,
    authorName: r.author ?? null, createdAt: r.created_at }));
}

/** goalViewsForRows — 줄의 칸 키와 목표 축이 정확히 같을 때만 · 목표 조회가 실패해도 표는 선다(빈 표시). */
export async function goalViewsFor(sql, t, rows, R) {
  const keyed = rows.map((r) => ({ r, cell: R.goals.recordCellKey(r) })).filter((x) => x.cell != null);
  if (!keyed.length) return {};
  const goals = await sql.soft((sp) => loadGoals(sp, t, [...new Set(keyed.map((x) => x.r.studentId))], R), null);
  if (!goals) return {};
  const byKey = new Map();
  for (const g of goals) if (g.axis) byKey.set(`${g.studentId}|${R.goals.goalCellKey({ subject: g.subject, ...g.axis })}`, g);
  const out = {};
  for (const { r, cell } of keyed) {
    const g = byKey.get(`${r.studentId}|${cell}`);
    if (g) out[r.key] = { target: g.target, max: g.max, status: R.goals.goalStatus({ target: g.target, max: g.max }, { score: r.score, max: r.maxScore, noExam: r.noExam }) };
  }
  return out;
}

export async function loadTab({ base, sql, t, id, settings, importV2 }) {
  const R = await rules(importV2);
  const rows = await readStudentUnifiedRows(base, id);
  const grades = await readStudentGrades(sql, t, id, R);
  const levelTests = await readLevelTests(sql, t, id);
  const goals = await readGradeGoals(sql, t, id, R);
  const comments = await readGradeComments(sql, t, id);
  const goalViews = await goalViewsFor(sql, t, rows, R);
  return { rows, grades, levelTests, settings: { operations: { subjects: settings.operations.subjects } }, goals, comments, goalViews };
}
