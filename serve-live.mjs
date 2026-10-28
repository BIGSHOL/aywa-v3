import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from './snapshot.mjs';
import { fullDbRoot } from './full-db-paths.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';
import { createAssistantFromEnv } from './claude-bridge-http.mjs';
import { handleWorkspaceRecords } from './domain-http.mjs';
import { loadFlowSource } from './flow-source.mjs';
import { createFlowAI } from './flow-decision.mjs';
import { createFlowService, defaultStoreDir, startFlow } from './flow-service.mjs';
import { createFlowRoute } from './flow-http.mjs';
import { createExitRoute, startExitInsight } from './exit-http.mjs';
import { createV2ScreenRoute, loadScreens, screenAsset } from './v2-screens.mjs';
import { createV2HostRoute, ensureV2Host } from './v2-host-route.mjs';

const port=Number(process.env.OWNER_CONCEPT_PORT||4310);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local dev port');
const root=new URL('./',import.meta.url);
const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
const origins=new Set([...hosts].map(h=>`http://${h}`));
const snapshot=await loadSnapshot();
const snapshotScript=Buffer.from(`window.AcademySnapshot=${JSON.stringify(snapshot).replaceAll('<','\\u003c')};`);
const routes=new Map([
 ['/', ['live.html','text/html; charset=utf-8']],
 ['/index.html',['live.html','text/html; charset=utf-8']],
 ['/styles.css',['styles.css','text/css; charset=utf-8']],
 ['/live.css',['live.css','text/css; charset=utf-8']],
 ['/live.js',['live.js','text/javascript; charset=utf-8']],
 ['/ax.js',['ax.js','text/javascript; charset=utf-8']],
 ['/ax.css',['ax.css','text/css; charset=utf-8']],
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
const headers={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
};
// Local dev chat on this PC's Claude subscription; facts come from the snapshot above (CLAUDE-DEV.md).
const assistant=createAssistantFromEnv({snapshot,origins,headers,runtimeDefault:new URL('../claude-runtime/',fullDbRoot)});
// Local work-flow overlay (FLOW-ENGINE.md): source facts read-only, local actions in F:/aywa-dev/owner-flow.
const flowEnabled=process.env.NODE_ENV!=='production'&&!process.env.VERCEL&&process.env.OWNER_CONCEPT_FLOW!=='off';
const flow=flowEnabled?startFlow(async()=>{const source=await loadFlowSource({workspaces:snapshot.workspaces,capturedAt:snapshot.meta.importedAt,asOf:snapshot.meta.asOf});return createFlowService({source,dir:defaultStoreDir({dataRoot:fullDbRoot,identity:source.identity}),ai:await createFlowAI(),tenantName:snapshot.meta.tenant});}):{service:null,failure:null};
const flowRoute=createFlowRoute({flow,origins,headers,enabled:flowEnabled});
// '왜 줄었나' exit insight (INSIGHT-EXITS.md): code decomposition + case files; AI results beside the flow store, GET only.
const insight=flowEnabled?startExitInsight({snapshot,dir:defaultStoreDir({dataRoot:fullDbRoot,identity:{tenantId,tenantSlug:'cs',capturedAt:snapshot.meta.importedAt}})}):{service:null,failure:null};
const insightRoute=createExitRoute({insight,headers,enabled:flowEnabled});
// 2.0 화면 (V2-SCREENS.md): 2.0 형태의 새 3.0 페이지, 복사본 DB 읽기 전용. v2-screen-<id>.mjs 파일마다 한 화면(공용 파일 수정 없음).
const v2ScreenRoute=createV2ScreenRoute({screens:loadScreens(),headers});
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
 if(v2HostRoute.handles(path)){try{await v2HostRoute.handle(req,res,path);}catch{if(!res.headersSent)reject(500,'화면 파일을 읽지 못했습니다.');}return;}
 if(v2ScreenRoute.handles(path)){try{await v2ScreenRoute.handle(req,res,path);}catch{if(!res.headersSent)reject(500,'화면을 불러오지 못했습니다.');}return;}
 // JSON endpoints answer their own method errors; cross-site requests still fall through to the guards below.
 if(req.headers['sec-fetch-site']!=='cross-site'){try{if(handleWorkspaceRecords(req,res,headers))return;}catch{if(!res.headersSent)reject(500,'기록을 읽지 못했습니다.');return;}}
 if(!['GET','HEAD'].includes(req.method)){reject(405,'Read-only preview');return;}
 if(req.headers['sec-fetch-site']==='cross-site'&&path!=='/'){reject(403,'Local access only');return;}
 try{
  if(path==='/snapshot.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Length':snapshotScript.length,...headers});res.end(req.method==='HEAD'?undefined:snapshotScript);return;}
  const documentMatch=path.match(/^\/files\/document\/([0-9a-f]{8}-[0-9a-f-]{27})$/i);
  if(documentMatch){
   const file=await documentFile(documentMatch[1]);if(!file){reject(404,'로컬 첨부파일을 아직 준비하지 못했습니다.');return;}
   const name=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
   res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${name}`});
   if(req.method==='HEAD'){res.end();return;}const stream=createReadStream(file.path);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
  }
  const file=routes.get(path)||screenAsset(path);if(!file){reject(404,'Not found');return;}
  const data=await readFile(fileURLToPath(new URL(file[0],root)));res.writeHead(200,{'Content-Type':file[1],'Content-Length':data.length,...headers});res.end(req.method==='HEAD'?undefined:data);
 }catch{reject(500,'로컬 시안을 불러오지 못했습니다. DB와 파일 준비 상태를 확인해 주세요.');}
});
server.on('error',error=>{console.error(error.code||error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Owner concept: http://127.0.0.1:${port} (${snapshot.meta.tenant}, verified full local snapshot)`));
