// 2.0 화면 — 수업목록 · 반 상세 · 반 수정 (V2-SCREENS.md 대상 `classes`, 원장 10-28 *"상·중 화면 모두 2.0 부품 그대로"*).
// 그리기는 2.0의 실제 React 부품이 한다(v2-host/src/classes*.tsx). 이 모듈은 2.0 page.tsx가 서버에서 하던 일을 Docker 복사본에서 같은 결과로:
//  · 목록 = page.tsx 위쪽의 필터 해석(계정 저장값 → 기본값 · 없는 과목·담임 풀기 · 담임이 그 과목을 안 가르치면 담임 풀기) +
//    features/classes/server/queries.ts의 getClassesPage · getClassesStats · getClassTeacherFilterOptions — 표·칸·조건을 SQL로 그대로,
//    판정(수강이 오늘 명단인가 · 구분 · 정렬)은 2.0 순수 함수(importV2) 그대로.
//  · 3.0엔 로그인이 없다 — 화면 주인 = 원장(수업 관리 '전체' · 강사 범위 없음 · 화면 언어 한국어 → 영어 이름 표는 빈 표).
//    계정 보기 설정(users.ui_prefs.classes)은 없는 것으로 본다(기본값) — 고른 값은 주소에만 남는다(시간표 뷰 설정과 같은 판단).
//  · 2.0은 사용자 클라이언트(RLS)로 이 지점 줄만 읽는다 — 복사본 접속은 RLS를 안 타서 모든 조회에 tenant_id를 직접 건다.
import { deepMerge, normalizeSubjects } from './v2-screen-timetable.mjs';
import { buildClassDetail } from './v2-classes-detail.mjs';

const ID = 'classes';
let rulesPromise = null;
function loadRules(importV2) {
  rulesPromise ??= (async () => {
    const [filters, prefs, sortRows, eligibility, preset, modules, perms, dk, subjects] = await Promise.all([
      'features/classes/list-filters.ts', 'features/classes/list-prefs.ts', 'features/classes/sort-rows.ts', 'features/enrollments/eligibility.ts',
      'features/owner/preset.ts', 'lib/modules.ts', 'lib/permissions.ts', 'lib/date-kst.ts', 'features/owner/subjects.ts',
    ].map(p => importV2(p)));
    return { ...filters, ...prefs, ...sortRows, ...eligibility, ...preset, ...modules, ASSIGNABLE_TEACHER_ROLES: perms.ASSIGNABLE_TEACHER_ROLES, kstToday: dk.kstToday,
      buildSubjectMaps: subjects.buildSubjectMaps };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

const plain = v => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 학원 설정의 운영·모듈 칸 — 2.0 getTenantSettings → resolveSettings와 같은 병합(시간표 화면과 같은 함수). */
async function readSettings(sql, t, R) {
  const [row] = await sql`select data from public.tenant_settings where tenant_id=${t}`;
  const stored = row?.data ?? null, base = R.baseSettingsFor(R.presetOfStored(stored));
  const operations = deepMerge(base.operations, plain(stored) ? stored.operations : undefined);
  const mods = deepMerge(base.modules, plain(stored) ? stored.modules : undefined);
  return { operations: { ...operations, subjects: normalizeSubjects(operations.subjects, base) }, modules: { disabled: R.normalizeDisabledModules(mods.disabled) } };
}

// ── features/classes/server/queries.ts ─────────────────────────────────────────────────────────────────────────────────

const DOW_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const onRosterRow = (R, e, today) => (!e.start_date ? false : R.isEnrollmentOnRosterOn({ startDate: String(e.start_date), endDate: e.end_date ? String(e.end_date) : null, isTransferred: e.is_transferred ?? false }, today));
const sanitizeTerm = q => q.replace(/[%,()*\\]/g, ' ').trim();
function buildDaySlots(scheds) {
  const byClass = new Map();
  for (const s of scheds ?? []) {
    const m = byClass.get(s.class_id) ?? new Map();
    const start = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = m.get(s.day_of_week);
    if (prev === undefined) m.set(s.day_of_week, start);
    else if (start !== null && (prev === null || start < prev)) m.set(s.day_of_week, start);
    byClass.set(s.class_id, m);
  }
  return byClass;
}
function buildDayView(scheds, today) {
  const rows = scheds ?? [];
  const isLive = r => {
    const to = r.valid_to ? String(r.valid_to).slice(0, 10) : null;
    if (to && to < today) return false;
    const from = r.valid_from ? String(r.valid_from).slice(0, 10) : null;
    return !(from && from > today);
  };
  return { live: buildDaySlots(rows.filter(isLive)), any: buildDaySlots(rows) };
}
const sortedDaySlots = m => [...(m?.entries() ?? [])].sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0])).map(([day, start]) => ({ day, start }));
const chunk100 = list => { const out = []; for (let i = 0; i < list.length; i += 100) out.push(list.slice(i, i + 100)); return out; };

