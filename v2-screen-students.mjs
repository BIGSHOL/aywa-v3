// 2.0 화면 — 원생목록 · 원생 상세(13탭) · 학생 수정 · 새 학생 (V2-SCREENS.md 대상 `students`, 원장 10-28 *"상·중 화면 모두 2.0 부품 그대로"*).
// 그리기는 2.0의 실제 React 부품이 한다(v2-host/src/students*.tsx). 이 모듈은 2.0 page.tsx가 서버에서 하던 일을 Docker 복사본에서 같은 결과로:
//  · 목록(/students) = v2-students-list.mjs · 상세(/students/<id>) = v2-students-detail.mjs(탭마다 v2-students-tab-<탭>.mjs) ·
//    수정·새 학생(/students/<id>/edit · /students/new) = v2-students-form.mjs. 아직 없는 모듈이면 { missing: true }(호스트가 안내 한 줄).
//  · 3.0엔 로그인이 없다 — 화면 주인 = 원장(v2-students-common.mjs). 계정 보기 설정(users.ui_prefs.students)은 없는 것으로 본다(기본값) —
//    고른 값은 주소에만 남는다(수업목록과 같은 판단).
// 주소 열쇠 = 2.0 목록 page.tsx searchParams + 상세 page.tsx searchParams(이름이 같은 열쇠는 한 칸 — 두 화면의 값 모양을 모두 받는다) + v2path.
import { UUID_BODY, studentsBase, readStudentEditors } from './v2-students-common.mjs';

const ID = 'students';
const TEXT = /^[^\u0000-\u001f]{0,200}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const SUB = new RegExp(`^/students(?:/(new)|/(${UUID_BODY})(/edit)?)?$`);

/** 없는 모듈이면 null(그 모듈 파일만 — 안의 import 실패는 그대로 던진다). */
async function optional(file) {
  try { return await import(`./${file}`); } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(file)) return null;
    throw e;
  }
}

/** 2.0 목록 page.tsx searchParams 열쇠(시험이 2.0 파일과 대조). */
export const LIST_KEYS = Object.freeze(['status', 'subject', 'q', 'page', 'grade', 'teacher', 'field', 'sort', 'noenr', 'program', 'first', 'level', 'mix', 'from']);
/** 2.0 상세 page.tsx searchParams 열쇠(embed는 창 표식이라 받지 않는다). */
export const DETAIL_KEYS = Object.freeze(['contribution', 'month', 'view', 'entity', 'status', 'grade', 'q', 'tab', 'video', 'back', 'jjFrom', 'jjTo', 'page', 'from', 'to',
  'subject', 'kind', 'sort', 'dir', 'fScore', 'fDelta']);

// 저장(2단계) — 머리·폼 저장(v2-students-save-head.mjs)과 탭 안 저장(v2-students-save-tabs.mjs). 모듈이 없으면 그 저장은 아직 없다
// (호스트의 공용 저장 자리가 '아직 지원하지 않는 저장'으로 거절). 각 모듈은 { 2.0 함수 이름: { validate, run } }을 export한다.
const [saveHead, saveTabs, contributionRead, contributionActions] = await Promise.all([optional('v2-students-save-head.mjs'), optional('v2-students-save-tabs.mjs'),
  optional('v2-students-contribution-read.mjs'), optional('v2-students-contribution-actions.mjs')]);
const ACTIONS = { ...(saveHead?.studentsHeadActions ?? {}), ...(saveTabs?.studentsTabActions ?? {}), ...(contributionActions?.actions ?? {}) };

const pick = (params, keys) => Object.fromEntries(keys.flatMap((k) => (params[k] !== undefined ? [[k, params[k]]] : [])));

