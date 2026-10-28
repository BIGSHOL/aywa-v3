// next/link 대체 — 같은 <a>를 그리고, 누르면 호스트 이동(호스트 화면은 iframe 안, 그 밖은 3.0 기록 창).
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { hostHref, hostNavigate, hostTarget } from './host-nav';

/** 호스트 이동은 즉시 history를 바꾸거나 부모 창에 알린다. 보류 단계가 없어서 Next Pages Router와 같이 false다. */
export const useLinkStatus = () => ({ pending: false });

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string | { pathname?: string; query?: Record<string, string> }; prefetch?: unknown; replace?: boolean; scroll?: boolean; shallow?: boolean; children?: ReactNode };
const toHref = (h: Props['href']) => (typeof h === 'string' ? h : `${h.pathname ?? ''}${h.query ? `?${new URLSearchParams(h.query)}` : ''}`);

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch: _p, replace, scroll: _s, shallow: _sh, onClick, children, ...rest }, ref) {
  const raw = toHref(href), t = hostTarget(raw);
  const shown = t.kind === 'host' ? hostHref(t) : '#';
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    hostNavigate(raw, replace ? 'replace' : 'push');
  };
  return <a ref={ref} href={shown} onClick={click} {...rest}>{children}</a>;
});
export default Link;
