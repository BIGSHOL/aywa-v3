import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-class-review.mjs';
import { subjectKeys } from './v2-class-review-overview.mjs';
import { stopV2Server } from './v2-server-runner.mjs';

const shell = await readFile(new URL('./v2-screen-class-review.js', import.meta.url), 'utf8');
assert.match(shell, /renderReviewOverview\(entry\.data\.overview\)/);
assert.match(shell, /data-v2-review-task/);
assert.match(shell, /기존 직원 평가 목록 열기/);

const db = await openFullDatabase();
try {
  await db.begin('isolation level repeatable read read only', async sql => {
    const load = params => screen.load({ sql, params, tenantId, importV2 });
    const first = await load({});
    assert.equal(first.page, 'overview');
    const root = first.overview;
    const [latest] = await sql`select max(month) as latest_month from public.teacher_portfolio_months where tenant_id=${tenantId} and closed_at is not null`;
    assert.equal(root.period, latest.latest_month);
    const records = await sql`select p.teacher_id::text id, p.month, p.total, p.subjects, p.payload, p.closed_at::text closed_at,
      u.subjects user_subjects from public.teacher_portfolio_months p
      left join public.users u on u.id=p.teacher_id and u.tenant_id=${tenantId}
      where p.tenant_id=${tenantId} and p.month=${root.period}`;
    const closed = records.filter(r => r.closed_at);
    assert.match(root.summary, new RegExp(`마감 ${closed.length} / 평가 ${records.length}명`));
    assert.ok(root.rows.some(r => r.cells.name === '영어 통합'));
    for (const [key, label] of [['english', '영어 통합'], ['math', '수학'], ['other', '과목 미분류']]) {
      const expected = records.filter(r => subjectKeys(r, { operations: first.operations }).includes(key));
      const summary = root.rows.find(r => r.cells.name === label);
      assert.equal(!!summary, expected.length > 0);
      if (!summary) continue;
      assert.equal(summary.cells.closed, `${expected.filter(r => r.closed_at).length} / ${expected.length}명`);
      const detail = (await load({ subject: key })).overview;
      assert.equal(detail.rows.length, expected.length);
      assert.equal(detail.rows.filter(r => r.cells.status === '마감 대기').length, expected.filter(r => !r.closed_at).length);
      for (const item of detail.rows) {
        const record = expected.find(r => r.id === item.teacherId);
        assert.ok(record);
        if (!record.closed_at) assert.equal(item.cells.score, '—', '미마감 잠정 점수는 표에 내지 않는다');
        else assert.ok(item.cells.score.text.includes(`${Number(record.total)}`), '점수는 저장 총점 그대로');
        if (item.action?.kind === 'guide') {
          assert.ok(Number(record.total) / Number(record.payload.knownMax) < 0.7);
          assert.ok(!record.payload.items.some(m => (m.missing || m.uncounted) && !m.off));
        }
      }
    }
    const closedTeacher = (await load({ subject: 'english' })).overview.rows.find(r => r.cells.status === '마감');
    const itemPage = (await load({ subject: 'english', teacher: closedTeacher.teacherId })).overview;
    const saved = records.find(r => r.id === closedTeacher.teacherId);
    assert.equal(itemPage.rows.length, saved.payload.items.length);
    assert.ok(itemPage.rows.every(r => r.href.includes('tab=portfolio') && r.href.includes(closedTeacher.teacherId)));
    const admin = first.editors.find(e => e.role !== '원장');
    assert.ok(admin);
    assert.equal((await load({ actor: admin.id })).page, 'list', '포트폴리오 권한이 없는 직원은 기존 2.0 목록');
    console.log(`강사평가 현황 8/8 · 기준월 ${root.period} · 마감 ${closed.length}/${records.length} · 저장 점수/권한 대조`);
  });
} finally { await stopV2Server(); await db.end(); }
