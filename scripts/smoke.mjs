import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
const url = new URL(process.env.MCP_PUBLIC_URL || 'http://127.0.0.1:3000/mcp')
if (!process.env.MCP_AUTH_TOKEN) throw new Error('Set MCP_AUTH_TOKEN for this smoke test')
const client = new Client({ name: 'seohost-mcp-smoke', version: '0.1.0' })
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } } }))
  const { tools } = await client.listTools()
  if (tools.length !== 8) throw new Error('Unexpected tools list')
  const result = await client.callTool({ name: 'get_server_info', arguments: {} })
  if (result.isError || result.structuredContent?.hostingWritesEnabled !== false) throw new Error('Unexpected server status')
  console.log('PASS: MCP initialize, tools/list, get_server_info. No hosting actions performed.')
} finally { await client.close() }
