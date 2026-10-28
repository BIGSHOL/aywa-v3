// 2.0 화면 · 선생님 원스크린(수업보고서 작성·발송 포함) — 1단계 보기 동등 (V2-SCREENS.md). For a chosen teacher and day:
// the classes of that day, the student × class rows, today's saved report (or the working session), the previous lesson,
// attendance, send status and the parent preview, on the local copy (read-only). Rules follow 2.0's `getTeacherRoster`
// (src/features/onescreen/server/roster.ts) in SQL; every judgement that 2.0 keeps as a pure function is imported as is
// (importV2): enrolment filter, report↔row matching, exam parsing, attendance mark, send gate, ClassNote badge, send
// status, report fields and title, month send calendar. Nothing here writes or sends.
import { readFile } from 'node:fs/promises';
import { activeBackup } from './full-db-paths.mjs';
import { scrub } from './domain-snapshot-core.mjs';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ATT = { present: '출석', late: '지각', early_leave: '조퇴', absent: '결석', makeup: '보강' };
const MODULES = ['features/onescreen/roster-filter.ts', 'features/onescreen/report-unit.ts', 'features/onescreen/exam-info.ts', 'features/onescreen/attendance-mark.ts',
  'features/onescreen/send-gate.ts', 'features/onescreen/classnote-badge.ts', 'features/onescreen/status.ts', 'features/onescreen/report-fields.ts', 'features/onescreen/report-title.ts',
  'features/onescreen/send-calendar.ts', 'features/onescreen/student-order.ts', 'features/onescreen/grid.ts', 'features/owner/defaults.ts', 'features/owner/subjects.ts',
  'lib/date-kst.ts', 'lib/format/school-grade.ts', 'features/onescreen/textbook-carry.ts'];
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
  params: { teacher: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, date: /^\d{4}-\d{2}-\d{2}$/, all: /^1$/ },
  async load({ sql, params, tenantId: t, importV2 }) {
    const R = await rules(importV2), asOf = await copyDay();
    const [stored] = await sql`select s.data, tn.name from public.tenants tn left join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
    const data = stored?.data || {}, report = { ...R.DEFAULT_SETTINGS.report, ...(data.report || {}) };
    const subjects = R.buildSubjectMaps(data.operations?.subjects || R.DEFAULT_SETTINGS.operations.subjects), gradeLevels = data.operations?.gradeLevels || R.DEFAULT_SETTINGS.operations.gradeLevels;
    const testMaxOf = key => (data.operations?.subjects || []).find(s => s.key === key)?.testMax ?? 5;
    // Teachers who own an active class (2.0 getTeachingClasses' own-class source), with their recent report count for the default pick.
    const teachers = await sql`select u.id, u.display_name name, u.status::text status, count(distinct c.id)::int classes,
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
          report: r ? { status: r.classnote_status || null, badge: R.classnoteBadge(r.classnote_status), sentAt: r.classnote_sent_at, readAt: r.classnote_read_at, revoked: !!r.revoked_at, views: r.views, attachments: Array.isArray(r.attachments) ? r.attachments.length : 0, author: r.teacher_name } : null,
          prev: p ? { date: p.d, progress: unprefix(p.progress, su.subjectLabel), textbook: p.textbook, homeworkToday: p.homework_today, homeworkScore: p.homework_score, attitude: p.attitude, examInfo: p.exam_info, note: p.notes ? scrub(p.notes) : null } : null,
        });
        const gate = R.evaluateSendGate({ alreadySent: !!r && R.isAlreadySent(r.classnote_status), reportOptout: su.reportOptout, isAbsent: su.attendanceRaw === 'absent',
          hasProgress: !!su.today.trim(), hasDraft: !!String(su.draft).trim(), attendanceUnchecked: R.isAttendanceUnchecked(su), sendInFlight: ['queued', 'processing'].includes(r?.classnote_status) });
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
      history: { month, weeks: R.monthGrid(month), days: Object.fromEntries(days) } };
  },
};
