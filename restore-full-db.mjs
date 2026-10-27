import postgres from 'postgres';
import { readFile, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fullDbRoot as work, activeBackup } from './full-db-paths.mjs';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
const {directory:backup,relative:backupRelative}=await activeBackup();
const config=JSON.parse(await readFile(new URL('local.json',work),'utf8'));
const url=new URL(config.url);
if(url.hostname!=='127.0.0.1'||url.port!=='5444'||url.pathname!=='/aywa_full_snapshot')throw new Error('Destination must be the local full clone');
const supplementsOnly=process.argv.includes('--supplements-only');
if(!supplementsOnly){
const adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=postgres(adminUrl.toString(),{max:1,onnotice:()=>{}});
const quote=value=>'"'+value.replaceAll('"','""')+'"';
try {
 const {roles,memberships}=JSON.parse(await readFile(new URL('roles.json',backup),'utf8'));
 for(const role of roles){
  const [exists]=await admin`select exists(select 1 from pg_roles where rolname=${role.rolname}) as exists`;
  if(!exists.exists)await admin`create role ${admin(role.rolname)}`;
  const flags=['super','inherit','createrole','createdb','canlogin','replication','bypassrls'].map(k=>`${role['rol'+k]?'':'NO'}${k==='canlogin'?'LOGIN':k==='super'?'SUPERUSER':k.toUpperCase()}`);
  await admin.unsafe(`ALTER ROLE ${quote(role.rolname)} ${flags.join(' ')} CONNECTION LIMIT ${Number(role.rolconnlimit)}`);
  for(const setting of role.rolconfig||[]){const pos=setting.indexOf('=');await admin.unsafe(`ALTER ROLE ${quote(role.rolname)} SET ${quote(setting.slice(0,pos))} TO '${setting.slice(pos+1).replaceAll("'","''")}'`);}
 }
 for(const m of memberships)await admin.unsafe(`GRANT ${quote(m.role)} TO ${quote(m.member)} WITH ADMIN ${m.admin_option}, INHERIT ${m.inherit_option}, SET ${m.set_option}`);
 const [exists]=await admin`select exists(select 1 from pg_database where datname='aywa_full_snapshot') as exists`;
 if(exists.exists)throw new Error('Full clone database already exists; refuse to overwrite it');
 await admin`create database aywa_full_snapshot owner postgres template template0`;
 console.log('Local database and source role structure created.');
} finally{await admin.end();}
}
const docker=process.env.DOCKER_CLI||'C:/Users/user/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const log=await open(new URL('restore.log',work),supplementsOnly?'a':'w');
try{
 let code=0;
 if(!supplementsOnly){
 const child=spawn(docker,['exec','aywa-full-db','pg_restore','--username=clone_admin','--dbname=aywa_full_snapshot','--exit-on-error','--verbose',`/backup/${backupRelative}source-full.dump`],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error(`Local restore exited with code ${code}; see local restore.log`);
 }
 const manifest=JSON.parse(await readFile(new URL('manifest.json',backup),'utf8'));
 const local=postgres(config.url,{max:1,onnotice:()=>{}});
 try{
  for(const table of manifest.tables.filter(t=>t.supplement)){
   await local.begin(async sql=>{
    await sql`set local session_replication_role='replica'`;
    await sql`delete from ${sql(`${table.schema}.${table.name}`)}`;
    await pipeline(createReadStream(new URL(table.supplement,backup)),await sql`copy ${sql(`${table.schema}.${table.name}`)} from stdin`.writable());
   });
  }
 }finally{await local.end();}
 await writeFile(new URL('restore-status.json',work),JSON.stringify({restoredAt:new Date().toISOString(),exitCode:code}));
 console.log('Full database restore finished; content verification is next.');
}finally{await log.close();}
