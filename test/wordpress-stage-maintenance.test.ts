import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile, readFile, lstat, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanupVerifiedInstallArtifacts } from '../src/wordpress-stage-maintenance.js'

test('verified install cleanup removes only downloaded/extracted core and keeps credentials, manifests and original backups',async()=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'stage-cleanup-'))),id='a'.repeat(48),root=join(home,'.seohost-mcp-stage'),job=join(root,'core-repair',id)
 try{
  for(const p of [join(job,'extracted/wordpress'),join(job,'truncated-originals'),join(root,'recovery',id)])await mkdir(p,{recursive:true,mode:0o700})
  for(const [p,data] of [[join(job,'source.tar.gz'),'archive'],[join(job,'extracted/wordpress/index.php'),'download'],[join(job,'truncated-originals/keep'),'original'],[join(job,'manifest.json'),'manifest'],[join(root,id+'.json'),'credential sentinel'],[join(root,'recovery',id,'keep'),'template original']])await writeFile(p!,data!)
  const done=await cleanupVerifiedInstallArtifacts(home,id);assert.equal(done.files,2);assert.equal(done.bytes,15)
  await assert.rejects(lstat(join(job,'source.tar.gz')),{code:'ENOENT'});await assert.rejects(lstat(join(job,'extracted')),{code:'ENOENT'})
  assert.equal(await readFile(join(job,'manifest.json'),'utf8'),'manifest');assert.equal(await readFile(join(job,'truncated-originals/keep'),'utf8'),'original');assert.equal(await readFile(join(root,id+'.json'),'utf8'),'credential sentinel');assert.equal(await readFile(join(root,'recovery',id,'keep'),'utf8'),'template original')
  assert.deepEqual(await cleanupVerifiedInstallArtifacts(home,id),{files:0,bytes:0})
 }finally{await rm(home,{recursive:true,force:true})}
})
test('install cleanup refuses links and traversal before deleting any temporary files',async()=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'stage-cleanup-'))),id='b'.repeat(48),job=join(home,'.seohost-mcp-stage/core-repair',id)
 try{
  await mkdir(join(job,'extracted'),{recursive:true});await writeFile(join(job,'source.tar.gz'),'keep on refusal');await writeFile(join(home,'outside'),'outside sentinel');await symlink(join(home,'outside'),join(job,'extracted/escape'))
  await assert.rejects(cleanupVerifiedInstallArtifacts(home,id));assert.equal(await readFile(join(home,'outside'),'utf8'),'outside sentinel');assert.equal(await readFile(join(job,'source.tar.gz'),'utf8'),'keep on refusal')
  await assert.rejects(cleanupVerifiedInstallArtifacts(home,'../escape'))
 }finally{await rm(home,{recursive:true,force:true})}
})
