import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppShellV2 } from './AppShellV2';
import { ContextNavigator } from './ContextNavigator';
import { ALL_NAV_ITEMS, type V2PageId } from './navModel';
import { ProjectHeader } from './ProjectHeader';

function renderShell(currentPage: V2PageId, theme?: 'dark' | 'light', extensionUpdateCount?: number) {
  return renderToStaticMarkup(
    createElement(AppShellV2, {
      currentPage,
      onNavigate: () => undefined,
      user: { name: 'Lan' },
      theme,
      extensionUpdateCount,
      children: createElement('div', { id: 'legacy-page' }, 'legacy'),
    }),
  );
}

function renderNavigator(extensionUpdateCount: number, onClose?: () => void) {
  return renderToStaticMarkup(
    createElement(ContextNavigator, {
      currentPage: 'chat',
      onNavigate: () => undefined,
      searchRef: createRef<HTMLInputElement>(),
      extensionUpdateCount,
      onClose,
    }),
  );
}

function renderHeader(isNavigatorOpen: boolean, extensionUpdateCount: number) {
  return renderToStaticMarkup(
    createElement(ProjectHeader, {
      currentPage: 'chat',
      isNavigatorOpen,
      isInspectorOpen: false,
      onToggleNavigator: () => undefined,
      onToggleInspector: () => undefined,
      extensionUpdateCount,
    }),
  );
}

function stubViewport(isCompact: boolean) {
  const noop = () => undefined;
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: isCompact, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
  });
}

const EXTENSIONS_BUTTON = /<button[^>]*data-page="extensions"[^>]*>[\s\S]*?<\/button>/;

describe('AppShellV2', () => {
  it('always shows the four required capabilities, with Knowlead Market as a disabled placeholder', () => {
    const html = renderShell('chat');

    for (const id of ['agent-marketing', 'knowlead-market', 'affiliate', 'mygraph']) {
      expect(html).toContain(`data-rail-id="${id}"`);
    }
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*data-rail-id="knowlead-market"|<button[^>]*data-rail-id="knowlead-market"[^>]*aria-disabled="true"/);
  });

  it('lists every legacy page in the navigator', () => {
    const html = renderShell('chat');

    for (const item of ALL_NAV_ITEMS) {
      expect(html).toContain(`data-page="${item.page}"`);
    }
  });

  it('marks the current page, including hyphenated IDs', () => {
    const html = renderShell('scheduled-sessions');

    expect(html).toMatch(/aria-current="page"[^>]*data-page="scheduled-sessions"|data-page="scheduled-sessions"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/aria-current="page"[^>]*data-page="chat"|data-page="chat"[^>]*aria-current="page"/);
  });

  it('mounts legacy pages inside the workspace main region', () => {
    const html = renderShell('chat');

    expect(html).toMatch(/<main class="main-content v2-workspace"[^>]*>\s*<div id="legacy-page">legacy<\/div>\s*<\/main>/);
    // The V2 backdrop modifier belongs to Home/Projects only; legacy pages keep theirs.
    expect(html).not.toContain('v2-workspace--surface');
  });

  it('switches to the light theme only on request', () => {
    expect(renderShell('chat', 'light')).toContain('class="izzi-v2 v2-shell" data-theme="light"');
    expect(renderShell('chat', 'dark')).not.toContain('data-theme');
  });

  it('offers a labelled theme switch that reports the current theme', () => {
    const toggle = (theme: 'dark' | 'light') =>
      `<button type="button" class="v2-header__toggle" aria-label="Giao diện sáng" aria-pressed="${theme === 'light'}">`;

    expect(renderShell('chat', 'dark')).toContain(toggle('dark'));
    expect(renderShell('chat', 'light')).toContain(toggle('light'));
    expect(renderHeader(true, 0)).not.toContain('Giao diện sáng');
  });
});

describe('extension update indicator', () => {
  it('shows nothing when there are no updates', () => {
    const html = renderShell('chat', undefined, 0);

    expect(html).not.toContain('v2-navigator__badge');
    expect(html).not.toContain('v2-header__dot');
    expect(html.match(EXTENSIONS_BUTTON)?.[0]).not.toContain('aria-label');
  });

  it('badges the Extensions entry, so the existing navigation reaches it', () => {
    const extensions = renderShell('chat', undefined, 3).match(EXTENSIONS_BUTTON)?.[0] ?? '';

    expect(extensions).toContain('bản cập nhật extension"');
    expect(extensions).toMatch(/aria-label="[^"]+, 3 bản cập nhật extension"/);
    expect(extensions).toContain('<span class="v2-navigator__badge">3 up</span>');
  });

  it('badges nothing but Extensions', () => {
    expect(renderNavigator(2).match(/v2-navigator__badge/g)).toHaveLength(1);
  });

  it('moves the indicator to the header toggle while the navigator is hidden', () => {
    const closed = renderHeader(false, 4);

    expect(closed).toContain('v2-header__dot');
    expect(closed).toContain('aria-label="Hiện danh mục trang, 4 bản cập nhật extension"');
    expect(renderHeader(true, 4)).not.toContain('v2-header__dot');
    expect(renderHeader(false, 0)).not.toContain('v2-header__dot');
  });
});

describe('navigator drawer (spec/04, 960–1023px)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts closed at compact widths, leaving the workspace uncovered', () => {
    stubViewport(true);
    const html = renderShell('chat', undefined, 2);

    expect(html).not.toContain('class="v2-navigator');
    expect(html).not.toContain('v2-drawer-scrim');
    expect(html).toContain('aria-label="Hiện danh mục trang, 2 bản cập nhật extension" aria-expanded="false"');
    expect(html).toContain('v2-header__dot');
  });

  it('keeps the navigator pinned open at wide widths', () => {
    stubViewport(false);
    const html = renderShell('chat');

    expect(html).toContain('class="v2-navigator"');
    expect(html).not.toContain('v2-navigator--drawer');
    expect(html).not.toContain('v2-navigator__close');
  });

  it('renders the drawer variant with a labelled close button', () => {
    const html = renderNavigator(0, () => undefined);

    expect(html).toContain('class="v2-navigator v2-navigator--drawer"');
    expect(html).toContain('<button type="button" class="v2-navigator__close" aria-label="Đóng danh mục trang">');
    expect(renderNavigator(0)).not.toContain('v2-navigator__close');
  });
});

describe('App.tsx V2 shell wiring', () => {
  const appSource = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');

  it('reads the flag once and lazy-loads the V2 shell', () => {
    expect(appSource).toContain("import('./components/v2/AppShellV2')");
    expect(appSource).toContain('useState(() => isUiShellV2Enabled())');
    expect(appSource).toContain('if (isShellV2) {');
  });

  it('keeps the legacy shell as the flag-OFF path', () => {
    const legacyBranch = appSource.slice(appSource.lastIndexOf('if (isShellV2) {'));

    expect(legacyBranch).toContain('className="app-layout"');
    expect(legacyBranch).toContain('<Sidebar');
  });

  it('feeds the V2 shell the same extension update count as the legacy sidebar', () => {
    const v2Branch = appSource.slice(appSource.lastIndexOf('if (isShellV2) {'), appSource.indexOf('</AppShellV2>'));

    expect(v2Branch).toContain('extensionUpdateCount={extensionUpdateCount}');
    expect(appSource).toContain('updateCount={extensionUpdateCount}');
  });
});
