import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNodes, fetchLinks } from './aibase-api';

afterEach(() => vi.unstubAllGlobals());
describe('Graph View checked bridge', () => {
  it('preserves offline and auth errors from main instead of falling back to empty lists', async () => {
    const list = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('window', { electronAPI: { graph: {
      list, links: list,
      readNodes: async () => ({ data: null, error: 'offline', status: 0 }),
      readLinks: async () => ({ data: null, error: 'expired', status: 401 }),
    } } });
    expect(await fetchNodes()).toEqual({ data: null, error: 'offline', status: 0 });
    expect(await fetchLinks()).toEqual({ data: null, error: 'expired', status: 401 });
    expect(list).not.toHaveBeenCalled();
  });

  it('supports older preloads and successful empty checked reads', async () => {
    vi.stubGlobal('window', { electronAPI: { graph: { list: async () => [], links: async () => [] } } });
    expect((await fetchNodes()).data).toEqual({ nodes: [] });
    expect((await fetchLinks()).data).toEqual({ links: [] });
    vi.stubGlobal('window', { electronAPI: { graph: {
      readNodes: async () => ({ data: [], error: null, status: 200 }),
      readLinks: async () => ({ data: [], error: null, status: 200 }),
    } } });
    expect((await fetchNodes()).data).toEqual({ nodes: [] });
    expect((await fetchLinks()).data).toEqual({ links: [] });
  });
});
