// Billing change between two months, split so every part adds up to the exact difference (INSIGHT-EXITS.md §청구 분해).
// Billing = snapshot.mjs: valid invoices only (no void/refunded — filtered in SQL), no test students, amount = max(0,
// total − discount). Pure: the caller passes the rows and the classifiers; nothing here reads the database.
export const ITEM_GROUPS = Object.freeze({ special: '특강·방학', textbook: '교재', shuttle: '차량', other: '기타·할인 조정' });
export const REGULAR_BUCKETS = Object.freeze({
  subject_down: '수강 과목 수 감소', subject_up: '수강 과목 수 증가', same_down: '같은 과목 수 · 금액 감소',
  same_up: '같은 과목 수 · 금액 증가', same_flat: '같은 과목 수 · 금액 같음', subject_unknown: '수강 기록으로 과목 수를 알 수 없음',
});
export const DEPARTED_KINDS = Object.freeze({ withdrawn: '실제 퇴원', cleanup: '일괄 정리(이탈 달 추정)', on_hold: '휴원', enrolled: '재원 · 뒤 달 청구 없음', other: '그 밖의 상태' });
export const NEW_KINDS = Object.freeze({ new_enroll: '두 달 사이 등록', returning: '이전 등록 · 다시 청구' });

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const SPECIAL_TEXT = /특강|방학|여름|겨울|썸머|윈터|캠프|집중/;
const TEXTBOOK_TEXT = /교재/;

/** One line → group. A line tied to a class by 회차 확정 (invoice_session_terms) is judged by that class (fact); otherwise by kind, then text (estimate). */
export function lineGroup(item, linkedClass, isSpecialLecture) {
  const kind = String(item?.kind || ''), text = String(item?.description || '');
  if (kind === '차량비') return { group: 'shuttle', basis: 'kind' };
  if (kind === '교재') return { group: 'textbook', basis: 'kind' };
  if (kind !== '수업') return { group: 'other', basis: 'kind' };
  if (linkedClass) return { group: isSpecialLecture({ isSpecial: linkedClass.is_special, className: linkedClass.class_name }) ? 'special' : 'regular', basis: 'class' };
  if (TEXTBOOK_TEXT.test(text)) return { group: 'textbook', basis: 'text' };
  if (SPECIAL_TEXT.test(text)) return { group: 'special', basis: 'text' };
  return { group: 'regular', basis: 'default' };
}

const blank = () => ({ total: 0, invoiceIds: [], groups: { regular: 0, special: 0, textbook: 0, shuttle: 0, other: 0 }, text: { special: 0, textbook: 0 } });
/** period → studentId → { total, invoiceIds, groups, text } for the given (eligible) students. Line nets that do not add up to the invoice amount go to 'other'. */
export function monthlyBilling(invoices, { eligible, terms = [], classById = new Map(), isSpecialLecture }) {
  const linked = new Map();
  for (const t of terms) if (t.line != null && t.class_id) linked.set(`${t.invoice_id}|${t.line}`, classById.get(t.class_id) || null);
  const out = new Map();
  for (const inv of invoices) {
    if (!eligible(inv.student_id) || ['void', 'refunded'].includes(inv.status)) continue;
    const month = out.get(inv.period) ?? out.set(inv.period, new Map()).get(inv.period);
    const s = month.get(inv.student_id) ?? month.set(inv.student_id, blank()).get(inv.student_id);
    const total = Math.max(0, num(inv.gross) - num(inv.discount));
    s.total += total; s.invoiceIds.push(inv.id);
    let lines = 0;
    (Array.isArray(inv.line_items) ? inv.line_items : []).forEach((item, i) => {
      const net = num(item?.amount) - num(item?.discount), g = lineGroup(item, linked.get(`${inv.id}|${i}`), isSpecialLecture);
      s.groups[g.group] += net; lines += net;
      if (g.basis === 'text') s.text[g.group] += net;
    });
    s.groups.other += total - lines;
  }
  return out;
}

const part = (id, label, extra = {}) => ({ id, label, students: 0, amount: 0, studentIds: [], ...extra });
const add = (p, sid, amount) => { p.students += 1; p.amount += amount; p.studentIds.push(sid); };

/**
 * from → to decomposition. kindOf(sid) → departed kind; isNew(sid) → true when registered between the two months;
 * subjectsOf(sid, month) → Set | null (regular enrolments that month); sessionsOf(sid, month) → planned sessions | null.
 * departed + new + Σ retained groups === to.total − from.total (integers; verified in verify-exit-insight.mjs).
 */
export function decompose(monthly, from, to, { kindOf, isNew, subjectsOf, sessionsOf = () => null }) {
  const A = monthly.get(from) || new Map(), B = monthly.get(to) || new Map();
  const totalOf = m => [...m.values()].reduce((n, s) => n + s.total, 0);
  const departed = part('departed', '빠진 학생', { groups: Object.fromEntries(Object.entries(DEPARTED_KINDS).map(([k, l]) => [k, part(k, l)])) });
  const fresh = part('new', '새 학생', { groups: Object.fromEntries(Object.entries(NEW_KINDS).map(([k, l]) => [k, part(k, l)])) });
  const retained = part('retained', '남은 학생 증감', { groups: {
    ...Object.fromEntries(Object.entries(ITEM_GROUPS).map(([k, l]) => [k, part(k, l, { estimateAmount: 0 })])),
    ...Object.fromEntries(Object.entries(REGULAR_BUCKETS).map(([k, l]) => [k, part(k, l, k === 'same_down' ? { sessionsChecked: 0, fewerSessions: 0 } : {})])) } });
  for (const [sid, a] of A) {
    if (B.has(sid)) continue;
    add(departed, sid, -a.total); add(departed.groups[kindOf(sid)] || departed.groups.other, sid, -a.total);
  }
  for (const [sid, b] of B) {
    if (A.has(sid)) continue;
    add(fresh, sid, b.total); add(fresh.groups[isNew(sid) ? 'new_enroll' : 'returning'], sid, b.total);
  }
  for (const [sid, a] of A) {
    const b = B.get(sid); if (!b) continue;
    add(retained, sid, b.total - a.total);
    for (const g of Object.keys(ITEM_GROUPS)) {
      const d = b.groups[g] - a.groups[g]; if (!d) continue;
      add(retained.groups[g], sid, d);
      if (g === 'special' || g === 'textbook') retained.groups[g].estimateAmount += b.text[g] - a.text[g];
    }
    const d = b.groups.regular - a.groups.regular, sa = subjectsOf(sid, from), sb = subjectsOf(sid, to);
    const na = sa?.size || 0, nb = sb?.size || 0;
    const bucket = !na && !nb ? 'subject_unknown' : nb < na ? 'subject_down' : nb > na ? 'subject_up' : d < 0 ? 'same_down' : d > 0 ? 'same_up' : 'same_flat';
    add(retained.groups[bucket], sid, d);
    if (bucket === 'same_down') {
      const pa = sessionsOf(sid, from), pb = sessionsOf(sid, to);
      if (pa != null && pb != null) { retained.groups.same_down.sessionsChecked += 1; if (pb < pa) retained.groups.same_down.fewerSessions += 1; }
    }
  }
  const totals = { from: totalOf(A), to: totalOf(B) };
  totals.delta = totals.to - totals.from;
  const retainedSum = Object.values(retained.groups).reduce((n, g) => n + g.amount, 0), sum = departed.amount + fresh.amount + retainedSum;
  return { from, to, totals, parts: [departed, fresh, retained], check: { sum, exact: sum === totals.delta && retainedSum === retained.amount } };
}
