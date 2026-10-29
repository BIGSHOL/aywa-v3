// Per-student exit case file (INSIGHT-EXITS.md §사건 파일): every fact linked to the leaving student, each with its
// source row (table · id) and, where a workspace lists it, the exact record to open. `text` is for the local screen
// (contacts masked); `claude` is a digit-free statement for the cluster prompt; free text is name-masked separately.
import { scrub } from './domain-snapshot-core.mjs';
import { ATTENDED, addMonths, monthEnd, shift } from './exit-index.mjs';

const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
// Consultation exports start with a header (date · counsellor · '상담 내용:'); keep the body only.
const body = t => { const s = String(t ?? ''), i = s.indexOf('상담 내용:'); return i >= 0 ? s.slice(i + 6) : s; };
const clip = (t, n = 300) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const REPORT_STATUS = { draft: '작성 중', submitted: '제출', approved: '승인', applied: '처리 완료', rejected: '반려', cancelled: '취소' };
// Cause categories shared by code (recorded reason) and Jev (when the record does not say) — 2.0 reason keys underneath.
export const CAUSES = Object.freeze({
  teacher_change: '담당 교체·강사 퇴사', lesson: '수업 방식·관리 불만', grades: '성적', student_state: '원생 상태·의욕', method: '공부 방법 변경',
  competitor: '타 학원 이동', schedule: '시간·일정·거리', money: '경제적 이유', career: '진로·진학·졸업', family: '가족·친구 동반',
  relocation: '이사', illness: '질병', advised: '권고퇴원', unknown: '기록으로 알 수 없음',
});
const TEACHER_DETAIL = new Set(['teacher_changes', 'teacher_reassigned', 'teacher_left']);
export function causeOfReason(key, detail) {
  return { dissatisfaction: TEACHER_DETAIL.has(detail) ? 'teacher_change' : 'lesson', grades: 'grades', motivation: 'student_state', method: 'method', competitor: 'competitor',
    schedule: 'schedule', financial: 'money', career: 'career', graduated: 'career', peers: 'family', relocation: 'relocation', illness: 'illness', advised: 'advised' }[key] || 'unknown';
}

