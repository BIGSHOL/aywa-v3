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
  if (SRC && parent.startsWith(SRC) && parent.endsWith('.ts')) {
    const base = specifier.startsWith('@/') ? new URL(specifier.slice(2), SRC)
      : specifier.startsWith('./') || specifier.startsWith('../') ? new URL(specifier, parent) : null;
    if (base && base.href.startsWith(SRC)) {
      for (const ext of ['.ts', '/index.ts']) {
        const url = new URL(base.href + ext);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (SRC && url.startsWith(SRC) && url.endsWith('.ts')) {
    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true, sourceMap: false },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return next(url, context);
}