/** getClassesPage(filters, page, pageSize) — 매칭 전건을 받아 메모리에서 정렬·쪽 나누기(2.0과 같다). */
async function readClassesPage(sql, t, R, o, page, pageSize) {
  const sort = o.sort ?? 'name', days = (o.days ?? []).filter(Boolean);
  let dayClassIds = null;
  if (days.length > 0) {
    dayClassIds = [...new Set((await sql`select class_id::text class_id from public.class_schedules where tenant_id=${t} and day_of_week::text = any(${days}) order by class_id, id`).map(s => s.class_id))];
    if (dayClassIds.length === 0) return { rows: [], total: 0 };
  }
  // 검색 = 반 이름 · 담임 이름 · 강의실 이름(반 기본 + 교시별) — classSearchOrParts와 같은 조각.
  let search = sql`true`;
  if (o.q) {
    const term = sanitizeTerm(o.q);
    if (term) {
      const like = `%${term}%`;
      const [teachers, rooms] = await Promise.all([
        sql`select id::text id from public.users where tenant_id=${t} and display_name ilike ${like}`,
        sql`select id::text id from public.classrooms where tenant_id=${t} and name ilike ${like}`,
      ]);
      const roomIds = rooms.map(r => r.id);
      const slotClassIds = roomIds.length ? [...new Set((await sql`select class_id::text class_id from public.class_schedules where tenant_id=${t} and classroom_id = any(${roomIds}::uuid[])`).map(s => s.class_id))] : [];
      search = sql`(c.class_name ilike ${like}
        ${teachers.length ? sql`or c.teacher_id = any(${teachers.map(x => x.id)}::uuid[])` : sql``}
        ${roomIds.length ? sql`or c.classroom_id = any(${roomIds}::uuid[])` : sql``}
        ${slotClassIds.length ? sql`or c.id = any(${slotClassIds}::uuid[])` : sql``})`;
    }
  }
  const classes = await sql`select c.id::text id, c.class_name, c.subject, c.is_active, c.closed_at::text closed_at, c.is_special, c.notes, c.teacher_id::text teacher_id,
      u.display_name teacher_name, r.name classroom_name, coalesce(c.is_makeup_pool, false) is_makeup_pool
    from public.classes c left join public.users u on u.id = c.teacher_id left join public.classrooms r on r.id = c.classroom_id
    where c.tenant_id=${t}
      ${o.subject && o.subject !== 'all' ? sql`and c.subject = ${o.subject}` : sql``}
      ${o.teacherId && o.teacherId !== 'all' ? sql`and c.teacher_id = ${o.teacherId}` : sql``}
      ${o.status === 'operating' ? sql`and c.is_active and c.closed_at is null` : o.status === 'ended' ? sql`and c.is_active and c.closed_at is not null` : o.status === 'retired' ? sql`and not c.is_active` : sql``}
      and ${search}
      ${dayClassIds ? sql`and c.id = any(${dayClassIds}::uuid[])` : sql``}
    order by c.class_name`;
  const kind = o.kind ?? 'all';
  const matched = classes.filter(c => !c.is_makeup_pool && R.matchesClassKind(kind, { isSpecial: c.is_special, className: c.class_name }));
  const classIds = matched.map(c => c.id), today = R.kstToday();
  const counts = new Map();
  let dayView = { live: new Map(), any: new Map() };
  if (classIds.length > 0) {
    const enrollments = [], scheds = [];
    for (const ids of chunk100(classIds)) {
      const [e, s] = await Promise.all([
        sql`select class_id::text class_id, start_date::text start_date, end_date::text end_date, is_transferred from public.enrollments
          where tenant_id=${t} and class_id = any(${ids}::uuid[]) and (end_date is null or end_date >= ${today}::date)`,
        sql`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, valid_from::text valid_from, valid_to::text valid_to
          from public.class_schedules where tenant_id=${t} and class_id = any(${ids}::uuid[]) order by id`,
      ]);
      enrollments.push(...e); scheds.push(...s);
    }
    for (const e of enrollments) if (onRosterRow(R, e, today)) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    dayView = buildDayView(scheds, today);
  }
  const rows = matched.map(c => ({
    id: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: c.teacher_name ?? null, classroomName: c.classroom_name ?? null,
    isActive: c.is_active, closedAt: c.closed_at ?? null, isSpecial: c.is_special ?? false, studentCount: counts.get(c.id) ?? 0,
    days: sortedDaySlots(dayView.live.get(c.id) ?? dayView.any.get(c.id)), daysStale: !dayView.live.get(c.id) && !!dayView.any.get(c.id), notes: c.notes ?? null,
  }));
  const dayRows = days.length > 0 ? rows.filter(r => r.days.some(d => days.includes(d.day))) : rows;
  R.sortClassRows(dayRows, sort);
  const from = (page - 1) * pageSize;
  return { rows: dayRows.slice(from, from + pageSize), total: dayRows.length };
}

