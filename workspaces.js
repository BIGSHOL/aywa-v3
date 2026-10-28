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
  const MODE={preview:{label:'로컬 미리보기',destination:'local-preview',status:'session-only'},request:{label:'요청 초안',destination:'owner-request-draft',status:'draft-only'},navigate:{label:'화면 이동',destination:'navigate',status:'navigation'}};
  const PAGE_SIZE=20;
  const state={screen:{},face:{},query:'',active:-1,open:new Set(),closed:new Set(),recent:[],facet:{},q:{},page:{},sel:{},remote:{},local:{},edits:{},recipient:''};
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const btn=(text,action,attrs='',primary=false)=>`<button type="button" class="button ${primary?'primary':''}" data-ws="${action}" ${attrs}>${h(text)}</button>`;
  const norm=t=>String(t??'').toLowerCase().replace(/\s+/g,'');
  const caption=()=>`${(db.workspaces?.asOf||db.meta.asOf).replaceAll('-','.')} 복사본 기준`;

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
    const d=data(id);if(!d)return {key:'missing',note:'이 작업 공간의 기록 집계는 아직 이 화면에 연결되지 않았습니다.'};
    const key=STATE_LABEL[d.dataState]?d.dataState:'unavailable';
    return {key,note:d.coverageNote||(key==='empty'?'복사본에 이 영역의 기록이 없습니다.':key==='not-applicable'?'이 지점의 운영에 해당하지 않는 영역입니다.':key==='unavailable'?'이 영역의 기록을 읽지 못했습니다.':'')};
  }
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
  const recordById=(id,rid)=>[...previews(id),...(state.remote[id]?.data?.items||[]),...(exact[id]?.values()||[])].find(r=>String(r.id)===String(rid));

  /* ---------- records: previews first, full list through the read-only endpoint when it is served ---------- */
  function remoteKey(id){return `${state.q[id]||''}|${state.facet[id]||''}|${state.page[id]||1}`;}
  function needsRemote(id){const d=data(id);return Boolean(d)&&!state.unsupported&&(Number(d.totalRecords)>previews(id).length||state.q[id]||state.facet[id]||(state.page[id]||1)>1);}
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
    const q=norm(state.q[id]),facet=state.facet[id];
    const items=previews(id).filter(r=>(!facet||(r.facetIds||[]).includes(facet))&&(!q||norm([r.label,r.detail,r.status,r.date,...(r.fields||[]).map(f=>f.value)].join(' ')).includes(q)));
    return {items,total:Number(data(id)?.totalRecords)||previews(id).length,filtered:items.length,pageCount:1,source:'preview'};
  }

  /* ---------- workspace page ---------- */
  function view(id){
    const a=area(id);if(!a)return '';
    state.recent=[id,...state.recent.filter(x=>x!==id)].slice(0,4);
    if(needsRemote(id))queueMicrotask(()=>loadRecords(id));
    const d=data(id),st=dataState(id),kind=viewKind(a);
    return `<div class="ws" data-family="${h(id)}" data-view="${kind}"><div class="page-heading ws-heading"><div><p class="ws-group">${h(a.group||'')}</p><h1>${h(a.label)}</h1><p>${h(d?.summary||a.summary||'')}</p></div><div class="heading-actions">${btn('이 화면으로 대화','ask',`data-id="${h(id)}"`)}${btn('업무 요청','request',`data-id="${h(id)}"`,true)}</div></div><p class="ws-state">${pill(STATE_LABEL[st.key],st.key==='available'?'blue':st.key==='missing'||st.key==='unavailable'?'amber':'')}<span>${h(d?.sourceLabel||'')}${d?.sourceLabel?' · ':''}${caption()}</span>${st.note?`<span>${h(st.note)}</span>`:''}</p>${critical(a)}${signalList(a)}<div class="ws-body"><section class="ws-main" id="ws-main" aria-label="${h(a.label)} 기록">${mainHtml(a)}</section><aside class="ws-side">${actionPanel(a)}<div id="ws-local">${localLog(a)}</div>${linkedRequests(a)}${relations(a)}</aside></div></div>`;
  }
  function critical(a){
    const d=data(a.id),metrics=(d?.metrics||[]).slice(0,4),trend=d?.trend;
    if(!metrics.length&&!trend?.points?.length)return '';
    const value=m=>m.value===null||m.value===undefined?'기록 없음':`${fmt(m.value)}${m.unit||''}`;
    const points=(trend?.points||[]).map(p=>trend.granularity==='day'?{date:p.date,value:p.value}:{month:p.date,value:p.value});
    const chartHtml=!points.length?'':trend.granularity==='day'?`<div class="ws-line">${api.lineChart(points,{key:'value',label:trend.label,unit:trend.unit||''})}</div>`:api.chart(points.map(p=>({...p,label:`${Number(String(p.month).slice(5,7))}월`})),'value',trend.unit==='원'?'만원':trend.unit||'',{label:trend.label});
    // KPI = 최근 변화(원장 10-28 "원하는건 추세"): 지금 값 · 직전 기간 대비(좋아짐/나빠짐 색) · 추세선(기간마다 값은 마우스·키보드로).
    const kpiCard=m=>{const pct=m.unit==='%',shown=v=>v===null?'기록 없음':`${pct?v.toFixed(1):fmt(v)}${m.unit||''}`,d=m.delta,dir=d===null||d===0?0:d>0?1:-1,good=m.better==='up'?dir>0:m.better==='down'?dir<0:null,per=m.period==='month'?'전월':'지난 7일';
      const change=d===null?'비교할 기간 기록 없음':dir===0?`${per} 대비 변화 없음`:`${per} 대비 ${dir>0?'▲':'▼'} ${pct?`${Math.abs(d).toFixed(1)}%p`:`${fmt(Math.abs(d))}${m.unit||''}`}${!pct&&m.previous>0?` (${Math.round(Math.abs(d)/m.previous*100)}%)`:''}`;
      return `<div class="ws-metric ws-kpi"><span>${h(m.label)}</span><strong>${h(shown(m.value))}</strong><small class="ws-kpi-change${dir===0||good===null?'':good?' good':' bad'}">${h(change)}</small><span class="ws-kpi-spark">${api.lineChart(m.points,{key:'value',label:m.label,unit:m.unit||'',basis:m.basis||''})}</span>${m.basis?`<small>${h(m.basis)}</small>`:''}</div>`;};
    return `<section class="ws-critical" aria-label="핵심 지표">${metrics.length?`<div class="ws-metrics">${metrics.map(m=>m.kind==='kpi'?kpiCard(m):`<div class="ws-metric"><span>${h(m.label)}</span><strong>${h(value(m))}</strong>${m.detail?`<small>${h(m.detail)}</small>`:''}</div>`).join('')}</div>`:''}${chartHtml?`<div class="ws-trend"><h2>${h(trend.label||'추이')}</h2>${chartHtml}</div>`:''}</section>`;
  }
  const byPriority=(x,y)=>(PRIORITY_ORDER.indexOf(x.priority)+1||9)-(PRIORITY_ORDER.indexOf(y.priority)+1||9);
  function signalCard(id,s,withFamily=false){
    const a=area(id);
    return `<article class="ws-signal"><div class="ax-issue-meta">${pill(s.priority||'확인 필요',s.priority==='결정 필요'?'amber':'blue')}${withFamily?pill(a?.label||id):''}${s.recordIds?.length?`<span>근거 ${s.recordIds.length}건</span>`:''}</div><h3>${h(s.title)}</h3><p>${h(s.summary||'')}</p>${s.source?`<p class="ax-source">${h(s.source)}</p>`:''}<div class="ax-actions">${btn('근거 보기','signal-evidence',`data-id="${h(id)}" data-signal="${h(s.id)}"`)}${btn('업무 요청','signal-request',`data-id="${h(id)}" data-signal="${h(s.id)}"`,true)}</div></article>`;
  }
  function signalList(a){const list=[...(data(a.id)?.signals||[])].sort(byPriority);return list.length?`<section class="ws-signals" aria-label="이 작업 공간의 신호"><h2>지금 올라온 신호 ${list.length}건</h2><div class="ws-signal-grid">${list.map(s=>signalCard(a.id,s)).join('')}</div></section>`:'';}

  function mainHtml(a){
    const id=a.id,kind=viewKind(a),facets=facetsOf(a),rec=visibleRecords(id),slot=state.remote[id];
    const st=dataState(id),facet=state.facet[id]||'';
    const screens=screensOf(a),screen=state.screen[id]||'';
    const screenRow=screens.length&&kind!=='settings'?`<div class="ws-screens" role="group" aria-label="2.0 화면 구성"><span>2.0 화면</span>${screens.map(sc=>screenActions(a,sc.id).length?`<button type="button" data-ws="screen" data-id="${h(id)}" data-screen="${h(sc.id)}" aria-pressed="${screen===sc.id}">${h(sc.label)}</button>`:`<span class="ws-screen">${h(sc.label)}</span>`).join('')}</div>`:'';
    const tabs=facets.length?`<div class="ws-facets" role="group" aria-label="기록 구분">${[{id:'',label:'전체',count:Number(data(id)?.totalRecords)||null},...facets].map(f=>`<button type="button" data-ws="facet" data-id="${h(id)}" data-facet="${h(f.id)}" aria-pressed="${facet===f.id}">${h(f.label)}${f.count!==null&&f.count!==undefined?` <b>${fmt(f.count)}</b>`:''}</button>`).join('')}</div>`:'';
    const search=data(id)&&kind!=='settings'?`<div class="ws-search"><input type="search" id="ws-q-${h(id)}" data-ws-q="${h(id)}" value="${h(state.q[id]||'')}" maxlength="100" aria-label="${h(a.label)} 기록 검색" placeholder="이름·내용·상태 검색" autocomplete="off"><span>${rec.source==='full'?`${fmt(rec.filtered)}건 · 전체 ${fmt(rec.total)}건`:`${fmt(rec.items.length)}건 표시 · 전체 ${fmt(rec.total)}건`}</span></div>`:'';
    const note=rec.source==='preview'&&rec.total>previews(id).length?`<p class="ax-note">${slot?.status==='loading'?'전체 기록을 불러오는 중입니다.':slot?.status==='error'?h(slot.message):'전체 기록 조회가 아직 이 서버에 연결되지 않아 최근 기록만 표시합니다.'}${slot?.status==='error'?` ${btn('다시 시도','reload',`data-id="${h(id)}"`)}`:''}</p>`:'';
    let body;
    if(!data(id))body=`<div class="live-empty"><strong>기록 집계 연결 전</strong><p>‘할 수 있는 일’에서 미리보기를 만들거나 담당자에게 요청할 수 있습니다.</p></div>`;
    else if(!rec.items.length)body=`<div class="live-empty"><strong>${st.key==='empty'?'복사본에 기록이 없습니다':'이 조건의 기록이 없습니다'}</strong><p>${st.key==='empty'?'없는 기록을 만들어 보여 주지 않습니다. ‘할 수 있는 일’에서 첫 기록을 미리 작성하거나 담당자에게 요청할 수 있습니다.':'구분이나 검색어를 바꿔 보세요.'}</p></div>`;
    else body={flow:flowView,sheet:sheetView,records:recordsView,report:reportView,settings:recordsView,timeline:timelineView}[kind](a,rec.items,facets);
    const pager=rec.source==='full'&&rec.pageCount>1?`<div class="live-pager">${btn('이전','page',`data-id="${h(id)}" data-page="${(state.page[id]||1)-1}" ${(state.page[id]||1)<=1?'disabled':''}`)}<span>${state.page[id]||1} / ${rec.pageCount}</span>${btn('다음','page',`data-id="${h(id)}" data-page="${(state.page[id]||1)+1}" ${(state.page[id]||1)>=rec.pageCount?'disabled':''}`)}</div>`:'';
    return `${id==='teacher-workspace'?recipientPreview():''}${kind==='settings'?settingsView(a):screenRow}${kind==='settings'&&data(id)?`<h3 class="ws-records-title">복사본에서 읽은 설정 기록</h3>`:''}${tabs}${search}${note}${body}${pager}`;
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
    return `<section class="ws-recipient" aria-labelledby="ws-recipient-title"><div class="ax-section-head"><h2 id="ws-recipient-title">받는 사람 수신함 미리보기</h2>${recipientPicker(staffId,owners)}</div><p class="ax-note">원장님이 보낸 요청을 이 직원이 받는 화면을 미리 봅니다. 확인과 완료 보고는 이 시안에서만 반영되고 원장 알림으로 돌아옵니다.</p>${list.length?list.map(r=>`<article class="ws-inbox-item"><header>${pill(status[r.status],r.status==='done'?'green':'blue')}<strong>${h(r.title)}</strong><small>${h(r.due)}까지 · ${h(r.priority)}${r.context?.familyLabel?` · ${h(r.context.familyLabel)}`:''}</small></header><p class="live-pre">${h(r.body)}</p>${r.status==='requested'?btn('확인했습니다','recipient-ack',`data-request="${h(r.id)}"`,true):r.status==='working'?`<form class="ws-form" data-ws-form="recipient-report" data-request="${h(r.id)}" novalidate><label>완료 보고<textarea name="result" rows="2" maxlength="3000" required></textarea></label><p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">보고는 원장 알림으로 갑니다(시안).</span><button class="button primary" type="submit">완료 보고</button></div></form>`:`<p class="ax-note">보고 내용: ${h(r.result)}</p>`}</article>`).join(''):`<p class="live-empty">이 직원에게 보낸 원장 요청이 없습니다. 업무 요청에서 이 직원을 담당자로 고르면 여기에 표시됩니다.</p>`}<section class="ws-auto"><h3>자동 할 일 ${auto.length}건</h3><p class="ax-note">2.0이 원본 기록을 보고 열고 닫는 할 일입니다. 여기서 완료 처리하지 않습니다.</p>${auto.slice(0,6).map(t=>`<button type="button" class="ws-record" data-task="${h(t.id)}"><span><strong>${h(t.title)}</strong><small>${h(t.detail||'')}</small></span><span class="ws-record-meta">${t.due?`<small>${h(t.due)}까지</small>`:''}</span>${icon('chevron')}</button>`).join('')}${auto.length>6?`<p class="ax-note">나머지 ${auto.length-6}건은 할 일 목록에서 확인합니다.</p>`:''}</section></section>`;
  }
  const localCount=(id,rid)=>(state.local[id]||[]).filter(e=>e.recordId===String(rid)).length;
  function recordButton(id,r){
    const n=localCount(id,r.id);
    return `<button type="button" class="ws-record" data-ws="record" data-id="${h(id)}" data-record="${h(r.id)}"><span><strong>${h(r.label)}</strong>${r.detail?`<small>${h(r.detail)}</small>`:''}</span><span class="ws-record-meta">${r.status?pill(r.status):''}${r.date?`<small>${h(r.date)}</small>`:''}${n?pill(`미리보기 ${n}`,'green'):''}</span>${icon('chevron')}</button>`;
  }
  function recordsView(a,items){return `<div class="ws-records">${items.map(r=>recordButton(a.id,r)).join('')}</div>`;}
  function timelineView(a,items){
    const sorted=[...items].sort((x,y)=>String(y.date).localeCompare(String(x.date)));const months=[...new Set(sorted.map(r=>String(r.date).slice(0,7)||'날짜 없음'))];
    return `<ol class="ws-timeline">${months.map(m=>`<li><h3>${m.length===7?`${m.slice(0,4)}년 ${Number(m.slice(5))}월`:'날짜 없음'}</h3>${sorted.filter(r=>(String(r.date).slice(0,7)||'날짜 없음')===m).map(r=>recordButton(a.id,r)).join('')}</li>`).join('')}</ol>`;
  }
  function flowView(a,items){
    const facets=stagesOf(a),stages=facets.length?facets:[{id:'',label:'전체'}];
    const inStage=(r,f)=>f.id?(r.facetIds||[]).includes(f.id):true;
    const loose=facets.length?items.filter(r=>!facets.some(f=>inStage(r,f))):[];
    return `<div class="ws-flow live-scroll" data-scroll-key="flow-${h(a.id)}" tabindex="0" aria-label="단계별 흐름">${stages.map((f,i)=>`<section class="ws-stage"><header><span>${i+1}</span><h3>${h(f.label)}</h3>${f.count!==null&&f.count!==undefined?`<b>${fmt(f.count)}</b>`:''}</header>${items.filter(r=>inStage(r,f)).slice(0,8).map(r=>recordButton(a.id,r)).join('')||'<p>이 단계의 기록이 없습니다.</p>'}</section>`).join('')}${loose.length?`<section class="ws-stage"><header><span>·</span><h3>단계 미지정</h3><b>${loose.length}</b></header>${loose.slice(0,8).map(r=>recordButton(a.id,r)).join('')}</section>`:''}</div>`;
  }
  function sheetView(a,items){
    const cols=[...new Set(items.flatMap(r=>(r.fields||[]).map(f=>f.label)))].slice(0,7),edits=state.edits[a.id]||{},changed=Object.values(edits).reduce((n,row)=>n+Object.keys(row).length,0);
    const cell=(r,c)=>{const original=(r.fields||[]).find(f=>f.label===c)?.value??'—',value=edits[r.id]?.[c];return `<td><button type="button" class="ws-cell ${value!==undefined?'changed':''}" data-ws="cell" data-id="${h(a.id)}" data-record="${h(r.id)}" data-col="${h(c)}" aria-label="${h(r.label)} ${h(c)} ${h(value??original)} · Enter로 수정">${h(value??original)}</button></td>`;};
    return `<p class="ax-note">칸을 누르거나 Enter로 값을 고쳐 보세요. 바꾼 칸은 이 화면에만 표시되고, ‘변경분 미리보기 저장’으로 기록을 남깁니다.</p><div class="ws-sheet live-scroll" data-scroll-key="sheet-${h(a.id)}" tabindex="0"><table><thead><tr><th scope="col">항목</th>${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}<th scope="col">상태</th></tr></thead><tbody>${items.map(r=>`<tr><th scope="row"><button type="button" class="ws-row-head" data-ws="record" data-id="${h(a.id)}" data-record="${h(r.id)}">${h(r.label)}</button></th>${cols.map(c=>cell(r,c)).join('')}<td>${r.status?pill(r.status):'—'}</td></tr>`).join('')}</tbody></table></div><div class="ws-sheet-bar"><span>${changed?`바뀐 칸 ${changed}개`:'바뀐 칸 없음'}</span>${btn('되돌리기','sheet-reset',`data-id="${h(a.id)}" ${changed?'':'disabled'}`)}${btn('변경분 미리보기 저장','sheet-save',`data-id="${h(a.id)}" ${changed?'':'disabled'}`,true)}</div>`;
  }
  function documentHtml(a,r){
    return `<article class="ws-document" aria-label="${h(r.label)} 미리보기"><header><p>${h(a.label)}</p><h3>${h(r.label)}</h3><p>${[r.date,r.status].filter(Boolean).map(h).join(' · ')}</p></header>${r.detail?`<p class="live-pre">${h(r.detail)}</p>`:''}${(r.fields||[]).length?`<dl>${r.fields.map(f=>`<dt>${h(f.label)}</dt><dd>${h(f.value)}</dd>`).join('')}</dl>`:''}<footer>${btn('이 문서로 요청','record-request',`data-id="${h(a.id)}" data-record="${h(r.id)}"`)}${btn('상세 보기','record',`data-id="${h(a.id)}" data-record="${h(r.id)}"`)}</footer></article>`;
  }
  function reportView(a,items){
    const sel=items.find(r=>String(r.id)===String(state.sel[a.id]))||items[0];
    return `<div class="ws-report"><div class="ws-report-list live-scroll" data-scroll-key="report-${h(a.id)}" tabindex="0" aria-label="문서 목록">${items.map(r=>`<button type="button" data-ws="select" data-id="${h(a.id)}" data-record="${h(r.id)}" aria-pressed="${r===sel}"><strong>${h(r.label)}</strong><small>${[r.date,r.status].filter(Boolean).map(h).join(' · ')}</small></button>`).join('')}</div>${documentHtml(a,sel)}</div>`;
  }
  // Settings faces are the catalog's faces (2.0 setting surfaces); their forms are the actions that target the face.
  function settingsView(a){
    const faces=screensOf(a).length?screensOf(a):[{id:'',label:'설정'}],face=faces.find(f=>f.id===state.face[a.id])||faces[0];
    const forms=actionsOf(a).filter(x=>x.mode==='preview'&&(face.id?targetOf(x).facet===face.id:!targetOf(x).facet));
    const related=actionsOf(a).filter(x=>x.mode!=='preview'&&face.id&&targetOf(x).facet===face.id);
    return `<div class="ws-settings"><nav class="ws-faces live-scroll" data-scroll-key="faces-${h(a.id)}" aria-label="설정 면">${faces.map(f=>`<button type="button" data-ws="face" data-id="${h(a.id)}" data-face="${h(f.id)}" aria-pressed="${f===face}">${h(f.label)}</button>`).join('')}</nav><div class="ws-face"><h3>${h(face.label)}</h3>${related.length?`<div class="ax-actions">${related.map(x=>`<button type="button" class="button" data-ws="action" data-id="${h(a.id)}" data-action="${h(x.id)}">${h(x.label)}</button>`).join('')}</div>`:''}${forms.length?forms.map(x=>`<section class="ws-inline-form"><h4>${h(x.label)}</h4>${previewForm(a,x,'',true)}</section>`).join(''):'<p class="ax-note">이 면을 바꾸는 작업은 ‘할 수 있는 일’에서 요청할 수 있습니다.</p>'}</div></div>`;
  }

  /* ---------- actions: preview forms, owner request drafts, navigation ---------- */
  // Preview and navigate actions carry their own one-line description in draft.body; a request's draft.body is the request text itself.
  const actionIntent=x=>{
    const note=x.mode!=='request'&&typeof x.draft?.body==='string'?x.draft.body.trim():'',fields=(Array.isArray(x.fields)?x.fields:[]).some(f=>f&&f.id&&f.label);
    if(x.mode==='preview')return note||(fields?`2.0의 ‘${x.label}’ 입력 칸을 이 화면에서 채워 봅니다. 2.0에는 반영되지 않습니다.`:'메모를 남겨 이 화면에 미리보기로 기록합니다. 2.0에는 반영되지 않습니다.');
    return x.mode==='navigate'?note||'관련 화면으로 이동합니다.':`담당자에게 보낼 ‘${x.label}’ 초안을 엽니다. 등록 전까지 전달되지 않습니다.`;
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
    if(t==='student')return `<label for="${id}">${label}<input id="${id}" name="${h(f.id)}" list="ws-students" autocomplete="off" maxlength="60" placeholder="이름 입력 후 목록에서 선택" ${req}><small>재원생 목록에서 고릅니다.</small></label>`;
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
    return `<form class="ws-form" data-ws-form="${kind}" data-id="${h(a.id)}" data-action="${h(x.id)}" ${inline?'data-inline="1"':''} novalidate>${fields.map(f=>fieldHtml(a,x,f,recordId,inline?'i':'m')).join('')||'<p class="ax-note">입력할 항목이 없는 작업입니다. 실행 내용을 메모로 남겨 미리보기를 기록합니다.</p><label>메모<textarea name="__note" rows="2" maxlength="500"></textarea></label>'}<p class="ax-form-error" role="alert"></p><div class="ws-form-foot"><span class="ax-note">${kind==='request'?'담당자와 기한은 다음 단계에서 고릅니다. 등록 전까지 전달되지 않습니다.':'로컬 미리보기 · 2.0에는 반영되지 않습니다.'}</span><button class="button primary" type="submit">${kind==='request'?'요청서로 이어 쓰기':'미리보기로 기록'}</button></div></form>`;
  }
  const FIRST_CONTROL='#modal .ws-form :is(input:not([type=hidden]):not([data-cpick-search]),select,textarea,.cpick-trigger)';
  function openAction(familyId,actionId,recordId=''){
    const a=area(familyId),x=a&&actionsOf(a).find(y=>y.id===actionId);if(!x)return;
    if(x.mode==='navigate'){const {page,facet}=targetOf(x),dest=resolvePage(page);if(!dest){toast('이동할 화면을 찾지 못했습니다.');return;}const fam=familyOf(dest),tgt=fam&&area(fam);if(tgt&&facet){if(facetsOf(tgt).some(f=>f.id===facet)){state.facet[fam]=facet;state.page[fam]=1;}else if(screensOf(tgt).some(f=>f.id===facet)){if(viewKind(tgt)==='settings')state.face[fam]=facet;else state.screen[fam]=facet;}}navigate(dest);return;}
    if(x.mode==='preview'){dialog('modal',x.label,`${a.label} · 로컬 미리보기`,`${recordId?`<p class="ws-context">기록: ${h(recordById(familyId,recordId)?.label||'')}</p>`:''}<p class="ax-note">${h(actionIntent(x))}</p>${previewForm(a,x,recordId)}`);$(FIRST_CONTROL)?.focus();return;}
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
      if(v&&f.type==='student'&&!studentFor(v))errors.push(`${f.label} 칸은 재원생 목록에서 골라 주세요.`);
      if(v&&['select'].includes(f.type)&&Array.isArray(f.options)&&f.options.length&&!f.options.some(o=>String(typeof o==='object'?o.value??o.id??o.label:o)===v))errors.push(`${f.label} 선택지를 다시 골라 주세요.`);
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
    refreshSide(a.id);refreshMain(a.id);toast(`‘${x.label}’ 미리보기를 이 화면에 기록했습니다. 2.0에는 반영되지 않았습니다.`);
  }
  function localLog(a){
    const list=state.local[a.id]||[];if(!list.length)return '';
    return `<section class="ws-local" aria-label="이 화면에서 만든 미리보기"><h2>이 화면에서 만든 미리보기 ${list.length}건</h2><p class="ax-note">세션에만 남는 기록입니다. 새로고침하면 사라지고 2.0에는 반영되지 않습니다.</p>${list.map(e=>`<article><header><strong>${h(e.label)}</strong><small>${h(e.at)}</small></header><dl>${e.values.map(v=>`<dt>${h(v.label)}</dt><dd>${h(v.value)}</dd>`).join('')}</dl><div class="ax-actions">${btn('이 내용으로 요청','local-request',`data-id="${h(a.id)}" data-entry="${e.id}"`)}${btn('지우기','local-remove',`data-id="${h(a.id)}" data-entry="${e.id}"`)}</div></article>`).join('')}</section>`;
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
  let recordAsk=0;
  function showRecord(familyId,recordId){
    const a=area(familyId);if(!a){toast('이 기록은 여기서 바로 열 수 없습니다. 해당 작업 공간 목록에서 찾아 주세요.');return Promise.resolve('missing');}
    const r=recordById(familyId,recordId);
    if(r){recordAsk++;renderRecord(a,familyId,r);return Promise.resolve('shown');}
    const ask=++recordAsk,view=()=>{const d=document.getElementById('detail');return [d?.open?d.querySelector('h2')?.textContent??'':null,location.hash,Boolean(document.querySelector('#modal[open]'))];},before=view();
    const same=()=>ask===recordAsk&&view().every((x,i)=>x===before[i]);
    const fail=missing=>{toast(missing?'이 기록을 찾지 못했습니다. 이 업무 영역의 복사본에 없는 기록입니다.':'기록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');return missing?'missing':'failed';};
    return fetch(`/api/workspaces/${encodeURIComponent(familyId)}/records?id=${encodeURIComponent(recordId)}`,{headers:{Accept:'application/json'}})
      .then(async res=>{const j=await res.json().catch(()=>null);if(!same())return 'stale';
        if(res.ok&&j?.item&&String(j.item.id)===String(recordId)){(exact[familyId]||(exact[familyId]=new Map())).set(String(j.item.id),j.item);renderRecord(a,familyId,j.item);return 'shown';}
        return fail(res.status===404);})
      .catch(()=>same()?fail(false):'stale');
  }
  function renderRecord(a,familyId,r){
    const recordId=String(r.id),local=(state.local[familyId]||[]).filter(e=>e.recordId===recordId),open=api.openRecord&&api.canOpenRecord?.(recordId);
    dialog('detail',r.label,`${a.label}${r.date?` · ${r.date}`:''}`,`<div class="ax-issue-meta">${r.status?pill(r.status):''}${(r.facetIds||[]).map(f=>pill(facetsOf(a).find(x=>x.id===f)?.label||f)).join('')}</div>${r.detail?`<p class="live-pre">${h(r.detail)}</p>`:''}${(r.fields||[]).length?`<dl>${r.fields.map(f=>`<dt>${h(f.label)}</dt><dd>${h(f.value)}</dd>`).join('')}</dl>`:''}<div class="ax-actions">${btn('이 기록으로 요청','record-request',`data-id="${h(familyId)}" data-record="${h(r.id)}"`,true)}${open?btn('상세 화면 열기','record-open',`data-record="${h(r.id)}"`):''}</div>${local.length?`<section class="ax-evidence"><h3>이 기록의 미리보기 ${local.length}건</h3>${local.map(e=>`<p><strong>${h(e.label)}</strong> · ${h(e.values.map(v=>`${v.label} ${v.value}`).join(' · '))}</p>`).join('')}</section>`:''}<section class="ws-record-actions"><h3>이 기록으로 할 수 있는 일</h3>${actionsOf(a).map(x=>`<button type="button" class="ws-action" data-ws="action" data-id="${h(familyId)}" data-action="${h(x.id)}" data-record="${h(r.id)}"><strong>${h(x.label)}</strong><small>${h(MODE[x.mode]?.label||'요청 초안')}</small></button>`).join('')}</section>`);
  }
  // Partial refresh of the records region; keeps focus and the horizontal/vertical position of inner scrollers.
  function refreshMain(id){
    const node=$('#ws-main'),a=area(id);if(!node||!a||!$(`.ws[data-family="${CSS.escape(id)}"]`))return;
    const focus=document.activeElement?.id,kept=new Map([...node.querySelectorAll('[data-scroll-key]')].map(n=>[n.dataset.scrollKey,[n.scrollLeft,n.scrollTop]]));
    node.innerHTML=mainHtml(a);
    node.querySelectorAll('[data-scroll-key]').forEach(n=>{const k=kept.get(n.dataset.scrollKey);if(k){n.scrollLeft=k[0];n.scrollTop=k[1];}});
    api.attachScroll();if(focus)document.getElementById(focus)?.focus({preventScroll:true});
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
    return `<section class="ws-home-signals" aria-labelledby="ws-home-signals-title"><div class="ax-section-head"><h2 id="ws-home-signals-title">작업 공간에서 올라온 신호 ${list.length}건</h2><span>복사본의 2.0 기록에서 찾은 신호입니다. 근거를 열거나 담당자에게 요청할 수 있습니다.</span></div><div class="ws-signal-grid">${list.slice(0,6).map(({a,s})=>signalCard(a.id,s,true)).join('')}</div>${list.length>6?`<p class="ax-note">나머지 ${list.length-6}건은 각 작업 공간에서 확인할 수 있습니다.</p>`:''}</section>`;
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
      families[a.id]={page:`workspace-${a.id}`,reachable:api.hasView(`workspace-${a.id}`),label:a.label,group:a.group||'',viewKind:kind,renderer:`${kind}View`,dataState:dataState(a.id).key,facets:[...facetData.map(f=>({id:f.id,label:f.label,kind:'record-filter',intent:FACET_INTENT[kind],status:recs.some(r=>(r.facetIds||[]).includes(f.id))?'filter':'count-only'})),...screensOf(a).map(sc=>({id:sc.id,label:sc.label,kind:sc.kind||'screen',intent:screenActions(a,sc.id).length?`2.0의 ‘${sc.label}’ 화면 — 관련 작업 ${screenActions(a,sc.id).length}가지로 이어집니다`:`2.0의 ‘${sc.label}’ 화면 이름을 보여 줍니다`,status:kind==='settings'?'face':screenActions(a,sc.id).length?'screen':'label-only'}))],operations:ops};
    }
    return {schemaVersion:1,local:true,families,totals:{families:Object.keys(families).length,operations,byDestination,sourceOperationIds:[...new Set(Object.values(families).flatMap(f=>f.operations.flatMap(o=>o.sourceOperationIds)))].length}};
  }
  Object.defineProperty(window,'AxCoverage',{configurable:true,get:coverage});

  /* ---------- events ---------- */
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-ws]');if(!el||el.disabled)return;
    const {ws:action,id,record}=el.dataset;event.preventDefault();event.stopImmediatePropagation();
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='open'){state.query='';state.active=-1;navigate(`workspace-${id}`);return;}
    if(action==='facet'){state.facet[id]=state.facet[id]===el.dataset.facet&&el.dataset.facet?'':el.dataset.facet;state.page[id]=1;if(needsRemote(id))loadRecords(id);refreshMain(id);return;}
    if(action==='screen'){state.screen[id]=state.screen[id]===el.dataset.screen?'':el.dataset.screen;refreshMain(id);const side=$('.ws-side .ws-actions');if(side){side.outerHTML=actionPanel(area(id));}return;}
    if(action==='face'){state.face[id]=el.dataset.face;refreshMain(id);return;}
    if(action==='page'){state.page[id]=Math.max(1,Number(el.dataset.page));loadRecords(id);return;}
    if(action==='reload'){if(state.remote[id])state.remote[id].key='';loadRecords(id);return;}
    if(action==='record'){showRecord(id,record);return;}
    if(action==='select'){state.sel[id]=record;refreshMain(id);return;}
    if(action==='record-open'){api.openRecord(record);return;}
    if(action==='record-request'){const a=area(id),r=recordById(id,record);if(!a||!r)return;document.querySelectorAll('dialog[open]').forEach(d=>d.close());requestFrom(a,{title:`${r.label} 확인`,body:`${a.label}의 이 기록을 확인하고 필요한 조치와 결과를 보고해 주세요.`,records:[r]});return;}
    if(action==='action'){if(el.closest('dialog'))el.closest('dialog').close();openAction(id,el.dataset.action,record||'');return;}
    if(action==='request'){const a=area(id);requestFrom(a,{title:`${a.label} 확인 요청`,body:`${a.label}에서 확인할 내용을 정리해 결과를 보고해 주세요.`});return;}
    if(action==='ask'){ax.openChat?.({topic:area(id).label,prompt:`${area(id).label}에서 지금 확인할 점과 담당자에게 요청할 일을 정리해줘`});return;}
    if(action==='signal-evidence'||action==='signal-request'){
      const a=area(id),s=(data(id)?.signals||[]).find(x=>x.id===el.dataset.signal);if(!s)return;
      if(action==='signal-request'){requestFrom(a,{title:s.draft?.title||s.title,body:s.draft?.body||s.summary||s.title,signal:s.id,records:(s.recordIds||[]).map(r=>recordById(id,r)).filter(Boolean)});return;}
      state.facet[id]='';state.q[id]='';if(api.getPage()!==`workspace-${id}`){navigate(`workspace-${id}`);}
      requestAnimationFrame(()=>{const first=(s.recordIds||[]).map(r=>recordById(id,r)).find(Boolean);$('#ws-main')?.scrollIntoView({block:'start',behavior:'auto'});if(first)showRecord(id,first.id);else toast('이 신호의 근거 기록은 작업 공간 목록에서 확인할 수 있습니다.');});
      return;
    }
    if(action==='cell'){editCell(el);return;}
    if(action==='recipient-ack'){const person=db.staff.find(s=>s.id===(state.recipient||ax.recipient?.owners()[0]));ax.recipient?.acknowledge(el.dataset.request,person?.name||'담당자',person?.id||'');return;}
    if(action==='sheet-reset'){delete state.edits[id];refreshMain(id);return;}
    if(action==='sheet-save'){
      const rows=state.edits[id]||{},values=Object.entries(rows).flatMap(([rid,cols])=>Object.entries(cols).map(([c,v])=>({label:`${recordById(id,rid)?.label||rid} · ${c}`,value:v})));if(!values.length)return;
      (state.local[id]||(state.local[id]=[])).unshift({id:crypto.randomUUID(),actionId:'sheet-edits',label:'시트 변경분',at:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),recordId:'',values});
      delete state.edits[id];refreshMain(id);refreshSide(id);toast(`시트 변경 ${values.length}칸을 미리보기로 기록했습니다. 2.0 시트에는 반영되지 않았습니다.`);return;
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
    if(el.dataset?.wsQ&&!event.isComposing){const id=el.dataset.wsQ;clearTimeout(state.qTimer);state.qTimer=setTimeout(()=>{state.q[id]=el.value.trim();state.page[id]=1;if(needsRemote(id))loadRecords(id);refreshMain(id);},250);}
  });
  document.addEventListener('compositionend',event=>{const el=event.target;if(el.id==='ws-find'){state.query=el.value;state.active=matches(el.value).length?0:-1;updateFinder();}});
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

  return {has,familyOf,view,sidebar,homeSignals,searchItems,coverage,area,areas,showRecord};
};
