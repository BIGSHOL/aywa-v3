// Module hooks that let the local dev server import 2.0's pure TypeScript rules as they are (INSIGHT-EXITS.md
// "같은 원본"): only files under eywa src/ are touched — `@/` → src/, extensionless relative paths → .ts, and the
// .ts text is transpiled in memory with the repository's own TypeScript. Nothing is written to disk.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let SRC = null, ts = null;
export async function initialize({ src }) { SRC = src; ts = (await import('typescript')).default; }

export async function resolve(specifier, context, next) {
  const parent = context.parentURL || '';
  if (SRC && parent.startsWith(SRC) && /\.tsx?$/.test(parent)) {
    // 'server-only'는 표식 패키지(서버 밖에서 부르면 막는 용도) — 2.0 서버에서도 빈 모듈이다. 서버 실행 모듈(next/headers 등)은 흉내 내지 않는다.
    if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), SRC)
      : specifier.startsWith('./') || specifier.startsWith('../') ? new URL(specifier, parent) : null;
    if (base && base.href.startsWith(SRC)) {
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const url = new URL(base.href + ext);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (SRC && url.startsWith(SRC) && /\.tsx?$/.test(url)) {
    const file = fileURLToPath(url);
    // .tsx(예: settings-types.ts가 부르는 menu-glyph.tsx)는 JSX만 react/jsx-runtime으로 — 나머지 옵션은 .ts와 같다.
    const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true, sourceMap: false,
        ...(url.endsWith('.tsx') ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
