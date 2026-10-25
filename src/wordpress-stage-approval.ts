import { scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Settings } from './config.js'
import { ChangeStore } from './change-store.js'
import { stagePayload, stagePreview } from './wordpress-stage.js'
import { HostingError } from './hosting-error.js'
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function handleStageApproval(req: IncomingMessage, res: ServerResponse, settings: Settings) {
  const match = req.url?.match(/^\/wordpress-stage\/([a-f0-9]{48})$/)
  if (!match) return false
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','strict-origin')
  res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  const send = (status: number, body: string) => {res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>WordPress stage confirmation</title>'+body+'</html>')}
  if (!settings.localOAuth) {send(503,'<p>Local owner login is not configured.</p>');return true}
  const id=match[1]!, store=new ChangeStore(settings.changeStateFile || 'data/changes.sqlite')
  const form=(token:string,body:string) => `<form method="post"><input type="hidden" name="csrf" value="${token}">${body}</form>`
  const cookie=(token:string) => res.setHeader('Set-Cookie',`stage_owner=${token}; HttpOnly; SameSite=Strict; Path=/wordpress-stage/${id}; Max-Age=300${settings.publicUrl.protocol==='https:'?'; Secure':''}`)
  try {
    if(req.method==='GET') {
      store.getForOwner(id);const token=store.ownerChallenge(id,'login');cookie(token)
      send(200,'<h1>Review fresh WordPress stage</h1><p>Sign in as the MCP owner to view the plan. This does not execute it.</p>'+form(token,'<input type="hidden" name="phase" value="login"><label>Username <input name="username" autocomplete="username" required></label><label>Password <input type="password" name="password" autocomplete="current-password" required></label><button>Review plan</button>'))
    } else if(req.method==='POST') {
      if(req.headers.origin !== settings.publicUrl.origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid owner request.')
      let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>8192)throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Request too large.')}
      const q=new URLSearchParams(raw), token=q.get('csrf')||'', stored=req.headers.cookie?.match(/(?:^|;\s*)stage_owner=([a-f0-9]{64})(?:;|$)/)?.[1]
      if(!/^[a-f0-9]{64}$/.test(token)||stored!==token)throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid owner session.')
      if(q.get('phase')==='login') {
        store.consumeOwnerChallenge(id,token,'login');store.ownerLoginAttempt()
        const [salt,hash]=settings.localOAuth.passwordHash.split(':'),actual=scryptSync((q.get('password')||'').slice(0,1024),salt!,64)
        if(q.get('username')!==settings.localOAuth.username||!timingSafeEqual(actual,Buffer.from(hash!,'hex')))throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Owner login failed. Reopen the plan to try again.')
        const change=store.getForOwner(id), p=stagePayload(change), next=store.ownerChallenge(id,'review');cookie(next)
        send(200,'<h1>Confirm this exact new stage</h1><pre>'+escape(JSON.stringify({...stagePreview(change),documentRoot:p.target.root},null,2))+'</pre><p>Fresh single-site WordPress and a new dedicated database only. Existing targets are refused. DNS/TLS and external HTTP access are not changed or verified. No source copied, overwritten or deleted. Private generated passwords stay on hosting. Confirmation authorizes only this plan, actor and expiry; it does not execute it.</p>'+form(next,`<input type="hidden" name="phase" value="approve"><input type="hidden" name="preview" value="${p.previewHash}"><button name="decision" value="approve">Approve this fresh installation</button><button name="decision" value="deny">Deny</button>`))
      } else if(q.get('phase')==='approve') {
        const change=store.consumeOwnerChallenge(id,token,'review')
        if(q.get('decision')==='approve') {store.approveOwner(change,q.get('preview')||'');send(200,'<p>Plan approved. Return to your MCP agent to apply this exact plan before expiry. No hosting change has been executed by this confirmation page.</p>')}
        else if(q.get('decision')==='deny') {store.denyOwner(id);send(200,'<p>Not approved. No hosting changes made.</p>')}
        else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid decision.')
        cookie('')
      } else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid confirmation phase.')
    } else {res.setHeader('Allow','GET, POST');send(405,'<p>Method not allowed.</p>')}
  } catch(e) {send(e instanceof HostingError && e.code==='OWNER_LOGIN_LIMIT'?429:400,'<p>'+escape(e instanceof HostingError?e.message:'Plan unavailable. Reopen the confirmation link.')+'</p>')}
  finally {store.close()}
  return true
}
