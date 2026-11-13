// Run `npm install` only when the dependency list changed since the last install
// (or node_modules is missing). On Windows, an npm install with nothing to do can
// still take many seconds, so the start scripts call this instead.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const lock = existsSync('package-lock.json') ? readFileSync('package-lock.json') : readFileSync('package.json');
const hash = createHash('sha256').update(lock).digest('hex');
const stamp = 'node_modules/.install-stamp';
if (existsSync('node_modules') && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) {
  console.log('Dependencies up to date.');
} else {
  console.log('Installing dependencies...');
  execSync('npm install --no-fund --no-audit', { stdio: 'inherit' });
  writeFileSync(stamp, hash);
}
