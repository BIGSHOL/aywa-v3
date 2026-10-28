// 운영실 상담·운영 영역 이식 시험 — node --test experiments/owner-concept/verify-v2-dashboard-admissions.mjs
// 영역 함수(v2-dashboard-admissions.mjs)를 조립부와 같은 방식(읽기 전용 트랜잭션 · 영역마다 저장점 · 같은 ctx)으로 한 번 부르고, 카드에 보이는 숫자를
// 2.0 조건을 시험 쪽에서 따로 적은 SQL·계산과 대조한다. 값 모양은 2.0 타입 선언(src)에서 읽은 키와 맞춘다. 복사본 DB가 없으면 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const SRC = new URL('../../src/', import.meta.url);

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { queryGate, rules, resolveSettings, copyClock, userPermMatrix } = await import('./v2-onescreen-roster.mjs');
  var { ADMISSIONS_AREAS } = await import('./v2-dashboard-admissions.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), today = clock.day, RR = await rules(importV2);
  var kst = (d) => new Date(`${d}T00:00:00+09:00`);
  var addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  var shiftMonth = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
  var squash = (s) => (s ?? '').replace(/\s+/g, '');
  var out = {}, ms = {}, ctx, claims;
  await ro(async (tx) => {
    const sql = queryGate(tx);
    const [[row], [{ name }]] = await Promise.all([tx`select data from public.tenant_settings where tenant_id=${t}`, tx`select name from public.tenants where id=${t}`]);
    const settings = resolveSettings(RR, row?.data ?? {}, name);
    // 보는 사람 = 조립부와 같은 기본값(재직 원장 중 운영 계정이 아닌, 최근 30일 감사로그 활동이 가장 많은 사람).
    const masters = await tx`select u.id::text id, u.display_name name, u.system_role::text role, u.subjects, u.ui_prefs, exists(select 1 from public.super_admins sa where sa.id = u.id) super,
        (select count(*)::int from public.audit_logs a where a.tenant_id=${t} and a.actor_id = u.id and a.created_at > ${new Date(clock.at.getTime() - 30 * 86400000)} and a.created_at <= ${clock.at}) recent
      from public.users u where u.tenant_id=${t} and u.status::text = 'active' and u.system_role::text = 'master' order by u.display_name, u.id`;
    const user = masters.filter((r) => !r.super).sort((a, b) => b.recent - a.recent)[0];
    const matrix = await userPermMatrix(sql, RR, settings, { id: user.id, system_role: user.role }, t, clock.at);
    ctx = { t, today, clock, settings, allowed: RR.MENU_KEYS.filter((key) => RR.canAccess(user.role, key, matrix)), user, importV2, RR, memo: new Map() };
    const before = (await tx`select current_setting('request.jwt.claims', true) c`)[0].c;
    for (const [area, fn] of Object.entries(ADMISSIONS_AREAS)) {
      const t0 = performance.now();
      out[area] = await sql.soft(async (sp) => ({ data: await fn(ctx, sp) }), (error) => ({ error }));
      ms[area] = Math.round(performance.now() - t0);
    }
    claims = { before, after: (await tx`select current_setting('request.jwt.claims', true) c`)[0].c };
  });
  var D = (area) => out[area].data;
}

/** 2.0 타입 선언의 맨 위 키(필수 = true · `?` = false) — 주석을 걷고 `{` 한 겹 안의 `키:`만 모은다. `anchors`를 차례로 찾아 마지막 것 뒤의 `{`. */
async function typeKeys(file, ...anchors) {
  const src = (await readFile(new URL(file, SRC), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  let at = 0;
  for (const a of anchors) { at = src.indexOf(a, at); assert(at >= 0, `${file}: ${a}`); }
  let depth = 0, flat = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth += 1; if (depth === 1) continue; }
    if (c === '}') { depth -= 1; if (depth === 0) break; }
    if (depth === 1) flat += c;
  }
  return Object.fromEntries([...flat.matchAll(/(?:^|[;\n{,}])\s*(\w+)(\?)?\s*:/g)].map((m) => [m[1], !m[2]]));
}
function sameShape(value, keys, label) {
  assert(value && typeof value === 'object', `${label}: 값이 객체가 아니다`);
  for (const [k, required] of Object.entries(keys)) if (required) assert(k in value, `${label}: ${k}이(가) 없다`);
  for (const k of Object.keys(value)) assert(k in keys, `${label}: 2.0 타입에 없는 ${k}`);
}

