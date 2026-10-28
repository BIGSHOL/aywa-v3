// 2.0 화면 · 원생 상세(app/(shell)/students/[id]/page.tsx) — 페이지가 서버에서 하던 일을 Docker 복사본에서 같은 결과로.
// · 머리 = getStudentById · getStudentEnrollments(상태 변경 창이 쓰는 수강 · 원생 상태를 다룰 수 있을 때만) · getScheduledForStudent ·
//   getStudentUpcomingReservations · studentReportEntry(퇴원보고서 입구) · 권한 칸(v2-students-common.mjs detailGates).
// · 탭 = 2.0처럼 **고른 탭 하나**의 자료만 읽는다. 탭마다 모듈 `v2-students-tab-<탭>.mjs`의 `loadTab(ctx)` — 아직 없는 탭은 { missing: true }
//   (호스트가 '연습 화면에 아직 없는 탭' 한 줄을 그린다). 탭 고르기(권한 · 기여도 · SRS · 오늘 수학)는 page.tsx와 같은 판정(TAB_KEYS · resolveTab).
// · 인재원 SRS·오늘 수학 탭은 그 서비스를 부르는 탭이라 연습 화면에서 세우지 않는다(바깥 호출 없음 — 2.0 page.tsx의 '탭 없음' 갈래와 같은 모양).
// · 읽기 전용 · 바깥 호출 없음.
import { studentsBase, detailGates } from './v2-students-common.mjs';

/** 2.0 tabs-nav.tsx STUDENT_TABS의 key 차례 그대로(시험이 2.0 파일과 대조). */
export const TAB_KEYS = Object.freeze(['overview', 'classes', 'grades', 'srs', 'todays-math', 'progress', 'homework-videos', 'attendance', 'consultations', 'memos',
  'billing', 'contribution', 'timeline']);

const EXTRA = { scheduled: 'features/enrollments/scheduled-changes.ts', report: 'features/withdrawal-reports/model.ts', contribution: 'features/student-contribution/model/access.ts' };
let extraP = null;
const extra = (load) => (extraP ??= Promise.all(Object.entries(EXTRA).map(async ([k, p]) => [k, await load(p)])).then(Object.fromEntries).catch((e) => { extraP = null; throw e; }));

// ── getStudentById ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** PostgREST가 내는 글자 모양(시각 = ISO · 날짜 = YYYY-MM-DD) 그대로. */
export async function readStudent(sql, t, id) {
  const [r] = await sql`select id::text id, name, english_name, classnote_name, school, grade, status::text status, student_code, attendance_code,
      gender, birth_date::text birth_date, nickname, graduation_year, address, zip_code, address_detail, email, student_phone, home_phone, other_phone,
      enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, to_json(created_at)#>>'{}' created_at, notes, dup_suspect,
      parent_name, parent_phone, parent_relation, ai_care_summary, ai_care_focus, ai_care_model_version, to_json(ai_care_generated_at)#>>'{}' ai_care_generated_at
    from public.students where tenant_id=${t} and id=${id}`;
  if (!r) return null;
  return { id: r.id, name: r.name, englishName: r.english_name, classnoteName: r.classnote_name, studentCode: r.student_code, attendanceCode: r.attendance_code,
    school: r.school, grade: r.grade, status: r.status, gender: r.gender, birthDate: r.birth_date, nickname: r.nickname, graduationYear: r.graduation_year,
    address: r.address, zipCode: r.zip_code, addressDetail: r.address_detail, email: r.email, studentPhone: r.student_phone, homePhone: r.home_phone,
    otherPhone: r.other_phone, enrolledAt: r.enrolled_at, withdrawnAt: r.withdrawn_at, notes: r.notes, parentName: r.parent_name, parentPhone: r.parent_phone,
    parentRelation: r.parent_relation, createdAt: r.created_at, dupSuspect: r.dup_suspect === true, aiCareSummary: r.ai_care_summary,
    aiCareFocus: Array.isArray(r.ai_care_focus) ? r.ai_care_focus : null, aiCareModelVersion: r.ai_care_model_version, aiCareGeneratedAt: r.ai_care_generated_at };
}

