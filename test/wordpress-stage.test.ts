import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, symlink, realpath, writeFile, chmod } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scryptSync, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { loadSettings } from '../src/config.js'
import { WordPressStages, stageDatabaseName, stageAdminPassword } from '../src/wordpress-stage.js'
import { LocalStageProvider, safeStagePath, type StageProvider } from '../src/wordpress-stage-provider.js'
import { ChangeStore } from '../src/change-store.js'
import { HostingError } from '../src/hosting-error.js'
import { getServerCapabilities } from '../src/capabilities.js'
import { createHttpServer } from '../src/http.js'
const access={actor:'owner-test',canWrite:true}
const code=(c:string)=>(e:unknown)=>e instanceof HostingError&&e.code===c
const input={domain:'example.com',label:'stg',adminEmail:'owner@example.com'}
async function fixture(){
 const home=await realpath(await mkdtemp(join(tmpdir(),'stage-'))), settings=await loadSettings({},false)
 settings.changeStateFile=join(home,'changes.sqlite');settings.accounts.primary!.wordpressProvisioning={home,phpBinary:'/usr/bin/php',wpCli:'/usr/bin/wp'}
 settings.accounts.primary!.writeOperations=['create_domain','create_subdomain','create_wordpress_stage'];settings.credentials.primary={username:'test',loginKey:'private-key'}
 settings.localOAuth={file:join(home,'oauth.sqlite'),username:'owner',passwordHash:'a'.repeat(32)+':'+scryptSync('owner-password','a'.repeat(32),64).toString('hex'),redirects:['https://client.example/callback']}
 const state={calls:[] as string[],unsafe:false,fail:false,root:join(home,'domains/example.com/public_html/stg')}
 const provider:StageProvider={
  async prepareFreshRoot(){state.calls.push('templates');return null},
  async preflight(){state.calls.push('preflight');if(state.unsafe)throw new HostingError('UNSAFE_STAGE_TARGET','Not empty');return{root:state.root,version:'6.9.1'}},
  async createHosting(){state.calls.push('subdomain')},async verifyRoot(){state.calls.push('root');if(state.fail)throw new HostingError('UNSAFE_STAGE_TARGET','Provider root not empty')},
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
 const p=await f.workflow.plan('primary',input,access), url=base+'/wordpress-stage/'+p.planId+'?lang=en'
 const page=await fetch(url);assert.equal(page.headers.get('referrer-policy'),'strict-origin');const html=await page.text();assert(!html.includes('owner@example.com'));const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)![1]!
 let ownerCookie=''
 const post=(values:Record<string,string>,token=csrf,origin=base)=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',Cookie:'stage_owner='+token+(ownerCookie?'; '+ownerCookie:'')},body:new URLSearchParams(values)})
 assert.equal((await post({csrf,phase:'login',username:'owner',password:'owner-password'},csrf,'https://evil.example')).status,403)
 assert.equal((await post({csrf,phase:'login',username:'owner',password:'owner-password'},csrf,'null')).status,403)
 const review=await post({csrf,phase:'login',username:'owner',password:'owner-password'}), body=await review.text();assert.equal(review.headers.get('referrer-policy'),'strict-origin');assert.equal(review.status,200);assert(body.includes('owner@example.com'));assert(body.includes('No existing data overwritten or deleted.'))
 ownerCookie=review.headers.getSetCookie().find(c=>c.startsWith('stage_login='))!.split(';')[0]!
 const token=body.match(/name="csrf" value="([a-f0-9]+)"/)![1]!
 assert.equal((await post({csrf,phase:'approve',decision:'approve',preview:p.previewHash})).status,400)
 assert.equal((await post({csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},token)).status,200)
 assert.equal((await post({csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},token)).status,400)
 const store=new ChangeStore(f.settings.changeStateFile!);assert(store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));store.close()
 assert.deepEqual(f.state.calls,['preflight'])
 }finally{await new Promise<void>(r=>app.close(()=>r()));await f.close()}
})

