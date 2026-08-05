// CMR-224 Slice 1 — Live.md contract.
//
// Live.md is the one file the operator edits by hand. It holds what they want,
// in their own words, and the agent reads it as a first-class trace source. Both
// sides read and write the same bytes, so there is no separate "AI version" of
// the operator's intent.
//
// The frontmatter is intentionally minimal scalar lines rather than full YAML:
// it keeps the file hand-editable, and it avoids adding a parser dependency for
// three fields.

import { MEMORY_TRACE_SCHEMA_VERSION } from './trace-unit';

export const LIVE_PROFILE_FILE_NAME = 'Live.md';

export interface LiveProfile {
  readonly schemaVersion: typeof MEMORY_TRACE_SCHEMA_VERSION;
  /** Monotonic, incremented on every accepted write. */
  readonly revision: number;
  /** ISO-8601 instant of the last accepted write. */
  readonly updatedAt: string;
  /** Markdown the operator owns. Never rewritten by a model. */
  readonly body: string;
}

const FRONTMATTER_FENCE = '---';
const MAX_BODY_LENGTH = 256_000;
const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const LIVE_PROFILE_TEMPLATE_BODY = [
  '# Live',
  '',
  'Đây là file của bạn. Viết bằng lời của bạn, không cần đúng thuật ngữ.',
  'Agent đọc file này trước khi bắt đầu việc mới.',
  '',
  '## Tôi đang làm gì',
  '',
  '## Cách tôi muốn được hỗ trợ',
  '',
  '## Điều tuyệt đối không được làm',
  '',
].join('\n');

function splitFrontmatter(raw: string): { header: string[]; body: string } | null {
  // Tolerate a UTF-8 BOM and CRLF, because this file is hand-edited on Windows.
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return null;

  const closingIndex = lines.indexOf(FRONTMATTER_FENCE, 1);
  if (closingIndex === -1) return null;

  return {
    header: lines.slice(1, closingIndex),
    body: lines.slice(closingIndex + 1).join('\n'),
  };
}

function readScalar(header: readonly string[], key: string): string | null {
  const prefix = `${key}:`;
  let found: string | null = null;
  for (const line of header) {
    if (!line.startsWith(prefix)) continue;
    // A duplicated key is ambiguous; refuse rather than pick one.
    if (found !== null) return null;
    found = line.slice(prefix.length).trim();
  }
  return found;
}

/**
 * Returns null when the file is not a Live.md this build understands. The caller
 * must then leave the file untouched: refusing to write is safer than
 * overwriting something the operator wrote that we failed to read.
 */
export function parseLiveProfile(raw: unknown): LiveProfile | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const split = splitFrontmatter(raw);
  if (!split) return null;

  const schemaVersionRaw = readScalar(split.header, 'schemaVersion');
  const revisionRaw = readScalar(split.header, 'revision');
  const updatedAt = readScalar(split.header, 'updatedAt');

  if (schemaVersionRaw === null || revisionRaw === null || updatedAt === null) return null;
  if (!/^[0-9]+$/.test(schemaVersionRaw) || !/^[0-9]+$/.test(revisionRaw)) return null;

  const schemaVersion = Number(schemaVersionRaw);
  const revision = Number(revisionRaw);
  if (schemaVersion !== MEMORY_TRACE_SCHEMA_VERSION) return null;
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > MAX_REVISION) return null;
  if (!ISO_INSTANT_PATTERN.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) return null;
  if (split.body.length > MAX_BODY_LENGTH) return null;

  return {
    schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
    revision,
    updatedAt,
    body: split.body,
  };
}

export function serializeLiveProfile(profile: LiveProfile): string {
  const body = profile.body.replace(/\r\n/g, '\n');
  return [
    FRONTMATTER_FENCE,
    `schemaVersion: ${MEMORY_TRACE_SCHEMA_VERSION}`,
    `revision: ${profile.revision}`,
    `updatedAt: ${profile.updatedAt}`,
    FRONTMATTER_FENCE,
    body,
  ].join('\n');
}

export function createLiveProfile(
  body: string = LIVE_PROFILE_TEMPLATE_BODY,
  nowIso: string = new Date().toISOString(),
): LiveProfile {
  return {
    schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
    revision: 1,
    updatedAt: nowIso,
    body,
  };
}

/**
 * Next revision of an existing profile. Rejects a body that is too large rather
 * than truncating the operator's text.
 */
export function nextLiveProfileRevision(
  current: LiveProfile,
  body: string,
  nowIso: string = new Date().toISOString(),
): LiveProfile | null {
  if (typeof body !== 'string' || body.length > MAX_BODY_LENGTH) return null;
  if (current.revision >= MAX_REVISION) return null;
  return {
    schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
    revision: current.revision + 1,
    updatedAt: nowIso,
    body,
  };
}

/**
 * Citation-stable source id for the profile at a given revision, so evidence
 * drawn from Live.md points at the exact revision it was read from.
 */
export function liveProfileSourceId(profile: LiveProfile): string {
  return `${LIVE_PROFILE_FILE_NAME}#rev${profile.revision}`;
}
