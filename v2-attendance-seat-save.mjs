// 2.0 화면 · 출석부 — 자리(랩실·JJ실) 출석부 저장. v2-screen-attendance.mjs의 actions가 부른다(이름 = 2.0 export 이름).
// 2.0 features/attendance/seat/server/의 "use server" 함수를 같은 입력·같은 표·칸·감사로그로 Docker 복사본에:
//   actions.ts      setSeatCell(seat_attendance_set / _clear / _note) · fillSeatSlot(seat_attendance_fill) · fillSeatPrevAbsent(seat_attendance_fill_prev)
//   mark-actions.ts setSeatJjField(class_sheet_student_marks — 감사로그 없음, 2.0과 같다) · commitSeatJjEdits(seat_jj_mark_edit)
//   monthly-prefs.ts saveSeatMonthlyCollapsed(users.ui_prefs.seatMonthly — 감사로그 없음)
//   period-actions.ts moveSeatStudentPeriod(seat_period_moves · pin이면 seat_period_pins — seat_period_move / seat_period_pin) ·
//                     clearSeatPeriodChoices(그날 이동 + 그 요일 고정 함께 — seat_period_clear)
//   placement-actions.ts resetSeatPlacements(seat_placements — seat_placement_reset) — 이동 계열 셋은 출결을 쓰지 않는다(2.0과 같다).
//   memorized-actions.ts pullSeatMemorizedWords — 바깥(인재원 API)을 부르는 일이라 2.0 실패 모양으로 거절(바뀌는 것 없음).
// 판정·접기는 2.0 순수 함수 그대로(seat.ts · period-choice.ts · prev-period.ts · placement.ts · save-targets.ts · edit-audit.ts · plan-codec.ts · jj-fields.ts).
// 보강 예약 이행 — 2.0처럼 쓰고 나서 `completeMakeupReservations`(v2-attendance-makeup.mjs)를 같은 자리에서 부른다(JJ 갱신 · 새 행 · 일괄).
// 2.0과 다른 점(바뀌는 것 없이 그 사유를 2.0 실패 모양 { error }로 돌려준다):
//  · 새 보강 체계(makeups.mode on·draining)가 켜진 학원의 보강 예약 칸 — 그 연결 이행 갈래를 옮기지 않아 쓰지 않는다(이 복사본은 꺼져 있다).
//  · PIN(비로그인) 갈래 — 앱 밖 결과물(자리 PIN 화면)이라 이 화면 범위가 아니다. 저장하는 사람은 3.0 띠에서 고른 로그인 직원뿐.
// 감사로그 metadata.via = '3.0 연습 복사본'(공통 규약) — 2.0이 같은 칸에 적는 갈래('menu'·'duty')는 metadata.from으로 옮긴다.
import { V2Error } from './v2-screens.mjs';
import { copyClock, readSeatDay, readSeatPeriodChoices, applySeatDayChoices, readSeatPlacementsForDay, readSeatStudentClasses, seatWritersOf } from './v2-attendance-seat.mjs';
import { completeMakeupReservations, nativeMakeupsOn } from './v2-attendance-makeup.mjs';

