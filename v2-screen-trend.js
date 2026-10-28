/* 확장 추세 — 화면(원장 10-28 "추세를 눌렀을때 확장 추세로 이동 … 일별 월별 연별 추세를 자세하게 … 학생별, 선생님별, 반별, 과목별 등 다양한 기준"
   · "완전한 확장 추세 툴을 하나 만들고, 거기서 선택한 공통적으로 사용할 수 있는건 공통적으로 사용하면서 기준만 바꿔서 필터링").
   틀은 하나다: 지표 고르기 · 기간 단위(일·주·월·연) · 기준(지표가 아는 것만) · 필터(표의 줄을 눌러 그 줄만) · 큰 추세 · 기준별 표.
   지표마다 다른 것은 서버(trend-metrics.mjs)가 준다. 주소 = #v2-trend?metric=&grain=&by=&f= · KPI 카드를 누르면 여기로 온다. */
(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const esc = S.esc, fmt = n => Number(n).toLocaleString('ko-KR');
  let last = null; // 지금 그린 화면의 조건과 이동 함수(아래 이벤트가 쓴다)
  const sort = { key: 'value', dir: 0 }; // dir 0 = 나쁜 쪽부터(지표의 좋아지는 방향 반대)
  let showAll = false;

  const shown = (v, unit) => (v === null || v === undefined ? '기록 없음' : unit === '%' ? `${v.toFixed(1)}%` : `${fmt(v)}${unit}`);
  const changeOf = (p, q, unit, better) => {
    if (p?.value == null || q?.value == null) return { text: '—', tone: '' };
    const d = p.value - q.value; if (!d) return { text: '변화 없음', tone: '' };
    const good = better === 'up' ? d > 0 : better === 'down' ? d < 0 : null;
    return { text: `${d > 0 ? '▲' : '▼'} ${unit === '%' ? `${Math.abs(d).toFixed(1)}%p` : fmt(Math.abs(d))}`, tone: good === null ? '' : good ? 'good' : 'bad' };
  };
  // 분자 / 분모는 비율 지표만(건수 지표는 분모가 1이라 '333 / 1'로 보였다).
  const ratio = (p, unit = '%') => (unit === '%' && p && p.den != null ? `${fmt(p.num)} / ${fmt(p.den)}` : '');
  const tip = (title, rows, meta) => esc(JSON.stringify({ title, rows, meta: meta.filter(Boolean) }));

  // 기준별 꺾은선(원장 10-28 "꺾은선도 과목별로 표시할 수 있게" · "여기도 선생님별 추세선 보이게. 다른 비슷한 확장 추세는 전부").
  // 과목·프로그램은 정해 준 색(원장 10-28 "수학 파란색 영어 빨간색. EiE 주황색"), 그 밖의 줄은 줄 순서대로 같은 색을 받는다(정렬·켜고 끄기에 색이 바뀌지 않게).
  // 줄이 8개 이하면 모두, 많으면 큰 줄(대상이 많은 순) 다섯을 먼저 그리고 표의 칸으로 켜고 끈다. 전체는 굵은 검은 선.
  // 과목 색은 앱 전체 한 곳(live.js subjectColor — 수학 파랑 · 영어 빨강 · EiE 주황 · 영어+수학 보라 · 미수강·모름 회색).
  const PALETTE = ['#0f766e', '#7c3aed', '#b45309', '#be185d', '#4d7c0f', '#0e7490', '#9f1239', '#57534e', '#a16207', '#4338ca', '#15803d', '#c2410c'];
  const SUBJECT_DIMS = new Set(['subject', 'program', 'mix', 'combo']);
  const colorOf = (d, r, i) => (SUBJECT_DIMS.has(d.by) && last?.api?.subjectColor?.(r.key)) || PALETTE[i % PALETTE.length];
  // 보여 주지 않는 줄(원장 10-28 "그 밖의 과목은 제외") — 전체 값에는 그대로 든다.
  const HIDDEN_ROWS = new Set(['otherOnly']);
  const rowsOf = d => d.rows.filter(r => !HIDDEN_ROWS.has(r.key));
  const picked = new Map(); // `${지표}|${기준}|${필터}` → 그리는 줄 열쇠(사람이 바꾸면 그대로 둔다)
  const viewKey = d => `${d.metric.id}|${d.by}|${d.filter ? `${d.filter.dim}:${d.filter.key}` : ''}`;
  const sizeOf = r => { const p = r.points[r.points.length - 1]; return p ? (p.den ?? p.num ?? 0) : 0; };
  function shownKeys(d) {
    const k = viewKey(d);
    const rows = rowsOf(d);
    if (!picked.has(k)) picked.set(k, new Set(rows.length <= 8 ? rows.map(r => r.key) : [...rows].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 5).map(r => r.key)));
    return picked.get(k);
  }
  const seriesOf = d => { const on = shownKeys(d); return rowsOf(d).map((r, i) => ({ key: r.key, label: r.label, color: colorOf(d, r, i), points: r.points })).filter(s => on.has(s.key)); };

  // 큰 추세: 비율은 0~100 고정, 건수는 딱 떨어지는 눈금 — 값이 0에서 멀면(가장 작은 값이 가장 큰 값의 30%를 넘으면) 값 범위에 맞춰
  // 변화가 보이게 한다(재원생 402→333이 0~600 축에선 평평했다). 기록이 없는 기간은 선을 잇지 않는다. 점마다 앱 팝오버(마우스·키보드·터치).
  // 그림 폭 = 화면에 놓일 실제 폭(글자가 화면 폭에 비례해 커지지 않게 — 760 폭을 1,400px로 늘리면 축 글자가 20px을 넘었다).
  const nice = raw => { const mag = 10 ** Math.floor(Math.log10(raw)), k = raw / mag; return Math.max((k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * mag, 1); };
  function bigChart(d, base, series) {
    const room = document.querySelector('[data-v2-screen="trend"] .tr-main')?.clientWidth || document.querySelector('#main')?.clientWidth || 800;
    const W = Math.max(560, Math.round(room - 34)), H = 300, L = 52, R = 16, T = 18, B = 34, n = d.windows.length, pct = d.metric.unit === '%';
    const vals = [...d.total, ...(base?.total || []), ...series.flatMap(s => s.points)].map(p => p?.value).filter(v => v != null);
    let min = 0, max = 100, tick = 20;
    if (!pct) {
      const top = Math.max(...vals, 1), low = vals.length ? Math.min(...vals) : 0;
      if (low > top * 0.3 && top > low) { tick = nice((top - low) / 4); min = Math.max(0, tick * Math.floor((low - tick / 2) / tick)); max = tick * Math.ceil((top + tick / 4) / tick); }
      else { tick = nice(top / 4); max = tick * Math.ceil(top / tick); }
    }
    const x = i => L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1)), y = v => T + (H - T - B) * (1 - (v - min) / (max - min)), step = (W - L - R) / Math.max(n - 1, 1);
    const grid = Array.from({ length: Math.round((max - min) / tick) + 1 }, (_, i) => { const v = min + tick * i; return `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${pct ? `${v}%` : fmt(v)}</text>`; }).join('');
    const path = list => { const runs = []; list.forEach((p, i) => { if (p?.value == null) return; if (i && list[i - 1]?.value != null) runs.at(-1).push(i); else runs.push([i]); });
      return runs.map(r => (r.length === 1 ? `<circle class="tr-solo" cx="${x(r[0])}" cy="${y(list[r[0]].value)}" r="3"/>` : `<polyline points="${r.map(i => `${x(i)},${y(list[i].value)}`).join(' ')}"/>`)).join(''); };
    const every = Math.ceil(n / 12), name = d.filter?.label ? `${d.filter.label} · ${d.metric.label}` : d.metric.label, many = series.length > 0;
    const cols = d.windows.map((w, i) => {
      const p = d.total[i], q = i ? d.total[i - 1] : null, b = base?.total?.[i], c = changeOf(p, q, d.metric.unit, d.metric.better);
      const rows = [{ label: many ? `${name} (전체)` : name, value: shown(p?.value, d.metric.unit), tone: 'primary', color: many ? '#121212' : '' },
        ...(base ? [{ label: '학원 전체', value: shown(b?.value, d.metric.unit), tone: 'secondary' }] : []),
        ...series.map(s => ({ label: s.label, value: shown(s.points[i]?.value, d.metric.unit), color: s.color }))];
      return `<g class="chart-col" data-point data-tip="${tip(w.from === w.to ? w.label : `${w.label} (${w.from} ~ ${w.to})`, rows, [i ? (c.tone ? { text: `직전 대비 ${c.text}`, tone: c.tone } : `직전 대비 ${c.text}`) : '', ratio(p, d.metric.unit)])}">`
        + `<rect class="chart-hit" x="${x(i) - step / 2}" y="${T - 8}" width="${step}" height="${H - B - T + 8}"/>`
        + (p?.value == null ? `<text data-anchor x="${x(i)}" y="${H - B - 6}" text-anchor="middle">—</text>` : `<circle class="tr-dot" data-anchor cx="${x(i)}" cy="${y(p.value)}" r="4"/>`)
        + (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(w.label)}</text>` : '') + '</g>';
    }).join('');
    const lines = series.map(s => `<g class="tr-line series" style="--c:${s.color}">${path(s.points)}</g>`).join('');
    const legend = many || base ? `<div class="tr-legend">${[`<span><i class="sum"></i>${esc(many ? '전체' : d.filter.label)}</span>`, ...(base ? ['<span><i class="alt"></i>학원 전체</span>'] : []),
      ...series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`)].join('')}</div>` : '';
    return `<div class="chart-box tr-chart${many ? ' has-series' : ''}" data-chart tabindex="0" role="group" aria-label="${esc(name)} 추세 — 화살표 키로 기간을 옮기며 수치를 확인합니다"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} ${d.windows.map((w, i) => `${w.label} ${shown(d.total[i]?.value, d.metric.unit)}`).join(', ')}">${grid}${base ? `<g class="tr-line base">${path(base.total)}</g>` : ''}${lines}<g class="tr-line">${path(d.total)}</g>${cols}</svg></div>${legend}`;
  }

  // 기준별 표의 정보 칸(원장 10-28 "각 선생님의 과목, 담당 반 수, 담당 학생 수 표시") — 서버가 줄마다 meta로 준다(지금 재원 수강 기준).
  const META_COLS = { teacher: [['subjects', '과목'], ['classes', '담당 반'], ['students', '담당 학생']], class: [['subjects', '과목'], ['teacher', '담임'], ['students', '학생']], subject: [['classes', '반'], ['students', '학생']] };
  const metaCell = (k, v) => (v == null || v === '' ? '' : k === 'classes' ? `${fmt(v)}개` : k === 'students' ? `${fmt(v)}명` : String(v));
  function table(d, api) {
    const li = d.windows.length - 1, dim = d.metric.dims.find(x => x.id === d.by), unit = d.metric.unit, better = d.metric.better;
    const order = new Map(rowsOf(d).map((r, i) => [r.key, i])), on = shownKeys(d), metaCols = d.rows.some(r => r.meta) ? META_COLS[d.by] || [] : [];
    const rows = rowsOf(d).map(r => ({ ...r, now: r.points[li], prev: li ? r.points[li - 1] : null }));
    const val = r => r.now?.value, sign = better === 'down' ? 1 : -1;
    const cmp = {
      value: (a, b) => (val(a) == null) - (val(b) == null) || (val(a) - val(b)) * (sort.dir ? sign : -sign) || (b.now?.den ?? 0) - (a.now?.den ?? 0),
      name: (a, b) => a.label.localeCompare(b.label, 'ko') * (sort.dir ? -1 : 1),
      den: (a, b) => ((b.now?.den ?? b.now?.num ?? 0) - (a.now?.den ?? a.now?.num ?? 0)) * (sort.dir ? -1 : 1),
      change: (a, b) => { const ch = r => (r.now?.value != null && r.prev?.value != null ? r.now.value - r.prev.value : null); return (ch(a) == null) - (ch(b) == null) || (ch(a) - ch(b)) * (sort.dir ? sign : -sign); },
    }[sort.key];
    rows.sort(cmp);
    const head = (key, label, cls = '') => `<th class="${cls}"><button type="button" data-tr-sort="${key}" aria-pressed="${sort.key === key}">${label}${sort.key === key ? (sort.dir ? ' ↑' : ' ↓') : ''}</button></th>`;
    const cut = showAll ? rows : rows.slice(0, 20), w = d.windows[li];
    return `<section class="tr-break"><h3>${esc(dim?.label || '기준별')} <span>${esc(w.label)}</span></h3>`
      + `<div class="tr-table-wrap"><table class="tr-table"><thead><tr><th class="tr-pick"><span class="ax-visually-hidden">그래프에 표시</span></th>${head('name', dim?.label.replace(/별$/, '') || '이름')}${metaCols.map(([k, l]) => `<th class="tr-meta ${k === 'subjects' || k === 'teacher' ? '' : 'num'}">${l}</th>`).join('')}${head('value', '값', 'num')}${head('change', '직전 대비', 'num')}${unit === '%' ? head('den', '대상', 'num') : ''}<th>추세</th><th></th></tr></thead><tbody>`
      + cut.map(r => { const c = changeOf(r.now, r.prev, unit, better), color = colorOf(d, r, order.get(r.key));
        return `<tr><td class="tr-pick"><label><input type="checkbox" data-tr-line="${esc(r.key)}" ${on.has(r.key) ? 'checked' : ''} aria-label="${esc(r.label)} 그래프에 표시"><i style="background:${color}"></i></label></td><th scope="row">${esc(r.label)}</th>`
          + metaCols.map(([k]) => `<td class="tr-meta ${k === 'subjects' || k === 'teacher' ? '' : 'num'}">${esc(metaCell(k, r.meta?.[k]))}</td>`).join('')
          + `<td class="num"><strong>${shown(r.now?.value, unit)}</strong></td><td class="num ${c.tone}">${c.text}</td>${unit === '%' ? `<td class="num">${ratio(r.now)}</td>` : ''}`
          + `<td class="tr-spark">${api.lineChart(r.points.map((p, i) => ({ label: d.windows[i].label, value: p?.value ?? null })), { key: 'value', label: r.label, unit, compare: '직전', better })}</td>`
          + `<td><button type="button" class="ax-text-link" data-tr-filter="${esc(r.key)}">자세히 보기</button></td></tr>`; }).join('')
      + `</tbody></table></div>${rows.length > cut.length ? `<button type="button" class="button" data-tr-more>나머지 ${fmt(rows.length - cut.length)}개 더 보기</button>` : ''}</section>`;
  }

  // 지표를 바꿀 때 기다리지 않게(원장 10-28 "지표 변경시마다 추세를 계산하는중이라고 따로 나오던데, 바로 뜨게"):
  // ① 처음 그린 뒤 쉬는 틈에 지금 지표의 다른 기간 단위와 다른 지표들을 하나씩 서버에 미리 계산시킨다(서버가 같은 조건의 답을 기억한다).
  // ② 새 답이 오기 전에는 '계산하는 중' 대신 직전 화면을 흐리게 그대로 둔다.
  let warmed = false, lastHtml = '';
  function warm(d, grain) {
    if (warmed) return; warmed = true;
    const qs = [...d.grains.map(g => `metric=${encodeURIComponent(d.metric.id)}&grain=${g.id}`), ...d.metrics.filter(m => m.id !== d.metric.id).map(m => `metric=${encodeURIComponent(m.id)}${grain ? `&grain=${encodeURIComponent(grain)}` : ''}`)];
    const next = () => { const q = qs.shift(); if (!q) return; fetch(`/api/v2/trend?${q}`, { headers: { Accept: 'application/json' } }).catch(() => {}).finally(() => setTimeout(next, 150)); };
    setTimeout(next, 800);
  }

  function render(ctx) {
    const q = ctx.query, params = { metric: q.get('metric') || '', grain: q.get('grain') || '', by: q.get('by') || '', f: q.get('f') || '' };
    last = { params, go: ctx.go, api: ctx.api, by: last?.by || '' };
    const e = ctx.load(params);
    if (!e.data) {
      if (e.status === 'error') return `<p class="v3s-note">${esc(e.error || '불러오지 못했습니다.')}</p>`;
      return lastHtml ? lastHtml.replace('<div class="tr">', '<div class="tr is-loading" aria-busy="true">') : '<div class="tr"><p class="v3s-note">추세를 계산하는 중…</p></div>';
    }
    const d = e.data; last.by = d.by; last.view = viewKey(d);
    const base = d.filter ? ctx.load({ metric: d.metric.id, grain: d.grain }).data : null, li = d.windows.length - 1;
    const p = d.total[li], c = changeOf(p, li ? d.total[li - 1] : null, d.metric.unit, d.metric.better), CP = window.ContextPicker;
    // 지표 고르개 = 지표 이름만(원장 10-28 "그냥 지표이름만 보여줘도 될거같음" · "마지막 21개는 필요없음" — 건수 줄은 CSS로 숨긴다). 영역 이름으로도 찾는다.
    const items = d.metrics.map(m => ({ value: m.id, title: m.label, search: `${m.label} ${m.group}` }));
    const picker = CP ? CP.html({ id: 'tr-metric', name: 'tr-metric', label: '지표', clearable: false, selected: [d.metric.id], ...CP.lists.choices({ items, columns: [{ key: 'name', label: '지표' }], noun: '지표', unit: '개' }) }) : '';
    const seg = (attr, list, cur) => list.map(x => `<button type="button" class="tab ${x.id === cur ? 'active' : ''}" ${attr}="${esc(x.id)}" aria-pressed="${x.id === cur}">${esc(x.label)}</button>`).join('');
    lastHtml = `<div class="tr"><div class="page-heading"><div><p class="ws-group">확장 추세</p><h1>${esc(d.metric.label)}</h1></div><div class="heading-actions">${picker}</div></div>`
      + `<div class="tr-bar"><div class="tr-seg" role="group" aria-label="기간 단위">${seg('data-tr-grain', d.grains, d.grain)}</div><div class="tr-seg" role="group" aria-label="기준">${seg('data-tr-by', d.metric.dims.filter(x => x.id !== d.filter?.dim), d.by)}</div>`
      + (d.filter ? `<span class="tr-filter"><strong>${esc(d.filter.label)}</strong>만 보는 중<button type="button" class="icon-button" data-tr-unfilter aria-label="필터 풀기">×</button></span>` : '') + '</div>'
      + `<section class="tr-main"><div class="tr-now"><span>${esc(d.windows[li]?.label || '')}</span><strong>${shown(p?.value, d.metric.unit)}</strong><small class="${c.tone}">${li ? `직전 대비 ${c.text}` : ''}</small><small>${ratio(p, d.metric.unit)}</small></div>${bigChart(d, base, seriesOf(d))}</section>`
      + (d.rows.length ? table(d, ctx.api) : '<p class="v3s-note">이 조건의 기록이 없습니다.</p>') + '</div>';
    warm(d, params.grain);
    return lastHtml;
  }

  S.register({ id: 'trend', label: '확장 추세', nav: false, native: true, render });

  const go = patch => { if (!last) return; showAll = false; last.go({ ...last.params, ...patch }); };
  document.addEventListener('click', ev => {
    const t = ev.target;
    // KPI 카드(어디를 눌러도) → 그 지표의 확장 추세. 카드 안의 링크·단추는 제 일을 한다.
    const card = t.closest?.('.ws-kpi[data-trend]');
    if (card && !t.closest('a,button')) { location.hash = `v2-trend?metric=${encodeURIComponent(card.dataset.trend)}&grain=${encodeURIComponent(card.dataset.grain || 'week')}`; return; }
    if (!t.closest?.('[data-v2-screen="trend"]')) return;
    const b = t.closest('[data-tr-grain],[data-tr-by],[data-tr-filter],[data-tr-unfilter],[data-tr-sort],[data-tr-more]'); if (!b) return;
    if (b.dataset.trGrain) go({ grain: b.dataset.trGrain });
    else if (b.dataset.trBy) go({ by: b.dataset.trBy });
    else if (b.dataset.trFilter) go({ f: `${last.by}:${b.dataset.trFilter}`, by: '' });
    else if (b.hasAttribute('data-tr-unfilter')) go({ f: '', by: '' });
    else if (b.dataset.trSort) { sort.dir = sort.key === b.dataset.trSort ? 1 - sort.dir : 0; sort.key = b.dataset.trSort; last.api.render(); }
    else if (b.hasAttribute('data-tr-more')) { showAll = true; last.api.render(); }
  });
  document.addEventListener('change', ev => {
    // 표의 칸 = 그 줄의 꺾은선 켜고 끄기(그 지표·기준·필터에서만 기억).
    const line = ev.target.closest?.('[data-v2-screen="trend"] [data-tr-line]');
    if (line && last) { const set = picked.get(last.view); if (set) { if (line.checked) set.add(line.dataset.trLine); else set.delete(line.dataset.trLine); } last.api.render(); return; }
    const root = ev.target.closest?.('[data-cpick-name="tr-metric"]'); if (!root || !last) return;
    const v = root.querySelector('input[type=hidden]')?.value; if (v && v !== last.params.metric) { showAll = false; last.go({ metric: v, grain: last.params.grain }); }
  });
})();
