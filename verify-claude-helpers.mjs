// Fixture and HTTP helpers for verify-claude-bridge.mjs (offline only).
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAssistantContext } from './claude-bridge-context.mjs';
import { createAssistantRoute, createReadiness } from './claude-bridge-http.mjs';

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
// Shaped like snapshot.mjs output. Names, phones and free text are planted so the
// context test can prove none of them reach the prompt.
export const db = () => ({
  meta: { month: '2026-10', asOf: '2026-10-27', importedAt: '2026-10-27T05:34:00Z' },
  months,
  trend: months.map((month, i) => ({ month, payingStudents: i === 5 ? 3 : 4, billed: 900000, paid: i === 5 ? 850000 : 900000, remaining: i === 5 ? 50000 : 0, inquiries: 2, registered: 1, absent: 5, attendance: 15 })),
  invoices: [
    { id: 'i1', name: '홍길동', period: '2026-10', category: 'tuition', gross: 600000, discount: 100000, total: 500000, paid: 450000, remaining: 50000, status: 'partial', due: '2026-10-01' },
    { id: 'i2', name: '김비밀', period: '2026-10', category: 'tuition', gross: 400000, discount: 0, total: 400000, paid: 400000, remaining: 0, status: 'paid', due: '2026-10-01' },
    { id: 'i3', name: '홍길동', period: '2026-09', category: 'tuition', gross: 500000, discount: 0, total: 500000, paid: 500000, remaining: 0, status: 'paid', due: '2026-09-01' },
  ],
  students: [
    { name: '홍길동', status: 'enrolled', attendance: { absent: 4 }, phone: '010-1234-5678' },
    { name: '김비밀', status: 'enrolled', attendance: { absent: 1 } },
    { name: '휴원학생', status: 'on_hold', attendance: { absent: 0 } },
  ],
  admissions: [{ name: '홍길동', date: '2026-10-03', outcome: 'consulted', followup: '2026-10-30', note: '비밀 상담 메모', phone: '010-1234-5678' }],
  admissionChannels: [{ label: '온라인', count: 1 }],
  attendance: { statuses: [{ label: 'present', count: 10 }, { label: 'absent', count: 5 }] },
  approvals: [{ status: 'pending', form: 'leave', date: '2026-10-20', title: '휴가 사유 상세', drafter: '김비밀' }],
  tasks: [{ status: 'open', due: '2026-10-20', kind: 'unsent_report', owners: ['김비밀'], title: '사적 업무 메모' }],
  textbooks: [{ status: 'requested', price: 15000, name: '수학 교재', student: '교재학생' }],
  daily: [{ date: '2026-10-26', enrolled: 2, onHold: 1 }],
});

export async function startRoute(runner, options = {}) {
  const origins = new Set(), logs = [];
  const route = createAssistantRoute({ context: buildAssistantContext(db()), runner, readiness: createReadiness(() => runner.checkAuth()), origins, log: line => logs.push(line), ...options });
  const server = createServer((req, res) => { route.handle(req, res).catch(() => res.destroy()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(), origin = `http://127.0.0.1:${port}`;
  origins.add(origin);
  return { port, origin, logs, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export function call(server, { method = 'POST', path = '/api/assistant', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    let answered = false;
    const req = request({ host: '127.0.0.1', port: server.port, method, path, agent: false, signal, headers: { ...(payload ? { 'content-length': payload.length } : {}), ...headers } }, res => {
      answered = true;
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* plain text */ } resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', error => { if (!answered) reject(error); });
    req.end(payload ?? undefined);
  });
}

export async function waitDead(cwd, mode) {
  const pid = Number(await readFile(join(cwd, `pid-${mode}.txt`), 'utf8'));
  for (let i = 0; i < 50; i += 1) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`fake CLI ${mode} (pid ${pid}) is still running`);
}

export async function waitFor(check, label, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) if (await check()) return;
  assert.fail(`timed out waiting for ${label}`);
}

export async function readCalls(cwd) {
  try { return (await readFile(join(cwd, 'calls.log'), 'utf8')).split('\n').filter(Boolean).length; } catch { return 0; }
}
