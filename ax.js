/* Local AX prototype — 3.0 structure (signal → issue → request → report) in the 2.0 type and control format.
   Facts come from the verified local copy. Requests, reports and Slack previews stay in this tab only.
   The single network call is the assistant: POST /api/assistant, answered by the local backend (Claude CLI).
   No canned answer is ever shown in its place; failures are reported and can be retried. */
window.createOwnerWorkspace = function createOwnerWorkspace(api) {
  'use strict';
  const {db,h,fmt,won,icon,chart,dialog,navigate,render,toast}=api;
  const $=s=>document.querySelector(s);
  const current=()=>db.trend.find(t=>t.month===db.meta.month);
  const total=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
  const staffById=new Map(db.staff.map(s=>[s.id,s]));
  const ui={filter:'all',inbox:'unread',read:new Set(),reportRead:new Set(),archived:new Set(),expanded:new Set(),requests:[],drafts:new Map(),requestArgs:null,focusIssue:null,homePrompt:'',rule:true,slack:true,app:true};
  const chat={turns:[],context:null,pending:null};
  // Limits mirror the backend contract (prompt ≤1000, history ≤12 items, each ≤2000, total ≤8000, server timeout 90s).
  const ASSISTANT={endpoint:'/api/assistant',promptLimit:1000,historyItems:12,historyItemLimit:2000,historyTotal:8000,timeoutMs:120000};
  const RECORDS_SHOWN=8;
  const SIGNAL_ORDER=['approval','billing','tasks','admissions','attendance','books','enrollment'];
  const FILTERS=[['all','전체',null],['decide','결정 필요','결정 필요'],['check','확인 필요','확인 필요'],['progress','진행 확인','진행 확인'],['change','변화','변화 감지']];
  const STATUS={requested:'확인 대기',working:'진행 중',done:'완료 보고'};
  const PROVIDERS={'claude-cli':'Claude · 로컬 CLI'};
  const labels={home:'브리핑',inbox:'알림',requests:'요청한 업무',automation:'자동화',students:'원생목록',admissions:'신규 콜&상담',classes:'수업목록 · 시간표',learning:'성적관리 · 수업보고서',finance:'수납관리',staff:'직원관리',parents:'학부모 소통',shuttle:'셔틀',approvals:'전자결재 · 할 일',resources:'교재 · 재고 · 서식',calendar:'캘린더',settings:'학원 설정'};
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const button=(text,action,id='',primary=false,attrs='')=>`<button type="button" class="button ${primary?'primary':''}" data-ax="${action}" data-id="${h(id)}" ${attrs}>${h(text)}</button>`;
  const caption=`${db.meta.asOf.replaceAll('-','.')} 복사본 기준`;
  const names=ids=>ids.map(id=>staffById.get(id)?.name||'담당자').join(', ');
  const clip=(text,limit)=>String(text??'').slice(0,limit);
  const norm=text=>String(text??'').toLowerCase().replace(/\s+/g,'');
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

  function issues(){
    const now=current(),prev=db.trend.find(t=>t.month===db.trend.at(-2).month),delta=now.payingStudents-prev.payingStudents;
    const bills=db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0);
    const leads=db.admissions.filter(a=>a.date.startsWith(db.meta.month)&&['scheduled','consulted','ai_done'].includes(a.outcome));
    const absent=db.students.filter(s=>s.status==='enrolled'&&s.attendance.absent>=3).sort((a,b)=>b.attendance.absent-a.attendance.absent);
    const pending=db.approvals.filter(a=>a.status==='pending');
    const overdue=db.tasks.filter(t=>t.status==='open'&&t.due&&t.due<db.meta.asOf);
    const books=db.textbooks.filter(t=>['requested','ordered'].includes(t.status));
    const items=[
      {id:'billing',category:'수납',title:`수납 확인 ${bills.length}건`,signal:'남은 수납',note:`${bills.length}건 · ${Number(db.meta.month.slice(5))}월 청구분`,summary:`${won(total(bills,'remaining'))}이 남아 있습니다. 납부 확인 후 필요한 가정에만 안내해 주세요.`,value:won(total(bills,'remaining')),priority:'확인 필요',page:'finance',count:bills.length,source:'수납관리 · 청구·할인·수납 기록',facts:[`${db.meta.month} 청구분의 현재 잔액입니다.`,`할인 ${won(total(bills,'discount'))}을 반영하고 취소·환불은 제외했습니다.`,`완납 기록은 요청 대상에 포함하지 않습니다.`],records:bills.map(i=>({id:i.id,type:'bill',name:i.name,detail:won(i.remaining)})),unit:'건',request:'수납 잔액 확인 및 후속 안내',suggestion:'대상별 납부 내역을 확인해 주세요. 이미 납부한 건은 먼저 대조하고, 안내가 필요한 경우 보호자에게 연락한 뒤 결과를 남겨 주세요.'},
      {id:'admissions',category:'상담',title:`상담 후속 확인 ${leads.length}건`,signal:'상담 후속',note:`이번 달 접수 ${now.inquiries}건 중 상담·검토 상태`,summary:`이번 달 접수 ${now.inquiries}건 중 상담·검토 상태인 ${leads.length}건의 다음 약속을 확인해 주세요.`,value:`${leads.length}건`,priority:'확인 필요',page:'admissions',count:leads.length,source:'신규 콜&상담 · 접수월과 현재 결과',facts:['접수월이 이번 달인 상담만 포함합니다.',`현재 등록 상태 ${now.registered}건은 별도로 집계했습니다.`,'연락 기한이 지났다는 뜻은 아닙니다. 다음 약속 유무를 확인하는 요청입니다.'],records:leads.map(a=>({id:a.id,type:'lead',name:a.name,detail:a.teacher})),unit:'건',request:'상담 후속 일정 확인',suggestion:'상담 내용과 다음 약속을 확인하고, 추가 연락이 필요한 원생의 상담 일정을 정리해 주세요. 등록 여부가 바뀐 경우 함께 보고해 주세요.'},
      {id:'attendance',category:'출결',title:`출결 특이사항 ${absent.length}명`,signal:'출결 특이사항',note:'이번 달 결석 3회 이상 재원생',summary:'이번 달 결석 기록이 3회 이상인 재원생입니다. 사유와 보강 계획을 담임에게 확인할 수 있습니다.',value:`${absent.length}명`,priority:'확인 필요',page:'students',count:absent.length,source:'출석부 · 수정 반영 후 유효한 출결 기록',facts:['기준: 재원 상태이며 이번 달 결석 기록이 3회 이상인 원생.','횟수는 수업별 출결 건수입니다. 연속 결석일이나 퇴원 위험 점수가 아닙니다.','현재 기록만으로 사유를 단정하지 않습니다.'],records:absent.map(s=>({id:s.id,type:'student',name:s.name,detail:`결석 ${s.attendance.absent}회 / 출결 ${s.attendance.total}회`})),unit:'명',request:'결석 사유 및 보강 계획 확인',suggestion:'대상 원생의 결석 사유와 보호자 연락 여부를 확인해 주세요. 보강이 필요한 경우 가능한 일정과 후속 계획을 함께 보고해 주세요.'},
      {id:'approval',category:'결재',title:`결재 대기 ${pending.length}건`,signal:'결재 대기',note:pending[0]?`${String(pending[0].title).split(' — ')[0]} · ${pending[0].drafter}${pending.length>1?` 외 ${pending.length-1}건`:''}`:'',summary:'결재 문서와 결재선을 확인하고, 필요한 보완 내용을 담당자에게 요청하세요.',value:`${pending.length}건`,priority:'결정 필요',page:'approvals',count:pending.length,source:'전자결재 · 대기 상태 문서',facts:['현재 결재 대기 상태인 문서입니다.','원장 검토와 담당자 보완 요청을 분리합니다.'],records:pending.map(a=>({id:a.id,type:'approval',name:a.title,detail:a.drafter})),unit:'건',request:'결재 문서 검토 및 보완',suggestion:'결재 문서의 내용과 첨부 근거를 확인하고, 보완할 사항이 있으면 정리해서 보고해 주세요.'},
      {id:'tasks',category:'업무',title:`기한 지난 업무 ${overdue.length}건`,signal:'기한 지난 후속',note:'완료 표시 없는 업무 · 담당자 확인',summary:'기한이 지났고 완료 표시가 없는 업무입니다. 실제 완료 여부와 새 일정을 확인해 주세요.',value:`${overdue.length}건`,priority:'확인 필요',page:'approvals',count:overdue.length,source:'할 일 · 기한·완료 상태',facts:['등록된 기한이 기준일보다 이전인 진행 중 업무입니다.','완료 표시가 누락됐을 수 있으므로 담당자 확인이 먼저입니다.'],records:overdue.map(t=>({id:t.id,type:'task',name:t.title,detail:t.owners.join(', ')||'담당 미지정'})),unit:'건',request:'미완료 업무 진행 확인',suggestion:'현재 진행 상황과 완료 예정일을 알려 주세요. 이미 처리한 업무는 결과를 남기고 완료 상태를 정리해 주세요.'},
      {id:'books',category:'교재',title:`교재 진행 확인 ${books.length}건`,signal:'교재 진행',note:'요청·주문 상태 · 전달 확인',summary:'요청·주문 상태의 교재입니다. 주문과 전달 여부를 확인할 수 있습니다.',value:`${books.length}건`,priority:'진행 확인',page:'resources',count:books.length,source:'교재 요청 · 주문·전달 상태',facts:['요청 또는 주문 상태의 기록입니다.','전달 기한이 없으므로 배송 지연으로 판단하지 않습니다.'],records:books.map(t=>({id:t.id,type:'book',name:t.name,detail:t.student})),unit:'건',request:'교재 주문 및 전달 확인',suggestion:'요청·주문 상태인 교재의 주문 내역과 전달 여부를 확인하고, 미전달 사유가 있으면 알려 주세요.'},
      {id:'enrollment',category:'경영',title:`청구 대상 ${Math.abs(delta)}명 ${delta<0?'감소':delta>0?'증가':'유지'}`,signal:'청구 대상 변화',note:`지난달 ${prev.payingStudents}명 → 이번 달 ${now.payingStudents}명`,summary:`지난달 ${prev.payingStudents}명에서 이번 달 ${now.payingStudents}명으로 변했습니다. 원생 상태와 수강 변동을 함께 확인해 주세요.`,value:`${delta>0?'+':''}${delta}명`,priority:'변화 감지',page:'students',count:Math.abs(delta),source:'수납관리 · 월별 고유 수강료 청구 대상',facts:['현재 재원 수와 다른 지표입니다.','청구 대상의 증감을 퇴원 인원으로 해석하지 않습니다.','기간별 수강·청구 여부를 대조해야 원인을 확인할 수 있습니다.'],records:[],unit:'명',request:'청구 대상 변동 원인 확인',suggestion:'지난달과 이번 달의 수강료 청구 대상을 대조해 주세요. 신규·휴원·퇴원·청구 누락 등 확인된 사유를 구분해 보고해 주세요.'},
    ];
    return items.filter(i=>i.count>0).sort((a,b)=>SIGNAL_ORDER.indexOf(a.id)-SIGNAL_ORDER.indexOf(b.id));
  }
  const findIssue=id=>issues().find(i=>i.id===id);
  const requestsFor=id=>ui.requests.filter(r=>r.issues.includes(id));
  const issueState=id=>{const rs=requestsFor(id);return rs.some(r=>r.status!=='done')?'처리 중':rs.length?'결과 도착':ui.read.has(id)?'확인함':'미확인';};
  const unreadReports=()=>ui.requests.filter(r=>r.status==='done'&&!ui.reportRead.has(r.id));
  const unread=()=>issues().filter(i=>!ui.read.has(i.id)&&!ui.archived.has(i.id)).length+unreadReports().length;

  /* ---------- Briefing: first screen = critical signals, compact change, command. Detail follows by page scroll. ---------- */
  // Stretchable trend line that grows into spare first-screen height on desktop. The vertical range is at least
  // 10% of the mean around the data, so a 2% change never reads as a cliff when the chart is tall.
  function spark(rows,key,label){
    const values=rows.map(r=>Number(r[key]||0)),lo=Math.min(...values),hi=Math.max(...values),mean=values.reduce((n,v)=>n+v,0)/values.length;
    const span=Math.max(hi-lo,Math.abs(mean)*.1,1),min=(lo+hi)/2-span/2;
    const points=values.map((v,i)=>`${2+i*(96/Math.max(values.length-1,1))},${36-(v-min)/span*32}`).join(' ');
    return `<span class="ax-trend"><svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${h(label)} ${rows.map(r=>`${r.month} ${key==='paid'?won(r[key]):`${fmt(r[key])}명`}`).join(', ')}"><line x1="0" x2="100" y1="39" y2="39" vector-effect="non-scaling-stroke"/><polyline points="${points}" vector-effect="non-scaling-stroke"/></svg><span class="ax-trend-months" aria-hidden="true">${rows.map(r=>`<span>${Number(r.month.slice(5))}월</span>`).join('')}</span></span>`;
  }
  function issueSignal(issue){
    return `<button type="button" class="ax-signal" data-ax="focus-issue" data-id="${issue.id}"><span class="ax-signal-kind">${pill(issue.priority,issue.priority==='결정 필요'?'amber':'blue')}<span>${h(issue.signal)}</span></span><strong class="ax-signal-value">${h(issue.value)}</strong><span class="ax-signal-title">${h(issue.note||issue.title)}</span><span class="ax-signal-go">근거 보기 ${icon('down')}</span></button>`;
  }
  function reportSignal(reports){
    return `<button type="button" class="ax-signal report" data-ax="request-detail" data-id="${reports[0].id}"><span class="ax-signal-kind">${pill('결과 도착','green')}<span>완료 보고</span></span><strong class="ax-signal-value">${reports.length}건</strong><span class="ax-signal-title">${h(reports[0].title)}${reports.length>1?` 외 ${reports.length-1}건`:''}</span><span class="ax-signal-go">보고 확인 ${icon('chevron')}</span></button>`;
  }
  function changeStrip(all){
    const rows=db.trend.filter(t=>db.months.includes(t.month)),last=rows.at(-1),prev=rows.at(-2),delta=last.payingStudents-prev.payingStudents;
    const range=`${Number(rows[0].month.slice(5))}~${Number(last.month.slice(5))}월`,firstMonth=`${Number(rows[0].month.slice(5))}월`,open=ui.requests.filter(r=>r.status!=='done').length,sign=n=>`${n>0?'+':''}${fmt(n)}`;
    const enrollment=all.some(i=>i.id==='enrollment')?'data-ax="focus-issue" data-id="enrollment"':'data-ax="navigate" data-id="students"';
    return `<div class="ax-change" role="group" aria-label="최근 변화"><button type="button" ${enrollment}><span>청구 대상 원생 · ${range}</span><strong>${fmt(last.payingStudents)}명</strong><small>전월 대비 ${sign(delta)}명 · ${firstMonth} 대비 ${sign(last.payingStudents-rows[0].payingStudents)}명</small>${spark(rows,'payingStudents','청구 대상 원생')}</button><button type="button" data-ax="navigate" data-id="finance"><span>청구월별 누적 수납 · ${range}</span><strong>${won(last.paid)}</strong><small>${Number(last.month.slice(5))}월 수납률 ${last.billed?`${fmt(last.paid/last.billed*100)}%`:'기록 없음'}${rows[0].paid?` · ${firstMonth} 대비 ${sign(Math.round((last.paid/rows[0].paid-1)*1000)/10)}%`:''}</small>${spark(rows,'paid','청구월별 누적 수납')}</button><button type="button" data-ax="navigate" data-id="requests"><span>요청 진행</span><strong>${open}건 진행 중</strong><span class="ax-stages">${Object.entries(STATUS).map(([id,label])=>`<span><b>${ui.requests.filter(r=>r.status===id).length}</b>${label}</span>`).join('')}</span><span class="ax-recent">${ui.requests.length?ui.requests.slice(-3).reverse().map(r=>`<span><b>${h(r.title)}</b><small>${STATUS[r.status]} · ${h(names(r.owners))}</small></span>`).join(''):'<small>아직 보낸 요청이 없습니다. 이슈에서 ‘업무 요청’을 보내면 여기서 진행을 확인합니다.</small>'}</span></button></div>`;
  }
  const waitNote=()=>`<p class="ax-command-wait" role="status">이전 질문의 응답을 기다리고 있습니다. ${button('대화 열기','chat')}</p>`;
  function commandForm(){
    const waiting=chat.pending?waitNote():'';
    return `<form class="ax-command" data-ax-form="chat"><label for="ax-home-command">AI 업무 지원 <span>Claude가 학원 기록을 바탕으로 답하고, 필요한 업무 요청안을 제안합니다.</span></label><div class="ax-command-row"><input id="ax-home-command" name="prompt" required maxlength="${ASSISTANT.promptLimit}" autocomplete="off" enterkeyhint="send" value="${h(ui.homePrompt)}" placeholder="예: 미수납 확인을 누구에게 요청할지 정리해줘"><button class="button primary" type="submit">보내기</button></div><div class="ax-suggestions" aria-label="질문 예시">${['전체 이슈를 우선순위로 정리해줘','청구 대상 원생 변화를 설명해줘','기한 지난 업무를 누구에게 확인할까?'].map(q=>`<button type="button" data-ax="prompt" data-prompt="${h(q)}">${h(q)}</button>`).join('')}</div>${waiting}</form>`;
  }
  function firstScreen(all){
    const reports=unreadReports(),top=all.filter(i=>i.id!=='enrollment').slice(0,3),rest=all.length-top.length;
    return `<section class="ax-first" aria-labelledby="ax-first-title"><div class="ax-first-head"><h2 id="ax-first-title">지금 확인할 일</h2>${rest>0?`<span>그 밖의 이슈 ${rest}건은 아래 전체 목록에 있습니다.</span>`:''}</div><div class="ax-signals">${reports.length?reportSignal(reports):''}${top.map(issueSignal).join('')||'<p>지금 확인할 신호가 없습니다.</p>'}</div>${changeStrip(all)}${commandForm()}</section>`;
  }
  function recordList(issue){
    if(!issue.records.length)return '';
    const open=ui.expanded.has(issue.id),more=issue.records.length-RECORDS_SHOWN;
    return `<section class="ax-records"><div class="ax-section-head"><h4>확인 대상 ${issue.records.length}${issue.unit}</h4>${button('전체 기록','navigate',issue.page)}</div><ul class="ax-record-list" id="ax-records-${issue.id}" data-collapsed="${!open}">${issue.records.map((r,i)=>`<li class="${i>=RECORDS_SHOWN?'ax-more':''}"><button type="button" data-ax="record" data-type="${r.type}" data-id="${h(r.id)}"><strong>${h(r.name)}</strong><span>${h(r.detail)}</span>${icon('chevron')}</button></li>`).join('')}</ul>${more>0?`<button type="button" class="ax-text-link" id="ax-expand-${issue.id}" data-ax="expand" data-id="${issue.id}" aria-controls="ax-records-${issue.id}" aria-expanded="${open}">${open?'접기':`나머지 ${more}${issue.unit} 더 보기`}</button>`:''}</section>`;
  }
  function issueSection(issue){
    const related=requestsFor(issue.id);
    return `<article class="ax-issue" id="ax-issue-${issue.id}" tabindex="-1" aria-labelledby="ax-issue-${issue.id}-title"><header><div class="ax-issue-meta">${pill(issue.category)}${pill(issue.priority,issue.priority==='결정 필요'?'amber':issue.priority==='변화 감지'?'blue':'')}${pill(issueState(issue.id),issueState(issue.id)==='결과 도착'?'green':'')}</div><h3 id="ax-issue-${issue.id}-title">${h(issue.title)}</h3><p class="ax-summary">${h(issue.summary)}</p><div class="ax-actions">${button('업무 요청','request',issue.id,true)}${button('이 이슈로 대화','ask',issue.id)}${button('슬랙 알림 보기','slack',issue.id)}</div></header><div class="ax-issue-body ${issue.records.length||issue.id==='enrollment'?'':'single'}"><section class="ax-evidence"><h4>확인 근거</h4><ul>${issue.facts.map(f=>`<li>${h(f)}</li>`).join('')}</ul><p class="ax-source">${h(issue.source)} · ${caption}</p></section>${issue.id==='enrollment'?`<section class="ax-records">${chart(db.trend.filter(t=>db.months.includes(t.month)),'payingStudents','명',{label:'청구 대상 원생'})}</section>`:recordList(issue)}</div>${related.length?`<section class="ax-linked"><h4>연결된 요청 ${related.length}건</h4>${related.map(requestRow).join('')}</section>`:''}<footer class="ax-issue-footer">${button(ui.read.has(issue.id)?'확인 취소':'확인함','read',issue.id,false,`id="ax-read-${issue.id}"`)}${button('보관','archive',issue.id,false,`id="ax-archive-${issue.id}"`)}<span>확인함은 업무 완료와 별개입니다.</span></footer></article>`;
  }
  function issueList(all){
    const available=FILTERS.filter(f=>!f[2]||all.some(i=>i.priority===f[2]));if(!available.some(f=>f[0]===ui.filter))ui.filter='all';
    const filter=available.find(f=>f[0]===ui.filter),shown=filter[2]?all.filter(i=>i.priority===filter[2]):all;
    return `<section class="ax-issues" id="ax-issues" aria-labelledby="ax-issues-title"><div class="ax-section-head"><h2 id="ax-issues-title" tabindex="-1">전체 이슈와 근거 ${all.length}건</h2><div class="ax-filter" role="group" aria-label="이슈 필터">${available.map(([id,label])=>`<button type="button" id="ax-filter-${id}" data-ax="filter" data-id="${id}" aria-pressed="${ui.filter===id}">${label}</button>`).join('')}</div></div><div class="ax-issue-stack">${shown.map(issueSection).join('')||'<p class="live-empty">이 조건의 이슈가 없습니다.</p>'}</div></section>`;
  }
  function requestRow(r){
    return `<button type="button" class="ax-request-row" data-ax="request-detail" data-id="${r.id}"><span><strong>${h(r.title)}</strong><small>${h(names(r.owners))} · ${h(r.due)}까지</small></span>${pill(STATUS[r.status],r.status==='done'?'green':'blue')}${icon('chevron')}</button>`;
  }
  /* Record-domain coverage: what this prototype reads. It is not the full 2.0 feature list (see the catalog seam below). */
  function coverage(){
    const domains=[['수납',db.invoices.length,'finance'],['원생',db.students.length,'students'],['상담',db.admissions.length,'admissions'],['수업',db.classes.length,'classes'],['학습',db.learning.gradesCount,'learning'],['학부모',db.messages.length,'parents'],['직원',db.staff.length,'staff'],['차량',db.runs.length,'shuttle'],['업무',db.tasks.length,'approvals'],['결재',db.approvals.length,'approvals'],['교재·자산',db.textbooks.length+db.assetCount,'resources'],['일정',db.calendar.length,'calendar']];
    return `<section class="ax-coverage"><div class="ax-section-head"><h2>기록 영역별 확인</h2><span>이 시안이 읽는 기록 영역입니다. 기록이 없는 항목을 정상으로 판정하지 않습니다.</span></div><div class="ax-domain-grid">${domains.map(([name,count,page])=>`<button type="button" data-ax="navigate" data-id="${page}"><strong>${name}</strong><span>${count?`${fmt(count)}건의 기록`:'기록 없음'}</span>${icon('chevron')}</button>`).join('')}</div></section>`;
  }
  function home(){
    const all=issues().filter(i=>!ui.archived.has(i.id)),open=ui.requests.filter(r=>r.status!=='done').length;
    return `<div class="ax-fold"><div class="page-heading"><div><h1>브리핑</h1><p>${caption} · 현재 재원 ${fmt(db.students.filter(s=>s.status==='enrolled').length)}명 · 확인할 이슈 ${all.length}건 · 진행 중 요청 ${open}건</p></div><div class="heading-actions">${button('직접 업무 요청','request','',true)}</div></div>${firstScreen(all)}<button type="button" class="ax-scroll-cue" data-ax="focus-list"><span><strong>전체 이슈 ${all.length}건과 근거</strong><small>아래로 스크롤하거나 눌러서 이동합니다</small></span>${icon('down')}</button></div>${issueList(all)}<section class="ax-request-summary"><div class="ax-section-head"><h2>요청한 업무</h2>${button('전체 보기','navigate','requests')}</div>${ui.requests.length?ui.requests.slice(-3).reverse().map(requestRow).join(''):'<p>이슈의 ‘업무 요청’에서 담당자와 기한을 지정하면 이곳에 진행 상황이 모입니다.</p>'}</section>${coverage()}`;
  }
  function focusIssue(id){
    const node=document.getElementById(id==='list'?'ax-issues':`ax-issue-${id}`);if(!node)return;
    const target=id==='list'?$('#ax-issues-title'):node;
    node.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});target.focus({preventScroll:true});
    node.classList.add('ax-flash');setTimeout(()=>node.classList.remove('ax-flash'),1600);
  }

  /* ---------- Inbox / requests / automation ---------- */
  function inbox(){
    const items=issues().filter(i=>ui.inbox==='archived'?ui.archived.has(i.id):!ui.archived.has(i.id)&&(ui.inbox!=='unread'||!ui.read.has(i.id)));
    const reports=ui.inbox==='archived'?[]:ui.requests.filter(r=>r.status==='done'&&(ui.inbox!=='unread'||!ui.reportRead.has(r.id)));
    return `<div class="page-heading"><div><h1>알림</h1><p>${caption} · 이슈와 완료 보고를 한곳에서 확인합니다.</p></div><div class="heading-actions">${button('모두 읽음','read-all')}</div></div><div class="ax-filter" role="group" aria-label="알림 보기">${[['unread',`안 읽음 ${unread()}`],['all','받은 알림'],['archived','보관함']].map(([id,label])=>`<button type="button" id="ax-inbox-${id}" data-ax="inbox-tab" data-id="${id}" aria-pressed="${ui.inbox===id}">${label}</button>`).join('')}</div><p class="ax-note">같은 이슈는 묶어서 보여줍니다. 읽음 처리와 업무 완료는 구분됩니다.</p><div class="ax-notifications">${reports.map(r=>`<article>${pill('완료 보고','green')}<h3>${h(r.title)}</h3><p class="live-pre">${h(r.result)}</p><div class="ax-actions">${button('보고 확인','request-detail',r.id,true)}${button('슬랙 완료 보고 보기','report-slack',r.id)}</div></article>`).join('')}${items.map(i=>`<article><div>${pill(i.category)}${pill(issueState(i.id))}</div><h3>${h(i.title)}</h3><p>${h(i.summary)}</p><div class="ax-actions">${button('근거 보기','open-issue',i.id)}${button('업무 요청','request',i.id,true)}${button('슬랙 보기','slack',i.id)}</div></article>`).join('')}${!items.length&&!reports.length?'<p class="live-empty">이 조건의 알림이 없습니다.</p>':''}</div>`;
  }
  function requests(){return `<div class="page-heading"><div><h1>요청한 업무</h1><p>관리자·강사의 확인부터 결과 보고까지 이어서 확인합니다.</p></div><div class="heading-actions">${button('업무 요청','request','',true)}</div></div><div class="ax-workflow" aria-label="요청 처리 단계">${Object.entries(STATUS).map(([id,label])=>`<section><h2>${label} ${pill(ui.requests.filter(r=>r.status===id).length+'건')}</h2>${ui.requests.filter(r=>r.status===id).map(requestRow).join('')||'<p>해당 단계의 요청이 없습니다.</p>'}</section>`).join('')}</div><p class="ax-note">시안에서 만든 요청입니다. 담당자에게 실제 전송되지 않으며 새로고침하면 초기화됩니다.</p>`;}
  function automation(){
    const slack=db.channels?.slack;
    return `<div class="page-heading"><div><h1>자동화</h1><p>어떤 이슈를 어디로 받고, 누가 처리할지 설정합니다.</p></div></div><section class="ax-rules"><h2>원장 브리핑</h2><p>수납 잔액, 상담 후속, 출결 특이사항, 결재 대기, 업무 기한, 교재 진행과 청구 대상 변화를 묶습니다.</p><div class="ax-rule-path"><span>업무 기록 확인</span>${icon('chevron')}<span>같은 이슈 묶기</span>${icon('chevron')}<span>원장에게 알림</span>${icon('chevron')}<span>담당자 요청·결과 보고</span></div><label><input type="checkbox" data-ax-setting="rule" ${ui.rule?'checked':''}> 브리핑 규칙 사용</label><div class="ax-channel-options"><label><input type="checkbox" data-ax-setting="app" ${ui.app?'checked':''}> 앱 알림</label><label><input type="checkbox" data-ax-setting="slack" ${ui.slack?'checked':''}> 슬랙 알림</label></div><p>${slack?.configured?`복사본의 슬랙 설정: 연결됨 · 사용 중 규칙 ${slack.enabledRules}개 · 요약 ${h(slack.digest)} · 방해금지 ${h(slack.quiet)}`:'복사본에서 슬랙 연결 설정을 찾지 못했습니다.'}</p><p class="ax-note">이 화면의 변경은 시안 설정입니다. 실제 알림 발송과 예약 실행은 연결하지 않았습니다.</p>${button('브리핑 알림 미리보기','digest')}</section>${coverage()}`;
  }

  /* ---------- Staff multi-select: searchable listbox, removable chips, hidden inputs as the single value source ---------- */
  function ownerPicker(selected){
    return `<div class="ax-picker" data-ax-picker><span class="ax-field-label" id="ax-owner-label">담당자 <span>여러 명 선택 가능</span></span><div class="ax-picker-field"><ul class="ax-picker-chips" aria-label="선택한 담당자"></ul><button type="button" class="ax-picker-trigger" id="ax-owner-trigger" data-picker-toggle aria-haspopup="listbox" aria-expanded="false" aria-controls="ax-owner-panel" aria-describedby="ax-request-error"><span data-picker-label>담당자 선택</span>${icon('down')}</button></div><div class="ax-picker-panel" id="ax-owner-panel" hidden><input type="search" class="ax-picker-search" id="ax-owner-search" role="combobox" aria-expanded="true" aria-controls="ax-owner-list" aria-autocomplete="list" aria-activedescendant="" aria-label="담당자 검색 · 이름, 직급, 부서" placeholder="이름·직급·부서 검색" autocomplete="off" enterkeyhint="done"><ul class="ax-picker-list live-scroll" id="ax-owner-list" role="listbox" aria-multiselectable="true" aria-labelledby="ax-owner-label">${db.staff.map(s=>`<li role="option" class="ax-picker-option" id="ax-owner-${h(s.id)}" data-owner="${h(s.id)}" data-search="${h(norm(`${s.name} ${s.title} ${s.department}`))}" aria-selected="false"><span class="ax-check" aria-hidden="true">${icon('check')}</span><span><strong>${h(s.name)}</strong><small>${h(s.title)} · ${h(s.department)}</small></span></li>`).join('')}</ul><p class="ax-picker-empty" role="status" aria-live="polite"></p><div class="ax-picker-foot"><span data-picker-count></span><button type="button" class="button" data-picker-done>선택 완료</button></div></div><div data-picker-inputs>${selected.filter(id=>staffById.has(id)).map(id=>`<input type="hidden" name="owner" value="${h(id)}">`).join('')}</div></div>`;
  }
  const pickerIds=root=>[...root.querySelectorAll('[data-picker-inputs] input[name=owner]')].map(i=>i.value);
  function syncPicker(root){
    const ids=pickerIds(root),people=ids.map(id=>staffById.get(id)).filter(Boolean),trigger=root.querySelector('[data-picker-toggle]');
    root.querySelector('.ax-picker-chips').innerHTML=people.map(s=>`<li class="ax-picker-chip"><span>${h(s.name)}</span><button type="button" data-picker-remove="${h(s.id)}" aria-label="${h(s.name)} 선택 해제">${icon('close')}</button></li>`).join('');
    root.querySelectorAll('[role=option]').forEach(o=>o.setAttribute('aria-selected',String(ids.includes(o.dataset.owner))));
    root.querySelector('[data-picker-label]').textContent=people.length?'담당자 추가·변경':'담당자 선택';
    trigger.setAttribute('aria-label',people.length?`담당자 추가·변경 · ${people.length}명 선택됨: ${people.map(s=>s.name).join(', ')}`:'담당자 선택 · 선택된 사람 없음');
    root.querySelector('[data-picker-count]').textContent=`${people.length}명 선택`;
    root.classList.toggle('has-value',people.length>0);
  }
  function setOwners(root,ids){
    root.querySelector('[data-picker-inputs]').innerHTML=[...new Set(ids)].filter(id=>staffById.has(id)).map(id=>`<input type="hidden" name="owner" value="${h(id)}">`).join('');
    syncPicker(root);
    const form=root.closest('form');if(ids.length&&form){form.querySelector('.ax-form-error').textContent='';root.querySelector('[data-picker-toggle]').removeAttribute('aria-invalid');}
    if(form)saveDraft(form);
  }
  const toggleOwner=(root,id)=>{const ids=pickerIds(root);setOwners(root,ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);};
  function setActive(root,option){
    root.querySelectorAll('.ax-picker-option.active').forEach(o=>o.classList.remove('active'));
    const search=root.querySelector('.ax-picker-search');search.setAttribute('aria-activedescendant',option?.id||'');
    if(option){option.classList.add('active');option.scrollIntoView({block:'nearest'});}
  }
  function filterPicker(root){
    const raw=root.querySelector('.ax-picker-search').value,query=norm(raw);let first=null,count=0;
    root.querySelectorAll('[role=option]').forEach(o=>{const show=!query||o.dataset.search.includes(query);o.hidden=!show;if(show){count++;first??=o;}});
    root.querySelector('.ax-picker-empty').textContent=count?'':`‘${raw.trim()}’와 맞는 직원이 없습니다. 이름·직급·부서를 다시 확인해 주세요.`;
    setActive(root,first);root.querySelector('.ax-picker-list').dispatchEvent(new Event('scroll'));
  }
  function openPicker(root,open,focusTrigger=false){
    const panel=root.querySelector('.ax-picker-panel'),trigger=root.querySelector('[data-picker-toggle]');
    if(panel.hidden===!open)return;
    panel.hidden=!open;trigger.setAttribute('aria-expanded',String(open));
    if(open){const search=root.querySelector('.ax-picker-search');search.value='';filterPicker(root);search.focus();}
    else if(focusTrigger)trigger.focus();
  }
  function movePicker(root,step){
    const visible=[...root.querySelectorAll('[role=option]:not([hidden])')];if(!visible.length)return;
    const index=visible.indexOf(root.querySelector('.ax-picker-option.active'));
    setActive(root,visible[step==='first'?0:step==='last'?visible.length-1:Math.min(visible.length-1,Math.max(0,index+step))]);
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
    const draft=ui.drafts.get(key);
    const value={title:draft?.title??clip(args.title??issue?.request??'',120),body:draft?.body??clip(args.body??issue?.suggestion??'',3000),owners:draft?.owners||[],due:draft?.due||db.meta.asOf,priority:draft?.priority||'보통',channels:draft?.channels||[...(ui.app?['app']:[]),...(ui.slack?['slack']:[])]};
    const linked=sources.map(findIssue).filter(Boolean);
    const lead=args.source==='chat'?'AI 제안 요청안 · 검토 후 등록할 때만 추가됩니다.':issue?`${issue.category} · 확인 대상 ${issue.records.length||'변동 근거'}${issue.records.length?issue.unit:''}`:'관리자·강사에게 요청할 내용을 작성하세요.';
    dialog('modal','업무 요청',lead,`<form data-ax-form="request" class="ax-request-form" data-draft-key="${h(key)}" data-source="${h(args.source||(sources.length?'issue':'direct'))}">${sources.map(id=>`<input type="hidden" name="issue" value="${h(id)}">`).join('')}${draft?`<p class="ax-draft-note" role="status">작성하던 내용을 이어서 표시합니다. ${button('처음 내용으로','draft-reset',key)}</p>`:''}${linked.length?`<div class="ax-linked-issues"><span>연결 이슈</span>${linked.map(i=>pill(i.title)).join('')}</div>`:''}<label>요청 제목<input name="title" required maxlength="120" value="${h(value.title)}"></label>${ownerPicker(value.owners)}<div class="ax-form-pair"><label>완료 기한<input name="due" type="date" required min="${db.meta.asOf}" value="${h(value.due)}"></label><label>우선순위<select name="priority">${['보통','높음'].map(p=>`<option ${p===value.priority?'selected':''}>${p}</option>`).join('')}</select></label></div><label>요청 내용<textarea name="body" rows="5" required maxlength="3000">${h(value.body)}</textarea></label><fieldset><legend>알림 방법</legend><div class="ax-channel-options"><label><input type="checkbox" name="channel" value="app" ${value.channels.includes('app')?'checked':''}> 앱 알림</label><label><input type="checkbox" name="channel" value="slack" ${value.channels.includes('slack')?'checked':''}> 슬랙</label></div></fieldset><p class="ax-note">이슈 근거와 확인 대상이 요청에 연결됩니다. 시안에서는 요청 등록·알림 미리보기까지 진행됩니다.</p><p class="ax-form-error" id="ax-request-error" role="alert"></p><button class="button primary" type="submit">요청 등록</button></form>`);
    syncPicker($('#modal [data-ax-picker]'));
  }
  function submitRequest(form){
    const values=new FormData(form),error=form.querySelector('.ax-form-error'),picker=form.querySelector('[data-ax-picker]');
    const owners=values.getAll('owner').filter(id=>staffById.has(id)),channels=values.getAll('channel'),title=String(values.get('title')||'').trim(),body=String(values.get('body')||'').trim();
    if(!owners.length){error.textContent='담당자를 한 명 이상 선택해 주세요.';const trigger=picker.querySelector('[data-picker-toggle]');trigger.setAttribute('aria-invalid','true');trigger.focus();return;}
    if(!form.reportValidity())return;
    if(!channels.length||!title||!body){error.textContent=!channels.length?'알림 방법을 하나 이상 선택해 주세요.':'제목과 요청 내용을 입력해 주세요.';return;}
    const id=crypto.randomUUID(),sources=values.getAll('issue').filter(Boolean),source=form.dataset.source||(sources.length?'issue':'direct');
    form.dataset.submitted='1';ui.drafts.delete(form.dataset.draftKey);
    ui.requests.push({id,issues:sources,title,body,owners,channels,source,due:String(values.get('due')),priority:String(values.get('priority')),status:'requested',events:[{label:'요청 등록',text:source==='chat'?'AI 제안 요청안을 원장이 검토해 등록했습니다.':'요청 내용과 이슈 근거를 연결했습니다.'},{label:'알림 준비',text:`${channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')} 미리보기를 준비했습니다. 실제 발송은 하지 않았습니다.`}]});
    sources.forEach(s=>ui.read.add(s));document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);toast('시안에 업무 요청을 등록했습니다.');
  }
  function showRequestDetail(id){
    const r=ui.requests.find(x=>x.id===id);if(!r)return;
    const linked=r.issues.map(findIssue).filter(Boolean);
    dialog('detail',r.title,'요청한 업무',`<div class="ax-issue-meta">${pill(STATUS[r.status],r.status==='done'?'green':'blue')}${pill(r.priority)}${r.source==='chat'?pill('AI 제안에서 작성'):''}</div><dl><dt>담당자</dt><dd>${h(names(r.owners))}</dd><dt>완료 기한</dt><dd>${h(r.due)}</dd><dt>알림 방법</dt><dd>${r.channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')}</dd></dl><p class="live-pre">${h(r.body)}</p>${linked.length?`<div class="ax-actions"><span class="ax-note">연결된 이슈</span>${linked.map(i=>button(i.title,'open-issue',i.id)).join('')}</div>`:''}<section class="ax-request-timeline"><h3>진행 기록</h3><ol>${r.events.map(e=>`<li><strong>${h(e.label)}</strong><p>${h(e.text)}</p></li>`).join('')}</ol></section>${r.result?`<section class="ax-evidence"><h3>완료 보고</h3><p class="live-pre">${h(r.result)}</p><p>담당자의 보고입니다. 연결된 원본 기록은 자동 변경되지 않습니다.</p></section>`:''}<section class="ax-simulation"><h3>담당자 응답 체험</h3><p>담당자의 확인·보고가 원장에게 돌아오는 흐름을 확인합니다.</p>${r.status==='requested'?button('담당자 확인 처리','request-start',r.id):r.status==='working'?`<form data-ax-form="result"><input type="hidden" name="request" value="${r.id}"><label>처리 결과<textarea name="result" required rows="3" maxlength="3000" placeholder="담당자가 확인한 내용과 후속 조치를 입력하세요"></textarea></label><button class="button primary" type="submit">완료 보고</button></form>`:button('추가 확인 요청','request-reopen',r.id)}<p class="ax-note">시안 응답이며 실제 직원의 보고가 아닙니다.</p></section><div class="ax-actions">${button('슬랙 요청 미리보기','request-slack',r.id)}${r.result?button('슬랙 완료 보고 미리보기','report-slack',r.id):''}</div>`);
  }

  /* ---------- Slack previews (never sent) ---------- */
  function slackPreview({issueId,requestId,report=false}={}){
    const issue=findIssue(issueId),r=ui.requests.find(x=>x.id===requestId),linked=(r?.issues||[]).map(findIssue).filter(Boolean);
    const title=report&&r?`완료 보고 · ${r.title}`:r?.title||issue?.title||'학원 브리핑';
    const body=report&&r?r.result:r?.body||issue?.summary||issues().map(i=>`${i.title}: ${i.value}`).join('\n');
    const to=report?'원장':r?names(r.owners):'원장';
    const actions=r?button(report?'보고 확인':'요청 확인','request-detail',r.id):issue?button('근거 보기','open-issue',issue.id)+button('업무 요청','request',issue.id):button('전체 이슈','navigate','home');
    dialog('modal','슬랙 알림 미리보기','에이와 알림과 같은 이슈·요청에 연결됩니다.',`<div class="ax-slack"><div class="ax-slack-avatar" aria-hidden="true">a</div><div><header><strong>aywa</strong>${pill('앱')}<span>${db.meta.asOf}</span></header><p>받는 사람: ${h(to)}</p><h3>${h(title)}</h3><p class="live-pre">${h(body)}</p>${linked.length?`<p>연결 이슈: ${h(linked.map(i=>i.title).join(' · '))}</p>`:''}${r&&!report?`<p>완료 기한 ${h(r.due)} · ${h(r.priority)}</p>`:''}${report&&r?`<p>담당 ${h(names(r.owners))}</p>`:''}<div class="ax-actions">${actions}</div></div></div><p class="ax-note">미리보기입니다. 슬랙으로 실제 발송되지 않았습니다.</p>`);
  }
  function digestPreview(){
    if(!ui.rule||!ui.slack){dialog('modal','브리핑 알림 미리보기','시안의 자동화 설정',`<p>${!ui.rule?'브리핑 규칙이 꺼져 있습니다.':'슬랙 알림이 선택되지 않았습니다.'}</p><p>자동화에서 설정을 켜면 슬랙 브리핑을 확인할 수 있습니다.</p>${button('자동화 설정','navigate','automation')}`);return;}
    slackPreview();
  }

  /* ---------- Assistant: real endpoint only. Bounded history, one request at a time, explicit cancel and retry. ---------- */
  function validateAssistant(payload){
    const problems=[];
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return {value:null,problems:['응답이 JSON 객체가 아닙니다.']};
    const answer=typeof payload.answer==='string'?payload.answer.trim():'';if(!answer)problems.push('answer가 비어 있습니다.');
    const provider=typeof payload.provider==='string'?payload.provider.trim():'';if(!provider)problems.push('provider가 없습니다.');
    if(!Array.isArray(payload.issueIds)||payload.issueIds.some(id=>typeof id!=='string'))problems.push('issueIds는 문자열 배열이어야 합니다.');
    let suggestedTask=null;const task=payload.suggestedTask;
    if(task!==null){if(task&&typeof task==='object'&&typeof task.title==='string'&&typeof task.body==='string'&&task.title.trim()&&task.body.trim())suggestedTask={title:clip(task.title.trim(),120),body:clip(task.body.trim(),3000)};else problems.push('suggestedTask는 null 또는 {title, body}여야 합니다.');}
    if(!answer||!provider)return {value:null,problems};
    return {value:{answer:clip(answer,20000),provider,issueIds:[...new Set((Array.isArray(payload.issueIds)?payload.issueIds:[]).filter(id=>typeof id==='string'))],suggestedTask},problems};
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
    if(e.kind==='invalid')return {message:'응답 형식을 확인하지 못했습니다. 다시 시도해 주세요.',detail:e.detail};
    if(e.kind==='http'){
      const s=e.status,fallback=[404,405,501].includes(s)?'AI 응답 연결이 아직 준비되지 않았습니다. 로컬 서버의 AI 연결을 확인한 뒤 다시 시도해 주세요.':s===429?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':s===504?'응답 시간이 초과됐습니다. 다시 시도해 주세요.':s>=500?'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.':'요청을 처리하지 못했습니다. 다시 시도해 주세요.';
      const wait=s===429&&e.retryAfter>0?` 약 ${Math.ceil(e.retryAfter)}초 뒤에 다시 시도할 수 있습니다.`:'';
      return {message:`${clip(e.message,300)||fallback}${wait}`,detail:`HTTP ${s}${e.code?` · ${e.code}`:''}`};
    }
    return {message:'AI 응답 서버에 연결하지 못했습니다. 다시 시도해 주세요.',detail:String(e.message||e)};
  }
  async function sendTurn(turn){
    if(chat.pending){toast('이전 질문의 응답을 기다리고 있습니다. 취소하거나 응답 후 다시 보내 주세요.');return;}
    const controller=new AbortController(),pending={turn,controller,started:Date.now()};
    pending.ticker=setInterval(tickChat,1000);pending.timeout=setTimeout(()=>{turn.timedOut=true;controller.abort();},ASSISTANT.timeoutMs);
    chat.pending=pending;Object.assign(turn,{status:'pending',answer:'',provider:'',issueIds:[],suggestedTask:null,error:null,timedOut:false});updateChat();
    try{
      const response=await fetch(ASSISTANT.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({prompt:turn.prompt,contextIssueId:turn.context||null,history:historyFor(turn)}),signal:controller.signal});
      let payload=null;try{payload=await response.json();}catch(e){if(controller.signal.aborted)throw e;}
      if(!response.ok)throw {kind:'http',status:response.status,code:typeof payload?.error==='string'?payload.error:'',message:typeof payload?.message==='string'?payload.message.trim():'',retryAfter:Number(response.headers.get('Retry-After'))||0};
      const {value,problems}=validateAssistant(payload);if(!value)throw {kind:'invalid',detail:problems.join(' ')};
      Object.assign(turn,{status:'done'},value);
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
    const turn={id:crypto.randomUUID(),prompt:text,context:chat.context,status:'pending'};chat.turns.push(turn);
    if(!chatVisible())showChat();sendTurn(turn);return true;
  }
  const chatVisible=()=>Boolean($('#detail[open] [data-ax-chat]'));
  const providerLabel=p=>PROVIDERS[p]||'AI 응답';
  const answerHtml=text=>h(text).replace(/^#{1,6}\s+(.+)$/gm,'<strong>$1</strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  function turnView(t){
    const context=t.context?findIssue(t.context):null;
    const question=`<div class="ax-chat-question">${context?`<small>대화 기준 · ${h(context.title)}</small>`:''}${h(t.prompt)}</div>`;
    if(t.status==='pending')return `${question}<div class="ax-chat-answer pending"><span class="ax-spinner" aria-hidden="true"></span><div><strong>Claude가 답을 작성하고 있습니다</strong><p>학원 기록을 확인하는 데 시간이 걸릴 수 있습니다. <span data-chat-elapsed aria-hidden="true">0초</span></p></div>${button('취소','chat-cancel',t.id)}</div>`;
    if(t.status==='cancelled')return `${question}<div class="ax-chat-answer muted"><p>질문을 취소했습니다.</p>${button('다시 보내기','chat-retry',t.id)}</div>`;
    if(t.status==='error')return `${question}<div class="ax-chat-answer error" title="${h(t.error?.detail||'')}"><strong>응답을 받지 못했습니다</strong><p>${h(t.error?.message||'')}</p>${button('다시 시도','chat-retry',t.id,true)}</div>`;
    const linked=t.issueIds.map(findIssue).filter(Boolean);
    return `${question}<div class="ax-chat-answer"><div class="ax-chat-provider" title="${h(t.provider)}">${pill(providerLabel(t.provider),'blue')}<span>원장 확인 후 사용하세요</span></div><div class="ax-chat-text">${answerHtml(t.answer)}</div>${linked.length?`<div class="ax-actions"><span class="ax-note">관련 근거</span>${linked.map(i=>button(`${i.category} 근거`,'open-issue',i.id)).join('')}</div>`:''}${t.suggestedTask?`<div class="ax-chat-task"><span class="ax-note">요청안 제안</span><strong>${h(t.suggestedTask.title)}</strong><p class="live-pre">${h(t.suggestedTask.body)}</p><div class="ax-actions">${button('요청안 검토','chat-task',t.id,true)}<span class="ax-note">담당자·기한을 지정해 등록하기 전에는 전달되지 않습니다.</span></div></div>`:''}</div>`;
  }
  function chatLog(){return chat.turns.map(turnView).join('')||'<p class="ax-chat-empty">이슈의 근거를 묻거나, 누구에게 무엇을 요청할지 정리해 달라고 입력하세요.</p>';}
  function chatContextBar(){const c=chat.context?findIssue(chat.context):null;return c?`<p>대화 기준 이슈 ${pill(c.title)} ${button('기준 해제','chat-context-clear')}</p>`:'<p>대화 기준 이슈 없음 · 이슈의 ‘이 이슈로 대화’에서 기준을 정할 수 있습니다.</p>';}
  function showChat(){
    const prior=$('#ax-chat-command')?.value||'';
    dialog('detail','AI 업무 지원','Claude가 학원 기록을 바탕으로 답하고, 업무 요청안을 제안합니다.',`<div class="ax-chat" data-ax-chat><div class="ax-chat-context" data-chat-context>${chatContextBar()}</div><div class="ax-chat-log live-scroll" role="log" aria-label="AI 대화" data-chat-log tabindex="0">${chatLog()}</div><form class="ax-chat-composer" data-ax-form="chat"><label for="ax-chat-command">질문</label><textarea id="ax-chat-command" name="prompt" rows="3" required maxlength="${ASSISTANT.promptLimit}" placeholder="예: 미수납 확인을 누구에게 요청하면 좋을까?">${h(prior)}</textarea><div class="ax-chat-compose-foot"><span class="ax-note">Enter 보내기 · Shift+Enter 줄바꿈. 질문과 최근 대화 최대 ${ASSISTANT.historyItems/2}회, 대화 기준 이슈가 로컬 서버를 거쳐 Claude로 전달됩니다.</span><button class="button primary" type="submit" data-chat-send>보내기</button></div></form></div>`);
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
    const page=api.getPage(),offset=$('.nav-scroll')?.scrollTop||0,count=unread(),reports=ui.requests.filter(r=>r.status==='done').length;
    document.body.dataset.page=page;
    const link=(id,label,symbol,extra='')=>`<a class="nav-item ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${extra}</a>`;
    const tool=(attrs,label,symbol,extra='')=>`<button type="button" class="nav-item" ${attrs}>${icon(symbol)}<span>${label}</span>${extra}</button>`;
    $('#sidebar').innerHTML=`<a href="#home" class="brand"><span class="brand-mark">${icon('trend')}</span><div><div class="brand-name">aywa</div><div class="brand-caption">학원 운영</div></div></a><div class="academy-box"><span class="academy-symbol">${icon('building')}</span><div><strong>${h(db.meta.tenant)}</strong><small>원장 · 로컬 dev 시안</small></div></div><button type="button" class="ax-search-trigger" data-action="search">${icon('search')}<span>통합 검색</span><kbd>Ctrl K</kbd></button><nav class="nav-scroll" aria-label="원장 작업 공간"><div class="nav-group">원장실</div>${link('home','브리핑','home')}${link('inbox','알림','message',count?`<span class="nav-count" aria-label="안 읽음 ${count}건">${count}</span>`:'')}${link('requests','요청한 업무','check',ui.requests.length?`<span class="nav-count">${ui.requests.length}</span>`:'')}${link('automation','자동화','settings')}<div class="nav-group">AI · 알림 채널</div>${tool('data-ax="chat"','AI 업무 지원','message',`<span class="nav-count" ${chat.pending?'':'hidden'}>응답 중</span>`)}${tool('data-ax="digest"','슬랙 브리핑','arrow')}${tool('data-action="notes"','검토 메모','book')}<div class="nav-group">바로 요청</div>${tool('data-ax="request" data-id=""','업무 요청','plus')}${tool('data-ax="launcher"','전체 업무','search')}<div class="ax-sidebar-summary"><strong>처리 현황</strong>${Object.entries(STATUS).map(([id,label])=>`<p>${label} ${ui.requests.filter(r=>r.status===id).length}건</p>`).join('')}${reports?`<p>완료 보고 중 안 읽음 ${unreadReports().length}건</p>`:''}</div></nav><div class="sidebar-bottom">${link('settings','학원 설정','settings')}<div class="profile"><div><strong>원장님</strong><small>${h(db.meta.tenant)}</small></div></div></div>`;
    $('.nav-scroll').scrollTop=offset;
    $('#topbar').innerHTML=`<button type="button" class="button ax-menu-button" data-action="menu" aria-controls="sidebar" aria-expanded="${document.body.classList.contains('menu-open')}" aria-label="메뉴 열기${count?` · 안 읽은 알림 ${count}건`:''}">${icon('menu')}<span>메뉴</span>${count?`<span class="ax-menu-count" aria-hidden="true">${count}</span>`:''}</button><strong class="ax-mobile-title">aywa · ${h(db.meta.tenant)}</strong>`;
  }
  /* Catalog seam: the comprehensive 2.0 catalog arrives separately. A later script can set
     window.AxCatalog={areas:[{id,label,group,page?,note?}]} and dispatch 'ax-catalog'. Areas whose page is
     not wired here are listed as not yet connected. Without a catalog only this prototype's screens are shown. */
  const builtInAreas=()=>Object.entries(labels).filter(([id])=>!['home','inbox','requests','automation'].includes(id)).map(([page,label])=>({id:page,label,group:'이 시안에 연결된 화면',page}));
  const catalogAreas=()=>Array.isArray(window.AxCatalog?.areas)&&window.AxCatalog.areas.length?window.AxCatalog.areas:builtInAreas();
  function launcherList(query=''){
    const q=norm(query),areas=catalogAreas().filter(a=>!q||norm(`${a.label} ${a.group||''}`).includes(q)),groups=[...new Set(areas.map(a=>a.group||'기타'))];
    return groups.map(g=>`<section><h3>${h(g)}</h3><div class="ax-launcher">${areas.filter(a=>(a.group||'기타')===g).map(a=>api.hasView(a.page)?button(a.label,'navigate',a.page):`<button type="button" class="button" disabled title="${h(a.note||'')}">${h(a.label)} · 연결 전</button>`).join('')}</div></section>`).join('')||'<p class="live-empty">검색 결과가 없습니다.</p>';
  }
  function launcher(){
    const full=Array.isArray(window.AxCatalog?.areas)&&window.AxCatalog.areas.length;
    dialog('modal','전체 업무',full?'2.0 업무 목록입니다. 연결 전인 항목은 표시만 합니다.':'이 시안에 연결된 화면입니다. 2.0의 전체 업무 목록은 별도로 연결합니다.',`<div class="ax-launcher-wrap"><input id="ax-launcher-search" type="search" aria-label="업무 검색" placeholder="업무 이름 검색" autocomplete="off"><div id="ax-launcher-list">${launcherList()}</div></div>`);
  }
  window.addEventListener('ax-catalog',()=>{if($('#ax-launcher-list'))$('#ax-launcher-list').innerHTML=launcherList($('#ax-launcher-search').value);});

  /* ---------- Events ---------- */
  function pickerClick(event){
    document.querySelectorAll('[data-ax-picker]').forEach(root=>{if(!root.contains(event.target))openPicker(root,false);});
    const root=event.target.closest('[data-ax-picker]');if(!root)return false;
    const remove=event.target.closest('[data-picker-remove]'),option=event.target.closest('[role=option]');
    if(event.target.closest('[data-picker-toggle]'))openPicker(root,root.querySelector('.ax-picker-panel').hidden);
    else if(remove){const id=remove.dataset.pickerRemove,next=pickerIds(root).filter(x=>x!==id);setOwners(root,next);(root.querySelector(`[data-picker-remove]`)||root.querySelector('[data-picker-toggle]')).focus();}
    else if(option){toggleOwner(root,option.dataset.owner);setActive(root,option);root.querySelector('.ax-picker-search').focus({preventScroll:true});}
    else if(event.target.closest('[data-picker-done]'))openPicker(root,false,true);
    else return false;
    event.stopPropagation();return true;
  }
  document.addEventListener('mousedown',event=>{if(event.target.closest('.ax-picker-option'))event.preventDefault();},true);
  document.addEventListener('click',event=>{
    if(pickerClick(event))return;
    const el=event.target.closest('[data-ax]');if(!el)return;event.preventDefault();event.stopImmediatePropagation();
    const {ax:action,id,prompt,type}=el.dataset;
    if(el.closest('#sidebar'))api.closeMenu?.(false);
    if(action==='navigate'){navigate(id);return;}
    if(action==='filter'){ui.filter=id;render();return;}
    if(action==='focus-issue'){ui.read.add(id);ui.archived.delete(id);ui.filter='all';render();requestAnimationFrame(()=>focusIssue(id));return;}
    if(action==='focus-list'){focusIssue('list');return;}
    if(action==='open-issue'){ui.read.add(id);ui.archived.delete(id);ui.filter='all';ui.focusIssue=id;navigate('home');return;}
    if(action==='expand'){const list=$(`#ax-records-${id}`),open=list.dataset.collapsed==='true',more=list.querySelectorAll('.ax-more').length,unit=findIssue(id)?.unit||'건';list.dataset.collapsed=String(!open);el.setAttribute('aria-expanded',String(open));el.textContent=open?'접기':`나머지 ${more}${unit} 더 보기`;if(open)ui.expanded.add(id);else ui.expanded.delete(id);return;}
    if(action==='request'){showRequest({issues:id?[id]:[]});return;}
    if(action==='draft-reset'){ui.drafts.delete(id);showRequest(ui.requestArgs||{});return;}
    if(action==='request-detail'){ui.reportRead.add(id);document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);return;}
    if(action==='request-start'||action==='request-reopen'){const r=ui.requests.find(r=>r.id===id);if(!r)return;r.status='working';r.events.push({label:action==='request-start'?'담당자 확인':'추가 확인 요청',text:action==='request-start'?'담당자 응답을 시안에서 반영했습니다.':'원장이 추가 확인을 요청했습니다. 기존 보고는 보존됩니다.'});render();showRequestDetail(id);return;}
    if(action==='record'){const f={student:api.showStudent,bill:api.showBill,approval:api.showApproval,task:api.showTask}[type];if(f)f(id);else navigate({lead:'admissions',book:'resources'}[type]);return;}
    if(action==='read'||action==='archive'){const set=action==='read'?ui.read:ui.archived;if(set.has(id))set.delete(id);else set.add(id);render();if(action==='archive'&&ui.archived.has(id))$('#ax-issues-title')?.focus({preventScroll:true});return;}
    if(action==='read-all'){issues().forEach(i=>ui.read.add(i.id));ui.requests.filter(r=>r.status==='done').forEach(r=>ui.reportRead.add(r.id));render();return;}
    if(action==='inbox-tab'){ui.inbox=id;render();return;}
    if(action==='digest'){digestPreview();return;}
    if(action==='slack'){slackPreview({issueId:id});return;}
    if(action==='request-slack'||action==='report-slack'){slackPreview({requestId:id,report:action==='report-slack'});return;}
    if(action==='ask'){chat.context=id;showChat();const input=$('#ax-chat-command');if(!input.value)input.value=`${findIssue(id)?.title||'이 이슈'}를 정리하고, 누구에게 무엇을 요청하면 좋을지 알려줘`;input.focus();return;}
    if(action==='prompt'){ask(prompt);return;}
    if(action==='chat'){showChat();return;}
    if(action==='chat-cancel'){if(chat.pending?.turn.id===id)chat.pending.controller.abort();return;}
    if(action==='chat-retry'){const turn=chat.turns.find(t=>t.id===id);if(turn)sendTurn(turn);return;}
    if(action==='chat-context-clear'){chat.context=null;updateChat();return;}
    if(action==='chat-task'){const t=chat.turns.find(x=>x.id===id);if(!t?.suggestedTask)return;showRequest({issues:[...new Set([t.context,...t.issueIds].filter(x=>x&&findIssue(x)))],title:t.suggestedTask.title,body:t.suggestedTask.body,source:'chat',draftKey:`chat:${t.id}`});return;}
    if(action==='launcher'){launcher();return;}
  },true);
  document.addEventListener('keydown',event=>{
    const root=event.target.closest?.('[data-ax-picker]');
    if(root){
      const open=!root.querySelector('.ax-picker-panel').hidden,inSearch=event.target.matches('.ax-picker-search');
      if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();openPicker(root,false,true);return;}
      if(event.target.matches('[data-picker-toggle]')&&event.key==='ArrowDown'){event.preventDefault();openPicker(root,true);return;}
      if(inSearch&&!event.isComposing&&event.keyCode!==229){
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();movePicker(root,event.key==='ArrowDown'?1:-1);}
        else if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();movePicker(root,event.key==='PageDown'?'last':'first');}
        else if(event.key==='Enter'){event.preventDefault();const active=root.querySelector('.ax-picker-option.active');if(active)toggleOwner(root,active.dataset.owner);}
      }else if(inSearch&&event.key==='Enter')event.preventDefault();
      return;
    }
    if(event.key==='Enter'&&(event.isComposing||event.keyCode===229)&&event.target.matches?.('#ax-home-command,#ax-chat-command')){event.preventDefault();return;}
    if(event.key==='Enter'&&!event.shiftKey&&event.target.matches?.('#ax-chat-command')){event.preventDefault();event.target.form.requestSubmit();}
  },true);
  document.addEventListener('input',event=>{
    const root=event.target.closest?.('[data-ax-picker]');if(root&&event.target.matches('.ax-picker-search')){filterPicker(root);return;}
    if(event.target.id==='ax-home-command')ui.homePrompt=event.target.value;
    if(event.target.id==='ax-launcher-search'&&!event.isComposing)$('#ax-launcher-list').innerHTML=launcherList(event.target.value);
    const form=event.target.closest?.('form[data-ax-form="request"]');if(form)saveDraft(form);
  });
  document.addEventListener('compositionend',event=>{if(event.target.id==='ax-launcher-search')$('#ax-launcher-list').innerHTML=launcherList(event.target.value);});
  document.addEventListener('focusout',event=>{const root=event.target.closest?.('[data-ax-picker]');if(root)setTimeout(()=>{if(!root.contains(document.activeElement)&&document.activeElement!==document.body)openPicker(root,false);},0);});
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
    if(page==='home'&&ui.focusIssue){const id=ui.focusIssue;ui.focusIssue=null;requestAnimationFrame(()=>focusIssue(id));}
    else if(!['home','inbox','requests','automation'].includes(page)&&$('main h1'))$('main h1').textContent=labels[page]||$('main h1').textContent;
  }
  return {home,inbox,requests,automation,decorateShell,decorateView};
};
