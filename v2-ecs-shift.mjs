// 2.0 화면 · 강사 시트(ECS) — 회차 미룸·당김(2.0 서버 액션과 같은 이름·인자·반환·감사로그):
//   textbooks/server/plan-actions.ts  setLessonShift({ classId, date, slotStart, kind, lineId?, fill? })
//     class_sheet_plan_lines(평시 줄 — 복제 후 삭제 · 배정 교재 줄은 다시 깔기) · class_lesson_shifts(칸·줄 표식) · class_plan_import_batches(히스토리)   textbook_lesson_shift
// 밑바닥은 2.0 server 폴더의 shiftActualLines(shift-lines.ts) · shiftAlongPlans(shift-relay.ts) · snapshotShiftState·readWeekCells(shift-snapshot.ts)를 같은 순서로 옮겼고,
// 판정은 2.0 순수 함수(lesson-shift-chain.ts planLessonShift · lesson-relay.ts · shift-key.ts · shift-undo.ts · lesson-schedule.ts · plan-expand.ts · plan-siblings.ts ·
// import-undo.ts shiftTitleOf · month-assemble.ts slotsByDateOf)를 그대로 쓴다. 표식 쓰기·히스토리 = v2-ecs-plan-undo.mjs, 교재 줄 채우기 = v2-ecs-textbooks.mjs applyCellLessons.
// 2.0과 다른 것(이유):
//  · 쓰기는 한 번에 하나씩 저장점 안에서 — 2.0처럼 쓰다 멈추면 그때까지 쓴 것은 남고(되돌리기 기록을 함께 준다) 트랜잭션은 깨지지 않는다.
//  · 표식 표에 줄 표식 칸(lane·pos)이 있어 옛 표(칸 표식만)로 대신 쓰는 길은 없다. 표식을 못 쓰면 '회차를 바꾸지 못했습니다'(마이그레이션 안내 문구는 화면에 내지 않는다).
//  · 진도를 읽다 실패하면 그 단계의 저장점째 되돌리고 2.0 문구('진도를 불러오지 못해 옮기지 않았습니다')로 답한다(2.0은 그때까지의 쓰기가 남을 수 있다).
//  · 오류 보고(reportError)·화면 무효화(revalidatePath)는 없다 — 호스트가 결과로 다시 그린다.
import { classAccess } from './v2-ecs-core.mjs';
import { audit, lineDTO, obj, serverFn, str } from './v2-ecs-save.mjs';
import { applyCellLessons, tryWrite } from './v2-ecs-textbooks.mjs';
import { planMaterials } from './v2-ecs-gap.mjs';
import { recordHistoryEntry, writeMarker } from './v2-ecs-plan-undo.mjs';

const MODULE = 'features/textbooks/server/plan-actions.ts';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const markerCols = sql => sql`id::text id, class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos`;

