import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url().split('?')[0]);});
page.setDefaultTimeout(10000);
await mkdir('work/owner-concept/live-qa',{recursive:true});
const close=async()=>{await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));};
const go=async id=>{await close();await page.evaluate(id=>{location.hash=id;},id);try{await page.waitForFunction(id=>document.body.dataset.page===id,id);}catch(error){throw new Error(`Navigation to ${id} failed: ${errors.join(', ')}`,{cause:error});}};
const layout=async label=>{const result=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,characters:document.querySelector('main').innerText.length,tables:document.querySelectorAll('main table').length,topbar:getComputedStyle(document.querySelector('#topbar')).display,mainTop:document.querySelector('main').getBoundingClientRect().top+scrollY}));assert(result.width<=result.viewport+1,`${label}: horizontal overflow ${result.width}/${result.viewport}`);assert(result.characters>100,`${label}: empty view`);assert.equal(result.tables,0,`${label}: list-first primary layout`);if(result.viewport>760)assert(result.topbar==='none'&&result.mainTop<=1,`${label}: no desktop header band`);else assert(result.topbar!=='none'&&result.mainTop<=64,`${label}: slim mobile menu bar`);};
try{
 await page.goto(base);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('h1').innerText(),'브리핑');
 assert.deepEqual(await page.evaluate(()=>({tenant:window.AcademySnapshot.meta.tenant,tables:window.AcademySnapshot.meta.tables.length,students:window.AcademySnapshot.students.filter(s=>s.status==='enrolled').length})),{tenant:'인재원 침산',tables:337,students:334});
 assert.equal(await page.locator('body').getByText('가상 데이터',{exact:false}).count(),0);
 assert.deepEqual(await page.evaluate(()=>{const rows=window.AcademySnapshot.invoices.filter(i=>i.period==='2026-10');return {billed:rows.reduce((n,i)=>n+i.total,0),remaining:rows.reduce((n,i)=>n+i.remaining,0),unsettled:rows.filter(i=>i.remaining>0).length,paidWithDebt:rows.filter(i=>i.status==='paid'&&i.remaining>0).length};}),{billed:130266625,remaining:329000,unsettled:14,paidWithDebt:0},'Discounts must not become unpaid balances');
 const pages=['home','students','admissions','classes','learning','finance','staff','parents','shuttle','approvals','resources','calendar','settings'];
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const id of pages){await go(id);await layout(`${width}/${id}`);if(width===1440&&['home','finance','staff','students'].includes(id)||width===390&&id==='home')await page.screenshot({path:`work/owner-concept/live-qa/${id}-${width}.png`,fullPage:true,animations:'disabled'});}
 }
 await page.setViewportSize({width:1440,height:800});await go('classes');await page.locator('[data-key="classView"][data-filter="week"]').click();assert(await page.locator('.live-slot').count()>0,'Actual weekly schedules must be visible');await layout('weekly schedules');
 await go('students');const name=await page.evaluate(()=>window.AcademySnapshot.students.find(s=>s.status==='enrolled').name);await page.getByLabel('원생 이름, 학교 검색').fill(name);assert(await page.locator('[data-student]').count()>0);await page.locator('main [data-student]').first().click();assert(await page.locator('#detail').isVisible());
 await page.locator('[data-action="student-task"]').click();await page.getByLabel('업무 제목').fill('시안 검증 <확인>');await page.getByLabel('업무 내용').fill('후속 확인 동작 검증');await page.locator('#preview-form button[type="submit"]').click();assert.match(await page.locator('#detail').innerText(),/시안 검증 <확인>/);await page.locator('[data-action="complete-task"]').click();assert.match(await page.locator('#detail').innerText(),/· 처리됨/);
 await go('admissions');await page.locator('[data-action="new-lead"]').click();await page.getByLabel('원생 이름',{exact:true}).fill('검증학생');await page.getByLabel('상담하고 싶은 내용').fill('시안 안에서 상담 단계 확인');await page.locator('#preview-form button[type="submit"]').click();await page.locator('[data-action="advance-lead"]').click();assert.match(await page.locator('#detail').innerText(),/상담 완료/);
 await go('parents');await page.locator('main [data-message]').first().click();await page.locator('[data-action="reply-draft"]').click();await page.getByLabel('전하고 싶은 내용').fill('시안용 답글 초안');await page.locator('#preview-form button[type="submit"]').click();assert.match(await page.locator('#detail').innerText(),/시안용 답글 초안/);
 await go('approvals');const pending=await page.evaluate(()=>window.AcademySnapshot.approvals.find(a=>a.status==='pending')?.id);if(pending){await page.locator(`[data-approval="${pending}"]`).click();await page.locator('[data-action="approve"]').click();assert.match(await page.locator('#detail').innerText(),/승인 완료/);}
 await go('calendar');await page.locator('[data-action="calendar-note"]').click();await page.getByLabel('제목',{exact:true}).fill('시안 검증 일정');await page.getByLabel('검토 내용').fill('원본과 분리된 일정 메모');await page.locator('#preview-form button[type="submit"]').click();assert.match(await page.locator('#detail').innerText(),/시안 검증 일정/);
 await close();await page.keyboard.press('Control+k');await page.getByLabel('통합 검색',{exact:true}).fill(name);await page.locator('[data-search-student]').first().click();assert(await page.locator('#detail').isVisible());
 await go('finance');await page.locator('[data-period="financeMonth"]').selectOption('2026-11');assert.match(await page.locator('main').innerText(),/다음 달 예정 청구/);await page.locator('[data-action="report"]').click();const download=page.waitForEvent('download');await page.locator('[data-action="export"]').click();assert((await download).suggestedFilename().endsWith('.csv'));
 await go('resources');await page.locator('[data-key="resourceView"][data-filter="documents"]').click();const doc=await page.evaluate(()=>window.AcademySnapshot.documents.find(d=>d.hasFile));assert(doc,'Full snapshot must contain document attachments');await page.getByLabel('문서 검색').fill(doc.title);await page.locator(`[data-document="${doc.id}"]`).click();const fileDownload=page.waitForEvent('download');await page.locator('[data-document-download]').click();await fileDownload;
 await close();await page.setViewportSize({width:1440,height:720});await go('home');
 const nav=page.locator('.nav-scroll');await nav.evaluate(n=>{n.scrollTop=0;n.dispatchEvent(new Event('scroll'));});
 assert.equal(await nav.evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
 assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-top')),'0px');
 assert((await nav.evaluate(n=>parseFloat(n.style.getPropertyValue('--fade-bottom'))))>0);
 const box=await nav.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,80);await page.waitForFunction(()=>document.querySelector('.nav-scroll').scrollTop>0);
 assert((await nav.evaluate(n=>parseFloat(n.style.getPropertyValue('--fade-top'))))>0);
 await nav.evaluate(n=>{n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll'));});assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-bottom')),'0px');
 const offset=await nav.evaluate(n=>n.scrollTop);await go('finance');assert.equal(await nav.evaluate(n=>n.scrollTop),offset,'Navigation position must survive re-render');
 await page.setViewportSize({width:1440,height:1500});await page.waitForFunction(()=>document.querySelector('.nav-scroll').style.getPropertyValue('--fade-bottom')==='0px');assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-top')),'0px');
 await page.setViewportSize({width:390,height:844});await go('home');assert.equal(await page.locator('#sidebar').evaluate(n=>n.inert),true,'Closed mobile menu leaves the tab order');
 await page.locator('[data-action="menu"]').click();assert(await page.locator('body').evaluate(n=>n.classList.contains('menu-open')));assert(await page.evaluate(()=>Boolean(document.activeElement?.closest('#sidebar'))),'Focus moves into the opened menu');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('menu-open'));assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'menu','Escape returns focus to the menu button');
 await page.locator('[data-action="menu"]').click();await page.locator('#sidebar [data-action="search"]').click();assert(await page.locator('#modal').isVisible()&&!await page.locator('body').evaluate(n=>n.classList.contains('menu-open')),'Sidebar search opens over a closed menu');await close();
 await page.locator('[data-action="menu"]').click();await page.locator('#sidebar a[href="#requests"]').click();await page.waitForFunction(()=>!document.body.classList.contains('menu-open'));await layout('mobile navigation');
 await page.reload();assert.equal(await page.evaluate(()=>window.AcademySnapshot.tasks.filter(t=>t.local).length),0,'Preview edits must reset');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const post=await page.request.post(base,{data:{test:true}});assert.equal(post.status(),405);
 const foreign=await page.request.get(base+'/snapshot.js',{headers:{Origin:'https://example.invalid'}});assert.equal(foreign.status(),403);
 const secret=await page.request.get(base+'/.env.local');assert.equal(secret.status(),404);
 console.log('PASS: 13 views at 3 widths without a desktop header band, full DB data, workflow previews, document download, CSV, native wheel/fade edges, scroll retention, local-only access, no browser errors.');
}finally{await browser.close();}
