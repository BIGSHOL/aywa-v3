// 2.0 부품 호스트 빌드 (V2-SCREENS.md '그리는 방식 전환', 원장 2026-10-28 *"시간표가 기존 2.0 뷰와 너무 다른데"*).
// 2.0 src/의 실제 React 부품을 **고치지 않고** 묶어 3.0 안의 같은 출처 iframe(/v2-host/<화면>.html)으로 그린다.
//  · JS = esbuild(저장소 node_modules/.pnpm 안의 것): `@/` → src/, Next 전용 모듈 → shims/의 얇은 대체,
//    "use server" 모듈 → 자리표시(호출하면 '복사본 보기 전용' 거절 — 저장은 2단계에서 /api/v2/<화면>/<동작>으로).
//  · CSS = 2.0 src/app/globals.css를 Tailwind v4(@tailwindcss/postcss)로 그대로 컴파일 — 소스 스캔 기준은 저장소 루트(2.0 next build와 같다).
//  · 진입점은 자동 발견: src/<id>.tsx 중 `export const HOST_TITLE = '…'`가 있는 파일(산출 = dist/<id>.js·<id>.html).
//    그 화면의 2.0 주소는 `export const HOST_ROUTE = '/…'`(없으면 `/<id>`) — 부품이 그 주소로 이동하면 iframe 안에서 그 화면으로 간다.
//    다른 세션은 build.mjs를 고치지 않고 진입점 파일만 더한다(shims/·host-frame·host.css는 공용 — 더 필요하면 시간표 세션에 요청).
// 사용: `node experiments/owner-concept/v2-host/build.mjs` → dist/. 4310은 시작할 때 isBuilt()가 거짓이면 build()를 부른다.
import { readdir, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..'), SRC = path.join(ROOT, 'src'), PNPM = path.join(ROOT, 'node_modules/.pnpm');
export const DIST = path.join(HERE, 'dist');
const ENTRY_FILE = /^([a-z][a-z0-9-]{0,30})\.tsx$/, TITLE = /export\s+const\s+HOST_TITLE\s*=\s*(['"])(.+?)\1/, ROUTE = /export\s+const\s+HOST_ROUTE\s*=\s*(['"])(\/[a-z0-9/_-]*)\1/;
/** 진입점 찾기 — id → { title, route }. 같은 2.0 주소를 둘이 쓰면 빌드를 멈춘다(어느 화면으로 갈지 모른다). */
export async function discoverEntries() {
  const out = {}, routes = new Map();
  for (const name of (await readdir(path.join(HERE, 'src'))).sort()) {
    const m = ENTRY_FILE.exec(name); if (!m) continue;
    const text = await readFile(path.join(HERE, 'src', name), 'utf8'), title = TITLE.exec(text)?.[2];
    if (!title) continue;
    const route = ROUTE.exec(text)?.[2] ?? `/${m[1]}`;
    if (routes.has(route)) throw new Error(`2.0 주소 ${route}를 ${routes.get(route)}와 ${m[1]}가 함께 씁니다`);
    routes.set(route, m[1]); out[m[1]] = { title, route };
  }
  return out;
}
/** 4310 시작 점검 — 찾은 진입점이 모두 지어져 있는가(하나라도 없으면 build). */
export async function isBuilt(outdir = DIST) {
  const ids = Object.keys(await discoverEntries());
  return ids.length > 0 && ids.every(id => existsSync(path.join(outdir, `${id}.html`)));
}
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** .pnpm 안의 패키지(호이스트되지 않은 도구) — 같은 이름의 가장 높은 판. */
async function pnpmPackage(name) {
  const prefix = `${name.replace('/', '+')}@`, dirs = (await readdir(PNPM)).filter(d => d.startsWith(prefix));
  const ver = d => d.slice(prefix.length).split('_')[0].split('.').map(Number);
  dirs.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  if (!dirs.length) throw new Error(`${name}을(를) node_modules/.pnpm에서 찾지 못했습니다`);
  return path.join(PNPM, dirs[0], 'node_modules', name);
}

const SHIMS = { 'next/navigation': 'next-navigation.tsx', 'next/link': 'next-link.tsx', 'next/image': 'next-image.tsx', 'next/dynamic': 'next-dynamic.tsx', 'next/cache': 'next-cache.ts', 'server-only': 'server-only.ts' };
const USE_SERVER = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;

/** esbuild 플러그인 — 2.0 Next 앱이 빌드 때 해 주는 일(별칭·서버 액션 경계)을 같은 자리에서. */
function nextBoundary(report) {
  return {
    name: 'v2-next-boundary',
    setup(b) {
      // 브라우저 Supabase 클라이언트 = 접속 없는 대체(실시간 구독은 아무 일도 안 함 · 직접 조회는 오류) — 운영실 호스트 요청 10-28.
      b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: path.join(HERE, 'shims', 'supabase-client.ts') }));
      b.onResolve({ filter: /^@\// }, async a => b.resolve(`./${a.path.slice(2)}`, { resolveDir: SRC, kind: a.kind }));
      b.onResolve({ filter: /^(next\/(navigation|link|image|dynamic|cache)|server-only)$/ }, a => {
        if (a.path === 'server-only' || a.path === 'next/cache') report.serverOnly.add(path.relative(ROOT, a.importer));
        return { path: path.join(HERE, 'shims', SHIMS[a.path]) };
      });
      // "use server" 모듈은 브라우저에서 서버 함수 호출 자리표시로 바꾼다(2.0 Next가 RPC 자리표시로 바꾸는 것과 같은 경계).
      b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async a => {
        const text = await readFile(a.path, 'utf8');
        if (!USE_SERVER.test(text)) return undefined;
        const names = [...new Set([...text.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+)([A-Za-z_$][\w$]*)/g)].map(m => m[1]))];
        report.actions.add(path.relative(ROOT, a.path));
        const mod = path.relative(SRC, a.path).replaceAll('\\', '/');
        return { loader: 'ts', resolveDir: HERE, contents: `import { serverAction } from ${JSON.stringify(path.join(HERE, 'shims', 'server-action.ts').replaceAll('\\', '/'))};\n${names.map(n => `export const ${n} = serverAction(${JSON.stringify(mod)}, ${JSON.stringify(n)});`).join('\n')}\n` };
      });
    },
  };
}

