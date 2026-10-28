// 2.0 화면 · 수업보고서 관리 — 저장(1차: 바깥으로 안 나가는 저장). 2.0 서버 함수를 그대로 돈다(공용 러너 write —
// v2-server-runner.mjs: 동작 하나 = 복사본 트랜잭션 하나 · 신분 = 고른 사람 + authenticated · 감사로그 = 2.0 표 그대로 + via '3.0 연습 복사본' ·
// fetch 차단 · net.http_request_queue가 늘면 통째로 되돌림). 2.0 함수 이름 = actions 이름(호스트 shim이 그 이름으로 POST) · 인자 · 반환은 2.0 그대로.
//  1차(DB 행만 바뀐다):
//   · features/report-admin/server/recall-actions.ts requestReportRecall · requestReportRecallByShareToken — 행을 recall_requested · revoked_at으로.
//     ClassNote 게시글의 실제 삭제는 연동 PC 워커 몫이라 복사본에는 일어나지 않는다(요청 상태로 남는다).
//   · features/report-admin/server/actions.ts resetStuckClassnote — 멈춘(processing) 행을 queued(또는 보낼 반이 없으면 failed)로.
//   · features/report-admin/server/board-roster-actions.ts linkClassnoteChild · unlinkClassnoteChild — 반 구성 원아 연결 행(ClassNote 호출 없음).
//   · features/onescreen/server/prompt-actions.ts savePrompt · resetPrompt — ai_prompt_overrides(AI 호출 없음 · testPrompt는 계속 거절).
//   · features/lesson-reports/stats/prefs-actions.ts saveReportStatsMode — 고른 사람의 ui_prefs.reportStats.
//   · 보고서 설정 saveOwnerSection — 학원 설정 화면의 저장(v2-screen-owner.mjs actions · 같은 판정 · #142 섹션 머지)을 그대로, 'report' 섹션만.
//  계속 거절(진입점이 그 자리에서 2.0 거절 모양): 발송 요청(sendClassnoteForUnsent · retryClassnote — 메인 결정 A = 러너로 Docker queued + 안내 문구 · 아직 안 함, 인계서 handoff-O-1028) · 직접 발송(saveAdminReport · saveAndQueueAdminReport · sendBulkAdminReports — 읽기 자리가 아직이라 면이 서지 않는다) ·
//     공지 보내기·고치기·취소·회수 · 반 단체 공지 · 동기화 요청 · 답글 · 공감 · AI 미리보기.
// · 저장하는 사람 = readLessonEditors(보고서 관리 · 보고서 설정 · AI 멘트 중 하나라도 쓰기인 재직 직원 · 운영자 계정 제외 · 원장 먼저). 그 밖이면
//   2.0 '로그인 없음' 자리(actor = null). 각 2.0 함수가 그 사람의 권한을 다시 본다.
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { V2Error } from './v2-screens.mjs';
import { studentsBase } from './v2-students-common.mjs';
import { screen as ownerScreen } from './v2-screen-owner.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ARG_LIMIT = 200 * 1024;

export const LR_WRITES = {
  'features/report-admin/server/recall-actions.ts': ['requestReportRecall', 'requestReportRecallByShareToken'],
  'features/report-admin/server/actions.ts': ['resetStuckClassnote'],
  'features/report-admin/server/board-roster-actions.ts': ['linkClassnoteChild', 'unlinkClassnoteChild'],
  'features/onescreen/server/prompt-actions.ts': ['savePrompt', 'resetPrompt'],
  'features/lesson-reports/stats/prefs-actions.ts': ['saveReportStatsMode'],
};

const RANK = ['master', 'admin', 'manager', 'counselor'];
const WRITE_MENUS = ['lesson_reports', 'report_settings', 'ai_ment'];
/** 이 화면에서 저장할 수 있는 사람 — 학원 설정의 역할 재정의 + 개인 예외(2.0 권한표와 같은 함수) · 운영자 계정 제외 · 원장 먼저. */
export async function readLessonEditors(base) {
  const { sql, t, RR, X, settings } = base;
  const [users, supers] = await Promise.all([
    sql`select id::text id, display_name, system_role::text role from public.users where tenant_id=${t} and status::text='active' and display_name is not null`,
    sql`select id::text id from public.super_admins`]);
  const operators = new Set(supers.map((s) => s.id));
  const matrix = RR.resolveMatrix(settings.permissions.overrides ?? []), userOverrides = settings.permissions.userOverrides ?? [];
  const level = (u, menu) => RR.accessLevel(u.role, menu, RR.applyUserOverrides(matrix, u.id, u.role, userOverrides));
  return users.filter((u) => !operators.has(u.id) && WRITE_MENUS.some((m) => ['full', 'scoped'].includes(level(u, m))))
    .map((u) => ({ id: u.id, name: u.display_name, role: X.roles.ROLE_LABEL[u.role] ?? '', rank: RANK.includes(u.role) ? RANK.indexOf(u.role) : RANK.length }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ko'))
    .map(({ rank, ...u }) => u);
}

const refused = (e) => (e instanceof V2ServerError
  ? e.code === 'outbound_blocked' ? new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.')
    : e.code === 'unsupported' ? new V2Error(409, 'not_supported', '연습 화면에서는 아직 지원하지 않는 저장입니다.')
      : new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.')
  : e);

/** 고른 사람이 저장할 수 있는 사람 목록 안이면 그 id, 아니면 null(2.0 getCurrentUser = null 자리). */
async function actorId(sql, t, importV2, actor) {
  if (!actor) return null;
  const base = await studentsBase({ sql, tenantId: t, importV2 });
  return (await readLessonEditors(base)).some((e) => e.id === actor) ? actor : null;
}

const runnerActions = Object.fromEntries(Object.entries(LR_WRITES).flatMap(([module, names]) => names.map((name) => [name, {
  validate: (raw) => {
    if (!plain(raw) || raw.module !== module || !Array.isArray(raw.args) || raw.args.length > 4) throw bad();
    if (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor))) throw bad();
    if (JSON.stringify(raw.args).length > ARG_LIMIT) throw bad();
    return { actor: raw.actor ?? null, args: raw.args };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    try {
      const { results: [r] } = await runV2Server({ steps: [{ module, fn: name, args: body.args }], actorId: await actorId(sql, t, importV2, body.actor), tenantId: t, mode: 'write' });
      return r.value ?? null;
    } catch (e) { throw refused(e); }
  },
}])));

/** 보고서 설정 면의 저장 = 학원 설정 화면 저장 그대로 — 이 화면에서는 'report' 섹션만 받는다(다른 섹션은 그 화면에서). */
const owner = ownerScreen.actions.saveOwnerSection;
const sectionOf = (raw) => (raw.args?.[1]?.$formData ?? []).find((p) => Array.isArray(p) && p[0] === 'section')?.[1] ?? null;
const ownerReportOnly = {
  saveOwnerSection: {
    validate: (raw) => {
      const body = owner.validate(raw);
      if (sectionOf(raw) !== 'report') throw new V2Error(400, 'invalid_request', '이 화면에서는 보고서 설정만 저장합니다.');
      return body;
    },
    run: (ctx) => owner.run(ctx),
  },
};

export const lessonReportsActions = { ...runnerActions, ...ownerReportOnly };