for(const production of [false,true])test(production?'production installation uses normal mail/cron/indexing without staging MU policy':'real child adapter uses fixed shell-free arguments, secret stdin and clean environment; blocks preexisting files',async()=>{
 const f=await fixture();try{
 if(production)f.state.root=join(f.home,'domains/example.com/public_html')
 const fake=join(f.home,'fake-cli.cjs');await writeFile(fake,`const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2),root=a.find(x=>x.startsWith('--path=')).slice(7);let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{fs.appendFileSync(path.join(__dirname,'trace.jsonl'),JSON.stringify({args:a,input,env:process.env})+'\\n');if(a.includes('download'))fs.mkdirSync(path.join(root,'wp-content'));if(a.includes('create'))fs.writeFileSync(path.join(root,'wp-config.php'),'<?php');if(a.includes('version'))console.log('6.9.1');if(a.includes('get'))console.log(a.includes('siteurl')?'${production?'https://example.com':'https://stg.example.com'}':'${production?'1':'0'}')});`)
 f.settings.accounts.primary!.wordpressProvisioning={home:f.home,phpBinary:process.execPath,wpCli:fake}
 await mkdir(f.state.root,{recursive:true})
 const source=join(f.home,'source/wordpress');await mkdir(join(source,'wp-content'),{recursive:true})
 const long='wp-includes/'+ 'x'.repeat(110)+'.php';await mkdir(join(source,'wp-includes'));await writeFile(join(source,long),'verified fixture')
 const archive=join(f.home,'fixture.tar.gz');await promisify(execFile)(process.platform==='darwin'?'/usr/bin/tar':'/bin/tar',['-czf',archive,'-C',join(f.home,'source'),'wordpress'])
 const bytes=await readFile(archive),md5=createHash('md5').update(bytes).digest('hex')
 await mkdir(join(f.home,'.seohost-mcp-stage'),{mode:0o700,recursive:true})
 const request:typeof fetch=async(url)=>{
  if(String(url)==='https://wordpress.org/wordpress-6.9.1.tar.gz.md5')return new Response(md5)
  if(String(url)==='https://wordpress.org/wordpress-6.9.1.tar.gz')return new Response(bytes)
  return new Response(JSON.stringify({users:{test:{domains:{'example.com':{public_html:join(f.home,'domains/example.com/public_html'),subdomains:{stg:{public_html:f.state.root}}}}}}}))
 }
 const provider=new LocalStageProvider(f.settings,request,{home:f.home,username:'test',hostname:new URL(f.settings.accounts.primary!.baseUrl).hostname})
 process.env.STAGE_TEST_FORBIDDEN='private-inherited-token'
 const target={...input,...(production?{label:'',placement:'existing_domain' as const,environment:'production' as const}:{}),adminName:'stageadmin',title:'$(touch unsafe); quoted title',root:f.state.root,hostname:production?'example.com':'stg.example.com',database:'test_fresh',version:'6.9.1'}
 await provider.install('primary',target,{databasePassword:'database-secret',adminPassword:'admin-secret'},()=>{},false,'b'.repeat(48))
 const trace=(await readFile(join(f.home,'trace.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s))
 assert(trace.some(v=>v.input==='database-secret\n'));assert(trace.some(v=>v.input==='admin-secret\n'))
 for(const line of trace){assert(!JSON.stringify(line.args).includes('-secret'));assert(!JSON.stringify(line.env).includes('private-inherited-token'));assert(!line.args.some((a:string)=>a.startsWith('--force')||a==='--insecure'));assert(line.args.includes('--skip-packages'))}
 assert(trace.some(v=>v.args.includes('--title=$(touch unsafe); quoted title')))
 assert(!trace.some(v=>v.args.includes('download')))
 assert.equal(trace.filter(v=>v.args.includes('verify-checksums')).length,2)
 assert.equal(trace.some(v=>v.args.includes('DISABLE_WP_CRON')),!production)
 assert(trace.some(v=>v.args.includes('WP_ENVIRONMENT_TYPE')&&v.args.includes(production?'production':'staging')))
 if(production)await assert.rejects(readFile(join(f.state.root,'wp-content/mu-plugins/seohost-stage.php')),{code:'ENOENT'})
 assert.equal(await readFile(join(f.state.root,long),'utf8'),'verified fixture')
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

async function browserFixture(){
 const f=await fixture(), app=createHttpServer(f.settings,async()=>{throw Error('No provider I/O')})
 app.listen(0,'127.0.0.1');await new Promise<void>(r=>app.once('listening',r))
 const address=app.address() as {port:number};f.settings.publicUrl=new URL(`http://127.0.0.1:${address.port}/mcp`)
 const base=f.settings.publicUrl.origin;f.settings.allowedOrigins.add(base)
 const url=(id:string)=>base+'/wordpress-stage/'+id+'?lang=en'
 const csrf=(body:string)=>body.match(/name="csrf" value="([a-f0-9]+)"/)![1]!
 const post=(path:string,values:Record<string,string>,cookies:string,origin=base)=>fetch(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',Cookie:cookies},body:new URLSearchParams(values)})
 const login=async(id:string)=>{
  const page=await fetch(url(id)), token=csrf(await page.text())
  const response=await post(url(id),{csrf:token,phase:'login',username:'owner',password:'owner-password'},'stage_owner='+token)
  assert.equal(response.status,200)
  const remembered=response.headers.getSetCookie().find(c=>c.startsWith('stage_login='))!
  assert(remembered.includes('HttpOnly'));assert(remembered.includes('SameSite=Strict'));assert(remembered.includes('Path=/wordpress-stage;'));assert(remembered.includes('Max-Age=28800'))
  return {cookie:remembered.split(';')[0]!,token:remembered.split(';')[0]!.slice('stage_login='.length),body:await response.text()}
 }
 return {...f,app,base,url,csrf,post,login,shutdown:async()=>{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await f.close()}}
}

test('remembered browser session skips login on a new plan, but cannot approve it implicitly or reuse another plan nonce',async()=>{
 const f=await browserFixture();try{
 const a=await f.workflow.plan('primary',input,access), b=await f.workflow.plan('primary',{...input,label:'other'},access)
 const signed=await f.login(a.planId)
 assert(signed.body.includes('New WordPress administrator'));assert(signed.body.includes('Approve this installation'))
 const response=await fetch(f.url(b.planId),{headers:{Cookie:signed.cookie}}), body=await response.text()
 assert.equal(response.status,200);assert(body.includes('other.example.com'));assert(!body.includes('autocomplete="current-password"'))
 const nextToken=f.csrf(body), oldToken=f.csrf(signed.body)
 assert.notEqual(oldToken,nextToken)
 let store=new ChangeStore(f.settings.changeStateFile!);assert(!store.isOwnerApproved(store.get(b.planId,access.actor,'primary'),b.previewHash));store.close()
 assert.equal((await f.post(f.url(b.planId),{csrf:oldToken,phase:'approve',decision:'approve',preview:b.previewHash},signed.cookie+'; stage_owner='+oldToken)).status,400)
 assert.equal((await f.post(f.url(b.planId),{csrf:nextToken,phase:'approve',decision:'approve',preview:b.previewHash},signed.cookie+'; stage_owner='+nextToken)).status,200)
 store=new ChangeStore(f.settings.changeStateFile!);assert(store.isOwnerApproved(store.get(b.planId,access.actor,'primary'),b.previewHash));assert(!store.isOwnerApproved(store.get(a.planId,access.actor,'primary'),a.previewHash));store.close()
 const c=await f.workflow.plan('primary',{...input,label:'third'},access)
 assert(!(await (await fetch(f.url(c.planId),{headers:{Cookie:signed.cookie}})).text()).includes('autocomplete="current-password"'))
 assert(!f.state.calls.includes('subdomain'))
 }finally{await f.shutdown()}
})

test('remembered session logout requires Origin and CSRF, and revokes existing review forms without deleting plan approvals',async()=>{
 const f=await browserFixture();try{
 const p=await f.workflow.plan('primary',input,access), signed=await f.login(p.planId)
 const logoutToken=signed.body.match(/action="\/wordpress-stage\/logout\?lang=en"><input type="hidden" name="csrf" value="([a-f0-9]+)"/)![1]!
 assert.equal((await f.post(f.base+'/wordpress-stage/logout?lang=en',{csrf:logoutToken},signed.cookie,'https://evil.example')).status,403)
 assert.equal((await f.post(f.base+'/wordpress-stage/logout?lang=en',{csrf:'0'.repeat(64)},signed.cookie)).status,400)
 const out=await f.post(f.base+'/wordpress-stage/logout?lang=en',{csrf:logoutToken},signed.cookie);assert.equal(out.status,200);assert(out.headers.getSetCookie().some(c=>c.startsWith('stage_login=;')&&c.includes('Max-Age=0')))
 assert((await (await fetch(f.url(p.planId),{headers:{Cookie:signed.cookie}})).text()).includes('autocomplete="current-password"'))
 const token=f.csrf(signed.body)
 assert.equal((await f.post(f.url(p.planId),{csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},signed.cookie+'; stage_owner='+token)).status,400)
 const store=new ChangeStore(f.settings.changeStateFile!);assert(!store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));store.close()
 assert(!f.state.calls.includes('subdomain'))
 }finally{await f.shutdown()}
})

test('owner sessions survive store instances as hashes, expire absolutely and bind owner credentials plus origin',async()=>{
 const f=await fixture();try{
 let store=new ChangeStore(f.settings.changeStateFile!), session=store.createOwnerSession('binding-a')
 const expires=session.expires;assert(expires>Date.now()+7*3600000);assert(expires<=Date.now()+8*3600000)
 store.close();store=new ChangeStore(f.settings.changeStateFile!)
 assert.equal(store.ownerSession(session.token,'binding-a')?.expires,expires)
 assert.equal(store.ownerSession(session.token,'binding-b'),undefined)
 assert.equal(store.ownerSession('invalid','binding-a'),undefined)
 const db=new DatabaseSync(f.settings.changeStateFile!);const row=db.prepare('SELECT token,expires FROM stage_owner_sessions').get() as {token:string;expires:number}
 assert.notEqual(row.token,session.token);assert.equal(row.token.length,64)
 db.prepare('UPDATE stage_owner_sessions SET expires=0').run();assert.equal(store.ownerSession(session.token,'binding-a'),undefined)
 session=store.createOwnerSession('binding-a');const rotated=store.createOwnerSession('binding-a',session.token)
 assert.equal(store.ownerSession(session.token,'binding-a'),undefined);assert(store.ownerSession(rotated.token,'binding-a'))
 db.close();store.close()
 }finally{await f.close()}
})

test('changed owner credentials or expired remembered session cannot approve an already rendered form',async()=>{
 const f=await browserFixture();try{
 const p=await f.workflow.plan('primary',input,access), signed=await f.login(p.planId), token=f.csrf(signed.body)
 const before=f.settings.localOAuth!.passwordHash;f.settings.localOAuth!.passwordHash='b'.repeat(32)+':'+scryptSync('new-password','b'.repeat(32),64).toString('hex')
 assert((await (await fetch(f.url(p.planId),{headers:{Cookie:signed.cookie}})).text()).includes('autocomplete="current-password"'))
 assert.equal((await f.post(f.url(p.planId),{csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},signed.cookie+'; stage_owner='+token)).status,400)
 f.settings.localOAuth!.passwordHash=before
 const db=new DatabaseSync(f.settings.changeStateFile!);db.prepare('UPDATE stage_owner_sessions SET expires=0').run();db.close()
 assert.equal((await f.post(f.url(p.planId),{csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},signed.cookie+'; stage_owner='+token)).status,400)
 const store=new ChangeStore(f.settings.changeStateFile!);assert(!store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));store.close()
 }finally{await f.shutdown()}
})

test('production-origin login emits Secure host-only scoped cookies and caps retained browser sessions',async()=>{
 const f=await browserFixture();try{
 f.settings.publicUrl.protocol='https:';f.settings.allowedOrigins.add(f.settings.publicUrl.origin)
 const p=await f.workflow.plan('primary',input,access), page=await fetch(f.url(p.planId)), token=f.csrf(await page.text())
 const response=await f.post(f.url(p.planId),{csrf:token,phase:'login',username:'owner',password:'owner-password'},'stage_owner='+token,f.settings.publicUrl.origin)
 assert.equal(response.status,200)
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2)
 for(const c of cookies){assert(c.includes('; Secure'));assert(c.includes('; HttpOnly'));assert(c.includes('; SameSite=Strict'));assert(!c.includes('Domain='))}
 const store=new ChangeStore(f.settings.changeStateFile!)
 for(let i=1;i<100;i++)store.createOwnerSession('test-binding')
 assert.throws(()=>store.createOwnerSession('test-binding'),code('OWNER_LOGIN_LIMIT'));store.close()
 }finally{await f.shutdown()}
})


test('database names identify the requested hostname with a bounded safe account prefix and collision suffix',()=>{
 const sub=stageDatabaseName('account','stg.example.com'), root=stageDatabaseName('account','example.com')
 assert.match(sub,/^account_stg_example_com_[a-f0-9]{8}$/)
 assert.match(root,/^account_example_com_[a-f0-9]{8}$/)
 assert.notEqual(sub,stageDatabaseName('account','stg.example.com'))
 const long=stageDatabaseName('account','very-long-subdomain-name.example.com');assert(long.length<=32);assert.match(long,/^account_very_long_[a-z0-9_]+_[a-f0-9]{8}$/)
 assert.throws(()=>stageDatabaseName('a'.repeat(24),'example.com'),code('DATABASE_NAME_LIMIT'))
 assert.throws(()=>stageDatabaseName('bad/name','example.com'),code('CREDENTIALS_MISSING'))
})

test('completed installation password is browser-owner only, remains accessible after plan expiry and never enters MCP receipts',async()=>{
 const f=await browserFixture();try{
 const p=await f.workflow.plan('primary',input,access), signed=await f.login(p.planId)
 f.approve(p.planId,p.previewHash);await f.workflow.apply('primary',p.planId,p.previewHash,access);const done=await finished(f,p.planId)
 const secret=JSON.parse(await readFile(join(f.home,'.seohost-mcp-stage',p.planId+'.json'),'utf8'))
 const db=new DatabaseSync(f.settings.changeStateFile!);const store=new ChangeStore(f.settings.changeStateFile!)
 const c=store.get(p.planId,access.actor,'primary');c.expires=0;store.checkpoint(c);store.close()
 const anonymous=await (await fetch(f.url(p.planId))).text();assert(anonymous.includes('MCP owner username'));assert(!anonymous.includes(secret.adminPassword));assert(!anonymous.includes('owner@example.com'))
 const result=await fetch(f.url(p.planId),{headers:{Cookie:signed.cookie}}), body=await result.text()
 assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
 const css=body.match(/<style>([\s\S]*?)<\/style>/)![1]!, policy=result.headers.get('content-security-policy')!
 assert(policy.includes("style-src 'sha256-"+createHash('sha256').update(css).digest('base64')+"'"));assert(policy.includes("default-src 'none'"));assert(!policy.includes('unsafe-inline'));assert(body.includes('name="viewport"'));
 assert(body.includes('Show WordPress administrator password'));assert(body.includes(secret.adminPassword));assert(!body.includes(secret.databasePassword));assert(body.includes(p.target.database))
 assert(!JSON.stringify(done).includes(secret.adminPassword));assert(!JSON.stringify(done).includes(secret.databasePassword))
 assert((done.result as {ownerResultUrl:string}).ownerResultUrl.endsWith('/wordpress-stage/'+p.planId))
 // Re-authentication works for a completed receipt even after the old apply deadline.
 const again=await f.login(p.planId);assert(again.body.includes(secret.adminPassword))
 const token=f.csrf(signed.body)
 assert.equal((await f.post(f.url(p.planId),{csrf:token,phase:'approve',decision:'approve',preview:p.previewHash},signed.cookie+'; stage_owner='+token)).status,400)
 db.prepare('UPDATE stage_owner_sessions SET expires=0').run();db.close()
 assert(!(await (await fetch(f.url(p.planId),{headers:{Cookie:again.cookie}})).text()).includes(secret.adminPassword))
 assert.equal(f.state.calls.filter(c=>c==='subdomain').length,1)
 }finally{await f.shutdown()}
})

test('credential display refuses insecure, replaced or mismatched retained files without exposing either secret',async()=>{
 const f=await browserFixture();try{
 const p=await f.workflow.plan('primary',input,access), signed=await f.login(p.planId)
 f.approve(p.planId,p.previewHash);await f.workflow.apply('primary',p.planId,p.previewHash,access);await finished(f,p.planId)
 const path=join(f.home,'.seohost-mcp-stage',p.planId+'.json'), original=await readFile(path,'utf8'), secret=JSON.parse(original)
 const check=async()=>{const response=await fetch(f.url(p.planId),{headers:{Cookie:signed.cookie}});const body=await response.text();assert.equal(response.status,400);assert(!body.includes(secret.adminPassword));assert(!body.includes(secret.databasePassword))}
 await chmod(path,0o644);await check();await chmod(path,0o600)
 await writeFile(path,JSON.stringify({...secret,hostname:'different.example.com'}));await check()
 await writeFile(path,'x'.repeat(4097));await check()
 await rm(path);const other=join(f.home,'other-secret.json');await writeFile(other,original,{mode:0o600});await symlink(other,path);await check()
 const store=new ChangeStore(f.settings.changeStateFile!);const change=store.get(p.planId,access.actor,'primary');change.status='unknown'
 await assert.rejects(stageAdminPassword(f.settings,change),code('CREDENTIALS_UNAVAILABLE'));store.close()
 }finally{await f.shutdown()}
})

test('independent hosting is the new default and requires create_domain; legacy plans retain their subdomain policy',async()=>{
 const f=await fixture();try{
 f.settings.accounts.primary!.writeOperations=['create_subdomain','create_wordpress_stage']
 assert.deepEqual(getServerCapabilities(f.settings,'primary').stagePlacementsConfigured,['subdomain'])
 await assert.rejects(f.workflow.plan('primary',input,access),code('WRITE_DISABLED'))
 assert.equal(f.state.calls.length,0)
 const nested=await f.workflow.plan('primary',{...input,placement:'subdomain'},access)
 assert.equal(nested.target.placement,'subdomain')
 const store=new ChangeStore(f.settings.changeStateFile!), old=store.get(nested.planId,access.actor,'primary')
 delete (old.payload as {target:{placement?:string}}).target.placement;store.checkpoint(old);store.close()
 f.approve(nested.planId,nested.previewHash);await f.workflow.apply('primary',nested.planId,nested.previewHash,access);assert.equal((await finished(f,nested.planId)).status,'applied')
 f.settings.accounts.primary!.writeOperations=['create_domain','create_wordpress_stage']
 const capabilities=getServerCapabilities(f.settings,'primary');assert.deepEqual(capabilities.stagePlacementsConfigured,['independent_domain']);assert.equal(capabilities.tools.find(t=>t.name==='plan_wordpress_stage')?.configurationReady,true);assert.equal(capabilities.tools.find(t=>t.name==='apply_wordpress_stage')?.readOnly,false)
 const separate=await f.workflow.plan('primary',{...input,label:'another'},access)
 assert.equal(separate.target.placement,'independent_domain');f.approve(separate.planId,separate.previewHash)
 f.settings.accounts.primary!.writeOperations=['create_subdomain','create_wordpress_stage']
 assert.deepEqual(getServerCapabilities(f.settings,'primary').stagePlacementsConfigured,['subdomain'])
 await assert.rejects(f.workflow.apply('primary',separate.planId,separate.previewHash,access),code('WRITE_DISABLED'))
 assert.equal(f.state.calls.filter(c=>c==='subdomain').length,1)
 }finally{await f.close()}
})

test('independent adapter creates a separate DA domain and verifies its exact fresh public_html without parent writes',async()=>{
 const f=await fixture();try{
 const parent=join(f.home,'domains/example.com/public_html'), container=join(f.home,'domains/stg.example.com'), root=join(container,'public_html')
 await mkdir(parent,{recursive:true});await writeFile(join(parent,'keep.php'),'parent sentinel')
 const cli=join(f.home,'version.cjs');await writeFile(cli,"console.log('WP-CLI 2.12.0')")
 f.settings.accounts.primary!.wordpressProvisioning={home:f.home,phpBinary:process.execPath,wpCli:cli}
 let created=false, wrongRoot=false;const posts:Array<{path:string;values:Record<string,string>}>=[]
 const request:typeof fetch=async(url,init)=>{
  const u=new URL(String(url))
  if(init?.method==='POST'){
   posts.push({path:u.pathname,values:Object.fromEntries(new URLSearchParams(String(init.body)))})
   assert.equal(u.pathname,'/CMD_API_DOMAIN');created=true;await mkdir(root,{recursive:true});return new Response('error=0')
  }
  if(u.pathname==='/CMD_API_SHOW_DOMAINS')return new Response(created?'list[]=example.com&list[]=stg.example.com':'list[]=example.com')
  if(u.pathname==='/CMD_API_SUBDOMAINS')return new Response('')
  if(u.pathname==='/CMD_API_DOMAIN')return new Response(JSON.stringify({users:{test:{domains:{'example.com':{public_html:parent,subdomains:{}},...(created?{'stg.example.com':{public_html:wrongRoot?parent:root,subdomains:{}}}:{})}}}}))
  if(u.pathname==='/api/db-show/databases')return new Response('[]')
  if(u.hostname==='api.wordpress.org')return new Response(JSON.stringify({offers:[{response:'upgrade',version:'6.9.1'}]}))
  throw Error('Unexpected fixture request '+u.pathname)
 }
 const provider=new LocalStageProvider(f.settings,request,{home:f.home,username:'test',hostname:new URL(f.settings.accounts.primary!.baseUrl).hostname})
 const value={...input,placement:'independent_domain' as const,adminName:'stageadmin',title:'Stage'}
 // A pre-existing container, even empty, is never taken over.
 await mkdir(container);await assert.rejects(provider.preflight('primary',value,'test_fresh'),code('UNSAFE_STAGE_TARGET'));await rm(container,{recursive:true})
 const checked=await provider.preflight('primary',value,'test_fresh');assert.equal(checked.root,root);assert.equal(posts.length,0)
 const target={...value,...checked,hostname:'stg.example.com',database:'test_fresh'}
 await provider.createHosting('primary',target);assert.deepEqual(posts,[{path:'/CMD_API_DOMAIN',values:{action:'create',domain:'stg.example.com',uquota:'unlimited',ubandwidth:'unlimited',ssl:'ON',php:'ON',cgi:'OFF'}}])
 await provider.verifyRoot('primary',target)
 wrongRoot=true;await assert.rejects(provider.verifyRoot('primary',target),code('UNSAFE_STAGE_TARGET'));wrongRoot=false
 await writeFile(join(root,'index.html'),'provider placeholder');await assert.rejects(provider.verifyRoot('primary',target),code('UNSAFE_STAGE_TARGET'))
 await mkdir(join(f.home,'.seohost-mcp-stage'),{mode:0o700,recursive:true})
 await writeFile(join(root,'foreign.php'),'must retain')
 await assert.rejects(provider.prepareFreshRoot('primary',target,'c'.repeat(48),()=>{}),code('RECOVERY_TARGET_CHANGED'))
 assert.equal(await readFile(join(root,'index.html'),'utf8'),'provider placeholder')
 await rm(join(root,'foreign.php'))
 assert.equal(await provider.prepareFreshRoot('primary',target,'c'.repeat(48),()=>{}),'c'.repeat(48))
 await provider.verifyRoot('primary',target)
 assert.equal(await readFile(join(f.home,'.seohost-mcp-stage/recovery','c'.repeat(48),'originals/index.html'),'utf8'),'provider placeholder')
 assert.equal(await readFile(join(f.home,'.seohost-mcp-stage/recovery','c'.repeat(48),'verified-copy/index.html'),'utf8'),'provider placeholder')
 assert.equal(await readFile(join(parent,'keep.php'),'utf8'),'parent sentinel');assert.equal(posts.length,1)
 }finally{await f.close()}
})

test('owner pages default to Polish; switching to English preserves authentication without approving the plan',async()=>{
 const f=await browserFixture();try{
 const p=await f.workflow.plan('primary',input,access), pl=f.url(p.planId).replace('?lang=en','')
 const page=await fetch(pl), first=await page.text();assert.equal(page.headers.get('content-language'),'pl');assert(first.includes('<html lang="pl">'));assert(first.includes('Login właściciela MCP'));assert(first.includes('>English</a>'))
 const csrf=f.csrf(first), signed=await f.post(pl,{csrf,phase:'login',username:'owner',password:'owner-password'},'stage_owner='+csrf)
 const cookie=signed.headers.getSetCookie().find(c=>c.startsWith('stage_login='))!.split(';')[0]!, polish=await signed.text()
 assert(polish.includes('Zatwierdź tę instalację'));assert(polish.includes('Osobna domena w DirectAdmin'));assert(polish.includes('Katalog strony'))
 const english=await fetch(f.url(p.planId),{headers:{Cookie:cookie}}), body=await english.text()
 assert.equal(english.headers.get('content-language'),'en');assert(body.includes('Approve this installation'));assert(body.includes('Independent DirectAdmin domain'));assert(!body.includes('autocomplete="current-password"'))
 const store=new ChangeStore(f.settings.changeStateFile!);assert(!store.isOwnerApproved(store.get(p.planId,access.actor,'primary'),p.previewHash));store.close()
 const error=await f.post(pl,{csrf:'0'.repeat(64),phase:'approve'},cookie)
 assert((await error.text()).includes('Formularz lub sesja'));assert(!f.state.calls.includes('subdomain'))
 }finally{await f.shutdown()}
})

async function unknownCreation(f:Awaited<ReturnType<typeof fixture>>){
 f.provider.createHosting=async()=>{f.state.calls.push('create-unknown');throw new HostingError('WRITE_OUTCOME_UNKNOWN','No confirmed response')}
 const p=await f.workflow.plan('primary',input,access);f.approve(p.planId,p.previewHash)
 await f.workflow.apply('primary',p.planId,p.previewHash,access);assert.equal((await finished(f,p.planId)).status,'unknown')
 const snapshot={entries:[],bytes:0}
 f.provider.inspectRecovery=async()=>snapshot
 f.provider.preserveTemplates=async(_id,_target,id,_snapshot,checkpoint)=>{f.state.calls.push('backup');checkpoint('preserving_provider_templates');return id}
 return p
}

test('recovery requires original owner-approved unknown create-domain checkpoint and fresh separate approval',async()=>{
 const f=await fixture();try{
 const ready=await f.workflow.plan('primary',input,access)
 await assert.rejects(f.workflow.planRecovery('primary',ready.planId,access),code('RECOVERY_UNAVAILABLE'))
 const original=await unknownCreation(f)
 await assert.rejects(f.workflow.planRecovery('primary',original.planId,{...access,canWrite:false}),code('WRITE_SCOPE_REQUIRED'))
 await assert.rejects(f.workflow.planRecovery('primary',original.planId,{...access,actor:'other'}),code('PLAN_NOT_FOUND'))
 const recovery=await f.workflow.planRecovery('primary',original.planId,access)
 assert(recovery.recovery);assert.notEqual(recovery.previewHash,original.previewHash)
 await assert.rejects(f.workflow.apply('primary',recovery.planId,recovery.previewHash,access),code('OWNER_CONFIRMATION_REQUIRED'))
 const store=new ChangeStore(f.settings.changeStateFile!);assert.equal(store.get(original.planId,access.actor,'primary').status,'unknown');store.close()
 assert(!f.state.calls.includes('backup'));assert(!f.state.calls.includes('database'))
 }finally{await f.close()}
})

test('approved recovery transfers reservation once, retains credentials privately and skips domain creation',async()=>{
 const f=await fixture();try{
 const original=await unknownCreation(f), recovery=await f.workflow.planRecovery('primary',original.planId,access)
 const competing=await f.workflow.planRecovery('primary',original.planId,access)
 f.approve(recovery.planId,recovery.previewHash);f.approve(competing.planId,competing.previewHash)
 await f.workflow.apply('primary',recovery.planId,recovery.previewHash,access);const done=await finished(f,recovery.planId)
 assert.equal(done.status,'applied');assert.equal(f.state.calls.filter(c=>c==='create-unknown').length,1);assert.equal(f.state.calls.filter(c=>c==='database').length,1);assert.equal(f.state.calls.filter(c=>c==='backup').length,1)
 const store=new ChangeStore(f.settings.changeStateFile!);const old=store.get(original.planId,access.actor,'primary');assert.equal(old.code,'RECOVERY_SUPERSEDED');assert.equal(old.result?.reconciledByRecoveryPlan,recovery.planId);store.close()
 await assert.rejects(f.workflow.apply('primary',competing.planId,competing.previewHash,access),code('RECOVERY_UNAVAILABLE'))
 assert.equal((await f.workflow.apply('primary',recovery.planId,recovery.previewHash,access)).status,'applied')
 const secret=JSON.parse(await readFile(join(f.home,'.seohost-mcp-stage',recovery.planId+'.json'),'utf8'))
 assert(!JSON.stringify(done).includes(secret.adminPassword));assert(!JSON.stringify(recovery).includes(secret.databasePassword))
 assert.equal(done.result?.providerTemplateBackupReference,recovery.planId)
 }finally{await f.close()}
})

test('changed recovery snapshot keeps unknown account lock without DB writes or second generation takeover',async()=>{
 const f=await fixture();try{
 const original=await unknownCreation(f), recovery=await f.workflow.planRecovery('primary',original.planId,access)
 f.approve(recovery.planId,recovery.previewHash)
 f.provider.inspectRecovery=async()=>({entries:[],bytes:1})
 await f.workflow.apply('primary',recovery.planId,recovery.previewHash,access);const done=await finished(f,recovery.planId)
 assert.equal(done.status,'unknown');assert.equal(done.code,'RECOVERY_TARGET_CHANGED');assert(!f.state.calls.includes('backup'));assert(!f.state.calls.includes('database'))
 await assert.rejects(f.workflow.planRecovery('primary',recovery.planId,access),code('RECOVERY_UNAVAILABLE'))
 const store=new ChangeStore(f.settings.changeStateFile!);const other=store.create({actor:access.actor,serverId:'primary',lockKey:'primary',expires:Date.now()+60000,payload:{}})
 assert.throws(()=>store.reserve(other.id,access.actor,'primary'),code('CHANGE_BUSY'));store.close()
 }finally{await f.close()}
})

test('provider templates get a verified private copy and originals before the root becomes empty',async()=>{
 const f=await fixture();try{
 const {snapshotTemplates,preserveTemplates,verifyPreservedTemplates}=await import('../src/wordpress-stage-recovery.js')
 const root=join(f.home,'templates');await mkdir(root);await mkdir(join(root,'cgi-bin'));await writeFile(join(root,'cgi-bin/.htaccess'),'fixture CGI guard');await writeFile(join(root,'index.html'),'fixture provider page')
 await mkdir(join(f.home,'.seohost-mcp-stage'),{mode:0o700,recursive:true})
 const snapshot=await snapshotTemplates(f.home,root), id='a'.repeat(48), phases:string[]=[]
 assert.equal(snapshot.entries.length,3)
 await preserveTemplates(f.home,root,id,snapshot,p=>phases.push(p))
 assert.deepEqual(await (await import('node:fs/promises')).readdir(root),[])
 const backup=join(f.home,'.seohost-mcp-stage/recovery',id)
 assert.equal(await readFile(join(backup,'verified-copy/index.html'),'utf8'),'fixture provider page')
 assert.equal(await readFile(join(backup,'originals/cgi-bin/.htaccess'),'utf8'),'fixture CGI guard')
 assert.deepEqual(JSON.parse(await readFile(join(backup,'manifest.json'),'utf8')).snapshot,snapshot)
 const stat=await(await import('node:fs/promises')).lstat(join(backup,'verified-copy/index.html'));assert.equal(stat.mode&0o077,0)
 assert(phases.includes('preserving_provider_templates'))
 await verifyPreservedTemplates(f.home,root,id,snapshot)
 await writeFile(join(backup,'verified-copy/index.html'),'changed backup')
 await assert.rejects(verifyPreservedTemplates(f.home,root,id,snapshot),code('RECOVERY_TARGET_CHANGED'))
 }finally{await f.close()}
})

test('template recovery refuses arbitrary files, symlinks, oversized bytes and stale approval without relocation',async()=>{
 const f=await fixture();try{
 const {snapshotTemplates,preserveTemplates}=await import('../src/wordpress-stage-recovery.js'),root=join(f.home,'templates');await mkdir(root)
 await writeFile(join(root,'wp-config.php'),'unrelated content');await assert.rejects(snapshotTemplates(f.home,root),code('RECOVERY_TARGET_CHANGED'));await rm(join(root,'wp-config.php'))
 await symlink(join(f.home,'elsewhere'),join(root,'index.html'));await assert.rejects(snapshotTemplates(f.home,root),code('RECOVERY_TARGET_CHANGED'));await rm(join(root,'index.html'))
 await writeFile(join(root,'index.html'),'x'.repeat(256*1024+1));await assert.rejects(snapshotTemplates(f.home,root),code('RECOVERY_TARGET_CHANGED'))
 await writeFile(join(root,'index.html'),'before');const snapshot=await snapshotTemplates(f.home,root)
 await writeFile(join(root,'index.html'),'after')
 await assert.rejects(preserveTemplates(f.home,root,'b'.repeat(48),snapshot,()=>{}),code('RECOVERY_TARGET_CHANGED'))
 assert.equal(await readFile(join(root,'index.html'),'utf8'),'after')
 }finally{await f.close()}
})

test('recovery owner page describes template preservation and still needs a separate receipt',async()=>{
 const f=await browserFixture();try{
 const original=await unknownCreation(f)
 f.provider.inspectRecovery=async()=>({entries:[{path:'index.html',kind:'file',bytes:12,mode:420,inode:1,device:1,mtime:0,sha256:'a'.repeat(64)}],bytes:12})
 const recovery=await f.workflow.planRecovery('primary',original.planId,access)
 const page=await f.login(recovery.planId)
 assert(page.body.includes('a'.repeat(64)));assert(page.body.includes('Template checksums (SHA-256)'));assert(page.body.includes('Templates to preserve'));assert(page.body.includes('existing domain will not be created again'));assert(page.body.includes('Verified private template copies and retained originals'))
 assert(!page.body.includes('Target confirmed absent; no old target data to back up.'))
 const store=new ChangeStore(f.settings.changeStateFile!);assert.equal(store.get(original.planId,access.actor,'primary').status,'unknown');assert(!store.isOwnerApproved(store.get(recovery.planId,access.actor,'primary'),recovery.previewHash));store.close()
 }finally{await f.shutdown()}
})

test('a template-preservation failure keeps the transferred account reservation and never starts the database',async()=>{
 const f=await fixture();try{
 const original=await unknownCreation(f), recovery=await f.workflow.planRecovery('primary',original.planId,access)
 f.provider.preserveTemplates=async(_s,_t,_id,_snap,checkpoint)=>{checkpoint('preserving_provider_templates');throw new HostingError('RECOVERY_TARGET_CHANGED','Stopped after a possible relocation')}
 f.approve(recovery.planId,recovery.previewHash);await f.workflow.apply('primary',recovery.planId,recovery.previewHash,access)
 const done=await finished(f,recovery.planId);assert.equal(done.status,'unknown');assert.equal(done.phase,'preserving_provider_templates');assert(!f.state.calls.includes('database'))
 await assert.rejects(f.workflow.apply('primary',recovery.planId,recovery.previewHash,access),code('OWNER_CONFIRMATION_REQUIRED'))
 const store=new ChangeStore(f.settings.changeStateFile!), other=store.create({actor:access.actor,serverId:'primary',lockKey:'primary',expires:Date.now()+60000,payload:{}})
 assert.throws(()=>store.reserve(other.id,access.actor,'primary'),code('CHANGE_BUSY'));store.close()
 }finally{await f.close()}
})

async function emptyDatabaseCheckpoint(f:Awaited<ReturnType<typeof fixture>>){
 const original=await unknownCreation(f),recovery=await f.workflow.planRecovery('primary',original.planId,access)
 f.provider.createDatabase=async()=>{f.state.calls.push('db-created-unknown');throw new HostingError('WRITE_OUTCOME_UNKNOWN','Created but response not verified')}
 f.approve(recovery.planId,recovery.previewHash);await f.workflow.apply('primary',recovery.planId,recovery.previewHash,access)
 assert.equal((await finished(f,recovery.planId)).phase,'creating_database')
 f.provider.verifyTemplateBackup=async()=>{f.state.calls.push('backup-proof')}
 f.provider.verifyExistingDatabase=async(_s,_t,password)=>{assert.match(password,/^[a-zA-Z0-9_-]{43}$/);f.state.calls.push('db-proof')}
 return recovery
}

test('remaining install continues only an approved empty-DB recovery checkpoint, with no domain/DB retry',async()=>{
 const f=await fixture();try{
 const p=await emptyDatabaseCheckpoint(f),file=join(f.home,'.seohost-mcp-stage',p.planId+'.json'),before=await readFile(file,'utf8')
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,p.previewHash,{...access,canWrite:false}),code('WRITE_SCOPE_REQUIRED'))
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,'0'.repeat(64),access),code('OWNER_CONFIRMATION_REQUIRED'))
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,p.previewHash,{...access,actor:'other'}),code('PLAN_NOT_FOUND'))
 assert.equal((await f.workflow.continueInstall('primary',p.planId,p.previewHash,access)).status,'applying')
 const done=await finished(f,p.planId);assert.equal(done.status,'applied');assert.equal(f.state.calls.filter(c=>c==='db-created-unknown').length,1);assert.equal(f.state.calls.filter(c=>c==='create-unknown').length,1);assert.equal(f.state.calls.filter(c=>c==='install').length,1)
 assert.equal(await readFile(file,'utf8'),before);assert(!JSON.stringify(done).includes(JSON.parse(before).databasePassword))
 assert.equal((await f.workflow.continueInstall('primary',p.planId,p.previewHash,access)).status,'applied');assert.equal(f.state.calls.filter(c=>c==='install').length,1)
 }finally{await f.close()}
})

