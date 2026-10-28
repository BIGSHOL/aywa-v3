// Issue hierarchy for one source case (FLOW-HIERARCHY.md): academy → teacher → class → student →
// evidence records, built only from verified FK facts (classes.teacher_id, attendance_records.*).
// Nothing is inferred from text or names. The seed keeps ≤50 refs per case/step; this rebuilds
// every authorized record from source.signals and re-derives each record's step with the seed's
// FK owner rule, cross-checked against the refs the seed stored. Pure: no AI, no I/O.
import { createHash } from 'node:crypto';

export const HIERARCHY_SCHEMA = 1;
export class HierarchyError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

const sha = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const day = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const OUTCOME_STATE = { done: 'reported', not_needed: 'not_needed', needs_review: 'needs_review', unreachable: 'unreachable' };
// Local label only (never sent to AI): same output as src/lib/format/school-grade.ts schoolGradeLabel ("경명여중"+"중1" → "경명여중1").
export function schoolGrade(school, grade) {
  const s = (school || '').trim(), g = (grade || '').trim();
  if (!s || !g) return s || g || null;
  if (/^[3-7]\s*세$/.test(g) || /^(미취학|유치)/.test(g)) return s.includes(g) ? s : `${s} ${g}`;
  return `${s}${(g.match(/\d+/) || [g])[0]}`;
}

// Supported source signals. A new signal adds an adapter: how one evidence record maps to
// student/class (FK) and what the source rule was, stated as the source states it.
export const ADAPTERS = Object.freeze({
  'attendance-repeat-absence': {
    familyId: 'attendance', recordType: 'attendance', threshold: 3, area: 'attendance', statusLabel: { absent: '결석' },
    record: e => ({ studentId: e.studentId || null, classId: e.classId || null, date: e.date || null, status: 'absent' }),
    basis: ({ asOf, capturedAt }) => ({
      asOf, capturedAt, label: `이번 달(${Number(asOf.slice(5, 7))}/1~${Number(asOf.slice(5, 7))}/${Number(asOf.slice(8, 10))}) 결석 3회 이상`,
      window: { from: `${asOf.slice(0, 7)}-01`, to: asOf }, threshold: { count: 3, unit: '결석 기록(수업별 출결 칸, 정정 반영)' },
      cohort: '재원(enrolled) 원생 · 테스트 원생 제외 · 정정 전 기록 제외',
      interpretation: '결석은 수업마다 따로 셉니다.',
      note2_0: '2.0 반복 결석 알림은 최근 14일 3/5/10회 단계로 기준이 다릅니다. 이 화면은 복사본 신호의 이번 달 기준을 그대로 씁니다.',
    }),
  },
});

/** Supported adapter for a case, or a typed error (never a bogus tree). */
export function adapterFor(state, caseId) {
  const c = state.cases[caseId];
  if (!c) throw new HierarchyError(404, 'case_not_found', '업무를 찾을 수 없습니다.');
  const adapter = c.kind === 'source' && c.signalId ? ADAPTERS[c.signalId] : null;
  if (!adapter || adapter.familyId !== c.familyId) throw new HierarchyError(422, 'hierarchy_unsupported', '이 업무는 아직 원생·반·강사 계층으로 볼 수 없습니다.');
  return { c, adapter };
}

// Same rule as the seed's signalOwner for attendance: the class's homeroom teacher when that
// person is an active actor, otherwise the manager-queue step. Groups are numbered in ref order.
function stepIndex(source, c, refs) {
  const actors = new Set(source.actors.map(a => a.id)), order = [], byRef = new Map();
  for (const ref of refs) {
    const t = source.entities.get(`class:${source.entities.get(ref)?.classId}`)?.teacherId;
    const owner = t && actors.has(t) ? t : 'queue';
    if (!order.includes(owner)) order.push(owner);
    byRef.set(ref, `${c.id}-s${order.indexOf(owner) + 1}`);
  }
  let mismatched = 0;
  for (const s of c.steps) for (const ref of s.refs || []) if (byRef.get(ref) !== s.id) mismatched += 1;
  return { byRef, mismatched, known: new Set(c.steps.map(s => s.id)) };
}

