// 직원관리 하위 화면(작업자 B) 공용 — 연차 관리·이력서가 함께 쓰는 판정·FormData 읽기·2.0 세션 신분.
import { V2Error } from './v2-screens.mjs';

export const STAFF_SCOPE_DENIED_MSG = '담당 과목 밖의 직원은 볼 수 없습니다';

/** 2.0 canSeeStaffMember — 본인이거나 과목 범위가 없거나 범위 안 과목의 직원. 대상을 못 찾으면 false. */
export async function canSeeStaffMember(sql, t, people, viewer, targetId, knownSubjects) {
  if (targetId === viewer.id) return true;
  const scope = people.staffScope(viewer);
  if (!scope) return true;
  if (knownSubjects !== undefined) return people.P.scope.isStaffInSubjectScope(scope, knownSubjects);
  const [row] = await sql`select subjects from public.users where id=${targetId} and tenant_id=${t}`;
  return !!row && people.P.scope.isStaffInSubjectScope(scope, Array.isArray(row.subjects) ? row.subjects : []);
}

/** FormData 모양({ $formData: [[이름, 글자] …] }) → get(이름) · entries. */
export function formOf(arg) {
  if (!arg || typeof arg !== 'object' || !Array.isArray(arg.$formData)) throw new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
  const entries = arg.$formData.filter(e => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string');
  return { entries, get: k => { const e = entries.find(x => x[0] === k); return e ? e[1] : null; } };
}

/**
 * 2.0 세션 클라이언트(createClient) 자리 — 고른 사람의 신분(request.jwt.claims + authenticated)으로 RLS를 지난다.
 * savepoint 안에서 바꾸고, 끝나면(성공이든 실패든) 역할과 claims를 되돌린다 — 뒤의 쓰기(2.0 admin 자리)는 원래 신분으로.
 */
export async function asActor(sql, userId, fn) {
  try {
    return await sql.savepoint(async s => {
      await s`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      await s`set local role authenticated`;
      try { return await fn(s); }
      finally { await s`reset role`.catch(() => {}); }
    });
  } finally {
    await sql`reset role`.catch(() => {});
    await sql`select set_config('request.jwt.claims', '', true)`.catch(() => {});
  }
}
