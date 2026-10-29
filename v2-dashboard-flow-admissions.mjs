// 운영실 KPI 흐름 — 레벨테스트(2.0 상단 칸 '전일 입테'를 추세로, 원장 10-28 "기존 2.0 kpi들을 전부 흐름으로").
// 판정은 운영실 일정 카드(v2-dashboard-admissions.mjs)와 같은 원본·같은 함수다: 일정 = 2.0 getDateRangeEvents(수기 일정만 · 창과 겹치는 것) ·
// 레벨테스트 = 2.0 admissionsEventKind가 'levelTest'인 일정(취소된 일정 · 예약 차단 · 운영팀 중요일정은 없다) · 창에 든다 = 일정 기간이 창과 겹친다
// (2.0 levelTestsIn — 전일 범위 창의 값 = 2.0 '전일 입테' 칸 숫자).
// · 창은 어제까지로 끝난다(endsYesterday) — 2.0 칸이 오늘이 아니라 '전일'을 세는 까닭(원장 2026-10-22 "측정하는것도 전일 입테로")과 같다: 오늘 입테는
//   아직 치르기 전이거나 그날 새로 잡힐 수 있어, 오늘을 넣으면 하루가 끝날 때까지 값이 흔들린다.
// · 과목별 = 2.0 운영실이 과목 관리자 화면에 일정을 가르는 판정(server.ts calendar의 subjectsOf): 연결된 상담의 과목 · 연결된 반의 과목 · 제목·태그에
//   낱말로 적힌 과목 이름(subjectsNamedIn) → 묶음(sliceGroupsOf — 영어 = EiE·인재원 영어, 수학 = 수학(심화) 포함, 그 밖은 과목 키). 하나도 읽히지 않으면 '과목 모름'.
//   두 묶음이 읽히면 두 줄에 한 번씩 든다 — 줄의 합 ≥ 전체(차이 = 두 과목 이상 일정의 덧셈).
// · 2.0과 다른 점(과목 판정의 재료 범위만 — 셈은 같다):
//   - 상담 연결: 2.0 카드는 '오늘 − 60일' 뒤 상담만 읽는다. 흐름은 지난 창도 그 일정 시점의 매처 창(상담일 ≥ 일정일 − 60일, 매처 자신의 규칙)으로 잇는다.
//   - 메뉴 권한: 일정 카드는 콜&상담·원생·수업 메뉴가 있을 때만 상담·반을 잇는다. 흐름은 원장 기준(모두 있음)으로 잇는다.
//   - 동명이인 가족·반의 운영 여부는 지금 기록으로 본다(지난 날로 되돌리지 않는다 — 2.0도 지금 기록으로 판정한다).
// · since = 이 지점 일정 표에 레벨테스트 일정이 처음 잡힌 날(표에는 그보다 오래된 다른 일정도 있다 — 그 전 창은 0이 아니라 기록 없음).
// 읽기 전용 · 쓰기 없음 · 바깥 호출 없음(일정은 aywa 일정 표만 읽는다).
import { queryGate, rules as rosterRules, resolveSettings } from './v2-onescreen-roster.mjs';
import { kpi, weekWindows, addDays } from './domain-snapshot-core.mjs';
import { tenantId as COPY_TENANT } from './full-db.mjs';
import { englishRules, ENGLISH_RULE_MODULES, consultTracks, namedRecords } from './v2-dashboard-flow-students.mjs';
import { rules as admissionsRules, dateRangeEvents, consultationCandidates, consultationBases, homonymFamilies, firstClassCandidates,
  firstClassScheduleCandidates, admissionsRows } from './v2-dashboard-admissions.mjs';

const SLICE_MODULES = { slices: 'features/dashboard/layout/slices.ts', program: 'features/students/enrollment/program.ts' };
let sliceP = null;
let englishP = null;
const loadEnglishModules = (load) => (englishP ??= Promise.all(Object.entries(ENGLISH_RULE_MODULES).map(async ([k, m]) => [k, await load(m)])).then(Object.fromEntries)
  .catch((e) => { englishP = null; throw e; }));
