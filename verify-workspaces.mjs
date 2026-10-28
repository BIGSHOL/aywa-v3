import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { loadInventory, ownerFamilies, buildFixtureCatalog, installWorkspaceRoutes } from './verify-workspaces-fixtures.mjs';
import { assistantRequestProblems } from './ax-assistant-limits.mjs';

// Owner workspaces against the catalog in use (the committed AxCatalog, or the fixture when none is available): every
// owner-visible 2.0 family is reachable with a destination for each operation, and representative flows — local preview
// with validation, preview → request → recipient report → owner notification, request fields, navigation, numeric
// bounds, 2.0 screens and setting faces, record paging — work end to end. Nothing is written or sent. Flows pick their
// actions from the catalog by mode and field types instead of fixed ids, so a catalog update does not break them.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const dir=new URL('./',import.meta.url),shots='work/owner-concept/workspace-qa';
const inventory=await loadInventory(),owner=ownerFamilies(inventory),auditOnly=inventory.families.filter(x=>x.ownerScope==='audit-only').map(x=>x.id);
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],external=[],mutations=[],recordCalls=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const url=new URL(r.url());if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());if(!['GET','HEAD'].includes(r.method())&&url.pathname!=='/api/assistant')mutations.push(`${r.method()} ${url.pathname}`);if(/\/api\/workspaces\/[^/]+\/records/.test(url.pathname))recordCalls.push(r.url());});
const assistant=[];
await page.route('**/api/assistant',async route=>{const body=route.request().postDataJSON();assistant.push(body);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answer:'모의 응답입니다.',issueIds:[],suggestedTask:null,provider:'claude-cli'})});});
// This file tests the session request path; the durable flow store has its own journey (verify-flow-ui.mjs).
await page.route('**/api/flow',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'not_found',message:'시험에서는 업무 흐름 서버를 쓰지 않습니다.'})}));
const routes=await installWorkspaceRoutes(page,{base,dir,catalog:buildFixtureCatalog(inventory)});
const close=()=>page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
const go=async id=>{await close();await page.evaluate(id=>{location.hash=id;},id);await page.waitForFunction(id=>document.body.dataset.page===id,id);};
const shot=(name,fullPage=false)=>page.screenshot({path:`${shots}/${name}.png`,fullPage,animations:'disabled'});
const sideAction=(area,id)=>page.locator(`.ws-side .ws-action[data-id="${area}"][data-action="${id}"]`);
const pickOwner=async staffId=>{await page.locator('#ax-owner-trigger').click();await page.locator(`#ax-owner-list [data-owner="${staffId}"]`).click();await page.keyboard.press('Escape');};
const expectValue=async(sel,re,msg)=>{await page.waitForFunction(([s,src,flags])=>new RegExp(src,flags).test(document.querySelector(s)?.value||''),[sel,re.source,re.flags],{timeout:5000}).catch(()=>{});assert.match(await page.locator(sel).inputValue(),re,msg);};
const expectText=async(sel,re,msg)=>{await page.waitForFunction(([s,src,flags])=>new RegExp(src,flags).test(document.querySelector(s)?.innerText||''),[sel,re.source,re.flags],{timeout:5000}).catch(()=>{});assert.match(await page.locator(sel).first().innerText(),re,msg);};
const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Fills a catalog form by field type with values the form accepts (numbers inside the catalog's bounds).
async function fill(form,fields,{number}={}){
  for(const f of fields){
    const t=f.type||'text',el=form.locator(`[name="${f.id}"]`);
    // 고르기 칸은 공용 선택창(context-picker.js — 숨은 값 + 고르기 단추)이다: 열어서 첫 선택지를 고른다.
    const pick=form.locator(`[data-cpick-name="${f.id}"]`).first();
    if(await pick.count()){
      await pick.locator('.cpick-trigger').click();
      const opt=pick.locator('.cpick-opt:not([aria-disabled="true"])').first();
      await opt.waitFor({timeout:5000}).catch(()=>{});if(await opt.count())await opt.click();
      if(await pick.evaluate(n=>n.classList.contains('is-open')))await page.keyboard.press('Escape');
      continue;
    }
    if(!await el.count())continue;
    if(t==='textarea'||t==='text')await el.first().fill(`AX 확인 ${f.label}`);
    else if(['number','money','amount'].includes(t)){const lo=Number.isFinite(Number(f.min))?Number(f.min):0,hi=Number.isFinite(Number(f.max))?Number(f.max):null;await el.first().fill(String(number?.(f)??(hi===null?lo+1:Math.min(lo+1,hi))));}
    else if(t==='date')await el.first().fill('2026-10-30');
    else if(t==='month')await el.first().fill('2026-11');
    else if(t==='time')await el.first().fill('16:00');
    else if(t==='checkbox'||t==='boolean')await el.first().check();
    else if(t==='multiselect')await el.first().check();
    else if(t==='student')await el.first().fill(await page.evaluate(()=>document.querySelector('#ws-students option')?.value||''));
    else if((await el.first().locator('option').count())>1)await el.first().selectOption({index:1});
  }
}
// Actions of a mode with fields whose every required choice has options in this copy (so a valid entry exists).
const catalog=()=>page.evaluate(()=>window.AxCatalog);
const usable=(a,x)=>(x.fields||[]).length>0&&(x.fields||[]).every(f=>!f.required||!['record'].includes(f.type));

try{
  await mkdir(shots,{recursive:true});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  const staff=await page.evaluate(()=>window.AcademySnapshot.staff.map(s=>({id:s.id,name:s.name})));
  const cat=await catalog(),areaOf=id=>cat.areas.find(a=>a.id===id);

  // 1. Catalog scope and runtime coverage map.
  const areaIds=cat.areas.map(a=>a.id);
  for(const f of owner)assert(areaIds.includes(f.id),`Owner family ${f.id} is in the catalog`);
  for(const id of auditOnly)assert(!areaIds.includes(id),`Audit-only ${id} is not a branch workspace`);
  const cov=await page.evaluate(()=>window.AxCoverage);
  assert.equal(cov.totals.families,areaIds.length);
  const destinations=new Set(['local-preview','owner-request-draft','navigate']);
  for(const [id,fam] of Object.entries(cov.families)){
    assert(fam.reachable,`${id} reachable`);assert(fam.operations.length>0,`${id} has operations`);
    for(const op of fam.operations){assert(destinations.has(op.destination),`${id}/${op.id} destination`);assert.notEqual(op.status,'broken-target',`${id}/${op.id} target resolves`);assert(op.intent&&op.production==='not-linked',`${id}/${op.id} explains intent and stays a local preview`);}
    for(const f of fam.facets)assert(f.intent&&['filter','count-only','label-only','screen','face'].includes(f.status),`${id}/${f.id} facet intent`);
  }
  const coveredOps=new Set(Object.values(cov.families).flatMap(f=>f.operations.flatMap(o=>o.sourceOperationIds||[])));
  const auditedOps=owner.flatMap(f=>(f.operations?.key||[]).map((_,i)=>`${f.id}:${i}`));
  if(routes.fixtureCatalog)for(const op of auditedOps)assert(coveredOps.has(op),`Audited operation group ${op} has a UI destination`);
  const byView=Object.values(cov.families).reduce((o,f)=>(o[f.viewKind]=(o[f.viewKind]||0)+1,o),{});
  assert(['flow','sheet','records','report','settings','timeline'].every(k=>byView[k]>0),'All six view kinds are used');

  // 2. Every owner workspace opens: heading, data state, operations panel, no overflow, no disabled catalog results.
  for(const id of areaIds){
    await go(`workspace-${id}`);
    assert.equal(await page.locator('main h1').innerText(),areaOf(id).label,`${id} heading`);
    assert.equal(await page.locator('.ws-side .ws-action').count(),cov.families[id].operations.length,`${id} lists every operation`);
    assert.equal(await page.locator('.ws-side .ws-action:disabled').count(),0);
    // 데이터 상태 칩은 없앴다(fd6a45f15 — 원장 10-28 개발자용 문구 정리). 기록 구역 = 목록 · 시트 · 칸반 · 설정 면 · 기록이 없을 때의 안내 중 하나.
    assert(await page.locator('#ws-main :is(.ws-table,.ws-sheet,.ws-flow,.ws-settings,.live-empty)').count()>0,`${id} shows its records or why there are none`);
    assert(!await overflow(),`${id} overflows at 1440`);
    assert.equal(await page.locator('main [title]').count(),0,`${id} has no native tooltips`);
  }

  // 3. Discovery from the left: grouped (collapsed) areas, finder with keyboard/IME, launcher and global search.
  await go('home');
  const groups=await page.locator('#sidebar .ws-groups details').count();assert(groups>=5,'Areas are grouped');
  assert.equal(await page.locator('#sidebar .ws-groups details[open]').count(),0,'Groups start collapsed (no menu wall)');
  const findTarget=cat.areas.find(a=>a.id==='makeups')||cat.areas[0];
  await page.locator('#ws-find').fill(findTarget.label.slice(0,2));
  assert(await page.locator(`#ws-find-list li[data-id="${findTarget.id}"]`).count()===1);
  await page.locator('#ws-find').press('ArrowDown');assert.match(await page.locator('#ws-find').getAttribute('aria-activedescendant'),/ws-find-\d/);
  await page.locator('#ws-find').evaluate(n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(await page.evaluate(()=>document.body.dataset.page),'home','Enter while composing Korean does not navigate');
  const payroll=areaOf('payroll')||cat.areas[1];
  await page.locator('#ws-find').fill(payroll.label);await page.locator('#ws-find').press('Enter');
  await page.waitForFunction(id=>document.body.dataset.page===`workspace-${id}`,payroll.id);
  assert.equal(await page.locator('#sidebar details[open] a[aria-current="page"]').count(),1,'The current group opens');
  await page.locator('#ws-find').fill('없는업무zz');await expectText('#ws-find-list',/맞는 업무가 없습니다/);
  await page.locator('#ws-find').press('Escape');assert.equal(await page.locator('#ws-find').inputValue(),'');
  await page.locator('#sidebar [data-ax="launcher"]').click();
  assert.equal(await page.locator('#modal .ax-launcher .button').count(),areaIds.length,'Launcher lists every workspace');
  assert.equal(await page.locator('#modal .ax-launcher .button:disabled').count(),0,'No disabled placeholder results');
  await close();await page.keyboard.press('Control+k');await page.getByLabel('통합 검색',{exact:true}).fill(areaOf('meetings')?.label||cat.areas[2].label);
  assert(await page.locator(`#search-results [data-go="workspace-${areaOf('meetings')?'meetings':cat.areas[2].id}"]`).count()===1,'Global search finds workspaces');await close();

  // 4a. Local preview with validation → session log → request with family/record context → recipient report → owner
  //     notification → back to the source workspace.
  const pv=cat.areas.flatMap(a=>(a.actions||[]).filter(x=>x.mode==='preview'&&usable(a,x)&&(x.fields||[]).some(f=>f.required)).map(x=>({a,x})));
  const {a:pa,x:px}=pv.find(({a})=>a.id==='makeups')||pv[0];
  await go(`workspace-${pa.id}`);
  await sideAction(pa.id,px.id).click();
  const pform=page.locator('#modal form[data-ws-form="preview"]');
  await pform.locator('button[type=submit]').click();await expectText('#modal .ax-form-error',/입력해 주세요/,'Required fields are checked');
  await fill(pform,px.fields);await pform.locator('button[type=submit]').click();
  await expectText('#toast',/저장되지는 않았습니다/);
  assert.equal(await page.locator('#ws-local article').count(),1);await expectText('#ws-local',new RegExp(esc(px.label)));
  await shot('preview-local');
  await page.locator('#ws-local [data-ws="local-request"]').click();
  await expectValue('#modal [name=title]',new RegExp(esc(px.label)));await expectValue('#modal [name=body]',new RegExp(esc(px.fields.find(f=>f.required).label)));
  await expectText('#modal .ax-linked-issues',new RegExp(`출처[\\s\\S]*${esc(pa.label)}`));
  await pickOwner(staff[0].id);await page.locator('#modal [data-ax-form="request"] button[type=submit]').click();
  await expectText('#detail .ax-request-source',/출처/);
  await page.locator('#detail .ax-request-source [data-ax="navigate"]').click();await page.waitForFunction(id=>document.body.dataset.page===`workspace-${id}`,pa.id);
  assert.equal(await page.locator('.ws-requests .ax-request-row').count(),1,'Requests sent from this workspace are listed here');
  await go('workspace-teacher-workspace');
  await page.locator('#ws-recipient').selectOption(staff[0].id);
  await page.locator('.ws-inbox-item [data-ws="recipient-ack"]').click();await expectText('.ws-inbox-item',/진행 중/);
  await page.locator('.ws-inbox-item form button[type=submit]').click();await expectText('.ws-inbox-item .ax-form-error',/입력해 주세요/);
  await page.locator('.ws-inbox-item textarea').fill('처리 완료했습니다.');await page.locator('.ws-inbox-item form button[type=submit]').click();
  await expectText('#toast',/원장 알림/);await expectText('.ws-recipient',/자동 할 일/);
  await shot('teacher-recipient');
  await go('inbox');await expectText('main .ax-notifications',/처리 완료했습니다/);
  await page.locator(`main .ax-notifications [data-ax="navigate"][data-id="workspace-${pa.id}"]`).click();await page.waitForFunction(id=>document.body.dataset.page===`workspace-${id}`,pa.id);

  // 4b. A request action with catalog fields collects them first, then hands the values to the request form.
  const rq=cat.areas.flatMap(a=>(a.actions||[]).filter(x=>x.mode==='request'&&usable(a,x)&&(x.fields||[]).some(f=>f.required)).map(x=>({a,x})))[0];
  await go(`workspace-${rq.a.id}`);await sideAction(rq.a.id,rq.x.id).click();
  const rform=page.locator('#modal form[data-ws-form="request"]');
  await rform.locator('button[type=submit]').click();await expectText('#modal .ax-form-error',/입력해 주세요/);
  await fill(rform,rq.x.fields);await rform.locator('button[type=submit]').click();
  await expectValue('#modal [name=body]',new RegExp(`· ${esc(rq.x.fields.find(f=>f.required).label)}: `),'Collected values continue into the request body');await close();

  // 4c. Numeric bounds come from the catalog.
  const nb=cat.areas.flatMap(a=>(a.actions||[]).filter(x=>x.mode==='preview'&&usable(a,x)&&(x.fields||[]).some(f=>['number','money'].includes(f.type)&&Number.isFinite(Number(f.max)))).map(x=>({a,x})))[0];
  if(nb){
    const nf=nb.x.fields.find(f=>['number','money'].includes(f.type)&&Number.isFinite(Number(f.max)));
    await go(`workspace-${nb.a.id}`);await sideAction(nb.a.id,nb.x.id).click();const nform=page.locator('#modal form[data-ws-form="preview"]');
    await fill(nform,nb.x.fields,{number:f=>f.id===nf.id?Number(nf.max)+1:undefined});await nform.locator('button[type=submit]').click();
    await expectText('#modal .ax-form-error',new RegExp(`${esc(String(nf.min??0))}~${esc(String(nf.max))} 사이`),'Out-of-range number is rejected with the catalog bounds');
    await nform.locator(`[name="${nf.id}"]`).fill(String(nf.max));await nform.locator('button[type=submit]').click();await expectText('#toast',/저장되지는 않았습니다/);
  }

  // 4d. Navigation actions land on their target page (and the target 2.0 screen when there is one).
  const nv=cat.areas.flatMap(a=>(a.actions||[]).filter(x=>x.mode==='navigate'&&x.target?.page&&x.target.page!==`workspace-${a.id}`).map(x=>({a,x})))[0];
  if(nv){await go(`workspace-${nv.a.id}`);await sideAction(nv.a.id,nv.x.id).click();await page.waitForFunction(p=>document.body.dataset.page===p||document.body.dataset.page===`workspace-${p}`,nv.x.target.page);}

  // 4e. 2.0 screens: a screen chip gathers that screen's actions at the top of the panel.
  const sa=cat.areas.find(a=>a.viewKind!=='settings'&&(a.facets||[]).some(f=>(a.actions||[]).some(x=>x.target?.facet===f.id)));
  if(sa){
    await go(`workspace-${sa.id}`);const chip=page.locator('.ws-screens button').first();const label=await chip.innerText();
    await chip.click();assert.equal(await chip.getAttribute('aria-pressed'),'true');await expectText('.ws-side .ws-action-group.focus h3',new RegExp(esc(label)));
  }

  // 4f. Settings faces with their own forms; records read from the copy are listed below.
  const st=cat.areas.find(a=>a.viewKind==='settings'&&(a.actions||[]).some(x=>x.mode==='preview'&&x.target?.facet&&usable(a,x)));
  if(st){
    const sx=st.actions.find(x=>x.mode==='preview'&&x.target?.facet&&usable(st,x));
    await go(`workspace-${st.id}`);await page.locator(`.ws-faces [data-face="${sx.target.facet}"]`).click();
    const sform=page.locator(`.ws-face form[data-action="${sx.id}"]`);
    if(await sform.count()){await fill(sform,sx.fields);await sform.locator('button[type=submit]').click();await expectText('#toast',/저장되지는 않았습니다/);}
    await shot('settings-faces');
  }
  const sf=cat.areas.find(a=>a.viewKind==='settings'&&(a.facets||[]).length>1);
  if(sf){await go(`workspace-${sf.id}`);const face=page.locator('.ws-faces [data-ws="face"]').nth(1);await face.click();assert.equal(await page.locator('.ws-faces [data-ws="face"]').nth(1).getAttribute('aria-pressed'),'true','A setting face can be chosen');await expectText('.ws-face h3',new RegExp(esc(sf.facets[1].label)));}

  // 4g. Class sheet: keyboard cell edit, cancel with Escape, save changes as a preview.
  await go('workspace-class-sheets');
  if(await page.locator('.ws-cell').count()>1){
    const cell=page.locator('.ws-cell').first();await cell.focus();await page.keyboard.press('Enter');
    await page.locator('.ws-cell-input').fill('테스트 값');await page.keyboard.press('Enter');
    assert.equal(await page.locator('.ws-cell.changed').count(),1);await expectText('.ws-sheet-bar',/바뀐 칸 1개/);
    await page.locator('.ws-cell').nth(1).focus();await page.keyboard.press('Enter');await page.locator('.ws-cell-input').fill('취소될 값');await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ws-cell.changed').count(),1,'Escape cancels a cell edit');
    await shot('class-sheet');
    await page.locator('[data-ws="sheet-save"]').click();await expectText('#ws-local',/테스트 값/);
    assert.equal(await page.locator('.ws-cell.changed').count(),0);
  }

  // 4h. Full records come from the records endpoint: paging, record filters (data facets only) and search.
  const paged=[];for(const id of areaIds){await go(`workspace-${id}`);if(await page.locator('#ws-main [data-ws="page"]').count()){paged.push(id);break;}}
  if(paged.length){
    const id=paged[0],n=recordCalls.length;
    // 쪽 번호(공통 리스트 · 업무 흐름 표와 같은 모양) — 마지막 단추 '다음 ›'을 누르면 지금 쪽 표시가 2로.
    await page.locator('#ws-main [data-ws="page"]').last().click();await page.waitForFunction(()=>document.querySelector('#ws-main .ws-pager [aria-current="page"]')?.textContent.trim()==='2');
    const facet=page.locator('#ws-main [data-ws="facet"][data-facet]:not([data-facet=""])').first();
    if(await facet.count()){const fid=await facet.getAttribute('data-facet');await facet.click();for(let i=0;i<40&&!recordCalls.slice(n).some(u=>u.includes(`facet=${encodeURIComponent(fid)}`));i++)await page.waitForTimeout(100);
      assert(recordCalls.slice(n).some(u=>u.includes(`facet=${encodeURIComponent(fid)}`)&&/page=1\b/.test(u)),'A record filter is a data facet and resets to page 1');}
    assert(recordCalls.slice(n).every(u=>u.includes(`/api/workspaces/${id}/records`)),'Records come from the endpoint');
    await shot('records-paging');
  }

  // 4i. Workspace charts use the app popover; the workspace question keeps contextIssueId null.
  await go('workspace-billing');
  if(await page.locator('.ws-trend [data-point]').count()){const col=await page.locator('.ws-trend [data-point]').nth(0).boundingBox();await page.mouse.move(col.x+col.width/2,col.y+col.height/2);await expectText('#chart-tip .chart-pop-value',/^[\d,]+원$/,'Exact won value in the workspace trend');}
  await page.locator('main [data-ws="ask"]').click();await expectText('[data-chat-context]',/대화 주제/);
  await page.locator('#ax-chat-command').press('Enter');await page.locator('.ax-chat-text').waitFor();
  assert.equal(assistant.at(-1).contextIssueId,null,'New family questions keep contextIssueId null');assert.deepEqual(assistantRequestProblems(assistant.at(-1)),[]);await close();

  // 4j. Home: workspace signals below the critical first viewport, connected to a contextual request.
  await go('home');
  if(await page.locator('.ws-home-signals [data-ws="signal-request"]').count()){
    const top=await page.locator('.ws-home-signals').evaluate(n=>n.getBoundingClientRect().top);assert(top>=await page.evaluate(()=>innerHeight)-1,'Signals stay below the first viewport');
    await page.locator('.ws-home-signals [data-ws="signal-request"]').first().click();await expectText('#modal .ax-linked-issues',/출처/);await close();
  }

  // 4k. Automatic tasks are not completed by a button; personal tasks keep their own completion toggle.
  await page.locator('#ax-issue-tasks [data-ax="record"]').first().click();
  assert.equal(await page.locator('#detail [data-action="complete-task"]').count(),0,'Automatic tasks have no generic complete button');
  await expectText('#detail',/자동으로 닫습니다/);
  assert.equal(await page.locator('#detail [data-go]').count(),1,'Automatic tasks open their source record');
  await page.locator('#detail [data-action="task-followup"]').click();await expectText('#modal .ax-linked-issues',/출처/);await close();
  await go('approvals');await page.locator('[data-action="new-task"]').click();await page.getByLabel('해야 할 일').fill('원장 개인 확인');await page.locator('#preview-form button[type="submit"]').click();
  await page.locator('#detail [data-action="complete-task"]').click();await expectText('#detail',/완료/);await close();

  // 5. Phone: workspace without overflow, horizontal stage scroller with edge fades kept across a refresh, finder in the menu.
  await page.setViewportSize({width:390,height:844});
  const flowArea=cat.areas.find(a=>a.id==='approvals')||cat.areas.find(a=>a.viewKind==='flow');await go(`workspace-${flowArea.id}`);
  assert(!await overflow(),'Workspace fits the phone');
  const flow=page.locator('.ws-flow');
  if(await flow.count()&&await flow.evaluate(n=>n.scrollWidth>n.clientWidth+1)){
    assert(Number.parseFloat(await flow.evaluate(n=>n.style.getPropertyValue('--fade-right')))>0,'More stages to the right are faded');
    await flow.evaluate(n=>{n.scrollLeft=n.scrollWidth;n.dispatchEvent(new Event('scroll'));});
    assert.equal(await flow.evaluate(n=>n.style.getPropertyValue('--fade-right')),'0px');assert(Number.parseFloat(await flow.evaluate(n=>n.style.getPropertyValue('--fade-left')))>0);
  }
  await shot('flow-390');
  const inv=areaOf('inventory')||cat.areas.at(-1);
  await page.locator('[data-action=menu]').click();await page.locator('#ws-find').fill(inv.label);await page.locator('#ws-find').press('Enter');
  await page.waitForFunction(id=>document.body.dataset.page===`workspace-${id}`&&!document.body.classList.contains('menu-open'),inv.id);
  assert(!await overflow());await shot('inventory-390');

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(mutations,[]);
  console.log(`PASS: ${areaIds.length} owner workspaces reachable (${Object.entries(byView).map(([k,v])=>`${k} ${v}`).join(', ')}), ${cov.totals.operations} operations mapped (${Object.entries(cov.totals.byDestination).map(([k,v])=>`${k} ${v}`).join(', ')}), no native tooltips, ${routes.fixtureCatalog?`${auditedOps.length} audited operation groups covered, `:''}left finder/launcher/global search, ${pa.id} preview→request→teacher report→owner notification→source, request fields → request body (${rq.a.id}), ${nb?`numeric bounds (${nb.a.id}), `:''}${nv?'navigation, ':''}${sa?`2.0 screens (${sa.id}), `:''}${st?`setting faces (${st.id}), `:sf?`setting face switch (${sf.id}), `:''}class sheet edit, ${paged.length?`records endpoint paging/filter (${paged[0]}), `:''}null-context question, auto-task semantics, phone. Catalog=${routes.catalogSource}, data=${routes.fixtureData?'test projection of the real copy':'served'}.`);
}finally{await browser.close();}
