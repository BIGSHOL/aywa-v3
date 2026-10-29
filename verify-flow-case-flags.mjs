import assert from 'node:assert/strict';
import { flowCaseFlags } from './flow-case-flags.mjs';

const asOf = '2026-10-29';
const one = (dueAt, step, state = 'open') => ({ state, dueAt, steps: [step] });
const queue = { status: 'ready', assigneeIds: [], queue: 'manager', unassignedReason: null };
assert.deepEqual(flowCaseFlags(one('2026-10-28T14:59:00Z', queue), asOf), { late: true, unassigned: false });
assert.deepEqual(flowCaseFlags(one('2026-10-28T16:00:00Z', { ...queue, unassignedReason: '담당 없음' }), asOf), { late: false, unassigned: true });
assert.deepEqual(flowCaseFlags(one('2026-10-27', { status: 'review', assigneeIds: [], queue: null }), asOf), { late: true, unassigned: true });
assert.deepEqual(flowCaseFlags(one('2026-10-27', { status: 'ready', assigneeIds: [], queue: null, skipped: true }), asOf), { late: true, unassigned: false });
assert.deepEqual(flowCaseFlags(one('2026-10-27', queue, 'done'), asOf), { late: false, unassigned: false });
console.log('업무 흐름 판정 5/5 · 한국 시각·관리자 대기열·건너뛴 단계');
