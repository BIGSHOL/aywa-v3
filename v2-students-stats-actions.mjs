import { runV2Server, V2ServerError } from './v2-server-runner.mjs';
import { studentsBase } from './v2-students-common.mjs';
import { V2Error } from './v2-screens.mjs';

const MODULE = 'features/students/stats/server/prefs-actions.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const statsActions = {
  saveStudentStatsPrefs: {
    validate: raw => {
      if (!raw || raw.module !== MODULE || !UUID.test(raw.actor ?? '') || !Array.isArray(raw.args) || raw.args.length !== 1 ||
        !raw.args[0] || typeof raw.args[0] !== 'object' || Array.isArray(raw.args[0]) || JSON.stringify(raw.args[0]).length > 2000)
        throw new V2Error(400, 'invalid_request', '보기 설정을 확인해 주세요.');
      return { actor: raw.actor, args: raw.args };
    },
    run: async ({ sql, body, tenantId, importV2 }) => {
      const base = await studentsBase({ sql, tenantId, importV2, viewerId: body.actor });
      if (base.viewer?.id !== body.actor || base.level('students') === 'none')
        throw new V2Error(403, 'forbidden', '보기 설정을 저장할 권한이 없습니다.');
      try {
        const { results: [r] } = await runV2Server({ tenantId, actorId: body.actor, mode: 'write',
          steps: [{ module: MODULE, fn: 'saveStudentStatsPrefs', args: body.args }] });
        return r.value;
      } catch (e) {
        if (e instanceof V2ServerError && e.code === 'outbound_blocked')
          throw new V2Error(409, 'outbound_blocked', '이 저장이 바깥으로 요청을 보내려 해서 되돌렸습니다. 바뀐 것은 없습니다.');
        throw e;
      }
    },
  },
};
