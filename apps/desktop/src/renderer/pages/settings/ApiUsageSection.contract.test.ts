import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

describe('API & Usage wiring contract', () => {
  it('adds an API & Usage tab to Settings that renders ApiUsageSection', () => {
    const settings = read('renderer/pages/Settings.tsx');
    expect(settings).toContain("{ id: 'apiUsage', label: 'API & Usage' }");
    expect(settings).toContain("{activeSection === 'apiUsage' && <ApiUsageSection />}");
  });

  it('lets Custom Provider create a fresh Izzi key in place', () => {
    const settings = read('renderer/pages/Settings.tsx');
    expect(settings).toContain('Tạo key Izzi mới & dùng ngay');
    expect(settings).toContain('<CreateIzziKeyFlow');
  });

  it('offers gpt-6.1-sol in the Custom Provider model list and store allowlist', () => {
    expect(read('renderer/pages/Settings.tsx')).toMatch(/ALLOWED_MODELS_UI = \[[^\]]*'gpt-6\.1-sol'/);
    expect(read('main/agent/provider-settings-store.ts')).toContain("'gpt-6.1-sol'");
  });

  it('exposes the izziAccount bridge from preload through to the renderer types', () => {
    expect(read('main/preload.ts')).toMatch(/izziAccount:\s*\{/);
    expect(read('main/index.ts')).toContain('registerIzziAccountIpc');
    expect(read('renderer/types/global.d.ts')).toContain('izziAccount?: ElectronIzziAccountApi');
  });
});
