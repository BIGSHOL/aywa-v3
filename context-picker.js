/* Shared contextual picker for decision selections (record · person · class · student). One registry keyed by a
   stable DOM id and document-level delegation, so callers render it inside template strings and re-render freely.
   Hidden inputs are the only value source: single = exactly one input (like <select>, '' when empty), multiple = one
   input per value (like checkboxes). Facts come from the verified local copy by id; missing data stays '—'.
   Choosing never sends anything: the root only fires bubbling 'input' and 'change'. */
window.ContextPicker = (function () {
  'use strict';
  const reg = new Map(), memo = new Map(), MAX_ROWS = 300;
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = t => String(t ?? '').toLowerCase().normalize('NFC').replace(/\s+/g, '');
  const won = n => Number.isFinite(Number(n)) ? `${Math.round(Number(n)).toLocaleString('ko-KR')}원` : '—';
  const dash = v => v === undefined || v === null || v === '' ? '—' : String(v);
  const svg = d => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = { down: svg('<path d="m6 9 6 6 6-6"/>'), check: svg('<path d="m5 12 5 5 9-10"/>'), close: svg('<path d="M6 6l12 12M18 6 6 18"/>') };
  const supportsPopover = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  const rootOf = x => typeof x === 'string' ? document.getElementById(x) : x?.closest?.('[data-cpick]') || null;
  const entryOf = root => root ? reg.get(root.dataset.cpick) : null;
  const optionOf = (e, value) => e.data.get(String(value));

  /* ---------- render ---------- */
  function track(cols) { return ['1.25rem', ...cols.map(c => c.w || 'minmax(0,1fr)')].join(' '); }
  // Narrow field: every option uses the same areas (name first, then the values two or three per line) and the column
  // labels sit once above them in the same areas, so labels and numbers line up from row to row like a ledger.
  function compactOf(c) {
    const cols = c.columns || []; if (c.compact) return c.compact;
    const keys = cols.slice(1).map(col => `c-${col.key}`), lines = [];
    const name = cols[0] ? `c-${cols[0].key}` : 'c-name';
    lines.push(keys.length ? ['tick', name, keys.shift()] : ['tick', name, name]);
    while (keys.length) { const a = keys.shift(), b = keys.shift() || a; lines.push(['tick', a, b]); }
    return { cols: '1.25rem repeat(2,minmax(0,1fr))', areas: lines.map(l => `"${l.join(' ')}"`).join(' ') };
  }
  function shown(e) {
    const c = e.config, opts = e.selected.map(v => optionOf(e, v)).filter(Boolean);
    if (!opts.length) return `<span class="cpick-empty">${h(c.empty || c.placeholder || '선택')}</span>`;
    if (c.multiple) return `<span class="cpick-more">${h(c.addLabel || '추가·변경')}<small>${opts.length}${h(c.unit || '개')} 선택</small></span>`;
    const o = opts[0];
    return `<span class="cpick-title">${h(o.title)}</span>${o.context ? `<span class="cpick-context">${h(o.context)}</span>` : ''}`;
  }
  const chips = e => e.selected.map(v => optionOf(e, v)).filter(Boolean).map(o => `<li class="cpick-chip"><span><strong>${h(o.title)}</strong>${o.chip ? `<small>${h(o.chip)}</small>` : ''}</span><button type="button" data-cpick-remove="${h(o.value)}" aria-label="${h(o.title)} 선택 해제">${ICON.close}</button></li>`).join('');
  const inputs = e => e.config.multiple ? e.selected.map(v => `<input type="hidden" name="${h(e.config.name)}" value="${h(v)}">`).join('') : `<input type="hidden" name="${h(e.config.name)}" value="${h(e.selected[0] || '')}">`;
  const triggerName = e => {
    const c = e.config, opts = e.selected.map(v => optionOf(e, v)).filter(Boolean), base = c.label || c.ariaLabel || '선택';
    return opts.length ? `${base} · ${opts.map(o => `${o.title}${o.context && !c.multiple ? ` (${o.context})` : ''}`).join(', ')}` : `${base} · ${c.empty || '선택 안 함'}`;
  };

  /** Registers the config and returns the picker markup. Columns: [{key,label,w,align:'end',strong}]; options:
   *  [{value,title,sub,context,chip,cells:{key:text},search,disabled,reason}]. */
  function html(config) {
    const c = { clearable: true, ...config };
    if (!c.id || !c.name) throw new Error('ContextPicker needs id and name');
    const prev = reg.get(c.id), data = new Map();
    for (const o of c.options || []) if (o && o.value !== undefined && o.value !== null && o.value !== '') data.set(String(o.value), { ...o, value: String(o.value) });
    let selected = Array.isArray(c.selected) ? c.selected.map(String) : c.persist && memo.has(c.id) ? memo.get(c.id) : [];
    // Values picked from remote search keep their row so the summary survives a re-render.
    for (const v of selected) if (!data.has(v) && prev?.data.has(v)) data.set(v, prev.data.get(v));
    selected = [...new Set(selected)].filter(v => data.has(v) && !data.get(v).disabled);
    if (!c.multiple) selected = selected.slice(0, 1);
    const e = { config: c, data, selected, defaults: Array.isArray(c.selected) ? selected.slice() : [], query: '', active: -1, remote: null, view: [] };
    reg.set(c.id, e);
    if (c.persist) memo.set(c.id, selected.slice());
    const id = h(c.id), label = c.label ? `<label class="cpick-label" id="${id}-label" for="${id}-trigger">${h(c.label)}${c.required ? ' <em aria-hidden="true">*</em>' : ''}${c.multiple ? `<span>${h(c.multiHint || '여러 명 선택 가능')}</span>` : ''}</label>` : '';
    const described = [c.hint ? `${c.id}-hint` : '', c.describedBy || ''].filter(Boolean).join(' ');
    const attrs = Object.entries(c.attrs || {}).filter(([k]) => /^data-[a-z0-9-]+$/.test(k)).map(([k, v]) => ` ${k}="${h(v)}"`).join('');
    const cols = c.columns || [];
    return `<div class="cpick${c.multiple ? ' is-multi' : ''}${selected.length ? ' has-value' : ''}" id="${id}" data-cpick="${id}" data-cpick-name="${h(c.name)}"${attrs}>${label}<div class="cpick-field">${c.multiple ? `<ul class="cpick-chips" aria-label="선택한 ${h(c.label || '항목')}">${chips(e)}</ul>` : ''}<button type="button" class="cpick-trigger" id="${id}-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-panel" aria-label="${h(triggerName(e))}" ${described ? `aria-describedby="${h(described)}"` : ''} ${c.required ? 'aria-required="true"' : ''}><span class="cpick-shown">${shown(e)}</span>${ICON.down}</button>${c.clearable ? `<button type="button" class="cpick-clear" data-cpick-clear aria-label="${h(c.label || '선택')} 모두 지우기" ${selected.length ? '' : 'hidden'}>${ICON.close}</button>` : ''}</div>${(c.dropped || []).length ? `<p class="cpick-dropped" role="note">지금 고를 수 없어 선택에서 뺐습니다: ${h(c.dropped.map(d => `${d.label}${d.reason ? `(${d.reason})` : ''}`).join(', '))}</p>` : ''}${c.hint ? `<small class="cpick-hint" id="${id}-hint">${h(c.hint)}</small>` : ''}<div class="cpick-panel" id="${id}-panel" style="--cpick-cols:${h(track(cols))};--cpick-ccols:${h(compactOf(c).cols)};--cpick-areas:${h(compactOf(c).areas)}" ${supportsPopover ? 'popover="manual"' : ''} hidden><div class="cpick-search"><input type="search" id="${id}-search" data-cpick-search role="combobox" aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list" aria-activedescendant="" aria-label="${h(c.label || c.ariaLabel || '항목')} 검색" placeholder="${h(c.searchPlaceholder || '이름으로 찾기')}" autocomplete="off" enterkeyhint="done"></div>${cols.length ? `<div class="cpick-cols" aria-hidden="true"><span style="--ca:tick"></span>${cols.map(col => `<span class="${col.align === 'end' ? 'is-end' : ''}${col.cend ? ' is-cend' : ''}" style="--ca:c-${h(col.key)}">${h(col.label)}</span>`).join('')}</div>` : ''}<ul class="cpick-list" id="${id}-list" role="listbox" ${c.multiple ? 'aria-multiselectable="true"' : ''} aria-label="${h(c.label || c.ariaLabel || '항목')} 목록"></ul><p class="cpick-status" role="status" aria-live="polite"></p><div class="cpick-foot"><span class="cpick-note"></span>${c.multiple ? '<button type="button" class="button" data-cpick-done>선택 완료</button>' : ''}</div></div><div class="cpick-inputs">${inputs(e)}</div></div>`;
  }

  function row(e, o, i) {
    const cols = e.config.columns || [], sel = e.selected.includes(o.value);
    const cell = (col, j) => {
      const v = j === 0 ? '' : dash(o.cells?.[col.key]);
      if (j === 0) return `<span class="cpick-cell is-primary" style="--ca:c-${h(col.key || 'name')}"><strong>${h(o.title)}</strong>${o.sub ? `<small>${h(o.sub)}</small>` : ''}${o.disabled && o.reason ? `<small class="cpick-reason">${h(o.reason)}</small>` : ''}</span>`;
      return `<span class="cpick-cell${col.align === 'end' ? ' is-end' : ''}${col.cend ? ' is-cend' : ''}${col.strong && v !== '—' ? ' is-strong' : ''}${v === '—' ? ' is-none' : ''}" style="--ca:c-${h(col.key)}"><span class="cpick-k">${h(col.label)}</span><span class="cpick-v">${h(v)}</span></span>`;
    };
    return `<li role="option" class="cpick-opt" id="${h(e.config.id)}-o-${i}" data-value="${h(o.value)}" aria-selected="${sel}" ${o.disabled ? 'aria-disabled="true"' : ''}><span class="cpick-tick" style="--ca:tick" aria-hidden="true">${ICON.check}</span>${(cols.length ? cols : [{ key: '' }]).map(cell).join('')}</li>`;
  }

  /* ---------- filtering, remote search ---------- */
  function matches(o, terms) { if (!terms.length) return true; const s = o._s ?? (o._s = norm([o.title, o.sub, o.context, ...Object.values(o.cells || {}), o.search].join(' '))); return terms.every(t => s.includes(t)); }
  function refresh(root) {
    const e = entryOf(root); if (!e) return;
    const list = root.querySelector('.cpick-list'), status = root.querySelector('.cpick-status'), note = root.querySelector('.cpick-note');
    const raw = e.query.trim(), terms = raw.toLowerCase().normalize('NFC').split(/\s+/).filter(Boolean).map(norm);
    const r = e.remote, useRemote = Boolean(e.config.remote && raw && r?.query === raw && r.status === 'ready');
    let items = useRemote ? r.items : [...e.data.values()].filter(o => matches(o, terms));
    if (useRemote) for (const v of e.selected) if (!items.some(o => o.value === v) && matches(optionOf(e, v), terms)) items = [optionOf(e, v), ...items];
    e.view = items.slice(0, MAX_ROWS);
    list.innerHTML = e.view.map((o, i) => row(e, o, i)).join('');
    const loading = e.config.remote && raw && r?.query === raw && r.status === 'loading';
    status.textContent = loading ? '전체 기록에서 찾는 중입니다…' : e.config.remote && raw && r?.query === raw && r.status === 'error' ? r.message : items.length ? '' : raw ? `‘${raw}’에 맞는 ${e.config.noun || '항목'}이 없습니다. ${e.config.searchHint || '이름을 다시 확인해 주세요.'}` : e.config.emptyText || '고를 수 있는 항목이 없습니다.';
    root.querySelector('.cpick-panel').classList.toggle('is-loading', Boolean(loading));
    e.hidden = items.length - e.view.length; e.useRemote = useRemote;
    note.textContent = noteText(e);
    const keep = e.view.findIndex(o => o.value === e.activeValue);
    setActive(root, keep >= 0 ? keep : e.view.findIndex(o => !o.disabled));
    fade(list);
  }
  function noteText(e) {
    const raw = e.query.trim(), r = e.remote, picked = e.config.multiple ? `${e.selected.length}${e.config.unit || '개'} 선택 · ` : '';
    const more = e.hidden > 0 ? ` · ${e.hidden}건 더 있음, 검색어로 좁혀 주세요` : '';
    if (e.useRemote) return `${picked}검색 결과 ${r.filtered.toLocaleString('ko-KR')}건${r.filtered > r.items.length ? ` 중 ${r.items.length}건 표시 · 검색어를 더 넣어 좁혀 주세요` : ''}`;
    return `${picked}${raw && e.config.remote ? '불러온 목록에서 찾은 결과 · ' : ''}${e.config.note || `${e.data.size.toLocaleString('ko-KR')}건`}${more}`;
  }
  function search(root) {
    const e = entryOf(root), raw = e.query.trim(), cfg = e.config.remote;
    if (!cfg || !raw) { e.remote?.controller?.abort(); refresh(root); return; }
    clearTimeout(e.timer);
    if (e.remote?.query === raw && e.remote.status !== 'error') { refresh(root); return; }
    e.remote?.controller?.abort();
    const controller = new AbortController();
    e.remote = { query: raw, status: 'loading', items: [], filtered: 0, controller };
    refresh(root);
    e.timer = setTimeout(async () => {
      try {
        const out = await cfg.load(raw, { signal: controller.signal });
        if (e.remote?.controller !== controller) return;
        const items = (out.options || []).filter(o => o && o.value !== undefined).map(o => ({ ...o, value: String(o.value) }));
        Object.assign(e.remote, { status: 'ready', items, filtered: Number(out.filtered ?? items.length) });
      } catch (error) {
        if (controller.signal.aborted) return;
        Object.assign(e.remote, { status: 'error', message: typeof error?.message === 'string' && /[가-힣]/.test(error.message) ? error.message : '전체 기록을 찾지 못했습니다. 불러온 목록에서만 보여 드립니다.' });
      }
      if (root.isConnected && isOpen(root)) refresh(root);
    }, 250);
  }

  /* ---------- open / close / place ---------- */
  const isOpen = root => !root.querySelector('.cpick-panel').hidden;
  function fade(node) {
    const top = Math.max(0, node.scrollTop), bottom = Math.max(0, node.scrollHeight - node.clientHeight - top);
    node.style.setProperty('--fade-top', `${Math.min(24, top)}px`); node.style.setProperty('--fade-bottom', `${Math.min(24, bottom > 1 ? bottom : 0)}px`);
  }
  function place(root) {
    const e = entryOf(root), field = root.querySelector('.cpick-field'), panel = root.querySelector('.cpick-panel');
    const r = field.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = innerHeight, gap = 4, margin = 8;
    if (!r.width || r.bottom < 0 || r.top > vh) { close(root); return; }
    const width = Math.min(r.width, vw - margin * 2), left = Math.min(Math.max(r.left, margin), vw - margin - width);
    // Natural height = panel chrome + the list's full content (the list itself shrinks inside a capped panel).
    const list = panel.querySelector('.cpick-list'), natural = Math.min(440, (panel.offsetHeight - list.clientHeight + list.scrollHeight) || 440);
    const below = vh - r.bottom - gap - margin, above = r.top - gap - margin;
    const up = below < Math.min(natural, 360) && above > below, room = Math.max(140, Math.min(440, up ? above : below));
    Object.assign(panel.style, { position: 'fixed', margin: '0', width: `${width}px`, left: `${left}px`, maxHeight: `${room}px`, top: up ? 'auto' : `${r.bottom + gap}px`, bottom: up ? `${vh - r.top + gap}px` : 'auto' });
    panel.dataset.compact = String(width < (e?.config.compactBelow || 520));
    panel.dataset.side = up ? 'top' : 'bottom';
  }
  function open(root) {
    if (isOpen(root)) return;
    document.querySelectorAll('[data-cpick]').forEach(other => { if (other !== root && isOpen(other)) close(other); });
    const e = entryOf(root), panel = root.querySelector('.cpick-panel'), searchInput = root.querySelector('[data-cpick-search]');
    panel.hidden = false; if (supportsPopover) { try { panel.showPopover(); } catch { /* not connected */ } }
    root.querySelector('.cpick-trigger').setAttribute('aria-expanded', 'true'); root.classList.add('is-open');
    e.query = ''; searchInput.value = ''; e.activeValue = e.selected[0];
    place(root); refresh(root); place(root);
    searchInput.focus({ preventScroll: true });
    root.querySelector('.cpick-opt[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }
  function close(root, focusTrigger = false) {
    if (!root || !isOpen(root)) return;
    const e = entryOf(root), panel = root.querySelector('.cpick-panel');
    if (supportsPopover) { try { panel.hidePopover(); } catch { /* already hidden */ } }
    panel.hidden = true; root.classList.remove('is-open');
    root.querySelector('.cpick-trigger').setAttribute('aria-expanded', 'false');
    if (e) { clearTimeout(e.timer); e.remote?.controller?.abort(); }
    if (focusTrigger) root.querySelector('.cpick-trigger').focus({ preventScroll: true });
  }
  function setActive(root, index) {
    const e = entryOf(root), searchInput = root.querySelector('[data-cpick-search]');
    root.querySelectorAll('.cpick-opt.is-active').forEach(o => o.classList.remove('is-active'));
    const o = index >= 0 ? root.querySelector(`#${CSS.escape(`${e.config.id}-o-${index}`)}`) : null;
    e.active = o ? index : -1; e.activeValue = o ? e.view[index]?.value : undefined;
    searchInput?.setAttribute('aria-activedescendant', o ? o.id : '');
    if (o) { o.classList.add('is-active'); o.scrollIntoView({ block: 'nearest' }); }
  }
  function move(root, step) {
    const e = entryOf(root), enabled = e.view.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0); if (!enabled.length) return;
    const at = enabled.indexOf(e.active);
    const next = step === 'first' ? 0 : step === 'last' ? enabled.length - 1 : at < 0 ? (step > 0 ? 0 : enabled.length - 1) : Math.min(enabled.length - 1, Math.max(0, at + step));
    setActive(root, enabled[next]);
  }

  /* ---------- value ---------- */
  function sync(root) {
    const e = entryOf(root); if (!e) return;
    root.querySelector('.cpick-inputs').innerHTML = inputs(e);
    root.querySelector('.cpick-shown').innerHTML = shown(e);
    const chipList = root.querySelector('.cpick-chips'); if (chipList) chipList.innerHTML = chips(e);
    const clear = root.querySelector('[data-cpick-clear]'); if (clear) clear.hidden = !e.selected.length;
    const trigger = root.querySelector('.cpick-trigger'); trigger.setAttribute('aria-label', triggerName(e)); if (e.selected.length) trigger.removeAttribute('aria-invalid');
    root.classList.toggle('has-value', e.selected.length > 0);
    root.querySelectorAll('.cpick-opt').forEach(o => o.setAttribute('aria-selected', String(e.selected.includes(o.dataset.value))));
    if (isOpen(root)) { root.querySelector('.cpick-note').textContent = noteText(e); place(root); }
  }
  function commit(root, values, quiet = false) {
    const e = entryOf(root); if (!e) return;
    const next = [...new Set(values.map(String))].filter(v => e.data.has(v) && !e.data.get(v).disabled);
    e.selected = e.config.multiple ? next : next.slice(0, 1);
    if (e.config.persist) memo.set(e.config.id, e.selected.slice());
    sync(root);
    if (!quiet) { root.dispatchEvent(new Event('input', { bubbles: true })); root.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function choose(root, index) {
    const e = entryOf(root), o = e.view[index]; if (!o || o.disabled) return;
    if (!e.data.has(o.value)) e.data.set(o.value, o); // a remote row becomes a known option once chosen
    if (e.config.multiple) { commit(root, e.selected.includes(o.value) ? e.selected.filter(v => v !== o.value) : [...e.selected, o.value]); setActive(root, index); return; }
    close(root, true); commit(root, [o.value]); // closed first: a caller that re-renders on change keeps the trigger's focus
  }

  /* ---------- events (delegated) ---------- */
  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.cpick.is-open').forEach(root => { if (!root.contains(event.target)) close(root); });
  }, true);
  // Keep focus in the search box while clicking rows, headers or the footer text.
  document.addEventListener('mousedown', event => { const panel = event.target.closest?.('.cpick-panel'); if (panel && !event.target.closest('input,button')) event.preventDefault(); }, true);
  document.addEventListener('click', event => {
    const root = event.target.closest?.('[data-cpick]'); if (!root || !entryOf(root)) return;
    const remove = event.target.closest('[data-cpick-remove]'), option = event.target.closest('.cpick-opt');
    if (event.target.closest('.cpick-trigger')) { if (isOpen(root)) close(root); else open(root); }
    else if (event.target.closest('[data-cpick-clear]')) { commit(root, []); root.querySelector('.cpick-trigger').focus(); }
    else if (remove) { const e = entryOf(root), at = e.selected.indexOf(remove.dataset.cpickRemove); commit(root, e.selected.filter(v => v !== remove.dataset.cpickRemove)); (root.querySelectorAll('[data-cpick-remove]')[Math.max(0, at - 1)] || root.querySelector('.cpick-trigger')).focus(); }
    else if (option) { const i = entryOf(root).view.findIndex(o => o.value === option.dataset.value); if (i >= 0) choose(root, i); if (isOpen(root)) root.querySelector('[data-cpick-search]').focus({ preventScroll: true }); }
    else if (event.target.closest('[data-cpick-done]')) close(root, true);
    else return;
    event.preventDefault(); event.stopPropagation();
  }, true);
  document.addEventListener('keydown', event => {
    const root = event.target.closest?.('[data-cpick]'); if (!root || !entryOf(root)) return;
    const openNow = isOpen(root), inSearch = event.target.matches('[data-cpick-search]');
    if (event.key === 'Escape' && openNow) { event.preventDefault(); event.stopPropagation(); close(root, true); return; }
    if (event.target.matches('.cpick-trigger') && !openNow && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(root); return; }
    if (!inSearch || event.isComposing || event.keyCode === 229) return;
    const keys = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8, Home: 'first', End: 'last' };
    if (event.key in keys) { event.preventDefault(); event.stopPropagation(); move(root, keys[event.key]); return; }
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const e = entryOf(root); if (e.active >= 0) choose(root, e.active); return; }
    if (event.key === 'Tab') close(root);
  }, true);
  document.addEventListener('input', event => {
    if (!event.target.matches?.('[data-cpick-search]')) return;
    event.stopPropagation(); // the search box is not a form value: drafts and previews ignore it
    const root = rootOf(event.target), e = entryOf(root); if (!e) return;
    e.query = event.target.value; if (!event.isComposing) search(root); else refresh(root);
  }, true);
  document.addEventListener('compositionend', event => { if (!event.target.matches?.('[data-cpick-search]')) return; const root = rootOf(event.target), e = entryOf(root); if (!e) return; e.query = event.target.value; search(root); });
  document.addEventListener('focusout', event => {
    const root = event.target.closest?.('[data-cpick]'); if (!root || !isOpen(root)) return;
    if (event.relatedTarget && !root.contains(event.relatedTarget)) close(root);
  });
  document.addEventListener('scroll', event => {
    if (event.target.closest?.('.cpick-panel')) { if (event.target.matches?.('.cpick-list')) fade(event.target); return; }
    document.querySelectorAll('.cpick.is-open').forEach(place);
  }, true);
  addEventListener('resize', () => document.querySelectorAll('.cpick.is-open').forEach(place));
  // A modal's Escape closes the open list first, never the dialog under it.
  document.addEventListener('cancel', event => { const root = event.target.querySelector?.('.cpick.is-open'); if (root) { event.preventDefault(); close(root, true); } }, true);
  // A form reset puts every picker back to the value it was rendered with.
  document.addEventListener('reset', event => { const pickers = [...event.target.querySelectorAll?.('[data-cpick]') || []]; if (pickers.length) setTimeout(() => pickers.forEach(root => { const e = entryOf(root); if (e) commit(root, e.defaults, true); })); }, true);

  /* ---------- lists built from verified ids ---------- */
  const DAY = '일월화수목금토';
  const byId = list => new Map((list || []).map(x => [String(x.id), x]));
  // One index per snapshot object (lists are rebuilt on every render; rows look up by id, never by name).
  const indexes = new WeakMap();
  const index = db => { let m = indexes.get(db); if (!m) { m = { students: byId(db.students), classes: byId(db.classes), staff: byId(db.staff), invoices: byId(db.invoices) }; indexes.set(db, m); } return m; };
  const more = (list, n = 1) => list.length ? `${list.slice(0, n).join(', ')}${list.length > n ? ` 외 ${list.length - n}` : ''}` : '';
  const schoolGrade = s => [s?.school, s?.grade].filter(Boolean).join(' ');
  function schedule(cls) {
    const days = new Map();
    for (const s of cls?.schedules || []) { const d = days.get(s.day) || { start: s.start, end: s.end }; d.start = s.start < d.start ? s.start : d.start; d.end = s.end > d.end ? s.end : d.end; days.set(s.day, d); }
    if (!days.size) return '';
    const list = [...days.entries()].sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7)), same = list.every(([, d]) => d.start === list[0][1].start && d.end === list[0][1].end);
    return same ? `${list.map(([d]) => DAY[d]).join('·')} ${list[0][1].start}–${list[0][1].end}` : list.map(([d, t]) => `${DAY[d]} ${t.start}–${t.end}`).join(', ');
  }
  function studentFacts(db, studentId) {
    const { students, classes } = index(db), s = students.get(String(studentId));
    const enrolled = (s?.classes || []).map(id => classes.get(String(id))).filter(Boolean);
    return { s, classNames: enrolled.map(c => c.name), teachers: [...new Set(enrolled.map(c => c.teacher).filter(Boolean))], enrolled };
  }
  const followupOf = (cases, key) => (cases || []).find(c => c && c.scenarioKey === key && c.state !== 'done') || null;
  const FOLLOW = { open: '진행 중 시나리오', working: '진행 중 시나리오', review: '검토 중 시나리오' };

  const lists = {
    /** Assignable people. `actors` is the caller's already-filtered list ({id,name,role,roleLabel,duties}). */
    people({ db, actors, subjectLabel = v => v }) {
      const { staff } = index(db), label = v => { const out = subjectLabel(v); return out && out !== v ? out : ''; };
      const options = (actors || []).map(a => {
        const s = staff.get(String(a.id)), duty = (a.duties || []).includes('desk') ? '결석 확인 담당' : '';
        const homeroom = (db.classes || []).filter(c => String(c.teacherId) === String(a.id));
        const subjects = (s?.subjects || []).map(label).filter(Boolean);
        const role = [a.roleLabel || '', duty].filter(Boolean).join(' · ');
        return { value: a.id, title: a.name, sub: duty, chip: a.roleLabel || s?.title || '', context: [role, s ? [s.title, s.department].filter(Boolean).join(' · ') : ''].filter(Boolean).join(' · '),
          cells: { role: a.roleLabel || '', title: s ? [s.title, s.department].filter(Boolean).join(' · ') : '', subjects: subjects.join(', '), classes: homeroom.length ? `${homeroom.length}개` : '' },
          search: [duty, homeroom.map(c => c.name).join(' ')].join(' ') };
      });
      return { noun: '직원', unit: '명', columns: [{ key: 'name', label: '이름', w: 'minmax(0,1.15fr)' }, { key: 'role', label: '역할', w: 'minmax(4.5em,.7fr)', cend: true }, { key: 'title', label: '직급·부서', w: 'minmax(0,1.1fr)' }, { key: 'subjects', label: '담당 과목', w: 'minmax(0,.8fr)' }, { key: 'classes', label: '담임 반', w: '4.8em', align: 'end' }],
        options, compactBelow: 560, compact: { cols: '1.25rem repeat(2,minmax(0,1fr))', areas: '"tick c-name c-role" "tick c-title c-title" "tick c-subjects c-classes"' }, searchPlaceholder: '이름·역할·직급·과목·반 이름으로 찾기', searchHint: '이름·역할·과목을 다시 확인해 주세요.', note: `배정할 수 있는 ${options.length}명`, addLabel: '담당자 추가·변경' };
    },
    /** 2.0 staff records (business previews): every staff row of the copy, without contracts or pay. */
    staff({ db, subjectLabel = v => v }) {
      const out = lists.people({ db, subjectLabel, actors: (db.staff || []).map(s => ({ id: s.id, name: s.name })) });
      out.columns = out.columns.filter(c => c.key !== 'role');
      return { ...out, note: `직원 ${out.options.length}명` };
    },
    students({ db, status = 'enrolled' }) {
      const options = (db.students || []).filter(s => !status || s.status === status).map(s => {
        const f = studentFacts(db, s.id), sg = schoolGrade(s);
        return { value: s.id, title: s.name, sub: sg, chip: sg, context: [sg, f.classNames.length ? `${more(f.classNames)}${f.teachers.length ? `(${more(f.teachers)})` : ''}` : '수강 반 없음'].filter(Boolean).join(' · '),
          cells: { school: sg, classes: more(f.classNames), teachers: more(f.teachers, 2) }, search: [...f.classNames, ...f.teachers].join(' ') };
      }).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
      return { noun: '원생', unit: '명', columns: [{ key: 'name', label: '이름', w: 'minmax(0,1fr)' }, { key: 'school', label: '학교·학년', w: 'minmax(0,1fr)', cend: true }, { key: 'classes', label: '수강 반', w: 'minmax(0,1.5fr)' }, { key: 'teachers', label: '담임', w: 'minmax(0,1fr)' }],
        options, compactBelow: 520, compact: { cols: '1.25rem repeat(2,minmax(0,1fr))', areas: '"tick c-name c-school" "tick c-classes c-teachers"' }, searchPlaceholder: '이름·학교·학년·반·담임으로 찾기', searchHint: '이름·학교·반을 다시 확인해 주세요.', note: `재원생 ${options.length}명` };
    },
    classes({ db, subjectLabel = v => v }) {
      const options = (db.classes || []).map(c => {
        const subj = subjectLabel(c.subject); const subject = subj && subj !== c.subject ? subj : '';
        const time = schedule(c);
        return { value: c.id, title: c.name, sub: c.room || '', chip: c.teacher || '', context: [subject, c.teacher ? `담임 ${c.teacher}` : '담임 없음', time].filter(Boolean).join(' · '),
          cells: { subject, teacher: c.teacher || '', time, students: Array.isArray(c.students) ? `${c.students.length}명` : '' }, search: c.room || '' };
      }).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
      return { noun: '반', unit: '개', columns: [{ key: 'name', label: '반', w: 'minmax(0,1.5fr)' }, { key: 'subject', label: '과목', w: 'minmax(3.2em,.5fr)' }, { key: 'teacher', label: '담임', w: 'minmax(0,.7fr)' }, { key: 'time', label: '시간표', w: 'minmax(0,1.3fr)' }, { key: 'students', label: '수강', w: '3.6em', align: 'end' }],
        options, compactBelow: 600, compact: { cols: '1.25rem repeat(3,minmax(0,1fr))', areas: '"tick c-name c-name c-students" "tick c-subject c-teacher c-teacher" "tick c-time c-time c-time"' }, searchPlaceholder: '반·과목·담임·강의실로 찾기', searchHint: '반 이름이나 담임을 다시 확인해 주세요.', note: `반 ${options.length}개` };
    },
    /** Invoices by id (or invoice-like rows): billed / paid / remaining are always labeled separately. */
    invoices({ db, items, cases, total }) {
      const { invoices } = index(db);
      const options = (items || []).map(item => {
        const id = String(typeof item === 'object' ? item.id : item), inv = { ...(typeof item === 'object' ? item : {}), ...(invoices.get(id) || {}) };
        const f = studentFacts(db, inv.studentId), name = f.s?.name || inv.name || inv.label || '청구', sg = schoolGrade(f.s);
        // 청구액 = 할인 전 − 할인 (수납관리와 같은 정의), so 청구액 − 수납액 = 미수액. The server's `billed` is before discount.
        const has = v => v !== undefined && v !== null && v !== '', discount = Number(inv.discount) || 0, billed = has(inv.total) ? inv.total : has(inv.billed) ? Number(inv.billed) - discount : undefined;
        const follow = inv.followup || followupOf(cases, `invoice:${id}`);
        return { value: id, title: name, sub: sg, chip: inv.period || '',
          context: [inv.period, has(billed) ? `청구액 ${won(billed)}` : '', has(inv.paid) ? `수납액 ${won(inv.paid)}` : '', has(inv.remaining) ? `미수액 ${won(inv.remaining)}` : '', discount > 0 ? `할인 ${won(discount)} 반영` : '', follow ? FOLLOW[follow.state] || '진행 중 시나리오' : ''].filter(Boolean).join(' · '),
          cells: { classes: f.classNames.length ? `${more(f.classNames)}${f.teachers.length ? ` · ${more(f.teachers)}` : ''}` : '', period: inv.period || '', billed: has(billed) ? won(billed) : '', paid: has(inv.paid) ? won(inv.paid) : '', remaining: has(inv.remaining) ? won(inv.remaining) : '' },
          search: [inv.period, ...f.classNames, ...f.teachers, follow ? '진행 중' : ''].join(' ') };
      });
      return { noun: '청구 기록', unit: '건', columns: [{ key: 'name', label: '학생', w: 'minmax(0,1.1fr)' }, { key: 'classes', label: '수강 반·담임', w: 'minmax(0,1.3fr)' }, { key: 'period', label: '청구월', w: '4.6em', cend: true }, { key: 'billed', label: '청구액', w: '6.6em', align: 'end' }, { key: 'paid', label: '수납액', w: '6.6em', align: 'end' }, { key: 'remaining', label: '미수액', w: '6.6em', align: 'end', strong: true }],
        options, compactBelow: 680, compact: { cols: '1.25rem repeat(3,minmax(0,1fr))', areas: '"tick c-name c-name c-period" "tick c-billed c-paid c-remaining" "tick c-classes c-classes c-classes"' }, searchPlaceholder: '학생·학교·반·담임·청구월로 찾기', searchHint: '학생 이름이나 반을 다시 확인해 주세요.', note: total && total > options.length ? `청구 ${total.toLocaleString('ko-KR')}건 중 ${options.length}건 표시` : `${options.length}건` };
    },
    /** Absence rows: {id, date, studentId, classId, followup} from the server, or the flow entities fallback below. */
    absences({ db, items, cases, total }) {
      const { classes } = index(db);
      const options = (items || []).map(x => {
        const f = studentFacts(db, x.studentId), cls = classes.get(String(x.classId || '')), sg = schoolGrade(f.s);
        const follow = x.followup || followupOf(cases, `attendance:${x.id}`), followText = follow ? FOLLOW[follow.state] || '진행 중 시나리오' : '';
        return { value: String(x.id), title: f.s?.name || '학생 정보 없음', sub: sg, chip: x.date || x.label || '',
          context: [x.date ? `${x.date} 결석` : x.label || '', cls ? `${cls.name}${cls.teacher ? `(${cls.teacher})` : ''}` : '', followText].filter(Boolean).join(' · '),
          cells: { cls: cls ? `${cls.name}${cls.teacher ? ` · ${cls.teacher}` : ''}` : '', date: x.date || x.label || '', follow: followText },
          search: [cls?.name, cls?.teacher].join(' ') };
      });
      return { noun: '결석 기록', unit: '건', columns: [{ key: 'name', label: '학생', w: 'minmax(0,1fr)' }, { key: 'cls', label: '반·담임', w: 'minmax(0,1.4fr)' }, { key: 'date', label: '결석', w: 'minmax(7.8em,.7fr)', cend: true }, { key: 'follow', label: '후속', w: 'minmax(0,.8fr)' }],
        options, compactBelow: 560, compact: { cols: '1.25rem repeat(2,minmax(0,1fr))', areas: '"tick c-name c-date" "tick c-cls c-follow"' }, searchPlaceholder: '학생·학교·반·담임·날짜로 찾기', searchHint: '학생 이름이나 반을 다시 확인해 주세요.', note: total && total > options.length ? `이번 달 결석 ${total.toLocaleString('ko-KR')}건 중 ${options.length}건 표시` : `이번 달 결석 ${options.length}건` };
    },
    /** Fallback from GET /api/flow: attendance entities joined to students/classes only through FK relations. */
    absencesFromFlow({ db, flow }) {
      const rel = new Map();
      for (const r of flow?.relations || []) if (r?.from?.type === 'attendance' && ['about_student', 'in_class'].includes(r.type)) { const k = String(r.from.id); rel.set(k, { ...(rel.get(k) || {}), [r.type]: String(r.to.id) }); }
      const items = (flow?.entities || []).filter(e => e?.type === 'attendance').map(e => ({ id: e.id, label: e.label, studentId: rel.get(String(e.id))?.about_student, classId: rel.get(String(e.id))?.in_class }));
      return lists.absences({ db, items, cases: flow?.cases });
    },
    /** Workspace records (preview page + read-only records endpoint): label, detail, date, status and the record's own fields. */
    records({ items, familyLabel = '기록', total }) {
      const labels = [], numeric = new Set();
      for (const r of items || []) for (const f of r.fields || []) { if (!labels.includes(f.label)) labels.push(f.label); if (/^-?[\d,.]+\s*(원|명|건|개|%|분|초)?$/.test(String(f.value).trim())) numeric.add(f.label); }
      const fieldCols = labels.slice(0, 3), hasDate = (items || []).some(r => r.date), hasStatus = (items || []).some(r => r.status);
      const option = r => ({ value: String(r.id), title: r.label || '이름 없는 기록', sub: r.detail || '', chip: r.date || r.status || '', context: [r.date, r.status, ...(r.fields || []).slice(0, 3).map(f => `${f.label} ${f.value}`)].filter(Boolean).join(' · '),
        cells: Object.fromEntries([['date', r.date || ''], ['status', r.status || ''], ...fieldCols.map((l, i) => [`f${i}`, (r.fields || []).find(f => f.label === l)?.value ?? ''])]) });
      return { noun: '기록', unit: '건', option, options: (items || []).map(option), compactBelow: 600,
        columns: [{ key: 'name', label: familyLabel, w: 'minmax(0,1.4fr)' }, ...(hasDate ? [{ key: 'date', label: '일자', w: '6.4em' }] : []), ...(hasStatus ? [{ key: 'status', label: '상태', w: 'minmax(4em,.6fr)' }] : []), ...fieldCols.map((l, i) => ({ key: `f${i}`, label: l, w: numeric.has(l) ? '6.6em' : 'minmax(0,.9fr)', align: numeric.has(l) ? 'end' : undefined }))],
        searchPlaceholder: '이름·상태·날짜로 찾기', note: `${total && total > (items || []).length ? `불러온 ${(items || []).length}건 표시 · 전체 ${Number(total).toLocaleString('ko-KR')}건은 검색어로 찾습니다` : `${(items || []).length}건`}` };
    },
  };

  return {
    html, lists,
    value: x => { const e = entryOf(rootOf(x)); return e ? e.selected.slice() : []; },
    set: (x, values) => { const root = rootOf(x); if (root) commit(root, Array.isArray(values) ? values : [values]); },
    focus: (form, name) => { const t = form?.querySelector(`[data-cpick-name="${CSS.escape(name)}"] .cpick-trigger`); t?.focus(); return Boolean(t); },
    label: (x, value) => { const e = entryOf(rootOf(x)), o = e && optionOf(e, value); return o ? `${o.title}${o.sub ? ` · ${o.sub}` : ''}` : ''; },
    close: x => close(rootOf(x)),
  };
})();
