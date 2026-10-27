// 서버 액션 export 하나하나의 본문 분석기(TS AST). 정규식으로 파일 전체를 훑는 scan-source와 달리
// export 함수 본문과, 그 본문이 부르는 저장소 안 도우미 함수(같은 파일·import한 모듈)를 따라가며 신호를 모은다.
// 신호마다 { file, line, via }를 남긴다 — via는 그 신호가 나온 함수 이름(export 자신이면 'self').
// 이것은 기계 판독이다(사람이 줄마다 읽었다는 뜻이 아니다). 사람의 검토 범위는 operation-groups.mjs가 따로 적는다.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const ts = require('typescript');
const SRC = join(repoRoot, 'src');
const rel = p => relative(repoRoot, p).split(sep).join('/');

// 내려가지 않고 이름만 신호로 남기는 기반 모듈 — 들어가면 모든 액션이 같은 인증·설정 조회로 뒤덮인다.
const STOP_MODULES = [
  /^src\/lib\/supabase\//, /^src\/lib\/auth\//, /^src\/features\/audit\/server\//, /^src\/features\/notifications\/server\//,
  /^src\/lib\/push\//, /^src\/lib\/ai\//, /^src\/features\/owner\/server\/queries\.ts$/, /^src\/lib\/observability\//,
  /^src\/lib\/db-errors?/, /^src\/lib\/date-kst/,
];
const MAX_DEPTH = 4;

const GATE_RE = /^(require[A-Z]\w*|assert[A-Z]\w*|ensure\w*(Access|Writer|Permission|Master|Owner|Admin)\w*|can[A-Z]\w*|gate[A-Z]?\w*|\w+Gate|getCurrentUser|getCurrentSuperAdmin|getParentViewer|getStudentViewer|isSuperAdmin|isMaster\w*|accessLevel\w*|menuAccess\w*|canAccess\w*|canWrite\w*|reportViewer|viewerFor\w*|authorize\w*|verify\w*(Cron|Secret|Token|Signature)\w*)$/;
// 외부 경계는 세 곳에서만 판정한다 — 기능 모듈 이름(classnote·slack 등)만으로는 정하지 않는다(순수 도우미가 많다).
// ① fetch(URL·파일 경로로 상대 시스템) ② 외부 SDK 패키지 호출 ③ 외부 경계 lib 모듈 호출.
const HTTP_RULES = [
  [/slack/i, 'Slack'], [/kakaomobility/i, '카카오 모빌리티'], [/notion/i, 'Notion'], [/ijw/i, 'IJW'],
  [/todays-math|connected-apps|targetBaseUrl/i, '오늘 수학'], [/googleapis|google/i, 'Google'], [/assemblyai/i, 'AssemblyAI'],
  [/classnote/i, 'ClassNote'], [/makeedu/i, 'makeedu'],
];
const PKG_RULES = [[/^googleapis$|^@googleapis\//, 'Google'], [/^solapi$/, '문자·알림톡'], [/^web-push$/, '웹 푸시'], [/^assemblyai$/, 'AssemblyAI'], [/^@slack\//, 'Slack']];
const BOUNDARY_MODULES = [[/^src\/lib\/ai\/assemblyai\.ts$/, 'AssemblyAI'], [/^src\/lib\/messaging\//, '문자·알림톡'], [/^src\/lib\/push\//, '웹 푸시']];
const labelBy = (rules, text) => (rules.find(([re]) => re.test(text)) || [null, null])[1];

// ── import 해석(@/ → src/) ──
const exts = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const e of exts) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

// ── RPC 읽기/쓰기 판정 = 마이그레이션의 마지막 함수 정의 본문 ──
let rpcIndex = null;
function rpcIsWrite(name) {
  if (!rpcIndex) {
    rpcIndex = new Map();
    const dir = join(repoRoot, 'supabase', 'migrations');
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
      const text = readFileSync(join(dir, f), 'utf8');
      const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
      for (const m of text.matchAll(re)) {
        const start = m.index;
        const open = text.slice(start).match(/\$([a-z_]*)\$/i);
        if (!open) continue;
        const bodyStart = start + open.index + open[0].length;
        const close = text.indexOf(open[0], bodyStart);
        const body = text.slice(bodyStart, close < 0 ? bodyStart + 20000 : close);
        const line = text.slice(0, start).split('\n').length;
        rpcIndex.set(m[1].toLowerCase(), { file: `supabase/migrations/${f}`, line, write: /\b(insert\s+into|update\s+(only\s+)?[a-z_."]+(\s+(as\s+)?\w+)?\s+set|delete\s+from|merge\s+into)\b/i.test(body) }); // 별칭은 AS 없이도 온다(update public.enrollments e set)
      }
    }
  }
  return rpcIndex.get(name.toLowerCase()) || null;
}

// ── 파일 색인 ──
const fileCache = new Map();
function indexFile(abs) {
  if (fileCache.has(abs)) return fileCache.get(abs);
  const text = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const fns = new Map();       // 이름 → 함수 노드(선언 또는 화살표)
  const imports = new Map();   // 지역 이름 → { spec, name }
  const reexports = new Map(); // export { a as b } from './x' → b → { spec, name }
  const consts = new Map();    // 최상위 문자열 상수 — .from(TABLE) 해석용
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) fns.set(st.name.text, st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.set(d.name.text, d.initializer);
        // cache(async (...) => ...) · withX(async ...)처럼 감싼 함수 — 인자로 넘긴 함수 본문을 그 이름의 본문으로 본다
        else if (ts.isIdentifier(d.name) && d.initializer && ts.isCallExpression(d.initializer)) {
          const inner = d.initializer.arguments.find(x => ts.isArrowFunction(x) || ts.isFunctionExpression(x));
          if (inner) fns.set(d.name.text, inner);
        }
        let init = d.initializer;
        while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
        if (ts.isIdentifier(d.name) && init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) consts.set(d.name.text, init.text);
      }
    } else if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
      const spec = st.moduleSpecifier.text;
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) imports.set(el.name.text, { spec, name: (el.propertyName || el.name).text });
      if (st.importClause.name) imports.set(st.importClause.name.text, { spec, name: 'default' });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) reexports.set(el.name.text, { spec: st.moduleSpecifier.text, name: (el.propertyName || el.name).text });
    }
  }
  const entry = { abs, rel: rel(abs), text, sf, fns, imports, reexports, consts };
  fileCache.set(abs, entry);
  return entry;
}

