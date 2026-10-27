import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { assistantRequestProblems } from './ax-assistant-limits.mjs';

// AX flows at three widths. Every /api/assistant call is answered by the mock below, so this suite never
// spends a Claude call. The real endpoint contract is covered separately by verify-ax-assistant.mjs.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const shots='work/owner-concept/ax-qa';
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[],external=[],mutations=[],aborted=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{const url=new URL(r.url());if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());if(!['GET','HEAD'].includes(r.method())&&url.pathname!=='/api/assistant')mutations.push(`${r.method()} ${url.pathname}`);});
page.on('requestfailed',r=>{if(r.url().endsWith('/api/assistant'))aborted.push(r.failure()?.errorText||'failed');});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const answer=(text,extra={})=>({status:200,json:{answer:text,issueIds:[],suggestedTask:null,provider:'claude-cli',...extra}});
const assistant={calls:[],queue:[],violations:[]};
await page.route('**/api/assistant',async route=>{
  const body=route.request().postDataJSON(),problems=assistantRequestProblems(body);
  assistant.calls.push(body);if(problems.length)assistant.violations.push(problems.join('; '));
  const step=assistant.queue.shift()||answer('모의 응답입니다.');
  if(step.hold)await step.hold;
  try{if(step.abort)await route.abort(step.abort);else await route.fulfill({status:step.status,headers:step.headers,contentType:'application/json',body:JSON.stringify(step.json)});}catch{/* the page already cancelled this request */}
});

const close=()=>page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
const go=async id=>{await close();await page.evaluate(id=>{location.hash=id;},id);await page.waitForFunction(id=>document.body.dataset.page===id,id);};
const shot=(name,fullPage=true)=>page.screenshot({path:`${shots}/${name}.png`,fullPage,animations:'disabled'});
const rect=sel=>page.locator(sel).first().evaluate(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};});
const visibleCount=sel=>page.locator(sel).evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).length);
const waitFocus=id=>page.waitForFunction(id=>document.activeElement?.id===id,id);