async function sliceRules(importV2) {
  sliceP ??= Promise.all(Object.entries(SLICE_MODULES).map(async ([k, m]) => [k, await importV2(m)])).then(Object.fromEntries).catch((e) => { sliceP = null; throw e; });
  return sliceP;
}
/** 과목을 하나도 읽지 못한 일정의 줄 키. */
const UNKNOWN = 'unknown';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 2.0 getTenantSettings — 설정 행을 못 읽으면 기본값 + 지점 이름(운영실 조립부와 같은 식). */
async function tenantSettings(gate, RR, t) {
  const [row, name] = await Promise.all([
    gate.soft(async (s) => ({ data: (await s`select data from public.tenant_settings where tenant_id=${t}`)[0]?.data ?? null }), { failed: true }),
    gate.soft(async (s) => (await s`select name from public.tenants where id=${t}`)[0]?.name ?? '', '')]);
  return resolveSettings(RR, row.failed ? {} : row.data, name);
}

/** 이 지점 일정 표에 레벨테스트 일정이 처음 잡힌 날(취소된 것도 기록이다 — 2.0 admissionsEventBaseKind) · 없으면 null. */
async function firstLevelTestDay(R, gate, t) {
  const rows = await gate.soft((s) => s`select e.title, e.start_date::text start_date, tg.name tag_name from public.calendar_events e
    left join public.calendar_tags tg on tg.id = e.tag_id and tg.tenant_id = ${t} where e.tenant_id = ${t} order by e.start_date, e.id`, null)
    ?? await gate.soft((s) => s`select title, start_date::text start_date, null::text tag_name from public.calendar_events where tenant_id = ${t} order by start_date, id`, []);
  return rows.find((r) => R.display.admissionsEventBaseKind({ title: r.title, tag: r.tag_name ? { name: r.tag_name } : null, source: 'manual' }) === 'levelTest')?.start_date ?? null;
}

/**
 * 레벨테스트 일정마다 과목 묶음 — 2.0 calendar 영역과 같은 연결(admissionsRows: 반 · 상담 · 동명이인)과 같은 과목 판정(subjectsOf → sliceGroupsOf).
 * 실패를 삼키는 자리도 일정 카드와 같다: 상담 후보(→ 없음) · 첫 수업 후보(→ 둘 다 없음) · 동명이인(→ 상담 연결 끔).
 */
