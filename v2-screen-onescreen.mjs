// 2.0 화면 · 선생님 원스크린(수업보고서 작성·발송 포함) — 1단계 보기 동등 (V2-SCREENS.md). For a chosen teacher and day:
// the classes of that day, the student × class rows, today's saved report (or the working session), the previous lesson,
// attendance, send status and the parent preview, on the local copy (read-only). Rules follow 2.0's `getTeacherRoster`
// (src/features/onescreen/server/roster.ts) in SQL; every judgement that 2.0 keeps as a pure function is imported as is
// (importV2): enrolment filter, report↔row matching, exam parsing, attendance mark, send gate, ClassNote badge, send
// status, report fields and title, month send calendar. Nothing here writes or sends.
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';
import { scrub } from './domain-snapshot-core.mjs';
import { V2Error } from './v2-screens.mjs';
import { loadOnescreenProps } from './v2-onescreen-roster.mjs';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ATT = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석', makeup: '보강' };
const MODULES = ['features/onescreen/roster-filter.ts', 'features/onescreen/report-unit.ts', 'features/onescreen/exam-info.ts', 'features/onescreen/attendance-mark.ts',
  'features/onescreen/send-gate.ts', 'features/onescreen/classnote-badge.ts', 'features/onescreen/status.ts', 'features/onescreen/report-fields.ts', 'features/onescreen/report-title.ts',
  'features/onescreen/send-calendar.ts', 'features/onescreen/student-order.ts', 'features/onescreen/grid.ts', 'features/owner/defaults.ts', 'features/owner/subjects.ts',
  'lib/date-kst.ts', 'lib/format/school-grade.ts', 'features/onescreen/textbook-carry.ts', 'features/onescreen/none-marker.ts', 'features/onescreen/ment-source.ts',
  'features/onescreen/classnote-guard.ts', 'features/owner/classnote-gate.ts', 'features/onescreen/absence-gate.ts', 'features/attendance/save-targets.ts',
  'features/attendance/edit-window.ts', 'features/attendance/auto-units.ts', 'features/onescreen/attitude.ts', 'features/owner/lesson-profile.ts', 'features/onescreen/trend-optout.ts',
  'features/onescreen/send-class.ts', 'features/onescreen/classnote-collision.ts', 'features/onescreen/math-report-pilot.ts', 'features/onescreen/jj-capture-plan.ts', 'lib/permissions.ts',
  'features/attendance/teacher-axis.ts', 'features/classes/delegation-window.ts', 'features/timetable/lib/teacher-label.ts', 'features/attendance/makeup-write.ts', 'features/onescreen/session-write.ts', 'features/onescreen/makeup-session.ts',
  'features/teacher-view/i18n.ts', 'features/teacher-view/view-prefs.ts'];