// ── 2.0 shift-lines.ts shiftActualLines — 평시 줄을 같은 요일·교시끼리 한 주씩(복제 → 원래 행 삭제) ──
const LOOKAHEAD_WEEKS = 26;
const REASON_TEXT = {
  'no-content': '이 칸부터 뒤로 옮길 진도가 없습니다',
  'no-next-day': '다음 수업일이 없어 미룰 수 없습니다 — 시간표를 확인해 주세요',
  'nothing-after': '다음 주 진도가 없어 당겨올 내용이 없습니다',
};
export async function shiftActualLines(ctx, input) {
  const { sql, t, R, env, user } = ctx, { classId, date, slot, kind } = input;
  const exclude = input.excludeIds ?? new Set();
  const dow = R.dowKeyOf(date);
  const [lineRows, schedRows] = await Promise.all([
    sql`select id::text id, plan_date::text plan_date, skill_area, line_no, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id=${classId} and slot_start=${slot} and term_mode='regular' and plan_date >= ${date} order by plan_date, id`,
    sql`select id::text id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} order by id`,
  ]);
  // 같은 요일만 — 같은 시각이어도 요일이 다르면 다른 수업이다. 빼기로 한 줄(배정 교재 줄)은 없는 셈 친다.
  const rowsByDate = new Map();
  for (const r of lineRows) {
    const d = String(r.plan_date).slice(0, 10);
    if (R.dowKeyOf(d) !== dow || exclude.has(String(r.id))) continue;
    if (input.only && !input.only({ skill_area: r.skill_area, textbook: r.textbook })) continue;
    rowsByDate.set(d, [...(rowsByDate.get(d) ?? []), r]);
  }
  const filledDates = [...rowsByDate.keys()];
  const schedules = schedRows.map(r => ({ dayOfWeek: String(r.day_of_week), startTime: String(r.start_time), endTime: r.end_time ? String(r.end_time) : null,
    validFrom: r.valid_from ? String(r.valid_from) : null, validTo: r.valid_to ? String(r.valid_to) : null, slotTeacherLabel: r.slot_teacher_label ?? null, slotRoomLabel: r.slot_room_label ?? null }));
  const lastFilled = filledDates.length > 0 ? filledDates.sort().at(-1) : date;
  const weeks = [];
  for (let d = date; d <= R.shiftDays(lastFilled, LOOKAHEAD_WEEKS * 7); d = R.shiftDays(d, 7)) weeks.push(d);
  const byDate = R.slotsByDateOf(weeks, schedules);
  const liveDates = weeks.filter(d => R.holidayNameOn(env.holidays, d) === null && (byDate[d] ?? []).some(s => R.normalizeSlotTime(s.slotStart) === slot));
  const chain = [...new Set([date, ...liveDates, ...filledDates])].filter(d => d >= date).sort();
  const plan = R.planLessonShift({ kind, fromDate: date, liveDates, filledDates });
  if (!plan.ok) return { ok: false, error: REASON_TEXT[plan.reason], noContent: plan.reason === 'no-content', chain };
  const fail = { ok: false, error: '진도를 옮기다 멈췄습니다 — 새로고침 후 확인해 주세요', noContent: false, chain, stopped: true };
  const idsAt = at => (rowsByDate.get(at) ?? []).map(r => String(r.id));
  const remove = async at => {
    const ids = idsAt(at);
    return ids.length === 0 || !(await tryWrite(sql, s => s`delete from public.class_sheet_plan_lines where tenant_id=${t} and id = any(${ids}::uuid[])`)).error;
  };
  /** `from` 칸의 줄을 **새 행**으로 `to`에 복제한다 — 옮겨 갈 칸에 남은 줄(배정 교재 줄)의 번호와 안 겹치게(위치 유니크 …, line_no). */
  const duplicate = async (from, to) => {
    const src = rowsByDate.get(from) ?? [];
    if (src.length === 0) return true;
    return !(await tryWrite(sql, async s => {
      const taken = new Set((await s`select line_no from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date=${to} and slot_start=${slot} and term_mode='regular'`).map(r => Number(r.line_no)));
      let next = 1;
      const rows = src.map(r => {
        let lineNo = Number(r.line_no);
        if (taken.has(lineNo)) { while (taken.has(next)) next += 1; lineNo = next; }
        taken.add(lineNo);
        return { skill_area: r.skill_area, line_no: lineNo, textbook: r.textbook, page_range: r.page_range, progress: r.progress, homework: r.homework,
          tenant_id: t, class_id: classId, plan_date: to, slot_start: slot, term_mode: 'regular', updated_by: user.id };
      });
      await s`insert into public.class_sheet_plan_lines ${s(rows)}`;
    })).error;
  };
  // 옮기기 = 새 행으로 복제 → 원래 행 삭제(다른 창이 옛 주의 그 줄을 고치면 "지워진 줄"로 충돌이 나게). 중간에 멈춰도 줄은 사라지지 않는다.
  let moved = 0;
  for (const op of plan.ops) {
    const ok = op.op === 'clear' ? await remove(op.at) : (await duplicate(op.from, op.to)) && (await remove(op.from));
    if (!ok) return fail;
    moved += 1;
  }
  return { ok: true, moved, chain };
}

