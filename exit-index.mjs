// Indexes over the exit source (INSIGHT-EXITS.md): who left when (bulk clean-ups re-timed from billing/attendance),
// which classes and teachers they left, and 2.0's own churn judge (퇴원관리 '담당강사' = 강사평가 퇴원율) built from
// the same rows and the same functions (v2-bridge.mjs). Pure over the loaded rows; nothing here reads the database.
import { monthlyBilling } from './exit-billing.mjs';

const DAY = 86_400_000;
export const shift = (ymd, days) => new Date(Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const monthOf = d => (d ? String(d).slice(0, 7) : null);
export const addMonths = (m, n) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
export const monthEnd = m => shift(`${addMonths(m, 1)}-01`, -1);
export const ATTENDED = new Set(['present', 'late', 'early_leave', 'makeup']);
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (k) (m.get(k) ?? m.set(k, []).get(k)).push(r); } return m; };
const LEGACY_SUBJECTS = { math: '수학', english: '영어' };
// 2.0 churn-source.ts toTransitions: effective date, else the KST date of the audit row.
const kst = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const toTransitions = rows => rows.flatMap(t => { const date = t.effective_date?.slice(0, 10) || (t.created_at ? kst(t.created_at) : null); return t.teacher_id && date ? [{ class_id: t.class_id, target_label: t.target_label, teacher_id: t.teacher_id, previous_teacher_id: t.previous_teacher_id, date }] : []; });
// 2.0 siblings.ts siblingBasis over SQL phone-key hashes (the number itself never left SQL).
const personName = n => (n ?? '').toLowerCase().replace(/\s+/g, '');
const childKey = n => personName(n).replace(/^(.*[가-힣])[a-z]{1,2}$/, '$1');
export function siblingBasis(me, other) {
  if (me.id === other.id) return null;
  const mine = childKey(me.name); if (mine && mine === childKey(other.name)) return null;
  if (me.phoneKey && me.phoneKey === other.phoneKey) return 'phone';
  const na = personName(me.parent_name);
  if (na.length >= 2 && na === personName(other.parent_name)) return me.phoneKey && other.phoneKey ? 'conflict' : 'name';
  return null;
}