let v2 = null, asOfDay = null;
const shift = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
async function rules(importV2) {
  v2 ??= Object.assign({}, ...(await Promise.all(MODULES.map(m => importV2(m)))));
  return v2;
}
/** The copy's day (KST date of the backup), the same "today" the rest of 3.0 uses. */
async function copyDay() {
  if (!asOfDay) { const { directory } = await activeBackup(); const m = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')); asOfDay = new Date(new Date(m.capturedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  return asOfDay;
}

export const screen = {
  id: 'onescreen', label: '선생님 원스크린', order: 1,
  // props=1 (+ 2.0's own address keys view · class · student) = the props 2.0's page.tsx hands OneScreenClient and VideoHomeworkProvider,
  // for the v2-host entry (v2-onescreen-roster.mjs); without it, the interim hand-drawn page's data.
  params: { teacher: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, date: /^\d{4}-\d{2}-\d{2}$/, all: /^1$/, props: /^1$/, list: /^teachers$/, view: /^[a-z-]{1,20}$/,
    class: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, student: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ },
  async load({ sql, params, tenantId: t, importV2 }) {
    if (params.list === 'teachers') return { teachers: await teacherList(sql, t) }; // the 3.0 side's '보는 선생님' picker
    if (params.props === '1') {
      const props = await loadOnescreenProps({ sql, params, tenantId: t, importV2 });
      const { hostSettings, ...rest } = props;
      return { ...rest, host: await hostContext(sql, t, await rules(importV2), props.actor?.id ?? null, hostSettings) };
    }
    const R = await rules(importV2), asOf = await copyDay();
    const [stored] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
    const data = stored?.data || {}, report = { ...R.DEFAULT_SETTINGS.report, ...(data.report || {}) };
    const subjects = R.buildSubjectMaps(data.operations?.subjects || R.DEFAULT_SETTINGS.operations.subjects), gradeLevels = data.operations?.gradeLevels || R.DEFAULT_SETTINGS.operations.gradeLevels;
    const testMaxOf = key => (data.operations?.subjects || []).find(s => s.key === key)?.testMax ?? 5;
    // Teachers who own an active class (2.0 getTeachingClasses' own-class source), with their recent report count for the default pick.
    const teachers = await sql`select u.id, u.display_name name, u.status::text status, u.system_role::text role, count(distinct c.id)::int classes,
        (select count(*)::int from public.lesson_reports r where r.tenant_id=${t} and r.created_by=u.id and r.report_date > ${shift(asOf, -30)}) recent
      from public.users u join public.classes c on c.teacher_id=u.id and c.tenant_id=${t} and c.is_active where u.tenant_id=${t} group by u.id order by u.display_name`;
    const teacher = teachers.find(x => x.id === params.teacher) || [...teachers].sort((a, b) => b.recent - a.recent)[0];
    if (!teacher) return { asOf, teachers: [], teacher: null };
    let date = params.date && params.date <= asOf ? params.date : null, dateNote = null;
    if (!date) {
      const [last] = await sql`select max(report_date)::text d from public.lesson_reports where tenant_id=${t} and created_by=${teacher.id} and report_date<=${asOf}`;
      date = last?.d || asOf; if (last?.d && last.d !== asOf) dateNote = `이 선생님이 마지막으로 보고서를 쓴 날(${last.d})을 먼저 보여 줍니다. 복사본 기준일은 ${asOf}입니다.`;
    }
    const dow = DOW[new Date(`${date}T00:00:00Z`).getUTCDay()], all = params.all === '1';
    const holiday = (data.operations?.holidays || []).find(h => h?.date === date)?.name || null;

    // (a) classes: own active classes + classes delegated to this teacher that day; which of them meet on that weekday.
    const own = await sql`select id, class_name, subject, is_special, report_optout from public.classes where tenant_id=${t} and teacher_id=${teacher.id} and is_active`;
    const delegated = await sql`select c.id, c.class_name, c.subject, c.is_special, c.report_optout, o.display_name owner from public.class_delegations d join public.classes c on c.id=d.class_id and c.tenant_id=${t}
      left join public.users o on o.id=c.teacher_id where d.tenant_id=${t} and d.revoked_at is null and d.from_date<=${date} and d.to_date>=${date} and d.delegate_user_id=${teacher.id} and c.is_active`;
    const away = await sql`select d.class_id, u.display_name name from public.class_delegations d join public.users u on u.id=d.delegate_user_id where d.tenant_id=${t} and d.revoked_at is null and d.from_date<=${date} and d.to_date>=${date} and d.class_id = any(${own.map(c => c.id)})`;
    const classes = [...own.map(c => ({ ...c, delegated: false })), ...delegated.filter(c => !own.some(o => o.id === c.id)).map(c => ({ ...c, delegated: true }))];
    const slots = classes.length ? await sql`select class_id, min(start_time)::text st, max(end_time)::text et from public.class_schedules where tenant_id=${t} and class_id = any(${classes.map(c => c.id)}) and day_of_week::text=${dow}
      and (valid_from is null or valid_from<=${date}) and (valid_to is null or valid_to>=${date}) group by class_id` : [];
    const slotOf = new Map(slots.map(s => [s.class_id, s])), noClassesToday = slots.length === 0;
    const used = all || noClassesToday ? (all ? classes : []) : classes.filter(c => slotOf.has(c.id)), dayFiltered = !all && !noClassesToday;

    // (b) rows: enrolments of those classes that day through 2.0 rosterIncludesEnrollment; one row per (student, class).
    const enr = used.length ? await sql`select e.student_id, e.class_id, e.start_date::text start_date, e.end_date::text end_date, e.on_hold, e.is_transferred, e.attendance_days, s.name, s.grade, s.school
      from public.enrollments e join public.students s on s.id=e.student_id and s.tenant_id=${t} where e.tenant_id=${t} and e.class_id = any(${used.map(c => c.id)})
      and (e.start_date is null or e.start_date<=${date}) and (e.end_date is null or e.end_date>=${date})` : [];
    const kept = enr.filter(e => R.rosterIncludesEnrollment(e, date, dow, dayFiltered));
    const classById = new Map(classes.map(c => [c.id, c])), start = id => slotOf.get(id)?.st?.slice(0, 5) || '99:99';
    const todayClasses = used.map(c => ({ id: c.id, name: c.class_name, subject: subjects.labelOf(c.subject), startTime: slotOf.get(c.id)?.st?.slice(0, 5) || null, endTime: slotOf.get(c.id)?.et?.slice(0, 5) || null,
      count: kept.filter(e => e.class_id === c.id).length, delegated: c.delegated, ownerName: c.owner || null, delegatedAwayTo: away.find(a => a.class_id === c.id)?.name || null, reportOptout: !!c.report_optout }))
      .filter(c => c.count > 0).sort((a, b) => (a.startTime || '99').localeCompare(b.startTime || '99') || a.name.localeCompare(b.name, 'ko'));
    const order = new Map(todayClasses.map((c, i) => [c.id, i]));
    const byStudent = new Map();
    for (const e of kept.sort((a, b) => start(a.class_id).localeCompare(start(b.class_id)))) {
      const st = byStudent.get(e.student_id) ?? byStudent.set(e.student_id, { id: e.student_id, name: e.name, grade: e.grade, school: e.school, classId: e.class_id, subjects: [] }).get(e.student_id);
      const c = classById.get(e.class_id), label = subjects.labelOf(c.subject);
      st.subjects.push({ classId: c.id, className: c.class_name, subjectKey: c.subject, subjectLabel: label, name: label, isSpecial: !!c.is_special, reportOptout: !!c.report_optout, makeup: false });
    }
    const sids = [...byStudent.keys()];
    const [reports, prevs, att, sessions, orders] = await Promise.all([
      sids.length ? sql`select id, student_id, class_id, subject, makeup, progress, textbook, homework_today, attitude, homework_score, exam_info, notes, trend_note, classnote_status, classnote_error,
          classnote_sent_at, classnote_read_at, revoked_at, attachments, teacher_name, created_by, (select count(*)::int from public.share_link_views v where v.lesson_report_id=r.id) views
        from public.lesson_reports r where tenant_id=${t} and report_date=${date} and student_id = any(${sids}) order by created_at, id` : [],
      sids.length ? sql`select distinct on (student_id, coalesce(class_id::text, subject)) student_id, class_id, subject, makeup, report_date::text d, progress, textbook, homework_today, homework_score, attitude, exam_info, notes
        from public.lesson_reports where tenant_id=${t} and report_date<${date} and student_id = any(${sids}) order by student_id, coalesce(class_id::text, subject), report_date desc, id desc` : [],
      sids.length ? sql`select student_id, class_id, status::text status, note, session_units::float8 units from public.attendance_records where tenant_id=${t} and session_date=${date} and student_id = any(${sids}) order by recorded_at desc, id desc` : [],
      sids.length ? sql`select student_id, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework, special_note from public.onescreen_daily_sessions where tenant_id=${t} and session_date=${date} and updated_by=${teacher.id} and student_id = any(${sids})` : [],
      sql`select class_id, student_ids from public.onescreen_student_order where tenant_id=${t} and teacher_id=${teacher.id}`,
    ]);
    const group = (rows, k) => { const m = new Map(); for (const r of rows) (m.get(r[k]) ?? m.set(r[k], []).get(r[k])).push(r); return m; };
    const repBy = group(reports, 'student_id'), prevBy = group(prevs, 'student_id'), sessBy = new Map(sessions.map(s => [s.student_id, s]));
    const attOf = new Map(); for (const a of att) { const k = `${a.student_id}|${a.class_id}`; if (!attOf.has(k)) attOf.set(k, a); }
    const ref = r => ({ classId: r.class_id, subject: r.subject, makeup: r.makeup, ...r }), unprefix = (text, label) => String(text || '').replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '');

    // (c) fields: the working session wins (2.0 roster ⑤), the saved report fills what is empty; then 2.0 badges and gates.
    let students = [...byStudent.values()].sort((a, b) => (order.get(a.classId) ?? 99) - (order.get(b.classId) ?? 99) || gradeLevels.indexOf(a.grade) - gradeLevels.indexOf(b.grade) || String(a.name).localeCompare(String(b.name), 'ko'));
    students = R.applyStudentOrder(students, new Map(orders.map(o => [o.class_id, o.student_ids])));
    for (const st of students) {
      const seen = new Map(); for (const su of st.subjects) { const n = (seen.get(su.name) || 0) + 1; seen.set(su.name, n); } // 2.0: same subject twice → "수학 · 반이름"
      for (const su of st.subjects) if (seen.get(su.name) > 1) su.name = `${su.subjectLabel} · ${su.className}`;
      const today = R.matchReportsToRows(st.subjects.map(s => ({ classId: s.classId, subjectKey: s.subjectKey, isSpecial: s.isSpecial })), (repBy.get(st.id) || []).map(ref));
      const before = R.matchReportsToRows(st.subjects.map(s => ({ classId: s.classId, subjectKey: s.subjectKey, isSpecial: s.isSpecial })), (prevBy.get(st.id) || []).map(ref), { legacyFallback: true });
      const sess = sessBy.get(st.id), sp = sess?.subject_progress || {};
      st.subjects.forEach((su, i) => {
        const r = today[i], p = before[i], row = sp[su.classId] || {}, a = attOf.get(`${st.id}|${su.classId}`);
        const scores = R.parseExamScores(r?.exam_info), maxes = R.parseExamMaxes(r?.exam_info), max = testMaxOf(su.subjectKey);
        Object.assign(su, {
          today: row.today ?? (r ? unprefix(r.progress, su.subjectLabel) : ''), textbook: row.textbook ?? r?.textbook ?? '', homeworkToday: row.homeworkToday ?? r?.homework_today ?? '',
          attitude: row.attitude ?? sess?.attitude ?? r?.attitude ?? null, homework: row.homework ?? sess?.homework ?? r?.homework_score ?? '',
          tests: { daily: { score: row.dailyScore ?? sess?.daily_score ?? scores.daily, max: sess?.daily_max ?? maxes.daily ?? max }, check: { score: row.checkScore ?? sess?.check_score ?? scores.check, max: sess?.check_max ?? maxes.check ?? max } },
          // Free text keeps its words; contact numbers typed into it are masked like every 3.0 view (domain-snapshot-core scrub).
          draft: scrub(row.draft ?? r?.notes ?? ''), trendDraft: scrub(row.trendDraft ?? r?.trend_note ?? ''), note: scrub(row.note ?? sess?.special_note ?? ''), fromSession: !!sp[su.classId],
          attendanceRaw: a?.status ?? null, attendanceLabel: a ? ATT[a.status] || '기타' : null, attendanceNote: a?.note ? scrub(a.note) : null, attendanceUnits: a?.units ?? null,
          reportId: r?.id ?? null,
          report: r ? { status: r.classnote_status || null, badge: R.classnoteBadge(r.classnote_status), sentAt: r.classnote_sent_at, readAt: r.classnote_read_at, revoked: !!r.revoked_at, views: r.views, attachments: Array.isArray(r.attachments) ? r.attachments.length : 0, author: r.teacher_name } : null,
          prev: p ? { date: p.d, progress: unprefix(p.progress, su.subjectLabel), textbook: p.textbook, homeworkToday: p.homework_today, homeworkScore: p.homework_score, attitude: p.attitude, examInfo: p.exam_info, note: p.notes ? scrub(p.notes) : null } : null,
        });
        const facts = { alreadySent: !!r && R.isAlreadySent(r.classnote_status), reportOptout: su.reportOptout, isAbsent: su.attendanceRaw === 'absent', attendanceUnchecked: R.isAttendanceUnchecked(su),
          recallPending: ['recall_requested', 'recalling'].includes(r?.classnote_status), sendInFlight: ['queued', 'processing'].includes(r?.classnote_status),
          // This page has no autowrite and no one-line field, so the new math report and the English one-line can never pass here (2.0 send gate).
          needsAutoWrite: R.isMathReportPilot(st.id, su.subjectKey), needsOneLine: su.subjectKey === 'english' };
        const gate = R.evaluateSendGate({ ...facts, hasProgress: !!su.today.trim(), hasDraft: !!String(su.draft).trim() });
        // The 2.0 gate for each typing state (progress typed? report text typed?), so the page can follow what is typed without its own rules.
        su.gates = Object.fromEntries(['11', '10', '01', '00'].map(k => { const g = R.evaluateSendGate({ ...facts, hasProgress: k[0] === '1', hasDraft: k[1] === '1' }); return [k, { canSend: g.canSend, label: g.label }]; }));
        su.gate = gate.label; su.sendStatus = R.rowSendStatus({ sent: !!r, draft: su.draft }, su); su.saved = !!r;
        const f = R.buildReportFields({ subject: su, homework: su.homework, attitude: su.attitude, tests: su.tests, draft: su.draft, trendDraft: su.trendDraft, showDailyTest: report.showDailyTest, showCheckTest: report.showCheckTest });
        su.preview = { title: `${date.slice(0, 4)}년 ${date.slice(5, 7)}월 ${date.slice(8, 10)}일 ${R.reportTitleText(report.title, { makeup: su.makeup, hasClass: !!su.classId, special: su.isSpecial, subjectLabel: su.subjectLabel })}`, fields: f };
      });
      st.mark = R.attendanceMarkLabel(R.studentMarkFromRows(st)); st.schoolGrade = R.schoolGradeLabel ? R.schoolGradeLabel(st.school, st.grade) : `${st.school || ''}${st.grade || ''}`;
    }
    // Month send calendar (2.0 onescreen_send_calendar: by teacher_name, the attribution axis of that RPC).
    const month = date.slice(0, 7), mStart = `${month}-01`, mEnd = shift(`${R.shiftMonth(month, 1)}-01`, -1);
    const stats = await sql`select report_date::text report_day, coalesce(classnote_status,'') status_key, (coalesce(source,'') <> 'edutrix_import' and revoked_at is null) sendable, count(*)::int cnt
      from public.lesson_reports where tenant_id=${t} and teacher_name=${teacher.name} and report_date between ${mStart} and ${mEnd} group by 1,2,3`;
    const days = R.summarizeSendDays(stats.map(s => ({ reportDay: s.report_day, statusKey: s.status_key, sendable: s.sendable, cnt: s.cnt })));
    return { asOf, teachers: teachers.map(({ id, name, status, classes: n }) => ({ id, name, active: status === 'active', classes: n })), teacher: { id: teacher.id, name: teacher.name },
      date, dateLabel: R.formatKoreanDate(date), dateNote, dow, holiday, noClassesToday, showingAll: all, todayClasses, students,
      settings: { academyName: data.profile?.name || stored?.name || '', showDailyTest: report.showDailyTest, showCheckTest: report.showCheckTest, show: Object.fromEntries(Object.entries(report).filter(([k]) => k.startsWith('show'))), footerNote: report.footerNote || '' },
      attitudes: [...R.ATTITUDE], ...attendanceGate(R, data, teacher, date, asOf),
      history: { month, weeks: R.monthGrid(month), days: Object.fromEntries(days) } };
  },
  // 2단계 (원장 2026-10-28 "연습용이므로 모두 docker"): 2.0's actions with 2.0's inputs on the Docker copy — see the section below.
  actions: {
    save: { validate: raw => reportInput(raw), run: async ({ sql, body, tenantId, importV2 }) => runSave(sql, tenantId, await rules(importV2), body) },
    send: { validate: raw => reportInput(raw), run: async ({ sql, body, tenantId, importV2 }) => runSend(sql, tenantId, await rules(importV2), body) },
    attendance: { validate: raw => attendanceInput(raw), run: async ({ sql, body, tenantId, importV2 }) => runAttendance(sql, tenantId, await rules(importV2), body) },
    // The v2-host server-action boundary (shims/server-action.ts): POST /api/v2/onescreen/<2.0 function> with { module, actor, args } —
    // 2.0's own call, its first argument being 2.0's input. Same checks and writes as above.
    saveLessonReport: { validate: raw => reportInput(hostCall(raw, 'features/onescreen/server/actions.ts')), run: async ({ sql, body, tenantId, importV2 }) => runSave(sql, tenantId, await rules(importV2), body) },
    saveAndQueueClassnote: { validate: raw => reportInput(hostCall(raw, 'features/onescreen/server/actions.ts')), run: async ({ sql, body, tenantId, importV2 }) => runSend(sql, tenantId, await rules(importV2), body) },
    setAttendanceCell: { validate: raw => attendanceInput(hostCall(raw, 'features/attendance/server/actions.ts')), run: async ({ sql, body, tenantId, importV2 }) => runAttendance(sql, tenantId, await rules(importV2), body) },
    saveOnescreenSession: { validate: raw => sessionInput(hostCall(raw, 'features/onescreen/server/actions.ts')), run: async ({ sql, body, tenantId, importV2 }) => runSession(sql, tenantId, await rules(importV2), body) },
  },
};

