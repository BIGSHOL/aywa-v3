import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fullDbRoot } from './full-db-paths.mjs';

const DATABASES = Object.freeze({ snapshot: 'aywa_full_snapshot', sandbox: 'aywa_full_sandbox' });
export const ROW_LIMIT = 200;
export const STATEMENT_TIMEOUT_MS = 10_000;
const MAX_RESULT_BYTES = 1024 * 1024;

export class ReaderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function connectionUrl(target) {
  const database = DATABASES[target];
  if (!database) throw new ReaderError('target', '연습 복사본만 조회할 수 있습니다.');
  const file = JSON.parse(await readFile(new URL('ai-reader.json', fullDbRoot), 'utf8'));
  const url = new URL(file.url);
  if (url.hostname !== '127.0.0.1' || url.port !== '5444' || url.pathname !== '/aywa_full_snapshot' || url.username !== 'ai_reader') {
    throw new ReaderError('connection', 'AI 읽기 연결 설정이 올바르지 않습니다.');
  }
  url.pathname = `/${database}`;
  return url.href;
}

export async function createAiReader({ target = 'snapshot', url, timeoutMs = STATEMENT_TIMEOUT_MS } = {}) {
  const endpoint = url || await connectionUrl(target);
  const parsed = new URL(endpoint);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5444' ||
      parsed.pathname !== `/${DATABASES[target]}` || parsed.username !== 'ai_reader') {
    throw new ReaderError('connection', '연습 복사본의 AI 읽기 역할만 사용할 수 있습니다.');
  }
  const db = postgres(endpoint, { max: 1, prepare: true, connect_timeout: 5, idle_timeout: 5, onnotice: () => {} });
  return {
    async query(statement) {
      if (typeof statement !== 'string' || !statement.trim() || statement.length > 20_000 || statement.includes('\0')) {
        throw new ReaderError('statement', '조회 문장이 비어 있거나 너무 깁니다.');
      }
      const id = `Q-${createHash('sha256').update(statement).digest('hex').slice(0, 12)}`;
      try {
        return await db.begin(async tx => {
          await tx`SET TRANSACTION READ ONLY`;
          await tx`SELECT set_config('statement_timeout', ${`${timeoutMs}ms`}, true)`;
          await tx`SET LOCAL search_path = ai_access, pg_catalog`;
          const rows = [];
          let bytes = 0;
          const pending = tx.unsafe(statement, [], { prepare: true });
          const timer = setTimeout(() => pending.cancel(), timeoutMs);
          try {
            for await (const batch of pending.cursor(ROW_LIMIT + 1)) {
              for (const row of batch) {
                if (rows.length >= ROW_LIMIT) return { id, rows, truncated: true, rowCount: ROW_LIMIT };
                const encoded = JSON.stringify(row);
                bytes += Buffer.byteLength(encoded);
                if (bytes > MAX_RESULT_BYTES) return { id, rows, truncated: true, rowCount: rows.length, sizeLimited: true };
                rows.push({ row: rows.length + 1, values: row });
              }
            }
          } finally { clearTimeout(timer); }
          return { id, rows, truncated: false, rowCount: rows.length };
        });
      } catch (error) {
        if (error.code === '57014') throw new ReaderError('timeout', '조회 시간이 10초를 넘었습니다.');
        if (error.code === '42501') throw new ReaderError('permission', '허용되지 않은 표·열·함수입니다.');
        if (error.code === '42601' || error.code === '42P01' || error.code === '42703') throw new ReaderError('sql', '조회 문장 또는 표·열 이름을 확인해 주세요.');
        if (error instanceof ReaderError) throw error;
        throw new ReaderError('query', '조회하지 못했습니다. 문장과 연결 상태를 확인해 주세요.');
      }
    },
    async schema({ table = null, search = null } = {}) {
      if ((table && !/^[a-z][a-z0-9_]{0,80}$/.test(table)) || (search && !/^[a-z][a-z0-9_]{0,80}$/.test(search))) {
        throw new ReaderError('schema', '표 이름이나 검색어를 확인해 주세요.');
      }
      try {
        const views = table ? await db`
          SELECT table_name, column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'ai_access' AND table_name = ${table} ORDER BY ordinal_position`
          : search ? await db`
            SELECT table_name, column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'ai_access' AND (table_name LIKE ${`%${search}%`} OR column_name LIKE ${`%${search}%`})
            ORDER BY table_name, ordinal_position LIMIT 100`
            : await db`SELECT table_name FROM information_schema.views WHERE table_schema='ai_access' ORDER BY table_name`;
        return { views, rules: {
          scope: 'Docker 연습 복사본. 침산만 볼 때는 모든 업무표에 tenant_id=becaa316-e636-42e9-9d09-08b133e0b094 조건을 겁니다.',
          count: '재원생=2.0 countedOn(등록일·첫 수강 시작·퇴원일·장부 정리 청구 보정). 퇴원=퇴원 기록과 수강 종료를 구분. 휴원=재원 총원에서 제외. 신규 상담=enrollment_consultations 상담일, 등록=2.0 시작한 등록 판정. 화면의 2.0 함수 값이 정본이며 SQL과 다르면 차이를 밝힙니다.',
          evidence: '각 결과는 Q-번호와 행 번호를 결론의 근거로 인용합니다.',
          privacy: '급여 사람별 10만 원 반올림. 학생별 청구·수납 원 단위. 계좌·카드·토큰·인증 원본은 조회 불가.',
        } };
      } catch (error) { if (error instanceof ReaderError) throw error; throw new ReaderError('schema', '표 설명을 읽지 못했습니다.'); }
    },
    async close() { await db.end({ timeout: 1 }); },
  };
}
