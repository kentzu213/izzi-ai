/**
 * CMR-007 — commercial voice license verifier (pure, fail-closed).
 *
 * The Customer Video Studio may only expose `commercialRenderAvailable` when the configured
 * TTS provider carries a documented, commercially usable license chain. Declaring intent via
 * env (`*_COMMERCIAL_USE_ALLOWED=true`) is NOT sufficient: the declared evidence must also
 * match an entry in the audited registry below, so a mis-set env cannot unlock a
 * non-commercial checkpoint.
 *
 * Audit evidence (model + revision + license + base lineage + required components) lives in
 * `docs/compliance/tts-model-license-evidence.md`. Keep both in sync: this registry is the
 * machine-checked half of that document.
 *
 * Fail-closed rules:
 *  - Any missing field (provider / modelId / license / licenseSource) -> false.
 *  - Any non-commercial marker in the license string -> false.
 *  - Provider+repository not in the audited registry -> false.
 *  - Declared license not byte-equal (case-insensitive) to the audited license -> false.
 *  - License source not an HTTPS URL on an allowlisted documentation host -> false.
 *  - Model id without a pinned revision (`repo@<hex>`) -> false. A floating tag cannot be tied
 *    to the checkpoint that actually loads.
 *  - Model hash that is not a full SHA-256 -> false.
 */

export interface CommercialVoiceLicenseEvidence {
  provider: string;
  modelId?: string;
  modelHash?: string;
  license?: string;
  licenseSource?: string;
}

export interface ApprovedCommercialVoiceModel {
  /** Normalized provider key as reported by the runtime/env. */
  provider: string;
  /** Normalized upstream repository id, WITHOUT a revision suffix. */
  repository: string;
  /** Audited license identifier the runtime must declare. */
  license: string;
  /** Required third-party components whose licenses were audited as commercial-safe. */
  components: string[];
  /** ISO date the license chain was verified against upstream sources. */
  evidenceDate: string;
}

/** Documentation hosts accepted as a license-evidence source. */
const LICENSE_SOURCE_HOSTS = new Set([
  'huggingface.co',
  'github.com',
  'raw.githubusercontent.com',
  'pypi.org',
]);

/**
 * Audited commercial-safe voice models.
 *
 * VieNeu-TTS v3 Turbo is the Voice Studio default (`from vieneu import Vieneu`). Its chain was
 * verified upstream on 2026-07-27: project code and checkpoint package are Apache-2.0, the
 * audio tokenizer ships with the Apache-2.0 MOSS-TTS family, and the grapheme-to-phoneme
 * dependency is Apache-2.0. v3 Turbo is trained from scratch, so it does not inherit the
 * non-commercial lineage that blocks the F5/ViVoice checkpoints.
 */
export const APPROVED_COMMERCIAL_VOICE_MODELS: readonly ApprovedCommercialVoiceModel[] = [
  {
    provider: 'vieneu-tts',
    repository: 'pnnbao-ump/vieneu-tts-v3-turbo',
    license: 'apache-2.0',
    components: ['moss-audio-tokenizer-nano', 'sea-g2p', 'perth', 'onnxruntime'],
    evidenceDate: '2026-07-27',
  },
];

function normalize(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, max) : '';
}

/** True when the license string advertises a non-commercial restriction. */
export function isNonCommercialLicenseId(license: string): boolean {
  return /(^|[-_ ])nc($|[-_ ])/i.test(license) || /non[-_ ]?commercial/i.test(license);
}

function hasAllowedLicenseSource(licenseSource: string): boolean {
  let url: URL;
  try {
    url = new URL(licenseSource);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && LICENSE_SOURCE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Split a declared model id into repository and pinned revision.
 * The revision suffix is mandatory: an unpinned `repo` declaration cannot be tied to the
 * checkpoint that actually runs, so it must not unlock commercial render.
 */
function splitPinnedModelId(modelId: string): { repository: string; revision: string } | null {
  const separator = modelId.lastIndexOf('@');
  if (separator <= 0) return null;
  const repository = modelId.slice(0, separator);
  const revision = modelId.slice(separator + 1);
  if (!repository || !/^[0-9a-f]{7,64}$/.test(revision)) return null;
  return { repository, revision };
}

/**
 * Verify a runtime's declared voice-license evidence against the audited registry.
 * Returns true only when every check passes.
 */
export function verifyCommercialVoiceLicense(evidence: CommercialVoiceLicenseEvidence): boolean {
  const provider = normalize(evidence.provider, 120);
  const modelId = normalize(evidence.modelId, 160);
  const license = normalize(evidence.license, 160);
  const modelHash = normalize(evidence.modelHash, 128);
  const licenseSource = typeof evidence.licenseSource === 'string' ? evidence.licenseSource.trim() : '';

  if (!provider || !modelId || !license || !licenseSource) return false;
  if (isNonCommercialLicenseId(license)) return false;
  if (!hasAllowedLicenseSource(licenseSource)) return false;
  // The local checkpoint must be identified by a full SHA-256 so the declaration is tied to a
  // concrete artifact rather than to a floating tag.
  if (!/^[0-9a-f]{64}$/.test(modelHash)) return false;

  const pinned = splitPinnedModelId(modelId);
  if (!pinned) return false;

  return APPROVED_COMMERCIAL_VOICE_MODELS.some((approved) => approved.provider === provider
    && approved.repository === pinned.repository
    && approved.license === license);
}

/**
 * Read the operator's Voice Studio license declaration from the environment.
 * Kept here (not in the Electron entry) so the wiring is testable and there is exactly one
 * place that maps env names to gate evidence.
 */
export function readVoiceStudioLicenseEvidence(env: NodeJS.ProcessEnv): {
  provider?: string;
  modelId?: string;
  modelHash?: string;
  license?: string;
  licenseSource?: string;
  commercialUseAllowed: boolean;
} {
  const text = (value: string | undefined): string | undefined => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || undefined;
  };
  return {
    provider: text(env.STARIZZI_VOICE_STUDIO_PROVIDER),
    modelId: text(env.STARIZZI_VOICE_STUDIO_MODEL_ID),
    modelHash: text(env.STARIZZI_VOICE_STUDIO_MODEL_SHA256),
    license: text(env.STARIZZI_VOICE_STUDIO_MODEL_LICENSE),
    licenseSource: text(env.STARIZZI_VOICE_STUDIO_LICENSE_SOURCE),
    commercialUseAllowed: env.STARIZZI_VOICE_STUDIO_COMMERCIAL_USE_ALLOWED === 'true',
  };
}
