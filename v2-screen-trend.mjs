// 확장 추세 — 서버(원장 10-28 "추세를 눌렀을때 확장 추세로 이동 … 일별 월별 연별 추세를 자세하게 … 학생별, 선생님별, 반별, 과목별"
// · "완전한 확장 추세 툴을 하나 만들고 … 기준만 바꿔서 필터링"). 지표·기간 단위·기준·필터를 받아 창마다 합계와 기준별 줄을 낸다. 읽기 전용.
// 지표는 trend-metrics.mjs 한 곳에서 온다. 기록이 시작되기 전의 창은 앞에서 잘라 내고, 중간에 기록이 없는 창은 '기록 없음'(0이 아니다).
// 명단 계약(원장 10-28 "자세히보기를 눌러 들어왔을때 이걸 체크할 수 있는 리스트가 있으면 더 좋을듯. 아래쪽에"):
//   metric.series는 filter가 있을 때 선택적으로 records를 함께 돌려줄 수 있다 — windows와 같은 길이, 칸마다 null(기록 없음 창) 또는
//   [{ id(학생 id 또는 그 기록 id), name, sub?(학교·학년 — 경명여중1), teacher?(퇴원 계열 담당 선생님 — 여러 명은 가운뎃점, 판정 실패는 —), date?(YYYY-MM-DD), dateLabel?(그 날짜의 이름 — 퇴원일), note?(한 줄 내용 — '등록 4/2 · 29일 만에') }].
//   load는 필터를 건 보기에서만 records를 windows·total과 같은 자리(start)로 잘라 넘긴다. 없는 지표는 명단을 그리지 않는다(안내 문구 없음). 기억 키는 그대로(필터가 이미 키에 있다).
import { addDays, weekWindows, yymm, rate } from './domain-snapshot-core.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { TREND_METRICS } from './trend-metrics.mjs';