// ── 2.0 shift-relay.ts shiftAlongPlans — 누른 칸을 배정 교재가 지나가면 표식을 그 교재 칸 순서로 두고 그 교재 줄을 새 일정대로 다시 깐다 ──
const STOPPED = '진도를 옮기다 멈췄습니다 — 새로고침 후 확인해 주세요';
const NO_NEXT = '다음 수업일이 없어 미룰 수 없습니다 — 시간표를 확인해 주세요';
const MARK_FAILED = '회차를 바꾸지 못했습니다 — 잠시 뒤 다시 시도해 주세요';
const LOAD_FAILED = '진도를 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요';
/** 2.0 `.catch(() => 진도를 불러오지 못해…)` — 읽다 실패하면 저장점째 되돌리고(트랜잭션은 살린다) 2.0 문구로. */
const guarded = async (sql, run, failed) => { const r = await tryWrite(sql, run); return r.error ? failed : r.value; };
const hasContent = l => [l.textbook, l.progress, l.homework].some(v => String(v ?? '').trim() !== '');
function daysBetween(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}
export async function shiftAlongPlans(ctx, input) {
  const { sql, t, R, env, user } = ctx, { classId, date, slot, kind } = input;
  const target = input.target ?? { by: 'cell' };
  const pressedKey = R.cellMarkerKey(date, slot);
  const materials = await planMaterials(sql, t, R, env, [classId], R.shiftDays(date, R.MAX_LOOKAHEAD_DAYS));
  const m = materials.byClass.get(classId);
  const regular = (m?.plans ?? []).filter(p => p.term_mode !== 'exam');
  const picksOf = p => (Array.isArray(p.slot_picks) ? p.slot_picks.map(String) : null);
  const cellsOf = p => R.planCellKeys({ startDate: String(p.start_date).slice(0, 10), schedules: m.schedules, holidays: materials.holidays, axis: p.slot_axis === 'jj' ? 'jj' : 'class',
    slotPicks: picksOf(p), lookaheadDays: Math.max(1, Math.min(R.MAX_LOOKAHEAD_DAYS, daysBetween(String(p.start_date).slice(0, 10), date) + 120)) });
  // 누른 칸을 지나가는 배정 — 시작일이 누른 날 이후인 배정은 아직 이 칸에 안 왔다.
  const relevant = [];
  for (const p of regular) {
    if (String(p.start_date).slice(0, 10) > date) continue;
    const cells = cellsOf(p);
    if (cells.includes(pressedKey)) relevant.push({ plan: p, cells });
  }
  if (relevant.length === 0) return { handled: false };

  const rows = await sql`select id::text id, plan_date::text plan_date, slot_start::text slot_start, skill_area, line_no, textbook, progress, homework from public.class_sheet_plan_lines
    where tenant_id=${t} and class_id=${classId} and term_mode='regular' and plan_date >= ${date} order by plan_date, id`;
  let lines = rows.map(r => ({ id: String(r.id), date: String(r.plan_date).slice(0, 10), slot: String(r.slot_start).slice(0, 5), skillArea: String(r.skill_area ?? ''),
    lineNo: Number(r.line_no ?? 0), textbook: r.textbook ?? null, progress: r.progress ?? null, homework: r.homework ?? null }));
  const bookOf = textbookId => {
    const b = materials.books.get(textbookId);
    if (!b || !b.skillArea) return null;
    const lessons = [...(materials.lessonsByBook.get(textbookId)?.values() ?? [])];
    const texts = vals => new Set(vals.map(v => String(v ?? '').trim()).filter(v => v !== ''));
    return { skillArea: b.skillArea, title: b.title, pageTime: b.pageTime, progressTexts: texts(lessons.map(l => l.progress)), homeworkTexts: texts(lessons.map(l => l.homework)) };
  };
  // 다시 까는 단위 = 배정(표식 lane = 배정 id) · 같은 교재 배정 형제가 있으면 줄의 주인을 고른 교시로 가른다(ownsCell).
  const byBook = new Map();
  for (const r of relevant) byBook.set(R.planLane(r.plan), [...(byBook.get(R.planLane(r.plan)) ?? []), r.plan]);
  const bookIdOfLane = new Map(relevant.map(r => [R.planLane(r.plan), String(r.plan.textbook_id)]));
  const laneBook = lane => bookOf(bookIdOfLane.get(lane) ?? '');
  const sameBookCount = new Map();
  for (const p of regular) sameBookCount.set(String(p.textbook_id), (sameBookCount.get(String(p.textbook_id)) ?? 0) + 1);
  const ownsLine = (p, l) => { const picks = picksOf(p); return R.ownsCell({ slotPicks: picks && picks.length > 0 ? picks : null }, (sameBookCount.get(String(p.textbook_id)) ?? 0) > 1, l.date, l.slot); };
  const shifts = { ...(m.shifts ?? {}) };
  const scheduleOf = (plans, s, to) => R.expandPlans({ plans, books: materials.books, lessonsByBook: materials.lessonsByBook, schedules: m.schedules, holidays: materials.holidays, shifts: s, from: date, to });

  // ① 표식 — 무엇을 눌렀나에 따라.
  let books = [...byBook.keys()];
  const dropFirst = [], writes = [];
  const cellMark = () => {
    const sequence = [...new Set(relevant.flatMap(r => r.cells))].filter(k => k >= pressedKey).sort();
    return R.placeShiftMarker({ kind, pressedKey, sequence, shifts });
  };
  let removedCellSkip = false;
  if (target.by === 'line') {
    const pressed = lines.find(l => l.id === target.lineId);
    if (!pressed || pressed.date !== date || pressed.slot !== slot) return { handled: true, ok: false, error: '그 사이 이 줄이 바뀌었습니다 — 새로고침 후 다시 눌러 주세요' };
    const lane = books.find(id => { const b = laneBook(id); return b !== null && R.isBookLine(pressed, b) && byBook.get(id).every(p => ownsLine(p, pressed)); });
    // 배정 교재 줄이 아니다(손으로 적은 다른 교재) — 호출부가 그 줄만 같은 요일·교시끼리 옮긴다.
    if (!lane) return { handled: false };
    const book = laneBook(lane), plansT = byBook.get(lane);
    if (shifts[pressedKey] === 'skip') {
      // 옛 칸 표식으로 통째 미뤄 둔 칸 — 이 교재 자리가 없다. 그 칸 안의 줄은 교시 통째로(종전 그대로).
      const mark = cellMark();
      if (!mark) return { handled: true, ok: false, error: NO_NEXT };
      writes.push({ key: mark.key, kind: mark.op === 'delete' ? null : kind });
    } else {
      books = [lane];
      const allDay = plansT.every(p => R.normalizeLessonPace(p.pace) === 'day');
      const slotsAt = (d, sl) => (allDay ? 1 : Math.max(...plansT.map(p => R.positionCountAt(picksOf(p), d, sl))));
      // 몇 번째 자리인가 — 칸 안 그 교재 줄의 순서 = 지금 일정에서 차수가 앉은 자리의 순서(planRelay와 같은 규칙: 배정 줄 → 고쳐 쓴 줄, 줄 번호 순).
      const inCell = l => l.date === date && l.slot === slot;
      const cellLines = [...lines.filter(l => inCell(l) && R.isAssignedLine(l, book)), ...lines.filter(l => inCell(l) && R.isBookLine(l, book) && !R.isAssignedLine(l, book))].sort((a, b) => a.lineNo - b.lineNo);
      const filledPos = (scheduleOf(plansT, shifts, date)[pressedKey] ?? []).map(l => l.pos).sort((a, b) => a - b);
      const i = cellLines.findIndex(l => l.id === pressed.id);
      if (i < 0 || i >= filledPos.length) return { handled: true, ok: false, error: '이 줄은 교재 일정에 없는 자리라 옮길 수 없습니다 — 줄을 직접 고쳐 주세요' };
      const pos = filledPos[i];
      const stack = R.advanceStackAt(shifts, date, slot, lane, pos);
      if (kind === 'advance' && stack.length > 0) {
        // 같은 줄을 또 당겼다 — 그 자리에 하나 더 쌓는다.
        const key = R.nextAdvanceStackKey(shifts, date, slot, lane, pos);
        if (!key) return { handled: true, ok: false, error: '이 줄은 더 당길 수 없습니다 — 다음 줄에서 당겨 주세요' };
        writes.push({ key, kind: 'advance' });
      } else if (kind === 'skip' && stack.length > 0) {
        // 당겨 둔 자리를 미룸 — 쌓인 당김을 하나 걷는다.
        writes.push({ key: stack.at(-1), kind: null });
      } else {
        // 그 교재가 지나가는 자리 순서 — 칸 순 → 자리 순. 칸째 미룬 칸(옛 칸 표식)은 자리가 없다.
        const sequence = [];
        for (const cell of [...new Set(relevant.filter(r => R.planLane(r.plan) === lane).flatMap(r => r.cells))].sort()) {
          if (cell < pressedKey || shifts[cell] === 'skip') continue;
          const [d, sl] = cell.split('|');
          for (let k = 1; k <= slotsAt(d, sl); k += 1) sequence.push(R.laneMarkerKey(d, sl, lane, k));
        }
        const mark = R.placeShiftMarker({ kind, pressedKey: R.laneMarkerKey(date, slot, lane, pos), sequence, shifts });
        if (!mark) return { handled: true, ok: false, error: NO_NEXT };
        writes.push({ key: mark.key, kind: mark.op === 'delete' ? null : kind });
      }
      // 누른 줄이 고쳐 쓴 줄이면 다시 깔기가 그 줄을 제자리에 둔다 — 눌렀다는 건 그 줄을 놓겠다는 뜻이니 먼저 지운다.
      if (!R.isAssignedLine(pressed, book)) dropFirst.push(pressed.id);
    }
  } else if (target.by === 'fill') {
    // 계획만 있는 칸에서만 — 진도가 적힌 칸은 줄마다의 당김을 쓴다.
    if (lines.some(l => l.date === date && l.slot === slot && hasContent(l))) return { handled: true, ok: false, error: '이 칸엔 이미 진도가 있습니다 — 새로고침 후 줄의 [당김]을 눌러 주세요' };
    for (const [key, k] of Object.entries(shifts)) if (k === 'skip' && R.isMarkerAtCell(key, date, slot)) writes.push({ key, kind: null });
    if (writes.length === 0) return { handled: true, ok: false, error: '이 칸은 미뤄 둔 칸이 아니라 당길 것이 없습니다' };
    removedCellSkip = shifts[pressedKey] === 'skip';
  } else {
    const mark = cellMark();
    if (!mark) return { handled: true, ok: false, error: NO_NEXT };
    writes.push({ key: mark.key, kind: mark.op === 'delete' ? null : kind });
  }
  for (const w of writes) {
    const res = await tryWrite(sql, s => writeMarker(s, t, R, classId, w.key, w.kind, user.id));
    if (res.error) return { handled: true, ok: false, error: MARK_FAILED };
    if (w.kind === null) delete shifts[w.key];
    else shifts[w.key] = w.kind;
  }

  // 어느 배정이든 그 교재의 줄(고쳐 쓴 줄 포함)은 요일 이동에서 뺀다.
  const bookLineIds = new Set();
  for (const id of new Set(regular.map(p => String(p.textbook_id)))) {
    const book = bookOf(id);
    if (!book) continue;
    for (const l of lines) if (R.isBookLine(l, book)) bookLineIds.add(l.id);
  }
  let moved = 0;
  const touched = new Set([pressedKey]);
  for (const id of dropFirst) {
    if ((await tryWrite(sql, s => s`delete from public.class_sheet_plan_lines where tenant_id=${t} and id=${id}`)).error) return { handled: true, ok: false, error: STOPPED };
    moved += 1;
  }
  if (dropFirst.length > 0) lines = lines.filter(l => !dropFirst.includes(l.id));

  // ② 다시 깔 교재마다 새 일정대로. 계획만 있는 칸의 당김은 누른 칸이 새 일정의 첫 칸이다.
  const relayKind = target.by === 'fill' ? 'advance' : kind;
  const lineCell = new Map(lines.map(l => [l.id, R.cellMarkerKey(l.date, l.slot)]));
  const cellOfOp = op => (op.op === 'insert' ? R.cellMarkerKey(op.date, op.slot) : (lineCell.get(op.id) ?? ''));
  const ops = [];
  for (const lane of books) {
    const plans = byBook.get(lane), book = laneBook(lane);
    if (!book) continue;
    const owned = l => plans.every(p => ownsLine(p, l));
    const mine = lines.filter(l => R.isAssignedLine(l, book) && owned(l));
    const edited = lines.filter(l => R.isBookLine(l, book) && !R.isAssignedLine(l, book) && owned(l));
    const end = mine.map(l => l.date).sort().at(-1);
    if (!end) continue; // 아직 가져오기 전 — 표식만으로 월간계획이 맞춰진다.
    const scheduleWith = s => R.groupCellLessons(Object.values(scheduleOf(plans, s, R.shiftDays(end, 120))).flat());
    const plan = R.planRelay({ kind: relayKind, date, slot, lines: mine, edited, targets: scheduleWith(shifts), previous: scheduleWith(m.shifts ?? {}) });
    for (const op of plan.ops) ops.push({ book, op });
  }
  for (const { op } of ops) { const k = cellOfOp(op); if (k) touched.add(k); }
  // 고치기·지우기 먼저(같은 칸의 옛 줄이 비켜야 새 줄이 안 겹친다).
  for (const { op } of ops) {
    if (op.op === 'update') {
      if ((await tryWrite(sql, s => s`update public.class_sheet_plan_lines set progress=${op.progress}, homework=${op.homework}, updated_by=${user.id}, updated_at=now() where tenant_id=${t} and id=${op.id}`)).error) return { handled: true, ok: false, error: STOPPED };
      moved += 1;
    } else if (op.op === 'delete') {
      if ((await tryWrite(sql, s => s`delete from public.class_sheet_plan_lines where tenant_id=${t} and id=${op.id}`)).error) return { handled: true, ok: false, error: STOPPED };
      moved += 1;
    }
  }
  // ③ 배정 교재가 아닌 줄은 종전대로 같은 요일·교시끼리 — 교시 통째로 눌렀을 때만(계획만 있는 칸의 당김은 교시 통째 미룸을 걷었을 때만).
  const cellWide = target.by === 'cell' || (target.by === 'line' && writes.some(w => R.parseMarkerKey(w.key)?.lane === '')) || removedCellSkip;
  if (cellWide) {
    const weekly = await shiftActualLines(ctx, { classId, date, slot, kind: relayKind, excludeIds: bookLineIds });
    if (weekly.ok) moved += weekly.moved;
    else if (weekly.stopped) return { handled: true, ok: false, error: STOPPED };
  }
  // 모자란 줄 채우기 — 가져오기와 같은 쓰기(차수 하나 = 줄 하나, 같은 교재 줄이 있으면 빈 칸만 채운다).
  const inserts = new Map();
  for (const { book, op } of ops) if (op.op === 'insert') inserts.set(book, [...(inserts.get(book) ?? []), op]);
  for (const [book, list] of inserts) {
    const cells = list.map(o => ({ date: o.date, slot: o.slot, lessons: o.lessons })).sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)));
    const out = await tryWrite(sql, s => applyCellLessons({ ...ctx, sql: s }, { classId, termMode: 'regular', book: { skillArea: book.skillArea, title: book.title, pageTime: book.pageTime }, cells }));
    if (out.error) return { handled: true, ok: false, error: STOPPED };
    moved += out.value.applied;
  }
  return { handled: true, ok: true, moved, touched: [...touched].sort() };
}

