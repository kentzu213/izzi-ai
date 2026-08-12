import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const roomPath = fileURLToPath(new URL('./CustomerMarketingRoom.tsx', import.meta.url));
const roomSource = readFileSync(roomPath, 'utf8');
const preloadPath = fileURLToPath(new URL('../../main/preload.ts', import.meta.url));
const preloadSource = readFileSync(preloadPath, 'utf8');
const rendererTypesPath = fileURLToPath(new URL('../types/global.d.ts', import.meta.url));
const rendererTypesSource = readFileSync(rendererTypesPath, 'utf8');
const mainPath = fileURLToPath(new URL('../../main/index.ts', import.meta.url));
const mainSource = readFileSync(mainPath, 'utf8');
const roomStylesPath = fileURLToPath(new URL('../styles/customer-marketing-room.css', import.meta.url));
const roomStylesSource = readFileSync(roomStylesPath, 'utf8');

describe('Customer Marketing Room Product Context editor contract', () => {
  it('paints the fail-closed initial snapshot before refreshing optional media readiness', () => {
    expect(roomSource).toContain('api.getSnapshot()');
    expect(roomSource).toContain('api.refreshSnapshot()');
    expect(roomSource).toContain('snapshotRequestRef.current');
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:refreshSnapshot')");
    expect(rendererTypesSource).toContain('refreshSnapshot: () => Promise<CustomerMarketingSnapshot>');
  });

  it('exposes bounded Telegram sandbox setup without renderer enable or execute channels', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:configureTelegramSandbox', input)");
    expect(rendererTypesSource).toContain('configureTelegramSandbox: (');
    expect(preloadSource).not.toContain("ipcRenderer.invoke('customerMarketing:enableCanary'");
    expect(preloadSource).not.toContain("ipcRenderer.invoke('customerMarketing:executeCanary'");
  });

  it('keeps BrandView mounted while another workspace view is active', () => {
    expect(roomSource).toMatch(
      /<div\s+hidden=\{activeView !== 'brand'\}\s+aria-hidden=\{activeView !== 'brand'\}\s*>[\s\S]*?<BrandView[\s\S]*?<\/div>/,
    );
    expect(roomSource).not.toContain("{activeView === 'brand' && (\n            <BrandView");
  });

  it('labels the monthly quota as credits instead of a number of months', () => {
    expect(roomSource).toContain("monthlyQuota.toLocaleString('vi-VN')} credit/tháng");
    expect(roomSource).not.toContain("monthlyQuota.toLocaleString('vi-VN')} tháng");
  });

  it('shows the main-process context signer before save and keeps reviewer authority outside the form', () => {
    expect(roomSource).toContain('Revision mới sẽ được ký bằng tài khoản');
    expect(roomSource).toContain('contextAuthority.reviewerName');
    expect(roomSource).toContain('https://izziapi.com/dashboard/settings');
    expect(roomSource).toContain('|| !contextAuthority.canSave');
    expect(roomSource).toContain('authorityToken: contextAuthority.authorityToken');
    expect(roomSource).toContain("contextAuthority.status === 'confirmed'");
    expect(roomSource).toContain('key={snapshot.productMarketingContextAuthority.scopeToken}');
    expect(roomSource).toContain('aria-describedby="cmr-context-signer"');
    expect(roomSource).not.toContain('reviewer: contextAuthority.reviewerName');
  });

  it('keeps the renderer strict-typecheck path free of stale capability wiring', () => {
    expect(roomSource).not.toContain('customer-marketing-voice-preview');
    expect(roomSource).toContain('onOpen={openCapabilityView}');
    expect(roomSource).not.toContain("openCapabilityView(action, 'apps')");
  });

  it('repairs Voice Studio only through the zero-payload Customer Marketing API', () => {
    expect(roomSource).toContain('api.repairVoiceStudio()');
    expect(roomSource).toContain('Khởi động Voice Studio');
    expect(roomSource).not.toContain("extensionRuntime.start('ext-voice-studio')");
    expect(roomSource).not.toContain("repairVoiceStudio('ext-voice-studio')");
  });

  it('creates voice previews through the renderer-safe job-id-only bridge', () => {
    expect(roomSource).toContain('api.createMediaVoicePreview({ jobId })');
    expect(roomSource).toContain('Tạo voice preview');
    expect(roomSource).toContain('Tạo lại voice preview');
    expect(roomSource).toContain('job.voicePreview.provider');
    expect(roomSource).toContain('job.voicePreview.voiceId');
    expect(roomSource).toContain('job.voicePreview.clipCount');
    expect(roomSource).toContain('job.voicePreview.totalBytes');
    expect(roomSource).toContain('job.voicePreview.commercialUseAllowed');
    expect(roomSource).not.toMatch(/createMediaVoicePreview\(\{[^}]*\b(text|voice|path|workspaceId)\b/);
    expect(roomSource).toContain('voicePreviewBlockedMessage');
    expect(roomSource).toContain('aria-describedby={voicePreviewBlockedMessage ? voicePreviewDescriptionId : undefined}');
    expect(roomSource).toContain('Biên nhận voice preview');
    expect(roomSource).toContain('} đoạn · {formatBytes(job.voicePreview.totalBytes)}');
    expect(roomSource).not.toContain('} clip · {formatBytes(job.voicePreview.totalBytes)}');
    expect(roomStylesSource).toMatch(/\.cmr-media-receipt > div \{[\s\S]*?min-width: 0;/);
    expect(roomStylesSource).toMatch(/\.cmr-media-receipt strong,[\s\S]*?overflow-wrap: anywhere;/);

    expect(preloadSource).toContain('CustomerMediaVoicePreviewInput');
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:createMediaVoicePreview', input)");
    expect(rendererTypesSource).toContain('createMediaVoicePreview: (input: CustomerMediaVoicePreviewInput)');
    expect(mainSource).toContain('createCustomerVoiceStudioSynthesizer');
    expect(mainSource).toContain("extensionLoader.executeCommand(VOICE_STUDIO_EXTENSION_ID, 'voice-studio.tts', input)");
    expect(mainSource).toContain("extension.id === VOICE_STUDIO_EXTENSION_ID && extension.name === 'voice-studio'");
    expect(mainSource).not.toContain("extension.id === 'ext-voice-studio' || extension.name === 'voice-studio'");
  });

  it('creates local video previews through the renderer-safe job-id-only bridge', () => {
    expect(roomSource).toContain('api.createMediaVideoPreview({ jobId })');
    expect(roomSource).toContain('api.openMediaVideoPreview({ jobId })');
    expect(roomSource).toContain('Tạo local video preview');
    expect(roomSource).toContain('Tạo lại local video');
    expect(roomSource).toContain('Mở video');
    expect(roomSource).toContain('job.videoPreview.width');
    expect(roomSource).toContain('job.videoPreview.height');
    expect(roomSource).toContain('job.videoPreview.fps');
    expect(roomSource).toContain('job.videoPreview.durationSeconds');
    expect(roomSource).toContain('job.videoPreview.voiceId');
    expect(roomSource).toContain('job.videoPreview.audioSampleRate');
    expect(roomSource).toContain('job.videoPreview.audioChannels');
    expect(roomSource).toContain('job.videoPreview.fileName');
    expect(roomSource).toContain('job.videoPreview.runId?.slice(-8)');
    expect(roomSource).toContain('job.videoPreview.totalBytes');
    expect(roomSource).toContain('job.videoPreview.commercialUseAllowed');
    expect(roomSource).not.toMatch(/createMediaVideoPreview\(\{[^}]*\b(path|output|workspaceId|runtimeProjectId)\b/);
    expect(roomSource).not.toMatch(/openMediaVideoPreview\(\{[^}]*\b(path|output|workspaceId|runtimeProjectId)\b/);
    expect(roomSource).toContain('videoPreviewBlockedMessage');
    expect(roomSource).toContain('aria-describedby={videoPreviewBlockedMessage ? videoPreviewDescriptionId : undefined}');
    expect(roomSource).toContain('Biên nhận local video preview');
    expect(roomSource).toContain('role="note" tabIndex={0}');
    expect(roomSource).toContain("snapshot.media.jobs.some((job) => Boolean(job.videoPreview))");
    expect(roomStylesSource).toMatch(/\.cmr-media-gate-strip \{[\s\S]*?grid-template-columns: repeat\(4,/);
    expect(roomStylesSource).toContain('.cmr-permission-note:focus-visible');

    expect(preloadSource).toContain('CustomerMediaVideoPreviewInput');
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:createMediaVideoPreview', input)");
    expect(preloadSource).toContain("ipcRenderer.invoke('customerMarketing:openMediaVideoPreview', input)");
    expect(rendererTypesSource).toContain('createMediaVideoPreview: (input: CustomerMediaVideoPreviewInput)');
    expect(rendererTypesSource).toContain('openMediaVideoPreview: (input: CustomerMediaVideoPreviewInput)');
    expect(mainSource).toContain('openLocalFile: (candidate) => shell.openPath(candidate)');
  });

  it('surfaces imported SKILL.md knowledge as read-only metadata only', () => {
    expect(roomSource).toContain('SKILL.md · chỉ đọc');
    expect(roomSource).toContain("catalogStatus === 'synced'");
    expect(roomSource).toContain("capability.knowledge?.mode === 'read_only'");
    expect(roomSource).toContain('Nguồn ngoài chỉ đọc; không phải công cụ và không tự chạy.');
    expect(roomSource).toContain('knowledgeDescriptionId');
    expect(roomSource).not.toContain('title="Nguồn kiến thức chỉ đọc');
    expect(roomSource).not.toContain('knowledgeSkill.execute');
  });
});
