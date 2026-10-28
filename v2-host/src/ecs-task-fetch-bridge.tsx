'use client';

import { useEffect } from 'react';

/** 2.0 StaffTaskDialog의 GET 두 주소를 ECS 조회로 잇는다. 호스트는 독립 iframe이라 이 범위에서만 fetch가 바뀐다. */
export function EcsTaskFetchBridge({ viewer }: { viewer: string }) {
  useEffect(() => {
    const cleanups = new Map<HTMLElement, () => void>();
    const attach = (el: HTMLElement) => {
      if (cleanups.has(el)) return;
      el.classList.add('scrollbar-hide');
      const update = () => {
        const top = el.scrollTop > 1 ? 14 : 0;
        const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? 14 : 0;
        el.style.maskImage = top || bottom
          ? `linear-gradient(to bottom, ${top ? 'transparent' : 'black'} 0, black ${top}px, black calc(100% - ${bottom}px), ${bottom ? 'transparent' : 'black'} 100%)`
          : '';
      };
      const resize = new ResizeObserver(update);
      const content = new MutationObserver(update);
      resize.observe(el);
      content.observe(el, { childList: true, subtree: true });
      el.addEventListener('scroll', update, { passive: true });
      update();
      cleanups.set(el, () => {
        resize.disconnect(); content.disconnect(); el.removeEventListener('scroll', update);
        el.classList.remove('scrollbar-hide'); el.style.maskImage = '';
      });
    };
    const scan = () => {
      for (const [el, cleanup] of cleanups) if (!el.isConnected) { cleanup(); cleanups.delete(el); }
      document.querySelectorAll<HTMLElement>('[role="dialog"] .scrollbar-thin').forEach(attach);
    };
    const mount = new MutationObserver(scan);
    mount.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { mount.disconnect(); cleanups.forEach(cleanup => cleanup()); };
  }, []);
  useEffect(() => {
    const original = window.fetch;
    const bridged: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url, window.location.href);
      if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith('/api/staff-tasks')) return original.call(window, input, init);
      const target = new URL('/api/v2/ecs', window.location.origin);
      target.searchParams.set('viewer', viewer);
      if (parsed.pathname === '/api/staff-tasks') {
        if (parsed.searchParams.get('scope') !== 'mine') return Promise.resolve(new Response(JSON.stringify({ error: '접근 권한이 없습니다' }), { status: 403, headers: { 'content-type': 'application/json' } }));
        target.searchParams.set('read', 'taskList');
        target.searchParams.set('filter', parsed.searchParams.get('filter') ?? 'open');
        target.searchParams.set('page', parsed.searchParams.get('page') ?? '0');
      } else {
        const id = /^\/api\/staff-tasks\/([0-9a-f-]+)$/.exec(parsed.pathname)?.[1];
        if (!id) return original.call(window, input, init);
        target.searchParams.set('read', 'taskDetail');
        target.searchParams.set('taskId', id);
      }
      return original.call(window, target.href, init);
    };
    window.fetch = bridged;
    return () => { if (window.fetch === bridged) window.fetch = original; };
  }, [viewer]);
  return null;
}
