// 운영실 수납·보고서·시트 영역 이식 시험 — node --test experiments/owner-concept/verify-v2-dashboard-billing.mjs
// ① 옮긴 본문(지출 요약·월 범위)과 적어 둔 상수(창 길이·기본 통화)가 2.0 원문과 같다 ② 영역 값의 키가 2.0 타입(OverviewData)의 키와 같다
// ③ 카드에 보이는 숫자가 2.0 조건을 시험 쪽에서 따로 적은 SQL과 맞는다(6개월 청구·수납 · 이번 달 지출 · 숙제 · 학부모 미확인 · 영어/수학 시트 작성률)
// ④ ClassNote가 꺼진 지점은 학부모 미확인을 조회 없이 비운다. 영역은 운영실 조립부와 같은 방식(영역마다 저장점 + ctx)으로 부른다.
// 복사본 DB가 없으면 ③④는 건너뛴다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BILLING_AREAS, HOMEWORK_WINDOW_DAYS, UNREAD_WINDOW_DAYS, DEFAULT_CURRENCY } from './v2-dashboard-billing.mjs';
import { importV2 } from './v2-bridge.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';

/** 타입 리터럴(`앵커 … {`)의 맨 바깥 칸 이름 — 주석·중첩 객체 안 칸은 뺀다. */
function typeKeys(text, anchor) {
  const at = text.search(anchor);
  assert.ok(at >= 0, `타입 ${anchor}`);
  let i = text.indexOf('{', at) + 1, depth = 1, line = '';
  const keys = [];
  const flush = () => { const m = /^\s*(?:readonly\s+)?(\w+)\??\s*:/.exec(line); if (m) keys.push(m[1]); line = ''; };
  for (; i < text.length && depth > 0; i++) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i) - 1; continue; }
    if (ch === '{' || ch === '(' || ch === '<' || ch === '[') { if (depth === 1) line += ch; depth += 1; continue; }
    if (ch === '}' || ch === ')' || ch === '>' || ch === ']') { depth -= 1; if (depth === 0) { flush(); break; } continue; }
    if (depth === 1) { if (ch === ';' || ch === '\n' || ch === ',') flush(); else line += ch; }
  }
  return [...new Set(keys)].sort();
}
const sortedKeys = (o) => Object.keys(o).sort();

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { queryGate, rules: rosterRules, resolveSettings, copyClock, userPermMatrix } = await import('./v2-onescreen-roster.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var clock = await copyClock(), asOf = clock.day;
  var addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  var lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  var [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
  // 설정 과목(학부모 보고 대상) · 휴일 — 복사본 설정 행에서 직접(시험 쪽 해석).
  var tracked = (stored?.report?.classnoteSubjects ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
  var holidayDates = (Array.isArray(stored?.operations?.holidays) ? stored.operations.holidays : [])
    .map((h) => (typeof h === 'string' ? h : h?.date ?? '').trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  /** 운영실 조립부와 같은 ctx — 보는 사람 = 최근 30일 활동이 가장 많은 재직 원장(운영 계정 제외). `patch`로 칸을 바꿔 부를 수 있다. */
  var runAreas = (patch = {}) => ro(async (tx) => {
    const sql = queryGate(tx), RR = await rosterRules(importV2);
    const [[row], [{ name }]] = await Promise.all([sql`select data from public.tenant_settings where tenant_id=${t}`, sql`select name from public.tenants where id=${t}`]);
    const settings = resolveSettings(RR, row?.data ?? {}, name);
    const users = await sql`select u.id::text id, u.display_name name, u.system_role::text role, u.subjects, u.ui_prefs,
        exists(select 1 from public.super_admins sa where sa.id = u.id) super,
        (select count(*)::int from public.audit_logs a where a.tenant_id=${t} and a.actor_id = u.id and a.created_at > ${new Date(clock.at.getTime() - 30 * 86400000)} and a.created_at <= ${clock.at}) recent
      from public.users u where u.tenant_id=${t} and u.status::text = 'active' and u.system_role::text = 'master' order by u.display_name, u.id`;
    const viewer = users.filter((u) => !u.super).sort((a, b) => b.recent - a.recent)[0];
    assert.ok(viewer, '재직 원장 계정');
    const matrix = await userPermMatrix(sql, RR, settings, { id: viewer.id, system_role: viewer.role }, t, clock.at);
    const allowed = RR.MENU_KEYS.filter((key) => RR.canAccess(viewer.role, key, matrix));
    const base = { t, today: asOf, clock, settings, allowed, user: viewer, importV2, RR, memo: new Map() };
    const ctx = { ...base, ...patch, settings: patch.settings?.(settings) ?? settings, user: patch.user?.(viewer) ?? viewer };
    const sections = {}, ms = {};
    for (const [area, fn] of Object.entries(BILLING_AREAS)) {
      const t0 = performance.now();
      sections[area] = await sql.soft(async (sp) => ({ data: await fn(ctx, sp), error: false }), (e) => ({ data: null, error: true, message: e?.message }));
      ms[area] = Math.round(performance.now() - t0);
    }
    return { sections, ms, allowed, viewer };
  });
  var out = await runAreas();
  var S = Object.fromEntries(Object.entries(out.sections).map(([k, v]) => [k, v.data]));
}

test('옮긴 본문(지출 요약·월 범위)과 적어 둔 상수(창 길이 · 기본 통화)가 2.0 원문과 같다', async () => {
  const ts = (await import('typescript')).default, mine = await here('./v2-dashboard-billing.mjs');
  const fn = (raw, name) => { const text = raw.replace(/\r\n/g, '\n'), i = text.search(new RegExp(`(?:export )?function ${name}\\b`)), end = text.indexOf('\n}\n', i); assert.ok(i >= 0 && end > i, `${name} 본문`); return text.slice(text.indexOf('function', i), end + 2); };
  const norm = (code) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText.replace(/[\s;]+/g, '').replace(/,(?=[)\]}])/g, '').replace(/'/g, '"');
  const expense = await src('features/billing/server/expense-queries.ts');
  for (const name of ['monthRange', 'summarizeExpenses']) assert.equal(norm(fn(mine, name)), norm(fn(expense, name)), name);
  assert.equal(DEFAULT_CURRENCY, (await importV2('features/billing/currencies.ts')).DEFAULT_CURRENCY);
  const onescreen = await src('features/dashboard/onescreen/server/queries.ts');
  assert.equal(HOMEWORK_WINDOW_DAYS, Number(/export const HOMEWORK_WINDOW_DAYS = (\d+);/.exec(onescreen)?.[1]));
  assert.equal(UNREAD_WINDOW_DAYS, Number(/export const UNREAD_WINDOW_DAYS = (\d+);/.exec(onescreen)?.[1]));
});

test('영역 이름 = 2.0 Area 키(맡은 여섯) · 영역 값 키 = 2.0 타입의 키', { skip: SKIP }, async (tc) => {
  tc.diagnostic(`보는 사람 ${out.viewer.name} · 기준일 ${asOf} · 영역별 ${Object.entries(out.ms).map(([k, v]) => `${k} ${v}ms`).join(' · ')}`);
  assert.deepEqual(Object.keys(BILLING_AREAS).sort(), ['billing', 'englishSheet', 'expenses', 'homework', 'mathSheet', 'unread']);
  const model = await src('features/dashboard/overview/model.ts');
  for (const area of Object.keys(BILLING_AREAS)) assert.match(model, new RegExp(`\\n  ${area}: `), `OverviewData.${area}`);
  for (const [area, section] of Object.entries(out.sections)) assert.equal(section.error, false, `${area}: ${section.message ?? ''}`);
  const calc = await src('features/billing/calc.ts'), expense = await src('features/billing/server/expense-queries.ts');
  const risk = await src('features/dashboard/onescreen/homework-risk.ts'), onescreen = await src('features/dashboard/onescreen/server/queries.ts');
  const summary = typeKeys(calc, /export type BillingSummary = \{/);
  for (const month of S.billing) assert.deepEqual(sortedKeys(month), summary, `billing ${month.period}`);
  assert.deepEqual(sortedKeys(S.expenses), typeKeys(expense, /export type ExpenseSummary = \{/));
  for (const row of S.expenses.byCurrency) assert.deepEqual(sortedKeys(row), typeKeys(expense, /export type CurrencyTotal = \{/));
  assert.deepEqual(sortedKeys(S.homework), [...typeKeys(risk, /export type HomeworkRisk = \{/), ...typeKeys(onescreen, /export type HomeworkRiskView = HomeworkRisk & \{/)].sort());
  assert.deepEqual(sortedKeys(S.unread), typeKeys(onescreen, /export type UnreadReportsView = \{/));
  assert.deepEqual(sortedKeys(S.englishSheet), typeKeys(model, /\n {2}englishSheet: \{/));
  assert.deepEqual(sortedKeys(S.mathSheet), typeKeys(model, /\n {2}mathSheet: \{/));
});

test('6개월 청구 · 수납: 달마다 청구서 머리(무효 제외) 합계·건수·미수·수납률 = 독립 SQL', { skip: SKIP }, async () => {
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 6 + i, 1)).toISOString().slice(0, 7));
  assert.deepEqual(S.billing.map((m) => m.period), months, '최근 6개월 · 오래된 달 → 이번 달');
  // 미수 = 완납·환불·무효는 0, 나머지는 max(0, 청구 − 할인 − 수납). 수납률 = 수납 ÷ (청구 − 할인) × 100(100 상한 · 실청구 0 이하면 0).
  const rows = await db`select period, count(*)::int n, count(*) filter (where status = 'paid')::int paid, count(*) filter (where status = 'partial')::int partial,
      count(*) filter (where status = 'unpaid')::int unpaid, sum(amount_total)::float8 billed, sum(amount_paid)::float8 collected, sum(coalesce(amount_discount, 0))::float8 discount,
      sum(case when status::text in ('paid', 'refunded', 'void') then 0 else greatest(0, amount_total - coalesce(amount_discount, 0) - amount_paid) end)::float8 outstanding
    from public.invoices where tenant_id=${t} and status::text <> 'void' and period = any(${months}) group by period`;
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.01, `${label}: ${a} ≠ ${b}`);
  for (const m of S.billing) {
    const r = rows.find((x) => x.period === m.period) ?? { n: 0, paid: 0, partial: 0, unpaid: 0, billed: 0, collected: 0, discount: 0, outstanding: 0 };
    assert.deepEqual([m.totalCount, m.paidCount, m.partialCount, m.unpaidCount], [r.n, r.paid, r.partial, r.unpaid], `${m.period} 건수`);
    near(m.totalBilled, r.billed, `${m.period} 청구`); near(m.totalCollected, r.collected, `${m.period} 수납`); near(m.totalDiscount, r.discount, `${m.period} 할인`);
    near(m.outstanding, r.outstanding, `${m.period} 미수`);
    const net = r.billed - r.discount;
    near(m.paymentRate, net > 0 ? Math.min((r.collected / net) * 100, 100) : 0, `${m.period} 수납률`);
  }
});

test('이번 달 지출: 지출일이 이번 달인 결의서 — 통화별 합계·건수 · 주 통화 · 주 통화의 분류별 합 = 독립 SQL', { skip: SKIP }, async () => {
  const month = asOf.slice(0, 7);
  const byCur = await db`select coalesce(nullif(currency, ''), 'KRW') currency, count(*)::int count, sum(amount)::float8 total from public.expenses
    where tenant_id=${t} and expense_date >= ${`${month}-01`} and expense_date <= ${lastDay(month)} group by 1`;
  assert.equal(S.expenses.period, month);
  assert.equal(S.expenses.count, byCur.reduce((s, r) => s + r.count, 0));
  // 주 통화 = 건수 많은 것 → 합계 큰 것 → 코드 알파벳 순.
  const ordered = [...byCur].sort((a, b) => b.count - a.count || b.total - a.total || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
  assert.deepEqual(S.expenses.byCurrency.map((r) => [r.currency, r.count, Math.round(r.total * 100)]), ordered.map((r) => [r.currency, r.count, Math.round(r.total * 100)]));
  const primary = ordered[0]?.currency ?? 'KRW';
  assert.equal(S.expenses.primaryCurrency, primary);
  const byCat = await db`select category, count(*)::int count, sum(amount)::float8 amount from public.expenses
    where tenant_id=${t} and expense_date >= ${`${month}-01`} and expense_date <= ${lastDay(month)} and coalesce(nullif(currency, ''), 'KRW') = ${primary} group by category`;
  const key = (r) => `${r.category}|${r.count}|${Math.round(r.amount * 100)}`;
  assert.deepEqual(S.expenses.byCategory.map(key).sort(), byCat.map(key).sort());
  assert.deepEqual(S.expenses.byCategory.map((r) => r.amount), [...S.expenses.byCategory.map((r) => r.amount)].sort((a, b) => b - a), '분류는 금액 큰 순');
  assert.equal(S.expenses.categoryCount, byCat.length);
});

test('숙제 수행률: 최근 7일 보고서(설정 과목) — 60% 미만 학생 · 미제출 학생 · 0% 학생 · 판정/제외 기록 수 = 독립 SQL', { skip: SKIP }, async () => {
  // 값 해석(2.0 조건): 앞뒤 공백을 떼고 '미제출' = 0 · '완료' = 100 · 숫자(뒤에 % 여럿 허용, 세 자리까지) = 그 값(100 상한) · 그 밖(빈칸·'없음' 등) = 판정 제외.
  const rows = await db`with r as (
      select student_id, regexp_replace(coalesce(homework_score, ''), '^\\s+|\\s+$', '', 'g') s from public.lesson_reports
      where tenant_id=${t} and student_id is not null and report_date >= ${addDays(asOf, -6)} and report_date <= ${asOf} ${tracked.length ? db`and subject = any(${tracked})` : db``}),
    v as (select student_id, s, case when s = '미제출' then 0 when s = '완료' then 100 when s ~ '^\\d{1,3}\\s*%*$' then least(100, substring(s from '^\\d{1,3}')::int) end rate from r)
    select count(distinct student_id) filter (where rate < 60)::int students, count(distinct student_id) filter (where s = '미제출')::int not_submitted,
      count(distinct student_id) filter (where rate = 0 and s <> '미제출')::int zero, count(*) filter (where rate is not null)::int parsed, count(*) filter (where rate is null)::int unparsed from v`;
  const [r] = rows;
  assert.deepEqual([S.homework.students, S.homework.notSubmitted, S.homework.zero, S.homework.parsed, S.homework.unparsed], [r.students, r.not_submitted, r.zero, r.parsed, r.unparsed]);
  assert.equal(S.homework.windowDays, 7);
  assert.deepEqual(S.homework.subjects, tracked);
});

test('학부모 미확인: 발송 성공 · 매칭 가능 · 미읽음 · 발송 후 48시간 지남 · 최근 30일 · 설정 과목 = 독립 SQL', { skip: SKIP }, async () => {
  const [{ n }] = await db`select count(*)::int n from public.lesson_reports where tenant_id=${t} and classnote_status = 'success' and classnote_read_at is null
    and (edutrix_share_token is not null or source is null or source <> 'edutrix_import') and classnote_sent_at < ${new Date(clock.at.getTime() - 48 * 3600000)}
    and report_date >= ${addDays(asOf, -29)} ${tracked.length ? db`and subject = any(${tracked})` : db``}`;
  assert.deepEqual(S.unread, { reports: n, windowDays: 30, graceHours: 48, subjects: tracked });
});

test('학부모 미확인: ClassNote가 꺼진 지점은 조회 없이 비운다(2.0 영역 제외 판정)', { skip: SKIP }, async () => {
  const RR = await rosterRules(importV2), settings = { modules: { disabled: ['classnote'] }, report: { classnoteSubjects: tracked } };
  const noQuery = () => { throw new Error('조회하면 안 된다'); };
  assert.equal(await BILLING_AREAS.unread({ t, today: asOf, clock, settings, allowed: out.allowed, user: out.viewer, importV2, RR, memo: new Map() }, noQuery), null);
});

/**
 * 영어 시트 이번 주 작성률(2.0 조건을 시험 쪽에서 따로) — 그 주(월~일)에 날짜별로 살아 있는 배정이 하나라도 있는 영어 반(활성 · 주 시작 전 종강 아님 ·
 * 프로그램 필터) × 날짜별 배정 교시(LAB 자리 제외 · JJ 자리는 표시 설정이 꺼졌으면 제외) · 휴일 교시는 계획을 쓴 것만 센다 · 작성 = 의미 있는 계획 줄이 있는 교시.
 */
async function englishIndependent({ track = 'all', showSelfStudy = true } = {}) {
  const dow = (new Date(`${asOf}T00:00:00Z`).getUTCDay() + 6) % 7, mon = addDays(asOf, -dow), sun = addDays(mon, 6);
  const LAB = ['lab', 'lab실', '이주희', '랩실'], JJ = ['jj', '집중자율수업실', '자율실'], hidden = showSelfStudy ? LAB : [...LAB, ...JJ];
  const meaningful = (c) => db`nullif(regexp_replace(coalesce(${db(c)}, ''), '^\\s+|\\s+$', '', 'g'), '') is not null`;
  const [r] = await db`with wk as (select d::date d, to_char(d, 'dy') dow from generate_series(${mon}::date, ${sun}::date, interval '1 day') d),
    cls as (select id from public.classes where tenant_id=${t} and subject = 'english' and is_active and (closed_at is null or closed_at >= ${mon})
      ${track === 'eie' ? db`and english_track = 'eie'` : track === 'injaewon' ? db`and english_track is distinct from 'eie'` : db``}),
    live as (select s.class_id, w.d, to_char(s.start_time, 'HH24:MI') hm, lower(regexp_replace(coalesce(s.slot_teacher_label, ''), '^\\s+|\\s+$', '', 'g')) lbl
      from public.class_schedules s join cls on cls.id = s.class_id join wk w on w.dow = s.day_of_week::text
      where s.tenant_id=${t} and s.valid_from <= w.d and (s.valid_to is null or s.valid_to >= w.d)),
    slots as (select distinct class_id, d, hm from live where lbl <> all(${hidden})),
    lines as (select distinct class_id, plan_date d, to_char(slot_start, 'HH24:MI') hm from public.class_sheet_plan_lines
      where tenant_id=${t} and plan_date between ${mon} and ${sun} and (${meaningful('textbook')} or ${meaningful('page_range')} or ${meaningful('progress')} or ${meaningful('homework')})),
    judged as (select s.d = any(${holidayDates}::date[]) hol, l.class_id is not null wrote from slots s left join lines l using (class_id, d, hm))
    select (select count(distinct class_id) from live)::int classes, count(*) filter (where not hol or wrote)::int total, count(*) filter (where wrote)::int filled from judged`;
  return { ...r, mon };
}

test('영어 시트: 이번 주 수업이 있는 영어 반 수 · 작성 교시 · 세는 교시 = 독립 SQL(보는 사람 보기 설정이 없을 때)', { skip: SKIP }, async () => {
  const plain = await runAreas({ user: (u) => ({ ...u, ui_prefs: null }) });
  const want = await englishIndependent();
  const got = plain.sections.englishSheet.data;
  assert.deepEqual([got.classes, got.filled, got.total], [want.classes, want.filled, want.total]);
  assert.match(got.period, new RegExp(`^${Number(want.mon.slice(0, 4))}년 \\d{1,2}월 \\d주차 \\(${Number(want.mon.slice(8))}~`), '이번 주 라벨');
  assert.ok(got.filled <= got.total);
});

test('영어 시트: 보는 사람의 보기 설정(프로그램 EiE · JJ 숨김)을 탄다 = 독립 SQL', { skip: SKIP }, async () => {
  const eieOn = !(stored?.modules?.disabled ?? []).includes('eie');
  const filtered = await runAreas({ user: (u) => ({ ...u, ui_prefs: { ecs: { englishTrack: 'eie', showSpecialRooms: false } } }) });
  const want = await englishIndependent({ track: eieOn ? 'eie' : 'all', showSelfStudy: false });
  const got = filtered.sections.englishSheet.data;
  assert.deepEqual([got.classes, got.filled, got.total], [want.classes, want.filled, want.total]);
});

test('영어 시트: 운영실 보는 사람(원장) 값이 그 사람 보기 설정으로 센 값과 같다', { skip: SKIP }, async () => {
  const ecs = out.viewer.ui_prefs?.ecs ?? {};
  // 담임 필터는 시험 쪽에서 다시 적지 않았다 — 저장된 담임 필터가 있는 계정이면 건너뛴다(복사본이 바뀌어도 깨지지 않게).
  if (typeof ecs.teacher === 'string' && ecs.teacher && ecs.teacher !== 'all') return;
  const eieOn = !(stored?.modules?.disabled ?? []).includes('eie');
  const track = eieOn && (ecs.englishTrack === 'eie' || ecs.englishTrack === 'injaewon') ? ecs.englishTrack : 'all';
  const want = await englishIndependent({ track, showSelfStudy: typeof ecs.showSpecialRooms === 'boolean' ? ecs.showSpecialRooms : true });
  assert.deepEqual([S.englishSheet.classes, S.englishSheet.filled, S.englishSheet.total], [want.classes, want.filled, want.total]);
});

test('수학 시트: 이번 달 수업이 있는 수학 반 수 · 기록 칸 · 온 칸 = 독립 SQL', { skip: SKIP }, async () => {
  // 2.0 조건(시험 쪽에서 따로): 반 = 활성 수학 반 중 그 달 1일 전에 종강하지 않은 반, 수업일 = 그 달 날짜 중 그 요일 배정이 그날 유효한 날.
  // 칸 = 수업일 × 그날 명단인 학생(수강 시작일 있음 · 실효 종료 = 수강 종료와 퇴원일 중 이른 날 · 반이동 전출은 그 전날까지).
  // 기록 칸 = 그날 그 반 그 학생의 수업보고서가 있다. 온 칸 = 기록 칸 + (휴일 아님 · 결석/사유결석 없음 · 출석/지각/조퇴/보강이 있음 · 보고서 없음).
  const month = asOf.slice(0, 7), from = `${month}-01`, to = lastDay(month);
  const [r] = await db`with days as (select d::date d, to_char(d, 'dy') dow from generate_series(${from}::date, ${to}::date, interval '1 day') d),
    cls as (select id from public.classes where tenant_id=${t} and subject = 'math' and is_active and (closed_at is null or closed_at >= ${from})),
    cday as (select distinct s.class_id, dd.d from public.class_schedules s join cls on cls.id = s.class_id join days dd on dd.dow = s.day_of_week::text
      where s.tenant_id=${t} and (s.valid_from is null or s.valid_from <= dd.d) and (s.valid_to is null or s.valid_to >= dd.d)),
    spans as (select e.class_id, e.student_id, e.start_date s,
        case when coalesce(e.is_transferred, false) then least(e.end_date, st.withdrawn_at) - 1 else least(e.end_date, st.withdrawn_at) end l
      from public.enrollments e join cls on cls.id = e.class_id left join public.students st on st.id = e.student_id and st.tenant_id=${t}
      where e.tenant_id=${t} and e.start_date is not null),
    cells as (select distinct c.class_id, c.d, sp.student_id from cday c join spans sp on sp.class_id = c.class_id and (sp.l is null or sp.l >= sp.s)
      and sp.s <= c.d and (sp.l is null or c.d <= sp.l)),
    judged as (select c.d = any(${holidayDates}::date[]) hol,
        exists(select 1 from public.lesson_reports lr where lr.tenant_id=${t} and lr.class_id = c.class_id and lr.student_id = c.student_id and lr.report_date = c.d) wrote,
        exists(select 1 from public.attendance_records a where a.tenant_id=${t} and a.class_id = c.class_id and a.student_id = c.student_id and a.session_date = c.d
          and a.status::text in ('absent', 'excused')) missed,
        exists(select 1 from public.attendance_records a where a.tenant_id=${t} and a.class_id = c.class_id and a.student_id = c.student_id and a.session_date = c.d
          and a.status::text in ('present', 'late', 'early_leave', 'makeup')) came from cells c)
    select (select count(distinct class_id) from cday)::int classes, count(*) filter (where wrote)::int filled,
      count(*) filter (where wrote or (not hol and not missed and came))::int total from judged`;
  assert.deepEqual([S.mathSheet.classes, S.mathSheet.filled, S.mathSheet.total], [r.classes, r.filled, r.total]);
  assert.equal(S.mathSheet.period, `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`);
  assert.ok(S.mathSheet.filled <= S.mathSheet.total);
});

test.after(async () => { await db?.end(); });
