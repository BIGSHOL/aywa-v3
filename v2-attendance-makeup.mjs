// 2.0 화면 · 출석부 — 보강 예약 이행·되돌림(2.0 features/attendance/server/makeup-reservation-complete.ts `completeMakeupReservations`).
// 출결 저장 경로(칸 · 교시 칸 · 일괄 · 자리 칸·일괄)가 저장 **뒤에** 부른다 — 보강일에 그 (학생·반) 출결이 시수 상태로 찍히면 예약을 done으로,
// 지워지거나 결석으로 고쳐지면 reserved로 되돌린다. 판정은 호출부가 보낸 상태가 아니라 DB의 그날 유효 행(2.0 pickFulfillingRow).
// 쓰는 것(2.0과 같다): ① 예약 행 done + 출결 행 연결(0행이면 그만 — 두 경로가 같이 들어와도 한 번만) ② 보강 칸 메모 "M/D 결석분 보강"(멱등)
// ③ 시수 자동값(강사가 숫자를 안 쳤고 · 새 행이거나 시수가 기본인 그날 전체 행만 · 학원 수업 규칙이 자동 시수일 때 — 정규 수업일이면 정규 + 보강값)
// ④ 결석 칸 메모 "보강 예정" → "보강 완료" · 감사로그 makeup_reserve_done / makeup_reserve_revert(대상 = 학생 · 반).
// 갈래: 이 복사본(그리고 새 보강 체계가 꺼진 학원)은 2.0 `classifyLegacyReservations`가 'legacy'라 위 길만 탄다. 새 보강 체계(makeups.mode on·draining)의
// 연결 이행(handleMappedFulfill 등)은 옮기지 않았다 — 그 학원에서는 호출부가 보강 예약이 걸린 칸 저장을 거절한다(바뀌는 것 없음).
// fail-soft(2.0과 같다): 이행이 실패해도 출결 저장은 되돌리지 않는다 — savepoint 안에서 돌리고, 실패하면 그 부분만 되돌린다
// (예약마다 savepoint 하나 — 2.0의 예약별 try/catch). 2.0과 다른 점: 2.0은 수강·시간표 조회가 실패하면 시수만 빼고 이행하지만,
// 여기서는 같은 트랜잭션의 조회 실패가 그 예약의 이행을 통째로 되돌린다(복사본 DB 오류 때만 — 다음 저장이 다시 판정한다).
export const MAKEUP_MODULES = {
  resv: 'features/attendance/makeup-reservation.ts', link: 'features/onescreen/makeup-absence-link.ts', grid: 'features/class-sheets/lib/grid.ts', mtypes: 'features/makeups/types.ts',
};
let makeupRules = null;
export function loadMakeupRules(importV2) {
  makeupRules ??= Promise.all(Object.entries(MAKEUP_MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch(e => { makeupRules = null; throw e; });
  return makeupRules;
}
const VIA = '3.0 연습 복사본';
const hasColumn = async (sql, table, column) => (await sql`select exists (select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) ok`)[0].ok;
/** 새 보강 체계(2.0 `featureLive(settings.makeups.mode)`)가 켜진 학원인가 — 켜졌으면 그 갈래가 없어 호출부가 예약 칸 저장을 거절한다. */
export const nativeMakeupsOn = (M, settings) => M.mtypes.featureLive(settings.makeups?.mode);
export const completionKey = c => `${c.studentId}|${c.classId}|${c.date}`;

/** 2.0 `toReservation`(makeup-reservation-queries.ts). */
const toReservation = r => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: String(r.absence_date).slice(0, 10), makeupDate: String(r.makeup_date).slice(0, 10),
  slotStart: String(r.slot_start ?? '').slice(0, 5), slotEnd: String(r.slot_end ?? '').slice(0, 5), periodLabel: r.period_label ?? null, note: r.note ?? null,
  status: r.status === 'done' ? 'done' : 'reserved', createdBy: r.created_by ?? null, ...('absence_class_id' in r ? { absenceClassId: r.absence_class_id ?? null } : {}) });