test('failed DB/backup proof leaves the original unknown checkpoint; continuation never takes over another phase',async()=>{
 const f=await fixture();try{
 const p=await emptyDatabaseCheckpoint(f)
 f.provider.verifyTemplateBackup=async()=>{throw new HostingError('RECOVERY_TARGET_CHANGED','Backup no longer matches')}
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,p.previewHash,access),code('RECOVERY_TARGET_CHANGED'))
 f.provider.verifyTemplateBackup=async()=>{}
 f.provider.verifyExistingDatabase=async()=>{throw new HostingError('DATABASE_PROOF_FAILED','Not an empty authenticated database')}
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,p.previewHash,access),code('DATABASE_PROOF_FAILED'))
 assert.equal(f.workflow.get('primary',p.planId,access).phase,'creating_database');assert.equal(f.workflow.get('primary',p.planId,access).status,'unknown');assert(!f.state.calls.includes('install'))
 const store=new ChangeStore(f.settings.changeStateFile!),c=store.get(p.planId,access.actor,'primary');(c.payload as {phase:string}).phase='installing_wordpress';store.checkpoint(c);store.close()
 await assert.rejects(f.workflow.continueInstall('primary',p.planId,p.previewHash,access),code('INSTALL_CONTINUATION_UNAVAILABLE'))
 }finally{await f.close()}
})

