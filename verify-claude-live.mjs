// Live check against the local DB copy and a running dev server.
//   node experiments/owner-concept/verify-claude-live.mjs          → no Claude call
//   node experiments/owner-concept/verify-claude-live.mjs --call   → plus ONE genuine claude -p request
// OWNER_CONCEPT_URL defaults to http://127.0.0.1:4312.
import assert from 'node:assert/strict';
import { loadSnapshot } from './snapshot.mjs';
import { buildAssistantContext, contextText } from './claude-bridge-context.mjs';
import { buildInput, validateRequest } from './claude-bridge-prompt.mjs';

const base = process.env.OWNER_CONCEPT_URL || 'http://127.0.0.1:4312';
const origin = new URL(base).origin;
const snapshot = await loadSnapshot();
const context = buildAssistantContext(snapshot);
const all = contextText(context, null);

// Facts the screen shows must be the facts the model gets.
const october = snapshot.invoices.filter(i => i.period === snapshot.meta.month);
const residual = october.reduce((n, i) => n + i.remaining, 0), open = october.filter(i => i.remaining > 0).length;
assert.equal(residual, october.reduce((n, i) => n + Math.max(0, i.gross - i.discount - i.paid), 0), 'unpaid = gross − discount − paid');
assert.match(context.issues.billing.text, new RegExp(`남은 금액이 있는 청구 ${open}건\\(합계 ${residual.toLocaleString('ko-KR')}원\\)`));
assert.match(context.overview, new RegExp(`현재 재원 ${snapshot.students.filter(s => s.status === 'enrolled').length}명`));
// No personal data: no student/staff/lead names, no phone numbers.
const names = new Set([...snapshot.students, ...snapshot.staff, ...snapshot.admissions].map(p => p.name).filter(n => typeof n === 'string' && n.trim().length >= 2));
const leaked = [...names].filter(n => all.includes(n));
assert.deepEqual(leaked, [], 'context must not contain personal names');
assert(!/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/.test(all), 'context must not contain phone numbers');
const input = buildInput(context, validateRequest({ prompt: '10월 미납 정확히 얼마야?', contextIssueId: 'billing', history: [] }));
console.log(`context ok: ${snapshot.meta.month} residual ${residual.toLocaleString('ko-KR')}원 / ${open}건 · ${all.length} chars (all issues) · ${input.length} chars (billing request) · ${names.size} names checked`);

const post = (body, headers = {}) => fetch(`${base}/api/assistant`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body });
assert.equal((await fetch(`${base}/api/assistant`)).status, 405, 'GET is not allowed');
assert.equal((await fetch(`${base}/api/other`, { method: 'POST', headers: { origin } })).status, 405, 'generic POST stays read-only');
assert.equal((await post('{"prompt":"x"}', { origin: 'http://evil.test' })).status, 403, 'foreign Origin');
assert.equal((await post('{"prompt":"x"}', { 'content-type': 'text/plain' })).status, 415, 'non-JSON body');
assert.equal((await post(JSON.stringify({ prompt: 'x', contextIssueId: 'payroll' }))).status, 400, 'unknown issue');
assert.equal((await fetch(`${base}/`)).status, 200, 'read-only page unchanged');
console.log('server guards ok (no Claude call made)');

if (process.argv.includes('--call')) {
  const started = Date.now();
  const res = await post(JSON.stringify({ prompt: '10월 미납이 정확히 얼마인지, 몇 건인지 알려 주고 확인 요청 초안도 만들어 줘.', contextIssueId: 'billing', history: [{ role: 'user', content: '이번 달 수납 상황이 궁금해요.' }, { role: 'assistant', content: '어떤 부분을 확인할까요?' }] }));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(Object.keys(body), ['answer', 'issueIds', 'suggestedTask', 'provider']);
  assert.equal(body.provider, 'claude-cli');
  assert(/[가-힣]/.test(body.answer), 'Korean answer');
  assert.match(body.answer.replace(/\s/g, ''), new RegExp(residual.toLocaleString('ko-KR')), 'answer uses the server residual');
  assert(body.issueIds.includes('billing'));
  assert(body.suggestedTask === null || (typeof body.suggestedTask.title === 'string' && typeof body.suggestedTask.body === 'string'));
  console.log(`genuine call ok in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(body, null, 1));
}
