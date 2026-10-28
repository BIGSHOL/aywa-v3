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

  // 큰 추세: 비율은 0~100 고정, 건수는 딱 떨어지는 눈금 — 값이 0에서 멀면(가장 작은 값이 가장 큰 값의 30%를 넘으면) 값 범위에 맞춰
  // 변화가 보이게 한다(재원생 402→333이 0~600 축에선 평평했다). 기록이 없는 기간은 선을 잇지 않는다. 점마다 앱 팝오버(마우스·키보드·터치).
  // 그림 폭 = 화면에 놓일 실제 폭(글자가 화면 폭에 비례해 커지지 않게 — 760 폭을 1,400px로 늘리면 축 글자가 20px을 넘었다).
  const nice = raw => { const mag = 10 ** Math.floor(Math.log10(raw)), k = raw / mag; return Math.max((k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * mag, 1); };
  function bigChart(d, base, series) {
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
    const path = list => { const runs = []; list.forEach((p, i) => { if (p?.value == null) return; if (i && list[i - 1]?.value != null) runs.at(-1).push(i); else runs.push([i]); });
      return runs.map(r => (r.length === 1 ? `<circle class="tr-solo" cx="${x(r[0])}" cy="${y(list[r[0]].value)}" r="3"/>` : `<polyline points="${r.map(i => `${x(i)},${y(list[i].value)}`).join(' ')}"/>`)).join(''); };
    const every = Math.ceil(n / 12), name = d.filter?.label ? `${d.filter.label} · ${d.metric.label}` : d.metric.label, many = series.length > 0;
    // 쪼갤 수 있는 점(기록이 있고 지표가 더 잘게 나눠지는 단위) = data-tr-drill — 누르면(키보드 Enter) 그 기간을 한 단계 잘게. 그 밖의 점은 누를 수 있어 보이지 않는다.
    const sub = d.drill ? grainName(d, d.drill) : '';
    // 기준별 줄도 기간마다 동그라미(원장 10-28 "과목에도 동그라미를 기간마다 두고 한번에 볼 수 있게") — 흰 바탕 · 그 줄 색 테두리, 기록 없는 기간엔 없음.
    // 점은 그 기간의 칸(chart-col) 안에 그려 마우스·초점이 간 기간의 모든 줄 점이 함께 채워진다(같은 세로선).
    const cols = d.windows.map((w, i) => {
      const p = d.total[i], q = i ? d.total[i - 1] : null, b = base?.total?.[i], drill = sub && p?.value != null, u = d.metric.unit, bt = d.metric.better;
      const rows = [{ label: many ? `${name} (전체)` : name, value: shown(p?.value, u), tone: 'primary', color: many ? '#121212' : '', delta: deltaOf(p, q, u, bt) },
        ...(base ? [{ label: '학원 전체', value: shown(b?.value, u), tone: 'secondary', delta: deltaOf(b, i ? base.total[i - 1] : null, u, bt) }] : []),
        ...series.map(s => ({ label: s.label, value: shown(s.points[i]?.value, u), color: s.color, delta: deltaOf(s.points[i], i ? s.points[i - 1] : null, u, bt) }))];
      const dots = series.map(s => (s.points[i]?.value == null ? '' : `<circle class="tr-sdot" style="--c:${s.color}" cx="${x(i)}" cy="${y(s.points[i].value)}" r="3.5"/>`)).join('');
      return `<g class="chart-col" data-point${drill ? ` data-tr-drill="${i}"` : ''} data-tip="${tip(when(w), rows, [ratio(p, u), drill ? `눌러서 ${sub}로 보기` : ''])}">`
        + `<rect class="chart-hit" x="${x(i) - step / 2}" y="${T - 8}" width="${step}" height="${H - B - T + 8}"/>` + dots
        + (p?.value == null ? `<text data-anchor x="${x(i)}" y="${H - B - 6}" text-anchor="middle">—</text>` : `<circle class="tr-dot" data-anchor cx="${x(i)}" cy="${y(p.value)}" r="4"/>`)
        + (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(axisName(w))}</text>` : '') + '</g>';
    }).join('');
    const lines = series.map(s => `<g class="tr-line series" style="--c:${s.color}">${path(s.points)}</g>`).join('');
    const legend = many || base ? `<div class="tr-legend">${[`<span><i class="sum"></i>${esc(many ? '전체' : d.filter.label)}</span>`, ...(base ? ['<span><i class="alt"></i>학원 전체</span>'] : []),
      ...series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`)].join('')}</div>` : '';
    return `<div class="chart-box tr-chart${many ? ' has-series' : ''}" data-chart tabindex="0" role="group" aria-label="${esc(name)} 추세 — 화살표 키로 기간을 옮기며 수치를 확인합니다${sub ? `. Enter로 그 기간을 ${sub}로 나눠 봅니다` : ''}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} ${d.windows.map((w, i) => `${w.label} ${shown(d.total[i]?.value, d.metric.unit)}`).join(', ')}">${grid}${base ? `<g class="tr-line base">${path(base.total)}</g>` : ''}${lines}<g class="tr-line">${path(d.total)}</g>${cols}</svg></div>${legend}`;
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
    rows.sort((a, b) => rankOf(a.key) - rankOf(b.key) || cmp(a, b));
    const head = (key, label, cls = '') => `<th class="${cls}"><button type="button" data-tr-sort="${key}" aria-pressed="${sort.key === key}">${label}${sort.key === key ? (sort.dir ? ' ↑' : ' ↓') : ''}</button></th>`;
    const cut = showAll ? rows : rows.slice(0, 20), w = d.windows[li];
    return `<section class="tr-break"><h3>${esc(dim?.label || '기준별')} <span>${esc(dayName(w))}</span></h3>`
      + `<div class="tr-table-wrap"><table class="tr-table"><thead><tr><th class="tr-pick"><span class="ax-visually-hidden">그래프에 표시</span></th>${head('name', dim?.label.replace(/별$/, '') || '이름')}${metaCols.map(([k, l]) => `<th class="tr-meta ${k === 'subjects' || k === 'teacher' ? '' : 'num'}">${l}</th>`).join('')}${head('value', '값', 'num')}${head('change', '직전 대비', 'num')}${unit === '%' ? head('den', '대상', 'num') : ''}<th>추세</th><th></th></tr></thead><tbody>`
      + cut.map(r => { const c = changeOf(r.now, r.prev, unit, better), color = colorOf(d, r, order.get(r.key));
        return `<tr><td class="tr-pick"><label><input type="checkbox" data-tr-line="${esc(r.key)}" ${on.has(r.key) ? 'checked' : ''} aria-label="${esc(r.label)} 그래프에 표시"><i style="background:${color}"></i></label></td><th scope="row">${esc(r.label)}</th>`
          + metaCols.map(([k]) => `<td class="tr-meta ${k === 'subjects' || k === 'teacher' ? '' : 'num'}">${esc(metaCell(k, r.meta?.[k]))}</td>`).join('')
          + `<td class="num"><strong>${shown(r.now?.value, unit)}</strong></td><td class="num ${c.tone}">${c.text}</td>${unit === '%' ? `<td class="num">${ratio(r.now)}</td>` : ''}`
          + `<td class="tr-spark">${api.lineChart(r.points.map((p, i) => ({ label: d.windows[i].label, value: p?.value ?? null })), { key: 'value', label: r.label, unit, compare: '직전', better })}</td>`
          + `<td><button type="button" class="ax-text-link" data-tr-filter="${esc(r.key)}">자세히 보기</button></td></tr>`; }).join('')
      + `</tbody></table></div>${rows.length > cut.length ? `<button type="button" class="button" data-tr-more>나머지 ${fmt(rows.length - cut.length)}개 더 보기</button>` : ''}</section>`;
  }

  // 명단(원장 10-28 "자세히보기를 눌러 들어왔을때 이걸 체크할 수 있는 리스트가 있으면 더 좋을듯. 아래쪽에. 스크롤해서 내려갔을때") —
  // 필터를 건 보기에서 지표가 records(창마다 그 숫자를 이루는 기록)를 줄 때만. 최근 창이 먼저 · 0건인 창은 건너뛰고 모두 0이면 구역째 없음.
  // 열 = 기간 | 이름 | 학교·학년 | (날짜) | 내용 — 짧은 값은 가운데, 내용은 왼쪽. 이름은 열 수 있는 기록이면 단추(api.openRecord). 200줄까지.
  const ROSTER_MAX = 200;
  const dateText = (day, asOf) => (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? '' : day.slice(0, 4) === String(asOf || '').slice(0, 4)
    ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : `${day.slice(2, 4)}.${day.slice(5, 7)}.${day.slice(8, 10)}`);
  function roster(d, api) {
    if (!d.filter || !Array.isArray(d.records)) return '';
    const groups = d.windows.map((w, i) => ({ w, list: Array.isArray(d.records[i]) ? d.records[i].filter(r => r && r.name) : [] })).filter(g => g.list.length).reverse();
    const total = groups.reduce((n, g) => n + g.list.length, 0); if (!total) return '';
    const all = groups.flatMap(g => g.list), hasSub = all.some(r => r.sub), hasDate = all.some(r => r.date), hasNote = all.some(r => r.note);
    const dateHead = all.find(r => r.dateLabel)?.dateLabel || '날짜';
    const who = r => (r.id != null && api.canOpenRecord?.(r.id) ? `<button type="button" class="ax-text-link" data-tr-open="${esc(r.id)}">${esc(r.name)}</button>` : esc(r.name));
    let left = ROSTER_MAX; const body = [];
    for (const g of groups) {
      if (left <= 0) break;
      const list = [...g.list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.name).localeCompare(String(b.name), 'ko')).slice(0, left); left -= list.length;
      list.forEach((r, k) => body.push(`<tr>${k ? '' : `<th scope="rowgroup" rowspan="${list.length}">${esc(dayName(g.w))}</th>`}<td>${who(r)}</td>`
        + `${hasSub ? `<td>${esc(r.sub || '')}</td>` : ''}${hasDate ? `<td>${esc(dateText(r.date, d.asOf))}</td>` : ''}${hasNote ? `<td class="l">${esc(r.note || '')}</td>` : ''}</tr>`));
    }
    const shownN = ROSTER_MAX - Math.max(left, 0), cols = [['8.5em', '기간'], ['7em', '이름'], ...(hasSub ? [['8em', '학교·학년']] : []), ...(hasDate ? [['6.5em', dateHead]] : []), ...(hasNote ? [['', '내용', 'l']] : [])];
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

  function render(ctx) {
    // from·to·up = 쪼개 보는 범위(점을 누른 그 기간)와 나눈 창의 단위 — 주소에 실어 새로고침·뒤로 가기에도 같은 보기.
    const q = ctx.query, params = Object.fromEntries(['metric', 'grain', 'by', 'f', 'from', 'to', 'up'].map(k => [k, q.get(k) || '']));
    last = { params, go: ctx.go, api: ctx.api, by: last?.by || '' };
    const e = ctx.load(params);
    if (!e.data) {
      if (e.status === 'error') return `<p class="v3s-note">${esc(e.error || '불러오지 못했습니다.')}</p>`;
      return lastHtml ? lastHtml.replace('<div class="tr">', '<div class="tr is-loading" aria-busy="true">') : '<div class="tr"><p class="v3s-note">추세를 계산하는 중…</p></div>';
    }
    const d = e.data; last.by = d.by; last.view = viewKey(d); last.d = d;
    const rq = d.range ? { from: d.range.from, to: d.range.to, up: d.range.up } : {}, li = d.windows.length - 1;
    // 학원 전체(필터를 걸었을 때의 비교선)는 같은 창의 시작일로 맞춘다 — 필터 쪽과 전체 쪽의 '기록 시작'이 달라 앞을 다르게 잘라도 칸이 어긋나지 않게.
    const all = d.filter ? ctx.load({ metric: d.metric.id, grain: d.grain, ...rq }).data : null;
    const base = all ? (m => ({ total: d.windows.map(w => m.get(w.from) ?? null) }))(new Map(all.windows.map((w, i) => [w.from, all.total[i]]))) : null;
    const p = d.total[li], c = changeOf(p, li ? d.total[li - 1] : null, d.metric.unit, d.metric.better), CP = window.ContextPicker;
    // 지표 고르개 = 지표 이름만(원장 10-28 "그냥 지표이름만 보여줘도 될거같음" · "마지막 21개는 필요없음" — 건수 줄은 CSS로 숨긴다). 영역 이름으로도 찾는다.
    const items = d.metrics.map(m => ({ value: m.id, title: m.label, search: `${m.label} ${m.group}` }));
    const picker = CP ? CP.html({ id: 'tr-metric', name: 'tr-metric', label: '지표', clearable: false, selected: [d.metric.id], ...CP.lists.choices({ items, columns: [{ key: 'name', label: '지표' }], noun: '지표', unit: '개' }) }) : '';
    const seg = (attr, list, cur) => list.map(x => `<button type="button" class="tab ${x.id === cur ? 'active' : ''}" ${attr}="${esc(x.id)}" aria-pressed="${x.id === cur}">${esc(x.label)}</button>`).join('');
    lastHtml = `<div class="tr"><div class="page-heading"><div><p class="ws-group">확장 추세</p><h1>${esc(d.metric.label)}</h1></div><div class="heading-actions">${picker}</div></div>`
      + `<div class="tr-bar"><div class="tr-seg" role="group" aria-label="기간 단위">${seg('data-tr-grain', d.grains, d.grain)}</div><div class="tr-seg" role="group" aria-label="기준">${seg('data-tr-by', d.metric.dims.filter(x => x.id !== d.filter?.dim), d.by)}</div>`
      + (d.range ? `<span class="tr-filter tr-range"><strong>${esc(d.range.label)}</strong> ${esc(grainName(d, d.grain))}<button type="button" class="icon-button" data-tr-undrill aria-label="나눠 보기 닫기 — ${esc(grainName(d, d.range.up))} 보기로">×</button></span>` : '')
      + (d.filter ? `<span class="tr-filter"><strong>${esc(d.filter.label)}</strong>만 보는 중<button type="button" class="icon-button" data-tr-unfilter aria-label="필터 풀기">×</button></span>` : '') + '</div>'
      + `<section class="tr-main"><div class="tr-now"><span>${esc(d.windows[li] ? dayName(d.windows[li]) : '')}</span><strong>${shown(p?.value, d.metric.unit)}</strong><small class="${c.tone}">${li ? `직전 대비 ${c.text}` : ''}</small><small>${ratio(p, d.metric.unit)}</small></div>${bigChart(d, base, seriesOf(d))}</section>`
      + (d.rows.length ? table(d, ctx.api) : '<p class="v3s-note">이 조건의 기록이 없습니다.</p>') + roster(d, ctx.api) + '</div>';
    warm(d, params.grain);
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
    const col = t.closest('.tr-chart .chart-col[data-tr-drill]');
    if (col) { if (!down?.touch || down.armed) drill(col); return; }
    const b = t.closest('[data-tr-grain],[data-tr-by],[data-tr-filter],[data-tr-unfilter],[data-tr-undrill],[data-tr-sort],[data-tr-more],[data-tr-open]'); if (!b) return;
    if (b.dataset.trOpen) { last.api.openRecord?.(b.dataset.trOpen); return; } // 명단의 이름 = 그 기록 창
    // 기간 단위를 바꾸면 쪼개 보기도 끝난다(쪼개 보는 중 눌린 단추 = 나눈 단위 — 누르면 그 단위의 보통 보기).
    if (b.dataset.trGrain) go({ grain: b.dataset.trGrain, ...UNDRILL });
    else if (b.hasAttribute('data-tr-undrill')) go({ grain: last.d?.range?.up || last.params.up || last.params.grain, ...UNDRILL });
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
