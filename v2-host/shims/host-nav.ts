// 호스트 안 이동 — 2.0 부품이 부르는 주소(`/timetable?…`·`/students/<id>`)를 호스트 규칙으로 옮긴다.
//  · 같은 화면(`/<id>` = 호스트가 그리는 화면)은 iframe 문서를 다시 읽지 않고 주소만 바꾼다(history) — 화면이 그 주소로 다시 그린다.
//    3.0(부모)에도 알려 3.0 주소(#v2-<id>?…)가 같은 화면을 가리키게 한다.
//  · 그 밖의 2.0 주소(학생·반 상세 등)는 iframe에서 열지 않는다 — 3.0(부모)에 넘겨 3.0 기록 창으로 연다. 2.0 운영 사이트로는 가지 않는다.
// 2.0 주소 → 호스트 화면 id. 빌드가 진입점마다(HOST_ROUTE) 채운다(build.mjs define).
declare const __V2_HOST_ROUTES__: Record<string, string>;
const ROUTES: Record<string, string> = typeof __V2_HOST_ROUTES__ === 'object' ? __V2_HOST_ROUTES__ : {};
export type HostTarget = { kind: 'host'; screen: string; query: string } | { kind: 'parent'; href: string };

export function hostTarget(href: string): HostTarget {
  const u = new URL(href, 'http://2.0.local/');
  const screen = Object.hasOwn(ROUTES, u.pathname) ? ROUTES[u.pathname] : null;
  if (screen) return { kind: 'host', screen, query: u.searchParams.toString() };
  return { kind: 'parent', href: `${u.pathname}${u.search}` };
}
/** 지금 화면의 2.0 주소(usePathname) — 진입점의 HOST_ROUTE. */
export const currentRoute = () => Object.keys(ROUTES).find((r) => ROUTES[r] === currentScreen()) ?? `/${currentScreen()}`;

/** 호스트 화면 주소(iframe 안). */
export function hostHref(t: { screen: string; query: string }): string {
  return `${t.screen}.html${t.query ? `?${t.query}` : ''}`;
}
export const currentScreen = () => location.pathname.split('/').pop()?.replace(/\.html$/, '') ?? '';

const refreshers = new Set<() => void>();
export const onHostRefresh = (fn: () => void) => { refreshers.add(fn); return () => { refreshers.delete(fn); }; };
export const hostRefresh = () => { for (const fn of refreshers) fn(); };

/** 주소 바뀜 알림 — useSyncExternalStore로 읽는다(뒤로 가기·앞으로 가기 포함). */
const LOCATION = 'v2-host-location';
export function subscribeLocation(fn: () => void) {
  addEventListener(LOCATION, fn); addEventListener('popstate', fn);
  return () => { removeEventListener(LOCATION, fn); removeEventListener('popstate', fn); };
}
const tellParent = (message: Record<string, unknown>) => window.parent?.postMessage(message, window.location.origin);
addEventListener('popstate', () => tellParent({ type: 'v2-host-nav', screen: currentScreen(), query: location.search.slice(1), mode: 'replace' }));

export function hostNavigate(href: string, mode: 'push' | 'replace' = 'push') {
  const t = hostTarget(href);
  if (t.kind === 'parent') { tellParent({ type: 'v2-host-open', href: t.href }); return; }
  const next = hostHref(t);
  if (t.screen !== currentScreen()) { window.location.assign(next); return; }
  if (mode === 'replace') history.replaceState(null, '', next); else history.pushState(null, '', next);
  dispatchEvent(new Event(LOCATION));
  tellParent({ type: 'v2-host-nav', screen: t.screen, query: t.query, mode });
}
