import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
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
      CREATE UNIQUE INDEX IF NOT EXISTS change_active_lock ON changes(lock_key) WHERE status IN ('applying','unknown');`)
  }
  close() { this.db.close() }
  create(data: Omit<StoredChange, 'id' | 'status'>) {
    this.db.prepare("DELETE FROM changes WHERE (status='ready' AND expires < ?) OR (status IN ('applied','failed') AND created < ?)")
      .run(Date.now(), Date.now() - 7 * 86400000)
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
  reserve(id: string, actor: string, serverId: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const change = this.get(id, actor, serverId)
      if (change.status === 'applied') { this.db.exec('COMMIT'); return change }
      if (change.status !== 'ready') throw new HostingError('PLAN_NOT_READY', 'This change is already running, failed or uncertain. Do not resend the write.')
      if (change.expires <= Date.now()) throw new HostingError('PLAN_EXPIRED', 'Prepare and review a new change preview.')
      const busy = this.db.prepare("SELECT id FROM changes WHERE lock_key=? AND status IN ('applying','unknown')").get(change.lockKey)
      if (busy) throw new HostingError('CHANGE_BUSY', 'This zone/account has a running or uncertain write; reconcile it before proceeding.')
      change.status = 'applying'
      this.db.prepare("UPDATE changes SET status='applying',value=? WHERE id=?").run(JSON.stringify(change), id)
      this.db.exec('COMMIT'); return change
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  finish(change: StoredChange, status: 'applied' | 'failed' | 'unknown', result?: Record<string, unknown>, code?: string) {
    change.status = status; change.result = result; change.code = code
    this.db.prepare('UPDATE changes SET status=?,value=? WHERE id=?').run(status, JSON.stringify(change), change.id)
  }
}
