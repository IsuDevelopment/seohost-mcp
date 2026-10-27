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
:root{color-scheme:light;--ink:#30232d;--muted:#74616f;--line:#eadde6;--accent:#b4196b;--brand-gradient:linear-gradient(120deg, rgb(217, 30, 127), rgb(214, 31, 168))}
*{box-sizing:border-box}body{margin:0;background:#faf5f8;color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:760px;margin:48px auto;padding:36px;background:#fff;border:1px solid var(--line);border-radius:14px}
nav{display:flex;justify-content:flex-end;gap:16px;margin-bottom:16px;font-size:14px}a{color:var(--accent);text-underline-offset:4px}a[aria-current=page]{font-weight:700}
.brand{margin:0 0 24px;font:600 12px/1.4 ui-monospace,monospace;letter-spacing:.08em;color:var(--accent);text-transform:uppercase;background:var(--brand-gradient);background-clip:text;-webkit-background-clip:text;color:transparent}
h1{margin:0 0 20px;font:500 clamp(26px,5vw,34px)/1.2 Georgia,serif;letter-spacing:-.02em}p{margin:14px 0;overflow-wrap:anywhere}
dl{display:grid;grid-template-columns:minmax(150px,1fr) 2fr;margin:24px 0;border-top:1px solid var(--line)}dt,dd{padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}dt{color:var(--muted);padding-right:20px}dd{margin:0}
form{margin:24px 0 0}label{display:block;margin:16px 0;font-weight:600}input:not([type=hidden]){display:block;width:100%;margin-top:6px;border:1px solid #bca6b5;border-radius:6px;padding:12px;font:inherit;color:var(--ink);background:#fff}
button{cursor:pointer;min-height:44px;margin:0 8px 8px 0;padding:11px 18px;border:1px solid var(--accent);border-radius:6px;background:var(--brand-gradient);color:#fff;font-family:inherit;font-size:15px;font-weight:600;line-height:1.4}
button:hover{filter:brightness(.94)}button[value=deny],form[action] button{background:#fff;color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
details{margin:20px 0;padding:16px;border:1px solid var(--line);border-radius:6px;background:#fcf8fb}summary{cursor:pointer;font-weight:600}code{display:block;padding:12px;border:1px solid var(--line);background:#fff;font:15px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;user-select:all}
@media(max-width:600px){main{margin:16px;padding:24px 20px}dl{grid-template-columns:1fr}dt{border:0;padding:12px 0 0}dd{padding:4px 0 12px}button{width:100%;margin-right:0}}
`
const styleHash = createHash('sha256').update(pageCss).digest('base64')
export async function handleStageApproval(req: IncomingMessage, res: ServerResponse, settings: Settings) {
  const url = new URL(req.url || '/',settings.publicUrl)
  const match = url.pathname.match(/^\/wordpress-stage\/([a-f0-9]{48})$/)
  const logout = url.pathname === '/wordpress-stage/logout'
  if (!match && !logout) return false
  const language = url.searchParams.get('lang') === 'en' ? 'en' : 'pl'
  const tr = (pl: string, en: string) => language === 'pl' ? pl : en
  const date = (value: number) => new Intl.DateTimeFormat(language === 'pl' ? 'pl-PL' : 'en-GB', {dateStyle:'short',timeStyle:'short',timeZone:'Europe/Warsaw'}).format(value) + ' (Europe/Warsaw)'
  const suffix = language === 'en' ? '?lang=en' : ''
  res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','strict-origin')
  res.setHeader('Content-Language',language)
  res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`)
  const send = (status: number, body: string) => {
    res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'})
    res.end(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${tr('Potwierdzenie instalacji WordPressa','WordPress stage confirmation')}</title><style>${pageCss}</style></head><body><main><nav aria-label="${tr('Język','Language')}"><a href="${url.pathname}" lang="pl"${language==='pl'?' aria-current="page"':''}>Polski</a><a href="${url.pathname}?lang=en" lang="en"${language==='en'?' aria-current="page"':''}>English</a></nav><p class="brand">isuDev / SeoHost MCP</p>${body}</main></body></html>`)
  }
  if (!settings.localOAuth) {send(503,`<p>${tr('Logowanie właściciela MCP nie jest skonfigurowane.','Local owner login is not configured.')}</p>`); return true}
  const id = match?.[1] ?? '', store = new ChangeStore(settings.changeStateFile || 'data/changes.sqlite')
  const binding = digest(JSON.stringify([settings.publicUrl.origin,settings.localOAuth.username,settings.localOAuth.passwordHash]))
  const readCookie = (name: string) => req.headers.cookie?.match(new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)'))?.[1] ?? ''
  const browserToken = readCookie('stage_login'), session = store.ownerSession(browserToken,binding)
  const form = (token: string,body: string) => `<form method="post"><input type="hidden" name="csrf" value="${token}">${body}</form>`
  const setCookie = (name: string,token: string,path: string,maxAge: number) => res.appendHeader('Set-Cookie',`${name}=${token}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${maxAge}${settings.publicUrl.protocol==='https:'?'; Secure':''}`)
  const challengeCookie = (token: string) => setCookie('stage_owner',token,'/wordpress-stage/'+id,token?300:0)
  const logoutForm = (token: string) => `<form method="post" action="/wordpress-stage/logout${suffix}"><input type="hidden" name="csrf" value="${digest('stage-logout:'+token)}"><button>${tr('Wyloguj tę przeglądarkę','Sign out of this browser')}</button></form>`
  const row = (label: string,value: string) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`
  const review = (change: StoredChange,token: string,loginToken: string,expires: number) => {
    const p = stagePayload(change), t = p.target
    return `<h1>${tr('Potwierdź instalację WordPressa','Confirm WordPress installation')}</h1><dl>`+
      row(tr('Adres strony','Website'),t.hostname)+row(tr('Konto hostingu','Hosting account'),change.serverId)+
      row(tr('Sposób dodania w panelu','Hosting placement'),t.placement==='existing_domain'?tr('Istniejąca domena — instalacja produkcyjna','Existing domain — production installation'):t.placement==='independent_domain'?tr('Osobna domena w DirectAdmin','Independent DirectAdmin domain'):tr('Subdomena pod domeną nadrzędną','Subdomain under the parent domain'))+
      row(tr('Katalog strony','Website directory'),t.root)+row(tr('Wersja WordPressa','WordPress version'),t.version)+
      row(tr('Nowy administrator WordPressa','New WordPress administrator'),t.adminName)+row(tr('E-mail administratora','Administrator email'),t.adminEmail)+row(tr('Nowa osobna baza danych','New dedicated database'),t.database)+
      (p.existingRootSnapshot?row(tr('Istniejące pliki do zachowania','Existing files to preserve'),p.existingRootSnapshot.entries.map(e=>e.path).join(', '))+(p.removedRedirects??[]).map(r=>row(tr('Przekierowanie do wyłączenia','Redirect to disable'),r.type+' '+r.from+' → '+r.to)).join('')+row(tr('Obecne przekierowanie domeny','Current domain redirect'),tr('Konfiguracja przekierowania z tego katalogu zostanie zachowana prywatnie i wyłączona. Inne domeny nie są częścią tej instalacji.','The exact redirect configuration in this root is preserved privately and disabled. Other domains are outside this installation.')):'')+
      (p.providerTemplates ? row(tr('Pliki startowe panelu','Provider templates'),tr('Tylko na nowo utworzonym celu: index.html, strony błędów i cgi-bin zostaną zachowane w zweryfikowanej prywatnej kopii wraz z oryginałami. Inne pliki zatrzymają instalację.','Only on the newly created target: index.html, error pages and cgi-bin are preserved as verified private copies and originals. Other files stop installation.')) : '')+
      (p.recovery ? row(tr('Odzyskiwanie instalacji','Installation recovery'),tr('Istniejąca domena nie będzie tworzona ponownie. Pliki panelu zostaną skopiowane, zweryfikowane sumami kontrolnymi i zachowane prywatnie przed przeniesieniem. Potem powstaną brakująca baza i WordPress.','The existing domain will not be created again. Provider templates will be copied, checksum-verified and retained privately before relocation. Only missing DB/WordPress steps follow.'))+row(tr('Elementy do zachowania','Templates to preserve'),p.recovery.snapshot.entries.map(e=>e.path).join(', '))+row(tr('Łączny rozmiar kopii','Backup bytes'),String(p.recovery.snapshot.bytes)) : '')+
      row(tr('Zakres','Scope'),tr('Nowa pojedyncza instalacja. Bez kopiowania strony źródłowej, nadpisywania i usuwania istniejących danych.','Fresh single-site installation. No source website copied. No existing data overwritten or deleted.'))+
      (t.environment==='production'?row(tr('Tryb produkcyjny','Production mode'),tr('Publiczna strona; indeksowanie, poczta i cron WordPressa działają normalnie. Bez blokady logowania środowiska testowego.','Public frontend; normal WordPress indexing, mail and cron. No staging login restriction.')):row(tr('Ochrona środowiska testowego','Staging protection'),tr('Strona wymaga logowania; indeksowanie, wysyłka poczty WP i zadania WP cron są wyłączone.','Login required for frontend; indexing, WP mail and cron disabled.')))+
      row(tr('Kopie zapasowe','Backups'),p.recovery||p.existingRootSnapshot ? tr('Zweryfikowana prywatna kopia plików panelu i zachowane oryginały. Kopie nie będą usuwane.','Verified private template copies and retained originals. No backup deletion.') : tr('Potwierdzono brak istniejącego celu — nie ma starych danych do skopiowania.','Target confirmed absent; no old target data to back up.'))+
      row(tr('DNS i certyfikaty','DNS and certificates'),tr('Publiczny DNS, TLS i HTTP nie zostały zweryfikowane. Ustawienia TLS domeny nadrzędnej pozostają bez zmian.','Public DNS/TLS/HTTP readiness is unverified. No parent-wide TLS settings changed.'))+
      (t.placement==='independent_domain'?row(tr('Konfiguracja hostingu','Hosting configuration'),tr('Nowa domena i lokalna strefa DNS, PHP/SSL włączone, CGI wyłączone, wspólne limity konta. To nie jest rejestracja domeny ani gwarancja izolacji kont.','New domain/local DNS zone, PHP/SSL enabled, CGI off, shared account limits. No domain registration or account-isolation guarantee.')):'')+
      row(tr('Plan ważny do','Plan expires'),date(change.expires))+
      '</dl>'+(p.recovery||p.existingRootSnapshot ? `<details><summary>${tr('Sumy kontrolne kopii (SHA-256)','Template checksums (SHA-256)')}</summary><dl>`+(p.recovery?.snapshot??p.existingRootSnapshot!).entries.filter(e=>e.kind==='file').map(e=>row(e.path,e.sha256!)).join('')+'</dl></details>' : '')+
      `<details><summary>${tr('Klient zlecający operację','Requesting client')}</summary><p>${escape(change.actor)}</p></details>`+
      form(token,`<input type="hidden" name="phase" value="approve"><input type="hidden" name="preview" value="${p.previewHash}"><button name="decision" value="approve">${tr('Zatwierdź tę instalację','Approve this installation')}</button><button name="decision" value="deny">${tr('Odrzuć','Deny')}</button>`)+
      `<p>${tr('Sesja właściciela MCP jest ważna do','You are signed in as the MCP owner until')} ${escape(date(expires))}. ${tr('Każda instalacja wymaga osobnej zgody. Hasło WordPressa zobaczysz tutaj po zakończeniu instalacji. Samo zatwierdzenie jej nie uruchamia.','Each installation still needs its own approval. The WordPress password appears here after completion. Approving does not execute the installation.')}</p>`+logoutForm(loginToken)
  }
  const ownerPage = async (change: StoredChange,loginToken: string,expires: number) => {
    if (change.status === 'applied') {
      const t = stagePayload(change).target, password = await stageAdminPassword(settings,change)
      return `<h1>${tr('WordPress został zainstalowany lokalnie','WordPress installation completed locally')}</h1><dl>`+
        row(tr('Adres strony','Website'),t.hostname)+row(tr('Administrator','Administrator'),t.adminName)+row(tr('E-mail administratora','Administrator email'),t.adminEmail)+row(tr('Baza danych','Database'),t.database)+
        `</dl><details><summary>${tr('Pokaż hasło administratora WordPressa','Show WordPress administrator password')}</summary><p><code>${escape(password)}</code></p><p>${tr('Zapisz hasło w menedżerze haseł. To hasło z chwili instalacji — późniejsze zmiany w WordPressie nie są tu aktualizowane.','Save this password in your password manager. This is the installation password; later WordPress password changes are not tracked here.')}</p></details><p>${tr('Publiczny DNS, TLS i HTTP pozostają niezweryfikowane. Hasło bazy danych nie jest tutaj wyświetlane.','Public DNS/TLS/HTTP readiness remains unverified. This page does not expose the database password.')}</p>`+logoutForm(loginToken)
    }
    const token = store.ownerChallenge(id,'review'); challengeCookie(token)
    return review(change,token,loginToken,expires)
  }
  try {
    if (req.method === 'GET') {
      if (logout) {send(200,session?`<h1>${tr('Wylogowanie','Sign out')}</h1>`+logoutForm(browserToken):`<p>${tr('Ta przeglądarka jest już wylogowana.','You are already signed out.')}</p>`); return true}
      const change = store.getForOwner(id,true)
      if (session) send(200,await ownerPage(change,browserToken,session.expires))
      else {
        if (browserToken) setCookie('stage_login','','/wordpress-stage',0)
        const token = store.ownerChallenge(id,'login'); challengeCookie(token)
        send(200,`<h1>${tr('Zaloguj się, aby zobaczyć instalację','Sign in to view the installation')}</h1><p>${tr('Użyj obecnego loginu i hasła właściciela MCP. To nie są dane nowego administratora WordPressa.','Use your existing MCP owner login and password. These are not the credentials for the new WordPress administrator.')}</p><p>${tr('Ta przeglądarka zapamięta logowanie na 8 godzin. Każdą instalację nadal zatwierdzasz osobno.','This browser stays signed in for 8 hours. You will still review and approve each installation separately.')}</p>`+form(token,`<input type="hidden" name="phase" value="login"><label>${tr('Login właściciela MCP','MCP owner username')} <input name="username" autocomplete="username" required></label><label>${tr('Hasło właściciela MCP','MCP owner password')} <input type="password" name="password" autocomplete="current-password" required></label><button>${tr('Zaloguj się i zobacz','Sign in and view')}</button>`))
      }
    } else if (req.method === 'POST') {
      if (req.headers.origin !== settings.publicUrl.origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid owner request.')
      let raw = ''; for await (const chunk of req) {raw += chunk.toString(); if (Buffer.byteLength(raw)>8192) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Request too large.')}
      const q = new URLSearchParams(raw), token = q.get('csrf') || ''
      if (logout) {
        if (!session || token !== digest('stage-logout:'+browserToken)) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid sign-out request.')
        store.revokeOwnerSession(browserToken); setCookie('stage_login','','/wordpress-stage',0)
        send(200,`<p>${tr('Przeglądarka wylogowana. Wcześniejsze zgody pozostają ważne; nie wykonano operacji na hostingu.','Signed out of this browser. Existing plan approvals are unchanged; no hosting operation was executed.')}</p>`); return true
      }
      if (!/^[a-f0-9]{64}$/.test(token) || readCookie('stage_owner') !== token) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Form expired. Reopen the plan to continue.')
      if (q.get('phase') === 'login') {
        store.consumeOwnerChallenge(id,token,'login'); store.ownerLoginAttempt()
        const [salt,hash] = settings.localOAuth.passwordHash.split(':'), actual = scryptSync((q.get('password')||'').slice(0,1024),salt!,64)
        if (q.get('username') !== settings.localOAuth.username || !timingSafeEqual(actual,Buffer.from(hash!,'hex'))) {
          send(400,`<p>${tr('Nieprawidłowy login lub hasło właściciela MCP. Otwórz link ponownie i spróbuj jeszcze raz.','Owner login failed. Reopen the plan and use your existing MCP owner credentials.')}</p>`); return true
        }
        const change = store.getForOwner(id,true), remembered = store.createOwnerSession(binding,browserToken)
        setCookie('stage_login',remembered.token,'/wordpress-stage',sessionSeconds)
        send(200,await ownerPage(change,remembered.token,remembered.expires))
      } else if (q.get('phase') === 'approve') {
        if (!session) throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Owner session expired. Reopen the plan and sign in again.')
        const change = store.consumeOwnerChallenge(id,token,'review')
        if (q.get('decision') === 'approve') {
          store.approveOwner(change,q.get('preview')||''); challengeCookie('')
          send(200,`<p>${tr('Plan zatwierdzony. Wróć do agenta MCP i zleć wykonanie tego planu przed upływem ważności. Ta strona nie wykonała zmian na hostingu.','Plan approved. Return to your MCP agent to apply this exact plan before expiry. No hosting change was executed by this page.')}</p>`+logoutForm(browserToken))
        } else if (q.get('decision') === 'deny') {
          store.denyOwner(id); challengeCookie('')
          send(200,`<p>${tr('Plan odrzucony. Nie wykonano zmian na hostingu.','Not approved. No hosting changes made.')}</p>`+logoutForm(browserToken))
        } else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid decision.')
      } else throw new HostingError('OWNER_CONFIRMATION_REQUIRED','Invalid confirmation phase.')
    } else {res.setHeader('Allow','GET, POST'); send(405,`<p>${tr('Niedozwolona metoda żądania.','Method not allowed.')}</p>`)}
  } catch (e) {
    const polish: Record<string,string> = {
      PLAN_NOT_FOUND:'Plan jest niedostępny.', PLAN_NOT_READY:'Plan wygasł albo nie oczekuje już na zatwierdzenie.',
      PLAN_LIMIT:'Zbyt wiele oczekujących planów lub formularzy. Spróbuj później.',
      OWNER_LOGIN_LIMIT:'Zbyt wiele prób lub aktywnych sesji. Poczekaj minutę; jeśli sesje są zapełnione, wyloguj inną przeglądarkę lub poczekaj na ich wygaśnięcie.',
      OWNER_CONFIRMATION_REQUIRED:'Formularz lub sesja jest nieprawidłowa albo wygasła. Otwórz link ponownie i zaloguj się w razie potrzeby.',
      PREVIEW_MISMATCH:'Podgląd planu nie jest zgodny. Otwórz link ponownie.',
      RECOVERY_TARGET_CHANGED:'Cel lub pliki panelu zmieniły się od zatwierdzenia. Wznowienie wstrzymane.',
      CREDENTIALS_UNAVAILABLE:'Nie można bezpiecznie odczytać danych zakończonej instalacji. Skontaktuj się z operatorem.',
    }
    const message = e instanceof HostingError ? tr(polish[e.code] || 'Plan jest niedostępny. Otwórz link ponownie.',e.message) : tr('Plan jest niedostępny. Otwórz link ponownie.','Plan unavailable. Reopen the confirmation link.')
    send(e instanceof HostingError && e.code === 'OWNER_LOGIN_LIMIT' ? 429 : 400,`<p>${escape(message)}</p>`)
  } finally {store.close()}
  return true
}
