// 2.0 화면 · 선생님 수업보고서(원스크린) 2단계 저장 — 보강 넷과 영상 검사 칸 둘을 Docker 복사본에 2.0과 같은 결과로(메인 분담 10-28).
//   features/attendance/server/actions.ts linkMakeupToAbsence(보강 추가 → 분리: 결석 칸 메모 + 보강한 날 칸 시수·메모)
//   features/attendance/server/makeup-reservation-actions.ts setReservationReportMode(보강 보고서 합치기↔나누기) ·
//     moveReservationToRegular(예약 보강을 그날 정규 반으로 옮겨 합치기) · checkMakeupReservation(보강 했음 / 못 했음)
//   features/video-homework/server/actions.ts setVideoHomeworkMark · setVideoHomeworkMarksBulk(지난 수업 영상 숙제 검사 칸)
// · 판정 순서·문구·반환 모양·감사로그(action 이름 · metadata — via '3.0 연습 복사본' 덧붙임)는 2.0 그대로. 판정은 2.0 순수 함수(importV2).
// · 보강 예약 이행(예약 done · 메모 · 시수 자동값 · 결석 칸 '예정 → 완료')은 출석부 화면의 이행 본문(v2-attendance-makeup.mjs
//   completeMakeupReservations · isRegularLessonDay)을 그대로 부른다 — 2.0도 같은 함수 하나(makeup-reservation-complete.ts)다.
// · 저장하는 사람 = 원스크린 화면이 고른 선생님(actAs — 원스크린 다른 저장과 같다) · 권한은 그 사람의 2.0 권한표(학원 설정 역할·개인 예외).
//   그 사람의 DB 신분(request.jwt.claims)은 이 저장 동안만 — 끝나면 들어올 때 값으로 되돌린다(저장점을 놓아도 트랜잭션 끝까지 남기 때문).
// · 2.0과 다른 점: 셸 = 강사 화면으로 본다(이 화면은 선생님 수업보고서 — 보강 기한 문이 2.0 강사뷰처럼 선다) · 새 보강 체계(보강관리 켜짐)
//   학원의 연결 예약 갈래는 옮기지 않았다(그 학원이면 거절 문구 — 이 복사본은 꺼짐) · 보강 연결 뒤 '반 출결 완료' 벨(after 훅)은 만들지 않는다 ·
//   revalidatePath는 호스트가 저장 뒤 다시 읽는 것으로 대신한다. 바깥 호출 없음.
import { V2Error } from './v2-screens.mjs';
import { loadRules as attendanceRules, readSettings as attendanceSettings } from './v2-screen-attendance.mjs';
import { loadMakeupRules, completeMakeupReservations, completionKey, isRegularLessonDay, nativeMakeupsOn } from './v2-attendance-makeup.mjs';

const ATTENDANCE = 'features/attendance/server/actions.ts';
const RESERVATION = 'features/attendance/server/makeup-reservation-actions.ts';
const VIDEO = 'features/video-homework/server/actions.ts';
const EXTRA = { options: 'features/attendance/makeup-options.ts', host: 'features/attendance/makeup-host.ts', policy: 'features/video-homework/policy.ts',
  vtypes: 'features/video-homework/types.ts' };
let extraP = null;
const extra = (importV2) => (extraP ??= Promise.all(Object.entries(EXTRA).map(async ([k, p]) => [k, await importV2(p)])).then(Object.fromEntries)
  .catch((e) => { extraP = null; throw e; }));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, YMD = /^\d{4}-\d{2}-\d{2}$/;
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/** 2.0 문구(makeup-reservation-actions.ts) */
const NOT_APPLIED = '보강 예약 표(0264a)가 아직 적용되지 않았습니다 — 관리자에게 SQL 적용을 요청하세요';
const NATIVE_REFUSED = '보강관리로 옮겨진 학원의 보강 예약은 연습 화면에서 아직 바꾸지 않습니다. 바뀐 것은 없습니다.';
const DONE_ERROR = '이 보강은 이미 기록된 반 출석부에 찍혀 있어 다른 반으로 옮길 수 없습니다 — 출석부에서 보강 칸을 먼저 고쳐 주세요';
const MISSED_MAKEUP_ONLY_ERROR = '정규 수업이 없는 날의 보강 출결이 남아 있습니다 — 출석부에서 그 칸을 지운 뒤 다시 눌러 주세요';
const MISSED_MAKEUP_STATUS_ERROR = "그날 출결 칸에서 정규 수업분을 가려낼 수 없습니다(출결이 '보강'이거나 시수가 보강분뿐) — 출석부에서 출결·시수를 고친 뒤 다시 눌러 주세요";
const READ_FAIL = { error: '보강 기록을 읽지 못했습니다 — 잠시 후 다시 시도하세요' };

/** v2-host 호출 { module, actor, args:[input] } — 모듈은 그 함수를 내보내는 2.0 파일이어야 한다. 입력 모양은 run이 2.0처럼 본다(2.0 거절 문구). */
const call = (module) => (raw) => {
  if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length !== 1 || !plain(raw.args[0])) throw bad();
  if (typeof raw.actor !== 'string' || !UUID_RE.test(raw.actor)) throw bad();
  return { actor: raw.actor, input: raw.args[0] };
};

/** 2.0 toReservation(makeup-reservation-queries.ts) — 0438a·0440a 칸까지. */
const toReservation = (r) => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: String(r.absence_date).slice(0, 10), makeupDate: String(r.makeup_date).slice(0, 10),
  slotStart: String(r.slot_start ?? '').slice(0, 5), slotEnd: String(r.slot_end ?? '').slice(0, 5), periodLabel: r.period_label ?? null, note: r.note ?? null,
  status: r.status === 'done' ? 'done' : 'reserved', createdBy: r.created_by ?? null,
  ...('report_mode' in r ? { reportMode: r.report_mode === 'merge' || r.report_mode === 'separate' ? r.report_mode : null } : {}),
  ...('absence_class_id' in r ? { absenceClassId: r.absence_class_id ?? null } : {}) });