test('여덟 영역 모두 조회 실패 없이 값을 낸다 · 영역별 시간 · 신분(request.jwt.claims)은 건드리지 않는다 · 상담 후보는 한 번만 읽는다', { skip: SKIP }, (tc) => {
  tc.diagnostic(`기준일 ${today} · 보는 사람 ${ctx.user.name} · ${Object.entries(ms).map(([a, n]) => `${a} ${n}ms`).join(' · ')}`);
  for (const [area, r] of Object.entries(out)) assert(!r.error, `${area}: ${r.error?.message}`);
  assert.equal(claims.after, claims.before);
  if (ctx.allowed.includes('enrollment')) assert.equal(ctx.memo.get('admissions:consultationRows')?.length, Object.keys(D('consultProgress').chips).length, '일정 카드와 상담 진행이 같은 상담 집합');
});

test('값 모양 = 2.0 타입 선언의 키', { skip: SKIP }, async () => {
  const stats = D('admissions');
  sameShape(stats, await typeKeys('features/enrollment/server/stats-queries.ts', 'export type EnrollmentStats ='), '콜&상담 전환');
  const month = await typeKeys('features/enrollment/server/stats-queries.ts', 'export type MonthStat =');
  for (const m of stats.months) sameShape(m, month, `콜&상담 전환 ${m.month}`);
  sameShape(D('consultations'), await typeKeys('features/consultations/server/queries.ts', 'export type StudentConsultationCounts ='), '원생상담');
  const care = D('newcomers');
  sameShape(care, await typeKeys('features/dashboard/overview/model.ts', 'export type CareSummary ='), '신규생');
  const stage = await typeKeys('features/dashboard/overview/student-composition.ts', 'export type SubjectDistributionRow =');
  const split = await typeKeys('features/dashboard/overview/student-composition.ts', 'export type StudentSubjectSplit =');
  for (const s of care.stages) { sameShape(s, stage, `신규생 단계 ${s.label}`); sameShape(s.subjects, split, `신규생 단계 ${s.label} 과목`); }
  const item = await typeKeys('features/dashboard/overview/model.ts', 'export type CareSummary =', 'items:');
  for (const i of care.items) sameShape(i, item, `신규생 항목 ${i.label}`);
  const row = await typeKeys('features/dashboard/overview/model.ts', 'export type OverviewData =', 'calendar:');
  for (const r of D('calendar')) sameShape(r, row, `일정 ${r.title}`);
  const progress = D('consultProgress');
  sameShape(progress, await typeKeys('features/dashboard/overview/consultation-progress.ts', 'export type ConsultProgressData ='), '상담 진행');
  sameShape(progress.summary, await typeKeys('features/dashboard/overview/consultation-progress.ts', 'export type ProgressSummary ='), '상담 진행 요약');
  sameShape(progress.summary.counts, await typeKeys('features/dashboard/overview/consultation-progress.ts', 'export type ProgressCounts ='), '상담 진행 단계 수');
  const stall = await typeKeys('features/dashboard/overview/consultation-progress.ts', 'export type StalledConsult =');
  for (const s of progress.summary.stalled) sameShape(s, stall, `멈춘 상담 ${s.name}`);
  const chip = await typeKeys('features/dashboard/overview/consultation-progress.ts', 'export type ProgressChip =');
  for (const c of Object.values(progress.chips)) sameShape(c, chip, '상담 칩');
  const staffRow = await typeKeys('features/dashboard/overview/staff-subjects.ts', 'export type StaffRow =');
  for (const s of D('staff')) sameShape(s, staffRow, `직원 ${s.label}`);
  const op = await typeKeys('features/dashboard/overview/model.ts', 'export type OperationCount =');
  for (const o of D('operations')) sameShape(o, op, `운영 ${o.label}`);
  const notice = await typeKeys('features/dashboard/server/queries.ts', 'export type AnnouncementRow =');
  for (const n of D('notices')) sameShape(n, notice, `공지 ${n.title}`);
});