// ── getStudentEnrollments(요청 캐시 — 같은 트랜잭션에선 한 번) ──────────────────────────────────────────────────────────
const enrollmentsMemo = new WeakMap();
/** 한 학생의 수강 이력 — 시작일 내림차순(2.0 order('start_date', desc) · 같은 날이면 id로 고정). 탭 모듈도 이것을 쓴다. */
export function readStudentEnrollments(base, id) {
  const m = enrollmentsMemo.get(base) ?? new Map();
  if (!enrollmentsMemo.has(base)) enrollmentsMemo.set(base, m);
  if (!m.has(id)) m.set(id, (async () => {
    const rows = await base.sql`select e.id::text id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred,
        c.id::text class_id, c.class_name, c.subject, c.is_special, u.display_name teacher_name
      from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id = ${base.t}
        left join public.users u on u.id = c.teacher_id and u.tenant_id = ${base.t}
      where e.tenant_id=${base.t} and e.student_id=${id} order by e.start_date desc, e.id`;
    return rows.map((r) => ({ id: r.id, classId: r.class_id ?? '', className: r.class_name ?? '?', subject: r.subject ?? '?', teacherName: r.teacher_name ?? null,
      startDate: r.start_date, endDate: r.end_date, onHold: r.on_hold, isTransferred: r.is_transferred ?? false,
      isSpecial: base.X.special.isSpecialLecture({ isSpecial: r.is_special, className: r.class_name }) }));
  })().catch((e) => { m.delete(id); throw e; }));
  return m.get(id);
}

// ── getScheduledForStudent ─────────────────────────────────────────────────────────────────────────────────────────────
async function readScheduled(base, E, id) {
  try {
    const rows = await base.sql`select e.id::text id, e.class_id::text class_id, e.student_id::text student_id, e.start_date::text start_date, e.end_date::text end_date,
        e.is_transferred, e.is_transferred_in, c.class_name, s.name student_name
      from public.enrollments e left join public.classes c on c.id = e.class_id left join public.students s on s.id = e.student_id
      where e.tenant_id=${base.t} and e.student_id=${id} and (e.start_date > ${base.today}::date or e.end_date > ${base.today}::date) order by e.id`;
    return E.scheduled.classifyScheduled(rows.map((r) => ({ enrollmentId: r.id, classId: r.class_id, className: r.class_name ?? '?', studentId: r.student_id,
      studentName: r.student_name ?? '?', startDate: r.start_date, endDate: r.end_date ?? null, isTransferred: r.is_transferred ?? false,
      isTransferredIn: r.is_transferred_in ?? false })), base.today);
  } catch (e) {
    console.error('[원생 상세] 예약 조회 실패:', e?.message ?? e); // 2.0도 빈 배열로 떨어진다
    return [];
  }
}

// ── getStudentUpcomingReservations ─────────────────────────────────────────────────────────────────────────────────────
const hhmm = (v) => String(v ?? '').slice(0, 5);
/** 앞으로의 보강 예약(0264a) — 실패하면 빈 목록(2.0 soft). 새 보강 체계(makeups.mode)의 참여는 옮기지 않았다 — 켜진 학원이면 예약만. */
export async function readUpcomingReservations(base, id, today) {
  const rows = await base.sql.soft((sp) => sp`select r.id::text id, r.student_id::text student_id, r.class_id::text class_id, r.absence_date::text absence_date,
      r.makeup_date::text makeup_date, r.slot_start::text slot_start, r.slot_end::text slot_end, r.period_label, r.note, r.status::text status, r.created_by::text created_by,
      c.class_name
    from public.makeup_reservations r left join public.classes c on c.id = r.class_id
    where r.tenant_id=${base.t} and r.student_id=${id} and r.status = 'reserved' and r.makeup_date >= ${today}::date
    order by r.makeup_date, r.slot_start limit 50`, null);
  if (!rows) return [];
  return rows.map((r) => ({ id: r.id, studentId: r.student_id, classId: r.class_id, absenceDate: r.absence_date.slice(0, 10), makeupDate: r.makeup_date.slice(0, 10),
    slotStart: hhmm(r.slot_start), slotEnd: hhmm(r.slot_end), periodLabel: r.period_label ?? null, note: r.note ?? null, status: r.status === 'done' ? 'done' : 'reserved',
    createdBy: r.created_by ?? null, className: r.class_name ?? null, origin: 'reservation', caseId: null }));
}

