// 2.0 화면 · 출석부 (V2-SCREENS.md · 원장 2026-10-28 *"바로가기를 만들지말고 새 페이지를 만들어 db는 docker로"*).
// 화면 = 2.0 부품 그대로 — v2-host/src/attendance.tsx(진입점)·attendance-page.tsx(2.0 page.tsx의 JSX)가 2.0 React 부품과 2.0 CSS를
// 같은 출처 iframe(/v2-host/attendance.html?…)에 그리고, 3.0 `#v2-attendance`(v2-screen-attendance.js)는 그 iframe 껍데기다.
// 이 파일 = 그 부품들이 2.0에서 서버로부터 받던 것:
//  · load = 2.0 page.tsx가 클라이언트 부품에 넘기는 props(같은 이름 · 같은 모양 — attendance-page.tsx의 AttendanceData).
//    읽기는 2.0 `getMonthlyAttendanceMatrix`·`loadClassAxisRows`·`getDailyProcessingStatus`(features/attendance/server/*)의 표·칸·조건을
//    SQL로 그대로(서버 전용 모듈이라 불러올 수 없어 조회만 옮긴다), 판정은 2.0 순수 함수를 importV2로 그대로 쓴다
//    (귀속 `ownsAttendanceSlot` · 하루 접기 `rollupDay` · 칸 표기 `cellDisplay` · 파생 `deriveMarksFromReports` · 시수 `autoUnitsByDate` …).
//    .tsx 안에만 있는 몇 줄(31칸 채우기·날짜축·담당 강사 합집합·역할 판정)과 불러올 수 없는 resolve.ts의 설정 병합은 아래 PORTED —
//    verify가 2.0 원문과 맞는지 잡는다.
//  · actions = 2.0 "use server" 함수와 1:1(이름 = 2.0 export 이름 · 인자 = 2.0 인자 · 같은 표·칸·감사로그). 호스트 shim이
//    POST /api/v2/attendance/<함수> { module, actor, args }로 부른다(actor = 3.0 띠에서 고른 출결 전체 권한 직원 — 로그인 대신).
//      2.0 모듈 · 함수                                              → 여기
//      features/attendance/server/actions.ts      setAttendanceCell   → actions.setAttendanceCell (관리자 경로 · attendance_cell/_clear/_note)
//      features/attendance/server/prefs-actions.ts saveAttendanceSort · saveAttendancePeriodMode · saveAttendanceHideRetired ·
//                                                 saveAttendanceCollapsed → actions.같은 이름 (users.ui_prefs.attendance · 감사로그 없음 = 2.0과 같다)
//      hub-search-actions.ts searchAttendanceHubStudents · intake/server/actions.ts searchIntakeStudents · previewAbsenceIntake ·
//                                                 recordAbsenceIntake → actions.같은 이름 — 아직 옮기지 않아 **그 함수의 2.0 실패 모양**으로
//                                                 답한다(쓰기 없음). shim 공통 거절 `{ok:false}`로는 부품이 결과를 읽다 깨진다.
//      아직 받지 않는 것(shim이 '복사본 보기 전용' `{ok:false,error}`로 거절 — 부르는 2.0 부품이 모두 `"error" in res`로 읽는다):
//        actions.ts setAttendanceRange(범위 지우기·채우기) · setAttendanceBulk · saveAttendance · linkMakeupToAbsence · searchMakeupStudents
//        makeup-reservation-actions.ts getMakeupPeriodOptions · reserveMakeup · cancelMakeupReservation · setReservationReportMode
//        prefs-actions.ts loadAttendanceViewPrefs(서버 전용 — load가 같은 값)
//  · 하위 주소(v2path) — 2.0 `/attendance/seat/<자리>`(자리 하루: SeatAllDay·SeatJjAllDay·SeatBoard) · `…/month`(자리 월간: MonthlyTable) ·
//    `/attendance/seat`(첫 자리로 redirect). 조회·props는 v2-attendance-seat.mjs(2.0 seat/page.tsx·month/page.tsx와 같은 값).
//    자리 쪽 2.0 서버 함수 → actions.같은 이름(v2-attendance-seat-save.mjs — 같은 표·칸·감사로그): seat/server/actions.ts setSeatCell ·
//    fillSeatSlot · fillSeatPrevAbsent / mark-actions.ts setSeatJjField · commitSeatJjEdits / period-actions.ts moveSeatStudentPeriod ·
//    clearSeatPeriodChoices / placement-actions.ts resetSeatPlacements / monthly-prefs.ts saveSeatMonthlyCollapsed.
//    memorized-actions.ts pullSeatMemorizedWords = 바깥(인재원) 연동이라 2.0 실패 모양으로 거절. 아직 받지 않는 것(shim 공통 거절 — 부품이
//    모두 `"error" in res`·`res.ok`로 읽는다): JJ 계획 편집(로그인 화면 = ECS_PLAN_API — class-sheets/server/actions.ts · edit-audit-actions.ts ·
//    textbooks/server/plan-actions.ts · compare-actions.ts · shift-undo-actions.ts. 영어 시트 화면 모듈(v2-screen-ecs.mjs)의 같은 이름에 위임할 예정) ·
//    jj-plan-actions.ts 6개(공개 PIN 화면 전용 — 앱 밖이라 범위 밖).
// "오늘"은 복사본 기준일(백업 시각의 KST 날짜) — 3.0 다른 화면과 같은 날이다. 자리 화면의 기본 교시는 복사본 기준 시각으로 고른다.
//
// ── 호스트에 붙일 때(v2-host 빌드가 출석부 진입점에서 닿는 것 — 2.0 Next에만 있는 경계) ──
//  · "use server" 모듈(빌드가 serverAction 자리표시로 바꾼다) — 월별: features/attendance/server/actions.ts · server/prefs-actions.ts ·
//    server/makeup-reservation-actions.ts · server/hub-search-actions.ts · intake/server/actions.ts / 자리: features/attendance/seat/server/
//    actions.ts · mark-actions.ts · period-actions.ts · placement-actions.ts · memorized-actions.ts · monthly-prefs.ts · jj-plan-actions.ts /
//    JJ 계획 부품이 함께 부르는 것: features/class-sheets/server/actions.ts · class-sheets/server/edit-audit-actions.ts ·
//    textbooks/server/plan-actions.ts · textbooks/server/compare-actions.ts · textbooks/server/shift-undo-actions.ts
//  · next/navigation(shims/next-navigation): attendance/_components의 grid-context · cell-popover · sort-select · period-mode-toggle ·
//    hide-retired-toggle · makeup-reserve-dialog · absence-intake-dialog, components의 filter-select · href-select · period-nav ·
//    excel-import/excel-import-dialog · workspace/print-window · forms/recording-runtime · forms/use-frame-recordings · workspace/use-recording-lock ·
//    seat/[seat]/_components의 memorized-pull-button · seat-all-day · seat-board-moves · seat-board-saves · owner/menu-page-title · owner/navigation-context
//  · next/link: components/embed-link · workspace/window-link · seat/[seat]/_components의 seat-drop-zones · seat-jj-table · seat-period-chips ·
//    seat/[seat]/month/_components/monthly-row  · next/image: components/empty-state
//  · server-only·next/cache: 닿는 곳 없음(서버 액션 모듈 안에만 있고, 그 모듈은 자리표시로 바뀐다).
//  · 서버 부품이라 브라우저에 못 싣는 것 = page.tsx 자체(쿠키·세션·DB) → 이 파일의 load. 금액 열(청구액·등록 차수·단가·실급여)은
//    회차 확정·금액 이월·강사 몫 조회를 아직 옮기지 않아 세우지 않는다(값 없는 열 = 거짓).
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';
import { scrub } from './domain-snapshot-core.mjs';
import { V2Error } from './v2-screens.mjs';
import { loadSeatRules, seatDayProps, seatMonthProps } from './v2-attendance-seat.mjs';
import * as SeatSave from './v2-attendance-seat-save.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MODULES = {
  cell: 'features/attendance/cell-display.ts', totals: 'features/attendance/grid/totals.ts', colTotals: 'features/attendance/grid/column-totals.ts',
  sort: 'features/attendance/sort-rows.ts', cal: 'features/attendance/calendar.ts', span: 'features/attendance/enrollment-span.ts',
  place: 'features/attendance/badge-placement.ts', tone: 'features/attendance/name-tone.ts', axis: 'features/attendance/teacher-axis.ts',
  derive: 'features/attendance/derive-from-reports.ts', makeupRoster: 'features/attendance/monthly-makeup-roster.ts', auto: 'features/attendance/auto-units.ts',
  splitMarks: 'features/attendance/split-marks.ts', transfer: 'features/attendance/transfer-badge.ts', sheet: 'features/attendance/teacher-sheet-classes.ts',
  worker: 'features/attendance/class-worker.ts', suffix: 'features/attendance/unit-suffix.ts', i18n: 'features/teacher-view/i18n.ts',
  className: 'features/teacher-view/class-name.ts', attLabel: 'features/class-sheets/lib/attendance-label.ts', rate: 'lib/calc/attendance.ts',
  periods: 'features/periods/resolve.ts', windowLabel: 'features/periods/window-label.ts', asOf: 'features/classes/teacher-as-of.ts',
  proxy: 'features/attendance/proxy-memo.ts', reserve: 'features/attendance/makeup-reservation.ts', splitPeriod: 'features/class-splits/period.ts',
  splitRules: 'features/class-splits/rules.ts', role: 'features/attendance/teacher-role.ts', processing: 'features/attendance/teacher-processing.ts', elig: 'features/enrollments/eligibility.ts',
  holidayAct: 'features/attendance/holiday-activity.ts', subjects: 'features/owner/subjects.ts', preset: 'features/owner/preset.ts',
  modules: 'lib/modules.ts', lesson: 'features/owner/lesson-profile.ts', date: 'lib/date-kst.ts', school: 'lib/format/school-grade.ts',
  studentTone: 'features/timetable/lib/student-tone.ts', seat: 'features/attendance/seat/seat.ts', effective: 'features/attendance/effective-records.ts',
  units: 'features/attendance/session-units.ts', edit: 'features/attendance/edit-window.ts', attHref: 'app/(shell)/attendance/_components/att-href.ts',
  holidaySheet: 'features/class-sheets/lib/holiday.ts', grid: 'features/attendance/grid/model.ts', pool: 'features/classes/makeup-pool.ts',
  search: 'features/attendance/student-search.ts', viewPrefs: 'features/attendance/view-prefs.ts', hubSearch: 'features/attendance/hub-search.ts',
  // 2단계(저장) — setAttendanceCell이 쓰는 순수 규칙.
  typing: 'features/attendance/grid/typing.ts', scopeOwn: 'features/attendance/scope-ownership.ts', scopedSplit: 'features/attendance/scoped-split.ts',
  ghost: 'features/attendance/ghost-transfer.ts', saveTargets: 'features/attendance/save-targets.ts', unitsAudit: 'features/attendance/units-audit.ts',
  payslip: 'features/payroll/payslip-access.ts', perms: 'lib/permissions.ts', roles: 'lib/auth/role-hierarchy.ts', delegWin: 'features/classes/delegation-window.ts', tlabel: 'features/timetable/lib/teacher-label.ts',
};
let rulesPromise = null;
/** 2.0 순수 모듈 — 모듈마다 이름공간(같은 이름의 함수가 여러 모듈에 있다: monthBounds·addDays …). 실패하면 다음 요청에서 다시. */
export function loadRules(importV2) {
  rulesPromise ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await importV2(p)]))
    .then(Object.fromEntries).catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── PORTED: 2.0 원문 그대로(불러올 수 없는 자리). 바꾸면 verify-v2-screen-attendance.mjs가 원문과 비교해 잡는다. ──