export const screen = {
  id: ID, label: '원생목록', order: 6,
  params: {
    v2path: SUB, viewer: new RegExp(`^${UUID_BODY}$`), movable: new RegExp(`^${UUID_BODY}$`),
    contributionRead: /^(video|parent|learning|communication|pending|recent)$/, sourceId: /^[a-f0-9]{64}$/,
    period: /^(1|3|6|12)$/, refreshedAt: /^[0-9TZ:.+\-]{0,40}$/, revision: /^\d{1,12}$/,
    // 목록
    status: /^[a-z_]{1,20}$/, subject: /^[a-z0-9_,]{0,200}$/, q: /^[^\u0000-\u001f]{0,200}$/, page: /^\d{1,5}$/, grade: TEXT,
    teacher: new RegExp(`^(all|${UUID_BODY}(?:,${UUID_BODY}){0,60})$`), field: /^[a-z]{1,12}$/, sort: /^[a-zA-Z_]{1,24}$/, noenr: /^[01]$/,
    program: /^[a-z]{1,20}$/, first: DAY, level: /^[a-z,]{0,80}$/, mix: /^[A-Za-z,]{0,120}$/, from: /^(dashboard|\d{4}-\d{2}-\d{2})$/,
    // 상세(탭 · 돌아갈 자리 · 탭 안 조회)
    tab: /^[a-z-]{1,20}$/, back: /^\/(?!\/)[^\u0000-\u001f\\]{0,199}$/, video: new RegExp(`^${UUID_BODY}$`), jjFrom: DAY, jjTo: DAY, to: DAY,
    kind: /^[a-z_]{1,30}$/, dir: /^(asc|desc)$/, fScore: TEXT, fDelta: TEXT, contribution: TEXT, month: /^\d{4}-\d{2}$/, view: /^[a-z_-]{1,20}$/, entity: TEXT,
  },
  // 2.0 원생목록 담임 필터는 다중 선택(uuid 여럿 · 쉼표) — 61명(37자씩)까지.
  paramMax: { teacher: 2300 },
  ...(Object.keys(ACTIONS).length ? { actions: ACTIONS } : {}),
  load: async ({ sql, params, tenantId, importV2 }) => {
    // 수업 탭 배정 창의 '반 이동' 후보 — 2.0 listMovableEnrollments(읽기). 반 화면의 같은 읽기를 그대로 부른다(같은 데이터는 같은 원본).
    if (params.movable) return (await import('./v2-screen-classes.mjs')).screen.load({ sql, params: { movable: params.movable }, tenantId, importV2 });
    const sub = SUB.exec(params.v2path ?? '/students');
    const viewerId = params.viewer ?? null;
    if (!sub) return { notFound: true };
    if (params.contributionRead) {
      if (!sub[2] || sub[3] || !contributionRead) return { notFound: true };
      return contributionRead.read({ sql, tenantId, importV2, viewerId, studentId: sub[2], kind: params.contributionRead,
        month: params.month, sourceId: params.sourceId, period: params.period,
        refreshedAt: params.refreshedAt, revision: params.revision });
    }
    // 저장하는 사람(학생 관리 '전체') — 저장이 있을 때만 싣는다(3.0 띠가 이 목록에서 고른다 · 수업목록과 같은 신호).
    const withEditors = async (data) => (data && !data.notFound && !data.missing && Object.keys(ACTIONS).length
      ? { ...data, editors: await readStudentEditors(await studentsBase({ sql, tenantId, importV2, viewerId })) } : data);
    if (!sub[1] && !sub[2]) {
      const list = await optional('v2-students-list.mjs');
      return withEditors(list ? await list.buildStudentList({ sql, tenantId, importV2, sp: pick(params, LIST_KEYS), viewerId }) : { missing: true });
    }
    if (sub[1] || sub[3]) {
      const form = await optional('v2-students-form.mjs');
      if (!form) return { missing: true };
      return withEditors(sub[1] ? await form.buildStudentNew({ sql, tenantId, importV2, viewerId }) : await form.buildStudentEdit({ sql, tenantId, importV2, id: sub[2], viewerId }));
    }
    const { buildStudentDetail } = await import('./v2-students-detail.mjs');
    return withEditors(await buildStudentDetail({ sql, tenantId, id: sub[2], sp: pick(params, DETAIL_KEYS), importV2, viewerId }));
  },
};
