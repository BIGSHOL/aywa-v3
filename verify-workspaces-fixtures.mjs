// Test-only fixtures for verify-workspaces.mjs. Nothing here ships in the product UI.
// · Catalog: built from the audited 2.0 inventory (real family ids, labels, tab labels and operation groups) in the agreed
//   window.AxCatalog shape, used only while the catalog worker's workspace-catalog.js is not served by this server.
// · Workspace data: projections of the real local copy already in window.AcademySnapshot (no invented values), used only
//   while the server does not yet emit AcademySnapshot.workspaces. Source labels say "테스트 투영" so screenshots stay honest.
import { readFile } from 'node:fs/promises';

export const INVENTORY=process.env.AX_INVENTORY||'C:/Users/user/orca/workspaces/eywa_refactoring/ax-v2-audit/experiments/owner-concept/catalog/feature-inventory.json';
const VIEW={flow:['enrollment','retention','newcomers','withdrawal-reports','approvals','makeups','textbook-requests','expense-requests','video-homework'],sheet:['class-sheets','timetable','attendance','payroll','classes'],report:['lesson-reports','onescreen','student-portal','parent-portal','class-review','dashboard'],settings:['owner-settings','slack','integrations','teacher-workspace'],timeline:['consultations','meetings','calendar','tasks-notifications','help','support','withdrawals']};
const LEGACY={students:'students',billing:'finance',staff:'staff',approvals:'approvals',calendar:'calendar',shuttle:'shuttle',documents:'resources',enrollment:'admissions',classes:'classes','lesson-reports':'learning',exams:'learning','textbook-requests':'resources',dashboard:'home',payroll:'staff',inventory:'resources'};
// Explicit facets where the fixture data needs stable ids (labels are the 2.0 tab/state names).
const FACETS={approvals:[['pending','결재 대기'],['approved','완료'],['rejected','반려·회수']],makeups:[['reserved','예약'],['done','완료']],payroll:[['draft','작성 중'],['issued','발급 완료']],newcomers:[['pre_call','첫 수업 전 전화'],['after_first_call','첫 수업 후 전화'],['two_week','2주 상담']],withdrawals:[['elementary','초등'],['middle','중등'],['high','고등']],'class-sheets':[['english','영어 강사 시트'],['math','수학 강사 시트']],'owner-settings':[['profile','프로필·브랜드'],['operations','운영 체계'],['makeups','보강 운영'],['notifications','알림·약관']],billing:[['partial','부분 수납'],['unpaid','미납']],inventory:[['supplies','소모품'],['assets','자산']]};
const f=(id,label,type='text',extra={})=>({id,label,type,...extra});
// Preview forms for the priority flows (2.0 operation groups by index in operations.key).
const FIELDS={
  makeups:{0:[f('case','보강 사례','record',{required:true}),f('command','명령','select',{required:true,options:[{value:'intake',label:'접수'},{value:'assign',label:'배정'},{value:'merge',label:'병합'},{value:'close',label:'종결'}]}),f('date','보강일','date',{required:true}),f('time','시작 시각','time'),f('note','메모','textarea')]},
  retention:{0:[f('student','원생','student',{required:true}),f('status','캠페인 상태','select',{required:true,options:['대상','연락함','재등록','보류']}),f('due','다음 연락일','date')],1:[f('student','원생 이름','text',{required:true}),f('action','조치 내용','textarea',{required:true}),f('date','조치일','date',{required:true})]},
  newcomers:{0:[f('student','신입생','record',{required:true}),f('item','체크 항목','select',{required:true,options:['첫 수업 전 전화','첫 수업 후 전화','2주 상담','30일 상담','90일 상담']}),f('done','완료일','date',{required:true})]},
  withdrawals:{1:[f('student','퇴원생','record',{required:true}),f('reason','퇴원 사유','select',{required:true,options:['이사','시간 조정','성적·진도','학원 이동','기타']}),f('memo','메모','textarea')]},
  'withdrawal-reports':{1:[f('report','퇴원보고서','text',{required:true}),f('decision','단계 변경','select',{required:true,options:['승인','반려','보완 요청']}),f('comment','의견','textarea')]},
  'class-sheets':{1:[f('row','시트 줄','record',{required:true}),f('class','반','class'),f('mark','학생 표시','select',{required:true,options:['완료','미완료','결석']}),f('note','메모','textarea')],2:[f('row','반','record',{required:true}),f('week','복사할 주','date',{required:true})]},
  payroll:{0:[f('slip','명세서','record',{required:true}),f('amount','조정 금액','money',{required:true}),f('reason','조정 사유','textarea',{required:true})]},
  staff:{5:[f('staff','직원','staff',{required:true}),f('kind','휴가 종류','select',{required:true,options:['연차','반차','병가','경조사']}),f('start','시작일','date',{required:true}),f('end','종료일','date',{required:true}),f('decision','처리','select',{options:['승인','반려']})],6:[f('staff','직원','staff',{required:true}),f('days','조정 일수','number',{required:true}),f('reason','사유','textarea',{required:true})]},
  inventory:{1:[f('item','대여 물품','record',{required:true}),f('borrower','대여자','staff',{required:true}),f('start','대여일','date',{required:true}),f('due','반납 예정일','date')],2:[f('item','실사 물품','record',{required:true}),f('qty','실사 수량','number',{required:true}),f('date','실사일','date',{required:true})]},
  meetings:{0:[f('title','회의 제목','text',{required:true}),f('date','회의일','date',{required:true}),f('attendees','참석자','multiselect',{options:['원장','부원장','교수부장','데스크']}),f('notes','회의 내용·결정 사항','textarea',{required:true})]},
  approvals:{0:[f('form','양식','select',{required:true,options:['휴가','기본','지출','수입']}),f('title','제목','text',{required:true}),f('amount','금액','money'),f('body','내용','textarea',{required:true})],1:[f('doc','결재 문서','record',{required:true}),f('decision','결정','select',{required:true,options:['승인','반려','보류']}),f('comment','의견','textarea')],2:[f('doc','결재 문서','record',{required:true}),f('comment','댓글','textarea',{required:true})]},
};
const SETTINGS_FORMS=[['profile','학원 정보 미리보기',[f('name','학원 표시 이름','text',{required:true}),f('hours','상담 가능 시간','text')]],['operations','운영 체계 미리보기',[f('periods','평일 교시 수','number',{required:true}),f('holiday','휴원일','date')]],['makeups','보강 운영 미리보기',[f('deadline','보강 기한(일)','number',{required:true}),f('notify','담당 강사에게 알림','checkbox')]],['notifications','알림·약관 미리보기',[f('digest','요약 받을 시각','time',{required:true})]]];

