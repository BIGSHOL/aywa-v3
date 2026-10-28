// 2.0 서버 액션("use server") 자리 — 2.0 Next가 브라우저 묶음에서 서버 함수 호출로 바꾸는 바로 그 경계.
// 호출은 같은 출처의 공통 틀로 간다: POST /api/v2/<화면>/<함수> · 본문 { module, actor, args }(2.0 인자 그대로).
// 서버(v2-screen-<화면>.mjs의 actions)가 받으면 Docker 복사본에 쓰고 2.0 함수의 반환 모양을 그대로 돌려준다.
// 그 화면이 아직 받지 않는 함수(404 action_not_found)는 2.0 실패 모양({ ok:false, error })으로 '복사본 보기 전용'을 알린다.
import { currentScreen } from './host-nav';

export const VIEW_ONLY = '복사본 보기 전용 — 이 화면의 저장은 아직 열지 않았습니다';
const UNREACHABLE = '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다';

export type HostEditor = { id: string; name: string; role: string };
let editors: HostEditor[] = [];
let picked: string | null = null;
const actorKey = () => `v2-host-actor:${currentScreen()}`;

/** 저장하는 사람 — 3.0엔 로그인이 없어 3.0 띠에서 고른다(같은 출처 저장소 + 'v2-host-actor' 알림). 목록에 없으면 첫 사람(원장 먼저). */
export function hostActor(): string | null {
  let stored: string | null = null;
  try { stored = localStorage.getItem(actorKey()); } catch { /* 저장소를 못 쓰면 알림으로 받은 값 */ }
  for (const id of [stored, picked]) if (id && editors.some((e) => e.id === id)) return id;
  return editors[0]?.id ?? null;
}

/** 화면이 자료를 받으면 저장할 수 있는 사람을 알려 준다 — 3.0 띠가 이 목록으로 고르게 한다. */
export function setHostEditors(list: HostEditor[]) {
  editors = list;
  if (window.parent !== window) window.parent.postMessage({ type: 'v2-host-editors', screen: currentScreen(), editors: list, actor: hostActor() }, location.origin);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  const d = e.data as { type?: string; id?: unknown } | null;
  if (d?.type === 'v2-host-actor' && typeof d.id === 'string') picked = d.id;
});

/** 진입점이 직접 처리하는 2.0 서버 함수 — '읽기'(저장이 아닌 것)는 그 화면의 읽기 경로(GET)로, 3.0에서 열지 않는 저장은 보내지 않고
 *  그 자리에서 거절한다. 나머지는 쓰기 경로(POST — 쓰기 기록·직렬화)로 간다. */
type HostHandler = (...args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, HostHandler>();
export function registerHostHandler(module: string, name: string, fn: HostHandler) { handlers.set(`${module}#${name}`, fn); }

/** 2.0 인자를 JSON으로 — FormData(form action)는 [이름, 글자] 줄로 옮긴다(파일은 보내지 않는다). */
const encodeArg = (v: unknown) =>
  typeof FormData !== 'undefined' && v instanceof FormData
    ? { $formData: [...v.entries()].filter(([, x]) => typeof x === 'string') }
    : v === undefined ? null : v;

export function serverAction(module: string, name: string) {
  const fn = async (...args: unknown[]) => {
    const handler = handlers.get(`${module}#${name}`);
    if (handler) return handler(...args);
    const screen = currentScreen();
    let res: Response;
    try {
      res = await fetch(`/api/v2/${encodeURIComponent(screen)}/${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
      });
    } catch {
      return { ok: false, error: UNREACHABLE };
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string; message?: string } | null;
    // 그 화면이 아직 받지 않는 함수 · 서버 화면 모듈이 없는 호스트 화면 — 둘 다 '아직 열지 않은 저장'이다.
    if (res.status === 404 && (body?.error === 'action_not_found' || body?.error === 'screen_not_found')) {
      console.info(`[v2-host] 서버 액션 ${module}#${name} — ${VIEW_ONLY}`);
      return { ok: false, error: VIEW_ONLY };
    }
    if (!res.ok || !body?.ok) return { ok: false, error: body?.message || '저장하지 못했습니다 — 바뀐 것은 없습니다' };
    return body.result;
  };
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}
