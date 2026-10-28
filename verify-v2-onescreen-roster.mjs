// 2.0 원스크린 props 로더 시험 — node --test experiments/owner-concept/verify-v2-onescreen-roster.mjs
// 모양: 돌려준 키 = 2.0 page.tsx가 `<OneScreenClient>`·`<VideoHomeworkProvider>`에 넘기는 prop 이름(소스에서 뽑는다 — 2.0이 바뀌면 여기서 걸린다),
//       학생·과목·반 줄의 키 ⊆ 2.0 types.ts·roster.ts의 타입 키. 값: 복사본의 실제 선생님·날짜로 독립 SQL과 대조하고, 손그림용 load와 겹치는 사실도 대조.
// 복사본 DB가 없으면 DB 시험은 건너뛴다. 모든 조회는 읽기 전용 트랜잭션.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadOnescreenProps, queryGate, pgError, GateMisuseError, copyClock } from './v2-onescreen-roster.mjs';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** JSX 여는 태그 안의 prop 이름(`key`·children 제외). */
function jsxProps(page, tag, until) {
  const start = page.indexOf(`<${tag}`);
  assert(start >= 0, `page.tsx에 <${tag}>가 없다`);
  const block = stripComments(page.slice(start + tag.length + 1, page.indexOf(until, start + 1)));
  return [...new Set([...block.matchAll(/(?:^|\s)([A-Za-z]\w*)=\{/g)].map((m) => m[1]))].filter((k) => k !== 'key').sort();
}
/** `export type X = { … }`의 최상위 키 — { all, required }. */
function typeKeys(source, name) {
  const s = stripComments(source), at = s.indexOf(`export type ${name} = {`);
  assert(at >= 0, `타입 ${name}이 없다`);
  let depth = 0, i = s.indexOf('{', at), end = -1;
  for (; i < s.length; i += 1) { if (s[i] === '{') depth += 1; else if (s[i] === '}' && --depth === 0) { end = i; break; } }
  const body = s.slice(s.indexOf('{', at) + 1, end), all = new Set(), required = new Set();
  let d = 0;
  for (const line of body.split('\n')) {
    const m = d === 0 && line.match(/^\s*(\w+)(\??):/);
    if (m) { all.add(m[1]); if (!m[2]) required.add(m[1]); }
    for (const ch of line) { if (ch === '{') d += 1; else if (ch === '}') d -= 1; }
  }
  return { all, required };
}
const PAGE = await src('app/(shell)/onescreen/page.tsx'), TYPES = await src('features/onescreen/types.ts'), ROSTER = await src('features/onescreen/server/roster.ts');
const CLIENT_PROPS = jsxProps(PAGE, 'OneScreenClient', '/>'), PROVIDER_PROPS = jsxProps(PAGE, 'VideoHomeworkProvider', '<OneScreenClient');
const T = { student: typeKeys(TYPES, 'OneScreenStudent'), subject: typeKeys(TYPES, 'Subject'), prev: typeKeys(TYPES, 'PrevReport'), todayClass: typeKeys(ROSTER, 'TodayClass') };

// 복사본 사례 준비 — 시험 등록 전에 끝낸다(연결 종료 훅이 먼저 돌지 않게).
if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var { screen } = await import('./v2-screen-onescreen.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (params) => ro((sql) => loadOnescreenProps({ sql, params, tenantId: t, importV2 }));
  var first = await load({});
  var { DEFAULT_SETTINGS } = await importV2('features/owner/defaults.ts');
  var C = await importV2('features/makeups/command-parse.ts'), RF = await importV2('features/onescreen/roster-filter.ts');
  var asOf = first.asOf, from = new Date(Date.parse(`${asOf}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  // 사례: 보고서가 가장 많은 (선생님, 날) · 순수 보강 보고서가 있는 날 · 위임받은 날 · 기본(기준일). 동률은 id로 고정(매번 같은 사례).
  var [busy] = await db`select r.created_by::text teacher, r.report_date::text date from public.lesson_reports r join public.users u on u.id=r.created_by and u.status::text<>'inactive'
    where r.tenant_id=${t} and r.class_id is not null and r.report_date between ${from} and ${asOf} group by 1,2 order by count(*) desc, 2 desc, 1 limit 1`;
  var [makeupDay] = await db`select r.created_by::text teacher, r.report_date::text date from public.lesson_reports r join public.users u on u.id=r.created_by and u.status::text<>'inactive'
    where r.tenant_id=${t} and r.makeup and r.class_id is null and r.report_date <= ${asOf} group by 1,2 order by 2 desc, 1 limit 1`;
  var [deleg] = await db`select d.delegate_user_id::text teacher, d.from_date::text date, d.class_id::text class_id from public.class_delegations d join public.users u on u.id=d.delegate_user_id
    and u.status::text<>'inactive' where d.tenant_id=${t} and d.revoked_at is null and d.from_date <= ${asOf} order by d.from_date desc, d.id limit 1`;
  // 보강 예약(보고서 방식 미지정)이 걸린 날 — `report_mode` 칸 재시도 시험용.
  var [reserved] = await db`select c.teacher_id::text teacher, r.makeup_date::text date from public.makeup_reservations r join public.classes c on c.id=r.class_id and c.is_active
    join public.users u on u.id=c.teacher_id and u.status::text='active' where r.tenant_id=${t} and r.status = any(${['reserved', 'done']}) and r.report_mode is null
    and r.makeup_date <= ${asOf} group by 1,2 order by 2 desc, 1 limit 1`;
  var cases = [{ label: '기본', params: {} }, busy && { label: '보고서 많은 날', params: busy }, makeupDay && { label: '순수 보강 날', params: makeupDay },
    deleg && { label: '위임받은 날', params: { teacher: deleg.teacher, date: deleg.date } }].filter(Boolean);
  var loaded = await Promise.all(cases.map(async (c) => ({ ...c, data: await load(c.params) })));
}

test('2.0 소스에서 prop·타입 목록을 뽑는다(빈 목록이면 비교가 무의미하다)', () => {
  for (const k of ['initial', 'todayClasses', 'presenceScope', 'classnoteMatch', 'readonlyView', 'canLinkIjw']) assert(CLIENT_PROPS.includes(k), k);
  for (const k of ['initial', 'checkDate', 'policy', 'assignmentsKnown', 'cancelInfo']) assert(PROVIDER_PROPS.includes(k), k);
  assert(!CLIENT_PROPS.includes('key') && !PROVIDER_PROPS.includes('key'));
  assert(T.student.required.has('subjects') && T.subject.required.has('prev') && T.todayClass.required.has('startTime') && !T.subject.required.has('classId'));
});

if (db) {

  test('모양: oneScreen·videoHomework 키 = page.tsx prop, 학생·과목·반 줄의 키 ⊆ 2.0 타입', { skip: SKIP }, () => {
    for (const { label, data } of loaded) {
      assert.deepEqual(Object.keys(data.oneScreen).sort(), CLIENT_PROPS, `${label}: OneScreenClient props`);
      assert.deepEqual(Object.keys(data.videoHomework).sort(), PROVIDER_PROPS, `${label}: VideoHomeworkProvider props`);
      assert.deepEqual(Object.keys(data.page), ['makeupNotice']);
      for (const c of data.oneScreen.todayClasses) assert.deepEqual(new Set(Object.keys(c)), T.todayClass.all, `${label}: TodayClass 키`);
      for (const st of data.oneScreen.initial) {
        for (const k of Object.keys(st)) assert(T.student.all.has(k), `${label}: OneScreenStudent에 없는 키 ${k}`);
        for (const k of T.student.required) assert(k in st, `${label}: OneScreenStudent 필수 키 ${k}`);
        for (const su of st.subjects) {
          for (const k of Object.keys(su)) assert(T.subject.all.has(k), `${label}: Subject에 없는 키 ${k}`);
          for (const k of T.subject.required) assert(k in su, `${label}: Subject 필수 키 ${k}`);
          if (su.prevReport) assert.deepEqual(new Set(Object.keys(su.prevReport)), T.prev.all, `${label}: PrevReport 키`);
        }
      }
    }
  });

  test('직렬화: Date·Map·Set·함수 없이 2.0 글자 모양(날짜 YYYY-MM-DD · 시각 PostgREST)', { skip: SKIP }, () => {
    const walk = (v, path) => {
      if (v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)) return;
      assert(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, `${path}: 평범한 객체·배열이 아니다`);
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    let stamps = 0;
    for (const { label, data } of loaded) {
      walk(data, label);
      assert.match(data.oneScreen.date, /^\d{4}-\d{2}-\d{2}$/);
      for (const st of data.oneScreen.initial) {
        if (st.sessionUpdatedAt) { stamps += 1; assert.match(st.sessionUpdatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/, `${label}: 세션 시각`); }
        for (const su of st.subjects) if (su.prevReport) assert.match(su.prevReport.date, /^\d{4}-\d{2}-\d{2}$/);
      }
    }
    assert(stamps > 0, '세션이 있는 학생이 하나도 없다 — 시각 모양을 확인하지 못했다');
  });

  test('값: 날짜 · 반 시작시각 순서 · 그날 보고서와 행 · 출결 · 직전 회차가 독립 SQL과 같다', { skip: SKIP }, async () => {
    let sentChecked = 0, attChecked = 0, prevChecked = 0;
    for (const { label, params, data } of loaded) {
      const o = data.oneScreen, date = o.date, dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];
      assert.equal(date, params.date && params.date <= asOf ? params.date : asOf, `${label}: 날짜`);
      assert.equal(o.presenceScope, `onescreen:${data.actor.id}:${date}`);
      if (params.teacher) assert.equal(data.actor.id, params.teacher, `${label}: 고른 선생님`);
      const ids = o.todayClasses.map((c) => c.id);
      const starts = ids.length ? await db`select class_id::text id, to_char(min(start_time), 'HH24:MI') st from public.class_schedules where tenant_id=${t} and class_id = any(${ids})
        and day_of_week::text=${dow} and (valid_from is null or valid_from<=${date}) and (valid_to is null or valid_to>=${date}) group by 1` : [];
      for (const c of o.todayClasses) {
        assert.equal(c.startTime, starts.find((s) => s.id === c.id)?.st ?? null, `${label}: ${c.name} 시작시각`);
        assert(c.studentCount > 0);
      }
      for (let i = 1; i < o.todayClasses.length; i += 1) assert((o.todayClasses[i - 1].startTime ?? '99:99') <= (o.todayClasses[i].startTime ?? '99:99'), `${label}: 시작시각 순`);
      assert.deepEqual(o.classTags, ['전체', ...o.todayClasses.map((c) => c.name)]);
      const sids = o.initial.map((s) => s.id);
      if (!sids.length) continue;
      const [reports, att, prev] = await Promise.all([
        db`select student_id::text s, class_id::text c, subject, makeup, share_token::text tok, notes from public.lesson_reports where tenant_id=${t} and report_date=${date} and student_id = any(${sids})`,
        db`select distinct on (student_id, class_id) student_id::text s, class_id::text c, status::text status, session_units::float8 units from public.attendance_records
          where tenant_id=${t} and session_date=${date} and student_id = any(${sids}) order by student_id, class_id, recorded_at desc, id desc`,
        db`select student_id::text s, class_id::text c, max(report_date)::text d from public.lesson_reports where tenant_id=${t} and report_date<${date} and student_id = any(${sids}) and class_id is not null group by 1,2`]);
      for (const st of o.initial) for (const su of st.subjects) {
        if (su.classId && !su.splitIn) {
          const exact = reports.find((r) => r.s === st.id && r.c === su.classId);
          if (exact) { assert.equal(su.reportSent, true, `${label}: ${st.name} ${su.name} 저장됨`); assert.equal(su.shareToken, exact.tok); sentChecked += 1; }
          else if (su.reportSent) assert(reports.some((r) => r.s === st.id && !r.c && !r.makeup), `${label}: ${st.name} ${su.name} — 반 없는 보고서도 없이 저장 표시`);
          const p = prev.find((r) => r.s === st.id && r.c === su.classId);
          if (p) { assert.equal(su.prevReport?.date, p.d, `${label}: ${st.name} ${su.name} 직전 회차`); prevChecked += 1; }
        }
        if (su.classId) {
          const a = att.find((r) => r.s === st.id && r.c === su.classId);
          assert.equal(su.attendanceRaw, a?.status ?? null, `${label}: ${st.name} ${su.name} 출결`);
          assert.equal(su.attendanceUnits, a ? a.units : null);
          if (a) attChecked += 1;
        }
        // 자유 글은 원문 그대로(세션 초안이 없을 때 = 보고서 notes).
        if (su.reportSent && su.classId && su.draft && !st.sessionUpdatedAt) {
          const r = reports.find((x) => x.s === st.id && x.c === su.classId);
          if (r?.notes) assert.equal(su.draft, r.notes, `${label}: ${st.name} 멘트 원문`);
        }
      }
    }
    assert(sentChecked > 0 && attChecked > 0 && prevChecked > 0, `대조한 건수가 0이다(저장 ${sentChecked} · 출결 ${attChecked} · 직전 ${prevChecked})`);
  });

  test('값: 순수 보강 보고서는 보강 줄로, 위임받은 반은 위임 표식으로 선다', { skip: SKIP }, async () => {
    const mk = loaded.find((c) => c.label === '순수 보강 날');
    if (mk) {
      const owned = await db`select student_id::text s, coalesce(nullif(btrim(subject), ''), 'math') subj from public.lesson_reports
        where tenant_id=${t} and report_date=${mk.params.date} and makeup and class_id is null and created_by=${mk.params.teacher}`;
      assert(owned.length > 0);
      for (const r of owned) {
        const st = mk.data.oneScreen.initial.find((s) => s.id === r.s);
        assert(st?.subjects.some((su) => su.makeup && !su.classId && su.subjectKey === r.subj && su.reportSent), `보강 줄 ${r.s}`);
      }
    }
    const dl = loaded.find((c) => c.label === '위임받은 날');
    if (dl) {
      const date = dl.params.date, dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];
      const [meets] = await db`select exists(select 1 from public.class_schedules where tenant_id=${t} and class_id=${deleg.class_id} and day_of_week::text=${dow}
        and (valid_from is null or valid_from<=${date}) and (valid_to is null or valid_to>=${date})) yes, c.is_active, c.teacher_id = ${dl.params.teacher} own, o.display_name owner
        from public.classes c left join public.users o on o.id=c.teacher_id where c.id=${deleg.class_id}`;
      // 그날 그 반에 설 학생 수 = 독립 SQL(날짜창) + 2.0 수강 판정(분리등원·휴원·반이동).
      const enr = await db`select student_id, class_id, start_date::text start_date, end_date::text end_date, on_hold, is_transferred, attendance_days from public.enrollments
        where tenant_id=${t} and class_id=${deleg.class_id} and (start_date is null or start_date<=${date}) and (end_date is null or end_date>=${date})`;
      const count = enr.filter((e) => RF.rosterIncludesEnrollment(e, date, dow, true)).length;
      const shown = dl.data.oneScreen.todayClasses.find((c) => c.id === deleg.class_id);
      if (meets.yes && meets.is_active && count > 0) {
        assert(shown, '그날 도는 위임 반이 서지 않았다');
        assert.equal(shown.studentCount, count);
        assert.equal(shown.delegated, !meets.own);
        assert.equal(shown.ownerName, meets.own ? null : meets.owner);
      } else assert.equal(shown, undefined, '그날 학생이 없거나 안 도는 위임 반이 섰다');
    }
  });

  test('값: 손그림용 load(screen.load)와 겹치는 사실 — 반 목록 · 정규 줄 · 저장 여부가 같다', { skip: SKIP }, async () => {
    let compared = 0;
    for (const { label, params, data } of loaded.filter((c) => c.params.teacher && c.params.date)) {
      const old = await ro((sql) => screen.load({ sql, params: { teacher: params.teacher, date: params.date }, tenantId: t, importV2 }));
      assert.equal(old.date, data.oneScreen.date);
      assert.deepEqual(old.todayClasses.map((c) => c.id).sort(), data.oneScreen.todayClasses.map((c) => c.id).sort(), `${label}: 반 목록`);
      const regular = data.oneScreen.initial.flatMap((s) => s.subjects.filter((su) => su.classId && !su.splitIn).map((su) => ({ s: s.id, su })));
      const oldRows = old.students.flatMap((s) => s.subjects.map((su) => ({ s: s.id, su })));
      assert.equal(regular.length, oldRows.length, `${label}: 정규 줄 수`);
      for (const { s, su } of oldRows) {
        const mine = regular.find((r) => r.s === s && r.su.classId === su.classId);
        assert(mine, `${label}: ${s} ${su.className} 줄이 없다`);
        assert.equal(!!mine.su.reportSent, su.saved, `${label}: ${s} ${su.className} 저장 여부`);
        compared += 1;
      }
    }
    assert(compared > 0);
  });

  test('값: 영상 숙제 — 그날 영상 과제 값 · 남이 쓴 줄 · 검사 기록이 독립 SQL과 같다', { skip: SKIP }, async () => {
    let checked = 0;
    for (const { label, data } of loaded) {
      const v = data.videoHomework, date = data.oneScreen.date, sids = data.oneScreen.initial.map((s) => s.id);
      assert.equal(v.checkDate, date);
      assert.deepEqual(v.policy, data.oneScreen.reportSettings.videoHomeworkPolicy);
      if (!v.policy.enabled || !sids.length) continue;
      const [vh, others] = await Promise.all([
        db`select student_id::text s, class_id::text c, video_homework v from public.lesson_reports where tenant_id=${t} and report_date=${date} and student_id = any(${sids}) and class_id is not null and video_homework is not null`,
        db`select student_id::text s, class_id::text c from public.lesson_reports where tenant_id=${t} and report_date=${date} and student_id = any(${sids}) and class_id is not null
          and created_by is not null and created_by <> ${data.actor.id}`]);
      for (const r of vh) { assert.equal(v.assignments[`${r.s}|${date}|${r.c}`], r.v, `${label}: 영상 과제 ${r.s}`); checked += 1; }
      assert.deepEqual([...v.othersReports].sort(), others.map((r) => `${r.s}|${date}|${r.c}`).sort(), `${label}: 남이 쓴 줄`);
      for (const m of v.initial) assert(sids.includes(m.studentId) && (m.checkDate === date || m.homeworkDate));
      assert.equal(v.submitLinkMode, 'off', '2.0 REPORT_VIDEO_LINK_RETIRED = 링크 넣기 꺼짐');
    }
    assert(checked > 0, '영상 과제 값이 있는 보고서를 하나도 대조하지 못했다');
  });

  test('설정·권한: 학원 설정 병합 · 출결 쓰기 · 짝 잇기 권한이 저장값과 맞다', { skip: SKIP }, async () => {
    const [{ data: stored, name }] = await db`select s.data, tn.name from public.tenants tn join public.tenant_settings s on s.tenant_id=tn.id where tn.id=${t}`;
    const o = first.oneScreen;
    // 2.0 deepMerge: 저장값 null은 기본값을 남긴다 · 원시값·배열은 저장값으로 바뀐다.
    let compared = 0;
    for (const [k, v] of Object.entries(stored.report ?? {})) {
      if (!(k in DEFAULT_SETTINGS.report) || (v !== null && typeof v === 'object' && !Array.isArray(v))) continue;
      assert.deepEqual(o.reportSettings[k], v === null ? DEFAULT_SETTINGS.report[k] : v, `report.${k}`);
      compared += 1;
    }
    assert(compared > 0);
    if (stored.report?.videoHomeworkPolicy) for (const [k, v] of Object.entries(stored.report.videoHomeworkPolicy)) assert.deepEqual(o.reportSettings.videoHomeworkPolicy[k], v);
    assert.equal(o.academyName, stored.profile?.name || name);
    assert.equal(o.academyNoticeMode, stored.report?.noticeMode ?? 'A');
    // 강사: 저장된 역할 덮개(students · teacher)가 있으면 그 값이 짝 잇기를 정한다.
    const [teacher] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id and c.is_active where u.tenant_id=${t} and u.system_role::text='teacher' and u.status::text<>'inactive' order by u.id limit 1`;
    const ov = (stored.permissions?.overrides ?? []).find((x) => x.menu === 'students' && x.role === 'teacher');
    const tv = await load({ teacher: teacher.id });
    assert.equal(tv.actor.id, teacher.id);
    if (ov) assert.equal(tv.oneScreen.canLinkIjw, ov.access === 'full', '강사 짝 잇기 = 덮개 값');
    // 원장(master)은 출결 쓰기·학생 기록 관리가 열려 있다(2.0 resolveMatrix: master 전체).
    const [master] = await db`select id::text id from public.users where tenant_id=${t} and system_role::text='master' and status::text<>'inactive' order by id limit 1`;
    const mv = await load({ teacher: master.id });
    assert.equal(mv.oneScreen.canEditAttendance, true);
    assert.equal(mv.oneScreen.canLinkIjw, true);
    // 없는 선생님 id는 기본 선택으로 떨어진다(손그림 load와 같은 규칙).
    const fb = await load({ teacher: '00000000-0000-4000-8000-000000000000' });
    assert.equal(fb.actor.id, first.actor.id);
    // 기본 선생님 = 재직 중인 활성 반 담임 중 최근 30일 보고서가 가장 많은 사람(독립 SQL).
    const [expected] = await db`select u.id::text id from public.users u where u.tenant_id=${t} and u.status::text='active'
        and exists(select 1 from public.classes c where c.teacher_id=u.id and c.tenant_id=${t} and c.is_active)
      order by (select count(*) from public.lesson_reports r where r.tenant_id=${t} and r.created_by=u.id and r.report_date > ${new Date(Date.parse(`${asOf}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10)}) desc, u.display_name limit 1`;
    assert.equal(first.actor.id, expected.id);
  });

  test('관문: 트랜잭션 안의 .catch는 트랜잭션을 못 살린다 — sql.soft는 실패를 그 조회에 가두고 나머지 조회는 그대로 끝난다', { skip: SKIP }, async () => {
    // 고친 이유의 재현: 오류를 삼켜도 postgres.js가 기억했다가 트랜잭션째 실패시킨다.
    await assert.rejects(ro(async (tx) => { await tx`select * from public.v2_no_such_table_for_test`.catch(() => null); return 1; }));
    const out = await ro(async (tx) => {
      const sql = queryGate(tx), jobs = [];
      for (let i = 0; i < 8; i += 1) {
        jobs.push(sql`select ${i}::int n`.then((r) => r[0].n));
        if (i % 3 === 0) jobs.push(sql.soft((sp) => sp`select * from public.v2_no_such_table_for_test`, `fallback-${i}`));
        if (i === 4) jobs.push(sql.soft(async (sp) => (await sp`select 1/0 x`)[0].x, (e) => e.code));
        if (i === 5) jobs.push(sql.soft(async (sp) => (await sp`select 70 + ${i}::int v`)[0].v, 'unused'));
      }
      return Promise.all(jobs);
    });
    assert.deepEqual(out, [0, 'fallback-0', 1, 2, 3, 'fallback-3', 4, '22012', 5, 75, 6, 'fallback-6', 7]);
  });

  test('보강 참여 오류 판정: postgres.js 오류(detail)를 PostgREST 모양(details)으로 옮겨야 2.0 판정이 맞는다', { skip: SKIP }, async () => {
    const [forbidden, modeOff] = await ro(async (tx) => {
      const sql = queryGate(tx);
      return Promise.all(['forbidden', 'mode_off'].map((code) => sql.soft((sp) => sp`select makeup_private.fail(${code}, '시험')`, (e) => ({ raw: e, mapped: pgError(e) }))));
    });
    assert.equal(C.isParticipantPermissionDenied(forbidden.raw), false, '옮기지 않으면 권한 거절을 못 알아본다');
    assert.equal(C.isParticipantPermissionDenied(forbidden.mapped), true);
    assert.equal(C.isModeOffError(modeOff.mapped), true);
    assert.equal(C.isModeOffError(forbidden.mapped), false);
  });

  /** 시험용 고장 주입 — 글자가 맞는 조회를 실패하는 조회로 바꿔 친다(저장점 안의 조회까지). 고장 낸 횟수를 센다. */
  const faulty = (tx, rules) => {
    const hits = {};
    const wrap = (s) => {
      const f = (strings, ...values) => {
        const rule = rules.find((r) => r.match.test(strings.join('?')));
        if (!rule) return s(strings, ...values);
        hits[rule.name] = (hits[rule.name] ?? 0) + 1;
        return rule.missingColumn ? s`select v2_fault_injected_report_mode from public.makeup_reservations limit 0` : s`select * from public.v2_fault_injected_missing_table`;
      };
      f.json = (v) => s.json(v);
      f.savepoint = (fn) => s.savepoint((sp) => fn(wrap(sp)));
      return f;
    };
    return { sql: wrap(tx), hits };
  };
  const loadFaulty = (params, rules) => ro(async (tx) => { const { sql, hits } = faulty(tx, rules); return { data: await loadOnescreenProps({ sql, params, tenantId: t, importV2 }), hits }; });
  const rowsOf = (d) => d.oneScreen.initial.flatMap((s) => s.subjects.map((su) => `${s.id}|${su.classId}|${su.name}|${!!su.reportSent}`)).sort();

  test('실패를 삼키는 조회: 2.0처럼 그 값만 폴백되고 화면 나머지는 그대로 뜬다', { skip: SKIP }, async () => {
    const params = busy, normal = loaded.find((c) => c.label === '보고서 많은 날').data;
    const rules = [
      { name: 'readStats', match: /onescreen_parent_read_stats/ }, { name: 'prior', match: /onescreen_prior_reports/ }, { name: 'cn', match: /classnote_class_board_members/ },
      { name: 'cancels', match: /from public\.video_homework_cancels/ }, { name: 'author', match: /report_display_name/ }, { name: 'lab', match: /lab_menu_assignments/ },
      { name: 'sheet', match: /class_sheet_plan_lines/ }, { name: 'dueProbe', match: /select video_homework_due from public\.lesson_reports limit 1/ },
      { name: 'order', match: /onescreen_student_order/ }, { name: 'super', match: /super_admins/ }];
    const { data, hits } = await loadFaulty(params, rules);
    for (const r of rules) assert(hits[r.name] >= 1, `${r.name} 조회가 고장 나지 않았다`);
    // 폴백: 읽음 배지 없음 · 직전 회차 없음 · C.N 매칭 없음 · 마감 토글 준비 안 됨 · 발송용 이름 = 원래 이름.
    assert(normal.oneScreen.initial.some((s) => s.parentRead) && !data.oneScreen.initial.some((s) => s.parentRead));
    assert(normal.oneScreen.initial.some((s) => s.subjects.some((su) => su.prevReport)) && !data.oneScreen.initial.some((s) => s.subjects.some((su) => su.prevReport)));
    assert.equal(normal.oneScreen.classnoteMatch.available, true);
    assert.equal(data.oneScreen.classnoteMatch.available, false);
    assert.equal(normal.videoHomework.dueReady, true);
    assert.equal(data.videoHomework.dueReady, false);
    assert.equal(data.oneScreen.teacherName, data.actor.name);
    // 나머지는 같다: 반 · 학생 × 반 줄 · 저장 여부 · 출결 쓰기 권한.
    assert.deepEqual(data.oneScreen.todayClasses, normal.oneScreen.todayClasses);
    assert.deepEqual(rowsOf(data), rowsOf(normal));
    assert.equal(data.oneScreen.canEditAttendance, normal.oneScreen.canEditAttendance);
    // 같은 숙제의 다른 자리 검사 기록(덧붙는 조회) — 직전 회차가 있어야 도는 조회라 따로 고장 낸다. 그날 검사 기록만 남는다.
    const same = await loadFaulty(params, [{ name: 'sameHomework', match: /check_date <> / }]);
    assert(same.hits.sameHomework >= 1);
    const key = (m) => `${m.classId}|${m.studentId}|${m.checkDate}|${m.homeworkDate}|${m.status}`, normalMarks = new Set(normal.videoHomework.initial.map(key));
    for (const m of same.data.videoHomework.initial) { assert.equal(m.checkDate, normal.oneScreen.date); assert(normalMarks.has(key(m))); }
    assert.deepEqual(rowsOf(same.data), rowsOf(normal));
    // 2.0도 화면이 죽는 조회(수강)는 그대로 실패한다.
    await assert.rejects(loadFaulty(params, [{ name: 'enrollments', match: /from public\.enrollments where/ }]));
  });

  test('보강 예약: report_mode 칸이 없으면 2.0처럼 그 칸 없이 다시 읽는다', { skip: SKIP || (!reserved && '보강 예약 사례 없음') }, async () => {
    const normal = await load(reserved);
    const marked = (d) => d.oneScreen.initial.flatMap((s) => s.subjects.filter((su) => su.makeupReserved || (su.makeup && !su.classId)).map((su) => `${s.id}|${su.name}|${JSON.stringify(su.makeupReserved ?? null)}`)).sort();
    assert(marked(normal).length > 0, '예약이 걸린 줄이 없다 — 재시도를 확인할 수 없다');
    const { data, hits } = await loadFaulty(reserved, [{ name: 'reportMode', match: /report_mode from public\.makeup_reservations/, missingColumn: true }]);
    assert.equal(hits.reportMode, 1);
    assert.deepEqual(marked(data), marked(normal), '방식 미지정 예약은 칸 없이 읽어도 같은 줄');
    // 다른 실패면 다시 읽지 않고 빈 목록 — 예약 표식이 사라진다.
    const gone = await loadFaulty(reserved, [{ name: 'reservations', match: /from public\.makeup_reservations/ }]);
    assert.equal(gone.hits.reservations, 1);
    assert(!gone.data.oneScreen.initial.some((s) => s.subjects.some((su) => su.makeupReserved)));
  });

  test('관문: 저장점 안에서 sql·sql.soft를 부르면 멈추지 않고 바로 오류가 난다(폴백으로 삼키지 않는다)', { skip: SKIP }, async () => {
    const within = (p, ms = 3000) => { let timer; return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error('멈춤(시간 초과)')), ms); })]).finally(() => clearTimeout(timer)); };
    const out = await within(ro(async (tx) => {
      const sql = queryGate(tx), res = [];
      for (const misuse of [() => sql`select 1`, () => sql.soft((sp2) => sp2`select 1`, 'inner')]) {
        res.push(await within(sql.soft(async (sp) => { await sp`select 1`; return misuse(); }, 'swallowed').then((value) => ({ value }), (error) => ({ error }))));
      }
      // 표식은 그 저장점의 흐름에만 붙는다 — 나란히 온 보통 조회는 기다렸다 끝나고, 트랜잭션도 살아 있다.
      res.push(await Promise.all([sql.soft(async (sp) => (await sp`select 1 n`)[0].n, 0), sql`select 2 n`.then((x) => x[0].n)]));
      res.push((await sql`select 3 n`)[0].n);
      return res;
    }), 10000);
    for (const r of out.slice(0, 2)) assert(r.error instanceof GateMisuseError, `오류가 아니다: ${JSON.stringify(r)}`);
    assert.deepEqual(out.slice(2), [[1, 2], 3]);
  });

  test('설정 행만 못 읽으면 2.0처럼 기본 설정 + 지점 이름(academyName = tenants.name)', { skip: SKIP }, async () => {
    const [{ name }] = await db`select name from public.tenants where id=${t}`;
    assert(name, '지점 이름이 비어 있으면 이 시험이 의미가 없다');
    const { data, hits } = await loadFaulty(busy, [{ name: 'settings', match: /from public\.tenant_settings where/ }]);
    assert.equal(hits.settings, 1);
    assert.equal(DEFAULT_SETTINGS.profile.name, '');
    assert.equal(data.oneScreen.academyName, name);
    assert.deepEqual(data.oneScreen.reportSettings, DEFAULT_SETTINGS.report, '설정을 못 읽었으면 보고서 설정은 기본값');
    // 지점 이름까지 못 읽으면 ''(2.0 tenantRes.error → name '').
    const both = await loadFaulty(busy, [{ name: 'settings', match: /from public\.tenant_settings where/ }, { name: 'tenant', match: /from public\.tenants where/ }]);
    assert.equal(both.data.oneScreen.academyName, '');
  });

  test('hostSettings = 2.0 셸이 OperationsProvider에 넘기는 값(같은 이름 · 로더 설정 그대로 · 라이선스는 행 있는 것만)', { skip: SKIP }, async () => {
    const layout = await src('app/(shell)/layout.tsx');
    const uses = [...layout.matchAll(/<OperationsProvider\b([^>]*)>/g)].map((m) => [...m[1].matchAll(/(\w+)=\{/g)].map((x) => x[1]).sort());
    assert(uses.length > 0);
    for (const u of uses) assert.deepEqual(u, uses[0], '셸 세 갈래가 같은 prop을 넘긴다');
    for (const { label, data } of loaded) {
      const h = data.hostSettings;
      assert.deepEqual(Object.keys(h).sort(), ['disabledModules', 'licenses', 'operations']);
      assert.deepEqual([...Object.keys(h.operations), 'disabledModules', 'licenses'].sort(), uses[0], `${label}: prop 이름`);
      assert.deepEqual(h, loaded[0].data.hostSettings, `${label}: 같은 지점이면 선생님·날짜와 무관하게 같다`);
      assert(Array.isArray(h.operations.subjects) && h.operations.subjects.length > 0 && Array.isArray(h.operations.gradeLevels) && Array.isArray(h.disabledModules));
    }
    // 독립 대조: 저장값(학년·직급) · 라이선스 행(활성 ∧ 만료 전, 기준 = 복사본을 뜬 시각).
    const [{ data: stored }] = await db`select data from public.tenant_settings where tenant_id=${t}`;
    const h = first.hostSettings;
    assert.deepEqual(h.operations.gradeLevels, stored.operations?.gradeLevels ?? DEFAULT_SETTINGS.operations.gradeLevels);
    assert.deepEqual(h.operations.jobTitles, stored.operations?.jobTitles ?? DEFAULT_SETTINGS.operations.jobTitles);
    const subjectKeys = (stored.operations?.subjects ?? DEFAULT_SETTINGS.operations.subjects).map((s) => s.key);
    assert.deepEqual(h.operations.subjects.map((s) => s.key), subjectKeys);
    const { at } = await copyClock();
    const rows = await db`select feature, is_active, expires_at from public.tenant_licenses where tenant_id=${t} and feature = any(${['ai_analysis', 'google_sheets', 'meeting_recording', 'window_mode']})`;
    assert.deepEqual(h.licenses, Object.fromEntries(rows.map((r) => [r.feature, r.is_active && (!r.expires_at || r.expires_at.getTime() > at.getTime())])));
  });
}

test.after(() => db?.end());
