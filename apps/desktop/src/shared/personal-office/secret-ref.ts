/**
 * Personal Office OS — secret references.
 *
 * Design constraint: "Secrets chỉ tồn tại qua secret reference." A Personal
 * Office contract NEVER carries a raw secret value (token, password, api key).
 * It carries only a `SecretRef` — a pointer the execution plane resolves at use
 * time against a local secret store (OS keychain / encrypted store / env). The
 * control plane and any serialized artifact only ever see the reference.
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/secret-ref
 */

/** Where a secret physically lives. Resolution happens only on the execution plane. */
export type SecretStore = 'os_keychain' | 'encrypted_file' | 'env' | 'integration_vault';

/**
 * An opaque pointer to a secret. Contains no secret material — only enough to
 * locate + scope it. Safe to serialize, log by `ref`, and cross the IPC bridge.
 */
export interface SecretRef {
  readonly kind: 'secret-ref';
  /** Stable locator within `store`, e.g. "integration/telegram/bot-token". */
  readonly ref: string;
  /** Backing store the execution plane resolves against. */
  readonly store: SecretStore;
  /** Optional least-privilege scopes the holder is allowed to use this secret for. */
  readonly scopes?: readonly string[];
}

/** Runtime guard: is `value` a well-formed SecretRef (and NOT a bare string)? */
export function isSecretRef(value: unknown): value is SecretRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SecretRef>;
  return v.kind === 'secret-ref' && typeof v.ref === 'string' && typeof v.store === 'string';
}

/** Construct a SecretRef. The only supported way to reference a secret in contracts. */
export function secretRef(
  store: SecretStore,
  ref: string,
  scopes?: readonly string[],
): SecretRef {
  return { kind: 'secret-ref', store, ref, ...(scopes ? { scopes } : {}) };
}

/**
 * Heuristic tripwire for accidental raw secrets. Not a validator of secret
 * content — it exists so serialization/tests can assert "this field is a ref,
 * not a leaked value". Returns true when a string LOOKS like a real credential.
 */
export function looksLikeRawSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  // Common credential shapes: sk-..., ghp_..., long hex/base64 blobs, JWTs.
  return (
    /^(sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9]{10,}$/.test(trimmed) ||
    /^[A-Fa-f0-9]{32,}$/.test(trimmed) ||
    /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(trimmed)
  );
}
