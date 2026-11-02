import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile, stat, mkdir, chmod, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { loadSettings, writeOperations } from '../src/config.js'
import { Mailboxes } from '../src/mailboxes.js'
import { HostingError } from '../src/hosting-error.js'
import { HostingChanges } from '../src/hosting-changes.js'
import { getServerCapabilities } from '../src/capabilities.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/server.js'

const owner = {actor:'owner-client',canWrite:true}
const target = {domain:'site.example',user:'contact'}
const code = (expected:string) => (error:unknown) => error instanceof HostingError && error.code === expected
const json = (value:unknown) => new Response(JSON.stringify(value))
async function fixture() {
  const directory = await mkdtemp(tmpdir()+'/mailboxes-'), settings = await loadSettings({},false)
  settings.changeStateFile = directory+'/changes.sqlite'
  settings.accounts = {primary:{label:'Hosting',aliases:['57'],baseUrl:'https://hosting.example:2222',usernameEnv:'USER',loginKeyEnv:'KEY',writeOperations:[...writeOperations]}}
  settings.credentials = {primary:{username:'system',loginKey:'private-key'}}
  const state = {mailboxes:new Map<string,{quotaBytes:number;limit:number;usageBytes:number;password:string}>(),posts:[] as URLSearchParams[],uncertain:false,malformed:false,encoded:false,
    denied:false,profileMismatch:false,gate:undefined as Promise<void>|undefined}
  const request:typeof fetch = async (input,init) => {
    const url = new URL(String(input))
    assert.equal(url.origin,'https://hosting.example:2222');assert.equal(init?.redirect,'manual')
    assert.equal(new Headers(init?.headers).get('Authorization'),'Basic '+Buffer.from('system:private-key').toString('base64'))
    if (init?.method === 'POST') {
      assert.equal(url.pathname,'/CMD_API_POP')
      const form = new URLSearchParams(String(init.body));state.posts.push(form)
      assert.equal(form.get('domain'),'site.example')
      const user = form.get('user')!, action = form.get('action')!
      assert(!form.has('newuser')); assert(!form.has('select0'));assert(!form.has('passwd_is_crypted'))
      if(state.gate) await state.gate
      if(action==='delete')state.mailboxes.delete(user)
      else {
        const previous=state.mailboxes.get(user)
        if(action==='create')assert(!previous)
        if(form.has('passwd'))assert.equal(form.get('passwd'),form.get('passwd2'))
        state.mailboxes.set(user,{quotaBytes:Number(form.get('quota'))*(action==='create'?1048576:1),limit:Number(form.get('limit')??previous?.limit),usageBytes:previous?.usageBytes??0,password:form.get('passwd')??previous?.password??''})
      }
      if(state.uncertain)throw Error('provider response lost; private provider text')
      return new Response('error=0&text=OK')
    }
    assert.equal(init?.method,'GET')
    if(url.pathname==='/CMD_API_SHOW_DOMAINS')return new Response('list[]=site.example')
    if(state.denied)return new Response('forbidden',{status:403})
    if(url.pathname==='/api/email-config/mobileconfig') {
      const address=state.profileMismatch?'other@site.example':url.searchParams.get('email')
      return new Response('<plist><dict><key>EmailAccountType</key><string>EmailTypeIMAP</string>'+['Incoming','Outgoing'].map(prefix=>
        `<key>${prefix}MailServerHostName</key><string>mail.hosting.example</string><key>${prefix}MailServerPortNumber</key><integer>${prefix==='Incoming'?993:465}</integer><key>${prefix}MailServerUseSSL</key><true/><key>${prefix}MailServerUsername</key><string>${address}</string>`).join('')+'<key>Password</key><string>do-not-return</string></dict></plist>')
    }
    assert.equal(url.pathname,'/CMD_API_POP');assert(!url.searchParams.has('passwd'))
    if(state.malformed)return json({unexpected:'private provider error'})
    if(url.searchParams.get('type')==='quota') {
      const box=state.mailboxes.get(url.searchParams.get('user')!);assert(box)
      return state.encoded?new Response(new URLSearchParams({quota:String(box.quotaBytes),total_bytes:String(box.usageBytes)}).toString()):json({quota:box.quotaBytes,total_bytes:box.usageBytes})
    }
    assert.equal(url.searchParams.get('action'),'full_list')
    const rows=[...state.mailboxes].map(([user,box])=>[user,{limit:String(box.limit),suspended:'no'}] as const)
    return state.encoded?new Response(new URLSearchParams(rows.map(([user,row])=>[user,new URLSearchParams(row).toString()])).toString()):json(Object.fromEntries(rows))
  }
  const manager=new Mailboxes(settings,request)
  return {directory,settings,state,request,manager,close:()=>rm(directory,{recursive:true,force:true})}
}

