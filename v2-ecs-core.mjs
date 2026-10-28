// 2.0 화면 · 강사 시트(ECS) — 공용 바탕: 2.0 순수 규칙(importV2) · 학원 설정 · 보는 사람(권한) · 반 게이트.
// v2-ecs-props.mjs(2.0 page.tsx가 부품에 넘기는 props)와 v2-ecs-save.mjs(2.0 서버 액션)가 같은 함수를 쓴다 — 두 벌이면 보기와 저장이 갈린다.
// 3.0엔 로그인이 없어 '보는 사람 = 저장하는 사람'을 3.0 띠에서 고른다(호스트가 v2-host-actor로 알려 준다). 그 사람의 2.0 권한 표
// (역할 기본 + 학원 설정 덮어쓰기 + 개인 예외)와 강사 스코프(담임 반 ∪ 그 주 교시 담당 ∪ 위임 ±7일)로 2.0 게이트를 그대로 다시 잰다.
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';
import { scrub } from './domain-snapshot-core.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
let rulesPromise = null, asOfDay = null;
export let rulesSync = null;

/** 2.0 순수 모듈 — 한 객체로 펼친다(같은 이름으로 다른 값을 내보내는 자리는 없다 — verify가 잠근다). 권한 표·역할 이름은 이름이 겹쳐 따로 둔다. */
export function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [mods, perms, roles] = await Promise.all([Promise.all(MODULES.map(p => importV2(p))), importV2('lib/permissions.ts'), importV2('lib/auth/role-hierarchy.ts')]);
    return (rulesSync = Object.freeze(Object.assign({}, ...mods, { perms, ROLE_LABEL: roles.ROLE_LABEL })));
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}
export const MODULES = [
  'features/class-sheets/lib/grid.ts', 'features/class-sheets/lib/grid-rows.ts', 'features/class-sheets/lib/period-label.ts',
  'features/class-sheets/lib/plan-codec.ts', 'features/class-sheets/lib/goal-areas.ts', 'features/class-sheets/lib/week.ts',
  'features/class-sheets/lib/holiday.ts', 'features/class-sheets/lib/roster-form.ts', 'features/class-sheets/lib/roster-order.ts',
  'features/class-sheets/lib/month.ts', 'features/class-sheets/lib/month-assemble.ts', 'features/class-sheets/lib/month-plan.ts',
  'features/class-sheets/lib/plan-line.ts', 'features/class-sheets/lib/save-keys.ts', 'features/class-sheets/lib/edit-audit.ts', 'features/class-sheets/lib/goals-board.ts', 'features/class-sheets/lib/seat-day.ts', 'features/class-sheets/server/seat-day-assemble.ts',
  'features/class-sheets/shouting.ts', 'features/class-sheets/landing-teacher.ts', 'features/class-sheets/face-nav.ts',
  'features/class-sheets/view-prefs.ts', 'features/class-sheets/today-order.ts', 'features/class-sheets/font-size.ts',
  'features/attendance/effective-records.ts', 'features/attendance/calendar.ts', 'features/attendance/live/seating-floors.ts',
  'features/attendance/save-targets.ts', 'features/attendance/auto-units.ts', 'features/attendance/edit-window.ts', 'features/attendance/session-units.ts',
  'features/attendance/units-audit.ts', 'features/attendance/makeup-write.ts', 'features/attendance/teacher-axis.ts',
  'features/timetable/lib/week.ts', 'features/timetable/lib/periods.ts', 'features/timetable/lib/teacher-label.ts',
  'features/classes/english-track.ts', 'features/classes/class-name-as-of.ts', 'features/owner/defaults.ts', 'features/owner/preset.ts',
  'features/owner/month-plan-texts.ts', 'features/owner/lesson-profile.ts', 'features/periods/resolve.ts', 'features/enrollments/eligibility.ts',
  'features/textbooks/plan-expand.ts', 'features/textbooks/plan-compare.ts', 'features/textbooks/lesson-schedule.ts', 'features/textbooks/plan-siblings.ts', 'features/textbooks/cell-lessons.ts', 'features/textbooks/lesson-relay.ts', 'features/textbooks/plan-delete.ts', 'features/textbooks/shift-undo.ts', 'features/textbooks/shift-key.ts', 'features/textbooks/import-undo.ts', 'features/class-sheets/lib/carry-marks.ts',
  'features/teacher-view/i18n.ts', 'features/teacher-view/view-prefs.ts', 'features/teacher-view/teacher-name.ts', 'lib/modules.ts', 'lib/date-kst.ts',
  // 오늘 면(v2-ecs-today.mjs — 2.0 getEcsToday · page.tsx 오늘 갈래)
  'features/class-sheets/lib/today-own-slots.ts', 'features/class-sheets/lib/makeup-roster.ts', 'features/class-sheets/lib/split-card.ts', 'features/report-admin/english-writing.ts',
  // (class-splits/period.ts는 addDays·dowOf를 다른 뜻으로 내보내 여기 펼치지 않는다 — v2-ecs-today.mjs가 따로 부른다)
  'features/makeups/config.ts', 'features/makeups/types.ts', 'features/makeups/command-parse.ts',
];

