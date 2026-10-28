// 2.0 화면 · 강사 시트(ECS) — 교재 배정 지우기·되돌리기 넷(2.0 서버 액션과 같은 이름·인자·반환·감사로그):
//   textbooks/server/plan-actions.ts        deleteClassTextbookPlan(planId, { withLines, skipHistory })  배정 행 · (withLines) 그 교재 진도 줄 · 미룸 표식 · 히스토리   textbook_plan_delete
//   textbooks/server/plan-delete-actions.ts undoPlanDelete({ classId, plan, lines?, historyId? })      배정 되살림 · 지운 줄 되돌림(restoreShiftState)                    textbook_plan_delete_undo
//   textbooks/server/import-undo-actions.ts undoPlanImport({ classId, batchId, latestOnly? })          반영 되돌리기(뒤 반영부터 그 시점까지 · 배정도 지움)                textbook_plan_import_undo
//   textbooks/server/shift-undo-actions.ts  undoLessonShift({ classId, token, historyId? })            미룸·당김 되돌리기(restoreShiftState)                              textbook_lesson_shift_undo
// 밑바닥은 2.0 server 폴더의 clearPlanLines(plan-delete-lines.ts) · restoreShiftState·validToken(shift-undo-core.ts) · writeMarker(shift-markers.ts) ·
// claimHistory·releaseHistory·loadRecentImports·loadImportBatch·recordHistoryEntry(import-batch.ts)를 같은 순서로 옮겼고, 판정은 2.0 순수 함수(plan-delete.ts ·
// lesson-relay.ts · shift-undo.ts · shift-key.ts · import-undo.ts · plan-siblings.ts · lesson-schedule.ts)를 그대로 쓴다.
// 2.0과 다른 것(이유): DB가 거절하면 저장점 안에서 되돌리고 같은 문구로 알린다(2.0은 그때까지의 쓰기가 남는다). undoLessonShift는 그 주 칸(cells)을
// 돌려주지 않는다(2.0도 그 조회가 실패하면 비운다 — 화면은 새로고침으로 다시 받는다).
import { classAccess, isoAt, rulesSync } from './v2-ecs-core.mjs';
import { audit, serverFn } from './v2-ecs-save.mjs';
import { friendlyTextbookError, tryWrite } from './v2-ecs-textbooks.mjs';

