import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertOutsideRepo } from '../eval/io.mjs';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-io-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('refuses a path inside this repo', () => {
  assert.throws(() => assertOutsideRepo(join(REPO, 'tmp-d0', 'review.md')), /inside the repo/);
  assert.throws(() => assertOutsideRepo(REPO), /inside the repo/);
});

test('refuses a path inside any other git work tree: .git folder or .git file (worktree), even if not created yet', () => {
  const clone = join(scratch, 'other-clone');
  mkdirSync(join(clone, '.git'), { recursive: true });
  assert.throws(() => assertOutsideRepo(join(clone, 'deep', 'new', 'review.md')), /inside a git work tree/);
  const worktree = join(scratch, 'other-worktree');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, '.git'), 'gitdir: elsewhere\n');
  assert.throws(() => assertOutsideRepo(join(worktree, 'out')), /inside a git work tree/);
});

test('accepts a path outside every git work tree', () => {
  assert.doesNotThrow(() => assertOutsideRepo(join(scratch, 'private', 'review.md')));
});
