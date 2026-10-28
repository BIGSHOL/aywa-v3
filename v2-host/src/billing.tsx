// 2.0 부품 호스트 — 수납관리 진입점. 3.0 `#v2-billing`이 같은 출처 iframe(/v2-host/billing.html?…)으로 연다.
// 2.0 page.tsx(`/billing`)가 그리는 그대로(billing-page.tsx), 2.0 (shell) 레이아웃이 창(embed) 화면을 감싸는 공급자(Embed · 운영 설정)로 감싼다.
// 데이터 = /api/v2/billing?…(Docker 복사본, v2-screen-billing.mjs) — page.tsx와 각 면이 서버에서 받던 값 그대로.
// 보는 사람 = 3.0 띠가 고른 사람(수납 권한 · 급여 열람 · 쓰기 수준이 그 사람의 권한 표). 고르면 v2-host-actor로 알려 오고 다시 읽는다.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '@/lib/providers/app-providers';
import { OperationsProvider } from '@/features/owner/operations-context';
import { EmbedProvider } from '@/components/workspace/embed-context';
import { hostRefresh, onHostRefresh } from '../shims/host-nav';
import { useHostSearch } from '../shims/next-navigation';
import { VIEW_ONLY, hostActor, registerHostHandler, setHostEditors, type HostEditor } from '../shims/server-action';
import { ExpenseDocument } from '@/app/(shell)/billing/_components/expense-document';
import type { RefundDetail } from '@/features/billing/server/refund-queries';
import { NewRefundPage } from './billing-refund-new';
import { RefundViewPage } from './billing-refund-view';
import { HostRedirect } from './billing-host-parts';
import type { ExpenseRow } from '@/features/billing/server/expense-queries';
import { HostFrame, HostMessage } from './host-frame';
import { BillingPage, type BillingPageData } from './billing-page';
import { DEFAULT_TEXTBOOK_MENT } from '@/features/billing/textbook-notice';

// ── 저장: 2.0 서버 함수 이름 그대로 보내고(POST /api/v2/billing/<함수>), 성공하면 2.0 revalidatePath('/billing')처럼 이 화면을 다시 읽는다 ──
const NOT_SAVED = '저장하지 못했습니다 — 바뀐 것은 없습니다', UNREACHABLE = '연습 서버에 닿지 못했습니다 — 바뀐 것은 없습니다';
const encodeArg = (v: unknown) =>
  v instanceof FormData ? { $formData: [...v.entries()].filter(([, x]) => typeof x === 'string') } : v === undefined ? null : v;
