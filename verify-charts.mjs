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
  const won=n=>`${Math.round(n).toLocaleString('ko-KR')}원`;
  assert.equal(await page.locator('[data-chart] [title], [data-chart] title').count(),0,'No native title tooltips inside charts');

  // 1. Briefing trend line: each month's hit zone shows that month and its exact value.
  const students='.ax-change-cell:nth-child(1) .chart-line',paid='.ax-change-cell:nth-child(2) .chart-line';
  await hoverPoint(page,students,0);
  let tip=await tipState(page);
  assert.equal(tip.hidden,false);assert.equal(tip.head,`${trend[0].month.slice(0,4)}년 ${Number(trend[0].month.slice(5))}월`);
  assert.deepEqual(tip.rows,[['청구 대상 원생',`${trend[0].payingStudents}명`]]);assert(tip.meta.includes('청구월 기준'));
  assert(tip.inside,'Popover stays inside the viewport');assert.equal(tip.pointer,'none','Popover never blocks clicks or scrolling');
  assert.equal(await page.locator(students).getAttribute('aria-describedby'),'chart-tip');
  await hoverPoint(page,students,1);tip=await tipState(page);
  const d=trend[1].payingStudents-trend[0].payingStudents;
  assert.equal(tip.rows[0][1],`${trend[1].payingStudents}명`);assert(tip.meta.includes(`전월(${Number(trend[0].month.slice(5))}월) 대비 ${d>0?'+':d<0?'−':'±'}${Math.abs(d)}명`),JSON.stringify(tip.meta));
  await page.evaluate(()=>{document.querySelector('#chart-tip .chart-pop-head').dataset.probe='kept';});
  const bb=await page.locator(students).locator('[data-point]').nth(1).boundingBox();
  await page.mouse.move(bb.x+bb.width/2-3,bb.y+bb.height/2);await page.mouse.move(bb.x+bb.width/2+3,bb.y+bb.height/2-4);
  assert.equal(await page.evaluate(()=>document.querySelector('#chart-tip .chart-pop-head')?.dataset.probe),'kept','Moving within the same point does not re-render the popover');
  await page.screenshot({path:`${shots}/briefing-hover.png`,animations:'disabled'});
  await page.mouse.move(5,995);assert.equal((await tipState(page)).hidden,true,'Leaving the chart closes the popover');

  // 2. Keyboard: focus shows the latest month, arrows move, Escape closes, scrolling the chart away closes it.
  await page.locator(paid).focus();tip=await tipState(page);
  assert.equal(tip.rows[0][1],won(trend.at(-1).paid),'Exact won value, not rounded');
  await page.keyboard.press('ArrowLeft');tip=await tipState(page);
  assert.equal(tip.head,`${trend.at(-2).month.slice(0,4)}년 ${Number(trend.at(-2).month.slice(5))}월`);assert.equal(tip.rows[0][1],won(trend.at(-2).paid));
  assert.match(await page.locator('.chart-live').innerText(),new RegExp(won(trend.at(-2).paid)),'Keyboard moves are announced');
  await page.keyboard.press('Home');assert.equal((await tipState(page)).rows[0][1],won(trend[0].paid));
  await page.keyboard.press('Escape');assert.equal((await tipState(page)).hidden,true);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('chart-line')),true,'Escape keeps focus on the chart');
  await page.keyboard.press('End');assert.equal((await tipState(page)).hidden,false);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.getElementById('chart-tip').hidden);

  // 3. Bar charts with two series, horizontal bars, the collected/remaining bar and a chart inside a dialog.
  await page.evaluate(()=>{location.hash='finance';});await page.waitForFunction(()=>document.body.dataset.page==='finance');
  const dual='.chart-box:has(rect[fill="#a7cbbb"])';
  await page.locator(dual).first().scrollIntoViewIfNeeded();await hoverPoint(page,dual,2);tip=await tipState(page);
  assert.deepEqual(tip.rows.map(r=>r[0]),['청구액','수납액'],'Both series in the same format');
  assert(tip.rows.every(r=>/원$/.test(r[1])),'Money is shown in exact won');
  await page.locator('.live-amount').scrollIntoViewIfNeeded();await hoverPoint(page,'.live-amount',0);tip=await tipState(page);
  assert.equal(tip.rows[0][0],'수납');assert.match(tip.meta[0]||'',/청구액의/);
  await page.locator('[data-action="report"]').click();await page.locator('#modal .chart-box').first().hover();
  tip=await tipState(page);assert.equal(tip.parent,'DIALOG','Popover renders above an open dialog');assert.equal(tip.hidden,false);
  await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
  await page.evaluate(()=>{location.hash='students';});await page.waitForFunction(()=>document.body.dataset.page==='students');
  await page.locator('.live-bars').first().scrollIntoViewIfNeeded();await hoverPoint(page,'.live-bars',0);tip=await tipState(page);
  assert.equal(tip.rows[0][0],'인원');assert.match(tip.rows[0][1],/명$/);assert.match(tip.meta[0]||'',/^전체 [\d,]+명 중 [\d.]+%$/);
  await page.screenshot({path:`${shots}/bars-hover.png`,animations:'disabled'});
  await page.close();

  // 4. Touch: a tap selects a point and stays until the next tap outside.
  const phone=await open({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await phone.goto(base);await phone.evaluate(()=>document.fonts.ready);
  const line=phone.locator('.ax-change-cell:nth-child(1) .chart-line');await line.scrollIntoViewIfNeeded();
  const tb=await line.boundingBox();await phone.touchscreen.tap(tb.x+tb.width-4,tb.y+tb.height/2);
  tip=await tipState(phone);assert.equal(tip.hidden,false);assert.equal(tip.rows[0][1],`${trend.at(-1).payingStudents}명`);assert(tip.inside);
  assert.equal(await phone.evaluate(()=>document.body.dataset.page),'home','Touching the chart picks a month instead of navigating');
  await phone.screenshot({path:`${shots}/touch-390.png`,animations:'disabled'});
  await phone.touchscreen.tap(20,700);assert.equal((await tipState(phone)).hidden,true);
  await phone.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: app popover on briefing lines, dual-series bars, horizontal bars, amount bar and dialog charts — hover month/value, no re-render on same point, keyboard + announce + Escape, off-screen close, touch select, no native titles.');
}finally{await browser.close();}
