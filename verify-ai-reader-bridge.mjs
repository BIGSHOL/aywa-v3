import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { claudeArgs, readerAnswerSchema, READER_SYSTEM_PROMPT } from './claude-bridge.mjs';
import { reconcileReaderEvidence } from './ai-reader-evidence.mjs';
import { buildInput } from './claude-bridge-prompt.mjs';
import { inspectTexts } from './exit-ai.mjs';

const plain = claudeArgs();
const enabled = claudeArgs({ aiReader: true });
assert.equal(plain[plain.indexOf('--tools') + 1], '');
assert.equal(enabled[enabled.indexOf('--tools') + 1], 'mcp__ai_reader__schema,mcp__ai_reader__query');
const config = JSON.parse(enabled[enabled.indexOf('--mcp-config') + 1]);
assert.deepEqual(Object.keys(config.mcpServers), ['ai_reader']);
assert.ok(readerAnswerSchema().properties.queries);
assert.ok(READER_SYSTEM_PROMPT.includes('사유 미기재'));
assert.ok(buildInput({ issues: {}, month: '2026-10' }, { prompt: '확인', history: [] }, 'test',
  { facts: { text: '[F1] 재원 3명', facts: [{ n: 1, text: '재원 3명' }] }, allowReader: true }).includes('ai_reader 조회 결과'));

const sql = 'select count(*)::int as 상담_건 from ai_access.enrollment_consultations';
const id = `Q-${createHash('sha256').update(sql).digest('hex').slice(0, 12)}`;
const output = { headline: '상담 증가', keyFacts: [], points: [{ text: '신규 상담 3건', refs: [], qrefs: [`${id}:1`] }],
  checks: [], table: null, links: [], issueIds: [], suggestedTask: null, queries: [{ id, sql }] };
const fake = { async query(s) { assert.equal(s, sql); return { id, rows: [{ row: 1, values: { 상담_건: 3 } }] }; } };
const result = await reconcileReaderEvidence(output, { facts: [] }, fake);
assert.equal(result.citedRows, 1);
assert.equal(result.output.points[0].refs.length, 1);
await assert.rejects(reconcileReaderEvidence({ ...output, points: [{ text: '신규 상담 4건', refs: [], qrefs: [`${id}:1`] }] }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
await assert.rejects(reconcileReaderEvidence({ ...output, headline: '인과를 확인할 수 없습니다' }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
await assert.rejects(reconcileReaderEvidence({ ...output, headline: '책임은 판단할 수 없습니다' }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
await assert.rejects(reconcileReaderEvidence({ ...output, checks: ['확인이 필요합니다'] }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
await assert.rejects(reconcileReaderEvidence({ ...output, suggestedTask: { title: '일부 항목 확인', body: '원장 확인', area: '', recordQueries: [] } }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
const madeUp = 'select 3 as 상담_건';
const madeUpId = `Q-${createHash('sha256').update(madeUp).digest('hex').slice(0, 12)}`;
await assert.rejects(reconcileReaderEvidence({ ...output, queries: [{ id: madeUpId, sql: madeUp }] }, { facts: [] }, fake),
  error => error.code === 'unverified_fact');
assert.ok(inspectTexts(['기록으로는 인과를 확인할 수 없습니다'], new Set()).issues.includes('banned_reason'));
console.log('AI 읽기 호출·근거 검사 8/8');
