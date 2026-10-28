// 2.0 화면 — 교재목록 저장(1단계): 교재 마스터 = 2.0 features/textbooks/server/actions.ts saveTextbook · deleteTextbook · saveTextbookLessons를 Docker 복사본에,
// 그리고 다이얼로그가 열 때 읽는 loadTextbookDetail(읽기 — 화면 GET `detail`, 속은 queries.ts getTextbookDetail).
// 판정 순서·문구·반환 모양·감사로그 이름(textbook_create · textbook_update · textbook_delete · textbook_lessons_save)은 2.0 그대로.
// 게이트 = 2.0 requireTextbookWrite(canWriteTenant('textbooks') — full|scoped)를 '저장하는 사람'(= 보는 사람)으로 · 읽기는 canAccessTenant(none이 아니면).
// 2.0은 이 저장을 서비스 키(RLS 우회)로 한다 — 복사본 접속도 같은 결이고, 모든 쿼리에 tenant_id를 직접 건다.
// ⚠️ 표지 사진(파일 저장소 · cover-actions.ts)은 복사본 밖이라 옮기지 않는다 — 올리기·지우기는 호스트가 '아직 지원하지 않는 저장'으로 답하고,
//    교재 삭제의 표지 파일 지우기(2.0도 best-effort)는 건너뛴다.
import { V2Error } from './v2-screens.mjs';
import { audit } from './v2-timetable-save.mjs';
import { UUID, loadRules, readSettings, readViewers } from './v2-mcs-core.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

let saveRules = null;
function loadSaveRules(importV2) {
  saveRules ??= (async () => {
    const [grade, dbError] = await Promise.all(['features/textbooks/grade-term.ts', 'lib/supabase/db-error.ts'].map(p => importV2(p)));
    return { grade, dbError };
  })().catch(error => { saveRules = null; throw error; });
  return saveRules;
}

const write = async (sql, fn) => { try { return { data: await sql.savepoint(fn), error: null }; } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '', details: e?.detail ?? null, hint: e?.hint ?? null, constraint: e?.constraint_name ?? null } }; } };
const iso = v => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(v).toISOString());

// ── access.ts ────────────────────────────────────────────────────────────────────────────────────────────────────────
const TEXTBOOKS_NOT_READY = "교재목록 표가 아직 만들어지지 않았습니다 — 마이그레이션 0266a를 적용해 주세요";
const GRADE_TERM_NOT_READY = "학년·학기 칸이 아직 준비되지 않았습니다(SQL 적용 필요) — 학년 없이 저장하거나 잠시 후 다시 시도하세요";
const isMissingTextbookTable = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || (/textbooks|textbook_lessons|class_textbook_plans|ecs_apply_textbook_lessons/.test(e.message ?? '') && /not find|does not exist|schema cache/i.test(e.message ?? '')));
const isMissingGradeTermColumn = e => !!e && (e.code === '42703' || e.code === 'PGRST204' || /grade_term/.test(e.message ?? ''));
/** 2.0 friendlyTextbookError — PostgREST 오류 → 한글(공용 explainDbError로 제약 이름 판정). */
function friendlyTextbookError(S, error, fallback, duplicate) {
  if (isMissingTextbookTable(error)) return TEXTBOOKS_NOT_READY;
  const why = S.dbError.explainDbError(error, { scope: 'textbooks', fallback, context: { action: fallback } });
  if (error.code === '23505') return duplicate ?? (why.specific ? why.message : '이미 같은 이름의 교재가 있습니다');
  if (why.specific) return why.message;
  if (error.code === '23503') return '다른 기록이 참조하고 있어 처리할 수 없습니다';
  if (error.code === '23514') return '입력 값이 규칙에 맞지 않습니다(길이·형식을 확인하세요)';
  return why.message;
}
/** 2.0 requireTextbookWrite. */
const requireWrite = actor => (!actor ? { error: '로그인이 필요합니다' } : actor.level === 'full' || actor.level === 'scoped' ? actor : { error: '교재목록을 수정할 권한이 없습니다' });

// ── actions.ts ───────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_SESSION_COUNT = 200, MAX_TEXT = 500;
const norm = (v, max) => { if (v == null) return null; const t = String(v).trim(); return t === '' ? null : t.slice(0, max); };