const MODULE = { plan: 'features/textbooks/server/plan-actions.ts', deleteUndo: 'features/textbooks/server/plan-delete-actions.ts',
  importUndo: 'features/textbooks/server/import-undo-actions.ts', shiftUndo: 'features/textbooks/server/shift-undo-actions.ts' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, YMD = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^[0-2]\d:[0-5]\d$/, SKILL = /^[a-z0-9_]{1,24}$/, MAX_ROWS = 3000;
const str = v => (typeof v === 'string' ? v : '');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const LINE_COLS = 'id, plan_date, slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework';
const lineCols = sql => sql`id::text id, plan_date::text plan_date, slot_start::text slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework`;
const markerCols = sql => sql`id::text id, class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos`;

// ── 2.0 import-batch.ts — 히스토리 표(class_plan_import_batches) ──
async function claimHistory(sql, t, classId, id, actorId) {
  const rows = await sql`update public.class_plan_import_batches set undone_at=now(), undone_by=${actorId} where tenant_id=${t} and class_id=${classId} and id=${id} and undone_at is null returning id`;
  return rows.length > 0 ? 'ok' : 'taken';
}
const releaseHistory = (sql, t, id) => sql`update public.class_plan_import_batches set undone_at=null, undone_by=null where tenant_id=${t} and id=${id}`;
async function recordHistoryEntry(sql, t, { classId, date, actorId, meta, count }) {
  const [row] = await sql`insert into public.class_plan_import_batches (tenant_id, class_id, period_from, period_to, rows, row_count, created_by)
    values (${t}, ${classId}, ${date}, ${date}, ${sql.json([meta])}, ${count}, ${actorId}) returning id::text id`;
  return row?.id ?? undefined;
}

// ── 2.0 shift-markers.ts writeMarker — 칸·줄 표식 한 개(없음 = 지움, 있으면 upsert) ──
async function writeMarker(sql, t, R, classId, key, kind, actor) {
  const p = R.parseMarkerKey(key);
  if (!p) throw new Error('invalid marker key');
  if (kind === null) { await sql`delete from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date=${p.date} and slot_start=${p.slot} and lane=${p.lane} and pos=${p.pos}`; return; }
  await sql`insert into public.class_lesson_shifts (tenant_id, class_id, plan_date, slot_start, lane, pos, kind, created_by, updated_at) values (${t}, ${classId}, ${p.date}, ${p.slot}, ${p.lane}, ${p.pos}, ${kind}, ${actor}, now())
    on conflict (tenant_id, class_id, plan_date, slot_start, lane, pos) do update set kind=excluded.kind, created_by=excluded.created_by, updated_at=excluded.updated_at`;
}

// ── PORTED: 2.0 shift-undo-core.ts validLine · validToken(원문 그대로 — verify가 비교) ──
function validLine(v) {
  if (!v || typeof v !== "object") return false;
  const l = v;
  const text = (x) => x === null || (typeof x === "string" && x.length <= 500);
  return (
    typeof l.id === "string" &&
    UUID.test(l.id) &&
    typeof l.plan_date === "string" &&
    YMD.test(l.plan_date) &&
    typeof l.slot_start === "string" &&
    HHMM.test(l.slot_start) &&
    (l.term_mode === "regular" || l.term_mode === "exam") &&
    typeof l.skill_area === "string" &&
    SKILL.test(l.skill_area) &&
    Number.isInteger(l.line_no) &&
    (l.line_no) >= 1 &&
    (l.line_no) <= 20 &&
    text(l.textbook) &&
    text(l.page_range) &&
    text(l.progress) &&
    text(l.homework)
  );
}
const validKind = (v) => v === null || v === "skip" || v === "advance";
/** 2.0 shift-key.ts parseMarkerKey(불러온 것) — 아래 옮긴 본문이 원문과 같은 이름으로 부른다. */
const parseMarkerKey = key => rulesSync.parseMarkerKey(key);
export function validToken(t, classId) {
  if (!t || typeof t !== "object") return false;
  const k = t;
  if (k.classId !== classId || typeof k.date !== "string" || !YMD.test(k.date)) return false;
  if (typeof k.slot !== "string" || !HHMM.test(k.slot)) return false;
  const { removed, added, changed, markers } = k;
  if (!Array.isArray(removed) || !Array.isArray(added) || !Array.isArray(changed) || !Array.isArray(markers)) return false;
  if (removed.length + added.length + changed.length + markers.length > MAX_ROWS) return false;
  return (
    removed.every(validLine) &&
    added.every(validLine) &&
    changed.every((c) => !!c && typeof c === "object" && validLine(c.before) && validLine(c.after) && c.before.id === c.after.id) &&
    markers.every(
      (m) =>
        !!m &&
        typeof m === "object" &&
        typeof m.key === "string" &&
        parseMarkerKey(m.key) !== null &&
        validKind(m.before) &&
        validKind(m.after),
    )
  );
}
// ── PORTED 끝 ──

/** 2.0 restoreShiftState — 표가 기록과 같을 때만 되돌린다('changed'), 쓰다 멈추면 'stopped'(저장점이 그때까지를 되돌린다). */
export async function restoreShiftState(ctx, classId, token) {
  const { sql, t, R, user } = ctx;
  const ids = [...new Set([...token.added, ...token.removed, ...token.changed.map(c => c.after)].map(l => l.id))], tokenIds = new Set(ids);
  const dates = [...new Set([...token.removed.map(l => l.plan_date), ...token.changed.map(c => c.before.plan_date), ...token.markers.map(m => m.key.slice(0, 10))])];
  const [byId, inDates, marks] = await Promise.all([
    ids.length ? sql`select ${lineCols(sql)} from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and id = any(${ids}::uuid[])` : [],
    dates.length ? sql`select id::text id, plan_date::text plan_date, slot_start::text slot_start, term_mode, line_no from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date = any(${dates}::date[])` : [],
    dates.length ? sql`select ${markerCols(sql)} from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date = any(${dates}::date[])` : [],
  ]);
  const current = new Map(byId.map(r => [r.id, R.toUndoLine(r)]));
  const occupied = new Set(inDates.filter(r => !tokenIds.has(r.id)).map(r => R.slotOf({ plan_date: r.plan_date.slice(0, 10), slot_start: r.slot_start.slice(0, 5), term_mode: String(r.term_mode), line_no: Number(r.line_no) })));
  const currentMarkers = {};
  for (const m of marks) { const kind = String(m.kind); if (kind === 'skip' || kind === 'advance') currentMarkers[R.markerKeyOfRow(m)] = kind; }
  const plan = R.planShiftUndo(token, current, currentMarkers, occupied);
  if (!plan.ok) return 'changed';
  const res = await tryWrite(sql, async s => {
    for (const r of plan.restores) { const { id, ...fields } = r; await s`update public.class_sheet_plan_lines set ${s({ ...fields, updated_by: user.id, updated_at: new Date() })} where tenant_id=${t} and class_id=${classId} and id=${id}`; }
    for (let i = 0; i < plan.deletes.length; i += 100) await s`delete from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and id = any(${plan.deletes.slice(i, i + 100)}::uuid[])`;
    const rows = plan.reinserts.map(r => ({ ...r, tenant_id: t, class_id: classId, updated_by: user.id }));
    for (let i = 0; i < rows.length; i += 200) await s`insert into public.class_sheet_plan_lines ${s(rows.slice(i, i + 200))}`;
    for (const m of plan.markers) await writeMarker(s, t, R, classId, m.key, m.kind, user.id);
  });
  return res.error ? 'stopped' : 'ok';
}

/** 2.0 clearPlanLines — 배정을 지울 때 그 교재로 들어간 진도 줄(withLines) · 그 배정·교재 줄의 미룸 표식(평시)을 지운다. 지운 것을 되돌리기 재료로. */
async function clearPlanLines(ctx, input) {
  const { sql, t, R } = ctx, { classId, from } = input;
  const [[b], lessons, lineRows, markRows] = await Promise.all([
    sql`select title, skill_area from public.textbooks where tenant_id=${t} and id=${input.textbookId}`,
    sql`select lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id=${input.textbookId} order by lesson_no`,
    sql`select ${lineCols(sql)} from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and term_mode=${input.termMode} and plan_date >= ${from} order by id`,
    sql`select ${markerCols(sql)} from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date >= ${from} order by id`,
  ]);
  const removed = [], withLines = input.withLines !== false;
  if (withLines && b?.skill_area && !input.keepLines) {
    const texts = vals => new Set(vals.map(v => String(v ?? '').trim()).filter(v => v !== ''));
    const book = { skillArea: String(b.skill_area), title: String(b.title), progressTexts: texts(lessons.map(l => l.progress)), homeworkTexts: texts(lessons.map(l => l.homework)) };
    const rows = lineRows.filter(r => (!input.onlyPicks || R.picksCover(input.onlyPicks, r.plan_date.slice(0, 10), r.slot_start.slice(0, 5)))
      && R.isAssignedLine({ id: r.id, date: r.plan_date.slice(0, 10), slot: r.slot_start.slice(0, 5), skillArea: String(r.skill_area ?? ''), lineNo: Number(r.line_no ?? 0), textbook: r.textbook ?? null, progress: r.progress ?? null, homework: r.homework ?? null }, book));
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await sql`delete from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and id = any(${chunk.map(r => r.id)}::uuid[])`;
      removed.push(...chunk.map(R.toUndoLine));
    }
  }
  const markers = [];
  if (input.termMode === 'regular') {
    const byKey = new Map(markRows.filter(m => m.kind === 'skip' || m.kind === 'advance').map(m => [R.markerKeyOfRow(m), m]));
    const keys = [...(withLines ? R.markersToClear([...byKey.keys()].filter(k => R.parseMarkerKey(k)?.lane === ''), input.picks, input.otherPicks) : []),
      ...[...byKey.keys()].filter(k => { const lane = R.parseMarkerKey(k)?.lane; return lane === input.planId.toLowerCase() || (!input.keepLines && !input.onlyPicks && lane === input.textbookId.toLowerCase()); })];
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      await sql`delete from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and id = any(${chunk.map(k => byKey.get(k).id)}::uuid[])`;
      markers.push(...chunk.map(k => ({ key: k, kind: byKey.get(k).kind })));
    }
  }
  return { removed, markers, stopped: false };
}