function locate(abs, name, hops = 0) {
  const f = indexFile(abs);
  if (f.fns.has(name)) return { file: f, node: f.fns.get(name) };
  if (hops < 3 && f.reexports.has(name)) {
    const r = f.reexports.get(name);
    const target = resolveImport(abs, r.spec);
    if (target) return locate(target, r.name, hops + 1);
  }
  return null;
}

const lineOf = (f, node) => f.sf.getLineAndCharacterOfPosition(node.getStart(f.sf)).line + 1;
const strArg = (call, i = 0) => {
  const a = call.arguments[i];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
};
const calleeName = call => {
  const ex = call.expression;
  if (ts.isIdentifier(ex)) return ex.text;
  if (ts.isPropertyAccessExpression(ex)) return ex.name.text;
  return null;
};
const isStop = relPath => STOP_MODULES.some(re => re.test(relPath));
/** 첫 인자를 소스에 적힌 그대로(따옴표 뺀 문자열, 또는 상수 이름) — 근거 줄의 확인 글자. */
const argText = (call, file) => { const a = call.arguments[0]; return a ? (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : a.getText(file.sf)) : ''; };
/** .from()·.rpc()의 첫 인자 — 문자열이거나, 같은 파일·import한 모듈의 문자열 상수. */
function nameArg(call, file) {
  const lit = strArg(call);
  if (lit) return lit;
  const a = call.arguments[0];
  if (!a || !ts.isIdentifier(a)) return null;
  if (file.consts.has(a.text)) return file.consts.get(a.text);
  const imp = file.imports.get(a.text);
  const target = imp && resolveImport(file.abs, imp.spec);
  return target ? indexFile(target).consts.get(imp.name) || null : null;
}

