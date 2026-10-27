// 로컬 복사본 DB(127.0.0.1:5444)의 테이블별 행 수를 읽기 전용 트랜잭션으로 집계한다.
// 접속 정보는 local.json(기본 F:/aywa-dev/full-db/local.json, 환경변수 CATALOG_DB_CONFIG로 변경)에서 읽으며 출력하지 않는다.
// full-db.mjs와 같은 안전 조건(127.0.0.1:5444/aywa_full_snapshot만 허용)을 그대로 적용한다.
// 결과 = catalog/generated/db-availability.json (스키마·테이블·전체 행 수·침산(cs) 지점 행 수).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const tenantId = 'becaa316-e636-42e9-9d09-08b133e0b094';
const requireFromRepo = createRequire(new URL('../../../package.json', import.meta.url));
const postgres = requireFromRepo('postgres');
async function openFullDatabase() {
  const { url } = JSON.parse(await readFile(process.env.CATALOG_DB_CONFIG || 'F:/aywa-dev/full-db/local.json', 'utf8'));
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.port !== '5444' || target.pathname !== '/aywa_full_snapshot') throw new Error('Only the complete local Docker database is allowed');
  return postgres(url, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20, onnotice: () => {} });
}

const here = dirname(fileURLToPath(import.meta.url));
const sql = await openFullDatabase();
const ident = name => `"${String(name).replaceAll('"', '""')}"`;
try {
  const result = await sql.begin('isolation level repeatable read read only', async tx => {
    const tables = await tx`
      select c.table_schema as schema, c.table_name as name,
             bool_or(c.column_name = 'tenant_id') as has_tenant
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where t.table_type = 'BASE TABLE' and c.table_schema not in ('pg_catalog', 'information_schema')
      group by c.table_schema, c.table_name
      order by 1, 2`;
    const out = [];
    for (const t of tables) {
      const full = `${ident(t.schema)}.${ident(t.name)}`;
      const [{ n }] = await tx.unsafe(`select count(*)::bigint as n from ${full}`);
      let tenantRows = null;
      if (t.has_tenant) {
        const [{ m }] = await tx.unsafe(`select count(*)::bigint as m from ${full} where tenant_id::text = $1`, [tenantId]);
        tenantRows = Number(m);
      }
      out.push({ schema: t.schema, table: t.name, rows: Number(n), tenantScoped: t.has_tenant, csRows: tenantRows });
    }
    return out;
  });
  const total = result.reduce((n, r) => n + r.rows, 0);
  const doc = {
    readAt: new Date().toISOString(),
    database: 'aywa_full_snapshot (local Docker copy, read-only transaction)',
    tenant: { slug: 'cs', id: tenantId },
    totals: { tables: result.length, rows: total, schemas: [...new Set(result.map(r => r.schema))].length },
    tables: result,
  };
  mkdirSync(join(here, 'generated'), { recursive: true });
  writeFileSync(join(here, 'generated', 'db-availability.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(JSON.stringify(doc.totals));
} finally {
  await sql.end({ timeout: 5 });
}