try{
  await mkdir(shots,{recursive:true});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);

  // 1. Chrome on the left, no desktop header band, 2.0 type and controls.
  assert.equal(await page.locator('h1').innerText(),'브리핑');
  assert.equal(await page.locator('#topbar').evaluate(n=>getComputedStyle(n).display),'none','Desktop must not keep an empty header band');
  assert((await rect('main')).top<=1,'Main content starts at the top edge');
  for(const sel of ['#sidebar [data-action="search"]','#sidebar [data-ax="chat"]','#sidebar [data-ax="digest"]','#sidebar a[href="#inbox"]','#sidebar [data-ax="request"]','#sidebar [data-ax="launcher"]'])assert.equal(await page.locator(sel).count(),1,`${sel} lives in the left sidebar`);
  assert.equal(await page.locator('.nav-scroll a').count(),4,'Primary navigation is the owner workflow');
  assert.deepEqual(await page.locator('.ax-summary').first().evaluate(n=>({font:getComputedStyle(n).fontSize,color:getComputedStyle(n).color})),{font:'16px',color:'rgb(18, 18, 18)'});
  assert.deepEqual(await page.locator('main .button').first().evaluate(n=>({font:getComputedStyle(n).fontSize,radius:getComputedStyle(n).borderRadius})),{font:'18px',radius:'8px'});
  assert.equal(await page.locator('main .button.primary').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(21, 62, 117)');
  const smallest=await page.evaluate(()=>Math.min(...[...document.querySelectorAll('main *, #sidebar *')].filter(n=>!n.closest('svg')&&n.getClientRects().length&&[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())).map(n=>parseFloat(getComputedStyle(n).fontSize))));
  assert(smallest>=14,`No text below the 14px helper size (found ${smallest}px)`);

  // 2. First screen = critical signals + compact change + command; the full issue detail starts below it.
  const signals=await page.locator('.ax-signals .ax-signal').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));
  assert.deepEqual(signals,['approval','billing','tasks'],'Pending decision, remaining payments and overdue follow-ups lead');
  assert.match(await page.locator('.ax-signal[data-id="billing"]').innerText(),/329,000원/);
  assert.equal(await page.locator('.ax-change > .ax-change-cell').count(),3);
  assert.equal(await page.locator('.ax-domain-grid button').count(),12);
  // Desktop: the summary fills one viewport and the detail starts at the fold — no cut, no large hole.
  for(const [width,height] of [[1440,768],[1440,900],[1440,1080],[1024,768]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));
    const command=await rect('.ax-command'),cue=await rect('.ax-scroll-cue'),detail=(await rect('#ax-issues')).top;
    assert(command.bottom<=cue.top+1&&cue.bottom<=height,`${width}x${height}: command and scroll cue are visible (${command.bottom}/${cue.bottom})`);
    assert(detail>=height-1,`${width}x${height}: issue detail starts below the first screen (${detail})`);
    assert(cue.top-command.bottom<=height*.15,`${width}x${height}: no large empty band (${Math.round(cue.top-command.bottom)}px)`);
    if(height===1080)await shot('briefing-1440x1080',false);
  }
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:width===390?844:1000});
    for(const view of ['home','inbox','requests','automation']){
      await go(view);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view} at ${width} overflow`);
    }
    await go('home');await page.evaluate(()=>window.scrollTo(0,0));
    await shot(`briefing-${width}`,false);await shot(`briefing-${width}-full`);
    const cueBottom=(await rect('.ax-scroll-cue')).bottom,issuesTop=(await rect('#ax-issues')).top;
    assert(issuesTop-cueBottom<=48,`No dead space between the first screen and details at ${width} (${issuesTop-cueBottom}px)`);
    if(width===390){
      const bar=await rect('#topbar');assert(bar.height<=64&&bar.top===0,'Phones keep one slim menu bar');
      assert.match(await page.locator('[data-action="menu"]').getAttribute('aria-label'),/메뉴 열기/);
      assert.equal(await page.locator('#sidebar').evaluate(n=>n.inert),true,'Closed off-canvas menu leaves the tab order');
      assert(Math.min(...await page.locator('.ax-signal').evaluateAll(n=>n.map(x=>x.getBoundingClientRect().width)))>=150);
    }
  }

  // 3. Priority click scrolls the page (not an inner pane) to the evidence and moves focus there.
  await page.setViewportSize({width:1440,height:1000});await go('home');await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('.ax-signal[data-id="approval"]').click();await waitFocus('ax-issue-approval');
  assert(await page.evaluate(()=>window.scrollY)>0,'Ordinary page scrolling reveals the detail');
  assert(Math.abs((await rect('#ax-issue-approval')).top)<=40,'Selected issue is brought to the top');
  assert.match(await page.locator('#ax-issue-approval').innerText(),/확인함|확인 취소/);
  await page.evaluate(()=>window.scrollTo(0,0));await page.locator('[data-ax="focus-list"]').click();await waitFocus('ax-issues-title');
  await page.locator('#ax-issue-billing').scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,-20));
  const keep=await page.evaluate(()=>window.scrollY);await page.locator('#ax-read-billing').click();
  assert(Math.abs(await page.evaluate(()=>window.scrollY)-keep)<=2,'Marking an issue read keeps the page position');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'ax-read-billing','Focus survives the re-render');
  assert.equal(await visibleCount('#ax-records-attendance li'),8,'Long evidence lists start compact');
  await page.locator('#ax-expand-attendance').click();
  assert(await visibleCount('#ax-records-attendance li')>8);
  assert.equal(await page.locator('#ax-records-attendance').evaluate(n=>n.scrollHeight<=n.clientHeight+1),true,'Expanded evidence grows the page instead of an inner scroller');
  await page.locator('#ax-filter-decide').click();assert.deepEqual(await page.locator('.ax-issue').evaluateAll(n=>n.map(x=>x.id)),['ax-issue-approval']);
  await page.locator('#ax-filter-all').click();

  // 4. Staff multi-select: collapsed by default, searchable, chips, hidden inputs, validation, keyboard, IME, draft.
  const staff=await page.evaluate(()=>window.AcademySnapshot.staff.map(s=>({id:s.id,name:s.name,department:s.department})));
  const english=staff.find(s=>s.department==='영어과'),math=staff.find(s=>s.department==='수학과');
  assert(english&&math);
  await page.locator('#ax-issue-billing [data-ax="request"]').click();
  assert.equal(await page.locator('#ax-owner-panel').isHidden(),true,'Staff list is collapsed by default');
  const modal=await rect('#modal');
  for(const sel of ['[name=due]','[name=priority]','[name=body]'])assert((await rect(`#modal ${sel}`)).bottom<=modal.bottom,`${sel} is visible without scrolling past the staff list`);
  await page.locator('[data-ax-form="request"] button[type=submit]').click();
  assert.match(await page.locator('.ax-form-error').innerText(),/담당자/);
  assert.equal(await page.locator('#ax-owner-trigger').getAttribute('aria-invalid'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'ax-owner-trigger');
  await page.locator('#ax-owner-trigger').press('ArrowDown');
  assert.equal(await page.locator('#ax-owner-trigger').getAttribute('aria-expanded'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'ax-owner-search');
  await page.locator('#ax-owner-search').fill(math.name);
  assert(await visibleCount('#ax-owner-list [role=option]')<staff.length,'Search narrows the list');
  assert.match(await page.locator('#ax-owner-list [role=option]:not([hidden])').first().innerText(),new RegExp(math.name));
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.locator('[data-picker-inputs] input[name=owner]').evaluateAll(n=>n.map(x=>x.value)),[math.id]);
  await page.locator('#ax-owner-search').fill('영어과');
  await page.locator(`#ax-owner-list [data-owner="${english.id}"]`).click();
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),2,'Selection is preserved while the filter hides earlier picks');
  await page.locator('#ax-owner-search').fill('없는직원zz');
  assert.match(await page.locator('.ax-picker-empty').innerText(),/맞는 직원이 없습니다/);
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),2);
  await page.locator('#ax-owner-search').fill(english.name);
  await page.locator('#ax-owner-search').evaluate(n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),2,'Enter while composing Korean does not toggle');
  await shot('request-dropdown-open',false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').evaluate(n=>n.open),true,'Escape closes only the dropdown');
  assert.equal(await page.locator('#ax-owner-panel').isHidden(),true);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'ax-owner-trigger');
  assert.equal(await page.locator('#modal [name=title]').inputValue(),'수납 잔액 확인 및 후속 안내');
  await page.locator(`[data-picker-remove="${english.id}"]`).click();
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),1);
  await page.locator('#ax-owner-trigger').click();await page.locator('#modal [name=title]').click();
  assert.equal(await page.locator('#ax-owner-panel').isHidden(),true,'Clicking elsewhere closes the dropdown');
  await page.locator('#modal [name=body]').fill('실제 납부 내역을 대조하고 보호자 안내 여부를 확인해 주세요. <검토>');
  await page.locator('#modal [data-close="modal"]').click();
  await page.locator('#ax-issue-billing [data-ax="request"]').click();
  assert.match(await page.locator('.ax-draft-note').innerText(),/이어서/,'Closing keeps the draft');
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),1);
  assert.match(await page.locator('#modal [name=body]').inputValue(),/<검토>/);
  await page.locator('[data-ax="draft-reset"]').click();
  assert.equal(await page.locator('[data-picker-inputs] input[name=owner]').count(),0,'Draft can be reset');
  await page.locator('#ax-owner-trigger').click();await page.locator(`#ax-owner-list [data-owner="${math.id}"]`).click();await page.locator(`#ax-owner-list [data-owner="${english.id}"]`).click();await page.locator('[data-picker-done]').click();
  assert.equal(await page.locator('.ax-picker-chip').count(),2);
  assert.match(await page.locator('#ax-owner-trigger').getAttribute('aria-label'),/^담당자 추가·변경 · 2명 선택됨/,'Accessible name contains the visible label');
  await page.locator('#modal [name=body]').fill('실제 납부 내역을 대조하고 보호자 안내 여부를 확인해 주세요. <검토>');
  await shot('request-compose',false);
  await page.locator('[data-ax-form="request"] button[type=submit]').click();
  assert.match(await page.locator('#detail').innerText(),/확인 대기/);
  assert.match(await page.locator('#detail').innerText(),/<검토>/,'Request text is rendered as text');
  assert.match(await page.locator('#detail').innerText(),new RegExp(`${math.name}, ${english.name}`));

  // 5. Slack previews follow the issue and the request; the completed report comes back as a notification.
  await page.locator('[data-ax="request-slack"]').click();
  assert.match(await page.locator('#modal').innerText(),/실제 발송되지 않았습니다/);
  assert.match(await page.locator('#modal').innerText(),/연결 이슈: 수납 확인 14건/);
  await shot('slack-preview',false);
  await page.locator('#modal [data-ax="request-detail"]').click();
  await page.locator('[data-ax="request-start"]').click();
  assert.match(await page.locator('#detail').innerText(),/진행 중/);
  await page.locator('[name=result]').fill('납부 내역 확인 완료. 추가 연락이 필요한 가정을 정리했습니다.');
  await page.locator('[data-ax-form=result] button[type=submit]').click();
  assert.match(await page.locator('#detail').innerText(),/완료 보고/);
  await page.locator('[data-ax="report-slack"]').click();
  assert.match(await page.locator('#modal').innerText(),/받는 사람: 원장/);assert.match(await page.locator('#modal').innerText(),/추가 연락이 필요한 가정/);
  await close();await go('home');
  assert.match(await page.locator('.ax-signal.report').innerText(),/완료 보고/,'The report arrives on the first screen');
  assert.match(await page.locator('#sidebar a[href="#inbox"]').innerText(),/\d/);
  await go('inbox');assert.match(await page.locator('main .ax-notifications').innerText(),/추가 연락이 필요한 가정/);
  await shot('notification-result');
  await page.locator('main [data-ax=request-detail]').first().click();
  await page.locator('[data-ax=request-reopen]').click();
  assert.match(await page.locator('.ax-request-timeline').innerText(),/추가 확인 요청/);
  await go('requests');assert.equal(await page.locator('.ax-workflow section').nth(1).locator('.ax-request-row').count(),1);

  // 6. Assistant: explicit unavailable error with retry, never a canned answer.
  await go('home');
  assistant.queue.push({status:405,json:{error:'Read-only preview'}});
  await page.locator('#ax-home-command').fill('미수납 확인을 관리자에게 요청해줘');
  await page.locator('[data-ax-form=chat] button[type=submit]').click();
  await page.locator('.ax-chat-answer.error').waitFor();
  assert.match(await page.locator('.ax-chat-answer.error').innerText(),/준비되지 않았습니다/);
  assert.equal(await page.locator('.ax-chat-text').count(),0,'No fallback answer pretends to be Claude');
  assert.deepEqual(assistant.calls.at(-1),{prompt:'미수납 확인을 관리자에게 요청해줘',contextIssueId:null,history:[]});
  await shot('chat-error',false);
  assistant.queue.push({abort:'connectionrefused'});
  await page.locator('[data-ax="chat-retry"]').click();
  await page.waitForFunction(()=>/연결하지 못했습니다/.test(document.querySelector('.ax-chat-answer.error')?.innerText||''));
  assistant.queue.push({status:503,json:{error:'auth_required',message:'Claude 로그인이 필요합니다. 로컬 터미널에서 로그인한 뒤 다시 시도해 주세요.'}});
  await page.locator('[data-ax="chat-retry"]').click();
  await page.waitForFunction(()=>/Claude 로그인이 필요합니다/.test(document.querySelector('.ax-chat-answer.error')?.innerText||''));
  assert.equal(await page.locator('.ax-chat-answer.error [title]').count(),0,'No native tooltip on errors');await page.locator('.ax-chat-answer.error summary').click();
  assert.match(await page.locator('.ax-chat-answer.error details').innerText(),/HTTP 503 · auth_required/);
  assistant.queue.push({status:429,headers:{'Retry-After':'12'},json:{error:'busy',message:'다른 질문을 처리하고 있습니다.'}});
  await page.locator('[data-ax="chat-retry"]').click();
  await page.waitForFunction(()=>/약 12초 뒤/.test(document.querySelector('.ax-chat-answer.error')?.innerText||''));
  assistant.queue.push(answer('남은 수납은 329,000원입니다. <img src=x onerror="window.__xss=1"> **먼저 대조**가 필요합니다.',{issueIds:['billing','unknown-issue'],suggestedTask:{title:'수납 잔액 확인 요청',body:'14건의 납부 내역을 대조하고 결과를 보고해 주세요.'}}));
  await page.locator('[data-ax="chat-retry"]').click();
  await page.locator('.ax-chat-text').waitFor();
  assert.match(await page.locator('.ax-chat-text').innerText(),/<img src=x/,'Model text is escaped');
  assert.equal(await page.locator('.ax-chat-log img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
  assert.equal(await page.locator('.ax-chat-text strong').innerText(),'먼저 대조');
  assert.match(await page.locator('.ax-chat-provider').innerText(),/Claude · 로컬 CLI/);
  assert.equal(await page.locator('.ax-chat-answer [data-ax="open-issue"]').count(),1,'Unknown issue ids are ignored');

  // 7. One request at a time; explicit cancel aborts it; retry resends; history stays bounded.
  const hold=deferred();assistant.queue.push({hold:hold.promise,...answer('늦은 응답')});
  const before=assistant.calls.length;
  await page.locator('#ax-chat-command').fill('기한 지난 업무를 누구에게 확인할까?');await page.locator('#ax-chat-command').press('Enter');
  await page.locator('.ax-chat-answer.pending').waitFor();
  assert.equal(await page.locator('[data-chat-send]').isDisabled(),true);
  await page.waitForFunction(()=>/초 경과/.test(document.querySelector('[data-chat-elapsed]')?.textContent||''));
  await shot('chat-pending',false);
  await page.locator('#ax-chat-command').fill('중복 전송 시도');await page.locator('#ax-chat-command').press('Enter');
  await page.waitForTimeout(150);assert.equal(assistant.calls.length,before+1,'No duplicate submission while pending');
  assert.equal(await page.locator('#ax-chat-command').inputValue(),'중복 전송 시도','The unsent text stays');
  await page.locator('[data-ax="chat-cancel"]').click();
  await page.locator('.ax-chat-answer.muted').waitFor();hold.resolve();
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.ax),'chat-retry','Focus stays on the cancelled question');
  await page.waitForFunction(()=>!document.querySelector('[data-chat-send]').disabled);
  assert(aborted.length>=1,'Cancel aborts the request');
  assert.equal(await page.locator('.ax-chat-answer.muted [data-ax="chat-retry"]').count(),1);
  for(let i=0;i<9;i++){assistant.queue.push(answer(`답변 ${i} `+'가'.repeat(i%2?3000:900)));await page.locator('#ax-chat-command').fill(`  질문 ${i} `+'나'.repeat(i===4?1500:400)+'  ');await page.locator('#ax-chat-command').press('Enter');await page.waitForFunction(i=>document.querySelector('.ax-chat-log').innerText.includes(`답변 ${i} `),i);}
  const history=assistant.calls.at(-1).history;
  assert(history.length<=12&&history.length%2===0,'History is bounded to recent completed turns');
  assert(history.length>=2,'Recent context is still sent');
  assert.deepEqual(assistant.violations,[],'Every request stays inside the backend limits, even after long conversations');
  const longPrompt=assistant.calls.find(c=>c.prompt.startsWith('질문 4'))?.prompt||'';
  assert(longPrompt.length<=1000&&longPrompt.length>=900&&longPrompt===longPrompt.trim(),'Long prompts are trimmed and capped before sending');
  assert(history.every((m,i)=>m.role===(i%2?'assistant':'user')&&typeof m.content==='string'));
  assert(!history.some(m=>/늦은 응답|중복 전송|준비되지 않았습니다/.test(m.content)),'Only completed turns are sent as history');
  await shot('chat-answer',false);

  // 8. Suggested task fills title and body for review and keeps the source issues; nothing is dispatched.
  await close();await go('home');await page.locator('#sidebar [data-ax="chat"]').click();
  const requestCount=await page.locator('.ax-request-row').count();
  await page.locator('[data-ax="chat-task"]').first().click();
  assert.equal(await page.locator('#modal [name=title]').inputValue(),'수납 잔액 확인 요청');
  assert.equal(await page.locator('#modal [name=body]').inputValue(),'14건의 납부 내역을 대조하고 결과를 보고해 주세요.');
  assert.deepEqual(await page.locator('#modal input[name=issue]').evaluateAll(n=>n.map(x=>x.value)),['billing']);
  assert.equal(await page.locator('#modal [data-picker-inputs] input').count(),0,'Assignees are chosen by the owner');
  await close();assert.equal(await page.locator('.ax-request-row').count(),requestCount,'Opening a suggestion does not create a request');
  await page.locator('#sidebar [data-ax="chat"]').click();await page.locator('[data-ax="chat-task"]').first().click();
  await page.locator('#ax-owner-trigger').click();await page.locator(`#ax-owner-list [data-owner="${math.id}"]`).click();await page.keyboard.press('Escape');
  await page.locator('[data-ax-form="request"] button[type=submit]').click();
  assert.match(await page.locator('#detail').innerText(),/AI 제안에서 작성/);
  assert.equal(await page.locator('#detail [data-ax="open-issue"][data-id="billing"]').count(),1);

  // 9. Issue context is sent; an answer that lands while the drawer is closed is announced.
  await close();await page.locator('#ax-issue-attendance [data-ax="ask"]').click();
  assert.match(await page.locator('[data-chat-context]').innerText(),/출결 특이사항/);
  assert.match(await page.locator('#ax-chat-command').inputValue(),/출결 특이사항/);
  const late=deferred();assistant.queue.push({hold:late.promise,...answer('결석 3회 이상 원생은 담임 확인이 먼저입니다.')});
  await page.locator('#ax-chat-command').press('Enter');await page.locator('.ax-chat-answer.pending').waitFor();
  assert.equal(assistant.calls.at(-1).contextIssueId,'attendance');
  await close();late.resolve();
  await page.waitForFunction(()=>/AI 응답이 도착했습니다/.test(document.querySelector('#toast').textContent));
  assert.equal(await page.locator('#sidebar [data-ax="chat"] .nav-count').isHidden(),true,'Sidebar busy badge clears while the drawer is closed');
  await page.locator('#sidebar [data-ax="chat"]').click();assert.match(await page.locator('.ax-chat-log').innerText(),/담임 확인이 먼저/);

  // 10. Archive / restore, automation settings, session reset.
  await close();await page.locator('#ax-archive-attendance').click();
  assert.equal(await page.locator('#ax-issue-attendance').count(),0);
  await go('inbox');await page.locator('main [data-ax=inbox-tab][data-id=archived]').click();
  assert.match(await page.locator('main .ax-notifications').innerText(),/출결 특이사항/);
  await page.locator('main [data-ax=open-issue][data-id=attendance]').click();await waitFocus('ax-issue-attendance');
  await go('automation');await page.locator('[data-ax-setting=slack]').uncheck();
  await page.locator('main [data-ax=digest]').click();assert.match(await page.locator('#modal').innerText(),/선택되지 않았습니다/);await close();
  await page.locator('#sidebar [data-ax=request]').click();assert(!await page.locator('[name=channel][value=slack]').isChecked());await close();
  await page.setViewportSize({width:390,height:844});await go('home');
  await page.locator('[data-action=menu]').click();assert.equal(await page.locator('#sidebar').evaluate(n=>n.inert),false);
  await page.locator('#sidebar [data-ax="chat"]').click();assert(await page.locator('#detail').isVisible(),'AI is reachable from the mobile menu');
  assert(!await page.locator('body').evaluate(n=>n.classList.contains('menu-open')),'Opening a drawer from the menu closes the menu');await shot('chat-390',false);await close();
  await page.locator('#ax-issue-billing [data-ax="request"]').click();await page.locator('#ax-owner-trigger').click();
  const panel=await rect('#ax-owner-panel');assert(panel.left>=0&&panel.right<=390,'Dropdown fits the phone width');
  assert(await visibleCount('#ax-owner-list [role=option]')>3);await shot('request-dropdown-390',false);await close();
  await page.locator('[data-action=menu]').click();await page.locator('#sidebar a[href="#requests"]').click();
  await page.waitForFunction(()=>document.body.dataset.page==='requests'&&!document.body.classList.contains('menu-open'));
  await page.reload();assert.equal(await page.locator('.ax-request-row').count(),0,'Session requests must reset');
  assert.deepEqual(assistant.violations,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(mutations,[]);
  console.log('PASS: viewport-height first screen at 768/900/1080, left chrome without header band, 2.0 type/controls, critical-first briefing at 3 widths, scroll-to-evidence focus, searchable multi-select (chips, hidden inputs, keyboard, IME, empty, draft, validation), Slack request/report previews, report notification, mocked assistant (unavailable/network/backend error envelope/Retry-After/escape/provider/cancel/dedupe/backend request limits/context/suggested task), archive/restore, session isolation.');
}finally{await browser.close();}
