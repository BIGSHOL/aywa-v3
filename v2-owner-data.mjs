// 학원 설정 데이터 정리: 세 조회와 다섯 저장을 2.0 원본 서버 함수로 Docker 복사본에서 실행한다.
import { V2Error } from './v2-screens.mjs';
import { UUID } from './v2-mcs-core.mjs';
import { serverCall } from './v2-proc-people.mjs';
import { readV2, runV2Server, V2ServerError } from './v2-server-runner.mjs';

const ADMIN_QUERIES = 'features/admin/server/queries.ts';
const ADMIN_ACTIONS = 'features/admin/server/actions.ts';
const STUDENT_ACTIONS = 'features/students/server/actions.ts';
const FORM_ACTIONS = ['mergeStudents', 'closeOrphanEnrollments', 'bulkWithdrawStudents', 'bulkDeleteStudents'];
const MAX_ARGS = 128 * 1024;

export async function loadOwnerData(actorId, tenantId, canManage, canConfirm) {
  const names = ['findOrphans', 'findDuplicateStudents', 'findSameNameStudents'];
  // 공용 실행기의 연결 풀은 최대 3개다. 세 함수를 동시에 열면 각 트랜잭션이
  // 메타 조회용 네 번째 연결을 기다리므로 순서대로 읽는다(실패는 구획별로 접는다).
  const settled = [];
  for (const fn of names) {
    try { settled.push({ status: 'fulfilled', value: await readV2(ADMIN_QUERIES, fn, [], { actorId, tenantId }) }); }
    catch (reason) { settled.push({ status: 'rejected', reason }); }
  }
  const value = i => settled[i].status === 'fulfilled' ? settled[i].value.value : null;
  return {
    report: value(0), review: value(1) ?? { groups: [], loneSuspects: [] }, groups: value(2) ?? [],
    canManage, canConfirm, duplicateFailed: settled[1].status === 'rejected', sameNameFailed: settled[2].status === 'rejected',
  };
}

function invalid() { return new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.'); }
const form = v => !!v && typeof v === 'object' && Array.isArray(v.$formData)
  && v.$formData.every(e => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string');

export function ownerDataActions(ownerIo) {
  const actions = {};
  for (const name of [...FORM_ACTIONS, 'clearDupSuspect']) {
    const module = name === 'clearDupSuspect' ? STUDENT_ACTIONS : ADMIN_ACTIONS;
    actions[name] = {
      validate: raw => {
        const body = serverCall(raw, [module], name === 'clearDupSuspect' ? 1 : 2);
        if (name === 'clearDupSuspect') {
          if (body.args.length !== 1 || typeof body.args[0] !== 'string' || !UUID.test(body.args[0])) throw invalid();
        } else if (body.args.length !== 2 || !form(body.args[1])) throw invalid();
        if (JSON.stringify(body.args).length > MAX_ARGS) throw invalid();
        return body;
      },
      run: async ({ sql, body, tenantId, importV2 }) => {
        const io = await ownerIo(sql, tenantId, importV2);
        const actorId = io.viewers.some(v => v.id === body.actor) ? body.actor : null;
        try {
          const { results: [result] } = await runV2Server({
            steps: [{ module, fn: name, args: body.args }], actorId, tenantId, mode: 'write',
          }, { timeoutMs: 280_000 });
          return result.value ?? null;
        } catch (error) {
          if (error instanceof V2ServerError) throw new V2Error(409, 'data_cleanup_failed', '정리 작업을 완료하지 못했습니다. 목록을 새로고침한 뒤 확인해 주세요.');
          throw error;
        }
      },
    };
  }
  return actions;
}
