// Shared fixtures for verify-decision*.mjs (no network).
import { QUESTIONS } from './decision-questions.mjs';

const confidence = (p, n) => (p - 1 / n) / (1 - 1 / n);
function choice(labels, pick, p) {
  const rest = (1 - p) / (labels.length - 1);
  const probabilities = Object.fromEntries(labels.map(l => [l, l === pick ? p : rest]));
  return { type: 'choice', choice: pick, confidence: confidence(p, labels.length), probabilities };
}

/** Wire-format Jev answers; `.parsed` (non-enumerable) is the validated form applyPolicy consumes. */
export function answersFor({ action = 0.95, area = 'attendance', areaP = 0.9, urgency = 'this_week', urgencyP = 0.8, manager = 0.05, safety = 0.02, context = 0.95, second = 0.05 } = {}) {
  const wire = {
    action_needed: { type: 'noul', noul: action },
    work_area: choice(Object.keys(QUESTIONS.work_area.criteria), area, areaP),
    urgency: choice(Object.keys(QUESTIONS.urgency.criteria), urgency, urgencyP),
    manager_review: { type: 'noul', noul: manager },
    safety_concern: { type: 'noul', noul: safety },
    context_sufficient: { type: 'noul', noul: context },
    second_area: { type: 'noul', noul: second },
  };
  const parsed = Object.fromEntries(Object.entries(wire).map(([k, a]) => [k, a.type === 'noul' ? { type: 'noul', probability: a.noul } : { ...a }]));
  Object.defineProperty(wire, 'parsed', { value: parsed, enumerable: false });
  return wire;
}

export function baseContext() {
  return {
    recordId: 'rec-1', source: 'parent_message', today: '2026-10-27', recordDate: '2026-10-27',
    text: '학생A 오늘 감기로 결석합니다.', links: { student: true },
    candidates: [{ staffId: 'staff-homeroom', roles: ['homeroom_teacher'] }, { staffId: 'staff-desk', roles: ['desk'] }, { staffId: 'staff-manager', roles: ['manager'] }],
  };
}

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Fake fetch for the engine: counts calls, optional delay (abortable) and failure status. */
export function fakeJev({ answers = answersFor(), delayMs = 0, status = 200, inputTokens = 1000 } = {}) {
  const fake = async (_url, init) => {
    fake.calls++; fake.active++; fake.maxActive = Math.max(fake.maxActive, fake.active);
    try {
      if (delayMs) await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delayMs);
        init.signal.addEventListener('abort', () => { clearTimeout(t); fake.aborted++; reject(new Error('aborted')); }, { once: true });
      });
      if (status !== 200) return new Response('provider error body', { status });
      return jsonResponse({ model: JSON.parse(init.body).model, answers, usage: { input_tokens: inputTokens, output_tokens: 50 } });
    } finally { fake.active--; }
  };
  Object.assign(fake, { calls: 0, active: 0, maxActive: 0, aborted: 0 });
  return fake;
}
