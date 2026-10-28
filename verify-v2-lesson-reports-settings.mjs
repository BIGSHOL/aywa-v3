// 2.0 화면 · 수업보고서 관리 — '보고서 설정' · 'AI 멘트' 면 시험 (Docker 복사본 읽기 · 네트워크·AI 없음).
//   node --test experiments/owner-concept/verify-v2-lesson-reports-settings.mjs
// ① 보고서 설정 면 = page.tsx tabData 모양 · 설정 보고서 섹션 = 학원 설정 병합값 · 강사 후보 = 활성 반 배치 라벨 ∩ 퇴사 아닌 직원 · 영상 반 = 운영 중 반(정렬)
// ② AI 멘트 면 = 프롬프트 4종(재정의 또는 기본값 · inUse) · 말투 행 = teacher_ment_styles(깨진 행 거름) ③ 읽기 둘(이력 · 미리보기 고를 보고서) = 독립 SQL
// ④ 화면 글자에 '2.0'·개발자용 말이 없다. 모두 읽기 전용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen } from './v2-screen-lesson-reports.mjs';
import { promptHistory, recentReportsForTest } from './v2-lesson-reports-settings-reads.mjs';

const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var ro = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (sql, tab) => screen.load({ sql, params: { tab }, tenantId: t, importV2 });
}

