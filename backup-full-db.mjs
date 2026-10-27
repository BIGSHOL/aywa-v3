import postgres from 'postgres';
import { parse } from 'dotenv';
import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, delimiter } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fullDbRoot } from './full-db-paths.mjs';
import { randomBytes } from 'node:crypto';

// Full database backup: no table, column, tenant, or schema selection.
// Source access is read-only; all artifacts remain in ignored local storage.
const relative=`backups/${new Date().toISOString().replace(/[:.]/g,'-')}_${randomBytes(3).toString('hex')}/`;
const work=new URL(relative,fullDbRoot);
await mkdir(work,{recursive:true});
const sourceEnv=parse(await readFile(process.env.SOURCE_ENV_FILE||'D:/eywa_refactoring/.env.local','utf8'));
const url=new URL(sourceEnv.DATABASE_URL);
const project=new URL(sourceEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (!(url.hostname===`db.${project}.supabase.co`||decodeURIComponent(url.username).endsWith(`.${project}`))) throw new Error('Source project mismatch');
const docker=process.env.DOCKER_CLI||'C:/Users/user/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const env={...process.env};
const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';
env[pathKey]=`${dirname(docker)}${delimiter}${env[pathKey]||''}`;
const pgEnv=new URL('source.pg.env',work);
const pgValues={PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)||'postgres',PGSSLMODE:'require',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=0'};
if(Object.values(pgValues).some(v=>/[\r\n]/.test(v))) throw new Error('Unsupported connection parameter');
await writeFile(pgEnv,Object.entries(pgValues).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
const source=postgres(sourceEnv.DATABASE_URL,{ssl:'require',prepare:false,max:1,connect_timeout:20,onnotice:()=>{}});
try {
 const manifest=await source.begin('isolation level repeatable read read only',async sql=>{
  await sql`set local statement_timeout=0`;
  await sql`set local idle_in_transaction_session_timeout=0`;
  await sql`set local timezone='UTC'`;
  const [guard]=await sql`select current_setting('transaction_read_only') as read_only,pg_export_snapshot() as snapshot,now() as captured_at,version() as version`;
  if(guard.read_only!=='on')throw new Error('Source must be read-only');
  const tables=await sql`select n.nspname as schema,c.relname as name,c.relkind,exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') as extension_owned from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p') order by 1,2`;
  const schemas=await sql`select nspname from pg_namespace where nspname !~ '^pg_' and nspname<>'information_schema' order by 1`;
  const roles=await sql`select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles where rolname !~ '^pg_' order by 1`;
  const memberships=await sql`select r.rolname as role,m.rolname as member,a.admin_option,a.inherit_option,a.set_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member order by 1,2`;
  const extensions=await sql`select e.extname,e.extversion,n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1`;
  const objects=await sql`select n.nspname as schema,(select count(*)::int from pg_proc p where p.pronamespace=n.oid) as functions,(select count(*)::int from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace=n.oid) as policies,(select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=n.oid and not t.tgisinternal) as triggers,(select count(*)::int from pg_constraint con join pg_class c on c.oid=con.conrelid where c.relnamespace=n.oid) as constraints from pg_namespace n where n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by 1`;
  await writeFile(new URL('roles.json',work),JSON.stringify({roles,memberships},null,2),{mode:0o600});
  const log=await open(new URL('backup.log',work),'w');
  const child=spawn(docker,['run','--rm','--name','aywa-full-db-backup','--env-file',fileURLToPath(pgEnv),'--mount',`type=bind,source=${fileURLToPath(work)},target=/backup`,'postgres:17-alpine','pg_dump','--format=custom','--compress=6','--file=/backup/source-full.dump',`--snapshot=${guard.snapshot}`,'--no-password','--verbose'],{env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  const dumping=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Full pg_dump exited with code ${code}; see local backup.log`)));});
  // Install a rejection handler immediately while table fingerprints are queried.
  let dumpError;dumping.catch(e=>{dumpError=e;});
  const counts=[];
  try { for(const table of tables){
   if(dumpError)throw dumpError;
   const [row]=await sql`select count(*)::bigint::text as rows,coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text as fingerprint from only ${sql(`${table.schema}.${table.name}`)} t`;
   let supplement;
   if(table.extension_owned){
    supplement=`${table.schema}.${table.name}.copy`;
    await pipeline(await sql`copy ${sql(`${table.schema}.${table.name}`)} to stdout`.readable(),createWriteStream(new URL(supplement,work)));
   }
   counts.push({...table,...row,...(supplement?{supplement}:{})});
   if(counts.length%25===0||counts.length===tables.length)console.log(`Source verification: ${counts.length}/${tables.length} tables`);
  }
  await dumping;
  } finally { await dumping.catch(()=>{}); await log.close(); }
  const [largeObjects]=await sql`select count(*)::int as count from pg_largeobject_metadata`;
  return {capturedAt:guard.captured_at,version:guard.version,sourceReadOnly:true,scope:'entire-source-database',schemas,extensions,objects,largeObjects:largeObjects.count,tables:counts};
 });
 await writeFile(new URL('manifest.json',work),JSON.stringify(manifest,null,2),{mode:0o600});
 await writeFile(new URL('current-backup.json',fullDbRoot),JSON.stringify({directory:relative,capturedAt:manifest.capturedAt}),{mode:0o600});
 console.log(JSON.stringify({backup:'source-full.dump',schemas:manifest.schemas.length,tables:manifest.tables.length,rows:manifest.tables.reduce((n,t)=>n+Number(t.rows),0),sourceReadOnly:true}));
} catch(error){console.error(error.code||'BACKUP_FAILED',error.message);process.exitCode=1;}
finally{await source.end({timeout:5});await rm(pgEnv,{force:true});}