/** Teachers who can be the screen's teacher: active accounts owning an active class — the props loader (pickActor) and the saves (actAs)
 *  take only active people, so the picker never offers someone whose screen would silently be another teacher's. */
const teacherList = async (sql, t) => (await sql`select u.id, u.display_name name, u.status::text status, count(distinct c.id)::int classes from public.users u
  join public.classes c on c.teacher_id=u.id and c.tenant_id=${t} and c.is_active where u.tenant_id=${t} and u.status::text='active' group by u.id order by u.display_name`)
  .map(x => ({ id: x.id, name: x.name, active: x.status === 'active', classes: x.classes }));
/** What 2.0's (shell) layout wraps a window (embed) screen with, for the v2-host entry. Operations, the switched-off modules and the
 *  licence flags come from the props loader (`hostSettings` — the same resolved settings and copy-time licence judgement it used,
 *  i.e. one source like 2.0's layout → OperationsProvider). Here only what the loader does not make: the teacher's screen language
 *  and the teachers the 3.0 side can pick (2.0 has no picker — the screen is the logged-in teacher's). Presence and the notification
 *  bell are left out (no outside connection). */
async function hostContext(sql, t, R, actorId, hostSettings) {
  const [teachers, [me]] = await Promise.all([teacherList(sql, t),
    actorId ? sql`select display_name, ui_prefs, teacher_view_lang from public.users where tenant_id=${t} and id=${actorId}` : []]);
  return { operations: hostSettings?.operations ?? null, disabledModules: hostSettings?.disabledModules ?? [], licenses: hostSettings?.licenses ?? {},
    // 2.0 getSheetLang: the teacher's own choice (ui_prefs) → the admin's pick (teacher_view_lang) → by name.
    lang: R.resolveSheetLang(R.readTeacherLangPref(me?.ui_prefs), me?.teacher_view_lang ?? null, me?.display_name ?? null), teachers };
}

