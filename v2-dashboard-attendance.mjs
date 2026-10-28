// 2.0 운영실 영역(2단계 · 출결·수업) — 오늘첫수업 · 보강예정 · 최근 결석 · 출결 현황 · 출석률 추이 · 출결 처리 현황 · 휴원일 입력 · 반복 결석 · 현재 수업 현황.
// 2.0 server.ts의 영역(add/addSliced)이 부르는 함수를 같은 표·같은 조건의 SQL(지점 조건 `tenant_id`)과 2.0 순수 함수(importV2)로. 영역 값 모양 = 2.0 `OverviewData[영역]`.
//   firstClass        ← getFirstClassStudents(dashboard/server/day-arrivals-query.ts: loadDayEnrollmentRows → resolveDayArrivals().starting)
//   makeup            ← loadUpcomingMakeup(dashboard/server/makeup-upcoming.ts: listMakeupScopeClasses(관리자 = 활성 반 전부) · getReservationsInRange · countLater)
//   absent            ← getScopedRecentAbsences(dashboard/server/recent-absences.ts) + recentAbsenceRange(overview/kpi-links.ts) — 담당 = 대신 보강(taught_by) →
//                        자리 표식 → 그날 교시 담당·그날 담임(loadScopeFacts · getHomeroomHistoryIndex) → 이름(loadAxisTeacherNames)
//   attendance · attendanceTrend ← server.ts attendanceHistory(14일 출결 → effectiveAttendanceRecords → attendanceOverview) — 두 영역이 한 번 읽어 나눠 쓴다
//   processing        ← getDailyProcessingStatus(attendance/server/queries.ts)
//   holidayAttendance ← holidayNameOrNull(attendance/server/holiday.ts) · getHolidayDayActivity(attendance/server/holiday-activity.ts) → holidayActivityCounts
//   absences          ← getAbsenceRiskStudents(DB 함수 dashboard_absence_risk) · getAbsenceRiskAnchor · getAbsenceBreakdown(dashboard/server/queries.ts) · unexplainedAbsences
//   schedule          ← getTodaySchedule(timetable/server/queries.ts) → server.ts의 칸 고르기 → mergeContinuousClasses(overview/continuous-classes.ts)
// · 보는 사람 = 원장 — 강사 스코프(teacherScope·effectiveTeacherId)는 없고 과목 관리자 값(slices·pred)은 옮기지 않았다(학원 전체 값 = compute(null)).
// · '오늘' = ctx.today, '지금' = ctx.clock.at(수업 현황의 끝남·진행 중). DB 함수 dashboard_absence_risk는 안에서 now()로 오늘을 정하므로 부르지 않고
//   같은 SQL에 ctx.today를 넣어 다시 썼다(auth_tenant_id() 자리 = 지점 id).
// · 2.0이 실패를 삼키는 자리는 같은 폴백(저장점): 보강 — 기간 예약(빈 목록)·창 뒤 예약 수(0) / 최근 결석 — taught_by 칸 확인(false)·담임 이력(null)과
//   그 안의 감사로그·반 이름(빈 목록)·담당 판정 전체(담당 모름) / 처리 현황 — 테스트 학생(아무도 안 뺌) / 휴원일 입력 — 입력 현황 전체(숫자 없음)와
//   그 안의 그날 보강 예약(빈 목록)·테스트 학생(아무도 안 뺌). 그 밖의 실패는 영역 실패(throw).
// · 2.0과 다르게 한 것(값은 같다):
//   - `.in` 청크 × 페이지 조회는 `= any(배열)` 한 번으로. 줄 순서가 결과에 닿을 수 있는 곳(오늘첫수업 · 최근 결석의 원본 줄과 교시 재료)은
//     2.0 덩어리 차례(100개)로 다시 세운다(`byChunks`). 그 밖은 2.0이 최종 정렬을 하거나 순서와 무관하다(집계·집합).
//   - 2.0이 순서를 정하지 않은 조회(처리 현황의 그날 시간표·반 · 반복 결석 DB 함수의 같은 결석 수 · 담임 전이의 같은 시각)는 id·이름을 덧붙여 고정했다.
//   - 처리 현황·수업 현황의 그날 시간표는 2.0이 페이지 없이 한 번에 읽는다(1,000줄이 넘으면 잘림) — 여기선 전건(복사본 화요일 114줄).
// · 옮기지 않은 것:
//   - 보강의 새 보강 체계 참여(loadNativeParticipants → DB 함수 makeup_list_participants): 2.0은 학원 설정 makeups.mode가 켜졌을 때만 부른다.
//     복사본은 꺼짐('off')이라 2.0도 부르지 않는다(빈 목록). 켜진 복사본이면 이 영역은 실패로 알린다(빈 목록으로 위장하지 않는다).
//   - 화면에 닿지 않는 조회 — 오늘 수업의 수강생 수(getTodaySchedule의 enrollments: 운영실은 studentCount를 버린다) · 보강 반 집합의 담임 이름 ·
//     반복 결석의 과목 분해(과목 관리자 값에만 쓴다) · 담임 전이의 새 담임 이름(이력 색인은 id만 쓴다).
// · 운영실 '흐름'(v2-dashboard-flow-attendance.mjs)이 같은 판정을 창마다 돌리도록 재료 함수를 내보낸다(rules · byChunks · OVERDUE_LOOKBACK_DAYS ·
//   recentAbsenceRows · homeroomHistory · scopeFacts · attribute · cellAxes).
// · 읽기 전용 · 쓰기 없음 · 바깥 호출 없음.
import { queryGate, GateMisuseError } from './v2-onescreen-roster.mjs';

