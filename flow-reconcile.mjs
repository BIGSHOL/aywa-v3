// Source reconciliation (FLOW-ENGINE.md · AX-H1·H4·H5). Every load of the source re-judges the stored source cases
// instead of only adding new ones: a task follows its 2.0 row, or one student's same-day absence group; a signal
// follows the signal (present · records · owners). Signals whose fact handling cannot change (FACT_SIGNALS) close
// when every record is reported handled and reopen only for records nobody handled — the records are never edited.
// People's decisions stay: a step a manager reassigned (case.reassign) or someone confirmed (ack) keeps its people.
// Idempotent (the same source twice changes nothing) and pure over the draft state; the caller persists.
import { CLOSE_REASON, FACT_SIGNALS, SIGNAL_DONE_RULE, TASK_EVENT_LABEL, TASK_KINDS, TASK_STATE_LABEL } from './flow-rules.mjs';
import { entityRef, newEvent, refreshCase, step } from './flow-engine.mjs';
import { assignees, clearSignal, createSignal, human, json, reconcileSignal, reopenStatus, routeOf, sameRoute } from './flow-reconcile-signals.mjs';
export { coveredRefs, isFactSignal, settleFact, signalGroups, stepRecords } from './flow-reconcile-signals.mjs';

// ── tasks ───────────────────────────────────────────────────────────────────────────────────────────
const kindOf = t => TASK_KINDS[t.kind] || { label: '업무', familyId: 'tasks-notifications', doneRule: '' };
const closedOf = t => !!t.status && t.status !== 'open';
const reasonOf = t => t.closeReason === 'desk_settled' && t.closeResult ? t.closeResult : CLOSE_REASON[t.closeReason] || TASK_STATE_LABEL[t.status];
const lastAt = (t, ev) => t.history.filter(h => h.event === ev).at(-1)?.at || null;
function taskRoute(source, t) {
  const ids = t.assigneeIds.filter(a => source.actors.some(x => x.id === a));
  return routeOf(ids.length ? { assigneeIds: ids, queue: null, rule: '원래 업무 담당', ruleSource: 'staff_task_assignees.user_id' } : { assigneeIds: [], queue: 'manager', reason: t.assigneeIds.length ? '배정된 사람이 재직 직원 목록에 없어 관리자 대기열' : '배정된 사람이 없어 관리자 대기열' });
}
const taskFacts = (source, t) => ({ title: t.title || kindOf(t).label, summary: t.detail || kindOf(t).label, dueAt: t.dueAt ?? null, doneRule: kindOf(t).doneRule,
  entityRefs: (t.recordKeys || [`task:${t.id}`, ...(t.subjectKey ? [t.subjectKey] : [])]).map(k => {
    const ref = entityRef(source, k), teacherName = source.entities.get(k)?.teacherName;
    return ref && teacherName ? { ...ref, teacherName } : ref;
  }).filter(Boolean),
  ...(t.kind === 'attendance_absent_desk' ? { studentRef: t.studentKey ? entityRef(source, t.studentKey) : null, groupDate: t.groupDate || null, actionTaskId: t.actionTaskId || null } : {}) });
const taskPriority = (source, t) => !closedOf(t) && t.dueAt && t.dueAt < source.identity.capturedAt ? 'high' : 'normal';

function createTask(state, source, t, seededAt) {
  const id = `src-task-${t.id}`, kind = kindOf(t), closed = closedOf(t), route = taskRoute(source, t), status = t.status || 'open';
  state.cases[id] = { id, kind: 'source', scenario: null, familyId: kind.familyId, ...taskFacts(source, t), taskKind: t.kind, sourceStatus: status, sourceStatusLabel: TASK_STATE_LABEL[status], factClosed: closed, closedReason: closed ? reasonOf(t) : null, closedAt: closed ? t.closedAt : null, ...(closed ? { closedBy: 'source' } : {}), priority: taskPriority(source, t), state: 'open', closure: 'fact', origin: 'snapshot', trigger: null, steps: [step(`${id}-s1`, { key: 'source_task', label: kind.label, role: 'source', evidenceRequired: true }, { ...route, reason: route.unassignedReason }, 1, { status: closed ? 'done' : 'ready', ...(closed ? { closedBy: 'source' } : {}) })], currentStepId: null, assigneeIds: [], createdAt: t.openedAt || seededAt, updatedAt: t.closedAt || t.openedAt || seededAt, evidence: [], decision: null, history: [], linkedCaseIds: [], sourceKey: `task:${t.id}`, flags: {} };
  const c = state.cases[id];
  let cause = null;
  for (const h of t.history) cause = newEvent(state, { caseId: id, type: h.event === 'opened' ? 'source.task_opened' : 'source.task_event', label: TASK_EVENT_LABEL[h.event] || '업무 변경', actorId: h.actor, origin: 'snapshot', at: h.at, causeId: cause?.id || null, targetActorIds: h.event === 'assigned' || h.event === 'opened' ? route.assigneeIds : [] });
  if (!cause) newEvent(state, { caseId: id, type: 'source.task_opened', origin: 'snapshot', at: t.openedAt || seededAt, targetActorIds: route.assigneeIds });
  c.trigger = { eventId: c.history[0], type: 'source.task_opened', label: kind.label, actorId: null, at: c.createdAt };
  refreshCase(c);
}

