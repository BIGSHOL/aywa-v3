// 2.0 화면 · 강사 시트 · 영어(ECS) — V2-SCREENS.md (원장 2026-10-28 *"바로가기를 만들지말고 새 페이지를 만들어 db는 docker로"*).
// 2.0 `/ecs`(src/app/(shell)/ecs/**)가 보여 주는 네 면을 Docker 복사본에서 같은 규칙으로 다시 조립한다.
//  · 반 목록(view=list)   = 2.0 `getSheetLanding` — 그 주에 수업이 있는 반만, EiE / 인재원 영어 좌우 2단, 담임별 묶음.
//  · 반 주간 시트(sheet)   = 2.0 `getClassSheetWeek` — 영역 × 날짜 계획 칸 + 교시별 학생 기록 칸.
//  · 월간(month)          = 2.0 `getClassSheetMonth` — 달력 ↔ 진도표, EiE는 계획(MP).
//  · 오늘(today)          = 2.0 `EcsTodayFace` 시트 모드 — 고른 선생님의 그날 반을 교시 순서로(그날 열만).
// 조회는 서버 전용 모듈(supabase·server-only)이라 불러올 수 없어서 같은 표·칸·조건을 SQL로 옮기고, 판정·조립은 2.0 순수 함수를
// importV2로 그대로 쓴다. 화면 문구는 2.0 사전(SHEET_DICT)의 한국어 값을 그대로 내려보낸다(`t`).
// 2.0과 다른 것: 3.0 시안엔 로그인이 없어 원장(전체 범위)의 눈으로 보고, 2.0이 계정(`ui_prefs.ecs`)에 두는 보기 설정은 주소에 둔다.
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';
import { scrub } from './domain-snapshot-core.mjs';
import { V2Error } from './v2-screens.mjs';

const ID = 'ecs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
let rulesPromise = null, rulesSync = null, asOfDay = null;

