// next/navigation 대체 — 2.0 부품의 useRouter/usePathname/useSearchParams를 호스트 iframe 주소로.
import { useMemo, useSyncExternalStore } from 'react';
import { V2PATH, currentRoute, hostNavigate, hostRefresh, subscribeLocation } from './host-nav';

const router = {
  push: (href: string) => hostNavigate(href, 'push'),
  replace: (href: string) => hostNavigate(href, 'replace'),
  refresh: () => hostRefresh(),
  back: () => history.back(),
  forward: () => history.forward(),
  prefetch: () => {},
};
export function useRouter() { return router; }
/** 2.0 주소 — 하위 경로(v2path)가 있으면 그것. 호스트 안 이동·뒤로 가기에 따라 바뀐다. */
export function usePathname() { return useSyncExternalStore(subscribeLocation, currentRoute, currentRoute); }
/** 지금 주소의 쿼리 — 호스트 안 이동(history)·뒤로 가기에 따라 바뀐다. */
export function useHostSearch() { return useSyncExternalStore(subscribeLocation, () => location.search, () => ''); }
/** 2.0 쿼리 — 호스트가 붙인 v2path는 뺀다(2.0 부품이 쿼리를 이어 써도 경로 칸이 딸려 가지 않게). */
export function useSearchParams() { const s = useHostSearch(); return useMemo(() => { const q = new URLSearchParams(s); q.delete(V2PATH); return q; }, [s]); }
export function useParams() { return {}; }
export function useSelectedLayoutSegment() { return null; }
export function useSelectedLayoutSegments() { return []; }
export function redirect(href: string): never { hostNavigate(href, 'replace'); throw new Error('redirect'); }
export function notFound(): never { throw new Error('notFound'); }
export const RedirectType = { push: 'push', replace: 'replace' } as const;