const MODULES = { arrivals: 'features/dashboard/day-arrivals.ts', week: 'features/timetable/lib/week.ts', upcoming: 'features/dashboard/overview/upcoming-window.ts',
  school: 'lib/format/school-grade.ts', mtypes: 'features/makeups/types.ts', kpi: 'features/dashboard/overview/kpi-links.ts', recent: 'features/dashboard/recent-absences.ts',
  asubj: 'features/dashboard/absence-subjects.ts', areasons: 'features/dashboard/absence-reasons.ts', axis: 'features/attendance/teacher-axis.ts',
  intake: 'features/attendance/intake/absence-intake.ts', asOf: 'features/classes/teacher-as-of.ts', kst: 'lib/date-kst.ts', day: 'features/dashboard/overview/attendance-day.ts',
  effective: 'features/attendance/effective-records.ts', elig: 'features/enrollments/eligibility.ts', proc: 'features/attendance/teacher-processing.ts',
  cal: 'features/attendance/calendar.ts', holiday: 'features/class-sheets/lib/holiday.ts', hact: 'features/attendance/holiday-activity.ts',
  tlabel: 'features/timetable/lib/teacher-label.ts', cont: 'features/dashboard/overview/continuous-classes.ts' };
let rulesP = null;
export async function rules(importV2) {
  rulesP ??= Promise.all(Object.entries(MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { rulesP = null; throw e; });
  return rulesP;
}
/** 영역끼리 같은 재료는 한 번만(2.0도 한 번 읽어 나눠 쓴다) — 성공한 값만 기억한다(실패하면 다음 영역이 자기 저장점에서 다시 읽는다). */
async function shared(ctx, key, fn) {
  if (!ctx.memo.has(key)) ctx.memo.set(key, await fn());
  return ctx.memo.get(key);
}
/** 2.0 lib/supabase/batch.ts DEFAULT_CHUNK — `.in` 덩어리 크기. */
const CHUNK = 100;
/** 2.0 덩어리 조회의 줄 차례 — 키가 `ids`의 몇 번째 덩어리에 드는지로 먼저, 덩어리 안은 받은 차례 그대로(안정 정렬). */
export function byChunks(rows, keyOf, ids) {
  const chunkOf = new Map(ids.map((id, i) => [id, Math.floor(i / CHUNK)]));
  return [...rows].sort((a, b) => (chunkOf.get(keyOf(a)) ?? 0) - (chunkOf.get(keyOf(b)) ?? 0));
}
/** 저장점(soft) 안에서 2.0이 또 삼키는 조회 — 그 안의 저장점으로 가둔다. 🔴 다른 조회와 나란히 부르지 말 것(저장점이 엇갈린다). */
async function softIn(s, fn, fallback) {
  try { return await s.savepoint(fn); } catch { return typeof fallback === 'function' ? fallback() : fallback; }
}
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dowOf = (date) => DOW[new Date(`${date}T00:00:00Z`).getUTCDay()];
const hhmm = (v) => String(v ?? '').slice(0, 5);
/** 2.0 holidayNameOrNull — 학원설정 휴일 목록만(설정은 조립부가 이미 읽었다). */
const holidayName = (R, settings, date) => R.holiday.holidayNameOn(R.cal.buildHolidayMap(settings.operations.holidays), date);
/** 2.0 getTestStudentIds — 실패 = 빈 집합(아무도 빼지 않는다). */
const testStudentIds = (gate, t) =>
  gate.soft(async (s) => new Set((await s`select id::text id from public.students where tenant_id=${t} and is_test = true order by id`).map((r) => r.id)), () => new Set());

// ── 오늘첫수업 ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getFirstClassStudents(오늘) — ① 그날 시작·종료하는 수강의 학생 ② 그 학생들의 수강 전건(학생 이름·반 과목 = 임베드) → resolveDayArrivals().starting. */
async function firstClass(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), date = ctx.today, t = ctx.t;
  const candidates = await gate`select student_id::text student_id from public.enrollments where tenant_id=${t} and (start_date = ${date} or end_date = ${date}) order by id`;
  const ids = [...new Set(candidates.map((r) => r.student_id))];
  if (!ids.length) return [];
  const rows = await gate`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.is_transferred_in,
      s.name student_name, c.subject
    from public.enrollments e left join public.students s on s.id = e.student_id and s.tenant_id = ${t} left join public.classes c on c.id = e.class_id and c.tenant_id = ${t}
    where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) order by e.id`;
  const list = byChunks(rows, (r) => r.student_id, ids).map((r) => ({ studentId: r.student_id, studentName: r.student_name ?? '', startDate: r.start_date, endDate: r.end_date,
    isTransferred: !!r.is_transferred, isTransferredIn: !!r.is_transferred_in, onHold: !!r.on_hold, subject: r.subject ?? null }));
  return R.arrivals.resolveDayArrivals(list, date, ctx.settings.operations.subjects).starting;
}