function loadRules(importV2) {
  rulesPromise ??= (async () => {
    // 모듈끼리 같은 이름으로 다른 값을 내보내는 자리는 없다(verify가 잠근다) — 한 객체로 펼친다.
    const mods = await Promise.all(MODULES.map(p => importV2(p)));
    return (rulesSync = Object.freeze(Object.assign({}, ...mods)));
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}
export const MODULES = [
  'features/class-sheets/lib/grid.ts', 'features/class-sheets/lib/grid-rows.ts', 'features/class-sheets/lib/period-label.ts',
  'features/class-sheets/lib/plan-codec.ts', 'features/class-sheets/lib/goal-areas.ts', 'features/class-sheets/lib/week.ts',
  'features/class-sheets/lib/holiday.ts', 'features/class-sheets/lib/roster-form.ts', 'features/class-sheets/lib/roster-order.ts',
  'features/class-sheets/lib/withdrawn-row.ts', 'features/class-sheets/lib/attendance-label.ts', 'features/class-sheets/lib/makeup-roster.ts',
  'features/class-sheets/lib/month.ts', 'features/class-sheets/lib/month-assemble.ts', 'features/class-sheets/lib/month-plan.ts',
  'features/class-sheets/lib/month-plan-compare.ts', 'features/class-sheets/lib/month-plan-sheet-style.ts', 'features/class-sheets/lib/month-plan-title-fit.ts',
  'features/class-sheets/lib/goal-match.ts', 'features/class-sheets/lib/plan-line.ts', 'features/class-sheets/lib/today-own-slots.ts', 'features/class-sheets/lib/today-columns.ts',
  'features/class-sheets/lib/shift-visible.ts', 'features/class-sheets/shouting.ts', 'features/class-sheets/landing-groups.ts',
  'features/class-sheets/landing-programs.ts', 'features/class-sheets/landing-shouting.ts', 'features/class-sheets/landing-summary.ts',
  'features/class-sheets/landing-teacher.ts', 'features/class-sheets/face-nav.ts', 'features/class-sheets/chrome.ts',
  'features/class-sheets/view-prefs.ts', 'features/class-sheets/today-order.ts', 'features/teacher-view/i18n.ts',
  'features/teacher-view/school-grade.ts', 'features/teacher-view/student-name.ts', 'features/teacher-view/attitude-label.ts',
  'features/onescreen/attitude.ts', 'features/owner/month-plan-texts.ts', 'features/attendance/effective-records.ts',
  'features/attendance/calendar.ts', 'features/attendance/live/seating-floors.ts', 'features/timetable/lib/week.ts',
  'features/timetable/lib/periods.ts', 'features/timetable/lib/teacher-label.ts', 'features/timetable/scheduled-import.ts',
  'features/classes/english-track.ts', 'features/classes/class-name-as-of.ts', 'features/withdrawals/types.ts',
  'features/owner/defaults.ts', 'features/owner/preset.ts', 'features/periods/resolve.ts', 'features/textbooks/plan-expand.ts',
  'features/textbooks/plan-compare.ts', 'features/textbooks/shift-key.ts', 'lib/modules.ts', 'lib/date-kst.ts', 'lib/ui-prefs/font-size.ts', 'features/class-sheets/font-size.ts',
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
/** features/owner/skill-areas.ts — DEFAULT_ENGLISH_SKILL_AREAS · resolveSkillAreas · skillAreaColorOf */
export const DEFAULT_ENGLISH_SKILL_AREAS = [
  { key: 'vocab', label: 'Vocab', color: 'blue' }, { key: 'listening', label: 'Listening', color: 'purple' },
  { key: 'reading', label: 'Reading', color: 'green' }, { key: 'grammar', label: 'Grammar', color: 'amber' },
  { key: 'writing', label: 'Writing', color: 'rose' }, { key: 'speaking', label: 'Speaking', color: 'gold' },
];
const ROTATION = ['blue', 'purple', 'green', 'amber', 'rose', 'gold', 'primary'];
/** features/owner/settings-types.ts SUBJECT_COLORS */
export const SUBJECT_COLORS = ['primary', 'green', 'blue', 'rose', 'amber', 'danger', 'purple', 'gold', 'neutral'];
export function resolveSkillAreas(subject) {
  if (!subject) return [];
  const stored = subject.skillAreas ?? [];
  if (stored.length > 0) return stored;
  if (subject.key === "english") return [...DEFAULT_ENGLISH_SKILL_AREAS];
  return [];
}
export function skillAreaColorOf(areas, key) {
  const idx = areas.findIndex((a) => a.key === key);
  if (idx < 0) return "neutral";
  const stored = areas[idx].color;
  if (stored && SUBJECT_COLORS.includes(stored)) return stored;
  const builtin = DEFAULT_ENGLISH_SKILL_AREAS.find((a) => a.key === key)?.color;
  if (builtin) return builtin;
  return ROTATION[idx % ROTATION.length];
}
// ── PORTED 끝 ──

/** 2.0 사전에서 이 화면이 쓰는 구역만(한국어). 문구는 여기서 짓지 않는다. */
const DICT_PREFIX = /^(plan|roster|toolbar|landing|month|mp|goals|gap|fill|chrome|face|today|mark|bulk|cell|filter|nav|strip|withdrawn|common|select|popup|banner|studentEnglishName|att\.makeup)\./;
let dictCache = null;
const dictOf = R => (dictCache ??= Object.fromEntries(Object.keys(R.SHEET_DICT).filter(k => DICT_PREFIX.test(k)).map(k => [k, R.sheetT('ko', k)])));

/** 복사본의 '오늘'(백업 시각의 KST 날짜) — 3.0 전체가 쓰는 같은 기준일. */
async function copyDay() {
  if (!asOfDay) { const { directory } = await activeBackup(); const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); asOfDay = new Date(new Date(m.capturedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  return asOfDay;
}
const hm = v => String(v ?? '').slice(0, 5);

/** 학원 설정 — 2.0 `getTenantSettings`→`resolveSettings`의 운영·모듈 칸. */
async function readSettings(sql, t, R) {
  const [row] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
  const stored = row?.data ?? null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const ops = deepMerge(base.operations, isPlainObject(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, isPlainObject(stored) ? stored.modules : undefined);
  const operations = { ...ops, subjects: normalizeSubjects(ops.subjects, base), holidays: normalizeHolidays(ops.holidays) };
  const disabled = R.normalizeDisabledModules(mods.disabled);
  const english = operations.subjects.find(s => s.key === 'english');
  return { operations, disabled, english, skillAreas: resolveSkillAreas(english), holidays: R.buildHolidayMap(operations.holidays),
    eieOn: R.isModuleEnabled(disabled, 'eie'), textbooksOn: R.isModuleEnabled(disabled, 'textbooks'), academy: stored?.profile?.name || row?.name || '' };
}
/** 강사 라벨 해석기 — 2.0 `getTeacherLabelMap`(시간표와 같은 단일 소스). 방 이름 = 등록된 강의실(FK 먼저). */
async function readNames(sql, t, R) {
  const [names, rooms] = await Promise.all([
    sql`select display_name, english_name, status::text status from public.users where tenant_id=${t} and english_name is not null`,
    sql`select id::text id, name from public.classrooms where tenant_id=${t}`,
  ]);
  return { labelMap: R.buildTeacherLabelMap(names.map(u => ({ displayName: u.display_name ?? null, englishName: u.english_name ?? null, active: u.status === 'active' }))),
    roomById: new Map(rooms.map(r => [r.id, r.name])), roomNames: rooms.map(r => r.name) };
}
const roomOf = (R, names, s) => R.canonicalRoomName(R.resolveRoomName({ slotClassroomName: s.classroom_id ? (names.roomById.get(s.classroom_id) ?? null) : null, slotRoomLabel: s.slot_room_label ?? null }), names.roomNames);
/** 예약된 개명 — 2.0 `getClassNameAsOfIndex`(되돌린 가져오기 제외). */
async function readClassNameAsOf(sql, t, R, today) {
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
/** 반 한 개 — 2.0 `requireEcsClassAccess`의 대상 판정(영어 + 영역 설정). 범위는 원장(전체). */
async function readClass(sql, t, R, env, classId) {
  const [c] = await sql`select c.id::text id, c.class_name, c.subject, c.teacher_id::text teacher_id, c.english_track, u.display_name teacher_name, u.english_name teacher_english
    from public.classes c left join public.users u on u.id=c.teacher_id where c.tenant_id=${t} and c.id=${classId}`;
  if (!c) throw new V2Error(404, 'class_not_found', '반을 찾을 수 없습니다');
  if (c.subject !== 'english' || env.skillAreas.length === 0) throw new V2Error(400, 'not_ecs', '이 반은 영어 강사 시트 대상이 아닙니다');
  return { ...c, track: R.readEnglishTrack(c), isEie: R.readEnglishTrack(c) === 'eie' && env.eieOn };
}

// ── 반 목록(view=list) — 2.0 getSheetLanding + landing-list.tsx ───────────────────────────────────────────
async function landing(sql, t, R, env, q, today) {
  const weekMonday = R.mondayOf(q.week || today), weekSunday = R.shiftDays(weekMonday, 6);
  const base = { weekMonday, weekLabel: R.weekLabel(weekMonday), weekRelation: R.weekRelation(weekMonday, today), today, eieOn: env.eieOn,
    textbooksOn: env.textbooksOn, trackFilter: env.eieOn ? (q.track || R.DEFAULT_ECS_ENGLISH_TRACK) : 'all' };
  if (env.skillAreas.length === 0) return { ...base, cards: [], panels: null, groups: [], emptyReason: 'not-configured', trackCounts: { all: 0, eie: 0, injaewon: 0 }, teacherFilter: R.ECS_TEACHER_ALL, teacherOptions: [] };
  const allClasses = await sql`select id::text id, class_name, teacher_id::text teacher_id, english_track from public.classes
    where tenant_id=${t} and subject='english' and is_active and (closed_at is null or closed_at >= ${weekMonday}) order by class_name`;
  const ids = allClasses.map(c => c.id);
  const [teachers, schedules, nameIndex] = await Promise.all([
    sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...new Set(allClasses.map(c => c.teacher_id).filter(Boolean))]}::uuid[])`,
    ids.length ? sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label
      from public.class_schedules where tenant_id=${t} and class_id = any(${ids}::uuid[]) and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})` : [],
    readClassNameAsOf(sql, t, R, today),
  ]);
  const teacherName = new Map(teachers.map(u => [u.id, u.display_name]));
  const byClass = new Map(); for (const s of schedules) (byClass.get(s.class_id) ?? byClass.set(s.class_id, []).get(s.class_id)).push(s);
  // 원장 범위 = 스코프 없음(2.0 ecsVisibleClassFilter가 null). 그 주에 실제로 도는 교시가 있는 반만(hasLiveSlotInWeek).
  const running = allClasses.filter(c => R.hasLiveSlotInWeek(weekMonday, (byClass.get(c.id) ?? []).map(r => ({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }))));
  const trackCounts = { all: running.length, eie: R.keepEnglishTrack(running, 'eie').length, injaewon: R.keepEnglishTrack(running, 'injaewon').length };
  const tracked = R.keepEnglishTrack(running, base.trackFilter).map(c => ({ row: c, teacherId: c.teacher_id ?? null }));
  const teacherOptions = R.buildTeacherOptions(tracked, teacherName);
  const teacherFilter = R.resolveTeacherFilter(q.teacher || R.ECS_TEACHER_ALL, teacherOptions);
  const classes = R.keepTeacher(tracked, teacherFilter).map(x => x.row), classIds = classes.map(c => c.id);
  if (!classIds.length) return { ...base, cards: [], panels: null, groups: [], trackCounts, teacherFilter, teacherOptions,
    emptyReason: running.length > 0 ? 'filtered' : allClasses.length > 0 ? 'no-week-classes' : 'no-classes' };
  const eieIds = classes.filter(c => R.readEnglishTrack({ english_track: c.english_track }) === 'eie').map(c => c.id);
  const [lines, flags] = await Promise.all([
    sql`select class_id::text class_id, plan_date::text plan_date, slot_start::text slot_start, textbook, page_range, progress, homework from public.class_sheet_plan_lines
      where tenant_id=${t} and class_id = any(${classIds}::uuid[]) and plan_date between ${weekMonday} and ${weekSunday}`,
    eieIds.length ? sql`select class_id::text class_id, flag_date::text flag_date, slot_start::text slot_start from public.class_sheet_slot_flags
      where tenant_id=${t} and shouting and class_id = any(${eieIds}::uuid[]) and flag_date between ${weekMonday} and ${weekSunday}` : [],
  ]);
  const showSelfStudy = q.jj !== '0';
  const meaningful = new Map(), all = new Map(), shout = new Map();
  for (const l of lines) {
    const key = `${l.plan_date}|${R.normalizeSlotTime(l.slot_start)}`;
    (all.get(l.class_id) ?? all.set(l.class_id, new Set()).get(l.class_id)).add(key);
    if (R.isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.page_range, progress: l.progress, homework: l.homework })) (meaningful.get(l.class_id) ?? meaningful.set(l.class_id, new Set()).get(l.class_id)).add(key);
  }
  for (const f of flags) (shout.get(f.class_id) ?? shout.set(f.class_id, new Set()).get(f.class_id)).add(R.shoutingKey(f.flag_date.slice(0, 10), f.slot_start));
  const cards = classes.map(c => {
    const slotRows = (byClass.get(c.id) ?? []).map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, validFrom: s.valid_from, validTo: s.valid_to, slotTeacherLabel: s.slot_teacher_label }));
    const scheduled = R.scheduledSlotKeySet(weekMonday, slotRows, { includeSelfStudy: showSelfStudy, holidays: env.holidays });
    const holidayKeys = R.holidaySlotKeySet(weekMonday, slotRows, env.holidays, { includeSelfStudy: showSelfStudy });
    const mine = meaningful.get(c.id) ?? new Set(), counted = new Set(scheduled);
    for (const key of holidayKeys) if (mine.has(key)) counted.add(key);
    let filled = 0; for (const key of counted) if (mine.has(key)) filled += 1;
    const track = R.readEnglishTrack({ english_track: c.english_track });
    let shoutN = null;
    if (track === 'eie') { shoutN = 0; const keys = shout.get(c.id); if (keys) for (const key of counted) if (keys.has(key)) shoutN += 1; }
    const renamed = R.classNameForWeek(nameIndex, c.id, weekMonday, weekSunday, c.class_name, today);
    return { classId: c.id, className: renamed?.name ?? c.class_name, classNameUpcoming: renamed?.upcoming ?? null, teacherId: c.teacher_id ?? null,
      teacherName: c.teacher_id ? (teacherName.get(c.teacher_id) ?? null) : null, englishTrack: track, totalSlots: counted.size, filledSlots: filled,
      holidaySlots: holidayKeys.size, shoutingSlots: shoutN, delegated: false };
  });
  const view = list => {
    const showShouting = R.summarizeShouting(list).classes > 0;
    return R.groupLandingByTeacher(list).map(g => ({ key: g.key, label: g.label, unassigned: g.unassigned, classes: g.summary.classes, showShouting,
      cards: g.cards.map(card => ({ ...card, pct: R.landingCardPct(card), shout: R.shoutingCountOf(card), upcoming: card.classNameUpcoming ? { date: R.monthDay(card.classNameUpcoming.date), name: card.classNameUpcoming.name } : null,
        calFace: card.englishTrack === 'eie' && env.eieOn ? 'mp' : 'cal' })) }));
  };
  const split = R.splitLandingByProgram(cards);
  return { ...base, trackCounts, teacherFilter, teacherOptions, emptyReason: null, cardCount: cards.length,
    panels: split ? split.map(p => ({ key: p.key, label: p.label, groups: view(p.cards) })) : null, groups: split ? [] : view(cards) };
}

