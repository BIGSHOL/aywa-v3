// AI 업무 지원 — 정리된 답 그리기(ax-chat.js) 시험. /api/assistant는 이 파일의 가짜 답으로만 응답한다(AI 호출 없음).
//   OWNER_CONCEPT_URL=http://127.0.0.1:4391 node experiments/owner-concept/verify-ax-chat.mjs
// ① 서식(결론·핵심 숫자·근거·표·확인할 일)과 이스케이프 ② 좋아짐 빨강·나빠짐 파랑 ③ 미주 카드·미주로 이동
// ④ 바로 가기(작업 영역·연습 화면·확장 추세) ⑤ 요청 창 채우기(제목·본문·출처 영역·첨부 기록, 빼기) ⑥ 옛 모양 답은 평문으로.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.OWNER_CONCEPT_URL || 'http://127.0.0.1:4310';
const RICH = {
  answer: '평문', issueIds: ['billing'], provider: 'claude-cli',
  headline: '10월 남은 금액은 ⟦329,000원⟧입니다 <img src=x onerror="window.__xss=1">',
  keyFacts: [{ label: '남은 금액', value: '329,000원', change: '+329,000원', tone: 'bad', note: 1 }, { label: '수납률', value: '99.7%', change: '+0.2%p', tone: 'good', note: 2 }],
  points: [{ text: '남은 청구는 ⟦14건⟧입니다. 다만 수납액은 누적 금액입니다.', notes: [1, 2] }, { text: '<script>window.__xss=2</script>근거', notes: [9] }],
  notes: [{ n: 1, text: '2026-10 청구 333건: 남은 금액 329,000원.' }, { n: 2, text: '최근 6개월 수납 흐름.' }],
  checks: ['부분납부 ⟦14건⟧ 확인'], table: { columns: ['청구월', '남은 금액'], rows: [['2026-09', '0원'], ['2026-10', '329,000원']] },
  links: [{ id: 'ws:billing', label: '수납관리' }, { id: 'v2:timetable', label: '시간표' }, { id: 'trend:report-written', label: '수업보고서 작성률 추세' }, { id: 'http://evil.test', label: '나쁜 곳' }],
  suggestedTask: { title: '수납 잔액 확인', body: '14건을 확인해 주세요.', area: 'billing', areaLabel: '수납관리', attach: [{ value: 'billing|inv-1', label: '홍길동 · 10월 수강료', meta: '부분납부' }, { value: 'students|x', label: '다른 영역' }, { value: 'billing|<x>', label: '나쁜 값' }] },
};
const LEGACY = { answer: '옛 모양 답입니다. **굵게**', issueIds: [], suggestedTask: null, provider: 'claude-cli' };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const queue = [];
await page.route('**/api/assistant', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queue.shift() || LEGACY) }));
const ask = async (payload, q) => { queue.push(payload); await page.fill('#ax-chat-command', q); await page.keyboard.press('Enter'); };
const openChat = async () => { if (!(await page.locator('#detail[open] [data-ax-chat]').count())) await page.locator('#sidebar [data-ax="chat"]').click(); await page.locator('[data-ax-chat]').waitFor(); };
try {
  await page.goto(`${base}/`); await page.waitForSelector('#sidebar [data-ax="chat"]', { timeout: 60000 });
  await openChat(); await ask(RICH, '수납 정리');
  const a = page.locator('.axc').last(); await a.waitFor();

  // ① 서식 · 이스케이프
  assert.equal(await a.locator('.axc-headline strong').innerText(), '329,000원');
  assert.match(await a.locator('.axc-headline').innerText(), /<img src=x/); assert.equal(await page.locator('.ax-chat-log img').count(), 0);
  assert.match(await a.locator('.axc-points').innerText(), /<script>/); assert.equal(await page.evaluate(() => window.__xss), undefined, 'model text never runs');
  assert.equal(await a.locator('.axc-caveat').innerText(), '다만 수납액은 누적 금액입니다.');
  assert.equal(await a.locator('.axc-fact').count(), 2); assert.equal(await a.locator('.axc-table tbody tr').count(), 2); assert.equal(await a.locator('.axc-checks li').count(), 1);
  assert.equal(await a.locator('.axc-points li').nth(1).locator('a[data-axc-fn]').count(), 0, 'unknown footnote numbers are dropped');
  assert.match(await a.locator('.ax-chat-provider').innerText(), /AI 답변/); assert.doesNotMatch(await a.innerText(), /Claude|CLI|2\.0|로컬/);
  // ② 좋아짐 빨강 · 나빠짐 파랑
  const colors = await page.evaluate(() => { const v = n => { const d = document.createElement('i'); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }; return { good: v('--ax-good'), bad: v('--ax-bad'), shown: [...document.querySelectorAll('.axc .axc-change')].map(x => [x.className, getComputedStyle(x).color]) }; });
  assert.equal(colors.shown.find(([c]) => c.includes('bad'))[1], colors.bad); assert.equal(colors.shown.find(([c]) => c.includes('good'))[1], colors.good);
  // ③ 미주 — 올리면 카드, 누르면 미주로
  const mark = a.locator('a[data-axc-fn]').first(); await mark.hover();
  assert.match(await page.locator('.axc-fn-pop').innerText(), /2026-10 청구 333건/);
  await mark.click(); await page.waitForTimeout(100);
  assert.equal(await a.locator('.axc-notes li.axc-flash').count(), 1, 'click lands on the footnote');
  // ④ 바로 가기 — 서버 목록 모양만, 누르면 그 화면
  assert.deepEqual(await a.locator('[data-axc-go]').evaluateAll(n => n.map(x => x.dataset.axcGo)), ['ws:billing', 'v2:timetable', 'trend:report-written'], 'a link that is not a known destination is not drawn');
  await a.locator('[data-axc-go="v2:timetable"]').click(); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => location.hash), '#v2-timetable'); assert.equal(await page.locator('#detail[open]').count(), 0, 'the chat closes so the screen is visible');
  await openChat(); await page.locator('.axc [data-axc-go="trend:report-written"]').click(); await page.waitForTimeout(400);
  assert.match(await page.evaluate(() => location.hash), /^#v2-trend\?metric=report-written&grain=week$/);
  await openChat(); await page.locator('.axc [data-axc-go="ws:billing"]').click(); await page.waitForTimeout(600);
  assert.match(await page.evaluate(() => location.hash), /billing/);
  // ⑤ 요청 창 — 요청안 + 출처 영역 + 확인된 첨부(다른 영역·모양이 틀린 값은 빠진다), ×로 빼기
  await openChat(); await page.locator('.axc [data-ax="chat-task"]').click(); await page.locator('#modal form[data-ax-form="request"]').waitFor();
  assert.equal(await page.locator('#modal [name=title]').inputValue(), '수납 잔액 확인');
  assert.match(await page.locator('#modal .ax-linked-issues').last().innerText(), /수납관리/);
  assert.deepEqual(await page.locator('#modal .axc-attach input[name=attach]').evaluateAll(n => n.map(x => x.value)), ['billing|inv-1']);
  await page.locator('#modal [data-axc-unattach]').click(); assert.equal(await page.locator('#modal .axc-attach').count(), 0, 'removing the last record removes the box');
  await page.keyboard.press('Escape');
  // ⑥ 옛 모양 답(정리 칸 없음)은 예전처럼 평문으로
  await openChat(); await ask(LEGACY, '옛 모양'); await page.waitForFunction(() => /옛 모양 답입니다/.test(document.querySelector('.ax-chat-log')?.innerText || ''));
  assert.equal(await page.locator('.ax-chat-answer:not(.axc) .ax-chat-text strong').last().innerText(), '굵게');
  assert.deepEqual(errors, []);
  console.log('PASS: AI 업무 지원 — 서식·이스케이프·색·미주·바로 가기·요청 창 채우기·옛 모양(가짜 답, AI 호출 없음).');
} finally { await browser.close(); }
