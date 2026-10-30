// 닫힌 업무의 처리 근거 한 줄(원장 10-30 "어떻게 처리되었는지 근거가 있어야됨. 그냥 무작정 처리됨이 아니라") — 무엇으로 · 누가 · 언제 · 열 곳.
// 순수 함수 하나. 작업 공간 기록(domain-snapshot-*)과 업무 흐름(flow-*)이 같은 문장을 쓴다. 근거 표·열은 task-close-evidence-1030.md(O 조사).
// '누가' = 업무를 닫은 사람(closed_by) → 근거 기록을 남긴 사람 → '자동(기록이 들어와 닫힘)'. 담당자·상담사·작성자를 처리자로 끌어오지 않는다.
// 근거 기록을 못 찾은 완료 건은 '근거 기록 없음'으로 드러낸다(missing) — 상태 낱말만으로 끝내지 않는다.
import { CLOSE_REASON } from './flow-rules.mjs';

// flow-rules의 사유 사전에 아직 없는 2.0 사유(O 조사 — 사전에 옮기면 이 줄은 지운다).
const MORE_REASON = Object.freeze({ decided: '등록 여부를 정함' });
export const AUTO_CLOSER = '자동(기록이 들어와 닫힘)';
export const NO_EVIDENCE = '근거 기록 없음';

const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** 'M/D HH:MM'(한국 시각) — 날짜만 있으면 'M/D'. 못 읽으면 ''. */
export function closeWhen(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  const d = new Date(s); if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(KST.formatToParts(d).map(x => [x.type, x.value]));
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;
}
const nameOf = (names, id) => (id ? (names instanceof Map ? names.get(String(id)) : names?.[String(id)]) || '' : '');

/**
 * @param task  { status, close_reason, closed_at, closed_by } — 2.0 staff_tasks 한 줄(또는 같은 모양으로 맞춘 신호 닫힘)
 * @param evidence  { what, by?, byName?, at?, open? } | null — 실제 근거 기록: what = 무슨 일이 있었나(한 줄), by = 기록을 남긴 직원 id,
 *                  byName = id 없이 이름만 남는 기록(교재 status_by_name), at = 그 기록 시각, open = 그 기록이 열린 처리 화면 주소
 * @param names  Map | 객체 — 직원 id → 이름
 * @returns null(아직 열린 업무) | { what, who, when, open, missing, line }
 */
export function closeEvidence(task, evidence, names) {
  if (!task || task.status === 'open' || task.status === 'late') return null;
  const reason = task.close_reason ? CLOSE_REASON[task.close_reason] || MORE_REASON[task.close_reason] || '' : '';
  const ev = evidence && String(evidence.what || '').trim() ? evidence : null;
  // 처리됨인데 근거가 없으면 드러낸다. 취소·만료는 사유 자체가 근거(결석이 아니게 정정됨 · 기간이 지남)라 사유가 있으면 빈 근거가 아니다.
  const missing = !ev && (task.status === 'done' || !reason);
  const what = ev ? (reason && !ev.what.includes(reason) && task.status !== 'done' ? `${reason} · ${ev.what}` : ev.what) : missing ? NO_EVIDENCE : reason;
  const who = nameOf(names, task.closed_by) || nameOf(names, ev?.by) || String(ev?.byName || '').trim() || AUTO_CLOSER;
  const when = closeWhen(ev?.at) || closeWhen(task.closed_at);
  const open = ev?.open && /^#[a-z0-9-]+(?:\?|$)/.test(ev.open) ? ev.open : '';
  return { what, who, when, open, missing, line: [what, who, when].filter(Boolean).join(' · ') };
}
