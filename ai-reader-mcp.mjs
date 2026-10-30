// Claude CLI용 단일 stdio MCP. stdout에는 JSON-RPC만 쓴다.
import { createInterface } from 'node:readline';
import { createAiReader, ReaderError } from './ai-reader.mjs';

const target = process.env.OWNER_CONCEPT_DB === 'sandbox' ? 'sandbox' : 'snapshot';
let reader;
const getReader = async () => reader ??= await createAiReader({ target });
const send = body => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...body })}\n`);
const tools = [
  { name: 'schema', description: '분석 가능한 표·열과 2.0 지표 판정 원칙을 조회합니다. 인수가 없으면 표 이름 목록, table을 주면 그 표의 열, search를 주면 관련 표·열을 돌려줍니다.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, search: { type: 'string' } }, additionalProperties: false } },
  { name: 'query', description: 'Docker 연습 복사본에 SQL 한 문장을 읽기 전용으로 실행합니다. 최대 10초, 200행이며 Q-번호와 행 번호를 근거로 돌려줍니다. 학생별 청구·수납은 원 단위, 직원별 급여는 10만 원 반올림입니다. 계좌·카드·토큰·인증 원본은 권한으로 차단됩니다.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string', maxLength: 20_000 } }, required: ['sql'], additionalProperties: false } },
];

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) return;
  const id = message.id;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    send({ id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'aywa-ai-reader', version: '1.0.0' } } });
    return;
  }
  if (message.method === 'ping') { send({ id, result: {} }); return; }
  if (message.method === 'tools/list') { send({ id, result: { tools } }); return; }
  if (message.method === 'tools/call') {
    try {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      const result = name === 'schema' ? await (await getReader()).schema(args)
        : name === 'query' && typeof args.sql === 'string' ? await (await getReader()).query(args.sql)
          : null;
      if (!result) throw new ReaderError('tool', '조회 도구와 입력을 확인해 주세요.');
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (error) {
      const code = error instanceof ReaderError ? error.code : 'tool';
      const message = error instanceof ReaderError ? error.message : '조회하지 못했습니다.';
      send({ id, result: { content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }], isError: true } });
    }
    return;
  }
  if (id !== undefined) send({ id, error: { code: -32601, message: '지원하지 않는 요청입니다.' } });
}

for await (const line of createInterface({ input: process.stdin })) {
  let message;
  try { message = JSON.parse(line); } catch { continue; }
  await handle(message);
}
if (reader) await reader.close();
