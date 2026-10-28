// 2.0 부품 호스트(v2-host/, V2-SCREENS.md, 원장 10-28 "기존 2.0 뷰와 너무 다른데"): 4310이 2.0 React 부품 빌드 산출물
// (v2-host/dist — 3.0 화면 안의 같은 출처 iframe)과 그 부품이 쓰는 2.0 공개 사진(public/photos)을 내준다.
// Only these responses allow framing by this origin (frame-ancestors 'self'); every other response keeps 'none'.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST_DIST = path.join(HERE, 'v2-host', 'dist');
const PHOTOS = path.resolve(HERE, '../../public/photos');
const HOST_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const PHOTO_TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const inside = (dir, rel) => { const file = path.resolve(dir, rel); return file.startsWith(dir + path.sep) ? file : null; };

/** Builds v2-host/dist once when it is missing (about 8 s); a failed build is logged and the 2.0 screens show their own error. */
export async function ensureV2Host(log = console.error) {
  if (existsSync(path.join(HOST_DIST, 'timetable.html'))) return;
  try { const { build } = await import('./v2-host/build.mjs'); await build({ quiet: true }); }
  catch (error) { log(`2.0 host build failed: ${error.message}`); }
}

export function createV2HostRoute({ headers }) {
  const csp = headers['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
  const fail = (res, status) => { res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(status === 404 ? 'Not found' : 'Not allowed'); };
  return {
    handles: p => p.startsWith('/v2-host/') || p.startsWith('/photos/'),
    async handle(req, res, p) {
      if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405);
      if (req.headers['sec-fetch-site'] === 'cross-site') return fail(res, 403);
      let rel; try { rel = decodeURIComponent(p); } catch { return fail(res, 404); }
      if (/\.\.|\\|\0/.test(rel)) return fail(res, 404);
      const host = rel.startsWith('/v2-host/'), ext = path.extname(rel).toLowerCase(), type = (host ? HOST_TYPES : PHOTO_TYPES)[ext];
      const file = type && inside(host ? HOST_DIST : PHOTOS, rel.slice(host ? '/v2-host/'.length : '/photos/'.length));
      if (!file) return fail(res, 404);
      let body; try { body = await readFile(file); } catch { return fail(res, 404); }
      res.writeHead(200, { ...headers, ...(host ? { 'Content-Security-Policy': csp } : {}), 'Content-Type': type, 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    },
  };
}
