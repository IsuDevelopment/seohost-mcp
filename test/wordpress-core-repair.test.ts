import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,lstat,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {repairDownloadedCore} from '../src/wordpress-core-repair.js'
import {HostingError} from '../src/hosting-error.js'
const exec=promisify(execFile),tar=process.platform==='darwin'?'/usr/bin/tar':'/bin/tar'
async function fixture(unsafe=false){
 const home=await realpath(await mkdtemp(join(tmpdir(),'core-repair-'))),root=join(home,'domains/stg.example.com/public_html'),source=join(home,'source/wordpress'),long='wp-includes/'+('a'.repeat(40))+'/'+('b'.repeat(40))+'/long-module.php',truncated=('wordpress/'+long).slice(0,100).slice(10)
 await mkdir(root,{recursive:true});await mkdir(dirname(join(source,long)),{recursive:true});await writeFile(join(source,long),'official long module fixture');await writeFile(join(source,'index.php'),'official index fixture')
 if(unsafe)await symlink('/etc/passwd',join(source,'unsafe-link'))
 const archive=join(home,'.seohost-mcp-stage/cache/core/wordpress-6.9.1-en_US.tar.gz');await mkdir(dirname(archive),{recursive:true,mode:0o700});await exec(tar,['-czf',archive,'-C',join(home,'source'),'wordpress'])
 const md5=createHash('md5').update(await readFile(archive)).digest('hex')
 const font='wp-content/fonts/Family_slnt,wght.woff2',large='wp-includes/worker.min.js'
 await mkdir(dirname(join(source,font)),{recursive:true});await writeFile(join(source,font),'font fixture');await writeFile(join(source,large),'j'.repeat(9*1024*1024));await mkdir(join(source,'empty-official-folder'))
 await exec(tar,['-czf',archive,'-C',join(home,'source'),'wordpress'])
 const finalMd5=createHash('md5').update(await readFile(archive)).digest('hex')
 await mkdir(dirname(join(root,font)),{recursive:true});await writeFile(join(root,font),'font fixture');await mkdir(dirname(join(root,large)),{recursive:true});await writeFile(join(root,large),'j'.repeat(9*1024*1024))
 await writeFile(join(root,'.htaccess'),'Require all denied\n');await writeFile(join(root,'index.php'),'official index fixture');await mkdir(dirname(join(root,truncated)),{recursive:true});await writeFile(join(root,truncated),'official long module fixture')
 const request:typeof fetch=async(url)=>{assert.equal(String(url),'https://wordpress.org/wordpress-6.9.1.tar.gz.md5');return new Response(finalMd5)}
 const verify=async(path:string)=>{assert.equal(await readFile(join(path,long),'utf8'),'official long module fixture')}
 const repair=(check=verify)=>repairDownloadedCore(home,root,'6.9.1','a'.repeat(48),request,check,()=>{},tar)
 return{home,root,long,truncated,repair,archive,finalMd5,verify,close:()=>rm(home,{recursive:true,force:true})}
}
test('verified archive repair restores GNU long paths, retains truncated originals and never overwrites correct core',async()=>{
 const f=await fixture();try{
 const before=await lstat(join(f.root,'index.php')),result=await f.repair()
 assert.equal(result.restoredFiles,1);assert.equal(result.preservedArtifacts,1)
 assert.equal(await readFile(join(f.root,f.long),'utf8'),'official long module fixture')
 await assert.rejects(lstat(join(f.root,f.truncated)),{code:'ENOENT'})
 assert.equal(await readFile(join(f.home,'.seohost-mcp-stage/core-repair','a'.repeat(48),'truncated-originals',f.truncated),'utf8'),'official long module fixture')
 assert.equal((await lstat(join(f.root,'index.php'))).ino,before.ino)
 assert.equal(await readFile(join(f.root,'.htaccess'),'utf8'),'Require all denied\n')
 }finally{await f.close()}
})
test('modified core bytes are refused without replacing the file or moving artifacts',async()=>{
 const f=await fixture();try{
 await writeFile(join(f.root,'index.php'),'unexpected edited content')
 await assert.rejects(f.repair(),(e:unknown)=>e instanceof HostingError&&e.code==='CORE_REPAIR_REFUSED')
 assert.equal(await readFile(join(f.root,'index.php'),'utf8'),'unexpected edited content')
 assert.equal(await readFile(join(f.root,f.truncated),'utf8'),'official long module fixture')
 }finally{await f.close()}
})
test('failed independent candidate checksums leave public files untouched',async()=>{
 const f=await fixture();try{
 await assert.rejects(f.repair(async()=>{throw new HostingError('WP_CLI_FAILED','Fixture checksum failure')}))
 await assert.rejects(lstat(join(f.root,f.long)),{code:'ENOENT'})
 assert.equal(await readFile(join(f.root,f.truncated),'utf8'),'official long module fixture')
 }finally{await f.close()}
})
test('archive links are refused before extraction or public changes',async()=>{
 const f=await fixture(true);try{
 await assert.rejects(f.repair(),(e:unknown)=>e instanceof HostingError&&e.code==='CORE_REPAIR_REFUSED')
 await assert.rejects(lstat(join(f.root,'unsafe-link')),{code:'ENOENT'})
 assert.equal(await readFile(join(f.root,f.truncated),'utf8'),'official long module fixture')
 }finally{await f.close()}
})


test('fresh pinned download preserves long paths and never needs a broken extraction or separate recovery',async()=>{
 const f=await fixture();try{
 await rm(f.root,{recursive:true});await mkdir(f.root);await writeFile(join(f.root,'.htaccess'),'Require all denied\n')
 const calls:string[]=[],phases:string[]=[]
 const request:typeof fetch=async(url,init)=>{calls.push(String(url));assert.equal(init?.redirect,'error');return new Response(String(url).endsWith('.md5')?f.finalMd5:await readFile(f.archive))}
 const done=await repairDownloadedCore(f.home,f.root,'6.9.1','b'.repeat(48),request,f.verify,p=>phases.push(p),tar,true)
 assert.equal(done.preservedArtifacts,0);assert(done.restoredFiles>=4)
 assert.equal(await readFile(join(f.root,f.long),'utf8'),'official long module fixture')
 assert.equal(calls.length,2);assert(phases.includes('downloading_core'))
 assert.equal(await readFile(join(f.root,'.htaccess'),'utf8'),'Require all denied\n')
 }finally{await f.close()}
})
test('fresh download with wrong digest or oversized response never populates the public root',async()=>{
 for(const oversized of [false,true]){
 const f=await fixture();try{
 await rm(f.root,{recursive:true});await mkdir(f.root);await writeFile(join(f.root,'.htaccess'),'Require all denied\n')
 const request:typeof fetch=async(url)=>String(url).endsWith('.md5')?new Response('0'.repeat(32)):new Response(await readFile(f.archive),{headers:oversized?{'content-length':String(65*1024*1024)}:{}})
 await assert.rejects(repairDownloadedCore(f.home,f.root,'6.9.1','b'.repeat(48),request,f.verify,()=>{},tar,true))
 await assert.rejects(lstat(join(f.root,'index.php')),{code:'ENOENT'})
 }finally{await f.close()}
 }
})
