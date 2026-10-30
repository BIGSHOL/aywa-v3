import assert from 'node:assert/strict';
import { groupAbsenceSessions } from './absence-sessions.mjs';
import { buildHierarchy } from './flow-hierarchy.mjs';

const rows = [
  { id: 'a', student_id: 's1', class_id: 'math', session_date: '2026-10-20', slot_start: '15:00' },
  { id: 'b', student_id: 's1', class_id: 'math', session_date: '2026-10-20', slot_start: '16:00' },
  { id: 'c', student_id: 's1', class_id: 'english', session_date: '2026-10-20', slot_start: '17:00' },
  { id: 'd', student_id: 's1', class_id: 'math', session_date: '2026-10-21', slot_start: '15:00' },
  { id: 'e', student_id: 's2', class_id: 'math', session_date: '2026-10-20', slot_start: '15:00' },
];
const sessions = groupAbsenceSessions(rows);
assert.equal(sessions.length, 4, '같은 반·날짜의 교시만 접고 다른 반·날짜·원생은 나눈다');
assert.deepEqual(sessions[0].cells.map(r => r.id), ['a', 'b'], '담당·메모를 합칠 원래 칸을 보존한다');
assert.deepEqual(sessions.slice(1).map(r => r.id), ['c', 'd', 'e'], '첫 칸 순서를 보존한다');
assert.equal(groupAbsenceSessions(sessions).length, 4, '서버에서 접은 값을 화면에서 다시 접어도 수가 같다');
assert.equal(groupAbsenceSessions([{ studentId: 's1', classId: 'math', date: '2026-10-20' }]).length, 1);
assert.throws(() => groupAbsenceSessions([{ classId: 'math', date: '2026-10-20' }]), /원생 ID/);
const source = {
  identity: { asOf: '2026-10-27', capturedAt: '2026-10-27T00:00:00Z' },
  actors: [{ id: 't1' }],
  entities: new Map([
    ['student:s1', { id: 's1', label: '원생', status: 'enrolled' }],
    ['class:c1', { id: 'c1', label: '수학반', teacherId: 't1' }],
    ['staff:t1', { id: 't1', label: '담임' }],
    ...['a', 'b'].map(id => [`attendance:${id}`, { id, studentId: 's1', classId: 'c1', date: '2026-10-20' }]),
  ]),
  signals: [{ familyId: 'attendance', signal: { id: 'attendance-repeat-absence', recordIds: ['a', 'b'] }, refs: ['attendance:a', 'attendance:b'] }],
};
const caseId = 'src-sig-attendance-attendance-repeat-absence';
const state = { revision: 1, cases: { [caseId]: { id: caseId, kind: 'source', familyId: 'attendance', signalId: 'attendance-repeat-absence', state: 'open',
  entityRefs: [{ type: 'attendance', id: 'a' }, { type: 'attendance', id: 'b' }], steps: [{ id: `${caseId}-s1`, refs: ['attendance:a', 'attendance:b'], status: 'ready' }], evidence: [] } } };
const { tree } = buildHierarchy(source, state, caseId);
assert.equal(tree.counts.records, 1, '계층의 결석 수는 수업 단위');
assert.equal(tree.coverage.returnedRecords, 2, '원본 근거 두 칸은 보존');
assert.equal(tree.root.children[0].children[0].children[0].facts.absencesInClass, 1);
console.log('결석 수업 공용 함수·계층 숫자: 9개 검증 통과');
