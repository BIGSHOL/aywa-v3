// Cause clusters over a cohort of case files (INSIGHT-EXITS.md §원인 묶음) — code only: which teacher left and whose class
// closed, hand-overs just before leaving, concentration on a teacher/class/reason/day/grade, siblings and classmates
// leaving together, moves and other academies, bulk clean-ups. Every count here is code; AI only words the chain.
import { shift } from './exit-index.mjs';

const uniq = a => [...new Set(a)];
const fact = (key, text, claude, extra = {}) => ({ key, text, claude, ...extra });
const LEFT = new Set(['withdrawn', 'cleanup']);

export function buildClusters(cases, ix, { amountOf = () => 0 } = {}) {
  const name = id => ix.userById.get(id)?.display_name || '담당 미지정', inactive = id => !!id && ix.userById.get(id)?.status !== 'active';
  const cname = id => ix.classById.get(id)?.class_name || '반 정보 없음';
  const out = [], left = cases.filter(c => LEFT.has(c.exit.kind)), real = cases.filter(c => c.exit.kind === 'withdrawn');
  const add = (kind, key, label, members, facts, extra = {}) => {
    const ids = uniq(members.map(c => c.studentId));
    if (ids.length) out.push({ id: `${kind}:${key}`, kind, label, members: ids, amount: ids.reduce((n, id) => n + amountOf(id), 0), facts, teacherIds: uniq(extra.teacherIds || []), classIds: uniq(extra.classIds || []) });
  };
  const exitDay = c => c.exit.date || c.ref;

  // 1 a teacher no longer working → the class closed → its students left
  const byTeacher = new Map();
  for (const c of left) for (const k of c.classes) if (k.closedAt && inactive(k.homeroomId)) (byTeacher.get(k.homeroomId) ?? byTeacher.set(k.homeroomId, new Map()).get(k.homeroomId)).set(k.classId, k.closedAt);
  for (const [tid, closedClasses] of byTeacher) {
    const members = left.filter(c => c.classes.some(k => closedClasses.has(k.classId))), facts = [];
    const lastSlot = [...ix.schedulesBy.values()].flat().filter(s => s.teacher_id === tid).map(s => s.valid_to || s.valid_from).filter(Boolean).sort().at(-1);
    facts.push(fact(`teacher:${tid}`, `${name(tid)} 선생님 현재 재직 아님${lastSlot ? ` · 최종 수업 배치 ${lastSlot}` : ''}`, '이 선생님은 현재 재직 중이 아님', { source: { table: 'users', id: tid }, open: { family: 'staff', id: tid }, ids: { teacherId: tid } }));
    const allRoster = new Set(), allGone = new Set();
    for (const [cid, closed] of closedClasses) {
      const roster = uniq((ix.enrollmentsByClass.get(cid) || []).filter(e => ix.real(e.student_id) && e.start_date && e.start_date <= closed && (!e.end_date || e.end_date >= shift(closed, -30))).map(e => e.student_id));
      const gone = roster.filter(sid => { const e = ix.exitOf(sid); if (!e?.month || !LEFT.has(e.kind)) return false; const d = e.date || `${e.month}-01`; return d >= shift(closed, -31) && d <= shift(closed, 46); });
      roster.forEach(s => allRoster.add(s)); gone.forEach(s => allGone.add(s));
      const stayed = roster.filter(sid => !gone.includes(sid) && (ix.enrollmentsBy.get(sid) || []).some(e => e.class_id !== cid && ix.classById.get(e.class_id)?.subject === ix.classById.get(cid)?.subject && (!e.end_date || e.end_date > closed)));
      facts.push(fact(`closed:${cid}`, `${cname(cid)} 반 폐강 ${closed} · 폐강 무렵 수강 ${roster.length}명 중 ${gone.length}명 퇴원${stayed.length ? ` · ${stayed.length}명은 같은 과목 다른 반으로` : ''}`,
        `이 선생님의 반이 폐강되었고 그 무렵 그 반 원생들이 퇴원함${stayed.length ? ' · 같은 과목 다른 반으로 옮긴 원생도 있음' : ''}`, { source: { table: 'classes', id: cid }, open: null, counts: { roster: roster.length, left: gone.length, moved: stayed.length }, ids: { classId: cid } }));
    }
    // Rosters of several closed classes can overlap (the same students in two classes) — the per-class counts must not be added up.
    const reasonOf = s => cases.find(c => c.studentId === s)?.reasonKey ?? ix.studentById.get(s)?.withdrawal_metadata?.reason; // case files carry 2.0's normalised key
    const graduated = [...allGone].filter(s => ['graduated', 'career'].includes(reasonOf(s))).length;
    if (closedClasses.size > 1 || graduated) facts.push(fact(`closed-all:${tid}`, `${closedClasses.size > 1 ? `폐강 반 ${closedClasses.size}개 합쳐 서로 다른 원생 ${allRoster.size}명 중 ${allGone.size}명 퇴원(반별 숫자는 겹치는 원생을 두 번 셈)` : `폐강 무렵 퇴원 ${allGone.size}명`}${graduated ? ` · 그중 진로·졸업 사유 ${graduated}명` : ''}`,
      `${closedClasses.size > 1 ? '폐강된 반들은 수강생이 겹침' : '폐강된 반의 퇴원 기록이 있음'}${graduated ? ' · 퇴원한 원생 가운데 진로나 졸업이 사유인 원생이 있음' : ''}`, { counts: { roster: allRoster.size, left: allGone.size, graduated } }));
    add('teacher_left', tid, `${name(tid)} 선생님 퇴직 → 반 폐강 → 퇴원`, members, facts, { teacherIds: [tid], classIds: [...closedClasses.keys()] });
  }
  // 2 hand-over just before leaving (≤60 days) or a recorded teacher-change reason, per subject. A student joins a subject's
  // group only for a hand-over in a class of that subject, or for a teacher-change reason with a class of that subject at the
  // exit (the reason names no subject) — never because a hand-over in another subject happened to the same student.
  const recent = c => c.handovers.filter(hv => exitDay(c) && Date.parse(exitDay(c)) - Date.parse(hv.date) <= 60 * 86_400_000);
  const byReason = c => ['teacher_changes', 'teacher_reassigned', 'teacher_left'].includes(c.detailKey), subjectOf = id => ix.classById.get(id)?.subject;
  const handedIn = (c, subject) => recent(c).some(hv => subjectOf(hv.classId) === subject) || (byReason(c) && c.classes.some(k => k.subject === subject));
  for (const subject of uniq(left.flatMap(c => [...recent(c).map(hv => subjectOf(hv.classId)), ...(byReason(c) ? c.classes.map(k => k.subject) : [])]).filter(Boolean))) {
    const members = left.filter(c => handedIn(c, subject)), changes = uniq(members.flatMap(c => recent(c).filter(hv => subjectOf(hv.classId) === subject).map(hv => `${hv.classId}|${hv.date}|${hv.to}`)));
    const facts = changes.map(k => { const [cid, date, to] = k.split('|'); return fact(`handover:${k}`, `${cname(cid)} · ${date} ${name(to)} 선생님으로 담당 변경${inactive(to) ? '(그 선생님 현재 재직 아님)' : ''}`, '퇴원 전에 이 반 담당 선생님이 바뀜', { source: { table: 'class_schedules', id: cid }, open: null, ids: { classId: cid, teacherId: to } }); });
    // Scope words matter: when only part of the group has the reason, the statement says '원생 가운데 … 있음', not the whole group.
    const reasoned = members.filter(byReason).length;
    if (reasoned) facts.push(fact(`handover-reason:${subject}`, `퇴원 사유에 담당 변경·강사 퇴사가 적힌 원생 ${reasoned}명(이 묶음 ${members.length}명 중 · 사유에 과목이 없어, 그만둘 때 이 과목 반이 있던 원생)`,
      reasoned === members.length ? '이 묶음 원생들의 퇴원 사유에 담당 변경이나 강사 퇴사가 적혀 있음' : '이 묶음 원생 가운데 퇴원 사유에 담당 변경이나 강사 퇴사가 적힌 원생이 있음', { counts: { students: reasoned, cohort: members.length } }));
    // No hand-over row in this subject → the group rests on the recorded reason only; its name must not claim a hand-over.
    if (changes.length) add('handover', subject, `${ix.subjectLabel(subject)} 담당 교체 직후 퇴원`, members, facts, { classIds: changes.map(k => k.split('|')[0]), teacherIds: changes.map(k => k.split('|')[2]) });
    else add('teacher_reason', subject, `${ix.subjectLabel(subject)} 퇴원 사유에 담당 교체·강사 퇴사`, members, facts);
  }
  // 3 one teacher (2.0 churn judge for real exits) carrying many exits
  const perTeacher = new Map();
  for (const c of real) for (const ch of c.churn) for (const tid of ch.teacherIds) (perTeacher.get(tid) ?? perTeacher.set(tid, new Set()).get(tid)).add(c);
  for (const [tid, set] of [...perTeacher].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size)) {
    const members = [...set], reasons = Object.entries(Object.groupBy(members, c => c.reasonKey || 'none')).sort((a, b) => b[1].length - a[1].length);
    add('teacher', tid, `${name(tid)} 선생님 담당 원생 퇴원 집중`, members, [
      fact(`teacher-count:${tid}`, `퇴원율 판정으로 ${name(tid)} 선생님 담당인 퇴원 ${members.length}명(이 비교의 실제 퇴원 ${real.length}명 중)${inactive(tid) ? ' · 현재 재직 아님' : ''}`, `퇴원율 판정으로 이 선생님 담당인 퇴원이 몰림${inactive(tid) ? ' · 이 선생님은 현재 재직 아님' : ''}`, { source: { table: 'users', id: tid }, open: { family: 'staff', id: tid }, counts: { students: members.length, cohort: real.length }, ids: { teacherId: tid } }),
      fact(`teacher-reasons:${tid}`, `사유: ${reasons.map(([k, l]) => `${k === 'none' ? '미기재' : ix.reasonLabel(k)} ${l.length}`).join(' · ')}`, `이 선생님 담당 퇴원의 주된 사유: ${reasons[0][0] === 'none' ? '미기재' : ix.reasonLabel(reasons[0][0])}`),
    ], { teacherIds: [tid] });
  }
  // 4 the same reason, and the same day
  // competitor/relocation have their own clusters below.
  for (const [key, list] of Object.entries(Object.groupBy(real.filter(c => c.reasonKey && !['other', 'competitor', 'relocation'].includes(c.reasonKey)), c => c.reasonKey)).filter(([, l]) => l.length >= 3)) {
    const days = Object.entries(Object.groupBy(list, c => c.exit.date)).filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length);
    add('reason', key, `같은 사유 집중 · ${ix.reasonLabel(key)}`, list, [fact(`reason:${key}`, `사유 '${ix.reasonLabel(key)}' 퇴원 ${list.length}명 · ${list.map(c => c.exit.date).sort()[0]} ~ ${list.map(c => c.exit.date).sort().at(-1)}${days.length ? ` · 같은 날 ${days.map(([d, l]) => `${d} ${l.length}명`).join(', ')}` : ''}`, `같은 사유의 퇴원이 몰림${days.length ? ' · 같은 날 처리된 퇴원이 있음' : ''}`, { counts: { students: list.length } })]);
  }
  for (const [day, list] of Object.entries(Object.groupBy(real, c => c.exit.date)).filter(([, l]) => l.length >= 4))
    add('same_day', day, `같은 날 퇴원 ${day}`, list, [fact(`day:${day}`, `${day} 일일 퇴원 ${list.length}명 · 사유 ${Object.entries(Object.groupBy(list, c => c.reasonKey || 'none')).map(([k, l]) => `${k === 'none' ? '미기재' : ix.reasonLabel(k)} ${l.length}`).join(' · ')}`, '같은 날 여러 원생의 퇴원이 처리됨', { counts: { students: list.length } })]);
  // 5 grade · 6 siblings · 7 classmates · 8 moves · 9 other academies
  for (const [grade, list] of Object.entries(Object.groupBy(left.filter(c => c.grade), c => c.grade)).filter(([, l]) => l.length >= 3 && l.length >= left.length * 0.2))
    add('grade', grade, `${grade} 학년 집중`, list, [fact(`grade:${grade}`, `${grade} ${list.length}명(이 비교의 퇴원 ${left.length}명 중) · 진로·졸업 사유 ${list.filter(c => ['career', 'graduated'].includes(c.reasonKey)).length}명`, '같은 학년 원생의 퇴원이 몰림', { counts: { students: list.length, cohort: left.length } })]);
  // 형제마다 누가·언제·무슨 사유로(원장 10-28 "이게 무슨 말이야? … 이해를 못하겠는데" — 인원만 적은 근거로는 AI 정리도 제목을 되풀이할 뿐이었다).
  // 화면 근거엔 이름, AI에 넘기는 문장엔 이름 없이 간격·사유만.
  const sib = left.filter(c => c.siblingsLeft.length);
  if (sib.length) {
    // 이 비교 밖의 형제도 사례 파일과 같은 정리 함수로(원본 사유 글자를 그대로 쓰면 '미기재'로 보인다).
    const reasonOf = s => cases.find(c => c.studentId === s)?.reasonKey ?? ix.normalizeReason(ix.studentById.get(s)?.withdrawal_metadata?.reason);
    const day = d => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '날짜 미기재');
    const groups = new Map();
    for (const c of sib) { const ids = uniq([c.studentId, ...c.siblingsLeft]).sort(); groups.set(ids.join(','), ids); }
    const named = [...groups.values()].map(ids => ids.map(id => ({ name: ix.studentById.get(id)?.name || '이름 없음', date: ix.exitOf(id)?.date || '', reason: reasonOf(id) ? ix.reasonLabel(reasonOf(id)) : '사유 미기재' })).sort((a, b) => a.date.localeCompare(b.date)));
    const facts = named.map((rows, i) => {
      const dates = rows.map(r => r.date).filter(Boolean), gap = dates.length > 1 ? Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86_400_000) : 0;
      return fact(`siblings:${[...groups.keys()][i]}`, `${rows.map(r => `${r.name} ${day(r.date)} 퇴원 · ${r.reason}`).join(' / ')}`,
        `형제 ${rows.length}명 동반 퇴원(${gap ? `${gap}일 이내` : '동시'}) · 기록된 퇴원 사유: ${uniq(rows.map(r => r.reason)).join(', ')}`, { counts: { students: rows.length } });
    });
    add('siblings', 'all', named.length === 1 ? `${named[0].map(r => r.name).join('·')} 형제 함께 퇴원` : `형제가 함께 퇴원한 가족 ${named.length}곳`, sib, facts);
  }
  const classChains = new Map();
  for (const c of left) for (const f of c.facts.filter(f => f.kind === 'classmates')) { const e = classChains.get(f.ids.classId) ?? classChains.set(f.ids.classId, { members: new Set(), all: new Set() }).get(f.ids.classId); e.members.add(c); e.all.add(c.studentId); f.ids.studentIds.forEach(id => e.all.add(id)); }
  for (const [cid, e] of [...classChains].filter(([, e]) => e.members.size >= 2 && e.all.size >= 3))
    add('classmates', cid, `${cname(cid)} 반 연쇄 퇴원`, [...e.members], [fact(`chain:${cid}`, `${cname(cid)} 반에서 서로 2주 안에 퇴원 ${e.all.size}명(이 비교에 든 원생 ${e.members.size}명)`, '같은 반 원생들이 잇따라 그만둠', { counts: { students: e.all.size }, ids: { classId: cid } })], { classIds: [cid] });
  const moved = real.filter(c => c.reasonKey === 'relocation' || c.detailKey === 'distance_shuttle');
  if (moved.length >= 2) add('distance', 'all', '이사·거리', moved, [fact('distance', `이사 또는 거리·차량 사유 ${moved.length}명`, '이사나 거리 문제로 그만둔 원생이 있음', { counts: { students: moved.length } })]);
  const rival = real.filter(c => c.reasonKey === 'competitor');
  if (rival.length >= 2) add('competitor', 'all', '다른 학원으로 이동', rival, [fact('competitor', `타 학원 이동 ${rival.length}명 · ${Object.entries(Object.groupBy(rival, c => c.detailKey || 'none')).map(([k, l]) => `${k === 'none' ? '세부 미기재' : ix.detailLabel(k)} ${l.length}`).join(' · ')}`, '다른 학원으로 옮긴 원생이 있음', { counts: { students: rival.length } })]);
  // 10 bulk clean-ups (re-timed) · 11 not withdrawn (hold / enrolled without a bill)
  const bulk = cases.filter(c => c.exit.kind === 'cleanup');
  if (bulk.length) add('cleanup', 'all', '일괄 정리(이탈 달 추정)', bulk, [fact('cleanup', `일괄 정리로 퇴원 처리된 원생 ${bulk.length}명 · 실제 이탈 달은 청구·출석으로 추정${bulk.some(c => c.exit.v2BookkeepingOnly) ? ` · 그중 ${bulk.filter(c => c.exit.v2BookkeepingOnly).length}명은 수업 기록이 없는 장부 정리라 퇴원 통계에서 빠짐` : ''}`, '일괄 정리로 퇴원 처리되어 사유 기록이 없음', { counts: { students: bulk.length } })]);
  const kept = cases.filter(c => ['on_hold', 'enrolled', 'other'].includes(c.exit.kind));
  if (kept.length) add('not_left', 'all', '퇴원 아님(휴원·재원 · 뒤 달 청구 없음)', kept, [fact('not_left', `휴원 ${kept.filter(c => c.exit.kind === 'on_hold').length}명 · 재원 ${kept.filter(c => c.exit.kind === 'enrolled').length}명 · 그 밖 ${kept.filter(c => c.exit.kind === 'other').length}명`, '퇴원하지 않고 휴원했거나 재원 중이지만 청구가 없음', { counts: { students: kept.length } })]);
  // Same members as a cluster of a more specific kind (a closed class's chain = that teacher's closure) → keep the specific one.
  const key = c => [...c.members].sort().join(','), unique = [];
  for (const c of [...out].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))) if (!unique.some(k => key(k) === key(c))) unique.push(c);
  // Causal chains first (a teacher left / a hand-over), then concentrations, then patterns; clean-ups last. Amount within a tier.
  return unique.sort((a, b) => TIER[a.kind] - TIER[b.kind] || a.amount - b.amount || b.members.length - a.members.length || a.id.localeCompare(b.id));
}
const TIER = { teacher_left: 0, handover: 0, teacher_reason: 0, teacher: 1, reason: 1, same_day: 1, competitor: 2, distance: 2, siblings: 2, classmates: 2, grade: 3, cleanup: 4, not_left: 4 };
export const PRIORITY = ['teacher_left', 'handover', 'teacher_reason', 'teacher', 'reason', 'same_day', 'classmates', 'siblings', 'competitor', 'distance', 'grade', 'cleanup', 'not_left'];
export const KIND_LABEL = { teacher_left: '선생님 퇴직 뒤 반 폐강', handover: '담당 교체 직후 퇴원', teacher_reason: '퇴원 사유에 담당 교체·강사 퇴사', teacher: '특정 선생님 담당 집중', reason: '같은 사유 집중', same_day: '같은 날 집중', classmates: '같은 반 연쇄 퇴원', siblings: '형제 동반 퇴원', competitor: '다른 학원으로 이동', distance: '이사·거리', grade: '같은 학년 집중', cleanup: '일괄 정리', not_left: '퇴원 아님' };
