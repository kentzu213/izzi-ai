import { describe, expect, it } from 'vitest';
import {
  APPROVED_COMMERCIAL_VOICE_MODELS,
  isNonCommercialLicenseId,
  readVoiceStudioLicenseEvidence,
  verifyCommercialVoiceLicense,
} from './commercial-voice-license';

// CMR-007: the commercial voice gate may only open for an audited, commercially usable license
// chain that is pinned to a concrete artifact. Every negative case must keep the gate closed.

const REVISION = '9f2c1ab7d4e35608';
const MODEL_HASH = 'a'.repeat(64);

const approvedEvidence = {
  provider: 'VieNeu-TTS',
  modelId: `pnnbao-ump/VieNeu-TTS-v3-Turbo@${REVISION}`,
  modelHash: MODEL_HASH,
  license: 'Apache-2.0',
  licenseSource: 'https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo',
};

describe('CMR-007 commercial voice license verifier', () => {
  it('approves the audited VieNeu-TTS v3 Turbo chain regardless of letter case', () => {
    expect(verifyCommercialVoiceLicense(approvedEvidence)).toBe(true);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      provider: 'vieneu-tts',
      modelId: `PNNBAO-UMP/VIENEU-TTS-V3-TURBO@${REVISION.toUpperCase()}`,
      license: 'APACHE-2.0',
      modelHash: MODEL_HASH.toUpperCase(),
    })).toBe(true);
  });

  it('rejects the non-commercial F5 ViVoice checkpoint', () => {
    expect(verifyCommercialVoiceLicense({
      provider: 'F5-TTS',
      modelId: 'hynt/F5-TTS-Vietnamese-ViVoice@50228ccc563853f0ac628f49ed99a11f653d9ebe',
      modelHash: 'b'.repeat(64),
      license: 'CC-BY-NC-SA-4.0',
      licenseSource: 'https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice',
    })).toBe(false);
  });

  // Socrates CMR-007 finding C1: an unpinned declaration cannot be tied to the checkpoint that
  // actually loads, so it must never unlock commercial render.
  it('rejects an audited repository declared without a pinned revision', () => {
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      modelId: 'pnnbao-ump/VieNeu-TTS-v3-Turbo',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      modelId: 'pnnbao-ump/VieNeu-TTS-v3-Turbo@',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      modelId: 'pnnbao-ump/VieNeu-TTS-v3-Turbo@latest',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      modelId: `@${REVISION}`,
    })).toBe(false);
  });

  it('requires a full SHA-256 for the local checkpoint', () => {
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, modelHash: undefined })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, modelHash: 'abc123' })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, modelHash: 'z'.repeat(64) })).toBe(false);
  });

  it('rejects an unknown repository even when it declares a permissive license', () => {
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      modelId: `someone/unaudited-tts@${REVISION}`,
    })).toBe(false);
  });

  it('rejects an audited model whose declared license does not match the audit', () => {
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, license: 'MIT' })).toBe(false);
  });

  it('requires provider, model, license and license source', () => {
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, provider: '   ' })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, modelId: undefined })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, license: undefined })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, licenseSource: undefined })).toBe(false);
  });

  it('rejects a license source that is not HTTPS on an allowlisted documentation host', () => {
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      licenseSource: 'http://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      licenseSource: 'https://example.com/license',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      licenseSource: 'https://huggingface.co@evil.example/license',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({
      ...approvedEvidence,
      licenseSource: 'file:///C:/license.txt',
    })).toBe(false);
    expect(verifyCommercialVoiceLicense({ ...approvedEvidence, licenseSource: 'not-a-url' })).toBe(false);
  });

  it('detects non-commercial markers in license identifiers', () => {
    expect(isNonCommercialLicenseId('CC-BY-NC-4.0')).toBe(true);
    expect(isNonCommercialLicenseId('cc-by-nc-sa-4.0')).toBe(true);
    expect(isNonCommercialLicenseId('noncommercial-research')).toBe(true);
    expect(isNonCommercialLicenseId('non-commercial')).toBe(true);
    expect(isNonCommercialLicenseId('Apache-2.0')).toBe(false);
    expect(isNonCommercialLicenseId('MIT')).toBe(false);
  });

  it('keeps every registry entry commercial-safe, normalized and unpinned at repository level', () => {
    expect(APPROVED_COMMERCIAL_VOICE_MODELS.length).toBeGreaterThan(0);
    for (const approved of APPROVED_COMMERCIAL_VOICE_MODELS) {
      expect(isNonCommercialLicenseId(approved.license)).toBe(false);
      expect(approved.provider).toBe(approved.provider.toLowerCase());
      expect(approved.repository).toBe(approved.repository.toLowerCase());
      expect(approved.repository).not.toContain('@');
      expect(approved.license).toBe(approved.license.toLowerCase());
      expect(approved.evidenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(approved.components.length).toBeGreaterThan(0);
    }
  });
});

