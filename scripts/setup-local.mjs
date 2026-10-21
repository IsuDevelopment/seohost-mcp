import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
try {
  await writeFile('.env', `HOST=127.0.0.1\nPORT=3000\nMCP_PUBLIC_URL=http://127.0.0.1:3000/mcp\nMCP_CONFIG_FILE=config/servers.example.json\nMCP_AUTH_TOKEN=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 })
  console.error('Created local .env with a random MCP token. Existing files are never overwritten.')
} catch (error) {
  if (error.code === 'EEXIST') console.error('.env already exists; left unchanged.')
  else throw error
}
