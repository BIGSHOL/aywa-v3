// 2.0 학원 설정 makeedu 동기화 카드: 복사본 상태·이력·PC·역동기화 후보만 조회한다.
const iso = value => value == null ? null : new Date(value).toISOString();
const PAGE_SIZE = 8;

export async function loadOwnerMakeedu(sql, t, page, importV2) {
  const currentPage = Math.max(1, Math.min(9999, Number(page) || 1));
  const [setting] = await sql`select sync_enabled from public.user_integrations where tenant_id=${t} and provider='makeedu'`;
  const [latest] = await sql`select synced_at from public.makeedu_sync_state where tenant_id=${t} order by synced_at desc limit 1`;
  const [invoice] = await sql`select synced_at, row_count, status, error from public.makeedu_sync_state where tenant_id=${t} and domain='invoices'`;
  const [{ n: total }] = await sql`select count(*)::int n from public.makeedu_sync_runs where tenant_id=${t}`;
  const runs = await sql`select r.id::text id, r.trigger_source, r.triggered_by::text triggered_by, r.status, r.started_at, r.finished_at,
    r.duration_ms, r.domains, r.failed_domains, r.error, u.display_name triggered_by_name
    from public.makeedu_sync_runs r left join public.users u on u.id=r.triggered_by and u.tenant_id=${t}
    where r.tenant_id=${t} order by r.started_at desc offset ${(currentPage - 1) * PAGE_SIZE} limit ${PAGE_SIZE}`;
  const [lastReq] = await sql`select requested_at from public.makeedu_sync_requests where tenant_id=${t} order by requested_at desc limit 1`;
  const [lastRun] = await sql`select started_at, status from public.makeedu_sync_runs where tenant_id=${t} order by started_at desc limit 1`;
  const inflight = await sql`select status, requested_at, started_at from public.makeedu_sync_requests where tenant_id=${t} and status in ('pending','running') limit 20`;
  const now = Date.now();
  const trigger = Math.max(0, ...[lastReq?.requested_at, lastRun?.started_at].filter(Boolean).map(v => new Date(v).getTime()));
  const fresh = v => !!v && now - new Date(v).getTime() < 30 * 60_000;
  const lock = { busyUntil: trigger ? new Date(trigger + 5 * 60_000).toISOString() : null,
    running: inflight.some(r => r.status === 'pending' || fresh(r.started_at ?? r.requested_at)) ||
      (lastRun?.status === 'running' && fresh(lastRun.started_at)) };
  const workers = await sql`select hostname, last_seen, started_at from public.makeedu_sync_workers where tenant_id=${t} order by last_seen desc`;
  const raw = await sql`select c.id::text id, c.prospect_name, c.prospect_school, c.prospect_grade, c.parent_name, c.parent_phone,
    c.subject, c.consultation_path, c.created_at, c.outcome, s.makeedu_id student_makeedu_id
    from public.enrollment_consultations c left join public.students s on s.id=c.student_id and s.tenant_id=${t}
    where c.tenant_id=${t} and c.from_public_intake=true and c.makeedu_id is null and c.makeedu_pushed_at is null
    order by c.created_at desc limit 50`;
  const pure = await importV2('features/integrations/push-eligibility.ts');
  const candidates = raw.filter(r => pure.isPushableConsultation({ outcome: r.outcome, studentMakeeduId: r.student_makeedu_id }));
  const ids = candidates.map(c => c.id);
  const reqs = ids.length ? await sql`select consultation_id::text consultation_id, status, error from public.makeedu_push_requests
    where tenant_id=${t} and consultation_id = any(${ids}::uuid[]) order by requested_at desc` : [];
  const reqById = new Map(); for (const r of reqs) if (!reqById.has(r.consultation_id)) reqById.set(r.consultation_id, r);
  return {
    status: { enabled: setting?.sync_enabled !== false, lastSyncedAt: iso(latest?.synced_at) },
    invoiceSync: invoice ? { syncedAt: iso(invoice.synced_at), rowCount: invoice.row_count, status: invoice.status, issue: invoice.error || null } : null,
    runs: runs.map(r => ({ id: r.id, triggerSource: r.trigger_source, triggeredByName: r.triggered_by ? r.triggered_by_name || null : null,
      status: r.status, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), durationMs: r.duration_ms,
      domains: r.domains ?? null, failedDomains: r.failed_domains ?? [], error: r.error ?? null })),
    page: currentPage, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), lock,
    workers: workers.map(w => ({ hostname: w.hostname, lastSeen: iso(w.last_seen), startedAt: iso(w.started_at), online: now - new Date(w.last_seen).getTime() < 150_000 })),
    candidates: candidates.map(c => { const req = reqById.get(c.id); return { id: c.id, prospectName: c.prospect_name, prospectSchool: c.prospect_school,
      prospectGrade: c.prospect_grade, parentName: c.parent_name, parentPhone: c.parent_phone, subject: c.subject,
      consultationPath: c.consultation_path, createdAt: iso(c.created_at), outcome: c.outcome,
      pushStatus: req && !['done', 'skipped'].includes(req.status) ? req.status : null, pushError: req?.error ?? null,
      note: pure.pushEligibilityNote({ outcome: c.outcome, studentMakeeduId: c.student_makeedu_id }) }; }),
  };
}