/** features/owner/resolve.ts — 이 화면이 읽는 칸(운영·모듈·프리셋)만. */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function deepMerge(base, stored) {
  if (!isPlainObject(base)) {
    return stored === undefined || stored === null ? base : stored;
  }
  if (!isPlainObject(stored)) return base;
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const b = base[key];
    const s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out;
}
export function normalizeHolidays(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((h) => {
      if (typeof h === "string") return { date: h, name: "" };
      if (h && typeof h === "object" && typeof h.date === "string") {
        const o = h;
        return { date: o.date, name: typeof o.name === "string" ? o.name : "" };
      }
      return null;
    })
    .filter((h) => h !== null);
}
function normalizeSubjects(arr, base) {
  const defaults = new Map(base.operations.subjects.map((s) => [s.key, s]));
  return arr.map((s) => {
    const d = defaults.get(s.key);
    if (!d) return s;
    const out = { ...s };
    if (out.weekdayPeriods === undefined && d.weekdayPeriods) out.weekdayPeriods = d.weekdayPeriods;
    if (out.teacherViewLines === undefined && d.teacherViewLines) out.teacherViewLines = d.teacherViewLines;
    if (out.teacherViewStep === undefined && d.teacherViewStep !== undefined) out.teacherViewStep = d.teacherViewStep;
    return out;
  });
}
/** features/attendance/server/queries.ts `DOW_LABEL`·`buildPeriodDays` — 오늘은 인자로(복사본 기준일). */
const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];
export function buildPeriodDays(startIso, endIso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startIso) || !/^\d{4}-\d{2}-\d{2}$/.test(endIso) || startIso > endIso) return [];
  const days = [];
  const cur = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const dateStr = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    days.push({
      date: dateStr,
      day: cur.getUTCDate(),
      dow,
      label: DOW_LABEL[dow] ?? "?",
      isWeekend: dow === 0 || dow === 6,
      isToday: dateStr === todayIso,
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
/** app/(shell)/attendance/page.tsx `padTo31` · `classTeachers` · `shiftMonth`. */
export function padTo31(days) {
  if (days.length >= 31) return days;
  const out = [...days];
  for (let n = days.length + 1; n <= 31; n++) {
    out.push({ date: `pad-${n}`, day: n, dow: -1, label: "", isWeekend: false, isToday: false, placeholder: true });
  }
  return out;
}
export function classTeachers(c) {
  const out = new Map();
  if (c.teacherId && c.teacherName) {
    out.set(c.teacherId, { id: c.teacherId, name: c.teacherName, active: c.teacherActive });
  }
  for (const t of c.slotTeachers) if (!out.has(t.id)) out.set(t.id, t);
  for (const t of c.historicalTeachers ?? []) if (!out.has(t.id)) out.set(t.id, t);
  return [...out.values()];
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
/** features/attendance/server/subject-sessions.ts `roleFor`. */
export function roleFor(R, sessions, studentId, subject, teacherId) {
  if (!subject || !teacherId) return null;
  const list = sessions.get(studentId)?.get(subject);
  return list ? R.role.resolveTeacherRole(list, teacherId) : null;
}
// ── PORTED 끝 ──

let asOfDay = null;
/** 복사본의 "오늘"(백업 시각의 KST 날짜) — 원스크린·3.0 다른 화면과 같은 날. */
export async function copyDay() {
  if (!asOfDay) { const { directory } = await activeBackup(); const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); asOfDay = new Date(new Date(m.capturedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  return asOfDay;
}
/** 학원 설정 — 2.0 `getTenantSettings`→`resolveSettings`의 운영·모듈·프리셋 칸. */
export async function readSettings(sql, t, R) {
  const [row] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
  const stored = row?.data ?? null, preset = R.preset.presetOfStored(stored), base = R.preset.baseSettingsFor(preset);
  const merged = deepMerge(base, stored);
  return { preset, profileName: merged.profile?.name || row?.name || '', permissions: merged.permissions,
    operations: { ...merged.operations, subjects: normalizeSubjects(merged.operations.subjects, base), holidays: normalizeHolidays(merged.operations.holidays) },
    modules: { disabled: R.modules.normalizeDisabledModules(merged.modules.disabled) } };
}

/** 담임 전이 — 2.0 `loadTeacherTransitions`(인계·담임 변경 감사로그, 반 이름은 유일할 때만). */
async function readTransitions(sql, t, R) {
  const [logs, classRows] = await Promise.all([
    sql`select metadata, target_label, to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') created_at from public.audit_logs
        where tenant_id=${t} and action in ('class_handover_apply','class_update') and metadata->>'newTeacherId' is not null order by created_at`,
    sql`select id, class_name from public.classes where tenant_id=${t}`,
  ]);
  const classIdByUniqueName = R.asOf.buildUniqueClassNameIndex(classRows.map(c => ({ id: c.id, name: c.class_name })));
  const ids = [...new Set(logs.map(l => l.metadata?.newTeacherId).filter(v => typeof v === 'string' && UUID.test(v)))];
  const nameOf = new Map((ids.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : []).map(u => [u.id, u.display_name ?? '']));
  return logs.map(l => {
    const teacherId = l.metadata?.newTeacherId ?? null;
    return {
      classId: R.asOf.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName }) ?? '',
      date: R.date.kstDateOf(l.metadata?.effectiveDate) ?? R.date.kstDateOf(l.created_at) ?? '',
      teacherId, previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null,
      teacherName: teacherId ? (nameOf.get(teacherId) ?? null) : null,
    };
  }).filter(x => x.classId && x.teacherId && x.date);
}

/** 활성 반 + 그 달 강사 축 — 2.0 `loadClassAxisRows`(담임 ∪ 그 달 교시 담당 ∪ 이전 담임 · 종강 반은 그 뒤 기간에서 뺀다). */
async function readClassAxis(sql, t, R, from, to, transitions) {
  const [classRows, slotRows] = await Promise.all([
    sql`select c.id, c.class_name, c.subject, c.report_optout, c.is_special, c.closed_at::text closed_at, c.english_track,
          u.id teacher_id, u.display_name teacher_name, u.status::text teacher_status
        from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t} and c.is_active order by c.class_name, c.id`,
    sql`select class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
        from public.class_schedules where tenant_id=${t} and teacher_id is not null and valid_from<=${to} and (valid_to is null or valid_to>=${from}) order by id`,
  ]);
  const historyIndex = R.asOf.buildHomeroomHistoryIndex(transitions);
  const slotAxis = new Map();
  for (const r of slotRows) {
    const slot = { dayOfWeek: r.day_of_week, startTime: r.start_time, teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: r.valid_from, validTo: r.valid_to };
    if (!R.axis.slotOverlapsRange(slot, from, to)) continue;
    (slotAxis.get(r.class_id) ?? slotAxis.set(r.class_id, []).get(r.class_id)).push(slot);
  }
  const liveRows = classRows.filter(c => !c.closed_at || c.closed_at >= from);
  const nameIds = [...new Set([...[...slotAxis.values()].flatMap(s => s.map(x => x.teacherId).filter(Boolean)),
    ...liveRows.flatMap(c => R.asOf.homeroomTeachersInRange(historyIndex.get(c.id) ?? [], from, to))])];
  const names = new Map();
  if (nameIds.length) for (const u of await sql`select id::text id, display_name, status::text status from public.users where tenant_id=${t} and id = any(${nameIds}::uuid[])`) {
    if (u.display_name) names.set(u.id, { id: u.id, name: u.display_name, active: u.status !== 'inactive' });
  }
  return liveRows.map(c => {
    const homeroomTeacherId = c.teacher_id ?? null, slots = slotAxis.get(c.id) ?? [], homeroomHistory = historyIndex.get(c.id) ?? [];
    const historicalIds = R.asOf.homeroomTeachersInRange(homeroomHistory, from, to);
    return {
      id: c.id, className: c.class_name, subject: c.subject, reportOptout: c.report_optout === true, isSpecial: c.is_special === true, englishTrack: c.english_track ?? null,
      teacherId: homeroomTeacherId, teacherName: c.teacher_name ?? null, teacherActive: c.teacher_id ? c.teacher_status !== 'inactive' : true,
      homeroomHistory,
      historicalTeachers: historicalIds.filter(id => id !== homeroomTeacherId).map(id => names.get(id)).filter(Boolean),
      slotTeachers: R.axis.classTeacherIdsInRange({ homeroomTeacherId: null, slots, from, to }).map(id => names.get(id)).filter(Boolean),
      taughtBy: [...new Set([...R.axis.classTeacherIdsInRange({ homeroomTeacherId, slots, from, to }), ...historicalIds])],
    };
  });
}

/** 세션 정의(0189a) — 2.0 `getPeriodDefs`(그 해, 과목·라벨월 순). */
async function readPeriodDefs(sql, t, year) {
  const rows = await sql`select id, subject_key, class_id, label_year, label_month, start_date::text start_date, end_date::text end_date
    from public.operating_periods where tenant_id=${t} and label_year=${year} order by subject_key, label_month`;
  return rows.map(r => ({ id: r.id, subjectKey: r.subject_key, classId: r.class_id, labelYear: r.label_year, labelMonth: r.label_month, startDate: r.start_date, endDate: r.end_date }));
}

const EMPTY_STATS = { totalStudents: 0, presentRate: 0, presentCount: 0, absentCount: 0, lateCount: 0, makeupCount: 0, totalRecords: 0 };

/**
 * 한 반의 한 기간 출석 — 2.0 `getMonthlyAttendanceMatrix`(features/attendance/server/queries.ts) 그대로.
 * 조회만 SQL로 옮겼고(같은 표·같은 조건, tenant_id를 명시), 접기·귀속·파생은 2.0 함수다.
 */
export async function buildMatrix(ctx, { month, classId, periodMode = 'month', scopeTeacherId = null, scopeSince = null }) {
  const { sql, t, R, settings, today, classes } = ctx;
  const selectedSubject = classId ? (classes.find(c => c.id === classId)?.subject ?? null) : null;
  const mode = classId ? periodMode : 'month', year = Number(month.slice(0, 4));
  const defs = mode === 'month' || !Number.isFinite(year) ? [] : (ctx.defs.get(year) ?? ctx.defs.set(year, await readPeriodDefs(sql, t, year)).get(year));
  const periodWindow = R.periods.resolvePeriodWindow({ period: month, subjectKey: selectedSubject, mode, todayIso: today, defs });
  const days = buildPeriodDays(periodWindow.start, periodWindow.end, today);
  const base = { classes, selectedClassId: classId, month, window: periodWindow, days, classDows: [], students: [], marks: {}, notes: {}, units: {}, slots: {}, ghosts: {}, dayAxis: {}, derived: {}, derivedActive: false };
  if (!classId || days.length === 0) return { ...base, stats: { ...EMPTY_STATS } };
  const startIso = days[0].date, endIso = days[days.length - 1].date;

  const [enrollments, schedules, recordedRows, reservedRows, splitRows] = await Promise.all([
    sql`select e.id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.is_transferred_in, e.attendance_days,
          s.id sid, s.name, s.grade, s.school, s.withdrawn_at::text withdrawn_at
        from public.enrollments e join public.students s on s.id=e.student_id
        where e.tenant_id=${t} and e.class_id=${classId} and e.start_date<=${endIso} order by e.start_date, e.id`,
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to, lab_separate
        from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from<=${endIso} and (valid_to is null or valid_to>=${startIso}) order by id`,
    sql`select student_id, session_date::text session_date, slot_start::text slot_start, seat_label, recorded_via, taught_by
        from public.attendance_records where tenant_id=${t} and class_id=${classId} and session_date between ${startIso} and ${endIso} order by id`,
    sql`select id, student_id, class_id, absence_date::text absence_date, makeup_date::text makeup_date, slot_start::text slot_start, slot_end::text slot_end, period_label, note, status, created_by
        from public.makeup_reservations where tenant_id=${t} and class_id=${classId} and status='reserved' and makeup_date between ${startIso} and ${endIso} order by makeup_date, slot_start`,
    sql`select id, student_id, source_class_id, target_class_id, day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, period_kind, note
        from public.class_splits where tenant_id=${t} and (source_class_id=${classId} or target_class_id=${classId}) and valid_from<=${endIso}`,
  ]);
  const classDows = R.cal.dowsFromKeys(schedules.map(s => s.day_of_week));
  const axisSlots = schedules.map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time ?? null, teacherId: s.teacher_id ?? null, slotTeacherLabel: s.slot_teacher_label ?? null, validFrom: s.valid_from, validTo: s.valid_to ?? null }));
  const cls = classes.find(c => c.id === classId), homeroomTeacherId = cls?.teacherId ?? null, homeroomHistory = cls?.homeroomHistory;
  const slotInput = (date, slotStart, seatLabel, recordedVia, taughtBy = null) => ({ scopeTeacherId, homeroomTeacherId, homeroomHistory, slots: axisSlots, date, slotStart, homeroomSince: scopeSince, seatLabel, recordedVia, taughtBy });
  const ownsSlot = (date, slotStart, seatLabel = null, recordedVia = null, taughtBy = null) => R.axis.ownsAttendanceSlot(slotInput(date, slotStart, seatLabel, recordedVia, taughtBy));
  const ownDateSet = scopeTeacherId ? new Set(days.filter(d => !d.placeholder && R.axis.teachesClassOn({ scopeTeacherId, homeroomTeacherId, homeroomHistory, slots: axisSlots, date: d.date, homeroomSince: scopeSince })).map(d => d.date)) : null;
  const sharedByTeachers = R.axis.classTeacherIdsInRange({ homeroomTeacherId, slots: axisSlots, from: startIso, to: endIso }).length > 1;

  const studentMap = new Map(), rangesById = new Map();
  for (const e of enrollments) {
    if (e.on_hold) continue;
    if (e.end_date && e.end_date < startIso) continue;
    const list = rangesById.get(e.sid) ?? [];
    list.push({ start: e.start_date, end: e.end_date ?? null, isTransferred: e.is_transferred === true, isTransferredIn: e.is_transferred_in === true });
    rangesById.set(e.sid, list);
    if (!studentMap.has(e.sid)) studentMap.set(e.sid, { id: e.sid, name: e.name, grade: e.grade, school: e.school, enrolledAt: e.start_date, attendDows: R.cal.resolveAttendDows(e.attendance_days, classDows), spans: [], badges: [], withdrawnAt: e.withdrawn_at ?? null });
  }
  for (const [id, list] of rangesById) { const st = studentMap.get(id); if (st) st.spans = list; }
  await attachLifecycleBadges(ctx, { first: periodWindow.start, last: periodWindow.end }, studentMap, classId, selectedSubject);

  const enrolledStudentIds = enrollments.map(e => e.sid);
  const visitorRows = scopeTeacherId && homeroomTeacherId !== scopeTeacherId ? recordedRows.filter(r => ownsSlot(r.session_date, r.slot_start, r.seat_label, r.recorded_via, r.taught_by ?? null)) : recordedRows;
  const splits = splitRows.map(r => toSplit(R, r)).filter(s => s && R.splitPeriod.splitOverlapsRange(s, startIso, endIso));
  const splitClassNames = new Map();
  if (splits.length) {
    const ids = [...new Set(splits.flatMap(x => [x.sourceClassId, x.targetClassId]))];
    for (const c of await sql`select c.id, c.class_name, u.display_name from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t} and c.id = any(${ids}::uuid[])`) splitClassNames.set(c.id, { name: c.class_name, teacherName: c.display_name ?? null });
  }
  const splitView = R.splitMarks.splitDateMarks(classId, days.filter(d => !d.placeholder).map(d => d.date), splits, splitClassNames);
  const reservations = reservedRows.map(r => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: r.absence_date, makeupDate: r.makeup_date, slotStart: String(r.slot_start ?? '').slice(0, 5), slotEnd: String(r.slot_end ?? '').slice(0, 5), periodLabel: r.period_label ?? null, note: r.note ?? null, createdBy: r.created_by ?? null }));
  const extraIds = R.makeupRoster.recordedOnlyStudentIds([...visitorRows.map(r => r.student_id), ...reservations.map(r => r.studentId), ...splitView.incomingIds], enrolledStudentIds);
  const recordedIdSet = new Set(visitorRows.map(r => r.student_id));
  const reservedOnlyIds = new Set([...reservations.map(r => r.studentId), ...splitView.incomingIds].filter(id => !enrolledStudentIds.includes(id) && !recordedIdSet.has(id)));
  if (extraIds.length) for (const s of await sql`select id, name, grade, school from public.students where tenant_id=${t} and id = any(${extraIds}::uuid[])`) {
    if (!studentMap.has(s.id)) studentMap.set(s.id, R.makeupRoster.recordedOnlyMatrixRow(s));
  }
  const students = [...studentMap.values()].sort((a, b) => { const ga = a.grade ?? '', gb = b.grade ?? ''; if (ga !== gb) return ga.localeCompare(gb, 'ko'); return a.name.localeCompare(b.name, 'ko'); });

  const resv = {}, creators = [];
  for (const r of reservations) {
    if (!studentMap.has(r.studentId) || resv[r.studentId]?.[r.makeupDate]) continue;
    const entry = { id: r.id, absenceDate: r.absenceDate, slotStart: r.slotStart, slotEnd: r.slotEnd, periodLabel: r.periodLabel, note: r.note ? scrub(r.note) : null, createdByName: null };
    (resv[r.studentId] ??= {})[r.makeupDate] = entry;
    if (r.createdBy) creators.push([entry, r.createdBy]);
  }

  const studentIds = students.map(s => s.id), marks = {}, notes = {}, units = {}, slots = {}, dayAxis = {}, derived = {};
  if (studentIds.length) {
    const records = await sql`select student_id, session_date::text session_date, slot_start::text slot_start, status::text status, note, session_units::float8 session_units, seat_label, recorded_via, taught_by
      from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id = any(${studentIds}::uuid[]) and session_date between ${startIso} and ${endIso}
      order by recorded_at desc, id desc`;
    const seen = new Set(), byCell = new Map();
    for (const r of records) {
      const slot = r.slot_start ?? null, k = `${r.student_id}::${r.session_date}::${slot ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const cellKey = `${r.student_id}::${r.session_date}`;
      const cell = byCell.get(cellKey) ?? { studentId: r.student_id, date: r.session_date, note: null, otherNote: null, slots: [] };
      const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
      if (!ownsSlot(r.session_date, slot, r.seat_label, r.recorded_via, r.taught_by ?? null)) {
        if (r.note && R.axis.attendanceSlotShare(slotInput(r.session_date, slot, r.seat_label, r.recorded_via, r.taught_by ?? null)) !== 'seat') {
          const hasReason = R.proxy.stripProxyMemo(r.note) !== '';
          if (cell.otherNote === null || (hasReason && R.proxy.stripProxyMemo(cell.otherNote) === '')) cell.otherNote = r.note;
        }
        byCell.set(cellKey, cell);
        continue;
      }
      cell.slots.push({ slot, status: r.status, units: raw !== null && Number.isFinite(raw) ? raw : null });
      if (r.note) { const hasReason = R.proxy.stripProxyMemo(r.note) !== ''; if (cell.note === null || (hasReason && R.proxy.stripProxyMemo(cell.note) === '')) cell.note = r.note; }
      byCell.set(cellKey, cell);
    }
    for (const cell of byCell.values()) {
      const note = cell.note ?? (cell.slots.length > 0 ? cell.otherNote : null);
      if (note) (notes[cell.studentId] ??= {})[cell.date] = note;
      const day = R.cell.rollupDay(cell.slots);
      if (!day) continue;
      (marks[cell.studentId] ??= {})[cell.date] = day.status;
      if (scopeTeacherId && sharedByTeachers && cell.slots.some(x => x.slot === null)) (dayAxis[cell.studentId] ??= {})[cell.date] = true;
      if (day.units !== 1 && day.units > 0) (units[cell.studentId] ??= {})[cell.date] = day.units;
      if (day.count > 1) (slots[cell.studentId] ??= {})[cell.date] = day.slots;
    }
  }
  const creatorIds = [...new Set(creators.map(([, id]) => id))];
  if (creatorIds.length) {
    const names = new Map((await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${creatorIds}::uuid[])`).map(u => [u.id, u.display_name ?? '']));
    for (const [entry, id] of creators) { const name = names.get(id)?.trim(); if (name) entry.createdByName = name; }
  }

  // 수업보고서 파생(수학) — 수기 기록이 없는 등원일만. '수업보고서 미발송' 반은 끈다.
  const derivedActive = R.derive.isDerivedAttendanceSubject(cls?.subject) && cls?.reportOptout !== true;
  if (derivedActive && studentIds.length) {
    const reports = await sql`select student_id, report_date::text report_date, class_id, makeup from public.lesson_reports
      where tenant_id=${t} and student_id = any(${studentIds}::uuid[]) and report_date between ${startIso} and ${endIso}
      ${R.derive.REQUIRE_SENT_REPORT ? sql`and classnote_status='success'` : sql``} order by report_date desc, id desc`;
    const otherIds = [...new Set(reports.map(r => r.class_id).filter(c => c && c !== cls.id))];
    const sameSubject = new Set(otherIds.length ? (await sql`select id from public.classes where tenant_id=${t} and id = any(${otherIds}::uuid[]) and subject=${cls.subject}`).map(c => c.id) : []);
    const own = new Map(), sibling = new Map();
    for (const r of reports) {
      const kind = R.derive.reportEvidenceKind({ makeup: r.makeup, classId: r.class_id, selectedClassId: cls.id, sameSubjectClassIds: sameSubject });
      if (kind === 'ignore') continue;
      const target = kind === 'own' ? own : sibling;
      (target.get(r.student_id) ?? target.set(r.student_id, new Set()).get(r.student_id)).add(r.report_date);
    }
    const holidays = R.cal.buildHolidayMap(settings.operations.holidays);
    const realDays = days.filter(d => !d.placeholder && !holidays[d.date]).filter(d => homeroomHistory?.length || !scopeSince || d.date >= scopeSince).filter(d => !ownDateSet || ownDateSet.has(d.date));
    for (const s of students) {
      const dows = new Set(s.attendDows), ranges = rangesById.get(s.id) ?? [];
      const attendDates = realDays.filter(d => dows.has(d.dow)).filter(d => ranges.some(r => r.start <= d.date && (!r.end || r.end >= d.date))).map(d => d.date);
      const got = R.derive.deriveMarksFromReports({ attendDates, reportDates: own.get(s.id) ?? new Set(), siblingReportDates: sibling.get(s.id), manualDates: new Set(Object.keys(marks[s.id] ?? {})), today, reportOptoutClass: cls?.reportOptout === true });
      for (const [date, mark] of Object.entries(got)) { (marks[s.id] ??= {})[date] = mark; (derived[s.id] ??= {})[date] = true; }
    }
  }
  let presentCount = 0, absentCount = 0, lateCount = 0, makeupCount = 0, totalRecords = 0;
  for (const byDate of Object.values(marks)) for (const status of Object.values(byDate)) {
    totalRecords++;
    if (status === 'present') presentCount++; else if (status === 'absent') absentCount++; else if (status === 'late') lateCount++; else if (status === 'makeup') makeupCount++;
  }
  const presentRate = totalRecords > 0 ? Math.round(R.rate.attendanceRate(R.rate.attendedCount({ present: presentCount, late: lateCount }), totalRecords) * 10) / 10 : 0;
  let autoUnits = R.auto.isAutoUnitsSubject(selectedSubject) && R.lesson.lessonProfileOf({ preset: settings.preset }).autoUnits
    ? R.auto.autoUnitsByDate(days.map(d => d.date), schedules.map(s => R.auto.toAutoUnitsSchedule(s))) : null;
  if (selectedSubject === 'english') {
    // 2.0 `englishCells` — 영어 반도 빈 칸 기본 시수(강사 보기면 그 강사가 새로 만들 교시들의 합)를 싣는다(보이는 기본값 = 저장될 값).
    const cells = days.map(d => ({ date: d.date, starts: scopeTeacherId ? R.scopeOwn.scopeInsertSlots({ homeroomTeacherId, slots: axisSlots }, scopeTeacherId, d.date) : null }));
    const english = await autoUnitsOf(sql, t, R, settings, cells.flatMap(c => (c.starts ? c.starts.map(slotStart => ({ classId, date: c.date, slotStart })) : [{ classId, date: c.date }])));
    autoUnits = Object.fromEntries(cells.flatMap(c => {
      const u = c.starts ? c.starts.reduce((sum, start) => sum + (english.get(R.auto.autoUnitsKey(classId, c.date, start)) ?? 1), 0) : english.get(R.auto.autoUnitsKey(classId, c.date));
      return u === undefined || u === 1 ? [] : [[c.date, u]];
    }));
  }
  return {
    ...base, classDows, students, marks, notes, units, slots, ...(ownDateSet ? { ownDates: [...ownDateSet] } : {}), dayAxis, derived, derivedActive,
    ...(autoUnits ? { autoUnits } : {}), ...(Object.keys(resv).length ? { reservations: resv } : {}), ...(Object.keys(splitView.marks).length ? { splits: splitView.marks } : {}),
    stats: { totalStudents: students.filter(st => !reservedOnlyIds.has(st.id)).length, presentRate, presentCount, absentCount, lateCount, makeupCount, totalRecords },
  };
}

/** 2.0 `toSplit`(features/class-splits/server/queries.ts) — 요일·기간 종류를 2.0 규칙으로. */
function toSplit(R, r) {
  if (!R.splitRules.isSplitDay(r.day_of_week)) return null;
  const kind = r.period_kind === 'day' || r.period_kind === 'month' ? r.period_kind : 'forever';
  return { id: r.id, studentId: r.student_id, sourceClassId: r.source_class_id, targetClassId: r.target_class_id, dayOfWeek: r.day_of_week, startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5),
    validFrom: String(r.valid_from).slice(0, 10), validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null, periodKind: kind, note: r.note ?? null };
}

/** 2.0 `attachLifecycleBadges` — 경계가 있는 학생만 다른 반 수강을 본다(평범한 달엔 쿼리 0). */
async function attachLifecycleBadges(ctx, range, studentMap, classId, subject) {
  const { sql, t, R } = ctx, students = [...studentMap.values()], plain = new Map();
  for (const s of students) { const b = R.span.lifecycleBadgesInRange(range, s.spans, subject); if (b.length > 0) plain.set(s.id, b); }
  if (plain.size === 0) return;
  const ids = [...plain.keys()], dates = [...plain.values()].flat().map(b => b.date).sort();
  const from = R.date.addDays(dates[0], -R.span.TRANSFER_GAP_DAYS), to = R.date.addDays(dates[dates.length - 1], R.span.TRANSFER_GAP_DAYS);
  const rows = await sql`select e.student_id, e.class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, s.withdrawn_at::text withdrawn_at, c.class_name, c.subject
    from public.enrollments e join public.students s on s.id=e.student_id join public.classes c on c.id=e.class_id
    where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) and e.class_id <> ${classId} and e.start_date<=${to} and (e.end_date is null or e.end_date>=${from})`;
  const others = new Map();
  for (const r of rows) (others.get(r.student_id) ?? others.set(r.student_id, []).get(r.student_id)).push(R.span.clipToWithdrawal({ classId: r.class_id, className: r.class_name, subject: r.subject, start: r.start_date, end: r.end_date ?? null, isTransferred: r.is_transferred === true }, r.withdrawn_at));
  for (const id of ids) { const st = studentMap.get(id); if (st) st.badges = R.span.lifecycleBadgesInRange(range, st.spans, subject, others.get(id) ?? []); }
}

/** 반 머리행 끝 "누가 수업했나" — 2.0 `getMonthlyClassWorkers`(그 달 보고서 작성자 → 없으면 출결 기록자, 가장 많은 사람). */
async function readWorkers(sql, t, R, month, classIds) {
  const out = new Map(); if (!classIds.length) return out;
  const { from, to } = R.date.monthRange(month);
  const tally = (rows, source) => {
    const byClass = new Map();
    for (const r of rows) { const name = (r.name ?? '').trim(); if (!name) continue; const m = byClass.get(r.class_id) ?? byClass.set(r.class_id, new Map()).get(r.class_id); m.set(name, (m.get(name) ?? 0) + r.n); }
    for (const [classId, counts] of byClass) { if (out.has(classId)) continue; const top = R.worker.pickTopWorker([...counts].map(([name, count]) => ({ name, count })), source); if (top) out.set(classId, top); }
  };
  tally(await sql`select class_id, teacher_name as name, count(*)::int n from public.lesson_reports where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and report_date between ${from} and ${to} group by 1,2`, 'report');
  const rest = classIds.filter(id => !out.has(id));
  if (rest.length) tally(await sql`select r.class_id, u.display_name as name, count(*)::int n from public.attendance_records r left join public.users u on u.id=r.recorded_by and u.tenant_id=${t}
    where r.tenant_id=${t} and r.class_id = any(${rest}::uuid[]) and r.session_date between ${from} and ${to} group by 1,2`, 'attendance');
  return out;
}

/** 그날의 반별 출결 처리 현황 — 2.0 `getDailyProcessingStatus`(휴원일이면 빈 목록 · 테스트 학생 제외 · 교시 귀속으로 강사별). */
async function readProcessing(sql, t, R, settings, date) {
  if (R.holidaySheet.holidayNameOn(R.cal.buildHolidayMap(settings.operations.holidays), date)) return [];
  const dayEnum = R.cal.DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const sched = await sql`select class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
    from public.class_schedules where tenant_id=${t} and day_of_week::text=${dayEnum} and valid_from<=${date} and (valid_to is null or valid_to>=${date})`;
  const classIds = [...new Set(sched.map(s => s.class_id))]; if (!classIds.length) return [];
  const classes = (await sql`select c.id, c.class_name, c.subject, c.teacher_id, c.closed_at::text closed_at, u.display_name from public.classes c left join public.users u on u.id=c.teacher_id
    where c.tenant_id=${t} and c.id = any(${classIds}::uuid[]) and c.is_active`).filter(c => !c.closed_at || c.closed_at >= date);
  const ids = classes.map(c => c.id); if (!ids.length) return [];
  const [enrollments, records, tests] = await Promise.all([
    sql`select class_id, student_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days from public.enrollments where tenant_id=${t} and class_id = any(${ids}::uuid[]) and start_date<=${date}`,
    sql`select id, class_id, student_id, slot_start::text slot_start, seat_label from public.attendance_records where tenant_id=${t} and session_date=${date} and class_id = any(${ids}::uuid[]) order by id`,
    sql`select id from public.students where tenant_id=${t} and is_test`,
  ]);
  const testIds = new Set(tests.map(s => s.id)), expected = new Map(), withTest = new Set();
  for (const e of enrollments) {
    if (!R.elig.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred === true }, date) || !R.elig.enrollmentAttendsOnDay(e.attendance_days, dayEnum)) continue;
    if (testIds.has(e.student_id)) { withTest.add(e.class_id); continue; }
    (expected.get(e.class_id) ?? expected.set(e.class_id, new Set()).get(e.class_id)).add(e.student_id);
  }
  const recorded = new Map();
  for (const r of records) { if (!expected.get(r.class_id)?.has(r.student_id)) continue; (recorded.get(r.class_id) ?? recorded.set(r.class_id, new Set()).get(r.class_id)).add(r.student_id); }
  return classes.filter(c => !(withTest.has(c.id) && !expected.has(c.id))).map(c => {
    const ex = expected.get(c.id)?.size ?? 0, rec = recorded.get(c.id)?.size ?? 0;
    return { classId: c.id, className: c.class_name, subject: c.subject, teacherName: c.display_name ?? null, expected: ex, recorded: rec, unprocessed: Math.max(0, ex - rec), rate: ex > 0 ? Math.round((Math.min(rec, ex) / ex) * 100) : 100,
      byTeacher: R.processing.teacherProcessing({ date, homeroomTeacherId: c.teacher_id, slots: sched.filter(s => s.class_id === c.id).map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, teacherId: s.teacher_id, slotTeacherLabel: s.slot_teacher_label, validFrom: s.valid_from, validTo: s.valid_to })),
        expectedStudents: expected.get(c.id) ?? new Set(), records: records.filter(r => r.class_id === c.id) }) };
  });
}

/** 요약 허브의 강사 목록 — 2.0 page.tsx `buildHubTeachers`(오늘 현황은 같은 처리 현황, 과목 필터로 좁힌 반만). */
function buildHubTeachers(classes, subjectOrder, today) {
  const teachersOfClass = new Map(classes.map(c => [c.id, classTeachers(c)])), order = subjectOrder.map(s => s.value), byTeacher = new Map();
  for (const c of classes) for (const t of teachersOfClass.get(c.id) ?? []) {
    const cur = byTeacher.get(t.id) ?? { id: t.id, name: t.name, retired: !t.active, classCount: 0, subjects: [], today: null, subjectSet: new Set() };
    cur.classCount++; if (c.subject) cur.subjectSet.add(c.subject); byTeacher.set(t.id, cur);
  }
  for (const r of today) for (const t of teachersOfClass.get(r.classId) ?? []) {
    const acc = byTeacher.get(t.id); if (!acc) continue;
    const own = r.byTeacher?.find(count => count.teacherId === t.id); if (!own || own.expected === 0) continue;
    const cur = acc.today ?? { classes: 0, doneClasses: 0, expected: 0, recorded: 0 };
    cur.classes++; cur.expected += own.expected; cur.recorded += own.recorded; if (own.recorded >= own.expected) cur.doneClasses++; acc.today = cur;
  }
  return [...byTeacher.values()].map(({ subjectSet, ...t }) => ({ ...t, subjects: [...subjectSet].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib); }) }))
    .sort((a, b) => Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name, 'ko'));
}

/** 휴원일 입력 현황 — 2.0 `getHolidayDayActivity`(사무실 범위 · 과목 필터 · 테스트 학생 제외). */
async function readHolidayActivity(sql, t, R, date, subject) {
  const [records, reservations, tests] = await Promise.all([
    sql`select id, class_id, student_id, session_date::text session_date, slot_start::text slot_start, status::text status, to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at
      from public.attendance_records where tenant_id=${t} and session_date=${date} order by id`,
    sql`select id, class_id, student_id, slot_start::text slot_start, slot_end::text slot_end from public.makeup_reservations where tenant_id=${t} and makeup_date=${date} and status='reserved'`,
    sql`select id from public.students where tenant_id=${t} and is_test`,
  ]);
  const testIds = new Set(tests.map(s => s.id)), cids = [...new Set([...records.map(r => r.class_id), ...reservations.map(r => r.class_id)])];
  const sids = [...new Set([...records, ...reservations].map(r => r.student_id).filter(id => !testIds.has(id)))];
  const [classRows, studentRows] = await Promise.all([
    cids.length ? sql`select id, class_name, subject from public.classes where tenant_id=${t} and id = any(${cids}::uuid[])` : [],
    sids.length ? sql`select id, name from public.students where tenant_id=${t} and id = any(${sids}::uuid[])` : [],
  ]);
  return R.holidayAct.holidayActivityCounts(R.holidayAct.foldHolidayActivity({ date, records,
    reservations: reservations.map(r => ({ id: r.id, classId: r.class_id, studentId: r.student_id, slotStart: String(r.slot_start ?? '').slice(0, 5), slotEnd: String(r.slot_end ?? '').slice(0, 5) })),
    testStudentIds: testIds, classScope: null, subject, classById: new Map(classRows.map(c => [c.id, { className: c.class_name ?? '', subject: String(c.subject ?? '') }])),
    studentNameById: new Map(studentRows.filter(s => s.name).map(s => [s.id, s.name])) }));
}

/** 담임·부담임 정렬 재료 — 2.0 `getSubjectSessionsByStudent`(지금 다니는 반, 과목별 주당 수업 수). */
async function readSubjectSessions(sql, t, R, studentIds, today) {
  const out = new Map(); if (!studentIds.length) return out;
  const enrollments = await sql`select student_id, class_id, attendance_days from public.enrollments where tenant_id=${t} and end_date is null and student_id = any(${studentIds}::uuid[]) order by id`;
  if (!enrollments.length) return out;
  const classIds = [...new Set(enrollments.map(e => e.class_id))];
  const [classes, schedules] = await Promise.all([
    sql`select id, subject, teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select class_id, day_of_week::text day_of_week from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and valid_from<=${today} and (valid_to is null or valid_to>=${today}) order by id`,
  ]);
  const meta = new Map(classes.map(c => [c.id, c])), classDows = new Map();
  for (const s of schedules) { const d = R.cal.DOW_KEYS.indexOf(s.day_of_week); if (d < 0) continue; const cur = classDows.get(s.class_id) ?? []; if (!cur.includes(d)) cur.push(d); classDows.set(s.class_id, cur); }
  for (const e of enrollments) {
    const m = meta.get(e.class_id); if (!m?.subject) continue;
    const dows = R.cal.resolveAttendDows(e.attendance_days, classDows.get(e.class_id) ?? []);
    const sessionsPerWeek = dows.length > 0 ? dows.length : R.cal.dowsFromKeys(e.attendance_days).length || 1;
    const bySubject = out.get(e.student_id) ?? new Map(), list = bySubject.get(m.subject) ?? [];
    list.push({ teacherId: m.teacher_id, sessionsPerWeek }); bySubject.set(m.subject, list); out.set(e.student_id, bySubject);
  }
  return out;
}

/** 다른 반 대신 보강 칸(읽기 전용 목록) — 2.0 `loadSubstituteCells`(`taught_by` = 그 강사 · 격자에 선 반·자리 행 제외). */
async function readSubstituteCells(sql, t, R, teacherId, month, excludeClassIds) {
  const [y, m] = month.split('-').map(Number), from = `${month}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await sql`select id::text id, class_id, student_id, session_date::text session_date, slot_start::text slot_start, status::text status, session_units::float8 session_units, seat_label,
      to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') recorded_at
    from public.attendance_records where tenant_id=${t} and taught_by=${teacherId} and session_date between ${from} and ${to} order by id`;
  const shown = new Set(excludeClassIds), eff = R.effective.effectiveAttendanceRecords(rows).filter(r => !shown.has(r.class_id) && !r.seat_label);
  if (!eff.length) return [];
  const cids = [...new Set(eff.map(r => r.class_id))], sids = [...new Set(eff.map(r => r.student_id))];
  const [cls, stu] = await Promise.all([sql`select id, class_name from public.classes where tenant_id=${t} and id = any(${cids}::uuid[])`, sql`select id, name from public.students where tenant_id=${t} and id = any(${sids}::uuid[])`]);
  const cn = new Map(cls.map(c => [c.id, c.class_name ?? ''])), sn = new Map(stu.map(s => [s.id, s.name ?? '']));
  return eff.map(r => { const raw = r.session_units === null || r.session_units === undefined ? 1 : Number(r.session_units); return { classId: r.class_id, className: cn.get(r.class_id) ?? '', studentId: r.student_id, studentName: sn.get(r.student_id) ?? '', date: r.session_date, status: r.status, units: r.status === 'absent' || r.status === 'excused' || !Number.isFinite(raw) || raw <= 0 ? 0 : raw }; })
    .sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className, 'ko') || a.studentName.localeCompare(b.studentName, 'ko'));
}

const SEARCH_SEED_MAX = 40; // 2.0 `HUB_SEARCH_MAX_QUERY`(att-search-seed.ts가 쓰는 길이) — verify가 원문과 맞춘다.

/** 보는 사람 = 2.0의 로그인한 사람(관리자 보기) — 3.0엔 로그인이 없어 호스트가 고른 직원(출결 '전체' 권한)을 주소 `viewer`로 보낸다. */
function pickViewer(editors, wanted) {
  return editors.find(e => e.id === wanted) ?? editors.find(e => e.role === 'master') ?? editors[0] ?? null;
}

export const screen = {
  id: 'attendance', label: '출석부', order: 4,
  // 2.0 `/attendance` searchParams(class·month·teacher·subject·mode·q) + 보는 사람(viewer).
  // 하위 주소(v2path) = 2.0 `/attendance/seat/<자리>`(searchParams date·start).
  params: {
    month: /^\d{4}-(0[1-9]|1[0-2])$/, subject: /^[a-z][a-z0-9_]{0,30}$/, teacher: /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|seat:[a-z]{2,8})$/,
    class: UUID, mode: /^[a-z]{1,12}$/, q: /^[^\u0000-\u001f]{1,80}$/u, viewer: UUID,
    v2path: /^\/attendance(?:\/seat(?:\/[a-z]{1,8}(?:\/month)?)?)?$/, date: /^\d{4}-\d{2}-\d{2}$/, start: /^(?:\d{2}:\d{2}|all)$/,
  },
  /**
   * 2.0 page.tsx(서버 부품)가 JSX에 넘기는 값을 같은 이름·같은 모양으로 — 그리기는 호스트의 2.0 부품(attendance-page.tsx)이 한다.
   * 그룹마다 `matrix`는 2.0 `AttendanceMatrix` 그대로다(단, 표가 안 읽는 `classes` 목록은 그룹마다 싣지 않고 맨 위 `base.classes` 한 벌만).
   */
  async load({ sql, params, tenantId: t, importV2 }) {
    if (params.v2path && params.v2path !== '/attendance') return seatLoad({ sql, params, t, importV2 });
    const R = await loadRules(importV2), today = await copyDay();
    const [settings, transitions] = await Promise.all([readSettings(sql, t, R), readTransitions(sql, t, R)]);
    const editors = await actorsOf(sql, t, R, settings), viewer = pickViewer(editors, params.viewer);
    // 2.0 `loadAttendanceViewPrefs` — 보는 사람의 users.ui_prefs.attendance(없으면 2.0 기본값).
    const [prefRow] = viewer ? await sql`select ui_prefs from public.users where tenant_id=${t} and id=${viewer.id}` : [];
    const viewPrefs = R.viewPrefs.parseAttendanceViewPrefs(prefRow?.ui_prefs?.attendance);
    const searchSeed = String(params.q ?? '').trim().slice(0, SEARCH_SEED_MAX);
    const month = params.month ?? today.slice(0, 7), sortKey = viewPrefs.sort, range = R.date.monthRange(month);
    const allClasses = await readClassAxis(sql, t, R, range.from, range.to, transitions);
    const ctx = { sql, t, R, settings, today, classes: allClasses, defs: new Map() };
    const { operations } = settings, disabled = settings.modules.disabled, on = id => R.modules.isModuleEnabled(disabled, id);
    const seatOn = on('seat_attendance'), payrollOn = on('payroll'), sessionBillingOn = on('session_billing'), eieOn = on('eie');
    const subjectMaps = R.subjects.buildSubjectMaps(operations.subjects), T = key => R.i18n.sheetT('ko', key), Tf = (key, v) => R.i18n.sheetTf('ko', key, v);

    // ── 과목 → 강사 → 반 계층(2.0 page.tsx 그대로). 보는 사람은 관리자 계열(강사 렌즈 myTeacherId = null). ──
    const presentSubjects = new Set(allClasses.map(c => c.subject).filter(Boolean));
    const subjectOptions = [...subjectMaps.options.filter(o => presentSubjects.has(o.value)), ...[...presentSubjects].filter(s => !subjectMaps.options.some(o => o.value === s)).map(s => ({ value: s, label: subjectMaps.labelOf(s) }))];
    const effectiveSubject = params.subject && presentSubjects.has(params.subject) ? params.subject : null;
    const classesForSubject = effectiveSubject ? allClasses.filter(c => c.subject === effectiveSubject) : allClasses;
    const allTeacherOptions = [...new Map(classesForSubject.flatMap(c => classTeachers(c)).map(x => [x.id, { name: x.name, retired: !x.active }]))]
      .map(([value, x]) => ({ value, label: x.retired ? Tf('att.teacher.retiredName', { name: x.name }) : x.name, retired: x.retired }))
      .sort((a, b) => Number(a.retired) - Number(b.retired) || a.label.localeCompare(b.label, 'ko'));
    const retiredCount = allTeacherOptions.filter(x => x.retired).length;
    const showSeats = seatOn && (!effectiveSubject || effectiveSubject === 'english');
    const seatOptions = showSeats ? R.seat.SEAT_KEYS.map(k => ({ value: R.seat.seatFilterValue(k), label: `${R.seat.SEAT_NAME[k]} ${R.seat.SEAT_ROOM[k]}`, hint: T('att.seat.hint') })) : [];
    const teacherOptions = [...allTeacherOptions.filter(x => !x.retired).map(({ value, label }) => ({ value, label })), ...seatOptions,
      ...allTeacherOptions.filter(x => x.retired && (!viewPrefs.hideRetired || x.value === params.teacher)).map(({ value, label }) => ({ value, label, hint: T('att.retired') }))];
    // 강사 드롭다운에서 자리를 고르면 2.0은 자리 화면으로 보낸다(redirect) — 호스트는 그 주소를 알려 주기만 한다.
    const seatPick = R.seat.parseSeatFilterValue(params.teacher);
    const effectiveTeacher = !seatPick && params.teacher && teacherOptions.some(x => x.value === params.teacher) ? params.teacher : null;
    const classesForFilters = classesForSubject.filter(c => !effectiveTeacher || R.sheet.classTaughtBy(c, effectiveTeacher));
    const classOptions = classesForFilters.map(c => ({ value: c.id, label: R.className.classNameFor(c.className, 'ko'), hint: [subjectMaps.labelOf(c.subject), c.teacherName].filter(Boolean).join(' · ') }));
    const effectiveClassId = params.class && classesForFilters.some(c => c.id === params.class) ? params.class : null;
    const selectedClass = effectiveClassId ? allClasses.find(c => c.id === effectiveClassId) ?? null : null;
    const requestedMode = R.attHref.resolveViewMode({ modeParam: params.mode, classParam: effectiveClassId ?? undefined, isTeacher: false });
    const taughtClasses = effectiveTeacher ? classesForSubject.filter(c => R.sheet.classTaughtBy(c, effectiveTeacher)) : [];
    const mode = requestedMode === 'teacher' && taughtClasses.length > 0 ? 'teacher' : 'class';
    const homeroomSinceIdx = mode === 'teacher' && effectiveTeacher ? R.asOf.buildHomeroomSinceIndex(transitions, R.asOf.historyWindowStart(today)) : null;
    const sheetScope = R.sheet.teacherSheetClasses({ classes: classesForSubject, teacherId: effectiveTeacher, window: range, sinceIdx: homeroomSinceIdx });
    const teacherClasses = sheetScope.classes;
    const base = await buildMatrix(ctx, { month, classId: null });
    const teacherMatrices = [];
    if (mode === 'teacher') for (const c of teacherClasses) teacherMatrices.push(await buildMatrix(ctx, { month, classId: c.id, periodMode: 'month', scopeTeacherId: effectiveTeacher, scopeSince: sheetScope.sinceByClass.get(c.id) ?? null }));
    const matrix = mode === 'teacher' ? teacherMatrices[0] ?? base : effectiveClassId ? await buildMatrix(ctx, { month, classId: effectiveClassId, periodMode: viewPrefs.periodMode }) : base;
    // 보이지 않는 '보강' 반(0241a) — 강사 전체 보기에만 한 묶음(2.0 `loadMakeupPool`).
    const [pool] = mode === 'teacher' && effectiveTeacher ? await sql`select id from public.classes where tenant_id=${t} and teacher_id=${effectiveTeacher} and is_makeup_pool limit 1` : [];
    const poolMatrix = pool ? await buildMatrix(ctx, { month, classId: pool.id, periodMode: 'month' }) : null;
    const workerClassIds = mode === 'teacher' ? teacherClasses.map(c => c.id) : effectiveClassId ? [effectiveClassId] : [];
    const [workers, substituteCells] = await Promise.all([
      readWorkers(sql, t, R, month, workerClassIds),
      mode === 'teacher' && effectiveTeacher ? readSubstituteCells(sql, t, R, effectiveTeacher, month, teacherClasses.map(c => c.id)) : [],
    ]);
    const workerOf = id => { const w = workers.get(id) ?? null; return { workerLabel: R.worker.classWorkerLabel(w, 'ko'), workerSource: w?.source ?? null }; };
    const dayLabel = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
    const slim = m => ({ ...m, classes: [] });
    const groups = mode === 'teacher'
      ? teacherClasses.map((c, i) => ({ classId: c.id, className: R.className.classNameFor(c.className, 'ko'), subjectLabel: subjectMaps.labelOf(c.subject), unitSuffix: R.suffix.attendanceUnitSuffix(c.subject, operations.subjects),
        isSpecial: c.isSpecial, matrix: slim(teacherMatrices[i]),
        roleLabel: sheetScope.roles.get(c.id) === 'slot' ? T('att.role.slot') : c.teacherId !== effectiveTeacher && c.historicalTeachers?.some(x => x.id === effectiveTeacher) ? T('att.role.former') : null,
        ...workerOf(c.id), sinceLabel: sheetScope.sinceByClass.get(c.id) ? Tf('att.since', { date: dayLabel(sheetScope.sinceByClass.get(c.id)) }) : null }))
      : effectiveClassId && selectedClass ? [{ classId: effectiveClassId, className: R.className.classNameFor(selectedClass.className, 'ko'), subjectLabel: subjectMaps.labelOf(selectedClass.subject),
        unitSuffix: R.suffix.attendanceUnitSuffix(selectedClass.subject, operations.subjects), isSpecial: selectedClass.isSpecial, matrix: slim(matrix), ...workerOf(effectiveClassId) }] : [];
    const makeupGroup = pool && poolMatrix && poolMatrix.students.length > 0 ? { classId: pool.id, className: R.attLabel.attendanceLabelOf('makeup', 'ko') ?? R.pool.MAKEUP_POOL_PREFIX, subjectLabel: '', matrix: slim(poolMatrix) } : null;
    const allGroups = makeupGroup ? [...groups, makeupGroup] : groups;
    const statsCount = R.totals.sumCounts(allGroups.map(g => R.totals.sumCounts(g.matrix.students.map(s => R.totals.countMarks(g.matrix.marks[s.id] ?? {}, g.matrix.units[s.id] ?? {})))));
    const totalStudents = mode === 'teacher' ? new Set(teacherMatrices.flatMap(m => m.students.map(s => s.id))).size : matrix.stats.totalStudents;
    const sheetEmpty = totalStudents === 0 && !makeupGroup, hubShown = allGroups.length === 0 && mode !== 'teacher';
    const showGroups = mode === 'teacher' && R.sort.isGroupedSort(sortKey);
    const subjectOfClass = new Map((mode === 'teacher' ? teacherClasses : selectedClass ? [selectedClass] : []).map(c => [c.id, c.subject]));
    const roleAnchorTeacher = effectiveTeacher ?? selectedClass?.teacherId ?? null;
    const roleSessions = sortKey === 'role' && roleAnchorTeacher && allGroups.length > 0 ? await readSubjectSessions(sql, t, R, [...new Set(allGroups.flatMap(g => g.matrix.students.map(s => s.id)))], today) : null;
    const orderedRows = R.sort.sortAttendanceRows(allGroups.flatMap(g => g.matrix.students.map(s => ({ classId: g.classId, className: g.className, studentId: s.id, name: s.name, grade: s.grade,
      role: roleSessions ? roleFor(R, roleSessions, s.id, subjectOfClass.get(g.classId) ?? null, roleAnchorTeacher) : null }))), sortKey);
    const visibleDays = padTo31(matrix.days);
    // 도구 — 2.0 page.tsx 조건 그대로(보는 사람 = 관리자 계열).
    const printClass = mode === 'class' && effectiveClassId && selectedClass && matrix.students.length > 0 ? { id: selectedClass.id, className: selectedClass.className } : null;
    const payslipPolicy = { viewerIds: settings.permissions?.specialAccess?.payslipViewerIds ?? [], managerIds: settings.permissions?.specialAccess?.payslipManagerIds ?? [] };
    const canOpenPayslip = mode === 'teacher' && !!effectiveTeacher && !!viewer && payrollOn && R.payslip.canViewPayslip({ id: viewer.id, systemRole: viewer.role }, payslipPolicy);
    const tools = { printClass, showUnitsMaster: hubShown && !!viewer && ['master', 'admin', 'manager'].includes(viewer.role), canIntakeAbsence: !!viewer, canOpenPayslip };
    // 안내문 — 2.0 `notices`(관리자 보기라 7일 잠금·실급여 축 안내는 없다). 굵은 낱말은 'b'.
    const notices = allGroups.length === 0 || sheetEmpty ? [] : [
      mode === 'teacher' ? { key: 'scope', parts: [['', T('att.notice.scope.a')], ['b', T('att.notice.scope.b')], ['', T('att.notice.scope.c')], ['b', T('att.notice.scope.d')], ['', T('att.notice.scope.e')]] } : null,
      statsCount.recorded === 0 && !allGroups.some(g => g.matrix.derivedActive) ? { key: 'empty', parts: [['', T(mode === 'teacher' ? 'att.notice.empty.teacherPre' : 'att.notice.empty.classPre')], ['b', T(mode === 'teacher' ? 'att.notice.empty.teacherBold' : 'att.notice.empty.classBold')], ['', T('att.notice.empty.c')]] } : null,
      allGroups.some(g => g.matrix.derivedActive) ? { key: 'derived', parts: [['', T('att.notice.derived.a')], ['b', R.attLabel.attendanceLabelOf('present', 'ko')], ['', T('att.notice.derived.b')], ['b', R.attLabel.attendanceLabelOf('absent', 'ko')], ['', T('att.notice.derived.c')], ['b', T('att.notice.derived.d')], ['', T('att.notice.derived.e')]] } : null,
    ].filter(Boolean);
    const teacherLabel = teacherOptions.find(x => x.value === effectiveTeacher)?.label;
    const selectedClassLabel = mode === 'teacher' ? Tf('att.teacherAll', { name: teacherLabel ?? T('att.teacherFallback'), n: teacherClasses.length }) : effectiveClassId ? classOptions.find(o => o.value === effectiveClassId)?.label ?? null : null;
    let hubTeachers = [], hubHoliday = null;
    if (hubShown) {
      const holidayName = R.holidaySheet.holidayNameOn(R.cal.buildHolidayMap(operations.holidays), today);
      hubTeachers = buildHubTeachers(classesForFilters, subjectOptions, await readProcessing(sql, t, R, settings, today));
      hubHoliday = holidayName ? { name: holidayName, activity: await readHolidayActivity(sql, t, R, today, effectiveSubject).catch(() => null) } : null;
    }
    return {
      asOf: today, lang: 'ko', month, currentMonth: today.slice(0, 7),
      host: { operations: { subjects: operations.subjects, gradeLevels: operations.gradeLevels, jobTitles: operations.jobTitles, jobTitlesByDepartment: operations.jobTitlesByDepartment, holidays: operations.holidays },
        disabledModules: disabled, preset: settings.preset },
      editors: editors.map(e => ({ id: e.id, name: e.name, role: R.roles.ROLE_LABEL?.[e.role] ?? '' })), viewer: viewer?.id ?? null, viewPrefs,
      seatPick, seatOn, payrollOn, sessionBillingOn, eieOn, base: { classes: base.classes },
      subjectOptions, effectiveSubject, subjectValue: selectedClass ? selectedClass.subject : effectiveSubject,
      teacherOptions, effectiveTeacher, teacherValue: selectedClass ? selectedClass.teacherId : effectiveTeacher, retiredCount,
      classOptions, effectiveClassId, mode, matrixWindow: matrix.window, groups: allGroups, orderedRows, visibleDays, showGroups,
      statsCount, totalStudents, sheetEmpty, hubShown, notices, selectedClassLabel, searchSeed,
      attendanceScope: mode === 'teacher' && effectiveTeacher ? { teacherId: effectiveTeacher, classIds: teacherClasses.map(c => c.id) } : null,
      lockBefore: null, substituteCells, tools,
      hub: hubShown ? { teachers: hubTeachers.filter(x => !viewPrefs.hideRetired || !x.retired), holiday: hubHoliday, todayLabel: hubTodayLabel(today),
        seats: showSeats ? R.seat.SEAT_KEYS.map(k => ({ key: k, name: R.seat.SEAT_NAME[k], room: R.seat.SEAT_ROOM[k], href: `/attendance/seat/${k}`, monthHref: `/attendance/seat/${k}/month?month=${month}`, open: R.seat.USABLE_SEAT_KEYS.includes(k) })) : [] } : null,
    };
  },
};

/**
 * 하위 주소 — 2.0 `/attendance/seat`(첫 자리로 redirect) · `/attendance/seat/<자리>`(자리 하루, v2-attendance-seat.mjs).
 * 2.0과 같이 자리 기능(seat_attendance)이 꺼진 학원·없는 자리는 없는 주소(notFound)다.
 */
async function seatLoad({ sql, params, t, importV2 }) {
  const [R, S] = await Promise.all([loadRules(importV2), loadSeatRules(importV2)]);
  const settings = await readSettings(sql, t, R);
  const host = { operations: { subjects: settings.operations.subjects, gradeLevels: settings.operations.gradeLevels, jobTitles: settings.operations.jobTitles, jobTitlesByDepartment: settings.operations.jobTitlesByDepartment, holidays: settings.operations.holidays },
    disabledModules: settings.modules.disabled, preset: settings.preset };
  if (!R.modules.isModuleEnabled(settings.modules.disabled, 'seat_attendance')) return { page: 'notFound', lang: 'ko', host };
  const [, , , key, sub] = params.v2path.split('/');
  if (!key) return { page: 'redirect', lang: 'ko', host, to: `/attendance/seat/${S.seat.USABLE_SEAT_KEYS[0]}` };
  if (sub === 'month') {
    // 2.0 month/page.tsx — 아는 자리지만 아직 열지 않은 자리는 안내 화면, 모르는 자리는 notFound.
    const any = S.seat.parseAnySeatKey(key);
    if (!any) return { page: 'notFound', lang: 'ko', host };
    if (!S.seat.parseUsableSeatKey(key)) return { page: 'seatMonthClosed', lang: 'ko', host, seatName: S.seat.SEAT_NAME[any] };
    const defs = new Map(), defsOf = async year => defs.get(year) ?? defs.set(year, await readPeriodDefs(sql, t, year)).get(year);
    return { page: 'seatMonth', lang: 'ko', host, ...(await seatMonthProps({ sql, t, R, S, settings, seat: any, params, viewerId: params.viewer, defsOf })) };
  }
  const seat = S.seat.parseUsableSeatKey(key);
  if (!seat || sub) return { page: 'notFound', lang: 'ko', host };
  return { page: 'seatDay', lang: 'ko', host, ...(await seatDayProps({ sql, t, R, S, settings, seat, params, viewerId: params.viewer })) };
}

/** 허브 '오늘' 표기 — 2.0은 `Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month:'long', day:'numeric', weekday:'short' })`(3.0은 복사본 기준일로). */
const hubTodayLabel = ymd => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${ymd}T12:00:00+09:00`));

// ── 2단계: 칸 저장 = 2.0 `setAttendanceCell`(features/attendance/server/actions.ts) ─────────────────────────────
// 원장 2026-10-28 "연습용이므로 모두 docker" — 같은 표(attendance_records)·같은 칸·같은 감사로그(attendance_cell · attendance_note ·
// attendance_clear)를 Docker 복사본에. 저장하는 사람(actor)은 화면에서 고른 '출결 전체 권한' 직원(2.0 권한 표 그대로), 감사로그
// metadata.via = '3.0 연습 복사본'. 월별 출석부의 칸은 교시를 지정하지 않으므로(slotStart 없음) 2.0의 '그날 칸' 갈래만 탄다.
// 2.0과 다른 점(이유를 화면·시험이 함께 적는다):
//  · 보강 예약(예정·이행)이 걸린 칸은 저장하지 않는다 — 2.0은 같은 저장에서 예약 이행(결석 칸 메모·시수)까지 바꾸는데 그 갈래를 옮기지 않았다.
//  · 알림 벨(반 출결 완료·결석 확인·미출결 → 출석)은 만들지 않는다 — 저장 뒤 따로 도는 알림이라 연습 복사본에선 끈다.
const VIA = '3.0 연습 복사본';
const STATUSES = ['present', 'absent', 'late', 'excused', 'makeup', 'early_leave'];
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/**
 * 호스트(shims/server-action.ts)가 보내는 모양 — `{ module, actor, args }`(2.0 함수 인자 그대로 · actor = 3.0 띠에서 고른 사람).
 * 그 2.0 모듈의 그 함수가 아니면 받지 않는다(같은 이름이 다른 모듈에 있어도 섞이지 않게).
 */
function hostCall(raw, module, arity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > arity) throw bad();
  if (typeof raw.actor !== 'string' || !UUID.test(raw.actor)) throw new V2Error(400, 'actor_missing', '저장하는 사람을 먼저 고르세요.');
  return { actor: raw.actor, args: raw.args };
}
const ACTIONS_MODULE = 'features/attendance/server/actions.ts', PREFS_MODULE = 'features/attendance/server/prefs-actions.ts';
/** 2.0 `setAttendanceCell(input)`의 입력 — 월별 출석부가 보내는 칸(교시 지정·당일 출결·보강 추가·빗금 옮기기·비파괴 쓰기 갈래는 아직 없다). */
function cellBody(raw) {
  const { actor, args: [input] } = hostCall(raw, ACTIONS_MODULE, 1);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad();
  for (const k of ['studentId', 'classId']) if (typeof input[k] !== 'string' || !UUID.test(input[k])) throw bad();
  if (typeof input.sessionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate)) throw bad();
  const optStr = (v, max) => { if (v === undefined || v === null) return undefined; if (typeof v !== 'string' || v.length > max) throw bad(); return v; };
  if (input.status !== undefined && input.status !== null && !STATUSES.includes(input.status)) throw new V2Error(400, 'invalid_status', '잘못된 상태입니다');
  if (input.scopeTeacherId !== undefined && input.scopeTeacherId !== null && (typeof input.scopeTeacherId !== 'string' || !UUID.test(input.scopeTeacherId))) throw bad();
  for (const k of ['noteOnly', 'quiet', 'onlyIfEmpty', 'allowMakeup', 'ghostTransfer']) if (input[k] !== undefined && typeof input[k] !== 'boolean') throw bad();
  if (input.slotStart || input.source || input.onlyIfEmpty || input.allowMakeup || input.ghostTransfer) {
    throw new V2Error(409, 'not_in_copy', '이 저장 방식(교시 지정·당일 출결·보강 추가·다른 선생님 교시 옮기기)은 이 연습 화면에 아직 없습니다 — 바뀐 것은 없습니다.');
  }
  return { actor, studentId: input.studentId, classId: input.classId, sessionDate: input.sessionDate, status: input.status ?? null,
    units: optStr(input.units, 10), note: input.note === null ? null : optStr(input.note, 2000), noteOnly: input.noteOnly === true, scopeTeacherId: input.scopeTeacherId ?? null };
}
/** 2.0 prefs-actions의 네 함수 — 인자 하나(정렬 · 날짜축 · 퇴직 숨김 · 접은 반). 값 정리는 2.0 parse 함수가 run에서 한다. */
const prefsBody = check => raw => { const { actor, args: [v] } = hostCall(raw, PREFS_MODULE, 1); if (!check(v)) throw bad(); return { actor, value: v }; };

/** 저장할 수 있는 사람 — 출결 '전체' 권한(2.0 권한 표: 역할 기본 + 학원 설정 덮어쓰기 + 개인 예외). 운영자 계정은 뺀다. */
async function actorsOf(sql, t, R, settings) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status='active' and display_name is not null order by display_name`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id)), base = R.perms.resolveMatrix(settings.permissions?.overrides ?? []), userOverrides = settings.permissions?.userOverrides ?? [];
  return users.filter(u => !operators.has(u.id) && R.perms.accessLevel(u.role, 'attendance', R.perms.applyUserOverrides(base, u.id, u.role, userOverrides)) === 'full')
    .map(u => ({ id: u.id, name: u.display_name, role: u.role }))
    // 원장 먼저(2.0 `ROLE_HIERARCHY` 순) — 호스트 shim이 고른 사람이 없으면 첫 사람으로 저장한다.
    .sort((a, b) => (R.roles.ROLE_HIERARCHY[a.role] ?? 99) - (R.roles.ROLE_HIERARCHY[b.role] ?? 99) || a.name.localeCompare(b.name, 'ko'));
}

