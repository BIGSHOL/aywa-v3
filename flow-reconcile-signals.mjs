// Source signals for the re-judging in flow-reconcile.mjs (AX-H1·H4·H5) + the helpers both halves share.
// One step per record owner (FK), renumbered in record order like the hierarchy; owners that leave are retired,
// people's assignments and '확인' stay; FACT_SIGNALS close by handled reports and reopen only for unhandled records.
import { FACT_SIGNALS, HANDLED_OUTCOMES, SIGNAL_DONE_RULE } from './flow-rules.mjs';
import { entityRef, newEvent, ownerKeyOf, refreshCase, signalOwner, step } from './flow-engine.mjs';

const REF_CAP = 50;
export const json = v => JSON.stringify(v ?? null);
export const human = s => s.ruleSource === 'case.reassign' || !!s.ack;
export const reopenStatus = s => (s.ack ? 'working' : 'ready');
export const routeOf = r => ({ assigneeIds: r.assigneeIds, queue: r.queue, rule: r.rule || null, ruleSource: r.ruleSource || null, unassignedReason: r.reason || null });
export const sameRoute = (s, r) => Object.keys(r).every(k => json(s[k]) === json(r[k]));
export const assignees = c => [...new Set(c.steps.filter(s => s.status === 'ready' || s.status === 'working').flatMap(s => s.assigneeIds))];
export const isFactSignal = c => c?.kind === 'source' && !c.taskKind && !!FACT_SIGNALS[c.signalId];


// ── signals ─────────────────────────────────────────────────────────────────────────────────────────
/** Records of a signal grouped by owner (one step per owner, in order of first appearance — the hierarchy uses the same order). */
export function signalGroups(source, sg) {
  const owners = new Map();
  for (const ref of sg.refs) { const r = signalOwner(source, ref), k = ownerKeyOf(r); if (!owners.has(k)) owners.set(k, { key: k, route: routeOf(r), refs: [] }); owners.get(k).refs.push(ref); }
  if (!owners.size) owners.set('queue', { key: 'queue', route: routeOf({ assigneeIds: [], queue: 'manager', reason: sg.signal.recordIds.length ? '근거 기록을 이 업무에 잇지 못해 관리자 대기열' : '이 신호에는 이어 줄 근거 기록이 없어 관리자 대기열' }), refs: [] });
  return [...owners.values()];
}
// A stored step's owner: kept on retirement, else the current owner of its first record still in the source.
const stepKey = (source, s) => s.ownerKey || (!s.refs?.length ? 'queue' : (r => (r ? ownerKeyOf(signalOwner(source, r)) : `gone:${s.id}`))(s.refs.find(k => source.entities.has(k))));
/** Full records per active step id (matched by owner, not position). */
export function stepRecords(source, c) {
  const sg = source.signals.find(x => x.familyId === c.familyId && x.signal.id === c.signalId), out = new Map();
  if (!sg) return out;
  const groups = new Map(signalGroups(source, sg).map(g => [g.key, g.refs]));
  for (const s of c.steps) if (!s.retired && groups.has(stepKey(source, s))) out.set(s.id, groups.get(stepKey(source, s)));
  return out;
}

