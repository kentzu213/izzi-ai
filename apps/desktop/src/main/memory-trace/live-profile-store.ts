// CMR-224 Slice 1 — Live.md store, main process only.
//
// One writer, atomic replace, and a hard refusal to overwrite a file we could
// not parse. The operator's own words are the thing most expensive to lose, so
// every failure path here leaves the existing file exactly as it was.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LIVE_PROFILE_FILE_NAME,
  createLiveProfile,
  liveProfileSourceId,
  nextLiveProfileRevision,
  parseLiveProfile,
  serializeLiveProfile,
  type LiveProfileReadResult,
  type LiveProfileWriteResult,
} from '../../shared/memory-trace/live-profile';
import {
  parseTraceUnit,
  type TraceUnit,
} from '../../shared/memory-trace/trace-unit';

export interface LiveProfileStoreOptions {
  /** Directory that holds Live.md. Normally the Electron userData path. */
  readonly directory: string;
  readonly now?: () => string;
}

export class LiveProfileStore {
  private readonly filePath: string;
  private readonly now: () => string;

  constructor(private readonly options: LiveProfileStoreOptions) {
    this.filePath = path.join(options.directory, LIVE_PROFILE_FILE_NAME);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get path(): string {
    return this.filePath;
  }

  read(): LiveProfileReadResult {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      return {
        status: code === 'ENOENT' ? 'absent' : 'unreadable',
        profile: null,
        filePath: this.filePath,
      };
    }

    const profile = parseLiveProfile(raw);
    return {
      status: profile ? 'ok' : 'unreadable',
      profile,
      filePath: this.filePath,
    };
  }

  /**
   * Creates Live.md from the template only when it is absent. An existing file,
   * even an unreadable one, is left untouched.
   */
  ensure(): LiveProfileReadResult {
    const current = this.read();
    if (current.status !== 'absent') return current;

    const created = createLiveProfile(undefined, this.now());
    const written = this.replaceFile(serializeLiveProfile(created));
    if (!written) {
      return { status: 'unreadable', profile: null, filePath: this.filePath };
    }
    return { status: 'ok', profile: created, filePath: this.filePath };
  }

  /**
   * Replaces the body and bumps the revision. Refuses when the current file
   * cannot be parsed, so a write never destroys content this build did not
   * understand.
   */
  write(body: string): LiveProfileWriteResult {
    const current = this.read();
    if (current.status === 'unreadable') {
      return { status: 'unreadable', profile: null };
    }

    const base = current.profile ?? createLiveProfile(body, this.now());
    const next = current.profile
      ? nextLiveProfileRevision(current.profile, body, this.now())
      : base;
    if (!next) return { status: 'rejected', profile: null };

    return this.replaceFile(serializeLiveProfile(next))
      ? { status: 'ok', profile: next }
      : { status: 'io_error', profile: null };
  }

  /**
   * The profile as an admissible trace unit, or null when it cannot be read.
   * The classification keeps it local: this text never leaves the machine.
   */
  asTraceUnit(boundaryId: string): TraceUnit | null {
    const current = this.read();
    if (current.status !== 'ok' || !current.profile) return null;
    if (current.profile.body.trim().length === 0) return null;

    return parseTraceUnit({
      schemaVersion: 1,
      id: liveProfileSourceId(current.profile),
      text: current.profile.body,
      actor: 'user',
      classification: 'live_profile',
      provenance: {
        sourceId: liveProfileSourceId(current.profile),
        sourceKind: 'live_profile',
        boundaryId,
        observedAt: current.profile.updatedAt,
      },
    });
  }

  private replaceFile(contents: string): boolean {
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(this.options.directory, { recursive: true });
      fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8' });
      fs.renameSync(temporaryPath, this.filePath);
      return true;
    } catch {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // The durable file is already intact; a stray temp file is not worth
        // failing the caller over.
      }
      return false;
    }
  }
}
