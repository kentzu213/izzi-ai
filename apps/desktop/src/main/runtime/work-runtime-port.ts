import type { BrowserWorkPort } from './browser-runtime';
import type { WorkService } from '../work/work-service';

export class WorkServiceRuntimePort implements BrowserWorkPort {
  constructor(private readonly work: WorkService) {}

  putArtifact(input: Parameters<BrowserWorkPort['putArtifact']>[0]) {
    return this.work.putArtifact(input);
  }

  requestApproval(input: Parameters<BrowserWorkPort['requestApproval']>[0]) {
    return this.work.requestApproval({
      runId: input.runId,
      kind: 'external_publish',
      title: 'Approve browser test submission',
      summary: 'Submit the reviewed draft to an allowlisted test endpoint.',
      risk: 'high',
      target: input.target,
      input: input.body,
      estimatedSideEffect: 'One idempotent POST to the allowlisted test endpoint.',
      idempotencyKey: input.idempotencyKey,
      artifactId: input.artifactId,
      preview: input.preview,
      blockRun: true,
    });
  }

  getApproval(approvalId: string) {
    return this.work.getApproval(approvalId);
  }

  getRun(runId: string) {
    return this.work.getRun(runId);
  }

  listArtifacts(runId: string) {
    return this.work.listArtifacts(runId);
  }

  recordStep(input: Parameters<BrowserWorkPort['recordStep']>[0]): void {
    this.work.recordStep({
      ...input,
      kind: 'tool',
    });
  }
}
