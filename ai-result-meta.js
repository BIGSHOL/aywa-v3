// 모든 AI 결과의 머리 줄: 모델 · 만든 시각 · 입력 자료의 범위와 기준일.
(() => {
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const time = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(date)
      : '만든 시각 확인 필요';
  };
  const text = ({ model, at, basis }) => `${model || 'AI'} · ${time(at)} · 기준: ${basis || '자료 기준 확인 필요'}`;
  window.AIResultMeta = { time, text, html: (info, escape = safe) => `<small class="ai-result-meta">${escape(text(info))}</small>` };
})();