// ── 보강예정 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 OVERDUE_LOOKBACK_DAYS(makeup-upcoming.ts) — 지난 미이행 예약을 되짚는 창. */
export const OVERDUE_LOOKBACK_DAYS = 60;
/** 2.0 loadUpcomingMakeup(오늘, 강사 없음) — 오늘부터 한 달(monthAheadWindow) 예약 + 지난 60일 미이행 · 창 뒤 예약 수. */
async function makeup(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, t = ctx.t;
  const range = R.upcoming.monthAheadWindow(today), from = R.week.shiftDays(today, -OVERDUE_LOOKBACK_DAYS);
  // 새 보강 체계가 켜진 학원이면 2.0이 보강 참여도 함께 싣는다 — 옮기지 않았으므로 빈 목록으로 숨기지 않고 영역 실패로.
  if (R.mtypes.featureLive(ctx.settings.makeups?.mode)) throw new Error('새 보강 체계의 보강 참여 조회는 아직 옮기지 않았습니다');
  const classes = await gate`select id::text id, class_name, subject from public.classes where tenant_id=${t} and is_active = true order by id`;
  const classIds = classes.map((c) => c.id), classById = new Map(classes.map((c) => [c.id, { className: c.class_name, subject: String(c.subject ?? '') }]));
  const [reservations, later] = classIds.length ? await Promise.all([
    // getReservationsInRange — 실패는 빈 목록(fail-soft).
    gate.soft((s) => s`select id::text id, student_id::text student_id, class_id::text class_id, absence_date::text absence_date, makeup_date::text makeup_date,
        slot_start::text slot_start, slot_end::text slot_end, created_by::text created_by from public.makeup_reservations
      where tenant_id=${t} and status = 'reserved' and makeup_date >= ${from} and makeup_date <= ${range.end} and class_id = any(${classIds}::uuid[])
      order by makeup_date, slot_start, id`, []),
    // countLater — 실패는 0.
    gate.soft(async (s) => (await s`select count(*)::int n from public.makeup_reservations
      where tenant_id=${t} and status = 'reserved' and makeup_date > ${range.end} and class_id = any(${classIds}::uuid[])`)[0].n, 0),
  ]) : [[], 0];
  const studentIds = [...new Set(reservations.map((r) => r.student_id))];
  const creatorIds = [...new Set(reservations.flatMap((r) => (r.created_by ? [r.created_by] : [])))];
  // 이름 조회 실패는 삼키지 않는다(2.0 — 0건으로 접으면 거짓 사실).
  const [students, creators] = await Promise.all([
    studentIds.length ? gate`select id::text id, name, grade, school from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : [],
    creatorIds.length ? gate`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${creatorIds}::uuid[])` : []]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const creatorById = new Map(creators.map((c) => [c.id, c.display_name?.trim() || null]));
  const rows = reservations.flatMap((r) => {
    const stu = studentById.get(r.student_id), cls = classById.get(r.class_id);
    if (!stu || !cls) return [];
    const makeupDate = String(r.makeup_date).slice(0, 10);
    return [{ id: r.id, studentId: r.student_id, name: stu.name, schoolGrade: R.school.schoolGradeLabel(stu.school, stu.grade) || null, classId: r.class_id, className: cls.className,
      makeupDate, slotStart: hhmm(r.slot_start), slotEnd: hhmm(r.slot_end), createdByName: r.created_by ? creatorById.get(r.created_by) ?? null : null,
      absenceDate: String(r.absence_date).slice(0, 10), overdue: makeupDate < today, origin: 'reservation' }];
  });
  rows.sort((a, b) => a.makeupDate.localeCompare(b.makeupDate) || a.slotStart.localeCompare(b.slotStart) || a.name.localeCompare(b.name, 'ko'));
  return { range, rows, later };
}

// ── 최근 결석 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getHomeroomHistoryIndex(loadTeacherTransitions → buildHomeroomHistoryIndex) — 인계·담임 변경 감사로그, 반 이름은 유일할 때만. 각 조회 실패 = 빈 목록. */
export async function homeroomHistory(R, gate, t) {
  const [logs, classRows] = await Promise.all([
    gate.soft((s) => s`select metadata, target_label, to_json(created_at)#>>'{}' created_at from public.audit_logs
      where tenant_id=${t} and action in ('class_handover_apply', 'class_update') and metadata->>'newTeacherId' is not null order by created_at, id`, []),
    gate.soft((s) => s`select id::text id, class_name from public.classes where tenant_id=${t} order by id`, [])]);
  const classIdByUniqueName = R.asOf.buildUniqueClassNameIndex(classRows.map((c) => ({ id: c.id, name: c.class_name })));
  const transitions = logs.map((l) => ({
    classId: R.asOf.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName }) ?? '',
    date: R.kst.kstDateOf(l.metadata?.effectiveDate) ?? R.kst.kstDateOf(l.created_at) ?? '',
    teacherId: l.metadata?.newTeacherId ?? null,
    previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null,
    teacherName: null,
  })).filter((x) => !!x.classId && !!x.teacherId && !!x.date);
  return R.asOf.buildHomeroomHistoryIndex(transitions);
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 2.0 loadScopeFacts — (반, 날짜) 칸 → 반 담임 + 그 달들과 겹치는 교시(반 id 덩어리 차례). `s` = 저장점 안의 sql(또는 관문). */
export async function scopeFacts(R, s, t, cells) {
  const valid = cells.filter((c) => !!c.classId && YMD.test(c.date));
  if (!valid.length) return new Map();
  const classIds = [...new Set(valid.map((c) => c.classId))];
  const months = [...new Set(valid.map((c) => c.date.slice(0, 7)))].sort();
  const from = R.kst.monthRange(months[0]).from, to = R.kst.monthRange(months[months.length - 1]).to;
  const [classes, schedules] = await Promise.all([
    s`select id::text id, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    s`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id::text teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and valid_from <= ${to} and (valid_to is null or valid_to >= ${from}) order by id`]);
  const out = new Map();
  for (const c of classes) out.set(c.id, { homeroomTeacherId: c.teacher_id ?? null, slots: [] });
  for (const r of byChunks(schedules, (x) => x.class_id, classIds)) {
    out.get(r.class_id)?.slots.push({ dayOfWeek: r.day_of_week, startTime: r.start_time ?? null, teacherId: r.teacher_id ?? null, slotTeacherLabel: r.slot_teacher_label ?? null,
      validFrom: r.valid_from, validTo: r.valid_to ?? null });
  }
  return out;
}
/** 2.0 seatLabelOf(recent-absences.ts) — 그날 그 교시 자리 슬롯의 방 이름. */
function seatLabelOf(R, slots, cell) {
  const dow = R.axis.axisDowOf(cell.session_date), start = R.axis.normalizeAxisTime(cell.slot_start);
  const seat = slots.find((s) => R.axis.isSeatSlot(s) && s.dayOfWeek === dow && R.axis.slotLiveOn(s, cell.session_date) && (start == null || R.axis.normalizeAxisTime(s.startTime) === start));
  return seat?.slotTeacherLabel?.trim() || null;
}
/** 2.0 attribute(recent-absences.ts) — 결석 칸 하나의 담당: 대신 보강 → 자리 표식 → 교시 담당·그날 담임(resolveRecordTaughtBy). */
export function attribute(R, cell, facts, history) {
  if (cell.taught_by) return { teacherId: cell.taught_by, source: 'slot', seatLabel: null };
  if (cell.seat_label?.trim()) return { teacherId: null, source: 'seat', seatLabel: cell.seat_label.trim() };
  const slots = facts?.slots ?? [];
  if (cell.recorded_via === 'seat') return { teacherId: null, source: 'seat', seatLabel: seatLabelOf(R, slots, cell) };
  const homeroomTeacherId = R.asOf.homeroomTeacherOnDate(history, facts?.homeroomTeacherId ?? null, cell.session_date);
  const axis = R.axis.resolveRecordTaughtBy({ taughtBy: null, homeroomTeacherId, slots, date: cell.session_date, slotStart: cell.slot_start });
  const source = axis.source === 'substitute' ? 'slot' : axis.source;
  return { teacherId: axis.teacherId, source, seatLabel: source === 'seat' ? seatLabelOf(R, slots, cell) : null };
}
/**
 * 2.0 teacherResolver의 재료 — 칸마다 담당 축(attribute)과 그 사람 이름(loadAxisTeacherNames — 이름이 없으면 싣지 않는다 · 화면에 id 금지).
 * 칸 id → { teacherId, source, seatLabel, name, label(intakeTeacherLabel) }. `s` = 저장점 안의 sql(또는 관문).
 */
