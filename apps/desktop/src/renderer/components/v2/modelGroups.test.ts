import { describe, expect, it } from 'vitest';
import { MODEL_PROVIDERS } from '../../types/agent-registry';
import { modelGroupsFor } from './modelGroups';

describe('modelGroupsFor', () => {
  it('offers every hosted provider to izzi-runtime agents', () => {
    expect(modelGroupsFor('izzi', ['gpt-5.6-sol'], 'codex-lb (local)')).toBe(MODEL_PROVIDERS);
  });

  it('lists the local endpoint first and Izzi second for local agents', () => {
    const groups = modelGroupsFor('local', ['gpt-5.6-sol'], 'codex-lb (local)');

    expect(groups.map((group) => group.id)).toEqual(['custom', 'izzi']);
    expect(groups[0].name).toBe('codex-lb (local)');
  });

  it('keeps Izzi selectable when the local endpoint reports no models', () => {
    expect(modelGroupsFor(undefined, []).map((group) => group.id)).toEqual(['izzi']);
  });
});
