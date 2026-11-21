import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkoutInfo, findProject, samePath } from '../standards/project-root.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const STARIZZI_ROOT = 'F:\\Ai Tools\\Tool Starizzi - B2C - Openclaw';
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'am-root-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;

test('a linked git worktree maps to the main checkout, keeping the subfolder', { skip: !hasGit && 'git not on PATH' }, () => {
  const main = join(scratch, 'main repo');
  mkdirSync(join(main, 'apps', 'desktop'), { recursive: true });
  git(main, 'init', '-q');
  writeFileSync(join(main, 'apps', 'desktop', 'a.txt'), 'x');
  git(main, 'add', '.');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  const wt = join(scratch, '_wt-slice');
  git(main, 'worktree', 'add', '-q', wt);

  const info = checkoutInfo(join(wt, 'apps', 'desktop'));
  assert.ok(samePath(info.root, main), `${info.root} should be ${main}`);
  assert.ok(samePath(info.path, join(main, 'apps', 'desktop')));
  assert.equal(info.worktree, true);

  const self = checkoutInfo(main);
  assert.ok(samePath(self.root, main));
  assert.equal(self.worktree, false);
});

test('a folder outside any git checkout maps to itself with no root', () => {
  const plain = join(scratch, 'plain', 'sub');
  mkdirSync(plain, { recursive: true });
  const info = checkoutInfo(plain);
  // tmpdir may itself sit inside a checkout on some machines; only assert when it does not.
  if (info.root === null) {
    assert.ok(samePath(info.path, plain));
    assert.equal(info.worktree, false);
  }
});

test('a .git file without commondir (submodule style) keeps its own folder as the root', () => {
  const sub = join(scratch, 'submodule');
  const gitdir = join(scratch, 'super', '.git', 'modules', 'submodule');
  mkdirSync(sub, { recursive: true });
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(sub, '.git'), `gitdir: ${gitdir.replace(/\\/g, '/')}\n`);
  const info = checkoutInfo(sub);
  assert.ok(samePath(info.root, sub));
  assert.equal(info.worktree, false);
});

test('an unreadable or odd .git file never throws', () => {
  const odd = join(scratch, 'odd');
  mkdirSync(odd, { recursive: true });
  writeFileSync(join(odd, '.git'), 'not a gitdir line');
  const info = checkoutInfo(odd);
  assert.ok(samePath(info.root, odd));
});

test('this repository resolves to the same main checkout git reports', { skip: !hasGit && 'git not on PATH' }, () => {
  const common = git(REPO_ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const info = checkoutInfo(join(REPO_ROOT, 'tools', 'agent-maturity'));
  assert.ok(samePath(info.root, dirname(resolve(common))), `${info.root} vs ${common}`);
});

test('the izzi-v2 slice worktree maps to the Starizzi root', { skip: !existsSync(STARIZZI_ROOT) && 'not on the owner machine' }, () => {
  const info = checkoutInfo(REPO_ROOT);
  assert.ok(samePath(info.root, STARIZZI_ROOT), `${REPO_ROOT} -> ${info.root}`);
});

test('findProject picks the longest registered root that contains the path, case-insensitive on Windows', () => {
  const projects = [
    { id: 'outer', root: join(scratch, 'ws') },
    { id: 'inner', root: join(scratch, 'ws', 'app') },
    { id: 'other', root: join(scratch, 'elsewhere') },
  ];
  assert.equal(findProject(projects, join(scratch, 'ws', 'app', 'src')).id, 'inner');
  assert.equal(findProject(projects, join(scratch, 'ws', 'docs')).id, 'outer');
  assert.equal(findProject(projects, join(scratch, 'ws-sibling')), null);
  assert.equal(findProject(projects, join(scratch)), null);
  if (process.platform === 'win32') assert.equal(findProject(projects, join(scratch, 'WS', 'APP')).id, 'inner');
  assert.equal(findProject([{ id: 'bad', root: 42 }, null], scratch), null);
});

test('findProject ignores registered folders above the git checkout boundary', () => {
  const parent = join(scratch, 'all-tools');
  const repo = join(parent, 'unregistered-repo');
  const projects = [{ id: 'parent', root: parent }, { id: 'sub', root: join(repo, 'apps') }];
  assert.equal(findProject(projects, join(repo, 'src'), repo), null);
  assert.equal(findProject(projects, join(repo, 'apps', 'x'), repo).id, 'sub');
  assert.equal(findProject(projects, join(repo, 'src')).id, 'parent', 'without a boundary the parent still matches');
});
