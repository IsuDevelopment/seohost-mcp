import { constants } from 'node:fs'
import { open, lstat, readdir, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { safeStagePath } from './wordpress-stage-provider.js'
import { HostingError } from './hosting-error.js'

export type TemplateEntry = {path:string;kind:'file'|'directory';bytes:number;mode:number;inode:number;device:number;mtime:number;sha256?:string}
export type TemplateSnapshot = {entries:TemplateEntry[];bytes:number}
const names = new Set(['index.html','400.shtml','401.shtml','403.shtml','404.shtml','500.shtml','503.shtml','cgi-bin','cgi-bin/.htaccess'])
const denied = () => new HostingError('RECOVERY_TARGET_CHANGED','Provider templates or recovery target could not be verified. Preserve the unknown reservation; do not retry.')
const hash = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex')
async function bytes(path:string) {
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try {
  const st=await file.stat()
  if(!st.isFile()||st.uid!==process.getuid?.()||st.nlink!==1||st.size>256*1024)throw denied()
  const buffer=Buffer.alloc(256*1024+1), {bytesRead}=await file.read(buffer,0,buffer.length,0)
  if(bytesRead!==st.size)throw denied()
  return buffer.subarray(0,bytesRead)
 }finally{await file.close()}
}
export async function snapshotTemplates(home:string,root:string):Promise<TemplateSnapshot> {
 await safeStagePath(home,root)
 const entries:TemplateEntry[]=[];let total=0
 const scan=async(relative:string) => {
  const path=join(root,relative), st=await lstat(path)
  if(!names.has(relative)||st.isSymbolicLink()||st.uid!==process.getuid?.()||(!st.isFile()&&!st.isDirectory())||(st.isDirectory()&&relative!=='cgi-bin'))throw denied()
  const entry:TemplateEntry={path:relative,kind:st.isDirectory()?'directory':'file',bytes:st.isFile()?st.size:0,mode:st.mode&0o777,inode:st.ino,device:st.dev,mtime:st.mtimeMs}
  if(st.isFile()){if(st.nlink!==1)throw denied();const data=await bytes(path);entry.sha256=hash(data);total+=data.length;if(total>2*1024*1024)throw denied()}
  entries.push(entry)
  if(st.isDirectory())for(const child of (await readdir(path)).sort())await scan(relative+'/'+child)
 }
 for(const name of (await readdir(root)).sort())await scan(name)
 return{entries,bytes:total}
}
export async function preserveTemplates(home:string,root:string,id:string,expected:TemplateSnapshot,checkpoint:(phase:string)=>void) {
 if(!/^[a-f0-9]{48}$/.test(id))throw denied()
 const same=(a:TemplateSnapshot,b:TemplateSnapshot)=>JSON.stringify(a)===JSON.stringify(b)
 if(!same(await snapshotTemplates(home,root),expected))throw denied()
 const privateRoot=join(home,'.seohost-mcp-stage');await safeStagePath(home,privateRoot)
 if((await lstat(privateRoot)).mode&0o077)throw denied()
 const parent=join(privateRoot,'recovery')
 try{await mkdir(parent,{mode:0o700})}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}
 await safeStagePath(home,parent);if((await lstat(parent)).mode&0o077)throw denied()
 const backup=join(parent,id);await mkdir(backup,{mode:0o700})
 const copies=join(backup,'verified-copy'), originals=join(backup,'originals')
 await mkdir(copies,{mode:0o700});await mkdir(originals,{mode:0o700})
 await writeFile(join(backup,'manifest.json'),JSON.stringify({root,snapshot:expected}),{flag:'wx',mode:0o600})
 // Complete and verify the private copy before relocating any public entry.
 for(const entry of expected.entries){
  const dest=join(copies,entry.path)
  if(entry.kind==='directory')await mkdir(dest,{mode:0o700})
  else{const data=await bytes(join(root,entry.path));if(hash(data)!==entry.sha256)throw denied();await writeFile(dest,data,{flag:'wx',mode:0o600});if(hash(await bytes(dest))!==entry.sha256)throw denied()}
 }
 if(!same(await snapshotTemplates(home,root),expected))throw denied()
 const remaining=[...expected.entries], moved:string[]=[]
 for(const name of expected.entries.filter(e=>!e.path.includes('/')).map(e=>e.path)){
  if(!same(await snapshotTemplates(home,root),{entries:remaining,bytes:remaining.filter(e=>e.kind==='file').reduce((n,e)=>n+e.bytes,0)}))throw denied()
  checkpoint('preserving_provider_templates')
  await rename(join(root,name),join(originals,name));moved.push(name)
  await writeFile(join(backup,'relocation.json'),JSON.stringify({moved}),{mode:0o600})
  for(let i=remaining.length-1;i>=0;i--)if(remaining[i]!.path===name||remaining[i]!.path.startsWith(name+'/'))remaining.splice(i,1)
 }
 if((await readdir(root)).length)throw denied()
 return id
}
