import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadSettings } from './config.js'
import { createMcpServer } from './server.js'
import { DatabaseExports } from './database-exports.js'
try {
  const settings = await loadSettings(process.env, false)
  const stopCleanup = new DatabaseExports(settings).startCleanup()
  const server = createMcpServer(settings, fetch, { actor: 'stdio-owner', canWrite: true })
  server.server.onclose = stopCleanup
  await server.connect(new StdioServerTransport())
} catch {
  console.error('MCP startup failed; check configuration and config file')
  process.exitCode = 1
}
