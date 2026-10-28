// 3차 합의 7번: 2.0 원생 통계·성적관리 원본 조회와 화면 경로를 Docker 복사본에서 읽기 시험.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen as students } from './v2-screen-students.mjs';
import { screen as exams } from './v2-screen-exams.mjs';
import { stopV2Server } from './v2-server-runner.mjs';

const db = await openFullDatabase();
const read = (screen, params) => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
try {
  await test('원생 통계: 원본 다섯 카드와 2.0 기간 열쇠', async () => {
    const result = await read(students, { v2path: '/students/stats', fc: 'day', fcMonth: '2026-10', tr: 'day', trMonth: '2026-10' });
    assert.deepEqual(Object.keys(result.stats.parts).sort(), ['courses', 'firstClass', 'flow', 'history', 'trend']);
    assert.equal(result.stats.firstPeriod.grain, 'day');
    assert.equal(result.stats.trendPeriod.grain, 'day');
    assert.ok(result.stats.parts.trend.data?.total);
    assert.ok(result.stats.parts.flow.data);
    assert.ok(result.settings.operations.subjects.length);
  });
  await test('성적관리: 통합 원장·학기 입력·확인과 학생 상세 연결', async () => {
    const ledger = await read(exams, { tab: 'records' });
    assert.equal(ledger.route, 'dashboard');
    assert.ok(ledger.loaded.data.records.length > 0);
    assert.ok(ledger.loaded.data.students.length > 0);
    assert.ok(ledger.loaded.settings.operations.subjects.length > 0);
    assert.equal(ledger.loaded.writeError, null);
    const input = await read(exams, { v2path: '/exams/input' });
    assert.equal(input.route, 'input');
    assert.ok(input.loaded.sheet.rows.length > 0);
    const view = await read(exams, { v2path: '/exams/view' });
    assert.equal(view.route, 'view');
    assert.ok(view.loaded.overview.columns.length > 0);
    const id = ledger.loaded.data.records[0].studentId;
    const student = await read(exams, { tab: 'student', student: id });
    assert.equal(student.route, 'dashboard');
    assert.ok(student.loaded.data.records.some(row => row.studentId === id));
  });
  await test('원본 저장 동작만 등록하고 모듈·행위자를 검증', () => {
    assert.deepEqual(Object.keys(exams.actions).sort(), ['createUnifiedGrade', 'saveGradeScores', 'saveGradeSortPref', 'saveUnifiedGrade']);
    assert.ok(students.actions.saveStudentStatsPrefs);
    assert.throws(() => exams.actions.saveGradeScores.validate({ module: 'features/grades/server/actions.ts', actor: 'bad', args: [] }));
    assert.throws(() => exams.actions.saveGradeScores.validate({ module: 'other.ts', actor: '590aa1c5-0b4d-4fe8-ba1b-e20dd8011b67', args: [null, { $formData: [] }] }));
  });
  await test('인재원 실시간 경로는 바깥 요청 없이 안내', async () => {
    const jj = await read(exams, { v2path: '/exams/jj/attempt/sample' });
    assert.equal(jj.route, 'external-unavailable');
    assert.match(jj.message, /인재원 실시간 성적/);
  });
} finally { await db.end(); await stopV2Server(); }
