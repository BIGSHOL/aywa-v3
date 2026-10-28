// 2.0 화면 — 수업목록 저장(2단계): 반 만들기·고치기 = 2.0 features/classes/server/actions.ts createClass · updateClass를 Docker 복사본에.
// 판정 순서·문구·반환 모양(ClassFormState)·감사로그(class_create · class_update — changes/changed/newTeacherId) 2.0 그대로.
// 함께 옮긴 2.0 서버 모듈: class-name-guard.ts(같은 과목 같은 이름 — 종강·폐지 반 이름 비우기·되돌리기·기록) · schedule-sync.ts(현재 교시
// 읽기·지우기) · overlap-detect.ts(겹침 경고 — 막지 않음). 판정·조립은 2.0 순수 함수(importV2) 그대로.
// 쓰기는 2.0처럼 사용자 역할(authenticated)로 — RLS·보호 트리거가 2.0과 같게 본다. 2.0은 트랜잭션 없이 지우고 다시 넣다 실패하면 옛 행을
// 되살리는데, 여기선 지우기·넣기를 저장점 하나에 담아 실패하면 저장점째 되돌아간다(2.0 '되살리기 성공' 갈래와 같은 결과 · 같은 문구).
import { V2Error } from './v2-screens.mjs';
import { actAs, audit, asAuthenticated, notifyClassAssignment, readPeople } from './v2-timetable-save.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

let rulesPromise = null;
function loadSaveRules(importV2) {
  rulesPromise ??= (async () => {
    const [name, conflict, english, color, label, notice, preserve, periods, overlap, subjects, dbErrors, eligibility, assign, dk, delegation, level] = await Promise.all([
      'features/classes/class-name.ts', 'features/classes/class-name-conflict.ts', 'features/classes/english-track.ts', 'lib/color-utils.ts',
      'features/timetable/lib/teacher-label.ts', 'features/classes/period-notice.ts', 'features/classes/schedule-preserve.ts', 'features/timetable/lib/periods.ts',
      'features/classes/overlap.ts', 'features/owner/subjects.ts', 'features/enrollments/db-errors.ts', 'features/enrollments/eligibility.ts',
      'features/enrollments/server/assign-helpers.ts', 'lib/date-kst.ts', 'features/classes/delegation-window.ts', 'features/timetable/lib/level.ts',
    ].map(p => importV2(p)));
    return { name, conflict, english, color, label, notice, preserve, periods, overlap, subjects, dbErrors, eligibility, assign, dk, delegation, level };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

// ── 2.0 FormData ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** 호스트가 { $formData: [[이름, 글자]…] }로 보낸 폼 → 2.0이 읽는 get · getAll · has. 반 폼은 교시마다 칸이 여럿이라 상한을 넉넉히. */
const FORM_MAX = 2000;
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > FORM_MAX) throw bad();
  const pairs = v.$formData.map(p => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 100 || p[1].length > 20000) throw bad();
    return p;
  });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null, getAll: k => pairs.filter(p => p[0] === k).map(p => p[1]), has: k => pairs.some(p => p[0] === k) };
}
const formAction = args => { if (args.length !== 2) throw bad(); return [null, formOf(args[1])]; };

// ── actions.ts 위쪽: 폼 읽기 · 검증 ──────────────────────────────────────────────────────────────────────────────────
const SAVE_FAILED = '저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LEGACY_SUBJECTS = ['math', 'english', 'korean', 'science', 'arts', 'etc'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = v => (ISO_DATE.test(v) ? v : null);
const allowedSubjectSet = settings => new Set([...LEGACY_SUBJECTS, ...settings.operations.subjects.map(s => s.key)]);

function readSlotNamespace(S, formData, prefix, limit, explicitTime) {
  const result = [];
  for (let i = 0; i < limit; i++) {
    const dayOfWeek = String(formData.get(`${prefix}day_${i}`) ?? '').trim();
    const startTime = String(formData.get(`${prefix}start_${i}`) ?? '').trim().slice(0, 5);
    const endTime = String(formData.get(`${prefix}end_${i}`) ?? '').trim().slice(0, 5);
    if (!dayOfWeek || !startTime || !endTime) continue;
    if (!DAYS.includes(dayOfWeek)) continue;
    const rawTeacher = String(formData.get(`${prefix}teacher_${i}`) ?? '').trim();
    const seatLabel = S.label.parseSeatValue(rawTeacher);
    const teacherId = seatLabel ? null : rawTeacher || null;
    const classroomId = String(formData.get(`${prefix}classroom_${i}`) ?? '').trim() || null;
    const rawLabSep = formData.get(`${prefix}labsep_${i}`);
    const labSeparate = rawLabSep === null ? undefined : String(rawLabSep) === '1';
    result.push({ dayOfWeek, startTime, endTime, teacherId, classroomId, explicitTime, seatLabel, ...(labSeparate === undefined ? {} : { labSeparate }) });
  }
  return result;
}
const parseSchedules = (S, formData) => [...readSlotNamespace(S, formData, 'schedule_', 80, false), ...readSlotNamespace(S, formData, 'custom_', 80, true)];

function readForm(S, formData, allowedSubjects) {
  const get = k => String(formData.get(k) ?? '').trim();
  const subject = get('subject') || 'math';
  const bgRaw = get('bgColor');
  const bgColor = S.color.isHexColor(bgRaw) ? bgRaw : null;
  const specialValues = formData.getAll('isSpecial').map(v => String(v));
  const optoutValues = formData.getAll('reportOptout').map(v => String(v));
  const trackProvided = formData.has('englishTrack');
  const englishTrack = S.english.normalizeEnglishTrack(allowedSubjects.has(subject) ? subject : 'etc', formData.get('englishTrack'));
  return {
    className: S.name.normalizeClassName(get('className')),
    subject: allowedSubjects.has(subject) ? subject : 'etc',
    teacherId: get('teacherId') || null,
    classroomId: get('classroomId') || null,
    notes: get('notes') || null,
    bgColor,
    textColor: bgColor ? S.color.readableTextColor(bgColor) || null : null,
    isSpecialProvided: specialValues.length > 0,
    isSpecial: specialValues.some(v => v === '1' || v === 'on' || v === 'true'),
    reportOptoutProvided: optoutValues.length > 0,
    reportOptout: optoutValues.some(v => v === '1' || v === 'on' || v === 'true'),
    trackProvided,
    englishTrack,
    periodProvided: get('periodProvided') === '1',
    periodKeepValidTo: get('periodKeepValidTo') === '1',
    validFrom: asDate(get('validFrom')),
    validTo: asDate(get('validTo')),
    schedules: parseSchedules(S, formData),
  };
}

function validate(S, input) {
  const errors = {};
  if (!input.className) errors.className = '반 이름은 필수입니다';
  else {
    const reserved = S.name.reservedClassNameReason(input.className);
    if (reserved) errors.className = reserved;
  }
  if (!input.subject) errors.subject = '과목을 선택해주세요';
  for (const s of input.schedules) {
    if (s.startTime >= s.endTime) { errors.schedules = '시작 시간이 종료 시간보다 빠르야 합니다'; break; }
  }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) errors.validTo = '종료일이 시작일보다 빠릅니다';
  if (input.periodProvided && (input.validFrom || input.validTo) && input.schedules.length === 0) errors.period = S.notice.PERIOD_NO_SLOT_ERROR;
  return Object.keys(errors).length > 0 ? errors : null;
}

const nameConflictState = conflict => ({ fieldErrors: { className: conflict.message }, nameConflict: conflict });