/** Full (untruncated) refs per step of a supported signal case, or null. Used to authorize report recordRefs. */
export function signalStepRefs(source, c) {
  const adapter = c?.kind === 'source' && c.signalId ? ADAPTERS[c.signalId] : null;
  const sg = adapter && source.signals.find(s => s.familyId === c.familyId && s.signal.id === c.signalId);
  if (!sg) return null;
  const { byRef } = stepIndex(source, c, sg.refs.filter(k => k.startsWith(`${adapter.recordType}:`) && source.entities.has(k)));
  const out = new Map(); for (const [ref, stepId] of byRef) { if (!out.has(stepId)) out.set(stepId, []); out.get(stepId).push(ref); }
  return out;
}

// Reports are kept per scope inside the reporting step: one record, one student, one class, or the
// whole step (no narrowing refs). Each evidence record later takes the most recent applicable one.
function flowIndex(c) {
  const scoped = new Map();
  const put = (key, v) => { const cur = scoped.get(key); if (!cur || cur.at <= v.at) scoped.set(key, v); };
  for (const e of c.evidence || []) {
    const v = { state: OUTCOME_STATE[e.outcome] || 'reported', at: e.at, followupCaseId: e.followupCaseId || null };
    const refs = (e.recordRefs || []).filter(r => ['attendance', 'student', 'class'].includes(r.type));
    if (!refs.length) put(`${e.stepId}|step`, { ...v, scope: 'step' });
    for (const r of refs) put(`${e.stepId}|${r.type}:${r.id}`, { ...v, scope: r.type === 'class' ? 'class' : 'record' });
  }
  const working = new Set(c.steps.filter(s => s.status === 'working').map(s => s.id));
  // Most recent of record / student / class / whole-step report; at equal times the narrower scope wins.
  const forRecord = (stepId, r) => [`attendance:${r.id}`, `student:${r.studentId}`, `class:${r.classId}`, 'step']
    .map(k => scoped.get(`${stepId}|${k}`)).filter(Boolean).reduce((best, v) => (!best || v.at > best.at ? v : best), null);
  return { forRecord, working };
}

const emptyCounts = () => ({ students: new Set(), classes: new Set(), teachers: new Set(), records: 0 });
const finalCounts = k => ({ students: k.students.size, classes: k.classes.size, teachers: k.teachers.size, records: k.records });

