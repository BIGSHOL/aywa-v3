// 2.0 화면 — 학원 설정 '연동' 면: 면 구성(integrations-face.tsx — 켜진 연동만 탭) · 과목별 구글 시트 상태(integrations/server/queries.ts getGoogleSheetsStatus) ·
// 시트 저장 둘(integrations/server/actions.ts setSheetsExportEnabled · setSubjectSheetTarget)을 Docker 복사본에 같은 판정·문구·감사로그로.
// 업무 흐름 신호 `sheet-sync-error`(켜진 연결에 오류가 남음)의 처리 화면이 여기다 — 내보내기를 끄면(sync_enabled=false) 신호의 근거가 사라진다.
// ⚠️ 시트로 실제 보내기(syncSheetsNow — 구글 API)는 바깥 요청이라 이 연습 화면에서 하지 않는다(시간표 화면의 버튼이 2.0 거절 모양으로 답한다).
// ⚠️ 서비스계정 이메일은 서버 환경값이라 복사본에 없다(2.0처럼 '서비스계정 키 미설정' 안내가 선다).
import { V2Error } from './v2-screens.mjs';
import { audit, asAuthenticated } from './v2-timetable-save.mjs';
import { UUID } from './v2-mcs-core.mjs';
import { loadOwnerSlack } from './v2-owner-slack.mjs';
import { loadOwnerVideo } from './v2-owner-video.mjs';
import { loadOwnerAgent } from './v2-owner-agent.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;
const SUBJECTS = ['math', 'english']; // 2.0 SHEET_EXPORT_SUBJECTS — verify가 원문과 대조한다
const providerOf = subject => (subject === 'math' ? 'google_sheets' : `google_sheets:${subject}`); // 2.0 sheetsProvider

/** tenant_licenses 한 줄 — 2.0 isFeatureLicensed(행 없음 = 허용) · isFeatureOptedIn(켠 행이 있을 때만). */
async function license(sql, t, feature) {
  const [row] = await sql`select is_active, expires_at::text expires_at from public.tenant_licenses where tenant_id=${t} and feature=${feature}`.catch(() => [undefined]);
  const live = row && row.is_active !== false && (!row.expires_at || row.expires_at >= new Date().toISOString());
  return { licensed: !row || !!live, optedIn: !!row && row.is_active === true && !!live };
}

/** integrations-face.tsx의 켜진 연동 탭 — 슬랙(지점 스위치 ∧ 연동 설정 열람) · makeedu · 구글 시트(모듈 ∧ 라이선스) · 숙제영상(ClassNote) · 연동 PC · 오늘 수학. */
export async function integrationsView(sql, t, R, settings, viewer, sp, importV2) {
  const on = id => !settings.modules.disabled.includes(id);
  const [slack, sheetsLic, math] = await Promise.all([license(sql, t, 'slack'), license(sql, t, 'google_sheets'), license(sql, t, 'todays_math')]);
  const integ = viewer.level('integration_settings');
  // 연동 PC 탭 = 원장·관리자 ∧ 연동 설정 쓰기 ∧ (makeedu 또는 ClassNote 모듈 · 아니면 연결된 PC가 있을 때) — 2.0 agentTabAvailable(requireManager)
  const manager = ['master', 'admin'].includes(viewer.systemRole) && (integ === 'full' || integ === 'scoped');
  const agentOn = manager && (on('makeedu') || on('classnote')
    || (await sql`select exists(select 1 from public.sync_agent_devices where tenant_id=${t} and revoked_at is null) present`.catch(() => [{ present: false }]))[0].present === true);
  const available = [
    ...(slack.optedIn && integ !== 'none' ? ['slack'] : []), ...(on('makeedu') ? ['makeedu'] : []), ...(on('sheet_sync') && sheetsLic.licensed ? ['sheets'] : []),
    ...(on('classnote') ? ['video'] : []), ...(agentOn ? ['agent'] : []), ...(math.optedIn ? ['todaysMath'] : []),
  ];
  const rows = await sql`select provider, spreadsheet_id, ${ISO(sql, 'last_synced_at')} last_synced_at, last_error, sync_enabled from public.user_integrations
    where tenant_id=${t} and provider = any(${SUBJECTS.map(providerOf)})`;
  // getGoogleSheetsStatus — 수학은 옛 설정(notifications.googleSheetId)을 대상 시트로 함께 본다.
  const sheetStatuses = SUBJECTS.map(subject => {
    const row = rows.find(r => r.provider === providerOf(subject));
    const fallbackId = subject === 'math' ? (String(settings.notifications?.googleSheetId ?? '').trim() || null) : null;
    const spreadsheetId = row?.spreadsheet_id || fallbackId;
    return { connected: !!spreadsheetId, enabled: row?.sync_enabled === true, spreadsheetId, lastSyncedAt: row?.last_synced_at ?? null, lastError: row?.last_error ?? null };
  });
  const wanted = sp.sub ?? (Number(sp.page) > 1 ? 'makeedu' : '');
  const active = available.includes(wanted) ? wanted : available[0];
  const slackState = active === 'slack' ? await loadOwnerSlack(sql, t, viewer, importV2) : null;
  const video = active === 'video' ? await loadOwnerVideo(sql, t, viewer).catch(() => null) : null;
  const agent = active === 'agent' && sp.read === 'agent_dashboard' ? await loadOwnerAgent(sql, t, sp, settings) : null;
  return { available, sheetStatuses, saEmail: null, slack: slackState, video, agent };
}

