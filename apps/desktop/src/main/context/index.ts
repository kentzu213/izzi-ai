export { ContextCompilationError } from './context-error';
export {
  buildCanonicalContextSystemSegment,
  compileWorkspaceContext,
  compiledWorkspaceContextCanonicalPayload,
} from './compiler';
export {
  appendCompiledContextToHistory,
  appendCompiledContextToSystemPrompt,
  verifyCompiledWorkspaceContext,
  verifyContextKernelInput,
} from './prompt-kernel';
export {
  WorkContextSnapshotAdapter,
  type CaptureCompiledContextInput,
  type ContextSnapshotWriter,
} from './work-snapshot-adapter';