/** 2.0 loadPlan(planId, { write }) — 배정 한 건 + 그 반 ECS 게이트(반 id는 DB 행에서) · 교재목록 기능. */
async function loadPlan(ctx, planId, { write }) {
  const { sql, t, R, env, user } = ctx;
  const [row] = UUID.test(str(planId)) ? await sql`select id::text id, tenant_id::text tenant_id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode, start_date::text start_date, start_lesson_no, slot_picks
    from public.class_textbook_plans where id=${planId}` : [];
  if (!row) return { error: '배정을 찾을 수 없습니다' };
  const gate = await classAccess(sql, t, R, env, user, row.class_id, { write });
  if (!gate.ok) return { error: gate.error };
  if (row.tenant_id !== t) return { error: '배정을 찾을 수 없습니다' };
  if (!env.textbooksOn) return { error: '이 학원은 교재목록 기능이 꺼져 있습니다' };
  return { gate, plan: { id: row.id, classId: row.class_id, textbookId: row.textbook_id, axis: row.slot_axis === 'jj' ? 'jj' : 'class', pace: R.normalizeLessonPace(row.pace),
    termMode: row.term_mode === 'exam' ? 'exam' : 'regular', startDate: row.start_date, startLessonNo: Number(row.start_lesson_no ?? 1),
    slotPicks: Array.isArray(row.slot_picks) && row.slot_picks.length > 0 ? R.normalizeSlotPicks(row.slot_picks.map(String)) : null } };
}