function saving(module: string, name: string, refresh: boolean) {
  registerHostHandler(module, name, async (...args: unknown[]) => {
    let res: Response;
    try {
      res = await fetch(`/api/v2/billing/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ module, actor: hostActor(), args: args.map(encodeArg) }),
      });
    } catch { return { error: UNREACHABLE, ok: false }; }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; message?: string } | null;
    if (!res.ok || !body?.ok) return { error: body?.message || NOT_SAVED, ok: false };
    const r = body.result as { ok?: boolean; error?: unknown } | null | undefined;
    // 2.0 revalidatePath 자리 — 실패(error)가 아니면 다시 읽는다(회차 확정 함수 중엔 ok 없이 갱신 줄만 돌려주는 것도 있다).
    if (refresh && !(r && typeof r === 'object' && r.error)) hostRefresh();
    return r ?? undefined;
  });
}
const TEXTBOOK = 'features/billing/server/textbook-actions.ts', NOTICE = 'features/billing/server/textbook-notice-actions.ts';
for (const name of ['toggleTextbookCheck', 'createTextbookOrder', 'updateTextbookOrder', 'deleteTextbookOrder']) saving(TEXTBOOK, name, true);
// 내 학부모 메시지 — 중간저장(2.0도 다시 그리지 않는다) · 읽기는 같은 화면의 GET(ment). 못 읽으면 기본 문구(2.0 loadMyTextbookMent의 빈 값 자리).
saving(NOTICE, 'saveMyTextbookMent', false);
// 지출 — 증빙 파일(올리기·열기·지우기)은 파일 저장소라 받지 않는다(보내지 않고 '아직 지원하지 않는 저장').
const EXPENSE = 'features/billing/server/expense-actions.ts';
for (const name of ['createExpense', 'updateExpense', 'deleteExpense', 'toggleExpenseApproval', 'duplicateExpense', 'setExpenseReceiptType']) saving(EXPENSE, name, true);
// 수납 면 — 청구서 만들기 · 수동 청구서 완납/취소.
saving('features/billing/server/actions.ts', 'createInvoice', true);
for (const name of ['markManualInvoicePaid', 'voidManualInvoice']) saving('features/billing/server/manual-invoice-actions.ts', name, true);
// 회차 확정 — 저장은 2.0 서버 함수 그대로(서버가 공용 러너로) · 읽기 셋은 같은 화면의 GET(보는 사람으로).
const SESSION = 'features/billing/session-terms/server/';
const readBillingLater = (params: Record<string, string>, fallback: unknown) => readBilling(params, fallback);
const SESSION_WRITES: [string, string[]][] = [
  ['actions.ts', ['refreshPlannedTerms', 'confirmClassTerms', 'confirmSessionTerm', 'unconfirmSessionTerm', 'setSessionTermCarryover']],
  ['class-unconfirm-actions.ts', ['unconfirmClassTerms']], ['money-carryover-actions.ts', ['saveMoneyCarryover']], ['monthly-sessions.ts', ['updateMonthlyTermSessions']],
  ['receipt-allocation-actions.ts', ['mergeReceiptItems', 'saveReceiptAllocation', 'saveFreeReceiptAllocation']], ['selected-confirm-actions.ts', ['confirmSelectedTerms']],
  ['splits-actions.ts', ['saveTeacherSplits']], ['delete-actions.ts', ['deleteSessionTerm']], ['note-actions.ts', ['updateSessionTermNote']],
];
for (const [file, names] of SESSION_WRITES) for (const name of names) saving(SESSION + file, name, true);
const sessionRead = (file: string, name: string) => registerHostHandler(SESSION + file, name, async (...args: unknown[]) => {
  const body = (await readBillingLater({ call: name, args: JSON.stringify(args.map((a) => (a === undefined ? null : a))) }, null)) as { value?: unknown } | null;
  return body && 'value' in body ? body.value : { error: NOT_SAVED };
});
sessionRead('receipt-allocation-actions.ts', 'getReceiptAllocation');
sessionRead('money-carryover-actions.ts', 'getMoneyCarryoverOptions');
sessionRead('delete-actions.ts', 'getSessionTermDeletePreview');
// 수강료 계산기 — 교재 단가표(교재 면에도 있다) · 수강료 단가 · 견적 저장/삭제.
const CALC: [string, string[]][] = [
  ['features/billing/server/catalog-actions.ts', ['createCatalogItem', 'updateCatalogItem', 'deleteCatalogItem', 'toggleCatalogActive']],
  ['features/billing/server/tuition-catalog-actions.ts', ['createTuitionItem', 'updateTuitionItem', 'deleteTuitionItem', 'setTuitionPricingMode', 'toggleTuitionActive']],
  ['features/billing/server/tuition-quote-actions.ts', ['saveTuitionQuote', 'deleteTuitionQuote']],
];
for (const [module, names] of CALC) for (const name of names) saving(module, name, true);
// 환불 요청서 — 저장 · 지우기는 쓰기 경로, 자동입력 읽기 둘은 같은 화면의 GET(보는 사람으로).
const REFUND = 'features/billing/server/refund-actions.ts';
saving(REFUND, 'saveRefundRequest', true);
saving(REFUND, 'deleteRefundRequest', true);
const readBilling = async (params: Record<string, string>, fallback: unknown): Promise<unknown> => {
  const q = new URLSearchParams(params); const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/billing?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  return (r?.ok ? await r.json().catch(() => null) : null) ?? fallback;
};
registerHostHandler(REFUND, 'loadRefundStudentOptions', () => readBilling({ refundOptions: '1' }, { error: NOT_SAVED }));
registerHostHandler(REFUND, 'loadRefundPrefill', (studentId, months) =>
  readBilling({ prefill: String(studentId ?? ''), months: months === null ? 'all' : String(months ?? 3) }, { error: NOT_SAVED }));
for (const name of ['issueReceiptUploadTicket', 'addExpenseReceipt', 'removeExpenseReceipt', 'signExpenseReceipts', 'signExpenseReceipt'])
  registerHostHandler(EXPENSE, name, async () => ({ ok: false, error: VIEW_ONLY }));
registerHostHandler(NOTICE, 'loadMyTextbookMent', async () => {
  const q = new URLSearchParams({ ment: '1' }); const actor = hostActor(); if (actor) q.set('viewer', actor);
  const r = await fetch(`/api/v2/billing?${q}`, { headers: { Accept: 'application/json' } }).catch(() => null);
  const body = r?.ok ? ((await r.json().catch(() => null)) as { ment?: unknown } | null) : null;
  return typeof body?.ment === 'string' ? body.ment : DEFAULT_TEXTBOOK_MENT;
});

/** 진입점 표식(build.mjs가 찾는다) — 창 제목과 이 화면의 2.0 주소. */
export const HOST_TITLE = '수납관리';
export const HOST_ROUTE = '/billing';

type Ops = Parameters<typeof OperationsProvider>[0];
type Data = { editors: HostEditor[]; viewer: { id: string; name: string; role: string } | null; route: 'none' | 'page' }
  & Partial<Omit<BillingPageData, 'host'>> & { host: { operations: Ops; disabledModules: Ops['disabledModules'] } }
  // 하위 주소 — 지출결의서 상세(expenses/[id]/page.tsx) · 2.0 requireAccess · notFound 자리.
  & { page?: 'expense' | 'notFound' | 'noAccess' | 'refundNew' | 'refund' | 'redirect'; expense?: ExpenseRow | null; refund?: RefundDetail | null; canWrite?: boolean; to?: string };

/** 2.0 page.tsx · 각 면의 searchParams — 서버가 다시 그리던 열쇠(v2path = 하위 주소). */
const KEYS = ['v2path', 'tab', 'period', 'q', 'sort', 'desc', 'page', 'overdue', 'missing', 'subject', 'only', 'allocation', 'confirmation', 'panel', 'status',
  'active', 'cactive', 'cat', 'cpage', 'cpmode', 'csub', 'grade', 'hm', 'hy', 'qid', 'qpage', 'tsub'] as const;

function App() {
  const search = new URLSearchParams(useHostSearch());
  const [viewer, setViewer] = useState<string | null>(null);
  const sp: Record<string, string | undefined> = {};
  const q = new URLSearchParams();
  for (const k of KEYS) { const v = search.get(k); if (v !== null) { q.set(k, v); if (k !== 'v2path') sp[k] = v; } }
  if (viewer) q.set('viewer', viewer);
  const key = q.toString();
  const [state, setState] = useState<{ key?: string; data?: Data; error?: string }>({});
  const [tick, setTick] = useState(0);
  const drawnFor = useRef<string | null>(null);
  useEffect(() => onHostRefresh(() => setTick((n) => n + 1)), []);
  // 3.0 띠에서 보는 사람을 바꾸면 그 사람의 권한으로 다시 받는다(shim이 먼저 받아 두므로 다음 틱에 읽는다).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent || (e.data as { type?: string } | null)?.type !== 'v2-host-actor') return;
      setTimeout(() => { const next = hostActor(); if (next && next !== drawnFor.current) setViewer(next); }, 0);
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    let live = true;
    fetch(`/api/v2/billing${key ? `?${key}` : ''}`, { headers: { Accept: 'application/json' } })
      .then(async (r) => { const body = await r.json().catch(() => null); if (!r.ok) throw new Error(body?.message || '수납관리를 불러오지 못했습니다.'); return body as Data; })
      .then((data) => {
        if (!live) return;
        setHostEditors(data.editors);
        // 띠에 남아 있던 사람(같은 출처 저장소)이 서버가 고른 사람과 다르면 그 사람으로 한 번 더 받는다.
        const picked = hostActor();
        if (picked && data.viewer && picked !== data.viewer.id && picked !== viewer) { setViewer(picked); return; }
        drawnFor.current = data.viewer?.id ?? null;
        setState({ key, data });
      })
      .catch((e: Error) => live && setState({ key, error: e.message }));
    return () => { live = false; };
  }, [key, tick, viewer]);
  // 2.0도 면·달·검색을 바꾸면 서버를 다시 그린다(loading.tsx) — 다른 조건의 옛 표를 그대로 두지 않는다.
  if (!state.data || state.key !== key) {
    const failed = state.key === key && !!state.error;
    return <HostMessage text={failed ? state.error! : '수납관리를 불러오는 중…'} error={failed} />;
  }
  const d = state.data, ops = d.host.operations;
  if (d.route === 'none' || !d.access) return <HostMessage text="수납관리를 볼 수 있는 직원이 없습니다." />;
  if (d.page === 'noAccess') return <HostMessage text="고른 사람은 이 화면을 볼 수 없습니다." />;
  if (d.page === 'notFound') return <HostMessage text="이 주소의 화면이 없습니다." />;
  // 2.0 expenses/[id]/page.tsx — 본문은 부품 하나(ExpenseDocument)라 그대로 그린다.
  if (d.page === 'expense' && d.expense) return <ExpenseDocument expense={d.expense} />;
  // 2.0 refunds/new · refunds/[id] — 수납 쓰기가 아니면 목록으로(redirect) · userId = 보는 사람.
  if (d.page === 'redirect' && d.to) return <HostRedirect to={d.to} />;
  if ((d.page === 'refundNew' || d.page === 'refund') && d.viewer) {
    const user = { id: d.viewer.id };
    return (
      <EmbedProvider embed>
        <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
          {d.page === 'refundNew' ? <NewRefundPage user={user} /> : d.refund ? <RefundViewPage user={user} refund={d.refund} canWrite={!!d.canWrite} /> : null}
        </OperationsProvider>
      </EmbedProvider>
    );
  }
  return (
    <EmbedProvider embed>
      <OperationsProvider subjects={ops.subjects} gradeLevels={ops.gradeLevels} jobTitles={ops.jobTitles} jobTitlesByDepartment={ops.jobTitlesByDepartment} disabledModules={d.host.disabledModules}>
        <BillingPage d={d as BillingPageData} sp={sp} />
      </OperationsProvider>
    </EmbedProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AppProviders><HostFrame screen="billing"><App /></HostFrame></AppProviders>);
