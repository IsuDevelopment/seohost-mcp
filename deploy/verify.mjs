const publicUrl = new URL(process.env.MCP_PUBLIC_URL || '')
if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/mcp' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error('Expected an HTTPS MCP_PUBLIC_URL ending in /mcp')
const expectedVersion = process.argv[2]
let healthy = false
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(new URL('/healthz', publicUrl), { redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' })
    const body = await response.json()
    healthy = response.ok && body.status === 'ok' && body.version === expectedVersion
    if (healthy) break
  } catch { /* Give this application's restart time to complete. */ }
  await new Promise(resolve => setTimeout(resolve, 2000))
}
if (!healthy) throw new Error('The deployed version did not pass the HTTPS health check')
const unauthenticated = await fetch(publicUrl, { redirect: 'error', signal: AbortSignal.timeout(10000) })
if (unauthenticated.status !== 401) throw new Error('MCP must reject requests without authentication')
await unauthenticated.body?.cancel()
console.log('PASS: deployed HTTPS version and authentication boundary')
