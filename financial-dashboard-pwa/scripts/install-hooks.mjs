/**
 * Point git at the tracked hooks in this repo.
 *
 * `core.hooksPath` is the zero-dependency alternative to husky: the hook scripts
 * are ordinary files in the repository, so unlike `.git/hooks/` they survive a
 * fresh clone, and nothing needs installing to make them executable.
 *
 * The path is resolved from the git top level, not the package directory, so it
 * has to be written relative to that. This runs from `npm install` via the
 * `prepare` script, which is also what makes it automatic on a new clone.
 *
 * The browser download is deliberately left to an explicit `npm run setup`:
 * `prepare` runs on every `npm ci`, including in CI, and a ~300 MB download
 * there would be surprising and slow.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function git(args, allowFailure = false) {
  try {
    return execFileSync('git', args, { cwd: PACKAGE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

/** True when this directory is inside a git work tree. */
function inGitCheckout() {
  try {
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: PACKAGE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

const PACKAGE_DIR = join(here, '..');

if (!inGitCheckout()) {
  // Not an error: `npm ci` runs in published tarballs and in CI checkouts that
  // are not work trees. Failing here would break installs for no reason.
  console.log('prepare: skipped git hooks (not a git checkout)');
  process.exit(0);
}

try {
  const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: PACKAGE_DIR, encoding: 'utf8' }).trim();
  // `here` is already the scripts directory, so the hooks sit beside this file.
  const hooksDir = join(here, 'git-hooks');
  // Git resolves a relative core.hooksPath from the top level, not the cwd, so
  // it must be written relative to that.
  const configured = relative(topLevel, hooksDir).split(sep).join('/');

  // Git silently skips a hook that is not executable, so the bit has to be set.
  for (const name of ['pre-commit']) {
    try { chmodSync(join(hooksDir, name), 0o755); } catch { /* best effort */ }
  }

  // `git config --get` exits non-zero when the key is unset, which is the normal
  // first-run case, so this read has to tolerate failure.
  const current = git(['config', '--get', 'core.hooksPath'], true);
  if (current === configured) {
    console.log('prepare: git hooks already installed');
  } else {
    git(['config', 'core.hooksPath', configured]);
    console.log(`prepare: installed git hooks (core.hooksPath = ${configured})`);
  }
} catch (error) {
  console.log(`prepare: could not install git hooks — ${String(error.message || error).split('\n')[0]}`);
}