/** 2.0 deleteClassTextbookPlan — 배정을 먼저 지우고, 평시면 미룸 표식(withLines면 진도 줄도)을 지운다. 되돌리기 재료 + 히스토리(skipHistory가 아니면). */
export async function deleteClassTextbookPlan(ctx, planId, opts = {}) {
  const loaded = await loadPlan(ctx, planId, { write: true });
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const { sql, t, R, user, today } = ctx, { gate, plan } = loaded;
  const [raw] = await sql`select * from public.class_textbook_plans where tenant_id=${t} and id=${planId}`;
  const restore = raw ? { id: String(raw.id), class_id: String(raw.class_id), textbook_id: String(raw.textbook_id), slot_axis: raw.slot_axis === 'jj' ? 'jj' : 'class', pace: String(raw.pace),
    term_mode: raw.term_mode === 'exam' ? 'exam' : 'regular', start_date: (raw.start_date instanceof Date ? isoDate(raw.start_date) : String(raw.start_date)).slice(0, 10), start_lesson_no: Number(raw.start_lesson_no ?? 1),
    slot_picks: Array.isArray(raw.slot_picks) ? raw.slot_picks.map(String) : null, is_active: raw.is_active !== false, last_applied_at: raw.last_applied_at ? isoAt(raw.last_applied_at) : null,
    last_applied_by: raw.last_applied_by ? String(raw.last_applied_by) : null, created_by: raw.created_by ? String(raw.created_by) : null } : null;
  const from = plan.startDate.slice(0, 10) > today ? plan.startDate.slice(0, 10) : today;
  const clearsMarkers = opts.withLines || plan.termMode === 'regular';
  const others = clearsMarkers ? await sql`select id::text id, textbook_id::text textbook_id, slot_picks from public.class_textbook_plans where tenant_id=${t} and class_id=${plan.classId} and is_active and id <> ${planId}` : [];
  const del = await tryWrite(sql, s => s`delete from public.class_textbook_plans where tenant_id=${t} and id=${planId}`);
  if (del.error) return { ok: false, error: friendlyTextbookError(del.error, '배정을 지우지 못했습니다') };
  let cleared, warning, linesUndo;
  if (clearsMarkers) {
    const sameBook = others.filter(o => o.textbook_id === plan.textbookId), picksOrNull = v => (Array.isArray(v) && v.length > 0 ? v.map(String) : null);
    const splitByPicks = sameBook.length > 0 && (plan.slotPicks?.length ?? 0) > 0 && sameBook.every(o => picksOrNull(o.slot_picks) !== null), keepLines = sameBook.length > 0 && !splitByPicks;
    const res = await tryWrite(sql, s => clearPlanLines({ ...ctx, sql: s }, { classId: plan.classId, planId, onlyPicks: splitByPicks ? plan.slotPicks : null, textbookId: plan.textbookId, termMode: plan.termMode,
      picks: plan.slotPicks, otherPicks: others.map(o => picksOrNull(o.slot_picks)), keepLines, withLines: !!opts.withLines, from }));
    if (res.error) { if (opts.withLines) warning = '배정은 지웠지만 진도 줄은 지우지 못했습니다 — 새로고침해 확인해 주세요'; }
    else {
      const out = res.value;
      if (opts.withLines) cleared = { lines: out.removed.length, markers: out.markers.length };
      const token = { classId: plan.classId, date: from, slot: '00:00', removed: out.removed, added: [], changed: [], markers: out.markers.map(m => ({ key: m.key, before: m.kind, after: null })) };
      if (!R.isEmptyUndo(token)) linesUndo = token;
      if (keepLines && opts.withLines) warning = '배정은 지웠습니다 — 같은 교재가 이 반의 다른 칸(JJ/수업)에도 배정돼 있어 진도 줄은 남겼습니다';
    }
  }
  let historyId;
  if (restore && !opts.skipHistory) {
    const [book] = await sql`select title from public.textbooks where tenant_id=${t} and id=${plan.textbookId}`;
    historyId = await recordHistoryEntry(sql, t, { classId: plan.classId, date: today, actorId: user.id,
      meta: { kind: 'delete', title: typeof book?.title === 'string' ? book.title : null, plan: restore, ...(linesUndo ? { lines: linesUndo } : {}) }, count: linesUndo?.removed.length ?? 0 });
  }
  await audit(sql, t, user, 'textbook_plan_delete', 'class', gate.access.className, { id: planId, ...(cleared ? { linesCleared: cleared.lines, markersCleared: cleared.markers } : {}) });
  return { ok: true, cleared, warning, undo: restore ? { plan: restore, lines: linesUndo } : undefined, historyId };
}
const isoDate = d => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);

