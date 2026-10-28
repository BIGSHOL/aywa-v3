// 호스트 안 이동 — 2.0 부품이 부르는 주소(`/timetable?…`·`/students/<id>`)를 호스트 규칙으로 옮긴다.
//  · 같은 화면(`/<id>` = 호스트가 그리는 화면)은 iframe 문서를 다시 읽지 않고 주소만 바꾼다(history) — 화면이 그 주소로 다시 그린다.
//    3.0(부모)에도 알려 3.0 주소(#v2-<id>?…)가 같은 화면을 가리키게 한다.
//  · 화면 주소의 하위 경로(`/ecs/<반id>/month` = HOST_ROUTE + '/…')도 같은 화면이다 — iframe 주소에 `v2path=<2.0 경로>`를
//    맨 앞에 싣고(나머지는 원래 쿼리), usePathname()은 v2path를, useSearchParams()는 v2path를 뺀 쿼리를 돌려준다.
//    3.0(부모)에 가는 v2-host-nav의 query에도 v2path가 그대로 실린다.
//  · 그 밖의 2.0 주소(학생·반 상세 등)는 iframe에서 열지 않는다 — 3.0(부모)에 넘겨 3.0 기록 창으로 연다. 2.0 운영 사이트로는 가지 않는다.
// 2.0 주소 → 호스트 화면 id. 빌드가 진입점마다(HOST_ROUTE) 채운다(build.mjs define).
declare const __V2_HOST_ROUTES__: Record<string, string>;
const ROUTES: Record<string, string> = typeof __V2_HOST_ROUTES__ === 'object' ? __V2_HOST_ROUTES__ : {};
export type HostTarget = { kind: 'host'; screen: string; query: string } | { kind: 'parent'; href: string };

export const V2PATH = 'v2path';
/** 하위 경로를 가진 화면 주소 — 가장 긴 HOST_ROUTE부터 본다(`/a`와 `/a/b`가 둘 다 진입점이면 `/a/b/…`는 뒤쪽). */
const routeOf = (pathname: string) =>
  Object.hasOwn(ROUTES, pathname) ? { route: pathname, sub: false }
    : Object.keys(ROUTES).sort((a, b) => b.length - a.length).filter((r) => pathname.startsWith(`${r}/`)).map((route) => ({ route, sub: true }))[0] ?? null;

export function hostTarget(href: string): HostTarget {
  const u = new URL(href, 'http://2.0.local/');
  const hit = routeOf(u.pathname);
  if (hit) {
    const q = new URLSearchParams(u.searchParams);
    q.delete(V2PATH); // 2.0 주소에는 없는 칸 — 쿼리를 이어 쓴 주소에 딸려 와도 경로는 이 주소의 것이다
    const query = hit.sub ? new URLSearchParams([[V2PATH, u.pathname], ...q]).toString() : q.toString();
    return { kind: 'host', screen: ROUTES[hit.route], query };
  }
  return { kind: 'parent', href: `${u.pathname}${u.search}` };
}
/** 진입점의 HOST_ROUTE. */
const baseRoute = () => Object.keys(ROUTES).find((r) => ROUTES[r] === currentScreen()) ?? `/${currentScreen()}`;
/** 지금 화면의 2.0 주소(usePathname) — 하위 경로(v2path)가 이 화면의 것이면 그것, 아니면 HOST_ROUTE. */
export const currentRoute = () => {
  const base = baseRoute(), sub = new URLSearchParams(location.search).get(V2PATH);
  return sub && sub.startsWith(`${base}/`) && !/[?#]/.test(sub) ? sub : base;
};

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
  if (t.screen !== currentScreen()) { location.assign(next); return; } // `window.location.assign`이라 적으면 빌드가 hostAssign으로 바꾼다(아래)
  if (mode === 'replace') history.replaceState(null, '', next); else history.pushState(null, '', next);
  dispatchEvent(new Event(LOCATION));
  tellParent({ type: 'v2-host-nav', screen: t.screen, query: t.query, mode });
}

/**
 * 2.0 부품의 `window.location.assign(href)` 자리 — 빌드(build.mjs define)가 그 호출을 이 함수로 바꿔 넣는다(Location은 덮어쓸 수 없다).
 * 2.0은 문서를 통째로 다시 읽어 그 주소의 화면을 그리지만, iframe에서 2.0 주소를 그대로 읽으면 3.0 서버에 없는 주소다.
 *  · `/api/…`·바깥 주소(`https:`·`//…`) → 막고 false(부르는 쪽이 '지원하지 않음'을 알린다) · `embed` 칸은 창 표식이라 뺀다
 *  · 같은 화면 → 주소가 다르면 바꾸고, **늘 다시 읽는다** — 2.0의 문서 이동은 새 데이터로 다시 그리는 일이라(저장 뒤 이동 포함),
 *    주소 중 서버가 안 보는 칸(시간표 gedit 등)만 바뀌어도 새 값을 받아야 한다
 *  · 그 밖 → hostNavigate(다른 화면은 그 호스트 화면 문서, 호스트 화면이 아닌 2.0 주소는 3.0 기록 창)
 */
export function hostAssign(href: string): boolean {
  const raw = String(href ?? '');
  if (/^\/api\//.test(raw) || /^[\\/]{2}/.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  const u = new URL(raw, 'http://2.0.local/');
  u.searchParams.delete('embed');
  const clean = `${u.pathname}${u.search}`;
  const t = hostTarget(clean);
  if (t.kind === 'host' && t.screen === currentScreen()) {
    if (t.query !== location.search.slice(1)) hostNavigate(clean, 'push');
    hostRefresh();
    return true;
  }
  hostNavigate(clean, 'push');
  return true;
}
