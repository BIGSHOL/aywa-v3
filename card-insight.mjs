// 카드 분석 2단: 코드 facts만 AI에 보내고, 결과는 복사본의 별도 로컬 폴더에 보존한다.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openStore } from './flow-store.mjs';
import { GUARD, inspectTexts, repairNote, renderText } from './exit-ai.mjs';
import { modelLabel } from './exit-runtime.mjs';

export const CARD_INSIGHT_PATH = '/api/insight/cards';
const METRIC = /^[a-z][a-z0-9-]{0,40}$/;
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const cardSelectionKey = a => `${a.metric}|${sha([a.period, a.by?.id || 'all', a.filter ? [a.filter.dim, a.filter.key] : null,
  a.range ? [a.range.from, a.range.to, a.range.up] : null]).slice(0, 24)}`;
const text = n => ({ type: 'string', minLength: 1, maxLength: n });
const line = { type: 'object', additionalProperties: false, required: ['text', 'factIds'], properties: {
  text: text(220), factIds: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', pattern: '^F-[0-9a-f]{8}$' } },
} };
export const CARD_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'watch', 'checks'], properties: {
  summary: line, watch: { type: 'array', maxItems: 3, items: line }, checks: { type: 'array', maxItems: 3, items: line },
} };
export const CARD_PROMPT = ['당신은 학원 원장의 카드 분석 문장을 작성하는 검토 보조입니다. 입력의 지표와 사실은 코드가 정한 내용입니다. 한국어로 씁니다.', GUARD,
  '첫 줄의 결론 숫자와 증감은 코드가 씁니다. summary와 watch에는 기록된 이유가 있으면 그 이유를, 없으면 근거 있는 구분별 변화만 간결하게 씁니다. 원인을 추측하거나 숫자·빈 명단·빈 업무를 되읽지 않습니다. 입력의 구분 주의가 있으면 그 선택 기준에 대해서만 한 번 씁니다.',
  'summary는 기록 이유 한두 문장, watch는 눈여겨볼 점 최대 세 줄입니다. checks는 담당 역할·대상·볼 기록 또는 화면이 모두 있을 때만 최대 세 줄이며, 없으면 빈 배열입니다. 각 줄에는 근거인 입력 F- id를 factIds에 넣습니다. 이름을 여럿 나열하거나 담당 배치와 담임 변경을 같은 사건으로 말하지 않습니다.'].join('\n');

// 로컬 원본 facts를 AI에 보낼 때 사람 이름·반/학교 이름·기록 열쇠를 제외한다.
// 식별자를 가린 F-id는 서버에서만 원본 fact id와 연결한다.
export function cardInput(analysis) {
  const labels = new Map();
  const indicator = { 이름: analysis.metricInfo.name, 단위: analysis.metricInfo.unit,
    방향: analysis.metricInfo.better === 'up' ? '높을수록 좋음' : analysis.metricInfo.better === 'down' ? '낮을수록 좋음' : '좋고 나쁨의 방향 없음',
    '기준 문장': analysis.facts.find(f => f.item === 5 && f.kind === 'basis')?.text || '',
    '기간 단위': { day: '일별', week: '주별', month: '월별', year: '연별' }[analysis.period] || '주별',
    '구분': analysis.by?.label || '전체', '자료 기준일': analysis.asOf || '확인 필요',
    ...(analysis.by?.id === 'mix' ? { '구분 주의': '한 원생은 수강 구성 하나에만 속함' }
      : analysis.by?.id === 'subject' ? { '구분 주의': '과목별 인원은 중복 수강을 포함함' } : {}),
    ...(analysis.filter ? { '선택 범위': `${analysis.filter.label}만` } : {}),
    ...(analysis.range ? { '살펴본 기간': analysis.range.label } : {}) };
  const facts = analysis.facts.filter(f => !['roster-empty', 'flow-empty', 'flow-unavailable', 'cluster-empty', 'dimension-empty'].includes(f.kind) &&
    !(['roster-count', 'flow'].includes(f.kind) && !f.values?.count)).map(f => {
    const id = `F-${sha([analysis.metric, f.id, f.item, f.kind]).slice(0, 8)}`;
    labels.set(id, f.text);
    const values = Object.fromEntries(Object.entries(f.values || {}).filter(([k, v]) =>
      !['key', 'name', 'basis', 'note'].includes(k) && (typeof v === 'number' || typeof v === 'boolean' || v === null || k === 'dimension' || k === 'field' || k === 'band' || k === 'label' && ['mix', 'subject'].includes(f.values?.dimension))));
    const named = ['mix', 'subject'].includes(f.values?.dimension);
    const safe = f.item === 2 && f.kind === 'other-change' ? f.text
      : f.item === 2 && named ? f.text.replace(/ · 중복 포함$/, '')
      : f.item === 2 && !f.kind.endsWith('empty') ? `${f.values?.dimension === 'teacher' ? '담당 선생님' : f.values?.dimension === 'class' ? '반' : f.values?.dimension || '기준'} 변화`
      : f.item === 3 && f.kind === 'cluster' ? `${{ className: '반', teacher: '담당 선생님', school: '학교', grade: '학년' }[f.values?.field] || '기준'} 한곳에 집중`
      : f.item === 5 && f.kind === 'difference' ? '카드 수치와 추세선의 집계 기준 비교'
      : f.text;
    return { id, item: f.item, kind: f.kind, text: safe, values };
  });
  return { metric: analysis.metric, key: cardSelectionKey(analysis), fingerprint: sha([indicator, analysis.facts.map(f => ({ id: f.id, text: f.text, values: f.values }))]), indicator, facts, labels };
}

