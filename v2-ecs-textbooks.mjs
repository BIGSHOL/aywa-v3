// 2.0 화면 · 강사 시트(ECS) — 교재 배정 창(TextbookFillDialog · TextbookFillExisting)이 여는 읽기 셋. 2.0 textbooks/server/plan-actions.ts의
// loadClassSlotChoices · loadClassTextbookPlans · loadAssignableTextbooks(속은 queries.ts getClassSlotChoices · getClassTextbookPlans · getAssignableTextbooks)와
// 같은 게이트·같은 조회·같은 반환 모양. 호스트는 이 셋을 저장 경로가 아니라 화면 GET(?read=slotChoices|textbookPlans|assignable)으로 묻는다.
// ctx = { sql, t, R, env, user, today } — screen.load가 만든다(읽기 전용 트랜잭션).
import { classAccess, readNames } from './v2-ecs-core.mjs';
import { visibleClassFilter } from './v2-ecs-props.mjs';
import { audit, serverFn } from './v2-ecs-save.mjs';
import { planMaterials } from './v2-ecs-gap.mjs';

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

// ── 교재 배정 기입 — 2.0 applyTextbookFill = saveClassTextbookPlan(배정 저장) + getClassImportLines(그 배정의 일정) + writePlannedCells(실제 빈 칸) ──
const TEXTBOOKS_NOT_READY = '교재목록 표가 아직 만들어지지 않았습니다 — 마이그레이션 0266a를 적용해 주세요';
const SAME_BOOK_NOT_READY = '같은 교재를 한 반에 여러 개 거는 기능은 DB 업데이트(0436a) 뒤에 열립니다 — 지금은 한 반에 한 개만 걸 수 있습니다';
/** 2.0 friendlyTextbookError(access.ts) — 표 없음 · 유니크 · 참조 · CHECK. 그 밖은 같은 자리의 기본 문구(2.0 explainDbError의 제약별 문장은 옮기지 않았다). */
export function friendlyTextbookError(error, fallback, duplicate) {
  const msg = String(error?.message ?? ''), code = error?.code;
  if (code === '42P01' || (/textbooks|textbook_lessons|class_textbook_plans|ecs_apply_textbook_lessons/.test(msg) && /not find|does not exist|schema cache/i.test(msg))) return TEXTBOOKS_NOT_READY;
  if (code === '23505') return duplicate ?? '이미 같은 이름의 교재가 있습니다';
  if (code === '23503') return '다른 기록이 참조하고 있어 처리할 수 없습니다';
  if (code === '23514') return '입력 값이 규칙에 맞지 않습니다(길이·형식을 확인하세요)';
  return fallback;
}
/** DB가 거절하면 트랜잭션을 깨지 않고 2.0처럼 오류를 돌려받는다 — 저장점 안에서. */
export async function tryWrite(sql, fn) { try { return { value: await sql.savepoint(fn) }; } catch (error) { return { error }; } }
const isPaceRejected = e => e?.code === '23514' && /pace_chk/.test(String(e?.message ?? ''));

