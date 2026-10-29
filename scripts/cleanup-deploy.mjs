// Called only after release verification. No arbitrary cleanup paths are accepted.
import { lstat, readdir, readFile, mkdir, copyFile, chmod, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const [homeInput, appRelative, release] = process.argv.slice(2)
if (!homeInput || !appRelative || !/^\d+-\d+$/.test(release ?? '') || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(appRelative)) throw Error('Invalid cleanup identity')
const home = resolve(homeInput), app = join(home, appRelative), parent = join(home, '.seohost-mcp-deploy'), current = join(parent, release)
const denied = () => { throw Error('Deployment cleanup refused unsafe or unexpected files') }
async function directory(path) {
  if (!path.startsWith(home + '/')) denied()
  let p = home
  for (const segment of path.slice(home.length + 1).split('/')) {
    p = join(p, segment); const st = await lstat(p)
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.()) denied()
  }
}
async function file(path, max) {
  await directory(dirname(path)); const st = await lstat(path)
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid?.() || st.size > max) denied()
  return st
}
await directory(app); await directory(current)
await file(join(app, '.mcp-deploy-release'), 128)
if ((await readFile(join(app, '.mcp-deploy-release'), 'utf8')).trim() !== release) denied()
const archive = join(current, 'rollback.tar.gz'); await file(archive, 64 * 1024 * 1024)
// One private previous-code rollback replaces the deployment history. Never copy config/state.
const backup = join(app, '.mcp-rollback')
try { await mkdir(backup, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
await directory(backup); if ((await lstat(backup)).mode & 0o077) denied()
const temporary = join(backup, 'rollback-' + release + '.tmp')
await copyFile(archive, temporary, 1); await chmod(temporary, 0o600)
const hash = async p => createHash('sha256').update(await readFile(p)).digest('hex')
if (await hash(archive) !== await hash(temporary)) denied()
const saved = join(backup, 'rollback.tar.gz')
try { await file(saved, 64 * 1024 * 1024) } catch (e) { if (e.code !== 'ENOENT') throw e }
await rename(temporary, saved)
const metadata=join(backup,'release.json')
try{await file(metadata,4096)}catch(e){if(e.code!=='ENOENT')throw e}
const metadataTemporary=join(backup,'release-'+release+'.tmp')
await writeFile(metadataTemporary, JSON.stringify({ deployedRelease: release, createdAt: new Date().toISOString(), coverage: 'previous application code only; no runtime config or state' }) + '\n', { mode: 0o600, flag:'wx' })
await rename(metadataTemporary,metadata)
const candidates = (await readdir(parent)).filter(n => /^\d+-\d+$/.test(n))
let count = 0, bytes = 0
async function inspect(path) {
  const st = await lstat(path)
  if (++count > 100000 || st.isSymbolicLink() || st.uid !== process.getuid?.() || (!st.isDirectory() && (!st.isFile() || st.nlink !== 1))) denied()
  if (st.isDirectory()) {
    for (const name of await readdir(path)) {
      if (/^(?:\.env(?:\..*)?|config|data|node_modules|.*\.sqlite(?:-wal|-shm)?)$/.test(name)) denied()
      await inspect(join(path, name))
    }
  } else { bytes += st.size; if (bytes > 1024 * 1024 * 1024) denied() }
}
// Validate every candidate before the first deletion. Unknown non-release folders stay.
for (const name of candidates) { await directory(join(parent, name)); await inspect(join(parent, name)) }
if ((await readFile(join(app, '.mcp-deploy-release'), 'utf8')).trim() !== release) denied()
for (const name of candidates) await rm(join(parent, name), { recursive: true })
console.log(JSON.stringify({ removedDeploymentDirectories: candidates.length, removedBytes: bytes, retainedRollback: true }))