/** 그날 그 칸의 행 전부(정정 이력 포함) → 유효 행(2.0 loadDay). */
async function loadDay(sql, t, R, studentId, classId, date) {
  const rows = await sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status, note,
      session_units::float8 session_units, to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
    from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${date} order by id`;
  return R.effective.effectiveAttendanceRecords(rows);
}
/** 2.0 `isRegularAttendee` — 그날 그 반 정규 수강생으로 오는 날인가(수강 유효 + 분리등원 요일). */
async function isRegularAttendee(sql, t, R, r) {
  const rows = await sql`select start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days::text[] attendance_days from public.enrollments
    where tenant_id=${t} and class_id=${r.classId} and student_id=${r.studentId}`;
  const dow = R.cal.DOW_KEYS[R.date.weekdayIndexOf(r.makeupDate)] ?? '';
  return rows.some(e => R.elig.isEnrollmentActiveOn({ startDate: e.start_date ?? '0000-01-01', endDate: e.end_date ?? null, onHold: e.on_hold ?? false, isTransferred: e.is_transferred === true }, r.makeupDate)
    && R.elig.enrollmentAttendsOnDay(e.attendance_days, dow));
}
/** 2.0 `classDayMinutes` — 그날 그 반의 실제 수업 분(자리 제외 · 같은 시작 한 번 — liveSlotMinutesOn). */
async function classDayMinutes(sql, t, R, M, classId, date) {
  const rows = await sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label
    from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from<=${date} and (valid_to is null or valid_to>=${date})`;
  let total = 0;
  for (const m of M.grid.liveSlotMinutesOn(date, rows.map(R.auto.toAutoUnitsSchedule)).values()) total += m;
  return total;
}
const audit = (sql, t, actor, action, targetLabel, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, 'attendance', ${targetLabel ?? null}, ${sql.json({ ...metadata, via: VIA })})`;

/**
 * 2.0 `completeMakeupReservations(ctx, cells)` — 손댄 칸들 중 예약이 걸린 것을 이행하거나 되돌린다. 시수를 바꾼 칸(→ 저장된 시수, null = 1)을 돌려준다.
 * ctx = { sql, t, R, M, settings, actor }. cells = [{ studentId, classId, date, status, unitsExplicit?, created?, addToCurrent? }].
 */
export async function completeMakeupReservations(ctx, cells) {
  const changed = new Map();
  if (cells.length === 0 || nativeMakeupsOn(ctx.M, ctx.settings)) return changed;
  try {
    await ctx.sql.savepoint(async sp => { await completeIn({ ...ctx, sql: sp }, cells, changed); });
  } catch (e) {
    changed.clear();
    console.error('[v2-attendance] 보강 예약 이행·되돌림 실패 — 출결 저장은 그대로 둔다', e?.message ?? e);
  }
  return changed;
}
async function completeIn(ctx, cells, changed) {
  const { sql, t, R, M } = ctx;
  const byClassDate = new Map();
  for (const c of cells) {
    if (!c.studentId || !c.classId || !c.date) continue;
    const k = `${c.classId}|${c.date}`, g = byClassDate.get(k) ?? { classId: c.classId, date: c.date, cells: new Map() };
    g.cells.set(c.studentId, c); byClassDate.set(k, g);
  }
  const withAbsenceClass = await hasColumn(sql, 'makeup_reservations', 'absence_class_id');
  for (const g of byClassDate.values()) {
    const ids = [...g.cells.keys()].slice(0, 100);
    const rows = await sql`select id::text id, student_id::text student_id, class_id::text class_id, absence_date::text absence_date, makeup_date::text makeup_date, slot_start::text slot_start,
        slot_end::text slot_end, period_label, note, status, created_by::text created_by ${withAbsenceClass ? sql`, absence_class_id::text absence_class_id` : sql``}
      from public.makeup_reservations where tenant_id=${t} and class_id=${g.classId} and makeup_date=${g.date} and status in ('reserved','done') and student_id = any(${ids}::uuid[])`;
    const list = rows.map(toReservation);
    if (list.length === 0) continue;
    const [[cls], stus] = await Promise.all([
      sql`select subject, class_name from public.classes where tenant_id=${t} and id=${g.classId}`,
      sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${[...new Set(list.map(r => r.studentId))]}::uuid[])`,
    ]);
    const subject = cls?.subject ?? null, className = cls?.class_name ?? null, nameOf = new Map(stus.map(s => [s.id, s.name]));
    const labelOf = r => { const name = nameOf.get(r.studentId); return name && className ? `${name} · ${className}` : null; };
    // 2.0처럼 예약 하나가 실패해도 나머지는 잇는다 — 예약마다 savepoint(실패한 예약의 쓰기만 되돌린다).
    for (const r of list) {
      try {
        await sql.savepoint(async sp => {
          const one = { ...ctx, sql: sp };
          const live = await loadDay(sp, t, R, r.studentId, r.classId, r.makeupDate);
          const cell = M.resv.pickFulfillingRow(live.map(x => ({ ...x, slotStart: x.slot_start, recordedAt: x.recorded_at })), r);
          if (cell && r.status === 'reserved') {
            const units = await fulfil(one, r, cell, g.cells.get(r.studentId), subject, labelOf(r));
            if (units !== undefined) changed.set(completionKey({ studentId: r.studentId, classId: r.classId, date: r.makeupDate }), units);
          } else if (!cell && r.status === 'done') await revert(one, r, live, labelOf(r));
        });
      } catch (e) {
        changed.delete(completionKey({ studentId: r.studentId, classId: r.classId, date: r.makeupDate }));
        console.error('[v2-attendance] 보강 예약 이행·되돌림 실패(이 예약만)', r.id, e?.message ?? e);
      }
    }
  }
}

