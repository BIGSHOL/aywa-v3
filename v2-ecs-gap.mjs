// 2.0 화면 · 강사 시트(ECS) — 계획 대비 현황(/ecs/plan-gap). 2.0 `ecs/plan-gap/page.tsx`가 그리는 재료 = `getPlanGapBoard(month)`
// (features/textbooks/server/plan-gap.ts)의 반환 그대로 + 화면 언어의 강사 영어 이름. 화면에 클라이언트 부품이 PeriodNav·Link뿐이라
// 표 조립은 호스트(ecs-page.tsx EcsPlanGapPage)가 page.tsx JSX를 그대로 옮긴다.
// 조회 = 2.0 loadPlanMaterials(여러 반 한 번에: 배정 · 미루기 표식 · 교재 · 차수 · 시간표(담당 FK 포함)) + 그 달 실제 평시 줄을 SQL로,
// 판정 = 2.0 순수 함수(compareCell · addToTally · expandPlans · slotsByDateOf · resolveTeacherLabel …) 그대로. 읽기만 — 저장 없음.
import { readNames } from './v2-ecs-core.mjs';
import { visibleClassFilter } from './v2-ecs-props.mjs';

/** 2.0 plan-gap.ts UNKNOWN_TEACHER — 담당을 모르는 교시의 묶음 이름(화면이 번역한다). */
export const UNKNOWN_TEACHER = '__unknown__';

