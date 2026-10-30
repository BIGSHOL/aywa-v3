// 닫힌 업무 처리 근거 한 줄(task-close-evidence.mjs) — 누가의 순서 · 근거 없음 · 취소 사유 · 열린 업무. DB 없이 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeEvidence, closeWhen, AUTO_CLOSER, NO_EVIDENCE } from './task-close-evidence.mjs';

const names = new Map([['u1', '김예원'], ['u2', '허주연']]);

test('열린 업무는 근거 줄이 없다', () => {
  assert.equal(closeEvidence({ status: 'open' }, null, names), null);
  assert.equal(closeEvidence({ status: 'late' }, null, names), null);
});
test('누가 = 닫은 사람 → 근거 기록을 남긴 사람 → 자동', () => {
  const ev = { what: '숙제에 영상 연결', by: 'u2', at: '2026-10-21T04:00:00Z' };
  assert.equal(closeEvidence({ status: 'done', closed_by: 'u1' }, ev, names).who, '김예원');
  assert.equal(closeEvidence({ status: 'done' }, ev, names).who, '허주연');
  assert.equal(closeEvidence({ status: 'done' }, { what: '숙제 영상이 올라옴', at: '2026-10-21T04:00:00Z' }, names).who, AUTO_CLOSER);
  assert.equal(closeEvidence({ status: 'done', closed_by: 'u9' }, { what: '교재 주문', byName: '허은진' }, names).who, '허은진', '이름표에 없는 id는 건너뛴다');
});
test('처리됨인데 근거가 없으면 드러낸다', () => {
  const x = closeEvidence({ status: 'done', close_reason: 'video_arrived', closed_at: '2026-10-23T07:30:00Z' }, null, names);
  assert.equal(x.what, NO_EVIDENCE); assert.equal(x.missing, true); assert.equal(x.line, `${NO_EVIDENCE} · ${AUTO_CLOSER} · 10/23 16:30`);
});
test('취소·만료는 사유가 근거', () => {
  const x = closeEvidence({ status: 'cancelled', close_reason: 'not_absent', closed_at: '2026-10-21T06:00:00Z' }, null, names);
  assert.equal(x.missing, false); assert.equal(x.what, '결석이 아니게 정정됨');
  assert.equal(closeEvidence({ status: 'cancelled', close_reason: 'unknown_reason' }, null, names).missing, true, '모르는 사유 · 근거 없음 = 드러냄');
});
test('언제 = 근거 기록 시각 → 닫힌 시각 · 한국 시각', () => {
  assert.equal(closeWhen('2026-10-21T06:55:00Z'), '10/21 15:55');
  assert.equal(closeWhen('2026-10-21'), '10/21');
  assert.equal(closeWhen('아님'), '');
  assert.equal(closeEvidence({ status: 'done', closed_at: '2026-10-26T07:09:00Z' }, { what: '콜&상담 결과 ‘등록’' }, names).when, '10/26 16:09');
});
test('열 곳은 앱 안 주소만', () => {
  assert.equal(closeEvidence({ status: 'done' }, { what: 'x', open: '#v2-record-open?family=a&id=b' }, names).open, '#v2-record-open?family=a&id=b');
  assert.equal(closeEvidence({ status: 'done' }, { what: 'x', open: 'javascript:alert(1)' }, names).open, '');
});
