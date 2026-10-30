// 2.0 화면 — 학원 설정 '팝업 공지' 면: 목록(notices/server/queries.ts listPopups — 비활성 포함 · 번역 상태) ·
// 저장 넷(notices/server/actions.ts createNoticePopup · updateNoticePopup · toggleNoticePopupActive · deleteNoticePopup)을 Docker 복사본에 같은 판정·문구·감사로그로.
// 게이트 = 2.0 gate()(popup_settings 쓰기) · 쓰기 = 2.0 사용자 클라이언트(authenticated + 그 사람 신분 — notice_popups RLS가 2.0처럼 본다).
// ⚠️ 영문 번역(저장 뒤 백그라운드 · [영문 만들기])은 AI 호출이라 이 연습 자료에서 하지 않는다 — 저장은 그대로 되고 번역 상태는 2.0처럼 '없음/옛 번역'으로 보인다.
// ⚠️ 팝업 그림 올리기(파일 저장소)는 받지 않는다(호스트가 '아직 지원하지 않는 저장'으로 답한다). 그림 미리보기도 저장소·바깥 주소면 싣지 않는다(사이트 안 그림 경로만).
import { V2Error } from './v2-screens.mjs';
import { audit, asAuthenticated } from './v2-timetable-save.mjs';
import { UUID } from './v2-mcs-core.mjs';

const bad = () => new V2Error(400, 'invalid_request', '입력 값을 확인해 주세요.');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO = (sql, col) => sql`to_char(${sql(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'`;
const NOT_YET = '연습 자료에서는 아직 지원하지 않는 기능입니다';

let rulesPromise = null;
function loadPopupRules(importV2) {
  rulesPromise ??= (async () => {
    const [audience, translate, dk, dbError, perms] = await Promise.all(['features/notices/audience.ts', 'features/notices/translate-rules.ts', 'lib/date-kst.ts',
      'lib/supabase/db-error.ts', 'lib/permissions.ts'].map(p => importV2(p)));
    return { audience, translate, dk, dbError, perms };
  })().catch(error => { rulesPromise = null; throw error; });
  return rulesPromise;
}

/** listPopups — 활성 먼저 · 우선순위 높은 순 · 최근 만든 순. 번역 상태는 저장된 해시와 지금 원문을 비교(enStatusOf). */
export async function listPopups(sql, t, importV2) {
  const P = await loadPopupRules(importV2);
  const rows = await sql`select id::text id, title, body, image_url, link_url, link_label, audience, width, position, priority, is_active,
      ${ISO(sql, 'starts_at')} starts_at, ${ISO(sql, 'ends_at')} ends_at from public.notice_popups where tenant_id=${t}
    order by is_active desc, priority desc, created_at desc`;
  const tr = rows.length ? await sql.savepoint(s => s`select notice_id::text notice_id, source_hash, skip_reason from public.notice_popup_translations
      where lang='en' and notice_id = any(${rows.map(r => r.id)}::uuid[])`).catch(() => []) : [];
  const byId = new Map(tr.map(r => [r.notice_id, { hash: r.source_hash ?? '', skip: r.skip_reason ?? null }]));
  return rows.map(r => {
    const src = { title: r.title, body: r.body ?? null, linkLabel: r.link_label ?? null }, row = byId.get(r.id);
    let en = { enStatus: 'none', enSkipReason: null };
    if (row) {
      const fresh = row.hash === P.translate.noticeSourceHash(src);
      en = row.skip ? { enStatus: fresh ? 'skipped' : 'none', enSkipReason: fresh ? row.skip : null } : { enStatus: fresh ? 'ready' : 'stale', enSkipReason: null };
    }
    // 그림 = 사이트 안 경로(/…)만 그대로 — 저장소 경로·바깥 주소는 싣지 않는다(복사본 밖 · 바깥 요청).
    const imageSrc = r.image_url && String(r.image_url).startsWith('/') && !String(r.image_url).startsWith('//') ? r.image_url : null;
    return { id: r.id, title: r.title, body: r.body ?? null, imageUrl: r.image_url ?? null, imageSrc, linkUrl: r.link_url ?? null, linkLabel: r.link_label ?? null,
      audience: r.audience, width: r.width ?? 380, position: r.position ?? 'cascade', priority: r.priority ?? 0, isActive: r.is_active ?? true,
      startsAt: r.starts_at ?? null, endsAt: r.ends_at ?? null, ...en };
  });
}

