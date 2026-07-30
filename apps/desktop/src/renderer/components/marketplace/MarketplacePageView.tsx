import React, { useEffect, useMemo, useRef } from 'react';
import {
  canCreateMarketplaceInstallPlan,
  type MarketplaceCatalog,
  type MarketplaceInstallOperationReceipt,
  type MarketplaceInstallPlan,
  type MarketplacePackage,
} from '../../../shared/marketplace';
import {
  CloseIcon,
  ExtensionIcon,
  MarketplaceIcon,
  PlanningIcon,
  RefreshIcon,
  ResearchIcon,
  ReviewIcon,
  StatusIcon,
} from '../AppIcons';
import type {
  MarketplaceLoadPhase,
  MarketplaceReviewState,
} from '../../store/marketplacePersonalOffice';

export interface MarketplacePageViewProps {
  readonly phase: MarketplaceLoadPhase;
  readonly catalog: MarketplaceCatalog | null;
  readonly packages: readonly MarketplacePackage[];
  readonly query: string;
  readonly category: string;
  readonly selectedPackageKey: string | null;
  readonly reviewState: MarketplaceReviewState;
  readonly scopeError: string | null;
  readonly plan: MarketplaceInstallPlan | null;
  readonly operationReceipt: MarketplaceInstallOperationReceipt | null;
  readonly errorMessage: string | null;
  readonly onRetry: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly onCategoryChange: (category: string) => void;
  readonly onSelectPackage: (packageKey: string) => void;
  readonly onOpenReview: (packageKey: string) => void;
  readonly onCancelReview: () => void;
  readonly onConfirmPlan: () => void;
  readonly onRequestInstall: () => void;
  readonly onResumeInstall: () => void;
  readonly onClosePlan: () => void;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' ');
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function sourceLabel(catalog: MarketplaceCatalog): string {
  if (catalog.source.kind === 'remote') return 'Remote catalog';
  if (catalog.source.kind === 'cached') return 'Cached catalog';
  return 'Demo catalog';
}

function verificationLabel(packageRecord: MarketplacePackage): string {
  return packageRecord.verification === 'host_verified'
    ? 'Host verified'
    : 'Demo, not verified';
}

function actionLabel(
  catalog: MarketplaceCatalog,
  packageRecord: MarketplacePackage,
): string {
  if (catalog.source.kind === 'demo') return 'Demo only';
  if (packageRecord.installation.state === 'installed') return 'Installed';
  if (packageRecord.compatibility.state === 'incompatible') return 'Incompatible';
  return 'Review access';
}