// ── PORTED: 2.0 plan-delete-actions.ts validPlan(원문 그대로) ──
function validPlan(p, classId) {
  if (!p || typeof p !== "object") return false;
  const r = p;
  return (
    typeof r.id === "string" &&
    UUID.test(r.id) &&
    r.class_id === classId &&
    typeof r.textbook_id === "string" &&
    UUID.test(r.textbook_id) &&
    (r.slot_axis === "class" || r.slot_axis === "jj") &&
    (r.pace === "period" || r.pace === "day" || r.pace === "min25") &&
    (r.term_mode === "regular" || r.term_mode === "exam") &&
    typeof r.start_date === "string" &&
    YMD.test(r.start_date) &&
    Number.isInteger(r.start_lesson_no) &&
    (r.start_lesson_no) >= 1 &&
    (r.start_lesson_no) <= 200 &&
    (r.slot_picks === null || (Array.isArray(r.slot_picks) && r.slot_picks.length <= 48 && r.slot_picks.every((v) => typeof v === "string"))) &&
    typeof r.is_active === "boolean" &&
    (r.last_applied_at === null || (typeof r.last_applied_at === "string" && !Number.isNaN(Date.parse(r.last_applied_at)))) &&
    (r.last_applied_by === null || (typeof r.last_applied_by === "string" && UUID.test(r.last_applied_by))) &&
    (r.created_by === null || (typeof r.created_by === "string" && UUID.test(r.created_by)))
  );
}
// ── PORTED 끝 ──

