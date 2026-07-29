import { spawn } from 'child_process';
import type { NativeRuntimeSpec, RuntimeSpec } from '../../shared/runtime';
import { assertRealPathContained, type RealPathResolver } from './path-security';
import { redactRuntimeText } from './redaction';
import type { RuntimeAdapter, RuntimeAdapterResult } from './runtime-manager';

export interface NativeExecutableVerifier {
  verify(executable: string, expectedSha256: string): Promise<boolean>;
}

export interface RuntimeSecretResolver {
  resolve(ref: NativeRuntimeSpec['env'][number]['secret'], authority: NativeRuntimeSpec['authority']): Promise<string>;
}

export interface NativeProcessHandle {
  readonly pid?: number;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill(): void;
}

export interface NativeProcessRunner {
  start(input: {
    executable: string;
    args: readonly string[];
    cwd: string;
    env: Readonly<Record<string, string>>;
    onLog: (line: string) => void;
  }): NativeProcessHandle;
}

export class ChildProcessNativeRunner implements NativeProcessRunner {
  start(input: {
    executable: string;
    args: readonly string[];
    cwd: string;
    env: Readonly<Record<string, string>>;
    onLog: (line: string) => void;
  }): NativeProcessHandle {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => input.onLog(chunk.toString()));
    child.stderr.on('data', (chunk) => input.onLog(chunk.toString()));
    return {
      pid: child.pid,
      exited: new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      }),
      kill: () => child.kill(),
    };
  }
}

export class NativeProcessAdapter implements RuntimeAdapter {
  readonly kind: 'node' | 'binary';
  private readonly running = new Map<string, NativeProcessHandle>();
  private readonly logsByRuntime = new Map<string, string[]>();

  constructor(
    kind: 'node' | 'binary',
    private readonly verifier: NativeExecutableVerifier,
    private readonly secrets: RuntimeSecretResolver,
    private readonly runner: NativeProcessRunner = new ChildProcessNativeRunner(),
    private readonly realPaths?: RealPathResolver,
  ) {
    this.kind = kind;
  }

  async start(spec: RuntimeSpec, signal: AbortSignal): Promise<RuntimeAdapterResult> {
    if (spec.kind !== this.kind) throw new Error(`Expected ${this.kind} runtime`);
    const native = spec as NativeRuntimeSpec;
    const executable = assertRealPathContained(
      'executable',
      native.executable,
      native.paths.allowedRoots,
      this.realPaths,
    );
    const cwd = assertRealPathContained(
      'workDir',
      native.paths.workDir,
      native.paths.allowedRoots,
      this.realPaths,
    );
    if (!(await this.verifier.verify(executable, native.executableSha256))) {
      throw new Error('Native executable verification failed');
    }

    const env: Record<string, string> = {};
    const resolvedSecrets: string[] = [];
    for (const binding of native.env) {
      const value = await this.secrets.resolve(binding.secret, native.authority);
      env[binding.name] = value;
      resolvedSecrets.push(value);
    }
    const logs: string[] = [];
    this.logsByRuntime.set(native.id, logs);
    const handle = this.runner.start({
      executable,
      args: native.args,
      cwd,
      env,
      onLog: (line) => {
        const redacted = redactRuntimeText(line, resolvedSecrets).trim();
        if (redacted) logs.push(redacted.slice(0, 2_000));
        if (logs.length > 500) logs.splice(0, logs.length - 500);
      },
    });
    this.running.set(native.id, handle);
    signal.addEventListener('abort', () => handle.kill(), { once: true });
    void handle.exited.finally(() => this.running.delete(native.id));
    return { healthy: true, detail: handle.pid ? `pid ${handle.pid}` : 'process started' };
  }

  async stop(spec: RuntimeSpec): Promise<void> {
    this.running.get(spec.id)?.kill();
    this.running.delete(spec.id);
  }

  async health(spec: RuntimeSpec): Promise<RuntimeAdapterResult> {
    return { healthy: this.running.has(spec.id) };
  }

  async logs(spec: RuntimeSpec, tail: number): Promise<readonly string[]> {
    return (this.logsByRuntime.get(spec.id) ?? []).slice(-Math.max(0, Math.min(tail, 500)));
  }
}
