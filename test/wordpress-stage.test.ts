import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, symlink, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scryptSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { loadSettings } from '../src/config.js'
import { WordPressStages } from '../src/wordpress-stage.js'
import { LocalStageProvider, safeStagePath, type StageProvider } from '../src/wordpress-stage-provider.js'
import { ChangeStore } from '../src/change-store.js'
import { HostingError } from '../src/hosting-error.js'
import { createHttpServer } from '../src/http.js'
const access={actor:'owner-test',canWrite:true}
const code=(c:string)=>(e:unknown)=>e instanceof HostingError&&e.code===c
const input={domain:'example.com',label:'stg',adminEmail:'owner@example.com'}
async function fixture(){
 const home=await realpath(await mkdtemp(join(tmpdir(),'stage-'))), settings=await loadSettings({},false)
 settings.changeStateFile=join(home,'changes.sqlite');settings.accounts.primary!.wordpressProvisioning={home,phpBinary:'/usr/bin/php',wpCli:'/usr/bin/wp'}
 settings.accounts.primary!.writeOperations=['create_subdomain','create_wordpress_stage'];settings.credentials.primary={username:'test',loginKey:'private-key'}
 settings.localOAuth={file:join(home,'oauth.sqlite'),username:'owner',passwordHash:'a'.repeat(32)+':'+scryptSync('owner-password','a'.repeat(32),64).toString('hex'),redirects:['https://client.example/callback']}
 const state={calls:[] as string[],unsafe:false,fail:false,root:join(home,'domains/example.com/public_html/stg')}
 const provider:StageProvider={
  async preflight(){state.calls.push('preflight');if(state.unsafe)throw new HostingError('UNSAFE_STAGE_TARGET','Not empty');return{root:state.root,version:'6.9.1'}},
  async createSubdomain(){state.calls.push('subdomain')},async verifyRoot(){state.calls.push('root');if(state.fail)throw new HostingError('UNSAFE_STAGE_TARGET','Provider root not empty')},
  async createDatabase(){state.calls.push('database')},async install(_id,_target,_secret,checkpoint){state.calls.push('install');checkpoint('verifying_wordpress')},
 }
 const workflow=new WordPressStages(settings,fetch,provider)
 const approve=(id:string,hash:string)=>{const s=new ChangeStore(settings.changeStateFile!);try{s.approveOwner(s.get(id,access.actor,'primary'),hash)}finally{s.close()}}
 return{home,settings,state,provider,workflow,approve,close:()=>rm(home,{recursive:true,force:true})}
}
async function finished(f:Awaited<ReturnType<typeof fixture>>,id:string){for(let i=0;i<100;i++){const v=f.workflow.get('primary',id,access);if(v.status!=='applying')return v;await new Promise(r=>setTimeout(r,5))}throw new Error('Worker did not finish')}

test('stage write gates and strict inputs reject before any provider calls; remote/local distinction enforced',async()=>{
 const f=await fixture();try{
 await assert.rejects(f.workflow.plan('primary',input,{...access,canWrite:false}),code('WRITE_SCOPE_REQUIRED'))
 f.settings.accounts.primary!.writeOperations=['create_subdomain'];await assert.rejects(f.workflow.plan('primary',input,access),code('WRITE_DISABLED'))
 f.settings.accounts.primary!.writeOperations.push('create_wordpress_stage')
 await assert.rejects(f.workflow.plan('primary',{...input,label:'../live'},access));await assert.rejects(f.workflow.plan('primary',{...input,path:'/live'},access))
 assert.equal(f.state.calls.length,0)
 await assert.rejects(new LocalStageProvider(f.settings).preflight('primary',{...input,adminName:'stageadmin',title:'Stage'},'test_db'),code('LOCAL_ACCOUNT_REQUIRED'))
 }finally{await f.close()}
})

