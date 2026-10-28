// 운영실 스냅샷 시험 — node --test experiments/owner-concept/verify-v2-dashboard-overview.mjs
// 조립(보는 사람 · 메뉴 · 배치 · 조회 계획 · 영역 저장점) + 1단계 영역(원생 · 추이)을 확인한다. 값은 따로 구현한 원생 현황 KPI(v2-student-kpis.mjs —
// 같은 2.0 판정을 다른 조회로 센다)와 독립 SQL에 대조한다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOverviewSnapshot } from './v2-dashboard-overview.mjs';
import { studentStatusKpis } from './v2-student-kpis.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), asOf = clock.day;
  var begun = Date.now(), elapsed;
  // 스냅샷과 원생 현황 KPI를 한 트랜잭션에서 — 그 사이 다른 세션의 연습 저장이 끼어도 같은 데이터를 본다.
  var [snap, kpis] = await ro(async (sql) => { const s = await loadOverviewSnapshot({ sql, tenantId: t, importV2 }); elapsed = Date.now() - begun; return [s, await studentStatusKpis({ sql, asOf, tenantId: t, importV2 })]; });
  var S = snap.initial.sections, K = Object.fromEntries(kpis.kpis.map((k) => [k.label, k]));
  var yymm = (m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
}

test('보는 사람: 기본 = 플랫폼 운영 계정이 아닌 재직 원장 중 최근 30일 활동이 가장 많은 사람 · 고른 원장은 그 사람 · 원장이 아니거나 운영 계정이면 기본 원장', { skip: SKIP }, async (tc) => {
  tc.diagnostic(`스냅샷 ${elapsed}ms · 보는 사람 ${snap.viewer.name}`);
  const masters = await db`select u.id::text id, exists(select 1 from public.super_admins sa where sa.id = u.id) super,
      (select count(*)::int from public.audit_logs a where a.tenant_id=${t} and a.actor_id = u.id and a.created_at > ${new Date(clock.at.getTime() - 30 * 86400000)} and a.created_at <= ${clock.at}) recent
    from public.users u where u.tenant_id=${t} and u.status::text = 'active' and u.system_role::text = 'master'`;
  const best = Math.max(...masters.filter((m) => !m.super).map((m) => m.recent));
  const me = masters.find((m) => m.id === snap.viewer.id);
  assert(me && !me.super && me.recent === best, '기본 = 활동이 가장 많은 원장');
  const other = masters.find((m) => m.id !== snap.viewer.id && !m.super);
  if (other) assert.equal((await ro((sql) => loadOverviewSnapshot({ sql, tenantId: t, importV2, viewerId: other.id }))).viewer.id, other.id);
  const [teacher] = await db`select id::text id from public.users where tenant_id=${t} and status::text = 'active' and system_role::text = 'teacher' limit 1`;
  if (teacher) assert.equal((await ro((sql) => loadOverviewSnapshot({ sql, tenantId: t, importV2, viewerId: teacher.id }))).viewer.id, snap.viewer.id, '원장이 아니면 기본 원장');
  const sup = masters.find((m) => m.super);
  if (sup) assert.equal((await ro((sql) => loadOverviewSnapshot({ sql, tenantId: t, importV2, viewerId: sup.id }))).viewer.id, snap.viewer.id, '플랫폼 운영 계정이면 기본 원장');
});

test('스냅샷 모양: 2.0 OverviewSnapshot 키 · 오늘 = 복사본 날짜 · 원장 배치(저장된 원장 배치) · 배치 밖 영역은 조회하지 않음', { skip: SKIP }, async () => {
  const s = snap.initial;
  assert.deepEqual(Object.keys(s).sort(), ['academy', 'allowed', 'requestedAt', 'scope', 'sections', 'subjects', 'tenantId', 'today', 'view'].sort());
  assert.equal(s.today, asOf); assert.equal(s.tenantId, t);
  assert(s.allowed.includes('students') && s.allowed.includes('dashboard'), '원장은 원생·운영실 메뉴를 연다');
  // 저장된 배치는 2.0처럼 normalizeDashboard를 거친 값으로 견준다(판 번호가 다르거나 머리줄뿐이면 기본 배치).
  const [{ data: rawDash }] = await db`select data->'dashboard' data from public.tenant_settings where tenant_id=${t}`;
  const data = (await importV2('features/dashboard/layout/normalize.ts')).normalizeDashboard(rawDash);
  const owner = data?.layouts?.find((l) => l.role === 'owner' && !l.subject);
  if (owner) assert.deepEqual(s.view.items.map((i) => i.id), owner.items.map((i) => i.id).filter((id) => s.view.items.some((v) => v.id === id)), '저장된 원장 배치 차례');
  // 배치에 없는 카드의 영역(강사별 업무 현황 · 3개월 내 퇴원)은 원장 배치에 없으면 싣지 않는다.
  for (const area of ['teacherWork', 'earlyExits']) if (!s.view.items?.some((i) => i.id.endsWith(`:${area}`))) assert(!(area in s.sections), `${area}는 배치 밖`);
  for (const [area, v] of Object.entries(s.sections)) {
    assert.equal(v.error, false, `${area} 조회 실패`);
    assert.equal(v.at, clock.at.getTime(), `${area} 확인 시각 = 복사본을 뜬 순간`);
  }
});

