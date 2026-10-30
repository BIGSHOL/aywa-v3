// 과정 확정·정원은 3.0 연습 설정으로만 저장한다. 2.0 반 원본 칸과 원본 DB는 건드리지 않는다.
import { V2Error } from './v2-screens.mjs';
import { actAs, audit } from './v2-timetable-save.mjs';
import { COURSE_KEYS } from './v2-classes-overview.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROGRAMS = ['eie', 'injaewon', 'math'];
const invalid = () => new V2Error(400, 'invalid_request', '설정 값을 확인해 주세요.');
const denied = () => new V2Error(403, 'forbidden', '이 설정을 저장할 수 없습니다.');
const capacityOf = value => value === null || value === '' ? null : Number(value);

export function overviewSettingsAction(loadRules, loadExtra) {
  return {
    validate(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !UUID.test(raw.actor)) throw invalid();
      const capacity = capacityOf(raw.capacity);
      if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100)) throw invalid();
      if (raw.type === 'class' && UUID.test(raw.classId) && COURSE_KEYS.includes(raw.course))
        return { type: 'class', actor: raw.actor, classId: raw.classId, course: raw.course, capacity };
      if (raw.type === 'default' && PROGRAMS.includes(raw.program) && COURSE_KEYS.includes(raw.course) && raw.course !== 'unclassified')
        return { type: 'default', actor: raw.actor, program: raw.program, course: raw.course, capacity };
      throw invalid();
    },
    async run({ sql, body, tenantId, importV2 }) {
      const [R, X] = await Promise.all([loadRules(importV2), loadExtra(importV2)]);
      const actor = await actAs(sql, tenantId, R, X, body.actor);
      if (!actor) throw denied();
      const [user] = await sql`select system_role::text role from public.users where tenant_id=${tenantId} and id=${actor.id}`;
      if (user?.role !== 'master') throw denied();
      let label = body.type === 'class' ? null : `${body.program}:${body.course}`;
      if (body.type === 'class') {
        const [cls] = await sql`select class_name from public.classes where tenant_id=${tenantId} and id=${body.classId}::uuid and is_active and closed_at is null`;
        if (!cls) throw invalid();
        label = cls.class_name;
      }
      const [row] = await sql`select data from public.tenant_settings where tenant_id=${tenantId} for update`;
      if (!row) throw invalid();
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      const old = data.ownerConceptClassOverview ?? {};
      const config = { ...old, classCourse: { ...old.classCourse }, classCapacity: { ...old.classCapacity }, courseCapacity: { ...old.courseCapacity } };
      if (body.type === 'class') {
        config.classCourse[body.classId] = body.course;
        if (body.capacity === null) delete config.classCapacity[body.classId];
        else config.classCapacity[body.classId] = body.capacity;
      } else {
        const key = `${body.program}:${body.course}`;
        if (body.capacity === null) delete config.courseCapacity[key];
        else config.courseCapacity[key] = body.capacity;
      }
      await sql`update public.tenant_settings set data=${sql.json({ ...data, ownerConceptClassOverview: config })} where tenant_id=${tenantId}`;
      await audit(sql, tenantId, actor, 'owner_class_overview_settings_update', body.type === 'class' ? 'class' : 'tenant_settings',
        { type: body.type, classId: body.classId ?? null, program: body.program ?? null, course: body.course, capacity: body.capacity }, label);
      return { ok: true };
    },
  };
}
