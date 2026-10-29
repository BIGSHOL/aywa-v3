import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { loadInventory, buildFixtureCatalog, installWorkspaceRoutes } from './verify-workspaces-fixtures.mjs';
import { installFlowRoutes } from './verify-flow-ui-mock.mjs';

// Role handoff journey on the durable flow: local scenario → recipients switch → acknowledge/report → manager review
// return/reassign → owner flow, reload persistence, duplicate submissions, conflicts, passive arrival of new work.
// Uses the server's /api/flow when it exists (cases are found by the caseId the server returns, so a store that already
// holds earlier runs works too); otherwise the test-only stand-in in verify-flow-ui-mock.mjs (named in the PASS line).
// The UI under test is always this worktree's files (served from disk), so another worker's server can provide the
// backend. Against a shared server every command id carries the run prefix ux-<runId>-NNNN, as agreed with its owner.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const dir=new URL('./',import.meta.url),shots='work/owner-concept/flow-qa';
const snapshotText=await (await fetch(base+'/snapshot.js')).text();
const sandbox={dispatchEvent(){}};new Function('window',snapshotText)(sandbox);const db=sandbox.AcademySnapshot;
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();page.setDefaultTimeout(10000);
const errors=[],external=[],mutations=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const url=new URL(r.url());if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());if(!['GET','HEAD'].includes(r.method())&&!['/api/assistant','/api/flow/actions'].includes(url.pathname))mutations.push(`${r.method()} ${url.pathname}`);});
await page.route('**/api/assistant',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answer:'모의 응답입니다.',issueIds:[],suggestedTask:null,provider:'claude-cli'})}));
const wsRoutes=await installWorkspaceRoutes(page,{base,dir,catalog:buildFixtureCatalog(await loadInventory())});
const flowRoutes=await installFlowRoutes(page,{base,db});
const UI_FILES={'/':['live.html','text/html; charset=utf-8'],'/live.html':['live.html','text/html; charset=utf-8'],'/ax.js':['ax.js','text/javascript; charset=utf-8'],'/ax.css':['ax.css','text/css; charset=utf-8'],'/live.js':['live.js','text/javascript; charset=utf-8'],'/workspace-catalog.js':['workspace-catalog.js','text/javascript; charset=utf-8'],'/workspaces.js':['workspaces.js','text/javascript; charset=utf-8'],'/workspaces.css':['workspaces.css','text/css; charset=utf-8'],'/flow-ui.js':['flow-ui.js','text/javascript; charset=utf-8'],'/flow-ui.css':['flow-ui.css','text/css; charset=utf-8']};
await page.route(url=>url.origin===new URL(base).origin&&Boolean(UI_FILES[url.pathname]),async route=>{const [file,type]=UI_FILES[new URL(route.request().url()).pathname];await route.fulfill({status:200,contentType:type,body:await readFile(new URL(file,dir))});});
const runId=`ux-${Date.now().toString(36)}`;let seq=0;const ids=new Map();
const testId=()=>`${runId}-${String(++seq).padStart(4,'0')}`;
if(flowRoutes.served)await page.route(`${base}/api/flow/actions`,route=>{const b=route.request().postDataJSON();if(!ids.has(b.commandId))ids.set(b.commandId,testId());route.continue({postData:JSON.stringify({...b,commandId:ids.get(b.commandId)})});});
const commands=[],results=[];
page.on('request',r=>{if(r.url().endsWith('/api/flow/actions'))commands.push(r.postDataJSON());});
page.on('response',async r=>{if(r.url().endsWith('/api/flow/actions'))results.push({status:r.status(),body:await r.json().catch(()=>null)});});

