// 확장 추세 퇴원 명단의 담당 칸 = 같은 복사본 퇴원관리 목록 담당 칸(읽기만, 브라우저·빌드 없음).
import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { windowsFor } from './v2-screen-trend.mjs';
import { STUDENT_TREND_METRICS } from './v2-dashboard-flow-students.mjs';
import { loadRules, screen } from './v2-screen-withdrawals.mjs';

const db = await openFullDatabase();
try {
  const asOf = (await copyClock()).day, windows = windowsFor('month', asOf), L = await loadRules(importV2);
  await db.begin('isolation level repeatable read read only', async sql => {
    const list = await screen.load({ sql, params: {}, tenantId, importV2 });
    const judged = await screen.load({ sql, params: { part: 'teacher' }, tenantId, importV2 });
    assert(judged.teacher, '퇴원관리 담당 판정 성공');
    const rows = new Map(L.rows.toExitRows(list.withdrawn, list.subjectEnded).map(r => [r.key, r]));
    const teacherMap = new Map(judged.teacher.entries.map(([key, per]) => [key, new Map(per)]));
    const names = judged.teacher.names;
    const expectTeacher = (r, perSubject) => {
      const key = perSubject && r.key.includes('|') ? r.key : r.id;
      const row = rows.get(key), per = teacherMap.get(key);
      if (!row || !per) return null;
      const subject = perSubject ? r.key.slice(r.id.length + 1) : null;
      const facets = L.breakdown.teacherFacetsIn(per, perSubject ? [subject] : row.subjects);
      return L.breakdown.teacherCellText(facets, id => names[id] ?? null) || '—';
    };
    let compared = 0;
    let subjectEndedCompared = 0;
    let named = 0;
    for (const id of ['exits', 'withdrawn', 'early-exits']) {
      const metric = STUDENT_TREND_METRICS.find(m => m.id === id), by = metric.dims[0].id;
      const plain = await metric.series({ sql, asOf, tenantId, importV2, windows, by, filter: null });
      const selected = plain.rows.find(row => row.points.some(p => p && p[0] > 0));
      assert(selected, `${id}: 명단이 있는 줄`);
      const detail = await metric.series({ sql, asOf, tenantId, importV2, windows, by, filter: { dim: by, key: selected.key } });
      const records = detail.records.flatMap(cell => cell ?? []);
      assert(records.length, `${id}: 명단`);
      assert(records.every(r => typeof r.teacher === 'string' && r.teacher), `${id}: 담당 칸`);
      const matching = records.map(r => [r, expectTeacher(r, id === 'exits')]).filter(([, expected]) => expected !== null).slice(0, 4);
      assert(matching.length, `${id}: 퇴원관리와 겹치는 표본`);
      for (const [r, expected] of matching) { assert.equal(r.teacher, expected, `${id} ${r.name} ${r.key}`); compared += 1; if (r.teacher !== '—' && r.teacher !== '담당 미반영') named += 1; }
      if (id === 'exits') for (const program of plain.rows.filter(row => row.points.some(p => p && p[0] > 0))) {
        const result = program.key === selected.key ? detail : await metric.series({ sql, asOf, tenantId, importV2, windows, by, filter: { dim: by, key: program.key } });
        const ended = result.records.flatMap(cell => cell ?? []).filter(r => rows.get(r.key)?.kind === 'subject-ended' && teacherMap.has(r.key));
        for (const r of ended.slice(0, 2)) { assert.equal(r.teacher, expectTeacher(r, true), `수업종료 ${r.name} ${r.key}`); subjectEndedCompared += 1; }
        if (subjectEndedCompared) break;
      }
    }
    assert(compared >= 3);
    assert(subjectEndedCompared, '수업종료 과목 담당과 퇴원관리 담당 대조');
    assert(named, '판정된 선생님 이름이 명단에 표시된다');
    console.log(`확장 추세 3지표 담당 칸: 퇴원관리 퇴원 ${compared}줄 · 수업종료 ${subjectEndedCompared}줄 일치, 이름 ${named}줄`);
  });
} finally { await db.end(); }
