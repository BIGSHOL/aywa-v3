import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { loadInventory, ownerFamilies, buildFixtureCatalog, installWorkspaceRoutes } from './verify-workspaces-fixtures.mjs';
import { assistantRequestProblems } from './ax-assistant-limits.mjs';

// Owner workspaces: every owner-visible 2.0 family is reachable with a deliberate destination for each operation group,
// representative priority flows work end to end as local previews/requests, and nothing is written or sent.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const dir=new URL('./',import.meta.url),shots='work/owner-concept/workspace-qa';
const inventory=await loadInventory(),owner=ownerFamilies(inventory),auditOnly=inventory.families.filter(x=>x.ownerScope==='audit-only').map(x=>x.id);
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],external=[],mutations=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const url=new URL(r.url());if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());if(!['GET','HEAD'].includes(r.method())&&url.pathname!=='/api/assistant')mutations.push(`${r.method()} ${url.pathname}`);});
const assistant=[];
await page.route('**/api/assistant',async route=>{const body=route.request().postDataJSON();assistant.push(body);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answer:'모의 응답입니다.',issueIds:[],suggestedTask:null,provider:'claude-cli'})});});
const routes=await installWorkspaceRoutes(page,{base,dir,catalog:buildFixtureCatalog(inventory)});
const close=()=>page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
const go=async id=>{await close();await page.evaluate(id=>{location.hash=id;},id);await page.waitForFunction(id=>document.body.dataset.page===id,id);};
const shot=(name,fullPage=false)=>page.screenshot({path:`${shots}/${name}.png`,fullPage,animations:'disabled'});
const action=id=>page.locator(`.ws-side .ws-action[data-action="${id}"]`);
const pickOwner=async staffId=>{await page.locator('#ax-owner-trigger').click();await page.locator(`#ax-owner-list [data-owner="${staffId}"]`).click();await page.keyboard.press('Escape');};
const expectValue=async(sel,re,msg)=>{await page.waitForFunction(([s,src,flags])=>new RegExp(src,flags).test(document.querySelector(s)?.value||''),[sel,re.source,re.flags],{timeout:5000}).catch(()=>{});assert.match(await page.locator(sel).inputValue(),re,msg);};
const expectText=async(sel,re,msg)=>{await page.waitForFunction(([s,src,flags])=>new RegExp(src,flags).test(document.querySelector(s)?.innerText||''),[sel,re.source,re.flags],{timeout:5000}).catch(()=>{});assert.match(await page.locator(sel).first().innerText(),re,msg);};
const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
const waitCall=async re=>{for(let i=0;i<60;i++){if(routes.recordsMock.calls.some(c=>re.test(c)))return;await page.waitForTimeout(100);}throw new Error(`No records call matching ${re}`);};

