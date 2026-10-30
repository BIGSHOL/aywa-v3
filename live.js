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
      refill(db,data,true);fullReady=true;
    }).catch(error=>{fullPromise=null;throw error;});
    return fullPromise;
  }
  const $=q=>document.querySelector(q);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
  const won=n=>`${fmt(Math.round(n||0))}원`;
  const money=n=>Math.abs(n)>=1e8?`${fmt(n/1e8)}억`:`${fmt(n/1e4)}만`;
  const pct=(n,d)=>d?Math.round(n/d*1000)/10:null;
  const rate=(n,d)=>d?`${fmt(pct(n,d))}%`:'기록 없음';
  const sum=(items,key)=>items.reduce((n,x)=>n+Number(x[key]||0),0);
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
  const empty=(title,note='조건을 바꾸거나 다른 기간을 확인해 주세요.')=>`<div class="live-empty"><strong>${h(title)}</strong>${note?`<p>${h(note)}</p>`:''}</div>`;
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
  const periodTitle=x=>{const d=String(x.month||x.date||'');if(isMonth(d))return yymm(d);if(/^\d{4}-\d{2}-\d{2}$/.test(d))return `${d.slice(0,4)}년 ${Number(d.slice(5,7))}월 ${Number(d.slice(8,10))}일`;return String(x.label||d);};
  // 덧붙임 줄(meta) = 글자 또는 {text, tone} — tone은 좋아짐 good(빨강)·나빠짐 bad(파랑)(원장 10-28 "마우스 오버할때 나오는것도 파란색 빨간색 적용").
  const tipData=(title,rows,meta=[])=>h(JSON.stringify({title,rows,meta:meta.filter(m=>m&&(typeof m==='string'||m.text))}));
  const metaText=m=>typeof m==='string'?m:String(m?.text||'');
  const deltaText=(v,prev,unit,monthly)=>v==null||prev==null?'':`${monthly?'전월':'이전'} 대비 ${v>prev?'+':v<prev?'−':'±'}${exact(Math.abs(v-prev),unit)}`;
  function chart(items,key,unit='',options={}){
    if(!items.some(x=>x[key]!==null&&x[key]!==undefined))return empty('이 기간의 기록이 없습니다.','없는 기간을 추정값으로 채우지 않았습니다.');
    const W=620,H=216,L=42,R=20,T=25,B=32,inner=W-L-R,secondary=options.secondary;
    const values=items.flatMap(x=>[x[key],...(secondary?[x[secondary]]:[])]).filter(x=>x!==null&&x!==undefined).map(Number);
    // 세로축 눈금은 딱 떨어지는 간격(1·2·2.5·5×10ⁿ, 표시 단위 기준 — 원장 10-28 "803, 1605, 2408 … 기준을 알 수 없으니 딱 떨어지는 숫자로").
    const scale=unit==='만원'?10000:1,top=Math.max(...values,1)/scale,raw=top/4,mag=10**Math.floor(Math.log10(raw)),n=raw/mag,tick=Math.max((n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag,1)*scale,ticks=Math.ceil(Math.max(...values,1)/tick);
    const max=tick*ticks*(Math.max(...values,1)>tick*ticks*.9?1.08:1),step=inner/Math.max(items.length,1),y=v=>T+(H-T-B)*(1-v/max);
    const label=v=>unit==='만원'?fmt(v/10000):fmt(Math.round(v));
    const name=x=>x.label||(x.month?mlabel(x.month):shortDate(x.date));
    const monthly=items.every(x=>isMonth(x.month));
    const grid=Array.from({length:ticks+1},(_,i)=>{const val=tick*i;return `<line class="grid-line" x1="${L}" x2="${W-R}" y1="${y(val)}" y2="${y(val)}"/><text x="${L-9}" y="${y(val)+4}" text-anchor="end">${label(val)}</text>`;}).join('')
      // 구간마다 흐린 점선 세로선(원장 10-28 "구간마다 점선 세로선을 그어서 쉽게 위치 파악") — 막대 뒤에.
      +items.map((_,i)=>`<line class="col-line" x1="${L+step*(i+.5)}" x2="${L+step*(i+.5)}" y1="${T}" y2="${H-B}"/>`).join('');
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
  // 화면 이름 = 2.0 사이드바 메뉴 이름(ax.js labels와 같은 글). 2.0에 없는 화면(브리핑·학부모 소통·업무)은 그 화면 제목.
  const pages=[['home','브리핑','home','원장실'],['students','원생목록','people','학원 운영'],['admissions','신규 콜&상담','message'],['classes','수업목록 · 시간표','calendar'],['learning','성적관리 · 수업보고서','book'],['finance','수납관리','wallet','경영 관리'],['staff','직원관리','staff'],['parents','학부모 소통','message'],['shuttle','셔틀','bus'],['approvals','전자결재 · 업무','check','운영 지원'],['resources','교재 요청 · 재고관리 · 데이터베이스','box'],['calendar','캘린더','calendar'],['settings','학원 설정','settings']];
  // 옛 시안 이름도 통합 검색에서 찾히게 남긴다.
  const pageAliases={home:'경영 흐름',students:'원생 · 재원 관리',admissions:'입학 · 상담',classes:'수업 · 시간표',learning:'학습 · 성과',finance:'수납 · 재무',staff:'직원 · 급여',shuttle:'차량 · 안전',approvals:'업무 · 결재',resources:'교재 · 자산 · 문서 교재 · 재고 · 서식',calendar:'학원 일정'};
  const state={page:'home',month:db.meta.month,homeRange:'recent',studentFilter:'enrolled',studentQuery:'',studentPage:0,admissionFilter:'all',classSubject:'all',classView:'flow',classPage:0,resourceView:'textbooks',taskFilter:'open',vehicle:db.vehicles[0]?.id,season:'term',selectedDate:db.meta.asOf,calendarMonth:db.meta.month,calendarOffset:0,financeMonth:db.meta.month,financePage:0,studentId:'',noteContext:'',search:'',localNotes:[]};
  let toastTimer;
  const toast=text=>{const node=$('#toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3000);};
  // Factories: ax (briefing/requests/assistant) first, then workspaces (catalog-driven family screens) which uses ax.
  // 과목 색 = 앱 전체 한 곳(원장 10-28 "미수강 = 회색. 영어+수학 = 보라색. 수학 = 파란색. 영어 = 빨간색. 전체 웹에 대해 통일" · "EiE 주황색").
  // 열쇠 이름의 뜻으로 고른다(지표마다 열쇠가 다르다 — math · mathOnly · english.math · both · eie · injaewon · unknown …). 모르면 null.
  const SUBJECT_TONE={math:'#1d4ed8',english:'#c62828',eie:'#ea580c',mixed:'#7c3aed',none:'#9ca3af'};
  const subjectColor=key=>{const k=String(key??'').toLowerCase();if(!k)return null;if(/^(unknown|none|other|otheronly|nothing)$/.test(k))return SUBJECT_TONE.none;const math=k.includes('math'),eie=k.includes('eie'),eng=/english|injaewon/.test(k);if(k==='both'||(math&&(eie||eng)))return SUBJECT_TONE.mixed;if(eie)return SUBJECT_TONE.eie;if(eng)return SUBJECT_TONE.english;if(math)return SUBJECT_TONE.math;return null;};
  const api={db,h,fmt,yymm,won,icon,chart,lineChart,exact,dialog,navigate,render,attachScroll,scrollToSection,toast,ensureFull,subjectLabel:subject,subjectColor,showStudent,showAbsences,showBill,showApproval,showTask,openRecord,canOpenRecord,getPage:()=>state.page,hasView:id=>Boolean(viewFor(id)),closeMenu};
  const ax=window.createOwnerWorkspace(api);
  const ws=typeof window.createWorkspaces==='function'?window.createWorkspaces({...api,ax}):null;
  api.showWorkspaceRecord=(family,id)=>ws?ws.showRecord(family,id):toast('이 기록은 여기서 바로 열 수 없습니다.');
  ax.useWorkspaces?.(ws);
  window.V2Screens?.bind(api); // 2.0 화면 (v2-screens.js): 2.0 형태의 새 3.0 페이지 — #v2-<id>
  // '왜 줄었나' (exit-insight.js, INSIGHT-EXITS.md): entry buttons on the billing/student cards; fetched only when pressed; records open by exact id.
  const insight=typeof window.createExitInsight==='function'?window.createExitInsight({...api,showWorkspaceRecord:(family,id)=>ws?ws.showRecord(family,id):toast('이 기록은 여기서 바로 열 수 없습니다.')}):null;
  api.insightEntry=(from,to,label)=>insight?.entry(from,to,label)||'';
  const declinePair=key=>{const rows=recentTrend();for(let i=rows.length-1;i>0;i-=1)if(rows[i][key]<rows[i-1][key])return [rows[i-1].month,rows[i].month];return null;};
  // Durable work flow (GET /api/flow): preview selector, role views, request store. Absent → session-only requests.
  const flowUI=typeof window.createFlowUI==='function'?window.createFlowUI({...api,ax,familyLabel:id=>ws?.area(id)?.label||'',showWorkspaceRecord:(family,record)=>ws?.showRecord(family,record),openWorkspace:(family,facet)=>ws?.openFamily(family,facet),attachField:(scope,family)=>ws?.attachField(scope,family)||''}):null;
  ax.useFlow?.(flowUI);
  api.showCardRequest=args=>{if(!flowUI?.ready()){toast('업무 흐름을 불러오지 못했습니다. 다시 시도해 주세요.');return;}ax.showRequest(args);};
  api.cardRequestFor=(metric,factIds)=>flowUI?.cardRequestFor?.(metric,factIds);
  api.openFlowCase=id=>flowUI?.showCase?.(id);
  api.openCardFlow=args=>flowUI?.openCardFlow?.(args);
  const viewFor=page=>{if(!page)return null;if(views[page])return views[page];const v2=window.V2Screens?.view(page);if(v2)return v2;const id=ws?.familyOf(page);return id&&ws.has(id)?()=>ws.view(id):null;};
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
  function shell(){
    const offset=$('.nav-scroll')?.scrollTop||0;
    const sticker=(id,fallback)=>window.V2Screens?.sticker?.(id)||icon(fallback);
    const teacherActor=flowUI?.actor?.(),teacherLink=teacherActor?.role==='teacher'?`<a class="nav-item" href="#v2-teacher-home?actor=${h(teacherActor.id)}">${sticker('teacher-home','book')}<span>선생님 화면</span></a>`:'';
    $('#sidebar').innerHTML=`<a href="#home" class="brand"><span class="brand-mark">${icon('trend')}</span><div><div class="brand-name">aywa</div><div class="brand-caption">학원을 잇는 경영 공간</div></div></a><div class="academy-box"><span class="academy-symbol">${icon('building')}</span><div class="grow"><strong>${h(db.meta.tenant)}</strong><small>원장 · 경영자</small></div>${icon('down')}</div><nav class="nav-scroll" aria-label="학원 업무">${teacherLink}${pages.filter(p=>p[0]!=='settings').map(([id,label,symbol,section])=>`${section?`<div class="nav-group">${section}</div>`:''}<a class="nav-item ${state.page===id?'active':''}" href="#${id}" ${state.page===id?'aria-current="page"':''}>${sticker(id,symbol)}<span>${label}</span>${id==='approvals'?`<span class="nav-count">${db.approvals.filter(a=>a.status==='pending').length}</span>`:''}</a>`).join('')}${window.V2Screens?.sidebar(state.page)||''}</nav><div class="sidebar-bottom"><a class="nav-item ${state.page==='settings'?'active':''}" href="#settings">${sticker('owner','settings')}<span>학원 설정</span></a><div class="profile">${avatar('원장')}<div class="grow"><strong>원장님</strong><small>${h(db.meta.tenant)} · 원장실</small></div>${icon('chevron')}</div></div>`;
    $('.nav-scroll').scrollTop=offset;
    // Desktop has no header band: search, notes and channels live in the sidebar. Phones keep a menu bar (decorated by ax.js).
    $('#topbar').innerHTML=`<button class="icon-button mobile-menu" data-action="menu" aria-controls="sidebar" aria-label="메뉴 열기" aria-expanded="false">${icon('menu')}</button><strong>${pages.find(p=>p[0]===state.page)?.[1]||'브리핑'}</strong>`;
    $('#footer').innerHTML=`<span>${h(db.meta.tenant)} · ${Number(db.meta.asOf.slice(5,7))}/${Number(db.meta.asOf.slice(8,10))} 기준</span>`;
  }
  const home=()=>{
    const now=current(),prev=db.trend.at(-2),difference=now.payingStudents-prev.payingStudents;
    const selected=db.trend.find(t=>t.month===state.month)||now;
    const daily=db.daily.at(-1),first=db.daily[0];
    const trend=state.homeRange==='legacy'?db.legacyHistory.filter(x=>x.month.endsWith('-12')||x.month===db.meta.month).map(x=>({...x,label:x.month.replace('-','.'),value:x.enrolledRecord??null})):recentTrend().map(x=>({...x,value:x.payingStudents||null}));
    const followups=active().filter(s=>s.followups>0).length;
    return heading('브리핑','운영 현황과 확인할 업무를 봅니다.',button(`${icon('book')} 경영 메모`,'report'))+
      `<section class="live-lead"><div><small>${mlabel(db.meta.month)} 경영 브리핑</small><h2>청구 대상 원생이 지난달보다 ${fmt(Math.abs(difference))}명 ${difference<0?'줄었습니다':difference>0?'늘었습니다':'그대로입니다'}.</h2><p>현재 재원 ${fmt(active().length)}명 · 휴원 ${fmt(db.students.filter(s=>s.status==='on_hold').length)}명. 원생의 적응과 상담 흐름을 함께 살펴보세요.</p></div><div class="live-lead-stat"><strong>${rate(now.paid,now.billed)}</strong><span>이번 달 청구분 수납률</span></div></section>`+
      metrics([['현재 재원',`${fmt(active().length)}<small>명</small>`,daily&&first?`일별 기록 ${shortDate(first.date)}–${shortDate(daily.date)}`:'현재 원생 상태 기준'],['이번 달 누적 수납',`${money(now.paid)}<small>원</small>`,`${mlabel(db.meta.month)} 청구분 · 기준일까지`],['남은 수납',`${money(now.remaining)}<small>원</small>`,`${db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).length}건 확인 필요`],['새로 접수한 상담',`${now.inquiries}<small>건</small>`,`이번 달 접수 · 등록 상태 ${now.registered}건`]])+
      `<div class="live-grid">${panel(state.homeRange==='legacy'?'재원생 추이':'청구 대상 원생 추이',state.homeRange==='legacy'?'이전 장부의 연말 재원 기록과 올해 최신 기록':'수강료 청구 대상 · 월별 고유 원생',`${filters('homeRange',[['recent','최근 6개월'],['legacy','장기 흐름']],state.homeRange)}${chart(trend,'value','명',{label:state.homeRange==='legacy'?'이전 장부 재원 기록':'청구 대상 원생',...(state.homeRange==='recent'?{active:state.month}:{})})}${state.homeRange==='recent'?`<div class="live-months">${db.months.map(m=>`<button data-month="${m}" class="${state.month===m?'active':''}" aria-pressed="${state.month===m}">${mlabel(m)}</button>`).join('')}</div><div class="live-note"><strong>${mlabel(selected.month)} ${selected.payingStudents}명</strong> · 청구 ${money(selected.billed)}원 · 누적 수납 ${money(selected.paid)}원</div>`:''}<p class="live-note">${state.homeRange==='legacy'?'이전 장부의 재원 기록입니다. 현재 원생 상태·청구 대상과 집계 기준이 다릅니다.':'미납 포함, 취소·환불·테스트 원생 제외. 현재 재원 상태와 다른 지표이며 이번 달은 진행 중입니다.'}</p>`)}${panel('지금 확인할 업무','변화를 확인하고, 다음 행동으로 연결하세요.',`<button class="live-signal rose" data-go="students"><span>상담 후속 확인</span><strong>${followups}명</strong><p>재원생 중 후속 일정이 지났고 완료 표시가 없는 원생</p><em>원생의 맥락 살펴보기 →</em></button><button class="live-signal blue" data-go="finance"><span>수납 마무리</span><strong>${money(now.remaining)}원</strong><p>이번 달 청구분의 남은 금액</p><em>수납 흐름 확인 →</em></button><button class="live-signal teal" data-go="learning"><span>긍정 피드백</span><strong>${now.positiveSignals}건</strong><p>이번 달 기록된 긍정 피드백</p><em>학습 기록 살펴보기 →</em></button>`)}</div>`+
      `<div class="live-grid equal">${panel('월별 청구액·누적 수납액','각 청구월의 현재까지 누적 금액',chart(recentTrend(),'billed','만원',{secondary:'paid',label:'청구액',secondaryLabel:'수납액'})+'<p class="live-note">입금 발생월 기준 현금 흐름이 아닙니다. 이번 달은 진행 중입니다.</p>',go('수납관리','finance'))}${panel('재원생 학교별 분포','현재 재원생의 학교 구성',bars(group(active(),'school'),'명',7),go('원생목록','students'))}</div>`;
  };
  // month를 주면 그 달 출결(스냅숏 attendanceMonths — 기록 있는 달만 실려 없으면 0건), 안 주면 이번 달.
  function studentCards(items,month=''){return items.map(s=>{const at=month?s.attendanceMonths?.[month]||{total:0,absent:0}:s.attendance;return `<button class="live-card" data-student="${h(s.id)}"><header>${avatar(s.name)}<div><h3>${h(s.name)}</h3><p>${h(s.school)} · ${h(s.grade)}</p></div>${badge(status(s.status),s.status==='enrolled'?'teal':'')}</header><span class="live-card-label">${month?`${mlabel(month)} 출결 기록`:'이번 달 출결 기록'}</span><div class="live-card-number">${at.total?`${at.absent}<small>회 결석 / ${at.total}회 기록</small>`:'<small>아직 기록 없음</small>'}</div><p>${s.classes.length}개 수업 · ${s.positive?`긍정 피드백 ${s.positive}건`:'긍정 피드백 없음'}</p><footer><span>${s.followups?`후속 상담 ${s.followups}건`:s.remaining?`남은 수납 ${money(s.remaining)}원`:'원생 상세 보기'}</span>${icon('chevron')}</footer></button>`;}).join('');}
  const students=()=>{
    const rows=db.students.filter(s=>(state.studentFilter==='care'?s.status==='enrolled'&&(s.followups>0||s.attendance.absent>=3):state.studentFilter==='all'||s.status===state.studentFilter)&&`${s.name} ${s.school} ${s.grade}`.includes(state.studentQuery));
    const page=rows.slice(state.studentPage*18,(state.studentPage+1)*18);
    return heading('원생목록','일별 재원생 수, 학년 구성, 원생별 출결·상담 기록을 봅니다.')+
      `<div class="live-grid equal">${panel('일별 재원생 수','저장된 일별 재원 기록',chart(db.daily,'enrolled','명',{label:'재원생'})+'<p class="live-note">일별 기록이 있는 날만 표시합니다.</p>',(()=>{const p=declinePair('payingStudents');return p?api.insightEntry(p[0],p[1],`${mlabel(p[0])} → ${mlabel(p[1])} 청구 대상 감소 원인`):'';})())}${panel('재원생 학년 구성',`재원생 ${active().length}명`,bars(group(active(),'grade'),'명',9))}</div>`+
      subtitle('원생별 현황','원생을 누르면 수업·출결·학습·상담·수납 기록이 열립니다.')+
      filters('studentFilter',[['enrolled','재원'],['care','후속 확인'],['on_hold','휴원'],['prospect','예비'],['withdrawn','퇴원'],['all','전체']],state.studentFilter)+
      `<div class="live-filter"><span class="muted">${fmt(rows.length)}명</span><input id="student-search" aria-label="원생 이름, 학교 검색" placeholder="원생 이름, 학교, 학년 검색" value="${h(state.studentQuery)}"></div><div class="live-cards">${studentCards(page)}</div>${!rows.length?empty('조건에 맞는 원생이 없습니다.'):pager('studentPage',state.studentPage,rows.length,18)}`;
  };
  const pager=(key,page,total,size)=>`<div class="live-pager"><button class="button small" data-page-key="${key}" data-page="${page-1}" ${page<=0?'disabled':''}>이전</button><span>${page+1} / ${Math.max(1,Math.ceil(total/size))}</span><button class="button small" data-page-key="${key}" data-page="${page+1}" ${(page+1)*size>=total?'disabled':''}>다음</button></div>`;
  const classes=()=>{
    const rows=db.classes.filter(c=>state.classSubject==='all'||c.subject===state.classSubject);
    const scheduled=rows.flatMap(c=>c.schedules.map(s=>({...s,classId:c.id,name:c.name})));
    const timetable=[1,2,3,4,5].map(day=>`<section class="live-week-day live-scroll" tabindex="0" aria-label="${'일월화수목금토'[day]}요일 수업"><strong>${'일월화수목금토'[day]}요일</strong>${scheduled.filter(s=>s.day===day).sort((a,b)=>a.start.localeCompare(b.start)).map(s=>`<button class="live-slot" data-class="${h(s.classId)}"><span>${h(s.start)}–${h(s.end)}</span><strong>${h(s.name)}</strong><small>${h(s.room)} · ${h(s.teacher)}</small></button>`).join('')||'<p class="live-note">등록된 시간 없음</p>'}</section>`).join('');
    // 과목은 아래 지표·차트·목록 모두를 바꾸므로 머리에 둔다(목록 줄에 두면 목록만 거르는 것처럼 보인다).
    return heading('수업목록 · 시간표','요일별 시간 배치, 선생님별 담임 반, 반별 수강생을 봅니다.',filters('classSubject',[['all','모든 과목'],['math','수학'],['english','영어']],state.classSubject)+go('보강 기록','calendar'))+
      metrics([['운영 중인 반',`${rows.length}<small>개</small>`,'보강 대기반 제외'],['수강 중인 원생',`${new Set(rows.flatMap(c=>c.students)).size}<small>명</small>`,'여러 반을 들어도 한 번만 셉니다'],['주간 시간 배치',`${scheduled.length}<small>개</small>`,'기준일에 유효한 시간표'],['보강 예약 기록',`${db.makeup.length}<small>건</small>`,'전체 예약 이력']])+
      `<div class="live-grid equal">${panel('요일별 시간 배치','기준일 시간표의 배치 수',chart([1,2,3,4,5,6].map(day=>({label:'일월화수목금토'[day]+'요일',count:scheduled.filter(s=>s.day===day).length})),'count','개',{label:'시간 배치'}))}${panel('선생님별 담임 반 수','시간 배치 수가 아니라 반 수입니다.',bars(group(rows,'teacher'),'개',7))}</div>`+
      `${filters('classView',[['flow','반 목록'],['week','주간 시간표']],state.classView)}`+
      (state.classView==='week'?`<div class="live-week">${timetable}</div>`:`<div class="live-cards">${rows.slice(state.classPage*18,(state.classPage+1)*18).map(c=>`<button class="live-card" data-class="${h(c.id)}"><header><div><h3>${h(c.name)}</h3><p>${h(c.teacher)} · ${h(c.room)}</p></div>${badge(subject(c.subject),'blue')}</header><span class="live-card-label">현재 수강생</span><div class="live-card-number">${c.students.length}<small>명</small></div><p>이번 달 ${c.attendance}회 출결 기록 · 결석 ${c.absent}회</p><footer><span>주 ${c.schedules.length}개 시간 배치</span>${icon('chevron')}</footer></button>`).join('')}</div>${pager('classPage',state.classPage,rows.length,18)}`);
  };

  // 조회 월 = 공용 선택창. hint = 그 메뉴에 맞는 보조 숫자(수납 'billing' · 성적 'reports' · 콜&상담 'enrollment'). 바꾸면 아래 change 처리가 받는다(data-period).
  // 업무 담당도 공용 직원 선택창(값은 지금처럼 이름 — 업무가 이름으로 담당을 적는다). 맨 위는 원장.
  const ownerField=()=>{const fb=`<label>담당<select name="owner"><option>원장</option>${db.staff.map(s=>`<option>${h(s.name)}</option>`).join('')}</select></label>`,CP=window.ContextPicker;if(!CP)return fb;try{const l=CP.lists.staff({db,subjectLabel:subject});return CP.html({id:'live-task-owner',name:'owner',label:'담당',clearable:false,selected:['원장'],...l,options:[{value:'원장',title:'원장',search:'원장'},...l.options.map(o=>({...o,value:o.title}))]});}catch{return fb;}};
  const periodSelect=(key,value,periods=db.months,hint)=>{const CP=window.ContextPicker;if(CP)try{return `<span class="live-period">${CP.html({id:`live-period-${key}`,name:`period-${key}`,ariaLabel:'조회 월',selected:[value],attrs:{'data-period':key},...CP.lists.months({db,months:periods,hint})})}</span>`;}catch{}
    return `<select class="live-period" data-period="${key}" aria-label="조회 월">${[...new Set(periods)].sort().reverse().map(m=>`<option value="${m}" ${m===value?'selected':''}>${yymm(m)}</option>`).join('')}</select>`;};
  const admissions=()=>{
    const monthRows=db.admissions.filter(a=>a.date.startsWith(state.month));
    const stages=[['all','전체 문의',monthRows.length],['review','상담·검토 중',monthRows.filter(a=>['scheduled','consulted','ai_done'].includes(a.outcome)).length],['enrolled','등록',monthRows.filter(a=>a.outcome==='enrolled').length],['declined','미등록·미방문',monthRows.filter(a=>['declined','no_show'].includes(a.outcome)).length]];
    const rows=monthRows.filter(a=>state.admissionFilter==='all'||(state.admissionFilter==='review'?['scheduled','consulted','ai_done'].includes(a.outcome):state.admissionFilter==='declined'?['declined','no_show'].includes(a.outcome):a.outcome===state.admissionFilter));
    return heading('신규 콜&amp;상담','월별 상담 접수와 등록, 유입 경로, 상담 기록을 봅니다.',periodSelect('month',state.month,db.months,'enrollment')+button(`${icon('plus')} 새 상담`,'new-lead','primary'))+
      `<div class="live-grid equal">${panel('월별 상담 접수와 등록','접수월별 상담 건수와 현재 등록 상태',chart(recentTrend(),'inquiries','건',{secondary:'registered',label:'접수 상담',secondaryLabel:'현재 등록 상태',active:state.month})+'<p class="live-note">접수월마다 지금 등록 상태인 건수입니다. 단계별 전환율이 아닙니다.</p>')}${panel(`${mlabel(state.month)} 유입 경로`,'상담 기록에 적힌 경로를 묶은 건수',monthRows.some(a=>a.channelGroup)?bars(group(monthRows,'channelGroup'),'건',6):state.month===db.meta.month?bars(db.admissionChannels,'건',6):bars(group(monthRows,'channel'),'건',6))}</div>`+
      subtitle(`${mlabel(state.month)} 상담 단계별 건수`)+`<div class="live-flow">${stages.map(([id,label,count])=>`<button data-filter="${id}" data-key="admissionFilter"><span>${label}</span><strong>${count}</strong><small>현재 기록 기준</small></button>`).join('')}</div>`+
      filters('admissionFilter',stages.map(([id,label])=>[id,label]),state.admissionFilter)+
      `<div class="live-cards">${rows.map(a=>`<button class="live-card" data-lead="${h(a.id)}"><header>${avatar(a.name)}<div><h3>${h(a.name)}</h3><p>${h(a.grade||'학년 미입력')} · ${h(a.school||'학교 미입력')}</p></div>${badge(status(a.outcome),a.outcome==='enrolled'?'teal':'blue')}</header><p>${h(subject(a.subject))} · ${h(a.teacher)}</p><p>${h(a.note||a.reason||'상담 메모 없음').slice(0,130)}</p><footer><span>${shortDate(a.date)} 접수</span><span>${a.followup?`${shortDate(a.followup)} 후속 일정`:'상담 상세 →'}</span></footer></button>`).join('')}</div>${!rows.length?empty('이 조건의 상담 기록이 없습니다.'):''}`;
  };
  const finance=()=>{
    const rows=db.invoices.filter(i=>i.period===state.financeMonth),billed=sum(rows,'total'),paid=sum(rows,'paid'),remaining=sum(rows,'remaining');
    const debts=rows.filter(i=>i.remaining>0).sort((a,b)=>b.remaining-a.remaining),expenses=db.finance.expenses.filter(e=>e.date.startsWith(state.financeMonth));
    const categories=Object.entries(expenses.reduce((o,e)=>(o[e.category||'기타']=(o[e.category||'기타']||0)+e.amount,o),{})).map(([label,count])=>({label,count:Math.round(count/10000)})).sort((a,b)=>b.count-a.count);
    return heading('수납관리','청구, 누적 수납, 남은 금액을 구분해서 봅니다.',periodSelect('financeMonth',state.financeMonth,db.invoices.map(i=>i.period),'billing')+button(`${icon('book')} 월간 검토`,'report'))+
      metrics([['청구 금액',`${money(billed)}<small>원</small>`,`${rows.length}건 · 할인 반영, 취소·환불 제외`],['누적 수납',`${money(paid)}<small>원</small>`,`${rate(paid,billed)} 수납 완료`],['남은 수납',`${money(remaining)}<small>원</small>`,`${debts.length}건 확인 필요`],['기록된 지출',`${money(sum(expenses,'amount'))}<small>원</small>`,`${expenses.length}건 · 지출일 기준`]])+
      `<div class="live-grid equal">${panel(`${mlabel(state.financeMonth)} 청구분 수납률`,state.financeMonth>db.meta.month?'다음 달 예정 청구 · 기준일까지의 수납':'해당 청구월에 연결된 누적 수납',`<div class="live-big">${rate(paid,billed)}<small>수납 완료</small></div><div class="live-amount" data-chart tabindex="0" role="group" aria-label="수납 ${won(paid)}, 남은 금액 ${won(remaining)} — 화살표 키로 확인합니다"><i data-point data-tip="${tipData(`${mlabel(state.financeMonth)} 청구분`,[{label:'수납',value:won(paid),tone:'primary'}],[billed?`청구액의 ${fmt(paid/billed*100)}%`:''])}" style="width:${billed?Math.min(100,paid/billed*100):0}%"></i><i data-point data-tip="${tipData(`${mlabel(state.financeMonth)} 청구분`,[{label:'남은 금액',value:won(remaining),tone:'secondary'}],[billed?`청구액의 ${fmt(remaining/billed*100)}%`:''])}" style="flex:1"></i></div><div class="between"><span class="muted">수납 ${won(paid)}</span><span class="muted">남은 금액 ${won(remaining)}</span></div><p class="live-note">입금 발생일 기준 현금 흐름이 아닙니다. 과거 월도 기준일까지 추가 수납된 금액을 포함합니다.</p>`)}${panel('월별 청구액·누적 수납액','청구월 기준 · 단위 만원',chart(recentTrend(),'billed','만원',{secondary:'paid',label:'청구액',secondaryLabel:'수납액',active:state.financeMonth}),(()=>{const i=db.trend.findIndex(t=>t.month===state.financeMonth),cur=db.trend[i],prev=db.trend[i-1];return cur&&prev&&cur.billed<prev.billed&&cur.month<=db.meta.month?api.insightEntry(prev.month,cur.month,`${mlabel(prev.month)} → ${mlabel(cur.month)} 청구 감소 원인`):'';})())}</div>`+
      `<div class="live-grid equal">${panel('항목별 지출',`${mlabel(state.financeMonth)} 지출일 기준`,categories.length?bars(categories,'만원',7):empty('이 기간의 지출 기록이 없습니다.','기록이 없다고 지출이 없었다는 뜻은 아닙니다.'))}${panel('급여명세서와 순이익','기록으로 확인되는 것만 표시합니다.',`<div class="live-signal blue"><span>급여명세서</span><strong>${db.finance.payslips.filter(p=>p.period===state.financeMonth&&p.status==='issued').length}건 발급</strong><p>발급 명세서와 실제 지급 내역을 구분해 확인하세요.</p></div><p class="live-note">수납은 청구월, 지출은 지출일 기준이라 둘을 빼서 순이익으로 표시하지 않습니다.</p>${go('직원관리 보기','staff')}`)}</div>`+
      subtitle('수납 리스트')+ // 남은 금액이 있는 청구만 · 항목은 줄 아래 펼침 · 처음 정렬은 남은 금액 큰 순.
      (debts.length?ws?.listTable?.({key:'finance-bills',rows:debts.map(i=>({...i,label:i.name})),sort:{col:'remaining',dir:'desc'},repaint:render,search:true,main:i=>`<button type="button" class="ws-rowmain ws-cut" data-bill="${h(i.id)}">${h(i.name)}</button>`,details:i=>ws.billingDetails(i.lines),columns:[{key:'period',label:'청구월',text:i=>mlabel(i.period),sortv:i=>String(i.period||'')},{key:'status',label:'상태',chip:true,text:i=>status(i.status)},{key:'due',label:'납부 기한',text:i=>/^\d{4}-\d{2}-\d{2}/.test(i.due||'')?`${Number(i.due.slice(5,7))}/${Number(i.due.slice(8,10))}`:'',sortv:i=>String(i.due||'')},{key:'billingName',label:'수납명',text:i=>i.billingName||'—'},...[['total','청구액'],['paid','수납'],['remaining','남은 금액']].map(([k,label])=>({key:k,label,text:i=>won(i[k]),sortv:i=>Number(i[k])||0}))]})??'':empty('이 기간의 남은 수납이 없습니다.'));
  };
  const learning=()=>{
    const now=db.trend.find(t=>t.month===state.month)||current(),exams=db.learning.exams.filter(e=>e.month===state.month);
    const monthAttendance=db.students.some(s=>s.attendanceMonths); // 달별 출결이 실린 스냅숏이면 카드 출결이 조회 월을 따른다
    return heading('성적관리 · 수업보고서','월별 수업보고서·진도·영상 숙제 기록과 시험별 평균을 봅니다.',periodSelect('month',state.month,db.months,'reports'))+
      metrics([['수업보고서',`${fmt(now.reports)}<small>건</small>`,'보고서 날짜 기준'],['진도 기록',`${fmt(now.progressEntries)}<small>건</small>`,'진도 날짜 기준'],['영상 숙제 제출',`${fmt(now.videoAssignments)}<small>건</small>`,'제출일 기준'],['긍정 피드백',`${fmt(now.positiveSignals)}<small>건</small>`,'취소된 기록 제외']])+
      `<div class="live-grid equal">${panel('월별 수업보고서','보고서 날짜 기준',chart(recentTrend(),'reports','건',{label:'수업보고서',active:state.month}))}${panel('월별 진도 기록·영상 숙제 제출','월별 건수',chart(recentTrend(),'progressEntries','건',{secondary:'videoAssignments',label:'진도 기록',secondaryLabel:'영상 숙제 제출',active:state.month}))}</div>`+
      `${subtitle(`${mlabel(state.month)} 시험별 평균`,'시험마다 종류·과목·응시 원생이 달라 평균을 잇는 선은 그리지 않습니다.')}`+
      (exams.length?`<div class="live-cards">${exams.map(e=>`<section class="live-card"><header><div><h3>${h(e.name)}</h3><p>${subject(e.subject)} · ${mlabel(e.month)}</p></div>${badge(`${e.students}명`,'blue')}</header><span class="live-card-label">만점 100점 환산 평균</span><div class="live-card-number">${fmt(e.average)}<small>점</small></div><p>점수 기록 ${e.count}개 · 미응시 제외</p></section>`).join('')}</div>`:empty('이 기간의 시험 점수 기록이 없습니다.'))+
      subtitle('점수·진도 기록이 있는 원생',`재원생 중 긍정 피드백이 많은 순으로 최대 9명${monthAttendance?` · 출결은 ${mlabel(state.month)} 기준`:''}`)+`<div class="live-cards">${studentCards(active().filter(s=>s.grades.length||s.progress.length).sort((a,b)=>b.positive-a.positive).slice(0,9),monthAttendance?state.month:'')}</div>`;
  };
  const staff=()=>{
    const issued=db.finance.payslips.filter(p=>p.status==='issued'),latest=[...new Set(issued.map(p=>p.period))].sort().at(-1),latestPayslips=issued.filter(p=>p.period===latest);
    return heading('직원관리','담임 반, 남은 업무, 근무 기록, 급여명세서를 봅니다.')+
      metrics([['활동 중인 직원',`${db.staff.length}<small>명</small>`,'현재 계정 상태 기준'],['이번 달 근무 기록',`${sum(db.staff,'workDays')}<small>건</small>`,'직원별 근무일을 더한 값'],['최근 발급 명세서',`${latestPayslips.length}<small>건</small>`,latest?`${mlabel(latest)} 발급분`:'발급 기록 없음'],['발급분 지급액 합계',`${money(sum(latestPayslips,'net'))}<small>원</small>`,'명세서 금액 · 실제 송금과 다를 수 있음']])+
      `<div class="live-grid equal">${panel('선생님별 담임 반 수','담임으로 등록된 반 기준',bars(db.staff.filter(s=>s.classes.length).map(s=>({label:s.name,count:s.classes.length})).sort((a,b)=>b.count-a.count),'개',8))}${panel('담당자별 남은 업무','담당자가 여럿인 업무는 각자에게 셉니다.',bars(db.staff.filter(s=>s.tasks).map(s=>({label:s.name,count:s.tasks})).sort((a,b)=>b.count-a.count),'건',8))}</div>`+
      subtitle('직원별 현황','직원을 누르면 담임 반·급여명세서·계약 기록이 열립니다.')+`<div class="live-cards">${db.staff.map(s=>`<button class="live-card" data-staff="${h(s.id)}"><header>${avatar(s.name)}<div><h3>${h(s.name)}</h3><p>${h(s.title)}</p></div>${badge(s.subjects.map(subject).join('·')||'운영')}</header><div class="live-card-number">${s.classes.length}<small>개 담임 반</small></div><p>이번 달 근무 ${s.workDays}일 기록 · 남은 업무 ${s.tasks}건</p><footer><span>${s.contracts.length?'유효 계약 기록 있음':'유효 계약 기록 없음'}</span>${icon('chevron')}</footer></button>`).join('')}</div>`;
  };

  const parents=()=>{
    const c=db.communication;
    return heading('학부모 소통','리포트 전달·읽음 현황과 학부모 메시지를 봅니다.',button(`${icon('plus')} 안내 초안 작성`,'message-draft','primary'))+
      metrics([['이번 달 전달 리포트',`${fmt(c.sent)}<small>건</small>`,'전송 성공 상태 기준'],['읽음 확인',`${fmt(c.read)}<small>건</small>`,`전달 리포트의 ${rate(c.read,c.sent)}`],['전송 실패 기록',`${c.failed}<small>건</small>`,'현재 상태 기준 · 재확인 필요'],['이번 달 답글 기록',`${c.replies}<small>건</small>`,'학부모 대화에 남긴 답글']])+
      `<div class="live-grid equal">${panel('월별 리포트 전달·읽음','리포트 작성월 기준 · 현재 확인 상태',chart(recentTrend(),'sent','건',{secondary:'read',label:'전달 완료',secondaryLabel:'읽음 확인'})+'<p class="live-note">작성월마다 지금 읽음 상태인 건수입니다.</p>')}${panel('최근 메시지 분류',`최근 학부모 메시지 ${db.messages.length}건 기준`,bars(group(db.messages,m=>m.category||'일반 대화'),'건',7))}</div>`+
      subtitle('최근 학부모 메시지','메시지를 누르면 본문과 답글이 열립니다.')+
      `<div class="live-cards">${db.messages.slice(0,18).map(m=>`<button class="live-card" data-message="${h(m.id)}"><header>${avatar(m.name)}<div><h3>${h(m.name)} 보호자</h3><p>${shortDate(m.date)}</p></div>${badge(m.category||'일반 대화','blue')}</header><p>${h(String(m.content||m.detail||'내용 없음').slice(0,140))}</p><footer><span>답글 ${m.replies.length}건</span><span>메시지 보기 →</span></footer></button>`).join('')}</div>`;
  };
  const shuttle=()=>{
    const runs=db.runs.filter(r=>r.vehicleId===state.vehicle&&r.season===state.season);
    const run=runs.find(r=>r.id===state.run)||runs[0];
    if(run)state.run=run.id;
    const records=db.boardings.filter(b=>b.date===state.selectedDate),riderCount=run?new Set(run.stops.flatMap(s=>s.riders.map(r=>r.studentId))).size:0;
    return heading('셔틀','배정과 실제 탑승 기록을 구분해 확인합니다.',`<input type="date" aria-label="탑승 기록 날짜" id="shuttle-date" value="${state.selectedDate}">`)+
      metrics([['운행 차량',`${db.vehicles.length}<small>대</small>`,'현재 사용 중인 차량'],['선택 차량의 운행',`${runs.length}<small>회차</small>`,state.season==='term'?'학기 중 배정':'방학 배정'],['선택 회차 배정',`${riderCount}<small>명</small>`,'요일이 달라도 한 번만 셉니다'],['선택일 탑승 기록',`${records.length}<small>건</small>`,records.length?'입력된 실제 탑승 기록':'기록 없음 · 미탑승이라는 뜻은 아닙니다']])+
      `${filters('vehicle',db.vehicles.map(v=>[v.id,v.name]),state.vehicle)}${filters('season',[['term','학기 중'],['vacation','방학']],state.season)}${filters('run',runs.map(r=>[r.id,`${r.direction==='in'?'등원':'하원'} · ${r.label}`]),run?.id)}`+
      `<div class="live-grid">${panel(run?`${h(run.label)} · ${run.direction==='in'?'등원':'하원'} 정류장`:'운행 정보','정류장별 시간과 배정 원생',run?`<div class="live-agenda">${run.stops.map(s=>`<div class="live-agenda-item"><span>${h(s.time||'시간 미정')}</span><div><strong>${h(s.name)}</strong><p>${s.riders.length}명 배정</p><div class="live-filter">${s.riders.map(r=>`<button class="button small" data-student="${h(r.studentId)}">${h(r.name)}</button>`).join('')}</div></div></div>`).join('')}</div>`:empty('등록된 운행 정보가 없습니다.'))}${panel(`${shortDate(state.selectedDate)} 탑승 기록`,'배정 정보만으로 탑승 여부를 판단하지 않습니다.',records.length?`<div class="live-agenda">${records.map(b=>`<button class="live-agenda-item" data-student="${h(b.studentId)}"><span>${h(b.vehicle||'차량')}</span><div><strong>${h(b.name)} · ${status(b.status)}</strong><p>${h(b.stop)}</p></div></button>`).join('')}</div>`:empty('이 날짜의 탑승 기록이 없습니다.','기록이 없다고 미탑승이나 결석이라는 뜻은 아닙니다.'))}</div>`;
  };
  // 2.0 staff_tasks kinds. They open and close from the underlying records (never by a button); owner_review is this prototype's personal task.
  const taskKind=k=>({report_send_failed:'보고서 발송 실패',followup_due:'상담 후속조치',enrollment_followup:'콜&상담 후속 조치',progress_anomaly:'진도 기록 이상',attendance_absent_desk:'결석 확인 전화',video_upload_check:'영상 업로드 확인',video_unassigned:'미배정 영상',unsent_report:'미발송 수업 보고서',approval_turn:'전자결재 차례',withdrawal_step:'퇴원보고서',help_question:'도움말 질문',owner_review:'원장 개인 업무'}[k]||'자동 업무');
  const TASK_SOURCE={report_send_failed:['lesson-reports','learning'],followup_due:['consultations','students'],enrollment_followup:['enrollment','admissions'],progress_anomaly:['students','learning'],attendance_absent_desk:['attendance','students'],video_upload_check:['video-homework','learning'],video_unassigned:['video-homework','learning'],unsent_report:['lesson-reports','learning'],approval_turn:['approvals','approvals'],withdrawal_step:['withdrawal-reports','students'],help_question:['help','settings']};
  const taskSourcePage=k=>{const [family,legacy]=TASK_SOURCE[k]||[];return family&&viewFor(`workspace-${family}`)?`workspace-${family}`:legacy||'';};
  const approvals=()=>{
    const open=db.tasks.filter(t=>t.status==='open'),rows=db.tasks.filter(t=>state.taskFilter==='all'||t.status===state.taskFilter);
    return heading('전자결재 · 업무','결재 문서 상태와 남은 업무를 봅니다.',button(`${icon('plus')} 검토 업무 추가`,'new-task','primary'))+
      `<div class="live-grid equal">${panel('상태별 결재 문서','문서에 남은 상태 기준',`<div class="live-flow">${['pending','approved','rejected'].map(s=>`<button data-approval-status="${s}"><span>${status(s)}</span><strong>${db.approvals.filter(a=>a.status===s).length}</strong><small>문서 ${db.approvals.filter(a=>a.status===s).length}건</small></button>`).join('')}</div>`)}${panel('종류별 남은 업무',`남은 업무 ${open.length}건`,bars(group(open,t=>taskKind(t.kind)),'건',6))}</div>`+
      subtitle('결재 문서','승인·반려는 저장되지 않습니다.')+`<div class="live-cards">${db.approvals.filter(a=>!state.approvalStatus||a.status===state.approvalStatus).map(a=>`<button class="live-card" data-approval="${h(a.id)}"><header><div><h3>${h(a.title)}</h3><p>${h(a.drafter)} · ${shortDate(a.date)}</p></div>${badge(status(a.status),a.status==='pending'?'amber':'teal')}</header><p>${a.steps.length}단계 결재 · ${h(a.number||'문서 번호 미입력')}</p><footer><span>${a.local?'변경됨(저장 안 됨)':'결재 상세 보기'}</span>${icon('chevron')}</footer></button>`).join('')}</div>`+
      subtitle('업무')+filters('taskFilter',[['open','남은 업무'],['done','처리됨'],['all','전체']],state.taskFilter)+
      `<div class="live-cards">${rows.slice((state.taskPage||0)*18,((state.taskPage||0)+1)*18).map(t=>`<button class="live-card" data-task="${h(t.id)}"><header><div><h3>${h(t.title)}</h3><p>${h(taskKind(t.kind))}</p></div>${badge(taskStatus(t),t.status==='done'?'teal':'')}</header><p>${h(String(t.detail||'상세 내용 없음').slice(0,110))}</p><footer><span>${h(t.owners.join(', ')||'담당 미지정')}</span><span>${t.due?`${shortDate(t.due)}까지`:'기한 미정'}</span></footer></button>`).join('')}</div>${pager('taskPage',state.taskPage||0,rows.length,18)}`;
  };
  const resources=()=>{
    const orders=db.textbooks,stages=['requested','ordered','delivered','paid'];
    let content;
    if(state.resourceView==='textbooks')content=`<div class="live-grid equal">${panel('상태별 교재 주문','지금 상태 기준',`<div class="live-flow">${stages.map(s=>`<button data-book-status="${s}"><span>${status(s)}</span><strong>${orders.filter(o=>o.status===s).length}</strong><small>전체 기간</small></button>`).join('')}</div>`)}${panel('월별 교재 요청','요청일 기준',chart(db.months.map(m=>({month:m,count:orders.filter(o=>o.date.startsWith(m)).length})),'count','건',{label:'교재 요청'}))}</div>`+subtitle(`교재 주문 · ${state.bookStatus?status(state.bookStatus):'납부 전'}`,'위 상태를 누르면 그 상태의 주문만 봅니다.')+`<div class="live-cards">${orders.filter(o=>state.bookStatus?o.status===state.bookStatus:o.status!=='paid').slice(0,24).map(o=>`<button class="live-card" data-book="${h(o.id)}"><header><div><h3>${h(o.name)}</h3><p>${h(o.student)} · ${h(o.teacher||'담당 미입력')}</p></div>${badge(status(o.status),'amber')}</header><p>${won(o.price)}</p><footer><span>${shortDate(o.date)} 요청</span><span>상세 보기 →</span></footer></button>`).join('')}</div>`;
    else if(state.resourceView==='assets')content=`<div class="live-grid equal">${panel('상태별 자산',`자산 ${db.assetCount}개`,bars(db.assets.map(a=>({...a,label:status(a.label)})),'개',7))}${panel('소모품 수량','적은 순 · 품목별 보충 기준은 반영하지 않았습니다',bars([...db.supplies].sort((a,b)=>a.qty-b.qty).slice(0,8).map(s=>({label:s.name,count:s.qty})),'개',8))}</div>`+subtitle('소모품 보관 위치·점검일')+`<div class="live-cards">${db.supplies.map(s=>`<section class="live-card"><header><div><h3>${h(s.name)}</h3><p>${h(s.location||'보관 위치 미입력')}</p></div></header><div class="live-card-number">${s.qty}<small>개</small></div><footer><span>${shortDate(s.date)} 점검</span></footer></section>`).join('')}</div>`;
    else content=`<div class="live-grid equal">${panel('분류별 문서','등록된 문서 기준',bars(group(db.documents,'category'),'건',8))}${panel('문서 검색',`등록 문서 ${db.documents.length}건`,`<div class="live-signal blue"><span>이번 달 수정된 문서</span><strong>${db.documents.filter(d=>d.updated.startsWith(db.meta.month)).length}건</strong><p>수정일 기준</p></div><input id="document-search" style="margin-top:18px;width:100%" aria-label="문서 검색" placeholder="문서 제목 검색" value="${h(state.documentQuery||'')}">`)}</div>`+`<div class="live-cards">${db.documents.filter(d=>d.title.includes(state.documentQuery||'')).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,30).map(d=>`<button class="live-card" data-document="${h(d.id)}"><header><div><h3>${h(d.title)}</h3><p>${h(d.category||'일반 문서')}</p></div></header><p>${h(String(d.description||'설명 없음').slice(0,100))}</p><footer><span>${shortDate(d.updated)} 갱신</span><span>${d.hasFile?'첨부파일 있음':'내용 보기'} →</span></footer></button>`).join('')}</div>`;
    return heading('교재 요청 · 재고관리 · 데이터베이스','교재 주문, 자산·소모품, 운영 문서를 봅니다.')+filters('resourceView',[['textbooks','교재 요청'],['assets','재고관리'],['documents','데이터베이스']],state.resourceView)+content;
  };
  const calendar=()=>{
    const [year,month]=state.calendarMonth.split('-').map(Number),first=new Date(year,month-1,1).getDay(),days=new Date(year,month,0).getDate();
    const eventsOn=d=>db.calendar.filter(e=>e.date<=d&&(e.end||e.date)>=d);
    const selected=eventsOn(state.selectedDate),monthEvents=db.calendar.filter(e=>e.date.startsWith(state.calendarMonth));
    const cells=Array.from({length:first},()=>'<div></div>').join('')+Array.from({length:days},(_,i)=>{const d=`${state.calendarMonth}-${String(i+1).padStart(2,'0')}`,events=eventsOn(d);return `<button class="live-day ${d===state.selectedDate?'selected':''} ${d===db.meta.asOf?'today':''}" data-day="${d}" aria-label="${month}월 ${i+1}일, 일정 ${events.length}개" aria-pressed="${d===state.selectedDate}"><strong>${i+1}</strong>${events.length?`<p>${h(events[0].title)}</p><small>${events.length}개 일정</small>`:''}</button>`;}).join('');
    return heading('캘린더','학원 일정과 보강 예약을 봅니다.',button(`${icon('plus')} 일정 메모`,'calendar-note'))+
      `<div class="live-grid">${panel(yymm(`${year}-${String(month).padStart(2,'0')}`),`이 달에 시작하는 일정 ${monthEvents.length}개`,`<div class="live-calendar">${'일월화수목금토'.split('').map(d=>`<small>${d}</small>`).join('')}${cells}</div>`,`<div class="flex"><button class="icon-button" data-calendar-move="-1" aria-label="이전 달">‹</button><button class="button small" data-action="today">오늘</button><button class="icon-button" data-calendar-move="1" aria-label="다음 달">›</button></div>`)}${panel(`${shortDate(state.selectedDate)} 일정`,`${selected.length}개 일정`,selected.length?`<div class="live-agenda">${selected.map(e=>`<button class="live-agenda-item" data-event="${h(e.id)}"><span>${h(e.start||'종일')}</span><div><strong>${h(e.title)}</strong><p>${e.finish?`${h(e.finish)} 종료`:'등록된 학원 일정'}</p></div></button>`).join('')}</div>`:empty('등록된 일정이 없습니다.','선택한 날짜에 시작되거나 이어지는 일정 기준입니다.'))}</div>`+
      subtitle(`${month}월 보강 예약`,'보강일 기준 · 출결 처리와는 별개입니다.')+`<div class="live-cards">${db.makeup.filter(m=>m.date.startsWith(state.calendarMonth)).map(m=>`<section class="live-card"><header><div><h3>${h(m.name)}</h3><p>${h(m.className)}</p></div>${badge(status(m.status),'blue')}</header><p>${shortDate(m.absence)} 결석 → ${shortDate(m.date)} 보강</p><footer><span>${h(m.start||'시간 미입력')}</span></footer></section>`).join('')}</div>`;
  };
  const settings=()=>heading('학원 설정','학원 정보와 저장되는 범위를 봅니다.')+
    `<div class="live-grid equal">${panel('학원 정보','현재 선택된 지점',`<div class="live-drawer-summary"><strong>${h(db.meta.tenant)}</strong><p>원장 화면</p></div><div class="live-form" style="padding:20px 0 0"><label>학원 표시 이름<input id="academy-name" value="${h(db.meta.tenant)}"></label>${button('표시 이름 적용','save-name','primary')}<p class="live-note">새로고침하면 원래 이름으로 돌아옵니다.</p></div>`)}${panel('저장되는 범위',`${Number(db.meta.asOf.slice(5,7))}/${Number(db.meta.asOf.slice(8,10))} 기준 기록`,`<p class="live-note">원생목록·수납 같은 기록 화면의 검토 메모와 상태 변경은 새로고침하면 사라집니다.<br>업무 흐름의 요청·보고·검토는 새로고침해도 남습니다.</p>`)}</div>`;

  function dialog(id,title,description,body){
    const node=$(`#${id}`);node.innerHTML=`<header class="live-dialog-header"><div><h2 id="${id}-title">${h(title)}</h2>${description?`<p>${h(description)}</p>`:''}</div><button class="icon-button" data-close="${id}" aria-label="닫기">${icon('close')}</button></header><div class="live-detail-body live-scroll">${body}</div>`;
    if(!node.open)node.showModal();attachScroll();
  }
  const recordLines=(rows,emptyText='등록된 기록이 없습니다.')=>rows.length?`<div class="live-agenda">${rows.map(r=>`<div class="live-agenda-item"><span>${h(r.date||'날짜 미입력')}</span><div><strong>${h(r.title)}</strong><p class="live-pre">${h(r.text||'')}</p></div></div>`).join('')}</div>`:empty(emptyText,'');
  let absenceAsk=0;
  async function showAbsences(studentId,{attendanceId}={}){
    const ask=++absenceAsk;
    dialog('absence-detail','이번 달 결석 상세','결석 한 건마다 수업과 후속 기록을 확인합니다.','<p class="live-note" role="status">결석 기록을 불러오는 중입니다.</p>');
    try{
      const key=attendanceId?`attendance=${encodeURIComponent(attendanceId)}`:`student=${encodeURIComponent(studentId)}`;
      const response=await fetch(`/api/attendance-absences?${key}`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('load');
      const data=await response.json();
      if(ask!==absenceAsk||!$('#absence-detail')?.open)return;
      const rows=data.rows||[];
      const body=`<div class="live-drawer-summary"><strong>${h(rows.length)}건 결석</strong><p>${h(data.month)} · 정정 반영 출결 · 같은 날 반별 수업은 각각 표시</p></div>`+
        (rows.length?`<ol class="absence-list">${rows.map(r=>`<li class="absence-item"><div class="absence-item-head"><strong>${h(r.date)} · ${h(r.className||'반 미입력')}</strong><span>${h(r.time||'교시·시간 미입력')}</span></div><dl><dt>담당 선생님</dt><dd>${h(r.teacher||'기록 없음')}</dd><dt>사유·메모</dt><dd>${h(r.memo||'기록 없음')}</dd><dt>후속 처리</dt><dd>${h(r.followup||'후속 기록 없음')}</dd></dl>${r.classId?`<button type="button" class="button small" data-absence-day="${h(r.date)}" data-absence-class="${h(r.classId)}">2.0 출석부 그날 보기</button>`:''}</li>`).join('')}</ol>`:empty('이번 달 결석 기록이 없습니다.',''));
      dialog('absence-detail',`${data.student.name} · 이번 달 결석`,`${data.month} · ${rows.length}건`,body);
    }catch{if(ask===absenceAsk&&$('#absence-detail')?.open)dialog('absence-detail','이번 달 결석 상세','',`<p class="live-note">결석 기록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>`);}
  }
  const notesFor=context=>state.localNotes.filter(n=>n.context===context);
  const notePanel=context=>notesFor(context).length?panel('작성한 메모','새로고침하면 사라집니다.',recordLines(notesFor(context).map(n=>({date:shortDate(n.date),title:n.title,text:n.body})))):'';
  function showStudent(id){
    if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>showStudent(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}
    const s=byId('students',id);if(!s)return;state.studentId=id;
    const classRows=s.classes.map(id=>byId('classes',id)).filter(Boolean);
    const billRows=db.invoices.filter(i=>i.studentId===id&&i.period===db.meta.month).map(i=>`<details class="live-bill-mini"><summary>${h(i.billingName||'수납명 없음')} · 남은 금액 ${won(i.remaining)} · 상세 수납 보기</summary>${ws?.billingDetails(i.lines)||''}</details>`).join('');
    dialog('detail',s.name,`${s.school} · ${s.grade} · ${status(s.status)}`,
      `<div class="live-drawer-summary"><strong>${s.attendance.total?s.attendance.absent+'회 결석':'출결 기록 없음'}</strong><p>${mlabel(db.meta.month)} 전체 ${s.attendance.total}회 출결 기록 · 지각 ${s.attendance.late}회 · 보강 ${s.attendance.makeup}회</p></div><div class="flex">${button(`${icon('plus')} 후속 업무 등록`,'student-task','primary')}${button('검토 메모','student-note')}</div>`+
      panel('수강 중인 반','현재 수강 기준',classRows.length?`<div class="live-filter">${classRows.map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`:empty('수강 중인 반이 없습니다.',''))+
      panel('성적·진도 기록','점수는 시험별 만점과 함께 표시합니다.',recordLines(s.grades.map(g=>({date:shortDate(g.date),title:`${subject(g.subject)} · ${g.exam} ${g.score}/${g.max}`,text:''})),'등록된 성적 기록이 없습니다.')+recordLines(s.progress.map(p=>({date:shortDate(p.date),title:'진도 기록',text:p.content})),'등록된 진도 기록이 없습니다.'))+
      panel('수업보고서','최근 기록',recordLines(s.lessons.map(l=>({date:shortDate(l.date),title:`${subject(l.subject)} · ${l.teacher||'선생님 미입력'}`,text:l.progress})),'등록된 수업보고서가 없습니다.'))+
      panel('상담 기록',`후속 확인 ${s.followups}건`,recordLines(s.consultations.map(c=>({date:shortDate(c.date),title:c.category||'상담',text:[c.summary,c.followup?`후속 조치: ${c.followup}`:'',c.due?`${shortDate(c.due)} ${c.done?'완료':'후속 일정'}`:''].filter(Boolean).join('\n')})),'등록된 상담 기록이 없습니다.'))+
      panel(`${mlabel(db.meta.month)} 수납`,'이번 달 청구분',`<dl><dt>청구 금액</dt><dd>${won(s.billed)}</dd><dt>수납 금액</dt><dd>${won(s.paid)}</dd><dt>남은 금액</dt><dd>${won(s.remaining)}</dd></dl>${billRows}`)+notePanel(`student:${id}`));
  }
  function showClass(id){const c=byId('classes',id);if(!c)return;dialog('detail',c.name,`${subject(c.subject)} · ${c.teacher} · ${c.room}`,
    `<div class="live-drawer-summary"><strong>수강생 ${c.students.length}명</strong><p>강의실 정원 ${c.capacity??'미입력'}${c.capacity?'명':''} · 분리 등원이 있어 실제 동시 출석 인원과 다를 수 있습니다.</p></div>`+
    panel('주간 시간표','기준일 시간표',recordLines(c.schedules.map(s=>({date:'일월화수목금토'[s.day]+'요일',title:`${s.start}–${s.end}`,text:`${s.teacher} · ${s.room}`})),'등록된 시간표가 없습니다.'))+
    panel('수강생','원생을 누르면 원생 상세가 열립니다.',`<div class="live-filter">${c.students.map(id=>{const s=byId('students',id);return s?`<button class="button" data-student="${h(id)}">${h(s.name)}</button>`:'';}).join('')}</div>`)+
    panel(`${mlabel(db.meta.month)} 출결`,'입력된 출결 기록 기준',`<div class="live-big">${c.absent}<small>회 결석 / 전체 ${c.attendance}회 기록</small></div>`));}
  function showLead(id){const a=byId('admissions',id);if(!a)return;state.leadId=id;dialog('detail',`${a.name} · 신규 콜&상담`,`${a.school||'학교 미입력'} · ${a.grade||'학년 미입력'}`,
    `<div class="live-drawer-summary"><strong>${status(a.outcome)}</strong><p>${shortDate(a.date)} 접수 · ${h(a.teacher)} 담당${a.local?' · 변경됨(저장 안 됨)':''}</p></div><dl><dt>상담 과목</dt><dd>${h(subject(a.subject))}</dd><dt>유입 경로</dt><dd>${h(a.channel)}</dd><dt>후속 일정</dt><dd>${shortDate(a.followup)}</dd><dt>상담 메모</dt><dd>${h(a.note||a.reason||'입력된 메모가 없습니다.')}</dd></dl>`+
    `<div class="flex">${a.outcome!=='enrolled'?button('다음 단계로','advance-lead','primary'):badge('등록','teal')}${button('후속 메모','lead-note')}</div><p class="live-note">단계 변경은 저장되지 않고, 실제 원생 등록도 하지 않습니다.</p>`+notePanel(`lead:${id}`));}
  function showBill(id){if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>showBill(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}const i=byId('invoices',id);if(!i)return;state.billId=id;dialog('detail',`${i.name} · ${mlabel(i.period)} 수납`,status(i.status),
    `<div class="live-drawer-summary"><strong>${won(i.remaining)}</strong><p>남은 금액</p></div><dl><dt>할인 전 금액</dt><dd>${won(i.gross)}</dd><dt>할인</dt><dd>${won(i.discount)}</dd><dt>실제 청구 금액</dt><dd>${won(i.total)}</dd><dt>누적 수납</dt><dd>${won(i.paid)}</dd><dt>납부 기한</dt><dd>${i.due||'미입력'}</dd><dt>청구 구분</dt><dd>${i.category==='tuition'?'수강료':'기타'}</dd></dl>${ws?.billingDetails(i.lines)||''}<div class="flex"><button class="button" data-student="${h(i.studentId)}">원생 상세 보기</button>${button('수납 확인 메모','bill-note','primary')}</div>`+notePanel(`bill:${id}`));}
  function showStaff(id){const s=byId('staff',id);if(!s)return;dialog('detail',s.name,s.title,
    `<div class="live-drawer-summary"><strong>담임 반 ${s.classes.length}개</strong><p>이번 달 근무 기록 ${s.workDays}일 · 남은 업무 ${s.tasks}건</p></div>`+
    panel('담임 반','반을 누르면 수강생과 시간표가 열립니다.',`<div class="live-filter">${s.classes.map(id=>byId('classes',id)).filter(Boolean).map(c=>`<button class="button" data-class="${h(c.id)}">${h(c.name)}</button>`).join('')}</div>`)+
    panel('급여명세서','명세서 지급액은 실제 송금과 다를 수 있습니다.',recordLines(db.finance.payslips.filter(p=>p.userId===id).map(p=>({date:mlabel(p.period),title:status(p.status),text:p.net===null?'금액 미확정':`명세서 지급액 ${won(p.net)} · 지급 총액 ${won(p.gross)}`})),'등록된 명세서가 없습니다.'))+
    panel('계약 기록','기준일에 유효한 계약',recordLines(s.contracts.map(c=>({date:c.start||'시작일 미입력',title:c.end?`${c.end}까지`:'종료일 미입력',text:''})),'유효한 계약 기록이 없습니다.')));
  }
  function showMessage(id){const m=byId('messages',id);if(!m)return;state.messageId=id;dialog('detail',`${m.name} 보호자 메시지`,`${shortDate(m.date)} · ${m.category||'일반 대화'}`,
    `<div class="live-pre">${h(m.content||m.detail||'내용 없음')}</div><div class="flex"><button class="button" data-student="${h(m.studentId)}">원생 상세 보기</button>${button('답글 초안 작성','reply-draft','primary')}</div>`+
    panel('답글','저장된 답글',recordLines(m.replies.map(r=>({date:shortDate(r.date),title:r.author||'담당자',text:r.body})),'저장된 답글이 없습니다.'))+notePanel(`message:${id}`));}
  function showApproval(id){const a=byId('approvals',id);if(!a)return;state.approvalId=id;dialog('detail',a.title,`${a.drafter} · ${a.number||'결재 문서'}`,
    `<div class="live-drawer-summary"><strong>${status(a.status)}</strong>${a.local?'<p>이 화면에서 바꾼 상태입니다(저장 안 됨).</p>':''}</div>`+
    panel('결재선','결재 순서대로',recordLines(a.steps.map((s,i)=>({date:`${i+1}단계`,title:s.name,text:`${({approve:'승인',approved:'승인',reject:'반려',rejected:'반려',pending:'대기'}[s.decision]||'대기')} ${s.date?shortDate(s.date):''}${s.comment?'\n'+s.comment:''}`}))))+
    (a.note?`<p class="live-pre">${h(a.note)}</p>`:'')+(a.status==='pending'?`<div class="flex">${button('승인','approve','primary')}${button('반려 의견 작성','reject','danger')}</div><p class="live-note">승인·반려는 저장되지 않습니다.</p>`:'')+notePanel(`approval:${id}`));}
  function showTask(id){const t=byId('tasks',id);if(!t)return;state.taskId=id;const personal=t.kind==='owner_review'&&t.local,source=taskSourcePage(t.kind);dialog('detail',t.title,`${taskKind(t.kind)} · ${taskStatus(t)}`,
    `<p class="live-pre">${h(t.detail||'상세 내용이 없습니다.')}</p><dl><dt>담당</dt><dd>${h(t.owners.join(', ')||'담당 미지정')}</dd><dt>기한</dt><dd>${t.due||'미정'}</dd><dt>생긴 날짜</dt><dd>${t.opened||'미입력'}</dd>${t.closed?`<dt>닫힌 날짜</dt><dd>${h(t.closed)}</dd>`:''}</dl>${personal?`${button(t.status==='done'?'다시 열기':'처리됨으로 표시','complete-task','primary')}<p class="live-note">원장 개인 업무입니다. 새로고침하면 처리 상태가 처음으로 돌아갑니다.</p>`:`<div class="live-drawer-summary"><strong>자동 업무</strong><p>원본 기록이 처리되면 이 업무는 자동으로 닫힙니다. 버튼으로 완료 처리하지 않습니다.</p></div><div class="flex">${source?`<button class="button primary" data-go="${h(source)}">원본 기록 열기</button>`:''}${button('후속 요청 만들기','task-followup')}</div>`}`);}
  const RECORD_VIEWS=[['students',showStudent],['invoices',showBill],['approvals',showApproval],['tasks',showTask],['classes',id=>showClass(id)],['staff',id=>showStaff(id)],['admissions',id=>showLead(id)],['messages',id=>showMessage(id)],['textbooks',id=>showBook(id)],['documents',id=>showDocument(id)],['calendar',id=>showEvent(id)]];
  function canOpenRecord(id){return RECORD_VIEWS.some(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));}
  function openRecord(id){if(!fullReady){toast('상세 자료를 불러오는 중입니다.');ensureFull().then(()=>openRecord(id),()=>toast('상세 자료를 불러오지 못했습니다. 다시 시도해 주세요.'));return;}const hit=RECORD_VIEWS.find(([collection])=>db[collection]?.some(x=>String(x.id)===String(id)));if(hit)hit[1](String(id));}
  function showBook(id){const b=byId('textbooks',id);if(!b)return;dialog('detail',b.name,`${b.student} · ${status(b.status)}`,`<dl><dt>담당 선생님</dt><dd>${h(b.teacher||'미입력')}</dd><dt>교재 금액</dt><dd>${won(b.price)}</dd><dt>요청일</dt><dd>${b.date||'미입력'}</dd><dt>주문일</dt><dd>${b.ordered||'미입력'}</dd><dt>전달일</dt><dd>${b.delivered||'미입력'}</dd></dl>${b.studentId?`<button class="button" data-student="${h(b.studentId)}">원생 상세 보기</button>`:''}`);}
  function showDocument(id){const d=byId('documents',id);if(!d)return;dialog('detail',d.title,`${d.category||'일반 문서'} · ${shortDate(d.updated)} 갱신`,`${d.description?`<p class="live-pre">${h(d.description)}</p>`:''}${d.body?`<div class="live-pre">${h(d.body)}</div>`:''}${d.hasFile?`<button class="button primary" data-document-download="${h(id)}">첨부파일 다운로드</button>`:empty('첨부파일이 없는 문서입니다.','')}`);}
  function showEvent(id){const e=byId('calendar',id);if(!e)return;state.eventId=id;dialog('detail',e.title,`${e.date}${e.end&&e.end!==e.date?' ~ '+e.end:''}`,`<div class="live-drawer-summary"><strong>${h(e.start||'종일 일정')}</strong><p>${h(e.finish?e.finish+' 종료':'학원에 등록된 일정')}</p></div>${button('검토 메모','event-note','primary')}`+notePanel(`event:${id}`));}
  function previewForm(kind,title,context='',defaultTitle=''){
    state.noteContext=context;
    const fields=kind==='lead'?`<label>원생 이름<input name="name" required maxlength="60"></label><div class="live-split"><label>학년<input name="grade" placeholder="예: 초6" maxlength="20"></label><label>학교<input name="school" maxlength="60"></label></div><label>상담하고 싶은 내용<textarea name="body" required maxlength="2000"></textarea></label>`:kind==='task'?`<label>업무 제목<input name="title" required maxlength="160" value="${h(defaultTitle)}"></label><label>업무 내용<textarea name="body" maxlength="2000"></textarea></label><div class="live-split">${ownerField()}<label>기한<input type="date" name="due" value="${db.meta.asOf}"></label></div>`:`<label>제목<input name="title" required maxlength="160" value="${h(defaultTitle||title)}"></label><label>${kind==='message'?'전하고 싶은 내용':kind==='reject'?'반려 사유':'검토 내용'}<textarea name="body" required maxlength="4000"></textarea></label>${kind==='calendar'?`<label>날짜<input type="date" name="date" required value="${state.selectedDate}"></label>`:''}`;
    const node=$('#modal');node.innerHTML=`<header class="live-dialog-header"><div><h2 id="modal-title">${h(title)}</h2></div><button class="icon-button" data-close="modal" aria-label="닫기">${icon('close')}</button></header><form id="preview-form" class="live-form live-scroll" data-kind="${kind}">${fields}<p class="form-hint">저장·발송되지 않으며 새로고침하면 사라집니다.</p><button class="button primary" type="submit">${kind==='task'?'업무 추가':kind==='lead'?'상담 추가':'초안 저장'}</button></form>`;if(!node.open)node.showModal();attachScroll();node.querySelector('input')?.focus();
  }
  function showReport(){
    const month=state.page==='finance'?state.financeMonth:state.month,rows=db.invoices.filter(i=>i.period===month),leads=db.admissions.filter(a=>a.date.startsWith(month));
    dialog('modal',`${db.meta.tenant} · ${mlabel(month)} 경영 검토`,`${Number(db.meta.asOf.slice(5,7))}/${Number(db.meta.asOf.slice(8,10))} 기준`,
      `<div class="live-health-grid"><div>청구 대상<strong>${new Set(rows.map(r=>r.studentId)).size}명</strong></div><div>누적 수납<strong>${money(sum(rows,'paid'))}원</strong></div><div>남은 수납<strong>${money(sum(rows,'remaining'))}원</strong></div><div>접수 상담<strong>${leads.length}건</strong></div></div>${chart(recentTrend(),'payingStudents','명',{label:'청구 대상 원생'})}<p class="live-note">청구월별 누적 수납 기준입니다. 순이익이나 입금일 기준 현금 흐름이 아닙니다.</p><div class="flex">${button('월별 지표 CSV','export')}${button('검토 메모 남기기','report-note','primary')}</div>`);
  }
  function searchResults(){
    const q=state.search.trim().toLowerCase(),matched=(text)=>String(text).toLowerCase().includes(q);
    const menus=pages.filter(p=>matched(`${p[1]} ${pageAliases[p[0]]||''}`)),students=db.students.filter(s=>matched(`${s.name} ${s.school}`)).slice(0,10),classes=db.classes.filter(c=>matched(`${c.name} ${c.teacher}`)).slice(0,5),staff=db.staff.filter(s=>matched(s.name)).slice(0,5);
    const item=(attrs,title,note)=>`<button class="live-search-item" ${attrs}><span><strong>${h(title)}</strong><br><small>${h(note)}</small></span>${icon('chevron')}</button>`;
    return (q?ws?.searchItems(q)||[]:[]).map(w=>item(`data-go="${h(w.page)}"`,w.title,w.note)).join('')+menus.map(p=>item(`data-go="${p[0]}"`,p[1],'기록 화면')).join('')+students.map(s=>item(`data-search-student="${h(s.id)}"`,s.name,`${s.school} · ${status(s.status)}`)).join('')+classes.map(c=>item(`data-search-class="${h(c.id)}"`,c.name,c.teacher)).join('')+staff.map(s=>item(`data-search-staff="${h(s.id)}"`,s.name,s.title)).join('')||empty('검색 결과가 없습니다.');
  }
  function showSearch(){state.search='';const node=$('#modal');node.innerHTML=`<header class="live-dialog-header"><h2 id="modal-title">검색</h2><button class="icon-button" data-close="modal" aria-label="닫기">${icon('close')}</button></header><div class="live-form"><input id="global-search" aria-label="통합 검색" placeholder="원생, 학교, 수업, 선생님 검색" autocomplete="off"></div><div class="live-search-results live-scroll" id="search-results">${searchResults()}</div>`;if(!node.open)node.showModal();$('#global-search').focus();attachScroll();}

  const views={home,students,admissions,classes,learning,finance,staff,parents,shuttle,approvals,resources,calendar,settings,inbox:ax.inbox,requests:ax.requests,automation:ax.automation,...(flowUI?{flow:()=>flowUI.fullView()}:{})};
  // 업무 흐름과 작업 공간은 첫 자료의 집계·미리보기와 각 영역의 기록 GET으로 그린다.
  // 원생·청구 등 옛 상세 화면을 열 때에만 전체 상세를 읽는다.
  const teacherRoute=page=>page.startsWith('v2-teacher-home')||/^v2-(?:ecs|onescreen|lesson-reports)\?/.test(page)&&new URLSearchParams(page.split('?')[1]||'').get('teacherHome')==='1';
  const needsFull=page=>page!=='home'&&page!=='flow'&&!page.startsWith('workspace-')&&!teacherRoute(page);
  function render(){
    document.body.classList.toggle('teacher-mode',teacherRoute(state.page)&&!state.page.startsWith('v2-teacher-home'));
    if(state.page&&needsFull(state.page)&&!fullReady){shell();ax.decorateShell();$('#main').innerHTML='<p class="live-note" role="status">상세 자료를 불러오는 중입니다.</p>';ensureFull().then(()=>render(),()=>{$('#main').innerHTML='<p class="live-note" role="alert">상세 자료를 불러오지 못했습니다. 화면을 다시 열어 주세요.</p>';});return;}
    clearSpotlight();
    const focused=document.activeElement,focusId=focused?.id,selection=typeof focused?.selectionStart==='number'?focused.selectionStart:null;
    const navHref=focused?.closest('#sidebar')&&focused.getAttribute('href');
    const scrollPositions=new Map([...document.querySelectorAll('[data-scroll-key]')].map(n=>[n.dataset.scrollKey,[n.scrollTop,n.scrollLeft]]));
    hideTip();scrollObserver.disconnect();shell();ax.decorateShell();$('#main').innerHTML=PEEK&&!viewFor(state.page)?'':state.page==='home'?ax.home():(viewFor(state.page)||home)();ax.decorateView();
    document.querySelectorAll('[data-scroll-key]').forEach(n=>{const kept=scrollPositions.get(n.dataset.scrollKey);if(kept)[n.scrollTop,n.scrollLeft]=kept;});attachScroll();
    if(focusId){const next=document.getElementById(focusId);next?.focus({preventScroll:true});if(selection!==null&&next?.setSelectionRange)next.setSelectionRange(selection,selection);}
    if(navHref)document.querySelector(`#sidebar a[href="${CSS.escape(navHref)}"]`)?.focus({preventScroll:true});
    syncMenu();
    if(PEEK)dispatchEvent(new CustomEvent('aywa:render',{detail:{page:state.page}}));
  }
  // Off-canvas menu on phones: hidden links leave the tab order, focus moves in on open and back on Escape.
  function syncMenu(){const open=document.body.classList.contains('menu-open');$('#sidebar').inert=mobileNav.matches&&!open;$('[data-action="menu"]')?.setAttribute('aria-expanded',String(open));}
  function closeMenu(returnFocus){const wasOpen=document.body.classList.contains('menu-open');document.body.classList.remove('menu-open');syncMenu();if(wasOpen&&returnFocus)$('[data-action="menu"]')?.focus();}
  mobileNav.addEventListener('change',syncMenu);
  function navigate(page){if(!viewFor(page))return;document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);if(location.hash===`#${page}`){state.page=page;render();}else location.hash=page;}
  function showNotes(){dialog('modal','검토 메모와 안내 초안',`${state.localNotes.length}건 · 새로고침하면 사라집니다.`,recordLines(state.localNotes.map(n=>({date:shortDate(n.date),title:n.title,text:n.body})),'아직 작성한 검토 메모가 없습니다.'));}
  function exportMetrics(){
    const rows=[['청구월','청구 대상 원생','청구액','기준일 누적 수납액','남은 수납액','접수 상담'],...db.trend.map(t=>[t.month,t.payingStudents,t.billed,t.paid,t.remaining,t.inquiries])];
    const cell=value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`침산_월별지표_${db.meta.asOf}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('월별 지표를 CSV로 저장했습니다.');
  }
  const actions={
    menu:()=>{document.body.classList.add('menu-open');syncMenu();($('#sidebar .nav-item.active')||$('#sidebar a'))?.focus();},
    'close-menu':()=>closeMenu(true),
    search:showSearch,report:showReport,export:exportMetrics,notes:showNotes,
    'new-task':()=>previewForm('task','검토 업무 추가'),
    'student-task':()=>previewForm('task','원생 후속 업무',`student:${state.studentId}`,`${byId('students',state.studentId)?.name||'원생'} 후속 확인`),
    'student-note':()=>previewForm('note','원생 검토 메모',`student:${state.studentId}`),
    'new-lead':()=>previewForm('lead','신규 콜&상담 작성'),
    'lead-note':()=>previewForm('note','상담 후속 메모',`lead:${state.leadId}`),
    'bill-note':()=>previewForm('note','수납 확인 메모',`bill:${state.billId}`),
    'message-draft':()=>previewForm('message','학부모 안내 초안','general'),
    'reply-draft':()=>previewForm('message','학부모 답글 초안',`message:${state.messageId}`,`${byId('messages',state.messageId)?.name||'원생'} 보호자 답글`),
    'event-note':()=>previewForm('note','일정 검토 메모',`event:${state.eventId}`),
    'calendar-note':()=>previewForm('calendar','일정 메모','calendar'),
    'report-note':()=>previewForm('note','월간 경영 검토',`report:${state.month}`),
    today:()=>{state.calendarMonth=db.meta.month;state.selectedDate=db.meta.asOf;render();},
    'advance-lead':()=>{const a=byId('admissions',state.leadId);if(!a||a.outcome==='enrolled')return;const next=a.outcome==='scheduled'?'consulted':a.outcome==='consulted'||a.outcome==='ai_done'?'enrolled':'scheduled';a.outcome=next;a.local=true;if(next==='enrolled'){const t=db.trend.find(t=>a.date.startsWith(t.month));if(t)t.registered++;}render();showLead(a.id);toast('상담 단계를 바꿨습니다. 저장되지는 않습니다.');},
    approve:()=>{const a=byId('approvals',state.approvalId);if(!a)return;a.status='approved';a.local=true;a.steps.forEach(s=>{if(!['approve','approved'].includes(s.decision)){s.decision='approve';s.date=db.meta.asOf;}});render();showApproval(a.id);toast('승인했습니다. 저장되지는 않습니다.');},
    reject:()=>previewForm('reject','반려 의견',`approval:${state.approvalId}`),
    'task-followup':()=>{const t=byId('tasks',state.taskId);if(!t)return;const [family]=TASK_SOURCE[t.kind]||[];$('#detail').close();ax.showRequest({title:`${t.title} 후속 확인`,body:`${taskKind(t.kind)} 업무가 아직 끝나지 않았습니다(${t.detail||t.title}). 원본 기록을 처리했는지 확인하고, 처리하지 못한 이유와 예정일을 보고해 주세요.`,source:'task',draftKey:`task:${t.id}`,context:family?{family,familyLabel:ws?.area(family)?.label||taskKind(t.kind),records:[{id:t.id,label:t.title}],task:t.id}:{task:t.id,records:[{id:t.id,label:t.title}]}});},
    'complete-task':()=>{const t=byId('tasks',state.taskId);if(!t||!(t.kind==='owner_review'&&t.local))return;t.status=t.status==='done'?'open':'done';t.local=true;render();showTask(t.id);toast('업무 상태를 바꿨습니다.');},
    'save-name':()=>{const name=$('#academy-name')?.value.trim();if(!name){toast('학원 표시 이름을 입력해 주세요.');return;}db.meta.tenant=name.slice(0,40);render();toast('표시 이름을 바꿨습니다.');},
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
    if(d.month){state.month=d.month;render();return;}
    if(d.filter!==undefined&&d.key){state[d.key]=d.filter;state.studentPage=0;state.classPage=0;state.taskPage=0;if(['vehicle','season'].includes(d.key))state.run=null;render();return;}
    if(d.pageKey){state[d.pageKey]=Math.max(0,Number(d.page));render();return;}
    if(d.approvalStatus){state.approvalStatus=state.approvalStatus===d.approvalStatus?null:d.approvalStatus;render();return;}
    if(d.bookStatus){state.bookStatus=state.bookStatus===d.bookStatus?null:d.bookStatus;render();return;}
    if(d.day){state.selectedDate=d.day;render();return;}
    if(d.calendarMove){const dt=new Date(`${state.calendarMonth}-01T12:00:00`);dt.setMonth(dt.getMonth()+Number(d.calendarMove));const next=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;if(next<db.trend[0].month||next>`${Number(db.meta.month.slice(0,4))+1}-12`){toast('볼 수 있는 기간을 벗어났습니다.');return;}state.calendarMonth=next;state.selectedDate=next+'-01';render();}
  });
  function onTextInput(event){
    if(event.isComposing)return;
    const el=event.target;
    if(el.id==='global-search'){state.search=el.value;$('#search-results').innerHTML=searchResults();fade($('#search-results'));}
    if(el.id==='student-search'&&state.studentQuery!==el.value){state.studentQuery=el.value;state.studentPage=0;render();}
    if(el.id==='document-search'&&state.documentQuery!==el.value){state.documentQuery=el.value;render();}
  }
  document.addEventListener('input',onTextInput);document.addEventListener('compositionend',onTextInput);
  document.addEventListener('change',event=>{const el=event.target;if(el.dataset.period){state[el.dataset.period]=el.matches('[data-cpick]')?(el.querySelector('input[type=hidden]')?.value||state[el.dataset.period]):el.value;state.financePage=0;render();}if(el.id==='shuttle-date'){state.selectedDate=el.value||db.meta.asOf;render();}});
  document.addEventListener('submit',event=>{
    if(event.target.id!=='preview-form')return;event.preventDefault();const form=event.target;if(!form.reportValidity())return;
    const values=new FormData(form),kind=form.dataset.kind,id=`local-${crypto.randomUUID()}`,context=state.noteContext;
    const title=String(values.get('title')||'').trim(),body=String(values.get('body')||'').trim();
    if(kind==='task'){
      db.tasks.unshift({id,title,detail:body,status:'open',kind:'owner_review',opened:db.meta.asOf,due:String(values.get('due')||''),owners:[String(values.get('owner')||'원장')],local:true});
      $('#modal').close();render();showTask(id);toast('검토 업무를 추가했습니다.');return;
    }
    if(kind==='lead'){
      const name=String(values.get('name')||'').trim();db.admissions.unshift({id,name,grade:String(values.get('grade')||''),school:String(values.get('school')||''),outcome:'scheduled',date:db.meta.asOf,note:body,teacher:'원장',channel:'직접 입력',local:true});current().inquiries++;state.month=db.meta.month;state.admissionFilter='all';$('#modal').close();render();showLead(id);toast('새 상담을 추가했습니다.');return;
    }
    state.localNotes.push({id,title,body,context,date:db.meta.asOf,kind});$('#modal').close();
    if(kind==='calendar'){const date=String(values.get('date'));db.calendar.push({id,title,date,end:date,start:'',finish:'',local:true});state.calendarMonth=date.slice(0,7);state.selectedDate=date;render();showEvent(id);toast('일정 메모를 추가했습니다.');return;}
    if(kind==='reject'){const a=byId('approvals',state.approvalId);a.status='rejected';a.note=body;a.local=true;render();showApproval(a.id);toast('반려 의견을 반영했습니다. 저장되지는 않습니다.');return;}
    render();
    if(context.startsWith('student:'))showStudent(context.slice(8));else if(context.startsWith('lead:'))showLead(context.slice(5));else if(context.startsWith('message:'))showMessage(context.slice(8));else if(context.startsWith('bill:'))showBill(context.slice(5));else if(context.startsWith('event:'))showEvent(context.slice(6));else showNotes();
    toast('초안을 남겼습니다. 새로고침하면 사라집니다.');
  });
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();showSearch();}if(event.key==='Escape')actions['close-menu']();});
  window.addEventListener('hashchange',()=>{state.page=location.hash.slice(1)||'home';if(!viewFor(state.page))state.page=PEEK?'':'home';document.querySelectorAll('dialog[open]').forEach(d=>d.close());closeMenu(false);render();window.scrollTo(0,0);});
  /* 저장 뒤 자료 갱신(Codex 검수 10-28 AX-H2): 2.0 화면이 복사본에 저장하면 서버가 첫 화면 자료를 다시 만들고 개정 번호를 올린다
     (GET /api/data-revision). 보이는 동안 30초마다·창에 포커스가 올 때 묻고, 바뀌었으면 /snapshot.json을 받아 같은 db 객체를 제자리에서
     채운 뒤 다시 그린다(ax·작업 공간·업무 흐름 부품이 이 db 참조를 쥐고 있다). 열린 창·입력 칸·2.0 부품(iframe) 안에 있으면 끝날 때까지
     미룬다. 이 화면에서 만든 미리보기 기록(local)은 남긴다. 2.0 화면 캐시는 V2Screens.dataChanged가 다시 읽는다. */
  const fresh={revision:window.AcademySnapshotRevision?.revision||0,etag:window.AcademySnapshotRevision?.etag||'',next:null,busy:false,at:0};
  // 쓰다 만 칸(포커스는 떠났어도 값이 처음과 다름)도 다시 그리면 지워진다 — 그런 칸이 본문에 있으면 미룬다.
  const dirty=el=>el.type==='checkbox'||el.type==='radio'?el.checked!==el.defaultChecked:el.tagName==='SELECT'?[...el.options].some(o=>o.selected!==o.defaultSelected):!['hidden','button','submit','reset','file'].includes(el.type)&&el.value!==el.defaultValue;
  const busyHere=()=>{const a=document.activeElement;return Boolean(document.querySelector('dialog[open]'))||Boolean(a&&a!==document.body&&(a.isContentEditable||/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(a.tagName)))||[...document.querySelectorAll('#main input,#main textarea,#main select')].some(dirty);};
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function refill(target,next,top){
    for(const k of Object.keys(target))if(!(k in next))delete target[k];
    for(const [k,v] of Object.entries(next)){
      const old=target[k];
      if(Array.isArray(v)&&Array.isArray(old)){const local=top?new Map(old.filter(x=>x?.local&&x.id).map(x=>[x.id,x])):null;const list=local?.size?[...[...local.values()].filter(x=>!v.some(y=>y?.id===x.id)),...v.map(y=>local.get(y?.id)||y)]:v;old.length=0;for(const x of list)old.push(x);}
      else if(plain(v)&&plain(old))refill(old,v,false);else target[k]=v;
    }
  }
  function applyFresh(){
    if(!fresh.next||busyHere())return;
    const {data,revision,etag}=fresh.next;fresh.next=null;
    if(data){refill(db,data,true);fullReady=true;fresh.etag=etag;const y=window.scrollY;render();window.scrollTo({top:y,behavior:'instant'});}
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
  state.page=location.hash.slice(1)||'home';if(!viewFor(state.page))state.page=PEEK?'':'home';render();document.fonts.ready.then(()=>document.querySelectorAll('.nav-scroll,.live-scroll').forEach(fade));
})();
