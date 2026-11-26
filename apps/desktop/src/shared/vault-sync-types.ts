/**
 * Local-First Obsidian Vault & 3-way Cloud Sync shared contracts.
 *
 * @module shared/vault-sync-types
 */

export interface VaultManifestEntry {
  nodeId: string;
  relativePath: string;
  localSha256: string;
  remoteUpdatedAt: string;
  nodeType: string;
  sensitivity: 'local' | 'shareable';
  readOnly?: boolean;
}

export interface VaultManifest {
  schemaVersion: 1;
  vaultRoot: string;
  lastSyncAt: string | null;
  entries: Record<string, VaultManifestEntry>;
}

export interface VaultSyncStatus {
  vaultDir: string;
  enabled: boolean;
  watching: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  localNodes: number;
  localLinks: number;
  activeKnowledge: number;
  pendingCandidates: number;
  blockedSecrets: string[];
  conflicts: string[];
  lastError: string | null;
}

export interface VaultSearchHit {
  id: string;
  title: string;
  nodeType: string;
  snippet: string;
  source: 'graph' | 'knowledge';
  relativePath?: string;
}

export interface VaultImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  blockedSecrets: number;
  errors: string[];
}