const RES_COLS = (sql) => sql`id::text id, student_id::text student_id, class_id::text class_id, absence_date::text absence_date, makeup_date::text makeup_date,
  slot_start::text slot_start, slot_end::text slot_end, period_label, note, status::text status, created_by::text created_by, report_mode, absence_class_id::text absence_class_id`;
const dayRows = (sql, t, classId, studentId, date) => sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date,
    slot_start::text slot_start, status::text status, note, session_units::float8 session_units,
    to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
  from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${date} order by id`;

/**
 * 한 저장의 틀 — 규칙·설정·저장하는 사람(그 사람의 DB 신분)을 세우고, 끝나면(실패해도) 신분을 들어올 때 값으로 되돌린다.
 * `h()` = 원스크린 화면 모듈의 도우미(그 모듈이 다 읽힌 뒤에 부른다 — 서로 import하는 순서 문제를 피한다).
 */
async function withActor(h, { sql, tenantId: t, importV2 }, actorId, fn) {
  const H = h(), [R, A, M, X] = await Promise.all([H.rules(importV2), attendanceRules(importV2), loadMakeupRules(importV2), extra(importV2)]);
  const [{ c: before }] = await sql`select current_setting('request.jwt.claims', true) c`;
  try {
    const env = await H.settingsOf(sql, t, R), actor = await H.actAs(sql, t, actorId);
    const matrix = H.menuMatrix(R, env, actor), today = await H.copyDay();
    const attSettings = await attendanceSettings(sql, t, A);
    const ctx = { H, R, A, M, X, env, actor, matrix, today, sql, t, importV2, attSettings,
      level: (menu) => R.accessLevel(actor.role, menu, matrix), canWrite: (menu) => R.canWrite(actor.role, menu, matrix),
      // 이행 본문(v2-attendance-makeup.mjs)이 읽는 모양 — 감사로그 이름은 이 사람.
      complete: (cells) => completeMakeupReservations({ sql, t, R: A, M, settings: attSettings, actor: { id: actor.id, name: actor.display_name } }, cells),
      audit: (action, targetType, metadata, targetLabel = null) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${t}, ${actor.id}, ${actor.display_name}, ${action}, ${targetType}, ${targetLabel}, ${sql.json({ ...metadata, via: H.VIA })})` };
    const out = await fn(ctx);
    await sql`select set_config('request.jwt.claims', ${before ?? ''}, true)`;
    return out;
  } catch (e) {
    // 실패해도 신분은 되돌린다 — 단 트랜잭션이 이미 중단됐으면(25P02) 다음 문장도 거절되니 원래 오류를 그대로 올린다(그 트랜잭션은 어차피 되돌려진다).
    await sql`select set_config('request.jwt.claims', ${before ?? ''}, true)`.catch(() => {});
    throw e;
  }
}
const hasColumn = async (sql, table, column) => (await sql`select exists (select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${column}) ok`)[0].ok;
const hasTable = async (sql, table) => (await sql`select to_regclass(${`public.${table}`}) is not null ok`)[0].ok;
/** 2.0 userTaughtClassSet — 원스크린 모듈의 taughtClassSet(가르치는 반 + 그날 시간표 칸 담당 반). */
const taught = (c, date) => c.H.taughtClassSet(c.sql, c.t, c.R, c.env, c.actor.id, date);
/** 2.0 mappedReservationMutationBlock — 새 보강 체계가 꺼진 학원은 막지 않는다(켜진 학원의 연결 확인은 옮기지 않아 거절). */
const nativeBlock = (c) => (nativeMakeupsOn(c.M, c.attSettings) ? NATIVE_REFUSED : null);

// ── setReservationReportMode ────────────────────────────────────────────────────────────────────────────────────────────
async function setReservationReportMode(c, input) {
  if (!c.canWrite('attendance')) return { error: '출석 관리 권한이 없습니다' };
  if (!input?.studentId || !input.classId || !YMD.test(input.date ?? '') || !c.M.resv.isMakeupReportMode(input.mode)) return { error: '잘못된 요청입니다' };
  if (c.level('attendance') === 'scoped' && !(await taught(c, input.date)).has(input.classId)) return { error: '담당 반이 아닙니다' };
  if (!(await hasTable(c.sql, 'makeup_reservations')) || !(await hasColumn(c.sql, 'makeup_reservations', 'report_mode'))) return { error: NOT_APPLIED };
  const rows = await c.sql`update public.makeup_reservations set report_mode=${input.mode}, updated_at=now()
    where tenant_id=${c.t} and student_id=${input.studentId} and class_id=${input.classId} and makeup_date=${input.date}::date and status in ('reserved','done') returning id::text id`;
  const ids = rows.map((r) => r.id);
  if (ids.length) await c.audit('makeup_reserve_report_mode', 'attendance', { studentId: input.studentId, classId: input.classId, date: input.date, mode: input.mode, reservationIds: ids });
  return { ok: true, updated: ids.length };
}