// ── 2단계: 2.0 saveLessonReport · saveAndQueueClassnote · setAttendanceCell on the Docker copy ─────────────────────────
// Inputs are 2.0's (SaveLessonReportInput · the setAttendanceCell input) plus `actor` — 3.0 has no login, so the page passes
// the person it shows (the timetable screen's convention). The actor becomes the DB identity for the write (request.jwt.claims),
// so 2.0's triggers (activity log, send history, created_by guard) see the same person 2.0 would. The checks and their order
// follow the 2.0 server actions; what this practice screen does not do yet is refused or named back (`ignored`), never faked.
// The interim hand-drawn page sends `form` (what it shows) instead of built fields; the server builds them with 2.0's
// buildReportFields, and stands in for 2.0's client-side send button gate (no autowrite or one-line field on that page).
const VIA = '3.0 연습 복사본';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const unsupported = message => new V2Error(400, 'unsupported', message);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = v => { if (typeof v !== 'string' || !UUID.test(v)) throw bad(); return v; };
const ymd = v => { if (typeof v !== 'string' || !DAY.test(v)) throw bad(); return v; };
const str = (v, max) => { if (v == null) return ''; if (typeof v !== 'string' || v.length > max) throw bad(); return v; };
const score = v => { if (v === null || v === undefined || v === '') return null; if (!Number.isInteger(v) || v < 0 || v > 1000) throw bad(); return v; };
/** 2.0 inputs this practice screen does not save yet (video homework, the autowrite original, English result sheets, send class): left out and named back. */
const NOT_SAVED = ['videoHomework', 'videoHomeworkSeenAt', 'videoSubmitLink', 'videoHomeworkDue', 'mentAutoDraft', 'jjExamPick', 'classnoteClassId'];
/** 2.0 attendance STATUSES without 'makeup' (보강 is not handled on this screen yet). */
const STATUSES = ['present', 'absent', 'late', 'excused', 'early_leave'];
const MASK = '연락처 가림'; // domain-snapshot-core scrub — the hand-drawn page shows free text with contacts masked

/** A v2-host call { module, actor, args:[input] } → the input plus the actor; the module must be the 2.0 file that exports that function. */
function hostCall(raw, module) {
  if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || !plain(raw.args[0])) throw bad();
  return { ...raw.args[0], actor: raw.actor };
}
function reportInput(raw) {
  if (!plain(raw)) throw bad();
  if (raw.makeup === true || raw.outOfClass === true || raw.makeupClassId) throw unsupported('보강·수업 외 보고서는 이 연습 화면에서 아직 저장하지 않습니다.');
  if (raw.mentSource != null && !['manual', 'auto_edited', 'auto'].includes(raw.mentSource)) throw bad();
  const pc = raw.pilotCheck;
  if (pc != null && !(plain(pc) && typeof pc.factsCurrent === 'boolean' && typeof pc.reasonsOk === 'boolean')) throw bad();
  const base = { actor: uuid(raw.actor), studentId: uuid(raw.studentId), classId: uuid(raw.classId), reportDate: raw.reportDate == null || raw.reportDate === '' ? null : ymd(raw.reportDate),
    subject: raw.subject == null || raw.subject === '' ? null : str(raw.subject, 40), mentSource: raw.mentSource ?? undefined,
    pilotOneLine: raw.pilotOneLine == null ? null : str(raw.pilotOneLine, 2000), pilotCheck: pc ? { factsCurrent: pc.factsCurrent, reasonsOk: pc.reasonsOk } : null,
    ignored: NOT_SAVED.filter(k => raw[k] != null) };
  if (raw.form !== undefined) {
    const f = raw.form; if (!plain(f)) throw bad();
    const t = plain(f.tests) ? f.tests : {};
    // draft/trendDraft null = untouched: the stored words are kept (the page shows them with contacts masked).
    return { ...base, form: { today: str(f.today, 4000), textbook: str(f.textbook, 300), homeworkToday: str(f.homeworkToday, 1000), attitude: str(f.attitude, 40), homework: str(f.homework, 200),
      draft: f.draft === null ? null : str(f.draft, 8000), trendDraft: f.trendDraft === null ? null : str(f.trendDraft, 4000),
      tests: { daily: { score: score(t.daily?.score), max: score(t.daily?.max) ?? 5 }, check: { score: score(t.check?.score), max: score(t.check?.max) ?? 5 } },
      // the saved report the page showed for this row (load's matchReportsToRows over all the student's rows), for untouched text
      basisId: f.basisId == null ? null : uuid(f.basisId) } };
  }
  return { ...base, fields: { progress: str(raw.progress, 4000), examInfo: str(raw.examInfo, 200), homeworkScore: str(raw.homeworkScore, 200), notes: str(raw.notes, 8000), textbook: str(raw.textbook, 300),
    homeworkToday: str(raw.homeworkToday, 1000), dailyTest: str(raw.dailyTest, 200), checkTest: str(raw.checkTest, 200), attitude: str(raw.attitude, 40), trendNote: str(raw.trendNote, 4000) } };
}
function attendanceInput(raw) {
  if (!plain(raw)) throw bad();
  if (raw.noteOnly === true || raw.units !== undefined || raw.slotStart != null || raw.periodStart != null || raw.scopeTeacherId != null || raw.ghostTransfer === true)
    throw unsupported('메모만 저장·시수·교시·강사 보기 칸은 이 연습 화면에서 아직 하지 않습니다.');
  if (raw.allowMakeup === true) throw unsupported('보강·수업 나누기로 온 학생의 출결은 이 연습 화면에서 아직 하지 않습니다.');
  if (!(raw.status === null || STATUSES.includes(raw.status))) throw new V2Error(400, 'invalid_status', '잘못된 상태입니다');
  return { actor: uuid(raw.actor), studentId: uuid(raw.studentId), classId: uuid(raw.classId), sessionDate: ymd(raw.sessionDate), status: raw.status,
    note: raw.note === undefined ? undefined : str(raw.note, 500).trim() || null, onlyIfEmpty: raw.onlyIfEmpty === true };
}