const GRAINS = Object.freeze([{ id: 'day', label: '일별' }, { id: 'week', label: '주별' }, { id: 'month', label: '월별' }, { id: 'year', label: '연별' }]);
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const monthOf = (m, k) => { const d = new Date(`${m}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); };
const cap = (d, asOf) => (d < asOf ? d : asOf);

/** 창 = 오래된 → 최근. 일 31개 · 주 13개(카드와 같은 '최근 7일' 창) · 월 12개(이번 달은 오늘까지) · 연 3개(올해는 오늘까지). */
export function windowsFor(grain, asOf) {
  if (grain === 'day') return Array.from({ length: 31 }, (_, i) => { const d = addDays(asOf, i - 30); return { from: d, to: d, label: md(d) }; });
  if (grain === 'week') return weekWindows(asOf, 13);
  if (grain === 'month') return Array.from({ length: 12 }, (_, i) => { const m = monthOf(asOf.slice(0, 7), i - 11); return { from: `${m}-01`, to: cap(addDays(`${monthOf(m, 1)}-01`, -1), asOf), label: yymm(m) }; });
  return Array.from({ length: 3 }, (_, i) => { const y = Number(asOf.slice(0, 4)) - 2 + i; return { from: `${y}-01-01`, to: cap(`${y}-12-31`, asOf), label: `${y}년` }; });
}

// 쪼개 보기(원장 10-28 "이 항목을 눌렀을때 해당 기간에 대해 자세한 지표 확인" · "가능한 곳은 9/9~9/15를 일마다 분석해서 추이 확인") —
// 큰 그래프의 한 창을 한 단계 잘게: 주 → 일 · 월 → 일(지표가 일을 못 받으면 7일 묶음) · 연 → 월. 일은 더 쪼개지 않는다.
// 지표가 그 단위를 받지 않으면(청구액·수납률 = 월·연) 그 점은 누를 수 없다(drillOf = null).
const DRILL = Object.freeze({ week: ['day'], month: ['day', 'week'], year: ['month'] });
export const drillOf = (grain, allowed) => DRILL[grain]?.find((g) => allowed.includes(g)) ?? null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (d) => DAY.test(d ?? '') && addDays(d, 0) === d; // 2026-02-30 같은 없는 날은 받지 않는다
const daysIn = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
const lastDayOf = (m) => addDays(`${monthOf(m, 1)}-01`, -1);

/**
 * 범위(from~to) 안의 창 = 오래된 → 최근 — 일(31개까지) · 7일 묶음(from부터, 31일까지) · 월(그달 1일부터, 12개까지).
 * 끝은 `end`(그 지표의 마지막 날 — 오늘, 출결처럼 어제까지인 지표는 어제)로 자르고, 가장 넓은 보기(연별 3년)보다 앞선 날은 받지 않는다.
 * 맞지 않는 범위 = null(쪼개지 않은 보기로 돌아간다).
 */
export function rangeWindows(grain, from, to, end) {
  if (!isDay(from) || !isDay(to) || !isDay(end) || from > to) return null;
  const hi = cap(to, end);
  if (from > hi || from < `${Number(end.slice(0, 4)) - 2}-01-01`) return null;
  const n = daysIn(from, hi);
  if (grain === 'day') return n > 31 ? null : Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { from: d, to: d, label: md(d) }; });
  if (grain === 'week') {
    if (n > 31) return null;
    const out = Array.from({ length: Math.ceil(n / 7) }, (_, i) => { const a = addDays(from, 7 * i); return { from: a, to: cap(addDays(a, 6), hi) }; });
    // 끝에 남는 3일 이하는 앞 묶음에 붙인다 — 이틀짜리 창은 며칠이 지나야 세는 지표(열람률 = 보낸 지 48시간)에서 늘 비어 보였다(9/29~9/30 '—').
    if (out.length > 1 && daysIn(out.at(-1).from, out.at(-1).to) < 4) out.at(-2).to = out.pop().to;
    return out.map((w) => ({ ...w, label: `${md(w.from)}~${md(w.to)}` }));
  }
  if (grain !== 'month' || !from.endsWith('-01')) return null;
  const months = [];
  for (let m = from.slice(0, 7); m <= hi.slice(0, 7); m = monthOf(m, 1)) months.push({ from: `${m}-01`, to: cap(lastDayOf(m), hi), label: yymm(m) });
  return months.length > 12 ? null : months;
}

/** 쪼개 본 범위의 이름(칩) — 나눈 창의 단위(up)로 적는다: 주 = 9/9~9/15 · 월 = 26.09(연월은 늘 yy.mm) · 연 = 2025년. */
function rangeLabel(up, from, to) {
  if (up === 'year') return from.slice(0, 4) === to.slice(0, 4) ? `${from.slice(0, 4)}년` : `${from.slice(0, 4)}~${to.slice(0, 4)}년`;
  if (up === 'month' && from.slice(0, 7) === to.slice(0, 7)) return yymm(from);
  return `${md(from)}~${md(to)}`;
}
/** 나눈 창의 단위 — 주소에 실려 온 것이 이 단위로 쪼갤 수 있는 것이면 그대로, 아니면 범위 모양으로 짐작한다(× = 그 단위의 보기로). */
const upOf = (grain, asked, from, to) => (DRILL[asked]?.includes(grain) ? asked : grain === 'month' ? 'year' : grain === 'day' && daysIn(from, to) <= 7 ? 'week' : 'month');

// 같은 복사본·같은 조건이면 같은 답 — 서버가 켜져 있는 동안 기억한다(복사본을 바꾸면 서버를 다시 켠다 · copyClock과 같은 규칙).
const memo = new Map();
const remember = (key, make) => {
  if (!memo.has(key)) { if (memo.size > 200) memo.delete(memo.keys().next().value); memo.set(key, make().catch((e) => { memo.delete(key); throw e; })); }
  return memo.get(key);
};

/** 선생님·반 열쇠의 DB 이름 — 없으면 null(자리 출결 'seat:JJ'처럼 사람·반이 아닌 줄은 줄 이름에서 찾는다). */
async function nameOf(sql, tenantId, dim, key) {
  if (dim === 'teacher') return key === 'unassigned' ? '담당 미지정' : (await sql`select display_name from public.users where tenant_id=${tenantId} and id::text=${key}`)[0]?.display_name ?? null;
  if (dim === 'class') return (await sql`select class_name from public.classes where tenant_id=${tenantId} and id::text=${key}`)[0]?.class_name ?? null;
  // 학생(학생 줄의 '자세히 보기') — 필터 없이 학생별로 나눈 답(학원 전체 학생)을 이름 찾자고 계산하지 않는다.
  if (dim === 'student') return (await sql`select name from public.students where tenant_id=${tenantId} and id::text=${key}`)[0]?.name ?? null;
  return null;
}

// 기준별 줄의 정보 칸(원장 10-28 "각 선생님의 과목, 담당 반 수, 담당 학생 수 표시") — 화면에 보이는 범위(첫 창 from ~ 마지막 창 to) 기준
// (원장 10-28 "당연히 기간내에 존재하는 항목들로만 할것. 퇴원학생이나 종강된 반이 기간내에 있으면 넣고 없으면 뺄것"):
//   반 = 그 범위에 하루라도 운영된 반 — 수강이 범위와 겹쳤거나, 폐지되지 않았고 범위 끝 전에 만들어져 범위 시작 뒤에 종강(closed_at = 운영 종료일)했거나 아직 운영 중
//   학생 = 수강 기간이 범위와 겹친 학생(지금 퇴원생이어도 넣음 · 테스트 학생만 뺌 · 반이동으로 끝난 수강은 끝난 날을 넣지 않음 — 반열림)
//   담임 = 범위 끝날의 담임 이력(2.0 teacher-as-of homeroomTeacherOnDate — 인수인계·담임 변경 감사로그), 이력이 없으면 지금 담임.
// 선생님 = 그 범위 반의 과목 · 반 수 · 학생 수(겹치는 학생은 한 번) / 반 = 과목 · 담임 · 학생 수 / 과목 = 반 수 · 학생 수. 과목 열쇠는 영어 중 EiE를 가른다.
// 학생 기준 등 여기 없는 기준은 지표가 줄에 실어 보낸 meta를 그대로 쓴다.
const META_DIMS = new Set(['teacher', 'class', 'subject']);
// 필터가 있어야 하는 기준(needsFilter — 학생별)을 내는 필터 기준 — 반·선생님(과목 필터 + 학생별은 수백 줄).
const NEEDS_FILTER_ON = new Set(['class', 'teacher']);
async function homeroomAt(sql, tenantId, importV2, classes, day) {
  try {
    const [A, K] = await Promise.all([importV2('features/classes/teacher-as-of.ts'), importV2('lib/date-kst.ts')]);
    const logs = await sql`select metadata, target_label, to_json(created_at)#>>'{}' created_at from public.audit_logs
      where tenant_id=${tenantId} and action = any(${['class_handover_apply', 'class_update']}) and metadata->>'newTeacherId' is not null order by created_at, id`;
    const byName = A.buildUniqueClassNameIndex(classes.map((c) => ({ id: c.id, name: c.class_name })));
    const history = A.buildHomeroomHistoryIndex(logs.map((l) => ({
      classId: A.resolveTransitionClassId({ metaClassId: l.metadata?.classId ?? null, targetLabel: l.target_label, classIdByUniqueName: byName }) ?? '',
      date: K.kstDateOf(l.metadata?.effectiveDate) ?? K.kstDateOf(l.created_at) ?? '', teacherId: l.metadata?.newTeacherId ?? null,
      previousTeacherId: typeof l.metadata?.previousTeacherId === 'string' ? l.metadata.previousTeacherId : null, teacherName: null,
    })).filter((x) => x.classId && x.teacherId && x.date));
    return (c) => A.homeroomTeacherOnDate(history.get(c.id), c.teacher_id, day) ?? c.teacher_id;
  } catch (e) { console.error(`확장 추세 담임 이력: ${e.message}`); return (c) => c.teacher_id; } // 이력을 못 읽으면 지금 담임
}
async function rowMeta(sql, tenantId, importV2, from, to, by, subjectName) {
  if (!META_DIMS.has(by) || !from || !to) return null;
  const all = await sql`select c.id::text id, c.class_name, c.subject, c.english_track, c.teacher_id::text teacher_id, c.is_active, c.closed_at::text closed_at,
      (c.created_at at time zone 'Asia/Seoul')::date::text created from public.classes c where c.tenant_id = ${tenantId}`;
  // 수강은 반 종강일에서 끊는다(종강 뒤로 열린 수강이 있다 — trend-student closedCut과 같은 규칙: 끊으면 반이동 표시도 내린다).
  const seats = await sql`select class_id, student_id from (
      select e.class_id::text class_id, e.student_id::text student_id, e.start_date,
        case when c.closed_at is not null and (e.end_date is null or e.end_date > c.closed_at) then c.closed_at else e.end_date end end_date,
        case when c.closed_at is not null and (e.end_date is null or e.end_date > c.closed_at) then false else e.is_transferred end moved
      from public.enrollments e
      join public.students s on s.id = e.student_id and s.tenant_id = e.tenant_id and s.is_test = false
      join public.classes c on c.id = e.class_id and c.tenant_id = e.tenant_id
      where e.tenant_id = ${tenantId}) x
    where start_date <= ${to} and (end_date is null or end_date > ${from} or (end_date = ${from} and not moved))`;
  const studentsOf = new Map(); for (const x of seats) { if (!studentsOf.has(x.class_id)) studentsOf.set(x.class_id, new Set()); studentsOf.get(x.class_id).add(x.student_id); }
  // 범위에 있었던 반 = trend-student(27daa89dc)와 같은 규칙 — 운영 중이거나 종강일이 있는 반(종강일 없는 비활성 반은 언제까지 있었는지 몰라 뺀다) 중
  // 종강일(수업한 마지막 날) ≥ 범위 첫날. 선생님·과목의 반 수에서는 범위가 끝난 뒤에 만든 반도 뺀다(범위 안 수강이 있으면 넣는다 — 옮겨 온 반은 만든 날이 늦다).
  // 반 기준은 그 조건을 걸지 않는다 — 줄은 지표가 범위 안 기록으로 낸 것이라, 늦게 만든 반이어도 줄이 있으면 정보 칸을 붙인다(26.04 '중등M 중1 EL2T 화금'이 빈칸이었다).
  const classes = all.filter((c) => (c.is_active || c.closed_at) && (!c.closed_at || c.closed_at >= from) && (by === 'class' || studentsOf.has(c.id) || c.created <= to));
  const teacherOf = by === 'subject' ? (c) => c.teacher_id : await homeroomAt(sql, tenantId, importV2, all, to);
  const ids = by === 'class' ? [...new Set(classes.map(teacherOf).filter(Boolean))] : []; // 담임 이름은 반 기준에서만 보인다
  const nameOfUser = new Map(ids.length ? (await sql`select id::text id, display_name from public.users where tenant_id=${tenantId} and id = any(${ids}::uuid[])`).map((u) => [u.id, u.display_name]) : []);
  const keyOf = (c) => (by === 'teacher' ? teacherOf(c) ?? 'unassigned' : by === 'class' ? c.id : c.subject === 'english' && c.english_track === 'eie' ? 'eie' : c.subject);
  const groups = new Map(); for (const c of classes) { const k = keyOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const meta = new Map();
  for (const [k, list] of groups) {
    const students = new Set(list.flatMap((c) => [...(studentsOf.get(c.id) ?? [])]));
    const subjects = [...new Set(list.map((c) => subjectName(c.subject === 'english' && c.english_track === 'eie' ? 'eie' : c.subject)))].join(', ');
    const teacher = teacherOf(list[0]); // 반 기준은 반 하나
    meta.set(k, by === 'class' ? { subjects, teacher: (teacher && nameOfUser.get(teacher)) || '담당 미지정', students: students.size } : by === 'teacher' ? { subjects, classes: list.length, students: students.size } : { classes: list.length, students: students.size });
  }
  return meta;
}

export const screen = {
  id: 'trend', label: '확장 추세', order: 90,
  params: { metric: /^[a-z][a-z0-9-]{0,40}$/, grain: /^(day|week|month|year)$/, by: /^[a-z]{1,20}$/, f: /^[a-z]{1,20}:[A-Za-z0-9:._|-]{1,100}$/,
    from: DAY, to: DAY, up: /^(week|month|year)$/ },
  async load({ sql, params, tenantId, importV2 }) {
    const metric = TREND_METRICS.find((m) => m.id === params.metric) ?? TREND_METRICS[0];
    const grains = metric.grains ? GRAINS.filter((g) => metric.grains.includes(g.id)) : GRAINS;
    const grain = grains.some((g) => g.id === params.grain) ? params.grain : grains.some((g) => g.id === 'week') ? 'week' : grains[0].id;
    const dims = metric.dims, fdim = params.f?.slice(0, params.f.indexOf(':'));
    const asOf = (await copyClock()).day, end = metric.endsYesterday ? addDays(asOf, -1) : asOf;
    // 쪼개 보기 = 주소의 범위 — 단위가 그 지표가 받는 그대로일 때만(받지 않아 기본 단위로 바뀌었으면 범위도 버린다).
    const ranged = params.from && params.to && grain === params.grain ? rangeWindows(grain, params.from, params.to, end) : null;
    const windows = ranged ?? windowsFor(grain, end);
    const range = ranged ? (({ from, to }) => { const up = upOf(grain, params.up, from, to); return { from, to, up, label: rangeLabel(up, from, to) }; })({ from: ranged[0].from, to: ranged.at(-1).to }) : null;
    const span = range ? `${grain}@${range.from}~${range.to}` : grain; // 기억 키 — 같은 단위라도 범위가 다르면 다른 답
    // 필터 없이 그 기준으로 나눈 답(필터 이름 찾기 · 옛 열쇠 확인) — 보통 보기와 같은 기억을 쓴다.
    const whole = (dim) => remember(`${tenantId}|${asOf}|${metric.id}|${span}|${dim}|`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by: dim, filter: null }));
    let filter = params.f && dims.some((d) => d.id === fdim) ? { dim: fdim, key: params.f.slice(fdim.length + 1) } : null;
    // 옛 열쇠 — 재원생 '수강 구성별'의 mix:both는 EiE를 쓰는 학원에서 englishMath · eieMath · eieEnglishMath로 갈렸다(원스크린 세션 49b63ec90).
    // 저장된 주소가 그 줄이 없는 지금 이 열쇠로 오면 '기록 없음' 대신 필터 없이 그 기준으로 보여 준다(칩 없음).
    let legacyBy = null;
    if (filter?.dim === 'mix' && filter.key === 'both' && !(await whole('mix')).rows.some((r) => r.key === 'both')) { legacyBy = 'mix'; filter = null; }
    const fkey = filter ? `${filter.dim}:${filter.key}` : '';
    // 기준 = 옛 열쇠의 기준 → 주소의 기준 → 지표의 필터별 기본 기준(defaultBy — 반을 고르면 학생별) → 필터와 다른 첫 기준.
    // 필터와 같은 기준은 안 된다(다시 나눠 봐야 줄이 하나뿐) · 필터가 있어야 하는 기준(needsFilter — 학생별)은 반·선생님 필터일 때만
    // (과목 필터 + 학생별은 수백 줄이라 내지 않는다 · 주소로 와도 무시).
    const usable = (id) => !!id && id !== filter?.dim && dims.some((d) => d.id === id && (!d.needsFilter || NEEDS_FILTER_ON.has(filter?.dim)));
    const defaultBy = metric.defaultBy?.[filter?.dim], explicit = usable(legacyBy) || usable(params.by);
    let by = [legacyBy, params.by, defaultBy].find(usable) ?? (dims.find((d) => usable(d.id)) ?? dims[0]).id;
    const series = (b) => remember(`${tenantId}|${asOf}|${metric.id}|${span}|${b}|${fkey}`, () => metric.series({ sql, asOf, tenantId, importV2, windows, by: b, filter }));
    const pt = (p) => (p ? { num: p[0], den: p[1], value: metric.unit === '%' ? rate(p[0], p[1]) : p[0] } : null);
    const has = (p) => !!p && (metric.unit === '%' ? p.den > 0 : p.num != null);
    // 보여 줄 줄(원장 10-28 "구간 전체에 대해서 0이면 그냥 보여주지말것" · 팀장 정정) — 건수 = 보이는 창 모두가 0이거나 기록 없으면 뺀다 ·
    // 비율 = 분모가 있는 창이 하나도 없을 때만 뺀다(모든 창 0%라도 대상이 있으면 남긴다 — 보고서를 하나도 안 쓴 학생·선생님이 가장 봐야 할 줄).
    const keep = (points) => (metric.unit === '%' ? points.some(has) : points.some((p) => has(p) && p.value !== 0));
    // 앞쪽의 '분자 0' 창 = 이 기록을 쓰기 시작하기 전(대상만 있고 기록이 없다) — 0%로 그리지 않고 잘라 낸다.
    // raw.since = 그 지표를 믿을 수 있는 첫날(지표가 알려 줄 때) — 그보다 앞서 끝난 창도 잘라 낸다.
    // 쪼개 본 범위는 since로만 자른다 — 기록이 있는 기간 안의 0건인 날은 진짜 0이다(9/9~9/15의 첫날이 0건이라고 9/10부터 그리면 칩과 어긋난다).
    const startOf = (r) => Math.max(0, r.since ? windows.findIndex((w) => w.to >= r.since) : range ? 0 : r.total.map(pt).findIndex((p) => has(p) && p.num > 0));
    let raw = await series(by);
    // 기본 기준(defaultBy)으로 골랐는데 줄이 없으면 다음 기준으로 한 번 더(영어 알림장 반 — 작성 의무가 반 단위라 학생 줄이 없다) · 주소에 그 기준을 준 경우만 빈 표.
    if (!explicit && by === defaultBy && !raw.rows.some((r) => keep(r.points.map(pt).slice(startOf(raw))))) { // 표와 같은 창(잘라 낸 뒤)으로 본다
      const next = dims.find((d) => usable(d.id) && d.id !== by);
      if (next) { by = next.id; raw = await series(by); }
    }
    const total = raw.total.map(pt), start = startOf(raw);
    const conf = by === 'subject' || filter?.dim === 'subject' || META_DIMS.has(by) ? (await sql`select data->'operations'->'subjects' s, data->'modules'->'disabled' m from public.tenant_settings where tenant_id=${tenantId}`)[0] : null;
    const subjects = new Map((conf?.s ?? []).map((s) => [s.key, s.label]));
    // 줄 이름 = 지표가 준 이름이 먼저(서버가 '인재원 영어'로 보낸 english 줄이 학원 설정 이름 '영어'로 덮이던 것 — 원스크린 세션 49b63ec90),
    // 지표가 이름을 안 줬거나 열쇠 그대로면 학원 설정의 과목 이름.
    const label = (dim, key, given) => (dim === 'subject' ? (given && given !== key ? given : subjects.get(key) ?? given ?? key) : given);
    // 필터 이름 = DB(선생님·반) 이름 → 필터 없이 그 기준으로 나눈 줄의 이름 → (과목) 학원 설정 이름
    // (과목 설정에 없는 열쇠 — 청구·레벨테스트의 '과목 모름'(unknown) · EiE — 가 열쇠 그대로 'unknown'으로 보였다).
    const filterName = async () => {
      const named = filter.dim === 'subject' ? null : await nameOf(sql, tenantId, filter.dim, filter.key);
      if (named) return named;
      if (dims.find((d) => d.id === filter.dim)?.needsFilter) return '이름 확인 필요'; // 필터 없이는 나누지 않는 기준(학생별)
      const row = (await whole(filter.dim)).rows.find((r) => r.key === filter.key)?.label, nm = label(filter.dim, filter.key, row);
      return nm && nm !== filter.key ? nm : filter.dim === 'class' ? '반 확인 필요' : '이름 확인 필요'; // 열쇠 그대로는 내보내지 않는다
    };
    const shown = windows.slice(start), from = shown[0]?.from, to = shown.at(-1)?.to;
    // 정보 칸의 과목 이름도 줄 이름과 같은 규칙 — 2.0 programLabel(EiE를 쓰는 학원은 영어 = '인재원 영어' · EiE = 'EiE', 안 쓰면 학원의 영어 과목 이름).
    // EiE 사용 = 학원 설정 modules.disabled에 'eie'가 없음(2.0 isModuleEnabled — 기본값은 빈 목록이라 원자료로 판정해도 같다).
    const subjectName = async () => {
      const P = await importV2('features/students/enrollment/program.ts'), own = [...subjects].map(([key, label]) => ({ key, label })), eieOn = !(conf?.m ?? []).includes('eie');
      return (k) => (k === 'eie' ? P.programLabel('eie', own, eieOn) : k === 'english' ? P.programLabel('injaewon', own, eieOn) : subjects.get(k) ?? k);
    };
    // 정보 칸은 선생님·반·과목 기준만 여기서 센다 — 학생별은 지표가 줄에 실은 meta(학교·학년 · 반)를 그대로 쓴다(헛조회하지 않는다).
    const meta = !META_DIMS.has(by) ? null : await remember(`meta|${tenantId}|${asOf}|${by}|${from}~${to}`, async () => rowMeta(sql, tenantId, importV2, from, to, by, await subjectName()))
      .catch((e) => { console.error(`확장 추세 정보 칸: ${e.message}`); return null; });
    return {
      asOf, grain, by,
      // range = 지금 쪼개 보는 범위(없으면 null) · drill = 점을 누르면 쪼갤 단위(쪼개 보는 중이거나 더 잘게 못 나누면 null — 그 점은 누를 수 없다).
      range, drill: range ? null : drillOf(grain, grains.map((g) => g.id)),
      metric: { id: metric.id, label: metric.label, unit: metric.unit, better: metric.better, dims: dims.map((d) => ({ id: d.id, label: d.label, ...(d.needsFilter ? { needsFilter: true } : {}) })) },
      metrics: TREND_METRICS.map((m) => ({ id: m.id, label: m.label, group: m.group, dims: m.dims.map((d) => ({ id: d.id, ...(d.needsFilter ? { needsFilter: true } : {}) })) })),
      grains,
      byOptions: dims.filter((d) => usable(d.id)).map((d) => d.id), // 기준 단추 = 지금 고를 수 있는 기준(화면은 이 목록만 그린다)
      filter: filter ? { ...filter, label: await filterName() } : null,
      windows: shown,
      total: total.slice(start),
      // 보여 줄 줄만(keep — 건수는 보이는 창 모두 0·기록 없음이면 빼고, 비율은 분모가 있는 창이 하나도 없을 때만 뺀다) · 쪼개 보면 그 창들로 다시 본다 · 전체(total)는 늘 남는다.
      rows: raw.rows.map((r) => ({ key: r.key, label: label(by, r.key, r.label), points: r.points.map(pt).slice(start), ...(meta?.has(r.key) ? { meta: meta.get(r.key) } : r.meta ? { meta: r.meta } : {}) })).filter((r) => keep(r.points)),
      ...(filter && Array.isArray(raw.records) && raw.records.length === windows.length ? { records: raw.records.slice(start) } : {}),
    };
  },
};
