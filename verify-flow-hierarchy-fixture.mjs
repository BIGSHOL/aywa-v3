// Synthetic source for verify-flow-hierarchy.mjs (no DB, no network). Shaped like loadFlowSource().
// t1 owns 63 records (> the seed's 50-ref cap), s1~s5 are absent in a t1 class and a t2 class,
// c4's teacher is no longer active, c5 has no teacher and s27's records have no class.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlowService } from './flow-service.mjs';
import { fakeAI } from './verify-flow-engine-fixture.mjs';

export const CASE = 'src-sig-attendance-attendance-repeat-absence';
export const T = { owner: 'u-owner', manager: 'u-manager', t1: 'u-t1', t2: 'u-t2', gone: 'u-gone' };
export function hierarchySource({ withdrawn = false, noRefs = false } = {}) {
  const entities = new Map(), relations = [];
  const put = (type, id, label, familyId, extra = {}) => entities.set(`${type}:${id}`, { type, id, label, familyId, recordId: id, ...extra });
  const link = (type, from, to, source) => relations.push({ id: `rel-${relations.length + 1}`, type, from: { type: from.split(':')[0], id: from.split(':')[1] }, to: { type: to.split(':')[0], id: to.split(':')[1] }, source });
  const actors = [
    { id: T.owner, name: '원장님', role: 'owner', roleLabel: '원장', systemRole: 'master', desk: false, assignable: true },
    { id: T.manager, name: '김관리', role: 'manager', roleLabel: '관리자', systemRole: 'admin', desk: false, assignable: true },
    { id: T.t1, name: '이담임', role: 'teacher', roleLabel: '강사', systemRole: 'teacher', desk: false, assignable: true },
    { id: T.t2, name: '박강사', role: 'teacher', roleLabel: '강사', systemRole: 'teacher', desk: false, assignable: true },
  ];
  for (const a of actors) put('staff', a.id, a.name, 'staff');
  put('staff', T.gone, '퇴사강사', 'staff');
  for (const [id, label, teacherId] of [['c1', '중1 수학A', T.t1], ['c2', '중2 수학', T.t1], ['c3', '중1 영어', T.t2], ['c4', '고1 국어', T.gone], ['c5', '보강반', null]]) { put('class', id, label, 'classes', { teacherId }); if (teacherId) link('homeroom', `class:${id}`, `staff:${teacherId}`, 'classes.teacher_id'); }
  for (let i = 1; i <= 28; i += 1) put('student', `s${i}`, `원생${i}`, 'students', { status: withdrawn && i === 28 ? 'withdrawn' : 'enrolled', school: '경명여중', grade: '중1' });
  put('invoice', 'i1', '2026-10 청구', 'billing', { remaining: 20000, dueDate: '2026-10-31' }); link('billed_to', 'invoice:i1', 'student:s1', 'invoices.student_id');
  const refs = []; let n = 0;
  const absent = (sid, classId, date) => { const id = `a${(n += 1).toString().padStart(3, '0')}`; put('attendance', id, `${date} 결석`, 'attendance', { date, studentId: sid, classId }); link('about_student', `attendance:${id}`, `student:${sid}`, 'attendance_records.student_id'); if (classId) link('in_class', `attendance:${id}`, `class:${classId}`, 'attendance_records.class_id'); refs.push(`attendance:${id}`); };
  const day = d => `2026-10-${String(d).padStart(2, '0')}`;
  for (let i = 1; i <= 20; i += 1) for (const d of [2, 9, 16]) absent(`s${i}`, 'c1', day(d + (i % 3)));
  for (let i = 1; i <= 5; i += 1) absent(`s${i}`, 'c3', day(24));
  for (let i = 21; i <= 23; i += 1) for (const d of [3, 10, 25]) absent(`s${i}`, 'c4', day(d));
  for (let i = 24; i <= 26; i += 1) for (const d of [4, 11, 26]) absent(`s${i}`, 'c5', day(d));
  for (const d of [5, 12, 19]) absent('s27', null, day(d));
  for (const d of [6, 13, 20]) absent('s28', 'c2', day(d));
  const recordIds = [...refs.map(r => r.split(':')[1]), 'a-missing'];
  const signals = [
    { familyId: 'attendance', signal: { id: 'attendance-repeat-absence', title: '결석 3회 이상 재원생 28명', summary: '이번 달 결석 3회 이상', priority: '확인 필요', source: '출석부', recordIds: noRefs ? ['x1'] : recordIds, draft: { title: '결석 확인', body: '확인해 주세요' } }, refs: noRefs ? [] : refs },
    { familyId: 'billing', signal: { id: 'billing-remaining', title: '수납 확인 1건', summary: '남은 금액', priority: '확인 필요', source: '수납', recordIds: ['i1'], draft: { title: '수납 확인', body: '확인해 주세요' } }, refs: ['invoice:i1'] },
  ];
  return { identity: { tenantId: 'tenant-test', tenantSlug: 'cs', capturedAt: '2026-10-27T05:34:00.000Z', asOf: '2026-10-27' }, actors, entities, relations, tasks: [], signals, candidates: { absence: [], billing: ['i1'], consultation: [] } };
}

