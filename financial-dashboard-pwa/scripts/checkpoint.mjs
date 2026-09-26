/**
 * One deliberate commit, on demand.
 *
 * This is the deliberate alternative to auto-committing on every save. Committing
 * continuously produces a history full of entries that do not build, which makes
 * `git bisect` useless and says nothing about why anything changed. A checkpoint
 * is taken when a unit of work actually works.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', args, { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

const status = git(['status', '--porcelain']);
if (!status) {
  console.log('Nothing to commit — the working tree is clean.');
  process.exit(0);
}

const changed = status.split('\n').filter(Boolean);
const added = changed.filter((line) => line.startsWith('??')).length;
const modified = changed.filter((line) => !line.startsWith('??')).length;
console.log(`${changed.length} path(s) changed: ${added} new, ${modified} existing.`);
console.log(changed.map((line) => `  ${line}`).join('\n'));

const message = process.argv.slice(2).join(' ').trim()
  || `Checkpoint ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

// Stage everything, so a checkpoint captures the whole state rather than a
// half-finished subset that the next command cannot reproduce.
git(['add', '-A']);
git(['commit', '-m', message]);

console.log(`\nCommitted: ${message}`);
console.log(`Short SHA: ${git(['rev-parse', '--short', 'HEAD'])}`);

// A push is the real offsite backup, so say so when there is something unpushed.
// `ahead` arrives as a string, and the string "0" is truthy, so it has to be
// compared as a number or a fully pushed branch still claims there is something
// to push.
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], true);
const ahead = Number(git(['rev-list', '--count', '@{upstream}..HEAD'], true)) || 0;
if (branch && ahead > 0) console.log(`${ahead} commit(s) ahead of origin/${branch} — run \`git push\` to back it up.`);