test('보고서 설정 면 = page.tsx tabData 모양 · 설정 = 병합값 · 강사 후보 · 영상 반 = 독립 SQL', { skip: SKIP }, async () => {
  await ro(async (sql) => {
    const d = await load(sql, 'report');
    assert.equal(d.tab, 'report'); assert.equal(d.faceMissing, undefined);
    assert.deepEqual(Object.keys(d.tabData).sort(), ['reportSettings', 'staffNames', 'teachers', 'videoClasses']);
    assert.deepEqual(d.tabData.reportSettings, d.settings.report, '보고서 섹션 = 뼈대가 읽은 학원 설정');
    const [{ stored }] = await sql`select data->'report' stored from public.tenant_settings where tenant_id=${t}`;
    for (const [k, v] of Object.entries(stored ?? {})) assert.deepEqual(d.tabData.reportSettings[k], v, `저장된 보고서 칸 ${k}`);
    // 직원 이름 = 퇴사 아닌 직원(공백 정리 · 빈 이름 제외).
    const staff = new Set((await sql`select display_name from public.users where tenant_id=${t} and status::text <> 'inactive'`).map((u) => u.display_name?.trim()).filter(Boolean));
    assert.deepEqual([...d.tabData.staffNames].sort(), [...staff].sort());
    // 강사 후보 = 과목마다 직원 이름에 있는 라벨만 · 가나다순 · 빈 과목 없음 · 그 과목 활성 반 배치에 실제로 나오는 이름.
    assert.ok(Object.keys(d.tabData.teachers).length > 0, '과목별 강사 후보가 있다');
    for (const [subject, names] of Object.entries(d.tabData.teachers)) {
      assert.ok(names.length > 0); assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')), subject);
      for (const n of names) assert.ok(staff.has(n), `${subject}: ${n}은 직원`);
      const [{ n }] = await sql`select count(*)::int n from public.class_schedules s join public.classes c on c.id = s.class_id and c.is_active
        left join public.users st on st.id = s.teacher_id left join public.users ct on ct.id = c.teacher_id
        where s.tenant_id=${t} and c.subject=${subject} and (s.slot_teacher_label = any(${names}) or st.display_name = any(${names}) or ct.display_name = any(${names}))`;
      assert.ok(n > 0, `${subject}: 그 과목 배치에 나오는 이름`);
    }
    // 영상 반 = 활성 · 종강 안 함 · 이름 가나다순.
    const classes = await sql`select id::text id, class_name name, subject from public.classes where tenant_id=${t} and is_active and closed_at is null`;
    assert.deepEqual(d.tabData.videoClasses.map((c) => c.id).sort(), classes.map((c) => c.id).sort());
    const names = d.tabData.videoClasses.map((c) => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')));
    for (const c of d.tabData.videoClasses) { assert.equal(c.active, true); assert.equal(c.subjectKey, classes.find((x) => x.id === c.id).subject); }
    assert.equal(d.gates.canEditReportSettings, true, '원장은 고칠 수 있다(저장은 다음 단계)');
  });
});

test('AI 멘트 면 = 프롬프트 4종(재정의 또는 기본값 · 쓰는 공지 방식) · 말투 행 = teacher_ment_styles', { skip: SKIP }, async () => {
  const P = await importV2('features/onescreen/prompt-defaults.ts');
  const S = await importV2('features/onescreen/ment-style.ts');
  await ro(async (sql) => {
    const d = await load(sql, 'ai_ment');
    assert.equal(d.tab, 'ai_ment'); assert.equal(d.faceMissing, undefined);
    assert.deepEqual(Object.keys(d.tabData).sort(), ['aiPrompts', 'mentStyles']);
    const active = new Map((await sql`select prompt_type, prompt_text from public.ai_prompt_overrides where tenant_id=${t} and is_active`).map((r) => [r.prompt_type, r.prompt_text]));
    const [{ mode }] = await sql`select coalesce(data->'report'->>'noticeMode', 'A') mode from public.tenant_settings where tenant_id=${t}`;
    const modes = new Set([mode, ...(await sql`select distinct report_notice_mode m from public.users where tenant_id=${t} and report_notice_mode in ('A','B')`).map((r) => r.m)]);
    assert.deepEqual(d.tabData.aiPrompts.map((p) => p.type), [...P.PROMPT_TYPES]);
    for (const p of d.tabData.aiPrompts) {
      assert.equal(p.label, P.PROMPT_TYPE_LABELS[p.type]);
      assert.equal(p.text, active.get(p.type) || P.DEFAULT_PROMPTS[p.type], p.type);
      assert.equal(p.isCustom, active.has(p.type)); assert.equal(p.inUse, P.isPromptInUse(p.type, modes), `${p.type} inUse`);
      if (!p.isCustom) assert.equal(p.updatedAt, null);
    }
    const styles = await sql`select teacher_id::text teacher_id, profile from public.teacher_ment_styles where tenant_id=${t} order by built_at desc`;
    const good = styles.filter((r) => S.parseMentStyleProfile(r.profile));
    assert.equal(d.tabData.mentStyles.tableMissing, false);
    assert.deepEqual(d.tabData.mentStyles.rows.map((r) => r.teacherId), good.map((r) => r.teacher_id), '최근 생성순 · 깨진 행 거름');
    for (const r of d.tabData.mentStyles.rows) {
      const [u] = await sql`select display_name from public.users where tenant_id=${t} and id=${r.teacherId}`;
      assert.equal(r.teacherName, u?.display_name || '(이름 없음)');
      assert.match(r.builtAt, /^\d{4}-\d{2}-\d{2}T/, '시각 = PostgREST 글자 모양');
    }
    assert.ok(d.tabData.mentStyles.rows.length > 0, '말투 행이 있는 복사본');
  });
});

test('읽기 둘 = 2.0 getPromptHistory · getRecentReportsForTest(독립 SQL) · 모르는 유형 거절', { skip: SKIP }, async () => {
  const P = await importV2('features/onescreen/prompt-defaults.ts');
  await ro(async (sql) => {
    const io = { sql, tenantId: t, importV2 };
    for (const type of P.PROMPT_TYPES) {
      const h = await promptHistory(io, type);
      const [{ n }] = await sql`select least(count(*), 20)::int n from public.ai_prompt_overrides where tenant_id=${t} and prompt_type=${type}`;
      assert.equal(h.ok, true); assert.equal(h.versions.length, n, type);
    }
    assert.deepEqual(await promptHistory(io, 'nope'), { ok: false, error: '알 수 없는 프롬프트 유형' });
    const r = await recentReportsForTest(io);
    const rows = await sql`select r.id::text id, r.report_date::text d, r.progress, s.name from public.lesson_reports r left join public.students s on s.id = r.student_id
      where r.tenant_id=${t} and r.progress is not null and (r.subject is null or r.subject <> 'english') order by r.report_date desc, r.id desc limit 30`;
    assert.equal(r.ok, true);
    assert.deepEqual(r.reports, rows.map((x) => ({ id: x.id, label: `${x.name ?? '학생'} · ${x.d.slice(5)} · ${(x.progress ?? '').slice(0, 18)}` })));
    assert.ok(r.reports.length > 0);
  });
});

test('화면 글자에 "2.0"·개발자용 말이 없다(주석 뺀 코드)', async () => {
  for (const f of ['./v2-lesson-reports-face-report.mjs', './v2-lesson-reports-face-ai_ment.mjs', './v2-lesson-reports-settings-reads.mjs']) {
    const code = lf(await here(f)).split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const strings = [...code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[가-힣]/.test(x));
    for (const s of strings) assert.ok(!/2\.0|(^|[^\w-])v2([^\w-]|$)|복사본|Docker|API|tenant|함수/.test(s), `${f}: ${s}`);
  }
});

test.after(() => db?.end());
