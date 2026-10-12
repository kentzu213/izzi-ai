import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketingScheduler, SCHEDULER_TICK_MS } from './marketing-scheduler';

function target(dueJobs: number) {
  let remaining = dueJobs;
  return {
    recoverScheduledJobs: vi.fn(() => 0),
    runDueScheduledJob: vi.fn(async () => {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    }),
  };
}

describe('MarketingScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers interrupted jobs and runs due jobs immediately on start', async () => {
    const service = target(2);
    service.recoverScheduledJobs.mockReturnValue(1);
    const onChange = vi.fn();
    const scheduler = new MarketingScheduler(service, onChange);

    scheduler.start();
    await vi.waitFor(() => expect(service.runDueScheduledJob).toHaveBeenCalledTimes(3));
    scheduler.stop();

    expect(service.recoverScheduledJobs).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('checks for due jobs on every interval tick', async () => {
    vi.useFakeTimers();
    const service = target(0);
    const scheduler = new MarketingScheduler(service, vi.fn());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_MS * 2);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_MS * 2);

    expect(service.runDueScheduledJob).toHaveBeenCalledTimes(3);
  });

  it('does not overlap ticks while a job is still running', async () => {
    let release: (value: boolean) => void = () => {};
    const service = {
      recoverScheduledJobs: vi.fn(() => 0),
      runDueScheduledJob: vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; })),
    };
    const scheduler = new MarketingScheduler(service, vi.fn());

    const first = scheduler.tick();
    await scheduler.tick();
    release(false);
    await first;

    expect(service.runDueScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('caps jobs per tick and keeps running after an error', async () => {
    const service = target(20);
    const log = vi.fn();
    const scheduler = new MarketingScheduler(service, vi.fn(), log);

    await scheduler.tick();
    expect(service.runDueScheduledJob).toHaveBeenCalledTimes(5);

    service.runDueScheduledJob.mockRejectedValueOnce(new Error('boom'));
    await scheduler.tick();
    await scheduler.tick();

    expect(log).toHaveBeenCalledWith('Marketing scheduler tick failed', expect.any(Error));
    expect(service.runDueScheduledJob).toHaveBeenCalledTimes(11);
  });

  it('stops draining jobs once stopped mid-tick', async () => {
    const service = target(20);
    const scheduler = new MarketingScheduler(service, vi.fn());
    service.runDueScheduledJob.mockImplementationOnce(async () => {
      scheduler.stop();
      return true;
    });

    await scheduler.tick();

    expect(service.runDueScheduledJob).toHaveBeenCalledTimes(1);
  });
});
