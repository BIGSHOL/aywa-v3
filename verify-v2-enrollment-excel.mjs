// 2.0 공용 엑셀 창의 서식·미리보기·반영 경로를 Docker 복사본에서 대조한다.
// 반영은 작업 스레드 트랜잭션 안에서 되돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { createEnrollmentExcelRoute } from './v2-enrollment-excel.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';

const ENDPOINT = '/api/excel-import/enrollment-consultations';
const WORKER = new URL('./v2-server/v2-enrollment-excel-worker.mjs', import.meta.url);

async function rollbackApply(call) {
  const worker = new Worker(WORKER);
  try {
    return await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', resolve);
      worker.postMessage({ ...call, rollback: true });
    });
  } finally { await worker.terminate(); }
}

test('원본 엑셀 서식·미리보기·반영(롤백)과 권한 게이트', async (t) => {
  let db;
  try { db = await openFullDatabase(); await db`select 1`; }
  catch { t.skip('로컬 Docker 복사본을 열 수 없습니다'); return; }
  const route = createEnrollmentExcelRoute();
  const server = createServer((req, res) => {
    if (!route.handles(new URL(req.url, 'http://127.0.0.1').pathname)) { res.writeHead(404).end(); return; }
    route.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await db.end(); });
  const url = `http://127.0.0.1:${server.address().port}${ENDPOINT}`;
  const [master] = await db`select id::text id from public.users where tenant_id=${tenantId} and system_role::text='master' and status::text='active' limit 1`;
  assert.ok(master);
  const cookie = `v2-enrollment-actor=${master.id}`;

  const denied = await fetch(url);
  assert.equal(denied.status, 403);
  const [teacher] = await db`select id::text id from public.users where tenant_id=${tenantId} and system_role::text='teacher' and status::text='active' limit 1`;
  if (teacher) {
    const forbidden = await fetch(url, { headers: { Cookie: `v2-enrollment-actor=${teacher.id}` } });
    assert.equal(forbidden.status, 403, '원본 full 권한 게이트를 거쳐야 한다');
  }
  const blockedCrossSite = await fetch(url, { method: 'POST', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(blockedCrossSite.status, 403);
  const template = await fetch(url, { headers: { Cookie: cookie } });
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-type'), /spreadsheetml/);
  assert.match(template.headers.get('content-disposition'), /filename\*=UTF-8/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await template.arrayBuffer());
  const sheet = wb.getWorksheet('상담');
  assert.ok(sheet, '2.0 원본 서식의 상담 시트');
  const label = `엑셀롤백검증${Date.now()}`;
  sheet.getRow(2).getCell(1).value = '2026-10-29';
  sheet.getRow(2).getCell(3).value = label;
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const fd = new FormData();
  fd.set('file', new File([bytes], '검증.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  fd.set('mode', 'append');
  fd.set('dryRun', '1');
  const preview = await fetch(url, { method: 'POST', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' }, body: fd });
  assert.equal(preview.status, 200);
  const body = await preview.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.applied, false);
  assert.equal(body.issueTotal, 0);
  assert.equal(body.counts.reduce((sum, c) => sum + c.insert, 0), 1);

  const applied = await rollbackApply({ tenantId, actorId: master.id, operation: 'import', bytes, name: '검증.xlsx', mode: 'append' });
  assert.equal(applied.ok, true, applied.message);
  assert.equal(applied.result.body.applied, true);
  const [{ n }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${tenantId} and prospect_name=${label}`;
  assert.equal(n, 0, '반영 시험은 DB에 남지 않아야 한다');
});
