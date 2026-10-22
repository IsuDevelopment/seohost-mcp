import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadSettings } from '../src/config.js'
import { AccountDiagnostics } from '../src/account-diagnostics.js'
import { BackupInventory } from '../src/backup-inventory.js'
import { HostingError } from '../src/hosting-error.js'
import { createMcpServer } from '../src/server.js'
const json = (v: unknown) => new Response(JSON.stringify(v))
const code = (expected: string) => (error: unknown) => error instanceof HostingError && error.code === expected
async function fixture() {
  const settings = await loadSettings({}, false)
  settings.accounts = { primary: { label: 'Primary', aliases: ['first'], baseUrl: 'https://hosting.example:2222', usernameEnv: 'USER', loginKeyEnv: 'KEY', backupRoots: ['private-backups'] } }
  settings.credentials = { primary: { username: 'account', loginKey: 'private-key' } }
  const db = { database: 'account_wp', sizeBytes: 1000, tableCount: 12, userCount: 1, definerIssues: 0, password: 'private-database-password',
    defaultCharset: 'utf8mb4', defaultCollation: 'utf8mb4_unicode_ci', eventCount: 0, routineCount: 0, triggerCount: 0, viewCount: 1 }
  const metrics = { tasks: 2, cpuRate: 0.2, cpuPressureRate: 0, memoryBytes: 500, memoryPressureRate: 0,
    diskReadBytesPerSec: 0, diskReadOpsPerSec: 0, diskWriteBytesPerSec: 10, diskWriteOpsPerSec: 1, diskPressureRate: 0 }
  const limits = { tasks: 100, cpuRate: 1, memoryHighBytes: 0, memoryMaxBytes: 1000, diskReadBytesPerSec: 0, diskReadOpsPerSec: 0, diskWriteBytesPerSec: 0, diskWriteOpsPerSec: 0 }
  const state = { calls: [] as URL[], used: 'quota=95&bandwidth=0&inode=10&mysql=1&vdomains=2&nsubdomains=0&nemails=0&ftp=0&email=private-email',
    config: 'quota=100&bandwidth=unlimited&additional_bandwidth=10&inode=0&mysql=unlimited&account=ON&suspended=no&email=private-email&username=private-account',
    dbs: [db], detail: db, latest: { metrics, limits, password: 'not-output' } as unknown, history: { limits, timestamps: [100,200], cpuRate: [0.1,0.2] } as unknown,
    metricStatus: 200, listing: { canonicalPath: 'private-backups', filesMatched: 3, files: [
      { name: 'site.tar.gz', type: 'file', symlink: false, sizeBytes: 100, modifyTime: '2026-10-22T00:00:00Z', password: 'not-output' },
      { name: 'config.env', type: 'file', symlink: false, sizeBytes: 100 },
      { name: 'unsafe.zip', type: 'file', symlink: true, sizeBytes: 100 },
    ] } }
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); state.calls.push(url)
    assert.equal(url.origin, 'https://hosting.example:2222'); assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'manual')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from('account:private-key').toString('base64'))
    assert(!url.searchParams.has('user'))
    if (url.pathname === '/CMD_API_SHOW_USER_USAGE') return new Response(state.used)
    if (url.pathname === '/CMD_API_SHOW_USER_CONFIG') return new Response(state.config)
    if (url.pathname.startsWith('/api/resource-usage/')) {
      if (state.metricStatus !== 200) return new Response('private error detail', { status: state.metricStatus })
      return json(url.pathname.endsWith('latest') ? state.latest : state.history)
    }
    if (url.pathname === '/api/db-show/databases') { assert.equal(url.searchParams.get('no-size'), 'false'); return json(state.dbs) }
    if (url.pathname === '/api/db-show/databases/account_wp') return json(state.detail)
    if (url.pathname === '/api/filemanager/list') { assert.equal(url.searchParams.get('path'), 'private-backups'); return json(state.listing) }
    assert.fail('Unexpected endpoint: no SQL, SSO, files, shell or mutation allowed')
  }
  return { settings, state, request, api: new AccountDiagnostics(settings, request), backups: new BackupInventory(settings, request) }
}

test('account statistics project only tally/limits, preserve unlimited/zero/unknown and identify near quota', async () => {
  const f = await fixture(), value = await f.api.usage('first')
  assert.equal(value.serverId, 'primary'); assert.equal(value.resources.find(r=>r.name==='quota')?.percent, 95)
  assert.equal(value.resources.find(r=>r.name==='quota')?.nearLimit, true)
  assert.equal(value.resources.find(r=>r.name==='bandwidth')?.limit, 'unlimited')
  assert.equal(value.resources.find(r=>r.name==='inode')?.limit, 0)
  assert.equal(value.resources.find(r=>r.name==='inode')?.percent, null)
  assert(!JSON.stringify(value).includes('private-'))
  f.state.config = 'quota=100&bandwidth=100&additional_bandwidth=10'
  const next = await f.api.usage('primary')
  assert.equal(next.resources.find(r=>r.name==='bandwidth')?.limit, 110)
  assert.equal(next.resources.find(r=>r.name==='mysql')?.used, 1)
  assert.equal(next.resources.find(r=>r.name==='mysql')?.limit, null)
})

test('malformed account stats fail without echoing provider data', async () => {
  const f = await fixture()
  for (const value of ['error=1&text=private-error', 'quota=NaN&bandwidth=0', '{}', 'quota=1&quota=2&bandwidth=0', '']) {
    f.state.used = value; await assert.rejects(f.api.usage('primary'), code('INVALID_RESPONSE'))
  }
})

