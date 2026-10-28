// 2.0 화면 · 강사 시트 · 영어(ECS) — V2-SCREENS.md (원장 2026-10-28 *"바로가기를 만들지말고 새 페이지를 만들어 db는 docker로"*
// → *"시간표가 기존 2.0 뷰와 너무 다른데"* 뒤로 **그리기는 2.0의 실제 React 부품**(v2-host/src/ecs.tsx), 여기는 자료와 저장만).
//
// ■ load = 2.0 page.tsx(서버 부품)가 클라이언트 부품에 넘기는 props 모양 그대로(v2-ecs-props.mjs). 주소는 2.0 주소(v2path) + 2.0 쿼리.
//   /ecs                    → 2.0 `ecs/page.tsx`         getSheetLanding(week)            → EcsLandingList · EcsTrackFilter · EcsTeacherFilter · WeekNav
//   /ecs/<반>               → 2.0 `[classId]/page.tsx`   getClassSheetWeek(반, week)      → SheetClient(data · classOptions · userId · tenantId) + TextbookOptionsProvider
//   /ecs/<반>/month         → 2.0 `month/page.tsx`       getClassSheetMonth + getMonthPlanChrome → MonthClient(data · mpChrome · classOptions · initialView · initialDisplay · fromWeek · textbooksOn)
//   /ecs/goals              → 2.0 `goals/page.tsx`       getGoalsBoard(date) + 강사 영어 이름 → GoalsPeriodBar · GoalsRoleSwitch · GoalsTable(v2-ecs-goals.mjs)
//   /ecs/plan-gap           → 2.0 plan-gap/page.tsx       getPlanGapBoard(month) + 강사 영어 이름 → PeriodNav · 표(page.tsx JSX, v2-ecs-gap.mjs)
//   /ecs?view=room          → 2.0 ecs/page.tsx room 갈래  getEcsSeatDay("JJ", date)          → EcsSeatDayFace(v2-ecs-seat.mjs)
//   /ecs (강사 · 오늘 면) → 아직 옮기지 않음(route만 알려 준다)
//   공통: editors(저장·보는 사람 = ECS 권한이 있는 재직 직원, 운영자 계정 제외) · viewer · host(OperationsProvider 값 · 화면 언어 · 영어 이름 편집 권한)
//   읽기 서버 액션(?read=dayPlan&class&date · compare&class&date&slot · slotChoices&class · textbookPlans&class · assignable) → 2.0 getEcsDayPlan ·
//   getSlotPlanCompare · loadClassSlotChoices · loadClassTextbookPlans · loadAssignableTextbooks의 반환 그대로(v2-ecs-textbooks.mjs).
//   호스트가 이 둘을 저장 경로(POST)가 아니라 여기(GET, 읽기 전용 트랜잭션)로 묻는다 — 보기는 쓰기 기록에 남지 않는다(시간표 loadExitOverlay와 같다).
//
// ■ actions = 2.0 서버 액션과 1:1(v2-ecs-save.mjs) — 같은 이름·같은 인자·같은 표·칸·DB 함수·감사로그(metadata.via = '3.0 연습 복사본').
//   validate·run은 화면 상태에 기대지 않는다({ sql, body, tenantId, importV2 }만) — 다른 화면(출석부 JJ실)이 같은 이름으로 그대로 이어 쓴다.
//   2.0 모듈 · 함수                                              바꾸는 표 / DB 함수                              감사로그 action
//   class-sheets/server/actions.ts      flushSheetPatches         class_sheet_plan_lines(필드 CAS)                 (commitSheetEdits가)
//                                       createPlanLine            ecs_create_plan_line                             ecs_plan_line_add
//                                       movePlanLine              ecs_move_plan_line                               ecs_plan_line_move
//                                       deletePlanLine            ecs_delete_plan_line                             ecs_plan_line_delete
//                                       copyWeekFromPrevious      ecs_copy_week                                    ecs_week_copy
//                                       copySlotFromPrevious      ecs_copy_slot                                    ecs_plan_copy
//                                       upsertGoal                class_sheet_goals                                (commitSheetEdits가)
//                                       upsertStudentMark         class_sheet_student_marks                        (commitSheetEdits가)
//                                       saveMemo                  class_sheet_memos                                (commitSheetEdits가)
//                                       setSlotShouting           class_sheet_slot_flags                           ecs_shouting_toggle
//                                       removeMakeupAttendee      attendance_records · class_sheet_student_marks   makeup_remove
//                                       markPresentIfAbsent       ecs_mark_present_if_absent                       ecs_attendance_mark
//                                       clearPresentAttendance    ecs_clear_present                                ecs_attendance_clear
//                                       setMyEcs*(10개)            users.ui_prefs.ecs                               (없음 — 2.0과 같다)
//   class-sheets/server/edit-audit-actions.ts  commitSheetEdits  (읽기만)                                          ecs_plan_cell_edit · ecs_goal_edit · ecs_mark_edit · ecs_memo_edit · ecs_month_plan_edit
//   class-sheets/server/month-plan-actions.ts  saveMonthPlanCells class_month_plan_cells                          ecs_month_plan_edit(구조 변경)
//   class-sheets/server/month-memo-actions.ts  saveMonthMemo     class_sheet_month_memos                          (commitSheetEdits가)
//   attendance/server/actions.ts               setAttendanceCell attendance_records(교시 칸 갈래)                attendance_cell · attendance_note · attendance_clear
//   class-sheets/server/goals-board-actions.ts setMyEcsGoalsRole · setMyEcsGoalsView  users.ui_prefs.ecs            (없음 — 2.0과 같다)
//   textbooks/server/plan-actions.ts           previewTextbookFill(저장 없음 — 교재 배정 창 미리보기) · loadClassSlotChoices · loadClassTextbookPlans ·
//                                              loadAssignableTextbooks(읽기 — 호스트는 GET)   applyTextbookFill 등 저장은 아직
//   students/server/english-name.ts            updateStudentEnglishName students.english_name(CAS · 지점 중복)   student_english_name_update
//   보강 추가(v2-ecs-makeup.mjs): attendance/server/actions.ts searchMakeupStudents(읽기) · makeup-actions.ts fetchMakeupAbsences(읽기) ·
//     setAttendanceCell(status makeup · allowMakeup — 칸과 시수) · makeup-note-action.ts noteMakeupAgainstAbsence  attendance_records.note   attendance_makeup_link
//   class-sheets/server/day-plan.ts            getEcsDayPlan     (읽기 — 호스트는 GET ?read=dayPlan)
//   textbooks/server/compare-actions.ts        getSlotPlanCompare (읽기 — 호스트는 GET ?read=compare)
//   출석부(로그인 JJ실 = 2.0 ECS_PLAN_API)가 같은 이름으로 쓰는 것: flushSheetPatches · createPlanLine · movePlanLine · deletePlanLine ·
//   copySlotFromPrevious · commitSheetEdits · getSlotPlanCompare(screen.actions.<이름> — 모듈 경로까지 2.0과 같아야 받는다).
//   반환 모양이 { ok, error }가 아닌 셋(searchMakeupStudents · fetchMakeupAbsences · fetchMakeupHostClasses)은 저장이 안 될 때 ecs.tsx가 2.0 실패 모양을 정한다.
//   아직 잇지 않은 2.0 서버 액션(호스트가 '복사본 보기 전용'으로 거절):
//   class-sheets/server/memorized-actions.ts pullEcsMemorizedWords · textbooks/server/plan-actions.ts(교재 배정·미룸/당김 setLessonShift …) ·
//   textbooks/server/{import-undo,plan-delete,shift-undo}-actions.ts(되돌리기) · attendance/server/actions.ts setAttendanceBulk(오늘 면) ·
//   attendance/server/makeup-actions.ts fetchMakeupHostClasses(원스크린 보강 반 고르기 — ECS 흐름은 안 부른다).
//
// ■ 호스트에 붙일 때(v2-host 빌드 메타 기준 — 2.0 ECS 묶음이 끌어오는 것)
//   Next 전용 모듈: next/navigation(useRouter·useSearchParams·usePathname) · next/link · next/dynamic · next/image — shims/ 그대로. server-only·next/cache 0.
//   하위 주소: 2.0 부품은 /ecs/<반>·/ecs/<반>/month·/ecs/goals·/ecs/plan-gap으로 이동한다 → shim v2path 규칙(8c0214f72) 그대로
//   (iframe 주소 ecs.html?v2path=<2.0 경로>&… · 3.0 주소 #v2-ecs?v2path=… — 3.0 쪽 우회 코드 없음).
//   서버 액션 모듈("use server") 15개: class-sheets/server/{actions,day-plan,edit-audit-actions,memorized-actions,month-memo-actions,month-plan-actions}.ts ·
//   attendance/server/{actions,makeup-actions,makeup-note-action}.ts · students/server/english-name.ts ·
//   textbooks/server/{compare-actions,import-undo-actions,plan-actions,plan-delete-actions,shift-undo-actions}.ts.
//
// 2.0과 다른 것: v2-ecs-props.mjs · v2-ecs-save.mjs 머리 주석(보는 사람 고르기 · 10분 필터 되돌리기 없음 · 알림 끔 · 보강 예약 칸 · JJ 이어받기 · 연락처 가림).
import { DAY, UUID, canWriteLevel, copyDay, editorsOf, loadRules, readSettings, readViewers, teacherEnglishNames, teacherScopeOf } from './v2-ecs-core.mjs';
import { classOptionsOf, landingData, monthData, sheetWeekData, textbookOptions } from './v2-ecs-props.mjs';
import { ACTIONS, readDayPlan, readSlotCompare } from './v2-ecs-save.mjs';
import { MAKEUP_ACTIONS } from './v2-ecs-makeup.mjs';
import { GOALS_ACTIONS, goalsData } from './v2-ecs-goals.mjs';
import { planGapData } from './v2-ecs-gap.mjs';
import { seatDayData } from './v2-ecs-seat.mjs';
import { TEXTBOOK_ACTIONS, readAssignableTextbooks, readClassTextbookPlans, readSlotChoices } from './v2-ecs-textbooks.mjs';

