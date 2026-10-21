import { createHash, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { IncomingMessage } from 'node:http'
import type { Settings } from './config.js'

export function createAuthenticator(settings: Settings) {
  const oauth = settings.oauth
  const jwks = oauth ? createRemoteJWKSet(new URL('.well-known/jwks.json', oauth.issuer)) : undefined
  const expected = settings.authToken ? createHash('sha256').update(settings.authToken).digest() : undefined
  return async (request: IncomingMessage): Promise<boolean> => {
    const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1]
    if (!token || token.length > 8192) return false
    if (expected && timingSafeEqual(expected, createHash('sha256').update(token).digest())) return true
    if (!oauth || !jwks) return false
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: oauth.issuer, audience: oauth.audience, algorithms: ['RS256'] })
      return Boolean(payload.sub && oauth.subjects.includes(payload.sub)
        && typeof payload.scope === 'string' && payload.scope.split(/\s+/).includes('mcp:read'))
    } catch { return false }
  }
}
