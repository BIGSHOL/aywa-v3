// 2.0 화면 · 운영실(대시보드) — 2.0 `<Overview>` 부품을 v2-host(같은 출처 iframe)로 그린다(V2-SCREENS.md '그리는 방식 전환').
// 데이터 = props=1 → 2.0 loadOverview가 돌려주던 스냅샷 그대로(v2-dashboard-overview.mjs) + 첫 그림 차트 종류 + 운영 설정 공급자 값.
// list=viewers → 3.0 쪽 '보는 원장' 고르기(2.0은 로그인한 사람의 화면이라 고르는 칸이 없다). 읽기 전용 — 저장 동작은 없다.
// 스냅샷은 몇 초 걸린다(영역마다 2.0 조회). 같은 원장의 스냅샷은 DB에 그 뒤 쓰기가 없으면 다시 쓴다 — 기준 = 이 트랜잭션의 스냅샷 전체
// (`pg_current_snapshot()` = xmin:xmax:진행 중 목록 · 쓰기 트랜잭션이 생기거나 끝나면 바뀐다 — 연습 저장 · 복사본 다시 깔기 · 직접 고침 모두,
// 스냅샷을 뜰 때 진행 중이던 쓰기도) · 10분 상한 · 실패한 영역이 있으면 담지 않는다. 클러스터 안 다른 DB의 쓰기도 기준을 바꾸지만 다시 셀 뿐이다.
import { loadOverviewSnapshot } from './v2-dashboard-overview.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEEP_MS = 10 * 60 * 1000, kept = new Map();

export const screen = {
  id: 'dashboard', label: '운영실', order: 2,
  params: { props: /^1$/, viewer: UUID, list: /^viewers$/ },
  async load({ sql, params, tenantId: t, importV2 }) {
    if (params.list === 'viewers') {
      // 재직 중인 원장 — 플랫폼 운영 계정은 고르는 칸에 두지 않는다(지점 화면에서 그 계정은 관리자로 보인다 · 고르면 기본 원장으로 그린다).
      const viewers = await sql`select u.id::text id, u.display_name name from public.users u
        where u.tenant_id=${t} and u.status::text = 'active' and u.system_role::text = 'master' and not exists(select 1 from public.super_admins sa where sa.id = u.id)
        order by u.display_name, u.id`;
      return { viewers };
    }
    const [{ snap: stamp }] = await sql`select pg_current_snapshot()::text snap`;
    const key = `${t}|${params.viewer ?? ''}`, hit = kept.get(key);
    if (hit && hit.stamp === stamp && Date.now() - hit.at < KEEP_MS) return hit.value;
    const snap = await loadOverviewSnapshot({ sql, tenantId: t, importV2, viewerId: params.viewer ?? null });
    const value = snap ?? { initial: null, chartKinds: null, viewer: null, host: null };
    if (snap && !Object.values(snap.initial.sections).some((s) => s.error)) kept.set(key, { stamp, at: Date.now(), value });
    return value;
  },
};
