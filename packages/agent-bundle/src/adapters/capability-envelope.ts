/**
 * .oab manifest -> Personal Office capability envelope adapter.
 *
 * This package cannot import the desktop contract without creating a reverse
 * workspace dependency. It therefore emits the small versioned wire envelope
 * consumed by the desktop's strict capability parser. The envelope contains no
 * authority decisions; the host policy catalog supplies those.
 */

import type { AgentBundleManifest } from '../manifest';
import { validateAgentManifest } from '../validator';

export const AGENT_BUNDLE_CAPABILITY_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const AGENT_BUNDLE_CAPABILITY_ADAPTER_VERSION = '1.0.0' as const;

export interface AgentBundleCapabilityAdapterContext {
  readonly observedAt: string;
  readonly signatureDigest?: string;
}

export interface AgentBundleCapabilityEnvelope {
  readonly schemaVersion: typeof AGENT_BUNDLE_CAPABILITY_ENVELOPE_SCHEMA_VERSION;
  readonly source: {
    readonly kind: 'agent_bundle';
    readonly manifestName: string;
    readonly manifestVersion: string;
    readonly observedAt: string;
    readonly adapterVersion: typeof AGENT_BUNDLE_CAPABILITY_ADAPTER_VERSION;
  };
  readonly package: {
    readonly displayName: string;
    readonly description: string;
    readonly signatureDigest?: string;
  };
  readonly declarations: readonly {
    readonly kind: 'tool';
    readonly key: string;
    readonly manifestPath: string;
  }[];
  readonly unsupportedDeclarations: readonly {
    readonly manifestPath: string;
    readonly reason: string;
  }[];
}

export type AgentBundleCapabilityAdapterErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_CONTEXT'
  | 'DUPLICATE_TOOL';

export class AgentBundleCapabilityAdapterError extends Error {
  constructor(
    readonly code: AgentBundleCapabilityAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentBundleCapabilityAdapterError';
  }
}

function assertContext(context: AgentBundleCapabilityAdapterContext): void {
  const parsed = new Date(context.observedAt);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== context.observedAt
  ) {
    throw new AgentBundleCapabilityAdapterError(
      'INVALID_CONTEXT',
      'observedAt must be an exact ISO-8601 UTC timestamp',
    );
  }
}

function findDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

/**
 * Adapt a validated .oab manifest into deterministic, authority-free capability
 * declarations. Automated triggers and integration requirements are retained
 * as unsupported declarations so the host rejects them until a scoped
 * IntegrationGrant/automation policy exists.
 */
export function adaptAgentBundleManifestToCapabilityEnvelope(
  manifest: AgentBundleManifest,
  context: AgentBundleCapabilityAdapterContext,
): AgentBundleCapabilityEnvelope {
  assertContext(context);
  const validation = validateAgentManifest(manifest);
  if (!validation.valid) {
    throw new AgentBundleCapabilityAdapterError(
      'INVALID_MANIFEST',
      validation.errors
        .map((problem) => `${problem.field}: ${problem.message}`)
        .join('; '),
    );
  }

  const duplicateTool = findDuplicate(manifest.agent.tools);
  if (duplicateTool) {
    throw new AgentBundleCapabilityAdapterError(
      'DUPLICATE_TOOL',
      `Duplicate agent tool declaration: ${duplicateTool}`,
    );
  }

  const declarations = manifest.agent.tools
    .map((tool, index) => Object.freeze({
      kind: 'tool' as const,
      key: tool,
      manifestPath: `agent.tools[${index}]`,
    }))
    .sort((left, right) => (
      `${left.key}\0${left.manifestPath}`
        .localeCompare(`${right.key}\0${right.manifestPath}`)
    ));

  const unsupportedDeclarations: {
    manifestPath: string;
    reason: string;
  }[] = [];

  manifest.automation.cronJobs.forEach((job, index) => {
    if (job.enabled) {
      unsupportedDeclarations.push({
        manifestPath: `automation.cronJobs[${index}]`,
        reason: 'Enabled schedules require an explicit scheduled-execution policy.',
      });
    }
  });
  manifest.automation.workflows.forEach((workflow, index) => {
    if (workflow.trigger && workflow.trigger !== 'manual') {
      unsupportedDeclarations.push({
        manifestPath: `automation.workflows[${index}].trigger`,
        reason: 'Non-manual workflows require an explicit automation policy.',
      });
    }
  });
  manifest.automation.triggers.forEach((_, index) => {
    unsupportedDeclarations.push({
      manifestPath: `automation.triggers[${index}]`,
      reason: 'Event triggers require an explicit automation policy.',
    });
  });
  manifest.connections.platforms.forEach((platform, index) => {
    if (platform.required || (platform.scopes?.length ?? 0) > 0) {
      unsupportedDeclarations.push({
        manifestPath: `connections.platforms[${index}]`,
        reason: 'Platform scopes require a workspace-bound IntegrationGrant.',
      });
    }
  });
  manifest.connections.apis.forEach((api, index) => {
    if (api.required) {
      unsupportedDeclarations.push({
        manifestPath: `connections.apis[${index}]`,
        reason: 'External APIs require a scoped integration capability policy.',
      });
    }
  });
  manifest.connections.webhooks.forEach((_, index) => {
    unsupportedDeclarations.push({
      manifestPath: `connections.webhooks[${index}]`,
      reason: 'Incoming webhooks require an ingress/authentication policy.',
    });
  });
  unsupportedDeclarations.sort((left, right) => (
    `${left.manifestPath}\0${left.reason}`
      .localeCompare(`${right.manifestPath}\0${right.reason}`)
  ));

  return Object.freeze({
    schemaVersion: AGENT_BUNDLE_CAPABILITY_ENVELOPE_SCHEMA_VERSION,
    source: Object.freeze({
      kind: 'agent_bundle',
      manifestName: manifest.name,
      manifestVersion: manifest.version,
      observedAt: context.observedAt,
      adapterVersion: AGENT_BUNDLE_CAPABILITY_ADAPTER_VERSION,
    }),
    package: Object.freeze({
      displayName: manifest.displayName,
      description: manifest.description,
      ...(context.signatureDigest
        ? { signatureDigest: context.signatureDigest }
        : {}),
    }),
    declarations: Object.freeze(declarations),
    unsupportedDeclarations: Object.freeze(
      unsupportedDeclarations.map((declaration) => Object.freeze(declaration)),
    ),
  });
}
