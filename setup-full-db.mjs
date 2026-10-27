import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dirname, delimiter } from 'node:path';
import { fullDbRoot as work } from './full-db-paths.mjs';
await mkdir(work,{recursive:true});
const path=new URL('local.password',work);
let password;
try{password=(await readFile(path,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;password=randomBytes(30).toString('hex');await writeFile(path,password+'\n',{mode:0o600,flag:'wx'});}
await writeFile(new URL('local.json',work),JSON.stringify({url:`postgres://clone_admin:${password}@127.0.0.1:5444/aywa_full_snapshot`}),{mode:0o600});
const docker=process.env.DOCKER_CLI||'C:/Users/user/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const env={...process.env,FULL_DB_ROOT:fileURLToPath(work).replaceAll('\\','/')};const key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';env[key]=`${dirname(docker)}${delimiter}${env[key]||''}`;
const child=spawn(docker,['compose','-f',fileURLToPath(new URL('./compose-full.yaml',import.meta.url)),'up','-d','--wait','--wait-timeout','120'],{env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
