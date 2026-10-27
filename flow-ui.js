/* Flow UI: one durable work flow (GET /api/flow, POST /api/flow/actions) seen from a previewed person.
   The server is the source of truth: cases, steps, evidence and the event chain come from it, and every change is a
   command with a stable commandId and the last seen revision. Nothing here authenticates anyone, sends a message or
   writes the copied records — the overlay is local and the preview selector only chooses whose work to show. */
window.createFlowUI = function createFlowUI(api) {
  'use strict';
  const {db,h,fmt,icon,dialog,navigate,toast,ax}=api;
  const $=s=>document.querySelector(s);
  const ENDPOINT='/api/flow',ACTIONS='/api/flow/actions',ACTOR_KEY='ax-flow-preview-actor';
  const STATE={open:'열림',working:'진행 중',review:'검토 대기',done:'완료'};
  const STEP={waiting:'대기',ready:'할 차례',working:'진행 중',review:'검토 차례',done:'완료'};
  const OUTCOME={done:'처리함',needs_review:'검토 필요',unreachable:'연락 안 됨',not_needed:'해당 없음'};
  // Judgment codes from the server's decision modules are translated here; unknown codes are never shown.
  const ROUTE={auto_route:'정해진 담당자에게 바로 배정',no_action:'할 일 없음으로 판단',manager_review:'관리자 검토로 보냄',human_review:'사람이 판단하도록 보냄',insufficient_context:'정보가 부족해 사람이 되묻도록 보냄'};
  const AREA={attendance:'출결',billing:'수납',counseling:'상담',academic:'학업',enrollment:'신규 상담',staff_hr:'직원·인사',operations:'운영'};
  const URGENCY={today:'오늘 처리',this_week:'며칠 안에',no_deadline:'급하지 않음'};
  const CONCERN={none:'배정에 이견 없음',route_may_be_wrong:'배정이 맞지 않을 수 있음',needs_more_context:'정보가 더 필요함'};
  const PROVIDER={typesafe:'Jev 판정',jev:'Jev 판정','claude-cli':'Claude 초안',claude:'Claude 초안'};
  const REASON={safety_signal:'안전·법적 우려 신호가 보였습니다',known_open_work_guard:'이미 열린 관련 업무가 있습니다',uncertain_action:'할 일인지 확실하지 않습니다',manager_review_signal:'관리자 확인이 필요해 보입니다',personnel_always_reviewed:'직원·인사 문제는 늘 사람이 확인합니다',multiple_areas:'여러 업무 영역에 걸쳐 있습니다',area_unclear:'업무 영역이 분명하지 않습니다',uncertain_area:'업무 영역 판단이 확실하지 않습니다',context_insufficient:'판단할 정보가 부족합니다',missing_link:'학생·반·청구 연결이 부족합니다',no_eligible_staff:'배정할 수 있는 담당자가 없습니다',no_eligible_manager:'배정할 수 있는 관리자가 없습니다',no_open_task:'열린 할 일이 없습니다',no_content:'판단할 내용이 없습니다',auto_route_thresholds_met:'자동 배정 기준을 넘었습니다',cancelled:'판정이 취소되었습니다',decision_module_unavailable:'판정 모듈이 아직 연결되지 않았습니다',decision_call_failed:'판정 호출이 실패했습니다',local_rate_limit:'이 화면의 판정 호출 한도에 걸렸습니다',jev_not_configured:'판정 키가 설정되지 않았습니다',jev_timeout:'판정 응답이 늦어 멈췄습니다',jev_rate_limited:'판정 서비스 호출 한도에 걸렸습니다',jev_overloaded:'판정 서비스가 바쁩니다',jev_unavailable:'판정 서비스에 연결하지 못했습니다',jev_circuit_open:'판정 서비스 오류가 이어져 잠시 쉬고 있습니다',jev_auth_failed:'판정 키 인증에 실패했습니다',jev_key_error:'판정 키를 읽지 못했습니다',jev_invalid_answer:'판정 응답 형식이 올바르지 않았습니다',jev_request_rejected:'판정 요청이 거절되었습니다',jev_config:'판정 설정이 올바르지 않습니다',adapter_busy:'판정 대기열이 가득 찼습니다',context_too_large:'판정할 내용이 너무 깁니다',rate_limited:'호출 한도에 걸렸습니다',http_error:'판정 서비스 오류가 났습니다'};
  const reasonText=code=>{const c=String(code||'').trim();if(/[가-힣]/.test(c))return c;if(REASON[c])return REASON[c];if(c.startsWith('signals_conflict'))return '판정 신호가 서로 맞지 않습니다';if(c.startsWith('invalid_context'))return '판정에 넘긴 정보가 올바르지 않습니다';return '';};
  const pct=p=>Number.isFinite(Number(p))&&p!==null?`${Math.round(Number(p)*100)}%`:'';
  const modelLabel=m=>{const x=String(m||'');const jev=/^jev-(\d+)\.(\d+)/.exec(x);return jev?`Jev ${jev[1]}.${jev[2]}`:/^claude/i.test(x)?'Claude':'';};
  // Assignment rules are written for people; drop parenthesised source identifiers (column or table names).
  const ruleText=r=>String(r||'').replace(/\s*\([^)]*[A-Za-z_]{2,}[^)]*\)/g,'').trim();
  const PRIORITY={high:'높음',normal:'보통',low:'낮음'};
  const ORIGIN={snapshot:'복사본 기록',dev:'로컬 미리보기'};
  const CLOSURE={fact:'원본 기록이 처리되면 닫힙니다',manual:'사람이 확인하고 보고해 닫습니다'};
  const ROLE_ORDER=['owner','manager','teacher','staff'],ROLE_GROUP={owner:'원장',manager:'관리자',teacher:'선생님',staff:'직원'};
  const store={status:'idle',flow:null,error:'',controller:null,pending:new Set(),actorId:'',filter:'',all:'',deferred:false,retry:0,etag:'',older:new Map(),partial:false};
  try{store.actorId=localStorage.getItem(ACTOR_KEY)||'';}catch{/* storage unavailable: first owner actor is used */}
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const btn=(text,action,attrs='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-fl="${action}" ${attrs}>${h(text)}</button>`;
  const when=at=>{const d=String(at||'');return d?`${d.slice(5,10).replace('-','.')}${d.length>10?` ${d.slice(11,16)}`:''}`:'시각 미입력';};

  /* ---------- store ---------- */
  const ready=()=>store.status==='ready'&&Boolean(store.flow);
  const flow=()=>store.flow||{actors:[],cases:[],events:[],entities:[],relations:[],metrics:{}};
  const actors=()=>Array.isArray(flow().actors)?flow().actors:[];
  const actorById=id=>actors().find(a=>a.id===id);
  const nameOf=id=>actorById(id)?.name||db.staff.find(s=>s.id===id)?.name||'담당 미정';
  const actor=()=>actorById(store.actorId)||actors().find(a=>a.role==='owner')||actors()[0]||null;
  const role=()=>actor()?.role||'owner';
  const cases=()=>Array.isArray(flow().cases)?flow().cases:[];
  const caseById=id=>cases().find(c=>c.id===id);
  const events=()=>Array.isArray(flow().events)?flow().events:[];
  const eventById=id=>events().find(e=>e.id===id)||store.older.get(id);
  const lead=()=>['owner','manager'].includes(role());
  const isReview=s=>Boolean(s&&(s.review===true||s.status==='review'));
  const activeSteps=c=>c.state==='done'?[]:(c.steps||[]).filter(s=>!s.skipped&&['ready','working','review'].includes(s.status));
  const queued=s=>Boolean(s&&s.queue==='manager'&&!(s.assigneeIds||[]).length);
  // The step this person can act on now: one assigned to them, or (owner/manager) one waiting in the manager queue.
  // Several steps can be open at once (a request to many people opens one step each).
  function myStep(c,id=actor()?.id){const list=activeSteps(c);return list.find(s=>(s.assigneeIds||[]).includes(id))||(id===actor()?.id&&lead()?list.find(queued):null)||null;}
  const stepOf=c=>(c.steps||[]).find(s=>s.id===c.currentStepId)||activeSteps(c)[0]||null;
  const asOf=()=>String(flow().asOf||db.meta.asOf).slice(0,10);
  const late=c=>c.state!=='done'&&c.dueAt&&String(c.dueAt).slice(0,10)<asOf();
  // Nobody resolved for an open step (the manager queue by design, e.g. a review, is not "no one").
  const unassigned=c=>activeSteps(c).some(s=>!(s.assigneeIds||[]).length&&(!s.queue||Boolean(s.unassignedReason)));
  const mine=(c,id)=>Boolean(myStep(c,id));
  const inReview=c=>c.state==='review'||activeSteps(c).some(isReview);
  const returned=c=>{if(c.state==='done')return false;const last=(c.history||[]).map(eventById).filter(e=>e&&/\.(returned|reported|reviewed|accepted)$/.test(e.type)).at(-1);return Boolean(last&&/returned$/.test(last.type));};
  const local=c=>c.origin==='dev';
  const newest=list=>[...list].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  const assignable=a=>a&&!a.preview&&a.assignable!==false;
  const editing=()=>{const a=document.activeElement;return Boolean(a&&a.closest('#main')&&a.matches('input,textarea,select,[contenteditable="true"]'));};
  // Reads never call AI. An unchanged revision leaves the screen exactly as it is (no re-render, scroll and focus kept).
  async function load({quiet=false}={}){
    store.controller?.abort();const controller=new AbortController();store.controller=controller;
    if(!store.flow)store.status='loading';
    try{
      const response=await fetch(ENDPOINT,{headers:{Accept:'application/json',...(store.etag&&store.flow&&!store.partial?{'If-None-Match':store.etag}:{})},signal:controller.signal});
      if(response.status===304&&store.flow)return;
      let json=null;try{json=await response.json();}catch{/* not JSON: no flow endpoint on this server */}
      if(response.ok)store.etag=response.headers.get('ETag')||'';
      if(response.ok&&json&&Array.isArray(json.cases)){
        const prev=store.flow,wasReady=store.status==='ready';
        if(wasReady&&!store.partial&&prev&&prev.revision===json.revision&&prev.eventsTotal===json.eventsTotal&&prev.asOf===json.asOf)return;
        json=await allPages(json,controller.signal);if(!json)return;
        const before=prev?new Set(cases().filter(c=>mine(c)).map(c=>c.id)):null;
        store.flow=json;store.status='ready';store.error='';store.retry=0;
        if(before&&!quiet)announce(before);
      }
      else if(response.status===503&&json){store.status=store.flow?'ready':'starting';store.error=message(json,503);if(store.retry++<5)setTimeout(()=>load({quiet}),3000);}
      else if(!json||[404,405,501].includes(response.status)){store.status='unavailable';store.flow=null;}
      else{store.status='error';store.error=message(json,response.status);}
    }catch{if(controller.signal.aborted)return;store.status=store.flow?'ready':'error';store.error='업무 흐름 서버에 연결하지 못했습니다.';}
    paint();
  }
  // Cases come in pages of casePageSize. Every page must answer with the head's revision and page count (a change in
  // between restarts the read with a fresh head, up to three times). Reading stops at 40 pages; anything short of the
  // whole set is shown with a note (loaded and total counts), never as a silent zero.
  const MAX_PAGES=40;
  async function allPages(first,signal){
    if((Number(first.casePageCount)||1)<=1){store.partial=false;return first;}
    let best=first;
    for(let attempt=0;attempt<3;attempt++){
      const head=attempt?await (await fetch(ENDPOINT,{headers:{Accept:'application/json'},signal})).json():first;
      if(!head||!Array.isArray(head.cases))break;
      const total=Number(head.casePageCount)||1,count=Math.min(total,MAX_PAGES),pages=[head];
      for(let p=2;p<=count;p++){const r=await fetch(`${ENDPOINT}?casePage=${p}`,{headers:{Accept:'application/json'},signal});const j=await r.json().catch(()=>null);if(!r.ok||!j||!Array.isArray(j.cases)||j.revision!==head.revision||(Number(j.casePageCount)||1)!==total)break;pages.push(j);}
      const seen=new Set(),merged={...head,cases:pages.flatMap(x=>x.cases).filter(c=>!seen.has(c.id)&&seen.add(c.id))};
      if(pages.length===count){store.partial=count<total;return merged;}
      best=merged;
    }
    store.partial=true;return best;
  }
  // Reads older event pages until this case's whole history is present (or nothing older is left), at most 10 reads.
  async function loadOlder(id){
    const wanted=()=>(caseById(id)?.history||[]).filter(e=>!eventById(e)).length;
    try{
      for(let i=0;i<10&&wanted();i++){
        const nums=[...events(),...store.older.values()].map(e=>Number(String(e.id).replace(/^\D+/,''))).filter(Number.isFinite);if(!nums.length)break;
        const r=await fetch(`${ENDPOINT}?eventsBefore=${Math.min(...nums)}`,{headers:{Accept:'application/json'}});const j=await r.json(),list=Array.isArray(j?.events)?j.events:[];
        if(!r.ok||!list.length)break;
        list.forEach(e=>{if(e&&e.id&&!events().some(x=>x.id===e.id))store.older.set(e.id,e);});
      }
    }catch{toast('이전 사건을 불러오지 못했습니다.');}
    if(caseById(id))showCase(id);
  }
  // New work for the previewed person arrives without them looking around.
  function announce(before){
    const fresh=cases().filter(c=>mine(c)&&!before.has(c.id));if(!fresh.length)return;
    toast(fresh.length===1?`새로 들어온 일: ${fresh[0].title}`:`새로 들어온 일 ${fresh.length}건 · ${fresh[0].title} 외`);
  }
  let pressing=false;
  function paint(){
    if(editing()||pressing){store.deferred=true;return;}
    store.deferred=false;api.render();refreshDetail();
  }
  const flush=()=>{if(store.deferred&&!editing()&&!pressing)paint();};
  addEventListener('pointerdown',()=>{pressing=true;},true);
  // The click is dispatched right after pointerup; repaint after it so the press lands where it began.
  addEventListener('pointerup',()=>{pressing=false;if(store.deferred)setTimeout(flush,50);},true);
  addEventListener('pointercancel',()=>{pressing=false;if(store.deferred)setTimeout(flush,50);},true);
  addEventListener('blur',()=>{pressing=false;});
  // An open case drawer follows the server too, unless the person is writing in it.
  function refreshDetail(){
    const d=$('#detail[open]'),root=d?.querySelector('[data-fl-case-root]');if(!root)return;
    if(d.querySelector('form')&&d.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select'))return;
    const id=root.dataset.flCaseRoot,scroller=[...d.querySelectorAll('*')].find(n=>n.scrollTop>0),top=scroller?.scrollTop||0;
    const focus=document.activeElement&&d.contains(document.activeElement)?document.activeElement.dataset.fl:'';
    if(!caseById(id))return;showCase(id);
    if(top){const next=[...d.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight&&getComputedStyle(n).overflowY!=='visible');if(next)next.scrollTop=top;}
    if(focus)d.querySelector(`[data-fl="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  document.addEventListener('focusout',()=>{if(store.deferred&&!pressing)setTimeout(flush,0);});
  const ERROR={revision_conflict:'다른 변경이 먼저 반영되어 화면을 새로 불러왔습니다. 내용을 확인하고 다시 시도해 주세요.',command_conflict:'같은 요청이 다른 내용으로 이미 처리되었습니다.',step_not_ready:'지금 처리할 단계가 없습니다. 화면을 새로 불러왔습니다.',not_assignee:'이 단계의 담당자가 아닙니다.',fact_case:'원본 할 일은 원본 기록이 처리되어야 닫힙니다.',not_done:'완료된 업무만 다시 열 수 있습니다.',no_source_record:'시나리오에 쓸 실제 기록이 없습니다.',evidence_required:'근거 내용을 적어 주세요.',assignee_not_allowed:'배정할 수 없는 사람이 있습니다.',record_ref_not_allowed:'이 업무와 관련된 기록만 근거로 붙일 수 있습니다.',actor_not_allowed:'미리보기 직원 목록에 없는 사람입니다.',action_not_allowed:'이 역할로는 할 수 없는 작업입니다.',case_not_found:'업무를 찾을 수 없습니다.',flow_starting:'업무 흐름 서버가 준비 중입니다. 잠시 뒤 다시 시도해 주세요.',flow_state_mismatch:'업무 흐름 기록이 복사본과 맞지 않아 멈췄습니다.',store_locked:'다른 처리가 저장 중입니다. 잠시 뒤 다시 시도해 주세요.',store_write_failed:'저장하지 못했습니다. 아무것도 바뀌지 않았습니다.'};
  // Server messages are shown only when they are written for people (Korean); otherwise a translated fallback.
  // A conflict or a vanished step is already handled by reloading, so the screen says what it did.
  function message(json,status){if(['revision_conflict','step_not_ready'].includes(json?.error))return ERROR[json.error];const m=typeof json?.message==='string'&&/[가-힣]/.test(json.message)?json.message:'';return m||ERROR[json?.error]||(status>=500?'업무 흐름 서버 오류로 반영하지 못했습니다.':'요청을 처리하지 못했습니다.');}
  // One command per user action: stable commandId (kept on retry), last seen revision, button locked while pending.
  async function command(kind,{caseId='',payload={},key=`${kind}:${caseId}`,actorId=actor()?.id}={}){
    if(store.pending.has(key)){toast('같은 요청을 처리하고 있습니다. 잠시만 기다려 주세요.');return null;}
    if(!ready()){toast('업무 흐름 서버에 연결되지 않아 반영할 수 없습니다.');return null;}
    store.pending.add(key);markPending(key,true);
    const body={commandId:crypto.randomUUID(),expectedRevision:flow().revision,actorId,kind,...(caseId?{caseId}:{}),payload};
    // What a person acts on: steps, evidence and state (a judgment settling on the case does not change it).
    const stamp=c=>c?JSON.stringify([c.state,(c.evidence||[]).length,(c.steps||[]).map(x=>[x.id,x.status,x.assigneeIds])]):'none';
    const tries={net:0,lock:0,conflict:0};
    try{
      for(;;){
        let response;
        // Same commandId on every retry: the server replays the first result instead of applying twice.
        try{response=await fetch(ACTIONS,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});}
        catch{if(tries.net++<1)continue;toast('업무 흐름 서버에 연결하지 못했습니다. 다시 시도해 주세요.');return null;}
        let json=null;try{json=await response.json();}catch{/* error without body */}
        if(response.ok){if(json?.flow&&Array.isArray(json.flow.cases)){store.flow=json.flow;store.status='ready';paint();}else await load({quiet:true});return json||{};}
        if(response.status===503&&json?.error==='store_locked'&&tries.lock++<1){await new Promise(r=>setTimeout(r,600));continue;}
        if(response.status===409&&json?.error==='revision_conflict'){
          const before=stamp(caseId&&caseById(caseId));await load({quiet:true});
          // The change came from other work: retry once on the fresh revision. If this case moved, the person decides again.
          if(tries.conflict++<1&&(!caseId||stamp(caseById(caseId))===before)){body.expectedRevision=flow().revision;continue;}
          toast(message(json,409));return null;
        }
        if(response.status===409){await load({quiet:true});toast(message(json,409));return null;}
        toast(message(json,response.status));return null;
      }
    }finally{store.pending.delete(key);markPending(key,false);}
  }
  function markPending(key,on){document.querySelectorAll(`[data-fl-key="${CSS.escape(key)}"]`).forEach(b=>{b.disabled=on;b.setAttribute('aria-busy',String(on));});}
  // Incoming work shows up without a reload: a light read every 8 seconds while the tab is visible.
  addEventListener('focus',()=>{if(ready())load();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ready())load();});
  setInterval(()=>{if(ready()&&document.visibilityState==='visible'&&!store.pending.size)load();},8000);

  /* ---------- shared pieces ---------- */
  function entityLinks(c){
    const refs=(c.entityRefs||[]).filter(r=>r&&r.label);if(!refs.length)return '';
    return `<div class="fl-entities" aria-label="관련 기록">${refs.slice(0,6).map(r=>{const ws=r.familyId&&api.hasView(`workspace-${r.familyId}`);return `<button type="button" class="fl-entity" data-fl="entity" data-family="${h(r.familyId||'')}" data-record="${h(r.recordId||r.id||'')}" ${ws||api.canOpenRecord?.(r.recordId||r.id)?'':'disabled'}>${h(r.type==='task'&&r.label===c.title?'원본 할 일':r.label)}${r.familyId?`<small>${h(api.familyLabel?.(r.familyId)||'')}</small>`:''}</button>`;}).join('')}</div>`;
  }
  function why(c){
    const t=c.trigger||{},s=stepOf(c),d=c.decision;
    const who=t.actorId?nameOf(t.actorId):'';
    const reason=d?.status==='pending'||c.decisionPending===true?'판정 중':d&&dRoute(d)&&['ok','decided','review_needed'].includes(d.status)?`판정: ${dRoute(d)}${d.area&&AREA[d.area]?` · ${AREA[d.area]}`:''}${pct(d.probabilities?.actionNeeded)?` · 조치 필요 ${pct(d.probabilities.actionNeeded)}`:''}`:s?`${s.label}${s.roleLabel||ROLE_GROUP[s.role]?` · ${s.roleLabel||ROLE_GROUP[s.role]} 차례`:''}`:'';
    const start=t.label&&t.label!==c.title?t.label:c.closure==='fact'?'2.0에서 생긴 할 일':t.label||'시작 기록 없음',why=reason.startsWith(`${c.title} · `)?reason.slice(c.title.length+3):reason;
    return `<p class="fl-why"><span>${h(start)}</span>${who?`<span>${h(who)}</span>`:''}<span>${h(when(t.at||c.createdAt))}</span>${why?`<span>${h(why)}</span>`:''}</p>`;
  }
  function chips(c){return `${pill(ORIGIN[c.origin]||'출처 미입력',local(c)?'amber':'blue')}${pill(c.closure==='fact'&&c.sourceStatusLabel?`원본 ${c.sourceStatusLabel}`:STATE[c.state]||'상태 미확인')}${c.priority==='high'?pill('우선','amber'):''}${late(c)?pill('기한 지남','amber'):''}${unassigned(c)?pill('담당 없음','amber'):''}${c.flags?.needsReview&&c.state!=='done'?pill('사람 검토 필요','amber'):''}`;}
  const whoOf=s=>queued(s)?'관리자·원장 누구나':(s.assigneeIds||[]).map(nameOf).join(', ')||'담당 없음';
  function caseCard(c,{actions=true}={}){
    const s=myStep(c)||stepOf(c),open=activeSteps(c),links=(c.linkedCaseIds||[]).filter(caseById);
    return `<article class="fl-case" data-case="${h(c.id)}"><header><div class="ax-issue-meta">${chips(c)}</div><h3><button type="button" data-fl="open" data-id="${h(c.id)}">${h(c.title)}</button></h3></header>${c.summary?`<p class="fl-summary">${h(c.summary)}</p>`:''}${why(c)}${entityLinks(c)}${s?`<p class="fl-step">${s.label!==c.title?`${h(s.label)} · `:''}${h(s.skipped?'건너뜀':isReview(s)&&s.status==='ready'?STEP.review:STEP[s.status]||'상태 미확인')} · ${h(whoOf(s))}${open.length>1?` · 함께 열린 단계 ${open.length}개`:''}${c.dueAt?` · ${h(String(c.dueAt).slice(0,10))}까지`:''}${s.evidenceRequired?' · 근거 필요':''}</p>`:''}${links.length?`<p class="fl-step">후속 보고 ${links.length}건 · 원본 할 일은 2.0에서 처리되면 닫힙니다</p>`:''}${actions?actionBar(c):''}</article>`;
  }
  // What the previewed person can do on this case right now (the server still validates every command).
  function actionBar(c){
    const id=h(c.id),s=myStep(c),sk=s?h(s.id):'';
    if(c.state==='done')return `<div class="ax-actions">${lead()&&c.closure!=='fact'?btn('다시 열기','reopen-open',`data-id="${id}"`):''}${btn('근거와 흐름','open',`data-id="${id}"`)}</div>`;
    const out=[];
    if(s&&!isReview(s)&&s.status==='ready')out.push(btn('확인했습니다','ack',`data-id="${id}" data-step="${sk}" data-fl-key="case.ack:${id}"`,true));
    if(s&&!isReview(s))out.push(btn(c.closure==='fact'?'후속 보고 쓰기':'보고 쓰기','report-open',`data-id="${id}" data-step="${sk}"`,s.status==='working'));
    if(s&&isReview(s)&&lead())out.push(btn('검토','review-open',`data-id="${id}" data-step="${sk}"`,true));
    if(lead()&&activeSteps(c).length)out.push(btn(unassigned(c)?'담당 지정':'담당 바꾸기','reassign-open',`data-id="${id}"`));
    out.push(btn('근거와 흐름','open',`data-id="${id}"`));
    return `<div class="ax-actions">${out.join('')}</div>`;
  }
  const countCard=(label,value,detail,filter,tone='')=>`<button type="button" class="ax-signal fl-count ${tone}" data-fl="filter" data-id="${h(filter)}"><span class="ax-signal-kind"><span>${h(label)}</span></span><strong class="ax-signal-value">${fmt(value)}건</strong><span class="ax-signal-title">${h(detail)}</span><span class="ax-signal-go">아래에서 보기 ${icon('down')}</span></button>`;
  const stageCounts=list=>Object.keys(STATE).map(k=>[k,list.filter(c=>c.state===k).length]);
  function stateNote(){
    if(store.status==='loading'||store.status==='idle')return '<p class="ax-note" role="status">업무 흐름을 불러오는 중입니다.</p>';
    if(store.status==='ready'&&store.partial)return `<p class="ax-note" role="status">업무가 많아 앞쪽 ${fmt(cases().length)}건만 불러왔습니다(전체 ${fmt(Number(flow().casesTotal)||cases().length)}건). 잠시 뒤 다시 불러옵니다.</p>`;
    if(store.status==='starting')return `<p class="ax-note" role="status">${h(store.error||'업무 흐름 서버가 준비 중입니다.')} 잠시 뒤 다시 불러옵니다.</p>`;
    if(store.status==='unavailable')return '<p class="ax-note">업무 흐름 서버가 이 화면에 연결되지 않았습니다. 요청은 이 탭에서만 유지되고 새로고침하면 사라집니다.</p>';
    if(store.status==='error')return `<p class="ax-note" role="alert">${h(store.error)} ${btn('다시 불러오기','reload')}</p>`;
    return '';
  }
  function aiLine(){
    const s=flow().aiStatus;if(!s)return '<span>자동 판단 정보 없음</span>';
    const list=Array.isArray(s.providers)?s.providers:[s];
    return list.map(p=>`<span>${h(p.label||PROVIDER[p.id]||'자동 판정')} ${h({ok:'사용 가능',ready:'사용 가능',pending:'대기 중',unavailable:'사용 불가',error:'오류'}[p.status]||'상태 미확인')}${p.status!=='ready'&&p.status!=='ok'&&/[가-힣]/.test(p.reason||'')?` · ${h(p.reason)}`:''}</span>`).join('');
  }
  function sourceLine(){const f=flow();return `<p class="fl-source">${pill('로컬 미리보기 흐름','blue')}<span>복사본 기준일 ${h(asOf())}</span><span>변경 ${fmt(f.revision??0)}번째</span>${aiLine()}</p>`;}

  /* ---------- left: whose work to preview ---------- */
  function sidebar(page){
    if(!ready()||!actors().length)return '';
    const me=actor(),count=inboxCount();
    const groups=ROLE_ORDER.map(r=>[r,actors().filter(a=>a.role===r)]).filter(([,list])=>list.length);
    const flowLink=role()==='owner'?`<a class="nav-item ${page==='flow'?'active':''}" href="#flow" ${page==='flow'?'aria-current="page"':''}>${icon('check')}<span>업무 흐름</span>${count?`<span class="nav-count" aria-label="${count}건">${count}</span>`:''}</a>`:'';
    return `<div class="nav-group">보는 사람 · 미리보기</div><div class="fl-actor-pick"><label class="ax-visually-hidden" for="fl-actor">역할별 화면 미리보기</label><select id="fl-actor" data-fl-actor>${groups.map(([r,list])=>`<optgroup label="${h(ROLE_GROUP[r])}">${list.map(a=>`<option value="${h(a.id)}" ${a.id===me?.id?'selected':''}>${h(a.name)}${a.preview?'':` · ${h(a.roleLabel||ROLE_GROUP[a.role])}`}${(a.duties||[]).includes('desk')?' · 데스크':''}</option>`).join('')}</optgroup>`).join('')}</select>${flowLink}</div>`;
  }
  function inboxCount(){
    if(!ready())return 0;const r=role();
    if(r==='manager')return cases().filter(c=>mine(c)||unassigned(c)).length;
    return cases().filter(c=>mine(c)).length;
  }

  /* ---------- role views ---------- */
  function filterBar(active,items){return `<div class="ax-filter" role="group" aria-label="보기">${items.map(([id,label,n])=>`<button type="button" data-fl="filter" data-id="${h(id)}" aria-pressed="${active===id}">${h(label)} ${fmt(n)}</button>`).join('')}</div>`;}
  function list(items,empty,key=''){
    if(!items.length)return `<p class="live-empty">${h(empty)}</p>`;
    const all=!key||store.all===key||items.length<=20;
    return `<div class="fl-list" ${key?`data-list="${h(key)}"`:''}>${(all?items:items.slice(0,20)).map(c=>caseCard(c)).join('')}</div>${all?'':`<div class="ax-actions">${btn(`${fmt(items.length)}건 모두 보기`,'more',`data-id="${h(key)}"`)}</div>`}`;
  }
  function staffView(){
    const me=actor(),mineAll=cases().filter(c=>mine(c)),readyNow=newest(mineAll.filter(c=>myStep(c)?.status==='ready')),working=newest(mineAll.filter(c=>myStep(c)?.status!=='ready')),reviewing=cases().filter(c=>c.state!=='done'&&!mine(c)&&inReview(c)&&(c.evidence||[]).some(e=>e.actorId===me?.id));
    const done=cases().filter(c=>c.state==='done'&&(c.evidence||[]).some(e=>e.actorId===me?.id)).slice(0,6);
    return `<div class="fl-fold"><div class="page-heading"><div><h1>${h(me?.name||'')}님의 할 일</h1><p>${h(me?.roleLabel||'')} 화면 미리보기 · 다른 사람의 기록과 요청에서 생긴 일이 여기로 모입니다.</p></div></div>${sourceLine()}${stateNote()}<section class="ax-first" aria-label="지금 할 일"><div class="ax-signals">${countCard('지금 할 차례',readyNow.length,'확인하면 진행 중으로 바뀝니다','ready')}${countCard('진행 중',working.length,'보고를 남기면 다음 사람에게 넘어갑니다','working')}${countCard('검토 기다림',reviewing.length,'내가 보고한 일의 검토 상태','reviewing')}</div></section><div class="fl-now"><h2>지금 할 일 ${readyNow.length+working.length}건</h2>${list([...readyNow,...working],'지금 할 일이 없습니다. 다른 사람이 일을 넘기면 여기에 바로 보입니다.','now')}</div></div><section class="fl-section" id="fl-detail"><h2>검토 기다림 ${reviewing.length}건</h2>${list(reviewing,'검토를 기다리는 보고가 없습니다.','reviewing')}<h2>최근 끝낸 일</h2>${list(done,'아직 끝낸 일이 없습니다.')}</section>`;
  }
  function managerView(){
    const open=cases().filter(c=>c.state!=='done'),my=newest(open.filter(mine)),queue=open.filter(unassigned),overdue=open.filter(late),review=open.filter(inReview),back=open.filter(returned),chain=open.filter(c=>new Set((c.steps||[]).flatMap(s=>s.assigneeIds||[])).size>1);
    // A manager can also hold a step (e.g. teaches the class); their own turn comes first when there is one.
    const lists={mine:[my,'지금 내 차례인 일이 없습니다.'],queue:[queue,'담당자가 없는 일이 없습니다.'],late:[overdue,'기한이 지난 일이 없습니다.'],review:[review,'검토를 기다리는 일이 없습니다.'],returned:[back,'되돌린 일이 없습니다.'],chain:[chain,'여러 사람을 거치는 일이 없습니다.'],all:[open,'진행 중인 일이 없습니다.']};
    const f=lists[store.filter]?store.filter:my.length?'mine':'queue',[items,empty]=lists[f];
    return `<div class="fl-fold"><div class="page-heading"><div><h1>업무 조율</h1><p>${h(actor()?.name||'')} · ${h(actor()?.roleLabel||'')} 화면 미리보기 · 담당 없는 일·늦은 일·검토를 한곳에서 다룹니다.</p></div></div>${sourceLine()}${stateNote()}<section class="ax-first" aria-label="조율할 일"><div class="ax-signals">${my.length?countCard('내 차례',my.length,'내가 맡은 단계','mine','urgent'):''}${countCard('담당 없음',queue.length,'담당을 지정해야 다음 단계가 시작됩니다','queue','urgent')}${countCard('기한 지남',overdue.length,'기한이 지났고 끝나지 않은 일','late')}${countCard('검토 대기',review.length,'보고가 들어와 확인이 필요한 일','review')}${countCard('되돌림',back.length,'보완하라고 돌려보낸 일','returned')}</div>${scenarioPanel()}</section></div><section class="fl-section" id="fl-detail">${filterBar(f,[['mine','내 차례',my.length],['queue','담당 없음',queue.length],['late','기한 지남',overdue.length],['review','검토 대기',review.length],['returned','되돌림',back.length],['chain','여러 사람 거침',chain.length],['all','전체 진행',open.length]])}${list(items,empty,f)}${stageOverview()}</section>`;
  }
  function stageOverview(){
    const real=cases().filter(c=>!local(c)),dev=cases().filter(local),total=Number(flow().casesTotal)||cases().length;
    const jams=(flow().metrics?.bottlenecks||[]).filter(b=>b&&b.waiting>0&&/[가-힣]/.test(b.label||'')).slice(0,4);
    return `<section class="fl-stages" aria-label="단계별 흐름"><h2>단계별 흐름</h2><div class="fl-stage-row">${stageCounts(real).map(([k,n])=>`<div><span>${h(STATE[k])}</span><strong>${fmt(n)}</strong></div>`).join(`<i aria-hidden="true">${icon('chevron')}</i>`)}</div>${jams.length?`<p class="fl-jams">가장 많이 쌓인 곳 ${jams.map(b=>`<span>${h(b.label)} ${fmt(b.waiting)}건</span>`).join('')}</p>`:''}<p class="ax-note">복사본 기록에서 시작된 일 ${fmt(real.length)}건 기준입니다. 로컬 미리보기 ${fmt(dev.length)}건은 따로 셉니다.${total>cases().length?` 전체 ${fmt(total)}건 중 ${fmt(cases().length)}건을 불러왔습니다.`:''}</p></section>`;
  }
  // Owner: critical blocked handoffs, required decisions and stage counts on the first screen (cards reused by ax).
  function ownerCards(){
    if(!ready())return '';
    const open=cases().filter(c=>c.state!=='done'),decide=open.filter(c=>mine(c)),blocked=open.filter(c=>unassigned(c)||late(c)||returned(c)),moving=open.filter(c=>!local(c));
    return `${countCard('원장 결정',decide.length,decide[0]?decide[0].title:'지금 결정할 일이 없습니다','decide','urgent')}${countCard('막힌 인수인계',blocked.length,blocked.length?`담당 없음 ${open.filter(unassigned).length} · 기한 지남 ${open.filter(late).length}`:'막힌 일이 없습니다','blocked')}${countCard('진행 중인 흐름',moving.length,stageCounts(moving).filter(([k])=>k!=='done').map(([k,n])=>`${STATE[k]} ${n}`).join(' · '),'moving')}`;
  }
  function ownerStageCell(){
    if(!ready())return '';
    const real=cases().filter(c=>!local(c)),recent=events().filter(e=>e.origin!=='snapshot').slice(-1)[0];
    return `<div class="ax-change-cell"><button type="button" class="ax-change-link" data-fl="filter" data-id="moving"><span>업무 흐름 · 복사본 기준</span><strong>${fmt(real.filter(c=>c.state!=='done').length)}건 진행 중</strong><span class="ax-stages">${stageCounts(real).map(([k,n])=>`<span><b>${fmt(n)}</b>${STATE[k]}</span>`).join('')}</span><span class="ax-recent"><small>${recent?`최근 변화: ${h(recent.label||'')} · ${h(when(recent.at))}`:'아직 이 화면에서 생긴 변화가 없습니다.'}</small></span></button></div>`;
  }
  function ownerBelow(){
    if(!ready())return stateNote();
    const open=cases().filter(c=>c.state!=='done');
    const lists={decide:open.filter(c=>mine(c)),blocked:open.filter(c=>unassigned(c)||late(c)||returned(c)),moving:open.filter(c=>!local(c)),local:cases().filter(local),done:cases().filter(c=>c.state==='done')};
    const f=lists[store.filter]?store.filter:'decide';
    return `<section class="fl-section" id="fl-detail" aria-labelledby="fl-detail-title"><div class="ax-section-head"><h2 id="fl-detail-title" tabindex="-1">연결된 업무 흐름</h2>${sourceLine()}</div>${filterBar(f,[['decide','원장 결정',lists.decide.length],['blocked','막힌 인수인계',lists.blocked.length],['moving','진행 중',lists.moving.length],['local','로컬 미리보기',lists.local.length],['done','끝난 일',lists.done.length]])}${list(lists[f],'이 조건의 일이 없습니다.',f)}${scenarioPanel()}${stageOverview()}</section>`;
  }
  function fullView(){return role()==='owner'?`<div class="page-heading"><div><h1>업무 흐름</h1><p>원장 · 누가 어떤 일을 왜 맡았는지와 근거를 봅니다.</p></div></div>${ownerBelow()}`:role()==='manager'?managerView():staffView();}

  /* ---------- local scenarios (clearly local, tied to real copied records, not counted as history) ---------- */
  function scenarioPanel(){
    if(!ready()||!['owner','manager'].includes(role()))return '';
    const offered=k=>(Array.isArray(flow().scenarioCandidates?.[k])?flow().scenarioCandidates[k]:[]).filter(x=>x&&x.id&&x.label).slice(0,30);
    const absent=offered('absence'),bills=offered('billing').length?offered('billing'):db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).slice(0,30).map(i=>({id:i.id,label:`${i.name} · ${api.won(i.remaining)}`}));
    const options=list=>`<option value="">${list.length?'자동 선택 · 이번 달 실제 기록':'자동 선택 · 이번 달 실제 기록(서버가 고름)'}</option>${list.map(x=>`<option value="${h(x.id)}">${h(x.label)}</option>`).join('')}`;
    return `<section class="fl-scenarios" aria-labelledby="fl-scn-title"><h2 id="fl-scn-title">로컬 시나리오 미리보기</h2><p class="ax-note">복사본의 실제 기록에 연결하지만 그 기록은 바꾸지 않습니다. 여기서 만든 일은 '로컬 미리보기'로 표시되고 기존 기록의 집계에 들어가지 않습니다.</p><div class="fl-scn-grid"><form class="fl-scn" data-fl-form="simulate" data-scenario="absence" novalidate><h3>결석 학생 연락</h3><p>보호자 연락 → (필요하면) 관리자 검토 → 담임 후속으로 넘어갑니다.</p><label>결석 기록<select name="record">${options(absent)}</select></label><button class="button primary" type="submit" data-fl-key="event.simulate:absence">시나리오 시작</button></form><form class="fl-scn" data-fl-form="simulate" data-scenario="billing" novalidate><h3>수납 확인</h3><p>납부 내역 대조 → 관리자·원장 결정으로 넘어갑니다.</p><label>청구<select name="record">${options(bills)}</select></label><button class="button primary" type="submit" data-fl-key="event.simulate:billing">시나리오 시작</button></form><div class="fl-scn"><h3>여러 담당자에게 요청</h3><p>담당자를 여러 명 고르고 기한을 정해 보냅니다. 받은 사람의 화면에 바로 보입니다.</p>${btn('요청 작성','request')}</div></div></section>`;
  }

  /* ---------- case detail: trigger → decision → steps → evidence → events, related records ---------- */
  // Judgment as a readable memo: status, route, area, probabilities, suggested people and the Claude draft, when returned.
  // Judgment as a readable memo, only from what the server returned: status, route, area, probabilities, suggested
  // people and the Claude draft. Technical codes are translated or left out; while a judgment runs the last one stays.
  const dStatus=d=>({ok:'판정 완료',decided:'판정 완료',review_needed:'사람 검토 필요',pending:'판정 중',unavailable:'판정 사용 불가',error:'판정 실패',cancelled:'판정 취소',skipped:'규칙으로 진행'})[d?.status]||'상태 미확인';
  const dRoute=d=>/[가-힣]/.test(d?.routeLabel||'')?d.routeLabel:ROUTE[d?.route]||'';
  const dProvider=d=>d?.providerLabel||PROVIDER[d?.provider]||'';
  const dModel=d=>d?.modelLabel||modelLabel(d?.model);
  function dReasons(d){
    if(/[가-힣]/.test(d?.reason||''))return [d.reason];
    const out=[];for(const code of [...(Array.isArray(d?.codes)?d.codes:[]),...String(d?.reason||'').split(',')]){const t=reasonText(code);if(t&&!out.includes(t))out.push(t);}
    return out;
  }
  function decisionMemo(d){
    const p=d.probabilities||{},reasons=dReasons(d),draft=d.draft,provider=dProvider(d),model=dModel(d),route=dRoute(d);
    const facts=[pct(p.actionNeeded)&&`조치가 필요할 가능성 ${pct(p.actionNeeded)}`,pct(p.managerReview)&&`관리자 확인 필요 가능성 ${pct(p.managerReview)}`,pct(p.safetyConcern)&&`안전·법적 우려 가능성 ${pct(p.safetyConcern)}`,URGENCY[p.urgency]&&`긴급도 ${URGENCY[p.urgency]}`].filter(Boolean);
    const people=(d.suggestedAssigneeIds||[]).map(nameOf).filter(n=>n!=='담당 미정');
    const draftHtml=draft&&draft.status==='ok'&&draft.explanation?`<div class="fl-draft"><p><strong>Claude 설명 초안</strong>${draft.modelLabel?` · ${h(draft.modelLabel)}`:''}${CONCERN[draft.routeConcern]?` · ${h(CONCERN[draft.routeConcern])}`:''}</p><p class="live-pre">${h(draft.explanation)}</p>${draft.nextAction?.title?`<p>다음 조치 제안: ${h(draft.nextAction.title)}${draft.nextAction.body?` — ${h(draft.nextAction.body)}`:''}</p>`:''}${Array.isArray(draft.missingInfo)&&draft.missingInfo.length?`<p>더 필요한 정보: ${h(draft.missingInfo.filter(x=>typeof x==='string').join(', '))}</p>`:''}<small>초안은 검토할 글입니다. 아무것도 보내지 않습니다.</small></div>`:draft&&['unavailable','error'].includes(draft.status)?'<p class="ax-note">Claude 설명 초안을 받지 못했습니다.</p>':'';
    return `<p>${provider?pill(provider,'blue'):''} ${h(dStatus(d))}${model?` · ${h(model)}`:''}${Number.isFinite(d.elapsedMs)&&d.elapsedMs>0?` · ${fmt(Math.round(d.elapsedMs)/1000)}초`:''}${d.at?` · ${h(when(d.at))}`:''}</p>${route||AREA[d.area]?`<p><strong>${h(route)}</strong>${AREA[d.area]?`${route?' · ':''}업무 영역 ${h(AREA[d.area])}`:''}</p>`:''}${facts.length?`<ul class="fl-facts">${facts.map(f=>`<li>${h(f)}</li>`).join('')}</ul>`:''}${people.length?`<p>추천 담당: ${h(people.join(', '))} <small>(배정은 정해진 규칙과 사람이 합니다)</small></p>`:''}${reasons.length?`<p>왜 이렇게 보냈나: ${h(reasons.join(' · '))}</p>`:''}${draftHtml}`;
  }
  function decisionView(c){
    const d=c.decision,pending=d?.status==='pending'||c.decisionPending===true,providers=Array.isArray(flow().aiStatus?.providers)?flow().aiStatus.providers:[];
    const jev=providers.find(p=>p.id==='jev'),claude=providers.find(p=>p.id==='claude-cli'),off=p=>p&&!['ready','ok'].includes(p.status);
    const lock=pending?'disabled':'',key=`data-id="${h(c.id)}" data-fl-key="case.analyze:${h(c.id)}" ${lock}`;
    const buttons=lead()&&c.state!=='done'?`<div class="ax-actions">${btn(d?'AI 판정 다시 받기':'AI 판정 받기','analyze',key)}${btn('Claude 설명 초안까지 받기','analyze-draft',key)}</div>${off(jev)||off(claude)?`<p class="ax-note">${[jev,claude].filter(off).map(p=>`${h(p.label||PROVIDER[p.id]||'자동 판정')}: ${h(/[가-힣]/.test(p.reason||'')?p.reason:'지금 사용할 수 없습니다')}`).join(' · ')} — 눌러도 '사용 불가'로 기록되고 사람이 판단합니다.</p>`:''}`:'';
    if(!d&&!pending)return `<section class="ax-evidence fl-decision"><h3>판정</h3><p>자동 판정 기록이 없습니다. 정해진 규칙과 사람의 배정으로 진행합니다.</p>${buttons}</section>`;
    if(pending)return `<section class="ax-evidence fl-decision"><h3>판정</h3><p role="status">${pill('판정 중','amber')} ${d?.requestedAt?`${h(when(d.requestedAt))} 요청 · `:''}결과가 나오면 이 화면에 바로 나타납니다. 그동안 일은 정해진 담당자에게 그대로 있습니다.</p>${d?.previous?`<details class="ax-detail"><summary>이전 판정</summary>${decisionMemo(d.previous)}</details>`:''}${buttons}</section>`;
    return `<section class="ax-evidence fl-decision"><h3>판정</h3>${decisionMemo(d)}${buttons}</section>`;
  }
  function showCase(id){
    const c=caseById(id);if(!c)return;
    const timeline=(c.history||[]).map(eventById).filter(Boolean),missing=(c.history||[]).length-timeline.length;
    const links=(c.linkedCaseIds||[]).map(caseById).filter(Boolean);
    const fact=c.closure==='fact'?`<section class="ax-evidence"><h3>원본 할 일</h3><p>${h(c.sourceStatusLabel?`2.0 상태: ${c.sourceStatusLabel}`:'2.0 기록')}${c.factClosed?` · 2.0에서 닫힘${c.closedReason?`(${h(c.closedReason)})`:''}`:''}</p>${c.doneRule?`<p class="live-pre">${h(c.doneRule)}</p>`:'<p>원본 기록이 처리되면 닫힙니다.</p>'}<p class="ax-note">이 화면에서 닫을 수 없습니다. 보고는 따로 남는 후속 기록이 됩니다.</p></section>`:'';
    const linkList=links.length?`<section class="ax-evidence"><h3>연결된 업무 ${links.length}건</h3><div class="ax-actions">${links.map(x=>btn(x.title,'open',`data-id="${h(x.id)}"`)).join('')}</div></section>`:'';
    const steps=(c.steps||[]).map(s=>`<li class="${s.id===c.currentStepId||activeSteps(c).includes(s)?'current':''} ${h(s.status)}"><strong>${h(s.label)}</strong><span>${h(s.skipped?'필요 없어 건너뜀':isReview(s)&&s.status==='ready'?STEP.review:STEP[s.status]||'상태 미확인')} · ${h(whoOf(s))}${s.roleLabel?` · ${h(s.roleLabel)}`:''}${s.evidenceRequired?' · 근거 필요':''}</span>${ruleText(s.rule)?`<small>배정 근거: ${h(ruleText(s.rule))}</small>`:''}${s.unassignedReason&&/[가-힣]/.test(s.unassignedReason)?`<small>담당을 못 정한 이유: ${h(s.unassignedReason)}</small>`:''}</li>`).join('');
    dialog('detail',c.title,`${ORIGIN[c.origin]||''} · ${CLOSURE[c.closure]||''}`,`<div data-fl-case-root="${h(c.id)}"><div class="ax-issue-meta">${chips(c)}</div>${c.summary?`<p class="live-pre">${h(c.summary)}</p>`:''}${why(c)}${entityLinks(c)}${fact}<section class="fl-chain" aria-label="흐름"><h3>흐름</h3><ol>${steps}</ol></section>${decisionView(c)}<section class="ax-evidence"><h3>근거 ${(c.evidence||[]).length}건</h3>${(c.evidence||[]).map(e=>`<p><strong>${h(nameOf(e.actorId))}</strong> · ${h(when(e.at))}${OUTCOME[e.outcome]?` · ${h(OUTCOME[e.outcome])}`:e.outcome==='returned'?' · 보완 요청':e.outcome==='accepted'?' · 승인':''}<br><span class="live-pre">${h(e.note||'')}</span>${(e.recordRefs||[]).length?`<br><small>연결 기록 ${(e.recordRefs||[]).map(r=>h(r.label||'기록')).join(', ')}</small>`:''}</p>`).join('')||'<p>아직 남긴 근거가 없습니다.</p>'}</section>${linkList}<section class="ax-request-timeline"><h3>사건 기록</h3><ol>${timeline.map(e=>`<li><strong>${h(e.label||'기록')}</strong><p>${h(e.actorId?nameOf(e.actorId):'2.0 기록')} · ${h(when(e.at))}${e.origin==='dev'?' · 로컬 미리보기':e.origin==='snapshot'?' · 복사본 기록':''}</p></li>`).join('')||'<li><p>사건 기록이 없습니다.</p></li>'}</ol>${missing>0?`<p class="ax-note">이전 사건 ${fmt(missing)}건은 아직 불러오지 않았습니다.</p><div class="ax-actions">${btn('이전 사건 더 불러오기','older',`data-id="${h(c.id)}"`)}</div>`:''}</section>${actionBar(c)}</div>`);
  }
  const pickerHtml=(selected=[])=>`<div class="fl-assignees live-scroll" role="group" aria-label="담당자">${actors().filter(a=>assignable(a)&&a.role!=='owner').map(a=>`<label><input type="checkbox" name="assignee" value="${h(a.id)}" ${selected.includes(a.id)?'checked':''}> ${h(a.name)} · ${h(a.roleLabel||ROLE_GROUP[a.role])}</label>`).join('')}</div>`;
  function openForm(kind,id,step=''){
    const c=caseById(id);if(!c)return;const s=(step&&(c.steps||[]).find(x=>x.id===step))||myStep(c)||stepOf(c),sk=s?h(s.id):'';
    if(kind==='report')dialog('modal',c.closure==='fact'?'후속 보고 쓰기':'보고 쓰기',c.title,`<form class="ws-form" data-fl-form="report" data-id="${h(id)}" data-step="${sk}" novalidate>${c.closure==='fact'?`<p class="ax-note">원본 할 일은 2.0에서 처리되어야 닫힙니다. 이 보고는 따로 남는 후속 기록이 되고, 원본 할 일은 열린 채로 남습니다.</p>`:''}<label>결과<select name="outcome">${Object.entries(OUTCOME).map(([k,v])=>`<option value="${k}">${h(v)}</option>`).join('')}</select></label><label>보고 내용 <em aria-hidden="true">*</em><textarea name="note" rows="4" maxlength="2000" required></textarea></label>${(c.entityRefs||[]).length?`<fieldset class="ws-multi"><legend>근거로 연결할 기록</legend>${c.entityRefs.map((r,i)=>`<label><input type="checkbox" name="ref" value="${i}" checked> ${h(r.label)}</label>`).join('')}</fieldset>`:''}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">로컬 흐름에만 남습니다.</span><button class="button primary" type="submit" data-fl-key="case.report:${h(id)}">보고 보내기</button></div></form>`);
    if(kind==='review')dialog('modal','검토',c.title,`<div class="fl-review-evidence">${(c.evidence||[]).slice(-2).map(e=>`<p><strong>${h(nameOf(e.actorId))}</strong> · ${h(e.note||'')}</p>`).join('')||'<p>보고 내용이 없습니다.</p>'}</div><form class="ws-form" data-fl-form="review" data-id="${h(id)}" data-step="${sk}" novalidate><fieldset class="ws-multi"><legend>결정</legend><label><input type="radio" name="decision" value="accept" required> 승인하고 다음 단계로</label><label><input type="radio" name="decision" value="return"> 보완하라고 되돌림</label></fieldset><label>메모(되돌릴 때 필수)<textarea name="note" rows="3" maxlength="2000"></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">로컬 흐름에만 남습니다.</span><button class="button primary" type="submit" data-fl-key="case.review:${h(id)}">결정 보내기</button></div></form>`);
    const open=activeSteps(c),target=open.find(x=>!(x.assigneeIds||[]).length)||s;
    if(kind==='reassign')dialog('modal',unassigned(c)?'담당 지정':'담당 바꾸기',c.title,`<form class="ws-form" data-fl-form="reassign" data-id="${h(id)}" novalidate>${open.length>1?`<label>바꿀 단계<select name="step">${open.map(x=>`<option value="${h(x.id)}" ${x===target?'selected':''}>${h(x.label)} · ${h(whoOf(x))}</option>`).join('')}</select></label>`:`<p>현재 단계: ${h(target?.label||'')}</p><input type="hidden" name="step" value="${h(target?.id||'')}">`}${pickerHtml(target?.queue?[]:target?.assigneeIds||[])}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">바꾼 기록이 사건 기록에 남습니다.</span><button class="button primary" type="submit" data-fl-key="case.reassign:${h(id)}">담당 저장</button></div></form>`);
    if(kind==='reopen')dialog('modal','다시 열기',c.title,`<form class="ws-form" data-fl-form="reopen" data-id="${h(id)}" novalidate><label>다시 여는 이유 <em aria-hidden="true">*</em><textarea name="note" rows="3" maxlength="2000" required></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">마지막 단계 담당자의 할 일로 돌아갑니다.</span><button class="button primary" type="submit" data-fl-key="case.reopen:${h(id)}">다시 열기</button></div></form>`);
    $('#modal form :is(textarea,select,input:not([type=hidden]))')?.focus();
  }

  // Notifications for the previewed person: events addressed to them, else events on cases they take part in.
  function notices(){
    if(!ready())return '';
    const me=actor()?.id,involved=c=>(c.steps||[]).some(s=>(s.assigneeIds||[]).includes(me))||c.trigger?.actorId===me||(c.evidence||[]).some(e=>e.actorId===me);
    const list=events().filter(e=>e.origin!=='snapshot'&&(Array.isArray(e.targetActorIds)?e.targetActorIds.includes(me):role()==='owner'||involved(caseById(e.caseId)||{}))).slice(-20).reverse();
    return `<section class="fl-notices" aria-label="업무 흐름 알림"><h2>업무 흐름 알림 ${list.length}건</h2>${list.map(e=>{const c=caseById(e.caseId);return `<article><div class="ax-issue-meta">${pill(e.origin==='dev'?'로컬 미리보기':'기록','blue')}<span>${h(when(e.at))}</span></div><h3>${h(e.label||e.type)}</h3><p>${h(nameOf(e.actorId))}${c?` · ${h(c.title)}`:''}</p>${c?`<div class="ax-actions">${btn('근거와 흐름','open',`data-id="${h(c.id)}"`)}</div>`:''}</article>`;}).join('')||'<p class="live-empty">이 사람에게 온 흐름 알림이 없습니다.</p>'}</section>`;
  }

  /* ---------- adapters for the existing owner request UI (ax.js) ---------- */
  // Owner requests are cases with kind 'request'; ax renders them through the same rows/detail it used before.
  const statusOf=c=>c.state==='done'?'done':(c.steps||[]).some(s=>!isReview(s)&&(s.status==='working'||s.status==='done'))?'working':'requested';
  function asRequests(){
    return cases().filter(c=>(c.kind==='request'||c.origin==='dev'&&c.closure==='manual'&&!c.kind)&&!(c.linkedCaseIds||[]).length).map(c=>({id:c.id,flow:true,title:c.title,body:c.summary||'',owners:[...new Set((c.steps||[]).filter(s=>!isReview(s)).flatMap(s=>s.assigneeIds||[]))],due:String(c.dueAt||'').slice(0,10),priority:PRIORITY[c.priority]||'보통',status:statusOf(c),channels:Array.isArray(c.channels)?c.channels:['app'],issues:Array.isArray((c.requestSource||c.source)?.issueIds)?(c.requestSource||c.source).issueIds:[],context:c.familyId?{family:c.familyId,familyLabel:api.familyLabel?.(c.familyId)||'',records:(c.entityRefs||[]).map(r=>({id:String(r.recordId||r.id),label:r.label}))}:null,source:(c.requestSource||c.source)?.kind||'direct',result:(c.evidence||[]).slice(-1)[0]?.note||'',events:(c.history||[]).map(eventById).filter(Boolean).map(e=>({label:e.label||e.type,text:`${nameOf(e.actorId)} · ${when(e.at)}`}))}));
  }
  // Workspace family → record type the flow server knows. Only references it can resolve are attached; the record
  // names stay in the request body either way, so nothing is lost when a reference cannot be attached.
  const REF_TYPE={students:'student',classes:'class',attendance:'attendance',billing:'invoice',consultations:'consultation',enrollment:'lead',approvals:'approval','withdrawal-reports':'withdrawal_report','lesson-reports':'report','textbook-requests':'textbook_order',inventory:'asset','video-homework':'video'};
  const ALWAYS_KNOWN=new Set(['student','class']);
  async function createRequest(v){
    const people=(v.owners||[]).map(actorById);
    if(people.some(a=>!assignable(a))){toast('업무 흐름에서 배정할 수 없는 사람이 있습니다. 담당자를 다시 골라 주세요.');return null;}
    if(String(v.title).length>80){toast('업무 흐름 요청의 제목은 80자까지입니다.');return null;}
    const type=REF_TYPE[v.context?.family],known=new Set((flow().entities||[]).map(e=>`${e.type}:${e.id}`));
    const refs=type?(v.context.records||[]).map(r=>`${type}:${r.id}`).filter(k=>ALWAYS_KNOWN.has(type)||known.has(k)).slice(0,20):[];
    const kind=['issue','workspace','chat','task','direct'].includes(v.source)?v.source:v.context?'workspace':'direct';
    const source={kind,...(v.issues?.length?{issueIds:v.issues.slice(0,10)}:{}),...(v.context?.signal?{signalId:String(v.context.signal)}:{}),...(v.context?.action?{actionId:String(v.context.action)}:{}),...(v.context?.familyLabel?{label:String(v.context.familyLabel).slice(0,80)}:{})};
    const payload={title:v.title,body:String(v.body).slice(0,2000),assigneeIds:v.owners,...(/^\d{4}-\d{2}-\d{2}$/.test(v.due||'')?{dueAt:v.due}:{}),priority:v.priority==='높음'?'high':'normal',...(v.context?.family?{familyId:v.context.family}:{}),...(refs.length?{recordRefs:refs}:{}),channels:(v.channels||[]).filter(ch=>ch==='app'||ch==='slack'),source};
    const result=await command('request.create',{payload,key:`request.create:${v.draftKey||'direct'}`});
    return result?result.caseId||'':null;
  }
  const actAs=(kind,caseId,actorId,payload={})=>{const c=caseById(caseId),s=c&&myStep(c,actorId);return command(kind,{caseId,payload:{...(s?{stepId:s.id}:{}),...payload},actorId,key:`${kind}:${caseId}`});};

  /* ---------- events ---------- */
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-fl]');if(!el||el.disabled)return;
    event.preventDefault();event.stopImmediatePropagation();
    const {fl:action,id}=el.dataset;
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='reload'){load();return;}
    if(action==='older'){el.disabled=true;loadOlder(id);return;}
    if(action==='more'){store.all=id;api.render();requestAnimationFrame(()=>document.querySelector(`.fl-list[data-list="${CSS.escape(id)}"] .fl-case:nth-child(21) [data-fl="open"]`)?.focus());return;}
    if(action==='filter'){store.filter=id;store.all='';if(api.getPage()!=='home'&&api.getPage()!=='flow')navigate('home');else api.render();requestAnimationFrame(()=>{$('#fl-detail')?.scrollIntoView({block:'start'});$('#fl-detail-title,#fl-detail h2')?.focus?.({preventScroll:true});});return;}
    if(action==='open'){showCase(id);return;}
    const stepId=el.dataset.step?{stepId:el.dataset.step}:{};
    if(action==='ack'){command('case.ack',{caseId:id,payload:stepId}).then(r=>{if(r)toast('확인했습니다. 진행 중으로 바뀌었습니다.');});return;}
    if(['report-open','review-open','reassign-open','reopen-open'].includes(action)){openForm(action.replace('-open',''),id,el.dataset.step||'');return;}
    if(action==='analyze'||action==='analyze-draft'){const box=el.closest('.fl-decision');box?.querySelectorAll('[data-fl^="analyze"]').forEach(b=>{b.disabled=true;});if(box&&!box.querySelector('.fl-wait'))box.insertAdjacentHTML('beforeend','<p class="ax-note fl-wait" role="status">판정을 기다리는 중입니다. 화면은 그대로 쓸 수 있습니다.</p>');command('case.analyze',{caseId:id,payload:action==='analyze-draft'?{draft:true}:{}}).then(r=>{if(r)toast(r.duplicate?'이미 판정 중입니다. 결과가 나오면 화면에 나타납니다.':r.decision==='pending'?'판정을 요청했습니다. 결과는 잠시 뒤 이 화면에 나타납니다.':'판정 결과를 기록했습니다.');if($('#detail[open]'))showCase(id);});return;}
    if(action==='request'){ax.showRequest({source:'direct'});return;}
    if(action==='entity'){const {family,record}=el.dataset;document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(family&&api.hasView(`workspace-${family}`)){navigate(`workspace-${family}`);if(record)requestAnimationFrame(()=>api.showWorkspaceRecord?.(family,record));}else if(record)api.openRecord?.(record);return;}
  },true);
  document.addEventListener('change',event=>{if(event.target.dataset?.flActor!==undefined){store.actorId=event.target.value;store.filter='';store.all='';try{localStorage.setItem(ACTOR_KEY,store.actorId);}catch{/* keep in memory only */}api.closeMenu?.(false);if(api.getPage()==='home')api.render();else navigate('home');}});
  document.addEventListener('submit',event=>{
    const form=event.target,kind=form.dataset.flForm;if(!kind)return;event.preventDefault();event.stopImmediatePropagation();
    const v=new FormData(form),error=form.querySelector('.ax-form-error'),id=form.dataset.id,fail=m=>{if(error)error.textContent=m;};
    const done=(r,msg)=>{if(!r)return;form.closest('dialog')?.close();toast(msg);if($('#detail[open]')&&id&&caseById(id))showCase(id);};
    const step=form.dataset.step?{stepId:form.dataset.step}:{};
    if(kind==='simulate'){const record=String(v.get('record')||''),scenario=form.dataset.scenario;command('event.simulate',{payload:{scenario,...(record?{recordRef:record}:{})},key:`event.simulate:${scenario}`}).then(r=>{if(!r)return;if(r.duplicate){toast('같은 기록으로 진행 중인 시나리오가 있어 그 일을 보여 드립니다. 새 일은 만들지 않았습니다.');if(r.caseId)showCase(r.caseId);return;}toast(`로컬 시나리오를 시작했습니다. 담당자의 화면에 일이 생겼습니다.${r.decision==='pending'?' 판정 결과는 잠시 뒤 나타납니다.':''}`);});return;}
    if(kind==='report'){const c=caseById(id),note=String(v.get('note')||'').trim(),outcome=String(v.get('outcome')||'done');if(note.length<2){fail('보고 내용을 두 글자 이상 적어 주세요.');form.querySelector('textarea').focus();return;}const refs=v.getAll('ref').map(Number).map(i=>c?.entityRefs?.[i]).filter(Boolean).map(r=>`${r.type}:${r.id}`);command('case.report',{caseId:id,payload:{...step,note,outcome,...(refs.length?{recordRefs:refs}:{})}}).then(r=>done(r,c?.closure==='fact'?'후속 보고를 남겼습니다. 원본 할 일은 2.0에서 처리되면 닫힙니다.':'보고를 남겼습니다. 다음 담당자에게 넘어갑니다.'));return;}
    if(kind==='review'){const decision=String(v.get('decision')||''),note=String(v.get('note')||'').trim();if(!decision){fail('결정을 골라 주세요.');return;}if(decision==='return'&&note.length<2){fail('되돌릴 때는 보완할 내용을 적어 주세요.');form.querySelector('textarea').focus();return;}command('case.review',{caseId:id,payload:{...step,decision,...(note?{note}:{})}}).then(r=>done(r,decision==='accept'?'승인했습니다.':'보완하라고 되돌렸습니다.'));return;}
    if(kind==='reassign'){const ids=v.getAll('assignee').map(String),stepId=String(v.get('step')||'');if(!ids.length){fail('담당자를 한 명 이상 골라 주세요.');return;}if(ids.length>10){fail('담당자는 10명까지 고를 수 있습니다.');return;}command('case.reassign',{caseId:id,payload:{...(stepId?{stepId}:{}),assigneeIds:ids}}).then(r=>done(r,'담당을 저장했습니다.'));return;}
    if(kind==='reopen'){const note=String(v.get('note')||'').trim();if(note.length<2){fail('다시 여는 이유를 적어 주세요.');form.querySelector('textarea').focus();return;}command('case.reopen',{caseId:id,payload:{note}}).then(r=>done(r,'다시 열었습니다.'));}
  },true);

  load();
  return {load,ready,status:()=>store.status,actor,role,actors,nameOf,sidebar,inboxCount,ownerCards,ownerStageCell,ownerBelow,fullView,staffView,managerView,showCase,asRequests,createRequest,actAs,caseById,stepOf,myStep,notices,stateNote};
};