// Socrates CMR-007 finding C6: the original defect was that the verifier was never wired in the
// Electron entry. These tests pin the env -> evidence -> verifier path that the entry now uses.
describe('CMR-007 Voice Studio env wiring', () => {
  const documentedEnv = {
    STARIZZI_VOICE_STUDIO_PROVIDER: 'VieNeu-TTS',
    STARIZZI_VOICE_STUDIO_MODEL_ID: `pnnbao-ump/VieNeu-TTS-v3-Turbo@${REVISION}`,
    STARIZZI_VOICE_STUDIO_MODEL_SHA256: MODEL_HASH,
    STARIZZI_VOICE_STUDIO_MODEL_LICENSE: 'Apache-2.0',
    STARIZZI_VOICE_STUDIO_LICENSE_SOURCE: 'https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo',
    STARIZZI_VOICE_STUDIO_COMMERCIAL_USE_ALLOWED: 'true',
  } as NodeJS.ProcessEnv;

  it('maps the documented operator setup into evidence the real verifier accepts', () => {
    const evidence = readVoiceStudioLicenseEvidence(documentedEnv);

    expect(evidence.commercialUseAllowed).toBe(true);
    expect(verifyCommercialVoiceLicense(evidence as { provider: string })).toBe(true);
  });

  it('treats missing, blank or non-true values as no declaration', () => {
    const empty = readVoiceStudioLicenseEvidence({} as NodeJS.ProcessEnv);
    expect(empty.commercialUseAllowed).toBe(false);
    expect(empty.provider).toBeUndefined();
    expect(empty.modelId).toBeUndefined();
    expect(verifyCommercialVoiceLicense(empty as { provider: string })).toBe(false);

    const blank = readVoiceStudioLicenseEvidence({
      ...documentedEnv,
      STARIZZI_VOICE_STUDIO_MODEL_SHA256: '   ',
      STARIZZI_VOICE_STUDIO_COMMERCIAL_USE_ALLOWED: 'TRUE',
    } as NodeJS.ProcessEnv);
    expect(blank.modelHash).toBeUndefined();
    expect(blank.commercialUseAllowed).toBe(false);
    expect(verifyCommercialVoiceLicense(blank as { provider: string })).toBe(false);
  });

  it('does not accept an unpinned or non-commercial declaration from the environment', () => {
    const unpinned = readVoiceStudioLicenseEvidence({
      ...documentedEnv,
      STARIZZI_VOICE_STUDIO_MODEL_ID: 'pnnbao-ump/VieNeu-TTS-v3-Turbo',
    } as NodeJS.ProcessEnv);
    expect(verifyCommercialVoiceLicense(unpinned as { provider: string })).toBe(false);

    const nonCommercial = readVoiceStudioLicenseEvidence({
      ...documentedEnv,
      STARIZZI_VOICE_STUDIO_MODEL_LICENSE: 'CC-BY-NC-SA-4.0',
    } as NodeJS.ProcessEnv);
    expect(verifyCommercialVoiceLicense(nonCommercial as { provider: string })).toBe(false);
  });
});
