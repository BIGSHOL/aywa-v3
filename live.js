/* Owner concept: verified full Docker snapshot; edits are session-only previews. */
(() => {
  'use strict';
  const db=window.AcademySnapshot;
  const $=q=>document.querySelector(q);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const won=n=>`${fmt(Math.round(n||0))}원`;
  const money=n=>Math.abs(n)>=1e8?`${fmt(n/1e8)}억`:`${fmt(n/1e4)}만`;
  const pct=(n,d)=>d?Math.round(n/d*1000)/10:null;
  const rate=(n,d)=>d?`${fmt(pct(n,d))}%`:'기록 없음';
  const sum=(items,key)=>items.reduce((n,x)=>n+Number(x[key]||0),0);
  const mlabel=m=>`${Number(String(m).slice(5,7))}월`;
  const shortDate=d=>d?String(d).slice(5).replace('-','.'):'미입력';
  const subject=s=>({math:'수학',english:'영어',general:'공통'}[s]||s||'공통');
  const status=s=>({enrolled:'재원',on_hold:'휴원',withdrawn:'퇴원',prospect:'입학 검토',present:'출석',late:'지각',absent:'결석',early_leave:'조퇴',makeup:'보강',paid:'수납 완료',partial:'부분 수납',unpaid:'미납',scheduled:'상담 예약',consulted:'상담 완료',ai_done:'상담 검토',declined:'미등록',no_show:'미방문',pending:'결재 대기',approved:'승인 완료',rejected:'반려',open:'진행 중',done:'완료',cancelled:'취소',expired:'종료',issued:'발급 완료',draft:'작성 중',requested:'요청',ordered:'주문',delivered:'전달',active:'사용 중',in_use:'사용 중',available:'보관',repair:'수리',retired:'폐기',boarded:'탑승',reserved:'예약'}[s]||s||'미입력');
  const byId=(collection,id)=>db[collection].find(x=>x.id===id);
  const group=(items,key)=>Object.entries(items.reduce((o,x)=>{const k=typeof key==='function'?key(x):x[key];o[k||'미입력']=(o[k||'미입력']||0)+1;return o;},{})).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count);
  const active=()=>db.students.filter(s=>s.status==='enrolled');
  const current=()=>db.trend.find(t=>t.month===db.meta.month);
  const recentTrend=()=>db.trend.filter(t=>db.months.includes(t.month));
  const paths={home:'M3 10 12 3 21 10v11H3z M9 21v-8h6v8',people:'M3 21v-3a6 6 0 0 1 12 0v3 M17 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 5 M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0',chart:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4',calendar:'M3 6h18v15H3z M7 3v5 M17 3v5 M3 11h18',book:'M12 5C9 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-7-2-10 1v15',wallet:'M20 7V4H5a2 2 0 0 0 0 4h16v12H5a2 2 0 0 1-2-2V6 M21 12h-6v4h6',staff:'M3 6h18v15H3z M8 6V3h8v3 M3 12h18 M10 12v3h4v-3',message:'M21 11a8 8 0 0 1-8 8H6l-4 3V7a4 4 0 0 1 4-4h7a8 8 0 0 1 8 8 M7 8h9 M7 13h6',bus:'M4 4h16v15H4z M4 11h16 M8 4v7 M16 4v7 M7 19v2 M17 19v2 M7 15h1 M16 15h1',check:'M5 12 9 16 19 6',box:'M3 7 12 3 21 7v12l-9 3-9-3z M3 7l9 4 9-4 M12 11v11',settings:'M4 7h16 M4 17h16 M8 4v6 M14 14v6',search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6',arrow:'M5 12h14 M13 6l6 6-6 6',chevron:'M9 5l7 7-7 7',down:'M6 9l6 6 6-6',plus:'M12 5v14 M5 12h14',close:'M6 6l12 12 M6 18 18 6',menu:'M4 6h16 M4 12h16 M4 18h16',trend:'M3 17l6-6 4 3 8-10 M14 4h7v7',building:'M5 21V3h14v18 M3 21h18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M10 21v-6h4v6'};
  const icon=k=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[k]||paths.book}"/></svg>`;
  const badge=(s,c='')=>`<span class="badge ${c}">${h(s)}</span>`;
  const avatar=name=>`<span class="avatar">${h(String(name||'').slice(-2))}</span>`;
  const button=(label,action,cls='')=>`<button class="button ${cls}" data-action="${action}">${label}</button>`;
  const go=(label,page)=>`<button class="text-button" data-go="${page}">${label}${icon('chevron')}</button>`;
  const empty=(title,note='조건을 바꾸거나 다른 기간을 확인해 주세요.')=>`<div class="live-empty"><strong>${h(title)}</strong><p>${h(note)}</p></div>`;
  const panel=(title,note,content,extra='')=>`<section class="live-panel"><header><div><h2>${title}</h2>${note?`<p>${note}</p>`:''}</div>${extra}</header>${content}</section>`;
  const subtitle=(title,note='',extra='')=>`<div class="live-subtitle"><div><h2>${title}</h2>${note?`<p>${note}</p>`:''}</div>${extra}</div>`;
  const heading=(title,note,extra='')=>`<div class="page-heading"><div><h1>${title}</h1><p>${note}</p></div><div class="heading-actions">${extra}</div></div>`;
  const metrics=items=>`<div class="kpi-strip">${items.map(([label,value,note])=>`<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value number">${value}</div><div class="kpi-foot">${note}</div></div>`).join('')}</div>`;
  const barMeasure={명:'인원',건:'건수',개:'개수',만원:'금액'};
  const bars=(items,unit='명',maxItems=8)=>{const shown=items.slice(0,maxItems),max=Math.max(...shown.map(x=>x.count),1),all=items.reduce((n,x)=>n+Number(x.count||0),0);return shown.length?`<div class="live-bars" data-chart data-axis="y" tabindex="0" role="group" aria-label="항목별 ${barMeasure[unit]||'수치'} — 화살표 키로 항목을 옮기며 수치를 확인합니다">${shown.map(x=>`<div class="live-bar" data-point data-tip="${tipData(x.label,[{label:barMeasure[unit]||'수치',value:`${fmt(x.count)}${unit}`,tone:'primary'}],[all?`전체 ${fmt(all)}${unit} 중 ${fmt(x.count/all*100)}%`:''])}"><span>${h(x.label)}</span><span class="live-bar-track"><i data-anchor style="width:${x.count/max*100}%"></i></span><strong>${fmt(x.count)}${unit}</strong></div>`).join('')}</div>`:empty('표시할 기록이 없습니다.');};
  const filters=(key,items,value)=>`<div class="live-filter" role="group" aria-label="보기 선택">${items.map(([id,label])=>`<button class="tab ${id===value?'active':''}" data-filter="${h(id)}" data-key="${key}" aria-pressed="${id===value}">${h(label)}</button>`).join('')}</div>`;
  // Every trend/comparison chart shows one point's exact value in the app's own popover (hover, touch, arrow keys).
  // Points carry data-tip = {title, rows:[{label,value,tone}], meta:[...]}; the popover below renders it. No native title tooltips.
  const exact=(v,unit)=>v==null?'기록 없음':unit==='만원'||unit==='원'?won(v):`${fmt(v)}${unit}`;
  const isMonth=d=>/^\d{4}-\d{2}$/.test(String(d||''));
  const periodTitle=x=>{const d=String(x.month||x.date||'');if(isMonth(d))return `${d.slice(0,4)}년 ${mlabel(d)}`;if(/^\d{4}-\d{2}-\d{2}$/.test(d))return `${d.slice(0,4)}년 ${Number(d.slice(5,7))}월 ${Number(d.slice(8,10))}일`;return String(x.label||d);};
  const tipData=(title,rows,meta=[])=>h(JSON.stringify({title,rows,meta:meta.filter(Boolean)}));
  const deltaText=(v,prev,unit,monthly)=>v==null||prev==null?'':`${monthly?'전월':'이전'} 대비 ${v>prev?'+':v<prev?'−':'±'}${exact(Math.abs(v-prev),unit)}`;
  function chart(items,key,unit='',options={}){
    if(!items.some(x=>x[key]!==null&&x[key]!==undefined))return empty('이 기간의 기록이 없습니다.','없는 기간을 추정값으로 채우지 않았습니다.');
    const W=620,H=216,L=42,R=20,T=25,B=32,inner=W-L-R,secondary=options.secondary;
    const values=items.flatMap(x=>[x[key],...(secondary?[x[secondary]]:[])]).filter(x=>x!==null&&x!==undefined).map(Number);
    const max=Math.max(...values,1)*1.15,step=inner/Math.max(items.length,1),y=v=>T+(H-T-B)*(1-v/max);
    const label=v=>unit==='만원'?fmt(v/10000):fmt(Math.round(v));
    const name=x=>x.label||(x.month?mlabel(x.month):shortDate(x.date));
    const monthly=items.every(x=>isMonth(x.month));
    const grid=Array.from({length:4},(_,i)=>{const val=max*i/3;return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${y(val)}" y2="${y(val)}"/><text x="${L-9}" y="${y(val)+4}" text-anchor="end">${label(val)}</text>`;}).join('');
    const cols=items.map((x,i)=>{
      const cx=L+step*(i+.5),v=x[key],sv=secondary?x[secondary]:null,width=Math.min(36,step*.48),prev=i?items[i-1][key]:null;
      const rows=[{label:options.label||'',value:exact(v,unit),tone:'primary'},...(secondary?[{label:options.secondaryLabel||'',value:exact(sv,unit),tone:'secondary'}]:[])];
      const tip=tipData(x.month||x.date?periodTitle(x):name(x),rows,[deltaText(v,prev,unit,monthly),options.basis||'']);
      return `<g class="chart-col" data-point data-tip="${tip}"><rect class="chart-hit" x="${L+step*i}" y="${T-10}" width="${step}" height="${H-B-T+10}"/>${v==null?`<text data-anchor x="${cx}" y="${H-B-5}" text-anchor="middle">—</text>`:`<rect class="chart-bar" data-anchor x="${cx-width/2-(secondary?width*.32:0)}" y="${y(v)}" width="${secondary?width*.65:width}" height="${H-B-y(v)}" rx="4" fill="${i===items.length-1?'#6078c8':'#a8b6df'}"/>${!secondary&&items.length<=7?`<text class="point-value" x="${cx}" y="${y(v)-9}" text-anchor="middle">${label(v)}</text>`:''}`}${secondary&&sv!=null?`<rect class="chart-bar" x="${cx+width*.04}" y="${y(sv)}" width="${width*.65}" height="${H-B-y(sv)}" rx="4" fill="#a7cbbb"/>`:''}<text x="${cx}" y="${H-8}" text-anchor="middle">${h(name(x))}</text></g>`;
    }).join('');
    return `<div class="chart-box" data-chart tabindex="0" role="group" aria-label="${h(options.label||key)} — 화살표 키로 기간을 옮기며 수치를 확인합니다"><svg class="live-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(options.label||key)} 추이 · ${items.map(x=>`${x.label||x.month||x.date} ${x[key]==null?'기록 없음':label(x[key])+unit}`).join(', ')}">${grid}${cols}</svg></div>${secondary?`<div class="live-legend"><span><i></i>${options.label}</span><span><i class="alt"></i>${options.secondaryLabel}</span></div>`:''}`;
  }
  // Stretchable trend line: HTML hit zones over an SVG line so markers stay round when the chart grows.
  // Missing periods break the line (no interpolation). Range ≥10% of the mean so small changes never read as cliffs.
  function lineChart(rows,{key='value',label='',unit='',value,basis=''}={}){
    const values=rows.map(r=>r[key]==null?null:Number(r[key])),known=values.filter(v=>v!==null);
    if(!known.length)return '';
    const lo=Math.min(...known),hi=Math.max(...known),mean=known.reduce((n,v)=>n+v,0)/known.length,span=Math.max(hi-lo,Math.abs(mean)*.1,1),min=(lo+hi)/2-span/2;
    const n=rows.length,x=i=>2+i*(96/Math.max(n-1,1)),yv=v=>36-(v-min)/span*32,text=v=>v==null?'기록 없음':value?value(v):exact(v,unit);
    const runs=[];values.forEach((v,i)=>{if(v===null)return;if(i&&values[i-1]!==null)runs.at(-1).push(i);else runs.push([i]);});
    const solo=new Set(runs.filter(r=>r.length===1).map(r=>r[0]));
    const zone=96/Math.max(n-1,1),edges=i=>{const left=i?Math.max(0,x(i)-zone/2):0,right=i===n-1?100:Math.min(100,x(i)+zone/2);return {left,width:right-left,at:(x(i)-left)/(right-left)*100};};
    const monthly=rows.every(r=>isMonth(r.month));
    const point=(r,i)=>{const e=edges(i),v=values[i],prev=i?values[i-1]:null,delta=v===null||prev===null?'':`${monthly?`전월(${mlabel(rows[i-1].month)})`:'이전'} 대비 ${v>prev?'+':v<prev?'−':'±'}${text(Math.abs(v-prev))}`;
      return `<span class="chart-pt${solo.has(i)?' solo':''}" data-point data-tip="${tipData(periodTitle(r),[{label,value:text(v),tone:'primary'}],[delta,basis])}" style="left:${e.left}%;width:${e.width}%;--x:${e.at}%;--y:${v===null?100:yv(v)/40*100}%"><i data-anchor></i></span>`;};
    return `<span class="chart-line" data-chart tabindex="0" role="group" aria-label="${h(label)} — 화살표 키로 기간을 옮기며 수치를 확인합니다"><svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${h(label)} ${rows.map((r,i)=>`${periodTitle(r)} ${text(values[i])}`).join(', ')}"><line x1="0" x2="100" y1="39" y2="39" vector-effect="non-scaling-stroke"/>${runs.filter(r=>r.length>1).map(r=>`<polyline points="${r.map(i=>`${x(i)},${yv(values[i])}`).join(' ')}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>${rows.map(point).join('')}</span>`;
  }
  // Shared chart popover: one per document, moved into an open dialog so it renders above it. Never takes pointer events.
  // The same point is never re-rendered on pointermove; keyboard moves are announced once through a polite live region.
  const tip=document.createElement('div');tip.id='chart-tip';tip.className='chart-pop';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
  const chartLive=document.createElement('div');chartLive.className='chart-live';chartLive.setAttribute('aria-live','polite');document.body.append(chartLive);
  const chartState={box:null,index:-1,sticky:false};
  const chartPoints=box=>[...box.querySelectorAll('[data-point]')];
  const tipCache=new WeakMap();
  function tipOf(point){if(!tipCache.has(point)){let d={};try{d=JSON.parse(point.dataset.tip||'{}');}catch{d={};}tipCache.set(point,{title:String(d.title||''),rows:Array.isArray(d.rows)?d.rows:[],meta:Array.isArray(d.meta)?d.meta:[]});}return tipCache.get(point);}
  function fillTip(d){
    const el=(cls,text,tag='div')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
    tip.replaceChildren(el('chart-pop-head',d.title));
    d.rows.forEach(r=>{const row=el('chart-pop-row','');row.append(el(`chart-pop-label ${r.tone==='secondary'?'secondary':''}`,String(r.label||''),'span'),el('chart-pop-value',String(r.value||''),'strong'));tip.append(row);});
    d.meta.forEach(m=>tip.append(el('chart-pop-meta',String(m))));
  }
  function placeTip(){
    const {box,index}=chartState;if(!box?.isConnected||!box.getClientRects().length){hideTip();return;}
    const point=chartPoints(box)[index];if(!point){hideTip();return;}
    const a=(point.querySelector('[data-anchor]')||point).getBoundingClientRect();
    if(a.bottom<0||a.top>innerHeight||a.right<0||a.left>innerWidth){hideTip();return;}
    const w=tip.offsetWidth,ht=tip.offsetHeight,m=8,gap=12,cx=a.left+a.width/2;
    // Above the point by default, flipped below when there is no room; leans away from the nearer horizontal edge.
    let left=cx>innerWidth*.66?cx-w+16:cx<innerWidth*.33?cx-16:cx-w/2,top=a.top-ht-gap;
    if(top<m)top=a.bottom+gap;
    left=Math.max(m,Math.min(left,innerWidth-w-m));top=Math.max(m,Math.min(top,innerHeight-ht-m));
    tip.style.transform=`translate(${Math.round(left)}px,${Math.round(top)}px)`;
  }
  function releasePoint(){const {box,index}=chartState;if(box){chartPoints(box)[index]?.classList.remove('active');box.removeAttribute('aria-describedby');}}
  function showPoint(box,index,{sticky=false,announce=false}={}){
    const points=chartPoints(box);if(!points.length)return;
    index=Math.max(0,Math.min(points.length-1,index));
    if(chartState.box===box&&chartState.index===index&&!tip.hidden){if(sticky)chartState.sticky=true;return;}
    releasePoint();
    points[index].classList.add('active');box.setAttribute('aria-describedby','chart-tip');
    Object.assign(chartState,{box,index,sticky});
    const host=box.closest('dialog[open]')||document.body;if(tip.parentElement!==host)host.append(tip);
    const d=tipOf(points[index]);fillTip(d);tip.hidden=false;placeTip();
    if(announce)chartLive.textContent=[d.title,...d.rows.map(r=>`${r.label} ${r.value}`),...d.meta].filter(Boolean).join(', ');
  }
  function hideTip(){releasePoint();Object.assign(chartState,{box:null,index:-1,sticky:false});tip.hidden=true;}
  function nearestPoint(box,clientX,clientY){
    const vertical=box.dataset.axis==='y';let best=0,dist=Infinity;
    chartPoints(box).forEach((p,i)=>{const r=p.getBoundingClientRect(),lo=vertical?r.top:r.left,hi=vertical?r.bottom:r.right,c=vertical?clientY:clientX,d=c<lo?lo-c:c>hi?c-hi:0;if(d<dist){dist=d;best=i;}});
    return best;
  }
  document.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse')return;
    const box=event.target.closest?.('[data-chart]');
    if(box)showPoint(box,nearestPoint(box,event.clientX,event.clientY));else if(chartState.box&&!chartState.sticky&&document.activeElement!==chartState.box)hideTip();
  },{passive:true});
  document.addEventListener('pointerleave',event=>{if(event.target===chartState.box&&!chartState.sticky&&document.activeElement!==chartState.box)hideTip();},true);
  document.addEventListener('pointerdown',event=>{
    const box=event.target.closest?.('[data-chart]');
    if(box&&event.pointerType!=='mouse')showPoint(box,nearestPoint(box,event.clientX,event.clientY),{sticky:true});
    else if(chartState.sticky&&!box)hideTip();
  },{passive:true});
  document.addEventListener('focusin',event=>{const box=event.target;if(box.matches?.('[data-chart]'))showPoint(box,chartState.box===box?chartState.index:chartPoints(box).length-1,{announce:true});});
  document.addEventListener('focusout',event=>{if(event.target===chartState.box&&!chartState.box.contains(event.relatedTarget))hideTip();});
  document.addEventListener('keydown',event=>{
    const box=event.target;if(!box.matches?.('[data-chart]'))return;
    const last=chartPoints(box).length-1,i=chartState.box===box?chartState.index:last;
    const next={ArrowLeft:i-1,ArrowUp:i-1,ArrowRight:i+1,ArrowDown:i+1,Home:0,End:last}[event.key];
    if(next!==undefined){event.preventDefault();showPoint(box,next,{announce:true});}
    else if(event.key==='Escape'&&chartState.box===box&&!tip.hidden){event.preventDefault();event.stopPropagation();hideTip();}
  },true);
  document.addEventListener('close',event=>{if(chartState.box&&event.target.contains?.(chartState.box))hideTip();},true);
  addEventListener('scroll',()=>{if(chartState.box)placeTip();},{passive:true,capture:true});
  addEventListener('resize',()=>{if(chartState.box)placeTip();});
  const pages=[['home','경영 흐름','home','원장실'],['students','학생 · 재원 관리','people','학원 운영'],['admissions','입학 · 상담','message'],['classes','수업 · 시간표','calendar'],['learning','학습 · 성과','book'],['finance','수납 · 재무','wallet','경영 관리'],['staff','직원 · 급여','staff'],['parents','학부모 소통','message'],['shuttle','차량 · 안전','bus'],['approvals','업무 · 결재','check','운영 지원'],['resources','교재 · 자산 · 문서','box'],['calendar','학원 일정','calendar'],['settings','학원 설정','settings']];
  const state={page:'home',month:db.meta.month,homeRange:'recent',studentFilter:'enrolled',studentQuery:'',studentPage:0,admissionFilter:'all',classSubject:'all',classView:'flow',classPage:0,resourceView:'textbooks',taskFilter:'open',vehicle:db.vehicles[0]?.id,season:'term',selectedDate:db.meta.asOf,calendarMonth:db.meta.month,calendarOffset:0,financeMonth:db.meta.month,financePage:0,studentId:'',noteContext:'',search:'',localNotes:[]};
  let toastTimer;
  const toast=text=>{const node=$('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3000);};
  // Factories: ax (briefing/requests/assistant) first, then workspaces (catalog-driven family screens) which uses ax.
  const api={db,h,fmt,won,icon,chart,lineChart,exact,dialog,navigate,render,attachScroll,scrollToSection,toast,subjectLabel:subject,showStudent,showBill,showApproval,showTask,openRecord,canOpenRecord,getPage:()=>state.page,hasView:id=>Boolean(viewFor(id)),closeMenu};
  const ax=window.createOwnerWorkspace(api);
  const ws=typeof window.createWorkspaces==='function'?window.createWorkspaces({...api,ax}):null;
  ax.useWorkspaces?.(ws);
  // Durable work flow (GET /api/flow): preview selector, role views, request store. Absent → session-only requests.
  const flowUI=typeof window.createFlowUI==='function'?window.createFlowUI({...api,ax,familyLabel:id=>ws?.area(id)?.label||'',showWorkspaceRecord:(family,record)=>ws?.showRecord(family,record)}):null;
  ax.useFlow?.(flowUI);
  const viewFor=page=>{if(!page)return null;if(views[page])return views[page];const id=ws?.familyOf(page);return id&&ws.has(id)?()=>ws.view(id):null;};
  const mobileNav=matchMedia('(max-width: 760px)');
  const scrollObserver=new ResizeObserver(entries=>entries.forEach(e=>fade(e.target)));
  function fade(node){const top=Math.max(0,node.scrollTop),bottom=Math.max(0,node.scrollHeight-node.clientHeight-top),left=Math.max(0,node.scrollLeft),right=Math.max(0,node.scrollWidth-node.clientWidth-left);node.style.setProperty('--fade-top',`${Math.min(26,top)}px`);node.style.setProperty('--fade-bottom',`${Math.min(26,bottom>1?bottom:0)}px`);node.style.setProperty('--fade-left',`${Math.min(26,left)}px`);node.style.setProperty('--fade-right',`${Math.min(26,right>1?right:0)}px`);}
  function attachScroll(){document.querySelectorAll('.nav-scroll,.live-scroll').forEach(node=>{fade(node);node.addEventListener('scroll',()=>fade(node),{passive:true});scrollObserver.observe(node);});}
  /* Explicit in-page section jumps ('아래에서 보기', issue cues): a visible page scroll that brakes into the target
     (ease-out cubic, 550–1000ms by distance). Wheel/touch/key/pointer input, a route change or the next jump stops it;
     reduced motion, tiny hops and route arrivals position at once. A selector target is re-read every frame, so a
     re-render keeps the motion going and a vanished target ends it. Route changes, search-option nearest, chat
     autoscroll and restored offsets keep their immediate scrolling elsewhere. */
  const motion={frame:0,stop:null};
  function scrollToSection(target,{instant=false}={}){
    motion.stop?.();
    const root=document.scrollingElement||document.documentElement;
    const node=()=>{const n=typeof target==='string'?document.querySelector(target):target;return n?.isConnected?n:null;};
    const goal=n=>{const pad=parseFloat(getComputedStyle(root).scrollPaddingTop)||0,margin=parseFloat(getComputedStyle(n).scrollMarginTop)||0;return Math.max(0,Math.min(root.scrollHeight-root.clientHeight,n.getBoundingClientRect().top+window.scrollY-margin-pad));};
    const first=node();if(!first)return;
    const from=window.scrollY,distance=Math.abs(goal(first)-from);
    if(instant||distance<8||matchMedia('(prefers-reduced-motion: reduce)').matches){window.scrollTo({top:goal(first),behavior:'instant'});return;}
    const duration=Math.min(1000,Math.max(550,350+distance*.4)),start=performance.now(),intent=['wheel','touchstart','pointerdown','hashchange'];
    let last=from;
    const moved=()=>{if(Math.abs(window.scrollY-last)>2)stop();};
    const key=event=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))stop();};
    const stop=()=>{cancelAnimationFrame(motion.frame);intent.forEach(type=>removeEventListener(type,stop,true));removeEventListener('keydown',key,true);removeEventListener('scroll',moved);if(motion.stop===stop)motion.stop=null;};
    const step=now=>{const n=node();if(!n){stop();return;}const t=Math.min(1,(now-start)/duration),to=goal(n);window.scrollTo({top:from+(to-from)*(1-(1-t)**3),behavior:'instant'});last=window.scrollY;if(t<1)motion.frame=requestAnimationFrame(step);else stop();};
    intent.forEach(type=>addEventListener(type,stop,{capture:true,passive:true}));addEventListener('keydown',key,{capture:true,passive:true});addEventListener('scroll',moved,{passive:true});
    motion.stop=stop;motion.frame=requestAnimationFrame(step);
  }
  function shell(){
    const offset=$('.nav-scroll')?.scrollTop||0;
    $('#sidebar').innerHTML=`<a href="#home" class="brand"><span class="brand-mark">${icon('trend')}</span><div><div class="brand-name">aywa</div><div class="brand-caption">학원을 잇는 경영 공간</div></div></a><div class="academy-box"><span class="academy-symbol">${icon('building')}</span><div class="grow"><strong>${h(db.meta.tenant)}</strong><small>원장 · 경영자</small></div>${icon('down')}</div><nav class="nav-scroll" aria-label="학원 업무">${pages.filter(p=>p[0]!=='settings').map(([id,label,symbol,section])=>`${section?`<div class="nav-group">${section}</div>`:''}<a class="nav-item ${state.page===id?'active':''}" href="#${id}" ${state.page===id?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${id==='approvals'?`<span class="nav-count">${db.approvals.filter(a=>a.status==='pending').length}</span>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><a class="nav-item ${state.page==='settings'?'active':''}" href="#settings">${icon('settings')}학원 설정</a><div class="profile">${avatar('원장')}<div class="grow"><strong>원장님</strong><small>${h(db.meta.tenant)} · 원장실</small></div>${icon('chevron')}</div></div>`;
    $('.nav-scroll').scrollTop=offset;
    // Desktop has no header band: search, notes and channels live in the sidebar. Phones keep a menu bar (decorated by ax.js).
    $('#topbar').innerHTML=`<button class="icon-button mobile-menu" data-action="menu" aria-controls="sidebar" aria-label="메뉴 열기" aria-expanded="false">${icon('menu')}</button><strong>${pages.find(p=>p[0]===state.page)?.[1]||'경영 흐름'}</strong>`;
    $('#footer').innerHTML=`<span>${h(db.meta.tenant)} · ${db.meta.asOf.replaceAll('-','.')} 복사본</span><span>검토·입력은 이 시안에서만 반영됩니다.</span>`;
  }
  const home=()=>{
    const now=current(),prev=db.trend.at(-2),difference=now.payingStudents-prev.payingStudents;
    const selected=db.trend.find(t=>t.month===state.month)||now;
    const daily=db.daily.at(-1),first=db.daily[0];
    const trend=state.homeRange==='legacy'?db.legacyHistory.filter(x=>x.month.endsWith('-12')||x.month===db.meta.month).map(x=>({...x,label:x.month.replace('-','.'),value:x.enrolledRecord??null})):recentTrend().map(x=>({...x,value:x.payingStudents||null}));
    const followups=active().filter(s=>s.followups>0).length;
    return heading('학원의 흐름','숫자의 변화에서 오늘의 결정을 찾습니다.',button(`${icon('book')} 경영 메모`,'report'))+
      `<section class="live-lead"><div><small>${mlabel(db.meta.month)} 경영 브리핑</small><h2>청구 대상 학생이 지난달보다 ${fmt(Math.abs(difference))}명 ${difference<0?'줄었습니다':difference>0?'늘었습니다':'그대로입니다'}.</h2><p>현재 재원 ${fmt(active().length)}명 · 휴원 ${fmt(db.students.filter(s=>s.status==='on_hold').length)}명. 학생의 적응과 상담 흐름을 함께 살펴보세요.</p></div><div class="live-lead-stat"><strong>${rate(now.paid,now.billed)}</strong><span>이번 달 청구분 수납률</span></div></section>`+
      metrics([['현재 재원',`${fmt(active().length)}<small>명</small>`,daily&&first?`일별 기록 ${shortDate(first.date)}–${shortDate(daily.date)}`:'현재 학생 상태 기준'],['이번 달 누적 수납',`${money(now.paid)}<small>원</small>`,`${mlabel(db.meta.month)} 청구분 · 복사 시점까지`],['남은 수납',`${money(now.remaining)}<small>원</small>`,`${db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).length}건 확인 필요`],['새로 접수한 상담',`${now.inquiries}<small>건</small>`,`이번 달 접수 · 등록 상태 ${now.registered}건`]])+
      `<div class="live-grid">${panel('학생 흐름의 변화',state.homeRange==='legacy'?'이전 장부의 연말 재원 기록과 올해 최신 기록':'수강료 청구 대상 · 월별 고유 학생',`${filters('homeRange',[['recent','최근 6개월'],['legacy','장기 흐름']],state.homeRange)}${chart(trend,'value','명',{label:state.homeRange==='legacy'?'이전 장부 재원 기록':'청구 대상 학생'})}${state.homeRange==='recent'?`<div class="live-months">${db.months.map(m=>`<button data-month="${m}" class="${state.month===m?'active':''}" aria-pressed="${state.month===m}">${mlabel(m)}</button>`).join('')}</div><div class="live-note"><strong>${mlabel(selected.month)} ${selected.payingStudents}명</strong> · 청구 ${money(selected.billed)}원 · 누적 수납 ${money(selected.paid)}원</div>`:''}<p class="live-note">${state.homeRange==='legacy'?'이전 장부의 재원 기록입니다. 현재 학생 상태·청구 대상과 집계 기준이 다릅니다.':'미납 포함, 취소·환불·테스트 학생 제외. 현재 재원 상태와 다른 지표이며 이번 달은 진행 중입니다.'}</p>`)}${panel('지금 살펴볼 흐름','변화를 확인하고, 다음 행동으로 연결하세요.',`<button class="live-signal rose" data-go="students"><span>상담 후속 확인</span><strong>${followups}명</strong><p>재원생 중 후속 일정이 지났고 완료 표시가 없는 학생</p><em>학생의 맥락 살펴보기 →</em></button><button class="live-signal blue" data-go="finance"><span>수납 마무리</span><strong>${money(now.remaining)}원</strong><p>이번 달 청구분의 남은 금액</p><em>수납 흐름 확인 →</em></button><button class="live-signal teal" data-go="learning"><span>배움의 긍정 신호</span><strong>${now.positiveSignals}건</strong><p>이번 달 기록된 긍정 피드백</p><em>학습 기록 살펴보기 →</em></button>`)}</div>`+
      `<div class="live-grid equal">${panel('수납이 쌓이는 흐름','각 청구월의 현재까지 누적 금액',chart(recentTrend(),'billed','만원',{secondary:'paid',label:'청구액',secondaryLabel:'수납액'})+'<p class="live-note">입금 발생월 기준 현금 흐름이 아닙니다. 이번 달은 진행 중입니다.</p>',go('수납 · 재무','finance'))}${panel('어느 학교의 학생들과 함께하나요','현재 재원생의 학교 구성',bars(group(active(),'school'),'명',7),go('학생 보기','students'))}</div>`;
  };
  function studentCards(items){return items.map(s=>`<button class="live-card" data-student="${h(s.id)}"><header>${avatar(s.name)}<div><h3>${h(s.name)}</h3><p>${h(s.school)} · ${h(s.grade)}</p></div>${badge(status(s.status),s.status==='enrolled'?'teal':'')}</header><span class="live-card-label">이번 달 출결 기록</span><div class="live-card-number">${s.attendance.total?`${s.attendance.absent}<small>회 결석 / ${s.attendance.total}회 기록</small>`:'<small>아직 기록 없음</small>'}</div><p>${s.classes.length}개 수업 · ${s.positive?`긍정 피드백 ${s.positive}건`:'최근 학습과 상담을 확인하세요'}</p><footer><span>${s.followups?`후속 상담 ${s.followups}건`:s.remaining?`남은 수납 ${money(s.remaining)}원`:'학생의 흐름 보기'}</span>${icon('chevron')}</footer></button>`).join('');}
  const students=()=>{
    const rows=db.students.filter(s=>(state.studentFilter==='care'?s.status==='enrolled'&&(s.followups>0||s.attendance.absent>=3):state.studentFilter==='all'||s.status===state.studentFilter)&&`${s.name} ${s.school} ${s.grade}`.includes(state.studentQuery));
    const page=rows.slice(state.studentPage*18,(state.studentPage+1)*18);
    return heading('학생의 변화를 읽다','출결, 배움, 상담을 한 학생의 흐름으로 연결합니다.')+
      `<div class="live-grid equal">${panel('최근 재원의 변화','실제로 저장된 일별 재원 스냅샷',chart(db.daily,'enrolled','명',{label:'재원 상태'})+'<p class="live-note">일별 기록이 존재하는 기간만 표시합니다.</p>')}${panel('현재 재원의 구성',`${active().length}명의 학생이 함께 배우고 있습니다.`,bars(group(active(),'grade'),'명',9))}</div>`+
      subtitle('관심을 연결할 학생','학생을 누르면 수업·출결·학습·상담·수납을 함께 볼 수 있습니다.')+
      filters('studentFilter',[['enrolled','재원'],['care','후속 확인'],['on_hold','휴원'],['prospect','입학 검토'],['withdrawn','퇴원'],['all','전체']],state.studentFilter)+
      `<div class="live-filter"><span class="muted">${fmt(rows.length)}명</span><input id="student-search" aria-label="학생 이름, 학교 검색" placeholder="학생 이름, 학교, 학년 검색" value="${h(state.studentQuery)}"></div><div class="live-cards">${studentCards(page)}</div>${!rows.length?empty('조건에 맞는 학생이 없습니다.'):pager('studentPage',state.studentPage,rows.length,18)}`;
  };
  const pager=(key,page,total,size)=>`<div class="live-pager"><button class="button small" data-page-key="${key}" data-page="${page-1}" ${page<=0?'disabled':''}>이전</button><span>${page+1} / ${Math.max(1,Math.ceil(total/size))}</span><button class="button small" data-page-key="${key}" data-page="${page+1}" ${(page+1)*size>=total?'disabled':''}>다음</button></div>`;
  const classes=()=>{
    const rows=db.classes.filter(c=>state.classSubject==='all'||c.subject===state.classSubject);
    const scheduled=rows.flatMap(c=>c.schedules.map(s=>({...s,classId:c.id,name:c.name})));
    const timetable=[1,2,3,4,5].map(day=>`<section class="live-week-day live-scroll" tabindex="0" aria-label="${'일월화수목금토'[day]}요일 수업"><strong>${'일월화수목금토'[day]}요일</strong>${scheduled.filter(s=>s.day===day).sort((a,b)=>a.start.localeCompare(b.start)).map(s=>`<button class="live-slot" data-class="${h(s.classId)}"><span>${h(s.start)}–${h(s.end)}</span><strong>${h(s.name)}</strong><small>${h(s.room)} · ${h(s.teacher)}</small></button>`).join('')||'<p class="live-note">등록된 시간 없음</p>'}</section>`).join('');
    return heading('수업의 연결을 보다','학생과 선생님, 시간의 배치를 한 흐름으로 봅니다.',go('보강 기록','calendar'))+
      metrics([['운영 중인 반',`${rows.length}<small>개</small>`,'활성 상태 · 보강 대기반 제외'],['수강 중인 학생',`${new Set(rows.flatMap(c=>c.students)).size}<small>명</small>`,'유효한 수강 관계의 고유 학생'],['주간 시간 배치',`${scheduled.length}<small>개</small>`,'복사 기준일에 유효한 시간표'],['보강 예약 기록',`${db.makeup.length}<small>건</small>`,'전체 예약 이력']])+
      `<div class="live-grid equal">${panel('요일별 수업의 밀도','유효한 시간표의 등록 건수',chart([1,2,3,4,5,6].map(day=>({label:'일월화수목금토'[day]+'요일',count:scheduled.filter(s=>s.day===day).length})),'count','개',{label:'시간 배치'}))}${panel('선생님과 수업의 연결','담당 반 수 · 시간표 중복 시간과는 구분합니다.',bars(group(rows,'teacher'),'개',7))}</div>`+
      `${filters('classView',[['flow','반의 흐름'],['week','주간 시간표']],state.classView)}${filters('classSubject',[['all','모든 과목'],['math','수학'],['english','영어']],state.classSubject)}`+
      (state.classView==='week'?`<div class="live-week">${timetable}</div>`:`<div class="live-cards">${rows.slice(state.classPage*18,(state.classPage+1)*18).map(c=>`<button class="live-card" data-class="${h(c.id)}"><header><div><h3>${h(c.name)}</h3><p>${h(c.teacher)} · ${h(c.room)}</p></div>${badge(subject(c.subject),'blue')}</header><span class="live-card-label">현재 수강 관계</span><div class="live-card-number">${c.students.length}<small>명</small></div><p>이번 달 ${c.attendance}회 출결 기록 · 결석 ${c.absent}회</p><footer><span>주 ${c.schedules.length}개 시간 배치</span>${icon('chevron')}</footer></button>`).join('')}</div>${pager('classPage',state.classPage,rows.length,18)}`);
  };

  const periodSelect=(key,value,periods=db.months)=>`<select class="live-period" data-period="${key}" aria-label="조회 월">${[...new Set(periods)].sort().reverse().map(m=>`<option value="${m}" ${m===value?'selected':''}>${m.replace('-','년 ')}월</option>`).join('')}</select>`;
  const admissions=()=>{
    const monthRows=db.admissions.filter(a=>a.date.startsWith(state.month));
    const stages=[['all','전체 문의',monthRows.length],['review','상담·검토 중',monthRows.filter(a=>['scheduled','consulted','ai_done'].includes(a.outcome)).length],['enrolled','등록',monthRows.filter(a=>a.outcome==='enrolled').length],['declined','미등록·미방문',monthRows.filter(a=>['declined','no_show'].includes(a.outcome)).length]];
    const rows=monthRows.filter(a=>state.admissionFilter==='all'||(state.admissionFilter==='review'?['scheduled','consulted','ai_done'].includes(a.outcome):state.admissionFilter==='declined'?['declined','no_show'].includes(a.outcome):a.outcome===state.admissionFilter));
    return heading('만남이 배움으로 이어지도록','문의 이후의 흐름과 다음 상담을 함께 살펴봅니다.',periodSelect('month',state.month)+button(`${icon('plus')} 상담 등록해보기`,'new-lead','primary'))+
      `<div class="live-grid equal">${panel('새로운 만남의 추이','접수월별 상담 건수와 현재 등록 상태',chart(recentTrend(),'inquiries','건',{secondary:'registered',label:'접수 상담',secondaryLabel:'현재 등록 상태'})+'<p class="live-note">동일 접수월의 현재 결과입니다. 단계 사이의 실제 이동률과는 구분합니다.</p>')}${panel('이번 달의 유입 경로','입력된 경로를 묶어 살펴봅니다.',state.month===db.meta.month?bars(db.admissionChannels,'건',6):bars(group(monthRows,'channel'),'건',6))}</div>`+
      subtitle(`${mlabel(state.month)} 만남의 현재 위치`)+`<div class="live-flow">${stages.map(([id,label,count])=>`<button data-filter="${id}" data-key="admissionFilter"><span>${label}</span><strong>${count}</strong><small>현재 기록 기준</small></button>`).join('')}</div>`+
      filters('admissionFilter',stages.map(([id,label])=>[id,label]),state.admissionFilter)+
      `<div class="live-cards">${rows.map(a=>`<button class="live-card" data-lead="${h(a.id)}"><header>${avatar(a.name)}<div><h3>${h(a.name)}</h3><p>${h(a.grade||'학년 미입력')} · ${h(a.school||'학교 미입력')}</p></div>${badge(status(a.outcome),a.outcome==='enrolled'?'teal':'blue')}</header><p>${h(subject(a.subject))} · ${h(a.teacher)}</p><p>${h(a.note||a.reason||'상담 내용과 다음 약속을 확인해 주세요.').slice(0,130)}</p><footer><span>${shortDate(a.date)} 접수</span><span>${a.followup?`${shortDate(a.followup)} 후속 일정`:'상담 상세 →'}</span></footer></button>`).join('')}</div>${!rows.length?empty('이 조건의 상담 기록이 없습니다.'):''}`;
  };
  const finance=()=>{
    const rows=db.invoices.filter(i=>i.period===state.financeMonth),billed=sum(rows,'total'),paid=sum(rows,'paid'),remaining=sum(rows,'remaining');
    const debts=rows.filter(i=>i.remaining>0).sort((a,b)=>b.remaining-a.remaining),expenses=db.finance.expenses.filter(e=>e.date.startsWith(state.financeMonth));
    const categories=Object.entries(expenses.reduce((o,e)=>(o[e.category||'기타']=(o[e.category||'기타']||0)+e.amount,o),{})).map(([label,count])=>({label,count:Math.round(count/10000)})).sort((a,b)=>b.count-a.count);
    return heading('돈의 흐름을 분명하게','청구, 누적 수납, 남은 금액을 구분해서 봅니다.',periodSelect('financeMonth',state.financeMonth,db.invoices.map(i=>i.period))+button(`${icon('book')} 월간 검토`,'report'))+
      metrics([['청구 금액',`${money(billed)}<small>원</small>`,`${rows.length}건 · 할인 반영, 취소·환불 제외`],['누적 수납',`${money(paid)}<small>원</small>`,`${rate(paid,billed)} 수납 완료`],['남은 수납',`${money(remaining)}<small>원</small>`,`${debts.length}건 확인 필요`],['기록된 지출',`${money(sum(expenses,'amount'))}<small>원</small>`,`${expenses.length}건 · 지출일 기준`]])+
      `<div class="live-grid equal">${panel(`${mlabel(state.financeMonth)} 수납의 진행`,state.financeMonth>db.meta.month?'다음 달 예정 청구 · 복사 시점까지의 수납':'해당 청구월에 연결된 누적 수납',`<div class="live-big">${rate(paid,billed)}<small>수납 완료</small></div><div class="live-amount" data-chart tabindex="0" role="group" aria-label="수납 ${won(paid)}, 남은 금액 ${won(remaining)} — 화살표 키로 확인합니다"><i data-point data-tip="${tipData(`${mlabel(state.financeMonth)} 청구분`,[{label:'수납',value:won(paid),tone:'primary'}],[billed?`청구액의 ${fmt(paid/billed*100)}%`:''])}" style="width:${billed?Math.min(100,paid/billed*100):0}%"></i><i data-point data-tip="${tipData(`${mlabel(state.financeMonth)} 청구분`,[{label:'남은 금액',value:won(remaining),tone:'secondary'}],[billed?`청구액의 ${fmt(remaining/billed*100)}%`:''])}" style="flex:1"></i></div><div class="between"><span class="muted">수납 ${won(paid)}</span><span class="muted">남은 금액 ${won(remaining)}</span></div><p class="live-note">입금 발생일 기준 현금 흐름이 아닙니다. 과거 월도 복사 시점까지 추가 수납된 금액을 포함합니다.</p>`)}${panel('청구와 수납의 변화','청구월 기준 · 만원',chart(recentTrend(),'billed','만원',{secondary:'paid',label:'청구액',secondaryLabel:'수납액'}))}</div>`+
      `<div class="live-grid equal">${panel('지출의 구성',`${mlabel(state.financeMonth)} 지출일에 해당하는 기록`,categories.length?bars(categories,'만원',7):empty('이 기간의 지출 기록이 없습니다.','미입력 비용을 포함한 전체 지출을 의미하지 않습니다.'))}${panel('재무 검토의 기준','확인된 기록의 범위에서 판단합니다.',`<div class="live-signal blue"><span>급여명세서</span><strong>${db.finance.payslips.filter(p=>p.period===state.financeMonth&&p.status==='issued').length}건 발급</strong><p>발급 명세서와 실제 지급 내역을 구분해 확인하세요.</p></div><p class="live-note">청구월별 누적 수납과 지출일별 비용은 기준이 다릅니다. 이를 단순 차감한 값을 순이익으로 표시하지 않습니다.</p>${go('직원 · 급여 살펴보기','staff')}`)}</div>`+
      subtitle('수납을 마무리할 연결','남은 금액이 큰 순서입니다. 학생의 상황을 먼저 확인하세요.')+
      (debts.length?`<div class="live-cards">${debts.slice(state.financePage*12,(state.financePage+1)*12).map(i=>`<button class="live-card" data-bill="${h(i.id)}"><header>${avatar(i.name)}<div><h3>${h(i.name)}</h3><p>${mlabel(i.period)} 청구</p></div>${badge(status(i.status),'amber')}</header><span class="live-card-label">남은 금액</span><div class="live-card-number">${money(i.remaining)}<small>원</small></div><p>${won(i.paid)} / ${won(i.total)} 수납</p><footer><span>납기 ${shortDate(i.due)}</span>${icon('chevron')}</footer></button>`).join('')}</div>${pager('financePage',state.financePage,debts.length,12)}`:empty('이 기간의 남은 수납이 없습니다.','취소·환불을 제외한 청구 기록 기준입니다.'));
  };
  const learning=()=>{
    const now=db.trend.find(t=>t.month===state.month)||current(),exams=db.learning.exams.filter(e=>e.month===state.month);
    return heading('배움이 이어지는 흐름','서로 다른 시험을 하나의 점수로 섞지 않고, 기록의 변화를 살펴봅니다.',periodSelect('month',state.month))+
      metrics([['이번 달 학습 리포트',`${fmt(now.reports)}<small>건</small>`,'수업에서 남긴 배움의 기록'],['진도 기록',`${fmt(now.progressEntries)}<small>건</small>`,'이번 달 날짜 기준'],['과제영상 등록',`${fmt(now.videoAssignments)}<small>건</small>`,'등록 시점 기준 · 평가 점수와 구분'],['긍정 피드백',`${fmt(now.positiveSignals)}<small>건</small>`,'취소되지 않은 이번 달 기록']])+
      `<div class="live-grid equal">${panel('학습 기록이 쌓이는 흐름','월별 학습 리포트 수',chart(recentTrend(),'reports','건',{label:'학습 리포트'}))}${panel('진도와 과제의 연결','월별 기록 건수',chart(recentTrend(),'progressEntries','건',{secondary:'videoAssignments',label:'진도 기록',secondaryLabel:'과제영상 등록'}))}</div>`+
      `${subtitle(`${mlabel(state.month)} 시험별 성취 기록`,'시험 종류·과목·응시 집단이 달라 평균을 연결한 성장선은 표시하지 않습니다.')}`+
      (exams.length?`<div class="live-cards">${exams.map(e=>`<section class="live-card"><header><div><h3>${h(e.name)}</h3><p>${subject(e.subject)} · ${mlabel(e.month)}</p></div>${badge(`${e.students}명`,'blue')}</header><span class="live-card-label">만점 100점 환산 평균</span><div class="live-card-number">${fmt(e.average)}<small>점</small></div><p>${e.count}개 점수 기록 · 시험 미응시 제외</p><footer><span>시험별 학습 맥락을 함께 확인하세요.</span></footer></section>`).join('')}</div>`:empty('이 기간의 시험 점수 기록이 없습니다.'))+
      subtitle('학생의 학습 맥락','최근 점수와 진도 기록이 있는 재원생')+`<div class="live-cards">${studentCards(active().filter(s=>s.grades.length||s.progress.length).sort((a,b)=>b.positive-a.positive).slice(0,9))}</div>`;
  };
  const staff=()=>{
    const issued=db.finance.payslips.filter(p=>p.status==='issued'),latest=[...new Set(issued.map(p=>p.period))].sort().at(-1),latestPayslips=issued.filter(p=>p.period===latest);
    return heading('사람과 운영의 균형','담당 수업과 열린 업무, 근무 기록과 급여명세서를 함께 봅니다.')+
      metrics([['활동 중인 직원',`${db.staff.length}<small>명</small>`,'현재 계정 상태 기준'],['이번 달 근무 기록',`${sum(db.staff,'workDays')}<small>건</small>`,'일별 등록 기록 · 인원과 구분'],['최근 발급 명세서',`${latestPayslips.length}<small>건</small>`,latest?`${mlabel(latest)} 발급분`:'발급 기록 없음'],['발급분 지급액 합계',`${money(sum(latestPayslips,'net'))}<small>원</small>`,'명세서 표기 금액 · 실제 지급과 구분']])+
      `<div class="live-grid equal">${panel('수업의 연결', '선생님별 담당 반 수',bars(db.staff.filter(s=>s.classes.length).map(s=>({label:s.name,count:s.classes.length})).sort((a,b)=>b.count-a.count),'개',8))}${panel('열린 업무의 분포','한 업무에 여러 담당자가 있을 수 있습니다.',bars(db.staff.filter(s=>s.tasks).map(s=>({label:s.name,count:s.tasks})).sort((a,b)=>b.count-a.count),'건',8))}</div>`+
      subtitle('함께 운영하는 사람들','직원을 누르면 수업·근무·명세서를 연결해서 볼 수 있습니다.')+`<div class="live-cards">${db.staff.map(s=>`<button class="live-card" data-staff="${h(s.id)}"><header>${avatar(s.name)}<div><h3>${h(s.name)}</h3><p>${h(s.title)}</p></div>${badge(s.subjects.map(subject).join('·')||'운영')}</header><div class="live-card-number">${s.classes.length}<small>개 담당 반</small></div><p>이번 달 근무 ${s.workDays}일 기록 · 열린 업무 ${s.tasks}건</p><footer><span>${s.contracts.length?'유효 계약 기록 있음':'계약 기록 확인'}</span>${icon('chevron')}</footer></button>`).join('')}</div>`;
  };

  const parents=()=>{
    const c=db.communication;
    return heading('대화가 이어지는 학원','전달 이후의 읽음과 학부모의 이야기를 함께 살펴봅니다.',button(`${icon('plus')} 안내 초안 작성`,'message-draft','primary'))+
      metrics([['이번 달 전달 리포트',`${fmt(c.sent)}<small>건</small>`,'전송 성공 상태 기준'],['읽음 확인',`${fmt(c.read)}<small>건</small>`,`전달 리포트의 ${rate(c.read,c.sent)}`],['전송 실패 기록',`${c.failed}<small>건</small>`,'현재 상태 기준 · 재확인 필요'],['이번 달 답글 기록',`${c.replies}<small>건</small>`,'학부모 대화에 남긴 답글']])+
      `<div class="live-grid equal">${panel('전달에서 읽음까지','리포트 작성월 기준 · 현재 확인 상태',chart(recentTrend(),'sent','건',{secondary:'read',label:'전달 완료',secondaryLabel:'읽음 확인'})+'<p class="live-note">작성월별 현재 읽음 상태입니다. 읽지 않은 이유나 가정의 상황을 추정하지 않습니다.</p>')}${panel('최근 대화의 맥락','가장 최근 80개 학부모 메시지의 분류',bars(group(db.messages,m=>m.category||'일반 대화'),'건',7))}</div>`+
      subtitle('학부모의 이야기','메시지를 누르면 학생의 맥락과 답글을 함께 볼 수 있습니다.')+
      `<div class="live-cards">${db.messages.slice(0,18).map(m=>`<button class="live-card" data-message="${h(m.id)}"><header>${avatar(m.name)}<div><h3>${h(m.name)} 보호자</h3><p>${shortDate(m.date)}</p></div>${badge(m.category||'대화','blue')}</header><p>${h(String(m.content||m.detail||'대화 기록').slice(0,140))}</p><footer><span>답글 ${m.replies.length}건</span><span>맥락 살펴보기 →</span></footer></button>`).join('')}</div>`;
  };
  const shuttle=()=>{
    const runs=db.runs.filter(r=>r.vehicleId===state.vehicle&&r.season===state.season);
    const run=runs.find(r=>r.id===state.run)||runs[0];
    if(run)state.run=run.id;
    const records=db.boardings.filter(b=>b.date===state.selectedDate),riderCount=run?new Set(run.stops.flatMap(s=>s.riders.map(r=>r.studentId))).size:0;
    return heading('안전하게 이어지는 이동','배정과 실제 탑승 기록을 구분해 확인합니다.',`<input type="date" aria-label="차량 기록 날짜" id="shuttle-date" value="${state.selectedDate}">`)+
      metrics([['운행 차량',`${db.vehicles.length}<small>대</small>`,'현재 사용 중인 차량'],['선택 차량의 운행',`${runs.length}<small>회차</small>`,state.season==='term'?'학기 중 배정':'방학 배정'],['선택 회차 배정',`${riderCount}<small>명</small>`,'요일별 배정이 포함된 고유 학생'],['선택일 탑승 기록',`${records.length}<small>건</small>`,records.length?'입력된 실제 탑승 기록':'당일 기록 없음 · 미탑승과 구분']])+
      `${filters('vehicle',db.vehicles.map(v=>[v.id,v.name]),state.vehicle)}${filters('season',[['term','학기 중'],['vacation','방학']],state.season)}${filters('run',runs.map(r=>[r.id,`${r.direction==='in'?'등원':'하원'} · ${r.label}`]),run?.id)}`+
      `<div class="live-grid">${panel(run?`${h(run.label)} · ${run.direction==='in'?'등원':'하원'}의 연결`:'운행 정보','시간과 정류장을 따라 배정 학생을 확인하세요.',run?`<div class="live-agenda">${run.stops.map(s=>`<div class="live-agenda-item"><span>${h(s.time||'시간 미정')}</span><div><strong>${h(s.name)}</strong><p>${s.riders.length}명 배정</p><div class="live-filter">${s.riders.map(r=>`<button class="button small" data-student="${h(r.studentId)}">${h(r.name)}</button>`).join('')}</div></div></div>`).join('')}</div>`:empty('등록된 운행 정보가 없습니다.'))}${panel(`${shortDate(state.selectedDate)} 탑승 기록`,'배정 정보만으로 탑승 여부를 판단하지 않습니다.',records.length?`<div class="live-agenda">${records.map(b=>`<button class="live-agenda-item" data-student="${h(b.studentId)}"><span>${h(b.vehicle||'차량')}</span><div><strong>${h(b.name)} · ${status(b.status)}</strong><p>${h(b.stop)}</p></div></button>`).join('')}</div>`:empty('이 날짜의 탑승 기록이 없습니다.','아직 기록되지 않은 상태입니다. 실제 미탑승 또는 결석을 의미하지 않습니다.'))}</div>`;
  };
  // 2.0 staff_tasks kinds. They open and close from the underlying records (never by a button); owner_review is this prototype's personal task.
  const taskKind=k=>({report_send_failed:'보고서 발송 실패',followup_due:'상담 후속조치',enrollment_followup:'콜&상담 후속 조치',progress_anomaly:'진도 기록 이상',attendance_absent_desk:'결석 확인 전화',video_upload_check:'영상 업로드 확인',video_unassigned:'미배정 영상',unsent_report:'미발송 수업 보고서',approval_turn:'전자결재 차례',withdrawal_step:'퇴원보고서',help_question:'도움말 질문',owner_review:'원장 개인 업무'}[k]||'자동 할 일');
  const TASK_SOURCE={report_send_failed:['lesson-reports','learning'],followup_due:['consultations','students'],enrollment_followup:['enrollment','admissions'],progress_anomaly:['students','learning'],attendance_absent_desk:['attendance','students'],video_upload_check:['video-homework','learning'],video_unassigned:['video-homework','learning'],unsent_report:['lesson-reports','learning'],approval_turn:['approvals','approvals'],withdrawal_step:['withdrawal-reports','students'],help_question:['help','settings']};
  const taskSourcePage=k=>{const [family,legacy]=TASK_SOURCE[k]||[];return family&&viewFor(`workspace-${family}`)?`workspace-${family}`:legacy||'';};
  const approvals=()=>{
    const open=db.tasks.filter(t=>t.status==='open'),rows=db.tasks.filter(t=>state.taskFilter==='all'||t.status===state.taskFilter);
    return heading('결정에서 실행까지','결재의 맥락을 읽고, 담당자의 다음 행동까지 연결합니다.',button(`${icon('plus')} 검토 업무 추가`,'new-task','primary'))+
      `<div class="live-grid equal">${panel('결재의 현재 위치','문서에 남은 상태 기준',`<div class="live-flow">${['pending','approved','rejected'].map(s=>`<button data-approval-status="${s}"><span>${status(s)}</span><strong>${db.approvals.filter(a=>a.status===s).length}</strong><small>문서 ${db.approvals.filter(a=>a.status===s).length}건</small></button>`).join('')}</div>`)}${panel('열린 업무는 어디에 모여 있나요',`${open.length}건 진행 중 · 담당과 기한을 함께 확인하세요.`,bars(group(open,t=>taskKind(t.kind)),'건',6))}</div>`+
      subtitle('결정할 문서','승인·반려는 시안 안에서 검토해 볼 수 있습니다.')+`<div class="live-cards">${db.approvals.filter(a=>!state.approvalStatus||a.status===state.approvalStatus).map(a=>`<button class="live-card" data-approval="${h(a.id)}"><header><div><h3>${h(a.title)}</h3><p>${h(a.drafter)} · ${shortDate(a.date)}</p></div>${badge(status(a.status),a.status==='pending'?'amber':'teal')}</header><p>${a.steps.length}단계 결재 · ${h(a.number||'문서 번호 미입력')}</p><footer><span>${a.local?'시안에서 변경됨':'검토 맥락 확인'}</span>${icon('chevron')}</footer></button>`).join('')}</div>`+
      subtitle('실행 중인 연결')+filters('taskFilter',[['open','진행 중'],['done','완료'],['all','전체']],state.taskFilter)+
      `<div class="live-cards">${rows.slice((state.taskPage||0)*18,((state.taskPage||0)+1)*18).map(t=>`<button class="live-card" data-task="${h(t.id)}"><header><div><h3>${h(t.title)}</h3><p>${h(taskKind(t.kind))}</p></div>${badge(status(t.status),t.status==='done'?'teal':'')}</header><p>${h(String(t.detail||'상세 내용에서 업무의 맥락을 확인하세요.').slice(0,110))}</p><footer><span>${h(t.owners.join(', ')||'담당 확인 필요')}</span><span>${t.due?`${shortDate(t.due)}까지`:'기한 미정'}</span></footer></button>`).join('')}</div>${pager('taskPage',state.taskPage||0,rows.length,18)}`;
  };
  const resources=()=>{
    const orders=db.textbooks,stages=['requested','ordered','delivered','paid'];
    let content;
    if(state.resourceView==='textbooks')content=`<div class="live-grid equal">${panel('교재가 학생에게 닿는 흐름','현재 상태별 주문 건수',`<div class="live-flow">${stages.map(s=>`<button data-book-status="${s}"><span>${status(s)}</span><strong>${orders.filter(o=>o.status===s).length}</strong><small>현재 위치 · 누적 이력</small></button>`).join('')}</div>`)}${panel('교재 요청의 추이','요청일의 월별 건수',chart(db.months.map(m=>({month:m,count:orders.filter(o=>o.date.startsWith(m)).length})),'count','건',{label:'교재 요청'}))}</div>`+subtitle('다음 손길이 필요한 교재','상태를 선택하면 해당 주문을 확인할 수 있습니다.')+`<div class="live-cards">${orders.filter(o=>state.bookStatus?o.status===state.bookStatus:o.status!=='paid').slice(0,24).map(o=>`<button class="live-card" data-book="${h(o.id)}"><header><div><h3>${h(o.name)}</h3><p>${h(o.student)} · ${h(o.teacher||'담당 확인')}</p></div>${badge(status(o.status),'amber')}</header><p>${won(o.price)}</p><footer><span>${shortDate(o.date)} 요청</span><span>연결 보기 →</span></footer></button>`).join('')}</div>`;
    else if(state.resourceView==='assets')content=`<div class="live-grid equal">${panel('자산의 현재 상태',`${db.assetCount}개 자산의 등록 상태`,bars(db.assets.map(a=>({...a,label:status(a.label)})),'개',7))}${panel('소모품의 여유','수량이 적은 순서 · 단위별 보충 기준은 별도 확인',bars([...db.supplies].sort((a,b)=>a.qty-b.qty).slice(0,8).map(s=>({label:s.name,count:s.qty})),'개',8))}</div>`+subtitle('비품을 살펴볼 자리')+`<div class="live-cards">${db.supplies.map(s=>`<section class="live-card"><header><div><h3>${h(s.name)}</h3><p>${h(s.location||'보관 위치 미입력')}</p></div></header><div class="live-card-number">${s.qty}<small>개 기록</small></div><footer><span>${shortDate(s.date)} 점검</span></footer></section>`).join('')}</div>`;
    else content=`<div class="live-grid equal">${panel('운영 지식의 구성','현재 등록된 문서의 분류',bars(group(db.documents,'category'),'건',8))}${panel('찾고, 읽고, 이어가기',`${db.documents.length}개의 문서가 운영의 맥락을 담고 있습니다.`,`<div class="live-signal blue"><span>최근 갱신 문서</span><strong>${db.documents.filter(d=>d.updated.startsWith(db.meta.month)).length}건</strong><p>이번 달 수정된 문서 · 원문 또는 로컬 첨부파일을 확인할 수 있습니다.</p></div><input id="document-search" style="margin-top:18px;width:100%" aria-label="문서 검색" placeholder="문서 제목 검색" value="${h(state.documentQuery||'')}">`)}</div>`+`<div class="live-cards">${db.documents.filter(d=>d.title.includes(state.documentQuery||'')).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,30).map(d=>`<button class="live-card" data-document="${h(d.id)}"><header><div><h3>${h(d.title)}</h3><p>${h(d.category||'일반 문서')}</p></div></header><p>${h(String(d.description||'문서의 상세 내용을 확인하세요.').slice(0,100))}</p><footer><span>${shortDate(d.updated)} 갱신</span><span>${d.hasFile?'첨부파일 있음':'내용 보기'} →</span></footer></button>`).join('')}</div>`;
    return heading('운영을 받쳐주는 것들','교재, 물품, 문서를 필요한 맥락에서 만납니다.')+filters('resourceView',[['textbooks','교재의 흐름'],['assets','자산 · 소모품'],['documents','운영 문서']],state.resourceView)+content;
  };
  const calendar=()=>{
    const [year,month]=state.calendarMonth.split('-').map(Number),first=new Date(year,month-1,1).getDay(),days=new Date(year,month,0).getDate();
    const eventsOn=d=>db.calendar.filter(e=>e.date<=d&&(e.end||e.date)>=d);
    const selected=eventsOn(state.selectedDate),monthEvents=db.calendar.filter(e=>e.date.startsWith(state.calendarMonth));
    const cells=Array.from({length:first},()=>'<div></div>').join('')+Array.from({length:days},(_,i)=>{const d=`${state.calendarMonth}-${String(i+1).padStart(2,'0')}`,events=eventsOn(d);return `<button class="live-day ${d===state.selectedDate?'selected':''} ${d===db.meta.asOf?'today':''}" data-day="${d}" aria-label="${month}월 ${i+1}일, 일정 ${events.length}개" aria-pressed="${d===state.selectedDate}"><strong>${i+1}</strong>${events.length?`<p>${h(events[0].title)}</p><small>${events.length}개 일정</small>`:''}</button>`;}).join('');
    return heading('학원의 시간을 함께 보다','수업 밖의 일정과 보강 약속을 한곳에서 확인합니다.',button(`${icon('plus')} 일정 메모`,'calendar-note'))+
      `<div class="live-grid">${panel(`${year}년 ${month}월`,`${monthEvents.length}개 시작 일정`, `<div class="live-calendar">${'일월화수목금토'.split('').map(d=>`<small>${d}</small>`).join('')}${cells}</div>`,`<div class="flex"><button class="icon-button" data-calendar-move="-1" aria-label="이전 달">‹</button><button class="button small" data-action="today">오늘</button><button class="icon-button" data-calendar-move="1" aria-label="다음 달">›</button></div>`)}${panel(`${shortDate(state.selectedDate)}의 약속`,`${selected.length}개 일정`,selected.length?`<div class="live-agenda">${selected.map(e=>`<button class="live-agenda-item" data-event="${h(e.id)}"><span>${h(e.start||'종일')}</span><div><strong>${h(e.title)}</strong><p>${e.finish?`${h(e.finish)} 종료`:'등록된 학원 일정'}</p></div></button>`).join('')}</div>`:empty('등록된 일정이 없습니다.','선택한 날짜에 시작되거나 이어지는 일정 기준입니다.'))}</div>`+
      subtitle('보강 약속의 흐름','예약과 출결 인정은 구분합니다.')+`<div class="live-cards">${db.makeup.filter(m=>m.date.startsWith(state.calendarMonth)).map(m=>`<section class="live-card"><header><div><h3>${h(m.name)}</h3><p>${h(m.className)}</p></div>${badge(status(m.status),'blue')}</header><p>${shortDate(m.absence)} 원수업 → ${shortDate(m.date)} 보강</p><footer><span>${h(m.start||'시간 확인 필요')}</span></footer></section>`).join('')}</div>`;
  };
  const settings=()=>heading('학원 운영의 기준','지금 보고 있는 데이터와 시안의 동작 범위를 확인합니다.')+
    `<div class="live-grid equal">${panel('학원 정보','현재 선택된 지점',`<div class="live-drawer-summary"><strong>${h(db.meta.tenant)}</strong><p>원장 · 경영자 관점의 경영 공간</p></div><div class="live-form" style="padding:20px 0 0"><label>학원 표시 이름<input id="academy-name" value="${h(db.meta.tenant)}"></label>${button('표시 이름 적용해보기','save-name','primary')}<p class="live-note">현재 시안의 표시 이름을 변경합니다. 새로고침하면 복사본의 값으로 돌아옵니다.</p></div>`)}${panel('현재 연결된 데이터','검증된 전체 DB의 침산 데이터를 사용합니다.',`<div class="live-health-grid"><div><span class="live-status-dot"></span>전체 테이블<strong>${db.meta.tables.length}개</strong><p>원본과 행 수·내용 검증</p></div><div><span class="live-status-dot"></span>복사된 기록<strong>${fmt(db.meta.rows)}건</strong><p>테이블·컬럼 필터 없는 전체 백업</p></div></div><p class="live-note">복사 시점: ${h(new Date(db.meta.importedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}<br>이 시안은 로컬 복사본에 연결됩니다. 새 입력과 검토는 화면 세션에서만 반영됩니다.</p><p class="live-note">데이터 저장: F:\\aywa-dev<br>기간별 지표의 집계 기준은 각 화면에서 확인할 수 있습니다.</p>`)}</div>`;

  function dialog(id,title,description,body){
    const node=$(`#${id}`);node.innerHTML=`<header class="live-dialog-header"><div><h2 id="${id}-title">${h(title)}</h2>${description?`<p>${h(description)}</p>`:''}</div><button class="icon-button" data-close="${id}" aria-label="닫기">${icon('close')}</button></header><div class="live-detail-body live-scroll">${body}</div>`;
    if(!node.open)node.showModal();attachScroll();
  }
  const recordLines=(rows,emptyText='등록된 기록이 없습니다.')=>rows.length?`<div class="live-agenda">${rows.map(r=>`<div class="live-agenda-item"><span>${h(r.date||'날짜 미입력')}</span><div><strong>${h(r.title)}</strong><p class="live-pre">${h(r.text||'')}</p></div></div>`).join('')}</div>`:empty(emptyText);
  const notesFor=context=>state.localNotes.filter(n=>n.context===context);
  const notePanel=context=>notesFor(context).length?panel('이 시안에서 작성한 메모','새로고침하면 초기화됩니다.',recordLines(notesFor(context).map(n=>({date:shortDate(n.date),title:n.title,text:n.body})))):'';
  function showStudent(id){
    const s=byId('students',id);if(!s)return;state.studentId=id;
    const classRows=s.classes.map(id=>byId('classes',id)).filter(Boolean);
    dialog('detail',s.name,`${s.school} · ${s.grade} · ${status(s.status)}`,
      `<div class="live-drawer-summary"><strong>${s.attendance.total?s.attendance.absent+'회 결석':'출결 기록 없음'}</strong><p>${mlabel(db.meta.month)} 전체 ${s.attendance.total}회 출결 기록 · 지각 ${s.attendance.late}회 · 보강 ${s.attendance.makeup}회</p></div><div class="flex">${button(`${icon('plus')} 후속 업무 등록`,'student-task','primary')}${button('검토 메모','student-note')}</div>`+
      panel('함께하는 수업','현재 유효한 수강 관계',classRows.length?`<div class="live-filter">${classRows.map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`:empty('현재 연결된 수업이 없습니다.'))+
      panel('배움의 최근 기록','점수는 시험별 만점과 함께 표시합니다.',recordLines(s.grades.map(g=>({date:shortDate(g.date),title:`${subject(g.subject)} · ${g.exam} ${g.score}/${g.max}`,text:''})))+recordLines(s.progress.map(p=>({date:shortDate(p.date),title:'진도 기록',text:p.content})),'등록된 진도 기록이 없습니다.'))+
      panel('수업에서 전한 이야기','최근 학습 리포트',recordLines(s.lessons.map(l=>({date:shortDate(l.date),title:`${subject(l.subject)} · ${l.teacher||'담당 선생님'}`,text:l.progress}))))+
      panel('상담의 맥락',`후속 확인 ${s.followups}건`,recordLines(s.consultations.map(c=>({date:shortDate(c.date),title:c.category||'상담',text:[c.summary,c.followup?`다음 행동: ${c.followup}`:'',c.due?`${shortDate(c.due)} ${c.done?'완료':'후속 일정'}`:''].filter(Boolean).join('\n')}))))+
      panel(`${mlabel(db.meta.month)} 수납 연결`,'이번 달 청구분',`<dl><dt>청구 금액</dt><dd>${won(s.billed)}</dd><dt>수납 금액</dt><dd>${won(s.paid)}</dd><dt>남은 금액</dt><dd>${won(s.remaining)}</dd></dl>`)+notePanel(`student:${id}`));
  }
  function showClass(id){const c=byId('classes',id);if(!c)return;dialog('detail',c.name,`${subject(c.subject)} · ${c.teacher} · ${c.room}`,
    `<div class="live-drawer-summary"><strong>${c.students.length}명 수강 관계</strong><p>등록 강의실 정원 ${c.capacity??'미입력'}${c.capacity?'명':''} · 분리 등원과 실제 동시 출석 인원은 별도입니다.</p></div>`+
    panel('일주일의 만남','복사 기준일에 유효한 시간표',recordLines(c.schedules.map(s=>({date:'일월화수목금토'[s.day]+'요일',title:`${s.start}–${s.end}`,text:`${s.teacher} · ${s.room}`}))))+
    panel('함께 배우는 학생','학생을 누르면 개인의 흐름으로 이어집니다.',`<div class="live-filter">${c.students.map(id=>{const s=byId('students',id);return s?`<button class="button" data-student="${h(id)}">${h(s.name)}</button>`:'';}).join('')}</div>`)+
    panel('출결 기록의 맥락',`${mlabel(db.meta.month)} 등록된 기록 기준`,`<div class="live-big">${c.absent}<small>회 결석 / ${c.attendance}회 전체 기록</small></div><p class="live-note">실제로 입력된 출결 기록 기준입니다. 결석률을 학생의 학습 의지로 해석하지 않습니다.</p>`));}
  function showLead(id){const a=byId('admissions',id);if(!a)return;state.leadId=id;dialog('detail',`${a.name} · 입학 상담`,`${a.school||'학교 미입력'} · ${a.grade||'학년 미입력'}`,
    `<div class="live-drawer-summary"><strong>${status(a.outcome)}</strong><p>${shortDate(a.date)} 접수 · ${h(a.teacher)} 담당${a.local?' · 시안에서 변경됨':''}</p></div><dl><dt>상담 과목</dt><dd>${h(subject(a.subject))}</dd><dt>유입 경로</dt><dd>${h(a.channel)}</dd><dt>후속 일정</dt><dd>${shortDate(a.followup)}</dd><dt>상담 메모</dt><dd>${h(a.note||a.reason||'입력된 메모가 없습니다.')}</dd></dl>`+
    `<div class="flex">${a.outcome!=='enrolled'?button('다음 단계로 변경해보기','advance-lead','primary'):badge('등록 상태','teal')}${button('후속 메모','lead-note')}</div><p class="live-note">이 시안에서 상태 변화를 검토합니다. 실제 학생 등록을 실행하지 않습니다.</p>`+notePanel(`lead:${id}`));}
  function showBill(id){const i=byId('invoices',id);if(!i)return;state.billId=id;dialog('detail',`${i.name} · ${mlabel(i.period)} 수납`,status(i.status),
    `<div class="live-drawer-summary"><strong>${won(i.remaining)}</strong><p>현재 남은 금액</p></div><dl><dt>할인 전 금액</dt><dd>${won(i.gross)}</dd><dt>할인</dt><dd>${won(i.discount)}</dd><dt>실제 청구 금액</dt><dd>${won(i.total)}</dd><dt>누적 수납</dt><dd>${won(i.paid)}</dd><dt>납부 기한</dt><dd>${i.due||'미입력'}</dd><dt>청구 구분</dt><dd>${i.category==='tuition'?'수강료':'기타'}</dd></dl><div class="flex"><button class="button" data-student="${h(i.studentId)}">학생의 맥락 보기</button>${button('수납 확인 메모','bill-note','primary')}</div>`+notePanel(`bill:${id}`));}
  function showStaff(id){const s=byId('staff',id);if(!s)return;dialog('detail',s.name,s.title,
    `<div class="live-drawer-summary"><strong>${s.classes.length}개 담당 반</strong><p>이번 달 근무 기록 ${s.workDays}일 · 열린 업무 ${s.tasks}건</p></div>`+
    panel('담당 수업','수업에서 학생과의 연결을 살펴보세요.',`<div class="live-filter">${s.classes.map(id=>byId('classes',id)).filter(Boolean).map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`)+
    panel('급여명세서','명세서의 지급액과 실제 지급은 구분합니다.',recordLines(db.finance.payslips.filter(p=>p.userId===id).map(p=>({date:mlabel(p.period),title:status(p.status),text:p.net===null?'금액 미확정':`명세서 지급액 ${won(p.net)} · 지급 총액 ${won(p.gross)}`})),'등록된 명세서가 없습니다.'))+
    panel('유효한 계약 기록','원본에 기록된 계약 기간',recordLines(s.contracts.map(c=>({date:c.start||'시작일 미입력',title:c.end?`${c.end}까지`:'종료일 미입력',text:'현재 기준일에 유효한 계약 기록'})))));
  }
  function showMessage(id){const m=byId('messages',id);if(!m)return;state.messageId=id;dialog('detail',`${m.name} 보호자의 이야기`,`${shortDate(m.date)} · ${m.category||'일반 대화'}`,
    `<div class="live-pre">${h(m.content||m.detail||'내용 없음')}</div><div class="flex"><button class="button" data-student="${h(m.studentId)}">학생의 맥락 보기</button>${button('답글 초안 작성','reply-draft','primary')}</div>`+
    panel('이어진 답글','저장된 답글 이력',recordLines(m.replies.map(r=>({date:shortDate(r.date),title:r.author||'담당자',text:r.body}))))+notePanel(`message:${id}`));}
  function showApproval(id){const a=byId('approvals',id);if(!a)return;state.approvalId=id;dialog('detail',a.title,`${a.drafter} · ${a.number||'결재 문서'}`,
    `<div class="live-drawer-summary"><strong>${status(a.status)}</strong><p>${a.local?'시안에서 검토한 상태입니다.':'복사 시점에 기록된 상태입니다.'}</p></div>`+
    panel('결정의 연결','순서에 따른 결재 기록',recordLines(a.steps.map((s,i)=>({date:`${i+1}단계`,title:s.name,text:`${({approve:'승인',approved:'승인',reject:'반려',rejected:'반려',pending:'대기'}[s.decision]||'대기')} ${s.date?shortDate(s.date):''}${s.comment?'\n'+s.comment:''}`}))))+
    (a.note?`<p class="live-pre">${h(a.note)}</p>`:'')+(a.status==='pending'?`<div class="flex">${button('승인해보기','approve','primary')}${button('반려 의견 작성','reject','danger')}</div><p class="live-note">승인·반려의 흐름을 이 시안에서 확인합니다. 운영 문서는 변경되지 않습니다.</p>`:'')+notePanel(`approval:${id}`));}
  function showTask(id){const t=byId('tasks',id);if(!t)return;state.taskId=id;const personal=t.kind==='owner_review'&&t.local,source=taskSourcePage(t.kind);dialog('detail',t.title,`${taskKind(t.kind)} · ${status(t.status)}`,
    `<p class="live-pre">${h(t.detail||'상세 내용이 없습니다.')}</p><dl><dt>담당</dt><dd>${h(t.owners.join(', ')||'담당 미지정')}</dd><dt>기한</dt><dd>${t.due||'미정'}</dd><dt>열린 날짜</dt><dd>${t.opened||'미입력'}</dd>${t.closed?`<dt>닫힌 날짜</dt><dd>${h(t.closed)}</dd>`:''}</dl>${personal?`${button(t.status==='done'?'다시 열기':'완료 표시','complete-task','primary')}<p class="live-note">원장님이 이 시안에서 만든 개인 업무입니다. 완료 표시는 이 화면에서만 바뀌고 새로고침하면 초기화됩니다.</p>`:`<div class="live-drawer-summary"><strong>자동 할 일</strong><p>2.0은 원본 기록이 처리되면 이 할 일을 자동으로 닫습니다. 버튼으로 완료 처리하지 않습니다.</p></div><div class="flex">${source?`<button class="button primary" data-go="${h(source)}">원본 기록 열기</button>`:''}${button('후속 요청 만들기','task-followup')}</div>`}`);}
  const RECORD_VIEWS=[['students',showStudent],['invoices',showBill],['approvals',showApproval],['tasks',showTask],['classes',id=>showClass(id)],['staff',id=>showStaff(id)],['admissions',id=>showLead(id)],['messages',id=>showMessage(id)],['textbooks',id=>showBook(id)],['documents',id=>showDocument(id)],['calendar',id=>showEvent(id)]];
  function canOpenRecord(id){return RECORD_VIEWS.some(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));}
  function openRecord(id){const hit=RECORD_VIEWS.find(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));if(hit)hit[1](String(id));}
  function showBook(id){const b=byId('textbooks',id);if(!b)return;dialog('detail',b.name,`${b.student} · ${status(b.status)}`,`<dl><dt>담당 선생님</dt><dd>${h(b.teacher||'미입력')}</dd><dt>교재 금액</dt><dd>${won(b.price)}</dd><dt>요청일</dt><dd>${b.date||'미입력'}</dd><dt>주문일</dt><dd>${b.ordered||'미입력'}</dd><dt>전달일</dt><dd>${b.delivered||'미입력'}</dd></dl>${b.studentId?`<button class="button" data-student="${h(b.studentId)}">학생의 맥락 보기</button>`:''}`);}
  function showDocument(id){const d=byId('documents',id);if(!d)return;dialog('detail',d.title,`${d.category||'일반 문서'} · ${shortDate(d.updated)} 갱신`,`${d.description?`<p class="live-pre">${h(d.description)}</p>`:''}${d.body?`<div class="live-pre">${h(d.body)}</div>`:''}${d.hasFile?`<button class="button primary" data-document-download="${h(id)}">로컬 첨부파일 다운로드</button>`:empty('첨부파일이 없는 문서입니다.','현재 복사본에 저장된 설명과 본문을 표시합니다.')}`);}
  function showEvent(id){const e=byId('calendar',id);if(!e)return;state.eventId=id;dialog('detail',e.title,`${e.date}${e.end&&e.end!==e.date?' ~ '+e.end:''}`,`<div class="live-drawer-summary"><strong>${h(e.start||'종일 일정')}</strong><p>${h(e.finish?e.finish+' 종료':'학원에 등록된 일정')}</p></div>${button('이 일정의 검토 메모','event-note','primary')}`+notePanel(`event:${id}`));}
  function previewForm(kind,title,context='',defaultTitle=''){
    state.noteContext=context;
    const fields=kind==='lead'?`<label>학생 이름<input name="name" required maxlength="60"></label><div class="live-split"><label>학년<input name="grade" placeholder="예: 초6" maxlength="20"></label><label>학교<input name="school" maxlength="60"></label></div><label>상담하고 싶은 내용<textarea name="body" required maxlength="2000"></textarea></label>`:kind==='task'?`<label>해야 할 일<input name="title" required maxlength="160" value="${h(defaultTitle)}"></label><label>업무의 맥락<textarea name="body" maxlength="2000"></textarea></label><div class="live-split"><label>담당<select name="owner"><option>원장</option>${db.staff.map(s=>`<option>${h(s.name)}</option>`).join('')}</select></label><label>기한<input type="date" name="due" value="${db.meta.asOf}"></label></div>`:`<label>제목<input name="title" required maxlength="160" value="${h(defaultTitle||title)}"></label><label>${kind==='message'?'전하고 싶은 내용':kind==='reject'?'반려 사유':'검토 내용'}<textarea name="body" required maxlength="4000"></textarea></label>${kind==='calendar'?`<label>날짜<input type="date" name="date" required value="${state.selectedDate}"></label>`:''}`;
    const node=$('#modal');node.innerHTML=`<header class="live-dialog-header"><div><h2 id="modal-title">${h(title)}</h2><p>이 시안에서 검토하는 초안입니다.</p></div><button class="icon-button" data-close="modal" aria-label="닫기">${icon('close')}</button></header><form id="preview-form" class="live-form live-scroll" data-kind="${kind}">${fields}<p class="form-hint">운영 데이터와 외부 발송에는 반영되지 않습니다. 새로고침하면 초기화됩니다.</p><button class="button primary" type="submit">${kind==='task'?'업무 추가':kind==='lead'?'상담 추가':'초안 저장'}</button></form>`;if(!node.open)node.showModal();attachScroll();node.querySelector('input')?.focus();
  }
  function showReport(){
    const month=state.page==='finance'?state.financeMonth:state.month,rows=db.invoices.filter(i=>i.period===month),leads=db.admissions.filter(a=>a.date.startsWith(month));
    dialog('modal',`${db.meta.tenant} · ${mlabel(month)} 경영 검토`,`${db.meta.asOf} 복사본 기준`,
      `<div class="live-health-grid"><div>청구 대상<strong>${new Set(rows.map(r=>r.studentId)).size}명</strong></div><div>누적 수납<strong>${money(sum(rows,'paid'))}원</strong></div><div>남은 수납<strong>${money(sum(rows,'remaining'))}원</strong></div><div>접수 상담<strong>${leads.length}건</strong></div></div>${chart(recentTrend(),'payingStudents','명',{label:'월별 청구 대상'})}<p class="live-note">청구월별 누적 수납 기준입니다. 현재까지의 기록이며 순이익·동일 일자 현금 흐름을 뜻하지 않습니다.</p><div class="flex">${button('월별 지표 CSV','export')}${button('검토 메모 남기기','report-note','primary')}</div>`);
  }
  function searchResults(){
    const q=state.search.trim().toLowerCase(),matched=(text)=>String(text).toLowerCase().includes(q);
    const menus=pages.filter(p=>matched(p[1])),students=db.students.filter(s=>matched(`${s.name} ${s.school}`)).slice(0,10),classes=db.classes.filter(c=>matched(`${c.name} ${c.teacher}`)).slice(0,5),staff=db.staff.filter(s=>matched(s.name)).slice(0,5);
    const item=(attrs,title,note)=>`<button class="live-search-item" ${attrs}><span><strong>${h(title)}</strong><br><small>${h(note)}</small></span>${icon('chevron')}</button>`;
    return (q?ws?.searchItems(q)||[]:[]).map(w=>item(`data-go="${h(w.page)}"`,w.title,w.note)).join('')+menus.map(p=>item(`data-go="${p[0]}"`,p[1],'메뉴')).join('')+students.map(s=>item(`data-search-student="${h(s.id)}"`,s.name,`${s.school} · ${status(s.status)}`)).join('')+classes.map(c=>item(`data-search-class="${h(c.id)}"`,c.name,c.teacher)).join('')+staff.map(s=>item(`data-search-staff="${h(s.id)}"`,s.name,s.title)).join('')||empty('검색 결과가 없습니다.');
  }
  function showSearch(){state.search='';const node=$('#modal');node.innerHTML=`<header class="live-dialog-header"><h2 id="modal-title">맥락으로 바로 가기</h2><button class="icon-button" data-close="modal" aria-label="닫기">${icon('close')}</button></header><div class="live-form"><input id="global-search" aria-label="통합 검색" placeholder="학생, 학교, 수업, 선생님 검색" autocomplete="off"></div><div class="live-search-results live-scroll" id="search-results">${searchResults()}</div>`;if(!node.open)node.showModal();$('#global-search').focus();attachScroll();}

  const views={home,students,admissions,classes,learning,finance,staff,parents,shuttle,approvals,resources,calendar,settings,inbox:ax.inbox,requests:ax.requests,automation:ax.automation,...(flowUI?{flow:()=>flowUI.fullView()}:{})};
  function render(){
    const focused=document.activeElement,focusId=focused?.id,selection=typeof focused?.selectionStart==='number'?focused.selectionStart:null;
    const navHref=focused?.closest('#sidebar')&&focused.getAttribute('href');
    const scrollPositions=new Map([...document.querySelectorAll('[data-scroll-key]')].map(n=>[n.dataset.scrollKey,[n.scrollTop,n.scrollLeft]]));
    hideTip();scrollObserver.disconnect();shell();ax.decorateShell();$('#main').innerHTML=state.page==='home'?ax.home():(viewFor(state.page)||home)();ax.decorateView();
    document.querySelectorAll('[data-scroll-key]').forEach(n=>{const kept=scrollPositions.get(n.dataset.scrollKey);if(kept)[n.scrollTop,n.scrollLeft]=kept;});attachScroll();
    if(focusId){const next=document.getElementById(focusId);next?.focus({preventScroll:true});if(selection!==null&&next?.setSelectionRange)next.setSelectionRange(selection,selection);}
    if(navHref)document.querySelector(`#sidebar a[href="${CSS.escape(navHref)}"]`)?.focus({preventScroll:true});
    syncMenu();
  }
  // Off-canvas menu on phones: hidden links leave the tab order, focus moves in on open and back on Escape.
  function syncMenu(){const open=document.body.classList.contains('menu-open');$('#sidebar').inert=mobileNav.matches&&!open;$('[data-action="menu"]')?.setAttribute('aria-expanded',String(open));}
  function closeMenu(returnFocus){const wasOpen=document.body.classList.contains('menu-open');document.body.classList.remove('menu-open');syncMenu();if(wasOpen&&returnFocus)$('[data-action="menu"]')?.focus();}
  mobileNav.addEventListener('change',syncMenu);
  function navigate(page){if(!viewFor(page))return;document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);if(location.hash===`#${page}`){state.page=page;render();}else location.hash=page;}
  function showNotes(){dialog('modal','검토 메모와 안내 초안',`${state.localNotes.length}건 · 현재 시안에만 저장됩니다.`,recordLines(state.localNotes.map(n=>({date:shortDate(n.date),title:n.title,text:n.body})),'아직 작성한 검토 메모가 없습니다.'));}
  function exportMetrics(){
    const rows=[['청구월','청구 대상 학생','청구액','복사 시점 누적 수납액','남은 수납액','접수 상담'],...db.trend.map(t=>[t.month,t.payingStudents,t.billed,t.paid,t.remaining,t.inquiries])];
    const cell=value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`침산_월별지표_${db.meta.asOf}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('월별 지표를 CSV로 저장했습니다.');
  }
  const actions={
    menu:()=>{document.body.classList.add('menu-open');syncMenu();($('#sidebar .nav-item.active')||$('#sidebar a'))?.focus();},
    'close-menu':()=>closeMenu(true),
    search:showSearch,report:showReport,export:exportMetrics,notes:showNotes,
    'new-task':()=>previewForm('task','검토 업무 추가'),
    'student-task':()=>previewForm('task','학생의 후속 업무',`student:${state.studentId}`,`${byId('students',state.studentId)?.name||'학생'} 후속 확인`),
    'student-note':()=>previewForm('note','학생 검토 메모',`student:${state.studentId}`),
    'new-lead':()=>previewForm('lead','새 입학 상담'),
    'lead-note':()=>previewForm('note','상담 후속 메모',`lead:${state.leadId}`),
    'bill-note':()=>previewForm('note','수납 확인 메모',`bill:${state.billId}`),
    'message-draft':()=>previewForm('message','학부모 안내 초안','general'),
    'reply-draft':()=>previewForm('message','학부모 답글 초안',`message:${state.messageId}`,`${byId('messages',state.messageId)?.name||'학생'} 보호자 답글`),
    'event-note':()=>previewForm('note','일정 검토 메모',`event:${state.eventId}`),
    'calendar-note':()=>previewForm('calendar','일정 메모','calendar'),
    'report-note':()=>previewForm('note','월간 경영 검토',`report:${state.month}`),
    today:()=>{state.calendarMonth=db.meta.month;state.selectedDate=db.meta.asOf;render();},
    'advance-lead':()=>{const a=byId('admissions',state.leadId);if(!a||a.outcome==='enrolled')return;const next=a.outcome==='scheduled'?'consulted':a.outcome==='consulted'||a.outcome==='ai_done'?'enrolled':'scheduled';a.outcome=next;a.local=true;if(next==='enrolled'){const t=db.trend.find(t=>a.date.startsWith(t.month));if(t)t.registered++;}render();showLead(a.id);toast('시안의 상담 단계를 변경했습니다.');},
    approve:()=>{const a=byId('approvals',state.approvalId);if(!a)return;a.status='approved';a.local=true;a.steps.forEach(s=>{if(!['approve','approved'].includes(s.decision)){s.decision='approve';s.date=db.meta.asOf;}});render();showApproval(a.id);toast('시안에서 승인 흐름을 반영했습니다.');},
    reject:()=>previewForm('reject','반려 의견',`approval:${state.approvalId}`),
    'task-followup':()=>{const t=byId('tasks',state.taskId);if(!t)return;const [family]=TASK_SOURCE[t.kind]||[];$('#detail').close();ax.showRequest({title:`${t.title} 후속 확인`,body:`${taskKind(t.kind)} 할 일이 아직 열려 있습니다(${t.detail||t.title}). 원본 기록을 처리했는지 확인하고, 처리하지 못한 이유와 예정일을 보고해 주세요.`,source:'task',draftKey:`task:${t.id}`,context:family?{family,familyLabel:ws?.area(family)?.label||taskKind(t.kind),records:[{id:t.id,label:t.title}],task:t.id}:{task:t.id,records:[{id:t.id,label:t.title}]}});},
    'complete-task':()=>{const t=byId('tasks',state.taskId);if(!t||!(t.kind==='owner_review'&&t.local))return;t.status=t.status==='done'?'open':'done';t.local=true;render();showTask(t.id);toast('시안의 업무 상태를 변경했습니다.');},
    'save-name':()=>{const name=$('#academy-name')?.value.trim();if(!name){toast('학원 표시 이름을 입력해 주세요.');return;}db.meta.tenant=name.slice(0,40);render();toast('시안의 표시 이름을 변경했습니다.');},
  };
  document.addEventListener('click',async event=>{
    if(event.target.matches('dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();return;}
    const el=event.target.closest('button,a,[data-action]');if(!el||el.disabled)return;
    const d=el.dataset;
    if(d.close){$(`#${d.close}`)?.close();return;}
    if(d.go){navigate(d.go);return;}
    if(d.action){if(d.action!=='menu'&&el.closest('#sidebar'))closeMenu(false);actions[d.action]?.();return;}
    if(d.student){showStudent(d.student);return;}
    if(d.class){showClass(d.class);return;}
    if(d.lead){showLead(d.lead);return;}
    if(d.bill){showBill(d.bill);return;}
    if(d.staff){showStaff(d.staff);return;}
    if(d.message){showMessage(d.message);return;}
    if(d.approval){showApproval(d.approval);return;}
    if(d.task){showTask(d.task);return;}
    if(d.book){showBook(d.book);return;}
    if(d.document){showDocument(d.document);return;}
    if(d.event){showEvent(d.event);return;}
    for(const [key,show] of [['searchStudent',showStudent],['searchClass',showClass],['searchStaff',showStaff]])if(d[key]){$('#modal').close();show(d[key]);return;}
    if(d.documentDownload){
      try{const url=`/files/document/${encodeURIComponent(d.documentDownload)}`,response=await fetch(url,{method:'HEAD'});if(!response.ok){toast('이 문서의 첨부파일이 아직 로컬에 준비되지 않았습니다.');return;}const a=document.createElement('a');a.href=url;a.download='';a.click();}catch{toast('첨부파일을 불러오지 못했습니다. 다시 시도해 주세요.');}return;
    }
    if(d.month){state.month=d.month;render();return;}
    if(d.filter!==undefined&&d.key){state[d.key]=d.filter;state.studentPage=0;state.classPage=0;state.taskPage=0;if(['vehicle','season'].includes(d.key))state.run=null;render();return;}
    if(d.pageKey){state[d.pageKey]=Math.max(0,Number(d.page));render();return;}
    if(d.approvalStatus){state.approvalStatus=state.approvalStatus===d.approvalStatus?null:d.approvalStatus;render();return;}
    if(d.bookStatus){state.bookStatus=state.bookStatus===d.bookStatus?null:d.bookStatus;render();return;}
    if(d.day){state.selectedDate=d.day;render();return;}
    if(d.calendarMove){const dt=new Date(`${state.calendarMonth}-01T12:00:00`);dt.setMonth(dt.getMonth()+Number(d.calendarMove));const next=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;if(next<db.trend[0].month||next>`${Number(db.meta.month.slice(0,4))+1}-12`){toast('시안에서 제공하는 일정 조회 범위를 벗어났습니다.');return;}state.calendarMonth=next;state.selectedDate=next+'-01';render();}
  });
  function onTextInput(event){
    if(event.isComposing)return;
    const el=event.target;
    if(el.id==='global-search'){state.search=el.value;$('#search-results').innerHTML=searchResults();fade($('#search-results'));}
    if(el.id==='student-search'&&state.studentQuery!==el.value){state.studentQuery=el.value;state.studentPage=0;render();}
    if(el.id==='document-search'&&state.documentQuery!==el.value){state.documentQuery=el.value;render();}
  }
  document.addEventListener('input',onTextInput);document.addEventListener('compositionend',onTextInput);
  document.addEventListener('change',event=>{const el=event.target;if(el.dataset.period){state[el.dataset.period]=el.value;state.financePage=0;render();}if(el.id==='shuttle-date'){state.selectedDate=el.value||db.meta.asOf;render();}});
  document.addEventListener('submit',event=>{
    if(event.target.id!=='preview-form')return;event.preventDefault();const form=event.target;if(!form.reportValidity())return;
    const values=new FormData(form),kind=form.dataset.kind,id=`local-${crypto.randomUUID()}`,context=state.noteContext;
    const title=String(values.get('title')||'').trim(),body=String(values.get('body')||'').trim();
    if(kind==='task'){
      db.tasks.unshift({id,title,detail:body,status:'open',kind:'owner_review',opened:db.meta.asOf,due:String(values.get('due')||''),owners:[String(values.get('owner')||'원장')],local:true});
      $('#modal').close();render();showTask(id);toast('시안에 검토 업무를 추가했습니다.');return;
    }
    if(kind==='lead'){
      const name=String(values.get('name')||'').trim();db.admissions.unshift({id,name,grade:String(values.get('grade')||''),school:String(values.get('school')||''),outcome:'scheduled',date:db.meta.asOf,note:body,teacher:'원장',channel:'시안 직접 입력',local:true});current().inquiries++;state.month=db.meta.month;state.admissionFilter='all';$('#modal').close();render();showLead(id);toast('시안에 새 상담을 추가했습니다.');return;
    }
    state.localNotes.push({id,title,body,context,date:db.meta.asOf,kind});$('#modal').close();
    if(kind==='calendar'){const date=String(values.get('date'));db.calendar.push({id,title,date,end:date,start:'',finish:'',local:true});state.calendarMonth=date.slice(0,7);state.selectedDate=date;render();showEvent(id);toast('시안에 일정 메모를 추가했습니다.');return;}
    if(kind==='reject'){const a=byId('approvals',state.approvalId);a.status='rejected';a.note=body;a.local=true;render();showApproval(a.id);toast('시안에 반려 의견을 반영했습니다.');return;}
    render();
    if(context.startsWith('student:'))showStudent(context.slice(8));else if(context.startsWith('lead:'))showLead(context.slice(5));else if(context.startsWith('message:'))showMessage(context.slice(8));else if(context.startsWith('bill:'))showBill(context.slice(5));else if(context.startsWith('event:'))showEvent(context.slice(6));else showNotes();
    toast('시안에 초안을 저장했습니다.');
  });
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();showSearch();}if(event.key==='Escape')actions['close-menu']();});
  window.addEventListener('hashchange',()=>{state.page=location.hash.slice(1)||'home';if(!viewFor(state.page))state.page='home';document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);render();window.scrollTo(0,0);});
  state.page=location.hash.slice(1)||'home';if(!viewFor(state.page))state.page='home';render();document.fonts.ready.then(()=>document.querySelectorAll('.nav-scroll,.live-scroll').forEach(fade));
})();
