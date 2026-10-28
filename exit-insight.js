/* '왜 줄었나' — billing/student decline insight (INSIGHT-EXITS.md). GET /api/insight/exits only; the server never calls AI
   on a request. Numbers, dates and counts on this screen are code totals; AI text is a draft that cites code facts.
   Bars use the shared chart popover (data-chart / data-point / data-tip). Records open by exact id (workspace ?id=). */
window.createExitInsight = function createExitInsight(api) {
  'use strict';
  const { h, fmt, won, icon, dialog, toast } = api;
  const ENDPOINT = '/api/insight/exits', $ = s => document.querySelector(s);
  const mlabel = m => `${Number(String(m).slice(5, 7))}월`, ym = m => `${String(m).slice(0, 4)}년 ${mlabel(m)}`;
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${won(Math.abs(n))}`;
  const tip = (title, rows, meta = []) => h(JSON.stringify({ title, rows, meta: meta.filter(Boolean) }));
  const pill = (t, tone = '') => `<span class="ax-chip ${tone}">${h(t)}</span>`;
  const btn = (label, attrs, cls = '') => `<button type="button" class="xi-btn ${cls}" ${attrs}>${label}</button>`;
  const TABLE = { students: '원생', enrollments: '수강', attendance_records: '출결', student_consultations: '원생상담', withdrawal_reports: '퇴원보고서', withdrawal_report_archives: '퇴원보고서 시트', student_grades: '성적', invoices: '청구', classes: '반', class_schedules: '시간표 배치', audit_logs: '변경 기록', users: '직원' };
  const STATUS = { disabled: ['자동 분석 꺼짐', ''], not_scheduled: ['코드 집계만', ''], queued: ['AI 분석 대기', 'blue'], running: ['AI 분석 중', 'blue'], partial: ['AI 분석 일부 완료', 'amber'], complete: ['AI 분석 완료', 'green'], error: ['AI 분석 오류', 'amber'] };
  const CONF = c => (c >= 0.6 ? '분명' : c >= 0.35 ? '보통' : '애매');
  const st = { index: null, data: null, ask: 0, timer: 0, from: null, to: null, stop: null };

  const loadIndex = () => (st.index ? Promise.resolve(st.index) : fetch(ENDPOINT, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => (st.index = j)));
  /** Entry button for a card. Pure HTML: nothing is fetched until it is pressed. */
  const entry = (from, to, label = '왜 줄었나') => (from && to && from < to ? `<button type="button" class="xi-entry" data-xi="open" data-from="${h(from)}" data-to="${h(to)}">${icon('trend')}<span>${h(label)}</span>${icon('chevron')}</button>` : '');

  function open(from, to) {
    st.from = from; st.to = to; const ask = ++st.ask; clearTimeout(st.timer);
    dialog('modal', `${mlabel(from)} → ${mlabel(to)} 왜 줄었나`, `${ym(from)}과 ${ym(to)}의 청구를 학생 단위로 대조했습니다.`, '<div class="xi" aria-busy="true"><p class="xi-note">불러오는 중입니다…</p></div>');
    Promise.all([loadIndex(), fetch(`${ENDPOINT}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Accept: 'application/json' } }).then(async r => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }))])
      .then(([, res]) => { if (ask !== st.ask || !$('#modal')?.open) return; if (!res.ok) { paintError(res.body?.message || '불러오지 못했습니다.', res.status === 503); return; } st.data = res.body; paint(true); })
      .catch(() => { if (ask === st.ask && $('#modal')?.open) paintError('불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true); });
  }
  function paintError(message, retry) { const body = $('#modal .live-detail-body'); if (body) body.innerHTML = `<div class="xi"><p class="xi-note">${h(message)}</p>${retry ? btn('다시 불러오기', `data-xi="open" data-from="${h(st.from)}" data-to="${h(st.to)}"`, 'primary') : ''}</div>`; }
  // Re-paint keeps the reader's scroll position and open rows; polling continues only while the queue is moving.
  function paint(first = false) {
    const body = $('#modal .live-detail-body'); if (!body) return;
    const top = first ? 0 : body.scrollTop, opened = [...body.querySelectorAll('[data-xi-row][aria-expanded="true"]')].map(n => n.dataset.xiRow), filter = body.querySelector('.xi')?.dataset.filter || '';
    body.innerHTML = view(st.data); body.scrollTop = top;
    opened.forEach(id => toggleRow(id, true)); if (filter) applyFilter(filter, false);
    clearTimeout(st.timer);
    if (['queued', 'running'].includes(st.data.analysis?.status)) { const ask = st.ask; st.timer = setTimeout(() => refresh(ask), 6000); }
  }
  function refresh(ask) {
    if (ask !== st.ask || !$('#modal')?.open) return;
    fetch(`${ENDPOINT}?from=${encodeURIComponent(st.from)}&to=${encodeURIComponent(st.to)}`, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).then(j => { if (j && ask === st.ask && $('#modal')?.open) { st.data = j; paint(); } }).catch(() => {});
  }

  function pairs(d) {
    const list = st.index?.pairs || [], periods = st.index?.periods || [];
    const chips = list.map(p => `<button type="button" class="xi-pair" data-xi="open" data-from="${h(p.from)}" data-to="${h(p.to)}" aria-pressed="${p.from === d.from && p.to === d.to}"><strong>${mlabel(p.from)} → ${mlabel(p.to)}</strong><span>${signed(p.delta)}</span></button>`).join('');
    const opts = sel => periods.map(m => `<option value="${h(m)}" ${m === sel ? 'selected' : ''}>${ym(m)}</option>`).join('');
    return `<div class="xi-pairs" role="group" aria-label="비교할 두 달">${chips}<span class="xi-custom"><label><span>앞 달</span><select id="xi-from">${opts(d.from)}</select></label><label><span>뒤 달</span><select id="xi-to">${opts(d.to)}</select></label>${btn('보기', 'data-xi="custom"')}</span></div>`;
  }
  function bars(d) {
    const rows = [];
    for (const p of d.parts) { rows.push({ id: p.id, label: `${p.label} ${fmt(p.students)}명`, amount: p.amount, students: p.students, head: true }); for (const g of p.groups) if (g.amount || g.students) rows.push({ id: `${p.id}.${g.id}`, label: g.label, amount: g.amount, students: g.students, group: g, part: p.id }); }
    const max = Math.max(1, ...rows.map(r => Math.abs(r.amount))), share = n => (d.totals.from ? `${ym(d.from)} 청구 ${won(d.totals.from)}의 ${fmt(Math.abs(n / d.totals.from) * 100)}%` : '');
    const note = g => [g?.estimateAmount ? `설명 문구로 분류한 금액 ${signed(g.estimateAmount)}(추정)` : '', g?.sessionsChecked != null ? `회차 확정 기록 대조 ${fmt(g.sessionsChecked)}명 중 ${fmt(g.fewerSessions)}명은 예정 회차가 줄었음` : ''].filter(Boolean);
    return `<div class="xi-bars" data-chart data-axis="y" tabindex="0" role="group" aria-label="청구 변화 분해 — 화살표 키로 항목을 옮기며 금액을 확인합니다">${rows.map(r => {
      const w = Math.abs(r.amount) / max * 50, side = r.amount < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`;
      return `<div class="xi-bar ${r.head ? 'head' : ''} ${r.amount < 0 ? 'neg' : 'pos'}" data-point data-tip="${tip(`${ym(d.from)} → ${ym(d.to)}`, [{ label: r.label, value: signed(r.amount), tone: 'primary' }], [`학생 ${fmt(r.students)}명`, share(r.amount), ...note(r.group)])}"><span class="xi-bar-label">${h(r.label)}${r.group?.estimateAmount ? ' ' + pill('추정', 'amber') : ''}</span><span class="xi-bar-track"><i data-anchor style="${side}"></i></span><strong>${signed(r.amount)}</strong>${r.students && (r.part === 'departed' || r.id === 'departed') ? btn(`학생 ${fmt(r.students)}명`, `data-xi="filter" data-filter="${h(r.id)}"`) : '<span></span>'}</div>`;
    }).join('')}</div>${d.parts[2]?.groups.some(g => g.sessionsChecked != null) ? `<p class="xi-note">같은 과목 수인데 금액이 줄어든 학생 중 회차 확정 기록이 두 달 모두 있는 ${fmt(d.parts[2].groups.find(g => g.sessionsChecked != null).sessionsChecked)}명을 대조했고, ${fmt(d.parts[2].groups.find(g => g.sessionsChecked != null).fewerSessions)}명은 뒤 달 예정 회차가 적습니다. 나머지는 회차 차이를 확인하지 못했습니다.</p>` : ''}`;
  }
  function aiLine(a) {
    const [label, tone] = STATUS[a.status] || ['상태 미상', ''], j = a.jev, c = a.claude;
    const parts = [j && j.total ? `Jev 1.14.0 학생별 분류 ${fmt(j.done)}/${fmt(j.total)}명${j.failed ? ` · 실패 ${fmt(j.failed)}` : ''}${j.review ? ` · 사람 확인 ${fmt(j.review)}` : ''}` : '', c?.modelLabel ? `${c.modelLabel} 묶음 설명` : '', c?.status === 'error' ? `묶음 설명 실패(${c.code === 'invalid_output' ? '출력 검사 불통과' : '호출 실패'})` : '', a.claude?.blocked === 'budget' ? '이 PC의 시간당 호출 한도로 대기' : ''].filter(Boolean);
    return `<div class="xi-ai-line">${pill(label, tone)}<span>${h(a.note || a.disabledReason || parts.join(' · ') || '')}</span></div>`;
  }
  function overall(d) {
    if (!d.overall) return '';
    return `<section class="xi-overall"><h3>AI 정리 ${pill('AI 초안', 'blue')}</h3><p>${h(d.overall.summary)}</p>${d.overall.reasons.length ? `<ul>${d.overall.reasons.map(r => `<li>${h(r)}</li>`).join('')}</ul>` : ''}${d.overall.checks.length ? `<h4>사람이 확인할 일</h4><ul>${d.overall.checks.map(r => `<li>${h(r)}</li>`).join('')}</ul>` : ''}<p class="xi-note">${h(d.analysis.claude?.modelLabel || 'Claude')} · 숫자·날짜·인원은 코드 집계이며 AI 글에는 쓰지 않습니다. 사실 사슬은 아래 묶음의 근거 사실을 인용합니다.</p></section>`;
  }
  const factOpen = f => (f.open ? btn('원본 기록 열기', `data-xi="record" data-family="${h(f.open.family)}" data-id="${h(f.open.id)}"`, 'link') : '');
  const factSource = f => (f.source ? `<small class="xi-src">${h(TABLE[f.source.table] || '기록')}</small>` : '');
  function cluster(c, i, d) {
    const facts = c.facts.map(f => `<li id="xi-f-${h(c.id)}-${h(f.key)}"><span>${h(f.text)}</span>${factSource(f)}${factOpen(f)}</li>`).join('');
    const ai = c.ai ? `<div class="xi-ai">${pill(`AI · ${c.ai.confidence}`, c.ai.confidence === '분명' ? 'green' : c.ai.confidence === '사람 확인' ? 'amber' : 'blue')}<p>${h(c.ai.summary)}</p><ol class="xi-chain">${c.ai.chain.map(s => `<li><span>${h(s.text)}</span>${s.facts.length ? `<small>근거 ${s.facts.map(f => `<a href="#xi-f-${h(f.ref)}-${h(f.key)}" data-xi="fact">${h((d.clusters.find(x => x.id === f.ref)?.facts.find(x => x.key === f.key) || d.students.find(x => x.studentId === f.ref)?.facts.find(x => x.key === f.key))?.label || '사실')}</a>`).join(' · ')}</small>` : ''}</li>`).join('')}</ol></div>` : '';
    return `<article class="xi-cluster" ${i >= 8 ? 'data-more hidden' : ''}><header><div>${pill(c.kindLabel)}<h4>${h(c.label)}</h4></div><strong>${fmt(c.members.length)}명 · ${signed(c.amount)}</strong></header>${ai}<ul class="xi-facts">${facts}</ul>${btn(`이 묶음 학생 ${fmt(c.members.length)}명 보기`, `data-xi="filter" data-filter="cluster:${h(c.id)}"`, 'link')}</article>`;
  }
  function weeks(f) {
    const max = Math.max(1, ...f.weeks.map(w => w.attended + w.absent));
    return `<div class="xi-weeks" data-chart tabindex="0" role="group" aria-label="그만두기 전 8주 출결 — 화살표 키로 주를 옮깁니다">${f.weeks.map(w => `<span data-point data-tip="${tip(`${w.from} 주`, [{ label: '출석', value: `${fmt(w.attended)}회`, tone: 'primary' }, { label: '결석', value: `${fmt(w.absent)}회`, tone: 'secondary' }])}"><i data-anchor style="height:${(w.attended + w.absent) / max * 100}%"><b style="height:${w.attended + w.absent ? w.absent / (w.attended + w.absent) * 100 : 0}%"></b></i></span>`).join('')}</div>`;
  }
  function student(s) {
    const exit = s.exit.kind === 'withdrawn' ? `퇴원 ${s.exit.date}` : s.exit.kind === 'cleanup' ? (s.exit.month ? `${mlabel(s.exit.month)} 이탈 추정` : '이탈 시점 미상') : s.kindLabel;
    const cause = s.ai?.label ? `${pill(`Jev · ${s.ai.label}`, s.ai.review ? 'amber' : 'blue')}${s.ai.review ? pill(s.ai.conflict ? '기록 사유와 다름 · 사람 확인' : '사람 확인', 'amber') : ''}<small>${CONF(s.ai.confidence)}</small>` : s.ai?.status === 'pending' ? pill('Jev 분류 대기', '') : s.ai?.status === 'error' ? pill('Jev 분류 실패', 'amber') : '';
    const recorded = s.cause.origin === 'record' ? pill(`기록 · ${s.cause.label}`) : '';
    const facts = s.facts.map(f => `<li id="xi-f-${h(s.studentId)}-${h(f.key)}"><span class="xi-fact-label">${h(f.label)}${f.estimate ? ' ' + pill('추정', 'amber') : ''}</span><span>${h(f.text)}</span>${f.weeks ? weeks(f) : ''}${factSource(f)}${factOpen(f)}</li>`).join('');
    return `<li class="xi-student" data-groups="${h(['departed', `departed.${s.kind === 'withdrawn' || s.kind === 'cleanup' || s.kind === 'on_hold' || s.kind === 'enrolled' ? s.kind : 'other'}`, ...s.clusterIds.map(c => `cluster:${c}`)].join('|'))}"><button type="button" class="xi-student-head" data-xi="row" data-xi-row="${h(s.studentId)}" aria-expanded="false" aria-controls="xi-s-${h(s.studentId)}"><strong>${h(s.name)}</strong><span>${h(s.label)}</span><span>${pill(s.kindLabel, s.kind === 'cleanup' ? 'amber' : '')}${h(exit)}</span><span class="xi-cause">${recorded}${cause}</span><b>${signed(s.amount)}</b>${icon('down')}</button><div class="xi-student-body" id="xi-s-${h(s.studentId)}" hidden><ul class="xi-facts">${facts}</ul>${btn('원생 상세 열기', `data-xi="record" data-family="students" data-id="${h(s.studentId)}"`, 'link')}</div></li>`;
  }
  function view(d) {
    const a = d.analysis, more = d.clusters.length - 8;
    return `<div class="xi" data-filter="">${pairs(d)}<div class="xi-totals"><div><span>${ym(d.from)} 청구</span><strong>${won(d.totals.from)}</strong></div><div><span>${ym(d.to)} 청구</span><strong>${won(d.totals.to)}</strong></div><div><span>차이</span><strong class="${d.totals.delta < 0 ? 'neg' : ''}">${signed(d.totals.delta)}</strong></div></div>
      <section><h3>① 무엇이 줄었나</h3><p class="xi-note">${h(d.basis.billing)}. 나눈 금액의 합이 차이와 ${d.check.exact ? '정확히 같습니다' : `다릅니다(합 ${signed(d.check.sum)})`}. ${h(d.basis.special)}.</p>${bars(d)}</section>
      <section><h3>② 왜 줄었나 · 원인 묶음</h3>${aiLine(a)}${overall(d)}<p class="xi-note">묶음은 코드가 빠진 학생 기록을 이어 만든 후보입니다(${h(d.basis.teacher)}). 한 학생이 여러 묶음에 들 수 있습니다.</p><div class="xi-clusters">${d.clusters.map((c, i) => cluster(c, i, d)).join('')}</div>${more > 0 ? btn(`나머지 묶음 ${fmt(more)}개 보기`, 'data-xi="more"', 'link') : ''}</section>
      <section id="xi-students"><h3>③ 빠진 학생별 사건 파일 <span class="xi-count">${fmt(d.students.length)}명</span></h3><div class="xi-filter-line" hidden><span></span>${btn('전체 보기', 'data-xi="filter" data-filter=""', 'link')}</div><p class="xi-note">${h(d.basis.cleanup)}. Jev 분류의 '분명·보통·애매'는 모델 분포의 집중도이며 정확도가 아닙니다.</p><ul class="xi-students">${d.students.map(student).join('')}</ul></section></div>`;
  }
  // In-dialog jumps glide inside the dialog body and brake into place (AGENTS.md scroll rule); any input stops them.
  function glide(node) {
    st.stop?.(); const box = node.closest('.live-detail-body'); if (!box) return;
    const goal = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + node.getBoundingClientRect().top - box.getBoundingClientRect().top - 12)), from = box.scrollTop, dist = Math.abs(goal - from);
    if (dist < 8 || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.scrollTop = goal; return; }
    const dur = Math.min(1000, Math.max(550, 350 + dist * 0.4)), start = performance.now(), kinds = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    let frame = 0; const stop = () => { cancelAnimationFrame(frame); kinds.forEach(k => box.removeEventListener(k, stop)); if (st.stop === stop) st.stop = null; };
    kinds.forEach(k => box.addEventListener(k, stop, { passive: true }));
    const step = now => { const t = Math.min(1, (now - start) / dur); box.scrollTop = from + (goal - from) * (1 - (1 - t) ** 3); if (t < 1) frame = requestAnimationFrame(step); else stop(); };
    st.stop = stop; frame = requestAnimationFrame(step);
  }
  function toggleRow(id, force) {
    const b = document.querySelector(`[data-xi-row="${CSS.escape(id)}"]`), body = b && document.getElementById(b.getAttribute('aria-controls')); if (!b || !body) return;
    const on = force ?? b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(on)); body.hidden = !on;
  }
  function applyFilter(f, scroll = true) {
    const root = $('#modal .xi'); if (!root) return; root.dataset.filter = f;
    let n = 0; root.querySelectorAll('.xi-student').forEach(li => { const on = !f || li.dataset.groups.split('|').includes(f); li.hidden = !on; if (on) n += 1; });
    const line = root.querySelector('.xi-filter-line'); line.hidden = !f;
    const label = f.startsWith('cluster:') ? st.data.clusters.find(c => `cluster:${c.id}` === f)?.label : (st.data.parts[0].groups.find(g => `departed.${g.id}` === f)?.label || (f === 'departed' ? '빠진 학생 전체' : ''));
    line.querySelector('span').textContent = f ? `${label || '선택한 묶음'} · ${fmt(n)}명` : '';
    if (scroll) glide(root.querySelector('#xi-students'));
  }
  document.addEventListener('click', event => {
    const t = event.target.closest?.('[data-xi]'); if (!t) return;
    const kind = t.dataset.xi;
    if (kind === 'open') { event.preventDefault(); open(t.dataset.from, t.dataset.to); }
    else if (kind === 'custom') { const f = $('#xi-from')?.value, to = $('#xi-to')?.value; if (!f || !to || f >= to) { toast('앞 달이 뒤 달보다 이른 두 달을 골라 주세요.'); return; } open(f, to); }
    else if (kind === 'row') toggleRow(t.dataset.xiRow);
    else if (kind === 'filter') applyFilter(t.dataset.filter || '');
    else if (kind === 'more') { document.querySelectorAll('#modal .xi-cluster[data-more]').forEach(n => { n.hidden = false; }); t.remove(); }
    else if (kind === 'fact') { event.preventDefault(); const n = document.getElementById(t.getAttribute('href').slice(1)); if (n) { n.closest('[data-more]')?.removeAttribute('hidden'); if (n.closest('.xi-student')?.hidden) applyFilter('', false); const b = n.closest('.xi-student-body'); if (b) toggleRow(b.id.slice(5), true); glide(n); n.classList.add('xi-flash'); setTimeout(() => n.classList.remove('xi-flash'), 1600); } }
    else if (kind === 'record') { if (api.showWorkspaceRecord) api.showWorkspaceRecord(t.dataset.family, t.dataset.id); else toast('이 기록은 여기서 바로 열 수 없습니다.'); }
  });
  document.addEventListener('close', event => { if (event.target?.id === 'modal') { st.ask += 1; clearTimeout(st.timer); } }, true);
  return { entry, open };
};