test('mailbox create is direct, durable and secret-free; modify converts quota units and preserves unspecified settings',async()=>{
  const f=await fixture()
  try {
    const requestId=randomUUID(), result=await f.manager.create('57',{...target,requestId},owner)
    assert.equal(result.status,'applied');assert.equal(f.state.posts.length,1)
    assert.equal(f.state.posts[0]!.get('quota'),'1024');assert.equal(f.state.posts[0]!.get('limit'),'100')
    const receipt=result.result! as {credentialFile:string}
    const credential=JSON.parse(await readFile(receipt.credentialFile,'utf8'))
    assert.equal(credential.address,'contact@site.example');assert(credential.password.length>=32)
    assert.equal(credential.password,f.state.mailboxes.get('contact')!.password)
    assert.equal((await stat(receipt.credentialFile)).mode&0o777,0o600)
    assert.equal((await stat(f.directory+'/mailbox-credentials')).mode&0o777,0o700)
    assert(!JSON.stringify(result).includes(credential.password))
    assert(!((await readFile(f.settings.changeStateFile!)).includes(Buffer.from(credential.password))))
    assert.deepEqual(await new Mailboxes(f.settings,f.request).create('primary',{...target,requestId},owner),result)
    assert.equal(f.state.posts.length,1)
    await assert.rejects(f.manager.create('primary',{...target,requestId,quotaMiB:20},owner),code('REQUEST_ID_CONFLICT'))
    const update=await f.manager.update('primary',{...target,requestId:randomUUID(),quotaMiB:12},owner)
    assert.equal(update.status,'applied');assert.equal(f.state.posts[1]!.get('quota'),String(12*1048576));assert(!f.state.posts[1]!.has('passwd'))
    assert.equal(f.state.mailboxes.get('contact')!.limit,100)
    const oldPassword=credential.password
    const reset=await f.manager.update('primary',{...target,requestId:randomUUID(),dailySendLimit:0,resetPassword:true},owner)
    assert.equal(reset.status,'applied');assert.equal(f.state.posts[2]!.get('quota'),String(12*1048576))
    assert.notEqual(f.state.mailboxes.get('contact')!.password,oldPassword);assert.equal(f.state.mailboxes.get('contact')!.limit,0)
    const configuration=await f.manager.configuration('primary',target)
    assert.deepEqual(configuration.imap,{host:'mail.hosting.example',port:993,tls:true});assert.equal(configuration.quotaBytes,12*1048576)
    assert(!JSON.stringify(configuration).includes('do-not-return'))
  } finally {await f.close()}
})

