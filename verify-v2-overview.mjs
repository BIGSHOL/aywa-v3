import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { importV2 } from './v2-bridge.mjs';
import { overviewPrograms } from './v2-overview-program.mjs';

const sandbox = { window: {}, URLSearchParams, location: { hash: '' } };
runInNewContext(await readFile(new URL('./v2-screens.js', import.meta.url), 'utf8'), sandbox);
const html = sandbox.window.V2Screens.renderOverview({
  title: '상담 현황', purpose: '월간 상담 이행을 살핍니다.',
  path: [{ label: '전체', href: '#v2-consultations' }, { label: 'EiE' }],
  columns: [{ key: 'name', label: '강사' }, { key: 'rate', label: '이행률' }],
  rows: [{ group: 'EiE', href: '#v2-consultations?program=eie', cells: { name: '<강사>', rate: { text: '50%', tone: 'low' } }, action: { kind: 'guide', key: 'a', label: '지도 요청' } }],
  filters: [{ label: '기간', options: [{ label: '이번 달', current: true, href: '#v2-consultations' }] }],
});
assert.match(html, /월간 상담 이행/);
assert.match(html, /&lt;강사&gt;/);
assert.match(html, /data-v2-overview-action="guide"/);
assert.match(html, /scope="rowgroup"/);
assert.match(html, /aria-current="true"/);
const programs = await overviewPrograms(importV2, { operations: { subjects: [{ key: 'english', label: '영어' }, { key: 'math', label: '수학' }, { key: 'subject_1', label: '수학(심화)' }] }, modules: { disabled: [] } }, { isModuleEnabled: () => true });
assert.deepEqual(programs.order, ['eie', 'injaewon', 'math']);
assert.equal(programs.of({ subject: 'english', english_track: 'eie' }), 'eie');
assert.equal(programs.of({ subject: 'english', english_track: null }), 'injaewon');
assert.equal(programs.of({ subject: 'subject_1' }), 'math');
console.log('overview 공통 그리기·2.0 프로그램 판정 9/9');