/** 2.0 saveClassTextbookPlan(input) — 같은 (반, 교재) 배정은 3개까지(placeSameBookPlan), 지난 시작일은 이번에 바뀐 때만 거절. */
export async function saveClassTextbookPlan(ctx, input) {
  const { sql, t, R, env, user, today } = ctx;
  const gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!env.textbooksOn) return { ok: false, error: '이 학원은 교재목록 기능이 꺼져 있습니다' };
  if (!R.YMD_RE.test(str(input.startDate))) return { ok: false, error: '시작일을 골라 주세요' };
  const slotPicks = R.normalizeSlotPicks(input.slotPicks);
  if ((input.slotPicks ?? []).length > 0 && slotPicks.length === 0) return { ok: false, error: '교시를 다시 골라 주세요' };
  if (slotPicks.length > MAX_SLOT_PICKS) return { ok: false, error: `한 배정에 교시를 ${MAX_SLOT_PICKS}칸까지 고를 수 있습니다` };
  const axis = input.slotAxis === 'jj' ? 'jj' : 'class', pace = R.normalizeLessonPace(input.pace), termMode = input.termMode === 'exam' ? 'exam' : 'regular';
  const startLessonNo = Math.max(1, Math.min(200, Math.trunc(Number(input.startLessonNo) || 1))), classId = gate.access.classId;
  if (input.startDate < today) {
    const prev = input.id && UUID_RE.test(input.id) ? (await sql`select start_date::text start_date from public.class_textbook_plans where tenant_id=${t} and id=${input.id}`)[0]?.start_date ?? null : null;
    if (String(prev ?? '') !== input.startDate) return { ok: false, error: '시작일을 지난 날짜로 잡을 수 없습니다 — 지난 날짜에 기입하면 그 달 작성률이 뒤늦게 바뀝니다' };
  }
  const [book] = UUID_RE.test(str(input.textbookId)) ? await sql`select id::text id, title, skill_area, session_count from public.textbooks where tenant_id=${t} and id=${input.textbookId}` : [];
  if (!book) return { ok: false, error: '교재를 찾을 수 없습니다' };
  if (!book.skill_area) return { ok: false, error: '이 교재에 구분이 없어 반에 배정할 수 없습니다 — 교재목록에서 구분을 먼저 정하세요' };
  if (Number(book.session_count ?? 0) < 1) return { ok: false, error: '이 교재에 차수가 없습니다 — 교재목록에서 차수를 먼저 정하세요' };
  const payload = { class_id: classId, textbook_id: input.textbookId, slot_axis: axis, pace, term_mode: termMode, start_date: input.startDate, start_lesson_no: startLessonNo };
  const withSlots = slotPicks.length > 0 ? { ...payload, slot_picks: slotPicks } : payload;
  const siblings = (await sql`select id::text id, slot_picks from public.class_textbook_plans where tenant_id=${t} and class_id=${classId} and textbook_id=${input.textbookId} and is_active order by created_at`)
    .map(r => ({ id: r.id, slotPicks: Array.isArray(r.slot_picks) && r.slot_picks.length > 0 ? r.slot_picks.map(String) : null }));
  const placement = R.placeSameBookPlan({ picks: slotPicks.length > 0 ? slotPicks : null, siblings, selfId: input.id ?? null });
  if (placement.kind === 'error') return { ok: false, error: placement.error };
  if (placement.kind === 'update') {
    const targetId = placement.id, update = row => tryWrite(sql, s => s`update public.class_textbook_plans set ${s(row)} where tenant_id=${t} and id=${targetId}`);
    let res = await update(withSlots);
    if (isPaceRejected(res.error) && pace === 'min25') res = await update({ ...withSlots, pace: 'period' });
    if (res.error) return { ok: false, error: friendlyTextbookError(res.error, '배정을 수정하지 못했습니다', '이 반에 같은 교재가 이미 배정돼 있습니다') };
    await audit(sql, t, user, 'textbook_plan_update', 'class', gate.access.className, { id: targetId, textbookId: input.textbookId, slots: slotPicks });
    return { ok: true, id: targetId };
  }
  const insert = row => tryWrite(sql, s => s`insert into public.class_textbook_plans ${s({ ...row, tenant_id: t, created_by: user.id })} returning id::text id`);
  let res = await insert(withSlots);
  if (isPaceRejected(res.error) && pace === 'min25') res = await insert({ ...withSlots, pace: 'period' });
  if (res.error || !res.value?.[0]) return { ok: false, error: friendlyTextbookError(res.error ?? {}, '배정을 만들지 못했습니다', SAME_BOOK_NOT_READY) };
  const id = res.value[0].id;
  await audit(sql, t, user, 'textbook_plan_create', 'class', gate.access.className, { id, textbookId: input.textbookId, axis, pace, slots: slotPicks });
  return { ok: true, id };
}

/** 2.0 snapshotPlanLines — 되돌리기 기록용 그 기간 줄(IMPORT_FIELDS). */
const snapshotPlanLines = (sql, t, classId, from, to) => sql`select id::text id, updated_by::text updated_by, textbook, page_range, progress, homework from public.class_sheet_plan_lines
  where tenant_id=${t} and class_id=${classId} and plan_date >= ${from} and plan_date <= ${to} order by id`;