export async function loadInventory(){return JSON.parse(await readFile(INVENTORY,'utf8'));}
export function ownerFamilies(inventory){return inventory.families.filter(x=>x.ownerScope&&x.ownerScope!=='audit-only');}
export function buildFixtureCatalog(inventory){
  const fams=ownerFamilies(inventory),ids=new Set(fams.map(x=>x.id));
  const areas=fams.map(fam=>{
    const viewKind=Object.entries(VIEW).find(([,list])=>list.includes(fam.id))?.[0]||'records';
    const tabs=[...new Set((fam.surfaces||[]).map(s=>s.label).filter(l=>l&&!/^menu\.|\{|\}/.test(l)&&l!==fam.label))].slice(0,8);
    const facets=(FACETS[fam.id]||tabs.map((label,i)=>[`tab-${i}`,label])).map(([id,label])=>({id,label}));
    const ops=fam.operations?.key||[];
    const actions=ops.map((o,i)=>{
      const fields=FIELDS[fam.id]?.[i];
      return fields?{id:`${fam.id}.op${i}`,label:o.op,mode:'preview',fields,draft:{title:o.op,body:`${fam.label}에서 ‘${o.op}’을 처리해 주세요.`},sourceOperationIds:[`${fam.id}:${i}`]}
        :{id:`${fam.id}.op${i}`,label:o.op,mode:'request',fields:[],draft:{title:`${o.op} 요청`,body:`${fam.label}에서 ‘${o.op}’을 진행하고 결과를 보고해 주세요.`},sourceOperationIds:[`${fam.id}:${i}`]};
    });
    if(fam.id==='owner-settings')SETTINGS_FORMS.forEach(([facet,label,fields],i)=>actions.push({id:`owner-settings.face${i}`,label,mode:'preview',target:{page:'workspace-owner-settings',facet},fields,result:{label:`${label} 저장 미리보기`},draft:{title:label,body:label},sourceOperationIds:['owner-settings:0']}));
    if(LEGACY[fam.id])actions.push({id:`${fam.id}.open`,label:'기존 상세 화면에서 보기',mode:'navigate',target:{page:LEGACY[fam.id]},fields:[],draft:{title:'',body:''},sourceOperationIds:[]});
    const relations=fams.filter(x=>x.id!==fam.id&&x.domain===fam.domain).slice(0,3).map(x=>x.id).filter(x=>ids.has(x));
    return {id:fam.id,label:fam.label,group:fam.domain,page:`workspace-${fam.id}`,summary:String(fam.ax?.proposed?.text||''),viewKind,facets,actions,relations};
  });
  return {schemaVersion:1,areas};
}

