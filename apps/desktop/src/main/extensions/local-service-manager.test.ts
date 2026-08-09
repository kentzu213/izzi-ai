import { describe, it, expect, vi } from 'vitest';
import {
  LocalServiceManager,
  parseGenSpec,
  generateSecretValue,
  resolveInject,
  resolveInjectAll,
  buildComposeUpArgs,
  buildComposeDownArgs,
  buildManagedComposeProcessEnv,
  parseComposePsRunning,
  checkPortFree,
  findFreePort,
} from './local-service-manager';

describe('LocalServiceManager Docker availability', () => {
  it('requires both the Compose CLI and a reachable Docker server', async () => {
    const manager = new LocalServiceManager();
    const exec = vi.spyOn(manager as any, 'exec')
      .mockResolvedValueOnce({ code: 0, stdout: 'Docker Compose version v5.3.1', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'daemon unavailable' });

    await expect(manager.isDockerAvailable()).resolves.toBe(false);
    expect(exec.mock.calls[0]?.[0]).toEqual(['compose', 'version']);
    expect(exec.mock.calls[0]?.[1]).toBe(10_000);
    expect(exec.mock.calls[1]?.[0]).toEqual(['version', '--format', '{{.Server.Version}}']);
    expect(exec.mock.calls[1]?.[1]).toBe(10_000);
  });

  it('reports Docker available only after the server answers', async () => {
    const manager = new LocalServiceManager();
    vi.spyOn(manager as any, 'exec')
      .mockResolvedValueOnce({ code: 0, stdout: 'Docker Compose version v5.3.1', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '29.6.2', stderr: '' });

    await expect(manager.isDockerAvailable()).resolves.toBe(true);
  });
});

describe('parseGenSpec', () => {
  it('parses hex and base64 specs', () => {
    expect(parseGenSpec('hex:64')).toEqual({ kind: 'hex', len: 64 });
    expect(parseGenSpec('base64:32')).toEqual({ kind: 'base64', len: 32 });
  });
  it('rejects malformed specs', () => {
    expect(parseGenSpec('md5')).toBeNull();
    expect(parseGenSpec('hex:0')).toBeNull();
    expect(parseGenSpec('hex:')).toBeNull();
    expect(parseGenSpec('')).toBeNull();
  });
});

describe('generateSecretValue', () => {
  it('produces a hex string of the requested length', () => {
    const v = generateSecretValue('hex:64');
    expect(v).toMatch(/^[0-9a-f]{64}$/);
  });
  it('produces distinct values (crypto-random)', () => {
    expect(generateSecretValue('hex:32')).not.toEqual(generateSecretValue('hex:32'));
  });
  it('produces base64 from N random bytes', () => {
    const v = generateSecretValue('base64:32');
    expect(v.length).toBeGreaterThanOrEqual(40); // 32 bytes → 44 chars incl padding
  });
  it('throws on a bad spec', () => {
    expect(() => generateSecretValue('nope')).toThrow();
  });
});

describe('resolveInject', () => {
  it('substitutes ${port.name} with the allocated host port', () => {
    expect(resolveInject('http://127.0.0.1:${port.api}', { api: 3001 })).toBe('http://127.0.0.1:3001');
  });
  it('leaves an unknown port token empty', () => {
    expect(resolveInject('http://127.0.0.1:${port.web}', { api: 3001 })).toBe('http://127.0.0.1:');
  });
  it('resolveInjectAll maps every key', () => {
    const out = resolveInjectAll({ backendUrl: 'http://127.0.0.1:${port.api}', webUrl: 'http://127.0.0.1:${port.web}' }, { api: 3001, web: 3005 });
    expect(out).toEqual({ backendUrl: 'http://127.0.0.1:3001', webUrl: 'http://127.0.0.1:3005' });
  });
});

describe('compose args (array-form, no shell interpolation)', () => {
  it('builds up args with -p / -f / --env-file / up -d', () => {
    expect(buildComposeUpArgs('izzi-svc-x', '/ext/compose.yml', '/data/.env')).toEqual([
      'compose', '-p', 'izzi-svc-x', '-f', '/ext/compose.yml', '--env-file', '/data/.env', 'up', '-d',
    ]);
  });
  it('down args never include -v (volumes are preserved)', () => {
    const args = buildComposeDownArgs('izzi-svc-x', '/ext/compose.yml', '/data/.env');
    expect(args).toContain('down');
    expect(args).not.toContain('-v');
    expect(args).not.toContain('--volumes');
  });
});

