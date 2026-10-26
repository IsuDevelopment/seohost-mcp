import { constants } from 'node:fs'
import { open, mkdir, lstat, readdir, writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { safeStagePath } from './wordpress-stage-provider.js'
import { boundedBytes } from './directadmin-http.js'
import { HostingError } from './hosting-error.js'
const exec = promisify(execFile)
const denied = () => new HostingError('CORE_REPAIR_REFUSED','Pinned core preparation or repair could not be verified; keep the reservation and inspect the checkpoint.')
const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex')
const relative=(p:string)=>p.length<=512&&/^[a-zA-Z0-9_.,/@+-]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(v=>v==='..'||v==='.')
async function data(path:string,max=32*1024*1024){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try{const s=await f.stat();if(!s.isFile()||s.uid!==process.getuid?.()||s.nlink!==1||s.size>max)throw denied();const b=Buffer.alloc(s.size+1),r=await f.read(b,0,b.length,0),after=await f.stat();if(r.bytesRead!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs)throw denied();return b.subarray(0,r.bytesRead)}finally{await f.close()}
}
export async function assertPreparedCore(home:string,root:string){
 await safeStagePath(home,root)
 if((await data(join(root,'.htaccess'),128)).toString()!=='Require all denied\n')throw denied()
 for(const p of ['wp-config.php','wp-content/mu-plugins','wp-content/db.php','wp-content/object-cache.php','wp-content/advanced-cache.php','wp-content/sunrise.php']){
  try{await lstat(join(root,p));throw denied()}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
 }
}
type Entry={path:string;kind:'file'|'directory';sha256?:string;size:number;inode:number;mtime:number}
async function tree(home:string,root:string){
 await safeStagePath(home,root);const entries:Entry[]=[];let total=0
 const walk=async(p:string)=>{
  if(!relative(p)||entries.length>=10000)throw denied()
  const path=join(root,p),s=await lstat(path)
  if(s.isSymbolicLink()||s.uid!==process.getuid?.()||(!s.isDirectory()&&!s.isFile()))throw denied()
  const e:Entry={path:p,kind:s.isDirectory()?'directory':'file',size:s.isFile()?s.size:0,inode:s.ino,mtime:s.mtimeMs}
  if(s.isFile()){const b=await data(path);e.sha256=digest(b);total+=b.length;if(total>256*1024*1024)throw denied()}
  entries.push(e)
  if(s.isDirectory())for(const name of(await readdir(path)).sort())await walk(p+'/'+name)
 }
 for(const name of(await readdir(root)).sort())await walk(name)
 return entries
}
async function directory(home:string,path:string){
 if(!path.startsWith(home+'/'))throw denied()
 let current=home
 for(const part of path.slice(home.length+1).split('/')){current=join(current,part);try{await mkdir(current,{mode:0o755})}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}await safeStagePath(home,current)}
}
export async function repairDownloadedCore(home:string,root:string,version:string,id:string,request:typeof fetch,verify:(root:string)=>Promise<unknown>,checkpoint:(phase:string)=>void,tar='/bin/tar',fresh=false){
 if(!/^\d+\.\d+(?:\.\d+)?$/.test(version)||!/^[a-f0-9]{48}$/.test(id))throw denied()
 await assertPreparedCore(home,root)
 const before=await tree(home,root)
 if(fresh&&(before.length!==1||before[0]?.path!=='.htaccess'))throw denied()
 const privateRoot=join(home,'.seohost-mcp-stage');await safeStagePath(home,privateRoot)
 if((await lstat(privateRoot)).mode&0o077)throw denied()
 const parent=join(privateRoot,'core-repair');try{await mkdir(parent,{mode:0o700})}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}
 await safeStagePath(home,parent);if((await lstat(parent)).mode&0o077)throw denied()
 const backup=join(parent,id);await mkdir(backup,{mode:0o700});checkpoint(fresh?'preparing_verified_core':'preparing_core_repair')
 const response=await request(`https://wordpress.org/wordpress-${version}.tar.gz.md5`,{redirect:'error',signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw denied();const expected=(await boundedBytes(response)).toString().trim();if(!/^[a-f0-9]{32}$/.test(expected))throw denied()
 const archive=join(backup,'source.tar.gz'),md5=createHash('md5');let size=0
 const out=await open(archive,'wx',0o600)
 try{
  if(fresh){
   checkpoint('downloading_core')
   const download=await request(`https://wordpress.org/wordpress-${version}.tar.gz`,{redirect:'error',signal:AbortSignal.timeout(180000)})
   if(!download.ok||!download.body||Number(download.headers.get('content-length'))>64*1024*1024){await download.body?.cancel();throw denied()}
   const reader=download.body.getReader()
   try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>64*1024*1024){await reader.cancel();throw denied()}md5.update(r.value);await out.writeFile(r.value)}}finally{reader.releaseLock()}
  }else{
   const cache=join(privateRoot,'cache/core',`wordpress-${version}-en_US.tar.gz`);await safeStagePath(home,dirname(cache))
   const input=await open(cache,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
   try{const st=await input.stat();if(!st.isFile()||st.uid!==process.getuid?.()||st.nlink!==1||st.size>64*1024*1024)throw denied();const buf=Buffer.alloc(65536);for(;;){const r=await input.read(buf,0,buf.length,null);if(!r.bytesRead)break;size+=r.bytesRead;if(size>64*1024*1024)throw denied();const chunk=buf.subarray(0,r.bytesRead);md5.update(chunk);await out.writeFile(chunk)}}finally{await input.close()}
  }
 }finally{await out.close()}
 if(md5.digest('hex')!==expected)throw denied()
 const options={cwd:backup,timeout:180000,maxBuffer:4*1024*1024,env:{HOME:home,PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C'}}
 const listed=(await exec(tar,['-tzf',archive],options)).stdout.trim().split('\n')
 if(listed.length>10000||listed.some(p=>!relative(p)||!p.startsWith('wordpress/')))throw denied()
 const verbose=(await exec(tar,['-tvzf',archive],options)).stdout.trim().split('\n')
 if(verbose.length!==listed.length||verbose.some(line=>!['-','d'].includes(line[0]!)))throw denied()
 const extracted=join(backup,'extracted');await mkdir(extracted,{mode:0o700})
 await exec(tar,['-xzf',archive,'-C',extracted,'--no-same-owner','--no-same-permissions'],options)
 const candidate=join(extracted,'wordpress'),expectedTree=await tree(home,candidate)
 checkpoint('verifying_core_candidate')
 await verify(candidate) // Mandatory official core checksums before any target changes.
 const byPath=new Map(expectedTree.map(e=>[e.path,e])),extras:Entry[]=[]
 for(const e of before){
  if(e.path==='.htaccess')continue
  const wanted=byPath.get(e.path)
  if(wanted){if(wanted.kind!==e.kind||wanted.sha256!==e.sha256)throw denied();continue}
  const possible=expectedTree.filter(v=>('wordpress/'+v.path).slice(0,100).slice(10)===e.path)
  const derivedDirectory=e.kind==='directory'&&before.some(v=>v.path.startsWith(e.path+'/')&&expectedTree.some(w=>('wordpress/'+w.path).slice(0,100).slice(10)===v.path&&w.sha256===v.sha256))
  if(!possible.some(v=>v.kind===e.kind&&v.sha256===e.sha256)&&!derivedDirectory)throw denied()
  extras.push(e)
 }
 if(JSON.stringify(await tree(home,root))!==JSON.stringify(before))throw denied()
 const missing=expectedTree.filter(e=>e.kind==='file'&&!before.some(v=>v.path===e.path))
 await writeFile(join(backup,'manifest.json'),JSON.stringify({root,version,archiveMd5:expected,originalTree:before,expectedTree,extras,missing:missing.map(e=>e.path)}),{flag:'wx',mode:0o600})
 const originals=join(backup,'truncated-originals');await mkdir(originals,{mode:0o700})
 for(const e of extras.filter(e=>e.kind==='file')){if(digest(await data(join(root,e.path)))!==e.sha256)throw denied();const dest=join(originals,e.path);await mkdir(dirname(dest),{recursive:true,mode:0o700});checkpoint(fresh?'installing_verified_core':'repairing_core_paths');await rename(join(root,e.path),dest)}
 const directories=join(backup,'truncated-directories');await mkdir(directories,{mode:0o700})
 for(const e of extras.filter(e=>e.kind==='directory').sort((a,b)=>b.path.length-a.path.length)){if((await readdir(join(root,e.path))).length)throw denied();checkpoint(fresh?'installing_verified_core':'repairing_core_paths');await rename(join(root,e.path),join(directories,digest(Buffer.from(e.path))))}
 for(const e of expectedTree.filter(e=>e.kind==='directory'&&!before.some(v=>v.path===e.path))){checkpoint(fresh?'installing_verified_core':'repairing_core_paths');await directory(home,join(root,e.path))}
 for(const e of missing){const b=await data(join(candidate,e.path));if(digest(b)!==e.sha256)throw denied();await directory(home,dirname(join(root,e.path)));checkpoint(fresh?'installing_verified_core':'repairing_core_paths');await writeFile(join(root,e.path),b,{flag:'wx',mode:0o644})}
 const after=(await tree(home,root)).filter(e=>e.path!=='.htaccess')
 if(after.length!==expectedTree.length||after.some(e=>{const v=byPath.get(e.path);return !v||v.kind!==e.kind||v.sha256!==e.sha256}))throw denied()
 return{reference:id,restoredFiles:missing.length,preservedArtifacts:extras.length}
}