const flow=()=>page.evaluate(async()=>{const get=p=>fetch(`/api/flow${p>1?`?casePage=${p}`:''}`).then(r=>r.json());const first=await get(1),rest=[];for(let p=2;p<=(first.casePageCount||1);p++)rest.push(await get(p));return {...first,cases:[first,...rest].flatMap(x=>x.cases)};});
const caseOf=async id=>(await flow()).cases.find(c=>c.id===id);
const active=c=>c.state==='done'?[]:c.steps.filter(s=>!s.skipped&&(s.status==='ready'||s.status==='working'));
const queued=s=>s.queue==='manager'&&!s.assigneeIds.length;
const shot=(name,fullPage=false)=>page.screenshot({path:`${shots}/${name}.png`,fullPage,animations:'disabled'});
const close=()=>page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
const settle=()=>page.waitForFunction(()=>!document.querySelector('[data-fl-key][aria-busy="true"]'));
const expectText=async(sel,re)=>{await page.waitForFunction(([s,src])=>new RegExp(src).test(document.querySelector(s)?.innerText||''),[sel,re.source],{timeout:6000}).catch(()=>{});assert.match(await page.locator(sel).first().innerText(),re);};
// Runs a UI action and returns the server's answer to the one command it sent.
async function sent(action){const n=results.length;await action();await page.waitForFunction(()=>true);await settle();for(let i=0;i<50&&results.length===n;i++)await page.waitForTimeout(100);return results[n];}
async function asActor(id){
  await close();if(await page.evaluate(()=>document.body.dataset.page)!=='home')await page.evaluate(()=>{location.hash='home';});
  await page.waitForFunction(()=>document.body.dataset.page==='home');
  if(await page.locator('#sidebar').evaluate(n=>n.inert))await page.locator('[data-action=menu]').click();
  await page.locator('#fl-actor').selectOption(id);await page.waitForFunction(id=>document.querySelector('#fl-actor')?.value===id,id);
}
// The owner list shows 20 at a time; open the rest when a case is further down.
async function expandAll(){const more=page.locator('[data-fl="more"]');if(await more.count())await more.first().click();}
// Show the card for a case in the current role view (manager/owner lists are filtered views).
async function showCard(id){
  const card=page.locator(`.fl-case[data-case="${id}"]`);if(await card.count())return card.first();
  await expandAll();if(await card.count())return card.first();
  for(const f of ['mine','review','queue','decide','blocked','moving','local','all','late','done']){const b=page.locator(`[data-fl="filter"][data-id="${f}"]`);if(!await b.count())continue;await b.first().click();if(await card.count())return card.first();await expandAll();if(await card.count())return card.first();}
  throw new Error(`Case ${id} is not visible for ${await page.locator('#fl-actor').inputValue()}`);
}
const submit=kind=>page.locator(`#modal form[data-fl-form="${kind}"] button[type=submit]`).click();
async function report(id,note){await (await showCard(id)).locator('[data-fl="report-open"]').first().click();await page.locator('#modal textarea[name="note"]').fill(note);return sent(()=>submit('report'));}
async function review(id,decision,note=''){await (await showCard(id)).locator('[data-fl="review-open"]').click();await page.locator(`#modal input[name="decision"][value="${decision}"]`).check();if(note)await page.locator('#modal textarea[name="note"]').fill(note);return sent(()=>submit('review'));}
// A person the server can assign: teachers, then managers (observer accounts in the staff role cannot be assigned).
const assignee=f=>f.actors.find(a=>!a.preview&&a.assignable!==false&&a.role==='teacher')||f.actors.find(a=>!a.preview&&a.assignable!==false&&a.role==='manager');
// Drive a case with whoever the server assigns: unresolved steps get a person from a manager, reviews are accepted.
async function drive(id,{manager,maxSteps=14}){
  for(let i=0;i<maxSteps;i++){
    const f=await flow(),c=f.cases.find(x=>x.id===id);if(c.state==='done'||c.closure==='fact')return c;
    const s=active(c)[0];assert(s,`Case ${id} has an open step`);
    if(queued(s)&&!s.review){await asActor(manager);await (await showCard(id)).locator('[data-fl="reassign-open"]').click();if(await page.locator('#modal select[name="step"]').count())await page.locator('#modal select[name="step"]').selectOption(s.id);
      await page.locator(`#modal input[name="assignee"][value="${assignee(f).id}"]`).check();assert.equal((await sent(()=>submit('reassign'))).status,200);continue;}
    if(s.review){await asActor(s.assigneeIds[0]||manager);assert.equal((await review(id,'accept')).status,200);continue;}
    await asActor(s.assigneeIds[0]);
    if(s.status==='ready'){const card=await showCard(id);const r=await sent(()=>card.locator('[data-fl="ack"]').first().click());assert.equal(r.status,200);}
    else assert.equal((await report(id,`${s.label} 완료 — 확인 내용을 남깁니다.`)).status,200);
  }
  return caseOf(id);
}

