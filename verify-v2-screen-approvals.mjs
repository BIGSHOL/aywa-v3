// 2.0 화면 전자결재 시험 — 읽기(2.0 queries.ts와 같은 RLS·같은 모양) · 저장 11개(2.0 actions.ts와 같은 검증·표·알림·감사로그) ·
// 호스트로 옮긴 페이지가 2.0 원문 그대로인지 · 호스트 빌드 · 3.0 껍데기. 저장은 모두 트랜잭션 안에서 돌린 뒤 되돌린다(복사본 행 수 그대로).
// 사용: node experiments/owner-concept/verify-v2-screen-approvals.mjs
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-approvals.mjs';
import { build } from './v2-host/build.mjs';

const done = [];
const check = async (name, fn) => { await fn(); done.push(name); };
const here = rel => readFile(new URL(rel, import.meta.url), 'utf8');
const src = rel => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const MODULE = 'features/approvals/server/actions.ts';
const SEOLHYUN = '44626c09-22d9-445f-a350-b792d6afdf75', WONIL = '94007db7-12d3-4b5d-97f2-39071446536b', YEWON = '8bb70f71-a8c3-450c-9236-561e9b43ca4f', SOHEE = '7ac89726-d36f-46e4-8174-6bbddbd7f378';

const db = await openFullDatabase();
const load = params => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, params, tenantId, importV2 }));
const ROLL = new Error('rollback');
const tx = async fn => {
  let out;
  try {
    await db.begin(async sql => {
      const queue = async () => (await sql`select to_regclass('net.http_request_queue') is not null p`)[0].p ? (await sql`select count(*)::int n from net.http_request_queue`)[0].n : 0;
      const before = await queue();
      out = await fn(sql);
      assert.equal(await queue(), before, '바깥으로 나가는 요청이 쌓이지 않는다');
      throw ROLL;
    });
  } catch (e) { if (e !== ROLL) throw e; }
  return out;
};
const form = o => ({ $formData: Object.entries(o).map(([k, v]) => [k, String(v)]) });
const run = (sql, name, actor, fields) => screen.actions[name].run({ sql, body: screen.actions[name].validate({ module: MODULE, actor, args: [null, form(fields)] }), tenantId, importV2 });
const counts = sql => sql`select (select count(*)::int from public.approval_documents where tenant_id=${tenantId}) docs,
  (select count(*)::int from public.approval_steps where tenant_id=${tenantId}) steps,
  (select count(*)::int from public.approval_comments where tenant_id=${tenantId}) comments,
  (select count(*)::int from public.approval_line_templates where tenant_id=${tenantId}) templates,
  (select count(*)::int from public.notifications where tenant_id=${tenantId}) notes,
  (select count(*)::int from public.audit_logs where tenant_id=${tenantId} and action like 'approval%') audits,
  (select string_agg(decision::text, ',' order by step_no) from public.approval_steps where tenant_id=${tenantId}) decisions`;
const audits = sql => sql`select action, actor_id::text actor_id, target_label, metadata from public.audit_logs where tenant_id=${tenantId} and action like 'approval%' and created_at >= now()`;

