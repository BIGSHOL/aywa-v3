// 원생 현황 KPI 이식 시험 — node --test experiments/owner-concept/verify-v2-student-kpis.mjs
// 복사본 기준일의 2.0 칸 값(재원생 · 강좌수 · 이번 달 퇴원&수업종료 · 오늘 신규문의 · 이달 신규)을 2.0 조건을 그대로 적은 독립 SQL과 대조하고,
// 추세 점(재원생·강좌수·퇴원&수업종료·신규문의는 지난 점 값까지 따로 센 값과) · 큰 숫자 = 칸 · 지난 기준일 · 화면 문구 · 같은 트랜잭션 한 번 계산을 확인한다.
// 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { studentStatusKpis } from './v2-student-kpis.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { copyClock } = await import('./v2-onescreen-roster.mjs');
  var { weekWindows } = await import('./domain-snapshot-core.mjs');
  var V = Object.assign({}, await importV2('features/withdrawals/system-bulk.ts'), await importV2('features/dashboard/overview/enrolled-recent.ts'),
    await importV2('features/dashboard/overview/enrolled-outcome.ts'), await importV2('features/enrollment/consult-subject.ts'), await importV2('lib/date-kst.ts'),
    await importV2('features/dashboard/overview/coverage-rules.ts'));
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), asOf = clock.day, monthStart = `${asOf.slice(0, 7)}-01`;
  var begun = Date.now(), outP;
  var out = await ro((sql) => (outP = studentStatusKpis({ sql, asOf, tenantId: t, importV2 })));
  var elapsed = Date.now() - begun;
  var K = Object.fromEntries(out.kpis.map((k) => [k.label, k]));
  var kst = (d) => new Date(`${d}T00:00:00+09:00`);
  var addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  var yymm = (m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
  var monthsBack = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - n + i, 1)).toISOString().slice(0, 7));
  // 그 달의 같은 날(없으면 말일).
  var sameDay = (m) => { const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10), d = `${m}-${asOf.slice(8, 10)}`; return d > end ? end : d; };
  // 창의 끝 = 그날 복사본을 뜬 시각.
  var cut = (d) => new Date(clock.at.getTime() - (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)));
  var [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  var subjects = stored.operations.subjects;
  // 병합 표식(2.0 MERGE_NOTE_PATTERN · 앞 공백 무시).
  var MERGE = '^\\s*중복 병합:\\s*\\S+와 통합됨';
  // 과목 묶음 — 키가 영어·수학이거나 설정 이름에 '수학'·'영어'가 들어가면 그 묶음, 나머지는 과목 그대로(빈 과목은 셈에서 뺀다).
  var labelOf = (k) => subjects.find((s) => s.key === k)?.label ?? '';
  var group = (k) => (!k?.trim() ? null : k === 'english' ? 'english' : k === 'math' ? 'math' : labelOf(k).includes('수학') ? 'math' : labelOf(k).includes('영어') ? 'english' : k);
  var monthOf = (label) => `20${label.slice(0, 2)}-${label.slice(3, 5)}`;
  var lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  // 지점의 첫 수강이 만들어진 때(그 전 날짜는 수강 생성 시각 컷이 없다 — 첫 묶음은 옛 기록을 옮긴 것) · 장부 정리 퇴원생.
  var [{ first: firstCreated }] = await db`select min(created_at) first from public.enrollments where tenant_id=${t}`;
  var cleanupIds = (await db`select id::text id, withdrawal_metadata md from public.students where tenant_id=${t} and status = 'withdrawn'`)
    .filter((s) => V.isCleanupExit(s.md)).map((s) => s.id);
}

test('재원생: 2.0 칸 = 독립 SQL(재원 상태 − 열린 수강이 전부 아직 시작 전인 학생) = 큰 숫자', { skip: SKIP }, async (tc) => {
  tc.diagnostic(`계산 ${elapsed}ms · 기준일 ${asOf}`);
  const [{ n }] = await db`select count(*)::int n from public.students s where s.tenant_id=${t} and s.status = 'enrolled'
    and not (exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = s.id and e.end_date is null and not e.on_hold)
      and not exists (select 1 from public.enrollments e join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = s.id and e.end_date is null and not e.on_hold
        and (e.start_date is null or e.start_date <= ${asOf})))`;
  assert.equal(out.cards.students, n);
  assert.equal(K['재원생'].value, n);
});

