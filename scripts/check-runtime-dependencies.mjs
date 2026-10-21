import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// CloudLinux owns the application's node_modules symlink. Code-only deployments
// must use exactly the production dependency graph that is already installed.
export async function checkRuntimeDependencies(candidate, appRoot) {
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
  const next = await readJson(candidate)
  const current = await readJson(join(appRoot, 'package-lock.json'))
  const graph = lock => {
    if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('Expected a v3 lockfile')
    return Object.fromEntries(Object.entries(lock.packages)
      .filter(([path, pkg]) => path && !pkg.dev)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, pkg]) => [path, [pkg.version, pkg.resolved, pkg.integrity, !!pkg.optional]]))
  }
  const expected = graph(next)
  if (JSON.stringify(expected) !== JSON.stringify(graph(current))) {
    throw new Error('Production dependencies changed. Deploy this dependency update manually through the hosting panel first.')
  }
  for (const [path, [version, , , optional]] of Object.entries(expected)) {
    if (!/^node_modules\//.test(path) || path.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid dependency path')
    let installed
    try { installed = await readJson(join(appRoot, path, 'package.json')) }
    catch (error) { if (optional && error.code === 'ENOENT') continue; throw new Error('A production dependency is missing') }
    if (installed.version !== version) throw new Error('Installed production dependencies do not match the lockfile')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkRuntimeDependencies(process.argv[2], process.argv[3])
    console.log('PASS: installed production dependencies match the release')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
