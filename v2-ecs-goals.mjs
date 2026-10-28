// 2.0 화면 · 강사 시트(ECS) — 반 계획 보기(/ecs/goals). 2.0 `ecs/goals/page.tsx`가 부품(GoalsPeriodBar · GoalsRoleSwitch · GoalsTable)에
// 넘기는 값 = `getGoalsBoard(date)`(features/class-sheets/server/goals-board.ts)의 반환 그대로 + 화면 언어의 강사 영어 이름.
// 조회(서버 전용 모듈)는 같은 표·칸·조건을 SQL로 옮기고, 판정·조립은 2.0 순수 함수(lib/goals-board.ts · grid.ts · week.ts · english-track.ts ·
// teacher-label.ts · view-prefs.ts)를 그대로 쓴다. 반 목록 거르기는 반 목록 면과 같은 visibleClassFilter(v2-ecs-props.mjs).
// 저장: 표의 월·주 목표 = upsertGoal · 일 줄 = getEcsDayPlan + 계획 줄 동작(v2-ecs-save.mjs) · 보기 설정 = 아래 둘(2.0 goals-board-actions.ts).
// 2.0과 다른 것: 담임/부담임 필터의 10분 되돌리기(freshRawUiPrefs — 브라우저 쿠키 기록)는 없다(저장된 값 그대로).
import { visibleClassFilter } from './v2-ecs-props.mjs';
import { patchMyEcsPrefs, serverFn } from './v2-ecs-save.mjs';

const GOALS_MODULE = 'features/class-sheets/server/goals-board-actions.ts';