async function subjectGroups(R, S, gate, t, settings, tests, { eieOn = false, load, today }) {
  const sliceSubjects = settings.operations.subjects.map((s) => ({ key: s.key, label: s.label }));
  const subjectLabels = R.subjects.subjectLabelRecord(settings.operations.subjects), notNames = Object.values(subjectLabels);
  const programSubjects = S.program.programSubjectsOf(subjectLabels), groupOf = (key) => S.program.subjectGroupOf(key, programSubjects);
  // 영어 = EiE · 인재원 영어로 가른다(원장 10-28 "영어와 EiE 분리") — 이름 = 2.0 programLabel · EiE 모듈이 꺼진 학원은 종전 그대로.
  const labelOf = (key) => (key === UNKNOWN ? '과목 모름'
    : eieOn && key === 'eie' ? S.program.programLabel('eie', sliceSubjects, eieOn)
      : eieOn && key === 'english' ? S.program.programLabel('injaewon', sliceSubjects, eieOn)
        : key === 'englishUnsplit' ? '영어(구분 모름)'
        : sliceSubjects.find((s) => s.key === key)?.label ?? sliceSubjects.find((s) => groupOf(s.key) === key)?.label ?? key);
  if (!tests.length) return { groups: new Map(), labelOf, who: new Map() };
  const firstDay = tests.reduce((m, e) => (e.startDate < m ? e.startDate : m), tests[0].startDate), lastDay = tests.reduce((m, e) => (e.endDate > m ? e.endDate : m), tests[0].endDate);
  // 매처는 일정마다 '상담일 ≥ 일정일 − 60일'만 본다 — 가장 이른 일정의 그날부터 한 번 읽으면 모든 일정의 창을 덮는다.
  const since = R.onboard.shiftDate(firstDay, -R.consultLink.CONSULTATION_LINK_WINDOW_DAYS);
  const consultations = await gate.soft((s) => consultationCandidates(R, s, t, since), []);
  let candidates = [], classSlots = [];
  if (tests.some((e) => /첫\s*수업/.test(`${e.title} ${e.tag?.name ?? ''}`))) {
    [candidates, classSlots] = await gate.soft((s) => Promise.all([firstClassCandidates(t, s, firstDay, lastDay), firstClassScheduleCandidates(t, s, firstDay, lastDay)]), [[], []]);
  }
  const bases = consultationBases(R, tests, consultations, notNames);
  const families = bases.length ? await gate.soft((s) => homonymFamilies(R, t, s, bases), null) : new Map();
  const rows = admissionsRows(R, tests, { candidates, classSlots, consultations, families, subjectLabels, notNames, since });
  const consultSubject = new Map(consultations.map((c) => [c.id, c.subject])), classSubject = new Map([...candidates, ...classSlots].map((c) => [c.classId, c.subject]));
  const groupsOf = S.slices.sliceGroupsOf(sliceSubjects, groupOf);
  // EiE 판정 — 영어로 읽힌 일정을 차례대로: ① 이은 반이 영어 반이면 그 반(2.0 programOf: 과목 + english_track — EiE면 EiE, 아니면 인재원 영어)
  // ② 이은 상담 = 신규문의와 같은 판정(원생 흐름 englishRules.consultGroupsOf + consultTracks — 글자의 'EiE'·'인재원' → 이어진 학생의 영어 반 · 같은 상담은 두 지표에서 같은 키)
  // ③ 직원 표식([…])을 뗀 일정 제목·태그에 'EiE'(2.0 admissions-consultation-link.ts stripStaffTags와 같은 정리) · 그래도 모르면 '영어(구분 모름)'(englishUnsplit).
  const classIds = [...new Set(rows.flatMap((row) => (row.matchedClass ? [row.matchedClass.id] : [])))];
  const tracks = eieOn && classIds.length ? new Map((await gate.soft((s) => s`select id::text id, subject, english_track from public.classes where tenant_id=${t} and id = any(${classIds}::uuid[])`, []))
    .map((c) => [c.id, S.program.programOf({ subject: c.subject, englishTrack: c.english_track }, sliceSubjects)])) : new Map();
  const EIE = /eie/i, stripStaffTags = (title) => title.replace(/\[[^\]]*\]/g, ' ');
  const ER = eieOn ? englishRules(await loadEnglishModules(load), settings) : null;
  const consultById = new Map(consultations.map((c) => [c.id, c]));
  const linked = rows.flatMap((row) => (row.matchedConsultation && consultById.get(row.matchedConsultation.id) ? [consultById.get(row.matchedConsultation.id)] : []));
  const consultTrack = ER ? await consultTracks({ gate, t, today, ...ER }, linked.map((c) => ({ id: c.id, studentId: c.studentId, day: c.consultedOn }))) : new Map();
  const englishOf = (row, e) => {
    const cls = row.matchedClass ? tracks.get(row.matchedClass.id) : undefined;
    if (cls === 'eie' || cls === 'injaewon') return cls === 'eie' ? 'eie' : 'english';
    const c = row.matchedConsultation ? consultById.get(row.matchedConsultation.id) : null;
    // 상담이 이어졌으면 그 상담의 판정 그대로(신규문의와 같은 키 — 상담이 '구분 모름'이면 여기서도) · 상담이 없을 때만 제목.
    if (c) {
      const g = ER.consultGroupsOf(c.subject, consultTrack.get(c.id) ?? null);
      return g.includes('eie') ? 'eie' : g.includes('english') ? 'english' : 'englishUnsplit';
    }
    return EIE.test(`${stripStaffTags(e.title ?? '')} ${e.tag?.name ?? ''}`) ? 'eie' : 'englishUnsplit';
  };
  // '자세히 보기' 목록의 사람 — 일정 제목은 쓰지 않는다(연락처·메모가 적힌 일정이 있다): 이은 원생(첫 수업 반 → 상담의 원생) → 이은 상담(문의 이름·학교·학년) → 없음.
  const who = new Map(rows.map((row, i) => {
    const c = row.matchedConsultation ? consultById.get(row.matchedConsultation.id) : null;
    const studentId = row.matchedClass?.studentId ?? c?.studentId ?? null;
    return [tests[i].id, studentId ? { studentId } : c ? { consult: { id: c.id, name: c.name, school: c.school ?? null, grade: c.grade ?? null } } : null];
  }));
  return { labelOf, who, groups: new Map(rows.map((row, i) => {
    const e = tests[i];
    const subjects = [...(row.matchedConsultation ? [consultSubject.get(row.matchedConsultation.id) ?? null] : []), ...(row.matchedClass ? [classSubject.get(row.matchedClass.id) ?? null] : []),
      ...S.slices.subjectsNamedIn(`${e.title} ${e.tag?.name ?? ''}`, sliceSubjects, groupOf)].filter((k) => !!k);
    let found = [...new Set(subjects.flatMap((k) => groupsOf(k)))];
    if (eieOn && found.includes('english')) {
      const k = englishOf(row, e);
      found = [...new Set(found.map((g) => (g === 'english' ? k : g)))];
    }
    return [e.id, found.length ? found : [UNKNOWN]];
  })) };
}

