// 2.0 화면 · 출석부 — 보강 예약 창·취소(2.0 features/attendance/server/makeup-reservation-actions.ts — 같은 이름 · 같은 인자 · 같은 표·칸·감사로그).
//   getMakeupPeriodOptions(classId, date, studentId?, hostClassId?) — 교시 선택지 · 기록할 반 후보 · 정규 수업일(읽기만 — 쓰지 않는다)
//   reserveMakeup(input)  — makeup_reservations 한 행 + 결석일 칸(기록이 없으면 출석부 칸 저장으로 결석 · 결석·공결이면 그 행 메모만) · makeup_reserve
//   cancelMakeupReservation({ id }) — 예약 행 지우기(reserved만) + 결석 칸 '예정' 줄 빼기 · 예약이 만든 맨 결석 칸은 칸째 지우기 · makeup_reserve_cancel
// 게이트(2.0과 같다): 출결 쓰기(전체 ∪ 담당 반만) + 강사는 결석일에 그 반 담당. 교시는 학원 설정 교시표로 서버가 다시 만든 선택지 안에서만(수기 금지).
// 결석 칸 쓰기·지우기는 출석부 칸 저장(setAttendanceCell 자리 — 호출부가 cellIn으로 넘긴다)을 그대로 지난다(교시 축·감사로그·예약 이행 한 벌).
// 반쪽 상태 금지(2.0 ③): 예약 행과 결석 칸 쓰기를 savepoint 하나에 묶는다 — 결석 칸이 실패하면 예약도 남지 않는다(2.0은 지워서 되돌린다).
// 2.0과 다른 점:
//  · 새 보강 체계(보강관리 켜짐·정리 중) 학원의 예약·취소 — 2.0은 연결된 예약을 보강관리로 보내는데(mappedReservationMutationBlock) 그 조회를 옮기지 않아
//    저장하지 않는다(사유를 말하고 바뀌는 것 없음 — 이 복사본은 꺼져 있다).
//  · 화면 갱신(revalidatePath)은 호스트가 저장 뒤 다시 받는 것으로 대신한다 · 2.0의 서버 전용 `pickAbsenceNoteTarget`(server/absence-cell.ts)은 아래 PORTED.
import { V2Error } from './v2-screens.mjs';
import { nativeMakeupsOn, isRegularLessonDay } from './v2-attendance-makeup.mjs';
import { readTaughtClassSet } from './v2-attendance-live.mjs';

export const RESERVE_MODULE = 'features/attendance/server/makeup-reservation-actions.ts';
const MODULES = { periods: 'features/timetable/lib/periods.ts', host: 'features/attendance/makeup-host.ts' };
let rules = null;
export function loadReserveRules(importV2) {
  rules ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch(e => { rules = null; throw e; });
  return rules;
}
const VIA = '3.0 연습 복사본';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;
const NATIVE = '새 보강관리를 쓰는 학원의 보강 예약은 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.';

/** 2.0 서버 전용 `MADE_UP_RE`·`pickAbsenceNoteTarget`(server/absence-cell.ts) — 이미 이 줄이 있는 칸 → 아직 어떤 보강도 안 적힌 칸 → 최신 칸. */
export const PORTED = {
  MADE_UP_RE: /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/,
  pickAbsenceNoteTarget(rows, memo, hasMemoLine) {
    return rows.find(r => hasMemoLine(r.note, memo)) ?? rows.find(r => !PORTED.MADE_UP_RE.test(r.note ?? '')) ?? rows[0] ?? null;
  },
};