test('원생 영역: 재원생·강좌수·퇴원&수업종료·신규문의·이달 신규 = 원생 현황 KPI의 2.0 칸 값', { skip: SKIP }, () => {
  assert.equal(S.students.data.enrolled, kpis.cards.students);
  assert.equal(S.courses.data.total, kpis.cards.courses);
  assert.equal(S.withdrawals.data.rows.length, kpis.cards.withdrawals, '퇴원&수업종료 줄 수');
  assert.equal(S.intake.data.length, kpis.cards.intakeToday);
  assert.equal(S.enrolledToday.data.filter((r) => r.date?.slice(0, 7) === asOf.slice(0, 7)).length, kpis.cards.enrolledMonth, '이달 신규');
  // 2.0 모양 — 카드·팝업이 읽는 키.
  assert.deepEqual(Object.keys(S.students.data).sort(), ['concurrent', 'enrolled', 'gradeSplit', 'levelSplit', 'levels', 'programs', 'schoolGroups', 'schools', 'subjectCombinations', 'subjectStudents', 'subjects'].sort());
  for (const r of S.enrolledToday.data) assert.deepEqual(Object.keys(r).sort(), ['assigned', 'classes', 'date', 'id', 'name', 'schoolGrade', 'subject', 'time']);
  for (const r of S.withdrawals.data.rows) assert(['withdrawn', 'subject-ended'].includes(r.kind) && /^\d{4}-\d{2}-\d{2}$/.test(r.withdrawnAt), '퇴원 줄');
});

test('재원생 구성: 학교급 막대 합 = 재원생(수업 시작 전 학생 제외 명단) · 동시 수강 = 영어·수학 둘 다', { skip: SKIP }, async () => {
  const d = S.students.data;
  // 명단 = 재원 상태 학생 − 아직 한 과목도 시작 안 한 학생(독립 SQL).
  const [{ n }] = await db`select count(*)::int n from public.students s where s.tenant_id=${t} and s.status = 'enrolled'
    and not (exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = s.id and e.end_date is null and not e.on_hold)
      and not exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = s.id and e.end_date is null and not e.on_hold
        and (e.start_date is null or e.start_date <= ${asOf})))`;
  assert.equal(d.levels.reduce((a, x) => a + x.value, 0), n, '학교급 분포 합 = 실시간 재원생');
  assert.equal(d.concurrent, d.programs.both);
});

test('추이 영역: 재원생·강좌수 월별 점 = 원생 현황 KPI의 같은 선 · 강좌수는 재원생 추이에 싣지 않음', { skip: SKIP }, () => {
  const e = S.enrolledTrend.data, c = S.courseTrend.data;
  assert.deepEqual(e.monthly.map((p) => [yymm(p.key), p.count]), K['재원생'].points.map((p) => [p.label, p.value]));
  assert.deepEqual(c.monthly.map((p) => [yymm(p.key), p.count]), K['강좌수'].points.map((p) => [p.label, p.value]));
  assert(!('courses' in e), '재원생 추이엔 강좌수가 없다(2.0 withoutCourses)');
  assert.equal(e.trustFrom, kpis.trustFrom);
  assert(e.yearly.length >= 1 && e.yearly.at(-1).count === e.monthly.at(-1).count, '올해 점 = 오늘 점');
});

