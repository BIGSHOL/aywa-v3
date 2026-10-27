// Deterministic deadline urgency from a TRUSTED date (context.requestedActionDate: an
// absence date, invoice due date or requested consultation date taken from a source
// record or form field). Korean relative dates in free text (오늘/내일/다음 주 월요일) are
// NOT parsed here: Jev reads dates as text and a new heuristic parser would be fragile,
// so without a trusted date the deadline stays 'unknown'. A deadline never creates or
// removes work; it only tells an existing task how soon it is due.
import { daysBetween } from './decision-questions.mjs';

export const DEADLINE_RULES_VERSION = 'owner-deadline-d1';
// daysFromToday -> relation. 'this_week' is the rolling next 2..7 days, not the calendar week.
export function relationOf(days) {
  return days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 7 ? 'this_week' : 'future';
}
// Overdue, today and tomorrow all need attention today (e.g. tell the teacher about tomorrow's absence).
const URGENCY = Object.freeze({ overdue: 'today', today: 'today', tomorrow: 'today', this_week: 'this_week', future: 'future' });

export const UNKNOWN_DEADLINE = Object.freeze({ date: null, daysFromToday: null, relation: 'unknown', urgency: 'unknown', source: null, origin: 'rule' });

/** ctx = validated context (validateContext().value). */
export function deriveDeadline(ctx) {
  if (!ctx.requestedActionDate) return UNKNOWN_DEADLINE;
  const days = daysBetween(ctx.today, ctx.requestedActionDate);
  const relation = relationOf(days);
  return Object.freeze({ date: ctx.requestedActionDate, daysFromToday: days, relation, urgency: URGENCY[relation], source: 'requestedActionDate', origin: 'rule' });
}