/** 2.0 recordImportBatch — 앞뒤 차이(diffImport) + 배정 표식을 class_plan_import_batches 한 줄로. 바뀐 게 없고 배정도 없으면 null. */
async function recordImportBatch(ctx, { classId, from, to, before, plan }) {
  const { sql, t, R, user } = ctx;
  const after = await snapshotPlanLines(sql, t, classId, from, to);
  const rows = R.diffImport(new Map(before.map(r => [r.id, r])), after, user.id);
  if (rows.length === 0 && !plan) return null;
  const meta = plan ? [{ kind: 'plan', planId: plan.id, title: plan.title }] : [];
  const [row] = await sql`insert into public.class_plan_import_batches (tenant_id, class_id, period_from, period_to, rows, row_count, created_by)
    values (${t}, ${classId}, ${from}, ${to}, ${sql.json([...meta, ...rows])}, ${rows.length}, ${user.id}) returning id::text id`;
  return row?.id ?? null;
}
/** 2.0 applyCellLessons — 칸마다 첫 차수는 RPC(ecs_apply_textbook_lessons, 100칸씩), 한 칸 여러 차수는 planCellExtras로 채움·새 줄. */
async function applyCellLessons(ctx, { classId, termMode, book, cells: rawCells }) {
  const { sql, t, R, user } = ctx;
  const cells = rawCells.filter(c => c.lessons.length > 0), total = { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0 };
  const firsts = cells.map(c => ({ date: c.date, slot: c.slot, ...c.lessons[0] }));
  for (let i = 0; i < firsts.length; i += 100) {
    const [{ r }] = await sql`select public.ecs_apply_textbook_lessons(${t}::uuid, ${user.id}::uuid, ${classId}::uuid, ${termMode}::text, ${book.skillArea}::text, ${book.title}::text, ${book.pageTime}::text, ${sql.json(firsts.slice(i, i + 100))}::jsonb) r`;
    for (const k of Object.keys(total)) total[k] += Number(r?.[k] ?? 0);
  }
  const sameTitle = (a, b) => String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
  for (const c of cells) {
    if (c.lessons.length < 2) continue;
    const rows = await sql`select id::text id, skill_area, line_no, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id=${classId} and plan_date=${c.date} and slot_start=${c.slot} and term_mode=${termMode} order by line_no`;
    const lines = rows.filter(r => r.skill_area === book.skillArea && sameTitle(r.textbook, book.title)).map(r => ({ id: r.id, textbook: r.textbook ?? null, pageRange: r.page_range ?? null, progress: r.progress ?? null, homework: r.homework ?? null }));
    const plan = R.planCellExtras({ lessons: c.lessons, lines, title: book.title, pageTime: book.pageTime });
    for (const u of plan.updates) { await sql`update public.class_sheet_plan_lines set ${sql({ ...u.patch, updated_by: user.id, updated_at: new Date() })} where tenant_id=${t} and id=${u.id}`; total.filled += 1; total.applied += 1; }
    for (const want of plan.creates) {
      const created = await tryWrite(sql, s => s`select * from public.ecs_create_plan_line(${t}::uuid, ${user.id}::uuid, ${classId}::uuid, ${c.date}::date, ${c.slot}::time, ${termMode}::text, ${book.skillArea}::text)`);
      if (created.error) { if (String(created.error.message ?? '').includes('ECS_MAX_LINES')) { total.truncated += 1; continue; } throw created.error; }
      const fresh = created.value.filter(r => r.term_mode === termMode && r.skill_area === book.skillArea && ![r.textbook, r.page_range, r.progress, r.homework].some(v => String(v ?? '').trim() !== ''))
        .sort((a, b) => Number(b.line_no) - Number(a.line_no))[0];
      if (!fresh) { total.skipped += 1; continue; }
      await sql`update public.class_sheet_plan_lines set textbook=${book.title.trim()}, page_range=${book.pageTime?.trim() || null}, progress=${want.progress}, homework=${want.homework}, updated_by=${user.id}, updated_at=now()
        where tenant_id=${t} and id=${String(fresh.id)}`;
      total.added += 1; total.applied += 1;
    }
  }
  return total;
}
/** 2.0 writePlannedCells — 교재마다(시기·구분·교재명) 따로 · 되돌리기 기록에 배정을 함께 싣는다. */
async function writePlannedCells(ctx, { classId, from, to, byCell, plan }) {
  const { sql, t, R } = ctx;
  const cells = Object.keys(byCell).sort(), lines = cells.flatMap(k => byCell[k]), groups = new Map();
  for (const l of lines) { const key = `${l.termMode}|${l.skillArea}|${l.title.trim().toLowerCase()}`; groups.set(key, [...(groups.get(key) ?? []), l]); }
  const before = await snapshotPlanLines(sql, t, classId, from, to);
  const total = { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0 };
  for (const group of groups.values()) {
    const head = group[0];
    const out = await tryWrite(sql, s => applyCellLessons({ ...ctx, sql: s }, { classId, termMode: head.termMode, book: { skillArea: head.skillArea, title: head.title, pageTime: head.pageTime }, cells: R.groupCellLessons(group) }));
    if (out.error) return { ok: false, error: friendlyTextbookError(out.error, '가져오지 못했습니다') };
    for (const k of Object.keys(total)) total[k] += out.value[k];
  }
  const undoBatchId = total.added + total.filled > 0 || plan ? await recordImportBatch(ctx, { classId, from, to, before, plan }) : null;
  return { ok: true, result: total, cells: cells.length, undoBatchId };
}
/** 2.0 getClassImportLines — 그 배정 하나의 일정(미루기 반영)을 from부터 끝 차수까지 + 실제로 닿은 마지막 날. */
async function importLines(ctx, { classId, from, to, planId }) {
  const { sql, t, R, env } = ctx;
  if (!from || !to || from > to) return { status: 'ok', byCell: {}, lastDate: to };
  const horizon = R.addDays(to, R.MAX_LOOKAHEAD_DAYS), materials = await planMaterials(sql, t, R, env, [classId], horizon), m = materials.byClass.get(classId);
  const plans = m?.plans.filter(p => String(p.id) === planId);
  if (!m || !plans || plans.length === 0) return { status: 'ok', byCell: {}, lastDate: to };
  const byCell = R.expandPlans({ plans, books: materials.books, lessonsByBook: materials.lessonsByBook, schedules: m.schedules, holidays: materials.holidays, shifts: m.shifts, from, to: horizon });
  return { status: 'ok', byCell, lastDate: Object.keys(byCell).reduce((max, k) => (k.slice(0, 10) > max ? k.slice(0, 10) : max), to) };
}
/** 2.0 applyTextbookFill(input) — 계산이 되는지 먼저 → 배정 저장 → 오늘(또는 시작일)부터 그 배정의 차수를 실제 빈 칸에 → textbook_plan_apply. */
export async function applyTextbookFill(ctx, input) {
  const loaded = await loadFillInput(ctx, input);
  if ('error' in loaded) return { ok: false, error: loaded.error };
  const computed = await computeTargets(ctx, loaded);
  if ('error' in computed) return { ok: false, error: computed.error };
  const { today, sql, t, user } = ctx, upcoming = computed.targets.filter(x => x.date >= today);
  if (upcoming.length === 0) return { ok: false, error: '배정할 칸이 없습니다 — 고른 교시에 남은 수업일이 없습니다' };
  const saved = await saveClassTextbookPlan(ctx, { classId: loaded.plan.classId, textbookId: loaded.plan.textbookId, slotAxis: 'class', slotPicks: loaded.plan.slotPicks ?? [],
    pace: loaded.plan.pace, termMode: loaded.plan.termMode, startDate: loaded.plan.startDate, startLessonNo: loaded.plan.startLessonNo });
  if (!saved.ok) return { ok: false, error: saved.error };
  const importFrom = loaded.plan.startDate > today ? loaded.plan.startDate : today;
  const planned = await importLines(ctx, { classId: loaded.plan.classId, from: importFrom, to: importFrom, planId: saved.id });
  const written = planned.status === 'ok' && Object.keys(planned.byCell).length > 0
    ? await writePlannedCells(ctx, { classId: loaded.plan.classId, from: importFrom, to: planned.lastDate, byCell: planned.byCell, plan: { id: saved.id, title: computed.title } }) : null;
  await audit(sql, t, user, 'textbook_plan_apply', 'class', loaded.gate.access.className, { planId: saved.id, textbook: computed.title, planned: upcoming.length, from: today,
    ...(written?.ok ? { imported: written.result.added + written.result.filled, through: planned.lastDate } : {}) });
  if (!written || !written.ok) {
    const importError = written && !written.ok ? written.error : planned.status === 'ok' ? null : '월간계획을 읽지 못했습니다';
    return { ok: true, result: { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0, planned: upcoming.length }, importError, undoBatchId: null };
  }
  return { ok: true, result: { ...written.result, planned: upcoming.length }, importError: null, undoBatchId: written.undoBatchId };
}

/** 2.0 plan-actions.ts의 저장 아닌 함수 — previewTextbookFill(input): 시트에서 고른 그대로 미리보기(저장 없음, 그 반 ECS 쓰기 게이트). */
export const TEXTBOOK_ACTIONS = {
  previewTextbookFill: serverFn('features/textbooks/server/plan-actions.ts', 1, async (ctx, input) => {
    const loaded = await loadFillInput(ctx, input);
    if ('error' in loaded) return { ok: false, error: loaded.error };
    return previewLoaded(ctx, loaded, '');
  }),
  /** applyTextbookFill(input) — 배정 저장 + 실제 빈 칸 기입 + 되돌리기 기록 · textbook_plan_create|update · textbook_plan_apply. */
  applyTextbookFill: serverFn('features/textbooks/server/plan-actions.ts', 1, (ctx, input) => applyTextbookFill(ctx, input)),
};
