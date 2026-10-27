// Deterministic routing policy over validated Jev answers.
// Thresholds are conservative starting points (docs: 0.7 yes / 0.3 no), NOT
// calibrated on this domain. Missing required work is the expensive error, so the
// automatic "no action" band is narrower than the docs' default and money or
// personnel matters always go to a person. Assignees come only from caller-supplied
// candidates (DB relationships); Jev never names or invents a person.
export const RULES_VERSION = 'owner-decision-r2';
export const THRESHOLDS = Object.freeze({
  actionYes: 0.7,        // p(open task) at or above: work exists
  actionNo: 0.2,         // p(open task) at or below: automatic no-action (narrower than the docs' 0.3)
  contextMin: 0.5,       // p(context sufficient) below: ask for missing context
  areaConfidenceMin: 0.5,
  secondAreaMax: 0.5,    // p(second task in another area) at or above: a person splits the work
  managerMin: 0.3,       // p(needs manager) at or above: manager review (missing it is costly)
  safetyMin: 0.3,        // p(safety/legal concern) at or above: manager review, high recall
  urgentConfidence: 0.5, // urgency=today at this confidence contradicts "no action"
  noActionAreaConflict: 0.6, // an area other than none/unclear at this confidence contradicts "no action"
});
// Priority order. Granular relationship roles first; generic flow roles (teacher/staff) last.
export const AREA_ROLES = Object.freeze({
  attendance: ['homeroom_teacher', 'subject_teacher', 'desk', 'staff'],
  billing: ['billing', 'desk', 'staff'],
  academic: ['subject_teacher', 'homeroom_teacher', 'teacher'],
  counseling: ['homeroom_teacher', 'subject_teacher', 'manager'],
  enrollment: ['desk', 'staff', 'manager'],
  schedule: ['desk', 'staff', 'manager'],
  operations: ['desk', 'staff', 'manager'],
  staff_hr: ['manager', 'owner'],
});
const MANAGER_ROLES = ['manager', 'owner'];
// Evidence: an automatic route needs the DB relationship that lets code find the right person.
const REQUIRED_LINKS = Object.freeze({ attendance: [['student']], academic: [['student'], ['class']], billing: [['student'], ['invoice']], counseling: [['student']] });
const ALWAYS_MANAGER = new Set(['staff_hr']);
const MAX_ASSIGNEES = 3;

/** Highest-priority role that has candidates; all candidates at that level, sorted for determinism. */
export function pickAssignees(candidates, roles) {
  for (const role of roles) {
    const matches = candidates.filter(c => c.roles.includes(role)).map(c => c.staffId).sort();
    if (matches.length) return [...new Set(matches)].slice(0, MAX_ASSIGNEES).map(staffId => ({ staffId, role, origin: 'rule' }));
  }
  return [];
}

const linked = (links, area) => !REQUIRED_LINKS[area] || REQUIRED_LINKS[area].some(group => group.every(k => links[k] === true));
const reason = (code, origin = 'rule') => ({ code, origin });

/**
 * answers: validated Jev answers for QUESTIONS. Returns { status, route, assignees, reasons, claudeRecommended }.
 * status 'decided' only for auto_route and no_action; everything else needs a person.
 * Code guards win over the model: known unresolved facts, urgency and safety signals never end as no_action.
 */
export function applyPolicy(answers, ctx, t = THRESHOLDS) {
  const pAction = answers.action_needed.probability;
  const area = answers.work_area;
  const pContext = answers.context_sufficient.probability;
  const pManager = answers.manager_review.probability;
  const pSecond = answers.second_area.probability;
  const pSafety = answers.safety_concern.probability;
  const urgentToday = answers.urgency.choice === 'today' && answers.urgency.confidence >= t.urgentConfidence;
  const known = ctx.knownOpenWork.length > 0;
  const review = (route, codes, assignees = []) => ({ status: 'review_needed', route, assignees, reasons: codes.map(c => reason(c)), claudeRecommended: true });
  const toManager = codes => { const m = pickAssignees(ctx.candidates, MANAGER_ROLES); return m.length ? review('manager_review', codes, m) : review('human_review', [...codes, 'no_eligible_manager']); };

  if (pSafety >= t.safetyMin) return toManager(['safety_signal', ...(known ? ['known_open_work_guard'] : [])]);
  if (pAction <= t.actionNo) {
    const conflicts = [
      ...(!['none', 'unclear'].includes(area.choice) && area.confidence >= t.noActionAreaConflict ? ['signals_conflict_no_action_vs_area'] : []),
      ...(pManager >= t.managerMin ? ['signals_conflict_no_action_vs_manager'] : []),
      ...(urgentToday ? ['signals_conflict_no_action_vs_urgency'] : []),
      ...(known ? ['known_open_work_guard'] : []),
    ];
    if (conflicts.length) return review('human_review', conflicts);
    return { status: 'decided', route: 'no_action', assignees: [], reasons: [reason('no_open_task', 'jev')], claudeRecommended: false };
  }
  if (pAction < t.actionYes) return review('human_review', ['uncertain_action', ...(known ? ['known_open_work_guard'] : [])]);
  const multiple = pSecond >= t.secondAreaMax;
  const missing = pContext < t.contextMin ? ['context_insufficient'] : area.choice === 'unclear' ? ['area_unclear'] : [];
  // r2: a manager decision outranks missing context (the manager can ask back); it used to end in insufficient_context.
  if (pManager >= t.managerMin || ALWAYS_MANAGER.has(area.choice)) {
    return toManager([ALWAYS_MANAGER.has(area.choice) ? 'personnel_always_reviewed' : 'manager_review_signal', ...(multiple ? ['multiple_areas'] : []), ...missing]);
  }
  if (missing.length) return review('insufficient_context', missing);
  if (area.choice === 'none') return review('human_review', ['signals_conflict_action_vs_area_none']);
  if (area.confidence < t.areaConfidenceMin) return review('human_review', ['uncertain_area']);
  if (multiple) return review('human_review', ['multiple_areas']);
  if (!linked(ctx.links, area.choice)) return review('human_review', ['missing_link']);
  const assignees = pickAssignees(ctx.candidates, AREA_ROLES[area.choice] ?? []);
  if (!assignees.length) return review('human_review', ['no_eligible_staff']);
  return { status: 'decided', route: 'auto_route', assignees, reasons: [reason('auto_route_thresholds_met')], claudeRecommended: false };
}