/** Re-judges one stored task case against its source row. Returns the events to record. */
function reconcileTask(source, c, t, at) {
  const out = [], s0 = c.steps[0], closed = closedOf(t), status = t.status || 'open', facts = taskFacts(source, t), prevClosedAt = c.closedAt;
  const changed = ['title', 'summary', 'dueAt'].filter(k => json(c[k]) !== json(facts[k]));
  Object.assign(c, facts);
  const reported = t.kind === 'attendance_absent_desk' ? changed.filter(k => k === 'dueAt') : changed;
  if (reported.length) out.push({ type: 'source.task_changed', label: `업무 내용이 바뀜(${reported.map(k => ({ title: '제목', summary: '내용', dueAt: '기한' })[k]).join('·')})`, at, data: { fields: reported } });
  if (closed && !c.factClosed) {
    for (const s of c.steps) if (s.status !== 'done') { s.status = 'done'; s.closedBy = 'source'; }
    Object.assign(c, { sourceStatus: status, sourceStatusLabel: TASK_STATE_LABEL[status], factClosed: true, closedReason: reasonOf(t), closedAt: t.closedAt, closedBy: 'source' });
    out.push({ type: 'source.task_closed', label: `업무 ${TASK_STATE_LABEL[status]} — ${c.closedReason}`, at: t.closedAt || at, data: { status, closeReason: t.closeReason || null } });
  } else if (!closed && c.factClosed) {
    const reopenedAt = lastAt(t, 'reopened'); // the 2.0 reopen time when it is newer than the closing we knew
    for (const s of c.steps) if (s.status === 'done') { s.status = reopenStatus(s); delete s.closedBy; }
    Object.assign(c, { sourceStatus: status, sourceStatusLabel: TASK_STATE_LABEL[status], factClosed: false, closedReason: null, closedAt: null }); delete c.closedBy;
    out.push({ type: 'source.task_reopened', at: reopenedAt && (!prevClosedAt || reopenedAt > prevClosedAt) ? reopenedAt : at, reopen: true });
  } else if (closed && (c.sourceStatus !== status || c.closedReason !== reasonOf(t))) {
    Object.assign(c, { sourceStatus: status, sourceStatusLabel: TASK_STATE_LABEL[status], closedReason: reasonOf(t), closedAt: t.closedAt });
    out.push({ type: 'source.task_closed', label: `업무 상태가 바뀜 — ${TASK_STATE_LABEL[status]}(${c.closedReason})`, at: t.closedAt || at, data: { status, closeReason: t.closeReason || null, changed: true } });
  }
  c.priority = taskPriority(source, t);
  const route = taskRoute(source, t);
  if (!closed && s0 && !human(s0) && !sameRoute(s0, route)) {
    const from = s0.assigneeIds; Object.assign(s0, route);
    // Observed at this read: the change may come from 2.0 or from a person leaving the staff list.
    if (json(from) !== json(route.assigneeIds)) out.push({ type: 'source.task_reassigned', at, targetActorIds: route.assigneeIds, data: { from, to: route.assigneeIds } });
  }
  if (!closed) for (const e of out) if (e.reopen) e.targetActorIds = s0?.assigneeIds || [];
  return out;
}

