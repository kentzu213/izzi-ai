import {
  PERSONAL_OFFICE_CONTEXT_SEGMENT_END,
  PERSONAL_OFFICE_CONTEXT_SEGMENT_START,
} from '../../shared/context';
import { redactText, type RedactionKind } from '../work/work-redaction';
import { ContextCompilationError } from './context-error';

const SECRET_REDACTION_KINDS = new Set<RedactionKind>([
  'secret-key-name',
  'jwt',
  'openai-key',
  'izzi-key',
  'bearer',
  'github-token',
  'aws-access-key',
  'private-key-block',
]);

export function assertSafeContextMetadata(value: string, label: string): void {
  if (
    value.includes(PERSONAL_OFFICE_CONTEXT_SEGMENT_START) ||
    value.includes(PERSONAL_OFFICE_CONTEXT_SEGMENT_END)
  ) {
    throw new ContextCompilationError(
      'prompt-delimiter-injection',
      `${label} contains a reserved context delimiter.`,
    );
  }
  if (redactText(value).kinds.some((kind) => SECRET_REDACTION_KINDS.has(kind))) {
    throw new ContextCompilationError(
      'raw-secret',
      `${label} contains credential-shaped material.`,
    );
  }
}
