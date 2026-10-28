import { useEffect, useRef } from 'react';
import { ContributionSettings } from '@/features/student-contribution/components/settings-form';
import type { ContributionConfig, Raws } from '@/features/student-contribution/model/config';

export type OwnerContributionData = {
  gate: { tenantId: string; userId: string; canConfigure: boolean; canWrite: boolean };
  ready: boolean;
  config: ContributionConfig;
  revision: number;
  historyReady: boolean;
  parentEventsApproved: boolean;
  studentCount: number;
  raws: Raws;
};

export function OwnerContributionFace({ d }: { d: OwnerContributionData }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('nav[aria-label="원생 기여도 메뉴"]');
    if (!el) return;
    el.classList.add('scrollbar-hide');
    const update = () => {
      const left = el.scrollLeft > 1 ? 14 : 0;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? 14 : 0;
      el.style.maskImage = `linear-gradient(to right, transparent 0, black ${left}px, black calc(100% - ${right}px), transparent 100%)`;
    };
    const resize = new ResizeObserver(update);
    resize.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => { resize.disconnect(); el.removeEventListener('scroll', update); el.classList.remove('scrollbar-hide'); el.style.maskImage = ''; };
  }, []);
  return <div ref={root}><ContributionSettings data={d} /></div>;
}
