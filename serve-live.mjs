import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from './snapshot.mjs';
import { fullDbRoot } from './full-db-paths.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { createAssistantFromEnv } from './claude-bridge-http.mjs';
import { createAiReader } from './ai-reader.mjs';
import { createOwnerApiProvider, loadOwnerApiKey, ownerAiTransport } from './owner-ai-api.mjs';
import { handleWorkspaceRecords } from './domain-http.mjs';
import { handleAbsenceDetail } from './absence-detail.mjs';
import { loadFlowSource } from './flow-source.mjs';
import { createFlowAI } from './flow-decision.mjs';
import { createFlowService, defaultStoreDir, startFlow } from './flow-service.mjs';
import { createFlowRoute } from './flow-http.mjs';
import { createFlowCardAttendance } from './flow-card-attendance.mjs';
import { createFlowCardReport } from './flow-card-report.mjs';
import { createFlowCardConsultation } from './flow-card-consultation.mjs';
import { createExitRoute, startExitInsight, exitProviders } from './exit-http.mjs';
import { createCardInsight, openCardInsightStore } from './card-insight.mjs';
import { createCardInsightRoute } from './card-insight-http.mjs';
import { createV2ScreenRoute, loadScreens, screenAsset } from './v2-screens.mjs';
import { createEnrollmentExcelRoute } from './v2-enrollment-excel.mjs';
import { createV2HostRoute, ensureV2Host } from './v2-host-route.mjs';
import { workspaceRecords } from './domain-snapshot.mjs';
import { DATA_REVISION_PATH, createDataHolder, createDataRefresh, encodeData } from './data-refresh.mjs';

