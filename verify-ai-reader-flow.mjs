import assert from 'node:assert/strict';
import { createAiReader } from './ai-reader.mjs';
import { importV2 } from './v2-bridge.mjs';

const tenant = 'becaa316-e636-42e9-9d09-08b133e0b094';
const reader = await createAiReader({ target: 'sandbox' });
const asDay = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
async function all(table, key, columns) {
  const rows = [];
  let last = '';
  for (;;) {
    const where = last ? ` AND ${key}::text > '${last}'` : '';
    const page = await reader.query(`SELECT ${columns} FROM ai_access.${table} WHERE tenant_id='${tenant}'${where} ORDER BY ${key} LIMIT 200`);
    const next = page.rows.map(x => x.values);
    rows.push(...next);
    if (next.length < 200) return rows;
    last = String(next.at(-1)[key]);
    if (!/^[0-9a-f-]{36}$/.test(last)) throw new Error('목록 열쇠를 확인하지 못했습니다.');
  }
}
try {
  const [{ countedOn }, { isCleanupExit }, { reasonDisplay }] = await Promise.all([
    importV2('features/dashboard/overview/enrolled-trend.ts'),
    importV2('features/withdrawals/system-bulk.ts'),
    importV2('features/withdrawals/types.ts'),
  ]);
  const students = await all('students', 'id', 'id,status,enrolled_at,withdrawn_at,notes,withdrawal_metadata,name');
  const enrollment = await reader.query(`SELECT student_id, min(start_date)::text AS first_start, bool_or(end_date IS NOT NULL) AS ended
    FROM ai_access.enrollments WHERE tenant_id='${tenant}' GROUP BY student_id`);
  // 200행 상한을 지키기 위해 학생별 수강 요약도 페이지로 받는다.
  const summary = enrollment.truncated ? await all('enrollments', 'id', 'id,student_id,start_date,end_date') : null;
  const firstStart = new Map(), ended = new Set();
  if (summary) {
    for (const e of summary) {
      if (e.end_date) ended.add(e.student_id);
      if (e.start_date && (!firstStart.has(e.student_id) || asDay(e.start_date) < firstStart.get(e.student_id))) firstStart.set(e.student_id, asDay(e.start_date));
    }
  } else for (const e of enrollment.rows.map(x => x.values)) {
    if (e.ended) ended.add(e.student_id);
    if (e.first_start) firstStart.set(e.student_id, e.first_start);
  }
  const material = { firstStart, ended };
  const roster = day => new Map(students.filter(s => countedOn({ id: s.id, status: s.status,
    enrolledAt: asDay(s.enrolled_at), withdrawnAt: asDay(s.withdrawn_at), notes: s.notes,
    cleanup: isCleanupExit(s.withdrawal_metadata) }, material, day)).map(s => [s.id, s]));
  const before = roster('2026-09-30'), after = roster('2026-10-27');
  const entered = [...after.keys()].filter(id => !before.has(id));
  const left = [...before.keys()].filter(id => !after.has(id));
  assert.deepEqual([before.size, after.size, entered.length, left.length], [331, 333, 9, 7]);
  console.log(`2.0 판정(청구 보정 전): 9/30 ${before.size}명 · 10/27 ${after.size}명 · 유입 ${entered.length}명 · 이탈 ${left.length}명 · 순변화 ${after.size-before.size}명`);
  console.log(`유입 중 10월 등록일 ${entered.filter(id => asDay(after.get(id).enrolled_at)?.startsWith('2026-10')).length}명 · 첫 수강 시작 10월 ${entered.filter(id => firstStart.get(id)?.startsWith('2026-10')).length}명`);
  console.log(`이탈 중 10월 퇴원일 ${left.filter(id => asDay(before.get(id).withdrawn_at)?.startsWith('2026-10')).length}명`);
  const consult = await reader.query(`SELECT to_char(coalesce(consulted_at,created_at) AT TIME ZONE 'Asia/Seoul','YYYY-MM') AS month,count(*)::int AS n
    FROM ai_access.enrollment_consultations WHERE tenant_id='${tenant}' AND coalesce(consulted_at,created_at)>=timestamp '2026-09-01'
    AND coalesce(consulted_at,created_at)<timestamp '2026-11-01' GROUP BY 1 ORDER BY 1`);
  const tests = await reader.query(`SELECT to_char(tested_on,'YYYY-MM') AS month,count(*)::int AS n
    FROM ai_access.level_tests WHERE tenant_id='${tenant}' AND tested_on>=date '2026-09-01' AND tested_on<date '2026-11-01'
    GROUP BY 1 ORDER BY 1`);
  console.log(`상담 기록: ${consult.rows.map(x => `${x.values.month} ${x.values.n}건`).join(' · ')}`);
  console.log(`입학 테스트 후보(level_tests): ${tests.rows.map(x => `${x.values.month} ${x.values.n}건`).join(' · ') || '기록 없음'}`);
  console.log(`유입 이름: ${entered.map(id => after.get(id).name).join(', ')}`);
  console.log(`이탈 이름: ${left.map(id => before.get(id).name).join(', ')}`);
  const ids = left.map(id => `'${id}'`).join(',');
  const reasons = await reader.query(`SELECT DISTINCT ON (student_id) student_id, withdrawal_reason, withdrawal_detail, withdrawal_memo
    FROM ai_access.enrollments WHERE tenant_id='${tenant}' AND student_id IN (${ids})
      AND end_date BETWEEN date '2026-10-01' AND date '2026-10-27'
    ORDER BY student_id,end_date DESC`);
  const byStudent = new Map(reasons.rows.map(x => [x.values.student_id, x.values]));
  console.log(`이탈 사유 기록: ${left.map(id => {
    const item = byStudent.get(id);
    return `${before.get(id).name}=${reasonDisplay(item?.withdrawal_reason) || item?.withdrawal_detail || item?.withdrawal_memo || '사유 미기재'}`;
  }).join(' · ')}`);
  console.log('10월 흐름 판정 1/1');
} finally { await reader.close(); }
