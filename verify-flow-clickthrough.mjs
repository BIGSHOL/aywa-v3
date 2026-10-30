import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 4311 전용 수동 경로의 자동 클릭 기록. 다른 서버로 향하는 POST는 막는다.
const base = 'http://127.0.0.1:4311';
const out = path.resolve('work/owner-concept/clickthrough-1030');
const clean = text => String(text || '').replace(/01\d[- ]?\d{3,4}[- ]?\d{4}/g, '[전화번호]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[이메일]');
const slug = text => String(text || '기타').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70);
const getFlow = async () => {
  const res = await fetch(`${base}/api/flow`);
  if (!res.ok) throw Error(`업무 API ${res.status}`);
  const first = await res.json();
  const pages = [first];
  for (let p = 2; p <= (first.casePageCount || 1); p++) pages.push(await (await fetch(`${base}/api/flow?casePage=${p}`)).json());
  return { ...first, cases: pages.flatMap(x => x.cases || []) };
};
const initial = await getFlow();
const allOpen = initial.cases.filter(c => c.state !== 'done' && c.origin !== 'dev');
const repair = process.env.CLICKTHROUGH_REPAIR_ID || '';
const recheckIds = new Set(String(process.env.CLICKTHROUGH_RECHECK_IDS || '').split(',').filter(Boolean));
const recheck = process.env.CLICKTHROUGH_RECHECK_NON_ATTENDANCE === '1' || recheckIds.size > 0;
const selectedOpen = repair ? initial.cases.filter(c => c.id === repair) : recheck ? initial.cases.filter(c => c.state !== 'done' && c.origin !== 'dev' && (recheckIds.size ? recheckIds.has(c.id) : c.taskKind !== 'attendance_absent_desk')) : process.env.CLICKTHROUGH_KIND ? allOpen.filter(c => (c.taskKind || c.signalId || c.kind) === process.env.CLICKTHROUGH_KIND) : allOpen;
const open = process.env.CLICKTHROUGH_LIMIT ? selectedOpen.slice(0, Number(process.env.CLICKTHROUGH_LIMIT)) : selectedOpen;
const owner = initial.actors.find(a => a.role === 'owner' && !a.preview);
const manager = initial.actors.find(a => a.role === 'manager' && !a.preview);
const teacher = initial.actors.find(a => a.role === 'teacher' && !a.preview);
if (!owner || !manager || !teacher || allOpen.length < 100) throw Error('시험장 업무 수나 역할을 확인할 수 없습니다.');
const actor = id => initial.actors.find(a => a.id === id);
const kind = c => c.taskKind || c.signalId || c.kind || '기타';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(7000);
const requests = [];
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(clean(e.message)));
page.on('request', req => {
  if (req.method() !== 'GET' && req.method() !== 'HEAD') {
    const url = new URL(req.url());
    requests.push({ method: req.method(), path: url.pathname });
  }
});
await page.route('**/*', route => {
  const req = route.request();
  const url = new URL(req.url());
  if (!['GET', 'HEAD'].includes(req.method()) && url.origin !== base) return route.abort('blockedbyclient');
  return route.continue();
});
const closeDialogs = () => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const currentActor = () => page.locator('#fl-actor input[name="actor"]').inputValue();
async function asActor(person) {
  await closeDialogs();
  if (await currentActor() === person.id) return;
  await page.locator('#fl-actor .cpick-trigger').click();
  await page.locator('#fl-actor [data-cpick-search]').fill(person.name);
  const option = page.locator(`#fl-actor [role="option"][data-value="${person.id}"]`);
  await option.click();
  await page.waitForFunction(id => document.querySelector('#fl-actor input[name="actor"]')?.value === id, person.id);
}
async function flowPage() {
  if (!page.url().endsWith('#flow')) await page.evaluate(() => { location.hash = 'flow'; });
  await page.waitForFunction(() => document.body.dataset.page === 'flow');
  await page.locator('#fl-actor').waitFor();
}
async function findCase(c, role) {
  await flowPage();
  const ownerView = role === 'owner';
  const managerView = role === 'manager';
  const root = ownerView ? '#fl-board-list' : managerView ? '#fl-detail' : '.fl-now';
  const selector = ownerView ? `.fl-row[data-case="${c.id}"]` : `.fl-case[data-case="${c.id}"]`;
  for (const filter of ownerView ? ['moving', 'done'] : managerView ? ['all'] : ['']) {
    if (filter) await page.locator(`[data-fl="filter"][data-id="${filter}"]`).first().click();
    for (let n = 1; n <= 12; n++) {
      const row = page.locator(`${root} ${selector}`).first();
      if (await row.count()) return row;
      const next = page.locator(`${root} [data-fl="page"][data-id="${n + 1}"]:not([disabled])`).first();
      if (!await next.count()) break;
      await next.click();
    }
  }
  return null;
}
async function shot(dir, name) {
  const file = path.join(dir, `${name}.jpg`);
  for (const frame of page.frames()) await frame.addStyleTag({ content: 'a[href^="tel:"],a[href^="mailto:"]{visibility:hidden!important}' }).catch(() => {});
  await page.screenshot({ path: file, type: 'jpeg', quality: 43, animations: 'disabled', timeout: 12000 });
  return path.basename(file);
}
function note(steps, action, result = {}) {
  steps.push({ action, at: new Date().toISOString(), ...result });
}
async function clickForm(dir, steps, label, selector, shotName) {
  const button = page.locator(selector).first();
  if (!await button.count()) return false;
  await button.click();
  note(steps, label, { dialog: clean((await page.locator('#modal').innerText()).slice(0, 1600)) });
  if (shotName) await shot(dir, shotName);
  return true;
}
async function viewRole(c, person, role, dir, steps) {
  await asActor(person);
  const row = await findCase(c, role);
  if (!row) {
    note(steps, `${role} 목록`, { visible: false, person: person.name });
    return false;
  }
  note(steps, `${role} 목록`, { visible: true, person: person.name, text: clean((await row.innerText()).slice(0, 900)) });
  await row.locator('[data-fl="open"]').first().click();
  const detail = page.locator('#detail[open]');
  const text = clean((await detail.innerText()).slice(0, 3500));
  note(steps, `${role} 상세`, {
    open: true, text,
    stages: await detail.locator('.fl-chain li, .fl-step').count(),
    events: await detail.locator('.ax-request-timeline li').count(),
    related: c.entityRefs?.length || 0,
    buttons: await detail.locator('[data-fl]').evaluateAll(ns => ns.map(n => n.textContent.trim()).filter(Boolean)),
  });
  await shot(dir, `${role}-상세`);
  return true;
}
async function processScreen(c, dir, steps) {
  await asActor(owner);
  const row = await findCase(c, 'owner');
  if (!row) { note(steps, '처리 화면', { reached: false, reason: '업무가 목록에서 사라짐' }); return; }
  const button = row.locator('[data-fl="goto"]');
  if (!await button.count()) { note(steps, '처리 화면', { reached: false, reason: '열기 버튼 없음' }); return; }
  await button.click();
  const peek = page.locator('dialog.fl-peek[open]');
  try { await peek.waitFor({ timeout: 9000 }); } catch { note(steps, '처리 화면', { reached: false, reason: '엿보기 창 열리지 않음' }); return; }
  const frame = page.frameLocator('dialog.fl-peek iframe');
  await page.waitForTimeout(600);
  let outer = '', main = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    outer = clean(await frame.locator('body').innerText().catch(() => ''));
    main = await frame.locator('#main').count() ? clean(await frame.locator('#main').innerText().catch(() => outer)) : outer;
    if (await frame.locator('iframe.v2h-frame:not([hidden])').count() || main.length > 120 && !/불러오는 중|로딩 중/.test(main)) break;
    await page.waitForTimeout(300);
  }
  const nested = frame.frameLocator('iframe.v2h-frame:not([hidden])');
  let inner = '', nestedUrl = '', reached = false;
  if (await frame.locator('iframe.v2h-frame:not([hidden])').count()) {
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        inner = clean(await nested.locator('body').innerText().catch(() => ''));
        if (inner.length > 100 && !/불러오는 중|로딩 중/.test(inner.slice(0, 100))) break;
        await page.waitForTimeout(400);
      }
      nestedUrl = await nested.locator('body').evaluate(n => n.ownerDocument.location.pathname + n.ownerDocument.location.search);
      reached = inner.length > 100 && !/불러오는 중|로딩 중/.test(inner.slice(0, 100));
    } catch { /* 호스트가 끝까지 열리지 않았음을 기록한다. */ }
  } else reached = main.length > 120 && !/불러오는 중|로딩 중/.test(main);
  const outerRoute = await frame.locator('body').evaluate(n => n.ownerDocument.location.hash).catch(() => '');
  const summary = clean(c.summary || '');
  const name = summary.split(/[·—]/)[0].trim();
  const time = c.taskKind === 'attendance_absent_desk' ? String(c.summary || '').match(/\b\d{1,2}:\d{2}\b/)?.[0] : '';
  const initialScreen = (inner || main || outer).slice(0, 1600);
  const directRoute = (nestedUrl || outerRoute).toLowerCase();
  const recordInRoute = (c.entityRefs || []).some(r => r.type !== 'task' && String(r.recordId || r.id || '').length > 20 && directRoute.includes(String(r.recordId || r.id).toLowerCase()));
  const targetVisible = reached && (recordInRoute || name.length >= 2 && initialScreen.includes(name) && (!time || initialScreen.includes(time)));
  note(steps, '처리 화면', { reached, targetVisible, name, route: nestedUrl || outerRoute, hostLoaded: !!nestedUrl, loading: !reached && /불러오는 중|로딩 중/.test(main || inner || outer), text: (inner || main || outer).slice(0, 1600) });
  // 전화번호는 증거 사진에 포함하지 않는다.
  await frame.locator('body').evaluate(n => { n.ownerDocument.querySelectorAll('a[href^="tel:"]').forEach(a => { a.textContent = '[전화번호]'; a.removeAttribute('title'); }); }).catch(() => {});
  await nested.locator('body').evaluate(n => { n.ownerDocument.querySelectorAll('a[href^="tel:"]').forEach(a => { a.textContent = '[전화번호]'; a.removeAttribute('title'); }); }).catch(() => {});
  await shot(dir, '처리-화면');
  await closeDialogs();
}
async function workerActions(c, person, dir, steps) {
  await asActor(person);
  let row = await findCase(c, person.role);
  if (!row) return;
  await row.locator('[data-fl="open"]').first().click();
  const ack = page.locator(`#detail [data-fl="ack"][data-id="${c.id}"]`).first();
  if (await ack.count()) {
    const before = requests.length;
    await ack.click();
    await page.waitForTimeout(450);
    note(steps, '확인', { clicked: true, requests: requests.slice(before), toast: clean(await page.locator('#toast').innerText().catch(() => '')) });
    await shot(dir, '확인-후');
  } else note(steps, '확인', { clicked: false, reason: '현재 담당자의 확인 버튼 없음' });
  const report = page.locator(`#detail [data-fl="report-open"][data-id="${c.id}"]`).first();
  if (await report.count()) {
    await report.click();
    note(steps, '후속 보고 초안', { dialog: clean((await page.locator('#modal').innerText()).slice(0, 1600)) });
    await page.locator('#modal textarea[name="note"]').fill('연습 복사본에서 업무 흐름과 원본 처리 경로를 확인했습니다.');
    await shot(dir, '보고-초안');
    const before = requests.length;
    await page.locator('#modal form[data-fl-form="report"] button[type="submit"]').click();
    await page.waitForTimeout(500);
    note(steps, '후속 보고 저장', { requests: requests.slice(before), toast: clean(await page.locator('#toast').innerText().catch(() => '')), error: clean(await page.locator('#modal .ax-form-error').innerText().catch(() => '')) });
  } else note(steps, '후속 보고', { clicked: false, reason: '현재 단계에 보고 버튼 없음' });
  await closeDialogs();
}
async function reassign(c, dir, steps) {
  const current = (await getFlow()).cases.find(x => x.id === c.id);
  const step = current?.steps?.find(s => ['ready', 'working'].includes(s.status) && s.assigneeIds?.length);
  const oldId = step?.assigneeIds?.[0];
  const old = actor(oldId);
  const alternative = old && initial.actors.find(a => a.assignable && a.id !== oldId && a.role === old.role);
  await asActor(owner);
  const row = await findCase(c, 'owner');
  if (!row) return;
  await row.locator('[data-fl="open"]').first().click();
  await clickForm(dir, steps, '담당자 변경 열기', `#detail [data-fl="reassign-open"][data-id="${c.id}"]`, '담당자-변경');
  if (!old?.assignable || !alternative) {
    note(steps, '담당자 변경·복원', { changed: false, reason: !old?.assignable ? '현재 원본 담당자가 선택 명단에서 제외돼 변경 후 복원 불가' : '같은 역할의 대체 담당자 없음' });
    await closeDialogs();
    return;
  }
  const selectOnly = async (want, remove) => {
    const pick = page.locator('#modal [data-cpick-name="assignee"]');
    const choose = async person => {
      if (!await pick.locator('.cpick-panel').isVisible()) await pick.locator('.cpick-trigger').click();
      await pick.locator('[data-cpick-search]').fill(person.name);
      await pick.locator(`[role="option"][data-value="${person.id}"]`).click();
    };
    const chosen = await pick.locator('input[name="assignee"]').evaluateAll(ns => ns.map(n => n.value));
    if (!chosen.includes(want.id)) await choose(want);
    if (chosen.includes(remove.id)) await choose(remove);
    return pick.locator('input[name="assignee"]').evaluateAll(ns => ns.map(n => n.value));
  };
  const submit = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/flow/actions') && r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('#modal form[data-fl-form="reassign"] button[type="submit"]').click(),
    ]);
    await page.waitForTimeout(350);
    return { status: response.status(), error: (await response.json().catch(() => null))?.error || '' };
  };
  try {
    const selected = await selectOnly(alternative, old);
    await page.locator('#modal [data-cpick-name="assignee"] .cpick-trigger').click();
    const changed = await submit();
    note(steps, '담당자 변경', { old: old.name, next: alternative.name, selected, ...changed });
    await shot(dir, '담당자-변경-후');
    await closeDialogs();
    const nextRow = await findCase(c, 'owner');
    await nextRow.locator('[data-fl="open"]').first().click();
    await page.locator(`#detail [data-fl="reassign-open"][data-id="${c.id}"]`).click();
    const restored = await selectOnly(old, alternative);
    await page.locator('#modal [data-cpick-name="assignee"] .cpick-trigger').click();
    const result = await submit();
    note(steps, '담당자 복원', { selected: restored, ...result, restored: (await getFlow()).cases.find(x => x.id === c.id)?.steps?.some(s => s.id === step.id && s.assigneeIds?.includes(oldId)) });
  } catch (e) { note(steps, '담당자 변경·복원', { error: clean(e.message).slice(0, 500) }); }
  await closeDialogs();
}
async function saveAttendance(c, dir, steps) {
  if (c.taskKind !== 'attendance_absent_desk') return;
  await asActor(owner);
  const row = await findCase(c, 'owner');
  if (!row) return;
  await row.locator('[data-fl="goto"]').click();
  const nested = page.frameLocator('dialog.fl-peek iframe').frameLocator('iframe');
  const summary = String(c.summary || '');
  const name = summary.split('·')[0].trim();
  const time = summary.match(/\b\d{1,2}:\d{2}\b/)?.[0] || '';
  try {
    await nested.getByText(name, { exact: true }).first().waitFor({ timeout: 15000 });
    const cards = nested.locator('div.px-3.py-2\\.5').filter({ hasText: name });
    const card = time ? cards.filter({ hasText: time }).first() : cards.first();
    if (!await card.count() || !await card.getByRole('button', { name: '기록', exact: true }).count()) {
      note(steps, '원본 저장', { saved: false, reason: '대상 결석 행 또는 기록 버튼 없음', name, time }); return;
    }
    await card.getByRole('button', { name: '기록', exact: true }).click();
    const choice = card.getByRole('button', { name: '연락 안 됨', exact: true });
    if (await choice.count()) await choice.click();
    const save = card.getByRole('button', { name: '저장', exact: true });
    if (!await save.count()) { note(steps, '원본 저장', { saved: false, reason: '저장 버튼 없음' }); return; }
    const before = requests.length;
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/v2/attendance/recordFollowup') && r.request().method() === 'POST', { timeout: 12000 }),
      save.click(),
    ]);
    const result = await response.json().catch(() => null);
    await page.waitForTimeout(1500);
    const after = await getFlow();
    const updated = after.cases.find(x => x.id === c.id);
    note(steps, '원본 저장', { clicked: true, requests: requests.slice(before), status: response.status(), saved: response.ok(), result: result?.error || result?.message || '', closed: updated?.state === 'done', sourceStatus: updated?.sourceStatus, screen: clean(await nested.locator('body').innerText()).slice(0, 500) });
    await shot(dir, '저장-후');
  } catch (e) { note(steps, '원본 저장', { saved: false, error: clean(e.message).slice(0, 400) }); }
  finally { await closeDialogs(); }
}
await mkdir(out, { recursive: true });
const summary = [];
try {
  await page.goto(`${base}/#flow`);
  await page.locator('#fl-actor').waitFor();
  for (let i = 0; i < open.length; i++) {
    const c = open[i];
    const dir = path.join(out, slug(kind(c)), c.id);
    await mkdir(dir, { recursive: true });
    const steps = [];
    const startErrors = pageErrors.length;
    try {
      if (recheck) {
        await processScreen(c, dir, steps);
        const prior = JSON.parse(await readFile(path.join(dir, 'steps.json'), 'utf8'));
        prior.steps = prior.steps.filter(s => s.action !== '처리 화면');
        prior.steps.push(...steps);
        await writeFile(path.join(dir, 'steps.json'), JSON.stringify(prior, null, 2) + '\n');
        console.log(`${i + 1}/${open.length} ${kind(c)} 화면 재확인`);
        continue;
      }
      const deep = !repair && (kind(c) !== 'attendance_absent_desk' || open.filter(x => kind(x) === kind(c)).indexOf(c) < 5);
      const assigned = (c.steps || []).flatMap(s => s.status === 'ready' || s.status === 'working' ? s.assigneeIds || [] : []);
      const worker = assigned.map(actor).find(a => a && a.role === 'teacher') || assigned.map(actor).find(Boolean) || teacher;
      await viewRole(c, owner, 'owner', dir, steps);
      await processScreen(c, dir, steps);
      if (deep) {
        await viewRole(c, manager, 'manager', dir, steps);
        await viewRole(c, worker, worker.role, dir, steps);
        await reassign(c, dir, steps);
        await workerActions(c, worker, dir, steps);
        await saveAttendance(c, dir, steps);
      } else note(steps, '표본 범위', { deep: false, reason: '결석 확인 전화 126건 중 5건만 저장 경로까지 점검' });
    } catch (e) { note(steps, '예외', { error: clean(e.stack || e.message).slice(0, 1500) }); await closeDialogs().catch(() => {}); }
    const after = await getFlow().catch(() => null);
    const last = after?.cases.find(x => x.id === c.id);
    const state = { kind: kind(c), id: c.id, title: c.title, originalState: c.state, finalState: last?.state || null, closed: last?.state === 'done', factClosed: !!last?.factClosed, steps, pageErrors: pageErrors.slice(startErrors) };
    await writeFile(path.join(dir, 'steps.json'), JSON.stringify(state, null, 2) + '\n');
    summary.push({ kind: kind(c), id: c.id, title: c.title, deep: !steps.some(s => s.action === '표본 범위'), opened: steps.some(s => s.action === 'owner 상세' && s.open), screen: steps.some(s => s.action === '처리 화면' && s.reached), target: steps.some(s => s.action === '처리 화면' && s.targetVisible), saved: steps.some(s => s.action === '원본 저장' && s.saved), closed: state.closed, errors: steps.filter(s => s.error || s.action === '예외').map(s => s.error) });
    console.log(`${i + 1}/${open.length} ${kind(c)} ${c.id} ${state.closed ? '닫힘' : '열림'}`);
  }
} finally { await browser.close(); }
if (repair || recheck) process.exit(0);
const settledFlow = await getFlow();
for (const row of summary) {
  const c = settledFlow.cases.find(x => x.id === row.id);
  row.closed = c?.state === 'done';
  const file = path.join(out, slug(row.kind), row.id, 'steps.json');
  const entry = JSON.parse(await readFile(file, 'utf8'));
  entry.settled = { state: c?.state || null, factClosed: !!c?.factClosed, sourceStatus: c?.sourceStatus || null, closedReason: c?.closedReason || null, checkedAt: new Date().toISOString() };
  await writeFile(file, JSON.stringify(entry, null, 2) + '\n');
}
const groups = Map.groupBy(summary, x => x.kind);
const md = [
  '# 업무 흐름 전수 클릭 시험 · 2026-10-30',
  '',
  `시험장: ${base} · 시작 시 열린 업무 ${open.length}건 · 실제 점검 ${summary.length}건.`,
  `전건 목록·상세·처리 화면을 확인했습니다. 역할별 버튼과 저장은 종류별 표본으로 확인했습니다(결석 확인 전화 5건, 그 밖의 종류 전부). 저장하지 않은 업무의 '미닫힘'은 결함으로 세지 않았습니다.`,
  '',
  '| 종류 | 건수 | 상세 열림 | 처리 화면 | 대상 표시 | 원본 저장 | 닫힘 |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...[...groups].map(([k, list]) => `| ${k} | ${list.length} | ${list.filter(x => x.opened).length} | ${list.filter(x => x.screen).length} | ${list.filter(x => x.target).length} | ${list.filter(x => x.saved).length} | ${list.filter(x => x.closed).length} |`),
  '',
  '## 막힌 곳',
  '',
  ...summary.filter(x => !x.opened || !x.screen || !x.target || x.deep && !x.closed || x.errors.length).map(x => `- ${x.kind} / ${x.id}: ${[!x.opened && '상세 미열림', !x.screen && '처리 화면 미도달', !x.target && '대상 미표시', x.deep && !x.closed && (x.saved ? '원본 저장 성공, 업무 미닫힘' : '원본 저장 미실행 또는 실패, 업무 미닫힘'), ...x.errors].filter(Boolean).join(' · ')}`),
  '',
  '세부 클릭·화면 문구·요청·오류는 각 업무의 steps.json에 기록했습니다. 저장은 4311 시험장에만 했습니다.',
];
await writeFile(path.join(out, 'summary.md'), md.join('\n') + '\n');
console.log(`요약 ${path.join(out, 'summary.md')}`);
