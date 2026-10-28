// 2.0 화면 · 강사 시트(ECS) — 저장 = 2.0 서버 액션("use server")과 1:1(원장 2026-10-28 "연습용이므로 모두 docker").
// 호스트(v2-host)의 2.0 부품이 부르는 함수 이름·인자 그대로 받아(POST /api/v2/ecs/<함수> · 본문 { module, actor, args })
// 같은 표·칸·DB 함수·감사로그(action 이름·metadata 칸)로 Docker 복사본에 쓰고, 2.0 함수의 반환 모양을 그대로 돌려준다.
// 저장하는 사람 = 3.0 띠에서 고른 직원(로그인 대신) — 그 사람으로 2.0 게이트(requireEcsClassAccess · 출결 권한 · 강사 7일 창)를 다시 잰다.
// 감사로그 metadata에는 via = '3.0 연습 복사본'이 붙는다(2.0이 via 칸을 쓰는 makeup_remove는 2.0 값을 from 칸으로 옮긴다).
// 2.0과 다른 것(이유):
//  · 알림(반 출결 완료·결석 확인·미출결 → 출석)·슬랙 깨우기는 만들지 않는다 — 저장 뒤 따로 도는 바깥 알림이라 연습 복사본에선 끈다.
//  · 보강 예약이 걸린 출결 칸은 저장하지 않는다 — 2.0은 같은 저장에서 예약 이행까지 바꾸는데 그 갈래를 옮기지 않았다(출석부 화면과 같은 규약).
//  · 지난 수업 내용 복사(copySlotFromPrevious)는 계획 줄만 — JJ실 기록 이어받기(carrySelfStudyMarks)는 아직 옮기지 않았다(carried = []).
//  · 보강 연동 표(makeups adapter)의 허용·차단(nativeWriteAllowance · mappedMakeupDeleteBlock)은 없다 — 복사본에 그 표 연동이 꺼져 있다.
//  · 연락처가 든 자유 글(가려서 보인 칸)은 화면 글이 가린 그대로면 원문을 지키고, 고쳐 쓰면 거절한다(가린 글자가 저장되지 않게).
import { z } from 'zod';
import { V2Error } from './v2-screens.mjs';
import { plannedLines } from './v2-ecs-props.mjs';
import { UUID, DAY, canWriteLevel, classAccess, copyDay, isoAt, isoDay, jjManagedClassIds, loadRules, masked, readSettings, readViewers, shown, skillAreaLabelOf } from './v2-ecs-core.mjs';

const VIA = '3.0 연습 복사본';
export const MODULE = {
  sheet: 'features/class-sheets/server/actions.ts', audit: 'features/class-sheets/server/edit-audit-actions.ts',
  monthPlan: 'features/class-sheets/server/month-plan-actions.ts', monthMemo: 'features/class-sheets/server/month-memo-actions.ts',
  attendance: 'features/attendance/server/actions.ts', dayPlan: 'features/class-sheets/server/day-plan.ts', compare: 'features/textbooks/server/compare-actions.ts',
  englishName: 'features/students/server/english-name.ts',
};
/** 2.0 english-name.ts `inputSchema` 원문 그대로(같은 zod — verify가 원문과 비교한다). */
const ENGLISH_NAME_INPUT = z.object({
  studentId: z.uuid(),
  englishName: z.string().trim().max(80).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)),
  previousEnglishName: z.string().max(1000).nullable(),
});
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
/** 호스트(shims/server-action.ts)가 보내는 모양 — 그 2.0 모듈의 그 함수가 아니면 받지 않는다(같은 이름이 다른 모듈에 있어도 섞이지 않게). */
function hostCall(raw, module, arity) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > arity) throw bad();
  if (typeof raw.actor !== 'string' || !UUID.test(raw.actor)) throw new V2Error(400, 'actor_missing', '저장하는 사람을 먼저 고르세요.');
  return { actor: raw.actor, args: raw.args };
}
/** 2.0 서버 액션 하나 — 인자 모양은 2.0 함수가 run 안에서 검사한다(같은 거절 문구를 같은 자리에서). */
export const serverFn = (module, arity, run) => ({
  module, arity,
  validate: raw => hostCall(raw, module, arity),
  async run({ sql, body, tenantId: t, importV2 }) {
    const R = await loadRules(importV2), env = await readSettings(sql, t, R);
    const user = (await readViewers(sql, t, R, env)).find(v => v.id === body.actor);
    if (!user) throw new V2Error(403, 'actor_not_allowed', '저장하는 사람을 다시 골라 주세요(강사 시트를 쓸 수 있는 재직 직원).');
    return run({ sql, t, R, env, user, today: await copyDay(), importV2 }, ...body.args);
  },
});
export const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const str = v => (typeof v === 'string' ? v : '');
/** 2.0 logAction과 같은 칸 — 행위자 = 고른 사람. */
export const audit = (sql, t, user, action, targetType, targetLabel, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${user.id}, ${user.name}, ${action}, ${targetType}, ${targetLabel ?? null}, ${sql.json({ ...metadata, via: VIA })})`;
/** DB 함수가 거절하면(예: 한 교시 20줄) 트랜잭션을 깨지 않고 2.0처럼 { ok:false, error }로 — 저장점 안에서 부른다. */
async function guarded(sql, fn) {
  try { return { ok: true, value: await sql.savepoint(fn) }; } catch (e) { return { ok: false, error: e }; }
}
const lineDTO = (R, row) => R.planLineFromRow({ ...row, id: String(row.id), plan_date: isoDay(row.plan_date), slot_start: String(row.slot_start), updated_at: isoAt(row.updated_at) });
const linesResult = (R, res) => (res.ok ? { ok: true, lines: res.value.map(r => lineDTO(R, r)) }
  : { ok: false, error: String(res.error?.message ?? '').includes('ECS_MAX_LINES') ? '한 교시에 담을 수 있는 줄 수(20)를 넘었습니다' : `저장에 실패했습니다: ${res.error?.message ?? ''}` });
const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const koDowOf = ymd => { const d = new Date(`${ymd}T00:00:00Z`); return Number.isNaN(d.getTime()) ? '?' : (KO_DOW[d.getUTCDay()] ?? '?'); };
const backdatedFlag = (dates, today) => (dates.some(d => d < today) ? { backdated: true } : {});
/** 가려서 보인 원문 지키기 — 화면 글이 가린 그대로면 원문을, 고쳐 쓰면 거절(null = 가린 칸이 아님). */
function keepRaw(raw, incoming) {
  if (!masked(raw)) return { value: incoming };
  if ((incoming ?? null) === (shown(raw) ?? null)) return { value: raw };
  return { error: '연락처가 든 글이라 연습 화면에서는 고치지 않습니다.' };
}

// ── 계획 줄 — 2.0 actions.ts 껍데기 + plan-write.ts 밑바닥 ───────────────────────────────────────────
async function assertLineInClass(sql, t, classId, lineId) {
  const [row] = await sql`select id::text id, class_id::text class_id, plan_date, slot_start::text slot_start from public.class_sheet_plan_lines where tenant_id=${t} and id=${lineId}`;
  if (!row) return { ok: false, code: 'gone', error: '행을 찾을 수 없습니다(다른 사용자가 삭제했을 수 있음)' };
  if (row.class_id !== classId) return { ok: false, code: 'foreign', error: '다른 반의 행입니다' };
  return { ok: true, row };
}
/** 2.0 `checkStudentEligibleOn` — 그날 실수강 · 그날 출결 있음 · 보강 예약 · 수업 나누기(복사본 0행). */
async function checkStudentEligibleOn(sql, t, R, classId, studentId, date) {
  if (!UUID.test(str(studentId))) return { ok: false, error: '그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)' };
  const enrs = await sql`select e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, s.withdrawn_at::text withdrawn_at
    from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${t} and e.class_id=${classId} and e.student_id=${studentId}`;
  const dow = R.dowKeyOf(date);
  const eligible = enrs.some(e => !(e.withdrawn_at && e.withdrawn_at < date)
    && R.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date ?? null, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined }, date)
    && R.enrollmentAttendsOnDay(e.attendance_days, dow));
  if (eligible) return { ok: true };
  const [{ n, resv, split }] = await sql`select (select count(*)::int from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${date}) n,
    exists (select 1 from public.makeup_reservations where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and makeup_date=${date} and status in ('reserved','done')) resv,
    exists (select 1 from public.class_splits where tenant_id=${t} and target_class_id=${classId} and student_id=${studentId} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date})) split`;
  if (n > 0 || resv || split) return { ok: true };
  return { ok: false, error: '그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)' };
}
/** 2.0 `resolveAutoUnits` — 그 교시의 수업 길이로 정한 시수(수업 길이 프로필이 켜진 학원만). */
async function resolveAutoUnits(sql, t, R, env, classId, date, slot) {
  if (!R.lessonProfileOf({ preset: env.preset }).autoUnits) return null;
  const [[cls], sch] = await Promise.all([
    sql`select id::text id, subject, english_track, class_name from public.classes where tenant_id=${t} and id=${classId}`,
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, lab_separate
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from<=${date} and (valid_to is null or valid_to>=${date}) order by id`,
  ]);
  if (!cls) return null;
  const track = cls.english_track === 'eie' || cls.english_track === 'injaewon' ? cls.english_track : null;
  const plan = R.planAutoUnits([{ classId, date, slotStart: slot }], new Map([[classId, cls.subject ?? null]]), new Map([[classId, sch.map(x => R.toAutoUnitsSchedule(x))]]),
    new Map([[classId, track]]), new Map([[classId, cls.class_name]]));
  return plan.get(R.autoUnitsKey(classId, date, slot)) ?? null;
}
/** 2.0 `userTaughtClassSet`(write-policy)의 한 반 — 담임 ∪ 그날 위임 ∪ 그날 JJ 보고서 담당 반(getTeachingClassIds) ∪ 그날 교시 담당.
 *  ctx = { R, env } — JJ 담당 갈래(학원 설정 명단)를 볼 때 쓴다. */