// ── reservationHostChoices(2.0 서버 전용) — 그날 학생이 다니는 열린 같은 과목 반 · 강사는 그날 담당 반만 · 결석난 반 먼저, 이름순 ──
async function reservationHostChoices(c, at) {
  const ens = await c.sql`select class_id::text class_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred from public.enrollments
    where tenant_id=${c.t} and student_id=${at.studentId}`;
  const ids = [...new Set(ens.filter((e) => c.A.elig.isEnrollmentActiveOn({ startDate: e.start_date ?? '0000-01-01', endDate: e.end_date ?? null, onHold: e.on_hold ?? false,
    isTransferred: e.is_transferred === true }, at.date)).map((e) => e.class_id))];
  if (ids.length === 0) return [];
  const classes = await c.sql`select id::text id, class_name, subject, is_active, closed_at::text closed_at from public.classes where tenant_id=${c.t} and id = any(${ids}::uuid[])`;
  let list = classes.filter((k) => k.is_active !== false && String(k.subject ?? '') === at.subject && c.X.host.isClassOpenOn(k.closed_at, at.date));
  if (c.level('attendance') === 'scoped') { const teaching = await taught(c, at.date); list = list.filter((k) => teaching.has(k.id)); }
  return list.map((k) => ({ classId: k.id, className: String(k.class_name ?? ''), absenceClass: k.id === at.absenceClassId }))
    .sort((a, b) => Number(b.absenceClass) - Number(a.absenceClass) || a.className.localeCompare(b.className, 'ko'));
}
/** 2.0 isRegularLessonDay — 조회 실패면 null(2.0 문구로 알린다). */
const regularDayOf = (c, at) => c.sql.savepoint((sp) => isRegularLessonDay(sp, c.t, c.A, c.M, at)).catch(() => null);

// ── moveReservationToRegular ──────────────────────────────────────────────────────────────────────────────────────────
class Undo extends Error { constructor(result) { super('undo'); this.result = result; } }
async function moveReservationToRegular(c, input) {
  if (!c.canWrite('attendance')) return { error: '출석 관리 권한이 없습니다' };
  const { studentId, date, fromClassId, toClassId } = input ?? {};
  if (!studentId || !fromClassId || !toClassId || fromClassId === toClassId || !YMD.test(date ?? '')) return { error: '잘못된 요청입니다' };
  const scoped = c.level('attendance') === 'scoped';
  if (scoped && !c.R.isWithinAttendanceEditWindow(date, c.today)) return { error: c.R.attendanceLockMessage(date, c.today) };
  if (!(await hasTable(c.sql, 'makeup_reservations'))) return { error: NOT_APPLIED };
  if (!(await hasColumn(c.sql, 'makeup_reservations', 'absence_class_id')) || !(await hasColumn(c.sql, 'makeup_reservations', 'report_mode')))
    return { error: '다른 반에 기록하는 보강 예약은 아직 준비 중입니다 — 관리자에게 알려 주세요' };
  const list = (await c.sql`select ${RES_COLS(c.sql)} from public.makeup_reservations where tenant_id=${c.t} and student_id=${studentId} and class_id=${fromClassId}
    and makeup_date=${date}::date and status in ('reserved','done')`).map(toReservation);
  if (list.length === 0) return { error: '옮길 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요' };
  if (list.some((r) => r.status === 'done')) return { error: DONE_ERROR };
  if (scoped) {
    const teaching = await taught(c, date);
    if (!teaching.has(toClassId)) return { error: '담당 반이 아닙니다' };
    if (!teaching.has(fromClassId)) for (const r of list) if (!(await taught(c, r.absenceDate)).has(c.M.resv.absenceClassOf(r))) return { error: '담당 반이 아닙니다' };
  }
  const block = nativeBlock(c);
  if (block) return { error: block };
  const [[fromCls], [stu]] = await Promise.all([
    c.sql`select subject from public.classes where tenant_id=${c.t} and id=${fromClassId}`,
    c.sql`select name from public.students where tenant_id=${c.t} and id=${studentId}`]);
  if (!fromCls) return { error: '반을 찾지 못했습니다' };
  let hosts;
  try { hosts = await c.sql.savepoint((sp) => reservationHostChoices({ ...c, sql: sp }, { studentId, absenceClassId: c.M.resv.absenceClassOf(list[0]), subject: String(fromCls.subject ?? ''), date })); }
  catch { return { error: '학생의 반을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요' }; }
  const host = hosts.find((x) => x.classId === toClassId);
  if (!host) return { error: '합칠 반을 다시 확인해 주세요 — 그날 이 학생이 다니는 같은 과목 반만 됩니다' };
  const regularDay = await regularDayOf(c, { studentId, classId: toClassId, date });
  if (regularDay === null) return { error: '그날 정규 수업인지 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요' };
  if (!regularDay) return { error: `그날은 ${host.className} 정규 수업일이 아니라 합칠 수 없습니다` };
  const fromDay = c.A.effective.effectiveAttendanceRecords(await dayRows(c.sql, c.t, fromClassId, studentId, date));
  if (fromDay.some((x) => c.M.resv.completesReservation(x.status))) return { error: DONE_ERROR };
  // 옮기기 = 저장점 하나(2.0은 실패하면 옮긴 줄을 되돌린다 — 같은 결과).
  let moved;
  try {
    moved = await c.sql.savepoint(async (sp) => {
      const out = [];
      for (const r of list) {
        const absenceId = c.M.resv.absenceClassOf(r);
        let upd;
        try {
          upd = await sp`update public.makeup_reservations set class_id=${toClassId}, absence_class_id=${absenceId === toClassId ? null : absenceId}, report_mode='merge', updated_at=now()
            where tenant_id=${c.t} and id=${r.id} and status='reserved' and class_id=${fromClassId} returning id`;
        } catch (e) {
          throw new Undo(e?.code === '23505' ? { error: `${host.className}에 같은 교시 보강 예약이 이미 있습니다` } : { error: '보강 예약을 옮기지 못했습니다 — 잠시 후 다시 시도하세요' });
        }
        if (upd.length === 0) throw new Undo({ error: '그 사이 예약이 바뀌어 옮기지 못했습니다 — 새로고침 뒤 확인해 주세요' });
        out.push(r);
      }
      return out;
    });
  } catch (e) { if (e instanceof Undo) return e.result; throw e; }
  const completed = await c.complete([{ studentId, classId: toClassId, date, status: null, unitsExplicit: false, created: false, addToCurrent: true }]);
  const units = completed.get(completionKey({ studentId, classId: toClassId, date }));
  await c.audit('makeup_reserve_host_move', 'attendance', { studentId, date, fromClassId, classId: toClassId, reservationIds: moved.map((r) => r.id), reportMode: 'merge',
    ...(units !== undefined ? { units } : {}) }, stu?.name ? `${stu.name} · ${host.className}` : null);
  return { ok: true, moved: moved.length, ...(units !== undefined ? { units } : {}) };
}

