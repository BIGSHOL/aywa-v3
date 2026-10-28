// 2.0 화면 — 회의록(목록 · 상세 · 새 회의록) (V2-SCREENS.md `meetings`, 팀장 세션 L · 작업자 v2-meetings).
// 그리기는 2.0의 실제 React 부품(v2-host/src/meetings.tsx). 이 모듈은 2.0 서버가 하던 일을 Docker 복사본에서 **2.0 서버 함수 그대로** 한다 —
// 공용 러너(v2-server-runner.mjs: 작업 스레드 · Supabase 흉내 · 보는 사람 신분 + authenticated · RLS가 2.0처럼).
//  · 목록 = features/meetings/server/queries.ts getMeetingsPage({ range, status, q, page, pageSize: 50 }) — 2.0 page.tsx가 받던 결과 그대로.
//  · 상세 = getMeetingById(id) + getStaffOptions()(전사가 있을 때만 쓴다 — 2.0과 같다) · 없는 회의록 = 2.0 notFound 자리('missing').
//  · 새 회의록 = 보는 사람(2.0 requireAccess('meetings')가 돌려주던 viewer의 id · tenantId).
//  · 보는·저장하는 사람 = 3.0 띠에서 고른 직원(GET ?actor=) — 회의록 메뉴가 열린 재직 직원(2.0 권한 표 · v2-proc-people.mjs).
//    쓰기 권한(canWriteTenant)은 2.0 저장 함수가 그 사람으로 다시 본다.
//
// 2.0 서버 함수 대응표(호스트가 부르는 이름 = actions 이름 · 모듈 features/meetings/server/actions.ts)
//  | 2.0 함수                                   | 여기                                                                      |
//  | updateMeetingTitle(_prev, FormData)        | actions.updateMeetingTitle — 러너 write(2.0 함수 그대로 · createClient = 고른 사람 신분) |
//  | updateMeetingNotepad(_prev, FormData)      | actions.updateMeetingNotepad — 〃                                          |
//  | updateMeetingReportSection(_prev, FormData)| actions.updateMeetingReportSection — 〃(AI 분석 문서 섹션 글 고치기 · AI 호출 없음) |
//  | updateMeetingSpeakers(_prev, FormData)     | actions.updateMeetingSpeakers — 〃(화자 이름 · 직원 연결)                 |
//  | createTextMeeting(_prev, FormData)         | actions.createTextMeeting — 〃(메모만으로 회의록 · 2.0은 관리자 클라이언트 = 복사본 접속) |
//  | deleteMeeting(_prev, FormData)             | actions.deleteMeeting — 〃 · 2.0 redirect → { redirectTo }(호스트가 이동)   |
//  | regenerateMeetingAnalysis(기둥 A) · retryMeetingProcessing(기둥 B) · startMeetingFromAudio · issueAudioUploadTicket(media) | 호스트가 보내지 않고 { error: 지원하지 않는 기능 }(AI·전사·업로드 0) |
//
// 2.0과 다른 것
//  · 녹음 파일 저장소가 없다 — 오디오 재생·인쇄 미리보기(/meetings/<id>/print)는 연습 화면에서 열지 않는다(호스트가 '열 수 없음').
//  · deleteMeeting의 녹음 파일 지우기(removeObject)는 2.0도 실패를 삼킨다 — 러너는 바깥 요청을 막으므로 파일 쪽은 아무 일도 없고,
//    감사로그 audioRemoved는 2.0 판정(그 지점 경로인가) 그대로 적힌다.
//  · 주소 range·status는 2.0이 아는 값만 받는다(2.0은 모르는 값을 '전체'처럼 넘긴다 — 여기선 400).
//
// 호스트에 붙일 때(의존)
//  · Next 전용: next/link(BackLink) · next/navigation(useRouter — FilterSelect · SearchToggle · Pagination · status-watcher · new-meeting-form) ·
//    next/image(PhotoCard) — shim 있음. 서버 컴포넌트는 page.tsx 셋뿐(조립을 호스트로 옮겼다).
//  · 서버 액션 모듈: features/meetings/server/actions.ts · features/media/server/upload-actions.ts(issueAudioUploadTicket).
//  · 브라우저 Supabase(status-watcher 실시간 구독 · features/presence '수정 중') = shim(아무것도 받지 않음). status-watcher의 5초 새로고침은
//    처리 중(전사·분석) 상태에서만 돈다 — 복사본엔 그 상태가 없다(AI·전사를 부르지 않으므로 생기지도 않는다).
import { V2Error } from './v2-screens.mjs';
import { UUID, deepMerge, readPeople, serverCall } from './v2-proc-people.mjs';
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';

