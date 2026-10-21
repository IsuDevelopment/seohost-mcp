// Passenger / lsnode: keep the listener in this process and load private runtime env.
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
import('../dist/src/http.js')
  .then(module => module.startHttpServer())
  .catch(() => { console.error('MCP startup failed; check configuration'); process.exitCode = 1; });