const fnMemo = new Map();
/** 함수 하나의 신호(자기 본문 + 내려간 도우미). 순환은 진행 중 표시로 끊는다. */
function analyzeFn(file, node, name, depth) {
  const key = `${file.rel}#${name}`;
  if (fnMemo.has(key)) return fnMemo.get(key);
  const out = { key, signals: [], helpers: new Set(), strings: [] };
  fnMemo.set(key, out); // 순환 방지(진행 중에도 같은 객체를 돌려준다)
  const add = (kind, value, n, extra = {}) => out.signals.push({ kind, value, file: file.rel, line: lineOf(file, n), via: name, ...extra });

  const cookieVars = new Set(); // const jar = await cookies()
  const visit = n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && /^await\s+cookies\(\)$/.test(n.initializer.getText(file.sf))) cookieVars.add(n.name.text);
    if (ts.isCallExpression(n)) {
      const cname = calleeName(n);
      const ex = n.expression;
      // .from('t') 사슬 / .storage.from('bucket')
      const target0 = (cname === 'from' || cname === 'rpc') ? nameArg(n, file) : null;
      if (cname === 'from' && ts.isPropertyAccessExpression(ex) && target0 && /^[a-z_][a-z0-9_-]*$/.test(target0)) {
        const isStorage = /\.storage$|^storage$/.test(ex.expression.getText(file.sf).replace(/\s+/g, ''));
        const methods = [];
        let cur = n;
        while (ts.isPropertyAccessExpression(cur.parent) && ts.isCallExpression(cur.parent.parent)) { methods.push(cur.parent.name.text); cur = cur.parent.parent; }
        if (isStorage) {
          const w = methods.find(m => ['upload', 'remove', 'move', 'copy', 'update'].includes(m));
          add(w ? 'storageWrite' : 'storageRead', target0, n.arguments[0], { methods, has: argText(n, file) });
        } else {
          const w = methods.find(m => ['insert', 'update', 'upsert', 'delete'].includes(m));
          add(w ? 'tableWrite' : 'tableRead', target0, n.arguments[0], { has: argText(n, file), ...(w ? { op: w } : {}) });
        }
      } else if (cname === 'rpc' && target0) {
        const info = rpcIsWrite(target0);
        add(info?.write ? 'rpcWrite' : 'rpcRead', target0, n.arguments[0], { has: argText(n, file), defined: info ? `${info.file}:${info.line}` : null });
      } else if (cname === 'logAction' || cname === 'logActionAs' || cname === 'logActionAtDoor') {
        const obj = n.arguments.find(a => ts.isObjectLiteralExpression(a));
        const act = obj?.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file.sf) === 'action');
        add('audit', act && ts.isStringLiteral(act.initializer) ? act.initializer.text : '(동적)', n);
      } else if (cname === 'notifyUsers' || cname === 'sendPushToUsers') {
        add(cname === 'notifyUsers' ? 'notify' : 'push', cname, n);
        // 알림 종류(type: "approval_requested" 등) — 인자 안 객체 리터럴의 type 속성
        n.arguments.forEach(function walk(c) {
          if (ts.isPropertyAssignment(c) && c.name.getText(file.sf) === 'type' && (ts.isStringLiteral(c.initializer) || ts.isNoSubstitutionTemplateLiteral(c.initializer))) add('notifyType', c.initializer.text, c);
          c.forEachChild(walk);
        });
      } else if (/UploadTicket$|^createSignedUploadUrl$/.test(cname || '')) {
        add('ticket', cname, n);
      } else if (/^generateJSONw*$/.test(cname || '')) {
        add('ai', cname, n);
      } else if (cname === 'fetch' && ts.isIdentifier(ex)) {
        const url = n.arguments[0] ? n.arguments[0].getText(file.sf).slice(0, 80) : '?';
        const opts = n.arguments[1];
        let method = opts ? '?' : 'GET';
        if (opts && ts.isObjectLiteralExpression(opts)) {
          const m = opts.properties.find(q => ts.isPropertyAssignment(q) && q.name.getText(file.sf) === 'method');
          method = m ? (ts.isStringLiteral(m.initializer) ? m.initializer.text.toUpperCase() : '?') : 'GET';
        }
        add('http', url, n, { method, system: labelBy(HTTP_RULES, url) || labelBy(HTTP_RULES, file.rel) || 'HTTP' });
      } else if (['revalidatePath', 'revalidateTag', 'updateTag'].includes(cname)) {
        add('cache', strArg(n) || n.arguments[0]?.getText(file.sf).slice(0, 60) || '?', n);
      } else if (cname === 'redirect' && ts.isIdentifier(ex)) {
        add('redirect', strArg(n) || n.arguments[0]?.getText(file.sf).slice(0, 60) || '?', n);
      } else if ((cname === 'set' || cname === 'delete') && ts.isPropertyAccessExpression(ex) && (/cookies\(\)/.test(ex.expression.getText(file.sf)) || (ts.isIdentifier(ex.expression) && cookieVars.has(ex.expression.text)))) {
        add('cookieWrite', argText(n, file) || '?', ex.name, { has: `${cname}(` });
      }
      // 외부 SDK 패키지 호출(google.sheets(...).spreadsheets.values.get 등) — 사슬의 뿌리가 패키지 import인지
      {
        let root = ex;
        while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
        if (ts.isIdentifier(root) && file.imports.has(root.text)) {
          const label = labelBy(PKG_RULES, file.imports.get(root.text).spec);
          if (label) add('external', label, n, { callee: cname || root.text, module: file.imports.get(root.text).spec });
        }
      }
      if (cname && GATE_RE.test(cname)) add('gate', cname, ts.isPropertyAccessExpression(ex) ? ex.name : ex, { args: n.arguments.map(a => (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null)).filter(Boolean) });

      // 도우미 따라가기
      if (ts.isIdentifier(ex) && depth < MAX_DEPTH) {
        const local = file.fns.get(ex.text);
        if (local && ex.text !== name) {
          out.helpers.add(`${file.rel}#${ex.text}`);
          merge(out, analyzeFn(file, local, ex.text, depth + 1));
        } else if (file.imports.has(ex.text)) {
          const imp = file.imports.get(ex.text);
          const target = resolveImport(file.abs, imp.spec);
          if (target) {
            const tr = rel(target);
            const boundary = labelBy(BOUNDARY_MODULES, tr);
            if (boundary) add('external', boundary, n, { callee: ex.text, module: tr });
            if (!isStop(tr)) {
              const hit = locate(target, imp.name);
              if (hit) {
                out.helpers.add(`${hit.file.rel}#${imp.name}`);
                merge(out, analyzeFn(hit.file, hit.node, imp.name, depth + 1));
              }
            }
          }
        }
      }
    } else if (ts.isThrowStatement(n) || ts.isReturnStatement(n)) {
      // 사용자에게 돌아가는 한국어 사유(거절·검증) — 사람이 동작을 읽는 단서로만 쓴다
      n.forEachChild(function walk(c) {
        if ((ts.isStringLiteral(c) || ts.isNoSubstitutionTemplateLiteral(c)) && /[가-힣]/.test(c.text) && out.strings.length < 6) out.strings.push({ text: c.text.slice(0, 90), line: lineOf(file, c), file: file.rel });
        c.forEachChild(walk);
      });
    }
    n.forEachChild(visit);
  };
  if (node.body) visit(node.body);
  return out;
}
function merge(into, from) {
  if (into === from) return;
  for (const s of from.signals) into.signals.push(s);
  for (const h of from.helpers) into.helpers.add(h);
}