// ── server/overlap-detect.ts — 겹침 경고(활성 반의 배치 전부 · 날짜는 findOverlaps가 본다) ─────────────────────────────
async function detectOverlaps(sql, t, S, today, { candidates, excludeClassId }) {
  const usable = candidates.filter(c => c.classroomId || c.teacherId);
  if (usable.length === 0) return [];
  const days = [...new Set(usable.map(c => c.dayOfWeek))];
  const rows = await sql`select s.class_id::text class_id, s.day_of_week::text day_of_week, s.start_time::text start_time, s.end_time::text end_time,
      s.valid_from::text valid_from, s.valid_to::text valid_to, s.teacher_id::text teacher_id, s.classroom_id::text classroom_id, s.slot_teacher_label, s.slot_room_label,
      su.display_name slot_teacher_name, sr.name slot_room_name, c.class_name, c.is_active, c.closed_at::text closed_at, c.teacher_id::text class_teacher_id,
      c.classroom_id::text class_classroom_id, cu.display_name class_teacher_name, cr.name class_room_name
    from public.class_schedules s join public.classes c on c.id=s.class_id
      left join public.users su on su.id=s.teacher_id left join public.classrooms sr on sr.id=s.classroom_id
      left join public.users cu on cu.id=c.teacher_id left join public.classrooms cr on cr.id=c.classroom_id
    where s.tenant_id=${t} and s.day_of_week::text = any(${days}) and c.is_active order by s.id`;
  const existing = rows.map(r => ({
    classId: r.class_id, className: r.class_name ?? '이름 없는 반', dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time,
    validFrom: r.valid_from, validTo: r.valid_to, teacherId: r.teacher_id ?? r.class_teacher_id ?? null, classroomId: r.classroom_id ?? r.class_classroom_id ?? null,
    teacherName: r.slot_teacher_name ?? r.class_teacher_name ?? r.slot_teacher_label ?? null, roomName: r.slot_room_name ?? r.class_room_name ?? r.slot_room_label ?? null,
    isActive: r.is_active ?? true, closedAt: r.closed_at ?? null, seatLabel: S.label.specialSlotLabel(r.slot_teacher_label),
  }));
  return S.overlap.findOverlaps({ candidates: usable, existing, today, ...(excludeClassId ? { excludeClassId } : {}) });
}

/** collectOverlaps — 경고를 못 만들어도 저장은 진행(2.0 try/catch → []). 실패를 가두는 저장점. */
async function collectOverlaps(sql, t, S, today, input, excludeClassId) {
  if (input.schedules.length === 0) return [];
  try {
    return await sql.savepoint(s => detectOverlaps(s, t, S, today, {
      candidates: input.schedules.map(x => ({ dayOfWeek: x.dayOfWeek, startTime: x.startTime, endTime: x.endTime, validFrom: input.validFrom, validTo: input.validTo,
        teacherId: x.seatLabel ? null : (x.teacherId ?? input.teacherId), classroomId: x.classroomId ?? input.classroomId, seatLabel: x.seatLabel ?? null })),
      ...(excludeClassId ? { excludeClassId } : {}),
    }));
  } catch { return []; }
}

// ── server/class-name-guard.ts ─────────────────────────────────────────────────────────────────────────────────────────
async function loadHolders(sql, tgt) {
  try {
    const rows = await sql`select id::text id, is_active, closed_at::text closed_at from public.classes where tenant_id=${tgt.tenantId} and subject=${tgt.subject}
      and class_name=${tgt.name} ${tgt.excludeId ? sql`and id <> ${tgt.excludeId}` : sql``}`;
    return { value: rows.map(r => ({ id: r.id, isActive: r.is_active !== false, closedAt: r.closed_at ?? null })) };
  } catch { return { error: true }; }
}
async function pickFreeName(sql, S, tgt, closedAt) {
  for (const candidate of S.conflict.archivedClassNameCandidates(tgt.name, closedAt)) {
    const data = await sql`select id from public.classes where tenant_id=${tgt.tenantId} and subject=${tgt.subject} and class_name=${candidate} limit 1`.catch(() => null);
    if (!data) return null;
    if (data.length === 0) return candidate;
  }
  return null;
}
async function describeClassNameConflict(sql, S, tgt, today, allowFree) {
  const holders = await loadHolders(sql, tgt);
  if ('error' in holders) return holders;
  const best = S.conflict.strongestClassNameHolder(holders.value, today);
  if (!best) return { value: null };
  const freeTo = allowFree && S.conflict.canFreeClassName(best.status) ? await pickFreeName(sql, S, tgt, best.holder.closedAt) : null;
  return { value: { name: tgt.name, status: best.status, message: S.conflict.duplicateClassNameMessage(best.status), holderId: best.holder.id, freeTo, allowFree } };
}
/** 사용자 역할 쓰기 — 실패(23505 등)는 저장점째 되돌리고 { error } 모양으로(2.0 supabase 반환처럼). */
const tryWrite = async (sql, fn) => { try { return { data: await asAuthenticated(sql, fn), error: null }; } catch (e) { return { data: null, error: { code: e?.code ?? null, message: e?.message ?? '' } }; } };
async function freeHolder(sql, S, tgt, request, today) {
  const now = await describeClassNameConflict(sql, S, tgt, today, true);
  if ('error' in now) return { kind: 'error' };
  if (!now.value) return { kind: 'none' };
  const c = now.value;
  if (c.holderId !== request.holderId || !c.freeTo || c.freeTo !== request.to) return { kind: 'conflict', conflict: c };
  const { data, error } = await tryWrite(sql, s => s`update public.classes set class_name=${c.freeTo} where id=${c.holderId} and tenant_id=${tgt.tenantId} and subject=${tgt.subject}
    and class_name=${tgt.name} and (is_active = false or closed_at <= ${today}::date) returning id`);
  if (error && !S.conflict.isUniqueViolation(error)) return { kind: 'error' };
  if (error || !data || data.length !== 1) {
    const again = await describeClassNameConflict(sql, S, tgt, today, true);
    if ('error' in again) return { kind: 'error' };
    return again.value ? { kind: 'conflict', conflict: again.value } : { kind: 'none' };
  }
  return { kind: 'freed', freed: { id: c.holderId, from: tgt.name, to: c.freeTo, status: c.status } };
}
async function revertFreed(sql, tgt, freed) {
  const { data, error } = await tryWrite(sql, s => s`update public.classes set class_name=${freed.from} where id=${freed.id} and tenant_id=${tgt.tenantId}
    and subject=${tgt.subject} and class_name=${freed.to} returning id`);
  return { ok: !error && (data?.length ?? 0) === 1, taken: error?.code === '23505' };
}
async function logFreed(sql, t, S, actor, freed, log) {
  const label = S.conflict.classNameHolderStatusLabel(freed.status);
  const [from, to] = log.kind === 'reverted' ? [freed.to, freed.from] : [freed.from, freed.to];
  const note = log.kind === 'freed'
    ? `${label}이 쥔 이름을 비움 — 같은 과목의 다른 반이 이 이름을 쓰도록(저장 화면에서 확인)`
    : log.kind === 'reverted'
      ? '비웠던 이름을 되돌림 — 같은 이름으로 만들려던 반 저장이 실패함'
      : `${label}이 쥔 이름을 비웠으나 같은 이름의 반 저장이 실패했고, 비운 이름을 되돌리지 못함${log.taken ? '(그사이 다른 반이 그 이름을 씀)' : ''}`;
  const changes = log.kind === 'stuck' && log.alreadyLogged ? [] : [{ field: '반 이름', from, to }];
  await audit(sql, t, actor, 'class_update', 'class', { classId: freed.id, changed: changes.map(c => c.field), changes, note,
    ...(log.kind === 'freed' && log.forClassId ? { freedForClassId: log.forClassId } : {}) }, to);
}
async function rollbackFreedClassName(sql, t, S, actor, tgt, freed) {
  const r = await revertFreed(sql, tgt, freed);
  await logFreed(sql, t, S, actor, freed, r.ok ? { kind: 'reverted' } : { kind: 'stuck', taken: r.taken, alreadyLogged: true });
  return r.ok;
}
const freedLeftNotice = to => ` (비우려던 반 이름은 '${to}'(으)로 바뀐 채 남았습니다)`;
async function writeWithClassNameGuard(sql, t, S, actor, { target, today, request, canFree: canFreeFn, write, savedClassId, failMessage }) {
  let allowed;
  const canFree = async () => (allowed ??= await canFreeFn());
  let freed = null;
  if (request && request.name === target.name && (await canFree())) {
    const r = await freeHolder(sql, S, target, request, today);
    if (r.kind === 'error') return { ok: false, error: failMessage };
    if (r.kind === 'conflict') return { ok: false, conflict: r.conflict };
    if (r.kind === 'freed') freed = r.freed;
  }
  const { data, error } = await write();
  if (!error) {
    if (freed) await logFreed(sql, t, S, actor, freed, { kind: 'freed', forClassId: savedClassId(data) });
    return { ok: true, data, freed };
  }
  let tail = '';
  if (freed) {
    const r = await revertFreed(sql, target, freed);
    if (!r.ok) { await logFreed(sql, t, S, actor, freed, { kind: 'stuck', taken: r.taken, alreadyLogged: false }); tail = freedLeftNotice(freed.to); }
  }
  if (S.conflict.isUniqueViolation(error)) {
    const now = await describeClassNameConflict(sql, S, target, today, await canFree());
    if (!('error' in now) && now.value) return { ok: false, conflict: { ...now.value, message: now.value.message + tail } };
  }
  return { ok: false, error: failMessage + tail };
}

