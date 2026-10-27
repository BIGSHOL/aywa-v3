import postgres from 'postgres';
import { readFile, writeFile } from 'node:fs/promises';
import { fullDbRoot as work, activeBackup } from './full-db-paths.mjs';
const {url}=JSON.parse(await readFile(new URL('local.json',work),'utf8'));
const destination=new URL(url);
if(destination.hostname!=='127.0.0.1'||destination.port!=='5444'||destination.pathname!=='/aywa_full_snapshot')throw new Error('Destination must be the local full clone');
const {directory:backup}=await activeBackup();
const manifest=JSON.parse(await readFile(new URL('manifest.json',backup),'utf8'));
const db=postgres(url,{max:1,prepare:false,onnotice:()=>{}});
try{
 const result=await db.begin('isolation level repeatable read read only',async sql=>{
  await sql`set local timezone='UTC'`;
  const tables=[];
  for(const table of manifest.tables){
   const [row]=await sql`select count(*)::bigint::text as rows,coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text as fingerprint from only ${sql(`${table.schema}.${table.name}`)} t`;
   tables.push({schema:table.schema,name:table.name,sourceRows:table.rows,localRows:row.rows,rowsMatch:row.rows===table.rows,contentMatch:row.fingerprint===table.fingerprint});
   if(tables.length%50===0||tables.length===manifest.tables.length)console.log(`Local verification: ${tables.length}/${manifest.tables.length} tables`);
  }
  const objects=await sql`select n.nspname as schema,(select count(*)::int from pg_proc p where p.pronamespace=n.oid) as functions,(select count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace=n.oid) as policies,(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=n.oid and not t.tgisinternal) as triggers,(select count(*)::int from pg_constraint con join pg_class c on c.oid=con.conrelid where c.relnamespace=n.oid) as constraints from pg_namespace n where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by 1`;
  const extensions=await sql`select e.extname,e.extversion,n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1`;
  return {tables,objects,extensions};
 });
 const mismatches=result.tables.filter(t=>!t.rowsMatch||!t.contentMatch);
 const structureDifferences=manifest.objects.flatMap(expected=>{
  const actual=result.objects.find(x=>x.schema===expected.schema);
  return ['functions','policies','triggers','constraints'].filter(k=>actual?.[k]!==expected[k]).map(kind=>({schema:expected.schema,kind,source:expected[kind],local:actual?.[kind]??null}));
 });
 const extensionDifferences=manifest.extensions.filter(e=>!result.extensions.some(a=>a.extname===e.extname&&a.extversion===e.extversion));
 const verification={verifiedAt:new Date().toISOString(),capturedAt:manifest.capturedAt,passed:mismatches.length===0&&structureDifferences.length===0,tableCount:result.tables.length,rowCount:result.tables.reduce((n,t)=>n+Number(t.localRows),0),mismatches,structureDifferences,extensionDifferences,tables:result.tables};
 await writeFile(new URL('verification.json',work),JSON.stringify(verification,null,2));
 console.log(JSON.stringify({...verification,tables:undefined}));
 if(!verification.passed)process.exitCode=1;
}finally{await db.end();}
