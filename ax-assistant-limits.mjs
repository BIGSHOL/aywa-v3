// Test helper: the backend's request rules for POST /api/assistant, as agreed with the backend worker.
// verify-ax.mjs applies it to every request the UI sends; verify-ax-assistant.mjs applies it to built histories.
export const ISSUE_IDS=['billing','admissions','attendance','approval','tasks','books','enrollment'];
export const LIMITS={prompt:1000,historyItems:12,historyItem:2000,historyTotal:8000};

export function assistantRequestProblems(body){
  const problems=[];
  if(!body||typeof body!=='object'||Array.isArray(body))return ['body is not an object'];
  const extra=Object.keys(body).filter(k=>!['prompt','contextIssueId','history'].includes(k));
  if(extra.length)problems.push(`unknown keys: ${extra.join(', ')}`);
  const prompt=typeof body.prompt==='string'?body.prompt.trim():null;
  if(prompt===null||prompt.length<1||prompt.length>LIMITS.prompt)problems.push(`prompt length ${prompt?.length}`);
  if(!(body.contextIssueId===undefined||body.contextIssueId===null||ISSUE_IDS.includes(body.contextIssueId)))problems.push(`contextIssueId ${body.contextIssueId}`);
  const history=body.history===undefined?[]:body.history;
  if(!Array.isArray(history))return [...problems,'history is not an array'];
  if(history.length>LIMITS.historyItems)problems.push(`history items ${history.length}`);
  let total=0;
  history.forEach((m,i)=>{
    const keys=m&&typeof m==='object'?Object.keys(m):[];
    if(keys.length!==2||!keys.includes('role')||!keys.includes('content'))problems.push(`history[${i}] keys`);
    if(!['user','assistant'].includes(m?.role))problems.push(`history[${i}] role`);
    const length=typeof m?.content==='string'?m.content.length:-1;
    if(length<1||length>LIMITS.historyItem||!m.content.trim())problems.push(`history[${i}] content length ${length}`);
    total+=Math.max(length,0);
  });
  if(total>LIMITS.historyTotal)problems.push(`history total ${total}`);
  return problems;
}
