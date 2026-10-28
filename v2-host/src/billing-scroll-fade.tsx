import { useEffect, useRef, type ReactNode } from 'react';
import './billing-scroll-fade.css';

/** 2.0 수납 표는 그대로 두고, 호스트에서 넘치는 방향만 내용 가장자리를 흐린다. */
export function BillingScrollFade({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let current: HTMLElement | null = null;
    let currentTable: HTMLTableElement | null = null;
    let detach = () => {};
    const attach = () => {
      const table = [...host.querySelectorAll<HTMLTableElement>('table')].find((el) => el.classList.contains('min-w-[1080px]'));
      const scroll = table?.parentElement;
      if (scroll === current && table === currentTable) return;
      detach();
      current = scroll ?? null;
      currentTable = table ?? null;
      if (!scroll || !table) return;
      // 원본 DragScrollArea의 흐린 그림자는 호스트 내용 마스크와 겹치지 않게 숨긴다.
      const originalFades = [...scroll.parentElement!.querySelectorAll<HTMLElement>(':scope > span[aria-hidden]')].slice(0, 2);
      originalFades.forEach((fade) => { fade.style.opacity = '0'; });
      // DragScrollArea가 상태 변경 때 className을 다시 쓰므로 속성과 인라인 스타일로 유지한다.
      const oldBar = scroll.style.scrollbarWidth;
      const oldMask = scroll.style.maskImage;
      scroll.dataset.billingScroll = '';
      scroll.style.scrollbarWidth = 'none';
      const update = () => {
        const left = scroll.scrollLeft > 1 ? 24 : 0;
        const right = scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1 ? 24 : 0;
        scroll.style.maskImage = `linear-gradient(to right, transparent 0, black ${left}px, black calc(100% - ${right}px), transparent 100%)`;
      };
      const resize = new ResizeObserver(update);
      resize.observe(scroll);
      resize.observe(table);
      scroll.addEventListener('scroll', update, { passive: true });
      update();
      detach = () => {
        resize.disconnect();
        scroll.removeEventListener('scroll', update);
        delete scroll.dataset.billingScroll;
        scroll.style.scrollbarWidth = oldBar;
        scroll.style.maskImage = oldMask;
        originalFades.forEach((fade) => { fade.style.opacity = ''; });
      };
    };
    const changed = new MutationObserver(attach);
    changed.observe(host, { childList: true, subtree: true });
    attach();
    return () => { changed.disconnect(); detach(); };
  }, []);
  return <div ref={root} className="min-w-0">{children}</div>;
}