// ── 2.0 shift-snapshot.ts — 앞뒤 모습(평시 줄 · 표식, 누른 날 이후) · 그 주 칸 다시 읽기 ──
export async function snapshotShiftState(sql, t, R, classId, date) {
  const [lineRows, markRows] = await Promise.all([
    sql`select id::text id, plan_date::text plan_date, slot_start::text slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id=${classId} and term_mode='regular' and plan_date >= ${date} order by id`,
    sql`select ${markerCols(sql)} from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date >= ${date} order by id`,
  ]);
  const markers = {};
  for (const m of markRows) { const kind = String(m.kind); if (kind === 'skip' || kind === 'advance') markers[R.markerKeyOfRow(m)] = kind; }
  return { lines: lineRows.map(R.toUndoLine), markers };
}
async function readWeekCells(sql, t, R, { classId, date, slot, keys: touched }) {
  const monday = R.mondayOf(date), sunday = R.shiftDays(monday, 6), pressedKey = `${date}|${slot}`;
  const keys = new Set([pressedKey, ...touched.filter(k => k >= monday && k.slice(0, 10) <= sunday)]);
  const weekRows = await sql`select * from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date >= ${monday} and plan_date <= ${sunday} order by term_mode, line_no, id`;
  const byCell = new Map([...keys].map(k => [k, []]));
  for (const r of weekRows) { const dto = lineDTO(R, r); byCell.get(`${dto.planDate}|${String(dto.slotStart).slice(0, 5)}`)?.push(dto); }
  return { lines: byCell.get(pressedKey), cells: [...byCell.entries()].map(([k, l]) => ({ date: k.slice(0, 10), slotStart: k.slice(11), lines: l })) };
}

