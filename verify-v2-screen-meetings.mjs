// 2.0 화면 — 회의록 시험 (Docker 복사본 · 네트워크·AI·전사 없음).
//   node --test experiments/owner-concept/verify-v2-screen-meetings.mjs
// ① 그리기 = 2.0 page.tsx 셋(목록·상세·새 회의록) 본문 그대로(서버 호출 자리만 swaps 짝 — 글자 대조)
// ② 목록·상세 = 독립 SQL(전체·완료·처리 중 · 최신순 · 쪽 · 상태 · 기간 · 검색(제목·참석자·요약·전사) · 상세 칸 · 직원 선택지 · 없는 회의록)
// ③ 저장 = 2.0 함수 그대로(제목 · 메모장 · AI 분석 섹션 · 화자 · 메모만으로 새 회의록 · 삭제) — 시험이 만든 회의록만, 러너 되돌림 트랜잭션 안에서
//    표·칸·감사로그 확인 → 끝나면 남은 행 0 · 쓰기 뒤 역할·claims 원래대로 · 바깥 요청 큐 증가 0
// ④ AI·전사·업로드는 보내지 않는다 · 매개변수 거절 · 화면 글자에 '2.0'·내부 이름이 없다 · 껍데기 주소 actor 규칙.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { screen, PAGE_SIZE, WRITES, runWrite } from './v2-screen-meetings.mjs';
import { stopV2Server } from './v2-server-runner.mjs';

const src = (p) => readFile(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const here = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
/** 코드에서 주석을 뺀 글자(화면 글자 검사용). */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const A = 'features/meetings/server/actions.ts';

let db = null;
try { const { openFullDatabase } = await import('./full-db.mjs'); db = await openFullDatabase(); await db`select 1`; } catch { db = null; }
const SKIP = !db && 'local database not running';
after(async () => { await stopV2Server(); await db?.end(); });

if (db) {
  var { tenantId: t } = await import('./full-db.mjs');
  var { importV2 } = await import('./v2-bridge.mjs');
  var run = (fn) => db.begin('isolation level repeatable read read only', fn);
  var load = (params) => run((sql) => screen.load({ sql, params, tenantId: t, importV2 }));
  var ids = (rows) => rows.map((r) => r.id);
  /** 독립 SQL — 2.0 getMeetingsPage의 '가벼운 행' 순서(held_at desc, id asc). */
  var allRows = () => db`select id::text id, title, ai_summary, processing_status::text status, held_at,
      coalesce((select array_agg(x) from (select case when jsonb_typeof(e) = 'string' then e #>> '{}' when jsonb_typeof(e) = 'object' then coalesce(e->>'name', '') else '' end x
        from jsonb_array_elements(case when jsonb_typeof(attendees) = 'array' then attendees else '[]'::jsonb end) e) a where btrim(x) <> ''), '{}') attendees,
      transcription
    from public.meeting_minutes where tenant_id = ${t} order by held_at desc, id asc`;
}

// ── ① 그리기 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const swapCheck = async (srcPath, minePath, swapsPath, start, gone, mineStart = start) => {
  const orig = lf(await src(srcPath)), mine = lf(await here(minePath)), swaps = JSON.parse(await here(swapsPath));
  let body = orig.slice(orig.indexOf(start));
  assert.ok(orig.includes(start), start);
  for (const [from, to] of swaps.page) { assert.equal(body.split(from).length, 2, from); body = body.replace(from, () => to); }
  assert.equal(swaps.removed.length, 0);
  assert.ok(mine.includes(mineStart), mineStart);
  assert.equal(mine.slice(mine.indexOf(mineStart)), body);
  assert.ok(!/\bawait\b/.test(code(body)), '본문 코드에 await가 남았다');
  for (const name of gone) assert.ok(!new RegExp(`\\b${name}\\b`).test(code(body)), `${name}이 남았다`);
};
test('그리기 = 2.0 page.tsx 셋 본문 그대로 — 서버 호출 자리만 swaps 짝(짝마다 한 번)', async () => {
  await swapCheck('app/(shell)/meetings/page.tsx', './v2-host/src/meetings-page.tsx', './v2-host/src/meetings-page.swaps.json', 'const PAGE_SIZE = 50;', ['requireAccess', 'getMeetingsPage']);
  await swapCheck('app/(shell)/meetings/[id]/page.tsx', './v2-host/src/meetings-detail.tsx', './v2-host/src/meetings-detail.swaps.json', '/** 목록(page.tsx)과 같은 의미색 캐논',
    ['requireAccess', 'getMeetingById', 'getStaffOptions', 'notFound']);
  await swapCheck('app/(shell)/meetings/new/page.tsx', './v2-host/src/meetings-new.tsx', './v2-host/src/meetings-new.swaps.json', 'export default async function NewMeetingPage', ['requireAccess'], 'export function NewMeetingPage');
  // 2.0 page.tsx의 PAGE_SIZE와 서버가 쓰는 쪽 크기가 같다.
  assert.match(lf(await src('app/(shell)/meetings/page.tsx')), new RegExp(`const PAGE_SIZE = ${PAGE_SIZE};`));
});

