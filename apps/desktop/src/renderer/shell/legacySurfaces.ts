/**
 * Personal Office shell — legacy surface catalogue.
 *
 * Loop 02 does not delete anything. Every pre-existing page stays reachable, but
 * it stops being top-level navigation: the new shell has five routes, and the
 * legacy surfaces are catalogued here and reached through Settings.
 *
 * Two IA rules are enforced by this file's shape:
 *
 *  1. `customer-marketing` ("AI Marketing") and `marketing` ("Phòng Marketing")
 *     are no longer siblings in one flat menu. They sit in a single Marketing
 *     group with distinct descriptions, so the duplicate-product confusion the
 *     legacy sidebar created cannot reappear at the top level.
 *  2. Task, agent and model surfaces are grouped as *legacy tools*, never as
 *     primary navigation, per the Loop 02 acceptance criteria.
 *
 * The page ids are the existing `App.tsx` Page union values. This module holds no
 * component references: `App.tsx` owns rendering and passes a renderer down, so
 * the shell never imports 18 page modules and never creates an import cycle.
 *
 * @module renderer/shell/legacySurfaces
 */

/** A legacy page id, matching the `Page` union in App.tsx. */
export type LegacyPageId =
  | 'chat'
  | 'tasks'
  | 'memory'
  | 'status'
  | 'dashboard'
  | 'marketplace'
  | 'agents'
  | 'extensions'
  | 'settings'
  | 'setup'
  | 'costs'
  | 'knowledge'
  | 'connections'
  | 'autopost'
  | 'scheduled-sessions'
  | 'marketing'
  | 'customer-marketing'
  | 'affiliate';

export interface LegacySurface {
  readonly id: LegacyPageId;
  readonly label: string;
  readonly description: string;
}

export interface LegacyGroup {
  readonly id: string;
  readonly label: string;
  /** Why this group exists, shown above the list. */
  readonly description: string;
  readonly surfaces: readonly LegacySurface[];
}

export const LEGACY_GROUPS: readonly LegacyGroup[] = Object.freeze([
  Object.freeze({
    id: 'marketing',
    label: 'Marketing',
    description:
      'Two separate marketing products, catalogued here instead of competing for a top-level slot.',
    surfaces: Object.freeze([
      Object.freeze({
        id: 'customer-marketing' as LegacyPageId,
        label: 'Customer marketing room',
        description: 'The customer-facing marketing workspace',
      }),
      Object.freeze({
        id: 'marketing' as LegacyPageId,
        label: 'Marketing room (internal)',
        description: 'The internal izziAPI marketing surface',
      }),
      Object.freeze({
        id: 'autopost' as LegacyPageId,
        label: 'Auto-post',
        description: 'Scheduled social posting',
      }),
    ]),
  }),
  Object.freeze({
    id: 'work',
    label: 'Legacy work tools',
    description:
      'The pre-Personal-Office ways of working. Still here, no longer the front door.',
    surfaces: Object.freeze([
      Object.freeze({ id: 'chat' as LegacyPageId, label: 'Chat', description: 'Direct agent chat' }),
      Object.freeze({ id: 'tasks' as LegacyPageId, label: 'Replay tasks', description: 'The old task list' }),
      Object.freeze({
        id: 'scheduled-sessions' as LegacyPageId,
        label: 'Scheduled sessions',
        description: 'Recurring playbook runs',
      }),
      Object.freeze({ id: 'agents' as LegacyPageId, label: 'Agent hub', description: 'Browse and install agents' }),
      Object.freeze({ id: 'memory' as LegacyPageId, label: 'Recall library', description: 'Stored memory' }),
    ]),
  }),
  Object.freeze({
    id: 'system',
    label: 'System',
    description: 'Account, runtime, spend and providers.',
    surfaces: Object.freeze([
      Object.freeze({ id: 'dashboard' as LegacyPageId, label: 'Operations', description: 'Account overview' }),
      Object.freeze({ id: 'status' as LegacyPageId, label: 'Guardrails', description: 'Runtime status' }),
      Object.freeze({ id: 'costs' as LegacyPageId, label: 'Costs', description: 'Spend by model' }),
      Object.freeze({ id: 'connections' as LegacyPageId, label: 'Model connections', description: 'Providers and routing' }),
      Object.freeze({ id: 'extensions' as LegacyPageId, label: 'Extensions', description: 'Installed workflow imports' }),
      Object.freeze({ id: 'setup' as LegacyPageId, label: 'Setup wizard', description: 'First-run configuration' }),
      Object.freeze({ id: 'affiliate' as LegacyPageId, label: 'Affiliate', description: 'Referral programme' }),
    ]),
  }),
]);

/**
 * Setup surfaces.
 *
 * These are the ones the IA explicitly forbids as workspace tabs: Context, Apps,
 * Brand, Knowledge, Agents/Skills, Policies and Runtime. They live in Settings
 * and in the per-workspace setup drawer, so a workspace keeps exactly four
 * surfaces (Brief / Work / Deliverables / Approvals).
 *
 * Only entries backed by a real legacy page are listed. The remaining concepts
 * (Context, Brand, Policies) have no page at this commit, so they are handled by
 * the workspace setup drawer as explicit "not configured yet" rows rather than
 * being faked with a link to an unrelated surface.
 */
export const SETUP_GROUPS: readonly LegacyGroup[] = Object.freeze([
  Object.freeze({
    id: 'setup',
    label: 'Office setup',
    description:
      'Capabilities, knowledge and runtime. Deliberately kept out of the daily work surfaces.',
    surfaces: Object.freeze([
      Object.freeze({
        id: 'knowledge' as LegacyPageId,
        label: 'Knowledge',
        description: 'Your graph and stored context',
      }),
      Object.freeze({
        id: 'agents' as LegacyPageId,
        label: 'Agents and skills',
        description: 'Who can act on your behalf',
      }),
      Object.freeze({
        id: 'extensions' as LegacyPageId,
        label: 'Apps',
        description: 'Installed extensions and imports',
      }),
      Object.freeze({
        id: 'connections' as LegacyPageId,
        label: 'Runtime',
        description: 'Providers, models and routing',
      }),
    ]),
  }),
]);

/** Flat lookup for the command palette. */
export const LEGACY_SURFACES: readonly LegacySurface[] = Object.freeze(
  LEGACY_GROUPS.flatMap((group) => group.surfaces as LegacySurface[]),
);
