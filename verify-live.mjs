// 앱 셸 검사 — 옛 메뉴 주소는 첫 화면으로 가고, 옛 링크는 지금 메뉴로 가며, 기록 서랍은 저장 안 되는 동작 없이 처리 화면으로 잇는다.
// GET만 쓴다(POST·바깥 요청은 막고 기록한다). 실행: node experiments/owner-concept/verify-live.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{
  const request=route.request(),url=request.url();
  if(!url.startsWith(base+'/')&&!url.startsWith('data:')){external.push(url.split('?')[0]);return route.abort();}
  if(request.method()==='HEAD'&&/^\/v2-host\/[a-z-]+\.html$/.test(new URL(url).pathname))return route.fulfill({status:200,body:''});
  return request.method()==='GET'||request.method()==='HEAD'||url.startsWith('data:')?route.continue():route.abort();
});
page.setDefaultTimeout(20000);
await mkdir('work/owner-concept/live-qa',{recursive:true});
const close=async()=>{await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));};
const go=async id=>{await close();await page.evaluate(id=>{location.hash=id;},id);await page.waitForFunction(id=>document.body.dataset.page===id,id);};
const layout=async label=>{const r=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,characters:document.querySelector('main').innerText.length,topbar:getComputedStyle(document.querySelector('#topbar')).display,mainTop:document.querySelector('main').getBoundingClientRect().top+scrollY}));assert(r.width<=r.viewport+1,`${label}: 가로 넘침 ${r.width}/${r.viewport}`);assert(r.characters>20,`${label}: 빈 화면`);if(r.viewport>760)assert(r.topbar==='none'&&r.mainTop<=1,`${label}: 데스크톱 머리 띠 없음`);else assert(r.topbar!=='none'&&r.mainTop<=64,`${label}: 폰 메뉴 띠`);};
// 없어진 세션 전용 동작 — 어느 서랍에도 나오면 안 된다.
const GONE=['student-task','student-note','new-task','new-lead','lead-note','bill-note','message-draft','reply-draft','event-note','calendar-note','report-note','advance-lead','approve','reject','complete-task','report','export','notes','save-name'];
const noSessionAction=async label=>{assert.equal(await page.locator(GONE.map(a=>`[data-action="${a}"]`).join(',')).count(),0,`${label}: 저장 안 되는 동작이 남았다`);const text=await page.locator('body').innerText();assert(!/새로고침하면 사라|저장 안 됨|저장되지는 않|안내 초안|답글 초안/.test(text),`${label}: 세션 전용 문구가 남았다`);};
const openBy=async(attr,id)=>{await page.evaluate(([a,v])=>{const b=document.createElement('button');b.dataset[a]=v;b.hidden=true;document.querySelector('main').append(b);b.click();b.remove();},[attr,id]);await page.waitForFunction(()=>document.querySelector('#detail')?.open);};
try{
 await page.goto(base);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('h1').innerText(),'브리핑');
 assert.equal(await page.evaluate(()=>window.AcademySnapshot.meta.tenant),'인재원 침산');
 assert.equal(await page.locator('body').getByText('가상 데이터',{exact:false}).count(),0);

 // 1. 옛 메뉴 주소를 치면 첫 화면으로 간다(주소도 바뀐다). 왼쪽 맨 아래 링크가 쓰는 #settings만 학원 설정으로.
 const OLD=['students','admissions','classes','learning','finance','staff','parents','shuttle','approvals','resources','calendar'];
 for(const id of OLD){await page.evaluate(id=>{location.hash=id;},id);await page.waitForFunction(()=>location.hash==='#home'&&document.body.dataset.page==='home');assert.equal(await page.locator('main h1').first().innerText(),'브리핑',`#${id} → 첫 화면`);await noSessionAction(`#${id}`);}
 await page.evaluate(()=>{location.hash='settings';});await page.waitForFunction(()=>location.hash==='#v2-owner'&&document.body.dataset.page==='v2-owner');
 await page.goto(`${base}/#finance`);await page.waitForFunction(()=>location.hash==='#home'&&document.body.dataset.page==='home');

 // 2. 첫 화면의 업무 영역 링크(옛 메뉴 이름)는 지금 메뉴로 간다.
 const domains=await page.locator('.ax-domain-grid [data-ax="navigate"]').evaluateAll(n=>[...new Set(n.map(b=>b.dataset.id))]);
 for(const id of domains){await go('home');await page.locator(`.ax-domain-grid [data-id="${id}"]`).first().click();await page.waitForFunction(()=>/^#(v2|workspace)-/.test(location.hash));assert(!OLD.includes((await page.evaluate(()=>location.hash)).slice(1)),`${id}: 옛 주소가 남았다`);}

 // 3. 기록 서랍 — 살아 있고, 세션 전용 동작이 없고, 처리 화면으로 잇는다.
 await go('home');
 await page.evaluate(()=>fetch('/snapshot.json').then(r=>r.ok));
 const ids=await page.evaluate(async()=>{const d=await (await fetch('/snapshot.json')).json();return {student:d.students.find(s=>s.status==='enrolled')?.id,name:d.students.find(s=>s.status==='enrolled')?.name,bill:d.invoices[0]?.id,lead:d.admissions[0]?.id,approval:d.approvals.find(a=>a.status==='pending')?.id||d.approvals[0]?.id,message:d.messages[0]?.id,task:d.tasks.find(t=>t.status==='open')?.id,book:d.textbooks[0]?.id,document:d.documents.find(x=>x.hasFile)?.id,event:d.calendar[0]?.id,class:d.classes[0]?.id,staff:d.staff[0]?.id};});
 for(const [attr,href] of [['student','family=students'],['bill','family=billing'],['lead','family=enrollment'],['approval','family=approvals'],['message','section=parent_replies'],['task',null],['book',null],['document',null],['event',null],['class',null],['staff',null]]){
  if(!ids[attr])continue;
  await openBy(attr,ids[attr]);await noSessionAction(`${attr} 서랍`);
  if(href)assert(await page.locator(`#detail a.button[href*="${href}"]`).count()===1,`${attr} 서랍: 처리 화면 링크`);
  if(attr==='task'){await page.getByRole('button',{name:'후속 요청 만들기'}).waitFor();assert.match(await page.locator('#detail').innerText(),/자동으로 닫힙니다/);}
  await close();
 }
 // 서랍의 처리 화면 링크가 실제로 그 화면에 닿는다.
 await openBy('lead',ids.lead);await page.locator('#detail a.button').click();await page.waitForFunction(()=>location.hash.startsWith('#v2-enrollment'));assert.equal(await page.locator('#detail').evaluate(d=>d.open),false,'이동하면 서랍이 닫힌다');

 // 4. 통합 검색
 await go('home');await page.keyboard.press('Control+k');await page.getByLabel('통합 검색',{exact:true}).fill(ids.name);await page.locator('[data-search-student]').first().click();assert(await page.locator('#detail').isVisible());await close();
 await page.keyboard.press('Control+k');await page.getByLabel('통합 검색',{exact:true}).fill('브리핑');assert(await page.locator('#search-results [data-go="home"]').count()===1);await close();

 // 5. 살아 있는 화면 폭 세 가지
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const id of ['home','inbox','requests','automation','flow']){await go(id);await layout(`${width}/${id}`);if(id==='home')await page.screenshot({path:`work/owner-concept/live-qa/${id}-${width}.png`,fullPage:true,animations:'disabled'});}
 }

 // 6. 왼쪽 메뉴 스크롤 페이드·위치 유지·폰 메뉴
 await close();await page.setViewportSize({width:1440,height:720});await go('home');
 const nav=page.locator('.nav-scroll');await nav.evaluate(n=>{n.scrollTop=0;n.dispatchEvent(new Event('scroll'));});
 assert.equal(await nav.evaluate(n=>getComputedStyle(n).scrollbarWidth),'none');
 assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-top')),'0px');
 assert((await nav.evaluate(n=>parseFloat(n.style.getPropertyValue('--fade-bottom'))))>0);
 const box=await nav.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,80);await page.waitForFunction(()=>document.querySelector('.nav-scroll').scrollTop>0);
 assert((await nav.evaluate(n=>parseFloat(n.style.getPropertyValue('--fade-top'))))>0);
 await nav.evaluate(n=>{n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll'));});assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-bottom')),'0px');
 const offset=await nav.evaluate(n=>n.scrollTop);await go('inbox');assert.equal(await nav.evaluate(n=>n.scrollTop),offset,'다시 그려도 메뉴 스크롤 위치 유지');
 await page.setViewportSize({width:1440,height:2600});await page.waitForFunction(()=>document.querySelector('.nav-scroll').style.getPropertyValue('--fade-bottom')==='0px');assert.equal(await nav.evaluate(n=>n.style.getPropertyValue('--fade-top')),'0px');
 await page.setViewportSize({width:390,height:844});await go('home');assert.equal(await page.locator('#sidebar').evaluate(n=>n.inert),true,'닫힌 폰 메뉴는 탭 순서에서 빠진다');
 await page.locator('[data-action="menu"]').click();assert(await page.locator('body').evaluate(n=>n.classList.contains('menu-open')));assert(await page.evaluate(()=>Boolean(document.activeElement?.closest('#sidebar'))),'열면 포커스가 메뉴로');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('menu-open'));assert.equal(await page.evaluate(()=>document.activeElement?.dataset.action),'menu','Escape는 메뉴 단추로 돌아온다');
 await page.locator('[data-action="menu"]').click();await page.locator('#sidebar [data-action="search"]').click();assert(await page.locator('#modal').isVisible()&&!await page.locator('body').evaluate(n=>n.classList.contains('menu-open')),'왼쪽 검색은 메뉴를 닫고 열린다');await close();
 await page.locator('[data-action="menu"]').click();await page.locator('#sidebar a[href="#requests"]').click();await page.waitForFunction(()=>!document.body.classList.contains('menu-open'));await layout('폰 메뉴 이동');

 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const foreign=await page.request.get(base+'/snapshot.js',{headers:{Origin:'https://example.invalid'}});assert.equal(foreign.status(),403);
 const secret=await page.request.get(base+'/.env.local');assert.equal(secret.status(),404);
 console.log(`PASS: 옛 주소 ${OLD.length}개 → 첫 화면 · 옛 링크 ${domains.length}개 → 지금 메뉴 · 서랍 11종 세션 동작 0 · 검색 · 폭 3종 · 메뉴 스크롤 · 페이지 오류 0 · 바깥 요청 0`);
}finally{await browser.close();}
