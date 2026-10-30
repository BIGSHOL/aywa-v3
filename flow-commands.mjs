// POST /api/flow/actions command layer: strict validation, idempotent commandId, revision check,
// server-side actor eligibility, and the state transitions. AI is only reached through `ai`.
import { scrub } from './domain-snapshot-core.mjs';
import { FAMILY_IDS } from './domain-snapshot.mjs';
import { currentWorkspaceStore } from './workspace-store.mjs'; // the record store of the data now served (refreshed after 2.0 saves)
import { COMMAND_KINDS, COMMAND_ROLES, PRIORITIES, REPORT_OUTCOMES, SCENARIOS, TEMPLATES } from './flow-rules.mjs';
import { actorMap, advance, entityRef, newEvent, refreshCase, resolveRole, step } from './flow-engine.mjs';
import { signalStepRefs } from './flow-hierarchy.mjs';
import { coveredRefs, isFactSignal, settleFact, stepRecords } from './flow-reconcile.mjs';

export class CommandError extends Error { constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; } }
const bad = (message, code = 'invalid_request') => new CommandError(400, code, message);
const TOP = new Set(['commandId', 'expectedRevision', 'actorId', 'kind', 'caseId', 'payload']);
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const keys = (o, allowed) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad('허용하지 않는 항목이 있습니다.'); };
const fingerprint = b => JSON.stringify([b.kind, b.actorId, b.caseId || null, b.payload || {}]);
/** A judgment that did not happen (provider threw, process restarted). The work itself is never dropped. */
export function failedDecision(reason, label = '판정 실패 — 사람 검토') {
  const id = `dec-failed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return { id, status: 'error', route: 'human_review', label, needsReview: true, priority: null, record: { id, provider: 'none', model: null, status: 'error', reason, route: 'human_review', probabilities: null, elapsedMs: 0, usage: null, at: new Date().toISOString() } };
}
async function judged(fn) { try { return await fn(); } catch { return failedDecision('decision_call_failed'); } }

/** Writes a finished judgment onto its case. Routing effects only where the case has not moved past them. */
export function recordDecision(state, c, job, decision, at) {
  delete c.pendingDecision;
  c.decision = decision.record;
  let applied = false;
  if (job.kind === 'route') {
    // The conservative default (review included) is relaxed only while that review has not been
    // routed yet and no person asked for it.
    if (c.steps.some(s => s.when === 'needsReview' && s.status === 'waiting') && c.flags.reviewRequestedBy !== 'report') { c.flags.needsReview = decision.needsReview; applied = true; }
    if (decision.priority && c.state !== 'done') c.priority = decision.priority;
  } else if (decision.needsReview && c.closure !== 'fact') { c.flags.needsReview = true; applied = true; }
  const ev = newEvent(state, { caseId: c.id, type: 'decision.recorded', origin: 'dev', at, actorId: job.actorId, causeId: job.causeId, decisionId: decision.id, label: decision.label, data: { status: decision.status, route: decision.route, applied } });
  refreshCase(c, at);
  return ev;
}

export function validateCommand(body, actors) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('요청 형식이 올바르지 않습니다.');
  for (const k of Object.keys(body)) if (!TOP.has(k)) throw bad('허용하지 않는 항목이 있습니다.');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(body.commandId || '')) throw bad('요청 번호 형식이 올바르지 않습니다.');
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw bad('화면을 새로 불러온 뒤 다시 시도해 주세요.');
  if (!COMMAND_KINDS.includes(body.kind)) throw bad('지원하지 않는 작업입니다.');
  const actor = actors.get(body.actorId);
  if (!actor) throw new CommandError(403, 'actor_not_allowed', '직원 목록에 없는 사람입니다.');
  if (!COMMAND_ROLES[body.kind].includes(actor.role)) throw new CommandError(403, 'action_not_allowed', '이 역할로는 할 수 없는 작업입니다.');
  if (body.caseId !== undefined && !/^[A-Za-z0-9_-]{1,120}$/.test(body.caseId)) throw bad('업무 번호 형식이 올바르지 않습니다.');
  const payload = body.payload ?? {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw bad('요청 내용 형식이 올바르지 않습니다.');
  return { ...body, payload, actor };
}

const assignable = (actors, ids, keep = []) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw bad('담당자는 중복 없이 1~10명이어야 합니다.');
  const current = new Set(keep);
  for (const id of ids) { const a = actors.get(id); if ((!a || a.preview || !a.assignable) && !current.has(id)) throw new CommandError(400, 'assignee_not_allowed', '배정할 수 없는 사람이 있습니다.'); }
  return ids;
};
// 기록 첨부(원장 10-28 "후속 보고 쓰기에 실제 db를 활용해 결과 첨부할 수 있게" · "업무요청에도 실제 db를 활용해 요청가능하게"):
// "영역|기록" 목록을 복사본 DB에서 읽은 작업 공간 기록 저장소에서 다시 찾아, 확인된 값(이름·날짜·상태·칸)만 남긴다. 화면이 보낸 값은 쓰지 않는다.
function attachments(list, max = 20) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > max) throw bad(`첨부 기록은 ${max}건까지 붙일 수 있습니다.`);
  const store = currentWorkspaceStore(); if (!store) throw new CommandError(503, 'records_unavailable', '기록 저장소가 아직 준비되지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
  const out = new Map();
  for (const x of list) {
    const m = typeof x === 'string' ? /^([a-z][a-z-]{0,40})\|([A-Za-z0-9][A-Za-z0-9:._-]{0,99})$/.exec(x) : null;
    if (!m) throw bad('첨부 기록 값이 올바르지 않습니다.');
    const r = store.families.get(m[1])?.records.find(y => y.id === m[2]);
    if (!r) throw new CommandError(400, 'attachment_not_found', '찾을 수 없는 기록입니다.');
    out.set(`${m[1]}|${r.id}`, { familyId: m[1], recordId: r.id, label: r.label, date: r.date || '', status: r.status || '', detail: r.detail || '', fields: (r.fields || []).slice(0, 6) });
  }
  return [...out.values()];
}
function recordRefs(source, list, allowed, max = 20) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > max) throw bad(`연결 기록은 ${max}개까지 붙일 수 있습니다.`);
  return list.map(r => {
    const key = typeof r === 'string' ? r : r && typeof r === 'object' ? `${r.type}:${r.id}` : '';
    if (!/^[a-z_]{2,30}:[A-Za-z0-9:_-]{1,80}$/.test(key) || (allowed && !allowed.has(key))) throw new CommandError(400, 'record_ref_not_allowed', '이 업무와 관련된 기록만 근거로 붙일 수 있습니다.');
    const ref = entityRef(source, key); if (!ref) throw new CommandError(400, 'record_ref_not_allowed', '찾을 수 없는 기록입니다.');
    return ref;
  });
}
const caseRefKeys = (source, c) => { const s = new Set(c.entityRefs.map(r => `${r.type}:${r.id}`)); for (const st of c.steps) for (const k of st.refs || []) s.add(k); for (const k of [...s]) for (const r of source.relations) if (`${r.from.type}:${r.from.id}` === k) s.add(`${r.to.type}:${r.to.id}`); return s; };
// Hierarchy-supported signal cases: the reporting step's full verified refs (the seed stores ≤50) plus one
// FK hop — never another step's records. Every other case keeps caseRefKeys.
const reportRefKeys = (source, c, step) => {
  const full = signalStepRefs(source, c);
  if (!full) return caseRefKeys(source, c);
  const s = new Set(full.get(step.id) || []);
  for (const k of [...s]) for (const r of source.relations) if (`${r.from.type}:${r.from.id}` === k) s.add(`${r.to.type}:${r.to.id}`);
  return s;
};

function pickStep(c, payload, predicate, actor) {
  if (payload.stepId !== undefined && !/^[A-Za-z0-9_-]{1,140}$/.test(payload.stepId)) throw bad('단계 번호 형식이 올바르지 않습니다.');
  const steps = c.steps.filter(s => (!payload.stepId || s.id === payload.stepId) && predicate(s));
  const mine = steps.filter(s => s.assigneeIds.includes(actor.id) || (s.queue === 'manager' && !s.assigneeIds.length && ['manager', 'owner'].includes(actor.role)));
  if (!steps.length) throw new CommandError(409, 'step_not_ready', '지금 처리할 단계가 없습니다.');
  if (!mine.length) throw new CommandError(403, 'not_assignee', '이 단계의 담당자가 아닙니다.');
  return mine[0];
}

/** Applies one validated command to a draft state. Returns { caseId, eventIds }. */
export async function applyCommand(state, source, cmd, { now, inFlight = new Map() }) {
  const at = now(), actors = actorMap(source), { actor, payload } = cmd, ids = [];
  const emit = e => { const ev = newEvent(state, { origin: 'dev', at, actorId: actor.id, ...e }); ids.push(ev.id); return ev; };
  const getCase = () => { const c = state.cases[cmd.caseId]; if (!c) throw new CommandError(404, 'case_not_found', '업무를 찾을 수 없습니다.'); return c; };
  // AI never runs inside this transaction: the request is recorded here and settled after commit.
  const requestDecision = (c, kind, causeId, draft = false) => { const ev = emit({ caseId: c.id, type: 'decision.requested', causeId, data: { kind } }); c.pendingDecision = { id: ev.id, kind, draft, commandId: cmd.commandId, actorId: actor.id, at, causeId: ev.id }; return ev; };
  const local = (fields, steps) => { state.seq += 1; const id = `loc-${state.seq}`; state.cases[id] = { id, closure: 'manual', origin: 'dev', priority: 'normal', state: 'open', trigger: null, entityRefs: [], steps, currentStepId: null, assigneeIds: [], dueAt: null, createdAt: at, updatedAt: at, evidence: [], decision: null, history: [], linkedCaseIds: [], flags: {}, watchers: [actor.id], ...fields }; return state.cases[id]; };

  switch (cmd.kind) {
    case 'request.create': {
      keys(payload, ['title', 'body', 'assigneeIds', 'dueAt', 'priority', 'familyId', 'recordRefs', 'channels', 'source', 'attachments']);
      const atts = attachments(payload.attachments);
      if (!str(payload.title, 1, 80) || !str(payload.body, 1, 2000)) throw bad('제목(80자)과 내용(2,000자)을 입력해 주세요.');
      const who = assignable(actors, payload.assigneeIds);
      if (payload.dueAt !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueAt))) throw bad('기한 날짜 형식이 올바르지 않습니다.');
      if (payload.priority !== undefined && !PRIORITIES.includes(payload.priority)) throw bad('우선순위 값이 올바르지 않습니다.');
      if (payload.familyId !== undefined && !FAMILY_IDS.includes(payload.familyId)) throw bad('연결할 작업 공간이 올바르지 않습니다.');
      if (payload.channels !== undefined && (!Array.isArray(payload.channels) || payload.channels.some(ch => !['app', 'slack'].includes(ch)))) throw bad('알림 채널 값이 올바르지 않습니다.');
      const src = payload.source;
      if (src !== undefined && (!src || typeof src !== 'object' || !['issue', 'workspace', 'chat', 'task', 'direct'].includes(src.kind) || Object.keys(src).some(k => !['kind', 'issueIds', 'signalId', 'actionId', 'label', 'card'].includes(k)) || (src.issueIds && (!Array.isArray(src.issueIds) || src.issueIds.length > 10 || src.issueIds.some(i => !str(i, 1, 60)))) || (src.label !== undefined && !str(src.label, 0, 80)))) throw bad('요청 출처 형식이 올바르지 않습니다.');
      if (src?.card !== undefined) {
        const card = src.card;
        if (src.kind !== 'direct' || !card || typeof card !== 'object' || Array.isArray(card) || Object.keys(card).sort().join(',') !== 'factIds,metric,refs' ||
          !/^[a-z][a-z0-9-]{0,40}$/.test(card.metric || '') || !Array.isArray(card.factIds) || !card.factIds.length || card.factIds.length > 6 ||
          new Set(card.factIds).size !== card.factIds.length || card.factIds.some(id => !/^F-[0-9a-f]{8}$/.test(id)) ||
          !Array.isArray(card.refs) || card.refs.length > 100 || card.refs.some(ref => !ref || typeof ref !== 'object' || Array.isArray(ref) ||
            Object.keys(ref).sort().join(',') !== 'id,type' || !/^[a-z_]{2,30}$/.test(ref.type || '') || !/^[A-Za-z0-9:_-]{1,80}$/.test(ref.id || '')))
          throw bad('카드 분석 출처 형식이 올바르지 않습니다.');
      }
      const refs = recordRefs(source, payload.recordRefs);
      if (src?.card) {
        const factKey = [...src.card.factIds].sort().join('|');
        const existing = Object.values(state.cases).find(c => c.kind === 'request' && c.state !== 'done' && c.requestSource?.card?.metric === src.card.metric &&
          [...(c.requestSource.card.factIds || [])].sort().join('|') === factKey);
        if (existing) return { caseId: existing.id, eventIds: [], duplicate: true };
      }
      const steps = who.map((id, i) => step(`s${i + 1}`, { key: 'assignee_report', label: `${actors.get(id).name} 확인·보고`, role: 'assignee', evidenceRequired: true }, { assigneeIds: [id], queue: null, rule: '요청한 사람이 지정', ruleSource: 'request.create' }, 1));
      steps.push(step(`s${who.length + 1}`, { key: 'manager_review', label: '관리자 검토 후 마감', role: 'manager', review: true }, resolveRole(source, 'manager', []), 2));
      const c = local({ kind: 'request', scenario: null, attachments: atts, familyId: payload.familyId || 'tasks-notifications', title: scrub(payload.title.trim()), summary: scrub(payload.body.trim()), priority: payload.priority || 'normal', dueAt: payload.dueAt || null, entityRefs: refs, channels: payload.channels || ['app'], requestSource: src || { kind: 'direct' } }, steps);
      c.steps.forEach(s => { s.id = `${c.id}-${s.id}`; });
      const trigger = emit({ caseId: c.id, type: 'request.created', targetActorIds: who, data: { channels: c.channels, preview: true } });
      c.trigger = { eventId: trigger.id, type: 'request.created', label: '업무 요청', actorId: actor.id, at };
      ids.push(...advance(state, c, { actorId: actor.id, at, causeId: trigger.id }).map(e => e.id));
      return { caseId: c.id, eventIds: ids };
    }
    case 'event.simulate': {
      keys(payload, ['scenario', 'recordRef']);
      if (!SCENARIOS.includes(payload.scenario)) throw bad('지원하지 않는 시나리오입니다.');
      const tpl = TEMPLATES[payload.scenario], type = { absence: 'attendance', billing: 'invoice', consultation: 'consultation' }[payload.scenario];
      const pool = source.candidates[payload.scenario] || [];
      let id = payload.recordRef === undefined ? null : String(typeof payload.recordRef === 'object' ? payload.recordRef?.id : payload.recordRef).replace(/^[a-z_]+:/, '');
      if (id && !pool.includes(id)) throw new CommandError(400, 'record_ref_not_allowed', '이 시나리오에 쓸 수 있는 실제 기록이 아닙니다.');
      if (!id) id = (actor.role === 'teacher' && pool.find(x => source.entities.get(`class:${source.entities.get(`${type}:${x}`)?.classId}`)?.teacherId === actor.id)) || pool[0];
      if (!id) throw new CommandError(409, 'no_source_record', '시나리오에 쓸 실제 기록이 없습니다.');
      const key = `${type}:${id}`;
      const dup = Object.values(state.cases).find(c => c.kind === 'scenario' && c.scenario === payload.scenario && c.scenarioKey === key && c.state !== 'done');
      if (dup) return { caseId: dup.id, eventIds: [], duplicate: true };
      const refs = [key, ...source.relations.filter(r => `${r.from.type}:${r.from.id}` === key).map(r => `${r.to.type}:${r.to.id}`)].map(k => entityRef(source, k)).filter(Boolean);
      const steps = tpl.steps.map((def, i) => step(`s${i + 1}`, def, resolveRole(source, def.role, [key]), i + 1));
      const c = local({ kind: 'scenario', scenario: payload.scenario, scenarioKey: key, familyId: tpl.familyId, title: `${tpl.title} — ${refs.find(r => r.type === 'student')?.label || refs[0].label}`, summary: `${refs[0].label} 기록으로 만든 연습 시나리오입니다. 학원 기록은 그대로 유지됩니다.`, entityRefs: refs }, steps);
      c.steps.forEach(s => { s.id = `${c.id}-${s.id}`; });
      const trigger = emit({ caseId: c.id, type: tpl.trigger, data: { scenario: payload.scenario, record: key } });
      c.trigger = { eventId: trigger.id, type: tpl.trigger, label: trigger.label, actorId: actor.id, at };
      c.flags.needsReview = true; // until the judgment arrives, keep the review step
      const req = requestDecision(c, 'route', trigger.id);
      ids.push(...advance(state, c, { actorId: actor.id, at, causeId: req.id }).map(e => e.id));
      return { caseId: c.id, eventIds: ids, job: c.pendingDecision };
    }
    case 'case.ack': {
      keys(payload, ['stepId']);
      const c = getCase(), s = pickStep(c, payload, x => x.status === 'ready' && !x.review, actor);
      const claimed = !s.assigneeIds.length;
      if (claimed) s.assigneeIds = [actor.id];
      s.status = 'working'; s.ack = { actorId: actor.id, claimed };
      emit({ caseId: c.id, type: 'step.acknowledged', stepId: s.id, targetActorIds: c.watchers || [], causeId: c.history.at(-1) });
      refreshCase(c, at); return { caseId: c.id, eventIds: ids };
    }
    // 잘못 누른 '확인'을 되돌린다(검수 10-28 H4 — 누르는 즉시 저장되는데 되돌릴 길이 없었다). 확인한 본인만, 보고 전(진행 중)에만.
    // 확인하면서 맡은 단계(담당이 비어 있던 단계)는 담당도 비운다.
    case 'case.unack': {
      keys(payload, ['stepId']);
      const c = getCase(), s = pickStep(c, payload, x => x.status === 'working' && !x.review && x.ack?.actorId === actor.id, actor);
      if (s.ack.claimed) s.assigneeIds = [];
      s.status = 'ready'; delete s.ack;
      emit({ caseId: c.id, type: 'step.unacknowledged', stepId: s.id, targetActorIds: c.watchers || [], causeId: c.history.at(-1) });
      refreshCase(c, at); return { caseId: c.id, eventIds: ids };
    }
    case 'case.report': {
      keys(payload, ['stepId', 'note', 'recordRefs', 'outcome', 'attachments']);
      const atts = attachments(payload.attachments);
      // 사실이 남는 신호(FACT_SIGNALS)는 처리한 단계에도 다시 보고할 수 있다 — 고쳐 보고(검토 필요 등)하면 그 기록이 다시 열린다.
      const c = getCase(), fact = isFactSignal(c);
      const s = pickStep(c, payload, x => !x.review && !x.retired && (x.status === 'ready' || x.status === 'working' || (fact && x.status === 'done' && x.handled && c.closedBy !== 'source')), actor);
      if (!str(payload.note, 2, 2000)) throw new CommandError(400, 'evidence_required', '처리 결과를 2자 이상 적어 주세요.');
      if (payload.outcome !== undefined && !REPORT_OUTCOMES[payload.outcome]) throw bad('결과 값이 올바르지 않습니다.');
      // A hierarchy student cell sends all of its records (one class, real max 18): 60 there, 20 everywhere else.
      const refs = recordRefs(source, payload.recordRefs, reportRefKeys(source, c, s), signalStepRefs(source, c) ? 60 : 20);
      const evidence = { id: `ev-${state.seq + 1}`, note: scrub(payload.note.trim()), recordRefs: refs, actorId: actor.id, at, stepId: s.id, outcome: payload.outcome || 'done', ...(atts.length ? { attachments: atts } : {}) };
      if (fact) {
        // AX-H4: the report stays on this case and records what it covered (this step's records at this moment,
        // narrowed by its record refs); the case closes when every record is handled. Source records are not touched.
        c.evidence.push({ ...evidence, coveredRefs: coveredRefs(source, stepRecords(source, c).get(s.id) || [], refs) });
        let cause = emit({ caseId: c.id, type: 'step.reported', stepId: s.id, causeId: c.history.at(-1), data: { outcome: evidence.outcome, covered: c.evidence.at(-1).coveredRefs.length } });
        for (const e of settleFact(source, c, { at, origin: 'dev', actorId: actor.id })) cause = emit({ caseId: c.id, type: e.type, label: e.label, causeId: cause.id, data: e.data || null, targetActorIds: e.reopen ? [...new Set(c.steps.filter(x => x.status === 'ready' || x.status === 'working').flatMap(x => x.assigneeIds))] : c.watchers || [] });
        refreshCase(c, at); return { caseId: c.id, eventIds: ids };
      }
      if (c.closure === 'fact') {
        // Source facts never close locally: the report becomes a linked local follow-up case.
        const f = local({ kind: 'request', scenario: null, familyId: c.familyId, title: `${c.title} — 후속 보고`, summary: `${c.doneRule || '관련 기록의 처리 상태가 확인되면 업무가 닫힙니다.'} 이 보고는 따로 남는 후속 기록입니다.`, entityRefs: c.entityRefs.slice(0, 10), linkedCaseIds: [c.id], evidence: [evidence] }, [step('f1', { key: 'followup_report', label: '후속 보고', role: 'source', evidenceRequired: true }, { assigneeIds: [actor.id], queue: null, rule: '원래 업무 담당', ruleSource: 'staff_task_assignees.user_id' }, 1, { status: 'done' })]);
        f.steps[0].id = `${f.id}-f1`; c.linkedCaseIds.push(f.id); c.evidence.push({ ...evidence, followupCaseId: f.id });
        const linked = emit({ caseId: c.id, type: 'followup.linked', stepId: s.id, data: { followupCaseId: f.id } });
        emit({ caseId: f.id, type: 'step.reported', stepId: f.steps[0].id, causeId: linked.id });
        ids.push(...advance(state, f, { actorId: actor.id, at, causeId: linked.id }).map(e => e.id));
        refreshCase(c, at); return { caseId: f.id, eventIds: ids };
      }
      s.status = 'done'; if (!s.assigneeIds.length) s.assigneeIds = [actor.id]; c.evidence.push(evidence);
      if (['needs_review', 'unreachable'].includes(evidence.outcome)) { c.flags.needsReview = true; c.flags.reviewRequestedBy = 'report'; }
      const r = emit({ caseId: c.id, type: 'step.reported', stepId: s.id, causeId: c.history.at(-1), data: { outcome: evidence.outcome } });
      ids.push(...advance(state, c, { actorId: actor.id, at, causeId: r.id }).map(e => e.id));
      return { caseId: c.id, eventIds: ids };
    }
    case 'case.review': {
      keys(payload, ['stepId', 'decision', 'note']);
      if (!['accept', 'return'].includes(payload.decision)) throw bad('검토 결정은 승인 또는 보완 요청만 선택할 수 있습니다.');
      if (payload.note !== undefined && !str(payload.note, 0, 2000)) throw bad('메모는 2,000자까지 쓸 수 있습니다.');
      const c = getCase(); if (c.closure === 'fact') throw new CommandError(409, 'fact_case', c.doneRule || '관련 기록의 처리 상태가 확인되면 업무가 닫힙니다.');
      const s = pickStep(c, payload, x => x.status === 'ready' && x.review, actor);
      if (payload.decision === 'return') {
        if (!str(payload.note, 2, 2000)) throw new CommandError(400, 'evidence_required', '보완 요청 사유를 적어 주세요.');
        const lastGroup = Math.max(0, ...c.steps.filter(x => x.group < s.group && !x.skipped).map(x => x.group));
        const prev = c.steps.filter(x => x.group === lastGroup && !x.skipped);
        for (const p of prev) p.status = 'ready';
        s.status = 'waiting';
        const ev = emit({ caseId: c.id, type: 'step.returned', stepId: s.id, targetActorIds: [...new Set(prev.flatMap(p => p.assigneeIds))], causeId: c.history.at(-1), data: { note: scrub(payload.note.trim()) } });
        c.evidence.push({ id: `ev-${ev.id}`, note: scrub(payload.note.trim()), recordRefs: [], actorId: actor.id, at, stepId: s.id, outcome: 'returned' });
        refreshCase(c, at); return { caseId: c.id, eventIds: ids };
      }
      s.status = 'done'; if (!s.assigneeIds.length) s.assigneeIds = [actor.id];
      if (payload.note) c.evidence.push({ id: `ev-${state.seq + 1}`, note: scrub(payload.note.trim()), recordRefs: [], actorId: actor.id, at, stepId: s.id, outcome: 'accepted' });
      const r = emit({ caseId: c.id, type: 'step.reviewed', stepId: s.id, causeId: c.history.at(-1) });
      ids.push(...advance(state, c, { actorId: actor.id, at, causeId: r.id }).map(e => e.id));
      return { caseId: c.id, eventIds: ids };
    }
    case 'case.reassign': {
      keys(payload, ['stepId', 'assigneeIds']);
      const c = getCase();
      const s = c.steps.find(x => (payload.stepId ? x.id === payload.stepId : true) && (x.status === 'ready' || x.status === 'working'));
      if (!s) throw new CommandError(409, 'step_not_ready', '담당을 변경할 남은 단계가 없습니다.');
      const original = c.sourceKey?.startsWith('task:') ? source.tasks?.find(t => `task:${t.id}` === c.sourceKey)?.assigneeIds || [] : [];
      const who = assignable(actors, payload.assigneeIds, [...s.assigneeIds, ...original]);
      const from = s.assigneeIds; s.assigneeIds = who; s.queue = null; delete s.ack; s.unassignedReason = null; s.status = 'ready'; s.rule = '관리자가 직접 다시 지정'; s.ruleSource = 'case.reassign';
      emit({ caseId: c.id, type: 'step.reassigned', stepId: s.id, targetActorIds: who, causeId: c.history.at(-1), data: { from, to: who } });
      refreshCase(c, at); return { caseId: c.id, eventIds: ids };
    }
    case 'case.reopen': {
      keys(payload, ['note']);
      const c = getCase(); if (c.closure === 'fact') throw new CommandError(409, 'fact_case', '관련 기록의 처리 상태에 따라 닫힌 업무는 여기서 다시 열 수 없습니다.');
      if (c.state !== 'done') throw new CommandError(409, 'not_done', '완료된 업무만 다시 열 수 있습니다.');
      if (!str(payload.note, 2, 2000)) throw new CommandError(400, 'evidence_required', '다시 여는 사유를 적어 주세요.');
      const last = Math.max(...c.steps.filter(x => !x.skipped).map(x => x.group));
      for (const x of c.steps.filter(y => y.group === last && !y.skipped)) x.status = 'ready';
      emit({ caseId: c.id, type: 'case.reopened', targetActorIds: c.assigneeIds, causeId: c.history.at(-1), data: { note: scrub(payload.note.trim()) } });
      refreshCase(c, at); return { caseId: c.id, eventIds: ids };
    }
    case 'case.analyze': {
      keys(payload, ['draft']);
      const c = getCase();
      if (c.pendingDecision && inFlight.has(c.pendingDecision.id)) return { caseId: c.id, eventIds: [], duplicate: true, pending: true };
      requestDecision(c, 'analyze', c.history.at(-1), payload.draft === true);
      refreshCase(c, at); return { caseId: c.id, eventIds: ids, job: c.pendingDecision };
    }
    default: throw bad('지원하지 않는 작업입니다.');
  }
}

const DECISION_STATE = { decided: 'ok', review_needed: 'ok', unavailable: 'unavailable', error: 'error', cancelled: 'skipped' };

/**
 * Idempotent, revision-checked execution. Phase 1 (serialized write) validates and commits the
 * command; a judgment it asked for runs afterwards outside the write queue, and a second write
 * settles it on the case. The caller waits up to waitMs for that, otherwise gets decisionPending.
 */
export async function runCommand(store, sourceOf, body, { ai, now = () => new Date().toISOString(), jobs = new Map(), waitMs = 1500 }) {
  // sourceOf = the current source (a getter, so a command queued behind reloadSource runs on the reloaded facts).
  const current = typeof sourceOf === 'function' ? sourceOf : () => sourceOf;
  const actors = actorMap(current());
  const cmd = validateCommand(body, actors);
  // The job is registered inside the write, so no later command can see its request as abandoned.
  let settle = null, registered = null;
  const done = new Promise(r => { settle = r; });
  const first = await store.transact(async draft => {
    const seen = draft.commands[cmd.commandId];
    if (seen) {
      if (seen.fingerprint !== fingerprint(cmd)) throw new CommandError(409, 'command_conflict', '같은 요청이 다른 내용으로 이미 처리되었습니다.');
      return { next: null, result: { result: { ...seen.result, replayed: true }, job: null } };
    }
    if (cmd.expectedRevision !== draft.revision) throw new CommandError(409, 'revision_conflict', '다른 사람이 먼저 바꿨습니다. 화면을 새로 불러온 뒤 다시 시도해 주세요.', { revision: draft.revision });
    const out = await applyCommand(draft, current(), cmd, { now, inFlight: jobs });
    if (!out.duplicate) draft.revision += 1; // a duplicate changes nothing but the command log
    const result = { revision: draft.revision, caseId: out.caseId, eventIds: out.eventIds, ...(out.duplicate ? { duplicate: true } : {}), ...(out.job || out.pending ? { decision: 'pending' } : {}) };
    draft.commands[cmd.commandId] = { fingerprint: fingerprint(cmd), result, at: now() };
    if (out.job) { registered = out.job.id; jobs.set(registered, done); }
    return { next: draft, result: { result, job: out.job ? { ...out.job, caseId: out.caseId } : null } };
  }).catch(error => { if (registered) { jobs.delete(registered); settle(null); } throw error; });
  if (!first.job) return first.result;
  const job = first.job;
  settleDecision(store, current(), job, { ai, now }).then(settle, () => settle(null)).finally(() => jobs.delete(job.id));
  let timer;
  const final = await Promise.race([done, new Promise(r => { timer = setTimeout(r, waitMs, null); })]);
  clearTimeout(timer);
  return final || first.result;
}

async function settleDecision(store, source, job, { ai, now }) {
  const committed = store.state.cases[job.caseId];
  if (!committed) return null;
  const c = structuredClone(committed);
  const decision = await judged(() => job.kind === 'route' ? ai.route(c, source) : ai.analyze(c, source, { draft: job.draft }));
  return store.transact(async draft => {
    const cur = draft.cases[job.caseId];
    if (!cur || cur.pendingDecision?.id !== job.id) return { next: null, result: null }; // superseded meanwhile
    const ev = recordDecision(draft, cur, job, decision, now());
    draft.revision += 1;
    const entry = draft.commands[job.commandId];
    const result = { revision: draft.revision, caseId: cur.id, eventIds: [...(entry?.result.eventIds || []), ev.id], decision: DECISION_STATE[decision.status] || 'error' };
    if (entry) entry.result = result;
    return { next: draft, result };
  });
}
