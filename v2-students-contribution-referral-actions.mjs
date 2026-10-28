// 소개자 검색·연결은 2.0 referral-actions.ts를 Docker 러너에서 그대로 실행한다.
import { runV2Server } from './v2-server-runner.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODULE = 'features/student-contribution/server/referral-actions.ts';
const bad = () => new Error('잘못된 소개 확인 요청');

const action = (name, mode) => ({
  validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.module !== MODULE || !Array.isArray(raw.args)
      || raw.args.length !== 1 || !UUID.test(raw.actor ?? '')) throw bad();
    // 인자 내용의 판정(공백 정리·UUID·길이)은 2.0 함수의 zod 검사에 맡긴다.
    return { actor: raw.actor, args: raw.args };
  },
  async run({ body, tenantId }) {
    const { results: [r] } = await runV2Server({ steps: [{ module: MODULE, fn: name, args: body.args }],
      actorId: body.actor, tenantId, mode });
    return r.value;
  },
});

export const actions = {
  searchReviewedReferrers: action('searchReviewedReferrers', 'read'),
  linkReviewedReferral: action('linkReviewedReferral', 'write'),
};
