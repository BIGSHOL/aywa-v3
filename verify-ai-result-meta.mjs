import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const window = {};
runInNewContext(await readFile(new URL('./ai-result-meta.js', import.meta.url), 'utf8'), { window, Intl, Date });
const line = window.AIResultMeta.text({ model: 'Claude Sonnet 5.5', at: '2026-10-30T04:00:00Z', basis: '과목별 · 기준일 2026-10-27' });
assert.match(line, /^Claude Sonnet 5\.5 · .* · 기준: 과목별 · 기준일 2026-10-27$/);
assert.match(line, /2026\. 10\. 30\./);
assert.match(window.AIResultMeta.time('2026-10-27T05:34:06Z'), /2026\. 10\. 27\./);
assert.equal(window.AIResultMeta.html({ model: '<AI>', at: null, basis: '<이슈>' }).includes('<AI>'), false);
assert.match(window.AIResultMeta.html({ model: '<AI>', at: null, basis: '<이슈>' }), /&lt;AI&gt;.*만든 시각 확인 필요.*&lt;이슈&gt;/);
console.log('AI 결과 공통 머리 줄 4/4');