export async function cellAxes(R, s, t, cells, history) {
  const facts = await scopeFacts(R, s, t, cells.map((c) => ({ classId: c.class_id, date: c.session_date })));
  const axes = new Map(cells.map((c) => [c.id, attribute(R, c, facts.get(c.class_id), history?.get(c.class_id))]));
  const ids = [...new Set([...axes.values()].map((a) => a.teacherId).filter(Boolean))];
  const names = new Map();
  if (ids.length) for (const u of await s`select id::text id, display_name, status::text status from public.users where tenant_id=${t} and id = any(${ids}::uuid[])`) {
    if (u.display_name) names.set(u.id, { id: u.id, name: u.display_name, active: u.status !== 'inactive' });
  }
  for (const a of axes.values()) {
    a.name = a.teacherId ? (names.get(a.teacherId)?.name ?? null) : null;
    a.label = R.intake.intakeTeacherLabel({ source: a.source, teacherName: a.name, seatLabel: a.seatLabel });
  }
  return axes;
}
/** 2.0 teacherResolver — 칸마다 표시 문구. `s` = 저장점 안의 sql. */
async function teacherResolver(R, s, t, cells, history) {
  const axes = await cellAxes(R, s, t, cells, history);
  return (cell) => {
    const a = axes.get(cell.id);
    return a ? { label: a.label } : null;
  };
}
/**
 * 2.0 getScopedRecentAbsences의 조회(강사 없음) — 범위 안 결석 행이 있는 학생 → 그 학생들의 범위 안 전 칸(2.0 덩어리 차례) + 담임 이력(실패 = null).
 * 운영실 칸은 어제까지 7일, 흐름은 여러 창을 덮는 범위로 한 번 부른다(칸마다 최신 정정은 날짜 안에서 정해지므로 범위를 넓혀도 창마다 같다).
 * `absentCellsOnly` = 결석 줄이 한 번이라도 있는 칸(학생·반·날·교시)의 줄만 — 결석 줄이 없는 칸은 최신 정정이 결석일 수 없어 접은 결과가 같다(흐름의 긴 범위용 ·
 * 13주 2만6천 줄 → 2천7백 줄). 운영실 칸은 2.0과 같은 두 단계 조회를 쓴다.
 */
