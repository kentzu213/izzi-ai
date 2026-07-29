import type { DockerComposeRuntimeSpec, RuntimeSpec } from '../../shared/runtime';
import type {
  LocalServiceManager,
  ServiceRunContext,
} from '../extensions/local-service-manager';
import { redactRuntimeText } from './redaction';
import type { RuntimeAdapter, RuntimeAdapterResult } from './runtime-manager';

export interface DockerServiceContextResolver {
  resolve(spec: DockerComposeRuntimeSpec): Promise<ServiceRunContext | null>;
}
/**
 * Compatibility wrapper only. The legacy manager is never treated as policy
 * authority: the spec must carry all four isolation attestations and the
 * resolver must bind the exact workspace/package to an installed extension.
 */
export class DockerComposeRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'docker-compose' as const;

  constructor(
    private readonly manager: LocalServiceManager,
    private readonly contexts: DockerServiceContextResolver,
  ) {}

  async start(spec: RuntimeSpec, _signal: AbortSignal): Promise<RuntimeAdapterResult> {
    if (spec.kind !== 'docker-compose') throw new Error('Expected docker-compose runtime');
    if (!Object.values(spec.attestation).every(Boolean)) {
      throw new Error('Docker runtime isolation attestation is incomplete');
    }
    const context = await this.contexts.resolve(spec);
    if (!context || context.extensionId !== spec.extensionId || context.service.projectName !== spec.serviceProject) {
      throw new Error('Docker service is not bound to this runtime scope');
    }
    const result = await this.manager.up({
      ...context,
      onLog: (line) => context.onLog?.(redactRuntimeText(line)),
    });
    return { healthy: result.ok, ...(result.error ? { detail: redactRuntimeText(result.error) } : {}) };
  }

  async stop(spec: RuntimeSpec): Promise<void> {
    if (spec.kind !== 'docker-compose') return;
    const context = await this.contexts.resolve(spec);
    if (context) await this.manager.down(context);
  }

  async health(spec: RuntimeSpec): Promise<RuntimeAdapterResult> {
    if (spec.kind !== 'docker-compose') return { healthy: false };
    const context = await this.contexts.resolve(spec);
    if (!context) return { healthy: false, detail: 'service scope unavailable' };
    const status = await this.manager.status(context);
    return { healthy: status.running && status.healthy !== false };
  }

  async logs(spec: RuntimeSpec, tail: number): Promise<readonly string[]> {
    if (spec.kind !== 'docker-compose') return [];
    const context = await this.contexts.resolve(spec);
    if (!context) return [];
    return redactRuntimeText(await this.manager.logs(context, tail)).split(/\r?\n/).filter(Boolean);
  }
}
