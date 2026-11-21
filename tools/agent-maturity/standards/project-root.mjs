// Maps a folder to its main git checkout, so a linked worktree (for example F:/Ai Tools/_wt-izzi-v2-d3) counts
// as the project it was made from. KnowledgeMemory gives each worktree its own project id, and dev standards
// are written for the main checkout only (docs/izzi-v2/PLAN.md §2.5). File reads only: no git process, no
// network, never throws. Used by the SessionStart hook and by store-cli.mjs.

import fs from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 64;
const MAX_GIT_FILE_BYTES = 4096;

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

const norm = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

export const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && norm(a) === norm(b);

export function isInside(child, parent) {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readSmall(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(MAX_GIT_FILE_BYTES);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, MAX_GIT_FILE_BYTES, 0));
  } finally {
    fs.closeSync(fd);
  }
}

// A linked worktree's .git file points at <main>/.git/worktrees/<name>, whose commondir file leads back to
// <main>/.git. Without commondir (submodule, plain gitdir link) or with a bare common dir, the folder is its own root.
function mainRootFromGitFile(dir, dotGit) {
  try {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readSmall(dotGit));
    if (!match) return dir;
    const gitdir = path.resolve(dir, match[1]);
    const common = path.resolve(gitdir, readSmall(path.join(gitdir, 'commondir')).trim());
    return path.basename(common).toLowerCase() === '.git' ? real(path.dirname(common)) : dir;
  } catch {
    return dir;
  }
}

// { root, path, worktree }: root is the main checkout (null outside git); path is the same subfolder inside it.
export function checkoutInfo(dir) {
  const start = real(dir);
  let current = start;
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    let stat = null;
    try {
      stat = fs.statSync(path.join(current, '.git'));
    } catch {
      stat = null;
    }
    if (stat) {
      const root = stat.isFile() ? mainRootFromGitFile(current, path.join(current, '.git')) : current;
      return { root, path: path.join(root, path.relative(current, start)), worktree: !samePath(root, current) };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { root: null, path: start, worktree: false };
}

// The registered project whose root contains `target`, preferring the longest (most specific) root. With a
// `boundary` (the main git checkout), roots above it are ignored: F:/Ai Tools is registered too, and its
// standards must not reach an unregistered repo below it.
export function findProject(projects, target, boundary = null) {
  let best = null;
  for (const p of Array.isArray(projects) ? projects : []) {
    if (!p || typeof p.root !== 'string' || typeof p.id !== 'string') continue;
    if (!isInside(target, p.root)) continue;
    if (typeof boundary === 'string' && !isInside(p.root, boundary)) continue;
    if (!best || norm(p.root).length > norm(best.root).length) best = p;
  }
  return best;
}
