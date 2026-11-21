// Shared file helpers for the D0 eval scripts. Messages never quote file content.
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

export function parseJsonl(content, name) {
  const rows = [];
  content.replace(/^\uFEFF/, '').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error(`${name}:${i + 1}: invalid JSON`);
    }
  });
  return rows;
}

export const readJsonl = (file) => parseJsonl(fs.readFileSync(file, 'utf8'), path.basename(file));

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Real prompt text must never land in the repo: outputs that can hold it are refused there.
export function assertOutsideRepo(target, repoRoot = REPO_ROOT) {
  const rel = path.relative(repoRoot, path.resolve(target));
  if (rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel))) {
    throw new Error(`refusing to write inside the repo: ${target}`);
  }
}

export const invokedDirectly = (filename) =>
  Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === filename.toLowerCase();

export function runMain(main) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}
