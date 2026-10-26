import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { z } from 'zod'
import type { Settings } from './config.js'
import type { AccessContext } from './auth.js'
import { resolveServer } from './config.js'
import { domainSchema } from './directadmin.js'
import { fingerprint } from './domain-dns.js'
import { ChangeStore, type StoredChange } from './change-store.js'
import type { TemplateSnapshot } from './wordpress-stage-recovery.js'
import { HostingError } from './hosting-error.js'
import { LocalStageProvider, safeStagePath, type StageProvider, type StageTarget } from './wordpress-stage-provider.js'

export const stageInput = z.object({ domain: domainSchema,
  placement: z.enum(['independent_domain','subdomain']).default('independent_domain'),
  label: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  adminEmail: z.string().email().max(254).refine(s => !/[\r\n\u0000]/.test(s)),
  adminName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/).default('stageadmin'),
  title: z.string().min(1).max(100).refine(s => !/[\u0000-\u001f\u007f]/.test(s)).default('WordPress staging'),
}).strict()
export type StagePayload = { kind: 'fresh_wordpress_stage'; target: StageTarget; previewHash: string; phase: string; source: null;
  overwrite: false; backup: string; publicAccess: string; adminCredentialReference?: string; recovery?: {fromPlanId:string;originalHash:string;snapshot:TemplateSnapshot} }
export const stagePayload = (c: StoredChange): StagePayload => {
  const p = c.payload as StagePayload
  if (p.kind !== 'fresh_wordpress_stage') throw new HostingError('PLAN_NOT_FOUND', 'This is not a fresh WordPress stage plan.')
  return p
}
export function stagePreview(change: StoredChange) {
  const p = stagePayload(change), {root: _root, ...target} = p.target
  return { serverId: change.serverId, planId: change.id, previewHash: p.previewHash, expiresAt: new Date(change.expires).toISOString(),
    status: change.status, phase: p.phase, target, source: p.source, overwrite: p.overwrite, backup: p.backup,
    recovery: p.recovery ? {fromPlanId:p.recovery.fromPlanId,templates:p.recovery.snapshot.entries.map(e=>({path:e.path,kind:e.kind,bytes:e.bytes,sha256:e.sha256})),bytes:p.recovery.snapshot.bytes} : null,
    publicAccess: p.publicAccess, code: change.code ?? null, result: change.result ?? null }
}
// Conservative shared DB/user budget; provider limits may be stricter. Never rename existing DBs.
export function stageDatabaseName(username: string, hostname: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new HostingError('CREDENTIALS_MISSING','A valid account identity is required.')
  domainSchema.parse(hostname)
  const budget = 32 - username.length - 1 - 1 - 8
  if (budget < 1) throw new HostingError('DATABASE_NAME_LIMIT','Account prefix leaves no readable database name within the supported limit.')
  const slug = hostname.replace(/[^a-z0-9]/g,'_').slice(0,budget).replace(/_+$/,'') || 'w'
  return username + '_' + slug + '_' + randomBytes(4).toString('hex')
}

// Browser owner only. Never call from an MCP result or expose database credentials.
async function retainedStageSecrets(settings: Settings, change: StoredChange) {
  const p = stagePayload(change), home = settings.accounts[change.serverId]?.wordpressProvisioning?.home
  if (!home || !/^[a-f0-9]{48}$/.test(change.id)
    || p.adminCredentialReference !== change.id) throw new HostingError('CREDENTIALS_UNAVAILABLE','Completed installation credentials are unavailable.')
  const dir = join(home,'.seohost-mcp-stage')
  try {
    await safeStagePath(home,dir)
    if ((await lstat(dir)).mode & 0o077) throw new Error()
    const file = await open(join(dir,change.id+'.json'),constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 4096) throw new Error()
      const bytes = Buffer.alloc(4097), {bytesRead} = await file.read(bytes,0,bytes.length,0)
      if (bytesRead > 4096) throw new Error()
      const secret = JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'))
      if (secret.hostname !== p.target.hostname || secret.database !== p.target.database || secret.adminName !== p.target.adminName
        || typeof secret.adminPassword !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(secret.adminPassword)
        || typeof secret.databasePassword !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(secret.databasePassword)) throw new Error()
      return {adminPassword:secret.adminPassword as string,databasePassword:secret.databasePassword as string}
    } finally {await file.close()}
  } catch {throw new HostingError('CREDENTIALS_UNAVAILABLE','Retained installation credentials could not be verified. Contact the operator.')}
}