// ── checkMakeupReservation ────────────────────────────────────────────────────────────────────────────────────────────
async function checkMakeupReservation(c, input) {
  if (!c.canWrite('attendance')) return { error: '출석 관리 권한이 없습니다' };
  const { studentId, classId, date, outcome } = input ?? {};
  if (!studentId || !classId || !YMD.test(date ?? '') || (outcome !== 'done' && outcome !== 'missed')) return { error: '잘못된 요청입니다' };
  const scoped = c.level('attendance') === 'scoped';
  if (scoped && !c.R.isWithinAttendanceEditWindow(date, c.today)) return { error: c.R.attendanceLockMessage(date, c.today) };
  if (!(await hasTable(c.sql, 'makeup_reservations'))) return { error: NOT_APPLIED };
  const checkColumn = await hasColumn(c.sql, 'makeup_reservations', 'checked_at');
  const list = (await c.sql`select ${RES_COLS(c.sql)} from public.makeup_reservations where tenant_id=${c.t} and student_id=${studentId} and class_id=${classId}
    and makeup_date=${date}::date and status in ('reserved','done')`).map(toReservation);
  if (list.length === 0) return { error: '확인할 보강 예약을 찾지 못했습니다 — 새로고침 뒤 다시 시도해 주세요' };
  if (scoped && !(await taught(c, date)).has(classId)) return { error: '담당 반이 아닙니다' };
  const block = nativeBlock(c);
  if (block) return { error: block };
  const [[cls], [stu], regularDay] = await Promise.all([
    c.sql`select subject, class_name from public.classes where tenant_id=${c.t} and id=${classId}`,
    c.sql`select name from public.students where tenant_id=${c.t} and id=${studentId}`,
    regularDayOf(c, { studentId, classId, date })]);
  if (regularDay === null) return { error: '그날 정규 수업인지 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요' };
  const subject = cls?.subject ?? null;
  const label = stu?.name && cls?.class_name ? `${stu.name} · ${cls.class_name}` : null;
  const log = (meta) => c.audit('makeup_reserve_check', 'attendance', { studentId, classId, date, outcome, reservationIds: list.map((r) => r.id), ...meta }, label);

  if (outcome === 'done') {
    let units, marked;
    if (list.some((r) => r.status === 'reserved')) {
      const day = c.A.effective.effectiveAttendanceRecords(await dayRows(c.sql, c.t, classId, studentId, date));
      const counted = day.filter((x) => c.M.resv.completesReservation(x.status));
      if (counted.length > 0) {
        const addOn = regularDay && !counted.some((x) => x.status === 'makeup');
        const completed = await c.complete([addOn
          ? { studentId, classId, date, status: null, unitsExplicit: false, created: false, addToCurrent: true }
          : { studentId, classId, date, status: null, unitsExplicit: true, created: false }]);
        units = completed.get(completionKey({ studentId, classId, date }));
      } else if (day.some((x) => x.status === 'absent' || x.status === 'excused')) {
        return { error: '그날 출결이 결석이라 보강을 했다고 기록할 수 없습니다 — 출결을 먼저 고쳐 주세요' };
      } else {
        // 2.0 setAttendanceCell(quiet, units: "") — 원스크린 칸 저장 그대로(권한·담당·기간·시수 자동값 · 감사로그 다음 예약 이행까지 그 안에서 한 번).
        marked = regularDay ? 'present' : 'makeup';
        let cell;
        try { cell = await c.H.runAttendance(c.sql, c.t, c.R, { actor: c.actor.id, studentId, classId, sessionDate: date, status: marked, note: undefined, onlyIfEmpty: false, blankUnits: true }, c.importV2); }
        catch (e) { if (e instanceof V2Error) return { error: e.message }; throw e; }
        // 2.0: 그 칸이 돌려준 autoUnits(이행 값이 있으면 그 값 · 자동값이 null이어도 null 그대로)를 units로.
        units = cell && 'autoUnits' in cell ? cell.autoUnits : undefined;
      }
      const still = await c.sql`select id from public.makeup_reservations where tenant_id=${c.t} and id = any(${list.map((r) => r.id)}::uuid[]) and status='reserved'`;
      if (still.length > 0) return { error: '보강을 처리하지 못했습니다 — 출석부에서 그날 출결을 확인해 주세요' };
    }
    const extraMeta = { ...(units !== undefined ? { units } : {}), ...(marked ? { marked } : {}) };
    if (!checkColumn) {
      await log({ checkUnsaved: true, ...extraMeta });
      return { ok: true, outcome, checkUnsaved: true, ...extraMeta };
    }
    await c.sql`update public.makeup_reservations set checked_at=now(), checked_by=${c.actor.id}, updated_at=now()
      where tenant_id=${c.t} and id = any(${list.map((r) => r.id)}::uuid[]) and status='done'`;
    await log(extraMeta);
    return { ok: true, outcome, ...extraMeta };
  }

  // ── 못 했음 ── 막힐 일과 조회를 모두 본 뒤에 쓴다(반쪽 상태 금지).
  const doneList = list.filter((r) => r.status === 'done');
  let cellIdOf = new Map(), cells = new Map(), orphanCounted = false;
  if (doneList.length) {
    const links = await c.sql`select id::text id, attendance_record_id::text attendance_record_id from public.makeup_reservations where tenant_id=${c.t} and id = any(${doneList.map((r) => r.id)}::uuid[])`;
    cellIdOf = new Map(links.map((l) => [l.id, l.attendance_record_id]));
    const cellIds = [...new Set([...cellIdOf.values()].filter(Boolean))];
    if (cellIds.length) {
      const rows = await c.sql`select id::text id, slot_start::text slot_start, status::text status, session_units::float8 session_units, note from public.attendance_records
        where tenant_id=${c.t} and id = any(${cellIds}::uuid[])`;
      cells = new Map(rows.map((x) => [x.id, x]));
    }
    if (doneList.some((r) => !cells.has(cellIdOf.get(r.id) ?? ''))) {
      const day = c.A.effective.effectiveAttendanceRecords(await dayRows(c.sql, c.t, classId, studentId, date));
      orphanCounted = day.some((x) => c.M.resv.completesReservation(x.status) && !cells.has(x.id));
    }
    if ((cells.size > 0 || orphanCounted) && !regularDay) return { error: MISSED_MAKEUP_ONLY_ERROR, code: 'makeup_only' };
    if ([...cells.values()].some((x) => x.status === 'makeup')) return { error: MISSED_MAKEUP_STATUS_ERROR };
  }
  const autoOf = new Map(), autoOn = c.R.lessonProfileOf({ preset: c.env.preset }).autoUnits;
  if (autoOn) {
    for (const r of doneList) {
      const [lg] = await c.sql`select metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs where tenant_id=${c.t} and action='makeup_reserve_done'
        and metadata->>'reservationId' = ${r.id} order by created_at desc limit 1`;
      const auto = lg?.metadata?.autoUnits;
      if (typeof auto === 'number') autoOf.set(r.id, { auto, at: String(lg.created_at ?? '') });
    }
  }
  const round1 = c.A.units.round1, plans = [];
  let unitsLeft = orphanCounted && autoOn;
  const byCell = new Map();
  for (const r of doneList) {
    const cellId = cellIdOf.get(r.id);
    if (!cellId || !cells.has(cellId)) continue;
    byCell.set(cellId, [...(byCell.get(cellId) ?? []), r]);
  }
  for (const [cellId, rs] of byCell) {
    const cell = cells.get(cellId), plan = { id: cell.id, note: cell.note, noteChanged: false };
    for (const r of rs) {
      const line = c.M.resv.reservationMakeupMemo(r);
      if (c.M.link.hasMemoLine(plan.note, line)) { plan.note = c.M.resv.removeMemoLine(plan.note, line); plan.noteChanged = true; }
    }
    if (autoOn && cell.slot_start == null) {
      const resOf = (r) => c.M.resv.reservationAutoUnits(r, subject) ?? 0;
      const resSum = round1(rs.reduce((sum, r) => sum + resOf(r), 0));
      const chain = rs.map((r) => ({ r, log: autoOf.get(r.id) }));
      const known = chain.every((x) => !!x.log);
      chain.sort((a, b) => (a.log?.at ?? '').localeCompare(b.log?.at ?? ''));
      const cumulative = known && chain.every((x, k) => k === 0 || round1(x.log.auto - chain[k - 1].log.auto) === round1(resOf(x.r)));
      const latest = known ? chain[chain.length - 1].log : undefined;
      const current = cell.session_units == null ? 1 : Number(cell.session_units);
      if (latest && cumulative && resSum > 0 && current === latest.auto) {
        const next = round1(latest.auto - resSum);
        if (next <= 0) return { error: MISSED_MAKEUP_STATUS_ERROR };
        plan.units = next === 1 ? null : next;
      } else if (resSum > 0) unitsLeft = true;
    }
    plans.push(plan);
  }
  let units;
  for (const plan of plans) {
    if (!plan.noteChanged && plan.units === undefined) continue;
    if (plan.noteChanged && plan.units !== undefined) await c.sql`update public.attendance_records set note=${plan.note}, session_units=${plan.units} where tenant_id=${c.t} and id=${plan.id}`;
    else if (plan.noteChanged) await c.sql`update public.attendance_records set note=${plan.note} where tenant_id=${c.t} and id=${plan.id}`;
    else await c.sql`update public.attendance_records set session_units=${plan.units} where tenant_id=${c.t} and id=${plan.id}`;
    if (plan.units !== undefined) units = plan.units;
  }
  await c.sql`delete from public.makeup_reservations where tenant_id=${c.t} and id = any(${list.map((r) => r.id)}::uuid[]) and status in ('reserved','done')`;
  for (const r of list) {
    const absenceClassId = c.M.resv.absenceClassOf(r);
    const siblings = await c.sql`select class_id::text class_id, absence_class_id::text absence_class_id from public.makeup_reservations where tenant_id=${c.t}
      and student_id=${studentId} and absence_date=${r.absenceDate}::date and makeup_date=${r.makeupDate}::date`;
    if (siblings.some((x) => (x.absence_class_id ?? x.class_id) === absenceClassId)) continue;
    const absRows = await c.sql`select id::text id, note from public.attendance_records where tenant_id=${c.t} and class_id=${absenceClassId} and student_id=${studentId}
      and session_date=${r.absenceDate}::date`;
    for (const a of absRows) {
      let note = a.note;
      for (const line of [c.M.resv.reservationAbsenceDoneMemo(r), c.M.resv.reservationAbsenceMemo(r)]) if (c.M.link.hasMemoLine(note, line)) note = c.M.resv.removeMemoLine(note, line);
      if (note !== a.note) await c.sql`update public.attendance_records set note=${note} where tenant_id=${c.t} and id=${a.id}`;
    }
  }
  await log({ ...(units !== undefined ? { units } : {}), ...(unitsLeft ? { unitsLeft: true } : {}) });
  return { ok: true, outcome, ...(units !== undefined ? { units } : {}), ...(unitsLeft ? { unitsLeft: true } : {}) };
}

