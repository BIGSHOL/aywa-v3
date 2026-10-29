// 업무 흐름의 '지난 업무'·'담당 미지정' 판정 한 벌. 서버 응답과 카드 분석이 함께 쓴다.
const KST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const zoned = d => d.length > 10 && /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(d) && Number.isFinite(Date.parse(d));
export const flowKstDate = at => {
  const d = String(at || '');
  if (!zoned(d)) return d.slice(0, 10);
  const p = Object.fromEntries(KST.formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
export const activeFlowSteps = c => c.state === 'done' ? [] : (c.steps || []).filter(s => !s.skipped && ['ready', 'working', 'review'].includes(s.status));
export const flowCaseLate = (c, asOf) => !!(c.state !== 'done' && c.dueAt && flowKstDate(c.dueAt) < String(asOf || '').slice(0, 10));
export const flowCaseUnassigned = c => activeFlowSteps(c).some(s => !(s.assigneeIds || []).length && (!s.queue || Boolean(s.unassignedReason)));
export const flowCaseFlags = (c, asOf) => ({ late: flowCaseLate(c, asOf), unassigned: flowCaseUnassigned(c) });

// 첫 화면의 담당별 내 차례와 원본 업무 단계 수. 요약·전체 응답이 이 결과를 함께 쓴다.
export function flowFirstScreen(cases, actors, asOf, caseFlagsById = null) {
  const flags = c => caseFlagsById?.get(c.id) ?? flowCaseFlags(c, asOf);
  const stages = Object.fromEntries(['open', 'working', 'review', 'done'].map(state => [state, cases.filter(c => c.origin !== 'dev' && c.state === state).length]));
  const inboxByActor = Object.fromEntries(actors.map(actor => [actor.id, cases.filter(c => {
    const steps = activeFlowSteps(c);
    const mine = steps.some(s => (s.assigneeIds || []).includes(actor.id) || ['owner', 'manager'].includes(actor.role) && s.queue === 'manager' && !(s.assigneeIds || []).length);
    return mine || actor.role === 'manager' && flags(c).unassigned;
  }).length]));
  return { stages, inboxByActor };
}
