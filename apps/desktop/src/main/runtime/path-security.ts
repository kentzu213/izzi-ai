import * as path from 'path';
import * as fs from 'fs';

export class RuntimePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePathError';
  }
}
export interface RealPathResolver {
  readonly realpath: (candidate: string) => string;
}

const defaultResolver: RealPathResolver = {
  realpath: (candidate) => fs.realpathSync.native(candidate),
};

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolve both sides before comparing so a junction/symlink inside an allowed
 * directory cannot point execution or uploads outside it.
 */
export function assertRealPathContained(
  label: string,
  candidate: string,
  allowedRoots: readonly string[],
  resolver: RealPathResolver = defaultResolver,
): string {
  let realCandidate: string;
  try {
    realCandidate = resolver.realpath(candidate);
  } catch {
    throw new RuntimePathError(`${label} does not exist or cannot be resolved`);
  }
  for (const root of allowedRoots) {
    let realRoot: string;
    try {
      realRoot = resolver.realpath(root);
    } catch {
      continue;
    }
    if (contains(realRoot, realCandidate)) return realCandidate;
  }
  throw new RuntimePathError(`${label} escapes its owned roots`);
}