test('등록·퇴원 추이: 6개월 · 퇴원 = 그 달 퇴원(단체 장부 정리 제외)', { skip: SKIP }, async () => {
  const rows = S.changes.data;
  assert.equal(rows.length, 6); assert.equal(rows.at(-1).month, asOf.slice(0, 7));
  // 퇴원 칸 = 퇴원 행 전체(과목마다 줄이 아니라 학생마다) — 독립 SQL: 병합·시스템 정리(수업 기록 없음)·수업 기록 없는 장부 정리·단체 장부 정리 제외.
  const { V } = { V: Object.assign({}, await importV2('features/withdrawals/system-bulk.ts')) };
  const from = `${rows[0].month}-01`;
  const st = await db`select s.id::text id, s.withdrawn_at::text withdrawn_at, s.withdrawal_metadata md,
      exists(select 1 from public.enrollments e where e.tenant_id=${t} and e.student_id = s.id and e.end_date is not null) hist
    from public.students s where s.tenant_id=${t} and s.status = 'withdrawn' and s.withdrawn_at between ${from} and ${asOf}
      and coalesce(s.notes, '') !~ ${'^\\s*중복 병합:\\s*\\S+와 통합됨'}`;
  const kept = st.filter((r) => !V.isCleanupExit(r.md) && !(V.SYSTEM_BULK_WITHDRAWAL_DATES.includes(r.withdrawn_at.slice(0, 10)) && !r.hist));
  for (const r of rows) assert.equal(r.withdrawn, kept.filter((k) => k.withdrawn_at.slice(0, 7) === r.month).length, `${r.month} 퇴원`);
});

test('등록 칸: 청구가 지점을 덮은 달부터는 수업을 시작한 등록만(startedOnly) — 그 달 등록일 수보다 많을 수 없다', { skip: SKIP }, async () => {
  const rows = S.changes.data;
  const reg = await db`select to_char(enrolled_at, 'YYYY-MM') m, count(*)::int n from public.students where tenant_id=${t} and enrolled_at >= ${`${rows[0].month}-01`}
    and coalesce(notes, '') !~ ${'^\\s*중복 병합:\\s*\\S+와 통합됨'} group by 1`;
  const byMonth = new Map(reg.map((r) => [r.m, r.n]));
  for (const r of rows) assert(r.enrolled <= (byMonth.get(r.month) ?? 0), `${r.month}: 등록 ${r.enrolled} ≤ 등록일 ${byMonth.get(r.month) ?? 0}`);
  // 기록 범위가 있으면 그 달부터 표식이 붙고(그 전 달엔 없다), 표식 달 가운데 한 곳은 등록일 수보다 실제로 적다(규칙이 뭔가를 거른다).
  const flagged = rows.filter((r) => r.startedOnly);
  if (flagged.length) {
    assert(rows.findIndex((r) => r.startedOnly) === rows.length - flagged.length, '표식은 어느 달부터 끝까지 이어진다');
    assert(flagged.some((r) => r.enrolled < (byMonth.get(r.month) ?? 0)), '수업을 시작하지 않은 등록을 거른 달이 있다');
  }
});

test('full(배치 없이 메뉴 권한 안 영역 전부): 2.0 영역 33개가 모두 실패 없이 · 배치 밖 영역(강사별 업무 현황 · 3개월 내 퇴원 · 보강예정)도', { skip: SKIP }, async (tc) => {
  const reg = await importV2('features/dashboard/layout/registry.ts');
  const full = await ro((sql) => loadOverviewSnapshot({ sql, tenantId: t, importV2, full: true }));
  const areas = Object.keys(reg.AREA_MENUS).filter((a) => reg.AREA_MENUS[a].every((m) => full.initial.allowed.includes(m)));
  tc.diagnostic(`영역 ${areas.length}개`);
  for (const a of areas) assert(a in full.initial.sections && full.initial.sections[a].error === false, `${a} 실패`);
  assert(full.initial.scope.endsWith(':full'));
  const tw = full.initial.sections.teacherWork.data;
  if (tw.tasks) {
    const [{ open, late }] = await db`select count(*)::int open, (count(*) filter (where due_at < ${(await copyClock()).at}))::int late from public.staff_tasks where tenant_id=${t} and status = 'open'`;
    assert.deepEqual([tw.tasks.open, tw.tasks.late], [open, late], '열린 할 일 · 늦음(복사본을 뜬 순간 기준)');
  }
});

test('운영 설정 공급자 값 · 차트 종류 = 보는 사람의 ui_prefs', { skip: SKIP }, async () => {
  assert.deepEqual(Object.keys(snap.host).sort(), ['disabledModules', 'licenses', 'operations']);
  assert(Array.isArray(snap.host.operations.subjects) && snap.host.operations.subjects.length > 0);
  const [{ prefs }] = await db`select ui_prefs->'dashboard' prefs from public.users where id=${snap.viewer.id}`;
  for (const k of ['changes', 'billing', 'enrolledTrend', 'courseTrend']) if (prefs?.[`chart_${k}`]) assert.equal(snap.chartKinds[k], prefs[`chart_${k}`], k);
});

test.after(() => db?.end());
