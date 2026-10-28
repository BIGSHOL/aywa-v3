// 2.0 화면 · 강사 시트(ECS) — 교재 배정 창(TextbookFillDialog · TextbookFillExisting)이 여는 읽기 셋. 2.0 textbooks/server/plan-actions.ts의
// loadClassSlotChoices · loadClassTextbookPlans · loadAssignableTextbooks(속은 queries.ts getClassSlotChoices · getClassTextbookPlans · getAssignableTextbooks)와
// 같은 게이트·같은 조회·같은 반환 모양. 호스트는 이 셋을 저장 경로가 아니라 화면 GET(?read=slotChoices|textbookPlans|assignable)으로 묻는다.
// ctx = { sql, t, R, env, user, today } — screen.load가 만든다(읽기 전용 트랜잭션).
import { classAccess, readNames } from './v2-ecs-core.mjs';
import { visibleClassFilter } from './v2-ecs-props.mjs';
import { serverFn } from './v2-ecs-save.mjs';

const str = v => (typeof v === 'string' ? v : '');

/** loadClassSlotChoices(classId) — 그 반이 오늘 도는 교시(시각 × 담당 칩, LAB 제외). 종료가 갈리면 교시 이름을 비운다. */
export async function readSlotChoices({ sql, t, R, env, user, today }, classId) {
  const gate = await classAccess(sql, t, R, env, user, str(classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  const [sched, names] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, slot_teacher_label from public.class_schedules
      where tenant_id=${t} and class_id=${gate.access.classId} and valid_from <= ${today} and (valid_to is null or valid_to >= ${today}) order by start_time, id limit 300`,
    readNames(sql, t, R).catch(() => null),
  ]);
  const labelMap = names?.labelMap, periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const tables = { weekday: R.tableToEntries(R.weekdayTableFor(gate.access.subject, periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const acc = new Map();
  for (const r of sched) {
    const label = r.slot_teacher_label ?? '', seat = R.specialSlotLabel(label || null);
    if (seat === 'LAB') continue;
    const start = r.start_time.slice(0, 5), dow = r.day_of_week, key = `${start}|${label}`;
    const cur = acc.get(key) ?? { start, label, ends: new Set(), dows: [], weekend: false };
    cur.ends.add(r.end_time ? r.end_time.slice(0, 5) : '');
    if (!cur.dows.includes(dow)) cur.dows.push(dow);
    if (R.isWeekendDow(dow)) cur.weekend = true;
    acc.set(key, cur);
  }
  const rows = [...acc.entries()].map(([key, a]) => {
    const onlyEnd = a.ends.size === 1 ? ([...a.ends][0] ?? '') : null, seat = R.specialSlotLabel(a.label || null);
    return { key, start: a.start, periodLabel: onlyEnd === null ? null : R.resolvePeriodLabel(a.start, onlyEnd || null, tables, a.weekend), seat: seat === 'JJ' ? 'JJ' : null,
      teacherLabel: a.label ? (R.resolveTeacherLabel(a.label, labelMap) ?? a.label) : null, dows: a.dows, picks: a.dows.map(d => R.slotPickKey(d, a.start)) };
  });
  return { ok: true, rows: rows.sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : (a.teacherLabel ?? '').localeCompare(b.teacherLabel ?? '', 'ko'))) };
}

/** loadClassTextbookPlans(classId) — 그 반에 걸린 배정(시작일 늦은 것 먼저). 교재목록 기능이 꺼진 학원은 빈 목록. */
export async function readClassTextbookPlans({ sql, t, R, env, user, today }, classId) {
  const gate = await classAccess(sql, t, R, env, user, str(classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!env.textbooksOn) return { ok: true, rows: [] };
  const scope = await visibleClassFilter(sql, t, R, user, null, today);
  if (scope.classIds !== null && scope.classIds.length === 0) return { ok: true, rows: [] };
  const plans = await sql`select id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode, start_date::text start_date, start_lesson_no, is_active, last_applied_at, slot_picks
    from public.class_textbook_plans where tenant_id=${t} and is_active and class_id=${gate.access.classId} order by start_date desc, id`;
  if (plans.length === 0) return { ok: true, rows: [] };
  const bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [classes, books] = await Promise.all([
    sql`select id::text id, class_name from public.classes where tenant_id=${t} and id=${gate.access.classId}`,
    sql`select id::text id, title, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])`,
  ]);
  const className = new Map(classes.map(c => [c.id, c.class_name])), bookById = new Map(books.map(b => [b.id, b]));
  return { ok: true, rows: plans.map(p => {
    const book = bookById.get(p.textbook_id);
    return { id: p.id, classId: p.class_id, className: className.get(p.class_id) ?? '(삭제된 반)', textbookId: p.textbook_id, textbookTitle: book?.title ?? '(삭제된 교재)',
      skillArea: book?.skill_area ?? null, sessionCount: Number(book?.session_count ?? 0), slotAxis: p.slot_axis === 'jj' ? 'jj' : 'class',
      slotPicks: Array.isArray(p.slot_picks) && p.slot_picks.length > 0 ? p.slot_picks.map(String) : null, pace: R.normalizeLessonPace(p.pace),
      termMode: p.term_mode === 'exam' ? 'exam' : 'regular', startDate: p.start_date, startLessonNo: Number(p.start_lesson_no ?? 1), isActive: p.is_active,
      lastAppliedAt: p.last_applied_at ? new Date(p.last_applied_at).toISOString() : null };
  }) };
}

/** loadAssignableTextbooks() — 교재목록 메뉴 접근이면 영어 교재 중 구분 있음·차수 ≥ 1(제목순, 500개). */
export async function readAssignableTextbooks({ sql, t, user }) {
  if (user.levels.textbooks === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const rows = await sql`select id::text id, title, skill_area, session_count from public.textbooks
    where tenant_id=${t} and subject='english' and session_count >= 1 and skill_area is not null order by title limit 500`;
  return { ok: true, rows: rows.map(r => ({ id: r.id, title: String(r.title), skillArea: r.skill_area ?? null, sessionCount: Number(r.session_count ?? 0) })) };
}

// ── 교재 배정 미리보기 — 2.0 plan-actions.ts loadFillInput → computeTargets → previewLoaded(저장 없음) ──────────────
const MAX_SLOT_PICKS = 48, MAX_LINES_PER_SLOT = 20, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 2.0 loadFillInput — 그 반 ECS 쓰기 게이트 · 교재목록 기능 · 시작일 · 고른 교시(비면 거절, 48칸까지). */
export async function loadFillInput({ sql, t, R, env, user }, raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { error: gate.error };
  if (!env.textbooksOn) return { error: '이 학원은 교재목록 기능이 꺼져 있습니다' };
  if (!R.YMD_RE.test(str(input.startDate))) return { error: '시작일을 골라 주세요' };
  const slotPicks = R.normalizeSlotPicks(Array.isArray(input.slotPicks) ? input.slotPicks.map(String) : []);
  if (slotPicks.length === 0) return { error: '교시를 하나 이상 골라 주세요' };
  if (slotPicks.length > MAX_SLOT_PICKS) return { error: `한 번에 교시를 ${MAX_SLOT_PICKS}칸까지 고를 수 있습니다` };
  return { gate, plan: { id: '', classId: gate.access.classId, textbookId: str(input.textbookId), axis: 'class', pace: R.normalizeLessonPace(input.pace),
    termMode: input.termMode === 'exam' ? 'exam' : 'regular', startDate: input.startDate, startLessonNo: Math.max(1, Math.min(200, Math.trunc(Number(input.startLessonNo) || 1))), slotPicks } };
}
/** 2.0 computeTargets — 배정 → 어디에 무엇을 넣을지(미리보기와 기입이 같은 함수). */
export async function computeTargets({ sql, t, R, env }, { gate, plan }) {
  if (!UUID_RE.test(plan.textbookId)) return { error: '교재를 찾을 수 없습니다' };
  const [[book], sched] = await Promise.all([
    sql`select title, page_time, skill_area, session_count from public.textbooks where tenant_id=${t} and id=${plan.textbookId}`,
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${plan.classId} order by day_of_week, start_time limit 500`,
  ]);
  if (!book) return { error: '교재를 찾을 수 없습니다' };
  const skillArea = book.skill_area ?? null;
  if (!skillArea) return { error: '이 교재에 구분이 없어 기입할 수 없습니다' };
  const sessionCount = Number(book.session_count ?? 0);
  if (sessionCount < 1) return { error: '이 교재에 차수가 없습니다' };
  const lessons = await sql`select lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id=${plan.textbookId} order by lesson_no`;
  const byNo = new Map(lessons.map(l => [Number(l.lesson_no), l]));
  const lessonNos = [];
  for (let n = plan.startLessonNo; n <= sessionCount; n += 1) lessonNos.push(n);
  if (lessonNos.length === 0) return { error: '시작 차수가 교재의 마지막 차수보다 뒤입니다' };
  const schedules = sched.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time ?? null, validFrom: r.valid_from ?? null, validTo: r.valid_to ?? null,
    slotTeacherLabel: r.slot_teacher_label ?? null, slotRoomLabel: r.slot_room_label ?? null }));
  const schedule = R.buildLessonSchedule({ startDate: plan.startDate, lessonNos, schedules, holidays: env.holidays, axis: plan.axis, slotPicks: plan.slotPicks, pace: plan.pace, lookaheadDays: R.MAX_LOOKAHEAD_DAYS });
  // 한 배정엔 같은 담당의 교시만 — 배분 결과의 그 날짜에 살아 있는 행만 센다(#88), 정규화한 원문으로.
  if (plan.slotPicks && plan.slotPicks.length > 0) {
    const labels = new Set(), seen = new Set();
    for (const x of schedule.targets) {
      const key = `${R.dowKeyOf(x.date)}|${x.slotStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = schedules.find(r => r.dayOfWeek === R.dowKeyOf(x.date) && String(r.startTime).slice(0, 5) === x.slotStart
        && R.slotLiveOnDate({ dayOfWeek: r.dayOfWeek, validFrom: r.validFrom, validTo: r.validTo }, x.date));
      labels.add(R.canonicalSlotTeacherLabel(row?.slotTeacherLabel ?? null) ?? '');
    }
    if (labels.size > 1) return { error: '한 배정엔 같은 담당의 교시만 담을 수 있습니다 — 선생님이 다르면 따로 배정해 주세요' };
  }
  const periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const periodTables = { weekday: R.tableToEntries(R.weekdayTableFor(gate.access.subject, periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const periodLabelBySlot = {}, slotEndByKey = new Map();
  for (const x of schedule.targets) {
    const key = `${x.date}|${x.slotStart}`;
    if (periodLabelBySlot[key] !== undefined || slotEndByKey.has(key)) continue;
    const row = schedules.find(s => s.dayOfWeek === R.dowKeyOf(x.date) && String(s.startTime).slice(0, 5) === x.slotStart);
    const end = row?.endTime ? String(row.endTime).slice(0, 5) : null;
    slotEndByKey.set(key, end);
    const label = R.resolvePeriodLabel(x.slotStart, end, periodTables, R.isWeekendDow(R.dowKeyOf(x.date)));
    if (label) periodLabelBySlot[key] = label;
  }
  return { title: String(book.title), pageTime: book.page_time ?? null, skillArea,
    targets: schedule.targets.map(x => { const l = byNo.get(x.lessonNo); return { ...x, progress: (l?.progress ?? null) || null, homework: (l?.homework ?? null) || null }; }),
    unplaced: schedule.unplaced, skippedHolidays: schedule.skippedHolidays, periodLabelBySlot };
}
/** 2.0 previewLoaded — 이미 그 칸에 무엇이 있는지로 결과(새 줄·채움·건너뜀)를 실제 기입과 같은 순서로 맞힌다. */
export async function previewLoaded(ctx, loaded, planId) {
  const computed = await computeTargets(ctx, loaded);
  if ('error' in computed) return { ok: false, error: computed.error };
  const { sql, t, today } = ctx, { gate, plan } = loaded;
  const dates = [...new Set(computed.targets.map(x => x.date))].sort();
  const existing = dates.length === 0 ? [] : await sql`select plan_date::text plan_date, slot_start::text slot_start, skill_area, textbook, page_range, progress, homework
    from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${plan.classId} and term_mode=${plan.termMode} and plan_date >= ${dates[0]} and plan_date <= ${dates[dates.length - 1]}
    order by plan_date, slot_start, line_no, id`;
  const bySlot = new Map();
  for (const row of existing) { const key = `${row.plan_date}|${row.slot_start.slice(0, 5)}`, list = bySlot.get(key) ?? []; list.push(row); bySlot.set(key, list); }
  const plannedAdds = new Map(), has = v => (v ?? '').trim() !== '', sameTitle = v => (v ?? '').trim().toLowerCase() === computed.title.trim().toLowerCase();
  const rows = computed.targets.map(x => {
    const key = `${x.date}|${x.slotStart}`, lines = bySlot.get(key) ?? [];
    const base = { lessonNo: x.lessonNo, date: x.date, slotStart: x.slotStart, periodLabel: computed.periodLabelBySlot[key] ?? null, progress: x.progress, homework: x.homework };
    if (x.date < today) return { ...base, outcome: 'skip-past' };
    const hit = lines.find(l => sameTitle(l.textbook) && l.skill_area === computed.skillArea)
      ?? lines.find(l => l.skill_area === computed.skillArea && !has(l.textbook) && !has(l.page_range) && !has(l.progress) && !has(l.homework));
    if (!hit) {
      const used = lines.length + (plannedAdds.get(key) ?? 0);
      if (used >= MAX_LINES_PER_SLOT) return { ...base, outcome: 'skip-full' };
      plannedAdds.set(key, (plannedAdds.get(key) ?? 0) + 1);
      return { ...base, outcome: 'add' };
    }
    const willFill = !has(hit.textbook) || (!has(hit.page_range) && has(computed.pageTime)) || (!has(hit.progress) && has(x.progress)) || (!has(hit.homework) && has(x.homework));
    return { ...base, outcome: willFill ? 'fill' : 'skip-filled' };
  });
  return { ok: true, preview: { planId, className: gate.access.className, textbookTitle: computed.title, rows, unplaced: computed.unplaced, skippedHolidays: computed.skippedHolidays } };
}

/** 2.0 plan-actions.ts의 저장 아닌 함수 — previewTextbookFill(input): 시트에서 고른 그대로 미리보기(저장 없음, 그 반 ECS 쓰기 게이트). */
export const TEXTBOOK_ACTIONS = {
  previewTextbookFill: serverFn('features/textbooks/server/plan-actions.ts', 1, async (ctx, input) => {
    const loaded = await loadFillInput(ctx, input);
    if ('error' in loaded) return { ok: false, error: loaded.error };
    return previewLoaded(ctx, loaded, '');
  }),
};
