// 2.0 화면 — 수업목록 저장(2단계): 반 만들기·고치기 = 2.0 features/classes/server/actions.ts createClass · updateClass를 Docker 복사본에.
// 판정 순서·문구·반환 모양(ClassFormState)·감사로그(class_create · class_update — changes/changed/newTeacherId) 2.0 그대로.
// 함께 옮긴 2.0 서버 모듈: class-name-guard.ts(같은 과목 같은 이름 — 종강·폐지 반 이름 비우기·되돌리기·기록) · schedule-sync.ts(현재 교시
// 읽기·지우기) · overlap-detect.ts(겹침 경고 — 막지 않음). 판정·조립은 2.0 순수 함수(importV2) 그대로.
// 쓰기는 2.0처럼 사용자 역할(authenticated)로 — RLS·보호 트리거가 2.0과 같게 본다. 2.0은 트랜잭션 없이 지우고 다시 넣다 실패하면 옛 행을
// 되살리는데, 여기선 지우기·넣기를 저장점 하나에 담아 실패하면 저장점째 되돌아간다(2.0 '되살리기 성공' 갈래와 같은 결과 · 같은 문구).
import { V2Error } from './v2-screens.mjs';
import { actAs, audit, asAuthenticated } from './v2-timetable-save.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

let rulesPromise = null;
function loadSaveRules(importV2) {
  rulesPromise ??= (async () => {
    const [name, conflict, english, color, label, notice, preserve, periods, overlap, subjects] = await Promise.all([
      'features/classes/class-name.ts', 'features/classes/class-name-conflict.ts', 'features/classes/english-track.ts', 'lib/color-utils.ts',
      'features/timetable/lib/teacher-label.ts', 'features/classes/period-notice.ts', 'features/classes/schedule-preserve.ts', 'features/timetable/lib/periods.ts',
      'features/classes/overlap.ts', 'features/owner/subjects.ts',
    ].map(p => importV2(p)));
    return { name, conflict, english, color, label, notice, preserve, periods, overlap, subjects };
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

// ── 공통 틀 동작 ─────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASSES = 'features/classes/server/actions.ts';
const ACTIONS = {
  createClass: { module: CLASSES, args: formAction, run: createClass },
  updateClass: { module: CLASSES, args: formAction, run: updateClass },
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
      return a.run({ sql, t: tenantId, R, X, S, readers: { readSettings: (s, t) => readers.readSettings(s, t, R) } }, body.actor, body.args);
    },
  }]));
}
export { loadSaveRules, createClass, updateClass };
