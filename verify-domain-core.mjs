// Offline checks for the workspaces helpers and the records endpoint (no DB, no network).
// Run: node --test experiments/owner-concept/verify-domain-core.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE, MASK, PRIORITY, assertWorkspaces, family, field, metric, monthlyTrend, record, scrub, setKnownContacts, signal } from './domain-snapshot-core.mjs';
import { queryRecords } from './domain-http.mjs';
import { FAMILY_IDS } from './domain-snapshot.mjs';
import { isBookkeepingOnlyExit, normalizeReason } from './domain-snapshot-students2.mjs';

test('masking hides contacts but keeps amounts, dates, ids and reference numbers', () => {
  setKnownContacts(['010-1234-5678', '110-222-333444', '홍길동, 김철수', '053 555 0101']);
  for (const keep of ['2026-10-27', '2026-10-01~2026-10-27', '130,266,625원', '329000', '88/100', '14:20~15:00', '9f7995b6-1b88-43cd-9b1d-5e552a64d2c1', '주문번호 2025-1234-56789', '교재 3권 22,500원', '초6-2 발전 2권 (22개정)', '2026년 10월 세션']) assert.equal(scrub(keep), keep, keep);
  assert.equal(scrub('입학 상담 홍길동 010-1234-5678'), `입학 상담 홍길동 ${MASK}`);
  assert.equal(scrub('김민준 0101234.5678 오후'), `김민준 ${MASK} 오후`);
  assert.equal(scrub('면담 10-27-010-1234-5678'), `면담 10-27-${MASK}`, 'glued date stays');
  assert.equal(scrub('중3010-1234-5678'), `중3${MASK}`, 'glued grade stays');
  assert.equal(scrub('환불 계좌 110-222-333444 확인'), `환불 계좌 ${MASK} 확인`, 'known account number');
  assert.equal(scrub('문의 053-555-0101'), `문의 ${MASK}`);
  assert.equal(scrub('메일 a.b+c@example.co.kr 로'), `메일 ${MASK} 로`);
  assert.equal(scrub('+82 10-9876-5432'), MASK);
  assert.equal(scrub('홍길동, 김철수 상담'), '홍길동, 김철수 상담', 'names are not contacts');
  assert.equal(scrub(null), null);
  assert.equal(record({ id: 'r1', label: '010-1111-2222', fields: [field('메모', 'x 010-1111-2222')] }).fields[0].value, `x ${MASK}`);
  setKnownContacts([]);
});

test('monthly trends start at real data and never invent or pass asOf', () => {
  assert.equal(monthlyTrend('t', '건', [], '2026-10-27'), null);
  const t = monthlyTrend('t', '건', [{ month: '2026-07', value: 5 }, { month: '2026-09', value: 2 }, { month: '2026-11', value: 9 }], '2026-10-27');
  assert.deepEqual(t.points, [{ date: '2026-07', value: 5 }, { date: '2026-08', value: 0 }, { date: '2026-09', value: 2 }, { date: '2026-10', value: 0 }]);
  assert.equal(t.granularity, 'month');
});

const ev = [record({ id: 'a', label: '가', facets: ['s:x', 'f'] }), record({ id: 'b', label: '나', facets: ['s:y'] }), record({ id: 'c', label: '다 010-0000-0000', facets: ['s:x'] })];
const fam = (id, part) => family(id, id, { summary: 's', coverageNote: 'n', recordSource: 'tbl', ...part });

test('facets come from the evidence; evidence never serializes', () => {
  const f = fam('billing', { evidence: ev, facetLabels: { 's:x': '엑스' } });
  assert.deepEqual(f.facets, [{ id: 's:x', label: '엑스', count: 2 }, { id: 'f', label: 'f', count: 1 }, { id: 's:y', label: 's:y', count: 1 }]);
  assert.equal(f.totalRecords, 3); assert.equal(f.dataState, 'available'); assert.equal(f[EVIDENCE].length, 3);
  assert(!JSON.stringify(f).includes('evidence')); assert.equal(JSON.parse(JSON.stringify(f)).records.length, 3);
  assert.equal(fam('help', {}).dataState, 'empty');
  assert.equal(fam('x', { evidence: Array.from({ length: 30 }, (_, i) => record({ id: `r${i}` })) }).records.length, 12);
});