// ── whole source ────────────────────────────────────────────────────────────────────────────────────
const TAGS = { status: ['factClosed', 'closedBy', 'closedReason', 'sourceStatus', 'state'], wording: ['title', 'summary', 'dueAt', 'draft'], records: ['entityTotal', 'sourceRecords'], labels: ['entityRefs'], rule: ['doneRule', 'priority'] };
function clearInternalGroupingEvents(state) {
  const internal = e => {
    const c = state.cases[e.caseId];
    if (c?.taskKind !== 'attendance_absent_desk') return false;
    if (e.label === '같은 날 결석 교시를 한 업무로 합침' || e.label === '같은 원생의 같은 날 결석 업무로 합침') return true;
    if (e.type !== 'source.task_changed') return false;
    const fields = e.data?.fields;
    return Array.isArray(fields) && fields.length > 0 && fields.every(k => k === 'title' || k === 'summary');
  };
  const removed = new Map(state.events.filter(internal).map(e => [e.id, e.causeId]));
  if (!removed.size) return { affected: [], count: 0 };
  state.events = state.events.filter(e => !removed.has(e.id));
  const cause = id => { while (removed.has(id)) id = removed.get(id); return id || null; };
  for (const e of state.events) if (removed.has(e.causeId)) e.causeId = cause(e.causeId);
  const affected = [];
  for (const c of Object.values(state.cases)) {
    const before = c.history.length;
    c.history = c.history.filter(id => !removed.has(id));
    if (c.history.length !== before) affected.push(c.id);
  }
  return { affected, count: removed.size };
}
function diffTags(a, b) {
  const tags = Object.entries(TAGS).filter(([, ks]) => ks.some(k => json(a[k]) !== json(b[k]))).map(([t]) => t);
  const sa = a.steps || [], sb = b.steps || [];
  if (sa.length !== sb.length || sa.some((s, i) => s.id !== sb[i].id || json(s.refs) !== json(sb[i].refs))) tags.push('records');
  if (sa.some((s, i) => sb[i] && json([s.assigneeIds, s.queue]) !== json([sb[i].assigneeIds, sb[i].queue]))) tags.push('route');
  if (sa.some((s, i) => sb[i] && json([s.status, s.handled, s.retired]) !== json([sb[i].status, sb[i].handled, sb[i].retired]))) tags.push('status');
  if (sa.some((s, i) => sb[i] && json([s.label, s.rule, s.unassignedReason]) !== json([sb[i].label, sb[i].rule, sb[i].unassignedReason]))) tags.push('rule');
  return [...new Set(tags)];
}
/** Applies one judged change to a case: events (in order, each caused by the previous), refresh, outcome. */
function commit(state, c, before, events, at, summary) {
  refreshCase(c);
  const after = JSON.stringify(c);
  if (after === before && !events.length) { summary.unchanged += 1; return; }
  const was = JSON.parse(before);
  let cause = c.history.at(-1) || null;
  for (const e of events) cause = newEvent(state, { caseId: c.id, origin: e.origin || 'snapshot', actorId: e.actorId || null, type: e.type, label: e.label, at: e.at, causeId: cause, targetActorIds: e.targetActorIds || (e.reopen ? assignees(c) : []), data: e.data || null }).id;
  if (events.length) c.updatedAt = events.map(e => e.at).sort().at(-1); // silent refreshes (names, wording rules) keep the order
  const outcome = was.factClosed && !c.factClosed ? 'reopened' : c.factClosed && !was.factClosed ? 'closed' : 'updated';
  summary[outcome] += 1;
  summary.changes.push({ caseId: c.id, title: c.title, outcome, tags: diffTags(was, c), events: events.map(e => e.type) });
}

/**
 * Seeds new source cases and re-judges stored ones (server start and reloadSource). Returns
 * { created, updated, closed, reopened, unchanged, changes:[{caseId,title,outcome,tags,events}] }.
 * mode 'seed' = the behaviour before re-judging (new cases + the open signal's current wording only) —
 * flow-service.mjs runs that unless OWNER_CONCEPT_FLOW_RECONCILE=apply.
 */
