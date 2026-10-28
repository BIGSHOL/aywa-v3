// 2.0 서버 파일(server-only) 안의 **순수 함수**를 그대로 실행한다 — 손으로 베끼지 않는다(같은 데이터는 같은 원본).
// 2.0 expense-queries.ts의 summarizeExpenses · mapExpenseRow처럼 Supabase 조회와 한 파일에 사는 계산은 importV2로 부를 수 없다
// (파일 첫 줄이 `import "server-only"`). 그래서 그 파일을 TypeScript AST로 읽어 **이름을 댄 최상위 선언만** 골라 변환하고,
// 그 선언이 쓰는 바깥 이름(다른 2.0 순수 모듈의 export)은 deps로 넣어 Function으로 실행한다.
// 🔴 고른 선언 안에 Supabase·서버 호출이 있으면 멈춘다(순수 함수만 — 조회는 이 화면의 SQL이 한다).
import { readFile } from 'node:fs/promises';

const SRC = new URL('../../src/', import.meta.url);
let tsPromise = null;
const loadTs = () => (tsPromise ??= import('typescript').then(m => m.default ?? m));
const cache = new Map();
const SERVER = /\bcreateClient\b|\bcreateAdminClient\b|\bsupabase\b|\bawait\b|\bgetCurrentUser\b|\bfetch\(/;

/**
 * pureFrom('features/billing/server/expense-queries.ts', ['summarizeExpenses', …], { DEFAULT_CURRENCY, roundMoney })
 * → { summarizeExpenses, … }. 고른 이름이 파일에 없으면 · 빠진 바깥 이름이 있으면 · 서버 호출이 섞이면 던진다.
 */
export async function pureFrom(path, names, deps = {}) {
  const key = `${path}#${names.join(',')}#${Object.keys(deps).sort().join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const ts = await loadTs(), text = await readFile(new URL(path, SRC), 'utf8');
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const picked = [], found = new Set();
  for (const st of file.statements) {
    const declared = ts.isFunctionDeclaration(st) && st.name ? [st.name.text]
      : ts.isVariableStatement(st) ? st.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : [];
    if (declared.some(n => names.includes(n))) { picked.push(st.getFullText(file)); declared.forEach(n => found.add(n)); }
  }
  const missing = names.filter(n => !found.has(n));
  if (missing.length) throw new Error(`${path}: 2.0 선언이 없습니다 — ${missing.join(', ')}`);
  const body = picked.join('\n').replace(/^\s*export\s+/gm, '');
  if (SERVER.test(body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) throw new Error(`${path}: 고른 선언에 서버 호출이 섞여 있습니다`);
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, isolatedModules: true } }).outputText;
  // eslint-disable-next-line no-new-func -- 2.0 원문 선언을 그대로 실행(바깥 이름은 deps로만)
  const out = Object.freeze(new Function(...Object.keys(deps), `"use strict";\n${js}\nreturn { ${names.join(', ')} };`)(...Object.values(deps)));
  cache.set(key, out);
  return out;
}
