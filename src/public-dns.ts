import { z } from 'zod'
import { domainSchema } from './directadmin.js'
import { HostingError } from './hosting-error.js'

export const publicTypes = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2, CAA: 257 } as const
export type PublicType = keyof typeof publicTypes
export type DnsObservation = { status: 'answer' | 'no_data' | 'nxdomain' | 'failed'; values: string[]; ttl: number | null; checkedAt: string; cached: boolean }
const cache = new Map<string, { expires: number; observation: DnsObservation }>()
const responseSchema = z.object({ Status: z.number().int(), TC: z.boolean().optional(), Answer: z.array(z.object({
  name: z.string().max(254), type: z.number().int(), TTL: z.number().int().nonnegative().max(2147483647), data: z.string().max(8192),
})).max(100).optional() })

export function dnsName(value: string, zone: string) {
  value = value.toLowerCase()
  const name = value === '@' ? zone : value.endsWith('.') ? value.slice(0, -1) : value === zone || value.endsWith('.' + zone) ? value : `${value}.${zone}`
  if (name.length > 253 || !(name === zone || name.endsWith('.' + zone))
    || !name.split('.').every(label => /^(?:\*|[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62})$/.test(label)))
    throw new HostingError('INVALID_DNS_NAME', 'Use an owner name inside the selected domain, @, or a relative label.')
  return name.toLowerCase()
}

export class PublicDns {
  constructor(private readonly request: typeof fetch = fetch) {}
  async query(name: string, type: PublicType, fresh = false): Promise<DnsObservation> {
    // TXT/service names may contain underscores. Targets never become HTTP origins.
    if (!/^[a-zA-Z0-9_.-]{1,253}$/.test(name) || name.includes('..')) throw new HostingError('INVALID_DNS_NAME', 'Invalid public DNS query name.')
    const key = `${name.toLowerCase()}:${type}`, previous = cache.get(key)
    if (!fresh && previous && previous.expires > Date.now()) return { ...previous.observation, values: [...previous.observation.values], cached: true }
    try {
      const url = new URL('https://dns.google/resolve')
      url.search = new URLSearchParams({ name, type: String(publicTypes[type]), edns_client_subnet: '0.0.0.0/0' }).toString()
      const response = await this.request(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/dns-json' } })
      if (!response.ok || Number(response.headers.get('content-length')) > 65536) { await response.body?.cancel(); throw Error('DNS response failed') }
      let bytes = 0; const chunks: Uint8Array[] = [], reader = response.body?.getReader()
      if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
        if (bytes > 65536) { await reader.cancel(); throw Error('DNS response too large') } chunks.push(part.value) } } finally { reader.releaseLock() }
      const data = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (data.TC) throw Error('Truncated DNS answer')
      const answers = (data.Answer ?? []).filter(answer => answer.type === publicTypes[type] && answer.name.toLowerCase().replace(/\.$/, '') === name.toLowerCase())
      const observation: DnsObservation = { status: data.Status === 3 ? 'nxdomain' : data.Status !== 0 ? 'failed' : answers.length ? 'answer' : 'no_data',
        values: [...new Set(answers.map(answer => answer.data))].sort(), ttl: answers.length ? Math.min(...answers.map(answer => answer.TTL)) : null,
        checkedAt: new Date().toISOString(), cached: false }
      if (observation.status === 'answer' && observation.ttl) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!)
        cache.set(key, { expires: Date.now() + Math.min(observation.ttl, 300) * 1000, observation })
      }
      return observation
    } catch { return { status: 'failed', values: [], ttl: null, checkedAt: new Date().toISOString(), cached: false } }
  }
  async authority(domain: string, trustedNameservers: string[] = [], fresh = false) {
    domain = domainSchema.parse(domain)
    const observation = await this.query(domain, 'NS', fresh)
    const nameservers = observation.values.map(value => value.toLowerCase().replace(/\.$/, '')).sort()
    const expected = trustedNameservers.map(value => value.toLowerCase().replace(/\.$/, '')).sort()
    const matchesHosting = observation.status === 'answer' && expected.length > 0 && JSON.stringify(nameservers) === JSON.stringify(expected)
    const providerHint = nameservers.length && nameservers.every(name => name.endsWith('.ns.cloudflare.com')) ? 'cloudflare'
      : matchesHosting ? 'configured_hosting_nameservers' : nameservers.length ? 'other_or_unknown' : 'unknown'
    return { nameservers, providerHint, matchesHosting, observation,
      evidence: 'public_recursive_resolver', proxyStatus: 'unknown', upstreamCachesMayApply: true }
  }
}
