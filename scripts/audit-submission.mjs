import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['secret API key', /(?:sb_secret_|sk_live_)[A-Za-z0-9_-]{20,}/],
];
function findings(content) {
  const found = patterns.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
  for (const token of content.match(/eyJhbGciOi[A-Za-z0-9_.-]+/g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role === 'service_role') found.push('service-role JWT');
    } catch { /* Not a JWT. */ }
  }
  return [...new Set(found)];
}
let count = 0;
const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
for (const path of new Set(paths)) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path);
  if (content.includes(0)) continue;
  for (const kind of findings(content.toString())) {
    console.log(`CURRENT: ${kind} in ${path}`);
    count++;
  }
}
const objects = git('rev-list', '--objects', '--all').trim().split('\n');
const seen = new Set();
for (const line of objects) {
  const [oid, ...parts] = line.split(' ');
  const path = parts.join(' ');
  if (!path || seen.has(oid) || !/\.(?:json|[cm]?js|tsx?|sql|toml|ya?ml|md|env|pem|key)$|(?:^|\/)\.env/.test(path)) continue;
  seen.add(oid);
  const content = git('show', oid);
  for (const kind of findings(content)) {
    console.log(`HISTORY: ${kind} in ${path} (blob ${oid.slice(0, 12)})`);
    count++;
  }
}
console.log(`Scanned working files and ${seen.size} historical text blobs. ${count} finding(s). Values are never printed.`);
console.log('Pattern scanning is a review aid, not proof that the repository is free of secrets or personal data.');
if (count) process.exitCode = 1;
