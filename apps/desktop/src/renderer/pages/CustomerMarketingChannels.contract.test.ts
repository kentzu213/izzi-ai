import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pagePath = fileURLToPath(new URL('./CustomerMarketingChannels.tsx', import.meta.url));
const pageSource = readFileSync(pagePath, 'utf8');
const stylesPath = fileURLToPath(new URL('../styles/customer-marketing-room.css', import.meta.url));
const stylesSource = readFileSync(stylesPath, 'utf8');

describe('CustomerMarketingChannels Telegram sandbox setup contract', () => {
  it('shows redacted readiness and submits only the bounded setup payload', () => {
    expect(pageSource).toContain('api.getCanaryReadiness()');
    expect(pageSource).toContain('api.configureTelegramSandbox({');
    expect(pageSource).toContain('token: telegramToken');
    expect(pageSource).toContain('privateSandboxChatId: telegramChatId');
    expect(pageSource).toContain('type="password"');
    expect(pageSource).toContain('autoComplete="off"');
    expect(pageSource).toContain("setTelegramToken('')");
    expect(pageSource).toContain("setTelegramChatId('')");
    expect(pageSource).toContain("Boolean(canaryReadiness && !canaryReadiness.missingRequirements.includes('private_sandbox_chat'))");
    expect(pageSource).not.toContain('api.enableCanary(');
    expect(pageSource).not.toContain('api.executeCanary(');
  });

  it('keeps the setup form responsive without nested cards', () => {
    expect(stylesSource).toMatch(/\.cmr-telegram-setup \{[\s\S]*?grid-template-columns:/);
    expect(stylesSource).toMatch(/@media \(max-width: 620px\) \{[\s\S]*?\.cmr-telegram-setup/);
    expect(pageSource).not.toContain('cmr-telegram-card');
  });

  it('previews an approved Social candidate without exposing enable or execute controls', () => {
    expect(pageSource).toContain('api.prepareTelegramCanaryCandidate({');
    expect(pageSource).toContain('workflowId: workflow.workflowId');
    expect(pageSource).toContain('manifestDigest: workflow.manifestDigest');
    expect(pageSource).toContain('telegramCandidate.text');
    expect(pageSource).toContain('telegramCandidate.resourceDigest');
    expect(pageSource).toContain('Chuẩn bị Telegram preview');
    expect(pageSource).toContain("workflow?.status === 'approved' && !canConfigureTelegram");
    expect(pageSource).toContain('Chỉ Owner hoặc Manager có thể chuẩn bị Telegram preview.');
    expect(pageSource).not.toContain('api.enableCanary(');
    expect(pageSource).not.toContain('api.executeCanary(');
  });

  it('keeps the Telegram candidate action touch-safe on mobile', () => {
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-telegram-candidate > \.cmr-button[\s\S]*?min-height: 44px;/,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-telegram-candidate__preview > div,[\s\S]*?\.cmr-telegram-candidate__permission[\s\S]*?font-size: 11px;/,
    );
  });
});