try {
  const before = (await counts(db))[0];
  const [pending] = await db`select id::text id from public.approval_documents where tenant_id=${tenantId} and status='pending' order by submitted_at limit 1`;

  await check('2.0 서버 함수 이름·인자가 그대로다(actions.ts의 11개 · (_prev, formData))', async () => {
    const a = await src(MODULE);
    const names = [...a.matchAll(/export async function (\w+)\(\s*_prev: ApprovalActionState,\s*formData: FormData,?\s*\)/g)].map(m => m[1]).sort();
    assert.deepEqual(Object.keys(screen.actions).sort(), names);
    assert.equal(names.length, 11);
  });

  await check('호스트로 옮긴 세 페이지 = 2.0 원문 그대로(자료 받는 부분만 바뀜)', async () => {
    const tail = (t, from) => t.slice(t.indexOf(from));
    const pairs = [['app/(shell)/approvals/[id]/page.tsx', './v2-host/src/approvals-doc.tsx', '  const status = docStatusLabel(doc.status);'],
      ['app/(shell)/approvals/page.tsx', './v2-host/src/approvals-list.tsx', '  const tabs = BOX_TABS.filter'], ['app/(shell)/approvals/new/page.tsx', './v2-host/src/approvals-new.tsx', '  return (']];
    for (const [a, b, from] of pairs) {
      let orig = tail(await src(a), from);
      const mine = tail(await here(b), from);
      // 서버에서 하던 위생처리 줄만 load 값으로 바뀐다(나머지 글자는 같다).
      orig = orig.replace(/leave\?\.reason \? sanitizeRichHtml\(leave\.reason\) : ""/, 'data.html.reason')
        .replace(/doc\.(basic|expense|income)\?\.bodyHtml \? sanitizeRichHtml\(doc\.\1\.bodyHtml\) : ""/g, 'data.html.$1').replace('today={kstToday()}', 'today={data.today}');
      assert.equal(mine, orig, b);
    }
  });

  await check('읽기: 같은 RLS — 원장은 결재 대기·학원 전체 진행 · 김예원은 기안한 문서만 · 강사는 없음', async () => {
    const m = await load({});
    assert.equal(m.user.systemRole, 'master');
    assert.ok(m.boxes.academyPending !== null, '원장은 학원 전체 진행 함');
    if (pending) assert.ok(m.boxes.academyPending.some(d => d.id === pending.id));
    assert.ok(m.editors.length >= 20 && m.editors[0].role === '원장');
    const y = await load({ actor: YEWON });
    assert.equal(y.noMenu, true, '전자결재 메뉴가 없으면 결재함은 2.0처럼 막힌다');
    if (pending) {
      const d = await load({ actor: YEWON, v2path: `/approvals/${pending.id}` });
      assert.equal(d.doc.id, pending.id, '메뉴가 없어도 기안자는 문서를 연다(2.0 문서 화면은 메뉴 게이트 없음)');
      assert.equal(typeof d.html.reason, 'string');
      const t = await load({ actor: SOHEE, v2path: `/approvals/${pending.id}` });
      assert.equal(t.notFound, true, '관련 없는 강사는 못 연다');
    }
    const n = await load({ v2path: '/approvals/new' });
    assert.ok(n.candidates.length > 10 && n.balance.period, '기안: 결재자 후보(직급순) · 내 연차');
  });

  if (pending) await check('저장: 결재 — 1단계 승인 → 다음 차례 · 알림 · 감사로그 / 반려 / 전결 / 원장 대결 · 차례 아님·기안자 거절 (되돌림)', async () => {
    const [first] = await db`select approver_id::text a from public.approval_steps where document_id=${pending.id} and step_no=1`;
    const [drafter] = await db`select drafter_id::text d from public.approval_documents where id=${pending.id}`;
    const out = await tx(async sql => {
      const notMine = await run(sql, 'decideDocument', SOHEE, { documentId: pending.id, decision: 'approved' });
      const own = await run(sql, 'decideDocument', drafter.d, { documentId: pending.id, decision: 'approved' });
      const ok = await run(sql, 'decideDocument', first.a, { documentId: pending.id, decision: 'approved', comment: '확인' });
      const [doc] = await sql`select status::text status, current_step from public.approval_documents where id=${pending.id}`;
      const [note] = await sql`select title, recipient_id::text r from public.notifications where tenant_id=${tenantId} and link=${`/approvals/${pending.id}`} and created_at >= now()`;
      return { notMine, own, ok, doc, note, logs: await audits(sql) };
    });
    assert.equal(out.notMine.error, '지금은 내 결재 차례가 아닙니다');
    assert.equal(out.own.error, '본인이 올린 문서는 결재할 수 없습니다');
    assert.equal(out.ok.ok, true);
    assert.deepEqual([out.doc.status, out.doc.current_step], ['pending', 2]);
    assert.equal(out.note.title, '결재 요청', '다음 차례에게 알림 줄');
    assert.deepEqual([out.logs[0].action, out.logs[0].actor_id, out.logs[0].metadata.via, out.logs[0].metadata.step], ['approval_decide', first.a, '3.0 연습 복사본', 1]);
    const rej = await tx(async sql => ({ r: await run(sql, 'decideDocument', first.a, { documentId: pending.id, decision: 'rejected', comment: '날짜 확인' }),
      d: (await sql`select status::text s, outcome_note from public.approval_documents where id=${pending.id}`)[0] }));
    assert.deepEqual([rej.r.ok, rej.d.s], [true, 'rejected']); assert.match(rej.d.outcome_note, /^반려 — .+ \(날짜 확인\)$/);
    const fin = await tx(async sql => ({ r: await run(sql, 'decideDocument', first.a, { documentId: pending.id, decision: 'final' }),
      s: (await sql`select string_agg(decision::text, ',' order by step_no) s from public.approval_steps where document_id=${pending.id}`)[0].s,
      d: (await sql`select status::text s from public.approval_documents where id=${pending.id}`)[0].s }));
    assert.deepEqual([fin.r.notice, fin.d], ['전결로 승인 종결했습니다', 'approved']); assert.match(fin.s, /^final(,skipped)*$/);
    const [other] = await db`select id::text id from public.users where tenant_id=${tenantId} and system_role='master' and status='active' and id <> ${first.a} and id <> ${drafter.d}
      and id not in (select id from public.super_admins) order by display_name limit 1`;
    if (other) {
      const px = await tx(async sql => ({ r: await run(sql, 'decideDocument', other.id, { documentId: pending.id, decision: 'approved' }),
        s: (await sql`select acted_by::text a from public.approval_steps where document_id=${pending.id} and step_no=1`)[0].a }));
      assert.match(px.r.notice ?? '', /\(대결\)$/); assert.equal(px.s, other.id, '대결은 acted_by에 실제 처리자');
    }
  });

  if (pending) await check('저장: 회수(기안자만) · 댓글 달기/지우기(참여자만 · 본인 것만) (되돌림)', async () => {
    const [drafter] = await db`select drafter_id::text d from public.approval_documents where id=${pending.id}`;
    const out = await tx(async sql => {
      const other = await run(sql, 'withdrawDocument', SOHEE, { documentId: pending.id });
      const w = await run(sql, 'withdrawDocument', drafter.d, { documentId: pending.id });
      const [d] = await sql`select status::text s, outcome_note from public.approval_documents where id=${pending.id}`;
      return { other, w, d };
    });
    assert.equal(out.other.error, '진행중인 본인 기안만 회수할 수 있습니다');
    assert.deepEqual([out.w.ok, out.d.s, out.d.outcome_note], [true, 'canceled', '기안자 회수']);
    const cm = await tx(async sql => {
      const stranger = await run(sql, 'addApprovalComment', SOHEE, { documentId: pending.id, body: '안녕하세요' });
      const add = await run(sql, 'addApprovalComment', SEOLHYUN, { documentId: pending.id, body: '확인 부탁드립니다' });
      const [c] = await sql`select id::text id from public.approval_comments where document_id=${pending.id} and author_id=${SEOLHYUN} order by created_at desc limit 1`;
      const delOther = await run(sql, 'deleteApprovalComment', WONIL, { commentId: c.id });
      const del = await run(sql, 'deleteApprovalComment', SEOLHYUN, { commentId: c.id });
      return { stranger, add, delOther, del, logs: (await audits(sql)).map(l => l.action).sort() };
    });
    assert.equal(cm.stranger.error, '이 문서의 기안자·결재자·참조자만 댓글을 남길 수 있습니다');
    assert.deepEqual([cm.add.ok, cm.delOther.error, cm.del.ok], [true, '본인이 쓴 댓글만 삭제할 수 있습니다', true]);
    assert.deepEqual(cm.logs, ['approval_comment', 'approval_comment_delete']);
  });

  await check('저장: 기안 4종(휴가 잔여 검증 · 품의 · 지출 금액 · 수입) · 결재선 저장/삭제 · 메뉴 없는 사람 거절 (되돌림)', async () => {
    const out = await tx(async sql => {
      const noMenu = await run(sql, 'submitBasicDraft', YEWON, { formType: 'proposal', title: '시험', approverIds: JSON.stringify([SEOLHYUN]) });
      const noLine = await run(sql, 'submitBasicDraft', SEOLHYUN, { formType: 'proposal', title: '시험', approverIds: '[]' });
      const basic = await run(sql, 'submitBasicDraft', SEOLHYUN, { formType: 'proposal', title: '시험 품의', body: '<p>본문<script>x</script></p>', approverIds: JSON.stringify([WONIL]) });
      const [b] = await sql`select d.doc_no, f.body_html from public.approval_documents d join public.approval_basic_forms f on f.document_id=d.id where d.id=${basic.docId}`;
      const money = await run(sql, 'submitExpenseDraft', SEOLHYUN, { title: '시험 지출', amount: '0', spendDate: '2026-10-28', approverIds: JSON.stringify([WONIL]) });
      const expense = await run(sql, 'submitExpenseDraft', SEOLHYUN, { title: '시험 지출', amount: '12,000', spendDate: '2026-10-28', category: '없는 분류', approverIds: JSON.stringify([WONIL]) });
      const [e] = await sql`select amount, category from public.approval_expense_forms where document_id=${expense.docId}`;
      const income = await run(sql, 'submitIncomeDraft', SEOLHYUN, { title: '시험 수입', amount: '5000', incomeDate: '2026-10-28', category: '기타', approverIds: JSON.stringify([WONIL]) });
      const tooMany = await run(sql, 'submitLeaveDraft', SEOLHYUN, { kind: 'annual', startDate: '2026-11-02', endDate: '2027-01-29', approverIds: JSON.stringify([WONIL]) });
      const leave = await run(sql, 'submitLeaveDraft', SEOLHYUN, { kind: 'annual', startDate: '2026-11-02', endDate: '2026-11-02', approverIds: JSON.stringify([WONIL]) });
      const [l] = await sql`select days, granted_days from public.leave_forms where document_id=${leave.docId}`;
      const tpl = await run(sql, 'saveLineTemplate', SEOLHYUN, { name: '시험 결재선', approverIds: JSON.stringify([WONIL]), refIds: '[]' });
      const [tp] = await sql`select id::text id, approver_ids from public.approval_line_templates where owner_id=${SEOLHYUN} and name='시험 결재선'`;
      const tplDel = await run(sql, 'deleteLineTemplate', SEOLHYUN, { templateId: tp.id });
      const [first] = await sql`select title, recipient_id::text r from public.notifications where link=${`/approvals/${basic.docId}`}`;
      return { noMenu, noLine, basic, b, money, expense, e, income, tooMany, leave, l, tpl, tp, tplDel, first, logs: await audits(sql) };
    });
    assert.equal(out.noMenu.error, '전자결재 권한이 없습니다');
    assert.ok(out.noLine.error, '결재선이 없으면 거절(2.0 validateApprovalLine)');
    assert.equal(out.basic.ok, true); assert.match(out.b.doc_no, /^품의-\d{4}-\d{4}$/);
    assert.ok(!out.b.body_html.includes('script'), '본문은 2.0 sanitizeRichHtml로 위생처리');
    assert.equal(out.money.error, '금액은 1원 이상 10억 원 이하로 입력하세요');
    assert.deepEqual([out.expense.ok, Number(out.e.amount), out.e.category], [true, 12000, '기타']);
    assert.equal(out.income.ok, true);
    assert.match(out.tooMany.error ?? '', /잔여 연차|남은 연차|사용 기간|신청/, '잔여를 넘는 휴가는 접수 자체를 거절');
    assert.equal(out.leave.ok, true); assert.ok(Number(out.l.days) > 0 && Number(out.l.granted_days) > 0);
    assert.deepEqual([out.tpl.ok, out.tp.approver_ids, out.tplDel.ok], [true, [WONIL], true]);
    assert.deepEqual([out.first.title, out.first.r], ['결재 요청', WONIL], '1단계 결재자에게만 알림');
    assert.ok(out.logs.filter(l => l.action === 'approval_submit').every(l => l.metadata.via === '3.0 연습 복사본'));
    assert.equal(out.logs.filter(l => l.action === 'approval_submit').length, 4);
  });

  await check('저장 요청 검사 — 받지 않는 파일·모르는 사람은 거절', async () => {
    assert.throws(() => screen.actions.decideDocument.validate({ module: 'features/x.ts', actor: SEOLHYUN, args: [] }));
    const r = await tx(sql => run(sql, 'decideDocument', null, { documentId: pending?.id ?? '', decision: 'approved' }));
    assert.equal(r.error, '로그인이 필요합니다');
  });

  await check('시험 뒤 복사본은 그대로(문서 · 결재선 · 댓글 · 결재선 저장 · 알림 · 감사로그 · 결재 상태)', async () => {
    assert.deepEqual((await counts(db))[0], before);
  });
} finally { await db.end(); }

