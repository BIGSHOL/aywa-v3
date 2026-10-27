// GET /api/flow/hierarchy body: the FK tree plus each node's AI state from the overlay. Read-only.
// A node always shows its code facts; AI fields appear only from a validated stored result, and a
// result made for older evidence is marked stale. Nothing is hidden: a lowered priority stays visible.
import { ATTENTION_LABEL, ORDER_LABEL, POLICY_VERSION, STAGES, attentionOf, policyFingerprint, renderText } from './flow-hierarchy-ai.mjs';
import { modelLabel } from './flow-view.mjs';

const ERROR = { no_key: '판정 키가 설정되지 않음', timeout: '응답 시간 초과', rate_limited: '사용 한도에 걸림', overloaded: '서버 혼잡', network: '연결 실패', http_error: '서버 오류', auth: '판정 키 인증 실패',
  auth_required: 'Claude 구독 로그인이 필요함', subscription_required: 'Claude 구독 로그인으로만 실행함', cli_missing: 'Claude CLI를 찾지 못함', runtime_unsafe: 'Claude 실행 폴더가 안전하지 않음', cli_failed: 'Claude 실행 실패',
  invalid_output: '출력이 검사에서 걸려 보여 주지 않음', invalid_response: '판정 답 형식 오류', request_rejected: '요청이 거절됨', busy: '대기열이 가득 참', cancelled: '중단됨', failed: '처리 실패' };
const ISSUE = { number_in_text: '숫자를 직접 씀(숫자는 코드 집계)', unknown_id: '입력에 없는 대상 언급', banned_claim: '사유·위험 단정 표현', raw_code: '영어 코드 노출', evidence_outside_input: '보내지 않은 근거 인용', teacher_set: '강사 누락·중복', class_set: '반 누락·중복', schema: '형식 오류' };
const errorReason = r => [ERROR[r.code] || '처리 실패', ...(r.issues || []).map(i => ISSUE[i] || '검사 실패')].join(' · ');
const PROVIDER = { jev: 'Jev 판정', 'claude-cli': 'Claude 요약' };

/** Status + stale + the result to show (current, or the last good one for older evidence). */
function state(p, entry, opts, waitingReason) {
  const cur = entry.result?.status === 'ready' ? entry.result : null;
  const prev = !cur && entry.last && p.results[entry.last]?.status === 'ready' ? p.results[entry.last] : null;
  const shown = cur || prev, base = { stale: !!prev };
  if (entry.skip === 'reported') return { shown: null, ai: { status: 'skipped', stale: false, reason: '보고 완료 — AI 판단을 생략함' } };
  if (entry.skip === 'review') return { shown: null, ai: { status: 'review_needed', stale: false, reason: '담당자가 관리자 검토를 요청함 — 사람이 판단' } };
  if (cur) return { shown, ai: { status: 'ready', ...base } };
  if (entry.job) return { shown, ai: { status: entry.job.status === 'running' ? 'running' : 'queued', ...base, ...(entry.job.blocked === 'budget' ? { reason: '이 PC의 시간당 호출 한도로 대기' } : {}) } };
  if (entry.result?.status === 'error') return { shown, ai: { status: 'error', ...base, reason: errorReason(entry.result) } };
  if (!opts.enabled) return { shown, ai: { status: prev ? 'stale' : 'not_started', ...base, reason: opts.disabledReason || '자동 분석이 꺼져 있음' } };
  if (entry.waiting) return { shown, ai: { status: prev ? 'stale' : 'queued', ...base, reason: waitingReason } };
  return { shown, ai: { status: prev ? 'stale' : 'not_started', ...base } };
}
// Claude text is a draft for a person to check; it carries no numbers (counts and dates are the code facts).
const meta = r => ({ ...(r.provider === 'claude-cli' ? { draft: true, note: 'AI 초안 — 건수·날짜는 코드 집계를 보세요' } : {}), origin: r.provider, provider: PROVIDER[r.provider] || null, model: r.model, modelLabel: modelLabel(r.model), effort: r.effort ?? null, tier: r.tier || null, partial: !!r.partial, updatedAt: r.at || null });

