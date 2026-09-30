import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MyGraphWorkspaceV2, type MyGraphWorkspaceV2Props } from './MyGraphWorkspaceV2';

const noop = () => undefined;

const render = (overrides: Partial<MyGraphWorkspaceV2Props> = {}) =>
  renderToStaticMarkup(createElement(MyGraphWorkspaceV2, {
    graph: createElement('div', { 'data-testid': 'graph' }),
    aside: createElement('div', { 'data-testid': 'aside' }),
    onOpenWeb: noop,
    ...overrides,
  }));
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('MyGraphWorkspaceV2', () => {
  it('mounts the graph inside the scoped canvas', () => {
    const html = render();

    expect(html).toContain('<div class="graphview-scope v2-mygraph__canvas"><div data-testid="graph"></div></div>');
  });

  it('places the aside inside the stage but outside the scoped canvas', () => {
    const html = render();
    const stage = html.slice(html.indexOf('class="v2-mygraph__stage"'));

    expect(stage).toContain('</div><div data-testid="aside"></div></div>');
    expect(stage.indexOf('data-testid="aside"')).toBeGreaterThan(stage.indexOf('data-testid="graph"'));
  });

  it('renders without an aside', () => {
    const html = render({ aside: undefined });

    expect(html).not.toContain('data-testid="aside"');
    expect(html).toContain('data-testid="graph"');
  });

  it('labels the section by its title', () => {
    const html = render();

    expect(html).toContain('aria-labelledby="v2-mygraph-title"');
    expect(html).toContain('id="v2-mygraph-title"');
    expect(html).toContain('>MyGraph</h1>');
  });

  it('uses a plain button for the web link and no form', () => {
    const html = render();

    expect(html).toMatch(/<button type="button" class="v2-button v2-button--ghost">Mở trên web ↗<\/button>/);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('<a ');
  });

  it('shows the open-on-web error as an alert only when set (ledger #23)', () => {
    expect(render()).not.toContain('role="alert"');

    const html = render({ openWebError: 'Không mở được trình duyệt.' });

    expect(html).toContain('<p class="v2-mygraph__error" role="alert">Không mở được trình duyệt.</p>');
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('class="v2-mygraph__stage"'));
  });
});

describe('MyGraph V2 wiring', () => {
  const app = read('../../App.tsx');
  const page = read('../../pages/KnowledgeUniverse.tsx');
  const component = read('./MyGraphWorkspaceV2.tsx');

  it('passes the shell flag from App and defaults the page to legacy', () => {
    expect(app).toContain('<KnowledgeUniversePage v2={isShellV2} />');
    expect(page).toContain('export default function MyGraphPage({ v2 = false }');
  });

  it('keeps the legacy scope, GraphApi adapter and in-app mode', () => {
    const legacy = page.slice(page.indexOf('if (v2) {'));

    expect(page).toContain('const api = bridge as unknown as GraphApi;');
    expect(legacy).toContain('className="graphview-scope"');
    expect(page.split('detached={false}').length - 1).toBe(2);
  });

  it('opens the web page through the existing main-process IPC only', () => {
    expect(page).toContain('openMyGraphWebSafely(window.electronAPI?.graph?.openMyGraphWeb)');
    expect(page).toContain('onOpenWeb={() => void openMyGraphWeb()}');
    expect(page).toContain('openWebError={openWebError}');
  });

  it('does not leave a floating openMyGraphWeb promise (ledger #23)', () => {
    expect(page).not.toContain('void window.electronAPI?.graph?.openMyGraphWeb');
  });

  it('keeps the V2 component free of IPC and the graph package', () => {
    expect(component).not.toMatch(/window\.|electronAPI|ipcRenderer|invoke\(|@kentzu213\/graph-view|aibase-api/);
  });
});