export async function recentAbsenceRows(R, gate, t, range, { absentCellsOnly = false } = {}) {
  const [history, withTaughtBy, absentRows] = await Promise.all([
    // 담임 이력 — 실패하면 그날 담임 대신 지금 담임(null).
    homeroomHistory(R, gate, t).catch((e) => { if (e instanceof GateMisuseError) throw e; return null; }),
    // taughtByColumnReady — 칸이 있나(실패·없음 = false).
    gate.soft(async (s) => { await s`select taught_by from public.attendance_records where tenant_id=${t} limit 1`; return true; }, false),
    absentCellsOnly ? [] : gate`select id::text id, student_id::text student_id from public.attendance_records
      where tenant_id=${t} and status = 'absent' and session_date >= ${range.from} and session_date <= ${range.to} order by id`]);
  const cols = gate.frag`a.id::text id, a.student_id::text student_id, a.class_id::text class_id, a.session_date::text session_date, a.slot_start::text slot_start,
      a.status::text status, to_json(a.recorded_at)#>>'{}' recorded_at, a.note, a.seat_label, a.recorded_via::text recorded_via
      ${withTaughtBy ? gate.frag`, a.taught_by::text taught_by` : gate.frag``}, s.name student_name, c.class_name, c.subject
    from public.attendance_records a left join public.students s on s.id = a.student_id and s.tenant_id = ${t} left join public.classes c on c.id = a.class_id and c.tenant_id = ${t}`;
  if (absentCellsOnly) {
    const raw = await gate`select ${cols} where a.tenant_id=${t} and a.session_date >= ${range.from} and a.session_date <= ${range.to}
      and (a.student_id, a.class_id, a.session_date, coalesce(a.slot_start::text, '')) in (select x.student_id, x.class_id, x.session_date, coalesce(x.slot_start::text, '')
        from public.attendance_records x where x.tenant_id=${t} and x.status = 'absent' and x.session_date >= ${range.from} and x.session_date <= ${range.to})
      order by a.id`;
    return { rows: raw.map((r) => ({ ...r })), history };
  }
  const studentIds = [...new Set(absentRows.map((r) => r.student_id))];
  if (!studentIds.length) return { rows: [], history };
  const raw = await gate`select ${cols} where a.tenant_id=${t} and a.student_id = any(${studentIds}::uuid[]) and a.session_date >= ${range.from} and a.session_date <= ${range.to} order by a.id`;
  return { rows: byChunks(raw, (r) => r.student_id, studentIds).map((r) => ({ ...r })), history };
}
/** 2.0 getScopedRecentAbsences(어제까지 7일, 강사 없음) — recentAbsenceRows → 칸마다 담당 → foldRecentAbsences. */
async function absent(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), t = ctx.t;
  const range = R.kpi.recentAbsenceRange(ctx.today);
  const { rows, history } = await recentAbsenceRows(R, gate, t, range);
  if (!rows.length) return { from: range.from, to: range.to, students: [] };
  const cells = R.asubj.effectiveAbsentCells(rows).filter((c) => c.session_date >= range.from && c.session_date <= range.to);
  // 담당 판정이 실패해도 결석 숫자는 보인다(담당 모름).
  const teacherOf = await gate.soft((s) => teacherResolver(R, s, t, cells, history), () => () => null);
  return R.recent.foldRecentAbsences(rows, range, teacherOf);
}

