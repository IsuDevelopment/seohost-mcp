import { readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { resolveServer } from '../dist/src/config.js'

if (!process.stdin.isTTY) throw new Error('Run setup:hosting in an interactive terminal; never paste credentials into chat.')
const file = process.argv[2] || '.env.production'
const original = await readFile(file, 'utf8')
const configFile = 'config/servers.json'
const { servers } = JSON.parse(await readFile(configFile, 'utf8'))
for (const account of Object.values(servers)) account.aliases ??= []
let muted = false
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback() } })
const rl = createInterface({ input: process.stdin, output, terminal: true })
let temporary
try {
  console.log('Configure an EXISTING DirectAdmin username and Login Key. The key is hidden and saved only in the private environment file.')
  console.log('Configured server IDs: ' + Object.keys(servers).join(', '))
  const reference = (await rl.question('Server ID or alias: ')).trim()
  const { serverId, account } = resolveServer(servers, reference)
  const username = (await rl.question(`DirectAdmin username for ${serverId}: `)).trim()
  if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(username)) throw new Error('Invalid DirectAdmin username')
  process.stdout.write('Existing Login Key (hidden): ')
  muted = true
  const key = await rl.question('')
  muted = false; process.stdout.write('\n')
  if (!key || /[\r\n\u0000]/.test(key)) throw new Error('Invalid Login Key')
  const quote = ["'", '"', '`'].find(q => !key.includes(q))
  if (!quote) throw new Error('This Login Key cannot be represented safely in an env file; use a process environment variable instead.')
  for (const name of [account.usernameEnv, account.loginKeyEnv]) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid credential environment variable name')
  const replaced = new Set(['MCP_CONFIG_FILE', account.usernameEnv, account.loginKeyEnv])
  const clean = original.split('\n').filter(line => !replaced.has(line.split('=')[0]?.trim())).join('\n').trimEnd()
  const text = `${clean}\nMCP_CONFIG_FILE=${configFile}\n${account.usernameEnv}=${username}\n${account.loginKeyEnv}=${quote}${key}${quote}\n`
  temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
  await rename(temporary, file); temporary = undefined
  await chmod(file, 0o600)
  console.log(`Saved credentials for ${serverId} in ${file}. Restart/deploy the MCP application to apply. No hosting changes were performed.`)
} finally {
  muted = false; rl.close()
  if (temporary) await unlink(temporary).catch(() => {})
}
