import type {
  MarketplaceCatalog,
  MarketplacePackage,
} from '../../shared/marketplace';

export const MARKETING_REFERENCE_SURFACES = Object.freeze([
  { id: 'brief', label: 'Brief' },
  { id: 'work', label: 'Work' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'approvals', label: 'Approvals' },
] as const);

export const MARKETING_REFERENCE_SETUP_GROUPS = Object.freeze([
  { id: 'context', label: 'Context', description: 'Business, audience and brand context' },
  { id: 'connections', label: 'Connections', description: 'Channels, apps and integration health' },
  { id: 'automation', label: 'Automation', description: 'Mode, approvals and runtime readiness' },
] as const);

export function selectInstalledMarketingWorkspacePackage(
  catalog: MarketplaceCatalog | null,
  selectedPackageKey: string | null,
): MarketplacePackage | null {
  if (!catalog || !selectedPackageKey) return null;
  return catalog.packages.find((item) => (
    item.identity.packageKey === selectedPackageKey
    && item.installation.state === 'installed'
  )) ?? null;
}
