import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from './snapshot.mjs';
import { fullDbRoot } from './full-db-paths.mjs';
import { openFullDatabase, tenantId } from './full-db.mjs';

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
 ['/fonts/PretendardVariable.woff2',['../../public/fonts/PretendardVariable.woff2','font/woff2']],
]);
const headers={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
};
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
  const file=routes.get(path);if(!file){reject(404,'Not found');return;}
  const data=await readFile(fileURLToPath(new URL(file[0],root)));res.writeHead(200,{'Content-Type':file[1],'Content-Length':data.length,...headers});res.end(req.method==='HEAD'?undefined:data);
 }catch{reject(500,'로컬 시안을 불러오지 못했습니다. DB와 파일 준비 상태를 확인해 주세요.');}
});
server.on('error',error=>{console.error(error.code||error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Owner concept: http://127.0.0.1:${port} (${snapshot.meta.tenant}, verified full local snapshot)`));
