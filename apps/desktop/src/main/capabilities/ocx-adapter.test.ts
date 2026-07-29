import { describe, expect, it } from 'vitest';
import type { OcxManifest } from '../extensions/ocx-manifest';
import { buildCapabilityRegistry } from './registry';
import {
  OcxCapabilityAdapterError,
  adaptOcxManifestToCapabilityEnvelope,
} from './ocx-adapter';

function manifest(overrides: Partial<OcxManifest> = {}): OcxManifest {
  return {
    name: 'safe-panel',
    version: '1.0.0',
    displayName: 'Safe Panel',
    description: 'A host-mediated extension panel.',
    main: 'dist/index.js',
    engine: '>=0.1.0',
    author: { name: 'Starizzi Team' },
    permissions: ['ui.panel', 'storage.local', 'net.http'],
    activationEvents: ['onCommand:safe-panel.open'],
    contributes: {
      commands: [{ id: 'safe-panel.open', title: 'Open panel' }],
      panels: [{ id: 'safe-panel.main', title: 'Safe Panel', entry: 'panel' }],
    },
    categories: ['Utilities'],
    pricing: { model: 'free' },
    ...overrides,
  };
}

describe('.ocx capability adapter', () => {
  it('normalizes permissions and derives a validated managed-runtime capability', () => {
    const envelope = adaptOcxManifestToCapabilityEnvelope(manifest({
      service: {
        type: 'docker-compose',
        projectName: 'izzi-svc-safe-panel',
        compose: 'service/docker-compose.yml',
        ports: [{ name: 'api', container: 3001, bind: '127.0.0.1' }],
      },
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    });
    expect(envelope.declarations.map((declaration) => (
      `${declaration.kind}:${declaration.key}`
    ))).toEqual([
      'permission:net.http',
      'permission:storage.local',
      'permission:ui.panel',
      'runtime:managed_local_service',
    ]);

    const snapshot = buildCapabilityRegistry([envelope]);
    expect(snapshot.packages[0]?.skillPackage.requestedPermissions).toEqual([
      'net.http',
      'runtime.local_service',
      'storage.local',
      'ui.panel',
    ]);
  });

  it('rejects duplicate, wildcard, unknown and structurally missing permissions', () => {
    expect(() => adaptOcxManifestToCapabilityEnvelope(manifest({
      permissions: ['ui.panel', 'ui.panel'],
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    })).toThrowError(OcxCapabilityAdapterError);

    expect(() => adaptOcxManifestToCapabilityEnvelope(manifest({
      permissions: ['ui.*'],
      contributes: {},
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    })).toThrow(/Wildcard permission/);

    expect(() => adaptOcxManifestToCapabilityEnvelope(manifest({
      permissions: ['world.control'],
      contributes: {},
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    })).toThrow(/Unknown permissions/);

    expect(() => adaptOcxManifestToCapabilityEnvelope(manifest({
      permissions: ['storage.local'],
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    })).toThrow(/requires ui.panel/);
  });

  it('lets the registry reject known ambient-authority permissions', () => {
    const envelope = adaptOcxManifestToCapabilityEnvelope(manifest({
      permissions: ['fs.read'],
      contributes: {},
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    });
    expect(() => buildCapabilityRegistry([envelope])).toThrow(/no path scope/);
  });
});
