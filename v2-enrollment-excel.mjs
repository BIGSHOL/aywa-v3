// 신규 콜&상담의 2.0 공용 ExcelImportDialog가 부르는 GET 서식·POST 가져오기를
// 복사본 전용 작업 스레드의 원본 importer로 보낸다. 다른 종류는 받지 않는다.
import { Worker } from 'node:worker_threads';
import { appendFile } from 'node:fs/promises';
import { sandbox, tenantId } from './full-db.mjs';
import { fullDbRoot } from './full-db-paths.mjs';

const PATH = '/api/excel-import/enrollment-consultations';
const ACTOR_COOKIE = 'v2-enrollment-actor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_BODY = MAX_FILE + 64 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WORKER = new URL('./v2-server/v2-enrollment-excel-worker.mjs', import.meta.url);
export const EXCEL_JOURNAL = new URL(sandbox ? 'v2-writes-sandbox.jsonl' : 'v2-writes.jsonl', fullDbRoot);

function actorOf(req) {
  const raw = String(req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${ACTOR_COOKIE}=`));
  if (!raw) return null;
  try { const actor = decodeURIComponent(raw.slice(ACTOR_COOKIE.length + 1)); return UUID.test(actor) ? actor : null; }
  catch { return null; }
}
async function bodyOf(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too_large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function filenameHeader(name) {
  const clean = String(name).replace(/[\r\n"\\]/g, '').slice(0, 180);
  return `attachment; filename="document.xlsx"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
async function runExcel(call) {
  const worker = new Worker(WORKER);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 90_000);
      worker.once('message', (result) => { clearTimeout(timer); resolve(result); });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
      worker.once('exit', (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error(`worker_exit_${code}`)); } });
      worker.postMessage(call);
    });
  } finally { await worker.terminate(); }
}

export function createEnrollmentExcelRoute({ headers = {}, onWrite = null, journal = EXCEL_JOURNAL, run = runExcel } = {}) {
  const record = async (entry) => {
    if (!entry) return;
    try { await appendFile(journal, `${JSON.stringify(entry)}\n`); }
    catch (error) { console.error(`2.0 excel write journal failed: ${error?.code || 'error'}`); }
  };
  const send = (res, status, body) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  };
  return {
    handles: (path) => path === PATH,
    async handle(req, res) {
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return send(res, 403, { error: '이 화면에서만 요청할 수 있습니다' });
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return send(res, 405, { error: '지원하지 않는 요청입니다' });
      if (req.method === 'POST' && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, { error: '이 화면에서만 요청할 수 있습니다' });
      const actorId = actorOf(req);
      if (!actorId) return send(res, 403, { error: '가져오기를 할 직원을 선택해 주세요' });
      let call = { tenantId, actorId, operation: 'template' };
      let entry = null;
      if (req.method === 'POST') {
        if (!/^multipart\/form-data;\s*boundary=/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: '엑셀 파일을 선택해 주세요' });
        let fd;
        try {
          const body = await bodyOf(req);
          fd = await new Request('http://127.0.0.1/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
        } catch (e) { return send(res, e?.status === 413 ? 413 : 400, { error: e?.status === 413 ? '파일이 너무 큽니다(5MB까지)' : '파일을 받지 못했습니다' }); }
        const file = fd.get('file');
        if (!(file instanceof File)) return send(res, 400, { error: '엑셀 파일을 선택해 주세요' });
        if (file.size > MAX_FILE) return send(res, 400, { error: '파일이 너무 큽니다(5MB까지)', formatMismatch: true });
        const mode = String(fd.get('mode') ?? 'append');
        if (!['append', 'overwrite'].includes(mode)) return send(res, 400, { error: '반영 방식이 올바르지 않습니다' });
        call = { tenantId, actorId, operation: 'import', bytes: new Uint8Array(await file.arrayBuffer()), name: file.name.slice(0, 255), mode,
          dryRun: fd.get('dryRun') === '1', annotate: fd.get('annotate') === '1' };
        if (!call.dryRun && !call.annotate) entry = { at: new Date().toISOString(), screen: 'enrollment', action: 'excelImport',
          file: String(file.name).split(/[\\/]/).pop()?.slice(0, 180) || 'document.xlsx', mode, actor: actorId };
      }
      const started = Date.now();
      let result;
      try { result = await run(call); }
      catch (e) {
        await record(entry && { ...entry, counts: [], ok: false, result: 'worker_failed', ms: Date.now() - started });
        console.error(`enrollment excel worker: ${e?.message ?? e}`);
        return send(res, 500, { error: '엑셀 파일을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요' });
      }
      if (!result.ok) {
        await record(entry && { ...entry, counts: [], ok: false, result: result.code || 'failed', ms: Date.now() - started });
        console.error(`enrollment excel import: ${result.code} ${result.message}`);
        return send(res, result.code === 'outbound_blocked' ? 409 : 500, { error: '엑셀 파일을 반영하지 못했습니다. 바뀐 것은 없습니다' });
      }
      const out = result.result;
      if (out.kind === 'json') {
        const counts = Array.isArray(out.body?.counts) ? out.body.counts.map((c) => ({ label: c.label, total: c.total, insert: c.insert, update: c.update, skip: c.skip })) : [];
        await record(entry && { ...entry, counts, ok: out.body?.applied === true,
          result: out.body?.applied ? 'applied' : out.body?.error ? 'refused' : out.body?.issueTotal ? 'issues' : 'not_applied',
          status: out.status ?? 200, ms: Date.now() - started });
        if (out.body?.applied) try { onWrite?.({ screen: 'enrollment', action: 'excelImport' }); } catch {}
        return send(res, out.status ?? 200, out.body);
      }
      await record(entry && { ...entry, counts: [], ok: false, result: 'file', status: 200, ms: Date.now() - started });
      const bytes = Buffer.from(out.buf);
      res.writeHead(200, { ...headers, 'Content-Type': XLSX, 'Content-Disposition': filenameHeader(out.name), 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    },
  };
}
