// 모델 답의 숫자·기간은 브라우저 질문이나 모델 인용 번호가 아닌 서버 계산 근거에서만 확인한다.
// 단위 없는 작은 서수(첫째·2번 등)는 사실 수치가 아니므로 검사 대상에서 제외한다.
const DATE = /(?<!\d)\d{4}[-./]\d{1,2}(?:[-./]\d{1,2})?(?!\d)/gu;
const MD = /(?<!\d)\d{1,2}\/\d{1,2}(?!\d)/gu;
const TIME = /(?<!\d)\d{1,2}:\d{2}(?!\d)/gu;
const UNIT = /(?<![\dA-Za-z])[-+−]?\d[\d,]*(?:\.\d+)?\s*(?:억원|만원|천원|학년|개월|시간|원|건|명|개|회|점|%|분|초|일|월|년|배|권|줄|칸)(?![가-힣A-Za-z])/gu;
const BIG = /(?<![\dA-Za-z,])(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d+)?(?![\dA-Za-z,])/gu;
const amount = s => String(Number(String(s).replaceAll(',', '')));
const dateKey = raw => {
  const parts = raw.replace(/[./]/g, '-').split('-').map(Number);
  return parts.length === 3 ? `date:${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}` : `month:${parts[0]}-${String(parts[1]).padStart(2, '0')}`;
};
const collect = (input, { bare = false } = {}) => {
  const s = String(input || '').replace(/[⟦⟧]/g, ''), out = new Set();
  for (const m of s.matchAll(DATE)) {
    const key = dateKey(m[0]); out.add(key);
    const parts = m[0].replace(/[./]/g, '-').split('-').map(Number);
    out.add(`unit:${parts[0]}년`);
    out.add(`unit:${parts[1]}월`);
    if (parts.length === 3) { out.add(`md:${parts[1]}/${parts[2]}`); out.add(`unit:${parts[2]}일`); }
  }
  for (const m of s.matchAll(MD)) { const [month, day] = m[0].split('/').map(Number); out.add(`md:${month}/${day}`); }
  for (const m of s.matchAll(TIME)) out.add(`time:${m[0]}`);
  for (const m of s.matchAll(UNIT)) {
    const [, digits, unit] = /^[-+−]?(\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(m[0]);
    out.add(`unit:${amount(digits)}${unit}`);
  }
  if (bare) for (const m of s.matchAll(BIG)) out.add(`bare:${amount(m[0])}`);
  return out;
};

export function unsupportedAnswerFacts(answer, facts) {
  const known = new Set();
  for (const f of facts?.facts || []) {
    for (const token of collect(f.text, { bare: true })) known.add(token);
  }
  // 숫자 칸은 단위 없이 쓴 999도 검사한다. 본문은 날짜·시간·단위가 있는 수치와 큰 숫자를 검사한다.
  const visible = [answer.headline, ...(answer.keyFacts || []).flatMap(f => [f.label, f.value, f.change]),
    ...(answer.points || []).map(p => p.text), ...(answer.checks || []),
    ...(answer.table?.rows || []).flat(), answer.suggestedTask?.title, answer.suggestedTask?.body,
    answer.body].filter(Boolean);
  const claimed = new Set();
  for (const line of visible) for (const token of collect(line, { bare: true })) claimed.add(token);
  return [...claimed].filter(token => !known.has(token));
}
