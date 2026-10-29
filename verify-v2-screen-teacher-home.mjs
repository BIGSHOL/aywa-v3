import assert from 'node:assert/strict';
import { openFullDatabase, sandbox, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-teacher-home.mjs';
import { runV2Server, stopV2Server } from './v2-server-runner.mjs';

assert.ok(sandbox, '4311 시험 복사본(OWNER_CONCEPT_DB=sandbox)에서만 실행');
const db = await openFullDatabase();
try {
  const people = await db`select u.id::text id,u.display_name,
      array_agg(distinct c.subject) filter (where c.subject is not null) subjects,
      exists(select 1 from public.class_schedules s join public.classes x on x.id=s.class_id
        where s.tenant_id=${tenantId} and s.teacher_id=u.id and x.is_active and x.subject='english') english_slot
    from public.users u join public.classes c on c.teacher_id=u.id and c.tenant_id=${tenantId} and c.is_active
    where u.tenant_id=${tenantId} and u.system_role='teacher' and u.status='active'
    group by u.id,u.display_name`;
  const samples = ['김은정', '추민아', '남정화'].map(name => people.find(p => p.display_name === name));
  const kinds = ['수학 전담', '영어 전담', '학부모 알림 0건'];
  const allParentNotifications = await db`select id::text id, recipient_id::text recipient_id from public.notifications
    where tenant_id=${tenantId} and type in ('classnote_parent_post','classnote_parent_comment') and read_at is null and archived_at is null`;
  const load = (actor, card) => db.begin('isolation level repeatable read read only', sql => screen.load({ sql, tenantId, importV2, params: { actor, card } }));
  for (let i = 0; i < samples.length; i++) {
    const person = samples[i];
    assert.ok(person, `${kinds[i]} 시험 강사 있음`);
    const landing = await load(person.id, 'landing');
    assert.equal(landing.actor.id, person.id);
    if (i < 2) assert.equal(landing.home, i === 1 ? 'ecs' : 'onescreen', `${kinds[i]} 착지`);
    console.log(`${kinds[i]} ${person.display_name}: ${landing.home}`);
    let parentValue = null;
    for (const card of ['lessons', 'attendance', 'reports', 'parents']) {
      const value = await load(person.id, card);
      assert.equal(value.total, value.rows.length, `${kinds[i]} ${card} 숫자=명단`);
      if (card === 'parents') parentValue = value;
      console.log(`  ${card}: ${value.total}`);
    }
    const { results: [bell] } = await runV2Server({ actorId: person.id, tenantId, mode: 'read', steps: [
      { module: 'features/notifications/server/queries.ts', fn: 'getMyNotifications', args: ['active', 100] },
    ] });
    const expected = allParentNotifications.filter(n => n.recipient_id === person.id).map(n => n.id).sort();
    assert.deepEqual(parentValue.rows.map(row => row.id).sort(), expected, `${kinds[i]} 벨 판정과 같은 학부모 알림`);
    assert.equal(parentValue.total, expected.length, `${kinds[i]} 칸 숫자=명단 행 수`);
    assert.ok(parentValue.total <= bell.value.unread, `${kinds[i]} 학부모 알림은 벨 안 읽음 수 안에 포함`);
    assert.ok(parentValue.rows.every(row => !allParentNotifications.some(n => n.id === row.id && n.recipient_id !== person.id)), `${kinds[i]} 다른 선생님 알림 없음`);
    if (i === 2) assert.equal(parentValue.total, 0, '남정화 학부모 알림 0건');
    console.log(`  벨 전체 안 읽음 ${bell.value.unread} · 학부모 칸 ${parentValue.total} · 명단 ${parentValue.rows.length}`);
    const inboxResponse = await fetch(`http://127.0.0.1:4311/api/flow/teacher-inbox?actor=${person.id}`);
    assert.equal(inboxResponse.status, 200, `${kinds[i]} 내 차례 업무 GET`);
    const inbox = await inboxResponse.json();
    assert.equal(inbox.total, inbox.rows.length, `${kinds[i]} 업무 숫자=명단`);
    console.log(`  tasks: ${inbox.total}`);
  }
  const summary = await (await fetch('http://127.0.0.1:4311/api/flow?summary=1')).json();
  const busy = summary.actors.find(a => a.role === 'teacher' && summary.firstScreen.inboxByActor[a.id] > 0);
  assert.ok(busy, '내 차례 업무가 있는 강사 있음');
  const busyInbox = await (await fetch(`http://127.0.0.1:4311/api/flow/teacher-inbox?actor=${busy.id}`)).json();
  assert.equal(busyInbox.rows.length, summary.firstScreen.inboxByActor[busy.id], '업무 흐름 정본과 내 업무 명단 일치');
  console.log(`내 차례 업무 있는 강사: ${busyInbox.rows.length}건`);
  // 사본에는 실제 영어·수학 겸업 강사가 없다. 시험 트랜잭션에서 영어 반 하나만 수학 강사에게 잠시 붙여 판정한다.
  const math = samples[0];
  const english = await db`select c.id::text id from public.classes c where c.tenant_id=${tenantId} and c.is_active and c.subject='english' and c.teacher_id is not null limit 1`;
  assert.ok(english[0], '겸업 시험용 영어 반 있음');
  const rollback = new Error('mixed test rollback');
  try {
    await db.begin(async sql => {
      await sql`update public.classes set teacher_id=${math.id} where tenant_id=${tenantId} and id=${english[0].id}`;
      const landing = await screen.load({ sql, tenantId, importV2, params: { actor: math.id, card: 'landing' } });
      assert.equal(landing.home, 'onescreen', '영어·수학 겸업 착지');
      for (const card of ['lessons', 'attendance', 'reports', 'parents']) {
        const value = await screen.load({ sql, tenantId, importV2, params: { actor: math.id, card } });
        assert.equal(value.total, value.rows.length, `겸업 ${card} 숫자=명단`);
      }
      console.log('겸업 임시 배정: onescreen · 네 칸 숫자=명단');
      await sql`update public.users set seat_lab_duty=true where tenant_id=${tenantId} and id=${math.id}`;
      const seatLanding = await screen.load({ sql, tenantId, importV2, params: { actor: math.id, card: 'landing' } });
      assert.match(seatLanding.route, /#v2-attendance\?v2path=%2Fattendance%2Fseat%2Flab/, '자리 출석부 우선 착지');
      console.log('자리 담당 임시 토글: 랩실 출석부 우선 착지');
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
} finally { await stopV2Server(); await db.end(); }
