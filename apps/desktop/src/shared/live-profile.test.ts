import { describe, expect, it } from 'vitest';
import {
  LiveProfileConflictError,
  LiveProfileValidationError,
  LIVE_CONTEXT_PRECEDENCE,
  applyUserDirective,
  createLiveProfileDocument,
  decideLiveProposal,
  effectiveLiveDirectives,
  parseLiveProfileMarkdown,
  proposeLiveDirective,
  replaceLiveProfileMarkdownDocument,
  serializeLiveProfileMarkdown,
  setLiveLearningConsent,
} from './live-profile';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };
const at = '2026-07-29T08:00:00.000Z';

describe('Live.md parsing and scope', () => {
  it('round-trips a strict workspace/user-scoped document', () => {
    const document = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      defaults: [
        {
          id: 'default-focus',
          kind: 'preference',
          key: 'focus-window',
          value: 'Protect mornings for focused work.',
        },
      ],
    });

    const parsed = parseLiveProfileMarkdown(serializeLiveProfileMarkdown(document), scope);

    expect(parsed).toEqual(document);
    expect(parsed.classification).toBe('personal_graph');
    expect(parsed.revision).toBe(1);
  });

  it('rejects a document when the persisted scope differs from the requested scope', () => {
    const document = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });
    const markdown = serializeLiveProfileMarkdown({
      ...document,
      scope: { workspaceId: 'other', ownerId: scope.ownerId },
    });

    expect(() => parseLiveProfileMarkdown(markdown, scope)).toThrow(LiveProfileValidationError);
  });

  it('rejects raw secrets while allowing opaque secret references', () => {
    expect(() =>
      createLiveProfileDocument({
        scope,
        documentRef: 'Live.md',
        now: at,
        defaults: [
          {
            id: 'bad-secret',
            kind: 'rule',
            key: 'credential',
            value: 'Use sk-example12345678901234567890 for requests.',
          },
        ],
      }),
    ).toThrow(LiveProfileValidationError);

    const safe = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      secretRefs: [
        {
          kind: 'secret-ref',
          store: 'os_keychain',
          ref: 'integration/github/token',
          scopes: ['repo:read'],
        },
      ],
    });
    expect(safe.secretRefs[0]?.ref).toBe('integration/github/token');
  });

  it('preserves user-authored Markdown around the profile payload', () => {
    const document = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });
    const original = serializeLiveProfileMarkdown(document).replace(
      '# Live\n',
      '# Live\n\n## Working notes\n\nKeep this prose exactly.\n',
    );
    const edited = applyUserDirective(document, {
      expectedRevision: 1,
      actor: { kind: 'user', id: scope.ownerId },
      id: 'user-format',
      kind: 'preference',
      key: 'format',
      value: 'Use short sections.',
      now: '2026-07-29T08:01:00.000Z',
    });

    const next = replaceLiveProfileMarkdownDocument(original, edited, scope);

    expect(next).toContain('## Working notes\n\nKeep this prose exactly.');
    expect(parseLiveProfileMarkdown(next, scope)).toEqual(edited);
  });

  it('rejects raw credential-shaped text anywhere in Live.md, not only in JSON', () => {
    const document = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });
    const unsafe = serializeLiveProfileMarkdown(document).replace(
      '# Live',
      '# Live\n\nTemporary token: sk-example12345678901234567890',
    );

    expect(() => parseLiveProfileMarkdown(unsafe, scope)).toThrow(LiveProfileValidationError);
  });
});

