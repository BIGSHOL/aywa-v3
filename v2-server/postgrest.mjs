// 2.0 서버 함수를 복사본에서 그대로 돌리기 위한 Supabase 클라이언트 흉내(작업 스레드 전용 — v2-server-runner.mjs).
// 2.0 코드가 쓰는 PostgREST 모양만 받는다. 모르는 모양이 오면 조용히 다른 집합을 돌려주지 않고 **바로 던진다**(UnsupportedShape).
//  · 읽기 = from(t).select("a, b, alias:fk_col(…), table!fk_name(…), *", { count, head }) + eq · neq · gt · gte · lt · lte · like · ilike · is · in ·
//    not(col, op, v) · or("a.eq.x,b.is.null,and(…)") · filter(col, op, v) · match(obj) · order(col, { ascending, nullsFirst }) · range · limit ·
//    single · maybeSingle · returns · throwOnError
//  · 쓰기 = insert · update · upsert({ onConflict, ignoreDuplicates }) · delete (+ .select() = 돌려받기) · rpc(fn, args)
//  · PostgREST와 같게: 한 번에 최대 1000행(db-max-rows) · range는 offset/limit · 값은 JSON(to_jsonb — 숫자는 숫자 · 시각은 ISO 글자) ·
//    임베드는 FK로(둘 이상이면 PGRST201 · 없으면 PGRST200 — 2.0이 늘 FK 이름을 적는 이유) · 오류는 { data: null, error: { code, message, details, hint } }
//  · 신분: 세션 클라이언트 = 보는 사람(claims) + authenticated 역할(RLS가 2.0처럼 본다) · 관리자 클라이언트 = 복사본 접속 그대로(RLS 우회)
//  · 쿼리마다 저장점 — 실패해도 트랜잭션이 깨지지 않는다(PostgREST 요청 하나 = 문장 하나). 한 동작 안의 쿼리는 줄 세워 하나씩(한 연결 · 역할 전환이 섞이지 않게).
import { callStore, currentCall } from './context.mjs';

export const MAX_ROWS = 1000;
// 던질 때 그 동작에 표시도 남긴다 — 2.0 코드가 제 try/catch로 삼켜('못 불러옴'으로 바꿔) 넘어가도 작업 스레드가 동작 끝에 다시 던진다.
export class UnsupportedShape extends Error {
  constructor(what) { super(`2.0 조회 모양을 아직 흉내 내지 않습니다: ${what}`); this.code = 'V2_UNSUPPORTED'; const c = callStore.getStore(); if (c && !c.unsupported) c.unsupported = this; }
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name, what = '이름') => { if (!IDENT.test(name)) throw new UnsupportedShape(`${what} '${name}'`); return name; };
const aliasIdent = name => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UnsupportedShape(`임베드 별칭 '${name}'`); return name; };

// ── 표 정보(FK · 칸 형식) — 연결마다 한 번 ──────────────────────────────────────────────────────────────────────────────
let metaPromise = null;
async function meta(sql) {
  metaPromise ??= (async () => {
    const [fks, cols] = await Promise.all([
      sql`select c.conname, rel.relname tbl, ref.relname reftbl,
          array(select a.attname from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i)::text[] cols,
          array(select a.attname from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i)::text[] refcols
        from pg_constraint c join pg_class rel on rel.oid = c.conrelid join pg_class ref on ref.oid = c.confrelid
        join pg_namespace n on n.oid = rel.relnamespace join pg_namespace rn on rn.oid = ref.relnamespace
        where c.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'`,
      sql`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public'`,
    ]);
    const types = new Map();
    for (const c of cols) { const m = types.get(c.table_name) ?? new Map(); m.set(c.column_name, { type: c.data_type, udt: c.udt_name }); types.set(c.table_name, m); }
    return { fks, types };
  })().catch(e => { metaPromise = null; throw e; });
  return metaPromise;
}

