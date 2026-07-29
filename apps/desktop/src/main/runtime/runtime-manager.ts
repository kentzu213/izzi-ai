import {
  RUNTIME_CONTRACT_VERSION,
  type RuntimeHealthSnapshot,
  type RuntimeKind,
  type RuntimeLifecycle,
  type RuntimeSpec,
  validateRuntimeSpec,
} from '../../shared/runtime';
import {
  authorizeRuntimeSpec,
  type RuntimeAuthorizationResolver,
} from './runtime-authorizer';
import { redactRuntimeText } from './redaction';

export interface RuntimeAdapterResult {
  readonly healthy: boolean;
  readonly detail?: string;
}
export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  start(spec: RuntimeSpec, signal: AbortSignal): Promise<RuntimeAdapterResult>;
  stop(spec: RuntimeSpec): Promise<void>;
  health(spec: RuntimeSpec): Promise<RuntimeAdapterResult>;
  logs?(spec: RuntimeSpec, tail: number): Promise<readonly string[]>;
}

export class RuntimeManager {
  private readonly adapters = new Map<RuntimeKind, RuntimeAdapter>();
  private readonly specs = new Map<string, RuntimeSpec>();
  private readonly health = new Map<string, RuntimeHealthSnapshot>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    adapters: readonly RuntimeAdapter[],
    private readonly authorization: RuntimeAuthorizationResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const adapter of adapters) this.registerAdapter(adapter);
  }

  registerAdapter(adapter: RuntimeAdapter): void {
    if (this.adapters.has(adapter.kind)) throw new Error(`Runtime adapter already registered: ${adapter.kind}`);
    this.adapters.set(adapter.kind, adapter);
  }

  async start(spec: RuntimeSpec): Promise<RuntimeHealthSnapshot> {
    validateRuntimeSpec(spec);
    await authorizeRuntimeSpec(spec, this.authorization, this.clock().toISOString());
    const adapter = this.adapters.get(spec.kind);
    if (!adapter) throw new Error(`Runtime adapter is not available: ${spec.kind}`);
    const existing = this.specs.get(spec.id);
    if (existing && !sameAuthority(existing, spec)) {
      throw new Error('Runtime id is already bound to another workspace/package');
    }
    const controller = new AbortController();
    this.controllers.set(spec.id, controller);
    this.specs.set(spec.id, spec);
    this.setHealth(spec, 'provisioning', false);
    const timer = setTimeout(() => controller.abort('runtime timeout'), spec.budget.timeoutMs);
    try {
      const result = await adapter.start(spec, controller.signal);
      return this.setHealth(spec, result.healthy ? 'ready' : 'failed', result.healthy, result.detail);
    } catch (error) {
      return this.setHealth(spec, 'failed', false, safeError(error));
    } finally {
      clearTimeout(timer);
      this.controllers.delete(spec.id);
    }
  }

  async stop(runtimeId: string): Promise<RuntimeHealthSnapshot> {
    const spec = this.requireSpec(runtimeId);
    const adapter = this.requireAdapter(spec.kind);
    this.controllers.get(runtimeId)?.abort('runtime stopped');
    this.setHealth(spec, 'deprovisioning', false);
    await adapter.stop(spec);
    return this.setHealth(spec, 'released', false);
  }

  async restart(runtimeId: string): Promise<RuntimeHealthSnapshot> {
    const spec = this.requireSpec(runtimeId);
    await this.stop(runtimeId);
    return this.start(spec);
  }

  cancel(runtimeId: string): void {
    this.controllers.get(runtimeId)?.abort('runtime canceled');
  }

  async refresh(runtimeId: string): Promise<RuntimeHealthSnapshot> {
    const spec = this.requireSpec(runtimeId);
    const result = await this.requireAdapter(spec.kind).health(spec);
    return this.setHealth(spec, result.healthy ? 'ready' : 'failed', result.healthy, result.detail);
  }

  listHealth(workspaceId?: string): readonly RuntimeHealthSnapshot[] {
    return [...this.health.values()]
      .filter((snapshot) => !workspaceId || snapshot.workspaceId === workspaceId)
      .sort((left, right) => left.runtimeId.localeCompare(right.runtimeId));
  }

  private setHealth(
    spec: RuntimeSpec,
    lifecycle: RuntimeLifecycle,
    healthy: boolean,
    detail?: string,
  ): RuntimeHealthSnapshot {
    const now = this.clock().toISOString();
    const previous = this.health.get(spec.id);
    const snapshot: RuntimeHealthSnapshot = {
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      runtimeId: spec.id,
      kind: spec.kind,
      tenantId: spec.authority.tenantId,
      userId: spec.authority.userId,
      workspaceId: spec.authority.workspaceId,
      packageId: spec.authority.packageId,
      lifecycle,
      healthy,
      ...(detail ? { detail: redactRuntimeText(detail) } : {}),
      ...(previous?.startedAt
        ? { startedAt: previous.startedAt }
        : lifecycle === 'ready'
          ? { startedAt: now }
          : {}),
      updatedAt: now,
    };
    this.health.set(spec.id, snapshot);
    return snapshot;
  }

  private requireSpec(runtimeId: string): RuntimeSpec {
    const spec = this.specs.get(runtimeId);
    if (!spec) throw new Error(`Runtime not found: ${runtimeId}`);
    return spec;
  }

  private requireAdapter(kind: RuntimeKind): RuntimeAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) throw new Error(`Runtime adapter is not available: ${kind}`);
    return adapter;
  }
}

function sameAuthority(left: RuntimeSpec, right: RuntimeSpec): boolean {
  return (
    left.authority.tenantId === right.authority.tenantId
    && left.authority.userId === right.authority.userId
    && left.authority.workspaceId === right.authority.workspaceId
    && left.authority.packageId === right.authority.packageId
    && left.authority.integrationId === right.authority.integrationId
    && left.authority.grantId === right.authority.grantId
    && left.authority.runId === right.authority.runId
  );
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? redactRuntimeText(error.message).slice(0, 300)
    : 'runtime failed';
}