/** 2.0 주소 — /ecs · /ecs/<반> · /ecs/<반>/month · /ecs/goals · /ecs/plan-gap. */
const ROUTE = /^\/ecs(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/month)?|\/(goals|plan-gap))?$/;

export const screen = {
  id: 'ecs', label: '강사 시트', order: 3,
  params: { v2path: ROUTE, viewer: UUID, week: DAY, view: /^(week|room|today|cal|rail|mp)$/, date: DAY, mode: /^(sheet|cards)$/, month: /^\d{4}-\d{2}$/,
    period: /^(month|session)$/, day: DAY, readonly: /^1$/,
    // 읽기 서버 액션(호스트 registerHostHandler) — 그 2.0 함수의 인자 칸만.
    read: /^(dayPlan|compare|slotChoices|textbookPlans|assignable)$/, class: UUID, slot: /^\d{2}:\d{2}(?::\d{2})?$/ },
  actions: { ...ACTIONS, ...MAKEUP_ACTIONS, ...GOALS_ACTIONS, ...TEXTBOOK_ACTIONS },
  async load({ sql, params: q, tenantId: t, importV2 }) {
    const R = await loadRules(importV2), today = await copyDay(), env = await readSettings(sql, t, R);
    const viewers = await readViewers(sql, t, R, env);
    if (q.read) {
      // 2.0 서버 액션의 반환 그대로 — 보는 사람은 고른 사람만(없으면 거절: 첫 사람으로 대신 읽지 않는다).
      const user = viewers.find(v => v.id === q.viewer);
      if (!user) return { ok: false, error: '접근 권한이 없습니다' };
      const ctx = { sql, t, R, env, user, today };
      if (q.read === 'dayPlan') return readDayPlan(ctx, { classId: q.class, planDate: q.date });
      if (q.read === 'compare') return readSlotCompare(ctx, { classId: q.class, date: q.date, slotStart: q.slot });
      if (q.read === 'slotChoices') return readSlotChoices(ctx, q.class);
      if (q.read === 'textbookPlans') return readClassTextbookPlans(ctx, q.class);
      return readAssignableTextbooks(ctx);
    }
    const viewer = viewers.find(v => v.id === q.viewer) ?? viewers[0] ?? null;
    const ops = env.operations;
    const common = { asOf: today, editors: editorsOf(viewers), viewer: viewer && { id: viewer.id, name: viewer.name, role: viewer.roleLabel },
      host: { operations: { subjects: ops.subjects, gradeLevels: ops.gradeLevels, jobTitles: ops.jobTitles, jobTitlesByDepartment: ops.jobTitlesByDepartment },
        disabledModules: env.disabled, lang: viewer?.lang ?? 'ko', englishNameEnabled: !!viewer && canWriteLevel(viewer.levels.englishName) } };
    if (!viewer) return { ...common, route: 'none' };
    const m = ROUTE.exec(q.v2path || '/ecs') ?? [];
    if (m[3] === 'goals') {
      // 2.0 goals/page.tsx — getGoalsBoard(date) + 화면 언어의 강사 영어 이름(GoalsTable teacherNames).
      const [res, names] = await Promise.all([goalsData(sql, t, R, env, viewer, q.date ?? null, today), teacherEnglishNames(sql, t, viewer.lang)]);
      return { ...common, route: 'goals', goals: { res, names } };
    }
    if (m[3] === 'plan-gap') {
      // 2.0 plan-gap/page.tsx — getPlanGapBoard(month) + 화면 언어의 강사 영어 이름(teacherNameFor).
      const [res, names] = await Promise.all([planGapData(sql, t, R, env, viewer, q.month ?? null, today), teacherEnglishNames(sql, t, viewer.lang)]);
      return { ...common, route: 'gap', gap: { res, names } };
    }
    const classId = m[1];
    if (classId && m[2]) {
      // 2.0 month/page.tsx — 반 전환 옵션은 이번 주 목록(getSheetLanding(null)), 교재 제안·교재목록 모듈 여부를 같은 묶음으로.
      const [res, landing, options] = await Promise.all([monthData(sql, t, R, env, viewer, classId, q), landingData(sql, t, R, env, viewer, null, today), textbookOptions(sql, t)]);
      if (!res.ok) return { ...common, route: 'month', month: { res } };
      const initialView = R.clampEcsMonthView(q.view === 'cal' || q.view === 'rail' || q.view === 'mp' ? q.view : res.data.view, res.data.isEie);
      return { ...common, route: 'month', month: { res: { ok: true, data: res.data }, mpChrome: res.mpChrome, classOptions: classOptionsOf(landing, classId, res.data.className),
        initialView, fromWeek: R.readFromWeek(q.week), textbooksOn: env.textbooksOn, textbookOptions: options } };
    }
    if (classId) {
      // 2.0 [classId]/page.tsx — 시트 · 같은 주 반 목록(반 전환) · 교재 제안.
      const [res, landing, options] = await Promise.all([sheetWeekData(sql, t, R, env, viewer, classId, q.week ?? null, { readOnly: q.readonly === '1' }), landingData(sql, t, R, env, viewer, q.week ?? null, today), textbookOptions(sql, t)]);
      if (!res.ok) return { ...common, route: 'sheet', sheet: { res } };
      return { ...common, route: 'sheet', sheet: { res, classOptions: classOptionsOf(landing, classId, res.data.className), userId: viewer.id, tenantId: t, textbookOptions: options } };
    }
    // 2.0 ecs/page.tsx — 면: 강사 스코프가 있으면 '오늘'(view=week면 주간), 없으면 주간. JJ실(view=room)은 누구나.
    const scoped = (await teacherScopeOf(sql, t, viewer)) !== null;
    // 2.0 ecs/page.tsx room 갈래 — getEcsSeatDay('JJ', date) → EcsSeatDayFace(showToday = 강사 스코프).
    if (q.view === 'room') return { ...common, route: 'room', scoped, room: { res: await seatDayData(sql, t, R, env, viewer, 'JJ', q.date ?? null, today) } };
    if (scoped && q.view !== 'week') return { ...common, route: 'today', scoped };
    // 2.0: 강사 본인이면 담임/부담임으로 묶고 이름은 화면 언어대로(teacherNameFor), 사무실이면 담임별.
    const names = scoped ? await teacherEnglishNames(sql, t, viewer.lang) : {};
    return { ...common, route: 'landing', scoped, landing: { res: await landingData(sql, t, R, env, viewer, q.week ?? null, today),
      eieOn: env.eieOn, textbooksOn: env.textbooksOn, canReorder: true, viewerTeacherId: scoped ? viewer.id : null, viewerName: scoped ? R.teacherNameFor(viewer.name, names, viewer.lang) : null } };
  },
};
