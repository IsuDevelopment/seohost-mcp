import { parseArgs } from 'node:util'
import { domainToASCII } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Explicit opt-in to live hosting reads. Never print tool payloads or error text.
const safeCodes = new Set(['ACCESS_DENIED', 'CREDENTIALS_MISSING', 'DOMAIN_NOT_ON_SERVER', 'UNKNOWN_SERVER', 'CONNECTION_FAILED', 'INVALID_RESPONSE', 'RESPONSE_TOO_LARGE', 'NOT_FOUND', 'UPSTREAM_HTTP_ERROR', 'REQUEST_FAILED'])
const client = new Client({ name: 'seohost-hosting-smoke', version: '1.0.0' })
try {
  const { values } = parseArgs({ options: { server: { type: 'string' }, domain: { type: 'string' } }, strict: true, allowPositionals: false })
  const domain = domainToASCII((values.domain || '').trim().toLowerCase())
  if (!values.server?.trim() || values.server.length > 100 || !domain || domain.length > 253 || domain.split('.').length < 2
    || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    throw new Error('Invalid arguments')
  const url = new URL(process.env.MCP_PUBLIC_URL)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp'
    || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || !process.env.MCP_AUTH_TOKEN) throw new Error('Invalid configuration')
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } }))
  async function call(name, extra, summarize) {
    const result = await client.callTool({ name, arguments: { serverId: values.server, ...extra } })
    if (result.isError) {
      const code = result.structuredContent?.error?.code
      console.log(JSON.stringify({ tool: name, ...(extra.logType ? { logType: extra.logType } : {}), ok: false, code: safeCodes.has(code) ? code : 'HOSTING_READ_FAILED' }))
      process.exitCode = 1
      return
    }
    const summary = summarize(result.structuredContent)
    console.log(JSON.stringify({ tool: name, ...(extra.logType ? { logType: extra.logType } : {}), ok: true, ...summary }))
    return result.structuredContent
  }
  const inventory = await call('list_domains', {}, data => {
    if (!Array.isArray(data?.domains) || !data.domains.every(value => typeof value === 'string')) throw new Error('Invalid inventory')
    return { count: data.domains.length }
  })
  if (inventory) {
    if (!inventory.domains.includes(domain)) {
      console.log(JSON.stringify({ ok: false, code: 'DOMAIN_NOT_ON_SERVER' }))
      process.exitCode = 1
    } else {
      await call('list_subdomains', { domain }, data => {
        if (!Array.isArray(data?.subdomains)) throw new Error('Invalid inventory')
        return { count: data.subdomains.length }
      })
      for (const logType of ['access', 'error']) {
        await call('read_web_log', { domain, logType, lines: 5 }, data => {
          if (!Number.isSafeInteger(data?.returnedLines) || data.returnedLines < 0 || data.returnedLines > 5 || typeof data.truncated !== 'boolean')
            throw new Error('Invalid log result')
          return { returnedLines: data.returnedLines, empty: data.returnedLines === 0, truncated: data.truncated }
        })
      }
    }
  }
} catch {
  console.error('FAIL: hosting smoke could not complete. Supply --server and --domain, MCP_PUBLIC_URL and MCP_AUTH_TOKEN; check target configuration. Details suppressed.')
  process.exitCode = 1
} finally {
  await client.close().catch(() => { process.exitCode = 1 })
}
