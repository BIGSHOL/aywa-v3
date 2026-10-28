// 2.0 화면 · 수업보고서 관리 — 'AI 멘트' 면(?tab=ai_ment) 자료 모듈. 계약 = v2-screen-lesson-reports.mjs 머리 주석.
// page.tsx: Promise.all([getActivePrompts(), getMentStyleRows()]) → { aiPrompts: r.prompts ?? [], mentStyles: styles } — 그대로.
//  · getActivePrompts = 활성 프롬프트 재정의(ai_prompt_overrides · is_active) 또는 기본값(2.0 prompt-defaults.ts) · inUse = 쓰는 공지 방식(학원 설정 noticeMode
//    + 강사별 report_notice_mode A/B) — 2.0 isPromptInUse 그대로.
//  · getMentStyleRows = 2.0 listTeacherMentStyles(teacher_ment_styles · 최근 생성순 · 깨진 프로파일은 2.0 parseMentStyleProfile로 거름 · 표가 없으면 tableMissing).
//  · 둘 다 2.0 requireAiMentAccess(AI 멘트 열람 + AI 라이선스)를 지난다 — 이 면은 그 둘이 열렸을 때만 서므로(2.0 lessonReportFaces) 같은 게이트를 다시 본다.
//  · 저장값만 읽는다 — AI를 부르지 않는다(미리보기 · 말투 지금 갱신은 연습 화면에서 하지 않는다).
// · 읽기 전용 · 바깥 호출 없음.

const MODULES = { prompts: 'features/onescreen/prompt-defaults.ts', style: 'features/onescreen/ment-style.ts' };
let modsP = null;
export const mods = (load) => (modsP ??= Promise.all(Object.entries(MODULES).map(async ([k, p]) => [k, await load(p)]))
  .then(Object.fromEntries).catch((e) => { modsP = null; throw e; }));

/** 2.0 requireAiMentAccess(write=false) — 열람 권한 · AI 라이선스(행이 없으면 허용 · 못 읽으면 허용 — 뼈대 aiLicensed와 같은 판정). 실패면 2.0 문구. */
export async function aiMentGate(base) {
  if (!base.viewer) return { error: '로그인이 필요합니다' };
  if (base.level('ai_ment') === 'none') return { error: 'AI 멘트 권한이 없습니다' };
  const row = await base.sql.soft(async (sp) => (await sp`select is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses
    where tenant_id=${base.t} and feature='ai_analysis'`)[0] ?? null, undefined);
  if (!(row === undefined ? true : base.RR.licenseAllows(row, base.clock.at))) return { error: '사용할 수 없는 기능입니다' };
  return null;
}

/** 2.0 getActivePrompts() → { ok, prompts } · 게이트 실패 → { ok:false, error }. */
export async function activePrompts(base, M) {
  const denied = await aiMentGate(base);
  if (denied) return { ok: false, error: denied.error };
  const { sql, t } = base;
  const [data, users] = await Promise.all([
    sql`select prompt_type, prompt_text, to_json(updated_at)#>>'{}' updated_at from public.ai_prompt_overrides where tenant_id=${t} and is_active order by id`,
    sql`select report_notice_mode from public.users where tenant_id=${t} and report_notice_mode is not null order by id`,
  ]);
  // 2.0 usedNoticeModes — 학원 설정 공지 방식(없으면 A) + 강사별 A/B.
  const modes = new Set([base.settings.report.noticeMode ?? 'A']);
  for (const u of users) if (u.report_notice_mode === 'A' || u.report_notice_mode === 'B') modes.add(u.report_notice_mode);
  const active = new Map(data.map((r) => [r.prompt_type, r]));
  const P = M.prompts;
  return { ok: true, prompts: P.PROMPT_TYPES.map((type) => {
    const row = active.get(type);
    return { type, label: P.PROMPT_TYPE_LABELS[type], text: row?.prompt_text || P.DEFAULT_PROMPTS[type], isCustom: !!row, updatedAt: row?.updated_at ?? null,
      inUse: P.isPromptInUse(type, modes) };
  }) };
}

/** 2.0 getMentStyleRows() → listTeacherMentStyles 모양 { rows, tableMissing, error? } · 게이트 실패 → { rows:[], tableMissing:false, error }. */
export async function mentStyleRows(base, M) {
  const denied = await aiMentGate(base);
  if (denied) return { rows: [], tableMissing: false, error: denied.error };
  const { sql, t } = base;
  let failure = null;
  const data = await sql.soft((sp) => sp`select teacher_id::text teacher_id, profile, sample_count, manual_count, edited_count,
      to_json(corpus_until)#>>'{}' corpus_until, to_json(built_at)#>>'{}' built_at, built_by, model
    from public.teacher_ment_styles where tenant_id=${t} order by built_at desc, teacher_id`, (e) => { failure = e; return null; });
  if (!data) {
    if (M.style.isMentStyleTableMissingError({ code: failure?.code, message: failure?.message })) return { rows: [], tableMissing: true };
    return { rows: [], tableMissing: false, error: failure?.message ?? '' };
  }
  const ids = [...new Set(data.map((r) => r.teacher_id))];
  const users = ids.length ? await sql`select id::text id, display_name from public.users where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
  const nameOf = new Map(users.map((u) => [u.id, u.display_name ?? '']));
  const rows = [];
  for (const r of data) {
    const profile = M.style.parseMentStyleProfile(r.profile);
    if (!profile) continue; // 모양이 깨진 행은 화면에 세우지 않는다(2.0과 같다)
    rows.push({ teacherId: r.teacher_id, teacherName: nameOf.get(r.teacher_id) || '(이름 없음)', profile, sampleCount: Number(r.sample_count ?? 0),
      manualCount: Number(r.manual_count ?? 0), editedCount: Number(r.edited_count ?? 0), corpusUntil: r.corpus_until ?? null, builtAt: r.built_at,
      builtBy: r.built_by ?? 'cron', model: r.model ?? null });
  }
  return { rows, tableMissing: false };
}

export async function loadFace(ctx) {
  const M = await mods(ctx.importV2);
  const r = await activePrompts(ctx.base, M);
  const styles = await mentStyleRows(ctx.base, M);
  return { tabData: { aiPrompts: r.prompts ?? [], mentStyles: styles } };
}
