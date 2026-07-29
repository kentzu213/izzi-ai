import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createMarketplaceInstallPlan,
  createMarketplaceDemoCatalog,
  parseMarketplaceCatalog,
  type MarketplaceCatalog,
} from '../../../shared/marketplace';
import {
  MarketplacePageView,
  type MarketplacePageViewProps,
} from './MarketplacePageView';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const FINGERPRINT = `sha256:${'b'.repeat(64)}`;
const noOp = () => undefined;

function trustedCatalog(
  compatibility: 'compatible' | 'incompatible' = 'compatible',
): MarketplaceCatalog {
  return parseMarketplaceCatalog({
    schemaVersion: 1,
    catalogVersion: '1.0.0',
    generatedAt: '2026-07-29T02:00:00.000Z',
    source: {
      kind: 'remote',
      connection: 'online',
      retrievedAt: '2026-07-29T02:05:00.000Z',
    },
    packages: [{
      identity: {
        sourceKind: 'ocx_extension',
        packageName: 'reviewed-package',
        packageVersion: '1.2.3',
        packageKey: 'ocx_extension:reviewed-package@1.2.3',
      },
      displayName: 'Reviewed package',
      summary: 'A host-validated package for component review.',
      publisher: 'Verified publisher',
      category: 'Operations',
      signatureDigest: DIGEST,
      verification: 'host_verified',
      registrySchemaVersion: 1,
      registryVersion: '1.1.0',
      registryDigest: DIGEST,
      packageId: 'skill-package:ocx_extension:reviewed-package@1.2.3',
      compatibility: compatibility === 'compatible'
        ? {
            state: 'compatible',
            desktopVersion: '1.14.0-beta.3',
            minimumDesktopVersion: '1.0.0',
          }
        : {
            state: 'incompatible',
            desktopVersion: '1.14.0-beta.3',
            minimumDesktopVersion: '2.0.0',
            reason: 'Requires desktop 2.0.0 or newer.',
          },
      installation: {
        state: 'not_installed',
      },
      capabilities: [{
        capabilityId: 'tool:reviewed:net.http',
        name: 'reviewed-package:net.http',
        description: 'Make host-mediated HTTP requests using public metadata only.',
        requiredPermission: 'net.http',
        trustZone: 'extension_package',
        dataClassifications: ['public_metadata'],
        sideEffects: ['external_action', 'network_egress'],
        permissionRisk: 'medium',
        policyVersion: '1.0.0',
        policyFingerprint: FINGERPRINT,
        auditFingerprint: DIGEST,
      }],
    }],
  }, {
    boundary: 'host_validated',
    expectedRegistryDigest: DIGEST,
  });
}

function props(
  overrides: Partial<MarketplacePageViewProps> = {},
): MarketplacePageViewProps {
  const catalog = trustedCatalog();
  return {
    phase: 'ready',
    catalog,
    packages: catalog.packages,
    query: '',
    category: 'all',
    selectedPackageKey: catalog.packages[0].identity.packageKey,
    reviewState: 'closed',
    scopeError: null,
    plan: null,
    operationReceipt: null,
    errorMessage: null,
    onRetry: noOp,
    onQueryChange: noOp,
    onCategoryChange: noOp,
    onSelectPackage: noOp,
    onOpenReview: noOp,
    onCancelReview: noOp,
    onConfirmPlan: noOp,
    onRequestInstall: noOp,
    onResumeInstall: noOp,
    onClosePlan: noOp,
    ...overrides,
  };
}

function render(overrides: Partial<MarketplacePageViewProps> = {}): string {
  return renderToStaticMarkup(React.createElement(MarketplacePageView, props(overrides)));
}

describe('MarketplacePageView states', () => {
  it('renders loading, empty, and error states with accessible status roles', () => {
    expect(render({
      phase: 'loading',
      catalog: null,
      packages: [],
      selectedPackageKey: null,
    })).toContain('Loading marketplace catalog');

    expect(render({
      packages: [],
    })).toContain('No packages match');

    expect(render({
      phase: 'error',
      catalog: null,
      packages: [],
      selectedPackageKey: null,
      errorMessage: 'Strict validation failed.',
    })).toContain('role="alert"');
  });

  it('labels offline demo data as unverified and never presents install success', () => {
    const catalog = createMarketplaceDemoCatalog('offline', 'Offline demo records.');
    const markup = render({
      catalog,
      packages: catalog.packages,
      selectedPackageKey: catalog.packages[0].identity.packageKey,
    });
    expect(markup).toContain('Demo catalog offline');
    expect(markup).toContain('Demo, not verified');
    expect(markup).toContain('Demo only');
    expect(markup).not.toContain('Successfully installed');
  });

  it('shows incompatible packages as non-confirmable', () => {
    const catalog = trustedCatalog('incompatible');
    const markup = render({
      catalog,
      packages: catalog.packages,
      selectedPackageKey: catalog.packages[0].identity.packageKey,
    });
    expect(markup).toContain('Incompatible');
    expect(markup).toContain('Requires desktop 2.0.0 or newer.');
    expect(markup).toContain('disabled');
  });

  it('renders permission, trust, classification, and side-effect review in the dialog', () => {
    const markup = render({ reviewState: 'reviewing' });
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('net.http');
    expect(markup).toContain('extension_package');
    expect(markup).toContain('public metadata');
    expect(markup).toContain('network egress');
    expect(markup).toContain('Create install plan');
  });

  it('renders an explicit canceled confirmation state', () => {
    const markup = render({ reviewState: 'canceled' });
    expect(markup).toContain('Review canceled');
    expect(markup).toContain('No plan or system change was created.');
  });

  it('renders a plan-only receipt without claiming installation success', () => {
    const catalog = trustedCatalog();
    const plan = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      {
        tenantId: 'tenant:primary',
        userId: 'user:owner',
        workspaceInstanceId: 'workspace:personal-office',
      },
      '2026-07-29T03:00:00.000Z',
    );
    const markup = render({
      catalog,
      packages: catalog.packages,
      plan,
      reviewState: 'planned',
    });
    expect(markup).toContain('Install plan created');
    expect(markup).toContain('plan_only');
    expect(markup).toContain('A plan is not installation evidence');
    expect(markup).not.toContain('Successfully installed');
  });
});
