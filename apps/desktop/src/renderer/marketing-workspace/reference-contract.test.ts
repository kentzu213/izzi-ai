import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMarketplaceDemoCatalog,
  markMarketplaceDemoInstalled,
} from '../../shared/marketplace';
import {
  MARKETING_REFERENCE_SETUP_GROUPS,
  MARKETING_REFERENCE_SURFACES,
  selectInstalledMarketingWorkspacePackage,
  trapDialogTabFocus,
} from './reference-contract';
import {
  isMarketingWorkspaceReferenceEnabled,
  MARKETING_WORKSPACE_REFERENCE_FLAG_KEY,
  setMarketingWorkspaceReferenceEnabled,
} from '../shell/featureFlags';

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('Marketing workspace reference contract', () => {
  it('exposes exactly four primary surfaces in the frozen order', () => {
    expect(MARKETING_REFERENCE_SURFACES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'brief', label: 'Brief' },
      { id: 'work', label: 'Work' },
      { id: 'deliverables', label: 'Deliverables' },
      { id: 'approvals', label: 'Approvals' },
    ]);
  });

  it('keeps setup limited to Context, Connections and Automation', () => {
    expect(MARKETING_REFERENCE_SETUP_GROUPS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'context', label: 'Context' },
      { id: 'connections', label: 'Connections' },
      { id: 'automation', label: 'Automation' },
    ]);
  });

  it('rolls presentation back without mutating workspace records', () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { search: '' },
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    });

    expect(isMarketingWorkspaceReferenceEnabled()).toBe(true);
    setMarketingWorkspaceReferenceEnabled(false);
    expect(storage.get(MARKETING_WORKSPACE_REFERENCE_FLAG_KEY)).toBe('off');
    expect(isMarketingWorkspaceReferenceEnabled()).toBe(false);
    setMarketingWorkspaceReferenceEnabled(true);
    expect(isMarketingWorkspaceReferenceEnabled()).toBe(true);
  });

  it('never treats a plan-only demo package as provisionable without installed evidence', () => {
    const catalog = createMarketplaceDemoCatalog('offline', 'Demo only.');
    const packageKey = catalog.packages[0].identity.packageKey;
    expect(selectInstalledMarketingWorkspacePackage(catalog, packageKey)).toBeNull();

    const installed = markMarketplaceDemoInstalled(catalog, [packageKey]);
    expect(selectInstalledMarketingWorkspacePackage(installed, packageKey)?.installation.state)
      .toBe('installed');
  });

  it('keeps Tab and Shift+Tab inside modal setup boundaries', () => {
    const focusLog: string[] = [];
    const first = { focus: () => focusLog.push('first') };
    const middle = { focus: () => focusLog.push('middle') };
    const last = { focus: () => focusLog.push('last') };
    const preventDefault = vi.fn();

    expect(trapDialogTabFocus(
      { key: 'Tab', shiftKey: false, preventDefault },
      [first, middle, last],
      last,
    )).toBe(true);
    expect(focusLog).toEqual(['first']);

    expect(trapDialogTabFocus(
      { key: 'Tab', shiftKey: true, preventDefault },
      [first, middle, last],
      first,
    )).toBe(true);
    expect(focusLog).toEqual(['first', 'last']);

    expect(trapDialogTabFocus(
      { key: 'Tab', shiftKey: false, preventDefault },
      [first, middle, last],
      { focus: vi.fn() },
    )).toBe(true);
    expect(focusLog).toEqual(['first', 'last', 'first']);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });
});