// ── server/schedule-sync.ts ────────────────────────────────────────────────────────────────────────────────────────────
async function loadCurrentSlots(sql, t, S, classId, today) {
  let data, labIds;
  try {
    data = await sql`select id::text id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and (valid_to is null or valid_to >= ${today}::date)
      order by valid_to desc nulls first, valid_from desc, start_time`;
  } catch { return { error: '기존 시간표를 읽지 못해 저장을 중단했습니다. 잠시 후 다시 시도해주세요.' }; }
  try { labIds = new Set((await sql.savepoint(s => s`select id::text id from public.class_schedules where tenant_id=${t} and class_id=${classId} and lab_separate`)).map(r => r.id)); }
  catch { labIds = null; }
  return {
    labSeparateSupported: labIds !== null,
    rows: data.filter(r => S.preserve.isCurrentSlot(r.valid_to, today)).map(r => ({
      dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, teacherId: r.teacher_id ?? null,
      classroomId: r.classroom_id ?? null, slotTeacherLabel: r.slot_teacher_label, slotRoomLabel: r.slot_room_label, periodLabel: r.period_label, mergeGroup: r.merge_group,
      ...(labIds ? { labSeparate: labIds.has(r.id) } : {}),
    })),
  };
}

/** 교시 행 넣기 — 2.0 insert 한 문장과 같은 칸. */
const insertSlots = (s, rows) => (rows.length ? s`insert into public.class_schedules ${s(rows)}` : Promise.resolve());

function buildPeriodPairs(S, settings, subjects) {
  const config = S.periods.settingsToPeriodsConfig(settings.operations);
  const weekday = new Set();
  for (const subject of new Set(subjects.filter(v => !!v))) for (const p of S.periods.subjectWeekdayPeriods(subject, config)) weekday.add(S.preserve.periodPairKey(p.startTime, p.endTime));
  const weekend = new Set(S.periods.subjectWeekendPeriods(config).map(p => S.preserve.periodPairKey(p.startTime, p.endTime)));
  return { weekday, weekend };
}

// ── createClass ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function createClass(ctx, actorId, [, formData]) {
  const { sql, t, R, X, S, readers } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '학원 전체 반 설정은 관리자만 할 수 있습니다' };
  const settings = await readers.readSettings(sql, t);
  const input = readForm(S, formData, allowedSubjectSet(settings));
  const fieldErrors = validate(S, input);
  if (fieldErrors) return { fieldErrors };
  const today = R.kstToday();
  const overlaps = await collectOverlaps(sql, t, S, today, input);
  const nameTarget = { tenantId: t, subject: input.subject, name: input.className };
  const guarded = await writeWithClassNameGuard(sql, t, S, actor, {
    target: nameTarget, today, request: S.conflict.readFreeClosedNameRequest(formData), canFree: async () => true,
    write: () => tryWrite(sql, async s => (await s`insert into public.classes (tenant_id, class_name, subject, teacher_id, classroom_id, is_active, is_special, report_optout,
        english_track, notes, bg_color, text_color) values (${t}, ${input.className}, ${input.subject}, ${input.teacherId}, ${input.classroomId}, true, ${input.isSpecial},
        ${input.reportOptout}, ${input.englishTrack}, ${input.notes}, ${input.bgColor}, ${input.textColor}) returning id::text id`)[0]),
    savedClassId: d => d?.id ?? null, failMessage: SAVE_FAILED,
  });
  if (!guarded.ok) return 'conflict' in guarded ? nameConflictState(guarded.conflict) : { error: guarded.error };
  const data = guarded.data;
  if (!data) return { error: SAVE_FAILED };
  if (input.schedules.length > 0) {
    const validFrom = input.validFrom ?? today;
    const rows = input.schedules.map(s => ({ tenant_id: t, class_id: data.id, day_of_week: s.dayOfWeek, start_time: s.startTime, end_time: s.endTime,
      valid_from: validFrom, valid_to: input.validTo, teacher_id: s.teacherId, classroom_id: s.classroomId }));
    const { error: schedErr } = await tryWrite(sql, s => insertSlots(s, rows));
    if (schedErr) {
      const { error: delErr } = await tryWrite(sql, s => s`delete from public.classes where id=${data.id}`);
      if (delErr) return { error: '수업 시간 저장에 실패했습니다. 반은 만들어졌지만 수업 시간이 비어 있습니다 — 반 목록에서 그 반을 열어 수업 시간을 다시 저장해주세요.' };
      const freed = guarded.freed;
      const kept = freed ? !(await rollbackFreedClassName(sql, t, S, actor, nameTarget, freed)) : false;
      return { error: `스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요.${kept && freed ? freedLeftNotice(freed.to) : ''}` };
    }
  }
  await audit(sql, t, actor, 'class_create', 'class', { classId: data.id, subject: input.subject, teacherId: input.teacherId, isSpecial: input.isSpecial,
    schedules: input.schedules.length, ...(input.validFrom || input.validTo ? { validFrom: input.validFrom ?? null, validTo: input.validTo ?? null } : {}) }, input.className);
  return { ok: true, redirectTo: `/classes/${data.id}`, nonce: Date.now(), overlaps };
}

