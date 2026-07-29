import type { RuntimeHealthSnapshot } from './types';

export const RUNTIME_IPC_CHANNELS = Object.freeze({
  listHealth: 'personal-office:runtime:list-health',
});

export interface RuntimeListHealthInput {
  readonly workspaceId?: string;
}

export interface RuntimePreloadApi {
  readonly listHealth: (input: RuntimeListHealthInput) => Promise<readonly RuntimeHealthSnapshot[]>;
}
