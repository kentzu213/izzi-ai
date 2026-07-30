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

export interface DialogFocusable {
  focus(): void;
}

export function trapDialogTabFocus(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  focusable: readonly DialogFocusable[],
  activeElement: unknown,
): boolean {
  if (event.key !== 'Tab') return false;
  if (focusable.length === 0) {
    event.preventDefault();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeIndex = focusable.indexOf(activeElement as DialogFocusable);
  const shouldWrap = activeIndex === -1
    || (event.shiftKey && activeElement === first)
    || (!event.shiftKey && activeElement === last);
  if (!shouldWrap) return false;

  event.preventDefault();
  (event.shiftKey ? last : first).focus();
  return true;
}

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
