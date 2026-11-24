import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmSaveQueue } from './customer-crm-save-queue';

const LEAD = 'lead-a';
const OTHER = 'lead-b';

/** A save whose completion the test controls. */
function controlledRun() {
  const pending: Array<(outcome: 'done' | 'again') => void> = [];
  const run = vi.fn((_leadId: string, _mode: 'auto' | 'explicit') => new Promise<'done' | 'again'>((resolve) => {
    pending.push(resolve);
  }));
  const finish = async (outcome: 'done' | 'again' = 'done') => {
    pending.shift()?.(outcome);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { run, finish };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CrmSaveQueue (no request per keystroke)', () => {
  it('waits 1.5 s after the last change and saves once for a burst of typing', () => {
    const { run } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    for (let key = 0; key < 20; key += 1) {
      queue.changed(LEAD);
      vi.advanceTimersByTime(100);
    }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_399);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(LEAD, 'auto');
  });

  it('never runs two saves for one row at once; typing during a save saves once more after the debounce', async () => {
    const { run, finish } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    vi.advanceTimersByTime(1_500);
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.isSaving(LEAD)).toBe(true);

    queue.changed(LEAD);
    queue.changed(LEAD);
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(1);

    await finish();
    expect(queue.isSaving(LEAD)).toBe(false);
    vi.advanceTimersByTime(1_499);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('saves again after the debounce when the save reports newer input, and not otherwise', async () => {
    const { run, finish } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    vi.advanceTimersByTime(1_500);
    await finish('again');
    vi.advanceTimersByTime(1_500);
    expect(run).toHaveBeenCalledTimes(2);
    await finish('done');
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('saves at once on an explicit save and drops the pending timer', () => {
    const { run } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    queue.saveNow(LEAD);
    expect(run).toHaveBeenCalledWith(LEAD, 'explicit');
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed save by itself', async () => {
    const run = vi.fn(async () => { throw new Error('offline'); });
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    vi.advanceTimersByTime(1_500);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.isSaving(LEAD)).toBe(false);
  });

  it('keeps rows independent, cancels a row and sends waiting rows at once on close', () => {
    const { run } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    queue.changed(OTHER);
    queue.cancel(OTHER);
    queue.close();
    expect(run.mock.calls).toEqual([[LEAD, 'auto']]);
    queue.changed(LEAD);
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('on close, gives a row changed during its in-flight save exactly one final save', async () => {
    const { run, finish } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    vi.advanceTimersByTime(1_500);
    queue.changed(LEAD);
    queue.close();
    expect(run).toHaveBeenCalledTimes(1);
    await finish('done');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(LEAD, 'auto');
    await finish('again');
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('on close, also sends one final save when the in-flight save reports newer input', async () => {
    const { run, finish } = controlledRun();
    const queue = new CrmSaveQueue(run, 1_500);
    queue.changed(LEAD);
    vi.advanceTimersByTime(1_500);
    queue.close();
    await finish('again');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