test('콜&상담 전환: 지난달·이번 달 칸 = 독립 SQL(상담일 KST 날짜로 달을 가른 성과) · 합계·전환율', { skip: SKIP }, async () => {
  const cur = today.slice(0, 7), prev = shiftMonth(cur, -1), next = shiftMonth(cur, 1);
  const rows = await db`select to_char((consulted_at at time zone 'Asia/Seoul')::date, 'YYYY-MM') m, count(*)::int total,
      count(*) filter (where outcome::text = 'enrolled')::int enrolled, count(*) filter (where outcome::text = 'declined')::int declined,
      count(*) filter (where outcome::text = 'no_show')::int no_show, count(*) filter (where outcome::text in ('pending', 'scheduled', 'consulted', 'ai_done'))::int open,
      coalesce(sum(payment_amount) filter (where outcome::text = 'enrolled'), 0)::float8 paid
    from public.enrollment_consultations where tenant_id=${t} and (consulted_at at time zone 'Asia/Seoul')::date >= ${`${prev}-01`}::date
      and (consulted_at at time zone 'Asia/Seoul')::date < ${`${next}-01`}::date group by 1`;
  const of = (m) => rows.find((r) => r.m === m) ?? { total: 0, enrolled: 0, declined: 0, no_show: 0, open: 0, paid: 0 };
  const expect = [prev, cur].map((m) => { const r = of(m); return { month: m, total: r.total, enrolled: r.enrolled, declined: r.declined, noShow: r.no_show, open: r.open,
    paidSum: r.paid, rate: r.total ? Math.round((r.enrolled / r.total) * 100) : null }; });
  const s = D('admissions');
  assert.deepEqual(s.months, expect);
  const total = expect[0].total + expect[1].total, enrolled = expect[0].enrolled + expect[1].enrolled;
  assert.deepEqual([s.total, s.enrolled, s.rate, s.paidSum], [total, enrolled, total ? Math.round((enrolled / total) * 100) : null, expect[0].paidSum + expect[1].paidSum]);
  assert.deepEqual([s.prevYearMonths, s.prevSamePeriod, s.paths], [[], null, []], '운영실 값은 두 달만(전년·유입경로 없음)');
});

test('원생상담: 전체 · 최근 7일(복사본을 뜬 순간부터) · 후속조치 대기 · 기한 지남 = 독립 SQL', { skip: SKIP }, async () => {
  const [r] = await db`select count(*)::int total, count(*) filter (where consulted_at >= ${clock.at}::timestamptz - interval '7 days')::int week,
      count(*) filter (where follow_up_done is false and follow_up_date is not null)::int pending,
      count(*) filter (where follow_up_done is false and follow_up_date is not null and follow_up_date < ${today}::date)::int overdue
    from public.student_consultations where tenant_id=${t}`;
  assert.deepEqual(D('consultations'), { total: r.total, lastWeek: r.week, pendingFollowUps: r.pending, overdueFollowUps: r.overdue });
});

