// next/dynamic 대체 — React.lazy + Suspense(loading을 대기 화면으로). 2.0이 무거운 부품을 늦게 불러오는 자리 그대로.
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;
export default function dynamic<P extends object>(loader: Loader<P>, opts: { loading?: () => ReactNode; ssr?: boolean } = {}) {
  const Lazy = lazy(async () => { const m = await loader(); return { default: (typeof m === 'function' ? m : (m as { default: ComponentType<P> }).default) as ComponentType<P> }; });
  return function Dynamic(props: P) {
    return <Suspense fallback={opts.loading ? opts.loading() : null}><Lazy {...props} /></Suspense>;
  };
}