describe('managed compose environment', () => {
  it('keeps generated service values authoritative and rejects remote Docker connection context', () => {
    const env = buildManagedComposeProcessEnv(
      {
        PATH: 'docker-path',
        TEMP: 'temp-path',
        IZZI_PORT_API: '59999',
        IZZI_BIND: '0.0.0.0',
        VOICE_TTS_IMAGE: 'example.invalid/adversarial/voice:latest',
        JWT_SECRET: 'ambient-secret',
        COMPOSE_FILE: 'attacker.yml',
        COMPOSE_PROJECT_NAME: 'attacker',
        DOCKER_HOST: 'tcp://docker.example.invalid:2376',
        DOCKER_CONTEXT: 'remote',
        DOCKER_TLS_VERIFY: '1',
        DOCKER_CERT_PATH: 'C:\\docker-certs',
        DOCKER_CONFIG: 'C:\\docker-config',
      },
      ['IZZI_PORT_API', 'JWT_SECRET', 'PATH'],
    );

    expect(env).toEqual({
      PATH: 'docker-path',
      TEMP: 'temp-path',
      DOCKER_CONTEXT: 'default',
    });
  });

  it('preserves validated local Docker Desktop and loopback connection values', () => {
    const contextEnv = buildManagedComposeProcessEnv(
      { PATH: 'docker-path', DOCKER_CONTEXT: 'desktop-linux', DOCKER_CONFIG: 'C:\\docker-config' },
      [],
    );
    expect(contextEnv).toEqual({
      PATH: 'docker-path',
      DOCKER_CONTEXT: 'desktop-linux',
    });

    const hostEnv = buildManagedComposeProcessEnv(
      {
        PATH: 'docker-path',
        DOCKER_HOST: 'tcp://127.0.0.1:2376',
        DOCKER_TLS_VERIFY: '1',
        DOCKER_CERT_PATH: 'C:\\docker-certs',
      },
      [],
    );
    expect(hostEnv).toEqual({
      PATH: 'docker-path',
      DOCKER_HOST: 'tcp://127.0.0.1:2376',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_CERT_PATH: 'C:\\docker-certs',
    });
  });

  it('preserves process launch variables even if a malformed caller marks them managed', () => {
    const env = buildManagedComposeProcessEnv({ PATH: 'docker-path', TEMP: 'temp-path' }, ['PATH', 'TEMP']);
    expect(env).toEqual({ PATH: 'docker-path', TEMP: 'temp-path', DOCKER_CONTEXT: 'default' });
  });

  it('does not let a custom Docker config select a remote currentContext', () => {
    const env = buildManagedComposeProcessEnv(
      { PATH: 'docker-path', DOCKER_CONFIG: 'C:\\remote-config' },
      [],
    );
    expect(env).toEqual({ PATH: 'docker-path', DOCKER_CONTEXT: 'default' });
  });
});

describe('parseComposePsRunning', () => {
  it('detects running from a JSON array', () => {
    expect(parseComposePsRunning('[{"Service":"api","State":"running"}]')).toBe(true);
  });
  it('detects running from newline-delimited JSON', () => {
    expect(parseComposePsRunning('{"Service":"api","State":"exited"}\n{"Service":"db","State":"running"}')).toBe(true);
  });
  it('returns false when nothing is running or output is empty', () => {
    expect(parseComposePsRunning('[{"Service":"api","State":"exited"}]')).toBe(false);
    expect(parseComposePsRunning('')).toBe(false);
    expect(parseComposePsRunning('garbage')).toBe(false);
  });
});

describe('port allocation', () => {
  it('reports a bound port as not free, and finds an alternative', async () => {
    const net = await import('node:net');
    const srv = net.createServer();
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const addr = srv.address();
    const taken = addr && typeof addr === 'object' ? addr.port : 0;

    expect(await checkPortFree(taken)).toBe(false);
    const alt = await findFreePort(taken);
    expect(alt).toBeGreaterThan(0);
    expect(alt).not.toBe(taken);

    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});
