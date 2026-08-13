import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installMainProcessOutputSafety } from './main-process-output-safety';

describe('main-process output safety', () => {
  it('contains asynchronous EPIPE events from packaged GUI output streams', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const reportUnexpected = vi.fn();
    installMainProcessOutputSafety({ stdout, stderr, reportUnexpected });
    const brokenPipe = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });

    expect(() => stdout.emit('error', brokenPipe)).not.toThrow();
    expect(() => stderr.emit('error', brokenPipe)).not.toThrow();
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  it('reports non-EPIPE stream errors instead of silently swallowing them', () => {
    const stdout = new EventEmitter();
    const reportUnexpected = vi.fn();
    installMainProcessOutputSafety({ stdout, stderr: null, reportUnexpected });
    const unexpected = Object.assign(new Error('stream failed'), { code: 'EIO' });

    stdout.emit('error', unexpected);

    expect(reportUnexpected).toHaveBeenCalledWith(unexpected);
  });

  it('installs at most one guard on each stream', () => {
    const stdout = new EventEmitter();
    const reportUnexpected = vi.fn();
    installMainProcessOutputSafety({ stdout, stderr: stdout, reportUnexpected });
    installMainProcessOutputSafety({ stdout, stderr: stdout, reportUnexpected });

    expect(stdout.listenerCount('error')).toBe(1);
  });
});