async function settingsOf(sql, t, R) {
  const [s] = await sql`select data from public.tenant_settings where tenant_id=${t}`, data = s?.data || {}, D = R.DEFAULT_SETTINGS;
  return { preset: data.preset ?? D.preset, report: { ...D.report, ...(data.report || {}) }, modules: { ...D.modules, ...(data.modules || {}) },
    permissions: { ...D.permissions, ...(data.permissions || {}), specialAccess: { ...D.permissions?.specialAccess, ...(data.permissions?.specialAccess || {}) } },
    subjects: R.buildSubjectMaps(data.operations?.subjects || D.operations.subjects) };
}
/** The picked person as 2.0's logged-in user: an active account of this academy, and the DB identity for this write. */
async function actAs(sql, t, actorId) {
  const [actor] = await sql`select id::text id, display_name, system_role::text role, ui_prefs from public.users where tenant_id=${t} and id=${actorId} and status::text='active'`;
  if (!actor) throw new V2Error(404, 'actor_not_found', '저장할 사람을 찾지 못했습니다.');
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  return actor;
}
/** 2.0 accessLevel over the academy's role and personal overrides (getUserPermMatrix without the 'other teacher view' and lab caps — not used here). */
const menuMatrix = (R, env, actor) => R.applyUserOverrides(R.resolveMatrix(env.permissions.overrides || []), actor.id, actor.role, env.permissions.userOverrides || []);
/** 2.0 getTeachingClassIds: own classes (any state) + delegations active that day + JJ classes for the JJ report managers. */
async function teachingClassIds(sql, t, R, env, actorId, date) {
  const jjManager = (env.permissions.specialAccess?.jjReportManagerIds || []).includes(actorId), dow = jjManager ? R.axisDowOf(date) : null;
  const [own, dels, jj] = await Promise.all([
    sql`select id::text id from public.classes where tenant_id=${t} and teacher_id=${actorId}`,
    sql`select class_id::text class_id, delegate_user_id::text delegate_user_id, from_date::text from_date, to_date::text to_date, revoked_at from public.class_delegations
      where tenant_id=${t} and revoked_at is null and from_date<=${date} and to_date>=${date}`,
    dow ? sql`select class_id::text class_id, teacher_id, slot_teacher_label, valid_from::text valid_from, valid_to::text valid_to from public.class_schedules
      where tenant_id=${t} and day_of_week::text=${dow} and teacher_id is null and slot_teacher_label is not null` : []]);
  const ownIds = own.map(c => c.id), ownSet = new Set(ownIds);
  const jjIds = jj.filter(r => { const slot = { teacherId: r.teacher_id, slotTeacherLabel: r.slot_teacher_label, validFrom: r.valid_from.slice(0, 10), validTo: r.valid_to ? r.valid_to.slice(0, 10) : null };
    return R.isSeatSlot(slot) && R.specialSlotLabel(r.slot_teacher_label) === R.SELF_STUDY_ROOM_LABEL && R.slotLiveOn(slot, date); }).map(r => r.class_id);
  const delegated = [...new Set([...dels.filter(d => d.delegate_user_id === actorId && R.isDelegationActiveOn({ fromDate: d.from_date, toDate: d.to_date, revokedAt: d.revoked_at }, date)).map(d => d.class_id), ...jjIds])];
  return [...ownIds, ...delegated.filter(id => !ownSet.has(id))];
}
/** 2.0 userTaughtClassSet: teaching classes + classes whose timetable slot names this person that day. */
async function taughtClassSet(sql, t, R, env, actorId, date) {
  const [teaching, slots] = await Promise.all([teachingClassIds(sql, t, R, env, actorId, date),
    sql`select class_id::text class_id from public.class_schedules where tenant_id=${t} and teacher_id=${actorId} and valid_from<=${date} and (valid_to is null or valid_to>=${date})`]);
  return new Set([...teaching, ...slots.map(s => s.class_id)]);
}
/** 2.0 attendance gate as the page shows it: no write permission → closed; the 7-day lock only for teacher-level (scoped) accounts. */
function attendanceGate(R, data, teacher, date, asOf) {
  const env = { permissions: { ...R.DEFAULT_SETTINGS.permissions, ...(data.permissions || {}) } }, matrix = menuMatrix(R, env, teacher);
  if (!R.canWrite(teacher.role, 'attendance', matrix)) return { attendanceEditable: false, attendanceLock: '출석 관리 권한이 없습니다' };
  const locked = R.accessLevel(teacher.role, 'attendance', matrix) === 'scoped' && !R.isWithinAttendanceEditWindow(date, asOf);
  return { attendanceEditable: !locked, attendanceLock: locked ? R.attendanceLockMessage(date, asOf) : null };
}
const classRow = async (sql, t, classId) => (await sql`select id::text id, class_name, subject, english_track, report_optout, is_special, is_active, closed_at::text closed_at from public.classes where tenant_id=${t} and id=${classId}`)[0];
const audit = (sql, t, actor, action, targetType, metadata) => sql`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
  values (${t}, ${actor.id}, ${actor.display_name}, ${action}, ${targetType}, null, ${sql.json({ ...metadata, via: VIA })})`;

/** 2.0 saveLessonReport's guard: the actor's teaching classes that day, this class among them, the student enrolled in it that day. */
async function reportScope(sql, t, R, env, actor, b, date) {
  const ids = await teachingClassIds(sql, t, R, env, actor.id, date);
  if (!ids.length) throw new V2Error(409, 'no_classes', '담당 반이 없습니다');
  if (!ids.includes(b.classId)) throw new V2Error(409, 'not_my_class', '담당 반이 아닙니다');
  const [enr] = await sql`select 1 from public.enrollments where tenant_id=${t} and class_id=${b.classId} and student_id=${b.studentId}
    and (start_date is null or start_date<=${date}) and (end_date is null or end_date>=${date}) limit 1`;
  if (!enr) throw new V2Error(409, 'not_my_student', '담당 학생이 아닙니다');
  return classRow(sql, t, b.classId);
}

/** Turns a request into 2.0's saved fields: as given (2.0 input), or built from the hand-drawn page's form with buildReportFields. */
async function prepare(sql, t, R, env, b, cls, date, actor) {
  if (b.fields) return { fields: b.fields, mentSource: b.mentSource, form: null };
  const form = { ...b.form };
  for (const k of ['draft', 'trendDraft']) if (form[k] != null && form[k].includes(MASK)) throw new V2Error(409, 'masked_text', '연락처가 가려진 글이라 이 화면에서는 고칠 수 없습니다 — 원문을 지키려고 저장하지 않았습니다.');
  // What the page showed: the actor's working session first, then the saved report the page matched to this row (load matches over all
  // the student's rows that day — a class-less report goes to the first matching row — so the page names it: basisId).
  const [[r], [s]] = await Promise.all([
    form.basisId ? sql`select notes, trend_note from public.lesson_reports where tenant_id=${t} and student_id=${b.studentId} and report_date=${date} and id=${form.basisId}` : [],
    sql`select subject_progress->${cls.id} p from public.onescreen_daily_sessions where tenant_id=${t} and session_date=${date} and updated_by=${actor.id} and student_id=${b.studentId} limit 1`]);
  const p = s?.p || {};
  if (form.draft === null) form.draft = p.draft ?? r?.notes ?? '';
  if (form.trendDraft === null) form.trendDraft = p.trendDraft ?? r?.trend_note ?? '';
  const label = env.subjects.labelOf(cls.subject), rs = env.report;
  const fields = R.buildReportFields({ subject: { subjectLabel: label, name: label, today: form.today, textbook: form.textbook, homeworkToday: form.homeworkToday, makeup: false },
    homework: form.homework, attitude: form.attitude || null, tests: form.tests, draft: form.draft, trendDraft: form.trendDraft, showDailyTest: rs.showDailyTest, showCheckTest: rs.showCheckTest });
  // 2.0's client judges the ment source against the session's last autowrite snapshot (computeClientMentSource).
  return { fields, mentSource: b.mentSource ?? R.computeClientMentSource(form.draft, p.autoDraft ?? null), form };
}