/** 2.0 `fulfil` — 예약 done + 보강 칸 메모·시수 + 결석 칸 "예정 → 완료" + 감사로그. */
async function fulfil(ctx, r, cell, src, subject, label) {
  const { sql, t, R, M, settings, actor } = ctx;
  const updated = await sql`update public.makeup_reservations set status='done', attendance_record_id=${cell.id}, done_at=now() where tenant_id=${t} and id=${r.id} and status='reserved' returning id`;
  if (updated.length === 0) return undefined;
  const makeupLine = M.resv.reservationMakeupMemo(r), patch = {};
  if (!M.link.hasMemoLine(cell.note, makeupLine)) patch.note = M.link.appendMemo(cell.note, makeupLine);
  let autoUnits = null, unitsChanged;
  const explicit = src?.unitsExplicit === true, untouched = src?.created === true || cell.session_units == null;
  const resUnits = R.lesson.lessonProfileOf({ preset: settings.preset }).autoUnits ? M.resv.reservationAutoUnits(r, subject) : null;
  if (!explicit && src?.addToCurrent === true && resUnits !== null && cell.slot_start == null) {
    const next = R.units.round1(M.link.unitsAfterMakeup(cell.session_units == null ? null : Number(cell.session_units), resUnits));
    if (next <= R.units.MAX_SESSION_UNITS) { autoUnits = next; patch.session_units = next === 1 ? null : next; }
  } else if (!explicit && untouched && resUnits !== null && cell.slot_start == null) {
    let base = 0;
    if (await isRegularAttendee(sql, t, R, r)) { const minutes = await classDayMinutes(sql, t, R, M, r.classId, r.makeupDate); base = minutes > 0 ? (R.auto.unitsFromMinutes(minutes) ?? 1) : 0; }
    autoUnits = R.units.round1(base + resUnits);
    patch.session_units = autoUnits === 1 ? null : autoUnits;
  }
  if (Object.keys(patch).length > 0) {
    await sql`update public.attendance_records set ${sql(patch)} where tenant_id=${t} and id=${cell.id}`;
    if ('session_units' in patch) unitsChanged = patch.session_units;
  }
  const plannedLine = M.resv.reservationAbsenceMemo(r);
  for (const a of await loadDay(sql, t, R, r.studentId, M.resv.absenceClassOf(r), r.absenceDate)) {
    if (!M.link.hasMemoLine(a.note, plannedLine)) continue;
    await sql`update public.attendance_records set note=${M.resv.markAbsenceMemoDone(a.note, r.makeupDate)} where tenant_id=${t} and id=${a.id}`;
  }
  await audit(sql, t, actor, 'makeup_reserve_done', label, { reservationId: r.id, studentId: r.studentId, classId: r.classId, absenceDate: r.absenceDate, makeupDate: r.makeupDate,
    slotStart: r.slotStart, slotEnd: r.slotEnd, attendanceRecordId: cell.id, status: cell.status, ...(autoUnits !== null ? { autoUnits } : {}) });
  return unitsChanged;
}

/** 2.0 `revert` — 보강일에 시수 상태 행이 더 없다: 예약 reserved + 연결 해제 · 보강 확인(0458a) 지움 · 메모 되돌림 · 감사로그. 시수는 손대지 않는다. */
async function revert(ctx, r, liveMakeupDay, label) {
  const { sql, t, R, M, actor } = ctx;
  const reverted = await sql`update public.makeup_reservations set status='reserved', attendance_record_id=null, done_at=null where tenant_id=${t} and id=${r.id} and status='done' returning id`;
  if (reverted.length === 0) return;
  if (await hasColumn(sql, 'makeup_reservations', 'checked_at')) await sql`update public.makeup_reservations set checked_at=null, checked_by=null where tenant_id=${t} and id=${r.id}`;
  const makeupLine = M.resv.reservationMakeupMemo(r);
  for (const x of liveMakeupDay) {
    if (!M.link.hasMemoLine(x.note, makeupLine)) continue;
    await sql`update public.attendance_records set note=${M.resv.removeMemoLine(x.note, makeupLine)} where tenant_id=${t} and id=${x.id}`;
  }
  const doneLine = M.resv.reservationAbsenceDoneMemo(r);
  for (const a of await loadDay(sql, t, R, r.studentId, M.resv.absenceClassOf(r), r.absenceDate)) {
    if (!M.link.hasMemoLine(a.note, doneLine)) continue;
    await sql`update public.attendance_records set note=${M.resv.markAbsenceMemoPlanned(a.note, r.makeupDate)} where tenant_id=${t} and id=${a.id}`;
  }
  await audit(sql, t, actor, 'makeup_reserve_revert', label, { reservationId: r.id, studentId: r.studentId, classId: r.classId, absenceDate: r.absenceDate, makeupDate: r.makeupDate,
    slotStart: r.slotStart, slotEnd: r.slotEnd });
}
