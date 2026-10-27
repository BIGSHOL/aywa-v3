/* Local AX interaction prototype. Facts come from the verified copy; actions
   remain in this tab. No LLM, Slack API, push service, or DB writes are invoked. */
window.createOwnerWorkspace = function createOwnerWorkspace(api) {
  'use strict';
  const {db,h,fmt,won,icon,chart,dialog,navigate,render,toast}=api;
  const $=s=>document.querySelector(s);
  const current=()=>db.trend.find(t=>t.month===db.meta.month);
  const total=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
  const ui={selected:'billing',filter:'all',inbox:'unread',read:new Set(),reportRead:new Set(),archived:new Set(),requests:[],chat:[],chatContext:null,rule:true,slack:true,app:true};
  const labels={home:'브리핑',inbox:'알림',requests:'요청한 업무',automation:'자동화',students:'원생목록',admissions:'신규 콜&상담',classes:'수업목록 · 시간표',learning:'성적관리 · 수업보고서',finance:'수납관리',staff:'직원관리',parents:'학부모 소통',shuttle:'셔틀',approvals:'전자결재 · 할 일',resources:'교재 · 재고 · 서식',calendar:'캘린더',settings:'학원 설정'};
  const pill=(text,tone='')=>`<span class="ax-chip ${tone}">${h(text)}</span>`;
  const button=(text,action,id='',primary=false)=>`<button class="button ${primary?'primary':''}" data-ax="${action}" data-id="${h(id)}">${h(text)}</button>`;
  const caption=`${db.meta.asOf.replaceAll('-','.')} 복사본 기준`;
  function issues(){
    const now=current(),prev=db.trend.find(t=>t.month===db.trend.at(-2).month),delta=now.payingStudents-prev.payingStudents;
    const bills=db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0);
    const leads=db.admissions.filter(a=>a.date.startsWith(db.meta.month)&&['scheduled','consulted','ai_done'].includes(a.outcome));
    const absent=db.students.filter(s=>s.status==='enrolled'&&s.attendance.absent>=3).sort((a,b)=>b.attendance.absent-a.attendance.absent);
    const pending=db.approvals.filter(a=>a.status==='pending');
    const overdue=db.tasks.filter(t=>t.status==='open'&&t.due&&t.due<db.meta.asOf);
    const books=db.textbooks.filter(t=>['requested','ordered'].includes(t.status));
    const items=[
      {id:'billing',category:'수납',title:`수납 확인 ${bills.length}건`,summary:`${won(total(bills,'remaining'))}이 남아 있습니다. 납부 확인 후 필요한 가정에만 안내해 주세요.`,value:won(total(bills,'remaining')),priority:'확인 필요',page:'finance',count:bills.length,source:'수납관리 · 청구·할인·수납 기록',facts:[`${db.meta.month} 청구분의 현재 잔액입니다.`,`할인 ${won(total(bills,'discount'))}을 반영하고 취소·환불은 제외했습니다.`,`완납 기록은 요청 대상에 포함하지 않습니다.`],records:bills.map(i=>({id:i.id,type:'bill',name:i.name,detail:won(i.remaining)})),request:'수납 잔액 확인 및 후속 안내',suggestion:'대상별 납부 내역을 확인해 주세요. 이미 납부한 건은 먼저 대조하고, 안내가 필요한 경우 보호자에게 연락한 뒤 결과를 남겨 주세요.'},
      {id:'admissions',category:'상담',title:`상담 후속 확인 ${leads.length}건`,summary:`이번 달 접수 ${now.inquiries}건 중 상담·검토 상태인 ${leads.length}건의 다음 약속을 확인해 주세요.`,value:`${leads.length}건`,priority:'확인 필요',page:'admissions',count:leads.length,source:'신규 콜&상담 · 접수월과 현재 결과',facts:['접수월이 이번 달인 상담만 포함합니다.',`현재 등록 상태 ${now.registered}건은 별도로 집계했습니다.`,'연락 기한이 지났다는 뜻은 아닙니다. 다음 약속 유무를 확인하는 요청입니다.'],records:leads.map(a=>({id:a.id,type:'lead',name:a.name,detail:a.teacher})),request:'상담 후속 일정 확인',suggestion:'상담 내용과 다음 약속을 확인하고, 추가 연락이 필요한 원생의 상담 일정을 정리해 주세요. 등록 여부가 바뀐 경우 함께 보고해 주세요.'},
      {id:'attendance',category:'출결',title:`출결 특이사항 ${absent.length}명`,summary:'이번 달 결석 기록이 3회 이상인 재원생입니다. 사유와 보강 계획을 담임에게 확인할 수 있습니다.',value:`${absent.length}명`,priority:'확인 필요',page:'students',count:absent.length,source:'출석부 · 수정 반영 후 유효한 출결 기록',facts:['기준: 재원 상태이며 이번 달 결석 기록이 3회 이상인 원생.','횟수는 수업별 출결 건수입니다. 연속 결석일이나 퇴원 위험 점수가 아닙니다.','현재 기록만으로 사유를 단정하지 않습니다.'],records:absent.map(s=>({id:s.id,type:'student',name:s.name,detail:`결석 ${s.attendance.absent}회 / 출결 ${s.attendance.total}회`})),request:'결석 사유 및 보강 계획 확인',suggestion:'대상 원생의 결석 사유와 보호자 연락 여부를 확인해 주세요. 보강이 필요한 경우 가능한 일정과 후속 계획을 함께 보고해 주세요.'},
      {id:'approval',category:'결재',title:`결재 대기 ${pending.length}건`,summary:'결재 문서와 결재선을 확인하고, 필요한 보완 내용을 담당자에게 요청하세요.',value:`${pending.length}건`,priority:'결정 필요',page:'approvals',count:pending.length,source:'전자결재 · 대기 상태 문서',facts:['현재 결재 대기 상태인 문서입니다.','원장 검토와 담당자 보완 요청을 분리합니다.'],records:pending.map(a=>({id:a.id,type:'approval',name:a.title,detail:a.drafter})),request:'결재 문서 검토 및 보완',suggestion:'결재 문서의 내용과 첨부 근거를 확인하고, 보완할 사항이 있으면 정리해서 보고해 주세요.'},
      {id:'tasks',category:'업무',title:`기한 지난 업무 ${overdue.length}건`,summary:'기한이 지났고 완료 표시가 없는 업무입니다. 실제 완료 여부와 새 일정을 확인해 주세요.',value:`${overdue.length}건`,priority:'확인 필요',page:'approvals',count:overdue.length,source:'할 일 · 기한·완료 상태',facts:['등록된 기한이 기준일보다 이전인 진행 중 업무입니다.','완료 표시가 누락됐을 수 있으므로 담당자 확인이 먼저입니다.'],records:overdue.map(t=>({id:t.id,type:'task',name:t.title,detail:t.owners.join(', ')||'담당 미지정'})),request:'미완료 업무 진행 확인',suggestion:'현재 진행 상황과 완료 예정일을 알려 주세요. 이미 처리한 업무는 결과를 남기고 완료 상태를 정리해 주세요.'},
      {id:'books',category:'교재',title:`교재 진행 확인 ${books.length}건`,summary:'요청·주문 상태의 교재입니다. 주문과 전달 여부를 확인할 수 있습니다.',value:`${books.length}건`,priority:'진행 확인',page:'resources',count:books.length,source:'교재 요청 · 주문·전달 상태',facts:['요청 또는 주문 상태의 기록입니다.','전달 기한이 없으므로 배송 지연으로 판단하지 않습니다.'],records:books.map(t=>({id:t.id,type:'book',name:t.name,detail:t.student})),request:'교재 주문 및 전달 확인',suggestion:'요청·주문 상태인 교재의 주문 내역과 전달 여부를 확인하고, 미전달 사유가 있으면 알려 주세요.'},
      {id:'enrollment',category:'경영',title:`청구 대상 ${Math.abs(delta)}명 ${delta<0?'감소':delta>0?'증가':'유지'}`,summary:`지난달 ${prev.payingStudents}명에서 이번 달 ${now.payingStudents}명으로 변했습니다. 원생 상태와 수강 변동을 함께 확인해 주세요.`,value:`${delta>0?'+':''}${delta}명`,priority:'변화 감지',page:'students',count:Math.abs(delta),source:'수납관리 · 월별 고유 수강료 청구 대상',facts:['현재 재원 수와 다른 지표입니다.','청구 대상의 증감을 퇴원 인원으로 해석하지 않습니다.','기간별 수강·청구 여부를 대조해야 원인을 확인할 수 있습니다.'],records:[],request:'청구 대상 변동 원인 확인',suggestion:'지난달과 이번 달의 수강료 청구 대상을 대조해 주세요. 신규·휴원·퇴원·청구 누락 등 확인된 사유를 구분해 보고해 주세요.'},
    ];
    return items.filter(i=>i.count>0);
  }
  const findIssue=id=>issues().find(i=>i.id===id);
  function trends(){
    const rows=db.trend.filter(t=>db.months.includes(t.month)),first=rows[0],last=rows.at(-1),prev=rows.at(-2);
    const points=key=>{const max=Math.max(...rows.map(r=>r[key]),1);return rows.map((r,i)=>`${10+i*34},${62-r[key]/max*46}`).join(' ');};
    return `<section class="ax-trend-strip" aria-label="최근 변화"><button data-ax="open-issue" data-id="enrollment"><span>청구 대상 원생</span><strong>${last.payingStudents}명 <small>전월 대비 ${last.payingStudents-prev.payingStudents>0?'+':''}${last.payingStudents-prev.payingStudents}명</small></strong><svg viewBox="0 0 190 76" role="img" aria-label="${rows.map(r=>`${r.month} ${r.payingStudents}명`).join(', ')}"><line x1="10" x2="180" y1="62" y2="62"/><polyline points="${points('payingStudents')}"/></svg><small>${first.month}–${last.month} · 청구월 기준</small></button><button data-ax="navigate" data-id="finance"><span>누적 수납</span><strong>${won(last.paid)}</strong><svg viewBox="0 0 190 76" role="img" aria-label="${rows.map(r=>`${r.month} ${won(r.paid)}`).join(', ')}"><line x1="10" x2="180" y1="62" y2="62"/><polyline points="${points('paid')}"/></svg><small>각 청구월의 복사 시점 누적액 · 이번 달 진행 중</small></button></section>`;
  }
  const issueState=id=>ui.requests.some(r=>r.issue===id&&r.status!=='done')?'처리 중':ui.requests.some(r=>r.issue===id&&r.status==='done')?'결과 도착':ui.read.has(id)?'확인함':'미확인';
  const unread=()=>issues().filter(i=>!ui.read.has(i.id)&&!ui.archived.has(i.id)).length+ui.requests.filter(r=>r.status==='done'&&!ui.reportRead.has(r.id)).length;
  function coverage(){
    const domains=[['수납',db.invoices.length,'finance'],['원생',db.students.length,'students'],['상담',db.admissions.length,'admissions'],['수업',db.classes.length,'classes'],['학습',db.learning.gradesCount,'learning'],['학부모',db.messages.length,'parents'],['직원',db.staff.length,'staff'],['차량',db.runs.length,'shuttle'],['업무',db.tasks.length,'approvals'],['결재',db.approvals.length,'approvals'],['교재·자산',db.textbooks.length+db.assetCount,'resources'],['일정',db.calendar.length,'calendar']];
    return `<section class="ax-coverage"><div class="ax-section-head"><h2>학원 전체 확인</h2><span>기록이 없는 항목을 정상으로 판정하지 않습니다.</span></div><div class="ax-domain-grid">${domains.map(([name,count,page])=>`<button data-ax="navigate" data-id="${page}"><strong>${name}</strong><span>${count?`${fmt(count)}건의 기록`:'기록 없음'}</span>${icon('chevron')}</button>`).join('')}</div></section>`;
  }
  function issueDetail(issue){
    if(!issue)return '<div class="live-empty">이 조건에서 확인할 이슈가 없습니다.</div>';
    const related=ui.requests.filter(r=>r.issue===issue.id);
    return `<article class="ax-issue-detail" aria-label="이슈 상세"><div class="ax-issue-meta">${pill(issue.priority,issue.priority==='변화 감지'?'blue':'amber')}${pill(issueState(issue.id))}<span>${caption}</span></div><h2>${h(issue.title)}</h2><p class="ax-summary">${h(issue.summary)}</p><div class="ax-actions">${button('업무 요청','request',issue.id,true)}${button('이 이슈로 대화','ask',issue.id)}${button('슬랙 알림 보기','slack',issue.id)}</div><section class="ax-evidence"><h3>확인 근거</h3>${issue.id==='enrollment'?chart(db.trend.filter(t=>db.months.includes(t.month)),'payingStudents','명',{label:'청구 대상 원생'}):''}<ul>${issue.facts.map(f=>`<li>${h(f)}</li>`).join('')}</ul><p class="ax-source">${h(issue.source)}</p></section>${issue.records.length?`<section><div class="ax-section-head"><h3>확인 대상 ${issue.records.length}${issue.id==='attendance'?'명':'건'}</h3>${button('전체 기록','navigate',issue.page)}</div><div class="ax-evidence-records live-scroll" data-scroll-key="evidence-${issue.id}" tabindex="0" aria-label="이슈 확인 대상">${issue.records.map(r=>`<button data-ax="record" data-type="${r.type}" data-id="${h(r.id)}"><strong>${h(r.name)}</strong><span>${h(r.detail)}</span>${icon('chevron')}</button>`).join('')}</div></section>`:''}${related.length?`<section class="ax-linked"><h3>연결된 요청</h3>${related.map(requestRow).join('')}</section>`:''}<div class="ax-issue-footer">${button(ui.read.has(issue.id)?'확인 취소':'확인함','read',issue.id)}${button(ui.archived.has(issue.id)?'받은 알림으로':'보관','archive',issue.id)}<span>확인함은 업무 완료와 별개입니다.</span></div></article>`;
  }
  function composeForm(id='ax-home-command'){
    return `<form class="ax-composer" data-ax-form="chat"><label for="${id}">확인하거나 요청할 내용을 입력하세요</label><div><input id="${id}" name="prompt" required maxlength="1000" autocomplete="off" placeholder="예: 미수납 확인을 관리자에게 요청해줘"><button class="button primary" type="submit">입력</button></div><div class="ax-suggestions">${['전체 이슈 정리해줘','원생 수 변화를 알려줘','기한 지난 업무 확인해줘'].map(q=>`<button type="button" data-ax="prompt" data-prompt="${h(q)}">${h(q)}</button>`).join('')}</div></form>`;
  }
  function home(){
    const all=issues().filter(i=>!ui.archived.has(i.id));
    const shown=ui.filter==='all'?all:all.filter(i=>i.priority===ui.filter);
    const selected=shown.find(i=>i.id===ui.selected)||shown[0];if(selected)ui.selected=selected.id;
    return `<div class="page-heading"><div><h1>브리핑</h1><p>${caption} · 원장님이 확인하고 요청할 일을 모았습니다.</p></div>${button('직접 업무 요청','request','',true)}</div><section class="ax-brief"><div><h2>확인할 이슈 ${all.length}건, 진행 중인 요청 ${ui.requests.filter(r=>r.status!=='done').length}건입니다.</h2><p>알림에서 근거를 확인하고, 관리자·강사에게 바로 요청하세요.</p></div><div class="ax-brief-facts"><span>현재 재원 <strong>${db.students.filter(s=>s.status==='enrolled').length}명</strong></span><span>이달 수납률 <strong>${fmt(current().paid/current().billed*100)}%</strong></span></div></section>${composeForm()}<div class="ax-board"><section class="ax-issue-picker"><div class="ax-section-head"><h2>전체 이슈</h2>${pill(`${all.length}건`)}</div><div class="ax-filter" aria-label="이슈 필터">${[['all','전체'],['확인 필요','확인 필요'],['결정 필요','결정 필요'],['변화 감지','변화']].map(([value,label])=>`<button data-ax="filter" data-id="${value}" aria-pressed="${ui.filter===value}">${label}</button>`).join('')}</div><div class="ax-issue-list live-scroll" data-scroll-key="issues" tabindex="0" aria-label="전체 이슈">${shown.map(i=>`<button class="ax-issue ${selected?.id===i.id?'selected':''}" data-ax="select" data-id="${i.id}" aria-pressed="${selected?.id===i.id}"><span>${h(i.category)}${!ui.read.has(i.id)?'<i aria-label="미확인"></i>':''}</span><strong>${h(i.title)}</strong><small>${h(issueState(i.id))}</small></button>`).join('')||'<p>이 조건의 이슈가 없습니다.</p>'}</div></section><div id="ax-issue-detail">${issueDetail(selected)}</div></div><section class="ax-request-summary"><div class="ax-section-head"><h2>요청한 업무</h2>${button('전체 보기','navigate','requests')}</div>${ui.requests.length?ui.requests.slice(-3).reverse().map(requestRow).join(''):'<p>이슈의 ‘업무 요청’에서 담당자와 기한을 지정하면 이곳에 진행 상황이 모입니다.</p>'}</section>${coverage()}`;
  }
  function requestRow(r){
    const statuses={requested:'확인 대기',working:'진행 중',done:'완료 보고'};
    return `<button class="ax-request-row" data-ax="request-detail" data-id="${r.id}"><span><strong>${h(r.title)}</strong><small>${h(r.owners.map(id=>db.staff.find(s=>s.id===id)?.name||'담당자').join(', '))} · ${h(r.due)}까지</small></span>${pill(statuses[r.status],r.status==='done'?'green':'blue')}${icon('chevron')}</button>`;
  }
  function inboxBody(){
    const items=issues().filter(i=>ui.inbox==='archived'?ui.archived.has(i.id):!ui.archived.has(i.id)&&(ui.inbox!=='unread'||!ui.read.has(i.id)));
    const reports=ui.inbox==='archived'?[]:ui.requests.filter(r=>r.status==='done'&&(ui.inbox!=='unread'||!ui.reportRead.has(r.id)));
    return `<div class="ax-filter" aria-label="알림 보기">${[['unread',`안 읽음 ${unread()}`],['all','받은 알림'],['archived','보관함']].map(([id,label])=>`<button data-ax="inbox-tab" data-id="${id}" aria-pressed="${ui.inbox===id}">${label}</button>`).join('')}</div><p class="ax-note">같은 이슈는 묶어서 보여줍니다. 읽음 처리와 업무 완료는 구분됩니다.</p><div class="ax-notifications">${reports.map(r=>`<article>${pill('완료 보고','green')}<h3>${h(r.title)}</h3><p>${h(r.result)}</p>${button('보고 확인','request-detail',r.id,true)}</article>`).join('')}${items.map(i=>`<article><div>${pill(i.category)}${pill(issueState(i.id))}</div><h3>${h(i.title)}</h3><p>${h(i.summary)}</p><div class="ax-actions">${button('근거 보기','open-issue',i.id)}${button('업무 요청','request',i.id,true)}${button('슬랙 보기','slack',i.id)}</div></article>`).join('')}${!items.length&&!reports.length?'<p class="live-empty">이 조건의 알림이 없습니다.</p>':''}</div>`;
  }
  function inbox(){return `<div class="page-heading"><div><h1>알림</h1><p>${caption} · 이슈와 후속 요청을 한곳에서 확인합니다.</p></div>${button('모두 읽음','read-all')}</div>${inboxBody()}`;}
  function requests(){return `<div class="page-heading"><div><h1>요청한 업무</h1><p>관리자·강사의 확인부터 결과 보고까지 이어서 확인합니다.</p></div>${button('업무 요청','request','',true)}</div><div class="ax-workflow" aria-label="요청 처리 단계">${[['requested','확인 대기'],['working','진행 중'],['done','완료 보고']].map(([id,label])=>`<section><h2>${label} ${pill(ui.requests.filter(r=>r.status===id).length+'건')}</h2>${ui.requests.filter(r=>r.status===id).map(requestRow).join('')||'<p>해당 단계의 요청이 없습니다.</p>'}</section>`).join('')}</div><p class="ax-note">시안에서 만든 요청입니다. 담당자에게 실제 전송되지 않으며 새로고침하면 초기화됩니다.</p>`;}
  function automation(){
    const slack=db.channels?.slack;
    return `<div class="page-heading"><div><h1>자동화</h1><p>어떤 이슈를 어디로 받고, 누가 처리할지 설정합니다.</p></div></div><section class="ax-rules"><h2>원장 브리핑</h2><p>수납 잔액, 상담 후속, 출결 특이사항, 결재 대기, 업무 기한, 교재 진행과 청구 대상 변화를 묶습니다.</p><div class="ax-rule-path"><span>업무 기록 확인</span>${icon('chevron')}<span>같은 이슈 묶기</span>${icon('chevron')}<span>원장에게 알림</span>${icon('chevron')}<span>담당자 요청·결과 보고</span></div><label><input type="checkbox" data-ax-setting="rule" ${ui.rule?'checked':''}> 브리핑 규칙 사용</label><div class="ax-channel-options"><label><input type="checkbox" data-ax-setting="app" ${ui.app?'checked':''}> 앱 알림</label><label><input type="checkbox" data-ax-setting="slack" ${ui.slack?'checked':''}> 슬랙 알림</label></div><p>${slack?.configured?`복사본의 슬랙 설정: 연결됨 · 사용 중 규칙 ${slack.enabledRules}개 · 요약 ${h(slack.digest)} · 방해금지 ${h(slack.quiet)}`:'복사본에서 슬랙 연결 설정을 찾지 못했습니다.'}</p><p class="ax-note">이 화면의 변경은 시안 설정입니다. 실제 알림 발송과 예약 실행은 연결하지 않았습니다.</p>${button('브리핑 알림 미리보기','digest')}</section>${coverage()}`;
  }
  function showRequest(issueId='',prompt=''){
    const issue=findIssue(issueId);ui.chatContext=issueId||null;
    dialog('modal','업무 요청',issue?`${issue.category} · 확인 대상 ${issue.records.length||'변동 근거'}${issue.records.length?'건':''}`:'관리자·강사에게 요청할 내용을 작성하세요.',`<form data-ax-form="request" class="ax-request-form"><input type="hidden" name="issue" value="${h(issueId)}"><label>요청 제목<input name="title" required maxlength="120" value="${h(issue?.request||'')}"></label><fieldset><legend>담당자 <span>여러 명 선택 가능</span></legend><div class="ax-people live-scroll" tabindex="0" aria-label="담당자 선택">${db.staff.map(s=>`<label><input type="checkbox" name="owner" value="${h(s.id)}"><span><strong>${h(s.name)}</strong><small>${h(s.title)} · ${h(s.department)}</small></span></label>`).join('')}</div></fieldset><div class="ax-form-pair"><label>완료 기한<input name="due" type="date" required min="${db.meta.asOf}" value="${db.meta.asOf}"></label><label>우선순위<select name="priority"><option>보통</option><option>높음</option></select></label></div><label>요청 내용<textarea name="body" rows="5" required maxlength="3000">${h(prompt||issue?.suggestion||'')}</textarea></label><fieldset><legend>알림 방법</legend><div class="ax-channel-options"><label><input type="checkbox" name="channel" value="app" ${ui.app?'checked':''}> 앱 알림</label><label><input type="checkbox" name="channel" value="slack" ${ui.slack?'checked':''}> 슬랙</label></div></fieldset><p class="ax-note">이슈 근거와 확인 대상이 요청에 연결됩니다. 시안에서는 요청 등록·알림 미리보기까지 진행됩니다.</p><p class="ax-form-error" role="alert"></p><button class="button primary" type="submit">요청 등록</button></form>`);
  }
  function showRequestDetail(id){
    const r=ui.requests.find(x=>x.id===id);if(!r)return;
    const names=r.owners.map(id=>db.staff.find(s=>s.id===id)?.name||'담당자');
    dialog('detail',r.title,'요청한 업무',`<div class="ax-issue-meta">${pill({requested:'확인 대기',working:'진행 중',done:'완료 보고'}[r.status],'blue')}${pill(r.priority)}</div><dl><dt>담당자</dt><dd>${h(names.join(', '))}</dd><dt>완료 기한</dt><dd>${h(r.due)}</dd><dt>알림 방법</dt><dd>${r.channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')}</dd></dl><p class="live-pre">${h(r.body)}</p>${r.issue?button('연결된 이슈','open-issue',r.issue):''}<section class="ax-request-timeline"><h3>진행 기록</h3><ol>${r.events.map(e=>`<li><strong>${h(e.label)}</strong><p>${h(e.text)}</p></li>`).join('')}</ol></section>${r.result?`<section class="ax-evidence"><h3>완료 보고</h3><p class="live-pre">${h(r.result)}</p><p>담당자의 보고입니다. 연결된 원본 기록은 자동 변경되지 않습니다.</p></section>`:''}<section class="ax-simulation"><h3>담당자 응답 체험</h3><p>담당자의 확인·보고가 원장에게 돌아오는 흐름을 확인합니다.</p>${r.status==='requested'?button('담당자 확인 처리','request-start',r.id):r.status==='working'?`<form data-ax-form="result"><input type="hidden" name="request" value="${r.id}"><label>처리 결과<textarea name="result" required rows="3" maxlength="3000" placeholder="담당자가 확인한 내용과 후속 조치를 입력하세요"></textarea></label><button class="button primary" type="submit">완료 보고</button></form>`:button('추가 확인 요청','request-reopen',r.id)}<p class="ax-note">시안 응답이며 실제 직원의 보고가 아닙니다.</p></section>${button('슬랙 요청 미리보기','request-slack',r.id)}`);
  }
  function slackPreview(issueId,requestId){
    const issue=findIssue(issueId),r=ui.requests.find(r=>r.id===requestId);
    const title=r?.title||issue?.title||'학원 브리핑';
    const body=r?.body||issue?.summary||issues().map(i=>`${i.title}: ${i.value}`).join('\n');
    const names=r?r.owners.map(id=>db.staff.find(s=>s.id===id)?.name||'담당자').join(', '):'원장';
    dialog('modal','슬랙 알림 미리보기','에이와 알림과 같은 이슈·요청에 연결됩니다.',`<div class="ax-slack"><div class="ax-slack-avatar">a</div><div><header><strong>aywa</strong>${pill('앱')}<span>${db.meta.asOf}</span></header><p>받는 사람: ${h(names)}</p><h3>${h(title)}</h3><p class="live-pre">${h(body)}</p>${r?`<p>완료 기한 ${h(r.due)} · ${h(r.priority)}</p>`:''}<div class="ax-actions">${r?button('요청 확인','request-detail',r.id):issue?button('근거 보기','open-issue',issue.id):button('전체 이슈','navigate','home')}${!r&&issue?button('업무 요청','request',issue.id):''}</div></div></div><p class="ax-note">미리보기입니다. 슬랙으로 실제 발송되지 않았습니다.</p>`);
  }
  function digestPreview(){
    if(!ui.rule||!ui.slack){dialog('modal','브리핑 알림 미리보기','시안의 자동화 설정',`<p>${!ui.rule?'브리핑 규칙이 꺼져 있습니다.':'슬랙 알림이 선택되지 않았습니다.'}</p><p>자동화에서 설정을 켜면 슬랙 브리핑을 확인할 수 있습니다.</p>${button('자동화 설정','navigate','automation')}`);return;}
    slackPreview();
  }
  function answer(prompt){
    const text=prompt.trim();if(!text)return;
    let ids=[];
    if(/수납|미납|미수|청구|잔액/.test(text))ids.push('billing');
    if(/원생|재원|학생|증가|감소|변화/.test(text))ids.push('enrollment');
    if(/상담|등록/.test(text))ids.push('admissions');
    if(/결석|출결|출석/.test(text))ids.push('attendance');
    if(/결재|승인/.test(text))ids.push('approval');
    if(/기한|지연|미완료/.test(text))ids.push('tasks');
    if(/교재|주문/.test(text))ids.push('books');
    if(!ids.length&&ui.chatContext)ids=[ui.chatContext];
    if(/전체|모두|브리핑/.test(text))ids=issues().map(i=>i.id);
    const matches=ids.map(findIssue).filter(Boolean);
    const dispatch=/요청|지시|맡겨|시켜|보내/.test(text);
    let reply=matches.length?matches.map(i=>`${i.title}. ${i.summary}`).join('\n\n'):ids.length?'해당 기준으로 추린 이슈가 없습니다. 전체 업무에서 기록을 확인할 수 있습니다.':'이 시안은 수납·재원 변화·상담·출결·결재·업무 기한·교재 질문을 지원합니다. 확인할 항목을 입력하거나 직접 업무 요청을 작성해 주세요.';
    if(dispatch)reply+='\n\n요청안을 준비할 수 있습니다. 담당자와 기한을 지정하고 내용을 확인한 뒤 등록해 주세요.';
    ui.chat.push({prompt:text,reply,ids:matches.map(i=>i.id),dispatch});showChat();
  }
  function showChat(){
    dialog('detail','AI 업무 지원','복사 데이터 기반 응답 예시 · 원장 확인 후 요청 등록',`<div class="ax-chat" role="log">${ui.chat.map(c=>`<div class="ax-chat-question">${h(c.prompt)}</div><div class="ax-chat-answer"><strong>확인한 내용</strong><p class="live-pre">${h(c.reply)}</p><div class="ax-actions">${c.ids.map(id=>button(findIssue(id)?.category+' 근거','open-issue',id)).join('')}${c.dispatch?button('요청안 작성','request',c.ids[0]||'',true):''}</div></div>`).join('')||'<p>이슈의 근거를 확인하거나 관리자·강사에게 요청할 내용을 입력하세요.</p>'}</div>${composeForm('ax-chat-command')}<p class="ax-note">현재는 지원 항목에 대한 규칙 기반 시안입니다. 외부 AI 모델에 자료를 전송하지 않습니다.</p>`);
    const scroller=$('#detail .live-scroll');scroller.scrollTop=scroller.scrollHeight;$('#ax-chat-command').focus({preventScroll:true});
  }
  function decorateShell(){
    document.body.classList.add('ax-enabled');
    const page=api.getPage(),offset=$('.nav-scroll')?.scrollTop||0;
    document.body.dataset.page=page;
    $('#sidebar').innerHTML=`<a href="#home" class="brand"><span class="brand-mark">${icon('trend')}</span><div><div class="brand-name">aywa</div><div class="brand-caption">학원 운영</div></div></a><div class="academy-box"><span class="academy-symbol">${icon('building')}</span><div><strong>${h(db.meta.tenant)}</strong><small>원장</small></div></div><nav class="nav-scroll" aria-label="원장 작업 공간"><div class="nav-group">원장실</div>${[['home','브리핑','home'],['inbox','알림','message'],['requests','요청한 업무','check'],['automation','자동화','settings']].map(([id,label,symbol])=>`<a class="nav-item ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(symbol)}<span>${label}</span>${id==='inbox'&&unread()?`<span class="nav-count">${unread()}</span>`:''}</a>`).join('')}<div class="nav-group">바로 요청</div><button class="nav-item" data-ax="request">${icon('plus')}<span>업무 요청</span></button><button class="nav-item" data-ax="chat">${icon('message')}<span>AI 업무 지원</span></button><button class="nav-item" data-ax="launcher">${icon('search')}<span>전체 업무</span></button><div class="ax-sidebar-summary"><strong>처리 현황</strong><p>확인 대기 ${ui.requests.filter(r=>r.status==='requested').length}건</p><p>진행 중 ${ui.requests.filter(r=>r.status==='working').length}건</p><p>완료 보고 ${ui.requests.filter(r=>r.status==='done').length}건</p></div></nav><div class="sidebar-bottom"><button class="nav-item" data-ax="navigate" data-id="settings">${icon('settings')}<span>학원 설정</span></button><div class="profile"><span class="avatar">원장</span><div><strong>원장님</strong><small>로컬 dev 시안</small></div></div></div>`;
    $('.nav-scroll').scrollTop=offset;
    $('.breadcrumb strong').textContent=labels[page]||'전체 업무';
    $('.topbar-right').innerHTML=`<button class="button ax-shell-button" data-ax="chat">${icon('message')}<span>AI 업무 지원</span></button><button class="button ax-shell-button" data-ax="digest"><span>슬랙</span></button><button class="button ax-bell" data-ax="bell" aria-label="알림 ${unread()}건">${icon('message')}<span>알림</span>${unread()?pill(unread()):''}</button>`;
  }
  function launcher(){dialog('modal','전체 업무','필요한 기록을 확인하거나 이슈의 근거에서 바로 열 수 있습니다.',`<div class="ax-launcher">${Object.entries(labels).filter(([id])=>!['home','inbox','requests','automation','settings'].includes(id)).map(([id,label])=>button(label,'navigate',id)).join('')}</div>`);}
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-ax]');if(!el)return;event.preventDefault();event.stopImmediatePropagation();
    const {ax:action,id,prompt,type}=el.dataset;
    if(action==='navigate'){navigate(id);return;}
    if(action==='select'){ui.selected=id;render();return;}
    if(action==='filter'){ui.filter=id;render();return;}
    if(action==='request'){showRequest(id);return;}
    if(action==='request-detail'){ui.reportRead.add(id);document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);return;}
    if(action==='request-start'||action==='request-reopen'){const r=ui.requests.find(r=>r.id===id);if(!r)return;r.status='working';r.events.push({label:action==='request-start'?'담당자 확인':'추가 확인 요청',text:action==='request-start'?'담당자 응답을 시안에서 반영했습니다.':'원장이 추가 확인을 요청했습니다. 기존 보고는 보존됩니다.'});render();showRequestDetail(id);return;}
    if(action==='record'){const f={student:api.showStudent,bill:api.showBill,approval:api.showApproval,task:api.showTask}[type];if(f)f(id);else navigate({lead:'admissions',book:'resources'}[type]);return;}
    if(action==='open-issue'){ui.selected=id;ui.filter='all';ui.read.add(id);ui.archived.delete(id);navigate('home');return;}
    if(action==='read'||action==='archive'){const set=action==='read'?ui.read:ui.archived;if(set.has(id))set.delete(id);else set.add(id);render();return;}
    if(action==='read-all'){issues().forEach(i=>ui.read.add(i.id));ui.requests.filter(r=>r.status==='done').forEach(r=>ui.reportRead.add(r.id));render();return;}
    if(action==='inbox-tab'){ui.inbox=id;if($('#detail').open){dialog('detail','알림',caption,inboxBody());}else render();return;}
    if(action==='bell'){dialog('detail','알림',caption,inboxBody());return;}
    if(action==='digest'){digestPreview();return;}
    if(action==='slack'||action==='request-slack'){slackPreview(action==='slack'?id:null,action==='request-slack'?id:null);return;}
    if(action==='ask'){ui.chatContext=id;answer(`${findIssue(id)?.category||''} 이슈를 정리하고 요청할 내용을 알려줘`);return;}
    if(action==='prompt'){answer(prompt);return;}
    if(action==='chat'){showChat();return;}
    if(action==='launcher'){launcher();return;}
  },true);
  document.addEventListener('change',event=>{const key=event.target.dataset.axSetting;if(key)ui[key]=event.target.checked;});
  document.addEventListener('submit',event=>{
    const form=event.target,kind=form.dataset.axForm;if(!kind)return;event.preventDefault();event.stopImmediatePropagation();
    if(!form.reportValidity())return;
    const values=new FormData(form);
    if(kind==='chat'){answer(String(values.get('prompt')||''));return;}
    if(kind==='request'){
      const owners=values.getAll('owner').filter(id=>db.staff.some(s=>s.id===id)),channels=values.getAll('channel'),title=String(values.get('title')||'').trim(),body=String(values.get('body')||'').trim();
      if(!owners.length||!channels.length||!title||!body){form.querySelector('.ax-form-error').textContent=!owners.length?'담당자를 한 명 이상 선택해 주세요.':!channels.length?'알림 방법을 하나 이상 선택해 주세요.':'제목과 요청 내용을 입력해 주세요.';return;}
      const id=crypto.randomUUID(),issue=String(values.get('issue')||'');
      ui.requests.push({id,issue,title,body,owners,channels,due:String(values.get('due')),priority:String(values.get('priority')),status:'requested',events:[{label:'요청 등록',text:'요청 내용과 이슈 근거를 연결했습니다.'},{label:'알림 준비',text:`${channels.map(c=>c==='app'?'앱 알림':'슬랙').join(', ')} 미리보기를 준비했습니다. 실제 발송은 하지 않았습니다.`}]});
      if(issue)ui.read.add(issue);document.querySelectorAll('dialog[open]').forEach(d=>d.close());render();showRequestDetail(id);toast('시안에 업무 요청을 등록했습니다.');return;
    }
    if(kind==='result'){const r=ui.requests.find(r=>r.id===values.get('request')),result=String(values.get('result')||'').trim();if(!r||!result)return;r.status='done';r.result=result;ui.reportRead.delete(r.id);r.events.push({label:'완료 보고',text:result});render();showRequestDetail(r.id);toast('시안에 완료 보고를 반영했습니다.');}
  },true);
  function decorateView(){
    const page=api.getPage();
    if(page==='home')$('.ax-brief').insertAdjacentHTML('afterend',trends());
    else if(!['inbox','requests','automation'].includes(page)&&$('main h1'))$('main h1').textContent=labels[page]||$('main h1').textContent;
  }
  return {home,inbox,requests,automation,decorateShell,decorateView};
};
