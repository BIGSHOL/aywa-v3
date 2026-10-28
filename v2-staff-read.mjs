// 2.0 화면 — 직원관리 읽기(V2-SCREENS.md `staff`, 처리 화면 세션 R · 작업자 A). 2.0 서버 조회를 Docker 복사본에서 같은 값으로:
//  · features/staff/server/queries.ts(getStaffList · getStaffById · getActiveHomeroomClasses · getActiveAssistSlotClasses · getStaffClasses)
//  · features/staff/contract/server/contract-queries.ts · features/staff/resume/server/resume-queries.ts(getResumeByStaffUser)
//  · features/staff/intake/server/intake-token.ts(listStaffIntakeTokens) · features/audit/server/activity-queries.ts
//  · features/staff/list/server/list-prefs.ts(loadStaffListPrefs) · features/attendance/server/salary-rates.ts(개인별 급여 설정 탭)
// 2.0이 **세션 클라이언트 + RLS**로 읽는 곳은 보는 사람의 신분(request.jwt.claims + authenticated)으로 읽고(asReader), 관리 키(admin)로
// 읽는 곳(계약·계약서 파일·근무시간·QR 토큰·보호 계정)은 신분 없이 tenant_id를 명시해 읽는다 — 누가 무엇을 보는지가 2.0과 같다.
// 판정은 2.0 순수 함수(importV2) — 권한 표(역할 기본 + 학원 설정 + 개인 예외)는 v2-proc-people.readPeople, 개인 메뉴 차단은 맨 끝에 누른다.
// 🔴 restricted 값: 급여(hourly_rate·monthly_base)는 2.0 canSeeSalary(원장 · 본인)일 때만 싣는다 · 이력서(주민번호·계좌·급여 계약)는
//    canViewResume(직원관리 접근 + 과목 범위 · 본인)를 지나고 RLS(0072a restricted)가 연 행만 · 증명사진 주소는 바깥 저장소라 만들지 않는다.
import { readPeople } from './v2-proc-people.mjs';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ts = col => `to_json(${col})#>>'{}'`; // PostgREST와 같은 timestamptz 글자(ISO + 오프셋)

