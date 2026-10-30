/* 3.0 owner workspaces: one reachable workspace per owner-visible 2.0 feature family.
   Structure comes from window.AxCatalog (areas, facets, actions); facts come from window.AcademySnapshot.workspaces
   (the verified local copy) and the read-only records endpoint. Actions are session-only previews, owner request
   drafts or navigation — nothing is sent, paid or written. window.AxCoverage reports where every action lands. */
window.createWorkspaces = function createWorkspaces(api) {
  'use strict';
  const {db,h,fmt,icon,dialog,navigate,toast,ax}=api;
  const $=s=>document.querySelector(s);
  const VIEW_KINDS=['flow','sheet','records','report','settings','timeline'];
  const PRIORITY_ORDER=['결정 필요','확인 필요','진행 확인'];
  const STATE_LABEL={available:'기록 있음',empty:'기록 없음','not-applicable':'해당 없음',unavailable:'읽지 못함',missing:'집계 연결 전'};
  const FACET_INTENT={flow:'이 단계에 있는 기록만 봅니다',sheet:'이 구분의 줄만 시트에 표시합니다',records:'이 구분의 기록만 봅니다',report:'이 구분의 문서만 목록에 표시합니다',settings:'이 설정 면의 현재 값과 미리보기 양식을 엽니다',timeline:'이 구분의 기록만 시간순으로 봅니다'};
  const MODE={preview:{label:'미리보기 · 저장 안 됨',destination:'local-preview',status:'session-only'},request:{label:'요청 초안',destination:'owner-request-draft',status:'draft-only'},navigate:{label:'화면 이동',destination:'navigate',status:'navigation'}};
  const PAGE_SIZE=20,BOARD_SIZE=5;
  // pin = 업무 흐름·기록 링크로 연 기록(목록 맨 위에 세운다) · cur = 상세를 연 기록(줄에 은은한 바탕) · board = 칸반 단계별 첫 기록.
  // sort·cols = 목록 열 머리의 정렬·값 거르기 · full = 정렬·거르기용으로 전부 읽은 기록 · asList = 칸반 대신 목록 · colw·lcols = 목록 열 모양.
  const state={screen:{},face:{},query:'',active:-1,open:new Set(),closed:new Set(),recent:[],facet:{},q:{},page:{},remote:{},local:{},edits:{},recipient:'',pin:{},cur:{},board:{},sort:{},cols:{},full:{},asList:{},colw:{},lcols:{},expanded:{}};
  // 다른 화면이 그린 공통 리스트(listTable) — 목록 이름 → { rows(검색어로 거른 줄 전부) · repaint(그 화면 다시 그리기) · sig }.
  const LOCAL=new Map();
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const btn=(text,action,attrs='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-ws="${action}" ${attrs}>${h(text)}</button>`;
  const norm=t=>String(t??'').toLowerCase().replace(/\s+/g,'');
  // 기록 날짜는 M/D(연월은 yy.mm)로 보인다(원장 10-28). 다른 모양의 값은 그대로.
  const dateText=v=>{const s=String(v??'');return /^\d{4}-\d{2}-\d{2}$/.test(s)?`${Number(s.slice(5,7))}/${Number(s.slice(8,10))}`:/^\d{4}-\d{2}$/.test(s)?api.yymm(s):s;};
  // 기록의 날짜가 무슨 날인지(원장 10-28 "3/10이 무슨 날짜인지") — 영역마다 그 기록 날짜가 뜻하는 것. 이름이 없는 영역은 날짜를 싣지 않는다.
  const DATE_NAME={dashboard:'브리핑일',calendar:'일정일','tasks-notifications':'기한',onescreen:'발송일','video-homework':'올린 날','class-sheets':'수업일',attendance:'수업일',makeups:'보강일','lesson-reports':'수업일',students:'등록일','student-contribution':'기록일',exams:'시험일',consultations:'상담일',enrollment:'접수일',newcomers:'등록일',withdrawals:'퇴원일','withdrawal-reports':'퇴원일',staff:'입사일',payroll:'발급일',billing:'납부 기한','textbook-requests':'요청일','expense-requests':'지출일',inventory:'실사일',meetings:'회의일',approvals:'기안일',documents:'수정일',support:'요청일','owner-settings':'시작일',integrations:'실행일'};
  // 기록의 '내용'(detail) 칸 이름 — 영역마다 그 칸이 담는 것. 없으면 '내용'.
  const DETAIL_NAME={calendar:'시각',billing:'청구월',staff:'직책',inventory:'모델',documents:'분류','expense-requests':'분류',textbooks:'분류',enrollment:'학년·학교',newcomers:'학교학년',students:'학교학년',exams:'시험',attendance:'반',makeups:'반','class-review':'반','withdrawal-reports':'구분',shuttle:'노선'};
  // 사람 이름이 아닌 첫 칸은 그 기록의 대상(반·문서·업무 등)으로 부른다.
  const NAME_HEAD={calendar:'일정','tasks-notifications':'업무',classes:'반',timetable:'반',textbooks:'교재',meetings:'회의',documents:'문서',support:'요청',dashboard:'브리핑',integrations:'연동',slack:'규칙','owner-settings':'항목','class-sheets':'반',onescreen:'첫 원생',inventory:'자산','expense-requests':'지출',approvals:'문서'};
  const dateName=id=>String(data(id)?.dateLabel||DATE_NAME[id]||'');
  const detailName=id=>String(data(id)?.detailLabel||DETAIL_NAME[id]||'내용');
  const blank=v=>{const s=String(v??'').trim();return !s||s==='—'||s==='-';};
  const subjectOf=r=>{const v=r?.subject||(r?.fields||[]).find(f=>f?.label==='과목')?.value;return blank(v)?'':String(v);};
  const shownValue=v=>{const s=String(v??'');return /^\d{4}-\d{2}(-\d{2})?$/.test(s)?dateText(s):s;};
  // 내용 칸이 이름·상태·칸 값으로 이미 다 말한 것이면 싣지 않는다(예: '달성초 초6' = 학교·학년 칸).
  function detailOf(r){
    const d=String(r?.detail||'').trim();if(!d||d===r.label)return '';
    const known=[r.label,subjectOf(r),r.status,...(r.fields||[]).map(f=>f?.value)].map(norm).filter(Boolean),parts=d.split(/[\s·,]+/).filter(Boolean);
    return parts.length&&parts.every(p=>known.some(k=>k.includes(norm(p))))?'':d;
  }

  /* ---------- catalog + data access ---------- */
  const areas=()=>Array.isArray(window.AxCatalog?.areas)?window.AxCatalog.areas.filter(a=>a&&a.id&&a.label):[];
  const area=id=>areas().find(a=>a.id===id);
  const has=id=>Boolean(area(id));
  const familyOf=page=>String(page||'').startsWith('workspace-')?String(page).slice(10):'';
  const data=id=>db.workspaces?.families?.[id]||null;
  const viewKind=a=>VIEW_KINDS.includes(a.viewKind)?a.viewKind:'records';
  const actionsOf=a=>(Array.isArray(a.actions)?a.actions:[]).filter(x=>x&&x.id&&x.label);
  const targetOf=x=>typeof x.target==='string'?{page:x.target,facet:''}:{page:String(x.target?.page||''),facet:String(x.target?.facet||'')};
  const resolvePage=page=>api.hasView(page)?page:has(familyOf(page)||page)?`workspace-${familyOf(page)||page}`:'';
  const resultLabel=x=>String(x.result?.label||`‘${x.label}’ 미리보기`);
  function dataState(id){
    const d=data(id);if(!d)return {key:'missing',note:''};
    return {key:STATE_LABEL[d.dataState]?d.dataState:'unavailable',note:String(d.coverageNote||'')};
  }
  // 기록이 없을 때 = 사람이 알아야 하는 상태만 한 줄(출처·집계 방식 설명은 싣지 않는다 — 원장 10-28 "개발자가 아닌 사람이 보지않아도 되는건").
  const EMPTY={missing:'아직 볼 수 있는 기록이 없습니다',unavailable:'기록을 읽지 못했습니다','not-applicable':'이 지점에 해당하지 않는 영역입니다'};
  const emptyBody=(st,filtered)=>`<div class="live-empty"><strong>${filtered?'이 조건의 기록이 없습니다':EMPTY[st.key]||'기록이 없습니다'}</strong>${!filtered&&st.key==='unavailable'&&st.note?`<p>${h(st.note)}</p>`:''}</div>`;
  // Record filters come only from the data facets (ids the records endpoint accepts). Catalog facets are the 2.0
  // screen's tabs/boxes/stages/faces: entry points to related actions, never sent to the records endpoint.
  function facetsOf(a){const d=data(a.id);return Array.isArray(d?.facets)?d.facets.filter(f=>f&&f.id).map(f=>({id:String(f.id),label:String(f.label||f.id),count:Number.isFinite(Number(f.count))?Number(f.count):null})):[];}
  const screensOf=a=>(Array.isArray(a.facets)?a.facets:[]).filter(f=>f&&f.id&&f.label);
  const dimension=id=>String(id).includes(':')?String(id).split(':')[0]:'';
  // Flow columns use one dimension of the data facets (status first) so a record never appears in two columns.
  function stagesOf(a){const list=facetsOf(a),dims=[...new Set(list.map(f=>dimension(f.id)).filter(Boolean))],dim=dims.includes('status')?'status':dims[0];return dim?list.filter(f=>dimension(f.id)===dim):list;}
  const screenActions=(a,screenId)=>actionsOf(a).filter(x=>targetOf(x).facet===screenId);
  const previews=id=>Array.isArray(data(id)?.records)?data(id).records:[];
  // Records read one by one by exact id (GET …/records?id=) for links to a record off the loaded page.
  const exact={};
  const boardItems=id=>state.board[id]?.cols?[...state.board[id].cols.values()].flat():[];
  const recordById=(id,rid)=>[...previews(id),...(state.remote[id]?.data?.items||[]),...boardItems(id),...(exact[id]?.values()||[])].find(r=>String(r.id)===String(rid));

  /* ---------- records: previews first, full list through the read-only endpoint when it is served ---------- */
  function remoteKey(id){return `${state.q[id]||''}|${state.facet[id]||''}|${state.page[id]||1}`;}
  // 칸반(흐름) = 걸러보기·검색 없이 첫 쪽일 때. 단계마다 그 단계의 첫 기록을 따로 읽어 칸의 건수와 칸 안 기록이 맞는다(원장 10-28 '상담 예약 1'인데 비어 있음).
  // 걸러보기·검색을 걸면 열을 맞춘 목록으로 본다.
  // '목록' 보기를 고르면(asList) 칸반 대신 열을 맞춘 목록이다.
  const boardMode=id=>{const a=area(id);return Boolean(a&&data(id))&&viewKind(a)==='flow'&&stagesOf(a).length>0&&!state.asList[id]&&!state.facet[id]&&!state.q[id]&&(state.page[id]||1)===1;};
  // 정렬·값 거르기(열 머리): 그 조건의 기록이 사본에 다 있으면 바로, 아니면 전부 읽어 온 뒤(FULL_MAX건까지 · 100건씩) 화면에서 정렬·거르기·쪽 나누기.
  const FULL_MAX=8000;
  const sortOf=id=>state.sort[id]||{col:'',dir:''};
  const colOn=id=>Object.entries(state.cols[id]||{}).filter(([,v])=>Array.isArray(v));
  const arranged=id=>Boolean(sortOf(id).col)||colOn(id).length>0;
  const wholeLocal=id=>Boolean(state.unsupported)||Number(data(id)?.totalRecords||0)<=previews(id).length;
  const fullKey=id=>`${state.q[id]||''}|${state.facet[id]||''}`;
  const fullReady=id=>state.full[id]?.key===fullKey(id)&&state.full[id].status==='ready';
  const fullMode=id=>arranged(id)&&!wholeLocal(id);
  function needsRemote(id){const d=data(id);return Boolean(d)&&!state.unsupported&&!boardMode(id)&&!(fullMode(id)&&fullReady(id))&&(Number(d.totalRecords)>previews(id).length||state.q[id]||state.facet[id]||(state.page[id]||1)>1);}
  // 지금 조건(검색어·구분)의 기록 수 — 아는 때만(모르면 null).
  function knownCount(id){
    const f=state.full[id],s=state.remote[id];
    if(f?.key===fullKey(id)&&Number.isFinite(f.total))return f.total;
    if(s?.status==='ready'&&String(s.key).startsWith(`${fullKey(id)}|`))return Number(s.data.filteredTotal)||0;
    return !state.q[id]&&!state.facet[id]?Number(data(id)?.totalRecords)||0:null;
  }
  async function loadAll(id){
    const key=fullKey(id),slot=state.full[id]||(state.full[id]={});
    if(slot.key===key&&['loading','ready','toomany'].includes(slot.status))return;
    slot.ctrl?.abort();const ctrl=new AbortController();Object.assign(slot,{key,status:'loading',ctrl,items:null,total:undefined});
    const get=async p=>{
      const params=new URLSearchParams({page:String(p),pageSize:'100'});if(state.q[id])params.set('q',state.q[id].slice(0,100));if(state.facet[id])params.set('facet',state.facet[id]);
      const res=await fetch(`/api/workspaces/${encodeURIComponent(id)}/records?${params}`,{headers:{Accept:'application/json'},signal:ctrl.signal});
      const json=await res.json().catch(()=>null);
      if(!res.ok||!Array.isArray(json?.items))throw new Error(typeof json?.message==='string'?json.message:'기록을 불러오지 못했습니다.');
      return json;
    };
    try{
      const first=await get(1),total=Number(first.filteredTotal)||first.items.length;
      if(total>FULL_MAX)Object.assign(slot,{status:'toomany',total});
      else{
        const pages=[first.items],count=Number(first.pageCount)||1;let next=2;
        const worker=async()=>{while(next<=count){const p=next++;pages[p-1]=(await get(p)).items;}};
        await Promise.all(Array.from({length:Math.min(6,count-1)},worker));
        Object.assign(slot,{status:'ready',items:pages.flat(),total});
      }
    }catch(e){if(ctrl.signal.aborted)return;Object.assign(slot,{status:'error',message:e?.message||'기록을 불러오지 못했습니다.'});ctrl.abort();} // 한 쪽이 실패하면 남은 요청도 멈춘다
    if(slot.key!==key||fullKey(id)!==key)return;
    if(slot.status==='toomany'&&arranged(id)){delete state.sort[id];delete state.cols[id];toast(tooMany(slot.total));}
    if(api.getPage()===`workspace-${id}`)refreshMain(id);
    if(colMenu.id===id)paintColMenu();
  }
  const tooMany=n=>`기록이 ${fmt(n)}건이라 열로 정렬·거르기를 할 수 없습니다. 검색이나 위의 구분으로 ${fmt(FULL_MAX)}건 이하로 좁혀 주세요.`;
  const boardNeeded=id=>boardMode(id)&&!state.unsupported&&Number(data(id)?.totalRecords)>previews(id).length;
  async function loadBoard(id){
    const a=area(id),slot=state.board[id]||(state.board[id]={});if(!a||['ready','loading'].includes(slot.status))return;
    slot.status='loading';
    try{
      const lists=await Promise.all(stagesOf(a).map(async f=>{
        const res=await fetch(`/api/workspaces/${encodeURIComponent(id)}/records?${new URLSearchParams({facet:f.id,page:'1',pageSize:String(BOARD_SIZE)})}`,{headers:{Accept:'application/json'}});
        const json=await res.json().catch(()=>null);
        if(!res.ok||!Array.isArray(json?.items))throw new Error(typeof json?.message==='string'?json.message:'단계별 기록을 불러오지 못했습니다.');
        return [f.id,json.items];}));
      Object.assign(slot,{status:'ready',cols:new Map(lists)});
    }catch(e){Object.assign(slot,{status:'error',message:e?.message||'단계별 기록을 불러오지 못했습니다.'});}
    if(api.getPage()===`workspace-${id}`&&boardMode(id))refreshMain(id);
  }
  // 업무 흐름·기록 링크로 연 기록은 목록 맨 위에 둔다 — 쪽이 많은 목록에서도 그 줄이 화면 안에 있다. 걸러보기와 맞지 않거나 검색 중이면 세우지 않는다.
  function withPin(id,items){
    const pid=state.pin[id],r=pid&&recordById(id,pid),f=state.facet[id];
    if(!r||state.q[id]||(state.page[id]||1)>1||f&&!(r.facetIds||[]).includes(f))return items;
    return [r,...items.filter(x=>String(x.id)!==String(pid))];
  }
  const isCur=(id,rid)=>state.cur[id]!==undefined&&String(state.cur[id])===String(rid);
  const curAttr=(id,rid)=>isCur(id,rid)?' aria-current="true"':'';
  // 상세를 연 기록의 줄 = 은은한 바탕(펄스·흐림 없음 — 원장 10-28 "펄스랑 강조 효과 안해도 됨"). 다시 그리지 않고 표시만 옮긴다.
  function markCurrent(id){
    const main=document.querySelector(`.ws[data-family="${CSS.escape(id)}"] #ws-main`);if(!main)return null;
    main.querySelectorAll('[aria-current="true"]').forEach(n=>n.removeAttribute('aria-current'));
    const rid=state.cur[id];if(rid===undefined)return null;
    const rows=[...main.querySelectorAll(`.ws-table tr[data-record="${CSS.escape(String(rid))}"],.ws-sheet .ws-row-head[data-record="${CSS.escape(String(rid))}"]`)].map(n=>n.closest('tr')||n);
    rows.forEach(n=>n.setAttribute('aria-current','true'));return rows[0]||null;
  }
  async function loadRecords(id){
    const key=remoteKey(id),slot=state.remote[id]||(state.remote[id]={});
    if(slot.key===key&&slot.status!=='error')return;
    slot.controller?.abort();const controller=new AbortController();Object.assign(slot,{key,status:'loading',controller});
    const params=new URLSearchParams({page:String(state.page[id]||1),pageSize:String(PAGE_SIZE)});
    if(state.q[id])params.set('q',state.q[id].slice(0,100));if(state.facet[id])params.set('facet',state.facet[id]);
    try{
      const response=await fetch(`/api/workspaces/${encodeURIComponent(id)}/records?${params}`,{headers:{Accept:'application/json'},signal:controller.signal});
      let json=null;try{json=await response.json();}catch{/* not JSON: endpoint not served here */}
      if(slot.key!==key)return;
      if(response.ok&&json&&Array.isArray(json.items))Object.assign(slot,{status:'ready',data:json});
      else if(!json||[404,405,501].includes(response.status)&&json?.error!=='unknown_family'){Object.assign(slot,{status:'unsupported'});state.unsupported=true;}
      else Object.assign(slot,{status:'error',message:typeof json.message==='string'?json.message:'기록을 불러오지 못했습니다.'});
    }catch{if(controller.signal.aborted)return;Object.assign(slot,{status:'error',message:'기록을 불러오지 못했습니다. 다시 시도해 주세요.'});}
    if(api.getPage()===`workspace-${id}`)refreshMain(id);
  }
  function visibleRecords(id){
    const slot=state.remote[id];
    if(needsRemote(id)&&slot?.key===remoteKey(id)&&slot.status==='ready')return {items:slot.data.items,total:slot.data.total,filtered:slot.data.filteredTotal,pageCount:slot.data.pageCount,source:'full'};
    const items=localMatches(id);
    return {items,total:Number(data(id)?.totalRecords)||previews(id).length,filtered:items.length,pageCount:1,source:'preview'};
  }
  function localMatches(id){
    const q=norm(state.q[id]),facet=state.facet[id];
    return previews(id).filter(r=>(!facet||(r.facetIds||[]).includes(facet))&&(!q||norm([r.label,subjectOf(r),r.detail,r.status,r.date,...(r.fields||[]).map(f=>f.value)].join(' ')).includes(q)));
  }
  // 지금 조건의 기록을 빠짐없이 가진 목록(없으면 null) — 정렬·거르기·열 머리 값 목록은 이것으로만 한다(한 쪽만 정렬하는 일이 없게).
  // 다른 화면의 목록(listTable · LOCAL)은 그 화면이 넘긴 줄이 전부다(검색어로 거른 뒤).
  function completeBase(id){
    if(LOCAL.has(id))return LOCAL.get(id).rows;
    const s=state.remote[id];
    if(fullReady(id))return state.full[id].items;
    if(s?.status==='ready'&&s.key===`${fullKey(id)}|1`&&Number(s.data.pageCount)<=1)return s.data.items;
    return wholeLocal(id)?localMatches(id):null;
  }
  // 목록 한 쪽 = 열 · 줄 · 쪽. 빠짐없이 가진 목록이면 화면에서 거르고 정렬하고 20건씩 나누고, 아니면 서버의 쪽 그대로(정렬 안 함).
  function listData(a){
    const id=a.id,slot=state.remote[id],full=completeBase(id);
    let base,pages=0,filtered=null,source='preview';
    if(full&&(!needsRemote(id)||fullReady(id)||slot?.key===remoteKey(id)&&slot.status==='ready')){base=full;source=fullReady(id)?'full':'local';}
    else if(needsRemote(id)&&slot?.key===remoteKey(id)&&slot.status==='ready'){base=slot.data.items;pages=Number(slot.data.pageCount)||1;filtered=Number(slot.data.filteredTotal);source='page';}
    else base=localMatches(id);
    // 열은 지금 조건의 기록으로 — 하나도 없으면 최근 기록의 칸으로(머리가 이름 하나만 남지 않게).
    const complete=source==='full'||source==='local',cols=familyColumns(a,base.length?base:previews(id)),all=[nameColumn(id),...cols];
    state.lcols[id]=all;
    let rows=complete?arrange(a,base,all):viewKind(a)==='timeline'?sortBy(base,r=>String(r.date||''),'desc'):base,page=state.page[id]||1;
    if(complete){filtered=rows.length;pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));page=Math.min(page,pages);rows=rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);}
    if(!arranged(id))rows=withPin(id,rows);
    return {cols,rows,page,pages,filtered,source,complete};
  }

  /* ---------- workspace page ---------- */
  function view(id){
    const a=area(id);if(!a)return '';
    state.recent=[id,...state.recent.filter(x=>x!==id)].slice(0,4);
    if(needsRemote(id))queueMicrotask(()=>loadRecords(id));
    if(boardNeeded(id))queueMicrotask(()=>loadBoard(id));
    if(fullMode(id)&&!fullReady(id))queueMicrotask(()=>loadAll(id));
    const d=data(id),kind=viewKind(a);
    // 머리 = 영역 · 제목 · 지금 상태 한 줄. 출처·기준일·목록 설명 줄은 싣지 않는다(원장 10-28 "쓸데없는 문구들 … 없애거나 수정해").
    return `<div class="ws" data-family="${h(id)}" data-view="${kind}"><div class="page-heading ws-heading"><div><p class="ws-group">${h(a.group||'')}</p><h1>${h(a.label)}</h1><p>${h(d?.summary||a.summary||'')}</p></div><div class="heading-actions">${btn('이 화면으로 대화','ask',`data-id="${h(id)}"`)}${btn('업무 요청','request',`data-id="${h(id)}"`,true)}</div></div>${critical(a)}${signalList(a)}<div class="ws-body"><section class="ws-main" id="ws-main" aria-label="${h(a.label)} 기록">${mainHtml(a)}</section><aside class="ws-side">${actionPanel(a)}<div id="ws-local">${localLog(a)}</div>${linkedRequests(a)}${relations(a)}</aside></div></div>`;
  }
  // KPI = 최근 변화(원장 10-28 "원하는건 추세"): 지금 값 · 직전 기간 대비(좋아짐/나빠짐 색) · 추세선(기간마다 값은 마우스·키보드로).
  // 작업 공간 카드와 원장 첫 화면 '운영 상태'가 같은 함수로 그린다. 기간(span)은 제목 오른쪽(원장 10-28 "제목 우측에 기한 적어놓을것").
  // 카드 아래 일반 설명(basis)은 그리지 않는다. 퇴원 장부 정리처럼 카드와 추세의 숫자가 다른 창에만 그 차이를 안내한다.
  function kpiCard(m){const pct=m.unit==='%',shown=v=>v===null?'기록 없음':`${pct?v.toFixed(1):fmt(v)}${m.unit||''}`,d=m.delta,dir=d===null||d===0?0:d>0?1:-1,good=m.better==='up'?dir>0:m.better==='down'?dir<0:null,per=m.period==='month'?'전월':'7일 전';
    const change=d===null?'비교할 기간 기록 없음':dir===0?`${per} 대비 변화 없음`:`${per} 대비 ${dir>0?'▲':'▼'} ${pct?`${Math.abs(d).toFixed(1)}%p`:`${fmt(Math.abs(d))}${m.unit||''}`}${!pct&&m.previous>0?` (${Math.round(Math.abs(d)/m.previous*100)}%)`:''}`;
    // id가 있는 지표 = 확장 추세가 있다 — 카드 어디를 눌러도 그 지표의 확장 추세로(원장 10-28 "추세를 눌렀을때 확장 추세로 이동"). 클릭은 v2-screen-trend.js가 받는다.
    const grain=m.period==='month'?'month':'week',href=m.id?`#v2-trend?metric=${encodeURIComponent(m.id)}&grain=${grain}`:'';
    const tip=m.detail?` data-tip="${h(m.detail)}"`:'';
    return `<div class="ws-metric ws-kpi"${m.id?` data-trend="${h(m.id)}" data-grain="${grain}"`:''}><span class="ws-kpi-title">${href?`<a href="${href}"${tip}>${h(m.label)}</a>`:`<span${tip}>${h(m.label)}</span>`}${m.span?`<em>${h(m.span)}</em>`:''}</span><strong>${h(shown(m.value))}</strong><small class="ws-kpi-change${dir===0||good===null?'':good?' good':' bad'}">${h(change)}${m.cleanupNote?`<span class="ws-kpi-cleanup">${h(m.cleanupNote)}</span>`:''}</small><span class="ws-kpi-spark">${api.lineChart(m.points,{key:'value',label:m.label,unit:m.unit||'',compare:per,better:m.better||''})}</span></div>`;}
  // 카드 제목 설명은 문서에 한 장만 둔다. 링크의 클릭과 차트 팝오버를 가리지 않는다.
  let kpiTip=null,kpiTipFor=null;
  const hideKpiTip=()=>{kpiTipFor?.removeAttribute('aria-describedby');kpiTipFor=null;if(kpiTip)kpiTip.hidden=true;};
  function showKpiTip(el){
    if(el===kpiTipFor)return;
    hideKpiTip();if(!el?.dataset.tip)return;
    kpiTip??=Object.assign(document.createElement('div'),{id:'ws-kpi-tip',className:'ws-kpi-tip',role:'tooltip'});
    if(!kpiTip.isConnected)document.body.append(kpiTip);
    kpiTip.textContent=el.dataset.tip;kpiTip.hidden=false;kpiTipFor=el;el.setAttribute('aria-describedby',kpiTip.id);
    const r=el.getBoundingClientRect(),w=kpiTip.offsetWidth,height=kpiTip.offsetHeight;
    const top=r.bottom+8+height<=innerHeight-8?r.bottom+8:Math.max(8,r.top-height-8);
    kpiTip.style.left=`${Math.max(8,Math.min(r.left,innerWidth-w-8))}px`;kpiTip.style.top=`${top}px`;
  }
  const kpiTitleOf=target=>target.closest?.('.ws-kpi-title [data-tip]');
  document.addEventListener('pointerover',e=>{const el=kpiTitleOf(e.target);if(el&&!(e.relatedTarget instanceof Node&&el.contains(e.relatedTarget)))showKpiTip(el);});
  document.addEventListener('pointerout',e=>{const el=kpiTitleOf(e.target);if(el&&!(e.relatedTarget instanceof Node&&el.contains(e.relatedTarget)))hideKpiTip();});
  document.addEventListener('focusin',e=>{const el=kpiTitleOf(e.target);if(el){showKpiTip(el);requestAnimationFrame(()=>{if(document.activeElement===el&&!kpiTipFor)showKpiTip(el);});}});
  document.addEventListener('focusout',e=>{if(kpiTipFor===e.target)hideKpiTip();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideKpiTip();});
  document.addEventListener('scroll',hideKpiTip,true);addEventListener('resize',hideKpiTip);addEventListener('hashchange',hideKpiTip);
  function critical(a){
    // KPI 추세 카드가 있으면 6개까지, 누적 건수 막대는 그리지 않는다(원장 10-28 "전체 몇건 … 아무 도움이 안됨"). 공통 설명은 카드 아래 한 번.
    const all=d0=>d0?.metrics||[],d=data(a.id),isKpi=all(d).some(m=>m.kind==='kpi'),metrics=isKpi?all(d).filter(m=>m.kind==='kpi'):all(d).slice(0,4),trend=isKpi?null:d?.trend;
    if(!metrics.length&&!trend?.points?.length)return '';
    const value=m=>m.value===null||m.value===undefined?'기록 없음':`${fmt(m.value)}${m.unit||''}`;
    const points=(trend?.points||[]).map(p=>trend.granularity==='day'?{date:p.date,value:p.value}:{month:p.date,value:p.value});
    // 막대는 아래 구분 칩과 무관한 전체 기록이다. 기간 칩(이번 달·올해·26.xx)을 고르면 그 달 막대를 강조하고, 머리에 기준을 적는다.
    const fid=state.facet[a.id]||'',fl=fid?facetsOf(a).find(f=>f.id===fid)?.label||'':'',months=points.map(p=>p.month).filter(Boolean),cur=db.meta.month;
    const active=(/^month:\d{4}-\d{2}$/.test(fid)?[fid.slice(6)]:fid==='this-year'||/올해/.test(fl)?months.filter(m=>m.slice(0,4)===cur.slice(0,4)):/this-month/.test(fid)||/이번 달/.test(fl)?[cur]:[]).filter(m=>months.includes(m));
    const basis=`${active.length?`${active.length>1?`${api.yymm(active[0])}~${api.yymm(active.at(-1))}`:api.yymm(active[0])} 강조 · `:''}전체 기록 · 아래 구분과 무관`;
    const chartHtml=!points.length?'':trend.granularity==='day'?`<div class="ws-line">${api.lineChart(points,{key:'value',label:trend.label,unit:trend.unit||''})}</div>`:api.chart(points.map(p=>({...p,label:api.yymm(p.month)})),'value',trend.unit==='원'?'만원':trend.unit||'',{label:trend.label,...(active.length?{active}:{})});
    return `<section class="ws-critical" aria-label="핵심 지표">${metrics.length?`<div class="ws-metrics"${isKpi?` style="--kpi-n:${metrics.length<=6?metrics.length:Math.ceil(metrics.length/2)};--kpi-half:${metrics.length<=6?Math.ceil(metrics.length/2):3}"`:''}>${metrics.map(m=>m.kind==='kpi'?kpiCard(m):`<div class="ws-metric"><span>${h(m.label)}</span><strong>${h(value(m))}</strong>${m.detail?`<small>${h(m.detail)}</small>`:''}</div>`).join('')}</div>`:''}${chartHtml?`<div class="ws-trend"><h2>${h(trend.label||'추이')}</h2><p class="ax-note ws-trend-basis">${h(basis)}</p>${chartHtml}</div>`:''}</section>`;
  }
  const byPriority=(x,y)=>(PRIORITY_ORDER.indexOf(x.priority)+1||9)-(PRIORITY_ORDER.indexOf(y.priority)+1||9);
  function signalCard(id,s,withFamily=false){
    const a=area(id);
    // 출처 줄(s.source — '수납관리 · 청구·할인·수납 기록' 같은 집계 출처)은 싣지 않는다(원장 10-28).
    return `<article class="ws-signal"><div class="ax-issue-meta">${pill(s.priority||'확인 필요',s.priority==='결정 필요'?'amber':'blue')}${withFamily?pill(a?.label||id):''}${s.recordIds?.length?`<span>근거 ${s.recordIds.length}건</span>`:''}</div><h3>${h(s.title)}</h3><p>${h(s.summary||'')}</p>${s.id==='billing-remaining'?'<p class="ax-note">수납 반영은 메이크에듀 동기화로 들어옵니다 — 학부모 안내 등 처리 뒤 보고로 닫기</p>':''}<div class="ax-actions">${btn('근거 보기','signal-evidence',`data-id="${h(id)}" data-signal="${h(s.id)}"`)}${btn('업무 요청','signal-request',`data-id="${h(id)}" data-signal="${h(s.id)}"`,true)}</div></article>`;
  }
  function signalList(a){const list=[...(data(a.id)?.signals||[])].sort(byPriority);return list.length?`<section class="ws-signals" aria-label="이 작업 공간의 신호"><h2>지금 올라온 신호 ${list.length}건</h2><div class="ws-signal-grid">${list.map(s=>signalCard(a.id,s)).join('')}</div></section>`:'';}

  function mainHtml(a){
    const id=a.id,kind=viewKind(a),facets=facetsOf(a),board=boardMode(id),ld=board?null:listData(a),slot=state.remote[id],bslot=state.board[id],fslot=state.full[id];
    const st=dataState(id),facet=state.facet[id]||'',filtered=Boolean(facet||state.q[id]||colOn(id).length);
    // '화면별 할 일' 줄 = 눌러서 관련 작업을 모아 보는 화면만. 이름만 있는 2.0 탭·단계 이름은 싣지 않는다 — 아래 구분(걸러보기)과 뜻이 겹친다(원장 10-28).
    const screens=screensOf(a).filter(sc=>screenActions(a,sc.id).length),screen=state.screen[id]||'';
    const screenRow=screens.length&&kind!=='settings'?`<div class="ws-screens" role="group" aria-label="화면별 할 일"><span>화면별 할 일</span>${screens.map(sc=>`<button type="button" data-ws="screen" data-id="${h(id)}" data-screen="${h(sc.id)}" aria-pressed="${screen===sc.id}">${h(sc.label)}</button>`).join('')}</div>`:'';
    const tabs=facets.length?`<div class="ws-facets" role="group" aria-label="기록 구분">${[{id:'',label:'전체',count:Number(data(id)?.totalRecords)||null},...facets].map(f=>`<button type="button" data-ws="facet" data-id="${h(id)}" data-facet="${h(f.id)}" aria-pressed="${facet===f.id}">${h(f.label)}${f.count!==null&&f.count!==undefined?` <b>${fmt(f.count)}</b>`:''}</button>`).join('')}</div>`:'';
    // 업무 단계가 있는 영역 = '단계별'(칸반) · '목록'(공통 리스트 — 정렬·값 거르기) 둘 중 하나로 본다.
    const toggle=kind==='flow'&&stagesOf(a).length&&data(id)?`<div class="ws-viewtoggle" role="group" aria-label="보기">${[['board','단계별'],['list','목록']].map(([v,l])=>`<button type="button" data-ws="as-list" data-id="${h(id)}" data-v="${v}" aria-pressed="${(v==='board')===board}">${l}</button>`).join('')}</div>`:'';
    // 건수는 걸러 볼 때만(찾은 수) — 전체 건수는 위 구분의 '전체'에 있다.
    const counted=!board&&filtered&&ld.filtered!==null?`찾은 기록 ${fmt(ld.filtered)}건`:'';
    const search=data(id)&&kind!=='settings'?`<div class="ws-search">${toggle}<input type="search" id="ws-q-${h(id)}" data-ws-q="${h(id)}" value="${h(state.q[id]||'')}" maxlength="100" aria-label="${h(a.label)} 기록 검색" placeholder="이름·내용·상태 검색" autocomplete="off"><span>${counted}</span></div>`:'';
    const retry=btn('다시 시도','reload',`data-id="${h(id)}"`),partial=Number(data(id)?.totalRecords||0)>previews(id).length;
    let note='';
    if(board)note=bslot?.status==='error'?`<p class="ax-note">${h(bslot.message)} ${retry}</p>`:'';
    else if(fullMode(id)&&!fullReady(id))note=`<p class="ax-note" role="status">${fslot?.key===fullKey(id)&&fslot.status==='error'?`${h(fslot.message)} ${btn('다시 시도','reload-full',`data-id="${h(id)}"`)}`:'정렬·거르기할 기록을 모두 불러오는 중입니다.'}</p>`;
    else if(partial&&(state.unsupported||ld.source==='preview'))note=`<p class="ax-note">${slot?.status==='error'?h(slot.message):state.unsupported?'전체 목록을 아직 불러올 수 없어 최근 기록만 보입니다.':'전체 기록을 불러오는 중입니다.'}${slot?.status==='error'?` ${retry}`:''}</p>`;
    let body;
    if(!data(id))body=emptyBody({key:'missing'},false);
    else if(board)body=previews(id).length||boardItems(id).length?flowView(a,previews(id)):emptyBody(st,false);
    else if(kind==='sheet')body=ld.rows.length?sheetView(a,ld.rows):emptyBody(st,filtered);
    // 열 거르기로 줄이 다 빠져도 머리는 남긴다 — 열 머리 메뉴로 바로 되돌릴 수 있게.
    else if(!ld.rows.length)body=`${colOn(id).length?recordsTable(a,ld):''}${emptyBody(st,filtered)}`;
    else body=recordsTable(a,ld);
    const pager=!board&&ld.pages>1?pagerHtml(id,ld.page,ld.pages):'';
    return `${id==='teacher-workspace'?recipientPreview():''}${kind==='settings'?settingsView(a):screenRow}${kind==='settings'&&data(id)?`<h3 class="ws-records-title">현재 설정 값</h3>`:''}${tabs}${search}${board?'':colChips(id)}${note}${body}${pager}`;
  }
  // Teacher workspace: what a selected staff member receives. Owner requests can be acknowledged and completion-reported
  // here (session only); automatic 2.0 tasks are listed separately and only open their source record.
  function recipientPicker(staffId,owners){
    const CP=window.ContextPicker;
    if(!CP)return `<label class="ws-recipient-pick">직원<select id="ws-recipient" data-ws-recipient>${db.staff.map(s=>`<option value="${h(s.id)}" ${s.id===staffId?'selected':''}>${h(s.name)} · ${h(s.title)}${owners.includes(s.id)?' · 요청 있음':''}</option>`).join('')}</select></label>`;
    const list=CP.lists.staff({db,subjectLabel:api.subjectLabel});
    list.options.forEach(o=>{if(owners.includes(o.value)){o.sub=[o.sub,'원장 요청 있음'].filter(Boolean).join(' · ');o.context=[o.context,'원장 요청 있음'].filter(Boolean).join(' · ');o.search=`${o.search||''} 요청`;}});
    return `<div class="ws-recipient-pick">${CP.html({id:'ws-recipient',name:'recipient',label:'받는 직원',clearable:false,selected:staffId?[staffId]:[],attrs:{'data-ws-recipient':''},...list})}</div>`;
  }
  function recipientPreview(){
    const owners=ax.recipient?.owners()||[],staffId=state.recipient||owners[0]||db.staff[0]?.id||'',person=db.staff.find(s=>s.id===staffId);
    const list=ax.recipient?.list(staffId)||[],auto=person?db.tasks.filter(t=>t.status==='open'&&!t.local&&t.owners.includes(person.name)):[];
    const status={requested:'확인 대기',working:'진행 중',done:'완료 보고'};
    return `<section class="ws-recipient" aria-labelledby="ws-recipient-title"><div class="ax-section-head"><h2 id="ws-recipient-title">받는 사람 수신함 미리보기</h2>${recipientPicker(staffId,owners)}</div>${list.length?list.map(r=>`<article class="ws-inbox-item"><header>${pill(status[r.status],r.status==='done'?'green':'blue')}<strong>${h(r.title)}</strong><small>${h(r.due)}까지 · ${h(r.priority)}${r.context?.familyLabel?` · ${h(r.context.familyLabel)}`:''}</small></header><p class="live-pre">${h(r.body)}</p>${r.status==='requested'?btn('확인했습니다','recipient-ack',`data-request="${h(r.id)}"`,true):r.status==='working'?`<form class="ws-form" data-ws-form="recipient-report" data-request="${h(r.id)}" novalidate><label>완료 보고<textarea name="result" rows="2" maxlength="3000" required></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><button class="button primary" type="submit">완료 보고</button></div></form>`:`<p class="ax-note">보고 내용: ${h(r.result)}</p>`}</article>`).join(''):`<p class="live-empty">이 직원에게 보낸 원장 요청이 없습니다.</p>`}<section class="ws-auto"><h3>자동 업무 ${auto.length}건</h3>${autoTasks(auto.slice(0,6))}${auto.length>6?`<p class="ax-note">나머지 ${auto.length-6}건은 업무 목록에서 확인합니다.</p>`:''}</section></section>`;
  }
  // 자동 업무 = 공통 리스트(할 일 | 내용 | 기한). 줄을 누르면 그 할 일(원본 기록으로 가는 상세).
  function autoTasks(list){
    if(!list.length)return '';
    const rows=list.map(t=>({...t,label:String(t.title||'')}));
    const cols=[{key:'detail',label:'내용',text:t=>String(t.detail||'')},{key:'due',label:'기한',text:t=>t.due?`${dateText(t.due)}까지`:''}].filter(c=>rows.some(t=>c.text(t)));
    return tableHtml({shape:sizeColumns('teacher-tasks',cols,rows,{nameLabel:'업무'}),rows,nameLabel:'업무',main:t=>`<button type="button" class="ws-rowmain ws-cut" data-task="${h(t.id)}">${h(t.label)}</button>`});
  }
  const localCount=(id,rid)=>(state.local[id]||[]).filter(e=>e.recordId===String(rid)).length;
  /* ---------- 공통 리스트 ----------
     업무 흐름 표(flow-ui)와 같은 규칙 한 벌 — 표 한 장(table-layout:fixed) · 열 머리 한 줄 · 열마다 정해진 너비 · 넘친 칸은 말줄임(기록 상세에서 확인).
     금액은 오른쪽, 짧은 값은 가운데, 긴 글은 왼쪽(머리도 같은 쪽) · 열 머리를 누르면 정렬(오름·내림)·값 거르기 · 아래 쪽 번호.
     줄 어디를 눌러도 그 줄의 이름 단추가 하는 일(기록이면 상세 서랍). 칸 값이 없으면 빈 칸(다음 값을 당기지 않는다).
     작업 공간의 기록 목록(목록·날짜순·문서·설정 값·업무 단계 목록) · 칸반 칸 안의 줄 · 직원 수신함의 자동 업무를 모두 이 한 벌(tableHtml · sizeColumns)로 그린다. */
  const MONEY=/^-?[\d,]+원$/,collate=new Intl.Collator('ko',{numeric:true}).compare;
  // 글 폭 어림(em) — 한글 1 · 숫자 0.6 · 영문 0.62 · 빈칸 0.3 · 그 밖 0.4.
  const emOf=s=>{let n=0;for(const ch of String(s??''))n+=/[가-힣ㄱ-ㆎ一-鿿]/.test(ch)?1:/\d/.test(ch)?.6:/[A-Za-z]/.test(ch)?.62:/\s/.test(ch)?.3:.4;return n;};
  function cellText(r,key){
    if(key==='name')return String(r.label||'');
    if(key==='subject')return subjectOf(r);
    if(key==='detail')return shownValue(detailOf(r));
    if(key==='status')return String(r.status||'');
    if(key==='date')return dateText(r.date);
    const f=(r.fields||[]).find(x=>x&&x.label===key.slice(2));return f&&!blank(f.value)?shownValue(f.value):'';
  }
  // 정렬 값 = 원래 값: 날짜는 YYYY-MM-DD(화면의 M/D 글자 순서가 아니라) · 금액·건수·점수는 숫자 · 그 밖은 글(숫자는 크기 순). 빈 칸은 방향과 상관없이 맨 뒤.
  function sortValue(r,key){
    if(key==='date')return String(r.date||'');
    return rawSort(key==='name'?r.label:key==='subject'?subjectOf(r):key==='detail'?detailOf(r):key==='status'?r.status:(r.fields||[]).find(x=>x&&x.label===key.slice(2))?.value);
  }
  function rawSort(raw){
    const s=String(raw??'').trim();
    if(blank(s))return '';
    if(/^\d{4}-\d{2}(-\d{2})?/.test(s))return s;
    const m=/^-?[\d,]*\d(\.\d+)?/.exec(s),rest=m?s.slice(m[0].length):'';
    return m&&!/\d/.test(rest)&&rest.trim().length<=3?Number(m[0].replace(/,/g,'')):s;
  }
  function sortBy(list,key,dir){
    const v=new Map(list.map(r=>[r,key(r)])),sign=dir==='desc'?-1:1;
    return [...list].sort((a,b)=>{const x=v.get(a),y=v.get(b),ex=x===''||x==null,ey=y===''||y==null;if(ex||ey)return ex===ey?0:ex?1:-1;return sign*(typeof x==='number'&&typeof y==='number'?x-y:collate(String(x),String(y)));});
  }
  // 열 거르기 → 정렬. skip = 값 목록을 뽑는 그 열(자기 거르기는 빼고 센다 — 엑셀과 같다). 날짜순 영역은 정렬이 없으면 최근 날짜부터.
  function arrange(a,items,cols,skip=''){
    const id=a.id,on=colOn(id).filter(([k])=>k!==skip),by=new Map(cols.map(c=>[c.key,c]));
    const out=on.length?items.filter(r=>on.every(([k,vals])=>!by.has(k)||vals.includes(by.get(k).text(r)))):items;
    if(skip)return out;
    const {col,dir}=sortOf(id),c=col&&by.get(col);
    return c?sortBy(out,c.sortv,dir):viewKind(a)==='timeline'?sortBy(out,r=>String(r.date||''),'desc'):out;
  }
  const nameColumn=id=>({key:'name',label:NAME_HEAD[id]||'이름',text:r=>String(r.label||''),sortv:r=>String(r.label||''),align:'l'});
  // 있는 과목은 이름 앞, 날짜는 그 영역의 날짜 이름. 폭이 모자라도 열은 버리지 않고 가로로 넘긴다.
  function familyColumns(a,basis){
    const id=a.id,dn=dateName(id),labels=[],sample=[...previews(id),...basis.slice(0,300)];
    for(const r of basis)for(const f of r.fields||[])if(f?.label&&f.label!==dn&&f.label!=='과목'&&!labels.includes(f.label))labels.push(f.label);
    const cols=[...(basis.some(r=>subjectOf(r))?[{key:'subject',label:'과목'}]:[]),{key:'detail',label:detailName(id)},{key:'status',label:'상태',chip:true},...(dn?[{key:'date',label:dn}]:[]),...labels.map(l=>({key:`f:${l}`,label:l}))]
      .filter(c=>basis.some(r=>cellText(r,c.key)))
      .map(c=>{const vs=sample.map(r=>cellText(r,c.key)).filter(Boolean);return {...c,vs,money:vs.length>0&&vs.every(v=>MONEY.test(v)),text:r=>cellText(r,c.key),sortv:r=>sortValue(r,c.key),...(c.chip?{html:r=>r.status?`<span class="ax-chip ws-cut">${h(r.status)}</span>`:''}:{})};});
    return [...cols.filter(c=>!c.money),...cols.filter(c=>c.money)];
  }
  // 열 모양 = 값으로 정한다: 금액 오른쪽 · 짧은 값(8자 이하) 가운데 · 긴 글 왼쪽. 짧은 열은 가장 긴 값에 맞춰 고정(목록마다 기억 — 쪽을 넘겨도 줄지 않는다),
  // 긴 글 열은 남는 폭을 나눈다. 다 고정이면 남는 폭은 맨 끝 빈 열이 받는다(열이 오른쪽으로 흩어지지 않게). min = 표가 더 줄지 않는 폭(그보다 좁으면 가로로 민다).
  function sizeColumns(key,cols,sample,{nameLabel='이름',head=true,nameFlex=false}={}){
    const memo=state.colw[key]||(state.colw[key]={}),fit=(k,em)=>{const old=memo[k];return (memo[k]=old===-1||em===-1?-1:Math.max(old||0,em));};
    const headEm=label=>head?emOf(label)+3.6:0; // 머리 = 글 + 여백 + 펼침 표시 + 정렬 표시(▲▼ · ●)가 붙어도 잘리지 않게
    const shaped=cols.map(c=>{
      const vs=sample.map(r=>c.text(r)).filter(Boolean),wide=vs.reduce((n,v)=>Math.max(n,emOf(v)),0);
      const align=memo[`a:${c.key}`]||(memo[`a:${c.key}`]=c.align||(c.money?'r':!vs.length?'':vs.every(v=>v.length<=8)?'c':'l'));
      const em=fit(c.key,c.key!=='subject'&&wide>12?-1:Math.max(headEm(c.label),wide+(c.chip?2.2:1.4),3));
      return {...c,align:align||'c',w:em===-1?'':`${em.toFixed(1)}em`};
    });
    // 이름이 길면: 다른 긴 글 열이 있으면 남는 폭을 함께 나누고, 없으면 22em까지만(짧은 열이 오른쪽 끝으로 밀려나지 않게 — 남는 폭은 끝 빈 열이).
    const nameWide=sample.reduce((n,r)=>Math.max(n,emOf(r.label)),0)+1.4,flexOther=shaped.some(c=>!c.w);
    const nem=nameFlex?-1:fit('name',nameWide>13&&flexOther?-1:Math.max(headEm(nameLabel),Math.min(22,nameWide),4));
    const name={w:nem===-1?'':`${nem.toFixed(1)}em`},filler=Boolean(name.w)&&shaped.every(c=>c.w);
    return {cols:shaped,name,filler,min:[name.w,...shaped.map(c=>c.w)].reduce((n,w)=>n+(w?parseFloat(w):7),0)};
  }
  // menu = 정렬·거르기를 받는 목록(작업 공간 영역 id) — 없으면 머리는 이름만. group = 줄 묶음 띠(날짜순의 달).
  function tableHtml({shape,rows,nameLabel='이름',main,attrs=()=>'',menu='',group=null,head=true,cls='',key='',details=null}){
    const {cols,name,filler}=shape,subject=cols.find(c=>c.key==='subject'),rest=cols.filter(c=>c.key!=='subject'),sort=menu?sortOf(menu):{col:'',dir:''},on=new Set(menu?colOn(menu).map(([k])=>k):[]),span=cols.length+1+(filler?1:0);
    const th=c=>{const al=c.align||'l';
      if(!menu)return `<th scope="col" class="al-${al}"><span class="ws-cut">${h(c.label)}</span></th>`;
      const dir=sort.col===c.key?sort.dir:'',f=on.has(c.key),open=colMenu.id===menu&&colMenu.col===c.key;
      return `<th scope="col" class="al-${al}" aria-sort="${dir==='asc'?'ascending':dir==='desc'?'descending':'none'}"><button type="button" class="ws-th${dir||f?' on':''}" data-ws="col" data-id="${h(menu)}" data-col="${h(c.key)}" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${h(c.label)} 정렬·거르기${dir?` (${dir==='asc'?'오름차순':'내림차순'})`:''}${f?' (거르는 중)':''}"><span>${h(c.label)}</span>${dir?`<b class="ws-th-mark" aria-hidden="true">${dir==='asc'?'▲':'▼'}</b>`:''}${f?'<b class="ws-th-mark" aria-hidden="true">●</b>':''}<i class="ws-th-caret" aria-hidden="true">${icon('down')}</i></button></th>`;};
    const col=c=>`<col${c.w?` style="width:${c.w}"`:''}>`;
    const colgroup=`<colgroup>${subject?col(subject):''}<col${name.w?` style="width:${name.w}"`:''}>${rest.map(col).join('')}${filler?'<col>':''}</colgroup>`;
    const thead=head?`<thead><tr>${subject?th(subject):''}${th({key:'name',label:nameLabel,align:'l'})}${rest.map(th).join('')}${filler?'<th class="ws-fill" aria-hidden="true"></th>':''}</tr></thead>`:'';
    let last;
    const body=rows.map(r=>{const g=group?group(r):undefined,band=group&&g!==last?`<tr class="ws-band"><th scope="rowgroup" colspan="${span}">${h(g)}</th></tr>`:'';last=g;
      const td=c=>`<td class="al-${c.align}">${c.html?c.html(r):`<span class="ws-cut">${h(c.text(r))}</span>`}</td>`;
      const detail=details?.(r)||'',expanded=Boolean(detail&&state.expanded[menu]?.has(String(r.id)));
      const toggle=detail?`<button type="button" class="ws-expand" id="ws-expand-${h(menu)}-${h(r.id)}" data-ws="expand" data-id="${h(menu)}" data-record="${h(r.id)}" aria-expanded="${expanded}" aria-label="${h(r.label)} 상세 수납 ${expanded?'접기':'펼치기'}">${icon(expanded?'down':'chevron')}</button>`:'';
      return `${band}<tr${attrs(r)}>${subject?td(subject):''}<th scope="row">${toggle}${main(r)}</th>${rest.map(td).join('')}${filler?'<td class="ws-fill"></td>':''}</tr>${expanded?`<tr class="ws-detail-row"><td colspan="${span}">${detail}</td></tr>`:''}`;}).join('');
    return `<div class="ws-tablewrap live-scroll"${key?` data-scroll-key="${h(key)}"`:''}><table class="ws-table${subject?' ws-has-subject':''}${cls}"${shape.min?` style="min-width:${shape.min.toFixed(1)}em;--ws-subject-width:${subject?.w||'7em'}"`:''}>${colgroup}${thead}<tbody>${body}</tbody></table></div>`;
  }
  const rowMain=(id,r)=>{const n=localCount(id,r.id);return `<span class="ws-namecell"><button type="button" class="ws-rowmain ws-cut" data-ws="record" data-id="${h(id)}" data-record="${h(r.id)}">${h(r.label)}</button>${n?pill(`미리보기 ${n}`,'green'):''}</span>`;};
  const rowAttrs=id=>r=>` data-record="${h(r.id)}"${curAttr(id,r.id)}`;
  function billingDetails(lines){
    if(!Array.isArray(lines)||!lines.length)return '';
    const exact=v=>v===null||v===undefined?'—':`${Number(v).toLocaleString('ko-KR')}원`;
    const row=(line,source=false)=>`<tr${source?' class="ws-billing-source"':''}><th scope="row">${source?'합산 전 · ':''}${h(line.description||'수납명 없음')}</th><td>${h(line.kind||'기타')}</td><td>${exact(line.amount)}</td><td>${line.discount?exact(line.discount):'—'}</td><td>${line.points?exact(line.points):'—'}</td><td>${exact(line.paid)}</td><td>${exact(line.unpaid)}</td></tr>`;
    return `<div class="ws-billing-detail"><strong>상세 수납</strong><div class="ws-billing-scroll live-scroll" tabindex="0"><table aria-label="상세 수납"><thead><tr><th>수납명</th><th>구분</th><th>청구액</th><th>할인액</th><th>적립금</th><th>수납</th><th>남은 금액</th></tr></thead><tbody>${lines.map(line=>row(line)+(line.sourceItems||[]).map(source=>row(source,true)).join('')).join('')}</tbody></table></div></div>`;
  }
  function recordsTable(a,ld){
    const id=a.id,sort=sortOf(id),nameLabel=NAME_HEAD[id]||'이름',shape=sizeColumns(id,ld.cols,[...previews(id),...ld.rows],{nameLabel});
    // 날짜순 영역 = 날짜로 볼 때(기본) 달마다 띠 — 열은 모든 달이 같다. 날짜가 없는 목록은 묶지 않는다.
    const monthOf=r=>{const m=String(r.date||'').slice(0,7);return /^\d{4}-\d{2}$/.test(m)?api.yymm(m):'날짜 없음';};
    const group=viewKind(a)==='timeline'&&(!sort.col||sort.col==='date')&&ld.rows.some(r=>r.date)?monthOf:null;
    return tableHtml({shape,rows:ld.rows,nameLabel,main:r=>rowMain(id,r),attrs:rowAttrs(id),menu:id,group,key:`list-${id}`,details:id==='billing'?r=>billingDetails(r.lines):null});
  }
  // 걸러 보는 조건 = 목록 위 칩. 누르면 그 열의 거르기만 지운다(값이 없어 줄이 다 사라져도 여기서 풀 수 있다).
  function colChips(id){
    const on=colOn(id);if(!on.length)return '';
    const label=k=>(state.lcols[id]||[]).find(c=>c.key===k)?.label||'',few=v=>{const t=v.map(x=>x||'빈 칸');return t.length>2?`${t.slice(0,2).join(', ')} 외 ${fmt(t.length-2)}`:t.join(', ')||'없음';};
    return `<div class="ws-colchips" role="group" aria-label="걸러 보는 조건">${on.map(([k,v])=>`<button type="button" data-ws="col-clear" data-id="${h(id)}" data-col="${h(k)}" aria-label="${h(label(k))} 거르기 지우기"><span>${h(label(k))}: ${h(few(v))}</span>${icon('close')}</button>`).join('')}</div>`;
  }
  // 쪽 번호(업무 흐름 표와 같은 모양) — 20건씩, 목록 바로 아래.
  function pagerHtml(id,page,pages){
    const nums=pages<=7?Array.from({length:pages},(_,i)=>i+1):[...new Set([1,...[page-1,page,page+1].filter(n=>n>1&&n<pages),pages])].reduce((acc,n)=>{if(acc.length&&n-acc.at(-1)>1)acc.push('…');acc.push(n);return acc;},[]);
    const go=(n,label,attrs='')=>`<button type="button" data-ws="page" data-id="${h(id)}" data-page="${n}" ${attrs}>${label}</button>`;
    return `<nav class="ws-pager" aria-label="쪽 이동">${go(page-1,'‹ 이전',`aria-label="이전 쪽" ${page<=1?'disabled':''}`)}${nums.map(n=>n==='…'?'<span aria-hidden="true">…</span>':go(n,n,n===page?'aria-current="page"':`aria-label="${n}쪽"`)).join('')}${go(page+1,'다음 ›',`aria-label="다음 쪽" ${page>=pages?'disabled':''}`)}</nav>`;
  }
  /** 공통 리스트를 다른 화면에서(수납관리 '수납 리스트' 등) — 작업 공간 목록과 같은 표 · 열 머리 정렬·값 거르기 · 거르기 칩 · 검색 · 쪽(20건).
      rows = 그 화면의 줄 전부(이름 = r.label) · columns = [{key,label,text(r),sortv?(r),money?,chip?,align?}] ·
      main(r) = 이름 칸 단추 HTML(class="ws-rowmain ws-cut" + 그 화면의 여는 속성 — 줄 어디를 눌러도 이 단추가 눌린다) ·
      sort = 처음 정렬({col,dir} · 머리에 ▲▼로 보인다) · repaint = 정렬·거르기·검색·쪽이 바뀌면 그 화면을 다시 그리는 함수 ·
      key = 이 목록의 이름(정렬·거르기·쪽·열 너비를 기억한다). 줄 묶음이 바뀌면(다른 달 등) 첫 쪽으로. */
  function listTable({key,columns,rows,nameLabel='이름',main,sort=null,repaint,search=false,empty='조건에 맞는 기록이 없습니다.',details=null}){
    const name={key:'name',label:nameLabel,text:r=>String(r.label||''),sortv:r=>String(r.label||''),align:'l'};
    const cols=columns.map(c=>{const vs=rows.map(r=>c.text(r)).filter(Boolean);return {...c,money:c.money??(vs.length>0&&vs.every(v=>MONEY.test(v))),sortv:c.sortv||(r=>rawSort(c.text(r))),...(c.chip&&!c.html?{html:r=>{const t=c.text(r);return t?`<span class="ax-chip ws-cut">${h(t)}</span>`:'';}}:{})};});
    const all=[name,...cols],q=norm(state.q[key]),found=q?rows.filter(r=>norm(all.map(c=>c.text(r)).join(' ')).includes(q)):rows,sig=`${rows.length}|${rows[0]?.id??''}|${rows.at(-1)?.id??''}`;
    if(LOCAL.get(key)?.sig!==undefined&&LOCAL.get(key).sig!==sig)state.page[key]=1;
    LOCAL.set(key,{rows:found,repaint,sig});state.lcols[key]=all;
    if(sort&&!(key in state.sort))state.sort[key]=sort;
    const out=arrange({id:key},found,all),pages=Math.max(1,Math.ceil(out.length/PAGE_SIZE)),page=Math.min(state.page[key]||1,pages),shown=out.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    const shape=sizeColumns(key,cols,rows.slice(0,300),{nameLabel}),narrowed=Boolean(q||colOn(key).length);
    const box=search?`<div class="ws-search"><input type="search" id="wsl-q-${h(key)}" data-wsl-q="${h(key)}" value="${h(state.q[key]||'')}" maxlength="100" aria-label="${h(nameLabel)}·내용 검색" placeholder="이름·내용·상태 검색" autocomplete="off"><span>${narrowed?`찾은 기록 ${fmt(out.length)}건`:''}</span></div>`:'';
    const table=shown.length?tableHtml({shape,rows:shown,nameLabel,main,menu:key,key:`list-${key}`,details}):`${colOn(key).length?tableHtml({shape,rows:[],nameLabel,main,menu:key}):''}<div class="live-empty"><strong>${h(empty)}</strong></div>`;
    return `<div class="ws-locallist" data-list-key="${h(key)}">${box}${colChips(key)}${table}${pages>1?pagerHtml(key,page,pages):''}</div>`;
  }
  // 다른 화면 목록을 다시 그린다(그 화면의 repaint) — 열 머리 메뉴는 새 머리 칸을 따라간다.
  function repaintLocal(id){LOCAL.get(id)?.repaint?.();if(colMenu.el)placeColMenu();}
  // 칸반: 단계마다 그 단계의 첫 기록(따로 읽은 것 · 못 읽었으면 불러온 기록 중 그 단계). 건수가 칸 안보다 많으면 '모두 보기' = 그 단계로 걸러 본다.
  // 칸 안 = 공통 리스트의 줄(머리 없이) — 이름 | 내용 | 날짜가 모든 칸에서 같은 자리.
  function flowView(a,items){
    const id=a.id,stages=stagesOf(a),slot=state.board[id],ready=slot?.status==='ready',pid=state.pin[id],pinned=pid?recordById(id,pid):null;
    const inStage=(r,f)=>(r.facetIds||[]).includes(f.id);
    const col=f=>{let list=ready?slot.cols.get(f.id)||[]:items.filter(r=>inStage(r,f));if(pinned&&inStage(pinned,f))list=[pinned,...list.filter(r=>String(r.id)!==String(pid))];return list.slice(0,BOARD_SIZE);};
    const exclusive=stages.every(f=>dimension(f.id)),total=Number(data(id)?.totalRecords)||0,looseCount=exclusive?Math.max(0,total-stages.reduce((n,f)=>n+(f.count||0),0)):0;
    const looseOf=r=>!stages.some(f=>inStage(r,f)),loose=looseCount?[...(pinned&&looseOf(pinned)?[pinned]:[]),...items.filter(r=>looseOf(r)&&String(r.id)!==String(pid))].slice(0,BOARD_SIZE):[];
    // 칸이 좁아(약 240px) 이름과 내용이 남는 폭을 나누고 날짜만 고정한다 — 내용은 왼쪽, 날짜는 오른쪽 끝.
    const basis=[...boardItems(id),...items,...(pinned?[pinned]:[])],shape=sizeColumns(`board:${id}`,familyColumns(a,basis).filter(c=>c.key==='detail'||c.key==='date').map(c=>({...c,align:c.key==='date'?'r':'l'})),basis,{head:false,nameFlex:true});
    shape.cols=shape.cols.map(c=>c.key==='detail'?{...c,w:''}:c);shape.min=0;
    const rowsOf=list=>tableHtml({shape,rows:list,main:r=>rowMain(id,r),attrs:rowAttrs(id),head:false,cls:' ws-mini'});
    const stage=(f,i)=>{const list=col(f),n=f.count??list.length;
      const rows=list.length?rowsOf(list):n?(slot?.status==='loading'?'<p>불러오는 중입니다.</p>':''):'<p>기록이 없습니다.</p>';
      const more=n>list.length?`<button type="button" class="ws-stage-more" data-ws="facet" data-id="${h(id)}" data-facet="${h(f.id)}">${list.length?`${fmt(n)}건 모두 보기`:`${fmt(n)}건 보기`}</button>`:'';
      return `<section class="ws-stage"><header><span>${i+1}</span><h3>${h(f.label)}</h3>${f.count!==null&&f.count!==undefined?`<b>${fmt(f.count)}</b>`:''}</header>${rows}${more}</section>`;};
    return `<div class="ws-flow" aria-label="단계별 흐름">${stages.map(stage).join('')}${loose.length?`<section class="ws-stage"><header><span>·</span><h3>단계 미지정</h3><b>${fmt(looseCount)}</b></header>${rowsOf(loose)}</section>`:''}</div>`;
  }
  function sheetView(a,items){
    const dn=dateName(a.id),hasSubject=items.some(r=>subjectOf(r)),hasDate=Boolean(dn&&items.some(r=>r.date)),hasStatus=items.some(r=>!blank(r.status));
    const cols=[...new Set(items.flatMap(r=>(r.fields||[]).map(f=>f.label).filter(l=>l&&l!=='과목'&&l!==dn)))],edits=state.edits[a.id]||{},changed=Object.values(edits).reduce((n,row)=>n+Object.keys(row).length,0);
    const cell=(r,c)=>{const original=(r.fields||[]).find(f=>f.label===c)?.value??'—',value=edits[r.id]?.[c];return `<td><button type="button" class="ws-cell ${value!==undefined?'changed':''}" data-ws="cell" data-id="${h(a.id)}" data-record="${h(r.id)}" data-col="${h(c)}" aria-label="${h(r.label)} ${h(c)} ${h(value??original)} · Enter로 수정">${h(value??original)}</button></td>`;};
    // 바꾼 칸은 저장되지 않는다는 것만 바꾼 뒤에 알린다(고치는 법 안내 줄은 싣지 않는다).
    return `<div class="ws-sheet live-scroll" data-scroll-key="sheet-${h(a.id)}" tabindex="0"><table class="${hasSubject?'ws-has-subject':''}"><thead><tr>${hasSubject?'<th scope="col" class="ws-subject-head">과목</th>':''}<th scope="col">${h(NAME_HEAD[a.id]||'이름')}</th>${hasDate?`<th scope="col">${h(dn)}</th>`:''}${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}${hasStatus?'<th scope="col">상태</th>':''}</tr></thead><tbody>${items.map(r=>`<tr${curAttr(a.id,r.id)}>${hasSubject?`<td class="ws-subject-cell">${h(subjectOf(r)||'—')}</td>`:''}<th scope="row"><button type="button" class="ws-row-head" data-ws="record" data-id="${h(a.id)}" data-record="${h(r.id)}">${h(r.label)}</button></th>${hasDate?`<td>${h(dateText(r.date)||'—')}</td>`:''}${cols.map(c=>cell(r,c)).join('')}${hasStatus?`<td>${r.status?pill(r.status):'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>${changed?`<div class="ws-sheet-bar"><span>바꾼 칸 ${changed}개 · 저장되지 않습니다</span>${btn('되돌리기','sheet-reset',`data-id="${h(a.id)}"`)}${btn('변경분 미리보기 저장','sheet-save',`data-id="${h(a.id)}"`,true)}</div>`:''}`;
  }
  // 기록 한 건의 사실 = 칩(상태 · 걸러보기 구분) + 열 이름·값. 칩·칸이 같은 사실을 두 번 말하지 않는다(원장 10-28 '재원·재원' · '침산초 초5' + 학교/학년 줄).
  function studentClasses(id){
    const s=(db.students||[]).find(x=>String(x.id)===String(id));if(!s)return '';
    return (s.classes||[]).map(k=>(db.classes||[]).find(c=>String(c.id)===String(k))?.name).filter(Boolean).join(', ');
  }
  function recordFacts(a,r){
    const rows=[],dn=dateName(a.id),d=detailOf(r),fields=(r.fields||[]).filter(f=>f&&f.label&&!blank(f.value));
    if(subjectOf(r))rows.push(['과목',shownValue(subjectOf(r))]);
    if(d)rows.push([detailName(a.id),shownValue(d)]);
    if(dn&&r.date&&!fields.some(f=>f.label===dn))rows.push([dn,dateText(r.date)]);
    fields.filter(f=>f.label!=='과목').forEach(f=>rows.push([String(f.label),shownValue(f.value)]));
    if(a.id==='students'&&!rows.some(([l])=>l==='반')){const cls=studentClasses(r.id);if(cls)rows.push(['반',cls]);}
    return rows;
  }
  function recordChips(a,r,rows){
    const said=new Set([r.status,r.detail,...rows.flat()].map(norm).filter(Boolean));
    const labels=[...new Set((r.facetIds||[]).map(f=>facetsOf(a).find(x=>x.id===f)?.label).filter(Boolean))].filter(l=>!said.has(norm(l)));
    return [r.status?pill(r.status):'',...labels.map(l=>pill(l))].join('');
  }
  const factsHtml=(a,r)=>{const rows=recordFacts(a,r),chips=recordChips(a,r,rows);return `${chips?`<div class="ax-issue-meta">${chips}</div>`:''}${rows.length?`<dl>${rows.map(([l,v])=>`<dt>${h(l)}</dt><dd>${h(v)}</dd>`).join('')}</dl>`:''}`;};
  // Settings faces are the catalog's faces (2.0 setting surfaces); their forms are the actions that target the face.
  function settingsView(a){
    const faces=screensOf(a).length?screensOf(a):[{id:'',label:'설정'}],face=faces.find(f=>f.id===state.face[a.id])||faces[0];
    const forms=actionsOf(a).filter(x=>x.mode==='preview'&&(face.id?targetOf(x).facet===face.id:!targetOf(x).facet));
    const related=actionsOf(a).filter(x=>x.mode!=='preview'&&face.id&&targetOf(x).facet===face.id);
    return `<div class="ws-settings"><nav class="ws-faces live-scroll" data-scroll-key="faces-${h(a.id)}" aria-label="설정 면">${faces.map(f=>`<button type="button" data-ws="face" data-id="${h(a.id)}" data-face="${h(f.id)}" aria-pressed="${f===face}">${h(f.label)}</button>`).join('')}</nav><div class="ws-face"><h3>${h(face.label)}</h3>${related.length?`<div class="ax-actions">${related.map(x=>`<button type="button" class="button" data-ws="action" data-id="${h(a.id)}" data-action="${h(x.id)}">${h(x.label)}</button>`).join('')}</div>`:''}${forms.length?forms.map(x=>`<section class="ws-inline-form"><h4>${h(x.label)}</h4>${previewForm(a,x,'',true)}</section>`).join(''):''}</div></div>`;
  }

  /* ---------- actions: preview forms, owner request drafts, navigation ---------- */
  // Preview and navigate actions carry their own one-line description in draft.body; a request's draft.body is the request text itself.
  const actionIntent=x=>{
    const note=x.mode!=='request'&&typeof x.draft?.body==='string'?x.draft.body.trim():'',fields=(Array.isArray(x.fields)?x.fields:[]).some(f=>f&&f.id&&f.label);
    if(x.mode==='preview')return note||(fields?'입력 칸을 채워 기록합니다.':'메모로 기록합니다.');
    return x.mode==='navigate'?note||'관련 화면으로 이동합니다.':'담당자에게 보낼 요청 초안을 엽니다.';
  };
  function actionPanel(a){
    const list=actionsOf(a),screen=screensOf(a).find(sc=>sc.id===state.screen[a.id]),focus=screen?screenActions(a,screen.id):[];
    const groups=['preview','request','navigate'].map(m=>[m,list.filter(x=>!focus.includes(x)&&(MODE[x.mode]?x.mode:'request')===m)]).filter(([,xs])=>xs.length);
    const item=x=>`<button type="button" class="ws-action" data-ws="action" data-id="${h(a.id)}" data-action="${h(x.id)}"><strong>${h(x.label)}</strong><small>${h(actionIntent(x))}</small></button>`;
    return `<section class="ws-actions" aria-label="이 화면에서 할 수 있는 일"><h2>할 수 있는 일 ${list.length}가지</h2>${focus.length?`<div class="ws-action-group focus"><h3>‘${h(screen.label)}’ 화면의 작업</h3>${focus.map(item).join('')}</div>`:''}${groups.map(([m,xs])=>`<div class="ws-action-group"><h3>${MODE[m].label}</h3>${xs.map(x=>`<button type="button" class="ws-action" data-ws="action" data-id="${h(a.id)}" data-action="${h(x.id)}"><strong>${h(x.label)}</strong><small>${h(actionIntent(x))}</small></button>`).join('')}</div>`).join('')||'<p class="ax-note">이 영역에 정의된 작업이 없습니다.</p>'}</section>`;
  }
  function fieldHtml(a,x,f,recordId,scope){
    const id=`ws-f-${scope}-${a.id}-${x.id}-${f.id}`.replace(/[^\w-]/g,'_'),req=f.required?'required':'',label=`<span>${h(f.label)}${f.required?' <em aria-hidden="true">*</em>':''}</span>`;
    const options=type=>type==='record'?visibleRecords(a.id).items.map(r=>({value:String(r.id),label:r.label})):type==='staff'?db.staff.map(s=>({value:s.id,label:`${s.name} · ${s.title}`})):type==='class'?db.classes.map(c=>({value:c.id,label:`${c.name} · ${c.teacher}`})):type==='subject'?[...new Set(db.classes.map(c=>c.subject).filter(Boolean))].map(v=>({value:v,label:api.subjectLabel?.(v)||v})):(f.options||[]).map(o=>typeof o==='object'?{value:String(o.value??o.id??o.label),label:String(o.label??o.value)}:{value:String(o),label:String(o)});
    const t=f.type||'text';
    if(window.ContextPicker&&['student','staff','class','record'].includes(t))return pickerField(a,f,t,id,recordId,scope);
    if(t==='textarea')return `<label for="${id}">${label}<textarea id="${id}" name="${h(f.id)}" rows="3" maxlength="2000" ${req}></textarea></label>`;
    if(t==='checkbox'||t==='boolean')return `<label class="ws-check" for="${id}"><input type="checkbox" id="${id}" name="${h(f.id)}" value="예"> ${h(f.label)}</label>`;
    if(t==='student')return `<label for="${id}">${label}<input id="${id}" name="${h(f.id)}" list="ws-students" autocomplete="off" maxlength="60" placeholder="이름 입력 후 목록에서 선택" ${req}><small>재원생 목록에서 선택합니다.</small></label>`;
    // 일반 고르기·과목·여러 개 고르기도 공용 선택창(원장 10-28 "모든 드랍다운 … 서식 일치"). 값과 이름(name)은 그대로라 저장 쪽은 바뀌지 않는다.
    if(window.ContextPicker&&['select','subject','multiselect'].includes(t)){const CP=window.ContextPicker,opts=options(t==='multiselect'?'select':t);try{return CP.html({id,name:f.id,label:f.label,required:!!f.required,multiple:t==='multiselect',clearable:!f.required,...CP.lists.choices({items:opts.map(o=>({value:o.value,title:o.label})),columns:[{key:'name',label:f.label}]})});}catch{}}
    if(['select','record','staff','class','subject'].includes(t)){const opts=options(t);return `<label for="${id}">${label}<select id="${id}" name="${h(f.id)}" ${req}><option value="">선택</option>${opts.map(o=>`<option value="${h(o.value)}" ${t==='record'&&String(recordId)===o.value?'selected':''}>${h(o.label)}</option>`).join('')}</select>${t==='record'&&!opts.length?'<small>선택할 기록이 없습니다.</small>':''}</label>`;}
    if(t==='multiselect'){const opts=options('select');return `<fieldset class="ws-multi"><legend>${label}</legend>${opts.map(o=>`<label><input type="checkbox" name="${h(f.id)}" value="${h(o.value)}"> ${h(o.label)}</label>`).join('')}</fieldset>`;}
    const html={number:'number',money:'number',amount:'number',date:'date',time:'time',month:'month'}[t]||'text';
    const lo=Number.isFinite(Number(f.min))?Number(f.min):0,hi=Number.isFinite(Number(f.max))?Number(f.max):null;
    return `<label for="${id}">${label}<input id="${id}" name="${h(f.id)}" type="${html}" ${html==='number'?`step="any" min="${lo}" ${hi!==null?`max="${hi}"`:''}`:''} ${html==='text'?'maxlength="200"':''} ${req}>${t==='money'||t==='amount'?'<small>원 단위</small>':hi!==null?`<small>${lo}~${hi}</small>`:''}</label>`;
  }
  // Decision fields (student · staff · class · record) use the shared ContextPicker (context-picker.js): the form value is
  // the verified id and each row shows who or which it is. Inline settings forms keep their pick across a records
  // refresh; a modal form starts from the record it was opened for.
  function pickerField(a,f,t,id,recordId,scope){
    const CP=window.ContextPicker,inline=scope==='i';
    const list=t==='student'?CP.lists.students({db}):t==='staff'?CP.lists.staff({db,subjectLabel:api.subjectLabel}):t==='class'?CP.lists.classes({db,subjectLabel:api.subjectLabel}):recordList(a,recordId);
    return CP.html({id,name:f.id,label:f.label,required:Boolean(f.required),empty:`${f.label} 선택`,persist:inline,...(inline?{}:{selected:t==='record'&&recordId?[String(recordId)]:[]}),...list});
  }
  // Record choices: the loaded page first (labeled as such), the whole family through the read-only records endpoint.
  // Billing rows join the copy's invoice by id; otherwise the record's own amounts (청구액 · 수납 · 남은 금액) are shown.
  const amount=v=>{const t=String(v??'').trim(),n=Number(t.replace(/[^\d.-]/g,''));return t&&t!=='—'&&Number.isFinite(n)?n:undefined;};
  const invoiceRow=r=>{const fv=l=>(r.fields||[]).find(x=>x.label===l)?.value;return {id:r.id,name:r.label,period:r.detail||'',total:amount(fv('청구액')),paid:amount(fv('수납')),remaining:amount(fv('남은 금액'))};};
  function recordList(a,recordId){
    const CP=window.ContextPicker,vis=visibleRecords(a.id),picked=recordId?recordById(a.id,recordId):null;
    const items=[...(picked&&!vis.items.some(r=>String(r.id)===String(recordId))?[picked]:[]),...vis.items],billing=a.id==='billing';
    const out=billing?CP.lists.invoices({db,items:items.map(invoiceRow)}):CP.lists.records({items,familyLabel:a.label});
    const toOptions=list=>billing?CP.lists.invoices({db,items:list.map(invoiceRow)}).options:list.map(out.option);
    const total=Math.max(Number(vis.total)||0,items.length);
    const remote=state.unsupported?null:{load:async(q,{signal})=>{
      const params=new URLSearchParams({q:q.slice(0,100),page:'1',pageSize:'50'});
      const res=await fetch(`/api/workspaces/${encodeURIComponent(a.id)}/records?${params}`,{headers:{Accept:'application/json'},signal});
      let json=null;try{json=await res.json();}catch{/* not served here */}
      if(!res.ok||!json||!Array.isArray(json.items))throw new Error(typeof json?.message==='string'?json.message:'전체 기록을 불러오지 못했습니다. 불러온 목록에서만 찾습니다.');
      return {options:toOptions(json.items),filtered:Number(json.filteredTotal)||json.items.length};
    }};
    return {...out,remote,note:total>items.length?`불러온 ${items.length}건 표시 · 전체 ${total.toLocaleString('ko-KR')}건은 검색어로 찾습니다`:`${items.length}건`};
  }
  function previewForm(a,x,recordId='',inline=false,kind='preview'){
    const fields=Array.isArray(x.fields)?x.fields.filter(f=>f&&f.id&&f.label):[];
    if(!window.ContextPicker&&fields.some(f=>f.type==='student')&&!document.getElementById('ws-students'))document.body.insertAdjacentHTML('beforeend',`<datalist id="ws-students">${db.students.filter(s=>s.status==='enrolled').map(s=>`<option value="${h(`${s.name} · ${s.school} ${s.grade}`)}"></option>`).join('')}</datalist>`);
    return `<form class="ws-form" data-ws-form="${kind}" data-id="${h(a.id)}" data-action="${h(x.id)}" ${inline?'data-inline="1"':''} novalidate>${fields.map(f=>fieldHtml(a,x,f,recordId,inline?'i':'m')).join('')||'<label>메모<textarea name="__note" rows="2" maxlength="500"></textarea></label>'}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot">${kind==='request'?'':'<span class="ax-note">저장되지 않습니다.</span>'}<button class="button primary" type="submit">${kind==='request'?'요청서로 이어 쓰기':'미리보기로 기록'}</button></div></form>`;
  }
  const FIRST_CONTROL='#modal .ws-form :is(input:not([type=hidden]):not([data-cpick-search]),select,textarea,.cpick-trigger)';
  function openAction(familyId,actionId,recordId=''){
    const a=area(familyId),x=a&&actionsOf(a).find(y=>y.id===actionId);if(!x)return;
    if(x.mode==='navigate'){const {page,facet}=targetOf(x),dest=resolvePage(page);if(!dest){toast('이동할 화면을 찾지 못했습니다.');return;}const fam=familyOf(dest),tgt=fam&&area(fam);if(tgt&&facet){if(facetsOf(tgt).some(f=>f.id===facet)){state.facet[fam]=facet;state.page[fam]=1;}else if(screensOf(tgt).some(f=>f.id===facet)){if(viewKind(tgt)==='settings')state.face[fam]=facet;else state.screen[fam]=facet;}}navigate(dest);return;}
    if(x.mode==='preview'){dialog('modal',x.label,`${a.label} · 미리보기`,`${recordId?`<p class="ws-context">기록: ${h(recordById(familyId,recordId)?.label||'')}</p>`:''}<p class="ax-note">${h(actionIntent(x))}</p>${previewForm(a,x,recordId)}`);$(FIRST_CONTROL)?.focus();return;}
    const r=recordId?recordById(familyId,recordId):null;
    if((x.fields||[]).some(f=>f&&f.id&&f.label)){dialog('modal',x.label,`${a.label} · 요청에 담을 내용`,`${r?`<p class="ws-context">기록: ${h(r.label)}</p>`:''}<p class="ax-note">${h(actionIntent(x))}</p>${previewForm(a,x,recordId,false,'request')}`);$(FIRST_CONTROL)?.focus();return;}
    requestFrom(a,{title:x.draft?.title||x.label,body:x.draft?.body||`${a.label}에서 ‘${x.label}’ 작업을 처리하고 결과를 보고해 주세요.`,action:x.id,records:r?[r]:[]});
  }
  function requestFrom(a,{title,body,action='',signal='',records=[]}){
    const recordLines=records.length?`\n\n확인 대상: ${records.map(r=>r.label).join(', ')}`:'';
    ax.showRequest({title,body:`${body}${recordLines}`,source:'workspace',draftKey:`ws:${a.id}:${action||signal||(records[0]?.id||'direct')}`,context:{family:a.id,familyLabel:a.label,records:records.map(r=>({id:String(r.id),label:String(r.label)})),signal,action}});
  }
  const studentText=s=>`${s.name} · ${s.school} ${s.grade}`;
  const studentFor=v=>db.students.find(s=>s.status==='enrolled'&&(s.id===v||studentText(s)===v));
  function validate(form,fields){
    const errors=[];
    fields.forEach(f=>{
      const values=new FormData(form).getAll(f.id).map(String).filter(v=>v.trim()),v=values[0]||'';
      if(f.required&&!values.length)errors.push(`${f.label} 칸을 입력해 주세요.`);
      const lo=Number.isFinite(Number(f.min))?Number(f.min):0,hi=Number.isFinite(Number(f.max))?Number(f.max):null;
      if(v&&['number','money','amount'].includes(f.type)&&!(Number.isFinite(Number(v))&&Number(v)>=lo&&(hi===null||Number(v)<=hi)))errors.push(hi===null?`${f.label} 칸은 ${lo} 이상의 숫자로 입력해 주세요.`:`${f.label} 칸은 ${lo}~${hi} 사이의 숫자로 입력해 주세요.`);
      if(v&&f.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(v))errors.push(`${f.label} 날짜 형식을 확인해 주세요.`);
      if(v&&f.type==='student'&&!studentFor(v))errors.push(`${f.label} 칸은 재원생 목록에서 선택해 주세요.`);
      if(v&&['select'].includes(f.type)&&Array.isArray(f.options)&&f.options.length&&!f.options.some(o=>String(typeof o==='object'?o.value??o.id??o.label:o)===v))errors.push(`${f.label} 선택지를 다시 선택해 주세요.`);
    });
    return errors;
  }
  function submitPreview(form,kind='preview'){
    const a=area(form.dataset.id),x=a&&actionsOf(a).find(y=>y.id===form.dataset.action);if(!x)return;
    const fields=Array.isArray(x.fields)?x.fields.filter(f=>f&&f.id&&f.label):[],errors=validate(form,fields),out=form.querySelector('.ax-form-error');
    if(errors.length){out.textContent=errors[0];const first=fields.find(f=>f.required&&!new FormData(form).getAll(f.id).some(v=>String(v).trim()));if(!(first&&window.ContextPicker?.focus(form,first.id)))(first?form.querySelector(`[name="${CSS.escape(first.id)}"]:not([type=hidden])`):form.querySelector('input:not([type=hidden]),select,textarea'))?.focus();return;}
    const values=new FormData(form),display=(f,v)=>f.type==='student'?(studentFor(v)?studentText(studentFor(v)):v):f.type==='subject'?api.subjectLabel?.(v)||v:f.type==='record'?recordById(a.id,v)?.label||window.ContextPicker?.label(form.querySelector(`[data-cpick-name="${CSS.escape(f.id)}"]`),v)||v:f.type==='staff'?db.staff.find(s=>s.id===v)?.name||v:f.type==='class'?db.classes.find(c=>c.id===v)?.name||v:f.type==='multiselect'||f.type==='select'?(f.options||[]).map(o=>typeof o==='object'?o:{value:o,label:o}).find(o=>String(o.value??o.id??o.label)===v)?.label||v:v;
    const entry={id:crypto.randomUUID(),actionId:x.id,label:x.label,result:resultLabel(x),at:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),recordId:String(fields.filter(f=>f.type==='record').map(f=>values.get(f.id)).find(Boolean)||''),values:fields.length?fields.map(f=>({label:f.label,value:values.getAll(f.id).map(v=>display(f,String(v))).join(', ')||(f.type==='checkbox'?'아니요':'—')})):[{label:'메모',value:String(values.get('__note')||'—')}]};
    if(kind==='request'){const r=entry.recordId?recordById(a.id,entry.recordId):null;form.closest('dialog')?.close();requestFrom(a,{title:x.draft?.title||x.label,body:`${x.draft?.body||`${a.label}에서 ‘${x.label}’ 작업을 처리하고 결과를 보고해 주세요.`}\n${entry.values.map(v=>`· ${v.label}: ${v.value}`).join('\n')}`,action:x.id,records:r?[r]:[]});return;}
    (state.local[a.id]||(state.local[a.id]=[])).unshift(entry);
    if(!form.dataset.inline)form.closest('dialog')?.close();else form.reset();
    refreshSide(a.id);refreshMain(a.id);toast(`‘${x.label}’ 미리보기를 이 화면에 기록했습니다. 저장되지는 않았습니다.`);
  }
  function localLog(a){
    const list=state.local[a.id]||[];if(!list.length)return '';
    return `<section class="ws-local" aria-label="이 화면에서 만든 미리보기"><h2>이 화면에서 만든 미리보기 ${list.length}건</h2><p class="ax-note">새로고침하면 사라집니다.</p>${list.map(e=>`<article><header><strong>${h(e.label)}</strong><small>${h(e.at)}</small></header><dl>${e.values.map(v=>`<dt>${h(v.label)}</dt><dd>${h(v.value)}</dd>`).join('')}</dl><div class="ax-actions">${btn('이 내용으로 요청','local-request',`data-id="${h(a.id)}" data-entry="${e.id}"`)}${btn('지우기','local-remove',`data-id="${h(a.id)}" data-entry="${e.id}"`)}</div></article>`).join('')}</section>`;
  }
  function linkedRequests(a){
    const list=ax.requestsFor?.(a.id)||[];if(!list.length)return '';
    return `<section class="ws-requests"><h2>이 화면에서 보낸 요청 ${list.length}건</h2>${list.map(r=>`<button type="button" class="ax-request-row" data-ax="request-detail" data-id="${r.id}"><span><strong>${h(r.title)}</strong><small>${h(r.owners.map(o=>db.staff.find(s=>s.id===o)?.name||'담당자').join(', '))} · ${h(r.due)}까지</small></span>${pill({requested:'확인 대기',working:'진행 중',done:'완료 보고'}[r.status],r.status==='done'?'green':'blue')}</button>`).join('')}</section>`;
  }
  function relations(a){const list=(a.relations||[]).filter(id=>id!==a.id&&has(id));return list.length?`<section class="ws-relations"><h2>함께 보는 화면</h2><div>${list.map(id=>`<a class="ws-link" href="${h(window.V2Screens?.target(id)||`#workspace-${id}`)}">${h(area(id).label)}</a>`).join('')}</div></section>`:'';} // 자기 화면은 빼고(원장 10-28), 2.0 화면이 있으면 그 화면으로
  // A record on the loaded list opens at once. One off it (a link from elsewhere) is read by its exact id first; the
  // dialog changes only on success, and an answer that arrives after the person moved on (another record asked for,
  // a different dialog, the dialog closed, another page, a form open) is dropped. Resolves 'shown', 'missing',
  // 'failed' or 'stale'.
  // pin = 다른 화면(업무 흐름의 '처리 화면'·'기록 보기', 기록 링크)에서 연 기록 — 그 작업 공간이 열려 있으면 목록 맨 위에 세우고 그 줄로 옮긴다.
  let recordAsk=0;
  function showRecord(familyId,recordId,pin=false){
    const a=area(familyId);if(!a){toast('이 기록은 여기서 바로 열 수 없습니다. 해당 작업 공간 목록에서 찾아 주세요.');return Promise.resolve('missing');}
    const r=recordById(familyId,recordId);
    if(r){recordAsk++;renderRecord(a,familyId,r,pin);return Promise.resolve('shown');}
    const ask=++recordAsk,view=()=>{const d=document.getElementById('detail');return [d?.open?d.querySelector('h2')?.textContent??'':null,location.hash,Boolean(document.querySelector('#modal[open]'))];},before=view();
    const same=()=>ask===recordAsk&&view().every((x,i)=>x===before[i]);
    const fail=missing=>{toast(missing?'이 기록을 찾지 못했습니다.':'기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');return missing?'missing':'failed';};
    return fetch(`/api/workspaces/${encodeURIComponent(familyId)}/records?id=${encodeURIComponent(recordId)}`,{headers:{Accept:'application/json'}})
      .then(async res=>{const j=await res.json().catch(()=>null);if(!same())return 'stale';
        if(res.ok&&j?.item&&String(j.item.id)===String(recordId)){(exact[familyId]||(exact[familyId]=new Map())).set(String(j.item.id),j.item);renderRecord(a,familyId,j.item,pin);return 'shown';}
        return fail(res.status===404);})
      .catch(()=>same()?fail(false):'stale');
  }
  // 기록 상세 서랍 = 그 기록의 사실 + 실제로 일이 되는 동작만(원장 10-28 — 저장되지 않는 미리보기·요청 초안은 해결 동작처럼 보여 헷갈린다).
  // 남기는 것: '이 기록으로 요청'(업무 요청을 실제로 연다) · '상세 화면 열기'(이 기록을 바로 여는 화면) · '처리 화면 열기'(그 기록이 열린 처리 화면 · 없으면 이 영역의 업무 화면) ·
  // 이 영역의 본래 화면으로 가는 '화면 이동'(기록을 바로 여는 화면이 없을 때만). 같은 작업 공간 안의 보조 면(키오스크 설정·실급여 비율 …)으로 가는
  // 이동은 그 기록과 상관없어 뺀다. 미리보기·요청 초안은 본문 '할 수 있는 일'에 그대로 있다.
  // 근거 한 건 열기 = 처리 화면(record-open, v2-screen-record-open.js) · 처리 화면이 없는 영역은 기록 서랍.
  function openEvidence(familyId,recordId){
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    if(window.RecordOpen?.supports(familyId,recordId)){window.RecordOpen.open(familyId,recordId);return;}
    if(api.getPage()!==`workspace-${familyId}`)navigate(`workspace-${familyId}`);
    requestAnimationFrame(()=>showRecord(familyId,recordId));
  }
  // 근거가 여럿 = 목록 한 장(열 맞춤) — 줄을 누르면 서랍을 거치지 않고 그 기록의 처리 화면.
  let evidenceAsk=0;
  function evidenceList(a,s,ids){
    const ask=++evidenceAsk,shown=ids.slice(0,100),more=ids.length-shown.length;
    dialog('modal',s.title,`${a.label} · 근거 ${fmt(ids.length)}건`,`<div class="ws-evidence" data-evidence><p class="ax-note" role="status">근거 기록을 불러오는 중입니다.</p></div>`);
    const fill=html=>{const box=document.querySelector('#modal [data-evidence]');if(box&&ask===evidenceAsk)box.innerHTML=html;};
    fetch(`/api/workspaces/${encodeURIComponent(a.id)}/records?ids=${shown.map(encodeURIComponent).join(',')}`,{headers:{Accept:'application/json'}})
      .then(r=>r.ok?r.json():Promise.reject(new Error('조회 실패')))
      .then(j=>{const rows=(j.items||[]).filter(r=>r&&r.id);if(!rows.length){fill('<p class="ax-note">근거 기록을 찾지 못했습니다. 작업 공간 목록에서 확인해 주세요.</p>');return;}
        fill(`<table class="ws-evidence-table"><thead><tr><th>이름</th><th>내용</th><th>날짜</th><th>상태</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button type="button" class="ax-text-link" data-ws="evidence-open" data-id="${h(a.id)}" data-record="${h(r.id)}">${h(r.label||'—')}</button></td><td>${h(r.detail||'—')}</td><td>${h(r.date?ymd(r.date):'—')}</td><td>${h(r.status||'—')}</td></tr>`).join('')}</tbody></table>${more>0?`<p class="ax-note">나머지 ${fmt(more)}건은 작업 공간 목록에서 볼 수 있습니다.</p>`:''}`);})
      .catch(()=>fill('<p class="ax-note">근거 기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>'));
  }
  function recordActions(a,r){
    const rid=String(r.id),open=Boolean(api.openRecord&&api.canOpenRecord?.(rid)),v2=window.V2Screens?.target(a.id)||'';
    const target=a.id==='textbooks'&&v2?`${v2}${v2.includes('?')?'&':'?'}textbook=${encodeURIComponent(rid)}`:v2;
    const out=[btn('이 기록으로 요청','record-request',`data-id="${h(a.id)}" data-record="${h(rid)}"`,true)];
    if(open)out.push(btn('상세 화면 열기','record-open',`data-record="${h(rid)}"`));
    const direct=window.RecordOpen?.supports(a.id,rid)?window.RecordOpen.href(a.id,rid):''; // 그 기록이 열린 처리 화면 — 없으면 이 영역의 업무 화면
    if(direct||target)out.push(btn('처리 화면 열기','goto',`data-page="${h((direct||target).slice(1))}"`));
    if(!open&&!v2)actionsOf(a).filter(x=>x.mode==='navigate'&&!familyOf(targetOf(x).page)&&resolvePage(targetOf(x).page)).forEach(x=>out.push(btn(x.label,'action',`data-id="${h(a.id)}" data-action="${h(x.id)}" data-record="${h(rid)}"`)));
    return `<div class="ax-actions">${out.join('')}</div>`;
  }
  function textbookAssignments(r){
    if(!Array.isArray(r.assignments))return '';
    const rows=r.assignments;
    return `<section class="ws-textbook-plans"><h3>배정된 반 ${rows.length}건</h3>${rows.length?`<div class="ws-textbook-plan-list">${rows.map(p=>`<article><button type="button" class="ax-text-link" data-ws="textbook-class" data-record="${h(p.class_id)}">${h(p.class_name)}</button><dl><dt>배정 기록</dt><dd>${h(p.id)}</dd><dt>시작</dt><dd>${h(p.start_date||'미정')} · ${h(p.start_lesson_no||1)}차</dd><dt>자리</dt><dd>${p.slot_axis==='jj'?'JJ':'반 수업'}</dd><dt>진도 단위</dt><dd>${({period:'교시마다 한 차수',day:'수업일마다 한 차수',min25:'25분마다 한 차수'})[p.pace]||'교시마다 한 차수'}</dd><dt>구분</dt><dd>${p.term_mode==='exam'?'시험':'정규'}</dd><dt>시트 반영</dt><dd>${h(p.last_applied_at?String(p.last_applied_at).slice(0,10):'아직 없음')}</dd></dl></article>`).join('')}</div>`:'<p>배정된 반이 없습니다.</p>'}</section>`;
  }
  function renderRecord(a,familyId,r,pin=false){
    const recordId=String(r.id),local=(state.local[familyId]||[]).filter(e=>e.recordId===recordId);
    state.cur[familyId]=recordId;
    dialog('detail',r.label,a.label,`${factsHtml(a,r)}${familyId==='billing'?billingDetails(r.lines):''}${familyId==='textbooks'?textbookAssignments(r):''}${recordActions(a,r)}${local.length?`<section class="ax-evidence"><h3>이 기록의 미리보기 ${local.length}건</h3>${local.map(e=>`<p><strong>${h(e.label)}</strong> · ${h(e.values.map(v=>`${v.label} ${v.value}`).join(' · '))}</p>`).join('')}</section>`:''}`);
    if(pin&&api.getPage()===`workspace-${familyId}`){state.pin[familyId]=recordId;refreshMain(familyId);}
    // 그 줄이 화면 안에 들어오게(경로를 옮겨 온 것이라 곧바로 — 스크롤 원칙의 '화면 전환'). 이미 보이면 움직이지 않는다.
    const row=markCurrent(familyId);
    if(pin&&row){const box=row.getBoundingClientRect();if(box.top<0||box.bottom>innerHeight)row.scrollIntoView({block:'center',behavior:'instant'});}
  }
  // Partial refresh of the records region; keeps focus and the horizontal/vertical position of inner scrollers.
  function refreshMain(id){
    const node=$('#ws-main'),a=area(id);if(!node||!a||!$(`.ws[data-family="${CSS.escape(id)}"]`))return;
    const focus=document.activeElement?.id,kept=new Map([...node.querySelectorAll('[data-scroll-key]')].map(n=>[n.dataset.scrollKey,[n.scrollLeft,n.scrollTop]]));
    node.innerHTML=mainHtml(a);
    node.querySelectorAll('[data-scroll-key]').forEach(n=>{const k=kept.get(n.dataset.scrollKey);if(k){n.scrollLeft=k[0];n.scrollTop=k[1];}});
    api.attachScroll();if(focus)document.getElementById(focus)?.focus({preventScroll:true});
    if(colMenu.el)placeColMenu();
  }
  function refreshSide(id){const node=$('#ws-local');const a=area(id);if(node&&a)node.innerHTML=localLog(a);}

  /* ---------- sheet edits ---------- */
  function editCell(button){
    const {id,record,col}=button.dataset,input=document.createElement('input');
    input.value=button.textContent;input.className='ws-cell-input';input.setAttribute('aria-label',button.getAttribute('aria-label'));
    const finish=save=>{if(save){const r=recordById(id,record),original=(r?.fields||[]).find(f=>f.label===col)?.value??'—',value=input.value.trim()||'—';const row=(state.edits[id]||(state.edits[id]={}))[record]||(state.edits[id][record]={});if(value===String(original))delete row[col];else row[col]=value;}refreshMain(id);$(`.ws-cell[data-record="${CSS.escape(record)}"][data-col="${CSS.escape(col)}"]`)?.focus();};
    input.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}});
    input.addEventListener('blur',()=>{if(input.isConnected)finish(true);},{once:true});
    button.replaceWith(input);input.focus();input.select();
  }

  /* ---------- discovery: left sidebar finder + grouped areas (collapsed), global search, launcher ---------- */
  const groups=()=>[...new Set(areas().map(a=>a.group||'기타'))];
  function matches(query){
    const q=norm(query);if(!q)return [];
    return areas().map(a=>{const hay=norm(`${a.label} ${a.group} ${a.summary||''}`),ops=actionsOf(a).filter(x=>norm(x.label).includes(q));return {a,score:norm(a.label).includes(q)?3:hay.includes(q)?2:ops.length?1:0,op:ops[0]};}).filter(x=>x.score).sort((x,y)=>y.score-x.score||x.a.label.localeCompare(y.a.label,'ko')).slice(0,8);
  }
  function finderResults(){
    const list=matches(state.query);
    if(!state.query)return '';
    return list.length?list.map((m,i)=>`<li role="option" id="ws-find-${i}" aria-selected="${i===state.active}" class="${i===state.active?'active':''}" data-ws="open" data-id="${h(m.a.id)}"><strong>${h(m.a.label)}</strong><small>${h(m.a.group||'')}${m.op?` · ${h(m.op.label)}`:''}</small></li>`).join(''):`<li class="ws-find-empty" role="presentation">‘${h(state.query)}’에 맞는 업무가 없습니다.</li>`;
  }
  function sidebar(page){
    if(!areas().length)return '';
    // Only the current group opens by itself; groups the owner opened or closed by hand keep that choice.
    const current=familyOf(page),currentGroup=area(current)?.group,isOpen=g=>state.open.has(g)||(g===currentGroup&&!state.closed.has(g));
    const recent=state.recent.filter(has).slice(0,3);
    return `<div class="nav-group">업무 찾기</div><div class="ws-finder"><input type="search" id="ws-find" role="combobox" aria-expanded="${Boolean(state.query)}" aria-controls="ws-find-list" aria-autocomplete="list" aria-activedescendant="${state.active>=0?`ws-find-${state.active}`:''}" aria-label="업무 찾기 · 기능 이름이나 작업으로 검색" placeholder="예: 보강, 급여, 회의록" value="${h(state.query)}" autocomplete="off"><ul id="ws-find-list" role="listbox" aria-label="업무 검색 결과">${finderResults()}</ul></div>${recent.length?`<div class="ws-recent">${recent.map(id=>`<a class="nav-item ${current===id?'active':''}" href="#workspace-${h(id)}" ${current===id?'aria-current="page"':''}><span>${h(area(id).label)}</span></a>`).join('')}</div>`:''}<div class="ws-groups">${groups().map(g=>`<details data-ws-group="${h(g)}" ${isOpen(g)?'open':''}><summary>${h(g)}<span class="nav-count">${areas().filter(a=>(a.group||'기타')===g).length}</span></summary>${areas().filter(a=>(a.group||'기타')===g).map(a=>`<a class="nav-item ws-nav ${current===a.id?'active':''}" href="#workspace-${h(a.id)}" ${current===a.id?'aria-current="page"':''}><span>${h(a.label)}</span></a>`).join('')}</details>`).join('')}</div>`;
  }
  function updateFinder(){const list=$('#ws-find-list'),input=$('#ws-find');if(!list||!input)return;list.innerHTML=finderResults();input.setAttribute('aria-expanded',String(Boolean(state.query)));input.setAttribute('aria-activedescendant',state.active>=0?`ws-find-${state.active}`:'');list.querySelector('.active')?.scrollIntoView({block:'nearest'});}
  function searchItems(query){return matches(query).map(m=>({page:`workspace-${m.a.id}`,title:m.a.label,note:`업무 · ${m.a.group||''}${m.op?` · ${m.op.label}`:''}`}));}
  function homeSignals(){
    const list=areas().flatMap(a=>(data(a.id)?.signals||[]).map(s=>({a,s}))).sort((x,y)=>byPriority(x.s,y.s));
    if(!list.length)return '';
    return `<section class="ws-home-signals" aria-labelledby="ws-home-signals-title"><div class="ax-section-head"><h2 id="ws-home-signals-title">작업 공간에서 올라온 신호 ${list.length}건</h2></div><div class="ws-signal-grid">${list.slice(0,6).map(({a,s})=>signalCard(a.id,s,true)).join('')}</div>${list.length>6?`<p class="ax-note">나머지 ${list.length-6}건은 각 작업 공간에서 확인할 수 있습니다.</p>`:''}</section>`;
  }

  /* ---------- runtime coverage map (where each catalog action lands — distinct from production wiring) ---------- */
  function coverage(){
    const families={};let operations=0;const byDestination={};
    for(const a of areas()){
      const kind=viewKind(a),facetData=facetsOf(a),recs=previews(a.id);
      const ops=actionsOf(a).map(x=>{const mode=MODE[x.mode]?x.mode:'request',{page:target}=targetOf(x),dest=MODE[mode].destination;
        const reachable=mode!=='navigate'||Boolean(resolvePage(target));
        byDestination[dest]=(byDestination[dest]||0)+1;operations++;
        return {id:x.id,label:x.label,mode,destination:dest,target:mode==='navigate'?target:mode==='preview'?'local-session-log':'request-form',status:reachable?MODE[mode].status:'broken-target',fields:Array.isArray(x.fields)?x.fields.length:0,result:mode==='preview'?resultLabel(x):'',sourceOperationIds:Array.isArray(x.sourceOperationIds)?x.sourceOperationIds:[],intent:actionIntent(x),production:'not-linked'};});
      families[a.id]={page:`workspace-${a.id}`,reachable:api.hasView(`workspace-${a.id}`),label:a.label,group:a.group||'',viewKind:kind,renderer:`${kind}View`,dataState:dataState(a.id).key,facets:[...facetData.map(f=>({id:f.id,label:f.label,kind:'record-filter',intent:FACET_INTENT[kind],status:recs.some(r=>(r.facetIds||[]).includes(f.id))?'filter':'count-only'})),...screensOf(a).map(sc=>({id:sc.id,label:sc.label,kind:sc.kind||'screen',intent:screenActions(a,sc.id).length?`‘${sc.label}’ 화면 — 관련 작업 ${screenActions(a,sc.id).length}가지로 이어집니다`:`‘${sc.label}’ 화면 이름을 보여 줍니다`,status:kind==='settings'?'face':screenActions(a,sc.id).length?'screen':'label-only'}))],operations:ops};
    }
    return {schemaVersion:1,local:true,families,totals:{families:Object.keys(families).length,operations,byDestination,sourceOperationIds:[...new Set(Object.values(families).flatMap(f=>f.operations.flatMap(o=>o.sourceOperationIds)))].length}};
  }
  Object.defineProperty(window,'AxCoverage',{configurable:true,get:coverage});

  /* ---------- 목록 조건이 바뀔 때(구분·검색·보기·정렬·거르기) ---------- */
  function reloadList(id){if(LOCAL.has(id)&&!has(id)){repaintLocal(id);return;}if(needsRemote(id))loadRecords(id);if(boardNeeded(id))loadBoard(id);if(fullMode(id)&&!fullReady(id))loadAll(id);refreshMain(id);}
  function arrangeChanged(id){state.page[id]=1;delete state.pin[id];reloadList(id);syncColMenu();}

  /* ---------- 열 머리 메뉴: 정렬 · 값 거르기(업무 흐름 표와 같은 모양 · 원장 10-28 "전부 필터 및 검색, 오름/내림차순 정렬 가능하게") ----------
     열 머리를 누르면 그 아래 작은 창 — 오름·내림차순, 그 열의 값 목록(건수와 함께 · 찾기 칸으로 좁힘)을 골라 거른다. 고르는 즉시 목록에 반영하고 창은
     열어 둔다. 값 목록은 검색어·구분·다른 열의 거르기를 지난 기록 전부에서 뽑는다(그 열 자신의 거르기는 빼고 — 엑셀과 같다). */
  const colMenu={id:'',col:'',q:'',el:null},VALUE_MAX=500;
  const menuCol=()=>(state.lcols[colMenu.id]||[]).find(c=>c.key===colMenu.col);
  const headOf=()=>colMenu.id?document.querySelector(`.ws-th[data-id="${CSS.escape(colMenu.id)}"][data-col="${CSS.escape(colMenu.col)}"]`):null;
  const fullSlot=id=>state.full[id]?.key===fullKey(id)?state.full[id]:null;
  const cannotArrange=id=>!completeBase(id)&&(fullSlot(id)?.status==='toomany'||(knownCount(id)??0)>FULL_MAX);
  function colValues(){
    const id=colMenu.id,a=area(id)||(LOCAL.has(id)?{id}:null),c=menuCol(),all=a&&c?completeBase(id):null;if(!all)return null;
    const n=new Map(),sv=new Map();
    for(const r of arrange(a,all,state.lcols[id],c.key)){const v=c.text(r);n.set(v,(n.get(v)||0)+1);if(!sv.has(v))sv.set(v,c.sortv(r));}
    // 날짜·숫자 열은 값 순서, 그 밖은 많은 값부터. 빈 칸은 맨 뒤.
    const byValue=[...sv.values()].some(v=>typeof v==='number'||/^\d{4}-\d{2}/.test(String(v)));
    const cmp=(x,y)=>{const p=sv.get(x[0]),q=sv.get(y[0]);return typeof p==='number'&&typeof q==='number'?p-q:collate(String(p),String(q));};
    return [...n].sort((x,y)=>x[0]===''?1:y[0]===''?-1:byValue?cmp(x,y):y[1]-x[1]||collate(x[0],y[0]));
  }
  function colListHtml(){
    const id=colMenu.id,f=fullSlot(id);
    if(cannotArrange(id))return `<p class="ws-colpop-note">${h(tooMany(f?.total??knownCount(id)))}</p>`;
    if(f?.status==='error'&&!completeBase(id))return `<p class="ws-colpop-note">${h(f.message)}</p>`;
    const vals=colValues();if(vals===null)return '<p class="ws-colpop-note" role="status">값을 불러오는 중입니다.</p>';
    const sel=state.cols[id]?.[colMenu.col],on=v=>!Array.isArray(sel)||sel.includes(v),q=norm(colMenu.q),shown=q?vals.filter(([v])=>norm(v||'빈 칸').includes(q)):vals;
    if(!shown.length)return `<p class="ws-colpop-note">${vals.length?'맞는 값이 없습니다.':'선택할 값이 없습니다.'}</p>`;
    return `<label class="ws-colpop-all"><input type="checkbox" data-wsc="all"><span>${q?'찾은 값 모두':'모두'}</span></label>${shown.slice(0,VALUE_MAX).map(([v,n])=>`<label><input type="checkbox" data-wsc="val" value="${h(v)}" ${on(v)?'checked':''}><span>${h(v||'빈 칸')}</span><b>${fmt(n)}</b></label>`).join('')}${shown.length>VALUE_MAX?`<p class="ws-colpop-note">값이 ${fmt(shown.length)}가지라 앞의 ${fmt(VALUE_MAX)}가지만 보입니다. 찾기 칸으로 좁혀 주세요.</p>`:''}`;
  }
  // '모두' 칸 = 보이는 값이 다 골라졌으면 체크, 일부면 반만. 정렬 단추는 기록이 너무 많으면 잠근다.
  function syncColMenu(){
    const el=colMenu.el;if(!el)return;const id=colMenu.id,sort=sortOf(id),boxes=[...el.querySelectorAll('[data-wsc="val"]')],all=el.querySelector('[data-wsc="all"]'),n=boxes.filter(b=>b.checked).length;
    if(all){all.checked=boxes.length>0&&n===boxes.length;all.indeterminate=n>0&&n<boxes.length;}
    el.querySelectorAll('[data-wsc="sort"]').forEach(b=>{b.setAttribute('aria-pressed',String(sort.col===colMenu.col&&sort.dir===b.dataset.dir));b.disabled=cannotArrange(id);});
    el.querySelector('[data-wsc="clear"]').disabled=!Array.isArray(state.cols[id]?.[colMenu.col])&&sort.col!==colMenu.col;
  }
  // 값이 나중에 채워지면 창 높이가 바뀐다 — 그릴 때마다 자리를 다시 잡는다(화면 아래로 넘치지 않게).
  function paintColMenu(){const list=colMenu.el?.querySelector('.ws-colpop-list');if(!list)return;if(attachTipFor?.closest?.('.ws-colpop'))hideAttachTip();list.innerHTML=colListHtml();syncColMenu();api.attachScroll?.();placeColMenu();}
  function openColMenu(id,col){
    const same=colMenu.el&&colMenu.id===id&&colMenu.col===col;closeColMenu(false);if(same)return;
    const c=(state.lcols[id]||[]).find(x=>x.key===col);if(!c)return;
    hideAttachTip();Object.assign(colMenu,{id,col,q:''});
    const el=document.createElement('div');el.className='ws-colpop';el.setAttribute('role','dialog');el.setAttribute('aria-label',`${c.label} 정렬·거르기`);
    el.innerHTML=`<div class="ws-colpop-sort" role="group" aria-label="정렬"><button type="button" data-wsc="sort" data-dir="asc">오름차순 ▲</button><button type="button" data-wsc="sort" data-dir="desc">내림차순 ▼</button></div><input type="search" class="ws-colpop-q" data-wsc-q placeholder="${h(c.label)} 값 찾기" aria-label="${h(c.label)} 값 찾기" autocomplete="off"><div class="ws-colpop-list live-scroll" role="group" aria-label="${h(c.label)} 값"></div><div class="ws-colpop-foot"><button type="button" class="ax-text-link" data-wsc="clear">이 열 초기화</button><button type="button" class="button" data-wsc="close">닫기</button></div>`;
    document.body.append(el);colMenu.el=el;
    if(!completeBase(id)&&!cannotArrange(id))loadAll(id);
    paintColMenu();placeColMenu();el.querySelector('[data-wsc-q]').focus({preventScroll:true});
  }
  function closeColMenu(returnFocus=true){
    if(!colMenu.el)return;const head=headOf();colMenu.el.remove();Object.assign(colMenu,{id:'',col:'',q:'',el:null});
    head?.setAttribute('aria-expanded','false');if(returnFocus)head?.focus({preventScroll:true});
  }
  // 머리 칸 바로 아래(넘치면 위) · 화면 안. 목록을 다시 그려도 같은 열을 따라가고, 머리 칸이 화면 밖으로 나가면 닫는다.
  function placeColMenu(){
    const el=colMenu.el;if(!el)return;const head=headOf();if(!head){closeColMenu(false);return;}
    const r=head.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight){closeColMenu(false);return;}
    head.setAttribute('aria-expanded','true');
    const w=el.offsetWidth,hh=el.offsetHeight;let top=r.bottom+4;if(top+hh>innerHeight-8)top=Math.max(8,r.top-hh-4);
    el.style.left=`${Math.min(Math.max(8,r.left),innerWidth-w-8)}px`;el.style.top=`${top}px`;
  }
  function setSort(dir){
    const id=colMenu.id,col=colMenu.col;if(cannotArrange(id)){toast(tooMany(fullSlot(id)?.total??knownCount(id)));return;}
    const s=sortOf(id);state.sort[id]=s.col===col&&s.dir===dir?{col:'',dir:''}:{col,dir};arrangeChanged(id);
  }
  // 값 고르기 — 다 고르면 그 열 거르기를 지운다(전부와 같다). 하나도 안 고르면 맞는 기록이 없다.
  function setColValues(values,on){
    const id=colMenu.id,col=colMenu.col,vals=colValues();if(!vals||cannotArrange(id))return;
    const all=vals.map(([v])=>v),box=state.cols[id]||(state.cols[id]={}),sel=new Set(Array.isArray(box[col])?box[col]:all);
    values.forEach(v=>on?sel.add(v):sel.delete(v));
    if(all.every(v=>sel.has(v)))delete box[col];else box[col]=[...sel];
    arrangeChanged(id);
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest?.('.ws-colpop [data-wsc]');if(!b||b.matches('input')||b.disabled)return;
    const act=b.dataset.wsc,id=colMenu.id;
    if(act==='close'){closeColMenu();return;}
    if(act==='sort'){setSort(b.dataset.dir);return;}
    if(act==='clear'){if(state.cols[id])delete state.cols[id][colMenu.col];if(sortOf(id).col===colMenu.col)delete state.sort[id];colMenu.q='';const q=colMenu.el.querySelector('[data-wsc-q]');if(q)q.value='';arrangeChanged(id);paintColMenu();}
  });
  document.addEventListener('change',event=>{
    const t=event.target;if(!colMenu.el||!t.closest?.('.ws-colpop'))return;
    if(t.dataset.wsc==='val')setColValues([t.value],t.checked);
    if(t.dataset.wsc==='all'){const boxes=[...colMenu.el.querySelectorAll('[data-wsc="val"]')];boxes.forEach(x=>{x.checked=t.checked;});setColValues(boxes.map(x=>x.value),t.checked);}
  });
  document.addEventListener('input',event=>{if(!event.target.matches?.('.ws-colpop [data-wsc-q]'))return;colMenu.q=event.target.value;paintColMenu();});
  document.addEventListener('keydown',event=>{
    if(!colMenu.el||event.key!=='Escape'||!event.target.closest?.('.ws-colpop'))return;event.preventDefault();event.stopPropagation();
    const q=event.target.matches('[data-wsc-q]')&&event.target.value?event.target:null;if(q){q.value='';colMenu.q='';paintColMenu();return;}closeColMenu();
  },true);
  document.addEventListener('pointerdown',event=>{if(colMenu.el&&!colMenu.el.contains(event.target)&&!event.target.closest?.('.ws-th'))closeColMenu(false);},true);
  addEventListener('resize',()=>requestAnimationFrame(placeColMenu));
  addEventListener('scroll',event=>{if(colMenu.el&&!colMenu.el.contains(event.target))requestAnimationFrame(placeColMenu);},{passive:true,capture:true});
  addEventListener('hashchange',()=>closeColMenu(false));
  // 줄 어디를 눌러도 그 줄의 이름 단추가 하는 일(단추·링크·입력 위가 아니면). 키보드는 이름 단추로 간다.
  document.addEventListener('click',event=>{
    const tr=event.target.closest?.('.ws-table tbody tr');if(!tr||event.target.closest('button,a,input,select,textarea,label'))return;
    const main=tr.querySelector('.ws-rowmain');if(!main)return;event.preventDefault();event.stopImmediatePropagation();main.click();
  },true);

  /* ---------- events ---------- */
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-ws]');if(!el||el.disabled)return;
    const {ws:action,id,record}=el.dataset;event.preventDefault();event.stopImmediatePropagation();
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='open'){state.query='';state.active=-1;navigate(`workspace-${id}`);return;}
    if(action==='facet'){state.facet[id]=state.facet[id]===el.dataset.facet&&el.dataset.facet?'':el.dataset.facet;state.page[id]=1;delete state.pin[id];reloadList(id);
      // 위 막대의 강조·기준 줄도 칩을 따른다(목록만 다시 그리면 막대가 그대로 남는다).
      const crit=document.querySelector(`.ws[data-family="${CSS.escape(id)}"] .ws-critical`),ar=area(id);if(crit&&ar)crit.outerHTML=critical(ar);return;}
    if(action==='as-list'){if(el.dataset.v==='list')state.asList[id]=true;else{delete state.asList[id];state.facet[id]='';state.q[id]='';}state.page[id]=1;delete state.pin[id];reloadList(id);return;}
    if(action==='col'){openColMenu(id,el.dataset.col);return;}
    if(action==='expand'){const set=state.expanded[id]||(state.expanded[id]=new Set()),rid=String(record);if(set.has(rid))set.delete(rid);else set.add(rid);if(LOCAL.has(id))repaintLocal(id);else refreshMain(id);return;}
    if(action==='col-clear'){if(state.cols[id])delete state.cols[id][el.dataset.col];arrangeChanged(id);if(colMenu.id===id)paintColMenu();return;}
    if(action==='reload-full'){delete state.full[id];loadAll(id);refreshMain(id);return;}
    if(action==='screen'){state.screen[id]=state.screen[id]===el.dataset.screen?'':el.dataset.screen;refreshMain(id);const side=$('.ws-side .ws-actions');if(side){side.outerHTML=actionPanel(area(id));}return;}
    if(action==='face'){state.face[id]=el.dataset.face;refreshMain(id);return;}
    // 쪽 = 빠짐없이 가진 목록이면 화면에서 바로, 아니면 그 쪽을 읽는다. 목록 머리가 화면 위로 지나갔으면 목록 처음으로 옮긴다.
    if(action==='page'){state.page[id]=Math.max(1,Number(el.dataset.page));delete state.pin[id];const local=LOCAL.has(id)&&!has(id);if(local)repaintLocal(id);else if(needsRemote(id))loadRecords(id);else refreshMain(id);const top=local?document.querySelector(`[data-list-key="${CSS.escape(id)}"]`):$('#ws-main');if(top&&top.getBoundingClientRect().top<0)api.scrollToSection?.(top);return;}
    if(action==='reload'){if(boardMode(id)){delete state.board[id];loadBoard(id);refreshMain(id);return;}if(state.remote[id])state.remote[id].key='';loadRecords(id);return;}
    if(action==='record'){if(id==='attendance'&&['repeat-absence','repeat-absence-absent'].includes(state.facet[id])){api.showAbsences(null,{attendanceId:record});return;}showRecord(id,record);return;}
    if(action==='record-open'){api.openRecord(record);return;}
    if(action==='textbook-class'){showRecord('classes',record);return;}
    if(action==='goto'){navigate(el.dataset.page);return;}
    if(action==='evidence-open'){openEvidence(id,el.dataset.record);return;}
    if(action==='record-request'){const a=area(id),r=recordById(id,record);if(!a||!r)return;document.querySelectorAll('dialog[open]').forEach(d=>d.close());requestFrom(a,{title:`${r.label} 확인`,body:`${a.label}의 이 기록을 확인하고 필요한 조치와 결과를 보고해 주세요.`,records:[r]});return;}
    if(action==='action'){if(el.closest('dialog'))el.closest('dialog').close();openAction(id,el.dataset.action,record||'');return;}
    if(action==='request'){const a=area(id);requestFrom(a,{title:`${a.label} 확인 요청`,body:`${a.label}에서 확인할 내용을 정리해 결과를 보고해 주세요.`});return;}
    if(action==='ask'){ax.openChat?.({topic:area(id).label,prompt:`${area(id).label}에서 지금 확인할 점과 담당자에게 요청할 업무를 정리해줘`});return;}
    if(action==='signal-evidence'||action==='signal-request'){
      const a=area(id),s=(data(id)?.signals||[]).find(x=>x.id===el.dataset.signal);if(!s)return;
      if(action==='signal-request'){requestFrom(a,{title:s.draft?.title||s.title,body:s.draft?.body||s.summary||s.title,signal:s.id,records:(s.recordIds||[]).map(r=>recordById(id,r)).filter(Boolean)});return;}
      // 근거 보기 = 그 기록을 처리하는 화면(원장 10-30 "근거를 도대체 몇단계나 봐야하는거야") — 하나면 바로, 여럿이면 근거 목록 한 장에서 줄을 누르면 바로.
      const ids=[...new Set((s.recordIds||[]).map(String))];
      if(ids.length===1){openEvidence(id,ids[0]);return;}
      if(ids.length>1){evidenceList(a,s,ids);return;}
      state.facet[id]='';state.q[id]='';if(api.getPage()!==`workspace-${id}`){navigate(`workspace-${id}`);}
      requestAnimationFrame(()=>{$('#ws-main')?.scrollIntoView({block:'start',behavior:'auto'});toast('이 신호의 근거 기록은 작업 공간 목록에서 확인할 수 있습니다.');});
      return;
    }
    if(action==='cell'){editCell(el);return;}
    if(action==='recipient-ack'){const person=db.staff.find(s=>s.id===(state.recipient||ax.recipient?.owners()[0]));ax.recipient?.acknowledge(el.dataset.request,person?.name||'담당자',person?.id||'');return;}
    if(action==='sheet-reset'){delete state.edits[id];refreshMain(id);return;}
    if(action==='sheet-save'){
      const rows=state.edits[id]||{},values=Object.entries(rows).flatMap(([rid,cols])=>Object.entries(cols).map(([c,v])=>({label:`${recordById(id,rid)?.label||rid} · ${c}`,value:v})));if(!values.length)return;
      (state.local[id]||(state.local[id]=[])).unshift({id:crypto.randomUUID(),actionId:'sheet-edits',label:'시트 변경분',at:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),recordId:'',values});
      delete state.edits[id];refreshMain(id);refreshSide(id);toast(`시트 변경 ${values.length}칸을 미리보기로 기록했습니다. 시트에 저장되지는 않았습니다.`);return;
    }
    if(action==='local-remove'){state.local[id]=(state.local[id]||[]).filter(e=>e.id!==el.dataset.entry);refreshSide(id);refreshMain(id);return;}
    if(action==='local-request'){const a=area(id),e=(state.local[id]||[]).find(x=>x.id===el.dataset.entry);if(!e)return;const r=e.recordId?recordById(id,e.recordId):null;requestFrom(a,{title:`${e.label} 처리 요청`,body:`${a.label}에서 아래 내용대로 ‘${e.label}’ 작업을 처리하고 결과를 보고해 주세요.\n${e.values.map(v=>`· ${v.label}: ${v.value}`).join('\n')}`,action:e.actionId,records:r?[r]:[]});return;}
  },true);
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form.dataset.wsForm==='recipient-report'){event.preventDefault();event.stopImmediatePropagation();const text=String(new FormData(form).get('result')||'').trim();if(!text){form.querySelector('.ax-form-error').textContent='완료 보고 내용을 입력해 주세요.';form.querySelector('textarea').focus();return;}const person=db.staff.find(s=>s.id===(state.recipient||ax.recipient?.owners()[0]));ax.recipient?.complete(form.dataset.request,person?.name||'담당자',text,person?.id||'');return;}
    if(form.dataset.wsForm!=='preview'&&form.dataset.wsForm!=='request')return;event.preventDefault();event.stopImmediatePropagation();submitPreview(form,form.dataset.wsForm);
  },true);
  document.addEventListener('change',event=>{if(event.target.dataset?.wsRecipient!==undefined){state.recipient=event.target.matches('[data-cpick]')?window.ContextPicker.value(event.target)[0]||'':event.target.value;const id=familyOf(api.getPage());if(id)refreshMain(id);}});
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='ws-find'){state.query=el.value;state.active=matches(el.value).length?0:-1;updateFinder();return;}
    if(el.dataset?.wsQ&&!event.isComposing){const id=el.dataset.wsQ;clearTimeout(state.qTimer);state.qTimer=setTimeout(()=>{state.q[id]=el.value.trim();state.page[id]=1;delete state.pin[id];reloadList(id);},250);}
  });
  document.addEventListener('compositionend',event=>{const el=event.target;if(el.id==='ws-find'){state.query=el.value;state.active=matches(el.value).length?0:-1;updateFinder();}if(el.dataset?.wslQ)searchLocal(el);});
  // 다른 화면 목록(listTable)의 검색 칸 — 잠깐 멈춘 뒤 그 화면을 다시 그린다(칸의 초점·커서는 그 화면이 되살린다).
  function searchLocal(el){const key=el.dataset.wslQ;clearTimeout(state.qTimer);state.qTimer=setTimeout(()=>{state.q[key]=el.value.trim();state.page[key]=1;repaintLocal(key);},250);}
  document.addEventListener('input',event=>{const el=event.target;if(el.dataset?.wslQ&&!event.isComposing)searchLocal(el);});
  document.addEventListener('keydown',event=>{
    const el=event.target;
    if(el.id==='ws-find'){
      if(event.isComposing||event.keyCode===229)return;
      const n=matches(state.query).length;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(n){state.active=(state.active+(event.key==='ArrowDown'?1:-1)+n)%n;updateFinder();}}
      else if(event.key==='Enter'){event.preventDefault();const m=matches(state.query)[Math.max(0,state.active)];if(m){state.query='';state.active=-1;api.closeMenu?.(false);navigate(`workspace-${m.a.id}`);}}
      else if(event.key==='Escape'&&state.query){event.preventDefault();event.stopPropagation();state.query='';state.active=-1;el.value='';updateFinder();}
      return;
    }
    if(el.classList?.contains('ws-cell')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();editCell(el);}
  },true);
  document.addEventListener('click',event=>{const summary=event.target.closest?.('[data-ws-group]>summary');if(!summary)return;const d=summary.parentElement,g=d.dataset.wsGroup;if(d.open){state.open.delete(g);state.closed.add(g);}else{state.open.add(g);state.closed.delete(g);}},true);
  window.addEventListener('ax-catalog',()=>api.render());

  // 기록 첨부(원장 10-28 "후속 보고 쓰기에 실제 db를 활용해 결과 첨부" · "업무요청에도 실제 db를 활용해 요청가능하게" ·
  // "업무요청시에 기록 첨부도 알아볼 수 있게 첨부해야지 이렇게 어떻게 첨부하나"): 영역을 먼저 고르지 않고 이름·내용으로 바로 찾는다 —
  // 모든 영역의 기록을 영역별로 묶어 보이고(GET /api/workspaces/records/search, 읽기만), 그 영역 화면에서 연 요청이면 그 영역이 먼저다.
  // 영역마다 열을 나눈다(원장 10-28 "항상 열정렬하는거 잊지마"): 이름 | 내용 | 상태 | 날짜 | 칸들 — 그 묶음 기록이 쓰는 칸만, 같은 열엔
  // 같은 정보(값이 없으면 빈 칸 · 다음 값을 당기지 않는다). 원생은 이름 | 학교학년 | 재원 상태 | 듣는 반(원생 상세와 같은 값).
  // 넘친 칸은 말줄임 · 마우스를 올리면 전부(.ws-att-tip). 고른 기록도 영역별로 같은 열.
  // 여러 영역을 함께 20건까지. 값 = "영역|기록"(name="attach") — 서버가 저장소에서 다시 찾아 확인된 값만 남긴다(flow-commands attachments).
  const ATTACH_MAX=20,attachState=new Map();
  const ATTACH_STUDENT={enrolled:'재원',withdrawn:'퇴원',paused:'휴원',on_hold:'휴원',leave:'휴원',pending:'등록 예정',waiting:'대기'};
  const ATTACH_HEAD={enrollment:{detail:'학년·학교',date:'접수일'}};
  const ymd=d=>{const s=String(d||'');return /^\d{4}-\d{2}-\d{2}/.test(s)?`${s.slice(2,4)}.${s.slice(5,7)}.${s.slice(8,10)}`:s;};
  const schoolGrade=(school,grade)=>{const s=String(school||''),g=String(grade||''),m=/^([초중고])(\d)$/.exec(g);return m&&s.endsWith(m[1])?`${s}${m[2]}`:[s,g].filter(Boolean).join(' ');};
  let attachStudents=null,attachClasses=null;
  const studentOf=id=>{attachStudents??=new Map((db.students||[]).map(s=>[String(s.id),s]));return attachStudents.get(String(id));};
  function attachCell(fam,r,key){
    if(fam==='students'){
      const s=studentOf(r.id);
      if(key==='sg')return s?schoolGrade(s.school,s.grade):String(r.detail||'');
      if(key==='st')return s?ATTACH_STUDENT[s.status]||String(r.status||''):String(r.status||'');
      if(key==='cls'){if(!s)return '';attachClasses??=new Map((db.classes||[]).map(k=>[String(k.id),k]));return (s.classes||[]).map(k=>attachClasses.get(String(k))?.name).filter(Boolean).join(', ');}
    }
    if(key==='detail')return r.detail&&r.detail!==r.label?String(r.detail):'';
    if(key==='status')return String(r.status||'');
    if(key==='date')return ymd(r.date);
    if(key.startsWith('f:')){const f=(r.fields||[]).find(x=>x&&x.label===key.slice(2));return f&&f.value&&f.value!=='—'?String(f.value):'';}
    return '';
  }
  // 열 = 그 묶음 기록에 값이 하나라도 있는 칸(칸은 넷까지). 짧은 값만 담기는 열은 좁게 고정, 나머지는 남는 폭을 나눈다.
  function attachColumns(fam,records){
    const cols=fam==='students'?[{key:'sg',label:'학교학년'},{key:'st',label:'상태'},{key:'cls',label:'반'}]:(()=>{
      const head=ATTACH_HEAD[fam]||{},out=[{key:'detail',label:head.detail||'내용'},{key:'status',label:'상태'},{key:'date',label:head.date||'날짜'}],labels=[];
      records.forEach(r=>(r.fields||[]).forEach(f=>{if(f?.label&&!labels.includes(f.label))labels.push(f.label);}));
      return [...out,...labels.map(l=>({key:`f:${l}`,label:l}))];})();
    const used=cols.filter(c=>records.some(r=>attachCell(fam,r,c.key))).slice(0,fam==='students'?3:6);
    const sized=used.map(c=>{const n=Math.max(c.label.length,...records.map(r=>attachCell(fam,r,c.key).length));return {...c,w:n<=9?`${Math.max(4,n+1)}em`:'minmax(0,1fr)'};});
    if(sized.length&&!sized.some(c=>c.w.startsWith('minmax')))sized[sized.length-1].w=`minmax(${sized[sized.length-1].w},1fr)`;
    return sized;
  }
  const attachKind=fam=>area(fam)?.label||'기록';
  const attachRoot=scope=>document.querySelector(`.ws-attach[data-attach-scope="${CSS.escape(scope)}"]`);
  const attachValues=root=>new Set([...(root?.closest('form')||root||document).querySelectorAll('input[name="attach"]')].map(i=>i.value));
  // 한 영역 묶음 = 머리(영역 · 건수 · 더 보기) + 열 이름 줄 + 기록 줄. pick = 찾은 결과(눌러 붙이기), picked = 붙인 기록(빼기).
  function attachGroup(fam,records,{mode,picked=new Set(),total=null,more=false}){
    const cols=attachColumns(fam,records),pick=mode==='pick',tpl=[pick?'18px':'','7.5em',...cols.map(c=>c.w),pick?'':'28px'].filter(Boolean).join(' ');
    const cell=t=>`<span class="ws-att-cell">${h(t)}</span>`;
    const head=`<div class="ws-att-row ws-att-head" aria-hidden="true">${pick?'<span></span>':''}<span class="ws-att-cell">이름</span>${cols.map(c=>cell(c.label)).join('')}${pick?'':'<span></span>'}</div>`;
    const rows=records.map(r=>{const v=`${fam}|${r.id}`,cells=cols.map(c=>cell(attachCell(fam,r,c.key))).join('');
      return pick?`<button type="button" class="ws-att-row ws-att-opt" role="option" data-attach-pick="${h(v)}" aria-selected="${picked.has(v)}"><span class="ws-att-check" aria-hidden="true">${icon('check')}</span><strong class="ws-att-cell">${h(r.label)}</strong>${cells}</button>`
        :`<div class="ws-att-row" role="listitem"><input type="hidden" name="attach" value="${h(v)}"><strong class="ws-att-cell">${h(r.label)}</strong>${cells}<button type="button" class="ws-att-remove" data-attach-remove="${h(v)}" aria-label="${h(r.label)} 빼기">${icon('close')}</button></div>`;}).join('');
    return `<section class="ws-att-group" style="--att-cols:${tpl}" aria-label="${h(attachKind(fam))}"><h5><span>${h(attachKind(fam))}</span>${total!==null?`<b>${fmt(total)}건</b>`:''}${more?`<button type="button" class="ax-text-link" data-attach-more="${h(fam)}">더 보기</button>`:''}</h5>${head}${rows}</section>`;
  }
  function paintAttachResults(scope){
    const root=attachRoot(scope),st=attachState.get(scope),box=root?.querySelector('.ws-att-results');if(!box||!st)return;
    if(!st.open){box.hidden=true;root.querySelector('[data-attach-q]')?.setAttribute('aria-expanded','false');return;}
    const picked=attachValues(root);
    box.innerHTML=st.loading&&!st.groups?'<p class="ws-att-note" role="status">찾는 중…</p>':st.error?`<p class="ws-att-note" role="alert">${h(st.error)}</p>`:!st.groups?.length?'<p class="ws-att-note">찾은 기록이 없습니다.</p>':st.groups.map(g=>attachGroup(g.familyId,g.items,{mode:'pick',picked,total:g.total,more:g.total>g.items.length&&Boolean(st.q)})).join('');
    box.hidden=false;root.querySelector('[data-attach-q]')?.setAttribute('aria-expanded','true');api.attachScroll?.();
  }
  // 빈 칸 = 그 영역 화면에서 연 요청이면 그 영역의 최근 기록, 아니면 안내만. 낱말이 있으면 모든 영역에서 찾는다(잠깐 멈춘 뒤 · 앞 요청은 취소).
  function runAttachSearch(scope){
    const root=attachRoot(scope),st=attachState.get(scope);if(!root||!st)return;
    clearTimeout(st.timer);st.ctrl?.abort();st.error='';
    if(!st.q){const fam=root.dataset.attachFirst;st.loading=false;if(!fam||!previews(fam).length)st.open=false;st.groups=fam&&previews(fam).length?[{familyId:fam,total:Number(data(fam)?.totalRecords)||previews(fam).length,items:previews(fam).slice(0,8)}]:[];paintAttachResults(scope);return;}
    st.loading=true;paintAttachResults(scope);
    st.timer=setTimeout(async()=>{const ctrl=new AbortController();st.ctrl=ctrl;const q=st.q,first=root.dataset.attachFirst||'';
      try{const r=await fetch(`/api/workspaces/records/search?q=${encodeURIComponent(q)}${first?`&first=${encodeURIComponent(first)}`:''}`,{signal:ctrl.signal,headers:{Accept:'application/json'}});const b=await r.json().catch(()=>null);if(ctrl.signal.aborted||st.q!==q)return;if(!r.ok)throw new Error(b?.message||'기록을 찾지 못했습니다.');st.groups=(b.groups||[]).filter(g=>has(g.familyId));st.error='';}
      catch(e){if(ctrl.signal.aborted)return;st.groups=null;st.error=e?.message||'기록을 찾지 못했습니다.';}
      st.loading=false;paintAttachResults(scope);},200);
  }
  async function attachMore(scope,fam){
    const st=attachState.get(scope);if(!st?.q)return;
    try{const r=await fetch(`/api/workspaces/${encodeURIComponent(fam)}/records?q=${encodeURIComponent(st.q)}&pageSize=50`,{headers:{Accept:'application/json'}});const b=await r.json().catch(()=>null);if(!r.ok)throw new Error(b?.message||'기록을 찾지 못했습니다.');const g=st.groups?.find(x=>x.familyId===fam);if(g)g.items=b.items||[];paintAttachResults(scope);}
    catch(e){toast(e?.message||'기록을 찾지 못했습니다.');}
  }
  // 붙인 기록 = 영역별 묶음(고른 순서) · 같은 열 규칙. 숨은 값(name="attach")은 줄 안에 있다.
  function paintAttachPicked(root){
    const st=attachState.get(root.dataset.attachScope),box=root.querySelector('.ws-att-picked');if(!st||!box)return;
    const byFam=new Map();for(const [,x] of st.picked){if(!byFam.has(x.fam))byFam.set(x.fam,[]);byFam.get(x.fam).push(x.r);}
    box.innerHTML=[...byFam].map(([fam,records])=>attachGroup(fam,records,{mode:'picked'})).join('');box.hidden=!st.picked.size;
    root.querySelector('.ws-att-count').textContent=st.picked.size?`${fmt(st.picked.size)}건`:'';
  }
  function toggleAttach(root,btn){
    const st=attachState.get(root.dataset.attachScope),v=btn.dataset.attachPick;if(!st)return;
    if(st.picked.has(v)){st.picked.delete(v);btn.setAttribute('aria-selected','false');paintAttachPicked(root);return;}
    const all=attachValues(root);if(all.has(v)){btn.setAttribute('aria-selected','true');return;}
    if(all.size>=ATTACH_MAX){toast(`기록은 ${ATTACH_MAX}건까지 붙일 수 있습니다.`);return;}
    const sep=v.indexOf('|'),fam=v.slice(0,sep),id=v.slice(sep+1),r=st.groups?.find(g=>g.familyId===fam)?.items.find(x=>String(x.id)===id);if(!r)return;
    st.picked.set(v,{fam,r});btn.setAttribute('aria-selected','true');paintAttachPicked(root);
  }
  function attachField(scope,fam=''){
    const start=has(fam)?fam:'';attachState.set(scope,{q:'',groups:null,picked:new Map(),open:false,hold:false,loading:false,error:'',timer:0,ctrl:null});
    return `<div class="ws-attach" data-attach-scope="${h(scope)}" data-attach-first="${h(start)}"><label class="ws-att-label" for="${h(scope)}-attach-q">기록 첨부 <span class="ws-att-count"></span></label><input type="search" id="${h(scope)}-attach-q" class="ws-att-q" data-attach-q="${h(scope)}" placeholder="이름·내용으로 찾기" autocomplete="off" maxlength="100" role="combobox" aria-expanded="false" aria-controls="${h(scope)}-attach-results"><div class="ws-att-results live-scroll" id="${h(scope)}-attach-results" role="listbox" aria-multiselectable="true" aria-label="찾은 기록" hidden></div><div class="ws-att-picked" role="list" aria-label="붙인 기록" hidden></div></div>`;
  }
  const attachScopeOf=el=>el.closest?.('.ws-attach')?.dataset.attachScope||'';
  document.addEventListener('input',event=>{const scope=event.target.dataset?.attachQ;if(!scope)return;const st=attachState.get(scope);if(!st)return;st.q=event.target.value.trim();st.open=true;runAttachSearch(scope);});
  document.addEventListener('focusin',event=>{const scope=event.target.dataset?.attachQ;if(!scope)return;const st=attachState.get(scope);if(!st||st.open)return;if(st.hold){st.hold=false;return;}st.open=true;if(st.groups&&st.q)paintAttachResults(scope);else runAttachSearch(scope);});
  document.addEventListener('click',event=>{
    const t=event.target;if(!t.closest)return;
    const pick=t.closest('[data-attach-pick]');if(pick){event.preventDefault();toggleAttach(pick.closest('.ws-attach'),pick);return;}
    const rm=t.closest('[data-attach-remove]');if(rm){event.preventDefault();const root=rm.closest('.ws-attach'),v=rm.dataset.attachRemove,st=attachState.get(root.dataset.attachScope);st?.picked.delete(v);root.querySelector(`[data-attach-pick="${CSS.escape(v)}"]`)?.setAttribute('aria-selected','false');paintAttachPicked(root);const q=root.querySelector('[data-attach-q]');if(q&&document.activeElement!==q){if(st&&!st.open)st.hold=true;q.focus({preventScroll:true});}return;}
    const more=t.closest('[data-attach-more]');if(more){event.preventDefault();attachMore(attachScopeOf(more),more.dataset.attachMore);}
  });
  // 말줄임된 칸에 마우스를 올리면 전부를 띄운다(브라우저 기본 툴팁 대신 · 클릭·스크롤을 막지 않음). 대화 창 위에 보이게 그 창 안에 둔다.
  let attachTip=null,attachTipFor=null;
  const hideAttachTip=()=>{attachTipFor=null;if(attachTip)attachTip.hidden=true;};
  // 공통 리스트(.ws-table)의 칸 · 열 머리 메뉴의 값(긴 글 열)도 같은 팁 — 키보드로 이름 단추·값 칸에 와도 잘렸으면 전부를 띄운다.
  function showAttachTip(el){
    if(el===attachTipFor)return;
    if(!el||el.scrollWidth<=el.clientWidth+1){hideAttachTip();return;}
    const host=el.closest('dialog')||document.body;if(!attachTip||attachTip.parentElement!==host){attachTip?.remove();attachTip=document.createElement('div');attachTip.className='ws-att-tip';attachTip.setAttribute('role','tooltip');host.append(attachTip);}
    attachTip.textContent=el.textContent;attachTip.hidden=false;attachTipFor=el;
    const r=el.getBoundingClientRect(),w=attachTip.offsetWidth,hh=attachTip.offsetHeight;let top=r.bottom+6;if(top+hh>innerHeight-8)top=Math.max(8,r.top-hh-6);
    attachTip.style.left=`${Math.min(Math.max(8,r.left),innerWidth-w-8)}px`;attachTip.style.top=`${top}px`;
  }
  document.addEventListener('pointerover',event=>showAttachTip(event.target.closest?.(':is(.ws-attach .ws-att-cell,.ws-table .ws-cut,.ws-colpop-list label>span)')||null));
  document.addEventListener('focusin',event=>{const el=event.target.closest?.('.ws-table .ws-rowmain')||(event.target.matches?.('.ws-colpop-list input')?event.target.nextElementSibling:null);if(el)showAttachTip(el);else if(attachTipFor?.closest?.('.ws-table,.ws-colpop'))hideAttachTip();});
  document.addEventListener('pointerdown',()=>{if(attachTipFor?.closest?.('.ws-table,.ws-colpop'))hideAttachTip();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&attachTipFor?.closest?.('.ws-colpop'))hideAttachTip();});
  addEventListener('scroll',hideAttachTip,{passive:true,capture:true});
  // 칸 밖을 누르면 결과만 접는다(고른 목록은 그대로). Esc = 결과 접기(요청 창은 닫지 않는다).
  document.addEventListener('pointerdown',event=>{for(const [scope,st] of attachState){if(!st.open)continue;const root=attachRoot(scope);if(!root){attachState.delete(scope);continue;}if(!root.contains(event.target)){st.open=false;paintAttachResults(scope);}}},true);
  document.addEventListener('keydown',event=>{
    const root=event.target.closest?.('.ws-attach');if(!root)return;const scope=root.dataset.attachScope,st=attachState.get(scope);if(!st)return;
    const opts=[...root.querySelectorAll('.ws-att-results:not([hidden]) [data-attach-pick]')],i=opts.indexOf(event.target);
    if(event.key==='Escape'&&st.open){event.preventDefault();event.stopPropagation();st.open=false;paintAttachResults(scope);const q=root.querySelector('[data-attach-q]');if(q&&document.activeElement!==q){st.hold=true;q.focus({preventScroll:true});}return;}
    if(event.key==='ArrowDown'&&opts.length){event.preventDefault();opts[Math.min(opts.length-1,i+1)]?.focus();return;}
    if(event.key==='ArrowUp'&&opts.length&&i>=0){event.preventDefault();(i===0?root.querySelector('[data-attach-q]'):opts[i-1]).focus();return;}
    if(event.key==='Enter'&&event.target.matches('[data-attach-q]')){event.preventDefault();opts[0]?.focus();}
  },true);
  /** Opens a family's workspace, optionally on one record facet (업무 흐름의 '처리 화면' · 일 카드의 '○○ 열기').
      걸러보기는 이 영역에 있는 구분일 때만 건다(없는 구분은 기록 조회가 거절한다) — 2.0 화면 면(탭) 이름이면 그 화면 줄을 고른다.
      전에 쳐 둔 검색어·쪽은 비운다 — 남아 있으면 찾아온 기록이 목록에서 빠진다. */
  function openFamily(id,facet=''){
    if(!has(id))return false;const a=area(id),f=String(facet||'');
    state.q[id]='';state.page[id]=1;delete state.pin[id];
    state.facet[id]=f&&facetsOf(a).some(x=>x.id===f)?f:'';
    if(f&&!state.facet[id]&&screensOf(a).some(x=>x.id===f)){if(viewKind(a)==='settings')state.face[id]=f;else state.screen[id]=f;}
    // 걸러보기를 싣고 왔으면 그 목록이 첫 화면에 오게 목록 구역으로 곧바로 옮긴다(경로 전환이라 애니메이션 없이 — 스크롤 원칙). 화면을 다 그린 뒤에.
    const page=`workspace-${id}`,land=()=>{if(state.facet[id]&&api.getPage()===page)document.getElementById('ws-main')?.scrollIntoView({block:'start',behavior:'instant'});};
    if(location.hash===`#${page}`){api.navigate(page);land();}else{addEventListener('hashchange',land,{once:true});api.navigate(page);}
    return true;
  }
  /** 다른 화면에서 기록 하나를 연다 — 상세 서랍을 열고, 그 작업 공간이 열려 있으면 목록 맨 위에 그 줄을 세워 화면 안으로 옮긴다. */
  const showRecordFrom=(familyId,recordId)=>showRecord(familyId,recordId,true);
  return {has,familyOf,view,sidebar,homeSignals,searchItems,coverage,area,areas,showRecord:showRecordFrom,kpiCard,data,openFamily,attachField,listTable,billingDetails};
};
