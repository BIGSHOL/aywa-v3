import postgres from 'postgres';
import { parse } from 'dotenv';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fullDbRoot as work } from './full-db-paths.mjs';
const storage=new URL('storage/',work);
await mkdir(storage,{recursive:true});
const {url}=JSON.parse(await readFile(new URL('local.json',work),'utf8'));
const destination=new URL(url);
if(destination.hostname!=='127.0.0.1'||destination.port!=='5444'||destination.pathname!=='/aywa_full_snapshot')throw new Error('Use the local full database only');
const db=postgres(url,{max:1,onnotice:()=>{}});
const objects=await db.begin('read only',sql=>sql`select id,bucket_id,name,metadata,version from storage.objects order by coalesce((metadata->>'size')::bigint,0),id`);
await db.end();
const source=parse(await readFile(process.env.SOURCE_ENV_FILE||'D:/eywa_refactoring/.env.local','utf8'));
const base=new URL(source.NEXT_PUBLIC_SUPABASE_URL);
if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!source.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Storage source unavailable');
const manifestFile=new URL('manifest.json',storage);
let old={files:[]};try{old=JSON.parse(await readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const done=new Map(old.files.filter(f=>f.status==='copied').map(f=>[f.id,f]));
const results=[];let index=0,bytes=0,completed=0;
let persist=Promise.resolve();
const save=()=>{const state=JSON.stringify({updatedAt:new Date().toISOString(),expected:objects.length,completed,bytes,files:[...results]},null,2);persist=persist.then(()=>writeFile(manifestFile,state,{mode:0o600}));return persist;};
async function copy(object){
 if(!/^[a-z0-9_-]+$/i.test(object.bucket_id)||!/^[0-9a-f-]+$/i.test(object.id))throw new Error('Unexpected storage identifier');
 const expected=Number(object.metadata?.size||0);
 const bucket=new URL(`${object.bucket_id}/`,storage);await mkdir(bucket,{recursive:true});
 const file=new URL(object.id,bucket),partial=new URL(`${object.id}.partial`,bucket);
 const previous=done.get(object.id);
 if(previous&&previous.sourceVersion===object.version&&previous.size===expected){try{const s=await stat(file);if(s.size===expected)return {...previous,resumed:true};}catch(e){if(e.code!=='ENOENT')throw e;}}
 let lastError;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const path=object.name.split('/').map(encodeURIComponent).join('/');
   const response=await fetch(new URL(`/storage/v1/object/${object.bucket_id}/${path}`,base),{headers:{Authorization:`Bearer ${source.SUPABASE_SERVICE_ROLE_KEY}`,apikey:source.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(240000),redirect:'error'});
   if(!response.ok){await response.body?.cancel();throw new Error(`HTTP_${response.status}`);}
   const sha=createHash('sha256'),md5=createHash('md5');let size=0;
   const meter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;sha.update(chunk);md5.update(chunk);callback(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(partial,{mode:0o600}));
   if(size!==expected)throw new Error(`SIZE_MISMATCH_${expected}_${size}`);
   const digest=md5.digest('hex');const etag=String(object.metadata?.eTag||object.metadata?.etag||'').replaceAll('"','');
   const comparable=/^[0-9a-f]{32}$/i.test(etag);
   if(comparable&&digest!==etag.toLowerCase())throw new Error('SOURCE_CHECKSUM_MISMATCH');
   await rename(partial,file);
   return {id:object.id,bucket:object.bucket_id,key:object.name,sourceVersion:object.version,size,sha256:sha.digest('hex'),sourceMd5Verified:comparable,status:'copied'};
  }catch(error){lastError=error.message;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
 }
 return {id:object.id,bucket:object.bucket_id,key:object.name,sourceVersion:object.version,expected,status:'failed',reason:lastError};
}
async function worker(){while(index<objects.length){const object=objects[index++];const result=await copy(object);results.push(result);if(result.status==='copied'){completed++;bytes+=result.size;}if(results.length%100===0||results.length===objects.length){console.log(`Storage: ${completed}/${objects.length} files, ${(bytes/1e9).toFixed(2)} GB, ${results.filter(r=>r.status==='failed').length} failures`);await save();}}}
await Promise.all(Array.from({length:4},worker));await save();
const failed=results.filter(f=>f.status!=='copied');console.log(JSON.stringify({expected:objects.length,copied:completed,failed:failed.length,bytes}));
if(failed.length)process.exitCode=1;