describe('Live.md precedence, proposals, and revisions', () => {
  it('publishes the complete context precedence contract for the later compiler', () => {
    expect(LIVE_CONTEXT_PRECEDENCE).toEqual([
      'safety-system',
      'current-user-request',
      'workspace-policy',
      'global-live-profile',
      'learned-preference',
      'model-default',
    ]);
  });

  it('lets a direct user value take precedence over an unsuperseded default', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      defaults: [
        {
          id: 'default-tone',
          kind: 'preference',
          key: 'writing-tone',
          value: 'Concise.',
        },
      ],
    });

    const edited = applyUserDirective(base, {
      expectedRevision: 1,
      actor: { kind: 'user', id: 'owner-7' },
      id: 'user-tone',
      kind: 'preference',
      key: 'writing-tone',
      value: 'Concise, with concrete examples.',
      now: '2026-07-29T08:01:00.000Z',
    });

    expect(edited.revision).toBe(2);
    expect(effectiveLiveDirectives(edited)).toMatchObject([
      {
        id: 'user-tone',
        source: 'user',
        value: 'Concise, with concrete examples.',
      },
    ]);
  });

  it('requires an agent proposal and an explicit user decision before truth changes', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });
    const proposed = proposeLiveDirective(base, {
      expectedRevision: 1,
      actor: { kind: 'agent', id: 'agent-editor' },
      id: 'proposal-1',
      kind: 'rule',
      key: 'review-before-send',
      value: 'Always review an external message before sending.',
      reason: 'Reduces accidental external effects.',
      now: '2026-07-29T08:02:00.000Z',
    });

    expect(proposed.revision).toBe(2);
    expect(effectiveLiveDirectives(proposed)).toEqual([]);
    expect(proposed.proposals[0]?.status).toBe('pending');

    const accepted = decideLiveProposal(proposed, {
      expectedRevision: 2,
      actor: { kind: 'user', id: 'owner-7' },
      proposalId: 'proposal-1',
      decision: 'accept',
      now: '2026-07-29T08:03:00.000Z',
    });

    expect(accepted.revision).toBe(3);
    expect(effectiveLiveDirectives(accepted)[0]).toMatchObject({
      key: 'review-before-send',
      source: 'accepted-proposal',
      value: 'Always review an external message before sending.',
    });
  });

  it('rejects stale writes and proposals whose base directive changed', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });
    const proposed = proposeLiveDirective(base, {
      expectedRevision: 1,
      actor: { kind: 'agent', id: 'agent-editor' },
      id: 'proposal-stale',
      kind: 'preference',
      key: 'working-hours',
      value: 'Start at 08:00.',
      reason: 'Observed preference.',
      now: '2026-07-29T08:01:00.000Z',
    });
    const userEdited = applyUserDirective(proposed, {
      expectedRevision: 2,
      actor: { kind: 'user', id: 'owner-7' },
      id: 'user-hours',
      kind: 'preference',
      key: 'working-hours',
      value: 'Start at 09:00.',
      now: '2026-07-29T08:02:00.000Z',
    });

    expect(() =>
      decideLiveProposal(userEdited, {
        expectedRevision: 3,
        actor: { kind: 'user', id: 'owner-7' },
        proposalId: 'proposal-stale',
        decision: 'accept',
        now: '2026-07-29T08:03:00.000Z',
      }),
    ).toThrow(LiveProfileConflictError);

    expect(() =>
      applyUserDirective(userEdited, {
        expectedRevision: 2,
        actor: { kind: 'user', id: 'owner-7' },
        id: 'bad-revision',
        kind: 'rule',
        key: 'stale',
        value: 'This must fail.',
        now: '2026-07-29T08:04:00.000Z',
      }),
    ).toThrow(LiveProfileConflictError);
  });

  it('keeps source learning opt-in off by default and user-controlled', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });

    expect(base.learningConsent).toEqual({
      email: false,
      browser: false,
      chat: false,
      file: false,
    });
    expect(() =>
      setLiveLearningConsent(base, {
        expectedRevision: 1,
        actor: { kind: 'agent', id: 'agent-editor' },
        source: 'email',
        enabled: true,
        now: '2026-07-29T08:01:00.000Z',
      }),
    ).toThrow(LiveProfileValidationError);

    const optedIn = setLiveLearningConsent(base, {
      expectedRevision: 1,
      actor: { kind: 'user', id: scope.ownerId },
      source: 'email',
      enabled: true,
      now: '2026-07-29T08:01:00.000Z',
    });
    const proposed = proposeLiveDirective(optedIn, {
      expectedRevision: 2,
      actor: { kind: 'agent', id: 'agent-editor' },
      id: 'email-tone',
      kind: 'preference',
      key: 'email-tone',
      value: 'Use a direct subject line.',
      reason: 'Repeated edits in sent mail.',
      sourceType: 'email',
      sourceRef: 'mail-thread:opaque-7',
      now: '2026-07-29T08:02:00.000Z',
    });

    expect(proposed.learningConsent.email).toBe(true);
    expect(proposed.proposals[0]).toMatchObject({
      status: 'pending',
      sourceType: 'email',
      sourceRef: 'mail-thread:opaque-7',
    });
    expect(effectiveLiveDirectives(proposed)).toEqual([]);

    const revoked = setLiveLearningConsent(proposed, {
      expectedRevision: 3,
      actor: { kind: 'user', id: scope.ownerId },
      source: 'email',
      enabled: false,
      now: '2026-07-29T08:03:00.000Z',
    });
    expect(revoked.learningConsent.email).toBe(false);
    expect(revoked.proposals[0]).toMatchObject({
      sourceType: 'email',
      sourceRef: 'mail-thread:opaque-7',
    });
    expect(() =>
      proposeLiveDirective(revoked, {
        expectedRevision: 4,
        actor: { kind: 'agent', id: 'agent-editor' },
        id: 'email-tone-2',
        kind: 'preference',
        key: 'email-tone',
        value: 'Use concise subjects.',
        reason: 'Observed later.',
        sourceType: 'email',
        sourceRef: 'mail-thread:opaque-8',
        now: '2026-07-29T08:04:00.000Z',
      }),
    ).toThrow(LiveProfileValidationError);
    expect(() =>
      decideLiveProposal(revoked, {
        expectedRevision: 4,
        actor: { kind: 'user', id: scope.ownerId },
        proposalId: 'email-tone',
        decision: 'accept',
        now: '2026-07-29T08:05:00.000Z',
      }),
    ).toThrow(LiveProfileValidationError);
    expect(
      decideLiveProposal(revoked, {
        expectedRevision: 4,
        actor: { kind: 'user', id: scope.ownerId },
        proposalId: 'email-tone',
        decision: 'reject',
        now: '2026-07-29T08:05:00.000Z',
      }).proposals[0]?.status,
    ).toBe('rejected');
  });

  it('excludes expired directives from effective truth at a requested time', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      defaults: [
        {
          id: 'normal-mode',
          kind: 'rule',
          key: 'launch-mode',
          value: 'Follow the normal work queue.',
        },
      ],
    });
    const temporary = applyUserDirective(base, {
      expectedRevision: 1,
      actor: { kind: 'user', id: scope.ownerId },
      id: 'temporary-rule',
      kind: 'rule',
      key: 'launch-mode',
      value: 'Pause non-launch work.',
      expiresAt: '2026-07-30T08:00:00.000Z',
      now: '2026-07-29T08:01:00.000Z',
    });

    expect(effectiveLiveDirectives(temporary, '2026-07-29T12:00:00.000Z')).toHaveLength(1);
    expect(effectiveLiveDirectives(temporary, '2026-07-31T08:00:00.000Z')).toMatchObject([
      { id: 'normal-mode', value: 'Follow the normal work queue.' },
    ]);
  });

  it('requires the exact profile owner for durable user changes', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
    });

    expect(() =>
      applyUserDirective(base, {
        expectedRevision: 1,
        actor: { kind: 'user', id: 'different-user' },
        id: 'foreign-change',
        kind: 'rule',
        key: 'scope',
        value: 'This must not persist.',
        now: '2026-07-29T08:01:00.000Z',
      }),
    ).toThrow(LiveProfileValidationError);
  });

  it('rejects an invalid runtime proposal decision instead of accepting it', () => {
    const proposed = proposeLiveDirective(
      createLiveProfileDocument({ scope, documentRef: 'Live.md', now: at }),
      {
        expectedRevision: 1,
        actor: { kind: 'agent', id: 'agent-editor' },
        id: 'runtime-decision',
        kind: 'preference',
        key: 'format',
        value: 'Use short sections.',
        reason: 'Observed editing pattern.',
        now: '2026-07-29T08:01:00.000Z',
      },
    );

    expect(() =>
      decideLiveProposal(proposed, {
        expectedRevision: 2,
        actor: { kind: 'user', id: scope.ownerId },
        proposalId: 'runtime-decision',
        decision: 'approve' as never,
        now: '2026-07-29T08:02:00.000Z',
      }),
    ).toThrow(LiveProfileValidationError);
  });
});
