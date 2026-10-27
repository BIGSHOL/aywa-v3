import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isAbsolute, resolve, sep } from 'node:path';
const location=JSON.parse(await readFile(new URL('../../work/owner-concept/storage-location.json',import.meta.url),'utf8'));
if(!isAbsolute(location.root))throw new Error('Configure an absolute local data directory');
export const fullDbRoot=pathToFileURL(resolve(location.root)+sep);
export async function activeBackup(){
 const pointer=JSON.parse(await readFile(new URL('current-backup.json',fullDbRoot),'utf8'));
 if(!/^backups\/[a-zA-Z0-9_-]+\/$/.test(pointer.directory))throw new Error('Invalid local backup directory');
 const directory=new URL(pointer.directory,fullDbRoot);
 if(!fileURLToPath(directory).startsWith(fileURLToPath(fullDbRoot)))throw new Error('Backup must stay inside local data directory');
 return {directory,relative:pointer.directory};
}
