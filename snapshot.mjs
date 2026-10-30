import { openFullDatabase, tenantId } from './full-db.mjs';
import { fullDbRoot, activeBackup } from './full-db-paths.mjs';
import { readFile } from 'node:fs/promises';
import { snapshotTables } from './snapshot-tables.mjs';
import { loadWorkspaces } from './domain-snapshot.mjs';
import { loadKnownContacts, maskBaseModel } from './domain-snapshot-mask.mjs';
import { billingName, loadBillingLines, projectBillingLines } from './billing-lines.mjs';

const date = value => value ? (value instanceof Date ? new Date(value.getTime() + 9 * 3600000).toISOString() : String(value)).slice(0, 10) : '';
const num = value => Number(value || 0);
const sum = (rows, field) => rows.reduce((n, row) => n + num(row[field]), 0);
const group = (rows, key) => {
  const result = new Map();
  for (const row of rows) { const k = typeof key === 'function' ? key(row) : row[key]; if (!result.has(k)) result.set(k, []); result.get(k).push(row); }
  return result;
};
const breakdown = (rows, key) => [...group(rows, key)].map(([label, items]) => ({ label: label || '미입력', count: items.length })).sort((a, b) => b.count - a.count);
const recent = (rows, field, n = 5) => [...rows].sort((a, b) => date(b[field]).localeCompare(date(a[field]))).slice(0, n);
const monthRange = today => Array.from({ length: 12 }, (_, i) => {
  const dt = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); dt.setUTCMonth(dt.getUTCMonth() - 11 + i); return dt.toISOString().slice(0, 7);
});

// The development server reads only the isolated Docker copy. No source URL,
// source credentials, auth records, or external service clients are used here.
export async function loadSnapshot() {
  const db = await openFullDatabase();
  try {
    return await db.begin('isolation level repeatable read read only', async sql => {
      const {directory}=await activeBackup();
      const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
      const verification=JSON.parse(await readFile(new URL('verification.json',fullDbRoot),'utf8'));
      if(!verification.passed||verification.capturedAt!==manifest.capturedAt)throw new Error('The complete snapshot must pass verification first');
      const [tenant]=await sql`select id,name,slug from public.tenants where id=${tenantId}`;
      if(tenant?.slug!=='cs')throw new Error('Local snapshot tenant mismatch');
      const asOf=new Date(new Date(manifest.capturedAt).getTime()+9*3600000).toISOString().slice(0,10);
      const info={tenant,asOf,importedAt:manifest.capturedAt,tables:manifest.tables.map(t=>({table:`${t.schema}.${t.name}`,rows:Number(t.rows)}))};
      const raw = {};
      for (const table of Object.keys(snapshotTables)) raw[table] = await sql`select * from ${sql(`public.${table}`)} where tenant_id=${tenantId}`;
      // Contacts typed into free text (일정 제목·학부모 글 …) are masked value-only for this local view.
      await loadKnownContacts(sql,tenantId);
      const model=maskBaseModel(buildReadModel(raw, info, await loadBillingLines()));
      const [connection]=await sql`select status, dnd_enabled, dnd_start, dnd_end, digest_at from public.slack_connections where tenant_id=${tenantId}`;
      const [rules]=await sql`select count(*) filter (where enabled)::int as enabled from public.slack_rules where tenant_id=${tenantId}`;
      const deliveries=await sql`select status,count(*)::int as count from public.slack_outbox where tenant_id=${tenantId} group by status`;
      model.channels={slack:{configured:connection?.status==='active',quiet:connection?.dnd_enabled?`${String(connection.dnd_start).slice(0,5)}–${String(connection.dnd_end).slice(0,5)}`:'',digest:String(connection?.digest_at||'').slice(0,5),enabledRules:rules.enabled,deliveries}};
      // 업무 영역 기록과 첫 화면 자료는 같은 읽기 시점에서 만든다.
      model.workspaces=await loadWorkspaces(sql,{tenantId,asOf,capturedAt:manifest.capturedAt});
      return model;
    });
  } finally { await db.end(); }
}

