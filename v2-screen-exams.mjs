// 2.0 통합 성적관리(/exams): 원본 서버 함수와 원본 화면 부품을 Docker 복사본에.
import { studentsBase, UUID_BODY } from './v2-students-common.mjs';
import { readExams } from './v2-exams-data.mjs';
import { readExamsInput, readExamsView } from './v2-exams-legacy.mjs';
import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { V2Error } from './v2-screens.mjs';

const UUID = new RegExp(`^${UUID_BODY}$`);
const bad = () => new V2Error(400, 'invalid_request', '성적 입력을 확인해 주세요.');
const denied = () => new V2Error(403, 'forbidden', '성적을 변경할 권한이 없습니다.');
const modules = {
  saveUnifiedGrade: 'features/grades/unified/server/actions.ts',
  createUnifiedGrade: 'features/grades/unified/server/create-action.ts',
  saveGradeScores: 'features/grades/server/actions.ts',
};
const SORT_MODULE = 'features/grades/server/list-prefs.ts';
const action = (name, module) => ({
  validate: raw => {
    if (!raw || raw.module !== module || !UUID.test(raw.actor ?? '') || !Array.isArray(raw.args) || raw.args.length !== 2 ||
      !raw.args[1] || !Array.isArray(raw.args[1].$formData) || raw.args[1].$formData.length > 100 ||
      JSON.stringify(raw.args).length > 100_000 || raw.args[1].$formData.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
        typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || pair[0].length > 80 || pair[1].length > 20_000)) throw bad();
    return { actor: raw.actor, args: [null, raw.args[1]] };
  },
  run: async ({ sql, body, tenantId, importV2 }) => {
    const base = await studentsBase({ sql, tenantId, importV2, viewerId: body.actor });
    if (base.viewer?.id !== body.actor || base.level('exams') === 'none') throw denied();
    try {
      const { results: [r] } = await runV2Server({ tenantId, actorId: body.actor, mode: 'write',
        steps: [{ module, fn: name, args: body.args }] });
      return r.value ?? null;
    } catch (e) {
      if (e instanceof V2ServerError && e.code === 'outbound_blocked')
        throw new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.');
      if (e instanceof V2ServerError && e.code === 'unsupported')
        throw new V2Error(409, 'not_supported', '연습 자료에서는 아직 지원하지 않는 저장입니다.');
      throw e;
    }
  },
});
export const EXAMS_KEYS = Object.freeze(['from', 'to', 'subject', 'kind', 'missing', 'student', 'cohortClass', 'schoolGroup', 'gradeGroup',
  'page', 'tab', 'q', 'month', 'level', 'tlevel', 'sort', 'dir', 'fSchool', 'fClass', 'fTeacher', 'fKind', 'fInfo', 'fScore', 'fDelta', 'fConsult',
  'entry', 'entryYear', 'entryTerm', 'entrySubject', 'entrySlot', 'entryClass', 'entryDate', 'entryMax',
  'year', 'term', 'class', 'slot', 'date', 'max', 'view', 'type', 'jjClass']);
const TEXT = /^[^\u0000-\u001f]{0,200}$/;
export const screen = {
  id: 'exams', label: '성적관리', order: 7,
  params: {
    ...Object.fromEntries(EXAMS_KEYS.map(k => [k, TEXT])),
    viewer: UUID, roster: /^[01]$/, args: TEXT, v2path: /^\/exams(?:\/(?:input|view|jj(?:\/[A-Za-z0-9-]{1,160}){0,4}))?$/,
  },
  paramMax: { args: 2000 },
  actions: {
    ...Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, action(name, module)])),
    saveGradeSortPref: {
      validate: raw => {
        if (!raw || raw.module !== SORT_MODULE || !UUID.test(raw.actor ?? '') || !Array.isArray(raw.args) || raw.args.length !== 1 ||
          !raw.args[0] || typeof raw.args[0] !== 'object' || JSON.stringify(raw.args[0]).length > 300) throw bad();
        return { actor: raw.actor, args: raw.args };
      },
      run: async ({ sql, body, tenantId, importV2 }) => {
        const base = await studentsBase({ sql, tenantId, importV2, viewerId: body.actor });
        if (base.viewer?.id !== body.actor || base.level('exams') === 'none') throw denied();
        const { results: [r] } = await runV2Server({ tenantId, actorId: body.actor, mode: 'write',
          steps: [{ module: SORT_MODULE, fn: 'saveGradeSortPref', args: body.args }] });
        return r.value;
      },
    },
  },
  load: async ({ sql, params, tenantId, importV2 }) => {
    const base = await studentsBase({ sql, tenantId, importV2, viewerId: params.viewer });
    if (!base.viewer || base.level('exams') === 'none') return { notFound: true };
    // JJ실의 수치는 Docker에 없고 2.0은 인재원 API에 매번 묻는다. 이 이식의 바깥 요청 0 조건에서 부르지 않는다.
    if (params.v2path?.startsWith('/exams/jj') || ['jj', 'jj_exam'].includes(params.view) || params.type === 'jj')
      return { route: 'external-unavailable', message: '인재원 실시간 성적은 연습 자료에서 열 수 없습니다.' };
    if (params.roster === '1') {
      let args;
      try { args = JSON.parse(params.args ?? '[]'); } catch { throw bad(); }
      if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'object' || args[0] === null) throw bad();
      const { results: [r] } = await runV2Server({ tenantId, actorId: base.viewer.id, mode: 'read',
        steps: [{ module: 'features/grades/unified/server/entry-actions.ts', fn: 'loadSchoolRoster', args }] });
      return { value: r.value };
    }
    const legacy = params.year || params.term || params.class || params.slot || params.date || params.max || params.view === 'input';
    const route = params.v2path === '/exams/view' ? 'view' : params.v2path === '/exams/input' || legacy ? 'input' : 'dashboard';
    if (route === 'input') return { route, loaded: await readExamsInput({ tenantId, actorId: base.viewer.id, params, importV2 }),
      editors: [{ id: base.viewer.id, name: base.viewer.name, role: base.viewer.systemRole }] };
    if (route === 'view') return { route, loaded: await readExamsView({ tenantId, actorId: base.viewer.id, params, importV2 }),
      editors: [{ id: base.viewer.id, name: base.viewer.name, role: base.viewer.systemRole }] };
    const loaded = await readExams({ tenantId, actorId: base.viewer.id, params, importV2 });
    return { route, loaded, editors: [{ id: base.viewer.id, name: base.viewer.name, role: base.viewer.systemRole }] };
  },
};
