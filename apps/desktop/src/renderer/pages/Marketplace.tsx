import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createMarketplaceDemoCatalog,
  markMarketplaceDemoInstalled,
  readInstalledOcxExtensionPackageKeys,
} from '../../shared/marketplace';
import { MarketplacePageView } from '../components/marketplace';
import { apiClient } from '../lib/api-client';
import {
  selectMarketplacePackages,
  useMarketplacePersonalOfficeStore,
  type MarketplaceCatalogLoadResult,
} from '../store/marketplacePersonalOffice';
import { usePersonalOfficeStore } from '../store/personalOffice';
import { selectInstalledMarketingWorkspacePackage } from '../marketing-workspace/reference-contract';
import '../styles/marketplace-personal-office.css';

export interface MarketplacePageProps {
  readonly onNavigateToChat?: () => void;
}

export async function loadDefaultMarketplaceCatalog(): Promise<MarketplaceCatalogLoadResult> {
  const online = await apiClient.checkMarketplaceHealth();
  let installedPackageKeys: readonly string[] = [];

  try {
    const installed = await window.electronAPI?.extensions.list();
    installedPackageKeys = readInstalledOcxExtensionPackageKeys(installed);
  } catch {
    // Installed state is read-only context. Failure does not make demo data trusted.
  }

  const notice = online
    ? 'The remote service is reachable, but this build has no leased host-validated catalog bridge. Showing non-installable demo records.'
    : 'Marketplace service is offline. Showing non-installable demo records.';
  const demo = createMarketplaceDemoCatalog(online ? 'online' : 'offline', notice);
  return {
    catalog: markMarketplaceDemoInstalled(demo, installedPackageKeys),
  };
}

export function MarketplacePage(_props: MarketplacePageProps = {}) {
  const state = useMarketplacePersonalOfficeStore();
  const openLegacy = usePersonalOfficeStore((current) => current.openLegacy);
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'error'>('idle');
  const [openError, setOpenError] = useState('');
  const packages = selectMarketplacePackages(state);
  const loadCatalog = state.loadCatalog;
  const selectedInstalledPackage = useMemo(
    () => selectInstalledMarketingWorkspacePackage(state.catalog, state.selectedPackageKey),
    [state.catalog, state.selectedPackageKey],
  );

  const reload = useCallback(() => {
    void loadCatalog(loadDefaultMarketplaceCatalog);
  }, [loadCatalog]);

  useEffect(() => {
    reload();
  }, [reload]);

  const openMarketingWorkspace = useCallback(async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !selectedInstalledPackage) return;
    setOpenState('opening');
    setOpenError('');
    try {
      const evidence = await api.getReferenceWorkspaceEvidence(
        selectedInstalledPackage.identity.packageKey,
      );
      if (!evidence.ok) {
        setOpenState('error');
        setOpenError(`Host denied workspace evidence: ${evidence.reason}.`);
        return;
      }
      const result = await api.provisionReferenceWorkspace({ evidence: evidence.evidence });
      if (!result.ok || result.intent.kind !== 'open_customer_marketing_workspace') {
        setOpenState('error');
        setOpenError(`Workspace was not provisioned: ${result.ok ? 'invalid_intent' : result.reason}.`);
        return;
      }
      setOpenState('idle');
      openLegacy('customer-marketing');
    } catch {
      setOpenState('error');
      setOpenError('The desktop host could not validate this installed package.');
    }
  }, [openLegacy, selectedInstalledPackage]);

  return (
    <>
      {selectedInstalledPackage && (
        <section className="po-marketplace-open-workspace" aria-live="polite">
          <div>
            <strong>Installed package detected</strong>
            <span>
              The desktop host will revalidate package identity, account and
              workspace scope before opening Marketing.
            </span>
            {openError && <span className="po-marketplace-open-workspace__error">{openError}</span>}
          </div>
          <button
            type="button"
            className="po-marketplace-button po-marketplace-button--primary"
            disabled={openState === 'opening'}
            onClick={() => void openMarketingWorkspace()}
          >
            {openState === 'opening' ? 'Validating…' : 'Open Marketing workspace'}
          </button>
        </section>
      )}
      <MarketplacePageView
        phase={state.phase}
        catalog={state.catalog}
        packages={packages}
        query={state.query}
        category={state.category}
        selectedPackageKey={state.selectedPackageKey}
        reviewState={state.reviewState}
        scope={state.scope}
        scopeError={state.scopeError}
        plan={state.plan}
        errorMessage={state.errorMessage}
        onRetry={reload}
        onQueryChange={state.setQuery}
        onCategoryChange={state.setCategory}
        onSelectPackage={state.selectPackage}
        onOpenReview={state.openReview}
        onScopeChange={state.setScopeField}
        onCancelReview={state.cancelReview}
        onConfirmPlan={() => {
          state.confirmPlan(new Date().toISOString());
        }}
        onClosePlan={state.closePlan}
      />
    </>
  );
}