/** 2.0 undoPlanDelete — 배정을 같은 id로 되살리고(그 사이 같은 교재·같은 교시가 다시 걸렸으면 거절), 지운 줄은 기록과 같을 때만 되돌린다. */
export async function undoPlanDelete(ctx, raw) {
  const { sql, t, R, env, user } = ctx, input = obj(raw);
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const classId = gate.access.classId;
  if (!validPlan(input.plan, classId)) return { ok: false, error: '되돌릴 기록이 올바르지 않습니다' };
  if (input.lines && !validToken(input.lines, classId)) return { ok: false, error: '되돌릴 기록이 올바르지 않습니다' };
  const p = input.plan;
  if (!env.textbooksOn) return { ok: false, error: '이 학원은 교재목록 기능이 꺼져 있습니다' };
  const [book] = await sql`select id::text id, skill_area from public.textbooks where tenant_id=${t} and id=${p.textbook_id}`;
  if (!book) return { ok: false, error: '교재를 찾을 수 없어 되돌리지 않았습니다' };
  if (!book.skill_area) return { ok: false, error: '이 교재에 구분이 없어 배정을 되살릴 수 없습니다' };
  const picks = p.slot_picks ? R.normalizeSlotPicks(p.slot_picks) : [];
  const historyId = input.historyId && UUID.test(input.historyId) ? input.historyId : null;
  if (historyId && (await claimHistory(sql, t, classId, historyId, user.id)) === 'taken') return { ok: false, error: '이미 되돌렸습니다' };
  const fail = async error => { if (historyId) await releaseHistory(sql, t, historyId); return { ok: false, error }; };
  const sib = await sql`select id::text id, slot_picks from public.class_textbook_plans where tenant_id=${t} and class_id=${classId} and textbook_id=${p.textbook_id} and is_active`;
  const placement = R.placeSameBookPlan({ picks: picks.length > 0 ? picks : null, siblings: sib.map(r => ({ id: r.id, slotPicks: Array.isArray(r.slot_picks) && r.slot_picks.length > 0 ? r.slot_picks.map(String) : null })) });
  if (placement.kind === 'error') return fail(`되돌리지 않았습니다 — ${placement.error}`);
  if (placement.kind === 'update') return fail('그 사이 같은 교재가 같은 교시에 다시 배정돼 있어 되돌리지 않았습니다');
  const ins = await tryWrite(sql, s => s`insert into public.class_textbook_plans ${s({ id: p.id, tenant_id: t, class_id: classId, textbook_id: p.textbook_id, slot_axis: p.slot_axis, pace: p.pace, term_mode: p.term_mode,
    start_date: p.start_date, start_lesson_no: p.start_lesson_no, is_active: p.is_active, created_by: p.created_by, last_applied_at: p.last_applied_at, last_applied_by: p.last_applied_by, ...(picks.length > 0 ? { slot_picks: picks } : {}) })}`);
  if (ins.error) return fail(friendlyTextbookError(ins.error, '배정을 되살리지 못했습니다', '그 사이 같은 교재가 다시 배정돼 있어 되돌리지 않았습니다'));
  let warning;
  if (input.lines) {
    const res = await restoreShiftState(ctx, classId, input.lines);
    if (res === 'changed') warning = '배정은 되살렸지만, 그 사이 진도가 바뀌어 지운 진도 줄은 되돌리지 않았습니다';
    else if (res === 'stopped') warning = '배정은 되살렸지만 진도 줄을 되돌리다 멈췄습니다 — 새로고침해 확인해 주세요';
  }
  await audit(sql, t, user, 'textbook_plan_delete_undo', 'class', gate.access.className, { id: p.id, lines: input.lines ? input.lines.removed.length : 0, warning: warning ?? null });
  return { ok: true, warning };
}

