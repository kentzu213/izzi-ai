import { describe, expect, it } from 'vitest';
import { describeLiveProfile, describeLiveProfileWrite } from './live-profile-view';
import { MEMORY_TRACE_SCHEMA_VERSION } from '../../shared/memory-trace/trace-unit';
import type { LiveProfile } from '../../shared/memory-trace/live-profile';

const profile: LiveProfile = {
  schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
  revision: 4,
  updatedAt: '2026-08-05T10:00:00.000Z',
  body: '# Live\n\nTôi đang dựng phòng marketing.\n',
};

describe('describeLiveProfile', () => {
  it('offers editing and shows the operator body when the file parses', () => {
    const view = describeLiveProfile({
      status: 'ok',
      profile,
      filePath: 'C:/userData/Live.md',
    });

    expect(view.canEdit).toBe(true);
    expect(view.body).toBe(profile.body);
    expect(view.revisionLabel).toBe('bản 4');
    expect(view.tone).toBe('normal');
    expect(view.hint).toContain('không đồng bộ');
  });

  it('refuses to offer a save when the file cannot be parsed', () => {
    const view = describeLiveProfile({
      status: 'unreadable',
      profile: null,
      filePath: 'C:/userData/Live.md',
    });

    expect(view.canEdit).toBe(false);
    // Showing an empty editor over an unreadable file would invite the operator
    // to overwrite words we failed to read.
    expect(view.body).toBe('');
    expect(view.tone).toBe('warning');
  });

  it('does not offer a save when status is ok but no profile came back', () => {
    const view = describeLiveProfile({
      status: 'ok',
      profile: null,
      filePath: 'C:/userData/Live.md',
    });

    expect(view.canEdit).toBe(false);
  });

  it('distinguishes an absent file from an unreadable one', () => {
    const absent = describeLiveProfile({
      status: 'absent',
      profile: null,
      filePath: 'C:/userData/Live.md',
    });

    expect(absent.headline).not.toBe(
      describeLiveProfile({ status: 'unreadable', profile: null, filePath: 'x' }).headline,
    );
  });
});

describe('describeLiveProfileWrite', () => {
  it('reports the new revision after a successful save', () => {
    const result = describeLiveProfileWrite({ status: 'ok', profile });
    expect(result.tone).toBe('normal');
    expect(result.message).toContain('bản 4');
  });

  it('says the old content survived on every failure', () => {
    for (const status of ['rejected', 'unreadable', 'io_error'] as const) {
      const result = describeLiveProfileWrite({ status, profile: null });
      expect(result.tone).toBe('warning');
      expect(result.message).toContain('còn nguyên');
    }
  });
});