async function buildCss(DIST) {
  const twDir = realpathSync(path.join(ROOT, 'node_modules/@tailwindcss/postcss'));
  const req = createRequire(path.join(twDir, 'package.json'));
  const postcss = (await import(pathToFileURL(req.resolve('postcss')).href)).default;
  const tailwind = (await import(pathToFileURL(req.resolve('@tailwindcss/postcss')).href)).default;
  const from = path.join(HERE, 'src', 'host.css');
  const out = await postcss([tailwind({ base: ROOT })]).process(await readFile(from, 'utf8'), { from, to: path.join(DIST, 'host.css') });
  await writeFile(path.join(DIST, 'host.css'), out.css);
  return out.css.length;
}

const page = (id, title) => `<!doctype html>
<html lang="ko" class="h-full antialiased" style="--font-pretendard:'Pretendard'">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title)}</title>
<link rel="preload" href="/fonts/PretendardVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="host.css"><link rel="stylesheet" href="${id}.css"></head>
<body class="bg-background text-foreground min-h-full font-sans"><div id="root"></div><script type="module" src="${id}.js"></script></body>
</html>
`;

/** outdir 기본 = dist/(4310이 내주는 곳). 다 만든 뒤에 바꿔 끼워, 도는 서버가 반쯤 지어진 폴더를 내주지 않게 한다. meta = esbuild 입력 목록(점검용, 파일 경로가 담겨 기본 끔). */
export async function build({ quiet = false, outdir = DIST, meta = false } = {}) {
  // 임시 폴더는 프로세스마다 따로 — 여러 세션이 동시에 지어도 서로의 반쯤 지은 폴더를 지우지 않는다.
  const final = outdir, tmp = `${outdir}.building-${process.pid}`;
  const esbuild = await import(pathToFileURL(path.join(await pnpmPackage('esbuild'), 'lib', 'main.js')).href);
  await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
  const DIST = tmp, entries = await discoverEntries();
  if (!Object.keys(entries).length) throw new Error('v2-host/src에 진입점(HOST_TITLE)이 없습니다');
  const report = { serverOnly: new Set(), actions: new Set() };
  const result = await esbuild.build({
    entryPoints: Object.keys(entries).map(id => ({ in: path.join(HERE, 'src', `${id}.tsx`), out: id })),
    outdir: DIST, bundle: true, format: 'esm', splitting: true, platform: 'browser', target: 'es2022', jsx: 'automatic',
    minify: true, sourcemap: false, metafile: true, logLevel: 'silent', nodePaths: [path.join(ROOT, 'node_modules')],
    loader: { '.module.css': 'local-css', '.css': 'css', '.woff2': 'file', '.png': 'file', '.webp': 'file', '.svg': 'file' },
    // 브라우저엔 process가 없다 — 2.0 부품이 읽는 process.env.*는 빈 값(설정 안 됨)으로. NODE_ENV만 운영 빌드 값.
    // __V2_HOST_ROUTES__ = 2.0 주소 → 호스트 화면(shims/host-nav.ts가 iframe 안 이동에 쓴다).
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}', __V2_HOST_ROUTES__: JSON.stringify(Object.fromEntries(Object.entries(entries).map(([id, e]) => [e.route, id]))) },
    plugins: [nextBoundary(report)],
  });
  if (meta) await writeFile(path.join(DIST, 'meta.json'), JSON.stringify(result.metafile));
  const cssBytes = await buildCss(DIST);
  for (const [id, e] of Object.entries(entries)) {
    await writeFile(path.join(DIST, `${id}.html`), page(id, e.title));
    if (!existsSync(path.join(DIST, `${id}.css`))) await writeFile(path.join(DIST, `${id}.css`), '');
  }
  await rm(final, { recursive: true, force: true }); await rename(tmp, final);
  const info = { outdir: final, entries, cssBytes, jsBytes: Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0), serverOnly: [...report.serverOnly], actions: [...report.actions], warnings: result.warnings.length };
  if (!quiet) console.log(JSON.stringify(info, null, 1));
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build({ meta: process.argv.includes('--meta') });