/** 2.0 saveLessonReport: refuse a sent report, then upsert on (tenant, student, date, unit_key); its audit line. */
async function saveReport(sql, t, R, env, b, { actor, cls, date }) {
  const [prior] = await sql`select id, classnote_status, notes, ment_source from public.lesson_reports where tenant_id=${t} and student_id=${b.studentId} and report_date=${date} and class_id=${cls.id} limit 1`;
  if (prior?.classnote_status === 'success') throw new V2Error(409, 'already_sent', '이미 학부모에게 발송된 보고서라 수정할 수 없습니다 — 고쳐야 하면 공유링크를 재발급하세요');
  const { fields: f, mentSource, form } = await prepare(sql, t, R, env, b, cls, date, actor);
  // 2.0: '학습 추세 미발송' (the actor's own setting, ui_prefs) empties the trend note on save as well.
  const trendOff = !!f.trendNote && R.readTrendOptOut(actor.ui_prefs).includes(R.trendOptOutKey(cls.id, b.studentId));
  const ment = R.resolveMentSource({ client: mentSource, prevSource: prior?.ment_source, prevNotes: prior?.notes, nextNotes: f.notes });
  const [row] = await sql`insert into public.lesson_reports (tenant_id, student_id, report_date, subject, class_id, textbook, makeup, homework_today, progress, exam_info, homework_score, makeup_class_id,
      daily_test, check_test, attitude, teacher_name, created_by, notes, trend_note, source, ment_source)
    values (${t}, ${b.studentId}, ${date}, ${b.subject}, ${cls.id}, ${f.textbook || null}, false, ${R.normalizeNoneMarker(f.homeworkToday)}, ${f.progress || null}, ${f.examInfo || null},
      ${R.normalizeNoneMarker(f.homeworkScore)}, null, ${f.dailyTest || null}, ${f.checkTest || null}, ${f.attitude || null}, ${actor.display_name}, ${actor.id}, ${f.notes || null}, ${trendOff ? null : f.trendNote || null}, 'onescreen', ${ment})
    on conflict (tenant_id, student_id, report_date, unit_key) do update set subject=excluded.subject, class_id=excluded.class_id, textbook=excluded.textbook, makeup=excluded.makeup,
      homework_today=excluded.homework_today, progress=excluded.progress, exam_info=excluded.exam_info, homework_score=excluded.homework_score, makeup_class_id=excluded.makeup_class_id,
      daily_test=excluded.daily_test, check_test=excluded.check_test, attitude=excluded.attitude, teacher_name=excluded.teacher_name, created_by=excluded.created_by, notes=excluded.notes,
      trend_note=excluded.trend_note, source=excluded.source, ment_source=excluded.ment_source
    returning id, share_token::text share_token, ment_source`;
  await audit(sql, t, actor, 'lesson_report_save', 'lesson_report', { reportId: row.id, studentId: b.studentId, date, subject: b.subject, classId: cls.id, created: !prior });
  if (form) {
    // 2.0 autosaves the typed row into the actor's working session (saveOnescreenSession) before a save lands, so session and report
    // agree. The hand-drawn page has no autosave: a session entry this class already has takes the saved values (else the page,
    // which reads the session first like 2.0, would show the old typing after the save).
    const typed = { today: form.today, textbook: form.textbook, homeworkToday: form.homeworkToday, attitude: form.attitude, homework: form.homework, dailyScore: form.tests.daily.score, checkScore: form.tests.check.score, draft: form.draft, trendDraft: form.trendDraft };
    await sql`update public.onescreen_daily_sessions set subject_progress = jsonb_set(subject_progress, ${[cls.id]}::text[], (subject_progress->${cls.id}) || ${sql.json(typed)}), updated_at = now()
      where tenant_id=${t} and student_id=${b.studentId} and session_date=${date} and updated_by=${actor.id} and subject_progress ? ${cls.id}`;
  }
  // The values as 2.0 stores them (none-marker, trimmed text) — the hand-drawn page drops its typing once the data shows either form.
  const stored = form ? { today: form.today.trim(), homeworkToday: R.normalizeNoneMarker(f.homeworkToday) ?? '', homework: R.normalizeNoneMarker(f.homeworkScore) ?? '', draft: f.notes, trendDraft: trendOff ? '' : f.trendNote ?? '' } : undefined;
  return { ok: true, saved: true, id: row.id, shareToken: row.share_token, created: !prior, mentSource: row.ment_source, notes: f.notes, ...(stored ? { stored } : {}), ...(b.ignored.length ? { ignored: b.ignored } : {}) };
}
async function runSave(sql, t, R, b) {
  const env = await settingsOf(sql, t, R), actor = await actAs(sql, t, b.actor), date = R.resolveReportDate(b.reportDate, await copyDay());
  const cls = await reportScope(sql, t, R, env, actor, b, date);
  const { notes, ...out } = await saveReport(sql, t, R, env, b, { actor, cls, date });
  return out;
}

/** 2.0 explainBoardMissing without the sync request (no sync PC is attached to the copy): why this student has no live class board. */
async function boardMissing(sql, t, R, cls, studentId, today) {
  const [enr, mem, [stu], [{ n: links }], [{ n: members }]] = await Promise.all([
    sql`select start_date::text start_date, end_date::text end_date from public.enrollments where tenant_id=${t} and student_id=${studentId} and class_id=${cls.id}`,
    sql`select status, reason from public.classnote_class_board_members where tenant_id=${t} and class_id=${cls.id} and student_id=${studentId}`,
    sql`select status::text status, is_test from public.students where tenant_id=${t} and id=${studentId}`,
    sql`select count(*)::int n from public.classnote_class_boards where tenant_id=${t} and class_id=${cls.id}`,
    sql`select count(*)::int n from public.classnote_class_board_members where tenant_id=${t} and class_id=${cls.id}`]);
  const holdReason = mem.find(m => m.status !== 'ok')?.reason ?? null;
  const kind = R.classifyBoardMissing({
    liveNow: enr.some(e => (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date >= today)), ended: enr.some(e => !!e.end_date && e.end_date < today),
    syncTarget: R.isSendCandidateClass({ subject: cls.subject, is_active: cls.is_active, report_optout: cls.report_optout, closed_at: cls.closed_at }, today) && stu?.status === 'enrolled' && !stu?.is_test,
    classLinked: links > 0, classMemberCount: members, memberStatuses: mem.map(m => m.status), holdReason });
  return R.boardMissingNotice(kind, false, holdReason);
}
/** 2.0 saveAndQueueClassnote up to the queue row, in 2.0's order. A refusal after the save keeps the save (ok:false, saved). No ClassNote call. */
async function runSend(sql, t, R, b) {
  const env = await settingsOf(sql, t, R), actor = await actAs(sql, t, b.actor), asOf = await copyDay(), date = R.resolveReportDate(b.reportDate, asOf);
  const cls = await reportScope(sql, t, R, env, actor, b, date);
  const [prior] = await sql`select id, classnote_status, revoked_at from public.lesson_reports where tenant_id=${t} and student_id=${b.studentId} and report_date=${date} and class_id=${cls.id} limit 1`;
  if (['recall_requested', 'recalling'].includes(prior?.classnote_status)) return { ok: true, id: prior.id, status: 'recall_pending', message: '회수 처리 중 — 게시글 삭제가 끝난 뒤에 보낼 수 있습니다' };
  let fromRecalled = false;
  if (prior?.classnote_status === 'recalled') {
    await sql`update public.lesson_reports set share_token=gen_random_uuid(), revoked_at=null, revoked_by=null, classnote_status=null, classnote_error=null, classnote_sent_at=null, classnote_queued_at=null,
      classnote_processing_at=null, classnote_retry_count=0 where id=${prior.id} and classnote_status='recalled'`;
    fromRecalled = true;
  } else if (prior?.revoked_at) return { ok: true, id: prior.id, status: 'revoked', message: '링크 취소됨 — 재발급 필요' };
  if (prior?.classnote_status === 'processing') return { ok: true, id: prior.id, status: 'processing', message: 'ClassNote 처리 중' };
  if (prior?.classnote_status === 'success') return { ok: true, id: prior.id, status: 'already_sent', message: '발송됨 — 재발송 불가' };
  if (b.form) {
    // The hand-drawn page stands in for 2.0's send button (evaluateSendGate): progress and report text, and — since this page has no
    // autowrite and no one-line field — the new math report's autowrite and the English one-line conditions. Nothing is saved then.
    const draft = b.form.draft ?? (await prepare(sql, t, R, env, b, cls, date, actor)).form.draft;
    const g = R.evaluateSendGate({ alreadySent: false, isAbsent: false, attendanceUnchecked: false, hasProgress: !!b.form.today.trim(), hasDraft: !!String(draft).trim(),
      needsAutoWrite: R.isMathReportPilot(b.studentId, b.subject), needsOneLine: b.subject === 'english' });
    if (!g.canSend) throw new V2Error(409, 'send_gate', g.label || '발송할 수 없습니다.');
  }
  const { notes, ...saved } = await saveReport(sql, t, R, env, b, { actor, cls, date });
  const unqueue = async () => { if (prior?.classnote_status === 'queued') await sql`update public.lesson_reports set classnote_status=null, classnote_queued_at=null where id=${saved.id} and classnote_status='queued'`; };
  const stop = (status, message) => ({ ...saved, status, message: `${message} — 저장은 됐습니다` });
  const refuse = async (error, extra = {}) => { await unqueue(); return { ...saved, ok: false, ...extra, error, message: error }; };
  // 2.0: the new math report (all math) needs the autowritten text, current facts, reasons and the one-line ment; English needs the one-line.
  const pilotBlock = !R.isMathReportPilot(b.studentId, b.subject)
    ? b.subject === 'english' && !(b.pilotOneLine ?? '').trim() ? R.ENGLISH_ONELINE_REQUIRED_ERROR
      : b.subject === 'english' && b.pilotCheck && !b.pilotCheck.reasonsOk ? R.PILOT_REASON_REQUIRED_ERROR : null
    : saved.mentSource !== 'auto' && saved.mentSource !== 'auto_edited' ? R.PILOT_AUTOWRITE_REQUIRED_ERROR
      : !b.pilotCheck?.factsCurrent ? R.PILOT_AUTOWRITE_REQUIRED_ERROR
        : !b.pilotCheck.reasonsOk ? R.PILOT_REASON_REQUIRED_ERROR
          : !R.pilotOneLineAttached(notes, b.pilotOneLine) ? R.PILOT_ONELINE_REQUIRED_ERROR : null;
  if (pilotBlock) return refuse(pilotBlock);
  if (!R.classnoteSendOn(env)) return stop('dry_run', '이 학원은 ClassNote 발송이 꺼져 있습니다');
  if (!R.isClassnoteSubjectEnabled(b.subject, env.report.classnoteSubjects || [])) return stop('subject_off', '발송 대상 아님(과목 설정)');
  if (R.isSlotOnlyEnglishNotes(b.subject, notes)) return refuse('글이 그림·첨부 자리뿐이라 보내지 않았습니다(저장은 됐습니다) — 글을 채운 뒤 다시 보내 주세요');
  if (cls.report_optout) { await unqueue(); return stop('report_optout', '미발송 반 — 발송 제외'); }
  // 2.0 absence gate with a class: that class's records only (0134a); the unchecked gate only for accounts that may write attendance.
  const att = await sql`select id, class_id::text class_id, status::text status, recorded_at from public.attendance_records where tenant_id=${t} and student_id=${b.studentId} and session_date=${date} and class_id=${cls.id} order by id`;
  const absent = R.isAbsentForSend(att.map(a => ({ id: a.id, classId: a.class_id, status: a.status, recordedAt: new Date(a.recorded_at).toISOString() })));
  const checked = att.length > 0 || !R.canWrite(actor.role, 'attendance', menuMatrix(R, env, actor));
  if (absent || !checked) { await unqueue(); return absent ? stop('absent', '결석 — 발송 제외') : stop('no_attendance', '출결 미체크 — 발송 제외'); }
  // 2.0 hasClassnoteNameCollision: another enrolled/on-hold student with the same ClassNote name → name_conflict, not queued.
  const [st] = await sql`select name, classnote_name from public.students where tenant_id=${t} and id=${b.studentId}`, eff = st?.classnote_name?.trim() || st?.name?.trim();
  if (eff) {
    const [{ n }] = await sql`select count(*)::int n from public.students where tenant_id=${t} and status::text = any(${[...R.COLLISION_STATUSES]})
      and (classnote_name = ${eff} or (classnote_name is null and name = ${eff}))`;
    if (R.isNameCollision(n)) {
      await sql`update public.lesson_reports set classnote_status='name_conflict', classnote_queued_at=null, classnote_error='동명이인 감지 — 자동 발송 차단'
        where id=${saved.id} and (classnote_status is null or classnote_status not in ('processing','success'))`;
      return stop('name_conflict', '동명이인 감지 — 자동 발송 차단');
    }
  }
  // 2.0 class route (math by class board): this student's live board in this class, else refuse with 2.0's reason.
  if (R.classRouteActive(env, actor.display_name) && R.SEND_CLASS_SUBJECTS.has(b.subject ?? '')) {
    const [eligible, boards, mem] = await Promise.all([
      sql`select id::text id from public.classes where tenant_id=${t} and id=${cls.id} and is_active and not report_optout and subject in ('math','subject_1')`,
      sql`select class_id::text class_id from public.classnote_class_boards where tenant_id=${t} and class_id=${cls.id}`,
      sql`select class_id::text class_id, status from public.classnote_class_board_members where tenant_id=${t} and student_id=${b.studentId} and class_id=${cls.id}`]);
    const live = R.liveBoardClassIdsOf(eligible.map(c => c.id), boards.map(x => x.class_id), mem.map(m => ({ classId: m.class_id, status: m.status })));
    if (!live.includes(cls.id)) { const why = await boardMissing(sql, t, R, cls, b.studentId, asOf); return refuse(why.error, { status: why.status, boardHoldReason: why.holdReason }); }
  }
  const allowed = R.isClassnoteAllowed(date, asOf), status = allowed ? 'queued' : 'too_old';
  const [q] = await sql`update public.lesson_reports set classnote_status=${status}, classnote_queued_at=${allowed ? sql`now()` : null}, classnote_retry_count=0, classnote_error=null
    where id=${saved.id} and (classnote_status is null or classnote_status not in ('processing','success')) returning id`;
  if (!q) { const [now] = await sql`select classnote_status from public.lesson_reports where id=${saved.id}`, busy = now?.classnote_status === 'processing';
    return { ...saved, status: busy ? 'processing' : 'already_sent', message: busy ? 'ClassNote 처리 중 — 저장은 됐습니다' : '발송됨 — 재발송 불가' }; }
  await audit(sql, t, actor, 'classnote_send', 'lesson_report', { reportId: saved.id, studentId: b.studentId, date, subject: b.subject, classId: cls.id, status, ...(fromRecalled ? { fromRecalled: true } : {}) });
  return { ...saved, status, message: allowed ? 'ClassNote 발송 대기에 올렸습니다 — 복사본이라 실제 발송은 없습니다' : 'ClassNote 발송 제외(오래됨)' };
}

