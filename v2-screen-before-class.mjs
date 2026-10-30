// 비포클래스체크리스트 — 2.0 조회·저장 함수를 Docker 복사본에서 실행하고 실제 React 부품을 호스트에 싣는다.
import { V2Error } from './v2-screens.mjs';
import { readPeople, serverCall } from './v2-proc-people.mjs';
import { copyClock } from './v2-onescreen-roster.mjs';
import { runV2Server } from './v2-server-runner.mjs';

const ID = 'before-class', MENU = 'before_class_checklist';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE = /^(?:\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])|first|last)$/;
const QUERY = 'features/before-class/server/queries.ts';
const STATS = 'features/before-class/server/stats-actions.ts';
const ACTION = 'features/before-class/server/actions.ts';

async function call(module, fn, args, tenantId, actorId, mode) {
  const { results: [result] } = await runV2Server({ tenantId, actorId, mode, steps: [{ module, fn, args }] });
  return result.value;
}

export const screen = {
  id: ID, label: '비포클래스체크리스트', order: 4,
  params: { actor: UUID, class: UUID, month: MONTH, date: DATE, read: /^history$/, student: UUID },
  async load({ sql, params, tenantId: t, importV2 }) {
    const people = await readPeople(sql, t, importV2, MENU);
    const user = people.editors.find(e => e.id === params.actor);
    const base = { editors: people.editorList, viewer: user ? { id: user.id, name: user.display_name } : null,
      canEdit: !!user && people.level(user, MENU) === 'full' };
    if (!user) return { ...base, notAllowed: true };
    if (params.read === 'history') {
      if (!params.class || !params.student) throw new V2Error(400, 'invalid_request', '반과 원생을 확인해 주세요.');
      return call(STATS, 'getBeforeClassStudentHistory', [{ classId: params.class, studentId: params.student }], t, user.id, 'read');
    }
    const clock = await copyClock(), month = params.month ?? clock.day.slice(0, 7);
    const { ready, targets } = await call(QUERY, 'loadTargets', [t], t, user.id, 'read');
    const current = targets.find(x => x.id === params.class) ?? targets[0] ?? null;
    const data = ready && current ? await call(QUERY, 'loadClassMonth', [t, current.id, month], t, user.id, 'read') : null;
    const [dayRules, settingsRow] = await Promise.all([
      importV2('features/before-class/dates.ts'),
      sql`select data->'profile'->>'name' academy_name from public.tenant_settings where tenant_id=${t}`,
    ]);
    return { ...base, ready, targets, current, data, month, today: clock.day,
      initialDate: data ? dayRules.pickCheckDate(data.dates, clock.day, params.date) : null,
      academyName: settingsRow[0]?.academy_name || '학원', logoSrc: null };
  },
  actions: {
    saveBeforeClassCheck: {
      validate: raw => serverCall(raw, [ACTION], 1),
      async run({ body, tenantId: t }) {
        if (!UUID.test(body.actor ?? '')) throw new V2Error(403, 'actor_required', '현재 계정을 확인해 주세요.');
        return call(ACTION, 'saveBeforeClassCheck', body.args, t, body.actor, 'write');
      },
    },
  },
};
