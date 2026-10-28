// 운영실 KPI 카드 묶음을 저장점 안에서 센다 — 묶음이 DB 오류로 실패해도 바깥(스냅샷) 트랜잭션은 산다(v2-dashboard-flow.mjs · v2-dashboard-flow-attendance.mjs).
// 묶음 안에는 여러 단계로 조회하는 갈래가 나란히 돈다(Promise.all). 한 갈래가 실패해 저장점이 되돌려진 뒤에도 다른 갈래가 같은 연결로 다음 조회를
// 내면 그 조회는 저장점 밖에서 돌아, 그것도 실패하면 바깥 트랜잭션이 깨진다(25P02). 그래서 묶음이 끝나는 순간(되돌리기 전) 관문을 닫아,
// 늦게 온 조회는 연결로 보내지 않고 바로 거절한다.

const QUERY_PROPS = new Set(['savepoint', 'unsafe', 'file']);

/** `fn(sp)`를 `sql`의 저장점 안에서 — `sp`는 묶음이 끝나면 닫힌다(늦은 조회는 오류로 거절 · 연결에 닿지 않는다). 실패는 그대로 던진다. */
export async function isolated(sql, fn) {
  let open = true;
  const closed = () => new Error('운영실 KPI: 끝난 묶음의 늦은 조회는 보내지 않습니다');
  return sql.savepoint(async (sp) => {
    const gate = new Proxy(sp, {
      apply(target, self, args) { if (!open) throw closed(); return Reflect.apply(target, self, args); },
      get(target, prop) {
        const v = Reflect.get(target, prop);
        return QUERY_PROPS.has(prop) && typeof v === 'function' ? (...args) => { if (!open) throw closed(); return v.apply(target, args); } : v;
      },
    });
    try { return await fn(gate); } finally { open = false; }
  });
}
