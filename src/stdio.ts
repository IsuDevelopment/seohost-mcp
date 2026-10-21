import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadSettings } from './config.js'
import { createMcpServer } from './server.js'
try {
  const server = createMcpServer(await loadSettings(process.env, false))
  await server.connect(new StdioServerTransport())
} catch {
  console.error('MCP startup failed; check configuration and config file')
  process.exitCode = 1
}