/** 그 주에 수업이 있는 영어 반(2.0 랜딩의 `running` — 필터 없는 원장 범위). */
async function weekClassOptions(sql, t, R, ref) {
  const mon = R.mondayOf(ref), sun = R.shiftDays(mon, 6);
  const rows = await sql`select c.id::text id, c.class_name, s.day_of_week::text day_of_week, s.valid_from::text valid_from, s.valid_to::text valid_to
    from public.classes c join public.class_schedules s on s.class_id=c.id and s.valid_from <= ${sun} and (s.valid_to is null or s.valid_to >= ${mon})
    where c.tenant_id=${t} and c.subject='english' and c.is_active and (c.closed_at is null or c.closed_at >= ${mon}) order by c.class_name`;
  const by = new Map(); for (const r of rows) (by.get(r.id) ?? by.set(r.id, { name: r.class_name, slots: [] }).get(r.id)).slots.push({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to });
  return [...by].filter(([, v]) => R.hasLiveSlotInWeek(mon, v.slots)).map(([id, v]) => ({ id, name: v.name }));
}

// ── 반 주간 시트(view=sheet) — 2.0 getClassSheetWeek + sheet-client/period-block/plan-table/roster-table ──────
async function sheetWeek(sql, t, R, env, names, cls, weekParam, today, opts = {}) {
  const weekMonday = R.mondayOf(weekParam || today), weekSunday = R.shiftDays(weekMonday, 6), monthStart = `${weekMonday.slice(0, 7)}-01`;
  const floor = R.withdrawnFloorOf(weekMonday), classId = cls.id, showSelfStudy = opts.jj !== '0';
  const [schedules, enrollments, planLines, goals, marks, attendance, memos, flags, splitCount, nameIndex] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        teacher_id::text teacher_id, classroom_id::text classroom_id, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})`,
    sql`select e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, e.withdrawal_reason,
        s.name, s.school, s.grade, s.english_name, s.withdrawn_at::text withdrawn_at
      from public.enrollments e join public.students s on s.id=e.student_id where e.tenant_id=${t} and e.class_id=${classId}
        and e.start_date <= ${weekSunday} and (e.end_date is null or e.end_date >= ${floor})`,
    sql`select id::text id, plan_date::text plan_date, slot_start::text slot_start, term_mode::text term_mode, skill_area, line_no, textbook, page_range, progress, homework, updated_at
      from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${classId} and plan_date between ${weekMonday} and ${weekSunday} order by plan_date, slot_start, term_mode, line_no`,
    sql`select scope::text scope, period_start::text period_start, role::text role, skill_area, textbook, target_progress from public.class_sheet_goals
      where tenant_id=${t} and class_id=${classId} and ((scope='week' and period_start=${weekMonday}) or (scope='month' and period_start=${monthStart}))`,
    sql`select * from public.class_sheet_student_marks where tenant_id=${t} and class_id=${classId} and mark_date between ${weekMonday} and ${weekSunday}`,
    sql`select id::text id, student_id::text student_id, class_id::text class_id, session_date::text session_date, slot_start::text slot_start, status::text status, note,
        session_units::float8 session_units, recorded_at from public.attendance_records where tenant_id=${t} and class_id=${classId} and session_date between ${weekMonday} and ${weekSunday}`,
    sql`select memo_key, body from public.class_sheet_memos where tenant_id=${t} and class_id=${classId} and week_start=${weekMonday}`,
    sql`select flag_date::text flag_date, slot_start::text slot_start, shouting from public.class_sheet_slot_flags where tenant_id=${t} and class_id=${classId} and flag_date between ${weekMonday} and ${weekSunday}`,
    sql`select count(*)::int n from public.class_splits where tenant_id=${t} and (source_class_id=${classId} or target_class_id=${classId}) and valid_from <= ${weekSunday} and (valid_to is null or valid_to >= ${weekMonday})`,
    readClassNameAsOf(sql, t, R, today),
  ]);
  // 종강·전출 판정 재료 — 이 반 수강이 끝난 학생의 같은 과목 다른 반 수강(2.0과 같은 조건).
  const elsewhereSpans = {}, moved = new Set();
  const ended = [...new Set(enrollments.filter(e => e.end_date).map(e => e.student_id))];
  if (ended.length) {
    const others = await sql`select e.student_id::text student_id, e.class_id::text class_id, e.start_date::text start_date, e.end_date::text end_date, e.is_transferred, c.class_name, c.subject
      from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=${t} and e.class_id <> ${classId} and e.student_id = any(${ended}::uuid[])
        and e.start_date <= ${weekSunday} and (e.end_date is null or e.end_date >= ${floor}) and c.subject = ${cls.subject}`;
    const notWithdrawn = new Set(enrollments.filter(e => !e.withdrawn_at).map(e => e.student_id));
    for (const o of others) {
      (elsewhereSpans[o.student_id] ??= []).push({ start: o.start_date, end: o.end_date, isTransferred: o.is_transferred ?? undefined, classId: o.class_id, className: o.class_name, subject: o.subject });
      if (o.end_date == null && notWithdrawn.has(o.student_id)) moved.add(o.student_id);
    }
  }
  const scheduleRows = schedules.map(s => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, validFrom: s.valid_from, validTo: s.valid_to,
    teacherId: s.teacher_id ?? null, slotTeacherLabel: R.resolveTeacherLabel(s.slot_teacher_label ?? null, names.labelMap), slotRoomLabel: roomOf(R, names, s) }));
  const lines = planLines.map(l => ({ id: l.id, planDate: l.plan_date, slotStart: l.slot_start, termMode: l.term_mode, skillArea: l.skill_area, lineNo: Number(l.line_no),
    textbook: l.textbook ?? null, pageRange: l.page_range ?? null, progress: l.progress ?? null, homework: l.homework ?? null, updatedAt: new Date(l.updated_at).toISOString() }));
  const markRows = marks.map(m => ({ studentId: String(m.student_id), markDate: isoDay(m.mark_date),
    slotStart: String(m.slot_start), status: m.status ?? null, progressNote: m.progress_note ?? null, score: m.score ?? null, listeningLevel: m.listening_level ?? null, memorizedWords: m.memorized_words ?? null }));
  const eff = R.effectiveAttendanceRecords(attendance.map(a => ({ ...a, recorded_at: new Date(a.recorded_at).toISOString(), slot_start: a.slot_start ?? null })));
  const grid = R.buildWeekGrid({
    weekMonday, schedules: scheduleRows,
    enrollments: enrollments.map(e => ({ studentId: e.student_id, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred ?? undefined,
      attendanceDays: e.attendance_days, withdrawnAt: e.withdrawn_at ?? null, withdrawalReason: e.withdrawal_reason ?? null })),
    planLines: lines, marks: markRows, attendance: eff.map(a => ({ studentId: a.student_id, sessionDate: a.session_date, status: a.status })),
    slotMemoKeys: memos.map(m => m.memo_key).filter(k => k.startsWith('slot:')), includeSelfStudy: showSelfStudy,
    activeElsewhereSameSubject: [...moved], subject: cls.subject, elsewhereSpans, holidays: env.holidays,
  });
  // 학생 메타 — 수강 조인분 + (기록만 남은) 부족분.
  const students = {};
  for (const e of enrollments) students[e.student_id] = { name: e.name, school: e.school, grade: e.grade, englishName: e.english_name };
  const rosterIds = new Set(); for (const d of grid.days) for (const s of d.slots) for (const r of s.roster) rosterIds.add(r.studentId);
  for (const a of grid.attendanceOnly) for (const id of a.studentIds) rosterIds.add(id);
  const missing = [...rosterIds].filter(id => !students[id]);
  if (missing.length) for (const s of await sql`select id::text id, name, school, grade, english_name from public.students where tenant_id=${t} and id = any(${missing}::uuid[])`) students[s.id] = { name: s.name, school: s.school, grade: s.grade, englishName: s.english_name };
  const teacherIds = new Set(); for (const d of grid.days) for (const s of d.slots) if (s.teacherId) teacherIds.add(s.teacherId);
  if (cls.teacher_id) teacherIds.add(cls.teacher_id);
  const teacherNames = Object.fromEntries((teacherIds.size ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${[...teacherIds]}::uuid[])` : []).filter(u => u.display_name).map(u => [u.id, u.display_name]));
  // 교시 라벨 — 요일별 교시표(주말은 별도 표)로 슬롯마다(표시 전용).
  const periodsConfig = R.settingsToPeriodsConfig(env.operations);
  const tables = { weekday: R.tableToEntries(R.weekdayTableFor('english', periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const periodLabel = {};
  for (const d of grid.days) for (const s of d.slots) { const l = R.resolvePeriodLabel(s.slotStart, s.slotEnd, tables, R.isWeekendDow(d.dow)); if (l) periodLabel[`${d.date}|${s.slotStart}`] = l; }
  // 교시별 출결 — 옛 '그날 전체' 행은 그날 첫 교시 칸에만.
  const first = {}; for (const d of grid.days) { const f = d.slots[0]?.slotStart; if (f) first[d.date] = R.normalizeSlotTime(f); }
  const att = {};
  for (const a of eff) { const raw = a.slot_start ?? null, cell = raw ? R.normalizeSlotTime(raw) : (first[a.session_date] ?? '');
    att[`${a.student_id}|${a.session_date}|${cell}`] = { status: a.status, note: a.note ? scrub(a.note) : null, units: a.session_units ?? null, slot: raw ? R.normalizeSlotTime(raw) : null }; }
  const markMap = {};
  for (const m of markRows) markMap[`${m.studentId}|${m.markDate}|${R.normalizeSlotTime(m.slotStart)}`] = { status: m.status, progressNote: m.progressNote ? scrub(m.progressNote) : m.progressNote, score: m.score, listeningLevel: m.listeningLevel, memorizedWords: m.memorizedWords };
  const memoMap = Object.fromEntries(memos.map(m => [m.memo_key, scrub(m.body)]));
  const renamed = R.classNameForWeek(nameIndex, classId, weekMonday, weekSunday, cls.class_name, today);
  const fill = R.sheetFillStats(grid);
  return { classId, className: renamed?.name ?? cls.class_name, classNameUpcoming: renamed?.upcoming ? { date: R.monthDay(renamed.upcoming.date), name: renamed.upcoming.name } : null,
    weekMonday, weekLabel: R.weekLabel(weekMonday), weekRelation: R.weekRelation(weekMonday, today), today, monthStart, isEie: cls.isEie, track: cls.track,
    teacherId: cls.teacher_id ?? null, classTeacherName: cls.teacher_id ? (teacherNames[cls.teacher_id] ?? null) : null, teacherNames,
    skillAreas: env.skillAreas.map(a => ({ ...a, tone: skillAreaColorOf(env.skillAreas, a.key) })), goalAreas: R.goalAreasFor(cls.track, env.skillAreas).map(a => ({ ...a, tone: skillAreaColorOf(R.goalAreasFor(cls.track, env.skillAreas), a.key) })),
    grid: sheetGridModel(R, grid, students, periodLabel, markMap, att, today), students, attendance: att, marks: markMap, memos: memoMap,
    goals: goals.map(g => ({ scope: g.scope, periodStart: g.period_start, role: g.role, skillArea: g.skill_area, textbook: g.textbook ?? null, targetProgress: g.target_progress ?? null })),
    shouting: R.shoutingMapOf(flags), fill, showSelfStudy, splitRows: splitCount[0]?.n ?? 0,
    attendanceOnly: grid.attendanceOnly.map(a => ({ date: a.date, names: a.studentIds.map(id => students[id]?.name ?? '?') })), hiddenSpecial: grid.hiddenSpecial,
    // 원장(전체 범위)의 눈 — 2.0에서 출결 권한이 full이면 7일 창 없이 모든 날짜가 열린다.
    canMarkAttendanceByDate: Object.fromEntries(R.weekDatesOf(weekMonday).map(d => [d, true])) };
}
const isoDay = v => (v instanceof Date ? new Date(v.getTime() + 9 * 3600000).toISOString().slice(0, 10) : String(v).slice(0, 10));

/** 학생 줄의 이름 칸 + 한 교시분 칸(2.0 roster-slot-cells: RosterNameCell · RosterSlotCells · WithdrawnSummaryRow 재료). */
function rowBase(R, students, entry) {
  const meta = students[entry.studentId], sg = R.sheetSchoolGrade(meta?.school, meta?.grade, 'ko'), names = R.studentNameParts(meta?.name, meta?.englishName ?? null, 'ko');
  return { studentId: entry.studentId, name: names.primary || '?', secondary: names.secondary, schoolGrade: sg, historical: entry.historical, eligible: entry.eligible,
    isMakeup: !!entry.isMakeup, endedOn: entry.endedOn ?? null, reason: R.reasonDisplay(entry.endedReason, 'ko') };
}
function slotCell(R, marks, att, date, slot, entry, cols) {
  const key = `${entry.studentId}|${date}|${slot.slotStart}`, mark = marks[key] ?? null, a = R.attendanceOrMakeup(att[key], entry.isMakeup), v = mark?.status ?? null;
  return { att: a ? { status: a.status, label: R.attendanceLabelOf(a.status, 'ko'), note: a.note ?? null, units: a.units ?? null } : null,
    attitude: v, attitudeLabel: R.attitudeLabelFor(v, 'ko'), attitudeKnown: v === null || R.ATTITUDE.includes(v), texts: Object.fromEntries(cols.map(c => [c.field, mark?.[c.field] ?? ''])), note: mark?.progressNote ?? '' };
}
const slotRecord = (R, marks, att, date, slot, studentId, cols) => {
  const key = `${studentId}|${date}|${slot.slotStart}`, mark = marks[key] ?? null, a = att[key] ?? null;
  return { slotStart: slot.slotStart, attendance: R.attendanceLabelOf(a?.status ?? null, 'ko'), attendanceNote: a?.note ?? null, attitude: mark?.status ?? null,
    progressNote: mark?.progressNote ?? null, extras: cols.map(c => ({ label: R.sheetT('ko', c.labelKey), value: mark?.[c.field] ?? null })) };
};
const withdrawnLabels = R => ({ reason: R.sheetT('ko', 'withdrawn.reason'), attitude: R.sheetT('ko', 'withdrawn.attitude') });

/** 화면이 그대로 그리는 모양 — 요일 열·서수 행(buildGridRows)·교시 카드·로스터 묶음(groupRosterRows)·퇴원 요약 줄. */
function sheetGridModel(R, grid, students, periodLabel, marks, att, today) {
  const nameOf = id => students[id]?.name ?? '';
  const slotModel = (day, slot) => {
    const form = R.rosterFormOf(slot.teacherLabel), cols = R.rosterTextCols(form);
    const groups = R.groupRosterRows(slot.roster, nameOf).map(g => ({ key: g.key, label: g.label, rows: g.rows.map(entry => {
      const base = rowBase(R, students, entry);
      if (g.key === 'withdrawn' || g.key === 'classEnded') return { ...base, summary: R.withdrawnSummaryText({ schoolGrade: base.schoolGrade, endedOn: entry.endedOn, reason: base.reason }),
        kept: R.withdrawnRecordText([slotRecord(R, marks, att, day.date, slot, entry.studentId, cols)], withdrawnLabels(R)) };
      return { ...base, ...slotCell(R, marks, att, day.date, slot, entry, cols) };
    }) }));
    return { slotStart: slot.slotStart, slotEnd: slot.slotEnd, scheduled: slot.scheduled, teacherId: slot.teacherId, teacherLabel: slot.teacherLabel, roomLabel: slot.roomLabel,
      periodLabel: periodLabel[`${day.date}|${slot.slotStart}`] ?? null, form, textCols: cols.map(c => ({ field: c.field, labelKey: c.labelKey, titleKey: c.titleKey, width: c.width })),
      lines: slot.lines, roster: slot.roster, rosterCount: slot.roster.length, groups };
  };
  const days = grid.days.map(d => ({ date: d.date, dow: d.dow, dowLabel: R.sheetDowLabel(d.dow, 'ko'), holiday: d.holiday, isToday: d.date === today, slots: d.slots.map(s => slotModel(d, s)) }));
  // 서수 배치 — 각 요일 N번째 수업이 N행(2.0 buildGridRows). 화면은 행 번호만 받는다.
  const rows = R.buildGridRows(grid.days).map(row => row.map((slot, ci) => (slot ? grid.days[ci].slots.indexOf(slot) : -1)));
  return { days, rows };
}
/** 오늘 면 한 반 — 2.0 today-class-sheet + today-roster-table: 교시 카드(머리·계획)를 가로로, 명단은 교시를 합친 표 하나. */
function todaySheetModel(R, day, students, marks, att) {
  const perSlot = new Map(), base = new Map();
  for (const slot of day.slots) for (const e of slot.roster) { if (!base.has(e.studentId)) base.set(e.studentId, e); (perSlot.get(e.studentId) ?? perSlot.set(e.studentId, {}).get(e.studentId))[slot.slotStart] = e; }
  const colsOf = slot => R.rosterTextCols(slot.form);
  const groups = R.groupRosterRows([...base.values()], id => students[id]?.name ?? '').map(g => ({ key: g.key, label: g.label, rows: g.rows.map(entry => {
    const b = rowBase(R, students, entry);
    if (g.key === 'withdrawn' || g.key === 'classEnded') return { ...b, summary: R.withdrawnSummaryText({ schoolGrade: b.schoolGrade, endedOn: entry.endedOn, reason: b.reason }),
      kept: R.withdrawnRecordText(day.slots.map(slot => slotRecord(R, marks, att, day.date, slot, entry.studentId, colsOf(slot))), withdrawnLabels(R)) };
    const mine = perSlot.get(entry.studentId) ?? {};
    return { ...b, cells: day.slots.map(slot => (mine[slot.slotStart] ? slotCell(R, marks, att, day.date, slot, mine[slot.slotStart], colsOf(slot)) : null)) };
  }) }));
  return { nameW: R.TODAY_NAME_W, slotW: R.sheetPlanWidth('ko') + R.TODAY_GUTTER, width: R.todayContentWidth(day.slots.length, 'ko'), slotCols: day.slots.map(slot => R.todaySlotCols(slot.form, 'ko')), groups,
    hasRoster: day.slots.some(s => s.roster.length > 0) };
}

// ── 월간(view=month) — 2.0 getClassSheetMonth + month-client/calendar/rail/goal-strip/memo/plan-view ───────────────
async function monthView(sql, t, R, env, names, cls, q, today) {
  const years = [q.month || today.slice(0, 7), today, q.week || today].flatMap(d => [Number(d.slice(0, 4)) - 1, Number(d.slice(0, 4))]);
  const defs = (await sql`select id::text id, class_id::text class_id, subject_key, label_year, label_month, start_date::text start_date, end_date::text end_date
      from public.operating_periods where tenant_id=${t} and label_year = any(${[...new Set(years)]}::int[])`).map(d => ({ id: d.id, classId: d.class_id ?? null, subjectKey: d.subject_key, labelYear: d.label_year, labelMonth: d.label_month, startDate: d.start_date, endDate: d.end_date }));
  const periodMode = cls.isEie ? (q.period === 'month' || q.period === 'session' ? q.period : R.DEFAULT_ECS_MONTH_PERIOD) : 'month';
  const sessionLabelFor = date => {
    const hits = defs.filter(d => d.subjectKey === cls.subject && d.startDate <= date && date <= d.endDate).filter(d => d.classId === null || d.classId === cls.id)
      .sort((a, b) => (a.classId === b.classId ? 0 : a.classId ? -1 : 1));
    for (const d of hits) { const label = `${d.labelYear}-${String(d.labelMonth).padStart(2, '0')}`; const w = R.resolvePeriodWindow({ period: label, subjectKey: cls.subject, classId: cls.id, defs });
      if (w.kind === 'session' && w.start <= date && date <= w.end) return label; }
    return null;
  };
  const kstMonth = today.slice(0, 7), currentMonth = (periodMode === 'session' ? sessionLabelFor(today) : null) ?? kstMonth;
  const fromWeek = q.week && DAY.test(q.week) ? R.mondayOf(q.week) : null;
  const anchors = fromWeek ? [...(today >= fromWeek && today <= R.shiftDays(fromWeek, 6) ? [today] : []), R.shiftDays(fromWeek, 3)] : [];
  const weekMonth = periodMode === 'session' ? (anchors.map(sessionLabelFor).find(Boolean) ?? '') : '';
  const month = weekMonth || (q.month ? R.normalizeMonth(q.month, '') : '') || currentMonth;
  const bounds = R.monthRange(month), win = R.resolvePeriodWindow({ period: month, subjectKey: cls.subject, classId: cls.id, defs, mode: periodMode, todayIso: today });
  const from = win.start || bounds.from, to = win.end || bounds.to, footerDate = R.mpFooterDate(month);
  const [schedules, lineRows, goalRows, mpRows, memoRows, planned] = await Promise.all([
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to,
        classroom_id::text classroom_id, teacher_id::text teacher_id, slot_teacher_label, slot_room_label, u.display_name teacher_name
      from public.class_schedules s left join public.users u on u.id=s.teacher_id where s.tenant_id=${t} and s.class_id=${cls.id} and s.valid_from <= ${to} and (s.valid_to is null or s.valid_to >= ${from})`,
    sql`select * from public.class_sheet_plan_lines where tenant_id=${t} and class_id=${cls.id} and plan_date between ${from} and ${to} order by plan_date, slot_start, line_no, id`,
    sql`select role::text role, skill_area, textbook, target_progress from public.class_sheet_goals where tenant_id=${t} and class_id=${cls.id} and scope='month' and period_start=${bounds.from}`,
    cls.isEie ? sql`select plan_date::text plan_date, col_kind::text col_kind, body from public.class_month_plan_cells where tenant_id=${t} and class_id=${cls.id}
      and plan_date between ${from < bounds.from ? from : bounds.from} and ${to > bounds.to ? to : bounds.to}` : null,
    sql`select body from public.class_sheet_month_memos where tenant_id=${t} and class_id=${cls.id} and month=${bounds.from}`,
    plannedLines(sql, t, R, env, cls.id, from, to),
  ]);
  const classTeacher = cls.teacher_name ?? null;
  const displayTeacher = r => R.resolveTeacherLabel(r.slot_teacher_label ?? null, names.labelMap) || r.teacher_name || classTeacher;
  const scheduleRows = schedules.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to,
    slotTeacherLabel: displayTeacher(r), slotRoomLabel: roomOf(R, names, r) }));
  const dates = R.rangeDates(from, to), slotsByDate = R.slotsByDateOf(dates, scheduleRows), seatByKey = new Map();
  for (const [d, slots] of Object.entries(slotsByDate)) for (const s of slots) seatByKey.set(R.slotKey(d, s.slotStart), s.seat !== null);
  const lines = lineRows.map(row => { const dto = R.planLineFromRow({ ...row, id: String(row.id), plan_date: isoDay(row.plan_date), slot_start: String(row.slot_start), updated_at: new Date(row.updated_at).toISOString() });
    return { ...dto, seat: seatByKey.get(R.slotKey(dto.planDate, dto.slotStart)) ?? false }; })
    .filter(l => seatByKey.has(R.slotKey(l.planDate, l.slotStart))).filter(l => R.isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.pageRange, progress: l.progress, homework: l.homework }));
  const linesBySlot = {}; for (const l of lines) (linesBySlot[R.slotKey(l.planDate, l.slotStart)] ??= []).push(l);
  const goals = { homeroom: {}, assistant: {} };
  for (const g of goalRows) goals[g.role === 'assistant' ? 'assistant' : 'homeroom'][g.skill_area] = { textbook: g.textbook ?? null, targetProgress: g.target_progress ?? null };
  const periodsConfig = R.settingsToPeriodsConfig(env.operations), tables = { weekday: R.tableToEntries(R.weekdayTableFor(cls.subject, periodsConfig)), weekend: R.tableToEntries(periodsConfig.weekend) };
  const periodLabel = {};
  for (const [d, slots] of Object.entries(slotsByDate)) for (const s of slots) { const l = R.resolvePeriodLabel(s.slotStart, s.slotEnd, tables, R.isWeekendDow(R.dowKeyOf(d))); if (l) periodLabel[R.slotKey(d, s.slotStart)] = l; }
  const holidays = Object.fromEntries(Object.entries(env.holidays).filter(([d]) => d >= from && d <= to));
  const hasLines = (d, s) => (linesBySlot[R.slotKey(d, s)]?.length ?? 0) > 0;
  const mpCells = (mpRows ?? []).map(r => ({ planDate: r.plan_date.slice(0, 10), colKind: r.col_kind, body: typeof r.body === 'string' ? r.body : '' }))
    .filter(c => (c.colKind === 'footer' ? c.planDate === footerDate : c.planDate >= from && c.planDate <= to));
  const weeks = R.rangeWeeks(from, to), view = R.clampEcsMonthView(q.mv === 'cal' || q.mv === 'rail' || q.mv === 'mp' ? q.mv : (cls.isEie ? 'mp' : R.DEFAULT_ECS_MONTH_VIEW), cls.isEie);
  // 달력 칸 판정 — 2.0 month-calendar.tsx DayCell의 수(미작성·목표 밖·전부 작성)를 같은 함수로.
  const hg = goals.homeroom, cellOf = date => {
    const all = slotsByDate[date] ?? [];
    const offGoal = all.reduce((n, s) => n + (linesBySlot[R.slotKey(date, s.slotStart)] ?? []).filter(l => R.isOffGoalLine({ ...l, seat: s.seat !== null }, hg)).length, 0);
    return { unwritten: R.unwrittenCountOf(all, date, hasLines, holidays), missing: R.unwrittenCountOf(all, date, hasLines), offGoal,
      slots: all.map(s => { const key = R.slotKey(date, s.slotStart), ls = linesBySlot[key] ?? [], base = planned.baselineByCell[key] ?? [];
        return { ...s, key, periodLabel: periodLabel[key] ?? null, lines: ls.map(l => ({ ...l, off: R.isOffGoalLine({ ...l, seat: s.seat !== null }, hg) })), planned: base,
          verdict: base.length ? verdictOf(R.compareCell({ baseline: base, actual: ls.filter(l => l.termMode === 'regular'), lessonIndex: planned.lessonIndex, isFuture: date > today })) : null }; }) };
  };
  const cells = Object.fromEntries(Object.keys(slotsByDate).map(d => [d, cellOf(d)]));
  const offDays = Object.values(cells).filter(c => c.offGoal > 0).length;
  const sessionNote = periodMode === 'session' && win.kind !== 'session';
  return { classId: cls.id, className: cls.class_name, teacherName: classTeacher, month, monthLabel: R.monthLabel(month), today, currentMonth, isEie: cls.isEie, track: cls.track,
    period: { mode: periodMode, kind: win.kind, start: from, end: to }, sessionNote, view, dows: R.activeDowsOf(Object.keys(slotsByDate)).filter(d => R.DOW_ORDER.includes(d)),
    dowLabels: Object.fromEntries(R.DOW_ORDER.map(d => [d, R.sheetDowLabel(d, 'ko')])), weeks: weeks.map(w => ({ ...w, hasClass: w.dates.some(d => R.hasClassOnDate(slotsByDate, d)) })),
    cells, goals, skillAreas: env.skillAreas.map(a => ({ ...a, tone: skillAreaColorOf(env.skillAreas, a.key) })), holidays, fill: R.monthFillStats(slotsByDate, hasLines, holidays),
    offDays, lines: lines.map(l => ({ ...l, off: R.isOffGoalLine(l, hg) })), memo: scrub(memoRows[0]?.body ?? ''), textbooksOn: env.textbooksOn, weekHref: R.weekForMonth({ month, today, fromWeek, weeks, hasClassOn: d => R.hasClassOnDate(slotsByDate, d),
      ...(periodMode === 'session' && win.kind === 'session' ? { range: { start: from, end: to } } : {}) }),
    display: Object.fromEntries(['cal', 'rail', 'mp'].map(v => [v, R.readEcsMonthDisplay(null, v)])),
    ...railModel(R, lines, env.skillAreas, goals, slotsByDate, linesBySlot, holidays),
    mp: cls.isEie ? mpModel(R, { month, weeks, slotsByDate, holidays, cells: mpCells, linesBySlot, className: cls.class_name, today,
      chrome: { texts: R.resolveMonthPlanTexts(env.operations.subjects.find(x => x.key === R.MONTH_PLAN_SUBJECT_KEY)), teacherLabel: cls.teacher_english?.trim() || cls.teacher_name?.trim() || null,
        periodRange: R.mpPeriodRangeLabel(R.resolvePeriodWindow({ period: month, subjectKey: 'english', classId: cls.id, defs })) } }) : null };
}
/** 계획 비교 배지 — 2.0 plan-compare-dialog `useVerdictLabel`(cmp.v.*) + VERDICT_TONE. 원문 판정 코드는 화면에 안 보낸다. */
const verdictOf = c => ({ label: c.verdict === 'behind' || c.verdict === 'ahead' ? rulesSync.sheetTf('ko', `cmp.v.${c.verdict}`, { n: c.lag }) : rulesSync.sheetT('ko', `cmp.v.${c.verdict}`), tone: rulesSync.VERDICT_TONE[c.verdict] });
/** 원래 월간계획 — 2.0 `getClassPlannedLines`(loadPlanMaterials → planCellsOf): 교재 배정에서 계산, 미루기 미반영. */
async function plannedLines(sql, t, R, env, classId, from, to) {
  const empty = { baselineByCell: {}, lessonIndex: {}, shiftByCell: {} };
  const plans = await sql`select id::text id, class_id::text class_id, textbook_id::text textbook_id, slot_axis, pace, term_mode::text term_mode, start_date::text start_date, start_lesson_no, slot_picks
    from public.class_textbook_plans where tenant_id=${t} and is_active and class_id=${classId} order by created_at`;
  if (!plans.length) return empty;
  const bookIds = [...new Set(plans.map(p => p.textbook_id))];
  const [shifts, books, lessons, scheds] = await Promise.all([
    sql`select plan_date::text plan_date, slot_start::text slot_start, kind, lane, pos from public.class_lesson_shifts where tenant_id=${t} and class_id=${classId} and plan_date <= ${to} order by id`,
    sql`select id::text id, title, page_time, skill_area, session_count from public.textbooks where tenant_id=${t} and id = any(${bookIds}::uuid[])`,
    sql`select textbook_id::text textbook_id, lesson_no, progress, homework from public.textbook_lessons where tenant_id=${t} and textbook_id = any(${bookIds}::uuid[]) order by textbook_id, lesson_no`,
    sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, slot_room_label
      from public.class_schedules where tenant_id=${t} and class_id=${classId} order by day_of_week, start_time`,
  ]);
  const shiftMap = {}; for (const r of shifts) shiftMap[R.markerKeyOfRow(r)] = String(r.kind) === 'advance' ? 'advance' : 'skip';
  const bookMap = new Map(books.map(b => [b.id, { title: String(b.title), pageTime: b.page_time ?? null, skillArea: b.skill_area ?? null, sessionCount: Number(b.session_count ?? 0) }]));
  const lessonsByBook = new Map(); for (const l of lessons) { const m = lessonsByBook.get(l.textbook_id) ?? new Map(); m.set(Number(l.lesson_no), { progress: l.progress ?? null, homework: l.homework ?? null }); lessonsByBook.set(l.textbook_id, m); }
  const schedules = scheds.map(r => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time, validFrom: r.valid_from, validTo: r.valid_to, slotTeacherLabel: r.slot_teacher_label ?? null, slotRoomLabel: r.slot_room_label ?? null }));
  const common = { plans, books: bookMap, lessonsByBook, schedules, holidays: env.holidays, from, to };
  return { baselineByCell: R.expandPlans({ ...common, shifts: null }), lessonIndex: R.lessonIndexOf(plans, bookMap, lessonsByBook), shiftByCell: R.cellShiftSummary(shiftMap) };
}
/** 진도표 — 2.0 month-rail.tsx의 재료: 날짜별 칸 채움(맨 아랫줄 n/m), 목표 대조 띠(month-goal-strip: 실제 교재·목표 밖 교재). */
function railModel(R, lines, skillAreas, goals, slotsByDate, linesBySlot, holidays) {
  const fillByDate = Object.fromEntries(Object.entries(slotsByDate).map(([d, slots]) => {
    const filled = slots.filter(s => (linesBySlot[R.slotKey(d, s.slotStart)]?.length ?? 0) > 0).length;
    return [d, { filled, total: slots.length, short: filled < slots.length && !R.isHolidayOn(holidays, d) }];
  }));
  const strip = Object.fromEntries(['homeroom', 'assistant'].map(role => [role, Object.fromEntries(skillAreas.map(a => [a.key,
    { actual: R.actualBooksOf(lines, a.key), off: R.offGoalBooksOf(lines, a.key, goals[role]) }]))]));
  return { fillByDate, strip };
}
/** React 인라인 스타일 객체 → CSS 문자열(단위 없는 숫자는 px — React와 같은 규칙). 2.0 종이 서식 값을 그대로 옮기는 통로. */
const UNITLESS = new Set(['lineHeight', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'opacity', 'zIndex', 'order']);
export const css = o => Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => `${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`).join(';');
/** 계획(MP) — 2.0 month-plan-view.tsx: 요일 열(e-book 열은 그 요일에 칸이 하나라도 있으면) · 주마다 Date/라벨/값(+실제) 줄 ·
 *  휴강 회색 · 대조 판정(month-plan-compare.ts) · 문서 껍데기(month-plan-chrome: 제목·안내·범례·강사·꼬리말). 서식 값은 month-plan-sheet-style.ts 그대로. */