/** 이 사람이 그날 이 반을 가르치나 → recorded_via('teacher'|'desk') — 2.0 `resolveWriteVia`(담당 반 ∪ 그날 위임 ∪ 그날 교시 담당 ∪ JJ 담당). */
async function writeViaOf(sql, t, R, settings, actorId, classId, date) {
  const dow = R.axis.axisDowOf(date);
  const [own, dele, slot] = await Promise.all([
    sql`select 1 from public.classes where tenant_id=${t} and id=${classId} and teacher_id=${actorId}`,
    sql`select from_date::text from_date, to_date::text to_date, revoked_at from public.class_delegations where tenant_id=${t} and class_id=${classId} and delegate_user_id=${actorId} and revoked_at is null and from_date<=${date} and to_date>=${date}`,
    sql`select 1 from public.class_schedules where tenant_id=${t} and class_id=${classId} and teacher_id=${actorId} and valid_from<=${date} and (valid_to is null or valid_to>=${date}) limit 1`,
  ]);
  let teaches = own.length > 0 || slot.length > 0 || dele.some(d => R.delegWin.isDelegationActiveOn({ fromDate: d.from_date, toDate: d.to_date, revokedAt: d.revoked_at }, date));
  if (!teaches && dow && (settings.permissions?.specialAccess?.jjReportManagerIds ?? []).includes(actorId)) {
    const jj = await sql`select teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules where tenant_id=${t} and class_id=${classId} and day_of_week::text=${dow} and teacher_id is null and slot_teacher_label is not null`;
    teaches = jj.some(r => { const s = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: r.valid_from, validTo: r.valid_to }; return R.axis.isSeatSlot(s) && R.tlabel.specialSlotLabel(r.slot_teacher_label) === R.tlabel.SELF_STUDY_ROOM_LABEL && R.axis.slotLiveOn(s, date); });
  }
  return teaches ? 'teacher' : 'desk';
}