// Runs in the page after the real snapshot is loaded: real records only, honest labels, plus a full-list helper for the
// records endpoint mock. Families without a projection stay "집계 연결 전" on purpose.
export const projectionScript=`(()=>{const db=window.AcademySnapshot;if(!db||db.workspaces)return;
const src='테스트 투영 · 기존 복사본 기록',rec=(id,label,detail,date,status,fields,facetIds)=>({id:String(id),label:String(label||'—'),detail:detail||'',date:date||'',status:status||'',fields:fields.map(([l,v])=>({label:l,value:v===null||v===undefined||v===''?'—':String(v)})),facetIds});
const count=(rows,id)=>rows.filter(r=>r.facetIds.includes(id)).length;
const fam=(id,title,rows,o={})=>{const facets=(o.facets||[]).map(([fid,label])=>({id:fid,label,count:count(rows,fid)}));return {id,title,summary:o.summary||'',metrics:o.metrics||[],trend:o.trend||null,signals:o.signals||[],facets,records:rows.slice(0,12),totalRecords:rows.length,sourceLabel:src,dataState:rows.length?'available':'empty',coverageNote:o.note||'',_all:rows};};
const won=n=>Number(n||0).toLocaleString('ko-KR')+'원';
const ap={pending:'결재 대기',approved:'승인 완료',rejected:'반려'};
const approvals=db.approvals.map(a=>rec(a.id,a.title,a.drafter,a.date,ap[a.status]||a.status,[['문서 번호',a.number],['기안자',a.drafter],['결재선',a.steps.map(s=>s.name).join(' → ')]],[a.status]));
const makeups=db.makeup.map(m=>rec(m.id,m.name,m.className,m.date,m.status==='done'?'완료':'예약',[['반',m.className],['원결석일',m.absence],['보강일',m.date],['시작',m.start]],[m.status]));
const overdue=db.makeup.filter(m=>m.status==='reserved'&&m.date<db.meta.asOf);
const payslips=db.finance.payslips.map(p=>rec(p.id,p.name,p.period+' 명세서',p.period,p.status==='issued'?'발급 완료':'작성 중',[['기간',p.period],['명세서 지급액',p.net===null?'금액 미확정':won(p.net)],['지급 총액',p.gross===null?'금액 미확정':won(p.gross)]],[p.status]));
const newcomers=db.students.filter(s=>s.status==='enrolled'&&s.onboarding?.length).map(s=>rec(s.id,s.name,s.school+' '+s.grade,s.enrolled,s.onboarding.filter(x=>!x.date).length+'개 미완료',[['등록일',s.enrolled],['미완료 항목',[...new Set(s.onboarding.filter(x=>!x.date).map(x=>x.item))].join(', ')]],[...new Set(s.onboarding.filter(x=>!x.date).map(x=>x.item))]));
const level=g=>/^초/.test(g)?'elementary':/^중/.test(g)?'middle':/^고/.test(g)?'high':'';
const withdrawn=db.students.filter(s=>s.status==='withdrawn').sort((a,b)=>String(b.withdrawn).localeCompare(String(a.withdrawn))).map(s=>rec(s.id,s.name,s.school+' '+s.grade,s.withdrawn,'퇴원',[['등록일',s.enrolled],['퇴원일',s.withdrawn],['학교',s.school]],[level(s.grade)].filter(Boolean)));
const classes=db.classes.map(c=>rec(c.id,c.name,c.teacher,'',c.subject==='english'?'영어':c.subject==='math'?'수학':'공통',[['담당',c.teacher],['강의실',c.room],['수강 학생',c.students.length+'명'],['주간 배치',c.schedules.length+'개']],[c.subject]));
const messages=db.messages.map(m=>rec(m.id,m.name+' 보호자',m.content||m.detail||'',m.date,m.category==='none'?'일반 대화':m.category,[['답글',m.replies.length+'건'],['학생',m.name]],[]));
const supplies=db.supplies.map((s,i)=>rec('supply-'+i,s.name,s.location||'보관 위치 미입력',s.date,'소모품',[['수량',s.qty+'개'],['위치',s.location],['점검일',s.date]],['supplies']));
const bills=db.invoices.filter(i=>i.period===db.meta.month&&i.remaining>0).map(i=>rec(i.id,i.name,i.period+' 청구',i.due,i.status==='partial'?'부분 수납':'미납',[['청구액',won(i.total)],['수납액',won(i.paid)],['남은 금액',won(i.remaining)]],[i.status]));
const days=db.attendance.days.map(d=>rec('day-'+d.date,d.date,'',d.date,'',[['출결 기록',d.total+'건'],['결석',d.absent+'건']],[]));
const now=db.trend.find(t=>t.month===db.meta.month);
const families={
 approvals:fam('approvals','전자결재',approvals,{facets:[['pending','결재 대기'],['approved','완료'],['rejected','반려·회수']],signals:approvals.filter(r=>r.facetIds.includes('pending')).length?[{id:'approval-pending',title:'결재 대기 '+approvals.filter(r=>r.facetIds.includes('pending')).length+'건',summary:'원장 결정이 필요한 결재 문서입니다.',priority:'결정 필요',source:'전자결재 · 대기 상태',recordIds:approvals.filter(r=>r.facetIds.includes('pending')).map(r=>r.id),draft:{title:'결재 문서 보완 확인',body:'대기 중인 결재 문서의 첨부와 보완 사항을 확인해 주세요.'}}]:[]}),
 makeups:fam('makeups','보강관리',makeups,{facets:[['reserved','예약'],['done','완료']],metrics:[{label:'보강 예약',value:makeups.filter(r=>r.facetIds.includes('reserved')).length,unit:'건',detail:'전체 예약 이력 기준'}],signals:overdue.length?[{id:'makeup-overdue',title:'보강일이 지난 예약 '+overdue.length+'건',summary:'보강일이 기준일보다 이전인데 완료 기록이 없습니다.',priority:'확인 필요',source:'보강 예약',recordIds:overdue.map(m=>m.id),draft:{title:'지난 보강 예약 확인',body:'보강일이 지난 예약의 실제 진행 여부를 확인해 주세요.'}}]:[]}),
 payroll:fam('payroll','급여·명세서',payslips,{facets:[['draft','작성 중'],['issued','발급 완료']],note:'명세서 지급액은 실제 송금과 다릅니다.'}),
 newcomers:fam('newcomers','신규생 관리',newcomers,{facets:[['pre_call','첫 수업 전 전화'],['after_first_call','첫 수업 후 전화'],['two_week','2주 상담']]}),
 withdrawals:fam('withdrawals','퇴원관리',withdrawn,{facets:[['elementary','초등'],['middle','중등'],['high','고등']],metrics:[{label:'퇴원 기록',value:withdrawn.length,unit:'명',detail:'학생 상태 기준 전체'}]}),
 'class-sheets':fam('class-sheets','강사 시트',classes,{facets:[['english','영어 강사 시트'],['math','수학 강사 시트']],note:'시트 칸 대신 반 목록을 투영했습니다(테스트).'}),
 'lesson-reports':fam('lesson-reports','수업보고서·학부모 글',messages,{metrics:[{label:'전달 리포트',value:db.communication.sent,unit:'건',detail:'이번 달 전송 성공'},{label:'읽음 확인',value:db.communication.read,unit:'건',detail:''}]}),
 inventory:fam('inventory','재고관리',supplies,{facets:[['supplies','소모품'],['assets','자산']],metrics:[{label:'등록 자산',value:db.assetCount,unit:'개',detail:'상태별 합계'}]}),
 billing:fam('billing','수납관리',bills,{facets:[['partial','부분 수납'],['unpaid','미납']],metrics:[{label:'이번 달 청구',value:now.billed,unit:'원',detail:'할인 반영'},{label:'남은 금액',value:now.remaining,unit:'원',detail:bills.length+'건'}],trend:{label:'청구월별 청구액',unit:'원',granularity:'month',points:db.trend.filter(t=>db.months.includes(t.month)).map(t=>({date:t.month,value:t.billed}))}}),
 attendance:fam('attendance','출석부',days,{trend:{label:'일별 출결 기록',unit:'건',granularity:'day',points:db.attendance.days.map(d=>({date:d.date,value:d.total}))}}),
 'owner-settings':fam('owner-settings','학원 설정',[rec('profile-name','학원 표시 이름','', '', '',[['현재 값',db.meta.tenant]],['profile']),rec('slack-digest','슬랙 요약','', '', '',[['요약 시각',db.channels?.slack?.digest],['방해금지',db.channels?.slack?.quiet]],['notifications'])],{}),
 meetings:{id:'meetings',title:'회의록',summary:'',metrics:[],trend:null,signals:[],facets:[],records:[],totalRecords:0,sourceLabel:src,dataState:'empty',coverageNote:'복사본 화면 입력에 회의록 기록이 없습니다.',_all:[]},
};
const full={};for(const [k,v] of Object.entries(families)){full[k]=v._all;delete v._all;}
db.workspaces={asOf:db.meta.asOf,families};
window.__wsFull=(id,q,facet,page,pageSize)=>{const all=full[id]||[];const terms=String(q||'').toLowerCase().split(/\\s+/).filter(Boolean);const hay=r=>[r.label,r.detail,r.status,r.date,...r.fields.map(x=>x.value)].join(' ').toLowerCase();const byQ=all.filter(r=>terms.every(t=>hay(r).includes(t)));const items=byQ.filter(r=>!facet||r.facetIds.includes(facet));const size=Math.min(100,Math.max(1,pageSize||20)),pages=Math.max(1,Math.ceil(items.length/size));return {familyId:id,total:all.length,filteredTotal:items.length,page,pageSize:size,pageCount:pages,items:items.slice((page-1)*size,page*size),facets:(families[id]?.facets||[]).map(x=>({id:x.id,label:x.label,count:byQ.filter(r=>r.facetIds.includes(x.id)).length}))};};
})();`;

