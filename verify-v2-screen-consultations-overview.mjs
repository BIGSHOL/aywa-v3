import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-consultations.mjs';

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
try {
  const first = await load({});
  assert.equal(first.page, 'overview');
  for (const key of ['items', 'total', 'counts', 'listParams']) assert.equal(key in first, false, `첫 화면에 ${key} 없음`);
  const rows = first.overview.rows;
  assert.ok(rows.length > 0, '담임 현황이 있다');
  const order = ['EiE', '인재원 영어', '수학'];
  assert.deepEqual([...new Set(rows.map(r => r.group))], order.filter(g => rows.some(r => r.group === g)), '프로그램 순서');
  for (const group of order) {
    const rates = rows.filter(r => r.group === group).map(r => Number.parseFloat(r.cells.rate.text));
    assert.deepEqual(rates, [...rates].sort((a, b) => a - b), `${group} 낮은 이행률부터`);
  }
  const stats = await load({ v2path: '/consultations/stats' });
  assert.equal(stats.page, 'stats');
  const original = new Map(stats.panel.homeroom.teachers.map(t => [t.id, t]));
  assert.deepEqual(new Set(rows.map(r => r.teacherId)), new Set([...original.values()].filter(t => t.months.at(-1).target > 0).map(t => t.id)), '이번 달 상담 대상 담임은 2.0 통계와 같다');
  const grouped = new Map();
  for (const row of rows) grouped.set(row.teacherId, [...(grouped.get(row.teacherId) || []), row]);
  for (const [id, parts] of grouped) {
    const source = original.get(id);
    assert.ok(source, `2.0 담임별 표에 ${id} 있음`);
    if (parts.length === 1) assert.deepEqual([parts[0].cells.target, parts[0].cells.self, parts[0].cells.other],
      [source.months.at(-1).target, source.months.at(-1).self, source.months.at(-1).other], `2.0 통계와 ${id} 같은 숫자`);
  }
  const sample = rows.find(r => original.get(r.teacherId)?.students.length === r.cells.target) ?? rows[0];
  const full = original.get(sample.teacherId);
  assert.ok(full, '2.0 담임별 표에 같은 강사가 있다');
  const detail = await load({ program: sample.program, teacher: sample.teacherId });
  assert.equal(detail.page, 'overview');
  assert.equal(detail.overview.rows.length, sample.cells.target, '강사 줄의 대상 수 = 다음 층 원생 행 수');
  assert.equal(detail.overview.rows.filter(r => r.cells.status.text === '본인 상담 완료').length, sample.cells.self);
  const weekly = [1, 2, 3, 4, 5].reduce((n, i) => n + sample.cells[`w${i}`], 0);
  const originalTeacher = stats.panel.homeroom.teachers.find(t => t.id === sample.teacherId);
  assert.equal(weekly, originalTeacher.students.reduce((n, s) => n + s.selfCounts.at(-1), 0), '주별 합 = 2.0 본인 상담 건수');
  assert.ok(detail.overview.rows.every(r => full.students.some(s => s.name === r.cells.name)), '2.0 담임별 표의 원생');
  if (full.students.length === sample.cells.target) assert.deepEqual(sample.cells.self, full.months.at(-1).self, '2.0 통계 보기 본인 완료 수');
  const studentId = new URLSearchParams(detail.overview.rows[0].href.split('?')[1]).get('studentId');
  const leaf = await load({ v2path: '/consultations', studentId });
  const [{ n }] = await db`select count(*)::int n from public.student_consultations where tenant_id=${tenantId} and student_id=${studentId}::uuid`;
  assert.equal(leaf.page, 'list');
  assert.equal(leaf.total, n, '마지막 층 행 수 = 2.0 상담 목록 필터 행 수');
  assert.ok(leaf.items.every(x => x.studentId === studentId), '마지막 층은 해당 원생 상담만');
  console.log(`원생상담 현황 9/9 · 담임 ${rows.length}줄 · 2.0 통계·층별 합·마지막 목록 일치`);
} finally { await db.end(); }
