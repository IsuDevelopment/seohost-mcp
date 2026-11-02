import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { mkdirSync, lstatSync, openSync, writeFileSync, fsyncSync, closeSync, constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { resolveServer, type Settings } from './config.js'
import type { AccessContext } from './auth.js'
import { DomainDnsClient, fingerprint } from './domain-dns.js'
import { domainSchema } from './directadmin.js'
import { ChangeStore, type StoredChange } from './change-store.js'
import { HostingError } from './hosting-error.js'

export const mailboxName = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/)
  .refine(value => !value.endsWith('.') && !value.includes('..') && !['error','text','details'].includes(value))
const quotaMiB = z.number().int().min(0).max(1048576)
const dailySendLimit = z.number().int().min(0).max(1000000)
export const mailboxTarget = z.object({ domain: domainSchema, user: mailboxName }).strict()
export const createMailboxInput = mailboxTarget.extend({ requestId: z.string().uuid(), quotaMiB: quotaMiB.default(1024), dailySendLimit: dailySendLimit.default(100) }).strict()
export const updateMailboxInput = mailboxTarget.extend({ requestId: z.string().uuid(), quotaMiB: quotaMiB.optional(), dailySendLimit: dailySendLimit.optional(), resetPassword: z.boolean().default(false) }).strict()
  .refine(value => value.quotaMiB !== undefined || value.dailySendLimit !== undefined || value.resetPassword, 'Select at least one setting or password reset.')
type Target = z.infer<typeof mailboxTarget>
type Input = Target & { requestId?: string; quotaMiB?: number; dailySendLimit?: number; resetPassword?: boolean }
type Operation = 'create_email_account' | 'update_email_account' | 'delete_email_account'
type Payload = { kind: 'mailbox_operation'; operation: Operation; input: Input; requestId?: string; requestHash?: string; snapshot?: string; previewHash?: string }
type Mailbox = { user: string; address: string; dailySendLimit: number; suspended: boolean }

function object(raw: string): Record<string, unknown> {
  try {
    const value: unknown = raw.trimStart().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))
    if (!value || typeof value !== 'object' || Array.isArray(value) || 'error' in value) throw Error()
    return value as Record<string, unknown>
  } catch { throw new HostingError('INVALID_RESPONSE', 'The provider did not return valid mailbox metadata.') }
}
function integer(value: unknown) {
  if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new HostingError('INVALID_RESPONSE', 'Missing or invalid mailbox quota/limit metadata.')
  return Number(value)
}

