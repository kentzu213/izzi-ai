/*
 * Decorative tile colour for a project: a stable index into the six
 * `.v2-tile--tone-N` classes, derived from the project id alone.
 */

export const PROJECT_TONE_COUNT = 6;

export function projectTone(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % PROJECT_TONE_COUNT;
}