// Serve the new UI files and test fixtures only where this server does not provide them yet.
export async function installWorkspaceRoutes(page,{base,dir,catalog}){
  const served={};
  for(const path of ['/workspace-catalog.js','/workspaces.js','/workspaces.css']){const r=await fetch(base+path,{method:'HEAD'});served[path]=r.ok;}
  const local=async(route,file,type)=>route.fulfill({status:200,contentType:type,body:await readFile(new URL(file,dir),'utf8')});
  if(!served['/workspaces.js'])await page.route(`${base}/workspaces.js`,r=>local(r,'workspaces.js','text/javascript; charset=utf-8'));
  if(!served['/workspaces.css'])await page.route(`${base}/workspaces.css`,r=>local(r,'workspaces.css','text/css; charset=utf-8'));
  if(!served['/workspace-catalog.js'])await page.route(`${base}/workspace-catalog.js`,r=>r.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:`window.AxCatalog=${JSON.stringify(catalog).replaceAll('<','\\u003c')};`}));
  const snapshot=await (await fetch(base+'/snapshot.js')).text();
  const hasWorkspaces=/"workspaces":\{"asOf"/.test(snapshot);
  if(!hasWorkspaces)await page.route(`${base}/snapshot.js`,r=>r.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:`${snapshot}\n${projectionScript}`}));
  const recordsMock={calls:[]};
  if(!hasWorkspaces)await page.route(/\/api\/workspaces\/[^/]+\/records/,async route=>{
    const url=new URL(route.request().url()),id=decodeURIComponent(url.pathname.split('/')[3]);recordsMock.calls.push(url.pathname+url.search);
    const body=await page.evaluate(({id,q,facet,p,size})=>window.__wsFull(id,q,facet,p,size),{id,q:url.searchParams.get('q')||'',facet:url.searchParams.get('facet')||'',p:Number(url.searchParams.get('page')||1),size:Number(url.searchParams.get('pageSize')||20)});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  return {served,fixtureCatalog:!served['/workspace-catalog.js'],fixtureData:!hasWorkspaces,recordsMock};
}
