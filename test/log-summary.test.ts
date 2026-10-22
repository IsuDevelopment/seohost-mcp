import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings } from '../src/config.js'
import { LogSummaryClient } from '../src/log-summary.js'
import { createMcpServer } from '../src/server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
async function fixture(lines:string[]){
 const settings=await loadSettings({},false)
 settings.accounts={primary:{label:'Account',aliases:[],baseUrl:'https://hosting.example:2222',usernameEnv:'USER',loginKeyEnv:'KEY'}}
 settings.credentials={primary:{username:'account',loginKey:'private-key'}}
 const calls:URL[]=[]
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));calls.push(url);assert.equal(init?.method,'GET');assert.equal(init.redirect,'manual');assert.equal(url.origin,'https://hosting.example:2222')
  if(url.pathname==='/CMD_API_SHOW_DOMAINS')return new Response('list[]=site.example')
  assert.equal(url.pathname,'/CMD_SHOW_LOG');return new Response(lines.join('\n'))
 }
 return{settings,request,calls,api:new LogSummaryClient(settings,request)}
}
test('one log fetch classifies all returned lines and retains rare fatal findings ahead of frequent WAF noise',async()=>{
 const f=await fixture([...Array.from({length:80},()=>`2026-10-22 10:00:00 ModSecurity: [id "399115"] [msg "private provider text"]`),
 '2026-10-22 10:01:00 PHP Fatal error: Uncaught Error: broken plugin token=private-token in /home/account/domains/site.example/public_html/plugin.php',
 '2026-10-22 10:01:01 File not found /cache.js','2026-10-22 10:01:02 Auto Index is disabled',
 '2026-10-22 10:01:03 Abort request processing by PID: 123'])
 const value=await f.api.summarize({serverId:'primary',domain:'site.example',logType:'error'})
 assert.equal(f.calls.filter(u=>u.pathname==='/CMD_SHOW_LOG').length,1)
 assert.equal('fatalLines' in value&&value.fatalLines,1)
 assert.equal('categories' in value&&value.categories[0]?.category,'php_fatal')
 assert.equal('wafRules' in value&&value.wafRules[0]?.matchedLines,80)
 for(const secret of ['private-token','private provider text','/home/account'])assert(!JSON.stringify(value).includes(secret))
 assert.equal(value.analyzedLines,84)
})
test('access summary counts requests/statuses, omits identities/query/header and flags malformed lines',async()=>{
 const f=await fixture([
 '192.0.2.10 - - [22/Oct/2026:10:00:00 +0200] "GET /shop?token=private-query HTTP/1.1" 200 10 "https://ref.example/private" "private-user-agent"',
 '192.0.2.11 - - [22/Oct/2026:10:00:01 +0200] "GET /shop HTTP/2" 500 20 "-" "-"',
 '192.0.2.12 - - [22/Oct/2026:10:00:02 +0200] "POST /login HTTP/1.1" 403 20 "-" "-"','malformed access record'])
 const v=await f.api.summarize({serverId:'primary',domain:'site.example',logType:'access',lines:100})
 assert.equal('parsedRequests' in v&&v.parsedRequests,3);assert.equal('unparsedLines'in v&&v.unparsedLines,1)
 assert.equal('serverErrors'in v&&v.serverErrors,1);assert.equal('clientErrors'in v&&v.clientErrors,1)
 assert.equal('topPaths'in v&&v.topPaths[0]?.path,'/shop')
 for(const text of ['private-query','private-user-agent','192.0.2.','ref.example'])assert(!JSON.stringify(v).includes(text))
 assert.equal(f.calls.length,2)
})
test('summary does not turn empty or truncated tail into full-history assurance; SDK tool uses one read',async()=>{
 const f=await fixture([]),server=createMcpServer(f.settings,f.request),client=new Client({name:'summary-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
 try{await server.connect(a);await client.connect(b);const r=await client.callTool({name:'summarize_web_log',arguments:{serverId:'primary',domain:'site.example',logType:'error'}})
 assert.equal(r.isError,undefined);const v=r.structuredContent as {analyzedLines:number;coverage:string};assert.equal(v.analyzedLines,0);assert.equal(v.coverage,'bounded_returned_tail_not_complete_history')
 assert.equal(f.calls.filter(u=>u.pathname==='/CMD_SHOW_LOG').length,1)
 }finally{await client.close();await server.close()}
})

test('summary retains rare fatal from the fetched tail even when raw log output would exceed 64 KiB',async()=>{
 const f=await fixture(['2026-10-22 10:00:00 PHP Fatal error: broken plugin',...Array.from({length:200},()=>`2026-10-22 10:01:00 ModSecurity ${'x'.repeat(500)}`)])
 const value=await f.api.summarize({serverId:'primary',domain:'site.example',logType:'error',lines:500})
 assert.equal('fatalLines' in value&&value.fatalLines,1);assert.equal(value.analyzedLines,201)
 assert.equal(f.calls.filter(u=>u.pathname==='/CMD_SHOW_LOG').length,1)
})