await check('호스트: 2.0 부품을 고치지 않고 묶인다 — 서버 전용 유입 0 · 운영 주소·외부 호출 0', async () => {
  const outdir = path.join(os.tmpdir(), `v2-host-verify-approvals-${process.pid}`);
  const info = await build({ quiet: true, outdir });
  assert.deepEqual(info.serverOnly, [], `서버 전용 모듈 유입: ${info.serverOnly.join(', ')}`);
  assert.ok(info.actions.map(a => a.replaceAll('\\', '/')).includes('src/features/approvals/server/actions.ts'));
  const js = await readFile(new URL('approvals.js', pathToFileURL(`${outdir}${path.sep}`)), 'utf8');
  const hosts = [...new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  for (const h of hosts) assert.doesNotMatch(h, /aywa|vercel|supabase|classnote|slack|todaymath|kakao|googleapis/, `서비스 주소 ${h}`);
  await rm(outdir, { recursive: true, force: true });
});

await check('3.0 쪽: 같은 출처 iframe 자리와 안내 한 줄뿐 — 운영 주소·외부 주소·직접 저장 요청 없음 · 화면 글자에 개발자 말 없음', async () => {
  const js = await here('./v2-screen-approvals.js');
  for (const bad of [/https?:\/\//, /aywa\.co\.kr/, /vercel\.app/, /ctx\.act\(/, /method:\s*'POST'/]) assert.doesNotMatch(js, bad, String(bad));
  const shown = [/<p><b>연습 화면<\/b>([^<]*)<\/p>/, /<span>(보는 사람)<\/span>/, /toast\?\.\('([^']*)'\)/, /hostOk === false \? '([^']*)'/].map(re => { const m = re.exec(js); assert.ok(m, String(re)); return m[1]; }).join('\n');
  for (const bad of [/2\.0/, /Docker|복사본|v2path|iframe|호스트/i]) assert.doesNotMatch(shown, bad, String(bad));
  assert.match(js, /e\.origin !== location\.origin/); assert.match(js, /e\.source !== frame\.contentWindow/); assert.match(js, /ctx\.query\.get\('actor'\)/);
});

console.log(`v2 approvals: ${done.length} checks passed`);
for (const n of done) console.log(`  ✓ ${n}`);
