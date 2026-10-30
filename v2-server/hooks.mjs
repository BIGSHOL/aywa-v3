// 작업 스레드 전용 모듈 훅(v2-server-runner.mjs가 그 스레드에서만 register) — 4310 메인 스레드에는 걸리지 않는다.
//  · src/(2.0) 안의 .ts · .tsx를 저장소의 TypeScript로 메모리에서 변환(.tsx = react-jsx) · `@/` → src/ · 확장자 없는 상대 경로 → .ts/.tsx/index
//  · 2.0 서버 경계 모듈은 흉내(stubs/)로 갈아 끼운다 — **해석한 파일 경로로** 판정한다(`@/lib/supabase/server`든 `./server`든 같은 파일이면 같은 흉내).
//  · 바깥 패키지 'server-only' · 'next/*'도 흉내로. 그 밖(node_modules · node:)은 손대지 않는다.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let SRC = null, STUBS = null, ts = null;
/** 2.0 파일(src 기준) → 흉내 파일 이름. */
const FILE_STUBS = {
  'lib/supabase/server.ts': 'supabase-server.mjs', 'lib/supabase/admin.ts': 'supabase-admin.mjs', 'lib/supabase/client.ts': 'supabase-browser.mjs',
  'lib/auth/current-user.ts': 'current-user.mjs', 'features/audit/server/log.ts': 'audit-log.mjs',
  'features/slack/server/poke.ts': 'slack-poke.mjs',
  // 학원 설정(getTenantSettings) · 권한 표(perm-matrix) · 지점 보기 · 다른 강사 보기는 흉내 내지 않는다 — 2.0 코드 그대로 위 흉내 위에서 돈다.
};
const PKG_STUBS = { 'server-only': 'empty.mjs', 'next/cache': 'next-cache.mjs', 'next/headers': 'next-headers.mjs', 'next/navigation': 'next-navigation.mjs', 'next/server': 'next-server.mjs' };
export const STUBBED_FILES = Object.keys(FILE_STUBS), STUBBED_PACKAGES = Object.keys(PKG_STUBS);

export async function initialize({ src, stubs }) { SRC = src; STUBS = stubs; ts = (await import('typescript')).default; }

const isFile = p => existsSync(p) && statSync(p).isFile();
function resolveSrc(base) {
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) { const u = new URL(base + ext); if (/\.(ts|tsx|mjs|js|json)$/.test(u.pathname) && isFile(fileURLToPath(u))) return u.href; }
  return null;
}
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || '';
  const fromOurs = SRC && (parent.startsWith(SRC) || parent.startsWith(STUBS));
  if (fromOurs && Object.hasOwn(PKG_STUBS, specifier)) return { url: new URL(PKG_STUBS[specifier], STUBS).href, shortCircuit: true };
  if (fromOurs) {
    const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), SRC).href
      : (specifier.startsWith('./') || specifier.startsWith('../')) && parent.startsWith(SRC) ? new URL(specifier, parent).href : null;
    if (base && base.startsWith(SRC)) {
      const url = resolveSrc(base);
      if (url) {
        const rel = url.slice(SRC.length);
        // 흉내 파일이 진짜를 부를 때(`?v2real`)만 진짜 — 그 밖엔 흉내로.
        if (Object.hasOwn(FILE_STUBS, rel) && !parent.startsWith(STUBS)) return { url: new URL(FILE_STUBS[rel], STUBS).href, shortCircuit: true };
        return { url, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (SRC && url.startsWith(SRC) && /\.(ts|tsx)$/.test(new URL(url).pathname)) {
    const file = fileURLToPath(url), tsx = file.endsWith('.tsx');
    const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true, sourceMap: false, ...(tsx ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  if (SRC && url.startsWith(SRC) && /\.(css|png|svg|webp|woff2?)$/.test(new URL(url).pathname)) throw new Error(`2.0 서버 모듈이 자산 파일을 부릅니다: ${url.slice(SRC.length)}`);
  return next(url, context);
}
export { pathToFileURL };
