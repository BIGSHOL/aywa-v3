import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fullDbRoot } from './full-db-paths.mjs';
export const tenantId='becaa316-e636-42e9-9d09-08b133e0b094';
export async function openFullDatabase(){
 const {url}=JSON.parse(await readFile(new URL('local.json',fullDbRoot),'utf8'));
 const target=new URL(url);
 if(target.hostname!=='127.0.0.1'||target.port!=='5444'||target.pathname!=='/aywa_full_snapshot')throw new Error('Only the complete local Docker database is allowed');
 return postgres(url,{max:3,prepare:false,connect_timeout:10,idle_timeout:20,onnotice:()=>{}});
}
