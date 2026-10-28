// 호스트 공통 틀 — 화면마다 같다(진입점 여럿). 2.0 창(embed) 레이아웃의 <main>과 같은 클래스,
// 그리고 2.0 부품이 iframe 안에서 해선 안 되는 일의 경계:
//  · 2.0 API 링크(엑셀 내보내기 `/api/exports/…` 등)를 누르면 iframe이 그 주소로 가 버린다 → 막고 '복사본 보기 전용'을 알린다.
//  · 2.0이 부모 워크스페이스에 창을 열어 달라는 신호(eywa-open-window)는 3.0(부모)에 그대로 넘긴다(3.0이 자기 기록 창으로 연다).
//  · 2.0의 `window.location.assign(2.0 주소)`는 호스트 이동으로(shims/host-nav.ts hostAssign).
import { useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { NOT_SUPPORTED } from '../shims/server-action';
import { hostAssign } from '../shims/host-nav';

// 2.0 부품의 `window.location.assign(…)`(빌드가 __v2HostAssign으로 바꿔 넣는다) — 문서를 다시 읽는 대신 호스트 이동으로. 막힌 주소면 '지원하지 않음'.
(globalThis as { __v2HostAssign?: (href: string) => void }).__v2HostAssign = (href: string) => { if (!hostAssign(href)) toast.info(NOT_SUPPORTED); };

export function HostFrame({ screen, children }: { screen: string; children: ReactNode }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (/^\/api\//.test(href) || /^https?:/i.test(href)) { e.preventDefault(); toast.info(NOT_SUPPORTED); }
    };
    document.addEventListener('click', onClick, true);
    window.parent.postMessage({ type: 'v2-host-ready', screen }, window.location.origin);
    return () => document.removeEventListener('click', onClick, true);
  }, [screen]);
  return <main className="embed-main relative bg-background text-foreground h-screen overflow-auto px-1.5 pt-2 pb-8 lg:pb-10 [scrollbar-gutter:stable]">{children}</main>;
}

export function HostMessage({ text, error = false }: { text: string; error?: boolean }) {
  return <main className="embed-main relative bg-background text-foreground h-screen overflow-auto px-1.5 pt-2"><p className={`p-6 text-sm ${error ? 'text-danger' : 'text-text-dim'}`} role={error ? 'alert' : 'status'}>{text}</p></main>;
}
