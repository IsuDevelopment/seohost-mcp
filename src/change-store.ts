import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { HostingError } from './hosting-error.js'

export interface StoredChange {
  id: string; actor: string; serverId: string; lockKey: string; expires: number
  status: 'ready' | 'applying' | 'applied' | 'failed' | 'unknown'
  payload: unknown; result?: Record<string, unknown>; code?: string
}
// Per-call connection: HTTP MCP instances are stateless; receipts/locks are not.
export class ChangeStore {
  private readonly db: DatabaseSync
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file); chmodSync(file, 0o600)
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, actor TEXT NOT NULL, server_id TEXT NOT NULL,
        lock_key TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS change_active_lock ON changes(lock_key) WHERE status IN ('applying','unknown');
      CREATE TABLE IF NOT EXISTS stage_approvals (id TEXT PRIMARY KEY, actor TEXT NOT NULL, server_id TEXT NOT NULL, hash TEXT NOT NULL, approved_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stage_challenges (token TEXT PRIMARY KEY, id TEXT NOT NULL, phase TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stage_owner_sessions (token TEXT PRIMARY KEY, binding TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stage_login_failures (id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL, reset INTEGER NOT NULL);` )
  }
  close() { this.db.close() }
  create(data: Omit<StoredChange, 'id' | 'status'>) {
    this.db.prepare("DELETE FROM changes WHERE (status='ready' AND expires < ?) OR (status IN ('applied','failed') AND created < ?)")
      .run(Date.now(), Date.now() - 7 * 86400000)
    this.db.exec('DELETE FROM stage_approvals WHERE id NOT IN (SELECT id FROM changes)')
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM changes').get() as { count: number }
    if (count.count >= 200) throw new HostingError('PLAN_LIMIT', 'Too many retained changes; inspect pending/unknown operations before creating more.')
    const change: StoredChange = { ...data, id: randomBytes(24).toString('hex'), status: 'ready' }
    this.db.prepare('INSERT INTO changes VALUES (?,?,?,?,?,?,?,?)')
      .run(change.id, change.actor, change.serverId, change.lockKey, change.expires, Date.now(), change.status, JSON.stringify(change))
    return change
  }
  get(id: string, actor: string, serverId: string) {
    const row = this.db.prepare('SELECT value FROM changes WHERE id=? AND actor=? AND server_id=?').get(id, actor, serverId) as { value: string } | undefined
    if (!row) throw new HostingError('PLAN_NOT_FOUND', 'No matching change belongs to this caller and account.')
    return JSON.parse(row.value) as StoredChange
  }
  reserve(id: string, actor: string, serverId: string, ownerHash?: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const change = this.get(id, actor, serverId)
      if (change.status === 'applied') { this.db.exec('COMMIT'); return change }
      if (change.status !== 'ready') throw new HostingError('PLAN_NOT_READY', 'This change is already running, failed or uncertain. Do not resend the write.')
      if (change.expires <= Date.now()) throw new HostingError('PLAN_EXPIRED', 'Prepare and review a new change preview.')
      if (ownerHash && !this.isOwnerApproved(change, ownerHash)) throw new HostingError('OWNER_CONFIRMATION_REQUIRED', 'The exact owner approval is required at reservation time.')
      const busy = this.db.prepare("SELECT id FROM changes WHERE lock_key=? AND status IN ('applying','unknown')").get(change.lockKey)
      if (busy) throw new HostingError('CHANGE_BUSY', 'This zone/account has a running or uncertain write; reconcile it before proceeding.')
      change.status = 'applying'
      this.db.prepare("UPDATE changes SET status='applying',value=? WHERE id=?").run(JSON.stringify(change), id)
      this.db.exec('COMMIT'); return change
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  reserveStageRecovery(id:string,actor:string,serverId:string,hash:string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const change=this.get(id,actor,serverId)
      const payload=change.payload as {kind?:string;target?:unknown;recovery?:{fromPlanId:string;originalHash:string}}
      if(change.status!=='ready'||change.expires<=Date.now()||payload.kind!=='fresh_wordpress_stage'||!payload.recovery||!this.isOwnerApproved(change,hash))
        throw new HostingError('OWNER_CONFIRMATION_REQUIRED','An exact unexpired ready recovery approval is required.')
      const original=this.get(payload.recovery.fromPlanId,actor,serverId),old=original.payload as {kind?:string;phase?:string;target?:unknown;previewHash?:string;recovery?:unknown}
      if(original.status!=='unknown'||original.lockKey!==change.lockKey||old.kind!=='fresh_wordpress_stage'||old.phase!=='creating_independent_domain'||old.recovery||original.code!=='WRITE_OUTCOME_UNKNOWN'||old.previewHash!==payload.recovery.originalHash||JSON.stringify(old.target)!==JSON.stringify(payload.target)||!this.isOwnerApproved(original,payload.recovery.originalHash))
        throw new HostingError('RECOVERY_UNAVAILABLE','Original unknown reservation no longer matches this recovery.')
      // Transfer the existing reservation atomically; never clear a lock between operations.
      this.finish(original,'failed',{...original.result,reconciledByRecoveryPlan:id},'RECOVERY_SUPERSEDED')
      change.status='applying'
      this.db.prepare("UPDATE changes SET status='applying',value=? WHERE id=?").run(JSON.stringify(change),id)
      this.db.exec('COMMIT');return change
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  getForOwner(id: string, allowApplied = false) {
    const row = this.db.prepare('SELECT value FROM changes WHERE id=?').get(id) as {value:string}|undefined
    if (!row) throw new HostingError('PLAN_NOT_FOUND','Plan unavailable.')
    const c = JSON.parse(row.value) as StoredChange
    if (!((c.status === 'ready' && c.expires > Date.now()) || (allowApplied && c.status === 'applied')) || (c.payload as {kind?:string}).kind !== 'fresh_wordpress_stage')
      throw new HostingError('PLAN_NOT_READY','Plan expired or no longer awaiting approval.')
    return c
  }
  ownerChallenge(id: string, phase: 'login'|'review') {
    this.getForOwner(id, phase === 'login')
    this.db.prepare('DELETE FROM stage_challenges WHERE expires<?').run(Date.now())
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM stage_challenges').get() as {n:number}
    if (count.n >= 100) throw new HostingError('PLAN_LIMIT','Too many pending owner sessions.')
    const token = randomBytes(32).toString('hex')
    this.db.prepare('INSERT INTO stage_challenges VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,phase,Date.now()+300000)
    return token
  }
  consumeOwnerChallenge(id: string, token: string, phase: 'login'|'review') {
    const result = this.db.prepare('DELETE FROM stage_challenges WHERE token=? AND id=? AND phase=? AND expires>?')
      .run(createHash('sha256').update(token).digest('hex'),id,phase,Date.now())
    if (result.changes !== 1) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid or expired owner session.')
    return this.getForOwner(id, phase === 'login')
  }
  createOwnerSession(binding: string, previous = '') {
    this.db.prepare('DELETE FROM stage_owner_sessions WHERE expires<=?').run(Date.now())
    if (previous) this.revokeOwnerSession(previous)
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM stage_owner_sessions').get() as {n:number}
    if (count.n >= 100) throw new HostingError('OWNER_LOGIN_LIMIT','Too many owner browser sessions; sign out or wait for expiry.')
    const token = randomBytes(32).toString('hex'), expires = Date.now() + 8 * 3600000
    this.db.prepare('INSERT INTO stage_owner_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),binding,expires)
    return {token,expires}
  }
  ownerSession(token: string, binding: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined
    const row = this.db.prepare('SELECT expires FROM stage_owner_sessions WHERE token=? AND binding=? AND expires>?')
      .get(createHash('sha256').update(token).digest('hex'),binding,Date.now()) as {expires:number}|undefined
    return row
  }
  revokeOwnerSession(token: string) {
    this.db.prepare('DELETE FROM stage_owner_sessions WHERE token=?').run(createHash('sha256').update(token).digest('hex'))
  }
  ownerLoginAttempt() {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.db.prepare('SELECT attempts,reset FROM stage_login_failures WHERE id=1').get() as {attempts:number;reset:number}|undefined
      const next = old && old.reset > Date.now() ? {...old,attempts:old.attempts+1} : {attempts:1,reset:Date.now()+60000}
      if (next.attempts > 5) throw new HostingError('OWNER_LOGIN_LIMIT','Too many owner login attempts; wait one minute.')
      this.db.prepare('INSERT OR REPLACE INTO stage_login_failures VALUES(1,?,?)').run(next.attempts,next.reset)
      this.db.exec('COMMIT')
    } catch(e) {this.db.exec('ROLLBACK');throw e}
  }
  approveOwner(change: StoredChange, hash: string) {
    this.getForOwner(change.id)
    if ((change.payload as {previewHash:string}).previewHash !== hash) throw new HostingError('PREVIEW_MISMATCH','The reviewed plan changed.')
    this.db.prepare('INSERT OR REPLACE INTO stage_approvals VALUES(?,?,?,?,?)').run(change.id,change.actor,change.serverId,hash,Date.now())
  }
  denyOwner(id: string) { this.getForOwner(id); this.db.prepare('DELETE FROM stage_approvals WHERE id=?').run(id) }
  isOwnerApproved(change: StoredChange, hash: string) {
    return Boolean(this.db.prepare('SELECT id FROM stage_approvals WHERE id=? AND actor=? AND server_id=? AND hash=?')
      .get(change.id,change.actor,change.serverId,hash))
  }
  checkpoint(change: StoredChange) {
    this.db.prepare('UPDATE changes SET value=? WHERE id=?').run(JSON.stringify(change), change.id)
  }
  finish(change: StoredChange, status: 'applied' | 'failed' | 'unknown', result?: Record<string, unknown>, code?: string) {
    change.status = status; change.result = result; change.code = code
    this.db.prepare('UPDATE changes SET status=?,value=? WHERE id=?').run(status, JSON.stringify(change), change.id)
  }
}