const uniq = a => [...new Set(a)];
/** export 하나 분석 → 요약 레코드. */
export function analyzeExport(fileRel, name) {
  const abs = join(repoRoot, fileRel);
  const hit = locate(abs, name);
  if (!hit) return { found: false };
  const r = analyzeFn(hit.file, hit.node, name, 0);
  // 같은 신호가 여러 경로로 들어오므로 (kind,value,file,line)로 접는다
  const seen = new Set();
  const signals = r.signals.filter(s => { const k = `${s.kind}|${s.value}|${s.file}|${s.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const of = k => signals.filter(s => s.kind === k);
  const start = lineOf(hit.file, hit.node.parent && ts.isVariableDeclaration(hit.node.parent) ? hit.node.parent : hit.node);
  const end = hit.file.sf.getLineAndCharacterOfPosition(hit.node.getEnd()).line + 1;
  // 선언 바로 위 JSDoc 한 줄 요약
  const declNode = ts.isVariableDeclaration(hit.node.parent) ? hit.node.parent.parent.parent : hit.node;
  const doc = (ts.getJSDocCommentsAndTags(declNode) || []).map(d => (typeof d.comment === 'string' ? d.comment : '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    || (() => { const full = hit.file.text; const lead = ts.getLeadingCommentRanges(full, declNode.pos) || []; const c = lead.map(x => full.slice(x.pos, x.end)).join(' '); return c.replace(/\/\*\*?|\*\/|^\s*\*|\/\//gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); })();
  const writes = [...of('tableWrite'), ...of('rpcWrite'), ...of('storageWrite'), ...of('cookieWrite')];
  const reads = [...of('tableRead'), ...of('rpcRead'), ...of('storageRead')];
  return {
    found: true, file: hit.file.rel, line: start, endLine: end, bodyLines: end - start + 1, doc,
    gates: uniq(of('gate').map(s => s.value + (s.args?.length ? `(${s.args.join(',')})` : ''))),
    tablesWrite: uniq(of('tableWrite').map(s => s.value)).sort(),
    tablesRead: uniq(of('tableRead').map(s => s.value)).sort(),
    rpcsWrite: uniq(of('rpcWrite').map(s => s.value)).sort(),
    rpcsRead: uniq(of('rpcRead').map(s => s.value)).sort(),
    storage: uniq([...of('storageWrite').map(s => `${s.value}:쓰기`), ...of('storageRead').map(s => `${s.value}:읽기`)]).sort(),
    cookies: uniq(of('cookieWrite').map(s => s.value)),
    audit: uniq(of('audit').map(s => s.value)).sort(),
    uploadTicket: of('ticket').length > 0,
    notificationTypes: uniq(of('notifyType').map(s => s.value)).sort(),
    notifies: of('notify').length > 0, push: of('push').length > 0, ai: of('ai').length > 0,
    external: uniq([...of('external').map(s => s.value), ...of('http').map(s => s.system)]).sort(),
    externalCalls: uniq(of('external').map(s => `${s.value}:${s.callee}`)).sort(),
    http: uniq(of('http').map(s => `${s.system} ${s.method} ${s.value}`)),
    httpCalls: of('http').map(s => ({ system: s.system, method: s.method })),
    cache: of('cache').length, redirects: uniq(of('redirect').map(s => s.value)),
    helpers: [...r.helpers].sort(),
    messages: r.strings.map(s => s.text),
    evidence: {
      decl: { file: hit.file.rel, line: start, has: name },
      gate: of('gate')[0] ? { file: of('gate')[0].file, line: of('gate')[0].line, has: of('gate')[0].value } : null,
      write: writes[0] ? { file: writes[0].file, line: writes[0].line, has: writes[0].has ?? writes[0].value } : null,
      read: reads[0] ? { file: reads[0].file, line: reads[0].line, has: reads[0].has ?? reads[0].value } : null,
    },
    writes: writes.length > 0, reads: reads.length > 0,
  };
}

const SEND_RE = /send|post|push|create|update|delete|remove|upload|sync|enqueue|request|transcribe|submit|insert|write|apply|reply|react|edit|revoke|notify|share|invite|trigger|run|start|save|set|mark|link|import/i;
/** 2.0에서 일어나는 효과 목록 — db-write · audit-log(감사로그만) · storage-ticket(클라가 직접 올릴 서명 URL) · storage-write · cookie · notify · push · ai · external-send · external-read. */
export function effectsOf(a) {
  if (!a.found) return [];
  const fx = [];
  if (a.tablesWrite.length || a.rpcsWrite.length) fx.push('db-write');
  else if (a.audit.length) fx.push('audit-log');
  if (a.storage.some(s => s.endsWith(':쓰기'))) fx.push('storage-write');
  if (a.cookies.length) fx.push('cookie');
  if (a.uploadTicket) fx.push('storage-ticket');
  if (a.notifies) fx.push('notify');
  if (a.push) fx.push('push');
  if (a.ai) fx.push('ai');
  const ext = a.externalCalls.map(x => x.split(':'));
  const httpSend = a.httpCalls.some(h => h.method !== 'GET'), httpRead = a.httpCalls.some(h => h.method === 'GET');
  if (ext.some(([, c]) => SEND_RE.test(c)) || httpSend) fx.push('external-send');
  if (ext.some(([, c]) => !SEND_RE.test(c)) || httpRead) fx.push('external-read');
  return fx;
}
/** 종류: mutation(기록·쿠키·알림·외부 발신) · read(조회·AI 미리보기·외부 조회) · helper(DB·외부 없음 — 계산·이동·캐시 갱신). */
export function kindOf(a) {
  if (!a.found) return 'unknown';
  const fx = effectsOf(a);
  if (fx.some(x => ['db-write', 'audit-log', 'storage-write', 'cookie', 'notify', 'push', 'external-send'].includes(x))) return 'mutation';
  if (a.reads || fx.some(x => x !== 'storage-ticket')) return 'read';
  return 'helper'; // DB·외부 없음 — 계산·이동·캐시 갱신, 또는 서명 URL만 발급(storage-ticket)
}