/** 강사 보기 몫 판정 재료(반 담임·그 달 교시) — 2.0 `loadScopeFacts`. */
async function scopeFactsOf(sql, t, R, classId, date) {
  const { from, to } = R.date.monthRange(date.slice(0, 7));
  const [classes, schedules] = await Promise.all([
    sql`select id, teacher_id from public.classes where tenant_id=${t} and id=${classId}`,
    sql`select class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from<=${to} and (valid_to is null or valid_to>=${from}) order by id`,
  ]);
  const out = new Map(classes.map(c => [c.id, { homeroomTeacherId: c.teacher_id ?? null, slots: [] }]));
  for (const r of schedules) out.get(r.class_id)?.slots.push({ dayOfWeek: r.day_of_week, startTime: r.start_time ?? null, teacherId: r.teacher_id ?? null, slotTeacherLabel: r.slot_teacher_label ?? null, validFrom: r.valid_from, validTo: r.valid_to ?? null });
  return out;
}

/** 새 칸 자동 시수 — 2.0 server `resolveAutoUnits`(수업 길이 → 시수 · 일반판 학원은 없음). */
async function autoUnitsOf(sql, t, R, settings, cells) {
  if (!cells.length || !R.lesson.lessonProfileOf({ preset: settings.preset }).autoUnits) return new Map();
  const classIds = [...new Set(cells.map(c => c.classId))], dates = [...new Set(cells.map(c => c.date))].sort();
  const [classes, schedules] = await Promise.all([
    sql`select id, subject, english_track, class_name from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, lab_separate
      from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and valid_from<=${dates.at(-1)} and (valid_to is null or valid_to>=${dates[0]}) order by id`,
  ]);
  const schedulesOf = new Map();
  for (const r of schedules) (schedulesOf.get(r.class_id) ?? schedulesOf.set(r.class_id, []).get(r.class_id)).push(R.auto.toAutoUnitsSchedule(r));
  return R.auto.planAutoUnits(cells, new Map(classes.map(c => [c.id, c.subject ?? null])), schedulesOf,
    new Map(classes.map(c => [c.id, c.english_track === 'eie' || c.english_track === 'injaewon' ? c.english_track : null])), new Map(classes.map(c => [c.id, c.class_name])));
}

