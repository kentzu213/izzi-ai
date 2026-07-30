import { create } from 'zustand';
import {
  canCreateMarketplaceInstallPlan,
  type MarketplaceCatalog,
  type MarketplaceInstallPlan,
  type MarketplaceInstallOperationReceipt,
  type MarketplaceInstallScope,
  type MarketplacePackage,
} from '../../shared/marketplace';

export type MarketplaceLoadPhase = 'idle' | 'loading' | 'ready' | 'error';
export type MarketplaceReviewState = 'closed' | 'reviewing' | 'canceled' | 'planned';

export interface MarketplaceCatalogLoadResult {
  readonly catalog: MarketplaceCatalog;
}

export type MarketplaceCatalogLoader = () => Promise<MarketplaceCatalogLoadResult>;

export interface MarketplacePersonalOfficeState {
  readonly phase: MarketplaceLoadPhase;
  readonly catalog: MarketplaceCatalog | null;
  readonly query: string;
  readonly category: string;
  readonly selectedPackageKey: string | null;
  readonly reviewState: MarketplaceReviewState;
  readonly scope: MarketplaceInstallScope;
  readonly scopeError: string | null;
  readonly plan: MarketplaceInstallPlan | null;
  readonly operationReceipt: MarketplaceInstallOperationReceipt | null;
  readonly errorMessage: string | null;
  loadCatalog: (loader: MarketplaceCatalogLoader) => Promise<void>;
  setCatalog: (catalog: MarketplaceCatalog) => void;
  setQuery: (query: string) => void;
  setCategory: (category: string) => void;
  selectPackage: (packageKey: string) => void;
  openReview: (packageKey: string) => void;
  setScopeError: (message: string | null) => void;
  cancelReview: () => void;
  acceptPlan: (plan: MarketplaceInstallPlan) => void;
  setOperationReceipt: (receipt: MarketplaceInstallOperationReceipt | null) => void;
  closePlan: () => void;
  reset: () => void;
}

const EMPTY_SCOPE: MarketplaceInstallScope = Object.freeze({
  tenantId: '',
  userId: '',
  workspaceInstanceId: '',
});

function firstPackageKey(catalog: MarketplaceCatalog): string | null {
  return catalog.packages[0]?.identity.packageKey ?? null;
}

export const useMarketplacePersonalOfficeStore = create<MarketplacePersonalOfficeState>(
  (set, get) => ({
    phase: 'idle',
    catalog: null,
    query: '',
    category: 'all',
    selectedPackageKey: null,
    reviewState: 'closed',
    scope: EMPTY_SCOPE,
    scopeError: null,
    plan: null,
    operationReceipt: null,
    errorMessage: null,

    loadCatalog: async (loader) => {
      set({
        phase: 'loading',
        catalog: null,
        selectedPackageKey: null,
        reviewState: 'closed',
        plan: null,
        operationReceipt: null,
        errorMessage: null,
      });
      try {
        const { catalog } = await loader();
        set({
          phase: 'ready',
          catalog,
          selectedPackageKey: firstPackageKey(catalog),
          errorMessage: null,
        });
      } catch (error) {
        set({
          phase: 'error',
          catalog: null,
          selectedPackageKey: null,
          errorMessage: error instanceof Error
            ? error.message
            : 'Marketplace catalog could not be loaded.',
        });
      }
    },

    setCatalog: (catalog) => {
      set({
        phase: 'ready',
        catalog,
        selectedPackageKey: firstPackageKey(catalog),
        reviewState: 'closed',
        plan: null,
        operationReceipt: null,
        errorMessage: null,
      });
    },

    setQuery: (query) => set({ query }),
    setCategory: (category) => set({ category }),
    setScopeError: (scopeError) => set({ scopeError }),
    selectPackage: (packageKey) => set({
      selectedPackageKey: packageKey,
      reviewState: get().reviewState === 'reviewing' ? 'closed' : get().reviewState,
      scopeError: null,
    }),

    openReview: (packageKey) => {
      const { catalog } = get();
      const packageRecord = catalog?.packages.find((item) => (
        item.identity.packageKey === packageKey
      ));
      if (!catalog || !packageRecord || !canCreateMarketplaceInstallPlan(catalog, packageRecord)) {
        set({
          selectedPackageKey: packageKey,
          reviewState: 'closed',
          scopeError: null,
          errorMessage: 'This package cannot create an install plan in its current state.',
        });
        return;
      }
      set({
        selectedPackageKey: packageKey,
        reviewState: 'reviewing',
        scope: EMPTY_SCOPE,
        scopeError: null,
        plan: null,
        operationReceipt: null,
        errorMessage: null,
      });
    },

    cancelReview: () => set({
      reviewState: 'canceled',
      scope: EMPTY_SCOPE,
      scopeError: null,
      plan: null,
      errorMessage: null,
    }),

    acceptPlan: (plan) => set({
      reviewState: 'planned',
      plan,
      scope: plan.scope,
      scopeError: null,
      operationReceipt: null,
      errorMessage: null,
    }),

    setOperationReceipt: (operationReceipt) => set({
      operationReceipt,
    }),

    closePlan: () => set({
      reviewState: 'closed',
      plan: null,
      operationReceipt: null,
      scope: EMPTY_SCOPE,
      scopeError: null,
    }),

    reset: () => set({
      phase: 'idle',
      catalog: null,
      query: '',
      category: 'all',
      selectedPackageKey: null,
      reviewState: 'closed',
      scope: EMPTY_SCOPE,
      scopeError: null,
      plan: null,
      operationReceipt: null,
      errorMessage: null,
    }),
  }),
);

export function selectMarketplacePackages(
  state: Pick<MarketplacePersonalOfficeState, 'catalog' | 'query' | 'category'>,
): readonly MarketplacePackage[] {
  if (!state.catalog) return [];
  const query = state.query.trim().toLocaleLowerCase();
  return state.catalog.packages.filter((packageRecord) => {
    const matchesCategory = (
      state.category === 'all'
      || packageRecord.category === state.category
    );
    if (!matchesCategory) return false;
    if (!query) return true;
    return [
      packageRecord.displayName,
      packageRecord.summary,
      packageRecord.publisher,
      packageRecord.identity.packageName,
      ...packageRecord.capabilities.map((capability) => capability.requiredPermission),
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}