// ── studentReportEntry(퇴원보고서 입구) ─────────────────────────────────────────────────────────────────────────────────
async function readReportInfo(base, E, id) {
  const { viewer, level } = base;
  // reportViewer — 퇴원보고서 메뉴(권한표가 실험실 덮개까지 반영) · 원장은 담당 강사 갈래가 아니다(teacherId 없음).
  if (!viewer || level('withdrawal_reports') === 'none') return null;
  const rows = await base.sql.soft((sp) => sp`select id::text id, teacher_id::text teacher_id, requested_by::text requested_by, manager_id::text manager_id,
      director_id::text director_id, manager_ids, director_ids
    from public.withdrawal_reports where tenant_id=${base.t} and student_id=${id} and status::text not in ('completed', 'canceled')
    order by group_leader desc, created_at desc limit 20`, null);
  if (!rows) return null; // 표가 없거나 못 읽으면 입구만 접는다(2.0 missingReportSchema · .catch(() => null))
  const writable = ['full', 'scoped'].includes(level('withdrawal_reports'));
  const canRead = (r) => viewer.systemRole === 'master' || E.report.isParticipant(r, viewer.id);
  const mine = rows.find(canRead);
  const pending = mine ? { id: mine.id, readable: true } : rows[0] ? { id: rows[0].id, readable: false } : null;
  return { pending, canRequest: E.report.canRequestReport(viewer.systemRole) && writable };
}

/** page.tsx의 탭 고르기 그대로 — 고를 수 없는 탭은 개요. */
export function resolveTab(requested, gates) {
  const tab = TAB_KEYS.includes(requested) ? requested : 'overview';
  if ((tab === 'contribution' && !gates.showContribution) || (tab === 'billing' && !gates.canSeeBilling)) return 'overview';
  if (tab === 'srs' && !gates.showSrs) return 'overview';
  if (tab === 'todays-math' && !gates.showTodaysMath) return 'overview';
  return tab;
}

async function loadTab(tab, ctx) {
  const file = `v2-students-tab-${tab}.mjs`;
  let mod;
  try { mod = await import(`./${file}`); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(file)) return { missing: true };
    throw e;
  }
  return mod.loadTab(ctx);
}

/**
 * 원생 상세 한 벌 — page.tsx가 받던 값 + 권한 칸 + 고른 탭의 자료(`tab: { key, data }`). 없는 학생이면 { notFound: true }.
 * `sp` = 2.0 searchParams(검사를 지난 값만) · `sql` = 읽기 전용 트랜잭션.
 */
export async function buildStudentDetail({ sql: tx, tenantId: t, id, sp = {}, importV2, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  const E = await extra(base.load);
  const student = await readStudent(base.sql, t, id);
  if (!student) return { notFound: true };
  const g = detailGates(base, student);
  // 기여도 = getContributionGate(시범 지점 · 기여도·수납 메뉴 · 실험실 덮개는 권한표에 들어 있다) · SRS·오늘 수학 = 바깥 서비스라 세우지 않는다.
  const gates = { ...g, showContribution: t === E.contribution.CONTRIBUTION_PILOT_TENANT && base.level('student_contribution') !== 'none' && g.canSeeBilling,
    showSrs: false, showTodaysMath: false };
  const reportable = (student.status === 'enrolled' || student.status === 'on_hold') && !student.withdrawnAt;
  // 차례대로(한 관문) — 2.0 Promise.all과 같은 값.
  const enrollments = gates.canManageStatus ? await readStudentEnrollments(base, id) : [];
  const scheduled = await readScheduled(base, E, id);
  const upcomingMakeups = await readUpcomingReservations(base, id, base.today);
  const reportInfo = reportable ? await readReportInfo(base, E, id) : null;
  const tab = resolveTab(sp.tab, gates);
  const ctx = { base, sql: base.sql, t, id, student, sp, gates, today: base.today, settings: base.settings, importV2: base.load, readStudentEnrollments };
  return {
    student, enrollments, scheduled, upcomingMakeups, reportInfo, gates, today: base.today, lang: base.lang,
    viewer: { id: base.viewer.id, name: base.viewer.name, systemRole: base.viewer.systemRole, tenantId: t },
    settings: { operations: base.settings.operations, modules: base.settings.modules },
    tab: { key: tab, data: await loadTab(tab, ctx) },
  };
}
