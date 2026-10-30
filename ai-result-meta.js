// AI 결과의 공통 머리·본문·접힌 근거. 입력 글은 서식을 넣기 전에 이스케이프한다.
(() => {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const time = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date)
      : '만든 시각 확인 필요';
  };
  const text = ({ model, at, basis }) => `${model || 'AI'} · ${time(at)} · 기준: ${basis || '자료 기준 확인 필요'}`;
  const token = /⟦([^⟧]+)⟧|([+−-]?\d[\d,]*(?:\.\d+)?(?:%p|%|명|건|원|회|개|점|개월|일)?)|(증가|상승|늘어\S*|올라\S*|올랐\S*|감소|하락|줄어\S*|줄었\S*|떨어\S*)/g;
  const rich = (value, escape = safe) => {
    const input = String(value ?? ''); let from = 0, out = '';
    for (const match of input.matchAll(token)) {
      out += escape(input.slice(from, match.index));
      const part = escape(match[1] || match[2] || match[3]);
      out += `<strong>${part}</strong>`;
      from = match.index + match[0].length;
    }
    return out + escape(input.slice(from));
  };
  const evidence = (items, escape = safe) => Array.isArray(items) && items.length
    ? `<span class="air-evidence" tabindex="0" aria-label="근거 보기">근거 보기<span class="air-evidence-pop" role="note">${items.map(escape).join('<br>')}</span></span>` : '';
  const tone = (delta, better) => !Number.isFinite(delta) || delta === 0 || !['up', 'down'].includes(better) ? ''
    : (better === 'up' ? delta > 0 : delta < 0) ? 'good' : 'bad';
  const summary = (value, escape = safe, changes = []) => `<p class="air-summary">${rich(value, escape)}${changes.map(({ label, text, tone }) =>
    `<span class="air-change${tone === 'good' || tone === 'bad' ? ` ${tone}` : ''}"> · ${escape(label)} <strong>${escape(text)}</strong></span>`).join('')}</p>`;
  window.AIResultMeta = { time, text, rich, evidence, tone, summary, html: (info, escape = safe) => `<small class="ai-result-meta">${escape(text(info))}</small>` };
})();