/** Names → role words, contacts → masked, digits kept (Jev) or replaced (Claude). Known names come from the copy's own rows. */
export function makeMasker(src) {
  const names = new Map();
  const put = (n, role) => { const v = String(n ?? '').trim(); if (v.length >= 2 && !names.has(v)) names.set(v, role); };
  // Full name, the name without the namesake suffix (김준우A → 김준우) and the given name (준우) — text writes "준우가".
  for (const s of src.students) { const bare = String(s.name ?? '').replace(/[A-Za-z]+$/, ''); put(s.name, '원생'); put(bare, '원생'); put(bare.slice(1), '원생'); put(s.english_name, '원생'); put(s.nickname, '원생'); put(s.parent_name, '보호자'); }
  for (const u of src.users) { put(u.display_name, '선생님'); put(u.english_name, '선생님'); }
  const list = [...names.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = list.length ? new RegExp(list.join('|'), 'g') : null;
  const mask = (text, { digits = true, limit = 300 } = {}) => {
    let t = scrub(String(text ?? '')); if (re) t = t.replace(re, m => names.get(m));
    // Unknown names before a title: a common surname + one or two syllables (not '다른 선생님', '남자 원생').
    t = t.replace(/(?<![가-힣])[김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유심노하곽성차주우구민진엄채원천방공현함변염여추도소석설마길연위표명기왕금옥육인맹제모탁국은편용][가-힣]{1,2}(?=\s?(?:선생님|쌤|어머님|어머니|아버님|아버지|원장님))/g, '○○');
    if (!digits) t = t.replace(/\d+/g, '○');
    return clip(t, limit);
  };
  return mask;
}

/** `at` (YYYY-MM) = the month the student stopped being billed, used as the reference when the record has no exit date (휴원·재원). */
export function buildCaseFile(ix, v2, sid, { mask, at = null }) {
  const s = ix.studentById.get(sid), ex = ix.exitOf(sid); if (!s || !ex) return null;
  const facts = [], push = f => { facts.push({ key: `${f.kind}:${f.source?.id || f.kind}:${facts.length}`, ...f }); };
  const name = id => ix.userById.get(id)?.display_name || '담당 미지정', inactive = id => !!id && ix.userById.get(id)?.status !== 'active';
  const month = ex.month || at, ref = ex.date || (month ? shift(`${month}-01`, -1) : null);
  const meta = s.withdrawal_metadata || {}, reasonKey = v2.normalizeReason(meta.reason || null), detailKey = v2.detailFor(meta.reason, meta.detail);
  // 1 timing
  if (ex.kind === 'withdrawn') push({ kind: 'timing', label: '퇴원일', text: `퇴원일 ${ex.date}`, date: ex.date, source: { table: 'students', id: sid }, open: { family: 'withdrawals', id: sid }, claude: '퇴원 기록이 있음' });
  else if (ex.kind === 'cleanup') {
    const b = ex.basis, basis = [b.lastBilled && `마지막 청구 ${b.lastBilled}`, b.lastAttended && `마지막 출석 ${b.lastAttended}`, b.rule === 'enrollment_end' && `마지막 수강 종료 ${b.lastEnded}(장부 날짜일 수 있음)`].filter(Boolean).join(' · ');
    push({ kind: 'timing', label: '이탈 시점(추정)', text: `${ex.month ? `${ex.month} 이탈로 추정` : '이탈 시점 미상'} · 일괄 정리(장부 퇴원일 ${ex.ledgerDate || '없음'})${basis ? ` · ${basis}` : ''}`, estimate: true, source: { table: 'students', id: sid }, open: { family: 'students', id: sid }, claude: '일괄 정리로 퇴원 처리되어 실제로 그만둔 때는 청구와 출석으로 추정함' });
    if (ex.v2BookkeepingOnly) push({ kind: 'timing', label: '퇴원 통계', text: '수업 기록이 없는 장부 정리라 퇴원 통계에서 빠짐 — 청구·출석 기록은 있음', source: { table: 'students', id: sid }, open: null });
  } else push({ kind: 'timing', label: '현재 상태', text: ex.kind === 'on_hold' ? '현재 휴원 · 뒤 달 청구 없음' : ex.kind === 'enrolled' ? '현재 재원 · 뒤 달 청구 없음' : '퇴원·휴원·재원이 아닌 상태', source: { table: 'students', id: sid }, open: { family: 'students', id: sid }, claude: ex.kind === 'on_hold' ? '현재 휴원 중' : ex.kind === 'enrolled' ? '현재 재원 중이지만 뒤 달 청구가 없음' : null });
  // 2 recorded reason (bulk clean-up memos are not shown — the same as 2.0)
  if (ex.kind === 'withdrawn' && (meta.reason || meta.memo)) {
    const label = v2.reasonDisplay(meta.reason) || '미기재', d = detailKey ? v2.reasonDetailOf(detailKey)?.label : null, c = meta.consultation || {};
    const talks = [c.adminCalledParent && '관리자 학부모 통화', c.teacherCalledParent && '담임 학부모 통화', c.talkedWithStudent && '원생 면담'].filter(Boolean);
    push({ kind: 'reason', label: '퇴원 사유', text: [label, d, meta.memo && `메모: ${clip(scrub(meta.memo), 300)}`, talks.length && `상담: ${talks.join(', ')}`].filter(Boolean).join(' · '), source: { table: 'students', id: sid }, open: { family: 'withdrawals', id: sid },
      claude: `기록된 퇴원 사유: ${label}${d ? ` · ${d}` : ''}`, free: meta.memo ? mask(meta.memo) : null });
  }
  // 3 classes at the exit + 2.0 churn teachers
  const rows = (ix.enrollmentsBy.get(sid) || []).map(e => ({ ...e, classId: e.class_id, startDate: e.start_date, endDate: e.end_date }));
  const j = ix.teacherJudge();
  let atExit = ex.kind === 'withdrawn' && ref ? v2.endedWithExit(rows.filter(r => r.endDate), ref, j.classOf, v2.OVERLAY_LOOKBACK_DAYS) : [];
  if (!atExit.length && ref) { const m = ref.slice(0, 7), from = `${m}-01`; atExit = rows.filter(r => ix.regular(ix.classById.get(r.classId)) && r.startDate && r.startDate <= ref && (!r.endDate || r.endDate >= from)); }
  const classes = [];
  for (const r of atExit) {
    const c = ix.classById.get(r.classId); if (!c) continue;
    const last = [r.endDate, ref].filter(Boolean).sort()[0] || ix.asOf, homeroom = ix.owner(c, last), subject = ix.subjectLabel(c.subject);
    const closed = c.closed_at && c.closed_at <= shift(last, 45) ? c.closed_at : null;
    const endReason = r.withdrawal_reason ? [v2.reasonDisplay(r.withdrawal_reason), v2.reasonDetailOf(r.withdrawal_detail)?.label, r.withdrawal_memo && clip(scrub(r.withdrawal_memo), 120)].filter(Boolean).join(' · ') : '';
    classes.push({ classId: c.id, subject: c.subject, homeroomId: homeroom, closedAt: closed, last });
    push({ kind: 'class', label: '그만둘 때 반', text: `${c.class_name}(${subject}) · ${r.startDate || '?'}~${r.endDate || '진행'} · 그날 담임 ${name(homeroom)}${inactive(homeroom) ? '(현재 재직 아님)' : ''}${closed ? ` · 반 폐강 ${closed}` : ''}${endReason ? ` · 종료 사유 ${endReason}` : ''}`,
      date: r.endDate, source: { table: 'enrollments', id: r.id }, open: c.is_active && !c.is_makeup_pool ? { family: 'classes', id: c.id } : null, refs: { classId: c.id, teacherId: homeroom },
      claude: `반 수강 · 그날 담임 선생님이 있음${inactive(homeroom) ? '(그 선생님은 현재 재직 아님)' : ''}${closed ? ' · 이 반은 폐강됨' : ''}`, ids: { classId: c.id, teacherId: homeroom } });
  }
  const churn = [];
  if (ex.kind === 'withdrawn' && ref) for (const subject of new Set(classes.map(c => c.subject))) {
    const { endMonth, rows: ended } = j.endedOf(sid, subject, ref); if (!ended.length) continue;
    const ids = j.teachersOf(sid, subject, endMonth); churn.push({ subject, teacherIds: ids, month: endMonth });
    push({ kind: 'churn', label: '퇴원율 담당', text: `${ix.subjectLabel(subject)} · ${endMonth} 퇴원율 · ${ids.length ? ids.map(name).join(', ') : '담당 미반영(퇴원율에 잡히지 않음)'}`, source: { table: 'enrollments', id: ended.at(-1).id }, open: null,
      claude: ids.length ? '퇴원율을 맡은 선생님이 정해짐' : '퇴원율 담당 선생님이 정해지지 않음', ids: { teacherIds: ids } });
  }
  // 4 hand-overs before the exit (homeroom changes from audit logs; period teachers starting in the window)
  const handovers = [];
  for (const c of classes) {
    const lo = shift(c.last, -120);
    for (const t of ix.transitions.filter(t => t.class_id === c.classId && t.date >= lo && t.date <= c.last)) {
      handovers.push({ classId: c.classId, date: t.date, from: t.previous_teacher_id, to: t.teacher_id, type: 'homeroom' });
      push({ kind: 'handover', label: '담임 변경', text: `${t.date} 담임 변경 ${t.previous_teacher_id ? `${name(t.previous_teacher_id)} → ` : ''}${name(t.teacher_id)}`, date: t.date, source: { table: 'audit_logs', id: `${c.classId}:${t.date}` }, open: null, claude: '퇴원 전에 이 반 담임이 바뀜', ids: { classId: c.classId, teacherId: t.teacher_id } });
    }
    // A period teacher (an account on the row) counts as a change only when the class's earlier rows already named teachers
    // and this person was not among them. Earlier rows that named nobody (before 7/3 most slots were blank, the import then
    // filled them) say nothing about a change, and a new class's first rows are not one. A free-text label never makes a new
    // person; it only names who was there before (an English name → that account, when it matches exactly one person).
    const all = (ix.schedulesBy.get(c.classId) || []).filter(x => x.valid_from), first = new Map();
    for (const x of all) if (x.teacher_id && (!first.has(x.teacher_id) || x.valid_from < first.get(x.teacher_id))) first.set(x.teacher_id, x.valid_from);
    const before = d => new Set(all.filter(x => x.valid_from < d).map(x => x.teacher_id || ix.teacherOfLabel(x.slot_teacher_label)).filter(Boolean));
    for (const [tid, from] of first) if (from > lo && from <= c.last && tid !== ix.owner(ix.classById.get(c.classId), lo) && before(from).size && !before(from).has(tid)) {
      handovers.push({ classId: c.classId, date: from, to: tid, type: 'period' });
      push({ kind: 'handover', label: '교시 담당 변경', text: `${from}부터 교시 담당 ${name(tid)}`, date: from, source: { table: 'class_schedules', id: all.find(x => x.teacher_id === tid && x.valid_from === from).id }, open: null, claude: '퇴원 전에 이 반 교시 담당 선생님이 새로 들어옴', ids: { classId: c.classId, teacherId: tid } });
    }
  }
  // 5 attendance, eight weeks before the exit
  let absenceUp = false;
  if (ref) {
    const at = (ix.attendanceBy.get(sid) || []).filter(a => a.d < ref && a.d >= shift(ref, -56));
    const weeks = Array.from({ length: 8 }, (_, i) => { const lo = shift(ref, -56 + i * 7), hi = shift(ref, -49 + i * 7), w = at.filter(a => a.d >= lo && a.d < hi); return { from: lo, attended: w.filter(a => ATTENDED.has(a.status)).length, absent: w.filter(a => a.status === 'absent').length }; });
    const early = weeks.slice(0, 4).reduce((n, w) => n + w.absent, 0), late = weeks.slice(4).reduce((n, w) => n + w.absent, 0), att = weeks.reduce((n, w) => n + w.attended, 0);
    absenceUp = late > early && late >= 2;
    push({ kind: 'attendance', label: '그만두기 전 8주 출결', text: at.length ? `출석 ${att}회 · 결석 ${early + late}회 (앞 4주 결석 ${early} → 뒤 4주 ${late})` : '이 기간 출결 기록 없음', weeks, source: { table: 'attendance_records', id: `${sid}:${shift(ref, -56)}~${ref}` }, open: null,
      claude: !at.length ? '그만두기 전 출결 기록이 없음' : absenceUp ? '그만두기 전 결석이 늘었음' : late || early ? '그만두기 전 결석이 있었지만 늘지는 않음' : '그만두기 전 결석 없음' });
  }
  // 6 student consultations (90 days) · 7 withdrawal reports (app + spreadsheet archive)
  for (const c of (ix.consultationsBy.get(sid) || []).filter(c => ref && c.d && c.d <= ref && c.d >= shift(ref, -90)).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 3))
    push({ kind: 'consultation', label: '그만두기 전 상담', text: `${c.d} ${v2.CONSULTATION_CATEGORY_LABEL[c.category] || '분류 없음'} 상담${c.summary ? ` · ${clip(scrub(body(c.summary)), 200)}` : ''}`, date: c.d, source: { table: 'student_consultations', id: c.id }, open: { family: 'consultations', id: c.id }, claude: `그만두기 전 상담 기록(${v2.CONSULTATION_CATEGORY_LABEL[c.category] || '분류 없음'})`, free: c.summary ? mask(body(c.summary)) : null });
  for (const r of ix.reportsBy.get(sid) || [])
    push({ kind: 'report', label: '퇴원보고서', text: `${REPORT_STATUS[r.status] || '상태 미상'} · ${[r.reason && v2.reasonDisplay(r.reason), r.detail && v2.reasonDetailOf(r.detail)?.label, r.opinion && `담임 의견: ${clip(scrub(r.opinion), 200)}`].filter(Boolean).join(' · ') || '본문 없음'}`, date: r.d, source: { table: 'withdrawal_reports', id: r.id }, open: { family: 'withdrawal-reports', id: r.id }, claude: '퇴원보고서가 있음', free: r.opinion ? mask(r.opinion) : null });
  for (const a of (ix.archivesBy.get(sid) || []).filter(a => !ref || !a.d || Math.abs(Date.parse(a.d) - Date.parse(ref)) <= 120 * 86_400_000))
    push({ kind: 'report', label: '퇴원보고서(시트 보관본)', text: [a.d, a.class_name, a.reason && `퇴원사유 ${clip(scrub(a.reason), 60)}`, a.detail && `상세 ${clip(scrub(a.detail), 200)}`, a.opinion && `담임 의견 ${clip(scrub(a.opinion), 200)}`, a.parent_talk && `학부모 상담 ${clip(scrub(a.parent_talk), 200)}`].filter(Boolean).join(' · '),
      date: a.d, source: { table: 'withdrawal_report_archives', id: a.id }, open: { family: 'withdrawal-reports', id: a.id }, claude: '퇴원보고서 시트에 사유가 적혀 있음', free: [a.reason, a.detail, a.opinion, a.parent_talk, a.student_talk].filter(Boolean).map(x => mask(x)).join(' / ').slice(0, 300) || null });
  // 8 siblings · 9 classmates leaving within two weeks
  const near = (other, days) => { const o = ix.exitOf(other); if (!o?.month || !['withdrawn', 'cleanup'].includes(o.kind)) return false; const od = o.date || shift(`${o.month}-01`, -1); return ref ? Math.abs(Date.parse(od) - Date.parse(ref)) <= days * 86_400_000 : false; };
  const siblings = ix.siblingsOf(sid), siblingsLeft = siblings.filter(o => near(o, 31));
  for (const o of siblings) push({ kind: 'sibling', label: '형제', text: `${ix.studentById.get(o)?.name || '형제'} · ${siblingsLeft.includes(o) ? '같은 시기 퇴원' : ix.exitOf(o)?.kind === 'withdrawn' ? `다른 시기 퇴원(${ix.exitOf(o).date})` : '계속 다님'}`, source: { table: 'students', id: o }, open: { family: 'students', id: o }, claude: siblingsLeft.includes(o) ? '형제도 같은 시기에 그만둠' : '형제가 있음', ids: { studentId: o } });
  const classmatesLeft = [];
  for (const c of classes) {
    const mates = [...new Set((ix.enrollmentsByClass.get(c.classId) || []).map(e => e.student_id))].filter(o => o !== sid && ix.real(o) && near(o, 14));
    if (!mates.length) continue; classmatesLeft.push(...mates);
    push({ kind: 'classmates', label: '같은 반 2주 안 퇴원', text: `${ix.classById.get(c.classId)?.class_name} · ${mates.map(o => ix.studentById.get(o)?.name).join(', ')} (${mates.length}명)`, source: { table: 'enrollments', id: c.classId }, open: null, claude: '같은 반 친구도 같은 시기에 그만둠', ids: { classId: c.classId, studentIds: mates } });
  }
  // 10 grades · 11 other subjects · 12 holds · 13 last billing
  const scored = (ix.gradesBy.get(sid) || []).filter(g => !g.no_exam && g.score != null && g.max > 0 && (!ref || g.d <= ref)).sort((a, b) => a.d.localeCompare(b.d)).slice(-4);
  if (scored.length) { const p = g => Math.round(g.score / g.max * 100), diff = p(scored.at(-1)) - p(scored[0]);
    push({ kind: 'grades', label: '성적 기록', text: scored.map(g => `${g.d} ${g.exam_name || ix.subjectLabel(g.subject)} ${g.score}/${g.max}`).join(' · '), source: { table: 'student_grades', id: scored.at(-1).id }, open: { family: 'exams', id: scored.at(-1).id }, claude: scored.length < 2 ? '성적 기록이 하나 있음' : diff <= -5 ? '성적 기록이 내려가는 흐름' : diff >= 5 ? '성적 기록이 올라가는 흐름' : '성적 기록 변화가 크지 않음' }); }
  const going = rows.filter(r => !r.endDate || r.endDate > (ref || ix.asOf)).filter(r => ix.regular(ix.classById.get(r.classId)) && !classes.some(c => c.classId === r.classId));
  if (ex.kind !== 'withdrawn' || going.length) push({ kind: 'continuing', label: '계속 수강', text: going.length ? going.map(r => `${ix.subjectLabel(ix.classById.get(r.classId)?.subject)} ${ix.classById.get(r.classId)?.class_name}${r.on_hold ? '(휴원)' : ''}`).join(', ') : '계속 수강 중인 반 없음', source: { table: 'enrollments', id: going[0]?.id || sid }, open: null, claude: going.length ? '다른 반 수강은 계속됨' : null });
  if (rows.some(r => r.on_hold)) push({ kind: 'hold', label: '휴원 기록', text: `휴원 표시된 수강 ${rows.filter(r => r.on_hold).length}건`, source: { table: 'enrollments', id: rows.find(r => r.on_hold).id }, open: null, claude: '휴원 기록이 있음' });
  const lb = ix.lastBilled.get(sid); if (lb) { const b = ix.monthly.get(lb).get(sid); push({ kind: 'billing', label: '마지막 청구', text: `${lb} ${won(b.total)}`, source: { table: 'invoices', id: b.invoiceIds.at(-1) }, open: { family: 'billing', id: b.invoiceIds.at(-1) }, claude: null }); }

  const cause = ex.kind === 'withdrawn' ? causeOfReason(reasonKey, detailKey) : 'unknown';
  return { studentId: sid, name: s.name, label: [s.school, s.grade].filter(Boolean).join(' '), grade: s.grade || null, exit: ex, ref, reasonKey, detailKey,
    cause: { code: cause, label: CAUSES[cause], origin: ex.kind === 'withdrawn' && reasonKey && reasonKey !== 'other' ? 'record' : 'none' },
    classes, churn, handovers, absenceUp, siblingsLeft, classmatesLeft: [...new Set(classmatesLeft)], facts,
    needsJev: ex.kind === 'withdrawn' };
}
export { addMonths, monthEnd };