test('resource metrics are account-only, typed and bounded; missing permissions are not fabricated zero usage', async () => {
  const f = await fixture(), latest = await f.api.resources('primary')
  assert.equal('metrics' in latest && latest.metrics.cpuRate, 0.2); assert(!JSON.stringify(latest).includes('not-output'))
  const history = await f.api.resources('primary', 24, 2, 'avg')
  assert.equal('cpuRate' in history && history.cpuRate?.length, 2)
  const url=f.state.calls.at(-1)!
  assert.equal(url.searchParams.get('agg'), 'avg'); assert.equal(url.searchParams.get('n'), '2')
  assert.equal(new Date(url.searchParams.get('to')!).getTime()-new Date(url.searchParams.get('from')!).getTime(), 86400000)
  f.state.metricStatus=403; await assert.rejects(f.api.resources('primary'), code('ACCESS_DENIED'))
  f.state.metricStatus=200; f.state.latest={metrics:{},limits:{}}
  await assert.rejects(f.api.resources('primary'),code('INVALID_RESPONSE'))
  f.state.history={limits:{tasks:1,cpuRate:1,memoryHighBytes:0,memoryMaxBytes:1,diskReadBytesPerSec:0,diskReadOpsPerSec:0,diskWriteBytesPerSec:0,diskWriteOpsPerSec:0},timestamps:[1,2],cpuRate:[0]}
  await assert.rejects(f.api.resources('primary',1),code('INVALID_RESPONSE'))
  await assert.rejects(f.api.resources('primary',169))
})

test('database reads paginate safe metadata and enforce fresh exact ownership without SQL/credentials', async () => {
  const f=await fixture()
  f.state.dbs.push({...f.state.detail,database:'account_two'})
  const list=await f.api.databases('primary',0,1)
  assert.equal(list.total,2); assert.equal(list.nextOffset,1); assert.equal(list.databases.length,1)
  assert(!JSON.stringify(list).includes('password'))
  const detail=await f.api.databaseInfo('primary','account_wp')
  assert.equal(detail.contentsRead,false); assert.equal(detail.defaultCharset,'utf8mb4'); assert(!JSON.stringify(detail).includes('private-database-password'))
  const before=f.state.calls.length
  await assert.rejects(f.api.databaseInfo('primary','foreign_wp'),code('DATABASE_NOT_ON_SERVER'))
  assert.equal(f.state.calls.length,before+1)
  for(const input of ['../account_wp','a/b','a%2fb','a?x','a#x','a\\b']) await assert.rejects(f.api.databaseInfo('primary',input))
  f.state.detail={...f.state.detail,database:'different_db'}
  await assert.rejects(f.api.databaseInfo('primary','account_wp'),code('INVALID_RESPONSE'))
  f.state.dbs.push({...f.state.dbs[0]!})
  await assert.rejects(f.api.databases('primary'),code('INVALID_RESPONSE'))
})

test('backup inventory requires explicit roots, projects archive metadata and never downloads or implies integrity', async () => {
  const f=await fixture(), result=await f.backups.list('primary')
  assert.equal(result.archives.length,1); assert.equal(result.archives[0]?.filename,'site.tar.gz')
  assert.equal(result.backupIntegrity,'unverified'); assert.equal(result.contentsRead,false)
  assert(!JSON.stringify(result).includes('private-backups')); assert(!JSON.stringify(result).includes('not-output'))
  f.settings.accounts.primary!.backupRoots=[]
  const before=f.state.calls.length
  await assert.rejects(f.backups.list('primary'),code('BACKUP_ROOTS_DISABLED')); assert.equal(f.state.calls.length,before)
})

test('backup canonical boundaries, unsafe filenames, symlinks and incomplete metadata fail safely', async () => {
  const f=await fixture()
  f.state.listing.canonicalPath='other'
  await assert.rejects(f.backups.list('primary'),code('BACKUP_PATH_DENIED'))
  f.state.listing.canonicalPath='private-backups'
  f.state.listing.files=[]; f.state.listing.filesMatched=1
  await assert.rejects(f.backups.list('primary'),code('INCOMPLETE_METADATA'))
  f.state.listing.files=[{name:'../secret.zip',type:'file',symlink:false,sizeBytes:10}]; f.state.listing.filesMatched=1
  assert.equal((await f.backups.list('primary')).archives.length,0)
  f.state.listing.filesMatched=10002
  const limited=await f.backups.list('primary',0,10000,1)
  assert.equal(limited.paginationLimitReached,true);assert.equal(limited.nextOffset,null)
  f.state.listing.files=[{name:'safe.zip',type:'file',symlink:false,sizeBytes:10},{name:'safe.zip',type:'file',symlink:false,sizeBytes:10}];f.state.listing.filesMatched=2
  await assert.rejects(f.backups.list('primary'),code('INVALID_RESPONSE'))
})

test('real MCP client reads new diagnostics using original read access and discovers backup config limits',async()=>{
  const f=await fixture(),server=createMcpServer(f.settings,f.request),client=new Client({name:'diagnostic-expansion',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
  try{
    await server.connect(a);await client.connect(b)
    for(const [name,args] of [['get_account_usage',{}],['list_databases',{}],['get_database_info',{database:'account_wp'}],['get_resource_usage',{}],['list_backup_files',{}]] as const){
      const result=await client.callTool({name,arguments:{serverId:'primary',...args}});assert.equal(result.isError,undefined,name)
    }
  }finally{await client.close();await server.close()}
})