/** getClassesStats() — 원장 보기(강사 범위 없음). 보강 반은 빼고 센다. */
async function readClassesStats(sql, t, R) {
  const today = R.kstToday();
  const [[c], [s]] = await Promise.all([
    sql`select count(*)::int total, count(*) filter (where is_active and closed_at is null)::int active from public.classes where tenant_id=${t} and not coalesce(is_makeup_pool, false)`,
    sql`select count(*)::int seats from public.enrollments where tenant_id=${t} and start_date <= ${today}::date and (end_date is null or end_date >= ${today}::date)`,
  ]);
  return { total: c.total, active: c.active, totalSeats: s.seats };
}

/** getClassTeacherOptions() — 담임 배정 선택지(재직 · 배정 가능 역할). */
async function readTeacherOptions(sql, t, R) {
  const rows = await sql`select id::text id, display_name, subjects, bg_color, text_color from public.users
    where tenant_id=${t} and system_role::text = any(${[...R.ASSIGNABLE_TEACHER_ROLES]}) and status::text='active' order by display_name`;
  return rows.map(u => ({ id: u.id, name: u.display_name, subjects: u.subjects ?? [], bgColor: u.bg_color ?? null, textColor: u.text_color ?? null }));
}
/** getClassTeacherFilterOptions() — 배정 가능 ∪ 실제 담임(역할·재직 무관), 과목 = 프로필 ∪ 맡은 반. */
async function readTeacherFilterOptions(sql, t, R) {
  const [assignable, assignedRows] = await Promise.all([
    readTeacherOptions(sql, t, R),
    sql`select teacher_id::text teacher_id, subject from public.classes where tenant_id=${t} and is_active and teacher_id is not null order by id`,
  ]);
  const taught = new Map();
  for (const r of assignedRows) (taught.get(r.teacher_id) ?? taught.set(r.teacher_id, new Set()).get(r.teacher_id)).add(r.subject);
  const known = new Set(assignable.map(x => x.id)), missing = [...taught.keys()].filter(id => !known.has(id));
  const extra = missing.length ? await sql`select id::text id, display_name, subjects from public.users where tenant_id=${t} and id = any(${missing}::uuid[])` : [];
  const withTaught = (id, subjects) => [...new Set([...subjects, ...(taught.get(id) ?? [])])];
  return [...assignable.map(x => ({ ...x, subjects: withTaught(x.id, x.subjects) })), ...extra.map(u => ({ id: u.id, name: u.display_name, subjects: withTaught(u.id, u.subjects ?? []) }))]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// ── app/(shell)/classes/page.tsx — 필터 해석(계정 저장값 없음 = 기본값) ────────────────────────────────────────────────────

const PAGE_SIZE = 50;
export async function buildClassList({ sql, params: sp, tenantId: t, R }) {
  const prefs = R.DEFAULT_CLASS_LIST_PREFS;
  const status = R.parseClassStatus(sp.status), q = sp.q ?? '', page = Math.max(1, Number(sp.page) || 1);
  const kind = R.parseClassKind(sp.kind ?? prefs.kind);
  const subjectRaw = sp.subject ?? prefs.subject, teacherRaw = sp.teacher ?? prefs.teacher;
  const days = sp.days !== undefined ? R.parseClassDays(sp.days) : prefs.days;
  const sortChosen = R.parseClassSort(sp.sort ?? prefs.sort), sort = sortChosen; // 강사 범위 없음 — 담임 정렬을 접지 않는다
  const view = R.parseClassView(sp.view ?? prefs.view);
  const [settings, teachers, stats] = await Promise.all([readSettings(sql, t, R), readTeacherFilterOptions(sql, t, R), readClassesStats(sql, t, R)]);
  let subject = subjectRaw, teacherId = teacherRaw, teacherReset = false;
  const fromPrefs = key => sp[key] === undefined;
  const needTeacherCheck = teacherRaw !== 'all' && subjectRaw !== 'all';
  if ((fromPrefs('subject') && subjectRaw !== 'all') || (fromPrefs('teacher') && teacherRaw !== 'all') || needTeacherCheck) {
    if (fromPrefs('subject') && !settings.operations.subjects.some(s => s.key === subjectRaw)) subject = 'all';
    if (fromPrefs('teacher') && !teachers.some(x => x.id === teacherRaw)) teacherId = 'all';
    if (needTeacherCheck && subject !== 'all' && teacherId !== 'all') {
      const picked = teachers.find(x => x.id === teacherId);
      if (picked && !R.teacherTeaches(picked.subjects, subject)) { teacherId = 'all'; teacherReset = true; }
    }
  }
  const { rows, total } = await readClassesPage(sql, t, R, { kind, subject, teacherId, days, q, sort, status }, page, PAGE_SIZE);
  return {
    resolved: { status, q, page, kind, subject, teacherId, teacherReset, days, sortChosen, sort, view },
    rows, total, stats, teachers, pageSize: PAGE_SIZE,
    settings, teacherNames: {}, lang: 'ko',
    // 원장 보기 — 수업 관리 '전체'(새 반 단추 · 엑셀 가져오기 문), 강사 범위 없음(담임 열 보임).
    viewer: { canManageClasses: true, scopedTeacherId: null },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_BODY = UUID.source.slice(1, -1);
/** 2.0 하위 주소 — /classes(목록) · /classes/<반>(상세). 수정·새 반은 다음 단계. */
const DETAIL = new RegExp(`^/classes/(${UUID_BODY})$`);
export const screen = {
  id: ID, label: '수업목록', order: 5,
  params: {
    v2path: new RegExp(`^/classes(/${UUID_BODY})?$`),
    kind: /^[a-z_]{1,20}$/, subject: /^[a-z0-9_]{1,40}$/, teacher: new RegExp(`^(all|${UUID_BODY})$`), days: /^[a-z,]{0,40}$/,
    q: /^[^\u0000-\u001f]{0,100}$/, view: /^[a-z]{1,10}$/, sort: /^[a-z_]{1,20}$/, status: /^[a-z]{1,10}$/, page: /^\d{1,4}$/,
  },
  load: async ({ sql, params, tenantId, importV2 }) => {
    const R = await loadRules(importV2), detail = DETAIL.exec(params.v2path ?? '');
    if (!detail) return buildClassList({ sql, params, tenantId, R });
    return buildClassDetail({ sql, tenantId, id: detail[1], importV2, readSettings: (s, t) => readSettings(s, t, R), readTeacherOptions: (s, t) => readTeacherOptions(s, t, R),
      buildSubjectMaps: list => R.buildSubjectMaps(list) });
  },
};
export { loadRules };