// ── PORTED: 2.0 원문 그대로(불러올 수 없는 자리 — 설정 타입 파일이 아이콘 tsx를 끌어온다). verify가 원문과 비교한다. ──
/** features/owner/resolve.ts — deepMerge · normalizeHolidays · normalizeSubjects */
const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
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
export function normalizeSubjects(arr, base) {
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
/** features/owner/skill-areas.ts — DEFAULT_ENGLISH_SKILL_AREAS · resolveSkillAreas · skillAreaLabelOf */
export const DEFAULT_ENGLISH_SKILL_AREAS = [
  { key: 'vocab', label: 'Vocab', color: 'blue' }, { key: 'listening', label: 'Listening', color: 'purple' },
  { key: 'reading', label: 'Reading', color: 'green' }, { key: 'grammar', label: 'Grammar', color: 'amber' },
  { key: 'writing', label: 'Writing', color: 'rose' }, { key: 'speaking', label: 'Speaking', color: 'gold' },
];
export function resolveSkillAreas(subject) {
  if (!subject) return [];
  const stored = subject.skillAreas ?? [];
  if (stored.length > 0) return stored;
  if (subject.key === "english") return [...DEFAULT_ENGLISH_SKILL_AREAS];
  return [];
}
export function skillAreaLabelOf(
  areas,
  key,
) {
  const hit = areas.find((a) => a.key === key);
  if (hit) return { label: hit.label, known: true };
  return { label: key, known: false };
}
// ── PORTED 끝 ──

/** 복사본의 '오늘'(백업 시각의 KST 날짜) — 3.0 전체가 쓰는 같은 기준일. */
export async function copyDay() {
  if (!asOfDay) { const { directory } = await activeBackup(); const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); asOfDay = new Date(new Date(m.capturedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  return asOfDay;
}
export const isoDay = v => (v instanceof Date ? new Date(v.getTime() + 9 * 3600000).toISOString().slice(0, 10) : String(v).slice(0, 10));
export const isoAt = v => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(v).toISOString());
/** 3.0 전 화면처럼 자유 글의 연락처를 가린다. 가린 글이 든 칸은 저장이 그 칸을 덮지 않는다(v2-ecs-save.mjs `masked`). */
export const shown = v => (v == null ? v : scrub(v));
export const masked = v => v != null && scrub(v) !== v;

/** 학원 설정 — 2.0 `getTenantSettings`→`resolveSettings`의 운영·모듈·권한 칸. */
export async function readSettings(sql, t, R) {
  const [row] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
  const stored = row?.data ?? null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const ops = deepMerge(base.operations, isPlainObject(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, isPlainObject(stored) ? stored.modules : undefined);
  const operations = { ...ops, subjects: normalizeSubjects(ops.subjects, base), holidays: normalizeHolidays(ops.holidays) };
  const disabled = R.normalizeDisabledModules(mods.disabled);
  const english = operations.subjects.find(s => s.key === 'english');
  const permissions = { ...base.permissions, ...(isPlainObject(stored?.permissions) ? stored.permissions : {}) };
  // 보강 운영(2.0 resolveSettings: normalizeMakeupSettings(merged.makeups)) — 오늘 면이 보강 참여를 읽을지 정한다.
  const makeups = R.normalizeMakeupSettings(deepMerge(base.makeups, isPlainObject(stored) ? stored.makeups : undefined));
  return { operations, disabled, english, skillAreas: resolveSkillAreas(english), holidays: R.buildHolidayMap(operations.holidays), permissions, makeups,
    preset: R.presetOfStored(stored), eieOn: R.isModuleEnabled(disabled, 'eie'), textbooksOn: R.isModuleEnabled(disabled, 'textbooks') };
}

const RANK = ['master', 'admin', 'manager'];
/** 볼 수 있는 사람 — ECS 권한이 '없음'이 아닌 재직 직원(2.0 `requireAccess("ecs")`와 같은 권한 표). 운영자 계정은 뺀다(시간표·출석부 화면과 같은 규약).
 *  원장 먼저, 같은 역할은 이름순. 메뉴별 접근 수준도 함께(쓰기 판정이 같은 표를 본다). */
export async function readViewers(sql, t, R, env) {
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role, ui_prefs, teacher_view_lang from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`.catch(() => []),
  ]);
  const operators = new Set(supers.map(s => s.id));
  const matrix = R.perms.resolveMatrix(Array.isArray(env.permissions.overrides) ? env.permissions.overrides : []);
  const userOverrides = Array.isArray(env.permissions.userOverrides) ? env.permissions.userOverrides : [];
  return users.filter(u => !operators.has(u.id)).map(u => {
    const m = R.perms.applyUserOverrides(matrix, u.id, u.role, userOverrides), level = menu => R.perms.accessLevel(u.role, menu, m);
    // 화면 언어 — 2.0 getTeacherViewLang: 강사 화면(선생님 역할)만 계정 설정·관리자 지정·이름으로 고르고, 그 밖은 한국어.
    const lang = u.role === 'teacher' ? R.resolveSheetLang(R.readTeacherLangPref(u.ui_prefs ?? null), R.parseSheetLang(u.teacher_view_lang), u.display_name) : R.DEFAULT_SHEET_LANG;
    return { id: u.id, name: u.display_name, systemRole: u.role, roleLabel: R.ROLE_LABEL[u.role] ?? '', uiPrefs: u.ui_prefs ?? null, lang,
      levels: { ecs: level('ecs'), attendance: level('attendance'), englishName: level('student_english_name'), textbooks: level('textbooks') } };
  }).filter(u => u.levels.ecs !== 'none')
    .sort((a, b) => (RANK.includes(a.systemRole) ? RANK.indexOf(a.systemRole) : RANK.length) - (RANK.includes(b.systemRole) ? RANK.indexOf(b.systemRole) : RANK.length) || a.name.localeCompare(b.name, 'ko'));
}
export const editorsOf = viewers => viewers.map(v => ({ id: v.id, name: v.name, role: v.roleLabel }));
export const canWriteLevel = level => level === 'full' || level === 'scoped';

/** 2.0 `effectiveTeacherId` — 선생님 역할이면 그 사람(겸직 강사뷰 쿠키는 3.0에 없다). `getTeacherScope` = 그 사람이 담임인 반 전부. */
export async function teacherScopeOf(sql, t, viewer) {
  if (viewer.systemRole !== 'teacher') return null;
  const rows = await sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${viewer.id}`;
  return { teacherId: viewer.id, classIds: rows.map(r => r.id) };
}
/** 2.0 `englishAssistantClassIdsOf` — 교시 담당(부담임)인 영어 반. 주를 주면 그 주에 실제로 도는 교시가 있는 반만. */
export async function assistantClassIds(sql, t, R, teacherId, weekMonday) {
  const rows = await sql`select s.class_id::text class_id, s.day_of_week::text day_of_week, s.valid_from::text valid_from, s.valid_to::text valid_to
    from public.class_schedules s join public.classes c on c.id=s.class_id where s.tenant_id=${t} and s.teacher_id=${teacherId} and c.subject='english'
    ${weekMonday ? sql`and s.valid_from <= ${R.shiftDays(weekMonday, 6)} and (s.valid_to is null or s.valid_to >= ${weekMonday})` : sql``}`;
  if (!weekMonday) return [...new Set(rows.map(r => r.class_id))];
  const by = new Map(); for (const r of rows) (by.get(r.class_id) ?? by.set(r.class_id, []).get(r.class_id)).push({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to });
  return [...by].filter(([, slots]) => R.hasLiveSlotInWeek(weekMonday, slots)).map(([id]) => id);
}
/** 2.0 `ecsDelegatedClassIds` — 오늘 ±7일에 걸친, 되돌리지 않은 임시 위임. */
export async function delegatedClassIds(sql, t, R, teacherId, today) {
  if (!teacherId) return [];
  const rows = await sql`select distinct class_id::text id from public.class_delegations where tenant_id=${t} and delegate_user_id=${teacherId} and revoked_at is null
    and from_date <= ${R.addDays(today, 7)} and to_date >= ${R.addDays(today, -7)}`;
  return rows.map(r => r.id);
}

/** 2.0 `fetchJjManagedClassIds`(classes/server/delegation.ts) — JJ 보고서 담당(학원 설정 specialAccess.jjReportManagerIds)이 그날 맡는 반 =
 *  그날 JJ 자리 교시(담당 없음 + JJ 라벨)가 살아 있는 반. 명단에 없으면 조회 없이 []. 2.0 getTeachingClassIds의 위임 갈래에 함께 실린다. */
export async function jjManagedClassIds(sql, t, R, env, userId, date) {
  if (!(env.permissions?.specialAccess?.jjReportManagerIds ?? []).includes(userId)) return [];
  const dow = R.axisDowOf(date);
  if (!dow) return [];
  const rows = await sql`select class_id::text class_id, teacher_id::text teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
    where tenant_id=${t} and day_of_week::text=${dow} and teacher_id is null and slot_teacher_label is not null order by id`;
  return [...new Set(rows.filter(r => { const slot = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: r.valid_from.slice(0, 10), validTo: r.valid_to ? r.valid_to.slice(0, 10) : null };
    return R.isSeatSlot(slot) && R.specialSlotLabel(r.slot_teacher_label) === R.SELF_STUDY_ROOM_LABEL && R.slotLiveOn(slot, date); }).map(r => r.class_id))];
}

/** 2.0 `requireEcsClassAccess` — 같은 순서·같은 거절 문구. 반 표는 복사본에서 그 지점 행만. */
export async function classAccess(sql, t, R, env, viewer, classId, opts = {}) {
  const level = viewer.levels.ecs;
  if (level === 'none') return { ok: false, error: '접근 권한이 없습니다' };
  let scopedClass = true;
  const scope = await teacherScopeOf(sql, t, viewer), today = await copyDay();
  if (scope && !scope.classIds.includes(classId)) {
    const [assistant, delegated] = await Promise.all([assistantClassIds(sql, t, R, scope.teacherId), delegatedClassIds(sql, t, R, scope.teacherId, today)]);
    scopedClass = assistant.includes(classId) || delegated.includes(classId);
    if (!scopedClass && !opts.readOnly) return { ok: false, error: '담당 반이 아닙니다' };
  }
  const canWrite = canWriteLevel(level) && scopedClass;
  if (opts.write && !canWrite) return { ok: false, error: '편집 권한이 없습니다' };
  // 2.0은 모양이 아닌 id도 조회가 빈 값으로 끝나 같은 문구다 — 여기선 uuid 변환 오류로 500이 나지 않게 먼저 거른다.
  const [cls] = UUID.test(classId) ? await sql`select id::text id, class_name, subject, teacher_id::text teacher_id, english_track from public.classes where tenant_id=${t} and id=${classId}` : [];
  if (!cls) return { ok: false, error: '반을 찾을 수 없습니다' };
  const skillAreas = resolveSkillAreas(env.operations.subjects.find(s => s.key === cls.subject));
  if (cls.subject !== 'english' || skillAreas.length === 0) return { ok: false, error: '이 반은 영어 강사 시트 대상이 아닙니다' };
  return { ok: true, access: { user: viewer, tenantId: t, classId: cls.id, className: cls.class_name, subject: cls.subject, teacherId: cls.teacher_id ?? null,
    englishTrack: R.readEnglishTrack(cls), canWrite, skillAreas, scope } };
}

/** 2.0 `getTeacherEnglishNames` — 영어 화면일 때만, 한국어 이름 → 영어 이름(동명이인은 통째로 뺀다). */
export async function teacherEnglishNames(sql, t, lang) {
  if (lang !== 'en') return {};
  const rows = await sql`select display_name, english_name from public.users where tenant_id=${t} and english_name is not null`;
  const map = {}, ambiguous = new Set();
  for (const r of rows) {
    const ko = (r.display_name ?? '').trim(), en = (r.english_name ?? '').trim();
    if (!ko || !en || ko === en) continue;
    if (ambiguous.has(ko)) continue;
    const seen = map[ko];
    if (seen !== undefined && seen !== en) { ambiguous.add(ko); delete map[ko]; continue; }
    map[ko] = en;
  }
  return map;
}
/** 강사 라벨 해석기 — 2.0 `getTeacherLabelMap`(시간표와 같은 단일 소스). 방 이름 = 등록된 강의실(FK 먼저). */
export async function readNames(sql, t, R) {
  const [names, rooms] = await Promise.all([
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    sql`select id::text id, name from public.classrooms where tenant_id=${t}`,
  ]);
  return { labelMap: R.buildTeacherLabelMap(names.map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' }))),
    roomById: new Map(rooms.map(r => [r.id, r.name])), roomNames: rooms.map(r => r.name) };
}
export const roomOf = (R, names, s) => R.canonicalRoomName(R.resolveRoomName({ slotClassroomName: s.classroom_id ? (names.roomById.get(s.classroom_id) ?? null) : null, slotRoomLabel: s.slot_room_label ?? null }), names.roomNames);
/** 예약된 개명 — 2.0 `getClassNameAsOfIndex`(되돌린 가져오기 제외). */
export async function readClassNameAsOf(sql, t, R, today) {
  const rows = await sql`select id::text id, reference_date::text reference_date, payload->'apply'->'classUpdates' updates from public.timetable_snapshots
      where tenant_id=${t} and reference_date > ${today} order by reference_date limit 50`;
  if (!rows.length) return new Map();
  const restored = new Set((await sql`select snapshot_id::text snapshot_id from public.timetable_import_logs where tenant_id=${t} and snapshot_id = any(${rows.map(r => r.id)}::uuid[]) and restored_at is not null`).map(l => l.snapshot_id));
  const renames = [];
  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    for (const u of Array.isArray(r.updates) ? r.updates : []) if (u?.classId && u.className) renames.push({ classId: u.classId, from: u.prevClassName ?? null, to: u.className, date: r.reference_date.slice(0, 10) });
  }
  return R.buildClassNameAsOfIndex(renames);
}