export async function teachesOn(sql, t, userId, classId, date, { R, env }) {
  const [{ ok }] = await sql`select (exists (select 1 from public.classes where tenant_id=${t} and id=${classId} and teacher_id=${userId})
      or exists (select 1 from public.class_delegations where tenant_id=${t} and class_id=${classId} and delegate_user_id=${userId} and revoked_at is null and from_date <= ${date} and to_date >= ${date})
      or exists (select 1 from public.class_schedules where tenant_id=${t} and class_id=${classId} and teacher_id=${userId} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date}))) ok`;
  return ok || (await jjManagedClassIds(sql, t, R, env, userId, date)).includes(classId);
}
/** 2.0 `makeupAnchorDeleteBlock` — 보강 보고서가 가리키는 반의 칸은 지우지 않는다. */
async function makeupAnchorDeleteBlock(sql, t, studentId, classId, date) {
  const [hit] = await sql`select classnote_status, classnote_sent_at from public.lesson_reports where tenant_id=${t} and makeup and class_id is null and student_id=${studentId} and makeup_class_id=${classId} and report_date=${date} limit 1`;
  if (!hit) return null;
  return hit.classnote_sent_at || hit.classnote_status === 'success'
    ? '이 칸은 학부모에게 발송된 보강 보고서의 반입니다 — 지울 수 없습니다(보고서와 출석부 반이 갈라집니다)'
    : "이 칸은 보강 보고서가 가리키는 반입니다 — 원스크린에서 '보강 빼기'로 보고서와 함께 지우거나, 보강 반을 바꿔 주세요";
}
/** 2.0 `patchMyUiPrefs("ecs", patch)` — 내 계정의 ecs 칸만 갈아끼운다(형제 키 보존, undefined = 키 지움). */
export async function patchMyEcsPrefs(sql, t, user, patch) {
  const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${user.id}`;
  const raw = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
  const scope = raw.ecs && typeof raw.ecs === 'object' && !Array.isArray(raw.ecs) ? { ...raw.ecs } : {};
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete scope[k]; else scope[k] = v; }
  const merged = { ...raw }; if (Object.keys(scope).length === 0) delete merged.ecs; else merged.ecs = scope;
  await sql`update public.users set ui_prefs=${sql.json(merged)} where tenant_id=${t} and id=${user.id}`;
  return { ok: true };
}

// ── 읽기 전용 서버 액션(2.0도 서버 액션으로 읽는다 — 월간의 '그 날 고치기' 창 · 교시 칸 [계획 비교]) ──
// 호스트(ecs.tsx)는 이 둘을 저장 경로(POST)가 아니라 화면 읽기(GET ?read=…)로 묻는다(시간표 loadExitOverlay와 같은 규약 — 보기는 쓰기 기록에
// 남지 않는다). 같은 함수를 screen.load와 ACTIONS가 함께 쓴다(다른 화면이 같은 2.0 함수를 POST로 이어도 같은 답).
/** getEcsDayPlan({ classId, planDate }) — 그 날의 계획 줄(교시별) + 미루기 표식. ctx = { sql, t, R, env, user }. */
export async function readDayPlan({ sql, t, R, env, user }, raw) {
  const input = obj(raw);
  if (!R.YMD_RE.test(str(input.planDate))) return { ok: false, error: '날짜가 올바르지 않습니다' };
  const gate = await classAccess(sql, t, R, env, user, str(input.classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  const c = gate.access.classId;
  const [rows, shifts] = await Promise.all([
    sql`select * from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${c} and plan_date=${input.planDate} order by slot_start, term_mode, line_no, id`,
    sql`select plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos from public.class_lesson_shifts where tenant_id=${t} and class_id=${c} and plan_date=${input.planDate}`,
  ]);
  const markers = {}; for (const r of shifts) markers[R.markerKeyOfRow(r)] = String(r.kind) === 'advance' ? 'advance' : 'skip';
  const shiftBySlot = {}; for (const [key, kind] of Object.entries(R.cellShiftSummary(markers))) shiftBySlot[R.normalizeSlotTime(key.slice(11))] = kind;
  const linesBySlot = {}; for (const row of rows) { const dto = lineDTO(R, row); (linesBySlot[R.normalizeSlotTime(dto.slotStart)] ??= []).push(dto); }
  return { ok: true, data: { tenantId: t, userId: user.id, weekMonday: R.mondayOf(input.planDate), canEdit: gate.access.canWrite, showExamTerm: gate.access.englishTrack !== 'eie',
    skillAreas: gate.access.skillAreas, linesBySlot, shiftBySlot } };
}
/** getSlotPlanCompare({ classId, date, slotStart }) — 원래 월간계획 ↔ 실제(평시) 한 칸 비교(2.0 compareCell). ctx = { sql, t, R, env, user, today }. */
export async function readSlotCompare({ sql, t, R, env, user, today }, raw) {
  const input = obj(raw);
  if (!R.YMD_RE.test(str(input.date))) return { ok: false, error: '날짜가 올바르지 않습니다' };
  const slot = String(input.slotStart ?? '').slice(0, 5);
  if (!/^[0-2]\d:[0-5]\d$/.test(slot)) return { ok: false, error: '교시가 올바르지 않습니다' };
  const gate = await classAccess(sql, t, R, env, user, str(input.classId));
  if (!gate.ok) return { ok: false, error: gate.error };
  const c = gate.access.classId;
  const [planned, actualRows] = await Promise.all([plannedLines(sql, t, R, env, c, input.date, input.date),
    sql`select skill_area, textbook, progress, homework, line_no from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${c} and plan_date=${input.date} and slot_start=${slot} and term_mode='regular' order by line_no limit 100`]);
  const key = `${input.date}|${slot}`, baseline = planned.baselineByCell[key] ?? [];
  const actual = actualRows.map(r => ({ skillArea: String(r.skill_area), textbook: r.textbook ?? null, progress: r.progress ?? null, homework: r.homework ?? null }));
  return { ok: true, baseline, scheduled: planned.byCell[key] ?? [], actual, compare: R.compareCell({ baseline, actual, lessonIndex: planned.lessonIndex, isFuture: input.date > today }), shift: planned.shiftByCell[key] ?? null };
}

export const ACTIONS = {
  getEcsDayPlan: serverFn(MODULE.dayPlan, 1, readDayPlan),
  getSlotPlanCompare: serverFn(MODULE.compare, 1, readSlotCompare),

  /** flushSheetPatches(classId, rawPatches) — 계획 칸 필드 CAS(2.0 applyPlanPatches). 감사는 commitSheetEdits가 남긴다. */
  flushSheetPatches: serverFn(MODULE.sheet, 2, async ({ sql, t, R, env, user }, classId, rawPatches) => {
    const gate = await classAccess(sql, t, R, env, user, str(classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    const parsed = R.validatePatchBatch(rawPatches);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const ids = [...new Set(parsed.patches.map(p => p.lineId))];
    const own = await sql`select id::text id, class_id::text class_id from public.class_sheet_plan_lines where tenant_id=${t} and id = any(${ids}::uuid[])`;
    if (own.some(r => r.class_id !== gate.access.classId)) return { ok: false, error: '다른 반의 행이 섞여 있어 저장을 거부했습니다' };
    const found = new Set(own.map(r => r.id)), results = [];
    for (const p of parsed.patches) {
      if (!found.has(p.lineId)) { results.push({ saveKey: p.saveKey, status: 'gone', clientRev: p.clientRev }); continue; }
      const expected = R.normalizePlanText(p.expectedValue), next = R.normalizePlanText(p.newValue), col = sql(p.field);
      if (p.field === 'skill_area' && (next === null || !R.SKILL_AREA_SLUG_RE.test(next))) { results.push({ saveKey: p.saveKey, status: 'error', clientRev: p.clientRev, error: '영역 값이 올바르지 않습니다' }); continue; }
      const updated = expected === null
        ? await sql`update public.class_sheet_plan_lines set ${col} = ${next}, updated_by = ${user.id} where tenant_id=${t} and class_id=${gate.access.classId} and id=${p.lineId} and ${col} is null returning id`
        : await sql`update public.class_sheet_plan_lines set ${col} = ${next}, updated_by = ${user.id} where tenant_id=${t} and class_id=${gate.access.classId} and id=${p.lineId} and ${col} = ${expected} returning id`;
      if (updated.length) { results.push({ saveKey: p.saveKey, status: 'applied', clientRev: p.clientRev }); continue; }
      const [cur] = await sql`select ${col} v from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${gate.access.classId} and id=${p.lineId}`;
      if (!cur) { results.push({ saveKey: p.saveKey, status: 'gone', clientRev: p.clientRev }); continue; }
      const serverValue = R.normalizePlanText(cur.v ?? null);
      results.push(serverValue === next ? { saveKey: p.saveKey, status: 'already_applied', clientRev: p.clientRev } : { saveKey: p.saveKey, status: 'conflict', clientRev: p.clientRev, serverValue });
    }
    return { ok: true, results };
  }),
  /** createPlanLine(input) — DB 함수 ecs_create_plan_line + ecs_plan_line_add. */
  createPlanLine: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.planDate)) || !R.HHMM_RE.test(str(input.slotStart))) return { ok: false, error: '잘못된 요청입니다(날짜/시각)' };
    if (input.termMode !== 'regular' && input.termMode !== 'exam') return { ok: false, error: '잘못된 요청입니다(시기)' };
    if (!R.SKILL_AREA_SLUG_RE.test(str(input.skillArea))) return { ok: false, error: '잘못된 요청입니다(영역)' };
    const res = linesResult(R, await guarded(sql, s => s`select * from public.ecs_create_plan_line(${t}::uuid, ${user.id}::uuid, ${gate.access.classId}::uuid, ${input.planDate}::date, ${input.slotStart}::time, ${input.termMode}::text, ${input.skillArea}::text)`));
    if (res.ok) await audit(sql, t, user, 'ecs_plan_line_add', 'class_sheet_plan', null, { classId: gate.access.classId, planDate: input.planDate, slotStart: input.slotStart, termMode: input.termMode, skillArea: input.skillArea });
    return res;
  }),
  /** movePlanLine(input) — ecs_move_plan_line(줄 번호 1~20) + ecs_plan_line_move. */
  movePlanLine: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (input.termMode !== 'regular' && input.termMode !== 'exam') return { ok: false, error: '잘못된 요청입니다(시기)' };
    if (!UUID.test(str(input.lineId))) return { ok: false, error: '행을 찾을 수 없습니다(다른 사용자가 삭제했을 수 있음)' };
    const own = await assertLineInClass(sql, t, gate.access.classId, input.lineId);
    if (!own.ok) return { ok: false, error: own.error };
    const lineNo = Math.max(1, Math.min(20, Math.round(Number(input.lineNo) || 1)));
    const res = linesResult(R, await guarded(sql, s => s`select * from public.ecs_move_plan_line(${t}::uuid, ${user.id}::uuid, ${input.lineId}::uuid, ${input.termMode}::text, ${lineNo}::smallint)`));
    if (res.ok) await audit(sql, t, user, 'ecs_plan_line_move', 'class_sheet_plan', null, { classId: gate.access.classId, lineId: input.lineId, termMode: input.termMode, lineNo });
    return res;
  }),
  /** deletePlanLine(input) — ecs_delete_plan_line + ecs_plan_line_delete. 이미 없는 줄은 멱등 성공. */
  deletePlanLine: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!UUID.test(str(input.lineId))) return { ok: true, lines: [] };
    const own = await assertLineInClass(sql, t, gate.access.classId, input.lineId);
    if (!own.ok) return own.code === 'foreign' ? { ok: false, error: own.error } : { ok: true, lines: [] };
    const res = linesResult(R, await guarded(sql, s => s`select * from public.ecs_delete_plan_line(${t}::uuid, ${input.lineId}::uuid)`));
    if (res.ok) await audit(sql, t, user, 'ecs_plan_line_delete', 'class_sheet_plan', null, { classId: gate.access.classId, lineId: input.lineId, planDate: isoDay(own.row.plan_date), slotStart: own.row.slot_start.slice(0, 5) });
    return res;
  }),
  /** copyWeekFromPrevious(input) — ecs_copy_week(지난주 → 이번 주, 빈 칸만) + ecs_week_copy. */
  copyWeekFromPrevious: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.weekMonday))) return { ok: false, error: '잘못된 요청입니다(주차)' };
    const to = R.mondayOf(input.weekMonday), from = R.shiftDays(to, -7);
    const res = await guarded(sql, s => s`select public.ecs_copy_week(${t}::uuid, ${user.id}::uuid, ${gate.access.classId}::uuid, ${from}::date, ${to}::date) r`);
    if (!res.ok) return { ok: false, error: `지난주 복사에 실패했습니다: ${res.error?.message ?? ''}` };
    const r = res.value[0]?.r ?? {};
    if ((r.copied ?? 0) > 0 || (r.goalsCopied ?? 0) > 0) await audit(sql, t, user, 'ecs_week_copy', 'class_sheet', gate.access.className, { classId: gate.access.classId, fromMonday: from, weekStart: to,
      copied: r.copied ?? 0, goalsCopied: r.goalsCopied ?? 0, skippedSlots: r.skippedSlots?.length ?? 0, unmapped: r.unmapped?.length ?? 0 });
    return { ok: true, copied: r.copied ?? 0, goalsCopied: r.goalsCopied ?? 0, skippedSlots: r.skippedSlots ?? [], unmapped: r.unmapped ?? [] };
  }),
  /** copySlotFromPrevious(input) — ecs_copy_slot(같은 교시의 지난 수업, 빈 칸만) + ecs_plan_copy. */
  copySlotFromPrevious: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.planDate)) || !R.HHMM_RE.test(str(input.slotStart))) return { ok: false, error: '잘못된 요청입니다(날짜/시각)' };
    if (input.termMode !== 'regular' && input.termMode !== 'exam') return { ok: false, error: '잘못된 요청입니다(시기)' };
    const res = await guarded(sql, s => s`select public.ecs_copy_slot(${t}::uuid, ${user.id}::uuid, ${gate.access.classId}::uuid, ${input.planDate}::date, ${input.slotStart}::time, ${input.termMode}::text) r`);
    if (!res.ok) return { ok: false, error: `내용 복사에 실패했습니다: ${res.error?.message ?? ''}` };
    const r = res.value[0]?.r ?? {}, carried = [];
    if ((r.copied ?? 0) > 0) await audit(sql, t, user, 'ecs_plan_copy', 'class_sheet_plan', null, { classId: gate.access.classId, planDate: input.planDate, slotStart: input.slotStart,
      termMode: input.termMode, copied: r.copied ?? 0, sourceDate: r.sourceDate ?? null, carried: 0 });
    return { ok: true, copied: r.copied ?? 0, sourceLabel: r.sourceDate ? `${r.sourceDate.slice(5)}(${koDowOf(r.sourceDate)})` : null, truncated: r.truncated ?? 0,
      sameDow: typeof r.sameDow === 'boolean' ? r.sameDow : null, reason: r.reason ?? null, lines: (r.lines ?? []).map(l => lineDTO(R, l)),
      carried, carrySummary: R.carrySummary(carried), carryPending: false, carryError: null };
  }),
  /** upsertGoal(input) — 담임/부담임 × 월간/주간 × 영역의 교재명·목표 진도(둘 다 비면 행 삭제). 감사는 commitSheetEdits. */
  upsertGoal: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (input.scope !== 'month' && input.scope !== 'week') return { ok: false, error: '잘못된 요청입니다(기간)' };
    if (input.role !== 'homeroom' && input.role !== 'assistant') return { ok: false, error: '잘못된 요청입니다(역할)' };
    if (!R.YMD_RE.test(str(input.periodStart))) return { ok: false, error: '잘못된 요청입니다(기간 시작일)' };
    if (!R.SKILL_AREA_SLUG_RE.test(str(input.skillArea))) return { ok: false, error: '잘못된 요청입니다(영역)' };
    if (!R.isGoalAreaAllowed(gate.access.englishTrack, gate.access.skillAreas, input.skillArea)) return { ok: false, error: '이 반의 목표 항목이 아닙니다(반 구분이 바뀌었으면 새로고침하세요)' };
    const periodStart = R.normalizePeriodStart(input.scope, input.periodStart), textbook = R.normalizePlanText(input.textbook ?? null), targetProgress = R.normalizePlanText(input.targetProgress ?? null);
    if ((textbook?.length ?? 0) > 500 || (targetProgress?.length ?? 0) > 500) return { ok: false, error: '입력이 너무 깁니다(500자 이내)' };
    const c = gate.access.classId;
    if (textbook === null && targetProgress === null) {
      await sql`delete from public.class_sheet_goals where tenant_id=${t} and class_id=${c} and scope=${input.scope} and period_start=${periodStart} and role=${input.role} and skill_area=${input.skillArea}`;
      return { ok: true };
    }
    await sql`insert into public.class_sheet_goals (tenant_id, class_id, scope, period_start, role, skill_area, textbook, target_progress, updated_by, updated_at)
      values (${t}, ${c}, ${input.scope}, ${periodStart}, ${input.role}, ${input.skillArea}, ${textbook}, ${targetProgress}, ${user.id}, now())
      on conflict (tenant_id, class_id, scope, period_start, role, skill_area) do update set textbook=excluded.textbook, target_progress=excluded.target_progress, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
    return { ok: true };
  }),
  /** upsertStudentMark(input) — 학생 기록 칸(태도·특이사항 + 넘긴 자유 칸만). 다 비면 빈 행을 지운다. 감사는 commitSheetEdits. */
  upsertStudentMark: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.markDate)) || !R.HHMM_RE.test(str(input.slotStart))) return { ok: false, error: '잘못된 요청입니다(날짜/시각)' };
    const status = R.normalizePlanText(input.status ?? null);
    let progressNote = R.normalizePlanText(input.progressNote ?? null);
    if ((status?.length ?? 0) > 50) return { ok: false, error: '상태는 50자 이내로 입력하세요' };
    if ((progressNote?.length ?? 0) > 500) return { ok: false, error: '입력이 너무 깁니다(500자 이내)' };
    const TEXT = { score: ['score', '시험 점수'], listeningLevel: ['listening_level', '듣기 레벨'], memorizedWords: ['memorized_words', '누적 암기 단어수'] }, text = {};
    for (const [key, [col, label]] of Object.entries(TEXT)) {
      if (input[key] === undefined) continue;
      const value = R.normalizePlanText(input[key]);
      if ((value?.length ?? 0) > 30) return { ok: false, error: `${label}은(는) 30자 이내로 입력하세요` };
      text[col] = value;
    }
    if (!UUID.test(str(input.studentId))) return { ok: false, error: '그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)' };
    const c = gate.access.classId;
    const [prev] = await sql`select progress_note from public.class_sheet_student_marks where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and mark_date=${input.markDate} and slot_start=${input.slotStart}`;
    const kept = keepRaw(prev?.progress_note ?? null, progressNote);
    if (kept.error) return { ok: false, error: kept.error };
    progressNote = kept.value;
    const looksEmpty = status === null && progressNote === null && Object.values(text).every(v => v === null);
    if (!looksEmpty) { const elig = await checkStudentEligibleOn(sql, t, R, c, input.studentId, input.markDate); if (!elig.ok) return elig; }
    const row = { tenant_id: t, class_id: c, student_id: input.studentId, mark_date: input.markDate, slot_start: input.slotStart, status, progress_note: progressNote, updated_by: user.id, updated_at: new Date(), ...text };
    await sql`insert into public.class_sheet_student_marks ${sql(row)} on conflict (tenant_id, class_id, student_id, mark_date, slot_start) do update set
      ${sql(Object.fromEntries(Object.keys(row).filter(k => !['tenant_id', 'class_id', 'student_id', 'mark_date', 'slot_start'].includes(k)).map(k => [k, row[k]])))}`;
    if (looksEmpty) await sql`delete from public.class_sheet_student_marks where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and mark_date=${input.markDate} and slot_start=${input.slotStart}
      and status is null and progress_note is null and score is null and listening_level is null and memorized_words is null`;
    return { ok: true };
  }),
  /** saveMemo(input) — 주간 메모(빈 글 = 행 삭제). 감사는 commitSheetEdits. */
  saveMemo: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.weekStart))) return { ok: false, error: '잘못된 요청입니다(주차)' };
    const weekStart = R.mondayOf(input.weekStart);
    if (!R.MEMO_KEY_RE.test(str(input.memoKey))) return { ok: false, error: '잘못된 요청입니다(메모 위치)' };
    const embedded = /(\d{4}-\d{2}-\d{2})/.exec(input.memoKey)?.[1];
    if (embedded && (embedded < weekStart || embedded > R.shiftDays(weekStart, 6))) return { ok: false, error: '잘못된 요청입니다(메모 날짜가 주 범위 밖)' };
    let body = str(input.body).trim();
    if (body.length > 2000) return { ok: false, error: '메모는 2000자 이내로 입력하세요' };
    const c = gate.access.classId;
    const [prev] = await sql`select body from public.class_sheet_memos where tenant_id=${t} and class_id=${c} and week_start=${weekStart} and memo_key=${input.memoKey}`;
    const kept = keepRaw(prev?.body ?? null, body === '' ? null : body);
    if (kept.error) return { ok: false, error: kept.error };
    body = kept.value ?? '';
    if (body === '') { await sql`delete from public.class_sheet_memos where tenant_id=${t} and class_id=${c} and week_start=${weekStart} and memo_key=${input.memoKey}`; return { ok: true }; }
    await sql`insert into public.class_sheet_memos (tenant_id, class_id, week_start, memo_key, body, updated_by, updated_at) values (${t}, ${c}, ${weekStart}, ${input.memoKey}, ${body}, ${user.id}, now())
      on conflict (tenant_id, class_id, week_start, memo_key) do update set body=excluded.body, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
    return { ok: true };
  }),
  /** setSlotShouting(input) — EiE 반만. 해제 = 행 삭제. 바뀐 때만 ecs_shouting_toggle. */
  setSlotShouting: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (gate.access.englishTrack !== 'eie') return { ok: false, error: 'Shouting 체크는 EiE 반에서만 사용합니다' };
    if (!R.YMD_RE.test(str(input.date)) || !R.HHMM_RE.test(str(input.slotStart))) return { ok: false, error: '잘못된 요청입니다(날짜·교시)' };
    const c = gate.access.classId, log = checked => audit(sql, t, user, 'ecs_shouting_toggle', 'class_sheet', gate.access.className, { classId: c, date: input.date, slotStart: input.slotStart.slice(0, 5), checked });
    if (!input.value) {
      const removed = await sql`delete from public.class_sheet_slot_flags where tenant_id=${t} and class_id=${c} and flag_date=${input.date} and slot_start=${input.slotStart} returning id`;
      if (removed.length) await log(false);
      return { ok: true };
    }
    const [existed] = await sql`select id from public.class_sheet_slot_flags where tenant_id=${t} and class_id=${c} and flag_date=${input.date} and slot_start=${input.slotStart}`;
    await sql`insert into public.class_sheet_slot_flags (tenant_id, class_id, flag_date, slot_start, shouting, updated_by, updated_at) values (${t}, ${c}, ${input.date}, ${input.slotStart}, true, ${user.id}, now())
      on conflict (tenant_id, class_id, flag_date, slot_start) do update set shouting=true, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
    if (!existed) await log(true);
    return { ok: true };
  }),
  /** removeMakeupAttendee(input) — 보강 명단에서 빼기(수강생이 아닌 행만) = 그날 출결 + 태도 기록 삭제 + makeup_remove. */
  removeMakeupAttendee: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user, today }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.date)) || !UUID.test(str(input.studentId))) return { ok: false, error: '잘못된 요청입니다' };
    if (!canWriteLevel(user.levels.attendance)) return { ok: false, error: '출석 입력 권한이 없습니다' };
    if (user.systemRole === 'teacher' && !R.isWithinAttendanceEditWindow(input.date, today)) return { ok: false, error: R.attendanceLockMessage(input.date, today) };
    const c = gate.access.classId, dow = R.dowKeyOf(input.date);
    const enrs = await sql`select e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, s.withdrawn_at::text withdrawn_at
      from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${t} and e.class_id=${c} and e.student_id=${input.studentId}`;
    if (enrs.some(e => !(e.withdrawn_at && e.withdrawn_at < input.date) && R.isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date ?? null, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined }, input.date)
      && R.enrollmentAttendsOnDay(e.attendance_days, dow))) return { ok: false, error: '이 반 수강생입니다 — 보강 명단에서 빼는 대상이 아닙니다' };
    const [{ n }] = await sql`select count(*)::int n from public.attendance_records where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and session_date=${input.date}`;
    if (n === 0) return { ok: false, error: '보강 출결 기록이 없습니다' };
    const anchored = await makeupAnchorDeleteBlock(sql, t, input.studentId, c, input.date);
    if (anchored) return { ok: false, error: anchored };
    await sql`delete from public.attendance_records where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and session_date=${input.date}`;
    await sql`delete from public.class_sheet_student_marks where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and mark_date=${input.date}`;
    await audit(sql, t, user, 'makeup_remove', 'student', null, { studentId: input.studentId, classId: c, date: input.date, attendanceRemoved: true, attendanceRows: n, from: 'ecs' });
    return { ok: true };
  }),
  /** markPresentIfAbsent(input) — 빈 칸만 출석(ecs_mark_present_if_absent) + 새로 만든 때만 ecs_attendance_mark. */
  markPresentIfAbsent: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user, today }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId));
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.date))) return { ok: false, error: '잘못된 요청입니다(날짜)' };
    if (!canWriteLevel(user.levels.attendance)) return { ok: false, error: '출석 입력 권한이 없습니다' };
    if (user.systemRole === 'teacher' && !R.isWithinAttendanceEditWindow(input.date, today)) return { ok: false, error: R.attendanceLockMessage(input.date, today) };
    const c = gate.access.classId, elig = await checkStudentEligibleOn(sql, t, R, c, input.studentId, input.date);
    if (!elig.ok) return elig;
    const [{ before }] = await sql`select count(*)::int before from public.attendance_records where tenant_id=${t} and class_id=${c} and student_id=${input.studentId} and session_date=${input.date}`;
    const res = await guarded(sql, s => s`select id::text id, status::text status, recorded_at, recorded_by::text recorded_by from public.ecs_mark_present_if_absent(${t}::uuid, ${user.id}::uuid, ${c}::uuid, ${input.studentId}::uuid, ${input.date}::date)`);
    if (!res.ok) return { ok: false, error: `출석 저장에 실패했습니다: ${res.error?.message ?? ''}` };
    const rows = res.value.map(r => ({ ...r, recorded_at: isoAt(r.recorded_at) })), only = rows.length === 1 ? rows[0] : null;
    if (before === 0 && only && only.recorded_by === user.id) await audit(sql, t, user, 'ecs_attendance_mark', 'attendance', null, { classId: c, studentId: input.studentId, date: input.date, status: only.status });
    const eff = rows.reduce((acc, r) => (!acc || r.recorded_at > acc.recorded_at || (r.recorded_at === acc.recorded_at && r.id > acc.id) ? r : acc), null);
    return { ok: true, status: eff?.status ?? 'present' };
  }),
  /** clearPresentAttendance(input) — '선택 안 함' = ecs_clear_present(손 안 댄 출석만, 그 교시 자동 시수 포함) + ecs_attendance_clear. */
  clearPresentAttendance: serverFn(MODULE.sheet, 1, async ({ sql, t, R, env, user, today }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId));
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!R.YMD_RE.test(str(input.date)) || !UUID.test(str(input.studentId))) return { ok: false, error: '잘못된 요청입니다(날짜)' };
    if (!canWriteLevel(user.levels.attendance)) return { ok: false, error: '출석 입력 권한이 없습니다' };
    if (user.systemRole === 'teacher' && !R.isWithinAttendanceEditWindow(input.date, today)) return { ok: false, error: R.attendanceLockMessage(input.date, today) };
    const c = gate.access.classId, slot = input.slot && R.HHMM_RE.test(String(input.slot).slice(0, 5)) ? String(input.slot) : null;
    const auto = slot ? await resolveAutoUnits(sql, t, R, env, c, input.date, slot) : (typeof input.autoUnits === 'number' ? input.autoUnits : null);
    const res = await guarded(sql, s => s`select public.ecs_clear_present(${t}::uuid, ${user.id}::uuid, ${c}::uuid, ${input.studentId}::uuid, ${input.date}::date, ${auto}::numeric, ${slot}::time) r`);
    if (!res.ok) return { ok: false, error: `출석 취소에 실패했습니다: ${res.error?.message ?? ''}` };
    const r = res.value[0]?.r ?? {};
    if (r.blocked === 'rich') return { ok: false, error: '결석·지각이거나 출석부에서 사유·시수를 적어 둔 기록입니다 — 출석부에서 수정하세요' };
    if ((r.cleared ?? 0) > 0) {
      const [stu] = await sql`select name from public.students where tenant_id=${t} and id=${input.studentId}`;
      await audit(sql, t, user, 'ecs_attendance_clear', 'attendance', stu?.name ?? null, { classId: c, date: input.date, rows: r.cleared });
    }
    return { ok: true, cleared: r.cleared ?? 0 };
  }),
  /** setAttendanceCell(input) — 2.0 출결 저장의 **교시 칸 갈래**(ECS가 보내는 slotStart 지정 저장). 그날 전체 칸은 출석부 화면 몫. */
  setAttendanceCell: serverFn(MODULE.attendance, 1, async ({ sql, t, R, env, user, today }, raw) => {
    const input = obj(raw);
    if (!canWriteLevel(user.levels.attendance)) return { error: '출석 관리 권한이 없습니다' };
    const { studentId, classId, sessionDate, status } = input;
    const noteOnly = input.noteOnly === true, noteProvided = input.note !== undefined;
    let noteVal = (typeof input.note === 'string' ? input.note : '').trim() || null;
    if (!studentId || !classId || !sessionDate) return { error: '필수 값이 누락되었습니다' };
    if (!UUID.test(str(studentId)) || !UUID.test(str(classId)) || !DAY.test(str(sessionDate))) return { error: '필수 값이 누락되었습니다' };
    if (noteOnly && !noteProvided) return { error: '메모가 없습니다' };
    if (!noteOnly && status !== null && !['present', 'absent', 'late', 'excused', 'makeup', 'early_leave'].includes(status)) return { error: '잘못된 상태입니다' };
    if (!input.slotStart || !R.HHMM_RE.test(String(input.slotStart).slice(0, 5)) || input.source || input.onlyIfEmpty || input.ghostTransfer || input.scopeTeacherId != null) {
      throw new V2Error(409, 'not_in_copy', '이 저장 방식(그날 전체 칸·당일 출결·다른 선생님 교시)은 연습 화면에서 아직 지원하지 않습니다. 바뀐 것은 없습니다.');
    }
    const unitsProvided = input.units !== undefined;
    let unitsVal = null;
    if (unitsProvided) { const parsed = R.parseSessionUnits(input.units); if (!parsed.ok) return { error: parsed.error }; unitsVal = parsed.value; }
    if (user.levels.attendance === 'scoped') {
      if (!noteOnly && !R.isWithinAttendanceEditWindow(sessionDate, today)) return { error: R.attendanceLockMessage(sessionDate, today) };
      const [teaching, [{ enrolled, existing, resv }]] = await Promise.all([teachesOn(sql, t, user.id, classId, sessionDate, { R, env }),
        sql`select (select count(*)::int from public.enrollments where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and (start_date is null or start_date <= ${sessionDate}) and (end_date is null or end_date >= ${sessionDate})) enrolled,
          (select count(*)::int from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate}) existing,
          exists (select 1 from public.makeup_reservations where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and makeup_date=${sessionDate} and status in ('reserved','done')) resv`]);
      if (!teaching) return { error: '담당 반이 아닙니다' };
      // 보강 추가(allowMakeup) · 보강 예약 — 2.0처럼 강사의 수강생 게이트에만 쓴다(수업 나누기는 복사본 0행).
      if (!R.canWriteAttendanceStudent({ enrolled: enrolled > 0, hasRecord: existing > 0, allowMakeup: input.allowMakeup === true || (enrolled === 0 && existing === 0 && resv) })) return { error: '이 반 수강생이 아닙니다' };
    }
    const [resvCell] = await sql`select 1 from public.makeup_reservations where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and makeup_date=${sessionDate} and status in ('reserved','done') limit 1`;
    if (resvCell) throw new V2Error(409, 'reservation_cell', '보강 예약이 걸린 칸은 연습 화면에서 아직 저장하지 않습니다. 바뀐 것은 없습니다.');
    const slot = String(input.slotStart), via = (await teachesOn(sql, t, user.id, classId, sessionDate, { R, env })) ? 'teacher' : 'desk';
    const base = { studentId, classId, date: sessionDate, slotStart: slot };
    if (noteOnly) {
      const [row] = await sql`select id::text id, note from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate} and slot_start=${slot} order by recorded_at desc limit 1`;
      if (!row) return { error: '그날 출결 기록이 없어 메모만 남길 수 없습니다 — 먼저 출결을 입력하세요' };
      const kept = keepRaw(row.note ?? null, noteVal); if (kept.error) return { error: kept.error }; noteVal = kept.value;
      await sql`update public.attendance_records set note=${noteVal} where id=${row.id}`;
      await audit(sql, t, user, 'attendance_note', 'attendance', null, { ...base, cleared: noteVal === null, ...backdatedFlag([sessionDate], today) });
      return { ok: true };
    }
    if (status === null) {
      const anchored = await makeupAnchorDeleteBlock(sql, t, studentId, classId, sessionDate);
      if (anchored) return { error: anchored };
      await sql`delete from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate} and slot_start=${slot}`;
      await audit(sql, t, user, 'attendance_clear', 'attendance', null, { ...base, ...backdatedFlag([sessionDate], today) });
      return { ok: true };
    }
    const rows = await sql`select id::text id, slot_start::text slot_start, seat_label, recorded_via, recorded_at, status::text status, note, session_units::float8 session_units
      from public.attendance_records where tenant_id=${t} and class_id=${classId} and student_id=${studentId} and session_date=${sessionDate} order by recorded_at desc, id desc`;
    const { updateIds, promoteIds } = R.pickSaveTargets(rows, slot), targets = new Set([...updateIds, ...promoteIds]);
    const prevRow = rows.find(r => targets.has(r.id)), prevStatus = prevRow?.status ?? null, overwrote = targets.size > 0;
    if (noteProvided && prevRow) { const kept = keepRaw(prevRow.note ?? null, noteVal); if (kept.error) return { error: kept.error }; noteVal = kept.value; }
    let unitsAudit = null, insertedAuto;
    if (overwrote) {
      const set = { status, recorded_by: user.id, recorded_at: new Date(), recorded_via: via, ...(noteProvided ? { note: noteVal } : {}), ...(unitsProvided ? { session_units: unitsVal } : {}) };
      if (unitsProvided) unitsAudit = R.unitsAuditFields({ rows: [...targets].map(id => ({ status: String(rows.find(r => r.id === id)?.status ?? ''), units: rows.find(r => r.id === id)?.session_units ?? null })), status, unitsVal, spread: 'each' });
      if (promoteIds.length) await sql`update public.attendance_records set ${sql({ ...set, slot_start: slot })} where id = any(${promoteIds}::uuid[])`;
      if (updateIds.length) await sql`update public.attendance_records set ${sql(set)} where id = any(${updateIds}::uuid[])`;
    } else {
      const lookedUp = R.autoUnitsApply({ rawUnits: input.units, slotStart: slot, status }) ? await resolveAutoUnits(sql, t, R, env, classId, sessionDate, slot) : undefined;
      const ins = R.newRowUnits(input.units, unitsVal, lookedUp);
      insertedAuto = ins.auto === undefined ? undefined : ins.units;
      await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, note, session_units, recorded_by, recorded_via)
        values (${t}, ${classId}, ${studentId}, ${sessionDate}, ${slot}, ${status}, ${noteProvided ? noteVal : null}, ${ins.units}, ${user.id}, ${via})`;
    }
    await audit(sql, t, user, 'attendance_cell', 'attendance', null, { ...base, status, ...(overwrote ? { overwrote: true, prevStatus } : { created: true }), ...(unitsProvided ? { units: unitsVal } : {}),
      ...(unitsAudit ? { prevUnits: unitsAudit.prevUnits, nextUnits: unitsAudit.nextUnits } : {}), ...(insertedAuto != null ? { autoUnits: insertedAuto } : {}), ...backdatedFlag([sessionDate], today) });
    return insertedAuto !== undefined ? { ok: true, autoUnits: insertedAuto } : { ok: true };
  }),
  /** commitSheetEdits({ classId, edits }) — 칸을 떠날 때 '전 → 후' 감사 한 줄(2.0 logSheetEdits: 계획 칸은 logPlanCellEdits, 그 밖은 지금 값과 비교). */
  commitSheetEdits: serverFn(MODULE.audit, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    const edits = R.parseSheetEdits(input.edits, R.ECS_EDIT_KINDS);
    if (!edits) return { ok: false, error: '잘못된 요청입니다(편집 기록)' };
    const a = gate.access, c = a.classId, areas = R.goalAreasFor(a.englishTrack, a.skillAreas);
    const plan = edits.filter(e => e.cell.kind === 'plan');
    if (plan.length) {
      const rows = new Map((await sql`select id::text id, plan_date, slot_start::text slot_start, updated_by::text updated_by, skill_area, textbook, page_range, progress, homework
        from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${c} and id = any(${[...new Set(plan.map(e => e.cell.lineId))]}::uuid[])`).map(r => [r.id, r]));
      const label = (field, v) => (field === 'skill_area' && v ? skillAreaLabelOf(a.skillAreas, v).label : v);
      for (const { cell, before } of plan) {
        const row = rows.get(cell.lineId);
        if (!row || (row.updated_by ?? null) !== user.id) continue;
        const next = typeof row[cell.field] === 'string' ? row[cell.field] : null;
        if (!R.auditValueChanged(before, next)) continue;
        await audit(sql, t, user, 'ecs_plan_cell_edit', 'class_sheet_plan', null, { classId: c, kind: 'plan', lineId: cell.lineId, planDate: isoDay(row.plan_date), slotStart: row.slot_start.slice(0, 5),
          field: cell.field, fieldLabel: R.PLAN_FIELD_LABEL[cell.field], before: R.clipAuditValue(label(cell.field, before)), after: R.clipAuditValue(label(cell.field, next)) });
      }
    }
    const MARK = { status: 'status', progressNote: 'progress_note', score: 'score', listeningLevel: 'listening_level', memorizedWords: 'memorized_words' };
    for (const { cell, before } of edits.filter(e => e.cell.kind !== 'plan')) {
      if (cell.kind === 'goal' && !areas.some(x => x.key === cell.skillArea)) continue;
      if (cell.kind === 'mpCell' && a.englishTrack !== 'eie') continue;
      let cur;
      if (cell.kind === 'goal') cur = (await sql`select textbook, target_progress from public.class_sheet_goals where tenant_id=${t} and class_id=${c} and scope=${cell.scope} and period_start=${R.normalizePeriodStart(cell.scope, cell.periodStart)} and role=${cell.role} and skill_area=${cell.skillArea}`)[0]?.[cell.field === 'textbook' ? 'textbook' : 'target_progress'];
      else if (cell.kind === 'mark') cur = (await sql`select * from public.class_sheet_student_marks where tenant_id=${t} and class_id=${c} and student_id=${cell.studentId} and mark_date=${cell.date} and slot_start=${cell.slotStart}`)[0]?.[MARK[cell.field]];
      else if (cell.kind === 'memo') cur = (await sql`select body from public.class_sheet_memos where tenant_id=${t} and class_id=${c} and week_start=${R.mondayOf(cell.weekStart)} and memo_key=${cell.memoKey}`)[0]?.body;
      else if (cell.kind === 'monthMemo') cur = (await sql`select body from public.class_sheet_month_memos where tenant_id=${t} and class_id=${c} and month=${`${cell.month}-01`}`)[0]?.body;
      else if (cell.kind === 'mpCell') cur = (await sql`select body from public.class_month_plan_cells where tenant_id=${t} and class_id=${c} and plan_date=${cell.date} and col_kind=${cell.colKind}`)[0]?.body;
      else continue;
      // 화면 글은 연락처를 가린 글이다 — 같은 눈으로 비교하고 가린 값으로 남긴다(감사로그에 원문 연락처가 새지 않게).
      const value = typeof cur === 'string' ? shown(cur) : null;
      if (!R.auditValueChanged(before, value)) continue;
      const action = cell.kind === 'goal' ? 'ecs_goal_edit' : cell.kind === 'mark' ? 'ecs_mark_edit' : cell.kind === 'mpCell' ? 'ecs_month_plan_edit' : 'ecs_memo_edit';
      const meta = cell.kind === 'goal' ? { kind: 'goal', scope: cell.scope, periodStart: R.normalizePeriodStart(cell.scope, cell.periodStart), role: cell.role, skillArea: cell.skillArea, areaLabel: areas.find(x => x.key === cell.skillArea)?.label ?? null, fieldLabel: R.GOAL_FIELD_LABEL[cell.field] }
        : cell.kind === 'mark' ? { kind: 'mark', studentId: cell.studentId, date: cell.date, slotStart: cell.slotStart, field: cell.field, fieldLabel: R.markFieldLabel(cell.field) }
          : cell.kind === 'memo' ? { kind: 'memo', weekStart: R.mondayOf(cell.weekStart), memoKey: cell.memoKey, fieldLabel: R.memoKeyLabel(cell.memoKey) }
            : cell.kind === 'monthMemo' ? { kind: 'monthMemo', month: cell.month, fieldLabel: R.MONTH_MEMO_LABEL } : { kind: 'mpCell', date: cell.date, colKind: cell.colKind, fieldLabel: R.mpCellLabel(cell.colKind) };
      await audit(sql, t, user, action, 'class_sheet', a.className, { classId: c, ...meta, before: R.clipAuditValue(before), after: R.clipAuditValue(value) });
    }
    return { ok: true };
  }),
  /** saveMonthPlanCells({ classId, patches, intent }) — EiE 월간 계획서(MP) 칸. 구조 변경(e-book 열·휴강)만 여기서 ecs_month_plan_edit. */
  saveMonthPlanCells: serverFn(MODULE.monthPlan, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (gate.access.englishTrack !== 'eie') return { ok: false, error: '월간 계획서는 EiE 반에서만 사용합니다' };
    const patches = Array.isArray(input.patches) ? input.patches : [];
    if (patches.length === 0) return { ok: true };
    if (patches.length > 160) return { ok: false, error: '한 번에 저장할 칸이 너무 많습니다' };
    const kinds = new Set([...R.MP_ALL_COLUMNS, 'off', 'footer']);
    for (const p of patches) {
      if (!R.YMD_RE.test(str(p?.date))) return { ok: false, error: '잘못된 요청입니다(날짜)' };
      if (!kinds.has(p?.colKind)) return { ok: false, error: '잘못된 요청입니다(칸 종류)' };
      if (p.body !== null && typeof p.body !== 'string') return { ok: false, error: '잘못된 요청입니다(내용)' };
      if ((p.body?.length ?? 0) > 2000) return { ok: false, error: '입력이 너무 깁니다(2000자 이내)' };
      if (p.colKind === 'off' && p.body !== null && p.body !== 'off' && p.body !== 'open') return { ok: false, error: '잘못된 요청입니다(휴강 표시)' };
    }
    const c = gate.access.classId, byKind = new Map();
    for (const p of patches) if (p.body === null) (byKind.get(p.colKind) ?? byKind.set(p.colKind, []).get(p.colKind)).push(p.date);
    for (const [colKind, dates] of byKind) await sql`delete from public.class_month_plan_cells where tenant_id=${t} and class_id=${c} and col_kind=${colKind} and plan_date = any(${dates}::date[])`;
    for (const p of patches.filter(x => x.body !== null)) await sql`insert into public.class_month_plan_cells (tenant_id, class_id, plan_date, col_kind, body, updated_by, updated_at)
      values (${t}, ${c}, ${p.date}, ${p.colKind}, ${p.body}, ${user.id}, now()) on conflict (tenant_id, class_id, plan_date, col_kind) do update set body=excluded.body, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
    const structural = R.mpStructuralChange(input.intent, patches);
    if (structural) await audit(sql, t, user, 'ecs_month_plan_edit', 'class_sheet', gate.access.className, { classId: c, ...structural });
    return { ok: true };
  }),
  /** saveMonthMemo({ classId, month, body }) — 달 특이사항(빈 글 = 행 삭제). 감사는 commitSheetEdits(monthMemo). */
  saveMonthMemo: serverFn(MODULE.monthMemo, 1, async ({ sql, t, R, env, user }, raw) => {
    const input = obj(raw), gate = await classAccess(sql, t, R, env, user, str(input.classId), { write: true });
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!/^\d{4}-\d{2}$/.test(str(input.month))) return { ok: false, error: '잘못된 요청입니다(달)' };
    let body = str(input.body).trim();
    if (body.length > 2000) return { ok: false, error: '메모는 2000자 이내로 입력하세요' };
    const c = gate.access.classId, first = `${input.month}-01`;
    const [prev] = await sql`select body from public.class_sheet_month_memos where tenant_id=${t} and class_id=${c} and month=${first}`;
    const kept = keepRaw(prev?.body ?? null, body === '' ? null : body);
    if (kept.error) return { ok: false, error: kept.error };
    body = kept.value ?? '';
    if (body === '') { await sql`delete from public.class_sheet_month_memos where tenant_id=${t} and class_id=${c} and month=${first}`; return { ok: true }; }
    await sql`insert into public.class_sheet_month_memos (tenant_id, class_id, month, body, updated_by, updated_at) values (${t}, ${c}, ${first}, ${body}, ${user.id}, now())
      on conflict (tenant_id, class_id, month) do update set body=excluded.body, updated_by=excluded.updated_by, updated_at=excluded.updated_at`;
    return { ok: true };
  }),
  /** updateStudentEnglishName({ studentId, englishName, previousEnglishName }) — 2.0 students/server/english-name.ts + english-name-store.ts.
   *  반환 = 2.0 EnglishNameResult(error는 문구 키 — 부품이 studentEnglishName.error.<키>로 읽는다). 같은 칸(students.english_name)·같은 CAS·
   *  같은 지점 중복 검사(같은 잠금 키)·같은 감사로그(student_english_name_update). */
  updateStudentEnglishName: serverFn(MODULE.englishName, 1, async ({ sql, t, R, user, today }, input) => {
    const parsed = ENGLISH_NAME_INPUT.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    if (user.systemRole === 'student') return { ok: false, error: 'denied' };
    const level = user.levels.englishName;
    // readViewers가 이미 강사 시트(ecs) 권한이 있는 사람만 고른다 = 2.0 canAccessTenant(role, "ecs").
    if (!canWriteLevel(level) || user.levels.ecs === 'none') return { ok: false, error: 'denied' };
    const { studentId, previousEnglishName } = parsed.data, englishName = parsed.data.englishName || null;
    // 2.0 teacherClassScopeStrict — 담임 ∪ 교시 담당(이력 포함) ∪ 오늘 ±7일 위임 반의, 끝난 지 60일 안 된 수강.
    if (user.systemRole === 'teacher' || level === 'scoped') {
      const floor = R.addDays(today, -60), lo = R.addDays(today, -7), hi = R.addDays(today, 7);
      const [{ ok }] = await sql`select exists (select 1 from public.enrollments e where e.tenant_id=${t} and e.student_id=${studentId}
          and (e.end_date is null or e.end_date >= ${floor})
          and (e.class_id in (select id from public.classes where tenant_id=${t} and teacher_id=${user.id})
            or e.class_id in (select class_id from public.class_schedules where tenant_id=${t} and teacher_id=${user.id})
            or e.class_id in (select class_id from public.class_delegations where tenant_id=${t} and delegate_user_id=${user.id} and revoked_at is null
              and from_date <= ${hi} and to_date >= ${lo}))) ok`;
      if (!ok) return { ok: false, error: 'denied' };
    }
    const [student] = await sql`select id::text id, name, english_name from public.students where tenant_id=${t} and id=${studentId}`;
    if (!student) return { ok: false, error: 'missing' };
    if (student.english_name !== previousEnglishName) return { ok: false, error: 'conflict' };
    if (student.english_name === englishName) return { ok: true, englishName };
    // english-name-store.ts — 지점 단위 잠금 → 중복 → 이전 값 그대로일 때만 바꾼다.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`student-english-name:${t}`}, 0))`;
    if (englishName !== null) {
      const dup = await sql`select id from public.students where tenant_id=${t} and id<>${studentId} and lower(btrim(english_name, E' \\t\\n\\r'))=lower(${englishName}) limit 1`;
      if (dup.length) return { ok: false, error: 'duplicate' };
    }
    const rows = await sql`update public.students set english_name=${englishName} where tenant_id=${t} and id=${studentId} and english_name is not distinct from ${previousEnglishName}::text returning id`;
    if (rows.length !== 1) return { ok: false, error: 'conflict' };
    await audit(sql, t, user, 'student_english_name_update', 'student', student.name, { studentId, before: previousEnglishName, after: englishName });
    return { ok: true, englishName };
  }),
  // ── 내 보기 설정(users.ui_prefs.ecs) — 2.0 setMyEcs*: 기본값과 같으면 키를 지운다. 감사로그 없음(2.0과 같다). ──
  setMyEcsTodayOrder: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, order) => {
    const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${user.id}`;
    const merged = R.mergeTodayOrder(R.readEcsTodayOrder(row?.ui_prefs ?? null), R.normalizeTodayOrder(order));
    return patchMyEcsPrefs(sql, t, user, { todayOrder: merged.length > 0 ? merged : undefined });
  }),
  setMyEcsLandingOrder: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, order) => {
    const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${user.id}`;
    const merged = R.mergeTodayOrder(R.readEcsLandingOrder(row?.ui_prefs ?? null), R.normalizeTodayOrder(order));
    return patchMyEcsPrefs(sql, t, user, { landingOrder: merged.length > 0 ? merged : undefined });
  }),
  setMyEcsFontSize: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, size) => {
    if (!R.ECS_FONT_SIZES.includes(size)) return { ok: false, error: '잘못된 글씨 크기입니다' };
    return patchMyEcsPrefs(sql, t, user, { fontSize: size === R.DEFAULT_ECS_FONT_SIZE ? undefined : size });
  }),
  setMyEcsShowSelfStudy: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, show) => {
    if (typeof show !== 'boolean') return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { showSpecialRooms: show === R.DEFAULT_ECS_SHOW_SELF_STUDY ? undefined : show });
  }),
  setMyEcsCollapsedRosterGroups: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, groups) => {
    const normalized = R.normalizeCollapsedRosterGroups(Array.isArray(groups) ? groups : []);
    return patchMyEcsPrefs(sql, t, user, { collapsedRosterGroups: normalized.length === 0 ? undefined : normalized });
  }),
  setMyEcsEnglishTrack: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, filter) => {
    if (R.normalizeEnglishTrackFilter(filter) !== filter) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { englishTrack: filter === R.DEFAULT_ECS_ENGLISH_TRACK ? undefined : filter });
  }),
  setMyEcsTeacher: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, value) => {
    if (R.normalizeEcsTeacher(value) !== value) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { teacher: value === R.ECS_TEACHER_ALL ? undefined : value });
  }),
  setMyEcsMonthView: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, view) => {
    if (R.normalizeEcsMonthView(view) !== view) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { monthView: view === R.DEFAULT_ECS_MONTH_VIEW ? undefined : view });
  }),
  setMyEcsMonthPeriod: serverFn(MODULE.sheet, 1, async ({ sql, t, R, user }, period) => {
    const safe = R.normalizeEcsMonthPeriod(period);
    if (!safe) return { ok: false, error: '잘못된 값입니다' };
    return patchMyEcsPrefs(sql, t, user, { monthPeriod: safe === R.DEFAULT_ECS_MONTH_PERIOD ? undefined : safe });
  }),
  setMyEcsMonthDisplay: serverFn(MODULE.sheet, 2, async ({ sql, t, R, user }, view, display) => {
    if (R.normalizeEcsMonthView(view) !== view) return { ok: false, error: '잘못된 값입니다' };
    const d = obj(display);
    if (typeof d.homework !== 'boolean' || typeof d.seat !== 'boolean' || typeof d.actual !== 'boolean') return { ok: false, error: '잘못된 값입니다' };
    const [row] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${user.id}`;
    const prefs = row?.ui_prefs && typeof row.ui_prefs === 'object' && !Array.isArray(row.ui_prefs) ? row.ui_prefs : {};
    const ecs = { ...(prefs.ecs ?? {}) }, stored = { ...(ecs.monthDisplay ?? {}) }, fallback = R.DEFAULT_ECS_MONTH_DISPLAY[view];
    if (d.homework === fallback.homework && d.seat === fallback.seat && d.actual === fallback.actual) delete stored[view];
    else stored[view] = { homework: d.homework, seat: d.seat, actual: d.actual };
    if (Object.keys(stored).length === 0) delete ecs.monthDisplay; else ecs.monthDisplay = stored;
    const merged = { ...prefs }; if (Object.keys(ecs).length === 0) delete merged.ecs; else merged.ecs = ecs;
    await sql`update public.users set ui_prefs=${sql.json(merged)} where tenant_id=${t} and id=${user.id}`;
    return { ok: true };
  }),
};