/** 2.0 setAttendanceCell for one class and the whole day (no period): permission, the teacher-only lock and scope, then update in place / insert / clear. */
async function runAttendance(sql, t, R, b) {
  const env = await settingsOf(sql, t, R), actor = await actAs(sql, t, b.actor), asOf = await copyDay(), date = b.sessionDate;
  const matrix = menuMatrix(R, env, actor);
  if (!R.canWrite(actor.role, 'attendance', matrix)) throw new V2Error(403, 'forbidden', '출석 관리 권한이 없습니다');
  const taught = await taughtClassSet(sql, t, R, env, actor.id, date);
  if (R.accessLevel(actor.role, 'attendance', matrix) === 'scoped') {
    // 2.0 locks and scopes only teacher-level accounts: the 7-day window, the classes they teach, students of that class (or a record already there).
    if (!R.isWithinAttendanceEditWindow(date, asOf)) throw new V2Error(409, 'attendance_locked', R.attendanceLockMessage(date, asOf));
    if (!taught.has(b.classId)) throw new V2Error(409, 'not_my_class', '담당 반이 아닙니다');
    const [[{ n: enrolled }], [{ n: existing }]] = await Promise.all([
      sql`select count(*)::int n from public.enrollments where tenant_id=${t} and class_id=${b.classId} and student_id=${b.studentId} and (start_date is null or start_date<=${date}) and (end_date is null or end_date>=${date})`,
      sql`select count(*)::int n from public.attendance_records where tenant_id=${t} and class_id=${b.classId} and student_id=${b.studentId} and session_date=${date}`]);
    if (!R.canWriteAttendanceStudent({ enrolled: enrolled > 0, hasRecord: existing > 0, allowMakeup: false })) throw new V2Error(409, 'not_my_student', '이 반 수강생이 아닙니다');
  }
  const cls = await classRow(sql, t, b.classId);
  if (!cls) throw bad();
  const via = taught.has(cls.id) ? 'teacher' : 'desk'; // 2.0 resolveWriteVia
  const rows = await sql`select id, status::text status, slot_start::text slot_start, note, session_units::float8 units from public.attendance_records where tenant_id=${t} and student_id=${b.studentId}
    and class_id=${cls.id} and session_date=${date} order by recorded_at desc, id desc`;
  const base = { studentId: b.studentId, classId: cls.id, date }, back = date < asOf ? { backdated: true } : {};
  if (b.status === null) {
    if (rows.length) await sql`delete from public.attendance_records where id = any(${rows.map(r => r.id)})`;
    await audit(sql, t, actor, 'attendance_clear', 'attendance', { ...base, ...back });
    return { ok: true, status: null };
  }
  if (rows.length) {
    // 2.0: a non-destructive first mark (onlyIfEmpty) never overwrites — it returns what is there.
    if (b.onlyIfEmpty) return { ok: true, conflict: { status: rows[0].status, note: rows[0].note ?? null, units: rows[0].units ?? null } };
    const { updateIds } = R.pickSaveTargets(rows, null);
    await sql`update public.attendance_records set status=${b.status}, recorded_by=${actor.id}, recorded_at=now(), recorded_via=${via} ${b.note !== undefined ? sql`, note=${b.note}` : sql``} where id = any(${updateIds})`;
    await audit(sql, t, actor, 'attendance_cell', 'attendance', { ...base, status: b.status, overwrote: true, prevStatus: rows[0].status, ...back });
    return { ok: true, status: b.status };
  }
  // New row: 2.0 resolveAutoUnits (lesson profile on → planAutoUnits over that class's schedules) then newRowUnits.
  let lookedUp;
  if (R.autoUnitsApply({ rawUnits: undefined, slotStart: null, status: b.status })) {
    if (R.lessonProfileOf({ preset: env.preset }).autoUnits) {
      const sch = await sql`select day_of_week::text day_of_week, start_time::text start_time, end_time::text end_time, valid_from::text valid_from, valid_to::text valid_to, slot_teacher_label, lab_separate
        from public.class_schedules where tenant_id=${t} and class_id=${cls.id} and valid_from<=${date} and (valid_to is null or valid_to>=${date})`;
      const track = cls.english_track === 'eie' || cls.english_track === 'injaewon' ? cls.english_track : null;
      const plan = R.planAutoUnits([{ classId: cls.id, date }], new Map([[cls.id, cls.subject ?? null]]), new Map([[cls.id, sch.map(x => R.toAutoUnitsSchedule(x))]]),
        new Map([[cls.id, track]]), new Map([[cls.id, cls.class_name]]));
      lookedUp = plan.get(R.autoUnitsKey(cls.id, date, null)) ?? null;
    } else lookedUp = null;
  }
  const units = R.newRowUnits(undefined, null, lookedUp), insertedAuto = units.auto === undefined ? undefined : units.units;
  await sql`insert into public.attendance_records (tenant_id, class_id, student_id, session_date, slot_start, status, note, session_units, recorded_by, recorded_via)
    values (${t}, ${cls.id}, ${b.studentId}, ${date}, null, ${b.status}, ${b.note ?? null}, ${units.units}, ${actor.id}, ${via})`;
  await audit(sql, t, actor, 'attendance_cell', 'attendance', { ...base, status: b.status, created: true, ...(insertedAuto != null ? { autoUnits: insertedAuto } : {}), ...back });
  return { ok: true, status: b.status, autoUnits: insertedAuto ?? null };
}