export async function stageAdminPassword(settings:Settings,change:StoredChange) {
 if(change.status!=='applied'||stagePayload(change).phase!=='completed_locally')throw new HostingError('CREDENTIALS_UNAVAILABLE','Completed installation credentials are unavailable.')
 return (await retainedStageSecrets(settings,change)).adminPassword
}

export class WordPressStages {
  private readonly provider: StageProvider
  constructor(private readonly settings: Settings, request: typeof fetch = fetch, provider?: StageProvider) { this.provider = provider ?? new LocalStageProvider(settings, request) }
  private authorize(reference: string | number, access: AccessContext, enabled = true, placement: 'independent_domain'|'subdomain' = 'subdomain') {
    const {serverId, account} = resolveServer(this.settings.accounts, reference)
    if (!access.canWrite) throw new HostingError('WRITE_SCOPE_REQUIRED', 'Fresh-stage plans require write authorization.')
    if (enabled && (!account.wordpressProvisioning || ![placement === 'independent_domain' ? 'create_domain' : 'create_subdomain', 'create_wordpress_stage'].every(op => account.writeOperations?.includes(op as 'create_domain'))))
      throw new HostingError('WRITE_DISABLED', 'Enable local WordPress provisioning and both required operations explicitly.')
    if (enabled && !this.settings.localOAuth) throw new HostingError('OWNER_APPROVAL_UNAVAILABLE', 'Local owner login is required for the separate browser confirmation.')
    return serverId
  }
  store() { return new ChangeStore(this.settings.changeStateFile || 'data/changes.sqlite') }
  async plan(reference: string | number, input: unknown, access: AccessContext) {
    const value = stageInput.parse(input), serverId = this.authorize(reference, access,true,value.placement)
    domainSchema.parse(value.label + '.' + value.domain)
    const username = this.settings.credentials[serverId]?.username
    if (!username || !/^[a-zA-Z0-9_]+$/.test(username)) throw new HostingError('CREDENTIALS_MISSING', 'A valid account identity is required.')
    const database = stageDatabaseName(username, value.label + '.' + value.domain)
    const checked = await this.provider.preflight(serverId, value, database)
    const target = {...value, ...checked, hostname: value.label + '.' + value.domain, database}
    const payload: StagePayload = {kind:'fresh_wordpress_stage', target, phase:'awaiting_owner_confirmation',
      source:null, overwrite:false, backup:'verified_new_target_absence_no_existing_data_to_back_up',
      publicAccess:'Login required for frontend; no indexing, outbound WP mail or WP cron. DNS/TLS require separate verification; no parent TLS settings change.',
      previewHash:fingerprint({serverId, target, scope:'fresh_single_site_new_database_only'})}
    const store = this.store()
    try { const change = store.create({actor:access.actor, serverId, lockKey:serverId, expires:Date.now()+30*60000, payload})
      return {...stagePreview(change), approvalUrl: new URL('/wordpress-stage/' + change.id, this.settings.publicUrl).href,
        next:'Owner must log in and confirm the exact preview in the browser, then the same MCP actor may apply. Never automate owner consent.'}
    } finally {store.close()}
  }
  async planRecovery(reference:string|number,fromPlanId:string,access:AccessContext) {
    const serverId=this.authorize(reference,access,true,'independent_domain'),store=this.store()
    try {
      const original=store.get(fromPlanId,access.actor,serverId),old=stagePayload(original)
      if(original.status!=='unknown'||old.phase!=='creating_independent_domain'||original.code!=='WRITE_OUTCOME_UNKNOWN'||old.recovery||old.target.placement!=='independent_domain'||!store.isOwnerApproved(original,old.previewHash))
        throw new HostingError('RECOVERY_UNAVAILABLE','Only an approved independent-domain creation checkpoint with an unknown result can be reconciled.')
      if(!this.provider.inspectRecovery||!this.provider.preserveTemplates)throw new HostingError('RECOVERY_UNAVAILABLE','Local provider recovery is unavailable.')
      await retainedStageSecrets(this.settings,original)
      const snapshot=await this.provider.inspectRecovery(serverId,old.target)
      const recovery={fromPlanId,originalHash:old.previewHash,snapshot}
      const payload:StagePayload={...old,phase:'awaiting_recovery_confirmation',adminCredentialReference:undefined,recovery,
        backup:'Provider templates will be copied, checksum-verified and retained privately before relocation; no backup deletion.',
        previewHash:fingerprint({serverId,target:old.target,recovery,scope:'reconcile_created_domain_preserve_templates_install_missing_database_wordpress'})}
      const change=store.create({actor:access.actor,serverId,lockKey:serverId,expires:Date.now()+30*60000,payload})
      return {...stagePreview(change),approvalUrl:new URL('/wordpress-stage/'+change.id,this.settings.publicUrl).href,
        next:'Owner must review and approve this recovery snapshot in the browser. Existing unknown account lock remains until atomic reservation transfer. Never resend domain creation.'}
    }finally{store.close()}
  }
  get(reference: string | number, id: string, access: AccessContext) {
    const serverId = this.authorize(reference, access, false), store = this.store()
    try {return stagePreview(store.get(id, access.actor, serverId))} finally {store.close()}
  }
  async apply(reference: string | number, id: string, hash: string, access: AccessContext) {
    const serverId = this.authorize(reference, access,false), store = this.store()
    let change: StoredChange
    try {
      change = store.get(id,access.actor,serverId); const payload = stagePayload(change)
      this.authorize(reference,access,true,payload.target.placement ?? 'subdomain')
      if (payload.previewHash !== hash) throw new HostingError('PREVIEW_MISMATCH','The supplied preview does not match.')
      if (change.status === 'applied' || change.status === 'applying') return stagePreview(change)
      if (!store.isOwnerApproved(change, hash)) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','The owner must confirm this exact unexpired plan in the browser.')
      change = payload.recovery ? store.reserveStageRecovery(id,access.actor,serverId,hash) : store.reserve(id,access.actor,serverId,hash)
    } finally {store.close()}
    // Durable reservation precedes background work. Disconnect/cancellation never retries it.
    void this.run(change).catch(() => console.error('WordPress stage worker stopped; inspect persistent checkpoint'))
    return {...stagePreview(change), next:'Poll get_wordpress_stage sparingly. Interrupted/unknown operations keep the account lock; do not retry or delete data.'}
  }
  async continueInstall(reference:string|number,id:string,hash:string,access:AccessContext) {
    const serverId=this.authorize(reference,access,true,'independent_domain'),store=this.store()
    let change:StoredChange
    try {
      change=store.get(id,access.actor,serverId);const p=stagePayload(change)
      if(!p.recovery||p.previewHash!==hash||!store.isOwnerApproved(change,hash))throw new HostingError('OWNER_CONFIRMATION_REQUIRED','The existing exact recovery approval is required.')
      if(change.status==='applying'||change.status==='applied')return stagePreview(change)
      if(change.status!=='unknown'||change.code!=='WRITE_OUTCOME_UNKNOWN'||p.phase!=='creating_database'||p.adminCredentialReference!==id||!this.provider.verifyExistingDatabase||!this.provider.verifyTemplateBackup)
        throw new HostingError('INSTALL_CONTINUATION_UNAVAILABLE','This checkpoint cannot continue; do not retry provider creation.')
      const secret=await retainedStageSecrets(this.settings,change)
      await this.provider.verifyTemplateBackup(serverId,p.target,id,p.recovery.snapshot)
      await this.provider.verifyExistingDatabase(serverId,p.target,secret.databasePassword)
      change=store.reserveStageInstall(id,access.actor,serverId,hash)
    }finally{store.close()}
    void this.run(change,true).catch(()=>console.error('WordPress stage continuation stopped; inspect persistent checkpoint'))
    return stagePreview(change)
  }
  private async run(change: StoredChange,installationOnly=false) {
    const store = this.store(), payload = stagePayload(change), {target} = payload
    let mutated = Boolean(payload.recovery)
    const checkpoint = (phase: string) => {payload.phase=phase; store.checkpoint(change)}
    try {
      let secrets:{databasePassword:string;adminPassword:string}
      if(installationOnly){
        checkpoint('verifying_created_database')
        secrets=await retainedStageSecrets(this.settings,change)
        if(!payload.recovery||!this.provider.verifyTemplateBackup||!this.provider.verifyExistingDatabase)throw new HostingError('INSTALL_CONTINUATION_UNAVAILABLE','Continuation proof is unavailable.')
        await this.provider.verifyTemplateBackup(change.serverId,target,change.id,payload.recovery.snapshot)
        await this.provider.verifyExistingDatabase(change.serverId,target,secrets.databasePassword)
      }else{
      checkpoint('revalidating_target')
      const fresh = payload.recovery ? {root:target.root} : await this.provider.preflight(change.serverId,target,target.database)
      if (fresh.root !== target.root) throw new HostingError('STALE_PLAN','The target changed; prepare and confirm a new plan.')
      // Version is pinned by the reviewed plan, not silently updated on apply.
      const config = this.settings.accounts[change.serverId]!.wordpressProvisioning!, root = join(config.home,'.seohost-mcp-stage')
      try {await mkdir(root,{mode:0o700})} catch(e) {if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}
      await safeStagePath(config.home,root)
      const stat = await lstat(root); if(stat.mode & 0o077)throw new HostingError('PRIVATE_STORAGE_REQUIRED','Provisioning storage must be owner-only.')
      secrets=payload.recovery ? await retainedStageSecrets(this.settings,store.get(payload.recovery.fromPlanId,change.actor,change.serverId)) : {databasePassword:randomBytes(32).toString('base64url'),adminPassword:randomBytes(32).toString('base64url')}
      // Retain credentials for recovery outside web roots. Never return them through MCP.
      await writeFile(join(root,change.id+'.json'),JSON.stringify({hostname:target.hostname,database:target.database,adminName:target.adminName,...secrets}),{flag:'wx',mode:0o600})
      payload.adminCredentialReference=change.id
      if(payload.recovery){
        checkpoint('revalidating_recovery')
        if(!this.provider.inspectRecovery||!this.provider.preserveTemplates||JSON.stringify(await this.provider.inspectRecovery(change.serverId,target))!==JSON.stringify(payload.recovery.snapshot))throw new HostingError('RECOVERY_TARGET_CHANGED','The reviewed recovery snapshot changed; preserve the unknown lock.')
        checkpoint('backing_up_provider_templates')
        await this.provider.preserveTemplates(change.serverId,target,change.id,payload.recovery.snapshot,checkpoint)
      }else{
        checkpoint(target.placement === 'independent_domain' ? 'creating_independent_domain' : 'creating_subdomain');mutated=true
        await this.provider.createHosting(change.serverId,target)
      }
      checkpoint('verifying_empty_document_root'); await this.provider.verifyRoot(change.serverId,target)
      checkpoint('creating_database'); await this.provider.createDatabase(change.serverId,target,secrets.databasePassword)
      }
      await this.provider.install(change.serverId,target,secrets,checkpoint)
      checkpoint('completed_locally')
      store.finish(change,'applied',{hostname:target.hostname,siteUrl:'https://'+target.hostname,adminName:target.adminName,adminEmail:target.adminEmail,
        database:target.database,wordpressVersion:target.version,localInstallationVerified:true,publicDnsTlsHttp:'not_verified',
        adminCredentialReference:change.id,ownerResultUrl:new URL('/wordpress-stage/'+change.id,this.settings.publicUrl).href,credentials:'Retained in owner-only .seohost-mcp-stage/<reference>.json under the configured account home. Never publish this file.',
        providerTemplateBackupReference:payload.recovery ? change.id : null,
        backup:payload.recovery ? 'Provider templates retained with verified private copies and originals; no backups deleted.' : 'No existing target data; verified absence. No source copied. No backups deleted.',newDatabase:true,overwrite:false})
    } catch(e) {
      const code=e instanceof HostingError?e.code:'STAGE_FAILED'
      store.finish(change,mutated?'unknown':'failed',{phase:payload.phase,partialCompletionPossible:mutated,
        credentialReference:payload.adminCredentialReference??null,recovery:'Inspect provider inventory, checkpoint and retained private credentials. No automatic retry, rollback or deletion.'},code)
    } finally {store.close()}
  }
}
