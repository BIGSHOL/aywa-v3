// next/navigation 대체 — 2.0 부품의 useRouter/usePathname/useSearchParams를 호스트 iframe 주소로.
import { useMemo, useSyncExternalStore } from 'react';
import { currentScreen, hostNavigate, hostRefresh, subscribeLocation } from './host-nav';

const router = {
  push: (href: string) => hostNavigate(href, 'push'),
  replace: (href: string) => hostNavigate(href, 'replace'),
  refresh: () => hostRefresh(),
  back: () => history.back(),
  forward: () => history.forward(),
  prefetch: () => {},
};
export function useRouter() { return router; }
export function usePathname() { return `/${currentScreen()}`; }
/** 지금 주소의 쿼리 — 호스트 안 이동(history)·뒤로 가기에 따라 바뀐다. */
export function useHostSearch() { return useSyncExternalStore(subscribeLocation, () => location.search, () => ''); }
export function useSearchParams() { const s = useHostSearch(); return useMemo(() => new URLSearchParams(s), [s]); }
export function useParams() { return {}; }
export function useSelectedLayoutSegment() { return null; }
export function useSelectedLayoutSegments() { return []; }
export function redirect(href: string): never { hostNavigate(href, 'replace'); throw new Error('redirect'); }
export function notFound(): never { throw new Error('notFound'); }
export const RedirectType = { push: 'push', replace: 'replace' } as const;