test('신규생: 인원·단계(등록 경과일) = 독립 SQL · 항목마다 상태 합 = 인원 · 등록일 기준 항목(OJT·1~3개월 콜) 상태 수 = 따로 센 값', { skip: SKIP }, async () => {
  const care = D('newcomers');
  const students = await db`select id::text id, enrolled_at::text enrolled_at, (${today}::date - enrolled_at)::int elapsed from public.students
    where tenant_id=${t} and status::text in ('enrolled', 'on_hold') and enrolled_at >= ${today}::date - 90`;
  assert.equal(care.total, students.length);
  const bucket = (e) => (e <= 7 ? 0 : e <= 30 ? 1 : e <= 60 ? 2 : e <= 90 ? 3 : 4);
  assert.deepEqual(care.stages.map((s) => s.value), [0, 1, 2, 3, 4].map((b) => students.filter((s) => bucket(s.elapsed) === b).length));
  for (const s of care.stages) assert.equal(Object.values(s.subjects).reduce((a, b) => a + b, 0), s.value, `${s.label}: 과목 막대 합 = 인원`);
  const [{ table }] = await db`select to_regclass('public.student_onboarding_checks') is not null "table"`;
  assert.equal(care.checksAvailable, table);
  if (!table) return assert.deepEqual(care.items, []);
  const ids = students.map((s) => s.id);
  for (const i of care.items) {
    assert.equal(i.done + i.overdue + i.due + i.upcoming + i.pending + i.waived, care.total, `${i.label}: 상태 합 = 인원`);
    assert.equal(i.needs.length, i.due + i.overdue, `${i.label}: 챙길 학생 = 임박 + 지연`);
    for (const n of i.needs) assert(ids.includes(n.id), `${i.label}: ${n.name}`);
  }
  // 과목 줄 = 끝나지 않은(종료일 없음 또는 오늘 뒤) 반 수강의 과목 · 없으면 과목 없는 한 줄. 체크 = 그 과목 칸 기록, 없으면 과목 없는 옛 기록.
  const subj = await db`select distinct e.student_id::text sid, btrim(c.subject) subject from public.enrollments e join public.classes c on c.id = e.class_id
    where e.tenant_id=${t} and e.student_id = any(${ids}::uuid[]) and btrim(coalesce(c.subject, '')) <> '' and (e.end_date is null or e.end_date > ${today}::date)`;
  const checks = await db`select distinct on (student_id, btrim(coalesce(subject, '')), item_key) student_id::text sid, btrim(coalesce(subject, '')) subject, item_key, done_on::text done_on
    from public.student_onboarding_checks where tenant_id=${t} and student_id = any(${ids}::uuid[]) order by student_id, btrim(coalesce(subject, '')), item_key, id desc`;
  const [, baseline] = (await readFile(new URL('features/newcomers/onboarding-items.ts', SRC), 'utf8')).match(/NEWCOMER_BASELINE_DATE = "(\d{4}-\d{2}-\d{2})"/);
  const check = new Map(checks.map((c) => [`${c.sid}|${c.subject}|${c.item_key}`, c.done_on]));
  // 등록일 기준 항목(원장 정의: OJT 등록 7일 · 1개월 30일 · 2개월 60일 · 3개월 90일) — 기능 시작일 전 기한은 '해당 없음', 지났으면 지연, 사흘 안이면 임박.
  for (const [label, key, offset] of [['OJT', 'ojt', 7], ['1개월 콜', 'month1_call', 30], ['2개월 콜', 'month2_call', 60], ['3개월 콜', 'month3_call', 90]]) {
    const tally = { done: 0, overdue: 0, due: 0, upcoming: 0, pending: 0, waived: 0 };
    for (const s of students) {
      const rows = subj.filter((r) => r.sid === s.id).map((r) => r.subject);
      const statuses = (rows.length ? rows : [null]).map((subject) => {
        const own = subject !== null && check.has(`${s.id}|${subject}|${key}`) ? check.get(`${s.id}|${subject}|${key}`) : check.get(`${s.id}||${key}`);
        if (own) return 'done';
        const dueOn = addDays(s.enrolled_at, offset);
        return dueOn < baseline ? 'waived' : dueOn < today ? 'overdue' : (Date.parse(dueOn) - Date.parse(today)) / 86400000 <= 3 ? 'due' : 'upcoming';
      });
      tally[statuses.every((x) => x === 'done') ? 'done' : ['overdue', 'due', 'pending', 'upcoming', 'waived'].find((x) => statuses.includes(x))] += 1;
    }
    const got = care.items.find((i) => i.label === label);
    assert.deepEqual({ done: got.done, overdue: got.overdue, due: got.due, upcoming: got.upcoming, pending: got.pending, waived: got.waived }, tally, label);
  }
});