/** Steps follow the owners of the current records: same owner = same step (renumbered s1..), new owner = new step, gone owner = retired. */
function restructure(source, c, sg) {
  const groups = signalGroups(source, sg), pool = c.steps.map(s => ({ s, key: stepKey(source, s) })), used = new Set(), idMap = new Map(), next = [];
  const tally = { added: [], retired: 0 };
  groups.forEach((g, i) => {
    const hit = pool.find(p => !used.has(p.s) && p.key === g.key && !p.s.retired) || pool.find(p => !used.has(p.s) && p.key === g.key);
    const id = `${c.id}-s${i + 1}`, label = `${sg.signal.title}${g.refs.length ? ` · ${g.refs.length}건` : ''}`;
    let s = hit?.s;
    if (s) { used.add(s); if (s.retired) { delete s.retired; delete s.ownerKey; s.status = reopenStatus(s); } } else { s = step(id, { key: 'source_check', label, role: 'source', evidenceRequired: true }, { ...g.route, reason: g.route.unassignedReason }, 1, { status: 'ready' }); tally.added.push(s); }
    if (s.id !== id) { idMap.set(s.id, id); s.id = id; }
    s.label = label; s.refs = g.refs.slice(0, REF_CAP);
    if (!human(s)) Object.assign(s, g.route);
    next.push(s);
  });
  let r = Math.max(0, ...c.steps.map(s => Number(/-r(\d+)$/.exec(s.id)?.[1] || 0)));
  for (const p of pool) if (!used.has(p.s)) {
    const s = p.s;
    if (!s.retired) { Object.assign(s, { retired: true, ownerKey: p.key, status: 'done', refs: [] }); tally.retired += 1; }
    if (!/-r\d+$/.test(s.id)) { const id = `${c.id}-r${(r += 1)}`; idMap.set(s.id, id); s.id = id; }
    next.push(s);
  }
  c.steps = next;
  for (const e of c.evidence || []) if (idMap.has(e.stepId)) e.stepId = idMap.get(e.stepId);
  return tally;
}

/**
 * Records one report covered: the step's records, narrowed by its record refs (the record itself, its student or
 * its class — the hierarchy's scopes). Other ref types do not narrow; narrowing refs that match none of this step's
 * records cover nothing (never the whole step), so a ref from another step cannot close this one.
 */
export function coveredRefs(source, stepRefs, recordRefs) {
  const types = new Set([...stepRefs.map(k => k.split(':')[0]), 'student', 'class']);
  const want = new Set((recordRefs || []).filter(r => types.has(r.type)).map(r => `${r.type}:${r.id}`));
  if (!want.size) return [...stepRefs];
  const hop = new Map(); for (const r of source.relations) { const k = `${r.from.type}:${r.from.id}`; if (!hop.has(k)) hop.set(k, []); hop.get(k).push(`${r.to.type}:${r.to.id}`); }
  return stepRefs.filter(k => want.has(k) || (hop.get(k) || []).some(x => want.has(x)));
}
// Latest report per record (later wins; at equal times the narrower report wins) — only reports that stored what they covered.
function latestReports(c) {
  const out = new Map();
  for (const e of c.evidence || []) if (Array.isArray(e.coveredRefs)) for (const k of e.coveredRefs) { const cur = out.get(k); if (!cur || e.at > cur.at || (e.at === cur.at && e.coveredRefs.length <= cur.size)) out.set(k, { at: e.at, outcome: e.outcome, size: e.coveredRefs.length }); }
  return out;
}
/** FACT_SIGNALS: a step is done when all its records are handled; the case closes when every step is. Returns events. */
export function settleFact(source, c, { at, origin = 'snapshot', actorId = null } = {}) {
  // Only while the signal is in the source: a cleared case stays as the source left it.
  if (!source.signals.some(x => x.familyId === c.familyId && x.signal.id === c.signalId) || (c.factClosed && c.closedBy !== 'handled')) return [];
  const records = stepRecords(source, c), latest = latestReports(c), out = [];
  let all = true, unhandled = 0, doneAt = null;
  for (const s of c.steps) {
    if (s.retired) continue;
    const refs = records.get(s.id) || [], open = refs.filter(k => !HANDLED_OUTCOMES.includes(latest.get(k)?.outcome));
    unhandled += open.length;
    if (refs.length && !open.length) { s.status = 'done'; s.handled = true; for (const k of refs) if (!doneAt || latest.get(k).at > doneAt) doneAt = latest.get(k).at; } else { all = false; if (s.handled) { delete s.handled; s.status = reopenStatus(s); } }
  }
  if (all && c.closedBy !== 'handled') {
    Object.assign(c, { factClosed: true, closedReason: '담당자가 근거 기록을 모두 처리했다고 보고함', closedAt: doneAt || at, closedBy: 'handled' });
    out.push({ type: 'source.signal_handled', at: doneAt || at, origin, actorId });
  } else if (!all && c.factClosed && c.closedBy === 'handled') {
    Object.assign(c, { factClosed: false, closedReason: null, closedAt: null }); delete c.closedBy;
    out.push({ type: 'source.signal_reopened', label: `처리하지 않은 근거 기록 ${unhandled}건 — 다시 열림`, at, origin, actorId, reopen: true, data: { unhandled } });
  }
  return out;
}

