// Small helpers shared by the metrics command-line entry points.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// True when the module at metaUrl is the script node was started with (not imported by a test).
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  const self = path.resolve(fileURLToPath(metaUrl));
  const started = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

export function fail(message) {
  process.stderr.write(`${message}\n`);
  return 1;
}

// Never echoes file content: a JSON parse error message can quote the input.
export const reason = (error) => (error instanceof SyntaxError ? 'not valid JSON' : error.code ?? error.message);

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// A checker threshold in (0, 1]; null when the value is not one.
export function parseThreshold(value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  return n > 0 && n <= 1 ? n : null;
}