const VIA = '3.0 연습 복사본';
const SAVE_MODULES = { editAudit: 'features/class-sheets/lib/edit-audit.ts', planCodec: 'features/class-sheets/lib/plan-codec.ts' };
let saveRules = null;
export function loadSeatSaveRules(importV2) {
  saveRules ??= Promise.all(Object.entries(SAVE_MODULES).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries).catch(e => { saveRules = null; throw e; });
  return saveRules;
}
const hasColumn = async (sql, table, column) => (await sql`select exists (select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) ok`)[0].ok;
const hasTable = async (sql, name) => (await sql`select to_regclass(${`public.${name}`}) is not null ok`)[0].ok;
const audit = (sql, t, actor, action, targetType, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.name}, ${action}, ${targetType}, null, ${sql.json(metadata)})`;

/** 2.0 `gateSeatWrite`(server/gate.ts)의 로그인 갈래 — 자리 메뉴 쓰기 ∪ 그 자리 당번 · 지난 날짜는 출결 쓰기 권한. 실패는 2.0처럼 { error }. */
async function gate(c, seat, date) {
  if (!c.S.seat.USABLE_SEAT_KEYS.includes(seat)) return { error: '이 자리 출석부는 아직 열리지 않았습니다' };
  const writer = (await seatWritersOf(c.sql, c.t, c.R, c.S, c.settings, seat)).find(w => w.id === c.actorId);
  if (!writer) return { error: '자리 출석부 입력 권한이 없습니다' };
  const { day: today } = await copyClock();
  if (date !== today && !writer.pastWrite) return { error: '지난 날짜는 수정할 수 없습니다 — 관리자에게 요청하세요' };
  const actor = { id: writer.id, name: writer.name };
  // 2.0 `completeMakeupReservations` 자리 — 이 저장의 사람으로 예약 이행·되돌림 감사로그를 남긴다.
  c.complete = cells => completeMakeupReservations({ ...c, actor }, cells);
  return { ok: true, actor, from: writer.duty && !writer.menuWrite ? 'duty' : 'menu', today };
}

/** 2.0 `rosterKeys`(server/gate.ts) — 그 교시 명단(교시 선택을 얹은 뒤, 모호한 반 제외). */
async function rosterKeys(c, seat, date, slotStart) {
  const [day, choiceLoad] = await Promise.all([readSeatDay(c.sql, c.t, c.R, c.S, seat, date), readSeatPeriodChoices(c.sql, c.t, c.R, c.S, seat, date)]);
  const period = day.periods.find(p => p.start === c.S.seat.hhmm(slotStart));
  if (!period) return null;
  const rosterByPeriod = applySeatDayChoices(c.S, day, choiceLoad, date);
  const blocked = new Set(c.S.seat.ambiguousClassIds(period));
  const keys = new Set(), classes = new Map(), rosters = [];
  for (const roster of rosterByPeriod[period.start] ?? []) {
    if (blocked.has(roster.classId)) continue;
    classes.set(roster.classId, roster.students.filter(s => s.status === null).map(s => s.id));
    rosters.push({ classId: roster.classId, students: roster.students.map(s => ({ id: s.id })) });
    for (const s of roster.students) keys.add(`${roster.classId}|${s.id}`);
  }
  return { keys, classes, rosters, day, choiceLoad, period };
}

const RESERVED_CELL = '보강 예약이 걸린 칸은 연습 화면에서는 아직 지원하지 않는 저장입니다. 바뀐 것은 없습니다.';
/** 보강 예약(reserved·done)이 걸린 (학생, 반) — 그 날 보강일인 예약. 2.0 `completeMakeupReservations`가 이 행들을 본다. */
async function reservedCells(c, date, pairs) {
  if (pairs.length === 0 || !(await hasTable(c.sql, 'makeup_reservations'))) return new Set();
  const rows = await c.sql`select student_id::text s, class_id::text c from public.makeup_reservations where tenant_id=${c.t} and makeup_date=${date} and status = any(${['reserved', 'done']})
    and class_id = any(${[...new Set(pairs.map(p => p.classId))]}::uuid[]) and student_id = any(${[...new Set(pairs.map(p => p.studentId))]}::uuid[])`;
  return new Set(rows.map(r => `${r.c}|${r.s}`));
}

const notePatch = note => (note === undefined ? {} : { note: note === '' ? null : note });
/** 2.0 `seatUpdate` — recorded_via 칸이 없으면 빼고 쓴다(2.0은 오류 문구로 알고 다시 쓴다 — 여기는 칸을 먼저 본다). */
async function seatUpdate(c, patch, ids) {
  const p = { ...patch };
  if (!c.viaColumn) delete p.recorded_via;
  if (Object.keys(p).length === 0 || ids.length === 0) return null;
  await c.sql`update public.attendance_records set ${c.sql(p)} where tenant_id=${c.t} and id = any(${ids}::uuid[])`;
  return null;
}
const insertRows = async (c, rows) => { await c.sql`insert into public.attendance_records ${c.sql(rows.map(r => { const x = { ...r }; if (!c.viaColumn) delete x.recorded_via; return x; }))}`; };

/** 2.0 `writeOne`(server/actions.ts) — 한 칸. 숫자 = 바뀐 행 수, 글자 = 2.0 거절 문구. */
async function writeOne(c, p) {
  const { S, R, sql, t } = c, payroll = S.seat.isPayrollSeat(p.seat);
  if (p.noteOnly && p.note === undefined) return 0;
  if (p.status === null && !p.noteOnly) {
    const deleted = await sql`delete from public.attendance_records where tenant_id=${t} and class_id=${p.classId} and student_id=${p.studentId} and session_date=${p.date} and slot_start=${p.slot} returning id`;
    if (deleted.length === 0 && !payroll) {
      const dayRows = await sql`select id from public.attendance_records where tenant_id=${t} and class_id=${p.classId} and student_id=${p.studentId} and session_date=${p.date} and slot_start is null limit 1`;
      if (dayRows.length > 0) return '담임이 출석부/원스크린에서 찍은 기록입니다 — 미체크로 되돌리려면 그쪽에서 지워주세요';
    }
    return deleted.length;
  }
  const nowIso = new Date().toISOString();
  if (payroll) {
    const rows = await sql`select id::text id from public.attendance_records where tenant_id=${t} and class_id=${p.classId} and student_id=${p.studentId} and session_date=${p.date} and slot_start=${p.slot} order by recorded_at desc, id desc limit 1`;
    if (rows[0]) {
      await seatUpdate(c, p.noteOnly ? notePatch(p.note) : { status: p.status, seat_label: S.seat.SEAT_DB_LABEL[p.seat], recorded_by: p.userId, recorded_at: nowIso, recorded_via: 'seat', ...notePatch(p.note) }, [rows[0].id]);
      return 1;
    }
  } else {
    const rows = await sql`select id::text id, slot_start::text slot_start, status::text status from public.attendance_records where tenant_id=${t} and class_id=${p.classId} and student_id=${p.studentId} and session_date=${p.date} order by recorded_at desc, id desc`;
    const { updateIds, promoteIds } = R.saveTargets.pickSaveTargets(rows, p.slot);
    const targetSet = new Set([...updateIds, ...promoteIds]);
    if (rows.some(r => targetSet.has(r.id) && !['present', 'absent', 'late'].includes(r.status))) return '출석부에 조퇴·공결·보강으로 기록된 학생입니다 — 변경은 출석부에서 해주세요';
    if (updateIds.length > 0 || promoteIds.length > 0) {
      const basePatch = p.noteOnly ? notePatch(p.note) : { status: p.status, recorded_by: p.userId, recorded_at: nowIso, recorded_via: 'seat', ...notePatch(p.note) };
      if (p.noteOnly) {
        if (updateIds.length === 0) return '담임이 출석부/원스크린에서 그날 전체로 찍은 기록입니다 — 사유는 그쪽에서 고쳐 주세요';
        await seatUpdate(c, basePatch, updateIds);
        return updateIds.length;
      }
      if (promoteIds.length > 0) await seatUpdate(c, { ...basePatch, slot_start: p.slot }, promoteIds);
      if (updateIds.length > 0) await seatUpdate(c, basePatch, updateIds);
      await c.complete([{ studentId: p.studentId, classId: p.classId, date: p.date, status: p.status }]);
      return updateIds.length + promoteIds.length;
    }
  }
  if (p.noteOnly) return 0;
  await insertRows(c, [{ tenant_id: t, class_id: p.classId, student_id: p.studentId, session_date: p.date, slot_start: p.slot, status: p.status,
    seat_label: payroll ? S.seat.SEAT_DB_LABEL[p.seat] : null, recorded_by: p.userId, recorded_via: 'seat', ...notePatch(p.note) }]);
  await c.complete([{ studentId: p.studentId, classId: p.classId, date: p.date, status: p.status, created: true }]);
  return 1;
}

/** 2.0 `setSeatCell(input)`. */
export async function setSeatCell(c, input) {
  const g = await gate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S } = c, slot = S.seat.hhmm(input.slotStart);
  if (input.noteOnly !== true && input.status !== null && !['present', 'absent', 'late'].includes(input.status)) return { error: '잘못된 상태입니다' };
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') return { error: '잘못된 특이사항입니다' };
  const note = typeof input.note === 'string' ? input.note.trim() : input.note;
  if (typeof note === 'string' && note.length > S.seat.SEAT_NOTE_MAXLEN) return { error: `특이사항은 ${S.seat.SEAT_NOTE_MAXLEN}자 이내로 적어 주세요` };
  const roster = await rosterKeys(c, input.seat, input.date, slot);
  if (!roster) return { error: '그 시각에는 이 자리 수업이 없습니다' };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) return { error: '이 교시 명단에 없는 학생입니다' };
  const noteOnly = input.noteOnly === true;
  // 새 보강 체계가 켜진 학원의 보강 예약 칸 — 그 갈래가 없어 쓰지 않는다(꺼진 학원은 쓰고 나서 예약 이행을 본다 — writeOne).
  if (!noteOnly && input.status !== null && nativeMakeupsOn(c.M, c.settings) && (await reservedCells(c, input.date, [{ classId: input.classId, studentId: input.studentId }])).size > 0) return { error: RESERVED_CELL };
  c.viaColumn = await hasColumn(c.sql, 'attendance_records', 'recorded_via');
  const changed = await writeOne(c, { seat: input.seat, date: input.date, slot, classId: input.classId, studentId: input.studentId, status: input.status, note, noteOnly, userId: g.actor.id });
  if (typeof changed === 'string') return { error: changed };
  if (changed > 0 && !(noteOnly && note === undefined)) {
    await audit(c.sql, c.t, g.actor, noteOnly ? 'seat_attendance_note' : input.status === null ? 'seat_attendance_clear' : 'seat_attendance_set', 'attendance', {
      studentId: input.studentId, classId: input.classId, date: input.date, slotStart: slot, seat: input.seat, via: VIA, from: g.from,
      ...(noteOnly ? { cleared: note === null || note === '' } : input.status !== null ? { status: input.status, rows: changed } : { rows: changed }),
    });
  }
  return { ok: true, changed };
}

/** 2.0 `insertSeatFill` — 이미 있는 칸(같은 교시 · 비급여 자리는 그날 전체 행도)은 건너뛴다. */
async function insertSeatFill(c, p) {
  const { S, sql, t } = c, payroll = S.seat.isPayrollSeat(p.seat);
  const built = [...p.byClass.entries()].flatMap(([classId, studentIds]) => studentIds.map(studentId => ({ tenant_id: t, class_id: classId, student_id: studentId, session_date: p.date, slot_start: p.slot,
    status: p.status, seat_label: payroll ? S.seat.SEAT_DB_LABEL[p.seat] : null, recorded_by: p.userId, recorded_via: 'seat' })));
  if (built.length === 0) return { rows: [], skipped: 0 };
  const existing = await sql`select class_id::text class_id, student_id::text student_id, slot_start::text slot_start from public.attendance_records
    where tenant_id=${t} and session_date=${p.date} and class_id = any(${[...new Set(built.map(r => r.class_id))]}::uuid[]) and (slot_start=${p.slot} or slot_start is null)`;
  const taken = new Set(existing.filter(r => S.seat.hhmm(r.slot_start) === p.slot || (!payroll && r.slot_start == null)).map(r => `${r.class_id}|${r.student_id}`));
  const rows = built.filter(r => !taken.has(`${r.class_id}|${r.student_id}`));
  if (rows.length === 0) return { rows: [], skipped: built.length };
  // 새 보강 체계가 켜진 학원에서 보강 예약 학생이 끼면 아무것도 넣지 않는다(그 갈래가 없다). 꺼진 학원은 넣고 나서 예약 이행(2.0과 같다).
  if (nativeMakeupsOn(c.M, c.settings) && (await reservedCells(c, p.date, rows.map(r => ({ classId: r.class_id, studentId: r.student_id })))).size > 0) return { error: RESERVED_CELL };
  await insertRows(c, rows);
  await c.complete(rows.map(r => ({ studentId: r.student_id, classId: r.class_id, date: p.date, status: r.status, created: true })));
  return { rows, skipped: built.length - rows.length };
}

/** 2.0 `fillSeatSlot(input)` — 남은 학생 모두 출석/결석(반 하나만이면 자리 배치로 옮긴 학생은 옮긴 반 기준). */
export async function fillSeatSlot(c, input) {
  if (input.status !== 'present' && input.status !== 'absent') return { error: '잘못된 상태입니다' };
  const g = await gate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S } = c, slot = S.seat.hhmm(input.slotStart);
  const roster = await rosterKeys(c, input.seat, input.date, slot);
  if (!roster) return { error: '그 시각에는 이 자리 수업이 없습니다' };
  if (input.classId && !roster.classes.has(input.classId)) return { error: '이 교시에 없는 반입니다' };
  let targets;
  if (input.classId) {
    const placements = (await readSeatPlacementsForDay(c.sql, c.t, S, input.seat, input.date)).bySlot[slot] ?? [];
    const sectionOf = new Map(S.placement.applySeatPlacements(roster.rosters, placements).applied.map(p => [p.studentId, p.toClassId]));
    const byHome = new Map();
    for (const [homeClassId, studentIds] of roster.classes) for (const id of studentIds) {
      if ((sectionOf.get(id) ?? homeClassId) !== input.classId) continue;
      byHome.set(homeClassId, [...(byHome.get(homeClassId) ?? []), id]);
    }
    targets = [...byHome.entries()];
  } else targets = [...roster.classes.entries()];
  c.viaColumn = await hasColumn(c.sql, 'attendance_records', 'recorded_via');
  const filled = await insertSeatFill(c, { seat: input.seat, date: input.date, slot, status: input.status, userId: g.actor.id, byClass: new Map(targets) });
  if ('error' in filled) return filled;
  const { rows, skipped } = filled;
  if (rows.length === 0) return { ok: true, changed: 0 };
  const wrote = [...new Set(rows.map(r => r.class_id))];
  await audit(c.sql, c.t, g.actor, 'seat_attendance_fill', 'attendance', { ...(wrote.length === 1 ? { classId: wrote[0] } : {}), classIds: wrote, date: input.date, slotStart: slot, seat: input.seat,
    status: input.status, count: rows.length, skipped, studentIds: [...new Set(rows.map(r => r.student_id))], via: VIA, from: g.from });
  return { ok: true, changed: rows.length };
}

/** 2.0 `fillSeatPrevAbsent(input)` — 앞 교시에서 결석한 학생을 이 교시도 결석으로(아직 안 찍힌 칸만). */
export async function fillSeatPrevAbsent(c, input) {
  const g = await gate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S } = c, slot = S.seat.hhmm(input.slotStart);
  const [day, choiceLoad] = await Promise.all([readSeatDay(c.sql, c.t, c.R, S, input.seat, input.date), readSeatPeriodChoices(c.sql, c.t, c.R, S, input.seat, input.date)]);
  const period = day.periods.find(p => p.start === slot);
  if (!period) return { error: '그 시각에는 이 자리 수업이 없습니다' };
  const rosterByPeriod = applySeatDayChoices(S, day, choiceLoad, input.date);
  const targets = S.prev.prevAbsentFillTargets(S.prev.seatDayCells(day.periods, rosterByPeriod), slot, S.seat.ambiguousClassIds(period));
  if (targets.length === 0) return { ok: true, changed: 0 };
  const byClass = new Map();
  for (const x of targets) byClass.set(x.classId, [...(byClass.get(x.classId) ?? []), x.studentId]);
  const prevByCell = new Map(targets.map(x => [`${x.classId}|${x.studentId}`, x.prevStart]));
  c.viaColumn = await hasColumn(c.sql, 'attendance_records', 'recorded_via');
  const filled = await insertSeatFill(c, { seat: input.seat, date: input.date, slot, status: 'absent', userId: g.actor.id, byClass });
  if ('error' in filled) return filled;
  const { rows, skipped } = filled;
  if (rows.length === 0) return { ok: true, changed: 0 };
  const classIds = [...new Set(rows.map(r => r.class_id))];
  const prevStarts = [...new Set(rows.map(r => prevByCell.get(`${r.class_id}|${r.student_id}`)).filter(Boolean))].sort();
  await audit(c.sql, c.t, g.actor, 'seat_attendance_fill_prev', 'attendance', { ...(classIds.length === 1 ? { classId: classIds[0] } : {}), classIds, date: input.date, slotStart: slot, seat: input.seat,
    status: 'absent', prevStarts, count: rows.length, skipped, studentIds: [...new Set(rows.map(r => r.student_id))], via: VIA, from: g.from });
  return { ok: true, changed: rows.length };
}

/** 2.0 `setSeatJjField(input)` — JJ 칸(영어 시트 JJ 폼과 같은 행) 한 칸. 감사로그는 칸을 떠날 때 commitSeatJjEdits가 남긴다(2.0과 같다). */
export async function setSeatJjField(c, input, X) {
  const { S, sql, t } = c;
  if (!S.jj.seatHasJjFields(input.seat)) return { error: '이 자리에는 기록 칸이 없습니다' };
  const field = S.jj.parseJjMarkField(input.field);
  if (!field) return { error: '잘못된 칸입니다' };
  const g = await gate(c, input.seat, input.date);
  if ('error' in g) return g;
  const slot = S.seat.hhmm(input.slotStart);
  const roster = await rosterKeys(c, input.seat, input.date, slot);
  if (!roster) return { error: '그 시각에는 이 자리 수업이 없습니다' };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) return { error: '이 교시 명단에 없는 학생입니다' };
  const value = X.planCodec.normalizePlanText(input.value);
  const maxLen = S.jj.JJ_MARK_MAXLEN[field];
  if ((value?.length ?? 0) > maxLen) return { error: `${S.jj.jjMarkLabel(field)}은(는) ${maxLen}자 이내로 입력하세요` };
  const col = S.jj.JJ_MARK_COLUMN[field];
  if (!(await hasColumn(sql, 'class_sheet_student_marks', col))) return { error: `'${S.jj.jjMarkLabel(field)}' 칸은 아직 준비 중입니다` };
  const [existing] = await sql`select id::text id, status, progress_note, score, listening_level, memorized_words from public.class_sheet_student_marks
    where tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId} and mark_date=${input.date} and slot_start=${slot}`;
  if (!existing && value === null) return { ok: true };
  const now = new Date().toISOString();
  const row = { tenant_id: t, class_id: input.classId, student_id: input.studentId, mark_date: input.date, slot_start: slot, [col]: value, updated_by: g.actor.id, updated_at: now };
  await sql`insert into public.class_sheet_student_marks ${sql(row)} on conflict (tenant_id, class_id, student_id, mark_date, slot_start) do update set ${sql({ [col]: value, updated_by: g.actor.id, updated_at: now })}`;
  const colOf = f => (field === f ? value : (existing?.[S.jj.JJ_MARK_COLUMN[f]] ?? null));
  const next = { status: colOf('attitude'), progress_note: colOf('progressNote'), score: existing?.score ?? null, listening_level: colOf('listeningLevel'), memorized_words: colOf('memorizedWords') };
  if (Object.values(next).every(v => v == null) && existing?.id) await sql`delete from public.class_sheet_student_marks where id=${existing.id} and tenant_id=${t}`;
  return { ok: true };
}

/** 2.0 `commitSeatJjEdits(input)` — 칸을 떠날 때 바뀐 칸마다 한 줄(2.0은 응답 뒤 after()로 — 여기는 같은 거래 안에서 바로). */
export async function commitSeatJjEdits(c, input, X) {
  const { S, sql, t } = c;
  if (!S.jj.seatHasJjFields(input.seat)) return { error: '이 자리에는 기록 칸이 없습니다' };
  const edits = X.editAudit.parseSheetEdits(input.edits, X.editAudit.SEAT_JJ_EDIT_KINDS);
  if (!edits) return { error: '잘못된 요청입니다(편집 기록)' };
  const slot = S.seat.hhmm(input.slotStart);
  const cells = edits.flatMap(e => (e.cell.kind === 'seatJj' ? [{ cell: e.cell, before: e.before }] : []));
  if (cells.some(({ cell }) => cell.date !== input.date || cell.slotStart !== slot)) return { error: '잘못된 요청입니다(날짜·교시)' };
  const g = await gate(c, input.seat, input.date);
  if ('error' in g) return g;
  const column = { status: 'status', listeningLevel: 'listening_level', memorizedWords: 'memorized_words', progressNote: 'progress_note' };
  const roster = await rosterKeys(c, input.seat, input.date, slot);
  if (!roster) return { ok: true };
  for (const { cell, before } of cells) {
    if (!roster.keys.has(`${cell.classId}|${cell.studentId}`)) continue;
    const [row] = await sql`select to_jsonb(m) r from public.class_sheet_student_marks m where tenant_id=${t} and class_id=${cell.classId} and student_id=${cell.studentId} and mark_date=${input.date} and slot_start=${slot}`;
    const r = row?.r ?? null;
    if (r) { const writer = typeof r.updated_by === 'string' ? r.updated_by : null; if (writer !== g.actor.id) continue; }
    const raw = r?.[column[cell.field]];
    const nextValue = typeof raw === 'string' ? raw : null;
    if (!X.editAudit.auditValueChanged(before, nextValue)) continue;
    await audit(sql, t, g.actor, 'seat_jj_mark_edit', 'class_sheet', { classId: cell.classId, studentId: cell.studentId, date: input.date, slotStart: slot, field: cell.field,
      fieldLabel: X.editAudit.markFieldLabel(cell.field), before: X.editAudit.clipAuditValue(before), after: X.editAudit.clipAuditValue(nextValue), via: VIA, from: g.from });
  }
  return { ok: true };
}

/** 2.0 `saveSeatMonthlyCollapsed(collapsed)`(monthly-prefs.ts) — 그 사람의 users.ui_prefs.seatMonthly만(다른 화면 설정은 그대로). */
export async function saveSeatMonthlyCollapsed(c, collapsed) {
  // 2.0은 로그인한 누구나 — 3.0은 띠에서 고른 사람이 자리 저장 가능자(어느 자리든)일 때.
  let allowed = false;
  for (const seat of c.S.seat.USABLE_SEAT_KEYS) if ((await seatWritersOf(c.sql, c.t, c.R, c.S, c.settings, seat)).some(w => w.id === c.actorId)) { allowed = true; break; }
  if (!allowed) return { ok: false, error: '자리 출석부 입력 권한이 없습니다' };
  const [row] = await c.sql`select ui_prefs from public.users where tenant_id=${c.t} and id=${c.actorId}`;
  const raw = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
  const next = c.S.monthlyPrefs.parseSeatMonthlyPrefs({ collapsed });
  await c.sql`update public.users set ui_prefs=${c.sql.json({ ...raw, seatMonthly: { ...c.S.monthlyPrefs.parseSeatMonthlyPrefs(raw.seatMonthly), ...next } })} where tenant_id=${c.t} and id=${c.actorId}`;
  return { ok: true };
}

// ── 자리 이동 계열(랩실) — 출결·시간표·수강을 쓰지 않는다(2.0과 같다). 바뀌는 것 = 그 학생이 그날 어느 교시 명단에 서는가 · 어느 묶음에 놓였나. ──
/** 2.0 `gateSeatMoveWrite`(server/move-gate.ts) — 자리 게이트 + 랩실 한정(PIN 갈래는 3.0에 없다 — 저장하는 사람은 늘 로그인 직원). */
async function moveGate(c, seat, date) {
  const name = c.S.seat.SEAT_NAME[seat];
  if (name && !c.S.seat.MOVABLE_SEATS.includes(seat)) return { error: `${name}은 자리 이동을 쓰지 않습니다` };
  return gate(c, seat, date);
}
const dowOf = (c, date) => c.R.cal.DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** 2.0 `moveSeatStudentPeriod(input)`(period-actions.ts) — 학생 카드 한 장을 그날 이 자리의 다른 교시로(pin이면 그 요일 상시 고정도). */
export async function moveSeatStudentPeriod(c, input) {
  const g = await moveGate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S, R, sql, t } = c, fromSlot = S.seat.hhmm(input.fromSlot), toSlot = S.seat.hhmm(input.toSlot);
  const [day, choiceLoad, classesLoad] = await Promise.all([readSeatDay(sql, t, R, S, input.seat, input.date), readSeatPeriodChoices(sql, t, R, S, input.seat, input.date),
    readSeatStudentClasses(sql, t, R, S, [input.studentId], input.date, input.seat)]);
  if (!choiceLoad.ready) return { error: choiceLoad.reason ?? '자리 교시 선택을 불러오지 못했습니다' };
  if (!classesLoad.ok) return { error: classesLoad.error };
  const rosterByPeriod = applySeatDayChoices(S, day, choiceLoad, input.date);
  const findIn = slot => (rosterByPeriod[slot] ?? []).find(r => r.classId === input.classId)?.students.find(s => s.id === input.studentId);
  const student = findIn(fromSlot);
  // 고정 확인 — 창은 그날 이동이 반영된 뒤에 뜬다(학생은 이미 목표 교시에 서 있다).
  const alreadyThere = !student && input.pin === true && findIn(toSlot) !== undefined;
  if (!student && !alreadyThere) return { error: '이 교시 명단에 없는 학생입니다' };
  const check = S.choice.validateSeatPeriodMove({ fromSlot, toSlot, classSlots: day.slotsByClass[input.classId] ?? [], periodStarts: day.periods.map(p => p.start),
    busyStarts: day.busyStartsByClass[input.classId] ?? [], markedReason: student ? S.placement.seatMoveBlockReason(student.status) : null,
    studentClasses: classesLoad.byStudent[input.studentId] ?? [], toEnds: day.periods.find(p => p.start === toSlot)?.ends });
  if ('error' in check) return check;
  const now = new Date().toISOString();
  await sql`insert into public.seat_period_moves ${sql({ tenant_id: t, seat: input.seat, session_date: input.date, class_id: input.classId, student_id: input.studentId, slot_start: toSlot, moved_by: g.actor.id, updated_at: now })}
    on conflict (tenant_id, seat, session_date, class_id, student_id) do update set slot_start=excluded.slot_start, moved_by=excluded.moved_by, updated_at=excluded.updated_at`;
  let pinned = false;
  if (input.pin) {
    await sql`insert into public.seat_period_pins ${sql({ tenant_id: t, seat: input.seat, day_of_week: dowOf(c, input.date), class_id: input.classId, student_id: input.studentId, slot_start: toSlot, effective_from: input.date, pinned_by: g.actor.id, updated_at: now })}
      on conflict (tenant_id, seat, day_of_week, class_id, student_id) do update set slot_start=excluded.slot_start, effective_from=excluded.effective_from, pinned_by=excluded.pinned_by, updated_at=excluded.updated_at`;
    pinned = true;
  }
  await audit(sql, t, g.actor, pinned ? 'seat_period_pin' : 'seat_period_move', 'attendance', { studentId: input.studentId, classId: input.classId, seat: input.seat, date: input.date, fromSlot, toSlot,
    crossTime: check.crossTime, ...(alreadyThere ? { confirmOnly: true } : {}), ...(pinned ? { dayOfWeek: dowOf(c, input.date), effectiveFrom: input.date } : {}), via: VIA, from: g.from });
  return { ok: true, pinned };
}

/** 2.0 `clearSeatPeriodChoices(input)`(period-actions.ts) — 그 반의 그날 이동 + 그 요일 고정을 함께 지운다(지난 날짜의 그날 줄은 이 날짜 하나만). */
export async function clearSeatPeriodChoices(c, input) {
  const g = await moveGate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S, sql, t } = c, dow = dowOf(c, input.date);
  const [moves, pins] = await Promise.all([
    sql`delete from public.seat_period_moves where tenant_id=${t} and seat=${input.seat} and session_date=${input.date} and class_id=${input.classId} returning student_id::text student_id, slot_start::text slot_start`,
    sql`delete from public.seat_period_pins where tenant_id=${t} and seat=${input.seat} and day_of_week=${dow} and class_id=${input.classId} returning student_id::text student_id, slot_start::text slot_start`,
  ]);
  const changed = moves.length + pins.length;
  if (changed === 0) return { ok: true, changed: 0 };
  await audit(sql, t, g.actor, 'seat_period_clear', 'attendance', { classId: input.classId, seat: input.seat, date: input.date, dayOfWeek: dow, count: changed,
    removedMoves: moves.map(r => ({ studentId: r.student_id, slotStart: S.seat.hhmm(r.slot_start) })), removedPins: pins.map(r => ({ studentId: r.student_id, slotStart: S.seat.hhmm(r.slot_start) })), via: VIA, from: g.from });
  return { ok: true, changed };
}

/** 2.0 `resetSeatPlacements(input)`(placement-actions.ts) — 옮겨 둔 자리를 원래 반으로(classId = 그 묶음만 · 없으면 그 교시 전체). 대상은 서버가 다시 잰다. */
export async function resetSeatPlacements(c, input) {
  const g = await moveGate(c, input.seat, input.date);
  if ('error' in g) return g;
  const { S, R, sql, t } = c, slot = S.seat.hhmm(input.slotStart);
  // 2.0 `periodRosters` — 교시 선택을 얹은 그 교시 명단(모호한 반 제외 · 출결 상태 포함).
  const [day, choiceLoad] = await Promise.all([readSeatDay(sql, t, R, S, input.seat, input.date), readSeatPeriodChoices(sql, t, R, S, input.seat, input.date)]);
  const period = day.periods.find(p => p.start === slot);
  if (!period) return { error: '그 시각에는 이 자리 수업이 없습니다' };
  const blocked = new Set(S.seat.ambiguousClassIds(period));
  const rosters = (applySeatDayChoices(S, day, choiceLoad, input.date)[period.start] ?? []).filter(r => !blocked.has(r.classId))
    .map(r => ({ classId: r.classId, students: r.students.map(s => ({ id: s.id, status: s.status })) }));
  const load = await readSeatPlacementsForDay(sql, t, S, input.seat, input.date);
  if (!load.ready) return { error: load.reason ?? '자리 배치를 불러오지 못했습니다' };
  const targets = S.placement.seatResetTargets(S.placement.applySeatPlacements(rosters, load.bySlot[slot] ?? []).applied, input.classId);
  if (targets.length === 0) return { ok: true, changed: 0 };
  const gone = await sql`delete from public.seat_placements where tenant_id=${t} and seat=${input.seat} and session_date=${input.date} and slot_start=${slot}
    and student_id = any(${targets.map(x => x.studentId)}::uuid[]) returning student_id`;
  if (gone.length === 0) return { ok: true, changed: 0 };
  await audit(sql, t, g.actor, 'seat_placement_reset', 'attendance', { scope: input.classId ? 'class' : 'period', ...(input.classId ? { classId: input.classId } : {}), seat: input.seat, date: input.date,
    slotStart: slot, count: gone.length, moves: targets.map(x => ({ studentId: x.studentId, fromClassId: x.toClassId, toClassId: x.fromClassId })), via: VIA, from: g.from });
  return { ok: true, changed: gone.length };
}

/** 인재원 단어수 가져오기 — 바깥 API를 부르는 일이라 이 연습 화면은 부르지 않는다(2.0 실패 모양). */
export const MEMORIZED_PULL_REFUSAL = { error: '인재원 단어수 가져오기는 연습 화면에서 부르지 않습니다. 바뀐 것은 없습니다.' };

/** 2.0 인자 검사 — 자리 액션 입력(필수 칸이 없거나 모양이 다르면 400). */
export function seatInput(input, need) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  if (typeof input.seat !== 'string' || !/^[a-z]{1,8}$/.test(input.seat)) throw bad();
  if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw bad();
  if (need.includes('slot') && (typeof input.slotStart !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(input.slotStart))) throw bad();
  if (need.includes('cell')) for (const k of ['classId', 'studentId']) if (typeof input[k] !== 'string' || !UUID.test(input[k])) throw bad();
  if (need.includes('class') && (typeof input.classId !== 'string' || !UUID.test(input.classId))) throw bad();
  if (need.includes('move')) {
    for (const k of ['fromSlot', 'toSlot']) if (typeof input[k] !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(input[k])) throw bad();
    if (input.pin !== undefined && input.pin !== null && typeof input.pin !== 'boolean') throw bad();
  }
  if (input.classId !== undefined && input.classId !== null && (typeof input.classId !== 'string' || !UUID.test(input.classId))) throw bad();
  return input;
}