// ── 2.0 plan-actions.ts setLessonShift ──
export async function setLessonShift(ctx, raw) {
  const { sql, t, R, env, user } = ctx, input = obj(raw);
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(str(input.date))) return { ok: false, error: '날짜가 올바르지 않습니다' };
  const slot = String(input.slotStart).slice(0, 5);
  if (!/^[0-2]\d:[0-5]\d$/.test(slot)) return { ok: false, error: '교시가 올바르지 않습니다' };
  const kind = input.kind === 'skip' || input.kind === 'advance' ? input.kind : null;
  const lineId = typeof input.lineId === 'string' && UUID_RE.test(input.lineId) ? input.lineId : null;
  if (input.lineId !== undefined && !lineId) return { ok: false, error: '줄이 올바르지 않습니다' };
  const fill = input.fill === true && !lineId;
  if (fill && kind !== 'advance') return { ok: false, error: '계획만 있는 칸은 당김만 됩니다' };
  const target = lineId ? { by: 'line', lineId } : fill ? { by: 'fill' } : { by: 'cell' };
  const classId = gate.access.classId, date = input.date;

  if (!kind) {
    const res = await tryWrite(sql, s => writeMarker(s, t, R, classId, R.cellMarkerKey(date, slot), null, user.id));
    if (res.error) return { ok: false, error: MARK_FAILED };
    return { ok: true, kind: null, moved: 0 };
  }
  // 되돌리기 재료 — 옮기기 전 모습.
  const before = await snapshotShiftState(sql, t, R, classId, date);
  let historyId;
  const undoSince = async () => {
    const after = await snapshotShiftState(sql, t, R, classId, date);
    const token = R.diffShift({ classId, date, slot, before: before.lines, after: after.lines, markersBefore: before.markers, markersAfter: after.markers });
    if (R.isEmptyUndo(token)) return undefined;
    // 툴바 [되돌리기 ▾] 히스토리 — 알림과 같은 재료. 못 남기면 없다(2.0처럼 옮기기는 그대로).
    const rec = await tryWrite(sql, s => recordHistoryEntry(s, t, { classId, date, actorId: user.id, meta: { kind: 'shift', shift: kind, title: R.shiftTitleOf(token), token },
      count: token.removed.length + token.added.length + token.changed.length }));
    historyId = rec.error ? undefined : (rec.value ?? undefined);
    return token;
  };
  const finishShift = async (movedCount, touched = []) => {
    const undo = await undoSince();
    const week = await readWeekCells(sql, t, R, { classId, date, slot, keys: touched });
    await audit(sql, t, user, 'textbook_lesson_shift', 'class', gate.access.className, { date, slot, kind, moved: movedCount });
    return { ok: true, kind, moved: movedCount, lines: week.lines, cells: week.cells, undo, historyId };
  };

  // ⓪ 배정 교재가 지나가는 칸이면 교재 순서로(표식·줄을 그 경로가 함께 맞춘다).
  const relay = await guarded(sql, s => shiftAlongPlans({ ...ctx, sql: s }, { classId, date, slot, kind, target }), { handled: true, ok: false, error: LOAD_FAILED });
  if (relay.handled) {
    if (!relay.ok) return { ok: false, error: relay.error, undo: await undoSince(), historyId };
    return finishShift(relay.moved, relay.touched);
  }
  // 배정 교재가 지나가지 않는 줄 하나 — 그 줄과 같은 구분·교재명 줄만 같은 요일·교시끼리 한 주씩(표식 없음).
  if (lineId) {
    const [row] = await sql`select plan_date::text plan_date, slot_start::text slot_start, term_mode, skill_area, textbook from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id=${classId} and id=${lineId}`;
    if (!row || row.plan_date.slice(0, 10) !== date || row.slot_start.slice(0, 5) !== slot || row.term_mode !== 'regular') {
      return { ok: false, error: '그 사이 이 줄이 바뀌었습니다 — 새로고침 후 다시 눌러 주세요' };
    }
    const norm = v => String(v ?? '').trim().toLowerCase();
    const one = await guarded(sql, s => shiftActualLines({ ...ctx, sql: s }, { classId, date, slot, kind, only: r => String(r.skill_area ?? '') === String(row.skill_area ?? '') && norm(r.textbook) === norm(row.textbook) }),
      { ok: false, error: LOAD_FAILED, noContent: false, chain: [] });
    if (!one.ok) return { ok: false, error: one.error, undo: one.stopped ? await undoSince() : undefined, historyId };
    return finishShift(one.moved);
  }
  // ① 실제 줄을 옮긴다. 옮길 줄이 아예 없으면(아직 가져오기 전) 표식만 남긴다.
  const moved = await guarded(sql, s => shiftActualLines({ ...ctx, sql: s }, { classId, date, slot, kind }), { ok: false, error: LOAD_FAILED, noContent: false, chain: [] });
  if (!moved.ok && !moved.noContent) return { ok: false, error: moved.error, undo: moved.stopped ? await undoSince() : undefined, historyId };
  // ② 표식 — 순(net) 횟수를 맞춘다: 반대 표식이 누른 칸에 있으면 지우고, 아니면 비어 있는 첫 칸에 더한다(칸 표식만 센다).
  const marks = moved.chain.length ? await sql`select ${markerCols(sql)} from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and slot_start=${slot} and plan_date = any(${moved.chain}::date[])` : [];
  const at = new Map(marks.filter(m => R.parseMarkerKey(R.markerKeyOfRow(m))?.lane === '').map(m => [String(m.plan_date).slice(0, 10), String(m.kind)]));
  const opposite = kind === 'skip' ? 'advance' : 'skip';
  const write = (d, k) => tryWrite(sql, s => writeMarker(s, t, R, classId, R.cellMarkerKey(d, slot), k, user.id));
  let markerError = null;
  if (at.get(date) === opposite) ({ error: markerError } = await write(date, null));
  else { const free = moved.chain.find(d => !at.has(d)); if (free) ({ error: markerError } = await write(free, kind)); }
  // 줄은 이미 옮겼으니 표식 실패는 화면을 막지 않는다 — 단 줄이 없어 표식이 전부였다면 실패를 알린다.
  if (markerError && !moved.ok) return { ok: false, error: MARK_FAILED };
  return finishShift(moved.ok ? moved.moved : 0);
}

/** 이 화면의 2.0 서버 액션 — 이름·모듈·인자 = 2.0. */
export const SHIFT_ACTIONS = {
  setLessonShift: serverFn(MODULE, 1, (ctx, input) => setLessonShift(ctx, input)),
};
