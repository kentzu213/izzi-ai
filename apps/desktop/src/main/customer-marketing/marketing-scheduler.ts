export const SCHEDULER_TICK_MS = 60_000;
/** Upper bound of jobs drained per tick so a long backlog after sleep cannot block the loop. */
const MAX_JOBS_PER_TICK = 5;

export interface MarketingSchedulerTarget {
  recoverScheduledJobs(): number;
  runDueScheduledJob(now?: Date): Promise<boolean>;
}

/** Runs due marketing jobs on the customer's machine while the app is running. */
export class MarketingScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly target: MarketingSchedulerTarget,
    private readonly onChange: () => void,
    private readonly log: (message: string, error?: unknown) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    try {
      if (this.target.recoverScheduledJobs() > 0) this.onChange();
    } catch (error) {
      this.log('Marketing scheduler recovery failed', error);
    }
    this.timer = setInterval(() => { void this.tick(); }, SCHEDULER_TICK_MS);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Single-flight: a tick that starts while another is running does nothing. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let ran = 0;
      while (!this.stopped && ran < MAX_JOBS_PER_TICK && await this.target.runDueScheduledJob(new Date())) {
        ran += 1;
        this.onChange();
      }
    } catch (error) {
      this.log('Marketing scheduler tick failed', error);
    } finally {
      this.running = false;
    }
  }
}
