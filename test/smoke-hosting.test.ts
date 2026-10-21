import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const execute = promisify(execFile)
const privateText = 'private-log-and-provider-error-marker'
const token = 'private-smoke-test-bearer-token'

test('hosting smoke uses explicit selection and prints counts, never provider logs or error payloads', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  let deny = false
  const http = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    const mcp = new McpServer({ name: 'smoke-fixture', version: '1' })
    for (const name of ['list_domains', 'list_subdomains', 'read_web_log']) {
      mcp.registerTool(name, { inputSchema: { serverId: z.string(), domain: z.string().optional(), logType: z.enum(['access', 'error']).optional(), lines: z.number().optional() } }, async args => {
        calls.push({ name, args })
        const error = deny && name === 'read_web_log'
        const data = error ? { error: { code: privateText, message: privateText } }
          : name === 'list_domains' ? { domains: ['site.example', 'other.example'] }
          : name === 'list_subdomains' ? { subdomains: ['blog.site.example'] }
          : { lines: [privateText], returnedLines: 1, truncated: false }
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(error ? { isError: true } : {}) }
      })
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    response.once('close', () => { void mcp.close() })
    await mcp.connect(transport)
    await transport.handleRequest(request, response)
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  assert(address && typeof address !== 'string')
  const env = { PATH: process.env.PATH, MCP_AUTH_TOKEN: token, MCP_PUBLIC_URL: `http://127.0.0.1:${address.port}/mcp` }
  const args = ['scripts/smoke-hosting.mjs', '--server', 'primary', '--domain', 'site.example']
  try {
    const result = await execute(process.execPath, args, { env, timeout: 15000 })
    const summaries = result.stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(summaries.length, 4)
    assert.equal(summaries[0].count, 2)
    assert.equal(summaries[1].count, 1)
    assert.deepEqual(summaries.slice(2).map(value => value.logType), ['access', 'error'])
    assert(summaries.every(value => value.ok))
    assert(calls.every(call => call.args.serverId === 'primary'))
    assert(calls.slice(1).every(call => call.args.domain === 'site.example'))
    assert(calls.slice(2).every(call => call.args.lines === 5))
    for (const value of [privateText, token, 'blog.site.example']) assert(!(result.stdout + result.stderr).includes(value))

    deny = true
    await assert.rejects(execute(process.execPath, args, { env, timeout: 15000 }), (error: unknown) => {
      const failure = error as Error & { code: number; stdout: string; stderr: string }
      assert.equal(failure.code, 1)
      assert(failure.stdout.includes('HOSTING_READ_FAILED'))
      assert(!(failure.stdout + failure.stderr).includes(privateText))
      assert(!(failure.stdout + failure.stderr).includes(token))
      return true
    })

    const before = calls.length
    await assert.rejects(execute(process.execPath, ['scripts/smoke-hosting.mjs', '--server', 'primary'], { env, timeout: 15000 }))
    assert.equal(calls.length, before, 'missing explicit domain must cause no hosting calls')
    await assert.rejects(execute(process.execPath, ['scripts/smoke-hosting.mjs', '--server', 'primary', '--domain', 'foreign.example'], { env, timeout: 15000 }))
    assert.equal(calls.length, before + 1, 'foreign domain must stop after inventory')
  } finally {
    http.closeAllConnections()
    await new Promise<void>(resolve => http.close(() => resolve()))
  }
})