// ── 고르기 글자 읽기 ───────────────────────────────────────────────────────────────────────────────────────────────────
function splitTop(text, sep = ',') {
  const out = []; let depth = 0, cur = '', quote = false;
  for (const ch of text) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (depth !== 0 || quote) throw new UnsupportedShape(`괄호가 맞지 않는 글자 '${text}'`);
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
/** "a, b::text, alias:col, alias:table!hint!inner(…), *" → 항목 목록. */
function parseSelect(text) {
  return splitTop(String(text ?? '*').replace(/\s+/g, ' ')).map(item => {
    const open = item.indexOf('(');
    if (open >= 0) {
      if (!item.endsWith(')')) throw new UnsupportedShape(`임베드 '${item}'`);
      const head = item.slice(0, open).trim(), inner = item.slice(open + 1, -1);
      const [alias, rest] = head.includes(':') ? head.split(':').map(s => s.trim()) : [null, head];
      const [name, ...hints] = rest.split('!').map(s => s.trim());
      const inner2 = hints.includes('inner'), left = hints.includes('left'), hint = hints.filter(h => h !== 'inner' && h !== 'left');
      if (hint.length > 1 || (left && inner2)) throw new UnsupportedShape(`임베드 힌트 '${head}'`);
      return { kind: 'embed', alias: alias ? aliasIdent(alias) : null, name: ident(name, '임베드'), hint: hint[0] ? ident(hint[0], '임베드 힌트') : null, inner: inner2, select: parseSelect(inner) };
    }
    if (item === '*') return { kind: 'star' };
    if (/\.\.\.|\(/.test(item)) throw new UnsupportedShape(`고르기 '${item}'`);
    // JSON 경로(PostgREST: `별칭:칸->열쇠->>열쇠` — `->` = json 값 · `->>` = 글자 · 숫자 열쇠 = 배열 자리 · 별칭이 없으면 이름 = 마지막 열쇠).
    const m = /^(?:([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)(?:::([a-z_][a-z0-9_ ]*(?:\[\])?))?$/.exec(item);
    if (!m) throw new UnsupportedShape(`고르기 '${item}'`);
    const path = [...m[3].matchAll(/(->>?)([A-Za-z0-9_]+)/g)].map(([, op, key]) => ({ text: op === '->>', key: /^\d+$/.test(key) ? Number(key) : key }));
    return { kind: 'col', alias: m[1] ?? (path.length ? String(path.at(-1).key) : null), col: m[2], cast: m[4] ?? null, path };
  });
}

// ── 임베드 관계 고르기(PostgREST와 같은 판정) ───────────────────────────────────────────────────────────────────────────
function relation(M, parent, e) {
  const fk = c => ({ name: c.conname, cols: c.cols, refcols: c.refcols });
  // ① 부모의 FK 칸 이름으로(`student:student_id(…)`) — 그 칸이 가리키는 표(many-to-one).
  const byCol = M.fks.filter(c => c.tbl === parent && c.cols.length === 1 && c.cols[0] === e.name);
  if (byCol.length === 1 && !e.hint) return { many: false, table: byCol[0].reftbl, ...fk(byCol[0]) };
  // ② 표 이름으로 — 부모 → 표(many-to-one) ∪ 표 → 부모(one-to-many). 힌트 = FK 이름 · 부모 칸 · 표 칸.
  let cands = [
    ...M.fks.filter(c => c.tbl === parent && c.reftbl === e.name).map(c => ({ many: false, table: e.name, ...fk(c), side: c.cols })),
    ...M.fks.filter(c => c.tbl === e.name && c.reftbl === parent).map(c => ({ many: true, table: e.name, ...fk(c), side: c.cols })),
  ];
  if (byCol.length === 1 && e.hint) cands = [{ many: false, table: byCol[0].reftbl, ...fk(byCol[0]), side: byCol[0].cols }].filter(c => c.table === e.hint || c.name === e.hint);
  if (e.hint && !(byCol.length === 1)) cands = cands.filter(c => c.name === e.hint || (c.side.length === 1 && c.side[0] === e.hint));
  if (cands.length === 0) throw Object.assign(new Error(`Could not find a relationship between '${parent}' and '${e.name}' in the schema cache`), { pgrst: 'PGRST200', status: 400 });
  if (cands.length > 1) throw Object.assign(new Error(`Could not embed because more than one relationship was found for '${parent}' and '${e.name}'`), { pgrst: 'PGRST201', status: 300 });
  return cands[0];
}

let aliasSeq = 0;
/** 한 줄 → jsonb 식(별칭 al의 표 table). 임베드는 상관 부분 조회로. 돌려주는 것: 식 + inner 조건들. */
function rowJson(sql, M, table, al, items, embedWheres = []) {
  const parts = [], inner = [], used = new Set();
  const cols = M.types.get(table);
  // 복사본에 없는 표 = PostgREST 오류 그대로(2.0 코드가 표 없음으로 읽고 폴백한다).
  if (!cols) throw Object.assign(new Error(`Could not find the table 'public.${table}' in the schema cache`), { pgrst: 'PGRST205', status: 404 });
  const pairs = [];
  for (const it of items) {
    if (it.kind === 'star') { parts.push(sql`to_jsonb(${sql(al)})`); continue; }
    if (it.kind === 'col') {
      if (!cols.has(it.col)) throw Object.assign(new Error(`column ${table}.${it.col} does not exist`), { code: '42703' });
      let base = sql`${sql(al)}.${sql(it.col)}`;
      for (const p of it.path ?? []) base = sql`(${base} ${sql.unsafe(p.text ? '->>' : '->')} ${typeof p.key === 'number' ? sql`${p.key}::int` : sql`${p.key}::text`})`;
      const expr = it.cast ? sql`(${base})::${sql.unsafe(it.cast)}` : base;
      pairs.push([it.alias ?? it.col, expr]); continue;
    }
    const r = relation(M, table, it), sub = `e${++aliasSeq}`, key0 = it.alias ?? it.name;
    const nested = embedWheres.filter(w => w.embed.startsWith(`${key0}.`)).map(w => ({ ...w, embed: w.embed.slice(key0.length + 1) }));
    const { expr: subExpr, inner: subInner, used: subUsed } = rowJson(sql, M, r.table, sub, it.select, nested);
    for (const w of nested) if (subUsed.has(w.embed)) used.add(`${key0}.${w.embed}`);
    const own = embedWheres.filter(w => w.embed === key0).map(w => w.build(sql, sub, c => M.types.get(r.table)?.get(c)?.udt ?? null));
    if (own.length) used.add(key0);
    // 부모 칸 ↔ 표 칸 짝 — many-to-one: 부모.cols = 표.refcols · one-to-many: 표.cols = 부모.refcols
    const on = r.many
      ? r.cols.map((c, i) => sql`${sql(sub)}.${sql(c)} = ${sql(al)}.${sql(r.refcols[i])}`)
      : r.cols.map((c, i) => sql`${sql(sub)}.${sql(r.refcols[i])} = ${sql(al)}.${sql(c)}`);
    const where = [...on, ...subInner, ...own].reduce((a, b) => sql`${a} and ${b}`);
    const key = it.alias ?? it.name;
    pairs.push([key, r.many
      ? sql`(select coalesce(jsonb_agg(${subExpr}), '[]'::jsonb) from public.${sql(r.table)} ${sql(sub)} where ${where})`
      : sql`(select ${subExpr} from public.${sql(r.table)} ${sql(sub)} where ${where} limit 1)`]);
    if (it.inner) inner.push(sql`exists (select 1 from public.${sql(r.table)} ${sql(sub)} where ${where})`);
  }
  // jsonb_build_object는 인자 100개까지 — 40쌍씩 나눠 잇는다.
  for (let i = 0; i < pairs.length; i += 40) {
    const chunk = pairs.slice(i, i + 40).flatMap(([k, v]) => [sql`${k}::text`, v]);
    parts.push(sql`jsonb_build_object(${chunk.reduce((a, b) => sql`${a}, ${b}`)})`);
  }
  const expr = parts.length === 0 ? sql`'{}'::jsonb` : parts.reduce((a, b) => sql`${a} || ${b}`);
  return { expr, inner, used };
}

// ── 거르기 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
const unquote = v => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);
const scalar = v => (v === null ? null : typeof v === 'object' ? (() => { throw new UnsupportedShape('객체 값으로 거르기'); })() : typeof v === 'boolean' || typeof v === 'number' ? v : String(v));
/** 거르기 칸 — 칸 이름 또는 JSON 경로(PostgREST `metadata->>newTeacherId` = 글자 · `data->k` = json 값). */
function colExpr(sql, al, col) {
  const m = /^([a-z_][a-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/.exec(col);
  if (!m) throw new UnsupportedShape(`칸 '${col}'`);
  let c = sql`${sql(al)}.${sql(m[1])}`;
  for (const [, op, key] of m[2].matchAll(/(->>?)([A-Za-z0-9_]+)/g)) c = sql`(${c} ${sql.unsafe(op)} ${/^\d+$/.test(key) ? sql`${Number(key)}::int` : sql`${key}::text`})`;
  return c;
}
function cond(sql, al, col, op, value, negate = false, typeOf = () => null) {
  const c = colExpr(sql, al, col);
  const udt = /->/.test(col) ? null : typeOf(col);
  const lit = v => (v !== null && castable(udt) ? typed(sql, String(v), udt) : v);
  let out;
  if (op === 'is') {
    const v = String(value).toLowerCase();
    if (!['null', 'true', 'false', 'unknown'].includes(v)) throw new UnsupportedShape(`is.${value}`);
    out = sql`${c} is ${sql.unsafe(v)}`;
  } else if (op === 'in') {
    const list = Array.isArray(value) ? value.map(scalar) : splitTop(String(value).replace(/^\(|\)$/g, '')).map(unquote);
    out = list.length === 0 ? sql`false` : castable(udt) ? sql`${c} in (${list.map(lit).reduce((a, b) => sql`${a}, ${b}`)})` : sql`${c} in ${sql(list)}`;
  } else if (op === 'like' || op === 'ilike') out = sql`${c} ${sql.unsafe(OPS[op])} ${String(value).replace(/\*/g, '%')}`;
  else if (OPS[op]) out = value === null ? sql`${c} ${sql.unsafe(OPS[op])} null` : sql`${c} ${sql.unsafe(OPS[op])} ${lit(scalar(value))}`;
  else if (op === 'cs' || op === 'cd' || op === 'ov') {
    if (udt === 'jsonb' && (op === 'cs' || op === 'cd')) {
      // PostgREST의 jsonb 포함은 객체/배열 자체를 JSON으로 보낸다. String(value)는
      // '[object Object]'라는 JSON 문자열로 비교되어, 실제 근거가 있어도 0행이 된다.
      out = sql`${c} ${sql.unsafe(op === 'cs' ? '@>' : '<@')} ${sql.json(value)}::jsonb`;
    } else {
      const arr = Array.isArray(value) ? `{${value.map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}` : String(value);
      out = sql`${c} ${sql.unsafe(op === 'cs' ? '@>' : op === 'cd' ? '<@' : '&&')} ${arr}`;
    }
  } else throw new UnsupportedShape(`거르기 연산 '${op}'`);
  return negate ? sql`not (${out})` : out;
}
/** PostgREST 논리 글자 "a.eq.1,b.is.null,and(c.gt.2,d.lt.3)" → 조건(묶음 = or). */
function logic(sql, al, text, joiner = 'or', typeOf) {
  const parts = splitTop(text).map(p => {
    const m = /^(not\.)?(and|or)\((.*)\)$/s.exec(p);
    if (m) { const inner = logic(sql, al, m[3], m[2], typeOf); return m[1] ? sql`not (${inner})` : inner; }
    const seg = p.split('.');
    if (seg.length < 3) throw new UnsupportedShape(`논리 거르기 '${p}'`);
    const col = seg[0]; let i = 1, negate = false;
    if (seg[i] === 'not') { negate = true; i++; }
    const op = seg[i], value = unquote(seg.slice(i + 1).join('.'));
    return cond(sql, al, col, op, op === 'in' ? value : value, negate, typeOf);
  });
  // 🔴 묶음은 늘 괄호로 — 다른 거르기와 `and`로 이어질 때 `a and b or c`가 되면 or 한쪽만으로 행이 걸린다(지우기 하나가 57행에 걸렸다).
  return sql`(${parts.reduce((a, b) => sql`${a} ${sql.unsafe(joiner)} ${b}`)})`;
}

// 🔴 거르기·쓰기 값은 **글자로 보내고 서버에서 칸 형식으로 바꾼다**(PostgREST가 하는 일 그대로 — URL·JSON의 글자를 Postgres가 바꾼다).
//    postgres.js에 맡기면 서버가 추정한 형식의 직렬화기가 값을 바꾼다:
//     · 시각 = Date로 바꿔 밀리초로 자른다(…254636 → …254) → 2.0 낙관적 잠금(`.eq("updated_at", 읽은 값)`)이 늘 '변경됨'
//     · bool = 글자 'true'를 거짓으로 보낸다 → `.eq("is_active", true)`가 **비활성 행만** 돌려줬다(활성 133 → 46 · 출석부 청구 조회가 통째로 빔)
const castable = udt => typeof udt === 'string' && /^[a-z_][a-z0-9_]*$/.test(udt) && !udt.startsWith('_');
const typed = (sql, v, udt) => sql`(${v}::text)::${sql(udt)}`;

// ── 값 쓰기 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function cell(sql, M, table, col, v) {
  const t = M.types.get(table)?.get(col);
  if (!t) throw Object.assign(new Error(`Could not find the '${col}' column of '${table}' in the schema cache`), { pgrst: 'PGRST204', status: 400 });
  if (v === undefined) return null;
  if (v === null) return null;
  if (t.type === 'json' || t.type === 'jsonb') return sql.json(v);
  if (t.type === 'ARRAY') {
    if (!Array.isArray(v)) throw new UnsupportedShape(`배열 칸 ${table}.${col}에 배열이 아닌 값`);
    return `{${v.map(x => (x === null ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',')}}`;
  }
  if (typeof v === 'object' && !(v instanceof Date)) throw new UnsupportedShape(`객체 값을 ${table}.${col}(${t.type})에`);
  const text = v instanceof Date ? v.toISOString() : String(v);
  return castable(t.udt) ? typed(sql, text, t.udt) : typeof v === 'boolean' || typeof v === 'number' ? v : text;
}

// ── 실행 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const toError = e => (e?.pgrst ? { code: e.pgrst, message: e.message, details: null, hint: null }
  : { code: e?.code ?? null, message: e?.message ?? String(e), details: e?.detail ?? null, hint: e?.hint ?? null });
/** 읽기 동작의 역할 전환 — 쿼리마다 되돌리지 않고 바뀔 때만 한 문장(쿼리당 왕복 8 → 3). 트랜잭션이 끝나면 저절로 풀린다.
 *  저장점 밖에서 바꾸므로 쿼리가 실패해 저장점을 되돌려도 역할은 그대로다. */
async function useRole(call, kind) {
  const role = kind !== 'user' ? 'none' : call.actor ? 'authenticated' : 'anon';
  if ((call.role ?? 'none') === role) return;
  const sql = call.sql;
  call.outerClaims ??= (await sql`select coalesce(current_setting('request.jwt.claims', true), '') c`)[0].c;
  const claims = role === 'none' ? call.outerClaims : JSON.stringify(call.actor ? { sub: call.actor.id, role: 'authenticated' } : { role: 'anon' });
  await sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', ${role}, true)`;
  call.role = role;
}
/** 그 동작의 줄 — 한 연결에서 하나씩. kind = 'user'(보는 사람 + authenticated) | 'admin'. 실패는 저장점째 되돌린다. */
function enqueue(kind, fn) {
  const call = currentCall();
  const run = call.stickyRole ? async () => { await useRole(call, kind); return call.sql.savepoint(fn); } : () => call.sql.savepoint(async s => {
    if (kind !== 'user') return fn(s);
    const [{ prev }] = await s`select coalesce(current_setting('request.jwt.claims', true), '') prev`;
    await s`select set_config('request.jwt.claims', ${JSON.stringify(call.actor ? { sub: call.actor.id, role: 'authenticated' } : { role: 'anon' })}, true)`;
    await s`set local role ${s.unsafe(call.actor ? 'authenticated' : 'anon')}`;
    // 실패하면 저장점이 되돌아가며 역할·신분도 함께 돌아간다(SET LOCAL은 저장점 단위) — 성공했을 때만 손으로 되돌린다.
    const out = await fn(s);
    await s`reset role`;
    await s`select set_config('request.jwt.claims', ${prev}, true)`;
    return out;
  });
  const p = call.queue.then(run, run);
  call.queue = p.catch(() => {});
  return p;
}

class Builder {
  constructor(client, table) {
    this.client = client; this.table = ident(table, '표'); this.op = 'select'; this.cols = '*'; this.countMode = null; this.head = false;
    this.wheres = []; this.orders = []; this.offset = 0; this.limitN = null; this.one = null; this.returning = null; this.payload = null; this.upsertOpts = null; this.rpcCall = null;
    this.throws = false;
  }
  select(cols = '*', opts = {}) {
    if (opts.count && opts.count !== 'exact') throw new UnsupportedShape(`count: ${opts.count}`);
    if (this.op === 'select') { this.cols = cols; this.countMode = opts.count ?? null; this.head = !!opts.head; }
    else this.returning = cols;
    return this;
  }
  insert(values, opts = {}) { if (opts.count) throw new UnsupportedShape('insert count'); this.op = 'insert'; this.payload = values; return this; }
  upsert(values, opts = {}) {
    if (opts.count) throw new UnsupportedShape('upsert count');
    this.op = 'upsert'; this.payload = values; this.upsertOpts = { onConflict: opts.onConflict ?? null, ignoreDuplicates: !!opts.ignoreDuplicates }; return this;
  }
  update(values, opts = {}) { if (opts.count) throw new UnsupportedShape('update count'); this.op = 'update'; this.payload = values; return this; }
  delete(opts = {}) { if (opts.count) throw new UnsupportedShape('delete count'); this.op = 'delete'; return this; }
  /** 거르기 하나 — 점 앞은 임베드 경로(`enrollments.classes.tenant_id`), 끝은 그 표의 칸. */
  #w(col, op, value, negate = false) {
    const dot = col.lastIndexOf('.');
    if (dot >= 0) {
      const key = col.slice(0, dot), rest = col.slice(dot + 1);
      for (const part of key.split('.')) aliasIdent(part);
      this.wheres.push({ embed: key, build: (sql, al, typeOf) => cond(sql, al, rest, op, value, negate, typeOf) });
    } else this.wheres.push({ embed: null, build: (sql, al, typeOf) => cond(sql, al, col, op, value, negate, typeOf) });
    return this;
  }
  eq(c, v) { return this.#w(c, 'eq', v); }
  neq(c, v) { return this.#w(c, 'neq', v); }
  gt(c, v) { return this.#w(c, 'gt', v); }
  gte(c, v) { return this.#w(c, 'gte', v); }
  lt(c, v) { return this.#w(c, 'lt', v); }
  lte(c, v) { return this.#w(c, 'lte', v); }
  like(c, v) { return this.#w(c, 'like', v); }
  ilike(c, v) { return this.#w(c, 'ilike', v); }
  is(c, v) { return this.#w(c, 'is', v === null ? 'null' : v); }
  in(c, list) { if (!Array.isArray(list)) throw new UnsupportedShape('in 값이 배열이 아님'); return this.#w(c, 'in', list); }
  contains(c, v) { return this.#w(c, 'cs', v); }
  containedBy(c, v) { return this.#w(c, 'cd', v); }
  overlaps(c, v) { return this.#w(c, 'ov', v); }
  not(c, op, v) { return this.#w(c, op, op === 'is' && v === null ? 'null' : v, true); }
  filter(c, op, v) { const neg = op.startsWith('not.'), o = neg ? op.slice(4) : op; return this.#w(c, o, o === 'in' ? String(v) : v, neg); }
  or(text, opts = {}) {
    if (opts.foreignTable || opts.referencedTable) throw new UnsupportedShape('임베드 표의 or');
    this.wheres.push({ embed: null, build: (sql, al, typeOf) => logic(sql, al, text, 'or', typeOf) }); return this;
  }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col, opts = {}) {
    if (opts.foreignTable || opts.referencedTable || col.includes('.') || col.includes('(')) throw new UnsupportedShape(`정렬 '${col}'`);
    this.orders.push({ col: ident(col, '정렬 칸'), asc: opts.ascending !== false, nulls: opts.nullsFirst === undefined ? null : opts.nullsFirst ? 'first' : 'last' });
    return this;
  }
  range(from, to, opts = {}) { if (opts.foreignTable || opts.referencedTable) throw new UnsupportedShape('임베드 range'); this.offset = from; this.limitN = to - from + 1; return this; }
  limit(n, opts = {}) { if (opts.foreignTable || opts.referencedTable) throw new UnsupportedShape('임베드 limit'); this.limitN = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  returns() { return this; }
  throwOnError() { this.throws = true; return this; }
  abortSignal() { return this; }
  csv() { throw new UnsupportedShape('csv'); }
  explain() { throw new UnsupportedShape('explain'); }
  then(resolve, reject) { return this.#exec().then(r => { if (this.throws && r.error) throw Object.assign(new Error(r.error.message), r.error); return r; }).then(resolve, reject); }

  async #exec() {
    const call = currentCall();
    try {
      return await enqueue(this.client.kind, async sql => {
        const M = await meta(call.metaSql ?? call.sql);
        if (this.op === 'select') return this.#select(sql, M);
        return this.#mutate(sql, M);
      });
    } catch (e) {
      if (e instanceof UnsupportedShape) throw e; // 흉내 밖 — 조용히 넘기지 않는다
      return { data: null, error: toError(e), count: null, status: e?.status ?? 400, statusText: '' };
    }
  }
  #source(sql) { return this.rpcCall ? this.rpcCall(sql) : sql`public.${sql(this.table)}`; }
  #where(sql, al, extra = [], typeOf) {
    const all = [...this.wheres.filter(w => !w.embed).map(w => w.build(sql, al, typeOf)), ...extra];
    return all.length ? sql`where ${all.reduce((a, b) => sql`${a} and ${b}`)}` : sql``;
  }
  async #select(sql, M) {
    const al = 't', table = this.rpcCall ? this.rpcTable : this.table;
    const items = parseSelect(this.cols);
    if (this.rpcCall && items.some(i => i.kind !== 'star' && i.kind !== 'col')) throw new UnsupportedShape('rpc 결과 임베드');
    const embedWheres = this.wheres.filter(w => w.embed);
    const { expr, inner, used } = this.rpcCall ? { expr: this.#rpcRowExpr(sql, al, items), inner: [], used: new Set() } : rowJson(sql, M, table, al, items, embedWheres);
    for (const w of embedWheres) if (!used.has(w.embed)) throw Object.assign(new Error(`'${w.embed}' is not an embedded resource in this request`), { pgrst: 'PGRST108', status: 400 });
    const where = this.#where(sql, al, inner, c => M.types.get(table)?.get(c)?.udt ?? null);
    let count = null;
    if (this.countMode === 'exact') count = Number((await sql`select count(*)::bigint n from ${this.#source(sql)} ${sql(al)} ${where}`)[0].n);
    if (this.head) return { data: null, error: null, count, status: 200, statusText: 'OK' };
    const order = this.orders.length ? sql`order by ${this.orders.map(o => sql`${sql(al)}.${sql(o.col)} ${sql.unsafe(o.asc ? 'asc' : 'desc')} ${o.nulls ? sql.unsafe(`nulls ${o.nulls}`) : sql``}`).reduce((a, b) => sql`${a}, ${b}`)}` : sql``;
    // db-max-rows = 1000 — 더 달라 해도 1000행에서 자른다(2.0 운영과 같은 절단).
    const lim = Math.min(this.limitN ?? MAX_ROWS, MAX_ROWS);
    const rows = await sql`select ${expr} j from ${this.#source(sql)} ${sql(al)} ${where} ${order} offset ${this.offset} limit ${lim}`;
    return this.#shape(rows.map(r => r.j), count);
  }
  #rpcRowExpr(sql, al, items) {
    if (items.length === 1 && items[0].kind === 'star') return sql`to_jsonb(${sql(al)})`;
    return sql`jsonb_build_object(${items.flatMap(i => { if (i.kind !== 'col') throw new UnsupportedShape('rpc 고르기'); return [sql`${i.alias ?? i.col}::text`, sql`${sql(al)}.${sql(i.col)}`]; }).reduce((a, b) => sql`${a}, ${b}`)})`;
  }
  #shape(list, count) {
    if (this.one) {
      if (list.length === 1) return { data: list[0], error: null, count, status: 200, statusText: 'OK' };
      if (list.length === 0 && this.one === 'maybe') return { data: null, error: null, count, status: 200, statusText: 'OK' };
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${list.length} rows`, hint: null }, count, status: 406, statusText: 'Not Acceptable' };
    }
    return { data: list, error: null, count, status: 200, statusText: 'OK' };
  }
  async #mutate(sql, M) {
    const call = currentCall(), al = 't', table = this.table;
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      if (rows.length === 0) return this.#shape([], null);
      const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].map(c => ident(c, '칸'));
      const values = rows.map(r => cols.map(c => cell(sql, M, table, c, r[c])));
      const valueList = values.map(v => sql`(${v.map(x => sql`${x}`).reduce((a, b) => sql`${a}, ${b}`)})`).reduce((a, b) => sql`${a}, ${b}`);
      let conflict = sql``;
      if (this.op === 'upsert') {
        const target = (this.upsertOpts.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean).map(c => ident(c, 'onConflict'));
        if (!target.length) throw new UnsupportedShape('onConflict 없는 upsert');
        const set = cols.filter(c => !target.includes(c));
        conflict = this.upsertOpts.ignoreDuplicates || set.length === 0
          ? sql`on conflict (${sql(target)}) do nothing`
          : sql`on conflict (${sql(target)}) do update set ${set.map(c => sql`${sql(c)} = excluded.${sql(c)}`).reduce((a, b) => sql`${a}, ${b}`)}`;
      }
      const ret = this.#returningExpr(sql, M, al);
      const out = await sql`insert into public.${sql(table)} as ${sql(al)} (${sql(cols)}) values ${valueList} ${conflict} ${ret ? sql`returning ${ret} j` : sql``}`;
      return ret ? this.#shape(out.map(r => r.j), null) : { data: null, error: null, count: null, status: 201, statusText: 'Created' };
    }
    if (this.wheres.some(w => w.embed)) throw new UnsupportedShape('쓰기에 임베드 거르기');
    const where = this.#where(sql, al, [], c => M.types.get(this.table)?.get(c)?.udt ?? null), ret = this.#returningExpr(sql, M, al);
    let out;
    if (this.op === 'update') {
      const entries = Object.entries(this.payload ?? {}).filter(([, v]) => v !== undefined);
      if (!entries.length) throw new UnsupportedShape('빈 update');
      const set = entries.map(([c, v]) => sql`${sql(ident(c, '칸'))} = ${cell(sql, M, table, c, v)}`).reduce((a, b) => sql`${a}, ${b}`);
      out = await sql`update public.${sql(table)} as ${sql(al)} set ${set} ${where} ${ret ? sql`returning ${ret} j` : sql``}`;
    } else if (this.op === 'delete') out = await sql`delete from public.${sql(table)} as ${sql(al)} ${where} ${ret ? sql`returning ${ret} j` : sql``}`;
    else throw new UnsupportedShape(this.op);
    void call;
    return ret ? this.#shape(out.map(r => r.j), null) : { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
  }
  #returningExpr(sql, M, al) {
    if (this.returning == null) return null;
    const items = parseSelect(this.returning);
    if (items.some(i => i.kind === 'embed')) throw new UnsupportedShape('돌려받기 임베드');
    return rowJson(sql, M, this.table, al, items).expr;
  }
}

/** rpc(fn, args) — 함수 모양(집합 · 결과 형식 · 인자 형식)은 pg_proc에서. 집합 결과는 표처럼 거르기·정렬·range를 받는다. */
let procCache = new Map();
async function procInfo(sql, fn) {
  if (procCache.has(fn)) return procCache.get(fn);
  const rows = await sql`select p.proretset retset, t.typtype rettyp, t.typname retname, coalesce(p.proargnames, '{}')::text[] names,
      coalesce(p.proargmodes::text[], '{}') modes, array(select format_type(x, null) from unnest(p.proargtypes) x)::text[] types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = ${fn}`;
  if (rows.length !== 1) throw new UnsupportedShape(`rpc '${fn}'(${rows.length === 0 ? '없음' : '여럿'})`);
  procCache.set(fn, rows[0]);
  return rows[0];
}

/** 파일 저장소가 없을 때 remove가 돌려주는 오류(Supabase storage 오류 모양). */
export const STORAGE_MISSING = Object.freeze({ message: '파일 저장소가 없습니다', statusCode: '503' });
class Client {
  constructor(kind) {
    this.kind = kind;
    this.auth = {
      getUser: async () => ({ data: { user: currentCall().actor ? { id: currentCall().actor.id, email: currentCall().actor.email } : null }, error: null }),
      getClaims: async () => ({ data: currentCall().actor ? { claims: { sub: currentCall().actor.id } } : null, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      admin: new Proxy({}, { get: (_, k) => { throw new UnsupportedShape(`auth.admin.${String(k)}`); } }),
    };
    // 파일 저장소 — 복사본엔 없다. remove 하나만 Supabase가 실패할 때의 모양({ data: null, error })을 돌려준다(던지지 않는다 — 팀장 결정 10-28):
    // 2.0 코드가 저장소 실패를 판단하는 그대로 흐르게(녹음 있는 회의록 삭제 등). upload · download · createSignedUrl … 나머지는 흉내 밖(던짐).
    this.storage = new Proxy({}, { get: (_, k) => {
      if (k !== 'from') throw new UnsupportedShape(`storage.${String(k)}`);
      return (bucket) => new Proxy({}, { get: (__, m) => {
        if (m !== 'remove') throw new UnsupportedShape(`storage.from(${String(bucket)}).${String(m)}`);
        return async (paths) => {
          if (!Array.isArray(paths)) throw new UnsupportedShape('storage remove 경로가 배열이 아님');
          return { data: null, error: STORAGE_MISSING };
        };
      } });
    } });
  }
  from(table) { return new Builder(this, table); }
  schema(s) { throw new UnsupportedShape(`schema(${s})`); }
  channel() { throw new UnsupportedShape('channel'); }
  rpc(fn, args = {}, opts = {}) {
    ident(fn, 'rpc');
    if (opts.head || opts.count || opts.get) throw new UnsupportedShape('rpc 옵션');
    const b = new Builder(this, 'invoices'); // 표 이름은 쓰지 않는다(아래에서 갈아 끼움)
    b.table = fn; b.rpcTable = fn;
    const call = currentCall();
    const argList = async sql => {
      const info = await procInfo(call.metaSql ?? call.sql, fn);
      const named = Object.entries(args ?? {}).map(([k, v]) => {
        const i = info.names.indexOf(ident(k, 'rpc 인자'));
        if (i < 0) throw Object.assign(new Error(`Could not find the function public.${fn}(${Object.keys(args).join(', ')}) in the schema cache`), { pgrst: 'PGRST202', status: 404 });
        const type = info.types[i] ?? 'text';
        const val = v === null || v === undefined ? null : type === 'jsonb' || type === 'json' ? sql.json(v)
          : type.endsWith('[]') ? `{${(Array.isArray(v) ? v : [v]).map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}` : typeof v === 'object' ? (() => { throw new UnsupportedShape(`rpc 인자 ${k} 객체`); })() : v;
        return sql`${sql(k)} => ${val}::${sql.unsafe(type)}`;
      });
      return { info, named };
    };
    // 집합 결과 = 표처럼(select · 거르기 · 정렬) · 하나짜리 = 값 그대로
    b.then = (resolve, reject) => (async () => {
      try {
        return await enqueue(this.kind, async sql => {
          const { info, named } = await argList(sql);
          const callExpr = named.length ? sql`public.${sql(fn)}(${named.reduce((a, x) => sql`${a}, ${x}`)})` : sql`public.${sql(fn)}()`;
          if (info.retset) {
            const items = parseSelect(b.cols), al = 'r';
            if (b.wheres.some(w => w.embed)) throw new UnsupportedShape('rpc 결과의 임베드 거르기');
            const where = b.wheres.length ? sql`where ${b.wheres.map(w => w.build(sql, al)).reduce((x, y) => sql`${x} and ${y}`)}` : sql``;
            const order = b.orders.length ? sql`order by ${b.orders.map(o => sql`${sql(al)}.${sql(o.col)} ${sql.unsafe(o.asc ? 'asc' : 'desc')}`).reduce((x, y) => sql`${x}, ${y}`)}` : sql``;
            const rowExpr = info.rettyp === 'c' || info.retname === 'record'
              ? (items.length === 1 && items[0].kind === 'star' ? sql`to_jsonb(${sql(al)})` : sql`jsonb_build_object(${items.flatMap(i => { if (i.kind !== 'col') throw new UnsupportedShape('rpc 고르기'); return [sql`${i.alias ?? i.col}::text`, sql`${sql(al)}.${sql(i.col)}`]; }).reduce((x, y) => sql`${x}, ${y}`)})`)
              : sql`to_jsonb(${sql(al)}.${sql(al)})`;
            const lim = Math.min(b.limitN ?? MAX_ROWS, MAX_ROWS);
            const rows = await sql`select ${rowExpr} j from ${callExpr} ${sql(al)} ${where} ${order} offset ${b.offset} limit ${lim}`;
            return { data: rows.map(r => r.j), error: null, count: null, status: 200, statusText: 'OK' };
          }
          if (b.wheres.length || b.orders.length) throw new UnsupportedShape('하나짜리 rpc 결과 거르기');
          const [row] = await sql`select to_jsonb(${callExpr}) j`;
          return { data: info.retname === 'void' ? null : row.j, error: null, count: null, status: 200, statusText: 'OK' };
        });
      } catch (e) {
        if (e instanceof UnsupportedShape) throw e;
        return { data: null, error: toError(e), count: null, status: e?.status ?? 400, statusText: '' };
      }
    })().then(r => { if (b.throws && r.error) throw Object.assign(new Error(r.error.message), r.error); return r; }).then(resolve, reject);
    return b;
  }
}

export const sessionClient = () => new Client('user');
export const adminClient = () => new Client('admin');
