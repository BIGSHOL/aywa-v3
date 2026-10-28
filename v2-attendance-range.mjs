// 2.0 화면 · 출석부 — 범위 채우기·지우기(2.0 features/attendance/server/actions.ts `setAttendanceRange` — 같은 이름·인자·반환 모양·감사로그).
// 월별 격자의 드래그 채우기 · Ctrl+Enter · 범위 Delete가 부른다. 날짜가 칸마다 다르다는 것 말고는 일괄 저장과 같은 게이트를 같은 순서로:
//   권한(출결 쓰기) → 강사면 칸마다 수정 가능 기간 · 그날 담당 반 · 그날 수강생(또는 보강 예약) — 걸린 칸만 건너뛴다(blocked).
// 강사 전체 보기(scopeTeacherId)는 시수를 그 강사 몫 행에만 나누고(planDayCellUnits) 자리(JJ·랩실) 행은 상태·지우기까지 안 건드린다 — 판정은 DB로 다시(2.0 그대로).
// 쓰는 것(2.0과 같다): attendance_records(지우기 = 그 칸 모든 행 · 채우기 = 교시별 최신 행 갱신 + 새 칸 삽입 · 수학 자동 시수) · audit_logs attendance_range_clear /
// attendance_range · 쓰고 나서 보강 예약 이행·되돌림(v2-attendance-makeup.mjs).
// 2.0과 다른 점(바뀌는 것 없이 사유를 말한다):
//  · 빗금 칸 입력(ghost — 다른 선생님 교시 행에 상태만 옮기기)은 칸 저장과 같이 아직 옮기지 않아 그런 칸이 하나라도 있으면 저장하지 않는다.
//  · 새 보강 체계(보강관리 켜짐·정리 중) 학원의 보강 예약 칸이 끼면 저장하지 않는다(칸 저장과 같은 규칙).
//  · 알림 벨('반 출결 완료')은 만들지 않는다 · 화면 갱신은 호스트가 저장 뒤 다시 받는다.
import { V2Error } from './v2-screens.mjs';
import { completeMakeupReservations, nativeMakeupsOn, completionKey } from './v2-attendance-makeup.mjs';
import { readTaughtClassSet } from './v2-attendance-live.mjs';

export const RANGE_MODULE = 'features/attendance/server/actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['present', 'absent', 'late', 'excused', 'makeup', 'early_leave'];
export const BULK_CELL_LIMIT = 300;
const GHOST_REFUSAL = '빗금 칸(다른 선생님 교시)에 상태 옮기기는 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.';
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');

/** 2.0 `setAttendanceRange(input)`의 입력 — { cells: [{ studentId, classId, sessionDate, ghost? }], status, units?, quiet?, scopeTeacherId?, scopeClassIds? }. */
export function rangeBody(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== RANGE_MODULE || !Array.isArray(raw.args) || raw.args.length > 1) throw bad();
  if (typeof raw.actor !== 'string' || !UUID.test(raw.actor)) throw new V2Error(400, 'actor_missing', '저장하는 사람을 먼저 고르세요.');
  const input = raw.args[0];
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.cells) || input.cells.length > 2000) throw bad();
  if (input.status !== null && !STATUSES.includes(input.status)) throw new V2Error(400, 'invalid_status', '잘못된 상태입니다');
  if (input.units !== undefined && (typeof input.units !== 'string' || input.units.length > 10)) throw bad();
  if (input.quiet !== undefined && typeof input.quiet !== 'boolean') throw bad();
  if (input.scopeTeacherId !== undefined && input.scopeTeacherId !== null && typeof input.scopeTeacherId !== 'string') throw bad();
  if (input.scopeClassIds !== undefined && input.scopeClassIds !== null && (!Array.isArray(input.scopeClassIds) || input.scopeClassIds.length > 2000)) throw bad();
  const cells = input.cells.map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad();
    if (c.ghost !== undefined && typeof c.ghost !== 'boolean') throw bad();
    return { studentId: typeof c.studentId === 'string' ? c.studentId : '', classId: typeof c.classId === 'string' ? c.classId : '', sessionDate: typeof c.sessionDate === 'string' ? c.sessionDate : '', ghost: c.ghost === true };
  });
  if (cells.some(c => c.ghost)) throw new V2Error(409, 'not_in_copy', GHOST_REFUSAL);
  return { actor: raw.actor, cells, status: input.status, units: input.units, scopeTeacherId: input.scopeTeacherId ?? null, scopeClassIds: input.scopeClassIds ?? null };
}

