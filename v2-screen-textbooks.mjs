// 2.0 화면 — 교재목록(V2-SCREENS.md 대상 `textbooks`). 그리기는 2.0의 실제 React 부품(v2-host/src/textbooks*.tsx),
// 이 모듈은 2.0 app/(shell)/textbooks/page.tsx가 서버에서 하던 조회를 Docker 복사본에서 같은 결과로 만든다:
//  · features/textbooks/server/queries.ts getTextbooks(교재 면 — 한 쪽 50권 · 차수 채움 · 배정 수) · getClassTextbookPlans(영어 반 배정 면)
//  · math-assignment-queries.ts getMathAssignmentList(수학 반 배정 면) · 쓰기·엑셀 자격(canWriteTenant · canManageTenant)
// 사람마다 보이는 것이 다르다(강사 = 읽기 전용 · 반 배정은 강사 시트 담당 범위) — '보는 사람'을 고르고(MCS·ECS와 같은 방식 · 운영자 계정 제외 · 원장 먼저)
// 그 사람의 권한 표로 2.0과 같게 낸다. 표지 그림은 파일 저장소(복사본 밖)에 있어 싣지 않는다(표지 칸은 비어 보인다).
// 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { UUID, loadRules, readSettings, readViewers, editorsOf } from './v2-mcs-core.mjs';
import { loadRules as loadEcsRules } from './v2-ecs-core.mjs';
import { visibleClassFilter as ecsVisibleClassFilter } from './v2-ecs-props.mjs';
import { textbooksActions, textbooksIo, loadTextbookDetail } from './v2-textbooks-save.mjs';
import { classAccess } from './v2-ecs-core.mjs';
import { serverFn } from './v2-ecs-save.mjs';
import { previewLoaded } from './v2-ecs-textbooks.mjs';
import { PLAN_UNDO_ACTIONS } from './v2-ecs-plan-undo.mjs';

const ID = 'textbooks';
const PAGE_SIZE = 50;

