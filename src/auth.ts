import { createHash, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { IncomingMessage } from 'node:http'
import type { Settings } from './config.js'
export interface AccessContext { actor: string; canWrite: boolean }

export function createAuthenticator(settings: Settings) {
  const oauth = settings.oauth
  const jwks = oauth ? createRemoteJWKSet(new URL('.well-known/jwks.json', oauth.issuer)) : undefined
  const expected = settings.authToken ? createHash('sha256').update(settings.authToken).digest() : undefined
  const writeExpected = settings.writeAuthToken ? createHash('sha256').update(settings.writeAuthToken).digest() : undefined
  return async (request: IncomingMessage): Promise<AccessContext | undefined> => {
    const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    if (!token || token.length > 8192) return
    const digest = createHash('sha256').update(token).digest()
    if (writeExpected && timingSafeEqual(writeExpected, digest)) return { actor: 'write-bearer:' + digest.toString('hex'), canWrite: true }
    if (expected && timingSafeEqual(expected, digest)) return { actor: 'read-bearer:' + digest.toString('hex'), canWrite: false }
    if (!oauth || !jwks) return
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: oauth.issuer, audience: oauth.audience, algorithms: ['RS256'] })
      if (payload.sub && oauth.subjects.includes(payload.sub) && typeof payload.scope === 'string' && payload.scope.split(/\s+/).includes('mcp:read'))
        return { actor: 'external:' + createHash('sha256').update(oauth.issuer + ':' + payload.sub + ':' + String(payload.azp ?? payload.client_id ?? '')).digest('hex'),
          canWrite: payload.scope.split(/\s+/).includes('mcp:write') }
    } catch { return }
  }
}