// ── 출결 현황 · 출석률 추이 ───────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 attendanceHistory(server.ts) — 추이 첫날 ~ 오늘 출결 전건 → 칸마다 최신 정정 → attendanceOverview(도넛 = 오늘 · 추이 = 14일). */
function attendanceHistory(ctx, gate) {
  return shared(ctx, 'attendanceHistory', async () => {
    const R = await rules(ctx.importV2), today = ctx.today;
    const rows = await gate`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start,
        status::text status, to_json(recorded_at)#>>'{}' recorded_at from public.attendance_records
      where tenant_id=${ctx.t} and session_date >= ${R.day.attendanceWindowStart(today)} and session_date <= ${today} order by id`;
    return R.day.attendanceOverview(R.effective.effectiveAttendanceRecords(rows), today);
  });
}
async function attendance(ctx, sp) {
  return (await attendanceHistory(ctx, queryGate(sp))).snapshot;
}
async function attendanceTrend(ctx, sp) {
  return (await attendanceHistory(ctx, queryGate(sp))).trend;
}

// ── 출결 처리 현황 ───────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getDailyProcessingStatus(오늘) — 휴원일이면 빈 목록 · 그 요일 수업 반(활성 · 종강 전)의 예정(테스트 학생 제외) vs 기록 · 교시 귀속으로 강사별. */
async function processing(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), date = ctx.today, t = ctx.t;
  if (holidayName(R, ctx.settings, date)) return [];
  const dayEnum = dowOf(date);
  const sched = await gate`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id::text teacher_id, slot_teacher_label,
      valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
    where tenant_id=${t} and day_of_week::text = ${dayEnum} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date}) order by id`;
  const classIds = [...new Set(sched.map((s) => s.class_id))];
  if (!classIds.length) return [];
  const classes = (await gate`select c.id::text id, c.class_name, c.subject, c.teacher_id::text teacher_id, c.closed_at::text closed_at, u.display_name teacher_name
    from public.classes c left join public.users u on u.id = c.teacher_id and u.tenant_id = ${t}
    where c.tenant_id=${t} and c.id = any(${classIds}::uuid[]) and c.is_active = true order by c.id`).filter((c) => !c.closed_at || c.closed_at >= date);
  const ids = classes.map((c) => c.id);
  if (!ids.length) return [];
  const [enrollments, records, testIds] = await Promise.all([
    gate`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days
      from public.enrollments where tenant_id=${t} and class_id = any(${ids}::uuid[]) and start_date <= ${date} order by id`,
    gate`select id::text id, class_id::text class_id, student_id::text student_id, slot_start::text slot_start, seat_label from public.attendance_records
      where tenant_id=${t} and session_date = ${date} and class_id = any(${ids}::uuid[]) order by id`,
    testStudentIds(gate, t)]);
  const expectedByClass = new Map(), withTest = new Set();
  for (const e of enrollments) {
    if (!R.elig.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred === true }, date)
      || !R.elig.enrollmentAttendsOnDay(e.attendance_days, dayEnum)) continue;
    if (testIds.has(e.student_id)) { withTest.add(e.class_id); continue; }
    (expectedByClass.get(e.class_id) ?? expectedByClass.set(e.class_id, new Set()).get(e.class_id)).add(e.student_id);
  }
  const recordedByClass = new Map();
  for (const r of records) {
    if (!expectedByClass.get(r.class_id)?.has(r.student_id)) continue;
    (recordedByClass.get(r.class_id) ?? recordedByClass.set(r.class_id, new Set()).get(r.class_id)).add(r.student_id);
  }
  const rows = classes.filter((c) => !(withTest.has(c.id) && !expectedByClass.has(c.id))).map((c) => {
    const expected = expectedByClass.get(c.id)?.size ?? 0, recorded = recordedByClass.get(c.id)?.size ?? 0;
    return {
      classId: c.id, className: c.class_name, subject: c.subject, teacherName: c.teacher_name ?? null,
      byTeacher: R.proc.teacherProcessing({ date, homeroomTeacherId: c.teacher_id,
        slots: sched.filter((s) => s.class_id === c.id).map((s) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, teacherId: s.teacher_id,
          slotTeacherLabel: s.slot_teacher_label, validFrom: s.valid_from, validTo: s.valid_to })),
        expectedStudents: expectedByClass.get(c.id) ?? new Set(), records: records.filter((r) => r.class_id === c.id) }),
      expected, recorded, unprocessed: Math.max(0, expected - recorded), rate: expected > 0 ? Math.round((Math.min(recorded, expected) / expected) * 100) : 100,
    };
  });
  rows.sort((a, b) => b.unprocessed - a.unprocessed || a.className.localeCompare(b.className, 'ko'));
  return rows;
}