/** Provider double: never network. teacherLow = 'invalid' makes base-tier (effort low) teacher answers fail grounding. */
export function fakeProviders({ uncertainAt3 = false, jevError = null, teacherLow = 'valid', gate = null } = {}) {
  const calls = { jev: [], claude: [] };
  const ok = r => Object.assign({ model: 'claude-sonnet-5-5', elapsedMs: 3, usage: null, apiEquivalentUsd: null }, r);
  return { transport: 'fake', calls,
    jev: { model: 'jev-1.14.0', status: async () => 'ready',
      async decide({ state }) {
        calls.jev.push(state.student.id); if (gate) await gate('jev');
        if (jevError) throw Object.assign(new Error('x'), { code: jevError });
        const n = state.student.absence_records_this_month, choice = n >= 4 ? 'first' : 'routine', confidence = uncertainAt3 && n === 3 ? 0.2 : 0.9;
        return { model: 'jev-1.14.0', elapsedMs: 1, usage: { inputTokens: 800, outputTokens: 0 }, answers: { check_order: { type: 'choice', choice, confidence, probabilities: { first: choice === 'first' ? 0.9 : 0.05, soon: 0.05, routine: choice === 'routine' ? 0.9 : 0.05 } }, manager_attention: { type: 'noul', probability: 0.2 } } };
      } },
    claude: { status: async () => 'ready',
      async ask({ effort, input }) {
        const stage = input.강사들 ? 'teacher' : 'academy'; calls.claude.push({ stage, effort, teachers: input.강사들?.map(t => t.강사) || null });
        if (gate) await gate(stage);
        if (stage === 'academy') return ok({ output: { manager: { summary: `${input.강사별[0].강사} 묶음부터 봅니다.`, reasons: [], suggestedAction: null, evidenceIds: [input.강사별[0].강사] }, owner: { summary: '재직 아닌 담임의 반은 관리자 결정이 필요합니다.', reasons: [], suggestedAction: null, evidenceIds: [] } } });
        const bad = teacherLow === 'invalid' && effort === 'low';
        return ok({ output: { teachers: input.강사들.map(t => ({ id: t.강사, summary: bad ? `${t.강사} 결석 기록 9999건입니다.` : `${t.강사} 담당 반에서는 ${t.반[0].원생[0].원생}을 먼저 봅니다.`, reasons: ['처리상태가 미처리인 원생이 있습니다.'], suggestedAction: { title: '결석 기록 확인', body: '담임이 기록을 검토합니다.' }, attention: 'routine',
          evidenceIds: [t.반[0].반, t.반[0].원생[0].원생], classes: t.반.map(c => ({ id: c.반, summary: `${c.원생[0].원생}을 먼저 확인합니다.`, evidenceIds: [c.원생[0].원생] })) })) } });
      } } };
}

let clockAt = Date.parse('2026-10-27T06:00:00Z');
export const tick = () => new Date((clockAt += 1000)).toISOString();
export async function hierarchyService({ dir, providers = null, source = hierarchySource(), budget, clock } = {}) {
  const d = dir || await mkdtemp(join(tmpdir(), 'flow-hier-'));
  const svc = await createFlowService({ source, dir: d, ai: fakeAI(), lock: false, now: tick, tenantName: '테스트 지점', hierarchy: { providers, budget, clock, log: () => {} } });
  return { dir: d, svc };
}