test('documented local Unix SQL sockets are accepted while remote/nonlocal connection descriptions are refused',async()=>{
 const f=await fixture();try{
 const{DirectAdminTransport}=await import('../src/directadmin-http.js')
 for(const connection of [{unixSocket:true,address:'/var/lib/mysql/mysql.sock'},{unixSocket:false,address:'localhost:3306'}]){
  let calls=0;const t=new DirectAdminTransport(f.settings,async()=>{calls++;return new Response(JSON.stringify({database:'test_fresh',dbuser:'test_fresh',password:'fixture-secret',hostPatterns:['localhost'],...connection}))})
  assert.equal((await t.createStageDatabase('primary','test_fresh','fixture-secret')).database,'test_fresh');assert.equal(calls,1)
 }
 for(const connection of [{unixSocket:true,address:'remote.example:3306'},{unixSocket:true,address:'/tmp/../secret.sock'},{unixSocket:false,address:'remote.example:3306'}]){
  const t=new DirectAdminTransport(f.settings,async()=>new Response(JSON.stringify({database:'test_fresh',dbuser:'test_fresh',password:'fixture-secret',hostPatterns:['localhost'],...connection})))
  await assert.rejects(t.createStageDatabase('primary','test_fresh','fixture-secret'),code('WRITE_OUTCOME_UNKNOWN'))
 }
 }finally{await f.close()}
})

