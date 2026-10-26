import { execFile } from 'node:child_process'
import { lstat, realpath, readdir, mkdir, writeFile, chmod } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir, userInfo, hostname } from 'node:os'
import { z } from 'zod'
import type { Settings } from './config.js'
import { DirectAdminClient } from './directadmin.js'
import { DirectAdminTransport, boundedBytes } from './directadmin-http.js'
import { AccountDiagnostics } from './account-diagnostics.js'
import { snapshotTemplates, preserveTemplates, verifyPreservedTemplates, type TemplateSnapshot } from './wordpress-stage-recovery.js'
import { assertPreparedCore, repairDownloadedCore } from './wordpress-core-repair.js'
import { HostingError } from './hosting-error.js'

export type StageInput = { domain: string; label: string; adminEmail: string; adminName: string; title: string; placement?: 'independent_domain' | 'subdomain' }
export type StageTarget = StageInput & { hostname: string; root: string; database: string; version: string }
export interface StageProvider {
  prepareFreshRoot?(serverId:string,target:StageTarget,id:string,checkpoint:(phase:string)=>void):Promise<string|null>
  verifyExistingDatabase?(serverId:string,target:StageTarget,password:string,preparedCore?:boolean):Promise<void>
  verifyTemplateBackup?(serverId:string,target:StageTarget,id:string,snapshot:TemplateSnapshot):Promise<void>
  inspectRecovery?(serverId:string,target:StageTarget):Promise<TemplateSnapshot>
  preserveTemplates?(serverId:string,target:StageTarget,id:string,snapshot:TemplateSnapshot,checkpoint:(phase:string)=>void):Promise<string>
  preflight(serverId: string, input: StageInput, database: string): Promise<{root: string; version: string}>
  createHosting(serverId: string, target: StageTarget): Promise<void>
  verifyRoot(serverId: string, target: StageTarget): Promise<void>
  createDatabase(serverId: string, target: StageTarget, password: string): Promise<void>
  install(serverId: string, target: StageTarget, secret: { databasePassword: string; adminPassword: string }, checkpoint: (phase: string) => void,preparedCore?:boolean,planId?:string): Promise<void>
}
const denied = () => new HostingError('UNSAFE_STAGE_TARGET', 'Fresh-stage targeting could not be verified. Existing data and symlinks are never reused or overwritten.')

// Verify every existing component: realpath alone would silently accept symlinks.
export async function safeStagePath(home: string, path: string, allowMissing = false) {
  if (!path.startsWith(home + '/') || path.split('/').some(p => p === '..' || p === '.')) throw denied()
  if (await realpath(home) !== home) throw denied()
  const parts = path.slice(home.length + 1).split('/')
  let current = home
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!)
    try { const s = await lstat(current); if (s.isSymbolicLink() || !s.isDirectory() || s.uid !== process.getuid?.()) throw denied() }
    catch (e) { if (allowMissing && i === parts.length - 1 && (e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e }
  }
}