test('contract checker rejects broken families', () => {
  const ok = () => Object.fromEntries(FAMILY_IDS.map(id => [id, fam(id, {})]));
  assert(assertWorkspaces({ asOf: '2026-10-27', families: ok() }, FAMILY_IDS));
  const breaks = {
    'missing family': w => { delete w.billing; },
    'unmapped id': w => { w.extra = fam('extra', {}); },
    'future trend': w => { w.billing = fam('billing', { evidence: ev, trend: { label: 't', unit: '건', granularity: 'month', points: [{ date: '2026-11', value: 1 }] } }); },
    'available without evidence': w => { w.billing = fam('billing', { dataState: 'available' }); },
    'records on empty': w => { w.billing = fam('billing', { evidence: ev, dataState: 'empty' }); },
    'signal outside evidence': w => { w.billing = fam('billing', { evidence: ev, signals: [signal({ id: 's', title: 't', summary: 's', priority: PRIORITY.check, source: 's', recordIds: ['zzz'], draft: { title: 't', body: 'b' } })] }); },
    'bad priority': w => { w.billing = fam('billing', { evidence: ev, signals: [signal({ id: 's', title: 't', summary: 's', priority: '긴급', source: 's', draft: { title: 't', body: 'b' } })] }); },
    'non-numeric metric': w => { w.billing.metrics = [{ label: 'x', value: '12', unit: '건', detail: '' }]; },
  };
  for (const [name, mutate] of Object.entries(breaks)) { const w = ok(); mutate(w); assert.throws(() => assertWorkspaces({ asOf: '2026-10-27', families: w }, FAMILY_IDS), undefined, name); }
  assert.equal(metric('x', '12', '건').value, 12); assert.equal(metric('x', 'abc', '건').value, null);
});

test('records endpoint: strict parameters, consistent facet counts, search and paging', () => {
  const f = fam('billing', { evidence: ev });
  const store = { families: new Map([['billing', { facets: f.facets, records: f[EVIDENCE] }], ['help', { facets: [], records: [] }]]) };
  const q = s => queryRecords(store, 'billing', new URLSearchParams(s));
  assert.equal(queryRecords(store, 'unknown-family', new URLSearchParams()).status, 404);
  for (const bad of ['x=1', 'page=0', 'page=-1', 'page=1.5', 'pageSize=0', 'pageSize=101', 'q=a&q=b', `q=${'가'.repeat(101)}`, 'facet=nope']) assert.equal(q(bad).status, 400, bad);
  assert.equal(queryRecords(null, 'billing', new URLSearchParams()).status, 503);
  const all = q('').body; assert.deepEqual([all.total, all.filteredTotal, all.page, all.pageSize, all.pageCount], [3, 3, 1, 20, 1]);
  assert.equal(q('facet=s:x').body.filteredTotal, 2);
  const searched = q(`q=${encodeURIComponent('나')}`); assert.deepEqual(searched.body.items.map(r => r.id), ['b']); assert.deepEqual(searched.body.facets.map(x => x.id), ['s:y'], 'facet counts follow the search');
  assert.equal(q(`q=${encodeURIComponent('010-0000')}`).body.filteredTotal, 0, 'masked text cannot be searched back');
  assert.deepEqual(q('page=2&pageSize=2').body.items.map(r => r.id), ['c']); assert.deepEqual(q('page=9&pageSize=2').body.items, []);
  assert.equal(queryRecords(store, 'help', new URLSearchParams()).body.total, 0);
});

test('withdrawal semantics follow 2.0 (reason aliases, bookkeeping-only exits)', () => {
  assert.equal(normalizeReason('dissatisfied'), 'dissatisfaction'); assert.equal(normalizeReason('반 이동'), 'other'); assert.equal(normalizeReason(null), null);
  assert.equal(isBookkeepingOnlyExit('other', '데이터 정리 일괄 퇴원', false), true);
  assert.equal(isBookkeepingOnlyExit(null, '수강 반 없음 일괄 퇴원 처리 (2026-07-10)', false), true);
  assert.equal(isBookkeepingOnlyExit('other', '데이터 정리 일괄 퇴원', true), false, 'has class history');
  assert.equal(isBookkeepingOnlyExit('relocation', '데이터 정리 일괄 퇴원', false), false, 'real reason');
});