// ── updateClass ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function updateClass(ctx, actorId, [, formData]) {
  const { sql, t, R, X, S, readers } = ctx;
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '반 ID가 누락되었습니다' };
  // requireClassWrite — 저장할 수 있는 사람 = 수업 관리 '전체'(모든 반). 없는 반은 2.0도 아래 쓰기에서 0행이 된다.
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 관리 권한이 없습니다' };
  const settings = await readers.readSettings(sql, t);
  const input = readForm(S, formData, allowedSubjectSet(settings));
  const fieldErrors = validate(S, input);
  if (fieldErrors) return { fieldErrors };
  const today = R.kstToday();
  const overlaps = await collectOverlaps(sql, t, S, today, input, id);
  const priorRes = await loadCurrentSlots(sql, t, S, id, today);
  const [before] = await sql`select class_name, subject, teacher_id::text teacher_id, classroom_id::text classroom_id from public.classes where tenant_id=${t} and id=${id}`;
  if (priorRes.error || !priorRes.rows) return { error: priorRes.error ?? SAVE_FAILED };
  // 이 지점의 반이 아니면 멈춘다(2.0 requireClassWrite의 문구) — 2.0은 사용자 클라이언트(RLS)라 남의 지점 반을 못 보지만,
  // 복사본 접속은 RLS를 안 타서 그대로 두면 교시 줄만 이 지점 이름으로 들어갈 수 있다.
  if (!before) return { error: '반을 찾을 수 없습니다' };
  const prior = priorRes.rows;
  const labSupported = priorRes.labSeparateSupported === true;
  if (!labSupported) input.schedules = input.schedules.map(sch => { const rest = { ...sch }; delete rest.labSeparate; return rest; });
  const labCol = v => (labSupported ? { lab_separate: v ?? false } : {});

  const guarded = await writeWithClassNameGuard(sql, t, S, actor, {
    target: { tenantId: t, subject: input.subject, name: input.className, excludeId: id }, today, request: S.conflict.readFreeClosedNameRequest(formData),
    // 남의 반 이름을 비우는 일 = 수업 관리 '전체'(저장하는 사람 목록이 이미 그 사람들뿐이다).
    canFree: async () => true,
    write: () => tryWrite(sql, s => s`update public.classes set class_name=${input.className}, subject=${input.subject}, teacher_id=${input.teacherId},
        classroom_id=${input.classroomId}, ${input.isSpecialProvided ? s`is_special=${input.isSpecial},` : s``} ${input.reportOptoutProvided ? s`report_optout=${input.reportOptout},` : s``}
        ${input.trackProvided ? s`english_track=${input.englishTrack},` : s``} notes=${input.notes}, bg_color=${input.bgColor}, text_color=${input.textColor}
      where id=${id} and tenant_id=${t}`.then(() => true)),
    savedClassId: () => id, failMessage: SAVE_FAILED,
  });
  if (!guarded.ok) return 'conflict' in guarded ? nameConflictState(guarded.conflict) : { error: guarded.error };

  const periodPairs = buildPeriodPairs(S, settings, [before?.subject, input.subject]);
  const archiveRows = S.preserve.planSlotArchives({ incoming: input.schedules, prior, today, periodPairs, ...(input.periodProvided ? { periodValidTo: input.validTo } : {}) })
    .map(a => ({ tenant_id: t, class_id: id, day_of_week: a.dayOfWeek, start_time: a.startTime, end_time: a.endTime, valid_from: a.validFrom, valid_to: a.validTo,
      teacher_id: a.teacherId ?? null, classroom_id: a.classroomId ?? null, slot_teacher_label: a.slotTeacherLabel, slot_room_label: a.slotRoomLabel,
      period_label: a.periodLabel, merge_group: a.mergeGroup, ...labCol(a.labSeparate) }));
  let openedRows = 0, rows = [];
  if (input.schedules.length > 0 || archiveRows.length > 0) {
    rows = S.preserve.preserveScheduleFields({ incoming: input.schedules, prior,
      period: { validFrom: input.validFrom, validTo: input.validTo, provided: input.periodProvided, ...(input.periodKeepValidTo ? { keepValidTo: true } : {}) }, today, periodPairs })
      .map(s => ({ tenant_id: t, class_id: id, day_of_week: s.dayOfWeek, start_time: s.startTime, end_time: s.endTime, valid_from: s.validFrom, valid_to: s.validTo,
        teacher_id: s.teacherId, classroom_id: s.classroomId, slot_teacher_label: s.slotTeacherLabel, slot_room_label: s.slotRoomLabel, period_label: s.periodLabel,
        merge_group: s.mergeGroup, ...labCol(s.labSeparate) }));
    openedRows = rows.filter(r => r.valid_from === today).length;
  }
  // deleteCurrentSlots + 재삽입 — 한 저장점(실패하면 지운 행까지 그대로 되돌아간다).
  const synced = await tryWrite(sql, async s => {
    await s`delete from public.class_schedules where class_id=${id} and tenant_id=${t} and (valid_to is null or valid_to >= ${today}::date)`;
    if (input.schedules.length > 0 || archiveRows.length > 0) await insertSlots(s, [...archiveRows, ...rows]);
  });
  if (synced.error) return { error: '스케줄 저장에 실패했습니다. 잠시 후 다시 시도해주세요.' };

  const teacherChanged = !!before && before.teacher_id !== input.teacherId;
  const roomChanged = !!before && before.classroom_id !== input.classroomId;
  const nameChanged = !!before && before.class_name !== input.className;
  const subjectChanged = !!before && before.subject !== input.subject;
  const userIds = [before?.teacher_id, input.teacherId].filter(v => !!v), roomIds = [before?.classroom_id, input.classroomId].filter(v => !!v);
  const [users, rooms] = await Promise.all([
    teacherChanged && userIds.length ? sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${userIds}::uuid[])` : [],
    roomChanged && roomIds.length ? sql`select id::text id, name from public.classrooms where tenant_id=${t} and id = any(${roomIds}::uuid[])` : [],
  ]);
  const userName = new Map(users.map(u => [u.id, u.display_name || ''])), roomName = new Map(rooms.map(r => [r.id, r.name || '']));
  const pick = (map, key) => (key ? (map.get(key) ?? null) : null);
  const changes = [];
  if (archiveRows.length > 0 || openedRows > 0) changes.push({ field: '수업 배치' });
  const labToggles = labSupported ? S.preserve.labSeparateChanges(input.schedules, prior) : [];
  if (labToggles.length > 0) changes.push({ field: `따로 수업(*LAB) ${labToggles.map(x => `${S.overlap.DAY_LABEL_KO[x.dayOfWeek] ?? x.dayOfWeek} ${x.startTime} ${x.on ? '켬' : '끔'}`).join(', ')}` });
  if (teacherChanged) changes.push({ field: '담임', from: pick(userName, before?.teacher_id), to: pick(userName, input.teacherId) });
  if (roomChanged) changes.push({ field: '강의실', from: pick(roomName, before?.classroom_id), to: pick(roomName, input.classroomId) });
  if (nameChanged) changes.push({ field: '반 이름', from: before?.class_name ?? null, to: input.className });
  if (subjectChanged) {
    const subjects = S.subjects.buildSubjectMaps(settings.operations.subjects);
    changes.push({ field: '과목', from: before?.subject ? subjects.labelOf(before.subject) : null, to: input.subject ? subjects.labelOf(input.subject) : null });
  }
  if (changes.length > 0) {
    await audit(sql, t, actor, 'class_update', 'class', { classId: id, changed: changes.map(c => c.field), changes,
      ...(teacherChanged ? { newTeacherId: input.teacherId, previousTeacherId: before?.teacher_id ?? null, effectiveDate: today } : {}) }, input.className);
  }
  return { ok: true, redirectTo: `/classes/${id}`, nonce: Date.now(), overlaps };
}

// ── 2.0 features/enrollments/server/actions.ts createEnrollment(반 상세 '학생 배정') ──────────────────────────────────────
/** postgres.js 오류 → 2.0 supabase 오류 모양(toKoreanDbError · isOverlapConflict가 읽는 칸). */
const dbErr = e => (e ? { code: e.code ?? null, message: e.message ?? '', details: e.detail ?? null, hint: e.hint ?? null } : null);
const DAY_LABEL = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

/** assign-helpers.ts describeOverlapConflict — 같은 학생·같은 반에서 겹친 수강을 문장으로. */
async function describeOverlapConflict(sql, t, studentId, classId, startDate, endDate, excludeId) {
  const [hit] = await sql`select start_date::text start_date, end_date::text end_date, attendance_days from public.enrollments
    where tenant_id=${t} and student_id=${studentId} and class_id=${classId} and (end_date is null or end_date > ${startDate}::date)
      ${endDate ? sql`and start_date < ${endDate}::date` : sql``} ${excludeId ? sql`and id <> ${excludeId}` : sql``} order by start_date limit 3`;
  if (!hit) return '이미 이 반에 기간이 겹치는 수강이 있어 중복 배정할 수 없습니다.';
  const period = hit.end_date ? `${hit.start_date} ~ ${hit.end_date}` : `${hit.start_date}부터`;
  const days = hit.attendance_days ?? [];
  const daysLabel = days.length > 0 ? ` · ${days.map(d => DAY_LABEL[d] ?? d).join('·')}만 등원` : '';
  return `이미 이 반에 배정되어 있습니다 (${period}${daysLabel}). 같은 반에 기간이 겹치는 배정은 만들 수 없습니다 — `
    + `기존 수강을 학생 상세 '수업' 탭에서 수정하거나, 겹치지 않는 시작일을 선택해 주세요.`;
}
/** assign-helpers.ts normalizeAttendanceDays — 반이 도는 요일 안으로 좁히고, 전 요일이면 [](분리등원 아님). */
async function normalizeAttendanceDays(sql, t, S, classId, picked) {
  if (picked.length === 0) return [];
  const classDays = new Set((await sql`select day_of_week::text d from public.class_schedules where tenant_id=${t} and class_id=${classId}`).map(r => r.d));
  if (classDays.size === 0) return [];
  const within = picked.filter(d => classDays.has(d));
  if (within.length === 0 || within.length >= classDays.size) return [];
  return S.assign.DAY_ORDER.filter(d => within.includes(d));
}

async function createEnrollment(ctx, actorId, [, formData]) {
  const { sql, t, R, X, S } = ctx;
  // 게이트 = 수업 관리 '전체' 또는 원생 관리 '전체' — 저장하는 사람(수업 관리 '전체')은 모두 통과한다.
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 배정 권한이 없습니다 — 강사 계정은 열람 전용입니다' };
  const studentId = String(formData.get('studentId') ?? '').trim(), classId = String(formData.get('classId') ?? '').trim();
  const startDate = String(formData.get('startDate') ?? '').trim() || R.kstToday();
  const endDate = String(formData.get('endDate') ?? '').trim() || null;
  if (endDate && !ctx.statusIds.has(actor.id)) return { error: X.STUDENT_STATUS_DENIED };
  const pickedDays = String(formData.get('attendanceDays') ?? '').split(',').map(d => d.trim()).filter(d => S.assign.VALID_DAYS.has(d));
  if (!studentId) return { error: '학생을 선택해주세요' };
  if (!classId) return { error: '반을 선택해주세요' };
  // 2.0은 사용자 클라이언트라 남의 지점 반·학생은 null — 복사본 접속은 tenant_id로 같은 범위를 건다(잘못된 id도 같은 null).
  const [[klass], [stu]] = await Promise.all([
    UUID.test(classId) ? sql`select id from public.classes where tenant_id=${t} and id=${classId}` : [[]],
    UUID.test(studentId) ? sql`select status::text status from public.students where tenant_id=${t} and id=${studentId}` : [[]],
  ]);
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  if (!stu) return { error: '학생을 찾을 수 없습니다' };
  const blocked = S.eligibility.enrollmentAssignBlockReason(stu.status ?? null);
  if (blocked) return { error: blocked };
  const attendanceDays = await normalizeAttendanceDays(sql, t, S, classId, pickedDays);
  const { data, error } = await tryWrite(sql, async s => (await s`insert into public.enrollments (tenant_id, student_id, class_id, start_date, end_date, attendance_days)
    values (${t}, ${studentId}, ${classId}, ${startDate}, ${endDate}, ${attendanceDays}::text[]) returning id::text id`)[0]);
  if (error || !data) {
    const e = dbErr(error);
    if (S.dbErrors.isOverlapConflict(e)) return { error: await describeOverlapConflict(sql, t, studentId, classId, startDate, endDate) };
    return { error: X.toKoreanDbError(e, '수강 배정에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'enrollments.assign') };
  }
  await notifyClassAssignment(sql, t, actor, [{ classId, studentId }], 'enrollment_assigned');
  await audit(sql, t, actor, 'enrollment_assign', 'student', { studentId, classId, startDate, days: attendanceDays });
  return { enrollmentId: data.id };
}

// ── 2.0 features/enrollments/server/lab-separate-actions.ts setEnrollmentLabSeparate(반 상세 EiE 토글) ───────────────────
async function setEnrollmentLabSeparate(ctx, actorId, [enrollmentId, on]) {
  const { sql, t, R, X, S } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '따로 수업(*LAB) 배정은 관리자만 할 수 있습니다' };
  const id = String(enrollmentId ?? '').trim();
  if (!id) return { error: '수강 정보를 찾지 못했습니다' };
  const [enrollment] = await sql`select id::text id, class_id::text class_id, student_id::text student_id from public.enrollments where tenant_id=${t} and id=${id}`;
  if (!enrollment) return { error: '수강 정보를 찾지 못했습니다' };
  const classId = enrollment.class_id;
  if (on) {
    const [klass] = await sql`select subject, english_track from public.classes where tenant_id=${t} and id=${classId}`;
    const track = klass ? S.english.readEnglishTrack(klass) : null;
    if (!klass || klass.subject !== 'english' || track !== 'eie') return { error: '따로 수업(*LAB) 배정은 EiE 반에서만 할 수 있습니다' };
  }
  const { data: updated, error } = await tryWrite(sql, async s => (await s`update public.enrollments set lab_separate=${on} where id=${id} returning id`)[0] ?? null);
  if (error) return { error: X.toKoreanDbError(dbErr(error), '따로 수업(*LAB) 배정을 저장하지 못했습니다', 'enrollments.labSeparate') };
  if (!updated) return { error: '수강 정보를 찾지 못했습니다' };
  await audit(sql, t, actor, 'enrollment_lab_separate', 'student', { enrollmentId: id, studentId: enrollment.student_id, classId, on });
  return { ok: true };
}

// ── 2.0 features/enrollments/server/scheduled-actions.ts(예정된 변경 '수정'·'취소') ───────────────────────────────────
const SCHEDULE_ERRORS = {
  scheduled_invalid_request: '예약 요청이 올바르지 않습니다.',
  scheduled_missing: '수강 정보를 찾을 수 없습니다. 새로고침 후 확인해 주세요.',
  scheduled_started: '이미 시작된 수강은 예약으로 수정할 수 없습니다.',
  scheduled_has_next_move: '이후에 예약된 반 이동을 먼저 취소해 주세요.',
  scheduled_pair_changed: '반 이동의 이전 수강을 확인할 수 없습니다. 새로고침 후 다시 확인해 주세요.',
  scheduled_changed: '예약이 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
  scheduled_invalid_date: '적용일은 내일 이후여야 합니다.',
  scheduled_invalid_period: '이동할 반과 날짜가 기존 수강 기간과 맞지 않습니다.',
  scheduled_target_missing: '이동할 반을 찾을 수 없거나 운영이 종료되었습니다.',
};
async function changeSchedule(ctx, input, action, date, classId) {
  const { sql, R, X, S } = ctx;
  if (date && !S.dk.isValidYmd(date)) return { error: '날짜 형식이 올바르지 않습니다' };
  if (date && date <= R.kstToday()) return { error: '적용일은 내일 이후여야 합니다' };
  // DB 함수(change_scheduled_enrollment)는 2.0처럼 사용자 역할로 — 안에서 그 사람의 지점·권한을 다시 본다.
  const { data, error } = await tryWrite(sql, async s => (await s`select public.change_scheduled_enrollment(${input.enrollmentId}::uuid, ${input.pairedEnrollmentId ?? null}::uuid,
    ${action}, ${date ?? null}::date, ${classId ?? null}::uuid) r`)[0].r);
  if (error) return { error: X.toKoreanDbError(dbErr(error), '예약을 변경하지 못했습니다', 'enrollments.scheduled.change') };
  if (!data?.ok) {
    const detail = data?.error ?? '';
    return { error: SCHEDULE_ERRORS[detail] ?? X.toKoreanDbError({ message: detail }, '예약을 변경하지 못했습니다', 'enrollments.scheduled.change') };
  }
  return { result: data };
}
async function rescheduleEnrollment(ctx, actorId, [input]) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '예약 변경은 관리자만 할 수 있습니다' };
  const changed = await changeSchedule(ctx, input, 'reschedule', input.date?.trim() || undefined, input.newClassId?.trim() || undefined);
  if ('error' in changed) return changed;
  const { result } = changed;
  await audit(sql, t, actor, 'enrollment_reschedule', 'student', { studentIds: [result.studentId], enrollmentId: input.enrollmentId,
    pairedEnrollmentId: input.pairedEnrollmentId ?? null, from: { date: result.startDate, classId: result.classId }, to: { date: result.nextDate, classId: result.nextClassId } });
  return { ok: true };
}
async function cancelScheduledEnrollment(ctx, actorId, [input]) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '예약 변경은 관리자만 할 수 있습니다' };
  const changed = await changeSchedule(ctx, input, 'cancel');
  if ('error' in changed) return changed;
  const { result } = changed;
  await audit(sql, t, actor, 'enrollment_schedule_cancel', 'student', { studentIds: [result.studentId], enrollmentId: input.enrollmentId,
    pairedEnrollmentId: input.pairedEnrollmentId ?? null, canceled: { date: result.startDate, classId: result.classId } });
  return { ok: true };
}

const scheduleArgs = withDate => args => {
  const [input] = args;
  if (args.length !== 1 || !plain(input) || typeof input.enrollmentId !== 'string' || !UUID.test(input.enrollmentId)) throw bad();
  const out = { enrollmentId: input.enrollmentId };
  if (input.pairedEnrollmentId != null) { if (typeof input.pairedEnrollmentId !== 'string' || !UUID.test(input.pairedEnrollmentId)) throw bad(); out.pairedEnrollmentId = input.pairedEnrollmentId; }
  if (withDate) {
    if (input.date != null) { if (typeof input.date !== 'string' || input.date.length > 20) throw bad(); out.date = input.date; }
    if (input.newClassId != null && input.newClassId !== '') { if (typeof input.newClassId !== 'string' || !UUID.test(input.newClassId)) throw bad(); out.newClassId = input.newClassId; }
  }
  return [out];
};
const labArgs = args => { if (args.length !== 2 || typeof args[0] !== 'string' || !UUID.test(args[0]) || typeof args[1] !== 'boolean') throw bad(); return args; };

// ── 2.0 features/classes/server/class-term-store.ts — 종강·폐지(반 이름 바꿈 + 수강 일괄 종료 + 감사로그) ───────────────────
// 2.0도 postgres.js로 직접 쓰는 코드라 **그 파일의 함수 본문을 글자 그대로** 읽어 돌린다(서버 전용 표시 때문에 import만 못 한다).
// 2.0 endClassWithName은 자기 연결에서 serializable 트랜잭션을 여는데, 여기선 공통 틀의 저장 트랜잭션 안 저장점 하나로 같은 일을 한다.
let termPromise = null;
function loadTermStore(importV2) {
  termPromise ??= (async () => {
    const [{ readFile }, ts, closedName] = await Promise.all([import('node:fs/promises'), import('typescript').then(m => m.default), importV2('features/classes/closed-name.ts')]);
    const text = (await readFile(new URL('../../src/features/classes/server/class-term-store.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const i = text.indexOf('export class ClassTermError'), j = text.indexOf('export async function endClassWithName');
    if (i < 0 || j < i) throw new Error('class-term-store.ts의 종강 함수를 찾지 못했습니다');
    const js = ts.transpileModule(text.slice(i, j).replace(/^export /gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return new Function('nextClosedClassName', `${js}\nreturn { ClassTermError, prepareClassTerms, applyClassTerms, rollbackClassTerms };`)(closedName.nextClosedClassName);
  })().catch(error => { termPromise = null; throw error; });
  return termPromise;
}
const TERM_ACTIONS = ['class_end_term', 'class_archive', 'class_reopen_term'];
/** endClassWithName(actor, request) — 2.0 함수 본문 그대로(prepare → apply) + 이 트랜잭션에서 남긴 감사로그에 via. */
async function endClassWithName(ctx, actor, request) {
  const T = await loadTermStore(ctx.importV2);
  await ctx.sql.savepoint(async tx => {
    await tx`set local lock_timeout='5s'`;
    const rows = await T.prepareClassTerms(tx, ctx.t, [request]);
    await T.applyClassTerms(tx, { id: actor.id, tenantId: ctx.t, displayName: actor.name }, rows);
    await tx`update public.audit_logs set metadata = metadata || ${tx.json({ via: VIA_NOTE })} where tenant_id=${ctx.t} and actor_id=${actor.id}
      and created_at = now() and action = any(${TERM_ACTIONS}) and not (metadata ? 'via')`;
  }).catch(error => { error.isClassTermError = error instanceof T.ClassTermError; throw error; });
}
const VIA_NOTE = '3.0 연습 복사본';
const termFailure = (X, error, scope, fallback) => X.explainDbError(error, { scope, op: 'write', fallback: error?.isClassTermError ? error.message : fallback }).message;

/** enrollment-lifecycle.ts reopenClassEnrollments — DB 함수(reopen_class_enrollments)를 사용자 역할로. */
async function reopenClassEnrollments(ctx, classId, reason) {
  const { data, error } = await tryWrite(ctx.sql, s => s`select * from public.reopen_class_enrollments(${classId}::uuid, ${reason})`);
  if (error) {
    const message = error.message ?? '';
    if (message.includes('conflicting_period')) return { error: '같은 학생의 다른 수강과 기간이 겹쳐 복원할 수 없습니다. 학생 상세에서 수강을 직접 정리해 주세요.', studentIds: [] };
    if (message.includes('range lower bound')) return { error: '수강 종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.', studentIds: [] };
    if (/enrollments_no_overlap|exclusion constraint/i.test(message)) return { error: "같은 반에 기간이 겹치는 수강이 있어 처리할 수 없습니다. 학생 상세 '수업' 탭에서 수강 기간을 정리해 주세요.", studentIds: [] };
    return { error: ctx.X.explainDbError(error, { scope: 'classes.enrollmentLifecycle.reopen', fallback: '수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }).message, studentIds: [] };
  }
  return { studentIds: [...new Set((data ?? []).map(r => r.student_id))] };
}

// ── actions.ts archiveClass · endClassTerm · reopenClassTerm ───────────────────────────────────────────────────────────
async function archiveClass(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 폐지/복구는 관리자만 할 수 있습니다' };
  const id = String(formData.get('id') ?? '').trim();
  const next = String(formData.get('isActive') ?? 'false') === 'true';
  if (!id) return { error: '반 ID가 누락되었습니다' };
  if (!next) {
    try { await endClassWithName(ctx, actor, { classId: id, date: R.kstToday(), archive: true }); }
    catch (error) { return { error: termFailure(X, error, 'classes.archiveClass', '반 폐지를 저장하지 못했습니다. 반 이름과 수강 정보가 변경됐는지 확인하고 다시 시도해 주세요.') }; }
    return undefined;
  }
  const [klass] = await sql`select class_name from public.classes where tenant_id=${t} and id=${id}`;
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  const { error } = await tryWrite(sql, s => s`update public.classes set is_active=${next} where id=${id}`);
  if (error) return { error: error.message };
  const sync = await reopenClassEnrollments(ctx, id, '반 폐지');
  if (sync.error) return { error: sync.error };
  await audit(sql, t, actor, 'class_unarchive', 'class', { classId: id, affectedStudents: sync.studentIds.length }, klass?.class_name ?? null);
  return undefined;
}
async function endClassTerm(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '학원 전체 반 설정은 관리자만 할 수 있습니다' };
  const id = String(formData.get('id') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim() || R.kstToday();
  if (!id) return { error: '반 ID가 누락되었습니다' };
  try { await endClassWithName(ctx, actor, { classId: id, date }); }
  catch (error) { return { error: termFailure(X, error, 'classes.endClassTerm', '종강을 저장하지 못했습니다. 종강일·반 이름·수강 정보를 확인하고 다시 시도해 주세요.') }; }
  return undefined;
}
async function reopenClassTerm(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '학원 전체 반 설정은 관리자만 할 수 있습니다' };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '반 ID가 누락되었습니다' };
  const [klass] = await sql`select class_name from public.classes where tenant_id=${t} and id=${id}`;
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  const { error: updErr } = await tryWrite(sql, s => s`update public.classes set closed_at=null where id=${id}`);
  if (updErr) return { error: updErr.message };
  const sync = await reopenClassEnrollments(ctx, id, '종강');
  if (sync.error) return { error: sync.error };
  await audit(sql, t, actor, 'class_reopen_term', 'class', { classId: id, affectedStudents: sync.studentIds.length }, klass?.class_name ?? null);
  return undefined;
}

// ── actions.ts 인수인계(scheduleHandover · cancelHandover · applyHandover) ───────────────────────────────────────────
/** 2.0 notifyUsers — notifications 줄까지(내 행동은 나에게 알리지 않음 · 슬랙 깨우기는 바깥 요청이라 부르지 않는다). best-effort. */
async function notifyUsers(sql, items) {
  const rows = items.filter(i => i.recipientId && i.recipientId !== i.actorId);
  if (!rows.length) return;
  try {
    await sql.savepoint(s => s`insert into public.notifications ${s(rows.map(i => ({ tenant_id: i.tenantId, recipient_id: i.recipientId, type: i.type, title: i.title,
      body: i.body ?? null, link: i.link ?? null, actor_id: i.actorId ?? null })))}`);
  } catch (e) { console.error(`notify.insert: ${e?.code || ''} ${e?.message || ''}`); }
}
/** isAssignableTeacher — 이 학원의 재직 중인 배정 가능 역할(강사·실장·원장 …)인가. */
async function isAssignableTeacher(ctx, userId) {
  if (!UUID.test(userId)) return false;
  const [u] = await ctx.sql`select system_role::text system_role, status::text status from public.users where tenant_id=${ctx.t} and id=${userId}`;
  return !!u && ctx.X.perms.isAssignableTeacherRole(u.system_role) && u.status === 'active';
}
async function scheduleHandover(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const classId = String(formData.get('classId') ?? '').trim(), newTeacherId = String(formData.get('newTeacherId') ?? '').trim();
  const effectiveDate = String(formData.get('effectiveDate') ?? '').trim(), reason = String(formData.get('reason') ?? '').trim() || null;
  if (!classId) return { error: '반 ID가 누락되었습니다' };
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 관리 권한이 없습니다' };
  if (!newTeacherId) return { error: '인계받을 강사를 선택해주세요' };
  if (!effectiveDate) return { error: '적용일을 입력해주세요' };
  const [klass] = UUID.test(classId) ? await sql`select class_name, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${classId}` : [];
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  if (klass.teacher_id === newTeacherId) return { error: '현재 담임과 동일한 강사입니다' };
  if (!(await isAssignableTeacher(ctx, newTeacherId))) return { error: '유효한 강사가 아닙니다' };
  const { error: updErr } = await tryWrite(sql, s => s`update public.classes set pending_teacher_id=${newTeacherId}, pending_teacher_date=${effectiveDate}, pending_teacher_reason=${reason} where id=${classId}`);
  if (updErr) return { error: updErr.message };
  await audit(sql, t, actor, 'class_handover_schedule', 'class', { newTeacherId, effectiveDate }, klass.class_name);
  await notifyUsers(sql, [{ tenantId: t, recipientId: newTeacherId, type: 'teacher_handover', title: '강사 인수인계 예약',
    body: `${klass.class_name} 반의 새 담임으로 예약되었습니다 (적용일 ${effectiveDate}).`, link: `/classes/${classId}`, actorId: actor.id }]);
  return { ok: true };
}
async function cancelHandover(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const classId = String(formData.get('classId') ?? '').trim();
  if (!classId) return { error: '반 ID가 누락되었습니다' };
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 관리 권한이 없습니다' };
  if (!UUID.test(classId) || !(await sql`select 1 from public.classes where tenant_id=${t} and id=${classId}`).length) return { error: '반을 찾을 수 없습니다' };
  const { error: updErr } = await tryWrite(sql, s => s`update public.classes set pending_teacher_id=null, pending_teacher_date=null, pending_teacher_reason=null where id=${classId}`);
  if (updErr) return { error: updErr.message };
  await audit(sql, t, actor, 'class_handover_cancel', 'class', { classId });
  return { ok: true };
}
/** handover.ts moveLiveSlotTeacher — 옛 담임이 맡던 지금·앞 교시를 새 담임에게(지난 구간은 어제로 마감 행을 남긴다). */
async function moveLiveSlotTeacher(ctx, { classIds, fromTeacherId, toTeacherId }) {
  const { sql, t, R, S } = ctx;
  const today = R.kstToday(), yesterday = S.preserve.dayBefore(today);
  let moved = 0;
  const targets = await sql`select id::text id, class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time,
      valid_from::text valid_from, valid_to::text valid_to, teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group
    from public.class_schedules where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and teacher_id=${fromTeacherId} and (valid_to is null or valid_to >= ${today}::date)`;
  if (!targets.length) return { moved };
  const splittable = targets.filter(x => !x.valid_from || x.valid_from.slice(0, 10) < today);
  const r = await tryWrite(sql, async s => {
    if (splittable.length) await insertSlots(s, splittable.map(x => ({ tenant_id: t, class_id: x.class_id, day_of_week: x.day_of_week, start_time: x.start_time, end_time: x.end_time,
      valid_from: x.valid_from, valid_to: yesterday, teacher_id: x.teacher_id, classroom_id: x.classroom_id, slot_teacher_label: x.slot_teacher_label, slot_room_label: x.slot_room_label,
      period_label: x.period_label, merge_group: x.merge_group })));
    const splitIds = splittable.map(x => x.id), rest = targets.filter(x => !splitIds.includes(x.id)).map(x => x.id);
    let n = 0;
    if (splitIds.length) n += (await s`update public.class_schedules set teacher_id=${toTeacherId}, valid_from=${today}::date where id = any(${splitIds}::uuid[]) returning id`).length;
    if (rest.length) n += (await s`update public.class_schedules set teacher_id=${toTeacherId} where id = any(${rest}::uuid[]) returning id`).length;
    return n;
  });
  return r.error ? { moved, error: r.error.message } : { moved: r.data };
}
async function applyHandover(ctx, actorId, [, formData]) {
  const { sql, t, R, X } = ctx;
  const classId = String(formData.get('classId') ?? '').trim();
  if (!classId) return { error: '반 ID가 누락되었습니다' };
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 관리 권한이 없습니다' };
  const [klass] = UUID.test(classId) ? await sql`select class_name, teacher_id::text teacher_id, pending_teacher_id::text pending_teacher_id from public.classes where tenant_id=${t} and id=${classId}` : [];
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  if (!klass.pending_teacher_id) return { error: '예약된 인수인계가 없습니다' };
  if (!(await isAssignableTeacher(ctx, klass.pending_teacher_id))) return { error: '예정된 강사가 더 이상 유효하지 않습니다(퇴사·역할 변경). 인수인계를 다시 예약해주세요.' };
  const { error: updErr } = await tryWrite(sql, s => s`update public.classes set teacher_id=${klass.pending_teacher_id}, pending_teacher_id=null, pending_teacher_date=null, pending_teacher_reason=null where id=${classId}`);
  if (updErr) return { error: updErr.message };
  const slots = klass.teacher_id ? await moveLiveSlotTeacher(ctx, { classIds: [classId], fromTeacherId: klass.teacher_id, toTeacherId: klass.pending_teacher_id }) : { moved: 0 };
  await audit(sql, t, actor, 'class_handover_apply', 'class', { classId, previousTeacherId: klass.teacher_id, newTeacherId: klass.pending_teacher_id,
    effectiveDate: R.kstToday(), slotsMoved: slots.moved }, klass.class_name);
  return { ok: true };
}

// ── actions.ts 임시 위임(createClassDelegation · revokeClassDelegation) ─────────────────────────────────────────────
async function requireDelegationWrite(ctx, actorId, classId) {
  const { sql, t, R, X } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { ok: false, error: '반 관리 권한이 없습니다' };
  if (!classId) return { ok: false, error: '반 정보가 없습니다' };
  const [klass] = UUID.test(classId) ? await sql`select class_name, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${classId}` : [];
  if (!klass) return { ok: false, error: '반을 찾을 수 없습니다' };
  return { ok: true, actor, klass };
}
async function createClassDelegation(ctx, actorId, [, formData]) {
  const { sql, t, S } = ctx;
  const classId = String(formData.get('classId') ?? '').trim(), delegateUserId = String(formData.get('delegateUserId') ?? '').trim();
  const fromDate = String(formData.get('fromDate') ?? '').trim(), toDate = String(formData.get('toDate') ?? '').trim() || fromDate;
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 200) || null;
  const gate = await requireDelegationWrite(ctx, actorId, classId);
  if (!gate.ok) return { error: gate.error };
  const { actor, klass } = gate;
  if (!delegateUserId) return { error: '대신 맡을 선생님을 선택해주세요' };
  if (delegateUserId === klass.teacher_id) return { error: '이미 이 반 담임입니다' };
  const rangeError = S.delegation.validateDelegationRange(fromDate, toDate);
  if (rangeError) return { error: rangeError };
  if (!(await isAssignableTeacher(ctx, delegateUserId))) return { error: '유효한 강사가 아닙니다' };
  // 2.0은 관리 클라이언트(RLS 우회)로 넣는다 — 같은 접속(복사본 관리 계정)으로, 지점은 직접 건다.
  try {
    await sql.savepoint(s => s`insert into public.class_delegations (tenant_id, class_id, delegate_user_id, from_date, to_date, reason, created_by)
      values (${t}, ${classId}, ${delegateUserId}, ${fromDate}, ${toDate}, ${reason}, ${actor.id})`);
  } catch (e) { return { error: e?.message ?? '저장에 실패했습니다' }; }
  await audit(sql, t, actor, 'class_delegate', 'class', { delegateUserId, fromDate, toDate }, klass.class_name);
  await notifyUsers(sql, [{ tenantId: t, recipientId: delegateUserId, type: 'class_delegation', title: '대신 맡을 수업이 생겼습니다',
    body: `${klass.class_name} 반을 ${S.delegation.delegationRangeLabel(fromDate, toDate)}에 대신 맡습니다. 원스크린 반 목록의 '위임'에서 보입니다.`, link: '/onescreen', actorId: actor.id }]);
  return { ok: true };
}
async function revokeClassDelegation(ctx, actorId, [, formData]) {
  const { sql, t } = ctx;
  const delegationId = String(formData.get('delegationId') ?? '').trim();
  if (!delegationId) return { error: '위임 정보가 없습니다' };
  const [row] = UUID.test(delegationId) ? await sql`select id::text id, class_id::text class_id, delegate_user_id::text delegate_user_id, revoked_at from public.class_delegations
    where tenant_id=${t} and id=${delegationId}` : [];
  if (!row) return { error: '위임을 찾을 수 없습니다' };
  if (row.revoked_at) return { ok: true };
  const gate = await requireDelegationWrite(ctx, actorId, row.class_id);
  if (!gate.ok) return { error: gate.error };
  const { actor, klass } = gate;
  try {
    await sql.savepoint(s => s`update public.class_delegations set revoked_at=now(), revoked_by=${actor.id} where id=${delegationId} and tenant_id=${t} and revoked_at is null`);
  } catch (e) { return { error: e?.message ?? '저장에 실패했습니다' }; }
  await audit(sql, t, actor, 'class_delegate_revoke', 'class', { delegationId, delegateUserId: row.delegate_user_id }, klass.class_name);
  return { ok: true };
}

// ── 2.0 features/timetable/server/actions.ts changeClassLevel(반 상세 '레벨') ───────────────────────────────────────
async function changeClassLevel(ctx, actorId, [classId, change]) {
  const { sql, t, R, X, S } = ctx;
  const actor = await actAs(sql, t, R, X, actorId);
  if (!actor) return { error: '반 관리 권한이 없습니다' };
  if (!classId) return { error: '반 ID가 누락되었습니다' };
  const [klass] = UUID.test(classId) ? await sql`select id::text id, class_name, subject, teacher_id::text teacher_id from public.classes where tenant_id=${t} and id=${classId}` : [];
  if (!klass) return { error: '반을 찾을 수 없습니다' };
  const levelRows = await sql`select abbreviation, full_name from public.english_levels where tenant_id=${t} order by sort_order`;
  const order = levelRows.length > 0 ? levelRows.map(l => ({ abbreviation: l.abbreviation, fullName: l.full_name ?? '' })) : S.level.DEFAULT_ENGLISH_LEVELS;
  const leveled = S.level.applyLevelChange(klass.class_name, change, order);
  const newName = leveled ? S.name.normalizeClassName(leveled) : leveled;
  if (!newName) return { error: '이 반은 레벨 규칙(예: DP3)이 아니거나 더 올릴/내릴 수 없습니다' };
  const reserved = S.name.reservedClassNameReason(newName);
  if (reserved) return { error: reserved };
  const guarded = await writeWithClassNameGuard(sql, t, S, actor, {
    target: { tenantId: t, subject: klass.subject, name: newName, excludeId: classId }, today: R.kstToday(), request: null, canFree: async () => true,
    write: () => tryWrite(sql, s => s`update public.classes set class_name=${newName} where id=${classId}`.then(() => true)),
    savedClassId: () => classId, failMessage: '반 이름을 바꾸지 못했습니다. 잠시 후 다시 시도해주세요.',
  });
  if (!guarded.ok) {
    if (!('conflict' in guarded)) return { error: guarded.error };
    const c = guarded.conflict;
    const hint = c.freeTo ? `반 수정 화면에서 '${newName}'(으)로 저장하면 그 반 이름을 비울지 묻습니다.` : S.conflict.classNameConflictHint(c);
    return { error: hint ? `${c.message} ${hint}` : c.message };
  }
  await audit(sql, t, actor, 'class_update', 'class', { classId, changed: ['반 이름'], changes: [{ field: '반 이름', from: klass.class_name, to: newName }], note: '레벨 변경' }, newName);
  return { newName };
}
const levelArgs = args => { if (args.length !== 2 || typeof args[0] !== 'string' || !UUID.test(args[0]) || !['number-up', 'number-down', 'class-up', 'class-down'].includes(args[1])) throw bad(); return args; };

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASSES = 'features/classes/server/actions.ts';
const ENROLLMENTS = 'features/enrollments/server/actions.ts';
const ACTIONS = {
  createClass: { module: CLASSES, args: formAction, run: createClass },
  updateClass: { module: CLASSES, args: formAction, run: updateClass },
  createEnrollment: { module: ENROLLMENTS, args: formAction, run: createEnrollment },
  setEnrollmentLabSeparate: { module: 'features/enrollments/server/lab-separate-actions.ts', args: labArgs, run: setEnrollmentLabSeparate },
  rescheduleEnrollment: { module: 'features/enrollments/server/scheduled-actions.ts', args: scheduleArgs(true), run: rescheduleEnrollment },
  cancelScheduledEnrollment: { module: 'features/enrollments/server/scheduled-actions.ts', args: scheduleArgs(false), run: cancelScheduledEnrollment },
  archiveClass: { module: CLASSES, args: formAction, run: archiveClass },
  endClassTerm: { module: CLASSES, args: formAction, run: endClassTerm },
  reopenClassTerm: { module: CLASSES, args: formAction, run: reopenClassTerm },
  scheduleHandover: { module: CLASSES, args: formAction, run: scheduleHandover },
  cancelHandover: { module: CLASSES, args: formAction, run: cancelHandover },
  applyHandover: { module: CLASSES, args: formAction, run: applyHandover },
  createClassDelegation: { module: CLASSES, args: formAction, run: createClassDelegation },
  revokeClassDelegation: { module: CLASSES, args: formAction, run: revokeClassDelegation },
  changeClassLevel: { module: 'features/timetable/server/actions.ts', args: levelArgs, run: changeClassLevel },
};

/** rules = 수업목록 화면 규칙(loadRules) · extra = 시간표 저장의 loadExtra(권한 표·역할 이름 …) · readers = { readSettings(sql, t) }. */
export function classesActions(rules, extra, readers) {
  return Object.fromEntries(Object.entries(ACTIONS).map(([name, a]) => [name, {
    validate: raw => {
      if (!plain(raw) || raw.module !== a.module || !Array.isArray(raw.args) || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      return { actor: raw.actor ?? null, args: a.args(raw.args) };
    },
    run: async ({ sql, body, tenantId, importV2 }) => {
      const [R, X, S] = await Promise.all([rules(importV2), extra(importV2), loadSaveRules(importV2)]);
      // 원생 상태(대기·퇴원) 담당 = 시간표와 같은 판정(readPeople statusIds) — 배정 종료일 같은 상태 변경 게이트에 쓴다.
      const { statusIds } = await readPeople(sql, tenantId, R, X);
      return a.run({ sql, t: tenantId, R, X, S, statusIds, importV2, readers: { readSettings: (s, t) => readers.readSettings(s, t, R) } }, body.actor, body.args);
    },
  }]));
}
export { loadSaveRules, createClass, updateClass, createEnrollment };