/**
 * 창마다 레벨테스트 수 — `windows` = [{ from, to }](오래된 것부터, 아무 길이) · `bySubject` false면 과목 판정 없이 합계만(카드).
 * 돌려줌 = { since, total: [[수, 1] | null], rows: [{ key, label, points }] } · since 전에 끝난 창 = null(기록 없음).
 */
async function levelTests({ sql, asOf, tenantId: t = COPY_TENANT, importV2, windows, filter = null, bySubject = true }) {
  if (!DAY.test(asOf ?? '')) throw new Error(`기준일 형식이 아닙니다: ${asOf}`);
  if (!windows?.length || windows.some((w) => !DAY.test(w.from ?? '') || !DAY.test(w.to ?? '') || w.from > w.to)) throw new Error('창이 올바르지 않습니다');
  const load = importV2 ?? (await import('./v2-bridge.mjs')).importV2, gate = queryGate(sql);
  const [R, RR, S] = await Promise.all([admissionsRules(load), rosterRules(load), sliceRules(load)]);
  const first = windows.reduce((m, w) => (w.from < m ? w.from : m), windows[0].from), last = windows.reduce((m, w) => (w.to > m ? w.to : m), windows[0].to);
  const since = await firstLevelTestDay(R, gate, t);
  const result = await dateRangeEvents(R, gate, t, first, last);
  if (!result.ready) throw new Error('학원 일정 연결 확인 필요');
  const tests = result.events.filter((e) => R.display.admissionsEventKind(e) === 'levelTest');
  const inWindow = (e, w) => e.startDate <= w.to && e.endDate >= w.from, recorded = (w) => !!since && w.to >= since;
  const count = (list, w) => (recorded(w) ? [list.filter((e) => inWindow(e, w)).length, 1] : null);
  const wantSubjects = bySubject || filter?.dim === 'subject';
  const settings = wantSubjects ? await tenantSettings(gate, RR, t) : null;
  const { groups, labelOf, who = new Map() } = wantSubjects
    ? await subjectGroups(R, S, gate, t, settings, tests, { eieOn: RR.isModuleEnabled(settings.modules.disabled, 'eie'), load, today: asOf })
    : { groups: new Map(), labelOf: (k) => k };
  const chosen = filter?.dim === 'subject' ? tests.filter((e) => groups.get(e.id).includes(filter.key)) : tests;
  const rows = [];
  if (bySubject) {
    const sizes = new Map();
    for (const e of chosen) for (const k of groups.get(e.id)) sizes.set(k, (sizes.get(k) ?? 0) + 1);
    for (const k of [...sizes.keys()].sort((a, b) => sizes.get(b) - sizes.get(a) || labelOf(a).localeCompare(labelOf(b), 'ko'))) {
      const mine = chosen.filter((e) => groups.get(e.id).includes(k));
      rows.push({ key: k, label: labelOf(k), points: windows.map((w) => count(mine, w)) });
    }
  }
  // '자세히 보기' 아래 목록(원장 10-28) — 필터를 걸었을 때만 · 창마다 그 창에 든 레벨테스트 일정(줄 id = 일정 id · 이름 = 일정 제목).
  // 줄 = 이은 원생(id = 학생 id · 이름·학교학년은 원생 표) · 이은 상담(id = 상담 id · 문의 이름·학교·학년) · 없으면 '입학테스트'(id = 일정 id) · key = 일정 id.
  const recordOf = (e) => {
    const w = who.get(e.id), base = { key: e.id, date: e.startDate, dateLabel: '일정일', ...(groups.get(e.id) ? { note: groups.get(e.id).map(labelOf).join('·') } : {}) };
    if (w?.studentId) return { id: w.studentId, ...base };
    if (w?.consult) return { id: w.consult.id, student: false, name: w.consult.name, school: w.consult.school, grade: w.consult.grade, ...base };
    return { id: e.id, student: false, name: '입학테스트', school: null, grade: null, ...base };
  };
  const records = filter ? windows.map((w) => (recorded(w) ? chosen.filter((e) => inWindow(e, w)).map(recordOf) : null)) : null;
  return { since, ...await namedRecords(gate, t, load, { total: windows.map((w) => count(chosen, w)), rows, ...(records ? { records } : {}) }) };
}