test('mailbox deletion requires exact actor, preview, chat confirmation and fresh snapshot; replay never deletes again',async()=>{
  const f=await fixture()
  try {
    await f.manager.create('primary',{...target,requestId:randomUUID()},owner)
    const plan=await f.manager.planDeletion('primary',target,owner)
    assert.equal(f.state.posts.length,1);assert.match(plan.warning,/permanently/)
    await assert.rejects(f.manager.delete('primary',plan.planId,plan.previewHash!,'yes',owner),code('CONFIRMATION_REQUIRED'))
    await assert.rejects(f.manager.delete('primary',plan.planId,plan.previewHash!,plan.confirmationRequired,{...owner,actor:'other'}),code('PLAN_NOT_FOUND'))
    f.state.mailboxes.get('contact')!.usageBytes=1
    assert.equal((await f.manager.delete('primary',plan.planId,plan.previewHash!,plan.confirmationRequired,owner)).code,'STALE_PLAN')
    assert.equal(f.state.posts.length,1)
    const fresh=await f.manager.planDeletion('primary',target,owner)
    const result=await f.manager.delete('primary',fresh.planId,fresh.previewHash!,fresh.confirmationRequired,owner)
    assert.equal(result.status,'applied');assert.equal(f.state.posts.length,2)
    assert.deepEqual(await f.manager.delete('primary',fresh.planId,fresh.previewHash!,fresh.confirmationRequired,owner),result)
    assert.equal(f.state.posts.length,2);assert.equal(f.state.mailboxes.size,0)
    const hosting=new HostingChanges(f.settings,f.request)
    await assert.rejects(hosting.apply('primary',fresh.planId,fresh.previewHash!,owner),code('PLAN_NOT_FOUND'))
    await assert.rejects(hosting.get('primary',fresh.planId,owner,true),code('PLAN_NOT_FOUND'))
  } finally {await f.close()}
})

test('lost provider response retains receipt and shared account lock without resending or claiming password verification',async()=>{
  const f=await fixture()
  try {
    const input={...target,requestId:randomUUID()};f.state.uncertain=true
    const result=await f.manager.create('primary',input,owner)
    assert.equal(result.status,'unknown');assert.equal(result.code,'WRITE_OUTCOME_UNKNOWN')
    assert(!JSON.stringify(result).includes('private provider text'))
    assert.equal((result.result as {passwordApplication:string}).passwordApplication,'unverified')
    assert.deepEqual(await new Mailboxes(f.settings,f.request).create('primary',input,owner),result)
    assert.equal(f.state.posts.length,1)
    const blocked=await f.manager.create('primary',{...target,user:'second',requestId:randomUUID()},owner).catch(error=>error)
    assert.equal(blocked.code,'CHANGE_BUSY');assert.equal(f.state.posts.length,1)
    assert.deepEqual(f.manager.get('primary',result.operationId,owner),result)
    assert.throws(()=>f.manager.get('primary',result.operationId,{...owner,actor:'other'}),code('PLAN_NOT_FOUND'))
  } finally {await f.close()}
})

test('authorization, domain ownership, protected system mailbox and existing mailbox checks precede all writes',async()=>{
  const f=await fixture()
  try {
    await assert.rejects(f.manager.create('primary',{...target,requestId:randomUUID()},{...owner,canWrite:false}),code('WRITE_SCOPE_REQUIRED'))
    f.settings.accounts.primary!.writeOperations=['create_domain']
    await assert.rejects(f.manager.create('primary',{...target,requestId:randomUUID()},owner),code('WRITE_DISABLED'))
    assert(getServerCapabilities(f.settings,'primary').tools.find(t=>t.name==='create_email_account')!.missingConfiguration.includes('mailbox_operation_allowlist'))
    f.settings.accounts.primary!.writeOperations=[...writeOperations]
    await assert.rejects(f.manager.create('primary',{...target,user:'system',requestId:randomUUID()},owner),code('SYSTEM_MAILBOX_REFUSED'))
    const foreign=await f.manager.create('primary',{...target,domain:'foreign.example',requestId:randomUUID()},owner)
    assert.equal(foreign.code,'DOMAIN_NOT_ON_SERVER');assert.equal(f.state.posts.length,0)
    await f.manager.create('primary',{...target,requestId:randomUUID()},owner)
    assert.equal((await f.manager.create('primary',{...target,requestId:randomUUID()},owner)).code,'MAILBOX_EXISTS');assert.equal(f.state.posts.length,1)
    for(const user of ['../x','a@b','bad\nuser','Uppercase','a..b'])await assert.rejects(f.manager.create('primary',{...target,user,requestId:randomUUID()},owner))
    await assert.rejects(f.manager.update('primary',{...target,requestId:randomUUID()},owner))
    assert.equal(f.state.posts.length,1)
  } finally {await f.close()}
})

