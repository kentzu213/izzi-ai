import React, { useCallback, useEffect } from 'react';
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
  const packages = selectMarketplacePackages(state);
  const loadCatalog = state.loadCatalog;

  const reload = useCallback(() => {
    void loadCatalog(loadDefaultMarketplaceCatalog);
  }, [loadCatalog]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
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
  );
}