function mpModel(R, { month, weeks, slotsByDate, holidays, cells, linesBySlot, className, today, chrome }) {
  const map = R.mpCellMapOf(cells), dows = R.activeDowsOf(Object.keys(slotsByDate)).filter(d => R.DOW_ORDER.includes(d));
  const monthDates = weeks.flatMap(w => w.dates), hasClassOn = d => (slotsByDate[d]?.length ?? 0) > 0;
  const isOff = d => R.mpDayIsOff(d, holidays, R.mpOffOverrideOf(map, d));
  const columnsByDow = Object.fromEntries(dows.map(dow => [dow, R.mpColumnsForDow(dow, monthDates, cells)]));
  const verdictOf = d => R.mpCompareDay({ date: d, cells: map, lines: R.mpLinesOfDate({ slotsByDate, linesBySlot }, d), isOff: isOff(d), today });
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const rows = weeks.filter(w => w.dates.some(hasClassOn)).map(w => ({ monday: w.monday, index: w.index, days: dows.map(dow => {
    const date = R.cellDateOf(w, dow), teaches = date ? hasClassOn(date) : false, off = date ? isOff(date) : false, kind = R.mpDayKindOf(date, teaches, off);
    const v = date && teaches ? verdictOf(date) : null;
    return { dow, date, md: date ? md(date) : null, teaches, off, kind, holiday: date ? (holidays[date] ?? null) : null, offLabel: R.mpOffLabel(date ? holidays[date] : null),
      verdict: v && v.status !== 'ok' && v.status !== 'empty' ? { status: v.status, label: R.MP_STATUS_LABEL[v.status], hint: R.MP_STATUS_HINT[v.status], tone: R.MP_STATUS_TONE[v.status] } : null,
      warnBook: !!(v && !off && v.status === 'off-book'), cols: columnsByDow[dow].map(col => ({ col, label: R.MP_COLUMN_LABEL[col], hint: R.MP_COLUMN_HINT[col], body: date ? (map[R.mpCellKey(date, col)] ?? '') : '' })),
      actual: date && teaches ? R.mpActualSummary(R.mpLinesOfDate({ slotsByDate, linesBySlot }, date)) : [] };
  }) }));
  const count = dows.reduce((n, dow) => n + columnsByDow[dow].length, 0), docWidth = R.mpDocWidth(count), title = R.mpTitleLines(className, month);
  const fit = R.mpFitTitle(title.name, title.period, R.mpTitleBoxPx(count)), C = R.MP_SHEET_COLOR, F = R.MP_SHEET_FONT, Z = R.MP_SHEET_SIZE, L = R.MP_SHEET_LEADING, P = R.MP_SHEET_PX;
  const col = { width: P.col, minWidth: P.col }, cols = R.MP_ALL_COLUMNS;
  const style = {
    outer: css({ background: C.paper, border: R.MP_SHEET_OUTER }), head: css({ width: docWidth, height: P.head }), logo: css({ ...R.mpGridBorder(), width: P.logo }),
    title: css({ ...R.mpGridBorder(), ...R.mpTitleStyle() }), titleName: css(R.mpTitleNameStyle(fit.nameSize)), titlePeriod: css(R.mpTitlePeriodStyle(fit.periodSize)),
    notices: css(R.mpGridBorder()), notice: css({ fontFamily: F.body, fontSize: Z.body, lineHeight: L.cell, color: '#000000', fontWeight: 400 }),
    noticeLast: css({ fontFamily: F.body, fontSize: Z.body, lineHeight: L.cell, color: C.alertFg, fontWeight: 700 }), side: css({ width: P.side }),
    teacher: css({ ...R.mpGridBorder(), height: P.teacher, color: C.teacherFg, fontFamily: F.teacher, fontSize: Z.teacher, fontWeight: 700 }),
    legend: css({ ...R.mpGridBorder(), backgroundColor: C.legendBg, fontFamily: F.body, fontSize: Z.legend, fontWeight: 700, lineHeight: 1.15, flex: '1 1 0', minHeight: P.band }),
    table: css({ width: docWidth }), dayCorner: css({ ...R.mpBandCellStyle('day'), backgroundColor: C.paper, ...col }), day: css(R.mpBandCellStyle('day')),
    dateCorner: css({ ...R.mpBandCellStyle('date'), backgroundColor: C.paper, ...col }), date: css(R.mpBandCellStyle('date')), offBand: css(R.mpOffBandCellStyle()),
    week: css({ ...R.mpBandCellStyle('week'), ...col }), blank: css({ ...R.mpBandCellStyle('week'), backgroundColor: C.paper }),
    colHead: Object.fromEntries(cols.map(c => [c, css({ ...R.mpHeadCellStyle(c), ...col })])),
    value: Object.fromEntries(cols.map(c => [c, css({ ...R.mpValueCellStyle(c), ...col, height: P.value })])),
    valueNone: Object.fromEntries(cols.map(c => [c, css({ ...R.mpValueCellStyle(c), ...col, height: P.value, backgroundColor: C.paper })])),
    valueOff: css({ ...R.mpOffValueCellStyle(), ...col, height: P.value }), input: Object.fromEntries(cols.map(c => [c, css(R.mpValueInputStyle(c))])),
    inputMuted: Object.fromEntries(cols.map(c => [c, css({ ...R.mpValueInputStyle(c), color: C.offFg })])),
    actual: css({ ...R.mpBandCellStyle('week'), backgroundColor: '#f3f3f3', fontWeight: 400, textAlign: 'left' }),
    footer: css({ width: docWidth, fontFamily: F.body, fontSize: Z.footer, fontWeight: 700, lineHeight: L.footer }),
  };
  const texts = chrome.texts;
  return { dows, dowLabels: Object.fromEntries(dows.map(d => [d, R.MP_DOW_LABEL_EN[d]])), weeks: rows, style, title, titleTip: R.mpDocTitle(className, month),
    notices: R.monthPlanLines(texts.notices), legend: R.monthPlanLines(texts.bookLegend), teacherLabel: chrome.teacherLabel, sessionLine: R.mpSessionLine(month, chrome.periodRange),
    footer: R.mpResolveFooter(map, month, R.defaultMonthPlanFooter(texts)), summary: R.mpSummarize(Object.keys(slotsByDate).sort().map(verdictOf)) };
}

