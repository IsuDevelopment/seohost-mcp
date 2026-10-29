import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStagePath } from './wordpress-stage-provider.js'

// Internal only: caller must have completed all install/checksum checks. Never delete
// manifests, templates/originals, truncated artifacts, credentials or unknown jobs.
export async function cleanupVerifiedInstallArtifacts(home:string,id:string) {
  if(!/^[a-f0-9]{48}$/.test(id))throw Error('Invalid completed installation reference')
  const parent=join(home,'.seohost-mcp-stage/core-repair')
  try{await safeStagePath(home,parent)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{files:0,bytes:0};throw e}
  const job=join(parent,id)
  try{await safeStagePath(home,job)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{files:0,bytes:0};throw e}
  let files=0,bytes=0,entries=0
  const inspect=async(path:string):Promise<void>=>{
    const st=await lstat(path)
    if(++entries>10000||st.isSymbolicLink()||st.uid!==process.getuid?.()||(!st.isDirectory()&&(!st.isFile()||st.nlink!==1)))throw Error('Unsafe install temporary files')
    if(st.isDirectory())for(const name of await readdir(path))await inspect(join(path,name))
    else{files++;bytes+=st.size;if(bytes>320*1024*1024)throw Error('Install temporary files exceed cleanup bounds')}
  }
  const paths:string[]=[]
  for(const name of ['source.tar.gz','extracted']){
    const path=join(job,name)
    try{await lstat(path)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e}
    await inspect(path);paths.push(path)
  }
  for(const path of paths)await rm(path,{recursive:true})
  return{files,bytes}
}