export function validateCardOutput(output, facts) {
  if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).sort().join(',') !== 'checks,summary,watch' ||
      !Array.isArray(output.watch) || output.watch.length > 3 || !Array.isArray(output.checks) || output.checks.length > 3) return { ok: false, issues: ['shape'], samples: {} };
  const lines = [output.summary, ...output.watch, ...output.checks], known = new Set(facts.map(f => f.id));
  if (lines.some(x => !x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).sort().join(',') !== 'factIds,text' ||
    typeof x.text !== 'string' || !x.text.trim() || x.text.length > 220 || /[\r\n]/.test(x.text) || !Array.isArray(x.factIds) || !x.factIds.length || x.factIds.length > 6 ||
    x.factIds.some(id => !known.has(id)))) return { ok: false, issues: ['fact_id_or_shape'], samples: {} };
  const actionable = facts.some(f => ['roster-count', 'flow'].includes(f.kind) && f.values?.count > 0);
  if (output.checks.length && (!actionable || output.checks.some(x =>
    !/(?:원장|관리자|담당자|선생님|직원|상담팀|교무팀|운영팀)/.test(x.text) ||
    !/(?:기록|화면|보고서|상담|출석|청구|수납)/.test(x.text)))) return { ok: false, issues: ['vague_check'], samples: {} };
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
  const viewFingerprint = (metric, key, fingerprint) => {
    const record = state().results[key], saved = record?.byFingerprint?.[fingerprint] || null;
    return { metric, key, fingerprint, status: saved ? 'ready' : 'empty',
      note: saved ? null : '이 선택으로 만든 AI 분석이 없습니다.',
      result: saved ? { ...displayCardOutput(saved.output, saved.facts),
        modelLabel: modelLabel(saved.model) || 'Claude', createdAt: saved.createdAt } : null,
      enabled: !!provider };
  };
  const view = analysis => { const input = cardInput(analysis); return viewFingerprint(input.metric, input.key, input.fingerprint); };
  async function make(analysis, selectedProvider = provider) {
    if (!selectedProvider) return { status: 503, error: 'ai_disabled', message: '이 서버에서는 AI 분석이 꺼져 있습니다.' };
    const built = cardInput(analysis);
    if (busy.has(built.key)) return { status: 409, error: 'busy', message: '이 카드의 문장을 만드는 중입니다.' };
    busy.add(built.key);
    try {
      let checked, answer;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!await reserve()) return { status: 429, error: 'hourly_cap', message: '시간당 생성 한도를 넘었습니다. 잠시 뒤 다시 눌러 주세요.' };
        const fragments = attempt ? [...new Set(Object.values(checked.samples || {}).flat())].slice(0, 8) : [];
        answer = await selectedProvider.ask({ schema: CARD_SCHEMA, prompt: attempt ? `${CARD_PROMPT}\n${repairNote(fragments)}` : CARD_PROMPT,
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
        const record = (results[built.key] ??= { latest: null, byFingerprint: {} });
        record.byFingerprint[built.fingerprint] = saved;
        record.latest = built.fingerprint;
        return { next: draft, result: null };
      });
      return { ...view(analysis), httpStatus: 200 };
    } finally { busy.delete(built.key); }
  }
  return { view, viewFingerprint, make };
}
export const validCardMetric = x => METRIC.test(x || '');