// ── ② 목록 · 상세 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('목록 = 독립 SQL — 머리 숫자(전체·완료·처리 중) · 최신순 · 1쪽·2쪽(50건) · 상태 · 기간 · 작성자 · 녹음', { skip: SKIP }, async () => {
  const rows = await allRows();
  assert.ok(rows.length > PAGE_SIZE, '시험하려면 회의록이 한 쪽보다 많아야 한다');
  const d = await load({});
  assert.equal(d.page, 'list'); assert.equal(d.result.ok, true);
  assert.equal(d.result.total, rows.length);
  assert.deepEqual(d.result.counts, { all: rows.length, completed: rows.filter((r) => r.status === 'completed').length,
    inProgress: rows.filter((r) => r.status === 'transcribing' || r.status === 'analyzing').length });
  assert.deepEqual(ids(d.result.rows), ids(rows.slice(0, PAGE_SIZE)));
  const p2 = await load({ page: '2' });
  assert.deepEqual(ids(p2.result.rows), ids(rows.slice(PAGE_SIZE, PAGE_SIZE * 2)));
  // 행 칸 — 작성자 · 녹음 · 참석(정규화) · 상태.
  const [ref] = await db`select m.id::text id, u.display_name author, m.audio_path is not null has_audio from public.meeting_minutes m left join public.users u on u.id = m.author_id where m.id = ${d.result.rows[0].id}`;
  assert.equal(d.result.rows[0].authorName, ref.author); assert.equal(d.result.rows[0].hasAudio, ref.has_audio);
  for (const r of d.result.rows) assert.deepEqual(r.attendees, rows.find((x) => x.id === r.id).attendees);
  const idle = await load({ status: 'idle' });
  assert.deepEqual(ids(idle.result.rows), ids(rows.filter((r) => r.status === 'idle')));
  const [{ n30 }] = await db`select count(*)::int n30 from public.meeting_minutes where tenant_id = ${t} and now() - held_at <= interval '30 days'`;
  assert.equal((await load({ range: '30d' })).result.total, n30);
  const [{ nm }] = await db`select count(*)::int nm from public.meeting_minutes where tenant_id = ${t}
    and to_char(held_at at time zone 'Asia/Seoul', 'YYYY-MM') = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')`;
  assert.equal((await load({ range: 'month' })).result.total, nm);
});

test('검색 = 제목 · 참석자 · AI 요약(대소문자 무시) + 전사 원문 — 독립 SQL', { skip: SKIP }, async () => {
  const rows = await allRows();
  for (const q of ['회의', '수학', 'ai']) {
    const term = q.toLowerCase();
    const want = rows.filter((r) => r.title.toLowerCase().includes(term) || r.attendees.some((a) => a.toLowerCase().includes(term))
      || (r.ai_summary ?? '').toLowerCase().includes(term) || (r.transcription ?? '').toLowerCase().includes(term));
    const d = await load({ q });
    assert.equal(d.result.total, want.length, q);
    assert.deepEqual(ids(d.result.rows), ids(want.slice(0, PAGE_SIZE)), q);
  }
});

