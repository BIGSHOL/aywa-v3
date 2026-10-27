// TEST-ONLY stand-in for GET /api/flow and POST /api/flow/actions, used only when the server under test does not serve
// the flow endpoints. It never ships in the UI. It mirrors the backend's published semantics (flow_contract v1.1 and the
// backend sample): grouped steps (a request to many people opens one step each), reviewer steps (`review:true`) in the
// manager queue, conditional review skipped unless flagged, fact cases that only 2.0 can close (a report becomes a linked
// local follow-up), duplicate scenarios answered with the existing case, idempotent commandId and revision checks.
// Actors and source cases come from the real copied snapshot; scenarios and requests are origin 'dev'. No AI is called:
// judgments are recorded as unavailable, exactly like the backend without decision modules.
const ROLE_BY_TITLE=[[/^(원장|대표)$/,'owner'],[/^(부원장|분원장|교수부장|부장|대리)$/,'manager'],[/(강사|프리랜서|원어민)/,'teacher']];
const roleOf=title=>ROLE_BY_TITLE.find(([re])=>re.test(String(title||'')))?.[1]||'staff';
const LABEL={owner:'원장',manager:'관리자',teacher:'강사',staff:'직원'};
const STEP_ROLE={desk:'데스크',homeroom:'담임',billing:'수납 담당',manager:'관리자',assignee:'요청받은 사람',source:'원본 담당'};
const TEMPLATES={
  absence:{familyId:'attendance',title:'결석 연락과 후속 조치',trigger:['absence.reported','결석 보고'],steps:[{key:'desk_contact',label:'보호자 결석 확인 연락',role:'desk',evidenceRequired:true},{key:'manager_review',label:'관리자 검토',role:'manager',review:true,when:'needsReview'},{key:'teacher_followup',label:'담임 후속 조치(보강·학습 안내)',role:'homeroom',evidenceRequired:true}]},
  billing:{familyId:'billing',title:'수납 잔액 확인과 결정',trigger:['billing.flagged','수납 확인 요청'],steps:[{key:'staff_check',label:'납부 내역 대조',role:'billing',evidenceRequired:true},{key:'decision',label:'관리자·원장 결정',role:'manager',review:true}]},
};
const ROLES={'request.create':['owner','manager'],'event.simulate':['owner','manager','teacher','staff'],'case.analyze':['owner','manager'],'case.reassign':['owner','manager'],'case.reopen':['owner','manager'],'case.review':['owner','manager'],'case.ack':['owner','manager','teacher','staff'],'case.report':['owner','manager','teacher','staff']};
const OUTCOMES=['done','needs_review','unreachable','not_needed'];