// ── 휴원일 입력 ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 holidayAttendance — 휴원일이 아니면 null. 휴원일이면 그날 실제 입력(getHolidayDayActivity · 지점 전체) 숫자만 · 실패하면 숫자 없이 이름만. */
async function holidayAttendance(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), date = ctx.today, t = ctx.t;
  const name = holidayName(R, ctx.settings, date);
  if (!name) return null;
  const activity = await gate.soft(async (s) => {
    const records = await s`select id::text id, class_id::text class_id, student_id::text student_id, session_date::text session_date, slot_start::text slot_start,
        status::text status, to_json(recorded_at)#>>'{}' recorded_at from public.attendance_records where tenant_id=${t} and session_date = ${date} order by id`;
    // getReservationsOnDate(실패 = 빈 목록) · getTestStudentIds(실패 = 빈 집합) — 저장점이 엇갈리지 않게 차례로.
    const reservations = await softIn(s, (x) => x`select id::text id, student_id::text student_id, class_id::text class_id, slot_start::text slot_start, slot_end::text slot_end
      from public.makeup_reservations where tenant_id=${t} and makeup_date = ${date} and status = 'reserved' order by slot_start, id`, []);
    const testIds = await softIn(s, async (x) => new Set((await x`select id::text id from public.students where tenant_id=${t} and is_test = true order by id`).map((r) => r.id)), () => new Set());
    const shownReservations = reservations.filter((r) => !testIds.has(r.student_id));
    const classIds = [...new Set([...records.map((r) => r.class_id), ...shownReservations.map((r) => r.class_id)])];
    const studentIds = [...new Set([...records.filter((r) => !testIds.has(r.student_id)).map((r) => r.student_id), ...shownReservations.map((r) => r.student_id)])];
    const [classRows, studentRows] = await Promise.all([
      classIds.length ? s`select id::text id, class_name, subject from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])` : [],
      studentIds.length ? s`select id::text id, name from public.students where tenant_id=${t} and id = any(${studentIds}::uuid[])` : []]);
    return R.hact.foldHolidayActivity({ date, records,
      reservations: reservations.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, slotStart: hhmm(r.slot_start), slotEnd: hhmm(r.slot_end) })),
      testStudentIds: testIds, classScope: null, subject: null,
      classById: new Map(classRows.map((c) => [c.id, { className: c.class_name ?? '', subject: String(c.subject ?? '') }])),
      studentNameById: new Map(studentRows.flatMap((st) => (st.name ? [[st.id, st.name]] : []))) });
  }, null);
  return { name, counts: activity ? R.hact.holidayActivityCounts(activity) : null };
}

// ── 반복 결석 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 getAbsenceRiskStudents의 p_min. */
const RISK_MIN = 3;
/**
 * 2.0 absences — 반복 결석 학생(DB 함수 dashboard_absence_risk: 오늘 이하 마지막 기록일 기준 14일 · 칸마다 최신 정정 · (반, 수업일) 결석 ≥ 3) ·
 * 기준일(getAbsenceRiskAnchor) · 사유 요약(getAbsenceBreakdown) → 사전 통보로 설명되지 않는 결석 ≥ 3만.
 */