test('상세 = 독립 SQL — 칸 · AI 분석 문서 · 화자 · 모델 · 직원 선택지(전사 있을 때만) · 없는 회의록', { skip: SKIP }, async () => {
  const [m] = await db`select id::text id, title, content, transcription, speaker_labels, ai_report, ai_speaker_roles, speaker_staff, ai_model_version, audio_duration_sec, processing_status::text status
    from public.meeting_minutes where tenant_id = ${t} and speaker_labels is not null and ai_report is not null order by held_at desc limit 1`;
  const d = await load({ v2path: `/meetings/${m.id}` });
  assert.equal(d.page, 'detail');
  const x = d.meeting;
  assert.equal(x.id, m.id); assert.equal(x.title, m.title); assert.equal(x.content, m.content); assert.equal(x.transcription, m.transcription);
  assert.deepEqual(x.speakerLabels, m.speaker_labels); assert.deepEqual(x.aiReport, m.ai_report); assert.deepEqual(x.aiSpeakerRoles, m.ai_speaker_roles);
  assert.deepEqual(x.speakerStaff, m.speaker_staff); assert.equal(x.aiModelVersion, m.ai_model_version); assert.equal(x.audioDurationSec, m.audio_duration_sec);
  assert.equal(x.processingStatus, m.status);
  const staff = await db`select id::text id from public.users where tenant_id = ${t} and status::text <> 'inactive' order by display_name`;
  assert.deepEqual(d.staffOptions.map((s) => s.id).sort(), ids(staff).sort());
  const [noText] = await db`select id::text id from public.meeting_minutes where tenant_id = ${t} and transcription is null limit 1`;
  if (noText) assert.deepEqual((await load({ v2path: `/meetings/${noText.id}` })).staffOptions, []);
  assert.equal((await load({ v2path: '/meetings/00000000-0000-4000-8000-000000000000' })).page, 'missing');
  const n = await load({ v2path: '/meetings/new' });
  assert.equal(n.page, 'new'); assert.equal(n.viewer.tenantId, t); assert.ok(n.editors.some((e) => e.id === n.viewer.id));
});

test('보는 사람 = 회의록 메뉴가 열린 재직 직원 · 주소 actor면 그 사람 · 명단 밖이면 첫 사람 · 라이선스는 행이 있는 것만', { skip: SKIP }, async () => {
  const d = await load({});
  assert.ok(d.editors.length > 0);
  const second = d.editors[1] ?? d.editors[0];
  assert.equal((await load({ v2path: '/meetings/new', actor: second.id })).viewer.id, second.id);
  assert.equal((await load({ v2path: '/meetings/new', actor: '00000000-0000-4000-8000-000000000000' })).viewer.id, d.editors[0].id);
  const lic = await db`select feature from public.tenant_licenses where tenant_id = ${t} and feature = any(${['ai_analysis', 'meeting_recording']})`.catch(() => []);
  assert.deepEqual(Object.keys(d.licenses).sort(), lic.map((r) => r.feature).sort());
});

test('매개변수 거절', () => {
  const ok = (k, v) => screen.params[k].test(v);
  assert.ok(ok('v2path', '/meetings/new') && ok('v2path', '/meetings/0b6d5c1e-0000-4000-8000-000000000000') && ok('v2path', '/meetings'));
  assert.ok(!ok('v2path', '/meetings/0b6d5c1e-0000-4000-8000-000000000000/print') && !ok('v2path', '/students'));
  assert.ok(ok('range', '7d') && !ok('range', '1y') && ok('status', 'processing') && !ok('status', 'uploaded'));
  assert.ok(!ok('page', '-1') && !ok('actor', 'x') && !ok('q', 'x'.repeat(101)));
});

