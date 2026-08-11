import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const sharedStyles = readFileSync(fileURLToPath(new URL('./styles/index.css', import.meta.url)), 'utf8');
const marketingStyles = readFileSync(
  fileURLToPath(new URL('./styles/customer-marketing-room.css', import.meta.url)),
  'utf8',
);

describe('renderer lazy-loading contract', () => {
  it('keeps shared mobile navigation styles in the eager renderer stylesheet', () => {
    expect(sharedStyles).toMatch(/\.app-mobile-nav\s*\{\s*display:\s*none;/);
    expect(sharedStyles).toContain('.app-mobile-nav button.is-active');
    expect(marketingStyles).not.toContain('.app-mobile-nav');
  });

  it('preloads the primary AI Marketing route after Chat becomes interactive', () => {
    expect(appSource).toContain('const loadCustomerMarketingRoom = () => import(');
    expect(appSource).toContain('const CustomerMarketingRoomPage = lazy(loadCustomerMarketingRoom);');
    expect(appSource).toContain("currentPage !== 'chat'");
    expect(appSource).toContain('void loadCustomerMarketingRoom().catch(() => undefined);');
  });

  it('uses a structured responsive fallback instead of a spinner-only state', () => {
    expect(appSource).toContain('app-page-loader__shell');
    expect(appSource).toContain('app-page-loader__grid');
    expect(appSource).toContain('app-page-loader__panel--wide');
    expect(appSource).toContain('<span className="sr-only">Đang tải trang</span>');
    expect(sharedStyles).toContain('@keyframes app-page-loading-pulse');
    expect(sharedStyles).toMatch(/prefers-reduced-motion:[^)]+\)[\s\S]*?\.app-page-loader__panel/);
  });
});