// ── 입력(호스트 shim `{ module, actor, args }` — 2.0 인자 그대로) ──
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
function call(raw, arity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== RESERVE_MODULE || !Array.isArray(raw.args) || raw.args.length > arity) throw bad();
  if (typeof raw.actor !== 'string' || !UUID.test(raw.actor)) throw new V2Error(400, 'actor_missing', '저장하는 사람을 먼저 고르세요.');
  return { actor: raw.actor, args: raw.args };
}
const str = (v, max) => { if (v === undefined || v === null) return null; if (typeof v !== 'string' || v.length > max) throw bad(); return v; };
const uuidOrNull = v => { const s = str(v, 64); if (s && !UUID.test(s)) throw bad(); return s || null; };
export function optionsBody(raw) {
  const { actor, args: [classId, date, studentId, hostClassId] } = call(raw, 4);
  return { actor, classId: str(classId, 64) ?? '', date: str(date, 20) ?? '', studentId: uuidOrNull(studentId), hostClassId: uuidOrNull(hostClassId) };
}
export function reserveBody(raw) {
  const { actor, args: [input] } = call(raw, 1);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad();
  if (input.periodIds !== undefined && (!Array.isArray(input.periodIds) || input.periodIds.length > 20 || input.periodIds.some(p => typeof p !== 'string' || p.length > 60))) throw bad();
  return { actor, studentId: uuidOrNull(input.studentId), classId: uuidOrNull(input.classId), absenceDate: str(input.absenceDate, 20) ?? '', makeupDate: str(input.makeupDate, 20) ?? '',
    periodIds: input.periodIds ?? [], note: str(input.note, 2000), scopeTeacherId: uuidOrNull(input.scopeTeacherId), reportMode: str(input.reportMode, 20), hostClassId: uuidOrNull(input.hostClassId) };
}
export function cancelBody(raw) {
  const { actor, args: [input] } = call(raw, 1);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad();
  return { actor, id: str(input.id, 64) ?? '' };
}

