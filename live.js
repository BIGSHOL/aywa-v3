/* 원장실 시안: Docker 검증 복사본을 읽고, 저장은 연결된 2.0 화면·업무 흐름 경로에서만 처리한다. */
(() => {
  'use strict';
  // 엿보기 모드(?peek=1) = 업무 흐름의 엿보기 창 안에서 띄운 이 앱(flow-ui.js) — 메뉴·머리 없이 본문만, 모르는 주소는 빈 화면.
  const PEEK=new URLSearchParams(location.search).has('peek');if(PEEK)document.documentElement.classList.add('peek');
  const db=window.AcademySnapshot;
  let fullReady=!db.meta.detailDeferred,fullPromise=null;
  function ensureFull(){
    if(fullReady)return Promise.resolve();
    fullPromise??=fetch('/snapshot.json',{cache:'no-store',headers:{Accept:'application/json'}}).then(async response=>{
      if(!response.ok)throw new Error('상세 자료를 불러오지 못했습니다.');
      const data=await response.json();if(!data?.meta||!Array.isArray(data.students))throw new Error('상세 자료 형식이 올바르지 않습니다.');
      refill(db,data);fullReady=true;
    }).catch(error=>{fullPromise=null;throw error;});
    return fullPromise;
  }
  const $=q=>document.querySelector(q);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const won=n=>`${fmt(Math.round(n||0))}원`;
  // 연월은 어디서든 yy.mm(원장 10-28 "항상 yy.mm 으로 연도 월 표시하고") — 한 함수로만 만든다.
  const yymm=m=>{const s=String(m??'');return /^\d{4}-\d{2}/.test(s)?`${s.slice(2,4)}.${s.slice(5,7)}`:s;};
  const mlabel=yymm;
  const shortDate=d=>d?String(d).slice(5).replace('-','.'):'미입력';
  const subject=s=>({math:'수학',english:'영어',general:'공통'}[s]||s||'공통');
  const status=s=>({enrolled:'재원',on_hold:'휴원',withdrawn:'퇴원',prospect:'예비',present:'출석',late:'지각',absent:'결석',early_leave:'조퇴',makeup:'보강',paid:'납부완료',partial:'부분납부',unpaid:'미납',scheduled:'상담 예약',consulted:'상담 완료',ai_done:'상담 검토',declined:'미등록',no_show:'미방문',pending:'결재 대기',approved:'승인 완료',rejected:'반려',open:'진행 중',done:'완료',cancelled:'취소',expired:'종료',issued:'발급 완료',draft:'작성 중',requested:'요청',ordered:'주문',delivered:'전달',active:'사용 중',in_use:'사용 중',on_loan:'대여 중',available:'보관',repair:'수리 중',lost:'분실',disposed:'폐기',retired:'폐기',boarded:'탑승',reserved:'예약'}[s]||s||'미입력');
  // 기한 지난 처리 전 = '지난 업무'(원장 10-29 확정 말) · 2.0 expired(기한이 지나 저절로 닫힘) = '만료됨' — 같은 이름 칩이 둘 생기지 않게.
  // 공용 status()는 보강 등 다른 기록도 쓰므로 업무 라벨을 따로 둔다.
  const TASK_STATE={open:'처리 전',done:'처리됨',cancelled:'취소됨',expired:'만료됨'};
  const taskStatus=t=>t.status==='open'&&t.due&&t.due<db.meta.asOf?'지난 업무':TASK_STATE[t.status]||status(t.status);
  const byId=(collection,id)=>db[collection].find(x=>x.id===id);
  const paths={home:'M3 10 12 3 21 10v11H3z M9 21v-8h6v8',people:'M3 21v-3a6 6 0 0 1 12 0v3 M17 4a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 3 5 M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0',chart:'M4 3v18h17 M8 16v-5 M13 16V7 M18 16V4',calendar:'M3 6h18v15H3z M7 3v5 M17 3v5 M3 11h18',book:'M12 5C9 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-7-2-10 1v15',wallet:'M20 7V4H5a2 2 0 0 0 0 4h16v12H5a2 2 0 0 1-2-2V6 M21 12h-6v4h6',staff:'M3 6h18v15H3z M8 6V3h8v3 M3 12h18 M10 12v3h4v-3',message:'M21 11a8 8 0 0 1-8 8H6l-4 3V7a4 4 0 0 1 4-4h7a8 8 0 0 1 8 8 M7 8h9 M7 13h6',bus:'M4 4h16v15H4z M4 11h16 M8 4v7 M16 4v7 M7 19v2 M17 19v2 M7 15h1 M16 15h1',check:'M5 12 9 16 19 6',box:'M3 7 12 3 21 7v12l-9 3-9-3z M3 7l9 4 9-4 M12 11v11',settings:'M4 7h16 M4 17h16 M8 4v6 M14 14v6',search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6',arrow:'M5 12h14 M13 6l6 6-6 6',chevron:'M9 5l7 7-7 7',down:'M6 9l6 6 6-6',plus:'M12 5v14 M5 12h14',close:'M6 6l12 12 M6 18 18 6',menu:'M4 6h16 M4 12h16 M4 18h16',trend:'M3 17l6-6 4 3 8-10 M14 4h7v7',building:'M5 21V3h14v18 M3 21h18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M10 21v-6h4v6'};
  const icon=k=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[k]||paths.book}"/></svg>`;
  const button=(label,action,cls='')=>`<button class="button ${cls}" data-action="${action}">${label}</button>`;
  const empty=(title,note='조건을 바꾸거나 다른 기간을 확인해 주세요.')=>`<div class="live-empty"><strong>${h(title)}</strong>${note?`<p>${h(note)}</p>`:''}</div>`;
  const panel=(title,note,content,extra='')=>`<section class="live-panel"><header><div><h2>${title}</h2>${note?`<p>${note}</p>`:''}</div>${extra}</header>${content}</section>`;
  // Every trend/comparison chart shows one point's exact value in the app's own popover (hover, touch, arrow keys).
  // Points carry data-tip = {title, rows:[{label,value,tone}], meta:[...]}; the popover below renders it. No native title tooltips.
  const exact=(v,unit)=>v==null?'기록 없음':unit==='만원'||unit==='원'?won(v):`${fmt(v)}${unit}`;
  const isMonth=d=>/^\d{4}-\d{2}$/.test(String(d||''));
  const periodTitle=x=>{const d=String(x.month||x.date||'');if(isMonth(d))return yymm(d);if(/^\d{4}-\d{2}-\d{2}$/.test(d))return `${d.slice(0,4)}년 ${Number(d.slice(5,7))}월 ${Number(d.slice(8,10))}일`;return String(x.label||d);};
  // 덧붙임 줄(meta) = 글자 또는 {text, tone} — tone은 좋아짐 good(빨강)·나빠짐 bad(파랑)(원장 10-28 "마우스 오버할때 나오는것도 파란색 빨간색 적용").
  const tipData=(title,rows,meta=[])=>h(JSON.stringify({title,rows,meta:meta.filter(m=>m&&(typeof m==='string'||m.text))}));
  const metaText=m=>typeof m==='string'?m:String(m?.text||'');
  const deltaText=(v,prev,unit,monthly)=>v==null||prev==null?'':`${monthly?'전월':'이전'} 대비 ${v>prev?'+':v<prev?'−':'±'}${exact(Math.abs(v-prev),unit)}`;
  function chart(items,key,unit='',options={}){
    if(!items.some(x=>x[key]!==null&&x[key]!==undefined))return empty('이 기간의 기록이 없습니다.','없는 기간을 추정값으로 채우지 않았습니다.');
    const W=620,H=options.compact?150:216,L=42,R=20,T=25,B=options.compact?26:32,inner=W-L-R,secondary=options.secondary; // compact = 합친 화면의 낮은 현황 띠(줄여도 글자가 읽히는 비율)
    const values=items.flatMap(x=>[x[key],...(secondary?[x[secondary]]:[])]).filter(x=>x!==null&&x!==undefined).map(Number);
    // 세로축 눈금은 딱 떨어지는 간격(1·2·2.5·5×10ⁿ, 표시 단위 기준 — 원장 10-28 "803, 1605, 2408 … 기준을 알 수 없으니 딱 떨어지는 숫자로").
    const scale=unit==='만원'?10000:1,top=Math.max(...values,1)/scale,raw=top/4,mag=10**Math.floor(Math.log10(raw)),n=raw/mag,tick=Math.max((n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag,1)*scale,ticks=Math.ceil(Math.max(...values,1)/tick);
    const max=tick*ticks*(Math.max(...values,1)>tick*ticks*.9?1.08:1),step=inner/Math.max(items.length,1),y=v=>T+(H-T-B)*(1-v/max);
    const label=v=>unit==='만원'?fmt(v/10000):fmt(Math.round(v));
    const name=x=>x.label||(x.month?mlabel(x.month):shortDate(x.date));
    const monthly=items.every(x=>isMonth(x.month));
    const grid=Array.from({length:ticks+1},(_,i)=>{const val=tick*i;return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${y(val)}" y2="${y(val)}"/><text x="${L-9}" y="${y(val)+4}" text-anchor="end">${label(val)}</text>`;}).join('')
      // 구간마다 흐린 점선 세로선(원장 10-28 "구간마다 점선 세로선을 그어서 쉽게 위치 파악") — 막대 뒤에.
      +items.map((_,i)=>`<line class="col-line" x1="${L+step*(i+.5)}" x2="${L+step*(i+.5)}" y1="${T}" y2="${H-B}"/>`).join('')
      // 세로축 단위(R4C-15) — 눈금 숫자 위에 한 번(만원 단위 축은 '만원').
      +(unit?`<text class="axis-unit" x="${L-9}" y="${T-12}" text-anchor="end">${h(unit)}</text>`:'');
    // 진한 막대 = 고른 달(options.active: 달 하나 또는 목록) — 고른 달이 없으면 마지막(이번 달). 고른 달은 이름도 굵게.
    const picked=options.active?[].concat(options.active):null,on=(x,i)=>picked?picked.includes(x.month):i===items.length-1;
    const cols=items.map((x,i)=>{
      const cx=L+step*(i+.5),v=x[key],sv=secondary?x[secondary]:null,width=Math.min(36,step*.48),prev=i?items[i-1][key]:null;
      const rows=[{label:options.label||'',value:exact(v,unit),tone:'primary'},...(secondary?[{label:options.secondaryLabel||'',value:exact(sv,unit),tone:'secondary'}]:[])];
      const tip=tipData(x.month||x.date?periodTitle(x):name(x),rows,[deltaText(v,prev,unit,monthly),options.basis||'']);
      return `<g class="chart-col" data-point data-tip="${tip}"><rect class="chart-hit" x="${L+step*i}" y="${T-10}" width="${step}" height="${H-B-T+10}"/>${v==null?`<text data-anchor x="${cx}" y="${H-B-5}" text-anchor="middle">—</text>`:`<rect class="chart-bar" data-anchor x="${cx-width/2-(secondary?width*.32:0)}" y="${y(v)}" width="${secondary?width*.65:width}" height="${H-B-y(v)}" rx="4" fill="${on(x,i)?'#6078c8':'#a8b6df'}"/>${!secondary&&(items.length<=7||options.ends&&(i===0||i===items.length-1))?`<text class="point-value" x="${cx}" y="${y(v)-9}" text-anchor="middle">${label(v)}</text>`:''}`}${secondary&&sv!=null?`<rect class="chart-bar" x="${cx+width*.04}" y="${y(sv)}" width="${width*.65}" height="${H-B-y(sv)}" rx="4" fill="#a7cbbb"/>`:''}<text x="${cx}" y="${H-8}" text-anchor="middle"${picked&&on(x,i)?' font-weight="700"':''}>${h(name(x))}</text></g>`;
    }).join('');
    return `<div class="chart-box" data-chart tabindex="0" role="group" aria-label="${h(options.label||key)} — 화살표 키로 기간을 옮기며 수치를 확인합니다"><svg class="live-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(options.label||key)} 추이 · ${items.map(x=>`${x.label||x.month||x.date} ${x[key]==null?'기록 없음':label(x[key])+unit}`).join(', ')}">${grid}${cols}</svg></div>${secondary?`<div class="live-legend"><span><i></i>${options.label}</span><span><i class="alt"></i>${options.secondaryLabel}</span></div>`:''}`;
  }
  // Stretchable trend line: HTML hit zones over an SVG line so markers stay round when the chart grows.
  // Missing periods break the line (no interpolation). Range ≥10% of the mean so small changes never read as cliffs.
  // compare = KPI 카드와 같은 비교 문구('7일 전'·'전월') — 주면 팝오버도 카드처럼 '○○ 대비 ▲ 0.0%p'로 쓴다(원장 10-28 "카드 구조를 전부 통일할것").
  // axis = 그래프 자체에 기간·값을 적는다(가로 시작·중간·끝 · 첫·끝 값 · 세로 눈금 셋) — 마우스를 올리지 않아도 언제·얼마인지 보이게(원장 10-30). 팝오버는 그대로.
  function lineChart(rows,{key='value',label='',unit='',value,basis='',compare='',better='',axis=false}={}){
    const values=rows.map(r=>r[key]==null?null:Number(r[key])),known=values.filter(v=>v!==null);
    if(!known.length)return '';
    const lo=Math.min(...known),hi=Math.max(...known),mean=known.reduce((n,v)=>n+v,0)/known.length,span=Math.max(hi-lo,Math.abs(mean)*.1,1),min=(lo+hi)/2-span/2;
    const n=rows.length,x=i=>2+i*(96/Math.max(n-1,1)),yv=v=>36-(v-min)/span*32,text=v=>v==null?'기록 없음':value?value(v):exact(v,unit);
    const runs=[];values.forEach((v,i)=>{if(v===null)return;if(i&&values[i-1]!==null)runs.at(-1).push(i);else runs.push([i]);});
    const solo=new Set(runs.filter(r=>r.length===1).map(r=>r[0]));
    const zone=96/Math.max(n-1,1),edges=i=>{const left=i?Math.max(0,x(i)-zone/2):0,right=i===n-1?100:Math.min(100,x(i)+zone/2);return {left,width:right-left,at:(x(i)-left)/(right-left)*100};};
    const monthly=rows.every(r=>isMonth(r.month));
    const tone=(v,prev)=>v===null||prev===null||v===prev?'':better==='up'?(v>prev?'good':'bad'):better==='down'?(v<prev?'good':'bad'):'';
    const point=(r,i)=>{const e=edges(i),v=values[i],prev=i?values[i-1]:null,delta=v===null||prev===null?'':compare?(v===prev?`${compare} 대비 변화 없음`:`${compare} 대비 ${v>prev?'▲':'▼'} ${unit==='%'?`${Math.abs(v-prev).toFixed(1)}%p`:text(Math.abs(v-prev))}`):`${monthly?`전월(${mlabel(rows[i-1].month)})`:'이전'} 대비 ${v>prev?'+':v<prev?'−':'±'}${text(Math.abs(v-prev))}`;
      return `<span class="chart-pt${solo.has(i)?' solo':''}" data-point data-tip="${tipData(periodTitle(r),[{label,value:text(v),tone:'primary'}],[delta&&tone(v,prev)?{text:delta,tone:tone(v,prev)}:delta,basis])}" style="left:${e.left}%;width:${e.width}%;--x:${e.at}%;--y:${v===null?100:yv(v)/40*100}%"><i data-anchor></i></span>`;};
    const line=`<span class="chart-line" data-chart tabindex="0" role="group" aria-label="${h(label)} — 화살표 키로 기간을 옮기며 수치를 확인합니다"><svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${h(label)} ${rows.map((r,i)=>`${periodTitle(r)} ${text(values[i])}`).join(', ')}"><line x1="0" x2="100" y1="39" y2="39" vector-effect="non-scaling-stroke"/>${rows.map((_,i)=>`<line class="col-line" x1="${x(i)}" x2="${x(i)}" y1="2" y2="39" vector-effect="non-scaling-stroke"/>`).join('')}${runs.filter(r=>r.length>1).map(r=>`<polyline points="${r.map(i=>`${x(i)},${yv(values[i])}`).join(' ')}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>${rows.map(point).join('')}</span>`;
    if(!axis)return line;
    // 눈금 = 그려진 범위의 아래·가운데·위(정수 단위는 반올림 · 같은 값은 한 번) · 가로 = 첫·가운데·끝 기간 · 값 = 첫·끝 점.
    const pct=v=>yv(v)/40*100,whole=unit!=='%',tickOf=v=>whole?Math.round(v):Math.round(v*10)/10;
    const ticks=[...new Set([min,min+span/2,min+span].map(tickOf))].filter(t=>pct(t)>=-2&&pct(t)<=102);
    const short=r=>isMonth(r.month)?mlabel(r.month):/^\d{4}-\d{2}-\d{2}/.test(String(r.date||''))?`${Number(r.date.slice(5,7))}/${Number(r.date.slice(8,10))}`:String(r.label||'');
    const at=[...new Set([0,Math.floor((n-1)/2),n-1])],side=i=>i===0&&n>1?'start':i===n-1&&n>1?'end':'mid';
    const ends=[...new Set([values.findIndex(v=>v!==null),values.findLastIndex(v=>v!==null)])].filter(i=>i>=0);
    return `<div class="chart-axis"><div class="chart-axis-y" aria-hidden="true">${ticks.map(t=>`<span style="top:${pct(t)}%">${h(text(t))}</span>`).join('')}</div><div class="chart-axis-plot">${ticks.map(t=>`<i class="chart-axis-grid" style="top:${pct(t)}%"></i>`).join('')}${line}${ends.map(i=>`<b class="chart-axis-val" data-side="${side(i)}" style="left:${x(i)}%;top:${pct(values[i])}%">${h(text(values[i]))}</b>`).join('')}</div><div class="chart-axis-x" aria-hidden="true">${at.map(i=>`<span data-side="${side(i)}" style="left:${x(i)}%">${h(short(rows[i]))}</span>`).join('')}</div></div>`;
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
    // Opt-in third column (확장 추세 — 원장 10-28 "항목별 변화 추이"): rows carrying `delta: { text, tone }` get [label | value | change]; other charts are unchanged.
    const deltas=d.rows.some(r=>r&&typeof r==='object'&&'delta' in r);tip.classList.toggle('has-delta',deltas);
    d.rows.forEach(r=>{const row=el('chart-pop-row',''),name=el(`chart-pop-label ${r.tone==='secondary'?'secondary':''}`,String(r.label||''),'span');if(/^#[0-9a-f]{3,8}$/i.test(String(r.color||'')))name.style.setProperty('--dot',r.color);row.append(name,el('chart-pop-value',String(r.value||''),'strong'));
      if(deltas){const dl=r.delta||{};row.append(el(`chart-pop-delta${['good','bad'].includes(dl.tone)?` ${dl.tone}`:''}`,String(dl.text||''),'span'));}tip.append(row);});
    d.meta.forEach(m=>tip.append(el(`chart-pop-meta${typeof m==='object'&&['good','bad'].includes(m.tone)?` ${m.tone}`:''}`,metaText(m))));
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
    if(announce)chartLive.textContent=[d.title,...d.rows.map(r=>`${r.label} ${r.value}`),...d.meta.map(metaText)].filter(Boolean).join(', ');
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
  // 옛 메뉴 이름 → 지금 메뉴. 옛 화면은 지웠고 ax.js의 링크가 아직 이 값을 쓴다(navigate가 받아 넘긴다). 주소로 치면 첫 화면으로 간다.
  const MOVED={students:'v2-students',admissions:'v2-enrollment',classes:'v2-classes',learning:'v2-lesson-reports',finance:'v2-billing',staff:'v2-staff',parents:'v2-lesson-reports?tab=classnote&section=parent_replies',shuttle:'workspace-shuttle',approvals:'v2-approvals',resources:'v2-textbook-requests',calendar:'workspace-calendar',settings:'v2-owner'};
  const state={page:'home',taskId:'',search:''};
  let toastTimer;
  const toast=text=>{const node=$('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3000);};
  // Factories: ax (briefing/requests/assistant) first, then workspaces (catalog-driven family screens) which uses ax.
  // 과목 색 = 앱 전체 한 곳(원장 10-28 "미수강 = 회색. 영어+수학 = 보라색. 수학 = 파란색. 영어 = 빨간색. 전체 웹에 대해 통일" · "EiE 주황색").
  // 열쇠 이름의 뜻으로 고른다(지표마다 열쇠가 다르다 — math · mathOnly · english.math · both · eie · injaewon · unknown …). 모르면 null.
  const SUBJECT_TONE={math:'#1d4ed8',english:'#c62828',eie:'#ea580c',mixed:'#7c3aed',none:'#9ca3af'};
  const subjectColor=key=>{const k=String(key??'').toLowerCase();if(!k)return null;if(/^(unknown|none|other|otheronly|nothing)$/.test(k))return SUBJECT_TONE.none;const math=k.includes('math'),eie=k.includes('eie'),eng=/english|injaewon/.test(k);if(k==='both'||(math&&(eie||eng)))return SUBJECT_TONE.mixed;if(eie)return SUBJECT_TONE.eie;if(eng)return SUBJECT_TONE.english;if(math)return SUBJECT_TONE.math;return null;};
  const api={db,h,fmt,yymm,won,icon,chart,lineChart,exact,dialog,navigate,render,attachScroll,scrollToSection,toast,ensureFull,statusLabel:status,subjectLabel:subject,subjectColor,showStudent,showAbsences,showBill,showApproval,showTask,openRecord,canOpenRecord,getPage:()=>state.page,hasView:id=>Boolean(viewFor(MOVED[id]||id)),closeMenu};
  const ax=window.createOwnerWorkspace(api);
  const ws=typeof window.createWorkspaces==='function'?window.createWorkspaces({...api,ax}):null;
  api.showWorkspaceRecord=(family,id)=>ws?ws.showRecord(family,id):toast('이 기록은 여기서 바로 열 수 없습니다.');
  ax.useWorkspaces?.(ws);
  window.V2Screens?.bind(api); // 2.0 화면 (v2-screens.js): 2.0 형태의 새 3.0 페이지 — #v2-<id>
  // '왜 줄었나' (exit-insight.js, INSIGHT-EXITS.md): entry buttons on the billing/student cards; fetched only when pressed; records open by exact id.
  const insight=typeof window.createExitInsight==='function'?window.createExitInsight({...api,showWorkspaceRecord:(family,id)=>ws?ws.showRecord(family,id):toast('이 기록은 여기서 바로 열 수 없습니다.')}):null;
  api.insightEntry=(from,to,label)=>insight?.entry(from,to,label)||'';
  // Durable work flow (GET /api/flow): preview selector, role views, request store. Absent → session-only requests.
  const flowUI=typeof window.createFlowUI==='function'?window.createFlowUI({...api,ax,familyLabel:id=>ws?.area(id)?.label||'',showWorkspaceRecord:(family,record)=>ws?.showRecord(family,record),openWorkspace:(family,facet)=>ws?.openFamily(family,facet),attachField:(scope,family)=>ws?.attachField(scope,family)||''}):null;
  ax.useFlow?.(flowUI);
  api.showCardRequest=args=>{if(!flowUI?.ready()){toast('업무 흐름을 불러오지 못했습니다. 다시 시도해 주세요.');return;}ax.showRequest(args);};
  api.cardRequestFor=(metric,factIds)=>flowUI?.cardRequestFor?.(metric,factIds);
  api.openFlowCase=id=>flowUI?.showCase?.(id);
  api.openCardFlow=args=>flowUI?.openCardFlow?.(args);
  const viewFor=page=>{if(!page)return null;if(views[page])return views[page];const v2=window.V2Screens?.view(page);if(v2)return v2;const id=ws?.familyOf(page);return id&&ws.has(id)?()=>ws.view(id):null;};
  const mobileNav=matchMedia('(max-width: 760px)');
  const sidebarStorageKey=`aywa:owner-concept:sidebar:${db.meta.tenant}`;
  let sidebarCollapsed=false;
  try{sidebarCollapsed=localStorage.getItem(sidebarStorageKey)==='collapsed';}catch{}
  const sidebarTip=document.createElement('div');sidebarTip.id='sidebar-nav-tip';sidebarTip.className='sidebar-nav-tip';sidebarTip.setAttribute('role','tooltip');sidebarTip.hidden=true;document.body.append(sidebarTip);
  let sidebarTipOwner=null;
  function hideSidebarTip(){sidebarTip.hidden=true;sidebarTipOwner?.removeAttribute('aria-describedby');sidebarTipOwner=null;}
  function showSidebarTip(item){
    if(!document.body.classList.contains('sidebar-collapsed')||!item?.dataset.navLabel)return;
    hideSidebarTip();sidebarTipOwner=item;sidebarTip.textContent=item.dataset.navLabel;
    const box=item.getBoundingClientRect();sidebarTip.style.left=`${Math.min(box.right+9,innerWidth-180)}px`;sidebarTip.style.top=`${Math.max(8,Math.min(box.top+box.height/2,innerHeight-20))}px`;
    sidebarTip.hidden=false;item.setAttribute('aria-describedby',sidebarTip.id);
  }
  function syncSidebarRail(){
    const sidebar=$('#sidebar');if(!sidebar)return;
    const collapsed=sidebarCollapsed&&!mobileNav.matches;
    document.body.classList.toggle('sidebar-collapsed',collapsed);
    const brand=sidebar.querySelector('.brand'),search=sidebar.querySelector('.ax-search-trigger');
    if(brand)brand.inert=collapsed;if(search)search.inert=collapsed;
    let toggle=sidebar.querySelector('[data-action="sidebar-toggle"]');
    if(!toggle){brand?.insertAdjacentHTML('afterend','<button type="button" class="sidebar-toggle" data-action="sidebar-toggle" aria-controls="sidebar"></button>');toggle=sidebar.querySelector('[data-action="sidebar-toggle"]');}
    if(toggle){const label=collapsed?'사이드바 펼치기':'사이드바 접기';toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-expanded',String(!collapsed));toggle.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16 M${collapsed?'12 16l4-4-4-4':'17 8l-4 4 4 4'}"/></svg>`;}
    sidebar.querySelectorAll('.nav-item').forEach(item=>{
      const label=item.querySelector(':scope > span:not(.nav-count)')?.textContent?.trim()||item.textContent?.trim()||'';
      const count=item.querySelector(':scope > .nav-count'),countText=count&&!count.hidden?count.textContent.trim():'';
      item.dataset.navLabel=label;item.setAttribute('aria-label',countText?`${label} · ${countText}${/^\d+$/.test(countText)?'건':''}`:label);
      if(count)count.dataset.compact=/^\d+$/.test(count.textContent.trim())?count.textContent.trim():'•';
    });
    sidebar.querySelectorAll('.ws-groups details').forEach(group=>{
      if(collapsed){if(group.dataset.openBeforeRail===undefined)group.dataset.openBeforeRail=String(group.open);group.open=true;}
      else if(group.dataset.openBeforeRail!==undefined){group.open=group.dataset.openBeforeRail==='true';delete group.dataset.openBeforeRail;}
    });
    if(!collapsed)hideSidebarTip();
  }
  document.addEventListener('pointerover',event=>{const item=event.target.closest?.('#sidebar .nav-item');if(item&&item!==sidebarTipOwner)showSidebarTip(item);});
  document.addEventListener('pointerout',event=>{if(sidebarTipOwner&&event.target.closest?.('#sidebar .nav-item')===sidebarTipOwner&&!sidebarTipOwner.contains(event.relatedTarget))hideSidebarTip();});
  document.addEventListener('focusin',event=>{const item=event.target.closest?.('#sidebar .nav-item');if(item)showSidebarTip(item);});
  document.addEventListener('focusout',event=>{if(sidebarTipOwner===event.target)hideSidebarTip();});
  addEventListener('scroll',hideSidebarTip,{capture:true,passive:true});
  addEventListener('resize',hideSidebarTip);
  const scrollObserver=new ResizeObserver(entries=>entries.forEach(e=>fade(e.target)));
  function fade(node){const top=Math.max(0,node.scrollTop),bottom=Math.max(0,node.scrollHeight-node.clientHeight-top),left=Math.max(0,node.scrollLeft),right=Math.max(0,node.scrollWidth-node.clientWidth-left);node.style.setProperty('--fade-top',`${Math.min(26,top)}px`);node.style.setProperty('--fade-bottom',`${Math.min(26,bottom>1?bottom:0)}px`);node.style.setProperty('--fade-left',`${Math.min(26,left)}px`);node.style.setProperty('--fade-right',`${Math.min(26,right>1?right:0)}px`);}
  function attachScroll(){document.querySelectorAll('.nav-scroll,.live-scroll').forEach(node=>{fade(node);node.addEventListener('scroll',()=>fade(node),{passive:true});scrollObserver.observe(node);});}
  /* Explicit in-page section jumps ('아래에서 보기', issue cues): a visible page scroll that brakes into the target
     (ease-out cubic, 550–1000ms by distance). Wheel/touch/key/pointer input, a route change or the next jump stops it;
     reduced motion, tiny hops and route arrivals position at once. A selector target is re-read every frame, so a
     re-render keeps the motion going and a vanished target ends it. Route changes, search-option nearest, chat
     autoscroll and restored offsets keep their immediate scrolling elsewhere. */
  const motion={frame:0,stop:null};
  /* Spotlight after an explicit jump ('아래에서 보기'): the destination stays as it is and the rest of the page fades a little
     (opacity + light blur, .spot-dim) so the eye lands on it. Any move by the reader — wheel, touch drag, navigation keys, a
     press outside the destination, the page scrolling away — a new jump or a re-render brings everything back. */
  const spot={off:null};
  function clearSpotlight(){
    spot.off?.();spot.off=null;
    document.querySelectorAll('.spot-on').forEach(n=>n.classList.remove('spot-on'));
    document.querySelectorAll('.spot-dim').forEach(n=>{n.classList.remove('spot-dim');n.classList.add('spot-back');});
    setTimeout(()=>document.querySelectorAll('.spot-back:not(.spot-dim)').forEach(n=>n.classList.remove('spot-back')),400);
  }
  function spotlight(targets){
    clearSpotlight();
    const keep=(Array.isArray(targets)?targets:[targets]).map(t=>typeof t==='string'?document.querySelector(t):t).filter(n=>n?.isConnected);
    if(!keep.length)return;
    const path=new Set();keep.forEach(n=>{for(let x=n;x&&x!==document.body;x=x.parentElement)path.add(x);});
    path.forEach(x=>{for(const sib of x.parentElement?.children||[])if(!path.has(sib)&&!sib.matches('script,style,dialog,#chart-tip,.chart-live,#toast,.skip-link,.sidebar-scrim'))sib.classList.add('spot-dim');});
    // The destination's border is highlighted with a pulse (.spot-on) until the fade ends; a reflow restarts it when the same node is spotlit again.
    void keep[0].offsetWidth;keep[0].classList.add('spot-on');
    const y=window.scrollY,end=()=>clearSpotlight();
    const outside=event=>{if(!keep.some(n=>n.contains(event.target)))end();};
    const keys=event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Tab','Escape'].includes(event.key))end();};
    const moved=()=>{if(Math.abs(window.scrollY-y)>24)end();};
    const on=[['wheel',end,true],['touchmove',end,true],['pointerdown',outside,true],['keydown',keys,true],['scroll',moved,false],['hashchange',end,false]];
    on.forEach(([type,fn,capture])=>addEventListener(type,fn,{capture,passive:true}));
    spot.off=()=>on.forEach(([type,fn,capture])=>removeEventListener(type,fn,{capture}));
  }
  function scrollToSection(target,{instant=false,spotlight:focusOn=null}={}){
    motion.stop?.();clearSpotlight();
    const land=()=>{if(focusOn)spotlight(typeof focusOn==='function'?focusOn():focusOn);};
    const root=document.scrollingElement||document.documentElement;
    const node=()=>{const n=typeof target==='string'?document.querySelector(target):target;return n?.isConnected?n:null;};
    const goal=n=>{const pad=parseFloat(getComputedStyle(root).scrollPaddingTop)||0,margin=parseFloat(getComputedStyle(n).scrollMarginTop)||0;return Math.max(0,Math.min(root.scrollHeight-root.clientHeight,n.getBoundingClientRect().top+window.scrollY-margin-pad));};
    const first=node();if(!first)return;
    const from=window.scrollY,distance=Math.abs(goal(first)-from);
    if(instant||distance<8||matchMedia('(prefers-reduced-motion: reduce)').matches){window.scrollTo({top:goal(first),behavior:'instant'});land();return;}
    const duration=Math.min(1000,Math.max(550,350+distance*.4)),start=performance.now(),intent=['wheel','touchstart','pointerdown','hashchange'];
    let last=from;
    const moved=()=>{if(Math.abs(window.scrollY-last)>2)stop();};
    const key=event=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))stop();};
    const stop=()=>{cancelAnimationFrame(motion.frame);intent.forEach(type=>removeEventListener(type,stop,true));removeEventListener('keydown',key,true);removeEventListener('scroll',moved);if(motion.stop===stop)motion.stop=null;};
    const step=now=>{const n=node();if(!n){stop();return;}const t=Math.min(1,(now-start)/duration),to=goal(n);window.scrollTo({top:from+(to-from)*(1-(1-t)**3),behavior:'instant'});last=window.scrollY;if(t<1)motion.frame=requestAnimationFrame(step);else{stop();land();}};
    intent.forEach(type=>addEventListener(type,stop,{capture:true,passive:true}));addEventListener('keydown',key,{capture:true,passive:true});addEventListener('scroll',moved,{passive:true});
    motion.stop=stop;motion.frame=requestAnimationFrame(step);
  }
  const shell=()=>{$('#footer').innerHTML=`<span>${h(db.meta.tenant)} · ${Number(db.meta.asOf.slice(5,7))}/${Number(db.meta.asOf.slice(8,10))} 기준</span>`;};
  // 2.0 staff_tasks kinds. They open and close from the underlying records (never by a button).
  const taskKind=k=>({report_send_failed:'보고서 발송 실패',followup_due:'상담 후속조치',enrollment_followup:'콜&상담 후속 조치',progress_anomaly:'진도 기록 이상',attendance_absent_desk:'결석 확인 전화',video_upload_check:'영상 업로드 확인',video_unassigned:'미배정 영상',unsent_report:'미발송 수업 보고서',approval_turn:'전자결재 차례',withdrawal_step:'퇴원보고서',help_question:'도움말 질문'}[k]||'자동 업무');
  const TASK_SOURCE={report_send_failed:'lesson-reports',followup_due:'consultations',enrollment_followup:'enrollment',progress_anomaly:'students',attendance_absent_desk:'attendance',video_upload_check:'video-homework',video_unassigned:'video-homework',unsent_report:'lesson-reports',approval_turn:'approvals',withdrawal_step:'withdrawal-reports',help_question:'help'};
  const taskSourcePage=k=>{const family=TASK_SOURCE[k];return !family?'':[`v2-${family}`,`workspace-${family}`].find(viewFor)||'';};

  function dialog(id,title,description,body){
    const node=$(`#${id}`);node.innerHTML=`<header class="live-dialog-header"><div><h2 id="${id}-title">${h(title)}</h2>${description?`<p>${h(description)}</p>`:''}</div><button class="icon-button" data-close="${id}" aria-label="닫기">${icon('close')}</button></header><div class="live-detail-body live-scroll">${body}</div>`;
    if(!node.open)node.showModal();attachScroll();
  }
  // 서랍에서 그 기록의 처리 화면으로 바로 간다(저장은 거기서).
  const recordLink=(family,id,label)=>window.RecordOpen?.supports(family,id)?`<a class="button primary" href="${h(window.RecordOpen.href(family,id))}">${h(label)}</a>`:'';
  const recordLines=(rows,emptyText='등록된 기록이 없습니다.')=>rows.length?`<div class="live-agenda">${rows.map(r=>`<div class="live-agenda-item"><span>${h(r.date||'날짜 미입력')}</span><div><strong>${h(r.title)}</strong><p class="live-pre">${h(r.text||'')}</p></div></div>`).join('')}</div>`:empty(emptyText,'');
  let absenceAsk=0;
  async function showAbsences(studentId,{attendanceId}={}){
    const ask=++absenceAsk;
    dialog('absence-detail','이번 달 결석 상세','결석 수업마다 후속 기록을 확인합니다.','<p class="live-note" role="status">결석 기록을 불러오는 중입니다.</p>');
    try{
      const key=attendanceId?`attendance=${encodeURIComponent(attendanceId)}`:`student=${encodeURIComponent(studentId)}`;
      const response=await fetch(`/api/attendance-absences?${key}`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('load');
      const data=await response.json();
      if(ask!==absenceAsk||!$('#absence-detail')?.open)return;
      const {groupAbsenceSessions}=await import('/absence-sessions.mjs');
      if(ask!==absenceAsk||!$('#absence-detail')?.open)return;
      const rows=groupAbsenceSessions((data.rows||[]).map(row=>({...row,studentId:data.student.id})));
      const body=`<div class="live-drawer-summary"><strong>${h(rows.length)}회 결석</strong><p>${h(data.month)} · 정정 반영 출결 · 같은 날 반별 수업은 각각 표시</p></div>`+
        (rows.length?`<div class="fl-rectable-wrap"><table class="fl-rectable"><thead><tr><th scope="col">날짜</th><th scope="col">반</th><th scope="col">교시·시간</th><th scope="col" class="wrap">사유·메모</th><th scope="col" class="wrap">후속 처리</th><th scope="col" class="al-c">담당 선생님</th><th scope="col" class="fl-rec-go">처리</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${h(/^\d{4}-\d{2}-\d{2}/.test(r.date||'')?(r.date.slice(0,4)===db.meta.asOf.slice(0,4)?`${r.date.slice(5,7)}.${r.date.slice(8,10)}`:`${r.date.slice(2,4)}.${r.date.slice(5,7)}.${r.date.slice(8,10)}`):r.date||'미입력')}</th><td><span class="fl-cut">${h(r.className||'반 미입력')}</span></td><td>${h(r.time||'미입력')}</td><td class="wrap">${h(r.memo||'—')}</td><td class="wrap">${h(r.followup||'—')}</td><td class="al-c">${h(r.teacher||'—')}</td><td class="fl-rec-go">${r.classId?`<button type="button" class="fl-rec-process" data-absence-day="${h(r.date)}" data-absence-class="${h(r.classId)}" aria-label="${h(r.date)} ${h(r.className||'')} 출석부 열기">처리 ›</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('이번 달 결석 기록이 없습니다.',''));
      dialog('absence-detail',`${data.student.name} · 이번 달 결석`,`${data.month} · ${rows.length}회`,body);
    }catch{if(ask===absenceAsk&&$('#absence-detail')?.open)dialog('absence-detail','이번 달 결석 상세','',`<p class="live-note">결석 기록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>`);}
  }
  function showStudent(id){
    if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>showStudent(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}
    const s=byId('students',id);if(!s)return;state.studentId=id;
    const classRows=s.classes.map(id=>byId('classes',id)).filter(Boolean);
    const billRows=db.invoices.filter(i=>i.studentId===id&&i.period===db.meta.month).map(i=>`<details class="live-bill-mini"><summary>${h(i.billingName||'수납명 없음')} · 남은 금액 ${won(i.remaining)} · 상세 수납 보기</summary>${ws?.billingDetails(i.lines)||''}</details>`).join('');
    dialog('detail',s.name,`${s.school} · ${s.grade} · ${status(s.status)}`,
      `<div class="live-drawer-summary"><strong>${s.attendance.total?s.attendance.absent+'회 결석':'출결 기록 없음'}</strong><p>${mlabel(db.meta.month)} 전체 출결 ${s.attendance.total}칸 · 지각 ${s.attendance.late}칸 · 보강 ${s.attendance.makeup}칸</p></div><div class="flex">${recordLink('students',id,'원생 상세 열기')}</div>`+
      panel('수강 중인 반','현재 수강 기준',classRows.length?`<div class="live-filter">${classRows.map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`:empty('수강 중인 반이 없습니다.',''))+
      panel('성적·진도 기록','점수는 시험별 만점과 함께 표시합니다.',recordLines(s.grades.map(g=>({date:shortDate(g.date),title:`${subject(g.subject)} · ${g.exam} ${g.score}/${g.max}`,text:''})),'등록된 성적 기록이 없습니다.')+recordLines(s.progress.map(p=>({date:shortDate(p.date),title:'진도 기록',text:p.content})),'등록된 진도 기록이 없습니다.'))+
      panel('수업보고서','최근 기록',recordLines(s.lessons.map(l=>({date:shortDate(l.date),title:`${subject(l.subject)} · ${l.teacher||'선생님 미입력'}`,text:l.progress})),'등록된 수업보고서가 없습니다.'))+
      panel('상담 기록',`후속 확인 ${s.followups}건`,recordLines(s.consultations.map(c=>({date:shortDate(c.date),title:c.category||'상담',text:[c.summary,c.followup?`후속 조치: ${c.followup}`:'',c.due?`${shortDate(c.due)} ${c.done?'완료':'후속 일정'}`:''].filter(Boolean).join('\n')})),'등록된 상담 기록이 없습니다.'))+
      panel(`${mlabel(db.meta.month)} 수납`,'이번 달 청구분',`<dl><dt>청구 금액</dt><dd>${won(s.billed)}</dd><dt>수납 금액</dt><dd>${won(s.paid)}</dd><dt>남은 금액</dt><dd>${won(s.remaining)}</dd></dl>${billRows}`));
  }
  function showClass(id){const c=byId('classes',id);if(!c)return;dialog('detail',c.name,`${subject(c.subject)} · ${c.teacher} · ${c.room}`,
    `<div class="live-drawer-summary"><strong>수강생 ${c.students.length}명</strong><p>강의실 정원 ${c.capacity??'미입력'}${c.capacity?'명':''} · 분리 등원이 있어 실제 동시 출석 인원과 다를 수 있습니다.</p></div>`+
    panel('주간 시간표','기준일 시간표',recordLines(c.schedules.map(s=>({date:'일월화수목금토'[s.day]+'요일',title:`${s.start}–${s.end}`,text:`${s.teacher} · ${s.room}`})),'등록된 시간표가 없습니다.'))+
    panel('수강생','원생을 누르면 원생 상세가 열립니다.',`<div class="live-filter">${c.students.map(id=>{const s=byId('students',id);return s?`<button class="button" data-student="${h(id)}">${h(s.name)}</button>`:'';}).join('')}</div>`)+
    panel(`${mlabel(db.meta.month)} 출결`,'입력된 출결 기록 기준',`<div class="live-big">${c.absent}<small>회 결석 / 전체 ${c.attendance}회 기록</small></div>`));}
  function showLead(id){const a=byId('admissions',id);if(!a)return;dialog('detail',`${a.name} · 신규 콜&상담`,`${a.school||'학교 미입력'} · ${a.grade||'학년 미입력'}`,
    `<div class="live-drawer-summary"><strong>${status(a.outcome)}</strong><p>${shortDate(a.date)} 접수 · ${h(a.teacher)} 담당</p></div><dl><dt>상담 과목</dt><dd>${h(subject(a.subject))}</dd><dt>유입 경로</dt><dd>${h(a.channel)}</dd><dt>후속 일정</dt><dd>${shortDate(a.followup)}</dd><dt>상담 메모</dt><dd>${h(a.note||a.reason||'입력된 메모가 없습니다.')}</dd></dl>`+
    recordLink('enrollment',id,'신규 콜&상담에서 열기'));}
  function showBill(id){if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>showBill(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}const i=byId('invoices',id);if(!i)return;dialog('detail',`${i.name} · ${mlabel(i.period)} 수납`,status(i.status),
    `<div class="live-drawer-summary"><strong>${won(i.remaining)}</strong><p>남은 금액</p></div><dl><dt>할인 전 금액</dt><dd>${won(i.gross)}</dd><dt>할인</dt><dd>${won(i.discount)}</dd><dt>실제 청구 금액</dt><dd>${won(i.total)}</dd><dt>누적 수납</dt><dd>${won(i.paid)}</dd><dt>납부 기한</dt><dd>${i.due||'미입력'}</dd><dt>청구 구분</dt><dd>${i.category==='tuition'?'수강료':'기타'}</dd></dl>${ws?.billingDetails(i.lines)||''}<div class="flex"><button class="button" data-student="${h(i.studentId)}">원생 상세 보기</button>${recordLink('billing',id,'수납관리에서 열기')}</div>`);}
  function showStaff(id){const s=byId('staff',id);if(!s)return;dialog('detail',s.name,s.title,
    `<div class="live-drawer-summary"><strong>담임 반 ${s.classes.length}개</strong><p>이번 달 근무 기록 ${s.workDays}일 · 남은 업무 ${s.tasks}건</p></div>`+
    panel('담임 반','반을 누르면 수강생과 시간표가 열립니다.',`<div class="live-filter">${s.classes.map(id=>byId('classes',id)).filter(Boolean).map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`)+
    panel('급여명세서','명세서 지급액은 실제 송금과 다를 수 있습니다.',recordLines(db.finance.payslips.filter(p=>p.userId===id).map(p=>({date:mlabel(p.period),title:status(p.status),text:p.net===null?'금액 미확정':`명세서 지급액 ${won(p.net)} · 지급 총액 ${won(p.gross)}`})),'등록된 명세서가 없습니다.'))+
    panel('계약 기록','기준일에 유효한 계약',recordLines(s.contracts.map(c=>({date:c.start||'시작일 미입력',title:c.end?`${c.end}까지`:'종료일 미입력',text:''})),'유효한 계약 기록이 없습니다.')));
  }
  function showMessage(id){const m=byId('messages',id);if(!m)return;dialog('detail',`${m.name} 보호자 메시지`,`${shortDate(m.date)} · ${m.category||'일반 대화'}`,
    `<div class="live-pre">${h(m.content||m.detail||'내용 없음')}</div><div class="flex"><button class="button" data-student="${h(m.studentId)}">원생 상세 보기</button><a class="button primary" href="#${h(MOVED.parents)}">학부모 글·답글 열기</a></div>`+
    panel('답글','저장된 답글',recordLines(m.replies.map(r=>({date:shortDate(r.date),title:r.author||'담당자',text:r.body})),'저장된 답글이 없습니다.')));}
  function showApproval(id){const a=byId('approvals',id);if(!a)return;dialog('detail',a.title,`${a.drafter} · ${a.number||'결재 문서'}`,
    `<div class="live-drawer-summary"><strong>${status(a.status)}</strong></div>`+
    panel('결재선','결재 순서대로',recordLines(a.steps.map((s,i)=>({date:`${i+1}단계`,title:s.name,text:`${({approve:'승인',approved:'승인',reject:'반려',rejected:'반려',pending:'대기'}[s.decision]||'대기')} ${s.date?shortDate(s.date):''}${s.comment?'\n'+s.comment:''}`}))))+
    (a.note?`<p class="live-pre">${h(a.note)}</p>`:'')+`<div class="flex">${recordLink('approvals',id,'전자결재에서 열기')}</div>`);}
  function showTask(id){const t=byId('tasks',id);if(!t)return;state.taskId=id;const source=taskSourcePage(t.kind);dialog('detail',t.title,`${taskKind(t.kind)} · ${taskStatus(t)}`,
    `<p class="live-pre">${h(t.detail||'상세 내용이 없습니다.')}</p><dl><dt>담당</dt><dd>${h(t.owners.join(', ')||'담당 미지정')}</dd><dt>기한</dt><dd>${t.due||'미정'}</dd><dt>생긴 날짜</dt><dd>${t.opened||'미입력'}</dd>${t.closed?`<dt>닫힌 날짜</dt><dd>${h(t.closed)}</dd>`:''}</dl><div class="live-drawer-summary"><strong>자동 업무</strong><p>원본 기록이 처리되면 이 업무는 자동으로 닫힙니다. 버튼으로 완료 처리하지 않습니다.</p></div><div class="flex">${source?`<button class="button primary" data-go="${h(source)}">원본 기록 열기</button>`:''}${button('후속 요청 만들기','task-followup')}</div>`);}
  const RECORD_VIEWS=[['students',showStudent],['invoices',showBill],['approvals',showApproval],['tasks',showTask],['classes',id=>showClass(id)],['staff',id=>showStaff(id)],['admissions',id=>showLead(id)],['messages',id=>showMessage(id)],['textbooks',id=>showBook(id)],['documents',id=>showDocument(id)],['calendar',id=>showEvent(id)]];
  function canOpenRecord(id){return RECORD_VIEWS.some(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));}
  function openRecord(id){if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>openRecord(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}const hit=RECORD_VIEWS.find(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));if(hit)hit[1](String(id));}
  function showBook(id){const b=byId('textbooks',id);if(!b)return;dialog('detail',b.name,`${b.student} · ${status(b.status)}`,`<dl><dt>담당 선생님</dt><dd>${h(b.teacher||'미입력')}</dd><dt>교재 금액</dt><dd>${won(b.price)}</dd><dt>요청일</dt><dd>${b.date||'미입력'}</dd><dt>주문일</dt><dd>${b.ordered||'미입력'}</dd><dt>전달일</dt><dd>${b.delivered||'미입력'}</dd></dl>${b.studentId?`<button class="button" data-student="${h(b.studentId)}">원생 상세 보기</button>`:''}`);}
  function showDocument(id){const d=byId('documents',id);if(!d)return;dialog('detail',d.title,`${d.category||'일반 문서'} · ${shortDate(d.updated)} 갱신`,`${d.description?`<p class="live-pre">${h(d.description)}</p>`:''}${d.body?`<div class="live-pre">${h(d.body)}</div>`:''}${d.hasFile?`<button class="button primary" data-document-download="${h(id)}">첨부파일 다운로드</button>`:empty('첨부파일이 없는 문서입니다.','')}`);}
  function showEvent(id){const e=byId('calendar',id);if(!e)return;dialog('detail',e.title,`${e.date}${e.end&&e.end!==e.date?' ~ '+e.end:''}`,`<div class="live-drawer-summary"><strong>${h(e.start||'종일 일정')}</strong><p>${h(e.finish?e.finish+' 종료':'학원에 등록된 일정')}</p></div>`);}
  function searchResults(){
    const q=state.search.trim().toLowerCase(),matched=(text)=>String(text).toLowerCase().includes(q);
    const students=db.students.filter(s=>matched(`${s.name} ${s.school}`)).slice(0,10),classes=db.classes.filter(c=>matched(`${c.name} ${c.teacher}`)).slice(0,5),staff=db.staff.filter(s=>matched(s.name)).slice(0,5);
    const item=(attrs,title,note)=>`<button class="live-search-item" ${attrs}><span><strong>${h(title)}</strong><br><small>${h(note)}</small></span>${icon('chevron')}</button>`;
    return (q?ws?.searchItems(q)||[]:[]).map(w=>item(`data-go="${h(w.page)}"`,w.title,w.note)).join('')+(matched('브리핑')?item('data-go="home"','브리핑','첫 화면'):'')+students.map(s=>item(`data-search-student="${h(s.id)}"`,s.name,`${s.school} · ${status(s.status)}`)).join('')+classes.map(c=>item(`data-search-class="${h(c.id)}"`,c.name,c.teacher)).join('')+staff.map(s=>item(`data-search-staff="${h(s.id)}"`,s.name,s.title)).join('')||empty('검색 결과가 없습니다.');
  }
  function showSearch(){state.search='';const node=$('#modal');node.innerHTML=`<header class="live-dialog-header"><h2 id="modal-title">검색</h2><button class="icon-button" data-close="modal" aria-label="닫기">${icon('close')}</button></header><div class="live-form"><input id="global-search" aria-label="통합 검색" placeholder="원생, 학교, 수업, 선생님 검색" autocomplete="off"></div><div class="live-search-results live-scroll" id="search-results">${searchResults()}</div>`;if(!node.open)node.showModal();$('#global-search').focus();attachScroll();}

  const views={home:ax.home,inbox:ax.inbox,requests:ax.requests,automation:ax.automation,...(flowUI?{flow:()=>flowUI.fullView()}:{})};
  // 첫 화면·업무 흐름·작업 공간은 첫 자료의 집계와 각 영역의 기록 GET으로 그린다. 그 밖의 화면은 전체 상세를 읽은 뒤 그린다.
  const teacherRoute=page=>page.startsWith('v2-teacher-home')||/^v2-(?:ecs|onescreen|lesson-reports)\?/.test(page)&&new URLSearchParams(page.split('?')[1]||'').get('teacherHome')==='1';
  const needsFull=page=>page!=='home'&&page!=='flow'&&!page.startsWith('workspace-')&&!teacherRoute(page);
  function paintShell(){shell();ax.decorateShell();$('#sidebar [data-action="notes"]')?.remove();syncSidebarRail();}
  function render(){
    document.body.classList.toggle('teacher-mode',teacherRoute(state.page)&&!state.page.startsWith('v2-teacher-home'));
    if(state.page&&needsFull(state.page)&&!fullReady){paintShell();$('#main').innerHTML='<p class="live-note" role="status">상세 자료를 불러오는 중입니다.</p>';ensureFull().then(()=>render(),()=>{$('#main').innerHTML='<p class="live-note" role="alert">상세 자료를 불러오지 못했습니다. 화면을 다시 열어 주세요.</p>';});return;}
    clearSpotlight();
    const focused=document.activeElement,focusId=focused?.id,selection=typeof focused?.selectionStart==='number'?focused.selectionStart:null;
    const navHref=focused?.closest('#sidebar')&&focused.getAttribute('href');
    const scrollPositions=new Map([...document.querySelectorAll('[data-scroll-key]')].map(n=>[n.dataset.scrollKey,[n.scrollTop,n.scrollLeft]]));
    hideTip();hideSidebarTip();scrollObserver.disconnect();paintShell();$('#main').innerHTML=PEEK&&!viewFor(state.page)?'':(viewFor(state.page)||ax.home)();ax.decorateView();
    document.querySelectorAll('[data-scroll-key]').forEach(n=>{const kept=scrollPositions.get(n.dataset.scrollKey);if(kept)[n.scrollTop,n.scrollLeft]=kept;});attachScroll();
    if(focusId){const next=document.getElementById(focusId);next?.focus({preventScroll:true});if(selection!==null&&next?.setSelectionRange)next.setSelectionRange(selection,selection);}
    if(navHref)document.querySelector(`#sidebar a[href="${CSS.escape(navHref)}"]`)?.focus({preventScroll:true});
    syncMenu();
    if(PEEK)dispatchEvent(new CustomEvent('aywa:render',{detail:{page:state.page}}));
  }
  // Off-canvas menu on phones: hidden links leave the tab order, focus moves in on open and back on Escape.
  function syncMenu(){const open=document.body.classList.contains('menu-open');$('#sidebar').inert=mobileNav.matches&&!open;$('[data-action="menu"]')?.setAttribute('aria-expanded',String(open));}
  function closeMenu(returnFocus){const wasOpen=document.body.classList.contains('menu-open');document.body.classList.remove('menu-open');syncMenu();if(wasOpen&&returnFocus)$('[data-action="menu"]')?.focus();}
  mobileNav.addEventListener('change',()=>{syncMenu();syncSidebarRail();});
  function navigate(target){const page=MOVED[target]||target;if(!viewFor(page))return;document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);if(location.hash===`#${page}`){state.page=page;render();}else location.hash=page;}
  const actions={
    menu:()=>{document.body.classList.add('menu-open');syncMenu();($('#sidebar .nav-item.active')||$('#sidebar a'))?.focus();},
    'sidebar-toggle':()=>{sidebarCollapsed=!sidebarCollapsed;try{localStorage.setItem(sidebarStorageKey,sidebarCollapsed?'collapsed':'expanded');}catch{}syncSidebarRail();$('#sidebar [data-action="sidebar-toggle"]')?.focus({preventScroll:true});},
    'close-menu':()=>closeMenu(true),
    search:showSearch,
    'task-followup':()=>{const t=byId('tasks',state.taskId);if(!t)return;const family=TASK_SOURCE[t.kind];$('#detail').close();ax.showRequest({title:`${t.title} 후속 확인`,body:`${taskKind(t.kind)} 업무가 아직 끝나지 않았습니다(${t.detail||t.title}). 원본 기록을 처리했는지 확인하고, 처리하지 못한 이유와 예정일을 보고해 주세요.`,source:'task',draftKey:`task:${t.id}`,context:family?{family,familyLabel:ws?.area(family)?.label||taskKind(t.kind),records:[{id:t.id,label:t.title}],task:t.id}:{task:t.id,records:[{id:t.id,label:t.title}]}});},
  };
  document.addEventListener('click',async event=>{
    if(event.target.matches('dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();return;}
    const el=event.target.closest('button,a,[data-action]');if(!el||el.disabled)return;
    const d=el.dataset;
    if(d.close){$(`#${d.close}`)?.close();return;}
    if(d.absenceDay){navigate(`v2-attendance?v2path=/attendance/${d.absenceDay}/${d.absenceClass}`);return;}
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
      try{const url=`/files/document/${encodeURIComponent(d.documentDownload)}`,response=await fetch(url,{method:'HEAD'});if(!response.ok){toast('이 문서의 첨부파일을 아직 받을 수 없습니다.');return;}const a=document.createElement('a');a.href=url;a.download='';a.click();}catch{toast('첨부파일을 불러오지 못했습니다. 다시 시도해 주세요.');}return;
    }
  });
  function onTextInput(event){
    if(event.isComposing)return;
    const el=event.target;
    if(el.id==='global-search'){state.search=el.value;$('#search-results').innerHTML=searchResults();fade($('#search-results'));}
  }
  document.addEventListener('input',onTextInput);document.addEventListener('compositionend',onTextInput);
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();showSearch();}if(event.key==='Escape')actions['close-menu']();});
  // 2.0 화면의 iframe은 다른 메뉴로 가도 숨은 채 남는다. 숨은 화면이 뒤늦게 보내는 주소 알림(줄 수 다시 재기 등)이 사람을 그 화면으로 끌고 가지 않게 여기서 버린다.
  addEventListener('message',event=>{const d=event.data;if(event.origin===location.origin&&d?.type==='v2-host-nav'&&location.hash.split('?')[0]!==`#v2-${d.screen}`)event.stopImmediatePropagation();},true);
  // 주소 → 화면. 옛 메뉴 주소는 첫 화면으로 보낸다. 2.0 화면은 늦게 등록되니 없는 주소는 그대로 두고 v2-screens.js가 다시 부른다.
  function pageFromHash(){
    let page=location.hash.slice(1)||'home';
    if(MOVED[page]){page='home';history.replaceState(null,'','#home');}
    return viewFor(page)?page:PEEK?'':'home';
  }
  window.addEventListener('hashchange',()=>{state.page=pageFromHash();document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);render();window.scrollTo(0,0);});
  /* 저장 뒤 자료 갱신(Codex 검수 10-28 AX-H2): 2.0 화면이 복사본에 저장하면 서버가 첫 화면 자료를 다시 만들고 개정 번호를 올린다
     (GET /api/data-revision). 보이는 동안 30초마다·창에 포커스가 올 때 묻고, 바뀌었으면 /snapshot.json을 받아 같은 db 객체를 제자리에서
     채운 뒤 다시 그린다(ax·작업 공간·업무 흐름 부품이 이 db 참조를 쥐고 있다). 열린 창·입력 칸·2.0 부품(iframe) 안에 있으면 끝날 때까지
     미룬다. 2.0 화면 캐시는 V2Screens.dataChanged가 다시 읽는다. */
  const fresh={revision:window.AcademySnapshotRevision?.revision||0,etag:window.AcademySnapshotRevision?.etag||'',next:null,busy:false,at:0};
  // 쓰다 만 칸(포커스는 떠났어도 값이 처음과 다름)도 다시 그리면 지워진다 — 그런 칸이 본문에 있으면 미룬다.
  const dirty=el=>el.type==='checkbox'||el.type==='radio'?el.checked!==el.defaultChecked:el.tagName==='SELECT'?[...el.options].some(o=>o.selected!==o.defaultSelected):!['hidden','button','submit','reset','file'].includes(el.type)&&el.value!==el.defaultValue;
  const busyHere=()=>{const a=document.activeElement;return Boolean(document.querySelector('dialog[open]'))||Boolean(a&&a!==document.body&&(a.isContentEditable||/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(a.tagName)))||[...document.querySelectorAll('#main input,#main textarea,#main select')].some(dirty);};
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function refill(target,next){
    for(const k of Object.keys(target))if(!(k in next))delete target[k];
    for(const [k,v] of Object.entries(next)){
      const old=target[k];
      if(Array.isArray(v)&&Array.isArray(old)){old.length=0;for(const x of v)old.push(x);}
      else if(plain(v)&&plain(old))refill(old,v);else target[k]=v;
    }
  }
  function applyFresh(){
    if(!fresh.next||busyHere())return;
    const {data,revision,etag}=fresh.next;fresh.next=null;
    if(data){refill(db,data);fullReady=true;fresh.etag=etag;const y=window.scrollY;render();window.scrollTo({top:y,behavior:'instant'});}
    fresh.revision=revision;window.V2Screens?.dataChanged?.();dispatchEvent(new CustomEvent('aywa:data-revision',{detail:{revision}}));
  }
  async function checkFresh(){
    if(fresh.busy||document.hidden||Date.now()-fresh.at<2000)return;fresh.busy=true;fresh.at=Date.now(); // 포커스가 잦아도 2초에 한 번
    try{
      const r=await fetch('/api/data-revision',{cache:'no-store',headers:{Accept:'application/json'}}),info=r.ok?await r.json():null;
      const known=Math.max(fresh.revision,fresh.next?.revision||0);if(!Number.isInteger(info?.revision)||info.revision<=known)return;
      if(info.etag===fresh.etag){fresh.next={data:null,revision:info.revision,etag:fresh.etag};return;} // 첫 화면 자료는 그대로 — 기록·2.0 화면만 바뀜
      if(fresh.next?.data&&info.etag===fresh.next.etag){fresh.next={...fresh.next,revision:info.revision};return;}
      const s=await fetch('/snapshot.json',{cache:'no-store',headers:{Accept:'application/json'}});if(!s.ok)return;
      const data=await s.json(),revision=Number(s.headers.get('X-Data-Revision'))||info.revision;
      if(data?.meta&&revision>known)fresh.next={data,revision,etag:s.headers.get('ETag')||''};
    }catch{/* 다음 확인 때 다시 */}finally{fresh.busy=false;applyFresh();}
  }
  setInterval(()=>{if(!document.hidden)checkFresh();},30000);
  window.addEventListener('focus',checkFresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkFresh();});
  document.addEventListener('close',()=>setTimeout(applyFresh),true);document.addEventListener('focusout',()=>setTimeout(applyFresh));
  document.body.classList.add('sidebar-initializing');
  state.page=pageFromHash();render();requestAnimationFrame(()=>document.body.classList.remove('sidebar-initializing'));document.fonts.ready.then(()=>document.querySelectorAll('.nav-scroll,.live-scroll').forEach(fade));
})();
