import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, readlink, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve('.')
const emptyLock = { lockfileVersion: 3, packages: { '': { version: '1.0.0' } } }
const json = (value: unknown) => JSON.stringify(value)
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

test('dependency guard accepts code-only updates and rejects changed or missing production packages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-deps-'))
  try {
    const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/example': { version: '1.0.0', integrity: 'sha512-example' } } }
    await mkdir(join(dir, 'node_modules/example'), { recursive: true })
    await writeFile(join(dir, 'package-lock.json'), json(lock))
    await writeFile(join(dir, 'next.json'), json(lock))
    await writeFile(join(dir, 'node_modules/example/package.json'), json({ version: '1.0.0' }))
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-runtime-dependencies.mjs'), join(dir, 'next.json'), dir], { encoding: 'utf8' })
    assert.equal(run().status, 0)
    await writeFile(join(dir, 'next.json'), json({ ...lock, packages: { ...lock.packages, 'node_modules/example': { version: '2.0.0' } } }))
    assert.match(run().stderr, /Production dependencies changed/)
    await writeFile(join(dir, 'next.json'), json(lock))
    await rm(join(dir, 'node_modules/example/package.json'))
    assert.match(run().stderr, /production dependency is missing/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('release archive includes runtime allowlist and excludes private state and configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-package-'))
  try {
    const files = ['dist/src/http.js', 'package.json', 'package-lock.json', 'deploy/start.cjs', 'deploy/verify.mjs', 'scripts/smoke.mjs', 'scripts/smoke-hosting.mjs', 'scripts/smoke-oauth.mjs', 'scripts/setup-hosting.mjs', 'scripts/setup-oauth.mjs', 'scripts/download-database.mjs', 'scripts/check-runtime-dependencies.mjs', 'scripts/cleanup-deploy.mjs', '.env', 'config/servers.json', 'data/oauth.sqlite', 'dist/test/example.js']
    for (const path of files) {
      await mkdir(join(dir, path, '..'), { recursive: true })
      await writeFile(join(dir, path), 'fixture')
    }
    await copyFile(join(root, 'deploy/package.sh'), join(dir, 'deploy/package.sh'))
    const result = spawnSync('bash', [join(dir, 'deploy/package.sh'), join(dir, 'release.tar.gz')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const contents = spawnSync('tar', ['-tzf', join(dir, 'release.tar.gz')], { encoding: 'utf8' }).stdout
    assert.match(contents, /dist\/src\/http.js/)
    assert.match(contents, /scripts\/smoke-hosting.mjs/)
    assert.match(contents, /scripts\/download-database.mjs/)
    assert.doesNotMatch(contents, /\.env|config\/|data\/|dist\/test|node_modules/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

for (const failVerification of [false, true]) {
  test(`deployment ${failVerification ? 'rolls back on failed verification' : 'publishes the new code'} and preserves private files and the dependency symlink`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'mcp-deploy-'))
    try {
      const app = join(home, 'node-apps/mcp')
      const transfer = join(home, '.seohost-mcp-deploy/123-1')
      const candidate = join(home, 'candidate')
      const bin = join(home, 'bin')
      for (const base of [app, candidate]) {
        for (const path of ['dist/src', 'scripts', 'deploy']) await mkdir(join(base, path), { recursive: true })
        await writeFile(join(base, 'package-lock.json'), json(emptyLock))
        await writeFile(join(base, 'package.json'), json({ version: base === app ? '1.0.0' : '1.1.0' }))
        await writeFile(join(base, 'dist/src/revision'), base === app ? 'previous' : 'candidate')
        await writeFile(join(base, 'deploy/start.cjs'), '// startup\n')
      }
      await copyFile(join(root, 'scripts/check-runtime-dependencies.mjs'), join(candidate, 'scripts/check-runtime-dependencies.mjs'))
      await copyFile(join(root,'scripts/cleanup-deploy.mjs'),join(candidate,'scripts/cleanup-deploy.mjs'))
      await mkdir(join(home, 'managed-modules'))
      await symlink(join(home, 'managed-modules'), join(app, 'node_modules'))
      for (const path of ['.env', 'config/servers.json', 'data/oauth.sqlite']) {
        await mkdir(join(app, path, '..'), { recursive: true })
        await writeFile(join(app, path), `private:${path}`)
      }
      await mkdir(transfer, { recursive: true })
      assert.equal(spawnSync('tar', ['-czf', join(transfer, 'bundle.tar.gz'), '-C', candidate, '.']).status, 0)
      await mkdir(bin)
      // Only the provider restart and outbound HTTPS probes are simulated. File
      // transfer, code replacement, dependency validation and restoration are real.
      await writeFile(join(bin, 'cloudlinux-selector'), '#!/bin/bash\ncat "$HOME/node-apps/mcp/dist/src/revision" >> "$HOME/restarts"\nprintf "\\n" >> "$HOME/restarts"\necho \'{"result":"success"}\'\n', { mode: 0o700 })
      await writeFile(join(bin, 'node'), `#!/bin/bash\nif [[ "$1" = --env-file=.env ]]; then exit ${failVerification ? 1 : 0}; fi\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o700 })
      const result = spawnSync('bash', [join(root, 'deploy/remote.sh'), 'node-apps/mcp', join(bin, 'node'), '123-1'], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
      assert.equal(result.status, failVerification ? 1 : 0, result.stderr)
      assert.equal(await readFile(join(app, 'dist/src/revision'), 'utf8'), failVerification ? 'previous' : 'candidate')
      assert.equal(await readFile(join(home, 'restarts'), 'utf8'), failVerification ? 'candidate\nprevious\n' : 'candidate\n')
      for (const path of ['.env', 'config/servers.json', 'data/oauth.sqlite']) assert.equal(await readFile(join(app, path), 'utf8'), `private:${path}`)
      assert.equal(await readlink(join(app, 'node_modules')), join(home, 'managed-modules'))
      if(failVerification){assert((await lstat(join(transfer,'rollback.tar.gz'))).isFile());assert((await lstat(join(transfer,'stage'))).isDirectory())}
      else{await assert.rejects(lstat(transfer),{code:'ENOENT'});assert((await lstat(join(app,'.mcp-rollback/rollback.tar.gz'))).isFile());const previous=spawnSync('tar',['-xOzf',join(app,'.mcp-rollback/rollback.tar.gz'),'dist/src/revision'],{encoding:'utf8'});assert.equal(previous.stdout,'previous')}
      await assert.rejects(lstat(join(home,'.seohost-mcp-deploy/.lock')),{code:'ENOENT'})
    } finally { await rm(home, { recursive: true, force: true }) }
  })
}


test('deployment cleanup bounds release paths, preserves unknown folders and refuses symlink/private-state candidates',async()=>{
 const home=await mkdtemp(join(tmpdir(),'mcp-prune-'))
 try{
  const app=join(home,'node-apps/mcp'),parent=join(home,'.seohost-mcp-deploy'),current=join(parent,'200-1'),old=join(parent,'100-1')
  await mkdir(app,{recursive:true});await mkdir(current,{recursive:true});await mkdir(old)
  await writeFile(join(app,'.mcp-deploy-release'),'200-1\n');await writeFile(join(current,'rollback.tar.gz'),'verified code fixture')
  await mkdir(join(parent,'config-backups'));await writeFile(join(parent,'config-backups/keep'),'configuration sentinel')
  await writeFile(join(old,'bundle.tar.gz'),'disposable code fixture')
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/cleanup-deploy.mjs'),home,'node-apps/mcp','200-1'],{encoding:'utf8'})
  await writeFile(join(app,'.mcp-deploy-release'),'different-release\n');assert.notEqual(run().status,0);assert((await lstat(join(current,'rollback.tar.gz'))).isFile());await writeFile(join(app,'.mcp-deploy-release'),'200-1\n')
  const outside=join(home,'outside');await mkdir(outside);await writeFile(join(outside,'keep'),'outside sentinel');await symlink(outside,join(old,'escape'))
  assert.notEqual(run().status,0);assert.equal(await readFile(join(outside,'keep'),'utf8'),'outside sentinel');assert((await lstat(join(old,'bundle.tar.gz'))).isFile())
  await rm(join(old,'escape'));await rm(join(app,'.mcp-rollback'),{recursive:true})
  await writeFile(join(old,'.env'),'private sentinel');assert.notEqual(run().status,0);assert.equal(await readFile(join(old,'.env'),'utf8'),'private sentinel')
  await rm(join(old,'.env'));await rm(join(app,'.mcp-rollback'),{recursive:true})
  assert.equal(run().status,0);await assert.rejects(lstat(old),{code:'ENOENT'});await assert.rejects(lstat(current),{code:'ENOENT'})
  assert.equal(await readFile(join(parent,'config-backups/keep'),'utf8'),'configuration sentinel')
  assert.equal(await readFile(join(app,'.mcp-rollback/rollback.tar.gz'),'utf8'),'verified code fixture')
 }finally{await rm(home,{recursive:true,force:true})}
})