function MarketplaceStatePanel({
  kind,
  title,
  description,
  onRetry,
}: {
  readonly kind: 'loading' | 'empty' | 'error';
  readonly title: string;
  readonly description: string;
  readonly onRetry?: () => void;
}) {
  const Icon = kind === 'error' ? StatusIcon : kind === 'empty' ? ResearchIcon : ExtensionIcon;
  return (
    <section
      className={`po-marketplace-state po-marketplace-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-label={title}
    >
      <Icon className="po-marketplace-state__icon" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
        {onRetry && (
          <button type="button" className="po-marketplace-button" onClick={onRetry}>
            <RefreshIcon className="po-marketplace-button__icon" />
            Try again
          </button>
        )}
      </div>
    </section>
  );
}

function MarketplacePackageCard({
  catalog,
  packageRecord,
  selected,
  onSelect,
  onReview,
}: {
  readonly catalog: MarketplaceCatalog;
  readonly packageRecord: MarketplacePackage;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onReview: () => void;
}) {
  const canReview = canCreateMarketplaceInstallPlan(catalog, packageRecord);
  return (
    <article
      className="po-marketplace-card"
      data-selected={selected ? 'true' : 'false'}
      aria-label={`${packageRecord.displayName}, ${verificationLabel(packageRecord)}`}
    >
      <button
        type="button"
        className="po-marketplace-card__select"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="po-marketplace-card__mark" aria-hidden="true">
          {packageRecord.displayName.slice(0, 2).toUpperCase()}
        </span>
        <span className="po-marketplace-card__copy">
          <span className="po-marketplace-card__title">{packageRecord.displayName}</span>
          <span className="po-marketplace-card__publisher">{packageRecord.publisher}</span>
        </span>
        <span className="po-marketplace-card__version">
          {packageRecord.identity.packageVersion}
        </span>
      </button>

      <p className="po-marketplace-card__summary">{packageRecord.summary}</p>

      <div className="po-marketplace-card__states" aria-label="Package states">
        <span className={`po-marketplace-badge po-marketplace-badge--${catalog.source.kind}`}>
          {sourceLabel(catalog)}
        </span>
        <span className={`po-marketplace-badge po-marketplace-badge--${packageRecord.verification}`}>
          {verificationLabel(packageRecord)}
        </span>
        {packageRecord.installation.state === 'installed' && (
          <span className="po-marketplace-badge po-marketplace-badge--installed">
            Installed
          </span>
        )}
        {packageRecord.compatibility.state === 'incompatible' && (
          <span className="po-marketplace-badge po-marketplace-badge--incompatible">
            Incompatible
          </span>
        )}
      </div>

      <div className="po-marketplace-card__footer">
        <span>
          {packageRecord.capabilities.length} capability
          {packageRecord.capabilities.length === 1 ? '' : 'ies'}
        </span>
        <button
          type="button"
          className="po-marketplace-button po-marketplace-button--primary"
          disabled={!canReview}
          onClick={onReview}
        >
          <ReviewIcon className="po-marketplace-button__icon" />
          {actionLabel(catalog, packageRecord)}
        </button>
      </div>
    </article>
  );
}

function CapabilityReview({
  packageRecord,
}: {
  readonly packageRecord: MarketplacePackage;
}) {
  return (
    <section className="po-marketplace-review-list" aria-labelledby="capability-review-title">
      <div className="po-marketplace-section-head">
        <div>
          <h3 id="capability-review-title">Permission review</h3>
          <p>Authority is copied from capability registry {packageRecord.registryVersion}.</p>
        </div>
        <span className="po-marketplace-mono">
          {packageRecord.capabilities.length} exact
        </span>
      </div>
      <div className="po-marketplace-capabilities">
        {packageRecord.capabilities.map((capability) => (
          <article className="po-marketplace-capability" key={capability.capabilityId}>
            <div className="po-marketplace-capability__head">
              <div>
                <h4>{capability.name}</h4>
                <p>{capability.description}</p>
              </div>
              <span
                className={`po-marketplace-risk po-marketplace-risk--${capability.permissionRisk}`}
              >
                {capability.permissionRisk} risk
              </span>
            </div>
            <dl className="po-marketplace-capability__facts">
              <div>
                <dt>Permission</dt>
                <dd className="po-marketplace-mono">{capability.requiredPermission}</dd>
              </div>
              <div>
                <dt>Trust zone</dt>
                <dd className="po-marketplace-mono">{capability.trustZone}</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd>{capability.dataClassifications.map(humanize).join(', ')}</dd>
              </div>
              <div>
                <dt>Side effects</dt>
                <dd>
                  {capability.sideEffects.length > 0
                    ? capability.sideEffects.map(humanize).join(', ')
                    : 'None declared'}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function MarketplacePackageDetail({
  catalog,
  packageRecord,
  onReview,
}: {
  readonly catalog: MarketplaceCatalog;
  readonly packageRecord: MarketplacePackage;
  readonly onReview: () => void;
}) {
  const canReview = canCreateMarketplaceInstallPlan(catalog, packageRecord);
  return (
    <aside className="po-marketplace-detail" aria-label={`${packageRecord.displayName} details`}>
      <div className="po-marketplace-detail__head">
        <div className="po-marketplace-detail__mark" aria-hidden="true">
          {packageRecord.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="po-marketplace-detail__category">{packageRecord.category}</p>
          <h2>{packageRecord.displayName}</h2>
          <p>{packageRecord.publisher}</p>
        </div>
      </div>

      <p className="po-marketplace-detail__summary">{packageRecord.summary}</p>

      <dl className="po-marketplace-detail__facts">
        <div>
          <dt>Package</dt>
          <dd className="po-marketplace-mono">{packageRecord.identity.packageKey}</dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd className="po-marketplace-mono">{packageRecord.registryVersion}</dd>
        </div>
        <div>
          <dt>Compatibility</dt>
          <dd>
            {packageRecord.compatibility.state === 'compatible'
              ? `Desktop ${packageRecord.compatibility.desktopVersion}`
              : packageRecord.compatibility.reason}
          </dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd>
            {packageRecord.signatureDigest
              ? 'Publisher digest present'
              : 'No verified signature'}
          </dd>
        </div>
      </dl>

      <CapabilityReview packageRecord={packageRecord} />

      <div className="po-marketplace-detail__action">
        <p>
          Confirmation creates a reviewable plan only. It does not download,
          execute, grant access, activate a runtime, or provision a workspace.
        </p>
        <button
          type="button"
          className="po-marketplace-button po-marketplace-button--primary"
          disabled={!canReview}
          onClick={onReview}
        >
          <PlanningIcon className="po-marketplace-button__icon" />
          {actionLabel(catalog, packageRecord)}
        </button>
      </div>
    </aside>
  );
}

export function MarketplaceReviewDialog({
  packageRecord,
  scopeError,
  onCancel,
  onConfirm,
}: {
  readonly packageRecord: MarketplacePackage;
  readonly scopeError: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  return (
    <div className="po-marketplace-dialog-layer">
      <button
        type="button"
        className="po-marketplace-dialog__backdrop"
        aria-label="Cancel install plan review"
        tabIndex={-1}
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        className="po-marketplace-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketplace-review-dialog-title"
        aria-describedby="marketplace-review-dialog-description"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key !== 'Tab') return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) {
            event.preventDefault();
            dialog.focus();
            return;
          }
          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="po-marketplace-dialog__head">
          <div>
            <p className="po-marketplace-dialog__kicker">Plan only</p>
            <h2 id="marketplace-review-dialog-title">
              Review {packageRecord.displayName}
            </h2>
          </div>
          <button
            type="button"
            className="po-marketplace-icon-button"
            aria-label="Cancel review"
            onClick={onCancel}
          >
            <CloseIcon className="po-marketplace-icon-button__icon" />
          </button>
        </div>

        <p id="marketplace-review-dialog-description" className="po-marketplace-dialog__lede">
          The desktop host derives the authenticated identity and canonical personal
          workspace. No renderer-supplied scope, grant or account change is accepted.
        </p>

        <CapabilityReview packageRecord={packageRecord} />

        {scopeError && (
          <p className="po-marketplace-form-error" role="alert">
            {scopeError}
          </p>
        )}

        <div className="po-marketplace-dialog__actions">
          <button
            type="button"
            className="po-marketplace-button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="po-marketplace-button po-marketplace-button--primary"
            onClick={onConfirm}
          >
            <PlanningIcon className="po-marketplace-button__icon" />
            Create install plan
          </button>
        </div>
      </div>
    </div>
  );
}

function MarketplacePlanReceipt({
  plan,
  operationReceipt,
  onRequestInstall,
  onResumeInstall,
  onClose,
}: {
  readonly plan: MarketplaceInstallPlan;
  readonly operationReceipt: MarketplaceInstallOperationReceipt | null;
  readonly onRequestInstall: () => void;
  readonly onResumeInstall: () => void;
  readonly onClose: () => void;
}) {
  const awaitingApproval = operationReceipt?.status === 'awaiting_approval';
  const completed = operationReceipt?.status === 'completed';
  return (
    <section className="po-marketplace-receipt" role="status" aria-live="polite">
      <PlanningIcon className="po-marketplace-receipt__icon" />
      <div>
        <h2>{completed ? 'Marketplace operation completed' : 'Install plan created'}</h2>
        <p>
          {completed
            ? 'The receipt below records the exact package and workspace outcome.'
            : 'A plan is not installation evidence. The host must verify bytes, approval, grants and workspace before any effect.'}
        </p>
        <dl>
          <div>
            <dt>Plan id</dt>
            <dd className="po-marketplace-mono">{plan.planId}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd className="po-marketplace-mono">{plan.scope.workspaceInstanceId}</dd>
          </div>
          <div>
            <dt>Permissions</dt>
            <dd>{plan.requestedPermissions.join(', ')}</dd>
          </div>
          <div>
            <dt>Effect</dt>
            <dd className="po-marketplace-mono">{plan.effect}</dd>
          </div>
        </dl>
        {operationReceipt && (
          <ol className="po-marketplace-operation-stages">
            {operationReceipt.stages.map((item) => (
              <li key={`${item.stage}:${item.code}`}>
                <span>{humanize(item.stage)}</span>
                <strong>{item.code}</strong>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="po-marketplace-dialog__actions">
        {!operationReceipt && (
          <button
            type="button"
            className="po-marketplace-button po-marketplace-button--primary"
            onClick={onRequestInstall}
          >
            Request host installation
          </button>
        )}
        {awaitingApproval && (
          <button
            type="button"
            className="po-marketplace-button po-marketplace-button--primary"
            onClick={onResumeInstall}
          >
            Check approval and continue
          </button>
        )}
        <button type="button" className="po-marketplace-button" onClick={onClose}>
          Close receipt
        </button>
      </div>
    </section>
  );
}

export function MarketplacePageView(props: MarketplacePageViewProps) {
  const categories = useMemo(() => {
    const values = new Set(props.catalog?.packages.map((item) => item.category) ?? []);
    return ['all', ...[...values].sort()];
  }, [props.catalog]);
  const selectedPackage = props.catalog?.packages.find((item) => (
    item.identity.packageKey === props.selectedPackageKey
  )) ?? props.packages[0] ?? null;

  return (
    <section
      className="po-marketplace"
      aria-labelledby="personal-office-marketplace-title"
    >
      <header className="po-marketplace-header">
        <div className="po-marketplace-header__icon" aria-hidden="true">
          <MarketplaceIcon className="po-marketplace-header__icon-svg" />
        </div>
        <div>
          <h2 id="personal-office-marketplace-title">Marketplace</h2>
          <p>
            Inspect package identity, compatibility, permissions, data classes,
            and side effects before creating an install plan.
          </p>
        </div>
      </header>

      {props.phase === 'loading' && (
        <MarketplaceStatePanel
          kind="loading"
          title="Loading marketplace catalog"
          description="Checking catalog availability and installed package state."
        />
      )}

      {props.phase === 'error' && (
        <MarketplaceStatePanel
          kind="error"
          title="Marketplace catalog unavailable"
          description={props.errorMessage ?? 'The catalog could not be validated.'}
          onRetry={props.onRetry}
        />
      )}

      {props.phase === 'ready' && props.catalog && (
        <>
          <section
            className="po-marketplace-source"
            role="status"
            aria-live="polite"
          >
            <StatusIcon className="po-marketplace-source__icon" />
            <div>
              <strong>
                {sourceLabel(props.catalog)}
                {' '}
                {props.catalog.source.connection === 'offline' ? 'offline' : 'online'}
              </strong>
              <span>
                {props.catalog.source.notice
                  ?? (
                    props.catalog.source.kind === 'demo'
                      ? 'Demo records are not verified and cannot create plans.'
                      : 'Capability authority was validated by the desktop host.'
                  )}
              </span>
            </div>
            <button
              type="button"
              className="po-marketplace-button"
              onClick={props.onRetry}
            >
              <RefreshIcon className="po-marketplace-button__icon" />
              Refresh
            </button>
          </section>

          {props.reviewState === 'canceled' && (
            <section className="po-marketplace-canceled" role="status" aria-live="polite">
              <ReviewIcon className="po-marketplace-canceled__icon" />
              <div>
                <strong>Review canceled</strong>
                <span>No plan or system change was created.</span>
              </div>
            </section>
          )}

          {props.plan && props.reviewState === 'planned' && (
            <MarketplacePlanReceipt
              plan={props.plan}
              operationReceipt={props.operationReceipt}
              onRequestInstall={props.onRequestInstall}
              onResumeInstall={props.onResumeInstall}
              onClose={props.onClosePlan}
            />
          )}

          <section className="po-marketplace-controls" aria-label="Catalog filters">
            <label className="po-marketplace-search">
              <ResearchIcon className="po-marketplace-search__icon" />
              <span className="po-marketplace-visually-hidden">Search packages</span>
              <input
                type="search"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
                placeholder="Search package, publisher, or permission"
              />
            </label>
            <div className="po-marketplace-filters" aria-label="Package category">
              {categories.map((category) => (
                <button
                  type="button"
                  key={category}
                  aria-pressed={props.category === category}
                  onClick={() => props.onCategoryChange(category)}
                >
                  {category === 'all' ? 'All' : category}
                </button>
              ))}
            </div>
          </section>

          {props.packages.length === 0 ? (
            <MarketplaceStatePanel
              kind="empty"
              title="No packages match"
              description="Change the search text or category filter."
            />
          ) : (
            <section className="po-marketplace-workspace">
              <div className="po-marketplace-catalog" aria-label="Marketplace packages">
                <div className="po-marketplace-section-head">
                  <div>
                    <h2>Catalog</h2>
                    <p>{props.packages.length} package records</p>
                  </div>
                </div>
                <div className="po-marketplace-cards">
                  {props.packages.map((packageRecord) => (
                    <MarketplacePackageCard
                      key={packageRecord.identity.packageKey}
                      catalog={props.catalog!}
                      packageRecord={packageRecord}
                      selected={
                        selectedPackage?.identity.packageKey
                        === packageRecord.identity.packageKey
                      }
                      onSelect={() => props.onSelectPackage(
                        packageRecord.identity.packageKey,
                      )}
                      onReview={() => props.onOpenReview(
                        packageRecord.identity.packageKey,
                      )}
                    />
                  ))}
                </div>
              </div>

              {selectedPackage && (
                <MarketplacePackageDetail
                  catalog={props.catalog}
                  packageRecord={selectedPackage}
                  onReview={() => props.onOpenReview(
                    selectedPackage.identity.packageKey,
                  )}
                />
              )}
            </section>
          )}
        </>
      )}

      {props.reviewState === 'reviewing' && selectedPackage && (
        <MarketplaceReviewDialog
          packageRecord={selectedPackage}
          scopeError={props.scopeError}
          onCancel={props.onCancelReview}
          onConfirm={props.onConfirmPlan}
        />
      )}
    </section>
  );
}
