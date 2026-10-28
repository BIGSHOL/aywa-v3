// Live check of the exit insight (INSIGHT-EXITS.md) — read-only on the local copy, then (with --http=) the running server
// and an isolated browser. node experiments/owner-concept/verify-exit-insight-live.mjs [--http=http://127.0.0.1:4310] [--no-browser]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { loadExitSource } from './exit-source.mjs';
import { loadV2 } from './v2-bridge.mjs';
import { buildExitIndex } from './exit-index.mjs';
import { decompose } from './exit-billing.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const base = arg('http'), browserOn = base && !process.argv.includes('--no-browser'), out = [];
const log = (k, v) => { out.push({ k, v }); console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`); };
const PAIRS = [['2026-07', '2026-08'], ['2026-05', '2026-10']];

// A. Independent SQL (no shared code) vs the decomposition.
const db = await openFullDatabase();
let sqlTotals;
try {
  sqlTotals = await db.begin('read only', async sql => Object.fromEntries(await Promise.all(PAIRS.map(async ([a, b]) => {
    const rows = await sql`with x as (select i.student_id, i.period, sum(greatest(0, i.amount_total - coalesce(i.amount_discount,0)))::float8 amt from public.invoices i join public.students s on s.id=i.student_id and s.tenant_id=${tenantId}
      where i.tenant_id=${tenantId} and not coalesce(s.is_test,false) and i.status not in ('void','refunded') and i.period in (${a}, ${b}) group by 1,2), p as (select * from x where period=${a}), q as (select * from x where period=${b})
      select 'departed' k, count(*)::int n, coalesce(sum(p.amt),0)::float8 amt from p where p.student_id not in (select student_id from q)
      union all select 'new', count(*)::int, coalesce(sum(q.amt),0)::float8 from q where q.student_id not in (select student_id from p)
      union all select 'retained', count(*)::int, coalesce(sum(q.amt - p.amt),0)::float8 from p join q using (student_id)`;
    return [`${a}|${b}`, Object.fromEntries(rows.map(r => [r.k, [r.n, r.k === 'departed' ? -r.amt : r.amt]]))];
  }))));
} finally { await db.end(); }
const [src, v2] = await Promise.all([loadExitSource(), loadV2()]);
const asOf = '2026-10-27', ix = buildExitIndex(src, v2, { asOf });
const local = {};
for (const [a, b] of PAIRS) {
  const d = decompose(ix.monthly, a, b, { kindOf: sid => ix.exitOf(sid)?.kind || 'other', isNew: sid => (ix.studentById.get(sid)?.enrolled_at || '') >= `${a}-01`, subjectsOf: ix.subjectsOf, sessionsOf: ix.sessionsOf });
  assert.equal(d.check.exact, true, `${a}→${b} parts add up`);
  const got = Object.fromEntries(d.parts.map(p => [p.id, [p.students, p.amount]]));
  assert.deepEqual(got, sqlTotals[`${a}|${b}`], `${a}→${b} matches independent SQL`);
  local[`${a}|${b}`] = { totals: d.totals, parts: got, departedKinds: Object.fromEntries(Object.entries(d.parts[0].groups).map(([k, g]) => [k, g.students])), special: d.parts[2].groups.special.amount };
  log(`${a}→${b}`, local[`${a}|${b}`]);
}
const bulk = src.students.filter(s => !s.is_test && s.status === 'withdrawn' && v2.isCleanupExit(s.withdrawal_metadata));
log('bulk clean-ups', { total: bulk.length, byMonth: Object.fromEntries(Object.entries(Object.groupBy(bulk, s => ix.exitOf(s.id).month || '미상')).map(([m, l]) => [m, l.length]).sort()) });
// Reference values the main session measured on the 2026-10-27 14:34 copy (only meaningful on that copy).
if (src.students.length === 840) {
  assert.deepEqual(local['2026-07|2026-08'].parts, { departed: [47, -16865625], new: [14, 4734750], retained: [324, -12266650] });
  assert.deepEqual(local['2026-07|2026-08'].departedKinds, { withdrawn: 32, cleanup: 9, on_hold: 5, enrolled: 1, other: 0 });
  assert.equal(local['2026-07|2026-08'].special, -7510500);
  assert.deepEqual(local['2026-05|2026-10'].parts, { departed: [129, -45806650], new: [42, 15526000], retained: [291, 983063] });
  // The main session counted 153 by memo; 4 of them are test students (excluded everywhere), so the 2.0 rule gives 149.
  assert.equal(bulk.length, 149);
  assert.equal(src.students.filter(s => s.is_test && v2.isCleanupExit(s.withdrawal_metadata)).length, 4);
  log('reference (main, 10-27 copy)', 'match');
}

// B. Running server: same numbers over HTTP, GET only.
if (base) {
  const get = async path => { const r = await fetch(base + path, { headers: { Accept: 'application/json' } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  let index; for (let i = 0; i < 40; i += 1) { index = await get('/api/insight/exits'); if (index.status === 200) break; await new Promise(r => setTimeout(r, 1500)); }
  assert.equal(index.status, 200, 'index ready'); log('pairs', index.body.pairs);
  for (const [a, b] of PAIRS) {
    const v = await get(`/api/insight/exits?from=${a}&to=${b}`); assert.equal(v.status, 200);
    assert.deepEqual(Object.fromEntries(v.body.parts.map(p => [p.id, [p.students, p.amount]])), local[`${a}|${b}`].parts, `${a}→${b} over HTTP`);
    assert.equal(v.body.check.exact, true);
    log(`${a}→${b} analysis`, { status: v.body.analysis.status, jev: v.body.analysis.jev, claude: v.body.analysis.claude, clusters: v.body.clusters.length, aiClusters: v.body.clusters.filter(c => c.ai).length, students: v.body.students.length });
    for (const c of v.body.clusters.filter(c => c.ai)) for (const t of [c.ai.summary, ...c.ai.chain.map(s => s.text)]) assert(!/[A-Za-z]-[0-9a-f]{8}/.test(t), 'no pseudonym left in rendered text');
  }
  for (const [path, status] of [['/api/insight/exits?from=2026-08&to=2026-07', 400], ['/api/insight/exits?from=2026-07', 400]]) assert.equal((await get(path)).status, status);
  assert.equal((await fetch(`${base}/api/insight/exits`, { method: 'POST' })).status, 405);
}

// C. Isolated browser: entry → dialog → bars/popover → student file; phone width; no POST, no page errors.
if (browserOn) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) posts.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  page.setDefaultTimeout(15000);
  await mkdir('work/owner-concept/exit-insight', { recursive: true });
  try {
    await page.goto(base); await page.evaluate(() => document.fonts.ready);
    const entries = await page.locator('main .xi-entry').count(); assert(entries >= 1, 'first screen has a "왜 줄었나" entry'); log('first-screen entries', entries);
    await page.locator('main .xi-entry').first().click();
    await page.locator('#modal .xi-bars').waitFor();
    const counts = await page.evaluate(() => ({ bars: document.querySelectorAll('#modal .xi-bar').length, clusters: document.querySelectorAll('#modal .xi-cluster').length, students: document.querySelectorAll('#modal .xi-student').length, title: document.querySelector('#modal h2').textContent }));
    log('dialog', counts); assert(counts.bars > 5 && counts.clusters > 0 && counts.students > 0);
    await page.locator('#modal .xi-bar').nth(1).hover(); await page.locator('#chart-tip:not([hidden])').waitFor();
    log('popover', await page.locator('#chart-tip').innerText());
    await page.locator('#modal .xi-bars').focus(); await page.keyboard.press('ArrowDown'); assert(await page.locator('#chart-tip:not([hidden])').count(), 'keyboard moves the popover');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#modal').isVisible(), true, 'Escape closes the popover, not the dialog');
    await page.locator('#modal [data-xi="filter"][data-filter="departed.withdrawn"]').click(); await page.waitForTimeout(1200);
    const shown = await page.locator('#modal .xi-student:not([hidden])').count(); log('filtered students (실제 퇴원)', shown);
    await page.locator('#modal .xi-student:not([hidden]) .xi-student-head').first().click();
    assert(await page.locator('#modal .xi-student-body:not([hidden]) .xi-facts li').count() > 2, 'case file facts visible');
    const opener = page.locator('#modal .xi-student-body:not([hidden]) [data-xi="record"]').first(); await opener.click(); await page.locator('#detail[open]').waitFor(); log('record opened', await page.locator('#detail h2').innerText());
    await page.evaluate(() => document.getElementById('detail').close());
    await page.screenshot({ path: 'work/owner-concept/exit-insight/dialog-1440.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const phone = await page.evaluate(() => { const m = document.querySelector('#modal'), b = m.querySelector('.live-detail-body'); const wide = [...m.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > innerWidth + 1).map(n => n.className).slice(0, 5); return { viewport: innerWidth, dialog: Math.round(m.getBoundingClientRect().width), scroll: b.scrollWidth - b.clientWidth, wide }; });
    log('phone 390', phone); assert(phone.scroll <= 1 && !phone.wide.length, 'no horizontal overflow at 390px');
    await page.screenshot({ path: 'work/owner-concept/exit-insight/dialog-390.png', animations: 'disabled' });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    const pageWide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(pageWide <= 1, 'page has no horizontal overflow at 390px');
    await page.evaluate(() => { location.hash = 'finance'; }); await page.waitForTimeout(500); log('finance entries', await page.locator('main .xi-entry').count());
    assert.deepEqual(errors, [], 'no page errors'); assert.deepEqual(posts, [], 'no POST/PUT/DELETE');
    log('browser', 'ok');
  } finally { await browser.close(); }
}
await mkdir('work/owner-concept/exit-insight', { recursive: true });
await writeFile('work/owner-concept/exit-insight/live-check.json', JSON.stringify({ at: new Date().toISOString(), base: base || null, out }, null, 1));
console.log('LIVE CHECK PASSED');