test('레벨테스트 및 첫수업 일정: 줄·종류·취소 = 독립 SQL(전일 첫날 ~ 한 달) · 전일 입테 수 · 연결된 반·상담은 실제 기록', { skip: SKIP }, async (tc) => {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(), prev = { from: addDays(today, dow === 1 ? -2 : -1), to: addDays(today, -1) };
  // 창 끝 = 다음 달 같은 날의 전날(다음 달에 그날이 없으면 다음 달 말일).
  const nm = shiftMonth(today.slice(0, 7), 1), last = new Date(Date.UTC(Number(nm.slice(0, 4)), Number(nm.slice(5, 7)), 0)).getUTCDate(), day = Number(today.slice(8, 10));
  const end = day > last ? `${nm}-${String(last).padStart(2, '0')}` : addDays(`${nm}-${today.slice(8, 10)}`, -1);
  const ev = await db`select e.id::text id, e.title, e.start_date::text s, e.end_date::text e, left(e.start_time::text, 5) st, coalesce(tg.name, '') tag
    from public.calendar_events e left join public.calendar_tags tg on tg.id = e.tag_id where e.tenant_id=${t} and e.start_date <= ${end}::date and e.end_date >= ${prev.from}::date`;
  const kindOf = (r) => {
    const title = squash(r.title), tag = squash(r.tag);
    if (/예약(금지|차단)/.test(title) || tag.includes('운영팀중요일정')) return null;
    return /레벨테스트|입학테스트|입테|레테/.test(`${title} ${tag}`) ? 'levelTest' : /첫수업/.test(`${title} ${tag}`) ? 'firstClass' : null;
  };
  const expect = ev.filter((r) => kindOf(r) && (r.e >= today || kindOf(r) === 'levelTest'))
    .sort((a, b) => a.s.localeCompare(b.s) || (a.st ?? '').localeCompare(b.st ?? '') || a.id.localeCompare(b.id))
    .map((r) => squash(r.title).includes('취소') ? [r.id, null, kindOf(r)] : [r.id, kindOf(r), undefined]);
  const rows = D('calendar');
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.cancelledKind]), expect);
  const levelPrev = expect.filter(([id, kind]) => kind === 'levelTest' && ev.some((r) => r.id === id && r.s <= prev.to && r.e >= prev.from)).length;
  assert.equal(rows.filter((r) => r.kind === 'levelTest' && r.startDate <= prev.to && r.endDate >= prev.from).length, levelPrev, '전일 입테');
  for (const r of rows.filter((x) => x.kind === null)) assert.deepEqual([r.matchedClass, r.matchedConsultation, r.displayTitle], [null, null, undefined], `취소 줄은 잇지 않는다: ${r.title}`);
  const linkedC = rows.filter((r) => r.matchedConsultation), linkedK = rows.filter((r) => r.matchedClass);
  if (linkedC.length) {
    const found = await db`select id::text id from public.enrollment_consultations where tenant_id=${t} and id = any(${linkedC.map((r) => r.matchedConsultation.id)}::uuid[])
      and consulted_at >= ${kst(addDays(today, -60))}`;
    assert.equal(new Set(found.map((r) => r.id)).size, new Set(linkedC.map((r) => r.matchedConsultation.id)).size, '연결된 상담 = 최근 60일 지점 상담');
    for (const r of linkedC) assert(r.matchedConsultation.id in D('consultProgress').chips, `일정의 상담 ${r.matchedConsultation.name}에 상담 진행 칩이 있다`);
  }
  if (linkedK.length) {
    const found = await db`select id::text id from public.classes where tenant_id=${t} and is_active and id = any(${linkedK.map((r) => r.matchedClass.id)}::uuid[])`;
    assert.equal(new Set(found.map((r) => r.id)).size, new Set(linkedK.map((r) => r.matchedClass.id)).size, '연결된 반 = 운영 중인 지점 반');
  }
  tc.diagnostic(`줄 ${rows.length}(오늘부터 ${rows.filter((r) => r.endDate >= today).length}) · 취소 ${rows.filter((r) => r.kind === null).length} · 전일 입테 ${levelPrev} · 반 연결 ${linkedK.length} · 상담 연결 ${linkedC.length}`);
});

