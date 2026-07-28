// ── Docker Compose Generator ──
// Generates docker-compose.yml based on wizard configuration.
// Ported from: tuanminhhole/openclaw-setup (setup.js Docker mode)

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { WizardConfig } from './setup-wizard-service';

// ── Types ──

interface DockerComposeConfig {
  projectDir: string;
  gatewayPort: number;
  routerPort: number;
  enableOllama: boolean;
  ollamaModel?: string;
  enable9Router: boolean;
}

// ── Generator ──

export function generateDockerCompose(
  config: WizardConfig,
  options: Partial<DockerComposeConfig> = {},
): string {
  const projectDir = options.projectDir || path.join(os.homedir(), '.openclaw');
  const gatewayPort = options.gatewayPort || 18791;
  const routerPort = options.routerPort || 20128;
  const enableOllama = config.provider === 'ollama' || options.enableOllama || false;
  const enable9Router = config.provider === '9router' || options.enable9Router || false;
  const ollamaModel = options.ollamaModel || 'gemma4:e2b';

  const lines: string[] = [
    '# Izzi AI — Docker Compose',
    `# Generated: ${new Date().toISOString()}`,
    `# Channel: ${config.channel}`,
    `# Provider: ${config.provider}`,
    '',
    'version: "3.8"',
    '',
    'services:',
  ];

  // ── Main OpenClaw bot service ──
  lines.push(...[
    '  ai-bot:',
    '    image: openclaw/openclaw:latest',
    '    container_name: izzi-openclaw-bot',
    '    restart: unless-stopped',
    '    ports:',
    `      - "${gatewayPort}:${gatewayPort}"`,
    '    volumes:',
    `      - ${projectDir}/.openclaw:/root/.openclaw`,
    '    environment:',
    '      - NODE_ENV=production',
    `      - GATEWAY_PORT=${gatewayPort}`,
  ]);

  // API key for paid providers
  if (config.apiKey && !['ollama', '9router'].includes(config.provider)) {
    const envVarName = getProviderEnvVar(config.provider);
    lines.push(`      - ${envVarName}=${config.apiKey}`);
  }

  // Base URL override
  if (config.baseUrl) {
    lines.push(`      - OPENAI_API_BASE=${config.baseUrl}`);
  }

  // 9Router connection (same Docker network, no API key needed)
  if (enable9Router) {
    lines.push('      - OPENAI_API_BASE=http://9router:20128/v1');
    lines.push('      - OPENAI_API_KEY=sk-placeholder');
  }

  // Ollama connection
  if (enableOllama) {
    lines.push('      - OLLAMA_BASE_URL=http://ollama:11434');
  }

  // Telegram tokens
  if (['telegram', 'telegram-multi', 'combo'].includes(config.channel)) {
    config.telegramTokens.forEach((token, i) => {
      if (token.trim()) {
        lines.push(`      - TELEGRAM_BOT_TOKEN_${i + 1}=${token.trim()}`);
      }
    });
  }

  // Zalo config
  if (['zalo-bot', 'zalo-personal', 'combo'].includes(config.channel)) {
    if (config.zaloAppId) lines.push(`      - ZALO_APP_ID=${config.zaloAppId}`);
    if (config.zaloAppSecret) lines.push(`      - ZALO_APP_SECRET=${config.zaloAppSecret}`);
    if (config.zaloRefreshToken) lines.push(`      - ZALO_REFRESH_TOKEN=${config.zaloRefreshToken}`);
  }

  // Cold-start trigger for Zalo Personal (45s delay)
  // Source: tuanminhhole/openclaw-setup Dockerfile CMD logic
  if (config.channel === 'zalo-personal' || config.channel === 'combo') {
    lines.push('    command: >');
    lines.push('      sh -c "openclaw gateway start &');
    lines.push('      sleep 45 &&');
    lines.push('      curl -s http://localhost:${GATEWAY_PORT}/health || true &&');
    lines.push('      wait"');
  }

  // Network dependency
  if (enable9Router || enableOllama) {
    lines.push('    depends_on:');
    if (enable9Router) lines.push('      - 9router');
    if (enableOllama) lines.push('      - ollama');
  }

  lines.push('    networks:');
  lines.push('      - openclaw-net');
  lines.push('');

  // ── 9Router service ──
  if (enable9Router) {
    lines.push(...[
      '  9router:',
      '    image: node:22-slim',
      '    container_name: izzi-9router',
      '    restart: unless-stopped',
      '    ports:',
      `      - "${routerPort}:${routerPort}"`,
      '    volumes:',
      `      - ${projectDir}/.9router:/app/data`,
      '    environment:',
      `      - PORT=${routerPort}`,
      '      - HOSTNAME=0.0.0.0',
      '      - DATA_DIR=/app/data',
      '    command: >',
      '      sh -c "npm install -g 9router &&',
      `      9router -n -l -H 0.0.0.0 -p ${routerPort} --skip-update"`,
      '    networks:',
      '      - openclaw-net',
      '',
    ]);
  }

  // ── Ollama service ──
  if (enableOllama) {
    lines.push(...[
      '  ollama:',
      '    image: ollama/ollama:latest',
      '    container_name: izzi-ollama',
      '    restart: unless-stopped',
      '    ports:',
      '      - "11434:11434"',
      '    volumes:',
      '      - ollama-data:/root/.ollama',
      '    environment:',
      '      - OLLAMA_HOST=0.0.0.0',
      `    # Auto-pull model on first start: ${ollamaModel}`,
      '    # Run: docker exec izzi-ollama ollama pull ' + ollamaModel,
      '    networks:',
      '      - openclaw-net',
      '',
    ]);
  }

  // ── Networks ──
  lines.push(...[
    'networks:',
    '  openclaw-net:',
    '    driver: bridge',
    '',
  ]);

  // ── Volumes ──
  if (enableOllama) {
    lines.push(...[
      'volumes:',
      '  ollama-data:',
      '    driver: local',
      '',
    ]);
  }

  return lines.join('\n');
}

// ── Write docker-compose.yml to disk ──

export function writeDockerCompose(
  config: WizardConfig,
  projectDir: string,
  options?: Partial<DockerComposeConfig>,
): string {
  const content = generateDockerCompose(config, { ...options, projectDir });
  const dockerDir = path.join(projectDir, 'docker', 'openclaw');
  fs.mkdirSync(dockerDir, { recursive: true });

  const composePath = path.join(dockerDir, 'docker-compose.yml');
  fs.writeFileSync(composePath, content, 'utf-8');

  return composePath;
}

// ── Helper: Map provider to env variable ──

function getProviderEnvVar(provider: string): string {
  switch (provider) {
    case 'izzi': return 'OPENAI_API_KEY';
    case 'gemini': return 'GOOGLE_API_KEY';
    case 'claude': return 'ANTHROPIC_API_KEY';
    case 'gpt4o': return 'OPENAI_API_KEY';
    case 'openrouter': return 'OPENROUTER_API_KEY';
    case 'custom': return 'OPENAI_API_KEY';
    default: return 'OPENAI_API_KEY';
  }
}