// ── integrations/server/actions.ts ─────────────────────────────────────────────────────────────────────────────────────
const MODULE_OFF_MSG = '사용할 수 없는 기능입니다';
const INTEG_LABEL = '연동 설정'; // 2.0 MENU_LABEL.integration_settings — verify가 대조한다
async function gate(io, actor, subject) {
  if (!actor) return { error: '로그인이 필요합니다' };
  if (!SUBJECTS.includes(subject)) return { error: '지원하지 않는 과목입니다' };
  const level = actor.level('integration_settings');
  if (level !== 'full' && level !== 'scoped') return { error: `${INTEG_LABEL} 변경 권한이 없습니다` };
  if (io.settings.modules.disabled.includes('sheet_sync')) return { error: MODULE_OFF_MSG };
  return null;
}
/** subjectLabelForAudit — 과목 한글 라벨(설정 단일 소스)을 저장 시점에 굳힌다. 못 풀면 라벨 없이. */
function subjectLabel(io, subject) {
  const s = io.settings.operations.subjects.find(x => x.key === subject);
  return s?.label && s.label !== subject ? ` · ${s.label}` : '';
}
/** 2.0 사용자 클라이언트 upsert(user_integrations — RLS tenant 격리) — 그 사람 신분 + authenticated로. */
async function upsertAsUser(sql, actor, row, col) {
  await sql`select set_config('v2.actor_claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  try {
    await asAuthenticated(sql, s => s`insert into public.user_integrations ${s(row)} on conflict (tenant_id, provider) do update set ${s(col)} = excluded.${s(col)}`);
    return null;
  } catch (e) { return e?.message ?? '저장하지 못했습니다'; }
  finally { await sql`select set_config('v2.actor_claims', '', true)`; }
}

async function setSheetsExportEnabled(io, actor, [subject, enabled]) {
  if (typeof enabled !== 'boolean') throw bad();
  const denied = await gate(io, actor, String(subject ?? ''));
  if (denied) return denied;
  const error = await upsertAsUser(io.sql, actor, { tenant_id: io.t, provider: providerOf(subject), sync_enabled: enabled }, 'sync_enabled');
  if (error) return { error };
  await audit(io.sql, io.t, actor, 'integration_sheets_toggle', 'integration', { subject, enabled }, `구글 시트 내보내기${subjectLabel(io, subject)}`);
  return { enabled };
}

async function setSubjectSheetTarget(io, actor, [subject, spreadsheetId]) {
  if (typeof spreadsheetId !== 'string' || spreadsheetId.length > 200) throw bad();
  const denied = await gate(io, actor, String(subject ?? ''));
  if (denied) return denied;
  const error = await upsertAsUser(io.sql, actor, { tenant_id: io.t, provider: providerOf(subject), spreadsheet_id: spreadsheetId.trim() || null }, 'spreadsheet_id');
  if (error) return { error };
  // 시트 ID(외부 문서 식별자)는 값을 남기지 않는다 — 지정/해제 사실만(2.0 그대로).
  await audit(io.sql, io.t, actor, 'integration_sheet_target', 'integration', { subject, cleared: spreadsheetId.trim() === '' }, `구글 시트 대상${subjectLabel(io, subject)}`);
  return { ok: true };
}

const MODULE = 'features/integrations/server/actions.ts';
export function integrationActions(makeIo) {
  const wrap = (run, arity) => ({
    validate: raw => {
      if (!plain(raw) || raw.module !== MODULE || !Array.isArray(raw.args) || raw.args.length !== arity || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      return { actor: raw.actor ?? null, args: raw.args };
    },
    run: async ({ sql, body, tenantId, importV2 }) => { const io = await makeIo(sql, tenantId, importV2); return run(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args); },
  });
  return { setSheetsExportEnabled: wrap(setSheetsExportEnabled, 2), setSubjectSheetTarget: wrap(setSubjectSheetTarget, 2) };
}