export function buildExitIndex(src, v2, { asOf }) {
  const thisMonth = asOf.slice(0, 7);
  const studentById = new Map(src.students.map(s => [s.id, s]));
  const real = id => { const s = studentById.get(id); return !!s && !s.is_test && !v2.isMergedStudent(s.notes); };
  const userById = new Map(src.users.map(u => [u.id, u])), classById = new Map(src.classes.map(c => [c.id, c]));
  const labels = { ...LEGACY_SUBJECTS, ...Object.fromEntries((src.subjects || []).filter(s => s.key && s.label).map(s => [s.key, s.label])) };
  const subjectLabel = k => labels[k] || (k ? '기타 과목' : '과목 미지정');
  const regular = c => !!c && !c.is_makeup_pool && !v2.isSpecialLecture({ isSpecial: c.is_special, className: c.class_name });
  const enrollmentsBy = group(src.enrollments, 'student_id');
  const attendanceBy = group(src.attendance.filter(a => a.d <= asOf).sort((a, b) => a.d.localeCompare(b.d)), 'student_id');
  const lastAttended = new Map([...attendanceBy].map(([sid, rows]) => [sid, rows.filter(a => ATTENDED.has(a.status)).at(-1)?.d || null]));
  const monthly = monthlyBilling(src.invoices, { eligible: id => !!studentById.get(id) && !studentById.get(id).is_test, terms: src.terms, classById, isSpecialLecture: v2.isSpecialLecture });
  const lastBilled = new Map();
  for (const [period, m] of [...monthly].sort(([a], [b]) => a.localeCompare(b))) for (const [sid, s] of m) if (s.total > 0 && period <= thisMonth) lastBilled.set(sid, period);
  const invoiceById = new Map(src.invoices.map(i => [i.id, i])), sessions = new Map();
  for (const t of src.terms) { const i = invoiceById.get(t.invoice_id); if (i && t.planned != null) { const k = `${i.student_id}|${i.period}`; sessions.set(k, (sessions.get(k) || 0) + t.planned); } }
  const phoneKey = new Map(src.phones.map(p => [p.id, p.phone_key]));
  const people = src.students.filter(s => real(s.id)).map(s => ({ id: s.id, name: s.name, parent_name: s.parent_name, phoneKey: phoneKey.get(s.id) || null }));
  const linkOf = new Map(src.links.map(l => [[l.student_a, l.student_b].sort().join('|'), l.linked]));
  const owner = v2.buildHomeroomOwner(src.classes, toTransitions(src.transitions));

  /** Regular subjects a student was enrolled in during a month (not on hold, no special/makeup classes). */
  function subjectsOf(sid, month) {
    const from = `${month}-01`, to = monthEnd(month), out = new Set();
    for (const e of enrollmentsBy.get(sid) || []) { const c = classById.get(e.class_id); if (regular(c) && !e.on_hold && e.start_date && e.start_date <= to && (!e.end_date || e.end_date >= from)) out.add(c.subject); }
    return out;
  }
  /** When a withdrawn student left. A bulk clean-up (2.0 isCleanupExit) is re-timed: the month after the last billing/attendance, else the last enrolment end. */
  function exitOf(sid) {
    const s = studentById.get(sid); if (!s) return null;
    if (s.status !== 'withdrawn') return { kind: s.status === 'on_hold' ? 'on_hold' : s.status === 'enrolled' ? 'enrolled' : 'other', status: s.status, date: null, month: null, estimated: false };
    const meta = s.withdrawal_metadata, rows = enrollmentsBy.get(sid) || [];
    if (!v2.isCleanupExit(meta)) return { kind: 'withdrawn', status: s.status, date: s.withdrawn_at, month: monthOf(s.withdrawn_at), estimated: false };
    const lastEnded = rows.map(e => e.end_date).filter(Boolean).sort().at(-1) || null;
    const bookkeepingOnly = v2.isBookkeepingOnlyExit({ withdrawalMetadata: meta, hasEnrollmentHistory: Boolean(lastEnded) });
    const lastBill = lastBilled.get(sid) || null, lastAtt = lastAttended.get(sid) || null;
    const active = [lastBill, monthOf(lastAtt)].filter(Boolean).sort().at(-1) || null;
    const month = active ? addMonths(active, 1) : lastEnded ? monthOf(lastEnded) : null;
    return { kind: 'cleanup', status: s.status, date: null, month, estimated: true, ledgerDate: s.withdrawn_at, v2BookkeepingOnly: bookkeepingOnly,
      basis: { rule: active ? 'activity' : lastEnded ? 'enrollment_end' : 'none', lastBilled: lastBill, lastAttended: lastAtt, lastEnded } };
  }
  /** 2.0 siblings (auto rule + saved links), real students only. */
  function siblingsOf(sid) {
    const me = people.find(p => p.id === sid); if (!me) return [];
    const auto = people.filter(o => ['phone', 'name'].includes(siblingBasis(me, o))).map(o => o.id);
    const out = new Set(auto.filter(id => linkOf.get([sid, id].sort().join('|')) !== false));
    for (const [k, linked] of linkOf) if (linked && k.split('|').includes(sid)) out.add(k.split('|').find(x => x !== sid));
    return [...out];
  }

  // 2.0 loadExitTeacherJudge, same rows and functions; built on first use (a few seconds).
  let judge = null;
  function teacherJudge() {
    if (judge) return judge;
    const from = `${addMonths(thisMonth, -17)}-01`, end = monthEnd(thisMonth);
    const enrollments = src.enrollments.filter(e => real(e.student_id) && e.start_date && e.start_date <= end && (!e.end_date || e.end_date >= from));
    const schedules = src.schedules.filter(s => s.valid_from && s.valid_from <= end && (!s.valid_to || s.valid_to >= from));
    const futureEnrollments = src.enrollments.filter(e => real(e.student_id) && e.start_date > end && e.start_date <= shift(end, 31));
    const studentReasons = src.students.filter(s => s.withdrawal_metadata).map(s => ({ id: s.id, reason: s.withdrawal_metadata?.reason ?? null, withdrawn_at: s.withdrawn_at }));
    const options = v2.resolveEvaluationConfig(src.evaluationConfig ?? v2.DEFAULT_EVALUATION_CONFIG).metrics.churn.churn;
    const tracking = v2.buildStudentTracking({ from, end, classes: src.classes, schedules, enrollments, owner });
    const churn = v2.buildChurnModel({ source: tracking.churnSource, classes: src.classes, options, futureEnrollments, studentReasons });
    const months = new Map(), view = { get(m) { if (m > thisMonth) return undefined; if (!months.has(m)) { const w0 = v2.withdrawalMonthWindow(m, asOf), w = { start: w0.from, end: w0.to }, eligible = churn.eligibleSubjects(w); months.set(m, { eligible, detail: new Map([...eligible.keys()].map(id => [id, churn.exits(id, w)])) }); } return months.get(m); } };
    const refs = new Map(src.classes.map(c => [c.id, { closedAt: c.closed_at, regular: regular(c), subject: c.subject }])), classOf = id => refs.get(id);
    const ended = new Map();
    for (const e of enrollments) { const subject = classOf(e.class_id)?.subject; if (!e.end_date || !subject) continue; const k = `${subject}|${e.student_id}`; (ended.get(k) ?? ended.set(k, []).get(k)).push({ classId: e.class_id, startDate: e.start_date, endDate: e.end_date, reason: e.withdrawal_reason ?? null }); }
    judge = {
      classOf,
      endedOf: (sid, subject, date) => { const rows = v2.endedWithExit(ended.get(`${subject}|${sid}`) ?? [], date, classOf, v2.OVERLAY_LOOKBACK_DAYS); return { endMonth: v2.churnMonthOf(rows, date, classOf), rows }; },
      teachersOf: (sid, subject, month) => v2.churnTeachersOf(view, sid, subject, month),
    };
    return judge;
  }

  return { asOf, thisMonth, studentById, userById, classById, subjectLabel, regular, reasonLabel: k => v2.REASON_LABEL[k] || '미기재', detailLabel: k => v2.reasonDetailOf(k)?.label || '세부 미기재', real, enrollmentsBy, attendanceBy, lastAttended, lastBilled, monthly, owner,
    subjectsOf, sessionsOf: (sid, month) => sessions.get(`${sid}|${month}`) ?? null, exitOf, siblingsOf, teacherJudge,
    consultationsBy: group(src.consultations, 'student_id'), gradesBy: group(src.grades, 'student_id'), reportsBy: group(src.reports, 'student_id'), archivesBy: group(src.archives, 'student_id'),
    schedulesBy: group(src.schedules, 'class_id'), transitions: toTransitions(src.transitions), enrollmentsByClass: group(src.enrollments, 'class_id') };
}
