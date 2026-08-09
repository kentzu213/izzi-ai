import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const roomPath = fileURLToPath(new URL('./CustomerMarketingRoom.tsx', import.meta.url));
const roomSource = readFileSync(roomPath, 'utf8');

describe('Customer Marketing Room Product Context editor contract', () => {
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
});
