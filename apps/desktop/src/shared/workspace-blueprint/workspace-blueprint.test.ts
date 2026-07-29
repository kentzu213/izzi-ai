import { describe, expect, it } from 'vitest';
import {
  WorkspaceBlueprintValidationError,
  parseWorkspaceBlueprintDescriptor,
} from '.';

const DIGEST = `sha256:${'a'.repeat(64)}`;

export function trustedBlueprintInput() {
  return {
    schemaVersion: 1,
    descriptorVersion: '1.0.0',
    id: 'blueprint:personal-office',
    blueprintVersion: '2.1.0',
    name: 'Personal office',
    description: 'A reviewed single-operator workspace.',
    availability: 'host_verified',
    evidenceDigest: DIGEST,
    apps: [{
      appId: 'app:documents',
      packageId: 'ocx_extension:documents@1.2.0',
      packageVersion: '1.2.0',
      displayName: 'Documents',
      trustZone: 'extension_package',
      dataClassifications: ['artifacts', 'local_files'],
      expectedSideEffects: ['local_write'],
    }],
    requiredIntegrationGrants: [{
      integration: 'google-drive',
      grantRef: 'integration-grant:google-drive',
    }],
  };
}

describe('workspace blueprint descriptor', () => {
  it('parses exact trusted metadata and freezes deterministic arrays', () => {
    const blueprint = parseWorkspaceBlueprintDescriptor(
      trustedBlueprintInput(),
      { boundary: 'host_validated', expectedEvidenceDigest: DIGEST },
    );

    expect(blueprint.availability).toBe('host_verified');
    expect(blueprint.apps[0].dataClassifications).toEqual(['artifacts', 'local_files']);
    expect(Object.isFrozen(blueprint)).toBe(true);
  });

  it('rejects unknown, authority-bearing, wildcard, malformed and secret-shaped input', () => {
    const cases = [
      { ...trustedBlueprintInput(), command: 'powershell' },
      { ...trustedBlueprintInput(), installed: true },
      { ...trustedBlueprintInput(), blueprintVersion: 'latest' },
      {
        ...trustedBlueprintInput(),
        apps: [{
          ...trustedBlueprintInput().apps[0],
          packageVersion: '9.9.9',
        }],
      },
      { ...trustedBlueprintInput(), id: '*' },
      { ...trustedBlueprintInput(), id: `sk-${'x'.repeat(24)}` },
    ];

    for (const input of cases) {
      expect(() => parseWorkspaceBlueprintDescriptor(
        input,
        { boundary: 'host_validated', expectedEvidenceDigest: DIGEST },
      )).toThrowError(WorkspaceBlueprintValidationError);
    }
  });

  it('keeps demo, offline and unavailable provenance explicit and non-verified', () => {
    for (const boundary of ['demo', 'offline', 'unavailable'] as const) {
      const input = {
        ...trustedBlueprintInput(),
        availability: boundary,
        evidenceDigest: undefined,
      };
      expect(
        parseWorkspaceBlueprintDescriptor(input, { boundary }).availability,
      ).toBe(boundary);
    }

    expect(() => parseWorkspaceBlueprintDescriptor(
      trustedBlueprintInput(),
      { boundary: 'demo' },
    )).toThrow(/cannot claim host_verified/);
  });
});