// ── 오늘(view=today) — 2.0 EcsTodayFace 시트 모드: 고른 선생님의 그날 반, 각 반은 주간 시트를 그날·본인 교시로 ────────
async function todayView(sql, t, R, env, names, q, today) {
  const date = q.date && q.date <= today ? q.date : today, dow = R.dowKeyOf(date), weekMonday = R.mondayOf(date);
  const teachers = await sql`select distinct u.id::text id, u.display_name name from public.users u
      where u.tenant_id=${t} and (exists (select 1 from public.classes c where c.tenant_id=${t} and c.teacher_id=u.id and c.subject='english' and c.is_active)
        or exists (select 1 from public.class_schedules s join public.classes c on c.id=s.class_id where s.tenant_id=${t} and s.teacher_id=u.id and c.subject='english' and c.is_active
          and s.valid_from <= ${date} and (s.valid_to is null or s.valid_to >= ${date}))) order by u.display_name`;
  // 기본 = 영어 담임 반이 가장 많은 선생님(2.0은 로그인한 강사 본인 — 3.0 시안엔 로그인이 없다).
  const homeroom = new Map((await sql`select teacher_id::text id, count(*)::int n from public.classes where tenant_id=${t} and subject='english' and is_active group by 1`).map(r => [r.id, r.n]));
  const teacher = teachers.find(x => x.id === q.teacher) || [...teachers].sort((a, b) => (homeroom.get(b.id) ?? 0) - (homeroom.get(a.id) ?? 0))[0] || null;
  const holiday = R.holidayNameOn(env.holidays, date);
  if (!teacher) return { date, today, dateLabel: R.formatKoreanDate(date), teachers: [], teacher: null, holiday, classes: [], hasAnyClass: false };
  // 2.0 스코프 = 담임 반 ∪ 교시 담당 반(영어) ∪ 위임 반(오늘 ±7일). 그날 도는 교시가 있는 반만(자리는 JJ 표시 설정대로).
  const scope = await sql`select distinct c.id::text id, c.class_name from public.classes c where c.tenant_id=${t} and c.subject='english' and c.is_active
      and (c.closed_at is null or c.closed_at >= ${date}) and (c.teacher_id=${teacher.id}
        or exists (select 1 from public.class_schedules s where s.class_id=c.id and s.teacher_id=${teacher.id})
        or exists (select 1 from public.class_delegations d where d.tenant_id=${t} and d.class_id=c.id and d.revoked_at is null and d.delegate_user_id=${teacher.id}
          and d.from_date <= ${R.shiftDays(today, 7)} and d.to_date >= ${R.shiftDays(today, -7)})) order by c.class_name`;
  const slots = scope.length ? await sql`select class_id::text class_id, slot_teacher_label from public.class_schedules where tenant_id=${t} and class_id = any(${scope.map(c => c.id)}::uuid[])
      and day_of_week::text=${dow} and valid_from <= ${date} and (valid_to is null or valid_to >= ${date})` : [];
  const live = new Set(slots.filter(s => !R.hiddenSeatOf(s.slot_teacher_label, q.jj !== '0')).map(s => s.class_id));
  const todayIds = scope.filter(c => live.has(c.id));
  // 위임 반(2.0 ecsDelegatedClassIds — 오늘 ±7일) — 그 반은 본인 교시로 거르지 않는다(selectSheetDays delegatedClass).
  const delegatedIds = new Set((await sql`select class_id::text id from public.class_delegations where tenant_id=${t} and revoked_at is null and delegate_user_id=${teacher.id}
      and from_date <= ${R.shiftDays(today, 7)} and to_date >= ${R.shiftDays(today, -7)}`).map(r => r.id));
  // 반마다 독립 조회라 한 번에 띄운다(B4).
  const sheets = (await Promise.all(todayIds.map(async c => {
    const cls = await readClass(sql, t, R, env, c.id).catch(() => null); if (!cls) return null;
    const data = await sheetWeek(sql, t, R, env, names, cls, weekMonday, today, { jj: q.jj });
    const raw = { grid: { days: data.grid.days.map(d => ({ date: d.date, slots: d.slots.map(s => ({ slotStart: s.slotStart, teacherId: s.teacherId, teacherLabel: s.teacherLabel, lines: s.lines })) })) },
      delegated: delegatedIds.has(c.id) && cls.teacher_id !== teacher.id, attendanceByStudentDate: data.attendance, marks: data.marks, memos: data.memos };
    const sel = R.selectSheetDaysFor(raw, { variant: 'today', dayFilter: date, myTeacherId: teacher.id });
    const keep = new Set((sel.todayDay?.slots ?? []).map(s => s.slotStart));
    const day0 = data.grid.days.find(d => d.date === date), day = day0 ? { ...day0, slots: day0.slots.filter(s => keep.has(s.slotStart)) } : null;
    // 그날 열만 싣는다(주 전체를 보내면 반마다 수십 KB) — 화면도 그날 하루만 그린다(2.0 variant="today").
    const { grid, students, attendance, marks, memos, ...rest } = data;
    return { ...rest, todayDay: day ? { ...day, slots: day.slots.map(({ groups, roster, ...slot }) => slot) } : null, todaySheet: day ? todaySheetModel(R, day, students, marks, attendance) : null, hiddenOwn: sel.hiddenOwn.length,
      first: R.firstVisibleTodaySlot(raw, { date, myTeacherId: teacher.id }) ?? '99:99' };
  }))).filter(Boolean);
  const [prefs] = await sql`select ui_prefs from public.users where tenant_id=${t} and id=${teacher.id}`;
  const order = R.readEcsTodayOrder(prefs?.ui_prefs ?? null);
  sheets.sort((a, b) => a.first.localeCompare(b.first) || a.className.localeCompare(b.className, 'ko'));
  const ordered = R.applyTodayOrder(sheets.map(s => ({ ...s, id: s.classId })), order);
  return { date, today, dateLabel: R.formatKoreanDate(date), teachers: teachers.map(x => ({ id: x.id, name: x.name })), teacher, holiday, hasAnyClass: scope.length > 0, classes: ordered };
}