/** 2.0 loadPlanMaterials({ tenantId, classIds, to }) — classIds가 null이면 배정이 있는 반 전부. 같은 정렬(배정 = 만든 순 · 시간표 = 요일 글자·시작시각 순). */
export async function planMaterials(sql, t, R, env, classIdsIn, to) {
  const cols = sql`id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode, start_date::text start_date, start_lesson_no, slot_picks`;
  const plans = classIdsIn
    ? (classIdsIn.length ? await sql`select ${cols} from public.class_textbook_plans where tenant_id=${t} and is_active and class_id = any(${classIdsIn}::uuid[]) order by created_at` : [])
    : await sql`select ${cols} from public.class_textbook_plans where tenant_id=${t} and is_active order by id`;
  const classIds = classIdsIn ? [...classIdsIn] : [...new Set(plans.map(p => p.class_id))];
  const byClass = new Map(classIds.map(id => [id, { plans: [], scheduleRows: [], schedules: [], shifts: {} }]));
  for (const p of plans) byClass.get(p.class_id)?.plans.push(p);
  const empty = { status: 'ok', byClass, books: new Map(), lessonsByBook: new Map(), holidays: {} };
  if (classIds.length === 0) return empty;
  const bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [shiftRows, bookRows, lessonRows, schedRows] = await Promise.all([
    sql`select class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos from public.class_lesson_shifts where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and plan_date <= ${to} order by id`,
    bookIds.length ? sql`select id::text id, title, page_time, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])` : [],
    bookIds.length ? sql`select textbook_id::text textbook_id, lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id = any(${bookIds}::uuid[]) order by textbook_id, lesson_no` : [],
    sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        slot_teacher_label, slot_room_label, teacher_id::text teacher_id from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) order by id`,
  ]);
  for (const r of shiftRows) { const m = byClass.get(r.class_id); if (m) m.shifts[R.markerKeyOfRow(r)] = String(r.kind) === 'advance' ? 'advance' : 'skip'; }
  // 2.0과 같은 정렬 — 요일 글자(String) 같으면 시작시각, 아니면 요일 글자 순(안정 정렬 = id 순 유지).
  const sorted = [...schedRows].sort((a, b) => (a.day_of_week === b.day_of_week ? a.start_time.localeCompare(b.start_time) : a.day_of_week.localeCompare(b.day_of_week)));
  for (const r of sorted) {
    const m = byClass.get(r.class_id); if (!m) continue;
    m.scheduleRows.push(r);
    m.schedules.push({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time ?? null, validFrom: r.valid_from ?? null, validTo: r.valid_to ?? null, slotTeacherLabel: r.slot_teacher_label ?? null, slotRoomLabel: r.slot_room_label ?? null });
  }
  const books = new Map(bookRows.map(b => [b.id, { title: String(b.title), pageTime: b.page_time ?? null, skillArea: b.skill_area ?? null, sessionCount: Number(b.session_count ?? 0) }]));
  const lessonsByBook = new Map();
  for (const l of lessonRows) { const m = lessonsByBook.get(l.textbook_id) ?? new Map(); m.set(Number(l.lesson_no), { progress: l.progress ?? null, homework: l.homework ?? null }); lessonsByBook.set(l.textbook_id, m); }
  return { status: 'ok', byClass, books, lessonsByBook, holidays: env.holidays };
}
/** 2.0 planCellsOf(materials, classId, from, to). */
export function planCellsOf(R, materials, classId, from, to) {
  const m = materials.byClass.get(classId);
  if (!m) return { byCell: {}, baselineByCell: {}, lessonIndex: {}, shiftByCell: {} };
  const common = { plans: m.plans, books: materials.books, lessonsByBook: materials.lessonsByBook, schedules: m.schedules, holidays: materials.holidays, from, to };
  return { byCell: m.plans.length === 0 ? {} : R.expandPlans({ ...common, shifts: m.shifts }), baselineByCell: m.plans.length === 0 ? {} : R.expandPlans({ ...common, shifts: null }),
    lessonIndex: R.lessonIndexOf(m.plans, materials.books, materials.lessonsByBook), shiftByCell: R.cellShiftSummary(m.shifts) };
}

/** 2.0 getPlanGapBoard(monthRaw) — 같은 거르기·판정·묶음·정렬. 오늘 = 복사본 기준일. */
export async function planGapData(sql, t, R, env, viewer, monthRaw, today) {
  const month = R.normalizeMonth(monthRaw, today.slice(0, 7));
  const { from, to } = R.monthRange(month);
  const visible = await visibleClassFilter(sql, t, R, viewer, null, today);
  const materials = await planMaterials(sql, t, R, env, visible.classIds, to);
  const classIds = [...materials.byClass.entries()].filter(([, m]) => m.plans.length > 0).map(([id]) => id);
  if (classIds.length === 0) return { ok: true, month, today, teachers: [], total: R.emptyTally(), classCount: 0 };
  const [classRows, actualRows] = await Promise.all([
    sql`select id::text id, class_name, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select id::text id, class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, skill_area, textbook, progress from public.class_sheet_plan_lines
      where tenant_id=${t} and term_mode='regular' and class_id = any(${classIds}::uuid[]) and plan_date >= ${from} and plan_date <= ${to} order by id`,
  ]);
  // 담당 표시 이름 — 월간 달력과 같은 순서(라벨 → 교시 담당 FK → 담임).
  const userIds = new Set();
  for (const c of classRows) if (c.teacher_id) userIds.add(c.teacher_id);
  for (const id of classIds) for (const r of materials.byClass.get(id)?.scheduleRows ?? []) if (r.teacher_id) userIds.add(r.teacher_id);
  const [names, userRows] = await Promise.all([readNames(sql, t, R).catch(() => null),
    userIds.size ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...userIds]}::uuid[])`.catch(() => []) : []]);
  const labelMap = names?.labelMap, nameOf = new Map(userRows.map(u => [u.id, u.display_name ?? null]));
  const actualByCell = new Map();
  for (const r of actualRows) {
    const key = `${r.class_id}#${R.slotKey(r.plan_date.slice(0, 10), r.slot_start)}`, list = actualByCell.get(key) ?? [];
    list.push({ skillArea: String(r.skill_area), textbook: r.textbook ?? null, progress: r.progress ?? null }); actualByCell.set(key, list);
  }
  const dates = R.rangeDates(from, to), teacherMap = new Map(), classById = new Map(classRows.map(c => [c.id, c]));
  for (const classId of classIds) {
    const cls = classById.get(classId), m = materials.byClass.get(classId);
    if (!cls || !m) continue;
    const homeroom = cls.teacher_id ? (nameOf.get(cls.teacher_id) ?? null) : null;
    const named = m.scheduleRows.map((r, i) => {
      const label = R.resolveTeacherLabel(r.slot_teacher_label ?? null, labelMap), fk = r.teacher_id ? (nameOf.get(r.teacher_id) ?? null) : null;
      return { ...m.schedules[i], slotTeacherLabel: label ?? fk ?? homeroom };
    });
    const slots = R.slotsByDateOf(dates, named), { baselineByCell, lessonIndex } = planCellsOf(R, materials, classId, from, to);
    for (const [key, baseline] of Object.entries(baselineByCell)) {
      const [date, slotStart] = key.split('|');
      const c = R.compareCell({ baseline, actual: actualByCell.get(`${classId}#${key}`) ?? [], lessonIndex, isFuture: date > today });
      const slot = (slots[date] ?? []).find(s => s.slotStart === slotStart), teacher = slot?.teacherLabel ?? homeroom ?? UNKNOWN_TEACHER;
      const byClass = teacherMap.get(teacher) ?? new Map(); teacherMap.set(teacher, byClass);
      const row = byClass.get(classId) ?? { classId, className: cls.class_name, tally: R.emptyTally(), misses: [] }; byClass.set(classId, row);
      R.addToTally(row.tally, c);
      if (c.verdict !== 'match' && c.verdict !== 'upcoming' && c.verdict !== 'noPlan') row.misses.push({ date, slotStart, verdict: c.verdict, lag: c.lag });
    }
  }
  const total = R.emptyTally();
  const teachers = [...teacherMap.entries()].map(([teacher, byClass]) => {
    const tally = R.emptyTally(), classes = [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className, 'ko'));
    for (const c of classes) { c.misses.sort((a, b) => (a.date === b.date ? a.slotStart.localeCompare(b.slotStart) : a.date.localeCompare(b.date))); R.mergeTally(tally, c.tally); }
    R.mergeTally(total, tally);
    return { teacher, tally, classes };
  });
  const misses = x => x.due - x.match;
  teachers.sort((a, b) => misses(b.tally) - misses(a.tally) || a.teacher.localeCompare(b.teacher, 'ko'));
  return { ok: true, month, today, teachers, total, classCount: classIds.length };
}