let rulesPromise = null;
function loadTextbookRules(importV2) {
  rulesPromise ??= (async () => {
    const [faces, pace] = await Promise.all(['features/textbooks/faces.ts', 'features/textbooks/lesson-schedule.ts'].map(p => importV2(p)));
    return { faces, pace };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** 2.0 isMissingTextbookTable 판정(표 없음 → 'missing-table') · 그 밖 실패 → 'failed'. */
const classify = e => (e?.code === '42P01' ? 'missing-table' : 'failed');
const iso = v => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(v).toISOString());

// ── queries.ts getTextbooks ─────────────────────────────────────────────────────────────────────────────────────────
export async function readTextbooks(sql, t, opts) {
  const page = Math.max(1, opts.page ?? 1), from = (page - 1) * PAGE_SIZE;
  // 2.0: 콤마·괄호는 떼고 %·_·\는 글자로(ilike 와일드카드 escape).
  const safe = (opts.q ?? '').trim().replace(/[,()]/g, ' ').replace(/[%_\\]/g, c => `\\${c}`).trim();
  const where = sql`tenant_id=${t} ${opts.id ? sql`and id=${opts.id}` : sql``} ${opts.subject ? sql`and subject=${opts.subject}` : sql``} ${opts.skillArea ? sql`and skill_area=${opts.skillArea}` : sql``}
    ${safe ? sql`and title ilike ${`%${safe}%`}` : sql``}`;
  let rows, total;
  try {
    [rows, [{ n: total }]] = await sql.savepoint(s => Promise.all([
      s`select id::text id, subject, skill_area, title, page_time, session_count, grade_term, cover_path, updated_at from public.textbooks where ${where}
        order by skill_area asc nulls last, title asc offset ${from} limit ${PAGE_SIZE}`,
      s`select count(*)::int n from public.textbooks where ${where}`,
    ]));
  } catch (e) { return { status: classify(e), rows: [], total: null, page, pageSize: PAGE_SIZE }; }
  const ids = rows.map(r => r.id);
  const [lessons, plans] = ids.length === 0 ? [[], []] : await Promise.all([
    sql.savepoint(s => s`select textbook_id::text textbook_id, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id = any(${ids}::uuid[])`).catch(() => null),
    opts.subject === 'math'
      // 수학은 ECS 배정이 아니라 반·학생 교재 배정을 센다(자리 수).
      ? sql.savepoint(s => s`select textbook_id::text textbook_id from public.math_textbook_assignments where tenant_id=${t} and textbook_id = any(${ids}::uuid[])`).catch(() => null)
      : sql.savepoint(s => s`select textbook_id::text textbook_id from public.class_textbook_plans where tenant_id=${t} and is_active and textbook_id = any(${ids}::uuid[])`).catch(() => null),
  ]);
  const filled = new Map(), planCount = new Map();
  for (const l of lessons ?? []) { if (!(l.progress ?? '').trim() && !(l.homework ?? '').trim()) continue; filled.set(l.textbook_id, (filled.get(l.textbook_id) ?? 0) + 1); }
  for (const p of plans ?? []) planCount.set(p.textbook_id, (planCount.get(p.textbook_id) ?? 0) + 1);
  return { status: 'ok', total, page, pageSize: PAGE_SIZE, rows: rows.map(r => ({
    id: r.id, subject: r.subject, skillArea: r.skill_area, title: r.title, pageTime: r.page_time, sessionCount: Number(r.session_count ?? 0), gradeTerm: r.grade_term ?? null,
    coverPath: r.cover_path, updatedAt: iso(r.updated_at),
    coverUrl: null, // 표지 = 파일 저장소(복사본 밖)
    filledLessons: lessons === null ? null : (filled.get(r.id) ?? 0), planCount: plans === null ? null : (planCount.get(r.id) ?? 0) })) };
}

// ── queries.ts getClassTextbookPlans({}) — 영어 반 배정 면(보는 사람의 강사 시트 범위) ────────────────────────────────────
export async function readClassTextbookPlans(sql, t, X, viewer, today) {
  const scope = await ecsVisibleClassFilter(sql, t, X.ecs, viewer, null, today);
  if (scope.classIds !== null && scope.classIds.length === 0) return { status: 'ok', rows: [] };
  let plans;
  try {
    plans = await sql.savepoint(s => s`select id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode, start_date::text start_date, start_lesson_no,
        is_active, last_applied_at, slot_picks from public.class_textbook_plans where tenant_id=${t} and is_active
        ${scope.classIds === null ? s`` : s`and class_id = any(${scope.classIds}::uuid[])`} order by start_date desc, id`);
  } catch (e) { return { status: classify(e), rows: [] }; }
  if (plans.length === 0) return { status: 'ok', rows: [] };
  const classIds = [...new Set(plans.map(p => p.class_id))], bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [classes, books] = await Promise.all([
    sql`select id::text id, class_name from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select id::text id, title, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])`,
  ]);
  const className = new Map(classes.map(c => [c.id, c.class_name])), bookById = new Map(books.map(b => [b.id, b]));
  return { status: 'ok', rows: plans.map(p => {
    const book = bookById.get(p.textbook_id);
    return { id: p.id, classId: p.class_id, className: className.get(p.class_id) ?? '(삭제된 반)', textbookId: p.textbook_id, textbookTitle: book?.title ?? '(삭제된 교재)',
      skillArea: book?.skill_area ?? null, sessionCount: Number(book?.session_count ?? 0), slotAxis: p.slot_axis === 'jj' ? 'jj' : 'class',
      slotPicks: Array.isArray(p.slot_picks) && p.slot_picks.length > 0 ? p.slot_picks.map(String) : null, pace: X.tb.pace.normalizeLessonPace(p.pace),
      termMode: p.term_mode === 'exam' ? 'exam' : 'regular', startDate: p.start_date, startLessonNo: Number(p.start_lesson_no ?? 1), isActive: p.is_active, lastAppliedAt: iso(p.last_applied_at) };
  }) };
}

// ── math-assignment-queries.ts getMathAssignmentList ──────────────────────────────────────────────────────────────
export async function readMathAssignmentList(sql, t) {
  try {
    const rows = await sql.savepoint(s => s`select a.id::text id, a.class_id::text class_id, a.updated_at, c.class_name, st.name student_name, b.title
      from public.math_textbook_assignments a left join public.classes c on c.id=a.class_id left join public.students st on st.id=a.student_id left join public.textbooks b on b.id=a.textbook_id
      where a.tenant_id=${t} order by a.updated_at desc, a.id asc`);
    return { status: 'ok', rows: rows.map(r => ({ id: r.id, classId: r.class_id, className: r.class_name ?? '—', studentName: r.student_name ?? null, title: r.title ?? '—', updatedAt: iso(r.updated_at) })) };
  } catch (e) { return { status: classify(e), rows: [] }; }
}

// ── 반 배정 면의 저장 — 2.0 plan-actions.ts deleteClassTextbookPlan · plan-delete-actions.ts undoPlanDelete · previewTextbookApply ──────────
// 이 셋은 교재 마스터가 아니라 그 반의 강사 시트 계획 줄을 바꾸는 일이라 2.0 게이트가 강사 시트(그 반 쓰기)다 — 강사 시트 화면이 이미 옮긴 것
// (v2-ecs-plan-undo.mjs · v2-ecs-textbooks.mjs previewLoaded, 저장하는 사람 = 강사 시트를 쓸 수 있는 직원)을 그대로 쓴다.
const PLAN_MODULE = 'features/textbooks/server/plan-actions.ts';
const PLAN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 2.0 loadPlan(planId, { write: false }) — 배정 한 건 + 그 반 강사 시트 게이트(반 id는 DB 행에서) · 교재목록 기능(v2-ecs-plan-undo loadPlan과 같은 모양). */
async function loadPlanForPreview(ctx, planId) {
  const { sql, t, R, env, user } = ctx;
  const [row] = typeof planId === 'string' && PLAN_UUID.test(planId) ? await sql`select id::text id, tenant_id::text tenant_id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode,
      start_date::text start_date, start_lesson_no, slot_picks from public.class_textbook_plans where id=${planId}` : [];
  if (!row) return { error: '배정을 찾을 수 없습니다' };
  const gate = await classAccess(sql, t, R, env, user, row.class_id, { write: false });
  if (!gate.ok) return { error: gate.error };
  if (row.tenant_id !== t) return { error: '배정을 찾을 수 없습니다' };
  if (!env.textbooksOn) return { error: '이 학원은 교재목록 기능이 꺼져 있습니다' };
  return { gate, plan: { id: row.id, classId: row.class_id, textbookId: row.textbook_id, axis: row.slot_axis === 'jj' ? 'jj' : 'class', pace: R.normalizeLessonPace(row.pace),
    termMode: row.term_mode === 'exam' ? 'exam' : 'regular', startDate: row.start_date, startLessonNo: Number(row.start_lesson_no ?? 1),
    slotPicks: Array.isArray(row.slot_picks) && row.slot_picks.length > 0 ? R.normalizeSlotPicks(row.slot_picks.map(String)) : null } };
}
const PLAN_ACTIONS = {
  deleteClassTextbookPlan: PLAN_UNDO_ACTIONS.deleteClassTextbookPlan,
  undoPlanDelete: PLAN_UNDO_ACTIONS.undoPlanDelete,
  /** previewTextbookApply(planId) — 저장 없음(미리보기). */
  previewTextbookApply: serverFn(PLAN_MODULE, 1, async (ctx, planId) => {
    const loaded = await loadPlanForPreview(ctx, planId);
    if ('error' in loaded) return { ok: false, error: loaded.error };
    return previewLoaded(ctx, loaded, planId);
  }),
};

export const screen = {
  id: ID, label: '교재목록', order: 8,
  params: { viewer: UUID, detail: UUID, textbook: UUID, tab: /^[a-z]{1,10}$/, subject: /^[a-z]{1,10}$/, area: /^[a-z0-9_]{1,40}$/, q: /^[^\u0000-\u001f]{0,100}$/, page: /^\d{1,4}$/ },
  // 저장 = 교재 마스터(v2-textbooks-save.mjs) + 반 배정 면(지우기 · 되돌리기 · 미리보기 — 강사 시트 게이트) — 저장하는 사람 = 보는 사람.
  actions: { ...textbooksActions, ...PLAN_ACTIONS },
  load: async ({ sql, params: sp, tenantId: t, importV2 }) => {
    // 교재 다이얼로그가 열 때 읽는 2.0 loadTextbookDetail(읽기라 GET) — 답은 2.0 반환 모양 그대로.
    if (sp.detail) { const io = await textbooksIo(sql, t, importV2); return loadTextbookDetail(io, io.viewers.find(v => v.id === sp.viewer) ?? null, sp.detail); }
    const [R, tb, ecs] = await Promise.all([loadRules(importV2), loadTextbookRules(importV2), loadEcsRules(importV2)]);
    const env = await readSettings(sql, t, R), viewers = await readViewers(sql, t, R, env, 'textbooks');
    const viewer = viewers.find(v => v.id === sp.viewer) ?? viewers[0] ?? null;
    const common = { editors: editorsOf(viewers), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      host: { operations: env.operations, disabledModules: env.disabled } };
    if (!viewer) return { ...common, route: 'none' };
    const [focusedBook] = sp.textbook
      ? await sql`select id::text id, subject from public.textbooks where tenant_id=${t} and id=${sp.textbook}`
      : [];
    const tab = focusedBook ? 'books' : tb.faces.resolveTextbookTab(sp.tab);
    const subject = focusedBook ? tb.faces.resolveTextbookSubject(focusedBook.subject) : tb.faces.resolveTextbookSubject(sp.subject), today = R.dk.kstToday();
    const [list, plans, mathPlans] = await Promise.all([
      readTextbooks(sql, t, focusedBook
        ? { id: focusedBook.id, subject, page: 1 }
        : { subject, skillArea: sp.area ?? null, q: sp.q ?? null, page: Number(sp.page ?? 1) || 1 }),
      tab === 'plans' && subject === 'english' ? readClassTextbookPlans(sql, t, { ecs, tb }, viewer, today) : { status: 'ok', rows: [] },
      tab === 'plans' && subject === 'math' ? readMathAssignmentList(sql, t) : null,
    ]);
    return { ...common, route: 'page',
      // 2.0 canWriteTenant(쓰기 = full|scoped) · canManageTenant(엑셀로 넣기 = full) — 보는 사람의 권한 표로.
      canWrite: viewer.level === 'full' || viewer.level === 'scoped', canImport: viewer.level === 'full', list, plans, mathPlans,
      focusTextbook: focusedBook && list.status === 'ok' ? { id: focusedBook.id, subject } : null };
  },
};