export class LocalStageProvider implements StageProvider {
  private readonly transport: DirectAdminTransport
  private readonly hosting: DirectAdminClient
  private readonly diagnostics: AccountDiagnostics
  constructor(private readonly settings: Settings, private readonly request: typeof fetch = fetch, private readonly identity = {home:homedir(),username:userInfo().username,hostname:hostname()}, private readonly tar = process.platform==='darwin'?'/usr/bin/tar':'/bin/tar') {
    this.transport = new DirectAdminTransport(settings, request); this.hosting = new DirectAdminClient(settings, request); this.diagnostics = new AccountDiagnostics(settings, request)
  }
  private config(serverId: string) {
    const config = this.settings.accounts[serverId]?.wordpressProvisioning
    if (!config || new URL(this.settings.accounts[serverId]!.baseUrl).hostname !== this.identity.hostname || config.home !== this.identity.home || this.settings.credentials[serverId]?.username !== this.identity.username)
      throw new HostingError('LOCAL_ACCOUNT_REQUIRED', 'Provisioning requires an explicitly configured local account matching this process owner. Remote accounts are unsupported.')
    return config
  }
  private async roots(serverId: string, domain: string) {
    const raw = await this.transport.getText(serverId, '/CMD_API_DOMAIN', { action: 'document_root', json: 'yes' })
    try {
      const value = JSON.parse(raw).users[this.settings.credentials[serverId]!.username].domains[domain]
      return z.object({ public_html: z.string(), subdomains: z.record(z.object({ public_html: z.string() })) }).parse(value)
    } catch { throw denied() }
  }
  private async wp(serverId: string, root: string, args: string[], input = '') {
    const config = this.config(serverId), privateRoot = join(config.home, '.seohost-mcp-stage')
    try { await mkdir(privateRoot, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    await safeStagePath(config.home, privateRoot)
    await chmod(privateRoot, 0o700)
    const cliConfig = join(privateRoot, 'wp-cli.yml')
    // Exclusive creation; never load configuration/packages from a hosted site or inherited env.
    try { await writeFile(cliConfig, '{}\n', { mode: 0o600, flag: 'wx' }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    const confStat = await lstat(cliConfig)
    if (!confStat.isFile() || confStat.isSymbolicLink() || confStat.uid !== process.getuid?.() || (confStat.mode & 0o077)) throw denied()
    return new Promise<string>((resolve, reject) => {
      const child = execFile(config.phpBinary, [config.wpCli, '--path=' + root, '--skip-packages', '--skip-plugins', '--skip-themes', '--no-color', ...args], {
        cwd: privateRoot, timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
        env: { HOME: config.home, PATH: dirname(config.phpBinary) + ':/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8',
          WP_CLI_CONFIG_PATH: cliConfig, WP_CLI_PACKAGES_DIR: join(privateRoot, 'packages'), WP_CLI_CACHE_DIR: join(privateRoot, 'cache') },
      }, (error, stdout) => error ? reject(new HostingError('WP_CLI_FAILED', 'A fixed WP-CLI step failed or timed out. Raw output is withheld; inspect the checkpoint, never retry blindly.')) : resolve(stdout.trim()))
      child.stdin?.on('error', () => { /* exit callback owns the result */ }); child.stdin?.end(input)
    })
  }
  async preflight(serverId: string, input: StageInput, database: string) {
    const config = this.config(serverId)
    const domains = (await this.hosting.listDomains(serverId)).domains
    const hostname = input.label + '.' + input.domain
    if (!domains.includes(input.domain) || domains.includes(hostname) || (await this.hosting.listSubdomains(serverId, input.domain)).subdomains.includes(hostname)) throw denied()
    const roots = await this.roots(serverId, input.domain), parent = join(config.home, 'domains', input.domain, 'public_html')
    const independent = input.placement === 'independent_domain'
    const container = join(config.home,'domains',hostname), root = independent ? join(container,'public_html') : join(parent,input.label)
    if (roots.public_html !== parent || roots.subdomains[input.label]) throw denied()
    await safeStagePath(config.home, parent)
    if (independent) await safeStagePath(config.home,join(config.home,'domains'))
    // Even an existing empty directory is refused: this workflow owns only fresh targets.
    try { await lstat(independent ? container : root); throw denied() } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const inventory = await this.diagnostics.databases(serverId, 0, 100)
    if (inventory.total > 100 || inventory.databases.some(d => d.database === database)) throw denied()
    const versionText = await this.wp(serverId, parent, ['--version'])
    if (!/^WP-CLI 2\./.test(versionText)) throw new HostingError('WP_CLI_UNAVAILABLE', 'A supported WP-CLI 2.x runtime is required.')
    const response = await this.request('https://api.wordpress.org/core/version-check/1.7/', { redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new HostingError('WORDPRESS_VERSION_UNAVAILABLE', 'Could not pin a stable WordPress release.')
    const bytes = (await boundedBytes(response)).toString('utf8')
    if (bytes.length > 131072) throw denied()
    const version = z.string().regex(/^\d+\.\d+(?:\.\d+)?$/).parse(JSON.parse(bytes).offers?.find((v: {response: string}) => v.response === 'upgrade')?.version)
    return { root, version }
  }
  async createHosting(serverId: string, target: StageTarget) {
    if (target.placement === 'independent_domain') {
      await this.transport.postForm(serverId,'/CMD_API_DOMAIN',{action:'create',domain:target.hostname,uquota:'unlimited',ubandwidth:'unlimited',ssl:'ON',php:'ON',cgi:'OFF'})
      if (!(await this.hosting.listDomains(serverId)).domains.includes(target.hostname)) throw denied()
    } else {
      await this.transport.postForm(serverId,'/CMD_API_SUBDOMAINS',{action:'create',domain:target.domain,subdomain:target.label})
      if (!(await this.hosting.listSubdomains(serverId,target.domain)).subdomains.includes(target.hostname)) throw denied()
    }
  }
  private async mappedRoot(serverId:string,target:StageTarget,empty:boolean) {
    const config = this.config(serverId), independent = target.placement === 'independent_domain'
    const roots = await this.roots(serverId,independent ? target.hostname : target.domain)
    if ((independent ? roots.public_html : roots.subdomains[target.label]?.public_html) !== target.root) throw denied()
    await safeStagePath(config.home,target.root)
    if (empty && (await readdir(target.root)).length) throw denied()
  }
  async verifyRoot(serverId:string,target:StageTarget){return this.mappedRoot(serverId,target,true)}
  // Called only after this approved fresh job created the previously absent target.
  async prepareFreshRoot(serverId:string,target:StageTarget,id:string,checkpoint:(phase:string)=>void) {
    await this.mappedRoot(serverId,target,false)
    const config=this.config(serverId),snapshot=await snapshotTemplates(config.home,target.root)
    if(!snapshot.entries.length)return null
    checkpoint('backing_up_provider_templates')
    return preserveTemplates(config.home,target.root,id,snapshot,checkpoint)
  }
  async inspectRecovery(serverId:string,target:StageTarget) {
    const config=this.config(serverId)
    if(target.placement!=='independent_domain'||target.hostname!==target.label+'.'+target.domain||target.root!==join(config.home,'domains',target.hostname,'public_html'))throw denied()
    const domains=(await this.hosting.listDomains(serverId)).domains
    if(!domains.includes(target.domain)||!domains.includes(target.hostname)||(await this.hosting.listSubdomains(serverId,target.domain)).subdomains.includes(target.hostname))throw denied()
    if((await this.roots(serverId,target.hostname)).public_html!==target.root)throw denied()
    const inventory=await this.diagnostics.databases(serverId,0,100)
    if(inventory.total>100||inventory.databases.some(d=>d.database===target.database))throw denied()
    return snapshotTemplates(config.home,target.root)
  }
  async preserveTemplates(serverId:string,target:StageTarget,id:string,snapshot:TemplateSnapshot,checkpoint:(phase:string)=>void) {
    const config=this.config(serverId)
    if(JSON.stringify(await this.inspectRecovery(serverId,target))!==JSON.stringify(snapshot))throw denied()
    return preserveTemplates(config.home,target.root,id,snapshot,checkpoint)
  }
  async verifyTemplateBackup(serverId:string,target:StageTarget,id:string,snapshot:TemplateSnapshot) {
    return verifyPreservedTemplates(this.config(serverId).home,target.root,id,snapshot)
  }
  async verifyExistingDatabase(serverId:string,target:StageTarget,password:string,preparedCore=false) {
    const config=this.config(serverId)
    await this.mappedRoot(serverId,target,!preparedCore)
    if(preparedCore)await assertPreparedCore(config.home,target.root)
    const info=await this.diagnostics.databaseInfo(serverId,target.database)
    if([info.tableCount,info.eventCount,info.routineCount,info.triggerCount,info.viewCount].some(n=>n!==0)||info.userCount!==1)throw denied()
    const users=z.array(z.object({dbuser:z.string(),hostPatterns:z.array(z.string()),conflictingHosts:z.boolean()})).parse(JSON.parse(await this.transport.getText(serverId,`/api/db-show/databases/${encodeURIComponent(target.database)}/users`,{})))
    if(users.length!==1||users[0]!.dbuser!==target.database||users[0]!.conflictingHosts||JSON.stringify(users[0]!.hostPatterns)!==JSON.stringify(['localhost']))throw denied()
    // Fixed read-only proof, no caller PHP/SQL. Password is stdin, never argv/env/output.
    const php=`mysqli_report(MYSQLI_REPORT_OFF); $p=json_decode(stream_get_contents(STDIN),true); $c=@mysqli_connect('localhost',$p['user'],$p['password'],$p['database']); if(!$c)exit(2); $r=mysqli_query($c,'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()'); if(!$r||intval(mysqli_fetch_row($r)[0])!==0)exit(3); echo 'EMPTY_DATABASE_VERIFIED';`
    await new Promise<void>((resolve,reject)=>{
      const child=execFile(config.phpBinary,['-r',php],{cwd:config.home,timeout:15000,maxBuffer:4096,
        env:{HOME:config.home,PATH:dirname(config.phpBinary)+':/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'}},(error,stdout)=>
        error||stdout.trim()!=='EMPTY_DATABASE_VERIFIED'?reject(new HostingError('DATABASE_PROOF_FAILED','Local empty-database credential proof failed; no install was started.')):resolve())
      child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify({user:target.database,database:target.database,password}))
    })
  }
  async createDatabase(serverId: string, target: StageTarget, password: string) {
    await this.transport.createStageDatabase(serverId, target.database, password)
    await this.verifyExistingDatabase(serverId,target,password)
  }
  async install(serverId: string, target: StageTarget, secret: {databasePassword: string; adminPassword: string}, checkpoint: (phase: string) => void,preparedCore=false,planId?:string) {
    if(preparedCore){
      const config=this.config(serverId);await this.mappedRoot(serverId,target,false)
      if(!planId)throw denied()
      await repairDownloadedCore(config.home,target.root,target.version,planId,this.request,path=>this.wp(serverId,path,['core','verify-checksums','--version='+target.version,'--locale=en_US']),checkpoint,this.tar)
    }else{
    if(!planId)throw denied()
    await this.verifyRoot(serverId, target)
    await writeFile(join(target.root, '.htaccess'), 'Require all denied\n', {flag: 'wx', mode: 0o644})
    const config=this.config(serverId)
    await repairDownloadedCore(config.home,target.root,target.version,planId,this.request,path=>this.wp(serverId,path,['core','verify-checksums','--version='+target.version,'--locale=en_US']),checkpoint,this.tar,true)
    }
    checkpoint('verifying_core')
    await this.wp(serverId, target.root, ['core', 'verify-checksums', '--version=' + target.version, '--locale=en_US'])
    checkpoint('creating_config')
    await this.wp(serverId, target.root, ['config', 'create', '--dbname=' + target.database, '--dbuser=' + target.database, '--dbhost=localhost', '--dbprefix=wp_', '--prompt=dbpass'], secret.databasePassword + '\n')
    await chmod(join(target.root, 'wp-config.php'), 0o600)
    for (const [name, value] of [['WP_ENVIRONMENT_TYPE', 'staging'], ['DISABLE_WP_CRON', 'true'], ['DISALLOW_FILE_EDIT', 'true']])
      await this.wp(serverId, target.root, ['config', 'set', name!, value!, ...(value === 'true' ? ['--raw'] : [])])
    // Access and outbound-email policy exists before installing or serving WP.
    checkpoint('installing_stage_policy')
    const mu = join(target.root, 'wp-content', 'mu-plugins'); await mkdir(mu, {mode: 0o755})
    await writeFile(join(mu, 'seohost-stage.php'), `<?php\n/** Fresh staging policy. Managed by SeoHost MCP. */\nadd_filter('pre_wp_mail', '__return_false');\nadd_filter('pre_option_blog_public', '__return_zero');\nadd_action('template_redirect', function () { if (!is_user_logged_in()) { status_header(403); header('X-Robots-Tag: noindex, nofollow'); exit('Private staging site. Please log in.'); } });\n`, {flag: 'wx', mode: 0o644})
    checkpoint('installing_wordpress')
    await this.wp(serverId, target.root, ['core', 'install', '--url=https://' + target.hostname, '--title=' + target.title,
      '--admin_user=' + target.adminName, '--admin_email=' + target.adminEmail, '--skip-email', '--prompt=admin_password'], secret.adminPassword + '\n')
    await this.wp(serverId, target.root, ['option', 'update', 'blog_public', '0'])
    checkpoint('verifying_wordpress')
    await this.wp(serverId, target.root, ['core', 'is-installed'])
    if (await this.wp(serverId, target.root, ['core', 'version']) !== target.version
      || await this.wp(serverId, target.root, ['option', 'get', 'siteurl']) !== 'https://' + target.hostname
      || await this.wp(serverId, target.root, ['option', 'get', 'blog_public']) !== '0') throw denied()
    const guard = await lstat(join(target.root, '.htaccess'))
    if (!guard.isFile() || guard.isSymbolicLink()) throw denied()
    await writeFile(join(target.root, '.htaccess'), 'Options -Indexes\n', {mode: 0o644})
  }
}