async function absences(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), t = ctx.t, today = ctx.today;
  const [risk, anchorRows] = await Promise.all([
    // DB 함수 본문 그대로 — (now() at time zone 'Asia/Seoul')::date 자리에 오늘, auth_tenant_id() 자리에 지점. 같은 결석 수끼리의 차례만 이름·id로 고정.
    gate`with anchor as (
        select max(session_date) as d from public.attendance_records where tenant_id = ${t} and session_date <= ${today}
      ), effective as (
        select distinct on (a.student_id, a.class_id, a.session_date, a.slot_start) a.tenant_id, a.student_id, a.class_id, a.session_date, a.status
        from public.attendance_records a cross join anchor
        where a.tenant_id = ${t} and anchor.d is not null and a.session_date >= anchor.d - interval '13 days' and a.session_date <= anchor.d
        order by a.student_id, a.class_id, a.session_date, a.slot_start, a.recorded_at desc, a.id desc
      )
      select s.id::text student_id, s.name student_name, count(distinct (a.class_id, a.session_date))::int absences
      from effective a join public.students s on s.id = a.student_id and s.tenant_id = a.tenant_id
      where a.status = 'absent' group by s.id, s.name having count(distinct (a.class_id, a.session_date)) >= ${RISK_MIN}
      order by count(distinct (a.class_id, a.session_date)) desc, s.name, s.id`,
    gate`select session_date::text session_date from public.attendance_records where tenant_id=${t} and session_date <= ${today} order by session_date desc limit 1`]);
  const rows = risk.map((r) => ({ studentId: r.student_id, studentName: r.student_name, absences: Number(r.absences) }));
  const anchor = anchorRows[0]?.session_date ?? null;
  if (!anchor) return { anchor: null, rows: [] };
  const ids = rows.map((r) => r.studentId);
  // 원장 화면은 사유 요약만 쓴다(과목 분해는 과목 관리자 값에만).
  const reasons = ids.length ? R.areasons.summarizeAbsenceReasons(await gate`select a.id::text id, a.student_id::text student_id, a.class_id::text class_id,
      a.session_date::text session_date, a.slot_start::text slot_start, a.status::text status, to_json(a.recorded_at)#>>'{}' recorded_at, a.note, c.subject
    from public.attendance_records a left join public.classes c on c.id = a.class_id and c.tenant_id = ${t}
    where a.tenant_id=${t} and a.student_id = any(${ids}::uuid[]) and a.session_date >= ${R.kst.inclusiveDateWindowStart(anchor, 14)} and a.session_date <= ${anchor}
    order by a.id`) : new Map();
  return {
    anchor,
    rows: rows.map((r) => ({ ...r, unexplained: R.areasons.unexplainedAbsences(r.absences, reasons.get(r.studentId)) })).filter((r) => r.unexplained >= 3),
  };
}

// ── 현재 수업 현황 ───────────────────────────────────────────────────────────────────────────────────────────────────
const toMins = (hms) => { const [h, m] = hms.split(':'); return Number(h) * 60 + Number(m); };
/**
 * 2.0 getTodaySchedule() → server.ts가 고른 칸 → mergeContinuousClasses. 오늘 요일 · 유효 배치 · 활성 반(inner) · 종강 전 반만,
 * 강사 = 교시 담당(특수 라벨 해석) → 반 담임 · 교실 = 교시 교실 → 교시 교실 라벨 → 반 교실 · 상태 = '지금'(복사본을 뜬 순간 KST 분) 기준.
 */
async function schedule(ctx, sp) {
  const R = await rules(ctx.importV2), gate = queryGate(sp), today = ctx.today, t = ctx.t;
  const data = await gate`select cs.id::text id, cs.class_id::text class_id, cs.start_time::text start_time, cs.end_time::text end_time, cs.slot_teacher_label, cs.slot_room_label,
      (st.id is not null) has_slot_teacher, st.display_name slot_teacher_name, sr.name slot_room_name,
      c.class_name, c.subject, c.closed_at::text closed_at, ct.display_name class_teacher_name, cr.name class_room_name
    from public.class_schedules cs
      join public.classes c on c.id = cs.class_id and c.tenant_id = ${t} and c.is_active = true
      left join public.users st on st.id = cs.teacher_id and st.tenant_id = ${t}
      left join public.classrooms sr on sr.id = cs.classroom_id and sr.tenant_id = ${t}
      left join public.users ct on ct.id = c.teacher_id and ct.tenant_id = ${t}
      left join public.classrooms cr on cr.id = c.classroom_id and cr.tenant_id = ${t}
    where cs.tenant_id=${t} and cs.day_of_week::text = ${dowOf(today)} and cs.valid_from <= ${today} and (cs.valid_to is null or cs.valid_to >= ${today})
    order by cs.start_time, cs.id`;
  const nowMins = R.kst.kstMinutesOfDay(ctx.clock.at);
  const slots = data.filter((r) => !r.closed_at || r.closed_at >= today).map((r) => ({
    id: r.id, classId: r.class_id, className: r.class_name ?? '?', subject: r.subject ?? '?', startTime: r.start_time, endTime: r.end_time,
    teacherName: R.tlabel.resolveSlotTeacherLabel(r.slot_teacher_label, r.has_slot_teacher ? { display_name: r.slot_teacher_name } : null) ?? r.class_teacher_name ?? null,
    classroomName: r.slot_room_name ?? r.slot_room_label ?? r.class_room_name ?? null,
  })).sort((a, b) => toMins(a.startTime) - toMins(b.startTime)).map((s) => {
    const start = toMins(s.startTime), end = toMins(s.endTime);
    return { ...s, status: nowMins >= end ? 'done' : nowMins >= start ? 'ongoing' : 'upcoming' };
  });
  return R.cont.mergeContinuousClasses(slots);
}

/** 이 단계에서 옮긴 영역(2.0 `Area` 키). */
export const ATTENDANCE_AREAS = { firstClass, makeup, absent, attendance, attendanceTrend, processing, holidayAttendance, absences, schedule };