/** 확장 추세 지표(trend-metrics.mjs 형식) — 운영실 묶음. */
export const ADMISSIONS_TREND_METRICS = Object.freeze([Object.freeze({
  id: 'level-tests', label: '입학테스트', group: '운영실', unit: '건', better: 'up', dims: Object.freeze([{ id: 'subject', label: '과목별' }]), endsYesterday: true,
  series({ sql, asOf, tenantId, importV2, windows, filter }) {
    return levelTests({ sql, asOf, tenantId, importV2, windows, filter: filter?.dim === 'subject' ? filter : null });
  },
})]);

const BASIS = '학원 일정에 잡힌 입학테스트 중 취소되지 않은 것 · 일정 날짜로 집계';
const cardMemo = new WeakMap();
/**
 * 운영실 KPI 카드 [레벨테스트] — 어제까지 7일 창 8개(점 = 확장 추세 주별과 같은 값 · 큰 숫자 = 마지막 창). 같은 트랜잭션 안에서는 한 번만 센다.
 * ⚠️ 같은 트랜잭션의 다른 조회와 `Promise.all`로 나란히 부르지 말 것 — 안의 저장점 조회가 실패하면 나란히 돌던 조회까지 25P02로 깨진다(따로 await).
 */
export function admissionsKpiCards({ sql, asOf, tenantId = COPY_TENANT, importV2 }) {
  const key = `${tenantId}|${asOf}`, memo = cardMemo.get(sql) ?? new Map();
  if (!cardMemo.has(sql)) cardMemo.set(sql, memo);
  if (!memo.has(key)) memo.set(key, cards({ sql, asOf, tenantId, importV2 }).catch((e) => { memo.delete(key); throw e; })); // 실패는 기억하지 않는다
  return memo.get(key);
}
async function cards({ sql, asOf, tenantId, importV2 }) {
  if (!DAY.test(asOf ?? '')) throw new Error(`기준일 형식이 아닙니다: ${asOf}`);
  const windows = weekWindows(addDays(asOf, -1), 8);
  const { total } = await levelTests({ sql, asOf, tenantId, importV2, windows, bySubject: false });
  return [kpi(ADMISSIONS_TREND_METRICS[0].label, '건', windows.map((w, i) => ({ label: w.label, value: total[i]?.[0] ?? null })),
    { id: 'level-tests', better: 'up', period: 'week', span: '어제까지 7일', basis: BASIS })];
}
