/* 확장 추세 — 화면(원장 10-28 "추세를 눌렀을때 확장 추세로 이동 … 일별 월별 연별 추세를 자세하게 … 원생별, 선생님별, 반별, 과목별 등 다양한 기준"
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
  const CARD_IDS = new Set(['enrolled-students', 'courses', 'exits', 'intake', 'level-tests', 'new-enrollments', 'first-classes', 'recent-absent', 'makeups',
    'report-written', 'parent-read', 'attendance-input', 'video-issued', 'video-submitted']);
  const ANALYSIS_ITEMS = ['지금 값과 평소', '어디서 변했나', '누가', '이어진 업무', '집계 기준과 빠진 기록'];
  const analysisOpen = new Set();
  const insightState = new Map();
  const factKey = ids => [...(ids || [])].sort().join('|');
  function cardRequest(data, factIds) {
    const current = last?.api?.cardRequestFor?.(data.metric, factIds);
    return current === undefined ? data.cardRequests?.find(c => factKey(c.factIds) === factKey(factIds)) : current;
  }
  function loadInsight(data) {
    const metric = data.metric, key = data.selectionKey, signature = data.fingerprint || JSON.stringify(data.facts);
    const old = insightState.get(key);
    if (old?.signature === signature) return old;
    const state = { signature, status: 'loading', data: null };
    insightState.set(key, state);
    fetch(`/api/insight/cards?metric=${encodeURIComponent(metric)}&key=${encodeURIComponent(key)}&fp=${encodeURIComponent(data.fingerprint)}`, { headers: { Accept: 'application/json' } })
      .then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.message || '저장된 문장을 불러오지 못했습니다.'); return body; })
      .then(body => { if (insightState.get(key) === state) { state.status = 'ready'; state.data = body; last?.api.render(); } })
      .catch(error => { if (insightState.get(key) === state) { state.status = 'error'; state.error = error.message; last?.api.render(); } });
    return state;
  }
  function insightBox(data) {
    const state = loadInsight(data), body = state.data;
    const ai = window.AIResultMeta;
    const lines = (items, title) => items?.length ? `<div><h4>${title}</h4><ul>${items.map(x => `<li><span class="air-rich">${ai.rich(x.text, esc)}</span>${ai.evidence(x.evidence, esc)}</li>`).join('')}</ul></div>` : '';
    const result = body?.result;
    const basis = `${data.metricInfo.name} · ${{ day: '일별', week: '주별', month: '월별', year: '연별' }[data.period]} · ${data.by.label} 기준${data.filter ? ` · ${data.filter.label}만` : ''}${data.range ? ` · ${data.range.label}` : ''} · ${data.asOf}`;
    const checks = result?.checks?.length ? `<div><h4>확인할 것</h4><ul>${result.checks.map((x, i) => {
      const linked = cardRequest(data, x.factIds);
      return `<li><span class="air-rich">${ai.rich(x.text, esc)}</span>${ai.evidence(x.evidence, esc)}<div class="tr-insight-actions">${linked
        ? `<button type="button" class="button" data-ca-open-case="${esc(linked.id)}">업무 열기</button>`
        : `<button type="button" class="button" data-ca-request="${i}" ${data.insightFactIds && body?.status === 'ready' ? '' : 'disabled'}>업무 만들기</button>`}<button type="button" class="button" data-ca-flow>처리할 업무 보기</button></div></li>`;
    }).join('')}</ul></div>` : '';
    const values = data.facts?.find(f => f.item === 1 && f.kind === 'current')?.values || {};
    const { current, previous, median } = values, unit = data.metricInfo.unit, better = data.metricInfo.better;
    const change = (base, label) => {
      if (base == null || current == null) return null;
      const delta = current - base;
      return { label, text: delta === 0 ? '변화 없음' : `${delta > 0 ? '▲ 증가' : '▼ 감소'} ${shown(Math.abs(delta), unit === '%' ? '%p' : unit)}`, tone: ai.tone(delta, better) };
    };
    const codeSummary = `${data.metricInfo.name} ${shown(current, unit)}`;
    return `<div class="tr-insight"><div class="tr-insight-head"><h3>AI 분석</h3><button type="button" class="button" data-ca-make="${esc(data.metric)}" ${body?.enabled === false || state.status === 'making' ? 'disabled' : ''}>${state.status === 'making' ? '만드는 중…' : 'AI 분석'}</button></div>`
      + (body?.note && body.status !== 'empty' && !body.note.includes('이 화면의 버튼으로만') ? `<p class="v3s-note">${esc(body.note)}</p>` : '')
      + (result ? `${ai.html({ model: result.modelLabel, at: result.createdAt, basis })}${ai.summary(codeSummary, esc, [change(previous, '직전 대비'), change(median, '평소 가운데값 대비')].filter(Boolean))}<p class="air-rich">${ai.rich(result.summary.text, esc)}${ai.evidence(result.summary.evidence, esc)}</p>${lines(result.watch, '눈여겨볼 점')}${checks}` : '')
      + (state.status === 'loading' ? '<p class="v3s-note">저장된 문장을 확인하는 중…</p>' : '')
      + (state.status === 'error' ? `<p class="v3s-note">${esc(state.error)}</p>` : '')
      + (body?.status === 'empty' ? '<p class="v3s-note">이 선택으로 만든 AI 분석이 없습니다.</p>' : '')
      + (body?.enabled === false ? '<p class="v3s-note">이 서버에서는 AI 분석이 꺼져 있습니다.</p>' : '')
      + '</div>';
  }
  function analysisBox(entry) {
    if (!entry) return '';
    if (entry.status === 'error') return `<section class="tr-analysis" aria-label="카드 분석"><h2>카드 분석</h2><p class="v3s-note">${esc(entry.error || '분석을 불러오지 못했습니다.')}</p></section>`;
    if (!entry.data) return `<section class="tr-analysis" aria-label="카드 분석"${entry.status === 'ready' ? '' : ' aria-busy="true"'}><h2>카드 분석</h2><p class="v3s-note">${entry.status === 'ready' ? '이 카드의 분석 자료가 없습니다.' : '계산 중…'}</p></section>`;
    const facts = entry.data.facts || [];
    const groups = ANALYSIS_ITEMS.map((title, i) => {
      const lines = facts.filter(f => f.item === i + 1);
      const records = i === 2 && entry.data.records?.length ? `<details class="tr-analysis-records" data-ca-roster="${esc(entry.data.metric)}" ${analysisOpen.has(entry.data.metric) ? 'open' : ''}><summary>명단 ${fmt(entry.data.records.length)}건 보기</summary><ol>${entry.data.records.map(r => {
        const ref = r.refs?.[0];
        return `<li>${ref ? `<button type="button" class="ax-text-link" data-ca-record="${esc(ref.id)}" data-ca-type="${esc(ref.type)}" data-ca-metric="${esc(entry.data.metric)}">${esc(r.text)}</button>` : esc(r.text)}</li>`;
      }).join('')}</ol></details>` : '';
      return `<section class="tr-analysis-item"><h3>${i + 1}. ${title}</h3><ol>${lines.map(f => {
        const ref = f.kind === 'record' && f.refs?.[0], open = ref ? `<button type="button" class="ax-text-link" data-ca-record="${esc(ref.id)}" data-ca-type="${esc(ref.type)}" data-ca-metric="${esc(entry.data.metric)}">${esc(f.text)}</button>` : esc(f.text);
        return `<li data-fact="${esc(f.id)}">${open}${i === 3 && f.kind === 'flow' ? ' <button type="button" class="ax-text-link" data-ca-flow>처리할 업무 보기</button>' : ''}</li>`;
      }).join('') || '<li>비교할 기록이 없습니다.</li>'}</ol>${records}</section>`;
    }).join('');
    const a = entry.data, grain = { day: '일별', week: '주별', month: '월별', year: '연별' }[a.period] || '기간';
    return `<section class="tr-analysis" aria-label="카드 분석"><div class="tr-analysis-head"><h2>카드 분석</h2><small>${esc(`${grain} · ${a.by.label} 기준${a.filter ? ` · ${a.filter.label}만` : ''}${a.range ? ` · ${a.range.label}` : ''} · ${a.asOf}`)}</small></div><div class="tr-analysis-grid">${groups}</div>${insightBox(entry.data)}</section>`;
  }
  const changeOf = (p, q, unit, better) => {
    if (p?.value == null || q?.value == null) return { text: '—', tone: '' };
    const d = p.value - q.value; if (!d) return { text: '변화 없음', tone: '' };
    const good = better === 'up' ? d > 0 : better === 'down' ? d < 0 : null;
    return { text: `${d > 0 ? '▲' : '▼'} ${unit === '%' ? `${Math.abs(d).toFixed(1)}%p` : fmt(Math.abs(d))}`, tone: good === null ? '' : good ? 'good' : 'bad' };
  };
  // 팝오버의 줄마다 직전 창 대비(원장 10-28 "오버레이 가로를 조금 더 늘려서 항목별 변화 추이") — live.js fillTip의 셋째 칸(delta).
  // 비율 = %p · 건수 = 단위 그대로(▲ 3명) · 같으면 '–' · 직전 창이 기록 없음(첫 창 포함)이면 빈 칸 · 색은 지표의 좋아지는 방향(좋아짐 빨강 · 나빠짐 파랑).
  const deltaOf = (p, q, unit, better) => {
    if (p?.value == null || q?.value == null) return { text: '' };
    const dv = p.value - q.value; if (!dv) return { text: '–' };
    const good = better === 'up' ? dv > 0 : better === 'down' ? dv < 0 : null;
    return { text: `${dv > 0 ? '▲' : '▼'} ${unit === '%' ? `${Math.abs(dv).toFixed(1)}%p` : `${fmt(Math.abs(dv))}${unit}`}`, ...(good === null ? {} : { tone: good ? 'good' : 'bad' }) };
  };
  // 분자 / 분모는 비율 지표만(건수 지표는 분모가 1이라 '333 / 1'로 보였다).
  const ratio = (p, unit = '%') => (unit === '%' && p && p.den != null ? `${fmt(p.num)} / ${fmt(p.den)}` : '');
  const tip = (title, rows, meta) => esc(JSON.stringify({ title, rows, meta: meta.filter(Boolean) }));
  // 하루 창은 요일을 붙인다(일마다 나눠 볼 때 어느 요일인지가 곧 정보다) — 축은 점이 14개 이하일 때만(31일이면 글자가 겹친다).
  const dow = day => '일월화수목금토'[new Date(`${day}T12:00:00Z`).getUTCDay()];
  const dayName = w => (w.from === w.to ? `${w.label}(${dow(w.from)})` : w.label);
  const when = w => (w.from === w.to ? dayName(w) : `${w.label} (${w.from} ~ ${w.to})`);
  const grainName = (d, id) => d.grains.find(g => g.id === id)?.label || '';

  // 기준별 꺾은선(원장 10-28 "꺾은선도 과목별로 표시할 수 있게" · "여기도 선생님별 추세선 보이게. 다른 비슷한 확장 추세는 전부").
  // 과목·프로그램은 정해 준 색(원장 10-28 "수학 파란색 영어 빨간색. EiE 주황색"), 그 밖의 줄은 줄 순서대로 같은 색을 받는다(정렬·켜고 끄기에 색이 바뀌지 않게).
  // 줄이 8개 이하면 모두, 많으면 큰 줄(대상이 많은 순) 다섯을 먼저 그리고 표의 칸으로 켜고 끈다. 전체는 굵은 검은 선.
  // 과목 색은 앱 전체 한 곳(live.js subjectColor — 수학 파랑 · 영어 빨강 · EiE 주황 · 영어+수학 보라 · 미수강·모름 회색).
  const PALETTE = ['#0f766e', '#7c3aed', '#b45309', '#be185d', '#4d7c0f', '#0e7490', '#9f1239', '#57534e', '#a16207', '#4338ca', '#15803d', '#c2410c'];
  const SUBJECT_DIMS = new Set(['subject', 'program', 'mix', 'combo']);
  const colorOf = (d, r, i) => (SUBJECT_DIMS.has(d.by) && last?.api?.subjectColor?.(r.key)) || PALETTE[i % PALETTE.length];
  // 보여 주지 않는 줄(원장 10-28 "그 밖의 과목은 제외") — 전체 값에는 그대로 든다.
  const HIDDEN_ROWS = new Set(['otherOnly']);
  // 줄 차례 = 과목 줄들 → 동시 등록(both · 원장 10-28 "등록은 동시등록도 적어줄것") → 모름·미수강·그 밖·담당 모름. 그래프·범례·팝오버·표가 같은 차례
  // (표는 고른 정렬을 이 묶음 안에서 한다). 지금 보이는 창 모두에서 0이거나 기록 없는 줄은 서버가 이미 뺐다(원장 10-28 "구간 전체에 대해서 0이면 그냥 보여주지말것").
  const TAIL = /^(unknown|none|nothing|other|unassigned)$/i;
  const rankOf = key => (key === 'both' ? 1 : TAIL.test(String(key)) ? 2 : 0);
  const rowsOf = d => d.rows.filter(r => !HIDDEN_ROWS.has(r.key)).sort((a, b) => rankOf(a.key) - rankOf(b.key));
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
  // 좁힌 그 줄 = 굵은 합계 선과 같은 값 — 따로 그리지 않는다(원장 10-29 "전체는 뭐고 학원 전체는 뭐야? 이상한데 헷갈림").
  // 합계 선 색 = 다른 줄이 함께 그려지면 검정, 혼자면 기본 남색(.tr-line · .tr-chart.has-series) — 범례·표의 색 표시도 이 색.
  const isFilterRow = (d, key) => !!d.filter && d.by === d.filter.dim && key === d.filter.key;
  const sumColor = many => (many ? '#121212' : 'var(--ax-primary)');

  // 큰 추세: 비율은 0~100 고정, 건수는 딱 떨어지는 눈금 — 값이 0에서 멀면(가장 작은 값이 가장 큰 값의 30%를 넘으면) 값 범위에 맞춰
  // 변화가 보이게 한다(재원생 402→333이 0~600 축에선 평평했다). 기록이 없는 기간은 선을 잇지 않는다. 점마다 앱 팝오버(마우스·키보드·터치).
  // 그림 폭 = 화면에 놓일 실제 폭(글자가 화면 폭에 비례해 커지지 않게 — 760 폭을 1,400px로 늘리면 축 글자가 20px을 넘었다).
  const nice = raw => { const mag = 10 ** Math.floor(Math.log10(raw)), k = raw / mag; return Math.max((k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * mag, 1); };
  function bigChart(d, base, series) {
    // 굵은 선 = 지금 보는 범위의 합계 — 좁혔으면 그 범위 이름(인재원 영어), 아니면 '학원 전체'(좁힌 화면에서 '전체' · '학원 전체' · '인재원 영어'가 뜻이 겹쳐 보였다).
    series = series.filter(s => !isFilterRow(d, s.key));
    const sumName = d.filter ? d.filter.label : '학원 전체';
    const room = document.querySelector('[data-v2-screen="trend"] .tr-main')?.clientWidth || document.querySelector('#main')?.clientWidth || 800;
    // 오른쪽 여백 = 마지막 축 이름의 반 폭(가운데 맞춤이라 끝 이름이 그림 밖으로 잘렸다 — 주별 '10/21~10/27' 19px · 요일 붙인 '10/20(화)' 10px). 글자 폭은 어림(숫자·기호 7 · 한글 13).
    const n = d.windows.length, axisName = n <= 14 ? dayName : w => w.label, half = s => Math.ceil([...s].reduce((t, ch) => t + (ch.charCodeAt(0) > 0x3000 ? 13 : 7), 0) / 2);
    const W = Math.max(560, Math.round(room - 34)), H = 300, L = 52, R = Math.max(16, n ? half(axisName(d.windows[n - 1])) + 4 : 16), T = 18, B = 34, pct = d.metric.unit === '%';
    const vals = [...d.total, ...(base?.total || []), ...series.flatMap(s => s.points)].map(p => p?.value).filter(v => v != null);
    let min = 0, max = 100, tick = 20;
    if (!pct) {
      const top = Math.max(...vals, 1), low = vals.length ? Math.min(...vals) : 0;
      if (low > top * 0.3 && top > low) { tick = nice((top - low) / 4); min = Math.max(0, tick * Math.floor((low - tick / 2) / tick)); max = tick * Math.ceil((top + tick / 4) / tick); }
      else { tick = nice(top / 4); max = tick * Math.ceil(top / tick); }
    }
    const x = i => L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1)), y = v => T + (H - T - B) * (1 - (v - min) / (max - min)), step = (W - L - R) / Math.max(n - 1, 1);
    const grid = Array.from({ length: Math.round((max - min) / tick) + 1 }, (_, i) => { const v = min + tick * i; return `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${pct ? `${v}%` : fmt(v)}</text>`; }).join('');
    // 구간마다 흐린 점선 세로선(원장 10-28 "구간마다 점선 세로선을 그어서 쉽게 위치 파악") — 선·점보다 뒤에.
    const vlines = d.windows.map((_, i) => `<line class="col-line" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`).join('');
    const path = list => { const runs = []; list.forEach((p, i) => { if (p?.value == null) return; if (i && list[i - 1]?.value != null) runs.at(-1).push(i); else runs.push([i]); });
      return runs.map(r => (r.length === 1 ? `<circle class="tr-solo" cx="${x(r[0])}" cy="${y(list[r[0]].value)}" r="3"/>` : `<polyline points="${r.map(i => `${x(i)},${y(list[i].value)}`).join(' ')}"/>`)).join(''); };
    const every = Math.ceil(n / 12), name = d.filter?.label ? `${d.filter.label} · ${d.metric.label}` : d.metric.label, many = series.length > 0;
    // 쪼갤 수 있는 점(기록이 있고 지표가 더 잘게 나눠지는 단위) = data-tr-drill — 누르면(키보드 Enter) 그 기간을 한 단계 잘게. 그 밖의 점은 누를 수 있어 보이지 않는다.
    const sub = d.drill ? grainName(d, d.drill) : '';
    // 기준별 줄도 기간마다 동그라미(원장 10-28 "과목에도 동그라미를 기간마다 두고 한번에 볼 수 있게") — 흰 바탕 · 그 줄 색 테두리, 기록 없는 기간엔 없음.
    // 점은 그 기간의 칸(chart-col) 안에 그려 마우스·초점이 간 기간의 모든 줄 점이 함께 채워진다(같은 세로선).
    const cols = d.windows.map((w, i) => {
      const p = d.total[i], q = i ? d.total[i - 1] : null, b = base?.total?.[i], drill = sub && p?.value != null, u = d.metric.unit, bt = d.metric.better;
      // 합계 선 이름은 범례와 같은 sumName 하나(원장 10-29 "라벨은 항상 동일하게" · "같은 곳을 보면 문구, 수치 모든곳이 동일해야함").
      const rows = [{ label: sumName, value: shown(p?.value, u), tone: 'primary', color: many ? '#121212' : '', delta: deltaOf(p, q, u, bt) },
        ...(base ? [{ label: '학원 전체', value: shown(b?.value, u), tone: 'secondary', delta: deltaOf(b, i ? base.total[i - 1] : null, u, bt) }] : []),
        ...series.map(s => ({ label: s.label, value: shown(s.points[i]?.value, u), color: s.color, delta: deltaOf(s.points[i], i ? s.points[i - 1] : null, u, bt) }))];
      const dots = series.map(s => (s.points[i]?.value == null ? '' : `<circle class="tr-sdot" style="--c:${s.color}" cx="${x(i)}" cy="${y(s.points[i].value)}" r="3.5"/>`)).join('');
      return `<g class="chart-col" data-point${drill ? ` data-tr-drill="${i}"` : ''} data-tip="${tip(when(w), rows, [ratio(p, u), d.cleanupNotes?.[i], drill ? `눌러서 ${sub}로 보기` : ''])}">`
        + `<rect class="chart-hit" x="${x(i) - step / 2}" y="${T - 8}" width="${step}" height="${H - B - T + 8}"/>` + dots
        + (p?.value == null ? `<text data-anchor x="${x(i)}" y="${H - B - 6}" text-anchor="middle">—</text>` : `<circle class="tr-dot" data-anchor cx="${x(i)}" cy="${y(p.value)}" r="4"/>`)
        + (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(axisName(w))}</text>` : '') + '</g>';
    }).join('');
    const lines = series.map(s => `<g class="tr-line series" style="--c:${s.color}">${path(s.points)}</g>`).join('');
    // 범례는 선이 하나여도 늘 — 범례가 있다 없다에 따라 같은 선의 이름이 바뀌지 않게.
    const legend = `<div class="tr-legend">${[`<span><i class="sum" style="background:${sumColor(many)}"></i>${esc(sumName)}</span>`, ...(base ? ['<span><i class="alt"></i>학원 전체</span>'] : []),
      ...series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`)].join('')}</div>`;
    return `<div class="chart-box tr-chart${many ? ' has-series' : ''}" data-chart tabindex="0" role="group" aria-label="${esc(name)} 추세 — 화살표 키로 기간을 옮기며 수치를 확인합니다${sub ? `. Enter로 그 기간을 ${sub}로 나눠 봅니다` : ''}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} ${d.windows.map((w, i) => `${w.label} ${shown(d.total[i]?.value, d.metric.unit)}`).join(', ')}">${grid}${vlines}${base ? `<g class="tr-line base">${path(base.total)}</g>` : ''}${lines}<g class="tr-line">${path(d.total)}</g>${cols}</svg></div>${legend}`;
  }

  // 기준별 표의 정보 칸(원장 10-28 "각 선생님의 과목, 담당 반 수, 담당 원생 수 표시") — 서버가 줄마다 meta로 준다(화면에 보이는 범위에 운영된 반 · 수강이 겹친 원생 기준).
  // [열쇠, 제목, 맞춤] — 제목과 값은 같은 쪽(원장 10-28 "각 항목별로 가운데정렬할지 왼쪽 혹은 오른쪽 정렬할지는 알아서"): 수(반 수·원생 수) 오른쪽 · 짧은 글(과목·담임·학교학년) 가운데 · 긴 글(원생의 반 목록) 왼쪽.
  const META_COLS = {
    teacher: [['subjects', '과목', 'c'], ['classes', '담당 반', 'r'], ['students', '담당 원생', 'r']],
    class: [['subjects', '과목', 'c'], ['teacher', '담임', 'c'], ['students', '원생', 'r']],
    subject: [['classes', '반', 'r'], ['students', '원생', 'r']],
    student: [['school', '학교·학년', 'c'], ['classes', '반', 'l']],
  };
  const metaCell = (k, v) => (v == null || v === '' ? '' : typeof v !== 'number' ? String(v) : k === 'classes' ? `${fmt(v)}개` : k === 'students' ? `${fmt(v)}명` : fmt(v));
  // 쉬운 거르기(원장 10-28 "전체 선택 및 필터링 쉽게 가능하게") — 표 위 한 줄: 이름 찾기 + 정보 칸의 빠른 칩(과목 · 담임 — 값이 2~8가지인 글 칸).
  // 화면 안에서만 거른다(서버를 다시 부르지 않는다) · 칩은 한 칸 안에선 '또는', 칸끼리는 '그리고' · 지표·기준·필터가 바뀌면 처음으로. 그래프 선은 거르지 않는다(선은 표의 칸이 정한다).
  const CHIP_MAX = 8;
  const splitMeta = v => (typeof v === 'string' ? v.split(', ').map(s => s.trim()).filter(Boolean) : []);
  const finder = { view: '', q: '', chips: new Set() };
  const findOf = d => { const k = viewKey(d); if (finder.view !== k) Object.assign(finder, { view: k, q: '', chips: new Set() }); return finder; };
  const chipGroups = (d, metaCols) => metaCols.filter(([, , a]) => a === 'c')
    .map(([k, l]) => ({ k, l, values: [...new Set(rowsOf(d).flatMap(r => splitMeta(r.meta?.[k])))].sort((a, b) => a.localeCompare(b, 'ko')) }))
    .filter(g => g.values.length >= 2 && g.values.length <= CHIP_MAX);
  const matcher = (f, groups) => { const q = f.q.trim().toLowerCase();
    return r => (!q || String(r.label).toLowerCase().includes(q)) && groups.every(g => { const on = g.values.filter(v => f.chips.has(`${g.k}:${v}`)); return !on.length || splitMeta(r.meta?.[g.k]).some(v => on.includes(v)); }); };
  function table(d, api) {
    const li = d.windows.length - 1, dim = d.metric.dims.find(x => x.id === d.by), unit = d.metric.unit, better = d.metric.better, noun = dim?.label.replace(/별$/, '') || '이름';
    const all = rowsOf(d), order = new Map(all.map((r, i) => [r.key, i])), on = shownKeys(d), metaCols = d.rows.some(r => r.meta) ? META_COLS[d.by] || [] : [];
    const f = findOf(d), groups = chipGroups(d, metaCols), hit = matcher(f, groups);
    const rows = all.filter(hit).map(r => ({ ...r, now: r.points[li], prev: li ? r.points[li - 1] : null }));
    const val = r => r.now?.value, sign = better === 'down' ? 1 : -1;
    const cmp = {
      value: (a, b) => (val(a) == null) - (val(b) == null) || (val(a) - val(b)) * (sort.dir ? sign : -sign) || (b.now?.den ?? 0) - (a.now?.den ?? 0),
      name: (a, b) => a.label.localeCompare(b.label, 'ko') * (sort.dir ? -1 : 1),
      den: (a, b) => ((b.now?.den ?? b.now?.num ?? 0) - (a.now?.den ?? a.now?.num ?? 0)) * (sort.dir ? -1 : 1),
      change: (a, b) => { const ch = r => (r.now?.value != null && r.prev?.value != null ? r.now.value - r.prev.value : null); return (ch(a) == null) - (ch(b) == null) || (ch(a) - ch(b)) * (sort.dir ? sign : -sign); },
    }[sort.key];
    rows.sort((a, b) => rankOf(a.key) - rankOf(b.key) || cmp(a, b));
    // 정렬 화살표는 제목 옆에 떠 있게(자리를 차지하면 가운데·오른쪽 제목이 값과 어긋난다) — 오른쪽 맞춤 칸은 제목 왼쪽에.
    const head = (key, label, a) => `<th class="${a}"><button type="button" data-tr-sort="${key}" aria-pressed="${sort.key === key}">${label}${sort.key === key ? `<i class="tr-arrow" aria-hidden="true">${sort.dir ? '↑' : '↓'}</i>` : ''}</button></th>`;
    const cut = showAll ? rows : rows.slice(0, 20), w = d.windows[li];
    // 전체 선택 = 거른 줄 모두(보이지 않는 '나머지'까지) — 그래프 선 켜고 끄기와 같은 picked. 일부만 켜졌으면 반쯤(indeterminate, 그린 뒤 render가 건다).
    // 좁힌 그 줄은 합계 선이라 켜고 끄는 대상이 아니다(isFilterRow).
    const keys = rows.filter(r => !isFilterRow(d, r.key)).map(r => r.key), lit = keys.filter(k => on.has(k)).length; last.visibleKeys = keys;
    const pickAll = `<input type="checkbox" data-tr-all ${keys.length && lit === keys.length ? 'checked' : ''} ${lit && lit < keys.length ? 'data-mixed' : ''} ${keys.length ? '' : 'disabled'} aria-label="보이는 ${esc(noun)} 모두 그래프에 표시">`;
    const tools = all.length >= 6 || f.q || f.chips.size
      ? `<div class="tr-tools"><input type="search" id="tr-find" class="tr-find" data-tr-find value="${esc(f.q)}" placeholder="${esc(noun)} 찾기" aria-label="${esc(noun)} 이름으로 거르기" autocomplete="off">`
        + groups.map(g => `<div class="tr-chips" role="group" aria-label="${esc(g.l)}">${g.values.map(v => `<button type="button" class="tr-chip" data-tr-chip="${esc(`${g.k}:${v}`)}" aria-pressed="${f.chips.has(`${g.k}:${v}`)}">${esc(v)}</button>`).join('')}</div>`).join('') + '</div>'
      : '';
    const ncols = 2 + metaCols.length + 2 + (unit === '%' ? 1 : 0) + 2;
    return `<section class="tr-break"><h3>${esc(dim?.label || '기준별')} <span>${esc(dayName(w))}</span></h3>${tools}`
      + `<div class="tr-table-wrap"><table class="tr-table"><thead><tr><th class="tr-pick c"><label>${pickAll}<i class="tr-pick-pad" aria-hidden="true"></i></label></th>${head('name', esc(noun), 'l')}${metaCols.map(([k, l, a]) => `<th class="tr-meta ${a}${a === 'l' ? ' wide' : ''}">${l}</th>`).join('')}`
      + `${head('value', '값', 'r num')}${head('change', '직전 대비', 'c num')}${unit === '%' ? head('den', '대상', 'c num') : ''}<th class="c">추세</th><th class="r"></th></tr></thead><tbody>`
      + (cut.length ? cut.map(r => { const c = changeOf(r.now, r.prev, unit, better);
        // 좁힌 그 줄 = 그래프의 굵은 합계 선(따로 그리지 않는다 — bigChart) · 색도 합계 선 색, 체크는 켠 채 잠금.
        const filterRow = isFilterRow(d, r.key), color = filterRow ? sumColor(seriesOf(d).some(s => !isFilterRow(d, s.key))) : colorOf(d, r, order.get(r.key));
        const box = filterRow ? `checked disabled aria-label="${esc(r.label)} — 그래프의 굵은 선"` : `${on.has(r.key) ? 'checked' : ''} aria-label="${esc(r.label)} 그래프에 표시"`;
        return `<tr><td class="tr-pick c"><label><input type="checkbox" data-tr-line="${esc(r.key)}" ${box}><i style="background:${color}"></i></label></td><th scope="row" class="l">${esc(r.label)}</th>`
          + metaCols.map(([k, , a]) => `<td class="tr-meta ${a}${a === 'r' ? ' num' : ''}${a === 'l' ? ' wide' : ''}">${esc(metaCell(k, r.meta?.[k]))}</td>`).join('')
          + `<td class="r num"><strong>${shown(r.now?.value, unit)}</strong></td><td class="c num ${c.tone}">${c.text}</td>${unit === '%' ? `<td class="c num">${ratio(r.now)}</td>` : ''}`
          + `<td class="tr-spark c">${api.lineChart(r.points.map((p, i) => ({ label: d.windows[i].label, value: p?.value ?? null })), { key: 'value', label: r.label, unit, compare: '직전', better })}</td>`
          + `<td class="r"><button type="button" class="ax-text-link" data-tr-filter="${esc(r.key)}">자세히 보기</button></td></tr>`; }).join('')
        : `<tr><td class="c" colspan="${ncols}">맞는 줄이 없습니다</td></tr>`)
      + `</tbody></table></div>${rows.length > cut.length ? `<button type="button" class="button" data-tr-more>나머지 ${fmt(rows.length - cut.length)}개 더 보기</button>` : ''}</section>`;
  }

  // 명단(원장 10-28 "자세히보기를 눌러 들어왔을때 이걸 체크할 수 있는 리스트가 있으면 더 좋을듯. 아래쪽에. 스크롤해서 내려갔을때") —
  // 필터를 건 보기에서 지표가 records(창마다 그 숫자를 이루는 기록)를 줄 때만. 최근 창이 먼저 · 0건인 창은 건너뛰고 모두 0이면 구역째 없음.
  // 열 = 기간 | 이름 | 학교·학년 | 담당 선생님(퇴원 계열) | (날짜) | 내용 — 이름은 열 수 있는 기록이면 단추(api.openRecord). 200줄까지.
  const ROSTER_MAX = 200;
  const reportState = { key: '', window: -1, page: 1 };
  const REPORT_PAGE = 50;
  function reportRoster(d) {
    const key = `${viewKey(d)}|${d.grain}|${d.range?.from || ''}|${d.range?.to || ''}|${d.windows[0]?.from || ''}`;
    if (reportState.key !== key) Object.assign(reportState, { key, window: d.windows.length - 1, page: 1 });
    const wi = Math.min(Math.max(reportState.window, 0), d.windows.length - 1);
    const rows = Array.isArray(d.records[wi]) ? d.records[wi] : [];
    const ordered = [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className, 'ko') || a.name.localeCompare(b.name, 'ko'));
    const pages = Math.max(1, Math.ceil(ordered.length / REPORT_PAGE)); reportState.page = Math.min(reportState.page, pages);
    const shown = ordered.slice((reportState.page - 1) * REPORT_PAGE, reportState.page * REPORT_PAGE);
    const written = rows.filter(r => r.written).length, point = d.total[wi];
    const aligned = point && point.num === written && point.den === rows.length;
    return `<section class="tr-break tr-roster tr-report-roster"><h3>작성 의무 명단 <span>${esc(d.filter.label)} · ${fmt(ordered.length)}건</span></h3>`
      + `<div class="tr-report-controls"><label>기간 <select data-tr-report-window aria-label="보고서 명단 기간">${d.windows.map((w, i) => `<option value="${i}"${i === wi ? ' selected' : ''}>${esc(dayName(w))}</option>`).join('')}</select></label>`
      + `<span>작성 ${fmt(written)}건 · 미작성 ${fmt(rows.length - written)}건${aligned ? '' : ' · 집계 확인 필요'}</span></div>`
      + `<div class="tr-table-wrap"><table class="tr-roster-table"><thead><tr><th scope="col">수업일</th><th scope="col">반</th><th scope="col">원생</th><th scope="col">작성</th><th scope="col">기록</th></tr></thead>`
      + `<tbody>${shown.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.className)}</td><td>${esc(r.name)}</td><td>${r.written ? '작성' : '미작성'}</td><td>${r.reportId ? `<button type="button" class="ax-text-link" data-tr-report="${esc(r.reportId)}">보고서 열기</button>` : r.source === 'classnote' && r.written ? '알림장 게시' : '—'}</td></tr>`).join('') || '<tr><td colspan="5">이 기간의 작성 의무가 없습니다.</td></tr>'}</tbody></table></div>`
      + (pages > 1 ? `<div class="tr-report-pages"><button type="button" data-tr-report-page="prev"${reportState.page === 1 ? ' disabled' : ''}>이전</button><span>${reportState.page} / ${pages}</span><button type="button" data-tr-report-page="next"${reportState.page === pages ? ' disabled' : ''}>다음</button></div>` : '')
      + '</section>';
  }
  const dateText = (day, asOf) => (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? '' : day.slice(0, 4) === String(asOf || '').slice(0, 4)
    ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : `${day.slice(2, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}`);
  function roster(d, api) {
    if (!d.filter || !Array.isArray(d.records)) return '';
    if (d.metric.id === 'report-written') return reportRoster(d);
    const groups = d.windows.map((w, i) => ({ w, list: Array.isArray(d.records[i]) ? d.records[i].filter(r => r && r.name) : [] })).filter(g => g.list.length).reverse();
    const total = groups.reduce((n, g) => n + g.list.length, 0); if (!total) return '';
    const all = groups.flatMap(g => g.list), hasSub = all.some(r => r.sub), hasTeacher = all.some(r => 'teacher' in r), hasDate = all.some(r => r.date), hasNote = all.some(r => r.note);
    // 날짜 열 제목 = 기록의 날짜 이름(퇴원일 · 등록일 …) — 한 지표 안에서 섞이면(퇴원·수업종료) 제목은 '날짜', 칸마다 그 줄의 이름을 앞에('퇴원 10/16' · '수업종료 10/20').
    const dateNames = [...new Set(all.filter(r => r.date && r.dateLabel).map(r => r.dateLabel))], mixedDates = dateNames.length > 1;
    const dateHead = mixedDates ? '날짜' : dateNames[0] || '날짜', dateCell = r => [mixedDates && r.dateLabel ? String(r.dateLabel).replace(/일$/, '') : '', dateText(r.date, d.asOf)].filter(Boolean).join(' ');
    const who = r => (r.id != null && api.canOpenRecord?.(r.id) ? `<button type="button" class="ax-text-link" data-tr-open="${esc(r.id)}">${esc(r.name)}</button>` : esc(r.name));
    let left = ROSTER_MAX; const body = [];
    for (const g of groups) {
      if (left <= 0) break;
      const list = [...g.list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.name).localeCompare(String(b.name), 'ko')).slice(0, left); left -= list.length;
      list.forEach((r, k) => body.push(`<tr>${k ? '' : `<th scope="rowgroup" rowspan="${list.length}">${esc(dayName(g.w))}</th>`}<td>${who(r)}</td>`
        + `${hasSub ? `<td>${esc(r.sub || '')}</td>` : ''}${hasTeacher ? `<td class="l">${esc(r.teacher || '—')}</td>` : ''}${hasDate ? `<td>${esc(dateCell(r))}</td>` : ''}${hasNote ? `<td class="l">${esc(r.note || '')}</td>` : ''}</tr>`));
    }
    const shownN = ROSTER_MAX - Math.max(left, 0), cols = [['8.5em', '기간'], ['7em', '이름'], ...(hasSub ? [['8em', '학교·학년']] : []), ...(hasTeacher ? [['11em', '담당 선생님', 'l']] : []), ...(hasDate ? [[mixedDates ? '9.5em' : '6.5em', dateHead]] : []), ...(hasNote ? [['', '내용', 'l']] : [])];
    return `<section class="tr-break tr-roster"><h3>명단 <span>${esc(d.filter.label)} · ${fmt(total)}건</span></h3>`
      + `<div class="tr-table-wrap"><table class="tr-roster-table"><colgroup>${cols.map(([wd]) => `<col${wd ? ` style="width:${wd}"` : ''}>`).join('')}</colgroup>`
      + `<thead><tr>${cols.map(([, l, c]) => `<th scope="col"${c ? ` class="${c}"` : ''}>${esc(l)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`
      + (total > shownN ? `<p class="tr-roster-more">외 ${fmt(total - shownN)}건${d.drill ? ' — 점을 눌러 기간을 쪼개 보면 다 보입니다' : ''}</p>` : '') + '</section>';
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

  // '전체 선택'의 반쯤 상태는 속성이 아니라 그린 뒤의 값이다 — render가 끝나고(live.js가 같은 차례에 화면에 넣은 뒤) 건다.
  const markMixed = () => queueMicrotask(() => { const el = document.querySelector('[data-v2-screen="trend"] [data-tr-all][data-mixed]'); if (el) el.indeterminate = true; });

  function render(ctx) {
    // from·to·up = 쪼개 보는 범위(점을 누른 그 기간)와 나눈 창의 단위 — 주소에 실어 새로고침·뒤로 가기에도 같은 보기.
    const q = ctx.query, params = Object.fromEntries(['metric', 'grain', 'by', 'f', 'from', 'to', 'up'].map(k => [k, q.get(k) || '']));
    last = { params, go: ctx.go, api: ctx.api, by: last?.by || '' };
    const e = ctx.load(params);
    if (!e.data) {
      if (e.status === 'error') return `<p class="v3s-note">${esc(e.error || '불러오지 못했습니다.')}</p>`;
      return '<div class="tr" aria-busy="true"><p class="v3s-note">추세와 카드 분석 계산 중…</p><section class="tr-analysis" aria-label="카드 분석"><h2>카드 분석</h2><p class="v3s-note">계산 중…</p></section></div>';
    }
    const d = e.data;
    if (params.metric && d.metric.id !== params.metric) { lastHtml = ''; return '<p class="v3s-note">이 지표는 더 이상 제공하지 않습니다. 다른 지표를 열어 주세요.</p>'; }
    last.by = d.by; last.view = viewKey(d); last.d = d;
    const analysis = CARD_IDS.has(d.metric.id) ? ctx.load({ metric: d.metric.id, analysis: '1', grain: d.grain, by: d.by,
      ...(d.filter ? { f: `${d.filter.dim}:${d.filter.key}` } : {}), ...(d.range ? { from: d.range.from, to: d.range.to, up: d.range.up } : {}) }) : null;
    last.analysis = analysis?.data || null;
    const rq = d.range ? { from: d.range.from, to: d.range.to, up: d.range.up } : {}, li = d.windows.length - 1;
    // 학원 전체(필터를 걸었을 때의 비교선)는 같은 창의 시작일로 맞춘다 — 필터 쪽과 전체 쪽의 '기록 시작'이 달라 앞을 다르게 잘라도 칸이 어긋나지 않게.
    const all = d.filter ? ctx.load({ metric: d.metric.id, grain: d.grain, ...rq }).data : null;
    const base = all ? (m => ({ total: d.windows.map(w => m.get(w.from) ?? null) }))(new Map(all.windows.map((w, i) => [w.from, all.total[i]]))) : null;
    const p = d.total[li], c = changeOf(p, li ? d.total[li - 1] : null, d.metric.unit, d.metric.better), CP = window.ContextPicker;
    const cleanupNote = d.cleanupNotes?.[li];
    // 지표 고르개 = 지표 이름만(원장 10-28 "그냥 지표이름만 보여줘도 될거같음" · "마지막 21개는 필요없음" — 건수 줄은 CSS로 숨긴다). 영역 이름으로도 찾는다.
    const items = d.metrics.map(m => ({ value: m.id, title: m.label, search: `${m.label} ${m.group}` }));
    const picker = CP ? CP.html({ id: 'tr-metric', name: 'tr-metric', label: '지표', clearable: false, selected: [d.metric.id], ...CP.lists.choices({ items, columns: [{ key: 'name', label: '지표' }], noun: '지표', unit: '개' }) }) : '';
    const seg = (attr, list, cur) => list.map(x => `<button type="button" class="tab ${x.id === cur ? 'active' : ''}" ${attr}="${esc(x.id)}" aria-pressed="${x.id === cur}">${esc(x.label)}</button>`).join('');
    lastHtml = `<div class="tr"><div class="page-heading"><div><p class="ws-group">확장 추세</p><h1>${esc(d.metric.label)}</h1></div><div class="heading-actions">${picker}</div></div>${d.metric.detail ? `<p class="tr-metric-detail">${esc(d.metric.detail)}</p>` : ''}`
      + `<div class="tr-bar"><div class="tr-seg" role="group" aria-label="기간 단위">${seg('data-tr-grain', d.grains, d.grain)}</div><div class="tr-seg" role="group" aria-label="기준">${seg('data-tr-by', d.metric.dims.filter(x => (d.byOptions ? d.byOptions.includes(x.id) : x.id !== d.filter?.dim && !x.needsFilter)), d.by)}</div>`
      + (d.range ? `<span class="tr-filter tr-range"><strong>${esc(d.range.label)}</strong> ${esc(grainName(d, d.grain))}<button type="button" class="icon-button" data-tr-undrill aria-label="나눠 보기 닫기 — ${esc(grainName(d, d.range.up))} 보기로">×</button></span>` : '')
      + (d.filter ? `<span class="tr-filter"><strong>${esc(d.filter.label)}</strong>만 보는 중<button type="button" class="icon-button" data-tr-unfilter aria-label="필터 풀기">×</button></span>` : '') + '</div>'
      + analysisBox(analysis)
      + `<section class="tr-main"><div class="tr-now"><span>${esc(d.windows[li] ? dayName(d.windows[li]) : '')}</span><strong>${shown(p?.value, d.metric.unit)}</strong><small class="${c.tone}">${li ? `직전 대비 ${c.text}` : ''}</small><small>${ratio(p, d.metric.unit)}</small>${cleanupNote?`<small class="tr-cleanup-note">${esc(cleanupNote)}</small>`:''}</div>${bigChart(d, base, seriesOf(d))}</section>`
      + (d.rows.length ? table(d, ctx.api) : '<p class="v3s-note">이 조건의 기록이 없습니다.</p>') + roster(d, ctx.api) + '</div>';
    warm(d, params.grain);
    markMixed();
    return lastHtml;
  }

  S.register({ id: 'trend', label: '확장 추세', nav: false, native: true, render });

  const go = patch => { if (!last) return; showAll = false; last.go({ ...last.params, ...patch }); };
  const UNDRILL = { from: '', to: '', up: '' };
  // 쪼개 보기 — 누른 점의 창을 한 단계 잘게(기준·필터는 그대로). 떠 있던 팝오버는 옛 그래프의 것이라 닫는다.
  const drillParams = col => { const d = last?.d, w = d?.drill && d.windows[Number(col.dataset.trDrill)]; return w ? { grain: d.drill, from: w.from, to: w.to, up: d.grain } : null; };
  const drill = col => { const p = drillParams(col); if (!p) return; const pop = document.getElementById('chart-tip'); if (pop) pop.hidden = true; go(p); };
  // 터치는 첫 번째 탭이 팝오버(수치 확인), 같은 점을 한 번 더 누르면 쪼갠다 — 마우스는 올리면 팝오버, 누르면 쪼갠다.
  let down = null;
  document.addEventListener('pointerdown', ev => {
    const col = ev.target.closest?.('[data-v2-screen="trend"] .tr-chart .chart-col');
    down = col ? { touch: ev.pointerType !== 'mouse', armed: col.classList.contains('active') } : null;
  }, true);
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || !ev.target.matches?.('[data-v2-screen="trend"] .tr-chart[data-chart]')) return;
    const col = ev.target.querySelector('.chart-col.active[data-tr-drill]'); if (col) { ev.preventDefault(); drill(col); }
  });
  // 마우스가 쪼갤 수 있는 점에 잠시 머물면 그 범위를 서버에 미리 계산시킨다(누르는 순간 바로 뜨게 — 서버가 같은 조건의 답을 기억한다).
  // 한 번에 하나만 — 선생님 업무 지표의 연 → 월 쪼개기는 한 번에 몇 초라 점을 훑을 때마다 겹쳐 돌리면 서버가 밀린다(데우는 중이면 건너뛴다).
  const warmedDrill = new Set(); let dwell = 0, warming = false;
  document.addEventListener('pointerover', ev => {
    const col = ev.target.closest?.('[data-v2-screen="trend"] .tr-chart .chart-col[data-tr-drill]'); clearTimeout(dwell); if (!col || ev.pointerType !== 'mouse') return;
    dwell = setTimeout(() => {
      const p = col.isConnected && !warming ? drillParams(col) : null; if (!p) return; // 그사이 화면이 바뀌었으면 옛 점의 번호다
      // 필터를 걸었으면 '학원 전체' 비교선의 같은 범위도 함께(render가 그 둘을 읽는다).
      const qs = [{ ...last.params, ...p }, ...(last.params.f ? [{ metric: last.d.metric.id, ...p }] : [])]
        .map(one => new URLSearchParams(Object.entries(one).filter(([, v]) => v)).toString()).filter(q => !warmedDrill.has(q));
      if (!qs.length) return; warming = true; qs.forEach(q => warmedDrill.add(q));
      Promise.all(qs.map(q => fetch(`/api/v2/trend?${q}`, { headers: { Accept: 'application/json' } }).catch(() => warmedDrill.delete(q)))).finally(() => { warming = false; });
    }, 350);
  });
  document.addEventListener('click', ev => {
    const t = ev.target;
    // KPI 카드(어디를 눌러도) → 그 지표의 확장 추세. 카드 안의 링크·단추는 제 일을 한다.
    const card = t.closest?.('.ws-kpi[data-trend]');
    if (card && !t.closest('a,button')) { location.hash = `v2-trend?metric=${encodeURIComponent(card.dataset.trend)}&grain=${encodeURIComponent(card.dataset.grain || 'week')}`; return; }
    if (!t.closest?.('[data-v2-screen="trend"]')) return;
    const opened = t.closest('[data-ca-open-case]');
    if (opened) { last?.api?.openFlowCase?.(opened.dataset.caOpenCase); return; }
    const request = t.closest('[data-ca-request]');
    if (request) {
      const analysis = last?.analysis, saved = insightState.get(analysis?.selectionKey)?.data, check = saved?.result?.checks?.[Number(request.dataset.caRequest)];
      if (!analysis || saved?.status !== 'ready' || !check || !Array.isArray(analysis.insightFactIds)) return;
      const byId = new Map(analysis.insightFactIds.map((id, i) => [id, analysis.facts[i]]));
      const evidence = check.factIds.map(id => byId.get(id)).filter(Boolean);
      const refs = [...new Map(evidence.flatMap(f => f.refs || []).filter(r => r?.type && r?.id).map(r => [`${r.type}:${r.id}`, { type: String(r.type), id: String(r.id) }])).values()].slice(0, 100);
      const title = `${analysis.metricInfo.name} · ${check.text}`.slice(0, 80);
      const body = [`확인할 것 · ${check.text}`, '', '근거', ...evidence.map(f => `- ${f.text}`)].join('\n').slice(0, 2000);
      last.api.showCardRequest?.({ title, body, source: 'direct', draftKey: `card:${analysis.metric}:${factKey(check.factIds)}`,
        context: { familyLabel: `카드 분석 · ${analysis.metricInfo.name}`, card: { metric: analysis.metric, factIds: check.factIds, refs } } });
      return;
    }
    if (t.closest('[data-ca-flow]')) {
      const analysis = last?.analysis, fact = analysis?.facts?.find(f => f.item === 4);
      if (analysis) last.api.openCardFlow?.({ label: analysis.metricInfo?.name || '카드', tasks: analysis.flowLink?.tasks || [],
        signals: analysis.flowLink?.signals || [], caseIds: (fact?.refs || []).filter(r => r.type === 'flow').map(r => r.id) });
      return;
    }
    const make = t.closest('[data-ca-make]');
    if (make) {
      const metric = make.dataset.caMake, analysis = last?.analysis, state = insightState.get(analysis?.selectionKey);
      if (!state || state.status === 'making') return;
      state.status = 'making'; last?.api.render();
      const selected = { grain: analysis.period, by: analysis.by.id,
        ...(analysis.filter ? { f: `${analysis.filter.dim}:${analysis.filter.key}` } : {}),
        ...(analysis.range ? { from: analysis.range.from, to: analysis.range.to, up: analysis.range.up } : {}) };
      fetch(`/api/insight/cards?${new URLSearchParams({ metric, ...selected })}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })
        .then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.message || '문장을 만들지 못했습니다.'); return body; })
        .then(body => { if (insightState.get(analysis.selectionKey) === state) { state.status = 'ready'; state.data = body; last?.api.render(); } })
        .catch(error => { if (insightState.get(analysis.selectionKey) === state) { state.status = 'error'; state.error = error.message; last?.api.render(); } });
      return;
    }
    const record = t.closest('[data-ca-record]');
    if (record) { if (record.dataset.caMetric === 'report-written' && record.dataset.caType === 'record') last.api.showWorkspaceRecord?.('lesson-reports', record.dataset.caRecord); else last.api.openRecord?.(record.dataset.caRecord); return; }
    const col = t.closest('.tr-chart .chart-col[data-tr-drill]');
    if (col) { if (!down?.touch || down.armed) drill(col); return; }
    const b = t.closest('[data-tr-grain],[data-tr-by],[data-tr-filter],[data-tr-unfilter],[data-tr-undrill],[data-tr-sort],[data-tr-more],[data-tr-open],[data-tr-chip],[data-tr-report],[data-tr-report-page]'); if (!b) return;
    if (b.dataset.trReport) { last.api.showWorkspaceRecord?.('lesson-reports', b.dataset.trReport); return; }
    if (b.dataset.trReportPage) { reportState.page += b.dataset.trReportPage === 'next' ? 1 : -1; const node=document.querySelector('[data-v2-screen="trend"] .tr-report-roster'); if(node){node.outerHTML=reportRoster(last.d);document.querySelector(`[data-v2-screen="trend"] [data-tr-report-page="${b.dataset.trReportPage}"]`)?.focus({preventScroll:true});} return; }
    if (b.dataset.trOpen) { if(last.d.metric.id==='recent-absent')last.api.showAbsences?.(b.dataset.trOpen);else last.api.openRecord?.(b.dataset.trOpen); return; }
    if (b.dataset.trChip) { const k = b.dataset.trChip; if (finder.chips.has(k)) finder.chips.delete(k); else finder.chips.add(k); showAll = false; last.api.render(); return; }
    // 기간 단위를 바꾸면 쪼개 보기도 끝난다(쪼개 보는 중 눌린 단추 = 나눈 단위 — 누르면 그 단위의 보통 보기).
    if (b.dataset.trGrain) go({ grain: b.dataset.trGrain, ...UNDRILL });
    else if (b.hasAttribute('data-tr-undrill')) go({ grain: last.d?.range?.up || last.params.up || last.params.grain, ...UNDRILL });
    else if (b.dataset.trBy) go({ by: b.dataset.trBy });
    else if (b.dataset.trFilter) go({ f: `${last.by}:${b.dataset.trFilter}`, by: '' });
    else if (b.hasAttribute('data-tr-unfilter')) go({ f: '', by: '' });
    else if (b.dataset.trSort) { sort.dir = sort.key === b.dataset.trSort ? 1 - sort.dir : 0; sort.key = b.dataset.trSort; last.api.render(); }
    else if (b.hasAttribute('data-tr-more')) { showAll = true; last.api.render(); }
  });
  document.addEventListener('toggle', ev => { const id = ev.target?.dataset?.caRoster; if (id) { if (ev.target.open) analysisOpen.add(id); else analysisOpen.delete(id); } }, true);
  // 이름 찾기 — 글자마다 바로 거른다(화면 안에서만). 한글은 조합이 끝났을 때(조합 중에 다시 그리면 글자가 깨진다). 초점·커서는 live.js render가 id로 되살린다.
  const onFind = ev => { const el = ev.target; if (!last || el?.id !== 'tr-find' || ev.isComposing || finder.q === el.value) return; finder.q = el.value; showAll = false; last.api.render(); };
  document.addEventListener('input', onFind); document.addEventListener('compositionend', onFind);
  document.addEventListener('change', ev => {
    if (ev.target.matches?.('[data-v2-screen="trend"] [data-tr-report-window]') && last) { reportState.window=Number(ev.target.value); reportState.page=1; const node=document.querySelector('[data-v2-screen="trend"] .tr-report-roster'); if(node){node.outerHTML=reportRoster(last.d);document.querySelector('[data-v2-screen="trend"] [data-tr-report-window]')?.focus({preventScroll:true});} return; }
    // 전체 선택 = 거른 줄 모두 켜기(이미 다 켜져 있으면 모두 끄기).
    if (ev.target.matches?.('[data-v2-screen="trend"] [data-tr-all]') && last) {
      const set = picked.get(last.view), keys = last.visibleKeys || [];
      if (set) { const allOn = keys.every(k => set.has(k)); keys.forEach(k => (allOn ? set.delete(k) : set.add(k))); }
      last.api.render(); return;
    }
    // 표의 칸 = 그 줄의 꺾은선 켜고 끄기(그 지표·기준·필터에서만 기억).
    const line = ev.target.closest?.('[data-v2-screen="trend"] [data-tr-line]');
    if (line && last) { const set = picked.get(last.view); if (set) { if (line.checked) set.add(line.dataset.trLine); else set.delete(line.dataset.trLine); } last.api.render(); return; }
    const root = ev.target.closest?.('[data-cpick-name="tr-metric"]'); if (!root || !last) return;
    const v = root.querySelector('input[type=hidden]')?.value; if (v && v !== last.params.metric) { showAll = false; last.go({ metric: v, grain: last.params.grain }); }
  });
})();
