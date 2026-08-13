import type { EventEmitter } from 'node:events';

interface OutputSafetyOptions {
  stdout: EventEmitter | null | undefined;
  stderr: EventEmitter | null | undefined;
  reportUnexpected?: (error: Error) => void;
}

const guardedStreams = new WeakSet<EventEmitter>();

export function installMainProcessOutputSafety(options: OutputSafetyOptions): void {
  const reportUnexpected = options.reportUnexpected ?? (() => undefined);
  for (const stream of new Set([options.stdout, options.stderr])) {
    if (!stream || guardedStreams.has(stream)) continue;
    stream.on('error', (error: Error & { code?: string }) => {
      if (error.code !== 'EPIPE') reportUnexpected(error);
    });
    guardedStreams.add(stream);
  }
}