test('bounded metadata supports legacy encoding and refuses malformed, denied and mismatched configuration',async()=>{
  const f=await fixture()
  try {
    f.state.encoded=true
    await f.manager.create('primary',{...target,requestId:randomUUID(),quotaMiB:0,dailySendLimit:0},owner)
    assert.equal((await f.manager.list('primary',target.domain)).total,1)
    assert.equal((await f.manager.configuration('primary',target)).quotaBytes,0)
    f.state.profileMismatch=true;await assert.rejects(f.manager.configuration('primary',target),code('EMAIL_CONFIG_UNAVAILABLE'))
    f.state.malformed=true;await assert.rejects(f.manager.list('primary',target.domain),code('INVALID_RESPONSE'))
    f.state.denied=true;await assert.rejects(f.manager.list('primary',target.domain),code('ACCESS_DENIED'))
  } finally {await f.close()}
})

test('mailbox password storage rejects permissive directories and symlinks before POST',async()=>{
  for(const linked of [false,true]) {
    const f=await fixture()
    try {
      if(linked) await symlink(f.directory,f.directory+'/mailbox-credentials')
      else {await mkdir(f.directory+'/mailbox-credentials');await chmod(f.directory+'/mailbox-credentials',0o755)}
      const result=await f.manager.create('primary',{...target,requestId:randomUUID()},owner)
      assert.equal(result.status,'failed');assert.equal(result.code,'CREDENTIAL_STORAGE_UNSAFE');assert.equal(f.state.posts.length,0)
    }finally{await f.close()}
  }
})

test('concurrent duplicate requests cannot send a second POST',async()=>{
  const f=await fixture();let release!:()=>void
  try {
    f.state.gate=new Promise<void>(resolve=>{release=resolve})
    const input={...target,requestId:randomUUID()}, first=f.manager.create('primary',input,owner)
    while(f.state.posts.length===0)await new Promise(resolve=>setImmediate(resolve))
    const duplicate=await new Mailboxes(f.settings,f.request).create('primary',input,owner)
    assert.equal(duplicate.status,'applying');assert.equal(f.state.posts.length,1)
    release();assert.equal((await first).status,'applied')
  }finally{release?.();await f.close()}
})

test('real MCP client creates without browser configuration and reports unknown writes as errors with usable receipts',async()=>{
  const f=await fixture(), server=createMcpServer(f.settings,f.request,owner)
  const client=new Client({name:'mailbox-integration',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
  try {
    await server.connect(b);await client.connect(a)
    assert.equal(f.settings.localOAuth,undefined)
    const input={serverId:'primary',...target,requestId:randomUUID()}
    const created=await client.callTool({name:'create_email_account',arguments:input})
    assert.equal(created.isError,undefined);assert.equal((created.structuredContent as Record<string,unknown>)?.status,'applied')
    assert.equal(f.state.posts.length,1);assert(!JSON.stringify(created).includes(f.state.mailboxes.get('contact')!.password))
    const emptyUpdate=await client.callTool({name:'update_email_account',arguments:{...input,requestId:randomUUID()}})
    assert.equal(emptyUpdate.isError,true);assert.equal(f.state.posts.length,1)
    f.state.uncertain=true
    const uncertain=await client.callTool({name:'update_email_account',arguments:{...input,requestId:randomUUID(),quotaMiB:3}})
    assert.equal(uncertain.isError,true);assert.equal((uncertain.structuredContent as Record<string,unknown>)?.status,'unknown')
    const receipt=await client.callTool({name:'get_email_operation',arguments:{serverId:'primary',operationId:(uncertain.structuredContent as Record<string,unknown>).operationId}})
    assert.deepEqual(receipt.structuredContent,uncertain.structuredContent);assert.equal(f.state.posts.length,2)
  }finally{await client.close();await server.close();await f.close()}
})