/** 2.0 undoLessonShift — 미룸·당김 직전으로(기록과 지금이 같을 때만). */
export async function undoLessonShift(ctx, raw) {
  const { sql, t, R, env, user } = ctx, input = obj(raw);
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const classId = gate.access.classId;
  if (!validToken(input.token, classId)) return { ok: false, error: '되돌릴 기록이 올바르지 않습니다' };
  const token = input.token, historyId = input.historyId && UUID.test(input.historyId) ? input.historyId : null;
  if (historyId && (await claimHistory(sql, t, classId, historyId, user.id)) === 'taken') return { ok: false, error: '이미 되돌렸습니다' };
  const res = await restoreShiftState(ctx, classId, token);
  if (res !== 'ok') {
    if (historyId) await releaseHistory(sql, t, historyId);
    return { ok: false, error: res === 'changed' ? '그 사이 이 반의 진도가 바뀌어 되돌리지 않았습니다 — 화면을 새로고침해 확인해 주세요' : '되돌리다 멈췄습니다 — 새로고침 후 확인해 주세요' };
  }
  await audit(sql, t, user, 'textbook_lesson_shift_undo', 'class', gate.access.className, { date: token.date, removed: token.removed.length, added: token.added.length, changed: token.changed.length, markers: token.markers.length });
  return { ok: true };
}

