import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { LIMITS, assistantRequestProblems } from './ax-assistant-limits.mjs';

// Contract for POST /api/assistant {prompt, contextIssueId, history:[{role,content}]}
//   -> {answer, issueIds, suggestedTask:null|{title,body}, provider:'claude-cli'}.
// Default run: the page's own response validator against fixed payloads. No network, no Claude call.
// AX_ASSISTANT_LIVE=1: additionally one genuine request (one Claude CLI call) plus one invalid request that the
// backend must reject before calling the model. Run that mode deliberately, once, against the backend build.
const base=process.env.OWNER_CONCEPT_URL||'http://127.0.0.1:4310';
const live=process.env.AX_ASSISTANT_LIVE==='1';
const browser=await chromium.launch();
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=body=>page.evaluate(async body=>{const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});let json=null;try{json=await r.json();}catch{/* not JSON */}return {status:r.status,json};},body);
try{
  await page.goto(base);
  const contract=await page.evaluate(()=>({endpoint:window.AxAssistantContract?.endpoint,limits:window.AxAssistantContract?.limits}));
  assert.deepEqual(contract,{endpoint:'/api/assistant',limits:LIMITS},'UI limits match the backend contract');
  const histories=await page.evaluate(()=>{
    const build=window.AxAssistantContract.buildHistory,turn=(prompt,answer,status='done')=>({prompt,answer,status});
    return {
      empty:build([]),
      skipped:build([turn('질문','',),turn('질문','답','error'),turn('질문','답','cancelled'),turn('  ','답')]),
      many:build(Array.from({length:20},(_,i)=>turn(`질문 ${i}`,`답변 ${i}`))),
      long:build(Array.from({length:8},(_,i)=>turn('가'.repeat(2500),`답변 ${i} `+'나'.repeat(3000)))),
      big:build([turn('오래된 질문','오래된 답'),turn('가'.repeat(1900),'나'.repeat(1900)),turn('다'.repeat(1900),'라'.repeat(1900)),turn('마'.repeat(1900),'바'.repeat(1900))]),
    };
  });
  assert.deepEqual(histories.empty,[]);assert.deepEqual(histories.skipped,[],'Only completed turns with text become history');
  assert.equal(histories.many.length,12);assert.equal(histories.many.at(-1).content,'답변 19','Newest turns are kept');
  assert.deepEqual(histories.many.slice(0,2).map(m=>m.role),['user','assistant']);
  for(const [name,history] of Object.entries(histories))assert.deepEqual(assistantRequestProblems({prompt:'확인',contextIssueId:null,history}),[],`${name} history fits the backend limits`);
  assert.equal(histories.big.length,4,'Oldest pairs are dropped whole when the character budget is reached');
  const cases=await page.evaluate(()=>{
    const v=window.AxAssistantContract.validate;
    const ok={answer:'수납 잔액은 329,000원입니다.',issueIds:['billing'],suggestedTask:{title:'수납 확인',body:'14건 대조 후 보고'},provider:'claude-cli'};
    return {
      full:v(ok),
      noTask:v({...ok,suggestedTask:null}),
      noAnswer:v({...ok,answer:'  '}),
      noProvider:v({...ok,provider:''}),
      badIds:v({...ok,issueIds:'billing'}),
      badTask:v({...ok,suggestedTask:{title:'',body:'x'}}),
      missingTask:v({answer:'a',issueIds:[],provider:'claude-cli'}),
      array:v([ok]),
      text:v('답변'),
    };
  });
  assert.deepEqual(cases.full.problems,[]);assert.equal(cases.full.value.suggestedTask.title,'수납 확인');assert.equal(cases.full.value.provider,'claude-cli');
  assert.deepEqual(cases.noTask.problems,[]);assert.equal(cases.noTask.value.suggestedTask,null);
  for(const key of ['noAnswer','noProvider','array','text'])assert.equal(cases[key].value,null,`${key} must be rejected`);
  for(const key of ['badIds','badTask','missingTask']){assert(cases[key].problems.length>0,`${key} must be reported`);assert(cases[key].value,`${key} keeps the answer`);}
  assert.equal(cases.badTask.value.suggestedTask,null,'A malformed task is never offered');
  if(live){
    const rejected=await post({history:[]});
    assert(rejected.status>=400&&rejected.status<500,`Missing prompt must be rejected before any model call (HTTP ${rejected.status})`);
    const started=Date.now();
    const real=await post({prompt:'원장 브리핑의 수납 확인 이슈를 두 문장으로 요약해줘.',contextIssueId:'billing',history:[]});
    assert.equal(real.status,200,`Live call failed: HTTP ${real.status} ${JSON.stringify(real.json)}`);
    const checked=await page.evaluate(json=>window.AxAssistantContract.validate(json),real.json);
    assert.deepEqual(checked.problems,[],`Live response breaks the contract: ${checked.problems.join(' ')}`);
    assert.equal(checked.value.provider,'claude-cli');
    console.log(`LIVE: ${Math.round((Date.now()-started)/1000)}s · issueIds=${JSON.stringify(checked.value.issueIds)} · suggestedTask=${checked.value.suggestedTask?'yes':'no'} · answer=${checked.value.answer.slice(0,80)}…`);
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: assistant contract (UI limits = backend limits, 5 history budgets, ${Object.keys(cases).length} response cases${live?' + one live Claude CLI call + invalid-input rejection':', no network'}).`);
}finally{await browser.close();}
