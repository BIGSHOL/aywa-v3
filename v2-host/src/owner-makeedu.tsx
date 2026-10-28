// 2.0 SheetsFace의 makeedu 절. 자료는 복사본 /api/v2/owner가 읽고 원본 부품 네 개가 그린다.
import { EmbedLink } from '@/components/embed-link';
import { humanizeMakeeduSyncError } from '@/features/integrations/sync-error';
import { MakeeduSyncCard } from '@/app/(shell)/owner/_components/makeedu-sync-card';
import { MakeeduSyncRunsList } from '@/app/(shell)/owner/_components/makeedu-sync-runs';
import { MakeeduPushCard } from '@/features/integrations/components/makeedu-push-card';
import type { MakeeduAutoSyncStatus, MakeeduSyncLock, MakeeduSyncRun, MakeeduSyncState, MakeeduWorker, UnpushedIntakeConsultation } from '@/features/integrations/server/makeedu-sync';

export type OwnerMakeeduData = {
  status: MakeeduAutoSyncStatus;
  invoiceSync: MakeeduSyncState | null;
  runs: MakeeduSyncRun[];
  page: number;
  total: number;
  totalPages: number;
  lock: MakeeduSyncLock;
  workers: MakeeduWorker[];
  candidates: UnpushedIntakeConsultation[];
};

export function OwnerMakeeduFace({ data }: { data: OwnerMakeeduData }) {
  const { status, invoiceSync, runs, page, total, totalPages, lock, candidates } = data;
  const runsHref = (p: number) => {
    const params = new URLSearchParams({ tab: 'sheets', sub: 'makeedu' });
    if (p > 1) params.set('page', String(p));
    return `/owner?${params.toString()}`;
  };
  return <>
    {invoiceSync && (invoiceSync.issue || invoiceSync.status !== 'ok') ? <section className="space-y-2 rounded-lg border border-amber/40 bg-amber-soft p-4" aria-label="수납 동기화 확인 사항">
      <h2 className="text-base font-bold">수납 동기화 확인 사항</h2>
      <p className="text-text-dim text-xs">{new Date(invoiceSync.syncedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 기준</p>
      <p className="break-words text-sm" title={invoiceSync.issue ?? undefined}>{invoiceSync.status === 'ok' ? invoiceSync.issue : humanizeMakeeduSyncError(invoiceSync.issue) || '수납 동기화 실패'}</p>
      {invoiceSync.issue?.includes('미매칭') ? <>
        <p className="text-sm">학생 미매칭은 원생의 이름·학년·중복 등록을 확인해야 합니다. 가져오지 못한 수납은 수납 화면의 ‘마지막 동기화에 없던 청구’ 목록에 표시되지 않습니다.</p>
        <EmbedLink href="/owner?tab=data" className="inline-flex text-sm font-semibold text-primary underline underline-offset-2">데이터 정리에서 중복 원생 확인</EmbedLink>
        <p className="text-text-dim text-xs">미매칭 대상의 상세 내역은 동기화 담당 PC의 .makeedu-tmp/import-invoices-report.json에서 확인할 수 있습니다.</p>
      </> : <p className="text-sm">연동 PC 탭의 담당 PC 상태와 아래 최근 실행 이력을 확인하세요.</p>}
    </section> : null}
    <MakeeduSyncCard status={status} initialLock={lock} />
    <EmbedLink href="/owner?tab=sheets&sub=agent" className="text-primary text-sm font-semibold underline underline-offset-2">연동 PC 관리</EmbedLink>
    <MakeeduSyncRunsList runs={runs} page={page} totalPages={totalPages} total={total} hrefForPage={runsHref} />
    <MakeeduPushCard candidates={candidates} />
  </>;
}