// ── ④ 바깥 · 화면 글자 ───────────────────────────────────────────────────────────────────────────────────────────────────
test('AI·전사·업로드는 보내지 않는다 — 진입점이 그 자리에서 거절 · 서버도 받지 않는다', async () => {
  const entry = await here('./v2-host/src/meetings.tsx');
  for (const name of ['regenerateMeetingAnalysis', 'retryMeetingProcessing', 'startMeetingFromAudio']) {
    assert.ok(entry.includes(`'${name}'`), name);
    assert.ok(!(name in screen.actions), `서버가 ${name}을 받는다`);
  }
  assert.match(entry, /registerHostHandler\('features\/media\/server\/upload-actions\.ts', 'issueAudioUploadTicket', notSupported\)/);
  assert.deepEqual(Object.keys(screen.actions).sort(), [...WRITES].sort());
  // 2.0 actions.ts에 그 이름이 다 있다(이름이 어긋나면 호스트가 '지원하지 않는 저장'으로 떨어진다).
  const act = await src(A);
  for (const name of WRITES) assert.match(act, new RegExp(`export async function ${name}\\(`), name);
});

test('화면 글자 — 2.0·내부 이름이 보이지 않는다 · 껍데기는 운영 주소·쓰기 요청이 없다', async () => {
  const shell = await here('./v2-screen-meetings.js'), entry = await here('./v2-host/src/meetings.tsx');
  const heads = await Promise.all(['meetings-page.tsx', 'meetings-detail.tsx', 'meetings-new.tsx'].map((f) => here(`./v2-host/src/${f}`)));
  for (const [name, text] of [['껍데기', shell], ['진입점', entry], ...heads.map((h, i) => [`조립${i}`, h])]) {
    const c = code(text);
    assert.ok(!/['"`][^'"`\n]*2\.0[^'"`\n]*['"`]/.test(c), `${name}: 화면 글자에 2.0`);
    for (const lit of c.match(/(['"`])(?:(?!\1)[^\n])*[가-힣](?:(?!\1)[^\n])*\1/g) ?? [])
      assert.ok(!/Docker|복사본|[a-z]+_[a-z_]+|\bget[A-Z]\w+|\bv2-|claude|deepseek/i.test(lit), `${name}: 내부 이름 ${lit}`);
  }
  assert.ok(!/https?:\/\//.test(code(shell)), '껍데기에 바깥 주소');
  assert.ok(!/method:\s*['"]POST/.test(shell), '껍데기에서 쓰기 요청');
  // 진입점의 쓰기 요청은 삭제 하나뿐(2.0 redirect를 호스트 이동으로 받으려고 직접 보낸다) — 보기 경로엔 없다.
  assert.equal((entry.match(/method:\s*['"]POST/g) ?? []).length, 1, '진입점 쓰기 요청 = 삭제 하나');
  assert.ok(/fetch\(`\/api\/v2\/\$\{SCREEN\}\/deleteMeeting`/.test(entry));
  // 창 표식(embed=1)은 조회에 싣지 않는다 — 2.0 WindowLink로 행을 누르면 붙어 온다(실으면 400 — 실제로 났다).
  assert.match(entry, /q\.delete\('embed'\);/);
  assert.match(code(screen.load.toString()), /readCall/); // 보기는 러너 읽기(read only)로만
});

test('3.0 껍데기: 주소의 actor가 고른 사람보다 먼저 이긴다 · 호스트 주소로는 안 간다 · 명단 밖 id는 무시 · 명단보다 먼저 와도 저장하는 사람으로 기억', async () => {
  const vm = await import('node:vm');
  const text = await here('v2-screen-meetings.js');
  let def = null, onMessage = null, frame = null;
  const posted = [], last = () => JSON.parse(JSON.stringify(posted.at(-1))), stored = new Map(), actorSlot = { innerHTML: '' };
  const cw = { postMessage: (m) => posted.push(m) };
  const slot = { style: {}, getBoundingClientRect: () => ({ top: 100, left: 20, width: 900, height: 600 }) };
  const document = {
    createElement: () => (frame = { style: {}, dataset: {}, hidden: true, contentWindow: cw, src: '' }),
    body: { append() {} }, querySelector: (sel) => (sel.includes('[data-v2-host-slot]') ? slot : sel.includes('[data-v2h-actor-slot]') ? actorSlot : null),
  };
  const A0 = '00000000-1111-4111-8111-111111111111', A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222', ID = '33333333-3333-4333-8333-333333333333';
  stored.set('v2-host-actor:meetings', A0); // 예전에 고른 사람
  const ctx = {
    window: { V2Screens: { register: (x) => { def = x; }, esc: (s) => String(s ?? '') } }, document, innerHeight: 800, scrollX: 0, scrollY: 0,
    location: { origin: 'http://127.0.0.1:4335', hash: `#v2-meetings?v2path=/meetings/${ID}&actor=${A2}`, replace() {} },
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; },
    requestAnimationFrame: (fn) => fn(), MutationObserver: class { observe() {} },
    fetch: () => Promise.resolve({ ok: true }), HTMLSelectElement: class {}, URLSearchParams,
  };
  vm.runInNewContext(text, ctx);
  const api = { render() {}, toast() {}, canOpenRecord: () => false };
  // 주소 actor가 명단보다 먼저 온다 — 명단이 오면 그 사람을 기억해 호스트 저장(hostActor = 기억 먼저)도 그 사람으로.
  def.render({ api, query: new URLSearchParams(`v2path=/meetings/${ID}&actor=${A2}`) });
  await new Promise((r) => setTimeout(r, 0));
  def.render({ api, query: new URLSearchParams(`v2path=/meetings/${ID}&actor=${A2}`) });
  onMessage({ origin: ctx.location.origin, source: cw, data: { type: 'v2-host-editors', screen: 'meetings', editors: [{ id: A0, name: '원장' }, { id: A1, name: '김그린' }, { id: A2, name: '이하나' }] } });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A2 });
  assert.equal(stored.get('v2-host-actor:meetings'), A2, '명단을 받은 뒤 주소의 사람을 기억');
  assert.ok(frame.src.includes(`v2path=%2Fmeetings%2F${ID}`) && !frame.src.includes('actor='), '상세 주소는 가고 actor는 안 간다');
  ctx.location.hash = `#v2-meetings?actor=${A1}`;
  def.render({ api, query: new URLSearchParams(`actor=${A1}`) });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A1 }); assert.equal(stored.get('v2-host-actor:meetings'), A1);
  ctx.location.hash = '#v2-meetings?actor=44444444-4444-4444-8444-444444444444';
  def.render({ api, query: new URLSearchParams('actor=44444444-4444-4444-8444-444444444444') });
  assert.deepEqual(last(), { type: 'v2-host-actor', id: A1 }, '명단 밖 id는 무시하고 앞 사람 그대로');
  assert.equal(stored.get('v2-host-actor:meetings'), A1);
});

// ── ③ 저장 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const fd = (o) => ({ $formData: Object.entries(o) });
const MARK = `시험회의-${process.pid}-${Date.now()}`;
const idRef = { $sql: `select id::text from public.meeting_minutes where title like '${MARK}%' order by created_at limit 1` };

test('저장 검사(validate) — 2.0 모듈 · 인자 둘 · FormData 모양만 · 고른 사람 id 모양', () => {
  const v = (raw) => screen.actions.updateMeetingTitle.validate(raw);
  assert.deepEqual(v({ module: A, actor: null, args: [null, fd({ id: 'x', title: 'y' })] }).args[1], fd({ id: 'x', title: 'y' }));
  assert.throws(() => v({ module: 'features/enrollment/server/actions.ts', actor: null, args: [null, fd({})] }), '다른 모듈');
  assert.throws(() => v({ module: A, actor: null, args: [null] }), '인자 하나');
  assert.throws(() => v({ module: A, actor: null, args: [null, { id: 'x' }] }), 'FormData 모양 아님');
  assert.throws(() => v({ module: A, actor: 'bad', args: [null, fd({})] }), '사람 id 모양');
  assert.throws(() => v({ module: A, actor: null, args: [null, fd({ content: 'x'.repeat(600 * 1024) })] }), '너무 큼');
});

test('저장 = 2.0 함수 그대로 — 메모만으로 새 회의록 → 제목 · 메모장 · AI 분석 섹션 · 화자 · 삭제 · 감사로그 · 신분 원래대로 · 바깥 요청 0 · 남은 행 0', { skip: SKIP }, async () => {
  const people = await load({});
  const actor = people.editors[0];
  const [staff] = await db`select id::text id from public.users where tenant_id = ${t} and status::text = 'active' limit 1`;
  const heldAt = '2026-10-20T01:30:00.000Z';
  const mapping = JSON.stringify({ A: { label: '김원장', staffId: staff.id }, B: { label: '  ', staffId: null } });
  const { results, probes } = await runWrite(t, actor.id, [
    { module: A, fn: 'createTextMeeting', args: [null, fd({ title: MARK, attendees: '가, 나 ,', heldAt, notepad: '첫 메모' })] },
    { module: A, fn: 'updateMeetingTitle', args: [null, { $formData: [['id', idRef], ['title', `${MARK} 고침`]] }] },
    { module: A, fn: 'updateMeetingNotepad', args: [null, { $formData: [['id', idRef], ['content', '고친 메모']] }] },
    { module: A, fn: 'updateMeetingReportSection', args: [null, { $formData: [['id', idRef], ['key', 'summary'], ['content', '  사람이 쓴 요약  ']] }] },
    { module: A, fn: 'updateMeetingReportSection', args: [null, { $formData: [['id', idRef], ['key', 'bogus'], ['content', 'x']] }] },
    { module: A, fn: 'updateMeetingSpeakers', args: [null, { $formData: [['id', idRef], ['mapping', mapping]] }] },
    { module: A, fn: 'updateMeetingTitle', args: [null, { $formData: [['id', idRef], ['title', '   ']] }] },
  ], {
    rollback: true, allowRefs: true, probes: [
      { text: `select title, content, attendees, held_at = $2::timestamptz same_time, author_id::text author, processing_status::text status, audio_path, ai_report, ai_report_edited_by,
          ai_speaker_roles, speaker_staff from public.meeting_minutes where tenant_id = $1 and title like $3`, params: [t, heldAt, `${MARK}%`] },
      { text: `select action, actor_id::text actor, target_type, target_label, metadata from public.audit_logs where tenant_id = $1 and metadata->>'meetingId' = (${idRef.$sql}) order by created_at, action`, params: [t] },
      { text: `select current_user u, coalesce(current_setting('request.jwt.claims', true), '') c` },
    ],
  });
  const [created, title, note, section, badSection, speakers, emptyTitle] = results.map((r) => r.value);
  assert.ok(created?.id); assert.deepEqual(title, { ok: true }); assert.deepEqual(note, { ok: true, content: '고친 메모' });
  assert.equal(section.ok, true); assert.equal(section.editedBy, actor.name);
  assert.deepEqual(badSection, { error: '잘못된 섹션입니다' }); assert.deepEqual(speakers, { ok: true }); assert.deepEqual(emptyTitle, { error: '제목을 입력해주세요' });
  const [[row], logs, [who]] = probes;
  assert.equal(row.title, `${MARK} 고침`); assert.equal(row.content, '고친 메모'); assert.deepEqual(row.attendees, ['가', '나']); assert.equal(row.same_time, true);
  assert.equal(row.author, actor.id); assert.equal(row.status, 'idle'); assert.equal(row.audio_path, null);
  assert.deepEqual(row.ai_report, { summary: '사람이 쓴 요약' }); assert.equal(row.ai_report_edited_by, actor.name);
  assert.deepEqual(row.ai_speaker_roles, { A: '김원장' }); assert.deepEqual(row.speaker_staff, { A: staff.id });
  assert.deepEqual(logs.map((l) => l.action).sort(), ['meeting_create_text', 'meeting_report_edit', 'meeting_speakers_update', 'meeting_title_update']);
  for (const l of logs) { assert.equal(l.actor, actor.id); assert.equal(l.target_type, 'meeting'); assert.equal(l.metadata.via, '3.0 연습 복사본'); }
  const log = (a) => logs.find((l) => l.action === a).metadata;
  assert.deepEqual({ ...log('meeting_create_text'), meetingId: undefined }, { meetingId: undefined, via: '3.0 연습 복사본', notepadChars: 4, attendees: 2, heldAt: '2026-10-20' });
  assert.equal(log('meeting_title_update').from, MARK);
  assert.deepEqual({ section: log('meeting_report_edit').section, chars: log('meeting_report_edit').chars }, { section: 'summary', chars: '사람이 쓴 요약'.length });
  assert.deepEqual({ s: log('meeting_speakers_update').speakers, l: log('meeting_speakers_update').linked }, { s: 1, l: 1 });
  assert.equal(who.u, 'clone_admin', '쓰기 뒤 역할이 원래대로'); assert.equal(who.c, '', '쓰기 뒤 claims가 원래대로');
  const [{ n }] = await db`select count(*)::int n from public.meeting_minutes where tenant_id = ${t} and title like ${`${MARK}%`}`;
  assert.equal(n, 0, '남은 행 0');
});

test('삭제 = 2.0 deleteMeeting — 행 삭제 · 감사로그(지우기 전 값 · 전사 본문 없음) · 성공 = 목록 주소 · 없는 회의록 거절 · 남은 행 0', { skip: SKIP }, async () => {
  const actor = (await load({})).editors[0];
  const { results, probes } = await runWrite(t, actor.id, [
    { module: A, fn: 'createTextMeeting', args: [null, fd({ title: MARK, attendees: '', heldAt: '2026-10-21T00:00:00.000Z', notepad: '지울 메모' })] },
    { module: A, fn: 'deleteMeeting', args: [null, { $formData: [['id', idRef], ['redirectTo', '/meetings']] }] },
    { module: A, fn: 'deleteMeeting', args: [null, fd({ id: '00000000-0000-4000-8000-000000000000', redirectTo: '/meetings' })] },
  ], { rollback: true, allowRefs: true, probes: [
    { text: `select count(*)::int n from public.meeting_minutes where tenant_id = $1 and title like $2`, params: [t, `${MARK}%`] },
    { text: `select metadata from public.audit_logs where tenant_id = $1 and action = 'meeting_delete' and target_label = $2`, params: [t, MARK] },
  ] });
  assert.deepEqual(results[1], { redirect: '/meetings' });
  assert.deepEqual(results[2].value, { error: '회의록을 찾을 수 없습니다' });
  const [[{ n }], [log]] = probes;
  assert.equal(n, 0);
  assert.equal(log.metadata.hadAudio, false); assert.equal(log.metadata.audioRemoved, false); assert.equal(log.metadata.transcriptChars, 0); assert.equal(log.metadata.via, '3.0 연습 복사본');
  const [{ left }] = await db`select count(*)::int left from public.meeting_minutes where tenant_id = ${t} and title like ${`${MARK}%`}`;
  assert.equal(left, 0, '남은 행 0');
});

test('화면 저장 경로(run) — 명단 밖 사람 = 2.0 \'로그인이 필요합니다\' · 거절은 아무것도 안 쓴다 · 바깥 요청 큐 증가 0', { skip: SKIP }, async () => {
  const [{ present }] = await db`select to_regclass('net.http_request_queue') is not null present`;
  const queue = async () => (present ? (await db`select count(*)::int n from net.http_request_queue`)[0].n : 0);
  const before = await queue();
  const [{ id }] = await db`select id::text id from public.meeting_minutes where tenant_id = ${t} order by held_at desc limit 1`;
  const [{ stamp }] = await db`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') stamp from public.meeting_minutes where id = ${id}`;
  const call = (name, actor, form) => run((sql) => screen.actions[name].run({ sql, tenantId: t, importV2, body: screen.actions[name].validate({ module: A, actor, args: [null, fd(form)] }) }));
  assert.deepEqual(await call('updateMeetingTitle', '00000000-0000-4000-8000-000000000000', { id, title: '바뀌면 안 됨' }), { error: '로그인이 필요합니다' });
  const actor = (await load({})).editors[0];
  assert.deepEqual(await call('updateMeetingTitle', actor.id, { id, title: '' }), { error: '제목을 입력해주세요' });
  assert.deepEqual(await call('createTextMeeting', actor.id, { title: MARK, heldAt: '2026-10-21T00:00:00.000Z', notepad: '   ' }), { error: '메모 내용을 입력해주세요' });
  const [{ stamp: after2 }] = await db`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') stamp from public.meeting_minutes where id = ${id}`;
  assert.equal(after2, stamp, '거절된 저장은 행을 건드리지 않는다');
  assert.equal(await queue(), before, '바깥 요청 큐 증가 0');
  const [{ left }] = await db`select count(*)::int left from public.meeting_minutes where tenant_id = ${t} and title like ${`${MARK}%`}`;
  assert.equal(left, 0);
});

// ── 공용 러너: 파일 저장소 없음 = 저장소 실패(팀장 결정 10-28) ─────────────────────────────────────────────────────────────
test('러너 단위 — storage.from(bucket).remove는 던지지 않고 Supabase 실패 모양 { data: null, error } · 그 밖의 저장소 호출은 흉내 밖', async () => {
  const { adminClient, sessionClient, STORAGE_MISSING } = await import('./v2-server/postgrest.mjs');
  for (const c of [adminClient(), sessionClient()]) {
    assert.deepEqual(await c.storage.from('meeting-recordings').remove(['t/a.webm']), { data: null, error: { message: '파일 저장소가 없습니다', statusCode: '503' } });
    assert.equal((await c.storage.from('x').remove([])).error, STORAGE_MISSING);
    for (const m of ['upload', 'download', 'createSignedUrl', 'list']) assert.throws(() => c.storage.from('x')[m], (e) => e.code === 'V2_UNSUPPORTED', m);
    assert.throws(() => c.storage.listBuckets, (e) => e.code === 'V2_UNSUPPORTED');
  }
});

test('녹음 있는 회의록 삭제 = 2.0 deleteMeeting 그대로 끝난다(저장소 실패는 2.0이 삼킨다) · 감사로그 audioRemoved는 2.0 판정 그대로 · 되돌림', { skip: SKIP }, async () => {
  const actor = (await load({})).editors[0];
  const [m] = await db`select id::text id, title, audio_path, audio_duration_sec from public.meeting_minutes where tenant_id = ${t} and audio_path is not null order by held_at desc limit 1`;
  assert.ok(m, '시험하려면 녹음 있는 회의록이 있어야 한다');
  // 2.0 판정(audio-path.ts isTenantAudioPath) — 그 지점 경로의 녹음인가. 저장소 결과는 보지 않는다(2.0 그대로).
  const own = (await importV2('lib/storage/audio-path.ts')).isTenantAudioPath(m.audio_path, t);
  const { results, probes } = await runWrite(t, actor.id, [{ module: A, fn: 'deleteMeeting', args: [null, fd({ id: m.id, redirectTo: '/meetings' })] }], { rollback: true, probes: [
    { text: `select count(*)::int n from public.meeting_minutes where id = $1`, params: [m.id] },
    { text: `select metadata from public.audit_logs where tenant_id = $1 and action = 'meeting_delete' and metadata->>'meetingId' = $2`, params: [t, m.id] },
  ] });
  assert.deepEqual(results[0], { redirect: '/meetings' });
  const [[{ n }], [log]] = probes;
  assert.equal(n, 0, '되돌림 트랜잭션 안에서는 지워졌다');
  assert.equal(log.metadata.hadAudio, true); assert.equal(log.metadata.audioRemoved, own); assert.equal(log.metadata.audioDurationSec, m.audio_duration_sec);
  const [{ left }] = await db`select count(*)::int left from public.meeting_minutes where id = ${m.id}`;
  assert.equal(left, 1, '되돌림 뒤 회의록은 그대로');
});
