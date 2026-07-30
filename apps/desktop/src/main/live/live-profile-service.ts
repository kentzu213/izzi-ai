/**
 * Local Live.md persistence.
 *
 * The service is intentionally unwired from IPC in Loop 04 because main/index
 * and preload are outside the active lease. Callers must supply an exact
 * workspace/user scope and an already-authorized local root.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  LiveProfileConflictError,
  LiveProfileValidationError,
  applyUserDirective,
  createLiveProfileDocument,
  decideLiveProposal,
  parseLiveProfileMarkdown,
  proposeLiveDirective,
  replaceLiveProfileMarkdownDocument,
  sameLiveProfileScope,
  serializeLiveProfileMarkdown,
  setLiveLearningConsent,
  validateLiveProfileDocument,
  type ApplyUserDirectiveInput,
  type CreateLiveProfileInput,
  type DecideLiveProposalInput,
  type LiveProfileDocument,
  type LiveProfileScope,
  type ProposeLiveDirectiveInput,
  type SetLiveLearningConsentInput,
} from '../../shared/live-profile';
import { normalizeVaultRelativePath } from '../../shared/vault-types';

export interface LiveProfileFileServiceOptions {
  readonly rootDir: string;
  readonly scope: LiveProfileScope;
  readonly documentRef?: string;
}

type InitializeLiveProfileInput = Omit<CreateLiveProfileInput, 'scope' | 'documentRef'>;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function exactScope(scope: LiveProfileScope): LiveProfileScope {
  const workspaceId = scope.workspaceId.normalize('NFC').trim();
  const ownerId = scope.ownerId.normalize('NFC').trim();
  if (!workspaceId || !ownerId) {
    throw new LiveProfileValidationError(
      'invalid-scope',
      'LiveProfile storage requires an exact workspace and owner.',
    );
  }
  return { workspaceId, ownerId };
}

export class LiveProfileFileService {
  readonly rootDir: string;
  readonly scope: LiveProfileScope;
  readonly documentRef: string;
  readonly filePath: string;
  readonly lockPath: string;

  constructor(options: LiveProfileFileServiceOptions) {
    this.rootDir = resolve(options.rootDir);
    this.scope = exactScope(options.scope);
    this.documentRef = normalizeVaultRelativePath(options.documentRef ?? 'Live.md');
    this.filePath = resolve(this.rootDir, ...this.documentRef.split('/'));
    this.lockPath = `${this.filePath}.lock`;
    const rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;
    if (!this.filePath.startsWith(rootPrefix)) {
      throw new LiveProfileValidationError(
        'path-outside-root',
        'Live.md must remain inside the authorized workspace root.',
      );
    }
  }

  async read(): Promise<LiveProfileDocument | null> {
    let markdown: string;
    try {
      markdown = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
    return parseLiveProfileMarkdown(markdown, this.scope);
  }

  async initialize(input: InitializeLiveProfileInput): Promise<LiveProfileDocument> {
    const existing = await this.read();
    if (existing) return existing;
    const document = createLiveProfileDocument({
      ...input,
      scope: this.scope,
      documentRef: this.documentRef,
    });
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(this.filePath, serializeLiveProfileMarkdown(document), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return document;
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        const raced = await this.read();
        if (raced) return raced;
      }
      throw error;
    }
  }

  async applyUserDirective(input: ApplyUserDirectiveInput): Promise<LiveProfileDocument> {
    return this.mutate(input.expectedRevision, (current) => applyUserDirective(current, input));
  }

  async proposeDirective(input: ProposeLiveDirectiveInput): Promise<LiveProfileDocument> {
    return this.mutate(input.expectedRevision, (current) => proposeLiveDirective(current, input));
  }

  async decideProposal(input: DecideLiveProposalInput): Promise<LiveProfileDocument> {
    return this.mutate(input.expectedRevision, (current) => decideLiveProposal(current, input));
  }

  async setLearningConsent(input: SetLiveLearningConsentInput): Promise<LiveProfileDocument> {
    return this.mutate(input.expectedRevision, (current) => setLiveLearningConsent(current, input));
  }

  async exportMarkdown(): Promise<string> {
    const markdown = await readFile(this.filePath, 'utf8');
    parseLiveProfileMarkdown(markdown, this.scope);
    return markdown;
  }

  private async mutate(
    expectedRevision: number,
    mutation: (current: LiveProfileDocument) => LiveProfileDocument,
  ): Promise<LiveProfileDocument> {
    await mkdir(dirname(this.filePath), { recursive: true });
    let lock: Awaited<ReturnType<typeof open>>;
    try {
      lock = await open(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new LiveProfileConflictError(
          'write-in-progress',
          'Another Live.md update is in progress. Reload before writing.',
        );
      }
      throw error;
    }

    try {
      const markdown = await readFile(this.filePath, 'utf8');
      const current = parseLiveProfileMarkdown(markdown, this.scope);
      if (current.revision !== expectedRevision) {
        throw new LiveProfileConflictError(
          'revision-conflict',
          `Live.md revision changed from ${expectedRevision} to ${current.revision}. Reload before writing.`,
        );
      }
      const next = validateLiveProfileDocument(mutation(current));
      if (!sameLiveProfileScope(current.scope, next.scope)) {
        throw new LiveProfileValidationError(
          'scope-mismatch',
          'A Live.md update cannot change workspace or owner scope.',
        );
      }
      if (next.documentRef !== this.documentRef) {
        throw new LiveProfileValidationError(
          'document-ref-mismatch',
          'A Live.md update cannot change its document reference.',
        );
      }
      if (next.revision !== current.revision + 1) {
        throw new LiveProfileConflictError(
          'invalid-next-revision',
          'A Live.md update must advance the revision exactly once.',
        );
      }
      const updatedMarkdown = replaceLiveProfileMarkdownDocument(markdown, next, this.scope);
      await this.writeAtomically(updatedMarkdown);
      return next;
    } finally {
      await lock.close().catch(() => undefined);
      await rm(this.lockPath, { force: true }).catch(() => undefined);
    }
  }

  private async writeAtomically(markdown: string): Promise<void> {
    const temporaryPath = resolve(
      dirname(this.filePath),
      `.${this.documentRef.split('/').at(-1)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, markdown, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