const audit = (sql, t, actor, action, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, 'attendance', null, ${sql.json({ ...metadata, via: VIA })})`;
const backdated = (date, today) => (date < today ? { backdated: true } : {});

async function setCell(sql, t, b, R) {
  const [settings, today] = await Promise.all([readSettings(sql, t, R), copyDay()]);
  const actor = (await actorsOf(sql, t, R, settings)).find(a => a.id === b.actor);
  if (!actor) throw new V2Error(403, 'actor_not_allowed', '출석 관리 권한이 없습니다');
  // 격자 타이핑(2.0 `commitBuffer`) — 0 = 결석, 1·1.5·2 = 출석 + 시수. 숫자로 읽을 수 없으면 2.0처럼 아무것도 하지 않는다.
  const { status, units } = b;
  const { studentId, classId, sessionDate } = b, noteOnly = b.noteOnly, noteProvided = b.note !== undefined, noteVal = (b.note ?? '').trim() || null;
  if (noteOnly && !noteProvided) throw new V2Error(400, 'note_missing', '메모가 없습니다');
  const unitsProvided = units !== undefined;
  let unitsVal = null;
  if (unitsProvided) { const parsed = R.units.parseSessionUnits(units); if (!parsed.ok) throw new V2Error(400, 'invalid_units', parsed.error); unitsVal = parsed.value; }
  if (b.scopeTeacherId != null && !R.scopeOwn.isScopeTeacherId(b.scopeTeacherId)) throw new V2Error(400, 'invalid_scope', R.scopedSplit.SCOPE_INVALID_MESSAGE);
  const [[cls], [stu]] = await Promise.all([sql`select id from public.classes where tenant_id=${t} and id=${classId}`, sql`select id from public.students where tenant_id=${t} and id=${studentId}`]);
  if (!cls || !stu) throw new V2Error(404, 'not_found', '반 또는 학생을 찾지 못했습니다.');
  const [resv] = await sql`select 1 from public.makeup_reservations where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and makeup_date=${sessionDate} and status in ('reserved','done') limit 1`;
  if (resv) throw new V2Error(409, 'reservation_cell', '보강 예약이 걸린 칸입니다 — 2.0은 이 저장에서 예약 이행(결석 칸 메모·시수)까지 함께 바꾸는데, 이 연습 화면은 아직 그 부분이 없어 저장하지 않습니다.');
  const via = await writeViaOf(sql, t, R, settings, actor.id, classId, sessionDate);
  const scopeTeacherId = b.scopeTeacherId ?? null;
  const scopeShareOf = facts => {
    if (!R.scopeOwn.scopeTeaches(facts.get(classId), scopeTeacherId, sessionDate)) throw new V2Error(409, 'scope_not_taught', R.scopedSplit.SCOPE_NOT_TAUGHT_MESSAGE);
    return R.scopeOwn.buildScopeShare({ teacherId: scopeTeacherId, facts });
  };
  const dayRows = () => sql`select id::text id, slot_start::text slot_start, seat_label, recorded_via, note, taught_by, status::text status, session_units::float8 session_units
    from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate} order by recorded_at desc, id desc`;
  const seatOf = share => r => share(classId, sessionDate, r) === 'seat', ownerOf = share => r => share(classId, sessionDate, r) === 'mine';
  const base = { studentId, classId, date: sessionDate };

  if (noteOnly) {
    // 메모만 — 상태·시수·입력자는 그대로(돈에 안 닿는다). 고칠 행 = 화면이 그 메모를 보여 준 행(교시별 최신 · 사유 있는 메모 우선).
    const [rows, facts] = await Promise.all([dayRows(), scopeTeacherId ? scopeFactsOf(sql, t, R, classId, sessionDate) : null]);
    let candidates, skippedSeatRows = 0;
    if (scopeTeacherId) {
      const share = scopeShareOf(facts);
      if (rows.some(r => share.takenSeat?.(classId, sessionDate, r) === true)) throw new V2Error(409, 'seat_taken', R.ghost.SCOPED_REJECT_MESSAGE.seatTaken);
      const { write, seat } = R.scopedSplit.splitOutSeatRows(rows, seatOf(share), ownerOf(share));
      const mine = write.filter(r => share(classId, sessionDate, r) === 'mine'), latest = new Set(R.saveTargets.pickSaveTargets(mine, null).updateIds);
      candidates = mine.filter(r => latest.has(r.id)); skippedSeatRows = seat.length;
    } else { const latest = new Set(R.saveTargets.pickSaveTargets(rows, null).updateIds); candidates = rows.filter(r => latest.has(r.id)); }
    const chosen = R.proxy.noteTargetRow(candidates), ids = R.proxy.sameNoteRows(candidates, chosen).map(r => r.id);
    if (!chosen) throw new V2Error(409, 'no_record', '그날 출결 기록이 없어 메모만 남길 수 없습니다 — 먼저 출결을 입력하세요');
    await sql`update public.attendance_records set note=${noteVal} where id = any(${ids.length > 1 ? ids : [chosen.id]}::uuid[])`;
    await audit(sql, t, actor, 'attendance_note', { ...base, cleared: noteVal === null, ...(scopeTeacherId ? { scopeTeacherId } : {}), ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}), ...backdated(sessionDate, today) });
    return { ok: true };
  }

  if (status === null) {
    // 지우기 — 보강 보고서가 가리키는 반의 칸은 지우지 않는다(2.0 `makeupAnchorDeleteBlock`).
    const [anchor] = await sql`select classnote_status, classnote_sent_at from public.lesson_reports where tenant_id=${t} and makeup and class_id is null and student_id=${studentId} and makeup_class_id=${classId} and report_date=${sessionDate} limit 1`;
    if (anchor) throw new V2Error(409, 'makeup_anchor', anchor.classnote_sent_at || anchor.classnote_status === 'success'
      ? '이 칸은 학부모에게 발송된 보강 보고서의 반입니다 — 지울 수 없습니다(보고서와 출석부 반이 갈라집니다)'
      : "이 칸은 보강 보고서가 가리키는 반입니다 — 원스크린에서 '보강 빼기'로 보고서와 함께 지우거나, 보강 반을 바꿔 주세요");
    let skippedSeatRows = 0;
    if (scopeTeacherId) {
      const [rows, facts] = await Promise.all([dayRows(), scopeFactsOf(sql, t, R, classId, sessionDate)]);
      const share = scopeShareOf(facts), byId = new Map(rows.map(r => [r.id, r]));
      const plan = R.ghost.planScopedDay({ targets: R.saveTargets.pickSaveTargets(rows, null).updateIds.map(id => byId.get(id)), share: r => share(classId, sessionDate, r), clearing: true, taken: r => share.takenSeat?.(classId, sessionDate, r) === true });
      if (plan.kind === 'reject') throw new V2Error(409, plan.reason, R.ghost.SCOPED_REJECT_MESSAGE[plan.reason]);
      if (plan.kind === 'skip') return { ok: true };
      const { write, seat } = R.scopedSplit.splitOutSeatRows(rows, seatOf(share), ownerOf(share)); skippedSeatRows = seat.length;
      if (write.length) await sql`delete from public.attendance_records where id = any(${write.map(r => r.id)}::uuid[])`;
    } else await sql`delete from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate}`;
    await audit(sql, t, actor, 'attendance_clear', { ...base, ...(scopeTeacherId ? { scopeTeacherId } : {}), ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}), ...backdated(sessionDate, today) });
    return { ok: true };
  }

  // 쓰기 — 그날 행(정정 이력 포함, 최신 먼저)에서 교시별 최신을 대상으로(2.0 `pickSaveTargets`).
  const [rows, scopeFacts] = await Promise.all([dayRows(), scopeTeacherId ? scopeFactsOf(sql, t, R, classId, sessionDate) : null]);
  const share = scopeTeacherId ? scopeShareOf(scopeFacts) : null;
  const { updateIds } = R.saveTargets.pickSaveTargets(rows, null), rowById = new Map(rows.map(r => [r.id, r]));
  const dayTargets = updateIds.map(id => ({ id, slot_start: rowById.get(id)?.slot_start ?? null, seat_label: rowById.get(id)?.seat_label ?? null, recorded_via: rowById.get(id)?.recorded_via ?? null, taught_by: rowById.get(id)?.taught_by ?? null }));
  const split = R.scopedSplit.splitOutSeatRows(dayTargets, share ? seatOf(share) : null, share ? ownerOf(share) : null);
  const scopedPlan = share ? R.ghost.planScopedDay({ targets: dayTargets, share: r => share(classId, sessionDate, r), clearing: false, ghostIntent: false, taken: r => share.takenSeat?.(classId, sessionDate, r) === true }) : null;
  if (scopedPlan?.kind === 'reject') throw new V2Error(409, scopedPlan.reason, R.ghost.SCOPED_REJECT_MESSAGE[scopedPlan.reason]);
  const createOwn = scopedPlan?.kind === 'create', writeIds = createOwn ? [] : split.write.map(r => r.id);
  const targetIds = new Set(writeIds), prevRow = rows.find(r => targetIds.has(r.id)), prevStatus = prevRow?.status ?? null;
  const overwrote = !createOwn && updateIds.length > 0;
  const unitsArg = unitsProvided ? unitsVal ?? (R.units.isDefaultUnitsRaw(units) ? null : 1) : undefined;
  let unitsAudit = null, insertedAuto, createdSlots, createdDefaultTotal;
  const ownInsertSlots = !overwrote && share ? R.scopeOwn.scopeInsertSlots(scopeFacts.get(classId), scopeTeacherId, sessionDate) : null;
  if (overwrote) {
    const dayPlan = R.scopedSplit.planDayCellUnits({ targets: dayTargets, owns: share ? r => share(classId, sessionDate, r) === 'mine' : null, unitsVal: unitsArg });
    if (!dayPlan.ok) {
      if (dayPlan.reason === 'noneOwned') throw new V2Error(409, 'none_owned', R.cell.NOT_MINE_MESSAGE);
      throw new V2Error(409, 'indivisible', `이 날은 교시가 ${dayPlan.slots}개라 시수 ${unitsVal}을(를) 교시별로 나눌 수 없습니다 — 더 큰 값을 넣거나 교시별로 입력해 주세요.`);
    }
    if (unitsProvided) unitsAudit = R.unitsAudit.unitsAuditFields({ rows: [...dayPlan.units.keys()].map(id => ({ status: String(rowById.get(id)?.status ?? ''), units: rowById.get(id)?.session_units ?? null })), status, unitsVal: unitsArg, spread: 'split' });
    const groups = R.scopedSplit.groupByPlannedUnits(writeIds, dayPlan.units);
    for (const g of groups.length ? groups : []) {
      if (g.units === undefined) await sql`update public.attendance_records set status=${status}, recorded_by=${actor.id}, recorded_at=now(), recorded_via=${via} ${noteProvided ? sql`, note=${noteVal}` : sql``} where id = any(${g.ids}::uuid[])`;
      else await sql`update public.attendance_records set status=${status}, recorded_by=${actor.id}, recorded_at=now(), recorded_via=${via}, session_units=${g.units} ${noteProvided ? sql`, note=${noteVal}` : sql``} where id = any(${g.ids}::uuid[])`;
    }
  } else if (ownInsertSlots) {
    // 강사 보기 · 그날 교시를 다른 선생님과 나눠 맡는 날 — 제 교시마다 한 행(2.0 그대로).
    const wantsAuto = R.auto.autoUnitsApply({ rawUnits: units, slotStart: null, status });
    const auto = wantsAuto ? await autoUnitsOf(sql, t, R, settings, ownInsertSlots.map(slotStart => ({ classId, date: sessionDate, slotStart }))) : new Map();
    const plan = R.scopedSplit.planDayCellUnits({ targets: ownInsertSlots.map((start, i) => ({ id: `new-${i}`, slot_start: start })), owns: null, unitsVal: unitsArg });
    if (!plan.ok) throw new V2Error(409, 'indivisible', `이 날은 교시가 ${ownInsertSlots.length}개라 시수 ${unitsVal}을(를) 교시별로 나눌 수 없습니다 — 더 큰 값을 넣거나 교시별로 입력해 주세요.`);
    for (const [i, start] of ownInsertSlots.entries()) {
      const u = wantsAuto ? auto.get(R.auto.autoUnitsKey(classId, sessionDate, start)) ?? null : plan.units.get(`new-${i}`) ?? null;
      await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, note, session_units, recorded_by, recorded_via)
        values (${t}, ${classId}, ${studentId}, ${sessionDate}, ${start}, ${status}, ${noteProvided ? noteVal : null}, ${u}, ${actor.id}, ${via})`;
    }
    createdSlots = ownInsertSlots;
    if (wantsAuto) createdDefaultTotal = ownInsertSlots.reduce((sum, start) => sum + (auto.get(R.auto.autoUnitsKey(classId, sessionDate, start)) ?? 1), 0);
  } else {
    const lookedUp = R.auto.autoUnitsApply({ rawUnits: units, slotStart: null, status }) ? ((await autoUnitsOf(sql, t, R, settings, [{ classId, date: sessionDate, slotStart: null }])).get(R.auto.autoUnitsKey(classId, sessionDate, null)) ?? null) : undefined;
    const ins = R.auto.newRowUnits(units, unitsVal, lookedUp);
    insertedAuto = ins.auto === undefined ? undefined : ins.units;
    await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, note, session_units, recorded_by, recorded_via)
      values (${t}, ${classId}, ${studentId}, ${sessionDate}, null, ${status}, ${noteProvided ? noteVal : null}, ${ins.units}, ${actor.id}, ${via})`;
  }
  await audit(sql, t, actor, 'attendance_cell', { ...base, status, ...(overwrote ? { overwrote: true, prevStatus } : { created: true }), ...(unitsProvided ? { units: unitsVal } : {}),
    ...(unitsAudit ? { prevUnits: unitsAudit.prevUnits, nextUnits: unitsAudit.nextUnits } : {}), ...(insertedAuto != null ? { autoUnits: insertedAuto } : {}),
    ...(scopeTeacherId ? { scopeTeacherId } : {}), ...(split.seat.length > 0 ? { skippedSeatRows: split.seat.length } : {}), ...(createdSlots ? { createdSlots } : {}), ...backdated(sessionDate, today) });
  if (createdDefaultTotal !== undefined) return { ok: true, autoUnits: createdDefaultTotal };
  return insertedAuto !== undefined ? { ok: true, autoUnits: insertedAuto } : { ok: true };
}

/**
 * 2.0 `mergeAttendancePrefs`(prefs-actions.ts) — 그 사람의 users.ui_prefs.attendance만 2.0 parse를 거쳐 갈아끼운다(다른 화면 설정은 그대로).
 * 2.0은 로그인한 사람, 3.0은 고른 사람(보는 사람 = 저장하는 사람). 감사로그는 2.0도 남기지 않는다.
 */
async function mergeAttendancePrefs(sql, t, R, actorId, update) {
  const settings = await readSettings(sql, t, R);
  if (!(await actorsOf(sql, t, R, settings)).some(a => a.id === actorId)) throw new V2Error(403, 'actor_not_allowed', '출석 관리 권한이 없습니다');
  const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${actorId}`;
  const raw = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
  await sql`update public.users set ui_prefs=${sql.json({ ...raw, attendance: update(R.viewPrefs.parseAttendanceViewPrefs(raw.attendance)) })} where tenant_id=${t} and id=${actorId}`;
  return { ok: true };
}
/**
 * 아직 옮기지 않은 2.0 조회 셋 — 그 함수의 **2.0 실패 모양**으로 답한다(쓰기 없음 · 저장하는 사람 불필요).
 * shim의 공통 거절(`{ ok:false, error }`)은 이 셋의 결과 모양이 아니라 2.0 부품이 `r.hits`·`r.students`·`p.cells`를 읽다 깨진다.
 */