// ── linkMakeupToAbsence ───────────────────────────────────────────────────────────────────────────────────────────────
/** 2.0 absence-cell.ts — 결석·공결 칸(정정 이력을 접은 유효 행 · 최신 먼저)과 메모 붙일 칸 고르기(서버 전용 파일이라 본문을 옮겼다). */
const ABSENT = new Set(['absent', 'excused']);
const MADE_UP_RE = /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/;
function pickAbsenceNoteTarget(M, rows, memo) {
  return rows.find((r) => M.link.hasMemoLine(r.note, memo)) ?? rows.find((r) => !MADE_UP_RE.test(r.note ?? '')) ?? rows[0] ?? null;
}
async function linkMakeupToAbsence(c, input) {
  if (!c.canWrite('attendance')) return { error: '출석 관리 권한이 없습니다' };
  const { studentId, classId, absentDate, makeupDate, addUnits } = input ?? {};
  const absentClassId = input?.absentClassId || classId;
  if (!studentId || !classId || !absentDate || !makeupDate) return { error: '필수 값이 누락되었습니다' };
  if (!YMD.test(absentDate) || !YMD.test(makeupDate)) return { error: '잘못된 날짜입니다' };
  if (![studentId, classId, absentClassId].every((v) => typeof v === 'string' && UUID_RE.test(v))) return { error: '필수 값이 누락되었습니다' };
  if (absentDate === makeupDate) return { error: "결석한 날과 보강한 날이 같습니다 — 그때는 '합침'을 쓰세요" };
  // 보강 기한(결석한 달의 다음 달 말일) — 2.0은 강사 화면일 때만 막는다. 이 화면 = 선생님 수업보고서(강사 화면).
  if (!c.X.options.isWithinMakeupDeadline(absentDate, makeupDate)) return { error: c.X.options.makeupDeadlineMessage(absentDate) };
  if (typeof addUnits !== 'number' || !Number.isFinite(addUnits) || addUnits <= 0 || addUnits > 24) return { error: '보강 시수가 올바르지 않습니다' };
  if (c.level('attendance') === 'scoped') {
    if (!c.R.isWithinAttendanceEditWindow(makeupDate, c.today)) return { error: c.R.attendanceLockMessage(makeupDate, c.today) };
    const [teaching, [{ n: enrolled }]] = await Promise.all([taught(c, makeupDate),
      c.sql`select count(*)::int n from public.enrollments where tenant_id=${c.t} and class_id=${classId} and student_id=${studentId}
        and (start_date is null or start_date<=${makeupDate}::date) and (end_date is null or end_date>=${makeupDate}::date)`]);
    if (!teaching.has(classId)) return { error: '담당 반이 아닙니다' };
    if (!enrolled) return { error: '이 반 수강생이 아닙니다' };
  }
  const [absent, [makeupCell]] = await Promise.all([
    dayRows(c.sql, c.t, absentClassId, studentId, absentDate),
    c.sql`select id::text id, status::text status, note, session_units::float8 session_units from public.attendance_records where tenant_id=${c.t} and class_id=${classId}
      and student_id=${studentId} and session_date=${makeupDate}::date order by recorded_at desc limit 1`]);
  const absentRows = c.A.effective.effectiveAttendanceRecords(absent).filter((r) => ABSENT.has(r.status))
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id.localeCompare(a.id))).map((r) => ({ id: r.id, note: r.note ?? null }));
  const memoOnMakeup = c.M.link.makeupMemo(absentDate, makeupDate);
  const alreadyLinked = c.M.link.hasMemoLine(makeupCell?.note, memoOnMakeup);
  const units = alreadyLinked ? (makeupCell?.session_units ?? 1) : c.M.link.unitsAfterMakeup(makeupCell?.session_units, addUnits);
  const memoOnAbsence = c.M.link.absenceMemo(makeupDate, absentDate);
  const absentTarget = pickAbsenceNoteTarget(c.M, absentRows, memoOnAbsence);
  let writes = 0;
  if (absentTarget && !c.M.link.hasMemoLine(absentTarget.note, memoOnAbsence)) {
    await c.sql`update public.attendance_records set note=${c.M.link.appendMemo(absentTarget.note, memoOnAbsence)} where tenant_id=${c.t} and id=${absentTarget.id}`;
    writes += 1;
  }
  if (!alreadyLinked) {
    if (makeupCell?.id) {
      await c.sql`update public.attendance_records set session_units=${units}, note=${c.M.link.appendMemo(makeupCell.note, memoOnMakeup)}, recorded_by=${c.actor.id}, recorded_at=now()
        where tenant_id=${c.t} and id=${makeupCell.id}`;
    } else {
      await c.sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, note, recorded_by)
        values (${c.t}, ${classId}, ${studentId}, ${makeupDate}::date, 'present', ${units}, ${memoOnMakeup}, ${c.actor.id})`;
    }
    writes += 1;
  }
  if (writes > 0) {
    await c.audit('attendance_makeup_link', 'attendance', { studentId, classId, ...(absentClassId !== classId ? { absentClassId } : {}), absentDate, makeupDate, addUnits, units,
      absenceNoted: !!absentTarget, ...(alreadyLinked ? { alreadyLinked: true } : {}) });
  }
  return { ok: true, units, absenceNoted: !!absentTarget, alreadyLinked };
}

// ── setVideoHomeworkMark · setVideoHomeworkMarksBulk ──────────────────────────────────────────────────────────────────
const VH_STATUSES = ['submitted', 'missing', null];
/** 2.0 videoHomeworkWriteError — 수업보고서 '전체'면 통과 · 아니면 원스크린 쓰기 + 그날 가르치는 반(getTeachingClassIds — 담임 · 위임 · JJ 보고서 담당). */
async function videoHomeworkWriteError(c, classId, date) {
  if (c.level('lesson_reports') === 'full') return null;
  if (!c.canWrite('teacher_onescreen')) return '수정 권한이 없습니다.';
  const ids = await c.H.teachingClassIds(c.sql, c.t, c.R, c.env, c.actor.id, date);
  return ids.includes(classId) ? null : '담당 반만 수정할 수 있습니다.';
}
/** 2.0 isCancelledHomework(cancels.ts) — 취소 기록이 있고, 그날 보고서 '있음'·따로 낸 숙제가 없다. 못 읽으면 false(2.0과 같다). */
async function isCancelledHomework(c, key) {
  try {
    return await c.sql.savepoint(async (sp) => {
      const cancel = await sp`select 1 from public.video_homework_cancels where tenant_id=${c.t} and class_id=${key.classId} and student_id=${key.studentId} and homework_date=${key.date}::date limit 1`;
      if (!cancel.length) return false;
      const [report, extraIssue] = await Promise.all([
        sp`select 1 from public.lesson_reports where tenant_id=${c.t} and class_id=${key.classId} and student_id=${key.studentId} and report_date=${key.date}::date and video_homework limit 1`,
        sp`select 1 from public.video_homework_extra_issues where tenant_id=${c.t} and class_id=${key.classId} and student_id=${key.studentId} and homework_date=${key.date}::date limit 1`]);
      return !report.length && !extraIssue.length;
    });
  } catch { return false; }
}
/** 2.0 writeCheckedMark — 대상 · 취소한 숙제 · 그날 명단(수강 · 보강 출결·예약 · 이미 있는 기록) 확인 뒤 writeVideoHomeworkMark. */
async function writeCheckedMark(c, input) {
  if (input.status !== null) {
    const [[cls], [student]] = await Promise.all([
      c.sql`select subject, class_name from public.classes where tenant_id=${c.t} and id=${input.classId}`,
      c.sql`select grade, name from public.students where tenant_id=${c.t} and id=${input.studentId}`]);
    if (!cls || !student) return { ok: false, error: '해당 반이나 학생을 찾을 수 없습니다.' };
    if (!c.X.policy.isVideoHomeworkEnabled(c.env.report.videoHomeworkPolicy, { classId: input.classId, subjectKey: cls.subject, grade: student.grade }))
      return { ok: false, error: '영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요.' };
    if (input.homeworkDate && await isCancelledHomework(c, { classId: input.classId, studentId: input.studentId, date: input.homeworkDate }))
      return { ok: false, error: '영상 제출 현황에서 취소한 숙제입니다. 화면을 새로고침해 주세요.' };
  }
  const ens = await c.sql`select start_date::text start_date, end_date::text end_date, on_hold, is_transferred from public.enrollments where tenant_id=${c.t}
    and class_id=${input.classId} and student_id=${input.studentId} and (start_date is null or start_date<=${input.checkDate}::date) and (end_date is null or end_date>=${input.checkDate}::date)`;
  const enrolledOnDate = ens.some((e) => c.A.elig.isEnrollmentActiveOn({ startDate: e.start_date ?? '', endDate: e.end_date, onHold: e.on_hold === true, isTransferred: e.is_transferred === true }, input.checkDate));
  if (!enrolledOnDate) {
    const [att, res, existing] = await Promise.all([
      c.sql`select 1 from public.attendance_records where tenant_id=${c.t} and class_id=${input.classId} and student_id=${input.studentId} and session_date=${input.checkDate}::date limit 1`,
      c.sql`select 1 from public.makeup_reservations where tenant_id=${c.t} and class_id=${input.classId} and student_id=${input.studentId} and makeup_date=${input.checkDate}::date and status='reserved' limit 1`,
      c.sql`select 1 from public.video_homework_marks where tenant_id=${c.t} and class_id=${input.classId} and student_id=${input.studentId} and check_date=${input.checkDate}::date limit 1`]);
    // 2.0 nativeWriteAllowance — 새 보강 체계 참여만 허용하는 갈래(꺼진 학원 = 허용 안 함 · 켜진 학원은 옮기지 않아 거절).
    if (!att.length && !res.length && !existing.length) return { ok: false, error: '해당 수업 날짜의 학생을 찾을 수 없습니다.' };
  }
  return writeMark(c, { classId: input.classId, studentId: input.studentId, slotDate: input.checkDate, slotIsMine: true, homeworkDate: input.homeworkDate,
    submittedDate: input.submittedDate, status: input.status });
}
/** 2.0 writeVideoHomeworkMark(mark-write.ts) — 같은 숙제 = 한 줄(있으면 그 줄을 고치고, 없을 때만 자리에 새로 · 미확인 = 지운다). */
async function writeMark(c, input) {
  const { sql, t } = c;
  const scope = sql`tenant_id=${t} and class_id=${input.classId} and student_id=${input.studentId}`;
  const sameIds = input.homeworkDate ? (await sql`select id::text id from public.video_homework_marks where ${scope} and homework_date=${input.homeworkDate}::date`).map((r) => r.id) : [];
  if (input.status === null) {
    const slot = input.homeworkDate && !input.slotIsMine
      ? await sql`select id::text id from public.video_homework_marks where ${scope} and check_date=${input.slotDate}::date and (homework_date is null or homework_date=${input.homeworkDate}::date)`
      : await sql`select id::text id from public.video_homework_marks where ${scope} and check_date=${input.slotDate}::date`;
    const ids = [...new Set([...sameIds, ...slot.map((r) => r.id)])];
    if (ids.length) await sql`delete from public.video_homework_marks where tenant_id=${t} and id = any(${ids}::uuid[])`;
    return { ok: true };
  }
  const submitted = input.status === 'missing' ? { set: true, value: null } : input.submittedDate !== undefined ? { set: true, value: input.submittedDate } : { set: false };
  if (sameIds.length) {
    await sql`update public.video_homework_marks set status=${input.status}, updated_by=${c.actor.id}, updated_at=now()
      ${submitted.set ? sql`, submitted_date=${submitted.value}::date` : sql``} where tenant_id=${t} and id = any(${sameIds}::uuid[])`;
    return { ok: true };
  }
  await sql`insert into public.video_homework_marks (tenant_id, class_id, student_id, check_date, homework_date, status, updated_by, updated_at ${submitted.set ? sql`, submitted_date` : sql``})
    values (${t}, ${input.classId}, ${input.studentId}, ${input.slotDate}::date, ${input.homeworkDate}::date, ${input.status}, ${c.actor.id}, now() ${submitted.set ? sql`, ${submitted.value}::date` : sql``})
    on conflict (tenant_id, class_id, student_id, check_date) do update set homework_date=excluded.homework_date, status=excluded.status, updated_by=excluded.updated_by,
      updated_at=excluded.updated_at ${submitted.set ? sql`, submitted_date=excluded.submitted_date` : sql``}`;
  return { ok: true };
}
const badSubmittedDate = (c, v) => v != null && (typeof v !== 'string' || !c.X.vtypes.isVideoHomeworkDate(v) || v > c.today);
async function setVideoHomeworkMark(c, input) {
  const isDate = (v) => typeof v === 'string' && c.X.vtypes.isVideoHomeworkDate(v);
  if (!isDate(input.checkDate) || (input.homeworkDate !== null && !isDate(input.homeworkDate))) return { ok: false, error: '수업 날짜가 올바르지 않습니다.' };
  if (input.checkDate > c.today) return { ok: false, error: '미래 수업의 숙제는 검사할 수 없습니다.' };
  if (badSubmittedDate(c, input.submittedDate)) return { ok: false, error: '제출일은 오늘까지의 올바른 날짜로 입력해 주세요.' };
  if (input.homeworkDate && input.homeworkDate > input.checkDate) return { ok: false, error: '지난 숙제 날짜는 검사일보다 늦을 수 없습니다.' };
  if (!VH_STATUSES.includes(input.status)) return { ok: false, error: '유효하지 않은 상태입니다.' };
  if (![input.classId, input.studentId].every((v) => typeof v === 'string' && UUID_RE.test(v))) return { ok: false, error: '해당 반이나 학생을 찾을 수 없습니다.' };
  const denied = await videoHomeworkWriteError(c, input.classId, input.checkDate);
  if (denied) return { ok: false, error: denied };
  return writeCheckedMark(c, { classId: input.classId, studentId: input.studentId, checkDate: input.checkDate, homeworkDate: input.homeworkDate,
    submittedDate: input.submittedDate, status: input.status });
}
const BULK_MAX_CELLS = 300;
async function setVideoHomeworkMarksBulk(c, input) {
  const none = (error) => ({ ok: false, error, applied: [], failed: 0 });
  if (typeof input.checkDate !== 'string' || !c.X.vtypes.isVideoHomeworkDate(input.checkDate)) return none('수업 날짜가 올바르지 않습니다.');
  if (input.checkDate > c.today) return none('미래 수업의 숙제는 검사할 수 없습니다.');
  if (input.status !== 'submitted' && input.status !== 'missing') return none('유효하지 않은 상태입니다.');
  if (!Array.isArray(input.cells) || input.cells.length > BULK_MAX_CELLS) return none('한 번에 처리할 수 있는 칸 수를 넘었습니다.');
  const byKey = new Map();
  let failed = 0;
  for (const cell of input.cells) {
    const homeworkDate = cell?.homeworkDate ?? null;
    if (typeof cell?.classId !== 'string' || typeof cell?.studentId !== 'string' || !UUID_RE.test(cell.classId) || !UUID_RE.test(cell.studentId)
      || (homeworkDate !== null && (typeof homeworkDate !== 'string' || !c.X.vtypes.isVideoHomeworkDate(homeworkDate) || homeworkDate > input.checkDate))) { failed += 1; continue; }
    byKey.set(`${cell.classId}:${cell.studentId}`, { classId: cell.classId, studentId: cell.studentId, homeworkDate });
  }
  const cells = [...byKey.values()];
  if (!cells.length) return { ok: true, applied: [], failed };
  const classIds = [...new Set(cells.map((x) => x.classId))], allowed = new Set();
  for (const id of classIds) if (!(await videoHomeworkWriteError(c, id, input.checkDate))) allowed.add(id);
  const applied = [];
  // 한 칸씩 차례로(한 연결 · 저장점마다 — 한 칸의 실패가 다른 칸을 되돌리지 않게. 2.0은 6개씩 나란히, 칸마다 실패를 센다).
  for (const cell of cells) {
    if (!allowed.has(cell.classId)) { failed += 1; continue; }
    let result;
    try { result = await c.sql.savepoint((sp) => writeCheckedMark({ ...c, sql: sp }, { ...cell, checkDate: input.checkDate, status: input.status })); }
    catch { result = { ok: false }; }
    if (result.ok) applied.push({ classId: cell.classId, studentId: cell.studentId }); else failed += 1;
  }
  if (applied.length) await c.audit('lesson_report_video_homework_mark', 'video_homework',
    { bulk: true, checkDate: input.checkDate, status: input.status, count: applied.length, failed }, `원스크린 일괄 ${applied.length}건`);
  return { ok: true, applied, failed };
}

/**
 * 원스크린 화면 정의의 actions에 더할 저장(이름 = 2.0 함수 이름). `h` = 원스크린 모듈 도우미를 돌려주는 함수
 * { rules, copyDay, settingsOf, actAs, menuMatrix, teachingClassIds, taughtClassSet, runAttendance, VIA }.
 */
export function onescreenExtraActions(h) {
  const run = (fn) => async ({ sql, body, tenantId, importV2 }) => withActor(h, { sql, tenantId, importV2 }, body.actor, (c) => fn(c, body.input));
  return {
    linkMakeupToAbsence: { validate: call(ATTENDANCE), run: run(linkMakeupToAbsence) },
    setReservationReportMode: { validate: call(RESERVATION), run: run(setReservationReportMode) },
    moveReservationToRegular: { validate: call(RESERVATION), run: run(moveReservationToRegular) },
    checkMakeupReservation: { validate: call(RESERVATION), run: run(checkMakeupReservation) },
    setVideoHomeworkMark: { validate: call(VIDEO), run: run(setVideoHomeworkMark) },
    setVideoHomeworkMarksBulk: { validate: call(VIDEO), run: run(setVideoHomeworkMarksBulk) },
  };
}