test('separate owner approval, actor/hash/expiry and shared hosting reservation are enforced',async()=>{
 const f=await fixture();try{
 const p=await f.workflow.plan('primary',input,access)
 assert(!JSON.stringify(p).includes(f.home));assert(!JSON.stringify(p).includes('private-key'))
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,access),code('OWNER_CONFIRMATION_REQUIRED'))
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,{actor:'different',canWrite:true}),code('PLAN_NOT_FOUND'))
 f.approve(p.planId,p.previewHash)
 await assert.rejects(f.workflow.apply('primary',p.planId,'0'.repeat(64),access),code('PREVIEW_MISMATCH'))
 const s=new ChangeStore(f.settings.changeStateFile!);const other=s.create({actor:access.actor,serverId:'primary',lockKey:'primary',expires:Date.now()+60000,payload:{}});s.reserve(other.id,access.actor,'primary');s.close()
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,access),code('CHANGE_BUSY'))
 assert.deepEqual(f.state.calls,['preflight'])
 }finally{await f.close()}
})

test('approved fresh job checkpoints, stores credentials privately and replay does not duplicate writes',async()=>{
 const f=await fixture();try{
 const p=await f.workflow.plan('primary',input,access);f.approve(p.planId,p.previewHash)
 assert.equal((await f.workflow.apply('primary',p.planId,p.previewHash,access)).status,'applying')
 const done=await finished(f,p.planId);assert.equal(done.status,'applied');assert.equal(done.phase,'completed_locally')
 const secret=JSON.parse(await readFile(join(f.home,'.seohost-mcp-stage',p.planId+'.json'),'utf8'))
 assert(!JSON.stringify(done).includes(secret.adminPassword));assert(!JSON.stringify(done).includes(secret.databasePassword))
 assert.equal((await f.workflow.apply('primary',p.planId,p.previewHash,access)).status,'applied')
 assert.equal(f.state.calls.filter(c=>c==='subdomain').length,1)
 assert.equal((done.result as {publicDnsTlsHttp:string}).publicDnsTlsHttp,'not_verified')
 }finally{await f.close()}
})

test('stale target stops before write; partial provider failure preserves lock and never creates DB or retries',async()=>{
 const f=await fixture();try{
 const p=await f.workflow.plan('primary',input,access);f.approve(p.planId,p.previewHash);f.state.unsafe=true
 await f.workflow.apply('primary',p.planId,p.previewHash,access);assert.equal((await finished(f,p.planId)).status,'failed');assert(!f.state.calls.includes('subdomain'))
 f.state.unsafe=false;const next=await f.workflow.plan('primary',input,access);f.approve(next.planId,next.previewHash);f.state.fail=true
 await f.workflow.apply('primary',next.planId,next.previewHash,access);const done=await finished(f,next.planId)
 assert.equal(done.status,'unknown');assert.equal(done.phase,'verifying_empty_document_root');assert(!f.state.calls.includes('database'))
 await assert.rejects(f.workflow.apply('primary',next.planId,next.previewHash,access),code('PLAN_NOT_READY'))
 const s=new ChangeStore(f.settings.changeStateFile!);const other=s.create({actor:access.actor,serverId:'primary',lockKey:'primary',expires:Date.now()+60000,payload:{}})
 assert.throws(()=>s.reserve(other.id,access.actor,'primary'),code('CHANGE_BUSY'));s.close()
 }finally{await f.close()}
})

test('owner approval expires and requires the original actor and exact stored hash',async()=>{
 const f=await fixture();try{
 const p=await f.workflow.plan('primary',input,access);f.approve(p.planId,p.previewHash)
 const db=new DatabaseSync(f.settings.changeStateFile!);const row=db.prepare('SELECT value FROM changes WHERE id=?').get(p.planId) as {value:string};const c=JSON.parse(row.value);c.expires=0;db.prepare('UPDATE changes SET value=? WHERE id=?').run(JSON.stringify(c),p.planId);db.close()
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,access),code('PLAN_EXPIRED'));assert.equal(f.state.calls.length,1)
 }finally{await f.close()}
})