try{
  await mkdir(shots,{recursive:true});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  const staff=await page.evaluate(()=>window.AcademySnapshot.staff.map(s=>({id:s.id,name:s.name})));

  // 1. Catalog scope and runtime coverage map.
  const areaIds=await page.evaluate(()=>window.AxCatalog.areas.map(a=>a.id));
  for(const f of owner)assert(areaIds.includes(f.id),`Owner family ${f.id} is in the catalog`);
  for(const id of auditOnly)assert(!areaIds.includes(id),`Audit-only ${id} is not a branch workspace`);
  const cov=await page.evaluate(()=>window.AxCoverage);
  assert.equal(cov.totals.families,areaIds.length);
  const destinations=new Set(['local-preview','owner-request-draft','navigate']);
  for(const [id,fam] of Object.entries(cov.families)){
    assert(fam.reachable,`${id} reachable`);assert(fam.operations.length>0,`${id} has operations`);
    for(const op of fam.operations){assert(destinations.has(op.destination),`${id}/${op.id} destination`);assert.notEqual(op.status,'broken-target',`${id}/${op.id} target resolves`);assert(op.intent&&op.production==='not-linked',`${id}/${op.id} explains intent and stays a local preview`);}
    for(const f of fam.facets)assert(f.intent&&['filter','count-only','label-only'].includes(f.status),`${id}/${f.id} facet intent`);
  }
  const coveredOps=new Set(Object.values(cov.families).flatMap(f=>f.operations.flatMap(o=>o.sourceOperationIds)));
  const auditedOps=owner.flatMap(f=>(f.operations?.key||[]).map((_,i)=>`${f.id}:${i}`));
  if(routes.fixtureCatalog)for(const op of auditedOps)assert(coveredOps.has(op),`Audited operation group ${op} has a UI destination`);
  const byView=Object.values(cov.families).reduce((o,f)=>(o[f.viewKind]=(o[f.viewKind]||0)+1,o),{});
  assert(['flow','sheet','records','report','settings','timeline'].every(k=>byView[k]>0),'All six view kinds are used');

  // 2. Every owner workspace opens: heading, data state, operations panel, no overflow, no disabled catalog results.
  for(const id of areaIds){
    await go(`workspace-${id}`);
    const label=await page.evaluate(id=>window.AxCatalog.areas.find(a=>a.id===id).label,id);
    assert.equal(await page.locator('main h1').innerText(),label,`${id} heading`);
    assert.equal(await page.locator('.ws-side .ws-action').count(),cov.families[id].operations.length,`${id} lists every operation`);
    assert.equal(await page.locator('.ws-side .ws-action:disabled').count(),0);
    assert(await page.locator('.ws-state .ax-chip').count()===1,`${id} shows its data state`);
    assert(!await overflow(),`${id} overflows at 1440`);
  }

  // 3. Discovery from the left: grouped (collapsed) areas, finder with keyboard/IME, launcher and global search.
  await go('home');
  const groups=await page.locator('#sidebar .ws-groups details').count();assert(groups>=5,'Areas are grouped');
  assert.equal(await page.locator('#sidebar .ws-groups details[open]').count(),0,'Groups start collapsed (no menu wall)');
  await page.locator('#ws-find').fill('보강');
  assert(await page.locator('#ws-find-list li[data-id="makeups"]').count()===1);
  await page.locator('#ws-find').press('ArrowDown');assert.match(await page.locator('#ws-find').getAttribute('aria-activedescendant'),/ws-find-\d/);
  await page.locator('#ws-find').evaluate(n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>document.body.dataset.page),'home','Enter while composing Korean does not navigate');
  await page.locator('#ws-find').fill('급여');await page.locator('#ws-find').press('Enter');
  await page.waitForFunction(()=>document.body.dataset.page==='workspace-payroll');
  assert.equal(await page.locator('#sidebar details[open] a[aria-current="page"]').count(),1,'The current group opens');
  await page.locator('#ws-find').fill('없는업무zz');await expectText('#ws-find-list',/맞는 업무가 없습니다/);
  await page.locator('#ws-find').press('Escape');assert.equal(await page.locator('#ws-find').inputValue(),'');
  await page.locator('#sidebar [data-ax="launcher"]').click();
  assert.equal(await page.locator('#modal .ax-launcher .button').count(),areaIds.length,'Launcher lists every workspace');
  assert.equal(await page.locator('#modal .ax-launcher .button:disabled').count(),0,'No disabled placeholder results');
  await close();await page.keyboard.press('Control+k');await page.getByLabel('통합 검색',{exact:true}).fill('회의록');
  assert(await page.locator('#search-results [data-go="workspace-meetings"]').count()===1,'Global search finds workspaces');await close();

  // 4a. Makeups (flow): record evidence → preview with validation → session log → request with family/record context → back.
  await go('workspace-makeups');
  assert.equal(await page.locator('.ws-stage').count()>=2,true);
  await page.locator('.ws-stage .ws-record').first().click();
  assert(await page.locator('#detail dl').count()>0,'Record evidence opens');
  await page.locator('#detail .ws-action[data-action="makeups.op0"]').click();
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();
  await expectText('#modal .ax-form-error',/입력해 주세요/);
  await page.locator('#modal select[name="command"]').selectOption('assign');await page.locator('#modal input[name="date"]').fill('2026-10-30');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();
  await expectText('#toast',/2\.0에는 반영되지 않았습니다/);
  assert.equal(await page.locator('#ws-local article').count(),1);await expectText('#ws-local',/명령\s*배정/);
  assert.equal(await page.locator('.ws-record .ax-chip.green').count(),1,'The record shows its preview badge');
  await shot('makeups-flow');
  await page.locator('#ws-local [data-ws="local-request"]').click();
  await expectValue('#modal [name=title]',/보강 명령/);await expectValue('#modal [name=body]',/명령: 배정/);
  await expectText('#modal .ax-linked-issues',/출처[\s\S]*보강관리/);
  await pickOwner(staff[0].id);await page.locator('#modal [data-ax-form="request"] button[type=submit]').click();
  await expectText('#detail .ax-request-source',/출처/);
  await page.locator('#detail .ax-request-source [data-ax="navigate"]').click();await page.waitForFunction(()=>document.body.dataset.page==='workspace-makeups');
  assert.equal(await page.locator('.ws-requests .ax-request-row').count(),1,'Requests sent from this workspace are listed here');

  // 4b. Teacher workspace: the assignee acknowledges and reports; the report returns to owner notifications and the source.
  await go('workspace-teacher-workspace');
  await page.locator('#ws-recipient').selectOption(staff[0].id);
  await page.locator('.ws-inbox-item [data-ws="recipient-ack"]').click();
  await expectText('.ws-inbox-item',/진행 중/);
  await page.locator('.ws-inbox-item form button[type=submit]').click();await expectText('.ws-inbox-item .ax-form-error',/입력해 주세요/);
  await page.locator('.ws-inbox-item textarea').fill('보강 배정 완료했습니다.');await page.locator('.ws-inbox-item form button[type=submit]').click();
  await expectText('#toast',/원장 알림/);await expectText('.ws-recipient',/자동 할 일/);
  await shot('teacher-recipient');
  await go('inbox');await expectText('main .ax-notifications',/보강 배정 완료했습니다/);
  await page.locator('main .ax-notifications [data-ax="navigate"][data-id="workspace-makeups"]').click();await page.waitForFunction(()=>document.body.dataset.page==='workspace-makeups');

  // 4c. Newcomers checklist, retention campaign (no aggregate yet), withdrawal reasons with the full records endpoint.
  await go('workspace-newcomers');await action('newcomers.op0').click();
  await page.locator('#modal select[name="student"]').selectOption({index:1});await page.locator('#modal select[name="item"]').selectOption('2주 상담');await page.locator('#modal input[name="done"]').fill('2026-10-27');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#ws-local',/2주 상담/);
  await go('workspace-retention');await expectText('.ws-state',/집계 연결 전/);
  await action('retention.op0').click();await page.locator('#modal input[name="student"]').fill('없는 원생');await page.locator('#modal select[name="status"]').selectOption('연락함');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#modal .ax-form-error',/재원생 목록에서 골라/);
  const enrolled=await page.evaluate(()=>{const s=window.AcademySnapshot.students.find(x=>x.status==='enrolled');return `${s.name} · ${s.school} ${s.grade}`;});
  await page.locator('#modal input[name="student"]').fill(enrolled);await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();
  await expectText('#ws-local',/연락함/);await expectText('#ws-local',new RegExp(enrolled.split(' · ')[0]));
  await go('workspace-withdrawals');
  if(routes.fixtureData){
    await page.waitForFunction(()=>/전체 470건|전체 [\d,]+건/.test(document.querySelector('.ws-search')?.innerText||''));
    assert(routes.recordsMock.calls.some(c=>c.includes('/api/workspaces/withdrawals/records')),'Full records come from the endpoint');
    await page.locator('#ws-main [data-ws="page"]').last().click();await page.waitForFunction(()=>/^2 \//.test(document.querySelector('#ws-main .live-pager span')?.textContent||''));
    await page.locator('#ws-main [data-ws="facet"][data-facet="middle"]').click();await waitCall(/facet=middle/);
    assert(routes.recordsMock.calls.some(c=>/facet=middle/.test(c)&&/page=1/.test(c)),'Facet resets to page 1');
    await page.locator('[data-ws-q="withdrawals"]').fill('신암');await waitCall(/q=%EC%8B%A0%EC%95%94/);
    await page.waitForFunction(()=>/전체 [\d,]+건/.test(document.querySelector('.ws-search span')?.textContent||''));
  }
  await shot('withdrawals-timeline');

  // 4d. Class sheet: keyboard cell edit, cancel with Escape, save changes as a preview.
  await go('workspace-class-sheets');
  const cell=page.locator('.ws-cell').first();await cell.focus();await page.keyboard.press('Enter');
  await page.locator('.ws-cell-input').fill('테스트 값');await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ws-cell.changed').count(),1);await expectText('.ws-sheet-bar',/바뀐 칸 1개/);
  await page.locator('.ws-cell').nth(1).focus();await page.keyboard.press('Enter');await page.locator('.ws-cell-input').fill('취소될 값');await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ws-cell.changed').count(),1,'Escape cancels a cell edit');
  await shot('class-sheet');
  await page.locator('[data-ws="sheet-save"]').click();await expectText('#ws-local',/테스트 값/);
  assert.equal(await page.locator('.ws-cell.changed').count(),0);

  // 4e. Payroll adjustment validation, staff leave, inventory loan, meetings (empty data) → decision request.
  await go('workspace-payroll');await action('payroll.op0').click();
  await page.locator('#modal select[name="slip"]').selectOption({index:1});await page.locator('#modal input[name="amount"]').fill('-5000');await page.locator('#modal textarea[name="reason"]').fill('수업 추가');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#modal .ax-form-error',/0 이상의 숫자/);
  await page.locator('#modal input[name="amount"]').fill('30000');await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();
  await expectText('#ws-local',/30000/);
  await go('workspace-staff');await action('staff.op5').click();
  await page.locator('#modal select[name="staff"]').selectOption(staff[1].id);await page.locator('#modal select[name="kind"]').selectOption('연차');
  await page.locator('#modal input[name="start"]').fill('2026-11-03');await page.locator('#modal input[name="end"]').fill('2026-11-04');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#ws-local',new RegExp(staff[1].name));
  await go('workspace-inventory');await action('inventory.op1').click();
  await page.locator('#modal select[name="item"]').selectOption({index:1});await page.locator('#modal select[name="borrower"]').selectOption(staff[2].id);await page.locator('#modal input[name="start"]').fill('2026-10-27');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#ws-local',/대여 시작/);
  await go('workspace-meetings');
  if(routes.fixtureData)await expectText('#ws-main',/복사본에 기록이 없습니다/,'Empty data is said honestly');
  await action('meetings.op0').click();await page.locator('#modal input[name="title"]').fill('10월 운영 회의');await page.locator('#modal input[name="date"]').fill('2026-10-27');
  await page.locator('#modal input[name="attendees"][value="데스크"]').check();await page.locator('#modal textarea[name="notes"]').fill('결정: 보강 일정표를 금요일까지 정리');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();
  await page.locator('#ws-local [data-ws="local-request"]').click();await expectValue('#modal [name=body]',/보강 일정표를 금요일까지/,'Meeting decisions become a request draft');await close();
  await shot('meetings-empty');

  // 4f. Approval boxes with a real signal → request; settings faces with inline preview forms; report preview.
  await go('workspace-approvals');assert(await page.locator('.ws-stage').count()>=3);
  if(routes.fixtureData){await page.locator('.ws-signal [data-ws="signal-request"]').first().click();await expectValue('#modal [name=title]',/결재 문서 보완/);await expectText('#modal .ax-linked-issues',/전자결재/);await close();}
  await action('approvals.op1').click();await page.locator('#modal select[name="doc"]').selectOption({index:1});await page.locator('#modal select[name="decision"]').selectOption('보류');
  await page.locator('#modal form[data-ws-form="preview"] button[type=submit]').click();await expectText('#ws-local',/보류/);
  await go('workspace-owner-settings');
  await page.locator('.ws-faces [data-facet="makeups"]').click();
  await page.locator('.ws-inline-form input[name="deadline"]').fill('7');await page.locator('.ws-inline-form input[name="notify"]').check();
  await page.locator('.ws-inline-form button[type=submit]').click();await expectText('#ws-local',/담당 강사에게 알림\s*예/);await expectText('#toast',/보강 운영 미리보기 저장 미리보기/);
  await shot('settings-faces');
  await go('workspace-lesson-reports');
  if(routes.fixtureData){const second=page.locator('.ws-report-list button').nth(1);const label=await second.locator('strong').innerText();await second.click();assert.equal(await page.locator('.ws-document h3').innerText(),label);}
  await shot('report-preview');

  // 4g. Workspace charts use the same app popover; the workspace question keeps contextIssueId null.
  if(routes.fixtureData){
    await go('workspace-billing');const col=await page.locator('.ws-trend [data-point]').nth(0).boundingBox();await page.mouse.move(col.x+col.width/2,col.y+col.height/2);
    await expectText('#chart-tip .chart-pop-value',/^[\d,]+원$/,'Exact won value in the workspace trend');
    await shot('billing-trend');
    await go('workspace-attendance');await page.locator('.ws-line .chart-line').focus();await expectText('#chart-tip .chart-pop-head',/^\d{4}년 \d+월 \d+일$/);
  }
  await page.locator('main [data-ws="ask"]').click();await expectText('[data-chat-context]',/대화 주제/);
  await page.locator('#ax-chat-command').press('Enter');await page.locator('.ax-chat-text').waitFor();
  assert.equal(assistant.at(-1).contextIssueId,null,'New family questions keep contextIssueId null');assert.deepEqual(assistantRequestProblems(assistant.at(-1)),[]);await close();

  // 4h. Home: workspace signals below the critical first viewport, connected to a contextual request.
  await go('home');
  if(routes.fixtureData){
    const top=await page.locator('.ws-home-signals').evaluate(n=>n.getBoundingClientRect().top);assert(top>=await page.evaluate(()=>innerHeight)-1,'Signals stay below the first viewport');
    await page.locator('.ws-home-signals [data-ws="signal-request"]').first().click();await expectText('#modal .ax-linked-issues',/출처/);await close();
  }

  // 4i. Automatic tasks are not completed by a button; personal tasks keep their own completion toggle.
  await page.locator('#ax-issue-tasks [data-ax="record"]').first().click();
  assert.equal(await page.locator('#detail [data-action="complete-task"]').count(),0,'Automatic tasks have no generic complete button');
  await expectText('#detail',/자동으로 닫습니다/);
  assert.equal(await page.locator('#detail [data-go]').count(),1,'Automatic tasks open their source record');
  await page.locator('#detail [data-action="task-followup"]').click();await expectText('#modal .ax-linked-issues',/출처/);await close();
  await go('approvals');await page.locator('[data-action="new-task"]').click();await page.getByLabel('해야 할 일').fill('원장 개인 확인');await page.locator('#preview-form button[type="submit"]').click();
  await page.locator('#detail [data-action="complete-task"]').click();await expectText('#detail',/완료/);await close();

  // 5. Phone: workspace without overflow, horizontal stage scroller with edge fades kept across a refresh, finder in the menu.
  await page.setViewportSize({width:390,height:844});await go('workspace-approvals');
  assert(!await overflow(),'Workspace fits the phone');
  const flow=page.locator('.ws-flow');
  if(await flow.evaluate(n=>n.scrollWidth>n.clientWidth+1)){
    assert(Number.parseFloat(await flow.evaluate(n=>n.style.getPropertyValue('--fade-right')))>0,'More stages to the right are faded');
    await flow.evaluate(n=>{n.scrollLeft=n.scrollWidth;n.dispatchEvent(new Event('scroll'));});
    assert.equal(await flow.evaluate(n=>n.style.getPropertyValue('--fade-right')),'0px');assert(Number.parseFloat(await flow.evaluate(n=>n.style.getPropertyValue('--fade-left')))>0);
    const left=await flow.evaluate(n=>n.scrollLeft);await page.locator('#ws-main [data-ws="facet"]').first().click();
    assert.equal(await page.locator('.ws-flow').evaluate(n=>n.scrollLeft),left,'Refreshing the records keeps the scroll position');
  }
  await shot('approvals-390');
  await page.locator('[data-action=menu]').click();await page.locator('#ws-find').fill('재고');await page.locator('#ws-find').press('Enter');
  await page.waitForFunction(()=>document.body.dataset.page==='workspace-inventory'&&!document.body.classList.contains('menu-open'));
  assert(!await overflow());await shot('inventory-390');

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(mutations,[]);
  console.log(`PASS: ${areaIds.length} owner workspaces reachable (${Object.entries(byView).map(([k,v])=>`${k} ${v}`).join(', ')}), ${cov.totals.operations} operations mapped (${Object.entries(cov.totals.byDestination).map(([k,v])=>`${k} ${v}`).join(', ')}), ${routes.fixtureCatalog?`${auditedOps.length} audited operation groups covered, `:''}left finder/launcher/global search, makeups→request→teacher report→owner notification→source, newcomers, retention, withdrawals endpoint paging/facet/search, class sheet edit, payroll validation, leave, inventory loan, meetings decision→request, approval boxes+signal, settings faces, report preview, workspace chart popover, null-context question, home signals below the fold, auto-task semantics, phone fades/scroll retention. Fixtures: catalog=${routes.fixtureCatalog?'test':'served'}, data=${routes.fixtureData?'test projection of the real copy':'served'}.`);
}finally{await browser.close();}