export function buildReadModel(r, info, billingTools = null) {
  const today = info.asOf, month = today.slice(0, 7), months = monthRange(today);
  const start = months[0], lastSix = months.slice(-6);
  const eligibleStudents = r.students.filter(s => !s.is_test);
  const studentIds = new Set(eligibleStudents.map(s => s.id));
  const actualStudent = row => studentIds.has(row.student_id);
  const studentMap = new Map(eligibleStudents.map(s => [s.id, s]));
  const userMap = new Map(r.users.map(s => [s.id, s]));
  const roomMap = new Map(r.classrooms.map(s => [s.id, s]));
  const classMap = new Map(r.classes.map(s => [s.id, s]));
  const name = id => studentMap.get(id)?.name || '원생 정보 없음';
  const teacher = id => userMap.get(id)?.display_name || '담당 미지정';
  const className = id => classMap.get(id)?.class_name || '수업 미지정';
  const activeEnrollment = row => actualStudent(row) && (!row.start_date || date(row.start_date) <= today) && (!row.end_date || date(row.end_date) >= today) && !row.on_hold;
  const enrollments = r.enrollments.filter(activeEnrollment);
  const classEnrollments = group(enrollments, 'class_id');
  const studentEnrollments = group(enrollments, 'student_id');
  // Corrections replace earlier records; an original and its replacement are not counted twice.
  const replaced = new Set(r.attendance_records.map(a => a.supersedes_id).filter(Boolean));
  const attendance = r.attendance_records.filter(a => actualStudent(a) && !replaced.has(a.id) && date(a.session_date) <= today);
  const currentAttendance = attendance.filter(a => date(a.session_date).startsWith(month));
  const attendanceByStudent = group(currentAttendance, 'student_id'), allAttendanceByStudent = group(attendance, 'student_id');
  const validInvoices = r.invoices.filter(a => actualStudent(a) && !['void', 'refunded'].includes(a.status));
  // amount_total is before discounts. In the copied October data all 319 paid
  // invoices reconcile exactly after amount_discount; discounts are not debt.
  const invoices = validInvoices.map(i => { const lines=billingTools?projectBillingLines(i,billingTools):[];return { id: i.id, studentId: i.student_id, name: name(i.student_id), period: i.period, category: i.category, gross: num(i.amount_total), discount: num(i.amount_discount), total: Math.max(0, num(i.amount_total) - num(i.amount_discount)), paid: num(i.amount_paid), remaining: Math.max(0, num(i.amount_total) - num(i.amount_discount) - num(i.amount_paid)), status: i.status, due: date(i.due_date), billingName: billingName(lines), lines }; });
  const invoicesByStudent = group(invoices.filter(i => i.period === month), 'studentId');
  const lessons = r.lesson_reports.filter(actualStudent).filter(l => date(l.report_date) <= today);
  const lessonByStudent = group(lessons, 'student_id');
  const grades = r.student_grades.filter(actualStudent).filter(g => !g.no_exam && date(g.taken_on) <= today && g.score !== null && num(g.max_score) > 0);
  const gradeByStudent = group(grades, 'student_id');
  const consultations = r.student_consultations.filter(actualStudent).filter(c => date(c.consulted_at) <= today);
  const consultByStudent = group(consultations, 'student_id');
  const students = eligibleStudents.map(s => {
    const at = attendanceByStudent.get(s.id) || [], bills = invoicesByStudent.get(s.id) || [];
    const consults = consultByStudent.get(s.id) || [];
    return {
      id: s.id, name: s.name, grade: s.grade || '학년 미입력', school: s.school || '학교 미입력', status: s.status,
      enrolled: date(s.enrolled_at), withdrawn: date(s.withdrawn_at),
      classes: [...new Set((studentEnrollments.get(s.id) || []).map(e => e.class_id))],
      attendance: { total: at.length, present: at.filter(a => ['present', 'late', 'early_leave'].includes(a.status)).length, absent: at.filter(a => a.status === 'absent').length, late: at.filter(a => a.status === 'late').length, makeup: at.filter(a => a.status === 'makeup').length },
      // 조회 월을 고르는 화면(성적관리·수업보고서 원생 카드)용 — 최근 6개월 달별 기록·결석. 기록이 있는 달만(전체 출결 표를 읽으므로 없는 달 = 0건).
      attendanceMonths: Object.fromEntries(lastSix.map(m => { const rows = (allAttendanceByStudent.get(s.id) || []).filter(a => date(a.session_date).startsWith(m)); return [m, { total: rows.length, absent: rows.filter(a => a.status === 'absent').length }]; }).filter(([, v]) => v.total)),
      billed: sum(bills, 'total'), paid: sum(bills, 'paid'), remaining: sum(bills, 'remaining'),
      followups: consults.filter(c => c.follow_up_date && date(c.follow_up_date) <= today && !c.follow_up_done).length,
      lessons: recent(lessonByStudent.get(s.id) || [], 'report_date', 3).map(l => ({ date: date(l.report_date), subject: l.subject, progress: l.progress, teacher: l.teacher_name, read: Boolean(l.classnote_read_at) })),
      grades: recent(gradeByStudent.get(s.id) || [], 'taken_on', 6).map(g => ({ date: date(g.taken_on), exam: g.exam_name, subject: g.subject, score: num(g.score), max: num(g.max_score) })),
      consultations: recent(consults, 'consulted_at', 3).map(c => ({ date: date(c.consulted_at), category: c.category, summary: c.summary, followup: c.follow_up_action, due: date(c.follow_up_date), done: c.follow_up_done })),
      positive: r.student_positive_signals.filter(p=>p.student_id===s.id&&!p.cancelled_at&&date(p.occurred_on).startsWith(month)).length,
      progress: recent(r.progress_entries.filter(p=>p.student_id===s.id&&date(p.entry_date)<=today),'entry_date',3).map(p=>({date:date(p.entry_date),content:p.raw_progress})),
      onboarding: r.student_onboarding_checks.filter(p=>p.student_id===s.id).map(p=>({item:p.item_key,date:date(p.done_on)})),
    };
  });
  const schedules = r.class_schedules.filter(s => (!s.valid_from || date(s.valid_from) <= today) && (!s.valid_to || date(s.valid_to) >= today));
  const classes = r.classes.filter(c => c.is_active && !c.is_makeup_pool).map(c => {
    const roster = [...new Set((classEnrollments.get(c.id) || []).map(e => e.student_id))];
    const room = roomMap.get(c.classroom_id);
    const at = currentAttendance.filter(a => a.class_id === c.id);
    return { id: c.id, name: c.class_name, subject: c.subject, teacher: teacher(c.teacher_id), teacherId: c.teacher_id, room: room?.name || '강의실 미지정', capacity: num(room?.capacity) || null, students: roster, absent: at.filter(a => a.status === 'absent').length, attendance: at.length, special: c.is_special,
      schedules: schedules.filter(s => s.class_id === c.id).map(s => ({ day: ['sun','mon','tue','wed','thu','fri','sat'].indexOf(s.day_of_week), start: String(s.start_time || '').slice(0, 5), end: String(s.end_time || '').slice(0, 5), teacher: teacher(s.teacher_id || c.teacher_id), room: roomMap.get(s.classroom_id || c.classroom_id)?.name || '강의실 미지정' })) };
  });
  const admissions = r.enrollment_consultations.filter(c => !c.student_id || studentIds.has(c.student_id)).map(c => ({ id: c.id, name: c.prospect_name || '이름 미입력', grade: c.prospect_grade, school: c.prospect_school, outcome: c.outcome, date: date(c.received_date || c.consultation_date || c.consulted_at || c.created_at), scheduled: date(c.consultation_date), followup: date(c.follow_up_date), note: c.follow_up_content, reason: c.non_registration_reason, subject: c.subject, teacher: teacher(c.consultant_id), channel: c.consultation_path || '미입력' }));
  const channel = value => /소개|추천|친구|동생|재원/.test(value) ? '소개·재원 연결' : /설명회|감사제/.test(value) ? '설명회' : /인터넷|검색|블로그|네이버|홈페이지|당근/.test(value) ? '온라인' : /간판|전단|광고|현수막/.test(value) ? '지역 광고' : value === '미입력' ? '미입력' : '기타';
  // 유입 경로 범주는 모든 달이 같은 묶음을 쓴다(이번 달 admissionChannels와 다른 달 화면 묶음이 갈리지 않게).
  admissions.forEach(a => { a.channelGroup = channel(a.channel); });
  const history = r.student_history_monthly.filter(h => h.source === 'aywa' && date(h.month).slice(0, 7) >= start && date(h.month).slice(0, 7) <= month).map(h => ({ month: date(h.month).slice(0, 7), ...h.data })).sort((a, b) => a.month.localeCompare(b.month));
  const trend = months.map(m => {
    const bills = invoices.filter(i => i.period === m), at = attendance.filter(a => date(a.session_date).startsWith(m));
    const leads = admissions.filter(a => a.date.startsWith(m) && a.date <= today), reports = lessons.filter(l => date(l.report_date).startsWith(m));
    return { month: m, history: history.find(h => h.month === m) || null,
      billed: sum(bills, 'total'), paid: sum(bills, 'paid'), remaining: sum(bills, 'remaining'), payingStudents: new Set(bills.filter(i => i.category === 'tuition').map(i => i.studentId)).size, invoices: bills.length,
      expenses: sum(r.expenses.filter(e => date(e.expense_date).startsWith(m) && date(e.expense_date) <= today), 'amount'),
      attendance: at.length, absent: at.filter(a => a.status === 'absent').length, present: at.filter(a => ['present', 'late', 'early_leave'].includes(a.status)).length,
      inquiries: leads.length, registered: leads.filter(a => a.outcome === 'enrolled').length,
      reports: reports.length, sent: reports.filter(l => l.classnote_status === 'success').length, read: reports.filter(l => l.classnote_status === 'success' && l.classnote_read_at).length,
      progressEntries:r.progress_entries.filter(p=>date(p.entry_date).startsWith(m)&&date(p.entry_date)<=today).length,
      videoAssignments:r.student_homework_videos.filter(v=>date(v.posted_at).startsWith(m)&&date(v.posted_at)<=today).length,
      positiveSignals:r.student_positive_signals.filter(p=>!p.cancelled_at&&date(p.occurred_on).startsWith(m)&&date(p.occurred_on)<=today).length,
    };
  });
  const tasks = r.staff_tasks.map(t => ({ id: t.id, title: t.title, detail: t.detail, kind: t.kind, status: t.status, opened: date(t.opened_at), due: date(t.due_at), closed: date(t.closed_at), owners: r.staff_task_assignees.filter(a => a.task_id === t.id).map(a => teacher(a.user_id)) }));
  const activeUsers = r.users.filter(u => u.status === 'active' && u.system_role !== 'super_admin');
  const staff = activeUsers.map(u => ({ id: u.id, name: u.display_name, title: u.job_title || '직원', department: u.department || '부서 미입력', hired: date(u.hire_date), subjects: u.subjects || [], classes: classes.filter(c => c.teacherId === u.id).map(c => c.id), tasks: tasks.filter(t => t.status === 'open' && r.staff_task_assignees.some(a => a.task_id === t.id && a.user_id === u.id)).length,
    workDays:r.staff_attendance_days.filter(a=>a.user_id===u.id&&date(a.work_date).startsWith(month)&&date(a.work_date)<=today).length,
    contracts:r.staff_contracts.filter(c=>c.user_id===u.id&&(!c.start_date||date(c.start_date)<=today)&&(!c.end_date||date(c.end_date)>=today)).map(c=>({start:date(c.start_date),end:date(c.end_date),kind:c.kind})),
  }));
  const reportsThisMonth = lessons.filter(l => date(l.report_date).startsWith(month));
  const messages = recent(r.classnote_parent_messages.filter(actualStudent), 'posted_at', 80).map(m => ({ id: m.id, studentId: m.student_id, name: name(m.student_id), date: date(m.posted_at), category: m.category, content: m.content, detail: m.detail, replies:r.classnote_parent_replies.filter(p=>p.message_id===m.id&&!p.deleted_at).map(p=>({body:p.body,date:date(p.posted_at||p.created_at),author:p.author_label,status:p.status})) }));
  const vehicles = r.shuttle_vehicles.filter(v => !v.archived).map(v => ({ id: v.id, name: v.name, driver: v.driver_name }));
  const runs = r.shuttle_runs.map(run => ({ id: run.id, vehicleId: run.vehicle_id, season: run.season, direction: run.direction, label: run.label || `${run.run_no}회차`, number: run.run_no,
    stops: r.shuttle_run_stops.filter(s => s.run_id === run.id).sort((a, b) => a.sort_order - b.sort_order).map(s => ({ id: s.id, name: r.shuttle_stops.find(stop => stop.id === s.stop_id)?.name || (s.kind === 'academy' ? '학원' : '승하차 지점'), time: String(s.at_time || '').slice(0, 5), riders: r.shuttle_riders.filter(a => a.run_stop_id === s.id && actualStudent(a)).map(a => ({ studentId: a.student_id, name: name(a.student_id), days: a.weekdays, direction: a.io_kind })) })) }));
  const boardings = r.shuttle_boardings.filter(actualStudent).map(b => ({ date: date(b.boarded_on), studentId: b.student_id, name: name(b.student_id), runId: b.run_id, status: b.status, stop: b.stop_label, vehicle: b.vehicle_label }));
  const approvals = r.approval_documents.map(a => ({ id: a.id, title: a.title, number: a.doc_no, form: a.form_type, drafter: teacher(a.drafter_id), status: a.status, date: date(a.submitted_at), completed: date(a.completed_at), note: a.outcome_note, steps: r.approval_steps.filter(s => s.document_id === a.id).sort((a,b)=>a.step_no-b.step_no).map(s=>({ name: teacher(s.approver_id), decision: s.decision, date: date(s.decided_at), comment: s.comment })) }));
  const textbooks = r.textbook_orders.filter(t => !t.student_id || actualStudent(t)).map(t => ({ id: t.id, name: t.book_name, studentId: t.student_id, student: name(t.student_id), teacher: t.teacher_name, status: t.status, price: num(t.price), date: date(t.request_date), ordered: date(t.ordered_at), delivered: date(t.delivered_at) }));
  const calendar = r.calendar_events.filter(e => date(e.start_date) >= `${start}-01` && date(e.start_date) <= `${Number(month.slice(0,4))+1}-12-31`).map(e => ({ id: e.id, title: e.title, date: date(e.start_date), end: date(e.end_date), start: String(e.start_time || '').slice(0,5), finish: String(e.end_time || '').slice(0,5) }));
  return {
    meta: { tenant: info.tenant.name, asOf: today, month, importedAt: info.importedAt, tables: info.tables.map(t=>({ name:t.table, count:t.rows })), rows: info.tables.reduce((n,t)=>n+t.rows,0), source: 'local-docker-copy', readOnly: true },
    students, classes, staff, invoices, trend, months: lastSix,
    daily: r.student_daily_stats.map(d => ({ date: date(d.stat_date), enrolled: d.data.enrolled, onHold: d.data.onHold })).sort((a,b)=>a.date.localeCompare(b.date)),
    admissions: admissions.filter(a => a.date >= `${start}-01` && a.date <= today), admissionChannels: breakdown(admissions.filter(a=>a.date.startsWith(month) && a.date<=today), a=>channel(a.channel)),
    attendance: { statuses: breakdown(currentAttendance, 'status'), days: [...group(currentAttendance, a => date(a.session_date))].map(([day, rows]) => ({ date: day, total: rows.length, absent: rows.filter(a=>a.status==='absent').length })).sort((a,b)=>a.date.localeCompare(b.date)) },
    learning: { exams: [...group(grades, g=>`${g.subject}|${g.exam_name}|${date(g.taken_on).slice(0,7)}`)].map(([,rows]) => ({ subject:rows[0].subject, name:rows[0].exam_name, month:date(rows[0].taken_on).slice(0,7), count:rows.length, students:new Set(rows.map(g=>g.student_id)).size, average: rows.reduce((n,g)=>n+num(g.score)/num(g.max_score)*100,0)/rows.length })), gradesCount:grades.length, students:new Set(grades.map(g=>g.student_id)).size },
    finance: { expenses: r.expenses.filter(e=>date(e.expense_date)>=`${start}-01` && date(e.expense_date)<=today).map(e=>({title:e.title,category:e.category,amount:num(e.amount),date:date(e.expense_date)})), payrollCount: r.payroll_records.length,
      payslips:r.payslips.map(p=>({id:p.id,userId:p.user_id,name:teacher(p.user_id),period:p.period,status:p.status,issued:date(p.issued_at),net:p.status==='issued'?num(p.print_payload?.amounts?.netPay):null,gross:p.status==='issued'?num(p.print_payload?.amounts?.grossPay):null})),
    },
    messages, communication: { reports: reportsThisMonth.length, sent: reportsThisMonth.filter(l=>l.classnote_status==='success').length, read: reportsThisMonth.filter(l=>l.classnote_status==='success' && l.classnote_read_at).length, failed: reportsThisMonth.filter(l=>l.classnote_status==='failed').length, replies:r.classnote_parent_replies.filter(x=>date(x.posted_at).startsWith(month)).length },
    tasks, approvals, vehicles, runs, boardings, checkins: r.attendance_checkins.filter(c=>date(c.checkin_date)===today).length,
    textbooks, assets: breakdown(r.inventory_assets,'status'), assetCount:r.inventory_assets.length, supplies:r.inventory_supplies.map(s=>({name:s.name,qty:num(s.qty),location:s.location,date:date(s.checked_on)})), documents:r.academy_documents.map(d=>({id:d.id,title:d.title,category:d.category,description:d.description,body:d.kind==='note'?d.body:null,updated:date(d.updated_at),hasFile:Boolean(d.file_path),restricted:d.restricted})),
    calendar, makeup:r.makeup_reservations.filter(actualStudent).map(m=>({id:m.id,name:name(m.student_id),className:className(m.class_id),date:date(m.makeup_date),absence:date(m.absence_date),status:m.status,start:String(m.slot_start||'').slice(0,5)})),
    legacyHistory:r.student_history_monthly.filter(h=>h.source==='makeedu').map(h=>({month:date(h.month).slice(0,7),...h.data})).sort((a,b)=>a.month.localeCompare(b.month)),
  };
}