/** 2.0 getGoalsBoard(dateParam) — 같은 순서·같은 거르기·같은 정렬. */
export async function goalsData(sql, t, R, env, viewer, dateParam, today) {
  const level = viewer.levels.ecs;
  if (level === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  const date = dateParam && R.YMD_RE.test(dateParam) ? dateParam : today;
  const weekMonday = R.mondayOf(date), weekSunday = R.shiftDays(weekMonday, 6), monthStart = `${weekMonday.slice(0, 7)}-01`;
  const [classes, scope] = await Promise.all([
    sql`select id::text id, class_name, teacher_id::text teacher_id, english_track from public.classes
      where tenant_id=${t} and subject='english' and is_active and (closed_at is null or closed_at >= ${weekMonday}) order by class_name`,
    visibleClassFilter(sql, t, R, viewer, weekMonday, today),
  ]);
  const areas = env.skillAreas;
  const role = R.readEcsGoalsRole(viewer.uiPrefs), view = R.readEcsGoalsView(viewer.uiPrefs);
  const scopeSet = scope.classIds ? new Set(scope.classIds) : null;
  const candidates = R.keepEnglishTrack(classes.filter(c => !scopeSet || scopeSet.has(c.id)), 'injaewon');
  const candidateIds = candidates.map(c => c.id), teacherIds = [...new Set(candidates.map(c => c.teacher_id).filter(Boolean))];
  const [schedules, teachers] = await Promise.all([
    candidateIds.length ? sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, slot_teacher_label, slot_room_label,
        valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
      where tenant_id=${t} and class_id = any(${candidateIds}::uuid[]) and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})` : [],
    teacherIds.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${teacherIds}::uuid[])` : [],
  ]);
  const slotsByClass = new Map();
  for (const s of schedules) { const arr = slotsByClass.get(s.class_id) ?? []; arr.push({ dayOfWeek: s.day_of_week, validFrom: s.valid_from, validTo: s.valid_to }); slotsByClass.set(s.class_id, arr); }
  const running = candidates.filter(c => R.hasLiveSlotInWeek(weekMonday, slotsByClass.get(c.id) ?? []));
  const runningIds = running.map(c => c.id);

  // 그 날 도는 교시 — 자리(JJ·LAB) 시작시각은 일간 줄에서 빼고, 자리 아닌 교시가 있어야 '수업 있음'.
  const dow = R.dowKeyOf(date), seatStarts = new Map(), lessonOnDate = new Set(), daySlotsByClass = new Map();
  for (const s of schedules) {
    if (s.day_of_week !== dow || s.valid_from > date || (s.valid_to !== null && s.valid_to < date)) continue;
    if (R.specialSlotLabel(s.slot_teacher_label)) {
      const set = seatStarts.get(s.class_id) ?? new Set(); set.add(R.normalizeSlotTime(s.start_time)); seatStarts.set(s.class_id, set);
    } else {
      lessonOnDate.add(s.class_id);
      const slots = daySlotsByClass.get(s.class_id) ?? [], slotStart = R.normalizeSlotTime(s.start_time);
      if (!slots.some(slot => slot.slotStart === slotStart)) slots.push({ slotStart, slotEnd: s.end_time ? R.normalizeSlotTime(s.end_time) : null, teacherLabel: s.slot_teacher_label, roomLabel: s.slot_room_label, seat: null });
      daySlotsByClass.set(s.class_id, slots);
    }
  }
  for (const slots of daySlotsByClass.values()) slots.sort((a, b) => a.slotStart.localeCompare(b.slotStart));

  const [goalRows, lineRows] = areas.length === 0 || runningIds.length === 0 ? [[], []] : await Promise.all([
    sql`select id::text id, class_id::text class_id, scope, role, skill_area, textbook, target_progress from public.class_sheet_goals
      where tenant_id=${t} and role = any(${role === 'all' ? ['homeroom', 'assistant'] : [role]}::text[]) and class_id = any(${runningIds}::uuid[])
        and ((scope='month' and period_start=${monthStart}) or (scope='week' and period_start=${weekMonday})) order by id`,
    sql`select id::text id, class_id::text class_id, slot_start::text slot_start, skill_area, line_no, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id = any(${runningIds}::uuid[]) and plan_date=${date} order by id`,
  ]);
  const idx = R.indexGoals(goalRows, role), dayIdx = R.indexDayLines(lineRows, seatStarts);
  // 배정이 바뀌어 현재 교시가 없어도 표에 남아 보이는 과거 계획 줄은 더블클릭해 고칠 수 있어야 한다.
  for (const line of lineRows) {
    const start = R.normalizeSlotTime(line.slot_start);
    if (seatStarts.get(line.class_id)?.has(start)) continue;
    if (![line.textbook, line.page_range, line.progress, line.homework].some(v => v?.trim())) continue;
    const slots = daySlotsByClass.get(line.class_id) ?? [];
    if (slots.some(slot => slot.slotStart === start)) continue;
    slots.push({ slotStart: start, slotEnd: null, teacherLabel: null, roomLabel: null, seat: null });
    slots.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    daySlotsByClass.set(line.class_id, slots);
  }
  const teacherName = new Map(teachers.map(x => [x.id, x.display_name]));
  const rows = running.map(c => ({
    classId: c.id, className: c.class_name ?? '', teacherName: teacherName.get(c.teacher_id) ?? null, hasLessonOnDate: lessonOnDate.has(c.id), daySlots: daySlotsByClass.get(c.id) ?? [],
    cells: areas.map(a => { const k = R.goalKey(c.id, a.key), month = idx.month.get(k) ?? [], week = idx.week.get(k) ?? [], day = dayIdx.get(k) ?? []; return { area: a.key, state: R.goalCellStateOf(month, week), month, week, day }; }),
  })).sort((a, b) => Number(a.teacherName === null) - Number(b.teacherName === null) || (a.teacherName ?? '').localeCompare(b.teacherName ?? '', 'ko') || a.className.localeCompare(b.className, 'ko'));
  return { ok: true, date, weekMonday, weekLabel: R.weekLabel(weekMonday), monthStart, today, role, canEdit: level === 'full' || level === 'scoped', view, areas, rows };
}

/** 2.0 goals-board-actions.ts — 내 계정의 보기 설정(ui_prefs.ecs.goalsRole·goalsView). 기본값이면 키를 지운다. 감사로그 없음(2.0과 같다). */
export const GOALS_ACTIONS = {
  setMyEcsGoalsRole: serverFn(GOALS_MODULE, 1, async ({ sql, t, R, user }, role) => {
    const safe = R.normalizeGoalsBoardRole(role);
    if (safe !== role) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { goalsRole: safe === R.DEFAULT_GOALS_BOARD_ROLE ? undefined : safe });
  }),
  setMyEcsGoalsView: serverFn(GOALS_MODULE, 1, async ({ sql, t, R, user }, view) => {
    const safe = R.normalizeGoalsBoardView(view);
    if (safe !== view) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { goalsView: safe === R.DEFAULT_GOALS_BOARD_VIEW ? undefined : safe });
  }),
};
