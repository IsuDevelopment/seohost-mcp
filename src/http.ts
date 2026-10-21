import { createServer, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createLocalOAuth } from './local-oauth.js'
import { createAuthenticator, type AccessContext } from './auth.js'
import { loadSettings, type Settings } from './config.js'
import { createMcpServer, VERSION } from './server.js'
import { pathToFileURL } from 'node:url'

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

export function createHttpServer(settings: Settings) {
  const authenticate = createAuthenticator(settings)
  const localOAuth = settings.localOAuth ? createLocalOAuth(settings.localOAuth, settings.publicUrl) : undefined
  const httpServer = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const path = request.url?.split('?')[0]
    if (path && ['/mcp', '/oauth/register', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/api/mcp/oauth-protected-resource'].includes(path)) {
      response.once('finish', () => {
        // Fixed route and bounded method only: no headers, query, body, tokens or user data.
        const method = ['GET', 'POST', 'OPTIONS', 'HEAD', 'DELETE'].includes(request.method || '') ? request.method : 'OTHER'
        console.error(`MCP request ${method} ${path} ${response.statusCode}`)
      })
    }
    // Compare the actual Host, never untrusted X-Forwarded-Host.
    if (request.headers.host !== settings.publicUrl.host) return json(response, 403, { error: 'Invalid host' })
    if (request.headers.origin && !settings.allowedOrigins.has(request.headers.origin)) return json(response, 403, { error: 'Invalid origin' })
    try {
      if (localOAuth && await localOAuth.handle(request, response)) return
    } catch {
      console.error('OAuth request failed')
      if (!response.headersSent) json(response, 500, { error: 'Internal server error' })
      else response.end()
      return
    }
    if (path === '/healthz' && request.method === 'GET') return json(response, 200, { status: 'ok', version: VERSION })
    if (path === '/.well-known/oauth-protected-resource/mcp' || path === '/api/mcp/oauth-protected-resource') {
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return json(response, 405, { error: 'Method not allowed' }) }
      if (!settings.oauth && !localOAuth) return json(response, 503, { error: 'OAuth not configured' })
      return json(response, 200, { resource: settings.publicUrl.href, authorization_servers: [settings.oauth?.issuer || settings.publicUrl.origin], scopes_supported: ['mcp:read', ...(Object.values(settings.accounts).some(account => account.writeOperations?.length) ? ['mcp:write'] : [])], bearer_methods_supported: ['header'] })
    }
    if (path !== '/mcp') return json(response, 404, { error: 'Not found' })
    let authorized: AccessContext | undefined
    try {
      authorized = await authenticate(request) || localOAuth?.authorize(request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1] || '')
    } catch {
      return json(response, 503, { error: 'Authentication temporarily unavailable' })
    }
    if (!authorized) {
      response.setHeader('WWW-Authenticate', settings.oauth || localOAuth
        ? `Bearer resource_metadata="${settings.publicUrl.origin}/api/mcp/oauth-protected-resource"`
        : 'Bearer realm="seohost-mcp"')
      return json(response, 401, { error: 'Unauthorized' })
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      return json(response, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Stateless endpoint supports POST only' }, id: null })
    }
    const server = createMcpServer(settings, fetch, authorized)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 131072 })
    // SDK handleRequest may finish before the response body is flushed.
    response.once('close', () => { void server.close().catch(() => console.error('MCP cleanup failed')) })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response)
    } catch {
      console.error('MCP request failed')
      if (!response.headersSent) json(response, 500, { error: 'Internal server error' })
      else response.end()
      await server.close()
    }
  })
  httpServer.once('close', () => localOAuth?.close())
  return httpServer
}

export async function startHttpServer() {
  const settings = await loadSettings()
  const server = createHttpServer(settings)
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.listen(settings.port, settings.host, () => console.error('SeoHost MCP HTTP started'))
  const stop = () => { server.close(); setTimeout(() => process.exit(1), 10_000).unref() }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer().catch(() => { console.error('MCP startup failed; check configuration and config file'); process.exitCode = 1 })
}
