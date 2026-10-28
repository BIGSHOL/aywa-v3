// 2.0 화면 — 수업보고서 관리(app/(shell)/lesson-reports/page.tsx · V2-SCREENS.md 대상 `lesson-reports`).
// 그리기는 2.0의 실제 React 부품이 한다(v2-host/src/lesson-reports.tsx · lesson-reports-page.tsx). 이 모듈은 page.tsx가 서버에서 하던 일을 Docker 복사본에서:
//  · 화면 주인 = 원장(v2-students-common.mjs studentsBase — 운영실·원생과 같은 보는 사람 · 2.0 권한표) · 권한 칸 6개 = page.tsx의 canAccessTenant ·
//    canWriteTenant(full·scoped) 그대로 · 학원 설정 = 2.0 getTenantSettings · aiOn = isFeatureLicensed('ai_analysis')(라이선스 행 — 없으면 허용) ·
//    면 고르기 = 2.0 resolveLessonReportTab(classnoteModuleOn · classnoteReplyMode 포함) 그대로.
//  · 고른 면 하나의 자료만 읽는다(2.0 '활성 탭만 무거운 조회'). 면마다 모듈 `v2-lesson-reports-face-<면>.mjs` — 없으면 { faceMissing: true }.
//
// ── 면 모듈 계약(다음 작업자) ────────────────────────────────────────────────────────────────────────────────────────────
//  본보기 = v2-lesson-reports-face-writing.mjs(작성률 — 2.0 getWeeklyWritingRates).
//  export async function loadFace(ctx) → { queue?, tabData? } — page.tsx의 `queue`(발송 큐 면만 · getClassnoteQueue(3) 모양)와 `tabData`(그 면의 모양 그대로:
//    writing { rates } · boards { boardRoster } · report { reportSettings, teachers, staffNames, videoClasses } · notice { noticeClasses, noticeRows, classWide } ·
//    compose { composeStudents, composeClasses, composeSendEnabled, composeShowDailyTest, composeShowCheckTest, composeShowAttachments } ·
//    parent_replies { parentThreads } · recall { recallOptions } · ai_ment { aiPrompts, mentStyles } · list { filterOptions, initialList }).
//    조회 실패를 2.0이 null로 그리는 면(rates · boardRoster · parentThreads)은 null을 돌려준다(2.0 안내 문구가 그대로 선다).
//  ctx = { base(studentsBase — sql 관문 · RR · load · settings · viewer · level · today · clock), sql(queryGate — 저장점 안에선 sp만), t, sp(이 화면 열쇠),
//    tab, gates, settings, classnoteOn, replyMode, today(복사본 날짜), importV2 }.
//  면 안 클라 부품이 부르는 2.0 서버 함수: 읽기(목록 쪽 넘김 listReports · 회수 검색 등)는 이 화면 GET 열쇠 + 호스트 registerHostHandler
//    (원생 화면 listMovableEnrollments 본보기 — 이 파일 params와 lesson-reports.tsx에 더한다), 저장은 screen.actions(원생 저장 모듈 본보기).
//  바깥 호출(ClassNote · 알림톡 · AI) 금지 — 발송은 2.0이 남기는 큐 행까지만 복사본에.
//  지금 이어 붙인 다시 읽기(GET 열쇠): list(listReports — v2-lesson-reports-reads.mjs readList) · cnread=queue|notices|classwide|sync + days
//    (refreshClassnoteQueue · listClassNotices · listClassWideNotices · getClassnoteSyncStatus — v2-lesson-reports-classnote-reads.mjs readClassnote) ·
//    promptHistory · testReports(getPromptHistory · getRecentReportsForTest — v2-lesson-reports-settings-reads.mjs). 통계 = v2-lesson-reports-stats.mjs.
// · 저장 = v2-lesson-reports-save.mjs(2.0 서버 함수 그대로 · 공용 러너 write) — 저장하는 사람 고르기 목록(editors)을 화면 자료에 싣는다.
import { studentsBase } from './v2-students-common.mjs';
import { lessonReportsActions, readLessonEditors } from './v2-lesson-reports-save.mjs';

const ID = 'lesson-reports';
const SUB = /^\/lesson-reports(?:\/(stats))?$/;
/** 2.0 page.tsx(+ 면 부품 parent-replies-face의 page)가 읽는 열쇠. */
export const KEYS = Object.freeze(['tab', 'section', 'status', 'rmonth', 'page']);

async function optional(file) {
  try { return await import(`./${file}`); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(file)) return null;
    throw e;
  }
}

let rulesP = null;
const rules = (load) => (rulesP ??= Promise.all([load('features/report-admin/lesson-report-faces.ts'), load('features/owner/classnote-gate.ts')])
  .then(([faces, gate]) => ({ faces, gate })).catch((e) => { rulesP = null; throw e; }));

/** 2.0 isFeatureLicensed(tenant, 'ai_analysis') — 라이선스 행이 없으면 허용 · 있으면 2.0 licenseAllows. 못 읽으면 허용(2.0 폴백과 같다). */
async function aiLicensed(base) {
  const row = await base.sql.soft(async (sp) => (await sp`select is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses
    where tenant_id=${base.t} and feature='ai_analysis'`)[0] ?? null, undefined);
  return row === undefined ? true : base.RR.licenseAllows(row, base.clock.at);
}

