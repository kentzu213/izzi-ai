import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MarketplacePageView } from '../components/marketplace';
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
  const api = window.electronAPI?.marketplacePersonalOffice;
  if (!api) {
    throw new Error('Marketplace host bridge is unavailable.');
  }
  const result = await api.loadCatalog();
  if (!result.ok) throw new Error(result.reason);
  return { catalog: result.value };
}

export function MarketplacePage(_props: MarketplacePageProps = {}) {
  const state = useMarketplacePersonalOfficeStore();
  const openLegacy = usePersonalOfficeStore((current) => current.openLegacy);
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'error'>('idle');
  const [openError, setOpenError] = useState('');
  const packages = selectMarketplacePackages(state);
  const loadCatalog = state.loadCatalog;
  const plan = state.plan;
  const operationReceipt = state.operationReceipt;
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

  const createPlanFromHost = useCallback(async () => {
    const api = window.electronAPI?.marketplacePersonalOffice;
    const packageKey = state.selectedPackageKey;
    if (!api || !packageKey) {
      state.setScopeError('Select a host-validated package before creating a plan.');
      return;
    }
    const result = await api.createPlan(packageKey);
    if (!result.ok) {
      state.setScopeError(result.reason);
      return;
    }
    state.acceptPlan(result.value);
  }, [state]);

  const requestInstall = useCallback(async () => {
    const api = window.electronAPI?.marketplacePersonalOffice;
    if (!api || !plan) return;
    const result = await api.requestInstall({ plan });
    if (!result.ok) {
      state.setScopeError(result.reason);
      return;
    }
    state.setOperationReceipt(result.value);
  }, [plan, state]);

  const resumeInstall = useCallback(async () => {
    const api = window.electronAPI?.marketplacePersonalOffice;
    if (!api || !plan || !operationReceipt?.approvalId) return;
    const result = await api.resumeInstall({
      plan,
      approvalId: operationReceipt.approvalId,
    });
    if (!result.ok) {
      state.setScopeError(result.reason);
      return;
    }
    state.setOperationReceipt(result.value);
  }, [operationReceipt?.approvalId, plan, state]);

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
        scopeError={state.scopeError}
        plan={plan}
        operationReceipt={operationReceipt}
        errorMessage={state.errorMessage}
        onRetry={reload}
        onQueryChange={state.setQuery}
        onCategoryChange={state.setCategory}
        onSelectPackage={state.selectPackage}
        onOpenReview={state.openReview}
        onCancelReview={state.cancelReview}
        onConfirmPlan={() => { void createPlanFromHost(); }}
        onRequestInstall={() => { void requestInstall(); }}
        onResumeInstall={() => { void resumeInstall(); }}
        onClosePlan={state.closePlan}
      />
    </>
  );
}
