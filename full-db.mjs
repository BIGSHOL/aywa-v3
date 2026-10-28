import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fullDbRoot } from './full-db-paths.mjs';
export const tenantId='becaa316-e636-42e9-9d09-08b133e0b094';
// 시험장(OWNER_CONCEPT_DB=sandbox): 같은 Docker의 aywa_full_sandbox(= aywa_full_baseline 틀로 만든 사본, work/owner-concept/sandbox-4311.ps1).
// 저장→업무 닫힘 고리를 원장 연습 데이터(aywa_full_snapshot)와 따로 돌려 보는 용도 — 이 두 이름 말고는 열지 않는다.
export const sandbox=process.env.OWNER_CONCEPT_DB==='sandbox';
const DATABASE=sandbox?'/aywa_full_sandbox':'/aywa_full_snapshot';
export async function openFullDatabase(){
 const {url}=JSON.parse(await readFile(new URL('local.json',fullDbRoot),'utf8'));
 const target=new URL(url);
 if(target.hostname!=='127.0.0.1'||target.port!=='5444'||target.pathname!=='/aywa_full_snapshot')throw new Error('Only the complete local Docker database is allowed');
 target.pathname=DATABASE;
 return postgres(target.href,{max:3,prepare:false,connect_timeout:10,idle_timeout:20,onnotice:()=>{}});
}
