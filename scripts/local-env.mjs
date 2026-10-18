import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const hostIndex = args.indexOf('--host');
const host = hostIndex >= 0 ? args[hostIndex + 1] : '127.0.0.1';
if (!host || !/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) {
  throw new Error('Use localhost or a private LAN IPv4 address for --host.');
}
const root = resolve(import.meta.dirname, '..');
const targets = ['.env.local', 'admin/.env.development.local', 'admin/.env.production.local'];
for (const target of targets) {
  if (existsSync(resolve(root, target)) && !args.includes('--force')) {
    throw new Error(`${target} exists. Review it, then pass --force to replace these local-only settings.`);
  }
}
const status = JSON.parse(execFileSync(resolve(root, 'node_modules/.bin/supabase'), ['status', '-o', 'json'], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
if (!status.ANON_KEY || !status.API_URL || !['localhost', '127.0.0.1'].includes(new URL(status.API_URL).hostname)) {
  throw new Error('Start the local backend first with npm run backend:start.');
}
const url = new URL(status.API_URL);
url.hostname = host;
writeFileSync(resolve(root, targets[0]), `# Generated for local development; never commit.\nEXPO_PUBLIC_BACKEND_MODE=local\nEXPO_PUBLIC_SUPABASE_URL=${url.origin}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}\nEXPO_PUBLIC_MAP_PROVIDER=openstreetmap\nEXPO_PUBLIC_ENABLE_PUSH=false\nEXPO_PUBLIC_ENABLE_OAUTH=false\n`);
for (const target of targets.slice(1)) {
  writeFileSync(resolve(root, target), `# Generated for local testing; never commit.\nNEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`);
}
console.log(`Configured local app (${url.origin}) and admin environments. Restart running dev servers.`);
