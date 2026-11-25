import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MyGraphTabPanels,
  MyGraphWorkspaceV2,
  myGraphTabsAfter,
  type MyGraphTabsState,
  type MyGraphWorkspaceV2Props,
} from './MyGraphWorkspaceV2';

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

  it('has no tab strip when no CRM panel is given', () => {
    expect(render()).not.toContain('role="tablist"');
  });
});

describe('MyGraphWorkspaceV2 with the CRM tab (Care CRM S2)', () => {
  const html = render({ crm: createElement('div', { 'data-testid': 'crm' }) });

  it('shows "Memory doanh nghiệp | CRM" with Memory selected', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Memory doanh nghiệp<\/button>/);
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*>CRM<\/button>/);
    expect(html.indexOf('>Memory doanh nghiệp<')).toBeLessThan(html.indexOf('>CRM<'));
  });

  it('keeps the existing graph view unchanged inside the Memory panel', () => {
    const memory = html.slice(html.indexOf('id="v2-mygraph-panel-memory"'), html.indexOf('id="v2-mygraph-panel-crm"'));
    expect(memory).toContain('<div class="v2-mygraph__stage"><div class="graphview-scope v2-mygraph__canvas"><div data-testid="graph"></div></div><div data-testid="aside"></div></div>');
  });

  it('wires each tab to its panel and mounts the CRM only once it is opened', () => {
    expect(html).toContain('aria-controls="v2-mygraph-panel-memory"');
    expect(html).toContain('aria-controls="v2-mygraph-panel-crm"');
    expect(html).toContain('aria-labelledby="v2-mygraph-tab-crm"');
    expect(html).toMatch(/id="v2-mygraph-panel-crm"[^>]*hidden=""/);
    expect(html).not.toContain('data-testid="crm"');
  });

  it('keeps the Memory view mounted, only hidden, through memory → CRM → memory', () => {
    const stage = createElement('div', { className: 'v2-mygraph__stage' }, createElement('div', { 'data-testid': 'graph' }));
    const crm = createElement('div', { 'data-testid': 'crm' });
    const panels = (state: MyGraphTabsState) => renderToStaticMarkup(createElement(MyGraphTabPanels, { ...state, stage, crm }));
    const memoryPanel = (markup: string) => markup.slice(markup.indexOf('id="v2-mygraph-panel-memory"'), markup.indexOf('id="v2-mygraph-panel-crm"'));
    const crmPanel = (markup: string) => markup.slice(markup.indexOf('id="v2-mygraph-panel-crm"'));

    const start: MyGraphTabsState = { tab: 'memory', crmOpened: false };
    const onCrm = myGraphTabsAfter(start, 'crm');
    const back = myGraphTabsAfter(onCrm, 'memory');
    expect([onCrm, back]).toEqual([{ tab: 'crm', crmOpened: true }, { tab: 'memory', crmOpened: true }]);

    for (const [state, memoryHidden] of [[start, false], [onCrm, true], [back, false]] as const) {
      const memory = memoryPanel(panels(state));
      expect(memory, state.tab).toContain('data-testid="graph"');
      expect(/^id="v2-mygraph-panel-memory"[^>]*hidden=""/.test(memory), state.tab).toBe(memoryHidden);
    }
    expect(crmPanel(panels(start))).not.toContain('data-testid="crm"');
    expect(crmPanel(panels(onCrm))).toContain('data-testid="crm"');
    expect(crmPanel(panels(back))).toMatch(/hidden=""[^]*data-testid="crm"/);
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

  it('keeps the legacy scope, GraphApi CRM-overlay adapter and in-app mode', () => {
    const legacy = page.slice(page.indexOf('if (v2) {'));

    expect(page).toContain('const baseApi = bridge as unknown as GraphApi;');
    expect(page).toContain('createMyGraphWithCrmApi(baseApi)');
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

  it('opens directly on Memory doanh nghiệp in MyGraph without mounting CustomerCrmPanel', () => {
    expect(page).not.toContain('CustomerCrmPanel');
  });
});