let rulesPromise = null;
export function loadStaffRules(importV2) {
  rulesPromise ??= (async () => {
    const [roles, perms, blocks, resume, employment, workHours, listPrefs, resolve, subjects, jobRank, leaveAccess, payroll, contract, salaryRates, dateKst, scope, intakeView, statusLabels, dbError, workSchedule, color, email, modules, salaryGroup, preserve] = await Promise.all([
      'lib/auth/role-hierarchy.ts', 'lib/permissions.ts', 'lib/auth/user-menu-blocks.ts', 'features/staff/resume/resume.ts', 'features/staff/employment.ts',
      'features/staff/work-hours-label.ts', 'features/staff/list/list-prefs.ts', 'features/owner/resolve.ts', 'features/owner/subjects.ts', 'features/approvals/job-rank.ts',
      'features/leave/access.ts', 'features/payroll/config.ts', 'features/staff/contract/contract.ts', 'features/attendance/salary-rates.ts', 'lib/date-kst.ts',
      'features/staff/department/subject-scope.ts', 'features/staff/intake/intake-view.ts', 'features/staff/status-labels.ts', 'lib/supabase/db-error.ts',
      'features/staff/work-schedule.ts', 'lib/color-utils.ts', 'features/staff/email.ts', 'lib/modules.ts', 'features/payroll/salary-group.ts', 'features/classes/schedule-preserve.ts',
    ].map(p => importV2(p)));
    return { roles, perms, blocks, resume, employment, workHours, listPrefs, resolve, subjects, jobRank, leaveAccess, payroll, contract, salaryRates, dateKst, scope, intakeView, statusLabels, dbError, workSchedule, color, email, modules, salaryGroup, preserve };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** 2.0 view-as.ts `isFullShellRole` — 그 파일은 쿠키(next/headers)를 읽어 불러올 수 없다. 한 줄 판정을 같은 글자로(verify가 2.0 원문과 대조). */
export const isFullShellRole = role => role !== 'teacher' && role !== 'student';

/**
 * 보는 사람·저장하는 사람 — 직원관리 메뉴가 열린 재직 직원(2.0 requireAccess("staff")). 운영자 계정은 3.0 띠에 나오지 않는다(readPeople).
 * level = 2.0 getUserPermMatrix의 역할 기본 + 학원 설정 + 개인 예외 → **맨 끝에 개인 메뉴 차단**(user-menu-blocks.ts applyUserMenuBlocks).
 */
export async function readStaffPeople(sql, t, importV2) {
  const [R, people] = await Promise.all([loadStaffRules(importV2), readPeople(sql, t, importV2, 'staff')]);
  const level = (u, menu) => {
    const base = people.level(u, menu);
    const blocked = R.blocks.applyUserMenuBlocks({ [menu]: { [u.role]: base } }, u.id, [u.role]);
    return blocked[menu]?.[u.role] ?? base;
  };
  const editors = people.editors.filter(e => level(e, 'staff') !== 'none');
  const [row] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
  const settings = R.resolve.resolveSettings(plain(row?.data) ? row.data : null, { name: row?.name ?? '' });
  return {
    sql, t, R, people, settings, level, editors,
    editorList: editors.map(e => ({ id: e.id, name: e.display_name, role: R.roles.ROLE_LABEL[e.role] ?? '' })),
    pick: id => editors.find(e => e.id === id) ?? editors[0] ?? null,
    find: id => (typeof id === 'string' ? editors.find(e => e.id === id) ?? null : null),
    canAccess: (u, menu) => level(u, menu) !== 'none',
    canWrite: (u, menu) => ['full', 'scoped'].includes(level(u, menu)),
    canManage: (u, menu) => level(u, menu) === 'full',
    /** 2.0 getViewerStaffScope — 원장 역할엔 범위 없음(운영자 계정은 띠에 없다). */
    staffScope: u => (u.role === 'master' ? null : R.scope.staffSubjectScopeOf(u.id, settings.permissions?.specialAccess?.staffSubjectScopes)),
  };
}

/** 2.0 세션 클라이언트 자리 — 보는 사람의 신분으로 읽고, 끝나면 claims·역할을 되돌린다(뒤따르는 관리 키 자리가 그 사람으로 판정되지 않게). */
export async function asReader(sql, u, fn) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u.id, role: 'authenticated' })}, true)`;
  await sql`set local role authenticated`;
  try { return await fn(sql); }
  finally {
    await sql`set local role none`;
    await sql`select set_config('request.jwt.claims', '', true)`;
  }
}

/** 2.0 canSeeStaffMember — 본인은 통과 · 범위가 있으면 대상 과목(모르면 관리 키로 다시 읽어)으로 판정. */
export async function canSeeStaffMember(ctx, viewer, targetId, knownSubjects) {
  if (targetId === viewer.id) return true;
  const scope = ctx.staffScope(viewer);
  if (!scope) return true;
  if (knownSubjects !== undefined) return ctx.R.scope.isStaffInSubjectScope(scope, knownSubjects);
  const [row] = await ctx.sql`select subjects from public.users where id=${targetId} and tenant_id=${ctx.t}`;
  if (!row) return false;
  return ctx.R.scope.isStaffInSubjectScope(scope, Array.isArray(row.subjects) ? row.subjects : []);
}

/** 2.0 protectionStatus — super_admins 명단(관리 키). */
export async function protectionStatus(sql, id) {
  const [row] = await sql`select 1 from public.super_admins where id=${id}`;
  return row ? 'protected' : 'clear';
}
async function superAdminIds(sql) { return new Set((await sql`select id::text id from public.super_admins`).map(r => r.id)); }

// ── 목록(getStaffList) ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function getStaffList(ctx, viewer) {
  const { sql, t, R } = ctx;
  const canSeeContracts = ctx.canAccess(viewer, 'staff');
  // 관리 키 자리(계약 · 계약서 파일 · 근무시간)를 먼저 — 그 뒤 신분을 바꿔 RLS 자리를 읽는다.
  const [contracts, fileRows, workHourRows] = canSeeContracts ? await Promise.all([
    sql`select user_id::text user_id, seq, start_date::text start_date, end_date::text end_date, terms from public.staff_contracts
      where tenant_id=${t} and kind='contract' order by user_id, seq`,
    sql`select staff_user_id::text staff_user_id from public.academy_documents where tenant_id=${t} and kind='file' and staff_user_id is not null`,
    sql`select staff_user_id::text staff_user_id, ${sql.unsafe(ts('updated_at'))} updated_at, form_data->'contract'->>'workHours' work_hours, form_data->'contract'->'workDays' work_days
      from public.academy_documents where tenant_id=${t} and form_type=${R.resume.RESUME_FORM_TYPE} and staff_user_id is not null limit 1000`,
  ]) : [[], [], []];
  const { users, teaching, ens } = await asReader(sql, viewer, async s => {
    const users = await s`select id::text id, display_name, email, phone, system_role::text system_role, status::text status, hire_date::text hire_date, job_title, subjects,
        department, employment_type, bg_color, text_color, ${s.unsafe(ts('updated_at'))} updated_at
      from public.users where system_role <> 'student' order by system_role asc, display_name asc`;
    const teaching = await s`select id::text id, teacher_id::text teacher_id from public.classes where is_active`;
    const ids = teaching.filter(c => c.teacher_id).map(c => c.id);
    const ens = ids.length ? await s`select class_id::text class_id, student_id::text student_id from public.enrollments where end_date is null and class_id = any(${ids}::uuid[])` : [];
    return { users, teaching, ens };
  });
  const scope = ctx.staffScope(viewer);
  const visible = scope ? users.filter(u => u.id === viewer.id || R.scope.isStaffInSubjectScope(scope, Array.isArray(u.subjects) ? u.subjects : [])) : users;
  const hasFile = new Set(fileRows.map(r => r.staff_user_id));
  // latestWorkHoursByStaff — 이력서가 여럿이면 가장 최근에 고친 것.
  const best = new Map();
  for (const r of workHourRows) {
    const at = r.updated_at ?? '', prev = best.get(r.staff_user_id);
    if (!prev || at > prev.at) best.set(r.staff_user_id, { at, text: R.workHours.workHoursLabel(Array.isArray(r.work_days) ? r.work_days.map(String) : [], r.work_hours) });
  }
  const current = new Map(); for (const c of contracts) current.set(c.user_id, c);
  const classCount = new Map(), classTeacher = new Map();
  for (const c of teaching) { if (!c.teacher_id) continue; classCount.set(c.teacher_id, (classCount.get(c.teacher_id) ?? 0) + 1); classTeacher.set(c.id, c.teacher_id); }
  const studentsBy = new Map();
  for (const e of ens) { const tid = classTeacher.get(e.class_id); if (!tid) continue; (studentsBy.get(tid) ?? studentsBy.set(tid, new Set()).get(tid)).add(e.student_id); }
  return visible.map(u => {
    const c = current.get(u.id);
    return {
      id: u.id, displayName: u.display_name, email: u.email, phone: u.phone ?? null, systemRole: u.system_role, status: u.status, hireDate: u.hire_date ?? null,
      jobTitle: u.job_title ?? null, subjects: Array.isArray(u.subjects) ? u.subjects : [], department: u.department ?? null, employmentType: u.employment_type ?? null,
      classesCount: classCount.get(u.id) ?? 0, primaryStudentsCount: studentsBy.get(u.id)?.size ?? 0,
      contractStart: c?.start_date ?? null, contractEnd: c?.end_date ?? null, contractTerms: c?.terms ?? null, contractSeq: c?.seq ?? null,
      workHours: best.get(u.id)?.text ?? null, contractFile: hasFile.has(u.id), updatedAt: u.updated_at ?? null, bgColor: u.bg_color ?? null, textColor: u.text_color ?? null,
    };
  });
}

// ── 상세(getStaffById) ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function getStaffById(ctx, viewer, id) {
  const { sql } = ctx;
  const row = await asReader(sql, viewer, async s => {
    const [u] = await s`select id::text id, display_name, email, phone, system_role::text system_role, status::text status, hire_date::text hire_date, job_title, english_name, subjects,
        default_classroom, memo, bg_color, hourly_rate, monthly_base, department, employment_type, attendance_alert_optin,
        seat_lab_duty, seat_jj_duty, desk_attendance_optin, teacher_view_access, shuttle_duty, teacher_view_lang
      from public.users where id=${id}`;
    return u ?? null;
  });
  if (!row) return null;
  if (!(await canSeeStaffMember(ctx, viewer, row.id, Array.isArray(row.subjects) ? row.subjects : []))) return null;
  return {
    id: row.id, displayName: row.display_name, attendanceAlertOptin: row.attendance_alert_optin === true, seatLabDuty: row.seat_lab_duty === true, seatJjDuty: row.seat_jj_duty === true,
    deskAttendanceOptin: row.desk_attendance_optin === true, shuttleDuty: row.shuttle_duty === true, teacherViewAccess: row.teacher_view_access === true,
    teacherViewLang: row.teacher_view_lang === 'ko' || row.teacher_view_lang === 'en' ? row.teacher_view_lang : null,
    email: row.email, phone: row.phone ?? null, systemRole: row.system_role, status: row.status, hireDate: row.hire_date, jobTitle: row.job_title,
    englishName: row.english_name ?? null, subjects: Array.isArray(row.subjects) ? row.subjects : [], defaultClassroom: row.default_classroom, memo: row.memo, bgColor: row.bg_color ?? null,
    hourlyRate: Number(row.hourly_rate ?? 0), monthlyBase: Number(row.monthly_base ?? 0), department: row.department ?? null, employmentType: row.employment_type ?? null,
  };
}
/** 🔴 급여 두 칸은 2.0 canSeeSalary(원장 · 본인)일 때만 응답에 남긴다 — 그 밖엔 칸째 지운다(화면도 그 칸을 그리지 않는다). */
export function salaryGate(staff, canSeeSalary) {
  if (canSeeSalary) return staff;
  const { hourlyRate: _h, monthlyBase: _m, ...rest } = staff;
  return rest;
}

/** 2.0 canViewResume — 본인 · 직원관리 접근(+ 과목 범위 안). */
export async function canViewResume(ctx, viewer, ownerId) {
  if (ownerId && ownerId === viewer.id) return true;
  if (!ctx.canAccess(viewer, 'staff')) return false;
  if (!ctx.staffScope(viewer)) return true;
  if (!ownerId) return false;
  return canSeeStaffMember(ctx, viewer, ownerId);
}
/** 2.0 getResumeByStaffUser — RLS(restricted 0072a)가 연 행만. */
export async function getResumeByStaffUser(ctx, viewer, userId) {
  const { sql, R } = ctx;
  const r = await asReader(sql, viewer, async s => (await s`select d.id::text id, d.form_data, ${s.unsafe(ts('d.created_at'))} created_at, ${s.unsafe(ts('d.updated_at'))} updated_at,
      d.uploaded_by::text uploaded_by, d.staff_user_id::text staff_user_id, u.display_name uploader_name
    from public.academy_documents d left join public.users u on u.id = d.uploaded_by
    where d.form_type=${R.resume.RESUME_FORM_TYPE} and d.staff_user_id=${userId} order by d.created_at desc limit 1`)[0] ?? null);
  return r ? { id: r.id, data: R.resume.normalizeResume(r.form_data), createdAt: r.created_at, updatedAt: r.updated_at, authorName: r.uploader_name ?? null,
    uploadedBy: r.uploaded_by ?? null, staffUserId: r.staff_user_id ?? null } : null;
}

export async function getStaffContracts(ctx, viewer, userId) {
  if (!ctx.canAccess(viewer, 'staff')) throw new Error('계약 이력을 열람할 권한이 없습니다');
  const rows = await ctx.sql`select id::text id, seq, kind, start_date::text start_date, end_date::text end_date, terms, memo, line_no from public.staff_contracts
    where tenant_id=${ctx.t} and user_id=${userId} order by seq asc, line_no asc nulls last`;
  return rows.map(r => ({ id: r.id, seq: r.seq, kind: r.kind ?? 'contract', startDate: r.start_date ?? null, endDate: r.end_date ?? null, terms: r.terms ?? null, memo: r.memo ?? null, lineNo: r.line_no ?? null }));
}
export async function getStaffContractFiles(ctx, viewer, userId) {
  if (!ctx.canAccess(viewer, 'staff')) throw new Error('계약서를 열람할 권한이 없습니다');
  const rows = await ctx.sql`select id::text id, file_name, file_size, ${ctx.sql.unsafe(ts('created_at'))} created_at from public.academy_documents
    where tenant_id=${ctx.t} and staff_user_id=${userId} and kind='file' order by created_at desc`;
  return rows.map(r => ({ id: r.id, fileName: r.file_name ?? '계약서.pdf', fileSize: r.file_size == null ? null : Number(r.file_size), createdAt: r.created_at }));
}

async function getActiveHomeroomClasses(s, t, teacherId) {
  const rows = await s`select c.id::text id, c.class_name, c.subject, c.pending_teacher_date::text pending_teacher_date, p.display_name pending_name
    from public.classes c left join public.users p on p.id = c.pending_teacher_id
    where c.tenant_id=${t} and c.teacher_id=${teacherId} and c.is_active order by c.class_name asc`;
  return rows.map(c => ({ id: c.id, className: c.class_name, subject: c.subject, pendingTeacherName: c.pending_name ?? null, pendingTeacherDate: c.pending_teacher_date ?? null }));
}
/** 2.0 getActiveAssistSlotClasses — 담임이 아닌 진행중 반에서 오늘 이후 교시를 맡은 반(교시 수). */
export async function getActiveAssistSlotClasses(s, t, teacherId, today) {
  const rows = await s`select cs.class_id::text class_id, c.class_name, c.subject, c.teacher_id::text teacher_id from public.class_schedules cs
    join public.classes c on c.id = cs.class_id and c.is_active
    where cs.tenant_id=${t} and cs.teacher_id=${teacherId} and (cs.valid_to is null or cs.valid_to >= ${today}::date) order by cs.class_id`;
  const by = new Map();
  for (const r of rows) {
    if (r.teacher_id === teacherId) continue;
    const hit = by.get(r.class_id);
    if (hit) hit.slotCount += 1; else by.set(r.class_id, { id: r.class_id, className: r.class_name, subject: r.subject, slotCount: 1 });
  }
  return [...by.values()].sort((a, b) => a.className.localeCompare(b.className, 'ko'));
}
async function getClassTeacherOptions(s, R) {
  const rows = await s`select id::text id, display_name, subjects, bg_color, text_color from public.users
    where system_role::text = any(${[...R.perms.ASSIGNABLE_TEACHER_ROLES]}) and status='active' order by display_name`;
  return rows.map(u => ({ id: u.id, name: u.display_name, subjects: u.subjects ?? [], bgColor: u.bg_color ?? null, textColor: u.text_color ?? null }));
}

/** 기본정보 탭(BasicInfoTab)의 서버 조회 — 2.0 Promise.all 이름 그대로. */
export async function basicInfoData(ctx, viewer, staff, { canManageThis }) {
  const { sql, t, R } = ctx;
  const [contracts, contractFiles, protection] = await Promise.all([
    getStaffContracts(ctx, viewer, staff.id), getStaffContractFiles(ctx, viewer, staff.id), canManageThis ? protectionStatus(sql, staff.id) : 'clear',
  ]);
  const today = R.dateKst.kstToday();
  const { homeroomClasses, handoverTeachers, assistClasses } = canManageThis
    ? await asReader(sql, viewer, async s => ({
      homeroomClasses: await getActiveHomeroomClasses(s, t, staff.id), handoverTeachers: await getClassTeacherOptions(s, R), assistClasses: await getActiveAssistSlotClasses(s, t, staff.id, today),
    }))
    : { homeroomClasses: [], handoverTeachers: [], assistClasses: [] };
  return { homeroomClasses, contracts, contractFiles, handoverTeachers, assistClasses, protection, today };
}

/** 수업이력 탭(getStaffClasses) — 그 강사가 담임인 반 전부(종료 포함) · 교시 · 진행 중 인원. */
export async function getStaffClasses(ctx, viewer, teacherId) {
  const { sql, t } = ctx;
  return asReader(sql, viewer, async s => {
    const classes = await s`select id::text id, class_name, subject, is_active from public.classes where tenant_id=${t} and teacher_id=${teacherId} order by is_active desc, class_name asc`;
    if (!classes.length) return [];
    const ids = classes.map(c => c.id);
    const schedules = await s`select class_id::text class_id, day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time from public.class_schedules where class_id = any(${ids}::uuid[])`;
    const enrolls = await s`select class_id::text class_id, end_date from public.enrollments where class_id = any(${ids}::uuid[])`;
    const sched = new Map(), count = new Map();
    for (const x of schedules) (sched.get(x.class_id) ?? sched.set(x.class_id, []).get(x.class_id)).push({ day: x.day_of_week, startTime: x.start_time.slice(0, 5), endTime: x.end_time.slice(0, 5) });
    for (const e of enrolls) if (!e.end_date) count.set(e.class_id, (count.get(e.class_id) ?? 0) + 1);
    const order = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
    return classes.map(c => ({ id: c.id, className: c.class_name, subject: c.subject, isActive: c.is_active, studentCount: count.get(c.id) ?? 0,
      schedules: (sched.get(c.id) ?? []).sort((a, b) => order[a.day] - order[b.day] || a.startTime.localeCompare(b.startTime)) }));
  });
}

/** 활동 로그 탭 — activity_log(쪽 30) · 최근 접속(get_staff_recent_access) · 로그인 기록 10. 2.0처럼 RLS가 정한다. */
export async function activityData(ctx, viewer, userId, page) {
  const PAGE = 30, from = (Math.max(1, page) - 1) * PAGE;
  return asReader(ctx.sql, viewer, async s => {
    const rows = await s`select id::text id, table_name, op, target_label, changed, ${s.unsafe(ts('created_at'))} created_at from public.activity_log
      where actor_id=${userId} order by created_at desc limit ${PAGE} offset ${from}`;
    const [{ n }] = await s`select count(*)::int n from public.activity_log where actor_id=${userId}`;
    const logins = await s`select id::text id, ${s.unsafe(ts('"at"'))} as "at", user_agent, ip from public.login_events where user_id=${userId} order by "at" desc limit 10`;
    let sessions = [];
    try { sessions = await s.savepoint(sp => sp`select * from public.get_staff_recent_access(${userId}::uuid)`); } catch { sessions = []; } // 2.0도 오류면 빈 목록
    return {
      log: { rows: rows.map(r => ({ id: r.id, table: r.table_name, op: r.op, targetLabel: r.target_label ?? null, changed: r.changed ?? null, createdAt: r.created_at })), total: n },
      logins: logins.map(r => ({ id: r.id, at: r.at, userAgent: r.user_agent ?? null, ip: r.ip == null ? null : String(r.ip) })),
      sessions: sessions.map(r => {
        const startedAt = new Date(r.started_at).toISOString(), lastActive = new Date(r.last_active).toISOString();
        return { sessionId: String(r.session_id), startedAt, lastActive, userAgent: r.user_agent ?? null, ip: r.ip == null ? null : String(r.ip),
          auto: new Date(lastActive).getTime() - new Date(startedAt).getTime() > 12 * 3600_000 };
      }),
    };
  });
}

/**
 * 월간일정 탭 — 2.0 resolveMonthlyTasks. 이 지점은 노션 연동 지점이라(2.0 env NOTION_TENANT_ID) 연결 여부는 DB(users.notion_user_id)로 보고,
 * 연결된 직원의 업무는 노션 API라 부르지 않는다 — 2.0이 노션 호출에 실패했을 때의 모양({ ok:false, error })으로 알린다.
 */
export const NOTION_REFUSED = '연습 화면에서는 노션 업무를 불러오지 않습니다 — 2.0 이전까지는 노션에서 확인해 주세요';
export async function monthlyData(ctx, viewer, staffId) {
  const notionUserId = await asReader(ctx.sql, viewer, async s => (await s`select notion_user_id from public.users where id=${staffId}`)[0]?.notion_user_id ?? null);
  return notionUserId ? { ok: false, error: NOTION_REFUSED } : { ok: true, state: 'unmapped' };
}

/** 개인별 급여 설정 탭 — 2.0 attendanceSalaryAdminOrNull(false) · loadAttendanceSalaryRates · 편집 권한이면 그 달 수업(출석부 강사 축). */
export function salaryAdmin(ctx, viewer) {
  const { R, settings } = ctx;
  if (!ctx.canAccess(viewer, 'attendance')) return false;
  if (!R.modules.isModuleEnabled(settings.modules.disabled, 'payroll')) return false;
  return ctx.canAccess(viewer, 'attendance_salary_settings');
}
export async function salaryData(ctx, viewer, teacherId, period, importV2) {
  const { sql, t, R } = ctx;
  if (!salaryAdmin(ctx, viewer)) return null;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '') ? period : R.dateKst.kstMonth();
  try {
    const [teacher] = await sql`select employment_type, commission_rates, commission_rate from public.users where tenant_id=${t} and id=${teacherId}`;
    if (!teacher || !R.employment.hasFreelancePart(teacher.employment_type)) return null;
    const mixed = R.employment.isMixedEmployment(teacher.employment_type);
    const [saved] = await sql`select rates from public.attendance_salary_rates where tenant_id=${t} and teacher_id=${teacherId}`;
    const stored = saved ? R.salaryRates.parseAttendanceRates(saved.rates) : null;
    if (saved && !stored) throw new Error('저장된 출석부 급여 비율을 확인해 주세요');
    const rates = stored ?? R.salaryRates.emptyAttendanceRates();
    if (!saved) {
      const previous = R.salaryGroup.parseGroupRates(teacher.commission_rates), defaultRate = teacher.commission_rate == null ? undefined : Number(teacher.commission_rate);
      for (const level of R.salaryRates.ATTENDANCE_RATE_LEVELS) {
        const regular = previous[level] ?? defaultRate, special = previous['특강'] ?? defaultRate;
        if (regular !== undefined) rates.regular[level] = regular;
        if (special !== undefined) rates.special[level] = special;
      }
    }
    const canEdit = ctx.canManage(viewer, 'attendance_salary_settings');
    let classes = [];
    if (canEdit) {
      const { __test, loadRules } = await import('./v2-screen-attendance.mjs'); // 2.0 loadClassAxisRows를 옮긴 출석부 화면의 읽기(고치지 않고 불러 쓴다)
      const AR = await loadRules(importV2), { from, to } = R.dateKst.monthRange(month);
      classes = (await __test.readClassAxis(sql, t, AR, from, to, await __test.readTransitions(sql, t, AR))).filter(c => c.taughtBy.includes(teacherId)).map(c => ({ id: c.id, name: c.className }));
    }
    return { month, rates, canEdit, classes, mixed };
  } catch { return { month, unavailable: true }; }
}

export const INTAKE_FORM_TYPE = 'staff_intake_token';
export function parseIntakeToken(id, createdAt, raw) {
  const d = plain(raw) ? raw : {};
  const token = typeof d.token === 'string' ? d.token : '';
  if (!token) return null;
  return { id, token, name: typeof d.name === 'string' && d.name ? d.name : '직원 등록', active: d.active !== false,
    expiresAt: typeof d.expiresAt === 'string' && d.expiresAt ? d.expiresAt : null, role: typeof d.role === 'string' && d.role ? d.role : 'teacher',
    submissionCount: typeof d.submissionCount === 'number' ? d.submissionCount : 0, createdAt };
}
export async function listIntakeTokens(sql, t) {
  const rows = await sql`select id::text id, ${sql.unsafe(ts('created_at'))} created_at, form_data from public.academy_documents
    where tenant_id=${t} and form_type=${INTAKE_FORM_TYPE} order by created_at desc limit 50`;
  return rows.map(r => parseIntakeToken(r.id, r.created_at, r.form_data)).filter(Boolean).map(x => ({ ...x, role: 'teacher' }));
}

/** 보기 설정(loadStaffListPrefs) — 3.0엔 필터 10분 쿠키가 없어 2.0의 '쿠키를 못 읽는 자리'처럼 저장값을 그대로. */
export async function loadStaffListPrefs(ctx, viewer) {
  const [row] = await ctx.sql`select ui_prefs from public.users where id=${viewer.id} and tenant_id=${ctx.t}`;
  return ctx.R.listPrefs.parseStaffListPrefs(plain(row?.ui_prefs) ? row.ui_prefs.staff : undefined);
}

export { superAdminIds };
