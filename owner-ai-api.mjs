import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { BridgeError, READER_SYSTEM_PROMPT, readerAnswerSchema } from './claude-bridge.mjs';
import { createAiReader, ReaderError } from './ai-reader.mjs';

const MODEL = 'claude-sonnet-5-5';
const KEY_FILE = 'D:/eywa_refactoring/.env.local';
const TOOLS = [
  { name: 'schema', description: '분석 가능한 표와 열, 2.0 지표 판정 원칙을 조회합니다.', input_schema: {
    type: 'object', properties: { table: { type: 'string' }, search: { type: 'string' } }, additionalProperties: false } },
  { name: 'query', description: 'Docker 연습 복사본에서 SQL 한 문장을 읽기 전용으로 실행합니다. 최대 10초, 200행입니다.', input_schema: {
    type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'], additionalProperties: false } },
];

export function ownerAiTransport(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) ? 'subscription' : 'api';
  } catch { return 'api'; }
}

export function selectOwnerApiKey(values, group = 'briefing') {
  for (const name of [`ANTHROPIC_API_KEY_${group.toUpperCase()}`, 'ANTHROPIC_API_KEY']) {
    const value = values[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function loadOwnerApiKey({ envFile = KEY_FILE, env = process.env } = {}) {
  const contents = await readFile(envFile, 'utf8').catch(() => '');
  return selectOwnerApiKey({ ...env, ...parse(contents) });
}

function apiSchema(value) {
  if (Array.isArray(value)) return value.map(apiSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum'].includes(key))
    .map(([key, item]) => [key, apiSchema(item)]));
}

const failed = (code = 'api_failed', status = 502) => new BridgeError(code, status, 'AI 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');

export function createOwnerApiProvider({ apiKey, client = null, readerFactory = () => createAiReader(), now = Date.now } = {}) {
  if (!apiKey && !client) return null;
  const anthropic = client || new Anthropic({ apiKey, maxRetries: 0 });
  async function complete({ system, input, schema, effort = 'low', timeoutMs = 90_000, tools = false, signal }) {
    const started = now();
    const messages = [{ role: 'user', content: input }];
    const reader = tools ? await readerFactory() : null;
    try {
      for (let turn = 0; turn < 13; turn += 1) {
        const response = await anthropic.messages.create({ model: MODEL, max_tokens: tools ? 4096 : 2048,
          system, messages, output_config: { effort, format: { type: 'json_schema', schema: apiSchema(schema) } },
          ...(tools ? { tools: TOOLS } : {}) }, { signal, timeout: timeoutMs });
        const uses = response.content.filter(block => block.type === 'tool_use');
        if (!uses.length) {
          if (response.stop_reason !== 'end_turn') throw failed('invalid_output');
          const body = response.content.find(block => block.type === 'text')?.text;
          let output;
          try { output = JSON.parse(body); } catch { throw failed('invalid_output'); }
          if (!output || typeof output !== 'object' || Array.isArray(output)) throw failed('invalid_output');
          return { output, meta: { ms: now() - started, models: [response.model || MODEL] } };
        }
        if (!reader || turn === 12 || uses.length > 4) throw failed('tool_limit');
        messages.push({ role: 'assistant', content: response.content });
        const results = [];
        for (const use of uses) {
          let result, isError = false;
          try {
            if (use.name === 'schema') result = await reader.schema(use.input || {});
            else if (use.name === 'query' && typeof use.input?.sql === 'string') result = await reader.query(use.input.sql);
            else throw new ReaderError('tool', '조회 도구와 입력을 확인해 주세요.');
          } catch (error) {
            isError = true;
            result = { error: error instanceof ReaderError ? error.code : 'query', message: error instanceof ReaderError ? error.message : '조회하지 못했습니다.' };
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result), is_error: isError });
        }
        messages.push({ role: 'user', content: results });
      }
      throw failed('tool_limit');
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (signal?.aborted) throw failed('cancelled', 499);
      if (error?.status === 429) throw failed('rate_limited', 429);
      if (error?.status === 401 || error?.status === 403) throw failed('api_auth', 503);
      throw failed();
    } finally { await reader?.close(); }
  }
  return {
    askAssistant: ({ input, signal }) => complete({ system: READER_SYSTEM_PROMPT, input, schema: readerAnswerSchema(), tools: true, signal }),
    async ask({ schema, prompt, input, effort = 'low', timeoutMs }, { signal } = {}) {
      const result = await complete({ system: prompt, input: JSON.stringify(input), schema, effort, timeoutMs, signal });
      return { output: result.output, model: result.meta.models[0], elapsedMs: result.meta.ms };
    },
  };
}
