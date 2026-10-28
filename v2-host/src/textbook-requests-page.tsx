// 2.0 교재 요청(app/(shell)/textbook-requests/page.tsx)의 그리기 — 서버 컴포넌트라 그대로 못 불러와서, 서버가 하던 조회(요청 목록 · 학생 · 카탈로그 · 설정)는
// /api/v2/textbook-requests(Docker 복사본, v2-screen-textbook-requests.mjs)가 하고 여기서는 page.tsx의 return 본문을 **글자 그대로** 옮겼다.
// initialStudentIds는 2.0과 같은 식으로 주소(studentId)에서 읽는다 · 로고는 파일 저장소라 null.
import { useEffect, useRef } from 'react';
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { accountForTarget, type TenantSettings } from "@/features/owner/settings-types";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import { TextbookRequestClient } from "@/app/(shell)/textbook-requests/_client";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

/** /api/v2/textbook-requests — page.tsx의 조회 결과(이름 그대로). */
export type TextbookRequestsPageData = {
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  isTeacher: boolean;
  settings: { profile: Pick<TenantSettings["profile"], "name">; billing: TenantSettings["billing"]; modules: TenantSettings["modules"] };
  logoUrl: string | null;
  user: { id: string; displayName: string };
  focusOrderId: string | null;
};

/** page.tsx `TextbookRequestsPage`의 그리기. */
function TextbookRequestsBasePage({ d, initialStudentIds }: { d: TextbookRequestsPageData; initialStudentIds: string[] }) {
  const { rows, students, catalog, isTeacher, settings, logoUrl, user } = d;
  return (
    <TextbookRequestClient
      rows={rows}
      students={students}
      catalog={catalog}
      isTeacher={isTeacher}
      academyName={settings.profile.name || NEUTRAL_ACADEMY_NAME}
      logoUrl={logoUrl}
      account={accountForTarget(settings.billing, "textbook")}
      requesterName={user.displayName}
      // 소유 판정 합집합(0174a) — 이름을 다르게 적어도 본인이 만든 요청은 본인 것.
      viewerUserId={user.id}
      initialStudentIds={initialStudentIds}
      classnoteOn={classnoteModuleOn(settings)}
    />
  );
}

/** 업무 흐름 링크는 원본 요청 내역의 그 한 줄을 화면 안에서 보이게 한다(목록·폼 UI는 그대로). */
export function TextbookRequestsHostPage({ d, initialStudentIds }: { d: TextbookRequestsPageData; initialStudentIds: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!d.focusOrderId || d.rows[0]?.id !== d.focusOrderId) return;
    const h = [...(root.current?.querySelectorAll('h2') ?? [])].find(el => el.textContent?.includes('요청 내역'));
    const section = h?.closest('section');
    if (!section) return;
    const done = !!(d.rows[0].registered && d.rows[0].ordered && d.rows[0].paid);
    if (done) [...section.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith('완료'))?.click();
    let selected: HTMLElement | null = null;
    let clearFade = () => {};
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        selected = section.querySelector<HTMLElement>('ul > li');
        selected?.classList.add('ring-2', 'ring-primary');
        if (selected) { selected.style.outline = '2px solid var(--color-primary)'; selected.style.outlineOffset = '-2px'; }
        const list = selected?.closest('ul');
        if (list?.classList.contains('overflow-y-auto')) {
          list.classList.add('scrollbar-hide');
          const update = () => {
            const top = list.scrollTop > 1 ? 14 : 0;
            const bottom = list.scrollTop + list.clientHeight < list.scrollHeight - 1 ? 14 : 0;
            list.style.maskImage = `linear-gradient(to bottom, transparent 0, black ${top}px, black calc(100% - ${bottom}px), transparent 100%)`;
          };
          const resize = new ResizeObserver(update);
          resize.observe(list);
          list.addEventListener('scroll', update, { passive: true });
          update();
          clearFade = () => { resize.disconnect(); list.removeEventListener('scroll', update); list.classList.remove('scrollbar-hide'); list.style.maskImage = ''; };
        }
        selected?.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
    });
    return () => { cancelAnimationFrame(frame); clearFade(); selected?.classList.remove('ring-2', 'ring-primary'); if (selected) { selected.style.outline = ''; selected.style.outlineOffset = ''; } };
  }, [d.focusOrderId, d.rows]);
  return <div ref={root}><TextbookRequestsBasePage key={d.focusOrderId ?? 'list'} d={d} initialStudentIds={initialStudentIds} /></div>;
}