/** 2.0 `loadScopeFacts` — 여러 (반·날짜)의 몫 판정 재료(반 담임 · 그 달들과 겹치는 교시, id 순). */
async function scopeFactsMany(sql, t, R, cells) {
  const valid = cells.filter(c => !!c.classId && YMD.test(c.date));
  if (valid.length === 0) return new Map();
  const classIds = [...new Set(valid.map(c => c.classId))], months = [...new Set(valid.map(c => c.date.slice(0, 7)))].sort();
  const from = R.date.monthRange(months[0]).from, to = R.date.monthRange(months.at(-1)).to;
  const [classes, schedules] = await Promise.all([
    sql`select id::text id, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`,
    sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, teacher_id::text teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to
      from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and valid_from<=${to} and (valid_to is null or valid_to>=${from}) order by id`,
  ]);
  const out = new Map(classes.map(c => [c.id, { homeroomTeacherId: c.teacher_id ?? null, slots: [] }]));
  for (const r of schedules) out.get(r.class_id)?.slots.push({ dayOfWeek: r.day_of_week, startTime: r.start_time ?? null, teacherId: r.teacher_id ?? null, slotTeacherLabel: r.slot_teacher_label ?? null, validFrom: r.valid_from, validTo: r.valid_to ?? null });
  return out;
}
/** 2.0 `makeupAnchorDeleteBlock` — 보강 보고서가 가리키는 반의 칸이 섞였으면 범위 전체를 지우지 않는다(사유 문장). */
async function makeupAnchorDeleteBlock(sql, t, cells) {
  if (cells.length === 0) return null;
  const rows = await sql`select student_id::text student_id, makeup_class_id::text makeup_class_id, report_date::text report_date, classnote_status, classnote_sent_at from public.lesson_reports
    where tenant_id=${t} and makeup and class_id is null and student_id = any(${[...new Set(cells.map(c => c.studentId))]}::uuid[])
      and makeup_class_id = any(${[...new Set(cells.map(c => c.classId))]}::uuid[]) and report_date = any(${[...new Set(cells.map(c => c.sessionDate))]}::date[])`;
  const want = new Set(cells.map(c => `${c.studentId}|${c.classId}|${c.sessionDate}`)), hit = rows.find(r => want.has(`${r.student_id}|${r.makeup_class_id}|${r.report_date}`));
  if (!hit) return null;
  return hit.classnote_sent_at || hit.classnote_status === 'success'
    ? '이 칸은 학부모에게 발송된 보강 보고서의 반입니다 — 지울 수 없습니다(보고서와 출석부 반이 갈라집니다)'
    : "이 칸은 보강 보고서가 가리키는 반입니다 — 원스크린에서 '보강 빼기'로 보고서와 함께 지우거나, 보강 반을 바꿔 주세요";
}
const backdatedFlag = (dates, today) => (dates.some(d => d < today) ? { backdated: true } : {});

/**
 * 2.0 `setAttendanceRange` — 반환 = { ok, applied, blocked, autoUnits? } | { error }.
 * c = { sql, t, R, M, settings, today, actor, h: { writeViaOf, autoUnitsOf, audit, RESERVATION_CELL } }.
 */
export async function setAttendanceRange(c, b) {
  const { sql, t, R, M, settings, today, actor, h } = c;
  const { status } = b;
  const unitsProvided = b.units !== undefined;
  let unitsVal = null;
  if (unitsProvided) { const parsed = R.units.parseSessionUnits(b.units); if (!parsed.ok) return { error: parsed.error }; unitsVal = parsed.value; }
  const scopeTeacherId = b.scopeTeacherId ?? null;
  if (scopeTeacherId !== null && !R.scopeOwn.isScopeTeacherId(scopeTeacherId)) return { error: R.scopedSplit.SCOPE_INVALID_MESSAGE };
  if (b.scopeClassIds != null && !R.scopeOwn.isScopeClassIds(b.scopeClassIds)) return { error: R.scopedSplit.SCOPE_INVALID_MESSAGE };

  // 같은 (학생·반·날짜)는 한 번만 — 출결 원장은 그 조합에 한 칸.
  const seen = new Set(), cells = [];
  for (const x of b.cells) {
    if (!UUID.test(x.studentId) || !UUID.test(x.classId) || !YMD.test(x.sessionDate)) continue;
    const k = `${x.studentId}::${x.classId}::${x.sessionDate}`;
    if (seen.has(k)) continue;
    seen.add(k); cells.push({ studentId: x.studentId, classId: x.classId, sessionDate: x.sessionDate });
  }
  if (cells.length === 0) return { error: '기록할 대상이 없습니다' };
  if (cells.length > BULK_CELL_LIMIT) return { error: `한 번에 ${BULK_CELL_LIMIT}칸까지만 채울 수 있습니다 — 범위를 좁혀 주세요` };
  const classIds = [...new Set(cells.map(x => x.classId))], studentIds = [...new Set(cells.map(x => x.studentId))], dates = [...new Set(cells.map(x => x.sessionDate))];
  let allowed = cells;

  if (actor.level === 'scoped') {
    // 강사 계정은 자기 출석부로만 · 담당 반은 날짜마다(그날 위임) · 수강은 그 칸의 날짜 기준 · 보강 예약된 학생은 수강행이 없어도 그 칸.
    if (scopeTeacherId !== null && scopeTeacherId !== actor.id) return { error: R.scopedSplit.SCOPE_INVALID_MESSAGE };
    const teaching = new Map();
    for (const d of dates) teaching.set(d, await readTaughtClassSet(sql, t, R, settings, actor.id, d));
    const enrollments = await sql`select class_id::text class_id, student_id::text student_id, start_date::text start_date, end_date::text end_date from public.enrollments
      where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and student_id = any(${studentIds}::uuid[])`;
    const spans = new Map();
    for (const e of enrollments) { const k = `${e.student_id}::${e.class_id}`; (spans.get(k) ?? spans.set(k, []).get(k)).push({ start: e.start_date, end: e.end_date }); }
    const enrolledOn = x => (spans.get(`${x.studentId}::${x.classId}`) ?? []).some(s => (!s.start || s.start <= x.sessionDate) && (!s.end || s.end >= x.sessionDate));
    const notEnrolled = cells.filter(x => !enrolledOn(x));
    const sorted = [...new Set(notEnrolled.map(x => x.sessionDate))].sort();
    const reserved = notEnrolled.length === 0 ? new Set() : new Set((await sql`select student_id::text s, class_id::text c, makeup_date::text d from public.makeup_reservations
      where tenant_id=${t} and status='reserved' and class_id = any(${[...new Set(notEnrolled.map(x => x.classId))]}::uuid[]) and makeup_date between ${sorted[0]} and ${sorted.at(-1)}`).map(r => `${r.s}::${r.c}::${r.d}`));
    allowed = cells.filter(x => R.edit.isWithinAttendanceEditWindow(x.sessionDate, today) && teaching.get(x.sessionDate)?.has(x.classId)
      && (enrolledOn(x) || reserved.has(`${x.studentId}::${x.classId}::${x.sessionDate}`)));
    if (allowed.length === 0) {
      const late = cells.find(x => !R.edit.isWithinAttendanceEditWindow(x.sessionDate, today));
      return { error: late ? R.edit.attendanceLockMessage(late.sessionDate, today) : '담당 반 수강생이 아니어서 기록할 수 없습니다' };
    }
  }
  // 새 보강 체계가 켜진 학원의 보강 예약 칸 — 그 연결 갈래가 없어 범위 전체를 저장하지 않는다(칸 저장과 같은 규칙).
  if (nativeMakeupsOn(M, settings)) {
    const [hit] = await sql`select 1 from public.makeup_reservations where tenant_id=${t} and status in ('reserved','done')
      and (student_id, class_id, makeup_date) in (select * from unnest(${allowed.map(x => x.studentId)}::uuid[], ${allowed.map(x => x.classId)}::uuid[], ${allowed.map(x => x.sessionDate)}::date[])) limit 1`;
    if (hit) throw new V2Error(409, 'reservation_cell', h.RESERVATION_CELL);
  }

  // 강사 전체 보기 — 몫 판정 재료는 걸러진 칸에서(지우기에도 — 자리 행을 남기려면 어느 행이 자리인지 알아야 한다).
  const scopedClassSet = scopeTeacherId ? new Set(b.scopeClassIds ?? classIds) : null;
  const isScoped = x => !!scopedClassSet?.has(x.classId);
  const scopedForFacts = allowed.filter(isScoped);
  const wanted = new Set(allowed.map(x => `${x.studentId}::${x.classId}::${x.sessionDate}`));
  // 기존 기록 — (학생×반×날짜) 교차곱으로 받아 정확한 칸만 골라낸다(칸마다 쿼리 금지 · 최신 먼저, id로 고정).
  const [existingRows, scopeFacts] = await Promise.all([
    sql`select id::text id, class_id::text class_id, student_id::text student_id, session_date::text session_date, slot_start::text slot_start, seat_label, recorded_via, recorded_at,
        status::text status, session_units::float8 session_units, note, taught_by::text taught_by
      from public.attendance_records where tenant_id=${t} and session_date = any(${dates}::date[]) and class_id = any(${classIds}::uuid[]) and student_id = any(${studentIds}::uuid[])
      order by recorded_at desc, id asc`,
    scopedForFacts.length > 0 ? scopeFactsMany(sql, t, R, scopedForFacts.map(x => ({ classId: x.classId, date: x.sessionDate }))) : null,
  ]);
  const mine = existingRows.filter(r => wanted.has(`${r.student_id}::${r.class_id}::${r.session_date}`));
  const cellKeyOf = x => `${x.studentId}::${x.classId}::${x.sessionDate}`;
  const rowFactsById = new Map(mine.map(r => [r.id, { status: r.status, units: r.session_units }]));
  // 칸마다 교시별 최신 1행(2.0 pickSaveTargets 교시 미지정 가지와 같은 규칙).
  const cellSlotRows = new Map(), seenSlot = new Set();
  for (const r of mine) {
    const k = `${r.student_id}::${r.class_id}::${r.session_date}`, slotKey = `${k}::${r.slot_start ? String(r.slot_start).slice(0, 5) : 'DAY'}`;
    if (seenSlot.has(slotKey)) continue;
    seenSlot.add(slotKey);
    (cellSlotRows.get(k) ?? cellSlotRows.set(k, []).get(k)).push({ id: r.id, slot_start: r.slot_start, seat_label: r.seat_label, recorded_via: r.recorded_via, taught_by: r.taught_by ?? null });
  }
  let scopeShare = null, notTaught = 0, noneOwned = 0;
  if (scopeTeacherId && scopedForFacts.length > 0) {
    const facts = scopeFacts, before = allowed.length;
    allowed = allowed.filter(x => !isScoped(x) || R.scopeOwn.scopeTeaches(facts.get(x.classId), scopeTeacherId, x.sessionDate));
    notTaught = before - allowed.length;
    scopeShare = R.scopeOwn.buildScopeShare({ teacherId: scopeTeacherId, facts });
  }
  const ownerOf = x => { const s = isScoped(x) ? scopeShare : null; return s ? r => s(x.classId, x.sessionDate, r) === 'mine' : null; };
  const seatOf = x => { const s = isScoped(x) ? scopeShare : null; return s ? r => s(x.classId, x.sessionDate, r) === 'seat' : null; };
  const scopedPlanOf = (x, clearing) => {
    const s = isScoped(x) ? scopeShare : null;
    if (!s) return null;
    return R.ghost.planScopedDay({ targets: cellSlotRows.get(cellKeyOf(x)) ?? [], share: r => s(x.classId, x.sessionDate, r), clearing, ghostIntent: false, taken: r => s.takenSeat?.(x.classId, x.sessionDate, r) === true });
  };
  const rejected = { seatOnly: 0, stale: 0, seatTaken: 0 };
  const rejectMessage = () => R.ghost.SCOPED_REJECT_MESSAGE[rejected.stale > 0 ? 'stale' : rejected.seatTaken > 0 ? 'seatTaken' : 'seatOnly'];

  // 지우기 — 그 칸의 기록을 전부(정정 이력 포함). 강사 보기는 자리 행을 남기고 제 교시만.
  if (status === null) {
    const anchored = await makeupAnchorDeleteBlock(sql, t, allowed);
    if (anchored) return { error: anchored };
    const rowsByCell = new Map();
    for (const r of mine) { const k = `${r.student_id}::${r.class_id}::${r.session_date}`; (rowsByCell.get(k) ?? rowsByCell.set(k, []).get(k)).push(r); }
    const ids = [];
    let skippedSeatRows = 0;
    allowed = allowed.filter(x => {
      const plan = scopedPlanOf(x, true);
      if (plan?.kind === 'reject') { noneOwned += 1; rejected[plan.reason] += 1; return false; }
      if (plan?.kind === 'skip') return true;
      const { write, seat } = R.scopedSplit.splitOutSeatRows(rowsByCell.get(cellKeyOf(x)) ?? [], seatOf(x), ownerOf(x));
      for (const r of write) ids.push(r.id);
      skippedSeatRows += seat.length;
      return true;
    });
    if (allowed.length === 0 && notTaught + noneOwned > 0) return { error: notTaught > 0 ? R.scopedSplit.SCOPE_NOT_TAUGHT_MESSAGE : rejectMessage() };
    if (ids.length > 0) await sql`delete from public.attendance_records where tenant_id=${t} and id = any(${ids}::uuid[])`;
    if (ids.length > 0) {
      const wrote = [...new Set(allowed.map(x => x.classId))];
      await h.audit(sql, t, actor, 'attendance_range_clear', { ...(wrote.length === 1 ? { classId: wrote[0] } : {}), classIds: wrote, dates: [...new Set(allowed.map(x => x.sessionDate))].sort(),
        count: allowed.length, rows: ids.length, blocked: cells.length - allowed.length, studentIds: [...new Set(allowed.map(x => x.studentId))],
        ...(scopeTeacherId ? { scopeTeacherId } : {}), ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}), ...backdatedFlag(allowed.map(x => x.sessionDate), today) });
    }
    await completeMakeupReservations({ sql, t, R, M, settings, actor }, allowed.map(x => ({ studentId: x.studentId, classId: x.classId, date: x.sessionDate, status: null })));
    return { ok: true, applied: allowed.length, blocked: cells.length - allowed.length };
  }

  // 채우기 — 칸마다 시수 배분 계획(스코프 밖 칸은 owns=null = 종전 답).
  const unitsArg = unitsProvided ? unitsVal ?? (R.units.isDefaultUnitsRaw(b.units) ? null : 1) : undefined;
  const plans = new Map(), createCells = new Set();
  allowed = allowed.filter(x => {
    const k = cellKeyOf(x), targets = cellSlotRows.get(k), scoped = scopedPlanOf(x, false);
    if (scoped?.kind === 'reject') { noneOwned += 1; rejected[scoped.reason] += 1; return false; }
    if (!targets) return true;
    if (scoped?.kind === 'create') { createCells.add(k); return true; }
    const plan = R.scopedSplit.planDayCellUnits({ targets, owns: ownerOf(x), unitsVal: unitsArg });
    if (!plan.ok && plan.reason === 'noneOwned') { noneOwned += 1; return false; }
    plans.set(k, plan);
    return true;
  });
  if (allowed.length === 0 && notTaught + noneOwned > 0) return { error: notTaught > 0 ? R.scopedSplit.SCOPE_NOT_TAUGHT_MESSAGE : rejectMessage() };

  const nowIso = new Date().toISOString();
  const writeIdsOf = new Map();
  let skippedSeatRows = 0;
  for (const x of allowed) {
    const k = cellKeyOf(x), targets = cellSlotRows.get(k);
    if (!targets || createCells.has(k)) continue;
    const { write, seat } = R.scopedSplit.splitOutSeatRows(targets, seatOf(x), ownerOf(x));
    writeIdsOf.set(k, write.map(r => r.id)); skippedSeatRows += seat.length;
  }
  const inserts = allowed.filter(x => !cellSlotRows.has(cellKeyOf(x)) || createCells.has(cellKeyOf(x)));
  // 쓰는 문(via) — 반마다 범위의 첫 날짜로(2.0 resolveWriteVia(dates[0])). 범위 채우기는 월간 격자 전용이라 데스크 게이트가 없다.
  const viaByClass = new Map();
  for (const classId of classIds) viaByClass.set(classId, await h.writeViaOf(sql, t, R, settings, actor.id, classId, dates[0] ?? today));
  // 명시한 시수는 그날 합계 — 칸마다 계획대로 나눠 담고, 계획에 없는 행(시수를 안 보냄 · 못 나눔 · 남의 교시)은 시수 그대로. (via, 시수)로 묶어 쓴다.
  const byKey = new Map();
  for (const x of allowed) {
    const k = cellKeyOf(x), ids = writeIdsOf.get(k) ?? [], via = viaByClass.get(x.classId) ?? 'teacher', plan = plans.get(k);
    for (const id of ids) {
      const units = plan?.ok && plan.units.has(id) ? plan.units.get(id) : undefined, key = `${via}::${units === undefined ? 'keep' : String(units)}`;
      (byKey.get(key) ?? byKey.set(key, { via, units, ids: [] }).get(key)).ids.push(id);
    }
  }
  for (const { via, units, ids } of byKey.values()) {
    if (units === undefined) await sql`update public.attendance_records set status=${status}, recorded_by=${actor.id}, recorded_at=${nowIso}, recorded_via=${via} where tenant_id=${t} and id = any(${ids}::uuid[])`;
    else await sql`update public.attendance_records set status=${status}, recorded_by=${actor.id}, recorded_at=${nowIso}, recorded_via=${via}, session_units=${units} where tenant_id=${t} and id = any(${ids}::uuid[])`;
  }
  // 수학 자동 시수 — 새 칸 + 시수를 안 고른 채우기만. 나눠 맡는 날(강사 보기)은 제 교시마다.
  const slotsOf = x => (isScoped(x) && scopeTeacherId ? R.scopeOwn.scopeInsertSlots(scopeFacts?.get(x.classId), scopeTeacherId, x.sessionDate) : null);
  const rangeWantsAuto = inserts.length > 0 && R.auto.autoUnitsApply({ rawUnits: b.units, slotStart: null, status });
  const rangeAuto = rangeWantsAuto
    ? await h.autoUnitsOf(sql, t, R, settings, inserts.flatMap(x => { const slots = slotsOf(x); return slots ? slots.map(slotStart => ({ classId: x.classId, date: x.sessionDate, slotStart })) : [{ classId: x.classId, date: x.sessionDate, slotStart: null }]; }))
    : new Map();
  const rangeUnitsOf = x => R.auto.newRowUnits(b.units, unitsVal, rangeWantsAuto ? (rangeAuto.get(R.auto.autoUnitsKey(x.classId, x.sessionDate)) ?? null) : undefined);
  const insertRows = [], slotUnitsByCell = new Map();
  let rangeCreatedSlotRows = 0;
  for (const x of inserts) {
    const base = { tenant_id: t, class_id: x.classId, student_id: x.studentId, session_date: x.sessionDate, status, recorded_by: actor.id, recorded_via: viaByClass.get(x.classId) ?? 'teacher' };
    const slots = slotsOf(x);
    if (!slots) { insertRows.push({ ...base, slot_start: null, session_units: rangeUnitsOf(x).units }); continue; }
    const plan = R.scopedSplit.planDayCellUnits({ targets: slots.map((start, i) => ({ id: `new-${i}`, slot_start: start })), owns: null, unitsVal: unitsArg });
    let slotUnits = 0;
    slots.forEach((start, i) => {
      const units = rangeWantsAuto ? rangeAuto.get(R.auto.autoUnitsKey(x.classId, x.sessionDate, start)) ?? null : plan.ok ? (plan.units.get(`new-${i}`) ?? null) : null;
      slotUnits += units ?? 1;
      insertRows.push({ ...base, slot_start: start, session_units: units });
      rangeCreatedSlotRows += 1;
    });
    slotUnitsByCell.set(cellKeyOf(x), slotUnits);
  }
  if (insertRows.length > 0) await sql`insert into public.attendance_records ${sql(insertRows)}`;

  // 감사로그 — 한 줄 요약 · 시수가 실제로 바뀐 칸만 세어 그 칸들의 합(새 칸은 빠진다 — 이전 값이 없다).
  let unitsChangedCells = 0, prevUnitsSum = 0, nextUnitsSum = 0;
  if (unitsProvided) {
    for (const x of allowed) {
      const plan = plans.get(cellKeyOf(x));
      if (!plan?.ok) continue;
      const cellRows = [...plan.units.keys()].map(id => rowFactsById.get(id));
      if (cellRows.some(r => !r)) continue;
      const changed = R.unitsAudit.unitsAuditFields({ rows: cellRows, status, unitsVal: unitsArg ?? null, spread: 'split' });
      if (!changed) continue;
      unitsChangedCells += 1; prevUnitsSum = R.units.round1(prevUnitsSum + changed.prevUnits); nextUnitsSum = R.units.round1(nextUnitsSum + changed.nextUnits);
    }
  }
  const wrote = [...new Set(allowed.map(x => x.classId))];
  await h.audit(sql, t, actor, 'attendance_range', { ...(wrote.length === 1 ? { classId: wrote[0] } : {}), classIds: wrote, dates: [...new Set(allowed.map(x => x.sessionDate))].sort(), status,
    count: allowed.length, created: inserts.length, ...(rangeCreatedSlotRows > 0 ? { createdSlotRows: rangeCreatedSlotRows } : {}), blocked: cells.length - allowed.length,
    studentIds: [...new Set(allowed.map(x => x.studentId))], ...(unitsProvided && allowed.length > 0 ? { units: unitsVal } : {}),
    ...(unitsChangedCells > 0 ? { prevUnits: prevUnitsSum, nextUnits: nextUnitsSum, unitsChangedCells } : {}), ...(scopeTeacherId ? { scopeTeacherId } : {}),
    ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}),
    ...R.auto.autoUnitsLogFields(inserts.filter(x => !slotUnitsByCell.has(cellKeyOf(x))).map(x => rangeUnitsOf(x).auto).filter(v => typeof v === 'number')),
    ...backdatedFlag(allowed.map(x => x.sessionDate), today) });

  // 보강 예약 이행 — 범위로 쓴 칸 중 예약이 걸린 것(created = 이번에 새로 만든 행).
  const rangeCreated = new Set(inserts.map(x => completionKey({ studentId: x.studentId, classId: x.classId, date: x.sessionDate })));
  await completeMakeupReservations({ sql, t, R, M, settings, actor }, allowed.map(x => ({ studentId: x.studentId, classId: x.classId, date: x.sessionDate, status,
    unitsExplicit: unitsProvided && !R.units.isDefaultUnitsRaw(b.units), created: rangeCreated.has(completionKey({ studentId: x.studentId, classId: x.classId, date: x.sessionDate })) })));

  // 응답 — 상태만 바꾼 기존 칸도 실제 합계(결석 칸의 숨은 시수는 화면 값으로 알 수 없다) · 자동 시수로 새로 만든 칸은 저장값.
  const autoUnits = [];
  if (!unitsProvided) {
    for (const x of allowed) {
      const ids = writeIdsOf.get(cellKeyOf(x));
      if (!ids?.length) continue;
      const total = R.units.COUNTABLE_STATUSES.has(status) ? R.units.round1(ids.reduce((sum, id) => sum + (rowFactsById.get(id)?.units ?? 1), 0)) : 0;
      autoUnits.push({ studentId: x.studentId, classId: x.classId, sessionDate: x.sessionDate, units: total === 0 || total === 1 ? null : total });
    }
  }
  if (rangeWantsAuto) {
    for (const x of inserts) {
      const n = slotUnitsByCell.get(cellKeyOf(x));
      if (n !== undefined) { autoUnits.push({ studentId: x.studentId, classId: x.classId, sessionDate: x.sessionDate, units: n === 1 ? null : n }); continue; }
      const ins = rangeUnitsOf(x);
      if (ins.auto !== undefined) autoUnits.push({ studentId: x.studentId, classId: x.classId, sessionDate: x.sessionDate, units: ins.units });
    }
  }
  return { ok: true, applied: allowed.length, blocked: cells.length - allowed.length, ...(!unitsProvided || rangeWantsAuto ? { autoUnits } : {}) };
}