// Provider metadata only; no message contents, SMTP send, arbitrary paths or commands.
export class Mailboxes {
  private readonly domains: DomainDnsClient
  constructor(private readonly settings: Settings, request: typeof fetch = fetch) { this.domains = new DomainDnsClient(settings, request) }
  private authorize(reference: string | number, access: AccessContext, operation?: Operation) {
    const { serverId, account } = resolveServer(this.settings.accounts, reference)
    if (!access.canWrite) throw new HostingError('WRITE_SCOPE_REQUIRED', 'Mailbox writes and operation receipts require mcp:write.')
    if (operation && !account.writeOperations?.includes(operation)) throw new HostingError('WRITE_DISABLED', 'This mailbox operation is disabled for the selected account.')
    return serverId
  }
  private target(serverId: string, input: Target) {
    const target = mailboxTarget.parse(input)
    if (target.user === this.settings.credentials[serverId]?.username)
      throw new HostingError('SYSTEM_MAILBOX_REFUSED', 'The hosting system mailbox cannot be managed with these tools.')
    return target
  }
  private async inventory(serverId: string, domain: string): Promise<Mailbox[]> {
    await this.domains.owned(serverId, domain)
    const rows = object(await this.domains.transport.getText(serverId, '/CMD_API_POP', { domain, action: 'full_list', json: 'yes' }))
    if (Object.keys(rows).length > 2000) throw new HostingError('INVENTORY_LIMIT', 'Mailbox inventory exceeds the bounded account limit.')
    return Object.entries(rows).flatMap(([user, raw]) => {
      if (user === this.settings.credentials[serverId]?.username) return []
      if (!mailboxName.safeParse(user).success) throw new HostingError('INVALID_RESPONSE', 'Unexpected mailbox identity in provider inventory.')
      const value = typeof raw === 'string' ? object(raw) : raw as Record<string, unknown>
      if (!value || typeof value !== 'object' || !['yes','no','0','1',0,1,true,false].includes(value.suspended as string))
        throw new HostingError('INVALID_RESPONSE', 'Invalid mailbox status metadata.')
      return [{ user, address: user + '@' + domain, dailySendLimit: integer(value.limit), suspended: ['yes','1',1,true].includes(value.suspended as string) }]
    }).sort((a,b) => a.user.localeCompare(b.user))
  }
  async list(reference: string | number, inputDomain: string, offset = 0, limit = 50) {
    const { serverId } = resolveServer(this.settings.accounts, reference), domain = domainSchema.parse(inputDomain)
    const all = await this.inventory(serverId, domain)
    return { serverId, domain, total: all.length, accounts: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null, systemMailboxExcluded: true }
  }
  private async state(serverId: string, input: Target) {
    const mailbox = (await this.inventory(serverId, input.domain)).find(row => row.user === input.user)
    if (!mailbox) throw new HostingError('MAILBOX_NOT_FOUND', 'Select an existing mailbox from list_email_accounts.')
    const quota = object(await this.domains.transport.getText(serverId, '/CMD_API_POP', { ...input, type: 'quota', json: 'yes' }))
    return { ...mailbox, quotaBytes: integer(quota.quota), usageBytes: integer(quota.total_bytes) }
  }
  async configuration(reference: string | number, raw: Target) {
    const { serverId } = resolveServer(this.settings.accounts, reference), input = this.target(serverId, raw)
    const mailbox = await this.state(serverId, input)
    const xml = await this.domains.transport.getText(serverId, '/api/email-config/mobileconfig', { email: mailbox.address, format: 'xml' })
    // Match fixed scalar keys only. No XML entity resolution, external DTDs or returned password fields.
    const scalar = (key: string, type: 'string'|'integer'|'boolean') => {
      const values = [...xml.matchAll(new RegExp('<key>\\s*' + key + '\\s*</key>\\s*' + (type === 'boolean' ? '<(true|false)\\s*/>' : '<' + type + '>([^<]*)</' + type + '>'), 'g'))]
      if (values.length !== 1) throw new HostingError('EMAIL_CONFIG_UNAVAILABLE', 'The provider did not return unambiguous mail client settings.')
      return values[0]![1]!
    }
    const endpoint = (prefix: 'Incoming'|'Outgoing') => {
      const host = scalar(prefix + 'MailServerHostName', 'string'), port = integer(scalar(prefix + 'MailServerPortNumber', 'integer'))
      if (!domainSchema.safeParse(host).success || port < 1 || port > 65535 || scalar(prefix + 'MailServerUseSSL', 'boolean') !== 'true')
        throw new HostingError('EMAIL_CONFIG_UNAVAILABLE', 'Secure mail client settings could not be verified.')
      return { host, port, tls: true }
    }
    if (scalar('EmailAccountType', 'string') !== 'EmailTypeIMAP') throw new HostingError('EMAIL_CONFIG_UNAVAILABLE', 'The provider profile does not specify IMAP.')
    if (scalar('IncomingMailServerUsername','string') !== mailbox.address || scalar('OutgoingMailServerUsername','string') !== mailbox.address)
      throw new HostingError('EMAIL_CONFIG_UNAVAILABLE','The provider profile does not match this mailbox identity.')
    return { serverId, domain: input.domain, ...mailbox, username: mailbox.address, imap: endpoint('Incoming'), smtp: endpoint('Outgoing'), passwordIncluded: false, dnsDeliverability: 'not_checked' }
  }
  private store() { return new ChangeStore(this.settings.changeStateFile || 'data/changes.sqlite') }
  private payload(change: StoredChange) {
    const payload = change.payload as Payload
    if (payload.kind !== 'mailbox_operation') throw new HostingError('PLAN_NOT_FOUND', 'This is not a mailbox operation.')
    return payload
  }
  private receipt(change: StoredChange) {
    const payload = this.payload(change)
    return { serverId: change.serverId, operationId: change.id, operation: payload.operation, address: payload.input.user + '@' + payload.input.domain,
      status: change.status, code: change.code ?? null, result: change.result ?? null }
  }
  get(reference: string | number, id: string, access: AccessContext) {
    const serverId = this.authorize(reference, access), store = this.store()
    try { return this.receipt(store.get(id, access.actor, serverId)) } finally { store.close() }
  }
  async create(reference: string | number, raw: unknown, access: AccessContext) {
    return this.direct(reference, createMailboxInput.parse(raw), access, 'create_email_account')
  }
  async update(reference: string | number, raw: unknown, access: AccessContext) {
    return this.direct(reference, updateMailboxInput.parse(raw), access, 'update_email_account')
  }
  private async direct(reference: string | number, input: Input & {requestId:string}, access: AccessContext, operation: Operation) {
    const serverId = this.authorize(reference, access, operation)
    this.target(serverId, {domain:input.domain, user:input.user})
    const store = this.store()
    try {
      const requestHash = fingerprint({operation, input})
      const saved = store.mailboxRequest({ actor: access.actor, serverId, lockKey: serverId, expires: Date.now() + 600000,
        payload: {kind:'mailbox_operation', operation, input, requestId:input.requestId, requestHash} satisfies Payload }, input.requestId, requestHash)
      if (saved.status !== 'ready') return this.receipt(saved)
      return await this.execute(store, saved, access)
    } finally { store.close() }
  }
  async planDeletion(reference: string | number, raw: Target, access: AccessContext) {
    const serverId = this.authorize(reference, access, 'delete_email_account'), input = this.target(serverId, raw)
    const before = await this.state(serverId, input), snapshot = fingerprint(before)
    const payload: Payload = {kind:'mailbox_operation', operation:'delete_email_account', input, snapshot}
    payload.previewHash = fingerprint(payload)
    const store = this.store()
    try {
      const change = store.create({actor:access.actor, serverId, lockKey:serverId, expires:Date.now()+300000, payload})
      return {serverId, planId:change.id, previewHash:payload.previewHash, before, expiresAt:new Date(change.expires).toISOString(),
        warning:'Deleting this mailbox permanently removes its messages. No message backup is created by this tool.', confirmationRequired:'DELETE ' + before.address}
    } finally { store.close() }
  }
  async delete(reference: string | number, id: string, previewHash: string, confirmation: string, access: AccessContext) {
    const serverId = this.authorize(reference, access, 'delete_email_account'), store = this.store()
    try {
      const change = store.get(id, access.actor, serverId), payload = this.payload(change)
      if (payload.operation !== 'delete_email_account' || payload.previewHash !== previewHash || confirmation !== 'DELETE ' + payload.input.user + '@' + payload.input.domain)
        throw new HostingError('CONFIRMATION_REQUIRED', 'Show the exact deletion preview and obtain the user confirmation in chat before applying it.')
      if (change.status !== 'ready') return this.receipt(change)
      return await this.execute(store, change, access)
    } finally { store.close() }
  }
  private credential(change: StoredChange) {
    const directory = resolve(dirname(this.settings.changeStateFile || 'data/changes.sqlite'), 'mailbox-credentials')
    mkdirSync(directory, {recursive:true, mode:0o700})
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || process.geteuid && stat.uid !== process.geteuid()) throw new HostingError('CREDENTIAL_STORAGE_UNSAFE', 'Mailbox credentials require a private owner-only directory.')
    const file = resolve(directory, change.id + '.json'), password = 'M!' + randomBytes(24).toString('base64url') + '9a'
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, JSON.stringify({address:this.receipt(change).address, password}) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
    return {file, password}
  }
  private async execute(store: ChangeStore, saved: StoredChange, access: AccessContext) {
    const payload = this.payload(saved), {input, operation} = payload, serverId = saved.serverId
    let change: StoredChange | undefined, sent = false, credentialFile: string | undefined
    try {
      change = store.reserve(saved.id, access.actor, serverId)
      if (change.status === 'applied') return this.receipt(change)
      this.authorize(serverId, access, operation)
      const target = this.target(serverId, {domain:input.domain,user:input.user})
      let before: Awaited<ReturnType<Mailboxes['state']>> | undefined
      if (operation === 'create_email_account') {
        if ((await this.inventory(serverId, input.domain)).some(row => row.user === input.user)) throw new HostingError('MAILBOX_EXISTS', 'This mailbox already exists; creation never overwrites it.')
      } else before = await this.state(serverId, target)
      if (operation === 'delete_email_account' && fingerprint(before) !== payload.snapshot) throw new HostingError('STALE_PLAN', 'Mailbox state changed. Review and confirm a new deletion plan.')
      const credential = operation === 'create_email_account' || input.resetPassword ? this.credential(change) : undefined
      credentialFile = credential?.file
      const params: Record<string,string> = { ...target, action:operation === 'create_email_account' ? 'create' : operation === 'update_email_account' ? 'modify' : 'delete', json:'yes' }
      if (operation !== 'delete_email_account') {
        // DirectAdmin create uses MiB; modify uses bytes. Never silently alter an unspecified quota.
        params.quota = String(operation === 'create_email_account' ? input.quotaMiB! : input.quotaMiB === undefined ? before!.quotaBytes : input.quotaMiB * 1048576)
        if (input.dailySendLimit !== undefined) params.limit = String(input.dailySendLimit)
        if (credential) { params.passwd = credential.password; params.passwd2 = credential.password }
      }
      // Credentials/ownership already checked; any failure from this point can follow an effect.
      sent = true
      await this.domains.transport.postForm(serverId, '/CMD_API_POP', params)
      if (operation === 'delete_email_account') {
        if ((await this.inventory(serverId,input.domain)).some(row => row.user === input.user)) throw new HostingError('WRITE_OUTCOME_UNKNOWN', 'The deleted mailbox is still reported by the provider.')
      } else {
        const after = await this.state(serverId,target)
        if (after.quotaBytes !== (input.quotaMiB === undefined ? before!.quotaBytes : input.quotaMiB*1048576)
          || after.dailySendLimit !== (input.dailySendLimit ?? before!.dailySendLimit)
          || after.suspended !== (before?.suspended ?? false))
          throw new HostingError('WRITE_OUTCOME_UNKNOWN','Mailbox settings were not verified after the write.')
      }
      store.finish(change,'applied',{ settingsVerified:true, passwordSet:!!credential, ...(credential ? {credentialFile:credential.file, credentialDelivery:'Private file on the MCP host; retrieve through your authenticated hosting access. Never read it into chat.'} : {}), dnsChanged:false })
      return this.receipt(change)
    } catch (error) {
      if (!change) throw error
      store.finish(change, sent ? 'unknown' : 'failed', {detail:sent ? 'Inspect provider state and retained private credentials. Do not retry; the account write reservation is retained.' : 'No provider write was sent.', ...(credentialFile ? {credentialFile,passwordApplication:'unverified'} : {})}, error instanceof HostingError ? error.code : 'REQUEST_FAILED')
      return this.receipt(change)
    }
  }
}