const ID = 'meetings', MENU = 'meetings', ACTIONS = 'features/meetings/server/actions.ts', QUERIES = 'features/meetings/server/queries.ts';
const UUID_BODY = UUID.source.slice(1, -1);
const DETAIL = new RegExp(`^/meetings/(${UUID_BODY})$`, 'i');
/** 2.0 page.tsx PAGE_SIZE. */
export const PAGE_SIZE = 50;
/** 2.0 (shell)/layout.tsx가 OperationsProvider에 넘기는 라이선스 중 이 화면 부품이 읽는 것(useLicenseOn). */
const LICENSES = ['ai_analysis', 'meeting_recording'];
const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');

let licenseRule = null;
const modulesOf = (settings) => { const m = deepMerge(settings.base.modules ?? { disabled: [] }, settings.stored?.modules); return { disabled: Array.isArray(m?.disabled) ? m.disabled : [] }; };

/** 2.0 licenseAllows — 행이 없으면 허용 · 표를 못 읽으면 허용(2.0 fail-open). */
async function licensesOf(sql, t, importV2) {
  licenseRule ??= importV2('lib/license/rule.ts').catch((e) => { licenseRule = null; throw e; });
  const R = await licenseRule;
  const rows = await sql.savepoint((s) => s`select feature, is_active, to_json(expires_at)#>>'{}' expires_at from public.tenant_licenses
    where tenant_id = ${t} and feature = any(${LICENSES})`).catch(() => []);
  const now = new Date();
  return Object.fromEntries(rows.map((r) => [r.feature, R.licenseAllows({ is_active: r.is_active, expires_at: r.expires_at }, now)]));
}