// ── 조회 ──
/** 그날 그 칸의 유효 행(정정 이력 접은 뒤 · 최신 먼저) — 2.0 `loadEffectiveDay`. */
async function loadEffectiveDay(sql, t, R, key) {
  const rows = await sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status, note,
      to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
    from public.attendance_records where tenant_id=${t} and class_id=${key.classId} and student_id=${key.studentId} and session_date=${key.date} order by recorded_at desc`;
  return R.effective.effectiveAttendanceRecords(rows).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id.localeCompare(a.id)));
}
/** 2.0 `reservationHostChoices` — 그날 학생이 다니는 반(수강 유효 · 휴원 아님) · 종강 전·활성 · 결석난 반과 같은 과목 · 강사면 그날 담당 반만. 결석난 반 먼저, 이름순. */
async function reservationHostChoices(c, at) {
  const { sql, t, R, P, settings, actor } = c;
  const ens = await sql`select class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred from public.enrollments where tenant_id=${t} and student_id=${at.studentId}`;
  const ids = [...new Set(ens.filter(e => R.elig.isEnrollmentActiveOn({ startDate: e.start_date ?? '0000-01-01', endDate: e.end_date ?? null, onHold: e.on_hold ?? false, isTransferred: e.is_transferred === true }, at.date)).map(e => e.class_id))];
  if (ids.length === 0) return [];
  const classes = await sql`select id::text id, class_name, subject, is_active, closed_at::text closed_at from public.classes where tenant_id=${t} and id = any(${ids}::uuid[])`;
  let list = classes.filter(x => x.is_active !== false && String(x.subject ?? '') === at.subject && P.host.isClassOpenOn(x.closed_at, at.date));
  if (actor.level === 'scoped') { const teaching = await readTaughtClassSet(sql, t, R, settings, actor.id, at.date); list = list.filter(x => teaching.has(x.id)); }
  return list.map(x => ({ classId: x.id, className: String(x.class_name ?? ''), absenceClass: x.id === at.absenceClassId }))
    .sort((a, b) => Number(b.absenceClass) - Number(a.absenceClass) || a.className.localeCompare(b.className, 'ko'));
}
const isWeekend = date => { const [y, m, d] = date.split('-').map(Number); const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay(); return dow === 0 || dow === 6; };
const periodsConfig = c => c.P.periods.settingsToPeriodsConfig(c.settings.operations);
const audit = (sql, t, actor, action, targetLabel, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, 'attendance', ${targetLabel ?? null}, ${sql.json({ ...metadata, via: VIA })})`;
/**
 * 출석부 칸 저장을 2.0 `setAttendanceCell` 반환 모양으로 — 거절(V2Error)은 `{ error }`, 그 밖의 오류는 그대로 던진다.
 * 칸 저장 하나를 savepoint에 넣어, 거절이 나면 그 저장이 쓴 것도 남지 않는다(2.0 액션은 거절하면 쓰지 않는다).
 */
async function cellResult(c, sql, body) {
  try { return await sql.savepoint(sp => c.cellIn(sp, { actor: c.actor.id, noteOnly: false, slotStart: null, periodStart: null, source: undefined, scopeTeacherId: null, ...body })); }
  catch (e) { if (e instanceof V2Error) return { error: e.message }; throw e; }
}

/**
 * 2.0 `getMakeupPeriodOptions` — 확인창이 날짜·반을 고를 때마다 부른다(선택지의 단일 소스는 서버). 쓰지 않는다.
 * c = { sql, t, R, M, P, settings, today, actor, cellIn }.
 */
export async function getMakeupPeriodOptions(c, b) {
  const { sql, t, R, M } = c;
  if (!b.classId || !YMD.test(b.date)) return { error: '날짜를 고르세요' };
  const [cls] = UUID.test(b.classId) ? await sql`select id::text id, subject from public.classes where tenant_id=${t} and id=${b.classId}` : [];
  if (!cls) return { error: '반을 찾지 못했습니다' };
  const subject = String(cls.subject ?? '');
  const options = M.resv.reservationPeriodOptions(subject, b.date, periodsConfig(c));
  const subjectLabel = R.subjects.buildSubjectMaps(c.settings.operations.subjects).labelOf(subject);
  let hostChoices, host = b.classId;
  if (b.studentId) {
    hostChoices = await reservationHostChoices(c, { studentId: b.studentId, absenceClassId: b.classId, subject, date: b.date });
    host = M.resv.pickReservationHost(hostChoices, b.hostClassId ?? null);
  }
  const autoUnitsOn = R.lesson.lessonProfileOf({ preset: c.settings.preset }).autoUnits;
  const regularDay = b.studentId && host ? await isRegularLessonDay(sql, t, R, M, { studentId: b.studentId, classId: host, date: b.date }) : undefined;
  return { ok: true, options, subjectLabel, weekend: options.length > 0 && isWeekend(b.date), autoUnits: R.auto.isAutoUnitsSubject(subject) && autoUnitsOn,
    ...(regularDay !== undefined ? { regularDay } : {}), ...(hostChoices ? { hostChoices, hostClassId: host } : {}) };
}

/** 2.0 `reserveMakeup` — 예약 행 + 결석일 칸(결석 0 · 메모 '보강 예정') + makeup_reserve. 반환 = { ok, id, absence: 'created'|'noted', span } | { error }. */
export async function reserveMakeup(c, b) {
  const { sql, t, R, M, actor } = c;
  const { studentId, classId, absenceDate, makeupDate } = b;
  if (!studentId || !classId) return { error: '필수 값이 누락되었습니다' };
  const dates = M.resv.validateReservationDates({ absenceDate, makeupDate, today: c.today });
  if (!dates.ok) return { error: dates.error };
  if (nativeMakeupsOn(M, c.settings)) return { error: NATIVE };
  const note = (b.note ?? '').trim().slice(0, 300) || null;
  if (actor.level === 'scoped' && !(await readTaughtClassSet(sql, t, R, c.settings, actor.id, absenceDate)).has(classId)) return { error: '담당 반이 아닙니다' };
  const [[cls], [stu]] = await Promise.all([
    sql`select id::text id, class_name, subject from public.classes where tenant_id=${t} and id=${classId}`,
    sql`select id::text id, name from public.students where tenant_id=${t} and id=${studentId}`,
  ]);
  if (!cls) return { error: '반을 찾지 못했습니다' };
  if (!stu) return { error: '학생을 찾지 못했습니다' };
  // 교시는 서버가 설정 교시표로 다시 만든 선택지 안에서만(#77) — 이어진 교시 여러 개.
  const options = M.resv.reservationPeriodOptions(String(cls.subject ?? ''), makeupDate, periodsConfig(c));
  const range = M.resv.contiguousPeriodRange(options, b.periodIds ?? [], makeupDate);
  if (!range) return { error: (b.periodIds ?? []).length > 1 ? '이어진 교시만 한 예약으로 잡을 수 있습니다 — 중간이 빈 선택은 나눠서 예약하세요' : '교시를 고르세요 — 학원설정 교시표에 있는 시간만 예약할 수 있습니다' };
  // 기록할 반 — 창이 고른 반을 후보로 다시 확인한다(화면 목록을 믿지 않는다). 안 넘겼으면 결석난 반.
  let hostId = classId, hostName = String(cls.class_name ?? '');
  if (b.hostClassId) {
    const hostRow = (await reservationHostChoices(c, { studentId, absenceClassId: classId, subject: String(cls.subject ?? ''), date: makeupDate })).find(h => h.classId === b.hostClassId);
    if (!hostRow) return { error: '기록할 반을 다시 골라 주세요 — 보강일에 이 학생이 다니는 같은 과목 반만 고를 수 있습니다' };
    hostId = hostRow.classId; hostName = hostRow.className;
  }
  // 보고서 발송 방식 — 정규 수업일이면 반드시 고른다.
  const regularDay = await isRegularLessonDay(sql, t, R, M, { studentId, classId: hostId, date: makeupDate });
  const reportMode = regularDay === false ? null : M.resv.isMakeupReportMode(b.reportMode) ? b.reportMode : null;
  if (regularDay === true && !reportMode) return { error: '그날은 이 학생의 정규 수업일입니다 — 보고서를 정규와 합칠지(합침) 따로 보낼지(분리) 고르세요' };
  // 결석일 칸의 지금 사실 — 온 날(출석·지각·조퇴·보강)이면 예약이 거짓이 된다.
  const day = await loadEffectiveDay(sql, t, R, { studentId, classId, date: absenceDate });
  const attended = day.find(r => M.resv.completesReservation(r.status));
  if (attended) return { error: `${absenceDate}은(는) 이미 '${R.cell.statusTextOf(attended.status)}'으로 기록된 날입니다 — 결석으로 고친 뒤 예약하세요` };
  const absentCells = day.filter(r => r.status === 'absent' || r.status === 'excused');
  const memo = M.resv.reservationAbsenceMemo({ makeupDate, absenceDate });

  class CellFailed extends Error {}
  let saved;
  try {
    saved = await sql.savepoint(async sp => {
      // ① 예약 행 — 기록할 반 = class_id, 결석난 반은 다를 때만(0440a). 같은 (학생·반·보강일·교시)는 유니크가 막는다.
      const [ins] = await sp`insert into public.makeup_reservations ${sp({ tenant_id: t, student_id: studentId, class_id: hostId, ...(hostId !== classId ? { absence_class_id: classId } : {}),
        absence_date: absenceDate, makeup_date: makeupDate, slot_start: range.startTime, slot_end: range.endTime, period_label: range.label, note, status: 'reserved', created_by: actor.id,
        ...(reportMode ? { report_mode: reportMode } : {}) })} returning id::text id`;
      // ② 결석일 칸 — 기록이 없으면 출석부 칸 저장 그대로(결석 · 시수 기본 · 메모), 이미 결석·공결이면 붙일 칸 하나의 메모만(멱등).
      let absence, cellRes;
      if (absentCells.length === 0) {
        absence = 'created';
        cellRes = await cellResult(c, sp, { studentId, classId, sessionDate: absenceDate, status: 'absent', units: '', note: memo, scopeTeacherId: b.scopeTeacherId ?? null });
      } else {
        absence = 'noted';
        const target = PORTED.pickAbsenceNoteTarget(absentCells, memo, M.link.hasMemoLine);
        if (!M.link.hasMemoLine(target.note, memo)) await sp`update public.attendance_records set note=${M.link.appendMemo(target.note, memo)} where tenant_id=${t} and id=${target.id}`;
        cellRes = { ok: true };
      }
      if ('error' in cellRes) throw new CellFailed(cellRes.error);
      return { id: ins.id, absence };
    });
  } catch (e) {
    // ③ 반쪽 상태를 남기지 않는다 — savepoint가 예약 행까지 되돌렸다.
    if (e instanceof CellFailed) return { error: `결석일(${absenceDate}) 칸을 처리하지 못해 예약을 취소했습니다 — ${e.message}` };
    if (e?.code === '23505' && e?.constraint_name === 'makeup_reservations_uniq') return { error: '같은 날 같은 교시에 이미 이 학생의 보강 예약이 있습니다' };
    throw e;
  }
  const span = `${makeupDate} ${range.label ? `${range.label} · ` : ''}${range.startTime}~${range.endTime}${hostId !== classId ? ` · ${hostName}` : ''}`;
  await audit(sql, t, actor, 'makeup_reserve', `${stu.name} · ${hostName}`, { reservationId: saved.id, studentId, classId: hostId, ...(hostId !== classId ? { absenceClassId: classId } : {}),
    absenceDate, makeupDate, slotStart: range.startTime, slotEnd: range.endTime, periodLabel: range.label, periodCount: range.count, absence: saved.absence,
    ...(reportMode ? { reportMode } : {}), ...(note ? { hasNote: true } : {}) });
  return { ok: true, id: saved.id, absence: saved.absence, span };
}

/** 2.0 `absenceCreatedByAnyReservation` — 그 결석 칸을 예약이 새로 찍었나(감사로그 makeup_reserve 중 같은 학생·결석난 반·결석일에 absence 'created'). */
async function absenceCreatedByAnyReservation(sql, t, key) {
  const rows = await sql`select metadata from public.audit_logs where tenant_id=${t} and action='makeup_reserve' and metadata->>'studentId'=${key.studentId}
    and metadata->>'absenceDate'=${key.absenceDate} and metadata->>'absence'='created' limit 50`;
  return rows.some(r => (r.metadata?.absenceClassId ?? r.metadata?.classId) === key.classId);
}

/** 2.0 `cancelMakeupReservation` — 예약 행 지우기(reserved만, 지운 행 수로 확인) + 결석 칸 되돌리기 + makeup_reserve_cancel. */
export async function cancelMakeupReservation(c, b) {
  const { sql, t, R, M, actor } = c;
  if (!b.id) return { error: '예약을 찾지 못했습니다' };
  const [row] = UUID.test(b.id) ? await sql`select id::text id, student_id::text student_id, class_id::text class_id, absence_date::text absence_date, makeup_date::text makeup_date,
      slot_start::text slot_start, slot_end::text slot_end, period_label, note, status, created_by::text created_by, absence_class_id::text absence_class_id
    from public.makeup_reservations where tenant_id=${t} and id=${b.id}` : [];
  if (!row) return { error: '예약을 찾지 못했습니다(이미 취소됐을 수 있습니다)' };
  const r = { id: row.id, studentId: row.student_id, classId: row.class_id, absenceDate: row.absence_date, makeupDate: row.makeup_date, slotStart: String(row.slot_start ?? '').slice(0, 5),
    status: row.status === 'done' ? 'done' : 'reserved', absenceClassId: row.absence_class_id ?? null };
  if (r.status === 'done') return { error: '이미 이행된 예약은 취소할 수 없습니다 — 보강일 출결을 고치세요' };
  if (nativeMakeupsOn(M, c.settings)) return { error: NATIVE };
  const absenceClassId = M.resv.absenceClassOf(r);
  if (actor.level === 'scoped') {
    const teaching = await readTaughtClassSet(sql, t, R, c.settings, actor.id, r.absenceDate);
    // 결석난 반 담당 — 다른 반에 기록한 예약이면 보강일에 기록할 반을 맡은 선생님도.
    const hostTeaching = absenceClassId !== r.classId ? await readTaughtClassSet(sql, t, R, c.settings, actor.id, r.makeupDate) : null;
    if (!teaching.has(absenceClassId) && !hostTeaching?.has(r.classId)) return { error: '담당 반이 아닙니다' };
  }
  // 지운 행 수를 본다 — 읽은 뒤 보강일 출결이 찍혀 done이 됐으면 0행(메모·결석 칸은 건드리지 않는다).
  const deleted = await sql`delete from public.makeup_reservations where tenant_id=${t} and id=${r.id} and status='reserved' returning id`;
  if (deleted.length === 0) return { error: '그 사이 이행된 예약이라 취소할 수 없습니다 — 보강일 출결을 고치세요' };

  // 결석 칸의 '예정' 줄 — 메모만(상태·시수 불변) · 같은 보강일의 다른 예약이 남았으면 그대로 · 예약이 만든 맨 칸이면 칸째 지운다. 실패해도 취소는 됐다(알리기만).
  let memoCleared = true, memoKept = false, absenceCleared = false;
  try {
    await sql.savepoint(async sp => {
      const memo = M.resv.reservationAbsenceMemo(r);
      const remainingRows = (await sp`select makeup_date::text makeup_date, class_id::text class_id, absence_class_id::text absence_class_id from public.makeup_reservations
        where tenant_id=${t} and student_id=${r.studentId} and absence_date=${r.absenceDate}`).filter(x => (x.absence_class_id ?? x.class_id) === absenceClassId);
      if (remainingRows.some(x => x.makeup_date.slice(0, 10) === r.makeupDate)) { memoKept = true; return; }
      const day = await loadEffectiveDay(sp, t, R, { studentId: r.studentId, classId: absenceClassId, date: r.absenceDate });
      const targets = day.filter(x => M.link.hasMemoLine(x.note, memo));
      const bare = targets.length > 0 && day.every(x => (x.status === 'absent' || x.status === 'excused') && M.link.hasMemoLine(x.note, memo) && M.resv.removeMemoLine(x.note, memo) === null);
      const erase = bare && remainingRows.length === 0 && (await absenceCreatedByAnyReservation(sp, t, { studentId: r.studentId, classId: absenceClassId, absenceDate: r.absenceDate }));
      if (erase) {
        // 출석부 칸 지우기 그대로 — 거절되면(잠긴 날 등) 2.0처럼 줄만 뺀다.
        const erased = await cellResult(c, sp, { studentId: r.studentId, classId: absenceClassId, sessionDate: r.absenceDate, status: null });
        if (!('error' in erased)) { absenceCleared = true; return; }
      }
      for (const x of targets) await sp`update public.attendance_records set note=${M.resv.removeMemoLine(x.note, memo)} where tenant_id=${t} and id=${x.id}`;
    });
  } catch (e) {
    memoCleared = false;
    console.error('[v2-attendance] 보강 예약 취소 — 결석 칸 메모를 되돌리지 못했다(취소는 됐다)', e?.message ?? e);
  }
  const [[stuRow], [clsRow]] = await Promise.all([
    sql`select name from public.students where tenant_id=${t} and id=${r.studentId}`, sql`select class_name from public.classes where tenant_id=${t} and id=${r.classId}`,
  ]);
  await audit(sql, t, actor, 'makeup_reserve_cancel', stuRow?.name && clsRow?.class_name ? `${stuRow.name} · ${clsRow.class_name}` : null, { reservationId: r.id, studentId: r.studentId,
    classId: r.classId, absenceDate: r.absenceDate, makeupDate: r.makeupDate, slotStart: r.slotStart, memoCleared, ...(memoKept ? { memoKept: true } : {}), ...(absenceCleared ? { absenceCleared: true } : {}) });
  return { ok: true };
}