test('filesystem traversal and symlinks are refused before a target can be reused',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'stage-path-')))
 try{await mkdir(join(root,'domains'));await symlink(join(root,'domains'),join(root,'alias'));await assert.rejects(safeStagePath(root,join(root,'alias','new'),true),code('UNSAFE_STAGE_TARGET'));await assert.rejects(safeStagePath(root,root+'/../other',true),code('UNSAFE_STAGE_TARGET'));await safeStagePath(root,join(root,'domains','new'),true)}finally{await rm(root,{recursive:true,force:true})}
})

test('browser owner approval requires password, Origin and single-use cookie-bound review, with no target writes',async()=>{
 const f=await fixture();const app=createHttpServer(f.settings,async()=>{throw Error('No provider I/O')})
 app.listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r));const address=app.address() as {port:number};f.settings.publicUrl=new URL(`http://127.0.0.1:${address.port}/mcp`)
 const base=f.settings.publicUrl.origin;f.settings.allowedOrigins.add(base)
 try{
 const p=await f.workflow.plan('primary',input,access), url=base+'/wordpress-stage/'+p.planId
 const page=await fetch(url);assert.equal(page.headers.get('referrer-policy'),'strict-origin');const html=await page.text();assert(!html.includes('owner@example.com'));const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)![1]!
 const post=(values:Record<string,string>,token=csrf,origin=base)=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',Cookie:'stage_owner='+token},body:new URLSearchParams(values)})
 assert.equal((await post({csrf,phase:'login',username:'owner',password:'owner-password'},csrf,'https://evil.example')).status,403)
 assert.equal((await post({csrf,phase:'login',username:'owner',password:'owner-password'},csrf,'null')).status,403)
 const review=await post({csrf,phase:'login',username:'owner',password:'owner-password'}), body=await review.text();assert.equal(review.headers.get('referrer-policy'),'strict-origin');assert.equal(review.status,200);assert(body.includes('owner@example.com'));assert(body.includes('overwrite'))
 const token=body.match(/name="csrf" value="([a-f0-9]+)"/)![1]!
 assert.equal((await post({csrf,phase:'approve',decision:'approve',preview:p.previewHash})).status,400)
 assert.equal((await post({csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},token)).status,200)
 assert.equal((await post({csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},token)).status,400)
 const store=new ChangeStore(f.settings.changeStateFile!);assert(store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));store.close()
 assert.deepEqual(f.state.calls,['preflight'])
 }finally{await new Promise<void>(r=>app.close(()=>r()));await f.close()}
})