/** 2.0 undoPlanImport — 최근 5건 안에서 그 반영까지 뒤에서부터 되돌린다(latestOnly면 맨 뒤만). 배정 반영이면 배정도 지운다. */
export async function undoPlanImport(ctx, raw) {
  const { sql, t, R, env, user } = ctx, input = obj(raw);
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const classId = gate.access.classId;
  const recent = (await sql`select id::text id, created_at, row_count, rows from public.class_plan_import_batches where tenant_id=${t} and class_id=${classId} and undone_at is null order by created_at desc limit 5`)
    .map(r => { const { meta } = R.splitBatchRows(r.rows); return { id: r.id, at: isoAt(r.created_at), count: Number(r.row_count ?? 0), title: meta?.title ?? null, kind: R.historyKindOf(meta) }; });
  const chain = R.undoChain(recent, str(input.batchId));
  if (chain && input.latestOnly && chain.length > 1) return { ok: false, error: '그 뒤에 다른 반영이 있습니다 — 툴바 [되돌리기 ▾]에서 시점을 골라 주세요' };
  if (!chain) return { ok: false, error: '되돌릴 수 있는 반영이 아닙니다 — 이미 되돌렸거나 최근 5건 밖입니다' };
  const total = { restored: 0, kept: 0, batches: 0, plansRemoved: 0, others: 0 };
  let failure = null;
  for (const b of chain) {
    const r = await undoOne(ctx, gate, classId, b.id);
    if (!r.ok) { failure = r.error; break; }
    total.restored += r.restored; total.kept += r.kept; total.batches += 1;
    if (r.planRemoved) total.plansRemoved += 1;
    if (r.other) total.others += 1;
  }
  if (failure) return { ok: false, error: total.batches > 0 ? `${failure} (최근 ${total.batches}건은 되돌렸습니다)` : failure };
  return { ok: true, ...total };
}
async function undoOne(ctx, gate, classId, batchId) {
  const { sql, t, R, user } = ctx;
  const [row] = await sql`select rows, undone_at from public.class_plan_import_batches where tenant_id=${t} and class_id=${classId} and id=${batchId}`;
  if (!row || row.undone_at) return { ok: false, error: '이미 되돌린 반영입니다' };
  const batch = R.splitBatchRows(row.rows);
  if ((await claimHistory(sql, t, classId, batchId, user.id)) === 'taken') return { ok: false, error: '이미 되돌린 반영입니다' };
  const release = () => releaseHistory(sql, t, batchId), meta = batch.meta;
  if (meta?.kind === 'shift' || meta?.kind === 'delete') {
    const r = meta.kind === 'shift' ? await undoLessonShift(ctx, { classId, token: meta.token })
      : await undoPlanDelete(ctx, { classId, plan: meta.plan, ...(meta.lines ? { lines: meta.lines } : {}) });
    if (!r.ok) { await release(); return { ok: false, error: r.error }; }
    return { ok: true, restored: 0, kept: 0, planRemoved: false, other: true };
  }
  const ids = batch.rows.map(r => r.id);
  const current = ids.length ? await sql`select id::text id, textbook, page_range, progress, homework from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and id = any(${ids}::uuid[])` : [];
  const plan = R.planUndo(batch.rows, new Map(current.map(r => [r.id, r])));
  const res = await tryWrite(sql, async s => {
    for (let i = 0; i < plan.deletes.length; i += 100) await s`delete from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and id = any(${plan.deletes.slice(i, i + 100)}::uuid[])`;
    for (const r of plan.resets) await s`update public.class_sheet_plan_lines set ${s({ ...r.patch, updated_by: user.id, updated_at: new Date() })} where tenant_id=${t} and class_id=${classId} and id=${r.id}`;
  });
  if (res.error) { await release(); return { ok: false, error: '되돌리다 멈췄습니다 — 새로고침 후 다시 시도해 주세요' }; }
  let planRemoved = false;
  if (batch.plan) {
    const [planRow] = await sql`select id::text id, class_id::text class_id from public.class_textbook_plans where tenant_id=${t} and id=${batch.plan.planId}`;
    if (planRow && planRow.class_id === classId) {
      const del = await deleteClassTextbookPlan(ctx, batch.plan.planId, { skipHistory: true });
      if (!del.ok) return { ok: false, error: `칸은 되돌렸지만 교재 배정을 지우지 못했습니다 — 교재 배정에서 직접 지워 주세요 (${del.error})` };
      planRemoved = true;
    }
  }
  await audit(sql, t, user, 'textbook_plan_import_undo', 'class', gate.access.className, { batchId, restored: plan.restored, kept: plan.kept, planId: batch.plan?.planId ?? null, planRemoved });
  return { ok: true, restored: plan.restored, kept: plan.kept, planRemoved };
}

/** 이 화면의 2.0 서버 액션 넷 — 이름·모듈·인자 = 2.0. */
export const PLAN_UNDO_ACTIONS = {
  deleteClassTextbookPlan: serverFn(MODULE.plan, 2, (ctx, planId, opts) => deleteClassTextbookPlan(ctx, planId, obj(opts))),
  undoPlanDelete: serverFn(MODULE.deleteUndo, 1, (ctx, input) => undoPlanDelete(ctx, input)),
  undoPlanImport: serverFn(MODULE.importUndo, 1, (ctx, input) => undoPlanImport(ctx, input)),
  undoLessonShift: serverFn(MODULE.shiftUndo, 1, (ctx, input) => undoLessonShift(ctx, input)),
};