try{
  await mkdir(shots,{recursive:true});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>Boolean(document.querySelector('#fl-actor')));
  const start=await flow();
  const owner=start.actors.find(a=>a.role==='owner'&&a.preview)||start.actors.find(a=>a.role==='owner'),manager=start.actors.find(a=>a.role==='manager'&&!a.preview);
  assert(owner&&manager,'Flow has an owner preview actor and a manager');
  assert(start.actors.every(a=>!/super|admin|platform|master|슈퍼|총괄/i.test(`${a.roleLabel} ${a.name}`)),'No internal platform role names');

  // 1. Owner first screen: decisions, blocked handoffs and stage counts; connected detail below the fold.
  await asActor(owner.id);
  assert.equal(await page.locator('.ax-signals .fl-count').count(),3);
  assert.equal(await page.locator('#topbar').evaluate(n=>getComputedStyle(n).display),'none','No desktop header band');
  const fold=await page.evaluate(()=>innerHeight);
  assert((await page.locator('#fl-detail').evaluate(n=>n.getBoundingClientRect().top))>=fold-1,'Connected flow detail starts below the first screen');
  assert.match(await page.locator('main .page-heading p').first().innerText(),new RegExp(`${Number(String(start.asOf).slice(5,7))}/${Number(String(start.asOf).slice(8,10))} 기준`),'Source date stays visible (once, in the page heading)');
  assert.doesNotMatch(await page.locator('#fl-detail').innerText(),/Jev|Claude|변경 \d+회/,'No model names or revision counts on screen');
  await shot('owner-first-screen');

  // 2. Absence scenario from a real copied record (local, not counted as history); a repeat answers with the same case.
  const scn=()=>page.locator('form[data-fl-form="simulate"][data-scenario="absence"]');
  const realBefore=(await flow()).cases.filter(c=>c.origin!=='dev').length;
  const first=await sent(()=>scn().locator('button[type=submit]').click());assert.equal(first.status,200);
  assert(!first.body.duplicate,'The store has no open absence scenario for this record yet (finish or clear earlier runs)');
  const absenceId=first.body.caseId;let c=await caseOf(absenceId);
  assert(c&&c.origin==='dev'&&c.entityRefs.some(r=>r.type==='student'),'Scenario is tied to a real student record');
  const again=await sent(()=>scn().locator('button[type=submit]').click());
  assert.equal(again.body.caseId,absenceId,'Repeating the same local event answers with the existing case');assert.equal(again.body.duplicate,true);
  await expectText('#toast',/새 일은 만들지 않았습니다/);await close();
  const f2=await flow();assert.equal(f2.cases.filter(x=>x.scenarioKey&&x.scenarioKey===c.scenarioKey&&x.state!=='done').length,1,'No duplicate task');
  await page.locator('[data-fl="filter"][data-id="local"]').first().click();
  await expectText(`.fl-case[data-case="${absenceId}"]`,/연습 시나리오/);
  assert.match(await page.locator('.fl-stages .ax-note').innerText(),new RegExp(`학원 기록에서 생긴 일 ${realBefore}건`),'Local scenarios are counted separately from copied history');

  // 3. The first person sees trigger, why and related records, opens a workspace, acknowledges (one command) and reports.
  const firstStep=active(c)[0];assert(firstStep&&!firstStep.review,'The first step is open');
  const firstPerson=firstStep.assigneeIds[0]||manager.id;
  await asActor(firstPerson);
  const card=await showCard(absenceId);
  assert.match(await card.innerText(),/결석/);assert(await card.locator('.fl-entity:not([disabled])').count()>0,'Related records are linked');
  assert(!/teacher_id|_id\b|staff_task|users\./.test(await card.innerText()),'No source identifiers on the card');
  await shot('staff-inbox');
  await card.locator('.fl-entity:not([disabled])').first().click();await page.waitForFunction(()=>/^workspace-/.test(document.body.dataset.page||''));
  assert(await page.locator('main h1').innerText(),'Related record opens its workspace');
  await asActor(firstPerson);
  const acks=commands.filter(x=>x.kind==='case.ack').length;
  const ack=await sent(()=>page.locator(`.fl-case[data-case="${absenceId}"] [data-fl="ack"]`).first().evaluate(b=>{b.click();b.click();}));
  assert.equal(ack.status,200);assert.equal(commands.filter(x=>x.kind==='case.ack').length,acks+1,'A double click sends one command');
  await (await showCard(absenceId)).locator('[data-fl="report-open"]').click();
  await submit('report');await expectText('#modal .ax-form-error',/두 글자 이상/);
  await page.locator('#modal select[name="outcome"]').selectOption('needs_review');
  await page.locator('#modal textarea[name="note"]').fill('보호자와 통화했습니다. 다음 주 화요일 보강 희망.');assert.equal((await sent(()=>submit('report'))).status,200);
  c=await caseOf(absenceId);assert(!active(c).some(s=>s.id===firstStep.id),'The report hands the work on');

  // 4. Manager returns with a required note, the first person reports again, the manager accepts.
  const reviewStep=active(c).find(s=>s.review);
  if(reviewStep){
    assert(queued(reviewStep)||reviewStep.assigneeIds.length,'Review sits in the manager queue');
    await asActor(manager.id);
    await (await showCard(absenceId)).locator('[data-fl="review-open"]').click();
    await page.locator('#modal input[name="decision"][value="return"]').check();await submit('review');
    await expectText('#modal .ax-form-error',/보완할 내용/);
    await page.locator('#modal textarea[name="note"]').fill('보강 가능한 날짜를 두 개 받아 주세요.');assert.equal((await sent(()=>submit('review'))).status,200);
    c=await caseOf(absenceId);assert(active(c).some(s=>s.id===firstStep.id),'Returned work goes back to the first person');
    await asActor(firstPerson);await expectText(`.fl-case[data-case="${absenceId}"]`,/보완|할 차례|진행/);
    assert.equal((await report(absenceId,'보강 가능 날짜: 화 16:00, 목 17:00')).status,200);
    await asActor(manager.id);assert.equal((await review(absenceId,'accept')).status,200);
  }
  await shot('manager-review');

  // 5. Reload keeps the overlay and the previewed person; the rest of the chain finishes with whoever is assigned.
  const previewed=await page.locator('#fl-actor').inputValue(),beforeReload=await caseOf(absenceId);
  await page.reload();await page.waitForFunction(()=>Boolean(document.querySelector('#fl-actor')));
  assert.equal(await page.locator('#fl-actor').inputValue(),previewed,'Preview selection survives reload');
  const afterReload=await caseOf(absenceId);
  assert.deepEqual([afterReload.state,active(afterReload).map(s=>s.id).join(),afterReload.evidence.length],[beforeReload.state,active(beforeReload).map(s=>s.id).join(),beforeReload.evidence.length],'The overlay survives reload');
  c=await drive(absenceId,{manager:manager.id});
  assert.equal(c.state,'done','The absence chain reaches its final report');
  assert(c.evidence.length>=3,'Each handoff left evidence');

  // 6. Owner sees the updated flow and the chain with its evidence; judgment state is only what the server returned.
  await asActor(owner.id);await page.locator('[data-fl="filter"][data-id="done"]').first().click();
  await (await showCard(absenceId)).locator('[data-fl="open"]').first().click();
  await expectText('#detail .fl-chain',/연락/);await expectText('#detail .ax-request-timeline',/보고/);
  const detail=await page.locator('#detail').innerText();
  assert.match(detail,/판정/);assert(!/decision_module_unavailable|human_review|classes\.teacher_id|_id\b/.test(detail),'No raw codes or source identifiers in the case detail');
  if(c.decision?.status==='unavailable')assert.match(detail,/판정 사용 불가/,'Unavailable judgment is shown as unavailable');
  await shot('owner-case-chain');await close();
  await page.evaluate(()=>{location.hash='inbox';});await page.waitForFunction(()=>document.body.dataset.page==='inbox');
  assert(await page.locator('.fl-notices article').count()>0,'Owner notifications come from the flow store');

  // 7. Billing check scenario runs from a real invoice to the owner/manager decision.
  await asActor(owner.id);
  const bill=await sent(()=>page.locator('form[data-fl-form="simulate"][data-scenario="billing"] button[type=submit]').click());assert.equal(bill.status,200);
  c=await drive(bill.body.caseId,{manager:manager.id});assert.equal(c.state,'done');assert(c.entityRefs.some(r=>r.type==='invoice'),'Billing scenario is tied to a real invoice');

  // 8. Owner multi-assignee request through the existing searchable picker; each recipient sees it; it closes after review.
  await asActor(owner.id);
  const fNow=await flow(),people=fNow.actors.filter(a=>!a.preview&&a.assignable!==false&&a.role==='teacher').slice(0,2);assert.equal(people.length,2);
  await page.locator('main [data-ax="request"]').first().click();
  await page.locator('#modal [name=title]').fill('주간 보강표 정리');await page.locator('#modal [name=body]').fill('이번 주 보강 일정을 반별로 정리해 주세요.');
  for(const p of people){await page.locator('#ax-owner-trigger').click();await page.locator('#ax-owner-search').fill(p.name);await page.locator(`#ax-owner-list [data-owner="${p.id}"]`).click();await page.keyboard.press('Escape');}
  const creates=commands.filter(x=>x.kind==='request.create').length;
  const created=await sent(()=>page.locator('#modal [data-ax-form="request"] button[type=submit]').evaluate(b=>{b.click();b.click();}));
  assert.equal(created.status,200);assert.equal(commands.filter(x=>x.kind==='request.create').length,creates+1,'Double submit creates one request');
  await expectText('#toast',/업무 흐름에 요청/);
  const requestId=created.body.caseId,request=await caseOf(requestId);
  assert.equal(request.title,'주간 보강표 정리');assert.equal(active(request).length,2,'Each recipient gets their own open step');
  for(const p of people){await asActor(p.id);assert.equal(await page.locator(`.fl-case[data-case="${requestId}"]`).count(),1,`${p.name} sees the request`);}
  c=await drive(requestId,{manager:manager.id});assert.equal(c.state,'done');
  await page.reload();await page.waitForFunction(()=>Boolean(document.querySelector('#fl-actor')));await asActor(owner.id);
  await page.evaluate(()=>{location.hash='requests';});await page.waitForFunction(()=>document.body.dataset.page==='requests');
  await expectText('main .ax-workflow',/주간 보강표 정리/);await expectText('main',/새로고침해도 유지/);

  // 9. Automatic source cases are not closable here; a report becomes a linked local follow-up and the source stays open.
  const source=(await flow()).cases.find(x=>x.closure==='fact'&&x.state!=='done'&&active(x).some(s=>s.assigneeIds.length));
  if(source){
    const s=active(source).find(x=>x.assigneeIds.length);await asActor(s.assigneeIds[0]);
    await (await showCard(source.id)).locator('[data-fl="report-open"]').click();await expectText('#modal',/원본 업무는 원본 기록이 처리되어야 닫힙니다|이 업무는 원본 기록이 바뀌어야 닫힙니다/);
    await page.locator('#modal textarea[name="note"]').fill('보호자 연락 완료, 원본 기록 입력은 데스크가 진행');
    const r=await sent(()=>submit('report'));assert.equal(r.status,200);
    const after=await caseOf(source.id),follow=await caseOf(r.body.caseId);
    assert.notEqual(after.state,'done','A fact-closed source case stays open after a follow-up report');
    assert(follow&&follow.linkedCaseIds.includes(source.id)&&after.linkedCaseIds.includes(follow.id),'The follow-up is linked both ways');
    await (await showCard(source.id)).locator('[data-fl="open"]').first().click();await expectText('#detail',/이 화면에서 닫을 수 없습니다/);await expectText('#detail',/연결된 업무/);await close();
  }

  // 10. Conflicts and wrong-person commands are rejected, with nothing applied.
  const f10=await flow(),target=f10.cases.find(x=>x.state!=='done'&&active(x).some(s=>s.status==='ready'&&!s.review&&s.assigneeIds.length)),ts=active(target).find(s=>s.status==='ready'&&!s.review&&s.assigneeIds.length);
  // Direct commands read the current revision right before posting (and carry the run prefix).
  const post=async body=>{const revision=(await flow()).revision;return page.evaluate(b=>fetch('/api/flow/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()})),{commandId:testId(),expectedRevision:revision,...body});};
  const stale=await post({expectedRevision:f10.revision-1,actorId:ts.assigneeIds[0],kind:'case.ack',caseId:target.id,payload:{stepId:ts.id}});
  assert.equal(stale.status,409);assert.equal(stale.body.error,'revision_conflict');
  const other=f10.actors.find(a=>!a.preview&&a.role==='teacher'&&!ts.assigneeIds.includes(a.id));
  const wrong=await post({actorId:other.id,kind:'case.ack',caseId:target.id,payload:{stepId:ts.id}});
  assert.equal(wrong.status,403,'Wrong person is rejected');assert.equal((await flow()).revision,f10.revision,'Rejected commands change nothing');
  if(flowRoutes.mock){
    // (a) The revision moved because of other work: the UI retries once on the fresh revision with the same command id.
    await asActor(ts.assigneeIds[0]);flowRoutes.mock.state.revision+=1;const n=commands.length;
    await page.locator(`.fl-case[data-case="${target.id}"] [data-fl="ack"]`).first().click();await settle();await expectText('#toast',/확인했습니다/);
    const sentNow=commands.slice(n);assert.equal(sentNow.length,2,'One retry after an unrelated change');assert.equal(sentNow[0].commandId,sentNow[1].commandId,'The retry keeps the command id');
    assert.equal((await caseOf(target.id)).steps.find(x=>x.id===ts.id).status,'working');
    // (b) This case moved underneath the person: no retry, the screen reloads and says so.
    const f10b=await flow(),t2=f10b.cases.find(x=>x.id!==target.id&&x.state!=='done'&&active(x).some(s=>s.status==='ready'&&!s.review&&s.assigneeIds.length)),s2=active(t2).find(s=>s.status==='ready'&&!s.review&&s.assigneeIds.length);
    await asActor(s2.assigneeIds[0]);const m=commands.length;
    const moved=flowRoutes.mock.handle({commandId:testId(),expectedRevision:flowRoutes.mock.state.revision,actorId:manager.id,kind:'case.reassign',caseId:t2.id,payload:{stepId:s2.id,assigneeIds:[f10b.actors.find(a=>a.role==='teacher'&&!s2.assigneeIds.includes(a.id)).id]}});assert.equal(moved.status,200);
    await page.locator(`.fl-case[data-case="${t2.id}"] [data-fl="ack"]`).first().click();await settle();await expectText('#toast',/다른 변경이 먼저/);
    assert.equal(commands.length-m,1,'No retry when the case itself changed');
  }

  // 10b. (stand-in) More than one case page: work on page 2 is counted and reachable; older history loads on request.
  if(flowRoutes.mock){
    const person=people[1],lastId=flowRoutes.mock.seedBulk(520,person.id);
    const raw=await page.evaluate(()=>fetch('/api/flow').then(r=>r.json()));assert(raw.casePageCount>=2&&!raw.cases.some(x=>x.id===lastId),'The new case is on a later page');
    await page.reload();await page.waitForFunction(()=>Boolean(document.querySelector('#fl-actor')));await asActor(person.id);
    const ready=flowRoutes.mock.state.cases.filter(x=>x.state!=='done'&&x.steps.some(s=>s.status==='ready'&&!s.review&&s.assigneeIds.includes(person.id))).length;
    await expectText('.ax-signals .fl-count .ax-signal-value',new RegExp(`^${ready.toLocaleString('ko-KR')}건$`));
    assert(await showCard(lastId),'Later-page work is reachable');
    // A case added while the pages are being read changes the page count: the read restarts and the new last page is not lost.
    let grown='';await page.route(url=>url.pathname==='/api/flow'&&url.searchParams.get('casePage')==='2',route=>{if(!grown)grown=flowRoutes.mock.seedBulk(500,person.id);return route.fallback();});
    flowRoutes.mock.seedBulk(1,person.id);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expectText('.ax-signals .fl-count .ax-signal-value',new RegExp(`^${(ready+501).toLocaleString('ko-KR')}건$`),'Work on the page that appeared mid-read is counted');
    assert(grown&&await showCard(grown),'The last page that appeared mid-read is reachable');
    await asActor(owner.id);await page.locator('[data-fl="filter"][data-id="done"]').first().click();
    await (await showCard(absenceId)).locator('[data-fl="open"]').first().click();
    await expectText('#detail .ax-request-timeline',/아직 불러오지 않았습니다/);
    await page.locator('#detail [data-fl="older"]').click();await expectText('#detail .ax-request-timeline',/결석 보고/);await close();
  }

  // 11. New work reaches a person who is just looking at their screen (≤ ~10 s, no reload), and an unchanged revision
  //     leaves the screen untouched.
  await asActor(people[0].id);await page.waitForTimeout(500);
  await page.locator('#main').evaluate(n=>{n.firstElementChild.dataset.marker='kept';});
  await page.waitForTimeout(9000);
  assert.equal(await page.locator('#main [data-marker="kept"]').count(),1,'Polling with no change does not re-render');
  const pushed=await post({actorId:owner.id,kind:'request.create',payload:{title:'교재 재고 확인',body:'다음 주 교재 재고를 확인해 주세요.',assigneeIds:[people[0].id],priority:'normal',channels:['app'],source:{kind:'direct'}}});
  assert.equal(pushed.status,200);
  await page.waitForSelector(`.fl-case[data-case="${pushed.body.caseId}"]`,{timeout:12000});
  await expectText('#toast',/새로 들어온 일/);
  assert.equal((await drive(pushed.body.caseId,{manager:manager.id})).state,'done','The pushed request is finished, leaving no open test work');

  // 12. All workspaces stay reachable; phone layout of a staff inbox; no errors or external requests.
  const areas=await page.evaluate(()=>window.AxCatalog.areas.map(a=>a.id));
  for(const id of areas){await close();await page.evaluate(id=>{location.hash=`workspace-${id}`;},id);await page.waitForFunction(id=>document.body.dataset.page===`workspace-${id}`,id);}
  await page.setViewportSize({width:390,height:844});
  await asActor(people[0].id);assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'Staff inbox fits the phone');
  await shot('staff-390');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(mutations,[]);
  console.log(`PASS: owner/manager/staff flow views, absence scenario (report → return → resend → accept → homeroom follow-up → done), billing check to decision, owner multi-assignee request (picker, double-submit guard, one step per recipient, review close), reload persistence, duplicate scenario answered with the same case, fact source → linked follow-up, 409 + wrong-person rejection, passive arrival of new work with no re-render on unchanged revision,${flowRoutes.mock?' multi-page cases + older events (stand-in),':''} ${areas.length} workspaces reachable, phone layout. flow=${flowRoutes.served?`server (${base}, run ${runId})`:'test stand-in'}, catalog=${wsRoutes.catalogSource}, workspace data=${wsRoutes.fixtureData?'test projection':'server'}, commands=${commands.length}.`);
}finally{await browser.close();}