export function createFlowMock(db){
  const real=db.staff.map(s=>({id:s.id,name:s.name,role:roleOf(s.title),roleLabel:s.title||LABEL[roleOf(s.title)],duties:[]}));
  const actors=[...real,{id:'preview-owner',name:'원장 미리보기',role:'owner',roleLabel:'원장(미리보기)',preview:true,duties:[]}];
  const owner=actors.find(a=>a.preview),manager=real.find(a=>a.role==='manager');
  const desk=real.find(a=>a.role==='staff')||real.find(a=>a.role==='teacher');if(desk)desk.duties=['desk'];
  const cashier=real.find(a=>a.role==='staff'&&a!==desk)||desk;
  const byName=new Map(real.map(a=>[a.name,a.id])),byId=new Map(actors.map(a=>[a.id,a]));
  const state={revision:1,seq:0,cases:[],events:[],commands:new Map(),calls:[]};
  const now=()=>new Date().toISOString();
  const find=id=>state.cases.find(c=>c.id===id);
  const evt=(c,type,label,actorId,{targetActorIds=[],origin='dev',stepId=null}={})=>{state.seq+=1;const e={id:`evt-${state.seq}`,caseId:c.id,type,label,actorId,at:now(),origin,targetActorIds,stepId};state.events.push(e);c.history.push(e.id);return e;};
  const resolve=(role,ctx={})=>{
    const queue=reason=>({assigneeIds:[],queue:'manager',rule:'관리자·원장 누구나',unassignedReason:reason});
    if(role==='desk')return desk?{assigneeIds:[desk.id],queue:null,rule:'기존 결석 확인 담당(출결 알림을 켠 직원)'}:queue('출결 알림을 켠 직원이 없어 관리자 대기열');
    // Deliberately keeps the backend's older parenthesised source identifier so the UI's clean-up is exercised.
    if(role==='homeroom')return ctx.teacher?{assigneeIds:[ctx.teacher],queue:null,rule:'반 담임(classes.teacher_id)'}:queue('담임을 찾지 못해 관리자 대기열');
    if(role==='billing')return cashier?{assigneeIds:[cashier.id],queue:null,rule:'회계 담당 직원'}:queue('회계 역할 직원이 없어 관리자 대기열');
    return {assigneeIds:[],queue:'manager',rule:'관리자·원장 누구나',unassignedReason:null};
  };
  const step=(caseId,n,def,r,group)=>({id:`${caseId}-s${n}`,key:def.key,label:def.label,role:def.role,roleLabel:STEP_ROLE[def.role]||def.role,assigneeIds:r.assigneeIds,queue:r.queue,rule:r.rule||null,unassignedReason:r.unassignedReason||null,status:'waiting',evidenceRequired:!!def.evidenceRequired,review:!!def.review,when:def.when||null,group});
  function refresh(c){
    const active=c.steps.filter(s=>s.status==='ready'||s.status==='working');
    c.currentStepId=active[0]?.id||null;c.assigneeIds=[...new Set(active.flatMap(s=>s.assigneeIds))];
    if(c.closure==='fact')c.state=c.steps.some(s=>s.status==='working')?'working':'open';
    else if(c.steps.every(s=>s.status==='done'))c.state='done';
    else if(active.some(s=>s.review))c.state='review';
    else c.state=c.steps.some(s=>s.status==='working'||s.status==='done')?'working':'open';
    c.updatedAt=now();
  }
  function advance(c,actorId){
    for(;;){
      const pending=c.steps.filter(s=>s.status!=='done');
      if(!pending.length||pending.some(s=>s.status==='ready'||s.status==='working'))break;
      const group=Math.min(...pending.map(s=>s.group));
      for(const s of pending.filter(x=>x.group===group)){
        if(s.when==='needsReview'&&!c.flags.needsReview){s.status='done';s.skipped=true;evt(c,'step.skipped',`${s.label} — 검토가 필요하지 않아 건너뜀`,actorId,{stepId:s.id});}
        else{s.status='ready';evt(c,'step.routed',`${s.label} → ${s.assigneeIds.length?'담당 지정':'관리자 대기열'}`,actorId,{stepId:s.id,targetActorIds:s.assigneeIds.length?s.assigneeIds:real.filter(a=>a.role==='manager').map(a=>a.id)});}
      }
    }
    if(c.steps.every(s=>s.status==='done')&&c.closure!=='fact')evt(c,'case.closed','완료',actorId,{targetActorIds:c.watchers});
    refresh(c);
  }
  // Same shape the backend records without a configured judgment key (Korean reason; technical codes kept apart).
  const unavailable=()=>({id:`dec-${state.seq+1}`,status:'unavailable',reason:'판정 키가 설정되지 않음',route:'human_review',routeLabel:'사람 검토',area:null,provider:'none',providerLabel:null,model:null,modelLabel:null,probabilities:null,elapsedMs:0,usage:null,at:now(),claudeRecommended:false,draft:null,codes:['jev_not_configured']});
  const base=(id,fields)=>({id,closure:'manual',origin:'dev',priority:'normal',state:'open',trigger:null,entityRefs:[],steps:[],currentStepId:null,assigneeIds:[],dueAt:null,createdAt:now(),updatedAt:now(),evidence:[],decision:null,history:[],linkedCaseIds:[],flags:{},watchers:[],...fields});

  // Seed: open automatic 2.0 tasks become fact-closed source cases (deterministic ids, once).
  db.tasks.filter(t=>t.status==='open'&&!t.local).slice(0,30).forEach((t,i)=>{
    const ids=i===0?[]:(t.owners||[]).map(n=>byName.get(n)).filter(Boolean);
    const id=`src-task-${t.id}`,familyId=t.kind==='attendance_absent_desk'?'attendance':String(t.kind).startsWith('video')?'video-homework':t.kind==='unsent_report'?'lesson-reports':t.kind==='withdrawal_step'?'withdrawal-reports':'tasks-notifications';
    const c=base(id,{kind:'source',scenario:null,familyId,title:t.title,summary:t.detail||'',closure:'fact',origin:'snapshot',sourceStatus:'open',sourceStatusLabel:'처리 전',factClosed:false,closedReason:null,doneRule:'원본 기록이 2.0에서 처리되면 닫힙니다.',entityRefs:[{type:'task',id:t.id,label:t.title,familyId,recordId:t.id}],dueAt:t.due||null,createdAt:t.opened,updatedAt:t.opened});
    // The first task has nobody resolved, so it sits in the manager queue with a reason.
    c.steps=[{...step(id,1,{key:'source_task',label:t.title,role:'source',evidenceRequired:true},ids.length?{assigneeIds:ids,queue:null,rule:'2.0 할 일 담당'}:{assigneeIds:[],queue:'manager',unassignedReason:'2.0 담당을 찾지 못해 관리자 대기열',rule:'2.0 할 일 담당'},1),status:'ready'}];
    state.cases.push(c);const e=evt(c,'source.task_opened',t.title,null,{origin:'snapshot',targetActorIds:ids});
    c.trigger={eventId:e.id,type:'source.task_opened',label:t.title,actorId:null,at:t.opened};refresh(c);c.updatedAt=t.opened;
  });
  const pools={absence:db.students.filter(s=>s.status==='enrolled'&&s.attendance.absent>0).map(s=>s.id),billing:db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).map(i=>i.id)};

  const flow=()=>({schemaVersion:1,asOf:db.meta.asOf,revision:state.revision,mode:'local-preview',actors,entities:[],relations:[],cases:state.cases,casesTotal:state.cases.length,casePage:1,casePageSize:500,casePageCount:1,events:state.events.slice(-200),eventsTotal:state.events.length,
    metrics:{cases:{total:state.cases.length},bottlenecks:[]},aiStatus:{providers:[{id:'jev',label:'Jev 판정',status:'unavailable',reason:'판정 키가 설정되지 않음'},{id:'claude-cli',label:'Claude 초안',status:'unavailable',reason:'초안 모듈 연결 전'}]}});
  const fail=(status,error,message,extra={})=>({status,body:{error,message,...extra}});
  const pick=(c,p,pred,actor)=>{const list=c.steps.filter(s=>(!p.stepId||s.id===p.stepId)&&pred(s));const mine=list.filter(s=>s.assigneeIds.includes(actor.id)||s.queue==='manager'&&!s.assigneeIds.length&&['owner','manager'].includes(actor.role));return !list.length?fail(409,'step_not_ready','지금 처리할 단계가 없습니다.'):!mine.length?fail(403,'not_assignee','이 단계의 담당자가 아닙니다.'):mine[0];};
  const okAssignees=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=10&&new Set(ids).size===ids.length&&ids.every(id=>byId.get(id)&&!byId.get(id).preview);

  function apply(body,actor){
    const p=body.payload||{},c=body.caseId?find(body.caseId):null;
    if(body.caseId&&!c)return fail(404,'case_not_found','업무를 찾을 수 없습니다.');
    switch(body.kind){
      case 'request.create':{
        if(!String(p.title||'').trim()||String(p.title).length>80||!String(p.body||'').trim()||String(p.body).length>2000)return fail(400,'invalid_request','제목(80자)과 내용(2,000자)을 입력해 주세요.');
        if(!okAssignees(p.assigneeIds))return fail(400,'assignee_not_allowed','배정할 수 없는 사람이 있습니다.');
        if(p.recordRefs!==undefined&&(!Array.isArray(p.recordRefs)||p.recordRefs.some(r=>typeof r!=='string'||!/^[a-z_]{2,30}:[A-Za-z0-9:_-]{1,80}$/.test(r))))return fail(400,'record_ref_not_allowed','이 업무와 관련된 기록만 근거로 붙일 수 있습니다.');
        const id=`loc-${state.cases.length+1}`,n=base(id,{kind:'request',scenario:null,familyId:p.familyId||'tasks-notifications',title:p.title.trim(),summary:p.body.trim(),priority:p.priority||'normal',dueAt:p.dueAt||null,channels:p.channels||['app'],requestSource:p.source||{kind:'direct'},watchers:[actor.id],
          entityRefs:(p.recordRefs||[]).map(k=>{const [type,rid]=k.split(':');const s=type==='student'&&db.students.find(x=>x.id===rid);return {type,id:rid,label:s?.name||'기록',familyId:type==='student'?'students':'',recordId:rid};})});
        n.steps=[...p.assigneeIds.map((a,i)=>step(id,i+1,{key:'assignee_report',label:`${byId.get(a).name} 확인·보고`,role:'assignee',evidenceRequired:true},{assigneeIds:[a],queue:null,rule:'요청한 사람이 지정'},1)),step(id,p.assigneeIds.length+1,{key:'manager_review',label:'관리자 검토 후 마감',role:'manager',review:true},resolve('manager'),2)];
        state.cases.push(n);const e=evt(n,'request.created','업무 요청',actor.id,{targetActorIds:p.assigneeIds});n.trigger={eventId:e.id,type:'request.created',label:'업무 요청',actorId:actor.id,at:e.at};advance(n,actor.id);
        return {caseId:id};
      }
      case 'event.simulate':{
        const tpl=TEMPLATES[p.scenario];if(!tpl)return fail(400,'invalid_request','지원하지 않는 시나리오입니다.');
        const pool=pools[p.scenario];let rid=p.recordRef===undefined?null:String(typeof p.recordRef==='object'?p.recordRef?.id:p.recordRef).replace(/^[a-z_]+:/,'');
        if(rid&&!pool.includes(rid))return fail(400,'record_ref_not_allowed','이 시나리오에 쓸 수 있는 실제 기록이 아닙니다.');
        rid=rid||pool[0];if(!rid)return fail(409,'no_source_record','시나리오에 쓸 실제 기록이 없습니다.');
        const key=`${p.scenario}:${rid}`,dup=state.cases.find(x=>x.kind==='scenario'&&x.scenarioKey===key&&x.state!=='done');
        if(dup)return {caseId:dup.id,duplicate:true};
        const student=db.students.find(s=>s.id===rid),bill=db.invoices.find(i=>i.id===rid),cls=student&&db.classes.find(k=>k.students.includes(student.id)),teacher=cls&&byId.get(cls.teacherId)?cls.teacherId:null;
        const refs=p.scenario==='absence'?[{type:'student',id:student.id,label:student.name,familyId:'students',recordId:student.id},...(cls?[{type:'class',id:cls.id,label:cls.name,familyId:'classes',recordId:cls.id}]:[])]:[{type:'invoice',id:bill.id,label:`${bill.period} 청구`,familyId:'billing',recordId:bill.id},...(db.students.find(s=>s.id===bill.studentId)?[{type:'student',id:bill.studentId,label:db.students.find(s=>s.id===bill.studentId).name,familyId:'students',recordId:bill.studentId}]:[])];
        const id=`loc-${state.cases.length+1}`,n=base(id,{kind:'scenario',scenario:p.scenario,scenarioKey:key,familyId:tpl.familyId,title:`${tpl.title} — ${student?.name||bill?.name||'기록'}`,summary:`${refs[0].label} 기록으로 만든 로컬 시나리오입니다. 원본 기록은 바뀌지 않습니다.`,entityRefs:refs,watchers:[actor.id]});
        n.steps=tpl.steps.map((d,i)=>step(id,i+1,d,resolve(d.role,{teacher}),i+1));state.cases.push(n);
        const e=evt(n,tpl.trigger[0],tpl.trigger[1],actor.id);n.trigger={eventId:e.id,type:tpl.trigger[0],label:tpl.trigger[1],actorId:actor.id,at:e.at};
        evt(n,'decision.requested','판정 요청',actor.id);advance(n,actor.id);
        n.decision=unavailable();n.flags.needsReview=true;evt(n,'decision.recorded','판정 사용 불가 — 사람 검토',actor.id);
        return {caseId:id,decision:'unavailable'};
      }
      case 'case.ack':{const s=pick(c,p,x=>x.status==='ready'&&!x.review,actor);if(s.status&&s.body)return s;if(!s.assigneeIds.length)s.assigneeIds=[actor.id];s.status='working';evt(c,'step.acknowledged','확인함',actor.id,{stepId:s.id,targetActorIds:c.watchers});refresh(c);return {caseId:c.id};}
      case 'case.report':{
        const s=pick(c,p,x=>(x.status==='ready'||x.status==='working')&&!x.review,actor);if(s.status&&s.body)return s;
        if(String(p.note||'').trim().length<2)return fail(400,'evidence_required','처리 결과를 2자 이상 적어 주세요.');
        if(p.outcome!==undefined&&!OUTCOMES.includes(p.outcome))return fail(400,'invalid_request','outcome 값이 올바르지 않습니다.');
        const allowed=new Set(c.entityRefs.map(r=>`${r.type}:${r.id}`));if((p.recordRefs||[]).some(k=>!allowed.has(k)))return fail(400,'record_ref_not_allowed','이 업무와 관련된 기록만 근거로 붙일 수 있습니다.');
        const ev={id:`ev-${state.seq+1}`,note:p.note.trim(),recordRefs:(p.recordRefs||[]).map(k=>c.entityRefs.find(r=>`${r.type}:${r.id}`===k)),actorId:actor.id,at:now(),stepId:s.id,outcome:p.outcome||'done'};
        if(c.closure==='fact'){
          const id=`loc-${state.cases.length+1}`,f=base(id,{kind:'request',scenario:null,familyId:c.familyId,title:`${c.title} — 후속 보고`,summary:'원본 할 일은 원본 기록이 바뀔 때 닫힙니다. 이 보고는 로컬 기록입니다.',entityRefs:c.entityRefs.slice(0,10),linkedCaseIds:[c.id],evidence:[ev],watchers:[actor.id]});
          f.steps=[{...step(id,1,{key:'followup_report',label:'후속 보고',role:'source',evidenceRequired:true},{assigneeIds:[actor.id],queue:null,rule:'원본 할 일 담당'},1),status:'done'}];state.cases.push(f);
          c.linkedCaseIds.push(id);c.evidence.push({...ev,followupCaseId:id});evt(c,'followup.linked','원본 할 일의 후속 보고',actor.id,{stepId:s.id});evt(f,'step.reported','결과 보고',actor.id,{stepId:f.steps[0].id});advance(f,actor.id);refresh(c);
          return {caseId:id};
        }
        s.status='done';if(!s.assigneeIds.length)s.assigneeIds=[actor.id];c.evidence.push(ev);if(['needs_review','unreachable'].includes(ev.outcome))c.flags.needsReview=true;
        evt(c,'step.reported','결과 보고',actor.id,{stepId:s.id});advance(c,actor.id);return {caseId:c.id};
      }
      case 'case.review':{
        if(!['accept','return'].includes(p.decision))return fail(400,'invalid_request','decision은 accept 또는 return입니다.');
        if(c.closure==='fact')return fail(409,'fact_case','원본 할 일은 원본 기록이 바뀔 때만 닫힙니다.');
        const s=pick(c,p,x=>x.status==='ready'&&x.review,actor);if(s.status&&s.body)return s;
        if(p.decision==='return'){
          if(String(p.note||'').trim().length<2)return fail(400,'evidence_required','보완 요청 사유를 적어 주세요.');
          const last=Math.max(0,...c.steps.filter(x=>x.group<s.group&&!x.skipped).map(x=>x.group)),prev=c.steps.filter(x=>x.group===last&&!x.skipped);
          prev.forEach(x=>{x.status='ready';});s.status='waiting';
          c.evidence.push({id:`ev-r${state.seq+1}`,note:p.note.trim(),recordRefs:[],actorId:actor.id,at:now(),stepId:s.id,outcome:'returned'});
          evt(c,'step.returned','보완 요청',actor.id,{stepId:s.id,targetActorIds:[...new Set(prev.flatMap(x=>x.assigneeIds))]});refresh(c);return {caseId:c.id};
        }
        s.status='done';if(!s.assigneeIds.length)s.assigneeIds=[actor.id];if(p.note)c.evidence.push({id:`ev-a${state.seq+1}`,note:p.note.trim(),recordRefs:[],actorId:actor.id,at:now(),stepId:s.id,outcome:'accepted'});
        evt(c,'step.reviewed','검토 완료',actor.id,{stepId:s.id});advance(c,actor.id);return {caseId:c.id};
      }
      case 'case.reassign':{
        if(!okAssignees(p.assigneeIds))return fail(400,'assignee_not_allowed','배정할 수 없는 사람이 있습니다.');
        const s=c.steps.find(x=>(p.stepId?x.id===p.stepId:true)&&(x.status==='ready'||x.status==='working'));if(!s)return fail(409,'step_not_ready','담당을 바꿀 진행 중 단계가 없습니다.');
        s.assigneeIds=p.assigneeIds;s.queue=null;s.unassignedReason=null;s.status='ready';s.rule='관리자가 직접 지정(재배정)';
        evt(c,'step.reassigned','담당 변경',actor.id,{stepId:s.id,targetActorIds:p.assigneeIds});refresh(c);return {caseId:c.id};
      }
      case 'case.reopen':{
        if(c.closure==='fact')return fail(409,'fact_case','원본 할 일은 다시 열 수 없습니다.');if(c.state!=='done')return fail(409,'not_done','완료된 업무만 다시 열 수 있습니다.');
        if(String(p.note||'').trim().length<2)return fail(400,'evidence_required','다시 여는 사유를 적어 주세요.');
        const last=Math.max(...c.steps.filter(x=>!x.skipped).map(x=>x.group));c.steps.filter(x=>x.group===last&&!x.skipped).forEach(x=>{x.status='ready';});
        evt(c,'case.reopened','다시 열림',actor.id,{targetActorIds:c.assigneeIds});refresh(c);return {caseId:c.id};
      }
      case 'case.analyze':evt(c,'decision.requested','판정 요청',actor.id);c.decision=unavailable();if(c.closure!=='fact')c.flags.needsReview=true;evt(c,'decision.recorded','판정 사용 불가 — 사람 검토',actor.id);return {caseId:c.id,decision:'unavailable'};
      default:return fail(400,'invalid_request','지원하지 않는 작업입니다.');
    }
  }
  function handle(body){
    state.calls.push(body);
    if(!body||typeof body!=='object'||!/^[A-Za-z0-9_-]{8,80}$/.test(body.commandId||''))return fail(400,'invalid_request','요청 형식이 올바르지 않습니다.');
    const seen=state.commands.get(body.commandId);if(seen)return {status:200,body:{...seen,replayed:true}};
    const actor=byId.get(body.actorId);if(!actor)return fail(403,'actor_not_allowed','미리보기 직원 목록에 없는 사람입니다.');
    if(!ROLES[body.kind]?.includes(actor.role))return fail(403,'action_not_allowed','이 역할로는 할 수 없는 작업입니다.');
    if(body.expectedRevision!==state.revision)return fail(409,'revision_conflict','다른 사람이 먼저 바꿨습니다. 새로 고친 뒤 다시 시도해 주세요.',{revision:state.revision});
    const out=apply(body,actor);if(out.status&&out.body)return out;
    if(!out.duplicate)state.revision+=1;
    const result={revision:state.revision,caseId:out.caseId,eventIds:[],...(out.duplicate?{duplicate:true}:{}),...(out.decision?{decision:out.decision}:{})};
    state.commands.set(body.commandId,result);
    return {status:200,body:result};
  }
  return {state,actors,flow,handle,owner,manager,desk,cashier};
}

// Route the flow endpoints to the stand-in only when the server under test does not provide them.
export async function installFlowRoutes(page,{base,db}){
  const probe=await fetch(base+'/api/flow',{headers:{Accept:'application/json'}}).catch(()=>null);
  let served=false;if(probe?.ok){try{const json=await probe.json();served=Array.isArray(json.cases);}catch{served=false;}}
  if(served)return {served:true,mock:null};
  const mock=createFlowMock(db);
  await page.route(`${base}/api/flow`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mock.flow())}));
  await page.route(`${base}/api/flow/actions`,async route=>{const r=mock.handle(route.request().postDataJSON());await route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.body)});});
  return {served:false,mock};
}