test('fixed local PHP proof uses stdin only and requires empty metadata, exact localhost user and matching root',async()=>{
 const f=await fixture();try{
 const root=join(f.home,'domains/stg.example.com/public_html');await mkdir(root,{recursive:true})
 const php=join(f.home,'proof-php');await writeFile(php,`#!${process.execPath}\nlet s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const p=JSON.parse(s);if(process.argv[2]!=='-r'||!process.argv[3].includes('information_schema.tables')||process.argv.join(' ').includes('fixture-db-secret')||p.password!=='fixture-db-secret')process.exit(2);process.stdout.write('EMPTY_DATABASE_VERIFIED')})`,{mode:0o700})
 f.settings.accounts.primary!.wordpressProvisioning={home:f.home,phpBinary:php,wpCli:'/test/wp'}
 let tables=0,remote=false,wrongRoot=false
 const entry=()=>({database:'test_fresh',sizeBytes:0,tableCount:tables,userCount:1,definerIssues:0})
 const request:typeof fetch=async(url)=>{
  const u=new URL(String(url))
  if(u.pathname==='/CMD_API_DOMAIN')return new Response(JSON.stringify({users:{test:{domains:{'stg.example.com':{public_html:wrongRoot?f.home:root,subdomains:{}}}}}}))
  if(u.pathname==='/api/db-show/databases')return new Response(JSON.stringify([entry()]))
  if(u.pathname.endsWith('/users'))return new Response(JSON.stringify([{dbuser:'test_fresh',hostPatterns:remote?['%']:['localhost'],conflictingHosts:false}]))
  return new Response(JSON.stringify({...entry(),defaultCharset:'utf8mb4',defaultCollation:'utf8mb4_unicode_ci',eventCount:0,routineCount:0,triggerCount:0,viewCount:0}))
 }
 const provider=new LocalStageProvider(f.settings,request,{home:f.home,username:'test',hostname:new URL(f.settings.accounts.primary!.baseUrl).hostname})
 const target={...input,placement:'independent_domain' as const,adminName:'stageadmin',title:'Stage',hostname:'stg.example.com',root,database:'test_fresh',version:'6.9.1'}
 await provider.verifyExistingDatabase('primary',target,'fixture-db-secret')
 await assert.rejects(provider.verifyExistingDatabase('primary',target,'wrong-secret'),code('DATABASE_PROOF_FAILED'))
 tables=1;await assert.rejects(provider.verifyExistingDatabase('primary',target,'fixture-db-secret'),code('UNSAFE_STAGE_TARGET'));tables=0
 remote=true;await assert.rejects(provider.verifyExistingDatabase('primary',target,'fixture-db-secret'),code('UNSAFE_STAGE_TARGET'));remote=false
 wrongRoot=true;await assert.rejects(provider.verifyExistingDatabase('primary',target,'fixture-db-secret'),code('UNSAFE_STAGE_TARGET'))
 }finally{await f.close()}
})

