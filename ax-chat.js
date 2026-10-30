/* AI 업무 지원 — 답 그리기(원장 10-28 "그냥 나열하지말고 서식등을 동원해서 정리해서 나열하게. 실제로 해당 메뉴로 갈 수도 있게.
   업무 요청도 할 수 있게"). ax.js가 대화·요청 창을 맡고, 이 파일은 한 답의 모양과 그 안의 이동만 맡는다.
   · 순서 = 결론 한 줄 → 핵심 숫자 → 근거(미주 [n]) → 짧은 표 → 확인할 업무 → 미주 → 바로 가기 → 요청안.
   · 모델 글은 공통 AI 서식으로 이스케이프·강조하고, '다만 …' 문장은 밑줄로 표시한다.
   · 미주 글은 서버가 계산한 사실 줄 그대로다(모델이 쓴 글이 아니다). 마우스를 올리면 카드로, 누르면 아래 미주로 미끄러져 간다.
   · 바로 가기는 서버가 아는 목적지(작업 영역·연습 화면·확장 추세 지표)뿐 — 여기서는 그 id를 화면 주소로 옮기기만 한다.
   · 좋아짐 = var(--ax-good)(빨강), 나빠짐 = var(--ax-bad)(파랑). */
window.createAxChat = function createAxChat(api) {
  'use strict';
  const { h, pill, button } = api;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
  const rich = t => window.AIResultMeta.rich(t, h).replace(/(^|[.!?]\s+)(다만 [^.!?]*[.!?]?)/g, '$1<u class="axc-caveat">$2</u>');
  const LINK = /^(ws|v2|trend):[a-z0-9-]{1,40}$/;
  // 저장된 옛 답의 링크는 새 지표 목록에서 사라져도 남는다. 제공하지 않는 목적지는 버튼을 그리지 않는다.
  const REMOVED_TRENDS = new Set(['report-sent']);
  const availableLink = id => typeof id === 'string' && LINK.test(id) && !(id.startsWith('trend:') && REMOVED_TRENDS.has(id.slice(6)));
  const uniqueLinks = list => { const seen = new Set(); return list.filter(l => { const key = String(l.label).trim().replace(/\s*→$/, '') || l.id; if (seen.has(l.id) || seen.has(key)) return false; seen.add(l.id); seen.add(key); return true; }); };

  /** 서버 답의 정리된 부분 — 모양이 틀린 칸은 버린다(없으면 null → ax.js가 평문 답을 그린다). */
  function validate(p) {
    if (!p || typeof p !== 'object') return null;
    const notes = arr(p.notes, 30).filter(n => n && Number.isInteger(n.n) && typeof n.text === 'string').map(n => ({ n: n.n, text: str(n.text, 600) }));
    const known = new Set(notes.map(n => n.n));
    const refs = list => arr(list, 4).filter(n => known.has(n));
    const headline = str(p.headline, 200), body = str(p.body, 20000);
    if (!headline && !body) return null;
    return {
      headline, body,
      keyFacts: arr(p.keyFacts, 5).filter(f => f && str(f.label, 40) && str(f.value, 40)).map(f => ({ label: str(f.label, 40), value: str(f.value, 40), change: str(f.change, 40), tone: f.tone === 'good' || f.tone === 'bad' ? f.tone : '', note: known.has(f.note) ? f.note : 0 })),
      points: arr(p.points, 6).filter(x => x && str(x.text, 400)).map(x => ({ text: str(x.text, 400), notes: refs(x.notes) })),
      checks: arr(p.checks, 4).map(c => str(c, 200)).filter(Boolean),
      table: p.table && Array.isArray(p.table.columns) && Array.isArray(p.table.rows) ? { columns: arr(p.table.columns, 4).map(c => str(c, 30)), rows: arr(p.table.rows, 8).filter(Array.isArray).map(r => arr(r, 4).map(c => str(c, 40))) } : null,
      notes,
      links: uniqueLinks((Array.isArray(p.links) ? p.links : []).filter(l => l && availableLink(l.id) && str(l.label, 60)).map(l => ({ id: l.id, label: str(l.label, 60) }))).slice(0, 4),
      notice: str(p.notice, 200),
    };
  }
  /** 요청안의 영역·첨부 기록(서버가 기록 저장소에서 확인한 것) — ax.js validateAssistant가 버리는 칸을 따로 받아 둔다. */
  function taskExtras(p) {
    const t = p?.suggestedTask;
    if (!t || typeof t !== 'object' || typeof t.area !== 'string' || !/^[a-z][a-z-]{0,40}$/.test(t.area)) return null;
    const attach = arr(t.attach, 10).filter(a => a && typeof a.value === 'string' && /^[a-z][a-z-]{0,40}\|[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/.test(a.value) && a.value.startsWith(`${t.area}|`))
      .map(a => ({ value: a.value, label: str(a.label, 80) || '기록', meta: str(a.meta, 80) }));
    return { area: t.area, areaLabel: str(t.areaLabel, 60), attach };
  }

  const fnMark = (tid, n) => `<sup class="axc-fn"><a href="#axc-n-${h(tid)}-${n}" data-axc-fn aria-label="근거 ${n}">[${n}]</a></sup>`;
  const marks = (tid, list) => list.map(n => fnMark(tid, n)).join('');

  /** 한 답 — t = ax.js의 대화 한 칸(t.rich = validate 결과, t.task = taskExtras 결과). issues = ax.js가 그린 '관련 이슈' 단추. */
  function answer(t, { issues = '' } = {}) {
    const r = t.rich, tid = t.id;
    const facts = r.keyFacts.length ? `<dl class="axc-facts">${r.keyFacts.map(f => `<div class="axc-fact"><dt>${h(f.label)}</dt><dd><strong>${h(f.value)}</strong>${f.change ? ` <span class="axc-change ${f.tone}">${h(f.change)}</span>` : ''}${f.note ? fnMark(tid, f.note) : ''}</dd></div>`).join('')}</dl>` : '';
    const points = r.points.length ? `<h4 class="axc-h">근거</h4><ul class="axc-points">${r.points.map(p => `<li class="air-rich">${rich(p.text)}${marks(tid, p.notes)}</li>`).join('')}</ul>` : '';
    const table = r.table && r.table.columns.length >= 2 && r.table.rows.length ? `<div class="axc-table-wrap"><table class="axc-table"><thead><tr>${r.table.columns.map(c => `<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${r.table.rows.map(row => `<tr>${r.table.columns.map((_, i) => `<td>${h(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const checks = r.checks.length ? `<h4 class="axc-h">확인할 업무</h4><ul class="axc-checks">${r.checks.map(c => `<li class="air-rich">${rich(c)}</li>`).join('')}</ul>` : '';
    const notes = r.notes.length ? `<ol class="axc-notes" aria-label="근거 미주">${r.notes.map(n => `<li id="axc-n-${h(tid)}-${n.n}"><span class="axc-n-no">[${n.n}]</span><span class="axc-n-text">${h(n.text)}</span></li>`).join('')}</ol>` : '';
    // Stored replies may predate link normalization, so the view also removes repeated destinations.
    const linksForView = uniqueLinks(r.links);
    const links = linksForView.length ? `<div class="axc-links"><span class="ax-note">바로 가기</span>${linksForView.map(l => `<button type="button" class="button axc-go" data-axc-go="${h(l.id)}">${h(l.label)} <span aria-hidden="true">→</span></button>`).join('')}</div>` : '';
    const task = t.suggestedTask ? taskCard(t) : '';
    const head = r.headline ? window.AIResultMeta.summary(r.headline, h) : '';
    const body = !r.headline && r.body ? `<div class="ax-chat-text air-rich">${rich(r.body)}</div>` : '';
    return `<div class="ax-chat-answer axc"><div class="ax-chat-provider">${pill('AI 분석', 'blue')}<span>학원 기록으로 쓴 초안입니다. 내용을 확인한 뒤 사용하세요.</span></div>${window.AIResultMeta.html({model:t.aiMeta?.modelLabel||'Claude',at:t.aiMeta?.createdAt,basis:t.aiMeta?.basis||api.basis?.(t)||'원장실 전체'})}${head}${body}${facts}${points}${table}${checks}${r.notice ? `<p class="axc-notice">${h(r.notice)}</p>` : ''}${notes}${links}${issues}${task}</div>`;
  }
  function taskCard(t) {
    const x = t.task, task = t.suggestedTask;
    const record = x?.attach?.length === 1 ? x.attach[0].value.split('|')[1] : '';
    const where = x?.areaLabel ? `<div class="axc-task-meta"><span class="ax-note">볼 화면</span><button type="button" class="button axc-go" data-axc-go="ws:${h(x.area)}"${record ? ` data-axc-record="${h(record)}"` : ''}>${h(x.areaLabel)} <span aria-hidden="true">→</span></button></div>` : '';
    const recs = x?.attach?.length ? `<div class="axc-task-meta"><span class="ax-note">함께 붙일 기록</span>${x.attach.map(a => pill(a.meta ? `${a.label} · ${a.meta}` : a.label)).join('')}</div>` : '';
    return `<div class="ax-chat-task axc-task"><span class="ax-note">업무 요청안</span><strong>${h(task.title)}</strong><p class="live-pre">${h(task.body)}</p>${where}${recs}<div class="ax-actions">${button('요청 창에서 열기', 'chat-task', t.id, true)}<span class="ax-note">담당자·기한을 정해 등록하기 전에는 전달되지 않습니다.</span></div></div>`;
  }

  /** '요청 창에서 열기' 뒤 — 열린 요청 창에 확인된 기록을 첨부로 넣는다(값 = "영역|기록", 등록 때 서버가 다시 확인). 빼고 싶으면 ×. */
  function attachTo(form, task) {
    if (!form || !task?.attach?.length || form.querySelector('.axc-attach')) return;
    const box = document.createElement('div');
    box.className = 'axc-attach';
    box.innerHTML = `<span class="ax-note">AI가 찾은 기록 · 함께 붙입니다</span><div class="axc-attach-list">${task.attach.map(a => `<span class="axc-attach-item"><input type="hidden" name="attach" value="${h(a.value)}">${h(a.label)}${a.meta ? ` <small>${h(a.meta)}</small>` : ''}<button type="button" class="axc-attach-x" data-axc-unattach aria-label="${h(a.label)} 빼기">×</button></span>`).join('')}</div>`;
    const anchor = form.querySelector('fieldset') || form.querySelector('.ax-form-error');
    anchor ? anchor.before(box) : form.append(box);
  }

  // ── 이동 · 미주 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function go(id, record = '') {
    const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (!availableLink(id)) return;
    if (kind === 'ws') {
      const ws = api.workspaces?.();
      if (ws && !ws.has?.(key)) { api.toast?.('이 화면은 지금 열 수 없습니다.'); return; }
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      if (record && window.RecordOpen?.supports(key, record)) { window.RecordOpen.open(key, record); return; } // 그 기록의 처리 화면으로 바로(원장 10-30)
      if (record && ws?.showRecord) { ws.showRecord(key, record); return; }
      if (!ws?.openFamily?.(key)) api.navigate?.(`workspace-${key}`);
      return;
    }
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    location.hash = kind === 'v2' ? `v2-${key}` : `v2-trend?metric=${encodeURIComponent(key)}&grain=week`;
  }
  // 미주로 — 대화 기록 칸 안에서 눈에 보이게 움직이고 도착 가까이에서 느려진다(AGENTS.md 스크롤 규칙). 손이 닿으면 바로 멈춘다.
  let stopGlide = null;
  function glide(node) {
    stopGlide?.();
    const box = node.closest('[data-chat-log]') || node.closest('.live-detail-body'); if (!box) return;
    const goal = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + node.getBoundingClientRect().top - box.getBoundingClientRect().top - 12)), from = box.scrollTop, dist = Math.abs(goal - from);
    if (dist < 8 || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.scrollTop = goal; return; }
    const dur = Math.min(1000, Math.max(550, 350 + dist * 0.4)), start = performance.now(), kinds = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    let frame = 0; const stop = () => { cancelAnimationFrame(frame); kinds.forEach(k => box.removeEventListener(k, stop)); if (stopGlide === stop) stopGlide = null; };
    kinds.forEach(k => box.addEventListener(k, stop, { passive: true }));
    const step = now => { const p = Math.min(1, (now - start) / dur); box.scrollTop = from + (goal - from) * (1 - (1 - p) ** 3); if (p < 1) frame = requestAnimationFrame(step); else stop(); };
    stopGlide = stop; frame = requestAnimationFrame(step);
  }
  let pop = null;
  const hidePop = () => { if (pop) pop.hidden = true; };
  function showPop(a) {
    const n = document.getElementById(a.getAttribute('href').slice(1)); if (!n) return;
    pop ??= Object.assign(document.createElement('div'), { className: 'axc-fn-pop', role: 'tooltip' });
    const host = a.closest('dialog') || document.body; if (pop.parentNode !== host) host.append(pop);
    pop.innerHTML = ['.axc-n-no', '.axc-n-text'].map(q => n.querySelector(q)?.outerHTML || '').join('');
    pop.hidden = false;
    const rect = a.getBoundingClientRect(), w = Math.min(360, innerWidth - 24); pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(12, Math.min(rect.left - 12, innerWidth - w - 12))}px`;
    const ph = pop.offsetHeight; pop.style.top = `${rect.bottom + 8 + ph > innerHeight - 8 ? Math.max(8, rect.top - ph - 8) : rect.bottom + 8}px`;
  }
  document.addEventListener('click', event => {
    const goBtn = event.target.closest?.('[data-axc-go]');
    if (goBtn) { go(goBtn.dataset.axcGo, goBtn.dataset.axcRecord || ''); return; }
    const fn = event.target.closest?.('a[data-axc-fn]');
    if (fn) { event.preventDefault(); hidePop(); const n = document.getElementById(fn.getAttribute('href').slice(1)); if (n) { glide(n); n.classList.add('axc-flash'); setTimeout(() => n.classList.remove('axc-flash'), 1400); } return; }
    const x = event.target.closest?.('[data-axc-unattach]');
    if (x) { const item = x.closest('.axc-attach-item'), box = x.closest('.axc-attach'); item?.remove(); if (box && !box.querySelector('.axc-attach-item')) box.remove(); }
  });
  document.addEventListener('pointerover', event => { const a = event.target.closest?.('a[data-axc-fn]'); if (a) showPop(a); });
  document.addEventListener('pointerout', event => { if (event.target.closest?.('a[data-axc-fn]')) hidePop(); });
  document.addEventListener('focusin', event => { const a = event.target.closest?.('a[data-axc-fn]'); if (a) showPop(a); else hidePop(); });
  addEventListener('scroll', hidePop, true);

  return { validate, taskExtras, answer, attachTo, go, rich, PROVIDER_LABEL: 'AI 답변' };
};
