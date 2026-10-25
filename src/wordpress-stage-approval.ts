import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Settings } from './config.js'
import { ChangeStore, type StoredChange } from './change-store.js'
import { stagePayload } from './wordpress-stage.js'
import { HostingError } from './hosting-error.js'
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const sessionSeconds = 8 * 3600
export async function handleStageApproval(req: IncomingMessage, res: ServerResponse, settings: Settings) {
  const match = req.url?.match(/^\/wordpress-stage\/([a-f0-9]{48})$/)
  const logout = req.url === '/wordpress-stage/logout'
  if (!match && !logout) return false
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','strict-origin')
  res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
  const send = (status: number, body: string) => {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'})
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>WordPress stage confirmation</title>'+body+'</html>')
  }
  if (!settings.localOAuth) {send(503,'<p>Local owner login is not configured.</p>');return true}
  const id=match?.[1] ?? '', store=new ChangeStore(settings.changeStateFile || 'data/changes.sqlite')
  const binding=digest(JSON.stringify([settings.publicUrl.origin,settings.localOAuth.username,settings.localOAuth.passwordHash]))
  const readCookie=(name:string) => req.headers.cookie?.match(new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)'))?.[1] ?? ''
  const browserToken=readCookie('stage_login')
  const session=store.ownerSession(browserToken,binding)
  const form=(token:string,body:string) => `<form method="post"><input type="hidden" name="csrf" value="${token}">${body}</form>`
  const setCookie=(name:string,token:string,path:string,maxAge:number) => {
    res.appendHeader('Set-Cookie',`${name}=${token}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${maxAge}${settings.publicUrl.protocol==='https:'?'; Secure':''}`)
  }
  const challengeCookie=(token:string) => setCookie('stage_owner',token,'/wordpress-stage/'+id,token?300:0)
  const logoutForm=(token:string) => `<form method="post" action="/wordpress-stage/logout"><input type="hidden" name="csrf" value="${digest('stage-logout:'+token)}"><button>Sign out of this browser</button></form>`
  const review=(change:StoredChange,token:string,loginToken:string,expires:number) => {
    const p=stagePayload(change), t=p.target
    const row=(label:string,value:string) => '<dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd>'
    return '<h1>Confirm WordPress installation</h1><dl>'+
      row('Website',t.hostname)+row('Hosting account',change.serverId)+row('WordPress version',t.version)+
      row('New WordPress administrator',t.adminName)+row('Administrator email',t.adminEmail)+row('New dedicated database',t.database)+
      row('Scope','Fresh single-site installation. No source website copied. No existing data overwritten or deleted.')+
      row('Staging protection','Login required for frontend; indexing, WP mail and cron disabled.')+
      row('Backups','Target confirmed absent; no old target data to back up.')+
      row('DNS and certificates','Public DNS/TLS/HTTP readiness is unverified. No parent-wide TLS settings changed.')+
      row('Plan expires',new Date(change.expires).toISOString())+'</dl>'+
      '<details><summary>Target directory and requesting client</summary><p>'+escape(t.root)+'</p><p>'+escape(change.actor)+'</p></details>'+
      form(token,`<input type="hidden" name="phase" value="approve"><input type="hidden" name="preview" value="${p.previewHash}"><button name="decision" value="approve">Approve this installation</button><button name="decision" value="deny">Deny</button>`)+
      '<p>You are signed in as the MCP owner until '+escape(new Date(expires).toISOString())+'. Each installation still needs its own approval. Passwords stay private on hosting. Approving does not execute the installation.</p>'+logoutForm(loginToken)
  }
  try {
    if(req.method==='GET') {
      if(logout) {send(200,session?'<h1>Sign out</h1>'+logoutForm(browserToken):'<p>You are already signed out.</p>');return true}
      const change=store.getForOwner(id)
      if(session) {
        const token=store.ownerChallenge(id,'review');challengeCookie(token)
        send(200,review(change,token,browserToken,session.expires))
      } else {
        if(browserToken)setCookie('stage_login','','/wordpress-stage',0)
        const token=store.ownerChallenge(id,'login');challengeCookie(token)
        send(200,'<h1>Sign in to review the installation</h1><p>Use your existing MCP owner login and password. These are not the credentials for the new WordPress administrator.</p><p>This browser stays signed in for 8 hours. You will still review and approve each installation separately.</p>'+form(token,'<input type="hidden" name="phase" value="login"><label>MCP owner username <input name="username" autocomplete="username" required></label><label>MCP owner password <input type="password" name="password" autocomplete="current-password" required></label><button>Sign in and review plan</button>'))
      }
    } else if(req.method==='POST') {
      if(req.headers.origin!==settings.publicUrl.origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
        throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid owner request.')
      let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>8192)throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Request too large.')}
      const q=new URLSearchParams(raw), token=q.get('csrf')||''
      if(logout) {
        if(!session || token!==digest('stage-logout:'+browserToken)) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid sign-out request.')
        store.revokeOwnerSession(browserToken);setCookie('stage_login','','/wordpress-stage',0)
        send(200,'<p>Signed out of this browser. Existing plan approvals are unchanged; no hosting operation was executed.</p>');return true
      }
      if(!/^[a-f0-9]{64}$/.test(token)||readCookie('stage_owner')!==token)throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Form expired. Reopen the plan to continue.')
      if(q.get('phase')==='login') {
        store.consumeOwnerChallenge(id,token,'login');store.ownerLoginAttempt()
        const [salt,hash]=settings.localOAuth.passwordHash.split(':'),actual=scryptSync((q.get('password')||'').slice(0,1024),salt!,64)
        if(q.get('username')!==settings.localOAuth.username||!timingSafeEqual(actual,Buffer.from(hash!,'hex')))
          throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Owner login failed. Reopen the plan and use your existing MCP owner credentials.')
        const change=store.getForOwner(id), remembered=store.createOwnerSession(binding,browserToken), next=store.ownerChallenge(id,'review')
        setCookie('stage_login',remembered.token,'/wordpress-stage',sessionSeconds);challengeCookie(next)
        send(200,review(change,next,remembered.token,remembered.expires))
      } else if(q.get('phase')==='approve') {
        if(!session) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Owner session expired. Reopen the plan and sign in again.')
        const change=store.consumeOwnerChallenge(id,token,'review')
        if(q.get('decision')==='approve') {store.approveOwner(change,q.get('preview')||'');send(200,'<p>Plan approved. Return to your MCP agent to apply this exact plan before expiry. No hosting change was executed by this page.</p>'+logoutForm(browserToken))}
        else if(q.get('decision')==='deny') {store.denyOwner(id);send(200,'<p>Not approved. No hosting changes made.</p>'+logoutForm(browserToken))}
        else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid decision.')
        challengeCookie('')
      } else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid confirmation phase.')
    } else {res.setHeader('Allow','GET, POST');send(405,'<p>Method not allowed.</p>')}
  } catch(e) {send(e instanceof HostingError && e.code==='OWNER_LOGIN_LIMIT'?429:400,'<p>'+escape(e instanceof HostingError?e.message:'Plan unavailable. Reopen the confirmation link.')+'</p>')}
  finally {store.close()}
  return true
}