export function reconcileSource(state, source, { at, mode = 'apply' } = {}) {
  const when = at || source.loadedAt || source.identity.capturedAt, seededAt = source.identity.capturedAt;
  const summary = { created: 0, updated: 0, closed: 0, reopened: 0, unchanged: 0, cleaned: 0, changes: [] }, seen = new Set();
  const cleaned = mode === 'apply' ? clearInternalGroupingEvents(state) : { affected: [], count: 0 };
  const run = (key, create, judge) => {
    seen.add(key);
    const id = state.seededKeys[key], c = id && state.cases[id];
    if (!c) { const made = create(); state.seededKeys[key] = made; summary.created += 1; summary.changes.push({ caseId: made, title: state.cases[made].title, outcome: 'created', tags: [], events: [] }); return; }
    const before = JSON.stringify(c);
    if (mode === 'seed') { if (reword(c, key)) { summary.updated += 1; summary.changes.push({ caseId: c.id, title: c.title, outcome: 'updated', tags: ['wording'], events: [] }); } else summary.unchanged += 1; return; }
    commit(state, c, before, judge(c), when, summary);
  };
  // seed mode: an open signal case follows its current wording and closure rule. Old cases gain a newly declared fact rule on restart.
  const reword = (c, key) => {
    const sg = key.startsWith('signal:') && source.signals.find(x => `signal:${x.familyId}:${x.signal.id}` === key);
    if (!sg || c.state === 'done') return false;
    const doneRule = FACT_SIGNALS[sg.signal.id]?.doneRule ?? SIGNAL_DONE_RULE;
    if (c.title === sg.signal.title && (c.summary ?? '') === (sg.signal.summary ?? '') && c.doneRule === doneRule) return false;
    for (const st of c.steps || []) if (st.key === 'source_check' && typeof st.label === 'string' && st.label.startsWith(c.title)) st.label = sg.signal.title + st.label.slice(c.title.length);
    c.title = sg.signal.title; c.summary = sg.signal.summary; c.doneRule = doneRule; return true;
  };
  for (const t of source.tasks) run(`task:${t.id}`, () => { createTask(state, source, t, seededAt); return `src-task-${t.id}`; }, c => reconcileTask(source, c, t, when));
  for (const t of source.tasks.filter(x => x.mergedTaskIds?.length)) {
    const primary = state.cases[state.seededKeys[`task:${t.id}`]];
    if (!primary) continue;
    const beforePrimary = JSON.stringify(primary);
    for (const taskId of t.mergedTaskIds) {
      const key = `task:${taskId}`; seen.add(key);
      const duplicate = state.cases[state.seededKeys[key]];
      if (!duplicate) continue;
      if (!primary.linkedCaseIds.includes(duplicate.id)) primary.linkedCaseIds.push(duplicate.id);
      if ((duplicate.steps.some(s => s.status === 'working') || duplicate.evidence?.length) && primary.steps[0]?.status === 'ready') primary.steps[0].status = 'working';
      if (duplicate.mergedInto !== primary.id) { const b = JSON.stringify(duplicate); duplicate.mergedInto = primary.id; if (mode !== 'seed') commit(state, duplicate, b, [], when, summary); }
      if (mode === 'seed' || duplicate.factClosed) continue;
      const before = JSON.stringify(duplicate);
      for (const s of duplicate.steps) if (s.status !== 'done') { s.status = 'done'; s.closedBy = 'source'; }
      Object.assign(duplicate, { factClosed: true, closedReason: '묶음으로 합침', closedAt: when, closedBy: 'source' });
      commit(state, duplicate, before, [], when, summary);
    }
    if (JSON.stringify(primary) !== beforePrimary) commit(state, primary, beforePrimary, [], when, summary);
  }
  for (const sg of source.signals) run(`signal:${sg.familyId}:${sg.signal.id}`, () => { createSignal(state, source, sg, when); return `src-sig-${sg.familyId}-${sg.signal.id}`.replace(/[^a-z0-9-]/gi, '-'); }, c => reconcileSignal(source, c, sg, when));
  if (mode === 'seed') return summary;
  // Stored source cases whose row / signal is gone. A family that was not read (or an empty task list) closes nothing.
  const families = Array.isArray(source.signalFamilies) ? new Set(source.signalFamilies) : null;
  for (const [key, id] of Object.entries(state.seededKeys)) {
    const c = state.cases[id]; if (seen.has(key) || !c) continue;
    const before = JSON.stringify(c);
    if (key.startsWith('task:') && source.tasks.length && !c.factClosed) {
      for (const s of c.steps) if (s.status !== 'done') { s.status = 'done'; s.closedBy = 'source'; }
      Object.assign(c, { factClosed: true, closedReason: '학원 업무 목록에서 이 업무를 찾을 수 없음', closedAt: when, closedBy: 'source' });
      commit(state, c, before, [{ type: 'source.task_closed', label: '학원 업무 목록에서 찾을 수 없어 닫음', at: when, data: { missing: true } }], when, summary);
    } else if (key.startsWith('signal:') && (!families || families.has(c.familyId))) commit(state, c, before, clearSignal(c, when), when, summary);
    else summary.unchanged += 1;
  }
  summary.cleaned = cleaned.count;
  for (const id of cleaned.affected) if (!summary.changes.some(change => change.caseId === id)) {
    summary.changes.push({ caseId: id, title: state.cases[id].title, outcome: 'cleaned', tags: ['사건 기록'], events: [] });
  }
  return summary;
}
export const changedCount = s => s.created + s.updated + s.closed + s.reopened + (s.cleaned || 0);