/** Builds the hierarchy for caseId. Returns { tree, index }; tree has no AI fields yet. */
export function buildHierarchy(source, state, caseId) {
  const { c, adapter } = adapterFor(state, caseId);
  const sg = source.signals.find(s => s.familyId === c.familyId && s.signal.id === c.signalId);
  const recordIds = sg ? sg.signal.recordIds.map(String) : [];
  const refs = (sg?.refs || []).filter(k => k.startsWith(`${adapter.recordType}:`) && source.entities.has(k));
  const { asOf, capturedAt } = source.identity;
  const basis = adapter.basis({ asOf, capturedAt });
  const rows = refs.map(ref => { const e = source.entities.get(ref); return { ref, id: e.id, ...adapter.record(e) }; }).filter(r => r.studentId && source.entities.has(`student:${r.studentId}`));
  if (!rows.length) throw new HierarchyError(422, 'hierarchy_no_relationships', '근거 기록이 학생·반과 이어지지 않아 선생님별로 묶지 못했습니다.');
  const steps = stepIndex(source, c, refs), flow = flowIndex(c), actors = new Set(source.actors.map(a => a.id));

  // Cohort check against the stated rule (window, threshold, enrolled) — reported, never "fixed".
  const perStudent = new Map(); for (const r of rows) perStudent.set(r.studentId, (perStudent.get(r.studentId) || 0) + 1);
  const statuses = [...perStudent.keys()].map(id => source.entities.get(`student:${id}`)?.status);
  const cohortCheck = {
    belowThreshold: [...perStudent.values()].filter(n => n < adapter.threshold).length,
    outsideWindow: rows.filter(r => !r.date || r.date < basis.window.from || r.date > basis.window.to).length,
    notEnrolled: statuses.every(s => s === undefined) ? null : statuses.filter(s => s !== 'enrolled').length,
  };
  // ok: true = verified · false = a record breaks the stated rule · null = enrolment could not be checked.
  cohortCheck.ok = cohortCheck.belowThreshold || cohortCheck.outsideWindow || cohortCheck.notEnrolled ? false : cohortCheck.notEnrolled === null ? null : true;

  // teacher → class → student → records. Unknown class/teacher stay explicit buckets.
  const teachers = new Map(), recordsOf = new Map();
  for (const r of rows) {
    const cls = r.classId ? source.entities.get(`class:${r.classId}`) : null;
    const tId = cls?.teacherId && source.entities.has(`staff:${cls.teacherId}`) ? cls.teacherId : null;
    const tKey = tId ? `teacher:${tId}` : 'teacher:unknown', cKey = cls ? `class:${cls.id}` : `class:unknown:${tKey}`;
    if (!teachers.has(tKey)) teachers.set(tKey, { id: tId, classes: new Map() });
    const classes = teachers.get(tKey).classes;
    if (!classes.has(cKey)) classes.set(cKey, { cls, students: new Map() });
    const students = classes.get(cKey).students;
    if (!students.has(r.studentId)) students.set(r.studentId, []);
    students.get(r.studentId).push(r);
    if (!recordsOf.has(r.studentId)) recordsOf.set(r.studentId, []);
    recordsOf.get(r.studentId).push(r);
  }

  const nodes = new Map(), unknown = { teacherRecords: 0, classRecords: 0 };
  const stepsOf = list => [...new Set(list.map(r => steps.byRef.get(r.ref)).filter(id => id && steps.known.has(id)))].sort();
  // A student node is reported only when every one of its records is covered; partly covered = 'partial'
  // with counts. A human's needs_review/unreachable on any record outranks 'reported'.
  const flowOf = list => {
    const hits = list.map(r => flow.forRecord(steps.byRef.get(r.ref), r)).filter(Boolean);
    const followupCaseIds = [...new Set(hits.map(h => h.followupCaseId).filter(Boolean))];
    const reportedAt = hits.map(h => h.at).sort().at(-1) || null, coverage = { covered: hits.length, total: list.length };
    if (!hits.length) return { state: stepsOf(list).some(s => flow.working.has(s)) ? 'working' : 'open', scope: null, coverage, reportedAt, followupCaseIds };
    if (hits.length < list.length) return { state: 'partial', scope: 'record', coverage, reportedAt, followupCaseIds };
    const states = new Set(hits.map(h => h.state));
    const state = states.has('needs_review') ? 'needs_review' : states.has('unreachable') ? 'unreachable' : states.size === 1 && states.has('not_needed') ? 'not_needed' : 'reported';
    return { state, scope: hits.every(h => h.scope === 'step') ? 'step' : 'record', coverage, reportedAt, followupCaseIds };
  };
  // Parents only summarize children: one state when all agree, otherwise 'partial' with the breakdown.
  // byState counts student nodes (one per student per class) at every level.
  const aggregate = children => {
    const byState = {}; for (const n of children) for (const [k, v] of Object.entries(n.flow.byState || { [n.flow.state]: 1 })) byState[k] = (byState[k] || 0) + v;
    const states = Object.keys(byState), at = children.map(n => n.flow.reportedAt).filter(Boolean).sort().at(-1) || null;
    return { state: states.length === 1 ? states[0] : 'partial', scope: 'aggregate', byState, reportedAt: at, followupCaseIds: [...new Set(children.flatMap(n => n.flow.followupCaseIds))] };
  };
  const sortNodes = list => list.sort((a, b) => (a.id.includes('unknown') - b.id.includes('unknown')) || b.counts.records - a.counts.records || a.label.localeCompare(b.label, 'ko'));
  const rootK = emptyCounts(), teacherNodes = [];
  for (const [tKey, t] of teachers) {
    const tK = emptyCounts(), classNodes = [], staff = t.id ? source.entities.get(`staff:${t.id}`) : null;
    if (t.id) tK.teachers.add(t.id); else unknown.teacherRecords += [...t.classes.values()].reduce((n, x) => n + [...x.students.values()].flat().length, 0);
    for (const [cKey, x] of t.classes) {
      const cK = emptyCounts(), studentNodes = [];
      if (x.cls) cK.classes.add(x.cls.id); else unknown.classRecords += [...x.students.values()].flat().length;
      if (t.id) cK.teachers.add(t.id);
      for (const [sid, list] of x.students) {
        const all = recordsOf.get(sid), dates = list.map(r => r.date).filter(Boolean).sort(), allDates = all.map(r => r.date).filter(Boolean).sort();
        const sK = { students: new Set([sid]), classes: new Set(x.cls ? [x.cls.id] : []), teachers: new Set(t.id ? [t.id] : []), records: list.length };
        const se = source.entities.get(`student:${sid}`);
        const node = { id: `${cKey}/student:${sid}`, level: 'student', label: se.label, detail: schoolGrade(se.school, se.grade), entityRef: { type: 'student', id: sid }, stepIds: stepsOf(list), counts: finalCounts(sK), flow: flowOf(list), children: [],
          records: list.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id)).map(r => ({ id: `${adapter.recordType}:${r.id}`, date: r.date, status: r.status, statusLabel: adapter.statusLabel[r.status] || '기타', familyId: adapter.familyId, recordId: r.id, classId: x.cls?.id || null, teacherId: t.id })),
          facts: { origin: 'code', absencesInClass: list.length, absencesAllClasses: all.length, classesWithAbsences: new Set(all.map(r => r.classId || 'unknown')).size, firstDate: dates[0] || null, lastDate: dates.at(-1) || null,
            daysSinceLast: allDates.length ? day(allDates.at(-1), asOf) : null, absencesLast7Days: allDates.filter(d => day(d, asOf) <= 6).length } };
        node.status = node.flow.state; studentNodes.push(node); nodes.set(node.id, node);
        cK.students.add(sid); cK.records += list.length;
      }
      const all = [...x.students.values()].flat();
      const cn = { id: cKey, level: 'class', label: x.cls?.label || '반 미상', ...(x.cls ? { entityRef: { type: 'class', id: x.cls.id } } : {}), stepIds: stepsOf(all), counts: finalCounts(cK), flow: aggregate(studentNodes), children: sortNodes(studentNodes),
        facts: { origin: 'code', students: cK.students.size, records: cK.records, studentsAlsoInOtherClasses: [...x.students.keys()].filter(s => new Set(recordsOf.get(s).map(r => r.classId)).size > 1).length } };
      if (!x.cls) cn.unassigned = true;
      cn.status = x.cls ? cn.flow.state : 'unknown'; classNodes.push(cn); nodes.set(cn.id, cn);
      for (const s of cK.students) tK.students.add(s); for (const k of cK.classes) tK.classes.add(k); tK.records += cK.records;
    }
    const all = [...t.classes.values()].flatMap(x => [...x.students.values()].flat());
    const tn = { id: tKey, level: 'teacher', label: staff?.label || '담임 미지정', ...(t.id ? { entityRef: { type: 'staff', id: t.id } } : {}), stepIds: stepsOf(all), counts: finalCounts(tK), flow: aggregate(classNodes), children: sortNodes(classNodes),
      facts: { origin: 'code', active: !!(t.id && actors.has(t.id)), classes: tK.classes.size, students: tK.students.size, records: tK.records, managerQueue: !(t.id && actors.has(t.id)) } };
    if (!t.id) tn.unassigned = true;
    tn.status = !t.id ? 'unknown' : !actors.has(t.id) ? 'inactive' : tn.flow.state; teacherNodes.push(tn); nodes.set(tn.id, tn);
    for (const s of tK.students) rootK.students.add(s); for (const k of tK.classes) rootK.classes.add(k); for (const k of tK.teachers) rootK.teachers.add(k); rootK.records += tK.records;
  }

  const studentFlows = [...new Set([...nodes.values()].filter(n => n.level === 'student').map(n => n.entityRef.id))].map(sid => [...nodes.values()].filter(n => n.level === 'student' && n.entityRef.id === sid));
  const byState = {}; for (const list of studentFlows) { const s = list.every(n => n.flow.state === list[0].flow.state) ? list[0].flow.state : 'mixed'; byState[s] = (byState[s] || 0) + 1; }
  const root = { id: 'academy', level: 'academy', label: basis.label, stepIds: [...steps.known].sort(), counts: finalCounts(rootK), status: c.state, flow: aggregate(teacherNodes), children: sortNodes(teacherNodes),
    facts: { origin: 'code', studentsByFlowState: byState, managerQueueRecords: teacherNodes.filter(t => t.facts.managerQueue).reduce((n, t) => n + t.counts.records, 0), managerQueueTeachers: teacherNodes.filter(t => t.facts.managerQueue && t.entityRef).length } };
  nodes.set(root.id, root);
  const unmapped = recordIds.length - rows.length;
  const notes = [];
  const truncated = { entityRefs: c.entityRefs.filter(r => r.type === adapter.recordType).length, stepRefs: c.steps.reduce((n, s) => n + (s.refs || []).length, 0) };
  if (truncated.stepRefs < rows.length) notes.push(`단계 목록에는 근거가 ${truncated.stepRefs}건만 보이지만, 이 정리는 근거 ${rows.length}건 전부를 반의 담임 기준으로 묶었습니다.`);
  if (unmapped) notes.push(`신호 근거 ${unmapped}건은 원생 기록으로 이어지지 않아 이 화면에서 빠졌습니다.`);
  if (unknown.teacherRecords || unknown.classRecords) notes.push(`반 또는 담임을 알 수 없는 기록 ${Math.max(unknown.teacherRecords, unknown.classRecords)}건은 '관계 모름' 묶음에 따로 둡니다.`);
  if (root.facts.managerQueueRecords) notes.push(`재직 중이 아닌 담임의 기록 ${root.facts.managerQueueRecords}건은 원본 업무에서 관리자 대기열 단계에 있습니다.`);
  const warnings = [];
  if (cohortCheck.ok === false) warnings.push({ code: 'cohort_mismatch', message: `신호 기준과 맞지 않는 근거가 있습니다: 3회 미만 원생 ${cohortCheck.belowThreshold}명 · 기간 밖 기록 ${cohortCheck.outsideWindow}건 · 재원 아닌 원생 ${cohortCheck.notEnrolled ?? 0}명.` });
  if (cohortCheck.ok === null) notes.push('원생의 재원 상태를 확인할 수 없어 재원 여부는 검증하지 못했습니다.');
  if (steps.mismatched) warnings.push({ code: 'step_mismatch', message: `저장된 단계 근거 ${steps.mismatched}건이 다시 계산한 단계와 다릅니다.` });
  notes.push(...warnings.map(w => w.message));
  const fingerprint = sha([capturedAt, rows.map(r => `${r.id}|${r.studentId}|${r.classId}|${source.entities.get(`class:${r.classId}`)?.teacherId || ''}|${r.date}`).sort()]).slice(0, 16);
  return {
    tree: {
      schemaVersion: HIERARCHY_SCHEMA, caseId, flowRevision: state.revision, sourceFingerprint: fingerprint, basis,
      counts: { ...finalCounts(rootK), unmappedRecords: unmapped }, units: { students: '명(중복 없음)', classes: '개 반', teachers: '명', records: '결석 기록(건)' },
      warnings,
      coverage: { complete: !unmapped && !steps.mismatched && cohortCheck.ok !== false, totalRecords: recordIds.length, returnedRecords: rows.length, notes, seedTruncation: truncated, unknown, cohortCheck },
      root,
    },
    index: { nodes, adapter, caseState: c.state },
  };
}
