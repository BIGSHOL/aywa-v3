import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Chart interaction rule: every trend/comparison chart shows one point's period, metric and exact value in the app popover
// on hover, keyboard focus and touch. No native title tooltips. Scoped to the shared chart helpers.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const shots='work/owner-concept/chart-qa';
const browser=await chromium.launch();
const errors=[];
const open=async(options)=>{const context=await browser.newContext({reducedMotion:'reduce',...options});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);return page;};
const tipState=page=>page.evaluate(()=>{const t=document.getElementById('chart-tip'),r=t.getBoundingClientRect();return {hidden:t.hidden,head:t.querySelector('.chart-pop-head')?.textContent||'',rows:[...t.querySelectorAll('.chart-pop-row')].map(x=>[x.querySelector('.chart-pop-label').textContent,x.querySelector('.chart-pop-value').textContent]),meta:[...t.querySelectorAll('.chart-pop-meta')].map(x=>x.textContent),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,pointer:getComputedStyle(t).pointerEvents,parent:t.parentElement.tagName};});
const hoverPoint=async(page,boxSel,index)=>{const box=await page.locator(boxSel).locator('[data-point]').nth(index).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height-2,box.height/2));};
try{
  await mkdir(shots,{recursive:true});
  const page=await open({viewport:{width:1440,height:1000}});
  await page.goto(base);await page.evaluate(()=>document.fonts.ready);
  const trend=await page.evaluate(()=>window.AcademySnapshot.trend.filter(t=>window.AcademySnapshot.months.includes(t.month)));
  const won=n=>`${Math.round(n).toLocaleString('ko-KR')}원`,yy=m=>`${m.slice(2,4)}.${m.slice(5,7)}`;
  assert.equal(await page.locator('[data-chart] [title], [data-chart] title').count(),0,'No native title tooltips inside charts');

  // 1. Briefing trend line: each month's hit zone shows that month and its exact value.
  const billed='.ax-change-cell:nth-child(1) .chart-line';
  await page.locator(billed).scrollIntoViewIfNeeded();
  await hoverPoint(page,billed,0);
  let tip=await tipState(page);
  assert.equal(tip.hidden,false);assert.equal(tip.head,yy(trend[0].month));
  assert.deepEqual(tip.rows,[['청구액',won(trend[0].billed)]]);assert(tip.meta.includes('청구월 기준'));
  assert(tip.inside,'Popover stays inside the viewport');assert.equal(tip.pointer,'none','Popover never blocks clicks or scrolling');
  assert.equal(await page.locator(billed).getAttribute('aria-describedby'),'chart-tip');
  await hoverPoint(page,billed,1);tip=await tipState(page);
  assert.equal(tip.rows[0][1],won(trend[1].billed));assert(tip.meta.some(m=>String(m).startsWith(`전월(${yy(trend[0].month)}) 대비`)),JSON.stringify(tip.meta));
  await page.evaluate(()=>{document.querySelector('#chart-tip .chart-pop-head').dataset.probe='kept';});
  const bb=await page.locator(billed).locator('[data-point]').nth(1).boundingBox();
  await page.mouse.move(bb.x+bb.width/2-3,bb.y+bb.height/2);await page.mouse.move(bb.x+bb.width/2+3,bb.y+bb.height/2-4);
  assert.equal(await page.evaluate(()=>document.querySelector('#chart-tip .chart-pop-head')?.dataset.probe),'kept','Moving within the same point does not re-render the popover');
  await page.screenshot({path:`${shots}/briefing-hover.png`,animations:'disabled'});
  await page.mouse.move(5,5);assert.equal((await tipState(page)).hidden,true,'Leaving the chart closes the popover');

  // 2. Keyboard: focus shows the latest month, arrows move, Escape closes, scrolling the chart away closes it.
  await page.locator(billed).focus();tip=await tipState(page);
  assert.equal(tip.rows[0][1],won(trend.at(-1).billed),'Exact won value, not rounded');
  await page.keyboard.press('ArrowLeft');tip=await tipState(page);
  assert.equal(tip.head,yy(trend.at(-2).month));assert.equal(tip.rows[0][1],won(trend.at(-2).billed));
  assert.match(await page.locator('.chart-live').innerText(),new RegExp(won(trend.at(-2).billed)),'Keyboard moves are announced');
  await page.keyboard.press('Home');assert.equal((await tipState(page)).rows[0][1],won(trend[0].billed));
  await page.keyboard.press('Escape');assert.equal((await tipState(page)).hidden,true);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('chart-line')),true,'Escape keeps focus on the chart');
  await page.keyboard.press('End');assert.equal((await tipState(page)).hidden,false);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.getElementById('chart-tip').hidden);

  // 3. 막대 차트 — 작업 공간의 월별 추세(공용 chart). 점마다 기간·이름·정확한 값을 앱 팝오버로 보인다.
  await page.evaluate(()=>{location.hash='workspace-calendar';});await page.waitForFunction(()=>document.body.dataset.page==='workspace-calendar');
  await page.evaluate(()=>{location.hash='workspace-billing';});await page.waitForSelector('main .chart-box',{timeout:20000});
  const bars='main .chart-box';
  await page.locator(bars).first().scrollIntoViewIfNeeded();await hoverPoint(page,bars,1);tip=await tipState(page);
  assert.equal(tip.hidden,false,'막대에 팝오버');assert(tip.rows.length>=1&&tip.rows[0][1],'정확한 값');
  await page.screenshot({path:`${shots}/bars-hover.png`,animations:'disabled'});
  await page.close();

  // 4. Touch: a tap selects a point and stays until the next tap outside.
  const phone=await open({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await phone.goto(base);await phone.evaluate(()=>document.fonts.ready);
  const line=phone.locator('.ax-change-cell:nth-child(1) .chart-line');await line.scrollIntoViewIfNeeded();
  const tb=await line.boundingBox();await phone.touchscreen.tap(tb.x+tb.width-4,tb.y+tb.height/2);
  tip=await tipState(phone);assert.equal(tip.hidden,false);assert.equal(tip.rows[0][1],won(trend.at(-1).billed));assert(tip.inside);
  assert.equal(await phone.evaluate(()=>document.body.dataset.page),'home','Touching the chart picks a month instead of navigating');
  await phone.screenshot({path:`${shots}/touch-390.png`,animations:'disabled'});
  await phone.touchscreen.tap(20,700);assert.equal((await tipState(phone)).hidden,true);
  await phone.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: app popover on briefing lines and workspace month bars — hover month/value, no re-render on same point, keyboard + announce + Escape, off-screen close, touch select, no native titles.');
}finally{await browser.close();}
