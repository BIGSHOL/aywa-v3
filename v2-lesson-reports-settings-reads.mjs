// 2.0 화면 · 수업보고서 관리 — 'AI 멘트' 면 부품(AiMentSection)이 부르는 **읽기** 서버 액션 둘(features/onescreen/server/prompt-actions.ts).
//  · getPromptHistory(type) → { ok, versions } — 그 유형의 재정의 최근 20건(활성 표시).
//  · getRecentReportsForTest() → { ok, reports } — 미리보기에 고를 최근 보고서 30건(진도 있음 · 영어 제외)의 라벨.
//  둘 다 2.0 requireAiMentAccess(열람 + AI 라이선스)를 지난다(같은 게이트 = v2-lesson-reports-face-ai_ment.mjs aiMentGate).
//  화면 GET 열쇠(promptHistory=<유형> · testReports=1)와 호스트 registerHostHandler로 이어 붙인다(원생 listMovableEnrollments 본보기 — 연결은 화면 정의 쪽).
//  미리보기(testPrompt)·말투 지금 갱신(rebuildMentStylesNow)은 AI를 부르므로 연습 자료에서 하지 않는다.
// · 읽기 전용 · 바깥 호출 없음.
import { studentsBase } from './v2-students-common.mjs';
import { aiMentGate, mods } from './v2-lesson-reports-face-ai_ment.mjs';

/** 2.0 getPromptHistory(type). */
export async function promptHistory({ sql: tx, tenantId: t, importV2, viewerId = null }, type) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  const denied = await aiMentGate(base);
  if (denied) return { ok: false, error: denied.error };
  const M = await mods(base.load);
  if (!M.prompts.PROMPT_TYPES.includes(type)) return { ok: false, error: '알 수 없는 프롬프트 유형' };
  const rows = await base.sql`select id::text id, prompt_text, is_active, to_json(created_at)#>>'{}' created_at from public.ai_prompt_overrides
    where tenant_id=${t} and prompt_type=${type} order by created_at desc, id limit 20`;
  return { ok: true, versions: rows.map((r) => ({ id: r.id, text: r.prompt_text, isActive: !!r.is_active, createdAt: r.created_at })) };
}

/** 2.0 getRecentReportsForTest() — 라벨 = `이름 · MM-DD · 진도 앞 18자`(학생을 못 찾으면 '학생'). */
export async function recentReportsForTest({ sql: tx, tenantId: t, importV2, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  const denied = await aiMentGate(base);
  if (denied) return { ok: false, error: denied.error };
  const rows = await base.sql`select id::text id, report_date::text report_date, progress, student_id::text student_id from public.lesson_reports
    where tenant_id=${t} and progress is not null and (subject is null or subject <> 'english') order by report_date desc, id desc limit 30`;
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const students = ids.length ? await base.sql`select id::text id, name from public.students where tenant_id=${t} and id = any(${ids}::uuid[])` : [];
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  return { ok: true, reports: rows.map((r) => ({ id: r.id, label: `${nameById.get(r.student_id) ?? '학생'} · ${r.report_date?.slice(5) ?? ''} · ${(r.progress ?? '').slice(0, 18)}` })) };
}