test('상담 진행: 칩 = 최근 60일 상담 · 단계별 인원(최근 30일 접수·상담·등록·반 배정·수업 시작) = 따로 센 값 · 멈춘 상담 규칙', { skip: SKIP }, async () => {
  const p = D('consultProgress'), from = addDays(today, -29);
  const consults = await db`select id::text id, outcome::text outcome, subject, student_id::text sid, consulted_at >= ${kst(from)} recent
    from public.enrollment_consultations where tenant_id=${t} and consulted_at >= ${kst(addDays(today, -60))} and prospect_name ~ '\\S'`;
  assert.deepEqual(Object.keys(p.chips).sort(), consults.map((c) => c.id).sort());
  const sids = [...new Set(consults.flatMap((c) => (c.sid ? [c.sid] : [])))];
  const open = sids.length ? await db`select e.student_id::text sid, e.start_date::text start_date, c.subject from public.enrollments e join public.classes c on c.id = e.class_id
    where e.tenant_id=${t} and e.student_id = any(${sids}::uuid[]) and (e.end_date is null or e.end_date >= ${today}::date)` : [];
  // 상담 과목 글자 → 볼 반 과목 키는 2.0 규칙(consultClassKeysOf — 자유 글자 해석)을 빌린다 · null = 과목 모름(모든 반) · [] = 못 읽음.
  const keysOf = (await importV2('features/enrollment/consult-subject.ts')).consultClassKeysOf(ctx.settings.operations.subjects);
  const STAGE = { pending: 'before', scheduled: 'before', consulted: 'consulted', ai_done: 'consulted', declined: 'unregistered', no_show: 'unregistered', enrolled: 'enrolled' };
  const n = { received: 0, consulted: 0, enrolled: 0, assigned: 0, started: 0 };
  for (const c of consults.filter((x) => x.recent)) {
    const keys = keysOf(c.subject || null), mine = c.sid ? open.filter((e) => e.sid === c.sid && (keys === null || (!!e.subject && keys.includes(e.subject)))) : [];
    const stage = mine.length ? 'enrolled' : (STAGE[c.outcome] ?? 'before');
    n.received += 1; n.consulted += Number(stage === 'consulted' || stage === 'enrolled' || c.outcome === 'declined'); n.enrolled += Number(stage === 'enrolled');
    n.assigned += Number(mine.length > 0); n.started += Number(mine.length > 0 && mine.some((e) => !e.start_date || e.start_date <= today));
  }
  const { levelTest, ...counts } = p.summary.counts;
  assert.deepEqual(counts, n);
  assert.equal(p.summary.from, from);
  if (ctx.allowed.includes('calendar')) assert(typeof levelTest === 'number' && levelTest <= n.received, '일정을 읽으면 입테 수가 선다');
  else assert.equal(levelTest, null);
  const days = p.summary.stalled.map((s) => s.days);
  assert.deepEqual(days, [...days].sort((a, b) => b - a), '오래 멈춘 순');
  for (const s of p.summary.stalled) {
    assert(s.id in p.chips, s.name);
    assert(s.reason === 'consulted' ? s.days > 7 : s.days > 3, `${s.name}: ${s.label}`);
  }
});

