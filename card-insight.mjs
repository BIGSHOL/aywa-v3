// 카드 분석 2단: 코드 facts만 AI에 보내고, 결과는 복사본의 별도 로컬 폴더에 보존한다.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openStore } from './flow-store.mjs';
import { GUARD, inspectTexts, repairNote, renderText } from './exit-ai.mjs';
import { modelLabel } from './exit-runtime.mjs';

export const CARD_INSIGHT_PATH = '/api/insight/cards';
const METRIC = /^[a-z][a-z0-9-]{0,40}$/;
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text = n => ({ type: 'string', minLength: 1, maxLength: n });
const line = { type: 'object', additionalProperties: false, required: ['text', 'factIds'], properties: {
  text: text(220), factIds: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', pattern: '^F-[0-9a-f]{8}$' } },
} };
export const CARD_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'watch', 'checks'], properties: {
  summary: line, watch: { type: 'array', maxItems: 3, items: line }, checks: { type: 'array', maxItems: 3, items: line },
} };
export const CARD_PROMPT = ['당신은 학원 원장의 카드 분석 문장을 작성하는 검토 보조입니다. 입력의 지표와 사실은 코드가 정한 내용입니다. 한국어로 씁니다.', GUARD,
  'summary는 요약 한 줄, watch는 눈여겨볼 점 최대 세 줄, checks는 사람이 확인할 것 최대 세 줄입니다. 각 줄에는 근거인 입력 F- id를 factIds에 넣습니다. 숫자와 수량은 화면의 코드 사실에 따로 있습니다. 근거가 없으면 해당 목록을 비웁니다.'].join('\n');

// 로컬 원본 facts를 AI에 보낼 때 사람 이름·반/학교 이름·기록 열쇠를 제외한다.
// 식별자를 가린 F-id는 서버에서만 원본 fact id와 연결한다.
export function cardInput(analysis) {
  const labels = new Map();
  const indicator = { 이름: analysis.metricInfo.name, 단위: analysis.metricInfo.unit,
    방향: analysis.metricInfo.better === 'up' ? '높을수록 좋음' : analysis.metricInfo.better === 'down' ? '낮을수록 좋음' : '좋고 나쁨의 방향 없음',
    '기준 문장': analysis.facts.find(f => f.item === 5 && f.kind === 'basis')?.text || '',
    '기간 단위': { day: '일별', week: '주별', month: '월별', year: '연별' }[analysis.period] || '주별' };
  const facts = analysis.facts.map(f => {
    const id = `F-${sha([analysis.metric, f.id, f.item, f.kind]).slice(0, 8)}`;
    labels.set(id, f.text);
    const values = Object.fromEntries(Object.entries(f.values || {}).filter(([k, v]) =>
      !['key', 'name', 'basis', 'note'].includes(k) && (typeof v === 'number' || typeof v === 'boolean' || v === null || k === 'dimension' || k === 'field' || k === 'band')));
    const safe = f.item === 2 && !f.kind.endsWith('empty') ? `${f.values?.dimension === 'teacher' ? '담당 선생님' : f.values?.dimension === 'class' ? '반' : f.values?.dimension || '기준'} 한 항목의 ${f.kind === 'increase' ? '증가' : '감소'}`
      : f.item === 3 && f.kind === 'cluster' ? `${{ className: '반', teacher: '담당 선생님', school: '학교', grade: '학년' }[f.values?.field] || '기준'} 한곳에 몰림`
      : f.item === 5 && f.kind === 'difference' ? '큰 숫자와 추세선의 셈 기준 비교'
      : f.text;
    return { id, text: safe, values };
  });
  return { metric: analysis.metric, fingerprint: sha([indicator, analysis.facts.map(f => ({ id: f.id, text: f.text, values: f.values }))]), indicator, facts, labels };
}

