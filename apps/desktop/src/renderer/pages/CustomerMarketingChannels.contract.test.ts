import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readNormalized = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const pagePath = fileURLToPath(new URL('./CustomerMarketingChannels.tsx', import.meta.url));
const pageSource = readNormalized(pagePath);
const stylesPath = fileURLToPath(new URL('../styles/customer-marketing-room.css', import.meta.url));
const stylesSource = readNormalized(stylesPath);
const mainPath = fileURLToPath(new URL('../../main/index.ts', import.meta.url));
const mainSource = readNormalized(mainPath);

describe('CustomerMarketingChannels Telegram sandbox setup contract', () => {
  it('loads connector evidence with credentials and exposes bounded local health controls', () => {
    expect(pageSource).toContain('api.listConnectorOperations()');
    expect(pageSource).toContain('api.checkIntegrationHealth({ provider })');
    expect(pageSource).toContain("receipt.operation === 'health'");
    expect(pageSource).toContain('receipt.provider === item.provider');
    expect(pageSource).toContain('Lần kiểm tra');
    expect(pageSource).toContain('Receipt gần nhất');
    expect(pageSource).toContain("aria-label={'Kiểm tra cục bộ ' + providerLabel}");
    expect(pageSource).not.toMatch(/checkIntegrationHealth\(\{[^}]*\b(workspaceId|revision|token|chatId|url)\b/);
    expect(pageSource).not.toContain('executeConnector');
  });

  it('keeps connector evidence scan-friendly and responsive', () => {
    expect(stylesSource).toMatch(/\.cmr-credential-row__evidence \{[\s\S]*?grid-template-columns:/);
    expect(stylesSource).toMatch(/\.cmr-credential-row__actions \{[\s\S]*?display: flex;/);
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-credential-row[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-credential-health[\s\S]*?min-height: 44px;/,
    );
  });

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

describe('CustomerMarketingChannels connection center contract', () => {
  it('renders the three connection surfaces before workflow controls', () => {
    expect(pageSource).toContain('const connectionCenter = (');
    expect(pageSource).toMatch(/<\/header>\s*\{connectionCenter\}/);
    expect(pageSource).toContain("label: 'Facebook Test Page'");
    expect(pageSource).toContain("label: 'YouTube Private'");
    expect(pageSource).toContain("label: 'Telegram Sandbox'");
    expect(pageSource).toContain('Chỉ dùng Trang thử nghiệm (Test Page).');
    expect(pageSource).toContain('Video thử nghiệm luôn ở chế độ Riêng tư (Private).');
  });

  it('uses native workspace account metadata and keeps OAuth in main', () => {
    expect(pageSource).toContain('nativeApi.listWorkspaces()');
    expect(pageSource).toContain("nativeApi.createWorkspace({ name: 'Izzi Marketing' })");
    expect(pageSource).toContain('nativeApi.listAccounts(workspaceId)');
    expect(pageSource).toContain('readNativeAccounts(accounts.accounts)');
    expect(pageSource).toContain('nativeApi.beginConnect(nativeWorkspaceId, channel)');
    expect(pageSource).toContain('nativeApi.onOAuthStatus');
    expect(pageSource).not.toContain('redirectUrl');
    expect(pageSource).not.toContain('window.open(');
    expect(pageSource).not.toContain('api.createDraft(');
    expect(pageSource).not.toContain('api.listPosts(');
    expect(mainSource).toContain('accounts: summarizeAutopostAccounts(r.data)');
    expect(mainSource).not.toContain('accounts: Array.isArray(r.data)');
  });

  it('surfaces the native master status without the legacy Auto Post path', () => {
    expect(pageSource).toContain('const [nativeMaster, setNativeMaster] = useState');
    expect(pageSource).toContain("masterEnabled ? 'Đã bật, chưa xác thực' : 'Chưa kết nối'");
    expect(pageSource).toContain("nativeUnavailable");
    expect(pageSource).toContain("? 'Không khả dụng'");
    expect(pageSource).toContain("'Chưa khởi tạo workspace'");
    expect(pageSource).toContain("'Đang kiểm tra…'");
    expect(pageSource).toContain('Native Marketing API đang đọc trực tiếp workspace và tài khoản từ IzziAPI.');
    expect(pageSource).toContain('Tài khoản chưa có native Marketing workspace.');
    expect(pageSource).toContain('Chỉ Owner hoặc Manager có thể kết nối kênh.');
    expect(pageSource).not.toMatch(/electronAPI\??\.autopost/);
    expect(pageSource).not.toMatch(/autopost/i);
    expect(pageSource).not.toContain('connectErrorLabel');
    expect(pageSource).not.toContain('api.setEnabled');
    expect(pageSource).not.toContain('api.beginConnect(channel)');
    expect(pageSource).not.toContain('Kết nối Auto-Post');
    expect(pageSource).toContain('!masterConnected || nativeLoading');
    expect(pageSource).toContain('cmr-connect-center__reload');
    expect(stylesSource).toContain('.cmr-connect-center__reload');
    expect(pageSource).toContain('Kho khóa provider');
  });

  it('keeps the master control redacted and states the explicit connect flow', () => {
    expect(pageSource).toContain('Bấm Tải lại để cập nhật trạng thái.');
    expect(pageSource).not.toContain('backendUrl');
    expect(stylesSource).toMatch(/\.cmr-connect-master \{[\s\S]*?border-left: 2px solid/);
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-connect-master[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it('refreshes on focus and keeps Telegram on its secure setup form', () => {
    expect(pageSource).toContain("window.addEventListener('focus', onFocus)");
    expect(pageSource).toContain("window.removeEventListener('focus', onFocus)");
    expect(pageSource).toContain('aria-label="Tải lại trạng thái kết nối kênh"');
    expect(pageSource).toContain('telegramTokenInput.current?.focus()');
    expect(pageSource).toContain("scrollIntoView({ block: 'center' })");
    expect(pageSource).toContain('ref={telegramTokenInput}');
    expect(pageSource).toContain("const CHANNEL_CONNECT_ROLES: CustomerRole[] = ['owner', 'manager']");
  });

  it('keeps the connection center responsive and touch safe', () => {
    expect(stylesSource).toMatch(/\.cmr-connect-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    expect(stylesSource).toMatch(/\.cmr-connect-card \{[\s\S]*?border-left: 2px solid/);
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-connect-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 620px\) \{[\s\S]*?\.cmr-connect-center \.cmr-icon-button[\s\S]*?min-height: 44px;/,
    );
  });

  it('exposes an explicit workspace activation action instead of silent auto-create', () => {
    expect(pageSource).toContain('const [nativeWorkspaceMissing, setNativeWorkspaceMissing] = useState(false)');
    expect(pageSource).toContain('const [activatingWorkspace, setActivatingWorkspace] = useState(false)');
    expect(pageSource).toContain('Khởi tạo workspace Marketing');
    expect(pageSource).toContain('Đã khởi tạo native Marketing workspace. Bây giờ có thể kết nối kênh.');
    expect(pageSource).toMatch(
      /const activateWorkspace = async[\s\S]{0,700}createWorkspace\(\{ name: 'Izzi Marketing' \}\)/,
    );
    expect(pageSource.match(/createWorkspace\(/g)).toHaveLength(1);
    expect(pageSource).toMatch(
      /if \(!workspace\) \{\s*setNativeWorkspaceId\(''\);\s*setNativeWorkspaceMissing\(true\);/,
    );
    expect(pageSource).toContain('disabled={!canConnectChannels || activatingWorkspace || nativeLoading}');
    expect(pageSource).toContain('Cần khởi tạo native Marketing workspace trước.');
    expect(pageSource).toContain('Khởi tạo native Marketing workspace nếu chưa có.');
    expect(stylesSource).toContain('.cmr-connect-master__action');
  });

  it('reports the native-unavailable state instead of an Auto Post fallback', () => {
    expect(pageSource).toContain('Native Marketing API chưa khả dụng trong bản Izzi AI này.');
    expect(pageSource).toContain('Cập nhật Izzi AI Desktop để dùng Native Marketing API.');
    expect(pageSource).toMatch(
      /setNativeMarketingMode\(false\);[\s\S]{0,400}setNativeError\('Native Marketing API chưa khả dụng/,
    );
    expect(pageSource).toContain("'request-rejected'");
    expect(pageSource).toContain('Không hoàn tất được kết nối native. Chưa lưu tài khoản nào.');
    expect(pageSource).toContain('Chưa có native Marketing workspace. Hãy khởi tạo workspace trước.');
    expect(pageSource).toContain("'not-found': 'IzziAPI chưa triển khai Native Marketing API trên môi trường hiện tại.'");
    expect(pageSource).not.toContain('Bridge gián đoạn');
  });
});