test('직원 구성: 표시 역할별 인원 = 독립 SQL(재직 · 학생 계정 제외) · 과목 묶음 합 = 인원', { skip: SKIP }, async () => {
  const users = await db`select id::text id, system_role::text role, coalesce(cardinality(subjects), 0) n from public.users
    where tenant_id=${t} and status::text = 'active' and system_role::text <> 'student'`;
  const [{ data }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  // 침산(일반판 표식이 없는 지점)에서는 운영 관리자 한 사람을 원장이 아닌 관리자로 센다 — 그 계정 id는 2.0 표시 규칙(display.ts)에서 읽는다.
  const [, exceptionId] = (await readFile(new URL('features/dashboard/overview/display.ts', SRC), 'utf8')).match(/user\.id === "([0-9a-f-]{36})"/);
  const LABEL = { master: '원장', admin: '관리자', manager: '매니저', teacher: '강사', counselor: '상담', accountant: '회계', viewer: '열람' };
  const roleOf = (u) => (data?.preset !== 'generic' && u.id === exceptionId && u.role === 'master' ? 'admin' : u.role);
  const byLabel = new Map();
  for (const u of users) { const l = LABEL[roleOf(u)] ?? '기타', v = byLabel.get(l) ?? { value: 0, empty: 0 }; v.value += 1; v.empty += Number(u.n === 0); byLabel.set(l, v); }
  const staff = D('staff');
  assert.deepEqual(staff.map((s) => [s.label, s.value]), [...byLabel].map(([l, v]) => [l, v.value]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')));
  for (const s of staff) {
    assert.equal(Object.values(s.bySubject).reduce((a, b) => a + b, 0), s.value, `${s.label}: 과목 묶음 합`);
    assert(s.bySubject.none >= byLabel.get(s.label).empty, `${s.label}: 담당 과목이 빈 사람은 '없음'`);
  }
});

test('운영 현황: 메뉴 권한이 있는 칸만 2.0 차례로 · 칸마다 건수 = 독립 SQL(내 결재 대기 = 내 차례 + 내 후결 확인)', { skip: SKIP }, async () => {
  const me = ctx.user.id, has = (m) => ctx.allowed.includes(m);
  const [c] = await db`select (select count(*)::int from public.meeting_minutes where tenant_id=${t}) meetings,
      (select count(*)::int from public.academy_documents where tenant_id=${t} and staff_user_id is null) documents,
      (select count(*)::int from public.shuttle_vehicles where tenant_id=${t} and not archived) shuttle,
      (select count(*)::int from public.approval_documents d where d.tenant_id=${t} and (
        (d.status::text = 'pending' and exists (select 1 from public.approval_steps s where s.document_id = d.id and s.step_no = d.current_step and s.approver_id = ${me} and s.decision::text = 'pending'))
        or exists (select 1 from public.approval_steps s where s.document_id = d.id and s.approver_id = ${me} and s.decision::text = 'deferred'))) approvals,
      (select count(*)::int from public.inventory_assets where tenant_id=${t}) assets, (select count(*)::int from public.inventory_supplies where tenant_id=${t}) supplies`;
  const expect = [...(has('meetings') ? [['회의록', c.meetings]] : []), ...(has('documents') ? [['공용 문서', c.documents]] : []), ...(has('shuttle') ? [['운행 차량', c.shuttle]] : []),
    ...(has('approvals') ? [['내 결재 대기', c.approvals]] : []), ...(has('inventory') ? [['등록 자산', c.assets], ['소모품 품목', c.supplies]] : [])];
  assert.deepEqual(D('operations').map((o) => [o.label, o.count]), expect);
});

test('공지: 원장이 받는 대상(전체·전 직원·운영진)의 공지 · 고정 먼저 · 최근 순 4건 = 독립 SQL', { skip: SKIP }, async () => {
  const rows = await db`select id::text id from public.announcements where tenant_id=${t} and audience::text in ('all', 'staff', 'office')
    order by pinned desc, created_at desc, id limit 4`;
  assert.deepEqual(D('notices').map((n) => n.id), rows.map((r) => r.id));
});

test.after(() => db?.end());
