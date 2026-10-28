// 2.0 원스크린 공지 원본 함수 연결: Docker 대기열 생성·수정·삭제를 한 트랜잭션에서 확인하고 되돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const here = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const MODULE = 'features/onescreen/server/notice-actions.ts';
const NAMES = ['sendOnescreenNotice', 'editQueuedNotice', 'deleteQueuedNotice'];
const NET = `select case when to_regclass('net.http_request_queue') is null then -1 else (select count(*)::int from net.http_request_queue) end n`;

test('원스크린·수업보고서의 공지 작성·대기 관리 = 같은 2.0 원본 함수, 거절 목록 밖, 복사본 발송 안내', async () => {
  const original = await readFile(new URL('../../src/features/onescreen/server/notice-actions.ts', import.meta.url), 'utf8');
  const { lessonReportsActions } = await import('./v2-lesson-reports-save.mjs');
  const { screen } = await import('./v2-screen-onescreen.mjs');
  const reportsHost = await here('./v2-host/src/lesson-reports.tsx');
  const onescreenHost = await here('./v2-host/src/onescreen.tsx');
  const refused = reportsHost.slice(reportsHost.indexOf('const REFUSE'), reportsHost.indexOf('for (const [module, names] of Object.entries(REFUSE))'));
  for (const name of NAMES) {
    assert.match(original, new RegExp(`export async function ${name}\\(`));
    assert.equal(screen.actions[name], lessonReportsActions[name], name);
    assert.ok(!refused.includes(`"${name}"`), name);
  }
  assert.match(reportsHost, /\["features\/onescreen\/server\/notice-actions\.ts", \["sendOnescreenNotice"\]\]/);
  assert.match(onescreenHost, /연습 복사본이라 실제로 보내지지 않습니다/);
});

test('공지 생성→대기 수정→삭제 = 원본 함수·감사로그·바깥 요청 0, 시험 뒤 전부 되돌림', async () => {
  const { openFullDatabase, tenantId } = await import('./full-db.mjs');
  const { runV2Server, stopV2Server } = await import('./v2-server-runner.mjs');
  const { importV2 } = await import('./v2-bridge.mjs');
  const { studentsBase } = await import('./v2-students-common.mjs');
  const { readLessonEditors } = await import('./v2-lesson-reports-save.mjs');
  const db = await openFullDatabase();
  try {
    const [teacher] = await db`select u.id::text id from public.users u join public.classes c on c.teacher_id=u.id and c.tenant_id=${tenantId} and c.is_active
      where u.tenant_id=${tenantId} and u.status::text='active' and u.system_role::text='teacher' limit 1`;
    assert.ok(teacher, '활성 반을 맡은 시험용 강사가 필요합니다');
    const editors = await db.begin('read only', async (sql) => readLessonEditors(await studentsBase({ sql, tenantId, importV2 })));
    assert.ok(editors.some((x) => x.id === teacher.id), '원스크린이 고른 강사가 원본 함수 실행 신분으로 전달돼야 한다');
    const [{ n: netBefore }] = await db.unsafe(NET);
    const body = `검증용 공지 ${randomUUID()}`;
    const edited = `검증용 수정 ${randomUUID()}`;
    const input = { $sql: `with enabled as (
      update public.tenant_settings set data = coalesce(data, '{}'::jsonb) ||
        jsonb_build_object('report', coalesce(data->'report', '{}'::jsonb) || '{"classnoteSendEnabled":true}'::jsonb)
      where tenant_id=$1 returning tenant_id
    ) select jsonb_build_object('body', $2::text, 'students', '[]'::jsonb, 'test', true) as input from enabled`, params: [tenantId, body] };
    const queuedId = (text) => ({ $sql: `select id::text id from public.classnote_notices where tenant_id=$1 and created_by=$2 and body=$3 and status='queued' order by created_at desc limit 1`, params: [tenantId, teacher.id, text] });
    const result = await runV2Server({ tenantId, actorId: teacher.id, mode: 'write', rollback: true, allowRefs: true,
      steps: [
        { module: MODULE, fn: 'sendOnescreenNotice', args: [input] },
        { module: MODULE, fn: 'editQueuedNotice', args: [queuedId(body), edited] },
        { module: MODULE, fn: 'deleteQueuedNotice', args: [queuedId(edited)] },
      ], probes: [
        { text: `select count(*)::int n from public.classnote_notices where tenant_id=$1 and created_by=$2 and body=$3`, params: [tenantId, teacher.id, edited] },
        { text: `select action, metadata->>'via' via from public.audit_logs where tenant_id=$1 and actor_id=$2 and action in ('classnote_notice_send','classnote_notice_edit','classnote_notice_delete') and created_at=now()`, params: [tenantId, teacher.id] },
        { text: NET },
      ] });
    assert.equal(result.results[0].value.ok, true, JSON.stringify(result.results[0].value));
    assert.equal(result.results[0].value.queued, 1);
    assert.equal(result.results[1].value.ok, true, JSON.stringify(result.results[1].value));
    assert.equal(result.results[2].value.ok, true, JSON.stringify(result.results[2].value));
    assert.equal(result.probes[0][0].n, 0, '대기 행은 삭제됐다');
    assert.deepEqual(result.probes[1].map((x) => x.action).sort(), ['classnote_notice_delete', 'classnote_notice_edit', 'classnote_notice_send']);
    assert.ok(result.probes[1].every((x) => x.via === '3.0 연습 복사본'));
    assert.equal(result.probes[2][0].n, netBefore, '바깥 요청 0');
    const [after] = await db`select count(*)::int n from public.classnote_notices where tenant_id=${tenantId} and created_by=${teacher.id} and body=${body}`;
    assert.equal(after.n, 0, '시험 트랜잭션 되돌림');
  } finally {
    await stopV2Server();
    await db.end();
  }
});