test('real child adapter uses fixed shell-free arguments, secret stdin and clean environment; blocks preexisting files',async()=>{
 const f=await fixture();try{
 const fake=join(f.home,'fake-cli.cjs');await writeFile(fake,`const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2),root=a.find(x=>x.startsWith('--path=')).slice(7);let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(path.join(__dirname,'trace.jsonl'),JSON.stringify({args:a,input,env:process.env})+'\\n');if(a.includes('download'))fs.mkdirSync(path.join(root,'wp-content'));if(a.includes('create'))fs.writeFileSync(path.join(root,'wp-config.php'),'<?php');if(a.includes('version'))console.log('6.9.1');if(a.includes('get'))console.log(a.includes('siteurl')?'https://stg.example.com':'0')});`)
 f.settings.accounts.primary!.wordpressProvisioning={home:f.home,phpBinary:process.execPath,wpCli:fake}
 await mkdir(f.state.root,{recursive:true})
 const request:typeof fetch=async()=>new Response(JSON.stringify({users:{test:{domains:{'example.com':{public_html:join(f.home,'domains/example.com/public_html'),subdomains:{stg:{public_html:f.state.root}}}}}}}))
 const provider=new LocalStageProvider(f.settings,request,{home:f.home,username:'test',hostname:new URL(f.settings.accounts.primary!.baseUrl).hostname})
 process.env.STAGE_TEST_FORBIDDEN='private-inherited-token'
 const target={...input,adminName:'stageadmin',title:'$(touch unsafe); quoted title',root:f.state.root,hostname:'stg.example.com',database:'test_fresh',version:'6.9.1'}
 await provider.install('primary',target,{databasePassword:'database-secret',adminPassword:'admin-secret'},()=>{})
 const trace=(await readFile(join(f.home,'trace.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s))
 assert(trace.some(v=>v.input==='database-secret\n'));assert(trace.some(v=>v.input==='admin-secret\n'))
 for(const line of trace){assert(!JSON.stringify(line.args).includes('-secret'));assert(!JSON.stringify(line.env).includes('private-inherited-token'));assert(!line.args.some((a:string)=>a.startsWith('--force')||a==='--insecure'));assert(line.args.includes('--skip-packages'))}
 assert(trace.some(v=>v.args.includes('--title=$(touch unsafe); quoted title')))
 assert.equal(await readFile(join(f.state.root,'.htaccess'),'utf8'),'Options -Indexes\n')
 await assert.rejects(provider.verifyRoot('primary',target),code('UNSAFE_STAGE_TARGET'))
 }finally{delete process.env.STAGE_TEST_FORBIDDEN;await f.close()}
})

test('fixed database create refuses redirected, mismatched or remotely accessible results without retry or secret disclosure',async()=>{
 const f=await fixture();try{
 const {DirectAdminTransport}=await import('../src/directadmin-http.js');let calls=0
 const transport=new DirectAdminTransport(f.settings,async(url,init)=>{calls++;assert.equal(new URL(String(url)).pathname,'/api/db-manage/create-db-with-user');assert.equal(init?.redirect,'manual');assert.equal(JSON.parse(String(init?.body)).hostPatterns[0],'localhost');return new Response(JSON.stringify({database:'test_fresh',dbuser:'test_fresh',password:'db-secret',address:'evil.example',unixSocket:false,hostPatterns:['%']}))})
 await assert.rejects(transport.createStageDatabase('primary','test_fresh','db-secret'),code('WRITE_OUTCOME_UNKNOWN'));assert.equal(calls,1)
 }finally{await f.close()}
})

test('a local username on another provider host is not sufficient; disabled provisioning still allows receipt inspection',async()=>{
 const f=await fixture();try{
 const identity={home:f.home,username:'test',hostname:'another.example'}
 await assert.rejects(new LocalStageProvider(f.settings,async()=>{throw Error('No I/O')},identity).preflight('primary',{...input,adminName:'stageadmin',title:'Stage'},'test_db'),code('LOCAL_ACCOUNT_REQUIRED'))
 const p=await f.workflow.plan('primary',input,access);f.settings.accounts.primary!.writeOperations=[];delete f.settings.accounts.primary!.wordpressProvisioning
 assert.equal(f.workflow.get('primary',p.planId,access).status,'ready')
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,access),code('WRITE_DISABLED'))
 }finally{await f.close()}
})

test('owner deny revokes an earlier ready approval and throttling persists across store instances',async()=>{
 const f=await fixture();try{
 const p=await f.workflow.plan('primary',input,access);f.approve(p.planId,p.previewHash)
 let store=new ChangeStore(f.settings.changeStateFile!);store.denyOwner(p.planId);assert(!store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));for(let i=0;i<5;i++)store.ownerLoginAttempt();store.close()
 store=new ChangeStore(f.settings.changeStateFile!);assert.throws(()=>store.ownerLoginAttempt(),code('OWNER_LOGIN_LIMIT'));store.close()
 await assert.rejects(f.workflow.apply('primary',p.planId,p.previewHash,access),code('OWNER_CONFIRMATION_REQUIRED'))
 }finally{await f.close()}
})