test('the same approved recovery can finish a downloaded checksum checkpoint without recreating resources',async()=>{
 const f=await fixture();try{
 const p=await emptyDatabaseCheckpoint(f)
 f.provider.install=async(_s,_t,_secret,checkpoint,prepared,id)=>{f.state.calls.push('install');if(!prepared){checkpoint('verifying_core');throw new HostingError('WP_CLI_FAILED','Fixture truncated extraction')}assert.equal(id,p.planId);checkpoint('verifying_wordpress')}
 await f.workflow.continueInstall('primary',p.planId,p.previewHash,access);assert.equal((await finished(f,p.planId)).phase,'verifying_core')
 let preparedProof=false;f.provider.verifyExistingDatabase=async(_s,_t,_secret,prepared)=>{preparedProof=prepared===true}
 await f.workflow.continueInstall('primary',p.planId,p.previewHash,access);const done=await finished(f,p.planId)
 assert.equal(done.status,'applied');assert(preparedProof);assert.equal(done.result?.coreRepairReference,p.planId)
 assert.equal(f.state.calls.filter(c=>c==='db-created-unknown').length,1);assert.equal(f.state.calls.filter(c=>c==='create-unknown').length,1)
 }finally{await f.close()}
})


test('one fresh approval covers template preservation before DB/install and reports its private backup',async()=>{
 const f=await fixture();try{
 f.provider.prepareFreshRoot=async(_server,_target,id,checkpoint)=>{f.state.calls.push('preserve');checkpoint('preserving_provider_templates');return id}
 const plan=await f.workflow.plan('primary',input,access)
 assert.equal(plan.providerTemplates,'preserve_new_target_only');assert(plan.backup.includes('verified private copies'))
 f.approve(plan.planId,plan.previewHash);await f.workflow.apply('primary',plan.planId,plan.previewHash,access)
 const done=await finished(f,plan.planId);assert.equal(done.status,'applied')
 assert.deepEqual(f.state.calls,['preflight','preflight','subdomain','preserve','root','database','install'])
 assert.equal((done.result as {providerTemplateBackupReference:string}).providerTemplateBackupReference,plan.planId)
 }finally{await f.close()}
})
test('unexpected post-create files stop before DB/install, retain reservation and return safe diagnostics',async()=>{
 const f=await fixture();try{
 f.provider.prepareFreshRoot=async()=>{throw new HostingError('RECOVERY_TARGET_CHANGED','Template verification refused. No files removed.')}
 const plan=await f.workflow.plan('primary',input,access);f.approve(plan.planId,plan.previewHash)
 await f.workflow.apply('primary',plan.planId,plan.previewHash,access);const done=await finished(f,plan.planId)
 assert.equal(done.status,'unknown');assert.equal(done.code,'RECOVERY_TARGET_CHANGED')
 assert(!f.state.calls.includes('database'));assert(!f.state.calls.includes('install'))
 assert.equal((done.result as {detail:string}).detail,'Template verification refused. No files removed.')
 assert.equal(f.state.calls.filter(c=>c==='subdomain').length,1)
 }finally{await f.close()}
})


