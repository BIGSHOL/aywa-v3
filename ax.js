/* Local AX prototype — 3.0 structure (signal → issue → request → report) in the 2.0 type and control format.
   Facts come from the verified local copy. Requests, reports and Slack previews stay in this tab only.
   The single network call is the assistant: POST /api/assistant, answered by the local backend (Claude CLI).
   No canned answer is ever shown in its place; failures are reported and can be retried. */
window.createOwnerWorkspace = function createOwnerWorkspace(api) {
  'use strict';
  const {db,h,fmt,won,icon,dialog,navigate,render,toast}=api;
  const $=s=>document.querySelector(s);
  const current=()=>db.trend.find(t=>t.month===db.meta.month);
  const total=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
  const staffById=new Map(db.staff.map(s=>[s.id,s]));
  const ui={recRefs:new Map(),filter:'all',inbox:'unread',read:new Set(),reportRead:new Set(),archived:new Set(),expanded:new Set(),requests:[],drafts:new Map(),requestArgs:null,focusIssue:null,homePrompt:'',rule:true,slack:true,app:true};
  const chat={turns:[],context:null,topic:'',pending:null};
  let workspaces=null,flowUI=null;
  // Requests come from the durable flow store when the server provides it; otherwise from this tab (session only).
  const reqs=()=>flowUI?.ready()?flowUI.asRequests():ui.requests;
  const flowRole=()=>flowUI?.ready()?flowUI.role():'owner';
  const contexts=new Map();
  // Source context of a request (workspace family, records, signal/action, auto task). Kept by draft key, copied onto the request.
  const cleanContext=c=>c&&typeof c==='object'?{family:String(c.family||''),familyLabel:String(c.familyLabel||''),records:(Array.isArray(c.records)?c.records:[]).slice(0,20).map(r=>({id:String(r.id),label:String(r.label||'')})),signal:String(c.signal||''),action:String(c.action||''),task:String(c.task||''),
    ...(c.card?{card:{metric:String(c.card.metric||''),factIds:(Array.isArray(c.card.factIds)?c.card.factIds:[]).slice(0,6).map(String),refs:(Array.isArray(c.card.refs)?c.card.refs:[]).slice(0,100).map(r=>({type:String(r.type||''),id:String(r.id||'')}))}}:{})}:null;
  const sourcePage=c=>c?.family&&workspaces?.has(c.family)?`workspace-${c.family}`:'';
  // Limits mirror the backend contract (prompt ≤1000, history ≤12 items, each ≤2000, total ≤8000, server timeout 90s).
  const ASSISTANT={endpoint:'/api/assistant',promptLimit:1000,historyItems:12,historyItemLimit:2000,historyTotal:8000,timeoutMs:120000};
  const RECORDS_SHOWN=8;
  // 이슈 기록 종류 → 업무 흐름 기록(종류 · 업무 영역). 같은 id로 그 영역의 기록 한 건을 읽는다.
  const REC_REF={student:['student','students'],lead:['lead','enrollment'],bill:['invoice','billing'],approval:['approval','approvals'],task:['task','tasks-notifications'],book:['textbook_order','textbook-requests']};
  const SIGNAL_ORDER=['approval','billing','tasks','admissions','attendance','books','enrollment'];
  const FILTERS=[['all','전체',null],['decide','결정 필요','결정 필요'],['check','확인 필요','확인 필요'],['progress','진행 확인','진행 확인'],['change','변화','변화 감지']];
  const STATUS={requested:'확인 대기',working:'진행 중',done:'완료 보고'};
  const PROVIDERS={'claude-cli':'AI 답변'};
  const labels={home:'브리핑',flow:'업무 흐름',inbox:'알림',requests:'요청한 업무',automation:'자동화',students:'원생목록',admissions:'신규 콜&상담',classes:'수업목록 · 시간표',learning:'성적관리 · 수업보고서',finance:'수납관리',staff:'직원관리',parents:'학부모 소통',shuttle:'셔틀',approvals:'전자결재 · 업무',resources:'교재 요청 · 재고관리 · 데이터베이스',calendar:'캘린더',settings:'학원 설정'};
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const button=(text,action,id='',primary=false,attrs='')=>`<button type="button" class="button ${primary?'primary':''}" data-ax="${action}" data-id="${h(id)}" ${attrs}>${h(text)}</button>`;
  // AI 업무 지원 답 그리기(ax-chat.js) — 서식·근거 미주·바로 가기·요청안. 없으면 예전처럼 평문으로 그린다.
  const axChat=window.createAxChat?.({h,pill,button,toast,navigate,workspaces:()=>workspaces,basis:t=>`${t.context?`이슈 ${findIssue(t.context)?.title||'선택한 이슈'}`:'원장실 전체'} · ${db.meta.month} 업무 자료 · 기준일 ${db.meta.asOf}`})||null;
  const caption=`${Number(db.meta.asOf.slice(5,7))}/${Number(db.meta.asOf.slice(8,10))} 기준`;
  const names=ids=>ids.map(id=>staffById.get(id)?.name||'담당자').join(', ');
  const clip=(text,limit)=>String(text??'').slice(0,limit);
  const norm=text=>String(text??'').toLowerCase().replace(/\s+/g,'');
  const attendanceRows={html:'',pending:null,error:'',seq:0};
  const schoolGrade=s=>{const school=String(s?.school||''),grade=String(s?.grade||''),m=/^([초중고])(\d)$/.exec(grade);return m&&school.endsWith(m[1])?`${school}${m[2]}`:[school,grade].filter(Boolean).join(' ');};
  function attendanceTable(root,classRecords=[]){
    const people=new Map(),students=new Map(db.students.map(s=>[String(s.id),s])),classes=new Map([...(db.workspaces?.families?.classes?.records||[]),...classRecords].map(r=>[String(r.id),r]));
    for(const teacher of root.children||[])for(const cls of teacher.children||[])for(const node of cls.children||[]){
      const count=Number(node.facts?.absencesInClass||0),id=String(node.entityRef?.id||'');if(!count||!id)continue;
      if(!people.has(id))people.set(id,{id,name:node.label,student:students.get(id),all:Number(node.facts?.absencesAllClasses||0),classes:[]});
      people.get(id).classes.push({id:String(cls.entityRef?.id||''),name:cls.label,subject:classes.get(String(cls.entityRef?.id||''))?.subject||'과목 미지정',teacher:teacher.label||'담임 미지정',count});
    }
    const list=[...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    const rows=list.flatMap(p=>p.classes.sort((a,b)=>a.name.localeCompare(b.name,'ko')).map((c,i)=>`<tr><td>${h(c.subject)}</td>${i?'':`<th scope="row" rowspan="${p.classes.length}"><button type="button" class="button" data-ax="record" data-type="student" data-id="${h(p.id)}">${h(p.name)}</button><small class="ax-attendance-total">전체 ${fmt(p.all||p.classes.reduce((n,x)=>n+x.count,0))}회</small></th><td rowspan="${p.classes.length}">${h(schoolGrade(p.student))}</td><td rowspan="${p.classes.length}">재원</td>`}<td>${h(c.name)}</td><td>${h(c.teacher)}</td><td class="al-r">${fmt(c.count)}회</td>${i?'':`<td rowspan="${p.classes.length}" class="al-r">${p.student?.remaining>0?won(p.student.remaining):'—'}</td>`}</tr>`)).join('');
    return `<p class="ax-note">이번 달 결석한 반만 표시합니다. 한 원생이 여러 반에서 결석했다면 반마다 한 줄입니다.</p><table class="fl-rectable ax-attendance-table"><thead><tr><th scope="col">과목</th><th scope="col">이름</th><th scope="col">학교·학년</th><th scope="col">상태</th><th scope="col">반</th><th scope="col">담임</th><th scope="col" class="al-r">결석</th><th scope="col" class="al-r">이번 달 미납</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function fillAttendanceTable(){
    const targets=()=>document.querySelectorAll('[data-ax-attendance]');if(!targets().length)return;
    if(attendanceRows.html){let changed=false;targets().forEach(el=>{if(el.dataset.loaded==='1')return;el.innerHTML=attendanceRows.html;el.dataset.loaded='1';changed=true;});if(changed)api.attachScroll?.();return;}
    if(attendanceRows.pending)return;
    const seq=++attendanceRows.seq;
    attendanceRows.pending=fetch('/api/flow/hierarchy?caseId=src-sig-attendance-attendance-repeat-absence',{headers:{Accept:'application/json'}})
      .then(async res=>{if(!res.ok)throw new Error('hierarchy');const data=await res.json();if(!data?.root)throw new Error('shape');
        const ids=[...new Set((data.root.children||[]).flatMap(t=>(t.children||[]).map(c=>String(c.entityRef?.id||'')).filter(Boolean)))];
        const lookup=ids.length?await fetch(`/api/workspaces/classes/records?ids=${ids.map(encodeURIComponent).join(',')}`,{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null):null;
        if(seq!==attendanceRows.seq)return;attendanceRows.html=attendanceTable(data.root,Array.isArray(lookup?.items)?lookup.items:[]);targets().forEach(el=>{el.innerHTML=attendanceRows.html;el.dataset.loaded='1';});api.attachScroll?.();})
      .catch(()=>{if(seq!==attendanceRows.seq)return;attendanceRows.error='반별 결석 기록을 불러오지 못했습니다.';targets().forEach(el=>{el.textContent=attendanceRows.error;});})
      .finally(()=>{if(seq===attendanceRows.seq)attendanceRows.pending=null;});
  }
  window.addEventListener('aywa:data-revision',()=>{attendanceRows.seq++;attendanceRows.html='';attendanceRows.error='';attendanceRows.pending=null;document.querySelectorAll('[data-ax-attendance]').forEach(el=>{el.textContent='반별 결석 기록을 불러오는 중입니다.';delete el.dataset.loaded;});fillAttendanceTable();});

  function issues(){
    const now=current(),prev=db.trend.find(t=>t.month===db.trend.at(-2).month),delta=now.payingStudents-prev.payingStudents;
    const bills=db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0);
    const leads=db.admissions.filter(a=>a.date.startsWith(db.meta.month)&&['scheduled','consulted','ai_done'].includes(a.outcome));
    const absent=db.students.filter(s=>s.status==='enrolled'&&s.attendance.absent>=3).sort((a,b)=>b.attendance.absent-a.attendance.absent);
    const pending=db.approvals.filter(a=>a.status==='pending');
    const overdue=db.tasks.filter(t=>t.status==='open'&&t.due&&t.due<db.meta.asOf&&!t.local);
    const books=db.textbooks.filter(t=>['requested','ordered'].includes(t.status));
    const items=[
      {id:'billing',category:'수납',title:`남은 수납 ${bills.length}건`,signal:'남은 수납',note:`${bills.length}건 · ${api.yymm(db.meta.month)} 청구분`,summary:`${won(total(bills,'remaining'))}이 남아 있습니다. 납부 확인 후 필요한 가정에만 안내해 주세요.`,value:won(total(bills,'remaining')),priority:'확인 필요',page:'finance',count:bills.length,source:'수납관리 · 청구·할인·수납 기록',facts:[`${api.yymm(db.meta.month)} 청구분의 현재 잔액입니다.`,`할인 ${won(total(bills,'discount'))}을 반영하고 무효·환불은 제외했습니다.`,`완납 기록은 요청 대상에 포함하지 않습니다.`],records:bills.map(i=>({id:i.id,type:'bill',name:i.name,detail:won(i.remaining)})),unit:'건',request:'수납 잔액 확인 및 후속 안내',suggestion:'대상별 납부 내역을 확인해 주세요. 이미 납부한 건은 먼저 대조하고, 안내가 필요한 경우 보호자에게 연락한 뒤 결과를 남겨 주세요.'},
      {id:'admissions',category:'상담',title:`상담·검토 중 ${leads.length}건`,signal:'상담 후속',note:`이번 달 접수 ${now.inquiries}건 중 상담·검토 상태`,summary:`이번 달 접수 ${now.inquiries}건 중 상담·검토 상태인 ${leads.length}건의 다음 약속을 확인해 주세요.`,value:`${leads.length}건`,priority:'확인 필요',page:'admissions',count:leads.length,source:'신규 콜&상담 · 접수월과 현재 결과',facts:['접수월이 이번 달인 상담만 포함합니다.',`현재 등록 상태인 ${now.registered}건은 제외했습니다.`,'연락 기한이 지났다는 뜻은 아닙니다. 다음 약속 유무를 확인하는 요청입니다.'],records:leads.map(a=>({id:a.id,type:'lead',name:a.name,detail:a.teacher})),unit:'건',request:'상담 후속 일정 확인',suggestion:'상담 내용과 다음 약속을 확인하고, 추가 연락이 필요한 원생의 상담 일정을 정리해 주세요. 등록 여부가 바뀐 경우 함께 보고해 주세요.'},
      {id:'attendance',category:'출결',title:`이번 달 결석 3회 이상 ${absent.length}명`,signal:'결석 3회 이상',note:'이번 달 · 재원생',summary:'결석 사유와 보강 계획을 담임에게 확인해 주세요.',value:`${absent.length}명`,priority:'확인 필요',page:'students',count:absent.length,source:'출석부 · 수정 반영 후 유효한 출결 기록',facts:['재원 상태인 원생만 셉니다.','결석은 수업마다 따로 셉니다. 연속으로 빠진 날 수가 아닙니다.','이 목록에는 결석 사유가 없습니다. 사유는 담임에게 확인해야 합니다.'],records:absent.map(s=>({id:s.id,type:'student',name:s.name,detail:`결석 ${s.attendance.absent}회 / 출결 ${s.attendance.total}회`})),unit:'명',request:'결석 사유 및 보강 계획 확인',suggestion:'대상 원생의 결석 사유와 보호자 연락 여부를 확인해 주세요. 보강이 필요한 경우 가능한 일정과 후속 계획을 함께 보고해 주세요.'},
      {id:'approval',category:'결재',title:`결재 대기 ${pending.length}건`,signal:'결재 대기',note:pending[0]?`${String(pending[0].title).split(' — ')[0]} · ${pending[0].drafter}${pending.length>1?` 외 ${pending.length-1}건`:''}`:'',summary:'결재 문서와 결재선을 확인하고, 필요한 보완 내용을 담당자에게 요청하세요.',value:`${pending.length}건`,priority:'결정 필요',page:'approvals',count:pending.length,source:'전자결재 · 대기 상태 문서',facts:['현재 결재 대기 상태인 문서입니다.','결재는 원장이 직접 합니다. 업무 요청은 담당자에게 보완을 맡길 때 씁니다.'],records:pending.map(a=>({id:a.id,type:'approval',name:a.title,detail:a.drafter})),unit:'건',request:'결재 문서 검토 및 보완',suggestion:'결재 문서의 내용과 첨부 근거를 확인하고, 보완할 사항이 있으면 정리해서 보고해 주세요.'},
      {id:'tasks',category:'업무',title:`지난 자동 업무 ${overdue.length}건`,signal:'지난 업무',note:'원본 기록이 아직 처리되지 않음',summary:'담당자가 원본 기록을 처리했는지 확인해 주세요. 처리되면 저절로 닫힙니다.',value:`${overdue.length}건`,priority:'확인 필요',page:'approvals',count:overdue.length,source:'업무 · 자동 생성·자동 종료 기록',facts:['등록된 기한이 기준일보다 이전이고 아직 끝나지 않은 자동 업무입니다.','자동 업무는 버튼으로 닫지 않습니다. 결석 확인·영상 배정·보고서 발송 같은 원본 기록이 처리되면 닫힙니다.','원장 개인 업무는 포함하지 않습니다.'],records:overdue.map(t=>({id:t.id,type:'task',name:t.title,detail:t.owners.join(', ')||'담당 미지정'})),unit:'건',request:'지난 자동 업무의 원본 기록 확인',suggestion:'원본 기록의 처리 상황과 처리 예정일을 알려 주세요. 이미 처리했는데 업무가 남아 있다면 어떤 기록인지 함께 알려 주세요.'},
      {id:'books',category:'교재',title:`전달 전 교재 ${books.length}건`,signal:'교재 진행',note:'요청·주문 상태',summary:'주문과 전달 여부를 확인해 주세요.',value:`${books.length}건`,priority:'진행 확인',page:'resources',count:books.length,source:'교재 요청 · 주문·전달 상태',facts:['교재 기록에 전달 기한이 없어 늦었는지는 알 수 없습니다.'],records:books.map(t=>({id:t.id,type:'book',name:t.name,detail:t.student})),unit:'건',request:'교재 주문 및 전달 확인',suggestion:'요청·주문 상태인 교재의 주문 내역과 전달 여부를 확인하고, 미전달 사유가 있으면 알려 주세요.'},
      {id:'enrollment',category:'경영',title:`청구 대상 ${Math.abs(delta)}명 ${delta<0?'감소':delta>0?'증가':'유지'}`,signal:'청구 대상 변화',note:`지난달 ${prev.payingStudents}명 → 이번 달 ${now.payingStudents}명`,summary:`지난달 ${prev.payingStudents}명에서 이번 달 ${now.payingStudents}명으로 변했습니다. 원생 상태와 수강 변동을 함께 확인해 주세요.`,value:`${delta>0?'+':''}${delta}명`,priority:'변화 감지',page:'students',count:Math.abs(delta),source:'수납관리 · 월별 고유 수강료 청구 대상',facts:['그 달 수강료 청구가 있는 원생 수입니다. 현재 재원 수와 다릅니다.','늘거나 준 인원이 곧 신규·퇴원 인원은 아닙니다.','원인은 두 달의 수강·청구 기록을 대조해야 알 수 있습니다.'],records:[],unit:'명',request:'청구 대상 변동 원인 확인',suggestion:'지난달과 이번 달의 수강료 청구 대상을 대조해 주세요. 신규·휴원·퇴원·청구 누락 등 확인된 사유를 구분해 보고해 주세요.'},
    ];
    return items.filter(i=>i.count>0).sort((a,b)=>SIGNAL_ORDER.indexOf(a.id)-SIGNAL_ORDER.indexOf(b.id));
  }
  const findIssue=id=>issues().find(i=>i.id===id);
  const requestsFor=id=>reqs().filter(r=>r.issues.includes(id));
  const issueState=id=>{const rs=requestsFor(id);return rs.some(r=>r.status!=='done')?'처리 중':rs.length?'결과 도착':ui.read.has(id)?'확인함':'미확인';};
  const unreadReports=()=>reqs().filter(r=>r.status==='done'&&!ui.reportRead.has(r.id));
  const unread=()=>issues().filter(i=>!ui.read.has(i.id)&&!ui.archived.has(i.id)).length+unreadReports().length;

  /* ---------- Briefing: first screen = critical signals, compact change, command. Detail follows by page scroll. ---------- */
  // Trend line from the shared chart helper (hover/touch/arrow keys show each month's exact value).
  // 짧은 고르기도 공용 선택창 하나로(원장 10-28 "모든 드랍다운에서 이렇게 정렬된 드랍다운 서식이 일치될 수 있도록"). 선택창을 못 그리면 기존 칸 그대로.
  const choicePicker=(c,fallback)=>{const CP=window.ContextPicker;if(!CP)return fallback;try{return CP.html({id:c.id,name:c.name,label:c.label,required:c.required,clearable:false,selected:[c.selected].filter(Boolean),attrs:c.attrs,...CP.lists.choices({items:c.items,columns:c.columns})});}catch{return fallback;}};
  const spark=(rows,key,label,value)=>`<span class="ax-trend">${api.lineChart(rows,{key,label,value,basis:'청구월 기준'})}<span class="ax-trend-months" aria-hidden="true">${rows.map(r=>`<span>${api.yymm(r.month)}</span>`).join('')}</span></span>`;
  const issueTrend=()=>{const rows=db.trend.filter(t=>db.months.includes(t.month)).slice(-6),last=rows.at(-1),prev=rows.at(-2);if(!last)return '';
    const delta=prev?last.payingStudents-prev.payingStudents:0;
    return `<section class="ax-issue-mini" aria-label="최근 청구 대상 원생 추세"><div><strong>청구 대상 ${fmt(last.payingStudents)}명</strong><span>${prev?`지난달 대비 ${delta>0?'+':''}${fmt(delta)}명`:'최근 기록'}</span></div>${spark(rows,'payingStudents','청구 대상 원생',v=>`${fmt(v)}명`)}${button('추세 보기','navigate','finance')}</section>`;};
  function issueSignal(issue){
    return `<button type="button" class="ax-signal" data-ax="focus-issue" data-id="${issue.id}"><span class="ax-signal-kind">${pill(issue.priority,issue.priority==='결정 필요'?'amber':'blue')}<span>${h(issue.signal)}</span></span><strong class="ax-signal-value">${h(issue.value)}</strong><span class="ax-signal-title">${h(issue.note||issue.title)}</span><span class="ax-signal-go">근거 보기 ${icon('down')}</span></button>`;
  }
  function reportSignal(reports){
    return `<button type="button" class="ax-signal report" data-ax="request-detail" data-id="${reports[0].id}"><span class="ax-signal-kind">${pill('결과 도착','green')}<span>완료 보고</span></span><strong class="ax-signal-value">${reports.length}건</strong><span class="ax-signal-title">${h(reports[0].title)}${reports.length>1?` 외 ${reports.length-1}건`:''}</span><span class="ax-signal-go">보고 확인 ${icon('chevron')}</span></button>`;
  }
  function changeStrip(all){
    const rows=db.trend.filter(t=>db.months.includes(t.month)),last=rows.at(-1),prev=rows.at(-2),delta=last.payingStudents-prev.payingStudents;
    const trendWord=p=>p>0?`${fmt(p)}% 증가`:p<0?`${fmt(Math.abs(p))}% 감소`:'변화 없음';
    const range=`${api.yymm(rows[0].month)}~${api.yymm(last.month)}`,firstMonth=api.yymm(rows[0].month),open=reqs().filter(r=>r.status!=='done').length,sign=n=>`${n>0?'+':''}${fmt(n)}`;
    // 재원생 칸은 운영실 KPI 재원생과 겹쳐 뺐다(원장 10-28 "사실상 재원생은 중복 카드" — 이 칸은 청구 대상 기준이라 값도 어긋났다).
    // Each cell = a link (text) + a chart outside it, so touching the chart picks a month instead of navigating.
    return `<div class="ax-change" role="group" aria-label="최근 변화"><div class="ax-change-cell"><button type="button" class="ax-change-link" data-ax="navigate" data-id="finance"><span>청구액 · ${range}</span><strong>${won(last.billed)}</strong><small>${api.yymm(last.month)} 수납률 ${last.billed?`${fmt(last.paid/last.billed*100)}%`:'기록 없음'}</small>${rows[0].billed?`<small>청구액 · ${firstMonth} 대비 ${trendWord(Math.round((last.billed/rows[0].billed-1)*1000)/10)}</small>`:''}</button>${spark(rows,'billed','청구액',v=>won(v))}${last.billed<rows[0].billed?api.insightEntry?.(rows[0].month,last.month,`${firstMonth} 대비 청구 감소 원인`)||'':''}</div>${flowUI?.ready()?flowUI.ownerStageCell():`<div class="ax-change-cell"><button type="button" class="ax-change-link" data-ax="navigate" data-id="requests"><span>요청한 업무</span><strong>완료 전 ${open}건</strong><span class="ax-stages">${Object.entries(STATUS).map(([id,label])=>`<span><b>${reqs().filter(r=>r.status===id).length}</b>${label}</span>`).join('')}</span><span class="ax-recent">${reqs().length?reqs().slice(-3).reverse().map(r=>`<span><b>${h(r.title)}</b><small>${STATUS[r.status]} · ${h(names(r.owners))}</small></span>`).join(''):'<small>아직 등록한 요청이 없습니다.</small>'}</span></button></div>`}</div>`;
  }
  const waitNote=()=>`<p class="ax-command-wait" role="status">이전 질문의 응답을 기다리고 있습니다. ${button('대화 열기','chat')}</p>`;
  function commandForm(){
    const waiting=chat.pending?waitNote():'';
    return `<form class="ax-command" data-ax-form="chat"><label for="ax-home-command">AI 업무 지원 <span>학원 기록으로 답하고 업무 요청안을 제안합니다.</span></label><div class="ax-command-row"><input id="ax-home-command" name="prompt" required maxlength="${ASSISTANT.promptLimit}" autocomplete="off" enterkeyhint="send" value="${h(ui.homePrompt)}" placeholder="예: 미수납 확인을 누구에게 요청할지 정리해줘"><button class="button primary" type="submit">보내기</button></div><div class="ax-suggestions" aria-label="질문 예시">${['전체 이슈를 우선순위로 정리해줘','재원생 변화를 설명해줘','기한 지난 업무를 누구에게 확인할까?'].map(q=>`<button type="button" data-ax="prompt" data-prompt="${h(q)}">${h(q)}</button>`).join('')}</div>${waiting}</form>`;
  }
  function firstScreen(all){
    const reports=unreadReports(),top=all.filter(i=>i.id!=='enrollment').slice(0,3),rest=all.length-top.length,flowCards=flowUI?.ownerCards()||'';
    // 운영 상태 = 2.0 운영실 상단 KPI 9칸의 흐름(운영실 작업 공간과 같은 카드 · 같은 값) + 선생님 수업보고서(운영실 '강사별 업무 현황' 판정, 같은 이름의 작업 공간과 같은 카드)
    // (원장 10-28 "기존 2.0 kpi들을 전부 흐름으로"). 업무 흐름을 못 읽어도 보인다. 기간은 카드마다 제목 오른쪽.
    // 두 줄 모두 한 줄 4칸 — 카드 크기가 같다. 보강예정은 선생님이 할 일이라 선생님 업무 줄로(원장 10-28 "보강예정 빼고 4개 4개로 카드 크기 통일" · "보강예정은 선생님 업무로 내릴것").
    const kpis=id=>(workspaces?.data?.(id)?.metrics||[]).filter(m=>m.kind==='kpi'),TEACHER_KPI=new Set(['makeups']);
    const kpiRow=(title,list)=>list.length&&workspaces?.kpiCard?`<div class="ax-kpi"><div class="ax-kpi-head"><h3>${h(title)}</h3></div><div class="ax-kpi-row" style="--kpi-n:4;--kpi-half:4">${list.map(m=>workspaces.kpiCard(m)).join('')}</div></div>`:'';
    const kpiBlock=kpiRow('운영실',kpis('dashboard').filter(m=>!TEACHER_KPI.has(m.id)))+kpiRow(workspaces?.area?.('onescreen')?.label||'', [...kpis('onescreen'),...kpis('dashboard').filter(m=>TEACHER_KPI.has(m.id))]);
    if(flowCards)return `<section class="ax-first" aria-labelledby="ax-first-title"><h2 id="ax-first-title" class="ax-visually-hidden">지금 확인할 업무</h2>${kpiBlock}<div class="ax-signals">${reports.length?reportSignal(reports):''}${flowCards}</div>${changeStrip(all)}${commandForm()}</section>`;
    return `<section class="ax-first" aria-labelledby="ax-first-title"><h2 id="ax-first-title" class="ax-visually-hidden">지금 확인할 업무</h2>${kpiBlock}<div class="ax-signals">${reports.length?reportSignal(reports):''}${top.map(issueSignal).join('')||'<p>지금 확인할 이슈가 없습니다.</p>'}</div>${changeStrip(all)}${commandForm()}</section>`;
  }
  function recordList(issue){
    if(!issue.records.length)return '';
    if(issue.id==='attendance')return `<section class="ax-records"><div class="ax-section-head"><h4>확인 대상 ${issue.records.length}${issue.unit}</h4>${button('원생목록 열기','navigate','students')}</div><div class="ax-recs-box live-scroll" data-ax-attendance>${attendanceRows.html||attendanceRows.error||'반별 결석 기록을 불러오는 중입니다.'}</div></section>`;
    // 결석은 원생×결석한 반, 나머지 확인 대상은 업무 흐름과 같은 기록 표로 채운다.
    if(flowUI?.recordsHtml){
      const refs=issue.records.map(r=>{const [type,familyId]=REC_REF[r.type]||[r.type,''];return {type,familyId,id:String(r.id),recordId:String(r.id),label:r.name,detail:r.detail};});
      ui.recRefs.set(issue.id,refs);
      return `<section class="ax-records"><div class="ax-section-head"><h4>확인 대상 ${issue.records.length}${issue.unit}</h4>${button(`${labels[issue.page]||'전체 기록'} 열기`,'navigate',issue.page)}</div><div class="ax-recs-box live-scroll" data-ax-recs="${h(issue.id)}">${flowUI.recordsHtml(refs)}</div></section>`;
    }
    const open=ui.expanded.has(issue.id),more=issue.records.length-RECORDS_SHOWN;
    return `<section class="ax-records"><div class="ax-section-head"><h4>확인 대상 ${issue.records.length}${issue.unit}</h4>${button(`${labels[issue.page]||'전체 기록'} 열기`,'navigate',issue.page)}</div><ul class="ax-record-list" id="ax-records-${issue.id}" data-collapsed="${!open}">${issue.records.map((r,i)=>`<li class="${i>=RECORDS_SHOWN?'ax-more':''}"><button type="button" data-ax="record" data-type="${r.type}" data-id="${h(r.id)}"><strong>${h(r.name)}</strong><span>${h(r.detail)}</span>${icon('chevron')}</button></li>`).join('')}</ul>${more>0?`<button type="button" class="ax-text-link" id="ax-expand-${issue.id}" data-ax="expand" data-id="${issue.id}" aria-controls="ax-records-${issue.id}" aria-expanded="${open}">${open?'접기':`나머지 ${more}${issue.unit} 더 보기`}</button>`:''}</section>`;
  }
  function issueSection(issue){
    const related=requestsFor(issue.id);
    return `<article class="ax-issue" id="ax-issue-${issue.id}" tabindex="-1" aria-labelledby="ax-issue-${issue.id}-title"><header><div class="ax-issue-meta">${pill(issue.category)}${pill(issue.priority,['결정 필요','확인 필요'].includes(issue.priority)?'amber':issue.priority==='변화 감지'?'blue':'')}${pill(issueState(issue.id),issueState(issue.id)==='결과 도착'?'green':'')}</div><h3 id="ax-issue-${issue.id}-title">${h(issue.title)}</h3><p class="ax-summary">${h(issue.summary)}</p><div class="ax-actions">${button('업무 요청','request',issue.id,true)}${button('AI 요청','ask',issue.id)}${button('슬랙 알림 미리보기','slack',issue.id)}</div></header><div class="ax-issue-body single">${issue.id==='enrollment'?issueTrend():recordList(issue)}</div>${related.length?`<section class="ax-linked"><h4>연결된 요청 ${related.length}건</h4>${related.map(requestRow).join('')}</section>`:''}<footer class="ax-issue-footer">${button(ui.read.has(issue.id)?'확인 취소':'확인함','read',issue.id,false,`id="ax-read-${issue.id}"`)}${button('보관','archive',issue.id,false,`id="ax-archive-${issue.id}"`)}</footer></article>`;
  }
  function issueList(all){
    const available=FILTERS.filter(f=>!f[2]||all.some(i=>i.priority===f[2]));if(!available.some(f=>f[0]===ui.filter))ui.filter='all';
    const filter=available.find(f=>f[0]===ui.filter),shown=filter[2]?all.filter(i=>i.priority===filter[2]):all;
    return `<section class="ax-issues" id="ax-issues" aria-labelledby="ax-issues-title"><div class="ax-section-head"><h2 id="ax-issues-title" tabindex="-1">전체 이슈와 근거 ${all.length}건</h2><div class="ax-filter" role="group" aria-label="이슈 필터">${available.map(([id,label])=>`<button type="button" id="ax-filter-${id}" data-ax="filter" data-id="${id}" aria-pressed="${ui.filter===id}">${label}</button>`).join('')}</div></div><div class="ax-issue-stack">${shown.map(issueSection).join('')||'<p class="live-empty">이 조건의 이슈가 없습니다.</p>'}</div></section>`;
  }
  function requestRow(r){
    return `<button type="button" class="ax-request-row" data-ax="request-detail" data-id="${r.id}"><span><strong>${h(r.title)}</strong><small>${r.context?.familyLabel?`${h(r.context.familyLabel)} · `:''}${h(names(r.owners))} · ${h(r.due)}까지</small></span>${pill(STATUS[r.status],r.status==='done'?'green':'blue')}${icon('chevron')}</button>`;
  }
  /* Record-domain coverage: what this prototype reads. It is not the full 2.0 feature list (see the catalog seam below). */
  function coverage(){
    const domains=[['수납',db.invoices.length,'finance'],['원생',db.students.length,'students'],['상담',db.admissions.length,'admissions'],['수업',db.classes.length,'classes'],['학습',db.learning.gradesCount,'learning'],['학부모',db.messages.length,'parents'],['직원',db.staff.length,'staff'],['차량',db.runs.length,'shuttle'],['업무',db.tasks.length,'approvals'],['결재',db.approvals.length,'approvals'],['교재·자산',db.textbooks.length+db.assetCount,'resources'],['일정',db.calendar.length,'calendar']];
    return `<section class="ax-coverage"><div class="ax-section-head"><h2>업무 영역</h2></div><div class="ax-domain-grid">${domains.map(([name,count,page])=>`<button type="button" data-ax="navigate" data-id="${page}"><strong>${name}</strong><span>${count?`${fmt(count)}건`:'표시할 기록 없음'}</span>${icon('chevron')}</button>`).join('')}</div></section>`;
  }
  function home(){
    if(flowUI?.ready()&&flowRole()!=='owner')return flowUI.fullView();
    const all=issues().filter(i=>!ui.archived.has(i.id)),open=reqs().filter(r=>r.status!=='done').length;
    return `<div class="ax-fold"><div class="page-heading"><div><h1>브리핑</h1><p>${caption} · 재원생 ${fmt(workspaces?.data?.('dashboard')?.metrics?.find(m=>m.id==='enrolled-students')?.value??db.students.filter(s=>s.status==='enrolled').length)}명 · 완료 전 요청 ${open}건</p></div><div class="heading-actions">${button('직접 업무 요청','request','',true)}</div></div>${firstScreen(all)}<button type="button" class="ax-scroll-cue" data-ax="focus-list"><span><strong>${workspaces?.homeSignals()?'작업 공간 신호, ':''}전체 이슈 ${all.length}건과 근거</strong></span>${icon('down')}</button></div>${flowUI?.ownerBelow()||''}${workspaces?.homeSignals()||''}${issueList(all)}<section class="ax-request-summary"><div class="ax-section-head"><h2>요청한 업무</h2>${button('전체 보기','navigate','requests')}</div>${reqs().length?reqs().slice(-3).reverse().map(requestRow).join(''):'<p>아직 등록한 요청이 없습니다.</p>'}</section>${coverage()}`;
  }
  // In-page jumps animate (api.scrollToSection); arriving from another page (instant) lands at once.
  function focusIssue(id,{instant=false}={}){
    const node=document.getElementById(id==='list'?'ax-issues':`ax-issue-${id}`);if(!node)return;
    const target=id==='list'?$('#ax-issues-title'):node;
    api.scrollToSection(`#${CSS.escape(node.id)}`,{instant});target.focus({preventScroll:true});
    node.classList.add('ax-flash');setTimeout(()=>node.classList.remove('ax-flash'),1600);
  }

  /* ---------- Inbox / requests / automation ---------- */
  function inbox(){
    const items=issues().filter(i=>ui.inbox==='archived'?ui.archived.has(i.id):!ui.archived.has(i.id)&&(ui.inbox!=='unread'||!ui.read.has(i.id)));
    const reports=ui.inbox==='archived'?[]:reqs().filter(r=>r.status==='done'&&(ui.inbox!=='unread'||!ui.reportRead.has(r.id)));
    return `<div class="page-heading"><div><h1>알림</h1><p>${caption} · 이슈와 완료 보고를 한곳에서 확인합니다.</p></div><div class="heading-actions">${button('모두 읽음','read-all')}</div></div><div class="ax-filter" role="group" aria-label="알림 보기">${[['unread',`안 읽음 ${unread()}`],['all','받은 알림'],['archived','보관함']].map(([id,label])=>`<button type="button" id="ax-inbox-${id}" data-ax="inbox-tab" data-id="${id}" aria-pressed="${ui.inbox===id}">${label}</button>`).join('')}</div><p class="ax-note">읽음 처리와 업무 완료는 따로입니다.</p>${flowUI?.notices()||''}<div class="ax-notifications">${reports.map(r=>`<article class="ax-notification"><div class="ax-notification-meta">${pill('완료 보고','green')}</div><div class="ax-notification-copy"><h3>${h(r.title)}</h3><p class="live-pre">${h(r.result)}</p></div><div class="ax-actions">${button('보고 확인','request-detail',r.id,true)}${sourcePage(r.context)?button(`${r.context.familyLabel} 열기`,'navigate',sourcePage(r.context)):''}${button('슬랙 완료 보고 미리보기','report-slack',r.id)}</div></article>`).join('')}${items.map(i=>`<article class="ax-notification"><div class="ax-notification-meta">${pill(i.category)}${pill(i.priority,['결정 필요','확인 필요'].includes(i.priority)?'amber':i.priority==='변화 감지'?'blue':'')}${pill(issueState(i.id))}</div><div class="ax-notification-copy"><h3>${h(i.title)}</h3><p>${h(i.summary)}</p></div><div class="ax-actions">${button('근거 보기','open-issue',i.id)}${button('업무 요청','request',i.id,true)}${button('슬랙 알림 미리보기','slack',i.id)}</div></article>`).join('')}${!items.length&&!reports.length?'<p class="live-empty">이 조건의 알림이 없습니다.</p>':''}</div>`;
  }
  function requests(){return `<div class="page-heading"><div><h1>요청한 업무</h1></div><div class="heading-actions">${button('업무 요청','request','',true)}</div></div><div class="ax-workflow" aria-label="요청 처리 단계">${Object.entries(STATUS).map(([id,label])=>`<section><h2>${label} ${pill(reqs().filter(r=>r.status===id).length+'건')}</h2>${reqs().filter(r=>r.status===id).map(requestRow).join('')||'<p>해당 단계의 요청이 없습니다.</p>'}</section>`).join('')}</div>`;}
  function automation(){
    const slack=db.channels?.slack;
    return `<div class="page-heading"><div><h1>자동화</h1><p>브리핑 규칙과 알림 채널을 켜고 끕니다.</p></div></div><section class="ax-rules"><h2>원장 브리핑</h2><p>남은 수납, 상담·검토 중, 결석 3회 이상, 결재 대기, 지난 자동 업무, 전달 전 교재, 청구 대상 변화를 한 브리핑으로 묶습니다.</p><div class="ax-rule-path"><span>업무 기록 확인</span>${icon('chevron')}<span>같은 이슈 묶기</span>${icon('chevron')}<span>원장에게 알림</span>${icon('chevron')}<span>담당자 요청·결과 보고</span></div><label><input type="checkbox" data-ax-setting="rule" ${ui.rule?'checked':''}> 브리핑 규칙 사용</label><div class="ax-channel-options"><label><input type="checkbox" data-ax-setting="app" ${ui.app?'checked':''}> 앱 알림</label><label><input type="checkbox" data-ax-setting="slack" ${ui.slack?'checked':''}> 슬랙 알림</label></div><p>${slack?.configured?`슬랙 설정: 연결됨 · 사용 중 규칙 ${slack.enabledRules}개 · 요약 시각 ${h(slack.digest||'없음')} · 방해금지 ${h(slack.quiet||'꺼짐')}`:'사용 중인 슬랙 연결이 없습니다.'}</p><p class="ax-note">여기서 바꾼 설정은 저장되지 않고, 실제 알림 발송·예약 실행도 하지 않습니다.</p>${button('브리핑 알림 미리보기','digest')}</section>${coverage()}`;
  }

  /* ---------- Owner picker: shared ContextPicker (context-picker.js) with each person's role, duty, subjects and homeroom
     classes. With the work flow, only the people it can assign (same rule as its reassign list: real, assignable, not
     an owner); without it (session-only requests), the copy's staff. Earlier draft picks that are no longer allowed are
     named and left out, never sent. ---------- */
  const assignableActors=()=>flowUI?.ready()?flowUI.actors().filter(a=>a&&!a.preview&&a.assignable!==false&&a.role!=='owner'):null;
  function ownerPicker(selected){
    const CP=window.ContextPicker,actors=assignableActors();
    if(!CP)return `<fieldset class="ws-multi"><legend>담당자</legend>${(actors||db.staff).map(p=>`<label><input type="checkbox" name="owner" value="${h(p.id)}" ${selected.includes(p.id)?'checked':''}> ${h(p.name)} · ${h(p.roleLabel||p.title||'')}</label>`).join('')}</fieldset>`;
    const list=actors?CP.lists.people({db,actors,subjectLabel:api.subjectLabel}):CP.lists.staff({db,subjectLabel:api.subjectLabel}),allowed=new Set(list.options.map(o=>o.value));
    const dropped=[...new Set(selected)].filter(id=>!allowed.has(id)).map(id=>({label:staffById.get(id)?.name||flowUI?.nameOf?.(id)||'이전에 선택한 사람',reason:actors?'업무 흐름에서 배정할 수 없음':'직원 목록에 없음'}));
    return CP.html({id:'ax-owner',name:'owner',label:'담당자',required:true,multiple:true,empty:'담당자 선택',describedBy:'ax-request-error',selected:selected.filter(id=>allowed.has(id)),dropped,...list});
  }
  /* ---------- Request form: draft kept per source until submitted ---------- */
  function saveDraft(form){
    const key=form.dataset.draftKey;if(!key||form.dataset.submitted)return;
    const v=new FormData(form);
    ui.drafts.set(key,{title:String(v.get('title')||''),body:String(v.get('body')||''),owners:v.getAll('owner'),due:String(v.get('due')||''),priority:String(v.get('priority')||'보통'),channels:v.getAll('channel')});
  }
  function showRequest(args={}){
    const sources=[...new Set((args.issues||[]).filter(Boolean))],issue=findIssue(sources[0]);
    const key=args.draftKey||(sources.length===1&&args.source!=='chat'?`issue:${sources[0]}`:sources.length?`issues:${sources.join(',')}`:'direct');
    ui.requestArgs={...args,draftKey:key};
    const context=cleanContext(args.context);if(context)contexts.set(key,context);else contexts.delete(key);
    const draft=ui.drafts.get(key);
    const value={title:draft?.title??clip(args.title??issue?.request??'',120),body:draft?.body??clip(args.body??issue?.suggestion??'',3000),owners:draft?.owners||[],due:draft?draft.due:context?.card?'':db.meta.asOf,priority:draft?.priority||'보통',channels:draft?.channels||[...(ui.app?['app']:[]),...(ui.slack?['slack']:[])]};
    const linked=sources.map(findIssue).filter(Boolean);
    const lead=args.source==='chat'?'AI 제안 요청안':context?.familyLabel?`${context.familyLabel}에서 보내는 요청`:issue?`${issue.category} · 확인 대상 ${issue.records.length||'변동 근거'}${issue.records.length?issue.unit:''}`:'';
     dialog('modal','업무 요청',lead,`<form data-ax-form="request" class="ax-request-form" data-draft-key="${h(key)}" data-source="${h(args.source||(sources.length?'issue':'direct'))}">${sources.map(id=>`<input type="hidden" name="issue" value="${h(id)}">`).join('')}${draft?`<p class="ax-draft-note" role="status">작성하던 내용을 이어서 표시합니다. ${button('처음 내용으로','draft-reset',key)}</p>`:''}${linked.length?`<div class="ax-linked-issues"><span>연결 이슈</span>${linked.map(i=>pill(i.title)).join('')}</div>`:''}${context?.familyLabel||context?.records.length?`<div class="ax-linked-issues"><span>출처</span>${context.familyLabel?pill(context.familyLabel,'blue'):''}${context.records.slice(0,4).map(r=>pill(r.label)).join('')}${context.records.length>4?`<span>외 ${context.records.length-4}건</span>`:''}</div>`:''}<label>요청 제목<input name="title" required maxlength="${flowUI?.ready()?80:120}" value="${h(value.title)}"></label>${ownerPicker(value.owners)}<div class="ax-form-pair"><label>완료 기한<input name="due" type="date" required min="${db.meta.asOf}" value="${h(value.due)}"></label>${choicePicker({id:'ax-req-priority',name:'priority',label:'우선순위',selected:value.priority||'보통',columns:[{key:'name',label:'우선순위'},{key:'note',label:'뜻',w:'minmax(0,1.6fr)'}],items:[{value:'보통',title:'보통',cells:{note:'정한 기한 안에 처리'}},{value:'높음',title:'높음',cells:{note:'다른 업무보다 먼저 처리'}}]},`<label>우선순위<select name="priority">${['보통','높음'].map(p=>`<option ${p===value.priority?'selected':''}>${p}</option>`).join('')}</select></label>`)}</div><label>요청 내용<textarea name="body" rows="5" required maxlength="${flowUI?.ready()?2000:3000}">${h(value.body)}</textarea></label>${flowUI?.ready()?workspaces?.attachField?.(`ax-req-${key}`.replace(/[^\w-]/g,'_'),context?.family||workspaces?.familyOf?.(api.getPage?.())||'')||'':''}<fieldset><legend>알림 방법</legend><div class="ax-channel-options"><label><input type="checkbox" name="channel" value="app" ${value.channels.includes('app')?'checked':''}> 앱 알림</label><label><input type="checkbox" name="channel" value="slack" ${value.channels.includes('slack')?'checked':''}> 슬랙</label></div></fieldset><p class="ax-form-error" id="ax-request-error" role="alert"></p><button class="button primary" type="submit">요청 등록</button></form>`);
  }
  function submitRequest(form){
    const values=new FormData(form),error=form.querySelector('.ax-form-error'),picker=form.querySelector('[data-cpick-name="owner"]');
    const owners=values.getAll('owner').filter(id=>staffById.has(id)),channels=values.getAll('channel'),title=String(values.get('title')||'').trim(),body=String(values.get('body')||'').trim();
    if(!owners.length){error.textContent='담당자를 한 명 이상 선택해 주세요.';const trigger=picker?.querySelector('.cpick-trigger');trigger?.setAttribute('aria-invalid','true');trigger?.focus();return;}
    if(!form.reportValidity())return;
    if(!channels.length||!title||!body){error.textContent=!channels.length?'알림 방법을 하나 이상 선택해 주세요.':'제목과 요청 내용을 입력해 주세요.';return;}
    const id=crypto.randomUUID(),sources=values.getAll('issue').filter(Boolean),source=form.dataset.source||(sources.length?'issue':'direct');
    if(flowUI?.ready()){
      // Durable path: one request.create command; the form stays open (with its draft) until the server accepts it.
      if(form.dataset.sending)return;form.dataset.sending='1';const submit=form.querySelector('button[type=submit]');submit.disabled=true;submit.textContent='등록하는 중';
      flowUI.createRequest({title,body,owners,channels,due:String(values.get('due')),priority:String(values.get('priority')),issues:sources,context:contexts.get(form.dataset.draftKey)||null,source,draftKey:form.dataset.draftKey,attachments:values.getAll('attach').filter(Boolean)}).then(created=>{
        delete form.dataset.sending;submit.disabled=false;submit.textContent='요청 등록';
        if(created===null){error.textContent='요청을 등록하지 못했습니다. 내용을 확인하고 다시 시도해 주세요.';return;}
        const caseId=typeof created==='string'?created:created.caseId;
        form.dataset.submitted='1';ui.drafts.delete(form.dataset.draftKey);sources.forEach(x=>ui.read.add(x));
        document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();if(caseId)showRequestDetail(caseId);toast(created?.duplicate?'같은 확인 항목의 처리할 업무를 보여 드립니다.':'업무 흐름에 요청을 등록했습니다. 담당자의 업무에 바로 보입니다.');
      });
      return;
    }
    form.dataset.submitted='1';ui.drafts.delete(form.dataset.draftKey);
    const context=contexts.get(form.dataset.draftKey)||null;
    ui.requests.push({id,issues:sources,context,title,body,owners,channels,source,due:String(values.get('due')),priority:String(values.get('priority')),status:'requested',events:[{label:'요청 등록',text:source==='chat'?'AI 제안 요청안을 원장이 검토해 등록했습니다.':context?.familyLabel?`${context.familyLabel} 화면${context.records.length?`과 기록 ${context.records.length}건`:''}을 연결했습니다.`:sources.length?'요청 내용과 이슈 근거를 연결했습니다.':'요청 내용을 등록했습니다.'},{label:'알림 준비',text:`${channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')} 미리보기를 준비했습니다. 실제 발송은 하지 않았습니다.`}]});
    sources.forEach(s=>ui.read.add(s));document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);toast('업무 요청을 등록했습니다. 이 탭에서만 유지됩니다.');
  }
  function showRequestDetail(id){
    if(flowUI?.ready()&&flowUI.caseById(id)){flowUI.showCase(id);return;}
    const r=ui.requests.find(x=>x.id===id);if(!r)return;
    const linked=r.issues.map(findIssue).filter(Boolean);
    dialog('detail',r.title,'요청한 업무',`<div class="ax-issue-meta">${pill(STATUS[r.status],r.status==='done'?'green':'blue')}${pill(r.priority)}${r.source==='chat'?pill('AI 제안에서 작성'):''}</div><dl><dt>담당자</dt><dd>${h(names(r.owners))}</dd><dt>완료 기한</dt><dd>${h(r.due)}</dd><dt>알림 방법</dt><dd>${r.channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')}</dd></dl><p class="live-pre">${h(r.body)}</p>${linked.length?`<div class="ax-actions"><span class="ax-note">연결된 이슈</span>${linked.map(i=>button(i.title,'open-issue',i.id)).join('')}</div>`:''}${r.context?.familyLabel||r.context?.records.length?`<div class="ax-actions ax-request-source"><span class="ax-note">출처</span>${sourcePage(r.context)?button(`${r.context.familyLabel} 열기`,'navigate',sourcePage(r.context)):r.context.familyLabel?pill(r.context.familyLabel):''}${r.context.records.slice(0,6).map(x=>pill(x.label)).join('')}</div>`:''}<section class="ax-request-timeline"><h3>진행 기록</h3><ol>${r.events.map(e=>`<li><strong>${h(e.label)}</strong><p>${h(e.text)}</p></li>`).join('')}</ol></section>${r.result?`<section class="ax-evidence"><h3>완료 보고</h3><p class="live-pre">${h(r.result)}</p><p>담당자가 남긴 보고입니다. 이 보고로 원본 기록이 바뀌지는 않습니다.</p></section>`:''}<section class="ax-simulation"><h3>담당자 응답 시험</h3><p>담당자 대신 확인과 완료 보고를 남겨, 원장 알림으로 돌아오는지 봅니다.</p>${r.status==='requested'?button('담당자 확인 처리','request-start',r.id):r.status==='working'?`<form data-ax-form="result"><input type="hidden" name="request" value="${r.id}"><label>처리 결과<textarea name="result" required rows="3" maxlength="3000" placeholder="담당자가 확인한 내용과 후속 조치를 입력하세요"></textarea></label><button class="button primary" type="submit">완료 보고</button></form>`:button('추가 확인 요청','request-reopen',r.id)}</section><div class="ax-actions">${button('슬랙 요청 미리보기','request-slack',r.id)}${r.result?button('슬랙 완료 보고 미리보기','report-slack',r.id):''}</div>`);
  }

  /* ---------- Slack previews (never sent) ---------- */
  function slackPreview({issueId,requestId,report=false}={}){
    const issue=findIssue(issueId),r=reqs().find(x=>x.id===requestId),linked=(r?.issues||[]).map(findIssue).filter(Boolean);
    const title=report&&r?`완료 보고 · ${r.title}`:r?.title||issue?.title||'학원 브리핑';
    const body=report&&r?r.result:r?.body||issue?.summary||issues().map(i=>`${i.title}: ${i.value}`).join('\n');
    const to=report?'원장':r?names(r.owners):'원장';
    const actions=r?button(report?'보고 확인':'요청 확인','request-detail',r.id):issue?button('근거 보기','open-issue',issue.id)+button('업무 요청','request',issue.id):button('전체 이슈','navigate','home');
    dialog('modal','슬랙 알림 미리보기','에이와 알림과 같은 이슈·요청에 연결됩니다.',`<div class="ax-slack"><div class="ax-slack-avatar" aria-hidden="true">a</div><div><header><strong>aywa</strong>${pill('앱')}<span>${db.meta.asOf}</span></header><p>받는 사람: ${h(to)}</p><h3>${h(title)}</h3><p class="live-pre">${h(body)}</p>${linked.length?`<p>연결 이슈: ${h(linked.map(i=>i.title).join(' · '))}</p>`:''}${r?.context?.familyLabel?`<p>출처: ${h(r.context.familyLabel)}${r.context.records.length?` · 기록 ${r.context.records.length}건`:''}</p>`:''}${r&&!report?`<p>완료 기한 ${h(r.due)} · ${h(r.priority)}</p>`:''}${report&&r?`<p>담당 ${h(names(r.owners))}</p>`:''}<div class="ax-actions">${actions}</div></div></div><p class="ax-note">슬랙으로 실제 보내지 않았습니다.</p>`);
  }
  function digestPreview(){
    if(!ui.rule||!ui.slack){dialog('modal','브리핑 알림 미리보기','자동화 설정',`<p>${!ui.rule?'브리핑 규칙이 꺼져 있습니다.':'슬랙 알림이 선택되지 않았습니다.'}</p><p>자동화에서 설정을 켜면 슬랙 브리핑을 확인할 수 있습니다.</p>${button('자동화 설정','navigate','automation')}`);return;}
    slackPreview();
  }

  /* ---------- Assistant: real endpoint only. Bounded history, one request at a time, explicit cancel and retry. ---------- */
  function validateAssistant(payload){
    const problems=[],rawProblems=[];
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return {value:null,problems:['답변 데이터 형식이 올바르지 않습니다.'],rawProblems:['응답이 JSON 객체가 아닙니다.']};
    const answer=typeof payload.answer==='string'?payload.answer.trim():'';if(!answer){problems.push('답변 내용이 비어 있습니다.');rawProblems.push('answer가 비어 있습니다.');}
    const provider=typeof payload.provider==='string'?payload.provider.trim():'';if(!provider){problems.push('AI 서비스 제공자 정보가 없습니다.');rawProblems.push('provider가 없습니다.');}
    if(!Array.isArray(payload.issueIds)||payload.issueIds.some(id=>typeof id!=='string')){problems.push('이슈 식별자 형식이 올바르지 않습니다.');rawProblems.push('issueIds는 문자열 배열이어야 합니다.');}
    let suggestedTask=null;const task=payload.suggestedTask;
    if(task!==null){if(task&&typeof task==='object'&&typeof task.title==='string'&&typeof task.body==='string'&&task.title.trim()&&task.body.trim())suggestedTask={title:clip(task.title.trim(),120),body:clip(task.body.trim(),3000)};else{problems.push('추천 업무 데이터 형식이 올바르지 않습니다.');rawProblems.push('suggestedTask는 null 또는 {title, body}여야 합니다.');}}
    if(!answer||!provider)return {value:null,problems,rawProblems};
    return {value:{answer:clip(answer,20000),provider,issueIds:[...new Set((Array.isArray(payload.issueIds)?payload.issueIds:[]).filter(id=>typeof id==='string'))],suggestedTask},problems,rawProblems};
  }
  // Most recent completed pairs, kept whole, until the item or character budget is reached.
  function buildHistory(turns){
    const done=turns.filter(t=>t.status==='done'&&String(t.prompt||'').trim()&&String(t.answer||'').trim()),items=[];let used=0;
    for(let i=done.length-1;i>=0&&items.length+2<=ASSISTANT.historyItems;i--){
      const pair=[{role:'user',content:clip(done[i].prompt.trim(),ASSISTANT.historyItemLimit)},{role:'assistant',content:clip(done[i].answer.trim(),ASSISTANT.historyItemLimit)}];
      const size=pair[0].content.length+pair[1].content.length;if(used+size>ASSISTANT.historyTotal)break;
      items.unshift(...pair);used+=size;
    }
    return items;
  }
  const historyFor=turn=>buildHistory(chat.turns.slice(0,chat.turns.indexOf(turn)));
  function errorFor(e){
    if(e.kind==='timeout')return {message:`${ASSISTANT.timeoutMs/60000}분 안에 응답이 오지 않아 중단했습니다. 다시 시도해 주세요.`,detail:'timeout'};
    if(e.kind==='invalid')return {message:'AI 응답 형식이 맞지 않습니다. 다시 시도해 주세요.',detail:e.detail};
    if(e.kind==='http'){
      const s=e.status,fallback=[404,405,501].includes(s)?'AI 응답 연결이 아직 준비되지 않았습니다. 잠시 뒤 다시 시도해 주세요.':s===429?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':s===504?'응답 시간이 초과됐습니다. 다시 시도해 주세요.':s>=500?'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.':'요청을 처리하지 못했습니다. 다시 시도해 주세요.';
      const wait=s===429&&e.retryAfter>0?` 약 ${Math.ceil(e.retryAfter)}초 뒤에 다시 시도할 수 있습니다.`:'';
      return {message:`${fallback}${wait}`,detail:`HTTP ${s}${e.code?` · ${e.code}`:''}${e.message?` · ${clip(e.message,300)}`:''}`};
    }
    return {message:'AI 응답 서버에 연결하지 못했습니다. 다시 시도해 주세요.',detail:String(e.message||e)};
  }
  async function sendTurn(turn){
    if(chat.pending){toast('이전 질문의 응답을 기다리고 있습니다. 취소하거나 응답 후 다시 보내 주세요.');return;}
    const controller=new AbortController(),pending={turn,controller,started:Date.now()};
    pending.ticker=setInterval(tickChat,1000);pending.timeout=setTimeout(()=>{turn.timedOut=true;controller.abort();},ASSISTANT.timeoutMs);
    chat.pending=pending;Object.assign(turn,{status:'pending',answer:'',provider:'',issueIds:[],suggestedTask:null,rich:null,task:null,error:null,timedOut:false});updateChat();
    try{
      const response=await fetch(ASSISTANT.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({prompt:turn.prompt,contextIssueId:turn.context||null,history:historyFor(turn)}),signal:controller.signal});
      let payload=null;try{payload=await response.json();}catch(e){if(controller.signal.aborted)throw e;}
      if(!response.ok)throw {kind:'http',status:response.status,code:typeof payload?.error==='string'?payload.error:'',message:typeof payload?.message==='string'?payload.message.trim():'',retryAfter:Number(response.headers.get('Retry-After'))||0};
      const {value,rawProblems}=validateAssistant(payload);if(!value)throw {kind:'invalid',detail:rawProblems.join(' ')};
      const aiMeta=payload?.aiMeta&&typeof payload.aiMeta==='object'?{modelLabel:clip(payload.aiMeta.modelLabel||'AI',80),createdAt:payload.aiMeta.createdAt||null,basis:clip(payload.aiMeta.basis||'',240)}:null;
      Object.assign(turn,{status:'done'},value,{rich:axChat?.validate(payload)||null,task:axChat?.taskExtras(payload)||null,aiMeta});
    }catch(e){
      if(controller.signal.aborted&&!turn.timedOut)turn.status='cancelled';
      else{turn.status='error';turn.error=errorFor(turn.timedOut?{kind:'timeout'}:e);}
    }finally{
      clearInterval(pending.ticker);clearTimeout(pending.timeout);chat.pending=null;updateChat();
      if(!chatVisible()&&turn.status==='done')toast('AI 응답이 도착했습니다. ‘AI 업무 지원’에서 확인하세요.');
      else if(!chatVisible()&&turn.status==='error')toast('AI 응답을 받지 못했습니다. ‘AI 업무 지원’에서 다시 시도할 수 있습니다.');
    }
  }
  function ask(prompt){
    const text=clip(String(prompt||'').trim(),ASSISTANT.promptLimit);if(!text)return false;
    if(chat.pending){if(!chatVisible())showChat();toast('이전 질문의 응답을 기다리고 있습니다. 취소하거나 응답 후 다시 보내 주세요.');return false;}
    const turn={id:crypto.randomUUID(),prompt:text,context:chat.context,topic:chat.context?'':chat.topic,status:'pending'};chat.turns.push(turn);
    if(!chatVisible())showChat();sendTurn(turn);return true;
  }
  const chatVisible=()=>Boolean($('#detail[open] [data-ax-chat]'));
  const providerLabel=p=>PROVIDERS[p]||'AI 응답';
  const answerHtml=text=>window.AIResultMeta.rich(text,h).replace(/^#{1,6}\s+(.+)$/gm,'<strong>$1</strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  function turnView(t){
    const context=t.context?findIssue(t.context):null;
    const question=`<div class="ax-chat-question">${context?`<small>대화 기준 · ${h(context.title)}</small>`:t.topic?`<small>대화 주제 · ${h(t.topic)}</small>`:''}${h(t.prompt)}</div>`;
    if(t.status==='pending')return `${question}<div class="ax-chat-answer pending"><span class="ax-spinner" aria-hidden="true"></span><div><strong>AI가 답을 작성하고 있습니다</strong><p>학원 기록을 확인하는 데 시간이 걸릴 수 있습니다. <span data-chat-elapsed aria-hidden="true">0초 경과</span></p></div>${button('취소','chat-cancel',t.id)}</div>`;
    if(t.status==='cancelled')return `${question}<div class="ax-chat-answer muted"><p>질문을 취소했습니다.</p>${button('다시 보내기','chat-retry',t.id)}</div>`;
    if(t.status==='error')return `${question}<div class="ax-chat-answer error"><strong>응답을 받지 못했습니다</strong><p ${t.error?.detail?`title="${h(t.error.detail)}"`:''}>${h(t.error?.message||'')}</p>${button('다시 시도','chat-retry',t.id,true)}</div>`;
    const linked=t.issueIds.map(findIssue).filter(Boolean);
    if(axChat&&t.rich)return `${question}${axChat.answer(t,{issues:linked.length?`<div class="ax-actions"><span class="ax-note">관련 근거</span>${linked.map(i=>button(`${i.category} 근거`,'open-issue',i.id)).join('')}</div>`:''})}`;
    return `${question}<div class="ax-chat-answer"><div class="ax-chat-provider">${pill('AI 분석','blue')}<span>내용을 확인한 뒤 사용하세요</span></div>${window.AIResultMeta.html({model:t.aiMeta?.modelLabel||providerLabel(t.provider),at:t.aiMeta?.createdAt,basis:t.aiMeta?.basis||`${context?`이슈 ${context.title}`:'원장실 전체'} · 기준일 ${db.meta.asOf}`})}<div class="ax-chat-text air-rich">${answerHtml(t.answer)}</div>${linked.length?`<div class="ax-actions"><span class="ax-note">관련 근거</span>${linked.map(i=>button(`${i.category} 근거`,'open-issue',i.id)).join('')}</div>`:''}${t.suggestedTask?`<div class="ax-chat-task"><span class="ax-note">요청안 제안</span><strong>${h(t.suggestedTask.title)}</strong><p class="live-pre">${h(t.suggestedTask.body)}</p><div class="ax-actions">${button('요청안 검토','chat-task',t.id,true)}<span class="ax-note">담당자·기한을 지정해 등록하기 전에는 전달되지 않습니다.</span></div></div>`:''}</div>`;
  }
  function chatLog(){return chat.turns.map(turnView).join('')||'<p class="ax-chat-empty">이슈의 근거를 묻거나, 누구에게 무엇을 요청할지 정리해 달라고 입력하세요.</p>';}
  function chatContextBar(){const c=chat.context?findIssue(chat.context):null;return c?`<p>대화 기준 이슈 ${pill(c.title)} ${button('기준 해제','chat-context-clear')}</p>`:chat.topic?`<p>대화 주제 ${pill(chat.topic,'blue')} 이슈 기준 없이 질문합니다. ${button('주제 해제','chat-context-clear')}</p>`:'<p>대화 기준 이슈 없음 · 이슈의 ‘AI 요청’에서 기준을 정할 수 있습니다.</p>';}
  function openChat({topic='',prompt=''}={}){chat.context=null;chat.topic=String(topic||'');showChat();const input=$('#ax-chat-command');if(input&&!input.value)input.value=clip(prompt,ASSISTANT.promptLimit);input?.focus();}
  function showChat(){
    const prior=$('#ax-chat-command')?.value||'';
    dialog('detail','AI 업무 지원','학원 기록으로 답하고 업무 요청안을 제안합니다.',`<div class="ax-chat" data-ax-chat><div class="ax-chat-context" data-chat-context>${chatContextBar()}</div><div class="ax-chat-log live-scroll" role="log" aria-label="AI 대화" data-chat-log tabindex="0">${chatLog()}</div><form class="ax-chat-composer" data-ax-form="chat"><label for="ax-chat-command">질문</label><textarea id="ax-chat-command" name="prompt" rows="3" required maxlength="${ASSISTANT.promptLimit}" placeholder="예: 미수납 확인을 누구에게 요청하면 좋을까?">${h(prior)}</textarea><div class="ax-chat-compose-foot"><span class="ax-note">Enter 보내기 · Shift+Enter 줄바꿈. 질문과 최근 대화 ${ASSISTANT.historyItems/2}회, 대화 기준 이슈를 AI에 보냅니다.</span><button class="button primary" type="submit" data-chat-send>보내기</button></div></form></div>`);
    $('#detail .live-detail-body').classList.add('ax-chat-body');updateChat(true);$('#ax-chat-command').focus({preventScroll:true});
  }
  function syncChatChrome(){
    const badge=$('#sidebar [data-ax="chat"] .nav-count');if(badge)badge.hidden=!chat.pending;
    const form=$('main .ax-command');if(form){form.querySelector('.ax-command-wait')?.remove();if(chat.pending)form.insertAdjacentHTML('beforeend',waitNote());}
  }
  function updateChat(forceBottom=false){
    syncChatChrome();if(!chatVisible())return;
    const log=$('[data-chat-log]'),nearBottom=forceBottom||log.scrollHeight-log.scrollTop-log.clientHeight<80,focusTurn=log.contains(document.activeElement)?document.activeElement.dataset.id||'':null;
    log.innerHTML=chatLog();$('[data-chat-context]').innerHTML=chatContextBar();
    if(focusTurn!==null)((focusTurn&&log.querySelector(`:is([data-ax="chat-cancel"],[data-ax="chat-retry"])[data-id="${CSS.escape(focusTurn)}"]`))||$('#ax-chat-command')).focus({preventScroll:true});
    const send=$('[data-chat-send]');send.disabled=Boolean(chat.pending);send.textContent=chat.pending?'응답 대기 중':'보내기';
    tickChat();if(nearBottom)log.scrollTop=log.scrollHeight;log.dispatchEvent(new Event('scroll'));
  }
  function tickChat(){const node=$('[data-chat-elapsed]');if(node&&chat.pending)node.textContent=`${Math.floor((Date.now()-chat.pending.started)/1000)}초 경과`;}
  /* Test seam for the response contract (no network). */
  window.AxAssistantContract={endpoint:ASSISTANT.endpoint,limits:{prompt:ASSISTANT.promptLimit,historyItems:ASSISTANT.historyItems,historyItem:ASSISTANT.historyItemLimit,historyTotal:ASSISTANT.historyTotal},validate:validateAssistant,buildHistory};

  /* ---------- Shell: chrome lives on the left. The desktop header band is gone; phones keep a slim menu bar. ---------- */
  function decorateShell(){
    document.body.classList.add('ax-enabled');
    const page=api.getPage(),offset=$('.nav-scroll')?.scrollTop||0,count=flowUI?.ready()&&flowRole()!=='owner'?flowUI.inboxCount():unread(),reports=reqs().filter(r=>r.status==='done').length;
    document.body.dataset.page=page;
    const link=(id,label,symbol,extra='')=>`<a class="nav-item ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${extra}</a>`;
    const tool=(attrs,label,symbol,extra='')=>`<button type="button" class="nav-item" ${attrs}>${icon(symbol)}<span>${label}</span>${extra}</button>`;
    $('#sidebar').innerHTML=`<a href="#home" class="brand"><span class="brand-mark">${icon('trend')}</span><div><div class="brand-name">aywa</div><div class="brand-caption">학원 운영</div></div></a><div class="academy-box"><span class="academy-symbol">${icon('building')}</span><div><strong>${h(db.meta.tenant)}</strong><small>원장</small></div></div><button type="button" class="ax-search-trigger" data-action="search">${icon('search')}<span>통합 검색</span><kbd>Ctrl K</kbd></button><nav class="nav-scroll" aria-label="원장 작업 공간">${flowUI?.sidebar(page)||''}<div class="nav-group">${flowRole()==='owner'?'원장실':'업무 공간'}</div>${link('home',flowRole()==='owner'?'브리핑':flowRole()==='manager'?'업무 조율':'내 업무','home',flowRole()!=='owner'&&count?`<span class="nav-count" aria-label="업무 ${count}건">${count}</span>`:'')}${link('inbox','알림','message',flowRole()==='owner'&&count?`<span class="nav-count" aria-label="안 읽음 ${count}건">${count}</span>`:'')}${['owner','manager'].includes(flowRole())?link('requests','요청한 업무','check',reqs().length?`<span class="nav-count">${reqs().length}</span>`:''):''}${flowRole()==='owner'?link('automation','자동화','settings'):''}${workspaces?.sidebar(page)||''}${window.V2Screens?.sidebar(page)||''}<div class="nav-group">AI · 알림 채널</div>${tool('data-ax="chat"','AI 업무 지원','message',`<span class="nav-count" ${chat.pending?'':'hidden'}>응답 중</span>`)}${tool('data-ax="digest"','슬랙 브리핑','arrow')}${tool('data-action="notes"','검토 메모','book')}<div class="nav-group">바로 요청</div>${tool('data-ax="request" data-id=""','업무 요청','plus')}${tool('data-ax="launcher"','전체 업무','search')}<div class="ax-sidebar-summary"><strong>처리 현황</strong>${Object.entries(STATUS).map(([id,label])=>`<p>${label} ${reqs().filter(r=>r.status===id).length}건</p>`).join('')}${reports?`<p>완료 보고 중 안 읽음 ${unreadReports().length}건</p>`:''}</div></nav><div class="sidebar-bottom">${link('settings','학원 설정','settings')}<div class="profile"><div><strong>원장님</strong><small>${h(db.meta.tenant)}</small></div></div></div>`;
    $('.nav-scroll').scrollTop=offset;
    $('#topbar').innerHTML=`<button type="button" class="button ax-menu-button" data-action="menu" aria-controls="sidebar" aria-expanded="${document.body.classList.contains('menu-open')}" aria-label="메뉴 열기${count?` · 안 읽은 알림 ${count}건`:''}">${icon('menu')}<span>메뉴</span>${count?`<span class="ax-menu-count" aria-hidden="true">${count}</span>`:''}</button><strong class="ax-mobile-title">aywa · ${h(db.meta.tenant)}</strong>`;
  }
  /* Catalog seam: the comprehensive 2.0 catalog arrives separately. A later script can set
     window.AxCatalog={areas:[{id,label,group,page?,note?}]} and dispatch 'ax-catalog'. Areas whose page is
     not wired here are listed as not yet connected. Without a catalog only this prototype's screens are shown. */
  const builtInAreas=()=>Object.entries(labels).filter(([id])=>!['home','inbox','requests','automation'].includes(id)).map(([page,label])=>({id:page,label,group:'열 수 있는 화면',page}));
  const catalogAreas=()=>Array.isArray(window.AxCatalog?.areas)&&window.AxCatalog.areas.length?window.AxCatalog.areas:builtInAreas();
  function launcherList(query=''){
    const q=norm(query),areas=catalogAreas().filter(a=>!q||norm(`${a.label} ${a.group||''}`).includes(q)),groups=[...new Set(areas.map(a=>a.group||'기타'))];
    return groups.map(g=>`<section><h3>${h(g)}</h3><div class="ax-launcher">${areas.filter(a=>(a.group||'기타')===g).map(a=>api.hasView(a.page)?button(a.label,'navigate',a.page):`<span class="button ax-unlinked">${h(a.label)} · 연결 전${a.note?`<small>${h(a.note)}</small>`:''}</span>`).join('')}</div></section>`).join('')||'<p class="live-empty">검색 결과가 없습니다.</p>';
  }
  function launcher(){
    const full=Array.isArray(window.AxCatalog?.areas)&&window.AxCatalog.areas.length;
    dialog('modal','전체 업무',full?'‘연결 전’ 항목은 아직 열 수 없습니다.':'지금 열 수 있는 화면입니다.',`<div class="ax-launcher-wrap"><input id="ax-launcher-search" type="search" aria-label="업무 검색" placeholder="업무 이름 검색" autocomplete="off"><div id="ax-launcher-list">${launcherList()}</div></div>`);
  }
  window.addEventListener('ax-catalog',()=>{if($('#ax-launcher-list'))$('#ax-launcher-list').innerHTML=launcherList($('#ax-launcher-search').value);});

  /* ---------- Events ---------- */
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-ax]');if(!el)return;event.preventDefault();event.stopImmediatePropagation();
    const {ax:action,id,prompt,type}=el.dataset;
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='navigate'){navigate(id);return;}
    if(action==='filter'){ui.filter=id;render();return;}
    if(action==='focus-issue'){ui.read.add(id);ui.archived.delete(id);ui.filter='all';render();requestAnimationFrame(()=>focusIssue(id));return;}
    if(action==='focus-list'){focusIssue('list');return;}
    if(action==='open-issue'){ui.read.add(id);ui.archived.delete(id);ui.filter='all';ui.focusIssue=id;ui.focusRouted=!(api.getPage()==='home'&&location.hash==='#home');navigate('home');return;}
    if(action==='expand'){const list=$(`#ax-records-${id}`),open=list.dataset.collapsed==='true',more=list.querySelectorAll('.ax-more').length,unit=findIssue(id)?.unit||'건';list.dataset.collapsed=String(!open);el.setAttribute('aria-expanded',String(open));el.textContent=open?'접기':`나머지 ${more}${unit} 더 보기`;if(open)ui.expanded.add(id);else ui.expanded.delete(id);return;}
    if(action==='request'){showRequest({issues:id?[id]:[]});return;}
    if(action==='draft-reset'){ui.drafts.delete(id);showRequest(ui.requestArgs||{});return;}
    if(action==='request-detail'){ui.reportRead.add(id);document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);return;}
    if(action==='request-start'||action==='request-reopen'){const r=ui.requests.find(r=>r.id===id);if(!r)return;r.status='working';r.events.push({label:action==='request-start'?'담당자 확인':'추가 확인 요청',text:action==='request-start'?'담당자 대신 확인을 남겼습니다.':'원장이 추가 확인을 요청했습니다. 기존 보고는 보존됩니다.'});render();showRequestDetail(id);return;}
    if(action==='record'){const f={student:api.showStudent,bill:api.showBill,approval:api.showApproval,task:api.showTask}[type];if(f)f(id);else navigate({lead:'admissions',book:'resources'}[type]);return;}
    if(action==='read'||action==='archive'){const set=action==='read'?ui.read:ui.archived;if(set.has(id))set.delete(id);else set.add(id);render();if(action==='archive'&&ui.archived.has(id))$('#ax-issues-title')?.focus({preventScroll:true});return;}
    if(action==='read-all'){issues().forEach(i=>ui.read.add(i.id));reqs().filter(r=>r.status==='done').forEach(r=>ui.reportRead.add(r.id));render();return;}
    if(action==='inbox-tab'){ui.inbox=id;render();return;}
    if(action==='digest'){digestPreview();return;}
    if(action==='slack'){slackPreview({issueId:id});return;}
    if(action==='request-slack'||action==='report-slack'){slackPreview({requestId:id,report:action==='report-slack'});return;}
    if(action==='ask'){chat.context=id;chat.topic='';showChat();const input=$('#ax-chat-command');if(!input.value){const title=findIssue(id)?.title;input.value=`${title?`‘${title}’ 이슈`:'이 이슈'}를 정리하고, 누구에게 무엇을 요청하면 좋을지 알려줘`;}input.focus();return;}
    if(action==='prompt'){ask(prompt);return;}
    if(action==='chat'){showChat();return;}
    if(action==='chat-cancel'){if(chat.pending?.turn.id===id)chat.pending.controller.abort();return;}
    if(action==='chat-retry'){const turn=chat.turns.find(t=>t.id===id);if(turn)sendTurn(turn);return;}
    if(action==='chat-context-clear'){chat.context=null;chat.topic='';updateChat();return;}
    if(action==='chat-task'){const t=chat.turns.find(x=>x.id===id);if(!t?.suggestedTask)return;showRequest({issues:[...new Set([t.context,...t.issueIds].filter(x=>x&&findIssue(x)))],title:t.suggestedTask.title,body:t.suggestedTask.body,source:'chat',draftKey:`chat:${t.id}`,context:t.task?{family:t.task.area,familyLabel:t.task.areaLabel}:undefined});axChat?.attachTo(document.querySelector('#modal form[data-ax-form="request"]'),t.task);return;}
    if(action==='launcher'){launcher();return;}
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&(event.isComposing||event.keyCode===229)&&event.target.matches?.('#ax-home-command,#ax-chat-command')){event.preventDefault();return;}
    if(event.key==='Enter'&&!event.shiftKey&&event.target.matches?.('#ax-chat-command')){event.preventDefault();event.target.form.requestSubmit();}
  },true);
  document.addEventListener('input',event=>{
    if(event.target.dataset?.cpickName==='owner'&&window.ContextPicker?.value(event.target).length){const form=event.target.closest('form');if(form)form.querySelector('.ax-form-error').textContent='';}
    if(event.target.id==='ax-home-command')ui.homePrompt=event.target.value;
    if(event.target.id==='ax-launcher-search'&&!event.isComposing)$('#ax-launcher-list').innerHTML=launcherList(event.target.value);
    const form=event.target.closest?.('form[data-ax-form="request"]');if(form)saveDraft(form);
  });
  document.addEventListener('compositionend',event=>{if(event.target.id==='ax-launcher-search')$('#ax-launcher-list').innerHTML=launcherList(event.target.value);});
  document.addEventListener('change',event=>{const key=event.target.dataset.axSetting;if(key)ui[key]=event.target.checked;const form=event.target.closest?.('form[data-ax-form="request"]');if(form)saveDraft(form);});
  document.addEventListener('submit',event=>{
    const form=event.target,kind=form.dataset.axForm;if(!kind)return;event.preventDefault();event.stopImmediatePropagation();
    if(kind==='request'){submitRequest(form);return;}
    if(!form.reportValidity())return;
    const values=new FormData(form);
    if(kind==='chat'){const field=form.querySelector('[name=prompt]');if(ask(values.get('prompt'))){field.value='';if(field.id==='ax-home-command')ui.homePrompt='';}return;}
    if(kind==='result'){const r=ui.requests.find(r=>r.id===values.get('request')),result=String(values.get('result')||'').trim();if(!r||!result)return;r.status='done';r.result=result;ui.reportRead.delete(r.id);r.events.push({label:'완료 보고',text:result});render();showRequestDetail(r.id);toast('완료 보고가 원장 알림에 도착했습니다.');}
  },true);
  function decorateView(){
    const page=api.getPage();
    fillAttendanceTable();
    if(flowUI?.fillRecords)document.querySelectorAll('[data-ax-recs]').forEach(el=>{const refs=ui.recRefs.get(el.dataset.axRecs);if(refs)flowUI.fillRecords(el,refs);});
    if(page==='home'&&ui.focusIssue){const id=ui.focusIssue,instant=ui.focusRouted;ui.focusIssue=null;requestAnimationFrame(()=>focusIssue(id,{instant}));}
    else if(!['home','flow','inbox','requests','automation'].includes(page)&&!page.startsWith('workspace-')&&$('main h1'))$('main h1').textContent=labels[page]||$('main h1').textContent;
  }
  const requestsForFamily=family=>reqs().filter(r=>r.context?.family===family);
  // Recipient preview (teacher workspace): the selected staff member acknowledges and reports locally; the report returns
  // to the owner's notifications exactly like the simulation in the request detail. Automatic 2.0 tasks are not touched.
  const recipient={
    list:staffId=>reqs().filter(r=>r.owners.includes(staffId)),
    owners:()=>[...new Set(reqs().flatMap(r=>r.owners))],
    acknowledge(id,staffName,staffId){if(flowUI?.ready()&&flowUI.caseById(id)){flowUI.actAs('case.ack',id,staffId).then(r=>{if(r)toast(`${staffName}님의 확인을 업무 흐름에 남겼습니다.`);});return true;}const r=ui.requests.find(x=>x.id===id);if(!r||r.status!=='requested')return false;r.status='working';r.events.push({label:'담당자 확인',text:`${staffName}님이 확인했습니다.`});render();toast(`${staffName}님의 확인을 반영했습니다.`);return true;},
    complete(id,staffName,result,staffId){if(flowUI?.ready()&&flowUI.caseById(id)){const note=String(result||'').trim();if(!note)return false;flowUI.actAs('case.report',id,staffId,{note}).then(r=>{if(r)toast('완료 보고가 업무 흐름에 남고 원장 알림으로 갑니다.');});return true;}const r=ui.requests.find(x=>x.id===id),text=String(result||'').trim();if(!r||r.status!=='working'||!text)return false;r.status='done';r.result=text;ui.reportRead.delete(r.id);r.events.push({label:'완료 보고',text:`${staffName}: ${text}`});render();toast('완료 보고가 원장 알림에 도착했습니다.');return true;},
  };
  return {home,inbox,requests,automation,decorateShell,decorateView,showRequest,requestsFor:requestsForFamily,openChat,recipient,useWorkspaces:w=>{workspaces=w;},useFlow:f=>{flowUI=f;}};
};
