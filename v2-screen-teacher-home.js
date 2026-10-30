(() => {
  'use strict';
  const S = window.V2Screens; if (!S) return;
  const esc = S.esc, CARD = ['lessons', 'attendance', 'reports', 'tasks', 'parents'];
  const LABEL = { lessons: '오늘 수업', attendance: '출결 미입력', reports: '미작성 보고서', tasks: '내 차례 업무', parents: '안 읽은 학부모 글' };
  const cache = new Map();
  let api = null, currentActor = null, drawer = null;
  const key = (actor, card) => `${actor}:${card}`;
  const url = (actor, card) => card === 'tasks' ? `/api/flow/teacher-inbox?actor=${encodeURIComponent(actor)}`
    : `/api/v2/teacher-home?actor=${encodeURIComponent(actor)}&card=${card}`;
  const fmt = n => Number(n).toLocaleString('ko-KR');
  const count = (card, data) => {
    if (card === 'lessons') return `오늘 수업 ${fmt(data.rows.length)}교시(${fmt(data.classes)}반)`;
    if (card === 'attendance') return data.before ? '시작한 수업 없음' : `출결 미입력 ${fmt(data.rows.length)}반(${fmt(data.cells)}칸)`;
    if (card === 'reports') return data.notApplicable ? '보고서 대상 없음' : `미작성 보고서 ${fmt(data.rows.length)}명`;
    return `${LABEL[card]} ${fmt(data.rows.length)}건`;
  };
  const chip = (actor, card) => {
    const hit = cache.get(key(actor, card));
    if (!hit || hit.state === 'loading') return `<span class="th-chip th-loading" data-th-card="${card}">${LABEL[card]} <span>불러오는 중…</span></span>`;
    if (hit.state === 'error') return `<button type="button" class="th-chip th-error" data-th-retry="${card}">${LABEL[card]} 확인하지 못했습니다 · 다시</button>`;
    const total = hit.data.rows?.length ?? 0;
    const tone = card === 'lessons' ? 'th-regular' : total ? 'th-alert' : 'th-zero';
    return `<button type="button" class="th-chip ${tone}" data-th-open="${card}">${esc(count(card, hit.data))}</button>`;
  };
  const update = (actor, card) => {
    const node = document.querySelector(`[data-th-strip="${actor}"] [data-th-card="${card}"], [data-th-strip="${actor}"] [data-th-open="${card}"], [data-th-strip="${actor}"] [data-th-retry="${card}"]`);
    if (node) node.outerHTML = chip(actor, card);
  };
  const fetchCard = (actor, card, force = false) => {
    const k = key(actor, card), old = cache.get(k);
    if (old && !force) return;
    cache.set(k, { state: 'loading', data: null }); update(actor, card);
    fetch(url(actor, card), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok || d?.error) throw new Error('조회 실패'); return d; })
      .then(data => { cache.set(k, { state: 'ready', data }); update(actor, card); })
      .catch(() => { cache.set(k, { state: 'error', data: null }); update(actor, card); });
  };
  function strip(ctx, actor, home) {
    if (!actor || !/^[0-9a-f-]{36}$/i.test(actor)) return '';
    api = ctx.api; currentActor = actor;
    requestAnimationFrame(() => CARD.forEach(card => fetchCard(actor, card)));
    const other = home === 'ecs' ? 'onescreen' : 'ecs';
    return `<section class="th-shell" data-th-strip="${esc(actor)}"><header class="th-head"><div><strong>선생님 오늘</strong><span>내 수업과 지금 처리할 일을 봅니다.</span></div><nav aria-label="선생님 메뉴"><a href="#v2-${home}?${home === 'ecs' ? `actor=${actor}` : `teacher=${actor}`}&teacherHome=1">내 수업</a><a href="#v2-${other}?${other === 'ecs' ? `actor=${actor}` : `teacher=${actor}`}&teacherHome=1">${other === 'ecs' ? '강사 시트' : '수업보고서'}</a><a href="#v2-teacher-home?actor=${actor}">오늘</a></nav></header><div class="th-summary" aria-label="오늘 할 일">${CARD.map(card => chip(actor, card)).join('')}</div></section>`;
  }
  const parentLink = link => {
    try {
      const url = new URL(link);
      return url.protocol === 'https:' && (url.hostname === 'www.classnote.com' || url.hostname === 'classnote.com') && /^\/service\/report\/\d+\/?$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  };
  const shownAt = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '시각 확인 불가' : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(date);
  };
  const updateDrawerFade = () => {
    const box = drawer?.querySelector('[data-th-detail]'); if (!box) return;
    box.classList.toggle('th-fade-top', box.scrollTop > 1);
    box.classList.toggle('th-fade-bottom', box.scrollTop + box.clientHeight < box.scrollHeight - 1);
  };
  const detail = (card, data, actor) => {
    const rows = data.rows || [];
    const line = row => {
      if (card === 'lessons') return `<li><a href="#v2-timetable">${esc(row.start)} · ${esc(row.className)}</a></li>`;
      if (card === 'attendance') return `<li><a href="#v2-attendance?v2path=${encodeURIComponent(`/attendance/${data.today}/${row.classId}`)}&viewer=${actor}">${esc(row.className)} · ${fmt(row.missing)}칸</a></li>`;
      if (card === 'reports') return `<li><a href="#v2-onescreen?teacher=${actor}&student=${row.studentId}&teacherHome=1">${esc(row.name)}</a></li>`;
      if (card === 'tasks') return `<li><button type="button" data-th-case="${esc(row.id)}">${esc(row.title)}</button></li>`;
      const link = parentLink(row.link);
      return `<li><strong>${esc(row.studentName || row.title || '학부모 글')}</strong>${row.boardName ? `<span> · ${esc(row.boardName)}</span>` : ''}<time>${esc(shownAt(row.createdAt))}</time><p>${esc(row.content || '')}</p>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">원래 글 열기</a>` : ''}</li>`;
    };
    const note = card === 'reports' && data.pairs > rows.length ? `<p>원생 ${rows.length}명 · 학생×과목 ${data.pairs}건</p>` : '';
    return `<h2>${LABEL[card]}</h2>${note}<ol>${rows.map(line).join('') || '<li>지금 확인할 항목이 없습니다.</li>'}</ol>`;
  };
  function openDrawer(card) {
    const actor = currentActor, data = cache.get(key(actor, card))?.data;
    if (!data) return;
    if (!drawer) { drawer = document.createElement('dialog'); drawer.className = 'th-drawer'; drawer.innerHTML = '<button type="button" data-th-close aria-label="닫기">닫기</button><div data-th-detail></div>'; document.body.append(drawer); drawer.querySelector('[data-th-detail]').addEventListener('scroll', updateDrawerFade, { passive: true }); addEventListener('resize', updateDrawerFade); }
    drawer.querySelector('[data-th-detail]').innerHTML = detail(card, data, actor);
    drawer.setAttribute('aria-label', LABEL[card]);
    drawer.showModal();
    requestAnimationFrame(updateDrawerFade);
  }
  document.addEventListener('click', e => {
    const retry = e.target.closest?.('[data-th-retry]'); if (retry) return fetchCard(currentActor, retry.dataset.thRetry, true);
    const open = e.target.closest?.('[data-th-open]'); if (open) return openDrawer(open.dataset.thOpen);
    if (e.target.closest?.('[data-th-close]')) return drawer?.close();
    const task = e.target.closest?.('[data-th-case]'); if (task) { drawer?.close(); api?.openFlowCase?.(task.dataset.thCase); }
  });
  addEventListener('aywa:data-revision', () => { if (currentActor) CARD.forEach(card => fetchCard(currentActor, card, true)); });
  // 보는 선생님이 없으면(원장이 메뉴로 연 경우) 왼쪽 '보는 사람'까지 가지 않고 여기서 고른다.
  function pickView(ctx) {
    const list = ctx.load({ card: 'pick' });
    const head = '<header class="th-head"><div><strong>선생님 오늘</strong><span>볼 선생님을 고르면 그 선생님의 수업과 오늘 할 일이 열립니다.</span></div></header>';
    if (list.status !== 'ready') return `${head}<p class="v2s-note">${list.status === 'error' ? '선생님 명단을 불러오지 못했습니다.' : '선생님 명단을 불러오는 중…'}</p>`;
    if (list.data?.error || !Array.isArray(list.data?.teachers)) return `${head}<p class="v2s-note">선생님 명단을 불러오지 못했습니다.</p>`;
    const rows = list.data.teachers;
    if (!rows.length) return `${head}<p class="v2s-note">재직 중인 선생님이 없습니다.</p>`;
    const subject = key => ctx.api?.subjectLabel?.(key) || '';
    return `${head}<ul class="th-pick" aria-label="볼 선생님">${rows.map(t => `<li><a href="#v2-teacher-home?actor=${esc(t.id)}"><strong>${esc(t.name)}</strong><span>${esc(t.subjects.map(subject).filter(Boolean).join(' · ') || '담당 과목 없음')}</span></a></li>`).join('')}</ul>`;
  }
  window.TeacherHome = { strip };
  S.register({ id: 'teacher-home', label: '선생님 오늘', render(ctx) {
    api = ctx.api;
    const actor = ctx.query.get('actor');
    if (!actor) return pickView(ctx);
    const entry = ctx.load({ actor, card: 'landing' });
    if (entry.status !== 'ready') return `<p class="v2s-note">${entry.status === 'error' ? '선생님 화면을 열지 못했습니다.' : '선생님 작업 화면을 여는 중…'}</p>`;
    if (entry.data?.error) return `<p class="v2s-note">${esc(entry.data.error)}</p>`;
    const home = entry.data.home;
    if (entry.data.route) { requestAnimationFrame(() => location.replace(entry.data.route)); return '<p class="v2s-note">선생님 작업 화면을 여는 중…</p>'; }
    requestAnimationFrame(() => location.replace(`#v2-${home}?${home === 'ecs' ? `actor=${actor}` : `teacher=${actor}`}&teacherHome=1`));
    return '<p class="v2s-note">선생님 작업 화면을 여는 중…</p>';
  } });
})();