// ── 2.0 saveOnescreenSession: the teacher's working session (2.0 autosaves it 800ms after typing) ──────────────────────
const num = v => { if (v === null || v === undefined) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw bad(); return v; };
const opt = (v, max) => (v === null || v === undefined ? null : str(v, max));
function sessionInput(raw) {
  if (!plain(raw)) throw bad();
  const sp = raw.subjectProgress ?? {};
  if (!plain(sp) || JSON.stringify(sp).length > 400_000) throw bad();
  return { actor: uuid(raw.actor), studentId: uuid(raw.studentId), outOfClass: raw.outOfClass === true, sessionDate: raw.sessionDate == null || raw.sessionDate === '' ? null : ymd(raw.sessionDate),
    classId: raw.classId == null ? null : uuid(raw.classId), baseUpdatedAt: raw.baseUpdatedAt == null ? null : str(raw.baseUpdatedAt, 64), studyGrade: opt(raw.studyGrade, 40), subjectProgress: sp,
    dailyScore: num(raw.dailyScore), dailyMax: num(raw.dailyMax), checkScore: num(raw.checkScore), checkMax: num(raw.checkMax), attitude: opt(raw.attitude, 40), homework: opt(raw.homework, 200),
    note: opt(raw.note, 4000), progressConfirmed: raw.progressConfirmed === true };
}
/** 2.0 order: the actor's teaching classes that day, a student of them (or out-of-class: a student of this academy), then write only from the
 *  revision that was read (sessionSaveDecision · preserveMakeupSessionEntries · updated_at compare-and-set). No audit line (2.0 logs none). */
async function runSession(sql, t, R, b) {
  const env = await settingsOf(sql, t, R), actor = await actAs(sql, t, b.actor), date = R.resolveReportDate(b.sessionDate, await copyDay());
  const ids = await teachingClassIds(sql, t, R, env, actor.id, date);
  if (!ids.length) throw new V2Error(409, 'no_classes', '담당 반이 없습니다');
  const [enr] = await sql`select 1 from public.enrollments where tenant_id=${t} and student_id=${b.studentId} and (start_date is null or start_date<=${date})
    and (end_date is null or end_date>=${date}) and class_id::text = any(${ids}) limit 1`;
  if (!enr) {
    if (!b.outOfClass) throw new V2Error(409, 'not_my_student', '담당 학생이 아닙니다');
    const [st] = await sql`select 1 from public.students where tenant_id=${t} and id=${b.studentId}`;
    if (!st) throw new V2Error(409, 'not_academy_student', '학원 학생이 아닙니다');
  }
  // Timestamps as PostgREST writes them — the page compares them as text (sameSessionRevision).
  const [prior] = await sql`select to_json(updated_at)#>>'{}' updated_at, subject_progress, attitude, homework, special_note, daily_score, check_score from public.onescreen_daily_sessions
    where tenant_id=${t} and student_id=${b.studentId} and session_date=${date} and updated_by=${actor.id}`;
  const incoming = { subjectProgress: b.subjectProgress, attitude: b.attitude, homework: b.homework, note: b.note, dailyScore: b.dailyScore, checkScore: b.checkScore };
  if (R.sessionSaveDecision(R.sessionContentFromRow(prior ?? null), incoming, R.sameSessionRevision(b.baseUpdatedAt ?? undefined, prior?.updated_at)) === 'ignore')
    return { ok: true, skipped: true, updatedAt: prior?.updated_at ?? undefined };
  const progress = sql.json(R.preserveMakeupSessionEntries(prior?.subject_progress ?? {}, b.subjectProgress));
  const v = { class_id: b.classId, study_grade: b.studyGrade, daily_score: b.dailyScore, daily_max: b.dailyMax, check_score: b.checkScore, check_max: b.checkMax, attitude: b.attitude, homework: b.homework, special_note: b.note, progress_confirmed: b.progressConfirmed };
  if (!prior) {
    const [row] = await sql`insert into public.onescreen_daily_sessions (tenant_id, student_id, session_date, class_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework,
        special_note, progress_confirmed, updated_by, updated_at)
      values (${t}, ${b.studentId}, ${date}, ${v.class_id}, ${v.study_grade}, ${progress}, ${v.daily_score}, ${v.daily_max}, ${v.check_score}, ${v.check_max}, ${v.attitude}, ${v.homework},
        ${v.special_note}, ${v.progress_confirmed}, ${actor.id}, clock_timestamp()) returning to_json(updated_at)#>>'{}' updated_at`;
    return { ok: true, updatedAt: row.updated_at };
  }
  const [row] = await sql`update public.onescreen_daily_sessions set class_id=${v.class_id}, study_grade=${v.study_grade}, subject_progress=${progress}, daily_score=${v.daily_score}, daily_max=${v.daily_max},
      check_score=${v.check_score}, check_max=${v.check_max}, attitude=${v.attitude}, homework=${v.homework}, special_note=${v.special_note}, progress_confirmed=${v.progress_confirmed}, updated_at=clock_timestamp()
    where tenant_id=${t} and updated_by=${actor.id} and student_id=${b.studentId} and session_date=${date}
      and updated_at=(${prior.updated_at}::text)::timestamptz -- as text: postgres.js would turn a timestamptz parameter into a JS Date and drop the microseconds
    returning to_json(updated_at)#>>'{}' updated_at`;
  return row ? { ok: true, updatedAt: row.updated_at } : { ok: true, skipped: true };
}
