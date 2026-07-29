import * as path from 'node:path';
import type {
  IntegrationGrantOperationalEvidenceSink,
} from '../integrations/grant-operation/grant-operation-service';
import type {
  MarketplaceCompletedReceiptSink,
} from '../marketplace/operation-service';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  AuthoritativeOperationalEvidencePort,
  EncryptedAuthoritativeOperationReceiptStore,
} from './authoritative-operation-receipts';
import { EncryptedOperationalEvidenceStore } from './operational-evidence-store';
import type { OperationalRuntimeEvidencePort } from './operational-browser-service';

export interface OfflineOperationalRuntimeComposition {
  readonly marketplaceCompletedReceiptSink: MarketplaceCompletedReceiptSink;
  readonly integrationGrantEvidenceSink: IntegrationGrantOperationalEvidenceSink;
  readonly runtimeEvidence: OperationalRuntimeEvidencePort;
}

export interface OfflineOperationalRuntimeCompositionOptions {
  readonly rootDir: string;
  readonly encryption: RuntimeEncryptionProvider;
}

function trustedRoot(rootDir: string): string {
  const resolved = path.resolve(rootDir);
  if (
    !rootDir
    || rootDir !== rootDir.trim()
    || rootDir.includes('\0')
    || !path.isAbsolute(rootDir)
    || rootDir !== resolved
  ) {
    throw new Error('Operational runtime root must be an exact absolute path');
  }
  return resolved;
}

/**
 * Constructs only the encrypted offline authority boundary. Browser drivers,
 * connectors and external-effect ports are intentionally not accepted here.
 */
export function createOfflineOperationalRuntimeComposition(
  options: OfflineOperationalRuntimeCompositionOptions,
): OfflineOperationalRuntimeComposition {
  const root = trustedRoot(options.rootDir);
  const receipts = new EncryptedAuthoritativeOperationReceiptStore(
    path.join(root, 'authoritative-receipts'),
    options.encryption,
  );
  const cachedEvidence = new EncryptedOperationalEvidenceStore(
    path.join(root, 'runtime-evidence'),
    options.encryption,
  );

  return Object.freeze({
    marketplaceCompletedReceiptSink: receipts,
    integrationGrantEvidenceSink: receipts,
    runtimeEvidence: new AuthoritativeOperationalEvidencePort(
      receipts,
      cachedEvidence,
    ),
  });
}