export function decorate(p, opts) {
  const { tree, index, alias } = p;
  const studentNodes = sid => [...index.nodes.values()].filter(n => n.level === 'student' && n.entityRef.id === sid);
  const labelOf = ref => { const id = alias.reverse(ref); if (!id) return null; if (ref[0] === 'S') return studentNodes(id)[0]?.label || null; return index.nodes.get(id)?.label || null; };
  const text = v => renderText(v, labelOf);
  const evidence = (refs, scope) => [...new Set(refs.flatMap(ref => { const id = alias.reverse(ref); if (!id) return []; if (ref[0] !== 'S') return index.nodes.has(id) ? [id] : [];
    return studentNodes(id).filter(n => !scope || n.id.startsWith(`${scope}/`) || scope.split(',').some(c => n.id.startsWith(`${c}/`))).map(n => n.id); }))];
  const block = b => ({ summary: text(b.summary), reasons: b.reasons.map(text), suggestedAction: b.suggestedAction ? { title: text(b.suggestedAction.title), body: text(b.suggestedAction.body) } : null });
  const tally = { completed: 0, running: 0, pending: 0, failed: 0, skipped: 0, stale: 0, reviewNeeded: 0 };
  const count = ai => { if (ai.status === 'ready') tally.completed += 1; else if (ai.status === 'running') tally.running += 1; else if (ai.status === 'queued') tally.pending += 1; else if (ai.status === 'error') tally.failed += 1; else if (ai.status === 'skipped') tally.skipped += 1; else if (ai.status === 'review_needed') tally.reviewNeeded += 1; if (ai.stale) tally.stale += 1; };

  // Students: one Jev leaf per unique student, shared by every class node of that student.
  for (const l of p.leaves.values()) {
    const { shown, ai } = state(p, l, opts, '판정 대기 중');
    if (shown) {
      const o = shown.output, a = attentionOf(o.managerAttention);
      Object.assign(ai, { priority: o.priority, priorityLabel: ORDER_LABEL[o.priority], deprioritized: o.priority === 'routine', uncertain: !!o.uncertain, contradiction: !!o.contradiction,
        managerAttention: a, managerAttentionLabel: ATTENTION_LABEL[a], probabilities: { checkOrder: o.probabilities, checkOrderConcentration: o.confidence, managerAttention: o.managerAttention, note: '모델 추정값이며 측정된 정확도가 아닙니다.' },
        reasons: [`Jev 확인 순서: ${ORDER_LABEL[o.priority]}`, `Jev 관리자 확인: ${ATTENTION_LABEL[a]}`, ...(o.uncertain ? ['확인 순서 판정이 애매하거나 기록 사실과 어긋남 — 사람 확인'] : [])], evidenceIds: l.nodes.map(n => n.id), ...meta(shown) });
      if (ai.status === 'ready' && o.uncertain) ai.status = 'review_needed';
    }
    count(ai);
    for (const n of l.nodes) n.ai = { ...ai };
  }
  // Teachers and their classes: one Claude batch item per teacher (class lines come from the same item).
  for (const t of p.teachers.values()) {
    const { shown, ai } = state(p, t, opts, '원생 판정을 기다리는 중');
    if (shown) {
      const o = shown.output, scope = t.tn.children.map(c => c.id).join(',');
      Object.assign(ai, block(o), { attention: o.attention, attentionLabel: o.attention === 'manager' ? '관리자도 확인' : '담임 확인', evidenceIds: evidence(o.evidenceIds, scope), ...meta(shown) });
      for (const cn of t.tn.children) { const c = o.classes.find(x => alias.reverse(x.id) === cn.id);
        // A current answer always covers every class (validated); only an older answer can lack a class.
        cn.ai = c ? { status: ai.status, stale: ai.stale, summary: text(c.summary), evidenceIds: evidence(c.evidenceIds, cn.id), ...meta(shown) } : { status: ai.status, stale: true, reason: '이전 요약에 없던 반 — 새 요약을 기다리는 중' }; }
    } else for (const cn of t.tn.children) cn.ai = { status: ai.status, stale: false, ...(ai.reason ? { reason: ai.reason } : {}) };
    count(ai);
    t.tn.ai = ai;
  }
  const { shown, ai } = state(p, p.academy, opts, '강사 요약을 기다리는 중');
  count(ai);
  const summary = (key, facts) => (shown ? { ...ai, ...block(shown.output[key]), evidenceIds: evidence(shown.output[key].evidenceIds), ...meta(shown), facts } : { ...ai, facts });
  tree.root.ai = { ...ai };
  const f = tree.root.facts;
  const anyQueued = tally.running + tally.pending > 0;
  const tier = s => ({ model: STAGES[s].tiers.base.model, effort: STAGES[s].tiers.base.effort, escalated: STAGES[s].tiers.escalated });
  return {
    ...tree,
    managerSummary: summary('manager', { origin: 'code', managerQueueRecords: f.managerQueueRecords, managerQueueTeachers: f.managerQueueTeachers, studentsByFlowState: f.studentsByFlowState }),
    ownerSummary: summary('owner', { origin: 'code', students: tree.counts.students, classes: tree.counts.classes, teachers: tree.counts.teachers, records: tree.counts.records }),
    analysis: {
      status: !opts.enabled ? 'disabled' : anyQueued ? 'running' : ai.status === 'ready' && !tally.failed ? 'complete' : tally.failed ? 'partial' : 'idle',
      revision: opts.analysisRevision, version: opts.version, updatedAt: opts.updatedAt, ...tally, transport: opts.transport,
      policy: { version: POLICY_VERSION, fingerprint: policyFingerprint(), stages: [
        { stage: 'student', label: '원생 판정(원생마다 1회)', provider: 'Jev', model: STAGES.student.model, effort: null, concurrency: STAGES.student.concurrency },
        { stage: 'teacher', label: '강사·반 요약(강사 묶음 1회)', provider: 'Claude CLI(구독)', ...tier('teacher'), batchTeachers: STAGES.teacher.batchTeachers, batchStudents: STAGES.teacher.batchStudents, concurrency: STAGES.teacher.concurrency },
        { stage: 'academy', label: '관리자·원장 요약', provider: 'Claude CLI(구독)', ...tier('academy') }] },
      budget: { jevPerHour: opts.budget.jevPerHour, claudePerHour: opts.budget.claudePerHour, jevUsedLastHour: opts.budget.jevUsedLastHour, claudeUsedLastHour: opts.budget.claudeUsedLastHour },
    },
  };
}