export const screen = {
  id: ID, label: '강사 시트', order: 3,
  params: { view: /^(list|sheet|month|today)$/, class: UUID, week: DAY, month: /^\d{4}-\d{2}$/, mv: /^(cal|rail|mp)$/, period: /^(month|session)$/,
    track: /^(all|eie|injaewon)$/, teacher: /^(all|none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/, date: DAY, day: DAY, jj: /^[01]$/ },
  async load({ sql, params: q, tenantId: t, importV2 }) {
    const R = await loadRules(importV2), today = await copyDay(), env = await readSettings(sql, t, R);
    const view = q.view || (q.class ? 'sheet' : 'list');
    const common = { asOf: today, view, t: dictOf(R), tracks: { eie: R.ENGLISH_TRACK_LABEL.eie, injaewon: R.ENGLISH_TRACK_LABEL.injaewon },
      fonts: R.UI_FONT_SIZES.map(k => ({ key: k, labelKey: R.FONT_SIZE_KEY[k], zoom: R.UI_FONT_SIZE_ZOOM[k] })), faceTitle: Object.fromEntries(['week', 'cal', 'rail', 'mp'].map(f => [f, R.sheetT('ko', `face.${f}.title`)])) };
    if (view === 'list') return { ...common, list: await landing(sql, t, R, env, q, today) };
    const names = await readNames(sql, t, R);
    if (view === 'today') return { ...common, today: await todayView(sql, t, R, env, names, q, today) };
    if (!q.class) return { ...common, error: '반을 골라 주세요.' };
    let cls;
    try { cls = await readClass(sql, t, R, env, q.class); } catch (e) { if (e instanceof V2Error) return { ...common, error: e.message }; throw e; }
    // 반 전환 드롭다운 — 2.0과 같이 그 주(월간은 이번 주) 반 목록. 목록에 없는 반으로 들어왔으면 지금 반을 맨 앞에 끼운다.
    const listed = await weekClassOptions(sql, t, R, view === 'month' ? today : (q.week || today));
    const classOptions = listed.some(o => o.id === cls.id) ? listed : [{ id: cls.id, name: cls.class_name }, ...listed];
    if (view === 'month') return { ...common, classOptions, month: await monthView(sql, t, R, env, names, cls, q, today) };
    const sheet = await sheetWeek(sql, t, R, env, names, cls, q.week, today, { jj: q.jj });
    // 명단 원본(RosterEntry)은 오늘 면 조립에만 쓴다 — 주간 화면은 묶음(groups)만 그린다.
    for (const day of sheet.grid.days) for (const slot of day.slots) delete slot.roster;
    return { ...common, classOptions, sheet };
  },
};