async function saveTextbook({ sql, t, S }, actor, [input]) {
  const ctx = requireWrite(actor);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!plain(input)) throw bad();
  const title = norm(input.title, 120);
  if (!title) return { ok: false, error: '교재이름을 입력하세요' };
  const subject = norm(input.subject, 24) ?? 'english', skillArea = norm(input.skillArea, 24);
  if (skillArea !== null && !/^[a-z0-9_]{1,24}$/.test(skillArea)) return { ok: false, error: '구분 값이 올바르지 않습니다' };
  const sessionCount = Number.isFinite(input.sessionCount) ? Math.max(0, Math.min(MAX_SESSION_COUNT, Math.trunc(input.sessionCount))) : 0;
  const rawGrade = subject === 'math' ? norm(input.gradeTerm, 8) : null, gradeTerm = S.grade.validGradeTerm(rawGrade);
  if (rawGrade !== null && gradeTerm === null) return { ok: false, error: '학년·학기 값이 올바르지 않습니다' };
  const base = { subject, skill_area: skillArea, title, page_time: norm(input.pageTime, 40), session_count: sessionCount, updated_by: ctx.id };
  const payload = { ...base, grade_term: gradeTerm };
  const missingGrade = e => isMissingGradeTermColumn(e) && !(e && (e.code === '42P01' || e.code === 'PGRST205'));
  if (input.id) {
    if (typeof input.id !== 'string' || !UUID.test(input.id)) throw bad();
    let { error } = await write(sql, s => s`update public.textbooks set ${s(payload)} where tenant_id=${t} and id=${input.id}`);
    if (missingGrade(error)) {
      if (gradeTerm !== null) return { ok: false, error: GRADE_TERM_NOT_READY };
      ({ error } = await write(sql, s => s`update public.textbooks set ${s(base)} where tenant_id=${t} and id=${input.id}`));
    }
    if (error) return { ok: false, error: friendlyTextbookError(S, error, '교재를 수정하지 못했습니다') };
    await audit(sql, t, actor, 'textbook_update', 'textbook', { id: input.id }, title);
    return { ok: true, id: input.id };
  }
  const insert = row => write(sql, s => s`insert into public.textbooks ${s({ ...row, tenant_id: t, created_by: ctx.id })} returning id::text id`);
  let { data, error } = await insert(payload);
  if (missingGrade(error)) {
    if (gradeTerm !== null) return { ok: false, error: GRADE_TERM_NOT_READY };
    ({ data, error } = await insert(base));
  }
  if (error || !data?.[0]) return { ok: false, error: friendlyTextbookError(S, error ?? {}, '교재를 등록하지 못했습니다', '이미 같은 이름의 교재가 있습니다') };
  await audit(sql, t, actor, 'textbook_create', 'textbook', { id: data[0].id }, title);
  return { ok: true, id: data[0].id };
}

async function deleteTextbook({ sql, t, S }, actor, [id]) {
  const ctx = requireWrite(actor);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (typeof id !== 'string') throw bad();
  const read = await write(sql, s => s`select title, cover_path from public.textbooks where tenant_id=${t} and id=${UUID.test(id) ? id : null}`);
  if (read.error) return { ok: false, error: friendlyTextbookError(S, read.error, '교재를 찾지 못했습니다') };
  const before = read.data[0];
  if (!before) return { ok: false, error: '교재를 찾을 수 없습니다' };
  const { error } = await write(sql, s => s`delete from public.textbooks where tenant_id=${t} and id=${id}`);
  if (error) return { ok: false, error: friendlyTextbookError(S, error, '교재를 삭제하지 못했습니다') };
  // 표지 파일(저장소) 지우기는 건너뛴다 — 복사본 밖(2.0도 실패해도 넘어가는 best-effort).
  await audit(sql, t, actor, 'textbook_delete', 'textbook', { id }, before.title ?? null);
  return { ok: true };
}

