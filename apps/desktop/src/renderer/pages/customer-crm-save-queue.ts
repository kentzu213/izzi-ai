/**
 * Per-row save scheduling for MyGraph → CRM. Typing restarts a debounce timer, so a burst of keystrokes costs
 * one request; a row never has two saves in flight; a failed save is never retried by itself. The server
 * allows 30 requests a minute per user across the Care routes, so this is what keeps the CRM inside it.
 */
import { CRM_SAVE_DEBOUNCE_MS } from './customer-crm-flow';

/** `again`: the row still differs from the server (the user typed during the save); save it after a pause. */
export type CrmSaveRun = (leadId: string, mode: 'auto' | 'explicit') => Promise<'done' | 'again'>;

export class CrmSaveQueue {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly saving = new Set<string>();
  /** Rows changed while their save was in flight. */
  private readonly changedDuringSave = new Set<string>();
  private disposed = false;

  constructor(
    private readonly run: CrmSaveRun,
    private readonly delayMs: number = CRM_SAVE_DEBOUNCE_MS,
  ) {}

  /** A field changed: (re)start the row's debounce, or remember it until the running save ends. */
  changed(leadId: string): void {
    if (this.disposed) return;
    if (this.saving.has(leadId)) {
      this.changedDuringSave.add(leadId);
      return;
    }
    this.schedule(leadId);
  }

  /** The "Lưu" button: save at once, unless a save is already running (then save after it). */
  saveNow(leadId: string): void {
    if (this.disposed) return;
    this.clearTimer(leadId);
    if (this.saving.has(leadId)) {
      this.changedDuringSave.add(leadId);
      return;
    }
    this.fire(leadId, 'explicit');
  }

  cancel(leadId: string): void {
    this.clearTimer(leadId);
    this.changedDuringSave.delete(leadId);
  }

  isSaving(leadId: string): boolean {
    return this.saving.has(leadId);
  }

  /** The panel is closing: send every waiting row now rather than lose what was typed. */
  flushAll(): void {
    for (const leadId of [...this.timers.keys()]) {
      this.clearTimer(leadId);
      this.fire(leadId, 'auto');
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const leadId of [...this.timers.keys()]) this.clearTimer(leadId);
    this.changedDuringSave.clear();
  }

  private schedule(leadId: string): void {
    this.clearTimer(leadId);
    this.timers.set(leadId, setTimeout(() => {
      this.timers.delete(leadId);
      this.fire(leadId, 'auto');
    }, this.delayMs));
  }

  private clearTimer(leadId: string): void {
    const timer = this.timers.get(leadId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(leadId);
  }

  private fire(leadId: string, mode: 'auto' | 'explicit'): void {
    this.saving.add(leadId);
    const settle = (outcome: 'done' | 'again') => {
      this.saving.delete(leadId);
      const pending = this.changedDuringSave.delete(leadId);
      // A failure settles as `done`: only a new change or the "Lưu" button sends that row again.
      if (!this.disposed && (pending || outcome === 'again')) this.schedule(leadId);
    };
    let running: Promise<'done' | 'again'>;
    try {
      running = this.run(leadId, mode);
    } catch {
      running = Promise.resolve('done');
    }
    void running.then(settle, () => settle('done'));
  }
}