test('unconfirmed domain response exposes only safe status and never retries the write',async()=>{
 const f=await fixture();try{
 const {DirectAdminTransport}=await import('../src/directadmin-http.js');let calls=0
 const transport=new DirectAdminTransport(f.settings,async()=>{calls++;return new Response('private upstream body',{status:503})})
 await assert.rejects(transport.postForm('primary','/CMD_API_DOMAIN',{action:'create',domain:'stg.example.com'}),(e:unknown)=>e instanceof HostingError&&e.code==='WRITE_OUTCOME_UNKNOWN'&&e.message.includes('HTTP 503')&&!e.message.includes('private upstream'))
 assert.equal(calls,1)
 }finally{await f.close()}
})


test('production plan has distinct policy and owner receipt, snapshots existing provider root and never creates hosting',async()=>{
 const f=await browserFixture();try{
 const input={domain:'example.com',adminEmail:'owner@example.com'}
 await assert.rejects(f.workflow.planInstall('primary',input,access),code('WRITE_DISABLED'))
 f.settings.accounts.primary!.writeOperations=['install_wordpress']
 f.provider.inspectExistingRoot=async()=>({entries:[],bytes:0})
 f.provider.describeExistingRedirects=async()=>[{from:'/',to:'https://old.example.com/',type:302}]
 f.provider.preserveExistingRoot=async(_server,target,id)=>{assert.equal(target.environment,'production');f.state.calls.push('existing-backup');return id}
 f.provider.install=async(_server,target)=>{assert.equal(target.placement,'existing_domain');assert.equal(target.hostname,'example.com');assert.equal(target.label,'');assert.equal(target.environment,'production');f.state.calls.push('production-install')}
 const plan=await f.workflow.planInstall('primary',input,access)
 assert.equal(plan.target.adminName,'siteadmin');assert.equal(plan.target.title,'WordPress')
 assert.equal(getServerCapabilities(f.settings,'primary').tools.find(t=>t.name==='apply_wordpress_stage')?.configurationReady,true)
 await assert.rejects(f.workflow.apply('primary',plan.planId,plan.previewHash,access),code('OWNER_CONFIRMATION_REQUIRED'))
 const signed=await f.login(plan.planId);assert(signed.body.includes('Production mode'));assert(signed.body.includes('Current domain redirect'));assert(signed.body.includes('302 / → https://old.example.com/'));assert(!signed.body.includes('Login required for frontend;'))
 const token=f.csrf(signed.body)
 assert.equal((await f.post(f.url(plan.planId),{csrf:token,phase:'approve',decision:'approve',preview:plan.previewHash},signed.cookie+'; stage_owner='+token)).status,200)
 await f.workflow.apply('primary',plan.planId,plan.previewHash,access);const done=await finished(f,plan.planId)
 assert.equal(done.status,'applied');assert(f.state.calls.includes('existing-backup'));assert(f.state.calls.includes('production-install'));assert(!f.state.calls.includes('subdomain'))
 assert.equal((done.result as {providerTemplateBackupReference:string}).providerTemplateBackupReference,plan.planId)
 }finally{await f.shutdown()}
})
test('production root inspector refuses existing WordPress and arbitrary htaccess; preserves exact reviewed provider redirect',async()=>{
 const f=await fixture();try{
 const root=join(f.home,'domains/example.com/public_html');await mkdir(root,{recursive:true});await mkdir(join(f.home,'.seohost-mcp-stage'),{mode:0o700})
 await writeFile(join(root,'index.html'),'existing provider page')
 const htaccess=join(root,'.htaccess'),redirect='Redirect 302 / https://old.example.com\n'
 const request:typeof fetch=async(url)=>{
  const u=new URL(String(url))
  if(u.pathname==='/CMD_API_SHOW_DOMAINS')return new Response('list[]=example.com')
  if(u.pathname==='/CMD_API_DOMAIN')return new Response(JSON.stringify({users:{test:{domains:{'example.com':{public_html:root,subdomains:{}}}}}}))
  if(u.pathname==='/CMD_API_REDIRECT'){
   const exists=await readFile(htaccess,'utf8').then(()=>true,()=>false)
   return new Response(exists?new URLSearchParams({'/':new URLSearchParams({to:'https://old.example.com/',type:'302'}).toString()}).toString():'')
  }
  throw Error('Unexpected request')
 }
 const provider=new LocalStageProvider(f.settings,request,{home:f.home,username:'test',hostname:new URL(f.settings.accounts.primary!.baseUrl).hostname})
 const target={domain:'example.com',label:'',hostname:'example.com',root,database:'test_new',version:'6.9.1',adminEmail:'owner@example.com',adminName:'siteadmin',title:'Site',placement:'existing_domain' as const,environment:'production' as const}
 await writeFile(join(root,'wp-config.php'),'existing config sentinel')
 await assert.rejects(provider.inspectExistingRoot('primary',target));assert.equal(await readFile(join(root,'wp-config.php'),'utf8'),'existing config sentinel')
 await rm(join(root,'wp-config.php'));await writeFile(htaccess,'RewriteRule .* https://unexpected.example/ [R=302]\n')
 await assert.rejects(provider.inspectExistingRoot('primary',target),code('UNSAFE_STAGE_TARGET'))
 await writeFile(htaccess,redirect);const snapshot=await provider.inspectExistingRoot('primary',target)
 await writeFile(join(root,'index.html'),'changed provider page')
 await assert.rejects(provider.preserveExistingRoot('primary',target,'d'.repeat(48),snapshot,()=>{}),code('UNSAFE_STAGE_TARGET'))
 await writeFile(join(root,'index.html'),'existing provider page');const fresh=await provider.inspectExistingRoot('primary',target)
 assert.equal(await provider.preserveExistingRoot('primary',target,'d'.repeat(48),fresh,()=>{}),'d'.repeat(48))
 await provider.verifyRoot('primary',target)
 for(const kind of ['originals','verified-copy'])assert.equal(await readFile(join(f.home,'.seohost-mcp-stage/recovery','d'.repeat(48),kind,'.htaccess'),'utf8'),redirect)
 }finally{await f.close()}
})