async function saveTextbookLessons({ sql, t, S }, actor, [textbookId, patches]) {
  const ctx = requireWrite(actor);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  if (!Array.isArray(patches) || patches.length === 0) return { ok: true };
  if (patches.length > MAX_SESSION_COUNT) return { ok: false, error: '한 번에 저장할 수 있는 차수를 넘었습니다' };
  if (typeof textbookId !== 'string') throw bad();
  const own = await write(sql, s => s`select id::text id, title from public.textbooks where tenant_id=${t} and id=${UUID.test(textbookId) ? textbookId : null}`);
  if (own.error) return { ok: false, error: friendlyTextbookError(S, own.error, '교재를 찾지 못했습니다') };
  const owner = own.data[0];
  if (!owner) return { ok: false, error: '교재를 찾을 수 없습니다' };
  const clean = patches.map(p => ({ lessonNo: Math.trunc(Number(p?.lessonNo)), progress: norm(p?.progress, MAX_TEXT), homework: norm(p?.homework, MAX_TEXT) }))
    .filter(p => Number.isFinite(p.lessonNo) && p.lessonNo >= 1 && p.lessonNo <= MAX_SESSION_COUNT);
  const empties = clean.filter(p => p.progress === null && p.homework === null).map(p => p.lessonNo);
  const upserts = clean.filter(p => p.progress !== null || p.homework !== null);
  if (empties.length > 0) {
    const { error } = await write(sql, s => s`delete from public.textbook_lessons where tenant_id=${t} and textbook_id=${textbookId} and lesson_no = any(${empties}::int[])`);
    if (error) return { ok: false, error: friendlyTextbookError(S, error, '차수를 비우지 못했습니다') };
  }
  if (upserts.length > 0) {
    const rows = upserts.map(p => ({ tenant_id: t, textbook_id: textbookId, lesson_no: p.lessonNo, progress: p.progress, homework: p.homework, updated_by: ctx.id }));
    const { error } = await write(sql, s => s`insert into public.textbook_lessons ${s(rows)} on conflict (tenant_id, textbook_id, lesson_no) do update set
      progress=excluded.progress, homework=excluded.homework, updated_by=excluded.updated_by`);
    if (error) return { ok: false, error: friendlyTextbookError(S, error, '차수를 저장하지 못했습니다') };
  }
  await audit(sql, t, actor, 'textbook_lessons_save', 'textbook', { id: textbookId, saved: upserts.length, cleared: empties.length }, owner.title);
  return { ok: true };
}

/** loadTextbookDetail(id) — 읽기 게이트는 메뉴 접근(readonly도 차수 표를 본다) · 속은 getTextbookDetail. 화면 GET(detail)이 부른다. */
export async function loadTextbookDetail({ sql, t }, actor, id) {
  if (!actor) return { ok: false, error: '로그인이 필요합니다' };
  if (actor.level === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  let one;
  try {
    one = await sql.savepoint(s => s`select id::text id, subject, skill_area, title, page_time, session_count, grade_term, cover_path, updated_at from public.textbooks where tenant_id=${t} and id=${id}`);
  } catch (e) { return { ok: true, status: isMissingTextbookTable(e) ? 'missing-table' : 'failed', detail: null }; }
  const r = one[0];
  if (!r) return { ok: true, status: 'ok', detail: null };
  const textbook = { id: r.id, subject: r.subject, skillArea: r.skill_area, title: r.title, pageTime: r.page_time, sessionCount: Number(r.session_count ?? 0), gradeTerm: r.grade_term ?? null,
    coverPath: r.cover_path, updatedAt: iso(r.updated_at) };
  const rows = await sql`select lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id=${id} order by lesson_no limit 200`;
  const stored = new Map(rows.map(l => [Number(l.lesson_no), { lessonNo: Number(l.lesson_no), progress: l.progress, homework: l.homework }]));
  // 차수 표는 1..sessionCount 전부(빈 칸도) · 차수 수를 줄인 뒤 남은 옛 행은 뒤에 붙인다(2.0 그대로).
  const lessons = [];
  for (let n = 1; n <= textbook.sessionCount; n += 1) lessons.push(stored.get(n) ?? { lessonNo: n, progress: null, homework: null });
  for (const [n, row] of [...stored].sort((a, b) => a[0] - b[0])) if (n > textbook.sessionCount) lessons.push(row);
  return { ok: true, status: 'ok', detail: { textbook, coverUrl: null, lessons } }; // 표지 = 파일 저장소(복사본 밖)
}

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const MODULE = 'features/textbooks/server/actions.ts';
const ACTIONS = { saveTextbook: { run: saveTextbook, arity: 1 }, deleteTextbook: { run: deleteTextbook, arity: 1 }, saveTextbookLessons: { run: saveTextbookLessons, arity: 2 } };

/** 저장하는 사람 = 교재목록을 볼 수 있는 재직 직원(보는 사람 목록과 같은 판정). */
export async function textbooksIo(sql, t, importV2) {
  const [R, S] = await Promise.all([loadRules(importV2), loadSaveRules(importV2)]);
  const env = await readSettings(sql, t, R);
  return { sql, t, R, S, env, viewers: await readViewers(sql, t, R, env, 'textbooks') };
}

export const textbooksActions = Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, {
  validate: raw => {
    if (!plain(raw) || raw.module !== MODULE || !Array.isArray(raw.args) || raw.args.length !== a.arity || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
    return { actor: raw.actor ?? null, args: raw.args };
  },
  run: async ({ sql, body, tenantId, importV2 }) => {
    const io = await textbooksIo(sql, tenantId, importV2);
    return a.run(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args);
  },
}]));
