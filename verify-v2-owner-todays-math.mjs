import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { importV2 } from './v2-bridge.mjs';
import { screen } from './v2-screen-owner.mjs';

const done=[];
const check=async(name,fn)=>{await fn();done.push(name)};
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
await check('오늘 수학 카드 원본 사용, 사용 메뉴 외부 조회 차단',async()=>{
  const host=await read('./v2-host/src/owner-integrations.tsx');
  assert.match(host,/TodaysMathCard report=\{settings\.report\}/);
  assert.match(host,/active === "todaysMath" && isMaster \? <TodaysMathMenusCard/);
  const entry=await read('./v2-host/src/owner.tsx');
  assert.match(entry,/registerHostHandler\('features\/integrations\/todays-math\/server\/branch-menus-actions\.ts'/);
});
const db=await openFullDatabase();
const load=params=>db.begin('isolation level repeatable read read only',sql=>screen.load({sql,params,tenantId,importV2}));
try{
  const d=await load({tab:'sheets',sub:'todaysMath'});
  await check('라이선스 탭과 보고서 설정 세 토글이 함께 조회',async()=>{
    assert.equal(d.route,'page');
    assert.ok(d.page.integrations.available.includes('todaysMath'));
    for(const k of ['todaysMathTestFill','todaysMathMonthlyFill','todaysMathReportPdf'])assert.equal(typeof d.page.settings.report[k],'boolean',k);
    assert.equal((await load({tab:'profile'})).page.settings.report,undefined);
    assert.equal((await load({tab:'sheets',sub:'sheets'})).page.settings.report,undefined);
  });
  await check('보고서 섹션 저장은 원본 권한·감사로그를 거쳐 되돌림',async()=>{
    const a=screen.actions.saveOwnerSection,report=structuredClone(d.page.settings.report);
    const form={ $formData:[['section','report'],['data',JSON.stringify({...report,todaysMathTestFill:!report.todaysMathTestFill})]] };
    const body=a.validate({module:'features/owner/server/actions.ts',actor:d.viewer.id,args:[null,form]});
    const ROLL=new Error('rollback');
    try{await db.begin(async sql=>{
      const r=await a.run({sql,body,tenantId,importV2});assert.equal(r.ok,true);
      const [row]=await sql`select data from public.tenant_settings where tenant_id=${tenantId}`;
      assert.equal(row.data.report.todaysMathTestFill,!report.todaysMathTestFill);
      const [log]=await sql`select action from public.audit_logs where tenant_id=${tenantId} and action='owner_settings_update' and created_at=now()`;
      assert.equal(log.action,'owner_settings_update');
      throw ROLL;
    })}catch(e){if(e!==ROLL)throw e}
    const after=(await load({tab:'sheets',sub:'todaysMath'})).page.settings.report;
    assert.equal(after.todaysMathTestFill,report.todaysMathTestFill);
  });
}finally{await db.end()}
console.log(`오늘 수학 ${done.length}/${done.length} 통과: ${done.join(' · ')}`);