function readCall(raw, module, arity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > arity) throw bad();
  return {};
}
const HUB_MODULE = 'features/attendance/server/hub-search-actions.ts', INTAKE_MODULE = 'features/attendance/intake/server/actions.ts';
const INTAKE_NOT_YET = '결석 통보 접수는 이 연습 화면에 아직 없습니다 — 바뀐 것은 없습니다.';
const notYet = (module, arity, reply) => ({ validate: raw => readCall(raw, module, arity), run: async ({ importV2 }) => reply(await loadRules(importV2)) });

// 자리(랩실·JJ실) 저장 — 2.0 seat/server/*의 "use server" 함수(v2-attendance-seat-save.mjs).
const SEAT_ACTIONS = 'features/attendance/seat/server/actions.ts', SEAT_MARKS = 'features/attendance/seat/server/mark-actions.ts';
const SEAT_PREFS = 'features/attendance/seat/server/monthly-prefs.ts', SEAT_MEMORIZED = 'features/attendance/seat/server/memorized-actions.ts';
const SEAT_PERIODS = 'features/attendance/seat/server/period-actions.ts', SEAT_PLACEMENTS = 'features/attendance/seat/server/placement-actions.ts';
async function seatCtx({ sql, body, tenantId, importV2 }) {
  const [R, S, X] = await Promise.all([loadRules(importV2), loadSeatRules(importV2), SeatSave.loadSeatSaveRules(importV2)]);
  return { c: { sql, t: tenantId, R, S, settings: await readSettings(sql, tenantId, R), actorId: body.actor }, X };
}
const seatAction = (module, need, fn) => ({
  validate: raw => { const { actor, args: [input] } = hostCall(raw, module, 1); return { actor, input: SeatSave.seatInput(input, need) }; },
  run: async ctx => { const { c, X } = await seatCtx(ctx); return fn(c, ctx.body.input, X); },
});

