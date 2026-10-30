import { createHash } from 'node:crypto';
import { BANNED_COPY, BANNED_REASON } from './ai-reader-cli.mjs';
import { unsupportedAnswerFacts } from './claude-bridge-facts.mjs';

const REF = /^Q-[0-9a-f]{12}:[1-9][0-9]{0,2}$/;
const fail = () => { const error = new Error('조회 근거를 확인하지 못했습니다.'); error.code = 'unverified_fact'; return error; };
function evidenceText(id, position, values) {
  const units = { won: '원', count: '건', people: '명', students: '명', sessions: '회', rate: '%' };
  const parts = Object.entries(values).map(([key, value]) => {
    const suffix = key.split('_').at(-1);
    const unit = units[suffix] || ({ 원: '원', 건: '건', 명: '명', 회: '회' })[suffix] || '';
    return `${key}: ${value instanceof Date ? value.toISOString().slice(0, 10) : value}${typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(value)) ? unit : ''}`;
  });
  return `조회 ${id} 행 ${position}: ${parts.join(' · ')}`;
}

export async function reconcileReaderEvidence(output, facts, reader) {
  const queries = output?.queries;
  if (!Array.isArray(queries) || queries.length > 6) throw fail();
  const byQuery = new Map();
  for (const q of queries) {
    if (!q || typeof q.sql !== 'string' || q.sql.length > 20_000 || !/\bai_access\.[a-z][a-z0-9_]*\b/i.test(q.sql) ||
        !/^Q-[0-9a-f]{12}$/.test(q.id || '') ||
        `Q-${createHash('sha256').update(q.sql).digest('hex').slice(0, 12)}` !== q.id || byQuery.has(q.id)) throw fail();
    byQuery.set(q.id, await reader.query(q.sql));
  }
  const nextFacts = [...(facts.facts || [])], refs = new Map();
  let n = Math.max(0, ...nextFacts.map(f => f.n || 0));
  const resolve = qref => {
    if (!REF.test(qref)) throw fail();
    if (refs.has(qref)) return refs.get(qref);
    const [id, position] = qref.split(':');
    const row = byQuery.get(id)?.rows[Number(position) - 1];
    if (!row) throw fail();
    const text = evidenceText(id, position, row.values);
    if (text.length > 3000) throw fail();
    const assigned = ++n;
    nextFacts.push({ n: assigned, text });
    refs.set(qref, assigned);
    return assigned;
  };
  const copied = structuredClone(output);
  for (const point of copied.points || []) {
    point.refs = [...new Set([...(point.refs || []), ...(point.qrefs || []).map(resolve)])];
    delete point.qrefs;
    if (!point.refs.length) throw fail();
    const cited = { facts: nextFacts.filter(f => point.refs.includes(f.n)) };
    if (unsupportedAnswerFacts({ points: [point] }, cited).length) throw fail();
  }
  for (const item of copied.keyFacts || []) {
    const qrefs = item.qrefs || [];
    if (qrefs.length) item.ref = resolve(qrefs[0]);
    delete item.qrefs;
    if (item.ref && unsupportedAnswerFacts({ keyFacts: [item] }, { facts: nextFacts.filter(f => f.n === item.ref) }).length) throw fail();
  }
  delete copied.queries;
  if ((copied.checks || []).some(check =>
    !/(?:원장|관리자|담당자|선생님|직원|상담팀|교무팀|운영팀)/.test(check) ||
    !/(?:⟦[^⟧]+⟧|[0-9]+명|[가-힣]+(?:원생|반|청구|미납|상담|보고서|업무))/.test(check) ||
    !/(?:기록|화면|보고서|상담|출석|청구|수납)/.test(check))) throw fail();
  const prose = [copied.headline, ...(copied.keyFacts || []).flatMap(f => [f.label, f.value, f.change]),
    ...(copied.points || []).map(p => p.text), ...(copied.checks || []),
    ...(copied.table?.columns || []), ...(copied.table?.rows || []).flat(),
    copied.suggestedTask?.title, copied.suggestedTask?.body].filter(Boolean).join(' ');
  if (BANNED_REASON.test(prose) || BANNED_COPY.test(prose) || unsupportedAnswerFacts(copied, { ...facts, facts: nextFacts }).length) throw fail();
  return { output: copied, facts: { ...facts, facts: nextFacts }, citedRows: refs.size };
}
