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

  it('issues named approval from the exact preview before a distinct enable-only step', () => {
    expect(pageSource).toContain('api.approveTelegramCanaryCandidate({');
    expect(pageSource).toContain('resourceDigest: telegramCandidate.resourceDigest');
    expect(pageSource).toContain('expectedRevision: telegramCandidate.expectedRevision');
    expect(pageSource).toContain('Canary vẫn tắt');
    expect(pageSource).toContain('Chỉ tạo receipt phê duyệt. Canary vẫn tắt và không gửi tin nhắn.');
    expect(pageSource).toContain("canaryEnabled ? 'Named approval đã xử lý' : namedApprovalReady ? 'Named approval đã cấp' : 'Chưa có named approval'");
    expect(pageSource).toContain("canaryReadiness?.controlPlane?.killSwitch ? 'Kill switch đang bật' : canaryEnabled ? 'Canary đã bật' : 'Canary chưa bật'");
    expect(pageSource).toContain("telegramApproval ? 'Named approval đã cấp' : 'Chờ named approval'");
    expect(pageSource).toContain('telegramCandidatePreview.current?.focus()');
    expect(pageSource).toContain('telegramApprovalReceipt.current?.focus()');
    expect(pageSource).not.toContain('reviewer:');
    expect(pageSource).not.toContain('expiresAt:');
    expect(pageSource).toContain('api.enableTelegramCanary({');
    expect(pageSource).toContain('expectedStateRevision: controlPlane.stateRevision');
    expect(pageSource).toContain('Bật canary nội bộ');
    expect(pageSource).toContain('Chỉ bind candidate đã duyệt vào control plane. Không gửi Telegram.');
    expect(pageSource).toContain('telegramEnableReceiptRef.current?.focus()');
    expect(pageSource).toContain('telegramCandidate && !telegramApproval && !telegramEnableReceipt');
    expect(pageSource).toContain("item !== 'named_approval' && item !== 'canary_enablement'");
    expect(pageSource).not.toMatch(/setTelegramEnableAnnouncement\([\s\S]{0,300}await loadCredentials\(\)/);
    expect(pageSource).toContain('externalActionPerformed');
    expect(pageSource).not.toContain('api.executeCanary(');
  });

  it('rolls back an enabled canary independently of local candidate state', () => {
    expect(pageSource).toContain('api.rollbackTelegramCanary({');
    expect(pageSource).toContain('expectedStateRevision: controlPlane.stateRevision');
    expect(pageSource).toContain('Rollback canary');
    expect(pageSource).toContain('Gỡ binding khỏi control plane. Không gửi Telegram.');
    expect(pageSource).toContain('telegramRollbackReceiptRef.current?.focus()');
    expect(pageSource).toContain('setTelegramRollbackReceipt(null)');
    expect(pageSource).toContain('setTelegramEnableReceipt(null)');
    expect(pageSource).toContain("setTelegramRollbackAnnouncement('Canary đã rollback. Không gửi Telegram.')");
    expect(pageSource).toContain('liveReady: false');
    expect(pageSource).toContain("'named_approval' as const");
    expect(pageSource).toContain("'canary_enablement' as const");
    expect(pageSource).toContain('telegramRollbackReceipt.reason');
    expect(pageSource).toContain('formatTime(telegramRollbackReceipt.createdAt)');
    expect(pageSource).not.toMatch(/cmr-telegram-rollback-receipt[\s\S]{0,180}role="status"/);
    expect(stylesSource).toMatch(/\.cmr-button--danger \{[\s\S]*?border-color:[\s\S]*?background:/);
    expect(stylesSource).toMatch(/\.cmr-canary-readiness > span \{[\s\S]*?font-size: 12px;/);
    expect(stylesSource).toMatch(/\.cmr-credential-empty,[\s\S]*?\.cmr-credential-error \{[\s\S]*?font-size: 12px;/);
    expect(pageSource).toContain('canaryReadiness?.controlPlane?.enabled');
    expect(pageSource).not.toContain("reason: 'operator-request'");
    expect(pageSource).not.toContain('api.executeCanary(');
  });

  it('offers one bounded send only after canary enablement and keeps rollback independent', () => {
    expect(pageSource).toContain('api.sendTelegramCanary({');
    expect(pageSource).toContain('workflowId: telegramCandidate.workflowId');
    expect(pageSource).toContain('manifestDigest: telegramCandidate.manifestDigest');
    expect(pageSource).toContain('resourceDigest: telegramCandidate.resourceDigest');
    expect(pageSource).toContain('expectedRevision: telegramCandidate.expectedRevision');
    expect(pageSource).toContain('expectedStateRevision: controlPlane.stateRevision');
    expect(pageSource).toContain('canaryEnabled && telegramCandidate && !telegramSendResult');
    expect(pageSource).toContain('Gửi đúng 1 tin private');
    expect(pageSource).toContain('Cửa sổ xác nhận riêng sẽ mở trước khi gửi đúng một tin thật. Nếu kết quả không xác định,');
    expect(pageSource).toContain('telegramSendResult.outcome === \'unknown\'');
    expect(pageSource).toContain('Không thử lại. Hãy rollback và kiểm tra Telegram thủ công.');
    expect(pageSource).toContain("detail: 'renderer-bridge-failed'");
    expect(pageSource).toMatch(/detail: 'renderer-bridge-failed',[\s\S]{0,120}externalActionPerformed: null/);
    expect(pageSource).toContain('telegramSendReceiptRef.current?.focus()');
    expect(pageSource).not.toMatch(/sendTelegramCanary\(\{[^}]*\b(token|chatId|text|reviewer|confirmed|idempotencyKey)\b/);
    expect(stylesSource).toMatch(/\.cmr-telegram-send-action > \.cmr-button[\s\S]*?width: 100%;/);
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-telegram-send-action > \.cmr-button[\s\S]*?min-height: 44px;/,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-telegram-approval-action > \.cmr-button[\s\S]*?min-height: 44px;/,
    );
    expect(pageSource).toMatch(/cmr-telegram-send-action[\s\S]{0,500}cmr-button cmr-button--danger/);
    expect(pageSource).toMatch(/cmr-telegram-rollback-action[\s\S]{0,500}cmr-button cmr-button--quiet/);
  });
});
