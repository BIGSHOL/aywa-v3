// Display sanitization for the local dev projection (not a DB change): known contact/account values
// of this branch feed the shared scrub, and base read-model free-text fields are masked value-only
// (field names, shapes, counts and amounts unchanged).
import { scrub, setKnownContacts } from './domain-snapshot-core.mjs';

export async function loadKnownContacts(sql, t) {
  const rows = await sql`select v from (
    select parent_phone v from public.students where tenant_id=${t} union all select student_phone from public.students where tenant_id=${t}
    union all select home_phone from public.students where tenant_id=${t} union all select other_phone from public.students where tenant_id=${t}
    union all select phone from public.users where tenant_id=${t} union all select parent_phone from public.enrollment_consultations where tenant_id=${t}
    union all select student_phone from public.enrollment_consultations where tenant_id=${t} union all select home_phone from public.enrollment_consultations where tenant_id=${t}
    union all select phone from public.parent_accounts where tenant_id=${t} union all select driver_phone from public.shuttle_vehicles where tenant_id=${t}
    union all select account_number from public.expenses where tenant_id=${t} union all select contact_phone from public.support_requests where tenant_id=${t}
  ) x where v is not null`;
  return setKnownContacts(rows.map(r => r.v));
}

const each = (list, fn) => { for (const item of list || []) fn(item); };
const clean = (obj, keys) => { for (const k of keys) if (typeof obj[k] === 'string') obj[k] = scrub(obj[k]); };

// Free-text fields of buildReadModel() output that people type into.
export function maskBaseModel(model) {
  each(model.students, s => { each(s.consultations, c => clean(c, ['summary', 'followup'])); each(s.lessons, l => clean(l, ['progress'])); each(s.progress, p => clean(p, ['content'])); });
  each(model.admissions, a => clean(a, ['note', 'reason']));
  each(model.messages, m => { clean(m, ['content', 'detail']); each(m.replies, r => clean(r, ['body'])); });
  each(model.tasks, t => clean(t, ['title', 'detail']));
  each(model.approvals, a => { clean(a, ['title', 'note']); each(a.steps, s => clean(s, ['comment'])); });
  each(model.documents, d => clean(d, ['title', 'description', 'body']));
  each(model.calendar, e => clean(e, ['title']));
  each(model.finance?.expenses, e => clean(e, ['title']));
  return model;
}
