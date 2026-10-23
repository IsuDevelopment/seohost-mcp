import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { open, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// No shell commands or provider credentials. Reuse the owner's existing MCP read token.
const args = process.argv.slice(2), options = {}
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]
  if (!['--server', '--site', '--database', '--output'].includes(key) || !args[i + 1] || key in options)
    throw new Error('Usage: download-database --server ID (--site SITE_ID | --database DB_NAME) --output private.sql.gz')
  options[key] = args[i + 1]
}
if (!options['--server'] || !options['--output'] || Boolean(options['--site']) === Boolean(options['--database']))
  throw new Error('Specify server, exactly one site/database, and an output file outside a public directory.')
const token = process.env.MCP_AUTH_TOKEN
if (!token) throw new Error('Configure MCP_AUTH_TOKEN privately before downloading.')
const endpoint = new URL(process.env.MCP_PUBLIC_URL || 'http://127.0.0.1:3000/mcp')
if (endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
  || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))))
  throw new Error('Use an HTTPS MCP endpoint (HTTP is allowed only on loopback).')
const headers = { Authorization: `Bearer ${token}` }
const client = new Client({ name: 'seohost-database-download', version: '1' })
let file, complete = false
try {
  // Refuse overwrites before contacting hosting; never replace an existing backup or symlink.
  file = await open(options['--output'], 'wx', 0o600)
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers, redirect: 'error' } }))
  const result = await client.callTool({ name: 'export_database', arguments: { serverId: options['--server'],
    ...(options['--site'] ? { siteId: options['--site'] } : { database: options['--database'] }) } }, undefined, { timeout: 180_000 })
  const artifact = result.structuredContent
  if (result.isError || !artifact || typeof artifact.exportId !== 'string' || !/^[a-f0-9]{48}$/.test(artifact.exportId)
    || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || artifact.sizeBytes > 100 * 1024 * 1024)
    throw new Error('Export failed or returned invalid metadata. Check MCP configuration and account permissions.')
  const url = new URL(artifact.downloadUrl)
  if (url.origin !== endpoint.origin || url.pathname !== `/exports/${artifact.exportId}` || url.username || url.password || url.search || url.hash)
    throw new Error('Refusing an unexpected download location.')
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) })
  if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error('Download was unavailable.') }
  const hash = createHash('sha256'), reader = response.body.getReader()
  let bytes = 0
  async function* chunks() {
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) return
        bytes += part.value.byteLength
        if (bytes > artifact.sizeBytes) throw new Error('Unexpected download size.')
        hash.update(part.value); yield part.value
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  await pipeline(Readable.from(chunks()), file.createWriteStream())
  if (bytes !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256) throw new Error('Download integrity check failed.')
  complete = true
  console.log(`PASS: private database gzip saved; ${bytes} bytes; SHA-256 verified. Entire database exported.`)
} catch {
  console.error('Database download failed. Check selection, private output path, MCP configuration and account permissions. Existing files were preserved.')
  process.exitCode = 1
} finally {
  await file?.close()
  if (file && !complete) await unlink(options['--output']).catch(() => {})
  await client.close()
}