const port=Number(process.env.OWNER_CONCEPT_PORT||4310);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local dev port');
const root=new URL('./',import.meta.url);
// 랜 공개(원장 10-30 "같은 랜 전체·전부 허용") — OWNER_CONCEPT_LAN_IP를 준 실행에서만 모든 주소에 묶고 그 IP 이름을 받는다. 없으면 종전대로 이 PC만.
const lanIp=(process.env.OWNER_CONCEPT_LAN_IP||'').trim();
if(lanIp&&!/^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/.test(lanIp))throw new Error('OWNER_CONCEPT_LAN_IP must be a private LAN IPv4');
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...(lanIp?[`${lanIp}:${port}`]:[])]);
const origins=new Set([...hosts].map(h=>`http://${h}`));
const snapshot=await loadSnapshot();
// 첫 화면 자료(/snapshot.js · /snapshot.json) — 2.0 화면 저장 뒤 data-refresh.mjs가 같은 복사본에서 다시 만들어 바꿔 끼운다(AX-H2).
const initialData=encodeData(snapshot,workspaceRecords());
const served=createDataHolder(initialData);
const routes=new Map([
 ['/', ['live.html','text/html; charset=utf-8']],
 ['/index.html',['live.html','text/html; charset=utf-8']],
 ['/styles.css',['styles.css','text/css; charset=utf-8']],
 ['/live.css',['live.css','text/css; charset=utf-8']],
 ['/live.js',['live.js','text/javascript; charset=utf-8']],
 ['/absence-sessions.mjs',['absence-sessions.mjs','text/javascript; charset=utf-8']],
 ['/ai-result-meta.js',['ai-result-meta.js','text/javascript; charset=utf-8']],
 ['/ax.js',['ax.js','text/javascript; charset=utf-8']],
 ['/ax.css',['ax.css','text/css; charset=utf-8']],
 ['/ax-chat.js',['ax-chat.js','text/javascript; charset=utf-8']],
 ['/ax-chat.css',['ax-chat.css','text/css; charset=utf-8']],
 ['/workspace-catalog.js',['workspace-catalog.js','text/javascript; charset=utf-8']],
 ['/workspaces.js',['workspaces.js','text/javascript; charset=utf-8']],
 ['/workspaces.css',['workspaces.css','text/css; charset=utf-8']],
 ['/flow-ui.js',['flow-ui.js','text/javascript; charset=utf-8']],
 ['/flow-ui.css',['flow-ui.css','text/css; charset=utf-8']],
 ['/context-picker.js',['context-picker.js','text/javascript; charset=utf-8']],
 ['/context-picker.css',['context-picker.css','text/css; charset=utf-8']],
 ['/exit-insight.js',['exit-insight.js','text/javascript; charset=utf-8']],
 ['/exit-insight.css',['exit-insight.css','text/css; charset=utf-8']],
 ['/v2-screens.js',['v2-screens.js','text/javascript; charset=utf-8']],
 ['/v2-screens.css',['v2-screens.css','text/css; charset=utf-8']],
 ['/controls.css',['controls.css','text/css; charset=utf-8']],
 ['/fonts/PretendardVariable.woff2',['../../public/fonts/PretendardVariable.woff2','font/woff2']],
]);
// 2.0 public/ 의 그림 파일(출석부 '어제 출결' 아이콘 /icons/*.png · ECS 월간 계획서 /eie-logo.png …)을 같은 경로로 — 그림만, 폴더 밖으로는 못 나간다.
const IMAGE_TYPES={png:'image/png',svg:'image/svg+xml',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',ico:'image/x-icon'};
async function publicAsset(path){
 const m=path.match(/^\/((?:[\w-]+\/)*[\w-][\w.-]*\.(png|svg|jpe?g|webp|gif|ico))$/i);if(!m||m[1].includes('..'))return null;
 const rel=`../../public/${m[1]}`;
 try{if(!(await stat(fileURLToPath(new URL(rel,root)))).isFile())return null;}catch{return null;}
 return [rel,IMAGE_TYPES[m[2].toLowerCase()]];
}
const headers={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
};
// 이 PC 주소는 구독 실행, 랜 주소는 서버 시작 때 읽은 Anthropic 키로 실행한다.
const ownerApiKey=await loadOwnerApiKey();
const ownerApiProvider=createOwnerApiProvider({apiKey:ownerApiKey,readerFactory:()=>createAiReader({target:process.env.OWNER_CONCEPT_DB==='sandbox'?'sandbox':'snapshot'})});
const assistant=createAssistantFromEnv({snapshot,origins,headers,runtimeDefault:new URL('../claude-runtime/',fullDbRoot),apiProvider:ownerApiProvider});
// Local work-flow overlay (FLOW-ENGINE.md): source facts read-only, local actions in F:/aywa-dev/owner-flow.
const flowEnabled=process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&process.env.OWNER_CONCEPT_FLOW!=='off';
const flow=flowEnabled?startFlow(async()=>{const source=await loadFlowSource({workspaces:snapshot.workspaces,capturedAt:snapshot.meta.importedAt,asOf:snapshot.meta.asOf});return createFlowService({source,dir:defaultStoreDir({dataRoot:fullDbRoot,identity:source.identity}),ai:await createFlowAI(),tenantName:snapshot.meta.tenant});}):{service:null,failure:null};
// '왜 줄었나' exit insight (INSIGHT-EXITS.md): code decomposition + case files; AI results beside the flow store, GET only.
const insight=flowEnabled?startExitInsight({snapshot,dir:defaultStoreDir({dataRoot:fullDbRoot,identity:{tenantId,tenantSlug:'cs',capturedAt:snapshot.meta.importedAt}})}):{service:null,failure:null};
const insightRoute=createExitRoute({insight,headers,enabled:flowEnabled});
// 카드 문장은 버튼을 눌렀을 때만 생성한다. GET은 별도 로컬 저장소의 마지막 결과만 읽는다.
const cardCliProvider=flowEnabled?exitProviders().providers?.claude||null:null;
const cardInsight=flowEnabled?(async()=>{
 const dir=defaultStoreDir({dataRoot:fullDbRoot,identity:{tenantId,tenantSlug:'cs',capturedAt:snapshot.meta.importedAt}});
 const store=await openCardInsightStore({dir,identity:{tenantId,tenantSlug:'cs',capturedAt:snapshot.meta.importedAt}});
 return createCardInsight({store,provider:cardCliProvider,reserve:async()=>{await insight.ready;return await insight.service?.reserveClaude()||false;}});
})().catch(error=>{console.error(`카드 문장 저장소: ${error.code||error.message}`);return null;}):Promise.resolve(null);
const cardInsightRoute=createCardInsightRoute({store:cardInsight,headers,providerForOrigin:origin=>ownerAiTransport(origin)==='api'?ownerApiProvider:cardCliProvider});
// 저장 뒤 자료 갱신(AX-H2, data-refresh.mjs): 2.0 화면 저장이 커밋되면 모아서 작업 스레드에서 다시 만들고, 첫 화면·기록·비서를 한 틱에,
// 업무 흐름은 reloadSource로 맞춘다. 복사본이 시작 때와 다르면(복사 시각·기준일·지점) 바꾸지 않는다. 그동안 요청은 옛 자료로 답한다.
const debounceMs=Math.min(60_000,Math.max(200,Number(process.env.OWNER_CONCEPT_REFRESH_DEBOUNCE_MS)||3000));
const refresh=process.env.OWNER_CONCEPT_DATA_REFRESH==='off'?null:createDataRefresh({data:served,assistant,flow:flowEnabled?flow:null,initialRecords:initialData.records,expect:{importedAt:snapshot.meta.importedAt,asOf:snapshot.meta.asOf,tenant:snapshot.meta.tenant},scheduler:{debounceMs}});
// 2.0 화면 (V2-SCREENS.md): 2.0 형태의 새 3.0 페이지, 복사본 DB. v2-screen-<id>.mjs 파일마다 한 화면(공용 파일 수정 없음).
const v2ScreenRoute=createV2ScreenRoute({screens:loadScreens(),headers,onWrite:write=>refresh?.scheduleWrite(write)});
const flowRoute=createFlowRoute({flow,origins,headers,enabled:flowEnabled,cardAttendance:flowEnabled?createFlowCardAttendance({flow,v2ScreenRoute}):null,cardReport:flowEnabled?createFlowCardReport({flow,v2ScreenRoute}):null,cardConsultation:flowEnabled?createFlowCardConsultation({flow,v2ScreenRoute}):null});
// 신규 콜&상담 엑셀 가져오기(2.0 ExcelImportDialog) — 복사본 전용 작업 스레드의 2.0 importer · 같은 출처 POST만 · 바깥 요청 생기면 되돌림(v2-enrollment-excel.mjs).
const enrollmentExcelRoute=createEnrollmentExcelRoute({headers,onWrite:write=>refresh?.scheduleWrite(write)});
// GET = 지금 자료의 개정 번호(열린 첫 화면이 30초마다·포커스 때 묻는다). POST = 지금 다시 읽기(복사본을 화면 밖에서 바꿨을 때 — §2.11 되돌리기 뒤 등).
function dataRevision(req,res){
 const send=(status,body)=>{const b=Buffer.from(JSON.stringify(body));res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,...(status===405?{Allow:'GET, HEAD, POST'}:{})});res.end(req.method==='HEAD'?undefined:b);};
 const info=()=>refresh?refresh.info():{revision:served.current.revision,etag:served.current.etag,asOf:snapshot.meta.asOf,refreshedAt:served.current.refreshedAt,refreshing:false,pending:false,stale:false};
 if(req.method==='POST'){
  const site=req.headers['sec-fetch-site'];req.resume();
  if(site&&site!=='same-origin'||!/^application\/json\b/i.test(req.headers['content-type']||''))return send(403,{error:'forbidden',message:'이 화면에서만 요청할 수 있습니다.'});
  if(!refresh)return send(409,{error:'refresh_off',message:'자료 갱신이 꺼져 있습니다.'});
  refresh.schedule();return send(202,info());
 }
 if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method_not_allowed',message:'조회와 다시 읽기만 할 수 있습니다.'});
 send(200,info());
}
// 2.0 부품 호스트(v2-host/): 2.0 React 부품 그대로 — 3.0 화면 안의 같은 출처 iframe. 산출물이 없으면 시작할 때 한 번 짓는다.
await ensureV2Host();
const v2HostRoute=createV2HostRoute({headers});
async function documentFile(id){
 const db=await openFullDatabase();let document;
 try{[document]=await db.begin('read only',sql=>sql`select file_path,file_name from public.academy_documents where id=${id} and tenant_id=${tenantId}`);}finally{await db.end();}
 if(!document?.file_path)return null;
 const manifest=JSON.parse(await readFile(new URL('storage/manifest.json',fullDbRoot),'utf8'));
 const key=document.file_path.replace(/^academy-documents\//,'');
 const entry=manifest.files.find(f=>f.status==='copied'&&f.bucket==='academy-documents'&&f.key===key);
 if(!entry||!/^[0-9a-f-]+$/i.test(entry.id))return null;
 const path=new URL(`storage/academy-documents/${entry.id}`,fullDbRoot),info=await stat(path);
 if(info.size!==entry.size)return null;
 return {path,size:info.size,name:document.file_name||'학원 문서'};
}
const server=createServer(async(req,res)=>{
 const reject=(code,message)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8',...headers});res.end(message);};
 if(!hosts.has(req.headers.host)||req.headers.origin&&!origins.has(req.headers.origin)){reject(403,'Local access only');return;}
 let path;try{path=new URL(req.url,`http://127.0.0.1:${port}`).pathname;}catch{reject(400,'Invalid request');return;}
 if(path===assistant.path){try{await assistant.handle(req,res);}catch{if(!res.headersSent)reject(500,'로컬 비서를 실행하지 못했습니다.');}return;}
 if(flowRoute.handles(path)){try{await flowRoute.handle(req,res,path);}catch{if(!res.headersSent)reject(500,'업무 흐름을 처리하지 못했습니다.');}return;}
 if(insightRoute.handles(path)){try{insightRoute.handle(req,res);}catch{if(!res.headersSent)reject(500,'이탈 분석을 처리하지 못했습니다.');}return;}
 if(cardInsightRoute.handles(path)){try{await cardInsightRoute.handle(req,res);}catch(error){console.error(`카드 문장: ${error.code||error.message}`);if(!res.headersSent)reject(500,'카드 문장을 처리하지 못했습니다.');}return;}
 if(v2HostRoute.handles(path)){try{await v2HostRoute.handle(req,res,path);}catch{if(!res.headersSent)reject(500,'화면 파일을 읽지 못했습니다.');}return;}
 if(enrollmentExcelRoute.handles(path)){try{await enrollmentExcelRoute.handle(req,res);}catch{if(!res.headersSent)reject(500,'엑셀 파일을 처리하지 못했습니다.');}return;}
 if(v2ScreenRoute.handles(path)){try{await v2ScreenRoute.handle(req,res,path);}catch{if(!res.headersSent)reject(500,'화면을 불러오지 못했습니다.');}return;}
 if(path===DATA_REVISION_PATH){try{dataRevision(req,res);}catch{if(!res.headersSent)reject(500,'자료 상태를 읽지 못했습니다.');}return;}
 if(path==='/api/attendance-absences'){if(req.headers['sec-fetch-site']==='cross-site'){reject(403,'Local access only');return;}try{await handleAbsenceDetail(req,res,headers,snapshot.meta.asOf);}catch{if(!res.headersSent)reject(500,'결석 기록을 읽지 못했습니다.');}return;}
 // JSON endpoints answer their own method errors; cross-site requests still fall through to the guards below.
 if(req.headers['sec-fetch-site']!=='cross-site'){try{if(handleWorkspaceRecords(req,res,headers))return;}catch{if(!res.headersSent)reject(500,'기록을 읽지 못했습니다.');return;}}
 if(!['GET','HEAD'].includes(req.method)){reject(405,'Read-only preview');return;}
 if(req.headers['sec-fetch-site']==='cross-site'&&path!=='/'){reject(403,'Local access only');return;}
 try{
  // 한 요청은 처음 잡은 자료로 끝까지(갱신이 도중에 바꿔 끼워도 머리글·본문이 같은 개정).
  if(path==='/snapshot.js'){const d=served.current;res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Length':d.script.length,...headers});res.end(req.method==='HEAD'?undefined:d.script);return;}
  if(path==='/snapshot.json'){const d=served.current;res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':d.json.length,...headers,ETag:d.etag,'X-Data-Revision':String(d.revision)});res.end(req.method==='HEAD'?undefined:d.json);return;}
  const documentMatch=path.match(/^\/files\/document\/([0-9a-f]{8}-[0-9a-f-]{27})$/i);
  if(documentMatch){
   const file=await documentFile(documentMatch[1]);if(!file){reject(404,'로컬 첨부파일을 아직 준비하지 못했습니다.');return;}
   const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
   res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${name}`});
   if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file.path);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  const file=routes.get(path)||screenAsset(path)||await publicAsset(path);if(!file){reject(404,'Not found');return;}
  // 엿보기 창(flow-ui.js — 업무 흐름 위에 처리 화면을 여는 창)은 이 앱을 같은 출처 iframe(/?peek=1)으로 띄운다 — 그 문서만 같은 출처 틀을 허용.
  const peekDoc=path==='/'&&/[?&]peek=1(?:&|$)/.test(req.url);
  const data=await readFile(fileURLToPath(new URL(file[0],root)));
  const immutable=path==='/fonts/PretendardVariable.woff2';
  const cacheHeaders={...headers,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache',...(peekDoc?{'Content-Security-Policy':headers['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'")}:{})};
  if(!immutable){
   const etag=`"${createHash('sha256').update(data).digest('hex')}"`;
   cacheHeaders.ETag=etag;
   if(String(req.headers['if-none-match']||'').split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag)){res.writeHead(304,cacheHeaders);res.end();return;}
  }
  res.writeHead(200,{'Content-Type':file[1],'Content-Length':data.length,...cacheHeaders});res.end(req.method==='HEAD'?undefined:data);
 }catch{reject(500,'로컬 시안을 불러오지 못했습니다. DB와 파일 준비 상태를 확인해 주세요.');}
});
server.on('error',error=>{console.error(error.code||error.message);process.exitCode=1;});
server.listen(port,lanIp?'0.0.0.0':'127.0.0.1',()=>console.log(`Owner concept: http://127.0.0.1:${port}${lanIp?` · 랜 http://${lanIp}:${port}`:''} (${snapshot.meta.tenant}, verified full local snapshot) · 저장 뒤 자료 갱신 ${refresh?`켜짐(${debounceMs}ms 모음)`:'꺼짐'}`));