export async function buildLessonReports({ sql: tx, tenantId: t, importV2, sp = {}, viewerId = null }) {
  const base = await studentsBase({ sql: tx, tenantId: t, importV2, viewerId });
  if (!base.viewer) return { notFound: true };
  const R = await rules(base.load), lvl = base.level, can = (m) => lvl(m) !== 'none', write = (m) => ['full', 'scoped'].includes(lvl(m));
  const gates = { canReportSettings: can('report_settings'), canAiMent: can('ai_ment'), canEditReportSettings: write('report_settings'),
    canEditAiMent: write('ai_ment'), canSendReports: write('lesson_reports'), canReports: can('lesson_reports') };
  const settings = base.settings, aiOn = await aiLicensed(base);
  const classnoteOn = R.gate.classnoteModuleOn(settings), replyMode = R.gate.classnoteReplyMode(settings);
  const faceOptions = { canReportSettings: gates.canReportSettings, canAiMent: gates.canAiMent, canSend: gates.canSendReports, classnoteOn, aiOn, replyOn: replyMode !== 'off', canReports: gates.canReports };
  const tab = R.faces.resolveLessonReportTab(sp, faceOptions);
  const mod = await optional(`v2-lesson-reports-face-${tab}.mjs`);
  const ctx = { base, sql: base.sql, t, sp, tab, gates, settings, classnoteOn, replyMode, today: base.today, importV2: base.load };
  const face = mod ? await mod.loadFace(ctx) : null;
  return {
    viewer: base.viewer, gates, aiOn, tab, today: base.today, editors: await readLessonEditors(base),
    // 부품이 읽는 학원 설정 칸만(모듈 · 보고서 · 운영 — 공급자 OperationsProvider 포함).
    settings: { modules: settings.modules, report: settings.report, operations: settings.operations },
    queue: face?.queue ?? null,
    tabData: face?.tabData ?? (tab === 'queue' ? { rates: null } : {}),
    ...(mod ? {} : { faceMissing: true }),
  };
}

export const screen = {
  id: ID, label: '수업보고서', order: 7,
  params: {
    v2path: SUB, viewer: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    tab: /^[a-z_]{1,20}$/, section: /^[a-z_]{1,20}$/, status: /^[a-z_]{1,20}$/, rmonth: /^\d{4}-\d{2}$/, page: /^\d{1,4}$/,
    // 면 안 부품이 다시 읽는 2.0 서버 함수(GET) — list = listReports(필터 JSON) · cnread = refreshClassnoteQueue(days) · listClassNotices ·
    // listClassWideNotices · promptHistory = getPromptHistory(유형) · testReports = getRecentReportsForTest.
    list: /^\{[\s\S]*\}$/, cnread: /^(queue|notices|classwide|sync)$/, days: /^\d{1,2}$/, promptHistory: /^[a-z0-9_]{1,40}$/, testReports: /^1$/,
    // 통계(/lesson-reports/stats) 열쇠 = v2-lesson-reports-stats.mjs STATS_KEYS.
    grain: /^[a-z]{1,10}$/, month: /^\d{4}-\d{2}$/, from: /^\d{4}-\d{2}-\d{2}$/, to: /^\d{4}-\d{2}-\d{2}$/, span: /^\d{1,3}$/, subject: /^[a-z0-9_]{1,30}$/,
  },
  paramMax: { list: 2000 },
  actions: lessonReportsActions,
  load: async ({ sql, params, tenantId, importV2 }) => {
    const sub = SUB.exec(params.v2path ?? '/lesson-reports');
    if (!sub) return { notFound: true };
    const viewerId = params.viewer ?? null;
    if (sub[1]) {
      const stats = await (await import('./v2-lesson-reports-stats.mjs')).buildReportStats({ sql, tenantId, importV2, params, viewerId });
      // 통계 화면도 저장하는 사람 고르기(기간 보기 기억 saveReportStatsMode)를 싣는다.
      return stats.page === 'stats' ? { ...stats, editors: await readLessonEditors(await studentsBase({ sql, tenantId, importV2, viewerId })) } : stats;
    }
    if (params.list !== undefined) return (await import('./v2-lesson-reports-reads.mjs')).readList({ sql, tenantId, importV2, list: params.list, viewerId });
    if (params.cnread !== undefined) {
      const r = await (await import('./v2-lesson-reports-classnote-reads.mjs')).readClassnote({ sql, tenantId, importV2, viewerId, cnread: params.cnread, days: params.days });
      return r.notFound ? r : { cnread: r.value };
    }
    if (params.promptHistory !== undefined || params.testReports !== undefined) {
      const S = await import('./v2-lesson-reports-settings-reads.mjs'), io = { sql, tenantId, importV2, viewerId };
      return params.promptHistory !== undefined ? S.promptHistory(io, params.promptHistory) : S.recentReportsForTest(io);
    }
    // 2.0 page.tsx 첫 판정: ?tab=video_homework → 영상 제출 현황으로 옮긴다(면 조회 없이 — 호스트가 3.0 그 화면으로 넘긴다).
    if (params.tab === 'video_homework') return { redirect: '/lesson-reports/video-homework' };
    const sp = Object.fromEntries(KEYS.flatMap((k) => (params[k] !== undefined ? [[k, params[k]]] : [])));
    return buildLessonReports({ sql, tenantId, importV2, sp, viewerId });
  },
};
