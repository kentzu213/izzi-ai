import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
let trusted = true;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, input: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('../marketing/marketing-ipc', () => ({
  isTrustedMarketingSender: () => trusted,
}));

import { registerSalesCoachIpc } from './care-sales-coach-ipc';

describe('care-sales-coach-ipc (trusted sender gate)', () => {
  it('blocks untrusted senders on all 3 channels and forwards trusted calls cleanly', async () => {
    handlers.clear();
    const service = {
      generateScript: vi.fn(async () => ({ ok: true as const, data: {} as never })),
      saveSalesLesson: vi.fn(async () => ({ ok: true as const, recordId: 'kn-1' })),
      distillLessonsFromCrm: vi.fn(async () => ({ ok: true as const, queuedCount: 1, candidates: [] })),
    };
    registerSalesCoachIpc(service);

    trusted = false;
    for (const ch of ['salesCoach:generateScript', 'salesCoach:saveLesson', 'salesCoach:distillFromCrm']) {
      const res = (await handlers.get(ch)!({}, {})) as { ok: boolean; error?: string };
      expect(res.ok, ch).toBe(false);
      expect(res.error, ch).toBe('forbidden');
    }
    expect(service.generateScript).not.toHaveBeenCalled();
    expect(service.saveSalesLesson).not.toHaveBeenCalled();
    expect(service.distillLessonsFromCrm).not.toHaveBeenCalled();

    trusted = true;
    await handlers.get('salesCoach:generateScript')!({}, { row: {} });
    await handlers.get('salesCoach:saveLesson')!({}, { title: 'x', summary: 'y' });
    await handlers.get('salesCoach:distillFromCrm')!({}, { rows: [] });
    expect(service.generateScript).toHaveBeenCalledTimes(1);
    expect(service.saveSalesLesson).toHaveBeenCalledTimes(1);
    expect(service.distillLessonsFromCrm).toHaveBeenCalledTimes(1);
  });
});
