import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Settings } from './config.js'
import { ChangeStore, type StoredChange } from './change-store.js'
import { stagePayload, stageAdminPassword } from './wordpress-stage.js'
import { HostingError } from './hosting-error.js'
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const sessionSeconds = 8 * 3600
// Hash-authorized static styles: no external assets, scripts or unsafe-inline CSP.
const pageCss = `
:root{color-scheme:light;--ink:#20332d;--muted:#5e6c66;--line:#dce4de;--accent:#166347}
*{box-sizing:border-box}body{margin:0;background:#f3f5f1;color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:760px;margin:48px auto;padding:36px;background:#fff;border:1px solid var(--line);border-radius:14px}
.brand{margin:0 0 24px;font:600 12px/1.4 ui-monospace,monospace;letter-spacing:.08em;color:var(--accent);text-transform:uppercase}
h1{margin:0 0 20px;font:500 clamp(26px,5vw,34px)/1.2 Georgia,serif;letter-spacing:-.02em}p{margin:14px 0;overflow-wrap:anywhere}
dl{display:grid;grid-template-columns:minmax(150px,1fr) 2fr;margin:24px 0;border-top:1px solid var(--line)}dt,dd{padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}dt{color:var(--muted);padding-right:20px}dd{margin:0}
form{margin:24px 0 0}label{display:block;margin:16px 0;font-weight:600}input:not([type=hidden]){display:block;width:100%;margin-top:6px;border:1px solid #aabbb1;border-radius:6px;padding:12px;font:inherit;color:var(--ink);background:#fff}
button{cursor:pointer;min-height:44px;margin:0 8px 8px 0;padding:11px 18px;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:#fff;font-family:inherit;font-size:15px;font-weight:600;line-height:1.4}
button:hover{filter:brightness(.94)}button[value=deny],form[action] button{background:#fff;color:var(--accent)}:focus-visible{outline:3px solid #d29b36;outline-offset:3px}
details{margin:20px 0;padding:16px;border:1px solid var(--line);border-radius:6px;background:#f8faf7}summary{cursor:pointer;font-weight:600}code{display:block;padding:12px;border:1px solid var(--line);background:#fff;font:15px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;user-select:all}
@media(max-width:600px){main{margin:16px;padding:24px 20px}dl{grid-template-columns:1fr}dt{border:0;padding:12px 0 0}dd{padding:4px 0 12px}button{width:100%;margin-right:0}}
`
const styleHash = createHash('sha256').update(pageCss).digest('base64')
export async function handleStageApproval(req: IncomingMessage, res: ServerResponse, settings: Settings) {
  const match = req.url?.match(/^\/wordpress-stage\/([a-f0-9]{48})$/)
  const logout = req.url === '/wordpress-stage/logout'
  if (!match && !logout) return false
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','strict-origin')
  res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`)
  const send = (status: number, body: string) => {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'})
    res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WordPress stage confirmation</title><style>'+pageCss+'</style></head><body><main><p class="brand">isuDev / SeoHost MCP</p>'+body+'</main></body></html>')
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
  const ownerPage = async (change: StoredChange, loginToken: string, expires: number) => {
    if (change.status === 'applied') {
      const t = stagePayload(change).target
      const password = await stageAdminPassword(settings,change)
      return '<h1>WordPress installation completed locally</h1><p>Website: '+escape(t.hostname)+'</p><p>Administrator: '+escape(t.adminName)+
        '</p><p>Administrator email: '+escape(t.adminEmail)+'</p><p>Database: '+escape(t.database)+
        '</p><details><summary>Show WordPress administrator password</summary><p><code>'+escape(password)+
        '</code></p><p>Save this password in your password manager. This is the installation password; later WordPress password changes are not tracked here.</p></details>'+
        '<p>Public DNS/TLS/HTTP readiness remains unverified. This page does not expose the database password.</p>'+logoutForm(loginToken)
    }
    const token=store.ownerChallenge(id,'review');challengeCookie(token)
    return review(change,token,loginToken,expires)
  }
  try {
    if(req.method==='GET') {
      if(logout) {send(200,session?'<h1>Sign out</h1>'+logoutForm(browserToken):'<p>You are already signed out.</p>');return true}
      const change=store.getForOwner(id,true)
      if(session) {
        send(200,await ownerPage(change,browserToken,session.expires))
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
        const change=store.getForOwner(id,true), remembered=store.createOwnerSession(binding,browserToken)
        setCookie('stage_login',remembered.token,'/wordpress-stage',sessionSeconds)
        send(200,await ownerPage(change,remembered.token,remembered.expires))
      } else if(q.get('phase')==='approve') {
        if(!session) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Owner session expired. Reopen the plan and sign in again.')
        const change=store.consumeOwnerChallenge(id,token,'review')
        if(q.get('decision')==='approve') {store.approveOwner(change,q.get('preview')||'');challengeCookie('');send(200,'<p>Plan approved. Return to your MCP agent to apply this exact plan before expiry. No hosting change was executed by this page.</p>'+logoutForm(browserToken))}
        else if(q.get('decision')==='deny') {store.denyOwner(id);challengeCookie('');send(200,'<p>Not approved. No hosting changes made.</p>'+logoutForm(browserToken))}
        else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid decision.')
      } else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid confirmation phase.')
    } else {res.setHeader('Allow','GET, POST');send(405,'<p>Method not allowed.</p>')}
  } catch(e) {send(e instanceof HostingError && e.code==='OWNER_LOGIN_LIMIT'?429:400,'<p>'+escape(e instanceof HostingError?e.message:'Plan unavailable. Reopen the confirmation link.')+'</p>')}
  finally {store.close()}
  return true
}