export function validateCardOutput(output, facts) {
  if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).sort().join(',') !== 'checks,summary,watch' ||
      !Array.isArray(output.watch) || output.watch.length > 3 || !Array.isArray(output.checks) || output.checks.length > 3) return { ok: false, issues: ['shape'], samples: {} };
  const lines = [output.summary, ...output.watch, ...output.checks], known = new Set(facts.map(f => f.id));
  if (lines.some(x => !x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).sort().join(',') !== 'factIds,text' ||
    typeof x.text !== 'string' || !x.text.trim() || x.text.length > 220 || /[\r\n]/.test(x.text) || !Array.isArray(x.factIds) || !x.factIds.length || x.factIds.length > 6 ||
    x.factIds.some(id => !known.has(id)))) return { ok: false, issues: ['fact_id_or_shape'], samples: {} };
  const checked = inspectTexts(lines.map(x => x.text), known);
  // inspectTexts의 공용 ID 검사는 F-xxxxxxxx 모양을 대상으로 한다. 다른 형식의 인용도 거절한다.
  const stray = lines.some(x => (x.text.match(/\bF-[A-Za-z0-9-]+\b/g) || []).some(id => !known.has(id)));
  return { ok: !checked.issues.length && !stray, issues: [...checked.issues, ...(stray ? ['unknown_id'] : [])], samples: checked.samples };
}

export const displayCardOutput = (output, facts) => {
  const labels = new Map(facts.map(f => [f.id, f.text]));
  const expand = x => ({ text: renderText(x.text, id => labels.get(id)), evidence: x.factIds.map(id => labels.get(id)), factIds: x.factIds });
  return { summary: expand(output.summary), watch: output.watch.map(expand), checks: output.checks.map(expand) };
};

export const openCardInsightStore = ({ dir, identity, lock }) => openStore({ dir: join(dir, 'card-insight'), identity, lock });
export function createCardInsight({ store, provider = null, reserve = async () => false, clock = () => Date.now() }) {
  const busy = new Set();
  const state = () => store.state.cardInsight || { results: {} };
  const viewFingerprint = (metric, fingerprint) => {
    const record = state().results[metric], saved = record?.byFingerprint?.[record.latest] || null;
    const stale = !!saved && saved.fingerprint !== fingerprint;
    return { metric, fingerprint, status: !saved ? 'empty' : stale ? 'stale' : 'ready',
      note: stale ? '자료가 바뀌었습니다. 분석 문장을 다시 만들려면 버튼을 누르세요.' : null,
      result: saved ? { ...displayCardOutput(saved.output, saved.facts),
        modelLabel: modelLabel(saved.model) || 'Claude', createdAt: saved.createdAt } : null,
      enabled: !!provider };
  };
  const view = analysis => viewFingerprint(analysis.metric, cardInput(analysis).fingerprint);
  async function make(analysis) {
    if (!provider) return { status: 503, error: 'ai_disabled', message: '이 서버에서는 분석 문장 만들기를 켜지 않았습니다.' };
    const built = cardInput(analysis);
    if (busy.has(built.metric)) return { status: 409, error: 'busy', message: '이 카드의 문장을 만드는 중입니다.' };
    busy.add(built.metric);
    try {
      let checked, answer;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!await reserve()) return { status: 429, error: 'hourly_cap', message: '한 시간 동안 만들 수 있는 문장 수를 채웠습니다. 잠시 뒤 다시 눌러 주세요.' };
        const fragments = attempt ? [...new Set(Object.values(checked.samples || {}).flat())].slice(0, 8) : [];
        answer = await provider.ask({ schema: CARD_SCHEMA, prompt: attempt ? `${CARD_PROMPT}\n${repairNote(fragments)}` : CARD_PROMPT,
          model: 'sonnet', effort: attempt ? 'medium' : 'low', timeoutMs: 240_000,
          input: { 지표: built.indicator, facts: built.facts } });
        checked = validateCardOutput(answer.output, built.facts);
        if (checked.ok) break;
        if (checked.issues.includes('fact_id_or_shape') || checked.issues.includes('unknown_id')) break;
      }
      if (!checked.ok) return { status: 422, error: 'invalid_output', message: '근거 또는 문장 검사를 통과하지 못해 저장하지 않았습니다.', issues: checked.issues };
      const saved = { fingerprint: built.fingerprint, facts: [...built.labels].map(([id, text]) => ({ id, text })), output: answer.output, model: answer.model || null, createdAt: new Date(clock()).toISOString() };
      await store.transact(draft => {
        const results = (draft.cardInsight ??= { results: {} }).results;
        const record = (results[built.metric] ??= { latest: null, byFingerprint: {} });
        record.byFingerprint[built.fingerprint] = saved;
        record.latest = built.fingerprint;
        return { next: draft, result: null };
      });
      return { ...view(analysis), httpStatus: 200 };
    } finally { busy.delete(built.metric); }
  }
  return { view, viewFingerprint, make };
}
export const validCardMetric = x => METRIC.test(x || '');
