import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './ocx-manifest';

const manifestPath = fileURLToPath(new URL('../../../../../extensions/voice-studio/manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

describe('bundled Voice Studio manifest contract', () => {
  it('is an explicit Customer Marketing local-preview capability', () => {
    expect(validateManifest(manifest)).toMatchObject({ valid: true, errors: [] });
    expect(manifest).toMatchObject({
      name: 'voice-studio',
      customerMarketing: true,
      repository: 'https://github.com/kentzu213/izzi-ai',
      customerMarketingCapability: {
        id: 'voice-studio-local-preview',
        minimumPlan: 'pro',
        permission: 'execute',
        stability: 'preview',
      },
    });
  });

  it('starts only on an explicit action and has no hosted fallback', () => {
    expect(manifest.activationEvents).not.toContain('onStartup');
    expect(manifest.service.fallback).toBeUndefined();
    expect(manifest.description).toBe(
      'Tạo bản nghe thử text-to-speech tiếng Việt/Anh hoàn toàn cục bộ bằng VieNeu-TTS. Không tải nội dung lên dịch vụ hosted.',
    );
  });
});