test('강좌수: 2.0 칸 = 독립 SQL(재원생 × 오늘 듣는 과목 묶음 — 같은 과목 반은 하나) = 큰 숫자', { skip: SKIP }, async () => {
  const rows = await db`select distinct e.student_id::text sid, c.subject from public.enrollments e join public.classes c on c.id = e.class_id
    join public.students s on s.id = e.student_id where e.tenant_id=${t} and s.status = 'enrolled' and not e.on_hold and coalesce(c.subject, '') <> ''
      and (e.start_date is null or e.start_date <= ${asOf})
      and (e.end_date is null or case when coalesce(e.is_transferred, false) then e.end_date > ${asOf} else e.end_date >= ${asOf} end)`;
  const n = new Set(rows.map((r) => `${r.sid}|${group(r.subject)}`)).size;
  assert.equal(out.cards.courses, n);
  assert.equal(K['강좌수'].value, n);
});

// 2.0 재원생·강좌수 추이의 판정(enrolled-trend countedOn · course-trend coursesOn · trend-billing billedOn·billedExitRows)을 시험 쪽에서 따로 적어
// 원본 줄로 센다. 2.0의 '오늘' = 복사본 날짜(asOf) — 그날 점만 강좌에서 휴원 수강을 뺀다. 청구가 지점을 덮기 시작한 달만 2.0 순수 함수
// (coverageStartFromCounts)에 따로 센 달별 건수를 넣어 얻는다.
async function enrolledOnPast() {
  const thisMonth = asOf.slice(0, 7), PERIOD = '^\\d{4}-\\d{2}$';
  const shift = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
  const [students, enr, src] = await Promise.all([
    db`select id::text id, status::text status, enrolled_at::text enrolled_at, withdrawn_at::text withdrawn_at, coalesce(notes, '') ~ ${MERGE} merged, withdrawal_metadata md
      from public.students where tenant_id=${t}`,
    db`select e.student_id::text sid, e.class_id::text cid, e.start_date::text start, e.end_date::text "end", coalesce(e.is_transferred, false) tr, coalesce(e.on_hold, false) hold, c.subject
      from public.enrollments e left join public.classes c on c.id = e.class_id and c.tenant_id=${t} where e.tenant_id=${t}`,
    readFile(new URL('../../src/features/dashboard/overview/trend-billing-server.ts', import.meta.url), 'utf8')]);
  const search = Number(src.match(/const SEARCH_MONTHS = (\d+);/)[1]);
  const cleanupIds = students.filter((s) => s.status === 'withdrawn' && V.isCleanupExit(s.md)).map((s) => s.id);
  let billingFrom = null;
  const billed = new Map();
  if (cleanupIds.length) {
    const counts = new Map((await db`select period, count(*)::int n from public.invoices where tenant_id=${t} and category = 'tuition' and status::text not in ('void', 'refunded')
      and period ~ ${PERIOD} and period between ${shift(thisMonth, -(search - 1))} and ${thisMonth} group by 1`).map((r) => [r.period, r.n]));
    billingFrom = V.coverageStartFromCounts(counts, thisMonth);
    for (const r of await db`select student_id::text sid, array_agg(distinct period) months from public.invoices where tenant_id=${t} and student_id = any(${cleanupIds}::uuid[])
        and coalesce(category, 'tuition') = 'tuition' and status::text not in ('void', 'refunded') and period ~ ${PERIOD} group by 1`) billed.set(r.sid, r.months);
  }
  const rows = new Map(), firstStart = new Map(), hasEnded = new Set();
  for (const e of enr) {
    rows.set(e.sid, [...(rows.get(e.sid) ?? []), e]);
    if (e.end) hasEnded.add(e.sid);
    if (e.start && (!firstStart.has(e.sid) || e.start < firstStart.get(e.sid))) firstStart.set(e.sid, e.start);
  }
  // 장부 정리 학생(수업 기록 있음)은 청구가 지점을 덮은 달부터 오늘 전까지는 청구가 살아 있는 달에만 — 그 밖의 날은 null(퇴원일 규칙).
  const billedOn = (s, d) => (!billingFrom || d >= asOf || d.slice(0, 7) < billingFrom ? null : (billed.get(s.id) ?? []).includes(d.slice(0, 7)));
  const counted = (s, d) => {
    if ((s.status !== 'enrolled' && s.status !== 'withdrawn') || s.merged) return false;
    const enrolled = s.enrolled_at?.slice(0, 10) ?? firstStart.get(s.id) ?? (s.status === 'enrolled' ? '0000-00-00' : null);
    if (!enrolled || enrolled > d || (firstStart.get(s.id) ?? '') > d) return false;
    const cleanup = s.status === 'withdrawn' && V.isCleanupExit(s.md);
    if (cleanup && !hasEnded.has(s.id)) return false;
    if (cleanup && billedOn(s, d) !== null) return billedOn(s, d);
    const out = s.withdrawn_at?.slice(0, 10);
    if (out && out <= d) return false;
    if (s.status !== 'withdrawn') return true;
    // 퇴원했는데 날짜가 없으면 모른다 · 시스템 정리(그날짜 · 수업 기록 없음)는 통째로 뺀다.
    return !!out && !(V.SYSTEM_BULK_WITHDRAWAL_DATES.includes(out) && !hasEnded.has(s.id));
  };
  const courses = (s, d) => {
    const mine = rows.get(s.id) ?? [];
    let picked = mine.filter((e) => e.cid !== null && !(e.end && (e.tr ? e.end <= d : e.end < d)) && !(d === asOf && e.hold) && (!e.start || e.start <= d));
    if (!picked.length && s.status === 'withdrawn' && V.isCleanupExit(s.md) && billedOn(s, d) === true) {
      // 수강은 끝났는데 청구가 살아 있는 달 — 마지막 종료일에서 14일 안에 끝난 반(반이동 줄은 빼고, 전부 반이동이면 마지막 줄 하나).
      const ended = mine.filter((e) => e.end && e.end <= d), last = ended.reduce((m, e) => (!m || e.end > m ? e.end : m), null);
      const exit = last ? ended.filter((e) => e.end >= new Date(Date.parse(`${last}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10)) : [];
      picked = exit.some((e) => !e.tr) ? exit.filter((e) => !e.tr) : exit.length ? [exit.reduce((m, e) => (e.end > m.end ? e : m))] : [];
    }
    return new Set(picked.filter((e) => e.cid !== null).map((e) => group(e.subject)).filter((g) => g !== null)).size;
  };
  return (d) => students.reduce((n, s) => (counted(s, d) ? { students: n.students + 1, courses: n.courses + courses(s, d) } : n), { students: 0, courses: 0 });
}

test('재원생·강좌수 추이: 달마다 한 점(에이와 기록이 갖춰진 달부터) · 지난 달 점·추이가 센 오늘 점 = 따로 센 값 · 오늘 점 = 칸 · 기록 범위 = 밤 기록이 적어 둔 값', { skip: SKIP }, async (tc) => {
  const [mark] = await db`select trust_from from public.record_coverage_marks where tenant_id=${t}`;
  if (mark) assert.equal(out.trustFrom, mark.trust_from, '밤 기록이 적어 둔 기록 범위');
  else assert(out.trustFrom === null || /^\d{4}-\d{2}$/.test(out.trustFrom));
  const on = await enrolledOnPast();
  // 추이가 스스로 센 오늘 점 — 2.0 판정을 따로 적은 계산과 같아야 한다. 칸과 다르면 2.0도 아는 드문 경우라 알리기만 한다.
  assert.deepEqual(out.trendToday, on(asOf), '추이가 센 오늘 점 = 따로 센 값');
  if (out.trendToday.students !== out.cards.students || out.trendToday.courses !== out.cards.courses) {
    tc.diagnostic(`추이 오늘 점 ${JSON.stringify(out.trendToday)} ≠ 칸 ${out.cards.students}/${out.cards.courses} — 큰 숫자는 칸을 따른다`);
  }
  for (const [k, field] of [[K['재원생'], 'students'], [K['강좌수'], 'courses']]) {
    const months = k.points.map((p) => monthOf(p.label));
    assert.equal(months.at(-1), asOf.slice(0, 7), `${k.label}: 마지막 점 = 이번 달`);
    assert.deepEqual(months, monthsBack(months.length), `${k.label}: 빈 달 없이 이번 달까지`);
    if (out.trustFrom) assert(months[0] >= out.trustFrom, `${k.label}: 기록 범위 전 달은 그리지 않는다`);
    assert.equal(k.value, out.cards[field], `${k.label}: 큰 숫자 = 칸`);
    assert.equal(k.points.at(-1).value, out.cards[field], `${k.label}: 오늘 점 = 칸`);
    for (const [i, m] of months.slice(0, -1).entries()) assert.equal(k.points[i].value, on(lastDay(m))[field], `${k.label} ${m} 말일`);
    assert.equal(k.period, 'month'); assert.equal(k.span, '오늘 기준'); assert.equal(k.better, 'up');
  }
  assert(K['재원생'].points.length > 1, '지난 달 점이 있어야 판정이 시험된다');
});

// 퇴원&수업종료(2.0 monthWithdrawals) — 그 달 1일 ~ 그날. 퇴원 = 과목마다 한 줄(퇴원 무렵 14일 안에 끝난 과목, 없으면 한 줄) · 병합·수업 기록 없는 장부 정리·
// 시스템 정리 제외 · 추세 점은 단체 장부 정리도 뺀다. 수업종료 = 재원·휴원 학생이 그날 기준 한 과목 수강을 모두 끝냄(끝난 특강 제외 · 마지막 수강이 반이동이면 제외).
// 지난 날짜(복사본 날짜 전)는 그날 뒤에 퇴원한 학생(병합 제외 · 추세면 단체 장부 정리 퇴원생도 제외)도 그날 재원생으로 보고, 그날 복사본을 뜬
// 시각 뒤에 만든 수강은 뺀다 — 단 그 시각이 지점의 첫 수강 생성 전이면 컷을 걸지 않는다(첫 묶음은 옛 기록을 옮긴 것).
// `current` = 하한 비교용: 지금 재원·휴원 학생만 · 컷 없음(지난 날짜 규칙은 그 날짜의 재원생을 더하기만 한다).
async function exitCount(day, trend, { current = false } = {}) {
  const from = `${day.slice(0, 7)}-01`, past = day < asOf && !current, cutAt = cut(day), createdCut = past && cutAt >= firstCreated;
  const withdrawn = await db`with w as (select s.id, s.withdrawn_at::text withdrawn_at, s.withdrawal_metadata md from public.students s
        where s.tenant_id=${t} and s.status = 'withdrawn' and s.withdrawn_at between ${from} and ${day} and coalesce(s.notes, '') !~ ${MERGE}),
      ended as (select e.student_id, e.end_date, c.subject from public.enrollments e left join public.classes c on c.id = e.class_id
        where e.tenant_id=${t} and e.end_date is not null and e.student_id in (select id from w)),
      last as (select student_id, max(end_date) last from ended group by 1)
    select w.id::text id, w.withdrawn_at, w.md, l.last is not null hist,
      (select count(distinct x.subject)::int from ended x where x.student_id = w.id and coalesce(x.subject, '') <> '' and x.end_date >= l.last - 14) subjects
    from w left join last l on l.student_id = w.id order by w.id`;
  const kept = withdrawn.filter((r) => !(V.isCleanupExit(r.md) && !r.hist) && !(V.SYSTEM_BULK_WITHDRAWAL_DATES.includes(r.withdrawn_at) && !r.hist) && !(trend && V.isCleanupExit(r.md)));
  const [{ n: ended }] = await db`with e as (select e.id, e.student_id, c.subject, e.start_date, e.end_date, coalesce(e.is_transferred, false) tr,
        (coalesce(c.is_special, false) or position('특강' in coalesce(c.class_name, '')) > 0) sp
      from public.enrollments e join public.students s on s.id = e.student_id and s.tenant_id=${t}
        and (s.status in ('enrolled', 'on_hold') or (${past}::boolean and s.status = 'withdrawn' and s.withdrawn_at > ${day} and coalesce(s.notes, '') !~ ${MERGE}
          and not (${trend}::boolean and s.id = any(${cleanupIds}::uuid[]))))
      join public.classes c on c.id = e.class_id where e.tenant_id=${t} and coalesce(c.subject, '') <> '' and (not ${createdCut}::boolean or e.created_at <= ${cutAt})),
    e2 as (select *, (end_date is not null and case when tr then end_date <= ${day} else end_date < ${day} end) done from e),
    counted as (select * from e2 where not (sp and done)),
    subj as (select student_id, subject from counted group by 1, 2 having bool_and(done)),
    best as (select distinct on (c.student_id, c.subject) c.student_id, c.subject, c.tr from counted c join subj using (student_id, subject)
      order by c.student_id, c.subject, c.end_date desc, c.start_date desc nulls last, c.id desc),
    last_end as (select student_id, subject, max(end_date) at from e2 group by 1, 2)
    select count(*)::int n from best b join last_end l using (student_id, subject) where not b.tr and l.at between ${from} and ${day}`;
  // cleanup = 수업 기록 있는 단체 장부 정리 퇴원의 줄 수(칸엔 들고 추세 점엔 안 드는 몫).
  return { total: kept.reduce((n, r) => n + Math.max(1, r.subjects), 0) + ended,
    cleanup: withdrawn.filter((r) => V.isCleanupExit(r.md) && r.hist).reduce((n, r) => n + Math.max(1, r.subjects), 0) };
}

test('퇴원·수업종료: 큰 숫자 = 2.0 칸 = 독립 SQL · 달마다 1일~같은 날 점 6개 = 같은 SQL(단체 장부 정리 퇴원 제외) · 전월 대비 = 점끼리 · 이관 전 날짜도 센다', { skip: SKIP }, async () => {
  const card = await exitCount(asOf, false);
  assert.equal(out.cards.withdrawals, card.total);
  const k = K['퇴원·수업종료'], months = monthsBack(6);
  assert.equal(k.value, card.total, '큰 숫자 = 칸(이번 달 단체 장부 정리 퇴원도 든다)');
  assert.deepEqual(k.points.map((p) => p.label), months.map(yymm));
  let cleanupMonths = 0;
  for (const [i, m] of months.entries()) {
    const day = sameDay(m), [trendN, cardN] = [await exitCount(day, true), await exitCount(day, false)];
    assert.equal(k.points[i].value, trendN.total, `${m} 1일~${day.slice(8)}일`);
    // 칸 − 점 ≥ 이번 달 장부 정리 퇴원 줄(그날 뒤 퇴원한 장부 정리 학생의 수업종료도 칸에만 든다).
    assert(cardN.total - trendN.total >= trendN.cleanup, `${m}: 칸과 점의 차이 ≥ 수업 기록 있는 단체 장부 정리 퇴원`);
    if (trendN.cleanup > 0) cleanupMonths += 1;
    // 지난 날짜 규칙은 그날의 재원생을 더하기만 한다 — 첫 수강 생성 전 날짜(컷 없음)의 점은 지금 재원생만 센 값보다 작을 수 없다(모듈 값에 건다).
    if (day < asOf && cut(day) < firstCreated) assert(k.points[i].value >= (await exitCount(day, true, { current: true })).total, `${m}: 이관 전 날짜를 지우지 않는다`);
  }
  // 전월 대비 = 선의 점끼리(점 팝오버와 같은 비교) — 큰 숫자(칸)와 마지막 점은 장부 정리 퇴원만큼 다를 수 있다.
  assert.equal(k.previous, k.points.at(-2).value);
  assert.equal(k.delta, k.points.at(-1).value - k.points.at(-2).value, '전월 대비 = 장부 정리를 뺀 점끼리');
  if (card.cleanup > 0) assert.notEqual(k.value, k.points.at(-1).value, '이번 달 장부 정리 퇴원이 있으면 큰 숫자와 마지막 점이 다르다');
  else assert.equal(k.value, k.points.at(-1).value);
  if (!cleanupMonths) console.log('# 참고: 6개월 안에 수업 기록 있는 단체 장부 정리 퇴원이 없어 추세 제외 규칙은 이 복사본에서 시험되지 않았다');
  assert.equal(k.better, 'down');
});

test('신규문의: 2.0 칸(오늘 접수) = 독립 SQL · 최근 7일 창 8개 = 창마다 같은 시각까지 접수 수 · 마지막 창 = 7일 전체', { skip: SKIP }, async () => {
  const [{ n: today }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and created_at >= ${kst(asOf)} and created_at < ${kst(addDays(asOf, 1))}`;
  assert.equal(out.cards.intakeToday, today);
  const k = K['신규문의'], weeks = weekWindows(asOf, 8);
  assert.deepEqual(k.points.map((p) => p.label), weeks.map((w) => w.label));
  const [{ first }] = await db`select min(created_at) first from public.enrollment_consultations where tenant_id=${t}`;
  for (const [i, w] of weeks.entries()) {
    const [{ n }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and created_at >= ${kst(w.from)} and created_at < ${cut(w.to)}`;
    assert.equal(k.points[i].value, kst(w.from) < first ? null : n, w.label);
  }
  // 복사본을 뜬 뒤의 접수는 없다 — 마지막 창(그 시각까지) = 7일 하루 전체 합.
  const [{ n: full }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and created_at >= ${kst(weeks[7].from)} and created_at < ${kst(addDays(asOf, 1))}`;
  assert.equal(k.value, full);
  assert(k.points.some((p) => p.value > 0), '접수가 있는 창이 있어야 의미가 있다');
});

// 2.0 getEnrolledRecent를 창 [startIso, endIso)·기준일 `today`로 다시 센 줄(등록 완료가 된 날) — 상태 로그 쪽(지금도 등록 완료) + 반 배정 쪽(assignedEntries).
// 판정은 코드와 같은 2.0 순수 함수다 — 이 시험이 증명하는 것은 ① 이달 신규 칸이 2.0 조회 창·가르기(splitEnrolledRecent) 그대로라는 것,
// ② 넓은 창을 한 번 읽어 창마다 자른 값 = 창마다 따로 조회한 값(넓은 창의 후보가 좁은 창 후보를 다 품는다)이라는 것이다.
async function enrolledRows(startIso, endIso, today) {
  const logs = await db`select metadata, to_json(created_at)#>>'{}' created_at from public.audit_logs where tenant_id=${t} and action = 'enrollment_consultation_outcome'
    and metadata->>'to' = 'enrolled' and created_at >= ${startIso} and created_at < ${endIso} order by created_at, id`;
  const movedAt = V.enrollmentEventTimes(logs);
  const moved = movedAt.size ? await db`select id::text id, outcome::text outcome from public.enrollment_consultations where tenant_id=${t} and id = any(${[...movedAt.keys()]}::uuid[])` : [];
  const viaLog = moved.filter((c) => c.outcome === 'enrolled').map((c) => ({ date: V.kstDateOf(movedAt.get(c.id)) }));
  const inWindowStudents = (await db`select distinct student_id::text s from public.enrollments where tenant_id=${t} and created_at >= ${startIso} and created_at < ${endIso}`).map((r) => r.s);
  const candidates = new Map([...(await db`select id::text id, subject, student_id::text student_id, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
      where tenant_id=${t} and outcome::text <> 'enrolled' and student_id is not null and created_at >= ${startIso} and created_at < ${endIso}`),
    ...(inWindowStudents.length ? await db`select id::text id, subject, student_id::text student_id, to_json(created_at)#>>'{}' created_at from public.enrollment_consultations
      where tenant_id=${t} and outcome::text <> 'enrolled' and student_id = any(${inWindowStudents}::uuid[])` : [])].map((c) => [c.id, c]));
  const ids = [...new Set([...candidates.values()].map((c) => c.student_id))];
  const enr = ids.length ? await db`select e.student_id::text sid, to_json(e.created_at)#>>'{}' created_at, e.end_date::text end_date, c.subject from public.enrollments e
    join public.classes c on c.id = e.class_id where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[])` : [];
  const keysOf = V.consultClassKeysOf(subjects);
  const viaAssignment = [...candidates.values()].flatMap((c) => {
    const at = V.assignedEntryAt({ consultCreatedAt: c.created_at, classKeys: keysOf(c.subject), today,
      enrollments: enr.filter((e) => e.sid === c.student_id).map((e) => ({ subject: e.subject, createdAt: e.created_at, endDate: e.end_date })) });
    return at && Date.parse(at) >= Date.parse(startIso) && Date.parse(at) < Date.parse(endIso) ? [{ date: V.kstDateOf(at) }] : [];
  });
  return [...viaLog, ...viaAssignment];
}

test('신규 등록: 2.0 칸(이달 신규) = 2.0 조회 창·가르기 그대로 · 최근 7일 창 8개 = 창마다 같은 시각까지 다시 센 값 · 상태 변경 기록 전 창은 기록 없음', { skip: SKIP }, async () => {
  // 2.0 칸 — 조회 창 = 전일 첫날과 이번 달 1일 중 이른 날 ~ 오늘 끝, 이번 달로 가른다.
  const month = V.splitEnrolledRecent(await enrolledRows(kst(V.enrolledRecentFrom(asOf)).toISOString(), kst(addDays(asOf, 1)).toISOString(), asOf), asOf).month.length;
  assert.equal(out.cards.enrolledMonth, month);
  const k = K['신규 등록'], weeks = weekWindows(asOf, 8);
  assert.deepEqual(k.points.map((p) => p.label), weeks.map((w) => w.label));
  const [{ first }] = await db`select min(created_at) first from public.audit_logs where tenant_id=${t} and action = 'enrollment_consultation_outcome'`;
  for (const [i, w] of weeks.entries()) {
    const expect = kst(w.from) < first ? null : (await enrolledRows(kst(w.from).toISOString(), cut(w.to).toISOString(), w.to)).length;
    assert.equal(k.points[i].value, expect, w.label);
  }
  // 복사본을 뜬 뒤의 일은 없다 — 마지막 창(그 시각까지) = 7일 하루 전체.
  assert.equal(k.value, (await enrolledRows(kst(weeks[7].from).toISOString(), kst(addDays(asOf, 1)).toISOString(), asOf)).length);
  // 기록 전 창 = '기록 없음'(위 창마다 대조) — 첫 창이 기록 시작 전이면 null 창이 반드시 있다.
  if (kst(weeks[0].from) < first) assert(k.points.some((p) => p.value === null), '상태 변경 기록 전 창은 기록 없음');
  assert(k.points.some((p) => p.value > 0), '등록이 있는 창이 있어야 의미가 있다');
  assert.equal(k.period, 'week'); assert.equal(k.span, '최근 7일'); assert.equal(k.better, 'up');
});

test('지난 기준일: 창 끝 = 그날 복사본을 뜬 시각(복사본 날짜에서 거꾸로) · 복사본 날짜 뒤는 거절', { skip: SKIP }, async () => {
  const past = addDays(asOf, -7), weeks = weekWindows(past, 8);
  const p = await ro((sql) => studentStatusKpis({ sql, asOf: past, tenantId: t, importV2 }));
  const k = p.kpis.find((x) => x.label === '신규문의');
  assert.deepEqual(k.points.map((x) => x.label), weeks.map((w) => w.label));
  const [{ first }] = await db`select min(created_at) first from public.enrollment_consultations where tenant_id=${t}`;
  for (const [i, w] of weeks.entries()) {
    const [{ n }] = await db`select count(*)::int n from public.enrollment_consultations where tenant_id=${t} and created_at >= ${kst(w.from)} and created_at < ${cut(w.to)}`;
    assert.equal(k.points[i].value, kst(w.from) < first ? null : n, w.label);
  }
  // 재원생·강좌수: 그 기준일 달 전의 점은 지금 기준일과 같고, 그날 칸 = 추이의 그날 점 = 따로 센 값(칸 조회는 지금 상태로만 세어 그날로 되감지 못한다).
  const on = await enrolledOnPast(), before = (pts) => pts.filter((x) => monthOf(x.label) < past.slice(0, 7));
  for (const [label, field] of [['재원생', 'students'], ['강좌수', 'courses']]) {
    const pk = p.kpis.find((x) => x.label === label);
    assert.deepEqual(before(pk.points), before(K[label].points), label);
    assert.equal(pk.value, pk.points.at(-1).value); assert.equal(p.cards[field], pk.value);
    assert.equal(pk.value, on(past)[field], `${label}: 지난 기준일 큰 숫자 = 따로 센 그날 값`);
  }
  // 지금 기준일의 같은 창(한 주 전 창)과 값이 같다 — 같은 시각까지 센다.
  assert.deepEqual(k.points.slice(1).map((x) => x.value), K['신규문의'].points.slice(0, 7).map((x) => x.value));
  assert.deepEqual(p.kpis.find((x) => x.label === '신규 등록').points.slice(1), K['신규 등록'].points.slice(0, 7));
  await assert.rejects(ro((sql) => studentStatusKpis({ sql, asOf: addDays(asOf, 1), tenantId: t, importV2 })), /복사본 날짜/);
});

test('지난 달들의 같은 날을 기준일로: 재원생·강좌수 칸 = 따로 센 그날 값 · 퇴원·수업종료 칸과 점 = 같은 SQL', { skip: SKIP }, async () => {
  // 장부 정리 청구 판정의 '오늘'이 복사본 날짜여야 같은 선의 그날 점과 같다(기준일을 '오늘'로 넘기면 청구가 살아 있는 달에 갈린다).
  const on = await enrolledOnPast();
  for (const m of monthsBack(4).slice(0, 3)) {
    const day = sameDay(m), p = await ro((sql) => studentStatusKpis({ sql, asOf: day, tenantId: t, importV2 }));
    assert.deepEqual({ students: p.cards.students, courses: p.cards.courses }, on(day), `${day}: 재원생·강좌수`);
    const ex = p.kpis.find((x) => x.label === '퇴원·수업종료');
    assert.equal(ex.value, (await exitCount(day, false)).total, `${day}: 퇴원 칸`);
    assert.equal(ex.points.at(-1).value, (await exitCount(day, true)).total, `${day}: 퇴원 점`);
  }
});

test('그날 뒤에 퇴원한 단체 장부 정리 학생: 그날 칸의 수업종료엔 들고 추세 점엔 안 든다', { skip: SKIP }, async (tc) => {
  // 데이터에서 고른다 — 수업 기록이 있는 장부 정리 퇴원생 중 모든 수강이 퇴원일보다 이틀 이상 앞서 끝난 학생의 '끝난 다음 날'(복사본 날짜 6개월 안).
  const from = `${monthsBack(6)[0]}-01`;
  const rows = (await db`select s.id::text id, s.withdrawn_at::text withdrawn_at, s.withdrawal_metadata md, max(e.end_date)::text last_end
      from public.students s join public.enrollments e on e.student_id = s.id and e.tenant_id = ${t}
      where s.tenant_id=${t} and s.status = 'withdrawn' and coalesce(s.notes, '') !~ ${MERGE}
        and not exists (select 1 from public.enrollments o where o.tenant_id=${t} and o.student_id = s.id and o.end_date is null)
      group by s.id having max(e.end_date) + 1 < s.withdrawn_at order by s.withdrawn_at, s.id`)
    .filter((r) => V.isCleanupExit(r.md)).map((r) => ({ ...r, day: addDays(r.last_end, 1) })).filter((r) => r.day >= from && r.day < asOf);
  if (!rows.length) { tc.skip('이 복사본엔 그런 학생이 없다'); return; }
  let shown = false;
  for (const r of rows.slice(0, 4)) {
    const p = await ro((sql) => studentStatusKpis({ sql, asOf: r.day, tenantId: t, importV2 }));
    const ex = p.kpis.find((x) => x.label === '퇴원·수업종료'), [cardN, trendN] = [await exitCount(r.day, false), await exitCount(r.day, true)];
    assert.equal(ex.value, cardN.total, `${r.day}: 칸`); assert.equal(ex.points.at(-1).value, trendN.total, `${r.day}: 점`);
    if (cardN.total - trendN.total > trendN.cleanup) shown = true;
  }
  assert(shown, '고른 날 가운데 하나는 칸에만 든 수업종료가 있어야 한다(규칙이 실제로 시험된다)');
});

test('화면 문구: 이름·기간·설명·점 라벨에 2.0·영문 없음 · 다섯 칸 순서와 단위', { skip: SKIP }, () => {
  assert.deepEqual(out.kpis.map((k) => [k.label, k.unit, k.span, k.period]),
    [['재원생', '명', '오늘 기준', 'month'], ['강좌수', '개', '오늘 기준', 'month'], ['퇴원·수업종료', '명', '이번 달', 'month'], ['신규문의', '건', '최근 7일', 'week'], ['신규 등록', '명', '최근 7일', 'week']]);
  for (const k of out.kpis) {
    const text = [k.label, k.span, k.basis, ...k.points.map((p) => p.label)].join(' ');
    assert.doesNotMatch(text, /2\.0/, k.label);
    assert.doesNotMatch(text, /[A-Za-z]/, `${k.label}: ${text}`);
    assert(k.basis.length > 0, `${k.label}: 무엇을 무엇으로 셌는지`);
  }
});

test('같은 트랜잭션에서 두 번 부르면 한 번 계산 · 지점 기본값도 같은 열쇠 · 실패는 기억하지 않는다', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const first = studentStatusKpis({ sql, asOf, tenantId: t, importV2 });
    assert.equal(studentStatusKpis({ sql, asOf, importV2 }), first);
    assert.notEqual(first, outP, '다른 트랜잭션은 따로 센다');
    const value = await first;
    assert.deepEqual(value.kpis, out.kpis, '다른 트랜잭션에서 센 값과 같다');
    const bad = studentStatusKpis({ sql, asOf: 'x', tenantId: t, importV2 });
    await assert.rejects(bad, /기준일/);
    const again = studentStatusKpis({ sql, asOf: 'x', tenantId: t, importV2 });
    assert.notEqual(again, bad, '실패한 계산은 다시 한다');
    await assert.rejects(again);
  });
});

test.after(() => db?.end());
