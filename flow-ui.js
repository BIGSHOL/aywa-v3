/* Flow UI: one durable work flow (GET /api/flow, POST /api/flow/actions) seen from a previewed person.
   The server is the source of truth: cases, steps, evidence and the event chain come from it, and every change is a
   command with a stable commandId and the last seen revision. Nothing here authenticates anyone, sends a message or
   writes the copied records — the overlay is local and the preview selector only chooses whose work to show. */
window.createFlowUI = function createFlowUI(api) {
  'use strict';
  const {db,h,fmt,icon,dialog,navigate,toast,ax}=api;
  const $=s=>document.querySelector(s);
  const ENDPOINT='/api/flow',ACTIONS='/api/flow/actions',ACTOR_KEY='ax-flow-preview-actor';
  const STATE={open:'처리 전',working:'진행 중',review:'검토 대기',done:'완료'};
  const STEP={waiting:'대기',ready:'할 차례',working:'진행 중',review:'검토 차례',done:'완료'};
  const OUTCOME={done:'처리됨',needs_review:'검토 필요',unreachable:'연락 안 됨',not_needed:'해당 없음'};
  const OUTCOME_NOTE={done:'맡은 업무를 끝냈습니다',needs_review:'다른 사람의 확인이 더 필요합니다',unreachable:'연락했지만 닿지 않았습니다',not_needed:'처리할 업무가 아니었습니다'};
  // Judgment codes from the server's decision modules are translated here; unknown codes are never shown.
  const ROUTE={auto_route:'정해진 담당자에게 바로 배정',no_action:'업무 없음으로 판단',manager_review:'관리자 검토로 보냄',human_review:'사람이 판단하도록 보냄',insufficient_context:'정보가 부족해 사람이 되묻도록 보냄'};
  const AREA={attendance:'출결',billing:'수납',counseling:'상담',academic:'학업',enrollment:'신규 상담',staff_hr:'직원·인사',operations:'운영'};
  const URGENCY={today:'오늘 처리',this_week:'며칠 안에',no_deadline:'급하지 않음'};
  const CONCERN={none:'배정에 이견 없음',route_may_be_wrong:'배정이 맞지 않을 수 있음',needs_more_context:'정보가 더 필요함'};
  const PROVIDER={typesafe:'AI 판정',jev:'AI 판정','claude-cli':'AI 설명 초안',claude:'AI 설명 초안'};
  const REASON={safety_signal:'안전·법적 우려 신호가 보였습니다',known_open_work_guard:'끝나지 않은 관련 업무가 이미 있습니다',uncertain_action:'업무인지 확실하지 않습니다',manager_review_signal:'관리자 확인이 필요해 보입니다',personnel_always_reviewed:'직원·인사 문제는 늘 사람이 확인합니다',multiple_areas:'여러 업무 영역에 걸쳐 있습니다',area_unclear:'업무 영역이 분명하지 않습니다',uncertain_area:'업무 영역 판단이 확실하지 않습니다',context_insufficient:'판단할 정보가 부족합니다',missing_link:'원생·반·청구 연결이 부족합니다',no_eligible_staff:'배정할 수 있는 담당자가 없습니다',no_eligible_manager:'배정할 수 있는 관리자가 없습니다',no_open_task:'남은 업무가 없습니다',no_content:'판단할 내용이 없습니다',auto_route_thresholds_met:'자동 배정 기준을 넘었습니다',cancelled:'판정이 취소되었습니다',decision_module_unavailable:'자동 판정을 받지 못했습니다',decision_call_failed:'자동 판정을 받지 못했습니다',local_rate_limit:'자동 판정을 받지 못했습니다',jev_not_configured:'자동 판정을 받지 못했습니다',jev_timeout:'판정 응답이 늦어 멈췄습니다',jev_rate_limited:'자동 판정을 받지 못했습니다',jev_overloaded:'자동 판정을 받지 못했습니다',jev_unavailable:'자동 판정을 받지 못했습니다',jev_circuit_open:'자동 판정을 받지 못했습니다',jev_auth_failed:'자동 판정을 받지 못했습니다',jev_key_error:'자동 판정을 받지 못했습니다',jev_invalid_answer:'자동 판정을 받지 못했습니다',jev_request_rejected:'자동 판정을 받지 못했습니다',jev_config:'자동 판정을 받지 못했습니다',adapter_busy:'자동 판정을 받지 못했습니다',context_too_large:'판정할 내용이 너무 깁니다',rate_limited:'자동 판정을 받지 못했습니다',http_error:'자동 판정을 받지 못했습니다'};
  const reasonText=code=>{const c=String(code||'').trim();if(/[가-힣]/.test(c))return c;if(REASON[c])return REASON[c];if(c.startsWith('signals_conflict'))return '판정 신호가 서로 맞지 않습니다';if(c.startsWith('invalid_context'))return '판정에 넘긴 정보가 올바르지 않습니다';return '';};
  const pct=p=>Number.isFinite(Number(p))&&p!==null?`${Math.round(Number(p)*100)}%`:'';
  const modelLabel=m=>{const x=String(m||'');const jev=/^jev-(\d+)\.(\d+)/.exec(x);return jev?`Jev ${jev[1]}.${jev[2]}`:/^claude/i.test(x)?'Claude':'';};
  // Assignment rules are written for people; drop parenthesised source identifiers (column or table names).
  const ruleText=r=>String(r||'').replace(/\s*\([^)]*[A-Za-z_]{2,}[^)]*\)/g,'').trim();
  const PRIORITY={high:'높음',normal:'보통',low:'낮음'};
  const ORIGIN={snapshot:'학원 기록',dev:'직접 등록한 업무'};
  const CLOSURE={fact:'원본 기록이 처리되면 닫힙니다',manual:'사람이 확인하고 보고해 닫습니다'};
  const BILLING_HINT='수납 반영은 메이크에듀 동기화로 들어옵니다 — 학부모 안내 등 처리 뒤 보고로 닫기';
  const ROLE_ORDER=['owner','manager','teacher','staff'],ROLE_GROUP={owner:'원장',manager:'관리자',teacher:'선생님',staff:'직원'};
  // 보드 보기 상태: q = 검색어 · sort = 정렬 열과 방향 · cols = 열별 값 필터(열 → 선택한 값들, 없으면 전부) · pages = 목록별 쪽.
  const store={status:'idle',flow:null,error:'',controller:null,pending:new Set(),actorId:'',filter:'',cardLink:null,q:'',sort:{col:'',dir:''},cols:{},pages:{},sel:new Set(),selView:'',deferred:false,retry:0,etag:'',older:new Map(),partial:false,wantFull:false,fullPromise:null,fullError:''};
  const PEEK=document.documentElement.classList.contains('peek');
  try{store.actorId=localStorage.getItem(ACTOR_KEY)||'';}catch{/* storage unavailable: first owner actor is used */}
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const btn=(text,action,attrs='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-fl="${action}" ${attrs}>${h(text)}</button>`;
  // Timestamps with a zone (UTC 'Z' from the server) are shown and dated in Asia/Seoul; date-only and zone-less values
  // are already local and stay as written.
  const KST=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const zoned=d=>d.length>10&&/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(d)&&Number.isFinite(Date.parse(d));
  const kst=d=>Object.fromEntries(KST.formatToParts(new Date(d)).map(p=>[p.type,p.value]));
  const kstDate=at=>{const d=String(at||'');if(!zoned(d))return d.slice(0,10);const p=kst(d);return `${p.year}-${p.month}-${p.day}`;};
  // 날짜는 M/D로 적는다(원장 10-28). md는 YYYY-MM-DD를 M/D로, 그 밖의 값은 그대로.
  const md=d=>{const s=String(d||'');return /^\d{4}-\d{2}-\d{2}/.test(s)?`${Number(s.slice(5,7))}/${Number(s.slice(8,10))}`:s;};
  const when=at=>{const d=String(at||'');if(!d)return '시각 미입력';if(!zoned(d))return `${md(d.slice(0,10))}${d.length>10?` ${d.slice(11,16)}`:''}`;const p=kst(d);return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;};

  /* ---------- store ---------- */
  const ready=()=>store.status==='ready'&&Boolean(store.flow);
  const flow=()=>store.flow||{actors:[],cases:[],events:[],entities:[],relations:[],metrics:{}};
  const actors=()=>Array.isArray(flow().actors)?flow().actors:[];
  const actorById=id=>actors().find(a=>a.id===id);
  const nameOf=id=>actorById(id)?.name||db.staff.find(s=>s.id===id)?.name||'담당 미지정';
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
  // 요약 글의 날짜를 화면 표기(M/D)로 — 원본 업무의 글은 '10-21 15:40'·'2026-10-21'처럼 적혀 온다(검수 10-28 L2). 올해가 아니면 연도를 남긴다.
  const dateWords=t=>String(t||'').replace(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g,(m,y,mo,d)=>`${y===asOf().slice(0,4)?'':`${y}. `}${+mo}/${+d}`).replace(/(?<![\d-])(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\d-])/g,(m,mo,d)=>`${+mo}/${+d}`);
  const sumOf=c=>dateWords(c.summary);
  const late=c=>c.caseFlags?.late??(c.state!=='done'&&c.dueAt&&kstDate(c.dueAt)<asOf());
  // Nobody resolved for an open step (the manager queue by design, e.g. a review, is not "no one").
  const unassigned=c=>c.caseFlags?.unassigned??activeSteps(c).some(s=>!(s.assigneeIds||[]).length&&(!s.queue||Boolean(s.unassignedReason)));
  const mine=(c,id)=>Boolean(myStep(c,id));
  const inReview=c=>c.state==='review'||activeSteps(c).some(isReview);
  const returned=c=>{if(c.state==='done')return false;const last=(c.history||[]).map(eventById).filter(e=>e&&/\.(returned|reported|reviewed|accepted)$/.test(e.type)).at(-1);return Boolean(last&&/returned$/.test(last.type));};
  const local=c=>c.origin==='dev';
  // A source case is either a 2.0 staff task or a check the copy's records raised (signal); the words differ.
  const signalCase=c=>Boolean(c.signalId)||c.trigger?.type==='source.signal';
  const newest=list=>[...list].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  const assignable=a=>a&&!a.preview&&a.assignable!==false;
  const editing=()=>{const a=document.activeElement;return Boolean(a&&a.closest('#main')&&a.matches('input,textarea,select,[contenteditable="true"]'));};
  // Reads never call AI. An unchanged revision leaves the screen exactly as it is (no re-render, scroll and focus kept).
  async function load({quiet=false,full=false}={}){
    if(store.fullPromise&&!full)return store.fullPromise;
    if(full)store.wantFull=true;
    store.controller?.abort();const controller=new AbortController();store.controller=controller;
    if(!store.flow)store.status='loading';
    try{
      const response=await fetch(store.wantFull?ENDPOINT:`${ENDPOINT}?summary=1`,{headers:{Accept:'application/json',...(store.etag&&store.flow&&!store.partial?{'If-None-Match':store.etag}:{})},signal:controller.signal});
      if(response.status===304&&store.flow)return !store.flow.summary;
      let json=null;try{json=await response.json();}catch{/* not JSON: no flow endpoint on this server */}
      if(response.ok)store.etag=response.headers.get('ETag')||'';
      if(response.ok&&json&&Array.isArray(json.cases)){
        const prev=store.flow,wasReady=store.status==='ready';
        // 서버 재시작 전의 전체 응답에는 이 칸이 없을 수 있다. 같은 개정의 요약 응답에서 받은 값을 이어 쓴다.
        if(!json.firstScreen&&prev?.firstScreen&&prev.revision===json.revision)json.firstScreen=prev.firstScreen;
        if(wasReady&&!store.partial&&prev&&Boolean(prev.summary)===Boolean(json.summary)&&Boolean(prev.firstScreen)===Boolean(json.firstScreen)&&prev.revision===json.revision&&prev.eventsTotal===json.eventsTotal&&prev.asOf===json.asOf)return !prev.summary;
        if(!json.summary){json=await allPages(json,controller.signal);if(!json)return false;}
        const before=prev&&!prev.summary?new Set(cases().filter(c=>mine(c)).map(c=>c.id)):null;
        store.flow=json;store.status='ready';store.error='';store.fullError='';store.retry=0;
        if(before&&!quiet)announce(before);
      }
      else if(response.status===503&&json){store.status=store.flow?'ready':'starting';store.error=message(json,503);if(store.flow?.summary&&store.wantFull)store.fullError=store.error;if(store.retry++<5)setTimeout(()=>load({quiet}),3000);}
      else if(!json||[404,405,501].includes(response.status)){if(store.flow?.summary&&store.wantFull)store.fullError='업무 목록을 불러오지 못했습니다.';else{store.status='unavailable';store.flow=null;}}
      else if(store.flow?.summary&&store.wantFull){store.fullError=message(json,response.status);}
      else{store.status='error';store.error=message(json,response.status);}
    }catch{if(controller.signal.aborted)return;store.status=store.flow?'ready':'error';store.error='업무 흐름 서버에 연결하지 못했습니다.';if(store.flow?.summary&&store.wantFull)store.fullError=store.error;}
    paint();
    return Boolean(ready()&&!store.flow.summary);
  }
  function ensureFull(){
    if(ready()&&!store.flow.summary)return Promise.resolve(true);
    store.fullError='';
    if(!store.fullPromise)store.fullPromise=load({full:true}).finally(()=>{store.fullPromise=null;});
    return store.fullPromise;
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
    toast(fresh.length===1?`새로 등록된 업무: ${fresh[0].title}`:`새로 등록된 업무 ${fresh.length}건 · ${fresh[0].title} 외`);
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
    // Someone typing in the drawer (a form, the tree search) is never interrupted; the next refresh catches up.
    if(d.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select'))return;
    const id=root.dataset.flCaseRoot,scroller=[...d.querySelectorAll('*')].find(n=>n.scrollTop>0),top=scroller?.scrollTop||0;
    const focus=document.activeElement&&d.contains(document.activeElement)?focusKey(document.activeElement):'';
    if(!caseById(id))return;showCase(id);
    if(top){const next=[...d.querySelectorAll('*')].find(n=>n.scrollHeight>n.clientHeight&&getComputedStyle(n).overflowY!=='visible');if(next)next.scrollTop=top;}
    if(focus)d.querySelector(focus)?.focus({preventScroll:true});
  }
  document.addEventListener('focusout',()=>{if(store.deferred&&!pressing)setTimeout(flush,0);});
  const ERROR={revision_conflict:'다른 변경이 먼저 반영되어 화면을 새로 불러왔습니다. 내용을 확인하고 다시 시도해 주세요.',command_conflict:'같은 요청이 다른 내용으로 이미 처리되었습니다.',step_not_ready:'지금 처리할 단계가 없습니다. 화면을 새로 불러왔습니다.',not_assignee:'이 단계의 담당자가 아닙니다.',fact_case:'원본 업무는 원본 기록이 처리되어야 닫힙니다.',not_done:'완료된 업무만 다시 열 수 있습니다.',no_source_record:'시나리오에 쓸 실제 기록이 없습니다.',evidence_required:'근거 내용을 적어 주세요.',assignee_not_allowed:'배정할 수 없는 사람이 있습니다.',record_ref_not_allowed:'이 업무와 관련된 기록만 근거로 붙일 수 있습니다.',actor_not_allowed:'직원 목록에 없는 사람입니다.',action_not_allowed:'이 역할로는 할 수 없는 작업입니다.',case_not_found:'업무를 찾을 수 없습니다.',flow_starting:'업무 흐름 서버가 준비 중입니다. 잠시 뒤 다시 시도해 주세요.',flow_state_mismatch:'업무 흐름 기록이 학원 기록과 맞지 않아 멈췄습니다.',store_locked:'다른 처리가 저장 중입니다. 잠시 뒤 다시 시도해 주세요.',store_write_failed:'저장하지 못했습니다. 아무것도 바뀌지 않았습니다.'};
  // Server messages are shown only when they are written for people (Korean); otherwise a translated fallback.
  // A conflict or a vanished step is already handled by reloading, so the screen says what it did.
  function message(json,status){if(['revision_conflict','step_not_ready'].includes(json?.error))return ERROR[json.error];const m=typeof json?.message==='string'&&/[가-힣]/.test(json.message)?json.message:'';return m||ERROR[json?.error]||(status>=500?'업무 흐름 서버 오류로 반영하지 못했습니다.':'요청을 처리하지 못했습니다.');}
  // One command per user action: stable commandId (kept on retry), last seen revision, button locked while pending.
  async function command(kind,{caseId='',payload={},key=`${kind}:${caseId}`,actorId=actor()?.id,quiet=false}={}){
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
        // quiet = 여러 건을 차례로 보낼 때(담당자 일괄 변경) — 새 판만 받아 두고 다 끝난 뒤 한 번 그린다.
        if(response.ok){if(json?.flow&&Array.isArray(json.flow.cases)){store.flow=json.flow;store.status='ready';if(!quiet)paint();}else await load({quiet:true});return json||{};}
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
  document.addEventListener('visibilitychange',()=>{if(!PEEK&&document.visibilityState==='visible'&&ready())load();});
  // 엿보기 창 안(같은 앱을 한 번 더 띄운 것)은 8초 갱신을 하지 않는다 — 바깥 화면이 이미 돌고, 닫히면 바깥이 다시 읽는다.
  if(!PEEK)setInterval(()=>{if(ready()&&document.visibilityState==='visible'&&!store.pending.size)load();},8000);

  /* ---------- shared pieces ---------- */
  // 관련 기록은 넷까지 — 나머지는 '외 N건'(전부는 '근거와 흐름'에서). 카드가 칩으로 옆으로 길어지지 않게(원장 10-28 "너무 가로로 나열").
  function entityLinks(c){
    const refs=(c.entityRefs||[]).filter(r=>r&&r.label);if(!refs.length)return '';
    return entityChips(c,refs).replace(/<\/div>$/,refs.length>4?`<span class="fl-entity-more">외 ${fmt(refs.length-4)}건</span></div>`:'</div>');
  }
  function entityChips(c,refs){
    return `<div class="fl-entities" aria-label="관련 기록">${refs.slice(0,4).map(r=>{const fam=r.type==='task'?'tasks-notifications':r.familyId||'',ws=fam&&api.hasView(`workspace-${fam}`);return `<button type="button" class="fl-entity" data-fl="entity" data-family="${h(fam)}" data-record="${h(r.recordId||r.id||'')}" ${ws||api.canOpenRecord?.(r.recordId||r.id)?'':'disabled'}>${h(r.type==='task'&&r.label===c.title?'원본 업무':refLabel(r))}${fam?`<small>${h(api.familyLabel?.(fam)||'')}</small>`:''}</button>`;}).join('')}</div>`;
  }
  function why(c){
    const t=c.trigger||{},s=stepOf(c),d=c.decision;
    const who=t.actorId?nameOf(t.actorId):'';
    // A case split into one step per teacher is described by its open steps, not by one step's label and count.
    const split=splitCase(c)&&activeSteps(c).length>1;
    const reason=d?.status==='pending'||c.decisionPending===true?'판정 중':d&&dRoute(d)&&['ok','decided','review_needed'].includes(d.status)?`판정: ${dRoute(d)}${d.area&&AREA[d.area]?` · ${AREA[d.area]}`:''}`:split?`담당자별로 남은 단계 ${activeSteps(c).length}개`:s?`${s.label}${s.roleLabel||ROLE_GROUP[s.role]?` · ${s.roleLabel||ROLE_GROUP[s.role]} 차례`:''}`:'';
    const start=t.label&&t.label!==c.title?t.label:c.closure==='fact'?(signalCase(c)?'학원 기록에서 찾은 업무':'자동으로 생긴 업무'):t.label||'시작 기록 없음',why=[c.title,start].reduce((r,x)=>r.startsWith(`${x} · `)?r.slice(x.length+3):r,reason).replace(/^[\d,]+건 · /,'');
    return `<p class="fl-why"><span>${h(start)}</span>${who?`<span>${h(who)}</span>`:''}<span>${h(when(t.at||c.createdAt))}</span>${why?`<span>${h(why)}</span>`:''}</p>`;
  }
  // 상태 = 처리 상태 하나 + 걸리는 표시. 같은 뜻은 한 번만 — 원본 업무의 '우선'은 서버가 기한 지난 업무에 붙인 것이라 '지난 업무'와
  // 같은 말이다(flow-engine). 표시마다 뜻을 두고, 상태 칸에 마우스를 올리면 보인다. 원본 기록이 끝난 상태(처리됨·취소됨·만료됨)는 원본 말을 쓴다.
  const STATE_HINT={open:'아직 아무도 처리하지 않았습니다.',working:'담당자가 확인하고 처리하는 중입니다.',review:'보고가 들어와 검토를 기다립니다.',done:'완료된 업무입니다.'};
  // 만료(expired)는 지금 이름으로 — 저장된 사례에는 옛 라벨('지난 업무')이 남아 있다(상태가 바뀔 때만 다시 적힌다).
  const sourceLabel=c=>c.sourceStatus==='expired'?'만료됨':c.sourceStatusLabel;
  function flags(c){
    const out=[],add=(t,hint,tone='')=>{if(!out.some(f=>f[0]===t))out.push([t,hint,tone]);};
    if(c.kind==='scenario')add('연습 시나리오','연습용으로 만든 업무입니다. 집계에 들지 않습니다.','amber');
    const src=c.closure==='fact'&&c.sourceStatusLabel&&['done','cancelled','expired'].includes(c.sourceStatus)?sourceLabel(c):'';
    add(src||STATE[c.state]||'상태 미확인',src?({cancelled:'원본 기록에서 취소된 업무입니다.',expired:'기한이 지나 원본 기록에서 저절로 닫힌 업무입니다.'}[c.sourceStatus]||'원본 기록에서 처리된 업무입니다.'):STATE_HINT[c.state]||'');
    if(late(c))add('지난 업무',c.dueAt?`${md(kstDate(c.dueAt))}까지였는데 아직 끝나지 않았습니다.`:'기한이 지났는데 아직 끝나지 않았습니다.','amber');
    if(unassigned(c))add('담당 미지정','맡을 사람이 정해지지 않았습니다.','amber');
    if(c.priority==='high'&&c.state!=='done'&&!(c.closure==='fact'&&c.taskKind))add(...(c.signalId?['결정 필요','원장·관리자가 정해야 하는 업무입니다.']:c.decision?.priority==='high'?['오늘 처리','오늘 안에 처리할 업무로 판정됐습니다.']:['중요','요청할 때 중요로 표시한 업무입니다.']),'amber');
    if(c.flags?.needsReview&&c.state!=='done')add('검토 필요','자동 배정이 확실하지 않아 사람이 확인해야 합니다.','amber');
    return out;
  }
  function chips(c){return flags(c).map(([t,,tone])=>pill(t,tone)).join('');}
  const whoOf=s=>queued(s)?'관리자·원장 누구나':(s.assigneeIds||[]).map(nameOf).join(', ')||'담당 미지정';
  function caseCard(c,{actions=true}={}){
    const s=myStep(c)||stepOf(c),open=activeSteps(c),links=(c.linkedCaseIds||[]).filter(caseById);
    return `<article class="fl-case" data-case="${h(c.id)}"><header><div class="ax-issue-meta">${chips(c)}</div><h3><button type="button" data-fl="open" data-id="${h(c.id)}">${h(c.title)}</button></h3></header>${c.summary?`<p class="fl-summary">${h(sumOf(c))}</p>`:''}${c.signalId==='billing-remaining'?`<p class="fl-step">${h(BILLING_HINT)}</p>`:''}${c.taskKind==='attendance_absent_desk'&&c.factClosed&&c.closedReason?`<p class="fl-step">${h(c.closedReason)}</p>`:''}${why(c)}${entityLinks(c)}${s?`<p class="fl-step">${!String(s.label||'').startsWith(c.title)&&!splitCase(c)?`${h(s.label)} · `:''}${h(s.skipped?'건너뜀':isReview(s)&&s.status==='ready'?STEP.review:STEP[s.status]||'상태 미확인')} · ${h(whoOf(s))}${open.length>1?` · 함께 남은 단계 ${open.length}개`:''}${c.dueAt?` · ${h(md(kstDate(c.dueAt)))}까지`:''}</p>`:''}${links.length?`<p class="fl-step">후속 보고 ${links.length}건 · ${signalCase(c)?'원본 기록이 바뀌면 닫힙니다':'원본 기록이 처리되면 닫힙니다'}</p>`:''}${actions?actionBar(c):''}</article>`;
  }
  // 업무 흐름 보드 = 표(원장 10-28 "열정렬안되어있는거 정렬" · "열마다 딱 너비가 정해져있어서 넘치면 짤라버려. 마우스 올리면 짤린거 볼 수 있게").
  // 열 너비는 표 머리 한 곳(table-layout:fixed)이 정한다 — 줄마다 글 길이가 달라도 열이 흔들리지 않는다. 넘친 글은 말줄임(.fl-cut),
  // 마우스·초점이 오면 전부 보인다(fl-tip). 처리 화면 = 그 업무를 처리하는 화면, 누르면 이 화면 위 엿보기 창으로 연다.
  const COLS=[['state','상태'],['title','업무'],['rec','관련 기록'],['who','할 차례'],['due','기한'],['at','발생 시간'],['place','처리 화면'],['act','']];
  // 관련 기록 이름 = 지금 원본의 이름(flow().entities, 읽을 때마다 원본에서 다시 풀린다). 업무에 저장된 이름은 그 일이 생길 때 적은 것이라
  // 옛 모양('2026-10 청구')일 수 있다 — 없을 때만 쓴다(검수 10-28 H3).
  let entSrc=null,entMap=new Map();
  const refLabel=r=>{if(!r)return '';const list=flow().entities;if(list!==entSrc){entSrc=list;entMap=new Map((list||[]).map(e=>[`${e.type}:${e.id}`,e.label]));}return entMap.get(`${r.type}:${r.id}`)||r.label||'';};
  const refsOf=c=>(c.entityRefs||[]).filter(r=>r&&r.label&&!(r.type==='task'&&r.label===c.title&&c.taskKind!=='video_upload_check'));
  const placeOf=c=>c.familyId&&api.familyLabel?.(c.familyId)||'';
  const whoText=c=>{const s=myStep(c)||stepOf(c);return s?whoOf(s):'';};
  // 신호에서 생긴 일은 신호가 실은 기록 시각(at)을 쓴다 — 기록을 점검한 시각은 발생 시간이 아니다(검수 10-28 M8).
  const signalAt=c=>c.signalId?(db.workspaces?.families?.[c.familyId]?.signals||[]).find(x=>x.id===c.signalId)?.at||'':'';
  const atOf=c=>signalAt(c)||(c.trigger||{}).at||c.createdAt||'';
  // 열마다 걸러 보는 값(한 일이 값을 여럿 가질 수 있다 — 상태 표시·관련 기록·담당자)과 정렬 값. 빈 값은 '없음'으로 걸러지고 정렬에선 늘 맨 뒤.
  const COLV={state:c=>flags(c).map(f=>f[0]),title:c=>[c.title||'제목 없음'],rec:c=>{const r=refsOf(c).map(refLabel);return r.length?[...new Set(r)]:['없음'];},who:c=>{const w=whoText(c);return w?w.split(', '):['없음'];},due:c=>[c.dueAt?md(kstDate(c.dueAt)):'없음'],at:c=>[md(kstDate(atOf(c)))||'없음'],place:c=>[placeOf(c)||'없음']};
  const FLAG_RANK=['지난 업무','담당 미지정','결정 필요','오늘 처리','중요','검토 필요','검토 대기','진행 중','처리 전','연습 시나리오'];
  const SORTV={state:c=>Math.min(...flags(c).map(f=>{const i=FLAG_RANK.indexOf(f[0]);return i<0?FLAG_RANK.length:i;})),title:c=>c.title||'',rec:c=>refLabel(refsOf(c)[0]),who:whoText,due:c=>c.dueAt?kstDate(c.dueAt):'',at:c=>Date.parse(atOf(c))||'',place:placeOf};
  // 선택(원장 10-28 "토글로 전체 선택같은거 해서 한번에 담당바꾸기 처리도 가능하게") — 원장·관리자만, 남은 단계가 있는 일만.
  // 선택한 업무는 쪽·정렬을 넘어 남고 보기를 바꾸면 비운다. 검색·필터로 목록에서 빠진 일은 선택한 것에서도 뺀다(안 보이는 일을 바꾸지 않게).
  const canPick=c=>lead()&&c.state!=='done'&&activeSteps(c).length>0&&c.familyId!=='approvals';
  function caseRow(c){
    const refs=refsOf(c),fl=flags(c),place=placeOf(c),who=whoText(c),at=when(atOf(c));
    const pick=lead()?`<td class="c-sel">${canPick(c)?`<input type="checkbox" data-fl-pick="${h(c.id)}" aria-label="${h([c.title,sumOf(c)].filter(Boolean).join(' — '))} 선택" ${store.sel.has(c.id)?'checked':''}>`:''}</td>`:'';
    // 관련 기록 = '기록 보기' 단추 하나(원장 10-28 "[기록보기] 라벨로 바꾸고 마우스 올리면 리스트 깔끔하게 정리해서 보여주는것도 · 혹은 눌렀을때도 오버레이로").
    return `<tr class="fl-row" data-case="${h(c.id)}">${pick}<td class="c-state"><span class="fl-cut fl-line" data-hint="${h(fl.map(([t,hint])=>hint?`${t} — ${hint}`:t).join('\n'))}">${chips(c)}</span></td><td class="c-title"><button type="button" class="fl-cut" data-fl="open" data-id="${h(c.id)}">${h(c.title)}</button>${c.summary?`<small class="fl-cut">${h(sumOf(c))}</small>`:''}</td><td class="c-rec">${refs.length?`<button type="button" class="fl-recbtn" data-fl="recs" data-id="${h(c.id)}" aria-haspopup="dialog">기록 보기<b>${fmt(c.signalId?c.entityTotal||refs.length:refs.length)}</b></button>`:'<span class="fl-dim">—</span>'}</td><td class="c-who"><span class="fl-cut">${h(who||'—')}</span></td><td class="c-due"><span class="fl-cut">${c.dueAt?h(md(kstDate(c.dueAt))):'—'}</span></td><td class="c-at"><span class="fl-cut">${h(at)}</span></td><td class="c-place">${place?`<button type="button" class="fl-place fl-cut" data-fl="goto" data-id="${h(c.id)}" aria-label="${h(place)} 열기">${h(place)}</button>`:'<span class="fl-dim">—</span>'}</td><td class="c-act">${actionBar(c,{compact:true})}</td></tr>`;
  }
  // What the previewed person can do on this case right now (the server still validates every command).
  // 보고·요청에 붙인 기록(서버가 복사본 기록 저장소에서 확인한 값) — 누르면 그 기록을 연다.
  const attachList=list=>(list||[]).length?`<ul class="fl-attach">${list.map(a=>`<li><button type="button" class="ax-text-link" data-fl="attach-open" data-id="${h(a.familyId)}" data-record="${h(a.recordId)}">${h(a.label)}</button><small>${h([api.familyLabel?.(a.familyId),a.date,a.status,...(a.fields||[]).slice(0,3).map(f=>`${f.label} ${f.value}`)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`:'';
  // compact = 표 한 줄용 — 주 동작 하나(처리 화면은 옆 열, 근거와 흐름·후속 보고는 제목을 누르면 열리는 상세 창).
  function actionBar(c,{compact=false,drawer=false}={}){
    const id=h(c.id),s=myStep(c),sk=s?h(s.id):'';
    const attendance=c.taskKind==='attendance_absent_desk'&&s&&!isReview(s)&&['ready','working'].includes(s.status);
    const unsent=c.taskKind==='unsent_report'&&s&&!isReview(s)&&['ready','working'].includes(s.status);
    const billing=c.signalId==='billing-remaining'&&c.factSignal&&s&&!isReview(s)&&['ready','working'].includes(s.status);
    const consultation=(c.taskKind==='followup_due'||c.signalId==='consultation-followup-overdue')&&s&&!isReview(s)&&['ready','working'].includes(s.status);
    if(c.state==='done')return `<div class="ax-actions">${lead()&&c.closure!=='fact'?btn('다시 열기','reopen-open',`data-id="${id}"`):''}${compact||drawer?'':btn('근거와 흐름','open',`data-id="${id}"`)}</div>`;
    if(compact){
      const first=attendance?btn('연락 결과 기록','attendance-open',`data-id="${id}" data-step="${sk}"`,true):unsent?btn('발송 요청','unsent-open',`data-id="${id}" data-step="${sk}"`,true):billing?btn('미수 안내 처리 보고','billing-open',`data-id="${id}" data-step="${sk}"`,true):consultation?btn('상담 후속조치 완료','consultation-open',`data-id="${id}" data-step="${sk}"`,true):s&&!isReview(s)&&s.status==='ready'?btn('확인','ack',`data-id="${id}" data-step="${sk}" data-fl-key="case.ack:${id}"`,true):s&&isReview(s)&&lead()?btn('검토','review-open',`data-id="${id}" data-step="${sk}"`,true):lead()&&activeSteps(c).length?btn(unassigned(c)?'담당 지정':'담당자 변경','reassign-open',`data-id="${id}"`):'';
      return `<div class="ax-actions">${first||'<span class="fl-dim">—</span>'}</div>`;
    }
    const out=[];
    if(attendance)out.push(btn('연락 결과 기록','attendance-open',`data-id="${id}" data-step="${sk}"`,true));
    if(unsent)out.push(btn('발송 요청','unsent-open',`data-id="${id}" data-step="${sk}"`,true));
    if(billing)out.push(btn('미수 안내 처리 보고','billing-open',`data-id="${id}" data-step="${sk}"`,true));
    if(consultation)out.push(btn('상담 후속조치 완료','consultation-open',`data-id="${id}" data-step="${sk}"`,true));
    if(s&&!isReview(s)&&s.status==='ready')out.push(btn('확인','ack',`data-id="${id}" data-step="${sk}" data-fl-key="case.ack:${id}"`,true));
    if(s&&!isReview(s)&&!billing)out.push(btn(c.closure==='fact'?'후속 보고 작성':'보고 작성','report-open',`data-id="${id}" data-step="${sk}"`,s.status==='working'));
    if(s&&isReview(s)&&lead())out.push(btn('검토','review-open',`data-id="${id}" data-step="${sk}"`,true));
    if(lead()&&activeSteps(c).length)out.push(btn(unassigned(c)?'담당 지정':'담당자 변경','reassign-open',`data-id="${id}"`));
    if(!drawer)out.push(btn('근거와 흐름','open',`data-id="${id}"`));
    // 일을 처리하는 화면으로 가는 길(원장 10-28 "만족도를 확인하러 가고 싶은데 어디로 가야하는지 배선 같은게 없음").
    const where=c.familyId&&api.familyLabel?.(c.familyId);if(where)out.push(btn(`${where} 열기`,'goto',`data-id="${id}"`));
    return `<div class="ax-actions">${out.join('')}</div>`;
  }
  const countCard=(label,value,detail,filter,tone='')=>`<button type="button" class="ax-signal fl-count ${tone}" data-fl="filter" data-id="${h(filter)}"><span class="ax-signal-kind"><span>${h(label)}</span></span><strong class="ax-signal-value">${fmt(value)}건</strong><span class="ax-signal-title">${h(detail)}</span><span class="ax-signal-go">아래에서 보기 ${icon('down')}</span></button>`;
  const stageCounts=list=>Object.keys(STATE).map(k=>[k,list.filter(c=>c.state===k).length]);
  function stateNote(){
    if(store.status==='loading'||store.status==='idle')return '<p class="ax-note" role="status">업무 흐름을 불러오는 중입니다.</p>';
    if(store.status==='ready'&&store.partial)return `<p class="ax-note" role="status">업무가 많아 앞쪽 ${fmt(cases().length)}건만 불러왔습니다(전체 ${fmt(Number(flow().casesTotal)||cases().length)}건). 잠시 뒤 다시 불러옵니다.</p>`;
    if(store.status==='starting')return `<p class="ax-note" role="status">${h(store.error||'업무 흐름 서버가 준비 중입니다.')} 잠시 뒤 다시 불러옵니다.</p>`;
    if(store.status==='unavailable')return '<p class="ax-note">업무 흐름을 불러올 수 없습니다. 지금 만든 요청은 새로고침하면 사라집니다.</p>';
    if(store.status==='error')return `<p class="ax-note" role="alert">${h(store.error)} ${btn('다시 불러오기','reload')}</p>`;
    return '';
  }
  // 기준일만 적는다 — 저장 횟수·AI 연결 상태는 개발자용이라 싣지 않는다(원장 10-28). AI를 못 쓰면 판정 칸이 그때 알린다.
  function sourceLine(){return `<p class="fl-source"><span>${md(asOf())} 기준</span></p>`;}

  /* ---------- left: whose work to preview ---------- */
  function sidebar(page){
    if(!ready()||!actors().length)return '';
    const me=actor(),count=inboxCount();
    const groups=ROLE_ORDER.map(r=>[r,actors().filter(a=>a.role===r)]).filter(([,list])=>list.length);
    const flowLink=role()==='owner'?`<a class="nav-item ${page==='flow'?'active':''}" href="#flow" ${page==='flow'?'aria-current="page"':''}>${icon('check')}<span>업무 흐름</span>${count?`<span class="nav-count" aria-label="${count}건">${count}</span>`:''}</a>`:'';
    return `<div class="nav-group">보는 사람</div><div class="fl-actor-pick">${actorPicker(groups)}${flowLink}</div>`;
  }
  function inboxCount(){
    if(!ready())return 0;
    return Number(flow().firstScreen?.inboxByActor?.[actor()?.id]||0);
  }

  /* ---------- role views ---------- */
  const navList=(active,title,items)=>items.length?`<p class="fl-nav-head">${h(title)}</p><ul>${items.map(([id,label,n])=>`<li><button type="button" data-fl="filter" data-id="${h(id)}" aria-pressed="${active===id}" class="${n?'':'zero'}"><span class="fl-cut">${h(label)}</span><b>${fmt(n)}</b></button></li>`).join('')}</ul>`:'';
  function filterBar(active,items){return `<div class="ax-filter" role="group" aria-label="보기">${items.map(([id,label,n])=>`<button type="button" data-fl="filter" data-id="${h(id)}" aria-pressed="${active===id}">${h(label)} ${fmt(n)}</button>`).join('')}</div>`;}
  // 쪽 나누기(원장 10-28 "106건 모두 보기 말고 적절한 위치에 페이지네이션 처리해. 전체개수는 필요없음") — 20건씩, 목록 바로 아래 쪽 번호만.
  // 쪽은 목록 열쇠마다 따로 기억하고, 보기·검색·필터·정렬이 바뀌면 첫 쪽으로 돌아간다.
  const PER_PAGE=20;
  function pageOf(items,key){const pages=Math.max(1,Math.ceil(items.length/PER_PAGE)),page=Math.min(Math.max(1,store.pages[key]||1),pages);return {page,pages,shown:items.slice((page-1)*PER_PAGE,page*PER_PAGE)};}
  function pager(key,page,pages){
    if(pages<=1)return '';
    const nums=pages<=7?Array.from({length:pages},(_,i)=>i+1):[...new Set([1,...[page-1,page,page+1].filter(n=>n>1&&n<pages),pages])].reduce((a,n)=>{if(a.length&&n-a.at(-1)>1)a.push('…');a.push(n);return a;},[]);
    const go=(n,label,attrs='')=>`<button type="button" data-fl="page" data-page-list="${h(key)}" data-id="${n}" ${attrs}>${label}</button>`;
    return `<nav class="fl-pager" aria-label="쪽 이동">${go(page-1,'‹ 이전',`aria-label="이전 쪽" ${page<=1?'disabled':''}`)}${nums.map(n=>n==='…'?'<span aria-hidden="true">…</span>':go(n,n,n===page?'aria-current="page"':`aria-label="${n}쪽"`)).join('')}${go(page+1,'다음 ›',`aria-label="다음 쪽" ${page>=pages?'disabled':''}`)}</nav>`;
  }
  // 카드 목록(직원·관리자 화면). 업무 흐름 보드의 표는 boardTable.
  function list(items,empty,key=''){
    if(!items.length)return `<p class="live-empty">${h(empty)}</p>`;
    const p=key?pageOf(items,key):{page:1,pages:1,shown:items};
    return `<div class="fl-list" ${key?`data-list="${h(key)}"`:''}>${p.shown.map(c=>caseCard(c)).join('')}</div>${pager(key,p.page,p.pages)}`;
  }
  function staffView(){
    const me=actor(),mineAll=cases().filter(c=>mine(c)),readyNow=newest(mineAll.filter(c=>myStep(c)?.status==='ready')),working=newest(mineAll.filter(c=>myStep(c)?.status!=='ready')),reviewing=cases().filter(c=>c.state!=='done'&&!mine(c)&&inReview(c)&&(c.evidence||[]).some(e=>e.actorId===me?.id));
    const done=cases().filter(c=>c.state==='done'&&(c.evidence||[]).some(e=>e.actorId===me?.id)).slice(0,6);
    return `<div class="fl-fold"><div class="page-heading"><div><h1>${h(me?.name||'')}님의 업무</h1><p>${h(me?.roleLabel||'')}</p></div></div>${sourceLine()}${stateNote()}<section class="ax-first" aria-label="지금 처리할 업무"><div class="ax-signals">${countCard('지금 할 차례',readyNow.length,'확인하면 진행 중으로 바뀝니다','ready')}${countCard('진행 중',working.length,'보고를 남기면 다음 사람에게 넘어갑니다','working')}${countCard('검토 대기',reviewing.length,'내가 보고한 업무의 검토 상태','reviewing')}</div></section><div class="fl-now"><h2>지금 처리할 업무 ${readyNow.length+working.length}건</h2>${list([...readyNow,...working],'지금 처리할 업무가 없습니다.','now')}</div></div><section class="fl-section" id="fl-detail"><h2>검토 대기 ${reviewing.length}건</h2>${list(reviewing,'검토를 기다리는 보고가 없습니다.','reviewing')}<h2>최근 완료 업무</h2>${list(done,'아직 완료한 업무가 없습니다.')}</section>`;
  }
  function managerView(){
    const open=cases().filter(c=>c.state!=='done'),my=newest(open.filter(c=>mine(c))),queue=open.filter(unassigned),overdue=open.filter(late),review=open.filter(inReview),back=open.filter(returned),chain=open.filter(c=>new Set((c.steps||[]).flatMap(s=>s.assigneeIds||[])).size>1);
    // A manager can also hold a step (e.g. teaches the class); their own turn comes first when there is one.
    const lists={mine:[my,'지금 내 차례인 업무가 없습니다.'],queue:[queue,'담당 미지정 업무가 없습니다.'],late:[overdue,'지난 업무가 없습니다.'],review:[review,'검토를 기다리는 업무가 없습니다.'],returned:[back,'보완 요청 업무가 없습니다.'],chain:[chain,'여러 사람을 거치는 업무가 없습니다.'],all:[open,'남은 업무가 없습니다.']};
    const f=lists[store.filter]?store.filter:my.length?'mine':'queue',[items,empty]=lists[f];
    return `<div class="fl-fold"><div class="page-heading"><div><h1>업무 조율</h1><p>${h(actor()?.name||'')} · ${h(actor()?.roleLabel||'')}</p></div></div>${sourceLine()}${stateNote()}<section class="ax-first" aria-label="조율할 업무"><div class="ax-signals">${my.length?countCard('내 차례',my.length,'내가 맡은 단계','mine','urgent'):''}${countCard('담당 미지정',queue.length,'담당을 지정해야 다음 단계가 시작됩니다','queue','urgent')}${countCard('지난 업무',overdue.length,'기한이 지났고 아직 끝나지 않은 업무','late')}${countCard('검토 대기',review.length,'보고가 들어와 확인이 필요한 업무','review')}${countCard('보완 요청',back.length,'보완 요청 업무','returned')}</div>${scenarioPanel()}</section></div><section class="fl-section" id="fl-detail">${filterBar(f,[['mine','내 차례',my.length],['queue','담당 미지정',queue.length],['late','지난 업무',overdue.length],['review','검토 대기',review.length],['returned','보완 요청',back.length],['chain','여러 사람 거침',chain.length],['all','남은 업무 전체',open.length]])}${list(items,empty,f)}${stageOverview()}</section>`;
  }
  function stageOverview(){
    const stages=Object.entries(flow().firstScreen?.stages||{}),total=Number(flow().casesTotal)||cases().length;
    if(!stages.length)return '<p class="ax-note" role="status">업무 수를 확인하는 중입니다.</p>';
    const realTotal=stages.reduce((n,[,count])=>n+count,0),devTotal=total-realTotal;
    const jams=(flow().metrics?.bottlenecks||[]).filter(b=>b&&b.waiting>0&&/[가-힣]/.test(b.label||'')).slice(0,4);
    // bottlenecks = open steps (ready or working) grouped by step role, over every case including local ones.
    return `<section class="fl-stages" aria-label="상태별 업무 수"><h2>상태별 업무 수</h2><div class="fl-stage-row">${stages.map(([k,n])=>`<div><span>${h(STATE[k])}</span><strong>${fmt(n)}</strong></div>`).join(`<i aria-hidden="true">${icon('chevron')}</i>`)}</div>${jams.length?`<p class="fl-jams">남은 단계가 많은 담당(직접 등록한 업무 포함) ${jams.map(b=>`<span>${h(b.label)} ${fmt(b.waiting)}개</span>`).join('')}</p>`:''}<p class="ax-note">학원 기록에서 생긴 업무 ${fmt(realTotal)}건 기준입니다(직접 등록한 업무 ${fmt(devTotal)}건 제외).${total>cases().length?` 전체 ${fmt(total)}건 중 ${fmt(cases().length)}건을 불러왔습니다.`:''}</p></section>`;
  }
  // 일은 상태 묶음(막힌·열린)보다 무슨 일인지로 먼저 보인다(원장 10-28 "막힌일, 열린일 보다 실제 어떤 일인지 분화해서 알려주는게 더 좋을듯").
  // 종류 = 2.0 업무 종류(taskKind)의 단계 이름, 묶음 신호는 제목에서 건수를 뗀 이름. 카드와 아래 목록이 같은 열쇠(kind:…)로 맞물린다.
  // 원장 결정 = 원장에게 직접 맡겨진 단계만(관리자 대기열의 담당 없는 일은 빼고 — 원장 10-28 "원장 결정이 8건이고 대기가 1건인데, 굳이 8건을 보여줄 필요가 잇나").
  const ownerDecides=c=>activeSteps(c).some(s=>(s.assigneeIds||[]).includes(actor()?.id));
  const kindLabel=c=>c.taskKind?(c.steps?.[0]?.label||c.title||c.taskKind):String(c.title||'').replace(/\s*·\s*[\d,]+\s*원$/,'').replace(/\s*[\d,]+\s*(건|명|개)$/,'').replace(/\s*[\d,]+\s*(건|명|개)$/,'')||'기타';
  const kindKey=c=>`kind:${c.taskKind||kindLabel(c)}`;
  function kindGroups(open){const g=new Map();for(const c of open){const k=kindKey(c);if(!g.has(k))g.set(k,{key:k,label:kindLabel(c),items:[]});g.get(k).items.push(c);}return [...g.values()].sort((a,b)=>b.items.length-a.items.length||a.label.localeCompare(b.label,'ko'));}
  const kindDetail=items=>{const parts=[['지난 업무',items.filter(late).length],['담당 미지정',items.filter(unassigned).length],['보완 요청',items.filter(returned).length]].filter(([,n])=>n);return parts.length?parts.map(([l,n])=>`${l} ${fmt(n)}`).join(' · '):stageCounts(items).filter(([k,n])=>k!=='done'&&n).map(([k,n])=>`${STATE[k]} ${fmt(n)}`).join(' · ');};
  // Owner: critical blocked handoffs, required decisions and stage counts on the first screen (cards reused by ax).
  function ownerCards(){
    if(!ready())return '';
    const open=cases().filter(c=>c.state!=='done'),decide=open.filter(ownerDecides),blocked=open.filter(c=>unassigned(c)||late(c)||returned(c)),moving=open.filter(c=>!local(c));
    // 원장 첫 화면은 원장의 일만(원장 10-28 "원장은 영상 업로드가 숙제 출제에 비해 잘되고 있냐 안되고 있냐만 보면 되는거 아닌가"):
    // 개별 처리 건(결석 전화·영상 확인 …)의 종류 카드는 첫 화면에서 빼고 아래 목록의 걸러 보기에만 둔다. 운영 상태는 ax.js가 지표 추세 카드로 그린다.
    return countCard('원장 결정 대기',decide.length,decide.length?kindGroups(decide).map(k=>`${k.label} ${fmt(k.items.length)}`).join(' · '):'지금 결정할 업무가 없습니다','decide',decide.length?'urgent':'');
  }
  function ownerStageCell(){
    if(!ready())return '';
    const stages=Object.entries(flow().firstScreen?.stages||{}),recent=events().filter(e=>e.origin!=='snapshot').slice(-1)[0];
    if(!stages.length)return '';
    return `<div class="ax-change-cell"><button type="button" class="ax-change-link" data-fl="filter" data-id="moving"><span>업무 흐름</span><strong>남은 업무 ${fmt(stages.filter(([k])=>k!=='done').reduce((n,[,v])=>n+v,0))}건</strong><span class="ax-stages">${stages.map(([k,n])=>`<span><b>${fmt(n)}</b>${STATE[k]}</span>`).join('')}</span><span class="ax-recent"><small>${recent?`최근 변화: ${h(recent.label||'')} · ${h(when(recent.at))}`:'아직 변화가 없습니다.'}</small></span></button></div>`;
  }
  // 업무 흐름 검색(원장 10-28 "당연히 각종 내용에 대해 검색가능해야함") — 제목 · 요약(원생·날짜·내용) · 상태 · 관련 기록 · 할 차례 · 기한 · 생긴 때 · 영역 · 종류.
  // 띄어쓰기로 나눈 낱말이 모두 들어 있어야 맞음 · 공백·대소문자는 무시.
  const fold=x=>String(x||'').toLowerCase().replace(/\s+/g,'');
  const plain=x=>String(x||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  function haystack(c){
    const s=stepOf(c),t=c.trigger||{};
    return fold([c.title,c.summary,sumOf(c),kindLabel(c),plain(chips(c)),...(c.entityRefs||[]).flatMap(r=>[r?.label,refLabel(r)]),...activeSteps(c).flatMap(st=>[st.label,whoOf(st)]),s?whoOf(s):'',c.dueAt?`${md(kstDate(c.dueAt))}까지`:'',when(t.at||c.createdAt),api.familyLabel?.(c.familyId)].filter(Boolean).join(' '));
  }
  const matchCase=(c,q)=>{const hay=haystack(c);return q.split(/\s+/).filter(Boolean).every(w=>hay.includes(fold(w)));};
  // 열 필터: 열마다 선택한 값 중 하나라도 가진 일만 남긴다. skip = 값 목록을 뽑는 그 열(자기 필터는 빼고 센다 — 엑셀과 같다).
  const colOn=()=>Object.entries(store.cols).filter(([k,v])=>COLV[k]&&Array.isArray(v));
  // 값을 여럿 가진 열(상태 표시·관련 기록·담당)은 칩과 같은 뜻으로 거른다: 뺀 값이 선택한 값보다 적으면 'OO 제외' = 뺀 값을 하나라도
  // 가진 일은 숨김, 아니면 'OO만' = 선택한 값을 하나라도 가진 일만(담당이 여럿인 일도 그 사람 몫으로 남는다).
  const allVals=k=>{const all=new Set();for(const x of board.base||[])for(const v of COLV[k](x))all.add(v);return [...all];};
  let modeKey='',modes=new Map();
  const colMode=k=>{const key=`${JSON.stringify(store.cols)}|${(board.base||[]).length}`;if(key!==modeKey){modeKey=key;modes=new Map(colOn().map(([col,vals])=>{const out=allVals(col).filter(v=>!vals.includes(v)).length;return [col,out&&out<vals.length?'except':'only'];}));}return modes.get(k)||'only';};
  const colPass=(c,skip='')=>colOn().every(([k,vals])=>k===skip||(colMode(k)==='except'?COLV[k](c).every(v=>vals.includes(v)):COLV[k](c).some(v=>vals.includes(v))));
  // 정렬은 안정 정렬(같은 값이면 원래 순서) · 빈 값은 방향과 상관없이 맨 뒤.
  function sortCases(list){
    const {col,dir}=store.sort,key=SORTV[col];if(!key)return list;
    const val=new Map(list.map(c=>[c,key(c)])),sign=dir==='desc'?-1:1;
    return [...list].sort((a,b)=>{const x=val.get(a),y=val.get(b),ex=x===''||x==null,ey=y===''||y==null;if(ex||ey)return ex===ey?0:ex?1:-1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ko',{numeric:true}));});
  }
  // 보드 계산 한 벌 — 화면 전체를 그릴 때와 검색·필터·정렬·쪽을 바꿀 때(표만 다시 그림)가 같은 값을 쓴다.
  // board.base = 보기 + 검색어까지 거른 일(열 머리 메뉴가 값 목록을 여기서 뽑는다).
  const board={base:[],items:[]};
  function boardParts(){
    const open=cases().filter(c=>c.state!=='done');
    const kinds=kindGroups(open.filter(c=>!local(c)));
    const lists={decide:open.filter(ownerDecides),mine:cases().filter(c=>mine(c)),...Object.fromEntries(kinds.map(k=>[k.key,k.items])),blocked:open.filter(c=>unassigned(c)||late(c)||returned(c)),moving:open.filter(c=>!local(c)),local:cases().filter(local),
      ...(store.cardLink?{card:open.filter(c=>store.cardLink.caseIds.has(c.id)&&(store.cardLink.tasks.includes(c.taskKind)||store.cardLink.signals.includes(c.signalId)))}:{}),done:cases().filter(c=>c.state==='done')};
    const f=lists[store.filter]?store.filter:'decide',q=(store.q||'').trim();
    board.base=q?lists[f].filter(c=>matchCase(c,q)):lists[f];
    const items=sortCases(board.base.filter(c=>colPass(c))),narrowed=Boolean(q)||colOn().length>0;
    if(store.selView!==f){store.sel.clear();store.selView=f;}
    const shownIds=new Set(items.map(c=>c.id));for(const id of store.sel)if(!shownIds.has(id)||!canPick(caseById(id)||{}))store.sel.delete(id);
    board.items=items;
    // 보기는 왼쪽 세로 목록(상태 · 종류 많은 순), 일은 오른쪽 표 — 칩 20여 개를 가로로 늘어놓지 않는다(원장 10-28 "너무 가로로 나열되어있고 공간 낭비 최악").
    // '내 차례' = 사이드바 '업무 흐름' 배지와 같은 수(검수 10-28 L8 — 배지와 맞는 보기가 없었다).
    const states=[...(store.cardLink?[['card',`${store.cardLink.label}의 열린 업무`,lists.card.length]]:[]),['decide','원장 결정 대기',lists.decide.length],['mine','내 차례',lists.mine.length],['moving','남은 업무 전체',lists.moving.length],['blocked','지난 업무 · 담당 미지정 업무',lists.blocked.length],['local','직접 등록한 업무',lists.local.length],['done','완료된 업무',lists.done.length]];
    const byKind=[...kinds].sort((a,b)=>b.items.length-a.items.length).map(k=>[k.key,k.label,k.items.length]),label=[...states,...byKind].find(([id])=>id===f)?.[1]||'';
    // 제목 옆 건수는 걸러 볼 때만(찾은 수) — 보기 전체 건수는 왼쪽 목록에 있다(원장 10-28 "왼쪽에도 있으므로 전체개수는 숨겨줘 상단은").
    return {f,q,states,byKind,label,count:narrowed?`찾은 업무 ${fmt(items.length)}건`:'',listHtml:boardTable(items,f,narrowed?'조건에 맞는 업무가 없습니다.':'이 조건에 맞는 업무가 없습니다.')};
  }
  function boardTable(items,f,empty){
    const {page,pages,shown}=pageOf(items,'board');
    const th=([key,label])=>{
      if(key==='act')return '<th class="c-act" scope="col"><span class="ax-visually-hidden">동작</span></th>';
      const dir=store.sort.col===key?store.sort.dir:'',filtered=Array.isArray(store.cols[key]);
      return `<th class="c-${key}" scope="col" aria-sort="${dir==='asc'?'ascending':dir==='desc'?'descending':'none'}"><button type="button" class="fl-th${dir||filtered?' on':''}" data-fl="col" data-col="${key}" aria-haspopup="dialog" aria-expanded="${colMenu.key===key}" aria-label="${label} — 정렬·필터${dir?` (${dir==='asc'?'오름차순':'내림차순'})`:''}${filtered?' (필터 켜짐)':''}"><span>${label}</span>${dir?`<b class="fl-th-mark" aria-hidden="true">${dir==='asc'?'▲':'▼'}</b>`:''}${filtered?'<b class="fl-th-mark" aria-hidden="true">●</b>':''}<i class="fl-th-caret" aria-hidden="true">${icon('down')}</i></button></th>`;
    };
    const pickAll=lead()?'<th class="c-sel" scope="col"><input type="checkbox" data-fl-pick-page aria-label="이 쪽의 업무 모두 선택"></th>':'';
    return `${activeFilters()}<div class="fl-tablewrap"><table class="fl-table"><thead><tr>${pickAll}${COLS.map(th).join('')}</tr></thead><tbody class="fl-tbody" data-list="${h(f)}">${shown.map(caseRow).join('')}</tbody></table>${items.length?'':`<p class="live-empty">${h(empty)}</p>`}</div>${pager('board',page,pages)}`;
  }
  // 걸러 보는 조건을 표 위에 칩으로 — 칩을 누르면 그 열의 필터만 지운다.
  function activeFilters(){
    const on=colOn();if(!on.length)return '';
    // 뺀 값이 선택한 값보다 적으면 'OO 제외'로 적는다(하나만 끈 필터가 남은 값 목록으로 길어지지 않게).
    const name=k=>COLS.find(c=>c[0]===k)?.[1]||'',few=v=>v.length>2?`${v.slice(0,2).join(', ')} 외 ${fmt(v.length-2)}`:v.join(', ');
    const vals=(k,v)=>{if(!v.length)return '선택한 값 없음';const out=allVals(k).filter(x=>!v.includes(x));return colMode(k)==='except'?`${few(out)} 제외`:few(v);};
    return `<div class="fl-active" role="group" aria-label="걸러 보는 조건">${on.map(([k,v])=>`<button type="button" class="fl-active-chip" data-fl="col-clear" data-col="${k}" aria-label="${h(name(k))} 필터 지우기"><span>${h(name(k))}: ${h(vals(k,v))}</span><b aria-hidden="true">×</b></button>`).join('')}${on.length>1?'<button type="button" class="ax-text-link" data-fl="col-clear" data-col="">필터 모두 지우기</button>':''}</div>`;
  }
  function ownerBelow({heading=true}={}){
    if(!ready())return stateNote();
    if(flow().summary){
      requestAnimationFrame(()=>{
        const target=document.getElementById('fl-detail');if(!target||target.dataset.flObserved)return;
        target.dataset.flObserved='1';
        if(store.fullError)return;
        const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();ensureFull();}});
        observer.observe(target);
      });
      return `<section class="fl-section" id="fl-detail" aria-labelledby="fl-detail-title"><h2 id="fl-detail-title" tabindex="-1" ${heading?'':'class="ax-visually-hidden"'}>업무 흐름</h2><p class="ax-note" role="status">${h(store.fullError||'업무 목록을 불러오는 중입니다.')}</p><button type="button" class="button" data-fl="load-full">업무 목록 불러오기</button></section>`;
    }
    const p=boardParts();hideTip();
    // 화면 전체를 다시 그려도 검색칸의 글자와 커서를 지킨다(8초 갱신·담당 변경 뒤). 열 머리 메뉴는 새 머리 칸 아래로 옮긴다.
    if(document.activeElement?.matches?.('[data-fl-search]'))queueMicrotask(()=>{const i=document.querySelector('[data-fl-search]');if(i){i.focus({preventScroll:true});i.setSelectionRange(i.value.length,i.value.length);}});
    if(colMenu.el)requestAnimationFrame(placeColMenu);requestAnimationFrame(syncBulk);
    // 업무 흐름 화면에서는 소제목을 숨긴다 — 페이지 제목이 같은 말이다(원장 10-28 "여기도 하단의 업무 흐름 중복임"). 이동 목표로는 남긴다.
    return `<section class="fl-section" id="fl-detail" aria-labelledby="fl-detail-title">${heading?'<div class="ax-section-head"><h2 id="fl-detail-title" tabindex="-1">업무 흐름</h2></div>':'<h2 id="fl-detail-title" class="ax-visually-hidden" tabindex="-1">업무 흐름</h2>'}<div class="fl-board"><div class="fl-board-head"><h3 class="fl-board-title">${h(p.label)}<span id="fl-board-count">${p.count}</span></h3><div class="fl-bulk" id="fl-bulk" role="group" aria-label="선택한 업무" ${store.sel.size?"":"hidden"}>${bulkHtml()}</div><input type="search" class="fl-search" data-fl-search value="${h(p.q)}" placeholder="이름·내용·담당·기록으로 찾기" aria-label="업무 흐름에서 찾기" autocomplete="off"></div><nav class="fl-nav" aria-label="보기">${navList(p.f,'상태',p.states)}${navList(p.f,'종류',p.byKind)}</nav><div id="fl-board-list" class="fl-board-list">${p.listHtml}</div></div>${scenarioPanel()}${stageOverview()}</section>`;
  }
  // 제목만 — 설명 줄은 두지 않는다(원장 10-28 "이런 자질구리한 멘트 필요없을듯").
  function fullView(){if(ready()&&flow().summary){if(!store.fullError)queueMicrotask(ensureFull);return `<p class="ax-note" role="status">${h(store.fullError||'업무 흐름을 불러오는 중입니다.')}</p>${store.fullError?btn('다시 불러오기','load-full'):''}`;}
    return role()==='owner'?`<div class="page-heading"><div><h1>업무 흐름</h1></div></div>${ownerBelow({heading:false})}`:role()==='manager'?managerView():staffView();}

  /* ---------- local scenarios (clearly local, tied to real copied records, not counted as history) ---------- */
  // The shared context picker (context-picker.js) when it is loaded; otherwise, or if it fails, the plain control.
  // Either way the form sends the same names (record, assignee).
  // 보는 사람도 공용 직원 선택창(원장 10-28 "모든 드랍다운 … 서식 일치") — 이름·역할·직급·과목·담임 반으로 찾는다. 못 그리면 기존 칸.
  function actorPicker(groups){const me=actor(),fallback=`<label class="ax-visually-hidden" for="fl-actor">보는 사람</label><select id="fl-actor" data-fl-actor>${groups.map(([r,list])=>`<optgroup label="${h(ROLE_GROUP[r])}">${list.map(a=>`<option value="${h(a.id)}" ${a.id===me?.id?'selected':''}>${h(a.name)}${a.preview?'':` · ${h(a.roleLabel||ROLE_GROUP[a.role])}`}${(a.duties||[]).includes('desk')?' · 데스크':''}</option>`).join('')}</optgroup>`).join('')}</select>`;return picker(()=>({id:'fl-actor',name:'actor',ariaLabel:'보는 사람',clearable:false,selected:me?[me.id]:[],attrs:{'data-fl-actor':''},...window.ContextPicker.lists.people({db,actors:groups.flatMap(([,list])=>list),subjectLabel:api.subjectLabel}),note:`${groups.flatMap(([,list])=>list).length}명`}),fallback);}
  function picker(config,fallback){try{return window.ContextPicker?window.ContextPicker.html(config()):fallback;}catch{return fallback;}}
  function scenarioPanel(){
    if(!ready()||!['owner','manager'].includes(role()))return '';
    // The server's candidates are the records event.simulate accepts (FK fields, up to its limit) with the full count in
    // totals; the picker shows them all and says when more exist. Without the server list, this month's records here.
    const sc=flow().scenarioCandidates||{},served=k=>(Array.isArray(sc[k])?sc[k]:[]).filter(x=>x&&x.id),total=k=>num(sc.totals?.[k]);
    const studentName=id=>db.students.find(s=>s.id===id)?.name||'';
    const absent=served('absence'),billRows=served('billing'),billItems=billRows.length?billRows:db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).slice(0,30);
    const absentOpts=absent.map(x=>({id:x.id,label:x.label||[x.date,studentName(x.studentId)].filter(Boolean).join(' · ')||'결석 기록'})),bills=billItems.map(i=>({id:i.id,label:i.label||[i.name||studentName(i.studentId),i.period,Number.isFinite(Number(i.remaining))?api.won(i.remaining):''].filter(Boolean).join(' · ')||'청구'}));
    const options=list=>`<option value="">자동 선택 · 이번 달 기록</option>${list.map(x=>`<option value="${h(x.id)}">${h(x.label)}</option>`).join('')}`;
    const CP=window.ContextPicker,auto='자동 선택 · 이번 달 기록';
    const absentField=picker(()=>({id:'fl-scn-absence',name:'record',label:'결석 기록',empty:auto,...(absent.length?CP.lists.absences({db,items:absent,cases:cases(),total:total('absence')}):CP.lists.absencesFromFlow({db,flow:flow()}))}),`<label>결석 기록<select name="record">${options(absentOpts)}</select></label>`);
    const billField=picker(()=>({id:'fl-scn-billing',name:'record',label:'청구',empty:auto,...CP.lists.invoices({db,items:billItems,cases:cases(),total:billRows.length?total('billing'):null})}),`<label>청구<select name="record">${options(bills)}</select></label>`);
    return `<section class="fl-scenarios" aria-labelledby="fl-scn-title"><h2 id="fl-scn-title">연습 시나리오</h2><p class="ax-note">실제 기록으로 연습 업무를 만듭니다. 원본 기록은 바뀌지 않고 집계에도 들어가지 않습니다.</p><div class="fl-scn-grid"><form class="fl-scn" data-fl-form="simulate" data-scenario="absence" novalidate><h3>결석 원생 연락</h3><p>보호자 연락 → (필요하면) 관리자 검토 → 담임 후속으로 넘어갑니다.</p>${absentField}<button class="button primary" type="submit" data-fl-key="event.simulate:absence">시나리오 시작</button></form><form class="fl-scn" data-fl-form="simulate" data-scenario="billing" novalidate><h3>수납 확인</h3><p>납부 내역 대조 → 관리자·원장 결정으로 넘어갑니다.</p>${billField}<button class="button primary" type="submit" data-fl-key="event.simulate:billing">시나리오 시작</button></form><div class="fl-scn"><h3>여러 담당자에게 요청</h3><p>담당자를 여러 명 선택하고 기한을 정해 보냅니다. 받은 사람의 화면에 바로 보입니다.</p>${btn('요청 작성','request')}</div></div></section>`;
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
  function decisionMemo(d,c,previous=false){
    const p=d.probabilities||{},route=dRoute(d),reasons=dReasons(d).filter(r=>r!==route),draft=d.draft,provider=dProvider(d);
    const basis=`업무 ${c.title} · ${previous?'지금 선택과 다른 이전 판정 기준':`자료 시각 ${window.AIResultMeta.time(flow().source?.capturedAt)} · 기준일 ${asOf()}`}`;
    // 확률·모델 이름·걸린 시간은 개발자용이라 싣지 않는다(원장 10-28). 긴급도는 등급이라 남긴다.
    const facts=[URGENCY[p.urgency]&&`긴급도 ${URGENCY[p.urgency]}`].filter(Boolean);
    const people=(d.suggestedAssigneeIds||[]).map(nameOf).filter(n=>n!=='담당 미지정');
    const draftHtml=draft&&draft.status==='ok'&&draft.explanation?`<div class="fl-draft"><p><strong>AI 설명 초안</strong>${CONCERN[draft.routeConcern]?` · ${h(CONCERN[draft.routeConcern])}`:''}</p>${window.AIResultMeta.html({model:draft.modelLabel||dModel(d)||'AI',at:draft.at||d.at,basis})}<p class="live-pre">${h(draft.explanation)}</p>${draft.nextAction?.title?`<p>다음 조치 제안: ${h(draft.nextAction.title)}${draft.nextAction.body?` — ${h(draft.nextAction.body)}`:''}</p>`:''}${Array.isArray(draft.missingInfo)&&draft.missingInfo.length?`<p>더 필요한 정보: ${h(draft.missingInfo.filter(x=>typeof x==='string').join(', '))}</p>`:''}<small>초안은 검토할 글입니다. 아무것도 보내지 않습니다.</small></div>`:draft&&['unavailable','error'].includes(draft.status)?'<p class="ax-note">AI 설명 초안을 받지 못했습니다.</p>':'';
    return `<p>${provider?pill(provider,'blue'):''} ${h(dStatus(d))}</p>${provider||d.model?window.AIResultMeta.html({model:dModel(d)||provider||'AI',at:d.at,basis}):''}${route||AREA[d.area]?`<p><strong>${h(route)}</strong>${AREA[d.area]?`${route?' · ':''}업무 영역 ${h(AREA[d.area])}`:''}</p>`:''}${facts.length?`<ul class="fl-facts">${facts.map(f=>`<li>${h(f)}</li>`).join('')}</ul>`:''}${people.length?`<p>추천 담당: ${h(people.join(', '))} <small>(배정은 정해진 규칙과 사람이 합니다)</small></p>`:''}${reasons.length?`<p>이유: ${h(reasons.join(' · '))}</p>`:''}${draftHtml}`;
  }
  function decisionView(c){
    const d=c.decision,pending=d?.status==='pending'||c.decisionPending===true,providers=Array.isArray(flow().aiStatus?.providers)?flow().aiStatus.providers:[];
    const jev=providers.find(p=>p.id==='jev'),claude=providers.find(p=>p.id==='claude-cli'),off=p=>p&&!['ready','ok'].includes(p.status);
    const lock=pending?'disabled':'',key=`data-id="${h(c.id)}" data-fl-key="case.analyze:${h(c.id)}" ${lock}`;
    const buttons=lead()&&c.state!=='done'?`<div class="ax-actions">${btn(d?'AI 판정 다시 받기':'AI 판정 받기','analyze',key)}${btn('AI 설명 초안까지 받기','analyze-draft',key)}</div>${off(jev)||off(claude)?`<p class="ax-note">${[jev,claude].filter(off).map(p=>h(PROVIDER[p.id]||'자동 판정')).join('·')}을 지금 쓸 수 없습니다. 눌러도 사람이 판단하도록 넘어갑니다.</p>`:''}`:'';
    if(!d&&!pending)return '';
    if(pending)return `<section class="ax-evidence fl-decision"><h3>판정</h3><p role="status">${pill('판정 중','amber')} ${d?.requestedAt?`${h(when(d.requestedAt))} 요청 · `:''}결과가 나오면 이 화면에 바로 나타납니다. 그동안 업무는 정해진 담당자에게 그대로 있습니다.</p>${d?.previous?`<details class="ax-detail"><summary>이전 판정</summary>${decisionMemo(d.previous,c,true)}</details>`:''}${buttons}</section>`;
    return `<section class="ax-evidence fl-decision"><h3>판정</h3>${decisionMemo(d,c)}${buttons}</section>`;
  }
  /* ---------- relationship tree: GET /api/flow/hierarchy?caseId= (contract v1) ----------
     A case whose evidence hangs off people (absence: teacher → class → student → records) reads as a tree instead of
     one repeated step per teacher. Only the opened case is read and a read never starts AI. Open branches, the picked
     student, the search text, drawer scroll and focus survive refreshes; expanding and picking change the DOM in place.
     Names, counts and summaries come from the server only: AI text carries its state, code facts are '기록 요약', and
     a case the server does not relate (422 hierarchy_unsupported) keeps its step sequence. */
  const HIER='/api/flow/hierarchy';
  const LEVEL={teacher:'선생님',class:'반',student:'원생'};
  const AI_STATE={queued:['AI 정리 대기',''],running:['AI 정리 중',''],ready:['AI 정리','blue'],review_needed:['AI 정리 · 사람 확인 필요','amber'],error:['AI 정리 실패','amber'],stale:['AI 정리 · 그 뒤 기록이 바뀜','amber'],skipped:['AI 정리 생략','']};
  const AI_WAIT={not_started:'아직 AI 정리를 하지 않았습니다.',queued:'AI 정리를 기다리고 있습니다.',running:'AI가 정리하고 있습니다.',error:'AI 정리를 하지 못했습니다.',stale:'기록이 바뀌어 AI 정리를 다시 해야 합니다.',review_needed:'사람이 판단할 업무로 넘겼습니다.',skipped:'AI 정리를 하지 않고 넘겼습니다.'};
  const FLOW_STATE={open:['처리 전',''],working:['진행 중','blue'],reported:['보고됨','green'],not_needed:['해당 없음','green'],needs_review:['검토 필요','amber'],unreachable:['연락 안 됨','amber'],partial:['일부 처리','blue']};
  // Facts the server computed in code (origin 'code'); keys without a label here are not shown.
  const FACTS=[['absencesInClass','이 반 결석','건'],['absencesAllClasses','모든 반 결석','건'],['classesWithAbsences','결석한 반','개'],['absencesLast7Days','최근 7일 결석','건'],['daysSinceLast','최종 결석 후','일'],['firstDate','처음',''],['lastDate','최종',''],['studentsAlsoInOtherClasses','다른 반에도 있는 원생','명'],['managerQueueRecords','관리자 대기열 기록','건'],['managerQueueTeachers','대기열로 간 담임','명']];
  const REC_STATUS={absent:'결석',late:'지각',present:'출석',early_leave:'조퇴',makeup:'보강'};
  const trees=new Map();let treeCase='',treeUid=0;
  const kidsOf=n=>(Array.isArray(n?.children)?n.children:[]).filter(k=>k&&typeof k==='object'&&k.id);
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
  const korean=t=>typeof t==='string'&&/[가-힣]/.test(t);
  const norm=t=>String(t??'').toLowerCase().replace(/\s+/g,'');
  const busy=s=>s==='queued'||s==='running';
  // A source case split into one step per person; its step labels repeat the title with a per-person count.
  const splitCase=c=>c.kind==='source'&&(c.steps||[]).filter(s=>(s.refs||[]).length).length>1;
  // Before the server answers: attendance evidence split by teacher is the shape the teacher → class → student tree is for.
  const relational=c=>splitCase(c)&&c.familyId==='attendance';
  const treeShown=id=>Boolean(id&&$(`#detail[open] [data-fl-case-root="${CSS.escape(id)}"]`));
  function treeEntry(id){let e=trees.get(id);if(!e){e={uid:++treeUid,status:'idle',data:null,etag:'',rev:null,at:'',stale:false,error:'',open:new Set(),unforce:new Set(),seeded:new Set(),picked:'',query:'',seq:0,controller:null,timer:0,retry:0,ids:new Map(),index:new Map(),parent:new Map()};trees.set(id,e);}return e;}
  const domId=(e,id)=>{if(!e.ids.has(id))e.ids.set(id,`fl-t${e.uid}-${e.ids.size+1}`);return e.ids.get(id);};
  function* nodesOf(n){if(!n)return;yield n;for(const k of kidsOf(n))yield* nodesOf(k);}
  function indexTree(e){e.index=new Map();e.parent=new Map();const go=(n,p)=>{e.index.set(n.id,n);if(p)e.parent.set(n.id,p.id);kidsOf(n).forEach(k=>go(k,n));};if(e.data?.root)go(e.data.root,null);if(e.picked&&!e.index.has(e.picked))e.picked='';}
  const aiActive=d=>{const a=d?.analysis||{};return a.status==='running'||num(a.pending)>0||num(a.running)>0||[d?.managerSummary,d?.ownerSummary,...[...nodesOf(d?.root)].map(n=>n.ai)].some(x=>busy(x?.status));};
  function stopTree(id){const e=trees.get(id);if(!e)return;e.controller?.abort();clearTimeout(e.timer);e.timer=0;e.seq++;if(e.status==='loading')e.status=e.data?'ready':'idle';}
  // Conditional read (ETag) of the opened case; a newer read or a closed drawer drops an older answer.
  async function fetchTree(id){
    const e=treeEntry(id);e.controller?.abort();clearTimeout(e.timer);e.timer=0;
    const controller=new AbortController(),seq=++e.seq;e.controller=controller;if(!e.data)e.status='loading';
    const failed=status=>{if(e.data){e.status='ready';e.stale=true;}else e.status=status;};
    try{
      const r=await fetch(`${HIER}?caseId=${encodeURIComponent(id)}`,{headers:{Accept:'application/json',...(e.data&&e.etag?{'If-None-Match':e.etag}:{})},signal:controller.signal});
      let j=null;if(r.status!==304){try{j=await r.json();}catch{/* not JSON: the server has no hierarchy endpoint */}}
      if(seq!==e.seq)return;
      e.rev=flow().revision;
      if(r.status===304&&e.data){e.status='ready';e.stale=false;}
      else if(r.ok&&j&&j.root&&typeof j.root==='object'){e.data=j;e.etag=r.headers.get('ETag')||'';e.status='ready';e.stale=false;e.error='';e.retry=0;e.at=new Date().toISOString();indexTree(e);}
      else if((r.status===404&&j?.error==='case_not_found')||(r.status===422&&j?.error==='hierarchy_unsupported')){e.status='none';e.data=null;}
      else if(r.status===422&&j?.error==='hierarchy_no_relationships'){e.status='norel';e.data=null;e.error=korean(j.message)?j.message:'';}
      else if(r.status===503&&j){failed('starting');if(e.retry++<5)e.timer=setTimeout(()=>{e.timer=0;if(treeShown(id))fetchTree(id);},3000);}
      else if(!j||[404,405,501].includes(r.status))failed('unavailable');
      else{e.error=message(j,r.status);failed('error');}
    }catch{if(controller.signal.aborted||seq!==e.seq)return;failed('unavailable');}
    if(e.status==='ready')seedTree(e);
    paintTree(id);
    if(e.status==='ready'&&!e.stale&&aiActive(e.data))e.timer=setTimeout(()=>{e.timer=0;if(treeShown(id))fetchTree(id);},4000);
  }
  // A teacher (or anyone who holds a teacher branch) opens on their own branch once; every other branch starts closed.
  function seedTree(e){const me=actor()?.id;if(!me||e.seeded.has(me))return;e.seeded.add(me);for(const n of nodesOf(e.data.root))if(n.level==='teacher'&&n.entityRef?.id===me)e.open.add(n.id);}
  const mineNode=n=>n.level==='teacher'&&Boolean(n.entityRef?.id)&&n.entityRef.id===actor()?.id;
  const orderKids=n=>{const k=kidsOf(n);return n.level==='academy'||!n.level?[...k.filter(mineNode),...k.filter(x=>!mineNode(x))]:k;};
  const nodeLabel=n=>String(n.label||'').trim()||`${LEVEL[n.level]||'묶음'} 이름 미입력`;
  const nodeDetail=n=>typeof n.detail==='string'&&n.detail.trim()?n.detail.trim():'';
  // Unit of the record count as the server names it ('결석 기록(건)' → '결석 기록').
  const recordWord=d=>{const w=String(d?.units?.records||d?.counts?.units?.records||'').replace(/\s*\(.*\)\s*$/,'').trim();return korean(w)?w:'기록';};
  const countText=(k,lv,word)=>{k=k||{};return [lv!=='student'&&num(k.students)!==null&&`원생 ${fmt(num(k.students))}명`,lv==='teacher'&&num(k.classes)!==null&&`반 ${fmt(num(k.classes))}개`,num(k.records)!==null&&`${word} ${fmt(num(k.records))}건`].filter(Boolean).join(' · ');};
  const ZERO_OK=new Set(['absencesInClass','absencesAllClasses','absencesLast7Days','daysSinceLast']);
  const factsText=f=>{if(!f||typeof f!=='object')return '';const out=FACTS.filter(([k])=>f[k]!==null&&f[k]!==undefined&&f[k]!=='').map(([k,label,unit])=>unit?(num(f[k])!==null&&(num(f[k])>0||ZERO_OK.has(k))?`${label} ${fmt(num(f[k]))}${unit}`:''):/^\d{4}-\d{2}-\d{2}/.test(String(f[k]))?`${label} ${md(String(f[k]).slice(0,10))}`:'').filter(Boolean);const b=f.studentsByFlowState;if(b&&typeof b==='object'){const s=Object.keys(FLOW_STATE).filter(k=>num(b[k])).map(k=>`${FLOW_STATE[k][0]} ${fmt(num(b[k]))}명`);if(s.length)out.push(`원생 처리 상태 ${s.join(', ')}`);}return out.join(' · ');};
  const recLabel=r=>korean(r.statusLabel)?r.statusLabel:REC_STATUS[r.status]||'상태 미입력';
  const stepsOf=(c,n)=>[...new Set(Array.isArray(n.stepIds)?n.stepIds:[])].map(id=>(c.steps||[]).find(s=>s.id===id)).filter(Boolean);
  const stepState=s=>s.skipped?'건너뜀':isReview(s)&&s.status==='ready'?STEP.review:STEP[s.status]||'상태 미확인';
  const flowPill=(f,prefix='')=>FLOW_STATE[f?.state]?pill(`${prefix}${FLOW_STATE[f.state][0]}`,FLOW_STATE[f.state][1]):'';
  // AI result with its state, or (no usable summary) an honest status line; code facts are a separate '기록 요약' line.
  const aiBasis=(e,target,ai)=>ai?.stale?`${target} · 지금 선택과 다른 이전 기록 기준`:
    `${target} · ${e?.data?.basis?.label||'업무 흐름'} · 자료 시각 ${window.AIResultMeta.time(e?.data?.basis?.capturedAt)} · 기준일 ${e?.data?.basis?.asOf||asOf()}`;
  function aiBlock(ai,{facts='',e=null,self='',target='업무'}={}){
    const s=ai?.status,text=typeof ai?.summary==='string'?ai.summary.trim():'';
    const factLine=facts?`<p class="fl-fact"><strong>기록 요약</strong> ${h(facts)}</p>`:'';
    const reasons=(Array.isArray(ai?.reasons)?ai.reasons:[]).filter(korean),act=ai?.suggestedAction;
    const labels=[korean(ai?.priorityLabel)&&[ai.priorityLabel,ai.priority==='first'?'amber':''],korean(ai?.managerAttentionLabel)&&[ai.managerAttentionLabel,''],korean(ai?.attentionLabel)&&[ai.attentionLabel,''],ai?.uncertain&&['사람 확인 필요','amber'],ai?.contradiction&&['판단이 서로 어긋남','amber'],ai?.partial&&['일부만 정리','amber']].filter(Boolean);
    const said=text?reasons:reasons.filter(r=>!labels.some(([x])=>r.includes(x)));
    const shown=(['ready','review_needed','stale'].includes(s)||ai?.stale===true)&&Boolean(text||labels.length||said.length);
    const wait=AI_WAIT[s]?`${AI_WAIT[s]}${korean(ai.reason)?` ${ai.reason}`:''}`:'';
    if(!shown)return `${factLine}${wait?`<p class="fl-ai-wait">${h(wait)}</p>`:''}`;
    const actText=typeof act==='string'?act:[act?.title,act?.body].filter(korean).join(' — ');
    const ev=e?(Array.isArray(ai.evidenceIds)?ai.evidenceIds:[]).filter(id=>id!==self).map(id=>e.index.get(id)).filter(Boolean):[];
    const head=text?AI_STATE[s]?.[0]||'AI 정리':s==='review_needed'?'AI 판단 · 사람 확인 필요':s==='stale'?'AI 판단 · 그 뒤 기록이 바뀜':'AI 판단';
    const tags=`${pill(head,AI_STATE[s]?.[1]??'blue')}${ai.stale===true&&s!=='stale'?pill('이전 기록 기준','amber'):''}${labels.map(([x,tone])=>pill(x,tone)).join('')}`;
    return `${factLine}<div class="fl-ai"><p class="fl-ai-head">${tags}</p>${window.AIResultMeta.html({model:ai.modelLabel||ai.provider||'AI',at:ai.updatedAt,basis:aiBasis(e,target,ai)})}${text?`<p class="live-pre">${h(text)}</p>`:''}${said.length?`<ul>${said.map(x=>`<li>${h(x)}</li>`).join('')}</ul>`:''}${actText?`<p>제안: ${h(actText)}</p>`:''}${ev.length?`<p class="fl-ai-ev"><strong>근거</strong>${ev.map(n=>`<button type="button" class="fl-ev-link" data-fl="tree-go" data-node="${h(n.id)}">${h(nodeLabel(n))}${nodeDetail(n)?` ${h(nodeDetail(n))}`:''}</button>`).join('')}</p>`:''}${busy(s)?`<p class="fl-ai-wait">${h(AI_WAIT[s])}</p>`:''}</div>`;
  }
  // Actions for one exact step (the server still checks who may act). On a teacher: confirm, a whole-step report, review
  // and reassign, all step-wide. On a student (scoped): only a report carrying that student's records in that class.
  function stepActions(c,s,scoped=null){
    if(!s||s.skipped||c.state==='done'||!['ready','working','review'].includes(s.status))return '';
    const id=h(c.id),sk=h(s.id),mine=(s.assigneeIds||[]).includes(actor()?.id)||(lead()&&queued(s)),fact=c.closure==='fact',out=[];
    if(scoped){if(mine&&!isReview(s))out.push(btn(fact?'이 원생 후속 보고 작성':'이 원생 보고 작성','report-open',`data-id="${id}" data-step="${sk}" data-node="${h(scoped.id)}"`,true));return out.length?`<div class="ax-actions">${out.join('')}</div>`:'';}
    if(mine&&!isReview(s)&&s.status==='ready')out.push(btn('확인','ack',`data-id="${id}" data-step="${sk}" data-fl-key="case.ack:${id}"`,true));
    if(mine&&!isReview(s))out.push(btn(relational(c)?(fact?'단계 전체 후속 보고':'단계 전체 보고 작성'):fact?'후속 보고 작성':'보고 작성','report-open',`data-id="${id}" data-step="${sk}"`,s.status==='working'));
    if(isReview(s)&&lead())out.push(btn('검토','review-open',`data-id="${id}" data-step="${sk}"`,true));
    if(lead())out.push(btn((s.assigneeIds||[]).length?'담당자 변경':'담당 지정','reassign-open',`data-id="${id}" data-step="${sk}"`));
    return out.length?`<div class="ax-actions">${out.join('')}</div>`:'';
  }
  const stepLines=(c,n,scoped=null)=>stepsOf(c,n).map(s=>`<div class="fl-node-step"><p><strong>담당 단계</strong> ${h(whoOf(s))} · ${h(stepState(s))}${s.evidenceRequired?' · 근거 필요':''}</p>${stepActions(c,s,scoped)}</div>`).join('');
  // A report on a whole step is not a per-student result; only a record-scoped state speaks for this student.
  function flowLine(n){
    const f=n.flow,covered=num(f?.coverage?.covered),total=num(f?.coverage?.total);if(!f||!FLOW_STATE[f.state]||(f.state==='open'&&!(f.followupCaseIds||[]).length&&!(covered>0)))return '';
    const scope=f.scope==='record'?'이 원생의 기록에 남긴 처리입니다.':f.scope==='step'?'선생님 단계 전체에 남긴 보고입니다. 이 원생만 따로 확인한 기록은 아닙니다.':'';
    const follow=(Array.isArray(f.followupCaseIds)?f.followupCaseIds:[]).map(caseById).filter(Boolean);
    return `<div class="fl-node-step"><p><strong>처리 상태</strong> ${h(FLOW_STATE[f.state][0])}${covered>0&&total?` · 기록 ${fmt(total)}건 중 ${fmt(covered)}건 보고됨`:''}${f.reportedAt?` · ${h(when(f.reportedAt))}`:''}${scope?`<br><small>${scope}</small>`:''}</p>${follow.length?`<div class="ax-actions">${follow.map(x=>btn(`후속: ${x.title}`,'open',`data-id="${h(x.id)}"`)).join('')}</div>`:''}</div>`;
  }
  const byStateLine=n=>{const b=n.flow?.byState;if(!b||typeof b!=='object')return '';const [who,unit]=['teacher','class','academy'].includes(n.level)?['원생','명']:['',''];const parts=Object.keys(FLOW_STATE).filter(k=>num(b[k])).map(k=>`${FLOW_STATE[k][0]} ${fmt(num(b[k]))}${unit}`);return parts.length&&Object.keys(FLOW_STATE).some(k=>k!=='open'&&num(b[k]))?`<p class="fl-fact"><strong>${who?`${who}별 `:''}처리 상태</strong> ${h(parts.join(' · '))}${n.level==='teacher'?' (여러 반 원생은 반마다 셈)':''}</p>`:'';};
  // Leaf pane: the student's AI result and code facts, every record with its link, the step that covers them, and the
  // student's other open work.
  function paneHtml(c,e,n){
    const recs=(Array.isArray(n.records)?n.records:[]).filter(r=>r&&typeof r==='object'),total=num(n.counts?.records);
    const dates=recs.map(r=>String(r.date||'').slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const facts=factsText(n.facts)||(recs.length?`${recordWord(e.data)} ${fmt(recs.length)}건${dates.length?` · 처음 ${md(dates[0])} · 최종 ${md(dates.at(-1))}`:''}`:'');
    const sid=n.level==='student'&&n.entityRef?.id,other=sid?cases().filter(x=>x.id!==c.id&&x.state!=='done'&&(x.entityRefs||[]).some(r=>r.type==='student'&&r.id===sid)):[];
    const open=r=>{const rec=r.recordId||'';return Boolean(r.familyId&&rec&&api.hasView(`workspace-${r.familyId}`))||Boolean(rec&&api.canOpenRecord?.(rec));};
    return `${sid?`<div class="ax-actions">${btn('원생 기록 열기','entity',`data-family="students" data-record="${h(sid)}"`)}</div>`:''}${aiBlock(n.ai,{facts,e,self:n.id,target:nodeLabel(n)})}${total!==null&&total>recs.length?`<p class="fl-tree-warn">${h(recordWord(e.data))} ${fmt(total)}건 중 ${fmt(recs.length)}건만 받았습니다.</p>`:''}${recs.length?`<ol class="fl-records" aria-label="${h(recordWord(e.data))} ${fmt(recs.length)}건">${recs.map(r=>`<li><span class="fl-rec-date">${h(md(String(r.date||'날짜 미입력').slice(0,10)))}</span><span>${h(recLabel(r))}</span><button type="button" class="fl-rec-open" data-fl="entity" data-family="${h(r.familyId||'')}" data-record="${h(r.recordId||'')}" ${open(r)?'':'disabled'}>기록 보기</button></li>`).join('')}</ol>`:'<p class="live-empty">이 묶음에 받은 기록이 없습니다.</p>'}${flowLine(n)}${stepLines(c,n,n.level==='student'?n:null)}${otherWork(other)}`;
  }
  // The student's other open work, same kind and state folded into one line with a button per case (by date).
  function otherWork(list){
    if(!list.length)return '';
    const groups=[];for(const x of list){const s=stepOf(x),state=s?`${stepState(s)} · ${whoOf(s)}`:STATE[x.state]||'';const g=groups.find(y=>y.title===x.title&&y.state===state);if(g)g.list.push(x);else groups.push({title:x.title,state,list:[x]});}
    const day=x=>{const d=kstDate(x.dueAt||x.createdAt);return d?md(d):'열기';};
    return `<div class="fl-node-other"><p><strong>이 원생의 다른 업무</strong></p>${groups.map(g=>g.list.length===1?`<div class="ax-actions">${btn(`${g.title} · ${g.state}`,'open',`data-id="${h(g.list[0].id)}"`)}</div>`:`<p>${h(g.title)} ${fmt(g.list.length)}건 · ${h(g.state)}</p><div class="ax-actions">${g.list.map(x=>btn(day(x),'open',`data-id="${h(x.id)}" aria-label="${h(`${g.title} ${day(x)}`)}"`)).join('')}</div>`).join('')}</div>`;
  }
  // Search keeps matches, their ancestors (opened to show them) and everything under a match.
  function searchSets(e){
    const term=norm(e.query),keep=new Set(),force=new Set();let hits=0;
    if(!term)return {term,keep,force,hits};
    const go=(n,under)=>{const self=norm(`${n.label||''} ${n.detail||''}`).includes(term);if(self)hits++;let below=false;for(const k of kidsOf(n))if(go(k,under||self))below=true;if(self||below||under)keep.add(n.id);if(below&&!e.unforce.has(n.id))force.add(n.id);return self||below;};
    kidsOf(e.data.root).forEach(k=>go(k,false));
    return {term,keep,force,hits};
  }
  function nodeHtml(c,e,n,q,siblings){
    if(q.term&&!q.keep.has(n.id))return '';
    const lv=n.level,kids=orderKids(n),leaf=!kids.length,dom=domId(e,n.id),label=nodeLabel(n),detail=nodeDetail(n);
    const open=leaf?e.picked===n.id:e.open.has(n.id)||q.force.has(n.id);
    const same=siblings.filter(x=>nodeLabel(x)===label&&nodeDetail(x)===detail).length;
    const steps=lv==='teacher'?stepsOf(c,n):[],step=steps.find(s=>['ready','working','review'].includes(s.status))||steps[0];
    const a=n.ai||{},judged=!a.summary&&korean(a.priorityLabel);
    const aiTags=judged?`${pill(a.priorityLabel,a.priority==='first'?'amber':'')}${a.status==='review_needed'||a.uncertain?pill('사람 확인 필요','amber'):''}${busy(a.status)||['error','stale'].includes(a.status)?pill(AI_STATE[a.status][0],AI_STATE[a.status][1]):''}`:`${AI_STATE[a.status]?pill(AI_STATE[a.status][0],AI_STATE[a.status][1]):''}${korean(a.priorityLabel)?pill(a.priorityLabel,a.priority==='first'?'amber':''):''}`;
    const tags=`${n.unassigned?pill('배정 미상','amber'):''}${n.status==='inactive'?pill('재직 아님','amber'):''}${step?pill((step.assigneeIds||[]).length?stepState(step):'담당 미지정',(step.assigneeIds||[]).length?'':'amber'):''}${lv==='student'?n.flow?.scope==='record'&&n.flow.state!=='open'?flowPill(n.flow):'':['partial','needs_review'].includes(n.flow?.state)?flowPill(n.flow,'원생 '):''}${aiTags}`;
    const row=`<div class="fl-node-row"><button type="button" class="fl-node-btn" data-fl="${leaf?'pick':'node'}" data-node="${h(n.id)}" aria-expanded="${open}" aria-controls="${dom}"><span class="fl-chev" aria-hidden="true">${icon('chevron')}</span><span class="fl-node-name">${h(label)}${detail?`<small>${h(detail)}</small>`:''}${mineNode(n)?'<small class="fl-mine">내 담당</small>':''}${same>1?'<small>같은 이름 있음</small>':''}</span><span class="fl-node-count">${h(countText(n.counts,lv,q.word))}</span></button>${tags?`<span class="fl-node-tags">${tags}</span>`:''}</div>`;
    if(leaf)return `<li class="fl-node" data-level="${h(lv||'')}">${row}<div class="fl-pane" id="${dom}" ${open?'':'hidden'}>${open?paneHtml(c,e,n):''}</div></li>`;
    const facts=factsText(n.facts),note=`${byStateLine(n)}${n.ai&&n.ai.status!=='not_started'||facts?aiBlock(n.ai,{facts,e,self:n.id,target:nodeLabel(n)}):''}`;
    return `<li class="fl-node" data-level="${h(lv||'')}">${row}<div class="fl-node-kids" id="${dom}" ${open?'':'hidden'}>${lv==='class'&&n.entityRef?.id&&!n.unassigned?`<div class="ax-actions fl-node-links">${btn('반 기록 열기','entity',`data-family="classes" data-record="${h(n.entityRef.id)}"`)}</div>`:''}${note?`<div class="fl-node-note">${note}</div>`:''}${lv==='teacher'?stepLines(c,n):''}<ul class="fl-tree-list">${kids.map(k=>nodeHtml(c,e,k,q,kids)).join('')}</ul></div></li>`;
  }
  function bodyHtml(c,e){
    const q={...searchSets(e),word:recordWord(e.data)},top=orderKids(e.data.root);
    if(!top.length)return '<p class="live-empty">이 업무에 묶인 선생님·반·원생이 없습니다.</p>';
    const list=top.map(k=>nodeHtml(c,e,k,q,top)).join('');
    return list?`<ul class="fl-tree-list fl-tree-top">${list}</ul>`:`<p class="live-empty">‘${h(e.query)}’에 맞는 선생님·반·원생이 없습니다.</p>`;
  }
  const hitsText=e=>{const q=searchSets(e);return q.term?`${fmt(q.hits)}곳 일치`:'';};
  function synth(title,s,e){return s&&typeof s==='object'?`<section class="fl-synth" aria-label="${h(title)}"><h4>${h(title)}</h4>${aiBlock(s,{facts:factsText(s.facts),e,target:title})}</section>`:'';}
  function progressLine(a){
    if(!a||typeof a!=='object')return '';
    if(a.status==='disabled')return '<p class="fl-tree-progress">AI 정리가 꺼져 있어 기록만 보여 줍니다.</p>';
    const parts=[['completed','끝남'],['running','정리 중'],['pending','대기'],['failed','실패'],['skipped','생략'],['stale','다시 정리 필요'],['reviewNeeded','사람 확인 필요']].filter(([k])=>num(a[k])).map(([k,l])=>`${l} ${fmt(num(a[k]))}`);
    if(!parts.length)return a.status==='idle'?'<p class="fl-tree-progress">AI 정리를 아직 시작하지 않았습니다.</p>':'';
    return `<p class="fl-tree-progress" role="status">AI 정리${a.status==='partial'?'(일부만 끝남)':a.status==='complete'?'(모두 끝남)':''} · ${h(parts.join(' · '))}</p>`;
  }
  function treeHtml(c,e){
    const d=e.data,k=d.counts||d.root.counts||{},cov=d.coverage||{},b=d.basis||{},r=role(),word=recordWord(d);
    const cells=[['원생',num(k.students),'명'],['반',num(k.classes),'개'],['선생님',num(k.teachers),'명'],[word,num(k.records),'건'],...(num(k.unmappedRecords)?[['배정 미상 기록',num(k.unmappedRecords),'건']]:[])].filter(x=>x[1]!==null);
    const teacherSum=kidsOf(d.root).reduce((s,t)=>s+(num(t.counts?.students)||0),0);
    const unknown=cov.unknown||{},cohort=cov.cohortCheck;
    const total=num(cov.totalRecords),returned=num(cov.returnedRecords),short=total!==null&&returned!==null&&returned<total;
    const warn=[...(Array.isArray(d.warnings)?d.warnings:[]).map(w=>typeof w==='string'?w:w?.message).filter(korean),cov.complete===false?short?`${word} ${fmt(total)}건 중 ${fmt(returned)}건만 나왔습니다. 빠진 기록이 있으니 아래 숫자를 전부로 보지 마세요.`:cohort&&cohort.ok===false?'':'이 정리는 완전하지 않습니다. 아래 숫자를 전부로 보지 마세요.':'',num(unknown.teacherRecords)||num(unknown.classRecords)?`담임이 미상인 기록 ${fmt(num(unknown.teacherRecords)||0)}건 · 반이 미상인 기록 ${fmt(num(unknown.classRecords)||0)}건은 '배정 미상' 묶음에 있습니다.`:'',cohort&&cohort.ok===false?`대상 확인이 맞지 않아 이 정리를 완전한 것으로 보지 마세요${['belowThreshold','outsideWindow','notEnrolled'].some(x=>num(cohort[x]))?`: ${[['belowThreshold','기준 미달 원생','명'],['outsideWindow','기간 밖 기록','건'],['notEnrolled','재원 아닌 원생','명']].filter(([x])=>num(cohort[x])).map(([x,l,u])=>`${l} ${fmt(num(cohort[x]))}${u}`).join(' · ')}`:''}.`:'',...(cov.complete===false&&Array.isArray(cov.notes)?cov.notes:[]).filter(korean)].filter((x,i,all)=>x&&all.indexOf(x)===i);
    const info=cov.complete===false?[]:(Array.isArray(cov.notes)?cov.notes:[]).filter(korean);
    const summary=r==='owner'?(d.ownerSummary?synth('원장용 정리',d.ownerSummary,e):synth('관리자용 정리',d.managerSummary,e)):r==='manager'?synth('관리자용 정리',d.managerSummary,e):'';
    return `<section class="fl-tree" aria-labelledby="fl-tree-title"><div class="fl-tree-head"><h3 id="fl-tree-title">선생님별 반·원생</h3><p>${korean(b.label)?h(b.label):(d0=>`${Number(d0.slice(5,7))}/${Number(d0.slice(8,10))} 기준`)(String(b.asOf||asOf()))}</p></div>${korean(b.interpretation)?`<p class="fl-tree-note">${h(b.interpretation)}</p>`:''}${cells.length?`<dl class="fl-tree-counts">${cells.map(([t,v,u])=>`<div><dt>${h(t)}</dt><dd>${fmt(v)}<small>${u}</small></dd></div>`).join('')}</dl>`:''}${num(k.students)!==null&&teacherSum>num(k.students)?'<p class="fl-tree-note">여러 반을 다니는 원생은 한 번만 셉니다. 선생님·반마다 나오는 원생 수를 더하면 이보다 많습니다.</p>':''}${info.length?`<details class="fl-tree-more"><summary>집계 기준</summary>${info.map(x=>`<p>${h(x)}</p>`).join('')}</details>`:''}${warn.map(x=>`<p class="fl-tree-warn" role="note">${h(x)}</p>`).join('')}${e.stale?`<p class="fl-tree-warn" role="status">정리를 새로 불러오지 못해 ${h(when(e.at))}에 받은 내용을 보여 줍니다. ${btn('다시 불러오기','tree-reload',`data-id="${h(c.id)}"`)}</p>`:''}${summary}${progressLine(d.analysis)}<div class="fl-tree-find"><label for="fl-tree-q">찾기</label><input id="fl-tree-q" type="search" data-fl-tree-q="${h(c.id)}" value="${h(e.query)}" placeholder="선생님·반·원생 이름" autocomplete="off" spellcheck="false"><span class="fl-tree-hits" aria-live="polite">${h(hitsText(e))}</span></div><div class="fl-tree-body" data-fl-tree-body>${bodyHtml(c,e)}</div></section>`;
  }
  // 정리된 단계(retired — 근거 기록의 담당이 바뀌어 빠진 단계, 기록 0)는 보이지 않는다.
  const chainHtml=c=>`<section class="fl-chain" aria-label="처리 단계"><h3>처리 단계</h3><ol>${(c.steps||[]).filter(s=>!s.retired).map(s=>`<li class="${s.id===c.currentStepId||activeSteps(c).includes(s)?'current':''} ${h(s.status)}"><strong>${h((c.steps||[]).length===1&&String(s.label||'').startsWith(`${c.title} · `)?c.title:s.label)}</strong><span>${h(s.skipped?'필요 없어 건너뜀':isReview(s)&&s.status==='ready'?STEP.review:STEP[s.status]||'상태 미확인')} · ${h(whoOf(s))}${s.roleLabel?` · ${h(s.roleLabel)}`:''}</span></li>`).join('')}</ol></section>`;
  // Without a tree: the steps as before. A case that needs a tree says plainly why the repeated steps are shown instead.
  function slotInner(c,e){
    if(e.status==='ready'&&e.data)return treeHtml(c,e);
    const hint=relational(c);
    if(['idle','loading','starting'].includes(e.status))return hint?`<section class="fl-tree"><div class="fl-tree-head"><h3>선생님별 반·원생</h3></div><p class="ax-note" role="status">${e.status==='starting'?'정리 서버가 준비 중입니다. 잠시 뒤 다시 불러옵니다.':'선생님·반·원생으로 묶는 중입니다.'}</p></section>`:chainHtml(c);
    if(e.status==='norel')return `<p class="fl-tree-warn" role="note">${e.error?h(e.error):'기록이 선생님·반·원생과 하나도 이어지지 않아 묶지 못했습니다.'} 아래는 단계 목록입니다.</p>${chainHtml(c)}`;
    if(hint&&e.status!=='none')return `<p class="fl-tree-warn" role="note">${e.status==='error'&&e.error?`${h(e.error)} `:''}선생님·반·원생으로 묶은 화면을 불러오지 못했습니다. 아래는 정리하기 전의 단계 목록이라 같은 제목이 선생님마다 되풀이됩니다. ${btn('다시 불러오기','tree-reload',`data-id="${h(c.id)}"`)}</p>${chainHtml(c)}`;
    return chainHtml(c);
  }
  // flow-hierarchy.mjs ADAPTERS와 같은 목록(서버가 계층으로 묶는 신호).
  const TREE_SIGNALS=new Set(['attendance-repeat-absence']);
  const treeable=c=>relational(c)||c.kind==='source'&&TREE_SIGNALS.has(c.signalId);
  function treeSlot(c){
    if(!treeable(c)){if(treeCase)stopTree(treeCase);treeCase='';return `<div class="fl-tree-slot">${chainHtml(c)}</div>`;}
    if(treeCase&&treeCase!==c.id)stopTree(treeCase);
    treeCase=c.id;const e=treeEntry(c.id);
    // Read again (ETag) when the flow moved or AI was still working when this case was last shown; a newly previewed
    // teacher gets their own branch opened on data already here.
    if(e.status==='idle'||(['ready','none','norel','unavailable','error'].includes(e.status)&&(e.rev!==flow().revision||(e.status==='ready'&&aiActive(e.data)&&!e.timer))))setTimeout(()=>{if(treeShown(c.id))fetchTree(c.id);},0);
    if(e.status==='ready'&&e.data)seedTree(e);
    return `<div class="fl-tree-slot" data-fl-tree-slot="${h(c.id)}">${slotInner(c,e)}</div>`;
  }
  // Repaints the tree in place; the focused control (node, step button or search with its caret) is put back.
  function paintTree(id,{body=false}={}){
    if(!treeShown(id))return;const c=caseById(id),e=trees.get(id),slot=$('#detail [data-fl-tree-slot]');if(!c||!e||!slot)return;
    const a=document.activeElement,inside=a&&slot.contains(a),key=inside?focusKey(a):'',caret=inside&&a.matches('input')?[a.selectionStart,a.selectionEnd]:null;
    const target=body&&slot.querySelector('[data-fl-tree-body]');
    if(target&&e.data){target.innerHTML=bodyHtml(c,e);const hits=slot.querySelector('.fl-tree-hits');if(hits)hits.textContent=hitsText(e);}
    else slot.innerHTML=slotInner(c,e);
    if(key){const next=slot.querySelector(key);if(next){next.focus({preventScroll:true});if(caret&&next.setSelectionRange)next.setSelectionRange(...caret);}}
  }
  const focusKey=a=>a.id==='fl-tree-q'?'#fl-tree-q':a.dataset.fl?`[data-fl="${CSS.escape(a.dataset.fl)}"]${['node','id','step'].map(k=>a.dataset[k]?`[data-${k}="${CSS.escape(a.dataset[k])}"]`:'').join('')}`:'';
  function toggleNode(el){
    const e=trees.get(treeCase),id=el.dataset.node,pane=document.getElementById(el.getAttribute('aria-controls'));if(!e||!pane)return;
    const expanded=el.getAttribute('aria-expanded')==='true';
    if(el.dataset.fl==='pick'){
      if(!expanded&&e.picked&&e.picked!==id){const prev=$(`#detail [data-fl="pick"][data-node="${CSS.escape(e.picked)}"]`),old=prev&&document.getElementById(prev.getAttribute('aria-controls'));if(old){old.hidden=true;old.innerHTML='';prev.setAttribute('aria-expanded','false');}}
      e.picked=expanded?'':id;pane.innerHTML=expanded?'':paneHtml(caseById(treeCase),e,e.index.get(id)||{});
    }else if(expanded){e.open.delete(id);e.unforce.add(id);}else{e.open.add(id);e.unforce.delete(id);}
    pane.hidden=expanded;el.setAttribute('aria-expanded',String(!expanded));
  }
  // An AI evidence link opens the path to that node (the search is cleared if it hides it) and brings it into view.
  function treeGo(id){
    const e=trees.get(treeCase),n=e?.index.get(id);if(!n)return;
    for(let p=e.parent.get(id);p;p=e.parent.get(p)){e.open.add(p);e.unforce.delete(p);}
    if(!kidsOf(n).length)e.picked=id;else{e.open.add(id);e.unforce.delete(id);}
    if(e.query&&!searchSets(e).keep.has(id))e.query='';
    paintTree(treeCase);
    const el=$(`#detail [data-fl-tree-slot] :is([data-fl="pick"],[data-fl="node"])[data-node="${CSS.escape(id)}"]`);if(!el)return;
    el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function showCase(id){
    if(flow().summary){ensureFull().then(ok=>{if(ok)showCase(id);else toast('업무 자료를 불러오지 못했습니다. 다시 시도해 주세요.');});return;}
    const c=caseById(id);if(!c)return;
    const timeline=(c.history||[]).map(eventById).filter(Boolean),missing=(c.history||[]).length-timeline.length;
    const links=(c.linkedCaseIds||[]).map(caseById).filter(Boolean);
    // 닫히는 조건은 부제(CLOSURE)가 이미 말한다 — 원본 업무의 상태만 한 줄(검수 10-28 M6).
    const fact=c.closure==='fact'&&!signalCase(c)&&(c.sourceStatusLabel||c.factClosed)?`<section class="ax-evidence"><h3>원본 업무</h3><p>${h(c.sourceStatusLabel?`원본 상태: ${c.sourceStatus==='open'&&late(c)?'지난 업무':sourceLabel(c)}`:'원본 기록')}${c.factClosed?` · 원본에서 닫힘${c.closedReason?`(${h(c.closedReason)})`:''}`:''}</p></section>`:'';
    const evid=c.evidence||[];
    const linkList=links.length?`<section class="ax-evidence"><h3>연결된 업무 ${links.length}건</h3><div class="ax-actions">${links.map(x=>btn(x.title,'open',`data-id="${h(x.id)}"`)).join('')}</div></section>`:'';
    const studentLink=c.studentRef?.id?`<div class="ax-actions">${btn('원생 열기','entity',`data-family="students" data-record="${h(c.studentRef.id)}"`)}</div>`:'';
    dialog('detail',c.title,c.factSignal?'근거별 처리 보고로 닫습니다':CLOSURE[c.closure]||'',`<div data-fl-case-root="${h(c.id)}"><div class="ax-issue-meta">${chips(c)}</div>${c.summary?`<p class="live-pre">${h(sumOf(c))}</p>`:''}${why(c)}${entityLinks(c)}${studentLink}${fact}${treeSlot(c)}${decisionView(c)}${evid.length||(c.attachments||[]).length?`<section class="ax-evidence"><h3>근거 ${evid.length}건</h3>${evid.map(e=>`<p><strong>${h(nameOf(e.actorId))}</strong> · ${h(when(e.at))}${OUTCOME[e.outcome]?` · ${h(OUTCOME[e.outcome])}`:e.outcome==='returned'?' · 보완 요청':e.outcome==='accepted'?' · 승인':''}<br><span class="live-pre">${h(e.note||'')}</span>${(e.recordRefs||[]).length?`<br><small>연결 기록 ${(e.recordRefs||[]).map(r=>h(r.label||'기록')).join(', ')}</small>`:''}</p>${attachList(e.attachments)}`).join('')}${(c.attachments||[]).length?`<h4>요청에 붙인 기록</h4>${attachList(c.attachments)}`:''}</section>`:''}${linkList}<section class="ax-request-timeline"><h3>사건 기록</h3><ol>${timeline.map(e=>`<li><strong>${h(e.label||'기록')}</strong><p>${h(e.actorId?nameOf(e.actorId):e.origin!=='snapshot'?'자동 처리':'원본 기록')} · ${h(when(e.at))}</p></li>`).join('')||'<li><p>사건 기록이 없습니다.</p></li>'}</ol>${missing>0?`<div class="ax-actions">${btn(`이전 사건 ${fmt(missing)}건 더 보기`,'older',`data-id="${h(c.id)}"`)}</div>`:''}</section>${actionBar(c,{drawer:true})}</div>`);
  }
  const pickerHtml=(selected=[])=>{const cur=actors().filter(a=>selected.includes(a.id)&&assignable(a)),people=[...cur,...actors().filter(a=>assignable(a)&&!selected.includes(a.id))];selected=cur.map(a=>a.id);return picker(()=>({id:'fl-assignee-reassign',name:'assignee',label:'담당자',multiple:true,required:true,selected,...window.ContextPicker.lists.people({db,actors:people,subjectLabel:api.subjectLabel})}),`<div class="fl-assignees live-scroll" role="group" aria-label="담당자">${people.map(a=>`<label><input type="checkbox" name="assignee" value="${h(a.id)}" ${selected.includes(a.id)?'checked':''}> ${h(a.name)} · ${h(a.roleLabel||ROLE_GROUP[a.role])}</label>`).join('')}</div>`);};
  // What a report covers. From a student in the tree: exactly that student's records in that class (sent as recordRefs).
  // From a teacher or the case: the whole step, with no per-student records, so no student reads as handled.
  function reportScope(c,s,node){
    const tree=trees.get(c.id),n=node&&tree?.index.get(node);
    if(n){
      const recs=(Array.isArray(n.records)?n.records:[]).filter(r=>r&&r.id),total=num(n.counts?.records),cls=tree.index.get(tree.parent.get(n.id)),word=recordWord(tree.data);
      return `<div class="fl-report-scope"><p><strong>보고 범위</strong> ${h(nodeLabel(n))}${nodeDetail(n)?` ${h(nodeDetail(n))}`:''}${cls?` · ${h(nodeLabel(cls))}`:''} · ${h(word)} ${fmt(recs.length)}건</p>${total!==null&&total>recs.length?`<p class="fl-tree-warn">${h(word)} ${fmt(total)}건 중 받은 ${fmt(recs.length)}건만 붙습니다.</p>`:''}<details><summary>붙는 기록 ${fmt(recs.length)}건</summary><ul>${recs.map(r=>`<li>${h(md(String(r.date||'날짜 미입력').slice(0,10)))} ${h(recLabel(r))}</li>`).join('')}</ul></details><p class="ax-note">이 원생의 이 반 기록에만 남습니다. 같은 단계의 다른 원생은 그대로입니다.</p><input type="hidden" name="scope" value="${h(n.id)}"></div>`;
    }
    if(relational(c))return `<div class="fl-report-scope"><p><strong>보고 범위</strong> ${h(s?whoOf(s):'')} 단계 전체</p><p class="ax-note">원생별 기록은 붙이지 않습니다.${tree?.status==='ready'?' 원생 한 명에 대한 보고는 선생님별 반·원생에서 원생을 선택해 남깁니다.':''}</p></div>`;
    const billing=c.signalId==='billing-remaining';
    return (c.entityRefs||[]).length?`<fieldset class="ws-multi"><legend>${billing?'처리한 청구 선택':'근거로 연결할 기록'}</legend>${c.entityRefs.map((r,i)=>`<label><input type="checkbox" name="ref" value="${i}" ${billing?'':'checked'}> ${h(refLabel(r))}</label>`).join('')}${billing?'<p class="ax-note">선택한 청구에만 처리 보고가 남습니다.</p>':''}</fieldset>`:'';
  }
  async function openAttendanceForm(id,stepId){
    const c=caseById(id),s=c&&myStep(c);
    if(!c||c.taskKind!=='attendance_absent_desk'||!s||s.id!==stepId)return;
    let response,body;
    try{response=await fetch(`/api/flow/card-attendance/records?caseId=${encodeURIComponent(id)}`,{headers:{Accept:'application/json'}});body=await response.json();}
    catch{toast('결석 기록을 불러오지 못했습니다. 다시 시도해 주세요.');return;}
    if(!response.ok){toast(message(body,response.status));return;}
    const records=Array.isArray(body.records)?body.records:[];
    if(!records.length){toast('처리할 결석 기록이 없습니다. 업무를 새로 불러와 주세요.');return;}
    const choices=records.map((r,i)=>`<label><input type="radio" name="recordRef" value="${h(r.recordRef)}" ${i===0?'checked':''} required> ${h([r.date,r.slotStart||'하루 전체',r.className].join(' · '))}</label>`).join('');
    const radio=(name,items,selected)=>`<fieldset class="ws-multi"><legend>${h(name==='state'?'처리 상태':name==='outcome'?'연락 결과':'연락 방법')}</legend>${items.map(([value,label])=>`<label><input type="radio" name="${name}" value="${h(value)}" ${value===selected?'checked':''}> ${h(label)}</label>`).join('')}</fieldset>`;
    dialog('modal','결석 연락 결과 기록',c.title,`<form class="ws-form" data-fl-form="attendance-card" data-id="${h(id)}" data-step="${h(stepId)}" novalidate><fieldset class="ws-multi"><legend>결석 기록 선택</legend>${choices}</fieldset><p class="ax-note">같은 날 다른 반 기록이 있으면 처리할 반과 교시를 확인해 주세요.</p>${radio('state',[['resolved','처리함'],['dismissed','확인 불필요']],'resolved')}${radio('outcome',[['','선택 안 함'],['coming','곧 옴'],['absent_today','오늘 안 옴'],['sick','아파서'],['already_here','이미 옴'],['no_answer','연락 안 됨'],['other','기타']],'')}${radio('contactedVia',[['','선택 안 함'],['phone','전화'],['kakao','카카오톡'],['in_person','직접 확인'],['other','기타']],'phone')}<label>메모<textarea name="note" rows="3" maxlength="2000"></textarea></label><p class="ax-note">연습 복사본에만 기록합니다. 저장 뒤 원본 업무 상태를 다시 확인합니다.</p><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">원본 반영 확인 중에는 완료로 표시하지 않습니다.</span><button class="button primary" type="submit">연락 결과 저장</button></div></form>`);
    $('#modal input[name="recordRef"]')?.focus({preventScroll:true});
  }
  function openUnsentForm(id,stepId){
    const c=caseById(id),s=c&&myStep(c);
    if(!c||c.taskKind!=='unsent_report'||!s||s.id!==stepId)return;
    const records=(c.entityRefs||[]).filter(r=>r.type==='report'&&r.id);
    if(!records.length){toast('이 업무와 연결된 수업보고서를 찾지 못했습니다. 업무를 새로 불러와 주세요.');return;}
    const options=records.map((r,i)=>`<label><input type="radio" name="recordRef" value="report:${h(r.id)}" ${i===0?'checked':''} required> ${h(r.label||'수업보고서')}</label>`).join('');
    dialog('modal','미발송 보고서 발송 요청',c.title,`<form class="ws-form" data-fl-form="unsent-card" data-id="${h(id)}" data-step="${h(stepId)}" novalidate><fieldset class="ws-multi"><legend>수업보고서 선택</legend>${options}</fieldset><p class="ax-note">발송 요청은 연습 복사본의 대기 상태까지만 저장됩니다. 실제로 학부모에게 보내지지 않습니다.</p><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">원본 반영 확인 뒤 업무 상태를 갱신합니다.</span><button class="button primary" type="submit">발송 요청 저장</button></div></form>`);
    $('#modal input[name="recordRef"]')?.focus({preventScroll:true});
  }
  async function openConsultationForm(id,stepId){
    const c=caseById(id),s=c&&myStep(c);
    if(!c||!(c.taskKind==='followup_due'||c.signalId==='consultation-followup-overdue')||!s||s.id!==stepId)return;
    let response,body;
    try{response=await fetch(`/api/flow/card-consultation/records?caseId=${encodeURIComponent(id)}`,{headers:{Accept:'application/json'}});body=await response.json();}
    catch{toast('상담 기록을 불러오지 못했습니다. 다시 시도해 주세요.');return;}
    if(!response.ok){toast(message(body,response.status));return;}
    const records=Array.isArray(body.records)?body.records:[];
    if(!records.length){toast('완료할 상담 후속조치 기록이 없습니다. 업무를 새로 불러와 주세요.');return;}
    const choices=records.map((r,i)=>`<label><input type="radio" name="recordRef" value="${h(r.recordRef)}" ${i===0?'checked':''} required> ${h([r.label,r.due].filter(Boolean).join(' · '))}</label>`).join('');
    dialog('modal','상담 후속조치 완료',c.title,`<form class="ws-form" data-fl-form="consultation-card" data-id="${h(id)}" data-step="${h(stepId)}" novalidate><fieldset class="ws-multi"><legend>상담 기록 선택</legend>${choices}</fieldset><p class="ax-note">실제로 후속조치를 마친 상담만 선택해 주세요. 연습 복사본에 완료 표시를 저장한 뒤 원본 업무 상태를 다시 확인합니다.</p><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">원본 반영 확인 중에는 완료로 표시하지 않습니다.</span><button class="button primary" type="submit">후속조치 완료 저장</button></div></form>`);
    $('#modal input[name="recordRef"]')?.focus({preventScroll:true});
  }
  function openForm(kind,id,step='',node=''){
    const c=caseById(id);if(!c)return;const s=(step&&(c.steps||[]).find(x=>x.id===step))||myStep(c)||stepOf(c),sk=s?h(s.id):'';
    const billingTitle=c.signalId==='billing-remaining'?'미수 안내 처리 보고':null;
    const billingIntro=billingTitle?'<p class="ax-note">실제로 안내한 청구만 선택하고 처리 내용을 기록해 주세요. 이 보고는 납부 상태를 바꾸지 않습니다.</p>':'';
    if(kind==='report')dialog('modal',billingTitle||(c.closure==='fact'&&!c.factSignal?'후속 보고 작성':'보고 작성'),c.title,`<form class="ws-form" data-fl-form="report" data-id="${h(id)}" data-step="${sk}" novalidate>${billingIntro}${c.factSignal?`<p class="ax-note">${h(c.doneRule||'완료·해당 없음으로 보고하면 이 단계의 기록이 처리된 것으로 남고, 모든 단계가 처리되면 이 업무가 닫힙니다.')}</p>`:c.closure==='fact'?`<p class="ax-note">${signalCase(c)?'이 업무는 원본 기록이 바뀌어야 닫힙니다. 이 보고는 따로 남는 후속 기록이 되고, 이 업무는 끝나지 않은 채로 남습니다.':'원본 업무는 원본 기록이 처리되어야 닫힙니다. 이 보고는 따로 남는 후속 기록이 되고, 원본 업무는 끝나지 않은 채로 남습니다.'}</p>`:''}${reportScope(c,s,node)}${picker(()=>({id:'fl-report-outcome',name:'outcome',label:'결과',clearable:false,selected:['done'],...window.ContextPicker.lists.choices({columns:[{key:'name',label:'결과'},{key:'note',label:'뜻',w:'minmax(0,1.6fr)'}],items:Object.entries(OUTCOME).map(([k,v])=>({value:k,title:v,cells:{note:OUTCOME_NOTE[k]||''}}))})}),`<label>결과<select name="outcome">${Object.entries(OUTCOME).map(([k,v])=>`<option value="${k}">${h(v)}</option>`).join('')}</select></label>`)}<label><span>보고 내용 <em aria-hidden="true">*</em></span><textarea name="note" rows="4" maxlength="2000" required></textarea></label>${api.attachField?.(`fl-report-${c.id}`.replace(/[^\w-]/g,'_'),c.familyId)||''}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">보고는 이 업무의 근거로 남습니다.</span><button class="button primary" type="submit" data-fl-key="case.report:${h(id)}">보고 보내기</button></div></form>`);
    if(kind==='review')dialog('modal','검토',c.title,`<div class="fl-review-evidence">${(c.evidence||[]).slice(-2).map(e=>`<p><strong>${h(nameOf(e.actorId))}</strong> · ${h(e.note||'')}</p>`).join('')||'<p>보고 내용이 없습니다.</p>'}</div><form class="ws-form" data-fl-form="review" data-id="${h(id)}" data-step="${sk}" novalidate><fieldset class="ws-multi"><legend>결정</legend><label><input type="radio" name="decision" value="accept" required> 승인하고 다음 단계로</label><label><input type="radio" name="decision" value="return"> 보완 요청</label></fieldset><label>메모(보완 요청 시 필수)<textarea name="note" rows="3" maxlength="2000"></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">결정은 사건 기록에 남습니다.</span><button class="button primary" type="submit" data-fl-key="case.review:${h(id)}">결정 보내기</button></div></form>`);
    // A step chosen from the tree (a teacher's own step) wins; otherwise an unassigned step first, as before.
    const open=activeSteps(c),target=(step&&open.find(x=>x.id===step))||open.find(x=>!(x.assigneeIds||[]).length)||s;
    if(kind==='reassign')dialog('modal',unassigned(c)?'담당 지정':'담당자 변경',[c.title,sumOf(c)].filter(Boolean).join(' — '),`<form class="ws-form" data-fl-form="reassign" data-id="${h(id)}" novalidate>${open.length>1?`${picker(()=>({id:'fl-reassign-step',name:'step',label:'변경할 단계',clearable:false,selected:target?[target.id]:[],...window.ContextPicker.lists.choices({noun:'단계',columns:[{key:'name',label:'단계'},{key:'who',label:'현재 담당자'}],items:open.map(x=>({value:x.id,title:x.label,cells:{who:whoOf(x)}}))})}),`<label>변경할 단계<select name="step">${open.map(x=>`<option value="${h(x.id)}" ${x===target?'selected':''}>${h(x.label)} · ${h(whoOf(x))}</option>`).join('')}</select></label>`)}`:`<p>현재 담당자: ${h(target?whoOf(target):'없음')}</p><input type="hidden" name="step" value="${h(target?.id||'')}">`}${pickerHtml(target?.queue?[]:target?.assigneeIds||[])}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">변경 내역은 업무 이력에 기록됩니다.</span><button class="button primary" type="submit" data-fl-key="case.reassign:${h(id)}">담당 저장</button></div></form>`);
    if(kind==='reopen')dialog('modal','다시 열기',c.title,`<form class="ws-form" data-fl-form="reopen" data-id="${h(id)}" novalidate><label>다시 여는 이유 <em aria-hidden="true">*</em><textarea name="note" rows="3" maxlength="2000" required></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">최종 단계 담당자의 업무로 돌아갑니다.</span><button class="button primary" type="submit" data-fl-key="case.reopen:${h(id)}">다시 열기</button></div></form>`);
    $('#modal form :is(textarea,select,input:not([type=hidden]))')?.focus();
  }

  // Notifications for the previewed person: events addressed to them, else events on cases they take part in.
  function notices(){
    if(!ready())return '';
    if(flow().summary){if(!store.fullError)queueMicrotask(ensureFull);return `<p class="ax-note" role="status">${h(store.fullError||'업무 알림을 불러오는 중입니다.')}</p>${store.fullError?btn('다시 불러오기','load-full'):''}`;}
    const me=actor()?.id,involved=c=>(c.steps||[]).some(s=>(s.assigneeIds||[]).includes(me))||c.trigger?.actorId===me||(c.evidence||[]).some(e=>e.actorId===me);
    const list=events().filter(e=>e.origin!=='snapshot'&&(Array.isArray(e.targetActorIds)?e.targetActorIds.includes(me):role()==='owner'||involved(caseById(e.caseId)||{}))).slice(-20).reverse();
    return `<section class="fl-notices" aria-label="업무 흐름 알림"><h2>업무 흐름 알림 ${list.length}건</h2>${list.map(e=>{const c=caseById(e.caseId);return `<article><div class="ax-issue-meta"><span>${h(when(e.at))}</span></div><h3>${h(e.label||'기록')}</h3><p>${h(e.actorId?nameOf(e.actorId):'자동 처리')}${c?` · ${h(c.title)}`:''}</p>${c?`<div class="ax-actions">${btn('근거와 흐름','open',`data-id="${h(c.id)}"`)}</div>`:''}</article>`;}).join('')||'<p class="live-empty">이 사람에게 온 흐름 알림이 없습니다.</p>'}</section>`;
  }

  /* ---------- adapters for the existing owner request UI (ax.js) ---------- */
  // Owner requests are cases with kind 'request'; ax renders them through the same rows/detail it used before.
  const statusOf=c=>c.state==='done'?'done':(c.steps||[]).some(s=>!s.retired&&!isReview(s)&&(s.status==='working'||s.status==='done'))?'working':'requested';
  function asRequests(){
    return cases().filter(c=>(c.kind==='request'||c.origin==='dev'&&c.closure==='manual'&&!c.kind)&&!(c.linkedCaseIds||[]).length).map(c=>({id:c.id,flow:true,title:c.title,body:c.summary||'',owners:[...new Set((c.steps||[]).filter(s=>!isReview(s)).flatMap(s=>s.assigneeIds||[]))],due:String(c.dueAt||'').slice(0,10),priority:PRIORITY[c.priority]||'보통',status:statusOf(c),channels:Array.isArray(c.channels)?c.channels:['app'],issues:Array.isArray((c.requestSource||c.source)?.issueIds)?(c.requestSource||c.source).issueIds:[],context:c.familyId?{family:c.familyId,familyLabel:api.familyLabel?.(c.familyId)||'',records:(c.entityRefs||[]).map(r=>({id:String(r.recordId||r.id),label:r.label}))}:null,source:(c.requestSource||c.source)?.kind||'direct',result:(c.evidence||[]).slice(-1)[0]?.note||'',events:(c.history||[]).map(eventById).filter(Boolean).map(e=>({label:e.label||'기록',text:`${e.actorId?nameOf(e.actorId):'자동 처리'} · ${when(e.at)}`}))}));
  }
  // Workspace family → record type the flow server knows. Only references it can resolve are attached; the record
  // names stay in the request body either way, so nothing is lost when a reference cannot be attached.
  const REF_TYPE={students:'student',classes:'class',attendance:'attendance',billing:'invoice',consultations:'consultation',enrollment:'lead',approvals:'approval','withdrawal-reports':'withdrawal_report','lesson-reports':'report','textbook-requests':'textbook_order',inventory:'asset','video-homework':'video'};
  const ALWAYS_KNOWN=new Set(['student','class']);
  async function createRequest(v){
    if(!await ensureFull()){toast('업무 자료를 불러오지 못했습니다. 다시 시도해 주세요.');return null;}
    const people=(v.owners||[]).map(actorById);
    if(people.some(a=>!assignable(a))){toast('업무 흐름에서 배정할 수 없는 사람이 있습니다. 담당자를 다시 선택해 주세요.');return null;}
    if(String(v.title).length>80){toast('업무 흐름 요청의 제목은 80자까지입니다.');return null;}
    const type=REF_TYPE[v.context?.family],known=new Set((flow().entities||[]).map(e=>`${e.type}:${e.id}`));
    const refs=[...new Set([...(type?(v.context.records||[]).map(r=>`${type}:${r.id}`).filter(k=>ALWAYS_KNOWN.has(type)||known.has(k)):[]),...(v.context?.card?.refs||[]).map(r=>`${r.type}:${r.id}`).filter(k=>known.has(k))])].slice(0,20);
    const kind=['issue','workspace','chat','task','direct'].includes(v.source)?v.source:v.context?'workspace':'direct';
    const source={kind,...(v.issues?.length?{issueIds:v.issues.slice(0,10)}:{}),...(v.context?.signal?{signalId:String(v.context.signal)}:{}),...(v.context?.action?{actionId:String(v.context.action)}:{}),...(v.context?.familyLabel?{label:String(v.context.familyLabel).slice(0,80)}:{}),...(v.context?.card?{card:v.context.card}:{})};
    const payload={title:v.title,body:String(v.body).slice(0,2000),assigneeIds:v.owners,...(/^\d{4}-\d{2}-\d{2}$/.test(v.due||'')?{dueAt:v.due}:{}),priority:v.priority==='높음'?'high':'normal',...(v.context?.family?{familyId:v.context.family}:{}),...(refs.length?{recordRefs:refs}:{}),...(v.attachments?.length?{attachments:v.attachments.slice(0,20)}:{}),channels:(v.channels||[]).filter(ch=>ch==='app'||ch==='slack'),source};
    const result=await command('request.create',{payload,key:`request.create:${v.draftKey||'direct'}`});
    return result?{caseId:result.caseId||'',duplicate:!!result.duplicate}:null;
  }
  const cardRequestFor=(metric,factIds)=>{
    if(!ready()||flow().summary)return undefined;
    if(!Array.isArray(factIds))return null;
    const key=[...factIds].sort().join('|');
    return cases().find(c=>c.kind==='request'&&c.state!=='done'&&c.requestSource?.card?.metric===metric&&[...(c.requestSource.card.factIds||[])].sort().join('|')===key)||null;
  };
  async function openCardFlow({label='',tasks=[],signals=[],caseIds=[]}={}){
    if(!await ensureFull()){toast('업무 목록을 불러오지 못했습니다. 다시 시도해 주세요.');return;}
    store.cardLink={label:String(label||'카드'),tasks:[...tasks],signals:[...signals],caseIds:new Set(caseIds)};
    store.filter='card';store.q='';store.cols={};store.pages.board=1;
    navigate('flow');
  }
  const actAs=async(kind,caseId,actorId,payload={})=>{if(!await ensureFull())return null;const c=caseById(caseId),s=c&&myStep(c,actorId);return command(kind,{caseId,payload:{...(s?{stepId:s.id}:{}),...payload},actorId,key:`${kind}:${caseId}`});};

  /* ---------- 열 머리 메뉴: 정렬 · 값 필터(원장 10-28 "전부 필터 및 검색, 오름/내림차순 정렬 가능하게") ---------- */
  // 엑셀처럼 열 머리를 누르면 그 아래 작은 창 — 오름·내림차순, 그 열의 값 목록(건수와 함께 · 찾기 칸으로 좁힘)을 골라 거른다.
  // 선택하는 즉시 표에 반영하고 창은 열어 둔다. 값 목록은 검색어와 다른 열의 필터를 거친 일에서 뽑는다(그 열 자신의 필터는 빼고).
  const colMenu={key:'',el:null,q:''};
  const COLRAW={due:c=>c.dueAt?kstDate(c.dueAt):'',at:c=>kstDate(atOf(c))};
  function colValues(key){
    const n=new Map(),raw=new Map();
    for(const c of board.base.filter(c=>colPass(c,key)))for(const v of COLV[key](c)){n.set(v,(n.get(v)||0)+1);if(COLRAW[key]&&!raw.has(v))raw.set(v,COLRAW[key](c));}
    return [...n].sort((a,b)=>a[0]==='없음'?1:b[0]==='없음'?-1:COLRAW[key]?String(raw.get(a[0])).localeCompare(String(raw.get(b[0]))):b[1]-a[1]||a[0].localeCompare(b[0],'ko'));
  }
  const colLabel=key=>COLS.find(c=>c[0]===key)?.[1]||'';
  function colListHtml(key){
    const sel=store.cols[key],on=v=>!Array.isArray(sel)||sel.includes(v),q=fold(colMenu.q),vals=colValues(key),shown=q?vals.filter(([v])=>fold(v).includes(q)):vals;
    if(!shown.length)return `<p class="fl-dim">${vals.length?'맞는 값이 없습니다.':'선택할 값이 없습니다.'}</p>`;
    return `<label class="fl-colpop-all"><input type="checkbox" data-flc="all"><span>${q?'찾은 값 모두':'모두'}</span></label>${shown.map(([v,n])=>`<label><input type="checkbox" data-flc="val" value="${h(v)}" ${on(v)?'checked':''}><span>${h(v)}</span><b>${fmt(n)}</b></label>`).join('')}`;
  }
  // '모두' 칸 = 보이는 값이 다 골라졌으면 체크, 일부면 반만(indeterminate).
  function syncColAll(){const el=colMenu.el;if(!el)return;const boxes=[...el.querySelectorAll('[data-flc="val"]')],all=el.querySelector('[data-flc="all"]'),n=boxes.filter(b=>b.checked).length;if(all){all.checked=boxes.length>0&&n===boxes.length;all.indeterminate=n>0&&n<boxes.length;}el.querySelector('[data-flc="clear"]').disabled=!Array.isArray(store.cols[colMenu.key])&&store.sort.col!==colMenu.key;el.querySelectorAll('[data-flc="sort"]').forEach(b=>b.setAttribute('aria-pressed',String(store.sort.col===colMenu.key&&store.sort.dir===b.dataset.dir)));}
  function paintColMenu(){const list=colMenu.el?.querySelector('.fl-colpop-list');if(!list)return;list.innerHTML=colListHtml(colMenu.key);syncColAll();api.attachScroll?.();}
  function openColMenu(key){
    closeRecPop();
    closeColMenu(false);if(!COLV[key])return;hideTip();colMenu.key=key;colMenu.q='';
    const label=colLabel(key),el=document.createElement('div');
    el.className='fl-colpop';el.setAttribute('role','dialog');el.setAttribute('aria-label',`${label} 정렬·필터`);
    el.innerHTML=`<div class="fl-colpop-sort" role="group" aria-label="정렬"><button type="button" data-flc="sort" data-dir="asc">오름차순 ▲</button><button type="button" data-flc="sort" data-dir="desc">내림차순 ▼</button></div><input type="search" class="fl-colpop-q" data-flc-q placeholder="${h(label)} 값 찾기" aria-label="${h(label)} 값 찾기" autocomplete="off"><div class="fl-colpop-list live-scroll" role="group" aria-label="${h(label)} 값"></div><div class="fl-colpop-foot"><button type="button" class="ax-text-link" data-flc="clear">이 열 초기화</button><button type="button" class="button" data-flc="close">닫기</button></div>`;
    document.body.append(el);colMenu.el=el;paintColMenu();placeColMenu();
    document.querySelector(`.fl-th[data-col="${CSS.escape(key)}"]`)?.setAttribute('aria-expanded','true');
    el.querySelector('[data-flc-q]').focus({preventScroll:true});
  }
  function closeColMenu(returnFocus=true){
    if(!colMenu.el)return;const key=colMenu.key;colMenu.el.remove();colMenu.el=null;colMenu.key='';
    const b=document.querySelector(`.fl-th[data-col="${CSS.escape(key)}"]`);b?.setAttribute('aria-expanded','false');if(returnFocus)b?.focus({preventScroll:true});
  }
  // 머리 칸 바로 아래(넘치면 위) · 화면 안. 표를 다시 그려 머리 칸이 바뀌어도 같은 열을 따라가고, 머리 칸이 화면 밖으로 나가면 닫는다.
  function placeColMenu(){
    const el=colMenu.el;if(!el)return;const a=document.querySelector(`.fl-th[data-col="${CSS.escape(colMenu.key)}"]`);
    if(!a){closeColMenu(false);return;}const r=a.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight){closeColMenu(false);return;}
    a.setAttribute('aria-expanded','true');
    const w=el.offsetWidth,hh=el.offsetHeight;let top=r.bottom+4;if(top+hh>innerHeight-8)top=Math.max(8,r.top-hh-4);
    el.style.left=`${Math.min(Math.max(8,r.left),innerWidth-w-8)}px`;el.style.top=`${top}px`;
  }
  // 값 선택 — 모두 선택하면 그 열 필터를 지운다(전부와 같다). 하나도 선택하지 않으면 맞는 일이 없다.
  function setColValues(key,values,on){
    const all=colValues(key).map(([v])=>v),sel=new Set(Array.isArray(store.cols[key])?store.cols[key]:all);
    values.forEach(v=>on?sel.add(v):sel.delete(v));
    if(all.every(v=>sel.has(v)))delete store.cols[key];else store.cols[key]=[...sel];
    store.pages.board=1;paintBoardList();syncColAll();
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest?.('.fl-colpop [data-flc]');if(!b||b.matches('input'))return;
    const key=colMenu.key,act=b.dataset.flc;
    if(act==='close'){closeColMenu();return;}
    if(act==='sort'){const same=store.sort.col===key&&store.sort.dir===b.dataset.dir;store.sort=same?{col:'',dir:''}:{col:key,dir:b.dataset.dir};store.pages.board=1;paintBoardList();syncColAll();return;}
    if(act==='clear'){delete store.cols[key];if(store.sort.col===key)store.sort={col:'',dir:''};colMenu.q='';const q=colMenu.el.querySelector('[data-flc-q]');if(q)q.value='';store.pages.board=1;paintBoardList();paintColMenu();}
  });
  document.addEventListener('change',event=>{
    const t=event.target;if(!t.closest?.('.fl-colpop'))return;const key=colMenu.key;
    if(t.dataset.flc==='val')setColValues(key,[t.value],t.checked);
    if(t.dataset.flc==='all'){const boxes=[...colMenu.el.querySelectorAll('[data-flc="val"]')];boxes.forEach(x=>{x.checked=t.checked;});setColValues(key,boxes.map(x=>x.value),t.checked);}
  });
  document.addEventListener('input',event=>{if(!event.target.matches?.('.fl-colpop [data-flc-q]'))return;colMenu.q=event.target.value;paintColMenu();});
  document.addEventListener('keydown',event=>{
    if(!colMenu.el||event.key!=='Escape'||!event.target.closest?.('.fl-colpop'))return;event.preventDefault();
    const q=event.target.matches('[data-flc-q]')&&event.target.value?event.target:null;if(q){q.value='';colMenu.q='';paintColMenu();return;}closeColMenu();
  });
  document.addEventListener('pointerdown',event=>{if(colMenu.el&&!colMenu.el.contains(event.target)&&!event.target.closest?.('.fl-th'))closeColMenu(false);},true);
  addEventListener('resize',()=>requestAnimationFrame(placeColMenu));
  addEventListener('scroll',event=>{if(colMenu.el&&!colMenu.el.contains(event.target))requestAnimationFrame(placeColMenu);},{passive:true,capture:true});

  /* ---------- 잘린 글 보기(원장 10-28 "마우스 올리면 짤린거 볼 수 있게") ---------- */
  // 표 칸의 .fl-cut이 넘쳐 잘렸으면 마우스·키보드 초점이 왔을 때 전부를 띄운다. data-hint(상태 표시의 뜻)는 잘리지 않아도 띄운다.
  // 브라우저 기본 툴팁(title)은 쓰지 않는다. 클릭·스크롤을 막지 않고(pointer-events:none) 화면 안에 둔다.
  // 가운데 창(dialog)은 맨 위층(top layer)이라 z-index로는 못 넘는다 — 팁도 popover로 맨 위층에 올리고, 띄울 때마다 다시 올려 가장 나중에 연 창보다 위에 둔다.
  let tipEl=null,tipFor=null;
  function showTip(el){
    const cut=el.scrollWidth>el.clientWidth+1,text=el.dataset.hint||(cut?el.dataset.full||el.textContent.trim():'');
    if(!text){hideTip();return;}
    if(!tipEl){tipEl=document.createElement('div');tipEl.className='fl-tip';tipEl.id='fl-tip';tipEl.setAttribute('role','tooltip');if(tipEl.showPopover)tipEl.popover='manual';document.body.append(tipEl);}
    if(tipFor&&tipFor!==el)tipFor.removeAttribute('aria-describedby');
    tipEl.textContent=text;if(tipEl.showPopover){if(tipEl.matches(':popover-open'))tipEl.hidePopover();tipEl.showPopover();}else tipEl.hidden=false;tipFor=el;el.setAttribute('aria-describedby','fl-tip');
    const r=el.getBoundingClientRect(),w=tipEl.offsetWidth,hh=tipEl.offsetHeight;let top=r.bottom+6;if(top+hh>innerHeight-8)top=Math.max(8,r.top-hh-6);
    tipEl.style.left=`${Math.min(Math.max(8,r.left),innerWidth-w-8)}px`;tipEl.style.top=`${top}px`;
  }
  function hideTip(){tipFor?.removeAttribute('aria-describedby');tipFor=null;if(!tipEl)return;if(tipEl.showPopover){if(tipEl.matches(':popover-open'))tipEl.hidePopover();}else tipEl.hidden=true;}
  const cutOf=t=>t?.closest?.(':is(.fl-table,.fl-rectable,.fl-nav) .fl-cut');
  document.addEventListener('pointerover',event=>{const el=cutOf(event.target);if(el===tipFor)return;if(el)showTip(el);else if(tipFor)hideTip();});
  document.addEventListener('focusin',event=>{const el=cutOf(event.target);if(el)showTip(el);else if(tipFor)hideTip();});
  document.addEventListener('pointerdown',()=>{if(tipFor)hideTip();},true);
  addEventListener('scroll',()=>{if(tipFor)hideTip();},{passive:true,capture:true});

  // '확인'은 누르는 즉시 저장된다 — 6초 동안 알림에 '되돌리기'를 단다(검수 10-28 H4: 잘못 누르면 되돌릴 길이 없었다).
  let undoTimer=0;
  function undoToast(text,undo){
    const node=document.getElementById('toast');if(!node){toast(text);return;}
    const hide=()=>{clearTimeout(undoTimer);node.classList.remove('show','has-action');};
    clearTimeout(undoTimer);node.innerHTML=`<span>${h(text)}</span><button type="button" class="fl-undo">되돌리기</button>`;node.classList.add('show','has-action');
    node.querySelector('.fl-undo').addEventListener('click',()=>{hide();undo();},{once:true});
    undoTimer=setTimeout(hide,6000);
  }

  /* ---------- 선택한 업무 한꺼번에(원장 10-28 "토글로 전체 선택같은거 해서 한번에 담당바꾸기 처리도 가능하게") ---------- */
  // 제목 줄 가운데 막대: 선택한 수 · (이 조건의 일을 다 선택) · 담당자 변경 · 선택 해제. 체크를 바꿀 때는 표를 다시 그리지 않고 막대와 머리 칸만 맞춘다.
  function bulkHtml(){
    const n=store.sel.size,pickable=board.items.filter(canPick).length;
    return `<strong>${fmt(n)}건 선택</strong>${pickable>n?`<button type="button" class="ax-text-link" data-fl="bulk-all">이 조건의 업무 ${fmt(pickable)}건 모두 선택</button>`:''}<button type="button" class="button primary" data-fl="bulk-reassign">담당자 일괄 변경</button><button type="button" class="button" data-fl="bulk-clear">선택 해제</button>`;
  }
  function syncBulk(){
    const bar=document.getElementById('fl-bulk');if(bar){bar.hidden=!store.sel.size;bar.innerHTML=bulkHtml();}
    const page=document.querySelector('#fl-board-list [data-fl-pick-page]');if(!page)return;
    const boxes=[...document.querySelectorAll('#fl-board-list [data-fl-pick]')],n=boxes.filter(b=>b.checked).length;
    page.disabled=!boxes.length;page.checked=boxes.length>0&&n===boxes.length;page.indeterminate=n>0&&n<boxes.length;
  }
  document.addEventListener('change',event=>{
    const t=event.target;
    if(t.matches?.('[data-fl-pick]')){if(t.checked)store.sel.add(t.dataset.flPick);else store.sel.delete(t.dataset.flPick);syncBulk();return;}
    if(t.matches?.('[data-fl-pick-page]')){document.querySelectorAll('#fl-board-list [data-fl-pick]').forEach(b=>{b.checked=t.checked;if(t.checked)store.sel.add(b.dataset.flPick);else store.sel.delete(b.dataset.flPick);});syncBulk();}
  });
  // 담당자 일괄 변경 — 업무마다 담당이 빈 단계(없으면 지금 단계)를 선택한 사람에게. 한 건씩 차례로 보내고(서버가 건마다 검사) 끝에 한 번 그린다.
  function openBulkReassign(){
    const list=[...store.sel].map(caseById).filter(c=>c&&canPick(c));if(!list.length){toast('담당자를 변경할 업무를 선택해 주세요.');return;}
    dialog('modal','담당자 일괄 변경',`${fmt(list.length)}건 · ${kindGroups(list).map(k=>`${k.label} ${fmt(k.items.length)}`).join(' · ')}`,`<form class="ws-form" data-fl-form="bulk-reassign" novalidate>${pickerHtml([])}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">변경 내역은 각 업무 이력에 기록됩니다.</span><button class="button primary" type="submit">담당 저장</button></div></form>`);
    $('#modal form :is(input:not([type=hidden]),button.cpick-trigger)')?.focus();
  }
  const bulkTarget=c=>{const open=activeSteps(c);return open.find(x=>!(x.assigneeIds||[]).length)||myStep(c)||open[0]||null;};
  async function bulkReassign(form,ids){
    const list=[...store.sel].map(caseById).filter(c=>c&&canPick(c)),note=form.querySelector('.ax-form-error'),btn=form.querySelector('[type=submit]');
    btn.disabled=true;let ok=0,bad=0;
    for(const c of list){const s=bulkTarget(caseById(c.id)||c);if(note)note.textContent=`${fmt(ok+bad+1)} / ${fmt(list.length)}건 바꾸는 중`;if(!s){bad++;continue;}const r=await command('case.reassign',{caseId:c.id,payload:{stepId:s.id,assigneeIds:ids},quiet:true});if(r)ok++;else bad++;}
    store.sel.clear();paint();form.closest('dialog')?.close();
    toast(bad?`${fmt(ok)}건의 담당을 변경했습니다. ${fmt(bad)}건은 변경하지 못했습니다.`:`${fmt(ok)}건의 담당을 변경했습니다.`);
  }

  /* ---------- 관련 기록 목록(원장 10-28 "[기록보기] 라벨로 바꾸고 마우스 올리면 리스트 깔끔하게 정리해서 보여주는것도 · 혹은 눌렀을때도 오버레이로 깔끔하게") ---------- */
  // 종류마다 표 하나 — 이름 · 그 종류가 가진 칸(원장 10-28 "원생이면 원생에게서 알아야할 정보들이 있잖아" · "항상 열정렬하는거 잊지마").
  // 기록 정보 = [칸 이름, 값] 목록이라 같은 종류는 같은 열에 같은 정보가 온다(값이 없으면 빈칸 — 다음 값을 당기지 않는다).
  // 원생은 스냅숏에서 바로(학교·학년 · 상태 · 반 · 이번 달 결석 · 이번 달 미납 — 원생 상세와 같은 값), 그 밖의 기록은 그 업무 영역의
  // 기록 한 건(GET …/records?id=, 읽기만)의 내용 · 상태 · 날짜 · 칸. 한 번 읽은 기록은 다시 읽지 않는다. 줄을 누르면 그 기록을 엿보기 창에 연다.
  const STUDENT_STATE={enrolled:'재원',withdrawn:'퇴원',paused:'휴원',on_hold:'휴원',leave:'휴원',pending:'등록 예정',waiting:'대기'};
  const schoolGrade=(school,grade)=>{const s=String(school||''),g=String(grade||''),m=/^([초중고])(\d)$/.exec(g);return m&&s.endsWith(m[1])?`${s}${m[2]}`:[s,g].filter(Boolean).join(' ');};
  const DETAIL_LABEL={enrollment:'학년·학교',students:'학교·학년',billing:'청구월','textbook-requests':'요청'},DATE_LABEL={approvals:'기안일'};
  // 열 순서를 정해 둔 종류 — 그 기록을 알아보는 칸이 이름 바로 뒤에 온다(정하지 않은 칸은 기록이 내는 순서로 뒤에).
  const FACT_ORDER={approvals:['종류','기간','일수','금액','지출일','수입일','분류','상태','결재 차례','결재선','기안','기안일','사유']};
  const ordered=(fam,list)=>{const o=FACT_ORDER[fam];if(!o)return list;const at=k=>{const i=o.indexOf(k);return i<0?o.length:i;};return list.map((x,i)=>[x,i]).sort((a,b)=>at(a[0][0])-at(b[0][0])||a[1]-b[1]).map(([x])=>x);};
  let studentIndex=null,classIndex=null;
  function studentFacts(id){
    studentIndex??=new Map((db.students||[]).map(s=>[String(s.id),s]));classIndex??=new Map((db.classes||[]).map(k=>[String(k.id),k]));
    const s=studentIndex.get(String(id));if(!s)return null;const cls=(s.classes||[]).map(k=>classIndex.get(String(k))).filter(Boolean),a=s.attendance||{};
    return [['학교·학년',schoolGrade(s.school,s.grade)],['상태',STUDENT_STATE[s.status]||''],['반',cls.length?`${cls.slice(0,2).map(k=>k.name).join(', ')}${cls.length>2?` 외 ${fmt(cls.length-2)}`:''}`:''],['이번 달 결석',a.absent?`${fmt(a.absent)}회`:''],['이번 달 미납',s.remaining>0?`${fmt(s.remaining)}원`:'']];
  }
  // 이름 칸은 새로 읽은 기록의 이름 — 업무에 실린 이름은 그 일이 생길 때 적은 것이라 옛 이름일 수 있다(휴가 결재 = 신청자).
  const recCache=new Map(),recName=new Map(),recItem=new Map();
  // 칸 이름은 영역이 알려 준 것(detailLabel·dateLabel — 반·수업일 · 청구월·납부 기한 …)을 먼저 쓴다.
  const famMeta=fam=>db.workspaces?.families?.[fam]||{};
  function recordFacts(r){
    const fam=r.familyId||'',id=String(r.recordId||r.id||''),key=`${fam}:${id}`;
    const cacheKey=`${key}:${r.teacherName||''}`;
    if(recCache.has(cacheKey))return recCache.get(cacheKey);
    const known=r.type==='student'?studentFacts(id):null;
    const clean=v=>{const x=String(v??'').trim();return x==='—'?'':/^\d{4}-\d{2}-\d{2}$/.test(x)?md(x):x;};
    const factsOf=it=>{if(!it)return r.detail?[['내용',String(r.detail)]]:[];if(it.label)recName.set(key,String(it.label));const label=String(it.label||r.label||''),detail=clean(it.detail);return ordered(fam,[[famMeta(fam).detailLabel||DETAIL_LABEL[fam]||'내용',detail&&!label.includes(detail)?detail:''],['상태',clean(it.status)],[famMeta(fam).dateLabel||DATE_LABEL[fam]||'날짜',it.date?md(String(it.date).slice(0,10)):''],...(r.teacherName?[['담당 선생님',clean(r.teacherName)]]:[]),...(it.fields||[]).filter(f=>f&&f.label).map(f=>[fam==='attendance'&&f.label==='메모'?'사유':String(f.label),clean(f.value)])]);};
    const p=known?Promise.resolve(known):!fam||!id?Promise.resolve([]):recItem.has(key)?Promise.resolve(factsOf(recItem.get(key))):fetch(`/api/workspaces/${encodeURIComponent(fam)}/records?id=${encodeURIComponent(id)}`,{headers:{Accept:'application/json'}}).then(res=>res.ok?res.json():null).then(b=>factsOf(b?.item)).catch(()=>{recCache.delete(cacheKey);return null;});
    recCache.set(cacheKey,p);return p;
  }
  // 아직 안 읽은 기록은 영역마다 한 번에 읽는다(GET …/records?ids=, 100건씩) — 기록마다 요청 하나씩 나가던 것(검수 10-28 M13).
  // 묶음 조회가 실패하면 그 기록들은 한 건씩 읽는 길로 돌아간다.
  function prefetch(refs){
    const by=new Map();
    for(const r of refs){if(r.type==='student')continue;const fam=r.familyId||'',id=String(r.recordId||r.id||''),key=`${fam}:${id}`;if(!fam||!id||recCache.has(key)||recItem.has(key))continue;if(!by.has(fam))by.set(fam,[]);if(!by.get(fam).includes(id))by.get(fam).push(id);}
    const jobs=[];
    for(const [fam,ids] of by)for(let i=0;i<ids.length;i+=100){const part=ids.slice(i,i+100);jobs.push(fetch(`/api/workspaces/${encodeURIComponent(fam)}/records?ids=${part.map(encodeURIComponent).join(',')}`,{headers:{Accept:'application/json'}}).then(res=>res.ok?res.json():null).then(b=>{if(!b||!Array.isArray(b.items))return;const got=new Map(b.items.map(it=>[String(it.id),it]));for(const id of part)recItem.set(`${fam}:${id}`,got.get(id)||null);}).catch(()=>{}));}
    return Promise.all(jobs);
  }
  const recType=r=>r.type==='student'?'원생':r.type==='lead'?'신규 상담':api.familyLabel?.(r.familyId)||'기록';
  const refKey=r=>`${r.familyId||''}:${String(r.recordId||r.id||'')}`;
  // 집계 신호의 각 근거가 가리키는 2.0 기록 주소. probe는 영역 화면이 ID 열쇠를 받기 전까지 작업 공간 기록으로 돌아간다.
  const RECORD_ROUTE={
    withdrawal_report:{screen:'withdrawal-reports',key:'actor',query:id=>({v2path:`/withdrawal-reports/${id}`})},
    approval:{screen:'approvals',key:'actor',query:id=>({v2path:`/approvals/${id}`})},
    lead:{screen:'enrollment',key:'actor',query:id=>({v2path:`/enrollment/${id}`})},
    consultation:{screen:'consultations',key:'actor',query:id=>({v2path:`/consultations/${id}`})},
    invoice:{screen:'billing',key:'viewer',query:id=>({invoice:id}),probe:true},
    satisfaction:{screen:'class-review',key:'actor',query:id=>({judgment:id}),probe:true},
    textbook_order:{screen:'textbook-requests',key:'viewer',query:id=>({orderId:id}),probe:true},
    report:{screen:'lesson-reports',key:'viewer',query:id=>({reportId:id}),probe:true},
    notice:{screen:'onescreen',key:'teacher',query:id=>({noticeId:id}),probe:true},
    video:{screen:'video-homework',key:'actor',query:id=>({videoId:id}),probe:true},
    attendance:{screen:'attendance',key:'viewer',query:id=>({v2path:'/attendance/live',tab:'desk',attendanceId:id}),probe:true},
  };
  // 종류별 묶음 자리 — 정보가 다 모이면 그 묶음을 표로 바꿔 그린다(fillFacts).
  function recRows(refs){
    const groups=new Map();for(const r of refs){const t=recType(r);if(!groups.has(t))groups.set(t,[]);groups.get(t).push(r);}
    return [...groups].map(([t,list],i)=>`<section class="fl-recgroup" data-rec-group="${i}"><p class="fl-recgroup-head">${h(t)} ${fmt(list.length)}건</p><div class="fl-recgroup-body"><p class="fl-dim">불러오는 중</p></div></section>`).join('');
  }
  function recTable(list,facts,c){
    // 열 = 그 묶음에서 값이 하나라도 있는 칸. 순서는 기록이 칸을 내는 순서 — 새 칸은 그 줄에서 바로 앞 칸 뒤에 끼운다(첫 줄에 없는 칸이 맨 뒤로 밀리지 않게).
    const cols=[];facts.forEach(f=>{const ks=(f||[]).filter(([,v])=>v).map(([k])=>k);ks.forEach((k,j)=>{if(cols.includes(k))return;let at=0;for(let p=j-1;p>=0;p--){const i=cols.indexOf(ks[p]);if(i>=0){at=i+1;break;}}cols.splice(at,0,k);});});
    // 열 정렬은 값으로 정한다(원장 10-28 "내용에 따라 제목행은 가운데 정렬 왼쪽 정렬 등 적극적으로 활용해서 깔끔하게"):
    // 금액은 오른쪽, 짧은 값(상태·날짜·일수·이름 하나)은 가운데, 긴 글은 왼쪽 — 제목도 같은 쪽.
    const align=cols.map(k=>{const vs=facts.map(f=>new Map(f||[]).get(k)).filter(Boolean).map(String);if(!vs.length)return '';if(vs.every(v=>/^-?[\d,]+원$/.test(v)))return 'al-r';return Math.max(...vs.map(v=>v.length))<=8?'al-c':'';});
    const cls=i=>align[i]?` class="${align[i]}"`:'';
    const cell=(v,i)=>`<td${cls(i)}><span class="fl-cut">${h(v||'')}</span></td>`;
    return `<table class="fl-rectable"><thead><tr><th scope="col">이름</th>${cols.map((k,i)=>`<th scope="col"${cls(i)}>${h(k)}</th>`).join('')}<th scope="col">처리</th></tr></thead><tbody>${list.map((r,i)=>{const fam=r.familyId||'',id=String(r.recordId||r.id||''),can=fam&&api.hasView(`workspace-${fam}`)||api.canOpenRecord?.(id),process=!!c?.signalId&&fam===c.familyId&&r.type!=='task'&&r.type!=='student',f=new Map(facts[i]||[]),at=`data-family="${h(fam)}" data-record="${h(id)}"`,name=recName.get(`${fam}:${id}`)||refLabel(r);
      return `<tr ${can?`class="can" data-fl="rec-open" ${at}`:''}><th scope="row">${can?`<button type="button" class="fl-cut" data-fl="rec-open" ${at}>${h(name)}</button>`:`<span class="fl-cut">${h(name)}</span>`}</th>${facts[i]===null?`<td colspan="${cols.length||1}" class="fl-dim">정보를 읽지 못했습니다.</td>`:cols.map((k,i)=>cell(f.get(k),i)).join('')}<td class="fl-rec-go">${process?`<button type="button" class="fl-rec-process" data-fl="rec-process" data-case="${h(c.id)}" data-type="${h(r.type)}" aria-label="${h(name)} 처리" ${at}>처리</button>`:can?icon('chevron'):''}</td></tr>`;}).join('')}</tbody></table>`;
  }
  function fillFacts(root,refs,c){
    const groups=new Map();for(const r of refs){const t=recType(r);if(!groups.has(t))groups.set(t,[]);groups.get(t).push(r);}
    const ready=prefetch(refs);
    [...groups].forEach(([,list],i)=>ready.then(()=>Promise.all(list.map(recordFacts))).then(facts=>{const box=root.querySelector(`[data-rec-group="${i}"] .fl-recgroup-body`);if(box?.isConnected){box.innerHTML=recTable(list,facts,c);if(recPop.el===root)placeRecPop();}}));
  }
  // 마우스를 올리면(잠깐 머문 뒤) 단추 아래 목록 · 목록 위로 옮겨 가도 그대로 · 둘 다 벗어나면 닫는다. 누르면 같은 목록을 가운데 창으로.
  const recPop={el:null,btn:null,show:0,hide:0,hiding:false};
  function closeRecPop(){clearTimeout(recPop.show);clearTimeout(recPop.hide);recPop.hiding=false;recPop.el?.remove();recPop.el=null;recPop.btn=null;}
  const keepRecPop=()=>{clearTimeout(recPop.hide);recPop.hiding=false;};
  function openRecPop(btn){
    const c=caseById(btn.dataset.id);if(!c)return;const refs=refsOf(c);if(!refs.length)return;
    closeRecPop();hideTip();const el=document.createElement('div');el.className='fl-recpop';el.setAttribute('role','dialog');el.setAttribute('aria-label',`${c.title} — 관련 기록`);
    el.innerHTML=`<div class="fl-recpop-body live-scroll">${c.signalId&&c.entityTotal>refs.length?`<p class="fl-dim">처음 ${fmt(refs.length)}건 · 기록 보기를 누르면 전체 ${fmt(c.entityTotal)}건을 쪽별로 볼 수 있습니다.</p>`:''}${recRows(refs)}</div>`;
    document.body.append(el);recPop.el=el;recPop.btn=btn;placeRecPop();fillFacts(el,refs,c);api.attachScroll?.();
  }
  // 단추 아래(넘치면 위) · 화면 안. 표가 채워져 크기가 바뀌면 다시 잡는다.
  function placeRecPop(){
    const el=recPop.el,btn=recPop.btn;if(!el||!btn?.isConnected)return;
    const r=btn.getBoundingClientRect(),w=el.offsetWidth,hh=el.offsetHeight;let top=r.bottom+4;if(top+hh>innerHeight-8)top=Math.max(8,r.top-hh-4);
    el.style.left=`${Math.min(Math.max(8,r.right-w),innerWidth-w-8)}px`;el.style.top=`${top}px`;
  }
  let recPageAsk=0;
  async function showRecordsPage(id,page){
    const c=caseById(id),ask=++recPageAsk,m=$('#modal'),box=m?.querySelector(`.fl-recs-modal[data-case="${CSS.escape(id)}"]`);if(!c||!box)return;
    box.innerHTML='<p class="fl-dim" role="status">기록을 불러오는 중입니다.</p>';
    try{
      const response=await fetch(`/api/flow/records?caseId=${encodeURIComponent(id)}&page=${page}`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('records');const data=await response.json();
      if(ask!==recPageAsk||!box.isConnected||!m.open||!caseById(id))return;
      const refs=data.refs||[],pager=`<nav class="fl-pager" aria-label="관련 기록 쪽"><button type="button" class="button small" data-fl="rec-page" data-id="${h(id)}" data-page="${data.page-1}" ${data.page<=1?'disabled':''}>이전</button><span>${fmt(data.page)} / ${fmt(data.pages)}쪽 · 전체 ${fmt(data.total)}건</span><button type="button" class="button small" data-fl="rec-page" data-id="${h(id)}" data-page="${data.page+1}" ${data.page>=data.pages?'disabled':''}>다음</button></nav>`;
      box.innerHTML=`${pager}${recRows(refs)}${pager}`;fillFacts(box,refs,c);api.attachScroll?.();
    }catch{if(ask===recPageAsk&&box.isConnected&&m.open)box.innerHTML=`<p class="fl-dim">기록을 불러오지 못했습니다.</p><button type="button" class="button small" data-fl="rec-page" data-id="${h(id)}" data-page="${page}">다시 읽기</button>`;}
  }
  function showRecords(id){const c=caseById(id);if(!c)return;const refs=refsOf(c);closeRecPop();dialog('modal',c.title,'',`<div class="fl-recs-modal" data-case="${h(id)}">${c.signalId&&c.entityTotal>refs.length?'<p class="fl-dim">기록을 불러오는 중입니다.</p>':recRows(refs)}</div>`);const m=$('#modal');if(c.signalId&&c.entityTotal>refs.length)showRecordsPage(id,1);else if(m)fillFacts(m,refs,c);}
  document.addEventListener('pointerover',event=>{
    const b=event.target.closest?.('.fl-recbtn');
    if(b){if(recPop.btn===b){keepRecPop();return;}clearTimeout(recPop.show);recPop.show=setTimeout(()=>{if(b.isConnected&&b.matches(':hover'))openRecPop(b);},220);return;}
    if(!recPop.el)return;if(recPop.el.contains(event.target)){keepRecPop();return;}
    if(!recPop.hiding){recPop.hiding=true;recPop.hide=setTimeout(closeRecPop,250);}
  });
  document.addEventListener('pointerout',event=>{if(event.target.closest?.('.fl-recbtn')&&!event.relatedTarget?.closest?.('.fl-recbtn'))clearTimeout(recPop.show);});
  addEventListener('scroll',event=>{if(recPop.el&&!recPop.el.contains(event.target))closeRecPop();},{passive:true,capture:true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&recPop.el){closeRecPop();}});

  /* ---------- 엿보기 창(원장 10-28 "페이지 이동하지말고 내부에 오버레이창으로 바로 처리할 수 있게 … 노션처럼?") ---------- */
  // 처리 화면(전자결재·신규 콜&상담·출석부 …)과 관련 기록을 이 화면 위 오른쪽 창에 연다. 창 안은 같은 앱을 엿보기 모드(?peek=1)로
  // 띄운 것이라 그 화면의 버튼·저장이 본래 화면과 똑같이 돈다(같은 문서에 그리면 그 화면의 동작이 바깥 화면을 다시 그린다).
  // 창은 처음 열 때 만들고 닫아도 남겨 둔다 — 다음부터는 화면만 바꿔 바로 열린다.
  // 닫으면 업무 흐름을 다시 읽는다(창 안에서 처리한 일이 표에 반영되게). Esc · 창 밖 누르기 · 바깥 화면 이동으로 닫힌다.
  const PEEK_MSG='aywa-peek';
  const peek={dlg:null,frame:null,ready:false,want:null,spec:null,page:'',opener:null,timer:0};
  // 지금 문서 안에서 그 화면으로(엿보기 창 안 · '전체 화면으로 열기'). 기록이 있으면 그 화면이 그려진 뒤 기록을 연다.
  function moveTo(spec){
    if(spec.family){
      const page=`workspace-${spec.family}`,show=()=>{if(spec.record)api.showWorkspaceRecord?.(spec.family,spec.record);};
      if(location.hash===`#${page}`){api.openWorkspace?.(spec.family,spec.facet||'');show();}else{addEventListener('hashchange',show,{once:true});api.openWorkspace?.(spec.family,spec.facet||'');}
      return;
    }
    navigate(spec.page);
  }
  function peekBox(){
    if(peek.dlg)return peek.dlg;
    const d=document.createElement('dialog');d.className='fl-peek';d.setAttribute('aria-label','처리 화면');
    d.innerHTML=`<div class="fl-peek-panel"><div class="fl-peek-bar"><button type="button" class="button" data-peek="full">전체 화면으로 열기</button><button type="button" class="icon-button" data-peek="close" aria-label="닫기">${icon('close')}</button></div><div class="fl-peek-body"><iframe class="fl-peek-frame" title="처리 화면" src="/?peek=1#peek"></iframe><p class="fl-peek-wait" role="status">화면을 여는 중입니다.</p></div></div>`;
    document.body.append(d);peek.dlg=d;peek.frame=d.querySelector('iframe');
    d.addEventListener('click',event=>{if(event.target===d){d.close();return;}const b=event.target.closest('[data-peek]');if(!b)return;if(b.dataset.peek==='close')d.close();else peekFull();});
    d.addEventListener('close',()=>{clearTimeout(peek.timer);if(ready())load({quiet:true});const o=peek.opener;peek.opener=null;if(o?.isConnected)o.focus({preventScroll:true});});
    return d;
  }
  function sendPeek(){const spec=peek.want;peek.want=null;if(spec)peek.frame.contentWindow.postMessage({type:PEEK_MSG,open:spec},location.origin);}
  function peekShown(){clearTimeout(peek.timer);peek.dlg?.classList.remove('is-switching');}
  // 처리 화면(2.0 화면)이 있는 영역 — 업무가 가리키는 기록 하나를 그 화면에서 바로 연다(원장 10-28 "근거보기 들어가도 뭘 처리할 수가 없음").
  // 기록이 여럿이면 그 화면의 목록으로. 주소 형식은 각 화면 세션이 알려 준 것(v2-screen-<id>.js 머리 주석).
  // record = 기록 하나일 때의 주소 열쇠 · list = 여럿일 때(퇴원보고서 '진행 중' 전부 — 승인 대기만 거르는 값은 2.0에 없다 · 전자결재 '결재 대기' 탭).
  // 영상 제출 현황은 기록 하나를 여는 주소가 없다 — 업무 종류에 맞는 상태(미배정 영상 = 배정 필요 · 그 밖 = 미수행)와, 원생이 한 명이면 그 이름 찾기로.
  // 선생님이 처리할 차례면 강사 화면(내가 낸 숙제 — 2.0 /onescreen/video-homework)으로.
  const oneStudent=c=>{const s=refsOf(c).filter(r=>r.familyId==='students'&&r.label);return s.length===1?{q:String(s[0].label).split(' · ')[0]}:{};};
  // screen = 영역과 다른 2.0 화면으로 열 때 · use = 그 길을 탈 업무만(아니면 영역 기본 길) — 진도 기록 이상은 원생 한 명이면 원생 상세 진도 탭으로.
  const studentIdOf=c=>{const s=refsOf(c).filter(r=>r.familyId==='students'&&r.recordId);return s.length===1?String(s[0].recordId):'';};
  const V2_ROUTE={'withdrawal-reports':{record:id=>({v2path:`/withdrawal-reports/${id}`}),list:{status:'pending'}},approvals:{record:id=>({v2path:`/approvals/${id}`}),list:{tab:'waiting'}},
    'video-homework':{list:c=>({status:c.taskKind==='video_unassigned'?'assign':'missing',...oneStudent(c),...(actorById(v2Actor(c))?.role==='teacher'?{view:'mine'}:{})})},
    'class-sheets':{screen:'students',use:c=>c.taskKind==='progress_anomaly'&&!!studentIdOf(c),list:c=>({v2path:`/students/${studentIdOf(c)}`,tab:'progress'})},
    // 결석 확인 전화 = 그날 오늘 출결의 '확인 필요' 탭(2.0 주소에 원생 하나를 짚는 열쇠가 없다 — 그 원생 줄은 목록에 뜬다) · 업무는 결석을 적은 날 생긴다.
    attendance:{use:c=>c.taskKind==='attendance_absent_desk'&&!!c.createdAt,list:c=>({v2path:'/attendance/live',tab:'desk',date:kstDate(c.createdAt)})},
    // 콜&상담 후속 조치 = 그 상담 상세(여럿이면 칸반).
    enrollment:{record:id=>({v2path:`/enrollment/${id}`}),list:{}},
    // 원생상담 후속조치 = 그 상담 상세('완료 표시'가 처리 자리) · 여럿이면 기한 지난 후속 목록.
    consultations:{record:id=>({v2path:`/consultations/${id}`}),list:{urg:'overdue'}}};
  // 2.0 화면의 '보는 사람'(= 저장하는 사람, 주소 actor가 화면에서 선택한 사람보다 이긴다) — 지금 보는 사람이 그 단계 담당이면 그대로, 아니면 그 단계 담당(승인·결재 차례인 사람).
  // 화면에서 선택할 수 없는 사람이면 화면이 무시하고 제 규칙(원장 먼저)으로 돈다.
  const v2Actor=c=>{const me=actor()?.id,ids=activeSteps(c).flatMap(s=>s.assigneeIds||[]);return ids.includes(me)?me:ids[0]||me||'';};
  async function processRecord(c,family,type,id,opener){
    const fallback=()=>{if(api.hasView(`workspace-${family}`))openPeek({page:`workspace-${family}`,family,record:id},opener);else toast('이 기록을 처리할 화면을 찾지 못했습니다.');};
    const route=RECORD_ROUTE[type],target=route&&window.V2Screens?.target(route.screen);
    if(!route||!target){fallback();return;}
    const who=v2Actor(c),query=new URLSearchParams({...route.query(id),...(who?{[route.key]:who}:{})});
    if(route.probe){
      const accepted=await fetch(`/api/v2/${route.screen}?${query}`,{headers:{Accept:'application/json'}}).then(async r=>{await r.body?.cancel();return r.ok;}).catch(()=>false);
      if(!accepted){fallback();return;}
    }
    openPeek({page:`${target.slice(1)}?${query}`},opener);
  }
  function openPeek(spec,opener){
    if(!api.hasView(spec.page)){toast('처리할 화면을 찾지 못했습니다.');return;}
    if(PEEK){document.querySelectorAll('dialog[open]').forEach(d=>d.close());moveTo(spec);return;}
    hideTip();closeColMenu(false);
    const d=peekBox();peek.spec=spec;peek.want=spec;peek.opener=opener||document.activeElement;
    d.classList.add('is-switching');clearTimeout(peek.timer);peek.timer=setTimeout(peekShown,6000);
    if(!d.open)d.showModal();d.querySelector('[data-peek="close"]').focus({preventScroll:true});
    if(peek.ready)sendPeek();
  }
  function peekFull(){const spec=peek.spec,page=peek.page;peek.dlg.close();if(spec&&(!page||page===spec.page))moveTo(spec);else if(page)navigate(page);}
  let peekTicket=0;
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.data?.type!==PEEK_MSG)return;
    if(PEEK){
      if(event.source!==parent||!event.data.open)return;const spec=event.data.open;
      const show=()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());moveTo(spec);},missing=()=>parent.postMessage({type:PEEK_MSG,event:'missing'},location.origin);
      // 2.0 화면 스크립트는 /api/v2 목록을 받은 뒤에 붙는다 — 새 창이 그 전에 신호를 받으면 등록될 때까지 잠깐(10초) 기다린다.
      const ticket=++peekTicket; // 기다리는 사이 다른 업무를 누르면 앞의 기다림은 버린다
      if(!api.hasView(spec.page)){if(!/^v2-/.test(spec.page)){missing();return;}const t0=Date.now(),wait=()=>{if(ticket!==peekTicket)return;if(api.hasView(spec.page))show();else if(Date.now()-t0<10000)setTimeout(wait,200);else missing();};wait();return;}
      show();return;
    }
    if(!peek.frame||event.source!==peek.frame.contentWindow)return;
    const ev=event.data.event;
    if(ev==='ready'){peek.ready=true;sendPeek();}
    else if(ev==='page'){peek.page=String(event.data.page||'');peek.dlg?.setAttribute('aria-label',String(event.data.title||'처리 화면'));if(peek.page&&!peek.want){peekShown();if(peek.dlg?.open&&document.activeElement?.closest?.('.fl-peek-bar'))peek.frame.focus();}}
    else if(ev==='close')peek.dlg?.close();
    else if(ev==='missing'){peek.dlg?.close();toast('처리할 화면을 찾지 못했습니다.');}
  });
  // 엿보기 창 안: 그릴 때마다 바깥에 지금 화면을 알리고(첫 그림 = 준비됨), 열린 대화 창이 없을 때 Esc면 창을 닫게 한다.
  if(PEEK){
    const post=x=>parent.postMessage({type:PEEK_MSG,...x},location.origin);let first=true;
    addEventListener('aywa:render',event=>{if(first){first=false;post({event:'ready'});}post({event:'page',page:event.detail?.page||'',title:document.querySelector('#main h1')?.textContent.trim()||document.querySelector('#sidebar .nav-item.active')?.textContent.trim()||''});});
    addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]'))post({event:'close'});});
  }

  /* ---------- events ---------- */
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-fl]');if(!el||el.disabled)return;
    event.preventDefault();event.stopImmediatePropagation();
    const {fl:action,id}=el.dataset;
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='reload'){load();return;}
    if(action==='load-full'){ensureFull();return;}
    if(action==='attach-open'){api.showWorkspaceRecord?.(id,el.dataset.record);return;}
    // 처리 화면('전자결재' 등): 2.0 화면이 있으면 그 화면, 없으면 작업 공간을 신호의 걸러 보기로 — 이 화면 위 엿보기 창에 연다(원장 10-28).
    if(action==='goto'){const c=caseById(id);if(!c)return;const facet=(db.workspaces?.families?.[c.familyId]?.signals||[]).find(x=>x.id===c.signalId)?.facet||'',own=refsOf(c).filter(r=>r.familyId===c.familyId&&r.type!=='task'&&(r.recordId||r.id)),record=own.length===1?String(own[0].recordId||own[0].id):'',route=(r=>r&&(!r.use||r.use(c))?r:null)(V2_ROUTE[c.familyId]),v2=(route||!facet)&&window.V2Screens?.target(route?.screen||c.familyId);
      if(v2&&route){const who=v2Actor(c),q=new URLSearchParams({...(record&&route.record?route.record(record):typeof route.list==='function'?route.list(c):route.list),...(who?{actor:who}:{})});openPeek({page:`${v2.slice(1)}?${q}`},el);return;}
      openPeek(v2?{page:v2.slice(1)}:{page:`workspace-${c.familyId}`,family:c.familyId,facet,...(record?{record}:{})},el);return;}
    if(action==='older'){el.disabled=true;loadOlder(id);return;}
    if(action==='recs'){showRecords(id);return;}
    if(action==='bulk-all'){board.items.filter(canPick).forEach(c=>store.sel.add(c.id));paintBoardList();return;}
    if(action==='bulk-clear'){store.sel.clear();paintBoardList();return;}
    if(action==='bulk-reassign'){openBulkReassign();return;}
    // 관련 기록 한 줄 — 작업 공간이 있으면 엿보기 창에 그 기록, 없으면 이 화면의 기록 상세.
    if(action==='rec-open'){const {family,record}=el.dataset,recordCase=el.closest('.fl-recs-modal')?.dataset.case||(recPop.el?.contains(el)?recPop.btn?.dataset.id:null);closeRecPop();if(family==='students'&&record&&el.closest('#ax-issue-attendance')){api.showAbsences(record);return;}if(family==='attendance'&&record&&caseById(recordCase)?.signalId==='attendance-repeat-absence'){api.showAbsences(null,{attendanceId:record});return;}if(family&&api.hasView(`workspace-${family}`)){openPeek({page:`workspace-${family}`,family,record},el);return;}if(record&&api.canOpenRecord?.(record)){document.querySelectorAll('dialog[open]').forEach(d=>d.close());api.openRecord(record);}return;}
    if(action==='rec-process'){const {family,type,record}=el.dataset,c=caseById(el.dataset.case);if(!c||!family||!record)return;closeRecPop();processRecord(c,family,type,record,el);return;}
    if(action==='rec-page'){showRecordsPage(id,Number(el.dataset.page));return;}
    // 쪽 이동 — 표만 다시 그리고, 표 머리가 화면 위로 지나갔으면 표 처음으로 눈에 보이게 옮긴다.
    if(action==='page'){const key=el.dataset.pageList||'';store.pages[key]=Number(id)||1;if(key==='board')paintBoardList();else api.render();const top=document.querySelector(key==='board'?'#fl-board-list':`:is(.fl-list,.fl-tbody)[data-list="${CSS.escape(key)}"]`);if(top&&top.getBoundingClientRect().top<0)api.scrollToSection(top);document.querySelector(`.fl-pager [data-page-list="${CSS.escape(key)}"][aria-current="page"]`)?.focus({preventScroll:true});return;}
    if(action==='col'){const key=el.dataset.col;if(colMenu.key===key)closeColMenu();else openColMenu(key);return;}
    if(action==='col-clear'){const key=el.dataset.col;if(key)delete store.cols[key];else store.cols={};store.pages.board=1;paintBoardList();if(colMenu.el)paintColMenu();document.querySelector('[data-fl-search]')?.focus({preventScroll:true});return;}
    // From another page the jump waits for the home render (the hash change) and lands at once.
    if(action==='filter'){store.filter=id;store.pages.board=1;store.pages[id]=1;closeColMenu(false);const routed=api.getPage()!=='home'&&api.getPage()!=='flow',go=()=>requestAnimationFrame(()=>{api.scrollToSection('#fl-detail',{instant:routed});$('#fl-detail-title,#fl-detail h2')?.focus?.({preventScroll:true});});if(flow().summary){ensureFull().then(ok=>{if(ok&&['home','flow'].includes(api.getPage()))go();else if(!ok)toast('업무 목록을 불러오지 못했습니다. 다시 시도해 주세요.');});return;}if(routed&&location.hash!=='#home'){addEventListener('hashchange',go,{once:true});navigate('home');}else{if(routed)navigate('home');else api.render();go();}return;}
    if(action==='node'||action==='pick'){if(action==='pick'&&caseById(treeCase)?.signalId==='attendance-repeat-absence'){const student=trees.get(treeCase)?.index.get(el.dataset.node)?.entityRef?.id;if(student){api.showAbsences(student);return;}}toggleNode(el);return;}
    if(action==='tree-go'){treeGo(el.dataset.node);return;}
    if(action==='tree-reload'){const e=treeEntry(id);e.retry=0;if(!e.data)e.status='loading';paintTree(id);fetchTree(id);return;}
    if(action==='open'){showCase(id);return;}
    if(action==='attendance-open'){openAttendanceForm(id,el.dataset.step||'');return;}
    if(action==='unsent-open'){openUnsentForm(id,el.dataset.step||'');return;}
    if(action==='billing-open'){openForm('report',id,el.dataset.step||'');return;}
    if(action==='consultation-open'){openConsultationForm(id,el.dataset.step||'');return;}
    const stepId=el.dataset.step?{stepId:el.dataset.step}:{};
    if(action==='ack'){command('case.ack',{caseId:id,payload:stepId}).then(r=>{if(r)undoToast('확인했습니다. 진행 중으로 바뀌었습니다.',()=>command('case.unack',{caseId:id,payload:stepId}).then(x=>{if(x)toast('확인을 되돌렸습니다.');}));});return;}
    if(['report-open','review-open','reassign-open','reopen-open'].includes(action)){openForm(action.replace('-open',''),id,el.dataset.step||'',action==='report-open'?el.dataset.node||'':'');return;}
    if(action==='analyze'||action==='analyze-draft'){const box=el.closest('.fl-decision');box?.querySelectorAll('[data-fl^="analyze"]').forEach(b=>{b.disabled=true;});if(box&&!box.querySelector('.fl-wait'))box.insertAdjacentHTML('beforeend','<p class="ax-note fl-wait" role="status">판정을 기다리는 중입니다. 화면은 그대로 쓸 수 있습니다.</p>');command('case.analyze',{caseId:id,payload:action==='analyze-draft'?{draft:true}:{}}).then(r=>{if(r)toast(r.duplicate?'이미 판정 중입니다. 결과가 나오면 화면에 나타납니다.':r.decision==='pending'?'판정을 요청했습니다. 결과는 잠시 뒤 이 화면에 나타납니다.':'판정 결과를 기록했습니다.');reopenCase(id);});return;}
    if(action==='request'){ax.showRequest({source:'direct'});return;}
    // A tree link opens the copied record in place: the snapshot's own view, else the workspace's record view, which
    // reads a record off its list by exact id. The tree stays until that succeeds; the workspace says when it cannot
    // (not found, failed) and drops an answer that comes after the person moved on. Other links go to the workspace.
    if(action==='entity'){const {family,record}=el.dataset;if(record&&el.closest('.fl-tree')){if(family==='students'&&caseById(treeCase)?.signalId==='attendance-repeat-absence'){api.showAbsences(record);return;}if(api.canOpenRecord?.(record)){api.openRecord(record);return;}const p=family?api.showWorkspaceRecord?.(family,record):null;if(p&&typeof p.then==='function'){el.disabled=true;el.setAttribute('aria-busy','true');p.finally(()=>{el.disabled=false;el.removeAttribute('aria-busy');});return;}toast('이 기록은 여기서 바로 열 수 없습니다. 해당 작업 공간 목록에서 찾아 주세요.');return;}if(family&&api.hasView(`workspace-${family}`)){openPeek({page:`workspace-${family}`,family,record},el);return;}document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(record)api.openRecord?.(record);return;}
  },true);
  // After a command the open drawer of the same case refreshes in place (scroll, branches and focus kept).
  function reopenCase(id){if(!$('#detail[open]')||!caseById(id))return;if(treeShown(id))refreshDetail();else showCase(id);}
  async function submitAttendance(form,v,fail){
    const id=form.dataset.id,recordRef=String(v.get('recordRef')||''),stepId=form.dataset.step,actorId=actor()?.id;
    if(!recordRef){fail('처리할 결석 기록을 선택해 주세요.');return;}
    if(!actorId||!stepId){fail('담당자를 확인한 뒤 다시 시도해 주세요.');return;}
    if(form.dataset.busy)return;
    form.dataset.busy='1';const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
    const revision=async()=>fetch('/api/data-revision',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    try{
      const before=await revision();
      const body={caseId:id,stepId,recordRef,expectedRevision:flow().revision,actorId,
        state:String(v.get('state')||''),outcome:String(v.get('outcome')||'')||null,contactedVia:String(v.get('contactedVia')||'')||null,note:String(v.get('note')||'')};
      const response=await fetch('/api/flow/card-attendance/save',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>null);
      if(!response.ok){if(response.status===409)await load({quiet:true});fail(message(result,response.status));return;}
      if(result?.saved!==true){fail('저장 결과를 확인하지 못했습니다. 업무를 새로 불러와 주세요.');return;}
      form.closest('dialog')?.close();toast('원본 반영 확인 중');
      for(let i=0;i<16;i++){
        await new Promise(resolve=>setTimeout(resolve,750));
        const current=await revision();
        if(before&&current&&current.revision===before.revision)continue;
        await load({quiet:true});
        if(caseById(id)?.factClosed){toast('연락 결과가 원본에 반영되어 업무가 닫혔습니다.');return;}
        if(current&&before&&current.revision!==before.revision){toast('연락 결과를 기록했습니다. 남은 결석 기록을 확인해 주세요.');return;}
      }
      await load({quiet:true});
      toast(caseById(id)?.factClosed?'연락 결과가 원본에 반영되어 업무가 닫혔습니다.':'연락 결과를 저장했습니다. 원본 반영 상태를 새로 확인해 주세요.');
    }catch{fail('결석 처리 결과를 확인하지 못했습니다. 업무를 새로 불러와 주세요.');}
    finally{delete form.dataset.busy;if(button)button.disabled=false;}
  }
  async function submitUnsent(form,v,fail){
    const id=form.dataset.id,recordRef=String(v.get('recordRef')||''),actorId=actor()?.id;
    if(!recordRef||!actorId||!form.dataset.step){fail('수업보고서와 담당자를 확인해 주세요.');return;}
    if(form.dataset.busy)return;
    form.dataset.busy='1';const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
    const revision=async()=>fetch('/api/data-revision',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    try{
      const before=await revision();
      const body={caseId:id,stepId:form.dataset.step,recordRef,expectedRevision:flow().revision,actorId};
      const response=await fetch('/api/flow/card-report/send',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>null);
      if(!response.ok){if(response.status===409)await load({quiet:true});fail(message(result,response.status));return;}
      if(result?.saved!==true||!(result.queued>0)){fail(result?.message||'발송 요청을 대기에 올리지 못했습니다. 보고서 내용을 확인해 주세요.');return;}
      form.closest('dialog')?.close();toast('원본 반영 확인 중 — 연습 복사본이라 실제로 보내지지 않습니다.');
      for(let i=0;i<16;i++){
        await new Promise(resolve=>setTimeout(resolve,750));
        const current=await revision();
        if(before&&current&&current.revision===before.revision)continue;
        await load({quiet:true});
        if(caseById(id)?.factClosed){toast('발송 요청이 대기에 올라 업무가 닫혔습니다. 실제로 보내지지 않습니다.');return;}
      }
      await load({quiet:true});
      toast(caseById(id)?.factClosed?'발송 요청이 대기에 올라 업무가 닫혔습니다. 실제로 보내지지 않습니다.':'발송 요청을 저장했습니다. 원본 업무 상태를 새로 확인해 주세요.');
    }catch{fail('발송 요청 결과를 확인하지 못했습니다. 업무를 새로 불러와 주세요.');}
    finally{delete form.dataset.busy;if(button)button.disabled=false;}
  }
  async function submitConsultation(form,v,fail){
    const id=form.dataset.id,recordRef=String(v.get('recordRef')||''),actorId=actor()?.id;
    if(!recordRef||!actorId||!form.dataset.step){fail('상담 기록과 담당자를 확인해 주세요.');return;}
    if(form.dataset.busy)return;
    form.dataset.busy='1';const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
    const revision=async()=>fetch('/api/data-revision',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
    try{
      const before=await revision();
      const body={caseId:id,stepId:form.dataset.step,recordRef,expectedRevision:flow().revision,actorId};
      const response=await fetch('/api/flow/card-consultation/save',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
      const result=await response.json().catch(()=>null);
      if(!response.ok){if(response.status===409)await load({quiet:true});fail(message(result,response.status));return;}
      if(result?.saved!==true){fail('저장 결과를 확인하지 못했습니다. 업무를 새로 불러와 주세요.');return;}
      form.closest('dialog')?.close();toast('원본 반영 확인 중');
      for(let i=0;i<16;i++){
        await new Promise(resolve=>setTimeout(resolve,750));
        const current=await revision();
        if(before&&current&&current.revision===before.revision)continue;
        await load({quiet:true});
        const c=caseById(id);
        if(c?.factClosed||c?.state==='done'){toast('후속조치 완료가 원본에 반영되어 업무가 닫혔습니다.');return;}
        if(current&&before&&current.revision!==before.revision){toast('후속조치 완료를 기록했습니다. 남은 상담 기록을 확인해 주세요.');return;}
      }
      await load({quiet:true});
      const c=caseById(id);
      toast(c?.factClosed||c?.state==='done'?'후속조치 완료가 원본에 반영되어 업무가 닫혔습니다.':'후속조치를 저장했습니다. 원본 반영 상태를 새로 확인해 주세요.');
    }catch{fail('상담 후속조치 결과를 확인하지 못했습니다. 업무를 새로 불러와 주세요.');}
    finally{delete form.dataset.busy;if(button)button.disabled=false;}
  }
  // 업무 흐름 검색 — 목록과 건수만 다시 그린다(화면 전체를 다시 그리지 않아 글자 입력이 끊기지 않는다) · Esc = 지우기.
  const paintBoardList=()=>{const box=document.getElementById('fl-board-list'),cnt=document.getElementById('fl-board-count');if(!box||!ready())return;const p=boardParts();hideTip();box.innerHTML=p.listHtml;if(cnt)cnt.textContent=p.count;if(colMenu.el)placeColMenu();syncBulk();};
  document.addEventListener('input',event=>{if(!event.target.matches?.('[data-fl-search]'))return;store.q=event.target.value;store.pages.board=1;paintBoardList();});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!event.target.matches?.('[data-fl-search]')||!event.target.value)return;event.preventDefault();event.target.value='';store.q='';store.pages.board=1;paintBoardList();});
  document.addEventListener('input',event=>{const id=event.target.dataset?.flTreeQ;if(id===undefined)return;const e=trees.get(id);if(!e)return;e.query=event.target.value;e.unforce.clear();paintTree(id,{body:true});});
  document.addEventListener('change',event=>{if(event.target.dataset?.flActor!==undefined){store.actorId=event.target.matches?.('[data-cpick]')?(event.target.querySelector('input[type=hidden]')?.value||store.actorId):event.target.value;store.filter='';store.all='';try{localStorage.setItem(ACTOR_KEY,store.actorId);}catch{/* keep in memory only */}api.closeMenu?.(false);if(api.getPage()==='home')api.render();else navigate('home');}});
  document.addEventListener('submit',event=>{
    const form=event.target,kind=form.dataset.flForm;if(!kind)return;event.preventDefault();event.stopImmediatePropagation();
    const v=new FormData(form),error=form.querySelector('.ax-form-error'),id=form.dataset.id,fail=m=>{if(error)error.textContent=m;};
    const done=(r,msg)=>{if(!r)return;form.closest('dialog')?.close();toast(msg);if(id)reopenCase(id);};
    const step=form.dataset.step?{stepId:form.dataset.step}:{};
    if(kind==='attendance-card'){submitAttendance(form,v,fail);return;}
    if(kind==='unsent-card'){submitUnsent(form,v,fail);return;}
    if(kind==='consultation-card'){submitConsultation(form,v,fail);return;}
    if(kind==='simulate'){const record=String(v.get('record')||''),scenario=form.dataset.scenario;command('event.simulate',{payload:{scenario,...(record?{recordRef:record}:{})},key:`event.simulate:${scenario}`}).then(r=>{if(!r)return;if(r.duplicate){toast('같은 기록으로 만든 시나리오가 아직 끝나지 않아 그 업무를 보여 드립니다. 새 업무는 만들지 않았습니다.');if(r.caseId)showCase(r.caseId);return;}toast(`연습 시나리오를 시작했습니다. 담당자의 업무에 생겼습니다.${r.decision==='pending'?' 판정 결과는 잠시 뒤 나타납니다.':''}`);});return;}
    if(kind==='report'){const c=caseById(id),note=String(v.get('note')||'').trim(),outcome=String(v.get('outcome')||'done');if(note.length<2){fail('보고 내용을 두 글자 이상 적어 주세요.');form.querySelector('textarea').focus();return;}const scope=String(v.get('scope')||''),node=scope?trees.get(id)?.index.get(scope):null;if(scope&&!node){fail('보고할 원생의 기록을 찾지 못했습니다. 창을 닫고 원생을 다시 선택해 주세요.');return;}const refs=node?(Array.isArray(node.records)?node.records:[]).map(r=>String(r?.id||'')).filter(Boolean):v.getAll('ref').map(Number).map(i=>c?.entityRefs?.[i]).filter(Boolean).map(r=>`${r.type}:${r.id}`);if(c?.signalId==='billing-remaining'&&!refs.length){fail('처리한 청구를 한 건 이상 선택해 주세요.');return;}if(node&&!refs.length){fail('이 원생에게 붙일 기록이 없습니다.');return;}command('case.report',{caseId:id,payload:{...step,note,outcome,...(refs.length?{recordRefs:refs}:{}),...(v.getAll('attach').filter(Boolean).length?{attachments:v.getAll('attach').filter(Boolean).slice(0,20)}:{})}}).then(r=>done(r,c?.factSignal?(caseById(id)?.state==='done'?'보고를 남겼습니다. 근거 기록이 모두 처리되어 이 업무가 닫혔습니다.':['done','not_needed'].includes(outcome)?`${node?`${nodeLabel(node)} 원생의 `:''}기록을 처리한 것으로 남겼습니다.`:'보고를 남겼습니다. 아직 남은 업무로 열려 있습니다.'):node?`${nodeLabel(node)} 원생의 ${c?.closure==='fact'?'후속 ':''}보고를 남겼습니다. 같은 단계의 다른 원생은 그대로입니다.`:c?.closure==='fact'?(signalCase(c)?'후속 보고를 남겼습니다. 이 업무는 원본 기록이 바뀌면 닫힙니다.':'후속 보고를 남겼습니다. 원본 업무는 원본 기록이 처리되면 닫힙니다.'):caseById(id)?.state==='done'?'보고를 남겼습니다. 이 업무는 끝났습니다.':'보고를 남겼습니다.'));return;}
    if(kind==='review'){const decision=String(v.get('decision')||''),note=String(v.get('note')||'').trim();if(!decision){fail('결정을 선택해 주세요.');return;}if(decision==='return'&&note.length<2){fail('보완 요청할 때는 보완할 내용을 적어 주세요.');form.querySelector('textarea').focus();return;}command('case.review',{caseId:id,payload:{...step,decision,...(note?{note}:{})}}).then(r=>done(r,decision==='accept'?'승인했습니다.':'보완 요청했습니다.'));return;}
    if(kind==='reassign'){const ids=v.getAll('assignee').map(String),stepId=String(v.get('step')||'');if(!ids.length){fail('담당자를 한 명 이상 선택해 주세요.');form.querySelector('[data-cpick-name="assignee"] .cpick-trigger,[name="assignee"]')?.focus();return;}if(ids.length>10){fail('담당자는 10명까지 선택할 수 있습니다.');return;}command('case.reassign',{caseId:id,payload:{...(stepId?{stepId}:{}),assigneeIds:ids}}).then(r=>done(r,'담당을 저장했습니다.'));return;}
    if(kind==='bulk-reassign'){const ids=v.getAll('assignee').map(String);if(!ids.length){fail('담당자를 한 명 이상 선택해 주세요.');return;}if(ids.length>10){fail('담당자는 10명까지 선택할 수 있습니다.');return;}if(form.dataset.busy)return;form.dataset.busy='1';bulkReassign(form,ids).finally(()=>{delete form.dataset.busy;});return;}
    if(kind==='reopen'){const note=String(v.get('note')||'').trim();if(note.length<2){fail('다시 여는 이유를 적어 주세요.');form.querySelector('textarea').focus();return;}command('case.reopen',{caseId:id,payload:{note}}).then(r=>done(r,'다시 열었습니다.'));}
  },true);

  load();
  return {recordsHtml:recRows,fillRecords:fillFacts,load,ready,status:()=>store.status,actor,role,actors,nameOf,sidebar,inboxCount,ownerCards,ownerStageCell,ownerBelow,fullView,staffView,managerView,showCase,asRequests,createRequest,cardRequestFor,openCardFlow,actAs,caseById,stepOf,myStep,notices,stateNote};
};