// ── notices/server/actions.ts ─────────────────────────────────────────────────────────────────────────────────────────
function formOf(v) {
  if (!plain(v) || !Array.isArray(v.$formData) || v.$formData.length > 60) throw bad();
  const pairs = v.$formData.map(p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 60 || p[1].length > 20000) throw bad(); return p; });
  return { get: k => pairs.find(p => p[0] === k)?.[1] ?? null };
}
/** readForm — 2.0 그대로(대상 정규화 · 위치 · 폭 280~720 · 우선순위 0~999 · http(s) 링크만 · KST 벽시계 → ISO). */
function readForm(P, formData) {
  const get = k => String(formData.get(k) ?? '').trim();
  const positionRaw = get('position') || 'cascade', linkUrl = get('linkUrl');
  return { id: get('id'), title: get('title'), body: get('body') || null, imageUrl: get('imageUrl') || null,
    linkUrl: linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : null, linkLabel: get('linkLabel') || null, audience: P.audience.normalizeNoticeAudience(get('audience')),
    width: Math.min(720, Math.max(280, Number(get('width')) || 380)), position: P.audience.POPUP_POSITIONS.includes(positionRaw) ? positionRaw : 'cascade',
    priority: Math.max(0, Math.min(999, Math.round(Number(get('priority')) || 0))),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true', startsAt: P.dk.kstLocalToIso(get('startsAt')), endsAt: P.dk.kstLocalToIso(get('endsAt')) };
}
function gate(P, actor) {
  if (!actor) return { error: '로그인이 필요합니다' };
  const level = actor.level('popup_settings');
  return level === 'full' || level === 'scoped' ? null : { error: `${P.perms.MENU_LABEL.popup_settings} 변경 권한이 없습니다` };
}
/** 2.0 사용자 클라이언트 쓰기 — 실패하면 2.0 humanizeDbError 문구. */
async function asUser(sql, actor, fn) {
  await sql`select set_config('v2.actor_claims', ${JSON.stringify({ sub: actor.id, role: 'authenticated' })}, true)`;
  try { return { data: await asAuthenticated(sql, fn) }; }
  catch (e) { return { error: e?.message ?? '' }; }
  finally { await sql`select set_config('v2.actor_claims', '', true)`; }
}
const checkInput = input => (!input.title ? '제목을 입력해주세요' : !input.body && !input.imageUrl ? '본문 또는 이미지를 입력해주세요'
  : (input.body?.length ?? 0) > 8000 ? '본문은 메뉴 참조를 포함해 8,000자까지 입력해 주세요' : null);

async function createNoticePopup(io, actor, [, raw]) {
  const P = await loadPopupRules(io.importV2), denied = gate(P, actor);
  if (denied) return denied;
  const input = readForm(P, formOf(raw)), wrong = checkInput(input);
  if (wrong) return { error: wrong };
  const { error } = await asUser(io.sql, actor, s => s`insert into public.notice_popups ${s({ tenant_id: io.t, title: input.title, body: input.body, image_url: input.imageUrl,
    link_url: input.linkUrl, link_label: input.linkLabel, audience: input.audience, width: input.width, position: input.position, priority: input.priority, is_active: input.isActive,
    starts_at: input.startsAt, ends_at: input.endsAt, author_id: actor.id })} returning id`);
  if (error !== undefined) return { error: P.dbError.humanizeDbError(error, '등록') };
  await audit(io.sql, io.t, actor, 'notice_popup_create', 'notice_popup', {}, input.title);
  return { ok: true }; // 영문 번역(AI)은 하지 않는다
}

async function updateNoticePopup(io, actor, [, raw]) {
  const P = await loadPopupRules(io.importV2), denied = gate(P, actor);
  if (denied) return denied;
  const input = readForm(P, formOf(raw));
  if (!input.id) return { error: '팝업 ID가 누락되었습니다' };
  const wrong = checkInput(input);
  if (wrong) return { error: wrong };
  const { error } = await asUser(io.sql, actor, s => s`update public.notice_popups set ${s({ title: input.title, body: input.body, image_url: input.imageUrl, link_url: input.linkUrl,
    link_label: input.linkLabel, audience: input.audience, width: input.width, position: input.position, priority: input.priority, is_active: input.isActive,
    starts_at: input.startsAt, ends_at: input.endsAt })}, updated_at=now() where id=${UUID.test(input.id) ? input.id : null} and tenant_id=${io.t}`);
  if (error !== undefined) return { error: P.dbError.humanizeDbError(error, '저장') };
  await audit(io.sql, io.t, actor, 'notice_popup_update', 'notice_popup', {}, input.title);
  return { ok: true };
}

async function toggleNoticePopupActive(io, actor, [, raw]) {
  const P = await loadPopupRules(io.importV2), denied = gate(P, actor);
  if (denied) return denied;
  const f = formOf(raw), id = String(f.get('id') ?? '').trim(), isActive = f.get('isActive') === 'true';
  if (!id) return { error: '팝업 ID가 누락되었습니다' };
  const { data, error } = await asUser(io.sql, actor, s => s`update public.notice_popups set is_active=${isActive}, updated_at=now()
    where id=${UUID.test(id) ? id : null} and tenant_id=${io.t} returning title`);
  if (error !== undefined) return { error: P.dbError.humanizeDbError(error, '변경') };
  await audit(io.sql, io.t, actor, 'notice_popup_toggle', 'notice_popup', { active: isActive }, data?.[0]?.title ?? '팝업 공지');
  return { ok: true };
}

async function deleteNoticePopup(io, actor, [, raw]) {
  const P = await loadPopupRules(io.importV2), denied = gate(P, actor);
  if (denied) return denied;
  const id = String(formOf(raw).get('id') ?? '').trim();
  if (!id) return { error: '팝업 ID가 누락되었습니다' };
  const [popup] = UUID.test(id) ? await io.sql`select title from public.notice_popups where id=${id} and tenant_id=${io.t}` : [];
  const { error } = await asUser(io.sql, actor, s => s`delete from public.notice_popups where id=${UUID.test(id) ? id : null} and tenant_id=${io.t}`);
  if (error !== undefined) return { error: P.dbError.humanizeDbError(error, '삭제') };
  await audit(io.sql, io.t, actor, 'notice_popup_delete', 'notice_popup', {}, popup?.title ?? id);
  return { ok: true };
}

/** [영문 만들기] — AI 호출이라 이 연습 자료에서 하지 않는다(게이트는 2.0과 같게 먼저 본다). */
async function regenerateNoticeTranslation(io, actor) {
  const P = await loadPopupRules(io.importV2), denied = gate(P, actor);
  return denied ?? { error: NOT_YET };
}

const MODULE = 'features/notices/server/actions.ts';
export function popupActions(makeIo) {
  const wrap = run => ({
    validate: raw => {
      if (!plain(raw) || raw.module !== MODULE || !Array.isArray(raw.args) || raw.args.length !== 2 || (raw.actor != null && (typeof raw.actor !== 'string' || !UUID.test(raw.actor)))) throw bad();
      formOf(raw.args[1]);
      return { actor: raw.actor ?? null, args: raw.args };
    },
    run: async ({ sql, body, tenantId, importV2 }) => { const io = await makeIo(sql, tenantId, importV2); return run(io, io.viewers.find(v => v.id === body.actor) ?? null, body.args); },
  });
  return { createNoticePopup: wrap(createNoticePopup), updateNoticePopup: wrap(updateNoticePopup), toggleNoticePopupActive: wrap(toggleNoticePopupActive),
    deleteNoticePopup: wrap(deleteNoticePopup), regenerateNoticeTranslation: wrap(regenerateNoticeTranslation) };
}