const readCall = (t, actorId, steps) => runV2Server({ steps, actorId, tenantId: t, mode: 'read' }).catch(() => {
  throw new V2Error(500, 'load_failed', '회의록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
});

async function load({ sql, params, tenantId: t, importV2 }) {
  const [people, licenses] = await Promise.all([readPeople(sql, t, importV2, MENU), licensesOf(sql, t, importV2)]);
  const settings = people.settings;
  const base = { editors: people.editorList, operations: settings.operations, modules: modulesOf(settings), licenses };
  // 2.0 requireAccess('meetings') — 회의록을 열 수 있는 사람이 없으면 화면이 없다.
  const v = people.pick(params.actor);
  if (!v) return { ...base, page: 'noMenu' };
  const path = params.v2path ?? '/meetings';
  // 새 회의록(2.0 new/page.tsx) — 녹음 소유자(recordingOwner) = 보는 사람.
  if (path === '/meetings/new') return { ...base, page: 'new', viewer: { id: v.id, tenantId: t } };
  const detail = DETAIL.exec(path);
  if (detail) {
    const id = detail[1].toLowerCase();
    const { results: [m, staff] } = await readCall(t, v.id, [{ module: QUERIES, fn: 'getMeetingById', args: [id] }, { module: QUERIES, fn: 'getStaffOptions', args: [] }]);
    const meeting = m.value ?? null;
    if (!meeting) return { ...base, page: 'missing' };
    // 2.0: `meeting.transcription ? await getStaffOptions() : []`.
    return { ...base, page: 'detail', meeting, staffOptions: meeting.transcription ? staff.value : [] };
  }
  if (path !== '/meetings') return { ...base, page: 'notFound' };
  // 2.0 page.tsx: range·status 기본 'all' · q 기본 '' · page = max(1, Number(sp.page) || 1).
  const page = Math.max(1, Number(params.page) || 1);
  const { results: [r] } = await readCall(t, v.id, [{ module: QUERIES, fn: 'getMeetingsPage',
    args: [{ range: params.range ?? 'all', status: params.status ?? 'all', q: params.q ?? '', page, pageSize: PAGE_SIZE }] }]);
  return { ...base, page: 'list', result: r.value };
}

// ── 저장 = 2.0 서버 함수 그대로(러너 write — 동작 하나 = 복사본 트랜잭션 하나 · 바깥 요청이 남으면 되돌림) ────────────────────
export const WRITES = ['updateMeetingTitle', 'updateMeetingNotepad', 'updateMeetingReportSection', 'updateMeetingSpeakers', 'createTextMeeting', 'deleteMeeting'];
const ARG_LIMIT = 512 * 1024;
const refused = (e) => (e instanceof V2ServerError
  ? e.code === 'outbound_blocked' ? new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.')
    : e.code === 'unsupported' ? new V2Error(409, 'not_supported', '연습 화면에서는 아직 지원하지 않는 저장입니다.')
      : new V2Error(500, 'write_failed', '저장하지 못했습니다. 바뀐 것은 없습니다.')
  : e);
const isForm = (v) => !!v && typeof v === 'object' && Array.isArray(v.$formData) && v.$formData.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string');

/**
 * 쓰기 한 번 = 러너 write 한 번(복사본 트랜잭션 하나). test = 시험 전용 러너 선택(rollback · probes · allowRefs) — 화면 저장 경로(run)는 넘기지 않는다.
 * actorId = 회의록을 열 수 있는 직원이 아니면 null(2.0 '로그인이 필요합니다' 자리).
 */
export async function runWrite(t, actorId, steps, test = {}) {
  try { return await runV2Server({ steps, actorId, tenantId: t, mode: 'write', ...test }); } catch (e) { throw refused(e); }
}

/** 2.0 함수 하나 = actions 한 줄 — 인자 = (_prev, FormData) 둘. */
const write = (name) => ({
  validate: (raw) => {
    const body = serverCall(raw, [ACTIONS], 2);
    if (body.args.length !== 2 || !isForm(body.args[1]) || JSON.stringify(body.args).length > ARG_LIMIT) throw bad();
    return { actor: body.actor, args: [null, body.args[1]] };
  },
  run: async ({ sql, body, tenantId: t, importV2 }) => {
    const people = await readPeople(sql, t, importV2, MENU);
    const actorId = body.actor && people.editors.some((e) => e.id === body.actor) ? body.actor : null;
    const { results: [r] } = await runWrite(t, actorId, [{ module: ACTIONS, fn: name, args: body.args }]);
    // deleteMeeting 성공 = 2.0 redirect(redirectTo) — 호스트가 그 주소로 옮긴다.
    if (r.redirect) return { redirectTo: r.redirect };
    return r.value ?? null;
  },
});

export const screen = {
  id: ID, label: '회의록', order: 45,
  params: {
    actor: UUID, v2path: new RegExp(`^/meetings(?:/new|/${UUID_BODY})?$`, 'i'),
    range: /^(?:all|7d|30d|month)$/, status: /^(?:all|completed|processing|failed|idle)$/, q: /^[\s\S]{0,100}$/, page: /^\d{1,5}$/, form: /^[A-Za-z0-9_-]{1,64}$/,
  },
  actions: Object.fromEntries(WRITES.map((name) => [name, write(name)])),
  load,
};