export function reconcileSignal(source, c, sg, at) {
  const out = [], fact = isFactSignal({ ...c, signalId: sg.signal.id, kind: 'source' });
  const cleared = c.factClosed && c.closedBy !== 'handled'; // cleared before, back now (a fact signal may close again as handled below)
  if (cleared) {
    for (const s of c.steps) if (s.closedBy === 'source') { s.status = reopenStatus(s); delete s.closedBy; }
    Object.assign(c, { factClosed: false, closedReason: null, closedAt: null }); delete c.closedBy;
  }
  const keys = [...new Set(sg.refs)].sort(), prev = c.sourceRecords, total = c.entityTotal ?? 0;
  const known = prev || [...new Set([...c.entityRefs.map(r => `${r.type}:${r.id}`), ...c.steps.flatMap(s => s.refs || [])])];
  const added = keys.filter(k => !known.includes(k)).length, removed = known.filter(k => !keys.includes(k)).length;
  const tally = restructure(source, c, sg);
  if (prev ? added || removed : total !== keys.length || removed) out.push({ type: 'source.signal_changed', label: `근거 기록 ${total}건 → ${keys.length}건${prev ? ` · 새 기록 ${added}건 · 빠진 기록 ${removed}건` : ''}`, at, targetActorIds: [...new Set(tally.added.flatMap(s => s.assigneeIds))], data: { from: total, to: keys.length, ...(prev ? { added, removed } : {}), stepsAdded: tally.added.length, stepsRetired: tally.retired } });
  Object.assign(c, { title: sg.signal.title, summary: sg.signal.summary, draft: sg.signal.draft, doneRule: fact ? FACT_SIGNALS[sg.signal.id].doneRule : SIGNAL_DONE_RULE, priority: sg.signal.priority === '결정 필요' ? 'high' : 'normal', entityRefs: sg.refs.slice(0, REF_CAP).map(k => entityRef(source, k)).filter(Boolean), entityTotal: sg.refs.length, sourceRecords: keys });
  if (fact) out.push(...settleFact(source, c, { at }));
  if (cleared && !c.factClosed) out.unshift({ type: 'source.signal_reopened', at, reopen: true });
  return out;
}
export function clearSignal(c, at) {
  if (c.factClosed) return [];
  for (const s of c.steps) if (s.status !== 'done') { s.status = 'done'; s.closedBy = 'source'; }
  Object.assign(c, { factClosed: true, closedReason: '확인 대상에서 빠짐', closedAt: at, closedBy: 'source' });
  return [{ type: 'source.signal_cleared', at }];
}
export function createSignal(state, source, sg, at) {
  const id = `src-sig-${sg.familyId}-${sg.signal.id}`.replace(/[^a-z0-9-]/gi, '-');
  state.cases[id] = { id, kind: 'source', scenario: null, familyId: sg.familyId, title: sg.signal.title, summary: sg.signal.summary, signalId: sg.signal.id, state: 'open', closure: 'fact', origin: 'snapshot', trigger: null, entityRefs: [], entityTotal: 0, steps: [], currentStepId: null, assigneeIds: [], dueAt: null, createdAt: at, updatedAt: at, evidence: [], decision: null, history: [], linkedCaseIds: [], sourceKey: `signal:${sg.familyId}:${sg.signal.id}`, flags: {} };
  const c = state.cases[id];
  reconcileSignal(source, c, sg, at); refreshCase(c);
  const e = newEvent(state, { caseId: id, type: 'source.signal', label: sg.signal.title, origin: 'snapshot', at, targetActorIds: assignees(c), data: { source: sg.signal.source } });
  c.trigger = { eventId: e.id, type: 'source.signal', label: sg.signal.title, actorId: null, at };
}