const prefs = (check, update) => ({ validate: prefsBody(check), run: async ({ sql, body, tenantId, importV2 }) => { const R = await loadRules(importV2); return mergeAttendancePrefs(sql, tenantId, R, body.actor, prev => update(R, prev, body.value)); } });

// 2.0 "use server" 함수와 1:1 — 이름 = 2.0 export 이름(호스트가 그 이름으로 부른다), 인자 = 2.0 인자 그대로.
screen.actions = {
  setAttendanceCell: { validate: cellBody, run: async ({ sql, body, tenantId, importV2 }) => setCell(sql, tenantId, body, await loadRules(importV2)) },
  saveAttendanceSort: prefs(v => typeof v === 'string' && v.length <= 20, (R, prev, v) => ({ ...prev, sort: R.sort.parseAttendanceSortKey(v) })),
  saveAttendancePeriodMode: prefs(v => typeof v === 'string' && v.length <= 20, (R, prev, v) => ({ ...prev, periodMode: R.viewPrefs.parsePeriodMode(v) })),
  saveAttendanceHideRetired: prefs(v => typeof v === 'boolean', (R, prev, v) => ({ ...prev, hideRetired: v !== false })),
  saveAttendanceCollapsed: prefs(v => Array.isArray(v) && v.length <= 400 && v.every(x => typeof x === 'string' && x.length <= 64), (R, prev, v) => ({ ...prev, collapsed: R.viewPrefs.parseAttendanceViewPrefs({ collapsed: v }).collapsed })),
  // 아직 없는 조회 — 2.0 실패 모양(HubSearchResult.error · IntakeStudentSearch.note · 미리보기 error).
  searchAttendanceHubStudents: notYet(HUB_MODULE, 1, R => ({ hits: [], truncated: false, limit: R.hubSearch.HUB_SEARCH_LIMIT, where: '', error: '강사를 고르기 전 학생 검색은 이 연습 화면에 아직 없습니다 — 강사를 고른 뒤 표 위 검색을 쓰세요.' })),
  searchIntakeStudents: notYet(INTAKE_MODULE, 1, () => ({ students: [], note: INTAKE_NOT_YET, truncated: false })),
  previewAbsenceIntake: notYet(INTAKE_MODULE, 1, () => ({ student: null, cells: [], error: INTAKE_NOT_YET })),
  recordAbsenceIntake: notYet(INTAKE_MODULE, 1, () => ({ error: INTAKE_NOT_YET })),
  // 자리 출석부(2.0 seat/server/*) — 이름·인자·반환 모양 = 2.0 그대로.
  setSeatCell: seatAction(SEAT_ACTIONS, ['slot', 'cell'], (c, input) => SeatSave.setSeatCell(c, input)),
  fillSeatSlot: seatAction(SEAT_ACTIONS, ['slot'], (c, input) => SeatSave.fillSeatSlot(c, input)),
  fillSeatPrevAbsent: seatAction(SEAT_ACTIONS, ['slot'], (c, input) => SeatSave.fillSeatPrevAbsent(c, input)),
  setSeatJjField: seatAction(SEAT_MARKS, ['slot', 'cell'], (c, input, X) => SeatSave.setSeatJjField(c, input, X)),
  commitSeatJjEdits: seatAction(SEAT_MARKS, ['slot'], (c, input, X) => SeatSave.commitSeatJjEdits(c, input, X)),
  moveSeatStudentPeriod: seatAction(SEAT_PERIODS, ['cell', 'move'], (c, input) => SeatSave.moveSeatStudentPeriod(c, input)),
  clearSeatPeriodChoices: seatAction(SEAT_PERIODS, ['class'], (c, input) => SeatSave.clearSeatPeriodChoices(c, input)),
  resetSeatPlacements: seatAction(SEAT_PLACEMENTS, ['slot'], (c, input) => SeatSave.resetSeatPlacements(c, input)),
  saveSeatMonthlyCollapsed: {
    validate: raw => { const { actor, args: [v] } = hostCall(raw, SEAT_PREFS, 1); if (!Array.isArray(v) || v.length > 400 || !v.every(x => typeof x === 'string' && x.length <= 64)) throw bad(); return { actor, value: v }; },
    run: async ctx => { const { c } = await seatCtx(ctx); return SeatSave.saveSeatMonthlyCollapsed(c, ctx.body.value); },
  },
  pullSeatMemorizedWords: notYet(SEAT_MEMORIZED, 1, () => SeatSave.MEMORIZED_PULL_REFUSAL),
};

export const __test = { readProcessing, readClassAxis, readTransitions, actorsOf };
