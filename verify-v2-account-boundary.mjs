// 계정 경계의 GET 조회 함수를 읽기 전용 트랜잭션에서 검증한다. 자료 본문과 키 값은 출력하지 않는다.
import assert from 'node:assert/strict';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen as staff } from './v2-screen-staff.mjs';
import { screen as billing } from './v2-screen-billing.mjs';
import { screen as portfolio } from './v2-screen-class-review.mjs';
import { screen as attendance } from './v2-screen-attendance.mjs';
import { screen as meetings } from './v2-screen-meetings.mjs';
import { screen as consultations } from './v2-screen-consultations.mjs';
import { screen as enrollment } from './v2-screen-enrollment.mjs';
import { screen as withdrawals } from './v2-screen-withdrawals.mjs';
import { screen as reports } from './v2-screen-withdrawal-reports.mjs';
import { screen as approvals } from './v2-screen-approvals.mjs';
import { screen as video } from './v2-screen-video-homework.mjs';
import { screen as ecs } from './v2-screen-ecs.mjs';
import { screen as mcs } from './v2-screen-mcs.mjs';
import { screen as ownerSettings } from './v2-screen-owner.mjs';
import { screen as textbooks } from './v2-screen-textbooks.mjs';
import { screen as textbookRequests } from './v2-screen-textbook-requests.mjs';
import { pickViewer } from './v2-dashboard-overview.mjs';

const teacher = 'bf52c6d2-5b44-41fc-8268-3248b7eda61b';
const invalid = '00000000-0000-4000-8000-000000000000';
const db = await openFullDatabase();
try {
  await db.begin('isolation level repeatable read read only', async sql => {
    const [owner] = await sql`select u.id::text id from public.users u where u.tenant_id=${tenantId} and u.display_name='설현' and u.system_role='master' and u.status='active' and not exists(select 1 from public.super_admins s where s.id=u.id) limit 1`;
    assert.ok(owner?.id, '원장 계정');
    const load = (screen, params) => screen.load({ sql, params, tenantId, importV2 });
    const noAccess = data => data?.notAllowed === true || data?.page === 'noMenu' || data?.route === 'none';
    const denied = await load(staff, { actor: teacher });
    assert.ok(noAccess(denied) && !denied.rows && !denied.user, '강사 직원관리 거절');
    assert.ok(noAccess(await load(staff, {})), '계정 없는 직원관리 거절');
    assert.ok(noAccess(await load(staff, { actor: teacher, v2path: '/staff/annual-leave' })), '강사 직원 하위 화면 거절');
    const staffOwner = await load(staff, { actor: owner.id });
    assert.equal(staffOwner.user?.id, owner.id, '원장 직원관리');
    assert.ok(staffOwner.rows?.length > 0);
    await assert.rejects(load(billing, { viewer: teacher, tab: 'payroll' }), e => e.status === 403, '강사 강사 정산 거절');
    await assert.rejects(load(billing, { tab: 'payroll' }), e => e.status === 403, '계정 없는 강사 정산 거절');
    const billingOwner = await load(billing, { viewer: owner.id, tab: 'payroll' });
    assert.equal(billingOwner.viewer?.id, owner.id, '원장 강사 정산');
    assert.equal(billingOwner.access?.readSalary, true);
    const portfolioDenied = await load(portfolio, { actor: teacher, tab: 'portfolio' });
    assert.ok(noAccess(portfolioDenied), '강사 포트폴리오 거절');
    assert.ok(noAccess(await load(portfolio, { tab: 'portfolio' })), '계정 없는 포트폴리오 거절');
    const portfolioOwner = await load(portfolio, { actor: owner.id, tab: 'portfolio' });
    assert.ok(!noAccess(portfolioOwner) && portfolioOwner.page === 'portfolio', '원장 포트폴리오');
    await assert.rejects(load(attendance, { viewer: teacher }), e => e.status === 403, '강사 관리자 출석부 거절');
    await assert.rejects(load(attendance, { viewer: invalid, v2path: '/attendance/quick' }), e => e.status === 403, '목록 밖 출결 모드 거절');
    assert.equal(await pickViewer(sql, tenantId, teacher, new Date()), null, '강사 운영실 거절');
    assert.equal((await pickViewer(sql, tenantId, owner.id, new Date()))?.id, owner.id, '원장 운영실');
    for (const [name, screen, params] of [
      ['회의록', meetings, { actor: invalid }],
      ['상담', consultations, { actor: invalid }],
      ['콜&상담', enrollment, { actor: invalid }],
      ['퇴원관리', withdrawals, { actor: invalid }],
      ['퇴원보고서', reports, { actor: invalid }],
      ['결재', approvals, { actor: invalid }],
      ['숙제 영상', video, { actor: invalid }],
    ]) assert.ok(noAccess(await load(screen, params)), `${name} 목록 밖 계정 거절`);
    for (const [name, screen] of [['영어 강사 시트', ecs], ['수학 강사 시트', mcs], ['학원 설정', ownerSettings], ['교재목록', textbooks]])
      assert.ok(noAccess(await load(screen, { viewer: invalid })), `${name} 목록 밖 계정 거절`);
    await assert.rejects(load(textbookRequests, { viewer: invalid }), e => e.status === 403, '교재 요청 목록 밖 계정 거절');
    console.log('강사 직원관리·급여·포트폴리오 거절 / 원장 3곳 허용 / 운영실·출결·다른 조회 15곳 목록 밖 계정 거절');
  });
} finally { await db.end(); }
